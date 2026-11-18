<script setup lang="ts">
/**
 * Lift / Gamma / Gain 三通道三元组（10-05 §三）。
 *
 * 默认值 0；目录范围为 -1..1。三通道可勾选“同值联动”：开启时改一个通道，
 * 另两个跟随写入；关闭后各自独立。任何通道有帧时不做隐式写值——只允许在
 * 播放头正好落帧时写该帧，否则提示去效果面板，和 10 的 leaf 回流规则一致。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { clampNumber, commitPathValue } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const base = computed<'lift' | 'gamma' | 'gain'>(() => {
  if (props.row.path.startsWith('gamma_')) return 'gamma'
  if (props.row.path.startsWith('gain_')) return 'gain'
  return 'lift'
})
const channels = computed(() => [`${base.value}_r`, `${base.value}_g`, `${base.value}_b`] as const)
const labels = ['R', 'G', 'B'] as const

const linked = ref(false)
const error = ref('')
const notice = ref('')

const range = computed(() => ({
  min: typeof props.row.min === 'number' ? props.row.min : -1,
  max: typeof props.row.max === 'number' ? props.row.max : 1,
  step: 0.001,
}))

function framesOf(path: string): readonly JsonValue[] {
  const property = props.objects[path]
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return []
  const frames = (property as Record<string, JsonValue>).keyframes
  return Array.isArray(frames) ? frames : []
}

const anyFramed = computed(() => channels.value.some((path) => framesOf(path).length > 0))
const framedSummary = computed(() => channels.value
  .filter((path) => framesOf(path).length > 0)
  .map((path) => `${path} ${framesOf(path).length} 帧`)
  .join(' · '))

function valueOf(path: string): number {
  const property = props.objects[path]
  if (typeof property === 'object' && property !== null && !Array.isArray(property)) {
    const explicit = (property as Record<string, JsonValue>).value
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  }
  return 0
}

function sliderValue(path: string): number {
  return clampNumber(valueOf(path), range.value.min, range.value.max, range.value.step)
}

function commitOne(path: string, raw: number): void {
  if (props.disabled) return
  if (!Number.isFinite(raw)) {
    error.value = `${path} 需要有限数字`
    return
  }
  if (raw < range.value.min || raw > range.value.max) {
    error.value = `${path} 超出范围 ${range.value.min}..${range.value.max}，未写入`
    return
  }
  const outcome = commitPathValue(ctx.commands, props.row, props.objects, path, raw, props.playhead)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}

function onNumber(path: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') {
    error.value = '需要一个数字'
    return
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    error.value = '需要有限数字'
    return
  }
  apply(path, parsed)
}

function onSlider(path: string, event: Event): void {
  const parsed = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(parsed)) return
  apply(path, parsed)
}

function apply(path: string, next: number): void {
  if (!linked.value) {
    commitOne(path, next)
    return
  }
  for (const channel of channels.value) {
    commitOne(channel, next)
  }
}

function resetGroup(): void {
  if (props.disabled) return
  if (anyFramed.value && !window.confirm('该组有关键帧，清除全部关键帧并恢复默认 0？')) {
    return
  }
  // 一次批量提交：有关键帧的通道先关动画（删帧、保留确定值），再统一写回 0。
  const batch: DocCommand[] = channels.value.flatMap((channel) => {
    const commands: DocCommand[] = []
    if (framesOf(channel).length > 0) {
      commands.push({ kind: 'object.disableAnimation', clipKey: props.row.clipKey, path: channel })
    }
    commands.push({ kind: 'object.setValue', clipKey: props.row.clipKey, path: channel, value: 0 })
    return commands
  })
  const outcome = ctx.commands.commitBatch(batch)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
  notice.value = `${base.value} 三通道已恢复默认 0`
}
</script>

<template>
  <div class="wf-triple" :data-base="base">
    <div class="wf-triple__head">
      <span class="wf-triple__title">{{ base }} 三通道</span>
      <label class="wf-triple__link">
        <input v-model="linked" type="checkbox" :disabled="disabled">
        三通道同值
      </label>
      <button type="button" class="wf-triple__reset" :disabled="disabled" @click="resetGroup">
        重置组
      </button>
    </div>
    <p v-if="anyFramed" class="wf-triple__framed">
      有帧：{{ framedSummary }}。值控件只在播放头落在帧上时写帧；否则请到效果面板编辑。
    </p>
    <div v-for="(path, index) in channels" :key="path" class="wf-triple__row">
      <span class="wf-triple__label">{{ labels[index] }}</span>
      <input
        class="wf-triple__range"
        type="range"
        :min="range.min"
        :max="range.max"
        :step="range.step"
        :value="sliderValue(path)"
        :disabled="disabled"
        @input="onSlider(path, $event)"
      >
      <input
        class="wf-triple__number"
        type="number"
        :min="range.min"
        :max="range.max"
        :step="range.step"
        :value="valueOf(path)"
        :disabled="disabled"
        @change="onNumber(path, $event)"
      >
      <span v-if="valueOf(path) === 0" class="wf-triple__default">默认</span>
    </div>
    <p v-if="error !== ''" class="wf-triple__error" role="alert">{{ error }}</p>
    <p v-else-if="notice !== ''" class="wf-triple__notice">{{ notice }}</p>
  </div>
</template>

<style scoped>
.wf-triple {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 3px 0;
}
.wf-triple__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.wf-triple__title { color: var(--text-secondary); }
.wf-triple__link { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 10px; }
.wf-triple__reset {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}
.wf-triple__reset:disabled { opacity: 0.5; cursor: default; }
.wf-triple__row { display: flex; align-items: center; gap: 6px; }
.wf-triple__label { width: 12px; color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }
.wf-triple__range { flex: 1 1 auto; min-width: 0; }
.wf-triple__number {
  width: 66px;
  padding: 1px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
}
.wf-triple__default { width: 24px; color: var(--text-muted); font-size: 9px; }
.wf-triple__framed {
  margin: 0;
  color: var(--warning);
  font-size: 10px;
}
.wf-triple__error { margin: 0; color: var(--error); font-size: 10px; }
.wf-triple__notice { margin: 0; color: var(--text-muted); font-size: 10px; }
</style>
