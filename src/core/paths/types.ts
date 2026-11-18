/**
 * 07 路径领域：顶层 `paths[]` 条目的共享类型与稳定常量。
 *
 * 事实基准（只读）：
 * - `PathCollectionParser`：条目键 = id/clip/from/to/axes/geometry/timing，id 形态、端点相邻、端点对唯一；
 * - `PathCurveRegistry`：11 种曲线的 type 与参数表；
 * - `PathTiming`：linear / keyframes，端点、单调、范围。
 *
 * 本文件只声明形状，不做校验；校验/采样分别在 collection / geometry / timing / sampling。
 */
import type { JsonObject, JsonValue } from '../doc/types.ts'

/** 曲线类型（注册顺序 = 编辑器下拉顺序）。与 `schema.curveTypes` 的 `CURVE_TYPES` 同集合。 */
export const PATH_GEOMETRY_TYPES = [
  'linear',
  'bezier',
  'rational_bezier',
  'arc',
  'ellipse',
  'bspline',
  'nurbs',
  'catmull_rom',
  'hermite',
  'clothoid',
  'fourier',
] as const

export type PathGeometryType = (typeof PATH_GEOMETRY_TYPES)[number]

/** `line` 是 `linear` 的别名（PathCollectionParser.LINE_TYPE）。 */
export const PATH_LINE_ALIAS = 'line'

/** 路径 id：模组 `PathCollectionParser.ID_PATTERN` 原样（`^[A-Za-z0-9_]{1,64}$`）。 */
export const PATH_ID_JAVA_PATTERN = /^[A-Za-z0-9_]{1,64}$/

/**
 * 编辑器新建 / 重命名时使用的 id 形态：07-05 要求首字符为字母，字符集取与模组兼容的子集
 * （`.` / `-` 会被模组拒绝，因此不写进候选）。读取既有脚本时仍按 `PATH_ID_JAVA_PATTERN` 放行。
 */
export const PATH_ID_EDITOR_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,63}$/

/** 端点时间与节点时间匹配容差（PathCollectionParser.TIME_EPSILON，单位秒）。 */
export const PATH_TIME_EPSILON = 1e-4

/** 三轴路径可覆盖的轴集合。 */
export const PATH_AXES = ['x', 'y', 'z'] as const

export type PathAxis = (typeof PATH_AXES)[number]

/** 路径条目的语义形状（全部字段都在 root.paths[] 的 JSON 对象里）。 */
export interface PathEntryShape {
  id: string
  clip: string
  from: number
  to: number
  axes: PathAxis[]
  geometry: JsonObject
  timing?: JsonObject
}

/** 一条字段级路径诊断（内部校验产物，尚未绑定 pathId / jsonPath）。 */
export interface PathFieldIssue {
  /** 相对条目的点分字段，如 `from` / `geometry.radius`。 */
  field: string
  message: string
}

/** 一条路径诊断（本地即时显示，保存前再由 script.validate 兜底）。 */
export interface PathIssue {
  /** 稳定身份：pathId + 字段 + 代码。 */
  id: string
  pathId: string
  /** 字段路径，如 `paths[0].from` 或 `paths[0].geometry.radius`。 */
  jsonPath: string
  /** 点分字段名（相对条目），如 `from` / `geometry.radius`。 */
  field: string
  code: string
  severity: 'block' | 'error' | 'warn' | 'info'
  message: string
}

/** 一条路径的只读摘要（列表行用）。 */
export interface PathSummary {
  id: string
  clip: string
  from: number
  to: number
  axes: PathAxis[]
  geometryType: string
  timingType: 'linear' | 'keyframes'
  issueCount: number
  /** 与哪条路径部分重叠（起点更晚者生效）。 */
  overlapsWith: string[]
}

/** 端点并集（目标片段 position.x/y/z 的关键帧时间）。 */
export interface PositionNodeTimes {
  times: number[]
  /** 每条具体时间来自哪个字段（诊断/选择用）。 */
  byField: Record<string, number[]>
}

/** New path 的默认值（07-05：id=p_<n>、三轴、geometry=line、timing 省略）。 */
export interface PathDraftDefaults {
  id: string
  clip: string
  from: number
  to: number
  axes: PathAxis[]
  geometry: JsonObject
}

/** 生成器模式。 */
export type ShapeGeneratorMode = 'bezier' | 'exact'

/** 生成器时间策略：保留已有节点节奏 / 替换区间内节点。 */
export type ShapeGeneratorTimeMode = 'keep-nodes' | 'replace'

/** 生成器输入（全部值已在前端校验）。 */
export interface ShapeGeneratorSpec {
  clip: string
  from: number
  to: number
  shape: 'circle' | 'arc' | 'ellipse'
  /** 圆心（表达式空间；relative 时是相对原点，base 时是局部轴）。 */
  center: { x: number; y: number; z: number }
  radius: number
  semiMajor: number
  semiMinor: number
  rotation: number
  startAngle: number
  endAngle: number
  clockwise: boolean
  normal: { x: number; y: number; z: number }
  referenceAxis: { x: number; y: number; z: number }
  mode: ShapeGeneratorMode
  segments: number | 'auto'
  timeMode: ShapeGeneratorTimeMode
}

/** 生成器输出：一条路径条目 + 位置键写入 + 影响面。 */
export interface ShapeGenerationPlan {
  paths: JsonObject[]
  /** 每个边界时刻的三轴值（片段局部秒）。 */
  keyTimes: Array<{ time: number; point: [number, number, number] }>
  /** 需要删除的区间内位置节点（time）。 */
  removeTimes: number[]
  /** 受影响的其他路径 id（删除节点 / 替换端点会破坏它们的引用）。 */
  impactedPaths: string[]
  /** 预览用理想采样（u 参数化）。 */
  preview: Array<{ u: number; point: [number, number, number] }>
  /** 实际写出的 Bezier 采样闭合误差（半径比例）。 */
  radialErrorRatio: number
  warnings: string[]
}

/** 预览采样点。 */
export interface PathSample {
  u: number
  point: [number, number, number]
  /** 单位切线；退化时为 null。 */
  tangent: [number, number, number] | null
}

/** 预览模型（纯派生，不写盘）。 */
export interface PathPreviewModel {
  pathId: string
  anchor: 'ENDPOINTS' | 'FREE' | 'START'
  anchorLabel: string
  from: [number, number, number]
  to: [number, number, number]
  /** 几何真实起终点（FREE/START 与 from/to 解耦）。 */
  geometryStart: [number, number, number]
  geometryEnd: [number, number, number]
  samples: PathSample[]
  controlPolygon: Array<[number, number, number]> | null
  /** 端点偏差（几何起点/终点与 from/to 的距离）。 */
  startDeviation: number
  endDeviation: number
  /** s(u) 折线（timing 直接映射，不依赖几何弧长）。 */
  timingCurve: Array<{ u: number; s: number }>
  warnings: string[]
  issues: PathIssue[]
}

/** 类型守卫：JSON 对象。 */
export function isPathObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 把 `axes` 规范成 x,y,z 顺序的数组（去重，未知轴丢弃前由校验负责报错）。 */
export function normalizeAxes(raw: readonly string[]): PathAxis[] {
  const set = new Set(raw)
  const result: PathAxis[] = []
  for (const axis of PATH_AXES) {
    if (set.has(axis)) {
      result.push(axis)
    }
  }
  return result
}

/** 读几何类型；`line` 归一成 `linear`（用于采样/校验），但写盘保留原字符串。 */
export function geometryTypeOf(geometry: JsonObject): string {
  const type = geometry.type
  return typeof type === 'string' ? type : ''
}

/** 是否为可采样类型（`line` 视为 linear）。 */
export function isKnownGeometryType(type: string): type is PathGeometryType | 'line' {
  return type === PATH_LINE_ALIAS || (PATH_GEOMETRY_TYPES as readonly string[]).includes(type)
}

/** 数组里第一个非有限数/非数字的下标；全合法返回 -1。 */
export function firstNonFiniteIndex(values: readonly unknown[]): number {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return index
    }
  }
  return -1
}
