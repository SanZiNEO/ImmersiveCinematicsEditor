<script setup lang="ts">
/**
 * 规则动作列表编辑器（11-08）。
 *
 * 九种动作；顺序即执行顺序，可上下移动；序号随移动更新。超时动作数组里 `emit_command`
 * 禁用（服务端命令表不编译超时动作）。无参动作除 `type` 外不接受键。
 * 字段表全部来自目录 `RULE_ACTION_INFO`，组件不另存一份。
 */
import { computed } from 'vue'
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import {
  ACTION_TYPES,
  actionTypeInfo,
  type ActionTypeInfo,
  type RuleFieldDef,
} from '../../../../core/schema/catalog/behaviorRules.ts'
import type { BehaviorRefs } from '../../../../core/schema/catalog/behaviorRules.ts'
import { legacyActionKeys } from '../../../../features/behavior/actions.ts'
import FieldInput from '../shared/FieldInput.vue'
import type { FieldKind } from '../shared/fields.ts'

interface ActionCard {
  action: JsonObject
  info: ActionTypeInfo | undefined
}

const props = defineProps<{
  actions: JsonObject[]
  refs: BehaviorRefs
  /** 是否处于超时动作数组（`on_timeout`）；其中命令动作按合同拦截。 */
  timedOut: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:actions': [actions: JsonObject[]]
}>()

function actionType(action: JsonObject): string {
  return typeof action.type === 'string' ? action.type : ''
}

function infoOf(action: JsonObject) {
  return actionTypeInfo(actionType(action))
}

function patch(index: number, next: JsonObject): void {
  const list = props.actions.map((action, i) => (i === index ? next : action))
  emit('update:actions', list)
}

function onFieldChange(index: number, action: JsonObject, field: RuleFieldDef, value: JsonValue | undefined): void {
  const next: JsonObject = { ...action }
  if (value === undefined) delete next[field.key]
  else next[field.key] = value
  patch(index, next)
}

function onTypeChange(index: number, action: JsonObject, event: Event): void {
  const nextType = (event.target as HTMLSelectElement).value
  if (nextType.length === 0 || nextType === actionType(action)) return
  // 切类型：旧字段保留进只读块，不静默删除。
  patch(index, { ...action, type: nextType })
}

function addAction(): void {
  emit('update:actions', [...props.actions, { type: 'camera_set' }])
}

function removeAction(index: number): void {
  emit('update:actions', props.actions.filter((_, i) => i !== index))
}

function duplicateAction(index: number): void {
  const source = props.actions[index]
  const copy: JsonObject = JSON.parse(JSON.stringify(source)) as JsonObject
  const list = [...props.actions]
  list.splice(index + 1, 0, copy)
  emit('update:actions', list)
}

function moveAction(index: number, dir: -1 | 1): void {
  const target = index + dir
  if (target < 0 || target >= props.actions.length) return
  const list = [...props.actions]
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  emit('update:actions', list)
}

function legacyOf(action: JsonObject): string[] {
  return legacyActionKeys(action)
}

function clearLegacy(index: number, action: JsonObject): void {
  const next: JsonObject = { ...action }
  for (const key of legacyOf(action)) delete next[key]
  patch(index, next)
}

const blockedInTimeout = computed(() => props.timedOut)

function typeDisabled(type: string): boolean {
  return blockedInTimeout.value && type === 'emit_command'
}

const cards = computed<ActionCard[]>(() =>
  props.actions.map((action) => ({ action, info: infoOf(action) })),
)

function fieldType(field: RuleFieldDef): FieldKind {
  return field.type === 'array' ? 'array' : field.type === 'map' ? 'unknown' : field.type as FieldKind
}

</script>

<template>
  <div class="action-list">
    <p v-if="timedOut" class="action-list__note">
      超时动作：命令动作（emit_command）在此数组中被禁用——服务端命令表只编译普通动作。
    </p>

    <div v-for="(card, index) in cards" :key="index" class="action-card">
      <div class="action-card__head">
        <span class="action-card__index">{{ index + 1 }}</span>
        <select
          class="action-card__type"
          :value="actionType(card.action)"
          :disabled="disabled"
          @change="onTypeChange(index, card.action, $event)"
        >
          <option value="">（未选择动作）</option>
          <option v-for="type in ACTION_TYPES" :key="type" :value="type" :disabled="typeDisabled(type)">
            {{ actionTypeInfo(type)?.label ?? type }}
          </option>
        </select>
        <div class="action-card__actions">
          <button type="button" :disabled="disabled" @click="moveAction(index, -1)">↑</button>
          <button type="button" :disabled="disabled" @click="moveAction(index, 1)">↓</button>
          <button type="button" :disabled="disabled" @click="duplicateAction(index)">复制</button>
          <button type="button" :disabled="disabled" @click="removeAction(index)">删除</button>
        </div>
      </div>

      <p v-if="actionType(card.action).length > 0 && card.info === undefined" class="action-card__warn">
        未知动作类型：{{ actionType(card.action) }}；原文只读。
      </p>

      <template v-else-if="card.info">
        <p v-if="card.info.noParams" class="action-card__note">无参动作（除类型外不接受任何键）。</p>
        <div v-for="field in card.info.fields" :key="field.key" class="action-card__field">
          <FieldInput
            :label="field.label"
            :type="fieldType(field)"
            :array-kind="field.key === 'channels' ? 'channels' : undefined"
            :required="field.required"
            :disabled="disabled"
            :enum-values="field.enumValues"
            :description="field.description"
            :value="card.action[field.key]"
            @update:value="(value) => onFieldChange(index, card.action, field, value)"
          />
        </div>
      </template>

      <div v-if="legacyOf(card.action).length > 0" class="action-card__legacy">
        <span class="action-card__legacy-label">旧字段（只读保留）：</span>
        <code v-for="key in legacyOf(card.action)" :key="key">{{ key }}={{ JSON.stringify(card.action[key]) }}</code>
        <button type="button" :disabled="disabled" @click="clearLegacy(index, card.action)">清除</button>
      </div>
    </div>

    <button type="button" class="action-list__add" :disabled="disabled" @click="addAction">
      新增动作
    </button>
  </div>
</template>

<style scoped>
.action-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.action-list__note,
.action-card__note {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
}

.action-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.action-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-card__index {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
}

.action-card__type {
  font: inherit;
  flex: 1;
}

.action-card__actions {
  display: flex;
  gap: 4px;
}

.action-card__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.action-card__warn {
  margin: 0;
  font-size: 10px;
  color: var(--warning, #b8860b);
}

.action-card__legacy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.action-card__legacy code {
  font-family: var(--font-mono, monospace);
}

.action-list__add {
  align-self: flex-start;
  font: inherit;
}

button,
select {
  font: inherit;
}
</style>
