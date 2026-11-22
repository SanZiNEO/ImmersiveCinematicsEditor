<script setup lang="ts">
/**
 * 条件树递归节点（11-04）：组合器子项的新增 / 复制 / 删除 / 上下移动；第 8 层禁新增；
 * 事件类子项在 window=0 时禁用；脚本前置必须对象形态 `conditions.script`。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonArray, cloneJson } from '../../../core/doc/json.ts'
import { CONDITION_DEPTH_MAX, conditionRole, describeTriggerCondition } from '../../../features/behavior/triggerConditions.ts'
import { triggerTypeInfo, isBuiltinRequirement } from '../../../core/schema/catalog/behaviorTriggers.ts'
import { childTypeGroups } from '../panels/triggerPanelModel.ts'
import ConditionLeafFields from './ConditionLeafFields.vue'

const props = defineProps<{
  list: JsonObject[]
  index: number
  depth: number
  windowTicks: number
}>()

const child = computed(() => props.list[props.index])
const childType = computed(() => String(child.value.type ?? ''))
const role = computed(() => conditionRole(childType.value))
const info = computed(() => triggerTypeInfo(childType.value))
const summary = computed(() =>
  describeTriggerCondition({ type: childType.value, conditions: conditionsOf(child.value) }),
)

const groups = childTypeGroups()
const addDisabled = computed(() => props.depth + 1 > CONDITION_DEPTH_MAX)
const newChildType = ref('all_of')

function conditionsOf(node: JsonObject): JsonObject {
  return node.conditions !== undefined && typeof node.conditions === 'object'
    ? (node.conditions as JsonObject)
    : {}
}

function ensureConditions(node: JsonObject): JsonObject {
  if (!isJsonArray(node.conditions) && (node.conditions === undefined || typeof node.conditions !== 'object')) {
    node.conditions = {}
  }
  return node.conditions as JsonObject
}

function childList(node: JsonObject): JsonObject[] {
  const conditions = ensureConditions(node)
  if (!isJsonArray(conditions.list)) {
    conditions.list = []
  }
  return conditions.list as JsonObject[]
}

function makeChild(type: string): JsonObject {
  if (isBuiltinRequirement(type)) {
    return { type, conditions: { script: '' } }
  }
  return { type, conditions: {} }
}

function addChild(type: string): void {
  props.list.splice(props.index + 1, 0, makeChild(type))
}

function duplicateChild(): void {
  props.list.splice(props.index + 1, 0, cloneJson(child.value))
}

function removeChild(): void {
  props.list.splice(props.index, 1)
}

function moveChild(dir: -1 | 1): void {
  const to = props.index + dir
  if (to < 0 || to >= props.list.length) return
  const [moved] = props.list.splice(props.index, 1)
  props.list.splice(to, 0, moved)
}

function onTypeChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  child.value.type = target.value
  ensureConditions(child.value)
}

function isEventDisabled(type: string): boolean {
  const entry = groups.flatMap((g) => g.types).find((t) => t.type === type)
  return entry?.event === true && props.windowTicks <= 0
}
</script>

<template>
  <div class="condition-row" :class="`condition-row--depth-${Math.min(depth, 8)}`">
    <div class="condition-row__head">
      <select class="condition-row__type" :value="String(child.type ?? '')" @change="onTypeChange">
        <optgroup v-for="group in groups" :key="group.label" :label="group.label">
          <option
            v-for="entry in group.types"
            :key="entry.type"
            :value="entry.type"
            :disabled="isEventDisabled(entry.type)"
          >
            {{ entry.label }}
          </option>
        </optgroup>
      </select>
      <span class="condition-row__summary">{{ summary }}</span>
      <span class="condition-row__ops">
        <button type="button" :disabled="index === 0" @click="moveChild(-1)">↑</button>
        <button type="button" :disabled="index === list.length - 1" @click="moveChild(1)">↓</button>
        <button type="button" @click="duplicateChild">复制</button>
        <button type="button" @click="removeChild">删除</button>
      </span>
    </div>

    <ConditionLeafFields
      v-if="role !== 'combinator' && role !== 'prerequisite'"
      :conditions="conditionsOf(child)"
      :type="childType"
      :info="info ?? undefined"
    />

    <div v-if="role === 'prerequisite'" class="condition-row__prereq">
      <label class="condition-row__field">
        <span>目标脚本 id（对象形态 conditions.script）</span>
        <input
          class="condition-row__input"
          type="text"
          :value="conditionsOf(child).script ?? ''"
          @input="(event) => { conditionsOf(child).script = (event.target as HTMLInputElement).value }"
        />
      </label>
    </div>

    <div v-if="role === 'combinator'" class="condition-row__children">
      <ConditionNodeRow
        v-for="(_, childIndex) in childList(child)"
        :key="childIndex"
        :list="childList(child)"
        :index="childIndex"
        :depth="depth + 1"
        :window-ticks="windowTicks"
      />
      <div class="condition-row__add">
        <select v-model="newChildType" class="condition-row__select">
          <optgroup v-for="group in groups" :key="group.label" :label="group.label">
            <option
              v-for="entry in group.types"
              :key="entry.type"
              :value="entry.type"
              :disabled="isEventDisabled(entry.type)"
            >
              {{ entry.label }}
            </option>
          </optgroup>
        </select>
        <button type="button" :disabled="addDisabled" @click="addChild(newChildType)">
          新增子条件{{ addDisabled ? `（已达 ${CONDITION_DEPTH_MAX} 层）` : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.condition-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-left: 2px solid var(--border, #333);
}

.condition-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.condition-row__type,
.condition-row__select,
.condition-row__input {
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}

.condition-row__summary {
  font-size: 11px;
  color: var(--text-muted, #999);
  flex: 1;
}

.condition-row__ops {
  display: flex;
  gap: 4px;
}

.condition-row__ops button,
.condition-row__select,
.condition-row__add button {
  font: inherit;
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 3px;
  background: var(--panel-bg, #222);
  color: var(--text, #eee);
  cursor: pointer;
}

.condition-row__ops button:disabled,
.condition-row__add button:disabled {
  opacity: 0.4;
  cursor: default;
}

.condition-row__warn {
  margin: 0;
  font-size: 11px;
  color: var(--warning, #e0a555);
}

.condition-row__children {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.condition-row__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted, #999);
}
</style>
