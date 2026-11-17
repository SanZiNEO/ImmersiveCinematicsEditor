/**
 * 05-01 / 05-02 / 05-04 自检。
 *
 * 运行：`node --experimental-strip-types src/core/graph/verify.ts`
 * 输出：每条断言一行 `ok   <描述>` / `FAIL <描述>：<实际值>`，最后 `summary ok=<n> fail=<n>`。
 * 任一失败把 `process.exitCode` 置 1。
 *
 * 覆盖：
 * - buildGraph：空图、坏文件、缺 meta.id、重复 id、三种内置前置、同一触发器多条前置、
 *   自定义前置、悬空/自引用、成环边被丢弃（DAG 不变量）、warning 200 截断、节点 800 / 边 2000 截断；
 * - computeGraphLayout：分层、同层稳定、手摆覆盖、fit/zoom 锚点、命中、上下游、焦点集、分批加载；
 * - GraphLayoutStore：默认、往返、非法坐标、坏 JSON 备份、scale 夹取、collapsed 过滤、
 *   路径/scriptId 重绑定、orphan 生命周期、1 MB 上限、reset、写入失败、文件内容边界。
 */
import type { StoragePort } from '../../workbench/api/host.ts'
import type { GraphLayoutLoadResult } from '../../workbench/api/graph.ts'
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { baseNameOf, buildGraph, folderOf } from './index.ts'
import {
  computeGraphLayout,
  fitView,
  hitTestNode,
  neighboursOf,
  screenToWorld,
  zoomAt,
} from './layout.ts'
import type { GraphLayout } from './layout.ts'
import {
  corruptGraphLayoutFileName,
  GRAPH_LAYOUT_CORRUPT_PREFIX,
  GraphLayoutStore,
} from './layoutStore.ts'
import { GRAPH_LAYOUT_FILE, GRAPH_LAYOUT_MAX_BYTES } from './layoutFile.ts'
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  GraphScriptFile,
} from './types.ts'

let ok = 0
let fail = 0

/** 断言。 */
function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

/** 实际值压成一行。 */
function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 320 ? `${text.slice(0, 320)}…` : text
  } catch {
    return String(value)
  }
}

/** 浮点断言。 */
function checkNear(label: string, actual: number, expected: number, tolerance = 1e-6): void {
  check(label, Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, { actual, expected })
}

/** 内存存储（StoragePort 最小实现）。 */
class MemoryStorage implements StoragePort {
  readonly files = new Map<string, string>()
  readonly writes: string[] = []
  failWrite = false
  revealed = 0

  async read(name: string): Promise<string | null> {
    return this.files.get(name) ?? null
  }

  async write(name: string, text: string): Promise<void> {
    if (this.failWrite) {
      throw new Error('模拟写失败')
    }
    this.writes.push(name)
    this.files.set(name, text)
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name)
  }

  async list(prefix = ''): Promise<string[]> {
    return [...this.files.keys()].filter((name) => name.startsWith(prefix)).sort()
  }

  async listCorrupt(prefix: string): Promise<string[]> {
    return (await this.list(prefix)).filter((name) => name.includes('.corrupt.'))
  }

  async exists(name: string): Promise<boolean> {
    return this.files.has(name)
  }

  revealUserData(): void {
    this.revealed += 1
  }
}

/** 布局文件（读盘断言用）。 */
interface PersistedLayout {
  version?: number
  projectKey?: string
  revision?: number
  nodes?: Record<string, { x: number; y: number; scriptId?: string | null }>
  view?: { scale: number; tx: number; ty: number }
  collapsed?: string[]
  updatedAt?: string
}

/** 读布局文件。 */
function readLayout(storage: MemoryStorage): PersistedLayout {
  const text = storage.files.get(GRAPH_LAYOUT_FILE) ?? '{}'
  return JSON.parse(text) as PersistedLayout
}

/** 构造一个脚本文件（时间线为空；meta 由调用方给）。 */
function makeScript(path: string, meta: JsonObject): GraphScriptFile {
  return { path, doc: { meta, timeline: { tracks: [] } } }
}

/** 触发器夹具。 */
function makeTrigger(type: string, requires: JsonValue[], id?: string): JsonObject {
  return {
    ...(id === undefined ? {} : { id }),
    type,
    requires,
  }
}

/** 布局节点夹具。 */
function makeNode(path: string, name = baseNameOf(path)): GraphNode {
  return {
    id: path,
    path,
    folder: folderOf(path),
    scriptId: name,
    name,
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
  }
}

/** 布局边夹具。 */
function makeEdge(from: string, to: string, requirementIndex = 0): GraphEdge {
  const triggerIdentity = 't#0'
  return {
    key: `${to}>${from}|${triggerIdentity}|${requirementIndex}`,
    from,
    to,
    fromScriptId: baseNameOf(from),
    toScriptId: baseNameOf(to),
    triggerIdentity,
    triggerIndex: 0,
    requirementIndex,
    requirementType: 'script_played',
  }
}

/** 图夹具。 */
function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  return {
    version: 1,
    nodes,
    edges,
    folders: [],
    warnings: [],
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      folderCount: 0,
      invalidCount: 0,
      warningCount: 0,
      warningsTruncated: false,
      scanMillis: 0,
      truncated: false,
    },
  }
}

/** 从图里取节点。 */
function nodeOf(graph: GraphData, path: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.path === path)
}

/** 从布局里取节点。 */
function laidOf(layout: GraphLayout, path: string) {
  return layout.nodes.find((node) => node.path === path)
}

/** 加载一段原始布局文本。 */
async function loadRaw(
  raw: string,
  known: readonly { path: string; scriptId?: string | null }[] = [],
): Promise<{ storage: MemoryStorage; store: GraphLayoutStore; result: GraphLayoutLoadResult }> {
  const storage = new MemoryStorage()
  storage.files.set(GRAPH_LAYOUT_FILE, raw)
  const store = new GraphLayoutStore({
    storage,
    now: () => new Date('2026-03-01T00:00:00.000Z'),
  })
  const result = await store.load(known)
  return { storage, store, result }
}

async function main(): Promise<void> {
  // ── 1. buildGraph（05-01） ─────────────────────────────────────────────
  {
    const empty = buildGraph([], { version: 1 })
    check('空图：没有节点', empty.nodes.length === 0)
    check('空图：没有边', empty.edges.length === 0)
    check('空图：只有根分组', empty.folders.length === 1 && empty.folders[0]?.path === '',
      empty.folders)
    check('空图：没有 warning', empty.warnings.length === 0)
    check('空图：统计与可见数据一致', empty.stats.nodeCount === 0 && empty.stats.edgeCount === 0
      && empty.stats.folderCount === 1 && empty.stats.invalidCount === 0
      && empty.stats.warningCount === 0 && empty.stats.truncated === false,
      empty.stats)
  }

  {
    const broken: GraphScriptFile = { path: 'broken.json', doc: 'not-an-object' }
    const graph = buildGraph(
      [
        makeScript('alpha.json', { id: 'alpha', name: 'Alpha' }),
        makeScript('beta.json', { id: 'beta', name: 'Beta' }),
        makeScript('gamma.json', { id: 'gamma', name: 'Gamma' }),
        makeScript('plain.json', { name: '未命名' }),
        broken,
      ],
      { version: 1 },
    )
    check('坏文件/缺 id/正常节点都进图', graph.nodes.length === 5, graph.nodes.map((node) => node.path))
    check('坏文件标 invalid 且带原因', (() => {
      const node = nodeOf(graph, 'broken.json')
      return node !== undefined && node.valid === false && typeof node.error === 'string' && node.error.length > 0
    })())
    check('坏文件产生 invalid warning', graph.warnings.some((warning) =>
      warning.kind === 'invalid' && warning.path === 'broken.json'))
    check('缺 meta.id：scriptId 为 null', nodeOf(graph, 'plain.json')?.scriptId === null)
    check('缺 meta.id：名称回退到文件名', nodeOf(graph, 'plain.json')?.name === '未命名')
    check('正常节点 valid', graph.nodes
      .filter((node) => node.path !== 'broken.json')
      .every((node) => node.valid === true))
    check('正常三节点都存在', ['alpha.json', 'beta.json', 'gamma.json']
      .every((path) => nodeOf(graph, path) !== undefined))
    check('缺 id 不产生 dangling（没有前置）', !graph.warnings.some((warning) =>
      warning.path === 'plain.json'))
  }

  {
    const graph = buildGraph(
      [
        makeScript('dup-one.json', { id: 'dup', name: 'Dup One' }),
        makeScript('dup-two.json', { id: 'dup', name: 'Dup Two' }),
        makeScript('user.json', {
          id: 'user',
          name: 'User',
          triggers: [makeTrigger('on_start', ['dup'])],
        }),
      ],
      { version: 1 },
    )
    const duplicates = graph.warnings.filter((warning) => warning.kind === 'duplicate_id')
    check('重复 id：两条 duplicate_id warning', duplicates.length === 2, duplicates)
    check('重复 id：两条分别指向两个路径', duplicates
      .map((warning) => warning.path)
      .sort()
      .join(',') === 'dup-one.json,dup-two.json', duplicates.map((warning) => warning.path))
    const requirement = graph.nodes.find((node) => node.path === 'user.json')
      ?.triggers[0]?.requirements[0]
    check('重复 id：前置 resolved=false', requirement?.resolved === false, requirement)
    check('重复 id：前置 editable=false 且原因正确',
      requirement?.editable === false && requirement?.editableReason === '目标 id 重复', requirement)
    check('重复 id：不建边', graph.edges.length === 0)
  }

  {
    const graph = buildGraph(
      [
        makeScript('b.json', { id: 'b', name: 'B' }),
        makeScript('a.json', {
          id: 'a',
          name: 'A',
          triggers: [makeTrigger('on_start', ['b'])],
        }),
      ],
      { version: 1 },
    )
    check('字符串前置：一条 B→A 边', graph.edges.length === 1, graph.edges)
    const edge = graph.edges[0]
    check('字符串前置：方向与端点正确',
      edge?.from === 'b.json' && edge?.to === 'a.json', edge)
    check('字符串前置：requirementType=script_played', edge?.requirementType === 'script_played', edge)
    check('字符串前置：requirementIndex=0', edge?.requirementIndex === 0, edge)
    const requirement = nodeOf(graph, 'a.json')?.triggers[0]?.requirements[0]
    check('字符串前置：解析为可编辑内置前置',
      requirement?.role === 'builtin' && requirement?.resolved === true && requirement?.editable === true,
      requirement)
  }

  {
    const graph = buildGraph(
      [
        makeScript('b.json', { id: 'b', name: 'B' }),
        makeScript('a.json', {
          id: 'a',
          name: 'A',
          triggers: [makeTrigger('on_start', [{ type: 'script_started', data: { script: 'b' } }])],
        }),
      ],
      { version: 1 },
    )
    check('对象前置：requirementType=script_started',
      graph.edges[0]?.requirementType === 'script_started', graph.edges[0])
    check('对象前置：data 原样保留',
      nodeOf(graph, 'a.json')?.triggers[0]?.requirements[0]?.data.script === 'b')
  }

  {
    const graph = buildGraph(
      [
        makeScript('b.json', { id: 'b', name: 'B' }),
        makeScript('a.json', {
          id: 'a',
          name: 'A',
          triggers: [
            makeTrigger('on_start', ['b']),
            makeTrigger('on_finish', [{ type: 'script_completed', data: { script: 'b' } }]),
          ],
        }),
      ],
      { version: 1 },
    )
    check('同对两触发器：两条边', graph.edges.length === 2, graph.edges)
    check('同对两触发器：triggerIdentity 不同',
      new Set(graph.edges.map((edge) => edge.triggerIdentity)).size === 2,
      graph.edges.map((edge) => edge.triggerIdentity))
    check('同对两触发器：key 不同',
      new Set(graph.edges.map((edge) => edge.key)).size === 2)
  }

  {
    const graph = buildGraph(
      [
        makeScript('b.json', { id: 'b', name: 'B' }),
        makeScript('a.json', {
          id: 'a',
          name: 'A',
          triggers: [makeTrigger('on_start', ['b', 'b'])],
        }),
      ],
      { version: 1 },
    )
    check('同一触发器两条相同 requires：两条边', graph.edges.length === 2, graph.edges)
    check('同一触发器两条相同 requires：下标 0/1',
      graph.edges.map((edge) => edge.requirementIndex).sort().join(',') === '0,1',
      graph.edges.map((edge) => edge.requirementIndex))
    check('同一触发器两条相同 requires：key 不同',
      new Set(graph.edges.map((edge) => edge.key)).size === 2)
  }

  {
    const graph = buildGraph(
      [
        makeScript('a.json', {
          id: 'a',
          name: 'A',
          triggers: [makeTrigger('on_start', [{ type: 'custom_rule', data: { flag: true } }])],
        }),
      ],
      { version: 1 },
    )
    const requirement = graph.nodes[0]?.triggers[0]?.requirements[0]
    check('自定义前置：role=custom', requirement?.role === 'custom', requirement)
    check('自定义前置：editable=false', requirement?.editable === false, requirement)
    check('自定义前置：理由正确', requirement?.editableReason === '自定义前置', requirement)
    check('自定义前置：不建边', graph.edges.length === 0)
  }

  {
    const graph = buildGraph(
      [makeScript('a.json', { id: 'a', name: 'A', triggers: [makeTrigger('on_start', ['missing'])] })],
      { version: 1 },
    )
    const requirement = graph.nodes[0]?.triggers[0]?.requirements[0]
    check('dangling：产生 warning', graph.warnings.some((warning) =>
      warning.kind === 'dangling' && warning.path === 'a.json'))
    check('dangling：resolved=false', requirement?.resolved === false, requirement)
    check('dangling：editable=true 且原因正确',
      requirement?.editable === true && requirement?.editableReason === '目标缺失', requirement)
    check('dangling：不建边', graph.edges.length === 0)
  }

  {
    const graph = buildGraph(
      [makeScript('a.json', { id: 'a', name: 'A', triggers: [makeTrigger('on_start', ['a'])] })],
      { version: 1 },
    )
    const requirement = graph.nodes[0]?.triggers[0]?.requirements[0]
    check('self_reference：产生 warning', graph.warnings.some((warning) =>
      warning.kind === 'self_reference' && warning.path === 'a.json'))
    check('self_reference：editable=true 且原因正确',
      requirement?.editable === true && requirement?.editableReason === '自引用', requirement)
    check('self_reference：不建边', graph.edges.length === 0)
  }

  {
    const graph = buildGraph(
      [
        makeScript('a.json', { id: 'a', name: 'A', triggers: [makeTrigger('on_start', ['b'])] }),
        makeScript('b.json', { id: 'b', name: 'B', triggers: [makeTrigger('on_start', ['a'])] }),
      ],
      { version: 1 },
    )
    // DAG 不变量：成环的边被丢弃（只保留先出现的那条），并产出一条 cycle warning。
    check('DAG：成环的边被丢弃，只留一条', graph.edges.length === 1, graph.edges)
    check('DAG：产生一条 cycle warning',
      graph.warnings.filter((warning) => warning.kind === 'cycle').length === 1, graph.warnings)
    check('DAG：节点本身仍 valid', graph.nodes.every((node) => node.valid === true))
    check('DAG：三条边的图里没有环（A→B→C 链）', (() => {
      const chain = buildGraph(
        [
          makeScript('a.json', { id: 'a', name: 'A' }),
          makeScript('b.json', { id: 'b', name: 'B', triggers: [makeTrigger('on_start', ['a'])] }),
          makeScript('c.json', { id: 'c', name: 'C', triggers: [makeTrigger('on_start', ['b'])] }),
        ],
        { version: 1 },
      )
      return chain.edges.length === 2 && chain.warnings.every((warning) => warning.kind !== 'cycle')
    })())
  }

  {
    const files: GraphScriptFile[] = []
    for (let index = 0; index < 250; index += 1) {
      files.push(makeScript(`warn/w${index}.json`, {
        id: `w${index}`,
        name: `Warn ${index}`,
        triggers: [makeTrigger('on_start', [`missing_${index}`])],
      }))
    }
    const graph = buildGraph(files, { version: 1 })
    check('warning 200 截断：列表 200 条', graph.warnings.length === 200, graph.warnings.length)
    check('warning 200 截断：真实计数 250', graph.stats.warningCount === 250, graph.stats.warningCount)
    check('warning 200 截断：标 warningsTruncated', graph.stats.warningsTruncated === true)
  }

  {
    const files: GraphScriptFile[] = []
    for (let index = 0; index < 801; index += 1) {
      files.push(makeScript(`n/n${index}.json`, { id: `n${index}`, name: `N${index}` }))
    }
    const graph = buildGraph(files, { version: 1 })
    check('节点上限 10 万：801 节点不截断', graph.nodes.length === 801, graph.nodes.length)
    check('节点上限 10 万：真实计数 801', graph.stats.nodeCount === 801, graph.stats.nodeCount)
    check('节点上限 10 万：未标 truncated', graph.stats.truncated === false, graph.stats.truncated)
  }

  {
    const files: GraphScriptFile[] = []
    for (let index = 0; index < 100_001; index += 1) {
      files.push(makeScript(`n/n${index}.json`, { id: `n${index}`, name: `N${index}` }))
    }
    const graph = buildGraph(files, { version: 1 })
    check('节点超 10 万：截断到 100000', graph.nodes.length === 100_000, graph.nodes.length)
    check('节点超 10 万：真实计数 100001', graph.stats.nodeCount === 100_001, graph.stats.nodeCount)
    check('节点超 10 万：标 truncated', graph.stats.truncated === true, graph.stats.truncated)
  }

  {
    const triggers: JsonObject[] = []
    for (let index = 0; index < 2001; index += 1) {
      triggers.push(makeTrigger('on_start', ['b']))
    }
    const graph = buildGraph(
      [
        makeScript('b.json', { id: 'b', name: 'B' }),
        makeScript('a.json', { id: 'a', name: 'A', triggers }),
      ],
      { version: 1 },
    )
    check('边上限 30 万：2001 条边不截断', graph.edges.length === 2001, graph.edges.length)
    check('边上限 30 万：真实计数 2001', graph.stats.edgeCount === 2001, graph.stats.edgeCount)
    check('边上限 30 万：未标 truncated', graph.stats.truncated === false, graph.stats.truncated)
  }

  // ── 2. computeGraphLayout（05-02，力导向） ──────────────────────────
  {
    const graph = makeGraph(
      [makeNode('a.json', 'A'), makeNode('b.json', 'B'), makeNode('c.json', 'C'), makeNode('d.json', 'D')],
      [makeEdge('d.json', 'b.json'), makeEdge('b.json', 'a.json'), makeEdge('c.json', 'a.json')],
    )
    const layout = computeGraphLayout(graph)
    check('分层：D 层 0', laidOf(layout, 'd.json')?.layer === 0, laidOf(layout, 'd.json')?.layer)
    check('分层：C 层 0', laidOf(layout, 'c.json')?.layer === 0, laidOf(layout, 'c.json')?.layer)
    check('分层：B 层 1', laidOf(layout, 'b.json')?.layer === 1, laidOf(layout, 'b.json')?.layer)
    check('分层：A 层 2', laidOf(layout, 'a.json')?.layer === 2, laidOf(layout, 'a.json')?.layer)
    check('分层：A 的入边 B/C 都存在', layout.edges.length === 3, layout.edges.length)
    check('力导向：存在锚点（自动选最终脚本）', typeof layout.centerPath === 'string'
      && layout.centerPath !== null, layout.centerPath)
    check('力导向：锚点是 A（无出边）', layout.centerPath === 'a.json', layout.centerPath)

    const stableGraph = makeGraph(
      [
        makeNode('root.json', 'Root'),
        makeNode('team/zeta.json', 'Zeta'),
        makeNode('team/alpha.json', 'Alpha'),
      ],
      [],
    )
    const stable = computeGraphLayout(stableGraph)
    const root = laidOf(stable, 'root.json')
    const alpha = laidOf(stable, 'team/alpha.json')
    const zeta = laidOf(stable, 'team/zeta.json')
    check('力导向：三个节点都有有限圆心',
      [root, alpha, zeta].every((node) => node !== undefined
        && Number.isFinite(node.x) && Number.isFinite(node.y)))
    check('力导向：孤立节点全部标 isolated',
      stable.nodes.every((node) => node.isolated === true), stable.nodes.map((node) => node.isolated))
    const firstCoords = stable.nodes.map((node) => [node.path, node.x, node.y])
    const secondCoords = computeGraphLayout(stableGraph).nodes.map((node) => [node.path, node.x, node.y])
    check('自动布局是纯函数：两次结果一致',
      JSON.stringify(firstCoords) === JSON.stringify(secondCoords))
    check('力导向：中心坐标确定且稳定',
      Number.isFinite(root?.x) && Number.isFinite(root?.y))

    const cycleGraph = makeGraph(
      [makeNode('a.json', 'A'), makeNode('b.json', 'B'), makeNode('c.json', 'C')],
      [makeEdge('b.json', 'a.json'), makeEdge('a.json', 'b.json'), makeEdge('c.json', 'a.json')],
    )
    // 布局层不再有环标记：DAG 保证由 buildGraph 完成，这里只验层仍可算。
    const cycleLayout = computeGraphLayout(cycleGraph)
    check('分层：环输入也能出有限坐标（布局不因脏数据崩）',
      cycleLayout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
      cycleLayout.nodes.map((node) => [node.path, node.x, node.y]))

    const overrides = { 'team/alpha.json': { x: 5000, y: 6000 } }
    const overridden = computeGraphLayout(stableGraph, { overrides })
    check('手摆覆盖优先', laidOf(overridden, 'team/alpha.json')?.x === 5000
      && laidOf(overridden, 'team/alpha.json')?.y === 6000, laidOf(overridden, 'team/alpha.json'))
    check('未覆盖节点保持自动坐标',
      laidOf(overridden, 'team/zeta.json')?.x === zeta?.x
      && laidOf(overridden, 'team/zeta.json')?.y === zeta?.y,
      laidOf(overridden, 'team/zeta.json'))

    // 不重叠：任意两节点命中框（DOT_HIT）不相交（力导向布局）。
    const forceLayout = computeGraphLayout(stableGraph)
    const overlap = (() => {
      const box = forceLayout.nodes.map((node) => ({
        x1: node.x - node.w / 2, y1: node.y - node.h / 2,
        x2: node.x + node.w / 2, y2: node.y + node.h / 2,
      }))
      for (let i = 0; i < box.length; i += 1) {
        for (let j = i + 1; j < box.length; j += 1) {
          if (box[i].x1 < box[j].x2 && box[i].x2 > box[j].x1
            && box[i].y1 < box[j].y2 && box[i].y2 > box[j].y1) {
            return true
          }
        }
      }
      return false
    })()
    check('力导向：节点命中框两两不重叠', !overlap)

    // 焦点集：视口外节点坐标必须与 steps=0 完全一致（布局层与动画解耦的核心契约）。
    {
      const fast = computeGraphLayout(stableGraph, { steps: 0 })
      const focused = computeGraphLayout(stableGraph, { steps: 5, focusPaths: new Set(['root.json']) })
      const frozen = ['team/alpha.json', 'team/zeta.json'].every((path) => {
        const left = laidOf(fast, path)
        const right = laidOf(focused, path)
        return left !== undefined && right !== undefined && left.x === right.x && left.y === right.y
      })
      check('焦点集：非焦点节点坐标与 steps=0 完全一致', frozen,
        ['team/alpha.json', 'team/zeta.json'].map((path) => {
          const right = laidOf(focused, path)
          return [path, right?.x, right?.y]
        }))
      const rootFast = laidOf(fast, 'root.json')
      const rootFocused = laidOf(focused, 'root.json')
      check('焦点集：焦点节点仍参与物理（坐标可动）',
        rootFast !== undefined && rootFocused !== undefined
        && Number.isFinite(rootFocused.x) && Number.isFinite(rootFocused.y))
    }

    // 分批加载：limit 只出前 N 个节点，切片外的边被丢弃；limit ≥ 全量时与不传等价。
    {
      const all = computeGraphLayout(cycleGraph, { steps: 0 })
      const partial = computeGraphLayout(cycleGraph, { steps: 0, limit: 2 })
      check('分批：limit=2 只出 2 个节点', partial.nodes.length === 2, partial.nodes.length)
      check('分批：limit=2 时节点是字典序前两个',
        partial.nodes.map((node) => node.path).join(',') === 'a.json,b.json',
        partial.nodes.map((node) => node.path))
      check('分批：切片外的边被丢弃',
        partial.edges.every((edge) => partial.nodes.includes(edge.from)
          && partial.nodes.includes(edge.to)),
        partial.edges.map((edge) => [edge.from.path, edge.to.path]))
      check('分批：limit ≥ 全量等价于不传 limit',
        computeGraphLayout(cycleGraph, { steps: 0, limit: 99 }).nodes.length === all.nodes.length)
      const ordered = computeGraphLayout(cycleGraph, { steps: 0, limit: 2, order: ['c.json', 'a.json', 'b.json'] })
      check('分批：order 决定首批成员',
        ordered.nodes.map((node) => node.path).join(',') === 'a.json,c.json',
        ordered.nodes.map((node) => node.path))
    }

    const viewport = { width: 900, height: 700 }
    const fitted = fitView(stable, viewport)
    check('fitView：scale 在 0.15–2.5', fitted.scale >= 0.15 && fitted.scale <= 2.5, fitted.scale)
    checkNear('fitView：世界包围盒中心映射到视口中心（x）',
      (stable.width / 2) * fitted.scale + fitted.tx, viewport.width / 2)
    checkNear('fitView：世界包围盒中心映射到视口中心（y）',
      (stable.height / 2) * fitted.scale + fitted.ty, viewport.height / 2)
    const anchor = { x: 123, y: 77 }
    const beforeZoom = screenToWorld(anchor, fitted)
    const zoomed = zoomAt(fitted, anchor, 2)
    const afterZoom = screenToWorld(anchor, zoomed)
    check('zoomAt：scale 生效', zoomed.scale === 2, zoomed.scale)
    checkNear('zoomAt：锚点世界坐标不变（x）', afterZoom.x, beforeZoom.x)
    checkNear('zoomAt：锚点世界坐标不变（y）', afterZoom.y, beforeZoom.y)
    const restored = zoomAt(zoomed, anchor, fitted.scale)
    checkNear('zoomAt：缩放再还原，锚点仍不漂移（x）',
      screenToWorld(anchor, restored).x, beforeZoom.x)

    const hitNode = stable.nodes[0]
    check('hitTest：命中圆心内部',
      hitNode !== undefined
      && hitTestNode(stable.nodes, { x: hitNode.x, y: hitNode.y })?.path === hitNode.path)
    check('hitTest：命中框内命中',
      hitNode !== undefined
      && hitTestNode(stable.nodes, { x: hitNode.x, y: hitNode.y - hitNode.h / 2 + 1 })?.path === hitNode.path)
    check('hitTest：命中框外不命中',
      hitNode !== undefined && hitTestNode(stable.nodes, { x: hitNode.x - 1000, y: hitNode.y - 1000 }) === undefined)

    const bfsEdges = [
      makeEdge('b.json', 'a.json'),
      makeEdge('a.json', 'b.json'),
      makeEdge('c.json', 'a.json'),
      makeEdge('a.json', 'd.json'),
    ]
    const bfsGraph = makeGraph(
      [makeNode('a.json', 'A'), makeNode('b.json', 'B'), makeNode('c.json', 'C'), makeNode('d.json', 'D')],
      bfsEdges,
    )
    const { up, down } = neighboursOf(bfsGraph.nodes, bfsEdges, 'a.json')
    check('neighboursOf：上游为 B/C', up.size === 2 && up.has('b.json') && up.has('c.json'), [...up])
    check('neighboursOf：下游为 B/D', down.size === 2 && down.has('b.json') && down.has('d.json'), [...down])
    check('neighboursOf：自身不在结果里', !up.has('a.json') && !down.has('a.json'))
  }

  // ── 3. GraphLayoutStore（05-04） ──────────────────────────────────────
  {
    const storage = new MemoryStorage()
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await store.load([])
    check('无文件：status=default', result.status === 'default', result.status)
    check('无文件：默认 revision=0', result.file.revision === 0, result.file.revision)
    check('无文件：默认视图 scale=1/tx=0/ty=0',
      result.file.view.scale === 1 && result.file.view.tx === 0 && result.file.view.ty === 0,
      result.file.view)
    check('无文件：默认没有节点/折叠', Object.keys(result.file.nodes).length === 0
      && result.file.collapsed.length === 0)
    check('无文件：不写盘', storage.writes.length === 0, storage.writes)
    check('无文件：current() 可用', store.current() !== null)
  }

  {
    const storage = new MemoryStorage()
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    await store.load([])
    const saved = await store.saveView({ scale: 1.6, tx: 30, ty: -20 })
    check('saveView：成功', saved.ok === true, saved)
    check('saveView：内存 revision+1', store.current()?.revision === 1, store.current()?.revision)
    const disk = readLayout(storage)
    check('saveView：写盘版本/projectKey 正确',
      disk.version === 1 && disk.projectKey === 'immersive_cinematics/scripts', disk)
    check('saveView：写盘视图正确',
      disk.view?.scale === 1.6 && disk.view?.tx === 30 && disk.view?.ty === -20, disk.view)
    check('saveView：只写 graph-layout.json', storage.writes.every((name) => name === GRAPH_LAYOUT_FILE), storage.writes)

    const snapshot = store.current()
    if (snapshot !== null) {
      snapshot.view.scale = 0.2
    }
    check('current()：返回快照，不暴露可变引用', store.current()?.view.scale === 1.6,
      store.current()?.view.scale)

    const reopened = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const loaded = await reopened.load([])
    check('重新加载：status=loaded', loaded.status === 'loaded', loaded.status)
    check('重新加载：revision 恢复', loaded.file.revision === 1, loaded.file.revision)
    check('重新加载：视图恢复',
      loaded.file.view.scale === 1.6 && loaded.file.view.tx === 30 && loaded.file.view.ty === -20,
      loaded.file.view)
  }

  {
    const raw = '{"version":1,"projectKey":"immersive_cinematics/scripts","revision":2,'
      + '"nodes":{'
      + '"good.json":{"x":10,"y":20,"scriptId":"good"},'
      + '"huge.json":{"x":1000000000,"y":20},'
      + '"bad.json":{"x":"abc","y":20},'
      + '"inf.json":{"x":1e309,"y":0}'
      + '},"view":{"scale":1,"tx":0,"ty":0},"collapsed":[],'
      + '"updatedAt":"2026-01-01T00:00:00.000Z"}'
    const { store, result } = await loadRaw(raw, [{ path: 'good.json', scriptId: 'good' }])
    check('非法坐标：status=loaded', result.status === 'loaded', result.status)
    check('非法坐标：1e9 单条丢弃', result.file.nodes['huge.json'] === undefined)
    check('非法坐标：字符串单条丢弃', result.file.nodes['bad.json'] === undefined)
    check('非法坐标：非有限单条丢弃', result.file.nodes['inf.json'] === undefined)
    check('非法坐标：合法记录保留',
      result.file.nodes['good.json']?.x === 10 && result.file.nodes['good.json']?.y === 20,
      result.file.nodes['good.json'])
    check('非法坐标：revision 保留', result.file.revision === 2, result.file.revision)
    check('非法坐标：store 内存一致', store.current()?.nodes['good.json'] !== undefined)
  }

  {
    const raw = '不是 JSON'
    const storage = new MemoryStorage()
    storage.files.set(GRAPH_LAYOUT_FILE, raw)
    const now = new Date('2026-01-01T00:00:00.000Z')
    const store = new GraphLayoutStore({ storage, now: () => now })
    const result = await store.load([])
    check('坏 JSON：status=corrupt', result.status === 'corrupt', result.status)
    check('坏 JSON：默认 revision=0', result.file.revision === 0)
    check('坏 JSON：默认没有节点', Object.keys(result.file.nodes).length === 0)
    const backups = await storage.listCorrupt(GRAPH_LAYOUT_CORRUPT_PREFIX)
    check('坏 JSON：生成一个 corrupt 备份', backups.length === 1, backups)
    check('坏 JSON：备份名符合 ISO 规则',
      backups[0] === corruptGraphLayoutFileName(now), backups)
    check('坏 JSON：备份内容为原文件',
      backups[0] !== undefined && storage.files.get(backups[0]) === raw)
    check('坏 JSON：不删原文件', storage.files.get(GRAPH_LAYOUT_FILE) === raw)
    check('坏 JSON：messages 提示恢复默认',
      result.messages.some((message) => message.includes('默认')), result.messages)
  }

  {
    const storage = new MemoryStorage()
    storage.files.set(GRAPH_LAYOUT_FILE, '{"version":2,"projectKey":"immersive_cinematics/scripts"}')
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await store.load([])
    check('version!=1：按坏文件处理', result.status === 'corrupt', result.status)
    check('version!=1：备份存在', (await storage.listCorrupt(GRAPH_LAYOUT_CORRUPT_PREFIX)).length === 1)
  }

  {
    const makeRaw = (view: string): string => `{"version":1,"projectKey":"immersive_cinematics/scripts",`
      + `"revision":0,"nodes":{},"view":${view},"collapsed":[],`
      + `"updatedAt":"2026-01-01T00:00:00.000Z"}`
    const high = await loadRaw(makeRaw('{"scale":99,"tx":1,"ty":2}'))
    check('scale 越界：夹到 2.5', high.result.file.view.scale === 2.5, high.result.file.view.scale)
    const low = await loadRaw(makeRaw('{"scale":0.001,"tx":1,"ty":2}'))
    check('scale 越界：夹到 0.15', low.result.file.view.scale === 0.15, low.result.file.view.scale)
    const broken = await loadRaw(makeRaw('{"scale":"big","tx":"x","ty":null}'))
    check('view 非法：scale 回 1', broken.result.file.view.scale === 1, broken.result.file.view.scale)
    check('view 非法：tx/ty 回 0',
      broken.result.file.view.tx === 0 && broken.result.file.view.ty === 0, broken.result.file.view)
  }

  {
    const raw = JSON.stringify({
      version: 1,
      projectKey: 'immersive_cinematics/scripts',
      revision: 0,
      nodes: { 'dir/a.json': { x: 1, y: 2, scriptId: 'a' } },
      view: { scale: 1, tx: 0, ty: 0 },
      collapsed: ['dir', 'missing', '', 'dir', '../bad', '/abs', 42],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const { result } = await loadRaw(raw, [{ path: 'dir/a.json', scriptId: 'a' }, { path: 'root.json' }])
    check('collapsed：过滤不存在/非法目录并去重排序',
      JSON.stringify(result.file.collapsed) === JSON.stringify(['', 'dir']), result.file.collapsed)
  }

  {
    const raw = JSON.stringify({
      version: 1,
      projectKey: 'immersive_cinematics/scripts',
      revision: 0,
      nodes: {
        'old/alpha.json': { x: 100, y: 200, scriptId: 'alpha' },
        'plain.json': { x: 1, y: 2, scriptId: 'beta' },
      },
      view: { scale: 1, tx: 0, ty: 0 },
      collapsed: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const storage = new MemoryStorage()
    storage.files.set(GRAPH_LAYOUT_FILE, raw)
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await store.load([{ path: 'new/alpha.json', scriptId: 'alpha' }])
    check('重绑定：路径失效 + scriptId 命中迁移 key',
      result.file.nodes['new/alpha.json']?.x === 100 && result.file.nodes['new/alpha.json']?.y === 200,
      result.file.nodes)
    check('重绑定：旧 key 不再渲染', result.file.nodes['old/alpha.json'] === undefined)
    check('重绑定：不因重绑定写盘', storage.files.get(GRAPH_LAYOUT_FILE) === raw)

    const keepRaw = JSON.stringify({
      version: 1,
      projectKey: 'immersive_cinematics/scripts',
      revision: 0,
      nodes: {
        'keep.json': { x: 5, y: 6, scriptId: 'old' },
        'other.json': { x: 7, y: 8, scriptId: 'old' },
      },
      view: { scale: 1, tx: 0, ty: 0 },
      collapsed: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const dup = await loadRaw(keepRaw, [{ path: 'keep.json', scriptId: 'new' }])
    check('重绑定：路径命中的 scriptId 更新为新 id',
      dup.result.file.nodes['keep.json']?.scriptId === 'new', dup.result.file.nodes['keep.json'])
    check('重绑定：同 scriptId 的另一条不合并坐标',
      dup.result.file.nodes['other.json'] === undefined && dup.result.file.nodes['keep.json']?.x === 5,
      dup.result.file.nodes)
  }

  {
    const storage = new MemoryStorage()
    const day0 = new Date('2026-01-01T00:00:00.000Z')
    const first = new GraphLayoutStore({ storage, now: () => day0 })
    await first.load([{ path: 'a.json', scriptId: 'a' }, { path: 'b.json', scriptId: 'b' }])
    const written = await first.saveNodePositions({
      'a.json': { x: 10, y: 20, scriptId: 'a' },
      'b.json': { x: 30, y: 40, scriptId: 'b' },
    })
    check('坐标保存：成功', written.ok === true, written)

    const second = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
    })
    const afterDelete = await second.load([{ path: 'b.json', scriptId: 'b' }])
    check('删除脚本：orphan 不渲染', afterDelete.file.nodes['a.json'] === undefined, afterDelete.file.nodes)
    check('删除脚本：其余节点正常渲染', afterDelete.file.nodes['b.json']?.x === 30)
    await second.saveView({ scale: 1.2, tx: 0, ty: 0 })
    const diskAfterDelete = readLayout(storage)
    check('删除脚本：30 天内 orphan 仍在磁盘（可复用坐标）',
      diskAfterDelete.nodes?.['a.json']?.x === 10, diskAfterDelete.nodes)
    check('删除脚本：内存仍不渲染 orphan', second.current()?.nodes['a.json'] === undefined)

    const third = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-02-02T00:00:00.000Z'),
    })
    const later = await third.load([{ path: 'b.json', scriptId: 'b' }])
    check('orphan 过期前仍不渲染', later.file.nodes['a.json'] === undefined)
    const pruned = await third.saveNodePositions({ 'b.json': { x: 31, y: 41 } })
    check('orphan 30 天后：写入成功', pruned.ok === true, pruned)
    const diskPruned = readLayout(storage)
    check('orphan 30 天后：从磁盘清理', diskPruned.nodes?.['a.json'] === undefined, diskPruned.nodes)
    check('orphan 30 天后：保留正常节点',
      diskPruned.nodes?.['b.json']?.x === 31 && diskPruned.nodes?.['b.json']?.y === 41,
      diskPruned.nodes)
  }

  {
    const storage = new MemoryStorage()
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    await store.load([])
    const big: Record<string, { x: number; y: number }> = {}
    for (let index = 0; index < 2600; index += 1) {
      big[`dir/${'x'.repeat(460)}${index}.json`] = { x: index, y: index }
    }
    const result = await store.saveNodePositions(big)
    const oversized = JSON.stringify(store.current(), null, 2)
    check('超过 1 MB：夹具真实超过上限',
      new TextEncoder().encode(oversized).length > GRAPH_LAYOUT_MAX_BYTES,
      new TextEncoder().encode(oversized).length)
    check('超过 1 MB：拒绝写入', result.ok === false && result.error === 'too-large', result)
    check('超过 1 MB：不写盘', !storage.files.has(GRAPH_LAYOUT_FILE), storage.writes)
    check('超过 1 MB：内存值保留', Object.keys(store.current()?.nodes ?? {}).length === 2600,
      Object.keys(store.current()?.nodes ?? {}).length)
  }

  {
    const storage = new MemoryStorage()
    storage.files.set(GRAPH_LAYOUT_FILE, 'x'.repeat(GRAPH_LAYOUT_MAX_BYTES + 10))
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await store.load([])
    check('文件超过 1 MB：status=too-large', result.status === 'too-large', result.status)
    check('文件超过 1 MB：备份存在',
      (await storage.listCorrupt(GRAPH_LAYOUT_CORRUPT_PREFIX)).length === 1)
    check('文件超过 1 MB：回默认布局', Object.keys(result.file.nodes).length === 0)
  }

  {
    const raw = JSON.stringify({
      version: 1,
      projectKey: 'immersive_cinematics/scripts',
      revision: 0,
      nodes: { 'dir/a.json': { x: 1, y: 2, scriptId: 'a' } },
      view: { scale: 1.4, tx: 9, ty: 8 },
      collapsed: ['dir'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const { storage, store } = await loadRaw(raw, [{ path: 'dir/a.json', scriptId: 'a' }])
    check('reset 前：节点/折叠存在',
      store.current()?.nodes['dir/a.json'] !== undefined && store.current()?.collapsed[0] === 'dir')
    const reset = await store.resetLayout()
    check('reset：写入成功', reset.ok === true, reset)
    const current = store.current()
    check('reset：清空手摆坐标', Object.keys(current?.nodes ?? {}).length === 0)
    check('reset：清空折叠', (current?.collapsed.length ?? -1) === 0)
    check('reset：保留视图',
      current?.view.scale === 1.4 && current?.view.tx === 9 && current?.view.ty === 8, current?.view)
    const disk = readLayout(storage)
    check('reset：磁盘 nodes/collapsed 清空',
      Object.keys(disk.nodes ?? {}).length === 0 && (disk.collapsed?.length ?? -1) === 0)
    check('reset：磁盘视图保留', disk.view?.scale === 1.4 && disk.view?.tx === 9 && disk.view?.ty === 8)
  }

  {
    const storage = new MemoryStorage()
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    await store.load([])
    storage.failWrite = true
    const result = await store.saveView({ scale: 1.2, tx: 5, ty: 6 })
    check('写入失败：返回 write-failed', result.ok === false && result.error === 'write-failed', result)
    check('写入失败：内存值保留',
      store.current()?.view.scale === 1.2 && store.current()?.view.tx === 5,
      store.current()?.view)
  }

  {
    const storage = new MemoryStorage()
    storage.files.set(GRAPH_LAYOUT_FILE, '{ 坏 JSON')
    storage.failWrite = true
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await store.load([])
    check('备份失败：不阻塞回默认', result.status === 'corrupt' && result.file.revision === 0, result.status)
  }

  {
    const storage = new MemoryStorage()
    const store = new GraphLayoutStore({
      storage,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    await store.load([])
    await store.saveNodePositions({
      'dir/a.json': { x: 11, y: 22, scriptId: 'a' },
      'dir/sub/b.json': { x: 33, y: 44, scriptId: 'b' },
    })
    await store.setCollapsed(['dir', '', 'dir'])
    await store.saveView({ scale: 1.5, tx: 7, ty: 8 })
    const text = storage.files.get(GRAPH_LAYOUT_FILE) ?? ''
    check('布局文件：不含 requires', !text.includes('requires'))
    check('布局文件：不含触发器数据', !text.includes('triggers'))
    check('布局文件：不含脚本正文（timeline/clips）',
      !text.includes('timeline') && !text.includes('clips'))
    const disk = readLayout(storage)
    check('布局文件：只有契约字段',
      Object.keys(disk).sort().join(',') === 'collapsed,nodes,projectKey,revision,updatedAt,version,view',
      Object.keys(disk).sort())
    const diskNodes: Record<string, { x: number; y: number; scriptId?: string | null }> = disk.nodes ?? {}
    check('布局文件：节点只有 x/y/scriptId',
      Object.values(diskNodes).every((node) =>
        Object.keys(node).sort().join(',') === 'scriptId,x,y'),
      diskNodes)
    check('布局文件：collapsed 去重排序',
      JSON.stringify(disk.collapsed) === JSON.stringify(['', 'dir']), disk.collapsed)
    check('布局文件：不写偏好文件/04 布局文件',
      !storage.files.has('preferences.json')
      && !storage.files.has(['layout', 'json'].join('.')), [...storage.files.keys()])
  }
}

main()
  .catch((error: unknown) => {
    check('verify 执行未抛出未捕获异常', false, error)
  })
  .finally(() => {
    console.log(`summary ok=${ok} fail=${fail}`)
    if (fail > 0) {
      process.exitCode = 1
    }
  })
