/**
 * 文档命令面与文档生命周期端口（04-04 / 04-05）。
 *
 * 04 不重写 03：写文档只走 `DocStore.commit`，保存/推送只走 `DocIo`，
 * 校验只走 `ValidationBridge`。本文件只声明面板与外壳可用的只读/写端口。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { DocIssue, Selection } from '../../core/doc/types.ts'

/** `commit` 结果（透传 03 `CommitResult`）。 */
export interface CommitOutcome {
  ok: boolean
  error?: string
  warnings: string[]
}

/** 保存结果（透传 03 `SaveResult`）。 */
export interface SaveOutcome {
  ok: boolean
  reason?: 'no-doc' | 'blocked' | 'conflict' | 'needs-path' | 'failed'
  message?: string
  path?: string
}

/** 校验结果（服务端权威 + 本地结构）。 */
export interface ValidateOutcome {
  ok: boolean
  issues: readonly DocIssue[]
  stale: boolean
}

/** 打开 / 新建 / 回滚结果。 */
export interface OpenOutcome {
  ok: boolean
  error?: string
}

/** 外壳 / 面板可见的文档摘要（只读，不暴露 store 内部）。 */
export interface DocumentSummary {
  /** `meta.id`；没有文档为 `null`。 */
  docId: string | null
  /** 当前文件路径；新建未落盘时为服务端临时路径。 */
  path: string | null
  /** `meta.name`。 */
  name: string
  dirty: boolean
  /** 文档修订号：commit / undo / redo / open 后递增。 */
  revision: number
  /** 本地 block 级 issue 数。 */
  blocking: number
  /** 本地 + 服务端 issue 总数。 */
  issueCount: number
  /** 服务端 issue 是否过期（断连）。 */
  stale: boolean
  connected: boolean
}

/**
 * 文档写命令面：面板只能通过它写文档（04-05）。
 *
 * 不暴露 `DocStore` / `ScriptDoc` 本体；`commit` 的失败与回滚由 03 保证。
 */
export interface DocumentCommands {
  readonly revision: number
  readonly dirty: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  commit(command: DocCommand): CommitOutcome
  undo(): boolean
  redo(): boolean
  /** 单主选区；宿主不替面板改选区，只接受请求。 */
  select(selection: Selection): void
  /** 批选：`clipKeys` 为多选集合；空数组 = 清空。 */
  selectMany(clipKeys: readonly string[]): void
}

/** 片段摘要（只读；04 的 demo 面板与 05+ 的真实面板都用它列片段）。 */
export interface ClipListEntry {
  clipKey: string
  /** 运行时 `clip.id`；未设置为 `undefined`。 */
  clipId?: string
  trackType: string
  inline: boolean
  startTime: number
  duration: number
}

/** 文档生命周期（打开 / 新建 / 保存 / 校验 / 回滚 / 关闭）。 */
export interface DocumentService {
  summary(): DocumentSummary
  /** 当前文档里的片段摘要（按文档顺序；不含已删除片段的残留记录）。 */
  clips(): ClipListEntry[]
  open(path: string): Promise<OpenOutcome>
  newDoc(): Promise<OpenOutcome>
  save(): Promise<SaveOutcome>
  /** 立即跑一次 `script.validate`（除 400ms 防抖外的显式入口）。 */
  validate(): Promise<ValidateOutcome>
  /** 从磁盘重载（外壳必须先做二次确认）。 */
  revert(): Promise<OpenOutcome>
  close(): void
  subscribe(listener: (summary: DocumentSummary) => void): () => void
}

/** 选区快照（面板只读）。 */
export interface SelectionSnapshot {
  selection: Selection
  clipKeys: readonly string[]
  revision: number
}
