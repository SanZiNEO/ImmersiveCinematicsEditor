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
export type StoreEvent = 'open' | 'commit' | 'undo' | 'redo' | 'reset'

export interface DocStoreOptions {
  catalog: CatalogIndex
  /** meta 键集合（只从 02 目录取）。 */
  metaKeys: readonly string[]
  /** 撤销上限（默认 200，沿用旧编辑器值）。 */
  snapshotLimit?: number
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

  constructor(options: DocStoreOptions) {
    this.catalog = options.catalog
    this.metaKeys = options.metaKeys
    this.snapshotLimit = options.snapshotLimit ?? 200
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

  /** 打开一份已解析文档（打开 / 新建共用）；重置撤销栈。 */
  open(doc: ScriptDoc, path: string | null): void {
    this.current = doc
    this.registry.reset()
    this.registry.sync(doc)
    this.session.currentPath = path
    this.session.playhead = 0
    this.session.selection = selectFirstCameraClip(this.registry)
    this.resetHistory()
    this.recomputeDerived()
    this.emit('open')
  }

  /** 新建文档标记为脏（尚未落盘）。 */
  markDirty(): void {
    this.dirtyFlag = true
  }

  /** 保存成功：清 dirty。 */
  markSaved(): void {
    this.dirtyFlag = false
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

  /** 唯一的写入口：命令对象 + 快照 + 回滚 + 结构不变式。 */
  commit(command: DocCommand): CommitResult {
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
    this.pushUndo(snapshot)
    this.redoStack = []
    this.dirtyFlag = true
    this.session.selection = repairSelection(doc, this.registry, this.session.selection)
    this.recomputeDerived()
    this.emit('commit')
    return { ok: true, warnings: result.warnings }
  }

  /** 撤销：快照恢复，只作用 doc；选择按 03-03 修复。 */
  undo(): boolean {
    const doc = this.current
    const snapshot = this.undoStack.pop()
    if (doc === null || snapshot === undefined) {
      return false
    }
    this.redoStack.push(snapshotOf(doc, this.registry))
    this.restore(snapshot)
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
    this.undoStack.push(snapshotOf(doc, this.registry))
    this.restore(snapshot)
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
    this.emit('reset')
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
      return
    }
    this.session.selection = repairSelection(this.current, this.registry, selection)
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
