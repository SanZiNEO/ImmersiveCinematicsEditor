<script setup lang="ts">
/**
 * 渐变定义控件（09-02 §4.3）。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import {
  GRADIENT_TYPES,
  appendGradientStop,
  defaultGradient,
  gradientState,
  normalizeHexColor,
  removeGradientRemovePaths,
  removeGradientStop,
  updateGradientStop,
  validateGradientValue,
} from '../../../features/overlay/colorMask.ts'
import type { GradientStruct } from '../../../features/overlay/layers.ts'
import { explicitValue } from '../../../features/overlay/layers.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { ensureExplicitLayerTypeCommands } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')
const notice = ref('')

const state = computed(() => gradientState(props.objects))
const raw = computed<JsonObject | null>(() => {
  const value = explicitValue(props.objects, 'gradient')
  return value.present && isJsonObject(value.value) ? value.value : null
})
const struct = computed<GradientStruct | null>(() => state.value.struct)
const issues = computed(() => validateGradientValue(explicitValue(props.objects, 'gradient').value))
const stops = computed<JsonObject[]>(() => {
  const list = raw.value?.stops
  return Array.isArray(list) ? list.filter(isJsonObject) : []
})
const hasGradient = computed(() => state.value.present)
const previewCss = computed(() => {
  const value = struct.value
  if (value === null || value.stops.length === 0) return '#000000'
  const stops = value.stops
    .map((stop) => `${stop.color} ${Math.max(0, Math.min(1, stop.offset)) * 100}%`)
    .join(', ')
  if (value.type === 'radial') {
    const cx = Math.max(0, Math.min(1, numberValue(props.objects, 'gradient_center_x', 0.5)) * 100)
    const cy = Math.max(0, Math.min(1, numberValue(props.objects, 'gradient_center_y', 0.5)) * 100)
    return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`
  }
  return `linear-gradient(${numberValue(props.objects, 'gradient_angle', 0)}deg, ${stops})`
})

function numberValue(objects: JsonObject, path: string, fallback: number): number {
  const explicit = explicitValue(objects, path)
  return explicit.present && typeof explicit.value === 'number' && Number.isFinite(explicit.value)
    ? explicit.value
    : fallback
}

function cloneRaw(): JsonObject {
  const value = raw.value
  if (value === null) return {}
  const copy: JsonObject = {}
  for (const [key, item] of Object.entries(value)) {
    copy[key] = isJsonObject(item)
      ? { ...item }
      : Array.isArray(item)
        ? item.map((entry) => (isJsonObject(entry) ? { ...entry } : entry)) as JsonValue
        : item
  }
  return copy
}

function writeGradient(next: JsonObject, remove: readonly string[] = []): boolean {
  if (props.disabled) return false
  const validation = validateGradientValue(next)
  if (validation.length > 0) {
    error.value = validation.map((issue) => `${issue.path}: ${issue.message}`).join('；')
    return false
  }
  const commands: import('../../../core/doc/commands.ts').DocCommand[] = [
    ...ensureExplicitLayerTypeCommands(props.row.clipKey, props.objects, 'gradient'),
    { kind: 'object.setValue', clipKey: props.row.clipKey, path: 'gradient', value: next },
  ]
  for (const path of remove) {
    commands.push({ kind: 'object.remove', clipKey: props.row.clipKey, path })
  }
  const outcome = ctx.commands.commitBatch(commands, `overlay-gradient:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '渐变写入失败'
    return false
  }
  error.value = ''
  return true
}

function addGradient(): void {
  if (writeGradient({ ...defaultGradient() })) {
    notice.value = '已添加线性渐变（黑 → 白）；渐变几何按缺省显示'
  }
}

function deleteGradient(): void {
  if (props.disabled) return
  const commands: import('../../../core/doc/commands.ts').DocCommand[] = [
    ...ensureExplicitLayerTypeCommands(props.row.clipKey, props.objects, 'gradient'),
    ...removeGradientRemovePaths().map((path): import('../../../core/doc/commands.ts').DocCommand =>
      ({ kind: 'object.remove', clipKey: props.row.clipKey, path })),
  ]
  const outcome = ctx.commands.commitBatch(commands, `overlay-gradient-remove:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '删除渐变失败'
    return
  }
  error.value = ''
  notice.value = '已删除渐变定义与全部渐变几何（一次撤销可回退）'
}

function changeType(event: Event): void {
  const type = (event.target as HTMLSelectElement).value
  if (type !== 'linear' && type !== 'radial') return
  const next = cloneRaw()
  next.type = type
  const remove = type === 'linear' ? ['gradient_radius'] : ['gradient_angle']
  if (writeGradient(next, remove)) {
    notice.value = `已切换为 ${type}：${type === 'linear' ? '已移除 gradient_radius' : '已移除 gradient_angle'}`
  }
}

function changeStop(index: number, patch: { offset?: number; color?: string }): void {
  if (struct.value === null) return
  const next = cloneRaw()
  const list = Array.isArray(next.stops) ? next.stops.filter(isJsonObject) : []
  const current = list[index]
  if (current === undefined) return
  const updated = updateGradientStop(struct.value, index, patch)
  list[index] = {
    ...current,
    offset: updated.stops[index]?.offset ?? current.offset,
    color: updated.stops[index]?.color ?? current.color,
  }
  next.stops = list as unknown as JsonValue
  if (writeGradient(next)) {
    notice.value = `已更新色标 #${index + 1}`
  }
}

function changeStopOffset(index: number, event: Event): void {
  const text = (event.target as HTMLInputElement).value.trim()
  if (text === '') {
    error.value = `色标 #${index + 1} 的 offset 不能为空`
    return
  }
  changeStop(index, { offset: Number(text) })
}

function addStop(): void {
  if (struct.value === null) return
  const lastColor = struct.value.stops[struct.value.stops.length - 1]?.color ?? '#ffffff'
  const nextStruct = appendGradientStop(struct.value, lastColor)
  const next = cloneRaw()
  const original = Array.isArray(next.stops) ? next.stops.filter(isJsonObject) : []
  // 按 offset 找回原色标（插入中点会移位，不能按下标比对），保留其未知键；新项只写 offset/color。
  const list = nextStruct.stops.map((entry) => {
    const previous = original.find((item) => item.offset === entry.offset)
    if (previous !== undefined && previous.color === entry.color) {
      return previous
    }
    return { offset: entry.offset as JsonValue, color: entry.color as JsonValue }
  })
  next.stops = list as unknown as JsonValue
  if (writeGradient(next)) {
    notice.value = `已追加色标（共 ${list.length} 个）`
  }
}

function removeStopAt(index: number): void {
  if (struct.value === null) return
  const result = removeGradientStop(struct.value, index)
  if (!result.ok) {
    error.value = result.message
    return
  }
  const next = cloneRaw()
  const list = Array.isArray(next.stops) ? next.stops.filter(isJsonObject) : []
  list.splice(index, 1)
  next.stops = list as unknown as JsonValue
  if (writeGradient(next)) {
    notice.value = `已删除色标 #${index + 1}（保留 ${list.length} 个）`
  }
}
</script>

<template>
  <div class="overlay-gradient">
    <div v-if="!hasGradient" class="overlay-gradient__empty">
      <span>未声明渐变：当前按纯色渲染。</span>
      <button type="button" :disabled="disabled" @click="addGradient">添加渐变</button>
    </div>

    <template v-else>
      <div class="overlay-gradient__bar">
        <label>
          类型
          <select :value="struct?.type ?? ''" :disabled="disabled" @change="changeType">
            <option v-for="type in GRADIENT_TYPES" :key="type" :value="type">{{ type }}</option>
          </select>
        </label>
        <button type="button" :disabled="disabled" @click="addStop">追加色标</button>
        <button type="button" class="overlay-gradient__delete" :disabled="disabled" @click="deleteGradient">
          删除渐变
        </button>
      </div>

      <div class="overlay-gradient__preview" :style="{ background: previewCss }" aria-label="渐变示意（非像素预览）" />

      <p v-if="issues.length > 0" class="overlay-gradient__issues" role="alert">
        {{ issues.map((issue) => `${issue.path}: ${issue.message}`).join('；') }}
      </p>

      <ol class="overlay-gradient__stops">
        <li v-for="(stop, index) in stops" :key="index" class="overlay-gradient__stop">
          <span class="overlay-gradient__index">#{{ index + 1 }}</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            :value="typeof stop.offset === 'number' ? stop.offset : 0"
            :disabled="disabled"
            aria-label="色标偏移"
            @change="changeStopOffset(index, $event)"
          >
          <input
            type="color"
            :value="normalizeHexColor(typeof stop.color === 'string' ? stop.color : '#ffffff') ?? '#ffffff'"
            :disabled="disabled"
            aria-label="色标颜色"
            @change="changeStop(index, { color: ($event.target as HTMLInputElement).value })"
          >
          <code>{{ typeof stop.color === 'string' ? stop.color : '' }}</code>
          <button
            type="button"
            :disabled="disabled || stops.length <= 2"
            :title="stops.length <= 2 ? '渐变至少需要 2 个色标' : '删除该色标'"
            @click="removeStopAt(index)"
          >
            删除
          </button>
        </li>
      </ol>
      <p class="overlay-gradient__hint">
        偏移必须 0~1 且严格递增；首尾不必 0/1；越界会被拒绝（模组 ColorMaskSpec 直接报错，不做端点钳制）；色标颜色没有 alpha。
      </p>
    </template>

    <p v-if="notice !== ''" class="overlay-gradient__ok" role="status">{{ notice }}</p>
    <p v-if="error !== ''" class="overlay-gradient__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.overlay-gradient {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overlay-gradient__empty,
.overlay-gradient__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-gradient__empty button,
.overlay-gradient__bar button {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-gradient__delete {
  color: var(--error) !important;
  border-color: var(--error) !important;
}

.overlay-gradient__issues,
.overlay-gradient__error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
}

.overlay-gradient__preview {
  height: 10px;
  border: 1px solid var(--border);
  border-radius: 2px;
}

.overlay-gradient__ok {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-gradient__stops {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding-left: 18px;
}

.overlay-gradient__stop {
  display: flex;
  align-items: center;
  gap: 5px;
}

.overlay-gradient__index {
  min-width: 22px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.overlay-gradient__stop input[type='number'] {
  width: 62px;
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-gradient__stop code {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.overlay-gradient__stop button {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.overlay-gradient__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
