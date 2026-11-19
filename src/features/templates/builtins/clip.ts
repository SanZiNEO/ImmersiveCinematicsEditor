/**
 * 片段层内置模板（12-03）：clip.fade / clip.static_breath / clip.dolly / clip.orbit_arc。
 *
 * 字段只来自 02 目录（以 tracks.ts 为准）；不写转场、不写 meta；value-only 字段不打关键帧；
 * 关键帧时间从 0 起、单位秒、严格递增。
 */
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ParamValue, PoseValue, TemplateParamIssue } from '../types.ts'
import type { ClipDraft, InternalTemplate } from '../model.ts'
import { breathObjects, frame, keyframes, staticPoseObjects, value } from './common.ts'
import { bezierRelativeControls, circlePoint, circleTangent, type Vec3 } from './circle.ts'

const SWEEP_LIMIT_DEG = 90
const SWEEP_EPS = 1e-9

function crossIssue(paramKey: string, message: string): TemplateParamIssue {
  return { paramKey, code: 'T_PARAM_CROSS', severity: 'error', message }
}

function finite(value: ParamValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ── clip.fade ──────────────────────────────────────────────────────────────────────

const fade: InternalTemplate = {
  def: {
    id: 'clip.fade',
    layer: 'clip',
    titleKey: 'templates.clip.fade.title',
    descriptionKey: 'templates.clip.fade.desc',
    targetTrackTypes: ['OVERLAY'],
    params: [
      { key: 'duration', kind: 'number', labelKey: 'templates.param.duration', required: true, default: 2, min: 0.1, max: 60, unit: 's' },
      { key: 'mode', kind: 'enum', labelKey: 'templates.param.fadeMode', required: true, default: 'in', enumValues: ['in', 'out', 'roundtrip'] },
      { key: 'color', kind: 'color', labelKey: 'templates.param.color', required: true, default: '#000000' },
    ],
  },
  refs: [],
  expand(params, ctx) {
    const duration = params.duration as number
    const mode = params.mode as string
    const color = params.color as string
    let frames: Array<{ time: number; value: JsonValue }>
    if (mode === 'out') {
      frames = [frame(0, 1), frame(duration, 0)]
    } else if (mode === 'roundtrip') {
      frames = [frame(0, 0), frame(duration / 2, 1), frame(duration, 0)]
    } else {
      frames = [frame(0, 0), frame(duration, 1)]
    }
    const objects: JsonObject = {
      layer_type: value('fade'),
      color: value(color),
      opacity: keyframes(frames),
    }
    const clipId = ctx.nextClipId()
    const clip: ClipDraft = { clipId, trackType: 'OVERLAY', start: 0, duration, objects, paths: [] }
    return { tracks: [], clips: [clip], paths: [], triggers: [] }
  },
}

// ── clip.static_breath ─────────────────────────────────────────────────────────────

const staticBreath: InternalTemplate = {
  def: {
    id: 'clip.static_breath',
    layer: 'clip',
    titleKey: 'templates.clip.static_breath.title',
    descriptionKey: 'templates.clip.static_breath.desc',
    targetTrackTypes: ['CAMERA'],
    params: [
      { key: 'pose', kind: 'pose', labelKey: 'templates.param.pose', required: true },
      { key: 'duration', kind: 'number', labelKey: 'templates.param.duration', required: true, default: 3, min: 0.1, max: 60, unit: 's' },
      { key: 'breathEnabled', kind: 'boolean', labelKey: 'templates.param.breathEnabled', required: false, default: false },
      { key: 'breathType', kind: 'enum', labelKey: 'templates.param.breathType', required: false, default: 'perlin', enumValues: ['perlin', 'perlin_axis', 'sine', 'trauma'] },
      { key: 'breathIntensity', kind: 'number', labelKey: 'templates.param.breathIntensity', required: false, default: 0.05, min: 0, max: 1 },
      { key: 'breathSeed', kind: 'integer', labelKey: 'templates.param.breathSeed', required: false, default: 0, min: 0 },
      { key: 'breathSpeed', kind: 'number', labelKey: 'templates.param.breathSpeed', required: false, default: 1, min: 0 },
      { key: 'breathTrauma', kind: 'number', labelKey: 'templates.param.breathTrauma', required: false, default: 1, min: 0 },
      { key: 'breathDecay', kind: 'number', labelKey: 'templates.param.breathDecay', required: false, default: 0.5, min: 0 },
    ],
  },
  refs: [],
  expand(params, ctx) {
    const pose = params.pose as PoseValue
    const duration = params.duration as number
    const objects: JsonObject = {
      position_mode: value('absolute'),
      ...staticPoseObjects(pose),
      ...breathObjects({
        enabled: params.breathEnabled === true,
        type: (params.breathType as string) ?? 'perlin',
        intensity: finite(params.breathIntensity) ?? 0.05,
        seed: Number.isInteger(params.breathSeed) ? Number(params.breathSeed) : 0,
        speed: finite(params.breathSpeed) ?? 1,
        trauma: finite(params.breathTrauma) ?? 1,
        decay: finite(params.breathDecay) ?? 0.5,
      }),
    }
    const clipId = ctx.nextClipId()
    const clip: ClipDraft = {
      clipId,
      trackType: 'CAMERA',
      start: 0,
      duration,
      objects,
      paths: [],
    }
    return { tracks: [], clips: [clip], paths: [], triggers: [] }
  },
}

// ── clip.dolly ──────────────────────────────────────────────────────────────────────

const dolly: InternalTemplate = {
  def: {
    id: 'clip.dolly',
    layer: 'clip',
    titleKey: 'templates.clip.dolly.title',
    descriptionKey: 'templates.clip.dolly.desc',
    targetTrackTypes: ['CAMERA'],
    params: [
      { key: 'duration', kind: 'number', labelKey: 'templates.param.duration', required: true, default: 3, min: 0.1, max: 60, unit: 's' },
      { key: 'startPose', kind: 'pose', labelKey: 'templates.param.startPose', required: true },
      { key: 'endPose', kind: 'pose', labelKey: 'templates.param.endPose', required: true },
      { key: 'lookMode', kind: 'enum', labelKey: 'templates.param.lookMode', required: true, default: 'angles', enumValues: ['angles', 'coordinate'] },
      { key: 'lookTargetX', kind: 'number', labelKey: 'templates.param.lookTargetX', required: false, default: 0 },
      { key: 'lookTargetY', kind: 'number', labelKey: 'templates.param.lookTargetY', required: false, default: 0 },
      { key: 'lookTargetZ', kind: 'number', labelKey: 'templates.param.lookTargetZ', required: false, default: 0 },
    ],
  },
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const start = params.startPose as PoseValue | null
    const end = params.endPose as PoseValue | null
    if (start !== null && end !== null) {
      const same = start.position.x === end.position.x
        && start.position.y === end.position.y
        && start.position.z === end.position.z
      if (same) {
        issues.push(crossIssue('startPose', '起点与终点位置相同：推轨片段需要起点≠终点'))
      }
    }
    if (params.lookMode === 'coordinate') {
      for (const key of ['lookTargetX', 'lookTargetY', 'lookTargetZ']) {
        if (finite(params[key]) === null) {
          issues.push(crossIssue(key, '坐标注视方式必须给出注视点三轴'))
        }
      }
    }
    return issues
  },
  expand(params, ctx) {
    const duration = params.duration as number
    const start = params.startPose as PoseValue
    const end = params.endPose as PoseValue
    const lookMode = params.lookMode as string
    const objects: JsonObject = {
      position_mode: value('absolute'),
      'position.x': keyframes([frame(0, start.position.x), frame(duration, end.position.x)]),
      'position.y': keyframes([frame(0, start.position.y), frame(duration, end.position.y)]),
      'position.z': keyframes([frame(0, start.position.z), frame(duration, end.position.z)]),
      fov: keyframes([frame(0, start.fov), frame(duration, end.fov)]),
      zoom: keyframes([frame(0, start.zoom), frame(duration, end.zoom)]),
    }
    if (lookMode === 'coordinate') {
      objects.look_at = value('coordinate')
      objects.look_at_target_x = value(finite(params.lookTargetX) ?? 0)
      objects.look_at_target_y = value(finite(params.lookTargetY) ?? 0)
      objects.look_at_target_z = value(finite(params.lookTargetZ) ?? 0)
    } else {
      objects.yaw = keyframes([frame(0, start.yaw), frame(duration, end.yaw)])
      objects.pitch = keyframes([frame(0, start.pitch), frame(duration, end.pitch)])
      objects.roll = keyframes([frame(0, start.roll), frame(duration, end.roll)])
    }
    const clipId = ctx.nextClipId()
    const clip: ClipDraft = { clipId, trackType: 'CAMERA', start: 0, duration, objects, paths: [] }
    return { tracks: [], clips: [clip], paths: [], triggers: [] }
  },
}

// ── clip.orbit_arc ────────────────────────────────────────────────────────────────

const orbitArc: InternalTemplate = {
  def: {
    id: 'clip.orbit_arc',
    layer: 'clip',
    titleKey: 'templates.clip.orbit_arc.title',
    descriptionKey: 'templates.clip.orbit_arc.desc',
    targetTrackTypes: ['CAMERA'],
    params: [
      { key: 'duration', kind: 'number', labelKey: 'templates.param.duration', required: true, default: 3, min: 0.1, max: 60, unit: 's' },
      { key: 'centerX', kind: 'number', labelKey: 'templates.param.centerX', required: true, default: 0 },
      { key: 'centerZ', kind: 'number', labelKey: 'templates.param.centerZ', required: true, default: 0 },
      { key: 'height', kind: 'number', labelKey: 'templates.param.height', required: true, default: 0 },
      { key: 'radius', kind: 'number', labelKey: 'templates.param.radius', required: true, default: 5, min: 0.01 },
      { key: 'startAngle', kind: 'number', labelKey: 'templates.param.startAngle', required: true, default: 0, unit: 'deg' },
      { key: 'sweep', kind: 'number', labelKey: 'templates.param.sweep', required: true, default: 90, min: 0, max: 360, unit: 'deg' },
      { key: 'clockwise', kind: 'boolean', labelKey: 'templates.param.clockwise', required: false, default: false },
      { key: 'lookMode', kind: 'enum', labelKey: 'templates.param.lookMode', required: true, default: 'center', enumValues: ['center', 'tangent'] },
      { key: 'fov', kind: 'number', labelKey: 'templates.param.fov', required: false, default: 70, min: 10, max: 120 },
    ],
  },
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const sweep = finite(params.sweep)
    if (sweep !== null && Math.abs(sweep) > SWEEP_LIMIT_DEG + SWEEP_EPS) {
      issues.push(crossIssue('sweep', `单段扫角 ${sweep}° 超过 ${SWEEP_LIMIT_DEG}° 上限：请改用轨道模板 track.orbit_full 并增大段数`))
    }
    const radius = finite(params.radius)
    if (radius !== null && radius <= 0) {
      issues.push(crossIssue('radius', '轨道半径必须大于 0'))
    }
    return issues
  },
  expand(params, ctx) {
    const duration = params.duration as number
    const center: Vec3 = { x: finite(params.centerX) ?? 0, y: finite(params.height) ?? 0, z: finite(params.centerZ) ?? 0 }
    const radius = finite(params.radius) ?? 5
    const height = finite(params.height) ?? 0
    const startAngle = finite(params.startAngle) ?? 0
    const sweep = finite(params.sweep) ?? 0
    const clockwise = params.clockwise === true
    const lookMode = params.lookMode as string
    const fov = finite(params.fov) ?? 70
    const signedDelta = (clockwise ? -1 : 1) * sweep
    const endAngle = startAngle + signedDelta
    const p0 = circlePoint(center, radius, height, startAngle)
    const p3 = circlePoint(center, radius, height, endAngle)
    const t0 = circleTangent(radius, startAngle)
    const t1 = circleTangent(radius, endAngle)
    const [c1, c2] = bezierRelativeControls(p0, p3, t0, t1, signedDelta)

    const objects: JsonObject = {
      position_mode: value('absolute'),
      'position.x': keyframes([frame(0, p0.x), frame(duration, p3.x)]),
      'position.y': keyframes([frame(0, p0.y), frame(duration, p3.y)]),
      'position.z': keyframes([frame(0, p0.z), frame(duration, p3.z)]),
      fov: value(fov),
    }
    if (lookMode === 'tangent') {
      objects.orient = value('tangent')
      objects.yaw_offset = value(0)
      objects.pitch_offset = value(0)
    } else {
      objects.look_at = value('coordinate')
      objects.look_at_target_x = value(center.x)
      objects.look_at_target_y = value(center.y)
      objects.look_at_target_z = value(center.z)
    }

    const clipId = ctx.nextClipId()
    const pathId = ctx.nextPathId()
    const paths = [{
      id: pathId,
      clip: clipId,
      from: 0,
      to: duration,
      axes: ['x', 'z'],
      geometry: { type: 'bezier', control_points: [{ dx: c1.x, dy: c1.y, dz: c1.z }, { dx: c2.x, dy: c2.y, dz: c2.z }] },
    }]
    const clip: ClipDraft = { clipId, trackType: 'CAMERA', start: 0, duration, objects, paths }
    return { tracks: [], clips: [clip], paths: [], triggers: [] }
  },
}

/** 片段层内置模板登记顺序即展示顺序。 */
export const CLIP_TEMPLATES: readonly InternalTemplate[] = [fade, staticBreath, dolly, orbitArc]
