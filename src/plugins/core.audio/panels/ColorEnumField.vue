<script setup lang="ts">
/**
 * 层混合枚举（10-05/10-07）：blend_mode 五种模式；提示只由 ADJUST 轨生效。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
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
  return typeof raw === 'string' ? raw : 'normal'
})

const HINTS: Record<string, string> = {
  normal: 'normal：调整层直接替换基画面（缺省）。',
  multiply: 'multiply：a·b，整体压暗。',
  screen: 'screen：1-(1-a)(1-b)，整体提亮。',
  soft_light: 'soft_light：W3C 柔光公式，按基画面明暗柔和推亮/压暗。',
  overlay: 'overlay：基画面 ≤0.5 走 multiply，>0.5 走 screen。',
}

const hint = computed(() => HINTS[value.value] ?? '')

function onChange(event: Event): void {
  const next = (event.target as HTMLSelectElement).value
  const outcome = commitStaticValue(ctx.commands, props.row, next as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}
</script>

<template>
  <div class="wf-blend" :data-path="row.path">
    <select class="wf-blend__select" :value="value" :disabled="disabled" :aria-label="row.label" @change="onChange">
      <option v-for="item in (row.enumValues ?? [])" :key="item" :value="item">{{ item }}</option>
    </select>
    <p class="wf-blend__hint">{{ hint }}</p>
    <p class="wf-blend__hint">只由 ADJUST 轨取值；同实例多 ADJUST 轨时后发布者覆盖，不叠乘。</p>
    <p v-if="error !== ''" class="wf-blend__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-blend {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wf-blend__select {
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.wf-blend__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-blend__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}
</style>
