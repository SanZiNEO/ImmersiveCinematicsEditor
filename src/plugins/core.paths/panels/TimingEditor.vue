<script setup lang="ts">
/**
 * 07-08 时间映射编辑器（纯展示 + 事件转发）。
 *
 * 点表操作 / 上限 / 校验映射 / s(t) 采样都在 `features/paths/timingEditor.ts`；
 * 本组件只渲染：模式切换、点表、只读 s(t) 折线小图。三位小数显示，底层存原值。
 */
import { computed } from 'vue'
import type { TimingIssue } from '../../../core/paths/timing.ts'
import {
  draftSamples,
  isFixedEndpoint,
  TIMING_MAX_POINTS,
  type TimingDraft,
} from '../../../features/paths/timingEditor.ts'

const props = defineProps<{
  draft: TimingDraft
  issues: readonly TimingIssue[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'switch-mode': [kind: 'linear' | 'keyframes']
  'add-point': [afterIndex: number]
  'remove-point': [index: number]
  'move-point': [index: number, direction: -1 | 1]
  'update-point': [index: number, field: 't' | 's', value: number]
  'reset-s': []
}>()

const samples = computed(() => draftSamples(props.draft, 33))

const chartPolyline = computed(() => {
  const width = 100
  const height = 60
  return samples.value
    .map((sample) => `${(sample.u * width).toFixed(2)},${(height - sample.s * height).toFixed(2)}`)
    .join(' ')
})

function pointIssues(index: number, field: 't' | 's'): string[] {
  const suffix = `points[${index}].${field}`
  return props.issues
    .filter((issue) => issue.field.replace(/^timing\./, '') === suffix)
    .map((issue) => issue.message)
}

function onFieldInput(index: number, field: 't' | 's', event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  emit('update-point', index, field, raw === '' ? Number.NaN : Number(raw))
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }
  return value.toFixed(3)
}

function fixedLabel(index: number): string | null {
  if (props.draft.points.length === 0) {
    return null
  }
  if (index === 0) {
    return '首点固定'
  }
  if (index === props.draft.points.length - 1) {
    return '末点固定'
  }
  return null
}
</script>

<template>
  <div class="timing-editor">
    <div class="timing-editor__modes" role="tablist" aria-label="时间映射模式">
      <button
        type="button"
        class="timing-editor__mode"
        :class="{ 'timing-editor__mode--active': props.draft.kind === 'linear' }"
        :aria-pressed="props.draft.kind === 'linear'"
        :disabled="props.disabled"
        @click="emit('switch-mode', 'linear')"
      >
        线性
      </button>
      <button
        type="button"
        class="timing-editor__mode"
        :class="{ 'timing-editor__mode--active': props.draft.kind === 'keyframes' }"
        :aria-pressed="props.draft.kind === 'keyframes'"
        :disabled="props.disabled"
        @click="emit('switch-mode', 'keyframes')"
      >
        关键帧
      </button>
      <span class="timing-editor__count" v-if="props.draft.kind === 'keyframes'">
        {{ props.draft.points.length }} / {{ TIMING_MAX_POINTS }} 点
      </span>
    </div>

    <template v-if="props.draft.kind === 'keyframes'">
      <svg class="timing-editor__chart" viewBox="0 0 100 60" preserveAspectRatio="none" aria-label="s(t) 折线">
        <line x1="0" y1="60" x2="100" y2="60" stroke="var(--border-strong)" stroke-width="0.5" />
        <line x1="0" y1="0" x2="0" y2="60" stroke="var(--border-strong)" stroke-width="0.5" />
        <polyline :points="chartPolyline" fill="none" stroke="var(--accent)" stroke-width="1.2" />
      </svg>

      <div class="timing-editor__table">
        <div class="timing-editor__row timing-editor__row--head">
          <span>#</span>
          <span>t</span>
          <span>s</span>
          <span class="timing-editor__actions" />
        </div>
        <div
          v-for="(point, index) in props.draft.points"
          :key="index"
          class="timing-editor__row"
          :class="{ 'timing-editor__row--fixed': isFixedEndpoint(index, props.draft.points.length) }"
        >
          <span class="timing-editor__index">{{ index + 1 }}</span>
          <label class="timing-editor__field">
            <input
              type="number"
              step="0.001"
              :value="formatValue(point.t)"
              :disabled="props.disabled || isFixedEndpoint(index, props.draft.points.length)"
              @input="onFieldInput(index, 't', $event)"
            />
            <span v-for="message in pointIssues(index, 't')" :key="message" class="timing-editor__error">{{ message }}</span>
          </label>
          <label class="timing-editor__field">
            <input
              type="number"
              step="0.001"
              :value="formatValue(point.s)"
              :disabled="props.disabled || isFixedEndpoint(index, props.draft.points.length)"
              @input="onFieldInput(index, 's', $event)"
            />
            <span v-for="message in pointIssues(index, 's')" :key="message" class="timing-editor__error">{{ message }}</span>
          </label>
          <span class="timing-editor__actions">
            <span v-if="fixedLabel(index)" class="timing-editor__fixed">{{ fixedLabel(index) }}</span>
            <button
              type="button"
              class="timing-editor__button"
              :disabled="props.disabled || index === 0"
              @click="emit('move-point', index, -1)"
            >↑</button>
            <button
              type="button"
              class="timing-editor__button"
              :disabled="props.disabled || index === props.draft.points.length - 1"
              @click="emit('move-point', index, 1)"
            >↓</button>
            <button
              type="button"
              class="timing-editor__button"
              :disabled="props.disabled || isFixedEndpoint(index, props.draft.points.length)"
              @click="emit('remove-point', index)"
            >删除</button>
            <button
              type="button"
              class="timing-editor__button"
              :disabled="props.disabled || index === props.draft.points.length - 1"
              @click="emit('add-point', index)"
            >插入后</button>
          </span>
        </div>
      </div>

      <div class="timing-editor__footer">
        <button type="button" class="timing-editor__button" :disabled="props.disabled" @click="emit('reset-s')">
          按弧长复位 s
        </button>
      </div>
    </template>

    <p v-else class="timing-editor__readonly-note">线性时间映射：s(u) = u，不写点表。</p>
  </div>
</template>

<style scoped>
.timing-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timing-editor__modes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.timing-editor__mode {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.timing-editor__mode--active {
  border-color: var(--accent);
  color: var(--accent);
}

.timing-editor__count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.timing-editor__chart {
  width: 100%;
  height: 60px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
}

.timing-editor__table {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.timing-editor__row {
  display: grid;
  grid-template-columns: 24px 1fr 1fr auto;
  align-items: center;
  gap: 6px;
}

.timing-editor__row--head {
  color: var(--text-muted);
  font-size: 11px;
}

.timing-editor__row--fixed {
  opacity: 0.85;
}

.timing-editor__index {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.timing-editor__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timing-editor__field input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  font-family: var(--font-mono);
}

.timing-editor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: flex-end;
}

.timing-editor__fixed {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.timing-editor__button {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.timing-editor__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.timing-editor__error {
  color: var(--error);
  font-size: 10px;
}

.timing-editor__footer {
  display: flex;
  justify-content: flex-end;
}

.timing-editor__readonly-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
