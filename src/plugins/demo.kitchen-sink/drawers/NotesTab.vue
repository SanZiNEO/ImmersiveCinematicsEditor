<script setup lang="ts">
/**
 * `demo.drawer.notes`（04-06）。
 *
 * keepAlive 抽屉标签：筛选输入与滚动位置在隐藏/再显示后保留。
 * 内容是 demo 文本，不是脚本字段；只验证容器行为。
 */
import { computed, ref } from 'vue'

const NOTES: readonly string[] = Array.from(
  { length: 120 },
  (_, index) => `备注 ${String(index + 1).padStart(3, '0')}：demo 抽屉的滚动与筛选状态验证`,
)

const filter = ref('')
const filtered = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (needle.length === 0) {
    return NOTES
  }
  return NOTES.filter((note) => note.toLowerCase().includes(needle))
})
</script>

<template>
  <section class="demo-notes" aria-label="Demo 备注抽屉">
    <header class="demo-notes__header">
      <span class="demo-badge">demo</span>
      <label class="demo-notes__filter">
        <span>筛选</span>
        <input v-model="filter" type="search" placeholder="输入关键词过滤备注" />
      </label>
      <span class="demo-notes__count" role="status" aria-live="polite">
        {{ filtered.length }} / {{ NOTES.length }}
      </span>
    </header>
    <p class="demo-notes__hint">keepAlive：切到别的 tab 再回来，筛选词与滚动位置应保留。</p>
    <div class="demo-notes__list" tabindex="0" role="list" aria-label="Demo 备注列表">
      <p v-for="note in filtered" :key="note" class="demo-notes__item" role="listitem">{{ note }}</p>
      <p v-if="filtered.length === 0" class="demo-notes__empty">没有匹配的备注。</p>
    </div>
  </section>
</template>

<style scoped>
.demo-notes {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 8px 12px;
  color: var(--text);
  font-size: 12px;
}

.demo-notes__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.demo-badge {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-notes__filter {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.demo-notes__filter input {
  min-width: 220px;
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
}

.demo-notes__filter input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.demo-notes__count {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.demo-notes__hint {
  margin: 0;
  color: var(--text-muted);
}

.demo-notes__list {
  flex: 1 1 auto;
  min-height: 0;
  padding: 4px 8px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

.demo-notes__list:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.demo-notes__item {
  margin: 0;
  padding: 2px 0;
  color: var(--text-secondary);
  white-space: nowrap;
}

.demo-notes__empty {
  margin: 4px 0;
  color: var(--text-muted);
}
</style>
