/**
 * live-webui 插件（docs/13-e2e-system.md §4.1）。
 *
 * 能力：webui.live。只观察编辑器自身传输层对外语义（connected / playback /
 * stats / lastFrameAt / onFrame），不另建独立 WS 探针；可用性探测 token 文件
 * 与 8765 端口，缺一项记具体缺失项 → BLOCKED。
 */
import { readFileSync } from 'node:fs'
import net from 'node:net'

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

function readToken(file: string): { present: boolean; length: number } {
  try {
    const text = readFileSync(file, 'utf8').trim()
    return { present: text.length > 0, length: text.length }
  } catch {
    return { present: false, length: 0 }
  }
}

export function createLiveWebuiPlugin(): E2ePlugin {
  return {
    id: 'live-webui',
    capabilities: ['webui.live'],
    ops: ['live.port', 'live.token', 'live.connected', 'live.frameGrew'],

    async available(ctx: PluginContext) {
      const missing: string[] = []
      const token = readToken(ctx.config.env.webuiTokenFile)
      if (!token.present) {
        missing.push(`WebUI token 文件缺失或为空: ${ctx.config.env.webuiTokenFile}`)
      }
      const listening = await probePort('127.0.0.1', ctx.config.ports.webui, 1500)
      if (!listening) {
        missing.push(`8765 端口未监听（游戏 WebUI 未启动）: 127.0.0.1:${ctx.config.ports.webui}`)
      }
      return { ok: missing.length === 0, missing }
    },

    async invoke(ctx, op, params): Promise<StepResult> {
      switch (op) {
        case 'live.port':
          return { ok: true, value: { port: ctx.config.ports.webui }, summary: `WebUI 端口 ${ctx.config.ports.webui}` }

        case 'live.token': {
          const token = readToken(ctx.config.env.webuiTokenFile)
          // 只回显长度与存在性，绝不回显 token 内容。
          return { ok: token.present, value: { present: token.present, length: token.length }, summary: token.present ? `token 已提供（${token.length} 字符）` : 'token 缺失或为空' }
        }

        case 'live.connected': {
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const timeoutMs = Number(params.timeoutMs ?? ctx.config.defaultTimeoutMs)
          const deadline = Date.now() + timeoutMs
          let connected = false
          while (Date.now() < deadline) {
            const probe = await ctx.page.evaluate(() => window.__workbench?.transport.connected() ?? false)
            connected = Boolean(probe)
            if (connected) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          return {
            ok: connected,
            value: { connected },
            summary: connected ? '真实 8765 已连接' : '等待超时仍未连接',
            expected: 'connected=true',
            actual: `connected=${String(connected)}`,
          }
        }

        case 'live.frameGrew': {
          if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动' }
          const windowMs = Number(params.windowMs ?? 2000)
          await ctx.page.evaluate(() => {
            const holder = window
            holder.__e2eLiveFrames = { count: 0, lastFrameAt: null }
            const wb = window.__workbench
            wb?.transport.onFrame(() => {
              const box = holder.__e2eLiveFrames
              box.count += 1
              box.lastFrameAt = wb.transport.lastFrameAt()
            })
          })
          await new Promise((resolve) => setTimeout(resolve, windowMs))
          const box = await ctx.page.evaluate(() => window.__e2eLiveFrames)
          return { ok: true, value: box, summary: `真实帧 ${box?.count ?? 0} 帧` }
        }

        default:
          return { ok: false, reason: `live-webui 未实现 op: ${op}` }
      }
    },
  }
}
