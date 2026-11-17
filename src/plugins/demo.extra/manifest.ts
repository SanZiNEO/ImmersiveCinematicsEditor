/**
 * `demo.extra` 插件清单（05-13 C13）。
 *
 * 唯一用途：验证「加面板只加插件目录 + builtin 一行」。面板显示真实的
 * pageId / documentName，不注册页面、命令、状态项或第二份布局。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const DEMO_EXTRA_PLUGIN_ID = 'demo.extra'

/** 面板 ID。 */
export const DEMO_EXTRA_PANEL_ID = 'demo.extra.panel'

const demoExtra: PluginManifest = {
  id: DEMO_EXTRA_PLUGIN_ID,
  name: 'Demo 额外面板',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: DEMO_EXTRA_PANEL_ID,
        titleKey: 'Demo · 额外面板',
        component: () => import('./panels/DemoExtraPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 90,
        keepAlive: true,
        available: (ctx) => ctx.pageId === 'document',
      },
    ],
  },
  activate,
}

export { demoExtra }
export default demoExtra
