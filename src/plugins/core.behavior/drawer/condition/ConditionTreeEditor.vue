<script setup lang="ts">
/**
 * 规则条件树根节点包装（11-07）。根节点平铺 `{ type, ...fields }`，没有 `conditions` 包装层。
 * 空对象按「永不满足」处理并报错，不自动改成恒真。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../../core/doc/types.ts'
import type { BehaviorRefs } from '../../../../core/schema/catalog/behaviorRules.ts'
import ConditionNodeEditor from './ConditionNodeEditor.vue'

const props = defineProps<{
  condition: JsonObject
  refs: BehaviorRefs
  bindingId?: string
  clipId?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:condition': [node: JsonObject]
}>()

const empty = computed(() => Object.keys(props.condition).length === 0)

function addRoot(): void {
  emit('update:condition', { type: 'location' })
}

function updateRoot(node: JsonObject): void {
  emit('update:condition', node)
}
</script>

<template>
  <div class="condition-tree">
    <ConditionNodeEditor
      v-if="!empty"
      :node="condition"
      :depth="1"
      :refs="refs"
      :binding-id="bindingId"
      :clip-id="clipId"
      :disabled="disabled"
      @update:node="updateRoot"
    />
    <button v-else type="button" class="condition-tree__add" :disabled="disabled" @click="addRoot">
      添加根条件
    </button>
  </div>
</template>

<style scoped>
.condition-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.condition-tree__add {
  align-self: flex-start;
  font: inherit;
}
</style>
