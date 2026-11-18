/**
 * `core.camera-inspect` 插件清单（08-05）。
 *
 * 文档级只读面板 `camera.inspect`：四个 tab（lane / 连续性 / 玩家移动 / 回放），
 * 默认挂在 `document.drawer`，随抽屉默认收起；由命令打开或聚焦。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const CAMERA_INSPECT_PLUGIN_ID = 'core.camera-inspect'

/** 面板 ID。 */
export const CAMERA_INSPECT_PANEL_ID = 'camera.inspect'

/** 面板引用（命令里定位 / 显示用）。 */
export const CAMERA_INSPECT_PANEL_REF = {
  pluginId: CAMERA_INSPECT_PLUGIN_ID,
  panelId: CAMERA_INSPECT_PANEL_ID,
} as const

const coreCameraInspect: PluginManifest = {
  id: CAMERA_INSPECT_PLUGIN_ID,
  name: '镜头检查',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: CAMERA_INSPECT_PANEL_ID,
        titleKey: '镜头检查',
        component: () => import('./panels/CameraInspectPanel.vue').then((module) => module.default),
        defaultSlot: 'document.drawer',
        order: 20,
        minWidth: 320,
        minHeight: 200,
        keepAlive: true,
        singleton: true,
        closable: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
  },
  activate,
}

export { coreCameraInspect }
export default coreCameraInspect
