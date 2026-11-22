/**
 * shell 组合式工具（04-04）：只做「从注入的服务注册表取端口 + 订阅成响应式」。
 *
 * 所有 shell 组件都用同一份服务注册表，不各自 new 一套状态。
 */
import { computed, inject, onScopeDispose, ref, shallowRef } from 'vue'
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue'

import type { DialogStackPort, FocusServicePort, KeybindingRegistryPort, CommandRegistryPort } from '../api/commands.ts'
import type { Diagnostic, DiagnosticSink } from '../api/diagnostics.ts'
import type { DocumentService, DocumentSummary } from '../api/documents.ts'
import type { I18nApi, Locale, PluginLogger, StatusApi } from '../api/context.ts'
import type { FileDialogPort, HostPort } from '../api/host.ts'
import type {
  DrawerTabRegistry,
  PageRegistry,
  PageRouter,
  PanelRegistry,
  SettingsRegistry,
  StatusItemRegistry,
} from '../api/registries.ts'
import type { ServiceRegistry, ServiceToken } from '../api/services.ts'
import type { WorkspaceLayoutService } from '../api/layout.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import type { ThemeApi, ThemeControllerPort, ThemeRegistryPort } from '../api/theme.ts'
import type { SelectionServicePort } from '../api/selection.ts'
import {
  COMMAND_SERVICE,
  DIAGNOSTICS_SERVICE,
  DIALOG_STACK,
  DOCUMENT_SERVICE,
  DRAWER_TAB_REGISTRY,
  FILE_DIALOG_PORT,
  FOCUS_SERVICE,
  HOST_SERVICE,
  I18N_SERVICE,
  KEYBINDING_SERVICE,
  LAYOUT_SERVICE,
  PAGE_REGISTRY,
  PAGE_ROUTER,
  PANEL_REGISTRY,
  PREFERENCES_SERVICE,
  SELECTION_SERVICE,
  SETTINGS_REGISTRY,
  STATUS_ITEM_REGISTRY,
  STATUS_SERVICE,
  THEME_CONTROLLER,
  THEME_REGISTRY,
  THEME_SERVICE,
} from '../api/tokens.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'

export interface PreviewRenderStatus {
  text: string
  severity: 'normal' | 'warning' | 'error'
}

export const PREVIEW_RENDER_STATUS_KEY: InjectionKey<ShallowRef<PreviewRenderStatus | null>> = Symbol('preview-render-status')

/** 取服务注册表（shell 根组件提供一次）。 */
export function useServices(): ServiceRegistry {
  const services = inject(WORKBENCH_SERVICES_KEY, null)
  if (services === null) {
    throw new Error('shell 组件只能在 WorkspaceShell 内使用（缺少 ServiceRegistry 注入）')
  }
  return services
}

function pick<T>(token: ServiceToken<T>): T {
  return useServices().require(token)
}

export function useDocuments(): DocumentService {
  return pick(DOCUMENT_SERVICE)
}

export function useHost(): HostPort {
  return pick(HOST_SERVICE)
}

export function useFileDialogs(): FileDialogPort {
  return pick(FILE_DIALOG_PORT)
}

export function useRouter(): PageRouter {
  return pick(PAGE_ROUTER)
}

export function useLayout(): WorkspaceLayoutService {
  return pick(LAYOUT_SERVICE)
}

export function usePanels(): PanelRegistry {
  return pick(PANEL_REGISTRY)
}

export function usePages(): PageRegistry {
  return pick(PAGE_REGISTRY)
}

export function useDrawerTabs(): DrawerTabRegistry {
  return pick(DRAWER_TAB_REGISTRY)
}

export function useStatusItems(): StatusItemRegistry {
  return pick(STATUS_ITEM_REGISTRY)
}

export function useSettingsSections(): SettingsRegistry {
  return pick(SETTINGS_REGISTRY)
}

export function useCommands(): CommandRegistryPort {
  return pick(COMMAND_SERVICE)
}

export function useKeybindings(): KeybindingRegistryPort {
  return pick(KEYBINDING_SERVICE)
}

export function useFocus(): FocusServicePort {
  return pick(FOCUS_SERVICE)
}

export function useDialogs(): DialogStackPort {
  return pick(DIALOG_STACK)
}

export function useTheme(): ThemeApi {
  return pick(THEME_SERVICE)
}

export function useThemeController(): ThemeControllerPort {
  return pick(THEME_CONTROLLER)
}

export function useThemeRegistry(): ThemeRegistryPort {
  return pick(THEME_REGISTRY)
}

export function usePreferences(): PreferencesApi {
  return pick(PREFERENCES_SERVICE)
}

export function useSelection(): SelectionServicePort {
  return pick(SELECTION_SERVICE)
}

export function useStatus(): StatusApi {
  return pick(STATUS_SERVICE)
}

export function useDiagnostics(): DiagnosticSink {
  return pick(DIAGNOSTICS_SERVICE)
}

export function useI18n(): I18nApi {
  return pick(I18N_SERVICE)
}

/** 订阅成响应式文档摘要。 */
export function useDocumentSummary(): Ref<DocumentSummary> {
  const documents = useDocuments()
  const summary = shallowRef<DocumentSummary>(documents.summary())
  const unsubscribe = documents.subscribe((next) => {
    summary.value = next
  })
  onScopeDispose(unsubscribe)
  return summary
}

/** 订阅布局变更（重渲染用）。 */
export function useLayoutTick(): Ref<number> {
  const layout = useLayout()
  const tick = ref(0)
  const unsubscribe = layout.subscribe(() => {
    tick.value += 1
  })
  onScopeDispose(unsubscribe)
  return tick
}

/** 订阅诊断列表。 */
export function useDiagnosticList(): Ref<readonly Diagnostic[]> {
  const sink = useDiagnostics()
  const items = shallowRef<readonly Diagnostic[]>(sink.list())
  const unsubscribe = sink.subscribe((next) => {
    items.value = next
  })
  onScopeDispose(unsubscribe)
  return items
}

/** 订阅偏好快照（语言 / 密度 / 最近项目数）。 */
export function usePreferencesSnapshot(): ShallowRef<PreferencesSnapshot> {
  const preferences = usePreferences()
  const snapshot = shallowRef<PreferencesSnapshot>(snapshotOf(preferences))
  const unsubscribe = preferences.subscribe(() => {
    snapshot.value = snapshotOf(preferences)
  })
  onScopeDispose(unsubscribe)
  return snapshot
}

export interface PreferencesSnapshot {
  language: Locale
  density: 'comfortable' | 'compact'
  themeMode: 'manual' | 'system'
  recentCount: number
}

function snapshotOf(preferences: PreferencesApi): PreferencesSnapshot {
  const file = preferences.get()
  return {
    language: file.language,
    density: file.density,
    themeMode: file.theme.mode,
    recentCount: file.recentProjects.length,
  }
}

/** 插件日志（诊断 + 控制台同源）。 */
export function createShellLogger(pluginId: string, sink: DiagnosticSink): PluginLogger {
  const write = (severity: 'info' | 'warning' | 'error', message: string, detail?: unknown): void => {
    sink.report({
      severity,
      source: 'plugin',
      pluginId,
      message,
      ...(detail === undefined ? {} : { detail: String(detail) }),
    })
  }
  return {
    debug: () => undefined,
    info: (message, detail) => write('info', message, detail),
    warn: (message, detail) => write('warning', message, detail),
    error: (message, detail) => write('error', message, detail),
  }
}

/** 当前页面 ID 的响应式值。 */
export function useCurrentPageId(): ComputedRef<string> {
  const router = useRouter()
  const pageId = ref(router.currentPageId)
  const unsubscribe = router.subscribe((next) => {
    pageId.value = next
  })
  onScopeDispose(unsubscribe)
  return computed(() => pageId.value)
}
