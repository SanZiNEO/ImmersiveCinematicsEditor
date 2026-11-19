/**
 * 脚本层内置模板（12-05）：script.blank / script.camera_intro / script.follow_black。
 *
 * 脚本层只新建文档：七类空轨、相机 / 遮幅 / 黑场条件生成、相对基准跟随、触发器只写声明字段。
 * 不写 meta.version、timeline.total_duration、空 triggers 数组、规则与绑定。
 */
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ParamValue, PoseValue, TemplateParamIssue } from '../types.ts'
import type { ClipDraft, InternalTemplate, TrackDraft } from '../model.ts'
import { createIdAllocator, TRACK_TYPE_ORDER } from '../model.ts'
import { breathObjects, frame, keyframes, staticPoseObjects, value } from './common.ts'

const META_ID_PATTERN = /^[a-zA-Z0-9_]{1,32}$/
const META_NAME_MAX = 50
const META_AUTHOR_MAX = 30

function crossIssue(paramKey: string, severity: TemplateParamIssue['severity'], message: string): TemplateParamIssue {
  return { paramKey, code: 'T_PARAM_CROSS', severity, message }
}

function finite(value: ParamValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ── script.blank ───────────────────────────────────────────────────────────────────

const blank: InternalTemplate = {
  def: {
    id: 'script.blank',
    layer: 'script',
    titleKey: 'templates.script.blank.title',
    descriptionKey: 'templates.script.blank.desc',
    targetTrackTypes: [],
    params: [
      { key: 'id', kind: 'text', labelKey: 'templates.param.metaId', required: true },
      { key: 'name', kind: 'text', labelKey: 'templates.param.metaName', required: true },
      { key: 'author', kind: 'text', labelKey: 'templates.param.metaAuthor', required: false, default: '' },
    ],
  },
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const id = params.id
    if (typeof id !== 'string' || !META_ID_PATTERN.test(id)) {
      issues.push(crossIssue('id', 'error', '脚本 id 须为 1~32 位字母 / 数字 / 下划线'))
    }
    const name = params.name
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > META_NAME_MAX) {
      issues.push(crossIssue('name', 'error', `脚本名称须为 1~${META_NAME_MAX} 个字符`))
    }
    const author = params.author
    if (typeof author === 'string' && author.length > META_AUTHOR_MAX) {
      issues.push(crossIssue('author', 'error', `作者名不得超过 ${META_AUTHOR_MAX} 个字符`))
    }
    return issues
  },
  expand(params) {
    const meta: JsonObject = {
      id: String(params.id ?? ''),
      name: String(params.name ?? ''),
      author: String(params.author ?? ''),
    }
    const tracks: TrackDraft[] = TRACK_TYPE_ORDER.map((trackType) => ({ trackType, clips: [] }))
    return { meta, tracks, clips: [], paths: [], triggers: [] }
  },
}

// ── script.camera_intro ────────────────────────────────────────────────────────────

const cameraIntro: InternalTemplate = {
  def: {
    id: 'script.camera_intro',
    layer: 'script',
    titleKey: 'templates.script.camera_intro.title',
    descriptionKey: 'templates.script.camera_intro.desc',
    targetTrackTypes: ['CAMERA', 'LETTERBOX', 'OVERLAY'],
    params: [
      { key: 'cameraPose', kind: 'pose', labelKey: 'templates.param.cameraPose', required: true },
      { key: 'cameraDuration', kind: 'number', labelKey: 'templates.param.cameraDuration', required: true, default: 3, min: 0.1, max: 60, unit: 's' },
      { key: 'letterboxRatio', kind: 'number', labelKey: 'templates.param.letterboxRatio', required: false, default: 2.35, min: 0 },
      { key: 'blackDuration', kind: 'number', labelKey: 'templates.param.blackDuration', required: false, default: 1, min: 0, max: 60, unit: 's' },
    ],
  },
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const camera = finite(params.cameraDuration)
    const black = finite(params.blackDuration)
    if (camera !== null && black !== null && black > camera) {
      issues.push(crossIssue('blackDuration', 'error', '黑场时长不得超过相机片段时长'))
    }
    return issues
  },
  expand(params, ctx) {
    const pose = params.cameraPose as PoseValue
    const cameraDuration = finite(params.cameraDuration) ?? 3
    const ratio = finite(params.letterboxRatio) ?? 0
    const blackDuration = finite(params.blackDuration) ?? 0
    const alloc = createIdAllocator(ctx.namespace)

    const cameraObjects: JsonObject = {
      position_mode: value('absolute'),
      ...staticPoseObjects(pose),
      ...breathObjects({ enabled: false, type: 'perlin', intensity: 0.05, seed: 0, speed: 1, trauma: 1, decay: 0.5 }),
    }
    const cameraClip: ClipDraft = {
      clipId: alloc.nextClipId(),
      trackType: 'CAMERA',
      start: 0,
      duration: cameraDuration,
      objects: cameraObjects,
      paths: [],
    }
    const tracks: TrackDraft[] = [{ trackType: 'CAMERA', clips: [cameraClip] }]

    if (ratio > 0) {
      const letterboxClip: ClipDraft = {
        clipId: alloc.nextClipId(),
        trackType: 'LETTERBOX',
        start: 0,
        duration: cameraDuration,
        objects: {
          aspect_ratio: value(ratio),
          opacity: value(1),
        },
        paths: [],
      }
      tracks.push({ trackType: 'LETTERBOX', clips: [letterboxClip] })
    }
    if (blackDuration > 0) {
      const blackClip: ClipDraft = {
        clipId: alloc.nextClipId(),
        trackType: 'OVERLAY',
        start: 0,
        duration: blackDuration,
        objects: {
          layer_type: value('fade'),
          color: value('#000000'),
          opacity: keyframes([frame(0, 1), frame(blackDuration, 0)]),
        },
        paths: [],
      }
      tracks.push({ trackType: 'OVERLAY', clips: [blackClip] })
    }
    return { tracks, clips: [], paths: [], triggers: [] }
  },
}

// ── script.follow_black ─────────────────────────────────────────────────────────────

const followBlack: InternalTemplate = {
  def: {
    id: 'script.follow_black',
    layer: 'script',
    titleKey: 'templates.script.follow_black.title',
    descriptionKey: 'templates.script.follow_black.desc',
    targetTrackTypes: ['CAMERA', 'OVERLAY'],
    params: [
      { key: 'selector', kind: 'selector', labelKey: 'templates.param.selector', required: true },
      { key: 'backDistance', kind: 'number', labelKey: 'templates.param.backDistance', required: true, default: 3, min: 0 },
      { key: 'heightOffset', kind: 'number', labelKey: 'templates.param.heightOffset', required: false, default: 1.6 },
      { key: 'lookHeight', kind: 'number', labelKey: 'templates.param.lookHeight', required: false, default: 1.6 },
      { key: 'duration', kind: 'number', labelKey: 'templates.param.duration', required: true, default: 10, min: 0.1, max: 600, unit: 's' },
      { key: 'blackDuration', kind: 'number', labelKey: 'templates.param.blackDuration', required: false, default: 1, min: 0, max: 60, unit: 's' },
      { key: 'triggerType', kind: 'enum', labelKey: 'templates.param.triggerType', required: false, default: 'none', enumValues: ['none', 'login', 'biome'] },
      { key: 'biome', kind: 'text', labelKey: 'templates.param.biome', required: false, default: '' },
    ],
  },
  refs: [],
  crossCheck(params) {
    const issues: TemplateParamIssue[] = []
    const total = finite(params.duration)
    const black = finite(params.blackDuration)
    if (total !== null && black !== null && black > total) {
      issues.push(crossIssue('blackDuration', 'error', '结束黑场时长不得超过总时长'))
    }
    if (params.triggerType === 'biome' && (typeof params.biome !== 'string' || params.biome.trim().length === 0)) {
      issues.push(crossIssue('biome', 'error', '选择 biome 触发器时必须给出生物群系名称'))
    }
    return issues
  },
  expand(params, ctx) {
    const selector = params.selector as string
    const backDistance = finite(params.backDistance) ?? 3
    const heightOffset = finite(params.heightOffset) ?? 1.6
    const lookHeight = finite(params.lookHeight) ?? 1.6
    const total = finite(params.duration) ?? 10
    const blackDuration = finite(params.blackDuration) ?? 0
    const alloc = createIdAllocator(ctx.namespace)

    const cameraObjects: JsonObject = {
      position_mode: value('relative'),
      position_space: value('base'),
      position_origin: value(selector),
      position_origin_freeze: value(false),
      'position.x': value(-backDistance),
      'position.y': value(heightOffset),
      'position.z': value(0),
      facing_source: value('entity'),
      facing_target: value(selector),
      look_at: value('entity'),
      look_at_selector: value(selector),
      'look_at_part.y': value(lookHeight),
    }
    const cameraClip: ClipDraft = {
      clipId: alloc.nextClipId(),
      trackType: 'CAMERA',
      start: 0,
      duration: total,
      objects: cameraObjects,
      paths: [],
    }
    const tracks: TrackDraft[] = [{ trackType: 'CAMERA', clips: [cameraClip] }]

    if (blackDuration > 0) {
      const blackClip: ClipDraft = {
        clipId: alloc.nextClipId(),
        trackType: 'OVERLAY',
        start: total - blackDuration,
        duration: blackDuration,
        objects: {
          layer_type: value('fade'),
          color: value('#000000'),
          opacity: keyframes([frame(0, 0), frame(blackDuration, 1)]),
        },
        paths: [],
      }
      tracks.push({ trackType: 'OVERLAY', clips: [blackClip] })
    }

    const triggers: JsonObject[] = []
    if (params.triggerType === 'login') {
      triggers.push({ type: 'login', conditions: {} })
    } else if (params.triggerType === 'biome') {
      triggers.push({ type: 'biome', conditions: { biome: String(params.biome ?? '') } })
    }
    return { tracks, clips: [], paths: [], triggers }
  },
}

/** 脚本层内置模板登记顺序即展示顺序。 */
export const SCRIPT_TEMPLATES: readonly InternalTemplate[] = [blank, cameraIntro, followBlack]
