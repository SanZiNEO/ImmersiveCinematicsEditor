/**
 * 文档服务（04-04 / 04-05）：03 `DocStore` + `DocIo` + `ValidationBridge` 的唯一门面。
 *
 * 04 不重写 03 的打开/保存/推送/校验语义；这里只做：
 * - 把 `DocStore` / `DocIo` / `ValidationBridge` 组装成一个应用服务；
 * - 暴露只读摘要与片段列表；
 * - 保证「保存成功才清脏」「保存失败保留脏」「校验失败保留上一批 issue」。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { DocIo } from '../../core/doc/io.ts'
import type { DocTransport, OpenResult, SaveResult } from '../../core/doc/io.ts'
import { liveClipKeys } from '../../core/doc/identity.ts'
import type { ClipRegistry } from '../../core/doc/identity.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { CommitResult } from '../../core/doc/store.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { DocIssue, Selection } from '../../core/doc/types.ts'
import { ValidationBridge } from '../../core/doc/validate.ts'
import type { ValidationTransport } from '../../core/doc/validate.ts'
import type {
  ClipListEntry,
  CommitOutcome,
  DocumentCommands,
  DocumentService,
  DocumentSummary,
  OpenOutcome,
  SaveOutcome,
  ValidateOutcome,
} from '../api/documents.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'

/** 文档服务依赖。 */
export interface DocumentServiceImplOptions {
  catalog: CatalogIndex
  transport: DocTransport & ValidationTransport
  diagnostics: DiagnosticSink
  /** 草稿钩子：脏后 2s 落草稿（04-09）；缺省不落。 */
  onDirty?: (payload: string, revision: number) => void
  /** 保存成功钩子（删草稿）。 */
  onSaved?: () => void
  /** 推送防抖毫秒（03 默认 160）。 */
  pushDebounceMs?: number
  /** 校验防抖毫秒（03 默认 400）。 */
  validateDebounceMs?: number
}

/** 文档服务实现：`DocumentService` + `DocumentCommands` 同源。 */
export class DocumentServiceImpl implements DocumentService, DocumentCommands {
  readonly store: DocStore
  readonly io: DocIo
  readonly bridge: ValidationBridge

  private readonly diagnostics: DiagnosticSink
  private readonly onDirty: ((payload: string, revision: number) => void) | undefined
  private readonly onSaved: (() => void) | undefined
  private readonly listeners = new Set<(summary: DocumentSummary) => void>()
  private dirtyTimer: ReturnType<typeof setTimeout> | undefined = undefined

  constructor(options: DocumentServiceImplOptions) {
    this.diagnostics = options.diagnostics
    this.onDirty = options.onDirty
    this.onSaved = options.onSaved
    const keys = metaKeys(options.catalog)
    this.store = new DocStore({ catalog: options.catalog, metaKeys: keys })
    this.io = new DocIo({
      transport: options.transport,
      catalog: options.catalog,
      metaKeys: keys,
      store: this.store,
      ...(options.pushDebounceMs === undefined ? {} : { debounceMs: options.pushDebounceMs }),
    })
    this.bridge = new ValidationBridge({
      transport: options.transport,
      store: this.store,
      ...(options.validateDebounceMs === undefined ? {} : { debounceMs: options.validateDebounceMs }),
    })
    this.store.subscribe((event) => {
      if (event === 'commit' || event === 'undo' || event === 'redo') {
        this.bridge.schedule()
        this.scheduleDraft()
      }
      this.emit()
    })
  }

  // ── DocumentCommands ─────────────────────────────────────────

  get revision(): number {
    return this.store.revision
  }

  get dirty(): boolean {
    return this.store.dirty
  }

  get canUndo(): boolean {
    return this.store.canUndo()
  }

  get canRedo(): boolean {
    return this.store.canRedo()
  }

  commit(command: DocCommand): CommitOutcome {
    const result: CommitResult = this.store.commit(command)
    if (!result.ok) {
      this.diagnostics.report({
        severity: 'warning',
        source: 'document',
        message: '文档命令被拒绝',
        detail: result.error ?? '',
      })
    }
    return {
      ok: result.ok,
      warnings: result.warnings,
      ...(result.error === undefined ? {} : { error: result.error }),
    }
  }

  undo(): boolean {
    return this.store.undo()
  }

  redo(): boolean {
    return this.store.redo()
  }

  select(selection: Selection): void {
    this.store.select(selection)
    this.emit()
  }

  selectMany(clipKeys: readonly string[]): void {
    this.store.selectMany(clipKeys)
    this.emit()
  }

  // ── DocumentService ──────────────────────────────────────────

  summary(): DocumentSummary {
    const doc = this.store.doc
    const local = this.store.derived.localIssues
    const server = this.store.derived.serverIssues
    const meta = doc?.meta
    const name = isJsonObject(meta) && typeof meta.name === 'string' ? meta.name : ''
    const id = isJsonObject(meta) && typeof meta.id === 'string' ? meta.id : null
    return {
      docId: doc === null ? null : id,
      path: this.store.session.currentPath,
      name,
      dirty: this.store.dirty,
      revision: this.store.revision,
      blocking: local.filter((issue) => issue.severity === 'block').length,
      issueCount: local.length + server.length,
      stale: this.store.derived.serverIssuesStale,
      connected: this.store.transport.connected,
    }
  }

  clips(): ClipListEntry[] {
    const doc = this.store.doc
    if (doc === null) {
      return []
    }
    const registry: ClipRegistry = this.store.registry
    const entries: ClipListEntry[] = []
    for (const key of liveClipKeys(doc, registry)) {
      const handle = registry.handle(key)
      if (handle === undefined) {
        continue
      }
      const clip = handle.clip
      const start = typeof clip.start_time === 'number' && Number.isFinite(clip.start_time) ? clip.start_time : 0
      const duration = typeof clip.duration === 'number' && Number.isFinite(clip.duration) ? clip.duration : 0
      const id = typeof clip.id === 'string' ? clip.id : undefined
      entries.push({
        clipKey: key,
        trackType: handle.trackType,
        inline: handle.inline,
        startTime: start,
        duration,
        ...(id === undefined ? {} : { clipId: id }),
      })
    }
    return entries
  }

  async open(path: string): Promise<OpenOutcome> {
    const result: OpenResult = await this.io.open(path)
    this.emit()
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? '打开失败' }
  }

  async newDoc(): Promise<OpenOutcome> {
    const result: OpenResult = await this.io.newDocument()
    this.emit()
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? '新建失败' }
  }

  async save(): Promise<SaveOutcome> {
    const result: SaveResult = await this.io.save()
    if (result.ok) {
      this.onSaved?.()
      this.emit()
      return { ok: true, ...(result.path === undefined ? {} : { path: result.path }) }
    }
    this.emit()
    return {
      ok: false,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.message === undefined ? {} : { message: result.message }),
    }
  }

  async validate(): Promise<ValidateOutcome> {
    this.bridge.cancel()
    await this.bridge.flush()
    const issues: DocIssue[] = [...this.store.derived.localIssues, ...this.store.derived.serverIssues]
    return {
      ok: issues.every((issue) => issue.severity === 'warn' || issue.severity === 'info'),
      issues,
      stale: this.store.derived.serverIssuesStale,
    }
  }

  async revert(): Promise<OpenOutcome> {
    const path = this.store.session.currentPath
    if (path === null) {
      return { ok: false, error: '没有可重载的路径' }
    }
    return this.open(path)
  }

  close(): void {
    this.bridge.cancel()
    this.clearDraftTimer()
    this.store.close()
    this.emit()
  }

  subscribe(listener: (summary: DocumentSummary) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 连接状态变化（宿主 WS 事件转发）。 */
  setConnected(connected: boolean): void {
    this.store.setConnected(connected)
    this.emit()
  }

  /** 释放：停掉防抖、订阅与推送定时器。 */
  dispose(): void {
    this.clearDraftTimer()
    this.bridge.dispose()
    this.io.dispose()
    this.listeners.clear()
  }

  private scheduleDraft(): void {
    const onDirty = this.onDirty
    if (onDirty === undefined) {
      return
    }
    this.clearDraftTimer()
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = undefined
      const doc = this.store.doc
      const summary = this.summary()
      if (doc === null || summary.docId === null || !this.store.dirty) {
        return
      }
      onDirty(JSON.stringify(doc.root), this.store.revision)
    }, 2000)
  }

  private clearDraftTimer(): void {
    if (this.dirtyTimer !== undefined) {
      clearTimeout(this.dirtyTimer)
      this.dirtyTimer = undefined
    }
  }

  private emit(): void {
    const summary = this.summary()
    for (const listener of this.listeners) {
      listener(summary)
    }
  }
}
