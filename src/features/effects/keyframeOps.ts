/**
 * 关键帧编辑的纯函数层（06-05）：把 UI 意图翻译成 `DocCommand`。
 *
 * 分工：
 * - 本模块只做"意图 → 命令"的翻译，**不** commit、不读文档、不持会话状态；
 * - 单条走单条命令、多条走批量命令，批量命令的原子性由命令层保证；
 * - 没有任何可执行内容时返回 `null`，调用方据此不提交（不产生空撤销项）。
 *
 * 时间精度：拖动提交按 `TIME_PRECISION`（1e-3 秒）取整；加帧保留播放头的原始精度。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import type { JsonValue } from '../../core/doc/types.ts'
import { ROW_LAYOUT, nodesInRect, nodesOfRow } from './geometry.ts'
import type { ClipTiming } from './rows.ts'
import type {
  EffectViewport,
  KeyframeClipboard,
  KeyframeSelection,
  PropertyRow,
} from './types.ts'

/** 拖动提交的时间精度（秒）：与 06-05 §三一致。 */
export const TIME_PRECISION = 1e-3

/** 吸附半径（像素）：换算成秒后作为吸附阈值。 */
export const SNAP_THRESHOLD_PX = 6

/** 时间相等的比较容差（秒）：与文档层的 `KEYFRAME_EPSILON` 同一口径。 */
export const TIME_EPSILON = 1e-6

/** 按 `TIME_PRECISION` 取整；`-0` 归一成 `0`，避免比较与序列化时的怪异表现。 */
export function roundTime(time: number): number {
  if (!Number.isFinite(time)) {
    return time
  }
  const rounded = Math.round(time / TIME_PRECISION) * TIME_PRECISION
  return Object.is(rounded, -0) ? 0 : rounded
}

/** 时间是否可作为节点时间写入：有限且非负。 */
export function isWritableTime(time: number): boolean {
  return Number.isFinite(time) && time >= 0
}

/** 两个时间是否指同一个节点。 */
export function sameTime(left: number, right: number): boolean {
  return Math.abs(left - right) <= TIME_EPSILON
}

/** 吸附阈值（秒）：像素半径按当前缩放换算。 */
export function snapThresholdSeconds(pxPerSecond: number, radiusPx = SNAP_THRESHOLD_PX): number {
  if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) {
    return 0
  }
  return radiusPx / pxPerSecond
}

/**
 * 吸附：把原始时间吸到最近的候选时间（阈值内），否则原样返回。
 *
 * `candidates` 传 `null` 表示关闭吸附（按住 Alt）；不做任何钳制，负时间由调用方处理。
 */
export function snapTime(
  raw: number,
  candidates: readonly number[] | null,
  thresholdSeconds: number,
): number {
  if (candidates === null || candidates.length === 0) {
    return raw
  }
  if (!Number.isFinite(raw) || !Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
    return raw
  }
  let best = raw
  let bestDistance = thresholdSeconds
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) {
      continue
    }
    const distance = Math.abs(candidate - raw)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** 吸附源输入（06-05 §三）：同片段节点、播放头、标尺刻度、片段起止与标记。 */
export interface SnapSourceInput {
  /** 当前片段的全部行（节点时间来源）。 */
  rows: readonly PropertyRow[]
  /** 本次拖动涉及的原始时间：从候选里排除，避免节点吸到自己。 */
  excludeTimes?: readonly number[]
  playhead?: number
  /** 标尺刻度时间（由外壳按当前缩放算出）。 */
  ticks?: readonly number[]
  /** 片段标记时间（只读）。 */
  markers?: readonly number[]
  /** 片段时长上下文：有限片段贡献 0 与时长两个吸附点。 */
  timing?: ClipTiming
}

/**
 * 汇总吸附候选（去重、排序、剔除被拖动的原始时间）。
 *
 * 吸附不跨片段：`rows` 必须是同一片段的属性行。
 */
export function snapSources(input: SnapSourceInput): number[] {
  const excluded = input.excludeTimes ?? []
  const seen = new Set<number>()
  const result: number[] = []
  const push = (time: number): void => {
    if (!Number.isFinite(time)) {
      return
    }
    if (excluded.some((item) => sameTime(item, time))) {
      return
    }
    const key = Math.round(time * 1e6)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    result.push(time)
  }

  for (const row of input.rows) {
    for (const frame of row.keyframes) {
      push(frame.time)
    }
  }
  if (input.playhead !== undefined) {
    push(input.playhead)
  }
  for (const tick of input.ticks ?? []) {
    push(tick)
  }
  for (const marker of input.markers ?? []) {
    push(marker)
  }
  const timing = input.timing
  if (timing !== undefined && !timing.infinite) {
    push(0)
    push(timing.duration)
  }

  result.sort((left, right) => left - right)
  return result
}

/** 加帧：`object.addKeyframe`；时间非法或未知路径返回 `null`。 */
export function addKeyframeCommand(
  clipKey: string,
  row: PropertyRow,
  time: number,
  seed: JsonValue,
): DocCommand | null {
  if (!isWritableTime(time) || row.path.length === 0 || row.unknown) {
    return null
  }
  return { kind: 'object.addKeyframe', clipKey, path: row.path, time, value: seed }
}

/** 删帧：单条用 `object.removeKeyframe`，多条用 `object.removeKeyframes`。 */
export function removeKeyframeCommands(
  clipKey: string,
  targets: readonly { path: string; time: number }[],
): DocCommand | null {
  const valid: Array<{ path: string; time: number }> = []
  for (const target of targets) {
    if (target.path.length === 0 || !isWritableTime(target.time)) {
      continue
    }
    if (valid.some((item) => item.path === target.path && sameTime(item.time, target.time))) {
      continue
    }
    valid.push({ path: target.path, time: target.time })
  }
  if (valid.length === 0) {
    return null
  }
  if (valid.length === 1) {
    return { kind: 'object.removeKeyframe', clipKey, path: valid[0].path, time: valid[0].time }
  }
  return { kind: 'object.removeKeyframes', clipKey, targets: valid }
}

/** 移动：单条用 `object.moveKeyframe`，多条用 `object.moveKeyframes`；原地不动的条目被剔除。 */
export function moveKeyframesCommand(
  clipKey: string,
  moves: readonly { path: string; from: number; to: number }[],
): DocCommand | null {
  const valid: Array<{ path: string; from: number; to: number }> = []
  for (const move of moves) {
    if (move.path.length === 0 || !isWritableTime(move.from) || !isWritableTime(move.to)) {
      continue
    }
    if (sameTime(move.from, move.to)) {
      continue
    }
    if (valid.some((item) => item.path === move.path && sameTime(item.from, move.from))) {
      continue
    }
    valid.push({ path: move.path, from: move.from, to: move.to })
  }
  if (valid.length === 0) {
    return null
  }
  if (valid.length === 1) {
    return {
      kind: 'object.moveKeyframe',
      clipKey,
      path: valid[0].path,
      from: valid[0].from,
      to: valid[0].to,
    }
  }
  return { kind: 'object.moveKeyframes', clipKey, moves: valid }
}

/** 改节点值：`object.setKeyframeValue`（不动时间、不动插值）。 */
export function setKeyframeValueCommand(
  clipKey: string,
  path: string,
  time: number,
  value: JsonValue,
): DocCommand | null {
  if (path.length === 0 || !isWritableTime(time)) {
    return null
  }
  return { kind: 'object.setKeyframeValue', clipKey, path, time, value }
}

/** 关闭动画：`object.disableAnimation`（删该叶子全部帧、保留确定的值）。 */
export function disableAnimationCommand(clipKey: string, path: string): DocCommand | null {
  if (path.length === 0) {
    return null
  }
  return { kind: 'object.disableAnimation', clipKey, path }
}

/** 开启动画：`object.enableAnimation`（在给定时间建首帧）。 */
export function enableAnimationCommand(
  clipKey: string,
  path: string,
  time: number,
  value?: JsonValue,
): DocCommand | null {
  if (path.length === 0 || !isWritableTime(time)) {
    return null
  }
  return {
    kind: 'object.enableAnimation',
    clipKey,
    path,
    time,
    ...(value === undefined ? {} : { value }),
  }
}

/** 粘贴：`object.pasteKeyframes`；空剪贴板返回 `null`。 */
export function pasteKeyframesCommand(
  clipKey: string,
  path: string,
  clipboard: KeyframeClipboard,
  mode: 'merge' | 'replace',
  type?: string,
): DocCommand | null {
  if (path.length === 0 || clipboard.points.length === 0 || !isWritableTime(clipboard.anchor)) {
    return null
  }
  const points = clipboard.points
    .filter((point) => Number.isFinite(point.offset) && isJsonValue(point.value))
    .map((point) => ({ offset: point.offset, value: point.value as JsonValue }))
  if (points.length === 0) {
    return null
  }
  return {
    kind: 'object.pasteKeyframes',
    clipKey,
    path,
    mode,
    ...(type === undefined ? {} : { type }),
    anchor: clipboard.anchor,
    points,
  }
}

/** 偏移量的浮点净化：保留 6 位小数，避免 `0.30000000000000004` 这类尾数进入剪贴板。 */
function cleanOffset(offset: number): number {
  const rounded = Number(offset.toFixed(6))
  return Object.is(rounded, -0) ? 0 : rounded
}

/** 剪贴板里的值来自 `unknown` 字段（类型冻结），提交前收窄成可写入的 JSON 值。 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }
  if (isJsonObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item))
  }
  return false
}

/** 行半高（像素）：跨行框选的行级粗筛用（与 `ROW_LAYOUT.row` 同一口径）。 */
const ROW_HALF_HEIGHT = ROW_LAYOUT.row / 2

/**
 * 跨行框选（06-04 §三）：只返回矩形覆盖到的节点，不选组头、不选段线。
 *
 * `centers` 是 `layoutRows` 给出的行中心；`rows` 只应包含当前可见（已展开）的行。
 * 返回的每一项都是 `clipKey + path + time`，不含数组下标。
 */
export function selectionsInRect(input: {
  rows: readonly PropertyRow[]
  centers: ReadonlyMap<string, number>
  viewport: EffectViewport
  timing: ClipTiming
  selection: readonly KeyframeSelection[]
  playhead: number
  rect: { left: number; top: number; right: number; bottom: number }
}): KeyframeSelection[] {
  const picked: KeyframeSelection[] = []
  for (const row of input.rows) {
    const centerY = input.centers.get(row.path)
    if (centerY === undefined) {
      continue
    }
    if (centerY + ROW_HALF_HEIGHT < input.rect.top || centerY - ROW_HALF_HEIGHT > input.rect.bottom) {
      continue
    }
    const { nodes } = nodesOfRow({
      row,
      viewport: input.viewport,
      timing: input.timing,
      rowCenterY: centerY,
      playhead: input.playhead,
      selection: input.selection,
    })
    for (const node of nodesInRect(nodes, input.rect)) {
      picked.push({ clipKey: node.clipKey, path: node.path, time: node.time })
    }
  }
  return picked
}

/**
 * 从一行与一组选中时间生成剪贴板（06-05 §三）。
 *
 * 锚点 = 选中节点的最早时间；`points` 是"偏移 + 值"，不带片段键，因此天然不跨片段。
 * 没有选中项（或选中项在行里找不到）返回 `null`。
 */
export function clipboardFromRow(
  row: PropertyRow,
  selectedTimes: readonly number[],
): KeyframeClipboard | null {
  if (selectedTimes.length === 0 || row.keyframes.length === 0) {
    return null
  }
  const picked: Array<{ time: number; value: JsonValue }> = []
  for (const time of [...selectedTimes].sort((left, right) => left - right)) {
    const frame = row.keyframes.find((item) => sameTime(item.time, time))
    if (frame === undefined) {
      continue
    }
    if (picked.some((item) => sameTime(item.time, frame.time))) {
      continue
    }
    picked.push({ time: frame.time, value: frame.value })
  }
  if (picked.length === 0) {
    return null
  }
  const anchor = picked[0].time
  return {
    path: row.path,
    type: row.type,
    interp: row.interp,
    anchor,
    points: picked.map((item) => ({ offset: cleanOffset(item.time - anchor), value: item.value })),
  }
}
