/**
 * 07-08 时间映射编辑器的纯逻辑：linear / keyframes 两模式、点表操作、校验映射、
 * s(t) 只读采样。
 *
 * 红线：timing 只影响推进，绝不改几何；切几何 / 改 from-to 都不清 timing（本模块不持有
 * 几何与区间）。点表工作副本可暂存未排序状态，保存时由 core `timingJson` 按 t 稳定排序。
 */
import type { JsonValue } from '../../core/doc/types.ts'
import {
  TIMING_MAX_POINTS,
  insertTimingPoint,
  resetTimingS,
  sortTimingPoints,
  timingCurveSamples,
  timingJson,
  timingKind,
  timingPoints,
  validateTiming,
  type TimingIssue,
  type TimingPoint,
} from '../../core/paths/timing.ts'

export { TIMING_MAX_POINTS }

/** 编辑器草稿（未提交不落盘）。 */
export interface TimingDraft {
  kind: 'linear' | 'keyframes'
  /** 工作副本；顺序可与保存形态不同，保存时按 t 稳定排序。 */
  points: TimingPoint[]
}

/** 从文档 timing 读草稿；省略 / null = linear。 */
export function readTimingDraft(timing: JsonValue | undefined): TimingDraft {
  const kind = timingKind(timing)
  if (kind === 'linear') {
    return { kind: 'linear', points: [] }
  }
  return { kind: 'keyframes', points: timingPoints(timing) }
}

/** 写盘形态：linear 只写 `{type:'linear'}`；keyframes 写排序后的点表。 */
export function timingDraftJson(draft: TimingDraft): JsonValue {
  return timingJson(draft.kind, draft.points)
}

/** 切回线性：点表移除（一次撤销可恢复由命令层快照保证）。 */
export function switchToLinear(): TimingDraft {
  return { kind: 'linear', points: [] }
}

/**
 * 切到关键帧：已有 keyframes 保留点表；否则自动生成 `(0,0)` 与 `(1,1)` 两行，中间为空。
 */
export function switchToKeyframes(current: TimingDraft): TimingDraft {
  if (current.kind === 'keyframes' && current.points.length >= 2) {
    return { kind: 'keyframes', points: current.points.map((point) => ({ ...point })) }
  }
  return {
    kind: 'keyframes',
    points: [
      { t: 0, s: 0 },
      { t: 1, s: 1 },
    ],
  }
}

/** 首末行固定；中间行才可增删改。 */
export function isFixedEndpoint(index: number, length: number): boolean {
  return index === 0 || index === length - 1
}

/**
 * 在 `afterIndex` 与下一行之间插入中点（相邻中点、线性插值 t/s）。
 * 达到 256 上限时返回 null：第 257 个被拒绝，既有表不截断。
 */
export function addPoint(draft: TimingDraft, afterIndex: number): TimingDraft | null {
  if (draft.kind !== 'keyframes') {
    return null
  }
  const next = insertTimingPoint(draft.points, afterIndex)
  return next === null ? null : { kind: 'keyframes', points: next }
}

/** 删除中间点；首末行拒绝。 */
export function removePoint(draft: TimingDraft, index: number): TimingDraft | null {
  if (draft.kind !== 'keyframes') {
    return null
  }
  if (isFixedEndpoint(index, draft.points.length)) {
    return null
  }
  const next = draft.points.filter((_, itemIndex) => itemIndex !== index)
  return { kind: 'keyframes', points: next }
}

/** 中间点上移 / 下移；首末行与越界拒绝。 */
export function movePoint(
  draft: TimingDraft,
  index: number,
  direction: -1 | 1,
): TimingDraft | null {
  if (draft.kind !== 'keyframes') {
    return null
  }
  if (isFixedEndpoint(index, draft.points.length)) {
    return null
  }
  const target = index + direction
  if (target < 1 || target >= draft.points.length - 1) {
    return null
  }
  const next = draft.points.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return { kind: 'keyframes', points: next }
}

/**
 * 改中间点的 t / s；首末行拒绝（首点必须 (0,0)、末点必须 (1,1)）。
 * 非有限数字由校验拦下，这里只做固定行保护。
 */
export function updatePoint(
  draft: TimingDraft,
  index: number,
  field: 't' | 's',
  value: number,
): TimingDraft | null {
  if (draft.kind !== 'keyframes') {
    return null
  }
  if (isFixedEndpoint(index, draft.points.length)) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const next = draft.points.map((point, itemIndex) => (
    itemIndex === index ? { ...point, [field]: value } : point
  ))
  return { kind: 'keyframes', points: next }
}

/** 「按弧长复位」：中间点 s 改成与 t 相同，保留 t。 */
export function resetS(draft: TimingDraft): TimingDraft {
  if (draft.kind !== 'keyframes') {
    return draft
  }
  return { kind: 'keyframes', points: resetTimingS(draft.points) }
}

/**
 * 字段级校验（映射到 `points[i].t` / `points[i].s`）；linear 无错误。
 * 校验按工作副本顺序（与 core `validateTiming` 同口径）；保存时再由 `timingDraftJson`
 * 按 t 稳定排序。
 */
export function draftIssues(draft: TimingDraft, prefix = 'timing'): TimingIssue[] {
  if (draft.kind === 'linear') {
    return []
  }
  return validateTiming(
    { type: 'keyframes', points: draft.points.map((point) => ({ ...point })) },
    prefix,
  )
}

/** s(t) 折线采样（只读小图用；含首末点）。 */
export function draftSamples(
  draft: TimingDraft,
  sampleCount = 33,
): Array<{ u: number; s: number }> {
  return timingCurveSamples(timingDraftJson(draft), sampleCount)
}

/** 保存前按 t 稳定排序后的点表（相同 t 保持添加顺序）。 */
export function sortedPoints(draft: TimingDraft): TimingPoint[] {
  return sortTimingPoints(draft.points)
}
