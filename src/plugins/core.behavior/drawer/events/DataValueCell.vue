<script setup lang="ts">
/**
 * 单个 data 值的编辑器：按真实类型给控件；对象 / 数组折叠嵌套编辑。
 * 与 `DataObjectEditor` 互相递归；只在 `drawer/events/**` 内使用。
 */
import { computed, ref, watch } from 'vue'
import type { JsonArray, JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import { cloneJson } from '../../../../core/doc/json.ts'
import { coerceText, emptyValue, kindOf, type DataEntry, type DataValueKind } from './dataEditing.ts'
import DataObjectEditor from './DataObjectEditor.vue'

const props = defineProps<{
  value: JsonValue
  depth?: number
}>()

const emit = defineEmits<{
  update: [value: JsonValue]
}>()

const depth = computed(() => props.depth ?? 0)

const kind = computed<DataValueKind>(() => kindOf(props.value))

const textDraft = ref('')
const boolDraft = ref(false)
const collapsed = ref(true)

function syncDrafts(): void {
  textDraft.value = typeof props.value === 'string'
    ? props.value
    : typeof props.value === 'number'
      ? String(props.value)
      : ''
  boolDraft.value = props.value === true
}

watch(() => props.value, syncDrafts, { immediate: true })

function changeKind(next: DataValueKind): void {
  emit('update', emptyValue(next))
}

function commitText(): void {
  const coerced = coerceText(kind.value, textDraft.value)
  if (coerced !== null) {
    emit('update', coerced)
  }
}

function toggleBoolean(): void {
  emit('update', !boolDraft.value)
}

function updateNestedObject(next: JsonObject): void {
  emit('update', next)
}

function arrayValue(): JsonArray {
  return Array.isArray(props.value) ? (props.value as JsonArray) : []
}

function updateElement(index: number, next: JsonValue): void {
  const nextArray = arrayValue().slice()
  nextArray[index] = next
  emit('update', nextArray)
}

function removeElement(index: number): void {
  const nextArray = arrayValue().slice()
  nextArray.splice(index, 1)
  emit('update', nextArray)
}

function addElement(): void {
  const nextArray = arrayValue().slice()
  nextArray.push('')
  emit('update', nextArray)
}

function nestedEntries(): DataEntry[] {
  return arrayValue().map((item, index) => ({ key: String(index), value: item }))
}

const isObjectValue = computed(() => kind.value === 'object')
const isArrayValue = computed(() => kind.value === 'array')

function cloneForChild(source: JsonValue): JsonValue {
  return cloneJson(source)
}
</script>

<template>
  <div class="data-cell" :class="`data-cell--${kind}`">
    <div class="data-cell__head">
      <select
        class="data-cell__select"
        :value="kind"
        :aria-label="`值类型 ${kind}`"
        @change="changeKind(($event.target as HTMLSelectElement).value as DataValueKind)"
      >
        <option value="string">文本</option>
        <option value="number">数字</option>
        <option value="boolean">布尔</option>
        <option value="null">null</option>
        <option value="object">对象</option>
        <option value="array">数组</option>
      </select>

      <input
        v-if="kind === 'string'"
        class="data-cell__input"
        :value="textDraft"
        @input="textDraft = ($event.target as HTMLInputElement).value"
        @blur="commitText"
      />
      <input
        v-else-if="kind === 'number'"
        class="data-cell__input data-cell__input--number"
        type="number"
        step="any"
        :value="textDraft"
        @input="textDraft = ($event.target as HTMLInputElement).value"
        @blur="commitText"
      />
      <label v-else-if="kind === 'boolean'" class="data-cell__bool">
        <input
          type="checkbox"
          :checked="boolDraft"
          @change="toggleBoolean"
        />
        {{ boolDraft ? 'true' : 'false' }}
      </label>
      <span v-else-if="kind === 'null'" class="data-cell__null">null</span>

      <button
        v-if="isObjectValue || isArrayValue"
        type="button"
        class="data-cell__collapse"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▸ 展开' : '▾ 收起' }}
      </button>
    </div>

    <div v-if="isObjectValue && !collapsed" class="data-cell__nested">
      <DataObjectEditor
        :value="cloneForChild(props.value) as JsonObject"
        :depth="depth + 1"
        @apply="updateNestedObject"
      />
    </div>

    <div v-if="isArrayValue && !collapsed" class="data-cell__nested">
      <div v-for="entry in nestedEntries()" :key="entry.key" class="data-cell__array-row">
        <span class="data-cell__array-index">[{{ entry.key }}]</span>
        <DataValueCell
          :value="entry.value"
          :depth="depth + 1"
          @update="updateElement(Number(entry.key), $event)"
        />
        <button type="button" class="data-cell__remove" @click="removeElement(Number(entry.key))">删</button>
      </div>
      <button type="button" class="data-cell__add" @click="addElement">+ 元素</button>
    </div>
  </div>
</template>

<style scoped>
.data-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.data-cell__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.data-cell__select,
.data-cell__input {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}

.data-cell__input {
  min-width: 120px;
}

.data-cell__bool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.data-cell__null {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-muted);
}

.data-cell__collapse {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.data-cell__nested {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}

.data-cell__array-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
}

.data-cell__array-index {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-muted);
  padding-top: 4px;
}

.data-cell__remove,
.data-cell__add {
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.data-cell__add {
  align-self: flex-start;
}
</style>
