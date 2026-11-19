/**
 * 抽屉布局操作（04-06）：把抽屉开关 / 标签切换 / 高度夹取翻译成 04-02 的布局命令。
 *
 * 组件不持高度、不写 localStorage；每次操作都从未提交的布局树读当前值。
 * `groupId` 默认 `document.drawer`，保留显式传入便于其他页面复用同一容器。
 */
import type { PanelRef } from '../api/ids.ts'
import type { GroupNode, WorkspaceLayoutService } from '../api/layout.ts'
import {
  clampDrawerHeight,
  DRAWER_DEFAULT_HEIGHT,
  type DrawerHeightResult,
} from './drawerLayout.ts'

/** 抽屉 group 的固定 ID（04-02 / 04-06）。 */
export const DRAWER_GROUP_ID = 'document.drawer'

/** 取抽屉 group；布局损坏或页面不是 document 时返回 `undefined`。 */
export function drawerGroupOf(
  layout: WorkspaceLayoutService,
  pageId: string,
  groupId: string = DRAWER_GROUP_ID,
): GroupNode | undefined {
  return layout.getGroup(pageId, groupId)
}

/** 当前活动抽屉标签；没有抽屉 group 时为 `null`。 */
export function drawerActiveTabId(
  layout: WorkspaceLayoutService,
  pageId: string,
  groupId: string = DRAWER_GROUP_ID,
): string | null {
  return drawerGroupOf(layout, pageId, groupId)?.activeTabId ?? null
}

/**
 * 打开（或切换）抽屉标签：夹高度、低窗压主轴、写回布局。
 *
 * 返回夹取结果供组件显示提示；没有抽屉 group 时返回 `null`（不伪造布局）。
 */
export function openDrawerTab(
  layout: WorkspaceLayoutService,
  pageId: string,
  tabId: string,
  groupId: string = DRAWER_GROUP_ID,
): DrawerHeightResult | null {
  const group = drawerGroupOf(layout, pageId, groupId)
  if (group === undefined) {
    return null
  }
  const result = clampDrawerHeight(
    group.lastSize ?? DRAWER_DEFAULT_HEIGHT,
    layout.viewport().height,
  )
  layout.setGroupState(pageId, groupId, {
    visible: true,
    collapsed: false,
    activeTabId: tabId,
    lastSize: result.height,
  })
  applyAxis(layout, pageId, groupId, result)
  return result
}

/**
 * 打开抽屉里的普通面板标签（普通面板被拖进抽屉 group 后）。
 *
 * 与 `openDrawerTab` 共用高度夹取；活动项写 `activePanelId`。
 */
export function openDrawerPanel(
  layout: WorkspaceLayoutService,
  pageId: string,
  panel: PanelRef,
  groupId: string = DRAWER_GROUP_ID,
): DrawerHeightResult | null {
  const group = drawerGroupOf(layout, pageId, groupId)
  if (group === undefined) {
    return null
  }
  const result = clampDrawerHeight(
    group.lastSize ?? DRAWER_DEFAULT_HEIGHT,
    layout.viewport().height,
  )
  layout.setGroupState(pageId, groupId, {
    visible: true,
    collapsed: false,
    lastSize: result.height,
  })
  layout.setActivePanel(pageId, groupId, panel)
  applyAxis(layout, pageId, groupId, result)
  return result
}

/**
 * 折叠整个抽屉：保留 activeTabId 以便下次打开回到同一 tab。
 *
 * `restoreAxis` 幂等；没压过主轴时是无操作。
 */
export function collapseDrawer(
  layout: WorkspaceLayoutService,
  pageId: string,
  groupId: string = DRAWER_GROUP_ID,
): void {
  layout.setGroupState(pageId, groupId, { visible: false, collapsed: true })
  layout.restoreAxis(pageId)
}

/**
 * 抽屉已打开时按当前视口重新夹高度（窗口缩放 / 拉高恢复）。
 *
 * 只在值真的变化时写布局，避免订阅回环。
 */
export function refreshDrawerHeight(
  layout: WorkspaceLayoutService,
  pageId: string,
  groupId: string = DRAWER_GROUP_ID,
): DrawerHeightResult | null {
  const group = drawerGroupOf(layout, pageId, groupId)
  if (group === undefined || !group.visible) {
    return null
  }
  const result = clampDrawerHeight(
    group.lastSize ?? DRAWER_DEFAULT_HEIGHT,
    layout.viewport().height,
  )
  if (group.lastSize !== result.height || group.collapsed) {
    layout.setGroupState(pageId, groupId, {
      visible: true,
      collapsed: false,
      lastSize: result.height,
    })
  }
  applyAxis(layout, pageId, groupId, result)
  return result
}

/** 低窗压主轴；正常窗口先还自主轴，再把抽屉拉回 `lastSize` 对应高度（幂等）。 */
function applyAxis(
  layout: WorkspaceLayoutService,
  pageId: string,
  groupId: string,
  result: DrawerHeightResult,
): void {
  if (result.notice !== null) {
    layout.squeezeAxis(pageId, groupId, result.axisHeight)
  } else {
    layout.restoreAxis(pageId)
    layout.expandDrawer(pageId, groupId)
  }
}
