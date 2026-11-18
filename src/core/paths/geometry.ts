/**
 * 07-06 几何参数校验：11 种曲线 + `line` 别名，规则以 `PathCurveRegistry` / 各 `PathSpec` 构造器为准。
 *
 * 只校验 JSON 定义（不采样）；错误定位到 `geometry.<参数>` 或 `geometry.<参数>[i]`。
 */
import type { JsonObject, JsonValue } from '../doc/types.ts'
import {
  PATH_GEOMETRY_TYPES,
  PATH_LINE_ALIAS,
  isKnownGeometryType,
  isPathObject,
} from './types.ts'

export interface GeometryIssue {
  /** 相对条目字段，如 `geometry.control_points[0]`。 */
  field: string
  message: string
}

const PARALLEL_EPSILON = 1e-9

interface Vec3 {
  x: number
  y: number
  z: number
}

/** 每种类型的允许参数键（来自 `PathCurveRegistry`）。 */
const ALLOWED_PARAMS: Record<string, readonly string[]> = {
  linear: [],
  bezier: ['control_points'],
  rational_bezier: ['control_points', 'weights'],
  arc: ['center', 'radius', 'start_angle', 'end_angle', 'normal', 'reference_axis'],
  ellipse: [
    'center',
    'semi_major',
    'semi_minor',
    'rotation',
    'start_angle',
    'end_angle',
    'normal',
    'reference_axis',
  ],
  bspline: ['control_points', 'degree', 'knots'],
  nurbs: ['control_points', 'weights', 'degree', 'knots'],
  catmull_rom: ['points', 'parameterization', 'tension', 'endpoint'],
  hermite: ['tangents'],
  clothoid: ['start_curvature', 'end_curvature', 'length', 'start_direction', 'normal'],
  fourier: ['a0', 'cos', 'sin', 'period', 'periodic', 'start_velocity', 'end_velocity'],
}

/** 类型下拉：`line` 置顶，其余按 `PathCurveRegistry` 注册顺序。 */
export const GEOMETRY_TYPE_OPTIONS: readonly string[] = [PATH_LINE_ALIAS, ...PATH_GEOMETRY_TYPES]

/** 校验一个几何对象；返回空数组表示合法。 */
export function validateGeometry(geometry: JsonValue | undefined, fieldPrefix = 'geometry'): GeometryIssue[] {
  const issues: GeometryIssue[] = []
  if (!isPathObject(geometry)) {
    issues.push({ field: fieldPrefix, message: '缺失（必填对象 {type, ...参数}）' })
    return issues
  }
  const rawType = geometry.type
  if (typeof rawType !== 'string' || rawType.length === 0) {
    issues.push({ field: `${fieldPrefix}.type`, message: '缺失（曲线类型，如 line / bezier）' })
    return issues
  }
  if (!isKnownGeometryType(rawType)) {
    issues.push({ field: `${fieldPrefix}.type`, message: `未知曲线类型 '${rawType}'（已注册: ${PATH_GEOMETRY_TYPES.join(', ')}；line 为别名）` })
    return issues
  }
  const type = rawType === PATH_LINE_ALIAS ? 'linear' : rawType
  const allowed = ALLOWED_PARAMS[type] ?? []
  for (const key of Object.keys(geometry)) {
    if (key === 'type') {
      continue
    }
    if (!allowed.includes(key)) {
      issues.push({
        field: `${fieldPrefix}.${key}`,
        message: `未知参数 ${key}（${rawType} 允许: ${allowed.length === 0 ? '仅 type' : allowed.join(', ')}）`,
      })
    }
  }
  if (rawType === PATH_LINE_ALIAS) {
    return issues
  }
  switch (type) {
    case 'linear':
      break
    case 'bezier':
      checkPointList(geometry.control_points, `${fieldPrefix}.control_points`, issues, {
        required: true,
        exact: 2,
        min: 2,
      })
      break
    case 'rational_bezier':
      checkPointList(geometry.control_points, `${fieldPrefix}.control_points`, issues, {
        required: true,
        min: 1,
        max: 2,
      })
      checkNumberList(geometry.weights, `${fieldPrefix}.weights`, issues, {
        required: true,
        positive: true,
        sameLengthAs: Array.isArray(geometry.control_points) ? geometry.control_points.length : undefined,
      })
      break
    case 'arc':
    case 'ellipse':
      checkCenter(geometry.center, `${fieldPrefix}.center`, issues)
      if (type === 'arc') {
        checkNumber(geometry.radius, `${fieldPrefix}.radius`, issues, { required: true, positive: true })
      } else {
        checkNumber(geometry.semi_major, `${fieldPrefix}.semi_major`, issues, { required: true, positive: true })
        checkNumber(geometry.semi_minor, `${fieldPrefix}.semi_minor`, issues, { required: true, positive: true })
        checkNumber(geometry.rotation, `${fieldPrefix}.rotation`, issues, { required: false })
      }
      checkNumber(geometry.start_angle, `${fieldPrefix}.start_angle`, issues, { required: true })
      checkNumber(geometry.end_angle, `${fieldPrefix}.end_angle`, issues, { required: true })
      if (issues.length === 0) {
        const start = geometry.start_angle as number
        const end = geometry.end_angle as number
        const delta = end - start
        if (delta === 0) {
          issues.push({ field: `${fieldPrefix}.end_angle`, message: '起止角跨度不能为 0' })
        } else if (Math.abs(delta) > 360) {
          issues.push({ field: `${fieldPrefix}.end_angle`, message: `起止角跨度必须 ≤ 360°（实际 ${delta}°）` })
        }
      }
      checkVector(geometry.normal, `${fieldPrefix}.normal`, issues, { required: false, fallback: { x: 0, y: 1, z: 0 } })
      checkVector(geometry.reference_axis, `${fieldPrefix}.reference_axis`, issues, {
        required: false,
        fallback: { x: 1, y: 0, z: 0 },
      })
      if (issues.length === 0) {
        const normal = vecOf(geometry.normal, { x: 0, y: 1, z: 0 })
        const reference = vecOf(geometry.reference_axis, { x: 1, y: 0, z: 0 })
        const cross = crossLength(normal, reference)
        if (cross < PARALLEL_EPSILON) {
          issues.push({
            field: `${fieldPrefix}.reference_axis`,
            message: `法向与参考轴不能平行（归一化叉积模长 ${cross.toExponential(3)} < ${PARALLEL_EPSILON}）`,
          })
        }
      }
      break
    case 'bspline':
    case 'nurbs':
      checkPointList(geometry.control_points, `${fieldPrefix}.control_points`, issues, {
        required: true,
        min: 2,
      })
      if (type === 'nurbs') {
        checkNumberList(geometry.weights, `${fieldPrefix}.weights`, issues, {
          required: true,
          positive: true,
          sameLengthAs: Array.isArray(geometry.control_points) ? geometry.control_points.length : undefined,
        })
      }
      checkInteger(geometry.degree, `${fieldPrefix}.degree`, issues, { required: false, fallback: 3 })
      checkNumberList(geometry.knots, `${fieldPrefix}.knots`, issues, { required: false })
      if (issues.length === 0 && Array.isArray(geometry.control_points)) {
        const controlCount = geometry.control_points.length + 2
        const degree = typeof geometry.degree === 'number' ? geometry.degree : 3
        if (degree < 1 || degree > controlCount - 1) {
          issues.push({
            field: `${fieldPrefix}.degree`,
            message: `次数必须落在 1 ~ ${controlCount - 1}（控制点数 ${controlCount}），实际 ${degree}`,
          })
        }
        if (geometry.knots !== undefined) {
          const knots = geometry.knots as number[]
          const expected = controlCount + degree + 1
          if (knots.length !== expected) {
            issues.push({
              field: `${fieldPrefix}.knots`,
              message: `节点向量长度必须为 控制点数+次数+1 = ${expected}，实际 ${knots.length}`,
            })
          } else {
            for (let index = 1; index < knots.length; index += 1) {
              if (knots[index] < knots[index - 1]) {
                issues.push({
                  field: `${fieldPrefix}.knots[${index}]`,
                  message: `节点向量必须非减（knots[${index - 1}]=${knots[index - 1]}，实际 ${knots[index]}）`,
                })
                break
              }
            }
            if (!(knots[degree] < knots[controlCount])) {
              issues.push({
                field: `${fieldPrefix}.knots`,
                message: `定义域跨度必须为正（knots[${degree}]=${knots[degree]}，knots[${controlCount}]=${knots[controlCount]}）`,
              })
            }
          }
        }
      }
      break
    case 'catmull_rom':
      checkPointList(geometry.points, `${fieldPrefix}.points`, issues, { required: true, min: 2 })
      checkEnum(geometry.parameterization, `${fieldPrefix}.parameterization`, issues, {
        required: false,
        fallback: 'centripetal',
        values: ['uniform', 'chordal', 'centripetal'],
      })
      checkNumber(geometry.tension, `${fieldPrefix}.tension`, issues, {
        required: false,
        fallback: 1,
        min: 0,
        max: 1,
      })
      checkEnum(geometry.endpoint, `${fieldPrefix}.endpoint`, issues, {
        required: false,
        fallback: 'mirror',
        values: ['mirror', 'clamp'],
      })
      break
    case 'hermite':
      checkPointList(geometry.tangents, `${fieldPrefix}.tangents`, issues, { required: true, exact: 2 })
      break
    case 'clothoid':
      checkNumber(geometry.start_curvature, `${fieldPrefix}.start_curvature`, issues, { required: true })
      checkNumber(geometry.end_curvature, `${fieldPrefix}.end_curvature`, issues, { required: true })
      checkNumber(geometry.length, `${fieldPrefix}.length`, issues, { required: true, positive: true })
      checkVector(geometry.start_direction, `${fieldPrefix}.start_direction`, issues, {
        required: false,
        fallback: { x: 1, y: 0, z: 0 },
      })
      checkVector(geometry.normal, `${fieldPrefix}.normal`, issues, {
        required: false,
        fallback: { x: 0, y: 1, z: 0 },
      })
      if (issues.length === 0) {
        const direction = vecOf(geometry.start_direction, { x: 1, y: 0, z: 0 })
        const normal = vecOf(geometry.normal, { x: 0, y: 1, z: 0 })
        const cross = crossLength(direction, normal)
        if (cross < PARALLEL_EPSILON) {
          issues.push({
            field: `${fieldPrefix}.normal`,
            message: `法向不能与起点切线平行（归一化叉积模长 ${cross.toExponential(3)} < ${PARALLEL_EPSILON}）`,
          })
        }
      }
      break
    case 'fourier':
      checkVector(geometry.a0, `${fieldPrefix}.a0`, issues, {
        required: false,
        fallback: { x: 0, y: 0, z: 0 },
        allowZero: true,
      })
      checkPointList(geometry.cos, `${fieldPrefix}.cos`, issues, { required: false, min: 0 })
      checkPointList(geometry.sin, `${fieldPrefix}.sin`, issues, { required: false, min: 0 })
      checkNumber(geometry.period, `${fieldPrefix}.period`, issues, { required: true, positive: true })
      checkBoolean(geometry.periodic, `${fieldPrefix}.periodic`, issues, { required: false, fallback: true })
      checkVector(geometry.start_velocity, `${fieldPrefix}.start_velocity`, issues, {
        required: false,
        fallback: { x: 0, y: 0, z: 0 },
        allowZero: true,
      })
      checkVector(geometry.end_velocity, `${fieldPrefix}.end_velocity`, issues, {
        required: false,
        fallback: { x: 0, y: 0, z: 0 },
        allowZero: true,
      })
      if (issues.length === 0) {
        const cosLength = Array.isArray(geometry.cos) ? geometry.cos.length : 0
        const sinLength = Array.isArray(geometry.sin) ? geometry.sin.length : 0
        if (cosLength !== sinLength) {
          issues.push({
            field: `${fieldPrefix}.sin`,
            message: `cos 与 sin 的阶数必须一致: cos=${cosLength}, sin=${sinLength}`,
          })
        }
        const periodic = geometry.periodic !== false
        const a0 = vecOf(geometry.a0, { x: 0, y: 0, z: 0 })
        if (!periodic && (a0.x !== 0 || a0.y !== 0 || a0.z !== 0)) {
          issues.push({ field: `${fieldPrefix}.a0`, message: '非周期路径的 a0 必须为 (0,0,0)' })
        }
      }
      break
    default:
      break
  }
  return issues
}

/** 读参数默认值（与 Java 注册表一致），校验通过后使用。 */
export function geometryParam<T>(geometry: JsonObject, key: string, fallback: T): T {
  const value = geometry[key]
  return (value === undefined || value === null ? fallback : value) as T
}

/** 读点（绝对或相对），返回解析后的绝对坐标需要 caller 提供 segmentStart；这里返回 `relative` 标记。 */
export function readPoint(
  raw: JsonValue | undefined,
  segmentStart: Vec3,
): { point: Vec3; relative: boolean } | null {
  if (!isPathObject(raw)) {
    return null
  }
  const hasAbsolute = raw.x !== undefined || raw.y !== undefined || raw.z !== undefined
  const hasRelative = raw.dx !== undefined || raw.dy !== undefined || raw.dz !== undefined
  if (hasAbsolute === hasRelative) {
    return null
  }
  if (hasAbsolute) {
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof raw.z !== 'number') {
      return null
    }
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) {
      return null
    }
    return { point: { x: raw.x, y: raw.y, z: raw.z }, relative: false }
  }
  if (typeof raw.dx !== 'number' || typeof raw.dy !== 'number' || typeof raw.dz !== 'number') {
    return null
  }
  if (!Number.isFinite(raw.dx) || !Number.isFinite(raw.dy) || !Number.isFinite(raw.dz)) {
    return null
  }
  return {
    point: {
      x: segmentStart.x + raw.dx,
      y: segmentStart.y + raw.dy,
      z: segmentStart.z + raw.dz,
    },
    relative: true,
  }
}

/** 读向量 `{x,y,z}`；非法返回 null。 */
export function readVector(raw: JsonValue | undefined): Vec3 | null {
  if (!isPathObject(raw)) {
    return null
  }
  const x = raw.x
  const y = raw.y
  const z = raw.z
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
    return null
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }
  return { x, y, z }
}

// ── 基本检查 ────────────────────────────────────────────────────────────────

function checkNumber(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; positive?: boolean; min?: number; max?: number; fallback?: number },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: '缺失（必填数字）' })
    }
    return
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    issues.push({ field, message: `需要有限数字，实际 ${String(raw)}` })
    return
  }
  if (options.positive && raw <= 0) {
    issues.push({ field, message: `必须 > 0（实际 ${raw}）` })
  }
  if (options.min !== undefined && raw < options.min) {
    issues.push({ field, message: `必须 ≥ ${options.min}（实际 ${raw}）` })
  }
  if (options.max !== undefined && raw > options.max) {
    issues.push({ field, message: `必须 ≤ ${options.max}（实际 ${raw}）` })
  }
}

function checkInteger(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; fallback?: number },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: '缺失（必填整数）' })
    }
    return
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    issues.push({ field, message: `需要整数，实际 ${String(raw)}` })
  }
}

function checkBoolean(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; fallback?: boolean },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: '缺失（必填布尔）' })
    }
    return
  }
  if (typeof raw !== 'boolean') {
    issues.push({ field, message: `需要布尔值，实际 ${String(raw)}` })
  }
}

function checkEnum(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; fallback?: string; values: readonly string[] },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: `缺失（可选: ${options.values.join(', ')}）` })
    }
    return
  }
  if (typeof raw !== 'string' || !options.values.includes(raw)) {
    issues.push({ field, message: `未知取值 ${String(raw)}（可选: ${options.values.join(', ')}）` })
  }
}

function checkVector(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; fallback: Vec3; allowZero?: boolean },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: '缺失（必填向量 {x,y,z}）' })
    }
    return
  }
  if (!isPathObject(raw)) {
    issues.push({ field, message: '需要向量 {x,y,z}' })
    return
  }
  for (const key of Object.keys(raw)) {
    if (!['x', 'y', 'z'].includes(key)) {
      issues.push({ field: `${field}.${key}`, message: `未知键 ${key}（向量只接受 x / y / z）` })
    }
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = raw[axis]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field: `${field}.${axis}`, message: `需要有限数字，实际 ${String(value)}` })
    }
  }
  const length = Math.hypot(
    typeof raw.x === 'number' ? raw.x : 0,
    typeof raw.y === 'number' ? raw.y : 0,
    typeof raw.z === 'number' ? raw.z : 0,
  )
  if (length === 0 && options.allowZero !== true) {
    issues.push({ field, message: '向量不能为零向量（方向未定义）' })
  }
}

function checkCenter(raw: JsonValue | undefined, field: string, issues: GeometryIssue[]): void {
  if (!isPathObject(raw)) {
    issues.push({ field, message: '缺失（必填点 {x,y,z} 或 {dx,dy,dz}）' })
    return
  }
  const absoluteKeys = ['x', 'y', 'z']
  const relativeKeys = ['dx', 'dy', 'dz']
  for (const key of Object.keys(raw)) {
    if (!absoluteKeys.includes(key) && !relativeKeys.includes(key)) {
      issues.push({ field: `${field}.${key}`, message: `未知键 ${key}（点只接受 x/y/z 或 dx/dy/dz）` })
    }
  }
  const hasAbsolute = absoluteKeys.some((key) => raw[key] !== undefined)
  const hasRelative = relativeKeys.some((key) => raw[key] !== undefined)
  if (hasAbsolute && hasRelative) {
    issues.push({ field, message: '同一点不能混写绝对 x/y/z 与相对 dx/dy/dz' })
    return
  }
  if (!hasAbsolute && !hasRelative) {
    issues.push({ field, message: '点缺少分量（x/y/z 或 dx/dy/dz）' })
    return
  }
  for (const key of hasAbsolute ? absoluteKeys : relativeKeys) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field: `${field}.${key}`, message: `需要有限数字，实际 ${String(value)}` })
    }
  }
}

function checkPointList(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; exact?: number; min?: number; max?: number },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: '缺失（必填点列表）' })
    }
    return
  }
  if (!Array.isArray(raw)) {
    issues.push({ field, message: '需要数组（元素为点 {x,y,z} 或 {dx,dy,dz}）' })
    return
  }
  if (options.exact !== undefined && raw.length !== options.exact) {
    issues.push({ field, message: `需要恰好 ${options.exact} 个点，实际 ${raw.length} 个` })
  }
  if (options.min !== undefined && raw.length < options.min) {
    issues.push({ field, message: `至少 ${options.min} 个点，实际 ${raw.length} 个` })
  }
  if (options.max !== undefined && raw.length > options.max) {
    issues.push({ field, message: `最多 ${options.max} 个点，实际 ${raw.length} 个` })
  }
  for (let index = 0; index < raw.length; index += 1) {
    const itemField = `${field}[${index}]`
    const point = raw[index]
    if (!isPathObject(point)) {
      issues.push({ field: itemField, message: '需要点对象 {x,y,z} 或 {dx,dy,dz}' })
      continue
    }
    const keys = Object.keys(point)
    const absoluteKeys = ['x', 'y', 'z']
    const relativeKeys = ['dx', 'dy', 'dz']
    for (const key of keys) {
      if (!absoluteKeys.includes(key) && !relativeKeys.includes(key)) {
        issues.push({ field: `${itemField}.${key}`, message: `未知键 ${key}（点只接受 x/y/z 或 dx/dy/dz）` })
      }
    }
    const hasAbsolute = absoluteKeys.some((key) => point[key] !== undefined)
    const hasRelative = relativeKeys.some((key) => point[key] !== undefined)
    if (hasAbsolute && hasRelative) {
      issues.push({ field: itemField, message: '同一点不能混写绝对 x/y/z 与相对 dx/dy/dz' })
      continue
    }
    if (!hasAbsolute && !hasRelative) {
      issues.push({ field: itemField, message: '点缺少分量（x/y/z 或 dx/dy/dz）' })
      continue
    }
    for (const key of hasAbsolute ? absoluteKeys : relativeKeys) {
      const value = point[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ field: `${itemField}.${key}`, message: `需要有限数字，实际 ${String(value)}` })
      }
    }
  }
}

function checkNumberList(
  raw: JsonValue | undefined,
  field: string,
  issues: GeometryIssue[],
  options: { required: boolean; positive?: boolean; sameLengthAs?: number },
): void {
  if (raw === undefined || raw === null) {
    if (options.required) {
      issues.push({ field, message: '缺失（必填数字列表）' })
    }
    return
  }
  if (!Array.isArray(raw)) {
    issues.push({ field, message: '需要数字数组' })
    return
  }
  if (options.sameLengthAs !== undefined && raw.length !== options.sameLengthAs) {
    issues.push({ field, message: `数量必须与对应点列表一致（期望 ${options.sameLengthAs}，实际 ${raw.length}）` })
  }
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field: `${field}[${index}]`, message: `需要有限数字，实际 ${String(value)}` })
      continue
    }
    if (options.positive && value <= 0) {
      issues.push({ field: `${field}[${index}]`, message: `必须 > 0（实际 ${value}）` })
    }
  }
}

function vecOf(raw: JsonValue | undefined, fallback: Vec3): Vec3 {
  const vector = readVector(raw)
  return vector ?? fallback
}

function crossLength(left: Vec3, right: Vec3): number {
  const x = left.y * right.z - left.z * right.y
  const y = left.z * right.x - left.x * right.z
  const z = left.x * right.y - left.y * right.x
  const lengthLeft = Math.hypot(left.x, left.y, left.z)
  const lengthRight = Math.hypot(right.x, right.y, right.z)
  if (lengthLeft === 0 || lengthRight === 0) {
    return 0
  }
  return Math.hypot(x, y, z) / (lengthLeft * lengthRight)
}
