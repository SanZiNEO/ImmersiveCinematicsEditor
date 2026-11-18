<script setup lang="ts">
/**
 * `lut_strength`（10-07）：0–1 滑杆；未选 LUT 时视觉弱化并提示“不生效”，
 * 但控件仍可编辑（运行时上线会强制 0，不静默改作者值）。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { lutStrengthNotice } from '../shared/colorSpec.ts'
import { commitPathValue, currentNumberOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const value = computed(() => currentNumberOf(props.row, props.objects) ?? 1)
const lutValue = computed(() => {
  const property = props.objects.lut
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return undefined
  return (property as Record<string, unknown>).value
})
const notice = computed(() => lutStrengthNotice({ lut: lutValue.value, strength: value.value }))
const error = ref('')

function commit(next: number): void {
  if (props.disabled) return
  if (!Number.isFinite(next) || next < 0 || next > 1) {
    error.value = 'LUT 强度必须在 0..1，未写入'
    return
  }
  const outcome = commitPathValue(ctx.commands, props.row, props.objects, props.row.path, next, props.playhead)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}

function onSlider(event: Event): void { commit(Number((event.target as HTMLInputElement).value)) }
function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const parsed = Number(raw)
  if (raw === '' || !Number.isFinite(parsed)) { error.value = '需要有限数字'; return }
  commit(parsed)
}
</script>

<template>
  <div class="wf-lut-strength" :class="{ 'wf-lut-strength--inactive': notice !== null }">
    <div class="wf-lut-strength__line">
      <input
        class="wf-lut-strength__range"
        type="range"
        min="0"
        max="1"
        step="0.001"
        :value="value"
        :disabled="disabled"
        @input="onSlider"
      >
      <input
        class="wf-lut-strength__number"
        type="number"
        min="0"
        max="1"
        step="0.001"
        :value="value"
        :disabled="disabled"
        @change="onNumber"
      >
      <span v-if="value === 1" class="wf-lut-strength__default">默认</span>
    </div>
    <p v-if="notice !== null" class="wf-lut-strength__notice">{{ notice }}</p>
    <p v-if="error !== ''" class="wf-lut-strength__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-lut-strength { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
.wf-lut-strength--inactive { opacity: 0.72; }
.wf-lut-strength__line { display: flex; align-items: center; gap: 5px; }
.wf-lut-strength__range { flex: 1 1 auto; min-width: 0; }
.wf-lut-strength__number {
  width: 60px;
  padding: 1px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
}
.wf-lut-strength__default { color: var(--text-muted); font-size: 9px; }
.wf-lut-strength__notice { margin: 0; color: var(--warning); font-size: 10px; }
.wf-lut-strength__error { margin: 0; color: var(--error); font-size: 10px; }
</style>
