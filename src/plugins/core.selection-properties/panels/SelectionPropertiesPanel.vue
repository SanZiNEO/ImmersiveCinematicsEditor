<script setup lang="ts">
/**
 * `selection.properties`（06-09）：编辑器页右栏的**属性面板**。
 *
 * 只保留片段属性：触发器已迁到独立插件 `core.behavior`（`behavior.triggers`）。
 * 面板标题是"属性"；内容全部委托 `ClipPropertiesPanel`（四态、全部适用叶子、时钟、
 * 诊断条、事件记录入口都在那里）。这里不引入任何关键帧轴、节点几何或局部标尺。
 */
import ClipPropertiesPanel from './ClipPropertiesPanel.vue'
</script>

<template>
  <section class="selection-panel" aria-label="属性">
    <header class="selection-panel__header">
      <h1 class="selection-panel__title">属性</h1>
      <span class="selection-panel__hint">片段全部适用属性 · 静态值与时钟</span>
    </header>
    <ClipPropertiesPanel />
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

.selection-panel__header {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px 4px;
  border-bottom: 1px solid var(--border);
}

.selection-panel__title {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.selection-panel__hint {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
