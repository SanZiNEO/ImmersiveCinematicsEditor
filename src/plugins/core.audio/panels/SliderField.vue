<script setup lang="ts">
/**
 * 10 数值字段：滑杆 + 数值 + 重置（不复制 06 的时钟/菱形；有帧时本控件已被隐藏）。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { rangeOf } from '../shared/fieldOps.ts'
import { audioSliderRange } from '../shared/audioSpec.ts'
import { colorSliderStep } from '../shared/colorSpec.ts'
import { clampNumber, commitStaticValue, currentNumberOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')

const trackType = computed(() => props.row.def?.scope[0] ?? '')

const range = computed(() => {
  if (trackType.value === 'AUDIO') {
    const audio = audioSliderRange(props.row.path, props.timing.duration)
    if (audio !== null) return audio
  }
  return rangeOf(props.row, { min: 0, max: 1, step: colorSliderStep(props.row.path) })
})

/** 10-03：x/y/z 标签随 position_mode 变化，说明坐标语义。 */
const displayLabel = computed(() => {
  if (trackType.value !== 'AUDIO' || !['x', 'y', 'z'].includes(props.row.path)) {
    return props.row.label
  }
  const raw = props.objects.position_mode
  const mode = typeof raw === 'object' && raw !== null
    ? (raw as Record<string, JsonValue>).value
    : 'relative'
  const suffix = props.row.path.toUpperCase()
  return mode === 'absolute' ? `世界坐标 ${suffix}` : `听者偏移 ${suffix}`
})

const coordinateHint = computed(() => {
  if (trackType.value !== 'AUDIO' || !['x', 'y', 'z'].includes(props.row.path)) return ''
  if (inactiveByMusic.value) return ''
  const raw = props.objects.position_mode
  const mode = typeof raw === 'object' && raw !== null
    ? (raw as Record<string, JsonValue>).value
    : 'relative'
  return mode === 'absolute'
    ? 'absolute：世界坐标，声源不跟随听者；切换 listener 不改变该值。'
    : 'relative：听者偏移；实际听者可能是玩家或相机（由 listener 与活跃 CAMERA 决定）。'
})

const value = computed(() => currentNumberOf(props.row, props.objects))

/** 10-01：category=music 时 x/y/z 值保留但不参与定位，控件禁用并说明。 */
const inactiveByMusic = computed(() => {
  if (trackType.value !== 'AUDIO') return false
  if (!['x', 'y', 'z'].includes(props.row.path)) return false
  const raw = props.objects.category
  const category = typeof raw === 'object' && raw !== null
    ? (raw as Record<string, JsonValue>).value
    : 'music'
  return category === 'music'
})

const draft = ref<number | null>(value.value)
watch(value, (next) => {
  draft.value = next
})

const display = computed(() => {
  if (draft.value === null) return '（未设置）'
  return Number.isInteger(draft.value) ? String(draft.value) : draft.value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
})

function onRange(event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(next)) draft.value = clampNumber(next, range.value.min, range.value.max, range.value.step)
}

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const next = Number(raw)
  if (raw === '' || !Number.isFinite(next)) {
    error.value = '需要一个有限数字'
    draft.value = value.value
    return
  }
  // 10-05：数字框允许输入越界值，提交时校验并拒绝；不静默夹取。
  if (next < range.value.min || next > range.value.max) {
    // 10-01：pitch 原样交给游戏，数值框不钳制；滑杆只给常见区间。
    if (!(trackType.value === 'AUDIO' && props.row.path === 'pitch')) {
      error.value = `${props.row.path}=${next} 超出范围 ${range.value.min}..${range.value.max}，未写入`
      draft.value = value.value
      return
    }
  }
  draft.value = next
  commitDraft()
}

function commitRange(): void {
  commitDraft()
}

function commitDraft(): void {
  if (draft.value === null || props.disabled) return
  const outcome = commitStaticValue(ctx.commands, props.row, draft.value as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    draft.value = value.value
    return
  }
  error.value = ''
}

function reset(): void {
  const fallback = props.row.hasDefault ? props.row.defaultValue as JsonValue : undefined
  draft.value = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : range.value.min
  if (draft.value !== null) commitDraft()
}

const dirty = computed(() => {
  const current = value.value
  if (current === null) return false
  const fallback = props.row.hasDefault ? props.row.defaultValue : undefined
  return typeof fallback === 'number' ? Math.abs(current - fallback) > 1e-9 : true
})
</script>

<template>
  <div class="wf-slider" :data-path="row.path">
    <div class="wf-slider__line">
      <input
        class="wf-slider__range"
        type="range"
        :min="range.min"
        :max="range.max"
        :step="range.step"
        :value="draft ?? range.min"
        :disabled="disabled || inactiveByMusic"
        :aria-label="row.label"
        @input="onRange"
        @change="commitRange"
      >
      <input
        class="wf-slider__number"
        type="number"
        :min="range.min"
        :max="range.max"
        :step="range.step"
        :value="draft === null ? '' : draft"
        :disabled="disabled || inactiveByMusic"
        :aria-label="`${row.label} 数值`"
        @change="onNumber"
        @dblclick.prevent="reset"
      >
      <button
        type="button"
        class="wf-slider__reset"
        :disabled="disabled || !dirty"
        title="重置为默认值"
        @click="reset"
      >
        ↺
      </button>
    </div>
    <p v-if="inactiveByMusic" class="wf-slider__hint">category=music：固定相对玩家、无衰减；该坐标值保留但不参与定位（切回 ambient 后可编辑）。</p>
    <p v-else-if="coordinateHint !== ''" class="wf-slider__hint">{{ displayLabel }}：{{ coordinateHint }}</p>
    <p v-if="error !== ''" class="wf-slider__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.wf-slider__line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wf-slider__range {
  flex: 1 1 auto;
  min-width: 40px;
  accent-color: var(--accent);
}

.wf-slider__number {
  flex: 0 0 64px;
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

.wf-slider__number:focus-visible,
.wf-slider__range:focus-visible,
.wf-slider__reset:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.wf-slider__reset {
  flex: 0 0 auto;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
}

.wf-slider__reset:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.wf-slider__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}
</style>
