/**
 * `core.selection-properties` 插件清单（05-13）。
 *
 * 编辑器页右栏：片段属性 / 触发器两个 tab。条件、delay、前置都在这里编辑；
 * 前置写入复用脚本页同一条 `SCRIPT_MUTATION_SERVICE.mutateRequires`。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const SELECTION_PROPERTIES_PLUGIN_ID = 'core.selection-properties'

/** 面板 ID（布局 / 冻结尺寸表共用）。 */
export const SELECTION_PROPERTIES_PANEL_ID = 'selection.properties'

const coreSelectionProperties: PluginManifest = {
  id: SELECTION_PROPERTIES_PLUGIN_ID,
  name: '片段属性',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: SELECTION_PROPERTIES_PANEL_ID,
        titleKey: '片段属性 / 触发器',
        component: () => import('./panels/SelectionPropertiesPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 10,
        minWidth: 280,
        maxWidth: 560,
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
