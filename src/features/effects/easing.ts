/**
 * 段缓动采样（06-06 §三）：纯函数，是播放头预览、值控件当前值、烘焙三处共用的唯一值来源。
 *
 * 规则：
 * - 没有作者态缓动时按目录 `interp` 走：`linear`/`angle`/`geometric` 做线性插值，`step` 取左侧节点值；
 * - 有作者态缓动时按三次贝塞尔先解时间再求值；
 * - 端点精确返回节点值；
 * - 采样不修改节点、不生成临时节点、不往文档写缓存。
 *
 * 值为非数字（字符串 / 布尔 / 结构 / 事件记录）时不做插值，取左侧节点值——
 * 与运行时 `SampledProperty` 对非数值类型的行为一致，不发明中间值。
 */
import type { ObjectKeyframe } from '../../core/doc/types.ts'
import type { FieldInterp } from '../../core/schema/types.ts'
import type { AuthoringEasing, EasingHandle } from './types.ts'

/** 三次贝塞尔分量求值：给定参数 `s`，返回曲线的某一维。 */
function bezierComponent(p1: number, p2: number, s: number): number {
  const inverse = 1 - s
  return 3 * inverse * inverse * s * p1 + 3 * inverse * s * s * p2 + s * s * s
}

/** 贝塞尔把手归一化：横坐标夹在 0..1，纵坐标允许超出（过冲）。 */
export function normalizeHandle(handle: EasingHandle): EasingHandle {
  const x = Number.isFinite(handle.x) ? Math.min(1, Math.max(0, handle.x)) : 0
  const y = Number.isFinite(handle.y) ? handle.y : 0
  return { x, y }
}

/**
 * 解贝塞尔时间：给定归一化进度 `t`（0..1），求参数 `s` 使曲线横坐标等于 `t`。
 *
 * 二分 + 固定迭代次数：把手横坐标单调（都夹在 0..1）时解唯一，不引入外部求解器。
 */
function solveBezierParam(out: EasingHandle, inbound: EasingHandle, t: number): number {
  let low = 0
  let high = 1
  let s = t
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const x = bezierComponent(out.x, inbound.x, s)
    if (Math.abs(x - t) <= 1e-7) {
      return s
    }
    if (x < t) {
      low = s
    } else {
      high = s
    }
    s = (low + high) / 2
  }
  return s
}

/** 归一化进度（0..1）：段内时间线性映射。 */
function progressOf(time: number, from: number, to: number): number {
  const span = to - from
  if (!(span > 0)) {
    return 0
  }
  return Math.min(1, Math.max(0, (time - from) / span))
}

/** 角度最短路径插值；结果归一到 `(-180, 180]`（`SampledProperty.Compiled.angle`）。 */
function interpolateAngle(a: number, b: number, s: number): number {
  let delta = (b - a) % 360
  if (delta > 180) {
    delta -= 360
  } else if (delta <= -180) {
    delta += 360
  }
  let result = (a + delta * s) % 360
  if (result > 180) {
    result -= 360
  } else if (result <= -180) {
    result += 360
  }
  return result
}

/**
 * 几何插值 `exp(log a + (log b - log a) * s)`。
 *
 * 任一端 `<= 0` 时回落 `a`：运行时同样不做静默改线性、也不抛异常
 * （`SampledProperty.Compiled.geometric`）。
 */
function interpolateGeometric(a: number, b: number, s: number): number {
  if (a <= 0 || b <= 0) {
    return a
  }
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * s)
}

/** 按目录 `interp` 求值（`SampledProperty.Compiled.interpolateFloat` 同口径）。 */
function interpolateByInterp(interp: FieldInterp, a: number, b: number, s: number): number {
  switch (interp) {
    case 'angle':
      return interpolateAngle(a, b, s)
    case 'geometric':
      return interpolateGeometric(a, b, s)
    case 'step':
      // `STEP`：区间内保持前一帧，只在到达端点（s=1）时取后一帧。
      return s < 1 ? a : b
    case 'none':
      return s < 1 ? a : b
    default:
      return a + (b - a) * s
  }
}

/** 数值插值；任一端不是有限数字时退化为取左端值（不发明中间值）。 */
function interpolateNumbers(left: unknown, right: unknown, ratio: number, interp: FieldInterp): unknown {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return left
  }
  return interpolateByInterp(interp, left, right, ratio)
}

/** 找到 `time` 所在的段（左节点下标）；在首节点之前返回 `-1`，在末节点之后返回末下标。 */
export function segmentIndexAt(frames: readonly ObjectKeyframe[], time: number): number {
  if (frames.length === 0) {
    return -1
  }
  if (time < frames[0].time) {
    return -1
  }
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (time >= frames[index].time) {
      return index
    }
  }
  return -1
}

/**
 * 按片段时长过滤出「范围内」关键帧（`object-model.md` §3.4 第 1 步）。
 *
 * 有限片段 `0 <= time <= duration`；无限执行 `time >= 0`。
 * 越界帧**保留在文档里但不参与采样**（§3.5：这是正常语义，不是错误）。
 */
export function framesInRange(
  frames: readonly ObjectKeyframe[],
  timing: { duration: number; infinite: boolean },
): ObjectKeyframe[] {
  if (timing.infinite) {
    return frames.filter((frame) => frame.time >= 0)
  }
  return frames.filter((frame) => frame.time >= 0 && frame.time <= timing.duration)
}

/**
 * 采样一个属性在 `time` 的值（`object-model.md` §3.4 同口径）。
 *
 * 顺序固定：
 * 1. 取**范围内**关键帧（越界帧不参与，见 `framesInRange`）；
 * 2. 没有范围内帧 → 返回 `{ ok: false }`，由调用方回落到 `value` / 目录默认值；
 * 3. 只有一帧 → 整段恒值；
 * 4. `t` 在首帧前取首值、末帧后取末值；
 * 5. 否则按 `interp` 插值。
 *
 * 返回 `{ ok: false }` 表示"没有可用帧"，不是"值为零"。
 */
export function sampleValue(input: {
  frames: readonly ObjectKeyframe[]
  interp: FieldInterp
  time: number
  /** 片段时长上下文；省略表示不做范围过滤（烘焙等内部场景）。 */
  timing?: { duration: number; infinite: boolean }
  easing?: AuthoringEasing
}): { ok: true; value: unknown } | { ok: false } {
  const { interp, time, easing } = input
  const frames = input.timing === undefined
    ? input.frames
    : framesInRange(input.frames, input.timing)
  if (frames.length === 0) {
    return { ok: false }
  }
  if (frames.length === 1) {
    return { ok: true, value: frames[0].value }
  }
  if (time <= frames[0].time) {
    return { ok: true, value: frames[0].value }
  }
  const last = frames[frames.length - 1]
  if (time >= last.time) {
    return { ok: true, value: last.value }
  }
  const index = segmentIndexAt(frames, time)
  if (index < 0 || index >= frames.length - 1) {
    return { ok: true, value: last.value }
  }
  const left = frames[index]
  const right = frames[index + 1]
  const t = progressOf(time, left.time, right.time)

  if (interp === 'step') {
    // 与运行时一致：区间内保持前一帧，只有到达端点才取后一帧。
    return { ok: true, value: t < 1 ? left.value : right.value }
  }

  if (easing !== undefined && easing.mode === 'bezier'
    && Math.abs(easing.fromTime - left.time) <= 1e-6
    && Math.abs(easing.toTime - right.time) <= 1e-6) {
    const out = normalizeHandle(easing.out)
    const inbound = normalizeHandle(easing.in)
    const s = solveBezierParam(out, inbound, t)
    const ratio = bezierComponent(out.y, inbound.y, s)
    // 作者态贝塞尔替换的是"时间→进度"的映射；端点类型语义仍按目录 interp 走。
    return { ok: true, value: interpolateNumbers(left.value, right.value, ratio, interp) }
  }

  return { ok: true, value: interpolateNumbers(left.value, right.value, t, interp) }
}

/**
 * 烘焙采样密度：每秒采样数（`legacy/src/operations.ts` 的 `BAKE_KEYFRAMES_PER_SECOND`）。
 *
 * 依据 `plans/0.3.6/script-model.md §4.1`「每段变速 ≈8–20 个采样关键帧」。
 */
export const BAKE_KEYFRAMES_PER_SECOND = 4

/** 一段烘焙后的关键帧总数下限（含起止）。 */
export const BAKE_MIN_KEYFRAMES = 8

/** 一段烘焙后的关键帧总数上限（含起止）。 */
export const BAKE_MAX_KEYFRAMES = 20

/**
 * 一段烘焙后的关键帧**总数**（含起止端点）：`round(段时长 × 4) + 2`，钳到 `[8, 20]`。
 *
 * 刻意按**秒**推导而不是按像素：烘焙结果必须与当前缩放无关，
 * 否则同一份文档在两台机器（或同一台换次缩放）会烘出不同节点数，不可复现。
 */
export function bakeSampleCount(fromTime: number, toTime: number): number {
  const span = toTime - fromTime
  if (!(span > 0)) {
    return BAKE_MIN_KEYFRAMES
  }
  const total = Math.round(span * BAKE_KEYFRAMES_PER_SECOND) + 2
  return Math.max(BAKE_MIN_KEYFRAMES, Math.min(BAKE_MAX_KEYFRAMES, total))
}

/**
 * 生成一段的烘焙采样点（06-06 §三）：保留原起止节点，中间按曲线采样。
 *
 * 采样值来自 `sampleValue`（同一函数），因此烘焙结果与预览完全一致。
 */
export function bakeSegment(input: {
  frames: readonly ObjectKeyframe[]
  interp: FieldInterp
  fromTime: number
  toTime: number
  easing?: AuthoringEasing
}): Array<{ time: number; value: unknown }> {
  const { frames, interp, fromTime, toTime, easing } = input
  const start = frames.find((frame) => Math.abs(frame.time - fromTime) <= 1e-6)
  const end = frames.find((frame) => Math.abs(frame.time - toTime) <= 1e-6)
  if (start === undefined || end === undefined) {
    return []
  }
  const total = bakeSampleCount(fromTime, toTime)
  // 中间点数 = 总数 − 2（起止各占一个）；间隔必须 > 0，否则补帧时间会与相邻帧重合。
  const inner = total - 2
  const step = inner > 0 ? (toTime - fromTime) / (inner + 1) : 0
  if (inner > 0 && !(step > 0)) {
    return [{ time: fromTime, value: start.value }, { time: toTime, value: end.value }]
  }
  const points: Array<{ time: number; value: unknown }> = [{ time: fromTime, value: start.value }]
  for (let index = 1; index <= inner; index += 1) {
    const time = fromTime + step * index
    const sample = sampleValue({ frames, interp, time, ...(easing === undefined ? {} : { easing }) })
    if (!sample.ok) {
      continue
    }
    points.push({ time, value: sample.value })
  }
  points.push({ time: toTime, value: end.value })
  return points
}
