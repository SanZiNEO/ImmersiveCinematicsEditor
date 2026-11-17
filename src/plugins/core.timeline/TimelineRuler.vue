<script setup lang="ts">
/**
 * 标尺（05-12）：刻度 + 播放头 scrub + Shift 预览范围 + 脚本 A-B + 标记。
 *
 * 只负责「点到时间」的交互；A-B 与预览范围分开：
 * - A-B 拖动只在松手时 emit `loopChange`（一次文档命令）；
 * - Shift+拖动只改会话预览范围，不碰 `doc.timeline.loop_*`。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  chooseRulerInterval,
  rulerTicks,
  screenXToTime,
  timeToScreenX,
  type DisplayRange,
  type TimelineScale,
} from '../../core/timeline/geometry.ts'
import type { PreviewRange } from '../../workbench/api/documents.ts'
import { formatSeconds } from './model.ts'

const props = defineProps<{
  scale: TimelineScale
  displayRange: DisplayRange
  playhead: number
  markers: readonly number[]
  loopStart: number | null
  loopEnd: number | null
  previewRange: PreviewRange | null
  compact: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  seek: [time: number]
  preview: [range: PreviewRange | null]
  loopChange: [start: number | null, end: number | null]
  contextMenu: [event: MouseEvent, time: number]
  markerMove: [from: number, to: number]
  markerRemove: [time: number]
  markerContextMenu: [event: MouseEvent, time: number]
}>()

type RulerGesture =
  | { kind: 'scrub'; pointerId: number }
  | { kind: 'preview'; pointerId: number; anchor: number; base: PreviewRange | null; current: PreviewRange | null }
  | { kind: 'loop'; pointerId: number; edge: 'start' | 'end'; start: number | null; end: number | null }
  | { kind: 'marker'; pointerId: number; from: number; current: number; moved: boolean }

const rootEl = ref<HTMLElement | null>(null)
const gesture = ref<RulerGesture | null>(null)

const width = computed(() => Math.max(1, props.scale.viewportWidth))
const interval = computed(() => chooseRulerInterval(props.scale.pxPerSecond))

const ticks = computed(() => {
  const list = rulerTicks(props.displayRange, props.scale.pxPerSecond, width.value)
  const result: Array<{ time: number; major: boolean; label: string; x: number }> = []
  for (const tick of list) {
    const x = timeToScreenX(tick.time, props.scale)
    if (x < -2 || x > width.value + 2) {
      continue
    }
    result.push({ ...tick, x })
  }
  return result
})

const playheadX = computed(() => timeToScreenX(props.playhead, props.scale))
const playheadLabel = computed(() => `${formatSeconds(props.playhead)}s`)

function xOf(time: number): number {
  return timeToScreenX(time, props.scale)
}

function clampTime(time: number): number {
  const start = Math.max(0, props.displayRange.start)
  const end = Math.max(start, props.displayRange.end)
  return Math.min(end, Math.max(start, time))
}

function timeAtEvent(event: PointerEvent | MouseEvent): number {
  const element = rootEl.value
  if (element === null) {
    return 0
  }
  const rect = element.getBoundingClientRect()
  return clampTime(screenXToTime(event.clientX - rect.left, props.scale))
}

const loopBand = computed(() => {
  const start = props.loopStart
  const end = props.loopEnd
  if (start === null || end === null) {
    return null
  }
  return { left: xOf(start), width: Math.max(0, xOf(end) - xOf(start)) }
})

const infiniteBand = computed(() => {
  if (!props.displayRange.infinite) {
    return null
  }
  const startTime = props.displayRange.finiteEnd ?? props.displayRange.start
  const left = timeToScreenX(startTime, props.scale)
  return { left: Math.max(0, left), width: Math.max(0, width.value - Math.max(0, left)) }
})

function loopGhostX(edge: 'start' | 'end'): number | null {
  const active = gesture.value
  if (active === null || active.kind !== 'loop' || active.edge !== edge) {
    return null
  }
  const value = edge === 'start' ? active.start : active.end
  return value === null ? null : xOf(value)
}

/** 拖动中的预览范围（手势期间优先于 props）。 */
const livePreview = computed(() => {
  const active = gesture.value
  if (active !== null && active.kind === 'preview') {
    return active.current
  }
  return props.previewRange
})
const livePreviewBand = computed(() => {
  const range = livePreview.value
  if (range === null) {
    return null
  }
  return { left: xOf(range.start), width: Math.max(0, xOf(range.end) - xOf(range.start)) }
})

/** 拖动中的标记位置。 */
const markerItems = computed(() =>
  props.markers.map((time) => {
    const active = gesture.value
    const at = active !== null && active.kind === 'marker' && Math.abs(active.from - time) < 0.0005
      ? active.current
      : time
    return { origin: time, time: at, x: xOf(at) }
  }),
)

// ── 手势 ─────────────────────────────────────────────────────

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

function beginGesture(next: RulerGesture): void {
  if (gesture.value !== null) {
    return
  }
  gesture.value = next
  addWindowListeners()
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled === true || event.button !== 0) {
    return
  }
  const time = timeAtEvent(event)
  event.preventDefault()
  if (event.shiftKey) {
    beginGesture({
      kind: 'preview',
      pointerId: event.pointerId,
      anchor: time,
      base: props.previewRange,
      current: null,
    })
    return
  }
  emit('seek', time)
  beginGesture({ kind: 'scrub', pointerId: event.pointerId })
}

function onWindowPointerMove(event: PointerEvent): void {
  const active = gesture.value
  if (active === null || event.pointerId !== active.pointerId) {
    return
  }
  const time = timeAtEvent(event)
  if (active.kind === 'scrub') {
    emit('seek', time)
    return
  }
  if (active.kind === 'preview') {
    const start = Math.min(active.anchor, time)
    const end = Math.max(active.anchor, time)
    if (end - start < 0.001) {
      active.current = null
      return
    }
    active.current = { start, end }
    return
  }
  if (active.kind === 'loop') {
    if (active.edge === 'start') {
      const end = active.end
      const bounded = end === null ? time : Math.min(time, end - 0.001)
      active.start = Math.max(0, bounded)
    } else {
      const start = active.start ?? 0
      const finite = props.displayRange.finiteEnd
      const max = props.displayRange.infinite ? props.displayRange.end : finite ?? props.displayRange.end
      active.end = Math.min(Math.max(time, start + 0.001), max)
    }
    return
  }
  if (active.kind === 'marker') {
    if (Math.abs(time - active.from) > 0.0001) {
      active.moved = true
      active.current = Math.max(0, time)
    }
  }
}

function onWindowPointerUp(event: PointerEvent): void {
  const active = gesture.value
  if (active === null || event.pointerId !== active.pointerId) {
    return
  }
  gesture.value = null
  removeWindowListeners()
  if (active.kind === 'preview') {
    const range = active.current
    if (range === null || range.end - range.start < 0.1) {
      emit('preview', active.base)
      return
    }
    emit('preview', { start: range.start, end: range.end })
    return
  }
  if (active.kind === 'loop') {
    emit('loopChange', active.start, active.end)
    return
  }
  if (active.kind === 'marker') {
    if (active.moved) {
      emit('markerMove', active.from, active.current)
    } else {
      emit('seek', active.from)
    }
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return
  }
  const active = gesture.value
  if (active === null) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (active.kind === 'preview') {
    emit('preview', active.base)
  }
  gesture.value = null
  removeWindowListeners()
}

onBeforeUnmount(() => {
  removeWindowListeners()
  gesture.value = null
})

function beginLoopDrag(event: PointerEvent, edge: 'start' | 'end'): void {
  if (props.disabled === true) {
    return
  }
  if (event.button !== 0) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  beginGesture({
    kind: 'loop',
    pointerId: event.pointerId,
    edge,
    start: props.loopStart,
    end: props.loopEnd,
  })
}

function beginMarkerDrag(event: PointerEvent, time: number): void {
  if (props.disabled === true) {
    return
  }
  if (event.button !== 0) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  beginGesture({
    kind: 'marker',
    pointerId: event.pointerId,
    from: time,
    current: time,
    moved: false,
  })
}

function onMarkerKeydown(event: KeyboardEvent, time: number): void {
  event.stopPropagation()
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('seek', time)
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    emit('markerRemove', time)
  }
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  emit('contextMenu', event, timeAtEvent(event))
}

function onMarkerContextMenu(event: MouseEvent, time: number): void {
  event.preventDefault()
  event.stopPropagation()
  emit('markerContextMenu', event, time)
}

function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 1 : 0.5
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    emit('seek', Math.max(0, props.playhead - step))
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    emit('seek', clampTime(props.playhead + step))
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    emit('seek', 0)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    emit('seek', clampTime(props.displayRange.end))
  }
}

/** 供模板判断是否正在拖动（避免把手柄误当点击）。 */
const loopDragging = computed(() => gesture.value?.kind === 'loop')
const markerDragging = computed(() => gesture.value?.kind === 'marker')
</script>

<template>
  <div
    ref="rootEl"
    class="timeline-ruler"
    :class="{ 'timeline-ruler--compact': compact, 'timeline-ruler--disabled': disabled === true }"
    :style="{ width: `${width}px` }"
    role="group"
    tabindex="0"
    aria-label="时间标尺"
    @pointerdown="onPointerDown"
    @contextmenu="onContextMenu"
    @keydown="onKeydown"
  >
    <div v-if="infiniteBand !== null" class="timeline-ruler__infinite" :style="{ left: `${infiniteBand.left}px`, width: `${infiniteBand.width}px` }" aria-hidden="true"></div>
    <div v-if="loopBand !== null" class="timeline-ruler__loop" :style="{ left: `${loopBand.left}px`, width: `${loopBand.width}px` }" aria-hidden="true"></div>
    <div v-if="livePreviewBand !== null" class="timeline-ruler__preview" :style="{ left: `${livePreviewBand.left}px`, width: `${livePreviewBand.width}px` }" aria-hidden="true"></div>
    <div
      v-for="tick in ticks"
      :key="`tick-${tick.time}`"
      class="timeline-ruler__tick"
      :class="{ 'timeline-ruler__tick--major': tick.major }"
      :style="{ left: `${tick.x}px` }"
      aria-hidden="true"
    >
      <span v-if="tick.major && tick.label.length > 0" class="timeline-ruler__label">{{ tick.label }}</span>
    </div>
    <button
      v-for="marker in markerItems"
      :key="`marker-${marker.origin}`"
      type="button"
      class="timeline-ruler__marker"
      :class="{ 'timeline-ruler__marker--dragging': markerDragging }"
      :style="{ left: `${marker.x}px` }"
      :aria-label="`标记 ${formatSeconds(marker.time)} 秒`"
      :title="`标记 ${formatSeconds(marker.time)}s（拖动改位置，右键删除）`"
      @pointerdown="beginMarkerDrag($event, marker.origin)"
      @contextmenu="onMarkerContextMenu($event, marker.time)"
      @keydown="onMarkerKeydown($event, marker.time)"
    ></button>
    <button
      v-if="loopStart !== null || loopGhostX('start') !== null"
      type="button"
      class="timeline-ruler__loop-handle timeline-ruler__loop-handle--start"
      :class="{ 'timeline-ruler__loop-handle--dragging': loopDragging }"
      :style="{ left: `${loopGhostX('start') ?? xOf(loopStart ?? 0)}px` }"
      aria-label="循环入点"
      title="拖动设置循环入点（A）"
      @pointerdown="beginLoopDrag($event, 'start')"
    ></button>
    <button
      v-if="loopEnd !== null || loopGhostX('end') !== null"
      type="button"
      class="timeline-ruler__loop-handle timeline-ruler__loop-handle--end"
      :class="{ 'timeline-ruler__loop-handle--dragging': loopDragging }"
      :style="{ left: `${loopGhostX('end') ?? xOf(loopEnd ?? 0)}px` }"
      aria-label="循环出点"
      title="拖动设置循环出点（B）"
      @pointerdown="beginLoopDrag($event, 'end')"
    ></button>
    <div class="timeline-ruler__playhead" :style="{ left: `${playheadX}px` }" aria-hidden="true">
      <span class="timeline-ruler__bubble">{{ playheadLabel }}</span>
    </div>
    <span class="sr-only">{{ `标尺间隔 ${interval} 秒` }}</span>
  </div>
</template>

<style scoped>
.timeline-ruler {
  position: relative;
  flex: 1 1 auto;
  height: 30px;
  min-width: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 10px;
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
}

.timeline-ruler--compact {
  height: 24px;
}

.timeline-ruler--disabled {
  cursor: default;
}

.timeline-ruler:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.timeline-ruler__infinite {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  opacity: 0.35;
  background-image: repeating-linear-gradient(
    45deg,
    var(--border-strong) 0,
    var(--border-strong) 2px,
    transparent 2px,
    transparent 8px
  );
}

.timeline-ruler__loop {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  background: var(--bg-selected);
  opacity: 0.55;
}

.timeline-ruler__preview {
  position: absolute;
  top: 1px;
  bottom: 1px;
  pointer-events: none;
  border-top: 1px dashed var(--accent);
  border-bottom: 1px dashed var(--accent);
  background: var(--bg-hover);
  opacity: 0.6;
}

.timeline-ruler__tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 6px;
  pointer-events: none;
  background: var(--border-strong);
}

.timeline-ruler__tick--major {
  height: 10px;
  background: var(--text-muted);
}

.timeline-ruler__label {
  position: absolute;
  bottom: 10px;
  left: 2px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
}

.timeline-ruler__marker {
  position: absolute;
  top: 2px;
  width: 9px;
  height: 9px;
  padding: 0;
  border: 1px solid var(--warning);
  background: var(--warning);
  transform: translateX(-50%) rotate(45deg);
  cursor: grab;
}

.timeline-ruler__marker--dragging {
  cursor: grabbing;
}

.timeline-ruler__marker:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.timeline-ruler__loop-handle {
  position: absolute;
  bottom: 0;
  width: 12px;
  height: 9px;
  padding: 0;
  border: 0;
  background: var(--accent);
  clip-path: polygon(0 100%, 100% 100%, 50% 0);
  cursor: ew-resize;
  transform: translateX(-50%);
}

.timeline-ruler__loop-handle--end {
  background: var(--warning);
}

.timeline-ruler__loop-handle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.timeline-ruler__playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  pointer-events: none;
  background: var(--accent);
}

.timeline-ruler__bubble {
  position: absolute;
  top: 1px;
  left: 3px;
  padding: 0 3px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 10px;
  line-height: 13px;
  white-space: nowrap;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
