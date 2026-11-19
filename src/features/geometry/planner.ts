/**
 * 覆盖层区域规划（12-09）：输入目标屏幕矩形 → 建议中心位置 / 缩放倍数 / 锚点。
 *
 * 口径（plan 12-09 §三 / §4.2）：
 * - 目标宽高比与素材裁切后比例不一致 → 提示需要裁切或接受拉伸，不静默改裁切；
 * - 目标矩形超出窗口 → 允许写入但提示可能被裁掉，不钳制；
 * - 不新增 fit / cover / 像素矩形 / 屏幕矩形字段；建议值只映射到既有
 *   `x / y / anchor_x / anchor_y / scale_x / scale_y`。
 */
import { DEFAULT_ANCHOR, DEFAULT_POSITION, DEFAULT_SCALE } from '../overlay/geometry.ts'
import { isFiniteNumber } from '../../core/doc/json.ts'

/** 目标屏幕矩形（窗口归一化，左上角 + 尺寸）。 */
export interface TargetRect {
  x: number
  y: number
  width: number
  height: number
}

/** 区域规划输入。 */
export interface RegionPlanInput {
  target: TargetRect
  /** 裁切后素材比例（宽 / 高）；未知传 `null`（不猜 16:9）。 */
  sourceAspect: number | null
  /** 裁切后素材像素宽 / 高；未知传 `null`（无法建议绝对缩放倍数）。 */
  croppedPixels: { width: number | null; height: number | null }
  /** 统一缩放系数 k（来自覆盖层链路）；未知传 `null`。 */
  factor: number | null
  /** 播放窗口宽 / 高（像素）。 */
  playW: number
  playH: number
  anchorX: number
  anchorY: number
}

/** 区域规划结果。 */
export interface RegionPlanResult {
  /** 建议中心（元素中心，窗口归一化）。 */
  center: { x: number; y: number }
  /** 建议缩放倍数（素材像素 / 系数未知时为 `null`）。 */
  suggestedScaleX: number | null
  suggestedScaleY: number | null
  anchorX: number
  anchorY: number
  targetAspect: number | null
  /** 目标与素材裁切后比例是否不一致。 */
  aspectMismatch: boolean
  /** 目标矩形是否超出窗口归一化范围。 */
  outOfWindow: boolean
  issues: string[]
  warnings: string[]
  space: 'overlay'
}

function aspectOf(width: number, height: number): number | null {
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    return null
  }
  return width / height
}

/**
 * 计算区域规划建议。
 *
 * 建议值是给作者的起点，不是自动写入；面板确认后才走文档命令（一次事务）。
 */
export function regionPlan(input: RegionPlanInput): RegionPlanResult {
  const issues: string[] = []
  const warnings: string[] = []
  const { target } = input

  if (!isFiniteNumber(target.width) || !isFiniteNumber(target.height) || target.width <= 0 || target.height <= 0) {
    issues.push('目标矩形宽 / 高必须 > 0')
  }

  const center = {
    x: isFiniteNumber(target.x) ? target.x + target.width / 2 : DEFAULT_POSITION,
    y: isFiniteNumber(target.y) ? target.y + target.height / 2 : DEFAULT_POSITION,
  }

  const outOfWindow = target.x < 0 || target.y < 0 ||
    target.x + target.width > 1 || target.y + target.height > 1
  if (outOfWindow) {
    warnings.push('目标矩形超出窗口：允许写入，越界部分运行时被裁掉；编辑器不钳制到窗口内')
  }

  const targetAspect = aspectOf(target.width, target.height)
  let aspectMismatch = false
  if (targetAspect !== null && input.sourceAspect !== null) {
    const ratio = targetAspect / input.sourceAspect
    if (Math.abs(ratio - 1) > 1e-6) {
      aspectMismatch = true
      warnings.push('目标区域与素材裁切后比例不一致：需要裁切素材或接受拉伸；编辑器不静默改源裁切')
    }
  }

  let suggestedScaleX: number | null = null
  let suggestedScaleY: number | null = null
  const { croppedPixels, factor, playW, playH } = input
  if (
    croppedPixels.width !== null && croppedPixels.height !== null &&
    factor !== null && factor > 0 && playW > 0 && playH > 0 &&
    croppedPixels.width > 0 && croppedPixels.height > 0
  ) {
    // 最终宽 = 裁切后像素宽 · k · scaleX；反解达到目标窗口宽度所需倍数。
    suggestedScaleX = (target.width * playW) / (croppedPixels.width * factor)
    suggestedScaleY = (target.height * playH) / (croppedPixels.height * factor)
    if (suggestedScaleX <= 0 || suggestedScaleY <= 0) {
      warnings.push('反解出的缩放倍数 ≤ 0：目标区域退化，请检查目标矩形与素材尺寸')
      suggestedScaleX = null
      suggestedScaleY = null
    }
  } else {
    warnings.push('素材像素或系数未知：无法建议绝对缩放倍数，只给位置与锚点建议；不假设素材尺寸')
  }

  return {
    center,
    suggestedScaleX,
    suggestedScaleY,
    anchorX: isFiniteNumber(input.anchorX) ? input.anchorX : DEFAULT_ANCHOR,
    anchorY: isFiniteNumber(input.anchorY) ? input.anchorY : DEFAULT_ANCHOR,
    targetAspect,
    aspectMismatch,
    outOfWindow,
    issues,
    warnings,
    space: 'overlay',
  }
}

/** 缩放倍数校验（规划 / Gizmo 共用）：≤0 只提示不改值。 */
export function scaleIssues(scaleX: number, scaleY: number): string[] {
  const issues: string[] = []
  if (!isFiniteNumber(scaleX) || scaleX <= 0) {
    issues.push('scale_x 为零或负：运行时不绘制 / 可能翻转；保留原值，不自动改写')
  }
  if (!isFiniteNumber(scaleY) || scaleY <= 0) {
    issues.push('scale_y 为零或负：运行时不绘制 / 可能翻转；保留原值，不自动改写')
  }
  return issues
}

/** 非等比拉伸提示（scaleX ≠ scaleY）。 */
export function stretchWarning(scaleX: number, scaleY: number): string | null {
  if (!isFiniteNumber(scaleX) || !isFiniteNumber(scaleY)) {
    return null
  }
  if (scaleX !== scaleY) {
    return '横向与纵向缩放倍数不一致：元素会被非等比拉伸；编辑器不自动修正'
  }
  return null
}

/** 建议缺省倍数（无法反解时面板占位显示，不写文档）。 */
export const PLANNER_DEFAULT_SCALE = DEFAULT_SCALE
