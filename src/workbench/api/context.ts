/**
 * 插件上下文与面板上下文（04-01 / 04-05）。
 *
 * 面板只通过 `PanelContext` 取数据；不直接 import 全局 store、不直接改布局、不持第二份选区。
 */
import type { CommandRegistryPort, DialogStackPort, FocusServicePort } from './commands.ts'
import type {
  DrawerTabContribution,
  PageContribution,
  PanelContribution,
  SettingsContribution,
  StatusItemContribution,
} from './contributions.ts'
import type { DiagnosticSink } from './diagnostics.ts'
import type { PanelLayoutInfo } from './layout.ts'
import type { Selection } from '../../core/doc/types.ts'
import type {
  DrawerTabRegistry,
  PageRegistry,
  PanelRegistry,
  SettingsRegistry,
  StatusItemRegistry,
} from './registries.ts'
import type { ServiceRegistry } from './services.ts'
import type { ThemeApi, ThemeRegistryPort } from './theme.ts'
import type { DocumentCommands } from './documents.ts'
import type { PreferencesApi } from './preferences.ts'

/** 语言。 */
export type Locale = 'zh_cn' | 'en_us'

/** i18n 入口。 */
export interface I18nApi {
  locale(): Locale
  t(key: string, params?: Record<string, string | number>): string
  subscribe(listener: (locale: Locale) => void): () => void
}

/** 状态区 / 临时提示（只读状态 + 非阻塞提示）。 */
export interface StatusApi {
  /** 临时提示（状态区右侧，非模态）。 */
  notify(message: string, severity?: 'info' | 'warning' | 'error'): void
  clearTransient(): void
  transient(): { message: string; severity: 'info' | 'warning' | 'error' } | null
  diagnostics(): DiagnosticSink
  /** 临时提示 / 状态变化订阅（状态区刷新用）。 */
  subscribe(listener: () => void): () => void
}

/** 面板只读布局信息（面板不能改 `sizes/panels/activePanelId`）。 */
export interface PanelLayoutApi {
  info(): PanelLayoutInfo
  subscribe(listener: (info: PanelLayoutInfo) => void): () => void
}

/** 效果面板定位目标（属性面板 → 效果面板，只带定位，不带值/选区副本）。 */
export interface EffectTarget {
  clipKey: string
  objectPath: string
  time?: number
}

/** 选择四态（04-05）：`foreign` 表示 path/rule/binding 域（不属于片段控件）。 */
export type ClipSelectionState =
  | { kind: 'none' }
  | { kind: 'multi'; clipKeys: readonly string[] }
  | { kind: 'clip'; clipKey: string; selection: Selection }
  | { kind: 'invalid'; reason: string; previous: Selection }
  | { kind: 'foreign'; domain: 'path' | 'rule' | 'binding'; selection: Selection }

/** 面板上下文（04-05）。 */
export interface PanelContext {
  readonly pluginId: string
  readonly panelId: string
  readonly pageId: string

  /** 03 共享主选区快照（不是可变对象）。 */
  readonly selection: Selection
  /** 03 会话批选（只读）。 */
  readonly clipKeys: readonly string[]
  /** 文档修订号；变化时面板重取派生数据。 */
  readonly docRevision: number
  /** 03 文档命令面；面板只能通过它写文档。 */
  readonly commands: DocumentCommands

  readonly theme: ThemeApi
  readonly i18n: I18nApi
  readonly status: StatusApi
  readonly layout: PanelLayoutApi
  readonly services: ServiceRegistry
  readonly preferences: PreferencesApi

  requestSelect(ref: Selection): void
  requestRevealInEffectControls(target: EffectTarget): void
  requestOpenDrawer(tabId: string): void
  requestFocus(panelId: string): void
  requestClosePanel(): void
}

/** 插件日志。 */
export interface PluginLogger {
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

/** 可释放资源。 */
export interface Disposable {
  dispose(): void
}

/** 释放栈：逆序释放；单个抛错不影响其他。 */
export interface DisposableStore {
  add(disposable: Disposable | (() => void)): void
  dispose(): void
  readonly size: number
}

/** 插件上下文（04-01）。 */
export interface PluginContext {
  readonly pluginId: string
  readonly commands: CommandRegistryPort
  readonly panels: PanelRegistry
  readonly pages: PageRegistry
  readonly drawerTabs: DrawerTabRegistry
  readonly statusItems: StatusItemRegistry
  readonly settings: SettingsRegistry
  readonly themes: ThemeRegistryPort
  readonly services: ServiceRegistry
  readonly i18n: I18nApi
  readonly focus: FocusServicePort
  readonly dialogs: DialogStackPort
  readonly logger: PluginLogger
  readonly disposables: DisposableStore
  /** 注册一个面板贡献（等价 `contributes.panels`，用于动态声明）。 */
  contributePanel(contribution: PanelContribution): void
  contributePage(contribution: PageContribution): void
  contributeDrawerTab(contribution: DrawerTabContribution): void
  contributeSettings(contribution: SettingsContribution): void
  contributeStatusItem(contribution: StatusItemContribution): void
}
