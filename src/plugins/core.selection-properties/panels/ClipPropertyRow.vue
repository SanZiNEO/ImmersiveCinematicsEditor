<script setup lang="ts">
/**
 * 属性面板的一行（06-09 §三）：组内一个适用叶子。
 *
 * 呈现规则：
 * - `VALUE` / `STRUCT`：只有值控件，没有时钟；
 * - `ANIMATED`：值控件 + 时钟（空帧文案"添加首帧"）；有帧的行不进本面板；
 * - `EVENT`：空记录给"添加首条记录"，有记录给"N 条记录 + 在效果面板"；
 * - 未知路径：只读，展示原始值，没有时钟也没有记录入口；
 * - 必填缺失：行内"必填未设置"与错误边框，**不弹对话框**；定位只展开并聚焦，不创建对象。
 *
 * 所有写入走 `ctx.commands.commit`（值控件与时钟内部完成），本组件只组合与显示。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { eventDefinition, readRecordBody, seedRecordBody } from '../../../features/effects/eventRecords.ts'
import { effectiveStaticValue, isRequiredMissing } from '../../../features/effects/rows.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { EffectDiagnostic, PropertyRow } from '../../../features/effects/types.ts'
import { rangeHint, unitSuffix } from '../../../features/effects/valueControls.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { customFieldFor, customFieldsRevision } from '../../../features/effects/customFields.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import PropertyValueForm from '../../../features/effects/panels/PropertyValueForm.vue'
import AnimationClock from './AnimationClock.vue'

const props = defineProps<{
  row: PropertyRow
  timing: ClipTiming
  playhead: number
  /** 当前片段的对象（09 自定义字段控件只读入参）。 */
  objects?: JsonObject
  /** 面板身份：09 的 OVERLAY / LETTERBOX 有帧行在属性面板只指路效果面板。 */
  panel?: 'properties' | 'effects'
  /** 本行诊断（最高级别用于边框与文案）。 */
  diagnostics: readonly EffectDiagnostic[]
  /** 由外壳决定的高亮（选中叶子 / 定位目标）。 */
  focused: boolean
}>()

const emit = defineEmits<{
  'open-event-editor': [{ clipKey: string; path: string; time: number }]
  'reveal-effects': [{ clipKey: string; path: string }]
  'focus-row': [{ path: string }]
  'enabled': [{ clipKey: string; path: string; time: number }]
  'failed': [{ clipKey: string; path: string; message: string }]
  /** 菱形建/删帧（外壳走 addKeyframe / removeKeyframe）。 */
  'toggle-keyframe': [{ clipKey: string; path: string; time: number; create: boolean }]
  /** 时钟开关动画（外壳走 enableAnimation / disableAnimation）。 */
  'toggle-animation': [{ clipKey: string; path: string; time: number; enable: boolean }]
  /** 前后帧跳转（外壳只移播放头）。 */
  'jump-keyframe': [{ clipKey: string; path: string; time: number }]
}>()

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)
/** 09：命中插件自定义字段时，用专用控件替代默认值控件。 */
const trackType = computed(() => props.row.def?.scope[0] ?? '')
const customField = computed(() => {
  void customFieldsRevision.value
  if (trackType.value === '') return undefined
  return customFieldFor(trackType.value, props.row.path)
})
/** 当前片段对象（09 控件入参；父级没传时从文档服务取只读克隆）。 */
const rowObjects = computed<JsonObject>(() => {
  if (props.objects !== undefined) return props.objects
  return documentService?.clipObjects(props.row.clipKey) ?? {}
})
/**
 * 09 用户裁决：属性面板保留全部 OVERLAY / LETTERBOX 行；有帧行的值控件改为
 * “在效果面板编辑”指路，不再重复提供值控件。
 */
const framedInEffects = computed(() => {
  if (props.row.keyframes.length === 0) return false
  const panel = props.panel ?? 'properties'
  return panel === 'properties' && (trackType.value === 'OVERLAY' || trackType.value === 'LETTERBOX')
})
const error = ref('')
const notice = ref('')

const requiredMissing = computed(() => isRequiredMissing(props.row, props.timing))
const severity = computed<EffectDiagnostic['severity'] | null>(() => props.diagnostics[0]?.severity ?? null)
const blocked = computed(() => severity.value === 'block')
const unavailable = computed(() => props.row.unavailableReason)
const readOnly = computed(() => props.row.unknown || props.row.mode === 'unknown')

const isEvent = computed(() => props.row.mode === 'event')
const isAnimated = computed(() => props.row.mode === 'animated')
const hasFrames = computed(() => props.row.keyframes.length > 0)
const isStruct = computed(() => props.row.type === 'struct' || props.row.mode === 'value' && props.row.type === 'struct')

const definition = computed(() => eventDefinition(props.row))
const recordCount = computed(() => props.row.keyframes.length)

/** 值来源文案：未设置 / 静态 / 动画轨道无帧 / 事件。 */
const valueKindLabel = computed(() => {
  if (readOnly.value) {
    return '未知路径 · 只读'
  }
  if (isEvent.value) {
    return recordCount.value === 0 ? '事件 · 暂无记录' : `事件 · ${recordCount.value} 条记录`
  }
  if (!props.row.present) {
    return '未设置'
  }
  if (isAnimated.value && !hasFrames.value) {
    return '动画轨道无帧'
  }
  return '值'
})

const hint = computed(() => {
  const parts: string[] = []
  const range = rangeHint(props.row)
  if (range !== null) {
    parts.push(range)
  }
  if (props.row.unit !== undefined) {
    parts.push(unitSuffix(props.row) === '' ? props.row.unit : unitSuffix(props.row))
  }
  if (unavailable.value !== undefined) {
    parts.push(unavailable.value)
  }
  return parts.join(' · ')
})

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

/** 空事件的首条记录：初值来自 schema，形状不合就直接报错（不写半成品）。 */
function addFirstRecord(): void {
  const seed = seedRecordBody(props.row)
  if (seed === null) {
    error.value = '未知事件路径只读：不能添加记录'
    return
  }
  const outcome = ctx.commands.commit({
    kind: 'object.addKeyframe',
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: props.playhead,
    value: seed as JsonValue,
  })
  if (!outcome.ok) {
    error.value = outcome.error ?? '添加记录被拒绝'
    return
  }
  error.value = ''
  notice.value = `已在 t=${props.playhead.toFixed(3)}s 添加首条记录`
  emit('open-event-editor', { clipKey: props.row.clipKey, path: props.row.path, time: props.playhead })
}

/** 打开记录编辑器：有记录时进第一条（或播放头命中的那条）。 */
function openEditor(): void {
  const frames = props.row.keyframes
  if (frames.length === 0) {
    addFirstRecord()
    return
  }
  const atPlayhead = frames.find((frame) => Math.abs(frame.time - props.playhead) <= 1e-4)
  const time = atPlayhead?.time ?? frames[0].time
  emit('open-event-editor', { clipKey: props.row.clipKey, path: props.row.path, time })
}

const recordEventName = computed(() => {
  if (props.row.keyframes.length === 0) {
    return definition.value.name
  }
  const first = props.row.keyframes[0]
  const body = readRecordBody(props.row, first.time)
  if (body !== null && typeof body.event_type === 'string' && body.event_type.length > 0) {
    return body.event_type
  }
  if (body !== null && typeof body.command === 'string' && body.command.length > 0) {
    return body.command
  }
  return definition.value.name
})

function focusRow(): void {
  emit('focus-row', { path: props.row.path })
}

function revealEffects(): void {
  emit('reveal-effects', { clipKey: props.row.clipKey, path: props.row.path })
}

/** 菱形：透传给外壳（外壳按 create 决定建帧还是删帧）。 */
function onToggleKeyframe(payload: { clipKey: string; path: string; time: number; create: boolean }): void {
  emit('toggle-keyframe', payload)
}

/** 时钟：透传给外壳（外壳按 enable 决定开启动画还是关闭）。 */
function onToggleAnimation(payload: { clipKey: string; path: string; time: number; enable: boolean }): void {
  emit('toggle-animation', payload)
}

/** 前后帧跳转：透传给外壳（只移播放头）。 */
function onJumpKeyframe(payload: { clipKey: string; path: string; time: number }): void {
  emit('jump-keyframe', payload)
}

function onEnabled(payload: { clipKey: string; path: string; time: number }): void {
  emit('enabled', payload)
}

function onFailed(payload: { clipKey: string; path: string; message: string }): void {
  error.value = payload.message
  emit('failed', payload)
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
    }"
    :data-path="row.path"
    :data-severity="severity ?? ''"
    tabindex="0"
    @click="focusRow"
    @focus="focusRow"
  >
    <div class="prop-row__head">
      <span class="prop-row__label" :title="row.path">{{ row.label }}</span>
      <span class="prop-row__path">{{ row.path }}</span>
      <span class="prop-row__kind">{{ valueKindLabel }}</span>
      <span v-if="requiredMissing" class="prop-row__required">必填未设置</span>
      <span v-if="unavailable !== undefined" class="prop-row__unavailable" :title="unavailable">依赖未满足</span>
    </div>

    <div class="prop-row__body">
      <!-- 未知路径：只读原始值，没有时钟、没有记录入口 -->
      <template v-if="readOnly">
        <pre class="prop-row__raw">{{ rawPreview }}</pre>
        <span class="prop-row__readonly-note">schema 未登记该路径，只能查看；可在效果面板关闭它的动画。</span>
      </template>

      <!-- 事件：记录入口 -->
      <template v-else-if="isEvent">
        <button type="button" class="prop-row__button" @click="openEditor">
          {{ recordCount === 0 ? '添加首条记录' : '编辑记录' }}
        </button>
        <span class="prop-row__record-name">{{ recordEventName }}</span>
        <span v-if="recordCount > 0" class="prop-row__count">{{ recordCount }} 条 · 在效果面板</span>
        <button
          v-if="recordCount > 0"
          type="button"
          class="prop-row__link"
          @click.stop="revealEffects"
        >
          在效果面板
        </button>
      </template>

      <!-- 值 / 结构：全部行都给值控件（有帧时控件显示并编辑播放头处的帧值） -->
      <template v-else>
        <template v-if="framedInEffects">
          <span class="prop-row__readonly-note">有 {{ row.keyframes.length }} 帧 · 值在效果面板编辑</span>
          <button type="button" class="prop-row__link" @click.stop="revealEffects">在效果面板</button>
        </template>
        <template v-else>
          <component
            :is="customField"
            v-if="customField !== undefined"
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
            :row-has-keyframes="row.keyframes.length > 0"
            :disabled="blocked || unavailable !== undefined"
            @toggle-keyframe="onToggleKeyframe"
            @toggle-animation="onToggleAnimation"
            @jump-keyframe="onJumpKeyframe"
          />
          <span v-if="hasFrames" class="prop-row__count">{{ row.keyframes.length }} 帧</span>
          <AnimationClock
            v-if="isAnimated && !isStruct && row.keyframes.length === 0"
            :row="row"
            :playhead="playhead"
            :disabled-reason="unavailable"
            @enabled="onEnabled"
            @failed="onFailed"
          />
          <span v-else-if="isAnimated && isStruct" class="prop-row__readonly-note">结构类型静态保存，没有时钟。</span>
        </template>
      </template>

      <span v-if="hint !== ''" class="prop-row__hint">{{ hint }}</span>
    </div>

    <p v-if="error !== ''" class="prop-row__error" role="alert">{{ error }}</p>
    <p v-else-if="notice !== ''" class="prop-row__notice" role="status">{{ notice }}</p>
  </div>
</template>

<style scoped>
.prop-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 3px 10px 5px;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  color: var(--text);
  font-size: 12px;
  outline: none;
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

.prop-row--required {
  border-left-color: var(--error);
}

.prop-row--blocked {
  border-left-color: var(--error);
  background: var(--error-bg);
}

.prop-row--unset .prop-row__label {
  color: var(--text-secondary);
}

.prop-row--readonly {
  opacity: 0.85;
}

.prop-row__head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.prop-row__label {
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
}

.prop-row__path {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-row__kind {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.prop-row__required {
  padding: 0 4px;
  border: 1px solid var(--error);
  border-radius: 3px;
  color: var(--error);
  font-size: 11px;
  white-space: nowrap;
}

.prop-row__unavailable {
  padding: 0 4px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 11px;
  white-space: nowrap;
}

.prop-row__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.prop-row__hint {
  flex: 1 1 100%;
  color: var(--text-muted);
  font-size: 11px;
}

.prop-row__raw {
  flex: 1 1 100%;
  margin: 0;
  padding: 4px 6px;
  max-height: 120px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre-wrap;
}

.prop-row__readonly-note {
  color: var(--text-muted);
  font-size: 11px;
}

.prop-row__button,
.prop-row__link {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.prop-row__link {
  border: none;
  color: var(--accent);
  text-decoration: underline;
}

.prop-row__button:hover,
.prop-row__link:hover {
  background: var(--bg-hover);
}

.prop-row__button:focus-visible,
.prop-row__link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.prop-row__record-name {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.prop-row__count {
  color: var(--text-muted);
  font-size: 11px;
}

.prop-row__error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
}

.prop-row__notice {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
