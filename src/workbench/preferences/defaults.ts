/**
 * 偏好默认值与规范化（04-08）。
 *
 * 规则：
 * - `version` 不是 1 → 备份标记 + 默认；
 * - 未知顶层键原样保留（写入时再合并回去）；
 * - 已知键类型不符 → 该键回默认并收集 issue；
 * - `recentProjects` 最多 20 条、按路径去重、按时间倒序；
 * - `plugins` 段按插件隔离，只接受 string/number/boolean，非法值丢弃并记 issue。
 */
import { CORE_THEME_TOKENS, OPTIONAL_THEME_TOKENS } from '../api/theme.ts'
import type { ThemeAppearance, ThemeCache, ThemePreference, ThemeTokens } from '../api/theme.ts'
import type {
  Density,
  KeybindingOverride,
  Language,
  PreferencesFile,
  PluginPreferenceValue,
  PreferencesSettingsState,
  RecentProject,
} from '../api/preferences.ts'
import { BUILTIN_THEME_IDS } from '../theme/builtinThemes.ts'
import { isColorLiteral } from '../theme/color.ts'
import { normalizeRecentList } from './recentProjects.ts'

/** 按插件分组的偏好段。 */
export type PluginPreferences = Record<string, Record<string, PluginPreferenceValue>>

/** 语言枚举。 */
export const LANGUAGES: readonly Language[] = ['zh_cn', 'en_us'] as const

/** 密度枚举。 */
export const DENSITIES: readonly Density[] = ['comfortable', 'compact'] as const

const APPEARANCES: readonly ThemeAppearance[] = ['dark', 'light', 'high-contrast'] as const
const KNOWN_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  ['version', 'theme', 'language', 'density', 'shortcuts', 'recentProjects', 'settings', 'plugins'].map(
    (key) => [key, true],
  ),
)
const CORE_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  CORE_THEME_TOKENS.map((token) => [token, true]),
)
const OPTIONAL_KEYS: Readonly<Record<string, true>> = Object.fromEntries(
  OPTIONAL_THEME_TOKENS.map((token) => [token, true]),
)

/** 主题偏好默认值。 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: 'manual',
  themeId: BUILTIN_THEME_IDS.dark,
  system: {
    lightThemeId: BUILTIN_THEME_IDS.light,
    darkThemeId: BUILTIN_THEME_IDS.dark,
    highContrastThemeId: BUILTIN_THEME_IDS['high-contrast'],
  },
  overrides: {},
}

/** 偏好默认值。 */
export const DEFAULT_PREFERENCES: PreferencesFile = {
  version: 1,
  theme: cloneThemePreference(DEFAULT_THEME_PREFERENCE),
  language: 'zh_cn',
  density: 'comfortable',
  shortcuts: [],
  recentProjects: [],
  settings: {
    showStatusBar: true,
    confirmOnClose: true,
  },
  plugins: {},
}

/** 规范化结果。 */
export interface NormalizedPreferences {
  preferences: PreferencesFile
  issues: string[]
  /** 根结构/version 不可信，调用方应备份原文件。 */
  needsBackup: boolean
  /** 未知顶层键，写回时合并，避免“多一个键就丢整份偏好”。 */
  extras: Record<string, unknown>
}

/** 把插件段挂回偏好对象。 */
export function withPluginPreferences(
  file: PreferencesFile,
  plugins: PluginPreferences,
): PreferencesFile {
  return { ...file, plugins }
}

/** 读取偏好里的插件段。 */
export function pluginPreferencesOf(preferences: PreferencesFile): PluginPreferences {
  return preferences.plugins ?? {}
}

/** 深拷贝插件段。 */
export function clonePluginPreferences(plugins: PluginPreferences | undefined): PluginPreferences {
  const copy: PluginPreferences = {}
  for (const [pluginId, values] of Object.entries(plugins ?? {})) {
    copy[pluginId] = { ...values }
  }
  return copy
}

/** 深拷贝主题偏好。 */
export function cloneThemePreference(theme: ThemePreference): ThemePreference {
  return {
    mode: theme.mode,
    themeId: theme.themeId,
    system: { ...theme.system },
    overrides: { ...theme.overrides },
    ...(theme.themeCache === undefined
      ? {}
      : {
          themeCache: {
            themeId: theme.themeCache.themeId,
            appearance: theme.themeCache.appearance,
            bgApp: theme.themeCache.bgApp,
            tokens: { ...theme.themeCache.tokens },
          },
        }),
  }
}

/** 深拷贝偏好。 */
export function clonePreferences(preferences: PreferencesFile): PreferencesFile {
  return withPluginPreferences(
    {
      version: 1,
      theme: cloneThemePreference(preferences.theme),
      language: preferences.language,
      density: preferences.density,
      shortcuts: preferences.shortcuts.map((entry) => ({ ...entry })),
      recentProjects: preferences.recentProjects.map((entry) => ({ ...entry })),
      settings: { ...preferences.settings },
    },
    clonePluginPreferences(pluginPreferencesOf(preferences)),
  )
}

function isPluginValue(value: unknown): value is PluginPreferenceValue {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizePluginPreferences(value: unknown, issues: string[]): PluginPreferences {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push('plugins 不是对象，已清空')
    return {}
  }
  const plugins: PluginPreferences = {}
  for (const [pluginId, rawValues] of Object.entries(value)) {
    if (pluginId.length === 0) {
      issues.push('plugins 含空插件 ID，已忽略')
      continue
    }
    if (typeof rawValues !== 'object' || rawValues === null || Array.isArray(rawValues)) {
      issues.push(`plugins.${pluginId} 不是对象，已忽略`)
      continue
    }
    const bucket: Record<string, PluginPreferenceValue> = {}
    for (const [key, raw] of Object.entries(rawValues)) {
      if (!isPluginValue(raw)) {
        issues.push(`plugins.${pluginId}.${key} 类型非法，已忽略`)
        continue
      }
      bucket[key] = raw
    }
    if (Object.keys(bucket).length > 0) {
      plugins[pluginId] = bucket
    }
  }
  return plugins
}

function normalizeThemeCache(value: unknown): ThemeCache | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const themeId = typeof record.themeId === 'string' ? record.themeId.trim() : ''
  const appearance = record.appearance
  if (themeId.length === 0) {
    return null
  }
  if (typeof appearance !== 'string' || !APPEARANCES.includes(appearance as ThemeAppearance)) {
    return null
  }
  if (!isColorLiteral(record.bgApp)) {
    return null
  }
  if (typeof record.tokens !== 'object' || record.tokens === null || Array.isArray(record.tokens)) {
    return null
  }
  const rawTokens = record.tokens as Record<string, unknown>
  const tokens: Partial<ThemeTokens> = {}
  for (const key of Object.keys(CORE_KEYS)) {
    if (!isColorLiteral(rawTokens[key])) {
      return null
    }
    ;(tokens as Record<string, string>)[key] = (rawTokens[key] as string).trim()
  }
  for (const key of Object.keys(OPTIONAL_KEYS)) {
    if (rawTokens[key] === undefined) {
      continue
    }
    if (!isColorLiteral(rawTokens[key])) {
      return null
    }
    ;(tokens as Record<string, string>)[key] = (rawTokens[key] as string).trim()
  }
  return {
    themeId,
    appearance: appearance as ThemeAppearance,
    bgApp: (record.bgApp as string).trim(),
    tokens: tokens as ThemeTokens,
  }
}

interface ThemeNormalization {
  theme: ThemePreference
  issues: string[]
}

function normalizeThemePreference(value: unknown): ThemeNormalization {
  const issues: string[] = []
  const fallback = cloneThemePreference(DEFAULT_THEME_PREFERENCE)
  if (value === undefined) {
    return { theme: fallback, issues }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { theme: fallback, issues: ['theme 不是对象，已回默认主题偏好'] }
  }
  const record = value as Record<string, unknown>
  const mode = record.mode
  const themeId = typeof record.themeId === 'string' ? record.themeId.trim() : ''
  const systemSource =
    typeof record.system === 'object' && record.system !== null && !Array.isArray(record.system)
      ? (record.system as Record<string, unknown>)
      : null
  if (systemSource === null) {
    issues.push('theme.system 缺失或不是对象，已回默认槽位')
  }
  const system = {
    lightThemeId: readSlotId(systemSource, 'lightThemeId', fallback.system.lightThemeId, issues),
    darkThemeId: readSlotId(systemSource, 'darkThemeId', fallback.system.darkThemeId, issues),
  } as ThemePreference['system']
  const highContrastThemeId = readOptionalSlotId(
    systemSource,
    'highContrastThemeId',
    fallback.system.highContrastThemeId,
    issues,
  )
  if (highContrastThemeId !== undefined) {
    system.highContrastThemeId = highContrastThemeId
  }
  if (mode !== 'manual' && mode !== 'system') {
    issues.push('theme.mode 非法，已回 manual')
  }
  if (themeId.length === 0) {
    issues.push('theme.themeId 非法，已回默认主题')
  }
  const overrides = normalizeOverrides(record.overrides, issues)
  const themeCache = normalizeThemeCache(record.themeCache)
  if (record.themeCache !== undefined && themeCache === null) {
    issues.push('theme.themeCache 非法，已丢弃')
  }
  return {
    theme: {
      mode: mode === 'manual' || mode === 'system' ? mode : fallback.mode,
      themeId: themeId.length > 0 ? themeId : fallback.themeId,
      system,
      overrides,
      ...(themeCache === null ? {} : { themeCache }),
    },
    issues,
  }
}

function readSlotId(
  source: Record<string, unknown> | null,
  key: 'lightThemeId' | 'darkThemeId',
  fallback: string,
  issues: string[],
): string {
  if (source === null || source[key] === undefined) {
    return fallback
  }
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`theme.system.${key} 非法，已回默认`)
    return fallback
  }
  return value.trim()
}

function readOptionalSlotId(
  source: Record<string, unknown> | null,
  key: 'highContrastThemeId',
  fallback: string | undefined,
  issues: string[],
): string | undefined {
  if (source === null || source[key] === undefined) {
    return fallback
  }
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`theme.system.${key} 非法，已回默认`)
    return fallback
  }
  return value.trim()
}

function normalizeOverrides(value: unknown, issues: string[]): Record<string, string> {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push('theme.overrides 不是对象，已清空')
    return {}
  }
  const overrides: Record<string, string> = {}
  for (const [token, raw] of Object.entries(value)) {
    if (!Object.hasOwn(CORE_KEYS, token)) {
      issues.push(`theme.overrides 只允许核心 token，已忽略 ${token}`)
      continue
    }
    if (!isColorLiteral(raw)) {
      issues.push(`theme.overrides.${token} 颜色非法，已忽略`)
      continue
    }
    overrides[token] = raw.trim()
  }
  return overrides
}

function normalizeShortcuts(value: unknown, issues: string[]): KeybindingOverride[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    issues.push('shortcuts 不是数组，已清空')
    return []
  }
  const entries = new Map<string, KeybindingOverride>()
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      issues.push('shortcuts 含非对象条目，已忽略')
      continue
    }
    const record = raw as Record<string, unknown>
    const commandId = typeof record.commandId === 'string' ? record.commandId.trim() : ''
    const chord = typeof record.chord === 'string' ? record.chord.trim() : ''
    if (commandId.length === 0 || typeof record.chord !== 'string') {
      issues.push('shortcuts 条目缺少 commandId/chord，已忽略')
      continue
    }
    entries.set(commandId, { commandId, chord })
  }
  return [...entries.values()]
}

function normalizeSettings(value: unknown, issues: string[]): PreferencesSettingsState {
  if (value === undefined) {
    return { ...DEFAULT_PREFERENCES.settings }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push('settings 不是对象，已回默认')
    return { ...DEFAULT_PREFERENCES.settings }
  }
  const record = value as Record<string, unknown>
  const settings: PreferencesSettingsState = {
    showStatusBar: DEFAULT_PREFERENCES.settings.showStatusBar,
    confirmOnClose: DEFAULT_PREFERENCES.settings.confirmOnClose,
  }
  if (record.showStatusBar !== undefined) {
    if (typeof record.showStatusBar === 'boolean') {
      settings.showStatusBar = record.showStatusBar
    } else {
      issues.push('settings.showStatusBar 类型错误，已回默认')
    }
  }
  if (record.confirmOnClose !== undefined) {
    if (typeof record.confirmOnClose === 'boolean') {
      settings.confirmOnClose = record.confirmOnClose
    } else {
      issues.push('settings.confirmOnClose 类型错误，已回默认')
    }
  }
  if (record.lastSectionId !== undefined) {
    if (typeof record.lastSectionId === 'string' && record.lastSectionId.length > 0) {
      settings.lastSectionId = record.lastSectionId
    } else {
      issues.push('settings.lastSectionId 类型错误，已忽略')
    }
  }
  if (record.onboardingVersion !== undefined) {
    if (typeof record.onboardingVersion === 'number' && Number.isFinite(record.onboardingVersion)) {
      settings.onboardingVersion = record.onboardingVersion
    } else {
      issues.push('settings.onboardingVersion 类型错误，已忽略')
    }
  }
  if (record.onboardingDismissed !== undefined) {
    if (typeof record.onboardingDismissed === 'boolean') {
      settings.onboardingDismissed = record.onboardingDismissed
    } else {
      issues.push('settings.onboardingDismissed 类型错误，已忽略')
    }
  }
  return settings
}

/** 规范化任意持久化输入。 */
export function normalizePreferences(input: unknown): NormalizedPreferences {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      preferences: clonePreferences(DEFAULT_PREFERENCES),
      issues: ['偏好文件不是对象，已使用默认值'],
      needsBackup: true,
      extras: {},
    }
  }
  const record = input as Record<string, unknown>
  if (record.version !== 1) {
    return {
      preferences: clonePreferences(DEFAULT_PREFERENCES),
      issues: [`不支持的 preferences version：${String(record.version)}，已备份并回默认`],
      needsBackup: true,
      extras: {},
    }
  }

  const issues: string[] = []
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!Object.hasOwn(KNOWN_KEYS, key)) {
      extras[key] = value
    }
  }

  const theme = normalizeThemePreference(record.theme)
  issues.push(...theme.issues)

  const language = record.language
  if (language !== undefined && !LANGUAGES.includes(language as Language)) {
    issues.push(`language 非法：${String(language)}，已回 zh_cn`)
  }
  const density = record.density
  if (density !== undefined && !DENSITIES.includes(density as Density)) {
    issues.push(`density 非法：${String(density)}，已回 comfortable`)
  }
  const shortcuts = normalizeShortcuts(record.shortcuts, issues)
  let recentProjects: RecentProject[] = []
  if (record.recentProjects !== undefined) {
    const recent = normalizeRecentList(record.recentProjects)
    recentProjects = recent.list
    issues.push(...recent.issues)
  }
  const settings = normalizeSettings(record.settings, issues)
  const plugins = normalizePluginPreferences(record.plugins, issues)

  return {
    preferences: withPluginPreferences(
      {
        version: 1,
        theme: theme.theme,
        language:
          language !== undefined && LANGUAGES.includes(language as Language)
            ? (language as Language)
            : DEFAULT_PREFERENCES.language,
        density:
          density !== undefined && DENSITIES.includes(density as Density)
            ? (density as Density)
            : DEFAULT_PREFERENCES.density,
        shortcuts,
        recentProjects,
        settings,
      },
      plugins,
    ),
    issues,
    needsBackup: false,
    extras,
  }
}

/** 合并偏好：theme 整体替换，plugins/settings 浅合并，数组/标量替换。 */
export function mergePreferences(
  base: PreferencesFile,
  partial: Partial<PreferencesFile>,
): PreferencesFile {
  let next = clonePreferences(base)
  if (partial.version !== undefined) {
    next.version = partial.version
  }
  if (partial.theme !== undefined) {
    next.theme = cloneThemePreference(partial.theme)
  }
  if (partial.language !== undefined) {
    next.language = partial.language
  }
  if (partial.density !== undefined) {
    next.density = partial.density
  }
  if (partial.shortcuts !== undefined) {
    next.shortcuts = partial.shortcuts.map((entry) => ({ ...entry }))
  }
  if (partial.recentProjects !== undefined) {
    next.recentProjects = partial.recentProjects.map((entry) => ({ ...entry }))
  }
  if (partial.settings !== undefined) {
    next.settings = { ...next.settings, ...partial.settings }
  }
  if (partial.plugins !== undefined) {
    const merged = clonePluginPreferences(pluginPreferencesOf(next))
    for (const [pluginId, values] of Object.entries(partial.plugins)) {
      merged[pluginId] = { ...(merged[pluginId] ?? {}), ...values }
    }
    next = withPluginPreferences(next, merged)
  }
  return next
}
