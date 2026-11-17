/**
 * 布局几何（04-05）。
 *
 * 布局服务只暴露树与视口；`PanelLayoutInfo` 需要当前面板的可见 / 折叠 / 像素尺寸。
 * 这里按 split 比例从根递归算出真实像素，不持第二份布局、不写任何状态。
 */
import type {
  GroupNode,
  LayoutNode,
  LayoutTree,
  PanelLayoutInfo,
  PanelNode,
  Viewport,
} from '../api/layout.ts'
import type { PanelRef } from '../api/ids.ts'
import { samePanel } from '../api/ids.ts'

/** 一个面板在树里的位置。 */
export interface PanelLocation {
  panel: PanelNode
  group: GroupNode
  /** 从根到 group 的节点链（含 group）。 */
  chain: LayoutNode[]
}

/** 有限正数比例；坏值按等分处理（布局服务应已校验）。 */
function sizeAt(sizes: readonly number[], index: number, count: number): number {
  const value = sizes[index]
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  return count > 0 ? 1 / count : 0
}

/** 在树里找面板（同一页最多一个实例；找不到返回 `null`）。 */
export function findPanelLocation(tree: LayoutTree, ref: PanelRef): PanelLocation | null {
  const chain: LayoutNode[] = []

  const visit = (node: LayoutNode): PanelLocation | null => {
    chain.push(node)
    if (node.type === 'group') {
      const panel = node.panels.find((candidate) => samePanel(candidate, ref))
      if (panel !== undefined) {
        return { panel, group: node, chain: [...chain] }
      }
    } else {
      for (const child of node.children) {
        const found = visit(child)
        if (found !== null) {
          return found
        }
      }
    }
    chain.pop()
    return null
  }

  return visit(tree.root)
}

/** 子树里是否含指定 group（几何下钻用）。 */
function containsGroup(node: LayoutNode, groupId: string): boolean {
  if (node.type === 'group') {
    return node.id === groupId
  }
  return node.children.some((child) => containsGroup(child, groupId))
}

/**
 * 面板几何（像素按比例换算；不扣分隔线，布局服务提交前会再夹最小值）。
 *
 * `pageId` 只用于回填 `PanelLayoutInfo.pageId`，不参与计算。
 */
export function panelGeometry(
  tree: LayoutTree,
  ref: PanelRef,
  viewport: Viewport,
  pageId: string,
): PanelLayoutInfo | null {
  const location = findPanelLocation(tree, ref)
  if (location === null) {
    return null
  }

  let width = Math.max(0, viewport.width)
  let height = Math.max(0, viewport.height)

  const walk = (node: LayoutNode): boolean => {
    if (node.type === 'group') {
      return node.id === location.group.id
    }
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]
      if (child === undefined || !containsGroup(child, location.group.id)) {
        continue
      }
      const ratio = sizeAt(node.sizes, index, node.children.length)
      width = node.orientation === 'horizontal' ? width * ratio : width
      height = node.orientation === 'vertical' ? height * ratio : height
      return walk(child)
    }
    return false
  }

  if (!walk(tree.root)) {
    return null
  }

  const { panel, group } = location
  return {
    pageId,
    visible: group.visible && panel.visible,
    collapsed: group.collapsed || panel.collapsed === true,
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  }
}

/** 当前组的活动面板；`activePanelId` 失效时回退到第一个可见面板。 */
export function activePanelOf(group: GroupNode): PanelNode | undefined {
  const byId = group.panels.find((panel) => panel.id === group.activePanelId && panel.visible)
  if (byId !== undefined) {
    return byId
  }
  return group.panels.find((panel) => panel.visible)
}

/** 面板是否是该组的当前活动标签。 */
export function isActivePanel(group: GroupNode, panelId: string): boolean {
  const active = activePanelOf(group)
  return active !== undefined && active.panelId === panelId
}

/** 比例归一化（验证/渲染共用；不改入参）。 */
export function normalizedSizes(sizes: readonly number[], count: number): number[] {
  const values = Array.from({ length: count }, (_, index) => sizeAt(sizes, index, count))
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) {
    return values.map(() => (count > 0 ? 1 / count : 0))
  }
  return values.map((value) => value / total)
}
