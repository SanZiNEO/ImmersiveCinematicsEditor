/**
 * core.workbench 的状态区条目（04-01 第五类 / 04-04 状态区）。
 *
 * 条目只读：只读状态、点击发命令，不直接改文档。
 */
import type { StatusContext, StatusItemContribution } from '../../workbench/api/contributions.ts'

/** 连接状态（左）。 */
const connectionItem: StatusItemContribution = {
  itemId: 'workbench.status.connection',
  align: 'left',
  order: 10,
  text: (ctx: StatusContext) => ctx.t(ctx.connected ? 'status.connected' : 'status.offline'),
  severity: (ctx: StatusContext) => (ctx.connected ? 'normal' : 'warning'),
  commandId: 'file.openDoc',
}

/** 当前页面 / 文档（左）。 */
const documentItem: StatusItemContribution = {
  itemId: 'workbench.status.document',
  align: 'left',
  order: 20,
  text: (ctx: StatusContext) => {
    if (!ctx.documentOpen) {
      return ctx.t('status.page', { page: ctx.pageId })
    }
    return ctx.t(ctx.documentDirty ? 'status.docDirty' : 'status.docSaved')
  },
  severity: (ctx: StatusContext) => (ctx.documentDirty ? 'warning' : 'normal'),
}

/** 布局预设（左）。 */
const presetItem: StatusItemContribution = {
  itemId: 'workbench.status.preset',
  align: 'left',
  order: 30,
  text: (ctx: StatusContext) => ctx.t('status.presetValue', { preset: ctx.presetId }),
  commandId: 'layout.showPanel',
}

/** 校验计数（右）。 */
const issueItem: StatusItemContribution = {
  itemId: 'workbench.status.issues',
  align: 'right',
  order: 10,
  text: (ctx: StatusContext) => ctx.t('status.issuesValue', { count: ctx.issueCount }),
  severity: (ctx: StatusContext) => (ctx.issueCount > 0 ? 'warning' : 'normal'),
  commandId: 'file.validateDoc',
}

/** 插件错误计数（右）。 */
const pluginItem: StatusItemContribution = {
  itemId: 'workbench.status.plugins',
  align: 'right',
  order: 20,
  text: (ctx: StatusContext) => ctx.t('status.pluginsValue', { count: ctx.pluginErrorCount }),
  severity: (ctx: StatusContext) => (ctx.pluginErrorCount > 0 ? 'error' : 'normal'),
}

/** 预览源状态（右）。 */
const previewItem: StatusItemContribution = {
  itemId: 'workbench.status.preview',
  align: 'right',
  order: 30,
  text: (ctx: StatusContext) => ctx.t(ctx.connected ? 'status.previewGame' : 'status.previewOffline'),
  severity: (ctx: StatusContext) => (ctx.connected ? 'normal' : 'warning'),
}

/** 全部核心状态项。 */
export const CORE_STATUS_ITEMS: StatusItemContribution[] = [
  connectionItem,
  documentItem,
  presetItem,
  issueItem,
  pluginItem,
  previewItem,
]
