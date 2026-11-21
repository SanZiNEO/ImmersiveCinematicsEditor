/**
 * 交互走查模式（`review` 子命令）。
 *
 * 用 electron-host 插件的现有 setup/open/teardown 起一个独立的离线工作台：
 * 本次会话单独目录（artifacts/review-*）下的 profile、工作区与空 token 文件，
 * 独占 configured vite + 1 端口上的隔离 dev server，不碰真实项目/令牌/离线套件。
 * 夹具复制进隔离工作区的 scripts/（原夹具只读），用 editor.open 走真实打开路径，
 * 随后打印 REVIEW_READY，保持窗口可交互，等待窗口关闭或 Ctrl+C。
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { ConfigError, type ConfigLoader } from './config.ts'
import type { PluginContext } from './registry.ts'
import { createElectronHostPlugin } from '../plugins/electron-host/index.ts'

export interface ReviewInput {
  /** 调用者 cwd 相对的本地 JSON 路径；缺省用仓库内 seven-tracks 夹具。 */
  fixture?: string
}

type ExitReason = 'closed' | 'interrupted'

const DEFAULT_FIXTURE = path.join('src', 'core', 'schema', 'fixtures', 'scripts', 'valid', 'seven-tracks.json')

export async function runReview(loader: ConfigLoader, input: ReviewInput): Promise<number> {
  const sessionDir = path.join(loader.resolved.artifactsDir, `review-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const fixtureSource = input.fixture === undefined
    ? path.join(loader.repoRoot, DEFAULT_FIXTURE)
    : path.resolve(process.cwd(), input.fixture)
  if (!fixtureSource.toLowerCase().endsWith('.json')) {
    throw new ConfigError('E_CONFIG', `--fixture 必须是 .json 脚本文件: ${fixtureSource}`)
  }
  if (!existsSync(fixtureSource) || !statSync(fixtureSource).isFile()) {
    throw new ConfigError('E_CONFIG', `夹具文件不存在: ${fixtureSource}`)
  }
  const scriptName = path.basename(fixtureSource)
  mkdirSync(sessionDir, { recursive: true })

  const log = (line: string): void => console.log(line)
  const host = createElectronHostPlugin({
    review: true,
    onReviewUrl: (url) => log(`隔离 Vite: ${url}（本次会话独占）`),
  })
  const ctx: PluginContext = {
    runId: path.basename(sessionDir),
    artifactsDir: sessionDir,
    config: loader.resolved,
    suitePlugins: ['electron-host'],
    params: {},
    page: null,
    app: null,
    log,
    attachEvidence: () => {},
    cleanupErrors: [],
  }

  log(`=== review ${ctx.runId} ===`)
  log(`产物目录: ${sessionDir}`)
  log(`夹具: ${fixtureSource}`)

  const availability = await host.available(ctx)
  if (!availability.ok) {
    console.error('环境不满足走查启动条件:')
    for (const missing of availability.missing) console.error(`- ${missing}`)
    return 1
  }

  // 信号/启动早期只做一次“先停本会话进程”；final 阶段还会再调一次插件 teardown，
  // 覆盖发起早停之后才由 _electron.launch() 返回并赋值的 app，避免遗留窗口。
  let earlyTeardown: Promise<string[]> | null = null
  const stopOwnedProcesses = (): void => {
    if (earlyTeardown === null) {
      earlyTeardown = (host.teardown?.() ?? Promise.resolve([])).catch((error: unknown) => [`teardown 异常: ${String(error)}`])
    }
  }

  const exitState: { reason: ExitReason | null } = { reason: null }
  const closeGate = Promise.withResolvers<ExitReason>()
  const settle = (reason: ExitReason): void => {
    if (exitState.reason !== null) return
    exitState.reason = reason
    closeGate.resolve(reason)
  }
  const onSignal = (): void => {
    log('收到中断信号，正在关闭本次走查（Electron/Vite）...')
    settle('interrupted')
    // 同步进入 teardown：插件先 kill Vite，再 await Electron 关闭。
    // 即便 Playwright 随后的 SIGINT 处理直接退出进程，Vite 也已停下。
    stopOwnedProcesses()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let failure: unknown = null
  let cleanupErrors: string[] = []
  try {
    await host.setup?.(ctx)

    const app = ctx.app
    if (app === null) {
      // setup 完成时 app 已被关闭事件清空：窗口在启动阶段关闭，不是启动失败。
      settle('closed')
    } else if (app.process().exitCode !== null) {
      settle('closed')
    } else {
      app.on('close', () => settle('closed'))
    }

    const earlyReason = exitState.reason as ExitReason | null
    if (earlyReason !== null) {
      log(`启动期间已结束（${earlyReason === 'interrupted' ? '中断' : '窗口关闭'}），跳过夹具打开，收尾本会话进程。`)
    } else {
      const scriptsDir = path.join(sessionDir, 'workspace', 'scripts')
      mkdirSync(scriptsDir, { recursive: true })
      const isolatedFixture = path.join(scriptsDir, scriptName)
      copyFileSync(fixtureSource, isolatedFixture)
      log(`隔离夹具: ${isolatedFixture}`)

      const opened = await host.invoke(ctx, 'editor.open', { path: scriptName })
      if (!opened.ok) {
        throw new Error(
          `打开夹具失败: ${opened.summary ?? '未知原因'}` +
          (opened.reason === undefined ? '' : ` — ${opened.reason}`) +
          `（期望: ${String(opened.expected ?? '脚本成功打开')}，实际: ${String(opened.actual ?? '未打开')}）`,
        )
      }
      log(`已打开: ${opened.summary ?? scriptName}`)

      console.log('')
      console.log(`产物目录（本次会话根）: ${sessionDir}`)
      console.log(`夹具（隔离副本）: ${isolatedFixture}`)
      console.log('窗口已就绪：可操作到问题界面后自行截图（图片发到聊天并说明编号即可）。')
      console.log('页面刷新后可从脚本列表重开该隔离夹具；Vite HMR 生效。')
      console.log('按 Ctrl+C 或关闭窗口结束本次走查。')
      console.log('REVIEW_READY')

      const reason = await closeGate.promise
      log(reason === 'interrupted' ? '本次走查收到中断，开始收尾。' : '窗口已关闭，开始收尾。')
    }
  } catch (error) {
    failure = error
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    const earlyErrors = earlyTeardown === null ? [] : await earlyTeardown
    // 再走一次 teardown：若早停发生在 _electron.launch() 返回之前，第一次看不到
    // state.app；这里覆盖其后才赋值的窗口，保证本会话 Electron/Vite 都被回收。
    const finalErrors = await (host.teardown?.() ?? Promise.resolve([])).catch((error: unknown) => [`teardown 异常: ${String(error)}`])
    cleanupErrors = [...earlyErrors, ...finalErrors]
  }

  if (cleanupErrors.length > 0) {
    console.error('清理失败:')
    for (const entry of cleanupErrors) console.error(`- ${entry}`)
  }

  if (failure !== null) {
    const endedReason = exitState.reason as ExitReason | null
    if (endedReason !== null) {
      log(`走查在启动/打开阶段结束（${endedReason === 'interrupted' ? '中断' : '窗口已关闭'}），已清理本会话 Electron/Vite。`)
      return 0
    }
    console.error(`走查失败: ${failure instanceof Error ? failure.message : String(failure)}`)
    return 1
  }
  if (cleanupErrors.length > 0) return 1

  log('本次走查已结束，Electron/Vite 已清理。')
  return 0
}