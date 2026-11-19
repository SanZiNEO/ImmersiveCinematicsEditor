/**
 * 12-08 从选中相机片段按当前字段求值世界姿态。
 *
 * 只能在能忠实求值时返回姿态；不可忠实求值（原点为空 / 动态、基准空间无参考系、
 * 注视目标、切线朝向、呼吸抖动 / 运动模型等运行时求值字段）时给逐条禁用原因。
 * 不做近似换算，不回退到玩家位置。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { effectiveValue, effectiveToken } from '../authoring/groups.ts'
import { parsePointSource } from '../authoring/pointSource.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import {
  findClipById,
  inspectOrientation,
  makeDiagnostic,
  objectsOfClip,
  positionModeOf,
} from './resolve.ts'
import type { PoseDiagnostic, PoseExtraction, PoseVec3, PoseValue } from './types.ts'

const CAMERA = 'CAMERA'
const POSITION_AXES = ['x', 'y', 'z'] as const
const ANGLE_AXES = ['yaw', 'pitch', 'roll'] as const

/** 运行时叠加模型字段（非空即表示姿态含运行时求值分量，不可忠实取静态姿态）。 */
const MOTION_FIELDS: ReadonlyArray<{ path: string; code: string; label: string }> = [
  { path: 'motion_position', code: 'flight.motion.position', label: '位置运动模型' },
  { path: 'motion_yaw', code: 'flight.motion.orientation', label: '朝向运动模型' },
  { path: 'motion_pitch', code: 'flight.motion.orientation', label: '朝向运动模型' },
  { path: 'motion_roll', code: 'flight.motion.orientation', label: '朝向运动模型' },
  { path: 'motion_fov', code: 'flight.motion.optical', label: '视场角运动模型' },
  { path: 'motion_zoom', code: 'flight.motion.optical', label: '缩放运动模型' },
]

/** 读一个轴的有效数字；非有限返回 `null`。 */
function readNumber(clip: JsonObject, path: string, time: number, catalog: CatalogIndex): number | null {
  const def = catalog.objectDef(CAMERA, path)
  const value = effectiveValue(clip, path, time, def)
  return isFiniteNumber(value) ? value : null
}

/** 运行时求值字段检查：呼吸抖动 / 运动模型非空 → 逐条原因。 */
function runtimeModelReasons(clip: JsonObject, time: number, catalog: CatalogIndex): PoseDiagnostic[] {
  const reasons: PoseDiagnostic[] = []
  const breathDef = catalog.objectDef(CAMERA, 'cam_breath_enabled')
  const breath = effectiveValue(clip, 'cam_breath_enabled', time, breathDef)
  if (breath === true) {
    reasons.push(makeDiagnostic('flight.breath', '呼吸抖动已启用，姿态含运行时叠加分量，不可忠实求值'))
  }
  const objects = objectsOfClip(clip)
  for (const motion of MOTION_FIELDS) {
    const raw = objects[motion.path]
    if (isJsonObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'value') && raw.value !== null) {
      reasons.push(makeDiagnostic(motion.code, `${motion.label}（${motion.path}）为运行时求值模型，不可忠实取姿态`))
    }
  }
  return reasons
}

/** 从片段求世界位置；不可忠实求值返回 `null` 并给原因。 */
function readWorldPosition(
  clip: JsonObject,
  time: number,
  catalog: CatalogIndex,
  reasons: PoseDiagnostic[],
): PoseVec3 | null {
  const { mode, space } = positionModeOf(clip, time, catalog)

  if (mode === 'absolute') {
    const x = readNumber(clip, 'position.x', time, catalog)
    const y = readNumber(clip, 'position.y', time, catalog)
    const z = readNumber(clip, 'position.z', time, catalog)
    if (x === null || y === null || z === null) {
      reasons.push(makeDiagnostic('flight.position.nonFinite', '位置三轴存在缺失或非有限值'))
      return null
    }
    return { x, y, z }
  }

  if (space === 'base') {
    reasons.push(makeDiagnostic('flight.position.base', '相对基准空间无可靠世界参考系，无法求出世界位置'))
    return null
  }

  const originRaw = effectiveToken(clip, 'position_origin', time)
  const form = parsePointSource(originRaw)
  if (form.kind !== 'coordinate') {
    reasons.push(makeDiagnostic(
      'flight.position.originUnreliable',
      `原点形态 ${form.kind}（空 / 玩家 / 选择器 / 方块 / 结构）无固定世界参考系，无法求出世界位置`,
    ))
    return null
  }
  const ox = readNumber(clip, 'position_origin_x', time, catalog)
  const oy = readNumber(clip, 'position_origin_y', time, catalog)
  const oz = readNumber(clip, 'position_origin_z', time, catalog)
  const ax = readNumber(clip, 'position.x', time, catalog)
  const ay = readNumber(clip, 'position.y', time, catalog)
  const az = readNumber(clip, 'position.z', time, catalog)
  if (ox === null || oy === null || oz === null || ax === null || ay === null || az === null) {
    reasons.push(makeDiagnostic('flight.position.originCoords', '固定原点或偏移坐标缺失 / 非有限，无法求出世界位置'))
    return null
  }
  return { x: ax + ox, y: ay + oy, z: az + oz }
}

/** 从片段求朝向三轴；不可忠实求值返回 `null` 并给原因。 */
function readOrientation(
  clip: JsonObject,
  time: number,
  catalog: CatalogIndex,
  reasons: PoseDiagnostic[],
): { yaw: number; pitch: number; roll: number } | null {
  const orientation = inspectOrientation(clip, time, catalog)
  if (orientation.reason !== null) {
    reasons.push(orientation.reason)
    return null
  }
  const yaw = readNumber(clip, 'yaw', time, catalog)
  const pitch = readNumber(clip, 'pitch', time, catalog)
  const roll = readNumber(clip, 'roll', time, catalog)
  if (yaw === null || pitch === null || roll === null) {
    reasons.push(makeDiagnostic('flight.orientation.nonFinite', '朝向三轴存在缺失或非有限值'))
    return null
  }
  return { yaw, pitch, roll }
}

/**
 * 按当前字段求值世界姿态。
 *
 * @param clipKey 片段运行时 id（与 `clip.id` 对齐）。
 * @param time 求值时间（秒）。
 */
export function poseFromClip(
  doc: ScriptDoc,
  clipKey: string,
  time: number,
  catalog: CatalogIndex,
): PoseExtraction {
  const reasons: PoseDiagnostic[] = []
  const clip = findClipById(doc, clipKey)
  if (clip === null) {
    return {
      ok: false,
      pose: null,
      reasons: [makeDiagnostic('flight.clipNotFound', `片段不存在: ${clipKey}`)],
    }
  }

  reasons.push(...runtimeModelReasons(clip, time, catalog))

  const position = readWorldPosition(clip, time, catalog, reasons)
  const orientation = readOrientation(clip, time, catalog, reasons)

  const fov = readNumber(clip, 'fov', time, catalog)
  const zoom = readNumber(clip, 'zoom', time, catalog)
  if (fov === null || zoom === null) {
    reasons.push(makeDiagnostic('flight.optical.nonFinite', 'fov / zoom 存在缺失或非有限值'))
  }

  const blocking = reasons.some((reason) => reason.severity === 'error')
  if (blocking || position === null || orientation === null || fov === null || zoom === null) {
    return { ok: false, pose: null, reasons }
  }

  const pose: PoseValue = {
    position,
    yaw: orientation.yaw,
    pitch: orientation.pitch,
    roll: orientation.roll,
    fov,
    zoom,
  }
  return { ok: true, pose, reasons }
}
