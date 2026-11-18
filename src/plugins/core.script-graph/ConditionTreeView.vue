<script setup lang="ts">
/**
 * 条件树只读递归渲染（11-04）。
 *
 * 任意深度组合器原样展开，不折叠、不截断；叶子 / 前置摘要全部来自
 * `hoverSummary.ts` 已解析好的视图，组件只做展示。内部不含任何输入控件、
 * 不发命令、不写选区。
 */
import { computed } from 'vue'
import {
  HOVER_REQUIREMENT_STATUS_LABELS,
  hoverRequirementStatusKind,
  requirementCatalogLabel,
  type HoverConditionNode,
} from './hoverSummary.ts'

const props = defineProps<{
  node: HoverConditionNode
  depth?: number
}>()

const depth = computed(() => props.depth ?? 0)

const isCombinator = computed(() => props.node.role === 'combinator')
const isPrerequisite = computed(() => props.node.role === 'prerequisite')

const prerequisiteLabel = computed(() => requirementCatalogLabel(props.node.type))
const statusLabel = computed(() => {
  const requirement = props.node.requirement
  return requirement === null ? '' : HOVER_REQUIREMENT_STATUS_LABELS[requirement.status]
})
const statusKind = computed(() => {
  const requirement = props.node.requirement
  return requirement === null ? 'muted' : hoverRequirementStatusKind(requirement.status)
})
</script>

<template>
  <div class="condition-tree" :class="`condition-tree--depth-${depth}`">
    <!-- 组合器：头行摘要 + 子项递归 -->
    <div v-if="isCombinator" class="condition-tree__combinator">
      <span class="condition-tree__text">{{ node.text }}</span>
      <div v-if="node.children !== null" class="condition-tree__children">
        <ConditionTreeView
          v-for="(child, index) in node.children"
          :key="`${child.type}:${index}`"
          :node="child"
          :depth="depth + 1"
        />
      </div>
    </div>

    <!-- 前置子项：目录标签 + 目标脚本 + 解析状态（只读） -->
    <div v-else-if="isPrerequisite" class="condition-tree__prereq" :title="node.requirement?.message">
      <span class="condition-tree__prereq-label">{{ prerequisiteLabel }}</span>
      <span v-if="node.requirement?.target !== undefined" class="condition-tree__prereq-target">
        → {{ node.requirement.target }}
      </span>
      <span class="condition-tree__status" :class="`condition-tree__status--${statusKind}`">{{ statusLabel }}</span>
    </div>

    <!-- 普通叶子 / 未知类型：共用摘要文本，未知类型原文只读 -->
    <div v-else class="condition-tree__leaf">
      <span class="condition-tree__text">{{ node.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.condition-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.condition-tree__children {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-left: 12px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
}
.condition-tree__combinator,
.condition-tree__leaf,
.condition-tree__prereq {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 11.5px;
  line-height: 1.4;
}
.condition-tree__text { color: var(--text); }
.condition-tree__combinator .condition-tree__text { color: var(--text-secondary); }
.condition-tree__prereq-label { color: var(--text-secondary); }
.condition-tree__prereq-target { color: var(--text); overflow-wrap: anywhere; }
.condition-tree__status {
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  font-size: 10px;
  color: var(--text-secondary);
}
.condition-tree__status--success { color: var(--success); border-color: var(--success); }
.condition-tree__status--error { color: var(--error); border-color: var(--error); }
.condition-tree__status--warning { color: var(--warning); border-color: var(--warning); }
.condition-tree__status--muted { color: var(--text-muted); border-color: var(--border); }
</style>
