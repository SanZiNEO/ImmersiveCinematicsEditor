<script setup lang="ts">
/**
 * 效果组（06-02 §三）：组头 + 组内行。
 *
 * 组头显示动画叶子数、总帧数、轴外帧数；组级策略下再显示静态伴随行数。
 * 折叠时组头保留、行收起。组头有诊断时显示最高级别圆点与计数（折叠也不丢）。
 *
 * 组只来自 schema 的 `section`/`group` 归类——本组件**不创建**组、**不添加**属性。
 */
import { computed } from 'vue'
import { ROW_LAYOUT } from '../../../features/effects/geometry.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type {
  DiagnosticIndex,
  EffectDiagnostic,
  EffectGroup,
  EffectPanelSession,
  EffectViewport,
  KeyframeSelection,
} from '../../../features/effects/types.ts'
import EffectRow from './EffectRow.vue'
import type {
  AddKeyframePayload,
  DisableAnimationPayload,
  JumpKeyframePayload,
  NodeMovePayload,
  NodeSelectPayload,
  OpenEventEditorPayload,
  RemoveKeyframesPayload,
  RevealDiagnosticPayload,
  SetValuePayload,
  ToggleAnimationPayload,
  ToggleKeyframePayload,
} from '../../../features/effects/panels/effectRowEvents.ts'

const props = defineProps<{
  group: EffectGroup
  viewport: EffectViewport
  timing: ClipTiming
  playhead: number
  selection: readonly KeyframeSelection[]
  session: EffectPanelSession
  /** 组级策略：显示静态伴随行数。 */
  showStaticCompanions?: boolean
  /** 诊断索引：组头取最高级别与计数，行取自身诊断。 */
  diagnostics?: DiagnosticIndex | null
  /** 吸附候选（外壳按同片段全部节点 + 播放头 + 刻度 + 标记汇总）。 */
  snapCandidates?: readonly number[]
  /** 行中心（`layoutRows` 的 `centers`）：跨行框选与内容区坐标需要。 */
  rowCenters?: ReadonlyMap<string, number>
}>()

const emit = defineEmits<{
  'select-node': [payload: NodeSelectPayload]
  'move-nodes': [payload: NodeMovePayload]
  'remove-keyframes': [payload: RemoveKeyframesPayload]
  'disable-animation': [payload: DisableAnimationPayload]
  'add-keyframe': [payload: AddKeyframePayload]
  'set-value': [payload: SetValuePayload]
  'reveal-diagnostic': [payload: RevealDiagnosticPayload]
  'open-event-editor': [payload: OpenEventEditorPayload]
  /** 段选择（缓动编辑入口）：外壳据此写 `session.selectedSegment`。 */
  'select-segment': [payload: { clipKey: string; path: string; fromTime: number; toTime: number }]
  'toggle-collapse': [groupKey: string]
  /** 菱形建/删帧（透传自值控件）。 */
  'toggle-keyframe': [payload: ToggleKeyframePayload]
  /** 时钟开关动画（透传自值控件）。 */
  'toggle-animation': [payload: ToggleAnimationPayload]
  /** 前后帧跳转（透传自值控件）。 */
  'jump-keyframe': [payload: JumpKeyframePayload]
}>()

const collapsed = computed(() => props.session.collapsed.has(props.group.key))

const groupDiagnostic = computed(() => props.diagnostics?.byGroup.get(props.group.key) ?? null)

const severityLabel = computed(() => {
  switch (groupDiagnostic.value?.severity) {
    case 'block':
      return '阻止'
    case 'error':
      return '错误'
    case 'warn':
      return '警告'
    case 'info':
      return '提示'
    default:
      return ''
  }
})

const headerStyle = computed(() => ({ height: `${ROW_LAYOUT.groupHeader}px` }))

function rowDiagnostics(path: string): readonly EffectDiagnostic[] {
  return props.diagnostics?.byRow.get(path) ?? []
}

/** 行顶 = 行中心 - 半行高；跨行框选时换算成内容区坐标。 */
function rowTopOf(path: string): number | undefined {
  const center = props.rowCenters?.get(path)
  if (center === undefined) {
    return undefined
  }
  return center - ROW_LAYOUT.row / 2
}

function toggle(): void {
  emit('toggle-collapse', props.group.key)
}

function onSelectNode(payload: NodeSelectPayload): void {
  emit('select-node', payload)
}

function onMoveNodes(payload: NodeMovePayload): void {
  emit('move-nodes', payload)
}

function onRemoveKeyframes(payload: RemoveKeyframesPayload): void {
  emit('remove-keyframes', payload)
}

function onDisableAnimation(payload: DisableAnimationPayload): void {
  emit('disable-animation', payload)
}

function onAddKeyframe(payload: AddKeyframePayload): void {
  emit('add-keyframe', payload)
}

function onSetValue(payload: SetValuePayload): void {
  emit('set-value', payload)
}

function onRevealDiagnostic(payload: RevealDiagnosticPayload): void {
  emit('reveal-diagnostic', payload)
}

function onOpenEventEditor(payload: OpenEventEditorPayload): void {
  emit('open-event-editor', payload)
}

/** 段选择：原样转发（外壳写 `session.selectedSegment`）。 */
function onSelectSegment(payload: { clipKey: string; path: string; fromTime: number; toTime: number }): void {
  emit('select-segment', payload)
}
</script>

<template>
  <section
    class="effect-group"
    :class="{ 'effect-group--collapsed': collapsed, 'effect-group--unknown': group.unknown }"
    :data-group="group.key"
  >
    <header class="effect-group__header" :style="headerStyle">
      <button
        type="button"
        class="effect-group__toggle"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开组' : '折叠组'"
        @click="toggle"
      >
        <span class="effect-group__chevron" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
        <span class="effect-group__label" :title="group.key === '' ? '未分组' : group.key">{{ group.label }}</span>
      </button>

      <span
        v-if="groupDiagnostic !== null"
        class="effect-group__dot"
        :data-severity="groupDiagnostic.severity"
        :title="`${severityLabel}：${groupDiagnostic.count} 条诊断`"
        role="img"
        :aria-label="`${severityLabel} ${groupDiagnostic.count} 条诊断`"
      >
        <span class="effect-group__dot-mark" aria-hidden="true" />
        <span class="effect-group__dot-count">{{ groupDiagnostic.count }}</span>
      </span>

      <span v-if="group.unknown" class="effect-group__badge">未知</span>

      <span class="effect-group__stats">
        <span :title="`${group.animatedCount} 个属性有关键帧`">{{ group.animatedCount }} 属性</span>
        <span :title="`${group.frameCount} 帧`">{{ group.frameCount }} 帧</span>
        <span
          v-if="group.outOfRangeCount > 0"
          class="effect-group__stats-warn"
          :title="`${group.outOfRangeCount} 帧在片段时长之外`"
        >{{ group.outOfRangeCount }} 轴外</span>
        <span
          v-if="showStaticCompanions === true && group.staticCompanionCount > 0"
          class="effect-group__stats-muted"
          :title="`${group.staticCompanionCount} 个静态伴随行（组级策略）`"
        >{{ group.staticCompanionCount }} 静态伴随</span>
      </span>
    </header>

    <div v-if="!collapsed" class="effect-group__rows">
      <p v-if="group.rows.length === 0" class="effect-group__empty">该组没有可见行。</p>
      <EffectRow
        v-for="row in group.rows"
        :key="row.path"
        :group="group"
        :row="row"
        :viewport="viewport"
        :timing="timing"
        :playhead="playhead"
        :selection="selection"
        :session="session"
        :collapsed="collapsed"
        :diagnostics="rowDiagnostics(row.path)"
        :selected-segment="session.selectedSegment"
        :read-only="row.unknown"
        :snap-candidates="snapCandidates"
        :row-top="rowTopOf(row.path)"
        @select-node="onSelectNode"
        @move-nodes="onMoveNodes"
        @remove-keyframes="onRemoveKeyframes"
        @disable-animation="onDisableAnimation"
        @add-keyframe="onAddKeyframe"
        @set-value="onSetValue"
        @reveal-diagnostic="onRevealDiagnostic"
        @open-event-editor="onOpenEventEditor"
        @select-segment="onSelectSegment"
        @toggle-keyframe="(payload) => emit('toggle-keyframe', payload)"
        @toggle-animation="(payload) => emit('toggle-animation', payload)"
        @jump-keyframe="(payload) => emit('jump-keyframe', payload)"
      />
    </div>
  </section>
</template>

<style scoped>
.effect-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-bottom: 1px solid var(--border-strong);
}

.effect-group__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 6px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 11px;
}

.effect-group--unknown .effect-group__header {
  background: var(--bg-panel);
}

.effect-group__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.effect-group__toggle:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.effect-group__toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.effect-group__chevron {
  flex: 0 0 auto;
  width: 8px;
  font-family: var(--font-mono);
}

.effect-group__label {
  max-width: 160px;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.effect-group__dot {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.effect-group__dot-mark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.effect-group__dot[data-severity='block'] .effect-group__dot-mark,
.effect-group__dot[data-severity='error'] .effect-group__dot-mark {
  background: var(--error);
}

.effect-group__dot[data-severity='warn'] .effect-group__dot-mark {
  background: var(--warning);
}

.effect-group__dot[data-severity='info'] .effect-group__dot-mark {
  background: var(--accent);
}

.effect-group__dot-count {
  font-size: 10px;
}

.effect-group__badge {
  flex: 0 0 auto;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  color: var(--text-muted);
  font-size: 10px;
}

.effect-group__stats {
  display: flex;
  flex: 0 1 auto;
  gap: 8px;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.effect-group__stats-warn {
  color: var(--warning);
}

.effect-group__stats-muted {
  color: var(--text-muted);
  font-style: italic;
}

.effect-group__rows {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.effect-group__empty {
  margin: 0;
  padding: 6px 10px;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
