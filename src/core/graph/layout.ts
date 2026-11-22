/**
 * 05-02 / 05-04 图布局：确定性力导向 + 文件夹簇 + 手摆覆盖 + 锚点中心。
 *
 * 用户指令（05 轮中明确覆盖 `plan/05/05-02` 的“确定性分层、非力导向”）：
 *   1. 以「最终脚本 / 起始脚本」（锚点）为中心向外散发，不再是泳道网格；
 *   2. 每个文件夹一个「框」（簇），框内是该文件夹的脚本，按脚本关系自然连线；
 *   3. 圆点和卡片使用同一套算法，按各自尺寸预留分组空间；
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

/** 目录框标题栏高度（世界像素）；节点拖动不得进入此安全区。 */
export const PARTITION_HEADER_H = 30

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
  /** 0 = 只做 O(n) 快速摆放，不跑物理；>0 = 跑 N 步力导向。缺省按规模自适应。 */
  steps?: number
  /** 只对这些 path 的节点做物理迭代；其余节点坐标固定不动。缺省 = 全部。 */
  focusPaths?: ReadonlySet<string>
  /**
   * 分批加载：只布局 `order` 的前 `limit` 个节点（缺省 = 全部）。
   *
   * 大图先用小批量立即出图（核心可见），随后逐批放大直到全量；
   * 切片外的边自动丢弃，因此调用方不需要自己裁剪边集。
   */
  limit?: number
  /**
   * 分批顺序（path 列表，越靠前越先布局）。缺省按 path 字典序。
   *
   * 控制器传「从锚点 BFS 展开」的顺序，让首批 = 锚点及其直接关联（真正的核心），
   * 而不是字典序前缀那种与可见性无关的切片。
   */
  order?: readonly string[]
  /** 命中框尺寸：圆点或卡片。目录框按此尺寸给手摆节点留边。 */
  nodeSize?: 'dot' | 'card'
}

/** 布局后的节点（x/y 为圆心，w/h 为命中框，r 为圆点半径）。 */
export interface LaidOutNode extends GraphNode {
  x: number
  y: number
  w: number
  h: number
  r: number
  layer: number
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

/** 布局结果。 */
export interface GraphLayout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  partitions: GraphPartition[]
  /** 当前锚点节点（力导向中心；可能 null）。 */
  centerPath: string | null
  width: number
  height: number
}

/** 将节点圆心限制在文件夹正文内，给节点命中框与标题留出空间。 */
export function positionInPartition(
  partition: GraphPartition,
  node: Pick<LaidOutNode, 'w' | 'h'>,
  x: number,
  y: number,
): { x: number; y: number } {
  const halfWidth = node.w / 2
  const halfHeight = node.h / 2
  return {
    x: Math.max(partition.x + halfWidth, Math.min(partition.x + partition.w - halfWidth, x)),
    y: Math.max(partition.y + PARTITION_HEADER_H + halfHeight, Math.min(partition.y + partition.h - halfHeight, y)),
  }
}

/** 目录标签。 */
export function folderLabel(folder: string): string {
  return folder === '' ? 'scripts' : folder
}

/**
 * 计算每个节点的层（DAG 最长路径）与孤立标记。
 *
 * 图由 `buildGraph` 保证是 DAG（成环的边在索引阶段就被丢弃），所以这里不需要 SCC：
 * 直接对已去重的 CSR 邻接跑一次 Kahn 拓扑 + 最长路径即可，O(n + m)。
 * 全程定长 TypedArray：10 万节点/20 万边下不分配「每节点一个数组或 Set」，
 * 这是 `steps: 0` 快速摆放能在 1 秒内跑完的前提。
 */
function layersOf(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): {
  layer: Int32Array
  isolated: Uint8Array
} {
  const count = nodes.length
  const indexOf = new Map<string, number>()
  for (let index = 0; index < count; index += 1) {
    indexOf.set(nodes[index].path, index)
  }
  // 第一遍：原始出度计数（含重复边与自环，随后按节点切片去重）。
  const rawOffsets = new Int32Array(count + 1)
  for (const edge of edges) {
    const from = indexOf.get(edge.from)
    if (from === undefined || indexOf.get(edge.to) === undefined || edge.from === edge.to) {
      continue
    }
    rawOffsets[from + 1] += 1
  }
  for (let index = 0; index < count; index += 1) {
    rawOffsets[index + 1] += rawOffsets[index]
  }
  const rawTargets = new Int32Array(rawOffsets[count])
  const cursor = rawOffsets.slice(0, count)
  for (const edge of edges) {
    const from = indexOf.get(edge.from)
    const to = indexOf.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      continue
    }
    rawTargets[cursor[from]] = to
    cursor[from] += 1
  }

  // 第二遍：按节点切片去重（度数很小，线性扫描比 Set 更快），同时统计入度。
  const offsets = new Int32Array(count + 1)
  const incoming = new Int32Array(count)
  const outgoing = new Int32Array(count)
  let write = 0
  for (let node = 0; node < count; node += 1) {
    offsets[node] = write
    const start = rawOffsets[node]
    const end = rawOffsets[node + 1]
    for (let at = start; at < end; at += 1) {
      const target = rawTargets[at]
      let duplicate = false
      for (let seen = start; seen < at; seen += 1) {
        if (rawTargets[seen] === target) {
          duplicate = true
          break
        }
      }
      if (duplicate) {
        continue
      }
      rawTargets[write] = target
      write += 1
      outgoing[node] += 1
      incoming[target] += 1
    }
  }
  offsets[count] = write
  const successors = rawTargets.subarray(0, write)

  // 基线层：含内置前置的节点从 1 起（与 05-02 的分层语义一致）。
  const layer = new Int32Array(count)
  const hasRequirement = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    const found = nodes[index].triggers.some((trigger) =>
      trigger.requirements.some((requirement) => requirement.role === 'builtin'))
    if (!found) {
      continue
    }
    hasRequirement[index] = 1
    layer[index] = 1
  }

  // Kahn 拓扑推进（队列用 Int32Array，避免 shift 的 O(n) 移动），取最长路径。
  const queue = new Int32Array(count)
  const indegree = incoming.slice()
  let head = 0
  let tail = 0
  for (let index = 0; index < count; index += 1) {
    if (indegree[index] === 0) {
      queue[tail] = index
      tail += 1
    }
  }
  while (head < tail) {
    const node = queue[head]
    head += 1
    const candidate = layer[node] + 1
    for (let at = offsets[node]; at < offsets[node + 1]; at += 1) {
      const next = successors[at]
      if (candidate > layer[next]) {
        layer[next] = candidate
      }
      indegree[next] -= 1
      if (indegree[next] === 0) {
        queue[tail] = next
        tail += 1
      }
    }
  }

  const isolated = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    if (incoming[index] === 0 && outgoing[index] === 0 && hasRequirement[index] === 0) {
      isolated[index] = 1
    }
  }
  return { layer, isolated }
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
   力导向物理（空间网格近近似斥力，确定性）
   ===================================================================== */

interface PhysNode {
  index: number
  x: number
  y: number
  vx: number
  vy: number
  pinned: boolean
  folderIndex: number
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

/**
 * 文件夹中心：锚点文件夹在原点，其余绕一圈（半径随节点数自适应）。
 *
 * 返回与 `folders` 同序的数组：快速摆放与物理循环都按下标取，不再查 Map。
 */
function folderCenters(
  folderOrderList: readonly string[],
  anchorFolder: string,
  radius: number,
): { x: number; y: number }[] {
  const others = folderOrderList.filter((folder) => folder !== anchorFolder)
  const centers: { x: number; y: number }[] = folderOrderList.map((folder) => {
    if (folder === anchorFolder) {
      return { x: 0, y: 0 }
    }
    const index = others.indexOf(folder)
    const angle = (index / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2
    return {
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
    }
  })
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
function applyRepulsionAll(nodes: readonly PhysNode[], focus: Uint8Array | null): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      repel(nodes[i], nodes[j], focus)
    }
  }
}

/** 一轮斥力：空间网格近似，只算 3x3 邻域格子内的节点对（大图用）。 */
function applyRepulsion(nodes: readonly PhysNode[], cell: number, focus: Uint8Array | null): void {
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
        repel(nodes[list[a]], nodes[list[b]], focus)
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
          repel(A, nodes[bi], focus)
        }
      }
    }
  }
}

/**
 * 一对斥力。
 *
 * `focus` 为 null 时两端都受力；否则只有焦点节点累积速度——非焦点节点当静态障碍物，
 * 坐标始终不动（视口外节点在动画期间必须冻结）。
 */
function repel(A: PhysNode, B: PhysNode, focus: Uint8Array | null): void {
  if (focus !== null && focus[A.index] === 0 && focus[B.index] === 0) {
    return
  }
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
  if (focus === null || focus[A.index] === 1) {
    A.vx -= ux * f
    A.vy -= uy * f
  }
  if (focus === null || focus[B.index] === 1) {
    B.vx += ux * f
    B.vy += uy * f
  }
}

/** 一轮弹簧、文件夹向心、锚点向心。 */
function applySprings(
  nodes: readonly PhysNode[],
  edges: readonly [number, number][],
  springLen: number,
  focus: Uint8Array | null,
): void {
  for (const [from, to] of edges) {
    const A = nodes[from]
    const B = nodes[to]
    const aActive = focus === null || focus[A.index] === 1
    const bActive = focus === null || focus[B.index] === 1
    if (!aActive && !bActive) {
      continue
    }
    const dx = B.x - A.x
    const dy = B.y - A.y
    const d = Math.hypot(dx, dy) || 1
    const ux = dx / d
    const uy = dy / d
    // 同文件夹强弹簧（簇内紧凑），跨文件夹弱弹簧（只表达关系、不拉扁簇）。
    const k = A.folderIndex === B.folderIndex ? SPRING_K : SPRING_K_CROSS
    const f = (d - springLen) * k
    if (aActive) {
      A.vx += ux * f
      A.vy += uy * f
    }
    if (bActive) {
      B.vx -= ux * f
      B.vy -= uy * f
    }
  }
}

function integrate(nodes: readonly PhysNode[], focus: Uint8Array | null): void {
  for (const node of nodes) {
    if (node.pinned) {
      node.vx = 0
      node.vy = 0
      continue
    }
    if (focus !== null && focus[node.index] === 0) {
      // 非焦点节点坐标冻结：速度不积分（否则视口外节点会跟着漂）。
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
function separateZones(nodes: readonly PhysNode[], folderIndexByKey: Map<string, number>): void {
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
}

/* =====================================================================
   主布局
   ===================================================================== */

/** 簇内网格间距（世界像素）：卡片与圆点分别避免命中框重叠。 */
const PLACE_CELL_DOT = 90
const PLACE_CELL_CARD_W = 220
const PLACE_CELL_CARD_H = 96

/**
 * O(n) 快速摆放：每个文件夹一个方阵簇，簇心由 `folderCenters` 给出（锚点文件夹在原点）。
 *
 * 只做两次线性遍历（计数排序分桶 + 写坐标），不跑物理迭代、不建 Map 桶：
 * `steps === 0` 时这就是全图坐标，10 万节点也能在 1 秒内出图。
 * 确定性：桶内顺序 = 节点排序后的顺序，不用随机数。
 */
function initialPlacement(
  laidNodes: readonly LaidOutNode[],
  folderIndexByKey: Map<string, number>,
  centers: readonly { x: number; y: number }[],
  cellWidth: number,
  cellHeight: number,
): void {
  const count = laidNodes.length
  const folderCount = centers.length
  // 每个文件夹的成员数（计数排序的第一遍）。
  const sizes = new Int32Array(folderCount)
  for (let index = 0; index < count; index += 1) {
    const slot = folderIndexByKey.get(laidNodes[index].folder) ?? 0
    sizes[slot] += 1
  }
  // 每列/每行数按簇大小定，随后把位置写进 order（第二遍）。
  const offsets = new Int32Array(folderCount + 1)
  for (let slot = 0; slot < folderCount; slot += 1) {
    offsets[slot + 1] = offsets[slot] + sizes[slot]
  }
  const order = new Int32Array(count)
  const cursor = offsets.slice(0, folderCount)
  for (let index = 0; index < count; index += 1) {
    const slot = folderIndexByKey.get(laidNodes[index].folder) ?? 0
    order[cursor[slot]] = index
    cursor[slot] += 1
  }
  for (let slot = 0; slot < folderCount; slot += 1) {
    const size = sizes[slot]
    if (size === 0) {
      continue
    }
    const center = centers[slot]
    const cols = Math.max(1, Math.ceil(Math.sqrt(size)))
    const rows = Math.max(1, Math.ceil(size / cols))
    const originX = center.x - ((cols - 1) / 2) * cellWidth
    const originY = center.y - ((rows - 1) / 2) * cellHeight
    for (let at = offsets[slot]; at < offsets[slot + 1]; at += 1) {
      const node = laidNodes[order[at]]
      const position = at - offsets[slot]
      const col = position % cols
      const row = (position - col) / cols
      node.x = Math.round(originX + col * cellWidth)
      node.y = Math.round(originY + row * cellHeight)
    }
  }
}

/**
 * `focusPaths` → 按 laidNodes 索引的 0/1 掩码；缺省（未给 focusPaths）返回 null = 全部参与物理。
 *
 * 给定焦点集后，物理只改焦点节点：视口外节点坐标原地不动（布局层与动画解耦）。
 */
function focusMaskOf(
  focusPaths: ReadonlySet<string> | undefined,
  byPath: Map<string, number>,
): Uint8Array | null {
  if (focusPaths === undefined) {
    return null
  }
  const mask = new Uint8Array(byPath.size)
  for (const path of focusPaths) {
    const index = byPath.get(path)
    if (index !== undefined) {
      mask[index] = 1
    }
  }
  return mask
}

/** 缺省迭代步数：规模越大收敛越快，减少步数保证 10 万级可用。 */
function defaultSteps(count: number): number {
  return count > 20000 ? 90 : count > 5000 ? 150 : count > 800 ? 240 : ITERATIONS
}

/** 路径比较：码点序（比 `localeCompare` 快 3 倍以上，10 万节点排序省 ~120ms）。 */
function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** 计算布局（确定性；卡片与 dot 共用坐标）。`steps: 0` 只做 O(n) 快速摆放。 */
export function computeGraphLayout(graph: GraphData, options: GraphLayoutOptions = {}): GraphLayout {
  const allNodes = [...graph.nodes].sort((left, right) => comparePath(left.path, right.path))
  // 分批加载：按 `order` 取前 `limit` 个节点；切片外的边自然丢弃。
  const limit = options.limit
  const order = options.order
  const nodes = (() => {
    if (limit === undefined || limit >= allNodes.length) {
      return allNodes
    }
    const take = Math.max(0, limit)
    if (order === undefined) {
      return allNodes.slice(0, take)
    }
    const byPathAll = new Map(allNodes.map((node) => [node.path, node]))
    const picked: GraphNode[] = []
    const seen = new Set<string>()
    for (const path of order) {
      if (picked.length >= take) {
        break
      }
      const node = byPathAll.get(path)
      if (node === undefined || seen.has(path)) {
        continue
      }
      seen.add(path)
      picked.push(node)
    }
    // 兜底：order 覆盖不全时用字典序补齐，保证批次数达到 limit。
    for (const node of allNodes) {
      if (picked.length >= take) {
        break
      }
      if (seen.has(node.path)) {
        continue
      }
      seen.add(node.path)
      picked.push(node)
    }
    return picked.sort((left, right) => comparePath(left.path, right.path))
  })()
  const included = nodes.length === allNodes.length
    ? null
    : new Set(nodes.map((node) => node.path))
  const edges = included === null
    ? graph.edges
    : graph.edges.filter((edge) => included.has(edge.from) && included.has(edge.to))
  const { layer, isolated } = layersOf(nodes, edges)

  const nodeSize = options.nodeSize === 'card' ? 'card' : 'dot'
  const hitWidth = nodeSize === 'card' ? NODE_W : DOT_HIT
  const hitHeight = nodeSize === 'card' ? NODE_H : DOT_HIT
  const laidNodes: LaidOutNode[] = nodes.map((node, index) => ({
    ...node,
    x: 0,
    y: 0,
    w: hitWidth,
    h: hitHeight,
    r: DOT_RADIUS,
    layer: layer[index],
    isolated: isolated[index] === 1,
  }))
  if (laidNodes.length === 0) {
    return { nodes: [], edges: [], partitions: [], centerPath: null, width: 1, height: 1 }
  }

  const folders = folderOrder(nodes)
  const folderIndexByKey = new Map<string, number>()
  folders.forEach((folder, index) => folderIndexByKey.set(folder, index))

  // 锚点：优先 options.centerPath；否则自动选“最终脚本”（无出边）里层最大的；再退回任意。
  let centerPath = options.centerPath ?? null
  const byPath = new Map(nodes.map((node, index) => [node.path, index]))
  if (centerPath === null || !byPath.has(centerPath)) {
    // 出度按索引统计（Int32Array，避免 10 万个字符串 Map 条目）。
    const outdeg = new Int32Array(nodes.length)
    for (const edge of edges) {
      const from = byPath.get(edge.from)
      if (from !== undefined) {
        outdeg[from] += 1
      }
    }
    // 单次扫描取「层最大」的第一个（节点已按 path 排序，等价于原稳定降序排序取首）。
    let bestIndex = -1
    let bestLayer = -1
    for (let index = 0; index < nodes.length; index += 1) {
      if (outdeg[index] !== 0) {
        continue
      }
      if (layer[index] > bestLayer) {
        bestLayer = layer[index]
        bestIndex = index
      }
    }
    centerPath = bestIndex >= 0 ? nodes[bestIndex].path : nodes[0]?.path ?? null
  }
  const anchorIndex = centerPath === null ? -1 : (byPath.get(centerPath) ?? -1)
  const anchorFolder = anchorIndex >= 0 ? nodes[anchorIndex].folder : folders[0] ?? ''

  // 文件夹环绕半径随规模自适应（照原型四角/环绕的思路，规模大则铺更开）。
  const perFolderAvg = Math.max(1, laidNodes.length / Math.max(1, folders.length))
  const cellWidth = nodeSize === 'card' ? PLACE_CELL_CARD_W : PLACE_CELL_DOT
  const cellHeight = nodeSize === 'card' ? PLACE_CELL_CARD_H : PLACE_CELL_DOT
  const radiusUnit = Math.max(cellWidth, cellHeight) * (nodeSize === 'card' ? 1.7 : 1.65)
  const folderRadius = Math.round(Math.max(600, Math.sqrt(perFolderAvg) * radiusUnit * Math.sqrt(Math.max(1, folders.length))))
  const centers = folderCenters(folders, anchorFolder, folderRadius)

  // 第一步：O(n) 快速摆放；小图随后跑一次性力导向，大图仍走快速布局。
  initialPlacement(laidNodes, folderIndexByKey, centers, cellWidth, cellHeight)
  const iterations = options.steps ?? defaultSteps(laidNodes.length)

  if (iterations > 0) {
    const focus = focusMaskOf(options.focusPaths, byPath)
    // 物理节点（坐标取快速摆放结果）。
    const phys = laidNodes.map((node, index) => ({
      index,
      x: node.x,
      y: node.y,
      vx: 0,
      vy: 0,
      pinned: index === anchorIndex,
      folderIndex: folderIndexByKey.get(node.folder) ?? 0,
    } as PhysNode))
    // 边端点（去重）。
    const edgeSeen = new Set<string>()
    const edgeArr: [number, number][] = []
    for (const edge of edges) {
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
    const springLen = Math.max(110, Math.min(SPRING_LEN_REF, SPRING_LEN_REF * Math.sqrt(laidNodes.length / 40)))
    // 大图用空间网格加速斥力（保证 10 万级可用）；小图直接全对更精确。
    const useGrid = laidNodes.length > 800
    const cellSize = Math.max(CELL, springLen * 1.1)

    // 迭代（照原型物理：斥力 + 弹簧 + 文件夹向心 + 全局向心 + 阻尼）。
    for (let round = 0; round < iterations; round += 1) {
      if (useGrid) {
        applyRepulsion(phys, cellSize, focus)
      } else {
        applyRepulsionAll(phys, focus)
      }
      applySprings(phys, edgeArr, springLen, focus)
      for (const node of phys) {
        if (node.pinned) {
          continue
        }
        if (focus !== null && focus[node.index] === 0) {
          continue
        }
        const center = centers[node.folderIndex] ?? { x: 0, y: 0 }
        node.vx += (center.x - node.x) * FOLDER_K
        node.vy += (center.y - node.y) * FOLDER_K
        node.vx += (0 - node.x) * CENTER_K
        node.vy += (0 - node.y) * CENTER_K
      }
      integrate(phys, focus)
      clampWorld(phys, 1e6)
      // 簇框分离会整体平移文件夹（含非焦点节点），焦点模式下一律跳过。
      if (focus === null && round % 8 === 7) {
        separateZones(phys, folderIndexByKey)
      }
    }

    // 回写 laidNodes。
    phys.forEach((node) => {
      laidNodes[node.index].x = Number.isFinite(node.x) ? Math.round(node.x) : 0
      laidNodes[node.index].y = Number.isFinite(node.y) ? Math.round(node.y) : 0
    })
  }

  // 文件夹簇包围盒只按自动坐标生成；手摆坐标后应用并夹回框内，避免框逐次变大。
  const partitions: GraphPartition[] = []
  const folderCount = folders.length
  const minXs = new Float64Array(folderCount).fill(Number.POSITIVE_INFINITY)
  const minYs = new Float64Array(folderCount).fill(Number.POSITIVE_INFINITY)
  const maxXs = new Float64Array(folderCount).fill(Number.NEGATIVE_INFINITY)
  const maxYs = new Float64Array(folderCount).fill(Number.NEGATIVE_INFINITY)
  const counts = new Int32Array(folderCount)
  for (const node of laidNodes) {
    const slot = folderIndexByKey.get(node.folder)
    if (slot === undefined) {
      continue
    }
    if (node.x < minXs[slot]) minXs[slot] = node.x
    if (node.y < minYs[slot]) minYs[slot] = node.y
    if (node.x > maxXs[slot]) maxXs[slot] = node.x
    if (node.y > maxYs[slot]) maxYs[slot] = node.y
    counts[slot] += 1
  }
  for (let slot = 0; slot < folderCount; slot += 1) {
    if (counts[slot] === 0) {
      continue
    }
    const minX = minXs[slot]
    const minY = minYs[slot]
    const maxX = maxXs[slot]
    const maxY = maxYs[slot]
    // 每个目录框只由显式布局生成一次；按真实命中框留边，节点拖动后不会被重算覆盖。
    const boxPad = 52
    const headerPad = PARTITION_HEADER_H
    const halfW = hitWidth / 2
    const halfH = hitHeight / 2
    partitions.push({
      folder: folders[slot],
      label: folderLabel(folders[slot]),
      x: minX - halfW - boxPad,
      y: minY - halfH - boxPad - headerPad,
      w: maxX - minX + hitWidth + boxPad * 2,
      h: maxY - minY + hitHeight + boxPad * 2 + headerPad,
      count: counts[slot],
    })
  }

  // 手摆覆盖优先，但只按自动框夹取显示坐标；原始覆盖值不改写。
  const overrides = options.overrides ?? {}
  const partitionByFolder = new Map(partitions.map((partition) => [partition.folder, partition]))
  for (const node of laidNodes) {
    const override = overrides[node.path]
    if (override === undefined) {
      continue
    }
    if (!Number.isFinite(override.x) || !Number.isFinite(override.y)
      || Math.abs(override.x) > 1e6 || Math.abs(override.y) > 1e6) {
      continue
    }
    const box = partitionByFolder.get(node.folder)
    if (box === undefined) continue
    const position = positionInPartition(box, node, override.x, override.y)
    node.x = position.x
    node.y = position.y
  }

  // 边（曲线由 geometry 层负责；这里只产出端点与方向数据）。
  const byPathNode = new Map(laidNodes.map((node) => [node.path, node]))
  const laidEdges: LaidOutEdge[] = []
  for (const edge of edges) {
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

  // 世界包围盒（复用上面的文件夹聚合值，不再遍历一遍 10 万节点）。
  let width = 1
  let height = 1
  {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let slot = 0; slot < folderCount; slot += 1) {
      if (counts[slot] === 0) {
        continue
      }
      if (minXs[slot] < minX) minX = minXs[slot]
      if (minYs[slot] < minY) minY = minYs[slot]
      if (maxXs[slot] > maxX) maxX = maxXs[slot]
      if (maxYs[slot] > maxY) maxY = maxYs[slot]
    }
    if (Number.isFinite(minX) && Number.isFinite(minY)) {
      width = Math.max(1, maxX - minX + WORLD_PAD * 2)
      height = Math.max(1, maxY - minY + WORLD_PAD * 2)
    }
  }
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
