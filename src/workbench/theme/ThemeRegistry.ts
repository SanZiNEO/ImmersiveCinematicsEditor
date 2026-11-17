/**
 * 主题注册表（04-07）。
 *
 * 主题是纯数据；注册表只做三件事：校验入表、按来源管理、为选择器提供列表。
 * 重复 ID 一律抛错（启动/加插件时暴露问题），非法主题只进诊断、不进列表。
 */
import type { DiagnosticSink, DiagnosticSeverity } from '../api/diagnostics.ts'
import { USER_THEME_PREFIX } from '../api/ids.ts'
import { THEME_MAX_BYTES } from '../api/preferences.ts'
import type {
  ThemeAppearance,
  ThemeDefinition,
  ThemePreview,
  ThemeRegistryPort,
  ThemeSource,
  ThemeSummary,
} from '../api/theme.ts'
import { BUILTIN_THEMES } from './builtinThemes.ts'
import { resolveTokens } from './inherit.ts'
import { validateTheme } from './validateTheme.ts'

/** 注册表依赖。 */
export interface ThemeRegistryOptions {
  diagnostics: DiagnosticSink
  now?: () => Date
}

interface RegisteredTheme {
  theme: ThemeDefinition
  source: ThemeSource
  pluginId?: string
}

const APPEARANCE_ORDER: readonly ThemeAppearance[] = ['dark', 'light', 'high-contrast'] as const

/** 主题注册表实现。构造时先注册三套内置主题。 */
export class ThemeRegistry implements ThemeRegistryPort {
  private readonly entries = new Map<string, RegisteredTheme>()
  private readonly listeners = new Set<() => void>()
  private readonly diagnostics: DiagnosticSink
  private readonly now: () => Date

  constructor(options: ThemeRegistryOptions) {
    this.diagnostics = options.diagnostics
    this.now = options.now ?? (() => new Date())
    for (const theme of BUILTIN_THEMES) {
      this.registerBuiltin(theme)
    }
  }

  list(): ThemeSummary[] {
    const summaries = [...this.entries.values()].map((entry) => this.summarize(entry))
    summaries.sort((left, right) => {
      const group =
        APPEARANCE_ORDER.indexOf(left.appearance) - APPEARANCE_ORDER.indexOf(right.appearance)
      return group !== 0 ? group : left.label.localeCompare(right.label)
    })
    return summaries
  }

  get(themeId: string): ThemeDefinition | undefined {
    return this.entries.get(themeId)?.theme
  }

  registerBuiltin(theme: ThemeDefinition): void {
    const result = validateTheme(theme)
    if (!result.ok || result.theme === undefined) {
      throw new Error(`内置主题无效：${result.issues.join('; ')}`)
    }
    this.add(result.theme, 'builtin')
  }

  registerContribution(pluginId: string, theme: ThemeDefinition): void {
    const result = validateTheme(theme)
    if (!result.ok || result.theme === undefined) {
      this.report('error', `插件主题无效：${result.issues.join('; ')}`, pluginId, result.issues)
      return
    }
    try {
      this.add(result.theme, 'plugin', pluginId)
    } catch (error) {
      this.report('error', error instanceof Error ? error.message : String(error), pluginId)
      throw error
    }
  }

  importUserTheme(json: unknown): ThemeDefinition {
    let input: unknown = json
    if (typeof json === 'string') {
      if (new TextEncoder().encode(json).length > THEME_MAX_BYTES) {
        throw new Error(`主题文件超过上限 ${THEME_MAX_BYTES} 字节`)
      }
      try {
        input = JSON.parse(json)
      } catch (error) {
        throw new Error(
          `主题 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const result = validateTheme(input, {
      idPrefix: USER_THEME_PREFIX,
      maxBytes: THEME_MAX_BYTES,
    })
    if (!result.ok || result.theme === undefined) {
      this.report('error', `用户主题无效：${result.issues.join('; ')}`, undefined, result.issues)
      throw new Error(`主题无效：${result.issues.join('; ')}`)
    }
    this.add(result.theme, 'user')
    return result.theme
  }

  removeUserTheme(themeId: string): void {
    if (!themeId.startsWith(USER_THEME_PREFIX)) {
      throw new Error(`只能移除 ${USER_THEME_PREFIX} 前缀的用户主题：${themeId}`)
    }
    const entry = this.entries.get(themeId)
    if (entry === undefined) {
      return
    }
    if (entry.source !== 'user') {
      throw new Error(`主题 ${themeId} 不是用户主题，不能移除`)
    }
    this.entries.delete(themeId)
    this.emit()
  }

  /** 插件卸载 / 激活失败：移除该插件的全部主题贡献。 */
  disposePlugin(pluginId: string): void {
    let changed = false
    for (const [themeId, entry] of this.entries) {
      if (entry.source === 'plugin' && entry.pluginId === pluginId) {
        this.entries.delete(themeId)
        changed = true
      }
    }
    if (changed) {
      this.emit()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private add(theme: ThemeDefinition, source: ThemeSource, pluginId?: string): void {
    const existing = this.entries.get(theme.id)
    if (existing !== undefined) {
      const existingLabel =
        existing.source === 'plugin' && existing.pluginId !== undefined
          ? `plugin:${existing.pluginId}`
          : existing.source
      const nextLabel = source === 'plugin' && pluginId !== undefined ? `plugin:${pluginId}` : source
      throw new Error(
        `主题 ID 重复：${theme.id}（已存在：${existingLabel}；新来源：${nextLabel}）`,
      )
    }
    this.entries.set(theme.id, {
      theme,
      source,
      ...(pluginId === undefined ? {} : { pluginId }),
    })
    this.emit()
  }

  private summarize(entry: RegisteredTheme): ThemeSummary {
    const { theme } = entry
    const preview = theme.preview ?? this.derivePreview(theme)
    return {
      id: theme.id,
      label: theme.label,
      ...(theme.labelKey === undefined ? {} : { labelKey: theme.labelKey }),
      appearance: theme.appearance,
      source: entry.source,
      ...(entry.pluginId === undefined ? {} : { pluginId: entry.pluginId }),
      preview: { ...preview },
    }
  }

  private derivePreview(theme: ThemeDefinition): ThemePreview {
    const tokens = resolveTokens(theme, this.baselineFor(theme.appearance))
    return {
      bg: tokens['bg-app'] ?? 'transparent',
      panel: tokens['bg-panel'] ?? 'transparent',
      text: tokens.text ?? 'transparent',
      accent: tokens.accent ?? 'transparent',
    }
  }

  private baselineFor(appearance: ThemeAppearance): ThemeDefinition | undefined {
    for (const entry of this.entries.values()) {
      if (entry.source === 'builtin' && entry.theme.appearance === appearance) {
        return entry.theme
      }
    }
    return undefined
  }

  private report(
    severity: DiagnosticSeverity,
    message: string,
    pluginId?: string,
    detail?: readonly string[],
  ): void {
    this.diagnostics.report({
      severity,
      source: 'theme',
      message,
      ...(pluginId === undefined ? {} : { pluginId }),
      detail:
        detail === undefined || detail.length === 0
          ? `主题注册表 ${this.now().toISOString()}`
          : `${detail.join('\n')}\n主题注册表 ${this.now().toISOString()}`,
    })
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
