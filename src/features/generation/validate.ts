/**
 * 四层生成校验链（12-11）：参数 → 展开结构 → 装配 → 最终脚本校验。
 *
 * 第四层复用既有 `validateStructure` 与目录校验，不造第二套语义；warning 允许保存、
 * error 阻止且零残留（命令未提交即零残留，提交失败由命令层事务回退）。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocIssue } from '../../core/doc/types.ts'
import type { JsonObject, JsonValue, ObjectKeyframe, ScriptDoc } from '../../core/doc/types.ts'
import { validateStructure } from '../../core/doc/structural.ts'
import { ClipRegistry } from '../../core/doc/identity.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import {
  isKnownGeometryType,
  PATH_AXES,
  PATH_GEOMETRY_TYPES,
} from '../../core/paths/types.ts'
import { diagnosticOf, dedupeDiagnostics, type Diagnostic } from './diagnostics.ts'
import type { LayerDraft, PathDraft } from '../templates/model.ts'
import type { ClipDraft } from '../templates/model.ts'

const LEAK_KEY_PATTERN = /^(template|templateId|param|params|slot|slotId|namespace|source|generatedAt|createdAt|origin|metaTemplate)$/i
const TRANSITION_PREFIX = 'transition'

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ── 第二层：展开结构事实校验 ──────────────────────────────────────────────────────

function checkClipStructure(clip: ClipDraft, catalog: CatalogIndex, diagnostics: Diagnostic[]): void {
  const { trackType, objects, clipId } = clip
  for (const [key, property] of Object.entries(objects)) {
    if (key.startsWith(TRANSITION_PREFIX) || key.startsWith('crossfade')) {
      diagnostics.push(diagnosticOf('T_FORBIDDEN_TRANSITION', 'error', `模板不写片段级转场字段: ${key}`, 'template', { clipKey: clipId, fieldPath: key }))
    }
    if (LEAK_KEY_PATTERN.test(key)) {
      diagnostics.push(diagnosticOf('T_LEAK', 'error', `产物不得携带模板元信息字段: ${key}`, 'template', { clipKey: clipId, fieldPath: key }))
    }
    const def = catalog.objectDef(trackType, key)
    if (def === undefined) {
      diagnostics.push(diagnosticOf('T_FIELD_UNKNOWN', 'error', `字段 ${key} 不在 ${trackType} 目录中`, 'template', { clipKey: clipId, fieldPath: key }))
      continue
    }
    if (property === null || typeof property !== 'object' || Array.isArray(property)) {
      diagnostics.push(diagnosticOf('T_OBJECT_SHAPE', 'error', `字段 ${key} 不是合法对象叶子`, 'template', { clipKey: clipId, fieldPath: key }))
      continue
    }
    const record = property as JsonObject
    const frames = record.keyframes
    if (def.mode === 'value' && Array.isArray(frames)) {
      diagnostics.push(diagnosticOf('T_VALUE_ONLY_ANIMATED', 'error', `value-only 字段 ${key} 不允许打关键帧`, 'template', { clipKey: clipId, fieldPath: key }))
    }
    if (Array.isArray(frames)) {
      checkKeyframes(key, frames as unknown as ObjectKeyframe[], clipId, diagnostics)
    }
  }
}

function checkKeyframes(
  path: string,
  frames: ObjectKeyframe[],
  clipId: string,
  diagnostics: Diagnostic[],
): void {
  let previous: number | null = null
  for (const frame of frames) {
    if (frame === null || typeof frame !== 'object') {
      diagnostics.push(diagnosticOf('T_KEYFRAME_SHAPE', 'error', `字段 ${path} 存在非法关键帧`, 'template', { clipKey: clipId, fieldPath: path }))
      continue
    }
    if (!finiteNumber(frame.time) || frame.time < 0) {
      diagnostics.push(diagnosticOf('T_KEYFRAME_TIME', 'error', `字段 ${path} 关键帧时间非法: ${String(frame.time)}`, 'template', { clipKey: clipId, fieldPath: path }))
      continue
    }
    if (previous !== null && frame.time <= previous) {
      diagnostics.push(diagnosticOf('T_KEYFRAME_ORDER', 'error', `字段 ${path} 关键帧时间必须严格递增`, 'template', { clipKey: clipId, fieldPath: path }))
    }
    previous = frame.time
    if (frame.value === undefined) {
      diagnostics.push(diagnosticOf('T_KEYFRAME_VALUE', 'error', `字段 ${path} 关键帧缺少值`, 'template', { clipKey: clipId, fieldPath: path }))
    }
  }
}

function checkControlPoint(point: unknown, pathId: string, diagnostics: Diagnostic[], index: number): boolean {
  if (point === null || typeof point !== 'object' || Array.isArray(point)) {
    diagnostics.push(diagnosticOf('T_PATH_CONTROL', 'error', `控制点 ${index} 不是对象`, 'template', { pathId }))
    return false
  }
  const p = point as Record<string, unknown>
  const absolute = [p.x, p.y, p.z].every(finiteNumber)
  const relative = [p.dx, p.dy, p.dz].every(finiteNumber)
  if (!absolute && !relative) {
    diagnostics.push(diagnosticOf('T_PATH_CONTROL', 'error', `控制点 ${index} 必须是完整绝对 {x,y,z} 或相对 {dx,dy,dz} 对象`, 'template', { pathId }))
    return false
  }
  return true
}

function checkPathStructure(path: PathDraft, clipIds: Set<string>, diagnostics: Diagnostic[]): void {
  if (!clipIds.has(path.clip)) {
    diagnostics.push(diagnosticOf('T_PATH_CLIP', 'error', `路径 ${path.id} 引用的片段 ${path.clip} 不在本次产物内`, 'template', { pathId: path.id, clipKey: path.clip }))
  }
  if (!finiteNumber(path.from) || !finiteNumber(path.to) || path.from >= path.to) {
    diagnostics.push(diagnosticOf('T_PATH_TIME', 'error', `路径 ${path.id} 端点时间非法`, 'template', { pathId: path.id }))
  }
  if (path.axes.length === 0 || !path.axes.every((axis) => (PATH_AXES as readonly string[]).includes(axis))) {
    diagnostics.push(diagnosticOf('T_PATH_AXES', 'error', `路径 ${path.id} 轴集合非法`, 'template', { pathId: path.id }))
  }
  const geometryType = typeof path.geometry.type === 'string' ? path.geometry.type : ''
  if (!isKnownGeometryType(geometryType)) {
    diagnostics.push(diagnosticOf('T_PATH_GEOMETRY', 'error', `路径 ${path.id} 几何类型未登记: ${geometryType}`, 'template', { pathId: path.id }))
  }
  if (geometryType === 'bezier') {
    const controls = path.geometry.control_points
    if (!Array.isArray(controls) || controls.length !== 2) {
      diagnostics.push(diagnosticOf('T_PATH_CONTROL', 'error', `路径 ${path.id} 贝塞尔必须有 2 个控制点`, 'template', { pathId: path.id }))
    } else {
      controls.forEach((point, index) => checkControlPoint(point, path.id, diagnostics, index))
    }
  }
}

const TRIGGER_ALLOWED_KEYS = new Set(['id', 'type', 'conditions', 'continuity'])

function checkTriggerStructure(trigger: JsonValue, index: number, diagnostics: Diagnostic[]): void {
  if (trigger === null || typeof trigger !== 'object' || Array.isArray(trigger)) {
    diagnostics.push(diagnosticOf('T_TRIGGER_SHAPE', 'error', `触发器 #${index} 不是对象`, 'template'))
    return
  }
  const record = trigger as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!TRIGGER_ALLOWED_KEYS.has(key)) {
      diagnostics.push(diagnosticOf('T_TRIGGER_FIELD', 'error', `触发器只写声明字段，非法键: ${key}`, 'template', { fieldPath: `triggers[${index}].${key}` }))
    }
  }
  if (typeof record.type !== 'string' || record.type.length === 0) {
    diagnostics.push(diagnosticOf('T_TRIGGER_FIELD', 'error', `触发器 #${index} 缺少类型`, 'template'))
  }
}

/** 草稿内全部路径（片段挂载 + 草稿顶层）。 */
function collectPaths(draft: LayerDraft): PathDraft[] {
  const out: PathDraft[] = [...draft.paths]
  for (const clip of draft.clips) {
    out.push(...clip.paths)
  }
  for (const track of draft.tracks) {
    for (const clip of track.clips) {
      out.push(...clip.paths)
    }
  }
  return out
}

/** 第二层：草稿结构事实校验（字段在册 / value-only 拒帧 / 帧时间 / 路径 / 触发器 / 禁写字段）。 */
export function validateDraftStructure(draft: LayerDraft, catalog: CatalogIndex): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const clips: ClipDraft[] = [...draft.clips]
  for (const track of draft.tracks) {
    clips.push(...track.clips)
  }
  const clipIds = new Set(clips.map((clip) => clip.clipId))
  for (const clip of clips) {
    checkClipStructure(clip, catalog, diagnostics)
  }
  for (const path of collectPaths(draft)) {
    checkPathStructure(path, clipIds, diagnostics)
  }
  draft.triggers.forEach((trigger, index) => checkTriggerStructure(trigger, index, diagnostics))
  return dedupeDiagnostics(diagnostics)
}

// ── 第四层：最终脚本校验（复用既有校验器） ──────────────────────────────────────────

/** 把既有文档与草稿产物拼成一份待校验脚本（克隆，不改请求文档）。 */
export function assembleDraftDoc(requestDoc: ScriptDoc | null, draft: LayerDraft): ScriptDoc {
  const root: JsonObject = requestDoc === null
    ? { meta: { id: 'template', name: 'template', author: '' }, timeline: { tracks: [] } }
    : JSON.parse(JSON.stringify(requestDoc.root)) as JsonObject
  const meta = (root.meta ?? {}) as JsonObject
  if (draft.meta !== undefined) {
    for (const [key, value] of Object.entries(draft.meta)) {
      meta[key] = value
    }
  }
  root.meta = meta

  const timeline = (root.timeline ?? {}) as JsonObject
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks as JsonObject[] : []
  for (const track of draft.tracks) {
    tracks.push({
      type: track.trackType,
      clips: track.clips.map((clip) => ({
        id: clip.clipId,
        start_time: clip.start,
        duration: clip.duration,
        objects: clip.objects,
      })),
    })
  }
  // 片段层草稿：按目标轨型归并到对应轨道，供第四层片段索引与路径引用校验。
  const standaloneByType = new Map<string, JsonObject[]>()
  for (const clip of draft.clips) {
    const list = standaloneByType.get(clip.trackType) ?? []
    list.push({
      id: clip.clipId,
      start_time: clip.start,
      duration: clip.duration,
      objects: clip.objects,
    })
    standaloneByType.set(clip.trackType, list)
  }
  for (const [trackType, clips] of standaloneByType) {
    tracks.push({ type: trackType, clips })
  }
  timeline.tracks = tracks
  root.timeline = timeline

  const existingPaths = Array.isArray(root.paths) ? (root.paths as JsonObject[]) : []
  root.paths = [...existingPaths, ...collectPaths(draft).map((path) => ({
    id: path.id,
    clip: path.clip,
    from: path.from,
    to: path.to,
    axes: [...path.axes],
    geometry: path.geometry,
    ...(path.timing === undefined ? {} : { timing: path.timing }),
  }))]

  if (draft.triggers.length > 0) {
    const existingTriggers = Array.isArray(meta.triggers) ? (meta.triggers as JsonObject[]) : []
    meta.triggers = [...existingTriggers, ...draft.triggers]
  }

  return { root, meta, timeline, authoring: { clips: {}, groups: [] }, clipAuthoring: {} }
}

function mapSeverity(severity: DocIssue['severity']): Diagnostic['severity'] {
  if (severity === 'block' || severity === 'error') {
    return 'error'
  }
  if (severity === 'warn') {
    return 'warning'
  }
  return 'info'
}

/** 第四层：复用 validateStructure 与目录校验；DocIssue 映射为诊断。 */
export function validateAssembledDoc(doc: ScriptDoc, catalog: CatalogIndex, templateId: string): Diagnostic[] {
  const registry = new ClipRegistry()
  registry.sync(doc)
  const issues = validateStructure(doc, { catalog, metaKeys: metaKeys(catalog), registry })
  const diagnostics = issues.map((issue) => diagnosticOf(
    issue.code,
    mapSeverity(issue.severity),
    issue.message,
    'document',
    {
      templateId,
      clipKey: issue.clipKey,
      fieldPath: issue.jsonPath,
      detail: issue.objectPath,
    },
  ))
  return dedupeDiagnostics(diagnostics)
}

// 保持几何类型名单引用（便于后续扩展几何专属诊断）。
void PATH_GEOMETRY_TYPES
