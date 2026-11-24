/**
 * 应用偏好（04-08）。
 *
 * 四个存储分开：`preferences.json`（本文件）、`layout.json`（04-02）、
 * `window-state.json`（04-09）、`drafts/`（04-09）。坏一个只恢复一个。
 */
import type { ThemePreference } from './theme.ts'

/** 语言。 */
export type Language = 'zh_cn' | 'en_us'

/** 界面密度。 */
export type Density = 'comfortable' | 'compact'

/** 快捷键覆盖：只存 commandId + chord（scope 由命令定义固定）。 */
export interface KeybindingOverride {
  commandId: string
  /** `''` 表示显式解绑；缺省 / 空数组表示没有覆盖。 */
  chord: string
}

/** 最近项目。 */
export interface RecentProject {
  /** 绝对路径；不存脚本内容。 */
  path: string
  name: string
  kind: 'folder' | 'script'
  /** ISO 时间。 */
  lastOpenedAt: string
  /** 加载时探测，不持久化删除。 */
  missing?: boolean
}

/** 设置页状态。 */
export interface PreferencesSettingsState {
  lastSectionId?: string
  showStatusBar?: boolean
  confirmOnClose?: boolean
  /** 最近一次完整完成的引导版本；缺省 / 0 表示从未完成。 */
  onboardingVersion?: number
  /** 用户跳过或直接关闭过自动引导；true 时不再自动打开，命令仍可重开。 */
  onboardingDismissed?: boolean
}

/** 当前引导版本；改版引导时递增。 */
export const ONBOARDING_VERSION = 1

/** 插件作用域偏好值。 */
export type PluginPreferenceValue = string | number | boolean

/** `preferences.json`。 */
export interface PreferencesFile {
  version: 1
  theme: ThemePreference
  language: Language
  density: Density
  shortcuts: KeybindingOverride[]
  recentProjects: RecentProject[]
  settings: PreferencesSettingsState
  /** 插件自己的偏好键（04-08：插件只能读写自己的段）。 */
  plugins?: Record<string, Record<string, PluginPreferenceValue>>
}

/** 可分项重置的键。 */
export type PreferencesSection =
  | 'theme'
  | 'language'
  | 'density'
  | 'shortcuts'
  | 'recentProjects'
  | 'settings'
  | 'plugins'

/** 偏好服务（渲染进程只经 `PreferencesPort` 落盘）。 */
export interface PreferencesApi {
  get(): Readonly<PreferencesFile>
  getSection<K extends keyof PreferencesFile>(key: K): PreferencesFile[K]
  setSection<K extends keyof PreferencesFile>(key: K, value: PreferencesFile[K]): void
  patch(partial: Partial<PreferencesFile>): void
  resetSection(key: PreferencesSection): void
  resetAll(): void
  subscribe(listener: (next: PreferencesFile) => void): () => void
  /** 立即落盘（防抖之外的显式入口）。 */
  flush(): Promise<void>
  /** 插件自己的偏好段（只读副本）。 */
  pluginValues(pluginId: string): Record<string, PluginPreferenceValue>
  /** 写一个插件偏好键；不碰其他插件的段。 */
  setPluginValue(pluginId: string, key: string, value: PluginPreferenceValue): void
  /** 清空单个插件的偏好段。 */
  resetPluginValues(pluginId: string): void
}

/** 最近项目上限（04-08）。 */
export const RECENT_PROJECTS_LIMIT = 20

/** 偏好文件大小上限（字节）。 */
export const PREFERENCES_MAX_BYTES = 512 * 1024

/** 布局文件大小上限（字节）。 */
export const LAYOUT_MAX_BYTES = 1024 * 1024

/** 单条草稿大小上限（字节）。 */
export const DRAFT_MAX_BYTES = 5 * 1024 * 1024

/** 草稿条数上限。 */
export const DRAFT_MAX_COUNT = 50

/** 主题文件大小上限（字节）。 */
export const THEME_MAX_BYTES = 256 * 1024
