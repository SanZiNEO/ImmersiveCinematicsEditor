<script setup lang="ts">
/**
 * 触发器面板（06-12：从 `selection.properties` 迁出的独立面板）。
 *
 * 面板只做装配：数据来自 `DOCUMENT_SERVICE.view()`，字段写入走 `PanelContext.commands`
 * 与 `SCRIPT_MUTATION_SERVICE`。四态与非片段域都给出真实说明，不伪造片段数据。
 */
import { computed } from 'vue'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import { DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import TriggerPane from './TriggerPane.vue'
import { usePanelRevision } from '../usePanelRevision.ts'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})
</script>

<template>
  <section class="behavior-panel" aria-label="触发器">
    <header class="behavior-panel__header">
      <h2 class="behavior-panel__title">触发器</h2>
      <span class="behavior-panel__hint">脚本级声明 · 条件树 · 前置</span>
    </header>

    <p v-if="documentService === undefined" class="behavior-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>

    <p v-else-if="view === null" class="behavior-panel__empty">
      没有打开的文档。从脚本页打开一个脚本后，这里显示它的触发器。
    </p>

    <p v-else-if="state.kind === 'invalid'" class="behavior-panel__notice" role="alert">
      <strong>选区失效。</strong>
      <span>{{ state.reason }}</span>
    </p>

    <p v-else-if="view.triggers.length === 0" class="behavior-panel__empty">
      该脚本没有触发器。触发器属于脚本本身，不属于片段。
    </p>

    <TriggerPane v-else :view="view" />
  </section>
</template>

<style scoped>
.behavior-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px;
  overflow: auto;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.behavior-panel__header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.behavior-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.behavior-panel__hint {
  color: var(--text-muted);
  font-size: 11px;
}

.behavior-panel__empty,
.behavior-panel__notice {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.behavior-panel__notice {
  border-color: var(--error);
  background: var(--bg-raised);
}

.behavior-panel__notice strong {
  color: var(--error);
  margin-right: 6px;
}
</style>
