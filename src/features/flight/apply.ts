/**
 * 12-08 显式事务：把槽位姿态映射成「将改字段 + 旧值 + 新值」计划与一条 DocCommand。
 *
 * 纯函数：不碰 store、不改文档、不碰播放头与选择；命令由面板 / 工具层 commit。
 * 坐标解释规则严格按 `resolve.ts`；不做近似换算。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import { cloneJson, isJsonObject, isJsonArray, isFiniteNumber } from '../../core/doc/json.ts'
import type {
  AnimObjectShape,
  JsonArray,
  JsonObject,
  JsonValue,
  ObjectKeyframe,
  ScriptDoc,
} from '../../core/doc/types.ts'
import { effectiveValue } from '../authoring/groups.ts'
import { findKeyframeIndex, positionNodeTimes } from '../../core/doc/object.ts'
import {
  findClipById,
  inspectOrientation,
  inspectPosition,
  makeDiagnostic,
  objectsOfClip,
} from './resolve.ts'
import type {
  ApplyPlan,
  ApplyRequest,
  ApplyTarget,
  PathPointApplyTarget,
  PoseDiagnostic,
  PoseVec3,
  PoseWrite,
  PoseValue,
} from './types.ts'

const CAMERA = 'CAMERA'
const POSITION_AXES = ['x', 'y', 'z'] as const
const ANGLE_AXES = ['yaw', 'pitch', 'roll'] as const
const OPTICAL_AXES = ['fov', 'zoom'] as const

/** 路径条目查找。 */
function findPathEntry(doc: ScriptDoc, pathId: string): JsonObject | null {
  const paths = doc.root.paths
  if (!Array.isArray(paths)) {
    return null
  }
  for (const entry of paths) {
    if (isJsonObject(entry) && entry.id === pathId) {
      return entry
    }
  }
  return null
}

/** 控制点所属数组键（按几何类型）；不支持控制点写入的类型返回 `null`。 */
function controlListKey(geometryType: unknown): string | null {
  switch (geometryType) {
    case 'bezier':
    case 'rational_bezier':
    case 'bspline':
    case 'nurbs':
      return 'control_points'
    case 'catmull_rom':
      return 'points'
    case 'hermite':
      return 'tangents'
    default:
      return null
  }
}

/**
 * 单字段命令：按既有形态决定写静态值 / 改当前帧 / 补一帧。
 * 不自动给所有时间打帧；只动目标时间这一个属性。
 */
function fieldCommand(
  clipKey: string,
  path: string,
  time: number,
  frameMode: 'static' | 'keyframe',
  newValue: JsonValue,
  clip: JsonObject,
): DocCommand {
  const objects = objectsOfClip(clip)
  const raw = objects[path]
  const frames = isJsonObject(raw) && Array.isArray(raw.keyframes)
    ? (raw.keyframes as unknown as ObjectKeyframe[])
    : []

  if (frameMode === 'keyframe' && frames.length > 0) {
    const exact = findKeyframeIndex(frames, time)
    if (exact >= 0) {
      return { kind: 'object.setKeyframeValue', clipKey, path, time, value: cloneJson(newValue) }
    }
    return { kind: 'object.addKeyframe', clipKey, path, time, value: cloneJson(newValue) }
  }
  return { kind: 'object.setValue', clipKey, path, value: cloneJson(newValue) }
}

function oldValueOf(clip: JsonObject, path: string, time: number, catalog: CatalogIndex): JsonValue | null {
  const def = catalog.objectDef(CAMERA, path)
  const value = effectiveValue(clip, path, time, def)
  return value === null ? null : value
}

/** 相机叶子字段 / 关键帧当前值目标。 */
function planClipField(request: ApplyRequest, pose: PoseValue, target: Extract<ApplyTarget, { kind: 'clipField' }>): ApplyPlan {
  const writes: PoseWrite[] = []
  const diagnostics: PoseDiagnostic[] = []
  const commands: DocCommand[] = []
  const { clip, clipKey, time, frameMode } = target

  const position = inspectPosition(clip, time, pose.position, request.catalog)
  if (position.reason !== null) {
    diagnostics.push(position.reason)
  }
  if (position.writable && position.local !== null) {
    for (const axis of POSITION_AXES) {
      const path = `position.${axis}`
      writes.push({
        fieldPath: path,
        oldValue: oldValueOf(clip, path, time, request.catalog),
        newValue: position.local[axis],
      })
      commands.push(fieldCommand(clipKey, path, time, frameMode, position.local[axis], clip))
    }
  }

  const orientation = inspectOrientation(clip, time, request.catalog)
  if (orientation.reason !== null) {
    diagnostics.push(orientation.reason)
  }
  if (orientation.writable) {
    for (const axis of ANGLE_AXES) {
      writes.push({
        fieldPath: axis,
        oldValue: oldValueOf(clip, axis, time, request.catalog),
        newValue: pose[axis],
      })
      commands.push(fieldCommand(clipKey, axis, time, frameMode, pose[axis], clip))
    }
  }

  // 光学（fov / zoom）在任何参考系下都可写。
  for (const axis of OPTICAL_AXES) {
    writes.push({
      fieldPath: axis,
      oldValue: oldValueOf(clip, axis, time, request.catalog),
      newValue: pose[axis],
    })
    commands.push(fieldCommand(clipKey, axis, time, frameMode, pose[axis], clip))
  }

  const command: DocCommand | null = commands.length === 0
    ? null
    : commands.length === 1
      ? commands[0]!
      : { kind: 'compound', commands }
  return { ok: writes.length > 0, writes, diagnostics, command }
}

/** 模板参数目标：只填表，不落文档。 */
function planTemplateParam(pose: PoseValue, target: Extract<ApplyTarget, { kind: 'templateParam' }>): ApplyPlan {
  const writes: PoseWrite[] = []
  for (const [paramKey, field] of Object.entries(target.mapping)) {
    const newValue: JsonValue = field === 'position'
      ? cloneJson(pose.position as unknown as JsonValue)
      : (pose[field] as JsonValue)
    writes.push({ fieldPath: paramKey, oldValue: null, newValue })
  }
  return { ok: writes.length > 0, writes, diagnostics: [], command: null }
}

/** 路径端点：写回所属片段在端点时间的位置节点（节点必须已存在）。 */
function planEndpoint(
  request: ApplyRequest,
  pose: PoseValue,
  target: Extract<ApplyTarget, { kind: 'pathPoint' }> & { point: { type: 'endpoint'; side: 'from' | 'to' } },
  entry: JsonObject,
): ApplyPlan {
  const diagnostics: PoseDiagnostic[] = []
  const writes: PoseWrite[] = []
  const commands: DocCommand[] = []

  const time = target.point.side === 'from' ? entry.from : entry.to
  if (!isFiniteNumber(time)) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic('flight.path.endpointTime', '端点时间非法', `paths.${target.pathId}`)],
      command: null,
    }
  }

  const clipId = typeof entry.clip === 'string' ? entry.clip : ''
  const clip = findClipById(request.doc, clipId)
  if (clip === null) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic('flight.path.clipMissing', `路径引用的片段不存在: ${clipId}`)],
      command: null,
    }
  }
  if (target.clipKey === undefined || target.clipKey.length === 0) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic('flight.path.clipKeyMissing', '端点写回缺少片段键')],
      command: null,
    }
  }

  const nodes = positionNodeTimes(objectsOfClip(clip) as Record<string, AnimObjectShape>)
  const hit = nodes.some((node) => Math.abs(node - time) <= 1e-6)
  if (!hit) {
    diagnostics.push(makeDiagnostic(
      'flight.path.endpointNoNode',
      `端点 t=${time} 没有对应位置节点，请先走 07 端点编辑`,
      `paths.${target.pathId}`,
    ))
    return { ok: false, writes, diagnostics, command: null }
  }

  const position = inspectPosition(clip, time, pose.position, request.catalog)
  if (position.reason !== null) {
    diagnostics.push(position.reason)
  }
  if (position.writable && position.local !== null) {
    for (const axis of POSITION_AXES) {
      const path = `position.${axis}`
      writes.push({
        fieldPath: path,
        oldValue: oldValueOf(clip, path, time, request.catalog),
        newValue: position.local[axis],
      })
      commands.push({
        kind: 'object.setKeyframeValue',
        clipKey: target.clipKey,
        path,
        time,
        value: position.local[axis],
      })
    }
  }

  const command: DocCommand | null = commands.length === 0
    ? null
    : commands.length === 1
      ? commands[0]!
      : { kind: 'compound', commands }
  return { ok: writes.length > 0, writes, diagnostics, command }
}

/** 路径控制点：写完整对象形态（保留绝对 / 相对形态），不自动重采样。 */
function planControl(
  request: ApplyRequest,
  pose: PoseValue,
  target: Extract<ApplyTarget, { kind: 'pathPoint' }> & { point: { type: 'control'; index: number } },
  entry: JsonObject,
): ApplyPlan {
  const diagnostics: PoseDiagnostic[] = []
  const writes: PoseWrite[] = []

  const geometry = isJsonObject(entry.geometry) ? entry.geometry : null
  if (geometry === null) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic('flight.path.geometryMissing', '路径缺少几何定义', `paths.${target.pathId}`)],
      command: null,
    }
  }

  const listKey = controlListKey(geometry.type)
  if (listKey === null) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic(
        'flight.path.controlUnsupported',
        `几何类型 ${String(geometry.type)} 不支持控制点写入`,
        `paths.${target.pathId}.geometry`,
      )],
      command: null,
    }
  }

  const list = Array.isArray(geometry[listKey]) ? geometry[listKey] : []
  const index = target.point.index
  if (index < 0 || index >= list.length) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic('flight.path.controlIndex', `控制点下标越界: ${index}`, `paths.${target.pathId}.geometry.${listKey}`)],
      command: null,
    }
  }

  const point = list[index]
  const absolute = isJsonObject(point) && 'x' in point && 'y' in point && 'z' in point
  const relative = isJsonObject(point) && 'dx' in point && 'dy' in point && 'dz' in point
  if (!absolute && !relative) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic('flight.path.controlForm', '控制点对象形态无法识别（需要 {x,y,z} 或 {dx,dy,dz}）')],
      command: null,
    }
  }
  if (relative) {
    return {
      ok: false,
      writes,
      diagnostics: [makeDiagnostic(
        'flight.path.controlRelative',
        '相对形态控制点需要线段起点才能换算，不自动重采样；请先改为绝对形态',
        `paths.${target.pathId}.geometry.${listKey}[${index}]`,
      )],
      command: null,
    }
  }

  const nextPoint: PoseVec3 = { x: pose.position.x, y: pose.position.y, z: pose.position.z }
  const clone = cloneJson(entry)
  const cloneGeometry = clone.geometry
  if (!isJsonObject(cloneGeometry)) {
    return { ok: false, writes, diagnostics: [makeDiagnostic('flight.path.geometryMissing', '几何克隆失败')], command: null }
  }
  const cloneList = cloneGeometry[listKey]
  if (!isJsonArray(cloneList)) {
    return { ok: false, writes, diagnostics: [makeDiagnostic('flight.path.geometryMissing', '控制点数组克隆失败')], command: null }
  }
  const previous = cloneList[index]
  cloneList[index] = cloneJson(nextPoint as unknown as JsonValue)

  for (const axis of POSITION_AXES) {
    writes.push({
      fieldPath: `geometry.${listKey}[${index}].${axis}`,
      oldValue: isJsonObject(previous) ? (previous[axis] as JsonValue) : null,
      newValue: nextPoint[axis],
    })
  }

  const command: DocCommand = {
    kind: 'path.writeBatch',
    removeIds: [target.pathId],
    entries: [clone],
  }
  return { ok: true, writes, diagnostics, command }
}

/** 计划入口：按目标四类分派；返回计划与命令（不落文档）。 */
export function planApply(
  doc: ScriptDoc,
  catalog: CatalogIndex,
  target: ApplyTarget,
  pose: PoseValue,
): ApplyPlan {
  const request: ApplyRequest = { pose, target, doc, catalog, playhead: 0 }

  switch (target.kind) {
    case 'clipField':
      return planClipField(request, pose, target)
    case 'templateParam':
      return planTemplateParam(pose, target)
    case 'pathPoint': {
      const entry = findPathEntry(doc, target.pathId)
      if (entry === null) {
        return {
          ok: false,
          writes: [],
          diagnostics: [makeDiagnostic('flight.path.notFound', `路径不存在: ${target.pathId}`)],
          command: null,
        }
      }
      const pathTarget = target as PathPointApplyTarget
      return pathTarget.point.type === 'endpoint'
        ? planEndpoint(request, pose, pathTarget as Extract<PathPointApplyTarget, { point: { type: 'endpoint' } }>, entry)
        : planControl(request, pose, pathTarget as Extract<PathPointApplyTarget, { point: { type: 'control' } }>, entry)
    }
  }
}
