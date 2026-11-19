/**
 * 字幕面板纯视图模型（12-15）：禁用态 / 行筛选 / 摘要数字。
 *
 * 面板组件只渲染这里算好的视图状态；不在这里发命令、不读会话缓存。
 */
import type { CueRow, RowStatus, SubtitleTrackInfo } from './cues.ts'

/** 面板工具栏禁用态。 */
export interface PanelDisabledState {
  importDisabled: boolean
  reimportDisabled: boolean
  compileDisabled: boolean
  moveDisabled: boolean
  deleteDisabled: boolean
  editTimeDisabled: boolean
}

/** 底部摘要数字。 */
export interface SubtitleSummary {
  total: number
  selected: number
  draft: number
  errors: number
  overlap: number
  conflict: number
  emptyText: number
  lowVisibility: number
}

/** 文档未打开 / 无内容时的禁用态。 */
export function panelDisabledState(input: {
  docOpen: boolean
  hasCompiledRows: boolean
  selectedCount: number
  hasDraftCues: boolean
}): PanelDisabledState {
  const noDoc = !input.docOpen
  return {
    importDisabled: noDoc,
    reimportDisabled: noDoc || !input.hasCompiledRows,
    compileDisabled: noDoc || (!input.hasCompiledRows && !input.hasDraftCues),
    moveDisabled: noDoc || input.selectedCount === 0,
    deleteDisabled: noDoc || input.selectedCount === 0,
    editTimeDisabled: noDoc || input.selectedCount !== 1,
  }
}

/** 按状态计数。 */
function countStatus(rows: readonly CueRow[], status: RowStatus): number {
  return rows.filter((row) => row.statuses.includes(status)).length
}

/** 汇总 cue 表数字。 */
export function summarizeRows(rows: readonly CueRow[], selectedIds: ReadonlySet<string>): SubtitleSummary {
  return {
    total: rows.length,
    selected: rows.filter((row) => selectedIds.has(row.cueId)).length,
    draft: rows.filter((row) => row.draft).length,
    errors: rows.filter((row) => row.issue !== undefined).length,
    overlap: countStatus(rows, 'overlap'),
    conflict: countStatus(rows, 'conflict'),
    emptyText: countStatus(rows, 'empty-text'),
    lowVisibility: countStatus(rows, 'low-visibility'),
  }
}

/** 筛选条件。 */
export interface CueFilter {
  query: string
  selectedTracks: ReadonlySet<number> | null
}

/** 文本 / 轨道筛选；`selectedTracks=null` 表示全选。 */
export function filterCueRows(rows: readonly CueRow[], filter: CueFilter): CueRow[] {
  const query = filter.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter.selectedTracks !== null && row.trackIndex !== null && !filter.selectedTracks.has(row.trackIndex)) {
      return false
    }
    if (query.length === 0) return true
    return row.text.toLowerCase().includes(query) || String(row.start).includes(query)
  })
}

/** 轨道勾选条视图。 */
export interface TrackCheckView {
  trackIndex: number
  trackId: string
  name: string
  kind: SubtitleTrackInfo['kind']
  cueCount: number
  timeRange: { start: number; end: number } | null
  checked: boolean
}

/** 轨道勾选条模型：默认全选。 */
export function trackCheckViews(
  tracks: readonly SubtitleTrackInfo[],
  checked: ReadonlySet<number> | null,
  rows: readonly CueRow[],
): TrackCheckView[] {
  return tracks
    .filter((track) => track.kind === 'pure-subtitle' || track.kind === 'mixed-subtitle' || track.kind === 'empty-overlay')
    .map((track) => {
      const trackRows = rows.filter((row) => row.trackIndex === track.trackIndex)
      const start = trackRows.reduce((min, row) => Math.min(min, row.start), Number.POSITIVE_INFINITY)
      const end = trackRows.reduce((max, row) => Math.max(max, row.end), Number.NEGATIVE_INFINITY)
      return {
        trackIndex: track.trackIndex,
        trackId: track.trackId,
        name: track.name,
        kind: track.kind,
        cueCount: trackRows.length,
        timeRange: Number.isFinite(start) ? { start, end } : null,
        checked: checked === null || checked.has(track.trackIndex),
      }
    })
}

/** 换行在表内显示成可见符号（不做富文本）。 */
export function lineBreakSymbol(text: string): string {
  return text.replace(/\n/g, ' ↵ ')
}
