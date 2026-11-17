/**
 * 各类贡献注册表端口（04-01）。
 *
 * 注册只在插件 `activate` 成功之后发生；`disposePlugin` 用于插件卸载 / 卸载失败回退。
 */
import type {
  DrawerTabContribution,
  PanelContribution,
  PageContribution,
  SettingsContribution,
  StatusItemContribution,
} from './contributions.ts'
import type { PanelRef, SlotId } from './ids.ts'

/** 已注册面板。 */
export interface RegisteredPanel {
  pluginId: string
  contribution: PanelContribution
}

/** 面板注册表：宿主解析 `pluginId + panelId` 的唯一来源。 */
export interface PanelRegistry {
  register(pluginId: string, contribution: PanelContribution): void
  get(pluginId: string, panelId: string): PanelContribution | undefined
  /** 该面板是否已注册（布局缺失占位判定用）。 */
  has(ref: PanelRef): boolean
  list(): RegisteredPanel[]
  /** 某槽位的面板，按 `order` 排序。 */
  bySlot(slot: SlotId): RegisteredPanel[]
  subscribe(listener: () => void): () => void
  disposePlugin(pluginId: string): void
}

/** 已注册页面。 */
export interface RegisteredPage {
  pluginId: string
  contribution: PageContribution
}

/** 页面注册表。 */
export interface PageRegistry {
  register(pluginId: string, contribution: PageContribution): void
  get(pageId: string): RegisteredPage | undefined
  list(): RegisteredPage[]
  subscribe(listener: () => void): () => void
  disposePlugin(pluginId: string): void
}

/** 已注册抽屉标签。 */
export interface RegisteredDrawerTab {
  pluginId: string
  contribution: DrawerTabContribution
}

/** 抽屉标签注册表。 */
export interface DrawerTabRegistry {
  register(pluginId: string, contribution: DrawerTabContribution): void
  get(tabId: string): RegisteredDrawerTab | undefined
  list(): RegisteredDrawerTab[]
  subscribe(listener: () => void): () => void
  disposePlugin(pluginId: string): void
}

/** 已注册状态项。 */
export interface RegisteredStatusItem {
  pluginId: string
  contribution: StatusItemContribution
}

/** 状态区注册表。 */
export interface StatusItemRegistry {
  register(pluginId: string, contribution: StatusItemContribution): void
  list(): RegisteredStatusItem[]
  subscribe(listener: () => void): () => void
  disposePlugin(pluginId: string): void
}

/** 已注册设置分区。 */
export interface RegisteredSettingsSection {
  pluginId: string
  contribution: SettingsContribution
}

/** 设置分区注册表。 */
export interface SettingsRegistry {
  register(pluginId: string, contribution: SettingsContribution): void
  list(): RegisteredSettingsSection[]
  subscribe(listener: () => void): () => void
  disposePlugin(pluginId: string): void
}

/** 页面路由端口（内存状态，不依赖 URL path）。 */
export interface PageRouter {
  currentPageId: string
  currentParams(): Record<string, string>
  navigate(pageId: string, params?: Record<string, string>): void
  back(): void
  canBack(): boolean
  /** 清空栈并回到指定页（关闭文档 / 重置会话用）。 */
  reset(pageId: string, params?: Record<string, string>): void
  subscribe(listener: (pageId: string) => void): () => void
}
