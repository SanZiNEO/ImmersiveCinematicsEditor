<script setup lang="ts">
/**
 * 右侧 Inspector 的一行（设计稿「按任务组织片段字段」）。
 *
 * 与旧属性的区别：
 * - 主行只呈现操作词、值控件与帧按钮；路径只放在提示里，不显示模式/计数/原始枚举；
 * - 可动画行始终有 `‹ ◇ ›`：无帧时菱形也能明确建首帧，有帧时实心并显式删除；
 * - 有帧的值控件走 `PropertyValueForm` 的 Inspector opt-in：帧上可改、帧间只读采样；
 * - 未知路径只读原始值；事件保留记录摘要与行为页入口；
 * - 仅组合型（struct）扩展字段在有帧时退为「在效果面板」定位按钮；标量专用控件有帧时
 *   由通用 Inspector 接管，避免静态控件误写。
 *
 * 写入由父级命令层完成：本组件只发意图，不直接改文档。
 */
import { computed, defineAsyncComponent } from 'vue'
import type { Component } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { effectiveStaticValue, isRequiredMissing } from '../../../features/effects/rows.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { EffectDiagnostic, PropertyRow } from '../../../features/effects/types.ts'
import { PLAYHEAD_EPSILON } from '../../../features/effects/geometry.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { customFieldFor, customFieldsRevision } from '../../../features/effects/customFields.ts'
import { fieldSurfaceFor, hideWhenFramed } from '../../../workbench/api/fieldSurface.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import PropertyValueForm from '../../../features/effects/panels/PropertyValueForm.vue'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'

const props = defineProps<{
  row: PropertyRow
  timing: ClipTiming
  /** 播放头在片段内的局部秒。 */
  playhead: number
  /** 当前片段的对象（专用字段控件入参）。 */
  objects?: JsonObject
  /** 本行诊断（最高级别用于边框与可定位标记）。 */
  diagnostics: readonly EffectDiagnostic[]
  /** 由外壳决定的高亮（选中叶子 / 定位目标）。 */
  focused: boolean
  /** 事件记录摘要（按时间升序）；非事件行为空。 */
  eventSummaries?: readonly string[]
  /** 右栏值控件选项；由父级按路径提供。 */
  options?: InspectorValueOptions
  /** 三轴并列变体：标签与帧按钮在数值上方。 */
  axis?: boolean
}>()

const emit = defineEmits<{
  'open-event-editor': [{ clipKey: string; path: string; time: number }]
  'reveal-effects': [{ clipKey: string; path: string }]
  'focus-row': [{ path: string }]
  /** 菱形建/删帧（外壳走 addKeyframe / removeKeyframe）。 */
  'toggle-keyframe': [{ clipKey: string; path: string; time: number; create: boolean }]
  /** 前后帧跳转（外壳只移播放头）。 */
  'jump-keyframe': [{ clipKey: string; path: string; time: number }]
}>()

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const trackType = computed(() => props.row.def?.scope[0] ?? '')
const customField = computed(() => {
  void customFieldsRevision.value
  if (trackType.value === '') return undefined
  return customFieldFor(trackType.value, props.row.path)
})
/** 当前片段对象（父级没传时从文档服务取只读克隆）。 */
const rowObjects = computed<JsonObject>(() => {
  if (props.objects !== undefined) return props.objects
  return documentService?.clipObjects(props.row.clipKey) ?? {}
})
/** 注册过的专用字段面（轨道类型 + 路径）。 */
const fieldSurface = computed(() => {
  if (trackType.value === '') return null
  return fieldSurfaceFor(trackType.value, props.row.path)
})
const fieldSurfaceComponent = computed<Component | null>(() => {
  const surface = fieldSurface.value
  if (surface === null || surface.component === undefined) return null
  return defineAsyncComponent(surface.component as () => Promise<Component>)
})

const requiredMissing = computed(() => isRequiredMissing(props.row, props.timing))
const severity = computed<EffectDiagnostic['severity'] | null>(() => props.diagnostics[0]?.severity ?? null)
const blocked = computed(() => severity.value === 'block')
const unavailable = computed(() => props.row.unavailableReason)
const readOnly = computed(() => props.row.unknown || props.row.mode === 'unknown')
const isEvent = computed(() => props.row.mode === 'event')
const hasFrames = computed(() => props.row.keyframes.length > 0)
const stackedLabel = computed(() =>
  props.options?.multiline === true && props.options.stackedLabel === true)

/**
 * 只有支持动画的普通标量行有帧按钮；结构、事件、静态与未知路径都没有。
 * `mode` 是 schema 能力，无帧时也允许用菱形建首帧。
 */
const animatableRow = computed(() =>
  props.row.mode === 'animated' && props.row.type !== 'struct' && !readOnly.value)

/**
 * 显式扩展声明「有帧时只在效果面板编辑」：只对**组合型**（struct）专用控件退为定位按钮。
 *
 * 标量行（数值 / 枚举 / 引用 / 布尔，包括注册的滑杆和遮幅画幅比）的专用组件只写静态值，
 * 有帧时必须让通用 Inspector 控件接管：帧上可改、帧间只读采样。
 */
const framedInEffects = computed(() =>
  hasFrames.value
  && props.row.type === 'struct'
  && trackType.value !== ''
  && hideWhenFramed(trackType.value, props.row.path))

const frameAtPlayhead = computed(() =>
  props.row.keyframes.find((frame) => Math.abs(frame.time - props.playhead) <= PLAYHEAD_EPSILON))
const atFrame = computed(() => frameAtPlayhead.value !== undefined)

/** 严格早于 / 晚于播放头的最近帧；没有时为 undefined。 */
const prevFrameTime = computed<number | undefined>(() => {
  let best: number | undefined
  for (const frame of props.row.keyframes) {
    if (frame.time < props.playhead - PLAYHEAD_EPSILON && (best === undefined || frame.time > best)) {
      best = frame.time
    }
  }
  return best
})
const nextFrameTime = computed<number | undefined>(() => {
  let best: number | undefined
  for (const frame of props.row.keyframes) {
    if (frame.time > props.playhead + PLAYHEAD_EPSILON && (best === undefined || frame.time < best)) {
      best = frame.time
    }
  }
  return best
})

/** 播放头是否落在片段范围内：片段外不允许新建帧（删除已存在的越界帧仍允许）。 */
const playheadInSegment = computed(() => {
  if (!Number.isFinite(props.playhead) || props.playhead < -PLAYHEAD_EPSILON) {
    return false
  }
  return props.timing.infinite || props.playhead <= props.timing.duration + PLAYHEAD_EPSILON
})
const canToggleFrame = computed(() =>
  animatableRow.value && (playheadInSegment.value || atFrame.value))

const frameTimeLabel = computed(() => (frameAtPlayhead.value?.time ?? props.playhead).toFixed(2))

const frameTitle = computed(() => {
  if (!animatableRow.value) return '该属性不支持关键帧'
  if (!playheadInSegment.value && !atFrame.value) return '播放头不在片段范围内，不能新建关键帧'
  return atFrame.value
    ? `删除 ${frameTimeLabel.value}s 的关键帧`
    : `在 ${frameTimeLabel.value}s 创建关键帧`
})
const prevTitle = computed(() =>
  prevFrameTime.value === undefined ? '前面没有关键帧' : `跳到 ${prevFrameTime.value.toFixed(2)}s 的关键帧`)
const nextTitle = computed(() =>
  nextFrameTime.value === undefined ? '后面没有关键帧' : `跳到 ${nextFrameTime.value.toFixed(2)}s 的关键帧`)

const rawPreview = computed(() => {
  const value = effectiveStaticValue(props.row)
  if (value === undefined) {
    return '（未设置）'
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
})

/** 在行为页打开：有记录时定位到播放头命中的那条，否则交给抽屉新建。 */
function openBehavior(): void {
  const frames = props.row.keyframes
  const atPlayhead = frames.find((frame) => Math.abs(frame.time - props.playhead) <= PLAYHEAD_EPSILON)
  const time = atPlayhead?.time ?? frames[0]?.time ?? props.playhead
  emit('open-event-editor', { clipKey: props.row.clipKey, path: props.row.path, time })
}

function focusRow(): void {
  emit('focus-row', { path: props.row.path })
}

function revealEffects(): void {
  emit('reveal-effects', { clipKey: props.row.clipKey, path: props.row.path })
}

/** 菱形：命中帧时用规范帧时间删除，否则用播放头时间建帧。 */
function toggleFrame(): void {
  if (!canToggleFrame.value) {
    return
  }
  emit('toggle-keyframe', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: frameAtPlayhead.value?.time ?? props.playhead,
    create: !atFrame.value,
  })
}

function jumpFrame(time: number | undefined): void {
  if (time === undefined) {
    return
  }
  emit('jump-keyframe', { clipKey: props.row.clipKey, path: props.row.path, time })
}
</script>

<template>
  <div
    class="prop-row"
    :class="{
      'prop-row--required': requiredMissing,
      'prop-row--focused': focused,
      'prop-row--blocked': blocked,
      'prop-row--unset': !row.present,
      'prop-row--readonly': readOnly,
      'prop-row--axis': axis === true,
      'prop-row--actions': animatableRow,
      'prop-row--stacked': stackedLabel,
    }"
    :data-path="row.path"
    :data-severity="severity ?? ''"
    :data-axis="axis === true ? 'true' : undefined"
    :data-animated="animatableRow ? 'true' : undefined"
    :data-at-frame="animatableRow ? String(atFrame) : undefined"
    tabindex="0"
    @click="focusRow"
    @focus="focusRow"
  >
    <div class="prop-row__main">
      <span class="prop-row__label-wrap">
        <span class="prop-row__label" :title="row.path">{{ row.label }}</span>
        <span v-if="requiredMissing" class="prop-row__badge">必填未设置</span>
      </span>

      <div class="prop-row__value">
        <!-- 未知路径：只读原始值，没有值控件、没有帧按钮 -->
        <template v-if="readOnly">
          <pre class="prop-row__raw" :title="row.path">{{ rawPreview }}</pre>
          <div class="prop-row__inline-note">
            <span>schema 未登记该路径，只能查看原值。</span>
            <button v-if="hasFrames" type="button" class="prop-row__link" @click.stop="revealEffects">
              在效果面板
            </button>
          </div>
        </template>

        <!-- 事件：摘要 + 行为页入口（没有帧按钮） -->
        <template v-else-if="isEvent">
          <ul v-if="eventSummaries !== undefined && eventSummaries.length > 0" class="prop-row__events">
            <li v-for="(summary, index) in eventSummaries" :key="index" class="prop-row__event-item">
              {{ summary }}
            </li>
          </ul>
          <span v-else class="prop-row__muted">暂无记录</span>
          <button type="button" class="prop-row__link" @click.stop="openBehavior">
            在行为页打开
          </button>
        </template>

        <!-- 显式扩展：有帧时只在效果面板编辑 -->
        <template v-else-if="framedInEffects">
          <span class="prop-row__muted">动画值在效果面板编辑</span>
          <button type="button" class="prop-row__link" @click.stop="revealEffects">
            在效果面板
          </button>
        </template>

        <!-- 专用字段：只在静态时接管；一旦有帧就回到通用 Inspector 控件（可采样 / 改当前帧） -->
        <component
          :is="customField"
          v-else-if="!hasFrames && customField !== undefined"
          :row="row"
          :objects="rowObjects"
          :timing="timing"
          :playhead="playhead"
          :disabled="blocked || unavailable !== undefined"
        />
        <component
          :is="fieldSurfaceComponent"
          v-else-if="!hasFrames && fieldSurfaceComponent !== null"
          :row="row"
          :objects="rowObjects"
          :timing="timing"
          :playhead="playhead"
          :disabled="blocked || unavailable !== undefined"
        />
        <PropertyValueForm
          v-else
          :row="row"
          panel="properties"
          :objects="rowObjects"
          :playhead="playhead"
          :timing="timing"
          :row-has-keyframes="hasFrames"
          :disabled="blocked || unavailable !== undefined"
          :inspector="options ?? {}"
        />
      </div>

      <div v-if="animatableRow" class="prop-row__frames" role="group" :aria-label="`${row.label}关键帧`">
        <button
          type="button"
          class="prop-row__frame prop-row__frame--prev"
          :disabled="prevFrameTime === undefined"
          :title="prevTitle"
          :aria-label="`${row.label}上一关键帧`"
          @click.stop="jumpFrame(prevFrameTime)"
        >‹</button>
        <button
          type="button"
          class="prop-row__frame prop-row__frame--toggle"
          :class="{ 'prop-row__frame--on': atFrame }"
          :disabled="!canToggleFrame"
          :aria-pressed="atFrame"
          :title="frameTitle"
          :aria-label="atFrame ? `删除${row.label}当前关键帧` : `添加${row.label}关键帧`"
          @click.stop="toggleFrame"
        >{{ atFrame ? '◆' : '◇' }}</button>
        <button
          type="button"
          class="prop-row__frame prop-row__frame--next"
          :disabled="nextFrameTime === undefined"
          :title="nextTitle"
          :aria-label="`${row.label}下一关键帧`"
          @click.stop="jumpFrame(nextFrameTime)"
        >›</button>
      </div>
    </div>

    <p v-if="unavailable !== undefined" class="prop-row__hint prop-row__hint--warn">
      依赖未满足：{{ unavailable }}
    </p>
  </div>
</template>

<style scoped>
.prop-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 34px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.prop-row:last-child {
  border-bottom: 0;
}

.prop-row:hover {
  background: var(--bg-hover);
}

.prop-row:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.prop-row--focused {
  background: var(--bg-hover);
  border-left-color: var(--selection-outline);
}

.prop-row--required,
.prop-row--blocked {
  border-left-color: var(--error);
}

.prop-row--blocked {
  background: var(--error-bg);
}

.prop-row--unset .prop-row__label {
  color: var(--text-secondary);
}

.prop-row--readonly {
  opacity: 0.9;
}

.prop-row__main {
  display: grid;
  grid-template-columns: minmax(72px, 0.9fr) minmax(0, 2fr) auto;
  grid-template-areas: 'label value frames';
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 没有帧按钮的行：值区占满剩余宽度（三轴格里另有布局）。 */
.prop-row:not(.prop-row--actions):not(.prop-row--axis) .prop-row__main {
  grid-template-columns: minmax(72px, 0.9fr) minmax(0, 1fr);
  grid-template-areas: 'label value';
}

/* 三轴并列：标签 + 帧按钮在数值上方，容器不溢出。 */
.prop-row--axis {
  min-height: 0;
  padding: 2px 0;
  border-bottom: 0;
  font-size: 11px;
}

/* 长文本：标签单独占首行，输入框占满下一行。 */
.prop-row.prop-row--stacked:not(.prop-row--actions):not(.prop-row--axis) .prop-row__main {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label frames'
    'value value';
  align-items: center;
  gap: 3px 4px;
}

.prop-row--stacked .prop-row__value {
  width: 100%;
}

.prop-row--axis .prop-row__main {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label frames'
    'value value';
  align-items: center;
  gap: 3px 2px;
}

.prop-row__label-wrap {
  display: flex;
  grid-area: label;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.prop-row__label {
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-row--axis .prop-row__label {
  font-size: 11px;
  font-weight: 600;
}

.prop-row__badge {
  flex: 0 0 auto;
  padding: 0 4px;
  border: 1px solid var(--error);
  border-radius: 3px;
  color: var(--error);
  font-size: 10px;
  white-space: nowrap;
}

.prop-row__value {
  grid-area: value;
  min-width: 0;
}

.prop-row__frames {
  display: inline-flex;
  flex: 0 0 auto;
  grid-area: frames;
  align-items: center;
  gap: 1px;
}

.prop-row__frame {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  min-height: 26px;
  padding: 0 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.prop-row__frame:hover:enabled {
  background: var(--bg-hover);
  color: var(--text);
}

.prop-row__frame:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.prop-row__frame:disabled {
  color: var(--border-strong);
  cursor: not-allowed;
}

.prop-row__frame--toggle {
  font-size: 16px;
}

.prop-row__frame--on {
  color: var(--accent);
}

.prop-row--axis .prop-row__frame {
  min-width: 14px;
  min-height: 22px;
  padding: 0 1px;
  font-size: 13px;
}

.prop-row--axis .prop-row__frame--toggle {
  font-size: 14px;
}

.prop-row__raw {
  margin: 0;
  padding: 4px 6px;
  max-height: 120px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: pre-wrap;
}

.prop-row__inline-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 10px;
}

.prop-row__muted {
  color: var(--text-muted);
  font-size: 11px;
}

.prop-row__events {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 84px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.prop-row__event-item {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-row__link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}

.prop-row__link:hover {
  color: var(--text);
}

.prop-row__link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.prop-row__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.prop-row__hint--warn {
  color: var(--warning);
}

/* 三轴格子里数值优先，滑杆隐藏（窄栏不溢出）。 */
.prop-row--axis :deep(.value-form__slider) {
  display: none;
}

.prop-row--axis :deep(.value-form__input--number) {
  max-width: none;
}
</style>
