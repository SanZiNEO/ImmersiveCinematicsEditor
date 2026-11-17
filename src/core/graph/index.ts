/**
 * 05-01 脚本索引：把一次扫描的文件集合变成唯一图数据。
 *
 * 本模块是纯函数：不读文件、不缓存、不写盘。唯一扫描入口由服务层保证
 * （`ScriptGraphService` 只调用一次 source.list），这里只消费已解析的 JSON。
 *
 * 规则摘要：
 * - 节点 = 脚本文件；坏文件仍进图（`valid=false`），不丢整张图；
 * - 触发器身份优先 `id`，缺失用 `type#index`；
 * - 边只从内置三种前置产生，方向「被依赖 → 依赖方」；
 * - 自引用、悬空、重复 id 不建边；环只标记，不修复。
 */
import { isJsonObject } from '../doc/json.ts'
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { parseDoc } from '../doc/parse.ts'
import { META_ID_PATTERN } from '../doc/keys.ts'
import {
  duplicateTriggerIds,
  parseRequirement,
  requirementScriptId,
  requiresArrayOf,
  requiresFingerprint,
  triggerIdentityOf,
} from './requirements.ts'
import {
  BUILTIN_REQUIREMENT_TYPES,
  GRAPH_MAX_EDGES,
  GRAPH_MAX_NODES,
  GRAPH_MAX_WARNINGS,
} from './types.ts'
import type {
  BuildGraphOptions,
  GraphData,
  GraphEdge,
  GraphFolder,
  GraphNode,
  GraphRequirement,
  GraphScriptFile,
  GraphStats,
  GraphTrigger,
  GraphWarning,
  GraphWarningKind,
} from './types.ts'

/** 05-01 固定的脚本最大扫描深度（`ScriptManager.MAX_SCRIPT_DEPTH`）。 */
export const MAX_SCRIPT_DEPTH = 5

/** 解析路径是否为安全的脚本相对路径（服务层与布局共用口径）。 */
export function normalizeScriptPath(raw: string): string | null {
  if (raw.length === 0 || raw.length > 512) {
    return null
  }
  const path = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (path.length === 0 || /^[A-Za-z]:/.test(path)) {
    return null
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }
  if (!path.endsWith('.json') || path === '.json') {
    return null
  }
  if (segments.length - 1 > MAX_SCRIPT_DEPTH) {
    return null
  }
  return path
}

/** 目录路径（`a/b/c.json` → `a/b`；根脚本 → `""`）。 */
export function folderOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** 文件名（去扩展名）。 */
export function baseNameOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.endsWith('.json') ? base.slice(0, -5) : base
}

/** 读字符串（非字符串/空串 → `undefined`）。 */
function textOf(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 读有限数字。 */
function numberOf(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 内容末端与无限性（与 03 `DocStore` 的派生口径一致）。 */
function contentOf(root: JsonObject): { end: number; infinite: boolean } {
  const meta = isJsonObject(root.meta) ? root.meta : {}
  if (meta.macro_loop === true && numberOf(meta.macro_loop_count, -1) < 0) {
    return { end: 0, infinite: true }
  }

  let end = 0
  const timeline = isJsonObject(root.timeline) ? root.timeline : {}
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : []
  for (const track of tracks) {
    if (!isJsonObject(track) || !Array.isArray(track.clips)) {
      continue
    }
    for (const clip of track.clips) {
      if (!isJsonObject(clip)) {
        continue
      }
      if (isClipInfinite(clip)) {
        return { end: 0, infinite: true }
      }
      const start = numberOf(clip.start_time, 0)
      const duration = numberOf(clip.duration, 0)
      const loop = clip.loop === true
      const count = numberOf(clip.loop_count, -1)
      end = Math.max(end, start + duration * (loop ? Math.max(1, count) : 1))
    }
  }

  const standalone = Array.isArray(root.clips) ? root.clips : []
  for (const clip of standalone) {
    if (isJsonObject(clip) && isClipInfinite(clip)) {
      return { end: 0, infinite: true }
    }
  }
  return { end, infinite: false }
}

/** 片段是否永不结束。 */
export function isClipInfinite(clip: JsonObject): boolean {
  return (typeof clip.duration === 'number' && clip.duration < 0)
    || (clip.loop === true && typeof clip.loop_count === 'number' && clip.loop_count < 0)
}

/** 轨道摘要。 */
function tracksOf(root: JsonObject): { type: string; clips: number }[] {
  const timeline = isJsonObject(root.timeline) ? root.timeline : {}
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : []
  const result: { type: string; clips: number }[] = []
  for (const track of tracks) {
    if (!isJsonObject(track)) {
      continue
    }
    result.push({
      type: typeof track.type === 'string' ? track.type : '',
      clips: Array.isArray(track.clips) ? track.clips.length : 0,
    })
  }
  return result
}

/** 一个脚本文件的中间结果。 */
interface ParsedNode {
  path: string
  folder: string
  scriptId: string | null
  name: string
  author: string
  description: string
  dimension: string
  priority: number
  duration: number
  infinite: boolean
  valid: boolean
  error?: string
  tracks: { type: string; clips: number }[]
  triggers: GraphTrigger[]
  requiresTargets: string[]
}

/** 从原始 JSON 建节点（坏文件也保留身份摘要）。 */
function parseNode(file: GraphScriptFile, metaKeys: readonly string[]): ParsedNode {
  const raw = file.doc
  const root = isJsonObject(raw) ? raw : null
  const meta = root !== null && isJsonObject(root.meta) ? root.meta : {}
  const rawId = meta.id
  const scriptId = typeof rawId === 'string' && META_ID_PATTERN.test(rawId) ? rawId : null

  let valid = false
  let error: string | undefined
  if (file.error !== undefined) {
    error = file.error
  } else if (root === null) {
    error = '根元素不是 JSON 对象'
  } else {
    const parsed = parseDoc(root, { metaKeys })
    valid = parsed.ok
    if (!parsed.ok) {
      error = parsed.issues.find((issue) => issue.severity === 'block')?.message
        ?? parsed.issues[0]?.message
        ?? '脚本无法解析'
    }
  }

  const triggersRaw = Array.isArray(meta.triggers) ? meta.triggers : []
  const duplicateIds = duplicateTriggerIds(triggersRaw)
  const triggers: GraphTrigger[] = []
  const requiresTargets: string[] = []
  for (let index = 0; index < triggersRaw.length; index += 1) {
    const rawTrigger = triggersRaw[index]
    if (!isJsonObject(rawTrigger)) {
      continue
    }
    const type = typeof rawTrigger.type === 'string' ? rawTrigger.type : ''
    const requires = requiresArrayOf(rawTrigger)
    const requirements: GraphRequirement[] = requires.map((entry, requirementIndex) => {
      const requirement = parseRequirement(entry, requirementIndex)
      const target = requirement.scriptId
      if (target !== undefined && !requiresTargets.includes(target)) {
        requiresTargets.push(target)
      }
      return requirement
    })
    triggers.push({
      identity: triggerIdentityOf(rawTrigger, index, duplicateIds),
      index,
      type,
      repeatable: rawTrigger.repeatable === true,
      delay: Math.max(0, numberOf(rawTrigger.delay, 0)),
      requirements,
      requiresFingerprint: requiresFingerprint(requires),
      ...(isJsonObject(rawTrigger.conditions)
        ? { conditions: rawTrigger.conditions as Record<string, JsonValue> }
        : {}),
      ...(isJsonObject(rawTrigger.continuity)
        ? { continuity: rawTrigger.continuity as Record<string, JsonValue> }
        : {}),
    })
  }

  const content = root === null ? { end: 0, infinite: false } : contentOf(root)
  const name = textOf(meta.name)
    ?? (scriptId === null ? undefined : scriptId)
    ?? baseNameOf(file.path)

  return {
    path: file.path,
    folder: folderOf(file.path),
    scriptId,
    name,
    author: textOf(meta.author) ?? '',
    description: textOf(meta.description) ?? '',
    dimension: textOf(meta.dimension) ?? '',
    priority: numberOf(meta.priority, 0),
    duration: content.infinite ? 0 : content.end,
    infinite: content.infinite,
    valid,
    ...(error === undefined ? {} : { error }),
    tracks: root === null ? [] : tracksOf(root),
    triggers,
    requiresTargets,
  }
}

/** warning 的稳定顺序（路径 → 类型 → 触发器 → 前置下标）。 */
const WARNING_ORDER: Record<GraphWarningKind, number> = {
  invalid: 0,
  duplicate_id: 1,
  dangling: 2,
  self_reference: 3,
  unknown_trigger: 4,
  cycle: 5,
}

function compareWarnings(left: GraphWarning, right: GraphWarning): number {
  if (left.path !== right.path) {
    return left.path.localeCompare(right.path)
  }
  const kind = WARNING_ORDER[left.kind] - WARNING_ORDER[right.kind]
  if (kind !== 0) {
    return kind
  }
  const trigger = (left.triggerIdentity ?? '').localeCompare(right.triggerIdentity ?? '')
  if (trigger !== 0) {
    return trigger
  }
  return (left.requirementIndex ?? -1) - (right.requirementIndex ?? -1)
}

/** 目录分组：根第一，其余按深度 + 路径先序；空目录不出现。 */
function buildFolders(nodes: readonly ParsedNode[]): GraphFolder[] {
  const direct = new Map<string, number>()
  const all = new Set<string>([''])
  for (const node of nodes) {
    direct.set(node.folder, (direct.get(node.folder) ?? 0) + 1)
    let current = node.folder
    while (current !== '') {
      all.add(current)
      const index = current.lastIndexOf('/')
      current = index < 0 ? '' : current.slice(0, index)
    }
  }
  const paths = [...all].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length
    return depth !== 0 ? depth : left.localeCompare(right)
  })
  const folders: GraphFolder[] = []
  for (const path of paths) {
    let total = 0
    for (const [folder, count] of direct) {
      if (path === '' || folder === path || folder.startsWith(`${path}/`)) {
        total += count
      }
    }
    const index = path.lastIndexOf('/')
    folders.push({
      path,
      parent: path === '' ? null : (index < 0 ? '' : path.slice(0, index)),
      depth: path === '' ? 0 : path.split('/').length,
      directScriptCount: direct.get(path) ?? 0,
      totalScriptCount: total,
    })
  }
  return folders
}

/** Tarjan SCC（迭代版）；返回每个节点所属分量与分量列表。 */
function stronglyConnected(count: number, adjacency: readonly number[][]): {
  component: number[]
  components: number[][]
} {
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

/** 建图。 */
export function buildGraph(files: readonly GraphScriptFile[], options: BuildGraphOptions): GraphData {
  const metaKeys = options.metaKeys ?? ['id', 'name', 'author', 'description', 'dimension', 'priority', 'triggers']
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path))
  const parsed = sorted.map((file) => parseNode(file, metaKeys))
  const warnings: GraphWarning[] = []

  for (const node of parsed) {
    if (!node.valid) {
      warnings.push({
        kind: 'invalid',
        severity: 'error',
        path: node.path,
        nodeId: node.path,
        message: node.error ?? '脚本无法解析',
      })
    }
  }

  const idToPaths = new Map<string, string[]>()
  for (const node of parsed) {
    if (node.scriptId === null) {
      continue
    }
    const paths = idToPaths.get(node.scriptId) ?? []
    paths.push(node.path)
    idToPaths.set(node.scriptId, paths)
  }
  const primaryByScriptId = new Map<string, string>()
  for (const [scriptId, paths] of idToPaths) {
    primaryByScriptId.set(scriptId, paths[0] as string)
    if (paths.length > 1) {
      for (const path of paths) {
        warnings.push({
          kind: 'duplicate_id',
          severity: 'warn',
          path,
          nodeId: path,
          message: `meta.id 重复：${scriptId}（${paths.join('、')}）`,
        })
      }
    }
  }

  const edges: GraphEdge[] = []
  const nodeIndex = new Map<string, GraphNode>()
  const byPath = new Map<string, ParsedNode>()
  for (const node of parsed) {
    byPath.set(node.path, node)
  }

  for (const node of parsed) {
    for (const trigger of node.triggers) {
      for (const requirement of trigger.requirements) {
        if (requirement.role !== 'builtin') {
          requirement.editable = false
          requirement.editableReason = '自定义前置'
          continue
        }
        if (requirement.type === '' || !BUILTIN_REQUIREMENT_TYPES.includes(requirement.type as never)) {
          requirement.editable = false
          requirement.editableReason = '自定义前置'
          continue
        }
        const targetId = requirement.scriptId
        if (targetId === undefined) {
          requirement.resolved = false
          requirement.editable = false
          requirement.editableReason = '目标缺失'
          warnings.push({
            kind: 'dangling',
            severity: 'warn',
            path: node.path,
            nodeId: node.path,
            triggerIdentity: trigger.identity,
            requirementIndex: requirement.index,
            message: `${trigger.type} 前置缺少目标脚本 id`,
          })
          continue
        }
        if (node.scriptId === null) {
          requirement.resolved = false
          requirement.editable = false
          requirement.editableReason = '当前脚本无 id'
          continue
        }
        if (targetId === node.scriptId) {
          requirement.resolved = false
          requirement.editable = true
          requirement.editableReason = '自引用'
          warnings.push({
            kind: 'self_reference',
            severity: 'warn',
            path: node.path,
            nodeId: node.path,
            triggerIdentity: trigger.identity,
            requirementIndex: requirement.index,
            message: `触发器引用当前脚本自身：${targetId}`,
          })
          continue
        }
        const targets = idToPaths.get(targetId)
        if (targets === undefined) {
          requirement.resolved = false
          requirement.editable = true
          requirement.editableReason = '目标缺失'
          warnings.push({
            kind: 'dangling',
            severity: 'warn',
            path: node.path,
            nodeId: node.path,
            triggerIdentity: trigger.identity,
            requirementIndex: requirement.index,
            message: `前置目标不存在：${targetId}`,
          })
          continue
        }
        if (targets.length > 1) {
          requirement.resolved = false
          requirement.editable = false
          requirement.editableReason = '目标 id 重复'
          continue
        }
        const from = targets[0] as string
        requirement.resolved = true
        requirement.editable = true
        edges.push({
          key: `${node.path}>${from}|${trigger.identity}|${requirement.index}`,
          from,
          to: node.path,
          fromScriptId: targetId,
          toScriptId: node.scriptId,
          triggerIdentity: trigger.identity,
          triggerIndex: trigger.index,
          requirementIndex: requirement.index,
          requirementType: requirement.type,
        })
      }
    }
  }

  // 环：按 resolved 边建邻接，SCC > 1 的分量各产出一条 warning。
  const pathIndex = new Map<string, number>()
  parsed.forEach((node, index) => pathIndex.set(node.path, index))
  const adjacency: number[][] = parsed.map(() => [])
  for (const edge of edges) {
    const from = pathIndex.get(edge.from)
    const to = pathIndex.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      continue
    }
    adjacency[from].push(to)
  }
  const { component, components } = stronglyConnected(parsed.length, adjacency)
  for (const members of components) {
    if (members.length <= 1) {
      continue
    }
    const paths = members.map((index) => parsed[index].path).sort()
    warnings.push({
      kind: 'cycle',
      severity: 'warn',
      path: paths[0] as string,
      nodeId: paths[0],
      message: `前置依赖成环：${paths.join(' → ')}`,
    })
  }
  void component

  for (const node of parsed) {
    const graphNode: GraphNode = {
      id: node.path,
      path: node.path,
      folder: node.folder,
      scriptId: node.scriptId,
      name: node.name,
      author: node.author,
      description: node.description,
      dimension: node.dimension,
      priority: node.priority,
      duration: node.duration,
      infinite: node.infinite,
      valid: node.valid,
      ...(node.error === undefined ? {} : { error: node.error }),
      tracks: node.tracks,
      triggers: node.triggers,
      requiresTargets: node.requiresTargets,
    }
    nodeIndex.set(node.path, graphNode)
  }

  const nodes = [...nodeIndex.values()].sort((left, right) => left.path.localeCompare(right.path))
  const totalWarnings = warnings.length
  const orderedWarnings = warnings
    .sort(compareWarnings)
    .slice(0, options.maxWarnings ?? GRAPH_MAX_WARNINGS)
  const nodeLimit = options.maxNodes ?? GRAPH_MAX_NODES
  const edgeLimit = options.maxEdges ?? GRAPH_MAX_EDGES
  const truncated = nodes.length > nodeLimit || edges.length > edgeLimit
  const visibleNodes = truncated ? nodes.slice(0, nodeLimit) : nodes
  const visiblePaths = new Set(visibleNodes.map((node) => node.path))
  const visibleEdges = (truncated ? edges.slice(0, edgeLimit) : edges)
    .filter((edge) => visiblePaths.has(edge.from) && visiblePaths.has(edge.to))

  const stats: GraphStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    folderCount: 0,
    invalidCount: nodes.filter((node) => !node.valid).length,
    warningCount: totalWarnings,
    warningsTruncated: totalWarnings > (options.maxWarnings ?? GRAPH_MAX_WARNINGS),
    scanMillis: options.scanMillis ?? 0,
    truncated,
  }
  const folders = buildFolders(parsed)
  stats.folderCount = folders.length

  return {
    version: options.version,
    nodes: visibleNodes,
    edges: visibleEdges,
    folders,
    warnings: orderedWarnings,
    stats,
  }
}

/** 图上某节点的全部触发器中，某条前置的定位结果。 */
export interface RequirementLocation {
  node: GraphNode
  trigger: GraphTrigger
  requirement: GraphRequirement
}

/** 按 `(path, triggerIdentity, requirementIndex)` 定位一条前置。 */
export function locateRequirement(
  graph: GraphData,
  path: string,
  triggerIdentity: string,
  requirementIndex: number,
): RequirementLocation | undefined {
  const node = graph.nodes.find((candidate) => candidate.path === path)
  if (node === undefined) {
    return undefined
  }
  const trigger = node.triggers.find((candidate) => candidate.identity === triggerIdentity)
  if (trigger === undefined) {
    return undefined
  }
  const requirement = trigger.requirements.find((candidate) => candidate.index === requirementIndex)
  if (requirement === undefined) {
    return undefined
  }
  return { node, trigger, requirement }
}

/** 目标脚本候选（存在且 id 唯一）。 */
export function uniqueTargets(graph: GraphData, excludePath?: string): GraphNode[] {
  const counts = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.scriptId === null || node.scriptId === undefined) {
      continue
    }
    counts.set(node.scriptId, (counts.get(node.scriptId) ?? 0) + 1)
  }
  return graph.nodes.filter((node) =>
    node.valid
    && node.scriptId !== null
    && node.scriptId !== undefined
    && counts.get(node.scriptId) === 1
    && node.path !== excludePath)
}

/** 该节点是否处于环内（前端 layout 也会标；诊断用）。 */
export function cyclesOf(graph: GraphData): string[][] {
  const paths = graph.nodes.map((node) => node.path)
  const index = new Map(paths.map((path, i) => [path, i]))
  const adjacency: number[][] = paths.map(() => [])
  for (const edge of graph.edges) {
    const from = index.get(edge.from)
    const to = index.get(edge.to)
    if (from !== undefined && to !== undefined && from !== to) {
      adjacency[from].push(to)
    }
  }
  const { components } = stronglyConnected(paths.length, adjacency)
  return components.filter((members) => members.length > 1).map((members) => members.map((i) => paths[i]))
}
