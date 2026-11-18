<script setup lang="ts">
/**
 * AUDIO `file_loop`：只控制文件内循环，与片段循环（loop / loop_count / loop_mode）分开。
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

const checked = computed(() => {
  const raw = currentValueOf(props.row, props.objects)
  return raw === true
})

function onChange(event: Event): void {
  const next = (event.target as HTMLInputElement).checked
  const outcome = commitStaticValue(ctx.commands, props.row, next as JsonValue)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return
  }
  error.value = ''
}
</script>

<template>
  <div class="wf-file-loop" :data-path="row.path">
    <label class="wf-file-loop__line">
      <input
        type="checkbox"
        :checked="checked"
        :disabled="disabled"
        :aria-label="row.label"
        @change="onChange"
      >
      <span>文件内循环</span>
    </label>
    <p class="wf-file-loop__hint">
      只控制“音频文件自身循环播放”；片段循环（播放次数 / 往返）在片段头，两者互不替代。
    </p>
    <p v-if="error !== ''" class="wf-file-loop__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-file-loop {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wf-file-loop__line {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text);
  font-size: 11px;
}

.wf-file-loop__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-file-loop__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}
</style>
