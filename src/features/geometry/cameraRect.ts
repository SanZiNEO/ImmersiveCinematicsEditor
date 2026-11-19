/**
 * 相机合成矩形（12-09）：目标矩形与源裁切都是 0–1 归一化。
 *
 * 与覆盖层链路严格分离（plan 12-09 §2.1 / §4.1）：
 * - 不乘覆盖层统一缩放系数；
 * - 不读文档基准分辨率；
 * - 不输出「素材像素 × 系数」的结果；
 * - 宽高比不一致只提示拉伸，由作者决定是否改源裁切，编辑器不静默改值。
 *
 * 字段事实（02 目录 `TrackSchemas.cameraObjects`）：
 * `dest.x / dest.y / dest.w / dest.h`、`source.x / source.y / source.w / source.h`，
 * 缺省 dest = (0,0,1,1)、source = (0,0,1,1)。
 */
import { explicitValue } from '../overlay/layers.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject } from '../../core/doc/types.ts'

/** 0–1 归一化矩形（左上角 + 宽高）。 */
export interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

/** 相机矩形输入。 */
export interface CameraRectInput {
  dest: NormalizedRect
  source: NormalizedRect
}

/** 相机矩形结果（只含归一化值；刻意不携带像素 / 系数字段）。 */
export interface CameraRectResult {
  dest: NormalizedRect
  source: NormalizedRect
  destAspect: number | null
  sourceAspect: number | null
  /** 目标与源宽高比不一致 → 提示拉伸（不自动改源裁切）。 */
  stretched: boolean
  issues: string[]
  warnings: string[]
  /** 坐标系标记。 */
  space: 'camera'
  /** 显式占位：相机侧不存在像素宽 / 高（自检据此断言不与覆盖层混算）。 */
  pixelWidth: null
  pixelHeight: null
}

const RECT_DEFAULT: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 }

function aspectOf(rect: NormalizedRect): number | null {
  if (!isFiniteNumber(rect.w) || !isFiniteNumber(rect.h) || rect.w <= 0 || rect.h <= 0) {
    return null
  }
  return rect.w / rect.h
}

function validateRect(rect: NormalizedRect, label: string, issues: string[], warnings: string[]): void {
  for (const [name, value] of [['x', rect.x], ['y', rect.y], ['w', rect.w], ['h', rect.h]] as const) {
    if (!isFiniteNumber(value)) {
      issues.push(`${label}.${name} 不是有限数`)
    }
  }
  if (rect.w <= 0 || rect.h <= 0) {
    issues.push(`${label} 宽 / 高必须 > 0（空矩形运行时不绘制）`)
  }
  const outOfRange = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]
    .some((value) => value < 0 || value > 1)
  if (outOfRange) {
    warnings.push(`${label} 超出 0–1 归一化范围：运行时按钳制后区域处理；编辑器不自动改写`)
  }
}

/**
 * 解算相机合成矩形：只做归一化校验与宽高比提示。
 *
 * 不接收基准分辨率 / 播放窗口尺寸参数；结果里也没有任何像素尺寸字段。
 */
export function cameraRectToNormalized(input: CameraRectInput): CameraRectResult {
  const issues: string[] = []
  const warnings: string[] = []

  validateRect(input.dest, 'dest', issues, warnings)
  validateRect(input.source, 'source', issues, warnings)

  const destAspect = aspectOf(input.dest)
  const sourceAspect = aspectOf(input.source)
  let stretched = false
  if (destAspect !== null && sourceAspect !== null) {
    const ratio = destAspect / sourceAspect
    if (Math.abs(ratio - 1) > 1e-6) {
      stretched = true
      warnings.push('目标矩形与源裁切宽高比不一致：画面会被拉伸；是否改源裁切由作者决定，编辑器不静默修改')
    }
  }

  return {
    dest: { ...input.dest },
    source: { ...input.source },
    destAspect,
    sourceAspect,
    stretched,
    issues,
    warnings,
    space: 'camera',
    pixelWidth: null,
    pixelHeight: null,
  }
}

function readRect(objects: JsonObject, prefix: string): NormalizedRect {
  const read = (suffix: string, fallback: number): number => {
    const explicit = explicitValue(objects, `${prefix}.${suffix}`)
    return explicit.present && isFiniteNumber(explicit.value) ? (explicit.value as number) : fallback
  }
  return {
    x: read('x', RECT_DEFAULT.x),
    y: read('y', RECT_DEFAULT.y),
    w: read('w', RECT_DEFAULT.w),
    h: read('h', RECT_DEFAULT.h),
  }
}

/** 从片段 `objects` 读相机合成目标 / 源裁切（缺失 = 目录缺省）。 */
export function readCameraComposite(objects: JsonObject): CameraRectInput {
  return {
    dest: readRect(objects, 'dest'),
    source: readRect(objects, 'source'),
  }
}

/** 从任意值里读归一化矩形（面板表单 / 示意共用；非法形状返回 `null`）。 */
export function normalizedRectOf(value: unknown): NormalizedRect | null {
  if (!isJsonObject(value)) {
    return null
  }
  const x = value.x
  const y = value.y
  const w = value.w
  const h = value.h
  if (![x, y, w, h].every(isFiniteNumber)) {
    return null
  }
  return { x: x as number, y: y as number, w: w as number, h: h as number }
}
