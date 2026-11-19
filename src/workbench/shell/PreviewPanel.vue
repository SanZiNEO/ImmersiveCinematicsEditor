<script setup lang="ts">
/**
 * 预览面板（04-02 中栏 / 04-09 宿主层 / 13 轮硬化）。
 *
 * 只消费宿主提供的**已解析**预览帧（传输层是唯一解析点，这里不再二次解析）：
 * - RGBA 帧复用同一像素缓冲与 ImageData，走 ImageData 直写；
 * - H.264 Annex B access unit 经 WebCodecs VideoDecoder 解码，等首个关键帧再解码，
 *   输出 VideoFrame 入显示队列，drawImage 上屏后立即 close；
 * - 两条路径共用同一画布、同一条 rAF 显示循环（100ms 固定抖动延迟 + 有界队列），
 *   不并行跑两套绘制循环；漂移修正只在显示循环这一处生效。
 *
 * 状态语义：`presented` 只记录**真正解码并呈现过**的帧；H.264 到达但首帧未解出时，
 * 占位文案仍在并明确区分等待关键帧 / 解码中 / 首帧超时。解码器不支持、解码失败、
 * 首帧超时都在界面可见，不允许静默黑屏。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import type { PreviewFrame, PreviewStats } from '../api/preview.ts'
import { PREVIEW_TYPE_H264, PREVIEW_TYPE_RGBA } from '../api/preview.ts'
import type { PreviewServicePort } from '../api/preview.ts'
import { PREVIEW_SERVICE } from '../api/tokens.ts'
import { useI18n, useServices } from './useWorkbench.ts'

const services = useServices()
const i18n = useI18n()

/** 状态区读数刷新间隔：≤8 次/秒；首帧到达与连接/断连仍即时刷新。 */
const STATUS_REFRESH_MS = 125

/** 显示抖动缓冲：画面固定滞后 100ms，按 PTS 对齐显示，吸收网络/解码抖动。 */
const DISPLAY_DELAY_MS = 100
/** 显示队列上限：余量给解码突发，防止异常时内存增长。 */
const MAX_QUEUE = 90
/** PTS 回退阈值（微秒）：>1ms 回退意味着新编码器进程（暂停/seek 补帧/切分辨率）。 */
const PTS_RESYNC_BACKSTEP_US = 1_000
/** 断流阈值（毫秒）：超过该时长没有新帧则重建 PTS 基准。 */
const PTS_RESYNC_GAP_MS = 1000
/** 首帧超时：连接并收到帧后，限时内未解出可见帧则给出可见提示。 */
const FIRST_FRAME_TIMEOUT_MS = 5000

type DecodeState = 'idle' | 'awaiting-keyframe' | 'decoding' | 'broken' | 'unsupported'

interface DisplayFrame {
  /** 微秒，已映射到本地时钟（performance.now() * 1000 为基准）。 */
  timestamp: number
  width: number
  height: number
  frameId: number
  type: number
  rgba: Uint8Array | null
  video: VideoFrame | null
}

/** 真正上屏过的最后一帧；未呈现过帧时为 `null`。 */
interface PresentedFrame {
  width: number
  height: number
  frameId: number
  type: number
  presentedAt: number
}

const canvas = ref<HTMLCanvasElement | null>(null)
const connected = ref(false)
const stats = ref<PreviewStats | null>(null)
const lastFrameAt = ref<number | null>(null)
const presented = shallowRef<PresentedFrame | null>(null)
const connInfo = shallowRef<{ status: string; reason: string | null } | null>(null)
const error = ref<string | null>(null)
const decodeState = shallowRef<DecodeState>('idle')
/** 收到首帧（任意类型）的本地时间；未收到为 `null`。 */
const frameArrivedAt = ref<number | null>(null)
/** 首帧超时：收到帧但限时内没有解出可见帧。 */
const firstFrameTimedOut = ref(false)

let service: PreviewServicePort | null = null
let unsubscribeFrame: (() => void) | null = null
let unsubscribeState: (() => void) | null = null
let statusTimer: ReturnType<typeof setInterval> | undefined
/** 上一次已知的连接状态；状态订阅随帧也会触发，只在跳变时即时刷新。 */
let lastConnectedState: boolean | null = null
/** 上一次已知的连接状态码（no-token / stopped / reconnecting …），用于区分同布尔态下的状态跳变。 */
let lastConnStatus: string | null = null
/** 上一帧之后是否已经刷新过一次状态读数（首帧即时，后续走节流）。 */
let statusRefreshedAfterFrame = false

// ── 显示队列：RGBA 缓冲复用 + VideoFrame 逐条释放 ──────────────
const queue: DisplayFrame[] = []
let pixelBuffer: Uint8ClampedArray<ArrayBuffer> | null = null
let reusedImageData: ImageData | null = null
let rafId: number | undefined

// ── PTS → 本地时钟 ────────────────────────────────────────────
// 服务端 PTS 以每个编码器首帧为 0（暂停/切分辨率/重连后归零），必须映射到本地时间轴
// 才能与 performance.now() - 100ms 比较；回退或断流超 1s 时重建基准并清空旧 epoch。
let ptsClockOffsetUs = 0
let ptsClockReady = false
let ptsResynced = false
let lastRawPtsUs = 0
let lastArrivalMs = 0

// ── H.264 / WebCodecs ─────────────────────────────────────────
// 每消息一个 Annex B access unit（关键帧含 SPS/PPS/IDR）；无 description 时
// H.264 按 Annex B 解析。未见到首个关键帧前的 delta 直接丢弃。
let decoder: VideoDecoder | null = null
let decoderSizeKey = ''
let decoderBroken = false
let awaitingKeyframe = true

function preview(): PreviewServicePort | null {
  if (service === null) {
    service = services.get(PREVIEW_SERVICE) ?? null
  }
  return service
}

function refreshStatusNow(): void {
  const current = preview()
  if (current === null) return
  lastConnectedState = current.connected()
  connected.value = lastConnectedState
  stats.value = current.stats()
  lastFrameAt.value = current.lastFrameAt()
  connInfo.value = current.connection?.() ?? null
  lastConnStatus = connInfo.value?.status ?? null
  checkFirstFrameTimeout()
}

// ── PTS 重整与队列 ───────────────────────────────────────────

function clearQueue(): void {
  for (const item of queue) {
    if (item.video !== null) item.video.close()
  }
  queue.length = 0
}

function normalizePts(rawPtsUs: number): number {
  const nowMs = performance.now()
  const gapMs = nowMs - lastArrivalMs
  const backstep = ptsClockReady && rawPtsUs + PTS_RESYNC_BACKSTEP_US < lastRawPtsUs
  if (!ptsClockReady || backstep || gapMs > PTS_RESYNC_GAP_MS) {
    ptsClockOffsetUs = nowMs * 1000 - rawPtsUs
    ptsClockReady = true
    ptsResynced = true
    clearQueue()
  }
  lastRawPtsUs = rawPtsUs
  lastArrivalMs = nowMs
  return rawPtsUs + ptsClockOffsetUs
}

function enqueue(frame: DisplayFrame): void {
  queue.push(frame)
  while (queue.length > MAX_QUEUE) {
    const stale = queue.shift()
    if (stale !== undefined && stale.video !== null) stale.video.close()
  }
}

/** 取时间戳 <= target 的最新一帧；更早的帧直接丢弃（VideoFrame 必须 close）。 */
function pickDueFrame(targetUs: number): DisplayFrame | null {
  let lastIndex = -1
  for (let index = 0; index < queue.length; index += 1) {
    if (queue[index].timestamp <= targetUs) lastIndex = index
    else break
  }
  if (lastIndex < 0) return null
  const picked = queue[lastIndex]
  for (let index = 0; index < lastIndex; index += 1) {
    const stale = queue[index]
    if (stale.video !== null) stale.video.close()
  }
  const rest = queue.length - lastIndex - 1
  for (let index = 0; index < rest; index += 1) queue[index] = queue[lastIndex + 1 + index]
  queue.length = rest
  return picked
}

function drawFrame(item: DisplayFrame): void {
  const element = canvas.value
  if (element === null) {
    item.video?.close()
    return
  }
  const context = element.getContext('2d')
  if (context === null) {
    item.video?.close()
    return
  }
  if (element.width !== item.width || element.height !== item.height) {
    element.width = item.width
    element.height = item.height
    pixelBuffer = null
    reusedImageData = null
  }
  if (item.video !== null) {
    context.drawImage(item.video, 0, 0, element.width, element.height)
    item.video.close()
  } else if (item.rgba !== null) {
    const byteLength = item.width * item.height * 4
    if (pixelBuffer === null || pixelBuffer.length < byteLength) {
      pixelBuffer = new Uint8ClampedArray(new ArrayBuffer(byteLength))
      reusedImageData = new ImageData(pixelBuffer, item.width, item.height)
    }
    pixelBuffer.set(item.rgba.subarray(0, byteLength))
    if (reusedImageData !== null) context.putImageData(reusedImageData, 0, 0)
  }
  presented.value = {
    width: item.width,
    height: item.height,
    frameId: item.frameId,
    type: item.type,
    presentedAt: Date.now(),
  }
  firstFrameTimedOut.value = false
  // 解码器恢复并出帧后清掉可恢复错误；不支持 WebCodecs 的错误保留到下次重连。
  if (decodeState.value !== 'unsupported') error.value = null
}

function renderLoop(): void {
  rafId = requestAnimationFrame(renderLoop)
  const nowUs = performance.now() * 1000
  // 服务端固定 -r FPS，捕获端丢帧会让 PTS 逐渐落后本地时钟；偏差超阈值时
  // 平滑平移队列时间戳，把显示延迟拉回 100ms（漂移修正只在此处生效一处）。
  const newest = queue.length > 0 ? queue[queue.length - 1] : null
  if (newest !== null) {
    const driftUs = nowUs - DISPLAY_DELAY_MS * 1000 - newest.timestamp
    if (driftUs > 250_000 || driftUs < -250_000) {
      ptsClockOffsetUs += driftUs
      for (const item of queue) item.timestamp += driftUs
    }
  }
  const due = pickDueFrame(nowUs - DISPLAY_DELAY_MS * 1000)
  if (due !== null) drawFrame(due)
}

// ── H.264 解码 ───────────────────────────────────────────────

function closeDecoder(): void {
  const dec = decoder
  decoder = null
  decoderSizeKey = ''
  if (dec === null) return
  try {
    if (dec.state !== 'closed') dec.close()
  } catch {
    /* 已关闭/已失效，忽略 */
  }
}

function markDecoderBroken(reason: string): void {
  decoderBroken = true
  awaitingKeyframe = true
  decodeState.value = 'broken'
  error.value = i18n.t('preview.decoderError', { reason })
  closeDecoder()
}

function ensureDecoder(frame: PreviewFrame): void {
  if (typeof VideoDecoder === 'undefined') {
    decoderBroken = true
    decodeState.value = 'unsupported'
    error.value = i18n.t('preview.decoderUnsupported')
    return
  }
  const sizeKey = `${frame.width}x${frame.height}`
  if (decoder !== null && !decoderBroken && decoderSizeKey === sizeKey) return
  closeDecoder()
  decoderBroken = false
  decoderSizeKey = sizeKey
  try {
    const dec = new VideoDecoder({
      output: (video: VideoFrame) => {
        enqueue({
          timestamp: video.timestamp,
          width: video.displayWidth || video.codedWidth,
          height: video.displayHeight || video.codedHeight,
          frameId: frame.frameId,
          type: PREVIEW_TYPE_H264,
          rgba: null,
          video,
        })
      },
      error: (err: DOMException) => {
        console.warn('[IC-WebUI] 预览解码器错误，等待下一个关键帧', err?.message ?? err)
        decoderBroken = true
        awaitingKeyframe = true
        decodeState.value = 'broken'
        error.value = i18n.t('preview.decoderError', { reason: err?.message ?? String(err) })
        closeDecoder()
      },
    })
    const config = {
      codec: 'avc1.42E033',
      codedWidth: frame.width,
      codedHeight: frame.height,
      optimizeForLatency: true,
      hardwareAcceleration: 'no-preference',
      // Annex B：显式声明，避免某些实现按 avcC 长度前缀解析。
      avc: { format: 'annexb' },
    } as VideoDecoderConfig & { avc: { format: 'annexb' } }
    dec.configure(config)
    decoder = dec
    decodeState.value = 'awaiting-keyframe'
  } catch (e) {
    console.warn('[IC-WebUI] 预览解码器初始化失败', e)
    markDecoderBroken(e instanceof Error ? e.message : String(e))
  }
}

function handleH264(frame: PreviewFrame): void {
  const timestamp = Math.round(normalizePts(frame.ptsMicros))
  // PTS 重建：seek/pushScript/setCamera 补帧或暂停恢复后，服务端新编码器首帧 PTS 回绕到
  // 接近 0，说明旧解码器里的参考帧已作废，必须从本帧（关键帧）重新配置再从 Annex B 解起。
  if (ptsResynced) {
    ptsResynced = false
    decoderBroken = false
    awaitingKeyframe = true
    closeDecoder()
  }
  if (frame.keyframe) {
    awaitingKeyframe = false
    ensureDecoder(frame)
  } else if (awaitingKeyframe) {
    return
  }
  const dec = decoder
  if (dec === null || dec.state !== 'configured') return
  try {
    dec.decode(new EncodedVideoChunk({
      type: frame.keyframe ? 'key' : 'delta',
      timestamp,
      data: frame.payload,
    }))
    if (decodeState.value === 'idle' || decodeState.value === 'awaiting-keyframe') {
      decodeState.value = 'decoding'
    }
  } catch (e) {
    console.warn('[IC-WebUI] 预览解码失败，等待下一个关键帧', e)
    markDecoderBroken(e instanceof Error ? e.message : String(e))
  }
}

// ── 会话重置（断连/重连/卸载） ────────────────────────────────

function resetSession(): void {
  clearQueue()
  closeDecoder()
  decoderBroken = false
  awaitingKeyframe = true
  ptsClockReady = false
  ptsResynced = false
  presented.value = null
  frameArrivedAt.value = null
  firstFrameTimedOut.value = false
  decodeState.value = 'idle'
  error.value = null
}

function checkFirstFrameTimeout(): void {
  if (!connected.value || presented.value !== null) return
  const arrived = frameArrivedAt.value
  if (arrived === null) return
  if (Date.now() - arrived > FIRST_FRAME_TIMEOUT_MS) firstFrameTimedOut.value = true
}

function retry(): void {
  preview()?.retry?.()
  refreshStatusNow()
}

const showRetry = computed(() => {
  const status = connInfo.value?.status
  return status === 'stopped' || status === 'no-token'
})

// ── 状态派生 ──────────────────────────────────────────────────

function offlineText(): string {
  const status = connInfo.value?.status
  if (status === 'no-token') return i18n.t('preview.noToken')
  if (status === 'stopped') return i18n.t('preview.stopped')
  if (status === 'reconnecting') return i18n.t('preview.reconnecting')
  // 状态还没归类但服务端已给出可读原因（如 token 文件被清空）时，直接展示原因，
  // 不让面板退回无信息量的「预览未接入」——用户需要知道为什么黑着。
  const reason = connInfo.value?.reason
  if (reason !== null && reason !== undefined && reason.trim() !== '') return reason
  return i18n.t('preview.offline')
}

const placeholderText = computed(() => {
  if (!connected.value) return offlineText()
  if (presented.value !== null) return ''
  if (firstFrameTimedOut.value) return i18n.t('preview.firstFrameTimeout')
  if (decodeState.value === 'awaiting-keyframe') return i18n.t('preview.awaitingKeyframe')
  if (frameArrivedAt.value !== null) return i18n.t('preview.decoding')
  return i18n.t('preview.waiting')
})

const droppedTotal = computed(() => {
  const current = stats.value
  if (current === null) return 0
  return Number(current.dropped ?? 0) + Number(current.inputDropped ?? 0) + Number(current.encoderDropped ?? 0)
})

const statusText = computed(() => {
  if (!connected.value) return offlineText()
  const current = stats.value
  if (current === null && presented.value === null) return i18n.t('preview.waiting')
  const encoder = current?.encoder ?? 'unknown'
  const size = presented.value === null
    ? (current?.width !== undefined && current?.height !== undefined ? `${current.width}×${current.height}` : '—')
    : `${presented.value.width}×${presented.value.height}`
  const phase = presented.value !== null
    ? i18n.t('preview.presented')
    : firstFrameTimedOut.value
      ? i18n.t('preview.firstFrameTimeout')
      : decodeState.value === 'awaiting-keyframe'
        ? i18n.t('preview.awaitingKeyframe')
        : frameArrivedAt.value !== null
          ? i18n.t('preview.decoding')
          : i18n.t('preview.waiting')
  const dropText = droppedTotal.value > 0 ? ` · ${i18n.t('preview.dropped')} ${droppedTotal.value}` : ''
  return `${encoder} · ${size} · ${phase} · ${i18n.t('preview.lastFrame')}: ${lastFrameAt.value === null ? '-' : new Date(lastFrameAt.value).toLocaleTimeString()}${dropText}`
})

onMounted(() => {
  const current = preview()
  if (current === null) {
    error.value = i18n.t('preview.unavailable')
    return
  }
  unsubscribeFrame = current.onFrame((frame) => {
    if (frameArrivedAt.value === null) frameArrivedAt.value = Date.now()
    if (frame.type === PREVIEW_TYPE_RGBA) {
      const timestamp = normalizePts(frame.ptsMicros)
      ptsResynced = false
      enqueue({
        timestamp,
        width: frame.width,
        height: frame.height,
        frameId: frame.frameId,
        type: frame.type,
        rgba: frame.payload,
        video: null,
      })
    } else {
      handleH264(frame)
    }
    // 首帧到达即时刷新一次状态读数；后续帧交给 125ms 节流，不每帧触发响应式更新。
    if (!statusRefreshedAfterFrame) {
      statusRefreshedAfterFrame = true
      refreshStatusNow()
    }
  })
  unsubscribeState = current.subscribe(() => {
    // 状态订阅随帧也会触发；只在连接跳变或连接状态码跳变时即时刷新，其余读数交给 125ms 节流。
    const next = current.connected()
    const nextStatus = current.connection?.()?.status ?? null
    if (lastConnectedState !== null && next === lastConnectedState && nextStatus === lastConnStatus) return
    lastConnStatus = nextStatus
    if (!next) resetSession()
    statusRefreshedAfterFrame = false
    refreshStatusNow()
  })
  refreshStatusNow()
  statusTimer = setInterval(refreshStatusNow, STATUS_REFRESH_MS)
  rafId = requestAnimationFrame(renderLoop)
})

onBeforeUnmount(() => {
  unsubscribeFrame?.()
  unsubscribeState?.()
  unsubscribeFrame = null
  unsubscribeState = null
  if (statusTimer !== undefined) {
    clearInterval(statusTimer)
    statusTimer = undefined
  }
  if (rafId !== undefined) {
    cancelAnimationFrame(rafId)
    rafId = undefined
  }
  resetSession()
})
</script>

<template>
  <section class="preview-panel">
    <div class="preview-surface">
      <canvas ref="canvas" class="preview-canvas" />
      <p v-if="presented === null" class="preview-empty" role="status">
        {{ placeholderText }}
      </p>
    </div>
    <footer class="preview-status">
      <span :class="{ online: connected }" role="status">{{ statusText }}</span>
      <span v-if="error" class="preview-error" role="alert">{{ error }}</span>
      <button v-if="showRetry" type="button" class="ghost" @click="retry">{{ i18n.t('preview.retry') }}</button>
      <button type="button" class="ghost" @click="preview()?.requestRefresh()">{{ i18n.t('preview.refresh') }}</button>
    </footer>
  </section>
</template>

<style scoped>
.preview-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: var(--bg-panel); }
.preview-surface {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-app);
  overflow: hidden;
}
.preview-canvas { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-empty { position: absolute; color: var(--text-muted); font-size: 12px; }
.preview-status {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 26px;
  padding: 0 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
}
.preview-status .online { color: var(--success); }
.preview-error { color: var(--error); }
.ghost {
  margin-left: auto;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
}
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
