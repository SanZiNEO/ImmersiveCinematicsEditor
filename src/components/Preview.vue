<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { state, onFrame, play, pause, stop, flightMode, flightState, exitFlightMode, sendPreviewConfig } from '../store'
import {
  parsePreviewFrame,
  PREVIEW_TYPE_RGBA,
  type PreviewFrame,
  type PreviewMode,
} from '../lib/previewProtocol'
import playIcon from '../assets/icons/play.svg'
import pauseIcon from '../assets/icons/pause.svg'
import stopIcon from '../assets/icons/record.svg'

/** 抖动缓冲：画面固定滞后 100ms，按 PTS 对齐显示，吸收网络/解码抖动 */
const DISPLAY_DELAY_MS = 100
/** 显示队列上限：100ms@60fps 约 6 帧，余量给解码突发，防止异常时内存增长 */
const MAX_QUEUE = 90
/** PTS 回退阈值：服务端 PTS 严格单调，任何回退（>1ms）都意味着新编码器进程（暂停/seek 补帧/切分辨率） */
const PTS_RESYNC_BACKSTEP_US = 1_000
/** 断流阈值：超过该时长没有新帧则重建 PTS 基准（暂停/切分辨率/重连） */
const PTS_RESYNC_GAP_MS = 1000

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fpsRef = ref(0)

interface DisplayFrame {
  /** 微秒，已映射到本地时钟（performance.now() * 1000 为基准） */
  timestamp: number
  width: number
  height: number
  rgba: Uint8Array | null
  video: VideoFrame | null
}

const queue: DisplayFrame[] = []
let ctx2d: CanvasRenderingContext2D | null = null
let cachedImageData: ImageData | null = null

// ── PTS → 本地时钟 ────────────────────────────────────────────
// 服务端 PTS 以每个编码器首帧为 0（暂停/切分辨率/重连后归零），必须映射到本地时间轴
// 才能与 performance.now() - 100ms 比较；回退或断流超 1s 时重建基准并清空旧 epoch。
let ptsClockOffsetUs = 0
let ptsClockReady = false
let ptsResynced = false
let lastRawPtsUs = 0
let lastArrivalMs = 0

function clearQueue(): void {
  for (const item of queue) {
    if (item.video) item.video.close()
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
    const stale = queue.shift()!
    if (stale.video) stale.video.close()
  }
}

// ── 显示调度 ──────────────────────────────────────────────────

let drawnFrames = 0
let fpsWindowStart = performance.now()
let rafId = 0

/** 取时间戳 <= target 的最新一帧；更早的帧直接丢弃（VideoFrame 必须 close） */
function pickDueFrame(targetUs: number): DisplayFrame | null {
  let lastIndex = -1
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].timestamp <= targetUs) lastIndex = i
    else break
  }
  if (lastIndex < 0) return null
  const picked = queue[lastIndex]
  for (let i = 0; i < lastIndex; i++) {
    const stale = queue[i]
    if (stale.video) stale.video.close()
  }
  const rest = queue.length - lastIndex - 1
  for (let i = 0; i < rest; i++) queue[i] = queue[lastIndex + 1 + i]
  queue.length = rest
  return picked
}

function drawFrame(frame: DisplayFrame): void {
  const canvas = canvasRef.value
  if (!canvas) {
    if (frame.video) frame.video.close()
    return
  }
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width
    canvas.height = frame.height
    cachedImageData = null
  }
  if (!ctx2d) ctx2d = canvas.getContext('2d')
  if (!ctx2d) {
    if (frame.video) frame.video.close()
    return
  }
  if (frame.video) {
    ctx2d.drawImage(frame.video, 0, 0, canvas.width, canvas.height)
    frame.video.close()
  } else if (frame.rgba) {
    if (!cachedImageData || cachedImageData.width !== canvas.width || cachedImageData.height !== canvas.height) {
      cachedImageData = ctx2d.createImageData(canvas.width, canvas.height)
    }
    const pixels = cachedImageData.data
    if (frame.rgba.length === pixels.length) pixels.set(frame.rgba)
    else pixels.set(frame.rgba.subarray(0, pixels.length))
    ctx2d.putImageData(cachedImageData, 0, 0)
  }
  drawnFrames++
}

function tickFps(): void {
  const now = performance.now()
  const elapsed = now - fpsWindowStart
  if (elapsed >= 1000) {
    fpsRef.value = Math.round((drawnFrames * 1000) / elapsed)
    drawnFrames = 0
    fpsWindowStart = now
  }
}

function renderLoop(): void {
  rafId = requestAnimationFrame(renderLoop)
  const nowUs = performance.now() * 1000
  // 服务端固定 -r FPS，捕获端丢帧会让 PTS 逐渐落后本地时钟；偏差超阈值时
  // 平滑平移队列时间戳，把显示延迟拉回 100ms（否则积压会被 MAX_QUEUE 硬丢）。
  const newest = queue.length ? queue[queue.length - 1] : null
  if (newest) {
    const driftUs = (nowUs - DISPLAY_DELAY_MS * 1000) - newest.timestamp
    if (driftUs > 250_000 || driftUs < -250_000) {
      ptsClockOffsetUs += driftUs
      for (const item of queue) item.timestamp += driftUs
    }
  }
  const due = pickDueFrame(nowUs - DISPLAY_DELAY_MS * 1000)
  if (due) drawFrame(due)
  tickFps()
}

// ── H.264 / WebCodecs ─────────────────────────────────────────
// 每消息一个 Annex B access unit（关键帧含 SPS/PPS/IDR）；无 description 时
// H.264 按 Annex B 解析。未见到首个关键帧前的 delta 直接丢弃。
let decoder: VideoDecoder | null = null
let decoderSizeKey = ''
let decoderBroken = false
let awaitingKeyframe = true

function closeDecoder(): void {
  const dec = decoder
  decoder = null
  decoderSizeKey = ''
  if (!dec) return
  try {
    if (dec.state !== 'closed') dec.close()
  } catch {
    /* 已关闭/已失效，忽略 */
  }
}

function markDecoderBroken(): void {
  decoderBroken = true
  awaitingKeyframe = true
  closeDecoder()
}

function ensureDecoder(frame: PreviewFrame): void {
  if (typeof VideoDecoder === 'undefined') {
    // 极老 Electron/浏览器没有 WebCodecs：放弃 H.264 画面，等服务端回退 RGBA
    decoderBroken = true
    return
  }
  const sizeKey = `${frame.width}x${frame.height}`
  if (decoder && !decoderBroken && decoderSizeKey === sizeKey) return
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
          rgba: null,
          video,
        })
      },
      error: (err: DOMException) => {
        console.warn('[IC-WebUI] 预览解码器错误，等待下一个关键帧', err?.message || err)
        decoderBroken = true
        awaitingKeyframe = true
        closeDecoder()
      },
    })
    const config: VideoDecoderConfig & { avc?: { format: 'annexb' } } = {
      codec: 'avc1.42E033',
      codedWidth: frame.width,
      codedHeight: frame.height,
      optimizeForLatency: true,
      hardwareAcceleration: 'no-preference',
      // Annex B：显式声明，避免某些实现按 avcC 长度前缀解析
      avc: { format: 'annexb' },
    }
    decoder = dec
    dec.configure(config)
  } catch (e) {
    console.warn('[IC-WebUI] 预览解码器初始化失败', e)
    markDecoderBroken()
  }
}

function handleH264(frame: PreviewFrame): void {
  const timestamp = Math.round(normalizePts(frame.ptsMicros))
  // PTS 重建：seek/pushScript/setCamera 补帧或暂停恢复后，服务端新编码器首帧 PTS 回绕到接近 0，
  // 说明旧解码器里的参考帧已作废，必须从本帧（关键帧）重新配置再从 Annex B 解起
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
  if (!dec || dec.state !== 'configured') return
  try {
    dec.decode(new EncodedVideoChunk({
      type: frame.keyframe ? 'key' : 'delta',
      timestamp,
      data: frame.payload,
    }))
  } catch (e) {
    console.warn('[IC-WebUI] 预览解码失败，等待下一个关键帧', e)
    markDecoderBroken()
  }
}

function handleFrame(buf: ArrayBuffer): void {
  const frame = parsePreviewFrame(buf)
  if (!frame) return
  if (frame.type === PREVIEW_TYPE_RGBA) {
    const timestamp = normalizePts(frame.ptsMicros)
    ptsResynced = false
    enqueue({
      timestamp,
      width: frame.width,
      height: frame.height,
      rgba: frame.payload,
      video: null,
    })
    return
  }
  handleH264(frame)
}

// ── 统计与配置 UI ─────────────────────────────────────────────

const statsSize = computed(() => {
  const s = state.previewStats
  return s && s.width && s.height ? `${s.width}×${s.height}` : ''
})

const droppedTotal = computed(() => {
  const s = state.previewStats
  return s ? (s.dropped || 0) + (s.inputDropped || 0) + (s.encoderDropped || 0) : 0
})

const ENCODER_LABELS: Record<string, string> = {
  h264: 'H.264',
  rgba: 'RGBA',
  off: '编码关闭',
  pending: '编码启动中',
}

const encoderLabel = computed(() => {
  const e = state.previewStats?.encoder
  return e ? (ENCODER_LABELS[e] || e) : ''
})

function onModeChange(e: Event): void {
  const mode = (e.target as HTMLSelectElement).value as PreviewMode
  sendPreviewConfig(mode, state.previewFps)
}

function onFpsChange(e: Event): void {
  const fps = Number((e.target as HTMLSelectElement).value) === 30 ? 30 : 60
  sendPreviewConfig(state.previewMode, fps)
}

// ── 生命周期 ──────────────────────────────────────────────────

let cleanup: (() => void) | null = null
let stopConnectWatch: (() => void) | null = null

onMounted(() => {
  cleanup = onFrame(handleFrame)
  rafId = requestAnimationFrame(renderLoop)
  // 断开后旧会话的排队帧/解码器全部作废，重连从关键帧重建
  stopConnectWatch = watch(() => state.connected, connected => {
    if (connected) return
    clearQueue()
    closeDecoder()
    decoderBroken = false
    awaitingKeyframe = true
    ptsClockReady = false
  })
})

onUnmounted(() => {
  if (cleanup) cleanup()
  if (stopConnectWatch) stopConnectWatch()
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  closeDecoder()
  clearQueue()
  ctx2d = null
  cachedImageData = null
})
</script>

<template>
  <div class="preview">
    <div class="bar">
      <span :class="state.connected ? 'ok' : 'bad'">{{ state.status }}</span>
      <span>{{ state.time.toFixed(3) }}s</span>
      <span>{{ fpsRef }} fps</span>
      <span v-if="statsSize">{{ statsSize }}</span>
      <span v-if="encoderLabel">{{ encoderLabel }}</span>
      <span v-if="droppedTotal > 0" class="warn">丢帧 {{ droppedTotal }}</span>
      <span class="spacer" />
      <select :value="state.previewMode" title="预览分辨率" @change="onModeChange">
        <option value="original">原始</option>
        <option value="720p">720p</option>
        <option value="1080p">1080p</option>
      </select>
      <select :value="state.previewFps" title="预览帧率" @change="onFpsChange">
        <option :value="60">60 fps</option>
        <option :value="30">30 fps</option>
      </select>
    </div>
    <div class="canvas-wrap">
      <canvas ref="canvasRef" />
      <div v-if="!state.connected" class="no-signal">
        <div class="no-signal-text">未连接游戏</div>
        <div class="no-signal-hint">游戏内按 F9 打开/关闭 WebUI 编辑器</div>
      </div>
      <div v-if="flightMode" class="flight-overlay">
        <div class="flight-title">飞控模式</div>
        <template v-if="flightState">
          <div class="flight-line">位置: {{ flightState.x.toFixed(1) }} / {{ flightState.y.toFixed(1) }} / {{ flightState.z.toFixed(1) }}</div>
          <div class="flight-line">Yaw: {{ flightState.yaw.toFixed(1) }}  Pitch: {{ flightState.pitch.toFixed(1) }}  Roll: {{ flightState.roll.toFixed(1) }}</div>
          <div class="flight-line">FOV: {{ flightState.fov.toFixed(1) }}  Zoom: {{ flightState.zoom.toFixed(1) }}</div>
        </template>
        <div class="flight-actions">
          <button @click="exitFlightMode(true)">退出并保存</button>
          <button @click="exitFlightMode(false)">取消</button>
        </div>
      </div>
    </div>
    <div class="controls">
      <button class="icon-btn play-btn" @click="state.playing ? pause() : play()" :title="state.playing ? '暂停' : '播放'">
        <img :src="state.playing ? pauseIcon : playIcon" alt="播放" />
      </button>
      <button class="icon-btn" @click="stop" title="停止">
        <img :src="stopIcon" alt="停止" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #0a0a0c;
}
.bar {
  padding: 6px 12px;
  background: #101318;
  border-bottom: 1px solid #222;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  font-family: monospace;
}
.bar span { color: #8a8a96; }
.bar .spacer { flex: 1; }
.bar select {
  background: #1a1d24;
  color: #c8c8d0;
  border: 1px solid #333;
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  padding: 2px 4px;
}
.ok { color: #34d399 !important; }
.bad { color: #ef4444 !important; }
.warn { color: #f59e0b !important; }
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  background: #101318;
  border-top: 1px solid #222;
}
.icon-btn {
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.icon-btn:hover { background: #28282e; }
.icon-btn img {
  width: 18px;
  height: 18px;
  filter: brightness(0) invert(0.85);
}
.play-btn {
  width: 36px;
  height: 36px;
  background: #2f3b55;
}
.play-btn:hover { background: #3a4a6b; }
.play-btn img {
  width: 20px;
  height: 20px;
  filter: brightness(0) invert(1);
}
.canvas-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.no-signal {
  position: absolute;
  text-align: center;
  color: #444;
}
.no-signal-text {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}
.no-signal-hint {
  font-size: 12px;
  color: #555;
}
.flight-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid #4e7bd3;
  border-radius: 6px;
  padding: 10px 12px;
  color: #e0e0e0;
  font-size: 12px;
  z-index: 10;
  min-width: 220px;
}
.flight-title {
  font-weight: 700;
  color: #4e7bd3;
  margin-bottom: 4px;
}
.flight-line {
  font-family: monospace;
  margin-bottom: 2px;
}
.flight-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.flight-actions button {
  font-size: 11px;
}
</style>
