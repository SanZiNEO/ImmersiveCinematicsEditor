<script setup lang="ts">
/**
 * 缺失面板占位（04-05）。
 *
 * 插件未安装 / 已禁用时保留布局节点，但给用户两个可键盘操作的出口：
 * 移除该面板、重置布局。
 */
import { computed, inject } from 'vue'
import { I18N_SERVICE } from '../api/tokens.ts'
import type { I18nApi } from '../api/context.ts'
import type { PanelRef } from '../api/ids.ts'
import { PANEL_ACTIONS_KEY, WORKBENCH_SERVICES_KEY } from './panelContext.ts'

const props = defineProps<{
  pluginId: string
  panelId: string
  pageId: string
  message?: string
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const i18n: I18nApi | undefined = services?.get(I18N_SERVICE)
const actions = inject(PANEL_ACTIONS_KEY, null)

const label = computed(() => i18n?.t('panel.missing') ?? '插件未安装或已禁用')
const targetRef = computed<PanelRef>(() => ({ pluginId: props.pluginId, panelId: props.panelId }))
const removable = computed(() => props.pluginId.length > 0)

function removePanel(): void {
  if (actions === null || !removable.value) {
    return
  }
  actions.removePanel({ pluginId: props.pluginId, panelId: props.panelId })
}

function resetLayout(): void {
  actions?.resetLayout()
}
</script>

<template>
  <div class="missing-panel" role="alert">
    <p class="missing-panel__title">{{ message ?? label }}</p>
    <p class="missing-panel__ref">{{ targetRef.pluginId }}:{{ targetRef.panelId }}</p>
    <div class="missing-panel__actions">
      <button
        type="button"
        class="missing-panel__button"
        :disabled="actions === null || !removable"
        @click="removePanel"
      >
        移除该面板
      </button>
      <button
        type="button"
        class="missing-panel__button"
        :disabled="actions === null"
        @click="resetLayout"
      >
        重置布局
      </button>
    </div>
  </div>
</template>

<style scoped>
.missing-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  background: var(--bg-panel);
  color: var(--text-secondary);
}

.missing-panel__title {
  margin: 0;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.missing-panel__ref {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
}

.missing-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.missing-panel__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.missing-panel__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.missing-panel__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.missing-panel__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}
</style>
