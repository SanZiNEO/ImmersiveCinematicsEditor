/**
 * `core.timeline` 的面板 / 命令共享控制器（05-09 / 05-10 / 05-11 / 05-12）。
 *
 * 唯一事实来源仍是 03 文档：
 * - 读：`DocumentService.view()/sessionView()/clipObjects()`；
 * - 写文档：`DocumentCommands.commit()`；
 * - 写会话：`DocumentService.setPlayhead/setPxPerSecond/...`；
 * - 选区：`DocumentCommands.select/selectMany`（与 03 的 `clipKeys` 同源）。
 *
 * 这里不复制几何算法，也不缓存跨 revision 的文档数据；`view` 只在 revision 变化时重取，
 * `session` 每次宿主 emit 都刷新（播放头 / 缩放 / 标记 / 轨道可见性）。
 */
import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import type { DocCommand } from '../../core/doc/commands.ts'
import { cloneJson } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import { documentSnapshot } from '../../features/paths/docAccess.ts'
import { pathsOfClip } from '../../features/paths/integrity.ts'
import type { AffectedPath } from '../../features/paths/integrity.ts'
import {
  clampPxPerSecond,
  computeDisplayRange,
  fitPxPerSecond,
  screenXToTime,
  snapTime,
  SNAP_THRESHOLD_PX,
  type DisplayRange,
  type SnapContext,
  type TimelineScale,
} from '../../core/timeline/geometry.ts'
import type { PanelContext, StatusApi } from '../../workbench/api/context.ts'
import type {
  ClipViewEntry,
  CommitOutcome,
  DocumentCommands,
  DocumentService,
  DocumentSummary,
  PreviewRange,
  ScriptView,
  SelectionSnapshot,
  SessionView,
  TrackSessionView,
  TrackViewEntry,
} from '../../workbench/api/documents.ts'
import type { PreviewServicePort } from '../../workbench/api/preview.ts'
import type { SelectionServicePort } from '../../workbench/api/selection.ts'
import type { ServiceRegistry } from '../../workbench/api/services.ts'
import {
  CATALOG_SERVICE,
  DOCUMENT_COMMANDS,
  DOCUMENT_SERVICE,
  PREVIEW_SERVICE,
  SELECTION_SERVICE,
  STATUS_SERVICE,
} from '../../workbench/api/tokens.ts'
import {
  BUILTIN_TRACK_TYPES,
  clipBodyEnd,
  findClip,
  findTrack,
  formatSeconds,
  isBuiltinTrackType,
  nextClipId,
  trackLabel,
  visibleClipKeys,
  type TrackTypeOption,
} from './model.ts'
import { TimelineViewState } from './viewState.ts'
import { TimelineInteractionState } from './interactionState.ts'
import type { TimelineClipboardEntry, TimelineTool } from './interactionState.ts'

// 06-12 拆分后，这两类状态的唯一定义在各自模块；这里 re-export 保持调用点不变。
export type { TimelineClipboardEntry, TimelineTool } from './interactionState.ts'
export { TimelineViewState } from './viewState.ts'
export { TimelineInteractionState } from './interactionState.ts'

/** 新建片段能力检查结果。 */
export interface AddClipCheck {
  ok: boolean
  reason?: string
}

const NO_SELECTION: SelectionSnapshot = {
  selection: { domain: 'none' },
  clipKeys: [],
  revision: 0,
}

const DEFAULT_TRACK_SESSION: TrackSessionView = { visible: true, locked: false, muted: false }

/** 建一条默认会话快照（服务缺失 / 首次渲染前的占位，不是文档数据）。 */
function emptySession(): SessionView {
  return {
    playhead: 0,
    pxPerSecond: 80,
    markers: [],
    previewRange: null,
    trackView: {},
  }
}

/** 取字段目录里的默认值；没有可用默认值时用调用方给的固定值。 */
function defaultValueOf(
  catalog: CatalogIndex | undefined,
  type: string,
  path: string,
  fallback: JsonValue,
): JsonValue {
  const def = catalog?.objectDef(type, path)
  if (def !== undefined && def.hasDefault && def.default !== null && def.default !== undefined) {
    return def.default as JsonValue
  }
  return fallback
}

/** 控制器依赖（激活时注入；面板 / 命令共用同一实例）。 */
export class TimelineController {
  private readonly commands: DocumentCommands
  private readonly documents: DocumentService
  private readonly selectionService: SelectionServicePort | undefined
  private readonly preview: PreviewServicePort | undefined
  private readonly status: StatusApi | undefined
  private readonly catalog: CatalogIndex | undefined
  private readonly unsubscribers: Array<() => void> = []
  private disposed = false
  private lastRevision = Number.NaN

  /** 当前文档只读视图（revision 变化才重取）。 */
  readonly view: ShallowRef<ScriptView | null>
  /** 会话快照（每次 emit 重新读）。 */
  readonly session: ShallowRef<SessionView>
  /** 03 共享选区快照。 */
  readonly selection: ShallowRef<SelectionSnapshot>

  /** 选择工具 / 刀片工具。 */
  readonly tool: Ref<TimelineTool>
  /** 吸附开关（会话级）。 */
  readonly snapEnabled: Ref<boolean>
  /** 会话剪贴板（不写系统剪贴板、不写文件）。 */
  readonly clipboard: ShallowRef<readonly TimelineClipboardEntry[]>

  /** 07-05 §四：删除被路径引用片段前的待确认计划（非空时暂停提交）。 */
  readonly pendingDelete = ref<{
    affected: AffectedPath[]
    command: unknown
    clipboard: readonly TimelineClipboardEntry[] | null
  } | null>(null)

  /** 轨道区横向滚动（像素）；只属于主轴视图。 */
  readonly scrollLeft: Ref<number>
  /** 轨道区可视宽度（像素）。 */
  readonly viewportWidth: Ref<number>
  /** 面板高度（像素；<240 切紧凑档）。 */
  readonly panelHeight: Ref<number>
  /** 当前活动轨道（工具栏「新建片段」的目标）。 */
  readonly activeTrackId: Ref<string | null>

  /** 视图状态（06-12 拆分：滚动 / 尺寸 / 紧凑档）。 */
  private readonly viewState = new TimelineViewState()
  /** 交互状态（06-12 拆分：工具 / 吸附 / 活动轨 / 剪贴板）。 */
  private readonly interaction = new TimelineInteractionState()

  /** 预览播放状态（只读；时间仍以服务端 playback 为准）。 */
  readonly playing: Ref<boolean> = ref(false)
  readonly previewConnected: Ref<boolean> = ref(false)

  private fittedDocId: string | null = null

  constructor(services: ServiceRegistry) {
    const documents = services.get(DOCUMENT_SERVICE)
    const commands = services.get(DOCUMENT_COMMANDS)
    if (documents === undefined || commands === undefined) {
      throw new Error('core.timeline 需要文档服务与文档命令面')
    }
    this.documents = documents
    this.commands = commands
    this.selectionService = services.get(SELECTION_SERVICE)
    this.preview = services.get(PREVIEW_SERVICE)
    this.catalog = services.get(CATALOG_SERVICE)
    this.status = services.get(STATUS_SERVICE)

    this.view = shallowRef<ScriptView | null>(documents.view())
    this.session = shallowRef<SessionView>(documents.sessionView())
    this.selection = shallowRef<SelectionSnapshot>(
      this.selectionService?.snapshot() ?? NO_SELECTION,
    )
    this.tool = this.interaction.tool
    this.snapEnabled = this.interaction.snapEnabled
    this.clipboard = this.interaction.clipboard
    this.activeTrackId = this.interaction.activeTrackId
    this.scrollLeft = this.viewState.scrollLeft
    this.viewportWidth = this.viewState.viewportWidth
    this.panelHeight = this.viewState.panelHeight

    this.unsubscribers.push(documents.subscribe((summary) => this.applySummary(summary)))
    if (this.selectionService !== undefined) {
      this.unsubscribers.push(
        this.selectionService.subscribe((snapshot) => {
          this.selection.value = snapshot
        }),
      )
    }
    if (this.preview !== undefined) {
      this.unsubscribers.push(this.preview.subscribe(() => this.syncPlayback()))
      this.syncPlayback()
    }
    this.applySummary(documents.summary())
  }

  // ── 生命周期 ─────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
  }

  // ── 派生只读状态 ─────────────────────────────────────────────

  readonly hasDocument: ComputedRef<boolean> = computed(() => this.view.value !== null)

  readonly tracks: ComputedRef<readonly TrackViewEntry[]> = computed(
    () => this.view.value?.tracks ?? [],
  )

  readonly clipKeys: ComputedRef<readonly string[]> = computed(() => this.selection.value.clipKeys)

  readonly primaryClipKey: ComputedRef<string | undefined> = computed(() => {
    const selection = this.selection.value.selection
    return selection.domain === 'clip' ? selection.clipKey : undefined
  })

  readonly pxPerSecond: ComputedRef<number> = computed(() =>
    clampPxPerSecond(this.session.value.pxPerSecond),
  )

  readonly scale: ComputedRef<TimelineScale> = computed(() => ({
    pxPerSecond: this.pxPerSecond.value,
    scrollLeft: this.scrollLeft.value,
    viewportWidth: Math.max(1, this.viewportWidth.value),
  }))

  readonly displayRange: ComputedRef<DisplayRange> = computed(() => {
    const clips: Array<{ start: number; duration: number; loop?: boolean; loopCount?: number }> = []
    for (const track of this.tracks.value) {
      for (const clip of track.clips) {
        clips.push({
          start: clip.start,
          duration: clip.duration,
          loop: clip.loop,
          ...(clip.loopCount === undefined ? {} : { loopCount: clip.loopCount }),
        })
      }
    }
    return computeDisplayRange({
      clips,
      viewportWidth: Math.max(1, this.viewportWidth.value),
      pxPerSecond: this.pxPerSecond.value,
      macroInfinite: this.view.value?.infinite ?? false,
      scrollLeft: this.scrollLeft.value,
    })
  })

  readonly contentWidth: ComputedRef<number> = computed(() =>
    Math.max(this.displayRange.value.end * this.pxPerSecond.value, this.viewportWidth.value),
  )

  readonly compact: ComputedRef<boolean> = computed(() => this.viewState.compact.value)

  readonly visibleTracks: ComputedRef<readonly TrackViewEntry[]> = computed(() =>
    this.tracks.value.filter((track) => this.trackState(track.trackId).visible),
  )

  readonly activeTrack: ComputedRef<TrackViewEntry | undefined> = computed(() => {
    const id = this.activeTrackId.value
    if (id !== null) {
      const found = this.tracks.value.find((track) => track.trackId === id)
      if (found !== undefined) {
        return found
      }
    }
    return this.visibleTracks.value[0]
  })

  readonly canPlay: ComputedRef<boolean> = computed(
    () =>
      this.preview !== undefined &&
      this.previewConnected.value &&
      typeof this.preview.play === 'function',
  )

  readonly transportReason: ComputedRef<string | undefined> = computed(() => {
    if (this.preview === undefined) {
      return '未连接播放端'
    }
    if (!this.previewConnected.value) {
      return '未连接播放端'
    }
    if (typeof this.preview.play !== 'function') {
      return '播放端不支持 transport'
    }
    return undefined
  })

  readonly addTrackOptions: ComputedRef<readonly TrackTypeOption[]> = computed(() => {
    const options: TrackTypeOption[] = []
    const letterboxExists = this.tracks.value.some((track) => track.type === 'LETTERBOX')
    for (const type of BUILTIN_TRACK_TYPES) {
      const disabled = type === 'LETTERBOX' && letterboxExists
      options.push({
        type,
        label: trackLabel(type, true),
        disabled,
        ...(disabled ? { reason: '遮幅轨道已存在（最多一条）' } : {}),
      })
    }
    const extras = new Set<string>()
    const catalog = this.catalog
    if (catalog !== undefined) {
      for (const entry of catalog.search({ segment: 'tracks' })) {
        const scope = entry.scope[0]
        if (scope !== undefined && scope.length > 0) {
          extras.add(scope)
        }
      }
    }
    for (const track of this.tracks.value) {
      extras.add(track.type)
    }
    for (const type of [...extras].sort()) {
      if (isBuiltinTrackType(type)) {
        continue
      }
      const known = catalog?.track(type) !== undefined
      options.push({ type, label: trackLabel(type, known), disabled: false })
    }
    return options
  })

  readonly selectionInfo: ComputedRef<string> = computed(() => {
    const keys = this.clipKeys.value
    if (keys.length === 0) {
      return '未选择'
    }
    const primary = this.primaryClipKey.value
    const found = primary === undefined ? undefined : findClip(this.view.value, primary)
    const primaryLabel = found?.clip.label ?? '未命名片段'
    return `已选 ${keys.length} 个片段 · 主选 ${primaryLabel}`
  })

  /** 主选 / 多选是否全部落在未锁定轨道。 */
  readonly selectionLocked: ComputedRef<boolean> = computed(() => {
    for (const key of this.clipKeys.value) {
      const found = findClip(this.view.value, key)
      if (found !== undefined && this.trackState(found.track.trackId).locked) {
        return true
      }
    }
    return false
  })

  readonly canAddClipToActive: ComputedRef<AddClipCheck> = computed(() => {
    const track = this.activeTrack.value
    if (track === undefined) {
      return { ok: false, reason: '先添加轨道' }
    }
    return this.canCreateClip(track.type)
  })

  readonly canPaste: ComputedRef<boolean> = computed(
    () => this.hasDocument.value && this.clipboard.value.length > 0,
  )

  // ── 会话 / 视图读取 ──────────────────────────────────────────

  /** `trackId` → 会话状态；缺失时用默认可见/未锁定/未静音。 */
  trackState(trackId: string): TrackSessionView {
    return this.session.value.trackView[trackId] ?? DEFAULT_TRACK_SESSION
  }

  /** 第三方轨道是否已在字段目录登记（显示名用）。 */
  trackKnown(type: string): boolean {
    return isBuiltinTrackType(type) || this.catalog?.track(type) !== undefined
  }

  /** 显示名（未知第三方显示「未知轨道（type）」）。 */
  trackName(track: TrackViewEntry): string {
    const named = track.name.trim()
    if (named.length > 0) {
      return named
    }
    return trackLabel(track.type, this.trackKnown(track.type))
  }

  /** 活动轨道 / 任意轨道上的片段。 */
  clipOf(clipKey: string): { track: TrackViewEntry; clip: ClipViewEntry } | undefined {
    return findClip(this.view.value, clipKey)
  }

  // ── 会话写入 ─────────────────────────────────────────────────

  setScrollLeft(value: number): void {
    this.viewState.setScrollLeft(value)
  }

  setViewportWidth(value: number): void {
    this.viewState.setViewportWidth(value)
  }

  setPanelHeight(value: number): void {
    this.viewState.setPanelHeight(value)
  }

  setActiveTrack(trackId: string): void {
    this.interaction.setActiveTrack(trackId)
  }

  setTool(tool: TimelineTool): void {
    this.interaction.setTool(tool)
  }

  toggleBlade(): void {
    this.interaction.toggleBlade()
  }

  toggleSnap(): void {
    this.interaction.toggleSnap()
  }

  seek(time: number): void {
    if (!Number.isFinite(time)) {
      return
    }
    this.documents.setPlayhead(Math.max(0, time))
  }

  setPreviewRange(range: PreviewRange | null): void {
    this.documents.setPreviewRange(range)
  }

  addMarkerAtPlayhead(): void {
    this.documents.addMarker(this.session.value.playhead)
  }

  /** 在指定时间添加标记（标尺右键用）。 */
  addMarkerAt(time: number): void {
    if (!Number.isFinite(time) || time < 0) {
      return
    }
    this.documents.addMarker(time)
  }

  /** 拖动标记：会话内删除旧点 + 添加新点，不写文档、不进撤销。 */
  moveMarker(from: number, to: number): void {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < 0) {
      return
    }
    this.documents.removeMarker(from)
    this.documents.addMarker(to)
  }

  removeMarkerNear(time: number): void {
    const markers = this.session.value.markers
    const threshold = SNAP_THRESHOLD_PX / Math.max(1, this.pxPerSecond.value)
    let nearest: number | undefined
    for (const marker of markers) {
      const distance = Math.abs(marker - time)
      if (distance > threshold) {
        continue
      }
      if (nearest === undefined || distance < Math.abs(nearest - time)) {
        nearest = marker
      }
    }
    if (nearest === undefined) {
      this.notify('附近没有标记', 'info')
      return
    }
    this.documents.removeMarker(nearest)
  }

  clearMarkers(): void {
    this.documents.clearMarkers()
  }

  setTrackView(trackId: string, patch: Partial<TrackSessionView>): void {
    this.documents.setTrackView(trackId, patch)
  }

  toggleTrackVisible(trackId: string): void {
    this.documents.setTrackView(trackId, { visible: !this.trackState(trackId).visible })
  }

  toggleTrackLocked(trackId: string): void {
    this.documents.setTrackView(trackId, { locked: !this.trackState(trackId).locked })
  }

  toggleTrackMuted(trackId: string): void {
    this.documents.setTrackView(trackId, { muted: !this.trackState(trackId).muted })
  }

  // ── 选择 ─────────────────────────────────────────────────────

  /** 替换选择 / Ctrl 切换 / Shift 区间；`order` 为可见片段顺序。 */
  selectClip(clipKey: string, mode: 'replace' | 'toggle' | 'range', order?: readonly string[]): void {
    if (mode === 'replace') {
      this.commands.selectMany([clipKey])
      return
    }
    const current = this.selection.value.clipKeys
    if (mode === 'toggle') {
      if (current.includes(clipKey)) {
        this.commands.selectMany(current.filter((key) => key !== clipKey))
      } else {
        this.commands.selectMany([clipKey, ...current])
      }
      return
    }
    const keys = order ?? visibleClipKeys(this.view.value, (trackId) => this.trackState(trackId).visible)
    const anchor = this.primaryClipKey.value
    const anchorKey = anchor !== undefined && keys.includes(anchor) ? anchor : clipKey
    const anchorIndex = keys.indexOf(anchorKey)
    const targetIndex = keys.indexOf(clipKey)
    if (anchorIndex < 0 || targetIndex < 0) {
      this.commands.selectMany([clipKey])
      return
    }
    const from = Math.min(anchorIndex, targetIndex)
    const to = Math.max(anchorIndex, targetIndex)
    const range = keys.slice(from, to + 1)
    this.commands.selectMany([clipKey, ...range.filter((key) => key !== clipKey)])
  }

  selectClips(clipKeys: readonly string[], primary?: string): void {
    if (clipKeys.length === 0) {
      this.commands.selectMany([])
      return
    }
    if (primary === undefined || !clipKeys.includes(primary)) {
      this.commands.selectMany(clipKeys)
      return
    }
    this.commands.selectMany([primary, ...clipKeys.filter((key) => key !== primary)])
  }

  clearSelection(): void {
    this.commands.selectMany([])
  }

  // ── 吸附上下文 ───────────────────────────────────────────────

  /** 构造吸附上下文；`excludeClipKeys` 用于拖动/裁切时排除被操作片段的自身边界。 */
  snapContext(excludeClipKeys: readonly string[] = []): SnapContext {
    const excluded = new Set(excludeClipKeys)
    const edges: number[] = []
    for (const track of this.tracks.value) {
      for (const clip of track.clips) {
        if (excluded.has(clip.clipKey) || clip.infinite || clip.duration < 0) {
          continue
        }
        edges.push(clip.start, clipBodyEnd(clip))
      }
    }
    const preview = this.session.value.previewRange
    return {
      enabled: this.snapEnabled.value,
      thresholdPx: SNAP_THRESHOLD_PX,
      playhead: this.session.value.playhead,
      clipEdges: edges,
      markers: [...this.session.value.markers],
      loopStart: this.view.value?.loopStart ?? null,
      loopEnd: this.view.value?.loopEnd ?? null,
      previewStart: preview?.start ?? null,
      previewEnd: preview?.end ?? null,
      gridInterval: 0.5,
      pxPerSecond: this.pxPerSecond.value,
    }
  }

  /** 只对时间值吸附（标尺 / 裁切用）。 */
  snap(time: number, excludeClipKeys: readonly string[] = [], altKey = false): number {
    const context = this.snapContext(excludeClipKeys)
    if (altKey) {
      context.altKey = true
    }
    return snapTime(time, context)
  }

  // ── 轨道命令 ─────────────────────────────────────────────────

  addTrack(type: string): CommitOutcome {
    const outcome = this.commit({ kind: 'timeline.addTrack', type })
    return outcome
  }

  removeTrack(trackId: string): CommitOutcome {
    const track = findTrack(this.view.value, trackId)
    if (track === undefined) {
      return this.fail('轨道不存在')
    }
    if (track.clips.length > 0) {
      return this.fail('只能删除空轨道（先删除或移动片段）')
    }
    return this.commit({ kind: 'timeline.removeTrack', trackId })
  }

  reorderTrack(trackId: string, toIndex: number): CommitOutcome {
    return this.commit({ kind: 'timeline.reorderTracks', trackId, toIndex })
  }

  renameTrack(trackId: string, name: string): CommitOutcome {
    return this.commit({ kind: 'timeline.renameTrack', trackId, name })
  }

  // ── 片段命令 ─────────────────────────────────────────────────

  /** 新建片段能力（当前只支持镜头片段；EVENT / MOD_EVENT 明确说明原因）。 */
  canCreateClip(type: string): AddClipCheck {
    if (type === 'EVENT' || type === 'MOD_EVENT') {
      return { ok: false, reason: '事件记录不能凭空生成，请复制已有片段' }
    }
    if (type !== 'CAMERA') {
      return { ok: false, reason: `当前只支持新建镜头片段（${type} 需要该轨道的构造默认值）` }
    }
    return { ok: true }
  }

  /** 在指定轨道新建片段；`atTime` 省略时追加到该轨最后一个片段末端。 */
  addClip(trackId: string, atTime?: number): CommitOutcome {
    const track = findTrack(this.view.value, trackId)
    if (track === undefined) {
      return this.fail('轨道不存在')
    }
    const check = this.canCreateClip(track.type)
    if (!check.ok) {
      return this.fail(check.reason ?? '不能新建片段')
    }
    const start = atTime !== undefined && Number.isFinite(atTime)
      ? Math.max(0, atTime)
      : this.appendTime(track)
    const existing = new Set<string>()
    for (const entry of this.tracks.value) {
      for (const clip of entry.clips) {
        if (clip.clipId !== undefined) {
          existing.add(clip.clipId)
        }
      }
    }
    const id = nextClipId(existing)
    const clip = this.buildMinimalClip(track.type, start, id)
    const outcome = this.commit({ kind: 'clip.add', trackIndex: track.index, clip })
    if (!outcome.ok) {
      return outcome
    }
    this.setActiveTrack(track.trackId)
    const fresh = this.view.value
    if (fresh !== null) {
      for (const entry of fresh.tracks) {
        const created = entry.clips.find((candidate) => candidate.clipId === id)
        if (created !== undefined) {
          this.commands.selectMany([created.clipKey])
          break
        }
      }
    }
    return outcome
  }

  moveClips(clipKeys: readonly string[], deltaSeconds: number, targetTrackId?: string): CommitOutcome {
    if (clipKeys.length === 0) {
      return this.fail('没有选中片段')
    }
    if (this.selectionLocked.value) {
      return this.fail('轨道已锁定，不能移动片段')
    }
    return this.commit({
      kind: 'timeline.moveClips',
      clipKeys: [...clipKeys],
      deltaSeconds,
      ...(targetTrackId === undefined ? {} : { targetTrackId }),
    })
  }

  trimClip(clipKey: string, edge: 'left' | 'right', newTime: number): CommitOutcome {
    const found = this.clipOf(clipKey)
    if (found === undefined) {
      return this.fail('片段不存在')
    }
    if (this.trackState(found.track.trackId).locked) {
      return this.fail('轨道已锁定，不能裁切片段')
    }
    if (edge === 'right' && (found.clip.infinite || found.clip.duration < 0)) {
      return this.fail('无限片段不能右裁切')
    }
    return this.commit({ kind: 'timeline.trimClip', clipKey, edge, newTime })
  }

  splitClip(clipKey: string, splitTime: number): CommitOutcome {
    const found = this.clipOf(clipKey)
    if (found === undefined) {
      return this.fail('片段不存在')
    }
    if (this.trackState(found.track.trackId).locked) {
      return this.fail('轨道已锁定，不能分割片段')
    }
    const clip = found.clip
    if (clip.infinite || clip.duration < 0) {
      return this.fail('无限片段不能分割')
    }
    const start = clip.start
    const end = clip.start + clip.duration
    if (!(splitTime > start + 0.01 && splitTime < end - 0.01)) {
      return this.fail('分割点必须距片段端点至少 0.01s')
    }
    const outcome = this.commit({ kind: 'timeline.splitClip', clipKey, splitTime })
    if (!outcome.ok) {
      return outcome
    }
    const fresh = this.view.value
    if (fresh !== null) {
      const track = fresh.tracks.find((entry) => entry.trackId === found.track.trackId)
      const right = track?.clips.find(
        (candidate) => Math.abs(candidate.start - splitTime) < 0.001 && candidate.duration > 0,
      )
      if (right !== undefined) {
        this.commands.selectMany([right.clipKey])
      }
    }
    return outcome
  }

  splitSelectionAtPlayhead(): CommitOutcome {
    const primary = this.primaryClipKey.value
    if (primary === undefined) {
      return this.fail('没有选中片段')
    }
    return this.splitClip(primary, this.session.value.playhead)
  }

  deleteSelection(ripple = false): CommitOutcome {
    const keys = this.selection.value.clipKeys
    if (keys.length === 0) {
      return this.fail('没有选中片段')
    }
    if (this.selectionLocked.value) {
      return this.fail('轨道已锁定，不能删除片段')
    }
    if (ripple) {
      for (const key of keys) {
        const found = this.clipOf(key)
        if (found !== undefined && (found.clip.infinite || found.clip.duration < 0)) {
          return this.fail('无限片段不能波纹删除')
        }
      }
    }
    const affected = this.inspectDeletion(keys)
    if (affected.length > 0) {
      this.pendingDelete.value = {
        affected,
        command: this.deletionCommand(keys, ripple, affected),
        clipboard: null,
      }
      return this.fail(`片段被 ${affected.length} 条路径引用，需要确认后删除`)
    }
    return this.commit(
      ripple ? { kind: 'timeline.rippleDelete', clipKeys: [...keys] } : { kind: 'timeline.deleteClips', clipKeys: [...keys] },
    )
  }

  /** 07-05 §四：删除前扫描选中片段被哪些路径引用（按路径 id 去重）。 */
  private inspectDeletion(keys: readonly string[]): AffectedPath[] {
    const doc = documentSnapshot(this.documents, this.catalog)
    if (doc === null) {
      return []
    }
    const affected: AffectedPath[] = []
    for (const key of keys) {
      const clipId = this.clipOf(key)?.clip.clipId
      if (clipId === undefined || clipId === '') {
        continue
      }
      for (const item of pathsOfClip(doc, clipId)) {
        if (!affected.some((existing) => existing.id === item.id)) {
          affected.push(item)
        }
      }
    }
    return affected
  }

  /** 合成「删路径 + 删片段」的一次 compound（一次撤销全回退）。 */
  private deletionCommand(
    keys: readonly string[],
    ripple: boolean,
    affected: readonly AffectedPath[],
  ): DocCommand {
    const ids = [...new Set(affected.map((item) => item.id))]
    const removal: DocCommand | null = ids.length === 0
      ? null
      : { kind: 'path.writeBatch', removeIds: ids, entries: [] }
    const deleteCommand: DocCommand = ripple
      ? { kind: 'timeline.rippleDelete', clipKeys: [...keys] }
      : { kind: 'timeline.deleteClips', clipKeys: [...keys] }
    if (removal === null) {
      return deleteCommand
    }
    // 先删路径再删片段：片段删除预检看不到路径引用；其余引用仍由命令层如实拦下。
    return { kind: 'compound', commands: [removal, deleteCommand] }
  }

  /** 作者确认：删除受影响路径并继续（片段与路径同一次 compound）。 */
  confirmDelete(): void {
    const pending = this.pendingDelete.value
    if (pending === null) {
      return
    }
    this.pendingDelete.value = null
    const outcome = this.commit(pending.command as DocCommand)
    if (outcome.ok && pending.clipboard !== null) {
      this.clipboard.value = pending.clipboard
    }
  }

  /** 作者取消：片段与路径都不改。 */
  cancelDelete(): void {
    this.pendingDelete.value = null
    this.notify('已取消（路径与片段都没有改动）', 'info')
  }

  toggleLoopSelection(): CommitOutcome {
    const keys = this.selection.value.clipKeys
    if (keys.length === 0) {
      return this.fail('没有选中片段')
    }
    if (this.selectionLocked.value) {
      return this.fail('轨道已锁定，不能切换循环')
    }
    const first = this.clipOf(keys[0])
    if (first === undefined) {
      return this.fail('片段不存在')
    }
    if (!first.clip.loop && (first.clip.infinite || first.clip.duration < 0)) {
      return this.fail('无限片段不能开启循环')
    }
    return this.commit({ kind: 'timeline.toggleLoop', clipKeys: [...keys] })
  }

  compactSelection(): CommitOutcome {
    const keys = this.selection.value.clipKeys
    if (keys.length === 0) {
      return this.fail('没有选中片段')
    }
    if (this.selectionLocked.value) {
      return this.fail('轨道已锁定，不能顺排片段')
    }
    for (const key of keys) {
      const found = this.clipOf(key)
      if (found !== undefined && (found.clip.infinite || found.clip.duration < 0)) {
        return this.fail('无限片段不能参与顺排')
      }
    }
    return this.commit({ kind: 'timeline.compactSelection', clipKeys: [...keys] })
  }

  // ── 剪贴板 ───────────────────────────────────────────────────

  copySelection(): boolean {
    const entries = this.buildClipboard(this.selection.value.clipKeys)
    if (entries === null) {
      return false
    }
    this.clipboard.value = entries
    return true
  }

  cutSelection(): boolean {
    const keys = this.selection.value.clipKeys
    const entries = this.buildClipboard(keys)
    if (entries === null) {
      return false
    }
    if (this.selectionLocked.value) {
      this.notify('轨道已锁定，不能剪切片段', 'warning')
      return false
    }
    const affected = this.inspectDeletion(keys)
    if (affected.length > 0) {
      this.pendingDelete.value = {
        affected,
        command: this.deletionCommand(keys, false, affected),
        clipboard: entries,
      }
      this.notify(`片段被 ${affected.length} 条路径引用，需要确认后剪切`, 'warning')
      return false
    }
    const outcome = this.commit({ kind: 'timeline.deleteClips', clipKeys: [...keys] })
    if (!outcome.ok) {
      return false
    }
    this.clipboard.value = entries
    return true
  }

  pasteAt(atTime: number, targetTrackId?: string): boolean {
    const entries = this.clipboard.value
    if (entries.length === 0) {
      this.notify('剪贴板为空', 'info')
      return false
    }
    return this.pasteEntries(entries, atTime, targetTrackId)
  }

  duplicateSelection(): boolean {
    const keys = this.selection.value.clipKeys
    if (keys.length === 0) {
      this.notify('没有选中片段', 'info')
      return false
    }
    const entries = this.buildClipboard(keys)
    if (entries === null) {
      return false
    }
    const target = this.targetTrackFor(entries)
    if (target === undefined) {
      return false
    }
    return this.pasteEntries(entries, this.session.value.playhead, target.trackId)
  }

  // ── 视图 / 缩放 ──────────────────────────────────────────────

  setPxPerSecond(value: number): void {
    this.documents.setPxPerSecond(clampPxPerSecond(value))
  }

  /** 指针锚定缩放：缩放前后指针下的时间不变。 */
  zoomAt(pointerX: number, nextPxPerSecond: number): void {
    const scale = this.scale.value
    const anchor = screenXToTime(pointerX, scale)
    const pps = clampPxPerSecond(nextPxPerSecond)
    const nextScroll = Math.max(0, anchor * pps - pointerX)
    this.documents.setPxPerSecond(pps)
    this.scrollLeft.value = nextScroll
  }

  zoomBy(factor: number, anchorX?: number): void {
    const pointer = anchorX ?? Math.max(1, this.viewportWidth.value) / 2
    this.zoomAt(pointer, this.pxPerSecond.value * factor)
  }

  /** `Ctrl+滚轮`：deltaY 指数映射，一次事件一次更新。 */
  zoomByWheel(pointerX: number, deltaY: number): void {
    const factor = Math.pow(1.0015, -deltaY)
    this.zoomBy(factor, pointerX)
  }

  fit(): void {
    const pps = fitPxPerSecond(this.displayRange.value, Math.max(1, this.viewportWidth.value))
    this.documents.setPxPerSecond(pps)
    this.scrollLeft.value = 0
  }

  /** 打开文档后首次适配（刷新 / 切文档不重复 fit）。 */
  ensureFittedForDoc(): void {
    const docId = this.view.value?.docId ?? null
    if (docId === null) {
      this.fittedDocId = null
      return
    }
    if (this.fittedDocId === docId) {
      return
    }
    this.fittedDocId = docId
    this.fit()
  }

  // ── 脚本 A-B ────────────────────────────────────────────────

  setLoopInAtPlayhead(): boolean {
    return this.setLoopEndpoint('start', this.session.value.playhead)
  }

  setLoopOutAtPlayhead(): boolean {
    return this.setLoopEndpoint('end', this.session.value.playhead)
  }

  clearLoop(): boolean {
    return this.commit({ kind: 'timeline.setLoop', loopStart: null, loopEnd: null }).ok
  }

  /** 标尺 A-B 拖动松手时调用（一次 commit）。 */
  applyLoopRange(start: number | null, end: number | null): boolean {
    const finite = this.displayRange.value.finiteEnd
    const infinite = this.displayRange.value.infinite
    const existingStart = this.view.value?.loopStart ?? null
    const existingEnd = this.view.value?.loopEnd ?? null
    const nextStart = start ?? existingStart
    const nextEnd = end ?? existingEnd
    if (nextStart === null && nextEnd === null) {
      return this.clearLoop()
    }
    if (finite !== null && finite <= 0 && !infinite) {
      this.notify('没有有限内容，不能设置 A-B', 'warning')
      return false
    }
    if (nextStart !== null && !(nextStart >= 0)) {
      this.notify('循环入点不能小于 0', 'warning')
      return false
    }
    if (nextStart !== null && nextEnd !== null) {
      const clampedEnd = infinite
        ? Math.min(nextEnd, this.displayRange.value.end)
        : finite !== null && finite > 0
          ? Math.min(nextEnd, finite)
          : nextEnd
      if (!(clampedEnd > nextStart)) {
        this.notify('循环出点必须晚于循环入点', 'warning')
        return false
      }
      if (infinite && clampedEnd < nextStart + 0.5) {
        this.notify('无限内容的 A-B 长度至少 0.5s', 'warning')
        return false
      }
      return this.commit({ kind: 'timeline.setLoop', loopStart: nextStart, loopEnd: clampedEnd }).ok
    }
    if (nextStart !== null) {
      return this.commit({ kind: 'timeline.setLoop', loopStart: nextStart }).ok
    }
    if (nextEnd !== null) {
      return this.commit({ kind: 'timeline.setLoop', loopEnd: nextEnd }).ok
    }
    return false
  }

  // ── 播放 ─────────────────────────────────────────────────────

  play(): boolean {
    if (!this.canPlay.value || this.preview === undefined) {
      this.notify(this.transportReason.value ?? '未连接播放端', 'warning')
      return false
    }
    const preview = this.session.value.previewRange
    if (preview !== null) {
      this.preview.play(preview.start, preview.end)
    } else {
      this.preview.play(0, this.displayRange.value.end)
    }
    return true
  }

  pause(): void {
    if (this.preview === undefined || typeof this.preview.pause !== 'function') {
      this.notify('未连接播放端', 'warning')
      return
    }
    this.preview.pause()
  }

  stop(): void {
    if (this.preview === undefined || typeof this.preview.stop !== 'function') {
      this.notify('未连接播放端', 'warning')
      return
    }
    this.preview.stop()
  }

  // ── 提示 ─────────────────────────────────────────────────────

  notify(message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
    this.status?.notify(message, severity)
  }

  // ── 内部：状态同步 ───────────────────────────────────────────

  private applySummary(summary: DocumentSummary): void {
    if (this.disposed) {
      return
    }
    if (summary.revision !== this.lastRevision) {
      this.lastRevision = summary.revision
      this.view.value = this.documents.view()
    }
    this.session.value = this.documents.sessionView()
    this.selection.value = this.selectionService?.snapshot() ?? this.selection.value
  }

  private syncPlayback(): void {
    if (this.preview === undefined) {
      return
    }
    this.previewConnected.value = this.preview.connected()
    const state = this.preview.playback()
    this.playing.value = state.playing
    if (state.playing && Number.isFinite(state.time)) {
      const next = Math.max(0, state.time)
      if (Math.abs(next - this.session.value.playhead) > 0.0005) {
        this.documents.setPlayhead(next)
      }
    }
  }

  // ── 内部：提交 ───────────────────────────────────────────────

  private commit(command: DocCommand): CommitOutcome {
    const outcome = this.commands.commit(command)
    if (!outcome.ok) {
      const detail = outcome.error ?? '未知原因'
      this.notify(`操作被拒绝：${detail}`, 'error')
    } else if (outcome.warnings.length > 0) {
      this.notify(outcome.warnings[0], 'warning')
    }
    return outcome
  }

  private fail(reason: string): CommitOutcome {
    this.notify(reason, 'warning')
    return { ok: false, error: reason, warnings: [] }
  }

  // ── 内部：片段构造 ───────────────────────────────────────────

  private appendTime(track: TrackViewEntry): number {
    if (track.clips.length === 0) {
      return Math.max(0, this.session.value.playhead)
    }
    let end = 0
    for (const clip of track.clips) {
      const candidate = clip.duration > 0 ? clip.start + clip.duration : clip.start
      end = Math.max(end, candidate)
    }
    return Math.max(0, end)
  }

  /** 05-11 / 本任务：只构造最小 CAMERA 片段（其他轨道不给假字段）。 */
  private buildMinimalClip(type: string, atTime: number, id: string): JsonObject {
    const objects: JsonObject = {}
    const fixed: Array<[string, JsonValue]> = [
      ['position_mode', 'relative'],
      ['position_space', 'world'],
      ['position.y', 0],
      ['yaw', 0],
      ['pitch', 0],
      ['roll', 0],
      ['fov', 70],
      ['zoom', 1],
      ['transition', 'cut'],
    ]
    for (const [path, fallback] of fixed) {
      objects[path] = { value: defaultValueOf(this.catalog, type, path, fallback) }
    }
    return {
      id,
      start_time: Math.max(0, atTime),
      duration: 5,
      loop: false,
      loop_count: -1,
      loop_mode: 'repeat',
      objects,
    }
  }

  // ── 内部：剪贴板 ─────────────────────────────────────────────

  private buildClipboard(keys: readonly string[]): TimelineClipboardEntry[] | null {
    if (keys.length === 0) {
      this.notify('没有选中片段', 'info')
      return null
    }
    const entries: TimelineClipboardEntry[] = []
    for (const key of keys) {
      const found = this.clipOf(key)
      if (found === undefined) {
        continue
      }
      const objects = this.documents.clipObjects(key)
      if (objects === null) {
        continue
      }
      entries.push({
        trackType: found.track.type,
        start: found.clip.start,
        duration: found.clip.duration,
        loop: found.clip.loop,
        ...(found.clip.loopCount === undefined ? {} : { loopCount: found.clip.loopCount }),
        label: found.clip.label,
        objects,
      })
    }
    if (entries.length === 0) {
      this.notify('选中的片段已不存在', 'warning')
      return null
    }
    return entries
  }

  private targetTrackFor(entries: readonly TimelineClipboardEntry[]): TrackViewEntry | undefined {
    const primary = this.primaryClipKey.value
    const primaryFound = primary === undefined ? undefined : this.clipOf(primary)
    const target = primaryFound?.track ?? this.activeTrack.value
    if (target === undefined) {
      this.notify('没有目标轨道', 'warning')
      return undefined
    }
    const type = entries[0]?.trackType
    for (const entry of entries) {
      if (entry.trackType !== type) {
        this.notify('多选片段跨轨道类型，不能一次粘贴', 'warning')
        return undefined
      }
    }
    if (type !== target.type) {
      this.notify(`目标轨道类型不匹配：${trackLabel(target.type)} ≠ ${trackLabel(type ?? '')}`, 'warning')
      return undefined
    }
    return target
  }

  private pasteEntries(
    entries: readonly TimelineClipboardEntry[],
    atTime: number,
    targetTrackId?: string,
  ): boolean {
    const target = targetTrackId === undefined
      ? this.targetTrackFor(entries)
      : findTrack(this.view.value, targetTrackId)
    if (target === undefined) {
      if (targetTrackId !== undefined) {
        this.notify('目标轨道不存在', 'warning')
      }
      return false
    }
    const type = entries[0]?.trackType
    for (const entry of entries) {
      if (entry.trackType !== target.type) {
        this.notify(`目标轨道类型不匹配：${trackLabel(target.type)} ≠ ${trackLabel(entry.trackType)}`, 'warning')
        return false
      }
    }
    const earliest = Math.min(...entries.map((entry) => entry.start))
    const existing = new Set<string>()
    for (const track of this.tracks.value) {
      for (const clip of track.clips) {
        if (clip.clipId !== undefined) {
          existing.add(clip.clipId)
        }
      }
    }
    const clips: JsonObject[] = []
    const ids: string[] = []
    for (const entry of entries) {
      const id = nextClipId(existing)
      existing.add(id)
      ids.push(id)
      const start = Math.max(0, atTime + (entry.start - earliest))
      clips.push({
        id,
        start_time: start,
        duration: entry.duration,
        loop: entry.loop,
        ...(entry.loopCount === undefined ? {} : { loop_count: entry.loopCount }),
        loop_mode: 'repeat',
        objects: cloneJson(entry.objects),
      })
    }
    const outcome = this.commit({
      kind: 'timeline.pasteClips',
      targetTrackId: target.trackId,
      atTime: Math.max(0, atTime),
      clips,
    })
    if (!outcome.ok) {
      return false
    }
    this.setActiveTrack(target.trackId)
    const fresh = this.view.value
    if (fresh !== null) {
      const created: string[] = []
      for (const track of fresh.tracks) {
        for (const clip of track.clips) {
          if (clip.clipId !== undefined && ids.includes(clip.clipId)) {
            created.push(clip.clipKey)
          }
        }
      }
      if (created.length > 0) {
        this.commands.selectMany(created)
      }
    }
    return true
  }

  // ── 内部：脚本 A-B ───────────────────────────────────────────

  private setLoopEndpoint(edge: 'start' | 'end', time: number): boolean {
    if (!Number.isFinite(time)) {
      return false
    }
    const finite = this.displayRange.value.finiteEnd
    const infinite = this.displayRange.value.infinite
    if (!infinite && (finite === null || finite <= 0)) {
      this.notify('没有有限内容，不能设置 A-B', 'warning')
      return false
    }
    const existingStart = this.view.value?.loopStart ?? null
    const existingEnd = this.view.value?.loopEnd ?? null
    if (edge === 'start') {
      const start = Math.max(0, time)
      if (existingEnd !== null && start >= existingEnd) {
        this.notify('循环入点必须早于循环出点', 'warning')
        return false
      }
      return this.commit({ kind: 'timeline.setLoop', loopStart: start }).ok
    }
    const start = existingStart ?? 0
    let end = Math.max(0, time)
    if (finite !== null && finite > 0) {
      end = Math.min(end, finite)
    }
    if (infinite && end < start + 0.5) {
      this.notify('无限内容的 A-B 长度至少 0.5s', 'warning')
      return false
    }
    if (end <= start) {
      this.notify('循环出点必须晚于循环入点', 'warning')
      return false
    }
    return this.commit({ kind: 'timeline.setLoop', loopEnd: end }).ok
  }
}

// ── 单例（命令与面板共用） ─────────────────────────────────────

let installed: TimelineController | null = null

/** 取/建插件级控制器；服务缺失时抛错（由调用方的 enabled 守卫先拦住）。 */
export function ensureTimelineController(services: ServiceRegistry): TimelineController {
  if (installed !== null) {
    return installed
  }
  installed = new TimelineController(services)
  return installed
}

/** 面板使用：与命令共用同一实例。 */
export function useTimelineController(ctx: PanelContext): TimelineController {
  return ensureTimelineController(ctx.services)
}

/** 已安装的控制器（自检 / 调试；没有返回 null）。 */
export function peekTimelineController(): TimelineController | null {
  return installed
}

/** 插件卸载：只释放自己安装的实例。 */
export function disposeTimelineController(controller: TimelineController): void {
  if (installed !== controller) {
    controller.dispose()
    return
  }
  controller.dispose()
  installed = null
}
