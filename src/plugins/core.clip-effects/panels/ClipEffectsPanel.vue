<script setup lang="ts">
/**
 * `clip.effects` 效果面板外壳（06-01）。
 *
 * 职责边界：
 * - 只显示**已经有关键帧**的属性（归属由 `panelMembership('leaf')` 决定，本组件不重算）；
 * - 没有"添加属性 / 新建效果 / 添加组"入口——动画由属性面板的时钟产生；
 * - 所有写入走 `ctx.commands.commit`，失败由命令层回滚，这里只显示结果；
 * - 折叠 / 搜索 / 只看轴外 / 视口 / 选中节点属于会话，不进文档、不进序列化。
 *
 * 结构：局部标尺 / 组列表。标尺固定，组列表纵向滚动；左侧控制列与右侧画布共用同一分割线。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import type { ClipViewEntry } from '../../../workbench/api/documents.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import { buildGroups, partitionGroups } from '../../../features/effects/membership.ts'
import {
  DEFAULT_VIEWPORT,
  panBy,
  zoomAt,
} from '../../../features/effects/viewport.ts'
import { PLAYHEAD_EPSILON, layoutRows } from '../../../features/effects/geometry.ts'
import { propertyRowsFor } from '../../../features/effects/clipContext.ts'
import {
  addKeyframeCommand,
  disableAnimationCommand,
  enableAnimationCommand,
  removeKeyframeCommands,
} from '../../../features/effects/keyframeOps.ts'
import { sampleValue } from '../../../features/effects/easing.ts'
import { seedForNewNode } from '../../../features/effects/valueControls.ts'
import { documentSnapshot } from '../../../features/paths/docAccess.ts'
import {
  POSITION_NODE_PATHS,
  pathsBreakingOnInsert,
  pathsBreakingOnMove,
  pathsUsingEndpoint,
} from '../../../features/paths/integrity.ts'
import type { AffectedPath } from '../../../features/paths/integrity.ts'
import type {
  EffectGroup,
  EffectPanelSession,
  EffectViewport,
  KeyframeSelection,
  PropertyRow,
  SegmentSelection,
} from '../../../features/effects/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import EffectControlGroup from './EffectControlGroup.vue'
import EffectControlsRuler from './EffectControlsRuler.vue'
import DiagnosticsBar from '../../../features/effects/panels/DiagnosticsBar.vue'
import EasingEditor from './EasingEditor.vue'
import type { AddKeyframePayload, NodeMovePayload, NodeSelectPayload, OpenEventEditorPayload } from '../../../features/effects/panels/effectRowEvents.ts'
import { requestFocus } from '../../../features/behavior/focus.ts'
import type { ClipEventContext } from '../../../features/behavior/events.ts'
import { summariesForClip, recordRefAt } from './eventRecordSummary.ts'
import { usePanelRevision } from '../usePanelRevision.ts'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

/** 会话状态（以片段键为键；不进文档）。 */
const sessions = reactive(new Map<string, EffectPanelSession>())
const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
/** 07-05 §四：位置节点编辑打断路径时的待确认计划（非空时暂停提交）。 */
const pendingGuard = ref<{ affected: AffectedPath[]; command: unknown } | null>(null)
const groupList = ref<HTMLElement | null>(null)
const timelineWidth = ref(0)

const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const selectedClipKey = computed<string | null>(() => {
  const current = state.value
  return current.kind === 'clip' ? current.clipKey : null
})

const clipEntry = computed<ClipViewEntry | undefined>(() => {
  const clipKey = selectedClipKey.value
  if (clipKey === null) {
    return undefined
  }
  for (const track of view.value?.tracks ?? []) {
    const found = track.clips.find((clip) => clip.clipKey === clipKey)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
})

const trackType = computed<string>(() => {
  const clipKey = selectedClipKey.value
  if (clipKey === null) {
    return ''
  }
  for (const track of view.value?.tracks ?? []) {
    if (track.clips.some((clip) => clip.clipKey === clipKey)) {
      return track.type
    }
  }
  return ''
})

/** 片段原始对象（`objects` 的宿主）；不缓存跨 revision 的值。 */
const clipObjects = computed<JsonObject | null>(() => {
  void revision.value
  const clipKey = selectedClipKey.value
  if (clipKey === null || documentService === undefined) {
    return null
  }
  return documentService.clipObjects(clipKey)
})

const allRows = computed<PropertyRow[]>(() => {
  void revision.value
  const clipKey = selectedClipKey.value
  const objects = clipObjects.value
  const type = trackType.value
  if (clipKey === null || objects === null || catalog === undefined || type === '') {
    return []
  }
  return propertyRowsFor({ clipKey, trackType: type, objects, catalog, panel: 'effects' })
})

const timing = computed<ClipTiming>(() => {
  void revision.value
  const entry = clipEntry.value
  if (entry === undefined) {
    return { duration: 0, infinite: false }
  }
  return {
    duration: entry.infinite ? -1 : entry.duration,
    infinite: entry.infinite,
  }
})

const playhead = computed<number>(() => {
  void revision.value
  return (documentService?.sessionView().playhead ?? 0) - (clipEntry.value?.start ?? 0)
})

/**
 * 当前片段的会话状态（首次访问时创建）。
 *
 * 刻意不用 `computed` 包裹创建逻辑：computed 的 getter 里写 Map 会触发"computed 内副作用"
 * 警告，也会让依赖追踪错乱。这里用普通函数，模板里每次读都取当前对象。
 */
function currentSession(): EffectPanelSession {
  const clipKey = selectedClipKey.value
  if (clipKey === null) {
    return emptySession()
  }
  const existing = sessions.get(clipKey)
  if (existing !== undefined) {
    return existing
  }
  const created = emptySession()
  sessions.set(clipKey, created)
  return created
}

/** 会话状态的响应式代理（模板与派生数据都读它；同一片段返回同一对象）。 */
const session = computed<EffectPanelSession>(() => currentSession())

function emptySession(): EffectPanelSession {
  return {
    collapsed: new Set<string>(),
    search: '',
    onlyOutOfRange: false,
    columnRatio: 0.42,
    viewport: { ...DEFAULT_VIEWPORT },
    expanded: new Set<string>(),
    selectedNodes: [],
    selectedSegment: null,
  }
}

/** 效果面板的组（归属策略分区后只取效果侧）。 */
const effectGroups = computed<EffectGroup[]>(() => {
  const rows = allRows.value
  if (rows.length === 0) {
    return []
  }
  const groups = buildGroups(rows, timing.value)
  return partitionGroups(groups, 'leaf', timing.value).effectGroups
})

/** 搜索与只看轴外只改显示，不改行集合。 */
const visibleGroups = computed<EffectGroup[]>(() => {
  const current = session.value
  const needle = current.search.trim().toLowerCase()
  const onlyOut = current.onlyOutOfRange
  return effectGroups.value
    .map((group) => {
      const rows = group.rows.filter((row) => {
        if (onlyOut && group.outOfRangeCount === 0) {
          return false
        }
        if (needle.length === 0) {
          return true
        }
        return row.path.toLowerCase().includes(needle)
          || row.label.toLowerCase().includes(needle)
          || group.label.toLowerCase().includes(needle)
      })
      return rows.length === 0 ? null : { ...group, rows }
    })
    .filter((group): group is EffectGroup => group !== null)
})

/** 行中心（供跨行框选与节点纵向对齐）。 */
const rowCenters = computed(() =>
  layoutRows(
    visibleGroups.value.map((group) => ({ key: group.key, rows: group.rows })),
    session.value.collapsed,
    session.value.expanded,
  ))

const MIN_CONTROL_WIDTH = 156
const MAX_CONTROL_WIDTH = 280
const MIN_CANVAS_WIDTH = 120

const availableWidth = computed(() => timelineWidth.value || 500)
const maxControlWidth = computed(() => Math.min(MAX_CONTROL_WIDTH, Math.max(0, availableWidth.value - MIN_CANVAS_WIDTH)))
const minControlWidth = computed(() => Math.min(MIN_CONTROL_WIDTH, maxControlWidth.value))
const controlWidth = computed(() => Math.round(Math.max(
  minControlWidth.value,
  Math.min(maxControlWidth.value, availableWidth.value * session.value.columnRatio),
)))
const canvasWidth = computed(() => availableWidth.value - controlWidth.value)

const timelineStyle = computed(() => ({
  '--effects-control-width': controlWidth.value + 'px',
  '--effects-canvas-width': canvasWidth.value + 'px',
}))

const viewport = computed<EffectViewport>(() => {
  const saved = session.value.viewport
  const width = canvasWidth.value
  if (saved.width > 0) {
    // 调整分栏时保留当前显示的时间范围。
    const ratio = width / saved.width
    return { ...saved, width, pxPerSecond: saved.pxPerSecond * ratio, scrollLeft: saved.scrollLeft * ratio }
  }
  const duration = timing.value.duration
  return { ...saved, width, pxPerSecond: duration > 0 ? width / duration : saved.pxPerSecond }
})

const empty = computed(() => effectGroups.value.length === 0)

const selectedSegment = computed<SegmentSelection | null>(() => session.value.selectedSegment)

const selectedRowForSegment = computed<PropertyRow | undefined>(() => {
  const segment = selectedSegment.value
  if (segment === null) {
    return undefined
  }
  return allRows.value.find((row) => row.path === segment.path)
})

/** 片段时间上下文（事件摘要生成处需要局部时间换算口径）。 */
const eventContext = computed<ClipEventContext | null>(() => {
  const entry = clipEntry.value
  if (entry === undefined) {
    return null
  }
  return {
    clipStartTime: entry.start,
    duration: entry.infinite ? -1 : entry.duration,
    infinite: entry.infinite,
  }
})

/** 当前片段的事件记录摘要（身份经 behavior focus 通道交给行为页抽屉）。 */
const eventSummary = computed(() => {
  const key = selectedClipKey.value
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
    report('该事件对象暂无记录，可在行为页新建', 'info')
    return
  }
  ctx.requestOpenDrawer(BEHAVIOR_DRAWER_TAB)
  requestFocus({ target: ref, surface: 'behavior-drawer', origin: ctx.panelId })
}

function report(text: string, kind: 'info' | 'error'): void {
  message.value = text
  messageKind.value = kind
}

/** 提交一条命令；失败显示命令层给的原因。 */
function commit(command: DocCommand | null, successText?: string): boolean {
  if (command === null) {
    return false
  }
  const outcome = ctx.commands.commit(command)
  if (outcome.ok) {
    if (successText !== undefined) {
      report(successText, 'info')
    }
    return true
  }
  report(outcome.error ?? '命令被拒绝。', 'error')
  return false
}

/**
 * 位置节点编辑的引用完整性扫描（07-05 §四）。
 *
 * 只扫 `position.x/y/z` 三个位置轴；受影响路径按 id 去重。
 * 没有受影响路径时返回 `null`，调用方直接提交帧操作。
 */
function nodeEditGuard(
  mode: 'delete' | 'insert' | 'move',
  targets: ReadonlyArray<{ path: string; time: number }>,
  moves: ReadonlyArray<{ path: string; from: number; to: number }>,
  frameCommand: DocCommand,
): { affected: AffectedPath[]; command: DocCommand } | null {
  if (documentService === undefined || catalog === undefined) {
    return null
  }
  const doc = documentSnapshot(documentService, catalog)
  const clipId = clipEntry.value?.clipId ?? ''
  if (doc === null || clipId === '') {
    return null
  }
  const affected: AffectedPath[] = []
  const push = (item: AffectedPath): void => {
    if (!affected.some((existing) => existing.id === item.id)) {
      affected.push(item)
    }
  }
  if (mode === 'move') {
    for (const move of moves) {
      if (!POSITION_NODE_PATHS.includes(move.path)) {
        continue
      }
      for (const item of pathsBreakingOnMove(doc, clipId, move.from, move.to)) {
        push(item)
      }
    }
  } else {
    for (const target of targets) {
      if (!POSITION_NODE_PATHS.includes(target.path)) {
        continue
      }
      const hits = mode === 'insert'
        ? pathsBreakingOnInsert(doc, clipId, target.time)
        : pathsUsingEndpoint(doc, clipId, target.time)
      for (const item of hits) {
        push(item)
      }
    }
  }
  if (affected.length === 0) {
    return null
  }
  // 先删路径再帧操作：帧命令的端点 / 区间预检看不到已移除的引用；同一次 compound，一次撤销全回退。
  const removal = removalCommand(affected)
  const command: DocCommand = removal === null
    ? frameCommand
    : { kind: 'compound', commands: [removal, frameCommand] }
  return { affected, command }
}

/** 「删除这些路径」命令：只移除受影响条目，其余条目原样留在 `paths[]`。 */
function removalCommand(affected: readonly AffectedPath[]): DocCommand | null {
  const ids = [...new Set(affected.map((item) => item.id))]
  if (ids.length === 0) {
    return null
  }
  return { kind: 'path.writeBatch', removeIds: ids, entries: [] }
}

/** 作者确认：删除受影响路径并继续（帧操作与路径删除同一次 compound）。 */
function confirmGuard(): void {
  const pending = pendingGuard.value
  if (pending === null) {
    return
  }
  pendingGuard.value = null
  commit(pending.command as DocCommand, `已删除 ${pending.affected.length} 条受影响路径并继续。`)
}

/** 作者取消：路径与关键帧都不改。 */
function cancelGuard(): void {
  pendingGuard.value = null
  report('已取消（路径与关键帧都没有改动）。', 'info')
}

function toggleCollapse(groupKey: string): void {
  const collapsed = session.value.collapsed
  if (collapsed.has(groupKey)) {
    collapsed.delete(groupKey)
    return
  }
  collapsed.add(groupKey)
}

function onWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const anchorX = event.clientX - rect.left
    session.value.viewport = zoomAt(viewport.value, anchorX, event.deltaY < 0 ? 1.2 : 1 / 1.2)
    return
  }
  if (event.shiftKey) {
    event.preventDefault()
    session.value.viewport = panBy(viewport.value, event.deltaY === 0 ? event.deltaX : event.deltaY)
  }
}

/** 左右分栏拖动：窄面板仍可双向调整，右侧画布同步适配。 */
let columnDrag: { pointerId: number; startX: number; startWidth: number } | null = null

function onColumnPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || timelineWidth.value <= 0) {
    return
  }
  event.preventDefault()
  columnDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: controlWidth.value,
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId) === false) {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer events may not have an active pointer; window listeners still handle the drag.
    }
  }
  window.addEventListener('pointermove', onColumnPointerMove)
  window.addEventListener('pointerup', onColumnPointerUp)
  window.addEventListener('pointercancel', onColumnPointerUp)
}

function onColumnPointerMove(event: PointerEvent): void {
  const active = columnDrag
  if (active === null || event.pointerId !== active.pointerId) {
    return
  }
  setControlWidth(active.startWidth + event.clientX - active.startX)
}

function setControlWidth(width: number): void {
  const next = Math.max(minControlWidth.value, Math.min(maxControlWidth.value, width))
  session.value.columnRatio = next / availableWidth.value
}

function onColumnPointerUp(event: PointerEvent): void {
  if (columnDrag === null || event.pointerId !== columnDrag.pointerId) {
    return
  }
  columnDrag = null
  window.removeEventListener('pointermove', onColumnPointerMove)
  window.removeEventListener('pointerup', onColumnPointerUp)
  window.removeEventListener('pointercancel', onColumnPointerUp)
}

function onSelectNode(payload: NodeSelectPayload): void {
  const current = session.value.selectedNodes
  const sameNode = (item: KeyframeSelection, path: string, time: number): boolean =>
    item.path === path && Math.abs(item.time - time) <= PLAYHEAD_EPSILON

  if (payload.mode === 'replace') {
    session.value.selectedNodes = [{ clipKey: payload.clipKey, path: payload.path, time: payload.time }]
    return
  }
  if (payload.mode === 'toggle') {
    const exists = current.some((item) => sameNode(item, payload.path, payload.time))
    session.value.selectedNodes = exists
      ? current.filter((item) => !sameNode(item, payload.path, payload.time))
      : [...current, { clipKey: payload.clipKey, path: payload.path, time: payload.time }]
    return
  }
  if (payload.mode === 'add') {
    const exists = current.some((item) => sameNode(item, payload.path, payload.time))
    if (!exists) {
      session.value.selectedNodes = [...current, { clipKey: payload.clipKey, path: payload.path, time: payload.time }]
    }
    return
  }
  // `range`：同属性内一段连续时间；`rect`：跨行框选（行组件已按矩形算出 `times`）。
  const times = payload.times ?? [payload.time]
  const additions: KeyframeSelection[] = times.map((time) => ({
    clipKey: payload.clipKey,
    path: payload.path,
    time,
  }))
  if (payload.mode === 'rect') {
    session.value.selectedNodes = additions
    return
  }
  session.value.selectedNodes = additions
}

function onMoveNodes(payload: NodeMovePayload): void {
  if (payload.moves.length === 0) {
    return
  }
  const command: DocCommand = payload.moves.length === 1
    ? {
        kind: 'object.moveKeyframe',
        clipKey: payload.clipKey,
        path: payload.moves[0].path,
        from: payload.moves[0].from,
        to: payload.moves[0].to,
      }
    : { kind: 'object.moveKeyframes', clipKey: payload.clipKey, moves: payload.moves }
  const guard = nodeEditGuard('move', [], payload.moves, command)
  if (guard !== null) {
    pendingGuard.value = guard
    return
  }
  commit(command)
}

function onRemoveKeyframes(payload: { clipKey: string; targets: Array<{ path: string; time: number }> }): void {
  const command = removeKeyframeCommands(payload.clipKey, payload.targets)
  if (command === null) {
    return
  }
  const guard = nodeEditGuard('delete', payload.targets, [], command)
  if (guard !== null) {
    pendingGuard.value = guard
    return
  }
  commit(command)
}

function onDisableAnimation(payload: { clipKey: string; path: string }): void {
  commit(disableAnimationCommand(payload.clipKey, payload.path), `已关闭 ${payload.path} 的动画。`)
}

/**
 * 菱形：播放头有帧 → 删该帧；无帧 → 建帧。
 *
 * 建帧初值按 06-05 的回退链：播放头采样值 → 静态值 → 目录默认值；都没有则拒绝并提示。
 * 与剪辑软件一致：菱形只处理"当前时刻这一帧"，不碰其他帧。
 */
function onToggleKeyframe(payload: { clipKey: string; path: string; time: number; create: boolean }): void {
  const row = allRows.value.find((item) => item.path === payload.path)
  if (row === undefined) {
    return
  }
  if (!payload.create) {
    const command = removeKeyframeCommands(payload.clipKey, [{ path: payload.path, time: payload.time }])
    if (command === null) {
      return
    }
    const guard = nodeEditGuard('delete', [{ path: payload.path, time: payload.time }], [], command)
    if (guard !== null) {
      pendingGuard.value = guard
      return
    }
    commit(command, `已删除 ${payload.path} 在 ${payload.time.toFixed(2)}s 的关键帧。`)
    return
  }
  const sampled = sampleValue({
    frames: row.keyframes,
    interp: row.interp,
    time: payload.time,
    timing: timing.value,
  })
  const seed = seedForNewNode(row, sampled.ok ? sampled.value : undefined, payload.time)
  if (!seed.ok || seed.value === undefined) {
    report(seed.message ?? '没有可用的初值，请先输入静态值。', 'error')
    return
  }
  insertKeyframe(row, { clipKey: payload.clipKey, path: payload.path, time: payload.time, value: seed.value })
}

function onAddKeyframe(payload: AddKeyframePayload): void {
  const row = allRows.value.find((item) => item.path === payload.path && item.clipKey === payload.clipKey)
  if (row !== undefined) insertKeyframe(row, payload)
}

function insertKeyframe(row: PropertyRow, payload: AddKeyframePayload): void {
  const command = addKeyframeCommand(payload.clipKey, row, payload.time, payload.value)
  if (command === null) {
    return
  }
  const guard = nodeEditGuard('insert', [{ path: payload.path, time: payload.time }], [], command)
  if (guard !== null) {
    pendingGuard.value = guard
    return
  }
  commit(
    command,
    `已在 ${payload.time.toFixed(2)}s 创建 ${payload.path} 的关键帧。`,
  )
}

/** 时钟：开/关动画。关闭时由命令层保留最后值。 */
function onToggleAnimation(payload: { clipKey: string; path: string; time: number; enable: boolean }): void {
  if (payload.enable) {
    commit(
      enableAnimationCommand(payload.clipKey, payload.path, payload.time),
      `已开启 ${payload.path} 的动画。`,
    )
    return
  }
  commit(disableAnimationCommand(payload.clipKey, payload.path), `已关闭 ${payload.path} 的动画。`)
}

/** 前后帧跳转：只移播放头（会话写入，不进文档、不进撤销栈）。 */
function onJumpKeyframe(payload: { clipKey: string; path: string; time: number }): void {
  const entry = clipEntry.value
  if (entry === undefined || documentService === undefined) {
    return
  }
  // 效果面板用片段局部秒；主播放头是全局秒，需要加片段起点。
  documentService.setPlayhead(entry.start + payload.time)
}

function onSelectSegment(segment: SegmentSelection): void {
  session.value.selectedSegment = segment
}

function closeSegment(): void {
  session.value.selectedSegment = null
}

function revealDiagnostic(): void {
  ctx.requestOpenDrawer('diagnostics')
}

function openProperties(): void {
  ctx.requestFocus('selection.properties')
}

function formatSeconds(seconds: number): string {
  return Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : '—'
}

const headerInfo = computed(() => {
  const entry = clipEntry.value
  const clipKey = selectedClipKey.value
  if (entry === undefined || clipKey === null) {
    return null
  }
  return {
    clipKey,
    label: entry.label,
    clipId: entry.clipId ?? null,
    trackType: trackType.value,
    start: formatSeconds(entry.start),
    duration: entry.infinite ? '无限' : formatSeconds(entry.duration),
    loop: entry.loop,
    loopCount: entry.loopCount ?? null,
    references: entry.references,
    warn: entry.warn,
  }
})

watch(groupList, (list, _, onCleanup) => {
  if (list === null) return
  const observer = new ResizeObserver(([entry]) => {
    if (entry !== undefined && entry.contentRect.width > 0) timelineWidth.value = entry.contentRect.width
  })
  observer.observe(list)
  onCleanup(() => observer.disconnect())
})

watch(selectedClipKey, (key) => {
  pendingGuard.value = null
  message.value = ''
  if (key === null) return
  const entry = sessions.get(key)
  if (entry !== undefined) entry.selectedSegment = null
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onColumnPointerMove)
  window.removeEventListener('pointerup', onColumnPointerUp)
  window.removeEventListener('pointercancel', onColumnPointerUp)
  columnDrag = null
  sessions.clear()
})

</script>

<template>
  <section
    class="effects-panel"
    aria-label="片段效果"
    :data-clip-key="selectedClipKey ?? undefined"
  >
    <p v-if="documentService === undefined" class="effects-notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>

    <p v-else-if="view === null" class="effects-empty">
      没有打开的文档。从脚本页打开一个脚本后，这里显示选中片段的动画属性。
    </p>

    <template v-else-if="state.kind === 'clip' && headerInfo !== null">
      <!-- 07-05 §四：节点编辑打断路径时的「阻止 + 处理选项」 -->
      <div v-if="pendingGuard !== null" class="effects-guard" role="alert">
        <p class="effects-guard-text">
          这个位置节点是 {{ pendingGuard.affected.length }} 条路径的端点或区间节点，直接改动会让它们失效：
        </p>
        <ul class="effects-guard-list">
          <li v-for="item in pendingGuard.affected" :key="item.id" class="effects-mono">
            {{ item.id }} · {{ item.reason }}
          </li>
        </ul>
        <div class="effects-guard-actions">
          <button type="button" class="effects-button" @click="confirmGuard">删除这些路径并继续</button>
          <button type="button" class="effects-button" @click="cancelGuard">取消</button>
        </div>
      </div>

      <p v-if="empty" class="effects-empty">
        该片段还没有关键帧动画。在属性面板打开时钟后，这里显示对应属性。
        <button type="button" class="effects-link" @click="openProperties">去属性面板</button>
      </p>

      <template v-else>
        <div class="effects-timeline" :style="timelineStyle">
        <div class="effects-ruler-row">
          <div class="effects-ruler-spacer" aria-hidden="true" />
          <EffectControlsRuler
            :viewport="viewport"
            :timing="timing"
            :playhead="playhead"
            @wheel="onWheel"
          />
        </div>

        <div class="effects-body">
          <button
            type="button"
            class="effects-column-handle"
            aria-label="调整属性列与关键帧画布宽度"
            title="拖动调整左右宽度"
            @pointerdown="onColumnPointerDown"
            @keydown.left.prevent="setControlWidth(controlWidth - 12)"
            @keydown.right.prevent="setControlWidth(controlWidth + 12)"
          />
          <div ref="groupList" class="effects-groups" role="list">
            <EffectControlGroup
              v-for="group in visibleGroups"
              :key="group.key"
              :group="group"
              :viewport="viewport"
              :timing="timing"
              :playhead="playhead"
              :selection="session.selectedNodes"
              :session="session"
              :row-centers="rowCenters.centers"
              :event-summaries="eventSummaryMap"
              @toggle-collapse="toggleCollapse(group.key)"
              @select-node="onSelectNode"
              @move-nodes="onMoveNodes"
              @remove-keyframes="onRemoveKeyframes"
              @add-keyframe="onAddKeyframe"
              @disable-animation="onDisableAnimation"
              @select-segment="onSelectSegment"
              @open-event-editor="openInBehavior"
              @reveal-diagnostic="revealDiagnostic"
              @toggle-keyframe="onToggleKeyframe"
              @toggle-animation="onToggleAnimation"
              @jump-keyframe="onJumpKeyframe"
            />
          </div>

        </div>
        <aside v-if="selectedSegment !== null" class="effects-detail effects-detail--inline">
          <EasingEditor
            :clip-key="selectedSegment.clipKey"
            :path="selectedSegment.path"
            :from-time="selectedSegment.fromTime"
            :to-time="selectedSegment.toTime"
            :px-per-second="viewport.pxPerSecond"
            @close="closeSegment"
          />
        </aside>
        </div>

      </template>

      <DiagnosticsBar scope="effects" :clip-key="selectedClipKey ?? undefined" />

      <p v-if="message !== ''" class="effects-message" :data-kind="messageKind" role="status" aria-live="polite">
        {{ message }}
      </p>
    </template>

    <div v-else-if="state.kind === 'multi'" class="effects-empty" role="status">
      <strong>当前为多选（{{ state.clipKeys.length }} 个片段）。</strong>
      <p>请选择一个片段查看动画属性；多选不合并属性，也不取第一个片段冒充选择。</p>
      <p class="effects-mono">{{ state.clipKeys.join(', ') }}</p>
    </div>

    <div v-else-if="state.kind === 'invalid'" class="effects-notice" role="alert">
      <strong>选区失效。</strong>
      <p>{{ state.reason }}</p>
      <div class="effects-actions">
        <button type="button" class="effects-button" :disabled="!ctx.commands.canUndo" @click="ctx.commands.undo()">
          撤销恢复
        </button>
        <button type="button" class="effects-button" @click="openProperties">回到时间轴</button>
      </div>
    </div>

    <div v-else-if="state.kind === 'foreign'" class="effects-empty">
      <strong>当前选择属于 {{ state.domain }} 域，不属于片段效果控件。</strong>
      <p>在时间轴上选择片段后再查看动画属性。</p>
    </div>

    <p v-else class="effects-empty">
      没有选中片段。空态不自动选择第一个片段。
    </p>
  </section>
</template>

<style scoped>
.effects-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.effects-body,
.effects-detail {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.effects-body {
  position: relative;
  background-image: linear-gradient(var(--border), var(--border));
  background-position: left var(--effects-control-width, 240px) top;
  background-repeat: no-repeat;
  background-size: 1px 100%;
}

.effects-column-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--effects-control-width, 240px) - 6px);
  z-index: 25;
  width: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}

.effects-column-handle::after {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 1px;
  background: var(--border-strong);
  content: '';
  opacity: 0;
  transition: opacity 80ms linear;
}

.effects-column-handle:hover::after,
.effects-column-handle:focus-visible::after {
  opacity: 1;
}

.effects-column-handle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.effects-timeline {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  --effects-control-width: 240px;
}

.effects-ruler-row {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: var(--effects-control-width, 240px) var(--effects-canvas-width, 1fr);
  min-width: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}

.effects-ruler-spacer {
  position: relative;
  z-index: 2;
  background: var(--bg-raised);
  border-right: 1px solid var(--border);
}

.effects-ruler-spacer::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: var(--border);
  content: '';
}

.effects-groups {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.effects-groups::after {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
  content: '';
  pointer-events: none;
}

.effects-detail {
  flex: 0 0 auto;
  width: 42%;
  min-width: 200px;
  max-width: 360px;
  overflow: auto;
  border-left: 1px solid var(--border);
}

.effects-detail--inline {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 30;
  height: min(45%, 280px);
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.effects-empty,
.effects-notice {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.effects-empty p,
.effects-notice p {
  margin: 4px 0 0;
}

.effects-notice {
  border-color: var(--error);
  background: var(--bg-raised);
}

.effects-notice strong {
  color: var(--error);
}

.effects-link {
  margin-left: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
}

.effects-link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.effects-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.effects-button {
  padding: 3px 9px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.effects-button:hover:enabled {
  background: var(--bg-hover);
}

.effects-button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.effects-mono {
  font-family: var(--font-mono, monospace);
  overflow-wrap: anywhere;
}

.effects-guard {
  flex: 0 0 auto;
  margin: 6px 10px 0;
  padding: 8px 10px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
}

.effects-guard-text {
  margin: 0 0 4px;
}

.effects-guard-list {
  margin: 0 0 8px;
  padding-left: 16px;
}

.effects-guard-actions {
  display: flex;
  gap: 6px;
}

.effects-footer {
  flex: 0 0 auto;
  margin: 0;
  padding: 2px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
}

.effects-message {
  flex: 0 0 auto;
  margin: 0;
  padding: 3px 10px;
  color: var(--text-secondary);
  font-size: 11px;
}

.effects-message[data-kind='error'] {
  color: var(--error);
}
</style>
