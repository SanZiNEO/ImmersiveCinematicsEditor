/**
 * 图布局调度（06-12 拆分：只承担"布局与动画调度"这一类状态）。
 *
 * 从 `core.script-graph/state.ts` 抽出：分批布局、分批顺序（按关系距离 BFS）、
 * 视口内力导向动画帧、视口变化后的重启动画。控制器只保留"什么时候要重算"的判断，
 * 具体调度由本模块负责。
 *
 * 变化理由：布局算法参数、分批策略、动画节流策略变化。文档或选区变化不会改这里。
 */
import type { GraphData } from '../../core/graph/types.ts'
import type { GraphLayout, GraphNodePosition } from '../../core/graph/layout.ts'
import { computeGraphLayout } from '../../core/graph/layout.ts'

/**
 * 首批布局的节点数上限：这批必须先出图（用户口径：核心展示部分控制在时间内）。
 *
 * 10 万节点的图先排前 1500 个节点，坐标立刻可见；其余节点按 {@link LAYOUT_BATCH_GROWTH}
 * 逐批补入，每批之间让出事件循环，不阻塞交互。
 */
export const LAYOUT_FIRST_BATCH = 1500

/** 批次增长系数。 */
export const LAYOUT_BATCH_GROWTH = 3

/** 批次之间的让出延迟（毫秒）。 */
export const LAYOUT_BATCH_DELAY = 16

/** 视口变化后重启动画的防抖（毫秒）。 */
export const VIEWPORT_ANIMATION_DELAY = 300

/** 世界包围盒。 */
export interface WorldBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 调度器依赖：由控制器注入"当前是否仍有效"的判断与状态写入。 */
export interface LayoutSchedulerDeps {
  /** 当前图（用于丢弃过期批次）。 */
  graph: () => GraphData | null
  /** 当前布局（用于取锚点）。 */
  layout: () => GraphLayout | null
  /** 是否仍挂载（卸载后停止推进）。 */
  mounted: () => boolean
  /** 是否允许动画。 */
  animate: () => boolean
  /** 手动坐标覆盖。 */
  overrides: () => Record<string, GraphNodePosition>
  /** 视口世界包围盒。 */
  worldBox: () => WorldBox
  /** 写入新布局。 */
  publish: (layout: GraphLayout) => void
  /** 首批出图后的回调（居中到锚点）。 */
  onFirstBatch?: () => void
}

/** 分批顺序缓存（按 graph 引用失效）。 */
interface OrderCache {
  graph: GraphData
  order: string[]
}

/** 布局调度器：分批出图 + 视口内力导向动画。 */
export class LayoutScheduler {
  private readonly deps: LayoutSchedulerDeps
  private batchTimer: ReturnType<typeof setTimeout> | undefined
  private animationTimer: number | null = null
  private viewportTimer: ReturnType<typeof setTimeout> | undefined
  private orderCache: OrderCache | null = null

  constructor(deps: LayoutSchedulerDeps) {
    this.deps = deps
  }

  /** 全量重算：首批立即出图，其余逐批补入，视口内跑力导向。 */
  recompute(): void {
    const graph = this.deps.graph()
    this.stopAnimation()
    this.stopBatch()
    if (graph === null) {
      return
    }
    const overrides = this.deps.overrides()
    const total = graph.nodes.length
    const order = this.order(graph)
    const firstLimit = Math.min(total, LAYOUT_FIRST_BATCH)
    const base = computeGraphLayout(graph, { overrides, steps: 0, limit: firstLimit, order })
    this.deps.publish(base)
    this.deps.onFirstBatch?.()
    if (this.deps.animate()) {
      this.startAnimation(graph, overrides, base, this.deps.worldBox())
    }
    if (firstLimit < total) {
      this.scheduleBatch(graph, overrides, firstLimit)
    }
  }

  /** 逐批放大布局范围：每批之间让出事件循环，不阻塞交互。 */
  private scheduleBatch(
    graph: GraphData,
    overrides: Record<string, GraphNodePosition>,
    done: number,
  ): void {
    const total = graph.nodes.length
    const next = Math.min(total, Math.max(done + 1, Math.ceil(done * LAYOUT_BATCH_GROWTH)))
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined
      if (!this.deps.mounted() || this.deps.graph() !== graph) {
        return
      }
      const batch = computeGraphLayout(graph, {
        overrides,
        steps: 0,
        limit: next,
        order: this.order(graph),
      })
      this.deps.publish(batch)
      if (next < total) {
        this.scheduleBatch(graph, overrides, next)
        return
      }
      if (this.deps.animate()) {
        // 全量到齐后，按最终坐标重新起一轮视口内力导向。
        this.startAnimation(graph, overrides, batch, this.deps.worldBox())
      }
    }, LAYOUT_BATCH_DELAY)
  }

  /**
   * 分批顺序：从锚点出发按关系距离（无向 BFS）展开，剩余节点按 path 补齐。
   *
   * 这样首批就是锚点及其直接上下游——用户真正要看的核心；字典序前缀做不到这一点。
   * 每张图只算一次（按 graph 引用缓存），后续批次复用。
   */
  order(graph: GraphData): string[] {
    const cached = this.orderCache
    if (cached !== null && cached.graph === graph) {
      return cached.order
    }
    const adjacency = new Map<string, string[]>()
    const link = (from: string, to: string): void => {
      const list = adjacency.get(from)
      if (list === undefined) {
        adjacency.set(from, [to])
        return
      }
      list.push(to)
    }
    for (const edge of graph.edges) {
      link(edge.from, edge.to)
      link(edge.to, edge.from)
    }
    const layout = this.deps.layout()
    // 锚点：已有布局且属于同一张图时复用其 centerPath；否则取「无出边」的首个节点
    // （等价于自动锚点的"最终脚本"语义），避免首批从字典序首节点这种任意起点展开。
    let anchor: string | null = layout?.centerPath ?? null
    if (anchor === null || !graph.nodes.some((node) => node.path === anchor)) {
      const hasOut = new Set<string>()
      for (const edge of graph.edges) {
        hasOut.add(edge.from)
      }
      const finals = [...graph.nodes]
        .filter((node) => !hasOut.has(node.path))
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      anchor = finals[0]?.path ?? graph.nodes[0]?.path ?? null
    }
    const result: string[] = []
    const seen = new Set<string>()
    if (anchor !== null) {
      const queue = [anchor]
      seen.add(anchor)
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head]
        result.push(current)
        for (const next of adjacency.get(current) ?? []) {
          if (seen.has(next)) {
            continue
          }
          seen.add(next)
          queue.push(next)
        }
      }
    }
    const rest = [...graph.nodes].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    for (const node of rest) {
      if (!seen.has(node.path)) {
        seen.add(node.path)
        result.push(node.path)
      }
    }
    this.orderCache = { graph, order: result }
    return result
  }

  /** 该图的收敛步数（与 layout.ts 的默认值保持一致）。 */
  private forceSteps(graph: GraphData): number {
    const count = graph.nodes.length
    return count > 20000 ? 90 : count > 5000 ? 150 : count > 800 ? 240 : 420
  }

  /** 落在世界包围盒外扩 `margin` 内的节点（力导向只动这些）。 */
  private focusPaths(layout: GraphLayout, worldBox: WorldBox, margin = 600): Set<string> {
    const focus = new Set<string>()
    const minX = worldBox.minX - margin
    const minY = worldBox.minY - margin
    const maxX = worldBox.maxX + margin
    const maxY = worldBox.maxY + margin
    for (const node of layout.nodes) {
      if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
        focus.add(node.path)
      }
    }
    return focus
  }

  /**
   * 分帧推进力导向：每帧只对 `focusPaths`（视口内节点）做物理，视口外坐标固定不动。
   *
   * 单帧成本由视口内节点数决定，与总节点数无关——10 万节点的图同样能"动起来"。
   */
  private startAnimation(
    graph: GraphData,
    overrides: Record<string, GraphNodePosition>,
    base: GraphLayout,
    worldBox: WorldBox,
  ): void {
    this.stopAnimation()
    const total = this.forceSteps(graph)
    if (total <= 0 || base.nodes.length === 0) {
      return
    }
    const focusPaths = this.focusPaths(base, worldBox)
    if (focusPaths.size === 0) {
      return
    }
    // 视口内节点过多时单帧只推 1 步，并在 120 帧后停，避免单帧超时。
    const dense = focusPaths.size > 3000
    const perFrame = dense ? 1 : Math.max(1, Math.ceil(total / 60))
    const maxFrames = dense ? 120 : Number.POSITIVE_INFINITY
    let step = 0
    let frames = 0
    const tick = (): void => {
      frames += 1
      step = Math.min(total, step + perFrame)
      this.deps.publish(computeGraphLayout(graph, { overrides, steps: step, focusPaths }))
      if (step < total && frames < maxFrames && this.deps.mounted()) {
        this.animationTimer = requestAnimationFrame(tick)
        return
      }
      this.animationTimer = null
    }
    this.animationTimer = requestAnimationFrame(tick)
  }

  /** 视口变了：等 300ms 稳定后，对新区间重新起一轮力导向（拖动时不每帧重启）。 */
  scheduleViewportAnimation(): void {
    const graph = this.deps.graph()
    if (!this.deps.animate() || graph === null) {
      return
    }
    clearTimeout(this.viewportTimer)
    this.viewportTimer = setTimeout(() => {
      this.viewportTimer = undefined
      const current = this.deps.graph()
      const layout = this.deps.layout()
      if (current === null || layout === null || !this.deps.animate()) {
        return
      }
      this.startAnimation(current, this.deps.overrides(), layout, this.deps.worldBox())
    }, VIEWPORT_ANIMATION_DELAY)
  }

  stopBatch(): void {
    clearTimeout(this.batchTimer)
    this.batchTimer = undefined
  }

  stopAnimation(): void {
    if (this.animationTimer !== null) {
      cancelAnimationFrame(this.animationTimer)
      this.animationTimer = null
    }
  }

  /** 释放全部计时器（卸载时调用）。 */
  dispose(): void {
    this.stopBatch()
    this.stopAnimation()
    clearTimeout(this.viewportTimer)
    this.viewportTimer = undefined
    this.orderCache = null
  }
}
