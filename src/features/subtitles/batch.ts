/**
 * 字幕批次命令计划（12-13）：批量移动 / 删除 / 单条时间编辑 / 重导入 diff。
 *
 * 约束：
 * - 所有写入走 `DocCommand`，一次事务一次撤销；失败零残留（命令层整串回滚）；
 * - 批量移动：同移；越界或同轨重叠汇总报错，不提交；
 * - 批量删除：删片段不删轨；
 * - 重导入 diff：时间容差 + 区间重叠 = 时间匹配；去标记去首尾空白完全相同 = 文本匹配；
 *   默认保留手改、不删缺失，作者确认后应用。
 *
 * 本模块只产出命令计划与诊断，不直接提交 store。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { CueRow, SubtitleTrackInfo } from './cues.ts'
import { intervalsOverlap } from './cues.ts'
import type { ParsedCue } from './parse.ts'
import { normalizeComparableText } from './parse.ts'

/** 命令计划通用结果。 */
export interface CommandPlan {
  commands: DocCommand[]
  blockers: string[]
  warnings: string[]
}

function emptyPlan(): CommandPlan {
  return { commands: [], blockers: [], warnings: [] }
}

/** 行是否已编译（有片段键）。 */
function compiledRow(row: CueRow): row is CueRow & { clipKey: string } {
  return row.clipKey !== null
}

// ── 批量移动 ──────────────────────────────────────────────────────────────────────

/**
 * 批量同移计划。
 *
 * 预检：每条移动后起点 ≥ 0；同轨内不与其他片段重叠。任一不通过 → 汇总报错、命令为空。
 */
export function planBatchMove(
  rows: readonly CueRow[],
  delta: number,
  tracks: readonly SubtitleTrackInfo[],
): CommandPlan {
  const plan = emptyPlan()
  if (!Number.isFinite(delta)) {
    plan.blockers.push('移动偏移必须是有限数字')
    return plan
  }
  const targets = rows.filter(compiledRow)
  if (targets.length === 0) {
    plan.blockers.push('没有可移动的已编译 cue')
    return plan
  }

  for (const row of targets) {
    const newStart = row.start + delta
    if (newStart < 0) {
      plan.blockers.push(`「${row.cueId}」移动后起点小于 0`)
      continue
    }
    const newEnd = row.end + delta
    for (const other of targets) {
      if (other.cueId === row.cueId || other.trackIndex !== row.trackIndex) continue
      if (intervalsOverlap(newStart, newEnd, other.start, other.end)) {
        plan.blockers.push(`「${row.cueId}」移动后与同轨片段「${other.cueId}」重叠`)
      }
    }
  }
  // 跨轨片段也纳入同轨重叠比对（未移动的既有片段）。
  for (const row of targets) {
    const newStart = row.start + delta
    const newEnd = row.end + delta
    for (const track of tracks) {
      if (track.trackIndex !== row.trackIndex) continue
      for (const clip of track.clips) {
        if (clip.clipKey === row.clipKey) continue
        if (intervalsOverlap(newStart, newEnd, clip.start, clip.start + clip.duration)) {
          plan.blockers.push(`「${row.cueId}」移动后与同轨片段「${clip.clipKey}」重叠`)
        }
      }
    }
  }

  if (plan.blockers.length > 0) return plan
  plan.commands.push({
    kind: 'timeline.moveClips',
    clipKeys: targets.map((row) => row.clipKey),
    deltaSeconds: delta,
  })
  return plan
}

// ── 批量删除 ──────────────────────────────────────────────────────────────────────

/**
 * 批量删除计划：删片段不删轨。被引用片段由命令层拒绝并整串回滚。
 */
export function planBatchDelete(rows: readonly CueRow[]): CommandPlan {
  const plan = emptyPlan()
  const targets = rows.filter(compiledRow)
  if (targets.length === 0) {
    plan.blockers.push('没有可删除的已编译 cue')
    return plan
  }
  for (const row of targets) {
    plan.commands.push({ kind: 'clip.remove', clipKey: row.clipKey })
  }
  return plan
}

// ── 单条时间编辑 ───────────────────────────────────────────────────────────────────

/** 单条时间编辑计划（开始 / 时长）；预检越界与同轨重叠。 */
export function planTimeEdit(
  row: CueRow,
  start: number,
  end: number,
  rows: readonly CueRow[],
): CommandPlan {
  const plan = emptyPlan()
  if (!compiledRow(row)) {
    plan.blockers.push('草稿 cue 请先编译后再编辑时间')
    return plan
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    plan.blockers.push('开始 / 结束时间必须是有限数字')
    return plan
  }
  if (start < 0) {
    plan.blockers.push('开始时间不能小于 0')
  }
  if (end <= start) {
    plan.blockers.push('结束时间必须晚于开始时间')
  }
  for (const other of rows) {
    if (other.cueId === row.cueId || other.trackIndex !== row.trackIndex) continue
    if (intervalsOverlap(start, end, other.start, other.end)) {
      plan.blockers.push(`与同轨片段「${other.cueId}」重叠`)
    }
  }
  if (plan.blockers.length > 0) return plan

  plan.commands.push({ kind: 'clip.setStart', clipKey: row.clipKey, value: start })
  plan.commands.push({ kind: 'clip.setDuration', clipKey: row.clipKey, value: end - start })
  return plan
}

// ── 新建空 cue（草稿，待编译） ─────────────────────────────────────────────────────

/** 默认新建空 cue 时长（秒）。 */
export const EMPTY_CUE_DEFAULT_DURATION = 2

/**
 * 生成一条新建空 cue 草稿：播放头起点、默认两秒、空文本标记。
 * 不复制 09-08 预设的默认布局值；布局在编译时按预设补齐。
 */
export function makeEmptyDraftCue(input: { playhead: number; duration?: number; ordinal: number }): ParsedCue {
  const start = Number.isFinite(input.playhead) && input.playhead >= 0 ? input.playhead : 0
  const duration = input.duration ?? EMPTY_CUE_DEFAULT_DURATION
  return {
    ordinal: input.ordinal,
    start,
    end: start + duration,
    text: '',
    sourceText: '',
    format: 'srt',
    error: '文本为空',
    warnings: ['新建空 cue：编译时跳过，可先补文本'],
  }
}

// ── 重导入 diff ────────────────────────────────────────────────────────────────────

/** diff 分类。 */
export type DiffCategory = 'unchanged' | 'changed' | 'added' | 'missing'

/** 一条 diff 条目。 */
export interface DiffEntry {
  category: DiffCategory
  cueId: string | null
  ordinal: number
  incoming?: ParsedCue
  existing?: CueRow
  timeMatch: boolean
  textMatch: boolean
}

/** 时间匹配容差（秒）。 */
export const DIFF_TIME_TOLERANCE = 0.05

/**
 * 重导入分类：时间容差 + 区间重叠 = 时间匹配；去标记去首尾空白完全相同 = 文本匹配。
 * - 时间 + 文本都匹配 → `unchanged`；
 * - 仅时间匹配 → `changed`（默认保留手改，不覆盖）；
 * - 未匹配上的新文件 cue → `added`；
 * - 既有未匹配 → `missing`（默认不删，作者确认后应用）。
 */
export function planReimportDiff(input: {
  incoming: readonly ParsedCue[]
  existing: readonly CueRow[]
  timeTolerance?: number
}): DiffEntry[] {
  const tolerance = input.timeTolerance ?? DIFF_TIME_TOLERANCE
  const entries: DiffEntry[] = []
  const usedExisting = new Set<string>()

  for (const cue of input.incoming) {
    let best: CueRow | null = null
    let bestTimeMatch = false
    for (const row of input.existing) {
      if (usedExisting.has(row.cueId)) continue
      const timeMatch =
        Math.abs(cue.start - row.start) <= tolerance
        && intervalsOverlap(cue.start, cue.end, row.start, row.end)
      if (!timeMatch) continue
      if (best === null || Math.abs(cue.start - row.start) < Math.abs(best.start - row.start)) {
        best = row
        bestTimeMatch = true
      }
    }
    if (best === null) {
      entries.push({ category: 'added', cueId: null, ordinal: cue.ordinal, incoming: cue, timeMatch: false, textMatch: false })
      continue
    }
    usedExisting.add(best.cueId)
    const textMatch = normalizeComparableText(cue.text) === normalizeComparableText(best.text)
    entries.push({
      category: textMatch ? 'unchanged' : 'changed',
      cueId: best.cueId,
      ordinal: cue.ordinal,
      incoming: cue,
      existing: best,
      timeMatch: bestTimeMatch,
      textMatch,
    })
  }

  for (const row of input.existing) {
    if (usedExisting.has(row.cueId)) continue
    entries.push({ category: 'missing', cueId: row.cueId, ordinal: 0, existing: row, timeMatch: false, textMatch: false })
  }

  return entries.sort((a, b) => a.ordinal - b.ordinal || (a.existing?.start ?? 0) - (b.existing?.start ?? 0))
}
