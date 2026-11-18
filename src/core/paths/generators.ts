/**
 * 07-07 圆形 / 圆弧 / 椭圆生成器：由形状参数算出位置边界帧与 `paths[]` 条目。
 *
 * 不调用运行时，不新增曲线类型；写出的就是 `PathCurveRegistry` 已接受的手工几何。
 * 角度按 `delta = sign * |end - start|`（方向开关强制符号），全圆为 |Δ| = 360。
 */
import type { JsonObject, ScriptDoc } from '../doc/types.ts'
import { clipPositionNodes } from '../doc/identity.ts'
import { pathEntries } from './collection.ts'
import type { ShapeGenerationPlan, ShapeGeneratorSpec } from './types.ts'

interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ShapeGenerationResult {
  plan: ShapeGenerationPlan | null
  issues: string[]
  /** 将替换的既有路径 id（同片段、同端点对）。 */
  replacedPathIds: string[]
  /** 需要删除的既有路径 id（作者确认删除受影响路径时由调用方填充）。 */
  deletePathIds: string[]
}

/** 计算生成计划；issues 非空（block）时 plan 为 null。 */
export function planShapeGeneration(doc: ScriptDoc, spec: ShapeGeneratorSpec): ShapeGenerationResult {
  const issues: string[] = []
  const warnings: string[] = []
  const nodes = clipPositionNodes(doc, spec.clip)
  if (nodes.length < 2) {
    issues.push(`目标片段 ${spec.clip} 位置节点不足（${nodes.length} 个，至少 2 个）`)
  }
  const fromIndex = nodes.indexOf(spec.from)
  const toIndex = nodes.indexOf(spec.to)
  if (fromIndex < 0 || toIndex < 0) {
    issues.push('生成区间端点必须是目标片段的位置节点时间')
  } else if (toIndex !== fromIndex + 1) {
    issues.push('生成区间端点必须相邻（中间不能跨过其他位置节点）')
  }
  const span = Math.abs(spec.endAngle - spec.startAngle)
  if (!Number.isFinite(span) || span === 0) {
    issues.push('起止角不能相同（跨度 0）')
  }
  if (span > 360) {
    issues.push(`角度跨度必须 ≤ 360°（实际 ${span}°）`)
  }
  if (!(spec.radius > 0) && (spec.shape === 'circle' || spec.shape === 'arc')) {
    issues.push('半径必须 > 0')
  }
  if (spec.shape === 'ellipse' && (!(spec.semiMajor > 0) || !(spec.semiMinor > 0))) {
    issues.push('长短半轴必须 > 0')
  }
  if (length(spec.normal) === 0 || length(spec.referenceAxis) === 0) {
    issues.push('法向与参考轴不能是零向量')
  } else if (normalizedCross(spec.normal, spec.referenceAxis) < 1e-9) {
    issues.push('法向与参考轴不能平行（坐标系退化）')
  }
  if (spec.segments !== 'auto') {
    if (!Number.isInteger(spec.segments) || spec.segments < 1) {
      issues.push('分段数必须是 ≥ 1 的整数')
    }
  }
  if (issues.length > 0) {
    return { plan: null, issues, replacedPathIds: [], deletePathIds: [] }
  }
  const delta = (spec.clockwise ? -1 : 1) * span
  const mode = spec.mode
  const control = buildConicBasis(spec.normal, spec.referenceAxis)
  const pointAt = (angleDegrees: number): Vec3 => anglePoint(spec, control, angleDegrees)
  const autoSegments = Math.max(1, Math.ceil(Math.abs(delta) / 90))
  const requestedSegments = spec.segments === 'auto' ? autoSegments : spec.segments
  if (mode === 'bezier' && requestedSegments < autoSegments) {
    warnings.push(
      `分段数 ${requestedSegments} 少于自动值 ${autoSegments}：单段超过 90°，圆弧逼近误差会变大`,
    )
  }

  // ── 边界时间 ────────────────────────────────────────────────────────────
  let boundaryTimes: number[]
  let removeTimes: number[] = []
  if (spec.timeMode === 'keep-nodes') {
    const inside = nodes.filter((time) => time >= spec.from && time <= spec.to)
    boundaryTimes = [...inside]
    const needed = mode === 'exact' ? 1 : requestedSegments
    for (let index = 1; index < boundaryTimes.length && mode === 'bezier'; index += 1) {
      const localSpan = boundaryTimes[index] - boundaryTimes[index - 1]
      const angleSpan = Math.abs(delta * (localSpan / (spec.to - spec.from)))
      if (angleSpan > 90 + 1e-9) {
        const extra = Math.ceil(angleSpan / 90) - 1
        for (let sub = 1; sub <= extra; sub += 1) {
          const time = boundaryTimes[index - 1] + (localSpan * sub) / (extra + 1)
          boundaryTimes.push(time)
        }
      }
    }
    boundaryTimes.sort((left, right) => left - right)
    if (boundaryTimes[0] !== spec.from) {
      boundaryTimes.unshift(spec.from)
    }
    if (boundaryTimes[boundaryTimes.length - 1] !== spec.to) {
      boundaryTimes.push(spec.to)
    }
    if (boundaryTimes.length - 1 < needed) {
      warnings.push(`现有节点只能形成 ${boundaryTimes.length - 1} 段，少于请求的 ${needed} 段；已按节点节奏生成`)
    }
  } else {
    removeTimes = nodes.filter((time) => time > spec.from && time < spec.to)
    boundaryTimes = []
    const count = mode === 'exact' ? 1 : requestedSegments
    for (let index = 0; index <= count; index += 1) {
      boundaryTimes.push(spec.from + ((spec.to - spec.from) * index) / count)
    }
    boundaryTimes[0] = spec.from
    boundaryTimes[boundaryTimes.length - 1] = spec.to
  }

  // ── 边界值 ──────────────────────────────────────────────────────────────
  const totalSpan = spec.to - spec.from
  const firstPoint = pointAt(spec.startAngle)
  const keyTimes = boundaryTimes.map((time, index) => {
    const fraction = totalSpan === 0 ? 0 : (time - spec.from) / totalSpan
    const angle = spec.startAngle + delta * fraction
    const point = index === boundaryTimes.length - 1 && Math.abs(delta) === 360
      ? firstPoint
      : pointAt(angle)
    return { time, point: [point.x, point.y, point.z] as [number, number, number] }
  })

  // ── 路径条目 ─────────────────────────────────────────────────────────────
  const paths: JsonObject[] = []
  if (mode === 'exact') {
    paths.push(exactPath(spec, pointAt(spec.startAngle), `p_${nextPathNumber(doc)}`))
  } else {
    let counter = nextPathNumber(doc)
    for (let index = 0; index < boundaryTimes.length - 1; index += 1) {
      const startTime = boundaryTimes[index]
      const endTime = boundaryTimes[index + 1]
      const startPoint = pointAt(spec.startAngle + delta * ((startTime - spec.from) / totalSpan))
      const endPoint = index === boundaryTimes.length - 2 && Math.abs(delta) === 360
        ? firstPoint
        : pointAt(spec.startAngle + delta * ((endTime - spec.from) / totalSpan))
      const startAngle = spec.startAngle + delta * ((startTime - spec.from) / totalSpan)
      const endAngle = spec.startAngle + delta * ((endTime - spec.from) / totalSpan)
      paths.push(bezierSegment(spec, startPoint, endPoint, startAngle, endAngle, `p_${counter}`, startTime, endTime))
      counter += 1
    }
  }

  // ── 影响面 ───────────────────────────────────────────────────────────────
  const replacedPathIds: string[] = []
  const impactedPaths: string[] = []
  const allPaths = pathEntries(doc)
  for (const view of allPaths) {
    if (view.clipId !== spec.clip) {
      continue
    }
    // 完全落在生成区间内的旧条目由本次生成替换；部分越界的条目保留但可能受删节点影响。
    if (view.from >= spec.from && view.to <= spec.to) {
      replacedPathIds.push(view.id)
      continue
    }
    if (removeTimes.length > 0 && view.from < spec.to && view.to > spec.from) {
      // 只删区间内节点时，端点或区间内节点会断引用。
      if (removeTimes.some((time) => time > view.from && time < view.to)
        || removeTimes.includes(view.from) || removeTimes.includes(view.to)) {
        impactedPaths.push(view.id)
      }
    }
  }
  // 同 id 去重。
  const uniqueImpacted = [...new Set(impactedPaths)].filter((id) => !replacedPathIds.includes(id))
  if (uniqueImpacted.length > 0 && spec.timeMode === 'replace') {
    warnings.push(`删除区间内节点会影响其他路径: ${uniqueImpacted.join(', ')}；需作者确认`)
  }

  // ── 采样误差（仅 Bezier 模式）─────────────────────────────────────────────
  let radialErrorRatio = 0
  if (mode === 'bezier') {
    radialErrorRatio = bezierRadialError(spec, control, boundaryTimes)
  }

  // ── 预览（理想参数采样）───────────────────────────────────────────────────
  const preview: Array<{ u: number; point: [number, number, number] }> = []
  for (let index = 0; index <= 96; index += 1) {
    const u = index / 96
    const point = pointAt(spec.startAngle + delta * u)
    preview.push({ u, point: [point.x, point.y, point.z] })
  }

  return {
    plan: {
      paths,
      keyTimes: keyTimes.map((entry) => ({ time: entry.time, point: entry.point })),
      removeTimes,
      impactedPaths: uniqueImpacted,
      preview,
      radialErrorRatio,
      warnings,
    },
    issues: [],
    replacedPathIds,
    deletePathIds: [],
  }
}

/** 把计划边界点拆成普通位置帧（x/y/z 各一条，三轴同刻）。 */
export function generatedPositionFrames(plan: ShapeGenerationPlan): Array<{
  time: number
  x: number
  y: number
  z: number
}> {
  return plan.keyTimes.map((entry) => ({ time: entry.time, x: entry.point[0], y: entry.point[1], z: entry.point[2] }))
}

/** 校验生成输入；返回空数组表示可生成。 */
export function validateGeneratorSpec(spec: ShapeGeneratorSpec): string[] {
  const issues: string[] = []
  if (typeof spec.clip !== 'string' || spec.clip.length === 0) {
    issues.push('目标片段不能为空')
  }
  if (!(spec.from < spec.to)) {
    issues.push('结束时间必须大于开始时间')
  }
  if (!Number.isFinite(spec.from) || !Number.isFinite(spec.to)) {
    issues.push('时间区间必须是有限数字')
  }
  if (!spec.center || !finite(spec.center.x) || !finite(spec.center.y) || !finite(spec.center.z)) {
    issues.push('圆心必须是有限坐标')
  }
  return issues
}

// ── 几何 ───────────────────────────────────────────────────────────────────

interface ConicBasis {
  u: Vec3
  v: Vec3
}

function buildConicBasis(normalRaw: Vec3, referenceRaw: Vec3): ConicBasis {
  const normal = unit(normalRaw)
  const reference = unit(referenceRaw)
  const projection = subtract(reference, multiply(normal, dot(normal, reference)))
  const u = normalize(projection) ?? perpendicular(normal)
  const v = normalize(cross(normal, u)) ?? { x: 0, y: 0, z: 1 }
  return { u, v }
}

function anglePoint(spec: ShapeGeneratorSpec, basis: ConicBasis, angleDegrees: number): Vec3 {
  const radians = (angleDegrees * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const major = spec.shape === 'ellipse' ? spec.semiMajor : spec.radius
  const minor = spec.shape === 'ellipse' ? spec.semiMinor : spec.radius
  const rotation = spec.shape === 'ellipse' ? (spec.rotation * Math.PI) / 180 : 0
  const cosineRotation = Math.cos(rotation)
  const sineRotation = Math.sin(rotation)
  const majorAxis = add(multiply(basis.u, cosineRotation), multiply(basis.v, sineRotation))
  const minorAxis = subtract(multiply(basis.v, cosineRotation), multiply(basis.u, sineRotation))
  return {
    x: spec.center.x + major * cosine * majorAxis.x + minor * sine * minorAxis.x,
    y: spec.center.y + major * cosine * majorAxis.y + minor * sine * minorAxis.y,
    z: spec.center.z + major * cosine * majorAxis.z + minor * sine * minorAxis.z,
  }
}

function exactPath(spec: ShapeGeneratorSpec, startPoint: Vec3, id: string): JsonObject {
  const center: JsonObject = {
    dx: spec.center.x - startPoint.x,
    dy: spec.center.y - startPoint.y,
    dz: spec.center.z - startPoint.z,
  }
  const delta = (spec.clockwise ? -1 : 1) * Math.abs(spec.endAngle - spec.startAngle)
  if (spec.shape === 'ellipse') {
    return {
      id,
      clip: spec.clip,
      from: spec.from,
      to: spec.to,
      axes: ['x', 'y', 'z'],
      geometry: {
        type: 'ellipse',
        center,
        semi_major: spec.semiMajor,
        semi_minor: spec.semiMinor,
        rotation: spec.rotation,
        start_angle: spec.startAngle,
        end_angle: spec.startAngle + delta,
        normal: vectorJson(spec.normal),
        reference_axis: vectorJson(spec.referenceAxis),
      },
    }
  }
  return {
    id,
    clip: spec.clip,
    from: spec.from,
    to: spec.to,
    axes: ['x', 'y', 'z'],
    geometry: {
      type: 'arc',
      center,
      radius: spec.radius,
      start_angle: spec.startAngle,
      end_angle: spec.startAngle + delta,
      normal: vectorJson(spec.normal),
      reference_axis: vectorJson(spec.referenceAxis),
    },
  }
}

function bezierSegment(
  spec: ShapeGeneratorSpec,
  startPoint: Vec3,
  endPoint: Vec3,
  startAngle: number,
  endAngle: number,
  id: string,
  fromTime: number,
  toTime: number,
): JsonObject {
  const segmentRadians = ((endAngle - startAngle) * Math.PI) / 180
  const alpha = (4 / 3) * Math.tan(segmentRadians / 4)
  const startTangent = angleTangent(spec, startAngle)
  const endTangent = angleTangent(spec, endAngle)
  const first = add(startPoint, multiply(startTangent, alpha))
  const second = subtract(endPoint, multiply(endTangent, alpha))
  return {
    id,
    clip: spec.clip,
    from: fromTime,
    to: toTime,
    axes: ['x', 'y', 'z'],
    geometry: {
      type: 'bezier',
      control_points: [
        { dx: first.x - startPoint.x, dy: first.y - startPoint.y, dz: first.z - startPoint.z },
        { dx: second.x - startPoint.x, dy: second.y - startPoint.y, dz: second.z - startPoint.z },
      ],
    },
  }
}

function angleTangent(spec: ShapeGeneratorSpec, angleDegrees: number): Vec3 {
  const radians = (angleDegrees * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const basis = buildConicBasis(spec.normal, spec.referenceAxis)
  const rotation = spec.shape === 'ellipse' ? (spec.rotation * Math.PI) / 180 : 0
  const cosineRotation = Math.cos(rotation)
  const sineRotation = Math.sin(rotation)
  const majorAxis = add(multiply(basis.u, cosineRotation), multiply(basis.v, sineRotation))
  const minorAxis = subtract(multiply(basis.v, cosineRotation), multiply(basis.u, sineRotation))
  // 椭圆参数导数 = -a sinθ·u' + b cosθ·v'；圆时 a=b=r。
  const major = spec.shape === 'ellipse' ? spec.semiMajor : spec.radius
  const minor = spec.shape === 'ellipse' ? spec.semiMinor : spec.radius
  return {
    x: -major * sine * majorAxis.x + minor * cosine * minorAxis.x,
    y: -major * sine * majorAxis.y + minor * cosine * minorAxis.y,
    z: -major * sine * majorAxis.z + minor * cosine * minorAxis.z,
  }
}

/** Bezier 模式的实际采样误差（相对半径）：均匀采样每段三次曲线，量最大径向偏差。 */
function bezierRadialError(
  spec: ShapeGeneratorSpec,
  basis: ConicBasis,
  boundaryTimes: number[],
): number {
  const radius = spec.shape === 'ellipse' ? Math.min(spec.semiMajor, spec.semiMinor) : spec.radius
  if (!(radius > 0)) {
    return 0
  }
  const delta = (spec.clockwise ? -1 : 1) * Math.abs(spec.endAngle - spec.startAngle)
  let maximum = 0
  for (let segment = 0; segment < boundaryTimes.length - 1; segment += 1) {
    const startAngle = spec.startAngle + delta * ((boundaryTimes[segment] - spec.from) / (spec.to - spec.from))
    const endAngle = spec.startAngle + delta * ((boundaryTimes[segment + 1] - spec.from) / (spec.to - spec.from))
    const p0 = anglePoint(spec, basis, startAngle)
    const p3 = anglePoint(spec, basis, endAngle)
    const segmentRadians = ((endAngle - startAngle) * Math.PI) / 180
    const alpha = (4 / 3) * Math.tan(segmentRadians / 4)
    const t0 = angleTangent(spec, startAngle)
    const t1 = angleTangent(spec, endAngle)
    const p1 = add(p0, multiply(t0, alpha))
    const p2 = subtract(p3, multiply(t1, alpha))
    for (let index = 0; index <= 48; index += 1) {
      const t = index / 48
      const point = cubicBezier(p0, p1, p2, p3, t)
      if (spec.shape === 'circle') {
        // 圆的径向误差：点到圆心距离与半径之差；不能拿同参数的理想点做距离，
        // 三次曲线与圆弧的参数化不同，那样会把切向滞后算成径向误差。
        const radial = Math.hypot(point.x - spec.center.x, point.y - spec.center.y, point.z - spec.center.z)
        maximum = Math.max(maximum, Math.abs(radial - radius) / radius)
      } else {
        const ideal = anglePoint(spec, basis, startAngle + (endAngle - startAngle) * t)
        const distance = Math.hypot(point.x - ideal.x, point.y - ideal.y, point.z - ideal.z)
        maximum = Math.max(maximum, distance / radius)
      }
    }
  }
  return maximum
}

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const s = 1 - t
  const b0 = s * s * s
  const b1 = 3 * s * s * t
  const b2 = 3 * s * t * t
  const b3 = t * t * t
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    z: b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z,
  }
}

// ── 标量与向量 ─────────────────────────────────────────────────────────────

function nextPathNumber(doc: ScriptDoc): number {
  let maximum = 0
  for (const view of pathEntries(doc)) {
    const match = /^p_(\d+)$/.exec(view.id)
    if (match !== null) {
      maximum = Math.max(maximum, Number(match[1]))
    }
  }
  return maximum + 1
}

function vectorJson(vector: Vec3): JsonObject {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function length(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalizedCross(left: Vec3, right: Vec3): number {
  const leftLength = length(left)
  const rightLength = length(right)
  if (leftLength === 0 || rightLength === 0) {
    return 0
  }
  const crossed = cross(left, right)
  return length(crossed) / (leftLength * rightLength)
}

function unit(vector: Vec3): Vec3 {
  return normalize(vector) ?? { x: 1, y: 0, z: 0 }
}

function normalize(vector: Vec3): Vec3 | null {
  const magnitude = length(vector)
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) {
    return null
  }
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
}

function perpendicular(vector: Vec3): Vec3 {
  const candidate = Math.abs(vector.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  return normalize(cross(vector, candidate)) ?? { x: 0, y: 1, z: 0 }
}

function add(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }
}

function multiply(vector: Vec3, factor: number): Vec3 {
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
