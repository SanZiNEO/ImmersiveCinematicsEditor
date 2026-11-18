<script setup lang="ts">
/**
 * 一个动画叶子在效果面板里的一行（06-02 §三 / 06-04 §三）。
 *
 * 左侧：属性名 + 路径 + 值控件（`PropertyValueForm`）；右侧：本行自己的关键帧组
 * （`EffectKeyframeGroup`）。行菜单只有关闭动画、删除当前帧、复制路径、定位诊断——
 * 本组件不提供任何"新增叶子"或"删除叶子"的入口：动画只由"第一次出现关键帧"产生。
 *
 * 事件行（`mode === 'event'`）不进入值控件，右侧换成"记录"入口并转发
 * `open-event-editor`（记录编辑器由切片 C 提供）。
 *
 * 本组件不写文档：所有写入由值控件经 `ctx.commands.commit` 完成，节点编辑以事件上报给外壳。
 */
import { computed, ref } from 'vue'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import { PLAYHEAD_EPSILON, ROW_LAYOUT } from '../../../features/effects/geometry.ts'
import { outOfRangeCount } from '../../../features/effects/rows.ts'
import type {
  EffectDiagnostic,
  EffectGroup,
  EffectPanelSession,
  EffectViewport,
  KeyframeSelection,
  PropertyRow,
  SegmentSelection,
} from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import EffectKeyframeGroup from './EffectKeyframeGroup.vue'
import PropertyValueForm from '../../../features/effects/panels/PropertyValueForm.vue'
import type {
  AddKeyframePayload,
  EffectRowEmitMap,
  NodeMovePayload,
  NodeSelectPayload,
  SetValuePayload,
} from '../../../features/effects/panels/effectRowEvents.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'

const props = defineProps<{
  group: EffectGroup
  row: PropertyRow
  viewport: EffectViewport
  timing: ClipTiming
  playhead: number
  selection: readonly KeyframeSelection[]
  session: EffectPanelSession
  collapsed: boolean
  /** 本行（含节点）的诊断；由外壳按 `DiagnosticIndex` 取好传入。 */
  diagnostics?: readonly EffectDiagnostic[]
  /** 选中的段（缓动编辑用，本组件只画选中态）。 */
  selectedSegment?: SegmentSelection | null
  /** 只读行（未知路径）：节点可见、可选中，但不能拖动。 */
  readOnly?: boolean
  /** 吸附候选（外壳按同片段全部节点 + 播放头 + 刻度 + 标记汇总）；缺省时组内自算。 */
  snapCandidates?: readonly number[]
  /** 本行在关键帧内容区里的顶部纵坐标（`layoutRows` 的行顶）；跨行框选需要。 */
  rowTop?: number
}>()

const emit = defineEmits<EffectRowEmitMap>()

const ctx = usePanelContext()

const menuOpen = ref(false)
const copyNotice = ref('')

const isEvent = computed(() => props.row.mode === 'event')
const hasKeyframes = computed(() => props.row.keyframes.length > 0)
/** 组级策略下的静态伴随行：有行无帧，没有节点组。 */
const isStaticCompanion = computed(() => !hasKeyframes.value)
const showGroup = computed(() => !props.collapsed && hasKeyframes.value)

const nodeAtPlayhead = computed(() => {
  const frames = props.row.keyframes
  for (const frame of frames) {
    if (Math.abs(frame.time - props.playhead) <= PLAYHEAD_EPSILON) {
      return frame
    }
  }
  return null
})

const outOfRange = computed(() => outOfRangeCount(props.row, props.timing))

const rowDiagnostics = computed<readonly EffectDiagnostic[]>(() => props.diagnostics ?? [])
const worstSeverity = computed<EffectDiagnostic['severity'] | null>(() => {
  const order: EffectDiagnostic['severity'][] = ['block', 'error', 'warn', 'info']
  for (const level of order) {
    if (rowDiagnostics.value.some((item) => item.severity === level)) {
      return level
    }
  }
  return null
})

const rowStyle = computed(() => ({ height: `${ROW_LAYOUT.row}px` }))

const valueKindLabel = computed(() => {
  switch (props.row.valueKind) {
    case 'animated':
      return '动画'
    case 'event':
      return '事件'
    case 'static':
      return '静态'
    case 'unset':
      return '未设置'
    default:
      return '未知'
  }
})

/** 事件行的记录体是否是区间事件（有 `end` 字段）；只用于提示文案。 */
const eventInterval = computed(() => {
  if (!isEvent.value) {
    return false
  }
  return props.row.keyframes.some((frame) => isJsonObject(frame.value) && typeof frame.value.end === 'number')
})

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function disableAnimation(): void {
  closeMenu()
  emit('disable-animation', { clipKey: props.row.clipKey, path: props.row.path })
}

function removeCurrentFrame(): void {
  const frame = nodeAtPlayhead.value
  closeMenu()
  if (frame === null) {
    return
  }
  emit('remove-keyframes', {
    clipKey: props.row.clipKey,
    targets: [{ path: props.row.path, time: frame.time }],
  })
}

async function copyPath(): Promise<void> {
  closeMenu()
  try {
    await navigator.clipboard.writeText(props.row.path)
    copyNotice.value = '已复制路径'
  } catch {
    copyNotice.value = `复制失败：${props.row.path}`
  }
  ctx.status.notify(copyNotice.value, 'info')
  window.setTimeout(() => {
    copyNotice.value = ''
  }, 1500)
}

function revealDiagnostic(): void {
  closeMenu()
  const frame = nodeAtPlayhead.value
  emit('reveal-diagnostic', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    ...(frame === null ? {} : { time: frame.time }),
  })
}

function openEventEditor(): void {
  const frame = nodeAtPlayhead.value ?? props.row.keyframes[0]
  emit('open-event-editor', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: frame?.time ?? props.playhead,
  })
}

function onSelectNode(payload: NodeSelectPayload): void {
  emit('select-node', payload)
}

function onMoveNodes(payload: NodeMovePayload): void {
  emit('move-nodes', payload)
}

function onSetValue(payload: SetValuePayload): void {
  emit('set-value', payload)
}

function onAddKeyframe(payload: AddKeyframePayload): void {
  emit('add-keyframe', payload)
}

/** 事件节点点击 / 双击：转发为 `open-event-editor`（记录编辑器由切片 C 提供）。 */
function onOpenEvent(payload: { clipKey: string; path: string; time: number }): void {
  emit('open-event-editor', payload)
}

/** 段选择：转发给外壳（外壳写 `session.selectedSegment` 并挂缓动编辑器）。 */
function onSelectSegment(payload: { clipKey: string; path: string; fromTime: number; toTime: number }): void {
  emit('select-segment', payload)
}

/** 当前节点值（值控件"当前值"提示用）。 */
const currentValue = computed<JsonValue | undefined>(() => {
  const frame = nodeAtPlayhead.value
  if (frame !== null) {
    return frame.value
  }
  return props.row.hasValue ? (props.row.value as JsonValue) : undefined
})

const valueFormKey = computed(() => props.row.path)
</script>

<template>
  <div
    class="effect-row"
    :class="{
      'effect-row--event': isEvent,
      'effect-row--static': isStaticCompanion,
      'effect-row--collapsed': collapsed,
    }"
    :style="rowStyle"
    :data-path="row.path"
    :data-mode="row.mode"
    :data-group="group.key"
  >
    <div class="effect-row__left">
      <span
        v-if="worstSeverity !== null"
        class="effect-row__dot"
        :data-severity="worstSeverity"
        :title="`${rowDiagnostics.length} 条诊断`"
        role="img"
        :aria-label="`${rowDiagnostics.length} 条诊断`"
      />

      <span class="effect-row__label" :title="row.path">{{ row.label }}</span>
      <code class="effect-row__path" :title="row.path">{{ row.path }}</code>

      <PropertyValueForm
        v-if="!isEvent"
        :key="valueFormKey"
        class="effect-row__control"
        :row="row"
        :panel="hasKeyframes ? 'effects' : 'properties'"
        :playhead="playhead"
        :row-has-keyframes="hasKeyframes"
        :disabled="readOnly === true"
        compact
        @commit="onSetValue"
        @add-keyframe="onAddKeyframe"
      />

      <button
        v-else
        type="button"
        class="effect-row__record"
        :title="`在 t=${playhead.toFixed(3)} 打开记录编辑器（${row.keyframes.length} 条记录）`"
        @click="openEventEditor"
      >
        记录（{{ row.keyframes.length }}）
      </button>

      <span class="effect-row__stats" :title="`值来源：${valueKindLabel}`">
        <span v-if="!isStaticCompanion && !isEvent">{{ row.keyframes.length }} 帧</span>
        <span v-if="outOfRange > 0" class="effect-row__stats-warn">{{ outOfRange }} 轴外</span>
        <span v-if="nodeAtPlayhead !== null" class="effect-row__stats-hit">当前帧</span>
        <span v-else-if="isStaticCompanion">静态值</span>
        <span v-if="eventInterval">区间</span>
      </span>

      <button
        type="button"
        class="effect-row__menu-button"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        title="行菜单"
        @click="toggleMenu"
      >
        ⋯
      </button>

      <div v-if="menuOpen" class="effect-row__menu" role="menu" @keydown.esc="closeMenu">
        <button
          type="button"
          role="menuitem"
          class="effect-row__menu-item"
          :disabled="isEvent"
          :title="isEvent ? '事件叶子不能关闭动画（记录必须非空）' : `删除 ${row.keyframes.length} 帧并保留确定的值`"
          @click="disableAnimation"
        >
          关闭动画
        </button>
        <button
          type="button"
          role="menuitem"
          class="effect-row__menu-item"
          :disabled="nodeAtPlayhead === null"
          @click="removeCurrentFrame"
        >
          删除当前帧
        </button>
        <button type="button" role="menuitem" class="effect-row__menu-item" @click="copyPath">
          复制路径
        </button>
        <button type="button" role="menuitem" class="effect-row__menu-item" @click="revealDiagnostic">
          定位诊断
        </button>
      </div>
    </div>

    <div class="effect-row__right">
      <EffectKeyframeGroup
        v-if="showGroup"
        :row="row"
        :viewport="viewport"
        :timing="timing"
        :playhead="playhead"
        :selection="selection"
        :selected-segment="selectedSegment ?? session.selectedSegment"
        :read-only="readOnly === true || row.unknown"
        :current-value="currentValue"
        :snap-candidates="snapCandidates"
        :row-top="rowTop"
        @select-node="onSelectNode"
        @move-nodes="onMoveNodes"
        @open-event="onOpenEvent"
        @select-segment="onSelectSegment"
      />
      <span v-else-if="collapsed" class="effect-row__placeholder">组已折叠</span>
      <span v-else class="effect-row__placeholder">组内静态值 · 无节点组</span>
    </div>
  </div>
</template>

<style scoped>
.effect-row {
  display: grid;
  grid-template-columns: var(--effect-row-left-width, 200px) minmax(0, 1fr);
  align-items: center;
  min-width: 0;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
}

.effect-row:hover {
  background: var(--bg-hover);
}

.effect-row--static {
  color: var(--text-secondary);
}

.effect-row__left {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
  padding: 0 6px;
  border-right: 1px solid var(--border);
}

.effect-row__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.effect-row__dot[data-severity='block'],
.effect-row__dot[data-severity='error'] {
  background: var(--error);
}

.effect-row__dot[data-severity='warn'] {
  background: var(--warning);
}

.effect-row__dot[data-severity='info'] {
  background: var(--accent);
}

.effect-row__label {
  flex: 0 0 auto;
  max-width: 84px;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.effect-row__path {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.effect-row__control {
  flex: 0 0 auto;
  min-width: 72px;
  max-width: 130px;
}

.effect-row__record {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.effect-row__record:hover {
  background: var(--bg-hover);
}

.effect-row__record:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.effect-row__stats {
  display: flex;
  flex: 0 1 auto;
  gap: 6px;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.effect-row__stats-warn {
  color: var(--warning);
}

.effect-row__stats-hit {
  color: var(--accent);
}

.effect-row__menu-button {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  line-height: 1;
  cursor: pointer;
}

.effect-row__menu-button:hover {
  border-color: var(--border);
  background: var(--bg-raised);
  color: var(--text);
}

.effect-row__menu-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.effect-row__menu {
  position: absolute;
  top: 100%;
  right: 4px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  box-shadow: 0 6px 18px rgb(0 0 0 / 35%);
}

.effect-row__menu-item {
  padding: 4px 8px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.effect-row__menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.effect-row__menu-item:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.effect-row__right {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.effect-row__placeholder {
  padding-left: 8px;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
