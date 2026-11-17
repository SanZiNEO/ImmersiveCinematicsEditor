/**
 * 脚本关系图的几何与派生数据（05-02 / 05-05）。
 *
 * 力导向布局下，节点以「圆心 x/y」定位（LaidOutNode.x/y 是圆心）：
 *   - dot 模式：命中框 w/h = DOT_HIT，圆点半径 r = DOT_RADIUS；
 *   - card 模式：卡片以圆心居中（左上角 = x - NODE_W/2），命中框 = 卡片。
 * 边从源圆边指向目标圆边，二次贝塞尔，平行边按 lane 偏移，跨文件夹带 cross 标记。
 */
import {
  NODE_H,
  NODE_W,
  fitView,
  type GraphLayout,
  type GraphNodePosition,
  type GraphViewState,
  type LaidOutNode,
} from '../../core/graph/layout.ts'
import type { GraphData, GraphEdge, GraphNode, GraphRequirement } from '../../core/graph/types.ts'
import { requirementStatusOf } from './labels.ts'

/** 视口尺寸。 */
export interface ViewportSize {
  width: number
  height: number
}

/** 世界坐标包围盒。 */
export interface WorldBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 一条可渲染的有向边。 */
export interface GraphEdgeView {
  key: string
  fromPath: string
  toPath: string
  from: LaidOutNode
  to: LaidOutNode
  d: string
  midX: number
  midY: number
  back: boolean
  cross: boolean
  requirementIndex: number
  requirementType: string
  label: string
}

/** 一条悬空桩（目标缺失 / 自引用 / 重复 id / 源无 id）。 */
export interface GraphStubView {
  key: string
  path: string
  label: string
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 节点的前置/依赖方计数。 */
export interface NodeDegree {
  requirements: number
  dependents: number
}

/** 同一对节点之间的平行边偏移（世界像素）。 */
const EDGE_OFFSET = 6

/** 悬空桩长度（世界像素）。 */
const STUB_LENGTH = 48

/** 圆点从边缘缩进的锚定半径（dot 模式）。 */
const DOT_ANCHOR = 12

/** 卡片从边缘缩进的锚定半径（card 模式，沿边中点）。 */
const CARD_ANCHOR = 28

/** 轻微弯曲角度（约 2°）：避免完全直线导致多条边重合，又不影响“直线”观感。 */
const BEND_RATIO = Math.tan((2 * Math.PI) / 180)

/**
 * 计算一条边的路径。
 *
 * 默认是**近似直线**：中点沿法向偏移 = 长度 × tan(2°)，只有 2° 左右的微弯，
 * 目的是让完全重合的两条边能分开，而不是画成大弧线。
 * 平行边（同一对节点间多条）再按 lane 做小幅垂直偏移。
 */
function curveBetween(
  from: LaidOutNode,
  to: LaidOutNode,
  lane: number,
  useCard: boolean,
): { d: string; midX: number; midY: number } {
  const fromRadius = useCard ? CARD_ANCHOR : DOT_ANCHOR
  const toRadius = useCard ? CARD_ANCHOR : DOT_ANCHOR
  const dxRaw = to.x - from.x
  const dyRaw = to.y - from.y
  const dist = Math.hypot(dxRaw, dyRaw) || 1
  const ux = dxRaw / dist
  const uy = dyRaw / dist
  // 沿着连线方向，从源圆边缩进、到目标圆边缩进。
  const x1 = from.x + ux * fromRadius
  const y1 = from.y + uy * fromRadius
  const x2 = to.x - ux * toRadius
  const y2 = to.y - uy * toRadius
  // 法向单位向量。
  const nx = -uy
  const ny = ux
  // 2° 微弯 + 平行边的小偏移（lane=0 时只有微弯）。
  const bend = Math.max(2, dist * BEND_RATIO) + lane * EDGE_OFFSET
  const cx = (x1 + x2) / 2 + nx * bend
  const cy = (y1 + y2) / 2 + ny * bend
  return {
    d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
    midX: (x1 + 2 * cx + x2) / 4,
    midY: (y1 + 2 * cy + y2) / 4,
  }
}

/** 关闭分组：力导向下保持坐标（取消泳道重排；兼容旧调用方）。 */
export function arrangeByLayer(
  base: GraphLayout,
  _overrides: Readonly<Record<string, GraphNodePosition>>,
): GraphLayout {
  return base
}

/** 从图与布局节点集合建边视图（两端都在集合里才建）。 */
export function buildEdgeViews(
  graph: GraphData | null,
  nodes: ReadonlyMap<string, LaidOutNode>,
  useCard = false,
): GraphEdgeView[] {
  if (graph === null) {
    return []
  }
  const views: GraphEdgeView[] = []
  const pairLanes = new Map<string, number>()
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      continue
    }
    const pair = `${edge.from}>${edge.to}`
    const lane = pairLanes.get(pair) ?? 0
    pairLanes.set(pair, lane + 1)
    const back = to.layer <= from.layer
    const curve = curveBetween(from, to, lane, useCard)
    views.push({
      key: edge.key,
      fromPath: edge.from,
      toPath: edge.to,
      from,
      to,
      d: curve.d,
      midX: curve.midX,
      midY: curve.midY,
      back,
      cross: from.folder !== to.folder,
      requirementIndex: edge.requirementIndex,
      requirementType: edge.requirementType,
      label: `${to.name} 需要 ${from.name}（${edge.requirementType}）`,
    })
  }
  return views
}

/** 悬空桩标签（05-05 的四个原因）。 */
function stubLabel(requirement: GraphRequirement): string {
  const status = requirementStatusOf(requirement)
  switch (status) {
    case 'self':
      return '自引用'
    case 'duplicate':
      return '重复 id'
    case 'no-id':
      return '无 id'
    case 'custom':
      return '自定义'
    default:
      return '缺失'
  }
}

/** 从节点集合建悬空桩（内置前置但未解析；从圆边向右外延）。 */
export function buildStubViews(graph: GraphData | null, nodes: ReadonlyMap<string, LaidOutNode>): GraphStubView[] {
  if (graph === null) {
    return []
  }
  const stubs: GraphStubView[] = []
  for (const node of nodes.values()) {
    let lane = 0
    for (const trigger of node.triggers) {
      for (const requirement of trigger.requirements) {
        if (requirement.role !== 'builtin' || requirement.resolved === true) {
          continue
        }
        // 沿 +x 方向外延一段固定长度，堆积在节点右缘。
        const anchor = node.x + (node.w / 2) + lane * EDGE_OFFSET * 0.5
        const y = node.y + lane * EDGE_OFFSET - (node.h === 0 ? 0 : 8)
        lane += 1
        stubs.push({
          key: `${node.path}|${trigger.identity}|${requirement.index}`,
          path: node.path,
          label: stubLabel(requirement),
          x1: node.x,
          y1: node.y,
          x2: anchor + STUB_LENGTH,
          y2: y,
        })
      }
    }
  }
  return stubs
}

/** 一阶邻接（悬停高亮；不做递归）。 */
export function adjacentOf(
  edges: readonly GraphEdge[],
  startPath: string,
): { up: Set<string>; down: Set<string> } {
  const up = new Set<string>()
  const down = new Set<string>()
  for (const edge of edges) {
    if (edge.to === startPath) {
      up.add(edge.from)
    }
    if (edge.from === startPath) {
      down.add(edge.to)
    }
  }
  return { up, down }
}

/** 每个节点的前置数与依赖方数。 */
export function nodeDegrees(graph: GraphData | null): Map<string, NodeDegree> {
  const result = new Map<string, NodeDegree>()
  if (graph === null) {
    return result
  }
  for (const node of graph.nodes) {
    result.set(node.path, { requirements: node.requiresTargets.length, dependents: 0 })
  }
  for (const edge of graph.edges) {
    const entry = result.get(edge.from)
    if (entry !== undefined) {
      entry.dependents += 1
    }
  }
  return result
}

/** 重复 `meta.id` 的脚本集合。 */
export function duplicateScriptIds(nodes: readonly GraphNode[]): Set<string> {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.scriptId === null || node.scriptId === undefined) {
      continue
    }
    counts.set(node.scriptId, (counts.get(node.scriptId) ?? 0) + 1)
  }
  const result = new Set<string>()
  for (const [scriptId, count] of counts) {
    if (count > 1) {
      result.add(scriptId)
    }
  }
  return result
}

/** 异常节点集合（invalid / duplicate id / 悬空或自引用前置 / 诊断条目的 path）。 */
export function anomalyPathSet(graph: GraphData | null, nodes: readonly LaidOutNode[]): Set<string> {
  const result = new Set<string>()
  if (graph === null) {
    return result
  }
  const duplicates = duplicateScriptIds(graph.nodes)
  for (const node of nodes) {
    if (!node.valid) {
      result.add(node.path)
    }
    if (node.scriptId !== null && node.scriptId !== undefined && duplicates.has(node.scriptId)) {
      result.add(node.path)
    }
    for (const trigger of node.triggers) {
      for (const requirement of trigger.requirements) {
        if (requirement.role === 'builtin' && requirement.resolved !== true) {
          result.add(node.path)
        }
      }
    }
  }
  for (const warning of graph.warnings) {
    result.add(warning.path)
  }
  return result
}

/** 搜索：名称 / 相对路径 / scriptId / 触发器类型（大小写不敏感）。 */
export function matchesSearch(node: GraphNode, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return true
  }
  if (node.name.toLowerCase().includes(needle)
    || node.path.toLowerCase().includes(needle)
    || (node.scriptId ?? '').toLowerCase().includes(needle)) {
    return true
  }
  return node.triggers.some((trigger) => trigger.type.toLowerCase().includes(needle))
}

/** 目录是否被折叠（自身或祖先目录被折叠；根组 `""` 折叠即全部隐藏）。 */
export function isFolderHidden(folder: string, collapsed: readonly string[]): boolean {
  return collapsed.some((entry) => entry === '' || folder === entry || folder.startsWith(`${entry}/`))
}

/** 最近的已折叠祖先目录（`null` = 未折叠）。 */
export function collapsedAncestorOf(folder: string, collapsed: readonly string[]): string | null {
  if (collapsed.includes('')) {
    return ''
  }
  if (collapsed.includes(folder)) {
    return folder
  }
  let parent = folder
  while (parent.includes('/')) {
    parent = parent.slice(0, parent.lastIndexOf('/'))
    if (collapsed.includes(parent)) {
      return parent
    }
  }
  return null
}

/** 可见节点包围盒（含节点尺寸；useCard 时按卡片半宽，否则按命中框）。 */
export function boxOfNodes(nodes: readonly LaidOutNode[], useCard = false): WorldBox | null {
  if (nodes.length === 0) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const halfW = useCard ? NODE_W / 2 : 0
  const halfH = useCard ? NODE_H / 2 : (nodes[0]?.h ?? 0) / 2
  for (const node of nodes) {
    minX = Math.min(minX, node.x - halfW)
    minY = Math.min(minY, node.y - halfH)
    maxX = Math.max(maxX, node.x + halfW)
    maxY = Math.max(maxY, node.y + halfH)
  }
  return { minX, minY, maxX, maxY }
}

/** 把包围盒适配进视口（不改变可见节点语义）。 */
export function fitBox(box: WorldBox, viewport: ViewportSize, padding = 40): GraphViewState {
  const fitted = fitView(
    { width: Math.max(1, box.maxX - box.minX), height: Math.max(1, box.maxY - box.minY) },
    viewport,
    padding,
  )
  return {
    scale: fitted.scale,
    tx: fitted.tx - box.minX * fitted.scale,
    ty: fitted.ty - box.minY * fitted.scale,
  }
}

/** 一条边相对当前高亮的方向。 */
export function classifyEdge(
  edge: GraphEdgeView,
  sourcePath: string | null,
  up: ReadonlySet<string>,
  down: ReadonlySet<string>,
): 'up' | 'down' | 'none' {
  if (sourcePath === null) {
    return 'none'
  }
  if (edge.toPath === sourcePath || (up.has(edge.fromPath) && up.has(edge.toPath))) {
    return 'up'
  }
  if (edge.fromPath === sourcePath || (down.has(edge.fromPath) && down.has(edge.toPath))) {
    return 'down'
  }
  return 'none'
}

/** 路径展示（太长时中间省略由 CSS 负责）。 */
export function nodeDisplayName(node: Pick<GraphNode, 'name' | 'scriptId' | 'path'>): string {
  if (node.name !== '') {
    return node.name
  }
  if (node.scriptId !== null && node.scriptId !== undefined && node.scriptId !== '') {
    return node.scriptId
  }
  const base = node.path.slice(node.path.lastIndexOf('/') + 1)
  return base.endsWith('.json') ? base.slice(0, -5) : base
}

/** 卡片左上角（世界坐标；卡片以圆心居中）。 */
export function cardTopLeft(node: Pick<LaidOutNode, 'x' | 'y'>): { x: number; y: number } {
  return { x: node.x - NODE_W / 2, y: node.y - NODE_H / 2 }
}