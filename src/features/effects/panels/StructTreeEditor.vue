<script setup lang="ts">
/**
 * 结构值的树编辑（06-03 §三）：`struct` 类型的第二种入口。
 *
 * 只做"值的结构化编辑"：每个叶子按自身 JSON 类型给控件，每次叶子变化把整棵新值抛给调用方。
 * 不重排键、不补默认、不删空数组；未知键原样保留，只有作者显式删除才消失。
 */
import { computed, ref } from 'vue'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonValue } from '../../../core/doc/types.ts'

const props = defineProps<{
  value: JsonValue
  depth?: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  change: [value: JsonValue]
}>()

const depth = computed(() => props.depth ?? 0)
const kind = computed<'object' | 'array' | 'scalar'>(() => {
  if (Array.isArray(props.value)) {
    return 'array'
  }
  if (isJsonObject(props.value)) {
    return 'object'
  }
  return 'scalar'
})

const entries = computed<Array<{ key: string; value: JsonValue }>>(() => {
  if (!isJsonObject(props.value)) {
    return []
  }
  return Object.entries(props.value).map(([key, value]) => ({ key, value }))
})

const items = computed<JsonValue[]>(() => (Array.isArray(props.value) ? props.value : []))

const newKey = ref('')
const newKeyError = ref('')

function clone(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function replaceChild(key: string, next: JsonValue): void {
  if (!isJsonObject(props.value)) {
    return
  }
  const draft = clone(props.value) as { [key: string]: JsonValue }
  draft[key] = next
  emit('change', draft)
}

function removeChild(key: string): void {
  if (!isJsonObject(props.value)) {
    return
  }
  const draft = clone(props.value) as { [key: string]: JsonValue }
  delete draft[key]
  emit('change', draft)
}

function replaceItem(index: number, next: JsonValue): void {
  if (!Array.isArray(props.value)) {
    return
  }
  const draft = clone(props.value) as JsonValue[]
  draft[index] = next
  emit('change', draft)
}

function removeItem(index: number): void {
  if (!Array.isArray(props.value)) {
    return
  }
  const draft = clone(props.value) as JsonValue[]
  draft.splice(index, 1)
  emit('change', draft)
}

function appendItem(): void {
  if (!Array.isArray(props.value)) {
    return
  }
  const draft = clone(props.value) as JsonValue[]
  draft.push(null)
  emit('change', draft)
}

function addKey(): void {
  if (!isJsonObject(props.value)) {
    return
  }
  const key = newKey.value.trim()
  if (key.length === 0) {
    newKeyError.value = '键不能为空'
    return
  }
  if (Object.prototype.hasOwnProperty.call(props.value, key)) {
    newKeyError.value = '该键已存在'
    return
  }
  newKeyError.value = ''
  const draft = clone(props.value) as { [key: string]: JsonValue }
  draft[key] = null
  newKey.value = ''
  emit('change', draft)
}

/** 标量值类型：决定控件形态，不做隐式转换。 */
const scalarType = computed<'string' | 'number' | 'boolean' | 'null'>(() => {
  if (props.value === null) {
    return 'null'
  }
  if (typeof props.value === 'boolean') {
    return 'boolean'
  }
  if (typeof props.value === 'number') {
    return 'number'
  }
  return 'string'
})

const scalarText = ref('')
const scalarEditing = ref(false)

function scalarDraft(): string {
  if (props.value === null) {
    return ''
  }
  if (typeof props.value === 'string') {
    return props.value
  }
  return String(props.value)
}

function beginScalar(): void {
  if (scalarEditing.value) {
    return
  }
  scalarText.value = scalarDraft()
  scalarEditing.value = true
}

function commitScalar(): void {
  scalarEditing.value = false
  if (props.disabled === true) {
    return
  }
  if (scalarType.value === 'null') {
    return
  }
  if (scalarType.value === 'boolean') {
    const next = scalarText.value === 'true'
    emit('change', next)
    return
  }
  if (scalarType.value === 'number') {
    const parsed = Number(scalarText.value.trim())
    if (!Number.isFinite(parsed)) {
      return
    }
    emit('change', parsed)
    return
  }
  emit('change', scalarText.value)
}

function switchScalarType(next: string): void {
  if (next === 'null') {
    emit('change', null)
    return
  }
  if (next === 'boolean') {
    emit('change', true)
    return
  }
  if (next === 'number') {
    emit('change', 0)
    return
  }
  emit('change', '')
}

function describeValue(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.length}]`
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value).length}}`
  }
  return JSON.stringify(value) ?? 'null'
}
</script>

<template>
  <div class="struct-tree" :data-depth="depth">
    <template v-if="kind === 'object'">
      <div v-for="entry in entries" :key="entry.key" class="struct-tree__row">
        <code class="struct-tree__key" :title="entry.key">{{ entry.key }}</code>
        <div class="struct-tree__value">
          <StructTreeEditor
            v-if="Array.isArray(entry.value) || isJsonObject(entry.value)"
            :value="entry.value"
            :depth="depth + 1"
            :disabled="disabled"
            @change="(next) => replaceChild(entry.key, next)"
          />
          <StructTreeEditor
            v-else
            :value="entry.value"
            :depth="depth + 1"
            :disabled="disabled"
            @change="(next) => replaceChild(entry.key, next)"
          />
        </div>
        <button
          type="button"
          class="struct-tree__remove"
          :disabled="disabled === true"
          :title="`删除键 ${entry.key}`"
          @click="removeChild(entry.key)"
        >
          ×
        </button>
      </div>
      <div class="struct-tree__add">
        <input
          v-model="newKey"
          class="struct-tree__input"
          type="text"
          placeholder="新键"
          :disabled="disabled === true"
          @keydown.enter.prevent="addKey"
        >
        <button type="button" class="struct-tree__button" :disabled="disabled === true" @click="addKey">添加键</button>
        <span v-if="newKeyError !== ''" class="struct-tree__error">{{ newKeyError }}</span>
      </div>
    </template>

    <template v-else-if="kind === 'array'">
      <div v-for="(item, index) in items" :key="index" class="struct-tree__row">
        <code class="struct-tree__key">[{{ index }}]</code>
        <div class="struct-tree__value">
          <StructTreeEditor
            :value="item"
            :depth="depth + 1"
            :disabled="disabled"
            @change="(next) => replaceItem(index, next)"
          />
        </div>
        <button
          type="button"
          class="struct-tree__remove"
          :disabled="disabled === true"
          :title="`删除第 ${index} 项`"
          @click="removeItem(index)"
        >
          ×
        </button>
      </div>
      <div class="struct-tree__add">
        <button type="button" class="struct-tree__button" :disabled="disabled === true" @click="appendItem">
          追加项
        </button>
      </div>
    </template>

    <div v-else class="struct-tree__scalar">
      <select
        class="struct-tree__type"
        :value="scalarType"
        :disabled="disabled === true"
        aria-label="值类型"
        @change="switchScalarType(($event.target as HTMLSelectElement).value)"
      >
        <option value="string">文本</option>
        <option value="number">数字</option>
        <option value="boolean">布尔</option>
        <option value="null">空</option>
      </select>
      <template v-if="scalarType === 'null'">
        <span class="struct-tree__null">null</span>
      </template>
      <select
        v-else-if="scalarType === 'boolean'"
        class="struct-tree__input"
        :value="String(props.value)"
        :disabled="disabled === true"
        @change="emit('change', ($event.target as HTMLSelectElement).value === 'true')"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      <input
        v-else
        class="struct-tree__input"
        type="text"
        :value="scalarEditing ? scalarText : scalarDraft()"
        :disabled="disabled === true"
        @focus="beginScalar"
        @input="scalarText = ($event.target as HTMLInputElement).value"
        @blur="commitScalar"
        @keydown.enter.prevent="commitScalar"
        @keydown.esc.prevent="scalarEditing = false"
      >
      <span class="struct-tree__hint">{{ describeValue(props.value) }}</span>
    </div>
  </div>
</template>

<style scoped>
.struct-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 11px;
}

.struct-tree__row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.struct-tree__key {
  flex: 0 0 auto;
  max-width: 96px;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.struct-tree__value {
  flex: 1 1 auto;
  min-width: 0;
}

.struct-tree__remove {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  line-height: 1;
  cursor: pointer;
}

.struct-tree__remove:hover:not(:disabled) {
  border-color: var(--border);
  color: var(--error);
}

.struct-tree__add {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.struct-tree__input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.struct-tree__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.struct-tree__type {
  flex: 0 0 auto;
  padding: 1px 2px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 11px;
}

.struct-tree__button {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.struct-tree__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.struct-tree__scalar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.struct-tree__null,
.struct-tree__hint {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.struct-tree__error {
  color: var(--error);
  font-size: 10px;
}
</style>
