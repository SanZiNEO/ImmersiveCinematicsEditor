/**
 * 轨道层内置模板（12-04）：track.orbit_full / track.multi_cam。
 *
 * 内部轨道组合器调用片段模板展开函数（12-02 §4.4）；段首尾相接、不重叠、不写转场；
 * 机位数与姿态数一致，呼吸关闭，不补空。
 */
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ParamValue, PoseValue, TemplateParamIssue } from '../types.ts'
import type { ClipDraft, InternalTemplate, TrackDraft } from '../model.ts'
import { createIdAllocator } from '../model.ts'
import { CLIP_TEMPLATES } from './clip.ts'

const SWEEP_LIMIT_DEG = 90
const SWEEP_EPS = 1e-9

function crossIssue(paramKey: string, severity: TemplateParamIssue['severity'], message: string): TemplateParamIssue {
  return { paramKey, code: 'T_PARAM_CROSS', severity, message }
}

function finite(value: ParamValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clipTemplate(id: string): InternalTemplate {
  const found = CLIP_TEMPLATES.find((item) => item.def.id === id)
  if (found === undefined) {
    throw new Error(`内部片段模板未登记: ${id}`)
  }
  return found
}

// ── track.orbit_full ───────────────────────────────────────────────────────────────

const orbitFull: InternalTemplate = {
  def: {
    id: 'track.orbit_full',
    layer: 'track',
    titleKey: 'templates.track.orbit_full.title',
    descriptionKey: 'templates.track.orbit_full.desc',
    targetTrackTypes: ['CAMERA'],
    params: [
      { key: 'duration', kind: 'number', labelKey: 'templates.param.duration', required: true, default: 10, min: 0.1, max: 600, unit: 's' },
      { key: 'centerX', kind: 'number', labelKey: 'templates.param.centerX', required: true, default: 0 },
      { key: 'centerZ', kind: 'number', labelKey: 'templates.param.centerZ', required: true, default: 0 },
      { key: 'height', kind: 'number', labelKey: 'templates.param.height', required: true, default: 0 },
      { key: 'radius', kind: 'number', labelKey: 'templates.param.radius', required: true, default: 5, min: 0.01 },
      { key: 'turns', kind: 'number', labelKey: 'templates.param.turns', required: true, default: 1, min: 0.25, max: 10 },
      { key: 'segments', kind: 'integer', labelKey: 'templates.param.segments', required: true, default: 4, min: 2, max: 32 },
      { key: 'clockwise', kind: 'boolean', labelKey: 'templates.param.clockwise', required: false, default: false },
      { key: 'lookMode', kind: 'enum', labelKey: 'templates.param.lookMode', required: true, default: 'center', enumValues: ['center', 'tangent'] },
      { key: 'fov', kind: 'number', labelKey: 'templates.param.fov', required: false, default: 70, min: 10, max: 120 },
    ],
  },
  // 内部轨道组合器（12-02 §4.4）：直接调用片段模板展开函数，不复制片段数学；
  // 不通过引擎 refs 声明嵌套，机位数 / 段数由本层展开循环决定。
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const turns: number | null = finite(params.turns)
    const segments: number | null = finite(params.segments)
    if (turns !== null && segments !== null && segments > 0) {
      const perSegment = Math.abs((turns * 360) / segments)
      if (perSegment > SWEEP_LIMIT_DEG + SWEEP_EPS) {
        issues.push(crossIssue('segments', 'error', `单段扫角 ${perSegment.toFixed(1)}° 超过 ${SWEEP_LIMIT_DEG}° 上限：请增大段数（segments）`))
      }
    }
    return issues
  },
  expand(params, ctx) {
    const total = finite(params.duration) ?? 10
    const segments = Number.isInteger(params.segments) ? Number(params.segments) : 4
    const turns = finite(params.turns) ?? 1
    const perSegment = (360 * turns) / segments
    const segDur = total / segments
    const arc = clipTemplate('clip.orbit_arc')
    const clips: ClipDraft[] = []
    for (let i = 0; i < segments; i += 1) {
      const last = i === segments - 1
      const duration = last ? total - i * segDur : segDur
      const startAngle = i * perSegment
      const subAlloc = createIdAllocator(`${ctx.namespace}_seg${i}`)
      const subCtx = {
        ...ctx,
        nextClipId: subAlloc.nextClipId,
        nextPathId: subAlloc.nextPathId,
      }
      const childParams: Record<string, ParamValue> = {
        duration,
        centerX: params.centerX,
        centerZ: params.centerZ,
        height: params.height,
        radius: params.radius,
        startAngle,
        sweep: Math.abs(perSegment),
        clockwise: params.clockwise,
        lookMode: params.lookMode,
        fov: params.fov,
      }
      const child = arc.expand(childParams, subCtx)
      const clip = child.clips[0]
      clip.start = i * segDur
      clips.push(clip)
    }
    const track: TrackDraft = { trackType: 'CAMERA', clips }
    return { tracks: [track], clips: [], paths: [], triggers: [] }
  },
}

// ── track.multi_cam ────────────────────────────────────────────────────────────────

function samePose(a: PoseValue, b: PoseValue): boolean {
  return a.position.x === b.position.x
    && a.position.y === b.position.y
    && a.position.z === b.position.z
    && a.yaw === b.yaw && a.pitch === b.pitch && a.roll === b.roll
    && a.fov === b.fov && a.zoom === b.zoom
}

const multiCam: InternalTemplate = {
  def: {
    id: 'track.multi_cam',
    layer: 'track',
    titleKey: 'templates.track.multi_cam.title',
    descriptionKey: 'templates.track.multi_cam.desc',
    targetTrackTypes: ['CAMERA'],
    params: [
      { key: 'poses', kind: 'poseList', labelKey: 'templates.param.poses', required: true, minCount: 1, maxCount: 16 },
      { key: 'clipDuration', kind: 'number', labelKey: 'templates.param.clipDuration', required: true, default: 3, min: 0.1, max: 60, unit: 's' },
      { key: 'gap', kind: 'number', labelKey: 'templates.param.gap', required: false, default: 0, min: 0, max: 60, unit: 's' },
    ],
  },
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const poses = params.poses
    if (!Array.isArray(poses)) {
      return issues
    }
    for (let i = 1; i < poses.length; i += 1) {
      if (samePose(poses[i] as PoseValue, poses[i - 1] as PoseValue)) {
        issues.push(crossIssue('poses', 'warning', `第 ${i} 与第 ${i + 1} 个机位姿态完全相同`))
      }
    }
    return issues
  },
  expand(params, ctx) {
    const poses = (Array.isArray(params.poses) ? params.poses : []) as PoseValue[]
    const clipDuration = finite(params.clipDuration) ?? 3
    const gap = finite(params.gap) ?? 0
    const breath = clipTemplate('clip.static_breath')
    const clips: ClipDraft[] = []
    poses.forEach((pose, index) => {
      const subAlloc = createIdAllocator(`${ctx.namespace}_cam${index}`)
      const subCtx = { ...ctx, nextClipId: subAlloc.nextClipId, nextPathId: subAlloc.nextPathId }
      const childParams: Record<string, ParamValue> = {
        pose,
        duration: clipDuration,
        breathEnabled: false,
      }
      const child = breath.expand(childParams, subCtx)
      const clip = child.clips[0]
      clip.start = index * (clipDuration + gap)
      clips.push(clip)
    })
    const track: TrackDraft = { trackType: 'CAMERA', clips }
    return { tracks: [track], clips: [], paths: [], triggers: [] }
  },
}

/** 轨道层内置模板登记顺序即展示顺序。 */
export const TRACK_TEMPLATES: readonly InternalTemplate[] = [orbitFull, multiCam]
