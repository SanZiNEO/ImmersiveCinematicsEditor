/**
 * 调色曲线点集：校验、单调 PCHIP 采样与 SVG 预览。
 *
 * 运行时 `ColorCurve` 要求：点是 `[x,y]` 且 0..1、x 严格递增、至少 2 点；
 * 采样是单调三次（PCHIP），不会像 Catmull-Rom 那样过冲。
 */

export type CurvePoint = [number, number]

export interface CurveParseResult {
  ok: boolean
  points: CurvePoint[]
  issues: string[]
}

/** 解析并校验曲线点集；缺省 / null 视为空（没有曲线）。 */
export function parseCurvePoints(raw: unknown): CurveParseResult {
  if (raw === undefined || raw === null) {
    return { ok: true, points: [], issues: [] }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, points: [], issues: ['曲线必须是点数组 [[x,y],…]'] }
  }
  const points: CurvePoint[] = []
  const issues: string[] = []
  let previousX = -Infinity
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (!Array.isArray(item) || item.length !== 2) {
      issues.push(`第 ${index + 1} 个点不是 [x,y] 二元数组`)
      continue
    }
    const x = item[0]
    const y = item[1]
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
      issues.push(`第 ${index + 1} 个点的 x 需要 0..1 的有限数字`)
      continue
    }
    if (typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1) {
      issues.push(`第 ${index + 1} 个点的 y 需要 0..1 的有限数字`)
      continue
    }
    if (x <= previousX + 1e-9) {
      issues.push(`第 ${index + 1} 个点的 x 没有严格递增`)
      continue
    }
    previousX = x
    points.push([x, y])
  }
  if (points.length > 0 && points.length < 2) {
    issues.push('曲线至少需要 2 个点')
  }
  return { ok: issues.length === 0, points, issues }
}

/** Fritsch–Carlson 单调三次插值（PCHIP）。 */
export function sampleCurve(points: readonly CurvePoint[], x: number): number {
  if (points.length === 0) return Math.max(0, Math.min(1, x))
  if (points.length === 1) return points[0]![1]
  const clamped = Math.max(0, Math.min(1, x))
  if (clamped <= points[0]![0]) return points[0]![1]
  const last = points[points.length - 1]!
  if (clamped >= last[0]) return last[1]

  let index = 0
  while (index < points.length - 2 && clamped > points[index + 1]![0]) index += 1
  const p0 = points[index]!
  const p1 = points[index + 1]!
  const h = p1[0] - p0[0]
  const t = (clamped - p0[0]) / h

  const slopes: number[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    slopes.push((b[1] - a[1]) / (b[0] - a[0]))
  }
  const tangents: number[] = []
  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) tangents.push(slopes[0]!)
    else if (i === points.length - 1) tangents.push(slopes[slopes.length - 1]!)
    else {
      const before = slopes[i - 1]!
      const after = slopes[i]!
      tangents.push(before * after <= 0 ? 0 : (before + after) / 2)
    }
  }
  // 单调性修正（Fritsch–Carlson）。
  for (let i = 0; i < slopes.length; i += 1) {
    const slope = slopes[i]!
    if (Math.abs(slope) < 1e-12) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const alpha = tangents[i]! / slope
    const beta = tangents[i + 1]! / slope
    const magnitude = alpha * alpha + beta * beta
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      tangents[i] = scale * alpha * slope
      tangents[i + 1] = scale * beta * slope
    }
  }

  const m0 = tangents[index]! * h
  const m1 = tangents[index + 1]! * h
  const t2 = t * t
  const t3 = t2 * t
  const value = (2 * t3 - 3 * t2 + 1) * p0[1]
    + (t3 - 2 * t2 + t) * m0
    + (-2 * t3 + 3 * t2) * p1[1]
    + (t3 - t2) * m1
  return Math.max(0, Math.min(1, value))
}

/** 采样成 SVG 折线点（`width` / `height` 为像素）。 */
export function curvePolyline(
  points: readonly CurvePoint[],
  width: number,
  height: number,
  samples = 64,
): string {
  if (points.length === 0) return ''
  const parts: string[] = []
  for (let index = 0; index <= samples; index += 1) {
    const x = index / samples
    const y = sampleCurve(points, x)
    parts.push(`${(x * width).toFixed(2)},${((1 - y) * height).toFixed(2)}`)
  }
  return parts.join(' ')
}

/** 编辑时在两个邻点之间夹取 x（保持严格递增）。 */
export function clampPointX(points: readonly CurvePoint[], index: number, x: number): number {
  const lower = index === 0 ? 0 : points[index - 1]![0] + 1e-4
  const upper = index === points.length - 1 ? 1 : points[index + 1]![0] - 1e-4
  return Math.max(lower, Math.min(upper, Math.max(0, Math.min(1, x))))
}

/** 默认曲线（0→0、1→1）。 */
export const DEFAULT_CURVE_POINTS: readonly CurvePoint[] = [[0, 0], [1, 1]]
