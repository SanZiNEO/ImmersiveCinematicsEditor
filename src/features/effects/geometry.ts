/**
 * 关键帧组与节点几何（06-04）：每叶子一个组，共享一条局部标尺与一个视口。
 *
 * 只画本属性的节点与段：同刻不同叶子不合并、不联选、不生成"整帧"汇总行。
 * 横坐标由视口换算；纵向由统一行布局给出（组头 / 行 / 详情各有固定增量）。
 *
 * 虚拟化：只为视口内的节点生成几何，视口外节点只给计数。
 */
import type { ObjectKeyframe } from '../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { ClipTiming } from './rows.ts'
import type {
  EffectViewport,
  KeyframeNode,
  KeyframeSelection,
  NodeKind,
  PropertyRow,
  SegmentGeometry,
  SegmentSelection,
} from './types.ts'
import { timeToX, visibleTimeWindow } from './viewport.ts'

/** 行布局常量（像素）：组头 / 行 / 详情 / 事件记录展开的固定增量。 */
export const ROW_LAYOUT = {
  groupHeader: 24,
  row: 26,
  detail: 0,
  eventRecord: 22,
  trackInset: 8,
} as const

/** 播放头命中的时间容差（秒）：万分之一（06-02 §4.3）。 */
export const PLAYHEAD_EPSILON = 1e-4

/** 节点是否落在片段时长之外（无限片段恒为轴内）。 */
export function isOutOfRange(time: number, timing: ClipTiming): boolean {
  return !timing.infinite && time > timing.duration
}

/**
 * 事件节点种类。
 *
 * 源码事实：`EventRecord` 只有 `time` + 记录体，**没有终点/时长字段**
 * （`common/.../script/event/EventRecord.java`），`EventClipRuntime` 按单点触发。
 * 因此事件一律是瞬时节点（竖菱形）；`NodeKind` 保留 `event-start` / `event-end`
 * 是为了将来运行时若新增区间字段时几何层无需改形状，**当前不产出**这两个值。
 */
function eventKindOf(row: PropertyRow): NodeKind {
  if (row.mode !== 'event') {
    return 'value'
  }
  return 'event-instant'
}

/** 节点几何输入。 */
export interface NodeGeometryInput {
  row: PropertyRow
  viewport: EffectViewport
  timing: ClipTiming
  /** 行中心相对内容区顶部的像素。 */
  rowCenterY: number
  /** 播放头局部时间。 */
  playhead: number
  /** 当前选中的节点（同一行内匹配时间）。 */
  selection: readonly KeyframeSelection[]
}

/**
 * 生成一行的节点几何（只含可见窗口内的节点）。
 *
 * 返回 `nodes` 与"视口外节点数"；调用方用后者做计数占位，而不是生成元素。
 */
export function nodesOfRow(input: NodeGeometryInput): { nodes: KeyframeNode[]; hiddenCount: number } {
  const { row, viewport, timing, rowCenterY, playhead, selection } = input
  const window = visibleTimeWindow(viewport)
  const nodes: KeyframeNode[] = []
  let hiddenCount = 0
  for (let index = 0; index < row.keyframes.length; index += 1) {
    const frame = row.keyframes[index]
    if (frame.time < window.from || frame.time > window.to) {
      hiddenCount += 1
      continue
    }
    const selected = selection.some(
      (item) => item.clipKey === row.clipKey && item.path === row.path
        && Math.abs(item.time - frame.time) <= PLAYHEAD_EPSILON,
    )
    nodes.push({
      clipKey: row.clipKey,
      path: row.path,
      time: frame.time,
      kind: eventKindOf(row),
      x: timeToX(frame.time, viewport),
      y: rowCenterY,
      outOfRange: isOutOfRange(frame.time, timing),
      selected,
      atPlayhead: Math.abs(frame.time - playhead) <= PLAYHEAD_EPSILON,
      value: frame.value,
    })
  }
  return { nodes, hiddenCount }
}

/** 生成一行的段几何：只连相邻节点，事件行不画段。 */
export function segmentsOfRow(input: {
  row: PropertyRow
  viewport: EffectViewport
  rowCenterY: number
  selection: SegmentSelection | null
}): SegmentGeometry[] {
  const { row, viewport, rowCenterY, selection } = input
  if (row.mode === 'event') {
    return []
  }
  const frames = row.keyframes
  if (frames.length < 2) {
    return []
  }
  const window = visibleTimeWindow(viewport)
  const segments: SegmentGeometry[] = []
  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index]
    const to = frames[index + 1]
    // 只保留与可见窗口有交集的段。
    if (to.time < window.from || from.time > window.to) {
      continue
    }
    const selected = selection !== null
      && selection.clipKey === row.clipKey
      && selection.path === row.path
      && Math.abs(selection.fromTime - from.time) <= PLAYHEAD_EPSILON
      && Math.abs(selection.toTime - to.time) <= PLAYHEAD_EPSILON
    segments.push({
      clipKey: row.clipKey,
      path: row.path,
      fromTime: from.time,
      toTime: to.time,
      x1: timeToX(from.time, viewport),
      x2: timeToX(to.time, viewport),
      y: rowCenterY,
      interp: row.interp,
      selected,
    })
  }
  return segments
}

/** 行纵向布局结果：每个可见行的中心 y 与总高度。 */
export interface RowLayout {
  centers: Map<string, number>
  totalHeight: number
}

/** 按组顺序与折叠状态计算行中心（06-04 §4.3）。 */
export function layoutRows(
  groups: readonly { key: string; rows: readonly PropertyRow[] }[],
  collapsed: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
): RowLayout {
  const centers = new Map<string, number>()
  let y = 0
  for (const group of groups) {
    y += ROW_LAYOUT.groupHeader
    if (collapsed.has(group.key)) {
      continue
    }
    for (const row of group.rows) {
      centers.set(row.path, y + ROW_LAYOUT.row / 2)
      y += ROW_LAYOUT.row
      if (expanded.has(row.path)) {
        y += row.mode === 'event' ? ROW_LAYOUT.eventRecord : ROW_LAYOUT.detail
      }
    }
  }
  return { centers, totalHeight: y }
}

/** 命中测试：返回最接近的节点（容差内），没有命中返回 `null`。 */
export function hitTestNodes(
  nodes: readonly KeyframeNode[],
  x: number,
  y: number,
  radiusPx = 6,
): KeyframeNode | null {
  let best: KeyframeNode | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const dx = node.x - x
    const dy = node.y - y
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance <= radiusPx && distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

/** 框选：只返回矩形覆盖到的节点（不选组头、不选段线）。 */
export function nodesInRect(
  nodes: readonly KeyframeNode[],
  rect: { left: number; top: number; right: number; bottom: number },
): KeyframeNode[] {
  return nodes.filter(
    (node) => node.x >= rect.left && node.x <= rect.right && node.y >= rect.top && node.y <= rect.bottom,
  )
}
