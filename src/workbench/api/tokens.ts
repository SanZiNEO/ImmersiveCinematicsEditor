/**
 * 服务 token 清单（04-01）。
 *
 * 内核与插件只通过 token 取服务；不允许直接 import 业务实现。
 */
import type { CommandRegistryPort, DialogStackPort, FocusServicePort, KeybindingRegistryPort } from './commands.ts'
import type { DiagnosticSink } from './diagnostics.ts'
import type { DocumentCommands, DocumentService } from './documents.ts'
import type { FileDialogPort, HostPort, WindowPort } from './host.ts'
import type { WorkspaceLayoutService } from './layout.ts'
import type { PreferencesApi } from './preferences.ts'
import type {
  DrawerTabRegistry,
  PageRegistry,
  PageRouter,
  PanelRegistry,
  SettingsRegistry,
  StatusItemRegistry,
} from './registries.ts'
import type { SelectionServicePort } from './selection.ts'
import type { ServiceToken } from './services.ts'
import { createServiceToken } from './services.ts'
import type { I18nApi, StatusApi } from './context.ts'
import type { PreviewServicePort } from './preview.ts'
import type { ResourceServicePort } from './resources.ts'
import type { ThemeApi, ThemeControllerPort, ThemeRegistryPort } from './theme.ts'
import type { GraphLayoutServicePort, GraphServicePort, ScriptMutationServicePort } from './graph.ts'
import type { ShellActionsPort } from './actions.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'

/** 布局服务。 */
export const LAYOUT_SERVICE: ServiceToken<WorkspaceLayoutService> = createServiceToken('工作区布局服务')

/** 主题注册表。 */
export const THEME_REGISTRY: ServiceToken<ThemeRegistryPort> = createServiceToken('主题注册表')

/** 当前主题（token / 订阅）。 */
export const THEME_SERVICE: ServiceToken<ThemeApi> = createServiceToken('主题服务')

/** 主题控制器（应用 / 模式 / 覆盖）。 */
export const THEME_CONTROLLER: ServiceToken<ThemeControllerPort> = createServiceToken('主题控制器')

/** 命令注册表。 */
export const COMMAND_SERVICE: ServiceToken<CommandRegistryPort> = createServiceToken('命令注册表')

/** 快捷键注册表。 */
export const KEYBINDING_SERVICE: ServiceToken<KeybindingRegistryPort> = createServiceToken('快捷键注册表')

/** 状态区。 */
export const STATUS_SERVICE: ServiceToken<StatusApi> = createServiceToken('状态区')

/** i18n。 */
export const I18N_SERVICE: ServiceToken<I18nApi> = createServiceToken('国际化')

/** 宿主端口。 */
export const HOST_SERVICE: ServiceToken<HostPort> = createServiceToken('宿主端口')

/** 窗口端口（命令/标题栏用；单独成 token 便于浏览器宿主替换）。 */
export const WINDOW_PORT: ServiceToken<WindowPort> = createServiceToken('窗口端口')

/** 文件对话框端口。 */
export const FILE_DIALOG_PORT: ServiceToken<FileDialogPort> = createServiceToken('文件对话框')

/** 选区服务。 */
export const SELECTION_SERVICE: ServiceToken<SelectionServicePort> = createServiceToken('选区服务')

/** 文档命令面。 */
export const DOCUMENT_COMMANDS: ServiceToken<DocumentCommands> = createServiceToken('文档命令面')

/** 文档生命周期。 */
export const DOCUMENT_SERVICE: ServiceToken<DocumentService> = createServiceToken('文档生命周期')

/** 偏好。 */
export const PREFERENCES_SERVICE: ServiceToken<PreferencesApi> = createServiceToken('偏好')

/** 诊断。 */
export const DIAGNOSTICS_SERVICE: ServiceToken<DiagnosticSink> = createServiceToken('诊断')

/** 面板注册表。 */
export const PANEL_REGISTRY: ServiceToken<PanelRegistry> = createServiceToken('面板注册表')

/** 页面注册表。 */
export const PAGE_REGISTRY: ServiceToken<PageRegistry> = createServiceToken('页面注册表')

/** 抽屉标签注册表。 */
export const DRAWER_TAB_REGISTRY: ServiceToken<DrawerTabRegistry> = createServiceToken('抽屉标签注册表')

/** 状态项注册表。 */
export const STATUS_ITEM_REGISTRY: ServiceToken<StatusItemRegistry> = createServiceToken('状态项注册表')

/** 设置分区注册表。 */
export const SETTINGS_REGISTRY: ServiceToken<SettingsRegistry> = createServiceToken('设置分区注册表')

/** 页面路由。 */
export const PAGE_ROUTER: ServiceToken<PageRouter> = createServiceToken('页面路由')

/** 焦点服务。 */
export const FOCUS_SERVICE: ServiceToken<FocusServicePort> = createServiceToken('焦点服务')

/** 弹窗栈。 */
export const DIALOG_STACK: ServiceToken<DialogStackPort> = createServiceToken('弹窗栈')

/** 预览流。 */
export const PREVIEW_SERVICE: ServiceToken<PreviewServicePort> = createServiceToken('预览流')

/** 脚本关系图（快照 / 失效 / 刷新）。 */
export const GRAPH_SERVICE: ServiceToken<GraphServicePort> = createServiceToken('脚本关系图')

/** 图布局（graph-layout.json）。 */
export const GRAPH_LAYOUT_SERVICE: ServiceToken<GraphLayoutServicePort> = createServiceToken('图布局')

/** 关系写入（requires / refs）。 */
export const SCRIPT_MUTATION_SERVICE: ServiceToken<ScriptMutationServicePort> = createServiceToken('关系写入')

/** 外壳动作（新建 / 打开 / 守卫 / 切页）。 */
export const SHELL_ACTIONS_SERVICE: ServiceToken<ShellActionsPort> = createServiceToken('外壳动作')

/** 02 字段目录（面板只读查询；不复制字段表）。 */
export const CATALOG_SERVICE: ServiceToken<CatalogIndex> = createServiceToken('字段目录')

/** 资源列举（09：resource.list 的既有消息）。 */
export const RESOURCE_SERVICE: ServiceToken<ResourceServicePort> = createServiceToken('资源列举')
