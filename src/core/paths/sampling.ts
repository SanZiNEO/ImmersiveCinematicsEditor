/**
 * 07-10 路径几何采样：11 种曲线按参数 u **均匀**采样（不是弧长参数化）。
 *
 * 公式逐项对齐 Java：
 * - Bezier / 有理 Bezier：Bernstein 基；控制点相对段起点解析；
 * - B-spline / NURBS：de Boor，缺省钳制均匀节点；
 * - Catmull-Rom：Barry–Goldman 切线 + 三次 Hermite（三种参数化、mirror/clamp）；
 * - Hermite：端点切线原样参与三次 Hermite；
 * - Arc / Ellipse：ConicSegmentBuilder 的 `ceil(|Δ|/90)` 段有理二次 Bezier；
 * - Clothoid：Fresnel C/S 两段求值；
 * - Fourier：周期形态 a0+Σ(cos·cosθ+sin·sinθ)，非周期形态三次趋势 + 受约束残差。
 *
 * 预览坐标是表达式空间（段起点为 `from` 的绝对分量），不做 absolute/world/base 变换。
 */
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { readPoint, readVector } from './geometry.ts'
import { isPathObject } from './types.ts'

export type Vec3 = { x: number; y: number; z: number }

export interface GeometryEvaluation {
  /** 锚点语义。 */
  anchor: 'ENDPOINTS' | 'FREE' | 'START'
  /** 几何真实起点 / 终点（表达式空间）。 */
  start: Vec3
  end: Vec3
  /** 采样函数；u 会被夹到 [0,1]。 */
  position: (u: number) => Vec3
  /** 一阶导（dP/du）；不可解析时返回 null。 */
  derivative: ((u: number) => Vec3) | null
  controlPolygon: Vec3[] | null
  /** 采样前就知道的提示（退化、周期首尾同点等）。 */
  warnings: string[]
  /** 段数（arc/ellipse 的 `ceil(|Δ|/90)`；其它类型 1）。 */
  segments: number
}

const TWO_PI = Math.PI * 2
const NEAR_CIRCULAR = 1e-6
const PARALLEL_EPSILON = 1e-9
const MIN_DISTANCE = 1e-9

/** 构造求值器；几何非法时抛出（调用方应先 validateGeometry）。 */
export function buildGeometry(
  geometry: JsonObject,
  from: Vec3,
  to: Vec3,
): GeometryEvaluation {
  const rawType = geometry.type
  const type = rawType === 'line' ? 'linear' : rawType
  switch (type) {
    case 'linear':
      return buildLinear(from, to)
    case 'bezier':
      return buildBezier(geometry, from, to)
    case 'rational_bezier':
      return buildRationalBezier(geometry, from, to)
    case 'arc':
      return buildArc(geometry, from, to, false)
    case 'ellipse':
      return buildArc(geometry, from, to, true)
    case 'bspline':
      return buildBSpline(geometry, from, to, false)
    case 'nurbs':
      return buildBSpline(geometry, from, to, true)
    case 'catmull_rom':
      return buildCatmullRom(geometry, from, to)
    case 'hermite':
      return buildHermite(geometry, from, to)
    case 'clothoid':
      return buildClothoid(geometry, from, to)
    case 'fourier':
      return buildFourier(geometry, from, to)
    default:
      throw new Error(`未知几何类型 '${String(rawType)}'`)
  }
}

/** 采样 n 个点（含首末），按 u 均匀；切线用解析导数或中心差分。 */
export function sampleGeometry(
  evaluation: GeometryEvaluation,
  count: number,
): Array<{ u: number; point: Vec3; tangent: Vec3 | null }> {
  const sampleCount = Math.max(2, Math.trunc(count))
  const result: Array<{ u: number; point: Vec3; tangent: Vec3 | null }> = []
  for (let index = 0; index < sampleCount; index += 1) {
    const u = index / (sampleCount - 1)
    const point = finiteVec(evaluation.position(u))
    const derivative = evaluation.derivative === null
      ? numericDerivative(evaluation.position, u)
      : evaluation.derivative(u)
    result.push({ u, point, tangent: normalize(derivative) })
  }
  return result
}

/** 读路径端点（从片段 position 三轴取当前值）。 */
export function endpointValue(
  component: number | null,
  fallback: number,
): number {
  return component !== null && Number.isFinite(component) ? component : fallback
}

// ── 线性 / Bezier / 有理 Bezier ─────────────────────────────────────────────

function buildLinear(from: Vec3, to: Vec3): GeometryEvaluation {
  return {
    anchor: 'ENDPOINTS',
    start: from,
    end: to,
    position: (u) => lerp(from, to, clamp01(u)),
    derivative: () => sub(to, from),
    controlPolygon: [from, to],
    warnings: [],
    segments: 1,
  }
}

function buildBezier(geometry: JsonObject, from: Vec3, to: Vec3): GeometryEvaluation {
  const raw = geometry.control_points
  const list = Array.isArray(raw) ? raw : []
  const p1 = resolvePoint(list[0], from) ?? from
  const p2 = resolvePoint(list[1], from) ?? to
  const warnings: string[] = []
  if (samePoint(from, p1) && samePoint(p1, p2) && samePoint(p2, to)) {
    warnings.push('全部控制点重合：曲线退化为一个点')
  }
  return {
    anchor: 'ENDPOINTS',
    start: from,
    end: to,
    position: (u) => cubicBezier(from, p1, p2, to, clamp01(u)),
    derivative: (u) => cubicBezierDerivative(from, p1, p2, to, clamp01(u)),
    controlPolygon: [from, p1, p2, to],
    warnings,
    segments: 1,
  }
}

function buildRationalBezier(geometry: JsonObject, from: Vec3, to: Vec3): GeometryEvaluation {
  const raw = geometry.control_points
  const points = Array.isArray(raw) ? raw : []
  const weightsRaw = geometry.weights
  const weights = Array.isArray(weightsRaw) ? weightsRaw : []
  const degree = points.length + 1
  const control: Vec3[] = [from]
  for (const point of points) {
    control.push(resolvePoint(point, from) ?? from)
  }
  control.push(to)
  const fullWeights: number[] = [1]
  for (const weight of weights) {
    fullWeights.push(typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1)
  }
  fullWeights.push(1)
  const position = (u: number): Vec3 => {
    const t = clamp01(u)
    const basis = bernsteinBasis(degree, t)
    let wx = 0
    let wy = 0
    let wz = 0
    let denominator = 0
    for (let index = 0; index <= degree; index += 1) {
      const weight = fullWeights[index] * basis[index]
      denominator += weight
      wx += weight * control[index].x
      wy += weight * control[index].y
      wz += weight * control[index].z
    }
    if (denominator === 0) {
      return control[0]
    }
    return { x: wx / denominator, y: wy / denominator, z: wz / denominator }
  }
  return {
    anchor: 'ENDPOINTS',
    start: from,
    end: to,
    position,
    derivative: null,
    controlPolygon: control,
    warnings: [],
    segments: 1,
  }
}

// ── B-spline / NURBS ───────────────────────────────────────────────────────

function buildBSpline(geometry: JsonObject, from: Vec3, to: Vec3, rational: boolean): GeometryEvaluation {
  const raw = geometry.control_points
  const points = Array.isArray(raw) ? raw : []
  const control: Vec3[] = [from]
  for (const point of points) {
    control.push(resolvePoint(point, from) ?? from)
  }
  control.push(to)
  const degree = typeof geometry.degree === 'number' ? geometry.degree : 3
  const controlCount = control.length
  const knots = Array.isArray(geometry.knots)
    ? (geometry.knots as number[])
    : uniformClampedKnots(controlCount, degree)
  const weights: number[] = [1]
  if (rational) {
    const rawWeights = geometry.weights
    const list = Array.isArray(rawWeights) ? rawWeights : []
    for (const weight of list) {
      weights.push(typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1)
    }
    weights.push(1)
  } else {
    for (let index = 0; index < controlCount; index += 1) {
      weights.push(1)
    }
  }
  const lower = knots[degree]
  const upper = knots[controlCount]
  const position = (u: number): Vec3 => {
    const value = lower + (upper - lower) * clamp01(u)
    const cx = control.map((point) => point.x)
    const cy = control.map((point) => point.y)
    const cz = control.map((point) => point.z)
    if (!rational) {
      return {
        x: deBoor(cx, degree, knots, value),
        y: deBoor(cy, degree, knots, value),
        z: deBoor(cz, degree, knots, value),
      }
    }
    const denominator = deBoor(weights, degree, knots, value)
    if (denominator === 0) {
      return control[0]
    }
    return {
      x: deBoor(cx.map((value, index) => value * weights[index]), degree, knots, value) / denominator,
      y: deBoor(cy.map((value, index) => value * weights[index]), degree, knots, value) / denominator,
      z: deBoor(cz.map((value, index) => value * weights[index]), degree, knots, value) / denominator,
    }
  }
  return {
    anchor: 'ENDPOINTS',
    start: position(0),
    end: position(1),
    position,
    derivative: null,
    controlPolygon: control,
    warnings: [],
    segments: 1,
  }
}

/** 钳制均匀节点：首 p+1 项 0、末 p+1 项 1、中间 j/(m-p)。 */
function uniformClampedKnots(controlCount: number, degree: number): number[] {
  const knots = new Array<number>(controlCount + degree + 1)
  for (let index = 0; index < knots.length; index += 1) {
    if (index <= degree) {
      knots[index] = 0
    } else if (index >= controlCount) {
      knots[index] = 1
    } else {
      knots[index] = (index - degree) / (controlCount - degree)
    }
  }
  return knots
}

/** BSplineBasis.findSpan：u clamp 到 [knots[p], knots[m]]；右端返回 m-1。 */
function findSpan(knots: number[], degree: number, controlCount: number, u: number): number {
  const lower = knots[degree]
  const upper = knots[controlCount]
  const value = u >= lower ? u : lower
  if (value >= upper) {
    return controlCount - 1
  }
  let low = degree
  let high = controlCount
  let mid = (low + high) >>> 1
  while (value < knots[mid] || value >= knots[mid + 1]) {
    if (value < knots[mid]) {
      high = mid
    } else {
      low = mid
    }
    mid = (low + high) >>> 1
  }
  return mid
}

/** 标量 de Boor（与 BSplineBasis.deBoor 同算式）。 */
function deBoor(ctrl: number[], degree: number, knots: number[], u: number): number {
  const controlCount = ctrl.length
  const lower = knots[degree]
  const upper = knots[controlCount]
  let value = u >= lower ? u : lower
  if (value >= upper) {
    value = upper
  }
  const span = findSpan(knots, degree, controlCount, value)
  const first = span - degree
  const work: number[] = []
  for (let j = 0; j <= degree; j += 1) {
    work[j] = ctrl[first + j]
  }
  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const index = first + j
      const denominator = knots[index + degree - r + 1] - knots[index]
      const alpha = denominator === 0 ? 0 : (value - knots[index]) / denominator
      work[j] = (1 - alpha) * work[j - 1] + alpha * work[j]
    }
  }
  return work[degree]
}

// ── Catmull-Rom ────────────────────────────────────────────────────────────

function buildCatmullRom(geometry: JsonObject, from: Vec3, to: Vec3): GeometryEvaluation {
  const raw = geometry.points
  const points = Array.isArray(raw) ? raw : []
  const px: number[] = [from.x]
  const py: number[] = [from.y]
  const pz: number[] = [from.z]
  for (const point of points) {
    const resolved = resolvePoint(point, from)
    if (resolved !== null) {
      px.push(resolved.x)
      py.push(resolved.y)
      pz.push(resolved.z)
    }
  }
  px.push(to.x)
  py.push(to.y)
  pz.push(to.z)
  const parameterization = typeof geometry.parameterization === 'string' ? geometry.parameterization : 'centripetal'
  const alpha = parameterization === 'uniform' ? 0 : parameterization === 'chordal' ? 1 : 0.5
  const tension = typeof geometry.tension === 'number' ? geometry.tension : 1
  const endpoint = typeof geometry.endpoint === 'string' ? geometry.endpoint : 'mirror'
  const pointCount = px.length
  const last = pointCount - 1
  const segments = last
  const ghostStart = endpoint === 'mirror'
    ? { x: 2 * px[0] - px[1], y: 2 * py[0] - py[1], z: 2 * pz[0] - pz[1] }
    : { x: px[0], y: py[0], z: pz[0] }
  const ghostEnd = endpoint === 'mirror'
    ? { x: 2 * px[last] - px[last - 1], y: 2 * py[last] - py[last - 1], z: 2 * pz[last] - pz[last - 1] }
    : { x: px[last], y: py[last], z: pz[last] }
  const t: number[] = [0]
  for (let index = 0; index < last; index += 1) {
    t[index + 1] = t[index] + stepLength(px[index], py[index], pz[index], px[index + 1], py[index + 1], pz[index + 1], alpha)
  }
  const tGhostStart = t[0] - stepLength(px[0], py[0], pz[0], ghostStart.x, ghostStart.y, ghostStart.z, alpha)
  const tGhostEnd = t[last] + stepLength(px[last], py[last], pz[last], ghostEnd.x, ghostEnd.y, ghostEnd.z, alpha)
  const mx: number[] = new Array(pointCount)
  const my: number[] = new Array(pointCount)
  const mz: number[] = new Array(pointCount)
  for (let index = 0; index < pointCount; index += 1) {
    const prevT = index === 0 ? tGhostStart : t[index - 1]
    const nextT = index === last ? tGhostEnd : t[index + 1]
    const prevX = index === 0 ? ghostStart.x : px[index - 1]
    const prevY = index === 0 ? ghostStart.y : py[index - 1]
    const prevZ = index === 0 ? ghostStart.z : pz[index - 1]
    const nextX = index === last ? ghostEnd.x : px[index + 1]
    const nextY = index === last ? ghostEnd.y : py[index + 1]
    const nextZ = index === last ? ghostEnd.z : pz[index + 1]
    mx[index] = tension * barryGoldman(prevX, px[index], nextX, prevT, t[index], nextT)
    my[index] = tension * barryGoldman(prevY, py[index], nextY, prevT, t[index], nextT)
    mz[index] = tension * barryGoldman(prevZ, pz[index], nextZ, prevT, t[index], nextT)
  }
  const t0x: number[] = new Array(segments)
  const t0y: number[] = new Array(segments)
  const t0z: number[] = new Array(segments)
  const t1x: number[] = new Array(segments)
  const t1y: number[] = new Array(segments)
  const t1z: number[] = new Array(segments)
  for (let index = 0; index < segments; index += 1) {
    const span = t[index + 1] - t[index]
    t0x[index] = mx[index] * span
    t0y[index] = my[index] * span
    t0z[index] = mz[index] * span
    t1x[index] = mx[index + 1] * span
    t1y[index] = my[index + 1] * span
    t1z[index] = mz[index + 1] * span
  }
  const position = (u: number): Vec3 => {
    const unit = clamp01(u)
    const g = unit * segments
    const index = Math.min(segments - 1, Math.floor(g))
    const s = g - index
    const s2 = s * s
    const s3 = s2 * s
    const h00 = 2 * s3 - 3 * s2 + 1
    const h10 = s3 - 2 * s2 + s
    const h01 = -2 * s3 + 3 * s2
    const h11 = s3 - s2
    return {
      x: h00 * px[index] + h10 * t0x[index] + h01 * px[index + 1] + h11 * t1x[index],
      y: h00 * py[index] + h10 * t0y[index] + h01 * py[index + 1] + h11 * t1y[index],
      z: h00 * pz[index] + h10 * t0z[index] + h01 * pz[index + 1] + h11 * t1z[index],
    }
  }
  const controlPolygon: Vec3[] = []
  for (let index = 0; index < pointCount; index += 1) {
    controlPolygon.push({ x: px[index], y: py[index], z: pz[index] })
  }
  return {
    anchor: 'ENDPOINTS',
    start: position(0),
    end: position(1),
    position,
    derivative: null,
    controlPolygon,
    warnings: [],
    segments,
  }
}

function stepLength(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  alpha: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return Math.pow(Math.max(distance, MIN_DISTANCE), alpha)
}

function barryGoldman(
  previous: number,
  current: number,
  next: number,
  previousT: number,
  currentT: number,
  nextT: number,
): number {
  const left = currentT - previousT
  const right = nextT - currentT
  const span = nextT - previousT
  return (((current - previous) / left) * right + ((next - current) / right) * left) / span
}

// ── Hermite ────────────────────────────────────────────────────────────────

function buildHermite(geometry: JsonObject, from: Vec3, to: Vec3): GeometryEvaluation {
  const raw = geometry.tangents
  const list = Array.isArray(raw) ? raw : []
  const t0 = resolvePoint(list[0], from) ?? { x: 0, y: 0, z: 0 }
  const t1 = resolvePoint(list[1], to) ?? { x: 0, y: 0, z: 0 }
  const position = (u: number): Vec3 => {
    const t = clamp01(u)
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    return {
      x: h00 * from.x + h10 * t0.x + h01 * to.x + h11 * t1.x,
      y: h00 * from.y + h10 * t0.y + h01 * to.y + h11 * t1.y,
      z: h00 * from.z + h10 * t0.z + h01 * to.z + h11 * t1.z,
    }
  }
  return {
    anchor: 'ENDPOINTS',
    start: from,
    end: to,
    position,
    derivative: (u) => {
      const t = clamp01(u)
      const t2 = t * t
      const d00 = 6 * (t2 - t)
      const d10 = 3 * t2 - 4 * t + 1
      const d01 = -6 * (t2 - t)
      const d11 = 3 * t2 - 2 * t
      return {
        x: d00 * from.x + d10 * t0.x + d01 * to.x + d11 * t1.x,
        y: d00 * from.y + d10 * t0.y + d01 * to.y + d11 * t1.y,
        z: d00 * from.z + d10 * t0.z + d01 * to.z + d11 * t1.z,
      }
    },
    controlPolygon: [from, add(from, t0), sub(to, t1), to],
    warnings: [],
    segments: 1,
  }
}

// ── Arc / Ellipse（ConicSegmentBuilder）──────────────────────────────────────

interface ConicGeometry {
  center: Vec3
  segments: number
  control: Vec3[]
  middleWeights: number[]
  position: (u: number) => Vec3
  derivative: (u: number) => Vec3
}

function buildArc(geometry: JsonObject, from: Vec3, to: Vec3, ellipse: boolean): GeometryEvaluation {
  const center = resolvePoint(geometry.center, from) ?? { x: 0, y: 0, z: 0 }
  const a = ellipse && typeof geometry.semi_major === 'number' ? geometry.semi_major : (geometry.radius as number)
  const b = ellipse && typeof geometry.semi_minor === 'number' ? geometry.semi_minor : (geometry.radius as number)
  const rotation = ellipse && typeof geometry.rotation === 'number' ? geometry.rotation : 0
  const startAngle = geometry.start_angle as number
  const endAngle = geometry.end_angle as number
  const normal = readVector(geometry.normal) ?? { x: 0, y: 1, z: 0 }
  const reference = readVector(geometry.reference_axis) ?? { x: 1, y: 0, z: 0 }
  const conic = buildConic(center, a, b, rotation, startAngle, endAngle, normal, reference)
  const warnings: string[] = []
  const sweep = Math.abs(endAngle - startAngle)
  if (sweep > 0 && conic.segments > 1) {
    warnings.push(`角度跨度 ${sweep.toFixed(3)}° 被拆成 ${conic.segments} 段有理二次 Bézier（每段 ≤ 90°）`)
  }
  return {
    anchor: 'FREE',
    start: conic.position(0),
    end: conic.position(1),
    position: conic.position,
    derivative: conic.derivative,
    controlPolygon: null,
    warnings,
    segments: conic.segments,
  }
}

function buildConic(
  center: Vec3,
  a: number,
  b: number,
  rotationDegrees: number,
  startDegrees: number,
  endDegrees: number,
  normalRaw: Vec3,
  referenceRaw: Vec3,
): ConicGeometry {
  const normal = unit(normalRaw)
  const reference = unit(referenceRaw)
  const projected = sub(reference, scale(normal, dot(normal, reference)))
  const uAxis = normalize(projected) ?? anyPerpendicular(normal)
  const vAxis = normalize(cross(normal, uAxis))
  if (vAxis === null) {
    throw new Error('法向平面基底退化')
  }
  const rotation = (rotationDegrees * Math.PI) / 180
  const cosRotation = Math.cos(rotation)
  const sinRotation = Math.sin(rotation)
  const majorAxis = add(scale(uAxis, cosRotation), scale(vAxis, sinRotation))
  const minorAxis = sub(scale(vAxis, cosRotation), scale(uAxis, sinRotation))
  const sweep = endDegrees - startDegrees
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / 90))
  const stepRadians = ((sweep * Math.PI) / 180) / segments
  const halfStep = 0.5 * stepRadians
  const weight = Math.cos(halfStep)
  const startRadians = (startDegrees * Math.PI) / 180
  const control: Vec3[] = []
  const middleWeights: number[] = []
  for (let index = 0; index < segments; index += 1) {
    const angle0 = startRadians + stepRadians * index
    const angle1 = startRadians + stepRadians * (index + 1)
    const angleMid = startRadians + stepRadians * (index + 0.5)
    control.push(conicPoint(a, b, angle0, majorAxis, minorAxis))
    control.push(scale(conicPoint(a, b, angleMid, majorAxis, minorAxis), 1 / weight))
    control.push(conicPoint(a, b, angle1, majorAxis, minorAxis))
    middleWeights.push(weight)
  }
  const position = (u: number): Vec3 => {
    const value = clamp01(u)
    const scaled = value * segments
    const index = Math.min(segments - 1, Math.floor(scaled))
    const t = scaled - index
    const s = 1 - t
    const b0 = s * s
    const b1 = 2 * t * s
    const b2 = t * t
    const w1 = middleWeights[index]
    const denominator = b0 + w1 * b1 + b2
    const base = index * 3
    const x = (b0 * control[base].x + w1 * b1 * control[base + 1].x + b2 * control[base + 2].x) / denominator
    const y = (b0 * control[base].y + w1 * b1 * control[base + 1].y + b2 * control[base + 2].y) / denominator
    const z = (b0 * control[base].z + w1 * b1 * control[base + 1].z + b2 * control[base + 2].z) / denominator
    return { x: center.x + x, y: center.y + y, z: center.z + z }
  }
  const derivative = (u: number): Vec3 => {
    const value = clamp01(u)
    const scaled = value * segments
    const index = Math.min(segments - 1, Math.floor(scaled))
    const t = scaled - index
    const s = 1 - t
    const w1 = middleWeights[index]
    const b0 = s * s
    const b1 = 2 * t * s
    const b2 = t * t
    const d0 = -2 * s
    const d1 = 2 - 4 * t
    const d2 = 2 * t
    const denominator = b0 + w1 * b1 + b2
    const denominatorFirst = d0 + w1 * d1 + d2
    const base = index * 3
    const n = (component: 'x' | 'y' | 'z'): number => {
      const c0 = control[base][component]
      const c1 = control[base + 1][component]
      const c2 = control[base + 2][component]
      const numerator = b0 * c0 + w1 * b1 * c1 + b2 * c2
      const numeratorFirst = d0 * c0 + w1 * d1 * c1 + d2 * c2
      return ((numeratorFirst * denominator - numerator * denominatorFirst) / (denominator * denominator)) * segments
    }
    return { x: n('x'), y: n('y'), z: n('z') }
  }
  return { center, segments, control, middleWeights, position, derivative }
}

function conicPoint(a: number, b: number, angle: number, majorAxis: Vec3, minorAxis: Vec3): Vec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: a * cosine * majorAxis.x + b * sine * minorAxis.x,
    y: a * cosine * majorAxis.y + b * sine * minorAxis.y,
    z: a * cosine * majorAxis.z + b * sine * minorAxis.z,
  }
}

// ── Clothoid ───────────────────────────────────────────────────────────────

function buildClothoid(geometry: JsonObject, from: Vec3, _to: Vec3): GeometryEvaluation {
  const startCurvature = geometry.start_curvature as number
  const endCurvature = geometry.end_curvature as number
  const length = geometry.length as number
  const tangent = unit(readVector(geometry.start_direction) ?? { x: 1, y: 0, z: 0 })
  const normal = unit(readVector(geometry.normal) ?? { x: 0, y: 1, z: 0 })
  const left = normalize(cross(normal, tangent))
  if (left === null) {
    throw new Error('过渡平面法向与起点切线平行')
  }
  interface ClothoidState {
    circular: boolean
    curvature: number
    sign: number
    amplitude: number
    argumentScale: number
    offset: number
    cosPhase: number
    sinPhase: number
    startArgument: number
  }
  const rate = (endCurvature - startCurvature) / length
  const useCircle = !Number.isFinite(rate) || Math.abs(rate) * length * length <= NEAR_CIRCULAR
  let state: ClothoidState
  if (useCircle) {
    state = {
      circular: true,
      curvature: 0.5 * startCurvature + 0.5 * endCurvature,
      sign: 0,
      amplitude: 0,
      argumentScale: 0,
      offset: 0,
      cosPhase: 0,
      sinPhase: 0,
      startArgument: 0,
    }
  } else {
    const phase = (startCurvature * startCurvature) / (2 * rate)
    state = {
      circular: false,
      curvature: 0,
      sign: rate > 0 ? 1 : -1,
      amplitude: Math.sqrt(Math.PI / Math.abs(rate)),
      argumentScale: Math.sqrt(Math.abs(rate) / Math.PI),
      offset: startCurvature / rate,
      cosPhase: Math.cos(phase),
      sinPhase: Math.sin(phase),
      startArgument: (startCurvature / rate) * Math.sqrt(Math.abs(rate) / Math.PI),
    }
  }
  const position = (u: number): Vec3 => {
    const s = length * clamp01(u)
    if (state.circular) {
      let x: number
      let y: number
      if (state.curvature === 0) {
        x = s
        y = 0
      } else {
        const angle = state.curvature * s
        x = Math.sin(angle) / state.curvature
        const halfSin = Math.sin(0.5 * angle)
        y = (2 * halfSin * halfSin) / state.curvature
      }
      return {
        x: from.x + tangent.x * x + left.x * y,
        y: from.y + tangent.y * x + left.y * y,
        z: from.z + tangent.z * x + left.z * y,
      }
    }
    const argument = (s + state.offset) * state.argumentScale
    const deltaC = fresnelC(argument) - fresnelC(state.startArgument)
    const deltaS = fresnelS(argument) - fresnelS(state.startArgument)
    const x = state.amplitude * (state.cosPhase * deltaC + state.sign * state.sinPhase * deltaS)
    const y = state.amplitude * (state.sign * state.cosPhase * deltaS - state.sinPhase * deltaC)
    return {
      x: from.x + tangent.x * x + left.x * y,
      y: from.y + tangent.y * x + left.y * y,
      z: from.z + tangent.z * x + left.z * y,
    }
  }
  const angleAt = (s: number): number => startCurvature * s + 0.5 * rate * s * s
  const derivative = (u: number): Vec3 => {
    const s = length * clamp01(u)
    const angle = angleAt(s)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      x: (tangent.x * cos + left.x * sin) * length,
      y: (tangent.y * cos + left.y * sin) * length,
      z: (tangent.z * cos + left.z * sin) * length,
    }
  }
  const warnings: string[] = []
  if (state.circular) {
    warnings.push('曲率变化率接近 0：按中点曲率圆弧闭式求值')
  }
  return {
    anchor: 'START',
    start: from,
    end: position(1),
    position,
    derivative,
    controlPolygon: null,
    warnings,
    segments: 1,
  }
}

// ── Fourier ────────────────────────────────────────────────────────────────

function buildFourier(geometry: JsonObject, from: Vec3, to: Vec3): GeometryEvaluation {
  const a0 = readVector(geometry.a0) ?? { x: 0, y: 0, z: 0 }
  const cosList = readVectorList(geometry.cos)
  const sinList = readVectorList(geometry.sin)
  const period = geometry.period as number
  const periodic = geometry.periodic !== false
  const startVelocity = readVector(geometry.start_velocity) ?? { x: 0, y: 0, z: 0 }
  const endVelocity = readVector(geometry.end_velocity) ?? { x: 0, y: 0, z: 0 }
  if (periodic) {
    const position = (u: number): Vec3 => {
      const angle = TWO_PI * (clamp01(u) / period)
      let x = a0.x
      let y = a0.y
      let z = a0.z
      for (let index = 0; index < cosList.length; index += 1) {
        const theta = angle * (index + 1)
        const cosine = Math.cos(theta)
        const sine = Math.sin(theta)
        const a = cosList[index]
        const b = sinList[index]
        x += a.x * cosine + b.x * sine
        y += a.y * cosine + b.y * sine
        z += a.z * cosine + b.z * sine
      }
      return { x, y, z }
    }
    const derivative = (u: number): Vec3 => {
      const angle = TWO_PI * (clamp01(u) / period)
      const scale = TWO_PI / period
      let x = 0
      let y = 0
      let z = 0
      for (let index = 0; index < cosList.length; index += 1) {
        const k = index + 1
        const theta = angle * k
        const cosine = Math.cos(theta)
        const sine = Math.sin(theta)
        const a = cosList[index]
        const b = sinList[index]
        const weight = scale * k
        x += weight * (b.x * cosine - a.x * sine)
        y += weight * (b.y * cosine - a.y * sine)
        z += weight * (b.z * cosine - a.z * sine)
      }
      return { x, y, z }
    }
    return {
      anchor: 'FREE',
      start: position(0),
      end: position(1),
      position,
      derivative,
      controlPolygon: null,
      warnings: ['周期路径首尾同点（u=0 与 u=1 重合）'],
      segments: 1,
    }
  }
  const trendStart = scale(startVelocity, period)
  const trendEnd = scale(endVelocity, period)
  const position = (u: number): Vec3 => {
    const t = clamp01(u) / period
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    let x = h00 * from.x + h10 * trendStart.x + h01 * to.x + h11 * trendEnd.x
    let y = h00 * from.y + h10 * trendStart.y + h01 * to.y + h11 * trendEnd.y
    let z = h00 * from.z + h10 * trendStart.z + h01 * to.z + h11 * trendEnd.z
    const angle = TWO_PI * t
    const window = t * (1 - t)
    for (let index = 0; index < cosList.length; index += 1) {
      const theta = angle * (index + 1)
      const even = 1 - Math.cos(theta)
      const odd = 4 * Math.sin(theta) * window
      const a = cosList[index]
      const b = sinList[index]
      x += a.x * even + b.x * odd
      y += a.y * even + b.y * odd
      z += a.z * even + b.z * odd
    }
    return { x, y, z }
  }
  return {
    anchor: 'ENDPOINTS',
    start: from,
    end: to,
    position,
    derivative: null,
    controlPolygon: [from, sub(to, trendEnd), add(from, trendStart), to],
    warnings: [],
    segments: 1,
  }
}

// ── Fresnel ────────────────────────────────────────────────────────────────

const SERIES_LIMIT = 3.53
const SERIES_EPSILON = 1e-17
const ASYMPTOTIC_EPSILON = 1e-18
const MAX_TERMS = 256
const HALF_PI = Math.PI / 2
const HALF_PI_SQUARED = HALF_PI * HALF_PI

export function fresnelC(z: number): number {
  if (z === 0) {
    return 0
  }
  const magnitude = Math.abs(z)
  const value = magnitude <= SERIES_LIMIT ? fresnelSeriesC(magnitude) : fresnelAsymptotic(magnitude, false)
  return z < 0 ? -value : value
}

export function fresnelS(z: number): number {
  if (z === 0) {
    return 0
  }
  const magnitude = Math.abs(z)
  const value = magnitude <= SERIES_LIMIT ? fresnelSeriesS(magnitude) : fresnelAsymptotic(magnitude, true)
  return z < 0 ? -value : value
}

function fresnelSeriesC(z: number): number {
  const z2 = z * z
  const factor = -HALF_PI_SQUARED * z2 * z2
  let term = z
  let sum = term
  for (let k = 0; k < MAX_TERMS; k += 1) {
    term *= (factor * (4 * k + 1)) / ((4 * k + 5) * (2 * k + 1) * (2 * k + 2))
    sum += term
    if (Math.abs(term) < SERIES_EPSILON) {
      break
    }
  }
  return sum
}

function fresnelSeriesS(z: number): number {
  const z2 = z * z
  const factor = -HALF_PI_SQUARED * z2 * z2
  let term = (HALF_PI * z * z2) / 3
  let sum = term
  for (let k = 0; k < MAX_TERMS; k += 1) {
    term *= (factor * (4 * k + 3)) / ((4 * k + 7) * (2 * k + 2) * (2 * k + 3))
    sum += term
    if (Math.abs(term) < SERIES_EPSILON) {
      break
    }
  }
  return sum
}

function fresnelAsymptotic(z: number, cosinePart: boolean): number {
  const w = Math.PI * z * z
  const phase = 0.5 * w
  const sine = Math.sin(phase)
  const cosine = Math.cos(phase)
  let term = 1 / (Math.PI * z)
  let sign = 1
  let sum = 0
  let previous = Infinity
  for (let n = 0; n < MAX_TERMS; n += 1) {
    if (n > 0) {
      term *= (2 * n - 1) / w
      if ((n & 1) === 1) {
        sign = -sign
      }
    }
    if (term >= previous) {
      break
    }
    const signed = sign * term
    if (cosinePart) {
      sum += (n & 1) === 0 ? -signed * cosine : signed * sine
    } else {
      sum += (n & 1) === 0 ? signed * sine : signed * cosine
    }
    previous = term
    if (term < ASYMPTOTIC_EPSILON) {
      break
    }
  }
  return 0.5 + sum
}

// ── 向量与基元 ─────────────────────────────────────────────────────────────

function resolvePoint(raw: JsonValue | undefined, segmentStart: Vec3): Vec3 | null {
  const point = readPoint(raw, segmentStart)
  return point === null ? null : point.point
}

function readVectorList(raw: JsonValue | undefined): Vec3[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const result: Vec3[] = []
  for (const item of raw) {
    const vector = readVector(item)
    if (vector !== null) {
      result.push(vector)
    }
  }
  return result
}

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const s = 1 - u
  const b0 = s * s * s
  const b1 = 3 * s * s * u
  const b2 = 3 * s * u * u
  const b3 = u * u * u
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    z: b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z,
  }
}

function cubicBezierDerivative(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const s = 1 - u
  const d0 = 3 * s * s
  const d1 = 6 * s * u
  const d2 = 3 * u * u
  return {
    x: d0 * (p1.x - p0.x) + d1 * (p2.x - p1.x) + d2 * (p3.x - p2.x),
    y: d0 * (p1.y - p0.y) + d1 * (p2.y - p1.y) + d2 * (p3.y - p2.y),
    z: d0 * (p1.z - p0.z) + d1 * (p2.z - p1.z) + d2 * (p3.z - p2.z),
  }
}

function bernsteinBasis(degree: number, t: number): number[] {
  const result: number[] = []
  for (let index = 0; index <= degree; index += 1) {
    result.push(binomial(degree, index) * Math.pow(t, index) * Math.pow(1 - t, degree - index))
  }
  return result
}

function binomial(n: number, k: number): number {
  let value = 1
  for (let index = 0; index < k; index += 1) {
    value = (value * (n - index)) / (index + 1)
  }
  return value
}

function numericDerivative(position: (u: number) => Vec3, u: number): Vec3 | null {
  const h = 1e-5
  const left = position(Math.max(0, u - h))
  const right = position(Math.min(1, u + h))
  const span = Math.min(1, u + h) - Math.max(0, u - h)
  if (span <= 0) {
    return null
  }
  return {
    x: (right.x - left.x) / span,
    y: (right.y - left.y) / span,
    z: (right.z - left.z) / span,
  }
}

function finiteVec(vector: Vec3): Vec3 {
  return {
    x: Number.isFinite(vector.x) ? vector.x : 0,
    y: Number.isFinite(vector.y) ? vector.y : 0,
    z: Number.isFinite(vector.z) ? vector.z : 0,
  }
}

function samePoint(left: Vec3, right: Vec3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z
}

function clamp01(value: number): number {
  if (!(value > 0)) {
    return 0
  }
  return value < 1 ? value : 1
}

function lerp(left: Vec3, right: Vec3, u: number): Vec3 {
  return {
    x: left.x + (right.x - left.x) * u,
    y: left.y + (right.y - left.y) * u,
    z: left.z + (right.z - left.z) * u,
  }
}

function add(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }
}

function sub(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }
}

function scale(vector: Vec3, factor: number): Vec3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }
}

function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function unit(vector: Vec3): Vec3 {
  const normalized = normalize(vector)
  return normalized ?? { x: 0, y: 0, z: 0 }
}

function normalize(vector: Vec3 | null): Vec3 | null {
  if (vector === null) {
    return null
  }
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!Number.isFinite(length) || length < 1e-12) {
    return null
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function anyPerpendicular(normal: Vec3): Vec3 {
  const candidate = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  return normalize(cross(normal, candidate)) ?? { x: 0, y: 1, z: 0 }
}
