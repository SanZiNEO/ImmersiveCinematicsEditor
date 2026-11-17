/**
 * `core.clip-effects` 插件清单（05-13）。
 *
 * 编辑器页左栏的真实效果面板：只读文档片段的对象属性，标量值走 `object.setValue`。
 * 面板组件懒加载；可用性只按页面判断，不在这里读文档。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID（诊断 / 清单共用一份）。 */
export const CLIP_EFFECTS_PLUGIN_ID = 'core.clip-effects'

/** 面板 ID（布局 / 冻结尺寸表共用）。 */
export const CLIP_EFFECTS_PANEL_ID = 'clip.effects'

const coreClipEffects: PluginManifest = {
  id: CLIP_EFFECTS_PLUGIN_ID,
  name: '片段效果',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: CLIP_EFFECTS_PANEL_ID,
        titleKey: '片段效果',
        component: () => import('./panels/ClipEffectsPanel.vue').then((module) => module.default),
        defaultSlot: 'document.left',
        order: 10,
        minWidth: 420,
        keepAlive: true,
        closable: false,
        available: (ctx) => ctx.pageId === 'document',
      },
    ],
  },
  activate,
}

export { coreClipEffects }
export default coreClipEffects
