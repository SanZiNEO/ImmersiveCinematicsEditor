/**
 * `core.transition-panel` 插件清单（08-03）。
 *
 * 文档页右侧的**转场面板**：以「A→B 片段交界」为编辑对象，承载叠化、参数过渡与共存处理。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const CAMERA_TRANSITION_PLUGIN_ID = 'core.transition-panel'

/** 面板 ID（08-03 §4.1：`transition.panel`）。 */
export const CAMERA_TRANSITION_PANEL_ID = 'transition.panel'

const coreCameraTransition: PluginManifest = {
  id: CAMERA_TRANSITION_PLUGIN_ID,
  name: '转场',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: CAMERA_TRANSITION_PANEL_ID,
        titleKey: '转场',
        component: () => import('./panels/TransitionPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 30,
        minWidth: 300,
        maxWidth: 720,
        keepAlive: true,
        singleton: true,
        closable: true,
        available: (context) => context.pageId === 'document' && context.documentOpen,
      },
    ],
  },
  activate,
}

export { coreCameraTransition }
export default coreCameraTransition
