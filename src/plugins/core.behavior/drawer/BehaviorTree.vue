<script setup lang="ts">
/**
 * 行为树左栏（11-01 §三）。
 *
 * 固定顺序：触发器 → 规则（每条下挂全部绑定，未绑定规则仍显示）→ 事件（EVENT / MOD_EVENT
 * 分组，组内按片段）。触发器行只做摘要 + 编辑弹窗入口，不出现字段编辑器。
 * 筛选只 dim 不自动选中；展开状态只进会话态。
 */
import { computed } from 'vue'
import type { RecordRef } from '../../../features/behavior/shared.ts'
import { sameRecordRef, recordRefKey, highestSeverity } from '../../../features/behavior/shared.ts'
import { describeEventRecord } from '../../../features/behavior/events.ts'
import type { BehaviorModel, RuleRow, BindingRow, TriggerRow, EventGroup } from './drawerModel.ts'
import { rowMatchesText } from './drawerModel.ts'

const props = defineProps<{
  model: BehaviorModel
  selected: RecordRef | null
  filter: string
  /** 仅 dim 不匹配项；不自动选中。 */
  onlyMatch: boolean
  expanded: ReadonlySet<string>
}>()

const emit = defineEmits<{
  select: [ref: RecordRef]
  jumpTrigger: [identity: string]
  toggle: [key: string]
}>()

const GROUPS = {
  trigger: 'group:trigger',
  rule: 'group:rule',
  event: 'group:event',
} as const

function isOpen(key: string): boolean {
  return props.expanded.has(key)
}

function toggleGroup(key: string): void {
  emit('toggle', key)
}

function triggerMatch(row: TriggerRow): boolean {
  return rowMatchesText(row.summary, row.identity, props.filter)
}

function ruleMatch(row: RuleRow): boolean {
  const self = rowMatchesText(row.summary, row.id, props.filter)
  const childMatch = row.bindings.some((binding) => rowMatchesText(binding.summary, binding.ref.id, props.filter))
  return self || childMatch
}

function bindingMatch(row: BindingRow): boolean {
  return rowMatchesText(row.summary, row.ref.id, props.filter)
}

function eventGroupMatch(group: EventGroup): boolean {
  return group.entries.some((entry) =>
    rowMatchesText(describeEventRecord(entry), recordRefKey(entry.ref), props.filter),
  )
}

function eventSummary(entry: Parameters<typeof describeEventRecord>[0]): string {
  return describeEventRecord(entry)
}

function severityClass(row: { severity: import('../../../core/doc/types.ts').Severity | null }): string {
  if (row.severity === null) return 'severity--none'
  return `severity--${row.severity === 'block' ? 'error' : row.severity}`
}

function selectedClass(ref: RecordRef): string {
  return props.selected !== null && sameRecordRef(props.selected, ref) ? 'tree-row--selected' : ''
}

const dimmed = computed(() => props.onlyMatch && props.filter.trim().length > 0)
</script>

<template>
  <div class="behavior-tree" :class="{ 'behavior-tree--dim-filter': dimmed }">
    <!-- 触发器 -->
    <div class="tree-group">
      <button type="button" class="tree-group__head" @click="toggleGroup(GROUPS.trigger)">
        <span>{{ isOpen(GROUPS.trigger) ? '▾' : '▸' }}</span>
        <span>触发器</span>
        <span class="tree-group__count">{{ model.triggers.length }}</span>
      </button>
      <div v-if="isOpen(GROUPS.trigger)" class="tree-group__body">
        <p v-if="model.triggers.length === 0" class="tree-empty">脚本只能被命令或其他脚本启动。</p>
        <div
          v-for="row in model.triggers"
          :key="row.identity"
          class="tree-row"
          :class="[selectedClass(row.ref), severityClass(row), { 'tree-row--dim': dimmed && !triggerMatch(row) }]"
        >
          <button type="button" class="tree-row__main" @click="emit('select', row.ref)">
            <span class="tree-row__summary">{{ row.summary }}</span>
          </button>
          <span class="tree-row__severity" :class="severityClass(row)">{{ row.severity ?? '—' }}</span>
          <button type="button" class="tree-row__jump" @click="emit('jumpTrigger', row.identity)">
            编辑
          </button>
        </div>
      </div>
    </div>

    <!-- 规则 -->
    <div class="tree-group">
      <button type="button" class="tree-group__head" @click="toggleGroup(GROUPS.rule)">
        <span>{{ isOpen(GROUPS.rule) ? '▾' : '▸' }}</span>
        <span>规则</span>
        <span class="tree-group__count">{{ model.rules.length }}</span>
      </button>
      <div v-if="isOpen(GROUPS.rule)" class="tree-group__body">
        <p v-if="model.rules.length === 0" class="tree-empty">播放期间没有条件行为。</p>
        <div
          v-for="rule in model.rules"
          :key="rule.id"
          class="tree-row"
          :class="[selectedClass(rule.ref), severityClass(rule), { 'tree-row--dim': dimmed && !ruleMatch(rule) }]"
        >
          <button type="button" class="tree-row__main" @click="emit('select', rule.ref)">
            <span class="tree-row__summary">{{ rule.summary }}</span>
            <span v-if="rule.bindingCount === 0" class="tree-row__unbound">未绑定</span>
          </button>
          <span class="tree-row__severity" :class="severityClass(rule)">{{ rule.severity ?? '—' }}</span>
        </div>
        <div v-for="rule in model.rules" :key="`bindings-${rule.id}`" class="tree-children">
          <div
            v-for="binding in rule.bindings"
            :key="binding.ref.id"
            class="tree-row tree-row--child"
            :class="[selectedClass(binding.ref), severityClass(binding), { 'tree-row--dim': dimmed && !bindingMatch(binding) }]"
          >
            <button type="button" class="tree-row__main" @click="emit('select', binding.ref)">
              <span class="tree-row__summary">{{ binding.summary }}</span>
            </button>
            <span class="tree-row__severity" :class="severityClass(binding)">{{ binding.severity ?? '—' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 事件 -->
    <div class="tree-group">
      <button type="button" class="tree-group__head" @click="toggleGroup(GROUPS.event)">
        <span>{{ isOpen(GROUPS.event) ? '▾' : '▸' }}</span>
        <span>事件</span>
        <span class="tree-group__count">{{ model.events.length }}</span>
      </button>
      <div v-if="isOpen(GROUPS.event)" class="tree-group__body">
        <p v-if="model.events.length === 0" class="tree-empty">片段时间点不发送事件。</p>
        <div v-for="group in model.eventGroups" :key="`${group.trackType}:${group.clipKey}`" class="tree-subgroup">
          <p class="tree-subgroup__head">{{ group.trackType }} · {{ group.clipKey }}</p>
          <div
            v-for="entry in group.entries"
            :key="recordRefKey(entry.ref)"
            class="tree-row tree-row--child"
            :class="[selectedClass(entry.ref), { 'tree-row--dim': dimmed && !eventGroupMatch(group) }]"
          >
            <button type="button" class="tree-row__main" @click="emit('select', entry.ref)">
              <span class="tree-row__summary">{{ eventSummary(entry) }}</span>
            </button>
            <span class="tree-row__severity">{{ highestSeverity(entry.problems) ?? '—' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.behavior-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  font-size: 11px;
  overflow-y: auto;
}

.tree-group__head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  font: inherit;
  font-weight: 600;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
}

.tree-group__count {
  margin-left: auto;
  color: var(--text-muted);
}

.tree-group__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tree-empty {
  margin: 0;
  padding: 4px 6px;
  color: var(--text-muted);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
}

.tree-row--child {
  margin-left: 14px;
}

.tree-row--selected {
  background: var(--bg-hover, var(--bg-raised));
  outline: 1px solid var(--focus, #4a90d9);
}

.tree-row--dim {
  opacity: 0.4;
}

.tree-row__main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font: inherit;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.tree-row__summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-row__unbound {
  color: var(--text-muted);
  font-size: 10px;
}

.tree-row__severity {
  font-size: 10px;
  color: var(--text-muted);
}

.tree-row__jump {
  font: inherit;
  font-size: 10px;
  padding: 2px 6px;
}

.tree-children {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tree-subgroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tree-subgroup__head {
  margin: 2px 0 0;
  padding-left: 14px;
  font-size: 10px;
  color: var(--text-muted);
}

.severity--error {
  color: var(--danger, #c0392b);
}

.severity--warn {
  color: var(--warning, #b8860b);
}

.severity--info {
  color: var(--text-secondary);
}

.severity--none {
  color: var(--text-muted);
}
</style>
