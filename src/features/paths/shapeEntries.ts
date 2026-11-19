/**
 * 12-10 曲线工具 · 形状入口：直线 / 圆弧 / 椭圆 / 抛物 / S 形。
 *
 * 边界（对齐 `plan/12/12-10-curve-tools.md` 三、4.1、4.3）：
 * - 圆弧 / 椭圆直接套用 07 既有生成器写出的几何参数形态（`arc` / `ellipse`），
 *   不重写圆锥曲线数学、不把它们转成贝塞尔；
 * - 抛物 / S 形落在已注册的 `bezier` 类型上，固定两个控制点；
 * - 本模块只产出新的 `geometry` JSON，不改端点（`from`/`to`）、不改 `axes`、
 *   不改既有 `timing`；形状切换是显式操作，不做自动转换；
 * - 控制点形态（绝对 x/y/z 或相对 dx/dy/dz）两种不混用，不写数组。
 *
 * 纯逻辑层（node 下可跑自检），不调运行时、不写盘。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { validateGeometry } from '../../core/paths/geometry.ts'
import {
  PATH_AXES,
  PATH_LINE_ALIAS,
  isPathObject,
  type PathAxis,
} from '../../core/paths/types.ts'
import type { Vec3 } from '../../core/paths/sampling.ts'
import { detectPointMode, type PointMode } from './geometryForm.ts'

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 五类形状入口。 */
export type ShapeEntryKind = 'line' | 'arc' | 'ellipse' | 'parabola' | 's'

/** 控制点写法（与 07 点位二选一一致）。 */
export type ControlMode = PointMode

/** 一条本地曲线工具诊断；severity 口径与 07 路径诊断一致。 */
export interface CurveDiagnostic {
  code: string
  severity: 'block' | 'error' | 'warn' | 'info'
  message: string
}

/** 形状参数：圆锥曲线项与曲线项按需取用，未用项保持 undefined。 */
export interface ShapeEntryParams {
  // ── 圆弧 / 椭圆（复用 07 生成器参数） ──
  /** 圆心 / 椭圆中心（表达式空间世界分量；写盘时相对段起点换算）。 */
  center?: Vec3
  /** 圆弧半径。 */
  radius?: number
  /** 椭圆长半轴。 */
  semiMajor?: number
  /** 椭圆短半轴。 */
  semiMinor?: number
  /** 椭圆旋转角（度）。 */
  rotation?: number
  /** 起始角（度）。 */
  startAngle?: number
  /** 结束角（度）。 */
  endAngle?: number
  /** 顺时针方向。 */
  clockwise?: boolean
  /** 圆锥平面法向。 */
  normal?: Vec3
  /** 圆锥平面参考轴。 */
  referenceAxis?: Vec3

  // ── 抛物 / S 形（贝塞尔控制点） ──
  /** 抛物拱高（沿参考方向抬升；缺省取段长的 1/4）。 */
  archHeight?: number
  /** S 形张力 0..1；缺省 0.5。 */
  tension?: number
  /** 控制点抬升 / 偏侧的参考方向（会被投影到路径轴集合内）。 */
  referenceDirection?: Vec3
  /** 控制点写法；缺省沿用既有几何形态，再缺省取相对。 */
  controlMode?: ControlMode
}

/** 一次形状计划输入。端点向量由调用方按 07 端点解析给出；本模块不解析片段。 */
export interface ShapeEntryRequest {
  /** 既有条目（只读；用于沿用控制点形态，不就地修改）。 */
  entry: JsonObject | undefined
  /** 段起点（表达式空间）。 */
  from: Vec3
  /** 段终点（表达式空间）。 */
  to: Vec3
  /** 路径轴集合（x / y / z 子集）。 */
  axes: readonly PathAxis[]
  kind: ShapeEntryKind
  params: ShapeEntryParams
}

/** 计划结果：`geometry` 为 null 表示被本地诊断拦下。 */
export interface ShapeEntryPlan {
  ok: boolean
  geometry: JsonObject | null
  diagnostics: CurveDiagnostic[]
}

/** 面板下拉描述（文案跟随 07 面板硬编码中文约定；i18n key 需求另写报告）。 */
export const SHAPE_ENTRIES: Array<{ kind: ShapeEntryKind; label: string }> = [
  { kind: 'line', label: '直线' },
  { kind: 'arc', label: '圆弧' },
  { kind: 'ellipse', label: '椭圆' },
  { kind: 'parabola', label: '抛物' },
  { kind: 's', label: 'S 形' },
]

// ── 向量工具 ─────────────────────────────────────────────────────────────────

function vecLength(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalize(vector: Vec3): Vec3 | null {
  const magnitude = vecLength(vector)
  if (!Number.isFinite(magnitude) || magnitude < 1e-12) {
    return null
  }
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
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

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

/** 轴集合（保持 x,y,z 顺序）。 */
function axisSet(axes: readonly PathAxis[]): Set<PathAxis> {
  return new Set<PathAxis>(axes.filter((axis): axis is PathAxis => PATH_AXES.includes(axis)))
}

/** 把向量投影到路径轴集合：不在轴集合内的分量强制为 0。 */
function projectToAxes(vector: Vec3, axes: Set<PathAxis>): Vec3 {
  return {
    x: axes.has('x') ? vector.x : 0,
    y: axes.has('y') ? vector.y : 0,
    z: axes.has('z') ? vector.z : 0,
  }
}

/** 缺省参考方向：含竖直轴时取“上”；纯水平两轴时取水平方向（竖直分量必须为 0）。 */
export function defaultReferenceDirection(axes: readonly PathAxis[]): Vec3 {
  const set = axisSet(axes)
  if (set.has('y')) {
    return { x: 0, y: 1, z: 0 }
  }
  if (set.has('z')) {
    return { x: 0, y: 0, z: 1 }
  }
  return { x: 1, y: 0, z: 0 }
}

// ── 既有形态探测 ─────────────────────────────────────────────────────────────

/** 读既有几何的控制点写法；无法判断时返回 null（调用方再取缺省相对）。 */
export function detectControlMode(geometry: JsonValue | undefined): ControlMode | null {
  if (!isPathObject(geometry)) {
    return null
  }
  const rawPoints = geometry.control_points
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
    return null
  }
  return detectPointMode(rawPoints[0])
}

// ── 计划入口 ─────────────────────────────────────────────────────────────────

/**
 * 计划一次形状应用：只算新几何，不提交、不改条目其余字段。
 * `ok === false` 时 `geometry` 为 null，原因见 `diagnostics`。
 */
export function planShapeEntry(request: ShapeEntryRequest): ShapeEntryPlan {
  const diagnostics: CurveDiagnostic[] = []
  const axes = axisSet(request.axes)
  if (axes.size === 0) {
    diagnostics.push({ code: 'curve.axes-empty', severity: 'block', message: '路径轴集合为空，无法生成形状' })
    return { ok: false, geometry: null, diagnostics }
  }

  let geometry: JsonObject | null = null
  switch (request.kind) {
    case 'line':
      geometry = { type: PATH_LINE_ALIAS }
      break
    case 'arc':
    case 'ellipse':
      geometry = planConic(request, axes, diagnostics)
      break
    case 'parabola':
    case 's':
      geometry = planCurve(request, axes, diagnostics)
      break
    default:
      diagnostics.push({
        code: 'curve.unknown-kind',
        severity: 'block',
        message: `未知形状 ${String((request as { kind?: unknown }).kind)}（可选: line / arc / ellipse / parabola / s）`,
      })
  }

  if (geometry !== null) {
    const issues = validateGeometry(geometry)
    for (const issue of issues) {
      diagnostics.push({ code: `curve.${issue.field}`, severity: 'error', message: issue.message })
    }
  }
  const block = diagnostics.some((issue) => issue.severity === 'block' || issue.severity === 'error')
  return { ok: !block, geometry: block ? null : geometry, diagnostics }
}

// ── 圆锥曲线（复用 07 生成器参数形态，不重写数学） ────────────────────────────

function planConic(
  request: ShapeEntryRequest,
  axes: Set<PathAxis>,
  diagnostics: CurveDiagnostic[],
): JsonObject | null {
  const params = request.params
  const centerRaw = params.center
  if (centerRaw === undefined || !Number.isFinite(centerRaw.x) || !Number.isFinite(centerRaw.y)
    || !Number.isFinite(centerRaw.z)) {
    diagnostics.push({ code: 'curve.center', severity: 'block', message: '圆心 / 椭圆中心必须是有限坐标' })
    return null
  }
  // 与 07 `exactPath` 一致：中心相对段起点写 dx/dy/dz（表达式空间）。
  const center: JsonObject = {
    dx: centerRaw.x - request.from.x,
    dy: centerRaw.y - request.from.y,
    dz: centerRaw.z - request.from.z,
  }
  const normal = params.normal ?? { x: 0, y: 1, z: 0 }
  const referenceAxis = params.referenceAxis ?? { x: 1, y: 0, z: 0 }
  const startAngle = params.startAngle ?? 0
  const endAngleRaw = params.endAngle ?? 90
  const clockwise = params.clockwise ?? false
  const span = Math.abs(endAngleRaw - startAngle)
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngleRaw) || span === 0) {
    diagnostics.push({ code: 'curve.angles', severity: 'block', message: '起止角不能相同（跨度 0）' })
    return null
  }
  if (span > 360) {
    diagnostics.push({ code: 'curve.angles', severity: 'block', message: `角度跨度必须 ≤ 360°（实际 ${span}°）` })
    return null
  }
  const endAngle = startAngle + (clockwise ? -1 : 1) * span
  const normalJson: JsonObject = { x: normal.x, y: normal.y, z: normal.z }
  const referenceJson: JsonObject = { x: referenceAxis.x, y: referenceAxis.y, z: referenceAxis.z }

  if (request.kind === 'arc') {
    const radius = params.radius
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
      diagnostics.push({ code: 'curve.radius', severity: 'block', message: '圆弧半径必须 > 0' })
      return null
    }
    // 轴集合只约束路径点分量；圆锥平面法向 / 参考轴属于平面基底，原样保留。
    return {
      type: 'arc',
      center,
      radius,
      start_angle: startAngle,
      end_angle: endAngle,
      normal: normalJson,
      reference_axis: referenceJson,
    }
  }

  const semiMajor = params.semiMajor
  const semiMinor = params.semiMinor
  if (typeof semiMajor !== 'number' || !Number.isFinite(semiMajor) || semiMajor <= 0) {
    diagnostics.push({ code: 'curve.semi-major', severity: 'block', message: '椭圆长半轴必须 > 0' })
    return null
  }
  if (typeof semiMinor !== 'number' || !Number.isFinite(semiMinor) || semiMinor <= 0) {
    diagnostics.push({ code: 'curve.semi-minor', severity: 'block', message: '椭圆短半轴必须 > 0' })
    return null
  }
  const rotation = typeof params.rotation === 'number' && Number.isFinite(params.rotation) ? params.rotation : 0
  return {
    type: 'ellipse',
    center,
    semi_major: semiMajor,
    semi_minor: semiMinor,
    rotation,
    start_angle: startAngle,
    end_angle: endAngle,
    normal: normalJson,
    reference_axis: referenceJson,
  }
}

// ── 抛物 / S 形（贝塞尔，两个控制点） ────────────────────────────────────────

function planCurve(
  request: ShapeEntryRequest,
  axes: Set<PathAxis>,
  diagnostics: CurveDiagnostic[],
): JsonObject | null {
  const params = request.params
  const chord = sub(request.to, request.from)
  const chordLength = vecLength(chord)
  if (chordLength < 1e-9) {
    diagnostics.push({ code: 'curve.degenerate', severity: 'block', message: '端点重合，无法生成抛物 / S 形' })
    return null
  }
  const chordUnit = scale(chord, 1 / chordLength)

  // 参考方向先按轴集合投影；纯水平两轴时竖直分量被强制为 0。
  const referenceRaw = params.referenceDirection ?? defaultReferenceDirection([...axes])
  let reference = normalize(projectToAxes(referenceRaw, axes))
  if (reference === null) {
    // 参考方向在轴集合内退化：退到 chord 在轴平面内的垂直方向。
    reference = inPlanePerpendicular(chordUnit, axes)
  }
  if (reference === null) {
    diagnostics.push({ code: 'curve.reference', severity: 'block', message: '参考方向与路径轴退化，无法确定抬升方向' })
    return null
  }

  const mode: ControlMode = params.controlMode ?? detectControlMode(request.entry?.geometry) ?? 'relative'
  const mid = scale(add(request.from, request.to), 0.5)
  const halfChord = scale(chord, 1 / 6)

  let first: Vec3
  let second: Vec3
  if (request.kind === 'parabola') {
    const archHeight = typeof params.archHeight === 'number' && Number.isFinite(params.archHeight)
      ? Math.max(0, params.archHeight)
      : 0.25 * chordLength
    const lift = scale(reference, archHeight)
    first = add(sub(mid, halfChord), lift)
    second = add(add(mid, halfChord), lift)
  } else {
    const tension = typeof params.tension === 'number' && Number.isFinite(params.tension)
      ? Math.min(1, Math.max(0, params.tension))
      : 0.5
    const side = sideDirection(chordUnit, reference, axes)
    if (side === null) {
      diagnostics.push({ code: 'curve.side', severity: 'block', message: 'S 形偏侧方向退化，请调整参考方向' })
      return null
    }
    const offset = tension * chordLength * 0.25
    const sideOffset = scale(side, offset)
    first = sub(sub(mid, halfChord), sideOffset)
    second = add(add(mid, halfChord), sideOffset)
  }

  first = projectToAxes(first, axes)
  second = projectToAxes(second, axes)

  return {
    type: 'bezier',
    control_points: [
      controlPointJson(first, request.from, mode),
      controlPointJson(second, request.from, mode),
    ],
  }
}

/** 弦方向在轴平面内的单位垂直向量；退化返回 null。 */
function inPlanePerpendicular(chordUnit: Vec3, axes: Set<PathAxis>): Vec3 | null {
  const candidates: Vec3[] = [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
  ]
  for (const candidate of candidates) {
    const projected = projectToAxes(candidate, axes)
    const perpendicular = normalize(cross(chordUnit, projected))
    if (perpendicular !== null) {
      return normalize(projectToAxes(perpendicular, axes))
    }
  }
  return null
}

/** S 形偏侧方向：弦 × 参考方向，投影到轴平面；退化时取面内垂直。 */
function sideDirection(chordUnit: Vec3, reference: Vec3, axes: Set<PathAxis>): Vec3 | null {
  const crossed = normalize(projectToAxes(cross(chordUnit, reference), axes))
  if (crossed !== null) {
    return crossed
  }
  return inPlanePerpendicular(chordUnit, axes)
}

/** 控制点 JSON：绝对 x/y/z 或相对 dx/dy/dz，两种形态不混用。 */
function controlPointJson(point: Vec3, segmentStart: Vec3, mode: ControlMode): JsonObject {
  if (mode === 'absolute') {
    return { x: point.x, y: point.y, z: point.z }
  }
  return {
    dx: point.x - segmentStart.x,
    dy: point.y - segmentStart.y,
    dz: point.z - segmentStart.z,
  }
}

/** 供面板 / 自检读取：某形状是否允许在给定轴集合下使用（当前五类均不挑轴，留作后续扩展）。 */
export function shapeAvailableOnAxes(kind: ShapeEntryKind, axes: readonly PathAxis[]): boolean {
  void kind
  return axisSet(axes).size > 0
}
