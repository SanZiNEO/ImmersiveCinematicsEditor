/**
 * `core.templates` 插件清单（12-06 模板面板 / 12-07 快捷效果）。
 *
 * 面板挂文档抽屉；单例、切页保活、可关闭；仅在文档已打开时可用。
 * 面板组件首次可见才懒加载；本插件不注册额外服务 / 命令，生成与提交全部走
 * `PanelContext.commands` 与模板内核门面。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const TEMPLATES_PLUGIN_ID = 'core.templates'

/** 面板 ID（布局 / 冻结尺寸表 / 抽屉页签共用）。 */
export const TEMPLATES_PANEL_ID = 'templates'

const coreTemplates: PluginManifest = {
  id: TEMPLATES_PLUGIN_ID,
  name: '模板',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: TEMPLATES_PANEL_ID,
        titleKey: 'templates.panel.title',
        component: () => import('./panels/TemplatesPanel.vue').then((module) => module.default),
        defaultSlot: 'document.drawer',
        order: 30,
        minWidth: 460,
        minHeight: 260,
        keepAlive: true,
        closable: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
  },
  activate,
}

export { coreTemplates }
export default coreTemplates
