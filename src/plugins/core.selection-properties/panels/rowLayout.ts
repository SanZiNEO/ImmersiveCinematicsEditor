/**
 * 属性面板的行高（06-09：100+ 叶子纵向虚拟化）。
 *
 * 虚拟化需要确定的高度：每行按"类型 + 是否有帧 + 是否未知"给出固定像素，
 * 行组件用同一函数的结果做内联高度，因此估算与实际渲染严格一致，不会重叠或留空。
 *
 * 纯函数：不读 DOM、不读文档。
 */
import type { PropertyRow } from '../../../features/effects/types.ts'

/** 组头高度（吸顶占位用）。 */
export const GROUP_HEADER_HEIGHT = 22

/** 单行高度：未知路径的原始 JSON 更高，结构编辑器最高，其余统一。 */
export function propertyRowHeight(row: PropertyRow): number {
  if (row.unknown || row.mode === 'unknown') {
    return 104
  }
  if (row.type === 'struct') {
    return 152
  }
  if (row.mode === 'event') {
    return 60
  }
  return 56
}

/** 一组行的累计高度（含组头）。 */
export function groupHeight(rows: readonly PropertyRow[]): number {
  return GROUP_HEADER_HEIGHT + rows.reduce((sum, row) => sum + propertyRowHeight(row), 0)
}

/** 行顶偏移（相对组内容区顶部，不含组头）。 */
export function rowOffsets(rows: readonly PropertyRow[]): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const row of rows) {
    offsets.push(cursor)
    cursor += propertyRowHeight(row)
  }
  return offsets
}

/**
 * 可见行窗口：`[first, last)` 下标。
 *
 * `localTop` 是组内容区顶部相对滚动容器顶部的偏移（不含组头）；
 * `scrollTop` / `viewportHeight` 是滚动容器的当前状态；`buffer` 是上下缓冲行数。
 */
export function visibleRowRange(input: {
  rows: readonly PropertyRow[]
  localTop: number
  scrollTop: number
  viewportHeight: number
  buffer?: number
}): { first: number; last: number } {
  const { rows, localTop, scrollTop, viewportHeight } = input
  const buffer = input.buffer ?? 6
  if (rows.length === 0) {
    return { first: 0, last: 0 }
  }
  const viewTop = scrollTop - localTop
  const viewBottom = viewTop + viewportHeight
  const offsets = rowOffsets(rows)
  let first = 0
  while (first < rows.length) {
    const bottom = offsets[first] + propertyRowHeight(rows[first])
    if (bottom > viewTop) {
      break
    }
    first += 1
  }
  let last = first
  while (last < rows.length && offsets[last] < viewBottom) {
    last += 1
  }
  return {
    first: Math.max(0, first - buffer),
    last: Math.min(rows.length, last + buffer),
  }
}
