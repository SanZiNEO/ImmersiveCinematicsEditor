<script setup lang="ts">
/**
 * 属性组（06-09 §三）：组头吸顶 + 组内全部适用叶子（纵向虚拟化）。
 *
 * 组头显示"已设置数 / 总数"，并提示该组有几项已经去了效果面板；
 * 点这个计数跳到效果面板的对应组（只改可见性与滚动，不改文档）。
 * 组**只来自** schema 的 `section`/`group` 归类——本组件不创建组、不添加属性。
 *
 * 虚拟化：行高来自 `rowLayout.ts`（与行组件同一函数），只渲染可见窗口 + 缓冲，
 * 行用绝对定位放在自己的偏移上，因此滚动时不会错位。
 */
import { computed } from 'vue'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { EffectDiagnostic, EffectGroup, PropertyRow } from '../../../features/effects/types.ts'
import type { RowPanel } from '../../../features/effects/rowFilters.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import ClipPropertyRow from './ClipPropertyRow.vue'
import { propertyRowHeight, rowOffsets, visibleRowRange } from './rowLayout.ts'

const props = defineProps<{
  group: EffectGroup
  timing: ClipTiming
  playhead: number
  objects: JsonObject
  panel: RowPanel
  /** 事件行摘要（路径 → 摘要列表）；由外壳按事件记录读取模型计算。 */
  eventSummaries?: ReadonlyMap<string, readonly string[]>
  collapsed: boolean
  /** 该组在效果面板里的叶子数（0 表示整组都在属性面板）。 */
  effectCount: number
  /** 行诊断：`path → 诊断列表`（已按级别排序）。 */
  diagnostics: ReadonlyMap<string, readonly EffectDiagnostic[]>
  focusedPath: string | null
  /** 组内容区顶部相对滚动容器的偏移（虚拟化用）。 */
  localTop: number
  scrollTop: number
  viewportHeight: number
  /** 07-01：该组命中的组合定义 id（null = 没有匹配，弹层会建议新建自定义组）。 */
  authoringGroupId?: string | null
  /** 07-01：组合定义显示名（组头按钮提示用）。 */
  authoringGroupName?: string | null
  /** 事件行摘要（路径 → 摘要列表）；由外壳按事件记录读取模型计算。 */
  eventSummaries?: ReadonlyMap<string, readonly string[]>
}>()

const emit = defineEmits<{
  /** 07-01：组头「组合」入口（弹层由外壳挂载）。 */
  'open-group-popover': [groupKey: string]
  'toggle-collapse': [groupKey: string]
  'jump-effects': [groupKey: string]
  'open-event-editor': [{ clipKey: string; path: string; time: number }]
  'reveal-effects': [{ clipKey: string; path: string }]
  'focus-row': [{ path: string }]
  'enabled': [{ clipKey: string; path: string; time: number }]
  'failed': [{ clipKey: string; path: string; message: string }]
  'toggle-keyframe': [{ clipKey: string; path: string; time: number; create: boolean }]
  'toggle-animation': [{ clipKey: string; path: string; time: number; enable: boolean }]
  'jump-keyframe': [{ clipKey: string; path: string; time: number }]
}>()

const total = computed(() => props.group.rows.length)
const setCount = computed(() => props.group.rows.filter((row) => row.present).length)
const rowsOfGroup = computed<PropertyRow[]>(() => props.group.rows)

const offsets = computed(() => rowOffsets(rowsOfGroup.value))
const contentHeight = computed(() => {
  const rows = rowsOfGroup.value
  if (rows.length === 0) {
    return 0
  }
  return offsets.value[rows.length - 1] + propertyRowHeight(rows[rows.length - 1])
})

const range = computed(() => visibleRowRange({
  rows: rowsOfGroup.value,
  localTop: props.localTop,
  scrollTop: props.scrollTop,
  viewportHeight: props.viewportHeight,
}))

const visibleRows = computed(() => rowsOfGroup.value.slice(range.value.first, range.value.last))

/** 行的像素偏移（绝对定位用；与行高同一来源，虚拟化不会错位）。 */
function rowOffset(path: string): number {
  const index = rowsOfGroup.value.findIndex((row) => row.path === path)
  return index < 0 ? 0 : offsets.value[index]
}

function rowDiagnostics(path: string): readonly EffectDiagnostic[] {
  return props.diagnostics.get(path) ?? []
}

function toggle(): void {
  emit('toggle-collapse', props.group.key)
}

function jumpToEffects(): void {
  if (props.effectCount === 0) {
    return
  }
  emit('jump-effects', props.group.key)
}
</script>

<template>
  <section class="prop-group" :data-group="group.key">
    <header class="prop-group__header">
      <button
        type="button"
        class="prop-group__toggle"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开组' : '折叠组'"
        @click="toggle"
      >
        <span class="prop-group__chevron" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
        <span class="prop-group__label">{{ group.label }}</span>
      </button>
      <span class="prop-group__stats">{{ setCount }} / {{ total }} 已设置</span>
      <button
        v-if="effectCount > 0"
        type="button"
        class="prop-group__effect-link"
        :title="`该组有 ${effectCount} 项已在效果面板`"
        @click="jumpToEffects"
      >
        {{ effectCount }} 项在效果面板
      </button>
      <span v-if="group.unknown" class="prop-group__unknown">未知 / 扩展 · 只读</span>
      <button
        type="button"
        class="prop-group__authoring"
        :title="authoringGroupName === null || authoringGroupName === undefined
          ? '该组没有匹配的组合定义：可在弹层里新建自定义组'
          : `组合定义：${authoringGroupName}`"
        @click="emit('open-group-popover', props.group.key)"
      >
        {{ authoringGroupName === null || authoringGroupName === undefined ? '组合' : `组合 · ${authoringGroupName}` }}
      </button>
    </header>

    <div v-if="!collapsed" class="prop-group__rows" :style="{ height: `${contentHeight}px` }">
      <p v-if="rowsOfGroup.length === 0" class="prop-group__empty">该组当前没有留在属性面板的叶子。</p>
      <template v-else>
        <div
          v-for="row in visibleRows"
          :key="row.path"
          class="prop-group__slot"
          :style="{ top: `${rowOffset(row.path)}px`, height: `${propertyRowHeight(row)}px` }"
        >
          <ClipPropertyRow
            :row="row"
            :timing="timing"
            :objects="objects"
            :panel="panel"
            :playhead="playhead"
            :diagnostics="rowDiagnostics(row.path)"
            :focused="focusedPath === row.path"
            :event-summaries="eventSummaries?.get(row.path)"
            @open-event-editor="emit('open-event-editor', $event)"
            @reveal-effects="emit('reveal-effects', $event)"
            @focus-row="emit('focus-row', $event)"
            @enabled="emit('enabled', $event)"
            @failed="emit('failed', $event)"
            @toggle-keyframe="emit('toggle-keyframe', $event)"
            @toggle-animation="emit('toggle-animation', $event)"
            @jump-keyframe="emit('jump-keyframe', $event)"
          />
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.prop-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.prop-group__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.prop-group__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.prop-group__toggle:focus-visible,
.prop-group__effect-link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.prop-group__chevron {
  width: 10px;
  color: var(--text-muted);
}

.prop-group__label {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-group__stats {
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.prop-group__effect-link {
  margin-left: auto;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.prop-group__effect-link:hover {
  background: var(--bg-hover);
}

.prop-group__unknown {
  margin-left: auto;
  color: var(--warning);
  white-space: nowrap;
}

.prop-group__authoring {
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
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

.prop-group__rows {
  position: relative;
  overflow: hidden;
}

.prop-group__slot {
  position: absolute;
  left: 0;
  right: 0;
  overflow: hidden;
}

.prop-group__empty {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px 10px;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
