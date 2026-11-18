/**
 * `core.selection-properties` 插件清单（06-09）。
 *
 * 编辑器页右栏的**属性面板**：当前片段全部适用属性（含未设置）、静态值、时钟、
 * 事件记录入口与诊断条。触发器已迁到独立插件 `core.behavior`（`behavior.triggers`）。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const SELECTION_PROPERTIES_PLUGIN_ID = 'core.selection-properties'

/** 面板 ID（布局 / 冻结尺寸表共用）。 */
export const SELECTION_PROPERTIES_PANEL_ID = 'selection.properties'

const coreSelectionProperties: PluginManifest = {
  id: SELECTION_PROPERTIES_PLUGIN_ID,
  name: '属性',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: SELECTION_PROPERTIES_PANEL_ID,
        titleKey: '属性',
        component: () => import('./panels/SelectionPropertiesPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 10,
        minWidth: 300,
        maxWidth: 640,
        keepAlive: true,
        closable: false,
        available: (ctx) => ctx.pageId === 'document',
      },
    ],
  },
  activate,
}

export { coreSelectionProperties }
export default coreSelectionProperties
