<script setup lang="ts">
/**
 * 触发器条件表单（05-13）。
 *
 * 字段表来自 `CATALOG_SERVICE.trigger(type)`；只渲染目录登记的条件字段与
 * conditions 里真实存在的键。目录不可用 / 未登记类型时按 JSON 类型提供输入。
 * 每次只提交被改的键（`trigger.setConditions` 的 `patch` / `remove`），
 * 不新增触发器、不改 type、不伪造字段。
 */
import { computed, reactive, ref } from 'vue'
import type { DocCommand } from '../../../core/doc/commands.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import type { TriggerViewEntry } from '../../../workbench/api/documents.ts'
import { CATALOG_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import {
  jsonTypeName,
  parseJsonInput,
  type TriggerSetConditionsCommand,
} from '../helpers.ts'

type ConditionKind = 'string' | 'int' | 'number' | 'bool' | 'enum' | 'map' | 'array' | 'json'

interface ConditionRow {
  key: string
  field?: FieldEntry
  present: boolean
  value?: JsonValue
  kind: ConditionKind
  enumValues: string[]
  required: boolean
  readonly: boolean
  source: 'catalog' | 'json'
}

const props = defineProps<{
  trigger: TriggerViewEntry
}>()

const ctx = usePanelContext()
const catalog = ctx.services.require(CATALOG_SERVICE)

const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
const errors = reactive<Record<string, string>>({})
const draftKeys = reactive<Record<string, number>>({})

function fieldKind(field: FieldEntry): ConditionKind {
  switch (field.type) {
    case 'string':
    case 'ref':
      return 'string'
    case 'int':
      return 'int'
    case 'float':
    case 'number':
      return 'number'
    case 'bool':
    case 'boolean':
      return 'bool'
    case 'enum':
      return 'enum'
    case 'map':
    case 'object':
      return 'map'
    case 'array':
      return 'array'
    default:
      return 'json'
  }
}

function jsonKind(value: JsonValue): ConditionKind {
  if (Array.isArray(value)) {
    return 'array'
  }
  if (value !== null && typeof value === 'object') {
    return 'map'
  }
  if (typeof value === 'boolean') {
    return 'bool'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'string') {
    return 'string'
  }
  return 'json'
}

const catalogFields = computed<FieldEntry[] | undefined>(() => catalog.trigger(props.trigger.type))

const rows = computed<ConditionRow[]>(() => {
  const conditions = props.trigger.conditions
  const fields = catalogFields.value
  const result: ConditionRow[] = []

  if (fields !== undefined) {
    const known = new Set<string>()
    for (const field of fields) {
      known.add(field.key)
      const present = Object.prototype.hasOwnProperty.call(conditions, field.key)
      result.push({
        key: field.key,
        field,
        present,
        ...(present ? { value: conditions[field.key] } : {}),
        kind: fieldKind(field),
        enumValues: field.enumValues ?? [],
        required: field.required,
        readonly: false,
        source: 'catalog',
      })
    }
    for (const key of Object.keys(conditions)) {
      if (known.has(key)) {
        continue
      }
      result.push({
        key,
        present: true,
        value: conditions[key],
        kind: jsonKind(conditions[key]),
        enumValues: [],
        required: false,
        readonly: true,
        source: 'json',
      })
    }
    return result
  }

  for (const key of Object.keys(conditions)) {
    const value = conditions[key]
    result.push({
      key,
      present: true,
      value,
      kind: jsonKind(value),
      enumValues: [],
      required: false,
      readonly: false,
      source: 'json',
    })
  }
  return result
})

const hasCatalogTable = computed(() => catalogFields.value !== undefined)

function report(text: string, kind: 'info' | 'error'): void {
  message.value = text
  messageKind.value = kind
}

function errorOf(key: string): string | undefined {
  return errors[key]
}

function clearError(key: string): void {
  delete errors[key]
}

function resetField(key: string): void {
  draftKeys[key] = (draftKeys[key] ?? 0) + 1
}

function fail(key: string, text: string): void {
  errors[key] = text
  report(`${key}: ${text}`, 'error')
  resetField(key)
}

function succeed(key: string): void {
  clearError(key)
  report(`已更新条件 ${key}。`, 'info')
}

function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
}

function validateValue(row: ConditionRow, value: JsonValue): { ok: true; value: JsonValue } | { ok: false; message: string } {
  switch (row.kind) {
    case 'string':
      if (typeof value !== 'string') {
        return { ok: false, message: `需要字符串，实际 ${jsonTypeName(value)}` }
      }
      return { ok: true, value }
    case 'int':
      if (typeof value !== 'number' || !isInt32(value)) {
        return { ok: false, message: `需要 32 位整数，实际 ${jsonTypeName(value)}` }
      }
      return { ok: true, value }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: `需要有限数字，实际 ${jsonTypeName(value)}` }
      }
      return { ok: true, value }
    case 'bool':
      if (typeof value !== 'boolean') {
        return { ok: false, message: `需要布尔值，实际 ${jsonTypeName(value)}` }
      }
      return { ok: true, value }
    case 'enum':
      if (typeof value !== 'string') {
        return { ok: false, message: `需要枚举字符串，实际 ${jsonTypeName(value)}` }
      }
      if (row.enumValues.length > 0 && !row.enumValues.includes(value)) {
        return { ok: false, message: `不在枚举内（允许：${row.enumValues.join(', ')}）` }
      }
      return { ok: true, value }
    case 'map':
      if (!isJsonObject(value)) {
        return { ok: false, message: `需要 JSON 对象，实际 ${jsonTypeName(value)}` }
      }
      return { ok: true, value }
    case 'array':
      if (!Array.isArray(value)) {
        return { ok: false, message: `需要 JSON 数组，实际 ${jsonTypeName(value)}` }
      }
      return { ok: true, value }
    case 'json':
      return { ok: true, value }
  }
  return { ok: true, value }
}

function commit(row: ConditionRow, value: JsonValue): void {
  const checked = validateValue(row, value)
  if (!checked.ok) {
    fail(row.key, checked.message)
    return
  }
  const patch: Record<string, JsonValue> = {}
  patch[row.key] = checked.value
  const command: TriggerSetConditionsCommand = {
    kind: 'trigger.setConditions',
    triggerIdentity: props.trigger.identity,
    patch,
  }
  const outcome = ctx.commands.commit(command as unknown as DocCommand)
  if (outcome.ok) {
    succeed(row.key)
    return
  }
  fail(row.key, outcome.error ?? '写入条件失败')
}

function remove(row: ConditionRow): void {
  const command: TriggerSetConditionsCommand = {
    kind: 'trigger.setConditions',
    triggerIdentity: props.trigger.identity,
    patch: {},
    remove: [row.key],
  }
  const outcome = ctx.commands.commit(command as unknown as DocCommand)
  if (outcome.ok) {
    succeed(row.key)
    return
  }
  fail(row.key, outcome.error ?? '删除条件键失败')
}

function onBool(row: ConditionRow, event: Event): void {
  commit(row, (event.target as HTMLInputElement).checked)
}

function onEnum(row: ConditionRow, event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (raw === '__unset__') {
    if (row.required) {
      fail(row.key, '该字段必填，不能清除。')
      return
    }
    remove(row)
    return
  }
  commit(row, raw)
}

function onScalar(row: ConditionRow, event: Event): void {
  const raw = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  if (row.kind === 'string') {
    commit(row, raw)
    return
  }
  if (row.kind === 'int' || row.kind === 'number') {
    if (raw.trim() === '') {
      if (row.required) {
        fail(row.key, '该字段必填，不能清空。')
      } else {
        remove(row)
      }
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      fail(row.key, '需要有限数字。')
      return
    }
    commit(row, parsed)
    return
  }
  // map / array / json
  if (raw.trim() === '') {
    if (row.required) {
      fail(row.key, '该字段必填，不能清空。')
    } else {
      remove(row)
    }
    return
  }
  const parsed = parseJsonInput(raw)
  if (!parsed.ok) {
    fail(row.key, `JSON 解析失败：${parsed.message}`)
    return
  }
  commit(row, parsed.value)
}

function enumOptions(row: ConditionRow): string[] {
  const values = [...row.enumValues]
  if (typeof row.value === 'string' && !values.includes(row.value)) {
    values.push(row.value)
  }
  return values
}

function enumCurrent(row: ConditionRow): string {
  return typeof row.value === 'string' ? row.value : '__unset__'
}

function textValue(row: ConditionRow): string {
  if (!row.present) {
    return ''
  }
  return typeof row.value === 'string' ? row.value : ''
}

function numberValue(row: ConditionRow): string {
  if (!row.present) {
    return ''
  }
  return typeof row.value === 'number' && Number.isFinite(row.value) ? String(row.value) : ''
}

function jsonText(row: ConditionRow): string {
  if (!row.present) {
    return ''
  }
  try {
    return JSON.stringify(row.value, null, 2) ?? 'null'
  } catch {
    return String(row.value)
  }
}

function fieldHint(row: ConditionRow): string {
  if (row.field === undefined) {
    return row.readonly ? '目录未登记，只读' : '目录未登记，按 JSON 类型编辑'
  }
  const parts: string[] = [row.field.type]
  if (row.field.mode !== undefined) {
    parts.push(`mode=${row.field.mode}`)
  }
  if (row.field.required) {
    parts.push('必填')
  } else {
    parts.push('可选')
  }
  if (row.field.hasDefault && row.field.default !== null) {
    parts.push(`默认 ${JSON.stringify(row.field.default)}`)
  }
  return parts.join(' · ')
}

function canClear(row: ConditionRow): boolean {
  return row.present && !row.required && !row.readonly
}
</script>

<template>
  <section class="conditions" aria-label="触发器条件">
    <header class="conditions__head">
      <h3 class="conditions__title">条件</h3>
      <span class="conditions__hint">
        {{ hasCatalogTable ? `按目录字段表 · ${trigger.type}` : '目录未登记该类型，按 JSON 类型' }}
      </span>
    </header>

    <p v-if="message !== ''" class="conditions__message" :data-kind="messageKind" role="status" aria-live="polite">
      {{ message }}
    </p>

    <p v-if="rows.length === 0" class="conditions__empty">
      该触发器没有可渲染的条件字段。条件新增不在本面板；本面板只编辑已有字段。
    </p>

    <div v-else class="conditions__rows">
      <div v-for="row in rows" :key="row.key" class="condition-row" :data-source="row.source">
        <header class="condition-row__head">
          <code class="condition-row__key">{{ row.key }}</code>
          <span class="condition-row__meta">{{ fieldHint(row) }}</span>
          <span v-if="!row.present" class="condition-row__unset">未设置</span>
        </header>
        <p v-if="row.field?.doc !== undefined" class="condition-row__doc">{{ row.field.doc }}</p>

        <pre v-if="row.readonly" class="condition-row__json">{{ jsonText(row) }}</pre>

        <div v-else class="condition-row__control">
          <label v-if="row.kind === 'bool'" class="condition-row__check">
            <input
              :key="draftKeys[row.key] ?? 0"
              type="checkbox"
              :checked="row.value === true"
              @change="onBool(row, $event)"
            />
            <span>{{ row.value === true ? 'true' : 'false' }}</span>
          </label>

          <select
            v-else-if="row.kind === 'enum'"
            :key="draftKeys[row.key] ?? 0"
            class="condition-row__input"
            :value="enumCurrent(row)"
            @change="onEnum(row, $event)"
          >
            <option value="__unset__">未设置</option>
            <option v-for="item in enumOptions(row)" :key="item" :value="item">
              {{ item === '' ? '（空字符串）' : item }}
            </option>
          </select>

          <input
            v-else-if="row.kind === 'int' || row.kind === 'number'"
            :key="draftKeys[row.key] ?? 0"
            class="condition-row__input"
            type="number"
            :step="row.kind === 'int' ? 1 : 'any'"
            :value="numberValue(row)"
            :placeholder="row.required ? '必填' : '未设置'"
            @change="onScalar(row, $event)"
          />

          <input
            v-else-if="row.kind === 'string'"
            :key="draftKeys[row.key] ?? 0"
            class="condition-row__input"
            type="text"
            :value="textValue(row)"
            :placeholder="row.required ? '必填' : '未设置'"
            @change="onScalar(row, $event)"
          />

          <textarea
            v-else
            :key="draftKeys[row.key] ?? 0"
            class="condition-row__json-input"
            rows="3"
            :value="jsonText(row)"
            :placeholder="row.required ? '必填 JSON' : '未设置；留空删除该键'"
            @change="onScalar(row, $event)"
          />

          <button
            v-if="canClear(row)"
            type="button"
            class="condition-row__clear"
            @click="remove(row)"
          >
            清除 {{ row.key }}
          </button>
        </div>

        <p v-if="errorOf(row.key) !== undefined" class="condition-row__error" role="alert">
          {{ errorOf(row.key) }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.conditions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.conditions__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.conditions__title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.conditions__hint {
  color: var(--text-muted);
  font-size: 10px;
}

.conditions__message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.conditions__message[data-kind='error'] {
  color: var(--error);
}

.conditions__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.conditions__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.condition-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
}

.condition-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.condition-row__key {
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.condition-row__meta {
  color: var(--text-muted);
  font-size: 10px;
}

.condition-row__unset {
  color: var(--warning);
  font-size: 10px;
}

.condition-row__doc {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.condition-row__control {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.condition-row__input,
.condition-row__json-input {
  width: 100%;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
}

.condition-row__json-input {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  resize: vertical;
}

.condition-row__input:focus-visible,
.condition-row__json-input:focus-visible,
.condition-row__check input:focus-visible,
.condition-row__clear:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.condition-row__check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.condition-row__json {
  max-height: 160px;
  margin: 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: pre-wrap;
}

.condition-row__clear {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.condition-row__clear:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.condition-row__error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
  overflow-wrap: anywhere;
}
</style>
