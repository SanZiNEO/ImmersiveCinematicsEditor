/**
 * 07-08 路径时间映射：`timing` 的校验、稳定排序与 s(u) 求值。
 *
 * 事实基准 `PathTiming.java`：
 * - 缺省 / `{type:'linear'}` = s(u)=u；
 * - keyframes：至少 2 点、首 (0,0)、末 (1,1)、t/s 均非减且落在 [0,1]、有限；
 * - 相等 t 合法：取**后一个**点的 s（运行时跳变）；相等 s 合法（路径暂停）；
 * - 求值按 u 落在 [0,1] 内，最后一段线性插值。
 */
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { isPathObject } from './types.ts'

/** 时间映射类型。 */
export type TimingKind = 'linear' | 'keyframes'

/** 一个 timing 点。 */
export interface TimingPoint {
  t: number
  s: number
}

/** 一条 timing 诊断（字段级定位）。 */
export interface TimingIssue {
  field: string
  message: string
}

/** 编辑器一次最多添加的点数（07-08：第 257 个添加被拒；已有多于 256 点的表仍可保存）。 */
export const TIMING_MAX_POINTS = 256

/** 读类型：缺省 / null → linear。 */
export function timingKind(timing: JsonValue | undefined): TimingKind {
  if (!isPathObject(timing)) {
    return 'linear'
  }
  const type = timing.type
  return type === 'keyframes' ? 'keyframes' : 'linear'
}

/** 读点表（原文档顺序；不排序、不改值）。 */
export function timingPoints(timing: JsonValue | undefined): TimingPoint[] {
  if (!isPathObject(timing) || timing.type !== 'keyframes' || !Array.isArray(timing.points)) {
    return []
  }
  const points: TimingPoint[] = []
  for (const raw of timing.points) {
    if (isPathObject(raw) && typeof raw.t === 'number' && typeof raw.s === 'number') {
      points.push({ t: raw.t, s: raw.s })
    }
  }
  return points
}

/** 按 t 稳定排序（相同 t 保留原顺序；JS `Array#sort` 是稳定排序）。 */
export function sortTimingPoints(points: readonly TimingPoint[]): TimingPoint[] {
  return points
    .map((point, index) => ({ point, index }))
    .sort((left, right) => (left.point.t - right.point.t) || (left.index - right.index))
    .map((entry) => entry.point)
}

/** 校验 timing；返回空数组表示合法。 */
export function validateTiming(timing: JsonValue | undefined, fieldPrefix = 'timing'): TimingIssue[] {
  const issues: TimingIssue[] = []
  if (timing === undefined || timing === null) {
    return issues
  }
  if (!isPathObject(timing)) {
    issues.push({ field: fieldPrefix, message: 'timing 需要对象 {type: linear | keyframes, ...}' })
    return issues
  }
  for (const key of Object.keys(timing)) {
    if (key !== 'type' && key !== 'points') {
      issues.push({ field: `${fieldPrefix}.${key}`, message: `未知键（keyframes 只接受 type / points，实际 ${key}）` })
    }
  }
  const type = timing.type
  if (type === undefined || type === null) {
    // 缺省 type 视为 linear（PathCollectionParser.parseTiming）。
    if (timing.points !== undefined) {
      issues.push({ field: `${fieldPrefix}.points`, message: '线性时间映射不接受 points' })
    }
    return issues
  }
  if (type !== 'linear' && type !== 'keyframes') {
    issues.push({ field: `${fieldPrefix}.type`, message: `未知时间映射类型 ${String(type)}（可选: linear, keyframes）` })
    return issues
  }
  if (type === 'linear') {
    if (timing.points !== undefined) {
      issues.push({ field: `${fieldPrefix}.points`, message: 'linear 只接受 type，不写 points' })
    }
    return issues
  }
  const rawPoints = timing.points
  if (!Array.isArray(rawPoints)) {
    issues.push({ field: `${fieldPrefix}.points`, message: 'keyframes 需要 points 数组（至少 2 个点 {t, s}）' })
    return issues
  }
  if (rawPoints.length < 2) {
    issues.push({ field: `${fieldPrefix}.points`, message: `至少 2 个点（实际 ${rawPoints.length}）` })
    return issues
  }
  let previousT = Number.NEGATIVE_INFINITY
  let previousS = Number.NEGATIVE_INFINITY
  for (let index = 0; index < rawPoints.length; index += 1) {
    const point = rawPoints[index]
    const base = `${fieldPrefix}.points[${index}]`
    if (!isPathObject(point)) {
      issues.push({ field: base, message: '需要对象 {t, s}' })
      continue
    }
    for (const key of Object.keys(point)) {
      if (key !== 't' && key !== 's') {
        issues.push({ field: `${base}.${key}`, message: `未知键 ${key}（只接受 t / s）` })
      }
    }
    const t = point.t
    const s = point.s
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      issues.push({ field: `${base}.t`, message: 't 需要有限数字（不允许 NaN / 无穷）' })
    } else if (t < 0 || t > 1) {
      issues.push({ field: `${base}.t`, message: `t 必须落在 [0,1]（实际 ${t}）` })
    } else if (t < previousT) {
      issues.push({ field: `${base}.t`, message: `t 必须单调非减（前一帧 ${previousT}，实际 ${t}）` })
    } else {
      previousT = t
    }
    if (typeof s !== 'number' || !Number.isFinite(s)) {
      issues.push({ field: `${base}.s`, message: 's 需要有限数字（不允许 NaN / 无穷）' })
    } else if (s < 0 || s > 1) {
      issues.push({ field: `${base}.s`, message: `s 必须落在 [0,1]（实际 ${s}）` })
    } else if (s < previousS) {
      issues.push({ field: `${base}.s`, message: `s 必须单调非减（前一帧 ${previousS}，实际 ${s}）` })
    } else {
      previousS = s
    }
  }
  if (issues.length > 0) {
    return issues
  }
  const first = rawPoints[0] as JsonObject
  const last = rawPoints[rawPoints.length - 1] as JsonObject
  if (first.t !== 0 || first.s !== 0) {
    issues.push({ field: `${fieldPrefix}.points[0]`, message: '首点必须为 (t=0, s=0)' })
  }
  if (last.t !== 1 || last.s !== 1) {
    issues.push({ field: `${fieldPrefix}.points[${rawPoints.length - 1}]`, message: '末点必须为 (t=1, s=1)' })
  }
  return issues
}

/** 求值 s(u)：线性 = u；keyframes = 相邻点线性插值（相等 t 后值跳变）。 */
export function evaluateTimingS(timing: JsonValue | undefined, u: number): number {
  if (timingKind(timing) === 'linear') {
    return u
  }
  const points = sortTimingPoints(timingPoints(timing))
  if (points.length === 0) {
    return u
  }
  if (u <= points[0].t) {
    return points[0].s
  }
  if (u >= points[points.length - 1].t) {
    return points[points.length - 1].s
  }
  // 找最后一个 t <= u 的点（相同 t 时后一个点胜出）。
  let low = 0
  let high = points.length - 1
  let index = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (points[mid].t <= u) {
      index = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  const current = points[index]
  const next = points[index + 1]
  if (next === undefined || next.t === current.t) {
    return index === points.length - 1 ? current.s : points[points.length - 1].s
  }
  const span = next.t - current.t
  const local = (u - current.t) / span
  return current.s + (next.s - current.s) * local
}

/** 采样 s(u) 折线（用于只读小图；含首末点）。 */
export function timingCurveSamples(timing: JsonValue | undefined, sampleCount = 33): Array<{ u: number; s: number }> {
  const count = Math.max(2, Math.trunc(sampleCount))
  const result: Array<{ u: number; s: number }> = []
  for (let index = 0; index < count; index += 1) {
    const u = index / (count - 1)
    result.push({ u, s: evaluateTimingS(timing, u) })
  }
  return result
}

/** 写盘形态：linear 只写 `{type:'linear'}`；keyframes 写点表（按 t 稳定排序）。 */
export function timingJson(kind: TimingKind, points: readonly TimingPoint[] = []): JsonObject {
  if (kind === 'linear') {
    return { type: 'linear' }
  }
  return {
    type: 'keyframes',
    points: sortTimingPoints(points).map((point) => ({ t: point.t, s: point.s })),
  }
}

/** 在相邻两点之间插入中点（新增点默认取当前行与下一行的中点并线性插值）。 */
export function insertTimingPoint(points: readonly TimingPoint[], afterIndex: number): TimingPoint[] | null {
  if (points.length >= TIMING_MAX_POINTS) {
    return null
  }
  const left = points[afterIndex]
  const right = points[afterIndex + 1]
  if (left === undefined || right === undefined) {
    return null
  }
  const inserted: TimingPoint = {
    t: (left.t + right.t) / 2,
    s: (left.s + right.s) / 2,
  }
  const next = points.slice()
  next.splice(afterIndex + 1, 0, inserted)
  return next
}

/** 「按弧长复位」：中间点的 s 改成与 t 相同（保留 t）。 */
export function resetTimingS(points: readonly TimingPoint[]): TimingPoint[] {
  return points.map((point, index) => (index === 0 || index === points.length - 1
    ? point
    : { t: point.t, s: point.t }))
}

/** 片段时间 → 归一化 u（from/to 来自路径条目，不是整段脚本时间）。 */
export function normalizedU(time: number, from: number, to: number): number {
  const span = to - from
  if (!Number.isFinite(span) || span <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (time - from) / span))
}
