<script setup lang="ts">
/**
 * 脚本节点卡片（05-03）。
 *
 * 只读摘要：名称 / 路径 / 时长 / 前置数 / 依赖方数 / 触发器数；交互全部通过
 * 事件交给画布（选择、打开、方向键漫游、右键菜单）。卡片内不放按钮和输入框。
 */
import { computed, ref } from 'vue'
import { NODE_H, NODE_W, type LaidOutNode } from '../../core/graph/layout.ts'
import { durationLabel } from './labels.ts'
import { useGraphController } from './state.ts'

const props = defineProps<{
  node: LaidOutNode
  selected: boolean
  up: boolean
  down: boolean
  dim: boolean
  compact: boolean
  hovered: boolean
  tabIndex: number
}>()

const emit = defineEmits<{
  activate: [path: string]
  toggle: [path: string]
  menu: [path: string]
  move: [path: string, direction: 'left' | 'right' | 'up' | 'down' | 'first' | 'last']
  clear: []
}>()

const controller = useGraphController()
const rootEl = ref<HTMLElement | null>(null)

const degree = computed(() => controller.degrees.value.get(props.node.path) ?? { requirements: 0, dependents: 0 })
const duration = computed(() => durationLabel(props.node))
const triggerCount = computed(() => props.node.triggers.length)
const displayName = computed(() =>
  props.node.name !== ''
    ? props.node.name
    : props.node.scriptId ?? props.node.path.slice(props.node.path.lastIndexOf('/') + 1))

const badge = computed<{ text: string; className: string; title: string } | null>(() => {
  if (!props.node.valid) {
    return { text: '!', className: 'node-badge--invalid', title: props.node.error ?? '脚本无效' }
  }
  // 不标「环 / 孤」这类结构标注（用户要求先做基础）。
  return null
})

const classes = computed(() => ({
  'node-card--selected': props.selected,
  'node-card--up': props.up,
  'node-card--down': props.down,
  'node-card--dim': props.dim,
  'node-card--invalid': !props.node.valid,
  'node-card--isolated': props.node.isolated,
  'node-card--hovered': props.hovered,
  'node-card--compact': props.compact,
}))

const ariaLabel = computed(() =>
  `脚本 ${displayName.value}，${props.node.path}，${triggerCount.value} 个触发器，${degree.value.requirements} 条前置`)

const title = computed(() => {
  const parts = [displayName.value, props.node.path]
  if (props.node.scriptId !== null && props.node.scriptId !== undefined) {
    parts.push(`id=${props.node.scriptId}`)
  }
  if (!props.node.valid && props.node.error !== undefined) {
    parts.push(`问题：${props.node.error}`)
  }
  return parts.join('\n')
})

function focus(): void {
  rootEl.value?.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }
  // Alt/Ctrl/Meta 组合留给页面级图快捷键（Alt+←/→、Mod+0 等）。
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return
  }
  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      // 图内不删脚本、不导航退栈。
      event.preventDefault()
      return
    case ' ':
      event.preventDefault()
      emit('toggle', props.node.path)
      return
    case 'Enter':
      event.preventDefault()
      emit('activate', props.node.path)
      return
    case 'F10':
      if (event.shiftKey) {
        event.preventDefault()
        emit('menu', props.node.path)
      }
      return
    case 'ArrowLeft':
      event.preventDefault()
      emit('move', props.node.path, 'left')
      return
    case 'ArrowRight':
      event.preventDefault()
      emit('move', props.node.path, 'right')
      return
    case 'ArrowUp':
      event.preventDefault()
      emit('move', props.node.path, 'up')
      return
    case 'ArrowDown':
      event.preventDefault()
      emit('move', props.node.path, 'down')
      return
    case 'Home':
      event.preventDefault()
      emit('move', props.node.path, 'first')
      return
    case 'End':
      event.preventDefault()
      emit('move', props.node.path, 'last')
      return
    case 'Escape':
      event.preventDefault()
      emit('clear')
      return
    default:
      return
  }
}

function onFocus(): void {
  controller.setRovingPath(props.node.path)
  if (rootEl.value?.matches(':focus-visible') === true) {
    controller.hoverNow(props.node.path)
    return
  }
  controller.hoverIntent(props.node.path)
}

function onBlur(): void {
  controller.hoverLeave()
}

function onPointerEnter(): void {
  if (controller.state.gestureActive) {
    return
  }
  controller.hoverIntent(props.node.path)
}

function onPointerLeave(): void {
  controller.hoverLeave()
}

defineExpose({ focus })
</script>

<template>
  <article
    ref="rootEl"
    class="node-card"
    :class="classes"
    :style="{ left: `${node.x - NODE_W / 2}px`, top: `${node.y - NODE_H / 2}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }"
    :data-graph-node="node.path"
    :tabindex="tabIndex"
    role="button"
    :aria-pressed="selected"
    :aria-label="ariaLabel"
    :aria-describedby="hovered ? 'script-graph-hover-card' : undefined"
    :title="title"
    @keydown="onKeydown"
    @focus="onFocus"
    @blur="onBlur"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
  >
    <header class="node-card__head">
      <span class="node-card__name">{{ displayName }}</span>
      <span
        v-if="badge !== null"
        class="node-badge"
        :class="badge.className"
        :title="badge.title"
        :aria-label="badge.title"
      >{{ badge.text }}</span>
    </header>
    <p class="node-card__path" :title="node.path">{{ node.path }}</p>
    <p class="node-card__meta">
      <span class="node-card__duration">{{ duration }}</span>
      <span title="前置数量">前置 {{ degree.requirements }}</span>
      <span title="依赖方数量">依赖 {{ degree.dependents }}</span>
      <span title="触发器数量">触发 {{ triggerCount }}</span>
    </p>
  </article>
</template>

<style scoped>
.node-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid var(--border-strong);
  border-left-width: 3px;
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: grab;
  user-select: none;
  overflow: hidden;
  contain: layout paint;
}
.node-card:active { cursor: grabbing; }
.node-card:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.node-card--selected {
  border-color: var(--selection-outline);
  box-shadow: 0 0 0 2px var(--selection-outline);
}
.node-card--up { border-color: var(--c1); }
.node-card--down { border-color: var(--c2); }
.node-card--dim { opacity: 0.35; }
.node-card--invalid { border-left-color: var(--error); }
.node-card--isolated { opacity: 0.72; }
.node-card--hovered { background: var(--bg-raised); }
.node-card--dim.node-card--hovered { opacity: 0.6; }
.node-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.node-card__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-badge {
  flex: 0 0 auto;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
.node-badge--invalid { color: var(--error); border: 1px solid var(--error); }
.node-badge--isolated { color: var(--text-muted); border: 1px solid var(--border-strong); }
.node-card__path {
  margin: 0;
  color: var(--text-muted);
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-card__meta {
  display: flex;
  gap: 7px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
}
.node-card__duration { color: var(--text); }
.node-card--compact .node-card__path,
.node-card--compact .node-card__meta { display: none; }
.node-card--compact { justify-content: center; }
</style>
