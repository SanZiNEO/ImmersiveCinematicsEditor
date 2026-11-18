/**
 * 覆盖层 / 画幅层字段值校验（09 各字段面的本地拦截）。
 *
 * 与 Java 运行时的关系：
 * - 运行时对非法 `color` 只 WARN 并回落黑色；编辑器在写入前拦截，不制造「写进去也无效」的字段。
 * - 运行时对 `mask_shape=full` 不读几何、线性渐变不读半径、径向渐变不读角度；这些是**提示**不是错误。
 * - LETTERBOX 目录只有 `aspect_ratio` / `opacity`；多出来的已知键保留（06 的未知组只读），但运行时不读取。
 *
 * 本模块只返回问题清单；不写文档、不改值。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { explicitValue, effectiveLayerType, isKnownOverlayPath, isOverlayFieldApplicable, isOverlayLayerType } from './layers.ts'
import type { OverlayLayerType } from './layers.ts'
import { normalizeHexColor, validateGradientValue } from './colorMask.ts'
import { gradientState } from './colorMask.ts'
import { isValidMediaPath, mediaKindOfPath } from './media.ts'
import { findLetterboxExtraPaths } from './letterbox.ts'

/** 问题级别：error 拦截写入 / warning 只提示。 */
export type FieldIssueLevel = 'error' | 'warning'

/** 一条字段问题。 */
export interface FieldIssue {
  level: FieldIssueLevel
  path: string
  message: string
}

/** 读数字（显式存在且为 number）。 */
function numberOf(objects: JsonObject, path: string): number | null {
  const explicit = explicitValue(objects, path)
  return explicit.present && typeof explicit.value === 'number' && Number.isFinite(explicit.value)
    ? explicit.value
    : null
}

/** 读字符串。 */
function stringOf(objects: JsonObject, path: string): string | null {
  const explicit = explicitValue(objects, path)
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : null
}

/** 通用类型检查（按目录 def；不检查 appliesTo）。 */
function checkScalar(
  objects: JsonObject,
  path: string,
  expected: 'float' | 'int' | 'string' | 'enum',
  enumValues: readonly string[] | undefined,
  issues: FieldIssue[],
): void {
  const explicit = explicitValue(objects, path)
  if (!explicit.present) {
    return
  }
  const value = explicit.value
  if (expected === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ level: 'error', path, message: `${path} 需要有限数字，实际: ${JSON.stringify(value)}` })
    }
    return
  }
  if (expected === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      issues.push({ level: 'error', path, message: `${path} 需要整数，实际: ${JSON.stringify(value)}` })
    }
    return
  }
  if (expected === 'string') {
    if (typeof value !== 'string') {
      issues.push({ level: 'error', path, message: `${path} 需要字符串，实际: ${JSON.stringify(value)}` })
    }
    return
  }
  if (typeof value !== 'string') {
    issues.push({ level: 'error', path, message: `${path} 需要字符串枚举，实际: ${JSON.stringify(value)}` })
    return
  }
  if (enumValues !== undefined && !enumValues.includes(value)) {
    issues.push({
      level: 'error',
      path,
      message: `${path}="${value}" 非法（可选: ${enumValues.join(' / ')}）`,
    })
  }
}

/** 校验 OVERLAY 片段对象（按有效层类型）。 */
export function validateOverlayObjects(objects: JsonObject): FieldIssue[] {
  const issues: FieldIssue[] = []
  const layerType: OverlayLayerType = effectiveLayerType(objects)

  // layer_type 缺失合法（缺省 fade）；显式非法必须拦截（运行时 createObjectLayer 返回 null）。
  const declared = explicitValue(objects, 'layer_type')
  if (declared.present && !isOverlayLayerType(declared.value)) {
    issues.push({
      level: 'error',
      path: 'layer_type',
      message: `layer_type=${JSON.stringify(declared.value)} 非法：运行时不会建层，必须先改为 fade / image / subtitle`,
    })
  }

  // 死字段（属于其他层类型）提示；保留不删，由层类型切换负责清理。
  for (const path of Object.keys(objects)) {
    if (path === 'layer_type' || !isKnownOverlayPath(path)) {
      continue
    }
    if (!isOverlayFieldApplicable(layerType, path)) {
      issues.push({
        level: 'warning',
        path,
        message: `${path} 不作用于 ${layerType} 层（运行时不读取）；字段保留，切换层类型时可清理`,
      })
    }
  }

  // color
  const color = explicitValue(objects, 'color')
  if (color.present) {
    if (typeof color.value !== 'string') {
      issues.push({ level: 'error', path: 'color', message: 'color 需要字符串（#RRGGBB）' })
    } else if (normalizeHexColor(color.value) === null) {
      issues.push({ level: 'error', path: 'color', message: `颜色格式非法: "${color.value}"（需要 #RRGGBB 六位十六进制，# 可省）` })
    }
  }
  for (const path of ['color.r', 'color.g', 'color.b']) {
    checkScalar(objects, path, 'float', undefined, issues)
    const channel = numberOf(objects, path)
    if (channel !== null && (channel < 0 || channel > 1)) {
      issues.push({
        level: 'warning',
        path,
        message: `${path}=${channel} 超出 0~1；运行时四舍五入并钳制到 0~255`,
      })
    }
  }

  // opacity
  checkScalar(objects, 'opacity', 'float', undefined, issues)
  const opacity = numberOf(objects, 'opacity')
  if (opacity !== null && (opacity < 0 || opacity > 1)) {
    issues.push({ level: 'error', path: 'opacity', message: `opacity=${opacity} 超出 0~1` })
  }

  // gradient
  const gradient = gradientState(objects)
  if (gradient.present) {
    const value = explicitValue(objects, 'gradient').value
    for (const issue of validateGradientValue(value)) {
      issues.push({ level: 'error', path: issue.path, message: issue.message })
    }
  }
  const gradientType = gradient.struct?.type ?? null
  if (gradient.present && gradient.struct === null) {
    issues.push({ level: 'error', path: 'gradient', message: 'gradient 结构非法，渐变几何不会被运行时读取' })
  }
  for (const path of ['gradient_angle', 'gradient_center_x', 'gradient_center_y', 'gradient_radius']) {
    checkScalar(objects, path, 'float', undefined, issues)
    const present = explicitValue(objects, path).present
    if (!present) {
      continue
    }
    if (!gradient.present) {
      issues.push({ level: 'warning', path, message: `未声明 gradient：${path} 运行时不读取` })
    } else if (gradientType === 'linear' && path === 'gradient_radius') {
      issues.push({ level: 'warning', path, message: '线性渐变不读取 gradient_radius' })
    } else if (gradientType === 'radial' && path === 'gradient_angle') {
      issues.push({ level: 'warning', path, message: '径向渐变不读取 gradient_angle' })
    }
  }
  if (gradientType === 'linear' || gradientType === 'radial') {
    const centerX = numberOf(objects, 'gradient_center_x')
    const centerY = numberOf(objects, 'gradient_center_y')
    for (const [path, value] of [['gradient_center_x', centerX], ['gradient_center_y', centerY]] as const) {
      if (value !== null && (value < 0 || value > 1)) {
        issues.push({ level: 'warning', path, message: `${path}=${value} 超出 0~1（窗口比例）` })
      }
    }
  }

  // mask_shape / blend_mode
  checkScalar(objects, 'mask_shape', 'enum', ['full', 'rect', 'circle'], issues)
  checkScalar(objects, 'blend_mode', 'enum', ['normal', 'multiply', 'screen', 'soft_light', 'overlay'], issues)
  const maskShapeValue = stringOf(objects, 'mask_shape') ?? 'full'
  for (const path of ['mask_x', 'mask_y', 'mask_width', 'mask_height', 'mask_radius']) {
    checkScalar(objects, path, 'float', undefined, issues)
    if (!explicitValue(objects, path).present) {
      continue
    }
    if (maskShapeValue === 'full') {
      issues.push({ level: 'warning', path, message: 'mask_shape=full：遮罩几何不读取' })
    } else if (maskShapeValue === 'rect' && path === 'mask_radius') {
      issues.push({ level: 'warning', path, message: '矩形遮罩不读取 mask_radius' })
    } else if (maskShapeValue === 'circle' && (path === 'mask_width' || path === 'mask_height')) {
      issues.push({ level: 'warning', path, message: '圆形遮罩不读取 mask_width / mask_height' })
    } else if (maskShapeValue !== 'rect' && maskShapeValue !== 'circle') {
      issues.push({ level: 'warning', path, message: `mask_shape="${maskShapeValue}" 非法：遮罩几何不读取` })
    }
  }
  const maskWidth = numberOf(objects, 'mask_width')
  const maskHeight = numberOf(objects, 'mask_height')
  for (const [path, value] of [['mask_x', numberOf(objects, 'mask_x')], ['mask_y', numberOf(objects, 'mask_y')]] as const) {
    if (value !== null && (value < 0 || value > 1)) {
      issues.push({ level: 'warning', path, message: `${path}=${value} 超出 0~1（窗口比例）` })
    }
  }
  if (maskShapeValue === 'rect') {
    if (maskWidth !== null && maskWidth <= 0) {
      issues.push({ level: 'warning', path: 'mask_width', message: '矩形遮罩宽度 <= 0，区域为空' })
    }
    if (maskHeight !== null && maskHeight <= 0) {
      issues.push({ level: 'warning', path: 'mask_height', message: '矩形遮罩高度 <= 0，区域为空' })
    }
  }
  const maskRadius = numberOf(objects, 'mask_radius')
  if (maskShapeValue === 'circle' && maskRadius !== null && maskRadius <= 0) {
    issues.push({ level: 'warning', path: 'mask_radius', message: '圆形遮罩半径 <= 0，区域为空' })
  }

  // 几何（所有层类型都可能写；image/subtitle 使用）
  for (const path of ['x', 'y', 'anchor_x', 'anchor_y', 'scale_x', 'scale_y', 'font_scale']) {
    checkScalar(objects, path, 'float', undefined, issues)
  }
  for (const path of ['x', 'y', 'anchor_x', 'anchor_y']) {
    const value = numberOf(objects, path)
    if (value !== null && (value < 0 || value > 1)) {
      issues.push({ level: 'warning', path, message: `${path}=${value} 超出 0~1（窗口比例）` })
    }
  }
  for (const path of ['scale_x', 'scale_y']) {
    const value = numberOf(objects, path)
    if (value !== null && value <= 0) {
      issues.push({ level: 'warning', path, message: `${path}=${value} <= 0：元素框会退化，检查是否要镜像 / 隐藏` })
    }
  }
  const fontScaleValue = numberOf(objects, 'font_scale')
  if (fontScaleValue !== null && fontScaleValue <= 0) {
    issues.push({ level: 'warning', path: 'font_scale', message: `font_scale=${fontScaleValue} <= 0：字幕文字块退化` })
  }

  // image 取材
  for (const path of ['source.x', 'source.y', 'source.w', 'source.h']) {
    checkScalar(objects, path, 'float', undefined, issues)
    const value = numberOf(objects, path)
    if (value !== null && (value < 0 || value > 1)) {
      issues.push({ level: 'warning', path, message: `${path}=${value} 超出 0~1；运行时按 clamp01 处理` })
    }
  }
  for (const [path, value] of [
    ['source.w', numberOf(objects, 'source.w')],
    ['source.h', numberOf(objects, 'source.h')],
  ] as const) {
    if (value !== null && value < 0) {
      issues.push({ level: 'error', path, message: `${path}=${value} < 0：负尺寸不绘制` })
    }
  }

  // image 路径
  const path = explicitValue(objects, 'path')
  if (path.present) {
    if (typeof path.value !== 'string') {
      issues.push({ level: 'error', path: 'path', message: 'path 需要字符串' })
    } else if (path.value !== '' && !isValidMediaPath(path.value)) {
      issues.push({
        level: 'error',
        path: 'path',
        message: `素材路径扩展名不在白名单: "${path.value}"（图片 png/gif，视频 mp4/webm/mkv；jpg/jpeg 不合法）`,
      })
    } else if (path.value !== '' && mediaKindOfPath(path.value) === null) {
      issues.push({ level: 'error', path: 'path', message: `无法识别素材类型: "${path.value}"` })
    }
  }

  // subtitle text
  const text = explicitValue(objects, 'text')
  if (text.present && typeof text.value !== 'string') {
    issues.push({ level: 'error', path: 'text', message: 'text 需要字符串' })
  }

  // z_index
  checkScalar(objects, 'z_index', 'int', undefined, issues)
  const z = numberOf(objects, 'z_index')
  if (z !== null && Number.isInteger(z) && z < 0) {
    issues.push({ level: 'warning', path: 'z_index', message: `z_index=${z} < 0：绘制在画幅黑边之下` })
  }
  if (z !== null && Number.isInteger(z) && z === 0) {
    issues.push({ level: 'warning', path: 'z_index', message: 'z_index=0：与画幅层同层（画幅层先入队，通常在其上）' })
  }

  return issues
}

/** LETTERBOX 校验：只允许 aspect_ratio / opacity；多余已知键提示但保留。 */
export function validateLetterboxObjects(objects: JsonObject): FieldIssue[] {
  const issues: FieldIssue[] = []
  const aspect = explicitValue(objects, 'aspect_ratio')
  if (aspect.present) {
    if (typeof aspect.value !== 'number' || !Number.isFinite(aspect.value)) {
      issues.push({ level: 'error', path: 'aspect_ratio', message: 'aspect_ratio 需要有限数字' })
    } else if (aspect.value < 0) {
      issues.push({ level: 'error', path: 'aspect_ratio', message: `aspect_ratio=${aspect.value} < 0：不绘制黑边` })
    } else if (aspect.value === 0) {
      issues.push({ level: 'warning', path: 'aspect_ratio', message: 'aspect_ratio=0：不绘制黑边（空档复位值）' })
    }
  }
  const opacity = explicitValue(objects, 'opacity')
  if (opacity.present) {
    if (typeof opacity.value !== 'number' || !Number.isFinite(opacity.value)) {
      issues.push({ level: 'error', path: 'opacity', message: 'opacity 需要有限数字' })
    } else if (opacity.value < 0 || opacity.value > 1) {
      issues.push({ level: 'error', path: 'opacity', message: `opacity=${opacity.value} 超出 0~1` })
    }
  }
  for (const path of findLetterboxExtraPaths(objects)) {
    issues.push({
      level: 'warning',
      path,
      message: `${path} 不属于 LETTERBOX 字段面（运行时不读取）；保留为未知扩展键`,
    })
  }
  return issues
}

/** 是否存在拦截级问题。 */
export function hasBlockingIssue(issues: readonly FieldIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error')
}

/** 诊断横幅：死字段 / 非法层类型。 */
export interface OverlayBanner {
  level: 'info' | 'warning' | 'error'
  text: string
  paths: string[]
}

/** 生成 OVERLAY 片段顶部的横幅（无问题返回 `[]`）。 */
export function overlayBanners(objects: JsonObject): OverlayBanner[] {
  const banners: OverlayBanner[] = []
  const declared = explicitValue(objects, 'layer_type')
  if (declared.present && !isOverlayLayerType(declared.value)) {
    banners.push({
      level: 'error',
      text: `layer_type=${JSON.stringify(declared.value)} 非法：运行时不建层；选择层类型可写入合法值`,
      paths: [],
    })
  }
  const layerType = effectiveLayerType(objects)
  const dead = Object.keys(objects)
    .filter((path) => path !== 'layer_type' && isKnownOverlayPath(path) && !isOverlayFieldApplicable(layerType, path))
    .sort()
  if (dead.length > 0) {
    banners.push({
      level: 'warning',
      text: `当前 ${layerType} 层不读取这些已声明字段：${dead.join('、')}。字段保留（不静默删除）；切换层类型时可一并清理`,
      paths: dead,
    })
  }
  return banners
}

/** `JsonValue` 的类型名（诊断文案）。 */
export function jsonTypeName(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
