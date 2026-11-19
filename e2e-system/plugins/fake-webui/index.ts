/**
 * fake-webui 插件（docs/13-e2e-system.md §4.1）。
 *
 * 能力：webui.fake。浏览器侧假 WebUI，使用本插件目录内的 `fakeWebUi.ts`
 * （初始化脚本注入，app 启动前替换 `window.WebSocket`），不另写第二套假服务。
 */
import type { E2ePlugin, PluginContext, StepResult } from '../../src/registry.ts'
import { installFakeWebUi } from './fakeWebUi.ts'

export function createFakeWebUiPlugin(): E2ePlugin {
  return {
    id: 'fake-webui',
    capabilities: ['webui.fake'],
    ops: ['fake.install', 'fake.offline', 'fake.reconnect', 'fake.failSave', 'fake.requests', 'fake.pushBinary'],

    async available() {
      // 浏览器侧注入，不依赖外部服务；可用性由 electron-host 页面状态保证。
      return { ok: true, missing: [] }
    },

    async invoke(ctx, op, params): Promise<StepResult> {
      if (ctx.page === null) return { ok: false, reason: '编辑器页面尚未启动（host.electron 未就绪）' }
      switch (op) {
        case 'fake.install': {
          const files = (params.files ?? {}) as Record<string, unknown>
          await ctx.page.addInitScript(installFakeWebUi, files)
          await ctx.page.reload({ waitUntil: 'domcontentloaded' })
          await ctx.page.waitForSelector('.workspace-shell', { timeout: ctx.config.launchTimeoutMs })
          const socketCount = await ctx.page.evaluate(() => window.__fakeWebUi?.socketCount() ?? 0)
          return { ok: true, value: { socketCount, files: Object.keys(files) }, summary: `假 WebUI 已注入，夹具 ${Object.keys(files).length} 份` }
        }

        case 'fake.offline':
          await ctx.page.evaluate(() => window.__fakeWebUi?.disconnect())
          return { ok: true, summary: '假 WebUI 已断开' }

        case 'fake.reconnect':
          await ctx.page.evaluate(() => window.__fakeWebUi?.reconnect())
          return { ok: true, summary: '假 WebUI 恢复在线' }

        case 'fake.failSave':
          await ctx.page.evaluate((path) => window.__fakeWebUi?.failNextSave(String(path)), params.path)
          return { ok: true, summary: `下一次保存 ${String(params.path)} 将失败` }

        case 'fake.requests': {
          const count = await ctx.page.evaluate((type) => {
            const fake = window.__fakeWebUi
            return fake === undefined ? 0 : fake.requestCount(type === undefined ? undefined : String(type))
          }, params.type)
          return { ok: true, value: { count }, summary: `请求计数 ${count}` }
        }

        case 'fake.pushBinary': {
          const bytes = (params.bytes ?? []) as number[]
          await ctx.page.evaluate((payload) => window.__fakeWebUi?.pushBinary(payload), bytes)
          return { ok: true, summary: `投递二进制帧 ${bytes.length} 字节` }
        }

        default:
          return { ok: false, reason: `fake-webui 未实现 op: ${op}` }
      }
    },
  }
}
