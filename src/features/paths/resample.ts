/**
 * 12-10 曲线工具 · 弧长重采样：把时间映射重写成匀速等分的关键帧形态。
 *
 * 边界（对齐 `plan/12/12-10-curve-tools.md` 三、4.1、4.3）：
 * - 只产出新的 `timing` JSON；不写位置关键帧、不写控制点、不改几何 / 端点 / 轴；
 * - 时间映射只复用现有 `linear` / `keyframes` 两种形态，不新增类型；
 * - 首点固定 (0,0)、末点固定 (1,1)，t / s 单调不减，至少两点；
 * - 编辑器积分与运行时求值不保证逐位一致，预览匀速只是近似，最终以游戏播放为准。
 *
 * 口径（按模组运行时事实实现，见下「口径偏差」）：
 * 运行时 `s` 是**归一化弧长进度**；`PathEvaluator` 内部先用 `ArcLengthTable.uAt(s)`
 * 反解出几何参数 u 再求值，`PathTiming.linear` 即 `s = u`。因此「在弧长上匀速」
 * 就是 `s(t) = t`：本模块把作者原有的非匀速映射重写成匀速等分点表
 * `t_i = s_i = i / (n-1)`，不再做「弧长反解成几何参数」的双重反解。
 * 几何数值积分只用于两件事：(a) 退化零弧长报错；(b) 在结果里报告总弧长。
 *
 * 口径偏差（文档 / 源码不一致，提交用户确认）：
 * 12-10 §4.1 的「弧长反解」措辞属于旧运行时模型（把 `s` 当几何参数分量），与当前
 * `PathEvaluator` / `ArcLengthTable` 事实不一致；这里按代码事实实现为 `s=t` 等分。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { validateGeometry } from '../../core/paths/geometry.ts'
import { buildGeometry, sampleGeometry, type Vec3 } from '../../core/paths/sampling.ts'
import { validateTiming, timingJson, TIMING_MAX_POINTS, type TimingPoint } from '../../core/paths/timing.ts'
import type { PathAxis } from '../../core/paths/types.ts'
import type { CurveDiagnostic } from './shapeEntries.ts'

/** 一次重采样输入。 */
export interface ResampleInput {
  geometry: JsonObject
  from: Vec3
  to: Vec3
  axes: readonly PathAxis[]
  /** 目标点数（含首末）；非法值回退到 2。 */
  samples: number
  /** 当前时间映射（只读；用于保留形态口径，不就地修改）。 */
  timing: JsonValue | undefined
  /** 数值积分密采样数（含首末；缺省 128）。 */
  denseCount?: number
}

/** 重采样结果。 */
export interface ResampleResult {
  ok: boolean
  timing: JsonObject | null
  points: TimingPoint[]
  diagnostics: CurveDiagnostic[]
  /** 积分得到的总弧长（表达式空间；退化时为 0）。 */
  arcLength: number
}

const MIN_DENSE = 16
const MAX_DENSE = 512
const LENGTH_EPSILON = 1e-9

/**
 * 按匀速等分重写时间映射：`t_i = s_i = i / (n-1)`。
 * 几何积分仅用于退化零弧长拦截与总弧长报告。`ok === false` 时 `timing` 为 null，
 * 原因见 `diagnostics`。
 */
export function resampleTiming(input: ResampleInput): ResampleResult {
  const diagnostics: CurveDiagnostic[] = []

  const geometryIssues = validateGeometry(input.geometry)
  for (const issue of geometryIssues) {
    diagnostics.push({ code: `resample.${issue.field}`, severity: 'error', message: issue.message })
  }
  if (diagnostics.some((issue) => issue.severity === 'error')) {
    return { ok: false, timing: null, points: [], diagnostics, arcLength: 0 }
  }

  let evaluation
  try {
    evaluation = buildGeometry(input.geometry, input.from, input.to)
  } catch (error) {
    diagnostics.push({
      code: 'resample.geometry',
      severity: 'block',
      message: `几何求值失败：${error instanceof Error ? error.message : String(error)}`,
    })
    return { ok: false, timing: null, points: [], diagnostics, arcLength: 0 }
  }

  // 积分：仅求总弧长（退化检测 + 报告），不参与点表反解。
  const denseCount = clampInteger(input.denseCount ?? 128, MIN_DENSE, MAX_DENSE)
  const samples = sampleGeometry(evaluation, denseCount)
  let total = 0
  for (let index = 1; index < samples.length; index += 1) {
    total += distance(samples[index - 1]!.point, samples[index]!.point)
  }
  if (total <= LENGTH_EPSILON) {
    diagnostics.push({ code: 'resample.degenerate', severity: 'block', message: '几何退化为一个点，无法按弧长重采样' })
    return { ok: false, timing: null, points: [], diagnostics, arcLength: 0 }
  }

  // 匀速等分：弧长进度与时间进度同表，s = t。
  const pointCount = clampInteger(Math.round(input.samples), 2, TIMING_MAX_POINTS)
  const points: TimingPoint[] = []
  for (let index = 0; index < pointCount; index += 1) {
    const fraction = pointCount === 1 ? 0 : index / (pointCount - 1)
    points.push({ t: fraction, s: fraction })
  }

  const timing: JsonObject = timingJson('keyframes', points)
  const timingIssues = validateTiming(timing)
  for (const issue of timingIssues) {
    diagnostics.push({ code: `resample.${issue.field}`, severity: 'error', message: issue.message })
  }
  const block = diagnostics.some((issue) => issue.severity === 'block' || issue.severity === 'error')
  return {
    ok: !block,
    timing: block ? null : timing,
    points: block ? [] : points,
    diagnostics,
    arcLength: total,
  }
}

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z)
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
