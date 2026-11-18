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
import { collectClipReferences, liveClipKeys } from '../../core/doc/identity.ts'
import type { ClipRegistry } from '../../core/doc/identity.ts'
import { cloneJson, isJsonObject } from '../../core/doc/json.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { CommitResult } from '../../core/doc/store.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { AuthoringState, DocIssue, JsonObject, Selection } from '../../core/doc/types.ts'
import { ValidationBridge } from '../../core/doc/validate.ts'
import type { ValidationTransport } from '../../core/doc/validate.ts'
import type {
  ClipListEntry,
  ClipViewEntry,
  CommitOutcome,
  DocumentCommands,
  DocumentService,
  DocumentSummary,
  OpenOutcome,
  PreviewRange,
  SaveOutcome,
  ScriptView,
  SessionView,
  TrackSessionView,
  TrackViewEntry,
  TriggerViewEntry,
  ValidateOutcome,
} from '../api/documents.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import {
  duplicateTriggerIds,
  parseRequirement,
  requiresArrayOf,
  triggerFingerprint,
  triggerIdentityOf,
} from '../../core/graph/requirements.ts'

/** 片段显示名：label / name / id / 未命名片段。 */
function readClipLabel(clip: JsonObject, id: string | undefined): string {
  for (const key of ['label', 'name'] as const) {
    const value = clip[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return id !== undefined && id.length > 0 ? id : '未命名片段'
}

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
      if (event === 'commit' || event === 'undo' || event === 'redo' || event === 'external') {
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

  commit(command: DocCommand, coalesceWith?: string): CommitOutcome {
    const result: CommitResult = this.store.commit(command, coalesceWith)
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

  /** 显式结束连续编辑串（失焦 / 回车 / 切换记录）。 */
  endCoalescing(): void {
    this.store.endCoalescing()
  }

  /** 写片段级仅内存态（06-06）：进撤销栈、不写盘、不推送。 */
  commitClipAuthoring(clipKey: string, mutate: (state: AuthoringState) => void): CommitOutcome {
    const result: CommitResult = this.store.commitClipAuthoring(clipKey, mutate)
    if (!result.ok) {
      this.diagnostics.report({
        severity: 'warning',
        source: 'document',
        message: '作者态写入被拒绝',
        detail: result.error ?? '',
      })
    }
    return {
      ok: result.ok,
      warnings: result.warnings,
      ...(result.error === undefined ? {} : { error: result.error }),
    }
  }

  /** 读片段级仅内存态（副本）。 */
  clipAuthoringOf(clipKey: string): AuthoringState {
    return this.store.clipAuthoringOf(clipKey)
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

  /** 当前脚本只读视图：轨道、触发器、A-B、有限末端（全是克隆，不暴露 store）。 */
  view(): ScriptView | null {
    const doc = this.store.doc
    if (doc === null) {
      return null
    }
    const meta = doc.meta
    const metaText = (key: string): string => {
      const value = meta[key]
      return typeof value === 'string' ? value : ''
    }
    const metaNumber = (key: string): number => {
      const value = meta[key]
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    const triggers: TriggerViewEntry[] = []
    const rawTriggers = Array.isArray(meta.triggers) ? meta.triggers : []
    const duplicateIds = duplicateTriggerIds(rawTriggers)
    for (let index = 0; index < rawTriggers.length; index += 1) {
      const raw = rawTriggers[index]
      if (!isJsonObject(raw)) {
        continue
      }
      const requirements = requiresArrayOf(raw).map((entry, requirementIndex) => {
        const parsed = parseRequirement(entry, requirementIndex)
        if (parsed.role === 'builtin') {
          return {
            ...parsed,
            editable: true,
          }
        }
        return parsed
      })
      const conditions = isJsonObject(raw.conditions) ? cloneJson(raw.conditions) as JsonObject : {}
      const continuity = isJsonObject(raw.continuity) ? cloneJson(raw.continuity) as JsonObject : undefined
      triggers.push({
        identity: triggerIdentityOf(raw, index, duplicateIds),
        index,
        type: typeof raw.type === 'string' ? raw.type : '',
        repeatable: raw.repeatable === true,
        delay: typeof raw.delay === 'number' && Number.isFinite(raw.delay) ? Math.max(0, raw.delay) : 0,
        onEnter: raw.on_enter === true,
        exitBuffer: typeof raw.exit_buffer === 'number' && Number.isFinite(raw.exit_buffer) ? Math.max(0, raw.exit_buffer) : 0,
        conditions,
        ...(continuity === undefined ? {} : { continuity }),
        requirements,
        requiresFingerprint: triggerFingerprint(raw),
      })
    }

    const referenceCounts = new Map<string, number>()
    for (const reference of collectClipReferences(doc)) {
      referenceCounts.set(reference.clipId, (referenceCounts.get(reference.clipId) ?? 0) + 1)
    }
    const issueKeys = new Set<string>()
    for (const issue of [...this.store.derived.localIssues, ...this.store.derived.serverIssues]) {
      if (issue.clipKey !== undefined) {
        issueKeys.add(issue.clipKey)
      }
    }

    const tracks: TrackViewEntry[] = []
    const rawTracks = Array.isArray(doc.timeline.tracks) ? doc.timeline.tracks : []
    for (let index = 0; index < rawTracks.length; index += 1) {
      const track = rawTracks[index]
      if (!isJsonObject(track)) {
        continue
      }
      const type = typeof track.type === 'string' ? track.type : ''
      const name = typeof track.name === 'string' ? track.name : ''
      const clips: ClipViewEntry[] = []
      const rawClips = Array.isArray(track.clips) ? track.clips : []
      for (const rawClip of rawClips) {
        if (!isJsonObject(rawClip)) {
          continue
        }
        const clipKey = this.store.registry.keyOf(rawClip)
        if (clipKey === undefined) {
          continue
        }
        const start = typeof rawClip.start_time === 'number' && Number.isFinite(rawClip.start_time) ? rawClip.start_time : 0
        const duration = typeof rawClip.duration === 'number' && Number.isFinite(rawClip.duration) ? rawClip.duration : 0
        const loop = rawClip.loop === true
        const loopCount = typeof rawClip.loop_count === 'number' && Number.isFinite(rawClip.loop_count)
          ? rawClip.loop_count
          : undefined
        const infinite = duration < 0 || (loop && (loopCount ?? -1) < 0)
        const id = typeof rawClip.id === 'string' ? rawClip.id : undefined
        const label = readClipLabel(rawClip, id)
        const references = id === undefined ? 0 : referenceCounts.get(id) ?? 0
        clips.push({
          clipKey,
          ...(id === undefined ? {} : { clipId: id }),
          start,
          duration,
          loop,
          ...(loopCount === undefined ? {} : { loopCount }),
          infinite,
          label,
          references,
          warn: issueKeys.has(clipKey),
        })
      }
      tracks.push({
        trackId: `${type}#${index}`,
        type,
        index,
        name,
        clips,
      })
    }

    const loopStart = typeof doc.timeline.loop_start === 'number' && Number.isFinite(doc.timeline.loop_start)
      ? doc.timeline.loop_start
      : null
    const loopEnd = typeof doc.timeline.loop_end === 'number' && Number.isFinite(doc.timeline.loop_end)
      ? doc.timeline.loop_end
      : null

    return {
      docId: this.summary().docId,
      path: this.store.session.currentPath,
      revision: this.store.revision,
      meta: {
        id: metaText('id'),
        name: metaText('name'),
        author: metaText('author'),
        description: metaText('description'),
        dimension: metaText('dimension'),
        priority: metaNumber('priority'),
      },
      triggers,
      tracks,
      loopStart,
      loopEnd,
      contentEnd: this.store.derived.contentEnd,
      infinite: this.store.derived.infinite,
    }
  }

  clipObjects(clipKey: string): JsonObject | null {
    const handle = this.store.registry.handle(clipKey)
    if (handle === undefined) {
      return null
    }
    const objects = handle.clip.objects
    return isJsonObject(objects) ? cloneJson(objects) as JsonObject : {}
  }

  sessionView(): SessionView {
    const session = this.store.session
    const trackView: Record<string, TrackSessionView> = {}
    for (const [key, value] of Object.entries(session.trackView)) {
      const index = key.lastIndexOf(':')
      if (index < 0) {
        continue
      }
      const type = key.slice(0, index)
      const trackIndex = key.slice(index + 1)
      trackView[`${type}#${trackIndex}`] = { ...value }
    }
    return {
      playhead: session.playhead,
      pxPerSecond: session.pxPerSecond,
      markers: [...session.markers],
      previewRange: session.previewRange === null ? null : { ...session.previewRange },
      trackView,
    }
  }

  setPlayhead(time: number): void {
    if (!Number.isFinite(time)) {
      return
    }
    this.store.session.playhead = Math.max(0, time)
    this.emit()
  }

  setPxPerSecond(value: number): void {
    if (!Number.isFinite(value)) {
      return
    }
    this.store.session.pxPerSecond = Math.min(500, Math.max(5, value))
    this.emit()
  }

  addMarker(time: number): void {
    if (!Number.isFinite(time) || time < 0) {
      return
    }
    const rounded = Math.round(time * 1000) / 1000
    const markers = this.store.session.markers.filter((marker) => Math.abs(marker - rounded) > 0.001)
    markers.push(rounded)
    markers.sort((left, right) => left - right)
    this.store.session.markers = markers
    this.emit()
  }

  removeMarker(time: number): void {
    if (!Number.isFinite(time)) {
      return
    }
    let nearest: number | undefined
    for (const marker of this.store.session.markers) {
      if (nearest === undefined || Math.abs(marker - time) < Math.abs(nearest - time)) {
        nearest = marker
      }
    }
    if (nearest === undefined || Math.abs(nearest - time) > 0.001) {
      return
    }
    this.store.session.markers = this.store.session.markers.filter((marker) => marker !== nearest)
    this.emit()
  }

  clearMarkers(): void {
    this.store.session.markers = []
    this.emit()
  }

  setPreviewRange(range: PreviewRange | null): void {
    if (range === null) {
      this.store.session.previewRange = null
      this.emit()
      return
    }
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1) {
      this.store.session.previewRange = null
      this.emit()
      return
    }
    this.store.session.previewRange = { start, end }
    this.emit()
  }

  setTrackView(trackId: string, patch: Partial<TrackSessionView>): void {
    const index = trackId.lastIndexOf('#')
    if (index <= 0) {
      return
    }
    const type = trackId.slice(0, index)
    const trackIndexText = trackId.slice(index + 1)
    const trackIndex = Number(trackIndexText)
    if (!Number.isInteger(trackIndex) || trackIndex < 0) {
      return
    }
    const key = `${type}:${trackIndex}`
    const current = this.store.session.trackView[key] ?? { visible: true, locked: false, muted: false }
    this.store.session.trackView[key] = {
      visible: patch.visible ?? current.visible,
      locked: patch.locked ?? current.locked,
      muted: patch.muted ?? current.muted,
    }
    this.emit()
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
