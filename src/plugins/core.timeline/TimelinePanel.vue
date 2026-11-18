<script setup lang="ts">
/**
 * 主时间轴面板 `timeline.main`（05-09 / 05-10 / 05-11 / 05-12）。
 *
 * 结构：工具栏 / 标尺 / 固定轨道头列 / 横向滚动的轨道区。
 * 手势全部在这一层做命中与提交：一次拖动只在松手时发一条命令；
 * 轨道头与工具栏只发意图，不直接改文档。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  hitTest,
  screenXToTime,
  snapTime,
  type TimelineHit,
} from '../../core/timeline/geometry.ts'
import type { CommitOutcome, TrackViewEntry } from '../../workbench/api/documents.ts'
import { FOCUS_SERVICE, KEYBINDING_SERVICE } from '../../workbench/api/tokens.ts'
import { panelFocusScope, usePanelContext } from '../../workbench/host/panelContext.ts'
import TimelineContextMenu from './TimelineContextMenu.vue'
import TimelineRuler from './TimelineRuler.vue'
import TimelineToolbar from './TimelineToolbar.vue'
import TrackHeader from './TrackHeader.vue'
import TrackRow from './TrackRow.vue'
import {
  clipBodyEnd,
  findClip,
  findTrack,
  formatSeconds,
  trackColorVar,
  type TimelineMenuItem,
} from './model.ts'
import { useTimelineController } from './state.ts'

const ctx = usePanelContext()
const controller = useTimelineController(ctx)
const focusService = ctx.services.get(FOCUS_SERVICE)
const keybindings = ctx.services.get(KEYBINDING_SERVICE)
const panelScope = panelFocusScope(ctx.pluginId, ctx.panelId)

/** 轨道头列宽（固定，横向滚动不动）。 */
const HEADER_WIDTH = 192
/** 自动滚动触发边距（像素）。 */
const AUTO_SCROLL_EDGE = 24

const rootEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)

const view = controller.view
const session = controller.session
const pxPerSecond = controller.pxPerSecond
const scale = controller.scale
const displayRange = controller.displayRange
const tracks = controller.visibleTracks
const contentWidth = controller.contentWidth
const scrollLeft = controller.scrollLeft
const playhead = computed(() => session.value.playhead)

const addTrackOpen = ref(false)
const scrollTop = ref(0)
const draggingTrackId = ref<string | null>(null)
const narrow = computed(() => controller.viewportWidth.value < 480)
const compact = computed(() => controller.panelHeight.value < 240)
const rowHeight = computed(() => (compact.value ? 34 : 52))
const clipHeight = computed(() => (compact.value ? 28 : 40))
const totalHeight = computed(() => tracks.value.length * rowHeight.value)
const playheadX = computed(() => playhead.value * pxPerSecond.value)
const hiddenTracks = computed(() =>
  controller.tracks.value
    .filter((track) => !controller.trackState(track.trackId).visible)
    .map((track) => ({ trackId: track.trackId, label: controller.trackName(track) })),
)
const hasClips = computed(() => controller.tracks.value.some((track) => track.clips.length > 0))

// ── 自动滚动 / 尺寸 ─────────────────────────────────────────

let observer: ResizeObserver | null = null

function measure(): void {
  const root = rootEl.value
  if (root !== null) {
    controller.setPanelHeight(root.clientHeight)
  }
  const element = scrollEl.value
  if (element !== null) {
    controller.setViewportWidth(element.clientWidth)
    return
  }
  const fallback = Math.max(1, (root?.clientWidth ?? 800) - HEADER_WIDTH)
  controller.setViewportWidth(fallback)
}

onMounted(() => {
  observer = new ResizeObserver(() => measure())
  if (rootEl.value !== null) {
    observer.observe(rootEl.value)
  }
  if (scrollEl.value !== null) {
    observer.observe(scrollEl.value)
  }
  measure()
  void nextTick(() => controller.ensureFittedForDoc())
})

watch(scrollEl, (element, previous) => {
  if (previous !== null) {
    observer?.unobserve(previous)
  }
  if (element !== null) {
    observer?.observe(element)
  }
  measure()
})

watch(
  () => view.value?.docId,
  () => {
    void nextTick(() => controller.ensureFittedForDoc())
  },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  cancelGesture()
})

let scrollFrame = 0
function onScroll(): void {
  if (scrollFrame !== 0) {
    return
  }
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const element = scrollEl.value
    if (element === null) {
      return
    }
    controller.setScrollLeft(element.scrollLeft)
    scrollTop.value = element.scrollTop
  })
}

watch(scrollLeft, (value) => {
  const element = scrollEl.value
  if (element !== null && Math.abs(element.scrollLeft - value) > 0.5) {
    element.scrollLeft = value
  }
})

function trackAreaRect(): DOMRect | null {
  return scrollEl.value?.getBoundingClientRect() ?? null
}

function timeAtClientX(clientX: number): number {
  const rect = trackAreaRect()
  if (rect === null) {
    return 0
  }
  return Math.max(0, screenXToTime(clientX - rect.left, scale.value))
}

function rowAt(clientX: number, clientY: number): { track: TrackViewEntry; index: number } | null {
  const element = scrollEl.value
  const rect = element?.getBoundingClientRect()
  if (element === null || rect === undefined) {
    return null
  }
  if (clientX < rect.left || clientX > rect.right) {
    return null
  }
  const y = clientY - rect.top + element.scrollTop
  if (y < 0) {
    return null
  }
  const index = Math.floor(y / rowHeight.value)
  const track = tracks.value[index]
  return track === undefined ? null : { track, index }
}

function rowTop(trackId: string): number | null {
  const index = tracks.value.findIndex((track) => track.trackId === trackId)
  return index < 0 ? null : index * rowHeight.value
}

// ── 手势状态 ────────────────────────────────────────────────

interface MoveOrigin {
  clipKey: string
  trackId: string
  trackType: string
  start: number
  duration: number
  infinite: boolean
}

type Gesture =
  | { kind: 'scrub'; pointerId: number }
  | {
      kind: 'move'
      pointerId: number
      keys: string[]
      origins: MoveOrigin[]
      primaryKey: string
      startX: number
      startY: number
      delta: number
      targetTrackId: string | null
      targetInvalid: boolean
      moved: boolean
    }
  | {
      kind: 'trim'
      pointerId: number
      clipKey: string
      edge: 'left' | 'right'
      originalStart: number
      originalEnd: number
      newTime: number
      moved: boolean
    }
  | {
      kind: 'marquee'
      pointerId: number
      startX: number
      startY: number
      currentX: number
      currentY: number
      additive: boolean
      baseKeys: readonly string[]
      moved: boolean
    }

const gesture = ref<Gesture | null>(null)
let autoScrollFrame = 0
let lastAltKey = false
const pointer = { x: 0, y: 0 }

function addWindowListeners(): void {
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
  window.addEventListener('keydown', onWindowKeydown, true)
}

function removeWindowListeners(): void {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
  window.removeEventListener('keydown', onWindowKeydown, true)
}

function stopAutoScroll(): void {
  if (autoScrollFrame !== 0) {
    cancelAnimationFrame(autoScrollFrame)
    autoScrollFrame = 0
  }
}

function startAutoScroll(): void {
  if (autoScrollFrame !== 0) {
    return
  }
  const tick = (): void => {
    autoScrollFrame = 0
    const active = gesture.value
    const element = scrollEl.value
    if (active === null || element === null || active.kind === 'scrub') {
      return
    }
    const rect = element.getBoundingClientRect()
    let delta = 0
    if (pointer.x < rect.left + AUTO_SCROLL_EDGE) {
      delta = -Math.ceil(((rect.left + AUTO_SCROLL_EDGE - pointer.x) / AUTO_SCROLL_EDGE) * 14)
    } else if (pointer.x > rect.right - AUTO_SCROLL_EDGE) {
      delta = Math.ceil(((pointer.x - (rect.right - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE) * 14)
    }
    if (delta !== 0) {
      element.scrollLeft = Math.max(0, element.scrollLeft + delta)
      controller.setScrollLeft(element.scrollLeft)
      updateGestureAt(pointer.x, pointer.y, lastAltKey)
    }
    autoScrollFrame = requestAnimationFrame(tick)
  }
  autoScrollFrame = requestAnimationFrame(tick)
}

function beginGesture(next: Gesture): void {
  if (gesture.value !== null) {
    return
  }
  gesture.value = next
  addWindowListeners()
  startAutoScroll()
}

function cancelGesture(): void {
  gesture.value = null
  stopAutoScroll()
  removeWindowListeners()
}

/** 手势取消（Esc / pointercancel）：不提交。 */
function abortGesture(): void {
  cancelGesture()
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return
  }
  if (gesture.value === null) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  abortGesture()
}

function updateGestureAt(clientX: number, clientY: number, altKey: boolean): void {
  const active = gesture.value
  if (active === null) {
    return
  }
  if (active.kind === 'move') {
    updateMove(active, clientX, clientY, altKey)
    return
  }
  if (active.kind === 'trim') {
    updateTrim(active, clientX, clientY, altKey)
    return
  }
  if (active.kind === 'marquee') {
    updateMarquee(active, clientX, clientY)
  }
}

function onWindowPointerMove(event: PointerEvent): void {
  const active = gesture.value
  if (active === null || event.pointerId !== active.pointerId) {
    return
  }
  pointer.x = event.clientX
  pointer.y = event.clientY
  lastAltKey = event.altKey
  if (active.kind === 'scrub') {
    controller.seek(timeAtClientX(event.clientX))
    return
  }
  updateGestureAt(event.clientX, event.clientY, event.altKey)
}

// ── 移动 ────────────────────────────────────────────────────

function beginMove(event: PointerEvent, clipKey: string): void {
  const origins: MoveOrigin[] = []
  for (const key of controller.clipKeys.value) {
    const found = controller.clipOf(key)
    if (found === undefined) {
      continue
    }
    if (controller.trackState(found.track.trackId).locked) {
      controller.notify('选中片段包含锁定轨道，不能拖动', 'warning')
      return
    }
    origins.push({
      clipKey: key,
      trackId: found.track.trackId,
      trackType: found.track.type,
      start: found.clip.start,
      duration: Math.max(0, found.clip.duration),
      infinite: found.clip.infinite || found.clip.duration < 0,
    })
  }
  if (origins.length === 0) {
    return
  }
  const primaryKeyValue = controller.primaryClipKey.value ?? clipKey
  pointer.x = event.clientX
  pointer.y = event.clientY
  beginGesture({
    kind: 'move',
    pointerId: event.pointerId,
    keys: origins.map((origin) => origin.clipKey),
    origins,
    primaryKey: primaryKeyValue,
    startX: event.clientX,
    startY: event.clientY,
    delta: 0,
    targetTrackId: null,
    targetInvalid: false,
    moved: false,
  })
}

function updateMove(
  active: Extract<Gesture, { kind: 'move' }>,
  clientX: number,
  clientY: number,
  altKey: boolean,
): void {
  const dx = clientX - active.startX
  const dy = clientY - active.startY
  if (!active.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) {
    return
  }
  active.moved = true
  const rawDelta = dx / pxPerSecond.value
  const primary = active.origins.find((origin) => origin.clipKey === active.primaryKey) ?? active.origins[0]
  const context = controller.snapContext(active.keys)
  if (altKey) {
    context.altKey = true
  }
  const rawStart = primary.start + rawDelta
  let delta = snapTime(rawStart, context) - primary.start
  if (!primary.infinite) {
    const rawEnd = primary.start + primary.duration + rawDelta
    const endDelta = snapTime(rawEnd, context) - (primary.start + primary.duration)
    if (Math.abs(endDelta - rawDelta) < Math.abs(delta - rawDelta)) {
      delta = endDelta
    }
  }
  const minStart = Math.min(...active.origins.map((origin) => origin.start))
  active.delta = Math.max(delta, -minStart)

  const row = rowAt(clientX, clientY)
  if (row === null) {
    active.targetTrackId = null
    active.targetInvalid = false
    return
  }
  const sameType = active.origins.every((origin) => origin.trackType === row.track.type)
  const differs = active.origins.some((origin) => origin.trackId !== row.track.trackId)
  active.targetInvalid = !sameType
  active.targetTrackId = sameType && differs ? row.track.trackId : null
}

// ── 裁切 ────────────────────────────────────────────────────

function beginTrim(
  event: PointerEvent,
  clipKey: string,
  edge: 'left' | 'right',
): void {
  const found = controller.clipOf(clipKey)
  if (found === undefined) {
    return
  }
  const infinite = found.clip.infinite || found.clip.duration < 0
  if (edge === 'right' && infinite) {
    controller.notify('无限片段不能右裁切', 'warning')
    return
  }
  pointer.x = event.clientX
  pointer.y = event.clientY
  beginGesture({
    kind: 'trim',
    pointerId: event.pointerId,
    clipKey,
    edge,
    originalStart: found.clip.start,
    originalEnd: infinite ? Number.POSITIVE_INFINITY : found.clip.start + found.clip.duration,
    newTime: edge === 'left' ? found.clip.start : found.clip.start + found.clip.duration,
    moved: false,
  })
}

function updateTrim(
  active: Extract<Gesture, { kind: 'trim' }>,
  clientX: number,
  _clientY: number,
  altKey: boolean,
): void {
  void _clientY
  const raw = timeAtClientX(clientX)
  const snapped = controller.snap(raw, [active.clipKey], altKey)
  let next = snapped
  if (active.edge === 'left') {
    next = Math.min(Math.max(0, next), active.originalEnd - 0.05)
  } else {
    next = Math.max(active.originalStart + 0.05, next)
  }
  if (!Number.isFinite(next)) {
    return
  }
  active.newTime = next
  const before = active.edge === 'left' ? active.originalStart : active.originalEnd
  active.moved = Math.abs(next - before) > 0.0005
}

// ── 框选 ────────────────────────────────────────────────────

function beginMarquee(event: PointerEvent, additive: boolean): void {
  const rect = trackAreaRect()
  if (rect === null) {
    return
  }
  event.preventDefault()
  pointer.x = event.clientX
  pointer.y = event.clientY
  const startX = event.clientX - rect.left + controller.scrollLeft.value
  const startY = event.clientY - rect.top + (scrollEl.value?.scrollTop ?? 0)
  beginGesture({
    kind: 'marquee',
    pointerId: event.pointerId,
    startX,
    startY,
    currentX: startX,
    currentY: startY,
    additive,
    baseKeys: additive ? [...controller.clipKeys.value] : [],
    moved: false,
  })
}

function updateMarquee(
  active: Extract<Gesture, { kind: 'marquee' }>,
  clientX: number,
  clientY: number,
): void {
  const rect = trackAreaRect()
  if (rect === null) {
    return
  }
  active.currentX = clientX - rect.left + controller.scrollLeft.value
  active.currentY = clientY - rect.top + (scrollEl.value?.scrollTop ?? 0)
  active.moved = Math.abs(active.currentX - active.startX) > 2 || Math.abs(active.currentY - active.startY) > 2
}

function commitMarquee(active: Extract<Gesture, { kind: 'marquee' }>): void {
  const x1 = Math.min(active.startX, active.currentX)
  const x2 = Math.max(active.startX, active.currentX)
  const y1 = Math.min(active.startY, active.currentY)
  const y2 = Math.max(active.startY, active.currentY)
  const timeFrom = x1 / pxPerSecond.value
  const timeTo = x2 / pxPerSecond.value
  const hits: string[] = []
  for (const track of tracks.value) {
    const top = rowTop(track.trackId)
    if (top === null || top + rowHeight.value < y1 || top > y2) {
      continue
    }
    for (const clip of track.clips) {
      const start = clip.start
      const end = clip.infinite || clip.duration < 0 ? displayRange.value.end : clipBodyEnd(clip)
      const left = start
      const right = Math.max(end, start + 24 / pxPerSecond.value)
      if (right >= timeFrom && left <= timeTo) {
        hits.push(clip.clipKey)
      }
    }
  }
  if (!active.moved) {
    return
  }
  const merged = active.additive
    ? [...active.baseKeys, ...hits.filter((key) => !active.baseKeys.includes(key))]
    : hits
  if (merged.length === 0) {
    if (!active.additive) {
      controller.clearSelection()
    }
    return
  }
  const primary = hits[hits.length - 1] ?? merged[merged.length - 1]
  controller.selectClips(merged, primary)
}

// ── 手势结束 ────────────────────────────────────────────────

function onWindowPointerUp(event: PointerEvent): void {
  const active = gesture.value
  if (active === null || event.pointerId !== active.pointerId) {
    return
  }
  cancelGesture()
  if (active.kind === 'move') {
    if (active.moved && (Math.abs(active.delta) > 0.0005 || active.targetTrackId !== null)) {
      controller.moveClips(active.keys, active.delta, active.targetTrackId ?? undefined)
    }
    return
  }
  if (active.kind === 'trim') {
    if (active.moved) {
      controller.trimClip(active.clipKey, active.edge, active.newTime)
    }
    return
  }
  if (active.kind === 'marquee') {
    commitMarquee(active)
  }
}

// ── 指针按下（轨道区） ──────────────────────────────────────

function beginScrub(event: PointerEvent, time: number): void {
  event.preventDefault()
  controller.seek(time)
  pointer.x = event.clientX
  pointer.y = event.clientY
  beginGesture({ kind: 'scrub', pointerId: event.pointerId })
}

function hitOf(track: TrackViewEntry, clientX: number, time: number): TimelineHit {
  const rect = trackAreaRect()
  const xPx = rect === null ? 0 : clientX - rect.left
  return hitTest({
    clips: track.clips.map((clip) => ({
      clipKey: clip.clipKey,
      trackId: track.trackId,
      start: clip.start,
      duration: clip.duration,
      infinite: clip.infinite || clip.duration < 0,
    })),
    time,
    trackId: track.trackId,
    xPx,
    viewportWidth: Math.max(1, controller.viewportWidth.value),
    pxPerSecond: pxPerSecond.value,
    scrollLeft: controller.scrollLeft.value,
    edgePx: 8,
  })
}

function onContentPointerDown(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }
  focusPanel()
  const row = rowAt(event.clientX, event.clientY)
  const time = timeAtClientX(event.clientX)
  if (row === null) {
    beginScrub(event, time)
    return
  }
  controller.setActiveTrack(row.track.trackId)
  const state = controller.trackState(row.track.trackId)
  const hit = hitOf(row.track, event.clientX, time)

  if (controller.tool.value === 'blade') {
    if (hit.kind === 'clip' || hit.kind === 'clip-edge-left' || hit.kind === 'clip-edge-right') {
      event.preventDefault()
      if (hit.clipKey !== undefined) {
        controller.splitClip(hit.clipKey, time)
      }
      return
    }
    beginScrub(event, time)
    return
  }

  if (hit.kind === 'clip-edge-left' || hit.kind === 'clip-edge-right') {
    const edge = hit.kind === 'clip-edge-left' ? 'left' : 'right'
    if (hit.clipKey !== undefined) {
      const selected = controller.clipKeys.value.includes(hit.clipKey)
      if (event.ctrlKey || event.metaKey) {
        controller.selectClip(hit.clipKey, 'toggle')
        event.preventDefault()
        return
      }
      if (event.shiftKey) {
        controller.selectClip(hit.clipKey, 'range')
        event.preventDefault()
        return
      }
      if (!selected) {
        controller.selectClip(hit.clipKey, 'replace')
      }
      if (state.locked) {
        event.preventDefault()
        return
      }
      beginTrim(event, hit.clipKey, edge)
    }
    return
  }

  if (hit.kind === 'clip' && hit.clipKey !== undefined) {
    const selectedBefore = controller.clipKeys.value.includes(hit.clipKey)
    if (event.ctrlKey || event.metaKey) {
      controller.selectClip(hit.clipKey, 'toggle')
      event.preventDefault()
      return
    }
    if (event.shiftKey) {
      controller.selectClip(hit.clipKey, 'range')
      event.preventDefault()
      return
    }
    if (!selectedBefore) {
      controller.selectClip(hit.clipKey, 'replace')
    }
    if (state.locked) {
      event.preventDefault()
      return
    }
    if (controller.clipKeys.value.length === 0) {
      return
    }
    beginMove(event, hit.clipKey)
    return
  }

  if (hit.kind === 'track-empty' || hit.kind === 'none') {
    if (event.shiftKey) {
      beginMarquee(event, event.ctrlKey || event.metaKey)
      return
    }
    beginScrub(event, time)
  }
}

// ── 右键菜单 ────────────────────────────────────────────────

interface MenuState {
  x: number
  y: number
  items: TimelineMenuItem[]
}

const menu = ref<MenuState | null>(null)
const menuActions = new Map<string, () => void>()
const menuPoint = ref({ x: 0, y: 0 })

function shortcutOf(commandId: string): string | undefined {
  const chord = keybindings?.chordOf(commandId)
  return chord === null || chord === undefined || chord === '' ? undefined : chord
}

function openMenu(x: number, y: number, items: TimelineMenuItem[], actions: Record<string, () => void>): void {
  menuActions.clear()
  for (const [id, action] of Object.entries(actions)) {
    menuActions.set(id, action)
  }
  menu.value = { x, y, items }
}

function closeMenu(): void {
  menu.value = null
  menuActions.clear()
}

function onMenuChoose(id: string): void {
  const action = menuActions.get(id)
  menu.value = null
  menuActions.clear()
  action?.()
}

function pasteDisabledReason(track: TrackViewEntry): string | undefined {
  if (!controller.canPaste.value) {
    return '剪贴板为空'
  }
  const entry = controller.clipboard.value[0]
  if (entry === undefined) {
    return '剪贴板为空'
  }
  if (entry.trackType !== track.type) {
    return `剪贴板是 ${entry.trackType} 轨道片段，不能粘贴到 ${track.type}`
  }
  return undefined
}

function buildClipMenu(track: TrackViewEntry, clipKey: string, time: number): void {
  const found = findClip(controller.view.value, clipKey)
  if (found === undefined) {
    return
  }
  const clip = found.clip
  const locked = controller.trackState(found.track.trackId).locked
  const infinite = clip.infinite || clip.duration < 0
  const referenced = clip.references > 0
  const playheadIn = controller.session.value.playhead
  const canSplitPlayhead =
    !locked &&
    !infinite &&
    !referenced &&
    playheadIn > clip.start + 0.01 &&
    playheadIn < clip.start + clip.duration - 0.01
  const canSplitHere =
    !locked &&
    !infinite &&
    !referenced &&
    time > clip.start + 0.01 &&
    time < clip.start + clip.duration - 0.01
  const splitReason = locked
    ? '轨道已锁定'
    : infinite
      ? '无限片段不能分割'
      : referenced
        ? `被引用 ${clip.references} 处，不能分割`
        : '分割点必须距片段端点至少 0.01s'
  const addCheck = controller.canCreateClip(track.type)
  const pasteReason = pasteDisabledReason(track)
  const items: TimelineMenuItem[] = [
    { id: 'openScript', label: '打开脚本', disabled: true, reason: '脚本页入口在顶栏' },
    {
      id: 'addClip',
      label: '在此添加片段',
      disabled: locked || !addCheck.ok,
      ...(locked ? { reason: '轨道已锁定' } : !addCheck.ok ? { reason: addCheck.reason } : {}),
    },
    { id: 'copy', label: '复制片段', shortcut: shortcutOf('timeline.copy') },
    {
      id: 'cut',
      label: '剪切片段',
      shortcut: shortcutOf('timeline.cut'),
      disabled: locked,
      ...(locked ? { reason: '轨道已锁定' } : {}),
    },
    {
      id: 'paste',
      label: '粘贴片段',
      shortcut: shortcutOf('timeline.paste'),
      disabled: pasteReason !== undefined || locked,
      ...(pasteReason !== undefined ? { reason: pasteReason } : locked ? { reason: '轨道已锁定' } : {}),
    },
    { id: 'splitPlayhead', label: '在播放头分割', shortcut: shortcutOf('timeline.split'), disabled: !canSplitPlayhead, ...(canSplitPlayhead ? {} : { reason: splitReason }) },
    { id: 'splitHere', label: '刀片分割（当前点击位置）', disabled: !canSplitHere, ...(canSplitHere ? {} : { reason: splitReason }) },
    {
      id: 'duplicate',
      label: '复制一份',
      shortcut: shortcutOf('timeline.duplicate'),
      disabled: locked,
      ...(locked ? { reason: '轨道已锁定' } : {}),
    },
    {
      id: 'toggleLoop',
      label: '切换循环',
      shortcut: shortcutOf('timeline.toggleLoop'),
      disabled: locked || (!clip.loop && infinite),
      ...(locked ? { reason: '轨道已锁定' } : !clip.loop && infinite ? { reason: '无限片段不能开启循环' } : {}),
    },
    { id: 'delete', label: '删除片段', shortcut: shortcutOf('timeline.delete'), disabled: locked, danger: true, ...(locked ? { reason: '轨道已锁定' } : {}) },
    {
      id: 'rippleDelete',
      label: '波纹删除',
      shortcut: shortcutOf('timeline.rippleDelete'),
      disabled: locked || infinite,
      danger: true,
      ...(locked ? { reason: '轨道已锁定' } : infinite ? { reason: '无限片段不能波纹删除' } : {}),
    },
  ]
  openMenu(menuPoint.value.x, menuPoint.value.y, items, {
    addClip: () => controller.addClip(track.trackId, time),
    copy: () => controller.copySelection(),
    cut: () => controller.cutSelection(),
    paste: () => controller.pasteAt(time, track.trackId),
    splitPlayhead: () => controller.splitSelectionAtPlayhead(),
    splitHere: () => controller.splitClip(clipKey, time),
    duplicate: () => controller.duplicateSelection(),
    toggleLoop: () => controller.toggleLoopSelection(),
    delete: () => controller.deleteSelection(false),
    rippleDelete: () => controller.deleteSelection(true),
  })
}

function buildTrackMenu(track: TrackViewEntry): void {
  const docTracks = controller.tracks.value
  const index = docTracks.findIndex((entry) => entry.trackId === track.trackId)
  const thirdParty = track.type.includes(':')
  const empty = track.clips.length === 0
  const items: TimelineMenuItem[] = [
    {
      id: 'rename',
      label: '重命名轨道',
      disabled: thirdParty,
      ...(thirdParty ? { reason: '第三方轨道名只读' } : {}),
    },
    {
      id: 'delete',
      label: '删除轨道',
      disabled: !empty,
      danger: true,
      ...(empty ? { confirmLabel: `删除轨道「${controller.trackName(track)}」？` } : { reason: '只能删除空轨道' }),
    },
    { id: 'sep', label: '', separator: true },
    {
      id: 'up',
      label: '上移',
      disabled: index <= 0,
      ...(index <= 0 ? { reason: '已经在最上面' } : {}),
    },
    {
      id: 'down',
      label: '下移',
      disabled: index < 0 || index >= docTracks.length - 1,
      ...(index < 0 || index >= docTracks.length - 1 ? { reason: '已经在最下面' } : {}),
    },
  ]
  openMenu(menuPoint.value.x, menuPoint.value.y, items, {
    rename: () => beginRename(track.trackId),
    delete: () => controller.removeTrack(track.trackId),
    up: () => controller.reorderTrack(track.trackId, index - 1),
    down: () => controller.reorderTrack(track.trackId, index + 1),
  })
}

function buildEmptyTrackMenu(track: TrackViewEntry, time: number): void {
  const locked = controller.trackState(track.trackId).locked
  const addCheck = controller.canCreateClip(track.type)
  const pasteReason = pasteDisabledReason(track)
  const items: TimelineMenuItem[] = [
    {
      id: 'addClip',
      label: '在此添加片段',
      disabled: locked || !addCheck.ok,
      ...(locked ? { reason: '轨道已锁定' } : !addCheck.ok ? { reason: addCheck.reason } : {}),
    },
    {
      id: 'paste',
      label: '粘贴片段',
      disabled: pasteReason !== undefined || locked,
      ...(pasteReason !== undefined ? { reason: pasteReason } : locked ? { reason: '轨道已锁定' } : {}),
    },
    { id: 'addTrack', label: '添加轨道…' },
  ]
  openMenu(menuPoint.value.x, menuPoint.value.y, items, {
    addClip: () => controller.addClip(track.trackId, time),
    paste: () => controller.pasteAt(time, track.trackId),
    addTrack: () => {
      addTrackOpen.value = true
    },
  })
}

function buildRulerMenu(time: number): void {
  const viewValue = controller.view.value
  const hasLoop = viewValue !== null && (viewValue.loopStart !== null || viewValue.loopEnd !== null)
  const items: TimelineMenuItem[] = [
    { id: 'loopIn', label: '循环入 = 此处', shortcut: shortcutOf('timeline.setLoopIn') },
    { id: 'loopOut', label: '循环出 = 此处', shortcut: shortcutOf('timeline.setLoopOut') },
    { id: 'clearLoop', label: '清除 A-B', disabled: !hasLoop, ...(hasLoop ? {} : { reason: '当前没有 A-B' }) },
    { id: 'sep', label: '', separator: true },
    { id: 'fit', label: '缩放到全部', shortcut: shortcutOf('timeline.fit') },
    { id: 'marker', label: `在此添加标记（${formatSeconds(time)}s）` },
    { id: 'clearMarkers', label: '清除全部标记', disabled: controller.session.value.markers.length === 0, ...(controller.session.value.markers.length === 0 ? { reason: '当前没有标记' } : {}) },
  ]
  openMenu(menuPoint.value.x, menuPoint.value.y, items, {
    loopIn: () => controller.applyLoopRange(time, null),
    loopOut: () => controller.applyLoopRange(null, time),
    clearLoop: () => controller.clearLoop(),
    fit: () => controller.fit(),
    marker: () => controller.addMarkerAt(time),
    clearMarkers: () => controller.clearMarkers(),
  })
}

function pointerTime(event: MouseEvent): number {
  const rect = trackAreaRect()
  if (rect === null) {
    return playhead.value
  }
  return Math.max(0, screenXToTime(event.clientX - rect.left, scale.value))
}

function onContentContextMenu(event: MouseEvent): void {
  event.preventDefault()
  menuPoint.value = { x: event.clientX, y: event.clientY }
  const row = rowAt(event.clientX, event.clientY)
  const time = pointerTime(event)
  if (row === null) {
    const track = controller.activeTrack.value
    if (track !== undefined) {
      buildEmptyTrackMenu(track, time)
    }
    return
  }
  controller.setActiveTrack(row.track.trackId)
  const hit = hitOf(row.track, event.clientX, time)
  if (hit.kind === 'clip' || hit.kind === 'clip-edge-left' || hit.kind === 'clip-edge-right') {
    if (hit.clipKey !== undefined) {
      if (!controller.clipKeys.value.includes(hit.clipKey)) {
        controller.selectClip(hit.clipKey, 'replace')
      }
      buildClipMenu(row.track, hit.clipKey, time)
    }
    return
  }
  buildEmptyTrackMenu(row.track, time)
}

function onRulerContextMenu(event: MouseEvent, time: number): void {
  menuPoint.value = { x: event.clientX, y: event.clientY }
  buildRulerMenu(time)
}

function onHeaderContextMenu(event: MouseEvent, track: TrackViewEntry): void {
  menuPoint.value = { x: event.clientX, y: event.clientY }
  controller.setActiveTrack(track.trackId)
  buildTrackMenu(track)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (gesture.value !== null) {
      event.preventDefault()
      abortGesture()
      return
    }
    if (menu.value !== null) {
      event.preventDefault()
      closeMenu()
      return
    }
    if (controller.clipKeys.value.length > 0) {
      event.preventDefault()
      controller.clearSelection()
      controller.setTool('select')
      return
    }
    if (controller.tool.value === 'blade') {
      event.preventDefault()
      controller.setTool('select')
    }
    return
  }
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault()
    openMenuForFocus()
  }
}

function openMenuForFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    const clipEl = active.closest<HTMLElement>('[data-clip-key]')
    if (clipEl !== null) {
      const clipKey = clipEl.dataset.clipKey
      const found = clipKey === undefined ? undefined : controller.clipOf(clipKey)
      if (clipKey !== undefined && found !== undefined) {
        const rect = clipEl.getBoundingClientRect()
        menuPoint.value = { x: rect.left, y: rect.bottom }
        controller.selectClip(clipKey, 'replace')
        buildClipMenu(found.track, clipKey, found.clip.start + found.clip.duration / 2)
        return
      }
    }
    const headerEl = active.closest<HTMLElement>('[data-track-header]')
    if (headerEl !== null) {
      const trackId = headerEl.dataset.trackHeader
      const track = trackId === undefined ? undefined : findTrack(controller.view.value, trackId)
      if (track !== undefined) {
        const rect = headerEl.getBoundingClientRect()
        menuPoint.value = { x: rect.left, y: rect.bottom }
        buildTrackMenu(track)
        return
      }
    }
  }
  const rootRect = rootEl.value?.getBoundingClientRect()
  menuPoint.value = { x: (rootRect?.left ?? 0) + HEADER_WIDTH, y: (rootRect?.top ?? 0) + 40 }
  buildRulerMenu(playhead.value)
}

// ── 重命名（菜单入口） ──────────────────────────────────────

interface RenameState {
  trackId: string
  value: string
  error: string
}

const rename = ref<RenameState | null>(null)

function beginRename(trackId: string): void {
  const track = findTrack(controller.view.value, trackId)
  if (track === undefined) {
    return
  }
  if (track.type.includes(':')) {
    controller.notify('第三方轨道名只读', 'warning')
    return
  }
  rename.value = { trackId, value: track.name, error: '' }
  void nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function commitRename(): void {
  const current = rename.value
  if (current === null) {
    return
  }
  const name = current.value.trim()
  if (name.length === 0) {
    current.error = '轨道名不能为空'
    return
  }
  const outcome: CommitOutcome = controller.renameTrack(current.trackId, name)
  if (!outcome.ok) {
    current.error = outcome.error ?? '重命名被拒绝'
    return
  }
  rename.value = null
}

function cancelRename(): void {
  rename.value = null
}

function onRenameKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

// ── 面板 / 工具栏绑定 ────────────────────────────────────────

function focusPanel(): void {
  if (focusService !== undefined && focusService.currentRegion() !== panelScope) {
    focusService.focusRegion(panelScope)
  }
}

function onRootPointerDown(event: PointerEvent): void {
  focusPanel()
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }
  const interactive = target.closest('button, input, textarea, select, [contenteditable="true"], [tabindex="0"]')
  if (interactive === null) {
    rootEl.value?.focus({ preventScroll: true })
  }
}

function onClipSelect(clipKey: string): void {
  controller.selectClip(clipKey, 'replace')
}

function onToolbarAddClip(): void {
  const track = controller.activeTrack.value
  if (track === undefined) {
    controller.notify('先添加轨道', 'warning')
    return
  }
  controller.addClip(track.trackId)
}

function onToolbarAddTrack(type: string): void {
  controller.addTrack(type)
  addTrackOpen.value = false
}

function onToolbarPaste(): void {
  controller.pasteAt(playhead.value)
}

function onShowTrack(trackId: string): void {
  controller.setTrackView(trackId, { visible: true })
}

function onTrackDragStart(trackId: string): void {
  draggingTrackId.value = trackId
}

function onTrackDragEnd(): void {
  draggingTrackId.value = null
}

/** 一次 drop 一条 reorder 命令；片段时间不变。 */
function onTrackDrop(targetId: string): void {
  const sourceId = draggingTrackId.value
  draggingTrackId.value = null
  if (sourceId === null || sourceId === targetId) {
    return
  }
  const docTracks = controller.tracks.value
  const from = docTracks.findIndex((track) => track.trackId === sourceId)
  const to = docTracks.findIndex((track) => track.trackId === targetId)
  if (from < 0 || to < 0 || from === to) {
    return
  }
  controller.reorderTrack(sourceId, to)
}

function onRulerPreview(range: { start: number; end: number } | null): void {
  controller.setPreviewRange(range)
}

function onRulerMarkerMove(from: number, to: number): void {
  controller.moveMarker(from, to)
}

function onRulerMarkerRemove(time: number): void {
  controller.removeMarkerNear(time)
}

function onMarkerContextMenu(event: MouseEvent, time: number): void {
  menuPoint.value = { x: event.clientX, y: event.clientY }
  const items: TimelineMenuItem[] = [
    { id: 'seek', label: `跳到标记（${formatSeconds(time)}s）` },
    { id: 'remove', label: '删除标记', danger: true },
    { id: 'clear', label: '清除全部标记', danger: true },
  ]
  openMenu(menuPoint.value.x, menuPoint.value.y, items, {
    seek: () => controller.seek(time),
    remove: () => controller.removeMarkerNear(time),
    clear: () => controller.clearMarkers(),
  })
}

function onWheelZoom(event: WheelEvent, anchorHost: HTMLElement | null): void {
  if (!(event.ctrlKey || event.metaKey)) {
    return
  }
  event.preventDefault()
  const host = anchorHost ?? rootEl.value
  if (host === null) {
    return
  }
  const rect = host.getBoundingClientRect()
  controller.zoomByWheel(event.clientX - rect.left, event.deltaY)
}

function onContentWheel(event: WheelEvent): void {
  onWheelZoom(event, scrollEl.value)
}

function onRulerWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    onWheelZoom(event, scrollEl.value)
    return
  }
  const element = scrollEl.value
  if (element === null) {
    return
  }
  event.preventDefault()
  if (event.shiftKey) {
    element.scrollLeft += event.deltaY
    return
  }
  element.scrollTop += event.deltaY
  element.scrollLeft += event.deltaX
}

function onHeaderWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    onWheelZoom(event, scrollEl.value)
    return
  }
  const element = scrollEl.value
  if (element === null) {
    return
  }
  event.preventDefault()
  element.scrollTop += event.deltaY
}

// ── 拖动 ghost / 框选覆盖层 ─────────────────────────────────

interface GhostBlock {
  key: string
  left: number
  top: number
  width: number
  height: number
}

const ghostBlocks = computed<GhostBlock[]>(() => {
  const active = gesture.value
  if (active === null || active.kind !== 'move' || !active.moved || active.targetInvalid) {
    return []
  }
  const blocks: GhostBlock[] = []
  for (const origin of active.origins) {
    const targetId = active.targetTrackId ?? origin.trackId
    const top = rowTop(targetId)
    if (top === null) {
      continue
    }
    const start = Math.max(0, origin.start + active.delta)
    const width = origin.infinite
      ? Math.max(24, (displayRange.value.end - start) * pxPerSecond.value)
      : Math.max(24, origin.duration * pxPerSecond.value)
    blocks.push({
      key: origin.clipKey,
      left: start * pxPerSecond.value,
      top: top + (rowHeight.value - clipHeight.value) / 2,
      width,
      height: clipHeight.value,
    })
  }
  return blocks
})

const trimGhostX = computed(() => {
  const active = gesture.value
  if (active === null || active.kind !== 'trim' || !active.moved) {
    return null
  }
  return active.newTime * pxPerSecond.value
})

const marqueeRect = computed(() => {
  const active = gesture.value
  if (active === null || active.kind !== 'marquee' || !active.moved) {
    return null
  }
  const left = Math.min(active.startX, active.currentX)
  const top = Math.min(active.startY, active.currentY)
  return {
    left,
    top,
    width: Math.abs(active.currentX - active.startX),
    height: Math.abs(active.currentY - active.startY),
  }
})

const dragActive = computed(() => gesture.value !== null)

const hiddenTrackLabels = computed(() =>
  hiddenTracks.value.map((track) => ({ trackId: track.trackId, label: track.label })),
)

const trackOptions = controller.addTrackOptions
const selectionText = controller.selectionInfo

function onLoopChange(start: number | null, end: number | null): void {
  controller.applyLoopRange(start, end)
}

function trackColorOf(type: string): string {
  return trackColorVar(type)
}
</script>

<template>
  <section
    ref="rootEl"
    class="timeline-panel"
    tabindex="-1"
    aria-label="时间轴"
    @pointerdown.capture="onRootPointerDown"
    @keydown="onKeydown"
  >
    <TimelineToolbar
      :pps="pxPerSecond"
      :tool="controller.tool.value"
      :snap-enabled="controller.snapEnabled.value"
      :playhead="playhead"
      :selection-text="selectionText"
      :has-tracks="controller.tracks.value.length > 0"
      :has-clips="hasClips"
      :has-selection="controller.clipKeys.value.length > 0"
      :has-markers="controller.session.value.markers.length > 0"
      :can-add-clip="controller.canAddClipToActive.value.ok"
      :add-clip-reason="controller.canAddClipToActive.value.reason"
      :can-paste="controller.canPaste.value"
      :paste-reason="controller.canPaste.value ? undefined : '剪贴板为空'"
      :compact="compact"
      :narrow="narrow"
      :track-options="trackOptions"
      :add-track-open="addTrackOpen"
      :hidden-tracks="hiddenTrackLabels"
      :can-transport="controller.canPlay.value"
      :transport-reason="controller.transportReason.value"
      :playing="controller.playing.value"
      @update:tool="controller.setTool($event)"
      @update:add-track-open="addTrackOpen = $event"
      @add-clip="onToolbarAddClip"
      @add-track="onToolbarAddTrack"
      @show-track="onShowTrack"
      @zoom-in="controller.zoomBy(1.25)"
      @zoom-out="controller.zoomBy(0.8)"
      @fit="controller.fit()"
      @seek="controller.seek($event)"
      @add-marker="controller.addMarkerAtPlayhead()"
      @clear-markers="controller.clearMarkers()"
      @play="controller.play()"
      @pause="controller.pause()"
      @stop="controller.stop()"
      @toggle-snap="controller.toggleSnap()"
      @paste="onToolbarPaste"
    />

    <div v-if="view === null" class="timeline-panel__empty">
      <p class="timeline-panel__empty-title">没有打开文档</p>
      <p class="timeline-panel__empty-hint">从顶栏打开脚本后即可编辑时间轴。</p>
    </div>

    <div v-else-if="view.tracks.length === 0" class="timeline-panel__empty">
      <p class="timeline-panel__empty-title">还没有轨道</p>
      <p class="timeline-panel__empty-hint">时间轴只显示文档里的轨道，不自动补七轨。</p>
      <button type="button" class="timeline-panel__cta" @click="addTrackOpen = true">添加轨道</button>
    </div>

    <div v-else class="timeline-panel__body">
      <div class="timeline-panel__ruler-row">
        <div class="timeline-panel__corner" :style="{ width: `${HEADER_WIDTH}px` }" aria-hidden="true">时间</div>
        <TimelineRuler
          :scale="scale"
          :display-range="displayRange"
          :playhead="playhead"
          :markers="controller.session.value.markers"
          :loop-start="view?.loopStart ?? null"
          :loop-end="view?.loopEnd ?? null"
          :preview-range="controller.session.value.previewRange"
          :compact="compact"
          :disabled="dragActive"
          @seek="controller.seek($event)"
          @preview="onRulerPreview"
          @loop-change="onLoopChange"
          @context-menu="onRulerContextMenu"
          @marker-move="onRulerMarkerMove"
          @marker-remove="onRulerMarkerRemove"
          @marker-context-menu="onMarkerContextMenu"
          @wheel="onRulerWheel"
        />
      </div>

      <div class="timeline-panel__tracks">
        <div class="timeline-panel__headers" :style="{ width: `${HEADER_WIDTH}px` }" @wheel="onHeaderWheel">
          <div class="timeline-panel__headers-inner" :style="{ transform: `translateY(${-scrollTop}px)` }">
            <TrackHeader
              v-for="track in tracks"
              :key="track.trackId"
              :track="track"
              :session="controller.trackState(track.trackId)"
              :color="trackColorVar(track.type)"
              :compact="compact"
              :row-height="rowHeight"
              :active="controller.activeTrack.value?.trackId === track.trackId"
              :can-rename="!track.type.includes(':')"
              :readonly-reason="'第三方轨道名只读'"
              :known="controller.trackKnown(track.type)"
              :dragging="draggingTrackId === track.trackId"
              :rename-track="(name) => controller.renameTrack(track.trackId, name)"
              @activate="controller.setActiveTrack(track.trackId)"
              @toggle-visible="controller.toggleTrackVisible(track.trackId)"
              @toggle-locked="controller.toggleTrackLocked(track.trackId)"
              @toggle-muted="controller.toggleTrackMuted(track.trackId)"
              @add-clip="controller.addClip(track.trackId)"
              @context-menu="onHeaderContextMenu($event, track)"
              @drag-start="onTrackDragStart"
              @drop-track="onTrackDrop"
              @drag-end="onTrackDragEnd"
            />
          </div>
        </div>

        <div
          ref="scrollEl"
          class="timeline-panel__scroll"
          @scroll="onScroll"
          @wheel="onContentWheel"
          @pointerdown="onContentPointerDown"
          @contextmenu="onContentContextMenu"
        >
          <div
            class="timeline-panel__content"
            :style="{ width: `${contentWidth}px`, height: `${totalHeight + 8}px` }"
          >
            <TrackRow
              v-for="track in tracks"
              :key="track.trackId"
              :track="track"
              :session="controller.trackState(track.trackId)"
              :px-per-second="pxPerSecond"
              :scroll-left="controller.scrollLeft.value"
              :viewport-width="controller.viewportWidth.value"
              :row-height="rowHeight"
              :clip-height="clipHeight"
              :display-range="displayRange"
              :selection="controller.clipKeys.value"
              :primary-key="controller.primaryClipKey.value"
              :tool="controller.tool.value"
              :track-color="trackColorOf(track.type)"
              @select="onClipSelect"
              @add-clip="controller.addClip($event)"
            />

            <div
              class="timeline-panel__playhead"
              :style="{ left: `${playheadX}px`, height: `${totalHeight}px` }"
              aria-hidden="true"
            ></div>

            <div
              v-if="trimGhostX !== null"
              class="timeline-panel__trim"
              :style="{ left: `${trimGhostX}px`, height: `${totalHeight}px` }"
              aria-hidden="true"
            ></div>

            <div
              v-for="ghost in ghostBlocks"
              :key="`ghost-${ghost.key}`"
              class="timeline-panel__ghost"
              :style="{
                left: `${ghost.left}px`,
                top: `${ghost.top}px`,
                width: `${ghost.width}px`,
                height: `${ghost.height}px`,
              }"
              aria-hidden="true"
            ></div>

            <div
              v-if="marqueeRect !== null"
              class="timeline-panel__marquee"
              :style="{
                left: `${marqueeRect.left}px`,
                top: `${marqueeRect.top}px`,
                width: `${marqueeRect.width}px`,
                height: `${marqueeRect.height}px`,
              }"
              aria-hidden="true"
            ></div>
          </div>
        </div>
      </div>

      <div v-if="tracks.length === 0" class="timeline-panel__hidden-note">
        <span>所有轨道已隐藏</span>
        <button
          v-for="track in hiddenTracks"
          :key="track.trackId"
          type="button"
          class="timeline-panel__cta timeline-panel__cta--small"
          @click="onShowTrack(track.trackId)"
        >
          显示 {{ track.label }}
        </button>
      </div>
    </div>

    <form v-if="rename !== null" class="timeline-panel__rename" @submit.prevent="commitRename">
      <label class="timeline-panel__rename-label" for="timeline-rename-input">重命名轨道</label>
      <input
        id="timeline-rename-input"
        ref="renameInput"
        v-model="rename.value"
        class="timeline-panel__rename-input"
        type="text"
        maxlength="64"
        @keydown="onRenameKeydown"
      />
      <button type="submit" class="timeline-panel__cta timeline-panel__cta--small">确定</button>
      <button type="button" class="timeline-panel__cta timeline-panel__cta--small" @click="cancelRename">取消</button>
      <span v-if="rename.error.length > 0" class="timeline-panel__rename-error" role="alert">{{ rename.error }}</span>
    </form>

    <!-- 07-05 §四：删除被路径引用片段时的「阻止 + 处理选项」 -->
    <div v-if="controller.pendingDelete.value !== null" class="timeline-panel__guard" role="alert">
      <p class="timeline-panel__guard-text">
        选中片段被 {{ controller.pendingDelete.value.affected.length }} 条路径引用，直接删除会让它们失效：
      </p>
      <ul class="timeline-panel__guard-list">
        <li v-for="item in controller.pendingDelete.value.affected" :key="item.id" class="timeline-panel__guard-id">
          {{ item.id }} · {{ item.reason }}
        </li>
      </ul>
      <div class="timeline-panel__guard-actions">
        <button type="button" class="timeline-panel__cta timeline-panel__cta--small" @click="controller.confirmDelete()">删除这些路径并继续</button>
        <button type="button" class="timeline-panel__cta timeline-panel__cta--small" @click="controller.cancelDelete()">取消</button>
      </div>
    </div>

    <div v-if="helpOpen" class="timeline-panel__help" role="dialog" aria-label="事件触发与 seek 语义">
      <header class="timeline-panel__help-head">
        <span>事件触发与 seek 语义</span>
        <button type="button" class="timeline-panel__cta timeline-panel__cta--small" @click="helpOpen = false">关闭</button>
      </header>
      <ul class="timeline-panel__help-list">
        <li v-for="entry in controller.seekSemantics" :key="entry.id" class="timeline-panel__help-item">
          <strong class="timeline-panel__help-title">{{ entry.title }}</strong>
          <p class="timeline-panel__help-detail">{{ entry.detail }}</p>
        </li>
      </ul>
    </div>

    <TimelineContextMenu
      v-if="menu !== null"
      :x="menu.x"
      :y="menu.y"
      :items="menu.items"
      @choose="onMenuChoose"
      @close="closeMenu"
    />
  </section>
</template>

<style scoped>
.timeline-panel {
  --c1: var(--track-camera);
  --c2: var(--track-audio);
  --c3: var(--track-event);
  --c4: var(--track-mod_event);
  --c5: var(--track-overlay);
  --c6: var(--track-letterbox);

  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.timeline-panel:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.timeline-panel__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.timeline-panel__ruler-row {
  display: flex;
  flex: 0 0 auto;
  align-items: stretch;
  min-height: 0;
}

.timeline-panel__corner {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding-left: 8px;
  overflow: hidden;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 10px;
}

.timeline-panel__tracks {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.timeline-panel__headers {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
}

.timeline-panel__headers-inner {
  will-change: transform;
}

.timeline-panel__scroll {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  background: var(--bg-app);
  scrollbar-color: var(--scrollbar) transparent;
}

.timeline-panel__content {
  position: relative;
  min-width: 100%;
}

.timeline-panel__playhead {
  position: absolute;
  top: 0;
  z-index: 20;
  width: 1px;
  pointer-events: none;
  background: var(--accent);
}

.timeline-panel__trim {
  position: absolute;
  top: 0;
  z-index: 21;
  width: 1px;
  pointer-events: none;
  border-left: 2px dashed var(--warning);
}

.timeline-panel__ghost {
  position: absolute;
  z-index: 22;
  box-sizing: border-box;
  pointer-events: none;
  border: 1px dashed var(--accent);
  border-radius: 4px;
  background: var(--bg-selected);
  opacity: 0.55;
}

.timeline-panel__marquee {
  position: absolute;
  z-index: 23;
  box-sizing: border-box;
  pointer-events: none;
  border: 1px solid var(--selection-outline);
  background: var(--bg-selected);
  opacity: 0.4;
}

.timeline-panel__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 12px;
  text-align: center;
}

.timeline-panel__empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.timeline-panel__empty-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.timeline-panel__hidden-note {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
  padding: 4px 8px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
}

.timeline-panel__cta {
  padding: 4px 12px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.timeline-panel__cta--small {
  padding: 2px 8px;
  font-size: 11px;
}

.timeline-panel__cta:hover {
  background: var(--bg-selected);
}

.timeline-panel__cta:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.timeline-panel__rename {
  position: absolute;
  top: 6px;
  left: 50%;
  z-index: 35;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-raised);
  box-shadow: 0 6px 18px var(--shadow);
  transform: translateX(-50%);
}

.timeline-panel__rename-label {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.timeline-panel__rename-input {
  width: 160px;
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
}

.timeline-panel__rename-input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

.timeline-panel__rename-error {
  color: var(--error);
  font-size: 10px;
}

.timeline-panel__guard {
  position: absolute;
  top: 6px;
  left: 50%;
  z-index: 35;
  width: min(320px, calc(100% - 24px));
  padding: 8px 10px;
  border: 1px solid var(--warning);
  border-radius: 5px;
  background: var(--bg-raised);
  box-shadow: 0 6px 18px var(--shadow);
  transform: translateX(-50%);
}

.timeline-panel__guard-text {
  margin: 0 0 4px;
  font-size: 11px;
}

.timeline-panel__guard-list {
  margin: 0 0 8px;
  padding-left: 16px;
  font-size: 11px;
}

.timeline-panel__guard-id {
  font-family: var(--font-mono, monospace);
  overflow-wrap: anywhere;
}

.timeline-panel__guard-actions {
  display: flex;
  gap: 6px;
}
</style>
