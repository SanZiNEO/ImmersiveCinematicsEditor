<script setup lang="ts">
/**
 * data 顶层对象的双视图编辑器：
 * - 默认结构化键值视图：逐键编辑，支持新增 / 删除 / 改名 / 类型切换 / 嵌套展开；
 * - 原始 JSON 视图：完整文本；两视图共享同一份草稿对象，切换不丢数据。
 * 删除键 = 从对象移除该键（不写 null）；类型切换落盘真实 JSON 类型。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import { cloneJson, isJsonObject } from '../../../../core/doc/json.ts'
import { formatRecordBody } from '../../../../features/effects/eventRecords.ts'
import { entriesOf, type DataEntry } from './dataEditing.ts'
import DataValueCell from './DataValueCell.vue'

const props = defineProps<{
  value: JsonObject
  depth?: number
}>()

const emit = defineEmits<{
  apply: [next: JsonObject]
}>()

const depth = computed(() => props.depth ?? 0)

const draft = ref<JsonObject>(cloneJson(props.value))
const view = ref<'structured' | 'raw'>('structured')
const rawText = ref('')
const rawError = ref('')

const signature = computed(() => JSON.stringify(props.value))
watch(signature, () => {
  draft.value = cloneJson(props.value)
  rawError.value = ''
})

const entries = computed<DataEntry[]>(() => entriesOf(draft.value))

function emitApply(next: JsonObject): void {
  draft.value = next
  rawError.value = ''
  emit('apply', cloneJson(next))
}

function updateEntry(key: string, next: JsonValue): void {
  emitApply({ ...draft.value, [key]: next })
}

function removeEntry(key: string): void {
  const next: JsonObject = {}
  for (const [existingKey, existingValue] of Object.entries(draft.value)) {
    if (existingKey !== key) next[existingKey] = existingValue
  }
  emitApply(next)
}

function renameEntry(index: number, newKey: string): void {
  const trimmed = newKey.trim()
  if (trimmed === '') return
  const list = entriesOf(draft.value)
  const oldKey = list[index]?.key
  if (oldKey === undefined || trimmed === oldKey) return
  if (list.some((item, itemIndex) => itemIndex !== index && item.key === trimmed)) return
  const next: JsonObject = {}
  list.forEach((item, itemIndex) => {
    next[itemIndex === index ? trimmed : item.key] = item.value
  })
  emitApply(next)
}

function addEntry(): void {
  const base = 'field'
  let candidate = base
  let counter = 1
  while (Object.prototype.hasOwnProperty.call(draft.value, candidate)) {
    counter += 1
    candidate = `${base}${counter}`
  }
  emitApply({ ...draft.value, [candidate]: '' })
}

function parseRaw(): JsonObject | null {
  rawError.value = ''
  let parsed: JsonValue
  try {
    parsed = JSON.parse(rawText.value)
  } catch (parseError) {
    rawError.value = `JSON 语法错误：${parseError instanceof Error ? parseError.message : '无法解析'}`
    return null
  }
  if (!isJsonObject(parsed)) {
    rawError.value = '顶层必须是 JSON 对象（数组 / 标量不接受）'
    return null
  }
  return parsed
}

function commitRaw(): void {
  const parsed = parseRaw()
  if (parsed !== null) {
    emitApply(parsed)
  }
}

function switchView(next: 'structured' | 'raw'): void {
  if (next === view.value) return
  if (view.value === 'raw') {
    const parsed = parseRaw()
    if (parsed === null) return
    draft.value = parsed
  }
  view.value = next
  if (next === 'raw') {
    rawText.value = formatRecordBody(draft.value)
  }
}
</script>

<template>
  <div class="data-object">
    <div class="data-object__bar">
      <button
        type="button"
        class="data-object__tab"
        :class="{ 'data-object__tab--active': view === 'structured' }"
        @click="switchView('structured')"
      >
        结构化键值
      </button>
      <button
        type="button"
        class="data-object__tab"
        :class="{ 'data-object__tab--active': view === 'raw' }"
        @click="switchView('raw')"
      >
        原始 JSON
      </button>
      <span class="data-object__count">{{ entries.length }} 键</span>
    </div>

    <div v-if="view === 'structured'" class="data-object__body">
      <p v-if="entries.length === 0" class="data-object__empty">空对象（0 键）；点“+ 键”新增第一个键。</p>
      <div v-for="(entry, index) in entries" :key="entry.key" class="data-object__row">
        <input
          class="data-object__key"
          :value="entry.key"
          :aria-label="`键名 ${entry.key}`"
          @change="renameEntry(index, ($event.target as HTMLInputElement).value)"
        />
        <DataValueCell
          class="data-object__cell"
          :value="entry.value"
          :depth="depth + 1"
          @update="updateEntry(entry.key, $event)"
        />
        <button type="button" class="data-object__remove" @click="removeEntry(entry.key)">删键</button>
      </div>
      <button type="button" class="data-object__add" @click="addEntry">+ 键</button>
    </div>

    <div v-else class="data-object__raw">
      <textarea
        v-model="rawText"
        class="data-object__textarea"
        rows="5"
        spellcheck="false"
        @blur="commitRaw"
      ></textarea>
      <p v-if="rawError" class="data-object__error">{{ rawError }}</p>
    </div>
  </div>
</template>

<style scoped>
.data-object {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.data-object__bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.data-object__tab {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.data-object__tab--active {
  border-color: var(--focus);
  background: var(--bg-selected);
  color: var(--text);
}

.data-object__count {
  color: var(--text-muted);
  font-size: 10px;
}

.data-object__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.data-object__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.data-object__row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 6px;
}

.data-object__key {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  min-width: 100px;
}

.data-object__cell {
  flex: 1;
  min-width: 160px;
}

.data-object__remove,
.data-object__add {
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.data-object__add {
  align-self: flex-start;
}

.data-object__raw {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.data-object__textarea {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  resize: vertical;
}

.data-object__error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
}
</style>
