<script setup lang="ts">
/**
 * 片段块（05-10）：固定高度，宽度只由 `duration`（无限片段由显示末端）决定。
 *
 * 不显示对象 / 属性 / 关键帧数量；徽标只表达 warn / loop / infinite / ref。
 */
import { computed } from 'vue'
import type { ClipViewEntry } from '../../workbench/api/documents.ts'
import { formatSeconds } from './model.ts'

const props = defineProps<{
  clip: ClipViewEntry
  trackType: string
  trackName: string
  color: string
  pxPerSecond: number
  displayEnd: number
  width: number
  height: number
  left: number
  zIndex: number
  compact: boolean
  selected: boolean
  primary: boolean
  dragging?: boolean
}>()

const emit = defineEmits<{
  select: [clipKey: string]
}>()

const infinite = computed(() => props.clip.infinite || props.clip.duration < 0)
const label = computed(() => {
  const text = props.clip.label.trim()
  return text.length > 0 ? text : '未命名片段'
})
const showLabel = computed(() => props.width >= 40)
const showTime = computed(() => props.width >= 60)
const timeText = computed(() => {
  const start = formatSeconds(props.clip.start)
  if (infinite.value) {
    return `${start} – ∞`
  }
  return `${start} – ${formatSeconds(props.clip.start + Math.max(0, props.clip.duration))}`
})
const loopBadge = computed(() => {
  if (!props.clip.loop) {
    return ''
  }
  const count = props.clip.loopCount
  return count !== undefined && count > 0 ? `×${count}` : '×∞'
})
const ariaLabel = computed(() => {
  const end = infinite.value ? '∞' : formatSeconds(props.clip.start + Math.max(0, props.clip.duration))
  return `片段 ${label.value}，${formatSeconds(props.clip.start)} 到 ${end}，${props.trackName}`
})
const title = computed(() => {
  const parts = [label.value, timeText.value]
  if (props.clip.loop) {
    parts.push('循环')
  }
  if (infinite.value) {
    parts.push('无限')
  }
  if (props.clip.warn) {
    parts.push('有校验问题')
  }
  if (props.clip.references > 0) {
    parts.push(`被引用 ${props.clip.references} 处`)
  }
  return parts.join(' · ')
})
const style = computed(() => ({
  left: `${props.left}px`,
  width: `${Math.max(24, props.width)}px`,
  height: `${props.height}px`,
  zIndex: String(props.zIndex),
}))

function onSelect(): void {
  emit('select', props.clip.clipKey)
}

/** 方向键在同一轨道行内移动片段焦点。 */
function focusSibling(current: HTMLElement, direction: 1 | -1 | 'first' | 'last'): void {
  const row = current.closest('[data-track-row]')
  if (!(row instanceof HTMLElement)) {
    return
  }
  const blocks = Array.from(row.querySelectorAll<HTMLElement>('[data-clip-key]'))
  const index = blocks.indexOf(current)
  if (index < 0 || blocks.length === 0) {
    return
  }
  let next: HTMLElement | undefined
  if (direction === 'first') {
    next = blocks[0]
  } else if (direction === 'last') {
    next = blocks[blocks.length - 1]
  } else {
    next = blocks[index + direction]
  }
  next?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    onSelect()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    event.stopPropagation()
    focusSibling(event.currentTarget as HTMLElement, -1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    focusSibling(event.currentTarget as HTMLElement, 1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    event.stopPropagation()
    focusSibling(event.currentTarget as HTMLElement, 'first')
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    event.stopPropagation()
    focusSibling(event.currentTarget as HTMLElement, 'last')
  }
}
</script>

<template>
  <div
    class="clip-block"
    :class="{
      'clip-block--selected': selected,
      'clip-block--primary': primary,
      'clip-block--infinite': infinite,
      'clip-block--tiny': width < 40,
      'clip-block--compact': compact,
      'clip-block--dragging': dragging === true,
    }"
    :style="style"
    :data-clip-key="clip.clipKey"
    role="button"
    tabindex="0"
    :aria-label="ariaLabel"
    :aria-pressed="selected"
    :title="title"
    @keydown="onKeydown"
  >
    <span class="clip-block__color" :style="{ background: color }" aria-hidden="true"></span>
    <span v-if="showLabel" class="clip-block__label">{{ label }}</span>
    <span v-if="showTime" class="clip-block__time">{{ timeText }}</span>
    <span class="clip-block__badges" aria-hidden="true">
      <span v-if="clip.warn" class="clip-block__badge clip-block__badge--warn" title="有校验问题">!</span>
      <span v-if="clip.loop" class="clip-block__badge clip-block__badge--loop" title="循环">{{ loopBadge }}</span>
      <span v-if="infinite" class="clip-block__badge clip-block__badge--infinite" title="无限片段">∞</span>
      <span v-if="clip.references > 0" class="clip-block__badge clip-block__badge--ref" title="被脚本引用">⇢</span>
    </span>
    <span class="clip-block__fade" aria-hidden="true"></span>
    <span
      v-if="!infinite"
      class="clip-block__handle clip-block__handle--left"
      aria-hidden="true"
    ></span>
    <span
      v-if="!infinite"
      class="clip-block__handle clip-block__handle--right"
      aria-hidden="true"
    ></span>
  </div>
</template>

<style scoped>
.clip-block {
  position: absolute;
  top: 50%;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 24px;
  padding: 0 6px 0 8px;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  line-height: 1.2;
  cursor: grab;
  user-select: none;
  transform: translateY(-50%);
  touch-action: none;
}

.clip-block--compact {
  gap: 4px;
  padding: 0 4px 0 6px;
  font-size: 10px;
}

.clip-block--selected {
  border-color: var(--selection-outline);
  box-shadow: inset 0 0 0 1px var(--selection-outline);
}

.clip-block--primary {
  box-shadow: inset 3px 0 0 var(--accent), inset 0 0 0 1px var(--selection-outline);
}

.clip-block--dragging {
  opacity: 0.55;
}

.clip-block:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.clip-block__color {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
}

.clip-block__label {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-block__time {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.clip-block__badges {
  display: flex;
  flex: 0 0 auto;
  gap: 3px;
  margin-left: auto;
}

.clip-block__badge {
  padding: 0 3px;
  border-radius: 2px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
}

.clip-block__badge--warn {
  color: var(--warning);
  border: 1px solid var(--warning);
}

.clip-block__badge--loop {
  color: var(--text);
  border: 1px solid var(--border-strong);
}

.clip-block__badge--infinite {
  color: var(--accent);
  border: 1px solid var(--accent);
}

.clip-block__badge--ref {
  color: var(--text-muted);
  border: 1px solid var(--border-strong);
}

.clip-block__label,
.clip-block__time,
.clip-block__badges {
  position: relative;
  z-index: 1;
}

.clip-block__fade {
  display: none;
}

.clip-block--infinite .clip-block__fade {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: block;
  width: 32px;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--bg-raised));
}

.clip-block__handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 80ms linear;
}

.clip-block__handle::after {
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 2px;
  background: var(--focus);
  content: '';
}

.clip-block__handle--left {
  left: 0;
}

.clip-block__handle--left::after {
  left: 1px;
}

.clip-block__handle--right {
  right: 0;
}

.clip-block__handle--right::after {
  right: 1px;
}

.clip-block:hover .clip-block__handle,
.clip-block--selected .clip-block__handle,
.clip-block:focus-visible .clip-block__handle {
  opacity: 1;
}
</style>
