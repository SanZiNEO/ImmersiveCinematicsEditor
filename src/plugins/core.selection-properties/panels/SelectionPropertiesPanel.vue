<script setup lang="ts">
/**
 * `selection.properties`（05-13）：编辑器页右栏。
 *
 * 顶部两个 tab：片段属性（主选区四态 / 片段引用）与触发器（字段、条件、前置）。
 * 所有数据来自 `DOCUMENT_SERVICE.view()` / `SELECTION_SERVICE`；前置写入走
 * `SCRIPT_MUTATION_SERVICE.mutateRequires`，与脚本页共用同一条命令。
 */
import { computed, ref } from 'vue'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import ClipSelectionPane from './ClipSelectionPane.vue'
import TriggerPane from './TriggerPane.vue'
import { usePanelRevision } from '../usePanelRevision.ts'

type TabId = 'clip' | 'trigger'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const activeTab = ref<TabId>('clip')

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

function selectTab(tab: TabId): void {
  activeTab.value = tab
}
</script>

<template>
  <section class="selection-panel" aria-label="片段属性与触发器">
    <div class="selection-tabs" role="tablist" aria-label="属性面板">
      <button
        id="selection-tab-clip"
        type="button"
        role="tab"
        class="selection-tabs__tab"
        :class="{ 'selection-tabs__tab--active': activeTab === 'clip' }"
        :aria-selected="activeTab === 'clip'"
        aria-controls="selection-panel-clip"
        @click="selectTab('clip')"
      >
        片段属性
      </button>
      <button
        id="selection-tab-trigger"
        type="button"
        role="tab"
        class="selection-tabs__tab"
        :class="{ 'selection-tabs__tab--active': activeTab === 'trigger' }"
        :aria-selected="activeTab === 'trigger'"
        aria-controls="selection-panel-trigger"
        @click="selectTab('trigger')"
      >
        触发器
      </button>
    </div>

    <p v-if="documentService === undefined" class="selection-empty" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>
    <p v-else-if="view === null" class="selection-empty">
      没有打开的文档。从脚本页打开一个脚本后，这里显示片段属性与触发器。
    </p>

    <div
      v-else
      id="selection-panel-clip"
      class="selection-body"
      role="tabpanel"
      aria-labelledby="selection-tab-clip"
      :hidden="activeTab !== 'clip'"
    >
      <ClipSelectionPane v-if="activeTab === 'clip'" />
    </div>
    <div
      v-if="view !== null"
      id="selection-panel-trigger"
      class="selection-body"
      role="tabpanel"
      aria-labelledby="selection-tab-trigger"
      :hidden="activeTab !== 'trigger'"
    >
      <TriggerPane v-if="activeTab === 'trigger'" :view="view" />
    </div>
  </section>
</template>

<style scoped>
.selection-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.selection-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--border);
}

.selection-tabs__tab {
  padding: 5px 10px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.selection-tabs__tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.selection-tabs__tab:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.selection-tabs__tab--active {
  border-color: var(--border);
  background: var(--bg-raised);
  color: var(--text);
}

.selection-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.selection-empty {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}
</style>
