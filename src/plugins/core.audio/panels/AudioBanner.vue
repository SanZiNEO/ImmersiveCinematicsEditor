<script setup lang="ts">
/**
 * AUDIO 片段头横幅（10-02）：片段循环 ×N 与文件循环分开显示，并给重叠/整段跳过摘要。
 */
import { computed } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import {
  audioCategoryNotice,
  fadeProblem,
  overlappingAudioClips,
  type AudioSpan,
} from '../shared/audioSpec.ts'

const props = defineProps<{ clipKey: string | null }>()
const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)

function numberAt(objects: Record<string, JsonValue>, path: string): number {
  const raw = objects[path]
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}
function stringAt(objects: Record<string, JsonValue>, path: string, fallback: string): string {
  const raw = objects[path]
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'string' && value !== '') return value
  }
  return fallback
}
function boolAt(objects: Record<string, JsonValue>, path: string): boolean {
  const raw = objects[path]
  if (typeof raw === 'object' && raw !== null) {
    return (raw as Record<string, JsonValue>).value === true
  }
  return false
}

const found = computed(() => {
  const view = documentService?.view()
  if (view === null || view === undefined || props.clipKey === null) return null
  for (const track of view.tracks) {
    const clip = track.clips.find((entry) => entry.clipKey === props.clipKey)
    if (clip !== undefined && track.type === 'AUDIO') {
      return { view, track, clip, objects: documentService?.clipObjects(props.clipKey) ?? {} }
    }
  }
  return null
})

const loopLabel = computed(() => {
  const item = found.value
  if (item === null) return ''
  if (!item.clip.loop) return '片段循环 关'
  const count = item.clip.loopCount ?? -1
  return count < 0 ? '片段循环 ∞' : `片段循环 ×${count}`
})

const fileLoopLabel = computed(() => {
  const item = found.value
  if (item === null) return ''
  return boolAt(item.objects, 'file_loop') ? '文件循环 开' : '文件循环 关'
})

const fadeLabel = computed(() => {
  const item = found.value
  if (item === null) return ''
  const fadeIn = numberAt(item.objects, 'fade_in')
  const fadeOut = numberAt(item.objects, 'fade_out')
  if (fadeIn === 0 && fadeOut === 0) return '淡入淡出 无'
  return `淡入 ${fadeIn.toFixed(2)}s · 淡出 ${fadeOut.toFixed(2)}s`
})

const overlapCount = computed(() => {
  const item = found.value
  if (item === null) return 0
  const spans: AudioSpan[] = item.track.clips.map((clip) => ({
    key: clip.clipKey,
    start: clip.start,
    duration: clip.infinite ? (item.view.contentEnd ?? 60) - clip.start : clip.duration,
    infinite: clip.infinite,
  }))
  const end = item.view.contentEnd ?? Math.max(60, ...spans.map((span) => span.start + (span.infinite ? 60 : span.duration)))
  return overlappingAudioClips(spans, end).length
})

const warnings = computed(() => {
  const item = found.value
  if (item === null) return []
  const messages: string[] = []
  const problem = fadeProblem({
    duration: item.clip.duration,
    infinite: item.clip.infinite,
    fadeIn: numberAt(item.objects, 'fade_in'),
    fadeOut: numberAt(item.objects, 'fade_out'),
  })
  if (problem !== null) messages.push(problem.message)
  const category = stringAt(item.objects, 'category', 'music')
  const positionMode = stringAt(item.objects, 'position_mode', 'relative')
  const attenuation = stringAt(item.objects, 'attenuation', 'linear')
  const notice = audioCategoryNotice({ category, positionMode, attenuation })
  if (notice !== null) messages.push(notice)
  if (overlapCount.value > 0) messages.push(`同轨有 ${overlapCount.value} 处重叠：重叠区间内只播 storage order 的第一个活跃片段。`)
  return messages
})
</script>

<template>
  <div v-if="found !== null" class="wf-audio-banner">
    <div class="wf-audio-banner__line">
      <span class="wf-audio-banner__chip">{{ loopLabel }}</span>
      <span class="wf-audio-banner__chip">{{ fileLoopLabel }}</span>
      <span class="wf-audio-banner__chip">{{ fadeLabel }}</span>
      <span v-if="overlapCount > 0" class="wf-audio-banner__chip wf-audio-banner__chip--warn">重叠 {{ overlapCount }}</span>
    </div>
    <p v-for="message in warnings" :key="message" class="wf-audio-banner__warn">{{ message }}</p>
  </div>
</template>

<style scoped>
.wf-audio-banner {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}

.wf-audio-banner__line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wf-audio-banner__chip {
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 10px;
}

.wf-audio-banner__chip--warn {
  border-color: var(--warning);
  color: var(--warning);
}

.wf-audio-banner__warn {
  margin: 0;
  color: var(--warning);
  font-size: 10px;
}
</style>
