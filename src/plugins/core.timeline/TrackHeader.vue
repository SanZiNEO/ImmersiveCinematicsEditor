<script setup lang="ts">
/**
 * 轨道头（05-10）：固定左侧，横向滚动不动、纵向与轨道行同步。
 *
 * 三按钮只改会话 `trackView`；重命名走文档命令，空名 / 重名由命令拒绝并显示原因。
 * 键盘：Space 可见、L 锁定、M 静音（阻止事件冒泡，避免触发面板级快捷键）。
 */
import { computed, nextTick, ref } from 'vue'
import type { CommitOutcome, TrackSessionView, TrackViewEntry } from '../../workbench/api/documents.ts'
import { trackLabel } from './model.ts'

const props = defineProps<{
  track: TrackViewEntry
  session: TrackSessionView
  color: string
  compact: boolean
  rowHeight: number
  active: boolean
  canRename: boolean
  readonlyReason?: string
  known?: boolean
  dragging?: boolean
  renameTrack: (name: string) => CommitOutcome
}>()

const emit = defineEmits<{
  activate: []
  toggleVisible: []
  toggleLocked: []
  toggleMuted: []
  addClip: []
  contextMenu: [event: MouseEvent]
  dragStart: [trackId: string]
  dropTrack: [trackId: string]
  dragEnd: []
}>()

const editing = ref(false)
const draft = ref('')
const error = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const displayName = computed(() => {
  const name = props.track.name.trim()
  return name.length > 0 ? name : trackLabel(props.track.type, props.known)
})
const typeText = computed(() => trackLabel(props.track.type, props.known))
const titleText = computed(() => {
  if (!props.canRename) {
    return props.readonlyReason ?? '该轨道名只读'
  }
  return `${typeText.value} · 双击重命名`
})
const style = computed(() => ({ height: `${props.rowHeight}px` }))

function startEdit(): void {
  if (!props.canRename) {
    emit('activate')
    return
  }
  error.value = ''
  draft.value = props.track.name
  editing.value = true
  void nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
}

function cancelEdit(): void {
  editing.value = false
  error.value = ''
}

function commitEdit(): void {
  const next = draft.value.trim()
  if (next.length === 0) {
    error.value = '轨道名不能为空'
    return
  }
  const outcome = props.renameTrack(next)
  if (outcome.ok) {
    editing.value = false
    error.value = ''
    return
  }
  error.value = outcome.error ?? '重命名被拒绝'
}

function onInputKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitEdit()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}

function focusSibling(current: HTMLElement, direction: 1 | -1): void {
  const parent = current.parentElement
  if (parent === null) {
    return
  }
  const headers = Array.from(parent.querySelectorAll<HTMLElement>('[data-track-header]'))
  const index = headers.indexOf(current)
  const next = headers[index + direction]
  next?.focus()
}

/** 轨道头消费 Space / L / M；按钮与输入框自身事件不拦截。 */
function onKeydown(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'BUTTON')) {
    return
  }
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    event.stopPropagation()
    emit('toggleVisible')
    return
  }
  if (event.key === 'l' || event.key === 'L') {
    event.preventDefault()
    event.stopPropagation()
    emit('toggleLocked')
    return
  }
  if (event.key === 'm' || event.key === 'M') {
    event.preventDefault()
    event.stopPropagation()
    emit('toggleMuted')
    return
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    focusSibling(event.currentTarget as HTMLElement, event.key === 'ArrowUp' ? -1 : 1)
  }
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  emit('contextMenu', event)
}

/** 轨道头上下拖动排序；按钮 / 输入框上的拖动不启动。 */
function onDragStart(event: DragEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('button, input') !== null) {
    event.preventDefault()
    return
  }
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', props.track.trackId)
  }
  emit('dragStart', props.track.trackId)
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  emit('dropTrack', props.track.trackId)
}
</script>

<template>
  <div
    class="track-header"
    :class="{
      'track-header--active': active,
      'track-header--locked': session.locked,
      'track-header--compact': compact,
      'track-header--dragging': dragging === true,
    }"
    :style="style"
    :data-track-header="track.trackId"
    :data-track-id="track.trackId"
    draggable="true"
    role="group"
    tabindex="0"
    :aria-label="`${displayName} 轨道头`"
    :title="titleText"
    @click="emit('activate')"
    @dblclick="startEdit"
    @contextmenu="onContextMenu"
    @keydown="onKeydown"
    @dragstart="onDragStart"
    @dragover.prevent
    @drop="onDrop"
    @dragend="emit('dragEnd')"
  >
    <span class="track-header__color" :style="{ background: color }" aria-hidden="true"></span>
    <div class="track-header__info">
      <div class="track-header__name-row">
        <input
          v-if="editing"
          ref="inputEl"
          v-model="draft"
          class="track-header__input"
          type="text"
          maxlength="64"
          :aria-label="`重命名 ${displayName} 轨道`"
          @keydown="onInputKeydown"
          @blur="cancelEdit"
          @click.stop
          @dblclick.stop
        />
        <span v-else class="track-header__name">{{ displayName }}</span>
        <span class="track-header__count" :title="`${track.clips.length} 个片段`">{{ track.clips.length }}</span>
      </div>
      <span class="track-header__type" :class="{ 'track-header__type--error': error.length > 0 }">{{ error.length > 0 ? error : typeText }}</span>
    </div>
    <div class="track-header__actions" @click.stop @dblclick.stop>
      <button
        type="button"
        class="track-header__button"
        :class="{ 'track-header__button--on': session.visible }"
        :aria-pressed="session.visible"
        :aria-label="`${displayName} 可见性`"
        :title="session.visible ? '隐藏轨道' : '显示轨道'"
        @click.stop="emit('toggleVisible')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
          />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        class="track-header__button"
        :class="{ 'track-header__button--on': session.locked }"
        :aria-pressed="session.locked"
        :aria-label="`${displayName} 锁定`"
        :title="session.locked ? '解锁轨道' : '锁定轨道（仍可选中，不可拖动/裁切/删除）'"
        @click.stop="emit('toggleLocked')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </button>
      <button
        type="button"
        class="track-header__button"
        :class="{ 'track-header__button--on': session.muted }"
        :aria-pressed="session.muted"
        :aria-label="`${displayName} 静音`"
        :title="session.muted ? '取消静音' : '静音（只影响预览推送）'"
        @click.stop="emit('toggleMuted')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M2.5 6h2.2L8 3.5v9L4.7 10H2.5Z" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path v-if="!session.muted" d="M10 5.5l3 5M13 5.5l-3 5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path v-else d="M10.5 6.2a3 3 0 0 1 0 3.6" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </button>
      <button
        type="button"
        class="track-header__button track-header__button--add"
        :aria-label="`在 ${displayName} 轨道添加片段`"
        title="在轨道末尾添加 5 秒片段"
        @click.stop="emit('addClip')"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      </button>
    </div>
    <p v-if="error.length > 0" class="sr-only" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.track-header {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
  box-sizing: border-box;
  padding: 4px 6px 4px 0;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: default;
}

.track-header--active {
  background: var(--bg-raised);
}

.track-header--locked {
  color: var(--text-secondary);
}

.track-header--dragging {
  opacity: 0.55;
}

.track-header:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.track-header__color {
  flex: 0 0 auto;
  width: 4px;
  align-self: stretch;
  border-radius: 0 2px 2px 0;
}

.track-header__info {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.track-header__name-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}

.track-header__name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-header__count {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.track-header__type {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-header--compact .track-header__type:not(.track-header__type--error) {
  display: none;
}

.track-header__input {
  min-width: 0;
  width: 100%;
  padding: 1px 4px;
  border: 1px solid var(--focus);
  border-radius: 3px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
}

.track-header__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 1px;
}

.track-header__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.track-header__button:hover {
  border-color: var(--border);
  color: var(--text);
}

.track-header__button--on {
  color: var(--accent);
}

.track-header__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

.track-header__type--error {
  color: var(--error);
}

.track-header--compact {
  gap: 4px;
  padding: 2px 4px 2px 0;
}

.track-header--compact .track-header__name {
  font-size: 11px;
}

.track-header--compact .track-header__button {
  width: 16px;
  height: 16px;
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
