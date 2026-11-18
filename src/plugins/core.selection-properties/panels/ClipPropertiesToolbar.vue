<script setup lang="ts">
/**
 * 属性面板工具栏（06-09 §三）：搜索、只看未设置、折叠全部、清除。
 *
 * 过滤只改显示：不改行集合、不删对象、不影响效果面板。
 */
const props = defineProps<{
  search: string
  onlyUnset: boolean
  /** 折叠的组数（用于"展开全部"的按钮语义）。 */
  collapsedCount: number
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'toggle-only-unset': []
  'collapse-all': []
  clear: []
}>()

function onSearchInput(event: Event): void {
  emit('update:search', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="props-toolbar" role="toolbar" aria-label="属性工具栏">
    <input
      class="props-toolbar__search"
      type="search"
      :value="props.search"
      placeholder="搜索路径 / 标签 / 组名"
      aria-label="搜索属性"
      @input="onSearchInput"
    />
    <button
      type="button"
      class="props-toolbar__button"
      :class="{ 'props-toolbar__button--active': props.onlyUnset }"
      :aria-pressed="props.onlyUnset"
      @click="emit('toggle-only-unset')"
    >
      只看未设置
    </button>
    <button
      type="button"
      class="props-toolbar__button"
      :disabled="props.collapsedCount === 0"
      @click="emit('collapse-all')"
    >
      折叠全部
    </button>
    <button
      type="button"
      class="props-toolbar__button"
      :disabled="props.search === '' && !props.onlyUnset && props.collapsedCount === 0"
      @click="emit('clear')"
    >
      清除
    </button>
  </div>
</template>

<style scoped>
.props-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.props-toolbar__search {
  flex: 1 1 120px;
  min-width: 80px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.props-toolbar__search:focus-visible,
.props-toolbar__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.props-toolbar__button {
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.props-toolbar__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.props-toolbar__button--active {
  border-color: var(--accent);
  color: var(--accent);
}

.props-toolbar__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
