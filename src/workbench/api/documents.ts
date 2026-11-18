/**
 * 文档命令面与文档生命周期端口（04-04 / 04-05）。
 *
 * 04 不重写 03：写文档只走 `DocStore.commit`，保存/推送只走 `DocIo`，
 * 校验只走 `ValidationBridge`。本文件只声明面板与外壳可用的只读/写端口。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { DocIssue, JsonObject, Selection, AuthoringState } from '../../core/doc/types.ts'
import type { GraphRequirement } from '../../core/graph/types.ts'

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
  /**
   * 提交一条文档命令。
   *
   * `coalesceWith`（06-05）：声明本命令属于哪一串连续编辑；同一串在合并窗口内
   * 连续提交只产生一个撤销项（撤销一次回到该串开始之前）。省略 = 每次独立撤销项。
   */
  commit(command: DocCommand, coalesceWith?: string): CommitOutcome
  /**
   * 批量提交（08-02 / 08-03）：同一操作的多条命令合成**一个**撤销项。
   *
   * 全部成功才返回 `ok`；任一命令失败时整批回滚（撤销回批前状态），不留半截写入。
   */
  commitBatch(commands: readonly DocCommand[], coalesceWith?: string): CommitOutcome
  undo(): boolean
  redo(): boolean
  /** 显式结束当前连续编辑串（失焦 / 回车 / 切换记录）。 */
  endCoalescing(): void
  /**
   * 写片段级仅内存态（06-06 作者态缓动）。
   *
   * 进撤销栈、不写盘、不进预览推送；`mutate` 在片段作者态副本上就地修改，
   * 抛错则整次回滚且不进撤销栈。
   */
  commitClipAuthoring(clipKey: string, mutate: (state: AuthoringState) => void): CommitOutcome
  /** 读片段级仅内存态（副本；没有返回 `{}`）。 */
  clipAuthoringOf(clipKey: string): AuthoringState
  /**
   * 读文档级组合定义（07-01；`doc.authoring.groups` 的副本）。
   *
   * 组合定义只活在编辑器内存里：保存 / 推送 / 导出都不含它。
   */
  authoringGroups(): JsonObject[]
  /**
   * 写文档级组合定义（07-01）：只改 `doc.authoring.groups`，不写盘、不进撤销栈、不置脏。
   *
   * 形状校验（id / name / track / members / builtin / source）由文档层负责，失败时返回错误原因。
   */
  setAuthoringGroups(groups: readonly JsonObject[]): CommitOutcome
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

/** 触发器只读视图（编辑器页触发器表单用；克隆，不暴露 store）。 */
export interface TriggerViewEntry {
  identity: string
  index: number
  type: string
  repeatable: boolean
  delay: number
  onEnter: boolean
  exitBuffer: number
  conditions: JsonObject
  continuity?: JsonObject
  requirements: GraphRequirement[]
  /** 当前 requires 数组的稳定指纹（图上改前置用）。 */
  requiresFingerprint: string
}

/** 片段只读视图（主轴用；不含对象/关键帧细节）。 */
export interface ClipViewEntry {
  clipKey: string
  clipId?: string
  start: number
  duration: number
  loop: boolean
  loopCount?: number
  /** 片段内循环模式（`repeat` / `pingpong`）；字段缺失为 `undefined`，不补默认值。 */
  loopMode?: string
  infinite: boolean
  /** 显示名：`clip.label` / `clip.name` / `clip.id` / `未命名片段`。 */
  label: string
  /** 被 paths / rule_bindings / exit / 条件 / 动作引用时 > 0。 */
  references: number
  /** 该片段有 block/warn 级 issue。 */
  warn: boolean
}

/** 轨道只读视图。 */
export interface TrackViewEntry {
  /** `type#index`（05-10）。 */
  trackId: string
  type: string
  index: number
  name: string
  clips: ClipViewEntry[]
}

/** 当前脚本的完整只读视图。 */
export interface ScriptView {
  docId: string | null
  path: string | null
  revision: number
  meta: {
    id: string
    name: string
    author: string
    description: string
    dimension: string
    priority: number
  }
  triggers: TriggerViewEntry[]
  tracks: TrackViewEntry[]
  loopStart: number | null
  loopEnd: number | null
  contentEnd: number | null
  infinite: boolean
}

/** UI 预览范围（session，不写文档）。 */
export interface PreviewRange {
  start: number
  end: number
}

/** 轨道会话状态。 */
export interface TrackSessionView {
  visible: boolean
  locked: boolean
  muted: boolean
}

/** 主轴 / 标尺会话快照（只读）。 */
export interface SessionView {
  playhead: number
  pxPerSecond: number
  markers: readonly number[]
  previewRange: PreviewRange | null
  /** trackId → 会话状态。 */
  trackView: Readonly<Record<string, TrackSessionView>>
}

/** 文档生命周期（打开 / 新建 / 保存 / 校验 / 回滚 / 关闭）。 */
export interface DocumentService {
  summary(): DocumentSummary
  /** 当前文档里的片段摘要（按文档顺序；不含已删除片段的残留记录）。 */
  clips(): ClipListEntry[]
  /** 当前脚本只读视图（轨道 / 触发器 / A-B / 有限末端）；无文档为 `null`。 */
  view(): ScriptView | null
  /**
   * 脚本 `meta` 的只读克隆（完整 21+ 字段，不只 `view().meta` 暴露的那 6 个）。
   *
   * `meta` 段字段全在 02 目录里，面板按目录渲染，因此这里必须给完整对象；
   * 无文档时返回 `null`。
   */
  metaObject(): JsonObject | null
  /**
   * 当前文档根的只读深拷贝（meta / timeline / clips / paths / rules / rule_bindings 全量）。
   *
   * 面板每次现算，不缓存文档副本；无文档返回 `null`。
   */
  root(): JsonObject | null
  /** 片段 `objects` 的只读克隆；片段不存在为 `null`。 */
  clipObjects(clipKey: string): JsonObject | null
  /** 主轴会话快照（播放头 / 缩放 / 标记 / 预览范围 / 轨道状态）。 */
  sessionView(): SessionView
  setPlayhead(time: number): void
  setPxPerSecond(value: number): void
  addMarker(time: number): void
  removeMarker(time: number): void
  clearMarkers(): void
  setPreviewRange(range: PreviewRange | null): void
  /** `trackId` = `type#index`。 */
  setTrackView(trackId: string, patch: Partial<TrackSessionView>): void
  open(path: string): Promise<OpenOutcome>
  newDoc(): Promise<OpenOutcome>
  save(): Promise<SaveOutcome>
  /** 立即跑一次 `script.validate`（除 400ms 防抖外的显式入口）。 */
  validate(): Promise<ValidateOutcome>
  /** 当前本地结构检查结果（不发服务端请求；回放检查的第一道门用）。 */
  localIssues(): DocIssue[]
  /**
   * 当前文档的序列化文本（内存中派生，不写盘、不烘焙）。
   *
   * 回放检查推送时用它；无文档返回空串。
   */
  serialize(): string
  /** 立即推送当前脚本（`editor.pushScript`）；ack 只表示「已发出」。 */
  pushPreview(): Promise<{ ok: boolean; reason?: string }>
  /** 让游戏把预览跳到指定时间。 */
  seekPreview(time: number): Promise<void>
  /** 预览通道是否连通（宿主 WS 连接状态）。 */
  previewConnected(): boolean
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
