/**
 * `core.geometry` 插件清单（12-09 几何工具）。
 *
 * 几何工具是文档级工具面板：素材尺寸检查、覆盖层区域规划、相机合成矩形、
 * 基准分辨率编辑、预览几何示意、Gizmo。默认停靠 `document.drawer`，
 * 不属于片段属性 / 效果面板，不依赖具体某一片段才能打开。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID（诊断 / 清单共用一份）。 */
export const GEOMETRY_PLUGIN_ID = 'core.geometry'

/** 面板 ID（布局 / 冻结尺寸表 / 拖拽目标共用）。 */
export const GEOMETRY_PANEL_ID = 'geometry.tools'

const coreGeometry: PluginManifest = {
  id: GEOMETRY_PLUGIN_ID,
  name: '几何工具',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: GEOMETRY_PANEL_ID,
        titleKey: 'geometry.tools.title',
        component: () => import('./panels/GeometryToolsPanel.vue').then((module) => module.default),
        defaultSlot: 'document.drawer',
        order: 50,
        minWidth: 420,
        minHeight: 300,
        keepAlive: true,
        closable: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
  },
  activate,
}

export { coreGeometry }
export default coreGeometry
