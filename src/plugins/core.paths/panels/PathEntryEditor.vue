<script setup lang="ts">
/**
 * 07-05/06/08 条目编辑器（纯展示 + 事件转发）。
 *
 * 公共字段（id / clip / from / to / axes）、几何区、timing 区、诊断展开；
 * 几何与 timing 的草稿装配走 features/paths 纯逻辑，本组件不写判定规则，
 * 保存 / 撤销由父面板接 commit。宽时左右分栏由父面板控制，本组件只管条目列。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { PathFieldIssue } from '../../../core/paths/types.ts'
import type { GeometryIssue } from '../../../core/paths/geometry.ts'
import type { TimingIssue } from '../../../core/paths/timing.ts'
import type { ClipTargetOption } from '../../../features/paths/collectionPanel.ts'
import { PATH_AXES } from '../../../core/paths/types.ts'
import {
  addNumberItem,
  addPointItem,
  blankGeometry,
  convertPointMode,
  movePointItem,
  removeNumberItem,
  removePointItem,
  type GeometryFormModel,
  type PointMode,
} from '../../../features/paths/geometryForm.ts'
import { SHAPE_ENTRIES, type ShapeEntryKind } from '../../../features/paths/shapeEntries.ts'
import {
  addPoint,
  movePoint,
  removePoint,
  resetS,
  switchToKeyframes,
  switchToLinear,
  updatePoint,
  TIMING_MAX_POINTS,
  type TimingDraft,
} from '../../../features/paths/timingEditor.ts'
import GeometryParamForm from './GeometryParamForm.vue'
import TimingEditor from './TimingEditor.vue'

const props = defineProps<{
  entry: JsonObject | null
  issues: readonly PathFieldIssue[]
  clipOptions: readonly ClipTargetOption[]
  fromOptions: readonly number[]
  /** 自动锁定的 B（A 的下一节点）；null = 无可用终点。 */
  toValue: number | null
  model: GeometryFormModel
  geometryIssues: readonly GeometryIssue[]
  timingDraft: TimingDraft
  timingIssues: readonly TimingIssue[]
  canSave: boolean
  saveReasons: readonly string[]
  disabled?: boolean
  /** 形状入口禁用原因（非空时按钮组禁用并展示原因）。 */
  shapeDisabledReason?: string
  /** 九槽取点禁用原因（服务缺失 / 库空 / 无填充槽时展示）。 */
  slotDisabledReason?: string
  /** 重采样目标点数（含首末）。 */
  resampleSamples?: number
}>()

const emit = defineEmits<{
  'update-field': [patch: Partial<JsonObject>]
  'geometry-change': [geometry: JsonObject]
  'timing-change': [draft: TimingDraft]
  'apply-shape': [kind: ShapeEntryKind]
  'resample': [samples: number]
  'pick-from-slot': []
  save: []
  cancel: []
}>()

const geometry = computed<JsonObject | undefined>(() => {
  const raw = props.entry?.geometry
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : undefined
})

const entryAxes = computed<string[]>(() => {
  const raw = props.entry?.axes
  return Array.isArray(raw) ? raw.filter((axis): axis is string => typeof axis === 'string') : [...PATH_AXES]
})

function onIdInput(event: Event): void {
  emit('update-field', { id: (event.target as HTMLInputElement).value })
}

function onClipChange(event: Event): void {
  emit('update-field', { clip: (event.target as HTMLSelectElement).value })
}

function onFromChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  emit('update-field', { from: raw === '' ? null : Number(raw) })
}

function onAxisToggle(axis: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  const next = checked
    ? [...entryAxes.value, axis]
    : entryAxes.value.filter((item) => item !== axis)
  emit('update-field', { axes: next })
}

// ── 几何区事件装配 ────────────────────────────────────────────────────────

function onGeometryTypeChange(type: string): void {
  emit('geometry-change', blankGeometry(type))
}

function onGeometryParamUpdate(key: string, value: JsonValue): void {
  emit('geometry-change', { ...(geometry.value ?? {}), [key]: value })
}

function onListOp(key: string, op: 'add' | 'remove' | 'up' | 'down', index: number): void {
  const current = geometry.value?.[key]
  let next: JsonValue
  if (op === 'add') {
    next = key === 'weights' || key === 'knots' || key === 'coefficients'
      ? addNumberItem(current)
      : addPointItem(current)
  } else if (op === 'remove') {
    next = key === 'weights' || key === 'knots' || key === 'coefficients'
      ? removeNumberItem(current, index)
      : removePointItem(current, index)
  } else {
    next = movePointItem(current, index, op === 'up' ? -1 : 1)
  }
  emit('geometry-change', { ...(geometry.value ?? {}), [key]: next })
}

function onPointMode(key: string, index: number, mode: PointMode): void {
  const current = geometry.value?.[key]
  if (index < 0) {
    emit('geometry-change', { ...(geometry.value ?? {}), [key]: convertPointMode(Array.isArray(current) ? undefined : current, mode) })
    return
  }
  const list = Array.isArray(current) ? current : []
  const next = list.map((item, itemIndex) => (
    itemIndex === index ? convertPointMode(typeof item === 'object' && item !== null ? item : undefined, mode) : item
  ))
  emit('geometry-change', { ...(geometry.value ?? {}), [key]: next })
}

// ── timing 区事件装配 ─────────────────────────────────────────────────────

function onSwitchMode(kind: 'linear' | 'keyframes'): void {
  emit('timing-change', kind === 'linear' ? switchToLinear() : switchToKeyframes(props.timingDraft))
}

function onAddPoint(afterIndex: number): void {
  const next = addPoint(props.timingDraft, afterIndex)
  if (next !== null) {
    emit('timing-change', next)
  }
}

function onRemovePoint(index: number): void {
  const next = removePoint(props.timingDraft, index)
  if (next !== null) {
    emit('timing-change', next)
  }
}

function onMovePoint(index: number, direction: -1 | 1): void {
  const next = movePoint(props.timingDraft, index, direction)
  if (next !== null) {
    emit('timing-change', next)
  }
}

function onUpdatePoint(index: number, field: 't' | 's', value: number): void {
  const next = updatePoint(props.timingDraft, index, field, value)
  if (next !== null) {
    emit('timing-change', next)
  }
}

function onResetS(): void {
  emit('timing-change', resetS(props.timingDraft))
}

// ── 12-10 曲线工具：形状入口 / 弧长重采样 / 九槽占位 ────────────────────────

const shapeEntries = SHAPE_ENTRIES
const resampleSampleCount = ref(props.resampleSamples ?? 8)

function onApplyShape(kind: ShapeEntryKind): void {
  emit('apply-shape', kind)
}

function onResample(): void {
  const samples = Math.round(resampleSampleCount.value)
  emit('resample', Number.isFinite(samples) ? samples : 8)
}

function onPickFromSlot(): void {
  emit('pick-from-slot')
}

const geometryIssueMessages = computed(() => props.geometryIssues.map((issue) => issue.message))
const timingIssueMessages = computed(() => props.timingIssues.map((issue) => issue.message))

function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
</script>

<template>
  <div class="entry-editor">
    <div v-if="props.entry === null" class="entry-editor__empty">
      选择一条路径查看 / 编辑；或点击「新建路径」。
    </div>

    <template v-else>
      <div class="entry-editor__section">
        <div class="entry-editor__row">
          <label class="entry-editor__label" for="path-id">id</label>
          <input
            id="path-id"
            class="entry-editor__input"
            type="text"
            :value="String(props.entry.id ?? '')"
            :disabled="props.disabled"
            @input="onIdInput"
          />
        </div>
        <div class="entry-editor__row">
          <label class="entry-editor__label" for="path-clip">片段</label>
          <select
            id="path-clip"
            class="entry-editor__select"
            :value="String(props.entry.clip ?? '')"
            :disabled="props.disabled"
            @change="onClipChange"
          >
            <option v-for="option in props.clipOptions" :key="option.label" :value="option.clipId ?? ''" :disabled="option.disabledReason !== null">
              {{ option.label }}{{ option.disabledReason !== null ? `（${option.disabledReason}）` : '' }}
            </option>
          </select>
        </div>
        <div class="entry-editor__row">
          <label class="entry-editor__label" for="path-from">起点 A</label>
          <select
            id="path-from"
            class="entry-editor__select"
            :value="Number(props.entry.from)"
            :disabled="props.disabled"
            @change="onFromChange"
          >
            <option v-for="option in props.fromOptions" :key="option" :value="option">{{ formatTime(option) }}</option>
          </select>
          <label class="entry-editor__label">终点 B</label>
          <span class="entry-editor__readonly">{{ formatTime(props.toValue) }}</span>
        </div>
        <div class="entry-editor__row">
          <span class="entry-editor__label">axes</span>
          <label v-for="axis in PATH_AXES" :key="axis" class="entry-editor__axis">
            <input
              type="checkbox"
              :checked="entryAxes.includes(axis)"
              :disabled="props.disabled"
              @change="onAxisToggle(axis, $event)"
            />
            {{ axis }}
          </label>
        </div>
      </div>

      <div class="entry-editor__section">
        <div class="entry-editor__row">
          <span class="entry-editor__label">形状</span>
          <button
            v-for="entry in shapeEntries"
            :key="entry.kind"
            type="button"
            class="entry-editor__button"
            :disabled="props.disabled || !!props.shapeDisabledReason"
            @click="onApplyShape(entry.kind)"
          >
            {{ entry.label }}
          </button>
          <button
            type="button"
            class="entry-editor__button"
            :disabled="props.disabled || !!props.slotDisabledReason"
            :title="props.slotDisabledReason ?? ''"
            @click="onPickFromSlot"
          >
            从九槽取点
          </button>
        </div>
        <p v-if="props.shapeDisabledReason" class="entry-editor__reason">{{ props.shapeDisabledReason }}</p>
        <p v-if="props.slotDisabledReason" class="entry-editor__reason">{{ props.slotDisabledReason }}</p>
      </div>

      <div class="entry-editor__section">
        <h3 class="entry-editor__heading">几何</h3>
        <GeometryParamForm
          :model="props.model"
          :geometry="geometry"
          :issues="props.geometryIssues"
          :disabled="props.disabled"
          @change-type="onGeometryTypeChange"
          @update-param="onGeometryParamUpdate"
          @list-op="onListOp"
          @point-mode="onPointMode"
        />
      </div>

      <div class="entry-editor__section">
        <h3 class="entry-editor__heading">时间映射</h3>
        <div class="entry-editor__row">
          <label class="entry-editor__label" for="resample-count">重采样点</label>
          <input
            id="resample-count"
            class="entry-editor__input"
            type="number"
            min="2"
            :max="TIMING_MAX_POINTS"
            v-model.number="resampleSampleCount"
            :disabled="props.disabled"
          />
          <button
            type="button"
            class="entry-editor__button"
            :disabled="props.disabled"
            @click="onResample"
          >
            按弧长重采样
          </button>
        </div>
        <p class="entry-editor__note">预览为近似，最终以游戏播放为准。</p>
        <TimingEditor
          :draft="props.timingDraft"
          :issues="props.timingIssues"
          :disabled="props.disabled"
          @switch-mode="onSwitchMode"
          @add-point="onAddPoint"
          @remove-point="onRemovePoint"
          @move-point="onMovePoint"
          @update-point="onUpdatePoint"
          @reset-s="onResetS"
        />
      </div>

      <div v-if="props.issues.length > 0 || geometryIssueMessages.length > 0 || timingIssueMessages.length > 0" class="entry-editor__diagnostics">
        <h3 class="entry-editor__heading">诊断</h3>
        <p v-for="issue in props.issues" :key="issue.field" class="entry-editor__diagnostic">
          <code>{{ issue.field }}</code> {{ issue.message }}
        </p>
        <p v-for="message in geometryIssueMessages" :key="`g-${message}`" class="entry-editor__diagnostic">
          {{ message }}
        </p>
        <p v-for="message in timingIssueMessages" :key="`t-${message}`" class="entry-editor__diagnostic">
          {{ message }}
        </p>
      </div>

      <div class="entry-editor__footer">
        <p v-for="reason in props.saveReasons" :key="reason" class="entry-editor__reason">{{ reason }}</p>
        <button
          type="button"
          class="entry-editor__button"
          :disabled="!props.canSave || props.disabled"
          @click="emit('save')"
        >
          保存
        </button>
        <button type="button" class="entry-editor__button" :disabled="props.disabled" @click="emit('cancel')">
          取消
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.entry-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  overflow-y: auto;
  min-height: 0;
}

.entry-editor__empty {
  padding: 12px 10px;
  color: var(--text-muted);
  font-size: 11px;
}

.entry-editor__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.entry-editor__heading {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.entry-editor__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.entry-editor__label {
  flex: 0 0 70px;
  color: var(--text-secondary);
  font-size: 11px;
}

.entry-editor__input,
.entry-editor__select {
  min-width: 90px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  font-family: var(--font-mono);
}

.entry-editor__readonly {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.entry-editor__axis {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-mono);
}

.entry-editor__diagnostics {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--error);
  border-radius: 3px;
  background: var(--error-bg);
}

.entry-editor__diagnostic {
  margin: 0;
  color: var(--error);
  font-size: 11px;
}

.entry-editor__diagnostic code {
  font-family: var(--font-mono);
}

.entry-editor__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.entry-editor__reason {
  flex: 1 1 100%;
  margin: 0;
  color: var(--warning);
  font-size: 11px;
}

.entry-editor__note {
  flex: 1 1 100%;
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.entry-editor__button {
  padding: 2px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.entry-editor__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.entry-editor__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
