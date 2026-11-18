/**
 * 07-10 预览画布派生几何：把 `PathPreviewModel` 折成可画的线段 / 多边形 / 点 / 切线 / s(t) 折线。
 *
 * 纯派生（不写盘、不调运行时）：
 * - 2D 投影按可选三轴对（默认 x/z，可切 x/y、y/z）；单轴条目走一维图（横轴 u、纵轴该轴值）；
 * - 自动缩放（包围盒 + 边距）、适配视图、1:1 三种视图变换；
 * - FREE/START 端点偏差虚线与警告文案；未知类型不出曲线，只出字段错误。
 */
import type { PathAxis, PathPreviewModel } from '../../core/paths/types.ts'

export type ProjectionPair = 'xz' | 'xy' | 'yz'
export type CanvasMode = '2d' | '1d'

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasSample {
  point: CanvasPoint
  tangent: CanvasPoint | null
  u: number
}

export interface CanvasBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  empty: boolean
}

export interface CanvasGeometry {
  mode: CanvasMode
  horizontalAxis: string
  verticalAxis: string
  hiddenAxis: string | null
  /** 主曲线折线（未知类型 / 无采样时为空）。 */
  curve: CanvasPoint[]
  controlPolygon: CanvasPoint[] | null
  start: CanvasPoint
  end: CanvasPoint
  geometryStart: CanvasPoint
  geometryEnd: CanvasPoint
  samples: CanvasSample[]
  /** s(t) 小图折线（u → s，均在 [0,1]）。 */
  timingCurve: CanvasPoint[]
  warnings: string[]
  unknownType: boolean
  deviations: { start: number; end: number }
  bounds: CanvasBounds
}

export interface CanvasOptions {
  pair: ProjectionPair
  space: 'world' | 'base'
  showSamples: boolean
  showTangents: boolean
}

const PAIR_AXES: Record<ProjectionPair, { horizontal: PathAxis; vertical: PathAxis; hidden: PathAxis }> = {
  xz: { horizontal: 'x', vertical: 'z', hidden: 'y' },
  xy: { horizontal: 'x', vertical: 'y', hidden: 'z' },
  yz: { horizontal: 'y', vertical: 'z', hidden: 'x' },
}

/** 轴标签：world 用 x/y/z；base 对齐 core 预览（x=fwd, y=up, z=right）。 */
export function axisLabel(axis: PathAxis, space: 'world' | 'base'): string {
  if (space === 'base') {
    return axis === 'x' ? 'fwd' : axis === 'y' ? 'up' : 'right'
  }
  return axis
}

const DEVIATION_EPSILON = 1e-6

function zeroBounds(): CanvasBounds {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, empty: true }
}

function expandBounds(bounds: CanvasBounds, point: CanvasPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return
  }
  if (bounds.empty) {
    bounds.minX = bounds.maxX = point.x
    bounds.minY = bounds.maxY = point.y
    bounds.empty = false
    return
  }
  bounds.minX = Math.min(bounds.minX, point.x)
  bounds.maxX = Math.max(bounds.maxX, point.x)
  bounds.minY = Math.min(bounds.minY, point.y)
  bounds.maxY = Math.max(bounds.maxY, point.y)
}

/** 把模型折成画布几何。`entryAxes` 为条目自身轴（决定是否一维图）。 */
export function buildCanvasGeometry(
  model: PathPreviewModel | null,
  entryAxes: readonly PathAxis[],
  options: CanvasOptions,
): CanvasGeometry {
  const empty: CanvasGeometry = {
    mode: entryAxes.length === 1 ? '1d' : '2d',
    horizontalAxis: 'u',
    verticalAxis: entryAxes.length === 1 ? axisLabel(entryAxes[0], options.space) : '—',
    hiddenAxis: null,
    curve: [],
    controlPolygon: null,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    geometryStart: { x: 0, y: 0 },
    geometryEnd: { x: 0, y: 0 },
    samples: [],
    timingCurve: [],
    warnings: ['无预览模型'],
    unknownType: false,
    deviations: { start: 0, end: 0 },
    bounds: zeroBounds(),
  }
  if (model === null) {
    return empty
  }

  const unknownType = model.issues.some((issue) => /未知曲线类型|未知/i.test(issue.message))
  const warnings: string[] = []
  for (const issue of model.issues) {
    warnings.push(issue.message)
  }
  for (const warning of model.warnings) {
    if (!warnings.includes(warning)) {
      warnings.push(warning)
    }
  }

  const oneD = entryAxes.length === 1
  const pair = PAIR_AXES[options.pair]
  const horizontalAxis = oneD ? 'u' : axisLabel(pair.horizontal, options.space)
  const verticalAxis = oneD ? axisLabel(entryAxes[0], options.space) : axisLabel(pair.vertical, options.space)
  const hiddenAxis = oneD ? null : axisLabel(pair.hidden, options.space)

  const project = (point: readonly [number, number, number], u: number): CanvasPoint => {
    if (oneD) {
      const axis = entryAxes[0]
      return { x: u, y: point[axisIndex(axis)] }
    }
    return { x: point[axisIndex(pair.horizontal)], y: point[axisIndex(pair.vertical)] }
  }

  const bounds = zeroBounds()
  const curve: CanvasPoint[] = []
  const samples: CanvasSample[] = []

  if (!unknownType && model.samples.length > 0) {
    for (const sample of model.samples) {
      const point = project(sample.point, sample.u)
      curve.push(point)
      expandBounds(bounds, point)
      if (options.showSamples) {
        let tangent: CanvasPoint | null = null
        if (options.showTangents && sample.tangent !== null) {
          tangent = project(sample.tangent, sample.u)
        }
        samples.push({ point, tangent, u: sample.u })
      }
    }
  } else if (unknownType) {
    warnings.unshift('未知曲线类型：不出曲线，仅显示字段错误')
  } else if (model.samples.length === 0) {
    warnings.push('无可用端点或几何，无法绘制曲线')
  }

  const controlPolygon = model.controlPolygon === null
    ? null
    : model.controlPolygon.map((point) => project(point, 0))
  if (controlPolygon !== null) {
    for (const point of controlPolygon) {
      expandBounds(bounds, point)
    }
  }

  const start = project(model.from, 0)
  const end = project(model.to, 1)
  const geometryStart = project(model.geometryStart, 0)
  const geometryEnd = project(model.geometryEnd, 1)
  for (const point of [start, end, geometryStart, geometryEnd]) {
    expandBounds(bounds, point)
  }

  if (model.startDeviation > DEVIATION_EPSILON) {
    warnings.push(`起点偏差 ${model.startDeviation.toFixed(3)}：from 未落在几何起点上`)
  }
  if (model.endDeviation > DEVIATION_EPSILON) {
    warnings.push(`终点偏差 ${model.endDeviation.toFixed(3)}：to 未落在几何终点上`)
  }

  const timingCurve: CanvasPoint[] = model.timingCurve.map((point) => ({ x: point.u, y: point.s }))

  return {
    mode: oneD ? '1d' : '2d',
    horizontalAxis,
    verticalAxis,
    hiddenAxis,
    curve,
    controlPolygon,
    start,
    end,
    geometryStart,
    geometryEnd,
    samples,
    timingCurve,
    warnings,
    unknownType,
    deviations: { start: model.startDeviation, end: model.endDeviation },
    bounds,
  }
}

function axisIndex(axis: PathAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

// ── 视图变换 ────────────────────────────────────────────────────────────────

export interface ViewTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/** 包围盒适配视图（含边距）；空包围盒返回居中单位变换。 */
export function fitView(bounds: CanvasBounds, width: number, height: number, margin: number): ViewTransform {
  if (bounds.empty || width <= 0 || height <= 0) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 }
  }
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-9)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-9)
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY)
  const safeScale = Number.isFinite(scale) && scale > 1e-6 ? scale : 1
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return {
    scale: safeScale,
    offsetX: width / 2 - centerX * safeScale,
    offsetY: height / 2 - centerY * safeScale,
  }
}

/** 1:1：不缩放，包围盒居中。 */
export function oneToOneView(bounds: CanvasBounds, width: number, height: number): ViewTransform {
  if (bounds.empty) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 }
  }
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return { scale: 1, offsetX: width / 2 - centerX, offsetY: height / 2 - centerY }
}

/** 世界坐标 → 画布坐标（y 轴翻转，SVG 向下为正）。 */
export function applyTransform(point: CanvasPoint, transform: ViewTransform): CanvasPoint {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  }
}

/** 折线点串 → SVG path `d`。 */
export function pointsToPath(points: CanvasPoint[], transform: ViewTransform): string {
  if (points.length === 0) {
    return ''
  }
  return points
    .map((point, index) => {
      const mapped = applyTransform(point, transform)
      return `${index === 0 ? 'M' : 'L'} ${mapped.x.toFixed(3)} ${mapped.y.toFixed(3)}`
    })
    .join(' ')
}
