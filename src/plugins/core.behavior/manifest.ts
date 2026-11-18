/**
 * `core.behavior` 插件清单（06-12：触发器字段面迁出属性面板）。
 *
 * 触发器种类多、组合复杂（20+ 种条件类型、条件树、前置、连续性），
 * 需要独立面板承载，不与片段属性混在同一面板里。
 *
 * 位置：`document.right`，与 `selection.properties` 并列成面板级 tab；
 * 右栏宽度不变，用户路径基本保持（右栏 → 触发器 tab）。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const BEHAVIOR_PLUGIN_ID = 'core.behavior'

/** 面板 ID（布局 / 冻结尺寸表共用）。 */
export const BEHAVIOR_PANEL_ID = 'behavior.triggers'

const coreBehavior: PluginManifest = {
  id: BEHAVIOR_PLUGIN_ID,
  name: '触发器',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: BEHAVIOR_PANEL_ID,
        titleKey: '触发器',
        component: () => import('./panels/TriggerPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 20,
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

export { coreBehavior }
export default coreBehavior
