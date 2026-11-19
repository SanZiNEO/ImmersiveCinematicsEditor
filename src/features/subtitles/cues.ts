/**
 * 字幕批次模型（12-13）：从时间轴轨道实时派生 cue 表与打包计划。
 *
 * 约束：
 * - 批次 = 选定的字幕轨道集合（不落盘、无批次 id）；
 * - cue 表从轨道内字幕片段实时派生；
 * - 字幕轨判据：覆盖层轨且轨内片段全是字幕；空轨可选；混合轨只读字幕片段 + 警告；
 * - 打包：按开始升序，第一条「最后结束不晚于当前开始」可接；无可用就新建覆盖层轨追加在
 *   现有字幕轨后；同轨不重叠；轨道过多只警告。
 *
 * 本模块是纯函数，不写文档；命令计划在 `batch.ts` / `compile.ts`。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import { effectiveLayerType, explicitValue } from '../overlay/layers.ts'
import { splitSubtitleLines, subtitleInvisible, subtitleTextOf } from '../overlay/subtitle.ts'
import type { ParsedCue } from './parse.ts'

/** 轨道内一条片段的只读输入（面板 / 自检从文档视图组装）。 */
export interface RawSubtitleClip {
  clipKey: string
  start: number
  duration: number
  objects: JsonObject
}

/** 轨道只读输入。 */
export interface RawTrack {
  type: string
  name?: string
  clips: RawSubtitleClip[]
}

/** 轨道分类。 */
export type SubtitleTrackKind = 'pure-subtitle' | 'mixed-subtitle' | 'empty-overlay' | 'other'

/** 派生后的字幕轨道信息。 */
export interface SubtitleTrackInfo {
  trackIndex: number
  /** `type#index` 形态身份。 */
  trackId: string
  /** 轨道 wire 类型（`OVERLAY` / `CAMERA` / …）。 */
  type: string
  name: string
  kind: SubtitleTrackKind
  clips: RawSubtitleClip[]
  warnings: string[]
}

/** 行状态标记。 */
export type RowStatus = 'overlap' | 'empty-text' | 'conflict' | 'low-visibility'

/** cue 表一行（已编译片段或草稿 cue）。 */
export interface CueRow {
  /** 稳定身份：已编译 = clipKey；草稿 = `draft#<ordinal>`。 */
  cueId: string
  clipKey: string | null
  trackIndex: number | null
  start: number
  end: number
  duration: number
  text: string
  lines: number
  statuses: RowStatus[]
  draft: boolean
  issue?: string
}

/** 两条区间是否重叠（半开区间 `[start, end)`）。 */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** 读片段显式 opacity；缺失按运行时补齐值 1（不报低可见度）。 */
function opacityOf(objects: JsonObject): number {
  const explicit = explicitValue(objects, 'opacity')
  if (!explicit.present || typeof explicit.value !== 'number' || !Number.isFinite(explicit.value)) {
    return 1
  }
  return explicit.value
}

/** 一条片段是否为字幕层（有效层类型 = subtitle）。 */
export function isSubtitleClip(objects: JsonObject): boolean {
  return effectiveLayerType(objects) === 'subtitle'
}

/** 分类轨道。 */
export function classifyTrack(track: RawTrack, trackIndex: number): SubtitleTrackInfo {
  const warnings: string[] = []
  const trackId = `${track.type}#${trackIndex}`
  const name = typeof track.name === 'string' && track.name.length > 0 ? track.name : `轨道 ${trackIndex + 1}`

  if (track.type !== 'OVERLAY') {
    return { trackIndex, trackId, type: track.type, name, kind: 'other', clips: [], warnings }
  }
  if (track.clips.length === 0) {
    return { trackIndex, trackId, type: track.type, name, kind: 'empty-overlay', clips: [], warnings }
  }
  const subtitleClips = track.clips.filter((clip) => isSubtitleClip(clip.objects))
  if (subtitleClips.length === track.clips.length) {
    return { trackIndex, trackId, type: track.type, name, kind: 'pure-subtitle', clips: subtitleClips, warnings }
  }
  if (subtitleClips.length === 0) {
    return { trackIndex, trackId, type: track.type, name, kind: 'other', clips: [], warnings }
  }
  warnings.push('混合轨：只读取字幕片段，非字幕片段不参与字幕编译与删除')
  return { trackIndex, trackId, type: track.type, name, kind: 'mixed-subtitle', clips: subtitleClips, warnings }
}

/** 全量派生轨道信息。 */
export function deriveTracks(tracks: readonly RawTrack[]): SubtitleTrackInfo[] {
  return tracks.map((track, index) => classifyTrack(track, index))
}

/** 单条片段 → cue 行（不含跨条状态；状态由 `deriveCueRows` 统一标注）。 */
function rowFromClip(clip: RawSubtitleClip, track: SubtitleTrackInfo): CueRow {
  const text = subtitleTextOf(clip.objects)
  const opacity = opacityOf(clip.objects)
  const statuses: RowStatus[] = []
  if (text.trim() === '') statuses.push('empty-text')
  if (subtitleInvisible(opacity).invisible) statuses.push('low-visibility')
  return {
    cueId: clip.clipKey,
    clipKey: clip.clipKey,
    trackIndex: track.trackIndex,
    start: clip.start,
    end: clip.start + clip.duration,
    duration: clip.duration,
    text,
    lines: splitSubtitleLines(text).length,
    statuses,
    draft: false,
  }
}

/**
 * 从轨道派生 cue 表（实时计算，不缓存文档副本）。
 *
 * 状态标注：同轨重叠 = `overlap`；跨轨同时段 = `conflict`；空文本 / 低可见度按片段字段。
 */
export function deriveCueRows(tracks: readonly RawTrack[]): CueRow[] {
  const infos = deriveTracks(tracks)
  const rows: CueRow[] = []
  for (const track of infos) {
    if (track.kind !== 'pure-subtitle' && track.kind !== 'mixed-subtitle') continue
    for (const clip of track.clips) {
      rows.push(rowFromClip(clip, track))
    }
  }

  for (const row of rows) {
    for (const other of rows) {
      if (row.cueId === other.cueId) continue
      if (!intervalsOverlap(row.start, row.end, other.start, other.end)) continue
      if (row.trackIndex === other.trackIndex) {
        if (!row.statuses.includes('overlap')) row.statuses.push('overlap')
      } else if (!row.statuses.includes('conflict')) {
        row.statuses.push('conflict')
      }
    }
  }
  return rows.sort((a, b) => a.start - b.start || a.end - b.end)
}

// ── 打包计划（草稿 cue → 目标轨道） ────────────────────────────────────────────────

/** 一条打包分配。 */
export interface PackAssignment {
  cueOrdinal: number
  /** 目标轨道索引；新建轨时为新轨在最终轨道数组中的索引。 */
  trackIndex: number
  createNew: boolean
}

/** 打包计划。 */
export interface PackPlan {
  assignments: PackAssignment[]
  warnings: string[]
  /** 本次打包需要新建的覆盖层轨数量。 */
  newTrackCount: number
}

/** 打包轨道数警告阈值（超过只警告，不拒绝）。 */
export const PACK_MAX_TRACKS = 8

/**
 * 贪心打包：cue 按开始升序；优先接进既有纯字幕轨（最后结束 ≤ 当前开始）；
 * 无可用就新建覆盖层轨，追加在现有字幕轨之后；同轨不重叠。
 */
export function planPackCues(input: {
  cues: readonly ParsedCue[]
  tracks: readonly RawTrack[]
  maxTracks?: number
}): PackPlan {
  const { cues, tracks } = input
  const maxTracks = input.maxTracks ?? PACK_MAX_TRACKS
  const infos = deriveTracks(tracks)
  const eligible = infos.filter((track) => track.kind === 'pure-subtitle')
  const lastEnd = eligible.map((track) =>
    track.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0),
  )
  const subtitleTrackCount = infos.filter(
    (track) => track.kind === 'pure-subtitle' || track.kind === 'mixed-subtitle',
  ).length

  const ordered = cues
    .map((cue) => ({ cue }))
    .sort((a, b) => {
      const aStart = Number.isFinite(a.cue.start) ? a.cue.start : Number.POSITIVE_INFINITY
      const bStart = Number.isFinite(b.cue.start) ? b.cue.start : Number.POSITIVE_INFINITY
      return aStart - bStart || a.cue.ordinal - b.cue.ordinal
    })

  const assignments: PackAssignment[] = []
  let created = 0
  const newTrackLastEnd: number[] = []

  for (const { cue } of ordered) {
    const start = Number.isFinite(cue.start) ? cue.start : 0
    const end = Number.isFinite(cue.end) && cue.end > start ? cue.end : start
    let assigned = eligible.findIndex((_, trackIndex) => lastEnd[trackIndex] <= start)
    if (assigned >= 0) {
      lastEnd[assigned] = end
      assignments.push({ cueOrdinal: cue.ordinal, trackIndex: eligible[assigned].trackIndex, createNew: false })
      continue
    }
    const newIndex = newTrackLastEnd.findIndex((value) => value <= start)
    if (newIndex >= 0) {
      newTrackLastEnd[newIndex] = end
      const trackIndex = tracks.length + newIndex
      assignments.push({ cueOrdinal: cue.ordinal, trackIndex, createNew: true })
      continue
    }
    newTrackLastEnd.push(end)
    created += 1
    assignments.push({ cueOrdinal: cue.ordinal, trackIndex: tracks.length + newTrackLastEnd.length - 1, createNew: true })
  }

  const warnings: string[] = []
  const totalTracks = subtitleTrackCount + created
  if (totalTracks > maxTracks) {
    warnings.push(`打包后字幕轨道 ${totalTracks} 条，超过建议上限 ${maxTracks} 条（仅警告，不自动合并）`)
  }
  return { assignments, warnings, newTrackCount: created }
}
