/**
 * `core.paths` 插件清单（07-05 / 07-10）。
 *
 * 路径是脚本级概念（`paths[]` 与 `clips[]` 平级），因此它有自己的面板
 * `paths.collection`：默认停靠 `document.drawer`，可拖到任意合法槽位，
 * 不属于 `clip.effects`，不依赖当前选中片段。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID（诊断 / 清单共用一份）。 */
export const PATHS_PLUGIN_ID = 'core.paths'

/** 面板 ID（布局 / 冻结尺寸表 / 拖拽目标共用）。 */
export const PATHS_PANEL_ID = 'paths.collection'

const corePaths: PluginManifest = {
  id: PATHS_PLUGIN_ID,
  name: '路径与曲线',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: PATHS_PANEL_ID,
        titleKey: '路径集合',
        component: () => import('./panels/PathCollectionPanel.vue').then((module) => module.default),
        defaultSlot: 'document.drawer',
        order: 20,
        minWidth: 420,
        minHeight: 200,
        keepAlive: true,
        closable: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
  },
  activate,
}

export { corePaths }
export default corePaths
