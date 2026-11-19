<script setup lang="ts">
/**
 * 字幕面板（12-15，插件 `core.subtitles`，面板 `subtitles`）。
 *
 * 职责：导入向导（七步，宿主本面板）、轨道勾选条、cue 表（虚拟滚动 / 吸顶表头 /
 * 双击跳字幕字段）、批量移动 / 删除、单条时间编辑、重导入冲突面板、编译（草稿 /
 * 变更 / 只校验）与底部摘要。表内不做富文本 / 第二套文本编辑器，不给字幕画面预览。
 *
 * 写操作只走 `ctx.commands.commitBatch`；批次草稿 / 筛选 / 勾选 / 滚动都是会话态，
 * 不落盘、重开不恢复。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DocCommand } from '../../../core/doc/commands.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE, FILE_DIALOG_PORT, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import type { DocumentService } from '../../../workbench/api/documents.ts'
import type {
  SubtitleFilePicked,
  SubtitleFileReadResult,
} from '../../../workbench/api/host.ts'

import {
  deriveCueRows,
  deriveTracks,
  type CueRow,
  type RawTrack,
  type SubtitleTrackInfo,
} from '../../../features/subtitles/cues.ts'
import {
  planBatchDelete,
  planBatchMove,
  planReimportDiff,
  planTimeEdit,
  makeEmptyDraftCue,
  type DiffEntry,
} from '../../../features/subtitles/batch.ts'
import { planCompile, type CompileCue, type CompileMode } from '../../../features/subtitles/compile.ts'
import {
  parseSubtitleText,
  subtitleFormatOf,
  type ParsedCue,
  type SubtitleParseOutput,
} from '../../../features/subtitles/parse.ts'
import {
  filterCueRows,
  lineBreakSymbol,
  panelDisabledState,
  summarizeRows,
  trackCheckViews,
} from '../../../features/subtitles/viewmodel.ts'
import { rawTracksFromView } from '../panelModel.ts'

const ctx = usePanelContext()
const documents: DocumentService | null = ctx.services.get(DOCUMENT_SERVICE) ?? null
const files = ctx.services.get(FILE_DIALOG_PORT) ?? null

// ── 修订信号 ──────────────────────────────────────────────────────────────────────

const tick = ref(0)
const disposers: Array<() => void> = []

onMounted(() => {
  const selection = ctx.services.get(SELECTION_SERVICE)
  if (selection !== undefined) disposers.push(selection.subscribe(() => { tick.value += 1 }))
  if (documents !== null) disposers.push(documents.subscribe(() => { tick.value += 1 }))
})

onBeforeUnmount(() => {
  for (const dispose of disposers) dispose()
  disposers.length = 0
})

const t = (key: string, params?: Record<string, string | number>): string => ctx.i18n.t(key, params)

// ── 文档派生（实时计算，不缓存副本） ────────────────────────────────────────────────

const view = computed(() => {
  void tick.value
  return documents?.view() ?? null
})

const rawTracks = computed<RawTrack[]>(() =>
  rawTracksFromView(view.value, (clipKey) => documents?.clipObjects(clipKey) ?? null),
)

const tracks = computed<SubtitleTrackInfo[]>(() => deriveTracks(rawTracks.value))
const compiledRows = computed<CueRow[]>(() => deriveCueRows(rawTracks.value))

/** 草稿 cue（会话态：不落盘，重开不恢复）。 */
const draftCues = ref<ParsedCue[]>([])

interface DraftRow extends CueRow {
  draftCue: ParsedCue
}

const draftRows = computed<DraftRow[]>(() =>
  draftCues.value.map((cue, index) => ({
    cueId: `draft#${cue.ordinal}`,
    clipKey: null,
    trackIndex: null,
    start: cue.start,
    end: cue.end,
    duration: Math.max(0, cue.end - cue.start),
    text: cue.text,
    lines: cue.text === '' ? 1 : cue.text.split('\n').length,
    statuses: cue.text.trim() === '' ? ['empty-text'] : [],
    draft: true,
    issue: cue.error,
    draftCue: cue,
  })),
)

const rows = computed<CueRow[]>(() => [...compiledRows.value, ...draftRows.value])

// ── 面板会话态（不落盘） ──────────────────────────────────────────────────────────

const selectedIds = ref<ReadonlySet<string>>(new Set())
const checkedTracks = ref<ReadonlySet<number> | null>(null)
const query = ref('')
const compileMode = ref<CompileMode>('draft')
const moveDelta = ref(1)
const statusLine = ref('')

const checkedSet = computed(() => checkedTracks.value)
const filteredRows = computed(() =>
  filterCueRows(rows.value, { query: query.value, selectedTracks: checkedSet.value }),
)

const summary = computed(() => summarizeRows(rows.value, selectedIds.value))
const disabled = computed(() =>
  panelDisabledState({
    docOpen: view.value !== null,
    hasCompiledRows: compiledRows.value.length > 0,
    selectedCount: selectedIds.value.size,
    hasDraftCues: draftCues.value.length > 0,
  }),
)

const trackViews = computed(() => trackCheckViews(tracks.value, checkedTracks.value, rows.value))

// ── 选择 / 定位 ──────────────────────────────────────────────────────────────────

function toggleRow(cueId: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(cueId)) next.delete(cueId)
  else next.add(cueId)
  selectedIds.value = next
}

function toggleTrack(trackIndex: number): void {
  const base = checkedTracks.value === null ? new Set(tracks.value.map((track) => track.trackIndex)) : new Set(checkedTracks.value)
  if (base.has(trackIndex)) base.delete(trackIndex)
  else base.add(trackIndex)
  checkedTracks.value = base
}

function locateRow(row: CueRow): void {
  if (row.clipKey === null) {
    ctx.status.notify(t('subtitle.row.doubleClick'), 'info')
    return
  }
  ctx.requestSelect({ domain: 'clip', clipKey: row.clipKey })
  ctx.requestRevealInEffectControls({ clipKey: row.clipKey, objectPath: 'text' })
}

// ── 导入向导（七步，宿主本面板） ────────────────────────────────────────────────────

interface WizardState {
  open: boolean
  step: number
  picked: SubtitleFilePicked | null
  parse: SubtitleParseOutput | null
  encodingChoice: 'utf-8' | 'gb18030' | null
  message: string | null
  readStatus: SubtitleFileReadResult | null
}

const wizardEncoding = ref('')
const wizardBytes = ref(0)

const wizard = ref<WizardState>({
  open: false,
  step: 1,
  picked: null,
  parse: null,
  encodingChoice: null,
  message: null,
  readStatus: null,
})

const WIZARD_STEPS = ['file', 'decode', 'parse', 'prefix', 'pack', 'confirm', 'done'] as const

function openWizard(): void {
  wizard.value = { open: true, step: 1, picked: null, parse: null, encodingChoice: null, message: null, readStatus: null }
}

function closeWizard(): void {
  // 取消零残留：草稿只在「确认为草稿」时写入本面板会话态，这里不碰文档。
  wizard.value.open = false
}

async function chooseFile(): Promise<void> {
  if (files === null) {
    wizard.value.message = t('subtitle.wizard.unavailable')
    return
  }
  const picked = await files.pickSubtitleFile()
  if (picked === null) {
    closeWizard()
    return
  }
  wizard.value.picked = picked
  wizard.value.step = 2
  await readSubtitle()
}

async function readSubtitle(encoding?: 'utf-8' | 'gb18030'): Promise<void> {
  if (files === null || wizard.value.picked === null) return
  const result = await files.readSubtitleFile(wizard.value.picked.path, encoding)
  wizard.value.readStatus = result
  switch (result.status) {
    case 'ok': {
      const format = subtitleFormatOf(wizard.value.picked.name) ?? undefined
      const parsed = parseSubtitleText(result.text, format)
      wizard.value.parse = parsed
      wizard.value.message = null
      wizardEncoding.value = result.encoding
      wizardBytes.value = result.text.length
      wizard.value.step = 3
      break
    }
    case 'needs-encoding':
      wizard.value.message = t('subtitle.wizard.needsEncoding')
      break
    case 'decode-failed':
      wizard.value.message = t('subtitle.wizard.decodeFailed')
      break
    case 'unavailable':
      wizard.value.message = t('subtitle.wizard.unavailable')
      break
    case 'rejected':
      wizard.value.message = t('subtitle.wizard.rejected', { reason: result.reason })
      break
    case 'canceled':
      closeWizard()
      break
  }
}

function pickEncoding(encoding: 'utf-8' | 'gb18030'): void {
  wizard.value.encodingChoice = encoding
  void readSubtitle(encoding)
}

function wizardNext(): void {
  if (wizard.value.step < 6) wizard.value.step += 1
}

function wizardBack(): void {
  if (wizard.value.step > 1) wizard.value.step -= 1
}

function confirmDraft(): void {
  const parsed = wizard.value.parse
  if (parsed === null) return
  draftCues.value = [...draftCues.value, ...parsed.cues]
  wizard.value.open = false
  ctx.status.notify(t('subtitle.compile.done', { count: parsed.cues.length }), 'info')
}

// ── 重导入 ────────────────────────────────────────────────────────────────────────

const reimportOpen = ref(false)
const reimportEntries = ref<DiffEntry[]>([])
const reimportMissingDelete = ref(false)

async function startReimport(): Promise<void> {
  if (compiledRows.value.length === 0) {
    ctx.status.notify(t('subtitle.reimport.none'), 'warning')
    return
  }
  if (files === null) {
    ctx.status.notify(t('subtitle.wizard.unavailable'), 'error')
    return
  }
  const picked = await files.pickSubtitleFile()
  if (picked === null) return
  const result = await files.readSubtitleFile(picked.path)
  if (result.status !== 'ok') {
    ctx.status.notify(t('subtitle.wizard.rejected', { reason: result.status }), 'error')
    return
  }
  const format = subtitleFormatOf(picked.name) ?? undefined
  const parsed = parseSubtitleText(result.text, format)
  reimportEntries.value = planReimportDiff({ incoming: parsed.cues, existing: compiledRows.value })
  reimportOpen.value = true
}

function applyReimport(): void {
  const changed = reimportEntries.value.filter((entry) => entry.category === 'changed' && entry.existing)
  const added = reimportEntries.value.filter((entry) => entry.category === 'added' && entry.incoming)
  const missing = reimportEntries.value.filter((entry) => entry.category === 'missing' && entry.existing)

  const commands: DocCommand[] = []
  for (const entry of changed) {
    const row = entry.existing as CueRow
    const incoming = entry.incoming
    if (incoming === undefined) continue
    commands.push({ kind: 'clip.setStart', clipKey: row.clipKey as string, value: incoming.start })
    commands.push({ kind: 'clip.setDuration', clipKey: row.clipKey as string, value: incoming.end - incoming.start })
    commands.push({ kind: 'object.setValue', clipKey: row.clipKey as string, path: 'text', value: incoming.text })
  }
  if (reimportMissingDelete.value) {
    for (const entry of missing) {
      if (entry.existing?.clipKey !== null) {
        commands.push({ kind: 'clip.remove', clipKey: entry.existing?.clipKey as string })
      }
    }
  }
  if (commands.length > 0) {
    const outcome = ctx.commands.commitBatch(commands, 'subtitles-reimport')
    if (!outcome.ok) {
      ctx.status.notify(outcome.error ?? 'reimport failed', 'error')
      return
    }
  }
  const newDrafts = added.map((entry) => entry.incoming as ParsedCue)
  if (newDrafts.length > 0) draftCues.value = [...draftCues.value, ...newDrafts]
  reimportOpen.value = false
}

// ── 批次操作 ──────────────────────────────────────────────────────────────────────

function selectedRows(): CueRow[] {
  return rows.value.filter((row) => selectedIds.value.has(row.cueId))
}

function applyMove(): void {
  const plan = planBatchMove(selectedRows(), moveDelta.value, tracks.value)
  if (plan.blockers.length > 0) {
    ctx.status.notify(plan.blockers.join('；'), 'error')
    return
  }
  const outcome = ctx.commands.commitBatch(plan.commands, 'subtitles-move')
  if (!outcome.ok) ctx.status.notify(outcome.error ?? 'move failed', 'error')
}

function applyDelete(): void {
  const plan = planBatchDelete(selectedRows())
  if (plan.blockers.length > 0) {
    ctx.status.notify(plan.blockers.join('；'), 'error')
    return
  }
  const outcome = ctx.commands.commitBatch(plan.commands, 'subtitles-delete')
  if (!outcome.ok) {
    ctx.status.notify(outcome.error ?? 'delete failed', 'error')
    return
  }
  selectedIds.value = new Set()
}

function applyTimeEdit(row: CueRow, start: number, end: number): void {
  const plan = planTimeEdit(row, start, end, rows.value)
  if (plan.blockers.length > 0) {
    ctx.status.notify(plan.blockers.join('；'), 'error')
    return
  }
  const outcome = ctx.commands.commitBatch(plan.commands, 'subtitles-time-edit')
  if (!outcome.ok) ctx.status.notify(outcome.error ?? 'time edit failed', 'error')
}

function addEmptyCue(): void {
  const playhead = documents?.sessionView().playhead ?? 0
  const ordinal = draftCues.value.length + compiledRows.value.length + 1
  draftCues.value = [...draftCues.value, makeEmptyDraftCue({ playhead, ordinal })]
}

function addEmptyTrack(): void {
  const outcome = ctx.commands.commitBatch([{ kind: 'timeline.addTrack', type: 'OVERLAY' }], 'subtitles-add-track')
  if (!outcome.ok) ctx.status.notify(outcome.error ?? 'add track failed', 'error')
}

// ── 编译 ──────────────────────────────────────────────────────────────────────────

function toCompileCue(row: CueRow): CompileCue {
  return {
    cueId: row.cueId,
    clipKey: row.clipKey,
    trackIndex: row.trackIndex,
    ordinal: Number(row.cueId.replace(/\D/g, '')) || 0,
    start: row.start,
    end: row.end,
    text: row.text,
    draft: row.draft,
  }
}

function draftToCompileCue(cue: ParsedCue): CompileCue {
  return {
    cueId: `draft#${cue.ordinal}`,
    clipKey: null,
    trackIndex: null,
    ordinal: cue.ordinal,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    draft: true,
  }
}

function runCompile(): void {
  const mode = compileMode.value
  const cues: CompileCue[] =
    mode === 'draft'
      ? draftCues.value.map(draftToCompileCue)
      : mode === 'changed'
        ? compiledRows.value.map(toCompileCue)
        : rows.value.map(toCompileCue)

  const beforeKeys = new Set(compiledRows.value.map((row) => row.cueId))
  const plan = planCompile({ mode, cues, tracks: rawTracks.value, source: 'hand' })

  if (plan.blockers.length > 0) {
    ctx.status.notify(t('subtitle.compile.blockers', { messages: plan.blockers.join('；') }), 'error')
    return
  }
  if (plan.warnings.length > 0) {
    ctx.status.notify(t('subtitle.compile.warnings', { messages: plan.warnings.join('；') }), 'warning')
  }
  if (plan.commands.length > 0) {
    const outcome = ctx.commands.commitBatch(plan.commands, `subtitles-compile-${mode}`)
    if (!outcome.ok) {
      ctx.status.notify(outcome.error ?? 'compile failed', 'error')
      return
    }
  }
  // 选中第一条新片段。
  const afterKeys = new Set(compiledRows.value.map((row) => row.cueId))
  const firstNew = [...afterKeys].find((key) => !beforeKeys.has(key))
  if (firstNew !== undefined) {
    ctx.requestSelect({ domain: 'clip', clipKey: firstNew })
  }
  statusLine.value = t('subtitle.compile.done', { count: plan.commands.length })
}

// ── 虚拟滚动 ──────────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 28
const scrollTop = ref(0)
const viewportHeight = ref(320)

function onScroll(event: Event): void {
  const target = event.target as HTMLElement
  scrollTop.value = target.scrollTop
  viewportHeight.value = target.clientHeight
}

const visibleRows = computed(() => {
  const startIndex = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - 4)
  const endIndex = Math.min(
    filteredRows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + 4,
  )
  return filteredRows.value.slice(startIndex, endIndex).map((row, index) => ({
    row,
    top: (startIndex + index) * ROW_HEIGHT,
  }))
})

// ── 列宽（可拖） ────────────────────────────────────────────────────────────────────

const columnWidths = ref<number[]>([44, 90, 70, 70, 60, 180, 110])
let dragColumn = -1
let dragStartX = 0
let dragStartWidth = 0

function onHeaderDragStart(column: number, event: PointerEvent): void {
  dragColumn = column
  dragStartX = event.clientX
  dragStartWidth = columnWidths.value[column]
  const move = (moveEvent: PointerEvent): void => {
    if (dragColumn < 0) return
    const next = Math.max(40, dragStartWidth + moveEvent.clientX - dragStartX)
    columnWidths.value = columnWidths.value.map((width, index) => (index === dragColumn ? next : width))
  }
  const up = (): void => {
    dragColumn = -1
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    overlap: t('subtitle.status.overlap'),
    conflict: t('subtitle.status.conflict'),
    'empty-text': t('subtitle.status.emptyText'),
    'low-visibility': t('subtitle.status.lowVisibility'),
  }
  return map[status] ?? status
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(2).padStart(5, '0')
  return `${String(m).padStart(2, '0')}:${s}`
}
</script>

<template>
  <section class="subtitles-panel">
    <!-- 工具栏 -->
    <header class="subtitles-panel__toolbar">
      <button type="button" :disabled="disabled.importDisabled" @click="openWizard">{{ t('subtitle.toolbar.import') }}</button>
      <button type="button" :disabled="disabled.reimportDisabled" @click="startReimport">{{ t('subtitle.toolbar.reimport') }}</button>
      <select v-model="compileMode" :disabled="disabled.compileDisabled">
        <option value="draft">{{ t('subtitle.compile.mode.draft') }}</option>
        <option value="changed">{{ t('subtitle.compile.mode.changed') }}</option>
        <option value="validate">{{ t('subtitle.compile.mode.validate') }}</option>
      </select>
      <button type="button" :disabled="disabled.compileDisabled" @click="runCompile">{{ t('subtitle.toolbar.compile') }}</button>
      <input v-model="query" type="search" :placeholder="t('subtitle.toolbar.filterPlaceholder')" />
    </header>

    <!-- 批次操作条 -->
    <div class="subtitles-panel__batch">
      <label class="subtitles-panel__delta">
        Δ <input v-model.number="moveDelta" type="number" step="0.1" :disabled="disabled.moveDisabled" />
      </label>
      <button type="button" :disabled="disabled.moveDisabled" @click="applyMove">{{ t('subtitle.row.move') }}</button>
      <button type="button" :disabled="disabled.deleteDisabled" @click="applyDelete">{{ t('subtitle.row.delete') }}</button>
      <button type="button" :disabled="disabled.importDisabled" @click="addEmptyCue">{{ t('subtitle.toolbar.newEmptyCue') }}</button>
    </div>

    <!-- 轨道勾选条 -->
    <div class="subtitles-panel__tracks">
      <div class="subtitles-panel__tracks-head">
        <span>{{ t('subtitle.track.bar') }}</span>
        <button type="button" :disabled="disabled.importDisabled" @click="addEmptyTrack">{{ t('subtitle.track.newEmpty') }}</button>
      </div>
      <label v-for="track in trackViews" :key="track.trackId" class="subtitles-panel__track">
        <input type="checkbox" :checked="track.checked" @change="toggleTrack(track.trackIndex)" />
        <span class="subtitles-panel__track-name">{{ track.name }}</span>
        <span class="subtitles-panel__track-meta">
          {{ track.cueCount }} · {{ track.timeRange === null ? '—' : `${formatTime(track.timeRange.start)}–${formatTime(track.timeRange.end)}` }}
        </span>
        <span v-if="track.kind === 'mixed-subtitle'" class="subtitles-panel__track-warn">{{ t('subtitle.track.mixed') }}</span>
      </label>
      <p v-if="trackViews.length === 0" class="subtitles-panel__empty">{{ t('subtitle.track.empty') }}</p>
    </div>

    <!-- cue 表 -->
    <div v-if="rows.length === 0" class="subtitles-panel__empty">{{ t('subtitle.noCues') }}</div>
    <div v-else class="subtitles-panel__table" @scroll="onScroll">
      <div class="subtitles-panel__head" :style="{ gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(' ') }">
        <span v-for="(width, index) in columnWidths" :key="index" class="subtitles-panel__th">
          {{ [t('subtitle.column.ordinal'), t('subtitle.column.track'), t('subtitle.column.start'), t('subtitle.column.end'), t('subtitle.column.duration'), t('subtitle.column.text'), t('subtitle.column.status')][index] }}
          <i class="subtitles-panel__resize" @pointerdown="onHeaderDragStart(index, $event)" />
        </span>
      </div>
      <div class="subtitles-panel__body" :style="{ height: `${viewportHeight}px` }">
        <div
          v-for="entry in visibleRows"
          :key="entry.row.cueId"
          class="subtitles-panel__row"
          :class="{ 'subtitles-panel__row--selected': selectedIds.has(entry.row.cueId) }"
          :style="{ top: `${entry.top}px`, height: `${ROW_HEIGHT}px`, gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(' ') }"
          @click="toggleRow(entry.row.cueId)"
          @dblclick="locateRow(entry.row)"
        >
          <span class="subtitles-panel__cell">{{ entry.row.draft ? entry.row.cueId.replace('draft#', '') : compiledRows.indexOf(entry.row) + 1 }}</span>
          <span class="subtitles-panel__cell">{{ entry.row.trackIndex === null ? '—' : `#${entry.row.trackIndex + 1}` }}</span>
          <span class="subtitles-panel__cell">{{ formatTime(entry.row.start) }}</span>
          <span class="subtitles-panel__cell">{{ formatTime(entry.row.end) }}</span>
          <span class="subtitles-panel__cell">{{ entry.row.duration.toFixed(2) }}</span>
          <span class="subtitles-panel__cell subtitles-panel__text" :title="lineBreakSymbol(entry.row.text)">{{ lineBreakSymbol(entry.row.text) }}</span>
          <span class="subtitles-panel__cell subtitles-panel__status">
            <em v-if="entry.row.draft" class="subtitles-panel__badge subtitles-panel__badge--draft">{{ t('subtitle.status.draft') }}</em>
            <em v-if="entry.row.issue" class="subtitles-panel__badge subtitles-panel__badge--error">{{ t('subtitle.status.error') }}</em>
            <em v-for="status in entry.row.statuses" :key="status" class="subtitles-panel__badge">{{ statusLabel(status) }}</em>
          </span>
        </div>
      </div>
    </div>

    <!-- 底部摘要 -->
    <footer class="subtitles-panel__summary">
      <span>{{ t('subtitle.summary.total', { count: summary.total }) }}</span>
      <span>{{ t('subtitle.summary.selected', { count: summary.selected }) }}</span>
      <span>{{ t('subtitle.summary.draft', { count: summary.draft }) }}</span>
      <span>{{ t('subtitle.summary.errors', { count: summary.errors }) }}</span>
      <span>{{ t('subtitle.summary.overlap', { count: summary.overlap }) }}</span>
      <span>{{ t('subtitle.summary.conflict', { count: summary.conflict }) }}</span>
      <span>{{ t('subtitle.summary.emptyText', { count: summary.emptyText }) }}</span>
      <span>{{ t('subtitle.summary.lowVisibility', { count: summary.lowVisibility }) }}</span>
      <span v-if="statusLine" class="subtitles-panel__status-line">{{ statusLine }}</span>
    </footer>

    <!-- 导入向导 -->
    <section v-if="wizard.open" class="subtitles-panel__wizard">
      <h3>{{ t('subtitle.wizard.title') }}</h3>
      <ol class="subtitles-panel__steps">
        <li v-for="(step, index) in WIZARD_STEPS" :key="step" :class="{ active: wizard.step === index + 1 }">
          {{ t(`subtitle.wizard.step.${step}`) }}
        </li>
      </ol>

      <div v-if="wizard.step === 1" class="subtitles-panel__wizard-body">
        <p>{{ t('subtitle.wizard.pickPrompt') }}</p>
        <button type="button" @click="chooseFile">{{ t('subtitle.wizard.step.file') }}</button>
      </div>

      <div v-else-if="wizard.step === 2" class="subtitles-panel__wizard-body">
        <p v-if="wizard.readStatus?.status === 'ok'">{{ t('subtitle.wizard.decodeOk', { encoding: wizardEncoding, bytes: wizardBytes }) }}</p>
        <p v-if="wizard.message" class="subtitles-panel__warn">{{ wizard.message }}</p>
        <div v-if="wizard.readStatus?.status === 'needs-encoding'">
          <button type="button" @click="pickEncoding('utf-8')">{{ t('subtitle.wizard.encodingUtf8') }}</button>
          <button type="button" @click="pickEncoding('gb18030')">{{ t('subtitle.wizard.encodingGb18030') }}</button>
        </div>
        <button v-if="wizard.parse !== null" type="button" @click="wizardNext">{{ t('subtitle.wizard.next') }}</button>
      </div>

      <div v-else-if="wizard.step === 3" class="subtitles-panel__wizard-body">
        <p v-if="wizard.parse">
          {{ t('subtitle.wizard.parseSummary', { cues: wizard.parse.cues.length, errors: wizard.parse.errors.length, warnings: wizard.parse.warnings.length }) }}
        </p>
        <p v-if="wizard.parse?.empty" class="subtitles-panel__warn">{{ t('subtitle.wizard.empty') }}</p>
        <button type="button" @click="wizardBack">{{ t('subtitle.wizard.back') }}</button>
        <button type="button" :disabled="wizard.parse?.empty" @click="wizardNext">{{ t('subtitle.wizard.next') }}</button>
      </div>

      <div v-else-if="wizard.step === 4" class="subtitles-panel__wizard-body">
        <p>{{ t('subtitle.wizard.prefixHint') }}</p>
        <button type="button" @click="wizardBack">{{ t('subtitle.wizard.back') }}</button>
        <button type="button" @click="wizardNext">{{ t('subtitle.wizard.next') }}</button>
      </div>

      <div v-else-if="wizard.step === 5" class="subtitles-panel__wizard-body">
        <p>{{ t('subtitle.wizard.packSummary', { tracks: tracks.length }) }}</p>
        <button type="button" @click="wizardBack">{{ t('subtitle.wizard.back') }}</button>
        <button type="button" @click="wizardNext">{{ t('subtitle.wizard.next') }}</button>
      </div>

      <div v-else-if="wizard.step === 6" class="subtitles-panel__wizard-body">
        <p>{{ t('subtitle.wizard.confirmHint') }}</p>
        <button type="button" @click="wizardBack">{{ t('subtitle.wizard.back') }}</button>
        <button type="button" @click="confirmDraft">{{ t('subtitle.wizard.confirmDraft') }}</button>
      </div>

      <div class="subtitles-panel__wizard-actions">
        <button type="button" @click="closeWizard">{{ t('subtitle.wizard.cancel') }}</button>
      </div>
    </section>

    <!-- 重导入冲突面板 -->
    <section v-if="reimportOpen" class="subtitles-panel__reimport">
      <h3>{{ t('subtitle.reimport.title') }}</h3>
      <p class="subtitles-panel__warn">{{ t('subtitle.reimport.keepManual') }}</p>
      <label class="subtitles-panel__reimport-delete">
        <input v-model="reimportMissingDelete" type="checkbox" />
        {{ t('subtitle.reimport.missing') }}
      </label>
      <ul>
        <li v-for="entry in reimportEntries" :key="`${entry.category}-${entry.cueId ?? entry.ordinal}`">
          <em class="subtitles-panel__badge">{{ t(`subtitle.reimport.${entry.category}`) }}</em>
          <span>{{ entry.incoming?.text ?? entry.existing?.text ?? '' }}</span>
        </li>
      </ul>
      <div>
        <button type="button" @click="reimportOpen = false">{{ t('subtitle.wizard.cancel') }}</button>
        <button type="button" @click="applyReimport">{{ t('subtitle.reimport.apply') }}</button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.subtitles-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
  font-size: 12px;
}

.subtitles-panel__toolbar,
.subtitles-panel__batch,
.subtitles-panel__tracks-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.subtitles-panel__batch {
  padding: 4px 0;
  border-bottom: 1px solid var(--border, #ddd);
}

.subtitles-panel__delta input {
  width: 64px;
}

.subtitles-panel__tracks {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.subtitles-panel__track {
  display: flex;
  align-items: center;
  gap: 6px;
}

.subtitles-panel__track-meta {
  color: var(--text-muted, #888);
}

.subtitles-panel__track-warn {
  color: var(--warning, #c9a227);
}

.subtitles-panel__table {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border, #ddd);
}

.subtitles-panel__head,
.subtitles-panel__row {
  display: grid;
  gap: 4px;
  align-items: center;
}

.subtitles-panel__head {
  position: sticky;
  top: 0;
  background: var(--bg-raised, #eee);
  z-index: 1;
}

.subtitles-panel__th {
  position: relative;
  padding: 4px 6px;
  font-weight: 600;
}

.subtitles-panel__resize {
  position: absolute;
  right: 0;
  top: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
}

.subtitles-panel__body {
  position: relative;
}

.subtitles-panel__row {
  position: absolute;
  left: 0;
  right: 0;
  padding: 0 6px;
  cursor: pointer;
}

.subtitles-panel__row--selected {
  background: color-mix(in srgb, var(--accent, #4a90d9) 14%, transparent);
}

.subtitles-panel__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.subtitles-panel__status {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.subtitles-panel__badge {
  font-style: normal;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-raised, #eee);
  color: var(--text-secondary, #666);
}

.subtitles-panel__badge--draft {
  color: var(--accent, #4a90d9);
}

.subtitles-panel__badge--error {
  color: var(--danger, #c0392b);
}

.subtitles-panel__summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--text-muted, #888);
}

.subtitles-panel__warn {
  color: var(--warning, #c9a227);
}

.subtitles-panel__wizard,
.subtitles-panel__reimport {
  border: 1px solid var(--border, #ddd);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.subtitles-panel__steps {
  display: flex;
  gap: 8px;
  list-style: none;
  padding: 0;
}

.subtitles-panel__steps .active {
  color: var(--accent, #4a90d9);
  font-weight: 600;
}

.subtitles-panel__empty {
  color: var(--text-muted, #888);
}
</style>
