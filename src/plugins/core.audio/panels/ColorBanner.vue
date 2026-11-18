<script setup lang="ts">
/**
 * 调色面板横幅（10-04/10-07）：同实例多 ADJUST 轨的覆盖提示 + LUT 强度/输入 gamma 提示。
 *
 * 运行时同一实例内后发布的 ADJUST 轨覆盖前者，不叠乘；编辑器只按当前文档的
 * ADJUST 轨与播放头给提示，不猜“哪个实例先发布”。
 */
import { computed } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { colorLayerNotice, lutStrengthNotice } from '../shared/colorSpec.ts'

const props = defineProps<{ clipKey: string | null }>()
const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)

function valueOf(objects: Record<string, JsonValue>, path: string): JsonValue | undefined {
  const property = objects[path]
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return undefined
  const record = property as Record<string, JsonValue>
  return Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : undefined
}

const found = computed(() => {
  const view = documentService?.view()
  if (view === null || view === undefined || props.clipKey === null) return null
  for (const track of view.tracks) {
    const clip = track.clips.find((entry) => entry.clipKey === props.clipKey)
    if (clip !== undefined && (track.type === 'ADJUST' || track.type === 'CAMERA')) {
      return { view, track, clip, objects: documentService?.clipObjects(props.clipKey) ?? {} }
    }
  }
  return null
})

const layerNotice = computed(() => {
  const item = found.value
  if (item === null) return null
  const adjustTracks = item.view.tracks.filter((track) => track.type === 'ADJUST')
  if (adjustTracks.length <= 1) return null
  const playhead = documentService?.sessionView().playhead ?? 0
  const active = adjustTracks
    .filter((track) => track.clips.some((clip) => playhead >= clip.start
      && (clip.infinite || playhead < clip.start + clip.duration - 1e-9)))
    .map((track) => track.name)
  return colorLayerNotice({ adjustTrackCount: adjustTracks.length, activeAdjustTrackNames: active })
})

const lutNotice = computed(() => {
  const item = found.value
  if (item === null || item.track.type !== 'ADJUST') return null
  return lutStrengthNotice({
    lut: valueOf(item.objects, 'lut'),
    strength: valueOf(item.objects, 'lut_strength'),
  })
})

/** 10-09：同一条 ADJUST 轨上的片段重叠，后者不参与调色（只做提示，不改文档）。 */
const sameTrackOverlap = computed(() => {
  const item = found.value
  if (item === null || item.track.type !== 'ADJUST' || item.track.clips.length < 2) return null
  const upper = item.view.contentEnd ?? Math.max(60, ...item.track.clips.map((clip) => clip.start + (clip.infinite ? 60 : clip.duration)))
  for (let later = 1; later < item.track.clips.length; later += 1) {
    const laterClip = item.track.clips[later]
    const earlierClip = item.track.clips[later - 1]
    if (laterClip === undefined || earlierClip === undefined) continue
    const earlierEnd = earlierClip.infinite ? upper : earlierClip.start + earlierClip.duration
    const laterEnd = laterClip.infinite ? upper : laterClip.start + laterClip.duration
    const start = Math.max(earlierClip.start, laterClip.start)
    const end = Math.min(earlierEnd, laterEnd)
    if (end - start <= 1e-9) continue
    return `同轨重叠：${laterClip.clipKey} 与更早的 ${earlierClip.clipKey} 在 ${start.toFixed(2)}–${end.toFixed(2)}s 同时命中；运行时同一时刻只有第一个活跃片段参与调色。`
  }
  return null
})

const gamma = computed(() => {
  const item = found.value
  if (item === null || item.track.type !== 'ADJUST') return null
  const raw = valueOf(item.objects, 'lut_input_gamma')
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
})
</script>

<template>
  <div v-if="found !== null" class="wf-color-banner">
    <p v-if="layerNotice !== null" class="wf-color-banner__line">{{ layerNotice }}</p>
    <p v-if="sameTrackOverlap !== null" class="wf-color-banner__line wf-color-banner__line--warn">{{ sameTrackOverlap }}</p>
    <p v-if="lutNotice !== null" class="wf-color-banner__line wf-color-banner__line--warn">{{ lutNotice }}</p>
    <p v-if="found.track.type === 'CAMERA'" class="wf-color-banner__line">
      CAMERA 片段没有 LUT / 层混合；这些只在 ADJUST 调整层上生效。
    </p>
    <p v-else-if="gamma !== 1" class="wf-color-banner__line">
      LUT 输入 gamma = {{ gamma }}：查表前先对 RGB 做 pow(clamp(c,0,1), gamma)。
    </p>
  </div>
</template>

<style scoped>
.wf-color-banner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}

.wf-color-banner__line {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-color-banner__line--warn {
  color: var(--warning);
}
</style>
