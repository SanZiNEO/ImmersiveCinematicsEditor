/**
 * 落点计算（04-03）。
 *
 * 纯几何：输入指针、可见矩形、标签条矩形与源面板，输出唯一的停靠意图。
 * 不读 DOM、不写布局；`DockSurface` 只把结果画成预览，松手才交给控制器提交。
 */
import type { Orientation, PanelRef } from '../api/ids.ts'

/** 视口内的一个可命中矩形。坐标相对 `DockSurface` 左上角。 */
export interface DockRect {
  groupId: string
  kind: 'group' | 'tabbar' | 'drawer' | 'workspace'
  x: number
  y: number
  width: number
  height: number
}

/** 指针坐标（相对 `DockSurface`）。 */
export interface DockPoint {
  x: number
  y: number
}

/** 停靠意图。 */
export interface DropTarget {
  kind: 'merge' | 'split' | 'reorder' | 'new-group' | 'drawer' | 'none'
  groupId?: string
  orientation?: Orientation
  side?: 'left' | 'right' | 'top' | 'bottom'
  /** 合并/重排的插入位置；`0..panels.length`。 */
  index?: number
  /** `none` 的原因：`outside`、`same-position`、`no-target`。 */
  reason?: string
}

/** `computeDropTarget` 输入。 */
export interface ComputeDropTargetInput {
  pointer: DockPoint
  rects: DockRect[]
  /** 标签条命中区：每个标签一个矩形（同 groupId），用于算插入 index。 */
  tabBars: DockRect[]
  source: PanelRef
  viewport: { width: number; height: number }
  /**
   * 源面板所在 group。与 `sourceIndex` 一起用于判定“拖回原位置”。
   * 不传时只做几何判定，由控制器在提交前再判原位。
   */
  sourceGroupId?: string
  /** 源面板在该 group 内的索引。 */
  sourceIndex?: number
}

/** 边缘命中比例：左/右/上/下各 25%。 */
const EDGE_RATIO = 0.25

/** 指针是否在矩形内（含边界）。 */
export function containsPoint(rect: DockRect, point: DockPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * 计算合法落点。
 *
 * 优先级：标签条重排（不拆分）→ 抽屉 → group（边缘拆分 / 中心合并）→ 空白工作区。
 * group 与空白工作区重叠时 group 优先；抽屉压过一切。
 */
export function computeDropTarget(input: ComputeDropTargetInput): DropTarget {
  const { pointer, rects, tabBars, viewport } = input

  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) {
    return { kind: 'none', reason: 'outside' }
  }
  if (
    pointer.x < 0 ||
    pointer.y < 0 ||
    pointer.x >= viewport.width ||
    pointer.y >= viewport.height
  ) {
    return { kind: 'none', reason: 'outside' }
  }

  const tabHit = hitTabBar(tabBars, pointer)
  if (tabHit) {
    return samePositionOr(
      { kind: 'reorder', groupId: tabHit.groupId, index: tabHit.index },
      input,
    )
  }

  const drawer = rects.find((rect) => rect.kind === 'drawer' && containsPoint(rect, pointer))
  if (drawer) {
    const target: DropTarget = { kind: 'drawer', groupId: drawer.groupId }
    if (input.sourceGroupId !== undefined && input.sourceGroupId === drawer.groupId) {
      return { kind: 'none', groupId: drawer.groupId, reason: 'same-position' }
    }
    return target
  }

  const group = smallestContaining(rects, 'group', pointer)
  if (group) {
    const edge = edgeOf(group, pointer)
    if (edge) {
      return {
        kind: 'split',
        groupId: group.groupId,
        orientation: edge.orientation,
        side: edge.side,
      }
    }
    const index = mergeIndex(tabBars, group.groupId, pointer)
    return samePositionOr({ kind: 'merge', groupId: group.groupId, index }, input)
  }

  const workspace = smallestContaining(rects, 'workspace', pointer)
  if (workspace) {
    if (input.sourceGroupId !== undefined && input.sourceGroupId === workspace.groupId) {
      return { kind: 'none', groupId: workspace.groupId, reason: 'same-position' }
    }
    return { kind: 'new-group', groupId: workspace.groupId }
  }

  return { kind: 'none', reason: 'no-target' }
}

/** 命中标签条；返回 groupId 与插入 index。 */
function hitTabBar(
  tabBars: readonly DockRect[],
  pointer: DockPoint,
): { groupId: string; index: number } | null {
  let hit: DockRect | null = null
  for (const rect of tabBars) {
    if (rect.kind !== 'tabbar' || !containsPoint(rect, pointer)) continue
    // 重叠时取面积更小的（更具体的标签），避免整条标签条压过单个标签。
    if (!hit || rect.width * rect.height < hit.width * hit.height) hit = rect
  }
  if (!hit) return null

  const siblings = tabBars
    .filter((rect) => rect.kind === 'tabbar' && rect.groupId === hit.groupId)
    .slice()
    .sort((a, b) => a.x - b.x)
  let index = siblings.length
  for (let i = 0; i < siblings.length; i += 1) {
    const rect = siblings[i]
    if (pointer.x < rect.x + rect.width / 2) {
      index = i
      break
    }
  }
  return { groupId: hit.groupId, index }
}

/** 命中的最小矩形（同一 kind 里取面积最小，避免大容器盖住具体区域）。 */
function smallestContaining(
  rects: readonly DockRect[],
  kind: DockRect['kind'],
  pointer: DockPoint,
): DockRect | null {
  let best: DockRect | null = null
  for (const rect of rects) {
    if (rect.kind !== kind || !containsPoint(rect, pointer)) continue
    if (!best || rect.width * rect.height < best.width * best.height) best = rect
  }
  return best
}

/** group 边缘判定：最近边缘在 25% 内则拆分，否则返回 null（中心合并）。 */
function edgeOf(
  rect: DockRect,
  pointer: DockPoint,
): { orientation: Orientation; side: 'left' | 'right' | 'top' | 'bottom' } | null {
  const left = pointer.x - rect.x
  const right = rect.x + rect.width - pointer.x
  const top = pointer.y - rect.y
  const bottom = rect.y + rect.height - pointer.y

  const horizontal = Math.min(left, right)
  const vertical = Math.min(top, bottom)
  const inHorizontal = horizontal <= rect.width * EDGE_RATIO
  const inVertical = vertical <= rect.height * EDGE_RATIO

  if (inHorizontal && (!inVertical || horizontal <= vertical)) {
    return { orientation: 'horizontal', side: left <= right ? 'left' : 'right' }
  }
  if (inVertical) {
    return { orientation: 'vertical', side: top <= bottom ? 'top' : 'bottom' }
  }
  return null
}

/** 合并时的插入位置：按标签条中线算；无标签条信息时追加到末尾。 */
function mergeIndex(
  tabBars: readonly DockRect[],
  groupId: string,
  pointer: DockPoint,
): number | undefined {
  const siblings = tabBars
    .filter((rect) => rect.kind === 'tabbar' && rect.groupId === groupId)
    .slice()
    .sort((a, b) => a.x - b.x)
  if (siblings.length === 0) return undefined
  for (let i = 0; i < siblings.length; i += 1) {
    const rect = siblings[i]
    if (pointer.x < rect.x + rect.width / 2) return i
  }
  return siblings.length
}

/**
 * 拖回源 group 的原位置 → 取消。
 * 移除源面板后，插到 `sourceIndex` 或 `sourceIndex + 1` 都等价于原位。
 */
function samePositionOr(target: DropTarget, input: ComputeDropTargetInput): DropTarget {
  if (input.sourceGroupId === undefined || input.sourceIndex === undefined) return target
  if (target.groupId !== input.sourceGroupId) return target
  if (target.kind !== 'merge' && target.kind !== 'reorder') return target
  if (target.index === undefined) return target
  if (target.index === input.sourceIndex || target.index === input.sourceIndex + 1) {
    return { kind: 'none', groupId: target.groupId, reason: 'same-position' }
  }
  return target
}
