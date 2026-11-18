<script setup lang="ts">
/**
 * 曲线强度（10-05 §三 / 10-06）：0–1 滑杆，显示对应曲线是否已定义。
 * 强度为 0 表示该步关闭，但不删除曲线；曲线定义本身永不进效果面板。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { COLOR_CURVES, curveForStrengthPath } from '../shared/colorSpec.ts'
import { setCurveTarget } from '../shared/curveTarget.ts'
import { commitPathValue, currentNumberOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const curveKey = computed(() => curveForStrengthPath(props.row.path))
const curveLabel = computed(() => COLOR_CURVES.find((curve) => curve.key === curveKey.value)?.label ?? props.row.path)
const value = computed(() => currentNumberOf(props.row, props.objects) ?? 1)
const error = ref('')

const curveDefined = computed(() => {
  const key = curveKey.value
  if (key === null) return false
  const property = props.objects[key]
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return false
  const explicit = (property as Record<string, JsonValue>).value
  return Array.isArray(explicit) && explicit.length > 0
})

const hint = computed(() => {
  if (!curveDefined.value) return '曲线为空：强度不生效（可在曲线抽屉写入点集）'
  if (value.value === 0) return '该步关闭（曲线仍保留）'
  return ''
})

function commit(next: number): void {
  if (props.disabled) return
  if (!Number.isFinite(next) || next < 0 || next > 1) {
    error.value = '强度必须在 0..1，未写入'
    return
  }
  const outcome = commitPathValue(ctx.commands, props.row, props.objects, props.row.path, next, props.playhead)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}

function onSlider(event: Event): void {
  commit(Number((event.target as HTMLInputElement).value))
}

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const parsed = Number(raw)
  if (raw === '' || !Number.isFinite(parsed)) {
    error.value = '需要有限数字'
    return
  }
  commit(parsed)
}

function openCurves(): void {
  const key = curveKey.value
  if (key === null) return
  setCurveTarget({ key, clipKey: props.row.clipKey })
  ctx.requestOpenDrawer('color-curves')
}
</script>

<template>
  <div class="wf-curve-strength" :data-path="row.path">
    <div class="wf-curve-strength__line">
      <span class="wf-curve-strength__label" :title="curveLabel">{{ curveLabel }}</span>
      <input
        class="wf-curve-strength__range"
        type="range"
        min="0"
        max="1"
        step="0.001"
        :value="value"
        :disabled="disabled"
        @input="onSlider"
      >
      <input
        class="wf-curve-strength__number"
        type="number"
        min="0"
        max="1"
        step="0.001"
        :value="value"
        :disabled="disabled"
        @change="onNumber"
      >
      <span v-if="value === 1" class="wf-curve-strength__default">默认</span>
      <button type="button" class="wf-curve-strength__link" :disabled="disabled" @click="openCurves">
        编辑曲线
      </button>
    </div>
    <p v-if="hint !== ''" class="wf-curve-strength__hint">{{ hint }}</p>
    <p v-if="error !== ''" class="wf-curve-strength__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-curve-strength { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
.wf-curve-strength__line { display: flex; align-items: center; gap: 5px; }
.wf-curve-strength__label {
  max-width: 86px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-curve-strength__range { flex: 1 1 auto; min-width: 0; }
.wf-curve-strength__number {
  width: 60px;
  padding: 1px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
}
.wf-curve-strength__default { color: var(--text-muted); font-size: 9px; }
.wf-curve-strength__link {
  padding: 1px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--accent);
  font-size: 10px;
  cursor: pointer;
}
.wf-curve-strength__hint { margin: 0; color: var(--warning); font-size: 10px; }
.wf-curve-strength__error { margin: 0; color: var(--error); font-size: 10px; }
</style>
