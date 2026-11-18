/**
 * 覆盖层几何（09-03 / 09-05 / 09-06 的示意图与边界检查）。
 *
 * 逐字对齐：
 * - `overlay/CanvasTransform.java`：`k = min(W播/W基, H播/H基)`；
 *   `element` = 中心 − B/2 + (anchor−0.5)·(B − B·s)，尺寸 = B·s。
 * - `overlay/ImageGeometry.java`：基准 B = 裁切后素材像素 × k，再交 `CanvasTransform.element`。
 * - `overlay/ImageLayer.java`：取材先 `clamp01`，`srcW = (clamp01(x+w) − clamp01(x)) · texW`；
 *   `srcW/srcH <= 0` 时不绘制（面板对负宽高直接拦截）。
 * - `overlay/SubtitleLayer.java`：文字块宽 = 最长行宽 × fontScale × k，高 = 行数 × lineHeight × fontScale × k。
 *
 * 编辑器不读取素材真实像素尺寸：示意图用「假定素材 1920×1080」并明确标注；
 * 数值边界检查与运行时一致。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import { explicitValue } from './layers.ts'
import { estimateSubtitleLayout, subtitleTextOf } from './subtitle.ts'

/** 运行时缺省基准分辨率（`CanvasTransform.DEFAULT_BASE_WIDTH/HEIGHT`）。 */
export const DEFAULT_BASE_WIDTH = 1920
export const DEFAULT_BASE_HEIGHT = 1080
/** 运行时缺省位置 / 锚点 / 缩放。 */
export const DEFAULT_POSITION = 0.5
export const DEFAULT_ANCHOR = 0.5
export const DEFAULT_SCALE = 1
/** 示意图假定的素材像素（编辑器不解码素材）。 */
export const SKETCH_SOURCE_WIDTH = 1920
export const SKETCH_SOURCE_HEIGHT = 1080

/** 矩形（像素，浮点；左上角 + 尺寸）。 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** `CanvasTransform.resolutionEscape`：任一 ≤ 0 → 0。 */
export function resolutionEscape(baseWidth: number, baseHeight: number, playWidth: number, playHeight: number): number {
  if (baseWidth <= 0 || baseHeight <= 0 || playWidth <= 0 || playHeight <= 0) {
    return 0
  }
  return Math.min(playWidth / baseWidth, playHeight / baseHeight)
}

/** `CanvasTransform.element`（逐字同构）。 */
export function elementRect(input: {
  x: number
  y: number
  anchorX: number
  anchorY: number
  baseWidth: number
  baseHeight: number
  scaleX: number
  scaleY: number
  playWidth: number
  playHeight: number
}): Rect {
  if (input.baseWidth <= 0 || input.baseHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const boxWidth = input.baseWidth * input.scaleX
  const boxHeight = input.baseHeight * input.scaleY
  const centerX = input.x * input.playWidth
  const centerY = input.y * input.playHeight
  const left = centerX - boxWidth / 2 + (input.anchorX - 0.5) * (input.baseWidth - boxWidth)
  const top = centerY - boxHeight / 2 + (input.anchorY - 0.5) * (input.baseHeight - boxHeight)
  return { x: left, y: top, width: boxWidth, height: boxHeight }
}

/** `ImageGeometry.compute`（逐字同构）。 */
export function imageRect(input: {
  x: number
  y: number
  anchorX: number
  anchorY: number
  srcW: number
  srcH: number
  scaleX: number
  scaleY: number
  baseWidth: number
  baseHeight: number
  screenWidth: number
  screenHeight: number
}): Rect {
  const k = resolutionEscape(input.baseWidth, input.baseHeight, input.screenWidth, input.screenHeight)
  if (k <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  return elementRect({
    x: input.x,
    y: input.y,
    anchorX: input.anchorX,
    anchorY: input.anchorY,
    baseWidth: input.srcW * k,
    baseHeight: input.srcH * k,
    scaleX: input.scaleX,
    scaleY: input.scaleY,
    playWidth: input.screenWidth,
    playHeight: input.screenHeight,
  })
}

/** `clamp01`（运行时取材用）。 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

/** 取材四边（素材归一化）。 */
export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

/** 读 image / subtitle / fade 的通用几何字段（缺失 = 运行时缺省）。 */
export interface OverlayGeometryFields {
  x: number
  y: number
  anchorX: number
  anchorY: number
  scaleX: number
  scaleY: number
  opacity: number
  fontScale: number
  crop: CropBox
  zIndex: number
}

/** 读一个浮点字段的显式 `value`（缺失 / 非数 → 缺省）。 */
function numberValue(objects: JsonObject, path: string, fallback: number): number {
  const explicit = explicitValue(objects, path)
  if (!explicit.present || typeof explicit.value !== 'number' || !Number.isFinite(explicit.value)) {
    return fallback
  }
  return explicit.value
}

/** 读整数（`z_index`）。 */
function intValue(objects: JsonObject, path: string, fallback: number): number {
  const explicit = explicitValue(objects, path)
  if (!explicit.present || typeof explicit.value !== 'number' || !Number.isInteger(explicit.value)) {
    return fallback
  }
  return explicit.value
}

/** 读 OVERLAY 的通用几何（value-only 缺省来自 schema / 运行时）。 */
export function readOverlayGeometry(objects: JsonObject): OverlayGeometryFields {
  return {
    x: numberValue(objects, 'x', DEFAULT_POSITION),
    y: numberValue(objects, 'y', DEFAULT_POSITION),
    anchorX: numberValue(objects, 'anchor_x', DEFAULT_ANCHOR),
    anchorY: numberValue(objects, 'anchor_y', DEFAULT_ANCHOR),
    scaleX: numberValue(objects, 'scale_x', DEFAULT_SCALE),
    scaleY: numberValue(objects, 'scale_y', DEFAULT_SCALE),
    opacity: numberValue(objects, 'opacity', 1),
    fontScale: numberValue(objects, 'font_scale', 1),
    crop: {
      x: numberValue(objects, 'source.x', 0),
      y: numberValue(objects, 'source.y', 0),
      w: numberValue(objects, 'source.w', 1),
      h: numberValue(objects, 'source.h', 1),
    },
    zIndex: intValue(objects, 'z_index', 10),
  }
}

/** 取材检查结果。 */
export interface CropCheck {
  /** 运行时是否绘制（`srcW/srcH <= 0` 时不绘制）。 */
  draws: boolean
  /** 钳制后的归一化四边。 */
  clamped: CropBox
  /** 是否越界（钳制后仍可绘制，只是裁掉越界部分）。 */
  outOfBounds: boolean
  issues: string[]
}

/** 取材检查（09-03 §4.3：越界钳制、负宽高拦截）。 */
export function checkCrop(crop: CropBox): CropCheck {
  const issues: string[] = []
  for (const [name, value] of Object.entries(crop)) {
    if (!Number.isFinite(value)) {
      issues.push(`source.${name} 不是有限数`)
    }
  }
  if (crop.w <= 0 || crop.h <= 0) {
    issues.push('source.w / source.h 必须 > 0（负宽高运行时不绘制）')
  }
  const x0 = clamp01(crop.x)
  const y0 = clamp01(crop.y)
  const x1 = clamp01(crop.x + crop.w)
  const y1 = clamp01(crop.y + crop.h)
  const clamped = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  const outOfBounds = crop.x < 0 || crop.y < 0 || crop.x + crop.w > 1 || crop.y + crop.h > 1
  if (outOfBounds) {
    issues.push('取材越界：越界部分被钳制到素材内（不拦截，运行时按钳制后区域绘制）')
  }
  const draws = clamped.w > 0 && clamped.h > 0 && crop.w > 0 && crop.h > 0
  if (!draws) {
    issues.push('取材区域为空：运行时不绘制')
  }
  return { draws, clamped, outOfBounds, issues }
}

/** 图片层示意图（归一化到 0..1 的屏幕坐标；按 16:9 素材假定）。 */
export interface SketchRect {
  x: number
  y: number
  width: number
  height: number
}

/** 屏幕像素矩形 → 0..1 归一化（用于 SVG）。 */
export function normalizeRect(rect: Rect, width: number, height: number): SketchRect {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  return {
    x: rect.x / width,
    y: rect.y / height,
    width: rect.width / width,
    height: rect.height / height,
  }
}

/** 图片层示意图：元素框 + 取材框（归一化）。 */
export function imageSketch(
  objects: JsonObject,
  screenWidth: number,
  screenHeight: number,
  baseWidth = DEFAULT_BASE_WIDTH,
  baseHeight = DEFAULT_BASE_HEIGHT,
): {
  element: SketchRect
  crop: SketchRect
  cropIssues: string[]
} {
  const geometry = readOverlayGeometry(objects)
  const check = checkCrop(geometry.crop)
  const rect = imageRect({
    x: geometry.x,
    y: geometry.y,
    anchorX: geometry.anchorX,
    anchorY: geometry.anchorY,
    srcW: check.clamped.w * SKETCH_SOURCE_WIDTH,
    srcH: check.clamped.h * SKETCH_SOURCE_HEIGHT,
    scaleX: geometry.scaleX,
    scaleY: geometry.scaleY,
    baseWidth,
    baseHeight,
    screenWidth,
    screenHeight,
  })
  return {
    element: normalizeRect(rect, screenWidth, screenHeight),
    crop: {
      x: check.clamped.x,
      y: check.clamped.y,
      width: check.clamped.w,
      height: check.clamped.h,
    },
    cropIssues: check.issues,
  }
}

/** 字幕层示意图：文字块矩形。 */
export function subtitleSketch(
  objects: JsonObject,
  screenWidth: number,
  screenHeight: number,
  baseWidth = DEFAULT_BASE_WIDTH,
  baseHeight = DEFAULT_BASE_HEIGHT,
): { element: SketchRect; width: number; height: number; hints: string[] } {
  const geometry = readOverlayGeometry(objects)
  const text = subtitleTextOf(objects)
  const layout = estimateSubtitleLayout({
    text,
    fontScale: geometry.fontScale,
    scaleX: geometry.scaleX,
    scaleY: geometry.scaleY,
    screenWidth,
    screenHeight,
  })
  const k = resolutionEscape(baseWidth, baseHeight, screenWidth, screenHeight)
  if (k <= 0) {
    return { element: { x: 0, y: 0, width: 0, height: 0 }, width: 0, height: 0, hints: ['分辨率转义退化：本帧不绘制'] }
  }
  const rect = elementRect({
    x: geometry.x,
    y: geometry.y,
    anchorX: geometry.anchorX,
    anchorY: geometry.anchorY,
    baseWidth: layout.maxLineWidth * geometry.fontScale * k,
    baseHeight: layout.totalHeight * geometry.fontScale * k,
    scaleX: geometry.scaleX,
    scaleY: geometry.scaleY,
    playWidth: screenWidth,
    playHeight: screenHeight,
  })
  return {
    element: normalizeRect(rect, screenWidth, screenHeight),
    width: rect.width,
    height: rect.height,
    hints: layout.overflowX || layout.overflowY
      ? ['文字块超出屏幕：运行时不自动换行，会溢出裁切']
      : [],
  }
}

/** 颜色层示意图：遮罩 / 渐变几何（归一化）。 */
export function fadeSketch(objects: JsonObject): {
  maskShape: string
  mask: SketchRect | null
  gradientType: 'linear' | 'radial' | null
  gradientAngle: number
  gradientCenter: { x: number; y: number } | null
  gradientRadius: number | null
  issues: string[]
} {
  const issues: string[] = []
  const maskShape = typeof explicitValue(objects, 'mask_shape').value === 'string'
    ? explicitValue(objects, 'mask_shape').value as string
    : 'full'
  let mask: SketchRect | null = null
  if (maskShape === 'rect') {
    const cx = numberValue(objects, 'mask_x', DEFAULT_POSITION)
    const cy = numberValue(objects, 'mask_y', DEFAULT_POSITION)
    const w = numberValue(objects, 'mask_width', 1)
    const h = numberValue(objects, 'mask_height', 1)
    mask = { x: cx - w / 2, y: cy - h / 2, width: w, height: h }
    if (w <= 0 || h <= 0) {
      issues.push('矩形遮罩宽高 ≤ 0：该区域不绘制')
    }
  } else if (maskShape === 'circle') {
    const cx = numberValue(objects, 'mask_x', DEFAULT_POSITION)
    const cy = numberValue(objects, 'mask_y', DEFAULT_POSITION)
    const r = numberValue(objects, 'mask_radius', 0.5)
    mask = { x: cx - r, y: cy - r, width: r * 2, height: r * 2 }
    if (r <= 0) {
      issues.push('圆形遮罩半径 ≤ 0：该区域不绘制')
    }
  } else if (maskShape !== 'full') {
    issues.push(`mask_shape="${maskShape}" 非法：运行时会抛错/不按预期绘制`)
  }

  const gradientExplicit = explicitValue(objects, 'gradient')
  if (!gradientExplicit.present) {
    return {
      maskShape,
      mask,
      gradientType: null,
      gradientAngle: 0,
      gradientCenter: null,
      gradientRadius: null,
      issues,
    }
  }
  const raw = gradientExplicit.value
  const type = typeof (raw as JsonObject | undefined)?.type === 'string'
    ? (raw as JsonObject).type as string
    : ''
  if (type !== 'linear' && type !== 'radial') {
    issues.push(`gradient.type="${type}" 非法（linear / radial）`)
  }
  return {
    maskShape,
    mask,
    gradientType: type === 'radial' ? 'radial' : type === 'linear' ? 'linear' : null,
    gradientAngle: numberValue(objects, 'gradient_angle', 0),
    gradientCenter: {
      x: numberValue(objects, 'gradient_center_x', DEFAULT_POSITION),
      y: numberValue(objects, 'gradient_center_y', DEFAULT_POSITION),
    },
    gradientRadius: type === 'radial' ? numberValue(objects, 'gradient_radius', 0.5) : null,
    issues,
  }
}

/** 画幅黑边（09-06）：返回上下 / 左右黑边的归一化厚度与说明。 */
export interface LetterboxBars {
  /** 上下黑边（归一化高度，0..0.5）。 */
  top: number
  bottom: number
  /** 左右黑边（归一化宽度，0..0.5）。 */
  left: number
  right: number
  /** 方向：horizontal（上下）/ vertical（左右）/ none。 */
  orientation: 'horizontal' | 'vertical' | 'none'
  message: string
}

/** 计算黑边：宽高比 = 画幅宽 / 画幅高；<=0 或 0 = 无黑边。 */
export function letterboxBars(aspectRatio: number, screenWidth = 16, screenHeight = 9): LetterboxBars {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 || screenWidth <= 0 || screenHeight <= 0) {
    return {
      top: 0, bottom: 0, left: 0, right: 0, orientation: 'none',
      message: aspectRatio === 0 ? 'aspect_ratio=0：无黑边（等同不启用画幅）' : 'aspect_ratio 非法或 ≤ 0：运行时不绘制',
    }
  }
  const screenAspect = screenWidth / screenHeight
  if (aspectRatio >= screenAspect) {
    // 更宽：上下黑边。可视高度 = 屏幕宽 / 画幅比。
    const visibleHeight = screenWidth / aspectRatio
    const bar = Math.max(0, (screenHeight - visibleHeight) / 2 / screenHeight)
    return {
      top: bar,
      bottom: bar,
      left: 0,
      right: 0,
      orientation: bar === 0 ? 'none' : 'horizontal',
      message: bar === 0 ? '画幅与屏幕同比例：无黑边' : `上下黑边各 ${(bar * 100).toFixed(1)}%（底图不裁切，黑边盖在画面上）`,
    }
  }
  // 更窄：左右黑边。可视宽度 = 屏幕高 × 画幅比。
  const visibleWidth = screenHeight * aspectRatio
  const bar = Math.max(0, (screenWidth - visibleWidth) / 2 / screenWidth)
  return {
    top: 0,
    bottom: 0,
    left: bar,
    right: bar,
    orientation: bar === 0 ? 'none' : 'vertical',
    message: bar === 0 ? '画幅与屏幕同比例：无黑边' : `左右黑边各 ${(bar * 100).toFixed(1)}%（底图不裁切，黑边盖在画面上）`,
  }
}

/** 90° 旋转（线性渐变方向用）。 */
export function gradientAngleVector(angleDegrees: number): { x: number; y: number } {
  const radians = (angleDegrees * Math.PI) / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
}
