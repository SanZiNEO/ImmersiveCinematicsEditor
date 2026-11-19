/**
 * icdev-driver 插件（docs/13-e2e-system.md §4.1）。
 *
 * 能力：game.icdev。只通过模组自带 `tools/devtools/devtools.py`（venv python）
 * 驱动真游戏，不另造游戏驱动、不绕开编辑器自建 WS 探针。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import type { E2ePlugin, PluginContext, StepResult } from '../../src/registry.ts'

function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host)
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    socket.on('timeout', () => done(false))
  })
}

export function createIcdevDriverPlugin(): E2ePlugin {
  const resolvePython = (icdev: string): string =>
    path.join(icdev, '.venv', 'Scripts', 'python.exe')

  function runDevtools(ctx: PluginContext, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const python = resolvePython(ctx.config.paths.icdev)
    const script = path.join(ctx.config.paths.icdev, 'devtools.py')
    const result = spawnSync(python, [script, ...args], {
      cwd: ctx.config.paths.icdev,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env },
    })
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }

  return {
    id: 'icdev-driver',
    capabilities: ['game.icdev'],
    ops: ['game.up', 'game.down', 'game.key', 'game.cmd', 'game.logWait', 'game.status', 'game.where', 'game.waitWorld', 'game.ensureWebUi'],

    async available(ctx: PluginContext) {
      const missing: string[] = []
      const script = path.join(ctx.config.paths.icdev, 'devtools.py')
      if (!existsSync(script)) missing.push(`devtools.py 不存在: ${script}`)
      const python = resolvePython(ctx.config.paths.icdev)
      if (!existsSync(python)) missing.push(`devtools venv python 不存在: ${python}`)
      if (missing.length === 0) {
        const probe = runDevtools(ctx, ['rig-status'])
        if (probe.status !== 0) {
          missing.push(`游戏客户端未运行（rig-status 退出码 ${probe.status}）: ${probe.stderr.trim() || probe.stdout.trim()}`)
        }
      }
      return { ok: missing.length === 0, missing }
    },

    async invoke(ctx, op, params): Promise<StepResult> {
      // 加载器取自场景 params.loader，缺省 fabric；全局 `--loader` 放在子命令前。
      // Fabric 路径不传该参数，行为与改造前一致。
      const loader = String(ctx.params.loader ?? 'fabric')
      const loaderArgs = loader === 'fabric' ? [] : ['--loader', loader]
      let args: string[] = []
      switch (op) {
        case 'game.status':
          args = [...loaderArgs, 'rig-status']
          break
        case 'game.where': {
          const result = runDevtools(ctx, [...loaderArgs, 'where'])
          const stdout = result.stdout.trim()
          return {
            ok: result.status === 0,
            value: { status: result.status, stdout, stderr: result.stderr.trim(), loader },
            summary: `where 退出码 ${result.status}（${loader}）`,
            expected: '退出码 0',
            actual: `退出码 ${result.status}`,
          }
        }
        case 'game.waitWorld': {
          // 重连验收要等客户端**真正**进世界再按 F6。`where` 单独判不够：客户端刚起、
          // 窗口还没出现时 where 可能仍读到上一次会话的世界名，于是必须同时要求窗口存在。
          const world = params.world === undefined ? null : String(params.world)
          const timeoutMs = Number(params.timeoutMs ?? 180000)
          const deadline = Date.now() + timeoutMs
          let whereOut = ''
          let listOut = ''
          let ready = false
          let waitedMs = 0
          while (Date.now() < deadline) {
            const listProbe = runDevtools(ctx, [...loaderArgs, 'list'])
            listOut = listProbe.stdout.trim()
            const whereProbe = runDevtools(ctx, [...loaderArgs, 'where'])
            whereOut = whereProbe.stdout.trim()
            const hasWindow = /hwnd=\s*\d+/u.test(listOut)
            const inWorld = /world=/u.test(whereOut) && /dim=(?!None)/u.test(whereOut)
              && (world === null || whereOut.includes(`world=${world}`))
            if (hasWindow && inWorld) {
              ready = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 5000))
            waitedMs += 5000
          }
          return {
            ok: ready,
            value: { ready, waitedMs, where: whereOut, list: listOut, loader },
            summary: ready ? `窗口已出现且已进世界（等 ${waitedMs}ms，${loader}）` : `等待超时：where=${whereOut} list=${listOut}`,
            expected: 'hwnd=… 且 world=… dim=…',
            actual: `list=${listOut} where=${whereOut}`,
          }
        }
        case 'game.up':
          args = [...loaderArgs, 'client', ...(params.world === undefined ? [] : [String(params.world)])]
          break
        case 'game.ensureWebUi': {
          // F6 是切换键：客户端刚进世界时按一次可能被加载界面吃掉，所以按完必须看真实端口，
          // 端口没起来才再按。每次按键与端口观测都真实执行，不是为了过而重试到成功。
          const port = ctx.config.ports.webui
          const perAttemptMs = Number(params.perAttemptMs ?? 15000)
          const attempts = Number(params.attempts ?? 3)
          const presses: Array<{ attempt: number; keyStatus: number | null; listeningAfterMs: number | null }> = []
          const started = Date.now()
          if (await probePort('127.0.0.1', port, 1500)) {
            return {
              ok: true,
              value: { listening: true, presses, waitedMs: 0, port },
              summary: `8765 已在监听，无需按键（${port}）`,
              expected: 'listening=true',
              actual: 'listening=true（初始即已监听）',
            }
          }
          let listening = false
          let waitedMs = 0
          for (let attempt = 1; attempt <= attempts && !listening; attempt += 1) {
            const key = runDevtools(ctx, [...loaderArgs, 'key', String(params.name ?? 'f6')])
            const deadline = Date.now() + perAttemptMs
            let listeningAfterMs: number | null = null
            while (Date.now() < deadline) {
              if (await probePort('127.0.0.1', port, 800)) {
                listening = true
                listeningAfterMs = Date.now() - started
                break
              }
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            presses.push({ attempt, keyStatus: key.status, listeningAfterMs })
            waitedMs = Date.now() - started
          }
          return {
            ok: listening,
            value: { listening, presses, waitedMs, port, loader },
            summary: listening ? `按 F6 后 8765 开始监听（第 ${presses.length} 次，${waitedMs}ms，${loader}）` : `${attempts} 次按键后 ${port} 仍未监听`,
            expected: 'listening=true',
            actual: `listening=${String(listening)} presses=${presses.map((p) => p.keyStatus).join('/')}`,
          }
        }
        case 'game.down':
          args = [...loaderArgs, 'rig-down']
          break
        case 'game.key':
          args = [...loaderArgs, 'key', String(params.name ?? '')]
          break
        case 'game.cmd':
          args = [...loaderArgs, 'cmd', String(params.text ?? '')]
          break
        case 'game.logWait': {
          const lines = String(params.lines ?? '200')
          if (params.pattern === undefined) {
            args = [...loaderArgs, 'tail', lines]
          } else {
            args = [...loaderArgs, 'trace', '--pattern', String(params.pattern)]
          }
          break
        }
        default:
          return { ok: false, reason: `icdev-driver 未实现 op: ${op}` }
      }

      const result = runDevtools(ctx, args)
      const ok = result.status === 0
      return {
        ok,
        value: { args, status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim(), loader },
        summary: `${op} 退出码 ${result.status}（${loader}）`,
        expected: '退出码 0',
        actual: `退出码 ${result.status}`,
        reason: ok ? undefined : (result.stderr.trim() || result.stdout.trim()),
      }
    },
  }
}
