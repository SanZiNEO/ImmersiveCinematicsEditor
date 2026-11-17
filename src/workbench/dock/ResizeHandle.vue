<script setup lang="ts">
/**
 * 分隔线（04-03）：指针 8px 命中（触摸 12px）、视觉 4px；键盘 8px / Shift 24px。
 *
 * 拖动/连续按键只改临时比例，松手或 300ms 合并后提交一次 `resizeSplit`。
 * 不触发面板拖动；不在 window 上挂永久 pointermove/pointerup。
 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LayoutNode, SplitNode, WorkspaceLayoutService } from '../api/layout.ts'
import { LAYOUT_SERVICE, STATUS_SERVICE } from '../api/tokens.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'
import {
  DOCK_PAGE_KEY,
  DOCK_RESIZE_PREVIEW_EVENT,
  type DockResizePreviewDetail,
} from './dockContext.ts'
import { keyboardResize, resizeRatio, type ResizeKey } from './resize.ts'

const props = defineProps<{
  splitId: string
  index: number
  orientation: 'horizontal' | 'vertical'
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const layoutOrNull = services?.get(LAYOUT_SERVICE)
if (!layoutOrNull) throw new Error('ResizeHandle 需要 LAYOUT_SERVICE（ServiceRegistry 未提供）')
// 局部非空别名：setup 顶层的窄化不会保留到函数体内。
const layout: WorkspaceLayoutService = layoutOrNull
const pageIdOfOrNull = inject(DOCK_PAGE_KEY)
if (!pageIdOfOrNull) throw new Error('ResizeHandle 需要 DOCK_PAGE_KEY')
// 同上：函数体内需要非空别名。
const pageIdOf: () => string = pageIdOfOrNull
const status = services?.get(STATUS_SERVICE) ?? null

const rootEl = ref<HTMLElement | null>(null)
const isCoarse = ref(false)

interface DragState {
  pointerId: number
  startX: number
  startY: number
  startSizes: number[]
  minSizes: number[] | undefined
  total: number
  preview: number[]
}

let drag: DragState | null = null
let commitTimer: ReturnType<typeof setTimeout> | null = null
const previewSizes = ref<number[] | null>(null)

onMounted(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  isCoarse.value = window.matchMedia('(pointer: coarse)').matches
})

onBeforeUnmount(() => {
  clearCommitTimer()
  drag = null
  previewSizes.value = null
})

function currentSplit(): SplitNode | null {
  return findSplit(layout.getTree(pageIdOf()).root, props.splitId)
}

function measureTotal(): number {
  const parent = rootEl.value?.parentElement
  if (parent) {
    const rect = parent.getBoundingClientRect()
    const size = props.orientation === 'horizontal' ? rect.width : rect.height
    if (size > 0) return size
  }
  const viewport = layout.viewport()
  return props.orientation === 'horizontal' ? viewport.width : viewport.height
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const split = currentSplit()
  if (!split) return
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget as HTMLElement
  element.focus()
  try {
    element.setPointerCapture(event.pointerId)
  } catch {
    // 捕获失败（例如指针已释放）时仍可用冒泡事件；不阻断手势。
  }
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startSizes: [...split.sizes],
    minSizes: split.minSizes === undefined ? undefined : [...split.minSizes],
    total: measureTotal(),
    preview: [...split.sizes],
  }
  previewSizes.value = [...split.sizes]
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return
  const deltaPx =
    props.orientation === 'horizontal'
      ? event.clientX - drag.startX
      : event.clientY - drag.startY
  const next = resizeRatio(
    drag.startSizes,
    props.index,
    deltaPx / drag.total,
    drag.minSizes,
    drag.total,
  )
  drag.preview = next
  previewSizes.value = next
  emitPreview(next)
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return
  const next = drag.preview
  drag = null
  releaseCapture(event)
  commit(next)
}

function onPointerCancel(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag = null
  releaseCapture(event)
  cancelPreview()
}

function onLostPointerCapture(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag = null
  cancelPreview()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelPreview()
    return
  }

  const split = currentSplit()
  if (!split) return

  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    event.stopPropagation()
    const base = previewSizes.value ?? [...split.sizes]
    const total = measureTotal()
    const next = resizeRatio(
      base,
      props.index,
      event.key === 'Home' ? -1 : 1,
      split.minSizes,
      total,
    )
    previewSizes.value = next
    emitPreview(next)
    scheduleCommit()
    return
  }

  const direction = directionForKey(event.key)
  if (direction === null) return

  event.preventDefault()
  event.stopPropagation()
  const base = previewSizes.value ?? [...split.sizes]
  const total = measureTotal()
  const next = keyboardResize(base, props.index, direction, event.shiftKey, total)
  previewSizes.value = next
  emitPreview(next)
  scheduleCommit()
}

function onBlur(): void {
  cancelPreview()
}

function directionForKey(key: string): ResizeKey | null {
  if (props.orientation === 'horizontal') {
    if (key === 'ArrowLeft') return 'left'
    if (key === 'ArrowRight') return 'right'
    return null
  }
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowDown') return 'down'
  return null
}

function commit(next: readonly number[] | null): void {
  clearCommitTimer()
  previewSizes.value = null
  if (next === null) return
  const split = currentSplit()
  if (!split) return
  const ratio = next[props.index]
  if (!Number.isFinite(ratio)) return
  const previous = split.sizes[props.index]
  if (Number.isFinite(previous) && Math.abs(ratio - previous) < 1e-6) return
  try {
    layout.resizeSplit(pageIdOf(), props.splitId, props.index, ratio)
  } catch (error) {
    status?.notify(error instanceof Error ? error.message : String(error), 'error')
  }
}

function scheduleCommit(): void {
  clearCommitTimer()
  commitTimer = setTimeout(() => {
    commitTimer = null
    commit(previewSizes.value)
  }, 300)
}

function cancelPreview(): void {
  clearCommitTimer()
  previewSizes.value = null
  const split = currentSplit()
  if (split) emitPreview([...split.sizes])
}

function clearCommitTimer(): void {
  if (commitTimer === null) return
  clearTimeout(commitTimer)
  commitTimer = null
}

function releaseCapture(event: PointerEvent): void {
  const element = event.currentTarget as HTMLElement | null
  try {
    element?.releasePointerCapture(event.pointerId)
  } catch {
    // 已释放/元素卸载时浏览器会自己清理。
  }
}

function emitPreview(sizes: readonly number[]): void {
  const element = rootEl.value
  if (!element) return
  element.dispatchEvent(
    new CustomEvent<DockResizePreviewDetail>(DOCK_RESIZE_PREVIEW_EVENT, {
      bubbles: true,
      detail: { splitId: props.splitId, sizes: [...sizes] },
    }),
  )
}

function findSplit(node: LayoutNode, splitId: string): SplitNode | null {
  if (node.type === 'group') return null
  if (node.id === splitId) return node
  for (const child of node.children) {
    const found = findSplit(child, splitId)
    if (found !== null) return found
  }
  return null
}
</script>

<template>
  <div
    ref="rootEl"
    class="dock-resize"
    :class="[`is-${orientation}`, { 'is-coarse': isCoarse }]"
    role="separator"
    :aria-orientation="orientation"
    :aria-label="orientation === 'horizontal' ? '调整左右面板大小' : '调整上下面板大小'"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onLostPointerCapture"
    @keydown="onKeydown"
    @blur="onBlur"
  />
</template>

<style scoped>
.dock-resize {
  position: relative;
  z-index: 2;
  flex: 0 0 4px;
  align-self: stretch;
  background: var(--border);
  touch-action: none;
}

.dock-resize.is-horizontal {
  width: 4px;
  cursor: col-resize;
}

.dock-resize.is-vertical {
  height: 4px;
  cursor: row-resize;
}

.dock-resize::before {
  content: '';
  position: absolute;
  inset: -2px;
}

.dock-resize.is-coarse::before {
  inset: -4px;
}

.dock-resize:hover,
.dock-resize:focus-visible {
  background: var(--accent);
  outline: 1px solid var(--focus);
  outline-offset: 0;
}
</style>
