/**
 * 05-14 布局性能基准（可执行脚本，不是测试）。
 *
 * 运行：`node --experimental-strip-types src/core/graph/bench.ts`
 * 输出每规模一行：
 *   `n=<N> first=<ms>ms full=<ms>ms physics=<ms>ms nodes=<n> parts=<n>`
 *
 * - `first` = 首批布局（`limit: 1500` + 锚点 BFS 顺序，`steps: 0`）——**验收口径**：
 *   首屏可见时间，目标 < 1000ms（用户口径：核心展示部分控制在时间内）。
 * - `full` = 全量快速摆放（`steps: 0`，无 limit）——分批加载补完的最后一帧，只记录。
 * - `physics` = 全图力导向（缺省步数）——已知限制，只记录。
 */
import { computeGraphLayout } from './layout.ts'
import type { GraphData, GraphEdge, GraphNode } from './types.ts'

/** 每张图固定 40 个文件夹（与 05 轮演示夹具的量级一致）。 */
const FOLDER_COUNT = 40
/** 每个节点 2 条前置（跨文件夹，制造真实的边密度）。 */
const REQUIRES_PER_NODE = 2
/** 与控制器 `LAYOUT_FIRST_BATCH` 保持一致的首批节点数。 */
const FIRST_BATCH = 1500

/** 造一张 `count` 节点、每节点 2 条前置的确定性图。 */
function makeGraph(count: number): GraphData {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  for (let index = 0; index < count; index += 1) {
    const folder = `pack/f${index % FOLDER_COUNT}`
    const path = `${folder}/s${index}.json`
    nodes.push({
      id: path,
      path,
      folder,
      scriptId: `s${index}`,
      name: `S${index}`,
      author: '',
      description: '',
      dimension: '',
      priority: 0,
      duration: 0,
      infinite: false,
      valid: true,
      tracks: [],
      triggers: [],
      requiresTargets: [],
    })
    for (let slot = 0; slot < REQUIRES_PER_NODE; slot += 1) {
      // 跨文件夹指向更早的节点（确定性、无自环）。
      const target = (index * 7 + slot * 13 + 1) % Math.max(1, count)
      if (target === index) {
        continue
      }
      const toPath = `${`pack/f${target % FOLDER_COUNT}`}/s${target}.json`
      edges.push({
        key: `${toPath}>${path}|t#0|${slot}`,
        from: path,
        to: toPath,
        fromScriptId: `s${index}`,
        toScriptId: `s${target}`,
        triggerIdentity: 't#0',
        triggerIndex: 0,
        requirementIndex: slot,
        requirementType: 'script_played',
      })
    }
  }
  return {
    version: 1,
    nodes,
    edges,
    folders: [],
    warnings: [],
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      folderCount: FOLDER_COUNT,
      invalidCount: 0,
      warningCount: 0,
      warningsTruncated: false,
      scanMillis: 0,
      truncated: false,
    },
  }
}

/** 跑一次布局并计时（毫秒，保留整数）。 */
function measure(graph: GraphData, steps?: number, limit?: number): { ms: number; nodes: number; parts: number } {
  const started = performance.now()
  const layout = computeGraphLayout(graph, {
    ...(steps === undefined ? {} : { steps }),
    ...(limit === undefined ? {} : { limit }),
  })
  return {
    ms: Math.round(performance.now() - started),
    nodes: layout.nodes.length,
    parts: layout.partitions.length,
  }
}

// 预热：首次调用含 JIT 编译与内建初始化，不计入测量（否则小图数字会倒挂）。
measure(makeGraph(200), 0)

for (const count of [1000, 10_000, 100_000]) {
  const graph = makeGraph(count)
  const first = measure(graph, 0, Math.min(count, FIRST_BATCH))
  const full = measure(graph, 0)
  const physics = measure(graph)
  console.log(
    `n=${count} first=${first.ms}ms full=${full.ms}ms physics=${physics.ms}ms`
    + ` nodes=${full.nodes} parts=${full.parts}`,
  )
}
