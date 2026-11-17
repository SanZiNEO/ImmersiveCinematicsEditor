<script setup lang="ts">
/**
 * 预览面板（04-02 中栏 / 04-09 宿主层）。
 *
 * 只消费宿主提供的预览帧（18 字节帧头）：RGBA 帧直接画到 canvas；
 * H.264 帧交给宿主/后续轮次解码，这里只显示编码器状态（不假装能解码）。
 * 无连接时显示真实空态，不画假画面。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import type { PreviewStats } from '../api/preview.ts'
import { PREVIEW_TYPE_RGBA, parsePreviewFrame } from '../api/preview.ts'
import type { PreviewServicePort } from '../api/preview.ts'
import { PREVIEW_SERVICE } from '../api/tokens.ts'
import { useI18n, useServices } from './useWorkbench.ts'

const services = useServices()
const i18n = useI18n()

const canvas = ref<HTMLCanvasElement | null>(null)
const tick = ref(0)
const lastFrameInfo = shallowRef<{ width: number; height: number; frameId: number } | null>(null)
const error = ref<string | null>(null)

let service: PreviewServicePort | null = null
let unsubscribeFrame: (() => void) | null = null
let unsubscribeState: (() => void) | null = null

function preview(): PreviewServicePort | null {
  if (service === null) {
    service = services.get(PREVIEW_SERVICE) ?? null
  }
  return service
}

function draw(frame: { width: number; height: number; payload: Uint8Array }): void {
  const element = canvas.value
  if (element === null) {
    return
  }
  const context = element.getContext('2d')
  if (context === null) {
    return
  }
  if (element.width !== frame.width || element.height !== frame.height) {
    element.width = frame.width
    element.height = frame.height
  }
  const pixels = new Uint8ClampedArray(frame.width * frame.height * 4)
  pixels.set(frame.payload.subarray(0, pixels.length))
  context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0)
}

onMounted(() => {
  const current = preview()
  if (current === null) {
    error.value = i18n.t('preview.unavailable')
    return
  }
  unsubscribeFrame = current.onFrame((raw) => {
    const parsed = parsePreviewFrame(raw.payload.buffer.slice(raw.payload.byteOffset, raw.payload.byteOffset + raw.payload.byteLength) as ArrayBuffer)
    if (parsed === null) {
      return
    }
    if (parsed.type === PREVIEW_TYPE_RGBA) {
      draw({ width: parsed.width, height: parsed.height, payload: parsed.payload })
    }
    lastFrameInfo.value = { width: parsed.width, height: parsed.height, frameId: parsed.frameId }
    tick.value += 1
  })
  unsubscribeState = current.subscribe(() => {
    tick.value += 1
  })
})

onBeforeUnmount(() => {
  unsubscribeFrame?.()
  unsubscribeState?.()
  unsubscribeFrame = null
  unsubscribeState = null
})

const stats = computed<PreviewStats | null>(() => {
  void tick.value
  return preview()?.stats() ?? null
})

const connected = computed(() => {
  void tick.value
  return preview()?.connected() ?? false
})

const lastFrameAt = computed(() => {
  void tick.value
  return preview()?.lastFrameAt() ?? null
})

const statusText = computed(() => {
  if (!connected.value) {
    return i18n.t('preview.offline')
  }
  const current = stats.value
  if (current === null) {
    return i18n.t('preview.waiting')
  }
  const encoder = current.encoder ?? 'unknown'
  const size = lastFrameInfo.value === null ? '' : `${lastFrameInfo.value.width}×${lastFrameInfo.value.height}`
  return `${encoder} · ${size} · ${i18n.t('preview.lastFrame')}: ${lastFrameAt.value === null ? '-' : new Date(lastFrameAt.value).toLocaleTimeString()}`
})
</script>

<template>
  <section class="preview-panel">
    <div class="preview-surface">
      <canvas ref="canvas" class="preview-canvas" />
      <p v-if="!lastFrameInfo" class="preview-empty" role="status">
        {{ connected ? i18n.t('preview.waiting') : i18n.t('preview.offline') }}
      </p>
    </div>
    <footer class="preview-status">
      <span :class="{ online: connected }" role="status">{{ statusText }}</span>
      <span v-if="error" class="preview-error" role="alert">{{ error }}</span>
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
