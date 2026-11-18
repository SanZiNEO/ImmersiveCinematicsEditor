<script setup lang="ts">
/**
 * 07-05 路径集合列表（纯展示 + 事件转发）。
 *
 * 行数据、筛选、重叠 / 问题徽标判定都在 `features/paths/collectionPanel.ts`；
 * 本组件只渲染，选中 / 重命名 / 复制 / 删除 / 定位由父面板接 commit 与选择服务。
 */
import type { PathFilterState, PathRowView } from '../../../features/paths/collectionPanel.ts'

const props = defineProps<{
  rows: readonly PathRowView[]
  filter: PathFilterState
  /** 片段筛选下拉选项（clipId 与列表行 clipId 对齐）。 */
  clipOptions: ReadonlyArray<{ clipId: string; label: string }>
  selectedPathId: string | null
  /** 新建按钮禁用原因；空字符串 = 可新建。 */
  newDisabledReason?: string
}>()

const emit = defineEmits<{
  new: []
  'update:clip-filter': [clipId: string | null]
  'update:search': [value: string]
  'toggle-only-issues': []
  select: [pathId: string]
  rename: [pathId: string]
  duplicate: [pathId: string]
  remove: [pathId: string]
  'locate-clip': [pathId: string]
  'locate-endpoint': [pathId: string, which: 'from' | 'to']
}>()

function onSearchInput(event: Event): void {
  emit('update:search', (event.target as HTMLInputElement).value)
}

function onClipFilter(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit('update:clip-filter', value === '' ? null : value)
}

function timingLabel(kind: PathRowView['timingKind']): string {
  return kind === 'keyframes' ? '关键帧' : '线性'
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
</script>

<template>
  <div class="paths-list">
    <div class="paths-list__toolbar" role="toolbar" aria-label="路径集合工具栏">
      <button
        type="button"
        class="paths-list__button"
        :disabled="props.newDisabledReason !== undefined && props.newDisabledReason !== ''"
        :title="props.newDisabledReason ?? '新建路径'"
        @click="emit('new')"
      >
        新建路径
      </button>
      <select
        class="paths-list__select"
        :value="props.filter.clipId ?? ''"
        aria-label="按片段筛选"
        @change="onClipFilter"
      >
        <option value="">全部片段</option>
        <option v-for="option in props.clipOptions" :key="option.clipId" :value="option.clipId">
          {{ option.label }}
        </option>
      </select>
      <input
        class="paths-list__search"
        type="search"
        :value="props.filter.search"
        placeholder="搜索 id"
        aria-label="按 id 搜索路径"
        @input="onSearchInput"
      />
      <button
        type="button"
        class="paths-list__button"
        :class="{ 'paths-list__button--active': props.filter.onlyIssues }"
        :aria-pressed="props.filter.onlyIssues"
        @click="emit('toggle-only-issues')"
      >
        只看有问题
      </button>
    </div>

    <div class="paths-list__rows" role="list">
      <div v-if="props.rows.length === 0" class="paths-list__empty">
        当前筛选下没有路径
      </div>
      <div
        v-for="row in props.rows"
        :key="row.id"
        class="paths-row"
        :class="{
          'paths-row--selected': row.id === props.selectedPathId,
          'paths-row--blocked': row.issueCount > 0,
        }"
        role="listitem"
        tabindex="0"
        @click="emit('select', row.id)"
        @keydown.enter="emit('select', row.id)"
      >
        <div class="paths-row__head">
          <span class="paths-row__id" :title="row.id">{{ row.id }}</span>
          <span class="paths-row__clip" :title="`片段 ${row.clipId}`">{{ row.clipId }}</span>
          <span class="paths-row__range">
            {{ formatTime(row.from) }} → {{ formatTime(row.to) }}
          </span>
          <span v-if="row.issueCount > 0" class="paths-row__issues" :title="row.issues.map((i) => i.message).join('\n')">
            {{ row.issueCount }} 问题
          </span>
          <span v-if="row.duplicatePair" class="paths-row__badge paths-row__badge--warn" title="同片段同端点对重复">
            重复端点对
          </span>
          <span
            v-for="overlap in row.overlaps"
            :key="overlap.otherId"
            class="paths-row__badge"
            :title="overlap.message"
          >
            与 {{ overlap.otherId }} 重叠
          </span>
        </div>
        <div class="paths-row__meta">
          <span class="paths-row__axes">axes: {{ row.axes.join(' / ') || '—' }}</span>
          <span class="paths-row__geometry">几何: {{ row.geometryType || '—' }}</span>
          <span class="paths-row__timing">时间: {{ timingLabel(row.timingKind) }}</span>
        </div>
        <div class="paths-row__actions" @click.stop>
          <button type="button" class="paths-row__action" @click="emit('rename', row.id)">重命名</button>
          <button type="button" class="paths-row__action" @click="emit('duplicate', row.id)">复制</button>
          <button type="button" class="paths-row__action paths-row__action--danger" @click="emit('remove', row.id)">删除</button>
          <button type="button" class="paths-row__action" @click="emit('locate-clip', row.id)">定位片段</button>
          <button type="button" class="paths-row__action" @click="emit('locate-endpoint', row.id, 'from')">定位起点</button>
          <button type="button" class="paths-row__action" @click="emit('locate-endpoint', row.id, 'to')">定位终点</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paths-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.paths-list__toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.paths-list__search,
.paths-list__select {
  flex: 1 1 80px;
  min-width: 60px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.paths-list__button {
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.paths-list__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.paths-list__button--active {
  border-color: var(--accent);
  color: var(--accent);
}

.paths-list__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.paths-list__rows {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
}

.paths-list__empty {
  padding: 12px 10px;
  color: var(--text-muted);
  font-size: 11px;
}

.paths-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 10px 5px;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  cursor: pointer;
  outline: none;
}

.paths-row:hover {
  background: var(--bg-hover);
}

.paths-row--selected {
  background: var(--bg-hover);
  border-left-color: var(--selection-outline);
}

.paths-row--blocked {
  border-left-color: var(--error);
}

.paths-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.paths-row__id {
  color: var(--text);
  font-weight: 500;
  font-family: var(--font-mono);
  font-size: 12px;
}

.paths-row__clip,
.paths-row__range {
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-mono);
}

.paths-row__issues {
  margin-left: auto;
  padding: 0 4px;
  border: 1px solid var(--error);
  border-radius: 3px;
  color: var(--error);
  font-size: 11px;
  white-space: nowrap;
}

.paths-row__badge {
  padding: 0 4px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 11px;
  white-space: nowrap;
}

.paths-row__badge--warn {
  border-color: var(--error);
  color: var(--error);
}

.paths-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.paths-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.paths-row__action {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.paths-row__action:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.paths-row__action--danger {
  color: var(--error);
}

.paths-row__action--danger:hover {
  background: var(--error-bg);
}
</style>
