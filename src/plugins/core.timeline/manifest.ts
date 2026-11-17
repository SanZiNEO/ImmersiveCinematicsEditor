/**
 * `core.timeline` manifest（05-13）。
 *
 * 主轴面板固定为 `timeline.main`，默认停靠 `document.bottom`，高度 160–560。
 * 面板懒加载；`activate` 只注册命令与控制器，不做文档工作。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import { TIMELINE_COMMANDS } from './commands.ts'
import activate from './index.ts'

/** 插件 ID（命令 / 面板 / 诊断共用）。 */
export const TIMELINE_PLUGIN_ID = 'core.timeline'

/** 主面板 ID（唯一主时间轴入口）。 */
export const TIMELINE_PANEL_ID = 'timeline.main'

/** 插件版本。 */
export const TIMELINE_PLUGIN_VERSION = '0.1.0'

const timelinePlugin: PluginManifest = {
  id: TIMELINE_PLUGIN_ID,
  name: '时间轴',
  version: TIMELINE_PLUGIN_VERSION,
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: TIMELINE_PANEL_ID,
        titleKey: '时间轴',
        component: () => import('./TimelinePanel.vue').then((module) => module.default),
        defaultSlot: 'document.bottom',
        order: 10,
        minHeight: 160,
        maxHeight: 560,
        keepAlive: true,
        closable: false,
        singleton: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
    commands: TIMELINE_COMMANDS,
  },
  activate,
}

export { timelinePlugin }
export default timelinePlugin
