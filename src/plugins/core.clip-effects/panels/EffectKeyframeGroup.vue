<script setup lang="ts">
/**
 * 单个叶子的关键帧组（06-04）：只画本属性的节点、段线与播放头。
 *
 * 几何一律来自 `geometry.ts`（`nodesOfRow` / `segmentsOfRow` / `hitTestNodes` / `nodesInRect`），
 * 本组件不重算坐标；横坐标由外壳下发的共享视口换算，所有组共用同一条局部标尺。
 *
 * 编辑只发意图：拖动过程只移动本地预览，松手一次发 `move-nodes`（外壳一次提交，
 * 一条撤销项）；选择发 `select-node`；点击组内空白只移播放头（`setPlayhead`，会话态），
 * 不新增节点。事件节点点击发 `open-event`（记录编辑器由切片 C 提供）。
 *
 * 轴外节点（有限片段 `time > duration`）半透明 + 虚线外框，选中后恢复实心 + 外环；
 * 不钳制、不裁掉、不隐藏。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { isFiniteNumber, isJsonObject } from '../../../core/doc/json.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import { easingKey, readEasingTable } from '../../../features/effects/easingStore.ts'
import {
  PLAYHEAD_EPSILON,
  ROW_LAYOUT,
  hitTestNodes,
  nodesInRect,
  nodesOfRow,
  segmentsOfRow,
} from '../../../features/effects/geometry.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import {
  TIME_PRECISION,
  roundTime,
  sameTime,
  snapSources,
  snapThresholdSeconds,
  snapTime,
} from '../../../features/effects/keyframeOps.ts'
import type {
  EffectViewport,
  KeyframeNode,
  KeyframeSelection,
  PropertyRow,
  SegmentGeometry,
  SegmentSelection,
} from '../../../features/effects/types.ts'
import { timeToX, xToTime } from '../../../features/effects/viewport.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import type { NodeMovePayload, NodeSelectMode, NodeSelectPayload } from '../../../features/effects/panels/effectRowEvents.ts'

const props = defineProps<{
  row: PropertyRow
  viewport: EffectViewport
  timing: ClipTiming
  playhead: number
  selection: readonly KeyframeSelection[]
  selectedSegment?: SegmentSelection | null
  readOnly?: boolean
  currentValue?: JsonValue
  /** 外壳下发的吸附候选（跨行汇总）；缺省时本组件按本行 + 播放头 + 刻度 + 标记自算。 */
  snapCandidates?: readonly number[]
  /**
   * 本行在关键帧内容区里的顶部纵坐标（`layoutRows` 的行顶）。
   *
   * 给了就把框选矩形换算成内容区坐标（外壳可用 `selectionsInRect` 跨行解析）；
   * 没给时矩形是行内坐标，只代表本行。
   */
  rowTop?: number
}>()

const emit = defineEmits<{
  'select-node': [payload: NodeSelectPayload]
  'move-nodes': [payload: NodeMovePayload]
  'open-event': [payload: { clipKey: string; path: string; time: number }]
  /** 段选择（缓动编辑入口）：身份是片段 + 路径 + 起止时间，不用下标。 */
  'select-segment': [payload: { clipKey: string; path: string; fromTime: number; toTime: number }]
}>()

const ctx = usePanelContext()

/** 节点半径（像素）：常规 / 选中 / 播放头命中。 */
const NODE_RADIUS = 4.5
const NODE_RADIUS_SELECTED = 6
const NODE_RADIUS_PLAYHEAD = 6.5
/** 事件记录条的最小宽度（像素）：零时长也看得见。 */
const MIN_BAR_PX = 12
/** 事件瞬时节点：竖菱形的半宽与半高。 */
const EVENT_HALF_WIDTH = 3.2
const EVENT_HALF_HEIGHT = 7
/** 拖动判定阈值（像素）：小于它视为点击。 */
const DRAG_THRESHOLD_PX = 3

const trackHeight = ROW_LAYOUT.row
const rowCenterY = ROW_LAYOUT.row / 2

const isEvent = computed(() => props.row.mode === 'event')
const readOnly = computed(() => props.readOnly === true || props.row.unknown)
const svgRef = ref<SVGSVGElement | null>(null)

/** 节点几何（只含可见窗口内的节点）。 */
const geometry = computed(() => nodesOfRow({
  row: props.row,
  viewport: props.viewport,
  timing: props.timing,
  rowCenterY,
  playhead: props.playhead,
  selection: props.selection,
}))

/** 段几何：事件行不画段；首末节点之外不画外推段（由 geometry 保证）。 */
const segments = computed<SegmentGeometry[]>(() => segmentsOfRow({
  row: props.row,
  viewport: props.viewport,
  rowCenterY,
  selection: props.selectedSegment ?? null,
}))

/** 作者态缓动表：依赖 `props.row` 身份（文档修订后行对象被替换，缓存自然失效）。 */
const easingTable = computed(() => {
  void props.row
  return readEasingTable(ctx.commands.clipAuthoringOf(props.row.clipKey))
})

/** 读取某段的作者态缓动（用于曲线绘制）。 */
function easingOf(fromTime: number, toTime: number): {
  mode: 'linear' | 'bezier'
  outX: number
  outY: number
  inX: number
  inY: number
} | null {
  const entry = easingTable.value[easingKey(props.row.path, fromTime, toTime)]
  if (entry === undefined) {
    return null
  }
  return {
    mode: entry.mode,
    outX: entry.out.x,
    outY: entry.out.y,
    inX: entry.in.x,
    inY: entry.in.y,
  }
}

/** 吸附候选：外壳没给时按本行节点 + 播放头 + 标尺刻度 + 标记 + 片段起止自算。 */
function localSnapCandidates(excludeTimes: readonly number[]): number[] {
  const documentService = ctx.services.get(DOCUMENT_SERVICE)
  const markers = documentService?.sessionView().markers ?? []
  return snapSources({
    rows: [props.row],
    excludeTimes,
    playhead: props.playhead,
    ticks: rulerTicks(),
    markers,
    timing: props.timing,
  })
}

/** 标尺刻度时间（吸附源）：按当前缩放从固定序列里选步长。 */
function rulerTicks(): number[] {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60]
  const pxPerSecond = props.viewport.pxPerSecond
  if (!(pxPerSecond > 0)) {
    return []
  }
  let step = steps[steps.length - 1]
  for (const candidate of steps) {
    if (candidate * pxPerSecond >= 48) {
      step = candidate
      break
    }
  }
  const from = xToTime(0, props.viewport)
  const to = xToTime(props.viewport.width, props.viewport)
  const start = Math.ceil(from / step) * step
  const ticks: number[] = []
  for (let time = start; time <= to + TIME_PRECISION && ticks.length < 512; time += step) {
    ticks.push(Number(time.toFixed(6)))
  }
  return ticks
}

/** 拖动预览：`delta` 秒 + 参与拖动的原始时间集合。 */
const drag = ref<{
  primaryTime: number
  deltaSeconds: number
  times: number[]
  rawDelta: number
} | null>(null)

/** 参与拖动的节点时间（本行内）。 */
const selectedTimesInRow = computed<number[]>(() =>
  props.selection
    .filter((item) => item.clipKey === props.row.clipKey && item.path === props.row.path)
    .map((item) => item.time))

function isDragging(time: number): boolean {
  const current = drag.value
  if (current === null) {
    return false
  }
  return current.times.some((item) => sameTime(item, time))
}

/** 渲染用的节点：拖动时套上本地预览偏移（不写文档）。 */
const displayNodes = computed<KeyframeNode[]>(() => {
  const current = drag.value
  const nodes = geometry.value.nodes
  if (current === null || current.deltaSeconds === 0) {
    return nodes
  }
  return nodes.map((node) => {
    if (!isDragging(node.time)) {
      return node
    }
    const previewTime = node.time + current.deltaSeconds
    return { ...node, x: timeToX(previewTime, props.viewport) }
  })
})

/** 可交互节点：事件起止端点由记录条表达，不参与命中与框选（避免点到不可见元素）。 */
const interactiveNodes = computed<KeyframeNode[]>(() =>
  displayNodes.value.filter((node) => node.kind !== 'event-start' && node.kind !== 'event-end'))

const hiddenCount = computed(() => geometry.value.hiddenCount)

function nodeRadius(node: KeyframeNode): number {
  if (node.selected) {
    return NODE_RADIUS_SELECTED
  }
  if (node.atPlayhead) {
    return NODE_RADIUS_PLAYHEAD
  }
  return NODE_RADIUS
}

function nodePoints(node: KeyframeNode, radius: number): string {
  const x = node.x
  const y = node.y
  return `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`
}

function instantPoints(node: KeyframeNode): string {
  const x = node.x
  const y = node.y
  return `${x},${y - EVENT_HALF_HEIGHT} ${x + EVENT_HALF_WIDTH},${y} ${x},${y + EVENT_HALF_HEIGHT} ${x - EVENT_HALF_WIDTH},${y}`
}

/** 事件记录条：起点 = 节点时间，终点取记录体里显式的 `end`。 */
interface EventBar {
  key: string
  x1: number
  x2: number
  y: number
  selected: boolean
  outOfRange: boolean
  atPlayhead: boolean
  time: number
  end: number
  interval: boolean
}

const eventBars = computed<EventBar[]>(() => {
  if (!isEvent.value) {
    return []
  }
  const minSeconds = MIN_BAR_PX / Math.max(1e-6, props.viewport.pxPerSecond)
  const bars: EventBar[] = []
  for (const node of displayNodes.value) {
    const body = node.value
    const rawEnd = isJsonObject(body) && isFiniteNumber(body.end) ? body.end : null
    // 瞬时事件只画竖菱形（见节点层），不进记录条。
    if (rawEnd === null) {
      continue
    }
    const x1 = node.x
    const x2 = timeToX(rawEnd, props.viewport)
    bars.push({
      key: `${node.path}@${node.time}`,
      x1,
      x2: Math.max(x2, x1 + MIN_BAR_PX),
      y: node.y,
      selected: node.selected,
      outOfRange: node.outOfRange,
      atPlayhead: node.atPlayhead,
      time: node.time,
      end: Math.max(rawEnd, node.time + minSeconds),
      interval: true,
    })
  }
  return bars
})

/** 事件行的端点标记：区间事件画起止端点，瞬时事件只画竖菱形（不再画端点）。 */
const eventEndpoints = computed(() => eventBars.value.filter((bar) => bar.interval))

interface SegmentShape {
  key: string
  kind: 'line' | 'step' | 'curve'
  path: string
  selected: boolean
  interp: SegmentGeometry['interp']
  title: string
}

const segmentShapes = computed<SegmentShape[]>(() => {
  const shapes: SegmentShape[] = []
  for (const segment of segments.value) {
    const y = segment.y
    const x1 = segment.x1
    const x2 = segment.x2
    const key = `${segment.path}@${segment.fromTime}-${segment.toTime}`
    const easing = easingOf(segment.fromTime, segment.toTime)
    if (easing !== null && easing.mode === 'bezier') {
      const dx = Math.max(2, x2 - x1)
      // 把手横坐标是段内归一化进度（0..1），纵坐标 0..1 映射到行高内的偏移。
      const scale = 10
      const c1x = x1 + dx * easing.outX
      const c2x = x1 + dx * easing.inX
      const c1y = y + (easing.outY - 0) * scale
      const c2y = y + (easing.inY - 1) * scale
      shapes.push({
        key,
        kind: 'curve',
        path: `M ${x1} ${y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y}`,
        selected: segment.selected,
        interp: segment.interp,
        title: `贝塞尔段 ${segment.fromTime} → ${segment.toTime}`,
      })
      continue
    }
    if (segment.interp === 'step') {
      // 台阶：沿行中心到终点后向上抬一格，视觉上区别于直线。
      const rise = 4
      shapes.push({
        key,
        kind: 'step',
        path: `M ${x1} ${y} H ${x2} V ${y - rise}`,
        selected: segment.selected,
        interp: segment.interp,
        title: `台阶段 ${segment.fromTime} → ${segment.toTime}`,
      })
      continue
    }
    shapes.push({
      key,
      kind: 'line',
      path: `M ${x1} ${y} H ${x2}`,
      selected: segment.selected,
      interp: segment.interp,
      title: `${segment.interp} 段 ${segment.fromTime} → ${segment.toTime}`,
    })
  }
  return shapes
})

function nodeTitle(node: KeyframeNode): string {
  const time = node.time.toFixed(3)
  const out = node.outOfRange ? '（轴外）' : ''
  const value = previewValueText(node.value)
  return `${node.path} 在 ${time}s 等于 ${value}${out}`
}

function previewValueText(value: unknown): string {
  if (value === undefined) {
    return '（未设置）'
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}

function barTitle(bar: EventBar): string {
  const range = bar.interval ? `${bar.time.toFixed(3)}s → ${bar.end.toFixed(3)}s` : `${bar.time.toFixed(3)}s 瞬时`
  const out = bar.outOfRange ? '（轴外）' : ''
  return `${bar.key.split('@')[0]} ${range}${out}`
}

/* ---------------- 交互 ---------------- */

type PointerMode = 'idle' | 'press-node' | 'drag-nodes' | 'press-blank' | 'marquee'

const pointer = ref<{
  mode: PointerMode
  startX: number
  startY: number
  primaryTime: number
  times: number[]
  additive: boolean
} | null>(null)

const marquee = ref<{ left: number; top: number; right: number; bottom: number } | null>(null)

function localPoint(event: PointerEvent): { x: number; y: number } {
  const element = svgRef.value
  if (element === null) {
    return { x: 0, y: 0 }
  }
  const rect = element.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function nodeAt(x: number, y: number): KeyframeNode | null {
  return hitTestNodes(interactiveNodes.value, x, y, Math.max(NODE_RADIUS_SELECTED, 6))
}

function barAt(x: number, y: number): EventBar | null {
  for (const bar of eventBars.value) {
    if (x >= bar.x1 - 3 && x <= bar.x2 + 3 && Math.abs(y - bar.y) <= 8) {
      return bar
    }
  }
  return null
}

/**
 * 段命中：点击两个节点之间的连线选中该段（06-06 缓动编辑入口）。
 *
 * 容差 5px、只认横坐标落在段内且纵坐标贴近行中心；台阶段与事件行没有可选段
 * （台阶段不参与缓动编辑）。
 */
function segmentAt(x: number, y: number): SegmentGeometry | null {
  if (isEvent.value) {
    return null
  }
  for (const segment of segments.value) {
    if (segment.interp === 'step') {
      continue
    }
    const left = Math.min(segment.x1, segment.x2)
    const right = Math.max(segment.x1, segment.x2)
    if (x < left - 2 || x > right + 2) {
      continue
    }
    if (Math.abs(y - segment.y) > 5) {
      continue
    }
    return segment
  }
  return null
}

function selectModeOf(event: PointerEvent | MouseEvent): NodeSelectMode {
  if (event.shiftKey) {
    return 'range'
  }
  if (event.ctrlKey || event.metaKey) {
    return 'toggle'
  }
  return 'replace'
}

function emitSelect(node: KeyframeNode, mode: NodeSelectMode, times?: number[]): void {
  const payload: NodeSelectPayload = {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: node.time,
    mode,
    ...(times === undefined ? {} : { times }),
  }
  emit('select-node', payload)
}

/** Shift 同属性范围选择：从锚点到目标节点之间的全部时间（锚点只在同一行内有效）。 */
const anchor = ref<{ path: string; time: number } | null>(null)

function rangeTimes(target: number): number[] {
  const current = anchor.value
  if (current === null || current.path !== props.row.path) {
    return [target]
  }
  const low = Math.min(current.time, target)
  const high = Math.max(current.time, target)
  return props.row.keyframes
    .map((frame) => frame.time)
    .filter((time) => time >= low - PLAYHEAD_EPSILON && time <= high + PLAYHEAD_EPSILON)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }
  const point = localPoint(event)
  const node = nodeAt(point.x, point.y)
  const bar = node === null ? barAt(point.x, point.y) : null
  const target = node ?? null
  const svg = svgRef.value
  svg?.setPointerCapture(event.pointerId)

  if (isEvent.value) {
    const hitTime = bar !== null ? bar.time : (target !== null ? target.time : null)
    if (hitTime !== null) {
      emit('open-event', { clipKey: props.row.clipKey, path: props.row.path, time: hitTime })
      return
    }
  }

  if (target !== null) {
    const mode = selectModeOf(event)
    const selectedInRow = selectedTimesInRow.value
    if (mode === 'range') {
      const times = rangeTimes(target.time)
      anchor.value = anchor.value ?? { path: props.row.path, time: target.time }
      emitSelect(target, 'range', times)
      if (!readOnly.value) {
        pointer.value = {
          mode: 'press-node',
          startX: point.x,
          startY: point.y,
          primaryTime: target.time,
          times: times.includes(target.time) ? [...times] : [...times, target.time],
          additive: false,
        }
      }
      return
    }
    if (mode === 'toggle') {
      emitSelect(target, 'toggle', [target.time])
      // 取消选中后不再参与拖动：按住 Ctrl 点击已选节点只做增删。
      if (target.selected || readOnly.value) {
        return
      }
      const times = [...selectedInRow, target.time]
      pointer.value = {
        mode: 'press-node',
        startX: point.x,
        startY: point.y,
        primaryTime: target.time,
        times,
        additive: true,
      }
      return
    }

    anchor.value = { path: props.row.path, time: target.time }
    if (!target.selected) {
      emitSelect(target, 'replace', [target.time])
    }
    if (readOnly.value) {
      return
    }
    // 拖动：已选中多个节点时整体拖动，否则只拖被按下的那个。
    const times = target.selected && selectedInRow.length > 0 ? [...selectedInRow] : [target.time]
    pointer.value = {
      mode: 'press-node',
      startX: point.x,
      startY: point.y,
      primaryTime: target.time,
      times: times.includes(target.time) ? times : [...times, target.time],
      additive: false,
    }
    return
  }

  // 节点与记录条都未命中：先看是否点中了段线（缓动编辑入口）。
  const segment = segmentAt(point.x, point.y)
  if (segment !== null) {
    emit('select-segment', {
      clipKey: props.row.clipKey,
      path: segment.path,
      fromTime: segment.fromTime,
      toTime: segment.toTime,
    })
    return
  }

  pointer.value = {
    mode: 'press-blank',
    startX: point.x,
    startY: point.y,
    primaryTime: props.playhead,
    times: [],
    additive: event.ctrlKey || event.metaKey,
  }
}

function onPointerMove(event: PointerEvent): void {
  const current = pointer.value
  if (current === null) {
    return
  }
  const point = localPoint(event)
  const dxPx = point.x - current.startX

  if (current.mode === 'press-node') {
    if (Math.abs(dxPx) < DRAG_THRESHOLD_PX) {
      return
    }
    current.mode = 'drag-nodes'
    pointer.value = { ...current }
  }

  if (current.mode === 'drag-nodes') {
    const rawDelta = dxPx / props.viewport.pxPerSecond
    const rawTarget = current.primaryTime + rawDelta
    const threshold = snapThresholdSeconds(props.viewport.pxPerSecond)
    // Alt 随时按下都能临时关闭吸附（读实时修饰键，不用按下时的快照）。
    const candidates = event.altKey
      ? null
      : (props.snapCandidates !== undefined
        // 外壳给的候选里可能含本行被拖动的原始时间：剔除，避免节点吸到自己。
        ? props.snapCandidates.filter((time) => !current.times.some((item) => sameTime(item, time)))
        : localSnapCandidates(current.times))
    const snapped = candidates === null
      ? rawTarget
      : snapTime(rawTarget, candidates, threshold)
    // 以主节点吸附结果为准算出统一偏移（1e-3 精度），其余节点保持相对偏移。
    const delta = roundTime(snapped - current.primaryTime)
    drag.value = {
      primaryTime: current.primaryTime,
      deltaSeconds: delta,
      times: current.times,
      rawDelta,
    }
    return
  }

  if (current.mode === 'press-blank') {
    if (Math.abs(dxPx) < DRAG_THRESHOLD_PX && Math.abs(point.y - current.startY) < DRAG_THRESHOLD_PX) {
      return
    }
    current.mode = 'marquee'
    pointer.value = { ...current }
  }

  if (current.mode === 'marquee') {
    marquee.value = {
      left: Math.min(current.startX, point.x),
      right: Math.max(current.startX, point.x),
      top: Math.min(current.startY, point.y),
      bottom: Math.max(current.startY, point.y),
    }
  }
}

function onPointerUp(event: PointerEvent): void {
  const current = pointer.value
  pointer.value = null
  const svg = svgRef.value
  if (svg?.hasPointerCapture(event.pointerId) === true) {
    svg.releasePointerCapture(event.pointerId)
  }
  if (current === null) {
    return
  }

  if (current.mode === 'drag-nodes') {
    const preview = drag.value
    drag.value = null
    if (preview === null || preview.deltaSeconds === 0) {
      return
    }
    const moves: Array<{ path: string; from: number; to: number }> = []
    for (const time of current.times) {
      const to = roundTime(time + preview.deltaSeconds)
      // 负时间不在这里夹取：交给命令层拒绝（`negative_time`），节点回原位、文档不变。
      moves.push({ path: props.row.path, from: time, to })
    }
    if (moves.length === 0) {
      return
    }
    emit('move-nodes', {
      clipKey: props.row.clipKey,
      moves,
      deltaSeconds: preview.deltaSeconds,
      primary: {
        path: props.row.path,
        from: current.primaryTime,
        to: roundTime(current.primaryTime + preview.deltaSeconds),
      },
    })
    return
  }

  if (current.mode === 'marquee') {
    const rect = marquee.value
    marquee.value = null
    if (rect === null) {
      return
    }
    const picked = nodesInRect(interactiveNodes.value, rect)
    // 行内坐标 → 内容区坐标（给了 `rowTop` 才是跨行可用的矩形）。
    const offset = props.rowTop
    const contentRect = offset === undefined
      ? null
      : { left: rect.left, top: rect.top + offset, right: rect.right, bottom: rect.bottom + offset }
    if (picked.length === 0) {
      if (contentRect !== null && !current.additive) {
        // 空白框选：清空节点选择（不改播放头、不写文档）。
        emit('select-node', {
          clipKey: props.row.clipKey,
          path: props.row.path,
          time: props.playhead,
          mode: 'rect',
          times: [],
          rect: contentRect,
        })
      }
      return
    }
    const times = picked.map((node) => node.time)
    const first = picked[0]
    emit('select-node', {
      clipKey: props.row.clipKey,
      path: props.row.path,
      time: first.time,
      mode: contentRect === null ? (current.additive ? 'add' : 'replace') : 'rect',
      times,
      ...(contentRect === null ? {} : { rect: contentRect }),
    })
    return
  }

  if (current.mode === 'press-blank') {
    // 点击组内空白：把播放头移到该时间，不新增节点、不清空选择。
    const time = xToTime(localPoint(event).x, props.viewport)
    if (!Number.isFinite(time)) {
      return
    }
    const clamped = Math.max(0, time)
    const documentService = ctx.services.get(DOCUMENT_SERVICE)
    documentService?.setPlayhead(Number(clamped.toFixed(6)))
  }
}

function onPointerCancel(): void {
  pointer.value = null
  drag.value = null
  marquee.value = null
}

function onDoubleClick(event: MouseEvent): void {
  if (!isEvent.value) {
    return
  }
  const point = localPoint(event as PointerEvent)
  const bar = barAt(point.x, point.y)
  if (bar !== null) {
    emit('open-event', { clipKey: props.row.clipKey, path: props.row.path, time: bar.time })
  }
}

onBeforeUnmount(() => {
  pointer.value = null
  drag.value = null
  marquee.value = null
})

const playheadX = computed(() => timeToX(props.playhead, props.viewport))
const playheadVisible = computed(() =>
  playheadX.value >= -1 && playheadX.value <= props.viewport.width + 1)

const marqueeRect = computed(() => {
  const rect = marquee.value
  if (rect === null) {
    return null
  }
  return {
    x: rect.left,
    y: rect.top,
    width: Math.max(1, rect.right - rect.left),
    height: Math.max(1, rect.bottom - rect.top),
  }
})

/** 当前值提示（值控件采样结果由外壳传入；这里只用于组头的悬停说明）。 */
const currentValueText = computed(() => previewValueText(props.currentValue))
</script>

<template>
  <div
    class="kf-group"
    :class="{ 'kf-group--event': isEvent, 'kf-group--readonly': readOnly }"
    :data-path="row.path"
    :title="`${row.path} · 当前值 ${currentValueText}`"
  >
    <svg
      ref="svgRef"
      class="kf-group__canvas"
      :height="trackHeight"
      role="group"
      :aria-label="`${row.path} 关键帧组`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @dblclick="onDoubleClick"
    >
      <!-- 段线：线性直线 / 台阶折线 / 贝塞尔曲线；事件行没有段 -->
      <g class="kf-segments">
        <path
          v-for="shape in segmentShapes"
          :key="shape.key"
          class="kf-segment"
          :class="{
            'kf-segment--selected': shape.selected,
            'kf-segment--step': shape.kind === 'step',
            'kf-segment--curve': shape.kind === 'curve',
          }"
          :d="shape.path"
          fill="none"
        >
          <title>{{ shape.title }}</title>
        </path>
      </g>

      <!-- 事件记录条：起止端点 + 横条；瞬时事件是竖菱形 -->
      <g v-if="isEvent" class="kf-bars">
        <rect
          v-for="bar in eventBars"
          :key="`bar-${bar.key}`"
          class="kf-bar"
          :class="{ 'kf-bar--selected': bar.selected, 'kf-bar--out': bar.outOfRange }"
          :x="bar.x1"
          :y="bar.y - 3"
          :width="Math.max(MIN_BAR_PX, bar.x2 - bar.x1)"
          height="6"
          rx="2"
        >
          <title>{{ barTitle(bar) }}</title>
        </rect>
        <circle
          v-for="bar in eventEndpoints"
          :key="`start-${bar.key}`"
          class="kf-bar-endpoint"
          :class="{ 'kf-bar-endpoint--selected': bar.selected, 'kf-bar-endpoint--out': bar.outOfRange }"
          :cx="bar.x1"
          :cy="bar.y"
          r="2.5"
        >
          <title>{{ barTitle(bar) }}</title>
        </circle>
        <circle
          v-for="bar in eventEndpoints"
          :key="`end-${bar.key}`"
          class="kf-bar-endpoint"
          :class="{ 'kf-bar-endpoint--selected': bar.selected, 'kf-bar-endpoint--out': bar.outOfRange }"
          :cx="bar.x2"
          :cy="bar.y"
          r="2.5"
        >
          <title>{{ barTitle(bar) }}</title>
        </circle>
      </g>

      <!-- 播放头：每个组各画一条细线，位置由同一个局部时间算出 -->
      <line
        v-if="playheadVisible"
        class="kf-playhead"
        :x1="playheadX"
        :x2="playheadX"
        y1="0"
        :y2="trackHeight"
      />

      <!-- 节点：事件记录由记录条与端点表达，这里只画值节点与瞬时事件竖菱形 -->
      <g class="kf-nodes">
        <template v-for="node in displayNodes" :key="`${node.path}@${node.time}`">
          <template v-if="node.kind === 'event-start' || node.kind === 'event-end'" />
          <polygon
            v-else-if="node.kind === 'event-instant'"
            class="kf-node kf-node--instant"
            :class="{
              'kf-node--selected': node.selected,
              'kf-node--out': node.outOfRange,
              'kf-node--playhead': node.atPlayhead,
            }"
            :points="instantPoints(node)"
          >
            <title>{{ nodeTitle(node) }}</title>
          </polygon>

          <template v-else>
            <polygon
              v-if="node.selected"
              class="kf-node__ring"
              :points="nodePoints(node, nodeRadius(node) + 2.5)"
            />
            <polygon
              class="kf-node"
              :class="{
                'kf-node--selected': node.selected,
                'kf-node--out': node.outOfRange,
                'kf-node--playhead': node.atPlayhead,
                'kf-node--event': isEvent,
              }"
              :points="nodePoints(node, nodeRadius(node))"
            >
              <title>{{ nodeTitle(node) }}</title>
            </polygon>
            <circle
              v-if="node.atPlayhead"
              class="kf-node__dot"
              :cx="node.x"
              :cy="node.y"
              r="1.6"
            />
          </template>
        </template>
      </g>

      <!-- 框选矩形 -->
      <rect
        v-if="marqueeRect !== null"
        class="kf-marquee"
        :x="marqueeRect.x"
        :y="marqueeRect.y"
        :width="marqueeRect.width"
        :height="marqueeRect.height"
      />
    </svg>

    <span v-if="hiddenCount > 0" class="kf-group__hidden" :title="`视口外还有 ${hiddenCount} 个节点`">
      +{{ hiddenCount }}
    </span>
  </div>
</template>

<style scoped>
.kf-group {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.kf-group__canvas {
  display: block;
  width: 100%;
  touch-action: none;
  cursor: crosshair;
}

.kf-group--readonly .kf-group__canvas {
  cursor: default;
}

.kf-segment {
  stroke: var(--text-muted);
  stroke-width: 1.25;
}

.kf-segment--step {
  stroke: var(--warning);
  stroke-dasharray: 3 2;
}

.kf-segment--curve {
  stroke: var(--accent);
  stroke-width: 1.5;
}

.kf-segment--selected {
  stroke: var(--focus);
  stroke-width: 2;
}

.kf-node {
  fill: var(--bg-panel);
  stroke: var(--text);
  stroke-width: 1.2;
  cursor: grab;
}

.kf-node--event {
  stroke: var(--accent);
}

.kf-node--instant {
  fill: var(--accent);
  stroke: var(--accent);
}

.kf-node--playhead {
  stroke: var(--focus);
}

.kf-node--selected {
  fill: var(--accent);
  stroke: var(--text);
  stroke-width: 1.6;
}

.kf-node--out {
  fill-opacity: 0.45;
  stroke-dasharray: 2 2;
}

.kf-node--selected.kf-node--out {
  fill-opacity: 1;
  stroke-dasharray: none;
}

.kf-node__ring {
  fill: none;
  stroke: var(--focus);
  stroke-width: 1.4;
}

.kf-node__dot {
  fill: var(--text);
  pointer-events: none;
}

.kf-bar {
  fill: var(--accent);
  fill-opacity: 0.28;
  stroke: var(--accent);
  stroke-width: 1;
  cursor: pointer;
}

.kf-bar--selected {
  fill-opacity: 0.5;
  stroke: var(--focus);
  stroke-width: 1.6;
}

.kf-bar--out {
  fill-opacity: 0.16;
  stroke-dasharray: 2 2;
}

.kf-bar-endpoint {
  fill: var(--accent);
  stroke: var(--text);
  stroke-width: 1;
}

.kf-bar-endpoint--out {
  fill-opacity: 0.45;
  stroke-dasharray: 2 2;
}

.kf-bar-endpoint--selected {
  fill: var(--focus);
}

.kf-playhead {
  stroke: var(--accent);
  stroke-width: 1;
  stroke-opacity: 0.7;
  pointer-events: none;
}

.kf-marquee {
  fill: var(--selection-outline);
  fill-opacity: 0.12;
  stroke: var(--selection-outline);
  stroke-width: 1;
  stroke-dasharray: 3 2;
  pointer-events: none;
}

.kf-group__hidden {
  position: absolute;
  top: 2px;
  right: 4px;
  padding: 0 3px;
  border-radius: 2px;
  background: var(--bg-raised);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  pointer-events: none;
}
</style>
