<script setup lang="ts">
/**
 * `selection.properties`（检查器改版）：同一个右栏面板按选择域分流。
 *
 * | 选区 | 内容 |
 * |---|---|
 * | 空 / 打开脚本 / 关档 | 脚本参数（`ScriptPropertiesPanel`） |
 * | `domain: 'track'` | 轨道参数（`TrackPropertiesPanel`） |
 * | 片段 / 对象 / 关键帧 / 多选 / 失效 / 外部域 | `ClipPropertiesPanel`（四态由它负责） |
 *
 * 不做内部页签；脚本 / 轨道 / 片段各自有明确标题。选择驱动的标签切换仍由
 * `SelectionPanelSync` 负责，这里只对同一个面板内的内容分流。
 */
import { computed } from 'vue'
import { SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import ClipPropertiesPanel from './ClipPropertiesPanel.vue'
import ScriptPropertiesPanel from './ScriptPropertiesPanel.vue'
import TrackPropertiesPanel from './TrackPropertiesPanel.vue'

type InspectorRoute = 'script' | 'track' | 'clip'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const selectionService = ctx.services.get(SELECTION_SERVICE)

/**
 * 按**选择域**分流，不依赖片段面板的内部 `kind`：
 * 空选区默认脚本参数；只有失效 / 多选 / 外部域等片段相关状态才交给 `ClipPropertiesPanel`。
 */
const route = computed<InspectorRoute>(() => {
  void revision.value
  const selection = ctx.selection
  if (selection.domain === 'track') {
    return 'track'
  }
  if (selection.domain === 'none') {
    const state = selectionService?.state()
    return state !== undefined && state.kind !== 'none' ? 'clip' : 'script'
  }
  return 'clip'
})
</script>

<template>
  <section class="selection-panel" aria-label="检查器">
    <ScriptPropertiesPanel v-if="route === 'script'" />
    <TrackPropertiesPanel v-else-if="route === 'track'" />
    <ClipPropertiesPanel v-else />
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
}
</style>