<script setup lang="ts">
/**
 * 混合模式控件（09-02）：只有下拉；脚本没有强度字段。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { BLEND_MODES } from '../../../features/overlay/colorMask.ts'
import { explicitValue } from '../../../features/overlay/layers.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { ensureExplicitLayerTypeCommands } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const notice = ref('')
const error = ref('')

const current = computed(() => {
  const explicit = explicitValue(props.objects, 'blend_mode')
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : 'normal'
})

function change(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (props.disabled) return
  const commands: import('../../../core/doc/commands.ts').DocCommand[] = [
    ...ensureExplicitLayerTypeCommands(props.row.clipKey, props.objects, 'blend_mode'),
    { kind: 'object.setValue', clipKey: props.row.clipKey, path: 'blend_mode', value },
  ]
  const outcome = ctx.commands.commitBatch(commands, `overlay-blend:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '混合模式写入失败'
    return
  }
  error.value = ''
  notice.value = `已写入 blend_mode=${value}`
}
</script>

<template>
  <div class="overlay-blend">
    <label>
      混合
      <select :value="current" :disabled="disabled" @change="change">
        <option v-for="mode in BLEND_MODES" :key="mode" :value="mode">{{ mode }}</option>
      </select>
    </label>
    <span class="overlay-blend__note">
      脚本没有混合强度字段：非 normal 只改变混合公式。
    </span>
    <span v-if="notice !== ''" class="overlay-blend__ok" role="status">{{ notice }}</span>
    <span v-if="error !== ''" class="overlay-blend__error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.overlay-blend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.overlay-blend label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-blend select {
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-blend__note {
  flex: 1 1 100%;
  color: var(--text-muted);
  font-size: 10px;
}

.overlay-blend__ok,
.overlay-blend__error {
  flex: 1 1 100%;
  font-size: 11px;
}

.overlay-blend__ok {
  color: var(--text-secondary);
}

.overlay-blend__error {
  color: var(--error);
}
</style>
