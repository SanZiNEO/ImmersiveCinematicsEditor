<script setup lang="ts">
/**
 * 停靠表面（04-03）。
 *
 * 只渲染 `LayoutRenderer` 并把指针手势翻译成 `DockLayoutController` 的状态；
 * 不持布局尺寸、不写文件、不碰文档。拖动中只画落点预览，松手才提交一次事务。
 */
import { inject, onBeforeUnmount, provide, reactive, ref, shallowRef, watch } from 'vue'
import type { LayoutTree, WorkspaceLayoutService } from '../api/layout.ts'
import type { PanelRef } from '../api/ids.ts'
import { samePanel } from '../api/ids.ts'
import { LAYOUT_SERVICE, STATUS_SERVICE } from '../api/tokens.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'
import LayoutRenderer from '../host/LayoutRenderer.vue'
import type { DockPoint, DockRect, DropTarget } from './DropTarget.ts'
import { computeDropTarget } from './DropTarget.ts'
import type { DockGestureState } from './DockLayoutController.ts'
import { DockLayoutController } from './DockLayoutController.ts'
import { DOCK_CONTEXT_KEY, DOCK_PAGE_KEY, type DockContext } from './dockContext.ts'

const props = defineProps<{
  pageId: string
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const layoutOrNull = services?.get(LAYOUT_SERVICE)
if (!layoutOrNull) throw new Error('DockSurface 需要 LAYOUT_SERVICE（ServiceRegistry 未提供）')
// 局部非空别名：setup 顶层的窄化不会保留到模板/闭包里。
const layout: WorkspaceLayoutService = layoutOrNull
const status = services?.get(STATUS_SERVICE) ?? null

const rootEl = ref<HTMLElement | null>(null)
const tree = shallowRef<LayoutTree>(layout.getTree(props.pageId))
const gestureState = ref<DockGestureState>('idle')

let pointerId: number | null = null
let captureElement: HTMLElement | null = null
let listenersAttached = false
let suppressClick = false
let currentTarget: DropTarget | null = null

interface PreviewRect {
  kind: DropTarget['kind']
  x: number
  y: number
  width: number
  height: number
}

interface PreviewLine {
  x: number
  y: number
  height: number
}

const previewRect = ref<PreviewRect | null>(null)
const previewLine = ref<PreviewLine | null>(null)
const blocked = ref(false)

let controller: DockLayoutController

const dockContext = reactive<DockContext>({
  dragging: false,
  beginPanelDrag,
  isPanelDragging,
})

provide(DOCK_CONTEXT_KEY, dockContext)
provide(DOCK_PAGE_KEY, () => props.pageId)

controller = new DockLayoutController({
  layout,
  pageId: props.pageId,
  onChange: syncGestureState,
})

const unsubscribe = layout.subscribe(syncTree)

watch(
  () => props.pageId,
  () => {
    controller.cancel('route-change')
    finishGesture()
    controller = new DockLayoutController({
      layout,
      pageId: props.pageId,
      onChange: syncGestureState,
    })
    syncTree()
    syncGestureState()
  },
)

onBeforeUnmount(() => {
  unsubscribe()
  controller.cancel('unmount')
  finishGesture()
})

function syncTree(): void {
  tree.value = layout.getTree(props.pageId)
}

function syncGestureState(): void {
  gestureState.value = controller.state()
  dockContext.dragging = gestureState.value !== 'idle'
}

function beginPanelDrag(event: PointerEvent, ref: PanelRef, fromGroupId: string): void {
  if (event.button !== 0) return
  if (event.pointerType === 'mouse' && (event.buttons & 1) !== 1) return
  if (isInteractiveTarget(event.target)) return
  if (controller.state() !== 'idle') controller.cancel('restart')

  const element = event.currentTarget
  const root = rootEl.value
  if (!(element instanceof HTMLElement) || !root) return

  controller.pointerDown(ref, fromGroupId, localPoint(event, root))
  pointerId = event.pointerId
  captureElement = element
  try {
    element.setPointerCapture(event.pointerId)
  } catch {
    // 捕获失败时仍可用冒泡事件；不阻断拖动。
  }
  attachEphemeralListeners()
  syncGestureState()
}

function isPanelDragging(ref: PanelRef): boolean {
  const source = controller.sourceRef()
  return source !== null && samePanel(source, ref)
}

function onPointerMove(event: PointerEvent): void {
  if (controller.state() === 'idle') return
  if (pointerId !== null && event.pointerId !== pointerId) return
  const root = rootEl.value
  if (!root) return

  const point = localPoint(event, root)
  controller.pointerMove(point)
  if (!controller.isDragging()) {
    syncGestureState()
    return
  }
  updateDropPreview(point, root)
  syncGestureState()
}

function onPointerUp(event: PointerEvent): void {
  if (controller.state() === 'idle') return
  if (pointerId !== null && event.pointerId !== pointerId) return

  if (controller.isDragging()) suppressClick = true
  const target = currentTarget
  const result = controller.pointerUp(target ?? undefined)
  finishGesture()
  if (
    !result.committed &&
    result.reason !== undefined &&
    result.reason !== 'below-threshold' &&
    result.reason !== 'same-position'
  ) {
    notifyBlocked(result.reason)
  }
}

function onPointerCancel(event: PointerEvent): void {
  if (pointerId !== null && event.pointerId !== pointerId) return
  if (controller.state() === 'idle') return
  controller.cancel('pointer-cancel')
  finishGesture()
}

function onLostPointerCapture(event: PointerEvent): void {
  if (pointerId !== null && event.pointerId !== pointerId) return
  if (controller.state() === 'idle') return
  controller.cancel('lost-capture')
  finishGesture()
}

function onClickCapture(event: MouseEvent): void {
  if (!suppressClick) return
  suppressClick = false
  event.stopPropagation()
  event.preventDefault()
}

function finishGesture(): void {
  releaseCapture()
  detachEphemeralListeners()
  currentTarget = null
  previewRect.value = null
  previewLine.value = null
  blocked.value = false
  syncGestureState()
}

function releaseCapture(): void {
  const element = captureElement
  const id = pointerId
  captureElement = null
  pointerId = null
  if (element === null || id === null) return
  try {
    element.releasePointerCapture(id)
  } catch {
    // 指针/元素已失效时浏览器会自己清理。
  }
}

function attachEphemeralListeners(): void {
  if (listenersAttached) return
  window.addEventListener('keydown', onWindowKeydown, true)
  window.addEventListener('blur', onWindowBlur)
  listenersAttached = true
}

function detachEphemeralListeners(): void {
  if (!listenersAttached) return
  window.removeEventListener('keydown', onWindowKeydown, true)
  window.removeEventListener('blur', onWindowBlur)
  listenersAttached = false
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (controller.state() === 'idle') return
  controller.cancel('escape')
  finishGesture()
}

function onWindowBlur(): void {
  if (controller.state() === 'idle') return
  controller.cancel('window-blur')
  finishGesture()
}

function updateDropPreview(point: DockPoint, root: HTMLElement): void {
  const source = controller.sourceRef()
  if (source === null) {
    clearPreview()
    return
  }
  const { rects, tabBars } = collectRects(root)
  const target = computeDropTarget({
    pointer: point,
    rects,
    tabBars,
    source,
    viewport: viewportSize(root),
    sourceGroupId: controller.fromGroup() ?? undefined,
    sourceIndex: controller.sourceIndex() ?? undefined,
  })
  controller.setDropTarget(target)
  currentTarget = target
  applyPreview(target, rects, tabBars)
}

function collectRects(root: HTMLElement): { rects: DockRect[]; tabBars: DockRect[] } {
  const rootRect = root.getBoundingClientRect()
  const rects: DockRect[] = []
  const tabBars: DockRect[] = []

  root.querySelectorAll<HTMLElement>('[data-dock-kind]').forEach((element) => {
    const kind = element.dataset.dockKind
    if (
      kind !== 'group' &&
      kind !== 'tabbar' &&
      kind !== 'drawer' &&
      kind !== 'workspace'
    ) {
      return
    }
    const groupId = element.dataset.dockGroupId ?? (kind === 'workspace' ? 'workspace' : '')
    if (groupId.length === 0) return
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const dockRect: DockRect = {
      groupId,
      kind,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    }
    if (kind === 'tabbar') tabBars.push(dockRect)
    else rects.push(dockRect)
  })

  if (!rects.some((rect) => rect.kind === 'workspace')) {
    rects.push({
      groupId: 'workspace',
      kind: 'workspace',
      x: 0,
      y: 0,
      width: rootRect.width,
      height: rootRect.height,
    })
  }
  return { rects, tabBars }
}

function applyPreview(target: DropTarget, rects: DockRect[], tabBars: DockRect[]): void {
  previewRect.value = null
  previewLine.value = null
  blocked.value = false

  if (target.kind === 'none') {
    blocked.value = target.reason === 'outside' || target.reason === 'no-target'
    return
  }

  if (target.kind === 'reorder') {
    const tabs = tabBars
      .filter((rect) => rect.kind === 'tabbar' && rect.groupId === target.groupId)
      .slice()
      .sort((left, right) => left.x - right.x)
    if (tabs.length === 0) return
    const index = Math.max(0, Math.min(target.index ?? tabs.length, tabs.length))
    const x =
      index === 0
        ? tabs[0].x
        : index >= tabs.length
          ? tabs[tabs.length - 1].x + tabs[tabs.length - 1].width
          : tabs[index].x
    previewLine.value = { x, y: tabs[0].y, height: tabs[0].height }
    return
  }

  const rect = findPreviewRect(target, rects, tabBars)
  if (rect === null) return
  if (target.kind === 'split') {
    const half = splitHalf(rect, target)
    previewRect.value = { kind: 'split', ...half }
    return
  }
  previewRect.value = {
    kind: target.kind,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
}

function findPreviewRect(
  target: DropTarget,
  rects: DockRect[],
  tabBars: DockRect[],
): DockRect | null {
  if (target.groupId === undefined) return null
  const kind: DockRect['kind'] =
    target.kind === 'drawer' ? 'drawer' : target.kind === 'new-group' ? 'workspace' : 'group'
  const pool = rects
  let best: DockRect | null = null
  for (const rect of pool) {
    if (rect.groupId !== target.groupId || rect.kind !== kind) continue
    if (best === null || rect.width * rect.height < best.width * best.height) best = rect
  }
  return best
}

function splitHalf(
  rect: DockRect,
  target: DropTarget,
): { x: number; y: number; width: number; height: number } {
  if (target.orientation === 'vertical') {
    const height = rect.height / 2
    return target.side === 'top'
      ? { x: rect.x, y: rect.y, width: rect.width, height }
      : { x: rect.x, y: rect.y + height, width: rect.width, height }
  }
  const width = rect.width / 2
  return target.side === 'left'
    ? { x: rect.x, y: rect.y, width, height: rect.height }
    : { x: rect.x + width, y: rect.y, width, height: rect.height }
}

function clearPreview(): void {
  currentTarget = null
  previewRect.value = null
  previewLine.value = null
  blocked.value = false
}

function notifyBlocked(reason: string): void {
  const message =
    reason === 'outside' || reason === 'no-target'
      ? '不可停靠：请拖到面板或标签区域'
      : `无法移动面板：${reason}`
  status?.notify(message, 'warning')
}

function localPoint(event: PointerEvent, root: HTMLElement): DockPoint {
  const rect = root.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function viewportSize(root: HTMLElement): { width: number; height: number } {
  const rect = root.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height }
  return layout.viewport()
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"]',
    ) !== null
  )
}

function rectStyle(rect: PreviewRect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}

function lineStyle(line: PreviewLine): Record<string, string> {
  return {
    left: `${line.x}px`,
    top: `${line.y}px`,
    height: `${line.height}px`,
  }
}
</script>

<template>
  <div
    ref="rootEl"
    class="dock-surface"
    :class="{ 'is-dragging': gestureState === 'dragging' }"
    data-dock-kind="workspace"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onLostPointerCapture"
    @click.capture="onClickCapture"
  >
    <LayoutRenderer :tree="tree" :page-id="pageId" />

    <div class="dock-drop-layer" aria-hidden="true">
      <div
        v-if="previewRect !== null"
        class="dock-drop-rect"
        :class="`is-${previewRect.kind}`"
        :style="rectStyle(previewRect)"
      />
      <div v-if="previewLine !== null" class="dock-drop-line" :style="lineStyle(previewLine)" />
    </div>

    <div v-if="blocked" class="dock-drop-blocked" role="status">不可停靠</div>
  </div>
</template>

<style scoped>
.dock-surface {
  position: relative;
  /* 必须是 flex 容器：里面的 .layout-renderer 用 `flex: 1 1 auto` 撑满，
     block 容器下该属性无效，整棵布局树会塌成 0 高（抽屉折叠条被顶到顶部）。 */
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-app);
}

.dock-surface.is-dragging {
  cursor: grabbing;
  user-select: none;
}

.dock-drop-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

.dock-drop-rect {
  position: absolute;
  border: 1px solid var(--accent);
  background: var(--accent);
  opacity: 0.18;
}

.dock-drop-rect.is-split {
  opacity: 0.26;
}

.dock-drop-rect.is-new-group {
  background: transparent;
  border-style: dashed;
  opacity: 1;
}

.dock-drop-rect.is-drawer {
  opacity: 0.16;
}

.dock-drop-line {
  position: absolute;
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--bg-raised);
}

.dock-drop-blocked {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 11;
  padding: 4px 8px;
  border: 1px solid var(--error);
  border-radius: 4px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 12px;
  pointer-events: none;
}
</style>
