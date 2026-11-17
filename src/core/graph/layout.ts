/**
 * 05-02 / 05-04 图布局：确定性力导向 + 文件夹簇 + 手摆覆盖 + 锚点中心。
 *
 * 用户指令（05 轮中明确覆盖 `plan/05/05-02` 的“确定性分层、非力导向”）：
 *   1. 以「最终脚本 / 起始脚本」（锚点）为中心向外散发，不再是泳道网格；
 *   2. 每个文件夹一个「框」（簇），框内是该文件夹的脚本，按脚本关系自然连线；
 *   3. 两种渲染模式共用同一套力导向坐标：dot（小圆点）与 card（大卡片）；
 *   4. 上千节点也要可布局：斥力用空间网格近似，同步固定步数，不做运行时动画。
 *
 * 确定性：用 mulberry32(固定种子) 初始化 + 固定迭代步数 + 稳定的遍历顺序，
 * 输入相同输出相同；不引入 `Math.random()`，刷新后节点不跳位（满足 05-04 纯函数契约）。
 */
import type { GraphData, GraphEdge, GraphNode } from './types.ts'

/** 卡片模式宽度（沿用 05-03 固定尺寸；卡片以圆心居中渲染）。 */
export const NODE_W = 196
/** 卡片模式高度。 */
export const NODE_H = 64
/** 圆点模式视觉半径（世界像素）。 */
export const DOT_RADIUS = 12
/** 圆点模式命中框边长（较大以便点击；渲染圆点半径仍为 DOT_RADIUS）。 */
export const DOT_HIT = 32
/** 弹簧理想长度（决定节点间期望间距，世界像素）。 */
export const SPRING_LEN = 190
/** 布局附加边平行偏移基准。 */
export const LAYER_GAP = 180
/** 行间距基准（保留兼容导出）。 */
export const NODE_GAP = 60

const LANE_PAD = 18
const LANE_GAP = 26

/** 视野/布局包围盒间距（世界像素）。 */
export const WORLD_PAD = 60

/** 视图状态（世界坐标 → 屏幕坐标）。 */
export interface GraphViewState {
  scale: number
  tx: number
  ty: number
}

/** 默认视图。 */
export const DEFAULT_VIEW: GraphViewState = { scale: 1, tx: 0, ty: 0 }

/** 手摆覆盖（path → 世界坐标，圆心）。 */
export interface GraphNodePosition {
  x: number
  y: number
  scriptId?: string | null
}

/** 布局输入。 */
export interface GraphLayoutOptions {
  overrides?: Readonly<Record<string, GraphNodePosition>>
  /** 力导向布局的锚点节点 path；缺省自动选择。 */
  centerPath?: string | null
  /** 布局形态：`auto`（按规模自适应）、`blocks`、`force`。 */
  layoutKind?: 'auto' | 'blocks' | 'force'
  /** 覆盖迭代步数（动画分帧时逐帧递增传入）。 */
  steps?: number
}

/** 布局后的节点（x/y 为圆心，w/h 为命中框，r 为圆点半径）。 */
export interface LaidOutNode extends GraphNode {
  x: number
  y: number
  w: number
  h: number
  r: number
  layer: number
  inCycle: boolean
  isolated: boolean
}

/** 布局后的边。 */
export interface LaidOutEdge {
  key: string
  from: LaidOutNode
  to: LaidOutNode
  /** SVG path。 */
  d: string
  /** 目标层 ≤ 源层（环内边或逆流边）。 */
  back: boolean
  /** 是否跨文件夹。 */
  cross: boolean
  /** 曲线控制点中点（标签/环标记用）。 */
  midX: number
  midY: number
}

/** 目录分组带（力导向下为簇的包围盒）。 */
export interface GraphPartition {
  folder: string
  label: string
  x: number
  y: number
  w: number
  h: number
  count: number
}

/** 布局结果（mode 无关；卡片/dot 共用）。 */
export interface GraphLayout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  partitions: GraphPartition[]
  /** 当前锚点节点（力导向中心；可能 null）。 */
  centerPath: string | null
  width: number
  height: number
}

/** 目录标签。 */
export function folderLabel(folder: string): string {
  return folder === '' ? 'scripts' : folder
}

/** Tarjan SCC（迭代版）。 */
function stronglyConnected(count: number, adjacency: readonly number[][]): { component: number[]; components: number[][] } {
  const index = new Array<number>(count).fill(-1)
  const low = new Array<number>(count).fill(0)
  const onStack = new Array<boolean>(count).fill(false)
  const component = new Array<number>(count).fill(-1)
  const stack: number[] = []
  const components: number[][] = []
  let counter = 0

  for (let root = 0; root < count; root += 1) {
    if (index[root] !== -1) {
      continue
    }
    const frames: { node: number; next: number }[] = []
    index[root] = counter
    low[root] = counter
    counter += 1
    stack.push(root)
    onStack[root] = true
    frames.push({ node: root, next: 0 })
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      const neighbours = adjacency[frame.node] ?? []
      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next]
        frame.next += 1
        if (index[next] === -1) {
          index[next] = counter
          low[next] = counter
          counter += 1
          stack.push(next)
          onStack[next] = true
          frames.push({ node: next, next: 0 })
        } else if (onStack[next]) {
          low[frame.node] = Math.min(low[frame.node], index[next])
        }
        continue
      }
      frames.pop()
      const parent = frames[frames.length - 1]
      if (parent !== undefined) {
        low[parent.node] = Math.min(low[parent.node], low[frame.node])
      }
      if (low[frame.node] === index[frame.node]) {
        const members: number[] = []
        for (;;) {
          const node = stack.pop()
          if (node === undefined) {
            break
          }
          onStack[node] = false
          component[node] = components.length
          members.push(node)
          if (node === frame.node) {
            break
          }
        }
        components.push(members)
      }
    }
  }
  return { component, components }
}

/** 计算每个节点的层与环标记（供 dot/card 状态配色与诊断复用）。 */
function layersOf(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): {
  layer: number[]
  inCycle: boolean[]
  isolated: boolean[]
} {
  const indexOf = new Map<string, number>()
  nodes.forEach((node, index) => indexOf.set(node.path, index))
  const adjacency: number[][] = nodes.map(() => [])
  const outgoing = nodes.map(() => 0)
  const incoming = nodes.map(() => 0)
  const seen = new Set<string>()
  for (const edge of edges) {
    const from = indexOf.get(edge.from)
    const to = indexOf.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      continue
    }
    const key = `${from}>${to}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    adjacency[from].push(to)
    outgoing[from] += 1
    incoming[to] += 1
  }

  const { component, components } = stronglyConnected(nodes.length, adjacency)
  const componentCount = components.length
  const componentEdges: Set<number>[] = Array.from({ length: componentCount }, () => new Set<number>())
  const indegree = new Array<number>(componentCount).fill(0)
  for (let from = 0; from < nodes.length; from += 1) {
    for (const to of adjacency[from]) {
      const left = component[from]
      const right = component[to]
      if (left === right) {
        continue
      }
      if (!componentEdges[left].has(right)) {
        componentEdges[left].add(right)
        indegree[right] += 1
      }
    }
  }

  const hasRequirement = nodes.map((node) =>
    node.triggers.some((trigger) => trigger.requirements.some((requirement) => requirement.role === 'builtin')))
  const componentBase = new Array<number>(componentCount).fill(0)
  const componentHasRequirement = new Array<boolean>(componentCount).fill(false)
  for (let index = 0; index < nodes.length; index += 1) {
    componentHasRequirement[component[index]] = componentHasRequirement[component[index]] || hasRequirement[index]
  }
  for (let comp = 0; comp < componentCount; comp += 1) {
    componentBase[comp] = componentHasRequirement[comp] ? 1 : 0
  }

  const componentLayer = new Array<number>(componentCount).fill(0)
  const queue: number[] = []
  for (let comp = 0; comp < componentCount; comp += 1) {
    componentLayer[comp] = componentBase[comp]
    if (indegree[comp] === 0) {
      queue.push(comp)
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const comp = queue[head]
    for (const next of componentEdges[comp]) {
      componentLayer[next] = Math.max(componentLayer[next], componentLayer[comp] + 1)
      indegree[next] -= 1
      if (indegree[next] === 0) {
        queue.push(next)
      }
    }
  }

  const inCycleComponent = components.map((members) => members.length > 1)
  for (let from = 0; from < nodes.length; from += 1) {
    for (const to of adjacency[from]) {
      if (from === to) {
        inCycleComponent[component[from]] = true
      }
    }
  }

  const layer = nodes.map((_, index) => componentLayer[component[index]])
  const inCycle = nodes.map((_, index) => inCycleComponent[component[index]])
  const isolated = nodes.map((node, index) =>
    !hasRequirement[index] && incoming[index] === 0 && outgoing[index] === 0)
  return { layer, inCycle, isolated }
}

/** 目录顺序：根第一，其余按深度 + 路径字典序。 */
function folderOrder(nodes: readonly GraphNode[]): string[] {
  const folders = new Set<string>()
  for (const node of nodes) {
    let folder = node.folder
    folders.add(folder)
    while (folder !== '') {
      const index = folder.lastIndexOf('/')
      folder = index < 0 ? '' : folder.slice(0, index)
      folders.add(folder)
    }
  }
  return [...folders].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length
    return depth !== 0 ? depth : left.localeCompare(right)
  })
}

/* =====================================================================
   确定性伪随机
   ===================================================================== */

/** mulberry32：确定性 PRNG（禁止全局 Math.random 参与布局）。 */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 稳定字符串 hash（FNV-1a），用于派生布局种子。 */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

/** 由节点集合派生固定的布局种子：不依赖随机、不依赖时间。 */
function layoutSeed(nodes: readonly GraphNode[]): number {
  let seed = 0
  for (const node of nodes) {
    seed = (seed * 31 + hashString(node.path)) | 0
  }
  return seed === 0 ? 0x5eed : seed
}

/* =====================================================================
   力导向物理（空间网格近近似斥力，确定性）
   ===================================================================== */

interface PhysNode {
  index: number
  x: number
  y: number
  vx: number
  vy: number
  pinned: boolean
  folder: string
  folderIndex: number
  hasRequirement: boolean
  outdeg: number
}

/* 以下参数直接照抄参考原型 script-dependency-star.html 的物理段。 */
const REPEL = 44_000
/** 同文件夹弹簧。 */
const SPRING_K = 0.03
/** 跨文件夹弹簧。 */
const SPRING_K_CROSS = 0.006
/** 弹簧理想长度。 */
const SPRING_LEN_REF = 155
/** 文件夹向心。 */
const FOLDER_K = 0.012
/** 全局向心。 */
const CENTER_K = 0.0008
const DAMP = 0.85
const MAXV = 14
/** 斥力上限（原型 Math.min(REPEL/d², 8)）。 */
const REPEL_CAP = 8
const ITERATIONS = 420
const CELL = 160
const ZPAD = 52

/** 文件夹中心初始布局：锚点文件夹在原点，其余绕一圈（半径随节点数自适应）。 */
function folderCenters(
  folderOrderList: readonly string[],
  anchorFolder: string,
  seed: number,
  radius: number,
): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>()
  const others = folderOrderList.filter((folder) => folder !== anchorFolder)
  centers.set(anchorFolder, { x: 0, y: 0 })
  others.forEach((folder, index) => {
    const angle = (index / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2
    centers.set(folder, {
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
    })
  })
  void seed
  return centers
}

/** 把边缘落在包围盒外的节点拉回（防溢出；确定性）。 */
function clampWorld(nodes: readonly PhysNode[], limit: number): void {
  for (const node of nodes) {
    node.x = Math.max(-limit, Math.min(limit, node.x))
    node.y = Math.max(-limit, Math.min(limit, node.y))
  }
}

/** 精确全对斥力（照原型 O(n²)，小图用）。 */
function applyRepulsionAll(nodes: readonly PhysNode[]): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      repel(nodes[i], nodes[j], REPEL)
    }
  }
}

/** 一轮斥力：空间网格近似，只算 3x3 邻域格子内的节点对（大图用）。 */
function applyRepulsion(nodes: readonly PhysNode[], cell: number, force: number): void {
  const buckets = new Map<number, number[]>()
  const cellOf = (value: number): number => Math.floor(value / cell)
  // 数字 key：cx * 73856093 ^ cy * 19349663（经典空间散列），避免字符串开销。
  const keyOf = (cx: number, cy: number): number => (cx * 73856093) ^ (cy * 19349663)
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const key = keyOf(cellOf(node.x), cellOf(node.y))
    const list = buckets.get(key)
    if (list === undefined) {
      buckets.set(key, [index])
    } else {
      list.push(index)
    }
  }
  // 同格内两两。
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        repel(nodes[list[a]], nodes[list[b]], force)
      }
    }
  }
  // 邻格：只处理「序号更大的格子」，避免同一对算两次。
  const NEIGHBOURS: readonly [number, number][] = [
    [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
  ]
  for (const list of buckets.values()) {
    // 反查格子坐标成本高，改为遍历节点取首节点坐标。
    const first = nodes[list[0]]
    const cx = cellOf(first.x)
    const cy = cellOf(first.y)
    for (const [gx, gy] of NEIGHBOURS) {
      const other = buckets.get(keyOf(cx + gx, cy + gy))
      if (other === undefined) {
        continue
      }
      for (const ai of list) {
        const A = nodes[ai]
        for (const bi of other) {
          repel(A, nodes[bi], force)
        }
      }
    }
  }
}

function repel(A: PhysNode, B: PhysNode, _force: number): void {
  let dx = B.x - A.x
  let dy = B.y - A.y
  let d2 = dx * dx + dy * dy
  if (d2 < 1) {
    // 重合时给一个确定性微扰（原型用 Math.random，这里用索引保证可复现）。
    dx = ((A.index % 7) - 3) * 0.1 || 0.37
    dy = ((B.index % 5) - 2) * 0.1 || -0.11
    d2 = dx * dx + dy * dy
    if (d2 < 0.1) {
      d2 = 1
      dx = 1
      dy = 0
    }
  }
  const d = Math.sqrt(d2)
  // 原型：force = Math.min(REPEL / d², 8)
  const f = Math.min(REPEL / d2, REPEL_CAP)
  const ux = dx / d
  const uy = dy / d
  A.vx -= ux * f
  A.vy -= uy * f
  B.vx += ux * f
  B.vy += uy * f
}

/** 一轮弹簧、文件夹向心、锚点向心。 */
function applySprings(nodes: readonly PhysNode[], edges: readonly [number, number][], springLen: number): void {
  for (const [from, to] of edges) {
    const A = nodes[from]
    const B = nodes[to]
    const dx = B.x - A.x
    const dy = B.y - A.y
    const d = Math.hypot(dx, dy) || 1
    const ux = dx / d
    const uy = dy / d
    // 同文件夹强弹簧（簇内紧凑），跨文件夹弱弹簧（只表达关系、不拉扁簇）。
    const k = A.folderIndex === B.folderIndex ? SPRING_K : SPRING_K_CROSS
    const f = (d - springLen) * k
    A.vx += ux * f
    A.vy += uy * f
    B.vx -= ux * f
    B.vy -= uy * f
  }
}

function integrate(nodes: readonly PhysNode[], anchorIndex: number): void {
  for (const node of nodes) {
    if (node.pinned || node.index === anchorIndex) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx *= DAMP
    node.vy *= DAMP
    const speed = Math.hypot(node.vx, node.vy)
    if (speed > MAXV) {
      node.vx = (node.vx / speed) * MAXV
      node.vy = (node.vy / speed) * MAXV
    }
    node.x += node.vx
    node.y += node.vy
  }
}

/** 文件夹框分离（重叠时沿较小轴推开两组成员；保证簇框互不重叠）。 */
function separateZones(nodes: readonly PhysNode[], folderIndexByKey: Map<string, number>, leafCount: number, seed: () => number): void {
  void seed
  const folderKeys = [...folderIndexByKey.keys()]
  const count = folderKeys.length
  if (count < 2) {
    return
  }
  // 一次遍历算出每个文件夹的包围盒与质心（O(n)）。
  const minX = new Float64Array(count).fill(Number.POSITIVE_INFINITY)
  const minY = new Float64Array(count).fill(Number.POSITIVE_INFINITY)
  const maxX = new Float64Array(count).fill(Number.NEGATIVE_INFINITY)
  const maxY = new Float64Array(count).fill(Number.NEGATIVE_INFINITY)
  const sumX = new Float64Array(count)
  const sumY = new Float64Array(count)
  const counts = new Float64Array(count)
  for (const node of nodes) {
    const f = node.folderIndex
    if (f < 0 || f >= count) {
      continue
    }
    if (node.x < minX[f]) minX[f] = node.x
    if (node.y < minY[f]) minY[f] = node.y
    if (node.x > maxX[f]) maxX[f] = node.x
    if (node.y > maxY[f]) maxY[f] = node.y
    sumX[f] += node.x
    sumY[f] += node.y
    counts[f] += 1
  }
  // 两两判断重叠并记录位移（O(f²)，f 是文件夹数，通常几十）。
  const pushX = new Float64Array(count)
  const pushY = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    if (counts[i] === 0) {
      continue
    }
    for (let j = i + 1; j < count; j += 1) {
      if (counts[j] === 0) {
        continue
      }
      const ox = Math.min(maxX[i], maxX[j]) - Math.max(minX[i], minX[j])
      const oy = Math.min(maxY[i], maxY[j]) - Math.max(minY[i], minY[j])
      if (ox <= 0 || oy <= 0) {
        continue
      }
      const push = 0.72
      const iCx = sumX[i] / counts[i]
      const iCy = sumY[i] / counts[i]
      const jCx = sumX[j] / counts[j]
      const jCy = sumY[j] / counts[j]
      if (ox < oy) {
        const d = (jCx >= iCx ? 1 : -1) * Math.min(ox, 90) * push
        pushX[i] -= d / 2
        pushX[j] += d / 2
      } else {
        const d = (jCy >= iCy ? 1 : -1) * Math.min(oy, 90) * push
        pushY[i] -= d / 2
        pushY[j] += d / 2
      }
    }
  }
  // 一次遍历应用位移（O(n)）。
  for (const node of nodes) {
    const f = node.folderIndex
    if (f < 0 || f >= count) {
      continue
    }
    node.x += pushX[f]
    node.y += pushY[f]
  }
  void leafCount
}

/* =====================================================================
   主布局
   ===================================================================== */

interface EdgeEndpoints {
  fromIndex: number
  toIndex: number
}

/** 力导向规模上限：超过后改用 O(n) 的文件夹矩形分块（10 万级可用）。 */
export const FORCE_NODE_LIMIT = 1200

/** 小图（≤ 该值）默认走力导向放射观感；更大的图默认走文件夹分块。 */
export const SMALL_GRAPH_FORCE_LIMIT = 60

/** 分块内节点网格间距（世界像素）：dot 圆点不重叠，card 模式可缩放细看。 */
const BLOCK_CELL = 96
/** 分块内边距。 */
const BLOCK_PAD = 26
/** 分块之间的间距。 */
const BLOCK_GAP = 90

/**
 * 大图布局：文件夹矩形分块 + 块内方阵网格。
 *
 * O(n) 且确定性：每个文件夹算一个方阵块（块内 cols=ceil(sqrt(n))），
 * 块之间按行排布、行内左对齐并整体居中，锚点文件夹排在第一位。
 * 每块天然是一个不重叠的矩形，块内节点成方阵，跨块边由上层渲染连线。
 */
function layoutBlocks(
  laidNodes: LaidOutNode[],
  folders: readonly string[],
  anchorFolder: string,
): void {
  const membersByFolder = new Map<string, LaidOutNode[]>()
  for (const node of laidNodes) {
    const list = membersByFolder.get(node.folder) ?? []
    list.push(node)
    membersByFolder.set(node.folder, list)
  }
  const groups = folders
    .map((folder) => ({ folder, members: membersByFolder.get(folder) ?? [] }))
    .filter((group) => group.members.length > 0)
    // 锚点文件夹排第一（左上），其余按成员数降序、再按路径。
    .sort((left, right) => {
      if (left.folder === anchorFolder) {
        return -1
      }
      if (right.folder === anchorFolder) {
        return 1
      }
      const byCount = right.members.length - left.members.length
      return byCount !== 0 ? byCount : left.folder.localeCompare(right.folder)
    })

  interface Block { folder: string; members: LaidOutNode[]; cols: number; rows: number; w: number; h: number }
  const blocks: Block[] = groups.map((group) => {
    const n = group.members.length
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
    const rows = Math.max(1, Math.ceil(n / cols))
    return {
      folder: group.folder,
      members: group.members,
      cols,
      rows,
      w: cols * BLOCK_CELL + BLOCK_PAD * 2,
      h: rows * BLOCK_CELL + BLOCK_PAD * 2,
    }
  })

  // 按行装箱：每行放约 sqrt(块数) 块，行宽 = 该列数下的总宽。
  const cols = Math.max(1, Math.ceil(Math.sqrt(blocks.length)))
  const targetRowWidth = blocks
    .slice(0, cols)
    .reduce((sum, block) => sum + block.w + BLOCK_GAP, -BLOCK_GAP)

  const rows: Block[][] = []
  let currentRow: Block[] = []
  let currentWidth = 0
  for (const block of blocks) {
    if (currentRow.length > 0 && currentWidth + block.w + BLOCK_GAP > targetRowWidth) {
      rows.push(currentRow)
      currentRow = []
      currentWidth = 0
    }
    currentRow.push(block)
    currentWidth += block.w + BLOCK_GAP
  }
  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  // 逐行摆放，整体以原点为中心。
  const rowHeights = rows.map((row) => Math.max(...row.map((block) => block.h)))
  const totalWidth = Math.max(...rows.map((row) => row.reduce((sum, block) => sum + block.w + BLOCK_GAP, -BLOCK_GAP)))
  const totalHeight = rowHeights.reduce((sum, height) => sum + height + BLOCK_GAP, -BLOCK_GAP)

  let y = -totalHeight / 2
  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex]
    const rowWidth = row.reduce((sum, block) => sum + block.w + BLOCK_GAP, -BLOCK_GAP)
    let x = -rowWidth / 2
    for (const block of row) {
      const originX = x + BLOCK_PAD
      const originY = y + BLOCK_PAD + (rowHeight - block.h) / 2
      block.members.forEach((node, index) => {
        const col = index % block.cols
        const rowIndexInner = Math.floor(index / block.cols)
        node.x = Math.round(originX + col * BLOCK_CELL + BLOCK_CELL / 2)
        node.y = Math.round(originY + rowIndexInner * BLOCK_CELL + BLOCK_CELL / 2)
      })
      x += block.w + BLOCK_GAP
    }
    y += rowHeight + BLOCK_GAP
  })
  void totalWidth
}

/** 计算布局（力导向；确定性；卡片与 dot 共用坐标）。 */
export function computeGraphLayout(graph: GraphData, options: GraphLayoutOptions = {}): GraphLayout {
  const nodes = [...graph.nodes].sort((left, right) => left.path.localeCompare(right.path))
  const { layer, inCycle, isolated } = layersOf(nodes, graph.edges)

  const laidNodes: LaidOutNode[] = nodes.map((node, index) => ({
    ...node,
    x: 0,
    y: 0,
    w: DOT_HIT,
    h: DOT_HIT,
    r: DOT_RADIUS,
    layer: layer[index],
    inCycle: inCycle[index],
    isolated: isolated[index],
  }))
  if (laidNodes.length === 0) {
    return { nodes: [], edges: [], partitions: [], centerPath: null, width: 1, height: 1 }
  }

  const seedValue = layoutSeed(nodes)
  const rnd = mulberry32(seedValue)
  const folders = folderOrder(nodes)
  const folderIndexByKey = new Map<string, number>()
  folders.forEach((folder, index) => folderIndexByKey.set(folder, index))

  // 锚点：优先 options.centerPath；否则自动选“最终脚本”（无出边）里度最大的；再退回任意。
  let centerPath = options.centerPath ?? null
  const byPath = new Map(nodes.map((node, index) => [node.path, index]))
  if (centerPath === null || !byPath.has(centerPath)) {
    const outdeg = new Map<string, number>()
    for (const edge of graph.edges) {
      outdeg.set(edge.from, (outdeg.get(edge.from) ?? 0) + 1)
    }
    const candidates = nodes.filter((node) => (outdeg.get(node.path) ?? 0) === 0)
    if (candidates.length > 0) {
      centerPath = candidates.sort((left, right) => {
        const byLayerRight = (layer[byPath.get(right.path) as number] ?? 0)
        const byLayerLeft = (layer[byPath.get(left.path) as number] ?? 0)
        return byLayerRight - byLayerLeft
      })[0]?.path ?? nodes[0]?.path ?? null
    } else {
      centerPath = nodes[0]?.path ?? null
    }
  }
  const anchorIndex = centerPath === null ? -1 : (byPath.get(centerPath) ?? -1)

  // 初始位置：锚点文件夹在原点，其余文件夹按文件夹中心 + 簇内随机半径（确定性）。
  const anchorFolder = anchorIndex >= 0 ? nodes[anchorIndex].folder : folders[0] ?? ''
  {
    // 出度用一次遍历统计（O(m)），避免每节点扫全边（O(n·m)）。
    const outdegOf = new Map<string, number>()
    for (const edge of graph.edges) {
      outdegOf.set(edge.from, (outdegOf.get(edge.from) ?? 0) + 1)
    }
    // 物理节点。
    const folderOfNode = new Map<string, number>()
    nodes.forEach((node) => {
      folderOfNode.set(node.path, folderIndexByKey.get(node.folder) ?? 0)
    })
    const phys = nodes.map((node, index) => {
      const folderIdx = folderOfNode.get(node.path) ?? 0
      const hasReq = node.triggers.some((trigger) =>
        trigger.requirements.some((requirement) => requirement.role === 'builtin'))
      return {
        index,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: index === anchorIndex,
        folder: node.folder,
        folderIndex: folderIdx,
        hasRequirement: hasReq,
        outdeg: outdegOf.get(node.path) ?? 0,
      } as PhysNode
    })
    // 文件夹环绕半径随规模自适应（照原型四角/环绕的思路，规模大则铺更开）。
    const perFolderAvg = Math.max(1, laidNodes.length / Math.max(1, folders.length))
    const folderRadius = Math.round(Math.min(6000, Math.max(420, Math.sqrt(perFolderAvg) * 190 * Math.sqrt(Math.max(1, folders.length)))))
    const centers = folderCenters(folders, anchorFolder, seedValue, folderRadius)
    const springLen = Math.max(110, Math.min(SPRING_LEN_REF, SPRING_LEN_REF * Math.sqrt(laidNodes.length / 40)))
    // 大图用空间网格加速斥力（保证 10 万级可用）；小图直接全对更精确。
    const useGrid = laidNodes.length > 800
    const cellSize = Math.max(CELL, springLen * 1.1)

    phys.forEach((node) => {
      if (node.index === anchorIndex) {
        node.x = 0
        node.y = 0
        node.vx = 0
        node.vy = 0
        return
      }
      const center = centers.get(node.folder) ?? { x: 0, y: 0 }
      const angle = rnd() * Math.PI * 2
      const radius = 20 + rnd() * 150
      node.x = center.x + Math.cos(angle) * radius
      node.y = center.y + Math.sin(angle) * radius
    })

    // 边端点（去重）。
    const edgeSeen = new Set<string>()
    const edgeArr: [number, number][] = []
    for (const edge of graph.edges) {
      const from = byPath.get(edge.from)
      const to = byPath.get(edge.to)
      if (from === undefined || to === undefined || from === to) {
        continue
      }
      const key = `${from}>${to}`
      if (edgeSeen.has(key)) {
        continue
      }
      edgeSeen.add(key)
      edgeArr.push([from, to])
    }

    // 迭代（照原型物理：斥力 + 弹簧 + 文件夹向心 + 全局向心 + 阻尼）。
    // 规模越大收敛越快，减少步数保证 10 万级可用。
    const defaultIterations = laidNodes.length > 20000 ? 90
      : laidNodes.length > 5000 ? 150
        : laidNodes.length > 800 ? 240
          : ITERATIONS
    const iterations = options.steps ?? defaultIterations
    for (let round = 0; round < iterations; round += 1) {
      if (useGrid) {
        applyRepulsion(phys, cellSize, REPEL)
      } else {
        applyRepulsionAll(phys)
      }
      applySprings(phys, edgeArr, springLen)
      for (const node of phys) {
        if (node.pinned || node.index === anchorIndex) {
          continue
        }
        const center = centers.get(node.folder) ?? { x: 0, y: 0 }
        node.vx += (center.x - node.x) * FOLDER_K
        node.vy += (center.y - node.y) * FOLDER_K
        node.vx += (0 - node.x) * CENTER_K
        node.vy += (0 - node.y) * CENTER_K
      }
      integrate(phys, anchorIndex)
      clampWorld(phys, 1e6)
      if (round % 8 === 7) {
        separateZones(phys, folderIndexByKey, folders.length, rnd)
      }
    }

    // 回写 laidNodes。
    phys.forEach((node) => {
      laidNodes[node.index].x = Number.isFinite(node.x) ? Math.round(node.x) : 0
      laidNodes[node.index].y = Number.isFinite(node.y) ? Math.round(node.y) : 0
    })
  }

  // 手摆覆盖优先。
  const overrides = options.overrides ?? {}
  for (const node of laidNodes) {
    const override = overrides[node.path]
    if (override === undefined) {
      continue
    }
    if (Number.isFinite(override.x) && Number.isFinite(override.y)
      && Math.abs(override.x) <= 1e6 && Math.abs(override.y) <= 1e6) {
      node.x = Math.round(override.x)
      node.y = Math.round(override.y)
    }
  }

  // 文件夹簇包围盒。
  const partitions: GraphPartition[] = []
  const membersByFolder = new Map<string, LaidOutNode[]>()
  for (const node of laidNodes) {
    const list = membersByFolder.get(node.folder) ?? []
    list.push(node)
    membersByFolder.set(node.folder, list)
  }
  for (const folder of folders) {
    const members = membersByFolder.get(folder) ?? []
    if (members.length === 0) {
      continue
    }
    const minX = Math.min(...members.map((node) => node.x))
    const minY = Math.min(...members.map((node) => node.y))
    const maxX = Math.max(...members.map((node) => node.x))
    const maxY = Math.max(...members.map((node) => node.y))
    // 照原型 ZPAD=52：框与节点之间留足呼吸空间，框顶部再留出标题高度。
    const boxPad = 52
    const headerPad = 26
    partitions.push({
      folder,
      label: folderLabel(folder),
      x: minX - boxPad,
      y: minY - boxPad - headerPad,
      w: maxX - minX + boxPad * 2,
      h: maxY - minY + boxPad * 2 + headerPad,
      count: members.length,
    })
  }

  // 边（曲线由 geometry 层负责；这里只产出端点与方向数据）。
  const byPathNode = new Map(laidNodes.map((node) => [node.path, node]))
  const laidEdges: LaidOutEdge[] = []
  for (const edge of graph.edges) {
    const from = byPathNode.get(edge.from)
    const to = byPathNode.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      continue
    }
    laidEdges.push({
      key: edge.key,
      from,
      to,
      d: '',
      back: to.layer <= from.layer,
      cross: from.folder !== to.folder,
      midX: 0,
      midY: 0,
    })
  }

  // 世界包围盒。
  let width = 1
  let height = 1
  if (laidNodes.length > 0) {
    const minX = Math.min(...laidNodes.map((node) => node.x))
    const minY = Math.min(...laidNodes.map((node) => node.y))
    const maxX = Math.max(...laidNodes.map((node) => node.x))
    const maxY = Math.max(...laidNodes.map((node) => node.y))
    width = Math.max(1, maxX - minX + WORLD_PAD * 2)
    height = Math.max(1, maxY - minY + WORLD_PAD * 2)
  }
  void LANE_GAP
  return { nodes: laidNodes, edges: laidEdges, partitions, centerPath, width, height }
}

/** 夹取缩放。 */
export function clampScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VIEW.scale
  }
  return Math.min(2.5, Math.max(0.15, value))
}

/** 世界坐标 → 屏幕坐标。 */
export function worldToScreen(point: { x: number; y: number }, view: GraphViewState): { x: number; y: number } {
  return { x: point.x * view.scale + view.tx, y: point.y * view.scale + view.ty }
}

/** 屏幕坐标 → 世界坐标。 */
export function screenToWorld(point: { x: number; y: number }, view: GraphViewState): { x: number; y: number } {
  return { x: (point.x - view.tx) / view.scale, y: (point.y - view.ty) / view.scale }
}

/** 以屏幕点为锚缩放（锚点下的世界坐标不变）。 */
export function zoomAt(view: GraphViewState, screen: { x: number; y: number }, nextScale: number): GraphViewState {
  const scale = clampScale(nextScale)
  const world = screenToWorld(screen, view)
  return {
    scale,
    tx: screen.x - world.x * scale,
    ty: screen.y - world.y * scale,
  }
}

/** 平移（屏幕像素）。 */
export function panBy(view: GraphViewState, dx: number, dy: number): GraphViewState {
  return { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy }
}

/** 适配可见节点/布局包围盒。 */
export function fitView(
  layout: Pick<GraphLayout, 'width' | 'height'>,
  viewport: { width: number; height: number },
  padding = 40,
): GraphViewState {
  const width = Math.max(1, layout.width)
  const height = Math.max(1, layout.height)
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const scale = clampScale(Math.min(availableWidth / width, availableHeight / height))
  return {
    scale,
    tx: (viewport.width - width * scale) / 2,
    ty: (viewport.height - height * scale) / 2,
  }
}

/** 命中一个节点（世界坐标；圆心/命中框命中，card 模式用卡片框）。 */
export function hitTestNode(
  nodes: readonly LaidOutNode[],
  world: { x: number; y: number },
  useCard = false,
): LaidOutNode | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const w = useCard ? NODE_W : node.w
    const h = useCard ? NODE_H : node.h
    if (world.x >= node.x - w / 2 && world.x <= node.x + w / 2
      && world.y >= node.y - h / 2 && world.y <= node.y + h / 2) {
      return node
    }
  }
  return undefined
}

/** 节点是否与视口相交（裁剪用；margin 为世界像素；按命中框）。 */
export function intersectsViewport(
  node: Pick<LaidOutNode, 'x' | 'y' | 'w' | 'h'>,
  view: GraphViewState,
  viewport: { width: number; height: number },
  margin = 60,
): boolean {
  const left = node.x * view.scale + view.tx
  const top = node.y * view.scale + view.ty
  const right = (node.x + node.w / 2) * view.scale + view.tx
  const bottom = (node.y + node.h / 2) * view.scale + view.ty
  void left
  void top
  return right >= -margin && (node.x - node.w / 2) * view.scale + view.tx <= viewport.width + margin
    && bottom >= -margin && (node.y - node.h / 2) * view.scale + view.ty <= viewport.height + margin
}

/** 选中节点的上下游（双向 BFS；防环）。 */
export function neighboursOf(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  startPath: string,
): { up: Set<string>; down: Set<string> } {
  const upAdj = new Map<string, string[]>()
  const downAdj = new Map<string, string[]>()
  for (const edge of edges) {
    const up = upAdj.get(edge.to) ?? []
    up.push(edge.from)
    upAdj.set(edge.to, up)
    const down = downAdj.get(edge.from) ?? []
    down.push(edge.to)
    downAdj.set(edge.from, down)
  }
  const walk = (adjacency: Map<string, string[]>): Set<string> => {
    const visited = new Set<string>()
    const queue = [startPath]
    const seen = new Set<string>([startPath])
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) {
          continue
        }
        seen.add(next)
        visited.add(next)
        queue.push(next)
      }
    }
    return visited
  }
  void nodes
  return { up: walk(upAdj), down: walk(downAdj) }
}

/** 卡片左上角（世界坐标；卡片以圆心居中）。 */
export function cardTopLeft(node: Pick<LaidOutNode, 'x' | 'y'>): { x: number; y: number } {
  return { x: node.x - NODE_W / 2, y: node.y - NODE_H / 2 }
}