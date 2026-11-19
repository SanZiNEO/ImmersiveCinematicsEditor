/**
 * 装配（12-01 §五 / 12-11 第三层）：目标轨道 / 插入点 / 起点 / 重叠检查 / id 分配 / 命令生成。
 *
 * 片段层选目标轨道 + 插入点；轨道层新建或追加（追加接最后一条有限片段末端，任一重叠整次拒绝）；
 * 脚本层仅新建文档 / 空文档替换。一次应用一个文档事务；失败零残留由命令层事务保证。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import { diagnosticOf, type Diagnostic } from '../generation/diagnostics.ts'
import type {
  GenerationRequest,
  InsertTarget,
  StructureSummary,
  TemplateDefinition,
} from './types.ts'
import type { ClipDraft, InternalTemplate, LayerDraft, PathDraft, TrackDraft } from './model.ts'

interface ExistingClip {
  clipKey: string
  start: number
  end: number
}

interface ResolvedTrack {
  trackIndex: number
  trackType: string
  existing: ExistingClip[]
  createsTrack: boolean
  baseTime: number
}

function trackIdOf(type: string, index: number): string {
  return `${type}#${index}`
}

function clipsOfTrack(track: JsonObject): ExistingClip[] {
  const clips = track.clips
  if (!Array.isArray(clips)) {
    return []
  }
  const out: ExistingClip[] = []
  clips.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return
    }
    const clip = raw as JsonObject
    const start = typeof clip.start_time === 'number' && Number.isFinite(clip.start_time) ? clip.start_time : 0
    const duration = typeof clip.duration === 'number' && Number.isFinite(clip.duration) ? clip.duration : 0
    const clipKey = typeof clip.id === 'string' && clip.id.length > 0 ? clip.id : `track#${index}`
    out.push({ clipKey, start, end: start + duration })
  })
  return out
}

function existingTracks(doc: ScriptDoc | null): Array<{ index: number; type: string; clips: ExistingClip[] }> {
  if (doc === null) {
    return []
  }
  const tracks = doc.timeline.tracks
  if (!Array.isArray(tracks)) {
    return []
  }
  const out: Array<{ index: number; type: string; clips: ExistingClip[] }> = []
  tracks.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return
    }
    const track = raw as JsonObject
    out.push({ index, type: typeof track.type === 'string' ? track.type : '', clips: clipsOfTrack(track) })
  })
  return out
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function docIsEmpty(doc: ScriptDoc | null): boolean {
  if (doc === null) {
    return true
  }
  if (existingTracks(doc).some((track) => track.clips.length > 0)) {
    return false
  }
  const root = doc.root
  const standalone = root.clips
  if (Array.isArray(standalone) && standalone.length > 0) {
    return false
  }
  const paths = root.paths
  if (Array.isArray(paths) && paths.length > 0) {
    return false
  }
  const triggers = doc.meta.triggers
  if (Array.isArray(triggers) && triggers.length > 0) {
    return false
  }
  return true
}

function resolveTrack(
  def: TemplateDefinition,
  target: InsertTarget,
  doc: ScriptDoc | null,
  playhead: number,
  selectedClipKeys: readonly string[],
): { resolved: ResolvedTrack | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const tracks = existingTracks(doc)
  const targetTypes = def.targetTrackTypes
  const firstType = targetTypes[0] ?? ''

  const byId = (trackId: string): { index: number; type: string; clips: ExistingClip[] } | null => {
    const hash = trackId.lastIndexOf('#')
    if (hash <= 0) {
      return null
    }
    const type = trackId.slice(0, hash)
    const index = Number(trackId.slice(hash + 1))
    const found = tracks.find((track) => track.index === index && track.type === type)
    return found ?? null
  }

  switch (target.mode) {
    case 'newTrack': {
      return {
        resolved: { trackIndex: tracks.length, trackType: firstType, existing: [], createsTrack: true, baseTime: 0 },
        diagnostics,
      }
    }
    case 'appendTrack': {
      const found = tracks.find((track) => targetTypes.includes(track.type))
      if (found === undefined) {
        return {
          resolved: { trackIndex: tracks.length, trackType: firstType, existing: [], createsTrack: true, baseTime: 0 },
          diagnostics,
        }
      }
      const lastEnd = found.clips.reduce((max, clip) => Math.max(max, clip.end), 0)
      return {
        resolved: { trackIndex: found.index, trackType: found.type, existing: found.clips, createsTrack: false, baseTime: lastEnd },
        diagnostics,
      }
    }
    case 'atTime':
    case 'atPlayhead': {
      const time = target.mode === 'atTime' ? (target.time ?? 0) : playhead
      if (!Number.isFinite(time) || time < 0) {
        diagnostics.push(diagnosticOf('T_TARGET_TIME_INVALID', 'error', '插入时间非法（须为非负有限秒数）', 'template', { templateId: def.id }))
        return { resolved: null, diagnostics }
      }
      let found: { index: number; type: string; clips: ExistingClip[] } | undefined
      if (target.trackId !== undefined) {
        found = byId(target.trackId) ?? undefined
        if (found === undefined) {
          diagnostics.push(diagnosticOf('T_TARGET_TRACK_MISSING', 'error', `指定轨道 ${target.trackId} 不存在`, 'template', { templateId: def.id, trackId: target.trackId }))
          return { resolved: null, diagnostics }
        }
        if (!targetTypes.includes(found.type)) {
          diagnostics.push(diagnosticOf('T_TARGET_LAYER_MISMATCH', 'error', `轨道 ${found.type} 与模板目标类型 ${targetTypes.join('/')} 不匹配`, 'template', { templateId: def.id, trackId: trackIdOf(found.type, found.index) }))
          return { resolved: null, diagnostics }
        }
      } else {
        found = tracks.find((track) => targetTypes.includes(track.type))
        if (found === undefined) {
          diagnostics.push(diagnosticOf('T_TARGET_TRACK_MISSING', 'error', `没有可放入 ${targetTypes.join('/')} 的现有轨道，请新建轨道`, 'template', { templateId: def.id }))
          return { resolved: null, diagnostics }
        }
      }
      return {
        resolved: { trackIndex: found.index, trackType: found.type, existing: found.clips, createsTrack: false, baseTime: time },
        diagnostics,
      }
    }
    case 'afterSelection': {
      const selected = selectedClipKeys[0]
      if (selected === undefined) {
        diagnostics.push(diagnosticOf('T_TARGET_SELECTION_MISSING', 'error', '未选中片段：无法在其后插入', 'template', { templateId: def.id }))
        return { resolved: null, diagnostics }
      }
      const foundTrack = tracks.find((track) => track.clips.some((clip) => clip.clipKey === selected))
      if (foundTrack === undefined) {
        diagnostics.push(diagnosticOf('T_TARGET_TRACK_MISSING', 'error', `选中片段 ${selected} 所在轨道不存在`, 'template', { templateId: def.id, clipKey: selected }))
        return { resolved: null, diagnostics }
      }
      if (!targetTypes.includes(foundTrack.type)) {
        diagnostics.push(diagnosticOf('T_TARGET_LAYER_MISMATCH', 'error', `选中轨道 ${foundTrack.type} 与模板目标类型不匹配`, 'template', { templateId: def.id, trackId: trackIdOf(foundTrack.type, foundTrack.index) }))
        return { resolved: null, diagnostics }
      }
      const selectedClip = foundTrack.clips.find((clip) => clip.clipKey === selected)
      const baseTime = selectedClip?.end ?? playhead
      return {
        resolved: { trackIndex: foundTrack.index, trackType: foundTrack.type, existing: foundTrack.clips, createsTrack: false, baseTime },
        diagnostics,
      }
    }
    case 'newDocument':
    default: {
      diagnostics.push(diagnosticOf('T_TARGET_MODE_INVALID', 'error', '目标模式与模板层不匹配', 'template', { templateId: def.id }))
      return { resolved: null, diagnostics }
    }
  }
}

function clipJson(clip: ClipDraft, start: number): JsonObject {
  const out: JsonObject = {
    id: clip.clipId,
    start_time: start,
    duration: clip.duration,
    objects: clip.objects,
  }
  return out
}

export interface AssemblyOutcome {
  ok: boolean
  commands: DocCommand[]
  summary: StructureSummary
  diagnostics: Diagnostic[]
  selectedClipKeys: string[]
}

/**
 * 把展开草稿装配成一次事务命令序列。失败时 `commands` 为空、诊断带 error。
 */
export function planAssembly(
  internal: InternalTemplate,
  draft: LayerDraft,
  request: GenerationRequest,
  catalog: CatalogIndex,
): AssemblyOutcome {
  const def = internal.def
  const diagnostics: Diagnostic[] = []
  const notes: string[] = []
  const commands: DocCommand[] = []
  const conflicts: StructureSummary['conflicts'] = []
  void catalog

  const allClips: ClipDraft[] = [...draft.clips]
  for (const track of draft.tracks) {
    allClips.push(...track.clips)
  }

  // ── 脚本层：仅新建文档；非空文档整次拒绝。 ──
  if (def.layer === 'script') {
    if (request.target.mode !== 'newDocument') {
      diagnostics.push(diagnosticOf('T_SCRIPT_TARGET', 'error', '脚本模板只能以新建文档方式应用', 'template', { templateId: def.id }))
    } else if (!docIsEmpty(request.doc)) {
      diagnostics.push(diagnosticOf('T_DOC_NON_EMPTY', 'error', '脚本模板不覆盖非空文档：请先新建空文档', 'template', { templateId: def.id }))
    }
    if (diagnostics.some((item) => item.severity === 'error')) {
      return failOutcome(def, draft, diagnostics, notes)
    }
    if (draft.meta !== undefined) {
      for (const [key, value] of Object.entries(draft.meta)) {
        commands.push({ kind: 'meta.set', key, value })
      }
    }
    let trackIndex = 0
    for (const track of draft.tracks) {
      commands.push({ kind: 'timeline.addTrack', type: track.trackType })
      for (const clip of track.clips) {
        commands.push({ kind: 'clip.add', trackIndex, clip: clipJson(clip, clip.start) })
      }
      trackIndex += 1
    }
    const draftPaths = collectPaths(draft)
    if (draftPaths.length > 0) {
      commands.push({ kind: 'path.writeBatch', removeIds: [], entries: draftPaths.map(pathEntryJson) })
    }
    draft.triggers.forEach((fields, index) => {
      commands.push({ kind: 'trigger.add', index, fields })
    })
    const summary = summarize(def, draft, { createsTrack: false, createsDocument: true, conflicts, notes })
    return { ok: true, commands, summary, diagnostics, selectedClipKeys: allClips.map((clip) => clip.clipId) }
  }

  // ── 片段 / 轨道层：解析目标轨道并做重叠检查。 ──
  const { resolved, diagnostics: targetDiagnostics } = resolveTrack(
    def,
    request.target,
    request.doc,
    request.playhead,
    request.selectedClipKeys,
  )
  diagnostics.push(...targetDiagnostics)
  if (resolved === null) {
    return failOutcome(def, draft, diagnostics, notes)
  }

  // 轨道层草稿归并到目标轨道；片段层草稿直接放目标轨道。
  const placement: Array<{ clip: ClipDraft; start: number }> = []
  if (def.layer === 'track') {
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        placement.push({ clip, start: resolved.baseTime + clip.start })
      }
    }
  } else {
    for (const clip of draft.clips) {
      placement.push({ clip, start: resolved.baseTime + clip.start })
    }
  }

  for (const item of placement) {
    const end = item.start + item.clip.duration
    for (const existing of resolved.existing) {
      if (overlaps(item.start, end, existing.start, existing.end)) {
        conflicts.push({ clipKey: existing.clipKey, start: existing.start, end: existing.end })
        diagnostics.push(diagnosticOf(
          'T_OVERLAP', 'error',
          `新片段 [${item.start}, ${end}) 与现有片段 ${existing.clipKey} [${existing.start}, ${existing.end}) 重叠`,
          'template', { templateId: def.id, clipKey: item.clip.clipId, trackId: trackIdOf(resolved.trackType, resolved.trackIndex) },
        ))
      }
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) {
    return failOutcome(def, draft, diagnostics, notes)
  }

  if (resolved.createsTrack) {
    commands.push({ kind: 'timeline.addTrack', type: resolved.trackType })
  }
  for (const item of placement) {
    commands.push({ kind: 'clip.add', trackIndex: resolved.trackIndex, clip: clipJson(item.clip, item.start) })
  }
  const draftPaths = collectPaths(draft)
  if (draftPaths.length > 0) {
    commands.push({ kind: 'path.writeBatch', removeIds: [], entries: draftPaths.map(pathEntryJson) })
  }

  const summary = summarize(def, draft, {
    createsTrack: resolved.createsTrack,
    createsDocument: false,
    conflicts,
    notes,
  })
  return {
    ok: true,
    commands,
    summary,
    diagnostics,
    selectedClipKeys: placement.map((item) => item.clip.clipId),
  }
}

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

function pathEntryJson(path: LayerDraft['paths'][number]): JsonObject {
  const entry: JsonObject = {
    id: path.id,
    clip: path.clip,
    from: path.from,
    to: path.to,
    axes: [...path.axes],
    geometry: path.geometry,
  }
  if (path.timing !== undefined) {
    entry.timing = path.timing
  }
  return entry
}

function summarize(
  def: TemplateDefinition,
  draft: LayerDraft,
  flags: { createsTrack: boolean; createsDocument: boolean; conflicts: StructureSummary['conflicts']; notes: string[] },
): StructureSummary {
  const clips: ClipDraft[] = [...draft.clips]
  for (const track of draft.tracks) {
    clips.push(...track.clips)
  }
  const segments = clips.map((clip) => ({ start: clip.start, duration: clip.duration }))
  const totalDuration = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0)
  return {
    clipCount: clips.length,
    trackCount: draft.tracks.length,
    pathCount: collectPaths(draft).length,
    triggerCount: draft.triggers.length,
    totalDuration,
    segments,
    targetTrackTypes: def.targetTrackTypes,
    createsTrack: flags.createsTrack,
    createsDocument: flags.createsDocument,
    conflicts: flags.conflicts,
    notes: flags.notes,
  }
}

function failOutcome(
  def: TemplateDefinition,
  draft: LayerDraft,
  diagnostics: Diagnostic[],
  notes: string[],
): AssemblyOutcome {
  const summary = summarize(def, draft, { createsTrack: false, createsDocument: false, conflicts: [], notes })
  return { ok: false, commands: [], summary, diagnostics, selectedClipKeys: [] }
}
