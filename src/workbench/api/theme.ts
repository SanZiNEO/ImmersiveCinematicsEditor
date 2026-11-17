/**
 * 主题模型（04-07）。
 *
 * 主题是纯数据：只描述 CSS 变量值，不执行代码、不加载远程资源。
 * 核心 token 缺失时从同 appearance 的内置基础主题继承；颜色只接受 CSS 字面量。
 */

/** 主题外观。 */
export type ThemeAppearance = 'dark' | 'light' | 'high-contrast'

/** 核心 token（必需）：17 个。 */
export const CORE_THEME_TOKENS = [
  'bg-app',
  'bg-panel',
  'bg-raised',
  'bg-hover',
  'bg-selected',
  'text',
  'text-secondary',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'focus',
  'success',
  'warning',
  'error',
  'error-bg',
  'selection-outline',
] as const

export type CoreThemeToken = (typeof CORE_THEME_TOKENS)[number]

/** 可选 token。 */
export const OPTIONAL_THEME_TOKENS = [
  'shadow',
  'overlay',
  'scrollbar',
  'scrollbar-hover',
] as const

export type OptionalThemeToken = (typeof OPTIONAL_THEME_TOKENS)[number]

/** 轨道分类色（可选覆盖，不自动反色）。 */
export const TRACK_TOKENS = [
  'track.camera',
  'track.letterbox',
  'track.audio',
  'track.event',
  'track.mod_event',
  'track.overlay',
  'track.adjust',
] as const

export type TrackToken = (typeof TRACK_TOKENS)[number]

/** 语法色（仅只读文本着色，不引入语法高亮引擎）。 */
export const SYNTAX_TOKENS = [
  'syntax.keyword',
  'syntax.string',
  'syntax.number',
  'syntax.comment',
  'syntax.property',
  'syntax.punctuation',
  'syntax.invalid',
] as const

export type SyntaxToken = (typeof SYNTAX_TOKENS)[number]

/** 全部可覆盖 token（核心 + 可选）。用户覆盖只允许核心 token。 */
export const OVERRIDABLE_TOKENS = CORE_THEME_TOKENS

/** 主题 token 表：核心必需，可选部分缺省。 */
export type ThemeTokens = Record<CoreThemeToken, string> & Partial<Record<OptionalThemeToken, string>>

/** token → CSS 变量名（`bg-app` → `--bg-app`，`track.camera` → `--track-camera`）。 */
export function cssVarOf(token: string): string {
  return `--${token.replace(/\./g, '-')}`
}

/** 主题预览色块。 */
export interface ThemePreview {
  bg: string
  panel: string
  text: string
  accent: string
}

/** 一个主题包（纯数据）。 */
export interface ThemeDefinition {
  version: 1
  id: string
  label: string
  labelKey?: string
  appearance: ThemeAppearance
  tokens: Partial<ThemeTokens>
  syntaxTokens?: Partial<Record<SyntaxToken, string>>
  trackTokens?: Partial<Record<TrackToken, string>>
  preview?: ThemePreview
}

/** 主题来源。 */
export type ThemeSource = 'builtin' | 'plugin' | 'user'

/** 列表项（选择器用）。 */
export interface ThemeSummary {
  id: string
  label: string
  labelKey?: string
  appearance: ThemeAppearance
  source: ThemeSource
  pluginId?: string
  preview: ThemePreview
}

/** 跟随系统的三槽位（04-07）。 */
export interface ThemeSystemSlots {
  lightThemeId: string
  darkThemeId: string
  highContrastThemeId?: string
}

/** 主题偏好（存 preferences.json）。 */
export interface ThemePreference {
  mode: 'manual' | 'system'
  themeId: string
  system: ThemeSystemSlots
  /** 只允许核心 token。 */
  overrides: Record<string, string>
  /** 防白闪缓存：主进程启动时先写 CSS 变量再显示窗口。 */
  themeCache?: ThemeCache
}

/** 启动缓存（主进程 / preload 用；不含任何脚本字段）。 */
export interface ThemeCache {
  themeId: string
  appearance: ThemeAppearance
  bgApp: string
  tokens: ThemeTokens
}

/** 插件主题贡献（04-01 第七类）。 */export interface ThemeContribution {
  themeId: string
  labelKey: string
  appearance: ThemeAppearance
  /** 插件目录内 JSON 相对路径；不允许绝对路径 / `..` / 远程 URL。 */
  path: string
  preview?: ThemePreview
}

/** 系统外观事件。 */
export interface SystemThemeState {
  dark: boolean
  highContrast: boolean
}

/** 主题服务：解析 → 应用 token → 通知宿主。 */
export interface ThemeApi {
  current(): ThemeDefinition
  tokens(): Readonly<ThemeTokens>
  appearance(): ThemeAppearance
  subscribe(listener: (theme: ThemeDefinition) => void): () => void
}

/** 主题控制器：应用主题、切换模式、写覆盖（设置页与插件命令用）。 */
export interface ThemeControllerPort {
  apply(themeId: string): void
  mode(): 'manual' | 'system'
  setMode(mode: 'manual' | 'system'): void
  setTheme(themeId: string): void
  setSystemSlots(partial: Partial<ThemeSystemSlots>): void
  setOverride(token: string, value: string): void
  resetOverrides(): void
  applySystemState(state: SystemThemeState): void
  preference(): ThemePreference
}

/** 主题注册表（04-07）。 */
export interface ThemeRegistryPort {
  list(): ThemeSummary[]
  get(themeId: string): ThemeDefinition | undefined
  registerBuiltin(theme: ThemeDefinition): void
  registerContribution(pluginId: string, theme: ThemeDefinition): void
  importUserTheme(json: unknown): ThemeDefinition
  removeUserTheme(themeId: string): void
  /** 插件卸载 / 激活失败：移除该插件的全部主题贡献。 */
  disposePlugin(pluginId: string): void
  subscribe(listener: () => void): () => void
}
