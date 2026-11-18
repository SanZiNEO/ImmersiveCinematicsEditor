<script setup lang="ts">
/**
 * 规则条件树节点编辑器（11-07）。
 *
 * 两种形态：根节点平铺 `{ type, ...fields }`；组合器子项包一层 `{ type, conditions }`。
 * 本组件只处理平铺节点形态，子项编解码由父级在 list 上完成。
 * 12 种类型分状态 / 事实 / 组合三组；组合器嵌套上限 8 层；切类型旧字段进只读块，不静默删除。
 * 子项的删除 / 复制 / 移动通过函数 props 下发（递归组件的事件类型在 vue-tsc 下不可靠）。
 */
import { computed } from 'vue'
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import {
  RULE_CONDITION_TYPES,
  STATE_CONDITION_TYPES,
  FACT_CONDITION_TYPES,
  COMBINATOR_CONDITION_TYPES,
  RULE_CONDITION_MAX_DEPTH,
  conditionTypeInfo,
  type RuleFieldDef,
} from '../../../../core/schema/catalog/behaviorRules.ts'
import type { BehaviorRefs } from '../../../../core/schema/catalog/behaviorRules.ts'
import { legacyConditionKeys } from '../../../../features/behavior/ruleConditions.ts'
import { asObject, combinationList, childToNode, nodeToChild, type FieldKind } from '../shared/fields.ts'
import FieldInput from '../shared/FieldInput.vue'

interface NodeActions {
  remove: () => void
  duplicate: () => void
  move: (dir: -1 | 1) => void
}

const props = defineProps<{
  node: JsonObject
  depth: number
  refs: BehaviorRefs
  bindingId?: string
  clipId?: string
  disabled?: boolean
  /** 是否为组合器子项（影响形态提示文案，不改变节点数据形态）。 */
  nested?: boolean
  /** 子项动作回调（仅嵌套子项由父级传入）。 */
  actions?: NodeActions
}>()

const emit = defineEmits<{
  'update:node': [node: JsonObject]
}>()

const type = computed(() => (typeof props.node.type === 'string' ? props.node.type : ''))
const info = computed(() => (type.value.length > 0 ? conditionTypeInfo(type.value) : undefined))
const isCombinator = computed(() => COMBINATOR_CONDITION_TYPES.includes(type.value))
const legacyKeys = computed(() => legacyConditionKeys(props.node))

const groups = computed(() => [
  { label: '状态条件', types: STATE_CONDITION_TYPES },
  { label: '事实条件', types: FACT_CONDITION_TYPES },
  { label: '组合器', types: COMBINATOR_CONDITION_TYPES },
])

function fieldValue(field: RuleFieldDef): JsonValue | undefined {
  return props.node[field.key]
}

function fieldType(field: RuleFieldDef): FieldKind {
  return field.type === 'array' ? 'array' : field.type === 'map' ? 'unknown' : field.type as FieldKind
}

function onFieldChange(field: RuleFieldDef, value: JsonValue | undefined): void {
  const next: JsonObject = { ...props.node }
  if (value === undefined) delete next[field.key]
  else next[field.key] = value
  emit('update:node', next)
}

function onTypeChange(event: Event): void {
  const nextType = (event.target as HTMLSelectElement).value
  if (nextType.length === 0 || nextType === type.value) return
  // 切类型：旧字段保留在节点上进只读块；新类型字段由作者再填，不编造默认值。
  const next: JsonObject = { ...props.node, type: nextType }
  emit('update:node', next)
}

function clearLegacy(): void {
  const next: JsonObject = { ...props.node }
  for (const key of legacyKeys.value) delete next[key]
  emit('update:node', next)
}

// ── 组合器子项 ────────────────────────────────────────────────────────────────

const children = computed<JsonObject[]>(() => combinationList(props.node))

const canAddCombinator = computed(() => props.depth < RULE_CONDITION_MAX_DEPTH)

function updateChild(index: number, childNode: JsonObject): void {
  const list = children.value.map((child, i) => (i === index ? nodeToChild(childNode) : child))
  emit('update:node', { ...props.node, list })
}

function addChild(): void {
  const child: JsonObject = { type: 'location', conditions: {} }
  emit('update:node', { ...props.node, list: [...children.value, child] })
}

function removeChild(index: number): void {
  const list = children.value.filter((_, i) => i !== index)
  emit('update:node', { ...props.node, list })
}

function duplicateChild(index: number): void {
  const source = children.value[index]
  const copy: JsonObject = { ...source, conditions: { ...(asObject(source.conditions) ?? {}) } }
  const list = [...children.value]
  list.splice(index + 1, 0, copy)
  emit('update:node', { ...props.node, list })
}

function moveChild(index: number, dir: -1 | 1): void {
  const target = index + dir
  if (target < 0 || target >= children.value.length) return
  const list = [...children.value]
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  emit('update:node', { ...props.node, list })
}

function childActions(index: number): NodeActions {
  return {
    remove: () => removeChild(index),
    duplicate: () => duplicateChild(index),
    move: (dir) => moveChild(index, dir),
  }
}

function childNode(child: JsonObject): JsonObject {
  return childToNode(child)
}

const unknownType = computed(() => type.value.length > 0 && info.value === undefined)
</script>

<template>
  <div class="condition-node" :class="{ 'condition-node--nested': nested }">
    <div class="condition-node__head">
      <select
        class="condition-node__type"
        :value="type"
        :disabled="disabled"
        @change="onTypeChange"
      >
        <option value="">（未选择条件类型）</option>
        <optgroup v-for="group in groups" :key="group.label" :label="group.label">
          <option v-for="option in group.types" :key="option" :value="option">
            {{ conditionTypeInfo(option)?.label ?? option }}
          </option>
        </optgroup>
      </select>

      <div v-if="nested && actions" class="condition-node__actions">
        <button type="button" :disabled="disabled" @click="actions.move(-1)">↑</button>
        <button type="button" :disabled="disabled" @click="actions.move(1)">↓</button>
        <button type="button" :disabled="disabled" @click="actions.duplicate">复制</button>
        <button type="button" :disabled="disabled" @click="actions.remove">删除</button>
      </div>
    </div>

    <p v-if="unknownType" class="condition-node__warn">
      未知条件类型：{{ type }}；原文只读，不提供字段编辑。
    </p>

    <template v-else-if="info">
      <div v-if="isCombinator" class="condition-node__combinator-note">
        {{ info.label }} · 子项形态 `{ type, conditions }`；当前第 {{ depth }} 层（上限 {{ RULE_CONDITION_MAX_DEPTH }}）。
      </div>

      <div v-for="field in info.fields" :key="field.key" class="condition-node__field">
        <FieldInput
          :label="field.label"
          :type="fieldType(field)"
          :required="field.required"
          :disabled="disabled"
          :enum-values="field.enumValues"
          :description="field.description"
          :value="fieldValue(field)"
          @update:value="(value) => onFieldChange(field, value)"
        />
      </div>

      <div v-if="isCombinator" class="condition-node__children">
        <ConditionNodeEditor
          v-for="(child, index) in children"
          :key="index"
          :node="childNode(child)"
          :depth="depth + 1"
          :refs="refs"
          :binding-id="bindingId"
          :clip-id="clipId"
          :disabled="disabled"
          :actions="childActions(index)"
          nested
          @update:node="(node) => updateChild(index, node)"
        />
        <button type="button" :disabled="disabled" class="condition-node__add" @click="addChild">
          新增子条件
        </button>
        <p v-if="!canAddCombinator" class="condition-node__warn">
          已达第 {{ RULE_CONDITION_MAX_DEPTH }} 层，不能再嵌套组合器。
        </p>
      </div>
    </template>

    <div v-if="legacyKeys.length > 0" class="condition-node__legacy">
      <span class="condition-node__legacy-label">旧字段（只读保留，未清空）：</span>
      <code v-for="key in legacyKeys" :key="key">{{ key }}={{ JSON.stringify(node[key]) }}</code>
      <button type="button" :disabled="disabled" @click="clearLegacy">清除旧字段</button>
    </div>
  </div>
</template>

<style scoped>
.condition-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.condition-node--nested {
  margin-left: 12px;
}

.condition-node__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.condition-node__type {
  font: inherit;
}

.condition-node__actions {
  display: flex;
  gap: 4px;
}

.condition-node__combinator-note {
  font-size: 10px;
  color: var(--text-muted);
}

.condition-node__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.condition-node__children {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.condition-node__add {
  align-self: flex-start;
}

.condition-node__warn {
  margin: 0;
  font-size: 10px;
  color: var(--warning, #b8860b);
}

.condition-node__legacy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.condition-node__legacy-label {
  color: var(--text-secondary);
}

.condition-node__legacy code {
  font-family: var(--font-mono, monospace);
}

button {
  font: inherit;
}
</style>
