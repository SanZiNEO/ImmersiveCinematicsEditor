/**
 * electron-host 插件（docs/13-e2e-system.md §4.1）。
 *
 * 能力：host.electron / editor.doc / editor.ui / editor.preview。
 *
 * 职责：起 vite dev server → 启动 Electron → 等待工作台就绪；提供文档、UI、
 * 预览帧与本地语料校验的 op。断言只面向用户可见行为（连接状态、状态区文案、
 * 帧计数、播放头），不触碰内部定时器与私有字段。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { connect as netConnect } from 'node:net'

import { _electron, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

import type { E2ePlugin, PluginContext, StepResult } from '../../src/registry.ts'

interface HostState {
  app: ElectronApplication | null
  page: Page | null
  viteChild: ChildProcess | null
  workspaceDir: string
  userDataDir: string
  tokenFile: string
  rendererErrors: string[]
  /** 【探针】按类型统计 renderer console 消息条数（事件计数，不走 evaluate）。 */
  consoleCounts: Record<string, number>
  /** 【探针】主进程 stderr 里 CDP 待写积压告警行（Too large write data pending）。 */
  mainPending: string[]
  /** 走查模式：Vite 启动 stderr（端口占用/提前退出时原样报出）。 */
  viteStderr: string[]
}

/** canvasInk 单次像素取样结果；tiles 为降采样后的平铺 RGB（仅用于两帧 diff，不进报告）。 */
interface CanvasInkSample {
  present: boolean
  width: number
  height: number
  readable: boolean
  inkRatio: number
  nonUniformRatio: number
  tiles: number[]
}

const e2eViteConfig = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'vite.e2e.config.ts')

function probeHttp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (response) => {
      response.resume()
      resolve(response.statusCode !== undefined)
    })
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
  })
}

async function waitHttpReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeHttp(port)) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`vite dev server 在 ${timeoutMs}ms 内未就绪（端口 ${port}）`)
}

/** 端口上是否有任意监听者（不限于 HTTP），走查模式据此拒绝复用陌生应用。 */
function portListening(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  const socket = netConnect({ host: '127.0.0.1', port })
  const finish = (value: boolean): void => {
    socket.destroy()
    resolve(value)
  }
  socket.setTimeout(500)
  socket.once('connect', () => finish(true))
  socket.once('timeout', () => finish(false))
  socket.once('error', () => finish(false))
  return promise
}

/** 读取 HTTP 响应体（最多 64 KiB），用于确认端口上是本会话的 Vite dev server。 */
function fetchHttpBody(port: number, timeoutMs = 1000): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>()
  const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (response) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => {
      if (body.length < 65536) body += chunk
    })
    response.on('end', () => resolve(body))
    response.on('error', () => resolve(null))
  })
  request.on('error', () => resolve(null))
  request.on('timeout', () => {
    request.destroy()
    resolve(null)
  })
  return promise
}

function viteStderrTail(state: HostState): string {
  const tail = state.viteStderr.slice(-8).join('\n')
  return tail === '' ? '' : `\nVite stderr:\n${tail}`
}

/**
 * 走查模式的 Vite 就绪判定：进程必须仍存活，且 `/` 响应含 Vite 客户端脚本注入。
 * 端口在启动前已确认独占、vite 又用 --strictPort 启动，因此不会把陌生 HTTP 当成就绪。
 */
async function waitReviewViteReady(port: number, child: ChildProcess, state: HostState, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastReason = '未收到 HTTP 响应'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`隔离 Vite 进程提前退出（退出码 ${String(child.exitCode)}，端口 ${port}）${viteStderrTail(state)}`)
    }
    const body = await fetchHttpBody(port)
    if (body !== null) {
      if (body.includes('/@vite/client')) return
      lastReason = '端口有 HTTP 响应但缺少 /@vite/client 标记，不是本会话的 Vite dev server'
    }
    await sleep(300)
  }
  throw new Error(`隔离 Vite 在 ${timeoutMs}ms 内未就绪（端口 ${port}）：${lastReason}${viteStderrTail(state)}`)
}

const ELECTRON_CLOSE_TIMEOUT_MS = 5_000

async function requestElectronExit(owned: ElectronApplication, mode: 'graceful' | 'dispose'): Promise<void> {
  const exited = owned.waitForEvent('close', { timeout: ELECTRON_CLOSE_TIMEOUT_MS })
  const requested = owned.evaluate(({ app, BrowserWindow }, closeMode) => {
    // 先让主进程调试调用返回，再申请退出，避免正常退出被误报为连接断开。
    setImmediate(() => {
      if (closeMode === 'dispose') {
        // 仅由测试宿主回收本次启动的窗口；不保存测试草稿，也不等待未保存对话框。
        for (const win of BrowserWindow.getAllWindows()) win.destroy()
      }
      app.quit()
    })
  }, mode)
  // 以进程退出事件为准，不能把请求已发送当成关闭完成。
  await Promise.race([exited, requested.then(() => exited)])
}

async function stopOwnedElectron(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // Playwright 在 Windows 下有一层启动 shell，只终止 shell 会留下 Electron。
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8', windowsHide: true, timeout: ELECTRON_CLOSE_TIMEOUT_MS,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(result.stderr.trim() || `taskkill 退出码 ${result.status}`)
  } else {
    // Playwright 在非 Windows 平台把 Electron 放在独立的进程组中。
    process.kill(-pid, 'SIGKILL')
  }
  await once(child, 'close', { signal: AbortSignal.timeout(ELECTRON_CLOSE_TIMEOUT_MS) })
}

export interface ElectronHostPluginOptions {
  /**
   * 交互走查模式：独立 profile/工作区/空 token，独占 configured vite + 1 端口上的
   * 隔离 Vite（不复用现有 dev server），不连真实游戏。
   */
  review?: boolean
  /** 走查模式 Vite 就绪后回报 loopback URL（供终端打印端口与生命周期）。 */
  onReviewUrl?: (url: string) => void
  /**
   * 已打包可执行文件路径（`release/win-unpacked/*.exe`）。
   *
   * 指定后不再起 Vite、不再走 `electron .`：直接拉起该 exe，走真实的
   * `app.isPackaged === true` 路径（asar、资源路径、updater 初始化）。
   * 这条路径用来验证"打包出来的东西能不能跑"，与构建是否成功是两件事。
   */
  executablePath?: string
  /**
   * 启动冒烟模式：不写占位 token。
   *
   * 游戏没连上只是「未连接」状态，不是错误。写入假 token 会让应用真的去连
   * 8765，Chromium 再把连接失败记成 console.error，把状态误报成故障。
   * 空 token 时客户端按设计停在 `no-token` 状态，不发起任何连接。
   */
  smoke?: boolean
}

export function createElectronHostPlugin(options: ElectronHostPluginOptions = {}): E2ePlugin {
  const reviewMode = options.review === true
  const smokeMode = options.smoke === true
  const packagedExe = options.executablePath ?? null
  const packagedMode = packagedExe !== null
  const state: HostState = {
    app: null,
    page: null,
    viteChild: null,
    workspaceDir: '',
    userDataDir: '',
    tokenFile: '',
    rendererErrors: [],
    consoleCounts: {},
    mainPending: [],
    viteStderr: [],
  }

  const missingFor = (ctx: PluginContext): string[] => {
    const missing: string[] = []
    const repo = ctx.config.paths.editorRepo
    if (!existsSync(repo)) missing.push(`编辑器仓库目录不存在: ${repo}`)
    if (packagedMode) {
      // 已打包模式只需 Playwright 与目标 exe；Vite/Electron 源码树都不参与。
      const pwPkgPackaged = path.join(repo, 'node_modules', '@playwright', 'test', 'package.json')
      if (!existsSync(pwPkgPackaged)) missing.push('@playwright/test 未安装（node_modules/@playwright/test）')
      if (!existsSync(packagedExe)) missing.push(`已打包可执行文件不存在: ${packagedExe}`)
      return missing
    }
    const electronBin = path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe')
    if (!existsSync(electronBin)) missing.push(`Electron 可执行文件不存在: ${electronBin}`)
    const pwPkg = path.join(repo, 'node_modules', '@playwright', 'test', 'package.json')
    if (!existsSync(pwPkg)) missing.push('@playwright/test 未安装（node_modules/@playwright/test）')
    const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!existsSync(viteBin)) missing.push('vite 未安装（node_modules/vite/bin/vite.js）')
    if (ctx.suitePlugins.includes('live-webui') && !existsSync(ctx.config.paths.workspace)) {
      missing.push(`真游戏工作区不存在: ${ctx.config.paths.workspace}`)
    }
    return missing
  }

  async function evalPage<T>(ctx: PluginContext, fn: (arg: unknown) => unknown, arg?: unknown): Promise<T> {
    if (ctx.page === null) throw new Error('编辑器页面尚未启动')
    return ctx.page.evaluate(fn, arg) as Promise<T>
  }

  /** 触发显式重试后等离开 connecting 初始瞬态；reconnecting/no-token 等稳定态立即返回，避免空等退避。 */
  async function settleConnection(ctx: PluginContext): Promise<{ status: string | null; connected: boolean; reason: string | null }> {
    await evalPage(ctx, () => {
      window.__workbench?.transport.retry?.()
      return true
    })
    const deadline = Date.now() + 5000
    const transient = new Set(['connecting'])
    let last = { status: null as string | null, connected: false, reason: null as string | null }
    while (Date.now() < deadline) {
      last = await evalPage(ctx, () => {
        const t = window.__workbench?.transport
        if (t === undefined) return { status: null, connected: false, reason: null }
        const conn = t.connection ? t.connection() : null
        return { status: conn?.status ?? null, connected: t.connected(), reason: conn?.reason ?? null }
      })
      if (!transient.has(String(last.status))) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return last
  }

  return {
    id: 'electron-host',
    capabilities: ['host.electron', 'editor.doc', 'editor.ui', 'editor.preview'],
    ops: [
      'editor.open', 'editor.validate', 'editor.push', 'editor.play', 'editor.stop',
      'editor.seek', 'editor.playbackAdvance', 'editor.framesGrew', 'editor.canvasInk', 'editor.waitPreviewPanel', 'editor.state', 'editor.waitConnected', 'editor.probeDiagnostics',
      'editor.waitDisconnected', 'editor.localIssues', 'editor.saveState', 'editor.screenshot',
      'editor.closeWindow', 'editor.writeToken', 'editor.retry', 'ui.click', 'ui.expectText', 'ui.expectVisible', 'ui.expectHidden',
      'ui.count', 'editor.metrics',
    ],

    async available(ctx) {
      const missing = missingFor(ctx)
      return { ok: missing.length === 0, missing }
    },

    async capabilityAvailable() {
      return { ok: true, missing: [] }
    },

    async setup(ctx) {
      const repo = ctx.config.paths.editorRepo
      const isLive = ctx.suitePlugins.includes('live-webui')
      state.workspaceDir = isLive
        ? ctx.config.paths.workspace
        : path.join(ctx.artifactsDir, 'workspace')
      state.userDataDir = path.join(ctx.artifactsDir, 'user-data')
      mkdirSync(state.workspaceDir, { recursive: true })
      mkdirSync(state.userDataDir, { recursive: true })

      const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js')
      if (packagedMode && !existsSync(packagedExe)) {
        throw new Error(`已打包可执行文件不存在: ${packagedExe}`)
      }
      if (reviewMode) {
        if (!existsSync(viteBin)) throw new Error(`vite 未安装（${viteBin}），无法启动走查用的隔离 dev server`)
        const electronBin = path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe')
        if (!existsSync(electronBin)) throw new Error(`Electron 可执行文件不存在: ${electronBin}`)
      }

      // 走查模式独占 configured vite + 1：与离线套件的 5173 并行，且绝不复用陌生应用。
      const port = reviewMode ? ctx.config.ports.vite + 1 : ctx.config.ports.vite
      if (reviewMode) {
        if (await portListening(port)) {
          throw new Error(
            `走查隔离端口 ${port} 已被占用（需要独占，不复用离线套件或其他应用的监听）。` +
            `请结束占用 ${port} 的进程，或修改 e2e-system/config/default.json 的 ports.vite 后重试。`,
          )
        }
      }

      // 已打包/冒烟模式加载磁盘上的 dist/（或 asar 内的 dist/），不经过 dev server。
      if (packagedMode || smokeMode) {
        ctx.log(
          packagedMode
            ? '已打包模式：跳过 Vite（应用直接加载 asar 内的 dist/）'
            : '冒烟模式：跳过 Vite（应用直接加载 dist/）',
        )
      } else if (reviewMode || !(await probeHttp(port))) {
        ctx.log(`启动${reviewMode ? '隔离 ' : ''}vite: node ${viteBin} --config ${e2eViteConfig} --port ${port} --strictPort`)
        state.viteStderr = []
        const child = spawn(process.execPath, [viteBin, '--config', e2eViteConfig, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
          cwd: repo,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        })
        state.viteChild = child
        child.on('error', (error) => state.viteStderr.push(`spawn: ${String(error)}`))
        child.stdout?.on('data', (chunk) => ctx.log(`[vite] ${String(chunk).trim()}`))
        child.stderr?.on('data', (chunk) => {
          const text = String(chunk).trim()
          if (text !== '') state.viteStderr.push(text)
          ctx.log(`[vite:err] ${text}`)
        })
        if (reviewMode) await waitReviewViteReady(port, child, state, ctx.config.launchTimeoutMs)
        else await waitHttpReady(port, ctx.config.launchTimeoutMs)
      } else if (!packagedMode && !smokeMode) {
        ctx.log(`vite 端口 ${port} 已在监听，复用现有 dev server`)
      }

      state.tokenFile = isLive
        ? ctx.config.env.webuiTokenFile
        : path.join(ctx.artifactsDir, 'no-token.txt')
      const devUrl = `http://127.0.0.1:${port}`
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        IC_EDITOR_USER_DATA: state.userDataDir,
        IC_EDITOR_WORKSPACE: state.workspaceDir,
        IC_WEBUI_TOKEN_FILE: state.tokenFile,
      }
      // 已打包/冒烟模式都不设 dev URL：让主进程走 loadFile(dist/index.html)。
      // 冒烟必须验证"真正发出去的那份产物"，而不是 Vite 现编的源码——
      // 否则破坏 dist 也测不出来（实测确认过这个漏洞）。
      if (!packagedMode && !smokeMode) env.IC_EDITOR_DEV_URL = devUrl
      if (reviewMode) {
        // 外部 ELECTRON_RENDERER_URL 优先级高于 IC_EDITOR_DEV_URL；走查必须锁到隔离 Vite。
        options.onReviewUrl?.(devUrl)
        env.ELECTRON_RENDERER_URL = devUrl
        // 走查不尝试连真实游戏：空 token 文件，握手如实失败并保持离线。
        writeFileSync(state.tokenFile, '', 'utf8')
      } else if (smokeMode) {
        // 冒烟不验证连接：空 token 让客户端停在 no-token，不发起无意义连接。
        writeFileSync(state.tokenFile, '', 'utf8')
      } else if (!isLive) {
        // 离线套件：写入一个占位 token，假 WebUI 场景才能走到握手；
        // 无 token 场景由 editor.writeToken 清空后复验。
        writeFileSync(state.tokenFile, 'e2e-dummy-token', 'utf8')
      }

      ctx.log(
        packagedMode
          ? `启动已打包应用: ${packagedExe}`
          : reviewMode
            ? '启动 Electron 编辑器（走查模式：独立 profile/工作区）'
            : '启动 Electron 编辑器',
      )
      state.app = packagedMode
        ? await _electron.launch({
          executablePath: packagedExe,
          env,
          timeout: ctx.config.launchTimeoutMs,
        })
        : await _electron.launch({
          args: ['.'],
          cwd: repo,
          env,
          timeout: ctx.config.launchTimeoutMs,
        })
      const launched = state.app
      launched.on('close', () => {
        if (state.app === launched) {
          state.app = null
          state.page = null
        }
      })
      state.page = await launched.firstWindow()
      state.page.on('pageerror', (error) => {
        state.rendererErrors.push(String(error))
        ctx.log(`[pageerror] ${String(error)}`)
      })
      state.page.on('console', (message) => {
        const type = message.type()
        state.consoleCounts[type] = (state.consoleCounts[type] ?? 0) + 1
        if (type === 'error') ctx.log(`[console:error] ${message.text()}`)
      })
      // 【探针】主进程 stderr：记录 CDP 待写积压告警（不经 evaluate，直接读子进程 stderr）。
      const mainProc = launched.process()
      mainProc?.stderr?.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.includes('Too large write data is pending')) state.mainPending.push(line.trim())
        }
      })
      await state.page.waitForSelector('.workspace-shell', { timeout: ctx.config.launchTimeoutMs })
      ctx.page = state.page
      ctx.app = state.app
    },

    async teardown() {
      const errors: string[] = []
      // 先同步终止本会话 Vite。Win32 Ctrl+C 下 Playwright 的 SIGINT 处理会在
      // Electron 关闭后直接 process.exit(130)，排在 await 之后的工作不保证执行；
      // Vite 必须在本函数首个 await 之前就停掉，避免遗留 dev server。
      if (state.viteChild !== null) {
        try {
          state.viteChild.kill()
        } catch (error) {
          errors.push(`vite 子进程关闭: ${String(error)}`)
        }
        state.viteChild = null
      }
      const owned = state.app
      if (owned !== null) {
        const child = owned.process()
        state.app = null
        state.page = null
        try {
          await requestElectronExit(owned, 'dispose')
        } catch (error) {
          errors.push(`Electron 关闭: ${String(error)}`)
          try {
            await stopOwnedElectron(child)
          } catch (stopError) {
            errors.push(`Electron 子进程回收: ${String(stopError)}`)
          }
        }
      }
      return errors
    },

    async invoke(ctx, op, params): Promise<StepResult> {
      switch (op) {
        case 'editor.open': {
          const target = String(params.path ?? '')
          const files = (ctx.params.files ?? {}) as Record<string, unknown>
          if (target in files) {
            const full = path.join(state.workspaceDir, 'scripts', target)
            mkdirSync(path.dirname(full), { recursive: true })
            writeFileSync(full, JSON.stringify(files[target], null, 2), 'utf8')
          }
          const result = await evalPage<{ ok: boolean; opened: boolean; error?: string; summary: Record<string, unknown> }>(
            ctx,
            (arg) => {
              const wb = window.__workbench
              if (wb === undefined) throw new Error('调试钩子 __workbench 缺失（编辑器需在 dev 模式运行）')
              const targetPath = String(arg)
              return wb.documents.open(targetPath).then((outcome) => {
                if (outcome.ok) wb.router.navigate('document')
                const summary = wb.documents.summary()
                return {
                  ok: outcome.ok,
                  opened: summary.docId !== null || summary.path !== null,
                  error: outcome.error,
                  summary,
                }
              })
            },
            target,
          )
          return {
            ok: result.ok || result.opened,
            value: result,
            summary: result.opened ? `已打开 ${target}` : `打开失败: ${result.error ?? '未知错误'}`,
            expected: '脚本成功打开',
            actual: result.opened ? `docId=${String(result.summary.docId)}` : result.error ?? '未打开',
          }
        }

        case 'editor.validate': {
          const result = await evalPage<{
            ok: boolean
            issues: Array<{ severity: string; message: string; jsonPath?: string }>
            rejected: boolean
            issueCount: number
          }>(ctx, () => {
            const wb = window.__workbench
            if (wb === undefined) throw new Error('调试钩子 __workbench 缺失')
            return wb.documents.validate().then((outcome) => {
              const local = wb.documents.localIssues()
              const issues = [...local, ...outcome.issues]
              return {
                ok: outcome.ok,
                issues,
                rejected: !outcome.ok || local.some((issue) => issue.severity === 'block'),
                issueCount: issues.length,
              }
            })
          })
          return {
            ok: true,
            value: result,
            summary: result.ok ? `校验通过（${result.issueCount} 条提示）` : `校验未通过（${result.issueCount} 条 issue）`,
          }
        }

        case 'editor.push': {
          const result = await evalPage<{ ok: boolean; reason?: string }>(ctx, () => {
            const wb = window.__workbench
            if (wb === undefined) throw new Error('调试钩子 __workbench 缺失')
            return wb.documents.pushPreview()
          })
          return { ok: result.ok, value: result, summary: result.ok ? '已推送预览' : `推送失败: ${result.reason ?? ''}` }
        }

        case 'editor.play': {
          // 服务端是唯一时间源：play 命令发出后 playback.state 回执要过一小会儿才到，
          // 与 stop 一致，轮询回执到 playing=true 再判定，不拿发送瞬间状态断言。
          const timeoutMs = Number(params.timeoutMs ?? 5000)
          await evalPage(ctx, () => {
            const wb = window.__workbench
            wb?.transport.play()
            return true
          })
          const deadline = Date.now() + timeoutMs
          let playing = false
          let waitedMs = 0
          while (Date.now() < deadline) {
            const probe = await evalPage<{ playing: boolean }>(ctx, () => ({
              playing: window.__workbench?.transport.playback().playing ?? false,
            }))
            playing = probe.playing
            if (playing) break
            await sleep(200)
            waitedMs += 200
          }
          return {
            ok: playing,
            value: { playing, waitedMs },
            summary: playing ? `播放中（等回执 ${waitedMs}ms）` : '未进入播放态',
            expected: '播放中',
            actual: playing ? 'playing' : 'paused',
          }
        }

        case 'editor.seek': {
          const time = Number(params.time ?? 0)
          await evalPage(ctx, (arg) => {
            const t = window.__workbench?.transport
            return t === undefined ? false : t.seek?.(Number(arg)) ?? true
          }, time)
          const after = await evalPage<{ time: number }>(ctx, () => ({
            time: window.__workbench?.transport.playback().time ?? 0,
          }))
          return { ok: true, value: { time, playback: after }, summary: `跳转播放头到 ${time}s` }
        }

        case 'editor.stop': {
          // `transport.stop()` 是 fire-and-forget：服务端 playback.state 回执要过一小会儿才到，
          // 所以停止后必须等回执变成 playing=false 再判定，不能拿发送瞬间的状态断言。
          const timeoutMs = Number(params.timeoutMs ?? 8000)
          await evalPage<{ sent: boolean }>(ctx, () => {
            window.__workbench?.transport.stop()
            return { sent: true }
          })
          const deadline = Date.now() + timeoutMs
          let playing = true
          let waitedMs = 0
          while (Date.now() < deadline) {
            const probe = await evalPage<{ playing: boolean }>(ctx, () => ({
              playing: window.__workbench?.transport.playback().playing ?? false,
            }))
            playing = probe.playing
            if (!playing) break
            await new Promise((resolve) => setTimeout(resolve, 200))
            waitedMs += 200
          }
          return {
            ok: !playing,
            value: { playing, waitedMs },
            summary: playing ? `停止回执 ${timeoutMs}ms 内未到` : `已停止（等回执 ${waitedMs}ms）`,
            expected: 'playing=false',
            actual: `playing=${String(playing)}`,
          }
        }

        case 'editor.playbackAdvance': {
          const windowMs = Number(params.windowMs ?? 2000)
          const before = await evalPage<{ time: number }>(ctx, () => ({
            time: window.__workbench?.transport.playback().time ?? 0,
          }))
          await new Promise((resolve) => setTimeout(resolve, windowMs))
          const after = await evalPage<{ time: number }>(ctx, () => ({
            time: window.__workbench?.transport.playback().time ?? 0,
          }))
          const delta = Math.max(0, after.time - before.time)
          return { ok: true, value: { delta, before: before.time, after: after.time, windowMs }, summary: `播放头推进 ${delta.toFixed(3)}s` }
        }

        case 'editor.framesGrew': {
          const windowMs = Number(params.windowMs ?? 1500)
          const width = Number(params.width ?? 2)
          const height = Number(params.height ?? 2)
          const shouldPush = params.push !== false
          await evalPage(ctx, () => {
            const holder = window
            holder.__e2eFrames = { count: 0, lastFrameAt: null }
            const wb = window.__workbench
            wb?.transport.onFrame(() => {
              const box = holder.__e2eFrames
              box.count += 1
              box.lastFrameAt = wb.transport.lastFrameAt()
            })
            return true
          })
          if (shouldPush) {
            const bytes = buildRgbaFrame(1, width, height, 1, 64)
            await evalPage(ctx, (payload) => {
              window.__fakeWebUi?.pushBinary(payload)
              return true
            }, bytes)
          }
          await new Promise((resolve) => setTimeout(resolve, windowMs))
          const box = await evalPage<{ count: number; lastFrameAt: number | null }>(ctx, () => window.__e2eFrames)
          const baseline = await evalPage<{ connected: boolean; lastFrameAt: number | null }>(ctx, () => ({
            connected: window.__workbench?.transport.connected() ?? false,
            lastFrameAt: window.__workbench?.transport.lastFrameAt() ?? null,
          }))
          return {
            ok: true,
            value: { delta: box.count, lastFrameAt: box.lastFrameAt, connected: baseline.connected },
            summary: `收到 ${box.count} 帧, lastFrameAt=${String(box.lastFrameAt)}`,
          }
        }

        case 'editor.canvasInk': {
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const windowMs = Number(params.windowMs ?? 300)
          const minInkRatio = Number(params.minInkRatio ?? 0.02)
          const timeoutMs = Number(params.timeoutMs ?? 10000)
          const pollMs = Number(params.pollMs ?? 500)
          const sample = (): Promise<CanvasInkSample | null> => evalPage<CanvasInkSample | null>(ctx, () => {
            const canvas = document.querySelector('canvas.preview-canvas')
            if (!(canvas instanceof HTMLCanvasElement)) return null
            const width = canvas.width
            const height = canvas.height
            if (width === 0 || height === 0) {
              return { present: true, width, height, readable: false, inkRatio: 0, nonUniformRatio: 0, tiles: [] }
            }
            const context = canvas.getContext('2d')
            if (context === null) {
              return { present: true, width, height, readable: false, inkRatio: 0, nonUniformRatio: 0, tiles: [] }
            }
            let image: ImageData
            try {
              image = context.getImageData(0, 0, width, height)
            } catch {
              return { present: true, width, height, readable: false, inkRatio: 0, nonUniformRatio: 0, tiles: [] }
            }
            const data = image.data
            const total = width * height
            const stride = Math.max(1, Math.ceil(Math.sqrt(total / 2048)))
            const cols = Math.ceil(width / stride)
            const rows = Math.ceil(height / stride)
            const tiles: number[] = []
            let nonBlack = 0
            let sumR = 0
            let sumG = 0
            let sumB = 0
            for (let y = 0; y < rows; y += 1) {
              for (let x = 0; x < cols; x += 1) {
                const index = (y * stride * width + x * stride) * 4
                const r = data[index]
                const g = data[index + 1]
                const b = data[index + 2]
                sumR += r
                sumG += g
                sumB += b
                if (Math.max(r, g, b) > 16) nonBlack += 1
                tiles.push(r, g, b)
              }
            }
            const count = cols * rows
            const meanR = sumR / count
            const meanG = sumG / count
            const meanB = sumB / count
            let nonUniform = 0
            for (let k = 0; k < count; k += 1) {
              const dr = tiles[k * 3] - meanR
              const dg = tiles[k * 3 + 1] - meanG
              const db = tiles[k * 3 + 2] - meanB
              if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) > 12) nonUniform += 1
            }
            return {
              present: true,
              width,
              height,
              readable: true,
              inkRatio: nonBlack / count,
              nonUniformRatio: nonUniform / count,
              tiles,
            }
          })

          // 面板懒加载与首帧解码都有启动延迟：在有界窗口内轮询画布出现与出帧，
          // 仍以真实像素占比作为通过依据，不用“收到帧”冒充非空。
          const deadline = Date.now() + timeoutMs
          let attempts = 0
          let last: { inkRatio: number; nonUniformRatio: number; changedRatio: number; width: number; height: number } | null = null
          let lastMissing = false
          for (;;) {
            attempts += 1
            const before = await sample()
            if (before === null) {
              lastMissing = true
            } else {
              lastMissing = false
              await sleep(windowMs)
              const after = await sample()
              if (after !== null && before.readable && after.readable) {
                const changedRatio = diffTiles(before.tiles, after.tiles)
                const inkRatio = Math.min(before.inkRatio, after.inkRatio)
                const nonUniformRatio = Math.min(before.nonUniformRatio, after.nonUniformRatio)
                last = { inkRatio, nonUniformRatio, changedRatio, width: after.width, height: after.height }
                if (inkRatio >= minInkRatio) {
                  return {
                    ok: true,
                    value: { ink: true, ...last, samples: 2, attempts, minInkRatio, waitedMs: timeoutMs - Math.max(0, deadline - Date.now()) },
                    summary: `画布非空：ink=${(inkRatio * 100).toFixed(1)}% 两帧变化=${(changedRatio * 100).toFixed(1)}%（第 ${attempts} 次取样）`,
                    expected: `inkRatio >= ${minInkRatio}`,
                    actual: `inkRatio=${inkRatio.toFixed(4)} nonUniform=${nonUniformRatio.toFixed(4)} changed=${changedRatio.toFixed(4)} ${after.width}×${after.height}`,
                  }
                }
              } else if (after === null) {
                lastMissing = true
              }
            }
            if (Date.now() >= deadline) break
            await sleep(pollMs)
          }

          if (last === null) {
            return {
              ok: false,
              reason: `等待 ${timeoutMs}ms 后仍未找到预览画布 canvas.preview-canvas`,
              expected: '预览画布存在且可读像素',
              actual: lastMissing ? 'canvas 缺失' : '画布尺寸为 0 或像素不可读',
            }
          }
          return {
            ok: false,
            value: { ink: false, ...last, samples: 2, attempts, minInkRatio },
            reason: '预览画布像素占比低于阈值，画面可能为空或全黑',
            expected: `inkRatio >= ${minInkRatio}`,
            actual: `inkRatio=${last.inkRatio.toFixed(4)} nonUniform=${last.nonUniformRatio.toFixed(4)} changed=${last.changedRatio.toFixed(4)} ${last.width}×${last.height}`,
          }
        }

        case 'editor.waitPreviewPanel': {
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const timeoutMs = Number(params.timeoutMs ?? 15000)
          const pollMs = Number(params.pollMs ?? 200)
          const deadline = Date.now() + timeoutMs
          let mounted = false
          let hosts = 0
          let attempts = 0
          while (Date.now() < deadline) {
            attempts += 1
            const probe = await evalPage<{ mounted: boolean; hosts: number }>(ctx, () => ({
              mounted: document.querySelector('.preview-panel') !== null,
              hosts: document.querySelectorAll('.panel-host').length,
            }))
            mounted = probe.mounted
            hosts = probe.hosts
            if (mounted) break
            await sleep(pollMs)
          }
          const waitedMs = timeoutMs - Math.max(0, deadline - Date.now())
          return {
            ok: mounted,
            value: { mounted, hosts, attempts, waitedMs },
            summary: mounted ? `预览面板已挂载（第 ${attempts} 次取样）` : '等待超时：预览面板未挂载',
            expected: '.preview-panel 已挂载',
            actual: `mounted=${String(mounted)} hosts=${hosts} attempts=${attempts}`,
          }
        }

        case 'editor.state': {
          const stateNow = await evalPage<{
            connected: boolean
            playback: { time: number; playing: boolean }
            stats: Record<string, unknown> | null
            lastFrameAt: number | null
            connection: { status: string; reason: string | null } | null
          }>(ctx, () => {
            const t = window.__workbench?.transport
            if (t === undefined) {
              return { connected: false, playback: { time: 0, playing: false }, stats: null, lastFrameAt: null, connection: null }
            }
            return {
              connected: t.connected(),
              playback: t.playback(),
              stats: t.stats(),
              lastFrameAt: t.lastFrameAt(),
              connection: t.connection ? t.connection() : null,
            }
          })
          return {
            ok: true,
            value: stateNow,
            summary: `connected=${String(stateNow.connected)} playing=${String(stateNow.playback.playing)} time=${stateNow.playback.time.toFixed(3)}`,
          }
        }

        case 'editor.waitConnected': {
          const timeoutMs = Number(params.timeoutMs ?? ctx.config.defaultTimeoutMs)
          const deadline = Date.now() + timeoutMs
          let connected = false
          while (Date.now() < deadline) {
            const probe = await evalPage<{ connected: boolean }>(ctx, () => ({
              connected: window.__workbench?.transport.connected() ?? false,
            }))
            connected = probe.connected
            if (connected) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          return { ok: connected, value: { connected }, summary: connected ? '已连接' : '等待超时仍未连接', expected: 'connected=true', actual: `connected=${String(connected)}` }
        }

        case 'editor.waitDisconnected': {
          const timeoutMs = Number(params.timeoutMs ?? ctx.config.defaultTimeoutMs)
          const deadline = Date.now() + timeoutMs
          let connected = true
          while (Date.now() < deadline) {
            const probe = await evalPage<{ connected: boolean }>(ctx, () => ({
              connected: window.__workbench?.transport.connected() ?? false,
            }))
            connected = probe.connected
            if (!connected) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          return { ok: !connected, value: { connected }, summary: connected ? '等待超时仍处于连接态' : '已离线', expected: 'connected=false', actual: `connected=${String(connected)}` }
        }

        case 'editor.localIssues': {
          const issues = await evalPage<Array<{ severity: string; message: string; jsonPath?: string }>>(ctx, () =>
            window.__workbench?.documents.localIssues() ?? [],
          )
          return { ok: true, value: { issues, count: issues.length }, summary: `${issues.length} 条本地 issue` }
        }

        case 'editor.saveState': {
          const summary = await evalPage<Record<string, unknown>>(ctx, () => window.__workbench?.documents.summary() ?? {})
          return { ok: true, value: summary, summary: `docId=${String(summary.docId)} dirty=${String(summary.dirty)}` }
        }

        case 'editor.screenshot': {
          const name = String(params.name ?? 'step')
          const file = path.join(ctx.artifactsDir, `${name}.png`)
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          await ctx.page.screenshot({ path: file })
          ctx.attachEvidence({ kind: 'screenshot', path: file, note: name })
          return { ok: true, value: { file }, summary: `截图 ${path.basename(file)}` }
        }

        case 'editor.writeToken': {
          const content = String(params.content ?? '')
          writeFileSync(state.tokenFile, content, 'utf8')
          await settleConnection(ctx)
          return { ok: true, value: { length: content.length }, summary: `token 文件已写入（${content.length} 字符）并触发重试` }
        }

        case 'editor.retry': {
          const settled = await settleConnection(ctx)
          return { ok: true, value: settled, summary: `已触发传输层显式重试，状态=${String(settled.status)}` }
        }

        case 'editor.closeWindow': {
          const repeat = Number(params.repeat ?? 2) >= 2 ? 2 : 1
          for (let attempt = 1; attempt <= repeat; attempt += 1) {
            const owned = state.app
            if (owned === null) continue
            try {
              // 验收走正常关窗，保留未保存确认；只有 teardown 可以回收隔离草稿。
              await requestElectronExit(owned, 'graceful')
            } catch (error) {
              return { ok: false, reason: `第 ${attempt} 次关闭失败: ${String(error)}`, expected: '窗口正常退出', actual: String(error) }
            }
          }
          return { ok: true, value: { secondError: null }, summary: repeat === 2 ? '关闭 2 次，第二次无异常' : '关闭无异常' }
        }

        case 'ui.click': {
          const selector = String(params.selector ?? '')
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          await ctx.page.locator(selector).first().click({ timeout: ctx.config.defaultTimeoutMs })
          return { ok: true, value: { selector }, summary: `点击 ${selector}` }
        }

        case 'ui.expectText': {
          const selector = String(params.selector ?? '')
          const text = String(params.text ?? '')
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const content = await ctx.page.locator(selector).first().textContent()
          const matches = (content ?? '').toLowerCase().includes(text.toLowerCase())
          return { ok: true, value: { matches, selector, text }, summary: matches ? `“${selector}” 含 “${text}”` : `“${selector}” 不含 “${text}”`, expected: `文案包含 ${text}`, actual: matches ? '包含' : '未包含' }
        }

        case 'ui.expectVisible': {
          const selector = String(params.selector ?? '')
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const visible = await ctx.page.locator(selector).first().isVisible()
          return { ok: true, value: { visible, selector }, summary: visible ? `${selector} 可见` : `${selector} 不可见` }
        }

        case 'ui.expectHidden': {
          const selector = String(params.selector ?? '')
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const visible = await ctx.page.locator(selector).first().isVisible()
          return { ok: true, value: { visible: !visible, selector }, summary: visible ? `${selector} 仍可见` : `${selector} 已隐藏` }
        }

        case 'ui.count': {
          const selector = String(params.selector ?? '')
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const count = await ctx.page.locator(selector).count()
          return { ok: true, value: { count, selector }, summary: `${selector} 命中 ${count} 个` }
        }

        case 'editor.metrics': {
          const rendererErrors = [...state.rendererErrors]
          let main: Record<string, unknown> = {}
          let renderer: Record<string, unknown> = {}
          if (state.app !== null) {
            try {
              main = await state.app.evaluate(() => {
                const mu = process.memoryUsage()
                const cpu = typeof process.getCPUUsage === 'function' ? process.getCPUUsage() : null
                return {
                  heapUsedMB: Math.round(mu.heapUsed / 1024 / 1024),
                  externalMB: Math.round(mu.external / 1024 / 1024),
                  cpuPercent: cpu === null ? null : cpu.percent,
                }
              })
            } catch (error) {
              main = { error: String(error) }
            }
          }
          if (ctx.page !== null) {
            try {
              renderer = await ctx.page.evaluate(() => ({
                usedJSHeapMB: typeof performance.memory === 'object' && performance.memory !== null
                  ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
                  : null,
              }))
            } catch (error) {
              renderer = { error: String(error) }
            }
          }
          return {
            ok: true,
            value: { hostAlive: state.app !== null, pageAlive: state.page !== null, main, renderer, rendererErrors },
            summary: `hostAlive=${state.app !== null} pageAlive=${state.page !== null} rendererErrors=${rendererErrors.length} main=${JSON.stringify(main)} renderer=${JSON.stringify(renderer)}`,
          }
        }

        case 'editor.probeDiagnostics': {
          // 【探针】定性用：console 事件计数（Playwright 事件，非 evaluate）、主进程 stderr
          // CDP 待写积压告警、renderer pageerror 列表、内存。不参与正式套件断言。
          let main: Record<string, unknown> = {}
          let renderer: Record<string, unknown> = {}
          if (state.app !== null) {
            try {
              main = await state.app.evaluate(() => {
                const mu = process.memoryUsage()
                const cpu = typeof process.getCPUUsage === 'function' ? process.getCPUUsage() : null
                return { heapUsedMB: Math.round(mu.heapUsed / 1024 / 1024), externalMB: Math.round(mu.external / 1024 / 1024), cpuPercent: cpu === null ? null : cpu.percent }
              })
            } catch (error) {
              main = { error: String(error) }
            }
          }
          if (ctx.page !== null) {
            try {
              renderer = await ctx.page.evaluate(() => ({
                usedJSHeapMB: typeof performance.memory === 'object' && performance.memory !== null ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null,
              }))
            } catch (error) {
              renderer = { error: String(error) }
            }
          }
          return {
            ok: true,
            value: {
              consoleCounts: { ...state.consoleCounts },
              mainPending: [...state.mainPending].slice(-10),
              mainPendingCount: state.mainPending.length,
              rendererErrors: [...state.rendererErrors],
              main,
              renderer,
            },
            summary: `console=${JSON.stringify(state.consoleCounts)} pending=${state.mainPending.length} rendererErrors=${state.rendererErrors.length}`,
          }
        }

        default:
          return { ok: false, reason: `electron-host 未实现 op: ${op}` }
      }
    },
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 两帧降采样瓦片的差异占比：任一通道差值超阈值即视为该瓦片变化。 */
function diffTiles(a: number[], b: number[]): number {
  const count = Math.min(Math.floor(a.length / 3), Math.floor(b.length / 3))
  if (count === 0) return 0
  let changed = 0
  for (let k = 0; k < count; k += 1) {
    const dr = Math.abs(a[k * 3] - b[k * 3])
    const dg = Math.abs(a[k * 3 + 1] - b[k * 3 + 1])
    const db = Math.abs(a[k * 3 + 2] - b[k * 3 + 2])
    if (Math.max(dr, dg, db) > 18) changed += 1
  }
  return changed / count
}

/** 构造一帧符合 18 字节大端帧头 + RGBA 载荷的二进制帧。 */
function buildRgbaFrame(frameId: number, width: number, height: number, ptsMicros: number, red: number): number[] {
  const header = new ArrayBuffer(18)
  const view = new DataView(header)
  view.setUint8(0, 1) // type RGBA
  view.setUint8(1, 1) // flags keyframe
  view.setUint32(2, frameId, false)
  view.setUint32(6, Math.floor(ptsMicros / 2 ** 32), false)
  view.setUint32(10, ptsMicros % 2 ** 32, false)
  view.setUint16(14, width, false)
  view.setUint16(16, height, false)
  const payload = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    payload[index * 4] = red
    payload[index * 4 + 1] = 128
    payload[index * 4 + 2] = 255
    payload[index * 4 + 3] = 255
  }
  return [...new Uint8Array(header), ...payload]
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
