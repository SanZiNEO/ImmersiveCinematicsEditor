/**
 * 插件 manifest 与七类扩展点（04-01）。
 *
 * 插件在编译期注册；一个插件可以贡献 panel / page / drawerTab / command / statusItem /
 * settings / theme 七类东西。内核只认 `pluginId`，不认组件路径。
 */
import type { Component } from 'vue'

import type { CommandContext, KeyScope } from './commands.ts'
import type { PluginContext } from './context.ts'
import type { PanelRef, SlotId } from './ids.ts'
import type { ThemeContribution } from './theme.ts'

/** 本轮唯一接受的 manifest API 版本。 */
export const PLUGIN_API_VERSION = '1'

export type PluginApiVersion = typeof PLUGIN_API_VERSION

/** 面板可用性上下文（布局保留节点、只显示不可用）。 */
export interface PanelAvailabilityContext {
  pageId: string
  documentOpen: boolean
  /** 插件可用性求值失败时由内核记录诊断，按 `false` 处理。 */
  services: unknown
}

/** 面板贡献（04-01 第一类）。 */
export interface PanelContribution {
  panelId: string
  titleKey: string
  /** 懒加载：内核启动时不得把面板打进首屏包。 */
  component: () => Promise<Component>
  defaultSlot: SlotId
  order: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  keepAlive?: boolean
  /** 默认 true；同一页最多一个实例。 */
  singleton?: boolean
  /** 默认 true；核心面板可设 false。 */
  closable?: boolean
  available?: (ctx: PanelAvailabilityContext) => boolean
}

/** 页面贡献（04-01 第二类）。 */
export interface PageContribution {
  pageId: string
  /** 顶层路由片段；不能含查询串。 */
  route: string
  titleKey: string
  component: () => Promise<Component>
  defaultLayout?: LayoutBlueprint
  order: number
}

/** 页面默认布局蓝图：槽位 → 面板引用，内核在首次加载时转成布局树。 */
export interface LayoutBlueprint {
  /** 面板引用按槽位分组；顺序即标签顺序。 */
  slots: Partial<Record<SlotId, PanelRef[]>>
  /** 可选：该页根 split 方向（缺省 vertical，即上下分区）。 */
  orientation?: 'horizontal' | 'vertical'
}

/** 抽屉标签贡献（04-01 第三类）。 */
export interface DrawerTabContribution {
  tabId: string
  titleKey: string
  component: () => Promise<Component>
  order: number
  minHeight?: number
  keepAlive?: boolean
  available?: (ctx: PanelAvailabilityContext) => boolean
}

/** 菜单位置（命令贡献用）。 */
export interface MenuPlacement {
  menu: 'file' | 'edit' | 'view' | 'help'
  group?: string
  order: number
}

/** 命令贡献（04-01 第四类）。 */
export interface CommandContribution {
  commandId: string
  titleKey: string
  category: string
  run: (ctx: CommandContext) => void | Promise<void>
  enabled?: (ctx: CommandContext) => boolean
  checked?: (ctx: CommandContext) => boolean
  menu?: MenuPlacement
  /** 只进入命令面板，不进入菜单栏。 */
  commandPaletteOnly?: boolean
  /** 默认 chord；用户可在设置页覆盖。 */
  keybinding?: string
  /** 默认 chord 的作用域；缺省 `global`。 */
  keybindingScope?: KeyScope
}

/** 状态区条目贡献（04-01 第五类）。 */
export interface StatusItemContribution {
  itemId: string
  align: 'left' | 'right'
  order: number
  text?: (ctx: StatusContext) => string
  component?: () => Promise<Component>
  commandId?: string
  severity?: (ctx: StatusContext) => 'normal' | 'warning' | 'error'
}

/** 状态区求值上下文（只读）。 */
export interface StatusContext {
  pageId: string
  /** 状态条目自己拼文案用；语言切换时状态区会重渲染。 */
  t(key: string, params?: Record<string, string | number>): string
  documentOpen: boolean
  documentDirty: boolean
  connected: boolean
  issueCount: number
  pluginErrorCount: number
  presetId: string
}

/** 设置分区可见级别：默认显示 / 高级 / 实验。 */
export const SETTINGS_VISIBILITY_LEVELS = ['standard', 'advanced', 'experimental'] as const

export type SettingsVisibility = (typeof SETTINGS_VISIBILITY_LEVELS)[number]

export const DEFAULT_SETTINGS_VISIBILITY: SettingsVisibility = 'standard'

/** 设置分区作用对象；只表达影响范围，不表达存储位置。 */
export const SETTINGS_SCOPES = ['application', 'project'] as const

export type SettingsScope = (typeof SETTINGS_SCOPES)[number]

export const DEFAULT_SETTINGS_SCOPE: SettingsScope = 'application'

/** 设置分区贡献（04-01 第六类）。 */
export interface SettingsContribution {
  sectionId: string
  titleKey: string
  order: number
  component: () => Promise<Component>
  /** 缺省 standard。 */
  visibility?: SettingsVisibility
  /** 缺省 application。 */
  scope?: SettingsScope
  /** 搜索补充词；与标题、titleKey、sectionId、pluginId 一起匹配。 */
  searchKeywords?: readonly string[]
}

/** 七类贡献的集合。 */
export interface PluginContributions {
  panels?: PanelContribution[]
  pages?: PageContribution[]
  drawerTabs?: DrawerTabContribution[]
  commands?: CommandContribution[]
  statusItems?: StatusItemContribution[]
  settings?: SettingsContribution[]
  themes?: ThemeContribution[]
}

/** 插件 manifest。 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: PluginApiVersion
  /** 依赖的 pluginId，按拓扑排序激活。 */
  requires?: string[]
  contributes: PluginContributions
  activate: (ctx: PluginContext) => void | Promise<void>
}

/** 贡献类型名（诊断用）。 */
export type ContributionKind =
  | 'panel'
  | 'page'
  | 'drawerTab'
  | 'command'
  | 'statusItem'
  | 'settings'
  | 'theme'

/** 一个已注册贡献（内核记录来源用）。 */
export interface RegisteredContribution<T> {
  pluginId: string
  kind: ContributionKind
  id: string
  contribution: T
}
