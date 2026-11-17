/**
 * 面板宿主公共装配（04-05）。
 *
 * `PanelHost` 与 `DrawerTabHost` 共用同一套服务解析、上下文创建和动作注入；
 * 两者只有“从哪个注册表解析组件”不同。
 */
import { inject, provide, ref, type Ref } from 'vue'
import type { I18nApi } from '../api/context.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { DocumentService } from '../api/documents.ts'
import type { PanelRegistry, DrawerTabRegistry } from '../api/registries.ts'
import type { WorkspaceLayoutService } from '../api/layout.ts'
import type { ServiceRegistry } from '../api/services.ts'
import {
  DIAGNOSTICS_SERVICE,
  DOCUMENT_COMMANDS,
  DOCUMENT_SERVICE,
  DRAWER_TAB_REGISTRY,
  I18N_SERVICE,
  LAYOUT_SERVICE,
  PANEL_REGISTRY,
  PREFERENCES_SERVICE,
  SELECTION_SERVICE,
  STATUS_SERVICE,
  THEME_SERVICE,
} from '../api/tokens.ts'
import {
  PANEL_ACTIONS_KEY,
  PANEL_CONTEXT_KEY,
  PANEL_RUNTIME_KEY,
  WORKBENCH_SERVICES_KEY,
  createPanelContext,
  type PanelActions,
  type PanelRuntime,
} from './panelContext.ts'
import { createDefaultPanelRuntime } from './panelRuntime.ts'

/** 一个面板宿主实例的身份。 */
export interface PanelHostIdentity {
  pageId: string
  pluginId: string
  panelId: string
}

/** 装配结果（只读；上下文与动作已 provide）。 */
export interface PanelHostSetup {
  services: ServiceRegistry | null
  runtime: PanelRuntime | null
  actions: PanelActions | null
  registry: PanelRegistry | undefined
  drawerTabs: DrawerTabRegistry | undefined
  layout: WorkspaceLayoutService | undefined
  documentService: DocumentService | undefined
  i18n: I18nApi | undefined
  diagnostics: DiagnosticSink | undefined
  contextError: Ref<string | null>
}

/**
 * 在组件 setup 中调用：解析服务、创建 `PanelContext`、按需 provide。
 *
 * 服务缺失时返回明确错误文案；不构造空对象、不让面板拿到半成品上下文。
 */
export function usePanelHostSetup(identity: PanelHostIdentity): PanelHostSetup {
  const services = inject(WORKBENCH_SERVICES_KEY, null)
  const injectedRuntime = inject(PANEL_RUNTIME_KEY, null)
  const injectedActions = inject(PANEL_ACTIONS_KEY, null)

  const runtime: PanelRuntime | null =
    injectedRuntime ??
    (services !== null ? createDefaultPanelRuntime(services, identity.pageId) : null)

  const contextError = ref<string | null>(null)
  if (services === null) {
    contextError.value = '工作台服务未注册（WORKBENCH_SERVICES_KEY 未 provide）'
  } else if (runtime === null) {
    contextError.value = '工作台服务未就绪：缺少选区服务或布局服务'
  } else {
    try {
      const context = createPanelContext(
        {
          pageId: identity.pageId,
          pluginId: identity.pluginId,
          panelId: identity.panelId,
          commands: services.require(DOCUMENT_COMMANDS),
          selection: services.require(SELECTION_SERVICE),
          theme: services.require(THEME_SERVICE),
          i18n: services.require(I18N_SERVICE),
          status: services.require(STATUS_SERVICE),
          preferences: services.require(PREFERENCES_SERVICE),
          services,
          layoutInfo: () => runtime.layoutInfo({ pluginId: identity.pluginId, panelId: identity.panelId }),
          requests: runtime.requests({ pluginId: identity.pluginId, panelId: identity.panelId }),
          layoutSubscribe: (listener) => runtime.layoutSubscribe(listener),
        },
        () => runtime.revision(),
      )
      provide(PANEL_CONTEXT_KEY, context)
    } catch (error) {
      contextError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const actions: PanelActions | null =
    injectedActions ?? (runtime !== null ? runtime.actions({ pluginId: identity.pluginId, panelId: identity.panelId }) : null)
  if (injectedActions === null && actions !== null) {
    provide(PANEL_ACTIONS_KEY, actions)
  }

  return {
    services,
    runtime,
    actions,
    registry: services?.get(PANEL_REGISTRY),
    drawerTabs: services?.get(DRAWER_TAB_REGISTRY),
    layout: services?.get(LAYOUT_SERVICE),
    documentService: services?.get(DOCUMENT_SERVICE),
    i18n: services?.get(I18N_SERVICE),
    diagnostics: services?.get(DIAGNOSTICS_SERVICE),
    contextError,
  }
}
