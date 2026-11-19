/**
 * `core.flight` 插件清单（12-08 飞控九槽输入源）。
 *
 * 面板挂文档抽屉；单例、切页保活、可关闭；仅在文档已打开时可用。
 * 面板组件首次可见才懒加载；槽库实例在 activate 阶段注册进 ServiceRegistry。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const FLIGHT_PLUGIN_ID = 'core.flight'

/** 面板 ID。 */
export const FLIGHT_PANEL_ID = 'flight.inputs'

const coreFlight: PluginManifest = {
  id: FLIGHT_PLUGIN_ID,
  name: '飞控姿态槽',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: FLIGHT_PANEL_ID,
        titleKey: 'flight.panel.title',
        component: () => import('./panels/FlightInputsPanel.vue').then((module) => module.default),
        defaultSlot: 'document.drawer',
        order: 40,
        minWidth: 360,
        minHeight: 280,
        keepAlive: true,
        closable: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
  },
  activate,
}

export { coreFlight }
export default coreFlight
