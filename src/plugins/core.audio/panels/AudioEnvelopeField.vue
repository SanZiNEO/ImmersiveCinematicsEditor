<script setup lang="ts">
/**
 * AUDIO 包络（10-02）：fade_in + fade_out 合并控件 + 只读示意曲线 + 整段跳过/重叠提示。
 *
 * 运行时口径（`AudioTrackPlayer.resolveFadeEnvelope`）：
 * 线性 0→1（fade_in）与 1→0（fade_out）；无限片段只有 fade_in；fade_out 覆盖 fade_in 的尾段、不相加。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import {
  audioEnvelope,
  fadeProblem,
  overlappingAudioClips,
  type AudioSpan,
} from '../shared/audioSpec.ts'
import { commitStaticValue, currentValueOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const error = ref('')

function numberAt(objects: JsonObject, path: string): number {
  const raw = objects[path]
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, JsonValue>).value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return path === 'fade_in' || path === 'fade_out' ? 0 : 0
}

const fadeIn = computed(() => Math.max(0, numberAt(props.objects, 'fade_in')))
const fadeOut = computed(() => Math.max(0, numberAt(props.objects, 'fade_out')))

const fadeInRow = computed<PropertyRow>(() => props.row)
const fadeOutRow = computed<PropertyRow>(() => ({
  ...props.row,
  path: 'fade_out',
  label: '淡出',
}))

const problem = computed(() => fadeProblem({
  duration: props.timing.duration,
  infinite: props.timing.infinite,
  fadeIn: fadeIn.value,
  fadeOut: fadeOut.value,
}))

/** 同轨片段跨度（只为重叠提示；顺序 = 文档顺序 = 运行时 storage order）。 */
const spans = computed<AudioSpan[]>(() => {
  const view = documentService?.view()
  if (view === null || view === undefined) return []
  const current = view.tracks
    .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    .find((entry) => entry.clip.clipKey === props.row.clipKey)
  if (current === undefined) return []
  const audioTrack = view.tracks.find((track) => track.type === 'AUDIO' && track.clips.some((clip) => clip.clipKey === props.row.clipKey))
  if (audioTrack === undefined) return []
  return audioTrack.clips.map((clip) => {
    const objects = documentService?.clipObjects(clip.clipKey) ?? {}
    return {
      key: clip.clipKey,
      start: clip.start,
      duration: clip.infinite ? (view.contentEnd ?? 60) - clip.start : clip.duration,
      infinite: clip.infinite,
    }
  })
})

const upperBound = computed(() => {
  const view = documentService?.view()
  const end = view?.contentEnd
  if (end !== null && end !== undefined && end > 0) return end
  return Math.max(
    props.timing.infinite ? 60 : props.timing.duration,
    ...spans.value.map((span) => span.start + (span.infinite ? 60 : span.duration)),
    1,
  )
})

const overlaps = computed(() => overlappingAudioClips(spans.value, upperBound.value))

/** 采样曲线（无限片段取前 10 秒 / 片长）。 */
const samples = computed(() => {
  const duration = props.timing.infinite ? 10 : Math.max(0.001, props.timing.duration)
  const points: Array<{ x: number; y: number }> = []
  const count = 48
  for (let index = 0; index <= count; index += 1) {
    const time = duration * index / count
    points.push({
      x: index / count,
      y: audioEnvelope({
        time,
        duration,
        infinite: props.timing.infinite,
        fadeIn: fadeIn.value,
        fadeOut: fadeOut.value,
      }),
    })
  }
  return points
})

const polyline = computed(() => samples.value
  .map((point) => `${(point.x * 100).toFixed(2)},${((1 - point.y) * 100).toFixed(2)}`)
  .join(' '))

function commit(path: string, value: number, row: PropertyRow): void {
  if (props.disabled) return
  const outcome = commitStaticValue(ctx.commands, row, value as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}

function onFadeIn(event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(next) || next < 0) {
    error.value = 'fade_in 需要 >= 0 的数字'
    return
  }
  commit('fade_in', next, fadeInRow.value)
}

function onFadeOut(event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(next) || next < 0) {
    error.value = 'fade_out 需要 >= 0 的数字'
    return
  }
  commit('fade_out', next, fadeOutRow.value)
}
</script>

<template>
  <div class="wf-envelope" :data-path="row.path">
    <div class="wf-envelope__line">
      <label class="wf-envelope__label">淡入
        <input
          class="wf-envelope__number"
          type="number"
          min="0"
          step="0.01"
          :value="fadeIn"
          :disabled="disabled"
          @change="onFadeIn"
        >
      </label>
      <label class="wf-envelope__label">淡出
        <input
          class="wf-envelope__number"
          type="number"
          min="0"
          step="0.01"
          :value="fadeOut"
          :disabled="disabled"
          @change="onFadeOut"
        >
      </label>
      <span class="wf-envelope__unit">秒</span>
    </div>

    <svg class="wf-envelope__graph" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="音量包络示意">
      <line x1="0" y1="100" x2="100" y2="100" class="wf-envelope__axis" />
      <polyline :points="polyline" class="wf-envelope__curve" />
    </svg>

    <p v-if="problem !== null" class="wf-envelope__warn">{{ problem.message }}</p>
    <p v-if="timing.infinite" class="wf-envelope__hint">
      无限片段：只有淡入生效；淡出对无限时长没有终点，不参与包络。
    </p>
    <p v-if="fadeIn > 0 && fadeOut > 0 && !timing.infinite && fadeIn + fadeOut < timing.duration" class="wf-envelope__hint">
      fade_in + fade_out < duration：中间有平台段。
    </p>
    <details v-if="overlaps.length > 0" class="wf-envelope__overlaps" open>
      <summary>同轨重叠 {{ overlaps.length }} 处</summary>
      <p v-for="item in overlaps" :key="item.laterClip + item.start" class="wf-envelope__warn">
        {{ item.message }}
      </p>
    </details>
    <p v-if="error !== ''" class="wf-envelope__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-envelope {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.wf-envelope__line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.wf-envelope__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}

.wf-envelope__number {
  width: 64px;
  box-sizing: border-box;
  padding: 2px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.wf-envelope__unit {
  color: var(--text-muted);
  font-size: 10px;
}

.wf-envelope__graph {
  width: 100%;
  height: 54px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
}

.wf-envelope__axis {
  stroke: var(--border-strong);
  stroke-width: 1;
}

.wf-envelope__curve {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
}

.wf-envelope__hint,
.wf-envelope__warn,
.wf-envelope__error {
  margin: 0;
  font-size: 10px;
}

.wf-envelope__hint {
  color: var(--text-muted);
}

.wf-envelope__warn {
  color: var(--warning);
}

.wf-envelope__error {
  color: var(--error);
}

.wf-envelope__overlaps summary {
  color: var(--warning);
  font-size: 10px;
  cursor: pointer;
}
</style>
