/**
 * Gizmo 纯模型（12-09）：只对当前选中片段的一个矩形 / 位置组工作。
 *
 * 能力边界（plan 12-09 §三 / §2.3）：
 * - 手柄只有：移动、等比缩放、非等比拉伸、锚点调整；**没有旋转手柄**；
 * - 拖动中只产出草稿值（不写文档），松手一次提交、一次撤销回退；
 * - 多选只显示包围盒，不批量改每个片段；
 * - 不新增字段：写出的命令只映射既有 `x / y / anchor_x / anchor_y / scale_x / scale_y`。
 *
 * 本模块不碰 Vue / store；命令由面板在松手时合成一个 `compound` 提交。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject } from '../../core/doc/types.ts'
import { DEFAULT_ANCHOR, DEFAULT_POSITION, DEFAULT_SCALE } from '../overlay/geometry.ts'
import type { NormalizedRect } from './cameraRect.ts'

/** Gizmo 手柄种类（封闭清单；旋转不在其中）。 */
export const GIZMO_HANDLES = ['move', 'uniformScale', 'stretchScale', 'anchor'] as const
export type GizmoHandle = (typeof GIZMO_HANDLES)[number]

/** 旋转手柄清单（恒为空；自检据此断言「无旋转项」）。 */
export const GIZMO_ROTATION_HANDLES: readonly GizmoHandle[] = []

/** 一个覆盖层元素的可拖动几何（既有字段的内存形状）。 */
export interface GizmoGeometry {
  x: number
  y: number
  anchorX: number
  anchorY: number
  scaleX: number
  scaleY: number
}

/** 视口尺寸（像素；固定预览视口，见 `constants.ts`）。 */
export interface GizmoViewport {
  width: number
  height: number
}

/** 拖动输入。 */
export interface GizmoDragInput {
  handle: GizmoHandle
  geometry: GizmoGeometry
  viewport: GizmoViewport
  /** 像素增量（move / 缩放手柄）。 */
  deltaX: number
  deltaY: number
}

/** 拖动草稿：`valid = false` 时松手不提交，几何保持原值。 */
export interface GizmoDraft {
  geometry: GizmoGeometry
  valid: boolean
  issues: string[]
  warnings: string[]
  /** 相对原值发生变化的字段（路径用 camelCase，命令映射在 `gizmoCommands`）。 */
  changed: Partial<Record<keyof GizmoGeometry, number>>
}

const FIELD_PATHS: Record<keyof GizmoGeometry, string> = {
  x: 'x',
  y: 'y',
  anchorX: 'anchor_x',
  anchorY: 'anchor_y',
  scaleX: 'scale_x',
  scaleY: 'scale_y',
}

function finiteOr(value: number, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
}

/** 从片段 `objects` 读 Gizmo 几何（缺失 = 目录 / 运行时缺省）。 */
export function readGizmoGeometry(objects: JsonObject): GizmoGeometry {
  const read = (path: string, fallback: number): number => {
    const raw = objects[path]
    if (!isJsonObject(raw)) {
      return fallback
    }
    return isFiniteNumber(raw.value) ? (raw.value as number) : fallback
  }
  return {
    x: read('x', DEFAULT_POSITION),
    y: read('y', DEFAULT_POSITION),
    anchorX: read('anchor_x', DEFAULT_ANCHOR),
    anchorY: read('anchor_y', DEFAULT_ANCHOR),
    scaleX: read('scale_x', DEFAULT_SCALE),
    scaleY: read('scale_y', DEFAULT_SCALE),
  }
}

/**
 * 计算一次拖动的草稿值（纯算术，不写文档）。
 *
 * - `move`：像素增量换算成窗口归一化增量，平移中心；
 * - `uniformScale`：横向拖动量作为统一因子，两轴同乘；
 * - `stretchScale`：两轴各自乘因子；
 * - `anchor`：锚点在元素自身归一化域内移动。
 * 结果缩放 ≤ 0 → 草稿无效（`valid=false`），保留原值。
 */
export function planGizmoDrag(input: GizmoDragInput): GizmoDraft {
  const { geometry, viewport, handle } = input
  const issues: string[] = []
  const warnings: string[] = []
  const next: GizmoGeometry = { ...geometry }
  const changed: Partial<Record<keyof GizmoGeometry, number>> = {}

  if (viewport.width <= 0 || viewport.height <= 0) {
    return { geometry, valid: false, issues: ['视口尺寸非法：无法换算拖动增量'], warnings, changed }
  }

  if (handle === 'move') {
    next.x = geometry.x + input.deltaX / viewport.width
    next.y = geometry.y + input.deltaY / viewport.height
    changed.x = next.x
    changed.y = next.y
  } else if (handle === 'uniformScale') {
    const factor = 1 + input.deltaX / viewport.width
    next.scaleX = geometry.scaleX * factor
    next.scaleY = geometry.scaleY * factor
    changed.scaleX = next.scaleX
    changed.scaleY = next.scaleY
  } else if (handle === 'stretchScale') {
    const factorX = 1 + input.deltaX / viewport.width
    const factorY = 1 + input.deltaY / viewport.height
    next.scaleX = geometry.scaleX * factorX
    next.scaleY = geometry.scaleY * factorY
    changed.scaleX = next.scaleX
    changed.scaleY = next.scaleY
  } else {
    // anchor：增量按归一化传入（面板把手柄坐标换算好）。
    next.anchorX = geometry.anchorX + input.deltaX
    next.anchorY = geometry.anchorY + input.deltaY
    changed.anchorX = next.anchorX
    changed.anchorY = next.anchorY
  }

  if (!isFiniteNumber(next.scaleX) || next.scaleX <= 0) {
    issues.push('scale_x 为零或负：运行时不绘制 / 可能翻转；本次拖动不提交，保留原值')
  }
  if (!isFiniteNumber(next.scaleY) || next.scaleY <= 0) {
    issues.push('scale_y 为零或负：运行时不绘制 / 可能翻转；本次拖动不提交，保留原值')
  }
  if (next.scaleX !== next.scaleY) {
    warnings.push('横向与纵向缩放倍数不一致：元素会被非等比拉伸')
  }
  if (next.anchorX < 0 || next.anchorX > 1 || next.anchorY < 0 || next.anchorY > 1) {
    warnings.push('锚点超出 0–1：缩放不动点落在元素外；运行时按公式计算，编辑器不钳制')
  }
  if (next.x < 0 || next.y < 0 || next.x > 1 || next.y > 1) {
    warnings.push('位置超出窗口归一化范围：允许写入，越界部分运行时被裁掉')
  }

  const valid = issues.length === 0
  return {
    geometry: valid ? next : geometry,
    valid,
    issues,
    warnings,
    changed: valid ? changed : {},
  }
}

/**
 * 把草稿变化映射成既有字段命令（一次提交一个 `compound`，撤销一次回退）。
 *
 * 只出现在 `changed` 里的字段才写；未变化的字段不产生命令。
 */
export function gizmoCommands(clipKey: string, before: GizmoGeometry, after: GizmoGeometry): DocCommand[] {
  const commands: DocCommand[] = []
  const entries = Object.entries(after) as Array<[keyof GizmoGeometry, number]>
  for (const [field, value] of entries) {
    if (before[field] === value) {
      continue
    }
    commands.push({
      kind: 'object.setValue',
      clipKey,
      path: FIELD_PATHS[field],
      value,
    })
  }
  return commands
}

/**
 * 多选包围盒（只显示，不产生批量命令）。
 *
 * 输入为各元素在窗口归一化下的矩形；空数组返回 `null`。
 */
export function boundingBox(rects: readonly NormalizedRect[]): NormalizedRect | null {
  const valid = rects.filter((rect) =>
    isFiniteNumber(rect.x) && isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.w) && isFiniteNumber(rect.h) &&
    rect.w > 0 && rect.h > 0,
  )
  if (valid.length === 0) {
    return null
  }
  const x0 = Math.min(...valid.map((rect) => rect.x))
  const y0 = Math.min(...valid.map((rect) => rect.y))
  const x1 = Math.max(...valid.map((rect) => rect.x + rect.w))
  const y1 = Math.max(...valid.map((rect) => rect.y + rect.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
