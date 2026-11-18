<script setup lang="ts">
/**
 * LUT 输入 gamma（10-07）：必须 > 0；1 = 不变换；无 LUT 时忽略但不强制写值。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { checkLutGamma, lutStrengthNotice } from '../shared/colorSpec.ts'
import { commitStaticValue, currentValueOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')

const value = computed(() => {
  const raw = currentValueOf(props.row, props.objects)
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
})

const check = computed(() => checkLutGamma(value.value))

const noLut = computed(() => {
  const raw = props.objects.lut
  const strength = props.objects.lut_strength
  const lut = typeof raw === 'object' && raw !== null ? (raw as Record<string, JsonValue>).value : undefined
  const strengthValue = typeof strength === 'object' && strength !== null
    ? (strength as Record<string, JsonValue>).value
    : undefined
  return lutStrengthNotice({ lut: typeof lut === 'string' ? lut : '', strength: strengthValue })
})

function commit(next: number): void {
  if (props.disabled) return
  const outcome = commitStaticValue(ctx.commands, props.row, next as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}

function onChange(event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(next) || next <= 0) {
    error.value = 'lut_input_gamma 必须 > 0（1 = 不变换）'
    return
  }
  commit(next)
}
</script>

<template>
  <div class="wf-gamma" :data-path="row.path">
    <div class="wf-gamma__line">
      <input
        class="wf-gamma__number"
        type="number"
        min="0.0001"
        step="0.01"
        :value="value"
        :disabled="disabled"
        :aria-label="row.label"
        @change="onChange"
      >
      <span class="wf-gamma__unit">1 = 不变换</span>
    </div>
    <p v-if="check !== null" class="wf-gamma__error">{{ check }}</p>
    <p v-else-if="noLut !== null" class="wf-gamma__hint">{{ noLut }}</p>
    <p v-if="error !== ''" class="wf-gamma__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-gamma {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wf-gamma__line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-gamma__number {
  width: 72px;
  box-sizing: border-box;
  padding: 2px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.wf-gamma__unit,
.wf-gamma__hint {
  color: var(--text-muted);
  font-size: 10px;
}

.wf-gamma__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}

.wf-gamma__hint {
  margin: 0;
}
</style>
