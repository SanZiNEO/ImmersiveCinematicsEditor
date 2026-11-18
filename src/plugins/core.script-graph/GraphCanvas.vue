<script setup lang="ts">
/**
 * 无限画布（05-02 / 05-05）。
 *
 * 只画与手势：世界坐标由 `computeGraphLayout` 提供，视图由 `GraphController` 持有。
 * 拖动空白（阈值 4px）平移、滚轮指针锚定缩放、节点拖动松手写盘、双击空白适配。
 * 不引入第三方图库，不出现滚动条；>200 节点走视口裁剪。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LaidOutNode } from '../../core/graph/layout.ts'
import { NODE_H, NODE_W, intersectsViewport } from '../../core/graph/layout.ts'
import type { GraphNode } from '../../core/graph/types.ts'
import {
  buildEdgeViews,
  buildStubViews,
  classifyEdge,
  type GraphEdgeView,
} from './geometry.ts'
import { requirementTypeLabel } from './labels.ts'
import NodeCard from './NodeCard.vue'
import DotNode from './DotNode.vue'
import HoverCard from './HoverCard.vue'
import GraphContextMenu from './GraphContextMenu.vue'
import { useGraphController } from './state.ts'

interface GraphNodeHandle {
  focus(): void
}

interface PanGesture {
  kind: 'pan'
  startX: number
  startY: number
  startView: { scale: number; tx: number; ty: number }
  pointerId: number
  moved: boolean
  background: boolean
}

interface NodeGesture {
  kind: 'node'
  path: string
  startX: number
  startY: number
  startNodeX: number
  startNodeY: number
  pointerId: number
  moved: boolean
}

type Gesture = PanGesture | NodeGesture

const controller = useGraphController()
const state = controller.state
const graph = computed(() => controller.graph.value)
const layout = computed(() => {
  void controller.layoutRevision.value
  return controller.layout.value
})

const viewportEl = ref<HTMLElement | null>(null)
const nodeRefs = new Map<string, GraphNodeHandle>()
const menu = ref<{ path: string; x: number; y: number } | null>(null)
const edgeTip = ref<{ x: number; y: number; text: string } | null>(null)
let gesture: Gesture | null = null
let spaceDown = false
let resizeObserver: ResizeObserver | null = null
let lastTap: { path: string | null; time: number; x: number; y: number } | null = null

const cropping = computed(() => (graph.value?.stats.nodeCount ?? 0) > 200)

/** LOD 分层：视口内精细、视口外一圈只画点、更远不渲染。 */
const LOD_DETAIL_MARGIN = 80
const LOD_DOT_MARGIN = 900

interface LodSplit {
  /** 精细层：完整渲染（标签、边、交互）。 */
  detail: LaidOutNode[]
  /** 懒加载层：只画圆点，无标签无边。 */
  coarse: LaidOutNode[]
}

const lodSplit = computed<LodSplit>(() => {
  void controller.layoutRevision.value
  const nodes = controller.visibleNodes.value
  const viewport = { width: controller.viewport.width, height: controller.viewport.height }
  if (viewport.width <= 0 || viewport.height <= 0) {
    // 视口未就绪：全部进精细层，但仍要拷贝（拖动靠新引用触发重渲染）。
    return { detail: nodes.map((node) => ({ ...node })), coarse: [] }
  }
  const view = state.view
  const detail: LaidOutNode[] = []
  const coarse: LaidOutNode[] = []
  for (const node of nodes) {
    const size = nodeHitSize(node)
    if (intersectsViewport({ x: node.x, y: node.y, ...size }, view, viewport, LOD_DETAIL_MARGIN)) {
      // 拷贝：moveNode 改的是布局对象本身，引用不变子组件会跳过更新（拖动时点不动、边却动了）。
      detail.push({ ...node })
    } else if (intersectsViewport({ x: node.x, y: node.y, ...size }, view, viewport, LOD_DOT_MARGIN)) {
      coarse.push({ ...node })
    }
  }
  return { detail, coarse }
})

const renderedNodes = computed<LaidOutNode[]>(() => {
  // 返回浅拷贝：拖动时 moveNode 改的是布局对象本身，引用不变会让子组件跳过更新。
  return [...lodSplit.value.detail, ...lodSplit.value.coarse].map((node) => ({ ...node }))
})

/** 只有精细层参与交互与边渲染。 */
const detailNodeMap = computed(() =>
  new Map(lodSplit.value.detail.map((node) => [node.path, { ...node }])))

const coarseNodes = computed<LaidOutNode[]>(() =>
  lodSplit.value.coarse.map((node) => ({ ...node })))

/** 边只画精细层之间的（懒加载层不画边，避免大图边爆炸）。 */
const nodeMap = computed(() => detailNodeMap.value)

const edgeViews = computed(() => {
  void controller.layoutRevision.value
  if (!state.showEdges) {
    return []
  }
  return buildEdgeViews(graph.value, detailNodeMap.value, state.mode === 'card')
})

const stubViews = computed(() => {
  void controller.layoutRevision.value
  // 悬空桩是边线诊断的延伸：边线关闭时一并隐藏，保持一致。
  if (!state.showEdges) {
    return []
  }
  return buildStubViews(graph.value, nodeMap.value)
})

const worldSize = computed(() => {
  void controller.layoutRevision.value
  return {
    width: Math.max(1, Math.ceil(layout.value?.width ?? 1)),
    height: Math.max(1, Math.ceil(layout.value?.height ?? 1)),
  }
})

const partitionViews = computed(() => {
  const visibleFolders = new Set(controller.visibleNodes.value.map((node) => node.folder))
  const viewport = { width: controller.viewport.width, height: controller.viewport.height }
  return controller.partitions.value.filter((view) => {
    if (!view.collapsed && !visibleFolders.has(view.partition.folder)) {
      return false
    }
    if (!cropping.value || viewport.width <= 0 || viewport.height <= 0) {
      return true
    }
    const partition = view.partition
    const scale = state.view.scale
    const left = partition.x * scale + state.view.tx
    const top = partition.y * scale + state.view.ty
    const right = (partition.x + partition.w) * scale + state.view.tx
    const bottom = (partition.y + partition.h) * scale + state.view.ty
    return right >= -50 && left <= viewport.width + 50 && bottom >= -50 && top <= viewport.height + 50
  })
})

const rovingPath = computed(() => {
  const nodes = renderedNodes.value
  const requested = state.rovingPath
  if (requested !== null && nodes.some((node) => node.path === requested)) {
    return requested
  }
  const selected = state.selectedPath
  if (selected !== null && nodes.some((node) => node.path === selected)) {
    return selected
  }
  return nodes[0]?.path ?? null
})

const compact = computed(() => state.view.scale < 0.5)
const cardMode = computed(() => state.mode === 'card')
/** dot 模式下低于此缩放只保留关键节点标签。 */
const DOT_LABEL_SCALE = 0.6

const anchorPath = computed(() => layout.value?.centerPath ?? null)

/** 大图标签阈值更高：节点多时默认只显示关键节点标签，避免糊成一片。 */
const labelScaleThreshold = computed(() => {
  const count = controller.visibleNodes.value.length
  if (count > 2000) {
    return 2.2
  }
  if (count > 600) {
    return 1.4
  }
  return DOT_LABEL_SCALE
})

/** dot 模式是否显示该节点标签：放大时全显，缩小时只留关键节点。 */
function dotShowsLabel(node: LaidOutNode): boolean {
  if (state.view.scale >= labelScaleThreshold.value) {
    return true
  }
  if (node.path === state.selectedPath || node.path === anchorPath.value) {
    return true
  }
  if (node.path === state.hoverPath || node.path === state.detail?.path) {
    return true
  }
  return controller.anomalyPaths.value.has(node.path)
}

/** 节点命中框尺寸（世界像素）：card 用卡片尺寸，dot 用布局给的 DOT_HIT。 */
function nodeHitSize(node: Pick<LaidOutNode, 'w' | 'h'>): { w: number; h: number } {
  return cardMode.value ? { w: NODE_W, h: NODE_H } : { w: node.w, h: node.h }
}
const worldStyle = computed(() => ({
  transform: `translate(${state.view.tx}px, ${state.view.ty}px) scale(${state.view.scale})`,
}))

/** 无限画布网格：照原型用点阵（radial-gradient），随平移/缩放同步。 */
const gridStyle = computed(() => {
  const scale = state.view.scale
  const step = 26 * scale
  const tx = state.view.tx
  const ty = state.view.ty
  const dot = 'color-mix(in srgb, var(--border) 90%, transparent)'
  return {
    backgroundImage: `radial-gradient(${dot} 1px, transparent 1px)`,
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${tx}px ${ty}px`,
  }
})

const zoomPercent = computed(() => `${Math.round(state.view.scale * 100)}%`)

const offscreenRelated = computed(() => {
  if (!cropping.value) {
    return 0
  }
  const relation = controller.relation.value
  if (relation.source === null) {
    return 0
  }
  const rendered = nodeMap.value
  let count = 0
  for (const path of [relation.source, ...relation.up, ...relation.down]) {
    if (!rendered.has(path)) {
      count += 1
    }
  }
  return count
})

const hoverPlacement = computed(() => {
  const target = controller.hoverTarget.value
  if (target === null) {
    return null
  }
  const node = layout.value?.nodes.find((candidate) => candidate.path === target.path)
  if (node === undefined) {
    return null
  }
  const width = controller.viewport.width
  const height = controller.viewport.height
  const scale = state.view.scale
  // node.x/y 是圆心：命中框左上角 = 圆心 - 尺寸/2。
  const size = nodeHitSize(node)
  const nodeLeft = (node.x - size.w / 2) * scale + state.view.tx
  const nodeTop = (node.y - size.h / 2) * scale + state.view.ty
  const nodeWidth = size.w * scale
  const cardWidth = 420
  const maxHeight = Math.max(160, Math.min(560, height - 24))
  // 固定在节点右侧（留 16px 间隔，避免遮住节点、也便于鼠标移入卡片）；
  // 右侧放不下就放到左侧。绝不跟随鼠标——否则用户无法把指针移到卡片上点击。
  const gap = 16
  const preferredLeft = nodeLeft + nodeWidth + gap
  const left = preferredLeft + cardWidth <= width - 8
    ? preferredLeft
    : Math.max(8, nodeLeft - cardWidth - gap)
  const top = Math.max(8, Math.min(nodeTop - 8, Math.max(8, height - maxHeight - 8)))
  return { left, top, maxHeight }
})

const hoverSource = computed(() => controller.hoverTarget.value)
const hoverPinned = computed(() =>
  state.detail !== null && controller.hoverTarget.value?.path === state.detail.path)

const menuNode = computed<GraphNode | null>(() => {
  const current = menu.value
  if (current === null) {
    return null
  }
  return graph.value?.nodes.find((node) => node.path === current.path) ?? null
})

function setNodeRef(path: string, element: unknown): void {
  if (element === null || element === undefined) {
    nodeRefs.delete(path)
    return
  }
  nodeRefs.set(path, element as GraphNodeHandle)
}

function nodeIsUp(path: string): boolean {
  return controller.upPaths.value.has(path)
}

function nodeIsDown(path: string): boolean {
  return controller.downPaths.value.has(path)
}

function nodeIsDim(path: string): boolean {
  const relation = controller.relation.value
  if (relation.mode === 'none' || relation.source === path) {
    return false
  }
  return !relation.up.has(path) && !relation.down.has(path)
}

function edgeDirection(edge: GraphEdgeView): 'up' | 'down' | 'none' {
  return classifyEdge(edge, controller.relationSource.value, controller.upPaths.value, controller.downPaths.value)
}

function edgeIsDim(edge: GraphEdgeView): boolean {
  const relation = controller.relation.value
  return relation.mode !== 'none' && edgeDirection(edge) === 'none'
}

function edgeMarker(edge: GraphEdgeView): string {
  const direction = edgeDirection(edge)
  if (direction === 'up') {
    return 'url(#script-graph-arrow-up)'
  }
  if (direction === 'down') {
    return 'url(#script-graph-arrow-down)'
  }
  return 'url(#script-graph-arrow)'
}

function edgeTooltip(edge: GraphEdgeView): string {
  return `${edge.to.name} 需要 ${edge.from.name}（${requirementTypeLabel(edge.requirementType)}）`
}

function laneStyle(partition: { x: number; y: number; w: number; h: number }, collapsed: boolean): Record<string, string> {
  return {
    left: `${partition.x}px`,
    top: `${partition.y}px`,
    width: `${partition.w}px`,
    height: collapsed ? '30px' : `${partition.h}px`,
  }
}

function nodeTabIndex(path: string): number {
  return rovingPath.value === path ? 0 : -1
}

function moveFocus(path: string, direction: 'left' | 'right' | 'up' | 'down' | 'first' | 'last'): void {
  const nodes = renderedNodes.value
  const current = nodes.find((node) => node.path === path)
  if (current === undefined || nodes.length === 0) {
    return
  }
  if (direction === 'first' || direction === 'last') {
    const sorted = [...nodes].sort((left, right) => {
      const byX = left.x - right.x
      return byX !== 0 ? byX : left.y - right.y
    })
    const target = direction === 'first' ? sorted[0] : sorted[sorted.length - 1]
    if (target !== undefined) {
      controller.setRovingPath(target.path)
      nodeRefs.get(target.path)?.focus()
    }
    return
  }
  const centerX = current.x
  const centerY = current.y
  let best: { path: string; score: number } | null = null
  for (const candidate of nodes) {
    if (candidate.path === path) {
      continue
    }
    // x/y 已是圆心，方向判定直接比圆心差。
    const dx = candidate.x - centerX
    const dy = candidate.y - centerY
    const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (primary <= 4) {
      continue
    }
    const score = primary + secondary * 0.45
    if (best === null || score < best.score) {
      best = { path: candidate.path, score }
    }
  }
  if (best !== null) {
    controller.setRovingPath(best.path)
    nodeRefs.get(best.path)?.focus()
  }
}

function openMenuAt(path: string, clientX: number, clientY: number): void {
  controller.select(path)
  menu.value = { path, x: clientX, y: clientY }
}

function openMenuFromNode(path: string): void {
  const node = nodeMap.value.get(path)
  const viewport = viewportEl.value
  if (node === undefined || viewport === null) {
    return
  }
  const rect = viewport.getBoundingClientRect()
  // 右键菜单贴节点命中框右上角（x/y 是圆心）。
  const size = nodeHitSize(node)
  openMenuAt(
    path,
    rect.left + (node.x + size.w / 2) * state.view.scale + state.view.tx,
    rect.top + (node.y - size.h / 2) * state.view.scale + state.view.ty,
  )
}

function closeMenu(): void {
  menu.value = null
}

function insideElement(event: Event, selector: string): boolean {
  const target = event.target instanceof Element ? event.target : null
  return target !== null && target.closest(selector) !== null
}

function onNodeActivate(path: string): void {
  controller.select(path)
  void controller.openScript(path)
}

function onNodeToggle(path: string): void {
  controller.toggleSelect(path)
}

function escapeGraph(): void {
  if (state.detail !== null) {
    controller.closeDetail()
    return
  }
  if (state.hoverPath !== null) {
    controller.clearHover()
    return
  }
  if (state.selectedPath !== null) {
    controller.clearSelection()
  }
}

function canvasPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = viewportEl.value?.getBoundingClientRect()
  return rect === undefined
    ? { x: event.clientX, y: event.clientY }
    : { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 1) {
    return
  }
  if (controller.hasOpenDialog()) {
    return
  }
  const target = event.target instanceof Element ? event.target : null
  if (insideElement(event, '[data-hover-card]')) {
    return
  }
  if (insideElement(event, '[data-graph-overlay]')) {
    return
  }
  if (menu.value !== null) {
    closeMenu()
  }
  const viewport = viewportEl.value
  if (viewport === null) {
    return
  }
  const nodeElement = target?.closest<HTMLElement>('[data-graph-node]') ?? null
  const path = nodeElement?.getAttribute('data-graph-node') ?? null
  viewport.setPointerCapture(event.pointerId)
  event.preventDefault()

  if (event.button === 1 || spaceDown) {
    gesture = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      startView: { ...state.view },
      pointerId: event.pointerId,
      moved: false,
      background: path === null,
    }
    return
  }
  if (path !== null) {
    const node = nodeMap.value.get(path)
    if (node === undefined) {
      return
    }
    nodeElement?.focus({ preventScroll: true })
    gesture = {
      kind: 'node',
      path,
      startX: event.clientX,
      startY: event.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      pointerId: event.pointerId,
      moved: false,
    }
    return
  }
  viewport.focus({ preventScroll: true })
  gesture = {
    kind: 'pan',
    startX: event.clientX,
    startY: event.clientY,
    startView: { ...state.view },
    pointerId: event.pointerId,
    moved: false,
    background: true,
  }
}

function onPointerMove(event: PointerEvent): void {
  const active = gesture
  if (active !== null) {
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    if (!active.moved) {
      if (Math.hypot(dx, dy) < 4) {
        return
      }
      active.moved = true
      controller.noteGesture(true)
    }
    if (active.kind === 'pan') {
      controller.setView({
        scale: active.startView.scale,
        tx: active.startView.tx + dx,
        ty: active.startView.ty + dy,
      })
      return
    }
    const scale = state.view.scale
    controller.moveNode(active.path, active.startNodeX + dx / scale, active.startNodeY + dy / scale)
    return
  }
  const target = event.target instanceof Element ? event.target : null
  if (insideElement(event, '[data-hover-card]')) {
    controller.hoverKeep()
    return
  }
  const nodeElement = target?.closest('[data-graph-node]') ?? null
  const path = nodeElement?.getAttribute('data-graph-node') ?? null
  if (path !== null) {
    controller.hoverIntent(path)
    return
  }
  if (state.hoverPath !== null) {
    controller.hoverLeave()
  }
}

function isSecondTap(path: string | null, x: number | undefined, y: number | undefined): boolean {
  const previous = lastTap
  if (previous === null || x === undefined || y === undefined) {
    return false
  }
  return previous.path === path
    && Date.now() - previous.time < 350
    && Math.hypot(x - previous.x, y - previous.y) < 8
}

function finishGesture(clientX?: number, clientY?: number): void {
  const active = gesture
  gesture = null
  if (active === null) {
    return
  }
  if (active.moved) {
    lastTap = null
    if (active.kind === 'node') {
      controller.commitNodeMove(active.path)
    } else {
      // 视图变化已在移动中写入内存；这里再触发一次 debounce 保存。
      controller.setView(state.view)
    }
    controller.noteGesture(false)
    return
  }
  if (active.kind === 'node') {
    if (isSecondTap(active.path, clientX, clientY)) {
      lastTap = null
      controller.select(active.path)
      void controller.openScript(active.path)
      return
    }
    controller.toggleSelect(active.path)
    lastTap = {
      path: active.path,
      time: Date.now(),
      x: clientX ?? 0,
      y: clientY ?? 0,
    }
    return
  }
  if (active.background) {
    if (isSecondTap(null, clientX, clientY)) {
      lastTap = null
      controller.fit()
      return
    }
    controller.closeDetail()
    controller.clearSelection()
    lastTap = {
      path: null,
      time: Date.now(),
      x: clientX ?? 0,
      y: clientY ?? 0,
    }
  }
}

function onPointerUp(event: PointerEvent): void {
  const viewport = viewportEl.value
  if (viewport !== null && viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId)
  }
  finishGesture(event.clientX, event.clientY)
}

function onPointerCancel(event: PointerEvent): void {
  const viewport = viewportEl.value
  if (viewport !== null && viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId)
  }
  finishGesture()
}

function onWheel(event: WheelEvent): void {
  if (gesture !== null || insideElement(event, '[data-hover-card]') || event.deltaY === 0) {
    return
  }
  event.preventDefault()
  const point = canvasPoint(event)
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
  controller.zoomBy(factor, point)
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  const target = event.target instanceof Element ? event.target : null
  const path = target?.closest<HTMLElement>('[data-graph-node]')?.getAttribute('data-graph-node') ?? null
  if (path === null) {
    closeMenu()
    return
  }
  openMenuAt(path, event.clientX, event.clientY)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.defaultPrevented || controller.hasOpenDialog()) {
    return
  }
  const target = event.target instanceof Element ? event.target : null
  if (insideElement(event, '[data-hover-card]')) {
    return
  }
  const onNode = target !== null && target.closest('[data-graph-node]') !== null
  if (insideElement(event, '[data-graph-overlay]')) {
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    // 图内不删脚本、不导航退栈。
    event.preventDefault()
    return
  }
  if (event.key === 'Escape') {
    if (!onNode) {
      event.preventDefault()
      escapeGraph()
    }
    return
  }
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey
  if (plain && (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_' || event.key === '0')) {
    event.preventDefault()
    if (event.key === '0') {
      controller.fit()
    } else if (event.key === '+' || event.key === '=') {
      controller.zoomBy(1.2)
    } else {
      controller.zoomBy(1 / 1.2)
    }
    return
  }
  if (onNode) {
    return
  }
  if (event.key === ' ') {
    event.preventDefault()
    spaceDown = true
    return
  }
  if (!plain) {
    return
  }
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      controller.panByPixels(40, 0)
      return
    case 'ArrowRight':
      event.preventDefault()
      controller.panByPixels(-40, 0)
      return
    case 'ArrowUp':
      event.preventDefault()
      controller.panByPixels(0, 40)
      return
    case 'ArrowDown':
      event.preventDefault()
      controller.panByPixels(0, -40)
      return
    default:
      return
  }
}

function onKeyup(event: KeyboardEvent): void {
  if (event.key === ' ') {
    spaceDown = false
  }
}

function onWindowKeyup(event: KeyboardEvent): void {
  if (event.key === ' ') {
    spaceDown = false
  }
}

function onEdgeEnter(event: PointerEvent, edge: GraphEdgeView): void {
  const point = canvasPoint(event)
  edgeTip.value = { x: point.x, y: point.y, text: edgeTooltip(edge) }
}

function onEdgeMove(event: PointerEvent, edge: GraphEdgeView): void {
  const point = canvasPoint(event)
  edgeTip.value = { x: point.x, y: point.y, text: edgeTooltip(edge) }
}

function onEdgeLeave(): void {
  edgeTip.value = null
}

function retry(): void {
  void controller.refresh()
}

function clearFilters(): void {
  controller.clearFilters()
}

function newScript(): void {
  void controller.newScript()
}

function openScriptFile(): void {
  void controller.openScriptFile()
}

function onMountedResize(): void {
  const element = viewportEl.value
  if (element === null) {
    return
  }
  controller.setViewport(element.clientWidth, element.clientHeight)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      controller.setViewport(element.clientWidth, element.clientHeight)
    })
    resizeObserver.observe(element)
  }
  window.addEventListener('keyup', onWindowKeyup)
}

onMounted(onMountedResize)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('keyup', onWindowKeyup)
  controller.clearHover()
  controller.noteGesture(false)
})
</script>

<template>
  <div class="graph-canvas" data-graph-canvas="true" :data-graph-mode="state.mode">
    <div
      ref="viewportEl"
      class="graph-viewport"
      :class="{ 'graph-viewport--gesture': state.gestureActive }"
      :style="gridStyle"
      data-graph-viewport="true"
      tabindex="0"
      role="group"
      aria-label="脚本关系图：可平移缩放的无限画布"
      aria-describedby="script-graph-help"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @wheel="onWheel"
      @contextmenu="onContextMenu"
      @keydown="onKeydown"
      @keyup="onKeyup"
    >
      <template v-if="graph !== null && !(state.phase === 'empty')">
        <div class="graph-world" :style="worldStyle">
          <div
            v-for="view in partitionViews"
            :key="`lane:${view.partition.folder}`"
            class="graph-lane"
            :class="{ 'graph-lane--collapsed': view.collapsed }"
            :style="laneStyle(view.partition, view.collapsed)"
          >
            <button
              type="button"
              class="graph-lane__head"
              data-graph-overlay="true"
              :aria-expanded="!view.collapsed"
              :title="`${view.partition.folder === '' ? 'scripts' : view.partition.folder}（${view.partition.count} 个脚本）`"
              @click="controller.toggleFolder(view.partition.folder)"
            >
              <span class="graph-lane__chevron" aria-hidden="true">{{ view.collapsed ? '▸' : '▾' }}</span>
              <span class="graph-lane__title">{{ view.partition.label }}</span>
              <span class="graph-lane__count">{{ view.partition.count }}</span>
            </button>
          </div>

          <svg
            v-if="state.showEdges"
            class="graph-edges"
            :width="worldSize.width"
            :height="worldSize.height"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <marker
                id="script-graph-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="9"
                markerHeight="9"
                orient="auto-start-reverse"
              >
                <path class="arrow-head arrow-head--muted" d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
              <marker
                id="script-graph-arrow-up"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="9"
                markerHeight="9"
                orient="auto-start-reverse"
              >
                <path class="arrow-head arrow-head--up" d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
              <marker
                id="script-graph-arrow-down"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="9"
                markerHeight="9"
                orient="auto-start-reverse"
              >
                <path class="arrow-head arrow-head--down" d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
            </defs>

            <g
              v-for="edge in edgeViews"
              :key="edge.key"
              class="graph-edge-group"
              :class="{ 'graph-edge-group--dim': edgeIsDim(edge) }"
            >
              <path
                class="graph-edge"
                :class="{
                  'graph-edge--cross': edge.cross,
                  'graph-edge--up': edgeDirection(edge) === 'up',
                  'graph-edge--down': edgeDirection(edge) === 'down',
                }"
                :d="edge.d"
                :marker-end="edgeMarker(edge)"
              >
                <title>{{ edgeTooltip(edge) }}</title>
              </path>
              <path
                class="graph-edge-hit"
                :d="edge.d"
                @pointerenter="onEdgeEnter($event, edge)"
                @pointermove="onEdgeMove($event, edge)"
                @pointerleave="onEdgeLeave"
              >
                <title>{{ edgeTooltip(edge) }}</title>
              </path>
            </g>

            <g v-for="stub in stubViews" :key="stub.key" class="graph-stub">
              <line
                class="graph-stub__line"
                :x1="stub.x1"
                :y1="stub.y1"
                :x2="stub.x2"
                :y2="stub.y2"
              />
              <circle class="graph-stub__dot" :cx="stub.x2" :cy="stub.y2" r="3" />
              <text class="graph-stub__label" :x="stub.x2 - 6" :y="stub.y2 - 6" text-anchor="end">{{ stub.label }}</text>
            </g>
          </svg>

          <!-- 懒加载层：视口外一圈只画小圆点，无标签、无边、不参与交互。 -->
          <svg
            v-if="coarseNodes.length > 0"
            class="graph-coarse-layer"
            :width="worldSize.width"
            :height="worldSize.height"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              v-for="node in coarseNodes"
              :key="`coarse:${node.path}`"
              class="graph-coarse-dot"
              :cx="node.x"
              :cy="node.y"
              :r="node.r"
            />
          </svg>

          <template v-if="cardMode">
            <NodeCard
              v-for="node in lodSplit.detail"
              :key="node.path"
              :ref="(element) => setNodeRef(node.path, element)"
              :node="node"
              :selected="state.selectedPath === node.path"
              :up="nodeIsUp(node.path)"
              :down="nodeIsDown(node.path)"
              :dim="nodeIsDim(node.path)"
              :compact="compact"
              :hovered="state.hoverPath === node.path || state.detail?.path === node.path"
              :tab-index="nodeTabIndex(node.path)"
              @activate="onNodeActivate"
              @toggle="onNodeToggle"
              @menu="openMenuFromNode"
              @move="moveFocus"
              @clear="escapeGraph"
            />
          </template>
          <template v-else>
            <DotNode
              v-for="node in lodSplit.detail"
              :key="node.path"
              :ref="(element) => setNodeRef(node.path, element)"
              :node="node"
              :selected="state.selectedPath === node.path"
              :up="nodeIsUp(node.path)"
              :down="nodeIsDown(node.path)"
              :dim="nodeIsDim(node.path)"
              :hovered="state.hoverPath === node.path || state.detail?.path === node.path"
              :show-label="dotShowsLabel(node)"
              :anchor="node.path === anchorPath"
              :tab-index="nodeTabIndex(node.path)"
              @activate="onNodeActivate"
              @toggle="onNodeToggle"
              @menu="openMenuFromNode"
              @move="moveFocus"
              @clear="escapeGraph"
            />
          </template>
        </div>
      </template>

      <div v-if="state.phase === 'idle' || (state.refreshing && graph === null)" class="graph-overlay graph-overlay--center" data-graph-overlay="true" role="status">
        <div class="skeleton-grid" aria-hidden="true">
          <span v-for="index in 4" :key="index" class="skeleton-card" />
        </div>
        <p class="overlay-text">正在扫描脚本…</p>
      </div>

      <div v-else-if="graph === null" class="graph-overlay graph-overlay--center" data-graph-overlay="true">
        <p class="overlay-title">无法加载脚本关系图</p>
        <p class="overlay-text">{{ state.error ?? '脚本图服务尚未接线。' }}</p>
        <button type="button" class="overlay-button" @click="retry">重试</button>
      </div>

      <div v-else-if="state.phase === 'empty'" class="graph-overlay graph-overlay--center" data-graph-overlay="true">
        <p class="overlay-title">scripts 下还没有脚本</p>
        <p class="overlay-text">新建第一个脚本，或打开已有的脚本文件；这里不显示假节点。</p>
        <div class="overlay-actions">
          <button type="button" class="overlay-button overlay-button--primary" :disabled="!state.connected" @click="newScript">
            新建脚本
          </button>
          <button type="button" class="overlay-button" @click="openScriptFile">打开脚本文件</button>
        </div>
        <p v-if="!state.connected" class="overlay-text">工作区不可用：请先选择游戏目录后再新建脚本。</p>
      </div>

      <div v-else-if="controller.emptyResult.value" class="graph-overlay graph-overlay--center" data-graph-overlay="true">
        <p class="overlay-title">没有匹配的脚本</p>
        <p class="overlay-text">搜索 / 触发器类型 / 只显异常的组合过滤掉了所有节点。</p>
        <button type="button" class="overlay-button" @click="clearFilters">清除过滤</button>
      </div>

      <div class="graph-hints" data-graph-overlay="true">
        <p id="script-graph-help" class="graph-help">
          拖拽平移 · 滚轮缩放 · 单击高亮上下游 · 双击打开脚本 · 悬停看触发器设定
        </p>
        <p class="graph-legend">
          实线箭头 = 前置关系（被依赖 → 依赖方）· 跨文件夹连线 = 跨框前置 · 虚线框 = 文件夹
        </p>
      </div>

      <div class="graph-badges" data-graph-overlay="true">
        <span v-if="cropping" class="graph-chip" :title="`仅渲染视口内 + 50px 的节点：${renderedNodes.length} / ${controller.visibleNodes.value.length}`">
          视口裁剪 {{ renderedNodes.length }} / {{ controller.visibleNodes.value.length }}
        </span>
        <span v-if="offscreenRelated > 0" class="graph-chip graph-chip--warn">
          {{ offscreenRelated }} 个相关节点在视口外
        </span>
        <span class="graph-chip">{{ zoomPercent }}</span>
      </div>

      <div v-if="edgeTip !== null && state.showEdges" class="edge-tooltip" :style="{ left: `${edgeTip.x + 12}px`, top: `${edgeTip.y + 12}px` }">
        {{ edgeTip.text }}
      </div>

      <HoverCard
        v-if="hoverSource !== null && hoverPlacement !== null"
        :node="hoverSource"
        :pinned="hoverPinned"
        :focus-trigger="hoverPinned ? state.detail?.triggerIdentity ?? null : null"
        :left="hoverPlacement.left"
        :top="hoverPlacement.top"
        :max-height="hoverPlacement.maxHeight"
      />
    </div>

    <GraphContextMenu
      v-if="menu !== null && menuNode !== null"
      :node="menuNode"
      :x="menu.x"
      :y="menu.y"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.graph-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  background: var(--bg-app);
}
.graph-viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  outline: none;
}
.graph-viewport:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.graph-viewport--gesture { cursor: grabbing; }
.graph-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.graph-lane {
  position: absolute;
  border: 1px dashed var(--border-strong);
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
  pointer-events: none;
  opacity: 0.9;
}
.graph-lane--collapsed { opacity: 1; }
.graph-lane__head {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px dashed var(--border);
  border-radius: 8px 8px 0 0;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
}
.graph-lane__head:hover { color: var(--text); background: var(--bg-hover); }
.graph-lane__head:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.graph-lane__chevron { color: var(--text-muted); }
.graph-lane__title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.graph-lane__count { color: var(--text-muted); }
.graph-edges {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
/* 懒加载层：视口外只画淡淡的圆点，提示“那边还有东西”。 */
.graph-coarse-layer {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
.graph-coarse-dot {
  fill: var(--text-muted);
  opacity: 0.42;
}
.graph-edge {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1.2;
  stroke-linecap: round;
  pointer-events: none;
}
/* 跨文件夹连线：虚线，与同文件夹的实线区分开。 */
.graph-edge--cross {
  stroke: var(--text-muted);
  stroke-width: 1.1;
  stroke-dasharray: 5 4;
  opacity: 0.75;
}
.graph-edge--up { stroke: var(--c1); stroke-width: 2.2; }
.graph-edge--down { stroke: var(--c2); stroke-width: 2.2; }
.graph-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 12;
  pointer-events: stroke;
  cursor: help;
}
.graph-edge-group--dim { opacity: 0.35; }
.graph-edge-label {
  fill: var(--error);
  font-size: 10px;
  pointer-events: none;
}
.arrow-head--muted { fill: var(--text-muted); }
.arrow-head--up { fill: var(--c1); }
.arrow-head--down { fill: var(--c2); }
.graph-stub__line {
  stroke: var(--warning);
  stroke-width: 1.2;
  stroke-dasharray: 4 3;
  pointer-events: none;
}
.graph-stub__dot { fill: var(--warning); pointer-events: none; }
.graph-stub__label { fill: var(--warning); font-size: 9.5px; pointer-events: none; }
.graph-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  color: var(--text);
  pointer-events: none;
}
.graph-overlay--center { align-items: center; justify-content: center; text-align: center; }
.graph-overlay--center > * { pointer-events: auto; }
.overlay-title { margin: 0; font-size: 15px; font-weight: 600; }
.overlay-text { margin: 0; max-width: 520px; color: var(--text-secondary); font-size: 12px; }
.overlay-actions { display: flex; gap: 8px; }
.overlay-button {
  padding: 5px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.overlay-button:hover:not(:disabled) { background: var(--bg-hover); }
.overlay-button:disabled { opacity: 0.5; cursor: default; }
.overlay-button--primary { border-color: var(--accent); color: var(--accent); }
.overlay-button:focus-visible, .graph-chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.skeleton-grid { display: grid; grid-template-columns: repeat(2, 196px); gap: 18px; }
.skeleton-card {
  display: block;
  width: 196px;
  height: 64px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-panel), var(--bg-raised), var(--bg-panel));
  background-size: 200% 100%;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  from { background-position: 0% 0; opacity: 0.55; }
  50% { opacity: 0.85; }
  to { background-position: 200% 0; opacity: 0.55; }
}
.graph-hints {
  position: absolute;
  left: 10px;
  bottom: 8px;
  right: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
}
.graph-help, .graph-legend { margin: 0; color: var(--text-muted); font-size: 10.5px; }
.graph-help { color: var(--text-secondary); }
.legend-error { color: var(--error); }
.graph-badges {
  position: absolute;
  right: 10px;
  top: 8px;
  display: flex;
  gap: 6px;
  pointer-events: none;
}
.graph-chip {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 10px;
}
.graph-chip--warn { color: var(--warning); border-color: var(--warning); }
.edge-tooltip {
  position: absolute;
  z-index: 40;
  max-width: 360px;
  padding: 3px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 10.5px;
  pointer-events: none;
  box-shadow: 0 4px 12px var(--shadow);
}
</style>
