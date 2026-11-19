<script setup lang="ts">
/**
 * 08-03 转场面板（插件 `core.transition-panel`，面板 `transition.panel`）。
 *
 * 编辑对象是「A→B 交界」：叠化、参数过渡、共存处理三件事都在这里。
 * 只做编辑器操作与本地校验；所有写入走 `DocumentCommands`，一次应用一次提交。
 */
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from 'vue'

import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import type { DocumentService } from '../../../workbench/api/documents.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import CurveEditor from '../../../features/paths/CurveEditor.vue'
import {
  TRANSITION_CHANNELS,
  TRANSITION_CHANNEL_LABELS,
  TRANSITION_INTERRUPTS,
  TRANSITION_MODES,
  buildCrossfadeCommands,
  buildParamCommands,
  buildPreferCrossfadeCommands,
  buildPreferParamCommands,
  buildRemoveCrossfadeCommands,
  buildSetTypeCommand,
  buildTransitionView,
  countReplacedFrames,
  describeCurve,
  draftEquals,
  draftFromParam,
  formatSeconds,
  hasError,
  sortIssues,
  validateCrossfadeDuration,
  validateDraft,
} from '../../../features/camera/transition/model.ts'
import type {
  BoundaryState,
  ChannelDraft,
  ChannelView,
  ParamDraft,
  TransitionBoundary,
  TransitionChannelMode,
  TransitionDocumentView,
  TransitionIssue,
  TransitionType,
} from '../../../features/camera/transition/model.ts'

const ctx = usePanelContext()
const documents = ctx.services.require<DocumentService>(DOCUMENT_SERVICE)
const commands = ctx.commands

/** 订阅计数：任何文档 emit（含播放头）都递增，用于刷新派生视图。 */
const tick = ref(0)
/** 文档修订号（变化时清空草稿）。 */
let lastRevision = documents.summary().revision

const drafts = reactive<Record<string, ParamDraft>>({})
const crossfadeInputs = reactive<Record<string, string>>({})
const durationInputs = reactive<Record<string, string>>({})
const selectedId = ref<string | null>(null)
const filter = ref<FilterId>('all')
const pendingSwitch = ref<TransitionBoundary | null>(null)
const notice = ref('')

const stopSubscription = documents.subscribe(() => {
  const revision = documents.summary().revision
  if (revision !== lastRevision) {
    lastRevision = revision
    clearDrafts()
  }
  tick.value += 1
})

onBeforeUnmount(() => {
  stopSubscription()
})

/** 文档修订号变化 → 草稿全部清空并重建（08-03 §3.5）。 */
function clearDrafts(): void {
  for (const key of Object.keys(drafts)) {
    delete drafts[key]
  }
  for (const key of Object.keys(crossfadeInputs)) {
    delete crossfadeInputs[key]
  }
  for (const key of Object.keys(durationInputs)) {
    delete durationInputs[key]
  }
}

const model = computed<TransitionDocumentView | null>(() => {
  void tick.value
  const view = documents.view()
  if (view === null) {
    return null
  }
  return buildTransitionView(view, (clipKey) => documents.clipObjects(clipKey))
})

const documentOpen = computed(() => documents.summary().docId !== null)

const selected = computed<TransitionBoundary | null>(() => {
  const current = model.value
  if (current === null || current.boundaries.length === 0) {
    return null
  }
  const found = selectedId.value === null
    ? undefined
    : current.boundaries.find((boundary) => boundary.id === selectedId.value)
  return found ?? current.boundaries[0]
})

/** 列表过滤。 */
type FilterId = 'all' | 'crossfade' | 'morph' | 'coexist' | 'none' | 'broken'

const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'crossfade', label: '叠化' },
  { id: 'morph', label: '参数过渡' },
  { id: 'coexist', label: '共存' },
  { id: 'none', label: '无效果' },
  { id: 'broken', label: '异常' },
]

const STATE_LABELS: Readonly<Record<BoundaryState, string>> = {
  'hard-cut': '硬切',
  crossfade: '叠化',
  morph: '参数过渡',
  coexist: '共存',
  broken: '异常',
}

function matchesFilter(boundary: TransitionBoundary, id: FilterId): boolean {
  if (id === 'all') {
    return true
  }
  if (id === 'none') {
    return boundary.state === 'hard-cut'
  }
  if (id === 'morph') {
    return boundary.state === 'morph' || boundary.state === 'coexist'
  }
  if (id === 'crossfade') {
    return boundary.state === 'crossfade' || boundary.state === 'coexist'
  }
  return boundary.state === id
}

const visibleBoundaries = computed(() => {
  const current = model.value
  if (current === null) {
    return []
  }
  return current.boundaries.filter((boundary) => matchesFilter(boundary, filter.value))
})

function countOf(id: FilterId): number {
  const current = model.value
  return current === null ? 0 : current.boundaries.filter((boundary) => matchesFilter(boundary, id)).length
}

// ── 选中与草稿 ─────────────────────────────────────────────

function selectBoundary(boundary: TransitionBoundary): void {
  if (selectedId.value === boundary.id) {
    return
  }
  const previous = selected.value
  if (previous !== null && previous.id !== boundary.id && isDirty(previous)) {
    pendingSwitch.value = boundary
    return
  }
  selectedId.value = boundary.id
}

function confirmSwitch(action: 'discard' | 'apply' | 'cancel'): void {
  const target = pendingSwitch.value
  const previous = selected.value
  pendingSwitch.value = null
  if (target === null) {
    return
  }
  if (action === 'cancel') {
    if (previous !== null) {
      selectedId.value = previous.id
    }
    return
  }
  if (previous !== null) {
    if (action === 'apply') {
      applyParam(previous)
    } else {
      delete drafts[previous.id]
      delete durationInputs[previous.id]
    }
  }
  selectedId.value = target.id
}

function draftOf(boundary: TransitionBoundary): ParamDraft {
  const existing = drafts[boundary.id]
  if (existing !== undefined) {
    return existing
  }
  const fresh = draftFromParam(boundary.param)
  drafts[boundary.id] = fresh
  return fresh
}

function draftIfAny(boundary: TransitionBoundary): ParamDraft | null {
  return drafts[boundary.id] ?? null
}

function isDirty(boundary: TransitionBoundary): boolean {
  const existing = drafts[boundary.id]
  if (existing === undefined) {
    return false
  }
  return !draftEquals(existing, draftFromParam(boundary.param))
}

function crossfadeInputOf(boundary: TransitionBoundary): string {
  const existing = crossfadeInputs[boundary.id]
  if (existing !== undefined) {
    return existing
  }
  const seeded = boundary.crossfade.overlap ? formatSeconds(boundary.crossfade.duration) : ''
  crossfadeInputs[boundary.id] = seeded
  return seeded
}

function setCrossfadeInput(boundary: TransitionBoundary, value: string): void {
  crossfadeInputs[boundary.id] = value
}

/** 时长输入 → 数字（空 = `null`，非法 = `NaN`）。 */
function parseInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

// ── 叠化 ───────────────────────────────────────────────────

const crossfadeDuration = computed<number | null>(() => {
  const boundary = selected.value
  if (boundary === null) {
    return null
  }
  return parseInput(crossfadeInputOf(boundary))
})

const crossfadeErrors = computed<TransitionIssue[]>(() => {
  const boundary = selected.value
  const duration = crossfadeDuration.value
  if (boundary === null || duration === null || !Number.isFinite(duration)) {
    return []
  }
  return validateCrossfadeDuration(boundary.a, boundary.b, duration)
})

const crossfadeUpperBound = computed(() => {
  const boundary = selected.value
  if (boundary === null) {
    return 0
  }
  return Math.min(
    boundary.a.infinite ? 0 : boundary.a.duration,
    boundary.b.infinite ? 0 : boundary.b.duration,
  )
})

const canApplyCrossfade = computed(() => {
  const boundary = selected.value
  if (boundary === null || hasError(boundary.crossfade.structural)) {
    return false
  }
  const duration = crossfadeDuration.value
  if (duration === null || !Number.isFinite(duration)) {
    return false
  }
  return crossfadeErrors.value.length === 0
})

const replacedFrames = computed(() => {
  const boundary = selected.value
  const duration = crossfadeDuration.value
  if (boundary === null || duration === null || !Number.isFinite(duration) || duration <= 0) {
    return 0
  }
  return countReplacedFrames(boundary, duration)
})

function applyCrossfade(): void {
  const boundary = selected.value
  const duration = crossfadeDuration.value
  if (boundary === null || duration === null || !Number.isFinite(duration) || !canApplyCrossfade.value) {
    return
  }
  const outcome = commands.commitBatch(buildCrossfadeCommands(boundary, duration))
  if (outcome.ok) {
    notice.value = `已应用叠化 D=${formatSeconds(duration)} 秒`
  }
}

function removeCrossfade(): void {
  const boundary = selected.value
  if (boundary === null || !boundary.crossfade.identified) {
    return
  }
  const outcome = commands.commitBatch(buildRemoveCrossfadeCommands(boundary))
  if (outcome.ok) {
    notice.value = '已移除叠化：B 回到 A 结束处，两端帧已删除'
  }
}

// ── 参数过渡 ───────────────────────────────────────────────

const paramErrors = computed<TransitionIssue[]>(() => {
  const boundary = selected.value
  if (boundary === null) {
    return []
  }
  return [...validateDraft(draftOf(boundary)), ...boundary.param.issues]
})

const canApplyParam = computed(() => selected.value !== null && !hasError(paramErrors.value))

function durationValueOf(boundary: TransitionBoundary): string {
  const existing = durationInputs[boundary.id]
  if (existing !== undefined) {
    return existing
  }
  const draft = draftOf(boundary)
  const seeded = draft.duration === null ? '' : formatSeconds(draft.duration)
  durationInputs[boundary.id] = seeded
  return seeded
}

function setDurationInput(boundary: TransitionBoundary, value: string): void {
  durationInputs[boundary.id] = value
  const draft = draftOf(boundary)
  const parsed = parseInput(value)
  draft.duration = parsed === null || Number.isNaN(parsed) ? null : parsed
}

function setType(boundary: TransitionBoundary, type: TransitionType): void {
  const draft = draftOf(boundary)
  if (draft.type === type) {
    return
  }
  draft.type = type
  commands.commit(buildSetTypeCommand(boundary, type))
  notice.value = type === 'morph' ? '已切到 morph（分通道声明保留）' : '已切到 cut（分通道声明保留）'
}

function setInterrupt(boundary: TransitionBoundary, value: string): void {
  const draft = draftOf(boundary)
  draft.interrupt = value === 'snap' ? 'snap' : 'blend'
}

function channelDraft(boundary: TransitionBoundary, channel: ChannelView): ChannelDraft {
  const draft = draftOf(boundary)
  let entry = draft.channels.find((candidate) => candidate.channel === channel.channel)
  if (entry === undefined) {
    entry = { channel: channel.channel, mode: null, duration: null, curve: null }
    draft.channels.push(entry)
  }
  return entry
}

function setChannelMode(boundary: TransitionBoundary, channel: ChannelView, value: string): void {
  const entry = channelDraft(boundary, channel)
  entry.mode = value === '' ? null : (value as TransitionChannelMode)
}

function setChannelDuration(boundary: TransitionBoundary, channel: ChannelView, value: string): void {
  const entry = channelDraft(boundary, channel)
  const parsed = parseInput(value)
  entry.duration = parsed === null || Number.isNaN(parsed) ? null : parsed
}

function clearChannel(boundary: TransitionBoundary, channel: ChannelView): void {
  const entry = channelDraft(boundary, channel)
  entry.mode = null
  entry.duration = null
  entry.curve = null
}

function applyParam(boundary: TransitionBoundary): void {
  const draft = drafts[boundary.id]
  if (draft === undefined) {
    return
  }
  if (hasError(validateDraft(draft)) || hasError(boundary.param.issues)) {
    return
  }
  const outcome = commands.commitBatch(buildParamCommands(boundary, draft))
  if (outcome.ok) {
    notice.value = '参数过渡已应用'
  }
}

function discardDraft(boundary: TransitionBoundary): void {
  delete drafts[boundary.id]
  delete durationInputs[boundary.id]
  notice.value = '已放弃未应用的参数过渡草稿'
}

// ── 共存 ───────────────────────────────────────────────────

function preferCrossfade(boundary: TransitionBoundary): void {
  const outcome = commands.commitBatch(buildPreferCrossfadeCommands(boundary))
  if (outcome.ok) {
    notice.value = '已仅保留叠化：A 的 transition 写成 cut，分通道声明保留'
  }
}

function preferParam(boundary: TransitionBoundary): void {
  if (boundary.param.type !== 'morph') {
    return
  }
  const outcome = commands.commitBatch(buildPreferParamCommands(boundary))
  if (outcome.ok) {
    notice.value = '已仅保留参数过渡：B 回到交界处、两端帧已删，A 的 transition 未改动'
  }
}

/** 两者保留：不写任何字段，只把当前区间结论显示出来（08-03 §3.4）。 */
function keepBoth(boundary: TransitionBoundary): void {
  const coverage = boundary.coexist.coverage
  if (coverage === 'full') {
    notice.value = '两者保留：morph 窗口覆盖整个重叠区，叠化不可见；未改任何字段'
    return
  }
  if (coverage === 'partial') {
    notice.value = '两者保留：窗口内 morph、窗口外叠化仍可见；未改任何字段'
    return
  }
  notice.value = '两者保留：两个区间不重叠，各自独立生效；未改任何字段'
}

// ── 定位与呈现 ─────────────────────────────────────────────

function locate(clipKey: string, time: number): void {
  ctx.requestSelect({ domain: 'clip', clipKey })
  documents.setPlayhead(Math.max(0, time))
}

/** 叠化布局条的百分比区间（横轴 = 主时间轴秒）。 */
function barGeometry(boundary: TransitionBoundary): {
  aWidth: number
  bLeft: number
  bWidth: number
  overlapLeft: number
  overlapWidth: number
} {
  const start = Math.min(boundary.a.start, boundary.b.start)
  const aEnd = boundary.a.infinite ? boundary.layout.boundaryTime : boundary.layout.aEnd
  const bEnd = boundary.b.infinite ? boundary.b.start + 1 : boundary.layout.bEnd
  const end = Math.max(aEnd, bEnd, boundary.b.start + 0.001)
  const span = Math.max(end - start, 0.001)
  const pct = (value: number): number => ((value - start) / span) * 100
  const bLeft = pct(boundary.b.start)
  const overlapLeft = boundary.layout.overlapStart === null ? 0 : pct(boundary.layout.overlapStart)
  return {
    aWidth: Math.max(0, Math.min(100, boundary.a.infinite ? 100 : pct(aEnd))),
    bLeft: Math.max(0, Math.min(100, bLeft)),
    bWidth: Math.max(0, 100 - bLeft),
    overlapLeft,
    overlapWidth: boundary.crossfade.duration === 0 ? 0 : (boundary.crossfade.duration / span) * 100,
  }
}

function issuesOf(boundary: TransitionBoundary): TransitionIssue[] {
  return sortIssues([...boundary.issues])
}

function totalErrors(issues: readonly TransitionIssue[]): number {
  return issues.filter((issue) => issue.severity === 'error').length
}

function curveLabel(value: unknown): string {
  return describeCurve(value === null || value === undefined ? null : (value as never))
}

// ── 曲线模型（07 的 CurveEditor，08-03 §3.3「编辑模型」） ──────────────

/** 正在编辑曲线的目标：`channel === null` 表示片段级 `transition_curve`。 */
const curveEditing = ref<{ boundaryId: string; channel: string | null } | null>(null)
/** 编辑中的模型（受控：CurveEditor 只回传，不改父值）。 */
// `shallowRef`：`JsonValue` 是递归类型，`ref` 的深解包会触发 TS2589；本处原本就整体替换，语义不变。
const curveDraft = shallowRef<JsonValue | undefined>(undefined)

function boundaryById(id: string): TransitionBoundary | null {
  const current = model.value
  if (current === null) {
    return null
  }
  return current.boundaries.find((boundary) => boundary.id === id) ?? null
}

function openCurve(boundary: TransitionBoundary, channel: ChannelView | null): void {
  const draft = draftOf(boundary)
  const value = channel === null ? draft.curve : channelDraft(boundary, channel).curve
  curveDraft.value = value === null ? undefined : value
  curveEditing.value = { boundaryId: boundary.id, channel: channel === null ? null : channel.channel }
}

function onCurveChange(value: JsonValue | undefined): void {
  const editing = curveEditing.value
  if (editing === null) {
    return
  }
  const boundary = boundaryById(editing.boundaryId)
  if (boundary === null) {
    curveEditing.value = null
    return
  }
  const next: JsonObject | null = isJsonObject(value) ? value : null
  const draft = draftOf(boundary)
  if (editing.channel === null) {
    draft.curve = next
  } else {
    const view = boundary.param.channels.find((candidate) => candidate.channel === editing.channel)
    if (view === undefined) {
      return
    }
    channelDraft(boundary, view).curve = next
  }
  curveDraft.value = next === null ? undefined : next
}

function closeCurve(): void {
  curveEditing.value = null
  curveDraft.value = undefined
}

/** 曲线编辑目标的标题（片段级 / 通道级）。 */
function curveTargetLabel(): string {
  const editing = curveEditing.value
  if (editing === null) {
    return ''
  }
  if (editing.channel === null) {
    return '片段级曲线（值域：过渡）'
  }
  const label = CHANNEL_LABELS[editing.channel as keyof typeof CHANNEL_LABELS]
  return `通道 ${editing.channel}${label === undefined ? '' : `（${label}）`} 曲线`
}

function modeLabel(mode: TransitionChannelMode | null): string {
  if (mode === null) {
    return '继承'
  }
  return mode === 'blend' ? '混合' : mode === 'hold' ? '保持' : '硬切'
}

function channelOverrideState(channel: ChannelView): string {
  return channel.overridden ? '覆盖' : '继承'
}

/** 模板用的常量（运行时位序与目录枚举值都来自模型模块）。 */
const INTERRUPTS = TRANSITION_INTERRUPTS
const MODES = TRANSITION_MODES
const CHANNEL_LABELS = TRANSITION_CHANNEL_LABELS
</script>

<template>
  <div class="transition-panel">
    <header class="head">
      <div class="stats">
        <span>CAMERA 轨道 {{ model?.cameraTrackCount ?? 0 }}</span>
        <span>交界 {{ model?.boundaries.length ?? 0 }}</span>
        <span>共存 {{ model?.coexistCount ?? 0 }}</span>
      </div>
      <div class="filters">
        <button
          v-for="item in FILTERS"
          :key="item.id"
          type="button"
          class="filter"
          :class="{ active: filter === item.id }"
          @click="filter = item.id"
        >
          {{ item.label }} {{ countOf(item.id) }}
        </button>
      </div>
    </header>

    <div v-if="!documentOpen" class="empty">未打开文档：没有可编辑的交界。</div>
    <div v-else-if="model === null || model.boundaries.length === 0" class="empty">
      当前文档没有 CAMERA 轨道的相邻交界。
    </div>
    <template v-else>
      <div class="body">
        <ul class="list" role="listbox">
          <li
            v-for="boundary in visibleBoundaries"
            :key="boundary.id"
            class="row"
            :class="{ selected: selected?.id === boundary.id }"
            role="option"
            :aria-selected="selected?.id === boundary.id"
            @click="selectBoundary(boundary)"
          >
            <div class="row-main">
              <span class="row-title">{{ boundary.a.label }} → {{ boundary.b.label }}</span>
              <span class="row-meta">{{ boundary.trackName }}</span>
            </div>
            <div class="row-meta">
              <span>交界 {{ formatSeconds(boundary.boundaryTime) }}s</span>
              <span>叠化 {{ boundary.crossfade.overlap ? formatSeconds(boundary.crossfade.duration) : '—' }}</span>
              <span>参数 {{ boundary.param.window === null ? '—' : formatSeconds(boundary.param.window.width) }}</span>
              <span class="badge" :class="`state-${boundary.state}`">{{ STATE_LABELS[boundary.state] }}</span>
              <span v-if="boundary.issues.length > 0" class="badge warn">{{ boundary.issues.length }} 条提示</span>
            </div>
            <div class="row-actions">
              <button type="button" class="mini" @click.stop="locate(boundary.a.clipKey, boundary.a.start)">定位 A</button>
              <button type="button" class="mini" @click.stop="locate(boundary.b.clipKey, boundary.b.start)">定位 B</button>
            </div>
          </li>
        </ul>

        <section v-if="selected !== null" class="detail">
          <div class="detail-head">
            <strong>{{ selected.a.label }} → {{ selected.b.label }}</strong>
            <span class="badge" :class="`state-${selected.state}`">{{ STATE_LABELS[selected.state] }}</span>
            <span class="muted">{{ selected.trackName }} · 交界 {{ formatSeconds(selected.boundaryTime) }}s</span>
          </div>

          <div v-if="pendingSwitch !== null" class="confirm">
            <span>当前交界有未应用的参数过渡草稿。</span>
            <button type="button" @click="confirmSwitch('apply')">应用并切换</button>
            <button type="button" @click="confirmSwitch('discard')">放弃并切换</button>
            <button type="button" @click="confirmSwitch('cancel')">留在当前</button>
          </div>

          <div v-if="selected.state === 'broken'" class="card warn-card">
            <div class="card-title">结构不完整</div>
            <p class="muted">只做诊断，不猜作者意图，也不自动修复。</p>
            <ul class="issues">
              <li v-for="(issue, index) in issuesOf(selected)" :key="`${issue.code}-${index}`" :class="`sev-${issue.severity}`">
                {{ issue.message }}
                <button
                  v-if="issue.clipKey !== undefined"
                  type="button"
                  class="mini"
                  @click="locate(issue.clipKey, selected.boundaryTime)"
                >定位</button>
              </li>
            </ul>
          </div>

          <!-- 叠化卡 -->
          <div class="card">
            <div class="card-title">叠化（B 前移 + 不透明度 0 → 1）</div>
            <div class="bar" aria-hidden="true">
              <div class="bar-row">
                <span class="bar-tag">A</span>
                <div class="bar-track">
                  <div class="bar-clip bar-a" :style="{ width: `${barGeometry(selected).aWidth}%` }" />
                </div>
              </div>
              <div class="bar-row">
                <span class="bar-tag">B</span>
                <div class="bar-track">
                  <div
                    class="bar-clip bar-b"
                    :style="{ left: `${barGeometry(selected).bLeft}%`, width: `${barGeometry(selected).bWidth}%` }"
                  />
                </div>
              </div>
              <div
                v-if="barGeometry(selected).overlapWidth > 0"
                class="bar-overlap"
                :style="{ left: `${barGeometry(selected).overlapLeft}%`, width: `${barGeometry(selected).overlapWidth}%` }"
              />
            </div>
            <div class="field-row">
              <label class="field">
                <span>叠化时长 D（秒）</span>
                <input
                  type="text"
                  :value="crossfadeInputOf(selected)"
                  :disabled="hasError(selected.crossfade.structural)"
                  @input="setCrossfadeInput(selected, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <span class="hint">上限 {{ formatSeconds(crossfadeUpperBound) }} 秒</span>
            </div>
            <div class="opacity-preview">
              <span>A 不透明度恒为 1</span>
              <span>B 从 0 淡入到 1（{{ formatSeconds(selected.crossfade.duration) }} 秒内）</span>
            </div>
            <p v-if="replacedFrames > 0" class="hint">
              应用会替换重叠区内 {{ replacedFrames }} 个不透明度帧，区间外保留。
            </p>
            <p v-if="selected.crossfade.identified" class="hint ok">已应用叠化。</p>
            <ul v-if="crossfadeErrors.length > 0" class="issues">
              <li v-for="(issue, index) in crossfadeErrors" :key="`cf-${index}`" class="sev-error">{{ issue.message }}</li>
            </ul>
            <ul v-if="selected.crossfade.structural.length > 0" class="issues">
              <li
                v-for="(issue, index) in selected.crossfade.structural"
                :key="`cf-struct-${index}`"
                :class="`sev-${issue.severity}`"
              >{{ issue.message }}</li>
            </ul>
            <div class="actions">
              <button type="button" class="primary" :disabled="!canApplyCrossfade" @click="applyCrossfade">
                {{ selected.crossfade.identified ? '重新应用' : '应用叠化' }}
              </button>
              <button type="button" :disabled="!selected.crossfade.identified" @click="removeCrossfade">移除叠化</button>
            </div>
          </div>

          <!-- 参数过渡卡 -->
          <div class="card">
            <div class="card-title">参数过渡（出场片段 {{ selected.a.label }}）</div>
            <div class="field-row">
              <span class="field-label">过渡类型</span>
              <button type="button" class="seg" :class="{ active: draftOf(selected).type === 'cut' }" @click="setType(selected, 'cut')">cut</button>
              <button type="button" class="seg" :class="{ active: draftOf(selected).type === 'morph' }" @click="setType(selected, 'morph')">morph</button>
            </div>
            <div class="field-row">
              <label class="field">
                <span>片段级时长（空 = 未声明，运行时 0.5；0 = 无窗口）</span>
                <input
                  type="text"
                  :value="durationValueOf(selected)"
                  @input="setDurationInput(selected, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label class="field">
                <span>曲线</span>
                <span class="curve-line">
                  {{ curveLabel(selected.param.curve) }}
                  <button type="button" class="mini" @click="openCurve(selected, null)">编辑模型</button>
                </span>
              </label>
              <label class="field">
                <span>打断方式</span>
                <select :value="draftOf(selected).interrupt" @change="setInterrupt(selected, ($event.target as HTMLSelectElement).value)">
                  <option v-for="value in INTERRUPTS" :key="value" :value="value">{{ value }}</option>
                </select>
              </label>
            </div>

            <table class="channels">
              <thead>
                <tr>
                  <th>通道</th>
                  <th>模式</th>
                  <th>时长</th>
                  <th>曲线</th>
                  <th>清除</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="channel in selected.param.channels" :key="channel.channel">
                  <td>{{ CHANNEL_LABELS[channel.channel] }}</td>
                  <td>
                    <select
                      :value="channelDraft(selected, channel).mode ?? ''"
                      @change="setChannelMode(selected, channel, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">继承（blend）</option>
                      <option v-for="mode in MODES" :key="mode" :value="mode">{{ mode }}</option>
                    </select>
                    <span class="hint">{{ modeLabel(channelDraft(selected, channel).mode) }}</span>
                  </td>
                  <td>
                    <input
                      type="text"
                      class="cell"
                      :disabled="channelDraft(selected, channel).mode === 'cut'"
                      :value="channelDraft(selected, channel).duration === null ? '' : formatSeconds(channelDraft(selected, channel).duration as number)"
                      @input="setChannelDuration(selected, channel, ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <td>
                    <span class="curve-line">
                      {{ channelDraft(selected, channel).curve === null ? (channel.declaredCurve === null ? '继承（线性）' : curveLabel(channel.declaredCurve)) : curveLabel(channelDraft(selected, channel).curve) }}
                      <button
                        type="button"
                        class="mini"
                        :disabled="channelDraft(selected, channel).mode === 'cut'"
                        @click="openCurve(selected, channel)"
                      >编辑模型</button>
                    </span>
                  </td>
                  <td>
                    <button type="button" class="mini" @click="clearChannel(selected, channel)">清除</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <p v-if="selected.param.window === null" class="hint">当前无参数过渡窗口（全部 cut 或有效时长为 0 时回放按硬切）。</p>
            <p v-else class="hint">
              窗口 {{ formatSeconds(selected.param.window.start) }}s → {{ formatSeconds(selected.param.window.end) }}s
              （总宽 {{ formatSeconds(selected.param.window.width) }}s，以交界为中心）
              <span v-if="selected.param.window.truncated">；窗口被片段范围截断</span>
            </p>

            <ul v-if="paramErrors.length > 0" class="issues">
              <li v-for="(issue, index) in paramErrors" :key="`param-${index}`" :class="`sev-${issue.severity}`">
                {{ issue.message }}
              </li>
            </ul>

            <div class="actions">
              <button type="button" class="primary" :disabled="!canApplyParam" @click="applyParam(selected)">应用参数过渡</button>
              <button type="button" :disabled="!isDirty(selected)" @click="discardDraft(selected)">放弃更改</button>
              <span v-if="isDirty(selected)" class="badge warn">未应用</span>
            </div>
          </div>

          <!-- 共存卡 -->
          <div v-if="selected.state === 'coexist'" class="card">
            <div class="card-title">共存：数据同时存在，画面按区间分先后</div>
            <p class="muted">
              窗口内是 morph 单 lane；窗口外仍可能出 A/B 两条 lane。
              <span v-if="selected.coexist.coverage === 'full'">本交界窗口覆盖整个重叠区：叠化不可见。</span>
              <span v-else-if="selected.coexist.coverage === 'partial'">本交界部分遮蔽：窗口外叠化仍可见。</span>
            </p>
            <div class="actions">
              <button type="button" @click="preferCrossfade(selected)">仅保留叠化（A 的 transition 写成 cut）</button>
              <button type="button" :disabled="selected.param.type !== 'morph'" @click="preferParam(selected)">仅保留参数过渡（B 回位、删两端帧）</button>
              <button type="button" @click="keepBoth(selected)">两者保留（不改字段）</button>
            </div>
          </div>

          <div v-if="notice.length > 0" class="notice">{{ notice }}</div>
        </section>
      </div>

      <div v-if="curveEditing !== null" class="curve-sheet" role="dialog" aria-label="曲线模型编辑器">
        <div class="curve-sheet__head">
          <span>{{ curveTargetLabel() }}</span>
          <button type="button" class="mini" @click="closeCurve">完成</button>
        </div>
        <CurveEditor :value="curveDraft" @change="onCurveChange" />
        <p class="hint">编辑结果只改草稿；回到参数过渡卡点「应用参数过渡」才写盘。</p>
      </div>

      <footer class="foot">
        本地校验：{{ selected !== null ? issuesOf(selected).length : 0 }} 条
        <span v-if="selected !== null">（错误 {{ totalErrors(issuesOf(selected)) }}）</span>
        <span v-if="selected !== null && isDirty(selected)" class="badge warn">草稿未应用</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.transition-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 260px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.stats {
  display: flex;
  gap: 10px;
  color: var(--text-secondary);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filter,
.mini,
.seg,
.actions button,
.confirm button {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}

.filter.active,
.seg.active {
  border-color: var(--accent);
  color: var(--accent);
}

.actions button.primary {
  border-color: var(--accent);
  color: var(--accent);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.empty {
  padding: 24px 12px;
  color: var(--text-muted);
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.list {
  width: 240px;
  min-width: 180px;
  overflow: auto;
  margin: 0;
  padding: 4px;
  border-right: 1px solid var(--border);
  list-style: none;
}

.row {
  padding: 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
}

.row:hover {
  background: var(--bg-hover);
}

.row.selected {
  border-color: var(--accent);
  background: var(--bg-raised);
}

.row-main {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.row-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
  color: var(--text-muted);
}

.row-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.badge {
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
}

.badge.warn {
  color: var(--warning, var(--accent));
  border-color: var(--warning, var(--accent));
}

.state-coexist {
  color: var(--accent);
  border-color: var(--accent);
}

.state-broken {
  color: var(--error);
  border-color: var(--error);
}

.detail {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.detail-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.muted {
  color: var(--text-muted);
}

.card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
  background: var(--bg-raised);
}

.card.warn-card {
  border-color: var(--error);
}

.card-title {
  font-weight: 600;
  margin-bottom: 6px;
}

.bar {
  position: relative;
  padding: 2px 0 14px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.bar-tag {
  width: 14px;
  color: var(--text-muted);
}

.bar-track {
  position: relative;
  flex: 1;
  height: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.bar-clip {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
}

.bar-a {
  left: 0;
  background: var(--bg-hover);
  border: 1px solid var(--border-strong);
}

.bar-b {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  border: 1px solid var(--accent);
}

.bar-overlap {
  position: absolute;
  bottom: 0;
  height: 6px;
  background: var(--accent);
  opacity: 0.55;
  border-radius: 2px;
}

.field-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field input,
.field select,
.channels input,
.channels select {
  background: var(--bg-panel);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 2px 4px;
  font-family: var(--font-mono, monospace);
}

.channels {
  width: 100%;
  border-collapse: collapse;
  margin: 6px 0;
}

.channels th,
.channels td {
  border-top: 1px solid var(--border);
  padding: 3px 4px;
  text-align: left;
  vertical-align: middle;
}

.channels .cell {
  width: 70px;
}

.curve-line {
  display: flex;
  gap: 6px;
  align-items: center;
}

.hint {
  color: var(--text-muted);
}

.hint.ok {
  color: var(--accent);
}

.opacity-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--text-secondary);
}

.issues {
  margin: 6px 0;
  padding-left: 16px;
}

.sev-error {
  color: var(--error);
}

.sev-warning {
  color: var(--warning, var(--accent));
}

.sev-info {
  color: var(--text-secondary);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.confirm,
.notice {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  padding: 6px;
  margin-bottom: 8px;
}

.foot {
  border-top: 1px solid var(--border);
  padding: 6px 8px;
  color: var(--text-muted);
}

.curve-sheet {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-panel);
}

.curve-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
</style>
