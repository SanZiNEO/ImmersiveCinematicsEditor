/**
 * 偏好存储（04-08）。
 *
 * 唯一落盘入口：300ms 防抖 + 显式 `flush`/`flushNow`；写入失败保留内存值；
 * 坏 JSON 先备份为 `preferences.corrupt.<ISO>.json` 再回默认，不影响布局/窗口/草稿。
 */
import type { DiagnosticSink, DiagnosticSeverity } from '../api/diagnostics.ts'
import type { StoragePort } from '../api/host.ts'
import type {
  PluginPreferenceValue,
  PreferencesApi,
  PreferencesFile,
  PreferencesSection,
} from '../api/preferences.ts'
import { PREFERENCES_MAX_BYTES } from '../api/preferences.ts'
import {
  clonePluginPreferences,
  clonePreferences,
  DEFAULT_PREFERENCES,
  mergePreferences,
  normalizePreferences,
  pluginPreferencesOf,
  withPluginPreferences,
} from './defaults.ts'

/** 偏好文件名（白名单）。 */
export const PREFERENCES_FILE_NAME = 'preferences.json'

/** 损坏备份前缀。 */
export const PREFERENCES_CORRUPT_PREFIX = 'preferences.corrupt.'

/** 存储依赖。 */
export interface PreferencesStoreOptions {
  storage: StoragePort
  diagnostics: DiagnosticSink
  now?: () => Date
  /** 默认 300ms；0 表示每次改动立即写。 */
  debounceMs?: number
}

/** 加载结果：issues 供状态区展示，不阻塞启动。 */
export interface PreferencesLoadResult {
  issues: string[]
}

/** 偏好存储实现。 */
export class PreferencesStore implements PreferencesApi {
  private readonly storage: StoragePort
  private readonly diagnostics: DiagnosticSink
  private readonly now: () => Date
  private readonly debounceMs: number
  private readonly listeners = new Set<(next: PreferencesFile) => void>()
  private readonly reportedIssues = new Set<string>()
  private state: PreferencesFile
  private extras: Record<string, unknown> = {}
  private issues: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private revision = 0

  constructor(options: PreferencesStoreOptions) {
    this.storage = options.storage
    this.diagnostics = options.diagnostics
    this.now = options.now ?? (() => new Date())
    this.debounceMs = options.debounceMs ?? 300
    this.state = clonePreferences(DEFAULT_PREFERENCES)
  }

  /** 从存储加载；坏数据备份后回默认。可重复调用。 */
  async load(): Promise<PreferencesLoadResult> {
    this.issues = []
    this.reportedIssues.clear()

    let text: string | null
    try {
      text = await this.storage.read(PREFERENCES_FILE_NAME)
    } catch (error) {
      const message = `读取偏好失败：${error instanceof Error ? error.message : String(error)}`
      this.issues = [message]
      this.report('error', `${message}；已使用默认值`)
      this.state = clonePreferences(DEFAULT_PREFERENCES)
      this.extras = {}
      return { issues: [...this.issues] }
    }
    if (text === null) {
      this.state = clonePreferences(DEFAULT_PREFERENCES)
      this.extras = {}
      return { issues: [] }
    }
    if (new TextEncoder().encode(text).length > PREFERENCES_MAX_BYTES) {
      await this.backupCorrupt(text, `偏好文件超过上限 ${PREFERENCES_MAX_BYTES} 字节`)
      return { issues: [...this.issues] }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      await this.backupCorrupt(
        text,
        `偏好 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return { issues: [...this.issues] }
    }

    const normalized = normalizePreferences(parsed)
    this.state = normalized.preferences
    this.extras = normalized.extras
    this.issues = [...normalized.issues]
    if (normalized.needsBackup) {
      await this.backupCorrupt(text, normalized.issues.join('; '))
    } else {
      this.reportIssues(normalized.issues)
    }
    return { issues: [...this.issues] }
  }

  get(): Readonly<PreferencesFile> {
    return this.state
  }

  getSection<K extends keyof PreferencesFile>(key: K): PreferencesFile[K] {
    return this.state[key]
  }

  setSection<K extends keyof PreferencesFile>(key: K, value: PreferencesFile[K]): void {
    const next = { ...this.state, [key]: value } as PreferencesFile
    this.commit(next)
  }

  patch(partial: Partial<PreferencesFile>): void {
    this.commit(mergePreferences(this.state, partial))
  }

  resetSection(key: PreferencesSection): void {
    const section: string = key
    const defaults = clonePreferences(DEFAULT_PREFERENCES)
    let next: PreferencesFile
    switch (section) {
      case 'theme':
        next = { ...this.state, theme: defaults.theme }
        break
      case 'language':
        next = { ...this.state, language: defaults.language }
        break
      case 'density':
        next = { ...this.state, density: defaults.density }
        break
      case 'shortcuts':
        next = { ...this.state, shortcuts: defaults.shortcuts }
        break
      case 'recentProjects':
        next = { ...this.state, recentProjects: defaults.recentProjects }
        break
      case 'settings':
        next = { ...this.state, settings: defaults.settings }
        break
      case 'plugins':
        next = withPluginPreferences(this.state, {})
        break
      default:
        return
    }
    this.commit(next)
  }

  resetAll(): void {
    this.extras = {}
    this.commit(clonePreferences(DEFAULT_PREFERENCES))
  }

  subscribe(listener: (next: PreferencesFile) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 立即落盘（取消防抖）。 */
  flush(): Promise<void> {
    return this.flushNow()
  }

  /** 立即写，不依赖定时器；测试与危险操作前用。 */
  flushNow(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.writeChain = this.writeChain.then(() => this.performWrite())
    return this.writeChain
  }

  /** 插件作用域读取：只返回该插件自己的键值。 */
  pluginValues(pluginId: string): Record<string, PluginPreferenceValue> {
    return { ...(pluginPreferencesOf(this.state)[pluginId] ?? {}) }
  }

  /** 插件作用域写入：只改该插件自己的键，不覆盖其他插件。 */
  setPluginValue(pluginId: string, key: string, value: PluginPreferenceValue): void {
    if (pluginId.trim().length === 0 || key.trim().length === 0) {
      this.report('warning', '插件偏好写入缺少 pluginId/key，已忽略')
      return
    }
    const valueType = typeof value
    const valid =
      valueType === 'string' ||
      valueType === 'boolean' ||
      (valueType === 'number' && Number.isFinite(value))
    if (!valid) {
      this.report('warning', `插件偏好值类型非法：${pluginId}.${key}`)
      return
    }
    const plugins = clonePluginPreferences(pluginPreferencesOf(this.state))
    plugins[pluginId] = { ...(plugins[pluginId] ?? {}), [key]: value }
    this.commit(withPluginPreferences(this.state, plugins))
  }

  /** 清空一个插件的全部键。 */
  resetPluginValues(pluginId: string): void {
    const plugins = clonePluginPreferences(pluginPreferencesOf(this.state))
    if (!Object.hasOwn(plugins, pluginId)) {
      return
    }
    delete plugins[pluginId]
    this.commit(withPluginPreferences(this.state, plugins))
  }

  private commit(next: PreferencesFile): void {
    const normalized = normalizePreferences({ ...this.extras, ...next })
    this.state = normalized.preferences
    this.extras = normalized.extras
    this.issues = [...normalized.issues]
    this.reportIssues(normalized.issues)
    this.revision += 1
    for (const listener of this.listeners) {
      listener(this.state)
    }
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (this.debounceMs <= 0) {
      void this.flushNow()
      return
    }
    clearTimeout(this.timer ?? undefined)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flushNow()
    }, this.debounceMs)
  }

  private async performWrite(): Promise<void> {
    const revision = this.revision
    let text: string
    try {
      text = JSON.stringify({ ...this.extras, ...this.state }, null, 2)
    } catch (error) {
      this.report(
        'error',
        `偏好序列化失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
    if (new TextEncoder().encode(text).length > PREFERENCES_MAX_BYTES) {
      this.report(
        'error',
        `偏好文件超过上限 ${PREFERENCES_MAX_BYTES} 字节，拒绝写入（内存值保留）`,
      )
      return
    }
    try {
      await this.storage.write(PREFERENCES_FILE_NAME, text)
      if (revision !== this.revision) {
        this.scheduleWrite()
      }
    } catch (error) {
      this.report(
        'error',
        `偏好写入失败（内存值保留）：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async backupCorrupt(text: string, reason: string): Promise<void> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-')
    const name = `${PREFERENCES_CORRUPT_PREFIX}${stamp}.json`
    try {
      await this.storage.write(name, text)
    } catch (error) {
      this.report(
        'error',
        `备份损坏偏好失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.state = clonePreferences(DEFAULT_PREFERENCES)
    this.extras = {}
    this.issues = [`${reason}；已备份为 ${name} 并回默认`]
    this.report('warning', this.issues[0])
  }

  private reportIssues(issues: readonly string[]): void {
    for (const issue of issues) {
      if (this.reportedIssues.has(issue)) {
        continue
      }
      this.reportedIssues.add(issue)
      this.report('warning', issue)
    }
  }

  private report(severity: DiagnosticSeverity, message: string): void {
    this.diagnostics.report({ severity, source: 'preferences', message })
  }
}
