<script setup lang="ts">
/**
 * 右侧 Inspector 属性组（设计稿「按任务组织片段字段」）。
 *
 * 组头只保留标题与折叠；不再显示「已设置 / 总数」、效果面板计数或虚拟化占位。
 * 组内每行全宽排列；X/Y/Z 各自保留为独立行及独立关键帧状态。
 *
 * 小组只来自 schema 的 section/group 归类（或字段面显示分组）；本组件不创建组、
 * 不添加属性。组合入口在展开后的底部，仅当父级显式给出 `authoringGroupName`
 * （`null` 表示可新建）时出现。
 */
import { computed, useSlots } from 'vue'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { EffectDiagnostic, EffectGroup, PropertyRow } from '../../../features/effects/types.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import ClipPropertyRow from './ClipPropertyRow.vue'

const props = defineProps<{
  group: EffectGroup
  timing: ClipTiming
  playhead: number
  objects: JsonObject
  collapsed: boolean
  /** 行诊断：`path → 诊断列表`（已按级别排序）。 */
  diagnostics: ReadonlyMap<string, readonly EffectDiagnostic[]>
  focusedPath: string | null
  /** 事件行摘要（路径 → 摘要列表）。 */
  eventSummaries?: ReadonlyMap<string, readonly string[]>
  /** 该组命中的组合定义显示名；`null` = 没有匹配（弹层可新建）。未提供则不显示入口。 */
  authoringGroupName?: string | null
  /** 路径 → 右栏值控件选项。 */
  optionsByPath?: ReadonlyMap<string, InspectorValueOptions>
}>()

const emit = defineEmits<{
  'open-group-popover': [groupKey: string]
  'toggle-collapse': [groupKey: string]
  'open-event-editor': [{ clipKey: string; path: string; time: number }]
  'reveal-effects': [{ clipKey: string; path: string }]
  'focus-row': [{ path: string }]
  'toggle-keyframe': [{ clipKey: string; path: string; time: number; create: boolean }]
  'jump-keyframe': [{ clipKey: string; path: string; time: number }]
}>()

const slots = useSlots()
const hasBodySlot = computed(() => slots.default !== undefined)

const rows = computed<PropertyRow[]>(() => props.group.rows)

function rowDiagnostics(path: string): readonly EffectDiagnostic[] {
  return props.diagnostics.get(path) ?? []
}

function rowOptions(path: string): InspectorValueOptions | undefined {
  return props.optionsByPath?.get(path)
}

function rowSummaries(path: string): readonly string[] | undefined {
  return props.eventSummaries?.get(path)
}

function toggle(): void {
  emit('toggle-collapse', props.group.key)
}
</script>

<template>
  <section class="prop-group" :data-group="group.key">
    <header class="prop-group__header" :class="{ 'prop-group__header--open': !collapsed }">
      <button
        type="button"
        class="prop-group__toggle"
        :aria-expanded="!collapsed"
        :title="collapsed ? `展开 ${group.label}` : `折叠 ${group.label}`"
        @click="toggle"
      >
        <span class="prop-group__chevron" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
        <span class="prop-group__label">{{ group.label }}</span>
      </button>
      <span v-if="group.unknown" class="prop-group__unknown">未知 / 扩展 · 只读</span>
    </header>

    <div v-if="!collapsed" class="prop-group__rows">
      <slot v-if="hasBodySlot" />

      <template v-else>
        <p v-if="rows.length === 0" class="prop-group__empty">该组当前没有留在属性面板的叶子。</p>

        <ClipPropertyRow
          v-for="row in rows"
          :key="row.path"
          :row="row"
          :timing="timing"
          :playhead="playhead"
          :objects="objects"
          :diagnostics="rowDiagnostics(row.path)"
          :focused="focusedPath === row.path"
          :event-summaries="rowSummaries(row.path)"
          :options="rowOptions(row.path)"
          @open-event-editor="emit('open-event-editor', $event)"
          @reveal-effects="emit('reveal-effects', $event)"
          @focus-row="emit('focus-row', $event)"
          @toggle-keyframe="emit('toggle-keyframe', $event)"
          @jump-keyframe="emit('jump-keyframe', $event)"
        />
      </template>

      <footer v-if="authoringGroupName !== undefined" class="prop-group__footer">
        <button
          type="button"
          class="prop-group__authoring"
          :title="authoringGroupName === null
            ? '该组没有匹配的组合定义：可在弹层里新建自定义组'
            : `组合定义：${authoringGroupName}`"
          @click="emit('open-group-popover', group.key)"
        >
          {{ authoringGroupName === null ? '建立组合…' : `组合定义 · ${authoringGroupName}` }}
        </button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.prop-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}

.prop-group + .prop-group {
  margin-block-start: 0;
}

.prop-group__header {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 0;
  background: var(--bg-panel);
}

.prop-group__header--open {
  border-bottom: 0;
  background: var(--bg-panel);
  border-radius: 0;
}

.prop-group__toggle {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 4px;
  min-width: 0;
  min-height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.prop-group__toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.prop-group__chevron {
  flex: 0 0 auto;
  width: 10px;
  color: var(--accent);
  font-size: 10px;
}

.prop-group__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-group__unknown {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--warning);
  font-size: 10px;
  white-space: nowrap;
}

.prop-group__rows {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0 10px;
}

.prop-group__empty {
  margin: 0;
  padding: 6px 0;
  color: var(--text-muted);
  font-size: 11px;
}

.prop-group__footer {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0 6px;
  border-top: 1px solid var(--border);
}

.prop-group__authoring {
  padding: 1px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}

.prop-group__authoring:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.prop-group__authoring:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}
</style>
