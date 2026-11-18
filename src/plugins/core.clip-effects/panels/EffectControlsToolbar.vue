<script setup lang="ts">
/**
 * 效果面板工具栏（06-01 §三）：搜索、只看轴外、适配、折叠、刷新。
 *
 * 只有"怎么找"，没有"添加什么"——这里不存在任何新建属性 / 效果 / 组的入口。
 * 不可用的动作必须 `disabled`，不静默失效。
 */
defineProps<{
  search: string
  onlyOutOfRange: boolean
  canFitAllNodes: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'toggle-only-out-of-range': []
  'fit-clip': []
  'fit-all-nodes': []
  'collapse-all': []
  refresh: []
}>()
</script>

<template>
  <div class="fx-bar" role="toolbar" aria-label="效果面板工具栏">
    <input
      class="fx-bar__search"
      type="search"
      :value="search"
      placeholder="搜索属性 / 组"
      aria-label="搜索属性或组"
      @input="emit('update:search', ($event.target as HTMLInputElement).value)"
    />

    <label class="fx-bar__check">
      <input
        type="checkbox"
        :checked="onlyOutOfRange"
        @change="emit('toggle-only-out-of-range')"
      />
      <span>只看轴外</span>
    </label>

    <button type="button" class="fx-bar__button" @click="emit('fit-clip')">适配片段</button>
    <button
      type="button"
      class="fx-bar__button"
      :disabled="!canFitAllNodes"
      @click="emit('fit-all-nodes')"
    >适配全部节点</button>
    <button type="button" class="fx-bar__button" @click="emit('collapse-all')">折叠全部</button>
    <button type="button" class="fx-bar__button" @click="emit('refresh')">刷新</button>
  </div>
</template>

<style scoped>
.fx-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.fx-bar__search {
  flex: 1 1 120px;
  min-width: 80px;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.fx-bar__search:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.fx-bar__check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.fx-bar__button {
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.fx-bar__button:hover:enabled {
  background: var(--bg-hover);
}

.fx-bar__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.fx-bar__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
