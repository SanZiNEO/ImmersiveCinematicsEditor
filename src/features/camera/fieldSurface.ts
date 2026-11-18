/**
 * CAMERA 镜头字段路由（08-01 §4.1 / §4.3）。
 *
 * 只做一件事：按**字段路径** + 02 目录的 `section/group/mode/type` 判定这一行交给谁画——
 * 普通路径交给 06 的值控件（`PropertyValueForm`），五类特殊路径交给各自的编辑器，
 * 其余没有分支。
 *
 * 三条硬约束：
 * - 不维护第二份字段清单：曲线、调色通道、选择器调用点、遮罩几何全部从 02 目录推导；
 *   `modifier` 的通道名是运行时契约（`CameraChannels.NAMES`），与参数过渡六通道同源，
 *   复用 `TRANSITION_CHANNELS`，不另抄一份。
 * - 不读文档 store、不写文档、不写会话；同输入同输出。
 * - `transition*` 一族在本文件里只有"隐藏"这一种结论（08-01 §2.1 / §4.4）。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { FieldEntry } from '../../core/schema/types.ts'
import type { JsonObject } from '../../core/doc/types.ts'
import type { PropertyRow } from '../effects/types.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import {
  CAMERA_TRACK_TYPE,
  COMPOSITE_PATHS,
  TRANSITION_CHANNELS,
  TRANSITION_PATHS,
  type TransitionChannel,
} from './transition/model.ts'

export { CAMERA_TRACK_TYPE, COMPOSITE_PATHS, TRANSITION_PATHS }

/** 一行交给谁画（`none` = 06 值控件，或该行已被隐藏）。 */
export type CameraFieldKind = 'composite' | 'curve' | 'modifier' | 'selector' | 'breath' | 'none'

/** 合成矩形八个数（`TrackSchemas#cameraObjects:255-262`）：目标区与源区各四值。 */
export const COMPOSITE_RECT_PATHS: readonly string[] = [
  COMPOSITE_PATHS.destX, COMPOSITE_PATHS.destY, COMPOSITE_PATHS.destW, COMPOSITE_PATHS.destH,
  COMPOSITE_PATHS.sourceX, COMPOSITE_PATHS.sourceY, COMPOSITE_PATHS.sourceW, COMPOSITE_PATHS.sourceH,
]

/**
 * 遮罩几何五行（`TrackSchemas#cameraObjects:263-269`）。
 *
 * `mask_shape` 不在这里：它是把这一组打开/折叠的门，本身仍是 06 的枚举行。
 */
export const MASK_GEOMETRY_PATHS: readonly string[] = [
  COMPOSITE_PATHS.maskX, COMPOSITE_PATHS.maskY, COMPOSITE_PATHS.maskWidth,
  COMPOSITE_PATHS.maskHeight, COMPOSITE_PATHS.maskRadius,
]

/** `mask_shape` 的三种取值（`TrackSchemas#cameraObjects:271`，缺省 `full`）。 */
export const MASK_SHAPES = ['full', 'rect', 'circle'] as const
export type MaskShape = (typeof MASK_SHAPES)[number]

/** 遮罩形状缺省。 */
export const DEFAULT_MASK_SHAPE: MaskShape = 'full'

/** 呼吸 7 字段路径（`TrackSchemas#cameraObjects:294-301`）。 */
export const BREATH_PATHS = {
  enabled: 'cam_breath_enabled',
  intensity: 'cam_breath_intensity',
  seed: 'cam_breath_seed',
  type: 'cam_breath_type',
  speed: 'cam_breath_speed',
  trauma: 'cam_breath_trauma',
  decay: 'cam_breath_decay',
} as const

/** 覆盖链 `modifier` 与抑制开关的路径（`TrackSchemas#cameraObjects:314-315`）。 */
export const MODIFIER_PATHS = {
  modifier: 'modifier',
  suppress: 'suppress_modifiers',
} as const

/**
 * 覆盖链通道名（`CameraChannels.NAMES`，`:36`）。
 *
 * 与参数过渡六通道**逐字同源**（同一个运行时枚举），因此复用同一份常量，
 * 不在这里再抄一遍：`position` 一位含三轴，其余五个是标量。
 */
export const MODIFIER_CHANNELS: readonly TransitionChannel[] = TRANSITION_CHANNELS

/** `modifier` 内部的结构键（`ScriptParser#parseClipModifier:677`）。 */
export const MODIFIER_KEYS = {
  channels: 'channels',
  mode: 'mode',
  priority: 'priority',
} as const

/** 合成模式（`ScriptParser#parseModifierMode:738`；缺省 = 逐通道缺省）。 */
export const MODIFIER_MODES = ['add', 'multiply', 'replace'] as const
export type ModifierMode = (typeof MODIFIER_MODES)[number]

/** 通道的值形态：`position` 是 `{x,y,z}`，其余是有限数字。 */
export function modifierChannelValueShape(channel: TransitionChannel): 'position' | 'scalar' {
  return channel === 'position' ? 'position' : 'scalar'
}

/** `transition*` 一族：名字里带"转场"，但在片段面板里零出现（08-01 §2.1）。 */
export function isTransitionPath(path: string): boolean {
  const declared: readonly string[] = Object.values(TRANSITION_PATHS)
  if (declared.includes(path)) {
    return true
  }
  return path === TRANSITION_PATHS.type || path.startsWith(`${TRANSITION_PATHS.type}_`)
}

/**
 * 行是否隐藏：只对 CAMERA 生效，其他轨道恒 `false`（08-01 §4.4）。
 *
 * 属性面板与效果面板都要在派生行之后、渲染之前过这一道，转场行就不会有第二次入口。
 */
export function isHiddenRow(trackType: string, path: string): boolean {
  return trackType === CAMERA_TRACK_TYPE && isTransitionPath(path)
}

/**
 * 一份行的隐藏判定（给 `RowSource.omit` 用）。
 *
 * 未知路径（`def === undefined`）也照样判：文档里手写的 `transition_*` 键同样不能出现在面板里。
 */
export function rowOmittingPredicate(trackType: string): (path: string) => boolean {
  if (trackType !== CAMERA_TRACK_TYPE) {
    return () => false
  }
  return (path: string): boolean => isTransitionPath(path)
}

/**
 * 字段路径 → 编辑器种类（08-01 §4.1）。
 *
 * 判定只看 02 目录的事实：
 * - `section=composite` 且不是 `opacity` / `mask_shape` / `dimension` → `composite`；
 * - `section=color` 且 `type=struct`（10 条曲线）→ `curve`，其余 57 通道 → `none`；
 * - `section=breath` → `breath`；
 * - `section=modifier` → `modifier`；
 * - `section=selector` → `selector`；
 * - `transition*` 一律 `none`（随后被 `isHiddenRow` 拦掉）。
 */
export function cameraFieldKind(path: string, def: FieldEntry | undefined): CameraFieldKind {
  if (def === undefined) {
    return 'none'
  }
  if (isTransitionPath(path)) {
    return 'none'
  }
  switch (def.section) {
    case 'composite': {
      if (path === COMPOSITE_PATHS.opacity || path === COMPOSITE_PATHS.maskShape) {
        return 'none'
      }
      if (path === 'dimension') {
        return 'none'
      }
      return COMPOSITE_RECT_PATHS.includes(path) || MASK_GEOMETRY_PATHS.includes(path) ? 'composite' : 'none'
    }
    case 'color': {
      return def.type === 'struct' ? 'curve' : 'none'
    }
    case 'breath': {
      return 'breath'
    }
    case 'modifier': {
      return 'modifier'
    }
    case 'selector': {
      return 'selector'
    }
    default: {
      return 'none'
    }
  }
}

/** 行版本的种类判定：未知路径没有目录条目，一律 `none`（只读行仍由 06 画）。 */
export function cameraFieldKindOfRow(row: PropertyRow): CameraFieldKind {
  if (row.unknown) {
    return 'none'
  }
  return cameraFieldKind(row.path, row.def)
}

/** 该行是否已经搬去效果面板（`keyframes` 非空即所有者转移，08-01 §4.2）。 */
export function rowIsAnimated(row: PropertyRow): boolean {
  return row.keyframes.length > 0
}

/** 特殊编辑器只画"还留在属性面板的叶子"：有帧的行归效果面板，不能两处同时出现。 */
export function staticRows(rows: readonly PropertyRow[]): PropertyRow[] {
  return rows.filter((row) => !rowIsAnimated(row))
}

/** 组内交给某个编辑器的行（不含已打帧的叶子）。 */
export function rowsOfKind(rows: readonly PropertyRow[], kind: CameraFieldKind): PropertyRow[] {
  return staticRows(rows).filter((row) => cameraFieldKindOfRow(row) === kind)
}

/** 曲线路径与条目：`section=color` 且 `type=struct`（CAMERA 10 条，顺序即目录顺序）。 */
export function cameraCurveEntries(catalog: CatalogIndex): FieldEntry[] {
  const track = catalog.track(CAMERA_TRACK_TYPE)
  if (track === undefined) {
    return []
  }
  return track.objects.filter((def) => def.section === 'color' && def.type === 'struct')
}

/** 57 个调色通道条目：`section=color` 且非 `struct`（顺序、范围、类型全部来自目录）。 */
export function cameraColorChannelEntries(catalog: CatalogIndex): FieldEntry[] {
  const track = catalog.track(CAMERA_TRACK_TYPE)
  if (track === undefined) {
    return []
  }
  return track.objects.filter((def) => def.section === 'color' && def.type !== 'struct')
}

/** 选择器一行。 */
export interface SelectorField {
  /** 通用字段名（`selector_refresh` 的 `refresh`）。 */
  field: string
  /** 该行路径：通用 = `selector_<field>`，调用点 = `selector_<field>_<callpoint>`。 */
  path: string
  /** 目录条目（类型与枚举从它取）。 */
  def: FieldEntry
}

/** 一个调用点的 6 行覆盖（字段名由目录路径推导，不维护第二份调用点清单）。 */
export interface SelectorCallpoint {
  callpoint: string
  fields: SelectorField[]
}

/** 选择器布局：通用 6 行 + 7 组调用点覆盖。 */
export interface SelectorLayout {
  generic: SelectorField[]
  callpoints: SelectorCallpoint[]
}

/** 选择器路径前缀（`TrackSchemas#cameraObjects:318`）。 */
const SELECTOR_PREFIX = 'selector_'

/**
 * 从目录推导选择器布局（08-01 §4.3「调用点字段名从 02 路径推导」）。
 *
 * 推导规则：把 `selector_` 之后的剩余串记为 `r`。若存在另一个剩余串以 `r + '_'` 开头，
 * 则 `r` 是通用字段名、后半段是调用点名。因此通用字段与调用点**都**只从目录出现的事实得出，
 * 不写死 6 个字段名或 7 个调用点名。
 */
export function selectorLayout(catalog: CatalogIndex): SelectorLayout {
  const track = catalog.track(CAMERA_TRACK_TYPE)
  if (track === undefined) {
    return { generic: [], callpoints: [] }
  }
  const entries = track.objects.filter(
    (def) => def.section === 'selector' && def.key.startsWith(SELECTOR_PREFIX),
  )
  const remainders = entries.map((def) => ({ def, rest: def.key.slice(SELECTOR_PREFIX.length) }))

  const generic: SelectorField[] = []
  const callpointOrder: string[] = []
  const callpointFields = new Map<string, SelectorField[]>()

  for (const item of remainders) {
    const isGeneric = remainders.some((other) => other.rest.startsWith(`${item.rest}_`))
    if (!isGeneric) {
      continue
    }
    generic.push({ field: item.rest, path: item.def.key, def: item.def })
    for (const other of remainders) {
      if (!other.rest.startsWith(`${item.rest}_`)) {
        continue
      }
      const callpoint = other.rest.slice(item.rest.length + 1)
      let bucket = callpointFields.get(callpoint)
      if (bucket === undefined) {
        bucket = []
        callpointFields.set(callpoint, bucket)
        callpointOrder.push(callpoint)
      }
      bucket.push({ field: item.rest, path: other.def.key, def: other.def })
    }
  }

  return {
    generic,
    callpoints: callpointOrder.map((callpoint) => ({
      callpoint,
      fields: callpointFields.get(callpoint) ?? [],
    })),
  }
}

/** 呼吸 7 字段的行（目录顺序）。 */
export function breathRows(rows: readonly PropertyRow[]): PropertyRow[] {
  return rows.filter((row) => row.def?.section === 'breath')
}

/**
 * 遮罩形状的当前值：行值 > 目录缺省 > `full`。
 *
 * 关键帧不参与：`mask_shape` 是 `mode=value` 的枚举，运行时不插值。
 */
export function maskShapeOf(objects: JsonObject, def: FieldEntry | undefined): MaskShape {
  const raw = objects[COMPOSITE_PATHS.maskShape]
  if (isJsonObject(raw) && typeof raw.value === 'string') {
    return MASK_SHAPES.includes(raw.value as MaskShape) ? (raw.value as MaskShape) : DEFAULT_MASK_SHAPE
  }
  const fallback = def?.default
  if (typeof fallback === 'string' && MASK_SHAPES.includes(fallback as MaskShape)) {
    return fallback as MaskShape
  }
  return DEFAULT_MASK_SHAPE
}

/** 遮罩几何里哪些路径在当前形状下生效（显隐只影响界面，不删值、不删帧）。 */
export function activeMaskGeometryPaths(shape: MaskShape): readonly string[] {
  switch (shape) {
    case 'rect': {
      return [COMPOSITE_PATHS.maskX, COMPOSITE_PATHS.maskY, COMPOSITE_PATHS.maskWidth, COMPOSITE_PATHS.maskHeight]
    }
    case 'circle': {
      return [COMPOSITE_PATHS.maskX, COMPOSITE_PATHS.maskY, COMPOSITE_PATHS.maskRadius]
    }
    default: {
      return []
    }
  }
}

/** 一条调色曲线的控制点（`[x, y]`，两轴 0~1）。 */
export interface CurvePoint {
  x: number
  y: number
}

/** 控制点解析结果。 */
export type CurvePointParse =
  | { ok: true; points: CurvePoint[] }
  | { ok: false; reason: string }

/**
 * 读控制点数组（`ScriptParser#parseColorCurve:612` 的同一口径）。
 *
 * 数组、每点两个数字、两轴 0~1、`x` 严格递增、至少两点；不合法**只报错、不重排、不夹紧**。
 */
export function parseCurvePoints(value: unknown): CurvePointParse {
  if (!Array.isArray(value)) {
    return { ok: false, reason: '需要控制点数组 [[x, y], ...]' }
  }
  if (value.length < 2) {
    return { ok: false, reason: `至少需要 2 个控制点，实际 ${value.length}` }
  }
  const points: CurvePoint[] = []
  let previousX = Number.NEGATIVE_INFINITY
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index]
    if (!Array.isArray(item) || item.length !== 2) {
      return { ok: false, reason: `第 ${index + 1} 个控制点需要 [x, y] 两个数字` }
    }
    const x: unknown = item[0]
    const y: unknown = item[1]
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return { ok: false, reason: `第 ${index + 1} 个控制点需要 [x, y] 两个数字` }
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      return { ok: false, reason: `第 ${index + 1} 个控制点超出 0~1：${x}, ${y}` }
    }
    if (x <= previousX) {
      return { ok: false, reason: `第 ${index + 1} 个控制点的 x 必须严格递增（前一个 ${previousX}）` }
    }
    previousX = x
    points.push({ x, y })
  }
  return { ok: true, points }
}

/** 已解析控制点的合法性检查（增删点之后原地校验用，不夹紧）。 */
export function curvePointsProblem(points: readonly CurvePoint[]): string | null {
  if (points.length < 2) {
    return `至少需要 2 个控制点，实际 ${points.length}`
  }
  let previousX = Number.NEGATIVE_INFINITY
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return `第 ${index + 1} 个控制点不是有限数字`
    }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      return `第 ${index + 1} 个控制点超出 0~1：${point.x}, ${point.y}`
    }
    if (point.x <= previousX) {
      return `第 ${index + 1} 个控制点的 x 必须严格递增`
    }
    previousX = point.x
  }
  return null
}

/** 控制点 → 写入用的 JSON（`JsonValue` 里允许的 `number[][]`）。 */
export function curvePointsToJson(points: readonly CurvePoint[]): number[][] {
  return points.map((point) => [point.x, point.y])
}

/** 一条曲线行的当前值（未设置 / 空表 = `[]`，由调用方决定是否算"删路径"）。 */
export function curveValueOf(objects: JsonObject, path: string): { present: boolean; points: CurvePoint[]; problem: string | null } {
  const raw = objects[path]
  if (!isJsonObject(raw)) {
    return { present: false, points: [], problem: null }
  }
  const parsed = parseCurvePoints(raw.value)
  if (!parsed.ok) {
    return { present: true, points: [], problem: parsed.reason }
  }
  return { present: true, points: parsed.points, problem: null }
}

/**
 * 特殊编辑器的统一入参（`CameraSectionEditor` 分派给五个组件）。
 *
 * 组件只读 `objects` / `rows`，写入一律走 `usePanelContext().commands.commit`；
 * `rows` 是该 `section` 的全部行（含已打帧的叶子），组件自己用 `staticRows` 过滤。
 */
export interface CameraEditorInput {
  clipKey: string
  /** 片段 `objects` 原始 JSON（只读视图）。 */
  objects: JsonObject
  /** 该 section 的全部属性行（含已打帧的叶子）。 */
  rows: readonly PropertyRow[]
  /** 02 目录：曲线路径、57 通道、6 个通用选择器字段与 7 个调用点都由它推导。 */
  catalog: CatalogIndex
  /** 只读态（选区变化 / 面板禁用时置真）。 */
  disabled: boolean
  /** 播放头（透传给 06 值控件：建帧 / 跳帧只在属性面板的静态行上发生）。 */
  playhead: number
}
