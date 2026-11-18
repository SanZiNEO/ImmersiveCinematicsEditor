<script setup lang="ts">
/**
 * 诊断区（11-02 / 11-03 / 11-04 / 11-05）：聚合本触发器的全部问题，每条带 jsonPath 可定位。
 * 只读展示；问题口径全部来自 features 层校验，面板不另造判断。
 */
import type { PanelTrigger } from './triggerPanelModel.ts'

defineProps<{ row: PanelTrigger | null }>()

const SEVERITY_LABEL: Record<string, string> = {
  block: '阻塞',
  error: '错误',
  warn: '警告',
  info: '提示',
}
</script>

<template>
  <section class="diagnostics" aria-label="诊断">
    <h3 class="section-title">诊断</h3>
    <p v-if="row === null" class="diagnostics__empty">未选择触发器</p>
    <p v-else-if="row.problems.length === 0" class="diagnostics__ok">未发现问题</p>
    <ul v-else class="diagnostics__list">
      <li v-for="(problem, index) in row.problems" :key="index" class="diagnostics__item">
        <span class="diagnostics__severity" :data-severity="problem.severity">
          {{ SEVERITY_LABEL[problem.severity] ?? problem.severity }}
        </span>
        <span class="diagnostics__message">{{ problem.message }}</span>
        <code v-if="problem.jsonPath" class="diagnostics__path">{{ problem.jsonPath }}</code>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.diagnostics {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.diagnostics__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.diagnostics__item {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
}

.diagnostics__severity[data-severity='error'],
.diagnostics__severity[data-severity='block'] {
  color: var(--error, #e05555);
}

.diagnostics__severity[data-severity='warn'] {
  color: var(--warning, #e0a555);
}

.diagnostics__severity[data-severity='info'] {
  color: var(--accent, #4a90d9);
}

.diagnostics__message {
  color: var(--text, #eee);
}

.diagnostics__path {
  font-size: 10px;
  color: var(--text-muted, #999);
}

.diagnostics__empty,
.diagnostics__ok {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #999);
}
</style>
