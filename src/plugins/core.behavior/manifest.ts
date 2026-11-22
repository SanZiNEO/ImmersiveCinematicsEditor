/**
 * `core.behavior` 插件清单。
 *
 * 触发器种类多、组合复杂（20+ 种条件类型、条件树、前置、连续性），
 * 结构树与触发器详情都收在「行为」侧栏；详情用居中弹窗承载，不再另开触发器标签。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const BEHAVIOR_PLUGIN_ID = 'core.behavior'

/** 旧面板 ID：只用于清理历史布局，不再注册贡献。 */
export const BEHAVIOR_PANEL_ID = 'behavior.triggers'

const coreBehavior: PluginManifest = {
  id: BEHAVIOR_PLUGIN_ID,
  name: '触发器',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    // 行为侧栏（11-01）：规则 / 绑定 / 事件 / 触发器的结构树与详情。
    drawerTabs: [
      {
        tabId: 'behavior',
        titleKey: '行为',
        component: () => import('./drawer/BehaviorDrawer.vue').then((module) => module.default),
        order: 30,
        minHeight: 160,
        keepAlive: true,
        available: (ctx) => ctx.pageId === 'document',
      },
    ],
  },
  activate,
}

export { coreBehavior }
export default coreBehavior
