/**
 * 工作台稳定标识与槽位（04-01 / 04-02）。
 *
 * 插件、面板、抽屉、命令、主题的 ID 都有固定形态；内核只认 ID，不认组件路径。
 */

/** 插件 ID 形态（04-01）：`^[a-z][a-z0-9._-]{2,63}$`。 */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/

/** 面板 / 抽屉 ID 形态：点分小写，如 `clip.effects`、`demo.drawer.notes`。 */
export const PANEL_ID_PATTERN = /^[a-z][a-z0-9._-]*$/

/** 命令 ID 形态：点分驼峰，如 `file.saveDoc`。 */
export const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9._-]*$/

/** 主题 ID 形态：如 `workbench.dark-default`、`user.my-theme`。 */
export const THEME_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/

/** 用户导入主题的 ID 前缀（04-07）。 */
export const USER_THEME_PREFIX = 'user.'

/** 面板默认槽位（04-02，冻结集合）。 */
export const SLOT_IDS = [
  'document.left',
  'document.center',
  'document.right',
  'document.bottom',
  'document.drawer',
  'project.main',
  'settings.nav',
  'settings.content',
] as const

export type SlotId = (typeof SLOT_IDS)[number]

/** 是否为合法槽位。 */
export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value)
}

/** split 方向。 */
export type Orientation = 'horizontal' | 'vertical'

/** 布局树里的面板身份：只存这两个字段（04-01 / 04-02）。 */
export interface PanelRef {
  pluginId: string
  panelId: string
}

/** 面板 / 抽屉的全局键（日志、诊断、布局 id 用）。 */
export function panelRefKey(ref: PanelRef): string {
  return `${ref.pluginId}:${ref.panelId}`
}

/** `PanelNode.id` 形态：`p:<pluginId>:<panelId>`（04-02）。 */
export function panelNodeId(ref: PanelRef): string {
  return `p:${ref.pluginId}:${ref.panelId}`
}

/** 两个引用是否指向同一面板。 */
export function samePanel(left: PanelRef, right: PanelRef): boolean {
  return left.pluginId === right.pluginId && left.panelId === right.panelId
}

/** 工作台页面 ID 形态。 */
export const PAGE_ID_PATTERN = /^[a-z][a-z0-9._-]*$/

/** 核心三页（04-04）。 */
export const CORE_PAGE_IDS = ['project', 'document', 'settings'] as const

export type CorePageId = (typeof CORE_PAGE_IDS)[number]

/** 抽屉保留 tab ID（04-06）。 */
export const RESERVED_DRAWER_TABS = [
  'curves',
  'behavior',
  'resources',
  'diagnostics',
  'templates',
] as const

export type ReservedDrawerTabId = (typeof RESERVED_DRAWER_TABS)[number]
