/**
 * 局部视口（06-08）：片段局部秒 ↔ 像素的唯一换算来源。
 *
 * 视口是会话数据：不进文档、不进预览推送。所有关键帧组共享同一份视口参数，
 * 组不能独立缩放或平移。缩放以锚点时间保持不动；平移不钳制到片段范围
 * （轴外与负时间都要能看见），只对缩放结果做上下限钳制。
 */
import type { ClipSpan, EffectViewport, FitCommand, PropertyRow, ViewportLimits } from './types.ts'

/** 缩放上下限（06-08 §4.3）：每秒像素的硬边界。 */
export const VIEWPORT_LIMITS: ViewportLimits = { minPxPerSecond: 8, maxPxPerSecond: 2000 }

/** 默认视口：从片段 0 秒开始，每秒 80 像素。 */
export const DEFAULT_VIEWPORT: EffectViewport = {
  origin: 0,
  pxPerSecond: 80,
  scrollLeft: 0,
  scrollTop: 0,
  width: 0,
  height: 0,
}

/** 时间 → 内容区像素横坐标（相对内容区左边缘）。 */
export function timeToX(time: number, viewport: EffectViewport): number {
  return (time - viewport.origin) * viewport.pxPerSecond - viewport.scrollLeft
}

/** 内容区像素横坐标 → 时间。 */
export function xToTime(x: number, viewport: EffectViewport): number {
  return (x + viewport.scrollLeft) / viewport.pxPerSecond + viewport.origin
}

/** 缩放钳制：只夹每秒像素，不动原点。 */
export function clampPxPerSecond(value: number, limits: ViewportLimits = VIEWPORT_LIMITS): number {
  if (!Number.isFinite(value)) {
    return VIEWPORT_LIMITS.minPxPerSecond
  }
  return Math.min(limits.maxPxPerSecond, Math.max(limits.minPxPerSecond, value))
}

/**
 * 以某个屏幕横坐标为锚缩放：锚点下的时间保持不动。
 *
 * `anchorX` 是相对内容区左边缘的像素；缩放后按新比例重算 `scrollLeft`。
 */
export function zoomAt(
  viewport: EffectViewport,
  anchorX: number,
  factor: number,
  limits: ViewportLimits = VIEWPORT_LIMITS,
): EffectViewport {
  if (!Number.isFinite(factor) || factor <= 0) {
    return viewport
  }
  const anchorTime = xToTime(anchorX, viewport)
  const pxPerSecond = clampPxPerSecond(viewport.pxPerSecond * factor, limits)
  if (pxPerSecond === viewport.pxPerSecond) {
    return viewport
  }
  const scrollLeft = (anchorTime - viewport.origin) * pxPerSecond - anchorX
  return { ...viewport, pxPerSecond, scrollLeft }
}

/** 横向平移（像素）：正数向右滚。 */
export function panBy(viewport: EffectViewport, deltaPx: number): EffectViewport {
  if (!Number.isFinite(deltaPx)) {
    return viewport
  }
  return { ...viewport, scrollLeft: viewport.scrollLeft + deltaPx }
}

/** 纵向滚动位置（像素）：只夹到非负，不假装有内容末端。 */
export function scrollVertically(viewport: EffectViewport, next: number): EffectViewport {
  if (!Number.isFinite(next)) {
    return viewport
  }
  return { ...viewport, scrollTop: Math.max(0, next) }
}

/** 有限片段时长上界；无限片段返回 `null`（不把参考时长当上界）。 */
export function finiteDuration(span: ClipSpan): number | null {
  return span.infinite ? null : Math.max(0, span.duration)
}

/** 全部行的节点时间范围（含轴外），没有节点时返回 `null`。 */
export function nodeTimeRange(rows: readonly PropertyRow[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    for (const frame of row.keyframes) {
      if (frame.time < min) {
        min = frame.time
      }
      if (frame.time > max) {
        max = frame.time
      }
    }
  }
  return min === Number.POSITIVE_INFINITY ? null : { min, max }
}

/** 适配结果的边距（秒）：留给首末节点两侧，避免贴边。 */
const FIT_PADDING_SECONDS = 0.25

/**
 * 执行一条适配命令（06-08 §三）：纯视图操作，不改选择、不改播放头、不写文档。
 *
 * 返回 `null` 表示该命令在当前数据下不可用（调用方据此禁用按钮），
 * 绝不伪造一个"看起来成功"的视口。
 */
export function fitViewport(
  command: FitCommand,
  viewport: EffectViewport,
  options: {
    span: ClipSpan
    rows: readonly PropertyRow[]
    selectedTimes?: readonly number[]
    defaultViewport?: EffectViewport
  },
): EffectViewport | null {
  const width = viewport.width
  if (width <= 0) {
    return null
  }

  if (command === 'reset') {
    const base = options.defaultViewport ?? DEFAULT_VIEWPORT
    return { ...base, width: viewport.width, height: viewport.height }
  }

  if (command === 'clip') {
    const duration = finiteDuration(options.span)
    if (duration === null) {
      // 无限片段不尝试适配到无穷：用当前窗口末端加一点余量。
      const rightEdgeTime = xToTime(width, viewport)
      const left = Math.max(0, viewport.origin)
      const right = Math.max(rightEdgeTime, left + 1)
      const pxPerSecond = clampPxPerSecond(width / (right - left))
      return { ...viewport, origin: left, pxPerSecond, scrollLeft: 0 }
    }
    if (duration <= 0) {
      return null
    }
    const pxPerSecond = clampPxPerSecond(width / duration)
    return { ...viewport, origin: 0, pxPerSecond, scrollLeft: 0 }
  }

  if (command === 'selection') {
    const times = options.selectedTimes ?? []
    if (times.length === 0) {
      return null
    }
    return fitRange(viewport, Math.min(...times), Math.max(...times))
  }

  const range = nodeTimeRange(options.rows)
  if (range === null) {
    return null
  }
  return fitRange(viewport, range.min, range.max)
}

/** 把一个时间区间适配到内容区宽度（两侧留边距；单点区间给一个最小跨度）。 */
function fitRange(viewport: EffectViewport, min: number, max: number): EffectViewport {
  const left = min - FIT_PADDING_SECONDS
  const right = max + FIT_PADDING_SECONDS
  const span = Math.max(right - left, 0.5)
  const pxPerSecond = clampPxPerSecond(viewport.width / span)
  return { ...viewport, origin: left, pxPerSecond, scrollLeft: 0 }
}

/** 可见时间窗口（左边缘时间 / 右边缘时间）：虚拟化与标尺用。 */
export function visibleTimeWindow(viewport: EffectViewport): { from: number; to: number } {
  const from = xToTime(0, viewport)
  const to = xToTime(viewport.width, viewport)
  return { from, to }
}
