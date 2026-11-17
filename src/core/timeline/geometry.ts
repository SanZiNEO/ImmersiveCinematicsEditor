/**
 * 主轴几何、显示范围、吸附、刻度与命中（05-09）。
 *
 * 纯函数：不读文档、不写会话、不碰 DOM。
 * - 时间单位一律秒；世界坐标 = `time * pxPerSecond`；屏幕坐标 = 世界坐标 - `scrollLeft`。
 * - 缩放夹在 5–500，任何入口都不产出 `NaN` / `Infinity`。
 * - 显示范围只由片段起止 / 循环窗口 / 视口推导，不读、不写总时长字段。
 */

/** 主轴缩放状态：px/s、画布左边界（世界像素）、可视宽度。 */
export interface TimelineScale {
  pxPerSecond: number
  scrollLeft: number
  viewportWidth: number
}

/** 主轴显示范围（不是脚本总时长）。 */
export interface DisplayRange {
  /** 有限内容末端；没有有限片段时为 `null`。 */
  finiteEnd: number | null
  infinite: boolean
  start: number
  end: number
}

/** 画布命中结果；不命中关键帧 / 对象行 / 属性节点。 */
export interface TimelineHit {
  kind: 'clip' | 'clip-edge-left' | 'clip-edge-right' | 'track-empty' | 'ruler' | 'none'
  clipKey?: string
  trackId?: string
  time: number
}

/** 吸附上下文；候选值都是秒。 */
export interface SnapContext {
  enabled: boolean
  /** 阈值（屏幕像素），默认 8。 */
  thresholdPx: number
  playhead: number
  /** 当前拖动片段相邻片段边界。 */
  clipEdges: number[]
  /** session 标记。 */
  markers: number[]
  /** 脚本 A-B 循环端点。 */
  loopStart: number | null
  loopEnd: number | null
  /** UI 预览范围端点。 */
  previewStart: number | null
  previewEnd: number | null
  /** 栅格间隔（秒）；<=0 表示无栅格。 */
  gridInterval: number
  /** 按住 Alt 临时关闭吸附。 */
  altKey?: boolean
  /** 屏幕像素 → 秒的换算依据；省略时按 DEFAULT_PPS。 */
  pxPerSecond?: number
}

/** 主轴缩放下限（px/s）。 */
export const MIN_PPS = 5
/** 主轴缩放上限（px/s）。 */
export const MAX_PPS = 500
/** 默认缩放（px/s）。 */
export const DEFAULT_PPS = 80
/** 吸附阈值（屏幕像素）。 */
export const SNAP_THRESHOLD_PX = 8

/** 刻度候选间隔（秒）。 */
const RULER_INTERVALS: readonly number[] = [0.1, 0.5, 1, 2, 5, 10, 30, 60]
/** 标签最小间距（像素），保证相邻标签不重叠。 */
const RULER_LABEL_GAP_PX = 56
/** 生成刻度时的保险上限（避免病态输入造成死循环）。 */
const MAX_TICKS = 20000

/** 有限数字判断。 */
function finite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 夹到 [min, max]；非有限输入退回 fallback。 */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!finite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

/** 缩放值夹到 5–500；非有限输入回 DEFAULT_PPS。 */
export function clampPxPerSecond(value: number): number {
  return clamp(value, MIN_PPS, MAX_PPS, DEFAULT_PPS)
}

/** 时间 → 屏幕 x（含滚动偏移）。 */
export function timeToScreenX(time: number, scale: TimelineScale): number {
  const pps = clampPxPerSecond(scale.pxPerSecond)
  const scrollLeft = finite(scale.scrollLeft) ? scale.scrollLeft : 0
  const safeTime = finite(time) ? time : 0
  return safeTime * pps - scrollLeft
}

/** 屏幕 x → 时间（含滚动偏移）。 */
export function screenXToTime(x: number, scale: TimelineScale): number {
  const pps = clampPxPerSecond(scale.pxPerSecond)
  const scrollLeft = finite(scale.scrollLeft) ? scale.scrollLeft : 0
  const safeX = finite(x) ? x : 0
  return (safeX + scrollLeft) / pps
}

/** 片段展开窗口末端：`start + duration * (loop ? max(1, loopCount) : 1)`。 */
export function clipWindowEnd(clip: { start: number; duration: number; loop?: boolean; loopCount?: number }): number {
  const start = finite(clip.start) ? clip.start : 0
  const duration = finite(clip.duration) ? clip.duration : 0
  if (!clip.loop) {
    return start + duration
  }
  const count = finite(clip.loopCount ?? 1) ? (clip.loopCount ?? 1) : 1
  return start + duration * Math.max(1, count)
}

/** 片段是否永不结束：`duration < 0`，或 `loop=true && loopCount < 0`。 */
export function isClipInfinite(clip: { duration: number; loop?: boolean; loopCount?: number }): boolean {
  if (!finite(clip.duration)) {
    return true
  }
  if (clip.duration < 0) {
    return true
  }
  return clip.loop === true && finite(clip.loopCount ?? 0) && (clip.loopCount ?? 0) < 0
}

/**
 * 显示范围。
 *
 * - `finiteEnd`：所有**有限**片段 `clipWindowEnd` 最大值；没有有限片段时为 `null`。
 * - 有限：`end = max(finiteEnd ?? 0, 30) + tailPadding / pps`。
 * - 无限（`macroInfinite` 或任一无限片段）：`end = max(finiteEnd ?? 0, 视口末端, 60)`，
 *   随 `scrollLeft` 继续延伸；不出现 `Infinity` / `NaN`。
 */
export function computeDisplayRange(input: {
  clips: readonly { start: number; duration: number; loop?: boolean; loopCount?: number }[]
  viewportWidth: number
  pxPerSecond: number
  macroInfinite?: boolean
  scrollLeft?: number
  tailPadding?: number
}): DisplayRange {
  const pps = clampPxPerSecond(input.pxPerSecond)
  const viewportWidth = finite(input.viewportWidth) ? Math.max(0, input.viewportWidth) : 0
  const scrollLeft = finite(input.scrollLeft ?? 0) ? Math.max(0, input.scrollLeft ?? 0) : 0
  const tailPadding = input.tailPadding === undefined
    ? Math.max(120, viewportWidth * 0.5)
    : (finite(input.tailPadding) ? Math.max(0, input.tailPadding) : Math.max(120, viewportWidth * 0.5))

  let finiteEnd: number | null = null
  let infinite = input.macroInfinite === true
  for (const clip of input.clips) {
    if (isClipInfinite(clip)) {
      infinite = true
      continue
    }
    const end = clipWindowEnd(clip)
    if (!finite(end)) {
      infinite = true
      continue
    }
    finiteEnd = finiteEnd === null ? end : Math.max(finiteEnd, end)
  }

  const start = 0
  if (!infinite) {
    const content = Math.max(finiteEnd ?? 0, 30)
    return { finiteEnd, infinite: false, start, end: content + tailPadding / pps }
  }

  const viewportEnd = (scrollLeft + viewportWidth) / pps
  const end = Math.max(finiteEnd ?? 0, viewportEnd, 60)
  return { finiteEnd, infinite: true, start, end }
}

/** 候选点：同一优先级取距离最近；阈值外的候选不参与。 */
function nearest(candidates: readonly (number | null | undefined)[], raw: number, threshold: number): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || !finite(candidate)) {
      continue
    }
    const distance = Math.abs(candidate - raw)
    if (distance <= threshold && distance < bestDistance - 1e-9) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * 吸附：播放头 > 相邻片段边界 > 标记 > A-B > 预览范围 > 0 > 栅格。
 *
 * 阈值以屏幕像素给出，按 `pxPerSecond` 换算成秒；`enabled=false` 或 `altKey=true` 不吸附；
 * 没有候选在阈值内时原样返回，不制造假吸附点。
 */
export function snapTime(raw: number, ctx: SnapContext): number {
  if (!finite(raw)) {
    return raw
  }
  if (!ctx.enabled || ctx.altKey === true) {
    return raw
  }
  const pps = ctx.pxPerSecond === undefined || !finite(ctx.pxPerSecond)
    ? DEFAULT_PPS
    : clampPxPerSecond(ctx.pxPerSecond)
  const thresholdPx = finite(ctx.thresholdPx) ? Math.max(0, ctx.thresholdPx) : SNAP_THRESHOLD_PX
  const threshold = thresholdPx / pps

  const priorityGroups: readonly (readonly (number | null | undefined)[])[] = [
    [ctx.playhead],
    ctx.clipEdges,
    ctx.markers,
    [ctx.loopStart, ctx.loopEnd],
    [ctx.previewStart, ctx.previewEnd],
    [0],
  ]
  for (const group of priorityGroups) {
    const snapped = nearest(group, raw, threshold)
    if (snapped !== null) {
      return snapped
    }
  }
  if (finite(ctx.gridInterval) && ctx.gridInterval > 0) {
    const grid = Math.round(raw / ctx.gridInterval) * ctx.gridInterval
    if (Math.abs(grid - raw) <= threshold) {
      return grid
    }
  }
  return raw
}

/** 选一个标签不重叠的最小刻度档（秒）。 */
export function chooseRulerInterval(pxPerSecond: number): number {
  const pps = clampPxPerSecond(pxPerSecond)
  for (const interval of RULER_INTERVALS) {
    if (interval * pps >= RULER_LABEL_GAP_PX) {
      return interval
    }
  }
  return RULER_INTERVALS[RULER_INTERVALS.length - 1]
}

/** 秒 → 刻度标签：`0s` / `0.5s` / `1:30`。 */
function rulerLabel(time: number): string {
  const rounded = Math.round(time * 1000) / 1000
  if (rounded < 60) {
    return `${rounded}s`
  }
  const minutes = Math.floor(rounded / 60)
  const seconds = Math.round((rounded - minutes * 60) * 1000) / 1000
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * 生成刻度：主刻度间隔由 `chooseRulerInterval` 决定并带标签；次刻度为主刻度 / 5，不带标签。
 * 只返回 `displayRange.start..end` 内的点；`end` 非有限或宽度 <= 0 时返回空数组。
 */
export function rulerTicks(
  displayRange: DisplayRange,
  pxPerSecond: number,
  width: number,
): { time: number; major: boolean; label: string }[] {
  const pps = clampPxPerSecond(pxPerSecond)
  const rangeStart = finite(displayRange.start) ? displayRange.start : 0
  const rangeEnd = displayRange.end
  if (!finite(rangeEnd) || rangeEnd <= rangeStart || !finite(width) || width <= 0) {
    return []
  }
  const interval = chooseRulerInterval(pps)
  const minor = interval / 5
  if (!finite(minor) || minor <= 0) {
    return []
  }
  const ticks: { time: number; major: boolean; label: string }[] = []
  const first = Math.ceil(rangeStart / minor - 1e-9) * minor
  for (let index = 0; index < MAX_TICKS; index += 1) {
    const time = Math.round((first + index * minor) * 1e6) / 1e6
    if (time > rangeEnd + 1e-9) {
      break
    }
    const majorRatio = time / interval
    const major = Math.abs(majorRatio - Math.round(majorRatio)) < 1e-6
    ticks.push({ time, major, label: major ? rulerLabel(time) : '' })
  }
  return ticks
}

/**
 * 适配缩放：有限内容按显示末端；无限内容只适配已知有限末端（没有则 60s）。夹 5–500。
 */
export function fitPxPerSecond(displayRange: DisplayRange, viewportWidth: number): number {
  const width = finite(viewportWidth) ? viewportWidth : 0
  if (width <= 0) {
    return MIN_PPS
  }
  const start = finite(displayRange.start) ? displayRange.start : 0
  let span: number
  if (displayRange.infinite) {
    span = Math.max(displayRange.finiteEnd ?? 0, 60) - start
  } else {
    span = displayRange.end - start
  }
  if (!finite(span) || span <= 0) {
    return DEFAULT_PPS
  }
  return clampPxPerSecond(width / span)
}

/** 命中测试的片段条目（时间已映射为秒；`infinite` 表示画到显示末端）。 */
interface HitClip {
  clipKey: string
  trackId: string
  start: number
  duration: number
  infinite?: boolean
}

/** 片段的可见末端；无限片段取视口末端。 */
function hitClipEnd(clip: HitClip, viewportEnd: number): number {
  if (clip.infinite === true || isClipInfinite({ duration: clip.duration })) {
    return viewportEnd
  }
  return clip.start + (finite(clip.duration) ? clip.duration : 0)
}

/**
 * 画布命中：左/右手柄（默认 8px）优先于主体；无限片段没有右手柄。
 *
 * - `rulerHit=true` → `ruler`；
 * - 命中片段 → `clip` / `clip-edge-left` / `clip-edge-right`；
 * - 有 `trackId` 且没命中片段 → `track-empty`；
 * - 无 `trackId` 且没命中 → `none`。
 */
export function hitTest(input: {
  clips: readonly { clipKey: string; trackId: string; start: number; duration: number; infinite?: boolean }[]
  time: number
  trackId?: string
  xPx?: number
  viewportWidth: number
  pxPerSecond: number
  scrollLeft: number
  rulerHit?: boolean
  edgePx?: number
}): TimelineHit {
  const pps = clampPxPerSecond(input.pxPerSecond)
  const scrollLeft = finite(input.scrollLeft) ? input.scrollLeft : 0
  const viewportWidth = finite(input.viewportWidth) ? Math.max(0, input.viewportWidth) : 0
  const x = finite(input.xPx ?? Number.NaN) ? (input.xPx as number) : (finite(input.time) ? input.time : 0) * pps - scrollLeft
  const time = (x + scrollLeft) / pps
  if (input.rulerHit === true) {
    return { kind: 'ruler', time, ...(input.trackId === undefined ? {} : { trackId: input.trackId }) }
  }
  const edgePx = input.edgePx === undefined
    ? 8
    : (finite(input.edgePx) ? Math.max(0, input.edgePx) : 8)
  const viewportEnd = (scrollLeft + viewportWidth) / pps
  const candidates = input.trackId === undefined
    ? input.clips
    : input.clips.filter((clip) => clip.trackId === input.trackId)

  interface EdgeHit {
    clip: HitClip
    kind: 'clip-edge-left' | 'clip-edge-right'
    distance: number
  }
  let bestEdge: EdgeHit | null = null
  let bestBody: HitClip | null = null
  for (const clip of candidates) {
    if (!finite(clip.start)) {
      continue
    }
    const startX = clip.start * pps - scrollLeft
    const end = hitClipEnd(clip, viewportEnd)
    const endX = end * pps - scrollLeft
    const leftDistance = Math.abs(x - startX)
    const rightDistance = Math.abs(x - endX)
    if (leftDistance <= edgePx) {
      if (bestEdge === null || leftDistance < bestEdge.distance) {
        bestEdge = { clip, kind: 'clip-edge-left', distance: leftDistance }
      }
    }
    if (!(clip.infinite === true || isClipInfinite({ duration: clip.duration })) && rightDistance <= edgePx) {
      if (bestEdge === null || rightDistance < bestEdge.distance) {
        bestEdge = { clip, kind: 'clip-edge-right', distance: rightDistance }
      }
    }
    if (time >= clip.start && time <= end) {
      if (bestBody === null || clip.start > bestBody.start) {
        bestBody = clip
      }
    }
  }

  if (bestEdge !== null) {
    return { kind: bestEdge.kind, clipKey: bestEdge.clip.clipKey, trackId: bestEdge.clip.trackId, time }
  }
  if (bestBody !== null) {
    return { kind: 'clip', clipKey: bestBody.clipKey, trackId: bestBody.trackId, time }
  }
  if (input.trackId !== undefined) {
    return { kind: 'track-empty', trackId: input.trackId, time }
  }
  return { kind: 'none', time }
}
