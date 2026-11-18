<script setup lang="ts">
/**
 * 诊断条目列表（11-15 呈现口径）：按级别排序，折叠 `block → error`；
 * 每条显示合同码、级别、文案与 JSON 路径。只读，不自动改写文档。
 */
import { computed } from 'vue'
import type { BehaviorProblem } from '../../../../features/behavior/shared.ts'

const props = defineProps<{
  problems: readonly BehaviorProblem[]
  /** 空态文案；省略时空列表不渲染。 */
  emptyText?: string
}>()

const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, error: 2, block: 3 }

const ordered = computed(() =>
  [...props.problems].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]),
)

function folded(severity: string): string {
  return severity === 'block' ? 'error' : severity
}
</script>

<template>
  <div v-if="ordered.length > 0" class="problem-list">
    <div v-for="(problem, index) in ordered" :key="`${problem.jsonPath}:${index}`" class="problem-item" :class="`problem-item--${folded(problem.severity)}`">
      <span class="problem-item__code">{{ problem.code }}</span>
      <span class="problem-item__severity">{{ folded(problem.severity) }}</span>
      <span class="problem-item__message">{{ problem.message }}</span>
      <span v-if="problem.jsonPath" class="problem-item__path">{{ problem.jsonPath }}</span>
    </div>
  </div>
  <p v-else-if="emptyText !== undefined" class="problem-empty">{{ emptyText }}</p>
</template>

<style scoped>
.problem-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.problem-item {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 6px;
  align-items: baseline;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  font-size: 11px;
}

.problem-item--error {
  border-color: var(--danger, #c0392b);
}

.problem-item--warn {
  border-color: var(--warning, #b8860b);
}

.problem-item__code {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
}

.problem-item__severity {
  text-transform: uppercase;
  color: var(--text-secondary);
}

.problem-item__message {
  overflow-wrap: anywhere;
}

.problem-item__path {
  grid-column: 1 / -1;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-muted);
}

.problem-empty {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
