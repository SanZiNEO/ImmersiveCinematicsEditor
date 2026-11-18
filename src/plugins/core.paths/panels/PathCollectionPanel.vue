<script setup lang="ts">
/**
 * 路径集合面板（07-05 / 07-06 / 07-08 / 07-07 / 07-10 的容器）。
 *
 * 职责边界：
 * - 本组件是面板内**唯一写入口**：新建 / 改名 / 复制 / 删除 / 生成器应用一律走 `ctx.commands.commit`；
 * - 列表、条目编辑器、几何表单、时间映射、预览画布、生成器向导由子组件渲染；
 * - 列表始终显示整份脚本的 `paths[]`，不依赖当前选中片段；路径定位用共享选择里的 `pathId`；
 * - 草稿按 `pathId` 存在面板会话里（关闭面板不丢，未提交的改动不落盘）。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { documentSnapshot, snapshotClipById, snapshotPaths } from '../../../features/paths/docAccess.ts'
import {
  buildPathRows, filterPathRows, emptyFilter, clipIdsInUse, clipTargetOptions, initialNewDraft,
  chooseClip, chooseFrom, fromEndpointOptions, resolvedTo, draftConfirmCheck, buildDefaultEntry,
  nextDraftId, validateDraftId, draftFor, setDraft, clearDraft, createPathCommand,
  updatePathCommand, duplicatePathCommand, removePathCommand, pathSelection, entryAxes,
} from '../../../features/paths/collectionPanel.ts'
import type { ClipTargetOption, NewDraftState, PathDraftMap, PathFilterState, PathRowView } from '../../../features/paths/collectionPanel.ts'
import { describeGeometry, geometryFieldIssues } from '../../../features/paths/geometryForm.ts'
import { readTimingDraft, timingDraftJson, draftIssues } from '../../../features/paths/timingEditor.ts'
import { buildPathPreview } from '../../../core/paths/preview.ts'
import {
  defaultWizardState, readCenterContext, planWizard, canApply, buildApplyPayload, endpointOptions,
} from '../../../features/paths/generatorWizard.ts'
import type { GeneratorApplyPayload, WizardState } from '../../../features/paths/generatorWizard.ts'
import PathListPane from './PathListPane.vue'
import PathEntryEditor from './PathEntryEditor.vue'
import PathPreviewCanvas from './PathPreviewCanvas.vue'
import ShapeGeneratorWizard from './ShapeGeneratorWizard.vue'

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

/** 面板取用文档的修订号（父面板自己订阅，不缓存跨修订的派生值）。 */
const revision = ref(documentService?.summary().revision ?? 0)
const unsubscribe = documentService?.subscribe((summary) => {
  revision.value = summary.revision
})
onUnmounted(() => {
  if (unsubscribe !== undefined) {
    unsubscribe()
  }
})

const doc = computed(() => {
  void revision.value
  return documentSnapshot(documentService, catalog)
})

const rows = computed<PathRowView[]>(() =>
  (doc.value === null || catalog === undefined ? [] : buildPathRows(doc.value, catalog)))
const entriesById = computed<Map<string, JsonObject>>(() => {
  const map = new Map<string, JsonObject>()
  for (const raw of snapshotPaths(doc.value)) {
    if (isJsonObject(raw) && typeof raw.id === 'string') {
      map.set(raw.id, raw)
    }
  }
  return map
})

const filter = ref<PathFilterState>(emptyFilter())
const visibleRows = computed(() => filterPathRows(rows.value, filter.value))

const clipOptions = computed(() => {
  const options = doc.value === null ? [] : clipIdsInUse(doc.value)
  return options.map((clipId) => ({ clipId, label: labelOf(clipId) }))
})

/** 条目编辑器的片段目标下拉：与 `clipTargetOptions` 同一形状（带禁用原因与节点时间）。 */
const entryClipOptions = computed<ClipTargetOption[]>(() =>
  (doc.value === null ? [] : clipTargetOptions(doc.value)))

function labelOf(clipId: string): string {
  const view = documentService?.view()
  if (view === undefined || view === null) {
    return clipId
  }
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      if (clip.clipId === clipId) {
        return `${clip.label}（${clipId}）`
      }
    }
  }
  return clipId
}

// ── 选中（共享选择的 pathId） ───────────────────────────────────────────

const selectedId = computed<string | null>(() => {
  void revision.value
  return ctx.selection.domain === 'path' ? (ctx.selection.pathId ?? null) : null
})
const selectedRow = computed<PathRowView | null>(
  () => rows.value.find((row) => row.id === selectedId.value) ?? null,
)

// ── 草稿（按 pathId，面板会话态） ────────────────────────────────────────

const drafts: PathDraftMap = new Map()
const draftTick = ref(0)
const mode = ref<'edit' | 'new'>('edit')
const newEntry = ref<JsonObject | null>(null)
const statusText = ref('')
const statusKind = ref<'info' | 'error'>('info')

const editingEntry = computed<JsonObject | null>(() => {
  void draftTick.value
  if (mode.value === 'new') {
    return newEntry.value
  }
  const id = selectedId.value
  if (id === null) {
    return null
  }
  return draftFor(drafts, id) ?? entriesById.value.get(id) ?? null
})

const editingId = computed<string>(() => {
  const entry = editingEntry.value
  return entry !== null && typeof entry.id === 'string' ? entry.id : ''
})

const existingIds = computed<string[]>(() =>
  [...entriesById.value.keys()].filter((id) => mode.value === 'new' || id !== editingId.value))

const idProblem = computed<string | null>(() => validateDraftId(editingId.value, existingIds.value))

const geometryModel = computed(() => describeGeometry(catalog, editingEntry.value?.geometry))
const geometryIssues = computed(() => geometryFieldIssues(editingEntry.value?.geometry))
const timingDraft = computed(() => readTimingDraft(editingEntry.value?.timing))
const timingIssueList = computed(() => draftIssues(timingDraft.value))

const entryClip = computed<string>(() => {
  const entry = editingEntry.value
  return entry !== null && typeof entry.clip === 'string' ? entry.clip : ''
})
const entryFrom = computed<number | null>(() => {
  const entry = editingEntry.value
  return entry !== null && typeof entry.from === 'number' ? entry.from : null
})
const fromOptions = computed(() => (doc.value === null ? [] : fromEndpointOptions(doc.value, entryClip.value)))
const toValue = computed(() => (doc.value === null ? null : resolvedTo(doc.value, entryClip.value, entryFrom.value)))

const newState = computed<NewDraftState>(() => ({
  step: 'defaults',
  clipId: entryClip.value === '' ? null : entryClip.value,
  from: entryFrom.value,
  to: toValue.value,
}))

const fieldProblems = computed<string[]>(() => {
  const problems: string[] = []
  if (idProblem.value !== null) {
    problems.push(idProblem.value)
  }
  if (entryClip.value === '') {
    problems.push('请选择目标片段')
  }
  if (entryFrom.value === null) {
    problems.push('请选择起点 A')
  } else if (toValue.value === null) {
    problems.push('起点 A 之后没有可用节点，无法确定终点 B')
  }
  if (geometryIssues.value.length > 0) {
    problems.push(`几何有 ${geometryIssues.value.length} 处问题`)
  }
  if (timingIssueList.value.length > 0) {
    problems.push(`时间映射有 ${timingIssueList.value.length} 处问题`)
  }
  const axes = editingEntry.value === undefined ? [] : entryAxes(editingEntry.value ?? undefined)
  if (axes.length === 0) {
    problems.push('至少选择一根参与轴')
  }
  if (mode.value === 'new' && doc.value !== null) {
    const gate = draftConfirmCheck(doc.value, newState.value)
    for (const reason of gate.reasons) {
      if (!problems.includes(reason)) {
        problems.push(reason)
      }
    }
  }
  return problems
})

const canSave = computed(() => editingEntry.value !== null && fieldProblems.value.length === 0)

const entryIssues = computed(() => (mode.value === 'edit' ? (selectedRow.value?.issues ?? []) : []))

/** 新建 / 编辑时的「设置片段 id」入口（07-05 §一：没有 id 的片段禁用并旁挂入口）。 */
const clipsWithoutId = computed<Array<{ clipKey: string; label: string }>>(() => {
  const view = documentService?.view()
  if (view === undefined || view === null) {
    return []
  }
  const out: Array<{ clipKey: string; label: string }> = []
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      if (clip.clipId === undefined) {
        out.push({ clipKey: clip.clipKey, label: `${clip.label}（${clip.clipKey}）` })
      }
    }
  }
  return out
})
const setIdTarget = ref('')
const setIdValue = ref('')
const setIdProblem = computed<string | null>(() => {
  if (setIdTarget.value === '') {
    return '请选择要设置 id 的片段'
  }
  const value = setIdValue.value.trim()
  if (!/^[A-Za-z0-9_]{1,32}$/.test(value)) {
    return 'id 只允许 1–32 位字母 / 数字 / 下划线'
  }
  if (existingClipIds.value.includes(value)) {
    return '该 id 已被其它片段占用'
  }
  return null
})
const existingClipIds = computed<string[]>(() => {
  const view = documentService?.view()
  if (view === undefined || view === null) {
    return []
  }
  const out: string[] = []
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      if (clip.clipId !== undefined) {
        out.push(clip.clipId)
      }
    }
  }
  return out
})

/** 提交 `clip.setId`：一次提交同步 `paths[].clip`（路径自身 id 不变）。 */
function commitSetClipId(): void {
  if (setIdProblem.value !== null) {
    statusText.value = setIdProblem.value
    statusKind.value = 'error'
    return
  }
  const result = ctx.commands.commit({
    kind: 'clip.setId',
    clipKey: setIdTarget.value,
    value: setIdValue.value.trim(),
    updateReferences: true,
  })
  if (!result.ok) {
    statusText.value = result.error ?? '设置片段 id 被拒绝。'
    statusKind.value = 'error'
    return
  }
  statusText.value = `已把 ${setIdTarget.value} 的 id 设为 ${setIdValue.value.trim()}。`
  statusKind.value = 'info'
  setIdValue.value = ''
  setIdTarget.value = ''
  for (const issue of result.warnings) {
    statusText.value += ` ${issue}`
  }
}

function touchDraft(): void {
  draftTick.value += 1
}

function commitEdit(entry: JsonObject): void {
  if (mode.value === 'new') {
    newEntry.value = entry
    return
  }
  const id = selectedId.value
  if (id === null) {
    return
  }
  setDraft(drafts, id, entry)
  touchDraft()
}

function onUpdateField(patch: Partial<JsonObject>): void {
  const base = editingEntry.value ?? {}
  const next: JsonObject = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  // 换片段后旧端点作废：端点只能来自新片段的节点并集。
  if ('clip' in patch && (next.clip as JsonValue) !== base.clip) {
    delete next.from
    delete next.to
  }
  if ('from' in patch && mode.value === 'new') {
    // A 变化后 B 由节点并集自动决定（不提供自由输入）。
    delete next.to
  }
  commitEdit(next)
}

function onGeometryChange(geometry: JsonObject): void {
  const base = editingEntry.value ?? {}
  commitEdit({ ...base, geometry })
}

function onTimingChange(draftValue: typeof timingDraft.value): void {
  const base = editingEntry.value ?? {}
  commitEdit({ ...base, timing: timingDraftJson(draftValue) })
}

function onSave(): void {
  const entry = editingEntry.value
  if (entry === null || !canSave.value) {
    statusText.value = fieldProblems.value[0] ?? '这条路径还有问题，未提交。'
    statusKind.value = 'error'
    return
  }
  const id = editingId.value
  const command = mode.value === 'new'
    ? createPathCommand(entry)
    : updatePathCommand(selectedId.value ?? id, entry)
  const outcome = ctx.commands.commit(command)
  if (!outcome.ok) {
    statusText.value = outcome.error ?? '提交被拒绝。'
    statusKind.value = 'error'
    return
  }
  const settledId = typeof entry.id === 'string' ? entry.id : id
  if (mode.value === 'edit' && selectedId.value !== null) {
    clearDraft(drafts, selectedId.value)
    touchDraft()
  }
  mode.value = 'edit'
  newEntry.value = null
  ctx.requestSelect(pathSelection(settledId))
  statusText.value = `已写入路径 ${settledId}（一次撤销可回退）。`
  statusKind.value = 'info'
}

function onCancel(): void {
  if (mode.value === 'new') {
    newEntry.value = null
    mode.value = 'edit'
    statusText.value = '已放弃新建草稿（未写入文档）。'
    statusKind.value = 'info'
    return
  }
  const id = selectedId.value
  if (id !== null) {
    clearDraft(drafts, id)
    touchDraft()
  }
  statusText.value = '已放弃未提交修改。'
  statusKind.value = 'info'
}

function onNew(): void {
  if (doc.value === null) {
    return
  }
  mode.value = 'new'
  newEntry.value = { id: nextDraftId(doc.value), axes: ['x', 'y', 'z'], geometry: { type: 'line' } }
  statusText.value = '新建路径：① 选片段 → ② 选起点 A → ③ 终点 B 自动 → ④ 确认默认值后保存。'
  statusKind.value = 'info'
}

function onSelect(pathId: string): void {
  ctx.requestSelect(pathSelection(pathId))
}

function onDuplicate(pathId: string): void {
  const source = entriesById.value.get(pathId)
  if (source === undefined || doc.value === null) {
    return
  }
  const newId = nextDraftId(doc.value)
  const outcome = ctx.commands.commit(duplicatePathCommand(source, newId))
  if (!outcome.ok) {
    statusText.value = outcome.error ?? '复制被拒绝。'
    statusKind.value = 'error'
    return
  }
  ctx.requestSelect(pathSelection(newId))
  statusText.value = `已复制为 ${newId}。`
  statusKind.value = 'info'
}

function onRemove(pathId: string): void {
  const outcome = ctx.commands.commit(removePathCommand(pathId))
  if (!outcome.ok) {
    statusText.value = outcome.error ?? '删除被拒绝。'
    statusKind.value = 'error'
    return
  }
  clearDraft(drafts, pathId)
  touchDraft()
  statusText.value = `已删除路径 ${pathId}。`
  statusKind.value = 'info'
}

function onRename(pathId: string): void {
  // 改名在条目编辑器的 id 字段里完成：先选中该条目，草稿保存时一次提交。
  ctx.requestSelect(pathSelection(pathId))
  statusText.value = `在条目编辑器的 id 字段里改名（保存时与内容一起提交）。`
  statusKind.value = 'info'
}

function onLocateClip(pathId: string): void {
  const entry = entriesById.value.get(pathId)
  if (entry === undefined || documentService === undefined) {
    return
  }
  const clipId = typeof entry.clip === 'string' ? entry.clip : ''
  const found = findClipView(clipId)
  if (found === null) {
    statusText.value = `片段 ${clipId} 不在当前文档里，无法定位。`
    statusKind.value = 'error'
    return
  }
  ctx.requestSelect({ domain: 'clip', clipKey: found.clipKey })
  documentService.setPlayhead(found.start)
}

function onLocateEndpoint(pathId: string, which: 'from' | 'to'): void {
  const entry = entriesById.value.get(pathId)
  if (entry === undefined || documentService === undefined) {
    return
  }
  const clipId = typeof entry.clip === 'string' ? entry.clip : ''
  const found = findClipView(clipId)
  const time = which === 'from' ? entry.from : entry.to
  if (found === null || typeof time !== 'number') {
    statusText.value = `端点时间缺失，无法定位。`
    statusKind.value = 'error'
    return
  }
  // 路径时间是片段局部秒；播放头是全局秒。
  documentService.setPlayhead(found.start + time)
}

function findClipView(clipId: string): { clipKey: string; start: number } | null {
  const view = documentService?.view()
  if (view === undefined || view === null) {
    return null
  }
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      if (clip.clipId === clipId) {
        return { clipKey: clip.clipKey, start: clip.start }
      }
    }
  }
  return null
}

// ── 视图标签（条目 / 预览 / 生成器） ──────────────────────────────────────

type PanelTab = 'entry' | 'preview' | 'generator'
const tab = ref<PanelTab>('entry')

const previewModel = computed(() => {
  void revision.value
  const row = selectedRow.value
  if (doc.value === null || row === null) {
    return null
  }
  return buildPathPreview(doc.value, row.index)
})

const previewAxes = computed(() => {
  const entry = selectedRow.value === null ? undefined : entriesById.value.get(selectedRow.value.id)
  return entryAxes(entry)
})

const previewSpace = computed<'world' | 'base'>(() => {
  const row = selectedRow.value
  if (row === null || doc.value === null) {
    return 'world'
  }
  const clip = snapshotClipById(doc.value, row.clipId)
  const objects = clip !== null && isJsonObject(clip.objects) ? clip.objects : null
  const space = objects !== null ? objects.position_space : undefined
  return space === 'base' ? 'base' : 'world'
})

const previewFrom = computed(() => selectedRow.value?.from ?? 0)
const previewTo = computed(() => selectedRow.value?.to ?? 0)

function onRecomputeEndpoints(): void {
  const row = selectedRow.value
  if (row === null) {
    return
  }
  // 端点由路径 itself 定义；重算入口只做定位与复核，不改文档。
  const entry = entriesById.value.get(row.id)
  const samples = previewModel.value
  if (entry === undefined || samples === null) {
    statusText.value = '没有可复核的端点（路径未选中或未解析）。'
    statusKind.value = 'error'
    return
  }
  statusText.value = `端点复核：起点 [${samples.from.map((value) => value.toFixed(3)).join(', ')}]，终点 [${samples.to.map((value) => value.toFixed(3)).join(', ')}]。`
  statusKind.value = 'info'
}

async function onPushPreview(): Promise<void> {
  if (documentService === undefined) {
    return
  }
  const result = await documentService.pushPreview()
  statusText.value = result.ok ? '已推送当前脚本到游戏预览。' : `推送失败：${result.reason ?? '未知原因'}`
  statusKind.value = result.ok ? 'info' : 'error'
}

async function onSeekPreview(time: number): Promise<void> {
  if (documentService === undefined) {
    return
  }
  await documentService.seekPreview(time)
  statusText.value = `已请求游戏定位到 ${time.toFixed(2)}s。`
  statusKind.value = 'info'
}

// ── 生成器向导 ──────────────────────────────────────────────────────────

const wizardState = ref<WizardState | null>(null)

const wizardContext = computed(() => {
  const state = wizardState.value
  if (doc.value === null || state === null) {
    return null
  }
  return readCenterContext(doc.value, state.clipId)
})

const wizardPlan = computed(() => {
  const state = wizardState.value
  if (doc.value === null || state === null) {
    return null
  }
  return planWizard(doc.value, state, wizardContext.value)
})

const wizardNodeOptions = computed(() => {
  const state = wizardState.value
  if (doc.value === null || state === null) {
    return []
  }
  return endpointOptions(doc.value, state.clipId)
})

const wizardCanApply = computed(() => {
  const plan = wizardPlan.value
  const state = wizardState.value
  if (plan === null || state === null) {
    return false
  }
  return canApply(plan, state.impactConfirmed === true)
})

const wizardPayload = computed<GeneratorApplyPayload | null>(() => {
  const plan = wizardPlan.value
  const state = wizardState.value
  if (doc.value === null || plan === null || state === null) {
    return null
  }
  const clipKey = findClipView(state.clipId)?.clipKey ?? ''
  if (clipKey === '') {
    return null
  }
  return buildApplyPayload(doc.value, state, plan, state.impactConfirmed === true, clipKey)
})

function ensureWizard(): void {
  if (wizardState.value !== null || doc.value === null) {
    return
  }
  const options = clipTargetOptions(doc.value)
  const usable = options.find((option) => option.disabledReason === null && option.clipId !== undefined && option.nodeTimes.length >= 2)
  if (usable === undefined || usable.clipId === undefined) {
    statusText.value = '没有可用于生成的 CAMERA 片段（需要 id 与至少两个位置节点）。'
    statusKind.value = 'error'
    return
  }
  const times = usable.nodeTimes
  wizardState.value = defaultWizardState(usable.clipId, times[0], times[1])
}

watch(tab, (value) => {
  if (value === 'generator') {
    ensureWizard()
  }
})

function onWizardUpdateState(state: WizardState): void {
  wizardState.value = state
}

function onWizardConfirmImpact(): void {
  const state = wizardState.value
  if (state === null) {
    return
  }
  wizardState.value = { ...state, impactConfirmed: true }
}

function onWizardApply(payload: GeneratorApplyPayload): void {
  if (mode.value === 'new') {
    statusText.value = '先保存或放弃正在编辑的新路径，再应用生成器。'
    statusKind.value = 'error'
    return
  }
  if (payload.commands.length === 0 || payload.selectPathId === '') {
    statusText.value = '生成计划无效，未提交。'
    statusKind.value = 'error'
    return
  }
  const outcome = ctx.commands.commit({ kind: 'compound', commands: payload.commands })
  if (!outcome.ok) {
    statusText.value = outcome.error ?? '生成器提交被拒绝。'
    statusKind.value = 'error'
    return
  }
  ctx.requestSelect(pathSelection(payload.selectPathId))
  const found = findClipView(wizardState.value?.clipId ?? '')
  if (documentService !== undefined && found !== null) {
    documentService.setPlayhead(found.start + payload.seekTime)
  }
  statusText.value = `已生成并选中 ${payload.selectPathId}（一次撤销可回退）。`
  statusKind.value = 'info'
  wizardState.value = null
  tab.value = 'entry'
}

function onWizardCancel(): void {
  wizardState.value = null
  tab.value = 'entry'
  statusText.value = '已取消生成。'
  statusKind.value = 'info'
}

const newDisabledReason = computed(() => (doc.value === null ? '没有打开的文档' : ''))
</script>

<template>
  <section class="paths-panel" aria-label="路径集合">
    <p v-if="documentService === undefined || catalog === undefined" class="paths-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>
    <template v-else>
      <nav class="paths-panel__tabs" role="tablist" aria-label="路径视图">
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'entry'"
          :class="['paths-panel__tab', { 'paths-panel__tab--active': tab === 'entry' }]"
          @click="tab = 'entry'"
        >
          条目编辑
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'preview'"
          :class="['paths-panel__tab', { 'paths-panel__tab--active': tab === 'preview' }]"
          :disabled="selectedRow === null"
          :title="selectedRow === null ? '先选中一条路径' : '预览当前选中路径'"
          @click="tab = 'preview'"
        >
          预览
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'generator'"
          :class="['paths-panel__tab', { 'paths-panel__tab--active': tab === 'generator' }]"
          :disabled="doc === null"
          @click="tab = 'generator'"
        >
          形状生成器
        </button>
        <span class="paths-panel__count">{{ visibleRows.length }} / {{ rows.length }} 条路径</span>
      </nav>

      <div class="paths-panel__body" :class="{ 'paths-panel__body--generator': tab === 'generator' }">
        <PathListPane
          v-if="tab !== 'generator'"
          class="paths-panel__list"
          :rows="visibleRows"
          :filter="filter"
          :clip-options="clipOptions"
          :selected-path-id="selectedId"
          :new-disabled-reason="newDisabledReason"
          @new="onNew"
          @update:clip-filter="filter = { ...filter, clipId: $event }"
          @update:search="filter = { ...filter, search: $event }"
          @toggle-only-issues="filter = { ...filter, onlyIssues: !filter.onlyIssues }"
          @select="onSelect"
          @rename="onRename"
          @duplicate="onDuplicate"
          @remove="onRemove"
          @locate-clip="onLocateClip"
          @locate-endpoint="onLocateEndpoint"
        />

        <div v-if="tab === 'entry'" class="paths-panel__main">
          <!-- 07-05 §一：没有 id 的 CAMERA 片段旁挂「设置片段 id」入口 -->
          <div v-if="clipsWithoutId.length > 0" class="paths-panel__setid">
            <span class="paths-panel__setid-title">有 {{ clipsWithoutId.length }} 个片段还没有 id：</span>
            <select v-model="setIdTarget" class="paths-panel__input">
              <option value="">选择片段</option>
              <option v-for="option in clipsWithoutId" :key="option.clipKey" :value="option.clipKey">
                {{ option.label }}
              </option>
            </select>
            <input v-model="setIdValue" class="paths-panel__input" placeholder="新片段 id" />
            <button type="button" class="paths-panel__button" :disabled="setIdProblem !== null" @click="commitSetClipId">
              设置片段 id
            </button>
            <span v-if="setIdProblem !== null" class="paths-panel__hint">{{ setIdProblem }}</span>
          </div>
          <PathEntryEditor
            :entry="editingEntry"
            :issues="entryIssues"
            :clip-options="entryClipOptions"
            :from-options="fromOptions"
            :to-value="toValue"
            :model="geometryModel"
            :geometry-issues="geometryIssues"
            :timing-draft="timingDraft"
            :timing-issues="timingIssueList"
            :can-save="canSave"
            :save-reasons="fieldProblems"
            @update-field="onUpdateField"
            @geometry-change="onGeometryChange"
            @timing-change="onTimingChange"
            @save="onSave"
            @cancel="onCancel"
          />
        </div>

        <div v-else-if="tab === 'preview'" class="paths-panel__main">
          <PathPreviewCanvas
            :model="previewModel"
            :entry-axes="previewAxes"
            :space="previewSpace"
            :from-time="previewFrom"
            :to-time="previewTo"
            @push="onPushPreview"
            @seek="onSeekPreview"
            @recompute-endpoints="onRecomputeEndpoints"
          />
        </div>

        <div v-else class="paths-panel__main paths-panel__main--generator">
          <ShapeGeneratorWizard
            v-if="wizardState !== null && wizardPlan !== null"
            :state="wizardState"
            :context="wizardContext"
            :plan="wizardPlan"
            :node-options="wizardNodeOptions"
            :can-apply="wizardCanApply"
            :impact-confirmed="wizardState.impactConfirmed === true"
            :payload="wizardPayload"
            @update:state="onWizardUpdateState"
            @confirm-impact="onWizardConfirmImpact"
            @apply="onWizardApply"
            @cancel="onWizardCancel"
          />
          <p v-else class="paths-panel__empty">
            没有可用于生成的片段（需要 CAMERA 片段、有 id、且位置节点至少两个）。
          </p>
        </div>
      </div>

      <footer
        v-if="statusText !== ''"
        class="paths-panel__status"
        :class="{ 'paths-panel__status--error': statusKind === 'error' }"
        role="status"
      >
        {{ statusText }}
      </footer>
    </template>
  </section>
</template>

<style scoped>
.paths-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.paths-panel__notice {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  color: var(--warning);
}

.paths-panel__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}

.paths-panel__tab {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.paths-panel__tab--active {
  border-color: var(--border-strong);
  color: var(--text);
}

.paths-panel__tab:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.paths-panel__tab:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.paths-panel__count {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.paths-panel__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  gap: 0;
}

.paths-panel__body--generator {
  overflow: auto;
}

.paths-panel__list {
  flex: 0 0 auto;
  width: 258px;
  min-height: 0;
  border-right: 1px solid var(--border);
  overflow: auto;
}

.paths-panel__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.paths-panel__main--generator {
  overflow: visible;
}

.paths-panel__setid {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 8px 12px 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-raised, transparent);
  font-size: 11px;
  color: var(--text-secondary);
}

.paths-panel__setid-title {
  color: var(--warning, var(--text-secondary));
}

.paths-panel__input {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface);
  color: var(--text);
  font-size: 11px;
}

.paths-panel__button {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.paths-panel__button:disabled {
  opacity: 0.5;
  cursor: default;
}

.paths-panel__hint {
  color: var(--error);
}

.paths-panel__empty {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.paths-panel__status {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
}

.paths-panel__status--error {
  color: var(--error);
}
</style>
