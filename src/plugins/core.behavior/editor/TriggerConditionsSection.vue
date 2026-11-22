<script setup lang="ts">
/**
 * 条件区（11-04）：触发器条件树递归编辑；组合器 `conditions.list` 与叶子字段分开渲染。
 * 前置（`requires`）是独立区域，绝不渲染成条件子节点。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonArray, isJsonObject } from '../../../core/doc/json.ts'
import {
  CONDITION_DEPTH_MAX,
  conditionRole,
} from '../../../features/behavior/triggerConditions.ts'
import { triggerTypeInfo } from '../../../core/schema/catalog/behaviorTriggers.ts'
import { childTypeGroups, depthAtLimit } from '../panels/triggerPanelModel.ts'
import type { PanelScriptContext, PanelTrigger } from '../panels/triggerPanelModel.ts'
import ConditionNodeRow from './ConditionNodeRow.vue'
import ConditionLeafFields from './ConditionLeafFields.vue'

const props = defineProps<{
  draft: JsonObject
  row: PanelTrigger | null
  scriptContext: PanelScriptContext
}>()

const conditions = computed<JsonObject>(() => {
  if (props.draft.conditions === undefined || typeof props.draft.conditions !== 'object') {
    props.draft.conditions = {}
  }
  return props.draft.conditions as JsonObject
})

const role = computed(() => conditionRole(String(props.draft.type ?? '')))
const info = computed(() => triggerTypeInfo(String(props.draft.type ?? '')))
const hasFields = computed(() => role.value === 'combinator'
  || info.value == null
  || info.value.fields.length > 0
  || info.value.region !== 'none'
  || (isJsonObject(props.draft.conditions) && Object.keys(props.draft.conditions).length > 0))

const windowTicks = computed(() => {
  const continuity = props.draft.continuity
  if (continuity !== undefined && typeof continuity === 'object') {
    const windowValue = (continuity as JsonObject).window
    return typeof windowValue === 'number' && Number.isFinite(windowValue) ? windowValue : 0
  }
  return 0
})

const rootList = computed<JsonObject[]>(() => {
  if (!isJsonArray(conditions.value.list)) {
    conditions.value.list = []
  }
  return conditions.value.list as JsonObject[]
})

const groups = childTypeGroups()
const addType = ref('location')
const rootAddDisabled = computed(() => depthAtLimit(conditions.value))

function isPrerequisiteType(type: string): boolean {
  return groups.flatMap((g) => g.types).some((t) => t.role === 'prerequisite' && t.type === type)
}

function addRootChild(): void {
  const type = addType.value
  const child: JsonObject = isPrerequisiteType(type)
    ? { type, conditions: { script: '' } }
    : { type, conditions: {} }
  rootList.value.push(child)
}
</script>

<template>
  <section v-if="hasFields" class="conditions" aria-label="条件">
    <h3 class="section-title">条件</h3>

    <template v-if="role === 'combinator'">
      <div class="conditions__add">
        <select v-model="addType" class="conditions__select">
          <optgroup v-for="group in groups" :key="group.label" :label="group.label">
            <option v-for="entry in group.types" :key="entry.type" :value="entry.type">
              {{ entry.label }}
            </option>
          </optgroup>
        </select>
        <button type="button" :disabled="rootAddDisabled" @click="addRootChild">
          新增子条件{{ rootAddDisabled ? `（已达 ${CONDITION_DEPTH_MAX} 层）` : '' }}
        </button>
      </div>

      <ConditionNodeRow
        v-for="(_, index) in rootList"
        :key="index"
        :list="rootList"
        :index="index"
        :depth="1"
        :window-ticks="windowTicks"
      />
      <p v-if="rootList.length === 0" class="conditions__empty">list 为空：组合器至少需要一个子条件</p>
    </template>

    <ConditionLeafFields
      v-else
      :conditions="conditions"
      :type="String(draft.type ?? '')"
      :info="info ?? undefined"
    />
  </section>
</template>

<style scoped>
.conditions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.conditions__add {
  display: flex;
  gap: 6px;
  align-items: center;
}

.conditions__select,
.conditions__add button {
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}

.conditions__add button:disabled {
  opacity: 0.4;
}

.conditions__empty {
  margin: 0;
  font-size: 11px;
  color: var(--warning, #e0a555);
}
</style>
