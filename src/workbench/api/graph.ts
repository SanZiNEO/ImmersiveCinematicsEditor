/**
 * 05 图服务端口：脚本页唯一的读取 / 布局 / 关系写入面。
 *
 * 端口不暴露 `DocStore` 或 source 本体；面板只拿快照、布局文件和显式结果。
 * 生产实现（`ScriptGraphService` / `GraphLayoutStore` / `ScriptMutationService`）
 * 在 `src/workbench/app/`；测试可注入内存 source。
 */
import type { JsonValue } from '../../core/doc/types.ts'
import type { GraphData, GraphRequirement, BuiltinRequirementType } from '../../core/graph/types.ts'
import type { GraphLayoutFile } from '../../core/graph/layoutFile.ts'
import type { GraphViewState } from '../../core/graph/layout.ts'

/** 失效类型（05-08）。 */
export type GraphInvalidationKind = 'save' | 'delete' | 'new' | 'refactor' | 'requires' | 'manual' | 'reconnect'

/** 失效广播。 */
export interface GraphInvalidation {
  version: number
  kind: GraphInvalidationKind
  paths?: readonly string[]
}

/** 图读取端口。 */
export interface GraphServicePort {
  /** 是否已连接脚本来源（断连时图保留但标过期）。 */
  connected(): boolean
  /** 全量快照；`sinceVersion` 等于当前版本且缓存有效 → `unchanged=true`。 */
  snapshot(sinceVersion?: number): Promise<GraphData>
  /** 立即重扫。 */
  refresh(): Promise<GraphData>
  /** 最近一次成功快照（无 → `null`）。 */
  current(): GraphData | null
  /** 自增版本 + 标过期；面板据此 debounce 刷新。 */
  invalidate(kind: GraphInvalidationKind, paths?: readonly string[]): void
  subscribe(listener: (event: GraphInvalidation) => void): () => void
  version(): number
  stale(): boolean
  /** 最近一次失败原因（断连/扫描失败），成功后清空。 */
  lastError(): string | null
  /** 失效时 1s debounce 自动刷新（图可见时由面板调用）。 */
  scheduleRefresh(delayMs?: number): void
}

/** 布局读取结果。 */
export interface GraphLayoutLoadResult {
  status: 'loaded' | 'default' | 'corrupt' | 'too-large'
  file: GraphLayoutFile
  messages: string[]
}

/** 布局写入结果。 */
export interface GraphLayoutWriteResult {
  ok: boolean
  error?: 'too-large' | 'write-failed' | 'no-layout'
  message?: string
}

/** 布局端口（`graph-layout.json`，独立于 04 的 `layout.json`）。 */
export interface GraphLayoutServicePort {
  /** 当前内存布局（加载前为 `null`）。 */
  current(): GraphLayoutFile | null
  /** 首次挂载读一次；`known` 用于路径/scriptId 重绑定。 */
  load(known: readonly { path: string; scriptId?: string | null }[]): Promise<GraphLayoutLoadResult>
  saveView(view: GraphViewState): Promise<GraphLayoutWriteResult>
  saveNodePositions(nodes: Readonly<Record<string, { x: number; y: number; scriptId?: string | null }>>): Promise<GraphLayoutWriteResult>
  setCollapsed(collapsed: readonly string[]): Promise<GraphLayoutWriteResult>
  /** 清空手摆坐标与折叠，保留 view。 */
  resetLayout(): Promise<GraphLayoutWriteResult>
  /** 面板声明当前节点集变化后重绑定（不写盘）。 */
  rebind(known: readonly { path: string; scriptId?: string | null }[]): void
}

/** 图上改前置请求（05-07）。 */
export interface RequiresMutationRequest {
  path: string
  triggerIdentity: string
  /** 仅诊断/显示；定位以 identity 为准。 */
  triggerIndex: number
  requiresFingerprint: string
  operation: 'add' | 'update' | 'remove'
  index: number
  requirementType?: BuiltinRequirementType
  targetScriptId?: string
}

/** 变更失败码。 */
export type MutationErrorCode =
  | 'bad_path'
  | 'bad_trigger'
  | 'bad_index'
  | 'invalid_type'
  | 'stale_requires'
  | 'target_missing'
  | 'target_duplicate'
  | 'self_reference'
  | 'source_without_id'
  | 'custom_readonly'
  | 'lock_busy'
  | 'dirty_conflict'
  | 'write_failed'
  | 'offline'

/** 改一条前置的结果。 */
export type RequiresMutationResult =
  | {
      ok: true
      path: string
      triggerIdentity: string
      requirements: GraphRequirement[]
      graphVersion: number
    }
  | {
      ok: false
      code: MutationErrorCode
      message: string
      currentRequirements?: GraphRequirement[]
    }

/** 引用预览。 */
export type RefsPreviewResult =
  | {
      ok: true
      from: string
      to: string
      files: { path: string; references: number }[]
      totalReferences: number
      warnings: string[]
    }
  | { ok: false; code: MutationErrorCode | 'invalid_id' | 'target_exists' | 'source_missing'; message: string }

/** 引用应用。 */
export type RefsApplyResult =
  | { ok: true; changed: { path: string; references: number }[]; graphVersion: number }
  | {
      ok: false
      code: MutationErrorCode | 'invalid_id' | 'target_exists' | 'source_missing' | 'stale_preview'
      message: string
      rolledBack: boolean
      failedPaths?: string[]
    }

/** 关系写入端口（图上与编辑器页共用）。 */
export interface ScriptMutationServicePort {
  mutateRequires(request: RequiresMutationRequest): Promise<RequiresMutationResult>
  canUndo(path: string): boolean
  undo(path: string): Promise<RequiresMutationResult | { ok: false; code: MutationErrorCode; message: string }>
  previewRefs(from: string, to: string): Promise<RefsPreviewResult>
  applyRefs(from: string, to: string, expectedFiles: number): Promise<RefsApplyResult>
}

/** 脚本来源（生产 = WebUI，测试 = 内存）。 */
export interface ScriptSource {
  list(): Promise<string[]>
  load(path: string): Promise<JsonValue>
  save(path: string, doc: JsonValue): Promise<void>
  /** 断连判定；缺省视为可用（内存 source）。 */
  connected?(): boolean
}
