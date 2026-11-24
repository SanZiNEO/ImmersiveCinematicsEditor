<script setup lang="ts">
/** 独立、只读的当前内存偏好 JSON 查看器。 */
import { computed, onScopeDispose, ref } from 'vue'

import { useI18n, usePreferences } from './useWorkbench.ts'
import WorkbenchDialog from './WorkbenchDialog.vue'

const emit = defineEmits<{ close: [] }>()
const i18n = useI18n()
const preferences = usePreferences()
const tick = ref(0)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

const unsubscribe = preferences.subscribe(() => {
  tick.value += 1
  copyState.value = 'idle'
})
onScopeDispose(unsubscribe)

const text = computed(() => {
  void tick.value
  return JSON.stringify(preferences.get(), null, 2)
})

const copyMessage = computed(() => {
  if (copyState.value === 'copied') {
    return i18n.t('preferencesJson.copied')
  }
  if (copyState.value === 'failed') {
    return i18n.t('preferencesJson.copyFailed')
  }
  return ''
})

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}
</script>

<template>
  <WorkbenchDialog
    :title="i18n.t('preferencesJson.title')"
    :subtitle="i18n.t('preferencesJson.subtitle')"
    dialog-id="preferences-json-dialog"
    width="920px"
    @close="emit('close')"
  >
    <div class="preferences-json">
      <div class="preferences-json__bar">
        <p id="preferences-json-hint" class="preferences-json__hint">
          {{ i18n.t('preferencesJson.snapshotHint') }}
        </p>
        <button type="button" class="preferences-json__copy" @click="copy">
          {{ i18n.t('preferencesJson.copy') }}
        </button>
      </div>
      <pre
        v-text="text"
        class="preferences-json__code"
        tabindex="0"
        autofocus
        role="region"
        :aria-label="i18n.t('preferencesJson.contentLabel')"
        aria-describedby="preferences-json-hint"
      ></pre>
      <p class="sr-only" role="status">{{ copyMessage }}</p>
    </div>
  </WorkbenchDialog>
</template>

<style scoped>
.preferences-json {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preferences-json__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preferences-json__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.preferences-json__copy {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.preferences-json__copy:focus-visible,
.preferences-json__code:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.preferences-json__code {
  height: clamp(220px, 62vh, 600px);
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font: 11px/1.45 var(--font-mono, ui-monospace, monospace);
  white-space: pre;
  tab-size: 2;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
</style>
