/**
 * 插件宿主（04-01）：把 `PluginRegistry` 需要的「上下文工厂 + 贡献提交 + 回滚」接上真实注册表。
 *
 * 关键不变式：
 * - `activate` 期间注册的贡献只进 stage，不进全局注册表；
 * - `activate` 成功 → `commitStage` 一次性提交（重复 ID 抛错 → 该插件失败并回滚）；
 * - `activate` 失败 / 插件卸载 → `rollbackPlugin` 清掉该插件的全部贡献、服务与 disposables。
 */
import type {
  CommandContribution,
  DrawerTabContribution,
  PageContribution,
  PanelContribution,
  PluginManifest,
  SettingsContribution,
  StatusItemContribution,
} from '../api/contributions.ts'
import type { DisposableStore, I18nApi, PluginContext, PluginLogger } from '../api/context.ts'
import type { CommandRegistryPort, DialogStackPort, FocusServicePort } from '../api/commands.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { DocumentCommands } from '../api/documents.ts'
import type {
  DrawerTabRegistry,
  PageRegistry,
  PanelRegistry,
  SettingsRegistry,
  StatusItemRegistry,
} from '../api/registries.ts'
import type { ServiceRegistry, ServiceToken } from '../api/services.ts'
import type { ThemeRegistryPort } from '../api/theme.ts'
import { DisposableStoreImpl } from '../kernel/DisposableStoreImpl.ts'
import type { ContributionStage, PluginActivationHost } from '../kernel/PluginRegistry.ts'

/** 暂存注册表：把 `register` 收集到 stage，不写全局表。 */
class StagedPanelRegistry implements PanelRegistry {
  private readonly stage: ContributionStage

  constructor(stage: ContributionStage) {
    this.stage = stage
  }
  register(_pluginId: string, contribution: PanelContribution): void {
    this.stage.panels.push(contribution)
  }
  get(): undefined {
    return undefined
  }
  has(): boolean {
    return false
  }
  list(): [] {
    return []
  }
  bySlot(): [] {
    return []
  }
  subscribe(): () => void {
    return () => undefined
  }
  disposePlugin(): void {
    // 暂存表没有全局状态。
  }
}

class StagedPageRegistry implements PageRegistry {
  private readonly stage: ContributionStage

  constructor(stage: ContributionStage) {
    this.stage = stage
  }
  register(_pluginId: string, contribution: PageContribution): void {
    this.stage.pages.push(contribution)
  }
  get(): undefined {
    return undefined
  }
  list(): [] {
    return []
  }
  subscribe(): () => void {
    return () => undefined
  }
  disposePlugin(): void {
    // 同上。
  }
}

class StagedDrawerTabRegistry implements DrawerTabRegistry {
  private readonly stage: ContributionStage

  constructor(stage: ContributionStage) {
    this.stage = stage
  }
  register(_pluginId: string, contribution: DrawerTabContribution): void {
    this.stage.drawerTabs.push(contribution)
  }
  get(): undefined {
    return undefined
  }
  list(): [] {
    return []
  }
  subscribe(): () => void {
    return () => undefined
  }
  disposePlugin(): void {
    // 同上。
  }
}

class StagedStatusItemRegistry implements StatusItemRegistry {
  private readonly stage: ContributionStage

  constructor(stage: ContributionStage) {
    this.stage = stage
  }
  register(_pluginId: string, contribution: StatusItemContribution): void {
    this.stage.statusItems.push(contribution)
  }
  list(): [] {
    return []
  }
  subscribe(): () => void {
    return () => undefined
  }
  disposePlugin(): void {
    // 同上。
  }
}

class StagedSettingsRegistry implements SettingsRegistry {
  private readonly stage: ContributionStage

  constructor(stage: ContributionStage) {
    this.stage = stage
  }
  register(_pluginId: string, contribution: SettingsContribution): void {
    this.stage.settings.push(contribution)
  }
  list(): [] {
    return []
  }
  subscribe(): () => void {
    return () => undefined
  }
  disposePlugin(): void {
    // 同上。
  }
}

/** 插件作用域服务：记录本插件提供的 token，便于回滚。 */
class ScopedServiceRegistry implements ServiceRegistry {
  private readonly provided: ServiceToken<unknown>[] = []

  private readonly inner: ServiceRegistry

  constructor(inner: ServiceRegistry) {
    this.inner = inner
  }

  provide<T>(token: ServiceToken<T>, impl: T): void {
    this.inner.provide(token, impl)
    this.provided.push(token as ServiceToken<unknown>)
  }

  get<T>(token: ServiceToken<T>): T | undefined {
    return this.inner.get(token)
  }

  require<T>(token: ServiceToken<T>): T {
    return this.inner.require(token)
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.inner.has(token)
  }

  remove<T>(token: ServiceToken<T>): boolean {
    return this.inner.remove(token)
  }

  /** 回滚本插件提供的全部服务。 */
  rollback(): void {
    for (const token of this.provided.reverse()) {
      this.inner.remove(token)
    }
    this.provided.length = 0
  }
}

/** 暂存命令表：`activate` 期间收集，成功后提交。 */
class StagedCommandRegistry implements CommandRegistryPort {
  readonly pending: Array<{ pluginId: string; contribution: Parameters<CommandRegistryPort['register']>[1] }> = []

  register(pluginId: string, contribution: Parameters<CommandRegistryPort['register']>[1]): void {
    this.pending.push({ pluginId, contribution })
  }
  get(): undefined {
    return undefined
  }
  list(): [] {
    return []
  }
  async execute(): Promise<boolean> {
    return false
  }
  isEnabled(): boolean {
    return false
  }
  isChecked(): boolean {
    return false
  }
  menuItems(): [] {
    return []
  }
  subscribe(): () => void {
    return () => undefined
  }
  disposePlugin(): void {
    // 暂存表没有全局状态。
  }
}

/** 插件宿主依赖。 */
export interface PluginHostOptions {
  diagnostics: DiagnosticSink
  services: ServiceRegistry
  panels: PanelRegistry
  pages: PageRegistry
  drawerTabs: DrawerTabRegistry
  statusItems: StatusItemRegistry
  settings: SettingsRegistry
  themes: ThemeRegistryPort
  commands: CommandRegistryPort
  i18n: I18nApi
  focus: FocusServicePort
  dialogs: DialogStackPort
  documentCommands: DocumentCommands
}

/** 插件宿主实现。 */
export class PluginHostImpl implements PluginActivationHost {
  private readonly options: PluginHostOptions
  private readonly contexts = new Map<string, {
    disposables: DisposableStoreImpl
    services: ScopedServiceRegistry
    commands: StagedCommandRegistry
    stage: ContributionStage
  }>()

  constructor(options: PluginHostOptions) {
    this.options = options
  }

  createContext(manifest: PluginManifest, stage: ContributionStage): PluginContext {
    const disposables = new DisposableStoreImpl((message, error) => {
      this.options.diagnostics.report({
        severity: 'warning',
        source: 'plugin',
        pluginId: manifest.id,
        message,
        detail: error instanceof Error ? error.message : String(error),
      })
    })
    const scoped = new ScopedServiceRegistry(this.options.services)
    const commands = new StagedCommandRegistry()
    this.contexts.set(manifest.id, { disposables, services: scoped, commands, stage })

    const logger: PluginLogger = {
      debug: (message, detail) => console.debug(`[${manifest.id}] ${message}`, detail ?? ''),
      info: (message, detail) => console.info(`[${manifest.id}] ${message}`, detail ?? ''),
      warn: (message, detail) => {
        console.warn(`[${manifest.id}] ${message}`, detail ?? '')
        this.options.diagnostics.report({
          severity: 'warning',
          source: 'plugin',
          pluginId: manifest.id,
          message,
          ...(detail === undefined ? {} : { detail: String(detail) }),
        })
      },
      error: (message, detail) => {
        console.error(`[${manifest.id}] ${message}`, detail ?? '')
        this.options.diagnostics.report({
          severity: 'error',
          source: 'plugin',
          pluginId: manifest.id,
          message,
          ...(detail === undefined ? {} : { detail: String(detail) }),
        })
      },
    }

    const stagedPanels = new StagedPanelRegistry(stage)
    const stagedPages = new StagedPageRegistry(stage)
    const stagedDrawerTabs = new StagedDrawerTabRegistry(stage)
    const stagedStatusItems = new StagedStatusItemRegistry(stage)
    const stagedSettings = new StagedSettingsRegistry(stage)

    const context: PluginContext = {
      pluginId: manifest.id,
      commands,
      panels: stagedPanels,
      pages: stagedPages,
      drawerTabs: stagedDrawerTabs,
      statusItems: stagedStatusItems,
      settings: stagedSettings,
      themes: this.options.themes,
      services: scoped,
      i18n: this.options.i18n,
      focus: this.options.focus,
      dialogs: this.options.dialogs,
      logger,
      disposables: disposables as DisposableStore,
      contributePanel: (contribution) => {
        stage.panels.push(contribution)
      },
      contributePage: (contribution) => {
        stage.pages.push(contribution)
      },
      contributeDrawerTab: (contribution) => {
        stage.drawerTabs.push(contribution)
      },
      contributeSettings: (contribution) => {
        stage.settings.push(contribution)
      },
      contributeStatusItem: (contribution) => {
        stage.statusItems.push(contribution)
      },
    }
    return context
  }

  commitStage(stage: ContributionStage): void {
    const record = this.contexts.get(stage.pluginId)
    for (const panel of stage.panels) {
      this.options.panels.register(stage.pluginId, panel)
    }
    for (const page of stage.pages) {
      this.options.pages.register(stage.pluginId, page)
    }
    for (const tab of stage.drawerTabs) {
      this.options.drawerTabs.register(stage.pluginId, tab)
    }
    for (const item of stage.statusItems) {
      this.options.statusItems.register(stage.pluginId, item)
    }
    for (const section of stage.settings) {
      this.options.settings.register(stage.pluginId, section)
    }
    // manifest 声明的命令与 activate 里注册的命令可能同源（同一 commandId）：
    // 按 commandId 去重，manifest 声明的优先，避免自己和自己冲突。
    const declared = new Map<string, CommandContribution>()
    for (const contribution of stage.commands) {
      declared.set(contribution.commandId, contribution)
    }
    for (const pending of record?.commands.pending ?? []) {
      if (!declared.has(pending.contribution.commandId)) {
        declared.set(pending.contribution.commandId, pending.contribution)
      }
    }
    for (const contribution of declared.values()) {
      this.options.commands.register(stage.pluginId, contribution)
    }
    if (record !== undefined) {
      record.commands.pending.length = 0
    }
  }

  rollbackPlugin(pluginId: string): void {
    const record = this.contexts.get(pluginId)
    this.options.panels.disposePlugin(pluginId)
    this.options.pages.disposePlugin(pluginId)
    this.options.drawerTabs.disposePlugin(pluginId)
    this.options.statusItems.disposePlugin(pluginId)
    this.options.settings.disposePlugin(pluginId)
    this.options.themes.disposePlugin(pluginId)
    this.options.commands.disposePlugin(pluginId)
    record?.services.rollback()
    if (record !== undefined) {
      record.commands.pending.length = 0
    }
  }

  disposeContext(pluginId: string): void {
    const record = this.contexts.get(pluginId)
    record?.disposables.dispose()
    this.contexts.delete(pluginId)
  }

  /** 已创建上下文的插件 ID（自检用）。 */
  contextPlugins(): string[] {
    return [...this.contexts.keys()]
  }
}
