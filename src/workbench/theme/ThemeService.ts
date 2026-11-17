/**
 * 主题服务（04-07）。
 *
 * 解析主题 → 继承同 appearance 基础主题 → 应用用户覆盖 → 写根 CSS 变量
 * → 通知宿主更新 `themeSource` / 窗口底色 → 更新防白闪缓存。
 *
 * 纯逻辑：除 `applyToDocument` 一处受控 DOM 写入外不接触文档、不 import 任何
 * `core/doc` 模块；主题切换不会弄脏脚本。
 */
import type { DiagnosticSink, DiagnosticSeverity } from '../api/diagnostics.ts'
import type { ThemeHostPort } from '../api/host.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import {
  CORE_THEME_TOKENS,
  OPTIONAL_THEME_TOKENS,
  OVERRIDABLE_TOKENS,
  cssVarOf,
} from '../api/theme.ts'
import type {
  CoreThemeToken,
  SyntaxToken,
  SystemThemeState,
  ThemeApi,
  ThemeAppearance,
  ThemeCache,
  ThemeControllerPort,
  ThemeDefinition,
  ThemePreference,
  ThemeRegistryPort,
  ThemeSystemSlots,
  ThemeTokens,
  TrackToken,
} from '../api/theme.ts'
import { BUILTIN_THEME_IDS, BUILTIN_THEMES } from './builtinThemes.ts'
import { isColorLiteral } from './color.ts'
import { missingCoreTokens, resolveTokens } from './inherit.ts'

/** `document.documentElement.style` 的最小面。 */
export interface ThemeStyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
}

/** `document.documentElement` 的最小面。 */
export interface ThemeDocumentElementTarget {
  readonly style: ThemeStyleTarget
  setAttribute(name: string, value: string): void
}

/** 主题服务写入 DOM 的最小面；verify 用假对象断言变量。 */
export interface ThemeDocumentTarget {
  readonly documentElement: ThemeDocumentElementTarget
}

/** 主题服务依赖。 */
export interface ThemeServiceOptions {
  registry: ThemeRegistryPort
  host: ThemeHostPort
  preferences: PreferencesApi
  diagnostics: DiagnosticSink
}

interface AppliedTheme {
  theme: ThemeDefinition
  tokens: ThemeTokens
  trackTokens: Partial<Record<TrackToken, string>>
  syntaxTokens: Partial<Record<SyntaxToken, string>>
}

/** 主题服务实现。 */
export class ThemeService implements ThemeApi, ThemeControllerPort {
  private readonly registry: ThemeRegistryPort
  private readonly host: ThemeHostPort
  private readonly preferences: PreferencesApi
  private readonly diagnostics: DiagnosticSink
  private readonly listeners = new Set<(theme: ThemeDefinition) => void>()
  private readonly unsubscribeSystem: () => void
  private readonly unsubscribeRegistry: () => void
  private systemState: SystemThemeState
  private applied: AppliedTheme
  private appliedVarNames: string[] = []

  constructor(options: ThemeServiceOptions) {
    this.registry = options.registry
    this.host = options.host
    this.preferences = options.preferences
    this.diagnostics = options.diagnostics

    let cached: ThemeCache | null = null
    try {
      cached = this.host.initialTheme()
    } catch {
      cached = null
    }
    this.systemState =
      cached === null
        ? { dark: true, highContrast: false }
        : { dark: cached.appearance !== 'light', highContrast: cached.appearance === 'high-contrast' }
    this.applied = this.initialApplied()

    try {
      this.unsubscribeSystem = this.host.onSystemChange((state) => this.applySystemState(state))
    } catch (error) {
      this.unsubscribeSystem = () => {}
      this.report('warning', `订阅系统外观失败：${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      this.unsubscribeRegistry = this.registry.subscribe(() => this.handleRegistryChange())
    } catch (error) {
      this.unsubscribeRegistry = () => {}
      this.report('warning', `订阅主题注册表失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  current(): ThemeDefinition {
    return this.applied.theme
  }

  tokens(): Readonly<ThemeTokens> {
    return this.applied.tokens
  }

  appearance(): ThemeAppearance {
    return this.applied.theme.appearance
  }

  subscribe(listener: (theme: ThemeDefinition) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 应用一个具体主题；成功后切到 manual 并写缓存。失败保留原主题并诊断。 */
  apply(themeId: string): ThemeDefinition {
    const theme = this.registry.get(themeId)
    if (theme === undefined) {
      this.report('error', `主题不存在：${themeId}`)
      return this.applied.theme
    }
    const pref = this.themePreference()
    const next = this.tryActivate(theme, pref.overrides)
    if (next === null) {
      return this.applied.theme
    }
    this.persistTheme({
      ...pref,
      mode: 'manual',
      themeId: theme.id,
      themeCache: this.cacheOf(next),
    })
    return next.theme
  }

  /** 当前模式（设置页显示“跟随系统”开关用）。 */
  mode(): 'manual' | 'system' {
    return this.themePreference().mode
  }

  /** 只应用不改变持久选择（控制器端口别名）。 */
  setTheme(themeId: string): void {
    this.apply(themeId)
  }

  /** 当前偏好快照（只读用途）。 */
  preference(): ThemePreference {
    return this.themePreference()
  }

  /** 切换手选/跟随系统。 */
  setMode(mode: 'manual' | 'system'): void {
    const pref = this.themePreference()
    if (mode === 'system') {
      const theme = this.registry.get(this.slotThemeId(pref, this.systemState))
      if (theme === undefined) {
        this.report('error', '跟随系统：槽位主题缺失')
        return
      }
      const next = this.tryActivate(theme, pref.overrides)
      if (next === null) {
        return
      }
      this.persistTheme({ ...pref, mode: 'system', themeCache: this.cacheOf(next) })
      return
    }
    const theme = this.registry.get(pref.themeId)
    if (theme === undefined) {
      this.report('error', `手选主题不存在：${pref.themeId}`)
      return
    }
    const next = this.tryActivate(theme, pref.overrides)
    if (next === null) {
      return
    }
    this.persistTheme({
      ...pref,
      mode: 'manual',
      themeId: theme.id,
      themeCache: this.cacheOf(next),
    })
  }

  /** 设置跟随系统的浅色/深色/高对比槽位；只接受 appearance 匹配的主题。 */
  setSystemSlots(partial: Partial<ThemeSystemSlots>): void {
    const pref = this.themePreference()
    const system: ThemeSystemSlots = { ...pref.system }
    let changed = false
    for (const slot of ['lightThemeId', 'darkThemeId', 'highContrastThemeId'] as const) {
      const value = partial[slot]
      if (value === undefined) {
        if (slot === 'highContrastThemeId' && system.highContrastThemeId !== undefined) {
          delete system.highContrastThemeId
          changed = true
        }
        continue
      }
      if (typeof value !== 'string' || value.length === 0) {
        this.report('warning', `系统主题槽位 ${slot} 的值非法`)
        continue
      }
      const theme = this.registry.get(value)
      if (theme === undefined) {
        this.report('warning', `系统主题槽位 ${slot} 指向不存在的主题：${value}`)
        continue
      }
      const expected: ThemeAppearance =
        slot === 'lightThemeId' ? 'light' : slot === 'darkThemeId' ? 'dark' : 'high-contrast'
      if (theme.appearance !== expected) {
        this.report('warning', `主题 ${value} 的 appearance 与槽位 ${slot} 不匹配`)
        continue
      }
      if (slot === 'highContrastThemeId') {
        system.highContrastThemeId = value
      } else {
        system[slot] = value
      }
      changed = true
    }
    if (!changed) {
      return
    }
    this.persistTheme({ ...pref, system })
    if (pref.mode === 'system') {
      this.applySystemState(this.systemState)
    }
  }

  /** 设置单个核心 token 覆盖；空字符串表示移除。非法值拒绝并诊断。 */
  setOverride(token: string, value: string): boolean {
    const pref = this.themePreference()
    if (!(OVERRIDABLE_TOKENS as readonly string[]).includes(token)) {
      this.report('warning', `token 覆盖只允许核心 token：${token}`)
      return false
    }
    if (value !== '' && !isColorLiteral(value)) {
      this.report('warning', `token 覆盖值非法：${token}=${value}`)
      return false
    }
    const overrides: Record<string, string> = { ...pref.overrides }
    if (value === '') {
      delete overrides[token]
    } else {
      overrides[token] = value.trim()
    }
    const next = this.tryActivate(this.applied.theme, overrides)
    if (next === null) {
      return false
    }
    this.persistTheme({ ...pref, overrides, themeCache: this.cacheOf(next) })
    return true
  }

  /** 清空全部 token 覆盖。 */
  resetOverrides(): void {
    const pref = this.themePreference()
    const next = this.tryActivate(this.applied.theme, {})
    if (next === null) {
      return
    }
    this.persistTheme({ ...pref, overrides: {}, themeCache: this.cacheOf(next) })
  }

  /** 接收系统外观事件；manual 模式下只记录状态，不覆盖手选主题。 */
  applySystemState(state: SystemThemeState): void {
    this.systemState = { dark: state.dark, highContrast: state.highContrast }
    const pref = this.themePreference()
    if (pref.mode !== 'system') {
      return
    }
    const theme = this.registry.get(this.slotThemeId(pref, this.systemState))
    if (theme === undefined) {
      this.report('error', '跟随系统：槽位主题缺失，保留当前主题')
      return
    }
    const next = this.tryActivate(theme, pref.overrides)
    if (next === null) {
      return
    }
    this.persistTheme({ ...pref, themeCache: this.cacheOf(next) })
  }

  /** 注册表变化：活动主题被移除时回退到同 appearance 的内置主题并提示。 */
  private handleRegistryChange(): void {
    const removedId = this.applied.theme.id
    if (this.registry.get(removedId) !== undefined) {
      return
    }
    const fallbackId = BUILTIN_THEME_IDS[this.applied.theme.appearance]
    const fallback = this.registry.get(fallbackId)
    if (fallback === undefined) {
      this.report('error', `活动主题 ${removedId} 已移除，且缺少内置回退主题`)
      return
    }
    const pref = this.themePreference()
    const next = this.tryActivate(fallback, pref.overrides)
    if (next === null) {
      return
    }
    const themeId = pref.mode === 'manual' && pref.themeId === removedId ? fallbackId : pref.themeId
    this.persistTheme({ ...pref, themeId, themeCache: this.cacheOf(next) })
    this.report('warning', `活动主题 ${removedId} 已移除，回退到 ${fallbackId}`)
  }

  /** 唯一的 DOM 写入点：写根变量、data-theme-* 与 color-scheme。 */
  applyToDocument(doc: ThemeDocumentTarget): void {
    const root = doc.documentElement
    const names = new Set<string>()
    const write = (token: string, value: string | undefined): void => {
      if (value === undefined) {
        return
      }
      const name = cssVarOf(token)
      root.style.setProperty(name, value)
      names.add(name)
    }
    for (const token of CORE_THEME_TOKENS) {
      write(token, this.applied.tokens[token])
    }
    for (const token of OPTIONAL_THEME_TOKENS) {
      write(token, this.applied.tokens[token])
    }
    for (const [token, value] of Object.entries(this.applied.trackTokens)) {
      write(token, value)
    }
    for (const [token, value] of Object.entries(this.applied.syntaxTokens)) {
      write(token, value)
    }
    root.style.setProperty(
      'color-scheme',
      this.applied.theme.appearance === 'light' ? 'light' : 'dark',
    )
    root.setAttribute('data-theme-id', this.applied.theme.id)
    root.setAttribute('data-theme-appearance', this.applied.theme.appearance)
    for (const stale of this.appliedVarNames) {
      if (!names.has(stale)) {
        root.style.removeProperty(stale)
      }
    }
    this.appliedVarNames = [...names]
  }

  /** 取消系统外观与注册表订阅。 */
  dispose(): void {
    this.unsubscribeSystem()
    this.unsubscribeRegistry()
    this.listeners.clear()
  }

  private initialApplied(): AppliedTheme {
    const pref = this.themePreference()
    const candidates: string[] = []
    if (pref.mode === 'system') {
      candidates.push(this.slotThemeId(pref, this.systemState))
    }
    candidates.push(pref.themeId)
    for (const themeId of candidates) {
      const theme = this.registry.get(themeId)
      if (theme === undefined) {
        continue
      }
      const applied = this.tryBuild(theme, pref.overrides)
      if (applied !== null) {
        return applied
      }
    }
    for (const theme of BUILTIN_THEMES) {
      const applied = this.tryBuild(theme, {})
      if (applied !== null) {
        return applied
      }
    }
    throw new Error('没有可用主题：内置主题未注册或全部无效')
  }

  private themePreference(): ThemePreference {
    const section: ThemePreference | undefined = this.preferences.getSection('theme')
    if (section === undefined || section === null) {
      return this.defaultThemePreference()
    }
    return {
      mode: section.mode,
      themeId: section.themeId,
      system: { ...section.system },
      overrides: { ...section.overrides },
      ...(section.themeCache === undefined ? {} : { themeCache: section.themeCache }),
    }
  }

  private defaultThemePreference(): ThemePreference {
    return {
      mode: 'manual',
      themeId: BUILTIN_THEME_IDS.dark,
      system: {
        lightThemeId: BUILTIN_THEME_IDS.light,
        darkThemeId: BUILTIN_THEME_IDS.dark,
        highContrastThemeId: BUILTIN_THEME_IDS['high-contrast'],
      },
      overrides: {},
    }
  }

  private slotThemeId(pref: ThemePreference, state: SystemThemeState): string {
    if (state.highContrast) {
      const configured = pref.system.highContrastThemeId
      const theme = configured === undefined ? undefined : this.registry.get(configured)
      return theme?.appearance === 'high-contrast'
        ? theme.id
        : BUILTIN_THEME_IDS['high-contrast']
    }
    const expected: ThemeAppearance = state.dark ? 'dark' : 'light'
    const configured = state.dark ? pref.system.darkThemeId : pref.system.lightThemeId
    const theme = this.registry.get(configured)
    return theme?.appearance === expected ? theme.id : BUILTIN_THEME_IDS[expected]
  }

  private tryBuild(theme: ThemeDefinition, overrides: Record<string, string>): AppliedTheme | null {
    try {
      return this.buildApplied(theme, overrides)
    } catch (error) {
      this.report('error', error instanceof Error ? error.message : String(error))
      return null
    }
  }

  private buildApplied(theme: ThemeDefinition, overrides: Record<string, string>): AppliedTheme {
    const baseline = this.baselineFor(theme.appearance)
    const merged = resolveTokens(theme, baseline)
    const missing = missingCoreTokens(merged)
    if (missing.length > 0) {
      throw new Error(`主题 ${theme.id} 缺少核心 token：${missing.join(', ')}`)
    }
    const tokens = { ...merged } as ThemeTokens
    for (const [token, raw] of Object.entries(overrides)) {
      if (!(OVERRIDABLE_TOKENS as readonly string[]).includes(token)) {
        this.report('warning', `token 覆盖只允许核心 token：${token}`)
        continue
      }
      if (!isColorLiteral(raw)) {
        this.report('warning', `token 覆盖值非法：${token}=${raw}`)
        continue
      }
      tokens[token as CoreThemeToken] = raw.trim()
    }
    return {
      theme,
      tokens,
      trackTokens: { ...(baseline?.trackTokens ?? {}), ...(theme.trackTokens ?? {}) },
      syntaxTokens: { ...(baseline?.syntaxTokens ?? {}), ...(theme.syntaxTokens ?? {}) },
    }
  }

  private baselineFor(appearance: ThemeAppearance): ThemeDefinition | undefined {
    const direct = this.registry.get(BUILTIN_THEME_IDS[appearance])
    if (direct !== undefined && direct.appearance === appearance) {
      return direct
    }
    for (const summary of this.registry.list()) {
      if (summary.source === 'builtin' && summary.appearance === appearance) {
        return this.registry.get(summary.id)
      }
    }
    return undefined
  }

  private tryActivate(
    theme: ThemeDefinition,
    overrides: Record<string, string>,
  ): AppliedTheme | null {
    const previous = this.applied
    try {
      const next = this.buildApplied(theme, overrides)
      this.applied = next
      this.applyToLiveDocument()
      this.host.setSource(next.theme.appearance)
      this.host.setWindowBackground(next.tokens['bg-app'])
      this.emit(next.theme)
      return next
    } catch (error) {
      this.applied = previous
      try {
        this.applyToLiveDocument()
        this.host.setSource(previous.theme.appearance)
        this.host.setWindowBackground(previous.tokens['bg-app'])
      } catch {
        // 回滚写 DOM 失败无法再补救；下面统一记一条应用失败诊断。
      }
      this.report(
        'error',
        `主题应用失败，已回滚到 ${previous.theme.id}：${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  /** 把当前 token 写到真实根元素；唯一直接访问 `document` 的位置。 */
  private applyToLiveDocument(): void {
    if (typeof document !== 'undefined') {
      this.applyToDocument(document)
    }
  }

  private cacheOf(applied: AppliedTheme): ThemeCache {
    return {
      themeId: applied.theme.id,
      appearance: applied.theme.appearance,
      bgApp: applied.tokens['bg-app'],
      tokens: { ...applied.tokens },
    }
  }

  private persistTheme(theme: ThemePreference): void {
    try {
      this.preferences.patch({ theme })
    } catch (error) {
      this.report(
        'warning',
        `主题偏好写入失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private report(severity: DiagnosticSeverity, message: string): void {
    this.diagnostics.report({ severity, source: 'theme', message })
  }

  private emit(theme: ThemeDefinition): void {
    for (const listener of this.listeners) {
      listener(theme)
    }
  }
}
