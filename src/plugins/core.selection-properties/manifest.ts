/**
 * `core.selection-properties` 插件清单（06-09，检查器改版）。
 *
 * 编辑器页右栏唯一的**检查器**面板：同一 `selection.properties` 按选区显示
 * 脚本参数（空选区）/ 轨道参数（`domain: 'track'`）/ 片段属性（片段、对象、关键帧、
 * 多选、失效、外部域）。没有内部页签；`core.meta` 的脚本字段 UI 已并入本插件。
 * 触发器由「行为」侧栏中的编辑弹窗承载。
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
