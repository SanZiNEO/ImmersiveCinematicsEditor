/**
 * 07-10 路径预览模型：端点解析 + 11 类几何采样 + 2D 投影 + 偏差 / 警告 / 诊断。
 *
 * 只读，不写盘；采样按参数 u 均匀（不是弧长）。
 */
import type { JsonObject, ScriptDoc } from '../doc/types.ts'
import { isJsonObject } from '../doc/json.ts'
import { pathEntries, findClipById, readAxes, validatePathEntry } from './collection.ts'
import { buildGeometry, sampleGeometry } from './sampling.ts'
import type { Vec3 } from './sampling.ts'
import { timingCurveSamples } from './timing.ts'
import type { PathAxis, PathIssue, PathPreviewModel } from './types.ts'

export interface PreviewOptions {
  /** 采样点数（含首末，默认 65）。 */
  sampleCount?: number
  /** 端点覆盖轴缺失时的回退值（目录默认 / 0）。 */
  defaults?: { x: number; y: number; z: number }
  /** 预览投影轴；缺省按条目 axes。 */
  axes?: PathAxis[]
  /** 表达式空间（`base` 时轴标签换 fwd/up/right；投影仍是 x/z）。 */
  space?: 'world' | 'base'
}

/** 构建一条路径的预览。条目不存在返回 null。 */
export function buildPathPreview(
  doc: ScriptDoc,
  pathIndex: number,
  options: PreviewOptions = {},
): PathPreviewModel | null {
  const views = pathEntries(doc)
  const view = views.find((entry) => entry.index === pathIndex)
  if (view === undefined) {
    return null
  }
  const defaults = options.defaults ?? { x: 0, y: 0, z: 0 }
  const entry = view.entry
  const axes = options.axes ?? readAxes(entry.axes)
  const from = endpointVector(doc, view.clipId, view.from, defaults)
  const to = endpointVector(doc, view.clipId, view.to, defaults)
  const geometry = isJsonObject(entry.geometry) ? entry.geometry : null
  const issues = pathIssuesFor(view)
  if (geometry === null) {
    return {
      pathId: view.id,
      anchor: 'ENDPOINTS',
      anchorLabel: '端点绑定',
      from: vecTuple(from),
      to: vecTuple(to),
      geometryStart: vecTuple(from),
      geometryEnd: vecTuple(to),
      samples: [],
      controlPolygon: null,
      startDeviation: 0,
      endDeviation: 0,
      timingCurve: timingCurveSamples(entry.timing),
      warnings: ['几何缺失，无法采样'],
      issues,
    }
  }
  let evaluation
  try {
    evaluation = buildGeometry(geometry, from, to)
  } catch (error) {
    return {
      pathId: view.id,
      anchor: 'ENDPOINTS',
      anchorLabel: '端点绑定',
      from: vecTuple(from),
      to: vecTuple(to),
      geometryStart: vecTuple(from),
      geometryEnd: vecTuple(to),
      samples: [],
      controlPolygon: null,
      startDeviation: 0,
      endDeviation: 0,
      timingCurve: timingCurveSamples(entry.timing),
      warnings: [error instanceof Error ? error.message : String(error)],
      issues,
    }
  }
  const samples = sampleGeometry(evaluation, options.sampleCount ?? 65).map((sample) => ({
    u: sample.u,
    point: vecTuple(sample.point),
    tangent: sample.tangent === null ? null : vecTuple(sample.tangent),
  }))
  return {
    pathId: view.id,
    anchor: evaluation.anchor,
    anchorLabel: evaluation.anchor === 'ENDPOINTS'
      ? '端点绑定（几何起终点 = 片段端点）'
      : evaluation.anchor === 'FREE'
        ? '几何自由（端点只做绑定，形状由参数决定）'
        : '起点锚定（起点 = 片段起点，终点由几何决定）',
    from: vecTuple(from),
    to: vecTuple(to),
    geometryStart: vecTuple(evaluation.start),
    geometryEnd: vecTuple(evaluation.end),
    samples,
    controlPolygon: evaluation.controlPolygon === null
      ? null
      : evaluation.controlPolygon.map((point) => vecTuple(point)),
    startDeviation: distance(from, evaluation.start),
    endDeviation: distance(to, evaluation.end),
    timingCurve: timingCurveSamples(entry.timing),
    warnings: evaluation.warnings,
    issues,
  }
}

/** 投影到 2D：返回 [水平, 垂直] 与轴标签。 */
export function projectPreviewPoint(
  point: readonly [number, number, number],
  axes: readonly PathAxis[],
  space: 'world' | 'base' = 'world',
): { x: number; y: number; horizontalAxis: string; verticalAxis: string } {
  const set = new Set(axes)
  const labels = space === 'base' ? { x: 'fwd', y: 'up', z: 'right' } : { x: 'x', y: 'y', z: 'z' }
  if (set.has('x') && set.has('z')) {
    return { x: point[0], y: point[2], horizontalAxis: labels.x, verticalAxis: labels.z }
  }
  if (set.has('x') && set.has('y')) {
    return { x: point[0], y: point[1], horizontalAxis: labels.x, verticalAxis: labels.y }
  }
  if (set.has('y') && set.has('z')) {
    return { x: point[1], y: point[2], horizontalAxis: labels.y, verticalAxis: labels.z }
  }
  if (set.has('x')) {
    return { x: point[0], y: 0, horizontalAxis: labels.x, verticalAxis: '—' }
  }
  if (set.has('y')) {
    return { x: point[1], y: 0, horizontalAxis: labels.y, verticalAxis: '—' }
  }
  return { x: point[2], y: 0, horizontalAxis: labels.z, verticalAxis: '—' }
}

/** 把预览诊断转成 UI `PathIssue`（带 pathId / jsonPath）。 */
export function previewIssues(doc: ScriptDoc, pathIndex: number): PathIssue[] {
  const views = pathEntries(doc)
  const view = views.find((entry) => entry.index === pathIndex)
  return view === undefined ? [] : pathIssuesFor(view)
}

/** 端点分量：首帧 > 该时刻线性插值 > value > 默认值。 */
export function endpointVector(
  doc: ScriptDoc,
  clipId: string,
  time: number,
  defaults: { x: number; y: number; z: number },
): Vec3 {
  const clip = findClipById(doc, clipId)
  if (clip === undefined) {
    return defaults
  }
  const objects = clip.objects
  if (!isJsonObject(objects)) {
    return defaults
  }
  return {
    x: componentAt(objects['position.x'], time, defaults.x),
    y: componentAt(objects['position.y'], time, defaults.y),
    z: componentAt(objects['position.z'], time, defaults.z),
  }
}

function componentAt(raw: unknown, time: number, fallback: number): number {
  if (!isJsonObject(raw)) {
    return fallback
  }
  const keyframes = raw.keyframes
  if (Array.isArray(keyframes) && keyframes.length > 0) {
    const frames: Array<{ time: number; value: number }> = []
    for (const frame of keyframes) {
      if (isJsonObject(frame) && typeof frame.time === 'number' && typeof frame.value === 'number') {
        frames.push({ time: frame.time, value: frame.value })
      }
    }
    frames.sort((left, right) => left.time - right.time)
    if (frames.length > 0) {
      const exact = frames.find((frame) => frame.time === time)
      if (exact !== undefined) {
        return exact.value
      }
      if (time <= frames[0].time) {
        return frames[0].value
      }
      if (time >= frames[frames.length - 1].time) {
        return frames[frames.length - 1].value
      }
      for (let index = 0; index < frames.length - 1; index += 1) {
        const left = frames[index]
        const right = frames[index + 1]
        if (time > left.time && time < right.time) {
          const fraction = (time - left.time) / (right.time - left.time)
          return left.value + (right.value - left.value) * fraction
        }
      }
    }
  }
  if (typeof raw.value === 'number') {
    return raw.value
  }
  return fallback
}

function pathIssuesFor(view: ReturnType<typeof pathEntries>[number]): PathIssue[] {
  return view.issues.map((issue) => ({
    id: `${view.id}:${issue.field}:L25`,
    pathId: view.id,
    jsonPath: issue.field,
    field: issue.field.replace(`paths[${view.index}].`, ''),
    code: 'L25',
    severity: issue.message.startsWith('未知曲线类型') ? 'error' : 'block',
    message: issue.message,
  }))
}

function vecTuple(vector: Vec3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
}

/** 导出预览条目对象（UI 列表用）。 */
export function pathPreviewEntries(doc: ScriptDoc, options: PreviewOptions = {}): PathPreviewModel[] {
  return pathEntries(doc)
    .map((view) => buildPathPreview(doc, view.index, options))
    .filter((preview): preview is PathPreviewModel => preview !== null)
}

/** 路径选中门的辅助：只预览选中条目。 */
export function selectedPathPreview(
  doc: ScriptDoc,
  pathId: string | undefined,
  options: PreviewOptions = {},
): PathPreviewModel | null {
  if (pathId === undefined) {
    return null
  }
  const view = pathEntries(doc).find((entry) => entry.id === pathId)
  return view === undefined ? null : buildPathPreview(doc, view.index, options)
}

/** 便于 UI 直接读取路径条目的几何对象。 */
export function pathGeometry(pathIndex: number, doc: ScriptDoc): JsonObject | null {
  const view = pathEntries(doc).find((entry) => entry.index === pathIndex)
  return view === undefined || !isJsonObject(view.entry.geometry) ? null : view.entry.geometry
}
