/**
 * 默认面板运行时（04-05）：外壳未注入 `PANEL_RUNTIME_KEY` 时，从 `ServiceRegistry`
 * 组一份真实实现。缺关键服务时返回 `null`，由宿主显示“工作台服务未就绪”，
 * 不用空对象伪装。
 */
import type {
  PanelActions,
  PanelRevision,
  PanelRequests,
  PanelRuntime,
} from './panelContext.ts'
import { panelFocusScope } from './panelContext.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { PanelRef } from '../api/ids.ts'
import { panelRefKey } from '../api/ids.ts'
import type { PanelLayoutInfo, WorkspaceLayoutService } from '../api/layout.ts'
import type { ServiceRegistry } from '../api/services.ts'
import {
  DIAGNOSTICS_SERVICE,
  FOCUS_SERVICE,
  LAYOUT_SERVICE,
  SELECTION_SERVICE,
} from '../api/tokens.ts'
import { panelGeometry } from './layoutGeometry.ts'
import { openDrawerTab } from '../drawer/drawerController.ts'

/** 把“打开抽屉”绑到某一页；缺抽屉 group 时记诊断，不伪造高度。 */
function drawerOpener(
  layout: WorkspaceLayoutService,
  pageId: string,
  diagnostics: DiagnosticSink | undefined,
): (tabId: string) => void {
  return (tabId) => {
    const result = openDrawerTab(layout, pageId, tabId)
    if (result === null) {
      diagnostics?.report({
        severity: 'warning',
        source: 'layout',
        message: `抽屉不可用：${pageId} 缺少 document.drawer group`,
        detail: `tabId=${tabId}`,
      })
    }
  }
}

/** 页级动作（不绑定具体 panel；每个方法接收目标 ref）。 */
export function createPagePanelActions(
  services: ServiceRegistry,
  pageId: string,
): PanelActions | null {
  const layout = services.get(LAYOUT_SERVICE)
  if (layout === undefined) {
    return null
  }
  const focus = services.get(FOCUS_SERVICE)
  const diagnostics = services.get(DIAGNOSTICS_SERVICE)
  const openDrawer = drawerOpener(layout, pageId, diagnostics)

  return {
    removePanel: (target) => {
      layout.removePanel(pageId, target)
    },
    resetLayout: () => {
      layout.resetLayout(pageId)
    },
    closePanel: (target) => {
      layout.hidePanel(pageId, target)
    },
    focusPanel: (target) => {
      focus?.focusRegion(panelFocusScope(target.pluginId, target.panelId))
    },
    openDrawer,
    disablePanel: (target) => {
      layout.removePanel(pageId, target)
      diagnostics?.report({
        severity: 'warning',
        source: 'panel',
        pluginId: target.pluginId,
        message: `面板已禁用并从布局移除：${panelRefKey(target)}`,
        detail: '可在布局菜单重置布局后恢复',
      })
    },
  }
}

/** 从服务注册表组一个默认运行时；选区或布局服务缺失时返回 `null`。 */
export function createDefaultPanelRuntime(
  services: ServiceRegistry,
  pageId: string,
): PanelRuntime | null {
  const selection = services.get(SELECTION_SERVICE)
  const layout = services.get(LAYOUT_SERVICE)
  if (selection === undefined || layout === undefined) {
    return null
  }
  const actions = createPagePanelActions(services, pageId)
  if (actions === null) {
    return null
  }
  const focus = services.get(FOCUS_SERVICE)

  const revision = (): PanelRevision => {
    const snapshot = selection.snapshot()
    return {
      selection: snapshot.selection,
      clipKeys: snapshot.clipKeys,
      docRevision: snapshot.revision,
    }
  }

  const layoutInfo = (ref: PanelRef): PanelLayoutInfo => {
    const geometry = panelGeometry(layout.getTree(pageId), ref, layout.viewport(), pageId)
    return geometry ?? { pageId, visible: false, collapsed: false, width: 0, height: 0 }
  }

  const requests = (ref: PanelRef): PanelRequests => ({
    select: (selectionRef) => {
      selection.requestSelect(selectionRef)
    },
    reveal: (target) => {
      selection.requestReveal(target)
    },
    openDrawer: actions.openDrawer,
    focusPanel: (panelId) => {
      focus?.focusRegion(panelFocusScope(ref.pluginId, panelId))
    },
    closePanel: () => {
      layout.hidePanel(pageId, ref)
    },
  })

  return {
    revision,
    layoutInfo,
    requests,
    actions: () => actions,
    layoutSubscribe: (listener) => layout.subscribe(listener),
  }
}
