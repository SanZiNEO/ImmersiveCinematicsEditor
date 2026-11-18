/**
 * 应用装配（04 全轮）。
 *
 * 这里把「端口 + 服务 + 注册表 + 插件」接成一个可运行的工作台：
 * 1. 宿主端口（Electron / 浏览器 dev）；
 * 2. 诊断、服务注册表、注册表族；
 * 3. 偏好、布局、主题、i18n、状态、选区、文档、命令、快捷键、焦点、弹窗；
 * 4. WebUI 传输（本地脚本 + 预览帧）与离机传输回退；
 * 5. 插件内核 + 内置插件。
 *
 * 工作台其它部分只 depend on `api/`，不在这里之外 new 具体实现。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../../core/schema/index.ts'
import type { DocTransport } from '../../core/doc/io.ts'
import type { JsonValue } from '../../core/doc/types.ts'
import { cloneJson } from '../../core/doc/json.ts'
import type { ValidationTransport } from '../../core/doc/validate.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import { CORE_PAGE_IDS } from '../api/ids.ts'
import type { HostPort } from '../api/host.ts'
import type { LayoutFile } from '../api/layout.ts'
import type { ServiceRegistry } from '../api/services.ts'
import {
  CATALOG_SERVICE,
  COMMAND_SERVICE,
  DIAGNOSTICS_SERVICE,
  DIALOG_STACK,
  DOCUMENT_COMMANDS,
  DOCUMENT_SERVICE,
  DRAWER_TAB_REGISTRY,
  FILE_DIALOG_PORT,
  FOCUS_SERVICE,
  GRAPH_LAYOUT_SERVICE,
  GRAPH_SERVICE,
  HOST_SERVICE,
  I18N_SERVICE,
  KEYBINDING_SERVICE,
  LAYOUT_SERVICE,
  PAGE_REGISTRY,
  PAGE_ROUTER,
  PANEL_REGISTRY,
  PREFERENCES_SERVICE,
  PREVIEW_SERVICE,
  SCRIPT_MUTATION_SERVICE,
  SELECTION_SERVICE,
  SETTINGS_REGISTRY,
  SHELL_ACTIONS_SERVICE,
  STATUS_ITEM_REGISTRY,
  STATUS_SERVICE,
  THEME_CONTROLLER,
  THEME_REGISTRY,
  THEME_SERVICE,
  WINDOW_PORT,
} from '../api/tokens.ts'
import { DiagnosticsStore } from '../kernel/DiagnosticsStore.ts'
import { ServiceRegistryImpl } from '../kernel/ServiceRegistryImpl.ts'
import {
  DrawerTabRegistryImpl,
  PageRegistryImpl,
  PanelRegistryImpl,
  SettingsRegistryImpl,
  StatusItemRegistryImpl,
} from '../kernel/CollectionRegistries.ts'
import { PluginRegistry } from '../kernel/PluginRegistry.ts'
import { CommandRegistryImpl } from '../commands/CommandRegistryImpl.ts'
import { KeybindingRegistryImpl } from '../keybindings/KeybindingRegistryImpl.ts'
import { FocusServiceImpl } from '../focus/FocusServiceImpl.ts'
import { LayoutService } from '../layout/LayoutService.ts'
import { LayoutPersistence } from '../layout/persist.ts'
import { validateLayoutFile } from '../layout/validate.ts'
import { buildDefaultTree, createDefaultFile } from '../layout/defaultLayouts.ts'
import { ThemeRegistry } from '../theme/ThemeRegistry.ts'
import { ThemeService } from '../theme/ThemeService.ts'
import { PreferencesStore } from '../preferences/PreferencesStore.ts'
import { I18nService } from '../i18n/index.ts'
import { createHost } from '../host/createHost.ts'
import { WebUiClient } from '../host/webui/WebUiClient.ts'
import { WebUiTransport } from '../host/webui/WebUiTransport.ts'
import { DocumentServiceImpl } from './DocumentServiceImpl.ts'
import { SelectionServiceImpl } from './SelectionServiceImpl.ts'
import { StatusServiceImpl } from './StatusServiceImpl.ts'
import { DialogStackImpl } from './DialogStackImpl.ts'
import { PluginHostImpl } from './PluginHostImpl.ts'
import { ScriptGraphService } from './ScriptGraphService.ts'
import { ScriptMutationService } from './ScriptMutationService.ts'
import { WorkspaceDocTransport } from './WorkspaceDocTransport.ts'
import { WorkspaceScriptSource } from './WorkspaceScriptSource.ts'
import { GraphLayoutStore } from '../../core/graph/layoutStore.ts'
import { ShellActions } from '../shell/actions.ts'
import { WEBUI_MESSAGE } from '../host/webui/protocol.ts'
import { PageRouterImpl } from '../shell/pageRouter.ts'
import { focusElement } from '../shell/focusRegions.ts'
import { BUILTIN_PLUGINS } from '../../plugins/builtin.ts'
import { startSelectionPanelSync } from './SelectionPanelSync.ts'
import type { PluginManifest } from '../api/contributions.ts'

/** 离机传输：没有游戏连接时的真实失败回退（不伪造成功）。 */
class OfflineTransport implements DocTransport, ValidationTransport {
  private readonly reason = '未连接游戏 WebUI（8765）：该操作需要游戏内 WebUI 服务'

  async load(): Promise<{ path: string; doc: never }> {
    throw new Error(this.reason)
  }

  async save(): Promise<{ path: string }> {
    throw new Error(this.reason)
  }

  async validate(): Promise<{ ok: boolean; issues: string[] }> {
    throw new Error(this.reason)
  }

  async pushScript(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: false, reason: this.reason }
  }

  async newScript(): Promise<{ path: string; doc: never }> {
    throw new Error(this.reason)
  }

  async seek(): Promise<void> {
    throw new Error(this.reason)
  }

  async exists(): Promise<boolean> {
    return false
  }
}

/** 应用实例。 */
export class WorkbenchApp {
  readonly diagnostics: DiagnosticSink
  readonly services: ServiceRegistry
  readonly host: HostPort
  readonly catalog: CatalogIndex
  readonly preferences: PreferencesStore
  readonly themes: ThemeRegistry
  readonly themeService: ThemeService
  readonly i18n: I18nService
  readonly status: StatusServiceImpl
  readonly layout: LayoutService
  readonly layoutPersistence: LayoutPersistence
  readonly commands: CommandRegistryImpl
  readonly keybindings: KeybindingRegistryImpl
  readonly focus: FocusServiceImpl
  readonly dialogs: DialogStackImpl
  readonly router: PageRouterImpl
  readonly documents: DocumentServiceImpl
  readonly selection: SelectionServiceImpl
  /** 选择驱动右栏标签的释放函数（`dispose` 时调用）。 */
  private stopSelectionPanelSync: (() => void) | null = null
  readonly graph: ScriptGraphService
  readonly graphLayout: GraphLayoutStore
  readonly mutations: ScriptMutationService
  readonly shellActions: ShellActions
  readonly panels: PanelRegistryImpl
  readonly pageRegistry: PageRegistryImpl
  readonly drawerTabs: DrawerTabRegistryImpl
  readonly statusItems: StatusItemRegistryImpl
  readonly settingsRegistry: SettingsRegistryImpl
  readonly pluginHost: PluginHostImpl
  readonly plugins: PluginRegistry
  readonly transport: WebUiTransport | null
  readonly client: WebUiClient | null
  /** 脚本来源：直接读写工作区（不经模组）。 */
  readonly scriptSource: WorkspaceScriptSource
  /** 文档传输：文件走工作区，预览/播放走模组。 */
  readonly docTransport: DocTransport & ValidationTransport

  private readonly serviceRegistry: ServiceRegistryImpl

  constructor(options: { host?: HostPort; plugins?: PluginManifest[] } = {}) {
    this.serviceRegistry = new ServiceRegistryImpl()
    this.services = this.serviceRegistry
    this.diagnostics = new DiagnosticsStore()
    this.host = options.host ?? createHost()
    this.catalog = indexCatalog(buildCatalog('editor-04'))

    this.preferences = new PreferencesStore({
      storage: this.host.storage,
      diagnostics: this.diagnostics,
    })

    this.i18n = new I18nService({
      locale: () => this.preferences.get().language,
      // 语言以偏好为唯一来源：偏好变了就同步 i18n（模板随之重渲染）。
      onChange: (setLocale) => {
        this.preferences.subscribe((next) => {
          setLocale(next.language)
        })
        setLocale(this.preferences.get().language)
      },
      diagnostics: this.diagnostics,
    })

    this.themes = new ThemeRegistry({ diagnostics: this.diagnostics })
    this.themeService = new ThemeService({
      registry: this.themes,
      host: this.host.theme,
      preferences: this.preferences,
      diagnostics: this.diagnostics,
    })

    this.status = new StatusServiceImpl(this.diagnostics)
    this.dialogs = new DialogStackImpl()
    this.router = new PageRouterImpl('project')

    this.panels = new PanelRegistryImpl((kind, id, first, second) => {
      this.diagnostics.report({
        severity: 'error',
        source: 'plugin',
        message: `${kind} ID 重复: ${id}`,
        detail: `${first} 与 ${second}`,
      })
    })
    this.pageRegistry = new PageRegistryImpl()
    this.drawerTabs = new DrawerTabRegistryImpl()
    this.statusItems = new StatusItemRegistryImpl()
    this.settingsRegistry = new SettingsRegistryImpl()

    this.layout = new LayoutService({
      panels: this.panels,
      diagnostics: this.diagnostics,
      // 默认树按「已注册面板」生成：没有面板的槽位就是空组，不用核心面板占位。
      defaults: (pageId) => buildDefaultTree(pageId, this.panels),
      // 抽屉标签不是面板节点，但可以被拖出/拖回：两个谓词让布局校验与 movePanel 都认得它。
      registered: (ref) =>
        this.panels.has(ref) || this.drawerTabs.get(ref.panelId)?.pluginId === ref.pluginId,
      isDrawerTab: (ref) =>
        this.drawerTabs.get(ref.panelId)?.pluginId === ref.pluginId,
    })
    this.layoutPersistence = new LayoutPersistence({
      storage: this.host.storage,
      diagnostics: this.diagnostics,
    })

    this.commands = new CommandRegistryImpl({ diagnostics: this.diagnostics })
    this.keybindings = new KeybindingRegistryImpl({
      diagnostics: this.diagnostics,
      platform: this.host.platform === 'web' ? 'win32' : this.host.platform,
    })
    this.focus = new FocusServiceImpl({
      onFocus: (regionId) => {
        focusElement(document.querySelector<HTMLElement>(`[data-focus-scope="${CSS.escape(regionId)}"]`))
      },
    })

    // WebUI 传输：Electron 宿主才有 token；浏览器 dev 也尝试连（Origin 会被服务端拒，属真实限制）。
    const token = readBrowserToken()
    const client = new WebUiClient({ token: () => token })
    this.client = client
    this.transport = new WebUiTransport({ client })
    // 脚本读写直接走工作区（`<gameDir>/immersive_cinematics/scripts`），不经模组：
    // 一次目录扫描 + mtime 增量，10 万脚本也不必等 N 次往返。
    const scriptSource = new WorkspaceScriptSource({ workspace: this.host.workspace })
    this.scriptSource = scriptSource

    this.graphLayout = new GraphLayoutStore({ storage: this.host.storage })
    this.graph = new ScriptGraphService({ source: scriptSource, catalog: this.catalog })

    // 文档 IO：文件走工作区，播放/预览走模组（游戏没运行就只读写文件）。
    const liveTransport: DocTransport & ValidationTransport = new WorkspaceDocTransport({
      workspace: this.host.workspace,
      preview: this.transport,
    })
    this.docTransport = liveTransport
    this.documents = new DocumentServiceImpl({
      catalog: this.catalog,
      transport: liveTransport,
      diagnostics: this.diagnostics,
      onDirty: (payload, revision) => {
        void this.writeDraft(payload, revision)
      },
      onSaved: () => {
        const path = this.documents.summary().path
        if (path !== null) {
          this.graph.invalidate('save', [path])
        }
        void this.clearDrafts()
      },
    })

    this.mutations = new ScriptMutationService({
      source: scriptSource,
      graph: this.graph,
      documents: this.documents,
      catalog: this.catalog,
    })

    this.selection = new SelectionServiceImpl(this.documents.store)
    // 选择域驱动右栏标签（对齐剪辑软件：点空白→脚本属性，点片段→片段属性）。
    this.stopSelectionPanelSync = startSelectionPanelSync({
      pageId: 'document',
      layout: this.layout,
      selection: this.selection,
      documents: { subscribe: (listener) => this.documents.subscribe(listener) },
      report: (text) => {
        this.diagnostics.report({ severity: 'warning', source: 'layout', message: text })
      },
    })
    this.shellActions = new ShellActions({
      documents: this.documents,
      files: this.host.files,
      host: this.host,
      router: this.router,
      preferences: this.preferences,
      status: this.status,
      i18n: this.i18n,
      onWorkspaceChanged: () => {
        // 换工作区后：清缓存、重新探测、重扫整图（新目录是另一批脚本）。
        scriptSource.clear()
        void scriptSource.probe()
        this.graphLayout.resetLayout().catch(() => undefined)
        void this.graph.refresh().catch(() => undefined)
      },
    })
    this.pluginHost = new PluginHostImpl({
      diagnostics: this.diagnostics,
      services: this.serviceRegistry,
      panels: this.panels,
      pages: this.pageRegistry,
      drawerTabs: this.drawerTabs,
      statusItems: this.statusItems,
      settings: this.settingsRegistry,
      themes: this.themes,
      commands: this.commands,
      i18n: this.i18n,
      focus: this.focus,
      dialogs: this.dialogs,
      documentCommands: this.documents,
    })
    this.plugins = new PluginRegistry({
      diagnostics: this.diagnostics,
      host: this.pluginHost,
    })

    void options
    this.provideServices()
  }

  /** 启动：偏好 → 主题 → 布局 → 插件 → 连接 → 快捷键。 */
  async start(): Promise<void> {
    const preferenceIssues = await this.preferences.load()
    for (const issue of preferenceIssues.issues) {
      this.diagnostics.report({ severity: 'warning', source: 'preferences', message: issue })
    }

    const cached = this.themes.get(this.preferences.get().theme.themeId)
    if (cached !== undefined) {
      this.themeService.apply(cached.id)
    } else {
      this.themeService.apply(this.preferences.get().theme.themeId)
    }

    // 先激活插件再建默认布局：默认树按「已注册面板」生成（04-02），
    // 反过来的话首启会是空布局（面板注册表还没填）。
    await this.startPlugins()
    await this.loadLayout()
    // 已落盘的旧 layout.json 里没有后来新增的面板；补进它们声明的槽位，只补不改。
    for (const pageId of CORE_PAGE_IDS) {
      this.layout.ensureSlotPanels(pageId, this.panels)
    }
    this.installKeybindings()
    this.wireConnection()
    this.client?.connect()
  }

  /**
   * 开发/端到端夹具：用内存脚本集合替换图来源（真实索引、真实布局、真实写回路径）。
   *
   * 只在 `import.meta.env.DEV` 的调试钩子上可触达；生产 UI 没有入口。
   */
  debugUseGraphFiles(files: Record<string, JsonValue>): void {
    const store = new Map(Object.entries(files).map(([path, doc]) => [path, cloneJson(doc)]))
    this.graph.setSource({
      connected: () => true,
      list: async () => [...store.keys()].sort(),
      load: async (path) => {
        const doc = store.get(path)
        if (doc === undefined) {
          throw new Error(`脚本不存在：${path}`)
        }
        return cloneJson(doc)
      },
      save: async (path, doc) => {
        store.set(path, cloneJson(doc))
      },
    })
    this.graph.invalidate('manual')
    void this.graph.refresh().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    await this.saveLayout()
    this.stopSelectionPanelSync?.()
    this.stopSelectionPanelSync = null
    this.plugins.dispose()
    this.documents.dispose()
    this.selection.dispose()
    this.themeService.dispose()
    this.client?.close()
  }

  private provideServices(): void {
    this.serviceRegistry.provide(DIAGNOSTICS_SERVICE, this.diagnostics)
    this.serviceRegistry.provide(HOST_SERVICE, this.host)
    this.serviceRegistry.provide(WINDOW_PORT, this.host.window)
    this.serviceRegistry.provide(FILE_DIALOG_PORT, this.host.files)
    this.serviceRegistry.provide(PREFERENCES_SERVICE, this.preferences)
    this.serviceRegistry.provide(I18N_SERVICE, this.i18n)
    this.serviceRegistry.provide(THEME_REGISTRY, this.themes)
    this.serviceRegistry.provide(THEME_SERVICE, this.themeService)
    this.serviceRegistry.provide(THEME_CONTROLLER, this.themeService)
    this.serviceRegistry.provide(STATUS_SERVICE, this.status)
    this.serviceRegistry.provide(DIALOG_STACK, this.dialogs)
    this.serviceRegistry.provide(PAGE_ROUTER, this.router)
    this.serviceRegistry.provide(PANEL_REGISTRY, this.panels)
    this.serviceRegistry.provide(PAGE_REGISTRY, this.pageRegistry)
    this.serviceRegistry.provide(DRAWER_TAB_REGISTRY, this.drawerTabs)
    this.serviceRegistry.provide(STATUS_ITEM_REGISTRY, this.statusItems)
    this.serviceRegistry.provide(SETTINGS_REGISTRY, this.settingsRegistry)
    this.serviceRegistry.provide(LAYOUT_SERVICE, this.layout)
    this.serviceRegistry.provide(COMMAND_SERVICE, this.commands)
    this.serviceRegistry.provide(KEYBINDING_SERVICE, this.keybindings)
    this.serviceRegistry.provide(FOCUS_SERVICE, this.focus)
    this.serviceRegistry.provide(DOCUMENT_SERVICE, this.documents)
    this.serviceRegistry.provide(DOCUMENT_COMMANDS, this.documents)
    this.serviceRegistry.provide(SELECTION_SERVICE, this.selection)
    this.serviceRegistry.provide(CATALOG_SERVICE, this.catalog)
    this.serviceRegistry.provide(GRAPH_SERVICE, this.graph)
    this.serviceRegistry.provide(GRAPH_LAYOUT_SERVICE, this.graphLayout)
    this.serviceRegistry.provide(SCRIPT_MUTATION_SERVICE, this.mutations)
    this.serviceRegistry.provide(SHELL_ACTIONS_SERVICE, this.shellActions)
    if (this.transport !== null) {
      this.serviceRegistry.provide(PREVIEW_SERVICE, this.transport)
    }
  }

  private async loadLayout(): Promise<void> {
    const text = await this.host.storage.read('layout.json')
    const defaults = createDefaultFile(this.panels)
    const validated = validateLayoutFile(text === null ? defaults : safeParse(text), {
      pageIds: ['project', 'document', 'settings'],
      panels: (ref) => this.panels.has(ref),
    })
    for (const message of validated.result.messages) {
      this.diagnostics.report({
        severity: validated.result.reverted ? 'warning' : 'info',
        source: 'layout',
        message,
      })
    }
    this.layout.load(JSON.stringify(validated.file))
  }

  private async saveLayout(): Promise<void> {
    try {
      const parsed = JSON.parse(this.layout.serialize()) as LayoutFile
      await this.layoutPersistence.save({
        version: 1,
        currentPageId: this.router.currentPageId,
        pages: parsed.pages,
      })
    } catch (error) {
      this.diagnostics.report({
        severity: 'warning',
        source: 'layout',
        message: '布局写盘失败',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async startPlugins(): Promise<void> {
    this.plugins.load(BUILTIN_PLUGINS.map((manifest) => ({ manifest, source: `builtin:${manifest.id}` })))
    await this.plugins.activateAll()
    const states = this.plugins.states()
    const failed = states.filter((state) => state.status === 'failed' || state.status === 'skipped')
    if (failed.length > 0) {
      this.status.notify(`插件加载失败：${failed.map((state) => state.id).join('、')}`, 'error')
    }
  }

  private installKeybindings(): void {
    this.keybindings.registerFromCommands(
      this.commands.list().map((entry) => ({
        ...entry.definition,
      })),
    )
    for (const [commandId, chord] of Object.entries(this.preferences.get().shortcuts)) {
      void commandId
      void chord
    }
    for (const override of this.preferences.get().shortcuts) {
      try {
        this.keybindings.setOverride(override.commandId, override.chord)
      } catch (error) {
        this.diagnostics.report({
          severity: 'warning',
          source: 'preferences',
          message: `快捷键覆盖被拒绝：${override.commandId}`,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  private wireConnection(): void {
    const client = this.client
    if (client === null) {
      return
    }
    client.subscribe((connected) => {
      this.documents.setConnected(connected)
      this.graph.invalidate('reconnect')
      if (connected) {
        void this.graph.refresh().catch(() => undefined)
      }
      this.status.notify(connected ? '已连接游戏 WebUI' : '与游戏 WebUI 断开', connected ? 'info' : 'warning')
    })
    client.on(WEBUI_MESSAGE.scriptGraphInvalidated, (data) => {
      if (typeof data !== 'object' || data === null) {
        this.graph.invalidate('manual')
        return
      }
      const kind = 'kind' in data && typeof data.kind === 'string' ? data.kind : 'save'
      const paths = 'paths' in data && Array.isArray(data.paths)
        ? data.paths.filter((path): path is string => typeof path === 'string')
        : undefined
      const mapped = kind === 'save' || kind === 'delete' || kind === 'new' || kind === 'refactor' || kind === 'requires'
        ? kind
        : 'manual'
      this.graph.invalidate(mapped, paths)
    })
  }

  private async writeDraft(payload: string, revision: number): Promise<void> {
    const summary = this.documents.summary()
    if (summary.docId === null) {
      return
    }
    try {
      await this.host.drafts.write({
        version: 1,
        draftId: summary.docId,
        docId: summary.docId,
        ...(summary.path === null ? {} : { sourcePath: summary.path }),
        capturedAt: new Date().toISOString(),
        docRevision: revision,
        hash: String(payload.length),
        payload,
      })
    } catch (error) {
      this.status.notify(`草稿未保存：${error instanceof Error ? error.message : String(error)}`, 'warning')
    }
  }

  private async clearDrafts(): Promise<void> {
    const summary = this.documents.summary()
    if (summary.docId === null) {
      return
    }
    try {
      await this.host.drafts.remove(summary.docId)
    } catch {
      // 草稿删除失败不阻塞保存结果。
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function readBrowserToken(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('token') ?? ''
}
