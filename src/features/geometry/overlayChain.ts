/**
 * 覆盖层几何链路（12-09）：裁切后像素 → 基准尺寸 → 最终显示 → 占窗比例 / 超窗 / 拉伸。
 *
 * 公式逐字对齐模组（只读核对 `overlay/CanvasTransform.java`、`overlay/ImageGeometry.java`）：
 * - 统一系数 `k = min(播放宽/基准宽, 播放高/基准高)`（contain 式，基准构图完整落进窗口）；
 * - 裁切后素材像素 = 原始像素 × 裁切宽 / 高比；
 * - 基准尺寸 = 裁切后像素 × k；
 * - 最终显示尺寸 = 基准尺寸 × 作者缩放倍数；
 * - 位置 = 元素中心（窗口归一化）；锚点 = 缩放不动点（元素自身归一化）。
 *
 * 与相机侧严格分离：本模块不接收、不输出相机归一化矩形；相机链路见 `cameraRect.ts`。
 * 素材原始像素未知时不假设 16:9 / 1920×1080，只给比例示意并如实提示。
 */
import {
  DEFAULT_ANCHOR,
  DEFAULT_POSITION,
  DEFAULT_SCALE,
  clamp01,
  elementRect,
  resolutionEscape,
} from '../overlay/geometry.ts'
import { isFiniteNumber } from '../../core/doc/json.ts'

/** 0–1 归一化裁切矩形（素材自身坐标系）。 */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 像素尺寸对；素材尺寸未知时为 `null`。 */
export interface PixelPair {
  width: number | null
  height: number | null
}

/** 覆盖层链路输入。 */
export interface OverlayChainInput {
  playW: number
  playH: number
  baseW: number
  baseH: number
  /** 素材原始像素宽；未知传 `null`（不猜比例）。 */
  sourceWidth: number | null
  /** 素材原始像素高；未知传 `null`。 */
  sourceHeight: number | null
  crop: CropRect
  scaleX: number
  scaleY: number
  x: number
  y: number
  anchorX: number
  anchorY: number
}

/** 覆盖层链路结果。 */
export interface OverlayChainResult {
  /** 统一缩放系数 k；任一窗口 / 基准尺寸 ≤ 0 时为 0。 */
  factor: number
  /** 素材原始像素是否已知（未知时像素链路全部为 `null`）。 */
  sourceKnown: boolean
  /** 裁切后素材像素（原始像素 × 裁切宽高比）。 */
  cropped: PixelPair
  /** 基准尺寸（裁切后像素 × k，scale=1 时的上屏像素）。 */
  baseSize: PixelPair
  /** 最终显示尺寸（基准尺寸 × 作者缩放倍数）。 */
  finalSize: PixelPair
  /** 最终显示尺寸占播放窗口的比例。 */
  windowFraction: PixelPair
  /** 元素框是否超出窗口；素材未知时为 `null`（无法判断）。 */
  outOfWindow: boolean | null
  /** 作者缩放是否非等比（scaleX ≠ scaleY）。 */
  nonUniformScale: boolean
  /** 是否因非等比缩放被拉伸（与 `nonUniformScale` 同判据，供面板直接取用）。 */
  stretched: boolean
  /** 阻塞性问题（裁切宽高 ≤ 0 等；运行时不会正常绘制）。 */
  issues: string[]
  /** 非阻塞提示（缩放 ≤0、非等比、素材未知、超窗等）。 */
  warnings: string[]
  center: { x: number; y: number }
  anchor: { x: number; y: number }
  /** 坐标系标记（面板区分两套公式用）。 */
  space: 'overlay'
}

/**
 * 统一缩放系数：`min(播放宽/基准宽, 播放高/基准高)`。
 *
 * 任一入参 ≤ 0 → 返回 0（退化不绘制，与 `CanvasTransform.resolutionEscape` 一致）。
 */
export function overlayScaleFactor(input: {
  playW: number
  playH: number
  baseW: number
  baseH: number
}): number {
  return resolutionEscape(input.baseW, input.baseH, input.playW, input.playH)
}

function finiteOr(value: number, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
}

/**
 * 解算覆盖层几何链路。
 *
 * 校验口径（plan 12-09 §4.2）：
 * - 裁切宽 / 高 ≤ 0 → 阻塞拒绝（运行时也不绘制）；
 * - 缩放倍数 0 / 负 → 提示「运行时不绘制 / 可能翻转」，不自动改值；
 * - 非等比缩放 → 提示拉伸，不自动修正；
 * - 素材未知 → 像素链路留空，只做比例示意并如实提示。
 */
export function overlayChain(input: OverlayChainInput): OverlayChainResult {
  const issues: string[] = []
  const warnings: string[] = []

  const cropW = finiteOr(input.crop.w, 0)
  const cropH = finiteOr(input.crop.h, 0)
  if (!isFiniteNumber(input.crop.w) || !isFiniteNumber(input.crop.h) || cropW <= 0 || cropH <= 0) {
    issues.push('裁切宽 / 高必须 > 0（零或负宽高运行时不绘制）')
  }

  const scaleX = finiteOr(input.scaleX, DEFAULT_SCALE)
  const scaleY = finiteOr(input.scaleY, DEFAULT_SCALE)
  if (!isFiniteNumber(input.scaleX) || scaleX <= 0) {
    warnings.push('scale_x 为零或负：运行时不绘制 / 可能翻转；保留原值，不自动改写')
  }
  if (!isFiniteNumber(input.scaleY) || scaleY <= 0) {
    warnings.push('scale_y 为零或负：运行时不绘制 / 可能翻转；保留原值，不自动改写')
  }

  const nonUniformScale = scaleX !== scaleY
  if (nonUniformScale) {
    warnings.push('横向与纵向缩放倍数不一致：元素会被非等比拉伸；编辑器不自动修正')
  }

  const sourceKnown =
    isFiniteNumber(input.sourceWidth) && input.sourceWidth > 0 &&
    isFiniteNumber(input.sourceHeight) && input.sourceHeight > 0

  const factor = overlayScaleFactor({
    playW: input.playW,
    playH: input.playH,
    baseW: input.baseW,
    baseH: input.baseH,
  })

  const cropped: PixelPair = { width: null, height: null }
  const baseSize: PixelPair = { width: null, height: null }
  const finalSize: PixelPair = { width: null, height: null }
  const windowFraction: PixelPair = { width: null, height: null }
  let outOfWindow: boolean | null = null

  if (!sourceKnown) {
    warnings.push('素材原始像素未知：只做比例示意，不假设 16:9 / 1920×1080；像素尺寸链不计算')
  } else if (cropW > 0 && cropH > 0 && factor > 0) {
    cropped.width = (input.sourceWidth as number) * cropW
    cropped.height = (input.sourceHeight as number) * cropH
    baseSize.width = cropped.width * factor
    baseSize.height = cropped.height * factor
    finalSize.width = baseSize.width * scaleX
    finalSize.height = baseSize.height * scaleY
    if (input.playW > 0 && input.playH > 0) {
      windowFraction.width = finalSize.width / input.playW
      windowFraction.height = finalSize.height / input.playH
    }
    const rect = elementRect({
      x: finiteOr(input.x, DEFAULT_POSITION),
      y: finiteOr(input.y, DEFAULT_POSITION),
      anchorX: finiteOr(input.anchorX, DEFAULT_ANCHOR),
      anchorY: finiteOr(input.anchorY, DEFAULT_ANCHOR),
      baseWidth: baseSize.width,
      baseHeight: baseSize.height,
      scaleX,
      scaleY,
      playWidth: input.playW,
      playHeight: input.playH,
    })
    outOfWindow = rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > input.playW || rect.y + rect.height > input.playH
    if (outOfWindow) {
      warnings.push('元素框超出窗口：允许写入，越界部分运行时被裁掉；编辑器不钳制到窗口内')
    }
  }

  return {
    factor,
    sourceKnown,
    cropped,
    baseSize,
    finalSize,
    windowFraction,
    outOfWindow,
    nonUniformScale,
    stretched: nonUniformScale,
    issues,
    warnings,
    center: { x: finiteOr(input.x, DEFAULT_POSITION), y: finiteOr(input.y, DEFAULT_POSITION) },
    anchor: { x: finiteOr(input.anchorX, DEFAULT_ANCHOR), y: finiteOr(input.anchorY, DEFAULT_ANCHOR) },
    space: 'overlay',
  }
}

/** 裁切矩形归一化钳制（示意用；运行时取材同样 `clamp01`）。 */
export function clampCrop(crop: CropRect): CropRect {
  return {
    x: clamp01(crop.x),
    y: clamp01(crop.y),
    w: clamp01(crop.w),
    h: clamp01(crop.h),
  }
}
