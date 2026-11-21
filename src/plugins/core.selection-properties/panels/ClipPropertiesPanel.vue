<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import { hiddenRowsFor, panelBannerFor } from '../../../workbench/api/fieldSurface.ts'
import {
  clipTimingOf,
  findClipContext,
  propertyRowsFor,
  separateUnknownGroup,
  withAvailability,
} from '../../../features/effects/clipContext.ts'
import { buildDiagnosticIndex } from '../../../features/effects/diagnostics.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import { addKeyframeCommand, removeKeyframeCommands } from '../../../features/effects/keyframeOps.ts'
import { sampleValue, segmentIndexAt } from '../../../features/effects/easing.ts'
import { easingKey, readEasingTable } from '../../../features/effects/easingStore.ts'
import { animatable, seedForNewNode } from '../../../features/effects/valueControls.ts'
import type { InspectorCommitOutcome, InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import type {
  DiagnosticIndex,
  EffectDiagnostic,
  EffectGroup,
  PropertyRow,
} from '../../../features/effects/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import ClipPropertiesHeader from './ClipPropertiesHeader.vue'
import ClipPropertyGroup from './ClipPropertyGroup.vue'
import ClipPropertyRow from './ClipPropertyRow.vue'
import BreathInspectorCard from './BreathInspectorCard.vue'
import { inspectorOptions, inspectorPages } from './inspectorLayout.ts'
import MotionChannelRow from './MotionChannelRow.vue'
import ModelEditorDrawer from './ModelEditorDrawer.vue'
import { channelDomain, isChannelField } from '../../../features/paths/modelEditor.ts'
import { stepFieldApplies } from '../../../features/authoring/positionForm.ts'
import { positionSwitchAlignment } from './inspectorPositionSwitch.ts'
import type { ApplyItem } from '../../../features/authoring/ui/positionFields.ts'
import {
  loadAuthoringGroups,
  type AuthoringGroup,
  type GroupRegistry,
} from '../../../features/authoring/groups.ts'
import { matchAuthoringGroup, rowPaths, customGroupsToJson } from '../../../features/authoring/ui/groupPopover.ts'
import PositionGroupEditor from './PositionGroupEditor.vue'
import OrientationGroupEditor from './OrientationGroupEditor.vue'
import GroupEditPopover from './GroupEditPopover.vue'
import { documentSnapshot } from '../../../features/paths/docAccess.ts'
import {
  POSITION_NODE_PATHS, pathsBreakingOnInsert, pathsUsingEndpoint, withPathRemoval,
} from '../../../features/paths/integrity.ts'
import type { AffectedPath } from '../../../features/paths/integrity.ts'
import DiagnosticsBar from '../../../features/effects/panels/DiagnosticsBar.vue'
import { requestFocus } from '../../../features/behavior/focus.ts'
import type { ClipEventContext } from '../../../features/behavior/events.ts'
import {
  summariesForClip,
  recordRefAt,
} from '../../core.clip-effects/panels/eventRecordSummary.ts'
import type { OpenEventEditorPayload } from '../../../features/effects/panels/effectRowEvents.ts'

const ctx = usePanelContext()

/**
 * 片段时间几何字段（`playControl`）：由主时间轴编辑，属性面板不渲染值控件。
 *
 * 与 `core/schema/catalog/tracks.ts` 的 `PLAY_CONTROL_FIELDS` 同集合；
 * 这里只列路径名，不复制字段定义（类型/默认值仍从目录取）。
 */
const CLIP_GEOMETRY_PATHS: ReadonlySet<string> = new Set([
  'start_time',
  'duration',
  'loop',
  'loop_count',
  'loop_mode',
])
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})

const summary = computed(() => {
  void revision.value
  return documentService?.summary() ?? null
})

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const clipKey = computed<string | null>(() => (state.value.kind === 'clip' ? state.value.clipKey : null))

const clipContext = computed(() => {
  const key = clipKey.value
  if (key === null) {
    return null
  }
  return findClipContext(view.value, key)
})

const objects = computed<JsonObject | null>(() => {
  void revision.value
  const key = clipKey.value
  if (key === null) {
    return null
  }
  return documentService?.clipObjects(key) ?? null
})

const timing = computed<ClipTiming>(() => {
  const found = clipContext.value
  if (found === null) {
    return { duration: 0, infinite: false }
  }
  return clipTimingOf(found.clip)
})

/** 全部属性行（含未设置与未知路径）。 */
const rows = computed<PropertyRow[]>(() => {
  void revision.value
  const found = clipContext.value
  const key = clipKey.value
  const currentObjects = objects.value
  if (found === null || key === null || currentObjects === null) {
    return []
  }
  if (catalog === undefined) {
    return []
  }
  const built = propertyRowsFor({
    clipKey: key,
    trackType: found.trackType,
    objects: currentObjects,
    catalog,
    panel: 'properties',
  })
  const hidden = hiddenRowsFor(found.trackType, currentObjects)
  const visible = built.filter((row) => !CLIP_GEOMETRY_PATHS.has(row.path) && !hidden.has(row.path))
  return withAvailability(separateUnknownGroup(visible), catalog, found.trackType, currentObjects)
})

const pages = computed(() => {
  const found = clipContext.value
  return found === null || objects.value === null
    ? [] : inspectorPages(found.trackType, rows.value, objects.value, timing.value)
})
const camera = computed(() => clipContext.value?.trackType === 'CAMERA')
const activePageKey = ref('')
const activePage = computed(() => pages.value.find((page) => page.key === activePageKey.value) ?? pages.value[0])
const globalPlayhead = computed(() => {
  void revision.value
  return documentService?.sessionView().playhead ?? 0
})
const playhead = computed(() => Number((globalPlayhead.value - (clipContext.value?.clip.start ?? 0)).toFixed(9)))

interface ClipInspectorSession {
  page: string
  expanded: Map<string, boolean>
  scrollByPage: Map<string, number>
}

const sessions = new Map<string, ClipInspectorSession>()
const session = shallowRef<ClipInspectorSession | null>(null)
const expanded = ref(new Map<string, boolean>())
const scrollRef = ref<HTMLElement | null>(null)
const tabsRef = ref<HTMLElement | null>(null)
const focusedPath = ref<string | null>(null)
const focusMessage = ref('')
const focusMessageKind = ref<'info' | 'error'>('info')
const pendingGuard = shallowRef<{
  affected: AffectedPath[]
  command: DocCommand
  fillAxes: boolean
  successText: string
} | null>(null)

watch(() => summary.value?.path, () => { sessions.clear() })
watch([clipKey, () => summary.value?.path], ([key]) => {
  let saved = key === null ? undefined : sessions.get(key)
  if (key !== null && saved === undefined) {
    saved = { page: '', expanded: new Map(), scrollByPage: new Map() }
    sessions.set(key, saved)
  }
  session.value = saved ?? null
  activePageKey.value = saved?.page ?? ''
  expanded.value = new Map(saved?.expanded)
  focusedPath.value = null
  focusMessage.value = ''
  pendingGuard.value = null
  closeGroupPopover()
  closeModelEditor()
  restoreScroll()
})
watch([playhead, () => summary.value?.revision], () => { pendingGuard.value = null })

function restoreScroll(): void {
  void nextTick(() => {
    if (scrollRef.value !== null) scrollRef.value.scrollTop = session.value?.scrollByPage.get(activePage.value?.key ?? '') ?? 0
  })
}

function onScroll(event: Event): void {
  const key = activePage.value?.key
  if (key !== undefined) session.value?.scrollByPage.set(key, (event.target as HTMLElement).scrollTop)
}

function activatePage(key: string): void {
  if (activePage.value?.key === key) return
  activePageKey.value = key
  if (session.value !== null) session.value.page = key
  closeGroupPopover()
  closeModelEditor()
  restoreScroll()
}

function navigateTabs(event: KeyboardEvent, index: number): void {
  const count = pages.value.length
  let next: number
  if (event.key === 'ArrowLeft') next = (index - 1 + count) % count
  else if (event.key === 'ArrowRight') next = (index + 1) % count
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = count - 1
  else return
  event.preventDefault()
  activatePage(pages.value[next].key)
  void nextTick(() => tabsRef.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}

function isCollapsed(groupKey: string): boolean {
  return !(expanded.value.get(groupKey) ?? activePage.value?.initiallyOpen.includes(groupKey) ?? false)
}

function setExpansion(groupKey: string, open: boolean): void {
  expanded.value.set(groupKey, open)
  session.value?.expanded.set(groupKey, open)
}

function toggleCollapse(groupKey: string): void {
  setExpansion(groupKey, isCollapsed(groupKey))
}

function lensEditor(key: string): typeof PositionGroupEditor | typeof OrientationGroupEditor | null {
  if (!camera.value) return null
  if (key === 'position') return PositionGroupEditor
  if (key === 'orientation') return OrientationGroupEditor
  return null
}

function fieldOptions(row: PropertyRow, overrides?: InspectorValueOptions): InspectorValueOptions | undefined {
  const options = overrides ?? inspectorOptions(row)
  if (camera.value && row.interp === 'step' && stepFieldApplies(row.path, true)) {
    return { ...options, commit: commitInspectorEdit }
  }
  return options
}

const optionsByPath = computed(() => {
  const options = new Map<string, InspectorValueOptions>()
  for (const group of activePage.value?.groups ?? []) {
    for (const row of group.rows) {
      const entry = fieldOptions(row)
      if (entry !== undefined) options.set(row.path, entry)
    }
  }
  return options
})

// ── 诊断 ─────────────────────────────────────────────────────

const diagnostics = ref<DiagnosticIndex>({ byRow: new Map(), byNode: new Map(), byGroup: new Map() })
let diagnosticTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 诊断索引：必填缺失是本地纯函数算的（`isRequiredMissing`），不依赖服务端；
 * 只有文档摘要说"有 issue"或"服务端过期"时才真发一次校验请求，避免每次编辑都打服务端。
 */
async function refreshDiagnostics(): Promise<void> {
  if (documentService === null || documentService === undefined) {
    return
  }
  const current = summary.value
  if (current === null || current.docId === null) {
    diagnostics.value = { byRow: new Map(), byNode: new Map(), byGroup: new Map() }
    return
  }
  if (current.issueCount === 0 && !current.stale) {
    diagnostics.value = buildDiagnosticIndex([], rows.value, 'leaf', {
      ...(clipKey.value === null ? {} : { clipKey: clipKey.value }),
      timing: timing.value,
    })
    return
  }
  const outcome = await documentService.validate()
  diagnostics.value = buildDiagnosticIndex(outcome.issues, rows.value, 'leaf', {
    ...(clipKey.value === null ? {} : { clipKey: clipKey.value }),
    timing: timing.value,
  })
}

watch(
  [() => summary.value?.revision, clipKey, () => summary.value?.issueCount, () => summary.value?.stale],
  () => {
    if (diagnosticTimer !== undefined) {
      clearTimeout(diagnosticTimer)
    }
    diagnosticTimer = setTimeout(() => {
      diagnosticTimer = undefined
      void refreshDiagnostics()
    }, 350)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(diagnosticTimer))

const rowDiagnostics = computed<ReadonlyMap<string, readonly EffectDiagnostic[]>>(() => diagnostics.value.byRow)

// ── 选择联动与定位 ───────────────────────────────────────────

function markFocused({ path }: { path: string }): void {
  focusedPath.value = path
}

function revealRow(path: string): void {
  for (const page of pages.value) {
    const group = page.groups.find((entry) => entry.rows.some((row) => row.path === path))
    if (group === undefined) continue
    activatePage(page.key)
    setExpansion(group.key, true)
    focusedPath.value = path
    void nextTick(() => {
      const target = scrollRef.value?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      if (target === undefined || target === null) return
      for (let ancestor = target.parentElement; ancestor !== null && ancestor !== scrollRef.value; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      }
      target.scrollIntoView({ block: 'nearest' })
      // 不从效果面板抢键盘焦点。当前行的高亮用于定位。
    })
    return
  }
}

const fieldSelection = computed(() => {
  const selected = state.value
  if (selected.kind !== 'clip') return null
  const { selection } = selected
  return selection.domain === 'object' || selection.domain === 'keyframe' ? selection : null
})
watch([clipKey, () => fieldSelection.value?.objectPath, () => fieldSelection.value?.keyframeTime], ([key, path]) => {
  if (key !== null && path !== undefined) {
    void nextTick(() => {
      if (clipKey.value === key && fieldSelection.value?.objectPath === path) revealRow(path)
    })
  }
}, { immediate: true })

function revealEffects(payload: { clipKey: string; path: string }): void {
  ctx.requestRevealInEffectControls({ clipKey: payload.clipKey, objectPath: payload.path })
}

// ── 事件记录摘要（11-14：唯一详情编辑器在行为页抽屉，本面板只留摘要 + 跳转） ──

const eventContext = computed<ClipEventContext | null>(() => {
  const found = clipContext.value
  if (found === null) {
    return null
  }
  const clip = found.clip
  return {
    clipStartTime: clip.start,
    duration: clip.infinite ? -1 : clip.duration,
    infinite: clip.infinite,
  }
})

const eventSummary = computed(() => {
  const key = clipKey.value
  const ctxEvent = eventContext.value
  if (key === null || ctxEvent === null || documentService === undefined) {
    return null
  }
  return summariesForClip(documentService.root(), documentService.clips(), key, ctxEvent)
})

const eventSummaryMap = computed<ReadonlyMap<string, readonly string[]>>(() => {
  const summary = eventSummary.value
  const map = new Map<string, string[]>()
  if (summary === null) {
    return map
  }
  for (const entry of summary.entries) {
    map.set(entry.path, entry.summaries)
  }
  return map
})

/** 行为抽屉页签 id（与 `core.behavior` manifest 的 drawerTab 注册一致）。 */
const BEHAVIOR_DRAWER_TAB = 'behavior'

/** 「在行为页打开」：先打开 / 激活行为抽屉页签，再把记录身份交给抽屉；不在本面板挂载第二套编辑器。 */
function openInBehavior(payload: OpenEventEditorPayload): void {
  const summary = eventSummary.value
  const entry = summary?.entries.find((item) => item.path === payload.path)
  const ref = entry === undefined ? null : recordRefAt(entry, payload.time)
  if (ref === null) {
    focusedPath.value = null
    ctx.status.notify('该事件对象暂无记录，可在行为页新建', 'info')
    return
  }
  ctx.requestOpenDrawer(BEHAVIOR_DRAWER_TAB)
  requestFocus({ target: ref, surface: 'behavior-drawer', origin: ctx.panelId })
}

/**
 * 菱形：播放头有帧 → 删该帧；无帧 → 建帧。
 *
 * 初值按 06-05 的回退链（播放头采样 → 静态值 → 目录默认值）；都没有则提示先输入静态值。
 * 与效果面板同一套命令，保证两个面板行为一致。
 *
 * 07-05 §四：位置三轴的节点被删 / 被插时，先扫描受影响的路径；有影响就**阻止**并让作者
 * 显式选「删除这些路径并继续 / 取消」，删除与帧操作在同一次 `compound` 里。
 */
function onToggleKeyframe(payload: { clipKey: string; path: string; time: number; create: boolean }): void {
  const row = rows.value.find((item) => item.path === payload.path)
  if (row === undefined) {
    return
  }
  let frameCommand: DocCommand | null
  let text: string
  if (!payload.create) {
    frameCommand = removeKeyframeCommands(payload.clipKey, [{ path: payload.path, time: payload.time }])
    text = `已删除 ${payload.path} 在 ${payload.time.toFixed(2)}s 的关键帧。`
  } else {
    const sampled = sampleInspectorRow(row, payload.time)
    const seed = seedForNewNode(row, sampled.ok ? sampled.value : undefined, payload.time)
    if (!seed.ok || seed.value === undefined) {
      focusedPath.value = payload.path
      return
    }
    frameCommand = addKeyframeCommand(payload.clipKey, row, payload.time, seed.value)
    text = `已在 ${payload.time.toFixed(2)}s 创建 ${payload.path} 的关键帧。`
  }
  if (frameCommand === null) {
    return
  }
  const switchGuard = stagePositionStepGuard([frameCommand])
  if (switchGuard !== null) {
    if (!switchGuard.pending) {
      focusMessage.value = switchGuard.error
      focusMessageKind.value = 'error'
    }
    return
  }
  if (POSITION_NODE_PATHS.includes(payload.path)) {
    const affected = affectedPositionPaths(payload.time, payload.create)
    if (affected.length > 0) {
      pendingGuard.value = {
        affected,
        command: withPathRemoval(frameCommand, affected),
        fillAxes: false,
        successText: `已删除 ${affected.length} 条受影响路径。${text}`,
      }
      return
    }
  }
  commitKeyframeCommand(frameCommand, text)
}

/** 使用值控件同一条作者态曲线，避免补帧时的值与面板当前采样不同。 */
function sampleInspectorRow(row: PropertyRow, time: number): ReturnType<typeof sampleValue> {
  const index = segmentIndexAt(row.keyframes, time)
  const fromTime = index < 0 ? undefined : row.keyframes[index]?.time
  const toTime = row.keyframes[index + 1]?.time
  const entry = fromTime === undefined || toTime === undefined ? undefined
    : readEasingTable(ctx.commands.clipAuthoringOf(row.clipKey))[easingKey(row.path, fromTime, toTime)]
  return sampleValue({
    frames: row.keyframes, interp: row.interp, time, timing: timing.value,
    ...(entry !== undefined && fromTime !== undefined && toTime !== undefined
      ? { easing: { ...entry, clipKey: row.clipKey, path: row.path, fromTime, toTime } }
      : {}),
  })
}

function commitInspectorEdit(commands: DocCommand[], coalesceKey: string): InspectorCommitOutcome {
  const guard = stagePositionStepGuard(commands)
  if (guard === null) return ctx.commands.commitBatch(commands, coalesceKey)
  return guard.pending ? { ok: false, pending: true } : { ok: false, warnings: [], error: guard.error }
}

function stagePositionStepGuard(commands: readonly DocCommand[]): { pending: true } | { pending: false; error: string } | null {
  const key = clipKey.value
  const current = objects.value
  const write = commands[commands.length - 1]
  if (!camera.value || key === null || current === null || write === undefined) return null
  const alignment = positionSwitchAlignment(rows.value, current, timing.value, write)
  if (alignment.size === 0) return null

  const ops: Array<{ op: 'add'; path: string; time: number; value: JsonValue }> = []
  const affectedById = new Map<string, AffectedPath>()
  for (const [time, missing] of alignment) {
    for (const path of missing) {
      const row = rows.value.find((item) => item.path === path)
      const sampled = row === undefined ? undefined : sampleInspectorRow(row, time)
      const seed = row === undefined ? undefined : seedForNewNode(row, sampled?.ok ? sampled.value : undefined, time)
      if (seed?.ok !== true || seed.value === undefined) {
        return { pending: false, error: path + ' 在 ' + time + 's 没有可用值，请先设置该位置轴。' }
      }
      ops.push({ op: 'add', path, time, value: seed.value })
    }
    for (const affected of affectedPositionPaths(time, true)) affectedById.set(affected.id, affected)
  }

  const affected = [...affectedById.values()]
  const command: DocCommand = {
    kind: 'compound',
    commands: [{ kind: 'object.editKeyframes', clipKey: key, ops }, ...commands],
  }
  pendingGuard.value = {
    affected,
    command: withPathRemoval(command, affected),
    fillAxes: true,
    successText: affected.length > 0
      ? '已移除 ' + affected.length + ' 条受影响路径，并补齐 ' + ops.length + ' 个位置帧。'
      : '已补齐 ' + ops.length + ' 个位置帧并应用参考系设置。',
  }
  return { pending: true }
}

/** 扫描移动路径所引用的位置节点，供删除节点和插入节点时确认。 */
function affectedPositionPaths(time: number, create: boolean): AffectedPath[] {
  const clipId = clipContext.value?.clip.clipId
  if (!clipId || documentService === undefined || catalog === undefined) return []
  const doc = documentSnapshot(documentService, catalog)
  if (doc === null) return []
  return create ? pathsBreakingOnInsert(doc, clipId, time) : pathsUsingEndpoint(doc, clipId, time)
}

function confirmGuard(): void {
  const pending = pendingGuard.value
  if (pending === null) {
    return
  }
  pendingGuard.value = null
  commitKeyframeCommand(pending.command, pending.successText)
}

function cancelGuard(): void {
  pendingGuard.value = null
  focusMessage.value = '已取消，没有更改文档。'
  focusMessageKind.value = 'info'
}

/** 前后帧跳转：只移播放头（会话写入，不进文档）。 */
function onJumpKeyframe(payload: { clipKey: string; path: string; time: number }): void {
  const found = clipContext.value
  if (found === null || documentService === undefined) {
    return
  }
  // 片段局部秒 → 全局秒：加上片段起点（`ClipViewEntry.start` 已是全局秒）。
  documentService.setPlayhead(found.clip.start + payload.time)
}

/** 提交一条命令；失败时把焦点移到该行（不伪造成功）。 */
function commitKeyframeCommand(command: DocCommand | null, successText: string): void {
  if (command === null) {
    return
  }
  const outcome = ctx.commands.commit(command)
  if (outcome.ok) {
    focusMessage.value = successText
    focusMessageKind.value = 'info'
    return
  }
  focusMessage.value = outcome.error ?? '命令被拒绝。'
  focusMessageKind.value = 'error'
}

// ── 07 位置组 / 朝向组控制条 + 组合弹层 ───────────────────────

const authoringGroupRegistry = computed<GroupRegistry>(() => {
  void revision.value
  const config: GroupRegistry = catalog === undefined
    ? { groups: [], errors: [] }
    : loadAuthoringGroups(catalog)
  // 自定义组只活在内存（`doc.authoring.groups`），不写盘、不进撤销。
  const custom = ctx.commands.authoringGroups() as unknown as AuthoringGroup[]
  return { groups: [...config.groups, ...custom], errors: config.errors }
})

/** 组头按钮要显示的组合名：按组内行路径与注册表组的最长交集匹配。 */
function authoringGroupName(group: EffectGroup): string | null {
  return matchAuthoringGroup(rowPaths(group.rows), authoringGroupRegistry.value, group.key).group?.name ?? null
}

const popoverGroupKey = ref<string | null>(null)
const popoverGroup = computed<EffectGroup | null>(() => {
  const key = popoverGroupKey.value
  if (key === null) {
    return null
  }
  return activePage.value?.groups.find((group) => group.key === key) ?? null
})

function openGroupPopover(groupKey: string): void {
  popoverGroupKey.value = groupKey
}

function closeGroupPopover(): void {
  popoverGroupKey.value = null
}

/** 组合四动作 / 控制条的写入计划：多条并成一次 compound，一次撤销全回退。 */
function applyItems(items: ApplyItem[]): void {
  if (items.length === 0) {
    return
  }
  const commands = items.map((item) => item.command)
  const command: DocCommand = commands.length === 1 ? commands[0] : { kind: 'compound', commands }
  const outcome = ctx.commands.commit(command)
  if (outcome.ok) {
    focusMessage.value = items[items.length - 1].successText
    focusMessageKind.value = 'info'
    return
  }
  focusMessage.value = outcome.error ?? '组合写入被拒绝。'
  focusMessageKind.value = 'error'
}

/** 自定义组合定义：只改内存态，保存 / 推送 / 导出都不含它。 */
function onGroupsChange(groups: AuthoringGroup[]): void {
  const outcome = ctx.commands.setAuthoringGroups(customGroupsToJson(groups))
  if (outcome.ok) {
    focusMessage.value = '自定义组合定义已更新（不进撤销、不写盘）。'
    focusMessageKind.value = 'info'
    return
  }
  focusMessage.value = outcome.error ?? '组合定义被拒绝。'
  focusMessageKind.value = 'error'
}

// ── 模型通道（07-09）：六行摘要 + 右侧滑出编辑器 ─────────────

interface ModelEditorTarget {
  clipKey: string
  path: string
  domain: string
}

const modelEditor = ref<ModelEditorTarget | null>(null)

/** `clips[].objects[path].value`；字段缺失或不是对象都当「未设置」。 */
function modelValueOf(path: string): JsonValue | undefined {
  const objs = objects.value
  if (objs === null) {
    return undefined
  }
  const raw = objs[path]
  if (!isJsonObject(raw)) {
    return undefined
  }
  return raw.value
}

function openModelEditor(payload: { clipKey: string; path: string }): void {
  modelEditor.value = { clipKey: payload.clipKey, path: payload.path, domain: channelDomain(payload.path) }
}

function closeModelEditor(): void {
  modelEditor.value = null
}

/** 应用 / 重置：一次 commit 一次撤销；`undefined` = 回到未设置（删掉该字段条目）。 */
function commitModel(value: JsonValue | undefined): void {
  const target = modelEditor.value
  if (target === null) {
    return
  }
  const command: DocCommand = value === undefined
    ? { kind: 'object.remove', clipKey: target.clipKey, path: target.path }
    : { kind: 'object.setValue', clipKey: target.clipKey, path: target.path, value }
  const outcome = ctx.commands.commit(command)
  if (outcome.ok) {
    focusMessage.value = `${target.path} 模型已写入（一次撤销可回退）。`
    focusMessageKind.value = 'info'
  } else {
    focusMessage.value = outcome.error ?? '模型写入被拒绝。'
    focusMessageKind.value = 'error'
  }
}


const modelTargetModel = computed<JsonValue | undefined>(() => {
  const target = modelEditor.value
  return target === null ? undefined : modelValueOf(target.path)
})

// ── 状态辅助 ─────────────────────────────────────────────────

const multiClips = computed(() => {
  const selected = state.value
  if (selected.kind !== 'multi') return []
  return selected.clipKeys.flatMap((key) => {
    const found = findClipContext(view.value, key)
    return found === null ? [] : [{ key, clip: found.clip }]
  })
})

const invalidReason = computed(() => (state.value.kind === 'invalid' ? state.value.reason : ''))

const foreignLabel = computed(() => {
  const selected = state.value
  return selected.kind === 'foreign' ? { path: '路径', rule: '规则', binding: '规则绑定' }[selected.domain] : ''
})

const canUndo = computed(() => {
  void revision.value
  return ctx.commands.canUndo
})

function runUndo(): void {
  ctx.commands.undo()
}

/** 10 轮面板横幅（音频约束 / 调色层覆盖提示）；没有贡献就是 null。 */
const bannerTrackType = computed(() => clipContext.value?.trackType)
const bannerComponent = computed<Component | null>(() => {
  const type = bannerTrackType.value
  if (type === undefined) return null
  const banner = panelBannerFor(type)
  return banner === null ? null : defineAsyncComponent(banner.component as () => Promise<Component>)
})
</script>

<template>
  <section class="props-panel" aria-label="属性">
    <p v-if="documentService === undefined" class="props-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>

    <template v-else>
      <!-- 片段态 -->
      <template v-if="state.kind === 'clip' && clipKey !== null">
        <template v-if="clipContext !== null && objects !== null">
          <ClipPropertiesHeader :clip="clipContext.clip" :track-type="clipContext.trackType" :summary="summary" :playhead="globalPlayhead" />
          <div v-if="pages.length > 1" ref="tabsRef" class="props-panel__tabs" role="tablist" aria-label="片段功能">
            <button
              v-for="(page, index) in pages"
              :id="`inspector-tab-${page.key}`"
              :key="page.key"
              type="button"
              role="tab"
              :aria-selected="page.key === activePage?.key"
              :tabindex="page.key === activePage?.key ? 0 : -1"
              aria-controls="inspector-fields"
              @click="activatePage(page.key)"
              @keydown="navigateTabs($event, index)"
            >{{ page.label }}</button>
          </div>

          <component
            :is="bannerComponent"
            v-if="bannerComponent !== null && (!camera || activePage?.key === 'color')"
            :clip-key="clipKey"
          />

          <div v-if="pendingGuard !== null" class="props-panel__guard" role="alert">
            <p v-if="pendingGuard.fillAxes" class="props-panel__guard-text">
              参考系切换需要同一时刻的三轴位置帧。可以用该时刻的采样值补齐。
            </p>
            <p v-if="pendingGuard.affected.length" class="props-panel__guard-text">
              这次编辑会使以下路径失效。确认后将同时移除这些路径。
            </p>
            <ul v-if="pendingGuard.affected.length" class="props-panel__guard-list">
              <li v-for="item in pendingGuard.affected" :key="item.id">{{ item.id }} · {{ item.reason }}</li>
            </ul>
            <div class="props-panel__guard-actions">
              <button type="button" class="props-panel__button" @click="confirmGuard">
                {{ pendingGuard.affected.length ? (pendingGuard.fillAxes ? '删除路径并补齐三轴' : '删除路径并继续') : '补齐三轴并继续' }}
              </button>
              <button type="button" class="props-panel__button" @click="cancelGuard">取消</button>
            </div>
          </div>

          <div
            id="inspector-fields"
            :key="clipKey"
            ref="scrollRef"
            class="props-panel__scroll"
            :role="pages.length > 1 ? 'tabpanel' : undefined"
            :aria-labelledby="pages.length > 1 ? `inspector-tab-${activePage?.key}` : undefined"
            @scroll="onScroll"
          >
            <p v-if="activePage === undefined" class="props-panel__empty">此片段没有可编辑属性。</p>
            <template v-for="group in activePage?.groups" :key="group.key">
              <BreathInspectorCard
                v-if="camera && group.key === 'breath'"
                :clip-key="clipKey"
                :rows="group.rows"
                :objects="objects"
                :collapsed="isCollapsed(group.key)"
                @set-expanded="setExpansion(group.key, $event)"
              >
                <template #row="{ row, options, axis }">
                  <ClipPropertyRow
                    :key="row.path"
                    :row="row"
                    :timing="timing"
                    :playhead="playhead"
                    :objects="objects"
                    :diagnostics="rowDiagnostics.get(row.path) ?? []"
                    :focused="focusedPath === row.path"
                    :options="options"
                    :axis="axis"
                    @focus-row="markFocused"
                  />
                </template>
              </BreathInspectorCard>

              <ClipPropertyGroup
                v-else
                :group="group"
                :timing="timing"
                :objects="objects"
                :playhead="playhead"
                :collapsed="isCollapsed(group.key)"
                :diagnostics="rowDiagnostics"
                :focused-path="focusedPath"
                :authoring-group-name="!group.unknown && group.key !== 'motion-models' ? authoringGroupName(group) : undefined"
                :event-summaries="eventSummaryMap"
                :options-by-path="optionsByPath"
                @open-group-popover="openGroupPopover"
                @toggle-collapse="toggleCollapse"
                @open-event-editor="openInBehavior"
                @reveal-effects="revealEffects"
                @focus-row="markFocused"
                @toggle-keyframe="onToggleKeyframe"
                @jump-keyframe="onJumpKeyframe"
              >
                <template v-if="lensEditor(group.key) !== null || group.key === 'motion-models'" #default>
                  <component
                    :is="lensEditor(group.key)"
                    v-if="lensEditor(group.key) !== null"
                    :rows="group.rows"
                    :objects="objects"
                    :timing="timing"
                    :playhead="playhead"
                  >
                    <template #row="{ row, options, axis }">
                      <ClipPropertyRow
                        :key="row.path"
                        :row="row"
                        :timing="timing"
                        :playhead="playhead"
                        :objects="objects"
                        :diagnostics="rowDiagnostics.get(row.path) ?? []"
                        :focused="focusedPath === row.path"
                        :options="fieldOptions(row, options)"
                        :axis="axis"
                        @focus-row="markFocused"
                        @toggle-keyframe="onToggleKeyframe"
                        @jump-keyframe="onJumpKeyframe"
                      />
                    </template>
                  </component>
                  <template v-else>
                    <MotionChannelRow
                      v-for="row in group.rows.filter(row => isChannelField(row.path))"
                      :key="row.path"
                      :clip-key="clipKey"
                      :path="row.path"
                      :model="modelValueOf(row.path)"
                      :domain="channelDomain(row.path)"
                      @open-editor="openModelEditor"
                    />
                  </template>
                </template>
              </ClipPropertyGroup>
            </template>
          </div>


          <aside v-if="modelEditor !== null" class="props-panel__drawer">
            <ModelEditorDrawer
              :clip-key="modelEditor.clipKey"
              :path="modelEditor.path"
              :model="modelTargetModel"
              :domain="modelEditor.domain"
              :open="modelEditor !== null"
              @close="closeModelEditor"
              @save="commitModel"
              @reset="commitModel"
            />
          </aside>

          <!-- 07-01：组合编辑弹层（挂在组头「组合」按钮上） -->
          <aside
            v-if="popoverGroup !== null && clipKey !== null && catalog !== undefined"
            class="props-panel__popover"
            aria-label="组合编辑"
          >
            <header class="props-panel__popover-head">
              <span class="props-panel__popover-title">组合编辑 · {{ popoverGroup.label }}</span>
              <button type="button" class="props-panel__button" @click="closeGroupPopover">关闭</button>
            </header>
            <GroupEditPopover
              :groups="authoringGroupRegistry.groups"
              :active-group-key="popoverGroup.key"
              :rows="popoverGroup.rows"
              :clip-key="clipKey"
              :objects="objects ?? {}"
              :track-type="clipContext.trackType"
              :catalog="catalog"
              :time="playhead"
              @apply="applyItems"
              @groups-change="onGroupsChange"
            />
          </aside>

          <p v-if="focusMessage" class="props-panel__feedback" :data-kind="focusMessageKind" role="status">{{ focusMessage }}</p>
          <DiagnosticsBar scope="properties" :clip-key="clipKey" />
        </template>

        <p v-else class="props-panel__notice" role="alert">
          此片段已不在当前脚本中。可撤销删除操作以恢复片段。
        </p>
      </template>

      <!-- 多选 -->
      <div v-else-if="state.kind === 'multi'" class="props-panel__block" role="status">
        <h2 class="props-panel__title">多选 · {{ multiClips.length }} 个片段</h2>
        <ul class="props-panel__list">
          <li v-for="{ key, clip } in multiClips" :key="key">{{ clip.label }} · {{ clip.start.toFixed(2) }} s</li>
        </ul>
        <p class="props-panel__hint">选择单个片段可编辑属性。</p>
      </div>

      <!-- 失效 -->
      <div v-else-if="state.kind === 'invalid'" class="props-panel__block props-panel__block--error" role="alert">
        <h2 class="props-panel__title">选区失效</h2>
        <p class="props-panel__hint">{{ invalidReason }}</p>
        <button type="button" class="props-panel__button" :disabled="!canUndo" @click="runUndo">
          撤销恢复
        </button>
      </div>

      <!-- 外部域 -->
      <div v-else-if="state.kind === 'foreign'" class="props-panel__block" role="status">
        <h2 class="props-panel__title">已选择{{ foreignLabel }}</h2>
        <p class="props-panel__hint">选择片段以查看其属性。</p>
      </div>

      <!-- 无选择 -->
      <p v-else class="props-panel__empty">
        在时间轴上选择一个片段以查看其属性。
      </p>
    </template>
  </section>
</template>

<style scoped>
.props-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.props-panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.props-panel__tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 0 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-strong);
}

.props-panel__tabs button {
  flex: 0 0 auto;
  padding: 5px 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.props-panel__tabs button:hover {
  background: var(--bg-raised);
  color: var(--text);
}

.props-panel__tabs button[aria-selected='true'] {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.props-panel__tabs button:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -2px;
}

.props-panel__empty,
.props-panel__notice {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.props-panel__notice {
  border-style: solid;
  border-color: var(--warning);
  color: var(--warning);
}

.props-panel__block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.props-panel__block--error {
  border-color: var(--error);
  background: var(--error-bg);
}

.props-panel__title {
  margin: 0;
  color: var(--text);
  font-size: 12px;
}

.props-panel__hint {
  margin: 0;
  color: var(--text-secondary);
}

.props-panel__list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.props-panel__mono {
  font-family: var(--font-mono);
  font-size: 11px;
}


.props-panel__feedback {
  flex: 0 0 auto;
  margin: 0;
  padding: 6px 10px;
  color: var(--text-secondary);
}

.props-panel__feedback[data-kind='error'] {
  color: var(--error);
}

.props-panel__button {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.props-panel__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.props-panel__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.props-panel__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.props-panel__guard {
  flex: 0 0 auto;
  margin: 6px 10px;
  padding: 8px 10px;
  border: 1px solid var(--error);
  border-radius: 4px;
  background: var(--error-bg);
  color: var(--text);
  font-size: 11px;
}

.props-panel__guard-text {
  margin: 0 0 4px;
}

.props-panel__guard-list {
  margin: 0 0 6px;
  padding-left: 16px;
  color: var(--text-secondary);
}

.props-panel__guard-actions {
  display: flex;
  gap: 6px;
}


.props-panel__popover {
  flex: 0 0 auto;
  max-height: 70%;
  overflow: auto;
  border-top: 1px solid var(--border-strong);
  background: var(--bg-raised);
}

.props-panel__popover-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
}

.props-panel__popover-title {
  font-weight: 600;
  font-size: 11px;
}


.props-panel__drawer {
  flex: 0 0 auto;
  max-height: 60%;
  overflow: auto;
  border-top: 1px solid var(--border-strong);
}
</style>
