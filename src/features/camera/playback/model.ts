/**
 * 回放检查的状态机（08-08）。
 *
 * 只保存当前状态与最近一次校验 / 推送的时间、最近一次问题列表与错误原文；
 * 不缓存脚本内容、不推断播放意图、不在本地模拟播放。
 *
 * 消息面只用既有八种：`script.validate` / `script.validate.result`、`editor.pushScript`、
 * `editor.seek`、`editor.play`、`editor.pause`、`editor.stop`、`playback.state`、`error`。
 */
import type { TransitionDocumentView } from '../transition/model.ts'

/** 校验问题（本地 `DocIssue` 与服务端字符串归并后的界面形态）。 */
export interface PlaybackIssue {
  severity: 'error' | 'warning' | 'info'
  code?: string
  message: string
  clipKey?: string
  objectPath?: string
}

/** 状态机（按 08-08 §3.1 的顺序推进）。 */
export const PLAYBACK_PHASES = [
  'disconnected',
  'ready',
  'validating',
  'valid',
  'invalid',
  'pushing',
  'seeking',
  'playing',
  'paused',
  'stopped',
  'error',
] as const

export type PlaybackPhase = (typeof PLAYBACK_PHASES)[number]

/** 状态标签。 */
export const PLAYBACK_PHASE_LABELS: Readonly<Record<PlaybackPhase, string>> = {
  disconnected: '未连接',
  ready: '就绪',
  validating: '校验中',
  valid: '有效',
  invalid: '无效',
  pushing: '推送中',
  seeking: '跳转中',
  playing: '播放中',
  paused: '已暂停',
  stopped: '已停止',
  error: '错误',
}

/** 状态徽标的语气（CSS 只按语气取色）。 */
export const PLAYBACK_PHASE_TONE: Readonly<Record<PlaybackPhase, 'muted' | 'ok' | 'warn' | 'bad'>> = {
  disconnected: 'muted',
  ready: 'muted',
  validating: 'warn',
  valid: 'ok',
  invalid: 'bad',
  pushing: 'warn',
  seeking: 'warn',
  playing: 'ok',
  paused: 'warn',
  stopped: 'muted',
  error: 'bad',
}

/** 按钮可用性。 */
export interface PlaybackActions {
  validate: boolean
  push: boolean
  play: boolean
  pause: boolean
  stop: boolean
  /** 错误态 / 无效态的重试（等同再次校验）。 */
  retry: boolean
  seek: boolean
}

/** 每个状态下按钮的可用性（08-08 §3.1 原文）。 */
export function actionsFor(phase: PlaybackPhase): PlaybackActions {
  switch (phase) {
    case 'disconnected':
      return { validate: false, push: false, play: false, pause: false, stop: false, retry: false, seek: false }
    case 'ready':
      return { validate: true, push: false, play: false, pause: false, stop: false, retry: false, seek: false }
    case 'validating':
      return { validate: false, push: false, play: false, pause: false, stop: false, retry: false, seek: false }
    case 'invalid':
      return { validate: true, push: false, play: false, pause: false, stop: false, retry: true, seek: false }
    case 'valid':
      return { validate: true, push: true, play: false, pause: false, stop: false, retry: false, seek: true }
    case 'pushing':
      return { validate: false, push: false, play: false, pause: false, stop: false, retry: false, seek: false }
    case 'seeking':
      return { validate: false, push: false, play: false, pause: false, stop: false, retry: false, seek: false }
    case 'playing':
      return { validate: true, push: true, play: false, pause: true, stop: true, retry: false, seek: true }
    case 'paused':
      return { validate: true, push: true, play: true, pause: false, stop: true, retry: false, seek: true }
    case 'stopped':
      return { validate: true, push: true, play: true, pause: false, stop: false, retry: false, seek: true }
    case 'error':
      return { validate: true, push: false, play: false, pause: false, stop: false, retry: true, seek: false }
  }
}

/** 状态机快照。 */
export interface PlaybackState {
  phase: PlaybackPhase
  /** 上次校验完成时间（毫秒时间戳）；`null` = 还没校验过。 */
  validatedAt: number | null
  /** 上次推送时间。 */
  pushedAt: number | null
  /** 上次收到 `playback.state` 的时间。 */
  receiptAt: number | null
  /** 跳转后 2 秒内没收到状态回执。 */
  missingReceipt: boolean
  /** 文档已改动、已推的版本过期。 */
  stalePush: boolean
  /** 错误原文（不吞错误）。 */
  error: string | null
  /** 校验问题列表（本地 + 服务端归并）。 */
  issues: PlaybackIssue[]
  /** 校验时的文档修订号。 */
  validatedRevision: number | null
}

/** 初始状态。 */
export function initialPlaybackState(connected: boolean): PlaybackState {
  return {
    phase: connected ? 'ready' : 'disconnected',
    validatedAt: null,
    pushedAt: null,
    receiptAt: null,
    missingReceipt: false,
    stalePush: false,
    error: null,
    issues: [],
    validatedRevision: null,
  }
}

/** 收到服务的播放状态（`playback.state`）。 */
export interface PlaybackReport {
  playing: boolean
  /** 服务端回报的时间。 */
  time: number
}

/** 归并服务端播放状态：只改状态与回执时间，不动文档。 */
export function applyReport(state: PlaybackState, report: PlaybackReport): PlaybackState {
  if (!Number.isFinite(report.time)) {
    return state
  }
  const receiptAt = Date.now()
  // 校验门阶段（未连接 / 就绪 / 校验中 / 有效 / 无效 / 错误）由本地校验意图持有，
  // 空闲回执（服务端未播，50ms 一次）不能把「有效」盖成「已暂停」；只刷新回执标记。
  if (!REPORT_OWNED_PHASES.has(state.phase)) {
    return { ...state, receiptAt, missingReceipt: false }
  }
  const phase: PlaybackPhase = report.playing ? 'playing' : 'paused'
  return {
    ...state,
    phase,
    receiptAt,
    missingReceipt: false,
  }
}

/** 回执可以接管阶段的控制态；其余阶段归本地校验 / 连接意图持有。 */
const REPORT_OWNED_PHASES: ReadonlySet<PlaybackPhase> = new Set([
  'pushing',
  'seeking',
  'playing',
  'paused',
  'stopped',
])

/** 连接状态变化：断线清空推送 / 跳转中间态回到未连接，不清文档与播放头。 */
export function applyConnection(state: PlaybackState, connected: boolean): PlaybackState {
  if (!connected) {
    return {
      ...state,
      phase: 'disconnected',
      missingReceipt: false,
      error: null,
    }
  }
  if (state.phase === 'disconnected') {
    return { ...state, phase: 'ready' }
  }
  return state
}

/** 文档修订号变化：已有效的回到就绪；播放中保持播放但标过期。 */
export function applyRevisionChange(state: PlaybackState, revision: number): PlaybackState {
  if (state.validatedRevision === null || state.validatedRevision === revision) {
    return state
  }
  const stalePush = state.pushedAt !== null
  if (state.phase === 'valid') {
    return { ...state, phase: 'ready', stalePush }
  }
  if (state.phase === 'playing' || state.phase === 'paused' || state.phase === 'stopped') {
    return { ...state, stalePush }
  }
  if (state.phase === 'invalid' || state.phase === 'error') {
    return { ...state, phase: 'ready', stalePush }
  }
  return stalePush === state.stalePush ? state : { ...state, stalePush }
}

/** 开始校验。 */
export function startValidation(state: PlaybackState): PlaybackState {
  return { ...state, phase: 'validating', error: null, missingReceipt: false }
}

/** 校验通过（`script.validate.result` 通过）。 */
export function validationPassed(state: PlaybackState, revision: number): PlaybackState {
  return {
    ...state,
    phase: 'valid',
    validatedAt: Date.now(),
    validatedRevision: revision,
    issues: [],
    error: null,
    stalePush: state.pushedAt === null ? false : state.stalePush,
  }
}

/** 校验不通过：列出问题，进入无效态。 */
export function validationFailed(
  state: PlaybackState,
  revision: number,
  issues: readonly PlaybackIssue[],
): PlaybackState {
  return {
    ...state,
    phase: 'invalid',
    validatedAt: Date.now(),
    validatedRevision: revision,
    issues: [...issues],
    error: null,
  }
}

/** 校验失败（传输失败 / 超时）：错误态，不允许跳过校验直接推送。 */
export function validationErrored(state: PlaybackState, message: string): PlaybackState {
  return { ...state, phase: 'error', error: message, issues: [] }
}

/** 开始推送。 */
export function startPush(state: PlaybackState): PlaybackState {
  return { ...state, phase: 'pushing', error: null, missingReceipt: false }
}

/** 推送已发出、开始跳转。 */
export function startSeek(state: PlaybackState): PlaybackState {
  return {
    ...state,
    phase: 'seeking',
    pushedAt: Date.now(),
    stalePush: false,
    missingReceipt: false,
  }
}

/** 推送失败（未连接 / ack 失败）：错误态并保留原文。 */
export function pushErrored(state: PlaybackState, message: string): PlaybackState {
  return { ...state, phase: 'error', error: message }
}

/** 跳转后两秒内没收到回执：只给提示，保持跳转中，不重推不轮询。 */
export function receiptTimeout(state: PlaybackState): PlaybackState {
  if (state.phase !== 'seeking') {
    return state
  }
  return { ...state, missingReceipt: true }
}

/** 播放 / 暂停 / 停止的本地意图（状态以回执为准，这里只记错误）。 */
export function controlErrored(state: PlaybackState, message: string): PlaybackState {
  return { ...state, error: message }
}

/** 摘要计数（从当前文档只读统计）。 */
export interface PlaybackSummary {
  clipCount: number
  cameraClipCount: number
  crossfadeCount: number
  morphCount: number
  coexistCount: number
}

/** 叠化 / 参数过渡 / 共存分别计数，互不吞并。 */
export function playbackSummary(input: {
  clipCount: number
  cameraClipCount: number
  transitions: TransitionDocumentView
}): PlaybackSummary {
  const boundaries = input.transitions.boundaries
  return {
    clipCount: input.clipCount,
    cameraClipCount: input.cameraClipCount,
    crossfadeCount: boundaries.filter((boundary) => boundary.crossfade.identified).length,
    morphCount: boundaries.filter((boundary) => boundary.param.type === 'morph').length,
    coexistCount: boundaries.filter((boundary) => boundary.crossfade.identified && boundary.param.type === 'morph').length,
  }
}

/** 本地时间与服务端时间的差值（`null` = 没有服务端时间）。 */
export function timeDrift(localTime: number, serverTime: number | null): number | null {
  if (serverTime === null || !Number.isFinite(serverTime)) {
    return null
  }
  return serverTime - localTime
}

