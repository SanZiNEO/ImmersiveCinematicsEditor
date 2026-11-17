<script setup lang="ts">
/**
 * 单个片段对象属性（05-13）。
 *
 * 只做两件事：显示 `objects.<path>` 的真实形态；当它是标量 `value` 时，
 * 用文档命令 `object.setValue` 写回。关键帧只显示帧数（只读，06 才编辑）。
 * 目录条目可用时显示字段类型 / 模式 / 单位；目录缺失时按 JSON 类型显示。
 */
import { computed, ref } from 'vue'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { checkValue } from '../../../core/doc/value.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  clipKey: string
  path: string
  property: JsonValue
  field?: FieldEntry
}>()

const ctx = usePanelContext()

const propertyObject = computed<JsonObject | null>(() => (isJsonObject(props.property) ? props.property : null))
const malformed = computed(() => propertyObject.value === null)
const hasValue = computed(() => {
  const object = propertyObject.value
  return object !== null && Object.prototype.hasOwnProperty.call(object, 'value')
})
const value = computed<JsonValue | undefined>(() => (hasValue.value ? propertyObject.value?.value : undefined))
const keyframeCount = computed<number | null>(() => {
  const frames = propertyObject.value?.keyframes
  return Array.isArray(frames) ? frames.length : null
})

const fieldType = computed(() => props.field?.type)
const modeLabel = computed(() => {
  switch (props.field?.mode) {
    case 'value':
      return '值'
    case 'animated':
      return '动画'
    case 'event':
      return '事件'
    default:
      return null
  }
})

const typeLabel = computed(() => {
  if (fieldType.value !== undefined) {
    return fieldType.value
  }
  return value.value === undefined ? '未设置' : jsonTypeName(value.value)
})

const isBoolean = computed(
  () => fieldType.value === 'bool' || (props.field === undefined && typeof value.value === 'boolean'),
)
const isText = computed(
  () =>
    fieldType.value === 'string'
    || fieldType.value === 'ref'
    || (props.field === undefined && typeof value.value === 'string'),
)
const isNumber = computed(
  () =>
    fieldType.value === 'float'
    || fieldType.value === 'int'
    || fieldType.value === 'nullable_float'
    || (props.field === undefined && typeof value.value === 'number'),
)
const isEnum = computed(() => fieldType.value === 'enum')

const editableScalar = computed(
  () => hasValue.value && !malformed.value && (isBoolean.value || isText.value || isNumber.value || isEnum.value),
)

const enumValues = computed<string[]>(() => {
  const values = props.field?.enumValues ?? []
  if (typeof value.value === 'string' && !values.includes(value.value)) {
    return [...values, value.value]
  }
  return values
})

const textValue = computed(() => (typeof value.value === 'string' ? value.value : ''))
const numberValue = computed(() => {
  if (value.value === null) {
    return ''
  }
  return typeof value.value === 'number' && Number.isFinite(value.value) ? String(value.value) : ''
})
const jsonPreview = computed(() => {
  try {
    return JSON.stringify(value.value, null, 2) ?? String(value.value)
  } catch {
    return String(value.value)
  }
})

const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
const formKey = ref(0)

function jsonTypeName(item: JsonValue): string {
  if (item === null) {
    return 'null'
  }
  if (Array.isArray(item)) {
    return 'array'
  }
  return typeof item
}

function describeInputType(): string {
  if (fieldType.value === 'enum') {
    return '枚举'
  }
  if (fieldType.value !== undefined) {
    return fieldType.value
  }
  return typeof value.value
}

function report(text: string, kind: 'info' | 'error'): void {
  message.value = text
  messageKind.value = kind
}

function resetInputs(): void {
  formKey.value += 1
}

function commitScalar(next: JsonValue): void {
  const field = props.field
  if (field !== undefined) {
    const check = checkValue(field, next)
    if (!check.ok) {
      report(check.message, 'error')
      resetInputs()
      return
    }
    next = check.value
  } else if (next !== null) {
    const expected = typeof value.value
    if (typeof next !== expected) {
      report(`没有目录字段，按 JSON 类型 ${expected} 写入；收到 ${typeof next}`, 'error')
      resetInputs()
      return
    }
  }
  const outcome = ctx.commands.commit({ kind: 'object.setValue', clipKey: props.clipKey, path: props.path, value: next })
  if (outcome.ok) {
    report('已写入 value。', 'info')
    return
  }
  report(outcome.error ?? '写入 value 失败。', 'error')
  resetInputs()
}

function onBoolean(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  commitScalar(checked)
}

function onText(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  commitScalar(raw)
}

function onEnum(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  commitScalar(raw)
}

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw.trim() === '') {
    if (fieldType.value === 'nullable_float') {
      commitScalar(null)
      return
    }
    report('该字段不接受空值。', 'error')
    resetInputs()
    return
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    report('需要有限数字。', 'error')
    resetInputs()
    return
  }
  commitScalar(parsed)
}
</script>

<template>
  <article class="object-row" :data-path="path">
    <header class="object-row__head">
      <code class="object-row__path" :title="path">{{ path }}</code>
      <span class="object-row__type">{{ typeLabel }}</span>
      <span v-if="modeLabel !== null" class="object-row__mode">{{ modeLabel }}</span>
      <span v-if="field?.unit !== undefined" class="object-row__mode">{{ field.unit }}</span>
    </header>
    <p v-if="field?.doc !== undefined" class="object-row__doc">{{ field.doc }}</p>

    <p v-if="malformed" class="object-row__error" role="alert">
      属性不是对象（实际 {{ jsonTypeName(property) }}），只读。
    </p>
    <pre v-if="malformed" class="object-row__json">{{ JSON.stringify(property, null, 2) }}</pre>

    <template v-else>
      <div :key="formKey" class="object-row__control">
        <label v-if="editableScalar && isBoolean" class="object-row__check">
          <input type="checkbox" :checked="value === true" @change="onBoolean" />
          <span>{{ value === true ? 'true' : 'false' }}</span>
        </label>

        <select v-else-if="editableScalar && isEnum" class="object-row__input" :value="textValue" @change="onEnum">
          <option v-for="item in enumValues" :key="item" :value="item">{{ item === '' ? '（空字符串）' : item }}</option>
        </select>

        <input
          v-else-if="editableScalar && isNumber"
          class="object-row__input"
          type="number"
          :value="numberValue"
          :step="fieldType === 'int' ? 1 : 'any'"
          :min="field?.min"
          :max="field?.max"
          @change="onNumber"
        />

        <input
          v-else-if="editableScalar && isText"
          class="object-row__input"
          type="text"
          :value="textValue"
          @change="onText"
        />

        <span v-else-if="hasValue" class="object-row__readonly">
          <span class="object-row__type">{{ describeInputType() }} 值只读（非标量或目录未登记编辑控件）</span>
          <pre class="object-row__json">{{ jsonPreview }}</pre>
        </span>

        <span v-else class="object-row__unset">未设置 value。</span>

        <span v-if="keyframeCount !== null" class="object-row__keyframes">
          关键帧 {{ keyframeCount }} 帧（只读）
        </span>
      </div>

      <p v-if="message !== ''" class="object-row__message" :data-kind="messageKind" role="status" aria-live="polite">
        {{ message }}
      </p>
    </template>
  </article>
</template>

<style scoped>
.object-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.object-row__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.object-row__path {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.object-row__type,
.object-row__mode {
  flex: 0 0 auto;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 10px;
}

.object-row__doc {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.object-row__control {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.object-row__input {
  width: 100%;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.object-row__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.object-row__check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.object-row__readonly {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.object-row__unset {
  color: var(--text-muted);
  font-size: 11px;
}

.object-row__keyframes {
  color: var(--text-muted);
  font-size: 11px;
}

.object-row__json {
  max-height: 160px;
  margin: 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: pre-wrap;
}

.object-row__message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.object-row__message[data-kind='error'],
.object-row__error {
  color: var(--error);
}
</style>
