<script setup lang="ts">
/**
 * 脚本 meta 的一行（对应剪辑软件「草稿参数」的每一项）。
 *
 * 按目录 `type` 分派控件：bool 开关、enum 下拉、int/float/number 数字、string 文本。
 * 写入走 `meta.set`；失败保留原值并显示命令层给的原因。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import type { Component } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import { checkValue } from '../../../core/doc/value.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import { metaFieldSurfaceFor } from '../../../workbench/api/fieldSurface.ts'

const props = defineProps<{
  field: FieldEntry
  value: JsonValue | undefined
}>()

const emit = defineEmits<{ commit: [{ key: string; value: JsonValue }] }>()

const draft = ref('')
const error = ref('')

/** 显示值：文档值优先，缺失时用目录默认值。 */
const current = computed<JsonValue | undefined>(() => {
  if (props.value !== undefined) {
    return props.value
  }
  return props.field.hasDefault ? (props.field.default as JsonValue) : undefined
})

const isBool = computed(() => props.field.type === 'bool' || props.field.type === 'boolean')
const isEnum = computed(() => props.field.type === 'enum')
const isNumber = computed(() =>
  props.field.type === 'int' || props.field.type === 'float'
  || props.field.type === 'number' || props.field.type === 'nullable_float')

const boolValue = computed(() => current.value === true)
const textValue = computed(() => (typeof current.value === 'string' ? current.value : ''))
const numberValue = computed(() =>
  (typeof current.value === 'number' && Number.isFinite(current.value) ? String(current.value) : ''))

const enumValues = computed<string[]>(() => props.field.enumValues ?? [])

/** 10 轮 meta 字段面（当前仅 listener 专用卡）；没有贡献时走通用控件。 */
const customSurface = computed<Component | null>(() => {
  const surface = metaFieldSurfaceFor(props.field.key)
  if (surface === null) return null
  return defineAsyncComponent(surface.component as () => Promise<Component>)
})

function submit(next: JsonValue): void {
  const check = checkValue(props.field, next)
  if (!check.ok) {
    error.value = check.message
    return
  }
  error.value = ''
  emit('commit', { key: props.field.key, value: next })
}

function onBool(event: Event): void {
  submit((event.target as HTMLInputElement).checked)
}

function onEnum(event: Event): void {
  submit((event.target as HTMLSelectElement).value)
}

function onText(event: Event): void {
  submit((event.target as HTMLInputElement).value)
}

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') {
    error.value = '需要一个数字'
    return
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    error.value = '需要有限数字'
    return
  }
  submit(parsed)
}

void draft
</script>

<template>
  <div class="meta-row" :data-key="field.key">
    <label class="meta-row__label" :title="field.key">
      {{ field.key }}
      <span v-if="field.required" class="meta-row__required" title="必填">*</span>
    </label>

    <div class="meta-row__control">
      <component
        :is="customSurface"
        v-if="customSurface !== null"
        :field="field"
        :value="current"
        @commit="emit('commit', $event)"
      />
      <template v-else>
      <input
        v-if="isBool"
        type="checkbox"
        :checked="boolValue"
        :aria-label="field.key"
        @change="onBool"
      >

      <select
        v-else-if="isEnum"
        class="meta-row__input"
        :value="textValue"
        :aria-label="field.key"
        @change="onEnum"
      >
        <option v-if="textValue === ''" value="" disabled>（未设置）</option>
        <option v-for="item in enumValues" :key="item" :value="item">{{ item }}</option>
      </select>

      <input
        v-else-if="isNumber"
        class="meta-row__input"
        type="number"
        :value="numberValue"
        :step="field.type === 'int' ? 1 : 'any'"
        :aria-label="field.key"
        @change="onNumber"
      >

      <input
        v-else
        class="meta-row__input"
        type="text"
        :value="textValue"
        :aria-label="field.key"
        @change="onText"
      >
      </template>
    </div>

    <p v-if="error !== ''" class="meta-row__error" role="alert">{{ error }}</p>
    <p v-else-if="field.doc !== undefined" class="meta-row__doc">{{ field.doc }}</p>
  </div>
</template>

<style scoped>
.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  padding: 3px 10px;
  border-bottom: 1px solid var(--border);
}

.meta-row__label {
  flex: 0 0 auto;
  min-width: 0;
  max-width: 52%;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-row__required {
  color: var(--warning);
}

.meta-row__control {
  flex: 1 1 auto;
  min-width: 90px;
  display: flex;
  justify-content: flex-end;
}

.meta-row__input {
  width: 100%;
  max-width: 220px;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.meta-row__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.meta-row__error {
  flex: 1 1 100%;
  margin: 0;
  color: var(--error);
  font-size: 10px;
}

.meta-row__doc {
  flex: 1 1 100%;
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
