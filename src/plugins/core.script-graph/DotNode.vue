<script setup lang="ts">
/**
 * 圆点模式节点（与 `NodeCard` 同一套交互契约）。
 *
 * 外层 32×32 命中框（`node.w/h` = DOT_HIT）按圆心 `node.x/y` 定位；内部圆点半径
 * `node.r`（DOT_RADIUS），标签在圆点下方居中。键盘/悬停/选择语义与卡片一致，
 * 事件全部交给画布，组件内不放按钮。
 */
import { computed, ref } from 'vue'
import type { LaidOutNode } from '../../core/graph/layout.ts'
import { useGraphController } from './state.ts'

const props = defineProps<{
  node: LaidOutNode
  selected: boolean
  up: boolean
  down: boolean
  dim: boolean
  hovered: boolean
  /** 缩放较小时只给关键节点留标签；false = 只留圆点。 */
  showLabel: boolean
  /** 是否为力导向锚点节点。 */
  anchor: boolean
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

const displayName = computed(() =>
  props.node.name !== ''
    ? props.node.name
    : props.node.scriptId ?? props.node.path.slice(props.node.path.lastIndexOf('/') + 1))

const badge = computed<string | null>(() => {
  // 只标真实的坏文件；不标「环 / 孤」这类结构标注（用户要求先做基础）。
  if (!props.node.valid) {
    return '!'
  }
  return null
})

const badgeTitle = computed(() => {
  if (!props.node.valid) {
    return props.node.error ?? '脚本无效'
  }
  return ''
})

const classes = computed(() => ({
  'node-dot--selected': props.selected,
  'node-dot--up': props.up,
  'node-dot--down': props.down,
  'node-dot--dim': props.dim,
  'node-dot--invalid': !props.node.valid,
  'node-dot--cycle': props.node.inCycle,
  'node-dot--isolated': props.node.isolated,
  'node-dot--hovered': props.hovered,
  'node-dot--anchor': props.anchor,
}))

const ariaLabel = computed(() => {
  const degree = controller.degrees.value.get(props.node.path) ?? { requirements: 0, dependents: 0 }
  return `脚本 ${displayName.value}，${props.node.path}，${props.node.triggers.length} 个触发器，${degree.requirements} 条前置`
})

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

/** 命中框左上角（世界坐标；x/y 是圆心）。 */
const style = computed<Record<string, string>>(() => ({
  left: `${props.node.x - props.node.w / 2}px`,
  top: `${props.node.y - props.node.h / 2}px`,
  width: `${props.node.w}px`,
  height: `${props.node.h}px`,
}))

const circleStyle = computed<Record<string, string>>(() => ({
  width: `${props.node.r * 2}px`,
  height: `${props.node.r * 2}px`,
}))

/** 标签挂在圆点下沿。 */
const labelStyle = computed<Record<string, string>>(() => ({
  top: `calc(50% + ${props.node.r + 3}px)`,
}))

function focus(): void {
  rootEl.value?.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }
  // Alt/Ctrl/Meta 组合留给页面级图快捷键。
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
  <div
    ref="rootEl"
    class="node-dot"
    :class="classes"
    :style="style"
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
    <span class="node-dot__circle" :style="circleStyle" aria-hidden="true" />
    <span
      v-if="badge !== null"
      class="node-dot__badge"
      :class="{ 'node-dot__badge--error': !node.valid, 'node-dot__badge--cycle': node.valid && node.inCycle }"
      :title="badgeTitle"
      :aria-label="badgeTitle"
    >{{ badge }}</span>
    <span v-if="showLabel" class="node-dot__label" :style="labelStyle">{{ displayName }}</span>
  </div>
</template>

<style scoped>
.node-dot {
  position: absolute;
  display: grid;
  place-items: center;
  cursor: grab;
  user-select: none;
  outline: none;
}
.node-dot:active { cursor: grabbing; }
.node-dot:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 50%;
}
.node-dot__circle {
  display: block;
  border: 1.5px solid var(--bg-app);
  border-radius: 50%;
  background: var(--text);
  box-shadow: 0 1px 3px var(--shadow);
  pointer-events: none;
}
.node-dot--selected .node-dot__circle {
  border-color: var(--selection-outline);
  background: var(--bg-raised);
  box-shadow: 0 0 0 2px var(--selection-outline);
}
.node-dot--up .node-dot__circle { border-color: var(--c1); }
.node-dot--down .node-dot__circle { border-color: var(--c2); }
.node-dot--dim { opacity: 0.35; }
.node-dot--invalid .node-dot__circle { border-color: var(--error); }
.node-dot--cycle .node-dot__circle { border-style: dashed; border-color: var(--warning); }
.node-dot--isolated { opacity: 0.72; }
.node-dot--hovered .node-dot__circle { background: var(--bg-hover); }
.node-dot--dim.node-dot--hovered { opacity: 0.6; }
.node-dot--anchor .node-dot__circle { background: var(--bg-raised); }
.node-dot__badge {
  position: absolute;
  /* 挂在命中框右上角外侧，避免压住圆点本体。 */
  right: -6px;
  top: -6px;
  min-width: 13px;
  height: 13px;
  padding: 0 2px;
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 9.5px;
  line-height: 13px;
  text-align: center;
  pointer-events: none;
}
.node-dot__badge--error { color: var(--error); border: 1px solid var(--error); }
.node-dot__badge--cycle { color: var(--warning); border: 1px solid var(--warning); }
.node-dot__label {
  position: absolute;
  left: 50%;
  max-width: 180px;
  padding: 0 2px;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  pointer-events: none;
  /* 照原型：文字描白边，压在网格上也清晰。 */
  paint-order: stroke;
  -webkit-text-stroke: 3px var(--bg-app);
  text-shadow: 0 0 2px var(--bg-app);
}
.node-dot--selected .node-dot__label { color: var(--text); font-weight: 700; }
.node-dot--up .node-dot__label { color: var(--c1); }
.node-dot--down .node-dot__label { color: var(--c2); }
.node-dot--anchor .node-dot__label { font-size: 11.5px; font-weight: 800; color: var(--accent); }
</style>
