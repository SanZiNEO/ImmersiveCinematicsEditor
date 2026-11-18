<script setup lang="ts">
/**
 * 条件叶子字段编辑器（11-04）：按目录字段表渲染；区域类型挂 RegionEditor；
 * 未登记字段 / 未知类型原文只读。物品 id 通配规则只做提示，不判非法写法。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isFiniteNumber, isJsonArray } from '../../../core/doc/json.ts'
import type { TriggerTypeInfo } from '../../../core/schema/catalog/behaviorTriggers.ts'
import RegionEditor from './RegionEditor.vue'

const props = defineProps<{
  conditions: JsonObject
  type: string
  info: TriggerTypeInfo | undefined
}>()

const registeredKeys = computed(() => new Set(props.info?.fields.map((f) => f.key) ?? []))

const unregistered = computed(() =>
  Object.keys(props.conditions).filter((key) => !registeredKeys.value.has(key)),
)

function onStringInput(key: string, event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete props.conditions[key]
    return
  }
  props.conditions[key] = target.value
}

function onNumberInput(key: string, event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete props.conditions[key]
    return
  }
  props.conditions[key] = Number(target.value)
}

function onBoolChange(key: string, event: Event): void {
  props.conditions[key] = (event.target as HTMLInputElement).checked
}

function onEnumChange(key: string, event: Event): void {
  const target = event.target as HTMLSelectElement
  if (target.value === '') {
    delete props.conditions[key]
    return
  }
  props.conditions[key] = target.value
}

function onArrayInput(key: string, event: Event): void {
  const target = event.target as HTMLInputElement
  const items = target.value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (items.length === 0) {
    delete props.conditions[key]
    return
  }
  props.conditions[key] = items
}

function arrayText(key: string): string {
  const value = props.conditions[key]
  return isJsonArray(value) ? value.filter((item): item is string => typeof item === 'string').join(', ') : ''
}

function scalarText(key: string): string {
  const value = props.conditions[key]
  return typeof value === 'string' || isFiniteNumber(value) ? String(value) : ''
}

const WILDCARD_HINT = '通配：* 全匹配；ns:* 命名空间前缀；无冒号按子串包含；其余全等。'

function isRegionField(key: string): boolean {
  return props.info?.region !== 'none' && ['position', 'radius', 'corner1', 'corner2'].includes(key)
}

</script>

<template>
  <div class="leaf-fields">
    <RegionEditor v-if="info !== undefined && info.region !== 'none'" :conditions="conditions" />

    <template v-if="info !== undefined">
      <label
        v-for="field in info.fields"
        :key="field.key"
        v-show="!isRegionField(field.key)"
        class="leaf-fields__field"
      >
        <span class="leaf-fields__label">
          {{ field.label }}
          <span v-if="field.required" class="leaf-fields__required">*</span>
        </span>

        <select
          v-if="field.type === 'enum'"
          class="leaf-fields__input"
          :value="scalarText(field.key)"
          @change="onEnumChange(field.key, $event)"
        >
          <option value="">（不限制）</option>
          <option v-for="option in field.enumValues ?? []" :key="option" :value="option">
            {{ option === '' ? '（不限制）' : option }}
          </option>
        </select>

        <input
          v-else-if="field.type === 'bool'"
          type="checkbox"
          :checked="conditions[field.key] === true"
          @change="onBoolChange(field.key, $event)"
        />

        <input
          v-else-if="field.type === 'array'"
          class="leaf-fields__input"
          type="text"
          :value="arrayText(field.key)"
          :placeholder="`${field.key}，逗号分隔`"
          @input="onArrayInput(field.key, $event)"
        />

        <input
          v-else-if="field.type === 'int' || field.type === 'float'"
          class="leaf-fields__input"
          type="number"
          :value="scalarText(field.key)"
          @input="onNumberInput(field.key, $event)"
        />

        <input
          v-else
          class="leaf-fields__input"
          type="text"
          :value="scalarText(field.key)"
          @input="onStringInput(field.key, $event)"
        />

        <span v-if="field.type === 'string'" class="leaf-fields__hint">{{ WILDCARD_HINT }}</span>
        <span class="leaf-fields__description">{{ field.description }}</span>
      </label>
    </template>

    <div v-if="unregistered.length > 0" class="leaf-fields__legacy">
      <p class="leaf-fields__legacy-title">未登记字段，只读</p>
      <ul>
        <li v-for="key in unregistered" :key="key">
          {{ key }} = {{ JSON.stringify(conditions[key]) }}
        </li>
      </ul>
    </div>

    <p v-if="info === undefined" class="leaf-fields__legacy-title">
      未知类型：条件原文只读
    </p>
  </div>
</template>

<style scoped>
.leaf-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.leaf-fields__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.leaf-fields__label {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.leaf-fields__required {
  color: var(--error, #e05555);
}

.leaf-fields__input {
  font: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}

.leaf-fields__hint,
.leaf-fields__description {
  font-size: 10px;
  color: var(--text-muted, #999);
}

.leaf-fields__legacy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px dashed var(--border, #444);
  border-radius: 4px;
  font-size: 11px;
}

.leaf-fields__legacy-title {
  margin: 0;
  color: var(--text-muted, #999);
}

.leaf-fields__legacy ul {
  margin: 0;
  padding-left: 16px;
}
</style>
