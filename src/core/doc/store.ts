/**
 * 文档状态与命令撤销（03-05）。
 *
 * 四层物理分开：
 * - `doc`：要保存的脚本文档（`ScriptDoc`）；
 * - `session`：选择、播放头、缩放、轨道可见/锁定/静音、marker、A-B 循环、目录指纹；
 * - `derived`：有限末端、结构 issue、服务端 issue、目录漂移、预览状态（可重算）；
 * - `transport`：连接、请求/回执、预览帧。
 *
 * `commit` 顺序固定（无文档 → 失败；快照 `structuredClone`；apply；enforceStructure；入栈清 redo；
 * `dirty=true`；重算 derived；通知订阅者）。失败全回滚，撤销栈不变。
 *
 * 撤销是快照式（上限 200），只作用 `doc`，不碰 `session`；撤销后按 03-03 修复选择。
 */
import type { CatalogIndex } from '../schema/index.ts'
import { applyCommand } from './commands.ts'
import type { ApplyResult, DocCommand } from './commands.ts'
import { enforceStructure } from './enforce.ts'
import {
  ClipRegistry,
  liveClipKeys,
  locationKey,
  repairSelection,
  selectFirstCameraClip,
} from './identity.ts'
import { isJsonObject } from './json.ts'
import { parseDoc } from './parse.ts'
import { validateStructure } from './structural.ts'
import {
  createDerivedState,
  createSessionState,
  createTransportState,
} from './types.ts'
import type {
  AuthoringState,
  DerivedState,
  DocIssue,
  JsonObject,
  ScriptDoc,
  Selection,
  SessionState,
  TransportState,
} from './types.ts'

/** 快照：只含会写盘 / 编辑态数据，不含 session / derived / transport。 */
interface DocSnapshot {
  root: JsonObject
  authoring: AuthoringState
  clipAuthoring: Record<string, AuthoringState>
  /** 结构位置 → clipKey（撤销 / 重做精确恢复身份）。 */
  keys: Array<{ location: string; key: string }>
}

/** 变更事件（订阅者用于调度预览推送 / script.validate）。 */
export type StoreEvent =
  | 'open'
  | 'commit'
  | 'undo'
  | 'redo'
  | 'reset'
  | 'external'
  /** 仅内存态变化（06-06 作者态缓动）：不推送、不触发服务端校验，但刷新面板与撤销。 */
  | 'authoring'

export interface DocStoreOptions {
  catalog: CatalogIndex
  /** meta 键集合（只从 02 目录取）。 */
  metaKeys: readonly string[]
  /** 撤销上限（默认 200，沿用旧编辑器值）。 */
  snapshotLimit?: number
  /**
   * 连续编辑合并窗口（毫秒，默认 400）。
   *
   * 同一 `coalesceWith` 身份在此窗口内连续提交时只保留一个撤销项；
   * 判据取自成熟文本编辑器做法（窗口 + 串身份 + 打断条件），见 06-05。
   */
  coalesceWindowMs?: number
  /** 时钟（测试注入）。 */
  now?: () => number
  /** 提交 / 撤销 / 重做 / 打开后的通知（防抖推送、服务端校验由调用方接）。 */
  onEvent?: (event: StoreEvent, store: DocStore) => void
}

/** `commit` 的结果。 */
export interface CommitResult {
  ok: boolean
  error?: string
  /** 不阻止提交的提示（如插入帧切断路径端点相邻性）。 */
  warnings: string[]
}

/** 文档 store：唯一的写入口。 */
export class DocStore {
  private readonly catalog: CatalogIndex
  private readonly metaKeys: readonly string[]
  private readonly snapshotLimit: number
  private readonly listeners = new Set<(event: StoreEvent, store: DocStore) => void>()

  readonly registry = new ClipRegistry()
  readonly session: SessionState = createSessionState()
  readonly derived: DerivedState = createDerivedState()
  readonly transport: TransportState = createTransportState()

  private current: ScriptDoc | null = null
  private undoStack: DocSnapshot[] = []
  private redoStack: DocSnapshot[] = []
  private dirtyFlag = false
  /** 文档修订号：commit / undo / redo / open 后递增（04-05 `PanelContext.docRevision`）。 */
  private revisionCounter = 0
  /** 连续编辑合并：当前串身份 / 上次提交时刻 / 窗口毫秒。 */
  private coalesceKey: string | null = null
  private coalesceAt = 0
  private readonly coalesceWindowMs: number
  private readonly now: () => number

  constructor(options: DocStoreOptions) {
    this.catalog = options.catalog
    this.metaKeys = options.metaKeys
    this.snapshotLimit = options.snapshotLimit ?? 200
    this.coalesceWindowMs = options.coalesceWindowMs ?? 400
    this.now = options.now ?? (() => Date.now())
    if (options.onEvent !== undefined) {
      this.listeners.add(options.onEvent)
    }
  }

  /** 订阅变更事件；返回取消订阅函数。 */
  subscribe(listener: (event: StoreEvent, store: DocStore) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 当前文档；未打开为 `null`。 */
  get doc(): ScriptDoc | null {
    return this.current
  }

  /** 是否有未保存修改。 */
  get dirty(): boolean {
    return this.dirtyFlag
  }

  /** 文档修订号（只读）：`commit` / `undo` / `redo` / `open` 后递增；面板据此重取派生数据。 */
  get revision(): number {
    return this.revisionCounter
  }

  /** 打开一份已解析文档（打开 / 新建共用）；重置撤销栈。 */
  open(doc: ScriptDoc, path: string | null): void {
    this.current = doc
    this.registry.reset()
    this.registry.sync(doc)
    this.session.currentPath = path
    this.session.playhead = 0
    this.session.selection = selectFirstCameraClip(this.registry)
    this.session.clipKeys = []
    this.session.selectionInvalid = null
    this.session.markers = []
    this.session.previewRange = null
    this.session.loopRange = null
    this.revisionCounter += 1
    this.breakCoalescing()
    this.resetHistory()
    this.recomputeDerived()
    this.emit('open')
  }

  /** 新建文档标记为脏（尚未落盘）。 */
  markDirty(): void {
    this.dirtyFlag = true
  }

  /**
   * 关闭文档（04 `file.closeDoc`）：清空当前文档与会话状态，保留订阅与目录。
   *
   * 关闭不是销毁：再次 `open` 走完整打开流水线，历史清空、选择重新落到第一个 CAMERA 片段。
   */
  close(): void {
    this.current = null
    this.registry.reset()
    this.session.currentPath = null
    this.session.selection = { domain: 'none' }
    this.session.clipKeys = []
    this.session.selectionInvalid = null
    this.session.playhead = 0
    this.session.loopRange = null
    this.session.previewRange = null
    this.session.markers = []
    this.derived.contentEnd = 0
    this.derived.infinite = false
    this.derived.localIssues = []
    this.derived.serverIssues = []
    this.derived.serverIssuesStale = false
    this.derived.catalogIssues = []
    this.derived.previewStale = false
    this.undoStack = []
    this.redoStack = []
    this.dirtyFlag = false
    this.breakCoalescing()
    this.revisionCounter += 1
    this.emit('reset')
  }

  /** 保存成功：清 dirty。 */
  markSaved(): void {
    this.dirtyFlag = false
  }

  /**
   * 外部已落盘的文档同步进当前会话（05-06 / 05-07）。
   *
   * 不改撤销栈、不重载文件：用于「图/后台事务已经写盘，当前打开的是同一脚本」。
   * `markClean=true` 时清脏；否则保留原脏状态。
   */
  applyExternal(root: JsonObject, options: { markClean?: boolean } = {}): boolean {
    const parsed = parseDoc(root, { metaKeys: this.metaKeys })
    if (!parsed.ok) {
      return false
    }
    const doc = parsed.doc
    const previous = this.current
    if (previous !== null) {
      doc.authoring = previous.authoring
      doc.clipAuthoring = previous.clipAuthoring
    }
    this.current = doc
    this.registry.sync(doc, { restore: true })
    const previousSelection = this.session.selection
    this.session.selection = repairSelection(doc, this.registry, previousSelection)
    this.syncSelectionState(previousSelection)
    this.breakCoalescing()
    this.revisionCounter += 1
    if (options.markClean === true) {
      this.dirtyFlag = false
    }
    this.recomputeDerived()
    this.emit('external')
    return true
  }

  /** 目录指纹钉住（打开 / 重绑时由 binding / io 写入；不写进脚本）。 */
  setCatalogHash(hash: string | null): void {
    this.session.catalogHash = hash
    this.derived.catalogHash = hash
  }

  /** 结构检查（本地）：不阻断提交，只产出 issue。 */
  validateLocal(): DocIssue[] {
    if (this.current === null) {
      return []
    }
    return validateStructure(this.current, {
      catalog: this.catalog,
      metaKeys: this.metaKeys,
      registry: this.registry,
    })
  }

  /**
   * 唯一的写入口：命令对象 + 快照 + 回滚 + 结构不变式。
   *
   * 撤销合并（06-05：连续改同一节点多次只产生一个撤销项）：由 `coalesceWith` 声明本命令
   * 属于哪一串连续编辑；同一串在 `coalesceWindowMs` 内连续提交时**不推新快照**，
   * 因此撤销一次回到该串开始之前。窗口外、串身份变化、撤销/重做/打开都会打断合并。
   */
  commit(command: DocCommand, coalesceWith?: string): CommitResult {
    const doc = this.current
    if (doc === null) {
      return { ok: false, error: '没有打开的文档', warnings: [] }
    }
    const snapshot = snapshotOf(doc, this.registry)
    let result: ApplyResult
    try {
      result = applyCommand(
        { doc, registry: this.registry, catalog: this.catalog, metaKeys: this.metaKeys },
        command,
      )
      enforceStructure(doc, this.catalog)
    } catch (error) {
      this.restore(snapshot)
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        warnings: [],
      }
    }

    this.registry.sync(doc)
    const now = this.now()
    const canCoalesce = coalesceWith !== undefined
      && this.coalesceKey === coalesceWith
      && now - this.coalesceAt <= this.coalesceWindowMs
      && this.undoStack.length > 0
    if (canCoalesce) {
      // 栈顶快照已代表这串编辑开始之前的状态；只刷新窗口，不推新快照。
      this.coalesceAt = now
    } else {
      this.pushUndo(snapshot)
      this.coalesceKey = coalesceWith ?? null
      this.coalesceAt = now
    }
    this.redoStack = []
    this.dirtyFlag = true
    const previousSelection = this.session.selection
    this.session.selection = repairSelection(doc, this.registry, previousSelection)
    this.syncSelectionState(previousSelection)
    this.revisionCounter += 1
    this.recomputeDerived()
    this.emit('commit')
    return { ok: true, warnings: result.warnings }
  }

  /**
   * 写片段级仅内存态（06-06 作者态缓动）：进撤销栈、不写盘、不进预览推送。
   *
   * `mutate` 在片段作者态副本上就地修改；抛错则整次回滚且不进撤销栈。
   * 文档关闭后这些状态随快照一起丢弃（`close` 清空）。
   */
  commitClipAuthoring(clipKey: string, mutate: (state: AuthoringState) => void): CommitResult {
    const doc = this.current
    if (doc === null) {
      return { ok: false, error: '没有打开的文档', warnings: [] }
    }
    if (this.registry.handle(clipKey) === undefined) {
      return { ok: false, error: `片段不存在: ${clipKey}`, warnings: [] }
    }
    const snapshot = snapshotOf(doc, this.registry)
    try {
      const current = doc.clipAuthoring[clipKey]
      const draft: AuthoringState = current === undefined ? {} : structuredClone(current)
      mutate(draft)
      doc.clipAuthoring[clipKey] = draft
    } catch (error) {
      this.restore(snapshot)
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        warnings: [],
      }
    }
    this.pushUndo(snapshot)
    this.redoStack = []
    this.breakCoalescing()
    this.revisionCounter += 1
    this.emit('authoring')
    return { ok: true, warnings: [] }
  }

  /** 读片段级仅内存态（副本；没有返回 `{}`）。 */
  clipAuthoringOf(clipKey: string): AuthoringState {
    const doc = this.current
    if (doc === null) {
      return {}
    }
    const state = doc.clipAuthoring[clipKey]
    return state === undefined ? {} : structuredClone(state)
  }

  /** 撤销：快照恢复，只作用 doc；选择按 03-03 修复。 */
  undo(): boolean {
    const doc = this.current
    const snapshot = this.undoStack.pop()
    if (doc === null || snapshot === undefined) {
      return false
    }
    const previousSelection = this.session.selection
    this.redoStack.push(snapshotOf(doc, this.registry))
    this.restore(snapshot)
    this.syncSelectionState(previousSelection)
    this.breakCoalescing()
    this.revisionCounter += 1
    this.dirtyFlag = true
    this.recomputeDerived()
    this.emit('undo')
    return true
  }

  /** 重做。 */
  redo(): boolean {
    const doc = this.current
    const snapshot = this.redoStack.pop()
    if (doc === null || snapshot === undefined) {
      return false
    }
    const previousSelection = this.session.selection
    this.undoStack.push(snapshotOf(doc, this.registry))
    this.restore(snapshot)
    this.syncSelectionState(previousSelection)
    this.breakCoalescing()
    this.revisionCounter += 1
    this.dirtyFlag = true
    this.recomputeDerived()
    this.emit('redo')
    return true
  }

  /** 清空历史（打开 / 新建后调用）；不把 dirty 置 false（新建由 `markDirty` 单独控制）。 */
  resetHistory(): void {
    this.undoStack = []
    this.redoStack = []
    this.dirtyFlag = false
    this.breakCoalescing()
    this.emit('reset')
  }

  /**
   * 打断连续编辑合并（06-05）：撤销 / 重做 / 打开 / 关闭 / 外部同步后，
   * 下一串编辑必须重新获得自己的撤销项。
   */
  private breakCoalescing(): void {
    this.coalesceKey = null
    this.coalesceAt = 0
  }

  /**
   * 显式结束当前合并串（失焦、回车、切换记录等 UI 事件调用）。
   *
   * 与 `breakCoalescing` 同义；单独命名是因为 UI 侧语义是"结束一次连续输入"。
   */
  endCoalescing(): void {
    this.breakCoalescing()
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 撤销栈深度（自检 / 诊断用）。 */
  undoDepth(): number {
    return this.undoStack.length
  }

  /** 选择：先修复再写入（不允许指向不存在的片段 / 属性 / 帧）。 */
  select(selection: Selection): void {
    if (this.current === null) {
      this.session.selection = { domain: 'none' }
      this.session.clipKeys = []
      this.session.selectionInvalid = null
      return
    }
    const live = new Set(liveClipKeys(this.current, this.registry))
    const repaired = repairSelection(this.current, this.registry, selection)
    const previousKey = selection.clipKey
    const repairedKey = repaired.clipKey
    const deadTarget = previousKey !== undefined && !live.has(previousKey)
    if (repairedKey !== undefined && !live.has(repairedKey)) {
      this.session.selection = { domain: 'none' }
    } else {
      this.session.selection = repaired
    }
    this.session.selectionInvalid = deadTarget
      ? {
          reason: `选区目标已失效：片段 ${previousKey} 已不存在（删除或撤销）`,
          previous: selection,
        }
      : null
    const current = this.session.selection.clipKey
    this.session.clipKeys =
      current !== undefined && live.has(current) ? [current] : []
  }

  /**
   * 批选（04-05 `clipKeys`）：只保留当前文档里存在的片段键，按传入顺序去重。
   *
   * 主选区设为第一个键（`domain: 'clip'`）；空数组清空选择。
   */
  selectMany(clipKeys: readonly string[]): void {
    if (this.current === null) {
      this.session.clipKeys = []
      this.session.selection = { domain: 'none' }
      this.session.selectionInvalid = null
      return
    }
    const live = new Set(liveClipKeys(this.current, this.registry))
    const unique: string[] = []
    for (const key of clipKeys) {
      if (live.has(key) && !unique.includes(key)) {
        unique.push(key)
      }
    }
    this.session.clipKeys = unique
    this.session.selectionInvalid = null
    const first = unique[0]
    this.session.selection = first === undefined ? { domain: 'none' } : { domain: 'clip', clipKey: first }
  }

  /**
   * 选择修复后的状态同步：失效记录 + 批选剪枝。
   *
   * 存活判定用文档结构（`liveClipKeys`），不用注册表残留记录：删除片段的记录会保留两代
   * 以维持撤销后的键稳定，但面板不能把已删除片段当成还选中。
   *
   * 失效记录只在「上一次指向的片段这次不在了」时置位，供 04-05 的 `invalid` 态显示
   * 失效原因与撤销入口；下一次成功 `select` 会清空它。
   */
  private syncSelectionState(previous: Selection): void {
    const doc = this.current
    if (doc === null) {
      return
    }
    const live = new Set(liveClipKeys(doc, this.registry))
    const previousKey = previous.clipKey
    if (this.session.selection.clipKey !== undefined && !live.has(this.session.selection.clipKey)) {
      this.session.selection = { domain: 'none' }
    }
    if (previousKey !== undefined && !live.has(previousKey)) {
      this.session.selectionInvalid = {
        reason: `选区目标已失效：片段 ${previousKey} 已不存在（删除或撤销）`,
        previous,
      }
    }
    const kept = this.session.clipKeys.filter((key) => live.has(key))
    const selected = this.session.selection.clipKey
    if (selected !== undefined && live.has(selected) && !kept.includes(selected)) {
      kept.unshift(selected)
    }
    this.session.clipKeys = kept
  }

  /** 服务端 issue：整批替换；`stale` 由桥在断连时置位。 */
  setServerIssues(issues: DocIssue[], stale: boolean): void {
    this.derived.serverIssues = issues
    this.derived.serverIssuesStale = stale
  }

  /** 断连：保留上一批 issue，标记过期。 */
  markServerIssuesStale(): void {
    if (this.derived.serverIssues.length === 0) {
      return
    }
    this.derived.serverIssues = this.derived.serverIssues.map((issue) => ({ ...issue, stale: true }))
    this.derived.serverIssuesStale = true
  }

  /** 目录漂移 issue（重绑后写入）。 */
  setCatalogIssues(issues: DocIssue[]): void {
    this.derived.catalogIssues = issues
  }

  /** 连接状态（transport 层）。 */
  setConnected(connected: boolean): void {
    this.transport.connected = connected
    if (!connected) {
      this.markServerIssuesStale()
    }
  }

  /** 预览推送状态。 */
  markPreviewPushed(at: number): void {
    this.derived.previewStale = false
    this.transport.lastPreviewFrameAt = at
  }

  markPreviewStale(): void {
    this.derived.previewStale = true
  }

  /** 轨道视图状态（session 层）；不存在时补默认。 */
  trackView(type: string, index: number): { visible: boolean; locked: boolean; muted: boolean } {
    const key = `${type}:${index}`
    const existing = this.session.trackView[key]
    if (existing !== undefined) {
      return existing
    }
    const created = { visible: true, locked: false, muted: false }
    this.session.trackView[key] = created
    return created
  }

  /** 静音切换（只影响 session，不写盘）。 */
  setTrackMuted(type: string, index: number, muted: boolean): void {
    this.trackView(type, index).muted = muted
  }

  /** AUDIO 轨是否静音（预览裁剪谓词用）。 */
  isAudioMuted(index: number): boolean {
    return this.trackView('AUDIO', index).muted
  }

  /** 重新计算 derived 层（结构 issue + 有限末端）。 */
  recomputeDerived(): void {
    const doc = this.current
    if (doc === null) {
      this.derived.localIssues = []
      this.derived.contentEnd = 0
      this.derived.infinite = false
      return
    }
    this.derived.localIssues = validateStructure(doc, {
      catalog: this.catalog,
      metaKeys: this.metaKeys,
      registry: this.registry,
    })
    const content = deriveContent(doc)
    this.derived.contentEnd = content.contentEnd
    this.derived.infinite = content.infinite
  }

  private restore(snapshot: DocSnapshot): void {
    const parsed = parseDoc(snapshot.root, { metaKeys: this.metaKeys })
    if (!parsed.ok) {
      throw new Error(`快照无法恢复为文档: ${parsed.issues.map((issue) => issue.message).join('；')}`)
    }
    const doc = parsed.doc
    doc.authoring = snapshot.authoring
    doc.clipAuthoring = snapshot.clipAuthoring
    this.current = doc
    const preferred = new Map(snapshot.keys.map((entry) => [entry.location, entry.key]))
    this.registry.sync(doc, { restore: true, preferred })
    this.session.selection = repairSelection(doc, this.registry, this.session.selection)
  }

  private pushUndo(snapshot: DocSnapshot): void {
    this.undoStack.push(snapshot)
    if (this.undoStack.length > this.snapshotLimit) {
      this.undoStack.shift()
    }
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) {
      listener(event, this)
    }
  }
}

/** 文档快照：`structuredClone` 保留 `undefined` 字段（03-05 验收）。 */
function snapshotOf(doc: ScriptDoc, registry: ClipRegistry): DocSnapshot {
  const keys = registry.handles().map((handle) => ({
    location: locationKey(handle.inline, handle.trackIndex, handle.clipIndex),
    key: handle.key,
  }))
  return structuredClone({
    root: doc.root,
    authoring: doc.authoring,
    clipAuthoring: doc.clipAuthoring,
    keys,
  })
}

/** 片段是否永不结束：无限时长，或 `loop=true && loop_count<0`。 */
function isEffectivelyInfinite(clip: JsonObject): boolean {
  if (typeof clip.duration === 'number' && clip.duration < 0) {
    return true
  }
  return clip.loop === true && typeof clip.loop_count === 'number' && clip.loop_count < 0
}

/** 片段展开窗口末端（秒）。 */
function windowEnd(clip: JsonObject): number {
  const start = typeof clip.start_time === 'number' && Number.isFinite(clip.start_time) ? clip.start_time : 0
  const duration = typeof clip.duration === 'number' && Number.isFinite(clip.duration) ? clip.duration : 0
  const loop = clip.loop === true
  const count = typeof clip.loop_count === 'number' && Number.isFinite(clip.loop_count) ? clip.loop_count : -1
  return start + duration * (loop ? Math.max(1, count) : 1)
}

/**
 * 派生有限内容末端 / 无限性（`CinematicScript` 同口径）：
 * - 宏观循环无限（`macro_loop && macro_loop_count < 0`）→ 无限；
 * - 任一内联 / 独立片段永不结束 → 无限；
 * - 否则末端 = 内联片段展开末端最大值（独立片段无默认放置，不计入）。
 */
function deriveContent(doc: ScriptDoc): { contentEnd: number | null; infinite: boolean } {
  const macroLoop = doc.meta.macro_loop === true
  const macroCount = typeof doc.meta.macro_loop_count === 'number' ? doc.meta.macro_loop_count : -1
  if (macroLoop && macroCount < 0) {
    return { contentEnd: null, infinite: true }
  }

  const tracks = doc.timeline.tracks
  let end = 0
  if (Array.isArray(tracks)) {
    for (const track of tracks) {
      if (!isJsonObject(track) || !Array.isArray(track.clips)) {
        continue
      }
      for (const clip of track.clips) {
        if (!isJsonObject(clip)) {
          continue
        }
        if (isEffectivelyInfinite(clip)) {
          return { contentEnd: null, infinite: true }
        }
        end = Math.max(end, windowEnd(clip))
      }
    }
  }

  const standalone = doc.root.clips
  if (Array.isArray(standalone)) {
    for (const clip of standalone) {
      if (isJsonObject(clip) && isEffectivelyInfinite(clip)) {
        return { contentEnd: null, infinite: true }
      }
    }
  }

  return { contentEnd: end, infinite: false }
}
