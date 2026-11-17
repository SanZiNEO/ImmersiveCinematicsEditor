/**
 * 05-01 脚本关系图数据契约（编辑器侧唯一形状）。
 *
 * 事实基准：`requires` 是触发器自己的字段（`meta.triggers[i].requires[]`），
 * 前置对象写法为 `{type, data:{script}}`，字符串写法等价于 `script_played`。
 * 本模块只描述数据，不解析脚本；解析在 `index.ts`，布局在 `layout.ts`。
 */
import type { JsonValue } from '../doc/types.ts'

/** 内置前置类型（`PrerequisiteRegistry` 的三种脚本前置）。 */
export const BUILTIN_REQUIREMENT_TYPES = [
  'script_played',
  'script_started',
  'script_completed',
] as const

export type BuiltinRequirementType = (typeof BUILTIN_REQUIREMENT_TYPES)[number]

/** 判断是否为内置前置类型。 */
export function isBuiltinRequirementType(value: string): value is BuiltinRequirementType {
  return (BUILTIN_REQUIREMENT_TYPES as readonly string[]).includes(value)
}

/** 图节点携带的轨道摘要。 */
export interface GraphTrackSummary {
  type: string
  clips: number
}

/** 一条前置（`requires[]` 的一项）。 */
export interface GraphRequirement {
  /** 在 `requires[]` 的下标。 */
  index: number
  /** `script_played` / `script_started` / `script_completed` / 自定义。 */
  type: string
  /** 原样透传（内置只有 `{script}`；自定义由类型自己解释）。 */
  data: Record<string, JsonValue>
  role: 'builtin' | 'custom'
  /** 内置前置的目标 id；自定义为 `undefined`。 */
  scriptId?: string
  /** 目标脚本存在且 id 唯一。 */
  resolved?: boolean
  /** 可换目标/删除。 */
  editable: boolean
  /** 不可编辑原因：自定义前置 / 目标缺失 / 目标 id 重复 / 当前脚本无 id / 自引用。 */
  editableReason?: string
}

/** 一个触发器。 */
export interface GraphTrigger {
  /** 稳定身份：`meta.triggers[i].id`；缺失时 `type#index`（不写回脚本）。 */
  identity: string
  /** 在 `meta.triggers[]` 的下标。 */
  index: number
  type: string
  repeatable: boolean
  /** 秒；0 表示未设。 */
  delay: number
  requirements: GraphRequirement[]
  /** 该触发器 `requires` 数组的稳定哈希。 */
  requiresFingerprint: string
  /** 轻量条件对象（05-03 悬停摘要用；不进入脚本/布局）。 */
  conditions?: Record<string, JsonValue>
  /** 轻量 continuity 对象（有才带）。 */
  continuity?: Record<string, JsonValue>
}

/** 一个脚本节点。 */
export interface GraphNode {
  /** 相对路径，唯一。 */
  id: string
  path: string
  folder: string
  /** `meta.id`；缺失/写坏时为 `null`。 */
  scriptId?: string | null
  name: string
  author: string
  description: string
  dimension: string
  priority: number
  /** 秒；无限时为 0，必须同时看 `infinite`。 */
  duration: number
  infinite: boolean
  valid: boolean
  error?: string
  tracks: GraphTrackSummary[]
  triggers: GraphTrigger[]
  /** 本脚本全部内置前置的目标 id，去重（悬停/上游高亮用）。 */
  requiresTargets: string[]
  /** 前端布局算：处于环内。后端/索引不填。 */
  inCycle?: boolean
  /** 前端算：无前置且无入边。索引不填。 */
  isolated?: boolean
}

/** 一条边：被依赖 → 依赖方。 */
export interface GraphEdge {
  /** `${to}>${from}|${triggerIdentity}|${requirementIndex}`。 */
  key: string
  /** 被依赖脚本 path（上游）。 */
  from: string
  /** 依赖方脚本 path（下游）。 */
  to: string
  fromScriptId: string
  toScriptId: string
  triggerIdentity: string
  triggerIndex: number
  requirementIndex: number
  requirementType: string
}

/** 目录分组（只用于显示，不提供目录 CRUD）。 */
export interface GraphFolder {
  /** `""` = scripts 根。 */
  path: string
  parent: string | null
  depth: number
  directScriptCount: number
  totalScriptCount: number
}

export type GraphWarningKind =
  | 'invalid'
  | 'duplicate_id'
  | 'dangling'
  | 'self_reference'
  | 'unknown_trigger'
  | 'cycle'

/** 项目级 warning。 */
export interface GraphWarning {
  kind: GraphWarningKind
  severity: 'error' | 'warn'
  path: string
  nodeId?: string
  triggerIdentity?: string
  requirementIndex?: number
  message: string
}

/** 图统计。 */
export interface GraphStats {
  nodeCount: number
  edgeCount: number
  folderCount: number
  invalidCount: number
  /** 截断前的真实总数。 */
  warningCount: number
  warningsTruncated: boolean
  scanMillis: number
  /** 节点/边被截断（>800 / >2000）。 */
  truncated: boolean
}

/** 图响应。 */
export interface GraphData {
  version: number
  unchanged?: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
  folders: GraphFolder[]
  warnings: GraphWarning[]
  stats: GraphStats
}

/** 一个待索引的脚本文件（JSON 已解析；解析失败时 `error`）。 */
export interface GraphScriptFile {
  path: string
  doc?: JsonValue
  error?: string
}

/** `buildGraph` 选项。 */
export interface BuildGraphOptions {
  version: number
  /** 扫描耗时（服务层测量）。 */
  scanMillis?: number
  /** 节点上限；默认 800。 */
  maxNodes?: number
  /** 边上限；默认 2000。 */
  maxEdges?: number
  /** warning 列表上限；默认 200。 */
  maxWarnings?: number
  /** `meta` 白名单（来自 02 目录）；缺省时只用运行时最小集合。 */
  metaKeys?: readonly string[]
}

/** 截断上限（05-01；用户要求支持 10 万级脚本，渲染层负责裁剪）。 */
export const GRAPH_MAX_NODES = 100_000
export const GRAPH_MAX_EDGES = 300_000
export const GRAPH_MAX_WARNINGS = 200

/** 空图（真实空态用）。 */
export function emptyGraph(version: number): GraphData {
  return {
    version,
    nodes: [],
    edges: [],
    folders: [],
    warnings: [],
    stats: {
      nodeCount: 0,
      edgeCount: 0,
      folderCount: 0,
      invalidCount: 0,
      warningCount: 0,
      warningsTruncated: false,
      scanMillis: 0,
      truncated: false,
    },
  }
}
