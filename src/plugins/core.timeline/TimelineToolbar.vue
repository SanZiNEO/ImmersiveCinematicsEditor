<script setup lang="ts">
/**
 * 主轴工具栏（05-10）：工具 / 新建片段 / 新建轨道 / 缩放 / 适配 / 吸附 /
 * 播放头输入 / 标记 / 选择信息 / transport。
 *
 * 窄于 480px 时只留图标（title + aria-label 仍完整）；按钮 disabled 必带原因。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TrackTypeOption } from './model.ts'
import { formatSeconds } from './model.ts'
import type { TimelineTool } from './state.ts'

const props = defineProps<{
  pps: number
  tool: TimelineTool
  snapEnabled: boolean
  playhead: number
  selectionText: string
  hasTracks: boolean
  hasClips: boolean
  hasSelection: boolean
  hasMarkers: boolean
  canAddClip: boolean
  addClipReason?: string
  canPaste: boolean
  pasteReason?: string
  compact: boolean
  narrow: boolean
  trackOptions: readonly TrackTypeOption[]
  addTrackOpen: boolean
  hiddenTracks: readonly { trackId: string; label: string }[]
  canTransport: boolean
  transportReason?: string
  playing: boolean
}>()

const emit = defineEmits<{
  'update:tool': [tool: TimelineTool]
  'update:addTrackOpen': [open: boolean]
  addClip: []
  addTrack: [type: string]
  showTrack: [trackId: string]
  zoomIn: []
  zoomOut: []
  fit: []
  seek: [time: number]
  addMarker: []
  clearMarkers: []
  play: []
  pause: []
  stop: []
  toggleSnap: []
  paste: []
}>()

const addTrackRoot = ref<HTMLElement | null>(null)
const hiddenRoot = ref<HTMLElement | null>(null)
const hiddenOpen = ref(false)
const addTrackPosition = ref<Record<string, string>>({})
const hiddenPosition = ref<Record<string, string>>({})
const timeText = ref(formatSeconds(props.playhead))
const editingTime = ref(false)

const ppsText = computed(() => `${Math.round(props.pps)} px/s`)
const addTrackTitle = computed(() => (props.addTrackOpen ? '收起轨道类型' : '添加轨道'))
const addClipTitle = computed(() => props.addClipReason ?? '新建片段（5 秒）')
const pasteTitle = computed(() => props.pasteReason ?? '粘贴片段到播放头')
const transportTitle = computed(() => props.transportReason ?? (props.playing ? '暂停' : '播放'))

watch(
  () => props.playhead,
  (value) => {
    if (!editingTime.value) {
      timeText.value = formatSeconds(value)
    }
  },
)

function commitTime(): void {
  const value = Number(timeText.value)
  if (!Number.isFinite(value)) {
    timeText.value = formatSeconds(props.playhead)
    return
  }
  emit('seek', Math.max(0, value))
}

function onTimeFocus(): void {
  editingTime.value = true
}

function onTimeBlur(): void {
  editingTime.value = false
  commitTime()
}

function onTimeKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    commitTime()
    editingTime.value = false
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    timeText.value = formatSeconds(props.playhead)
    editingTime.value = false
    ;(event.currentTarget as HTMLInputElement).blur()
  }
}

function onTimeInput(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    timeText.value = target.value
  }
}

/** 工具栏内部是横向滚动容器；弹出菜单用 fixed，避免被裁切。 */
function positionOf(root: HTMLElement | null): Record<string, string> {
  if (root === null) {
    return {}
  }
  const rect = root.getBoundingClientRect()
  return {
    left: `${Math.max(4, Math.min(rect.left, window.innerWidth - 236))}px`,
    top: `${rect.bottom + 2}px`,
  }
}

function toggleAddTrack(): void {
  const next = !props.addTrackOpen
  if (next) {
    addTrackPosition.value = positionOf(addTrackRoot.value)
    hiddenOpen.value = false
  }
  emit('update:addTrackOpen', next)
}

watch(
  () => props.addTrackOpen,
  (open) => {
    if (open) {
      void nextTick(() => {
        addTrackPosition.value = positionOf(addTrackRoot.value)
      })
    }
  },
)

function chooseTrack(type: string): void {
  emit('addTrack', type)
  emit('update:addTrackOpen', false)
}

function toggleHidden(): void {
  hiddenOpen.value = !hiddenOpen.value
  if (hiddenOpen.value) {
    hiddenPosition.value = positionOf(hiddenRoot.value)
    emit('update:addTrackOpen', false)
  }
}

function showHiddenTrack(trackId: string): void {
  emit('showTrack', trackId)
  hiddenOpen.value = false
}

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) {
    return
  }
  if (props.addTrackOpen && addTrackRoot.value !== null && !addTrackRoot.value.contains(target)) {
    emit('update:addTrackOpen', false)
  }
  if (hiddenOpen.value && hiddenRoot.value !== null && !hiddenRoot.value.contains(target)) {
    hiddenOpen.value = false
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return
  }
  if (props.addTrackOpen) {
    emit('update:addTrackOpen', false)
  }
  if (hiddenOpen.value) {
    hiddenOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('keydown', onWindowKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('keydown', onWindowKeydown, true)
})
</script>

<template>
  <div class="timeline-toolbar" :class="{ 'timeline-toolbar--compact': compact, 'timeline-toolbar--narrow': narrow }" role="toolbar" aria-label="时间轴工具栏">
    <div class="timeline-toolbar__group" role="group" aria-label="编辑工具">
      <button
        type="button"
        class="timeline-toolbar__button"
        :class="{ 'timeline-toolbar__button--on': tool === 'select' }"
        :aria-pressed="tool === 'select'"
        aria-label="选择工具"
        title="选择工具（拖动 / 裁切）"
        @click="emit('update:tool', 'select')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 2l9 6-4 .8L6.5 13Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        class="timeline-toolbar__button"
        :class="{ 'timeline-toolbar__button--on': tool === 'blade' }"
        :aria-pressed="tool === 'blade'"
        aria-label="刀片工具"
        title="刀片工具（B；Esc 回到选择）"
        @click="emit('update:tool', 'blade')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 12.5L11.5 4M9.5 12.5h4" fill="none" stroke="currentColor" stroke-width="1.5" />
          <circle cx="11.5" cy="4" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>

    <div class="timeline-toolbar__group" role="group" aria-label="创建">
      <button
        type="button"
        class="timeline-toolbar__button"
        :disabled="!canAddClip"
        :aria-label="'新建片段'"
        :title="addClipTitle"
        @click="emit('addClip')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2.5" y="4.5" width="11" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M8 6.5v3M6.5 8h3" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span v-if="!narrow" class="timeline-toolbar__label">片段</span>
      </button>
      <div ref="addTrackRoot" class="timeline-toolbar__popover">
        <button
          type="button"
          class="timeline-toolbar__button"
          :aria-expanded="addTrackOpen"
          aria-haspopup="menu"
          aria-label="添加轨道"
          :title="addTrackTitle"
          @click="toggleAddTrack"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" fill="none" stroke="currentColor" stroke-width="1.2" />
            <path d="M12 9.5v4M10 11.5h4" fill="none" stroke="currentColor" stroke-width="1.4" />
          </svg>
          <span v-if="!narrow" class="timeline-toolbar__label">轨道</span>
        </button>
        <ul v-if="addTrackOpen" class="timeline-toolbar__menu" :style="addTrackPosition" role="menu" aria-label="轨道类型">
          <li v-for="option in trackOptions" :key="option.type">
            <button
              type="button"
              class="timeline-toolbar__menu-item"
              role="menuitem"
              :disabled="option.disabled"
              :title="option.reason"
              @click="!option.disabled && chooseTrack(option.type)"
            >
              <span class="timeline-toolbar__menu-label">{{ option.label }}</span>
              <span class="timeline-toolbar__menu-code">{{ option.type }}</span>
              <span v-if="option.disabled && option.reason !== undefined" class="timeline-toolbar__menu-reason">{{ option.reason }}</span>
            </button>
          </li>
        </ul>
      </div>
      <button
        type="button"
        class="timeline-toolbar__button"
        :disabled="!canPaste"
        aria-label="粘贴片段"
        :title="pasteTitle"
        @click="emit('paste')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="4" y="3" width="8" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M6 2.5h4v2H6Z" fill="currentColor" />
        </svg>
      </button>
    </div>

    <div class="timeline-toolbar__group" role="group" aria-label="缩放">
      <button type="button" class="timeline-toolbar__button" aria-label="缩小时间轴" title="缩小（1.25 倍步进）" @click="emit('zoomOut')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.6" fill="none" /></svg>
      </button>
      <button type="button" class="timeline-toolbar__button" aria-label="放大时间轴" title="放大（1.25 倍步进）" @click="emit('zoomIn')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8h8M8 4v8" stroke="currentColor" stroke-width="1.6" fill="none" /></svg>
      </button>
      <button type="button" class="timeline-toolbar__button" aria-label="适配时间轴" title="适配已知内容末端" @click="emit('fit')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2.5 5V3.5H5M11 3.5h2.5V5M13.5 11v1.5H11M5 12.5H2.5V11" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </button>
      <span v-if="!narrow" class="timeline-toolbar__value" :title="`当前缩放 ${ppsText}`">{{ ppsText }}</span>
    </div>

    <div class="timeline-toolbar__group" role="group" aria-label="吸附与标记">
      <button
        type="button"
        class="timeline-toolbar__button"
        :class="{ 'timeline-toolbar__button--on': snapEnabled }"
        :aria-pressed="snapEnabled"
        aria-label="吸附开关"
        title="吸附（8px；按住 Alt 临时关闭）"
        @click="emit('toggleSnap')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 12V4h4a2 2 0 0 1 0 4H4" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d="M11 3v10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2" />
        </svg>
      </button>
      <button type="button" class="timeline-toolbar__button" aria-label="添加标记" title="在播放头添加标记（会话）" @click="emit('addMarker')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 2v12M4 3h8l-2 2.5L12 8H4" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </button>
      <button
        v-if="hasMarkers"
        type="button"
        class="timeline-toolbar__button"
        aria-label="清除全部标记"
        title="清除全部标记"
        @click="emit('clearMarkers')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>

    <div class="timeline-toolbar__group timeline-toolbar__group--time" role="group" aria-label="播放头">
      <input
        class="timeline-toolbar__time"
        type="number"
        step="0.1"
        min="0"
        :value="timeText"
        :aria-label="'播放头时间（秒）'"
        title="播放头时间（秒）；Enter 跳转"
        @input="onTimeInput"
        @focus="onTimeFocus"
        @blur="onTimeBlur"
        @keydown="onTimeKeydown"
      />
      <span class="timeline-toolbar__unit" aria-hidden="true">s</span>
    </div>

    <div class="timeline-toolbar__group" role="group" aria-label="播放控制">
      <button
        type="button"
        class="timeline-toolbar__button"
        :disabled="!canTransport || playing"
        aria-label="播放"
        :title="transportTitle"
        @click="emit('play')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5l9 5.5-9 5.5Z" fill="currentColor" /></svg>
      </button>
      <button
        type="button"
        class="timeline-toolbar__button"
        :disabled="!canTransport || !playing"
        aria-label="暂停"
        title="暂停"
        @click="emit('pause')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4.5 3h2.5v10H4.5ZM9 3h2.5v10H9Z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" class="timeline-toolbar__button" :disabled="!canTransport" aria-label="停止" title="停止" @click="emit('stop')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="4" y="4" width="8" height="8" fill="currentColor" /></svg>
      </button>
    </div>

    <div class="timeline-toolbar__spacer"></div>

    <span class="timeline-toolbar__selection" :title="selectionText">{{ selectionText }}</span>

    <div v-if="!hasTracks" class="timeline-toolbar__group" role="group" aria-label="空态">
      <span class="timeline-toolbar__hint">还没有轨道</span>
      <button type="button" class="timeline-toolbar__button timeline-toolbar__button--text" @click="emit('update:addTrackOpen', true)">
        添加轨道
      </button>
    </div>
    <div v-else-if="!hasClips" class="timeline-toolbar__group" role="group" aria-label="空态">
      <span v-if="!narrow" class="timeline-toolbar__hint">空轨道</span>
      <button
        type="button"
        class="timeline-toolbar__button timeline-toolbar__button--text"
        :disabled="!canAddClip"
        :title="addClipTitle"
        @click="emit('addClip')"
      >
        添加片段
      </button>
      <button
        type="button"
        class="timeline-toolbar__button timeline-toolbar__button--text"
        :disabled="!canPaste"
        :title="pasteTitle"
        @click="emit('paste')"
      >
        粘贴片段
      </button>
    </div>

    <div v-if="hiddenTracks.length > 0" ref="hiddenRoot" class="timeline-toolbar__popover">
      <button
        type="button"
        class="timeline-toolbar__button"
        :aria-expanded="hiddenOpen"
        aria-haspopup="menu"
        :aria-label="`显示隐藏轨道（${hiddenTracks.length}）`"
        :title="`${hiddenTracks.length} 条轨道已隐藏`"
        @click="toggleHidden"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M2 14L14 2" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span v-if="!narrow" class="timeline-toolbar__label">{{ hiddenTracks.length }}</span>
      </button>
      <ul v-if="hiddenOpen" class="timeline-toolbar__menu" :style="hiddenPosition" role="menu" aria-label="隐藏轨道">
        <li v-for="track in hiddenTracks" :key="track.trackId">
          <button type="button" class="timeline-toolbar__menu-item" role="menuitem" @click="showHiddenTrack(track.trackId)">
            <span class="timeline-toolbar__menu-label">{{ track.label }}</span>
            <span class="timeline-toolbar__menu-code">显示</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.timeline-toolbar {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
  min-width: 0;
  height: 34px;
  padding: 0 6px;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  scrollbar-width: none;
}

.timeline-toolbar::-webkit-scrollbar {
  display: none;
}

.timeline-toolbar--compact {
  height: 30px;
}

.timeline-toolbar__group {
  display: flex;
  flex: 0 0 auto;
  gap: 1px;
  align-items: center;
}

.timeline-toolbar__group--time {
  gap: 0;
}

.timeline-toolbar__spacer {
  flex: 1 1 auto;
  min-width: 4px;
}

.timeline-toolbar__button {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.timeline-toolbar__button:hover:not(:disabled) {
  border-color: var(--border);
  color: var(--text);
}

.timeline-toolbar__button--on {
  border-color: var(--accent);
  color: var(--accent);
}

.timeline-toolbar__button:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.6;
}

.timeline-toolbar__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.timeline-toolbar__button--text {
  padding: 0 6px;
}

.timeline-toolbar__label {
  font-size: 11px;
}

.timeline-toolbar__value {
  padding: 0 3px;
  color: var(--text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.timeline-toolbar__time {
  width: 58px;
  height: 22px;
  padding: 0 3px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.timeline-toolbar__time:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

.timeline-toolbar__unit {
  padding: 0 4px 0 2px;
  color: var(--text-muted);
  font-size: 10px;
}

.timeline-toolbar__selection {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-toolbar__hint {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.timeline-toolbar__popover {
  position: relative;
  flex: 0 0 auto;
}

.timeline-toolbar__menu {
  position: fixed;
  z-index: 70;
  min-width: 220px;
  max-height: 280px;
  margin: 0;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  box-shadow: 0 6px 20px var(--shadow);
  list-style: none;
}

.timeline-toolbar__menu-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.timeline-toolbar__menu-item:hover:not(:disabled) {
  background: var(--bg-selected);
}

.timeline-toolbar__menu-item:disabled {
  color: var(--text-muted);
  cursor: default;
}

.timeline-toolbar__menu-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-toolbar__menu-code {
  color: var(--text-muted);
  font-size: 10px;
}

.timeline-toolbar__menu-reason {
  grid-column: 1 / 3;
  color: var(--text-muted);
  font-size: 10px;
}

.timeline-toolbar--narrow .timeline-toolbar__selection {
  display: none;
}
</style>
