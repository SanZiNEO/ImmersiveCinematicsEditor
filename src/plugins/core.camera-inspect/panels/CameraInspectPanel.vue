<script setup lang="ts">
/**
 * 08-05 镜头检查面板（插件 `core.camera-inspect`，面板 `camera.inspect`）。
 *
 * 四个只读 tab：lane 列表、连续性诊断、玩家移动预演、回放检查。
 * 面板不写文档、不建第二个播放头、不渲染画面；定位只选中片段。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { DOCUMENT_SERVICE, PREVIEW_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import type { DocumentService } from '../../../workbench/api/documents.ts'
import type { PreviewServicePort } from '../../../workbench/api/preview.ts'
import type { DocIssue, JsonObject } from '../../../core/doc/types.ts'

import { CAMERA_TRACK_TYPE, buildTransitionView, formatSeconds } from '../../../features/camera/transition/model.ts'
import {
  COVER_CHAIN_TIERS,
  LANE_ROLE_LABELS,
  buildLaneView,
  collectLaneClips,
} from '../../../features/camera/lanes/model.ts'
import type { LaneDocumentView, LaneView } from '../../../features/camera/lanes/model.ts'
import { buildContinuityView, PLAY_MODE_LABELS } from '../../../features/camera/continuity/model.ts'
import type { ContinuityView } from '../../../features/camera/continuity/model.ts'
import { buildPlayerRoute, projectPoint } from '../../../features/camera/player/model.ts'
import type { PlayerRouteView } from '../../../features/camera/player/model.ts'
import {
  INSPECT_TABS,
  INSPECT_TAB_LABELS,
  inspectSession,
  readOrigin,
  setInspectTab,
  writeOrigin,
} from '../../../features/camera/inspect/session.ts'
import type { InspectTab } from '../../../features/camera/inspect/session.ts'
import {
  actionsFor,
  applyConnection,
  applyReport,
  applyRevisionChange,
  controlErrored,
  initialPlaybackState,
  playbackSummary,
  startPush,
  startSeek,
  startValidation,
  timeDrift,
  PLAYBACK_PHASE_LABELS,
  PLAYBACK_PHASE_TONE,
} from '../../../features/camera/playback/model.ts'
import type { PlaybackIssue, PlaybackReport, PlaybackState } from '../../../features/camera/playback/model.ts'

const ctx = usePanelContext()
const documents = ctx.services.require<DocumentService>(DOCUMENT_SERVICE)

let previewService: PreviewServicePort | null = null
try {
  previewService = ctx.services.require<PreviewServicePort>(PREVIEW_SERVICE)
} catch {
  previewService = null
}

/** 文档 emit 计数（播放头 / 修订号变化都递增）。 */
const tick = ref(0)
let lastRevision = documents.summary().revision

const stopDocumentSubscription = documents.subscribe(() => {
  const revision = documents.summary().revision
  if (revision !== lastRevision) {
    lastRevision = revision
    playback.value = applyRevisionChange(playback.value, revision)
    if (previewService !== null) {
      playback.value = applyConnection(playback.value, previewService.connected())
    }
  }
  tick.value += 1
})

onBeforeUnmount(() => {
  stopDocumentSubscription()
  stopPreviewSubscription()
})

// ── 基础取数 ───────────────────────────────────────────────

const view = computed(() => {
  void tick.value
  return documents.view()
})

const meta = computed<JsonObject | null>(() => {
  void tick.value
  return documents.metaObject()
})

const docKey = computed(() => {
  void tick.value
  const summary = documents.summary()
  return summary.docId ?? summary.path ?? 'untitled'
})

const playhead = computed(() => {
  void tick.value
  return documents.sessionView().playhead
})

const cameraTracks = computed(() => {
  const current = view.value
  if (current === null) {
    return []
  }
  return current.tracks.filter((track) => track.type === CAMERA_TRACK_TYPE)
})

const transitions = computed(() => {
  const current = view.value
  if (current === null) {
    return null
  }
  void tick.value
  return buildTransitionView(current, (clipKey) => documents.clipObjects(clipKey))
})

/** 每条 CAMERA 轨道的 lane 视图（播放头处）。 */
const laneViews = computed<Array<{ trackId: string; trackName: string; lane: LaneDocumentView }>>(() => {
  const current = view.value
  if (current === null) {
    return []
  }
  void tick.value
  const rows: Array<{ trackId: string; trackName: string; lane: LaneDocumentView }> = []
  for (const track of current.tracks) {
    if (track.type !== CAMERA_TRACK_TYPE) {
      continue
    }
    const clips = collectLaneClips(track, (clipKey) => documents.clipObjects(clipKey))
    rows.push({
      trackId: track.trackId,
      trackName: track.name.length > 0 ? track.name : track.type,
      lane: buildLaneView(track, clips, playhead.value),
    })
  }
  return rows
})

/** 拍平后的 lane 行（多轨道时按轨道分组展示）。 */
const laneRows = computed(() =>
  laneViews.value.flatMap((entry) =>
    entry.lane.lanes.map((lane) => ({ trackName: entry.trackName, lane })),
  ),
)

const laneIssues = computed(() => laneViews.value.flatMap((entry) => entry.lane.issues))

const emptyKind = computed(() => {
  if (cameraTracks.value.length === 0) {
    return 'no-camera'
  }
  const first = laneViews.value[0]?.lane
  return first === undefined ? 'gap' : first.emptyKind
})

const emptyText = computed(() => {
  switch (emptyKind.value) {
    case 'no-camera':
      return '没有 CAMERA 轨道：去主时间轴添加一条 CAMERA 轨道。'
    case 'gap':
      return '当前播放头无活跃镜头片段。'
    case 'morph-tail':
      return '末尾片段不产生参数过渡 lane（它声明了 morph，但没有下一片段）。'
    case 'crossfade-invalid':
      return '当前重叠不满足叠化，按普通多 lane 显示。'
    case 'no-active':
      return '当前播放头无活跃镜头片段。'
    default:
      return ''
  }
})

const continuity = computed<ContinuityView | null>(() => {
  const current = view.value
  const transitionView = transitions.value
  if (current === null || transitionView === null) {
    return null
  }
  return buildContinuityView({ meta: meta.value, tracks: current.tracks, transitions: transitionView })
})

const eventTrackId = computed(() => {
  const current = view.value
  if (current === null) {
    return ''
  }
  const found = current.tracks.find((track) => track.type === 'EVENT')
  return found === undefined ? '' : found.trackId
})

const playerRoute = computed<PlayerRouteView | null>(() => {
  const current = view.value
  if (current === null) {
    return null
  }
  const origin = readOrigin(docKey.value, eventTrackId.value)
  return buildPlayerRoute({
    view: current,
    objectsOf: (clipKey) => documents.clipObjects(clipKey),
    origin,
    meta: meta.value,
  })
})

// ── tab 计数徽标 ───────────────────────────────────────────

const tabCounts = computed<Record<InspectTab, number>>(() => ({
  lane: laneRows.value.length,
  continuity: continuity.value === null ? 0 : continuity.value.issues.length,
  player: playerRoute.value === null ? 0 : playerRoute.value.targets.length,
  playback: playback.value.issues.length,
}))

const tab = computed<InspectTab>(() => inspectSession.tab)

function switchTab(next: InspectTab): void {
  setInspectTab(next)
}

// ── 定位 ───────────────────────────────────────────────────

/** 选中片段并聚焦属性面板（不改字段、不强开分组）。 */
function locate(clipKey: string): void {
  ctx.requestSelect({ domain: 'clip', clipKey })
  ctx.requestFocus('selection.properties')
}

/** 定位到效果面板的具体对象路径（只在有动画摘要时出现）。 */
function revealEffect(clipKey: string, objectPath: string): void {
  ctx.requestSelect({ domain: 'clip', clipKey })
  ctx.requestRevealInEffectControls({ clipKey, objectPath })
}

/** 定位提示（有 clipKey 才给按钮）。 */
function locateIssue(clipKey: string | undefined): void {
  if (clipKey === undefined) {
    return
  }
  locate(clipKey)
}

// ── Lane tab 呈现 ──────────────────────────────────────────

function roleText(lane: LaneView): string {
  if (lane.role === 'morph') {
    return `morph（${lane.fromLabel ?? '—'} → ${lane.label}）`
  }
  return LANE_ROLE_LABELS[lane.role]
}

function rangeText(lane: LaneView): string {
  const end = lane.end === null ? '∞' : formatSeconds(lane.end)
  const base = `${formatSeconds(lane.start)} → ${end}`
  if (lane.role === 'crossfade' && lane.overlapStart !== null && lane.overlapEnd !== null) {
    return `${base}（重叠 ${formatSeconds(lane.overlapStart)} → ${formatSeconds(lane.overlapEnd)}）`
  }
  if (lane.role === 'morph' && lane.windowStart !== null && lane.windowEnd !== null) {
    return `窗口 ${formatSeconds(lane.windowStart)} → ${formatSeconds(lane.windowEnd)}`
  }
  return base
}

function summaryText(lane: LaneView): string {
  return `不透明 ${lane.summary.opacity.text} · 目标 ${lane.summary.dest.text} · 源 ${lane.summary.source.text} · 遮罩 ${lane.summary.mask.text} · 维度 ${lane.summary.dimension.text}`
}

function animatedPaths(lane: LaneView): string[] {
  const values = [lane.summary.opacity, lane.summary.dest, lane.summary.source, lane.summary.mask, lane.summary.dimension]
  const paths: string[] = []
  for (const value of values) {
    if (value.animated) {
      paths.push(...value.paths)
    }
  }
  return paths
}

function laneMarks(lane: LaneView): Array<{ text: string; hint: string }> {
  const marks: Array<{ text: string; hint: string }> = []
  if (lane.top) {
    marks.push({ text: '最上层', hint: '层级徽标：数组顺序靠后者在上，不是角色' })
  }
  if (lane.suppressModifiers) {
    marks.push({ text: '声明抑制修饰符', hint: '片段声明了 suppress_modifiers，运行时不一定生效' })
  }
  if (lane.runtimeOnly) {
    marks.push({ text: '只在运行时可用', hint: '目标可用性等条件只有运行时才判定' })
  }
  if (animatedPaths(lane).length > 0) {
    marks.push({ text: '动画', hint: '有动画摘要：可到效果面板查看具体行' })
  }
  return marks
}

// ── 连续性 tab 呈现 ────────────────────────────────────────

function gateClass(status: 'allowed' | 'conditional' | 'blocked'): string {
  return `gate-${status}`
}

function macroModeText(mode: string): string {
  return mode === 'pingpong' ? '正反交替' : '正向重复'
}

// ── 玩家移动 tab 呈现 ──────────────────────────────────────

/** 世界坐标 → 画布百分比（留 8% 边距）。 */
function pointStyle(point: { x: number; z: number }, route: PlayerRouteView): { left: string; top: string } {
  const projected = projectPoint(route.bounds, point)
  const left = 8 + projected.u * 84
  const top = 8 + projected.v * 84
  return { left: `${left}%`, top: `${top}%` }
}

function originStyle(route: PlayerRouteView): { left: string; top: string } {
  return pointStyle(route.origin, route)
}

/** 点击画布设置预览原点（世界坐标反投影）。 */
function pickOrigin(event: MouseEvent, route: PlayerRouteView): void {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return
  }
  const u = Math.min(1, Math.max(0, ((event.clientX - rect.left) / rect.width - 0.08) / 0.84))
  const v = Math.min(1, Math.max(0, ((event.clientY - rect.top) / rect.height - 0.08) / 0.84))
  const spanX = Math.max(route.bounds.maxX - route.bounds.minX, 1e-6)
  const spanZ = Math.max(route.bounds.maxZ - route.bounds.minZ, 1e-6)
  writeOrigin(docKey.value, eventTrackId.value, {
    x: route.bounds.minX + u * spanX,
    z: route.bounds.minZ + v * spanZ,
  })
}

/** 折线点（百分比坐标串）。 */
function polylinePoints(route: PlayerRouteView): string {
  const points = [route.origin, ...route.targets.map((target) => target.world)]
  return points
    .map((point) => {
      const style = pointStyle(point, route)
      return `${parseFloat(style.left)},${parseFloat(style.top)}`
    })
    .join(' ')
}

function targetCell(target: PlayerRouteView['targets'][number]): string {
  const written = target.relative
    ? `相对 (${target.written.x}, ${target.written.z})`
    : `绝对 (${target.written.x}, ${target.written.z})`
  return `${written} → 世界 (${Math.round(target.world.x * 1000) / 1000}, ${Math.round(target.world.z * 1000) / 1000})`
}

// ── 回放 tab ───────────────────────────────────────────────

const playback = ref<PlaybackState>(initialPlaybackState(previewService === null ? false : previewService.connected()))
/** 服务端最近一次 `playback.state` 回执（time / playing）；预览服务是命令式类，计算属性直接读其字段不具响应式，须由订阅回调写入 ref。 */
const serverState = ref<PlaybackReport | null>(previewService === null ? null : previewService.playback())
const playbackBusy = ref(false)
const OFF = (): void => undefined
let stopPreviewSubscription: () => void = OFF
let receiptTimer: ReturnType<typeof setTimeout> | undefined

// 预览读数节流：播放中 `subscribe` 随帧/状态高频触发，这里只保留最新一份回执，
// 按 125ms 合并刷新；连接状态跳变属于必须立刻可见的变化，立即应用。
const PREVIEW_FLUSH_MS = 125
let previewFlushTimer: ReturnType<typeof setTimeout> | undefined
let pendingReport: PlaybackReport | null = null
let lastConnected: boolean | null = null

function flushPreviewReport(): void {
  previewFlushTimer = undefined
  const report = pendingReport
  pendingReport = null
  if (report === null || previewService === null) return
  serverState.value = report
  playback.value = applyReport(playback.value, report)
  playback.value = applyConnection(playback.value, previewService.connected())
  if (receiptTimer !== undefined) {
    clearTimeout(receiptTimer)
    receiptTimer = undefined
  }
}

function schedulePreviewReport(): void {
  if (previewService === null) return
  const report = previewService.playback()
  pendingReport = report
  const connectedNow = previewService.connected()
  if (lastConnected !== null && connectedNow !== lastConnected) {
    lastConnected = connectedNow
    flushPreviewReport()
    return
  }
  lastConnected = connectedNow
  if (previewFlushTimer !== undefined) return
  previewFlushTimer = setTimeout(flushPreviewReport, PREVIEW_FLUSH_MS)
}

/** 只在回放 tab 激活时订阅播放状态；切走取消订阅但不停止播放。 */
function subscribePreview(): void {
  if (previewService === null || stopPreviewSubscription !== OFF) {
    return
  }
  lastConnected = previewService.connected()
  stopPreviewSubscription = previewService.subscribe(() => {
    schedulePreviewReport()
  })
}

function unsubscribePreview(): void {
  stopPreviewSubscription()
  stopPreviewSubscription = OFF
  if (previewFlushTimer !== undefined) {
    clearTimeout(previewFlushTimer)
    previewFlushTimer = undefined
  }
  pendingReport = null
}

watch(
  () => inspectSession.tab,
  (next) => {
    if (next === 'playback') {
      playback.value = applyConnection(
        playback.value,
        previewService !== null && previewService.connected(),
      )
      subscribePreview()
    } else {
      unsubscribePreview()
    }
  },
  { immediate: true },
)

const playbackActions = computed(() => actionsFor(playback.value.phase))

const playbackSummaryCounts = computed(() => {
  const current = view.value
  const transitionView = transitions.value
  if (current === null || transitionView === null) {
    return null
  }
  const clips = documents.clips()
  const cameraClips = clips.filter((clip) => clip.trackType === CAMERA_TRACK_TYPE).length
  return playbackSummary({
    clipCount: clips.length,
    cameraClipCount: cameraClips,
    transitions: transitionView,
  })
})

const serverPlayback = computed(() => serverState.value)
const drift = computed(() => timeDrift(playhead.value, serverPlayback.value === null ? null : serverPlayback.value.time))

/** `DocIssue` → 界面问题（保留原文，不吞错误）。 */
function toPlaybackIssue(issue: DocIssue): PlaybackIssue {
  const severity = issue.severity === 'block' || issue.severity === 'error'
    ? 'error'
    : issue.severity === 'warn' ? 'warning' : 'info'
  return {
    severity,
    code: issue.code,
    message: issue.message,
    ...(issue.clipKey === undefined ? {} : { clipKey: issue.clipKey }),
    ...(issue.objectPath === undefined ? {} : { objectPath: issue.objectPath }),
  }
}

/** 校验：本地门先过，再过服务端门。 */
async function runValidation(): Promise<void> {
  if (playbackBusy.value) {
    return
  }
  playbackBusy.value = true
  playback.value = startValidation(playback.value)
  try {
    const revision = documents.summary().revision
    const local = documents.localIssues().map(toPlaybackIssue)
    const localErrors = local.filter((issue) => issue.severity === 'error')
    if (localErrors.length > 0) {
      playback.value = validationFailedLocal(revision, local)
      return
    }
    const outcome = await documents.validate()
    const issues = outcome.issues.map(toPlaybackIssue)
    const errors = issues.filter((issue) => issue.severity === 'error')
    playback.value = errors.length > 0
      ? validationFailedLocal(revision, issues)
      : validationPassedAt(revision)
    if (outcome.stale) {
      playback.value.error = '服务端校验结果已过期（连接断开后保留的旧结果）'
    }
  } catch (error) {
    playback.value = validationErroredLocal(error instanceof Error ? error.message : String(error))
  } finally {
    playbackBusy.value = false
  }
}

/** 校验失败：进入无效态并列出问题。 */
function validationFailedLocal(revision: number, issues: PlaybackIssue[]): PlaybackState {
  return {
    ...playback.value,
    phase: 'invalid',
    validatedAt: Date.now(),
    validatedRevision: revision,
    issues,
    error: null,
  }
}

function validationPassedAt(revision: number): PlaybackState {
  return {
    ...playback.value,
    phase: 'valid',
    validatedAt: Date.now(),
    validatedRevision: revision,
    issues: [],
    error: null,
  }
}

function validationErroredLocal(message: string): PlaybackState {
  return { ...playback.value, phase: 'error', error: message, issues: [] }
}

/** 推送并跳转：推送用序列化字符串，跳转用当前播放头。 */
async function pushAndSeek(): Promise<void> {
  if (playbackBusy.value || playback.value.phase !== 'valid') {
    return
  }
  playbackBusy.value = true
  playback.value = startPush(playback.value)
  try {
    const pushed = await documents.pushPreview()
    if (!pushed.ok) {
      playback.value = pushErroredLocal(pushed.reason === undefined ? '推送失败' : pushed.reason)
      return
    }
    playback.value = startSeek(playback.value)
    await documents.seekPreview(playhead.value)
    scheduleReceiptTimeout()
  } catch (error) {
    playback.value = pushErroredLocal(error instanceof Error ? error.message : String(error))
  } finally {
    playbackBusy.value = false
  }
}

function pushErroredLocal(message: string): PlaybackState {
  return { ...playback.value, phase: 'error', error: message }
}

/** 跳转后两秒内没收到回执：只提示，保持跳转中。 */
function scheduleReceiptTimeout(): void {
  if (receiptTimer !== undefined) {
    clearTimeout(receiptTimer)
  }
  receiptTimer = setTimeout(() => {
    receiptTimer = undefined
    playback.value = { ...playback.value, missingReceipt: playback.value.phase === 'seeking' }
  }, 2000)
}

/** 播放控制：只发消息，状态以回执为准。 */
function play(): void {
  try {
    previewService?.play()
  } catch (error) {
    playback.value = controlErrored(playback.value, error instanceof Error ? error.message : String(error))
  }
}

function pause(): void {
  try {
    previewService?.pause()
  } catch (error) {
    playback.value = controlErrored(playback.value, error instanceof Error ? error.message : String(error))
  }
}

function stop(): void {
  try {
    previewService?.stop()
  } catch (error) {
    playback.value = controlErrored(playback.value, error instanceof Error ? error.message : String(error))
  }
}

const visibleIssues = computed(() => playback.value.issues.slice(0, 5))
const hiddenIssueCount = computed(() => Math.max(0, playback.value.issues.length - visibleIssues.value.length))

const documentPath = computed(() => documents.summary().path)
const documentDirty = computed(() => documents.summary().dirty)

onBeforeUnmount(() => {
  if (receiptTimer !== undefined) {
    clearTimeout(receiptTimer)
    receiptTimer = undefined
  }
  if (previewFlushTimer !== undefined) {
    clearTimeout(previewFlushTimer)
    previewFlushTimer = undefined
  }
})

/** 模板用常量。 */
const TABS = INSPECT_TABS
const TAB_LABELS = INSPECT_TAB_LABELS
const TIERS = COVER_CHAIN_TIERS
const MODE_LABELS = PLAY_MODE_LABELS
const PHASE_LABELS = PLAYBACK_PHASE_LABELS
const PHASE_TONE = PLAYBACK_PHASE_TONE
</script>

<template>
  <div class="inspect-panel">
    <header class="head">
      <div class="title-row">
        <strong>镜头检查</strong>
        <span class="muted">
          {{ view === null ? '未打开文档' : (cameraTracks.length === 0 ? '无 CAMERA 轨道' : `CAMERA 轨道 ${cameraTracks.length}`) }}
        </span>
        <span class="muted">{{ view?.meta.name ?? '' }}</span>
      </div>
      <div class="time-row">跟随主时间轴：{{ formatSeconds(playhead) }}s</div>
      <nav class="tabs">
        <button
          v-for="item in TABS"
          :key="item"
          type="button"
          class="tab"
          :class="{ active: tab === item }"
          @click="switchTab(item)"
        >
          {{ TAB_LABELS[item] }}
          <span v-if="tabCounts[item] > 0" class="count">{{ tabCounts[item] }}</span>
        </button>
      </nav>
    </header>

    <div v-if="view === null" class="empty">未打开文档：没有可检查的内容。</div>

    <div v-else class="content">
      <!-- Lane -->
      <section v-if="tab === 'lane'" class="pane">
        <div class="pane-head">
          <span>播放头 {{ formatSeconds(playhead) }}s</span>
          <span>lane {{ laneRows.length }}</span>
          <span class="muted">轨道顺序：下 → 上</span>
        </div>
        <div v-if="laneRows.length === 0" class="empty">{{ emptyText }}</div>
        <template v-else>
          <table class="lane-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>来源片段</th>
                <th>角色</th>
                <th>区间</th>
                <th>合成摘要</th>
                <th>调色</th>
                <th>标记</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in laneRows" :key="`${row.trackName}-${row.lane.clipKey}`" class="lane-row" @click="locate(row.lane.clipKey)">
                <td class="mono">{{ row.lane.index }}</td>
                <td>
                  <div class="cell-title">{{ row.lane.label }}</div>
                  <div class="muted">{{ row.trackName }}</div>
                </td>
                <td>{{ roleText(row.lane) }}</td>
                <td class="mono">{{ rangeText(row.lane) }}</td>
                <td class="summary">
                  <div>{{ summaryText(row.lane) }}</div>
                  <div class="cell-actions">
                    <button type="button" class="mini" @click.stop="locate(row.lane.clipKey)">属性</button>
                    <button
                      v-for="path in animatedPaths(row.lane).slice(0, 1)"
                      :key="path"
                      type="button"
                      class="mini"
                      @click.stop="revealEffect(row.lane.clipKey, path)"
                    >效果</button>
                  </div>
                </td>
                <td>
                  <button type="button" class="link" @click.stop="locate(row.lane.clipKey)">{{ row.lane.colorOwner }}</button>
                </td>
                <td class="marks">
                  <span v-for="mark in laneMarks(row.lane)" :key="mark.text" class="badge" :title="mark.hint">{{ mark.text }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <ul v-if="laneIssues.length > 0" class="issues">
            <li v-for="(issue, index) in laneIssues" :key="`lane-${index}`" :class="`sev-${issue.severity}`">
              {{ issue.message }}
              <button v-if="issue.clipKey !== undefined" type="button" class="mini" @click="locateIssue(issue.clipKey)">定位</button>
            </li>
          </ul>
        </template>
        <footer class="foot">
          覆盖链：<span v-for="tier in TIERS" :key="tier.id" class="badge">{{ tier.label }}</span>
          <span class="muted">修饰符不作用 lane 快照；不显示「当前谁赢了」。</span>
        </footer>
      </section>

      <!-- 连续性 -->
      <section v-else-if="tab === 'continuity'" class="pane">
        <div v-if="continuity === null" class="empty">未打开文档：没有连续性可解释。</div>
        <template v-else>
          <div class="card">
            <div class="card-title">脚本级字段</div>
            <div class="grid">
              <div class="grid-item"><span class="muted">播放模式</span><span>{{ MODE_LABELS[continuity.meta.playMode] }}{{ continuity.meta.playModeDeclared ? '' : '（缺省）' }}</span></div>
              <div class="grid-item"><span class="muted">优先级</span><span>{{ continuity.meta.priority }}</span></div>
              <div class="grid-item"><span class="muted">可打断</span><span>{{ continuity.meta.interruptible ? '开' : '关' }}</span></div>
              <div class="grid-item"><span class="muted">可跳过</span><span>{{ continuity.meta.skippable ? '开' : '关' }}</span></div>
              <div class="grid-item"><span class="muted">跳过投票比例</span><span>{{ continuity.meta.skipVoteRatio === null ? '未声明' : continuity.meta.skipVoteRatio }}</span></div>
              <div class="grid-item"><span class="muted">末尾保持</span><span>{{ continuity.meta.holdAtEnd ? '开' : '关' }}</span></div>
              <div class="grid-item"><span class="muted">宏循环</span><span>{{ continuity.meta.macroLoop ? `开（${continuity.meta.macroLoopCount < 0 ? '无限' : continuity.meta.macroLoopCount + ' 圈'} · ${macroModeText(continuity.meta.macroLoopMode)}）` : '关' }}</span></div>
            </div>
            <p class="muted">字段缺省值按 02；面板不补写默认值。</p>
          </div>

          <div class="card">
            <div class="card-title">到达裁决</div>
            <table class="plain-table">
              <tbody>
                <tr>
                  <th>{{ continuity.sameScript.condition }}</th>
                  <td>{{ continuity.sameScript.outcome }}</td>
                  <td class="muted">{{ continuity.sameScript.fields.join('、') }}</td>
                </tr>
                <tr v-for="rule in continuity.crossScript" :key="rule.code">
                  <th>{{ rule.condition }}</th>
                  <td>{{ rule.outcome }}</td>
                  <td class="muted">{{ rule.fields.join('、') }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted">新请求自己的 play_mode 决定的是「它开始播之后别人怎么对待它」，不是到达时会不会排队。</p>
            <div class="card-sub">
              <div>{{ continuity.queue.summary }}</div>
              <ul class="bullets">
                <li v-for="detail in continuity.queue.details" :key="detail">{{ detail }}</li>
              </ul>
            </div>
          </div>

          <div class="card">
            <div class="card-title">退场门禁</div>
            <table class="plain-table">
              <thead><tr><th>门</th><th>结果</th><th>依据</th></tr></thead>
              <tbody>
                <tr v-for="gate in continuity.gates" :key="gate.code">
                  <td>{{ gate.name }}</td>
                  <td :class="gateClass(gate.status)">{{ gate.gate }}</td>
                  <td class="muted">{{ gate.fields.length === 0 ? '不受限' : gate.fields.join('、') }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="card-title">循环</div>
            <p>{{ continuity.macroLoopText }}</p>
            <p>{{ continuity.clipLoopText }}</p>
            <table v-if="continuity.clipLoops.length > 0" class="plain-table">
              <thead><tr><th>片段</th><th>循环</th><th>次数</th><th>模式</th><th>参与过渡</th></tr></thead>
              <tbody>
                <tr v-for="entry in continuity.clipLoops" :key="entry.clipKey">
                  <td>
                    <button type="button" class="link" @click="locate(entry.clipKey)">{{ entry.label }}</button>
                    <div class="muted">{{ entry.trackName }}</div>
                  </td>
                  <td>{{ entry.loop ? '开' : '关' }}{{ entry.infinite ? '（无限）' : '' }}</td>
                  <td>{{ entry.loopCount === null ? '—' : entry.loopCount }}</td>
                  <td>{{ entry.loopMode.length > 0 ? macroModeText(entry.loopMode) : '—' }}</td>
                  <td>{{ entry.participatesInTransition ? '是' : '否' }}<div class="muted">{{ entry.note }}</div></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="card-title">交界</div>
            <div v-if="continuity.boundaries.length === 0" class="muted">没有 CAMERA 交界。</div>
            <table v-else class="plain-table">
              <thead><tr><th>交界</th><th>叠化重叠区</th><th>B 两端不透明度</th><th>参数过渡</th><th>共存</th></tr></thead>
              <tbody>
                <tr v-for="entry in continuity.boundaries" :key="entry.id">
                  <td>{{ entry.aLabel }} → {{ entry.bLabel }}<div class="muted">{{ entry.trackName }}</div></td>
                  <td class="mono">
                    {{ entry.crossfadeOverlapStart === null ? '—' : `${formatSeconds(entry.crossfadeOverlapStart)} → ${formatSeconds(entry.crossfadeOverlapEnd ?? 0)}（${formatSeconds(entry.crossfadeOverlapDuration)}s）` }}
                  </td>
                  <td class="mono">{{ entry.crossfadeEndpoints === null ? '—' : `${entry.crossfadeEndpoints.from} → ${entry.crossfadeEndpoints.to}` }}</td>
                  <td>
                    {{ entry.paramType }}<span v-if="entry.paramWindowStart !== null" class="muted">（窗口 {{ formatSeconds(entry.paramWindowStart) }} → {{ formatSeconds(entry.paramWindowEnd ?? 0) }}，{{ entry.paramInterrupt }}）</span>
                  </td>
                  <td>{{ entry.coexistCoverage === 'none' ? '—' : entry.coexistCoverage === 'full' ? '完全遮蔽' : '部分遮蔽' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted">共存时回放按区间分先后：morph 优先区间 / 叠化仍可见区间 / 完全遮蔽；本页不提供自动二选一。</p>
          </div>

          <div class="card">
            <div class="card-title">提示</div>
            <div v-if="continuity.issues.length === 0" class="muted">当前没有连续性提示。</div>
            <ul v-else class="issues">
              <li v-for="(issue, index) in continuity.issues" :key="`${issue.code}-${index}`" :class="`sev-${issue.severity}`">
                <span class="mono">{{ issue.code }}</span>
                {{ issue.message }}
                <button v-if="issue.clipKey !== undefined" type="button" class="mini" @click="locateIssue(issue.clipKey)">定位</button>
              </li>
            </ul>
            <p class="muted">诊断只按本脚本字段与生命周期规则推导，不推断游戏内实际在播的脚本集合。</p>
          </div>
        </template>
      </section>

      <!-- 玩家移动 -->
      <section v-else-if="tab === 'player'" class="pane">
        <div v-if="playerRoute === null" class="empty">未打开文档。</div>
        <template v-else>
          <div class="pane-head">
            <span>EVENT 轨 {{ playerRoute.hasEventTrack ? '有' : '无' }}</span>
            <span>目标 {{ playerRoute.targets.length }}</span>
            <span>丢弃 {{ playerRoute.dropped }}</span>
            <span class="muted">预览原点 {{ playerRoute.originStored ? '已设定' : '未设定（用 0,0）' }}</span>
          </div>
          <div v-if="playerRoute.emptyKind === 'no-event-track'" class="empty">
            没有 EVENT 轨道：玩家移动只读 EVENT 的 Position 目标。
          </div>
          <div v-else-if="playerRoute.targets.length === 0" class="empty">
            EVENT 轨没有 Position 记录：不画折线。
          </div>
          <template v-else>
            <div class="player-map" role="img" :aria-label="`玩家移动预演，${playerRoute.targets.length} 个目标`" @click="pickOrigin($event, playerRoute)">
              <svg class="player-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline :points="polylinePoints(playerRoute)" class="route-line" />
              </svg>
              <span class="origin-dot" :style="originStyle(playerRoute)" title="预览原点" />
              <span
                v-for="target in playerRoute.targets"
                :key="`${target.clipKey}-${target.recordIndex}`"
                class="target-dot"
                :class="{ anchor: target.role === 'anchor' }"
                :style="pointStyle(target.world, playerRoute)"
                :title="`${target.clipLabel} · ${formatSeconds(target.globalTime)}s`"
              >{{ target.index }}</span>
              <span class="axis axis-x">X →</span>
              <span class="axis axis-z">Z ↓</span>
            </div>
            <p class="muted">点击地图设置预览原点（只影响画布，不写脚本）。</p>
            <table class="plain-table">
              <thead><tr><th>#</th><th>时间</th><th>片段</th><th>写入</th></tr></thead>
              <tbody>
                <tr v-for="target in playerRoute.targets" :key="`row-${target.clipKey}-${target.recordIndex}`">
                  <td class="mono">{{ target.index }}</td>
                  <td class="mono">{{ formatSeconds(target.globalTime) }}s</td>
                  <td>
                    <button type="button" class="link" @click="locate(target.clipKey)">{{ target.clipLabel }}</button>
                  </td>
                  <td class="mono">{{ targetCell(target) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted">MOD_EVENT 轨不解析玩家移动，运行时只读 EVENT 的 Position。本页不提供「执行移动」按钮。</p>
            <ul v-if="playerRoute.issues.length > 0" class="issues">
              <li v-for="(issue, index) in playerRoute.issues" :key="`player-${index}`" :class="`sev-${issue.severity}`">
                {{ issue.message }}
              </li>
            </ul>
          </template>
        </template>
      </section>

      <!-- 回放 -->
      <section v-else class="pane">
        <div class="pane-head">
          <span class="phase" :class="`tone-${PHASE_TONE[playback.phase]}`">{{ PHASE_LABELS[playback.phase] }}</span>
          <span class="muted">{{ documentPath ?? '未保存' }}</span>
          <span v-if="documentDirty" class="badge warn">未保存修改</span>
          <span class="muted">问题 {{ playback.issues.length }}</span>
          <span class="muted">上次推送 {{ playback.pushedAt === null ? '—' : new Date(playback.pushedAt).toLocaleTimeString() }}</span>
        </div>

        <div v-if="playbackSummaryCounts !== null" class="grid">
          <div class="grid-item"><span class="muted">片段</span><span>{{ playbackSummaryCounts.clipCount }}</span></div>
          <div class="grid-item"><span class="muted">CAMERA 片段</span><span>{{ playbackSummaryCounts.cameraClipCount }}</span></div>
          <div class="grid-item"><span class="muted">叠化</span><span>{{ playbackSummaryCounts.crossfadeCount }}</span></div>
          <div class="grid-item"><span class="muted">参数过渡</span><span>{{ playbackSummaryCounts.morphCount }}</span></div>
          <div class="grid-item"><span class="muted">共存</span><span>{{ playbackSummaryCounts.coexistCount }}</span></div>
        </div>

        <div class="actions">
          <button type="button" class="primary" :disabled="!playbackActions.validate" @click="runValidation">
            {{ playbackActions.retry ? '重试校验' : '校验' }}
          </button>
          <button type="button" class="primary" :disabled="!playbackActions.push" @click="pushAndSeek">推送并跳转</button>
          <button type="button" :disabled="!playbackActions.play" @click="play">播放</button>
          <button type="button" :disabled="!playbackActions.pause" @click="pause">暂停</button>
          <button type="button" :disabled="!playbackActions.stop" @click="stop">停止</button>
        </div>

        <div class="compare">
          <div><span class="muted">本地主时间轴</span> <span class="mono">{{ formatSeconds(playhead) }}s</span></div>
          <div>
            <span class="muted">服务端</span>
            <span class="mono">{{ serverPlayback === null ? '—' : `${formatSeconds(serverPlayback.time)}s · ${serverPlayback.playing ? '在播' : '未播'}` }}</span>
          </div>
          <div v-if="drift !== null"><span class="muted">差值</span> <span class="mono">{{ formatSeconds(drift) }}s</span></div>
        </div>

        <p class="muted">真实画面在游戏预览视口：面板内不放渲染、不采样像素。</p>

        <div v-if="playback.error !== null" class="card error-card">
          <div class="card-title">错误</div>
          <p>{{ playback.error }}</p>
          <button type="button" :disabled="!playbackActions.retry" @click="runValidation">重试</button>
        </div>

        <div v-if="playback.missingReceipt" class="card warn-card">
          <div class="card-title">未收到状态回执</div>
          <p class="muted">跳转后 2 秒内没有收到 playback.state：保持跳转中，不自动重推、不轮询。</p>
          <button type="button" :disabled="!playbackActions.validate" @click="runValidation">重试校验</button>
        </div>

        <div v-if="playback.stalePush" class="card warn-card">
          <div class="card-title">脚本已修改，需重新推送</div>
          <p class="muted">已推的版本早于当前修订号；不自动重推。</p>
        </div>

        <div v-if="playback.issues.length > 0" class="card">
          <div class="card-title">校验问题</div>
          <ul class="issues scroll">
            <li v-for="(issue, index) in visibleIssues" :key="`pb-${index}`" :class="`sev-${issue.severity}`">
              <span class="mono">{{ issue.code ?? '' }}</span>
              {{ issue.message }}
              <button v-if="issue.clipKey !== undefined" type="button" class="mini" @click="locateIssue(issue.clipKey)">定位</button>
            </li>
          </ul>
          <p v-if="hiddenIssueCount > 0" class="muted">还有 {{ hiddenIssueCount }} 条已折叠。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inspect-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 280px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.head {
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.title-row,
.time-row,
.pane-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.title-row {
  font-size: 13px;
}

.time-row {
  color: var(--text-secondary);
  margin-top: 2px;
}

.tabs {
  display: flex;
  gap: 2px;
  margin-top: 6px;
}

.tab {
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
}

.tab.active {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--bg-raised);
}

.count {
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.pane {
  padding: 8px;
}

.empty {
  padding: 20px 12px;
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
}

.mono {
  font-family: var(--font-mono, monospace);
}

.lane-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
}

.lane-table th,
.lane-table td {
  border-top: 1px solid var(--border);
  padding: 4px 5px;
  text-align: left;
  vertical-align: top;
}

.lane-row {
  cursor: pointer;
}

.lane-row:hover {
  background: var(--bg-hover);
}

.cell-title {
  font-weight: 600;
}

.summary {
  max-width: 360px;
}

.cell-actions {
  display: flex;
  gap: 4px;
  margin-top: 3px;
}

.link {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.mini {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
}

.badge {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
}

.badge.warn {
  color: var(--warning, var(--accent));
  border-color: var(--warning, var(--accent));
}

.marks {
  white-space: normal;
}

.issues {
  margin: 6px 0;
  padding-left: 16px;
}

.sev-error {
  color: var(--error);
}

.sev-warning {
  color: var(--warning, var(--accent));
}

.sev-info {
  color: var(--text-secondary);
}

.foot {
  border-top: 1px solid var(--border);
  margin-top: 8px;
  padding-top: 6px;
  color: var(--text-secondary);
}

.card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
  background: var(--bg-raised);
}

.card.warn-card {
  border-color: var(--warning, var(--accent));
}

.card.error-card {
  border-color: var(--error);
}

.card-title {
  font-weight: 600;
  margin-bottom: 6px;
}

.card-sub {
  margin-top: 6px;
}

.bullets {
  margin: 4px 0 0;
  padding-left: 16px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}

.grid-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
}

.plain-table {
  width: 100%;
  border-collapse: collapse;
}

.plain-table th,
.plain-table td {
  border-top: 1px solid var(--border);
  padding: 3px 5px;
  text-align: left;
  vertical-align: top;
}

.gate-allowed {
  color: var(--text);
}

.gate-conditional {
  color: var(--warning, var(--accent));
}

.gate-blocked {
  color: var(--error);
}

.player-map {
  position: relative;
  width: 100%;
  height: 220px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  overflow: hidden;
  cursor: crosshair;
}

.player-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.route-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
}

.origin-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  border: 1px solid var(--border-strong);
  transform: translate(-50%, -50%);
}

.target-dot {
  position: absolute;
  min-width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--accent);
  background: var(--bg-raised);
  color: var(--accent);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  line-height: 15px;
  text-align: center;
  transform: translate(-50%, -50%);
}

.target-dot.anchor {
  border-color: var(--text-secondary);
  color: var(--text-secondary);
}

.axis {
  position: absolute;
  color: var(--text-muted);
  font-size: 10px;
}

.axis-x {
  right: 4px;
  top: 2px;
}

.axis-z {
  left: 4px;
  bottom: 2px;
}

.phase {
  padding: 1px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
}

.tone-ok {
  color: var(--accent);
  border-color: var(--accent);
}

.tone-warn {
  color: var(--warning, var(--accent));
  border-color: var(--warning, var(--accent));
}

.tone-bad {
  color: var(--error);
  border-color: var(--error);
}

.tone-muted {
  color: var(--text-muted);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.actions button {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
}

.actions button.primary {
  border-color: var(--accent);
  color: var(--accent);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.compare {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 6px;
}

.issues.scroll {
  max-height: 160px;
  overflow: auto;
}
</style>
