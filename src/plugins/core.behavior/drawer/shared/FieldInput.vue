<script setup lang="ts">
/**
 * 目录字段通用输入（11-06/07/08/09）：字段类型 / 枚举 / 取值域全部来自目录条目，
 * 组件不另存一份字段表。非法输入不夹取：解析不出有限数字时回传 `undefined`，
 * 由特征层校验在诊断区报错。
 */
import { computed } from 'vue'
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import { isJsonObject } from '../../../../core/doc/json.ts'
import { parseNumberInput, numberText } from './fields.ts'

const props = defineProps<{
  label: string
  type: 'string' | 'bool' | 'int' | 'float' | 'enum' | 'array' | 'object' | 'map' | 'unknown'
  value: JsonValue | undefined
  required?: boolean
  disabled?: boolean
  enumValues?: readonly string[]
  description?: string
  /** array 类型：通道勾选集合（enumValues 为可选项）。 */
  arrayKind?: 'channels'
}>()

const emit = defineEmits<{
  'update:value': [value: JsonValue | undefined]
}>()

const isNumber = computed(() => props.type === 'int' || props.type === 'float')

const textValue = computed(() => {
  if (isNumber.value) return numberText(props.value)
  return typeof props.value === 'string' ? props.value : ''
})

function onTextInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (isNumber.value) {
    emit('update:value', parseNumberInput(raw))
    return
  }
  emit('update:value', raw.length > 0 ? raw : undefined)
}

function onBoolInput(event: Event): void {
  emit('update:value', (event.target as HTMLInputElement).checked)
}

function onEnumInput(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  emit('update:value', raw.length > 0 ? raw : undefined)
}

const channels = computed<string[]>(() => {
  if (!Array.isArray(props.value)) return []
  return props.value.filter((item): item is string => typeof item === 'string')
})

function toggleChannel(channel: string): void {
  const current = channels.value
  const next = current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]
  emit('update:value', next.length > 0 ? next : undefined)
}

const position = computed<JsonObject>(() => (isJsonObject(props.value) ? props.value : {}))

function onPositionAxis(axis: 'x' | 'y' | 'z', event: Event): void {
  const parsed = parseNumberInput((event.target as HTMLInputElement).value)
  const next: JsonObject = { ...position.value }
  if (parsed === undefined) delete next[axis]
  else next[axis] = parsed
  emit('update:value', Object.keys(next).length > 0 ? next : undefined)
}

const readonlyObjectText = computed(() => {
  if (props.value === undefined) return '—'
  return JSON.stringify(props.value)
})
</script>

<template>
  <label class="field" :class="{ 'field--disabled': disabled }">
    <span class="field__label">
      {{ label }}
      <span v-if="required" class="field__required">*</span>
    </span>

    <input
      v-if="type === 'bool'"
      type="checkbox"
      :checked="value === true"
      :disabled="disabled"
      @change="onBoolInput"
    />

    <select v-else-if="type === 'enum'" :disabled="disabled" :value="typeof value === 'string' ? value : ''" @change="onEnumInput">
      <option value="">（未选择）</option>
      <option v-for="option in enumValues ?? []" :key="option" :value="option">{{ option }}</option>
    </select>

    <input
      v-else-if="isNumber"
      type="number"
      :step="type === 'int' ? '1' : 'any'"
      :value="textValue"
      :disabled="disabled"
      @input="onTextInput"
    />

    <div v-else-if="type === 'array' && arrayKind === 'channels'" class="field__channels">
      <label v-for="channel in enumValues ?? []" :key="channel" class="channel-option">
        <input
          type="checkbox"
          :checked="channels.includes(channel)"
          :disabled="disabled"
          @change="toggleChannel(channel)"
        />
        {{ channel }}
      </label>
    </div>

    <div v-else-if="type === 'object'" class="field__position">
      <template v-if="Object.keys(position).length > 0 || true">
        <label class="position-axis">
          x
          <input type="number" :value="numberText(position.x)" :disabled="disabled" @input="onPositionAxis('x', $event)" />
        </label>
        <label class="position-axis">
          y
          <input type="number" :value="numberText(position.y)" :disabled="disabled" @input="onPositionAxis('y', $event)" />
        </label>
        <label class="position-axis">
          z
          <input type="number" :value="numberText(position.z)" :disabled="disabled" @input="onPositionAxis('z', $event)" />
        </label>
      </template>
    </div>

    <span v-else-if="type === 'unknown' || type === 'map'" class="field__readonly">{{ readonlyObjectText }}</span>

    <input v-else type="text" :value="textValue" :disabled="disabled" @input="onTextInput" />

    <span v-if="description" class="field__description">{{ description }}</span>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}

.field--disabled {
  opacity: 0.6;
}

.field__label {
  display: flex;
  gap: 4px;
  color: var(--text-secondary);
}

.field__required {
  color: var(--danger, #c0392b);
}

.field__description {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.field__channels {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.channel-option {
  display: flex;
  align-items: center;
  gap: 4px;
}

.field__position {
  display: flex;
  gap: 8px;
}

.position-axis {
  display: flex;
  align-items: center;
  gap: 4px;
}

.field__readonly {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

input,
select {
  font: inherit;
}
</style>
