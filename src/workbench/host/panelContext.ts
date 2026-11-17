/**
 * 面板上下文（04-05）。
 *
 * 面板只通过 `PanelContext` 取数据：宿主不把文档 store、布局服务、第二份 Selection
 * 暴露给面板。选区 / 批选 / 修订号用 getter 实时读取，面板不能缓存跨 revision 的值。
 */
import { inject, type InjectionKey } from 'vue'
import type { Selection } from '../../core/doc/types.ts'
import type {
  ClipSelectionState,
  EffectTarget,
  I18nApi,
  PanelContext,
  PanelLayoutApi,
  StatusApi,
} from '../api/context.ts'
import type { DocumentCommands } from '../api/documents.ts'
import type { PanelRef } from '../api/ids.ts'
import type { PanelLayoutInfo } from '../api/layout.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import type { SelectionServicePort } from '../api/selection.ts'
import type { ServiceRegistry } from '../api/services.ts'
import type { ThemeApi } from '../api/theme.ts'

/** 焦点作用域前缀（04-10 的 FocusService 用同一形态）。 */
export const PANEL_SCOPE_PREFIX = 'panel:'

/** 面板焦点作用域 ID：`panel:<pluginId>:<panelId>`。 */
export function panelFocusScope(pluginId: string, panelId: string): string {
  return `${PANEL_SCOPE_PREFIX}${pluginId}:${panelId}`
}

/** 面板发出的请求（宿主转成真实动作；面板不直接改选区 / 布局）。 */
export interface PanelRequests {
  select(ref: Selection): void
  reveal(target: EffectTarget): void
  openDrawer(tabId: string): void
  focusPanel(panelId: string): void
  closePanel(): void
}

/** 宿主提供给面板宿主的动作（缺失占位 / 错误边界的出口）。 */
export interface PanelActions {
  removePanel(ref: PanelRef): void
  resetLayout(): void
  closePanel(ref: PanelRef): void
  focusPanel(ref: PanelRef): void
  openDrawer(tabId: string): void
  /** 禁用单个面板：从布局移除，不禁用整个插件。 */
  disablePanel(ref: PanelRef): void
}

/** 实时快照（每次调用都重新读 03 会话，不做缓存副本）。 */
export interface PanelRevision {
  selection: Selection
  clipKeys: readonly string[]
  docRevision: number
}

/** 面板运行时：由外壳注入；缺省时宿主可从 `ServiceRegistry` 组一个。 */
export interface PanelRuntime {
  revision(): PanelRevision
  layoutInfo(ref: PanelRef): PanelLayoutInfo
  requests(ref: PanelRef): PanelRequests
  actions(ref: PanelRef): PanelActions
  layoutSubscribe(listener: () => void): () => void
}

/** `createPanelContext` 的依赖。 */
export interface PanelContextDeps {
  pageId: string
  pluginId: string
  panelId: string
  commands: DocumentCommands
  selection: SelectionServicePort
  theme: ThemeApi
  i18n: I18nApi
  status: StatusApi
  preferences: PreferencesApi
  services: ServiceRegistry
  layoutInfo: () => PanelLayoutInfo
  requests: PanelRequests
  /** 布局变化订阅（可选；由宿主传入，避免在这里伪造轮询）。 */
  layoutSubscribe?: (listener: () => void) => () => void
}

/** 面板上下文注入键。 */
export const PANEL_CONTEXT_KEY: InjectionKey<PanelContext> = Symbol('workbench.panel.context')

/** 面板运行时注入键（可选覆盖；外壳没注入时宿主用 services 组默认实现）。 */
export const PANEL_RUNTIME_KEY: InjectionKey<PanelRuntime> = Symbol('workbench.panel.runtime')

/** 面板动作注入键（缺失占位 / 错误边界用）。 */
export const PANEL_ACTIONS_KEY: InjectionKey<PanelActions> = Symbol('workbench.panel.actions')

/** 工作台服务注册表注入键（外壳最外层 provide 一次）。 */
export const WORKBENCH_SERVICES_KEY: InjectionKey<ServiceRegistry> = Symbol('workbench.services')

/**
 * 创建一个只读面板上下文。
 *
 * `selection` / `clipKeys` / `docRevision` 是 getter，每次访问都读最新快照；
 * 其余服务是引用，不做深拷贝。面板拿不到 `DocStore` 本体。
 */
export function createPanelContext(
  deps: PanelContextDeps,
  revision: () => PanelRevision,
): PanelContext {
  const layout: PanelLayoutApi = {
    info: () => deps.layoutInfo(),
    subscribe: (listener) => {
      const subscribe = deps.layoutSubscribe
      if (subscribe === undefined) {
        return () => undefined
      }
      return subscribe(() => {
        listener(deps.layoutInfo())
      })
    },
  }

  return {
    pluginId: deps.pluginId,
    panelId: deps.panelId,
    pageId: deps.pageId,
    get selection(): Selection {
      return revision().selection
    },
    get clipKeys(): readonly string[] {
      return revision().clipKeys
    },
    get docRevision(): number {
      return revision().docRevision
    },
    commands: deps.commands,
    theme: deps.theme,
    i18n: deps.i18n,
    status: deps.status,
    layout,
    services: deps.services,
    preferences: deps.preferences,
    requestSelect: (ref) => {
      deps.requests.select(ref)
    },
    requestRevealInEffectControls: (target) => {
      deps.requests.reveal(target)
    },
    requestOpenDrawer: (tabId) => {
      deps.requests.openDrawer(tabId)
    },
    requestFocus: (panelId) => {
      deps.requests.focusPanel(panelId)
    },
    requestClosePanel: () => {
      deps.requests.closePanel()
    },
  }
}

/** 选区四态类型再导出，宿主组件不必再 import 一次 api。 */
export type { ClipSelectionState }

/**
 * 读取当前面板上下文；不在 `PanelHost` / `DrawerTabHost` 内挂载时立刻抛错，
 * 避免面板拿到 `undefined` 后自己猜默认值。
 */
export function usePanelContext(): PanelContext {
  const context = inject(PANEL_CONTEXT_KEY, null)
  if (context === null) {
    throw new Error('PanelContext 缺失：面板必须由 PanelHost / DrawerTabHost 挂载')
  }
  return context
}
