/**
 * 颜色 / 渐变 / 遮罩结构（09-02）。
 *
 * 事实基准：
 * - `script/ColorMaskSpec.java`：`color` = `#RRGGBB`（`#` 可省、大小写均可、恰 6 位）；
 *   `gradient` = `{type: linear|radial, stops: [{offset, color}, ...]}`，≥2 个色标、
 *   offset 有限且 0~1、严格递增；`mask_shape` = `full|rect|circle`；
 *   `blend_mode` = `normal|multiply|screen|soft_light|overlay`。
 * - `script/OverlayClipRuntime.java`：`color.r/g/b` 逐通道回落 value-only `color`；
 *   `mask_shape=full` 不读遮罩几何，`rect` 读 x/y/width/height，`circle` 读 x/y/radius；
 *   线性渐变读 angle + center，径向渐变读 center + radius。
 *
 * 本模块只做纯函数与 patch 计划；写文档由调用方走 `commitAll`。
 */
import { isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { explicitValue, readGradientStruct } from './layers.ts'
import type { GradientStruct } from './layers.ts'

/** 遮罩形状枚举（wire 名）。 */
export const MASK_SHAPES = ['full', 'rect', 'circle'] as const
export type MaskShape = (typeof MASK_SHAPES)[number]

/** 混合模式枚举（wire 名）。 */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'soft_light', 'overlay'] as const
export type BlendMode = (typeof BLEND_MODES)[number]

/** 渐变类型枚举。 */
export const GRADIENT_TYPES = ['linear', 'radial'] as const
export type GradientType = (typeof GRADIENT_TYPES)[number]

/** 遮罩几何路径。 */
export const MASK_GEOMETRY_PATHS = ['mask_x', 'mask_y', 'mask_width', 'mask_height', 'mask_radius'] as const
/** 渐变几何路径。 */
export const GRADIENT_GEOMETRY_PATHS = [
  'gradient_angle',
  'gradient_center_x',
  'gradient_center_y',
  'gradient_radius',
] as const

/** 一个 patch 项：`{path, value}` 写入；`{path, remove:true}` 删除。 */
export type FieldPatch = { path: string; value: JsonValue } | { path: string; remove: true }

/** `#RRGGBB` 规范形（小写、带 `#`）；非法返回 `null`。 */
export function normalizeHexColor(input: string): string | null {
  const text = input.trim()
  const hex = text.startsWith('#') ? text.slice(1) : text
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }
  return `#${hex.toLowerCase()}`
}

/** `#RRGGBB`（`#` 可省）→ `[r,g,b]`（0..255 整数）；非法返回 `null`。 */
export function hexToRgb(input: string): [number, number, number] | null {
  const normalized = normalizeHexColor(input)
  if (normalized === null) {
    return null
  }
  const hex = normalized.slice(1)
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

/** 0..1 浮点通道 → `#rrggbb`（与 `ColorMaskSpec.rgb` 同口径：四舍五入并钳制，非有限按 0）。 */
export function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 0
    }
    return Math.max(0, Math.min(255, Math.round(value * 255)))
  }
  const hex = (value: number): string => value.toString(16).padStart(2, '0')
  return `#${hex(channel(red))}${hex(channel(green))}${hex(channel(blue))}`
}

/** 读基色（value-only `color`；缺失/非法 → 黑色）。 */
export function baseColorOf(objects: JsonObject): string {
  const explicit = explicitValue(objects, 'color')
  if (explicit.present && typeof explicit.value === 'string') {
    return normalizeHexColor(explicit.value) ?? '#000000'
  }
  return '#000000'
}

/** 写基色的 patch：同时把颜色通道显式值清掉？09-02 §三：改 hex 只写 `color.value`，不动通道。 */
export function baseColorPatch(input: string): { ok: true; patch: { path: 'color'; value: string } } | { ok: false; message: string } {
  const normalized = normalizeHexColor(input)
  if (normalized === null) {
    return { ok: false, message: '颜色格式非法：需要 #RRGGBB 六位十六进制（# 可省略）' }
  }
  return { ok: true, patch: { path: 'color', value: normalized } }
}

/**
 * `color` 的显示模型：
 * - 无任何显式通道时，hex 可编辑；
 * - 任一通道有帧（或非默认显式值）时，hex 显示合成色但只读，并说明由关键帧决定。
 *
 * `channelPresent(path)` 由调用方按行集合提供（`color.r/g/b` 是否有帧/显式值）。
 */
export interface ColorHexView {
  hex: string
  editable: boolean
  note: string | null
}

/** 合成显示色（通道显式值优先，否则基色）。 */
export function colorHexView(
  objects: JsonObject,
  channels: { r?: number; g?: number; b?: number; animated: boolean; overridden?: boolean },
): ColorHexView {
  const base = hexToRgb(baseColorOf(objects)) ?? [0, 0, 0]
  const hex = rgbToHex(channels.r ?? base[0] / 255, channels.g ?? base[1] / 255, channels.b ?? base[2] / 255)
  if (channels.animated) {
    return { hex, editable: false, note: '颜色通道已有关键帧：hex 只显示播放头合成色，改色请逐通道打帧' }
  }
  if (channels.overridden === true) {
    return { hex, editable: false, note: '颜色通道有显式值：hex 只显示合成色；改基色不会覆盖已声明的通道' }
  }
  return { hex, editable: true, note: null }
}

/** 渐变结构校验问题（路径 + 文案，与 `ColorMaskSpec` 的报错口径一致）。 */
export interface GradientIssue {
  path: string
  message: string
}

/**
 * 校验 `gradient` 的显式值（只校验形状；`null`/缺失视为「无渐变」合法）。
 *
 * 返回空数组 = 合法。非法结构不允许写入（09-02 §4.2）。
 */
export function validateGradientValue(value: JsonValue | undefined): GradientIssue[] {
  if (value === undefined) {
    return []
  }
  if (!isJsonObject(value)) {
    return [{ path: 'gradient', message: '需要对象 {type: linear|radial, stops: [...]}（缺省 = 纯色）' }]
  }
  const issues: GradientIssue[] = []
  const type = value.type
  if (typeof type !== 'string' || !(GRADIENT_TYPES as readonly string[]).includes(type)) {
    issues.push({ path: 'gradient.type', message: '需要 linear / radial' })
  }
  const stops = value.stops
  if (!Array.isArray(stops)) {
    issues.push({ path: 'gradient.stops', message: '需要数组 [{offset, color}, ...]（至少 2 个色标）' })
    return issues
  }
  if (stops.length < 2) {
    issues.push({ path: 'gradient.stops', message: `至少需要 2 个色标，实际: ${stops.length}` })
  }
  let previous = Number.NEGATIVE_INFINITY
  stops.forEach((stop, index) => {
    const prefix = `gradient.stops[${index}]`
    if (!isJsonObject(stop)) {
      issues.push({ path: prefix, message: '需要对象 {offset, color}' })
      return
    }
    const offset = stop.offset
    if (typeof offset !== 'number' || !Number.isFinite(offset)) {
      issues.push({ path: `${prefix}.offset`, message: '需要有限数字（0~1）' })
    } else {
      if (offset < 0 || offset > 1) {
        issues.push({ path: `${prefix}.offset`, message: `超出范围 0~1：${offset}` })
      }
      if (index > 0 && offset <= previous) {
        issues.push({
          path: `${prefix}.offset`,
          message: `必须严格递增（前一个 offset = ${previous}，当前 = ${offset}）`,
        })
      }
      previous = offset
    }
    const color = stop.color
    if (typeof color !== 'string' || normalizeHexColor(color) === null) {
      issues.push({ path: `${prefix}.color`, message: '需要字符串颜色（#RRGGBB 六位十六进制，# 可省）' })
    }
  })
  return issues
}

/** 创建一份合法默认渐变：黑 → 白，线性。 */
export function defaultGradient(): GradientStruct {
  return {
    type: 'linear',
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  }
}

/** 渐变的可写结构（值对象，不带 `{value}` 外壳；保留定义里的未知键）。 */
export function gradientValue(struct: GradientStruct): JsonObject {
  return {
    ...struct,
    type: struct.type,
    stops: struct.stops.map((stop) => ({ ...stop, offset: stop.offset, color: stop.color })),
  }
}

/** 改渐变类型：返回 STRUCT patch + 需要删除的另一类型几何。 */
export function gradientTypePatch(struct: GradientStruct, type: GradientType): {
  struct: GradientStruct
  remove: string[]
} {
  const next: GradientStruct = { ...struct, type, stops: struct.stops.map((stop) => ({ ...stop })) }
  return {
    struct: next,
    remove: type === 'linear' ? ['gradient_radius'] : ['gradient_angle'],
  }
}

/** 新增色标：偏移落在最后一段中间，颜色默认取末尾颜色；仍保持严格递增。 */
export function appendGradientStop(struct: GradientStruct, color = '#ffffff'): GradientStruct {
  const stops = struct.stops.map((stop) => ({ ...stop })).sort((a, b) => a.offset - b.offset)
  const last = stops[stops.length - 1]
  if (last === undefined) {
    return { ...struct, stops: [{ offset: 0, color }, { offset: 1, color }] }
  }
  const before = stops[stops.length - 2]
  const offset = before === undefined ? last.offset / 2 : (before.offset + last.offset) / 2
  stops.splice(Math.max(1, stops.length - 1), 0, { offset, color })
  return { ...struct, stops }
}

/** 删除色标：少于 2 个时拒绝。 */
export function removeGradientStop(
  struct: GradientStruct,
  index: number,
): { ok: true; struct: GradientStruct } | { ok: false; message: string } {
  if (struct.stops.length <= 2) {
    return { ok: false, message: '渐变至少需要 2 个色标' }
  }
  if (index < 0 || index >= struct.stops.length) {
    return { ok: false, message: `色标下标越界: ${index}` }
  }
  const stops = struct.stops.filter((_, at) => at !== index).map((stop) => ({ ...stop }))
  return { ok: true, struct: { ...struct, stops } }
}

/** 改一个色标的 offset / color（保持顺序；越界交给 `validateGradientValue` 报）。 */
export function updateGradientStop(
  struct: GradientStruct,
  index: number,
  patch: { offset?: number; color?: string },
): GradientStruct {
  return {
    ...struct,
    stops: struct.stops.map((stop, at) => (at === index
      ? { ...stop, offset: patch.offset ?? stop.offset, color: patch.color ?? stop.color }
      : { ...stop })),
  }
}

/** 删除整个渐变：`gradient` 结构 + 全部渐变几何（09-02 §4.3：一次提交）。 */
export function removeGradientRemovePaths(): string[] {
  return ['gradient', ...GRADIENT_GEOMETRY_PATHS]
}

/** 遮罩形状切换的 patch：写 `mask_shape` + 删除不适用几何（只删不加）。 */
export function maskShapePatch(shape: MaskShape): { value: MaskShape; remove: string[] } {
  const remove: string[] = []
  if (shape === 'full') {
    remove.push(...MASK_GEOMETRY_PATHS)
  } else if (shape === 'rect') {
    remove.push('mask_radius')
  } else {
    remove.push('mask_width', 'mask_height')
  }
  return { value: shape, remove }
}

/** 遮罩形状的显示几何（09-02 §四）：由 `mask_shape` 决定哪几条可见。 */
export function visibleMaskGeometry(shape: string): readonly string[] {
  if (shape === 'rect') {
    return ['mask_x', 'mask_y', 'mask_width', 'mask_height']
  }
  if (shape === 'circle') {
    return ['mask_x', 'mask_y', 'mask_radius']
  }
  return []
}

/** 遮罩形状的默认几何（用于新建时初始化？09 明确只删不加，这里仅供预览）。 */
export const MASK_GEOMETRY_DEFAULTS: Record<string, number> = {
  mask_x: 0.5,
  mask_y: 0.5,
  mask_width: 1,
  mask_height: 1,
  mask_radius: 0.5,
}

/** 渐变几何默认值（仅预览）。 */
export const GRADIENT_GEOMETRY_DEFAULTS: Record<string, number> = {
  gradient_angle: 0,
  gradient_center_x: 0.5,
  gradient_center_y: 0.5,
  gradient_radius: 0.5,
}

/** `blend_mode` 是否有「强度」字段：目录没有该字段，非 normal 也不写（09-02 §四）。 */
export const BLEND_INTENSITY_FIELD = null

/** 当前渐变结构（合法才返回）+ 显式存在标志。 */
export function gradientState(objects: JsonObject): { present: boolean; struct: GradientStruct | null } {
  const present = explicitValue(objects, 'gradient').present
  return { present, struct: present ? readGradientStruct(objects) : null }
}
