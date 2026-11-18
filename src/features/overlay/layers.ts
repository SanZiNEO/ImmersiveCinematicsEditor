/**
 * OVERLAY 层类型字段面（09-01）。
 *
 * 事实基准：
 * - `TrackSchemas.overlayObjects()` 的 `appliesTo`（editor 目录 `core/schema/catalog/tracks.ts`）；
 * - `script/OverlayClipRuntime.java` 的 `compute`：`image` / `subtitle` / 其余按 fade 装配；
 *   但 `createObjectLayer` 对未知 `layer_type` 返回 `null`（不建层）。因此编辑器只把
 *   「字段面回退 fade」用于显示，校验器把显式非法值判为 error。
 * - `script/object/ObjectValidator.java#checkOverlay`：层类型缺省 `fade`，显式存在的
 *   `appliesTo` 不命中即报「不适用于 layer_type」。
 *
 * 本模块只做纯函数：不碰 Vue、不碰 store、不改文档。
 */
import { isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { PropertyRow } from '../effects/types.ts'

/** 三种层类型（wire 名）。 */
export const OVERLAY_LAYER_TYPES = ['fade', 'image', 'subtitle'] as const
export type OverlayLayerType = (typeof OVERLAY_LAYER_TYPES)[number]

/** 层类型中文名（面板用）。 */
export const OVERLAY_LAYER_LABELS: Record<OverlayLayerType, string> = {
  fade: '颜色层',
  image: '图片 / 视频层',
  subtitle: '字幕层',
}

/** 层类型缺省（与 `TrackSchemas.overlayObjects` / `OverlayClipRuntime.DEFAULT_LAYER_TYPE` 一致）。 */
export const DEFAULT_LAYER_TYPE: OverlayLayerType = 'fade'

/** 是否为合法 wire 层类型。 */
export function isOverlayLayerType(value: unknown): value is OverlayLayerType {
  return typeof value === 'string' && (OVERLAY_LAYER_TYPES as readonly string[]).includes(value)
}

/** 读一个 AnimObject 的显式 `value`；没有该键返回 `{ present:false }`。 */
export function explicitValue(objects: JsonObject, path: string): { present: boolean; value?: JsonValue } {
  const raw = objects[path]
  if (!isJsonObject(raw)) {
    return { present: false }
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return { present: false }
  }
  return { present: true, value: raw.value as JsonValue }
}

/**
 * 作者显式写出的 `layer_type` 字符串（合法或非法都返回，供诊断/选择框显示）。
 *
 * 缺失、非对象、没有 `value`、值不是字符串 → `null`。
 */
export function declaredLayerType(objects: JsonObject): string | null {
  const explicit = explicitValue(objects, 'layer_type')
  if (!explicit.present) {
    return null
  }
  return typeof explicit.value === 'string' ? explicit.value : null
}

/**
 * 有效字段面层类型：`image` / `subtitle` 之外的值都按 fade 字段面显示。
 *
 * 注意这不是完整运行语义：未知 `layer_type` 在运行时不会建层，显式非法值由
 * `validateOverlayObjects` 判 error；这里仅用于面板决定显示哪套字段。
 */
export function effectiveLayerType(objects: JsonObject): OverlayLayerType {
  const declared = declaredLayerType(objects)
  return declared === 'image' || declared === 'subtitle' ? declared : DEFAULT_LAYER_TYPE
}

/** 显式写出的层类型非法（提示「字段面按 fade、运行时不建层」，不改写）。 */
export function invalidLayerTypeWarning(objects: JsonObject): string | null {
  const declared = declaredLayerType(objects)
  if (declared === null) {
    return null
  }
  if (isOverlayLayerType(declared)) {
    return null
  }
  return `layer_type="${declared}" 不是合法类型，运行时不建层；面板按 fade 字段面显示，不自动改写`
}

/**
 * 每层可显示的字段面（09-01 §4.1 / 09-02~09-05 的「不读取」表）。
 *
 * 只列目录里真实存在的路径；`appliesTo` 是下限，运行时实际读取与否决定上限：
 * fade 不读 x/y/anchor/scale；image 不读 font/text/color/mask/gradient；
 * subtitle 不读 path/color/mask/gradient/source。
 */
export const OVERLAY_FIELD_PATHS: Record<OverlayLayerType, readonly string[]> = {
  fade: [
    'layer_type',
    'opacity',
    'color',
    'color.r',
    'color.g',
    'color.b',
    'gradient',
    'mask_shape',
    'blend_mode',
    'mask_x',
    'mask_y',
    'mask_width',
    'mask_height',
    'mask_radius',
    'gradient_angle',
    'gradient_center_x',
    'gradient_center_y',
    'gradient_radius',
    'z_index',
  ],
  image: [
    'layer_type',
    'x',
    'y',
    'anchor_x',
    'anchor_y',
    'scale_x',
    'scale_y',
    'source.x',
    'source.y',
    'source.w',
    'source.h',
    'opacity',
    'path',
    'z_index',
  ],
  subtitle: [
    'layer_type',
    'x',
    'y',
    'anchor_x',
    'anchor_y',
    'scale_x',
    'scale_y',
    'opacity',
    'font_scale',
    'text',
    'z_index',
  ],
}

const FIELD_SETS: Record<OverlayLayerType, ReadonlySet<string>> = {
  fade: new Set(OVERLAY_FIELD_PATHS.fade),
  image: new Set(OVERLAY_FIELD_PATHS.image),
  subtitle: new Set(OVERLAY_FIELD_PATHS.subtitle),
}

/** 该路径是否属于层类型字段面（`layer_type` 自身永远属于）。 */
export function isOverlayFieldApplicable(layerType: OverlayLayerType, path: string): boolean {
  return FIELD_SETS[layerType].has(path)
}

/** 渐变结构（value-only）解析结果。非法结构返回 `null`（由校验器报，不在这里改写）。 */
export interface GradientStop {
  offset: number
  color: string
  [key: string]: JsonValue
}

export interface GradientStruct {
  type: 'linear' | 'radial'
  stops: GradientStop[]
  [key: string]: JsonValue
}

/** 读 `gradient` 的显式结构（只在结构形状最基本可用时返回；详细校验见 `colorMask.ts`）。 */
export function readGradientStruct(objects: JsonObject): GradientStruct | null {
  const explicit = explicitValue(objects, 'gradient')
  if (!explicit.present || !isJsonObject(explicit.value)) {
    return null
  }
  const raw = explicit.value
  const type = raw.type
  if (type !== 'linear' && type !== 'radial') {
    return null
  }
  const stopsRaw = raw.stops
  if (!Array.isArray(stopsRaw) || stopsRaw.length < 2) {
    return null
  }
  const stops: GradientStop[] = []
  for (const stop of stopsRaw) {
    if (!isJsonObject(stop)) {
      return null
    }
    const offset = stop.offset
    const color = stop.color
    if (typeof offset !== 'number' || !Number.isFinite(offset) || typeof color !== 'string') {
      return null
    }
    stops.push({ ...stop, offset, color })
  }
  return { ...raw, type, stops } as GradientStruct
}

/** `mask_shape` 的显式值（缺失 = `full`；非法值原样返回供提示）。 */
export function maskShapeOf(objects: JsonObject): string {
  const explicit = explicitValue(objects, 'mask_shape')
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : 'full'
}

/** 该路径在当前对象下是否显示；返回 `null` 表示显示。 */
export function hiddenOverlayFieldReason(
  layerType: OverlayLayerType,
  objects: JsonObject,
  path: string,
): string | null {
  if (!isOverlayFieldApplicable(layerType, path)) {
    return `${path} 不作用于 ${layerType} 层（运行时该层不读取）`
  }
  if (layerType !== 'fade') {
    return null
  }

  const gradient = readGradientStruct(objects)
  const gradientPresent = gradient !== null || explicitValue(objects, 'gradient').present
  if (gradientPresent) {
    if (path === 'color' || path === 'color.r' || path === 'color.g' || path === 'color.b') {
      return '已声明渐变：基色与通道只作为回退值，不参与渲染；不显示值控件'
    }
    if (path.startsWith('gradient_')) {
      if (gradient === null) {
        return 'gradient 结构非法，渐变几何暂不显示（先修正结构）'
      }
      if (gradient.type === 'linear' && path === 'gradient_radius') {
        return '线性渐变不读取 gradient_radius'
      }
      if (gradient.type === 'radial' && path === 'gradient_angle') {
        return '径向渐变不读取 gradient_angle'
      }
    }
  } else if (path.startsWith('gradient_')) {
    return '未声明渐变（先添加 gradient 结构）'
  }

  const maskShape = maskShapeOf(objects)
  if (path === 'mask_x' || path === 'mask_y' || path === 'mask_width' || path === 'mask_height' || path === 'mask_radius') {
    if (maskShape === 'full') {
      return 'mask_shape=full：不使用遮罩几何'
    }
    if (maskShape === 'rect' && path === 'mask_radius') {
      return '矩形遮罩不读取 mask_radius'
    }
    if (maskShape === 'circle' && (path === 'mask_width' || path === 'mask_height')) {
      return '圆形遮罩不读取 mask_width / mask_height'
    }
    if (maskShape !== 'rect' && maskShape !== 'circle') {
      return `mask_shape="${maskShape}" 非法：遮罩几何不显示`
    }
  }
  return null
}

/** 面板行过滤结果：可见行 + 被门控掉的行（用于诊断，不参与渲染）。 */
export interface OverlayGateResult {
  rows: PropertyRow[]
  hidden: Array<{ path: string; reason: string }>
}

/**
 * 按层类型过滤属性行（09-01 §4.1）。
 *
 * - 未知路径只在属性面板的「未知 / 扩展」组做只读诊断；效果面板过滤掉未知行。
 * - `panel='effects'` 时额外剔除 value-only 行（它们不可能有帧；即使脚本非法写了帧，
 *   09 也不在效果面板提供值控件）。
 */
export function gateOverlayRows(
  rows: readonly PropertyRow[],
  objects: JsonObject,
  options: { panel: 'properties' | 'effects' },
): OverlayGateResult {
  const layerType = effectiveLayerType(objects)
  const visible: PropertyRow[] = []
  const hidden: Array<{ path: string; reason: string }> = []
  for (const row of rows) {
    if (row.unknown) {
      if (options.panel === 'effects') {
        hidden.push({ path: row.path, reason: '未知 / 扩展路径只在属性面板做只读诊断' })
        continue
      }
      visible.push(row)
      continue
    }
    const reason = hiddenOverlayFieldReason(layerType, objects, row.path)
    if (reason !== null) {
      hidden.push({ path: row.path, reason })
      continue
    }
    if (options.panel === 'effects' && row.mode === 'value') {
      hidden.push({ path: row.path, reason: 'value-only 字段没有关键帧，不进效果面板' })
      continue
    }
    visible.push(row)
  }
  return { rows: visible, hidden }
}

/** LETTERBOX 字段面（09-06）：目录只有 `aspect_ratio` / `opacity`。 */
export const LETTERBOX_FIELD_PATHS = ['aspect_ratio', 'opacity'] as const

/** 该路径是否属于 LETTERBOX 字段面。 */
export function isLetterboxFieldApplicable(path: string): boolean {
  return (LETTERBOX_FIELD_PATHS as readonly string[]).includes(path)
}

/** LETTERBOX 面板行过滤（未知路径仍交给 06 的未知组）。 */
export function gateLetterboxRows(
  rows: readonly PropertyRow[],
  options: { panel: 'properties' | 'effects' },
): OverlayGateResult {
  const visible: PropertyRow[] = []
  const hidden: Array<{ path: string; reason: string }> = []
  for (const row of rows) {
    if (row.unknown) {
      if (options.panel === 'effects') {
        hidden.push({ path: row.path, reason: '未知 / 扩展路径只在属性面板做只读诊断' })
        continue
      }
      visible.push(row)
      continue
    }
    if (!isLetterboxFieldApplicable(row.path)) {
      hidden.push({ path: row.path, reason: `${row.path} 不属于 LETTERBOX 字段面` })
      continue
    }
    if (options.panel === 'effects' && row.mode === 'value') {
      hidden.push({ path: row.path, reason: 'value-only 字段没有关键帧，不进效果面板' })
      continue
    }
    visible.push(row)
  }
  return { rows: visible, hidden }
}

/** 一次层类型切换的计划（09-01 §4.2 / 4.3：只删不加）。 */
export interface LayerSwitchPlan {
  from: OverlayLayerType
  /** 作者显式写出的原值（缺失 / 非法时为 `null` / 原字符串），仅用于确认文案。 */
  declaredFrom: string | null
  to: OverlayLayerType
  /** 保留的显式路径（只算对象表里真实存在的）。 */
  keep: string[]
  /** 将删除的显式路径（含源类型不适用的声明字段与非法死字段）。 */
  remove: string[]
  /** 是否要写显式 `layer_type`（目标与当前有效类型不同，或原值未显式合法写出）。 */
  writeLayerType: boolean
}

/** 目标类型字段面与源对象表求交/差；`layer_type` 自身不列入 keep/remove。 */
export function planLayerSwitch(objects: JsonObject, target: OverlayLayerType): LayerSwitchPlan {
  const from = effectiveLayerType(objects)
  const declaredFrom = declaredLayerType(objects)
  const present = Object.keys(objects).filter((path) => path !== 'layer_type')
  const keep: string[] = []
  const remove: string[] = []
  for (const path of present) {
    // 未知键（目录未登记的扩展路径）不在字段面里；09-01 §4.1 要求保留给诊断，不删。
    if (!isKnownOverlayPath(path)) {
      keep.push(path)
      continue
    }
    if (isOverlayFieldApplicable(target, path)) {
      keep.push(path)
    } else {
      remove.push(path)
    }
  }
  const writeLayerType = declaredFrom !== target || from !== target
  return { from, declaredFrom, to: target, keep: keep.sort(), remove: remove.sort(), writeLayerType }
}

const KNOWN_OVERLAY_PATHS: ReadonlySet<string> = new Set(
  [...OVERLAY_FIELD_PATHS.fade, ...OVERLAY_FIELD_PATHS.image, ...OVERLAY_FIELD_PATHS.subtitle],
)

/** 目录是否登记该 OVERLAY 路径（跨三种层类型的并集）。 */
export function isKnownOverlayPath(path: string): boolean {
  return KNOWN_OVERLAY_PATHS.has(path)
}

/**
 * 应用切换计划，返回**新的** objects 克隆（不修改入参）。
 *
 * `writeLayerType=false` 且没有删除项时返回克隆本身（调用方据此判断 no-op）。
 */
export function applyLayerSwitchPlan(objects: JsonObject, plan: LayerSwitchPlan): JsonObject {
  const next = cloneJsonObject(objects)
  if (plan.writeLayerType) {
    next.layer_type = { value: plan.to } as JsonObject
  }
  for (const path of plan.remove) {
    delete next[path]
  }
  return next
}

/** 显式存在但不适用于当前层类型的已知字段（用于「清理死字段」横幅）。 */
export function deadOverlayFields(objects: JsonObject): string[] {
  const layerType = effectiveLayerType(objects)
  return Object.keys(objects)
    .filter((path) => path !== 'layer_type' && isKnownOverlayPath(path) && !isOverlayFieldApplicable(layerType, path))
    .sort()
}

/** 浅克隆 objects 的 AnimObject 层（值对象不深拷贝；写入时整体替换）。 */
export function cloneJsonObject(objects: JsonObject): JsonObject {
  const next: JsonObject = {}
  for (const [path, value] of Object.entries(objects)) {
    next[path] = isJsonObject(value) ? { ...value } : value
  }
  return next
}
