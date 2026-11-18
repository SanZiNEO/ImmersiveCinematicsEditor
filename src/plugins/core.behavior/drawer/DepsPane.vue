<script setup lang="ts">
/**
 * 依赖页（11-01 §三 / 11-11 边界）：只读展示选中记录的引用与事实索引。
 *
 * 本页没有输入框，不能改引用；事实是否成立不读运行态，只看文档引用解析状态。
 * 完整事实字典 / 索引在「事实」页签（FactInspectorTab）。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { factIndex, type FactReference } from '../../../features/behavior/facts.ts'
import { referencesToBinding } from '../../../features/behavior/bindings.ts'
import type { RecordRef } from '../../../features/behavior/shared.ts'
import type { BehaviorModel, RuleRow, BindingRow } from './drawerModel.ts'

const props = defineProps<{
  root: JsonObject | null
  model: BehaviorModel
  selected: RecordRef | null
}>()

const index = computed(() => {
  if (props.root === null) return null
  return factIndex(props.root, {
    scriptIds: props.model.selfScriptId ? new Set([props.model.selfScriptId]) : new Set(),
    clipIds: props.model.refs.clipIds,
    bindingIds: props.model.refs.bindingIds,
    selfScriptId: props.model.selfScriptId,
  })
})

const selectedRule = computed<RuleRow | null>(() => {
  if (props.selected?.kind !== 'rule') return null
  return props.model.ruleById.get(props.selected.id) ?? null
})

const selectedBinding = computed<BindingRow | null>(() => {
  if (props.selected?.kind !== 'binding') return null
  return props.model.bindingById.get(props.selected.id) ?? null
})

const inboundReferences = computed<FactReference[]>(() => {
  if (props.root === null || props.selected === null || index.value === null) return []
  const selected = props.selected
  const prefix =
    selected.kind === 'rule'
      ? `rules[${props.model.ruleById.get(selected.id)?.index ?? -1}]`
      : selected.kind === 'binding'
        ? `rule_bindings[${props.model.bindingById.get(selected.id)?.index ?? -1}]`
        : ''
  if (prefix.length === 0) return []
  return index.value.references.filter((reference) => reference.location.startsWith(prefix))
})

const bindingReferrers = computed(() => {
  if (props.root === null || selectedBinding.value === null) return []
  return referencesToBinding(props.root, selectedBinding.value.ref.id)
})

const overview = computed(() => index.value?.overview ?? null)
const allReferences = computed<FactReference[]>(() => index.value?.references ?? [])
</script>

<template>
  <div class="deps-pane">
    <!-- 选中规则 -->
    <section v-if="selectedRule" class="deps-pane__section">
      <h3 class="deps-pane__heading">规则 {{ selectedRule.id }} 的依赖</h3>
      <p class="deps-pane__meta">被 {{ selectedRule.bindingCount }} 条绑定引用。</p>
      <ul class="deps-pane__list">
        <li v-for="binding in selectedRule.bindings" :key="binding.ref.id">{{ binding.summary }}</li>
      </ul>
      <h4 class="deps-pane__subheading">条件 / 调度里的事实引用</h4>
      <ul class="deps-pane__list">
        <li v-for="reference in inboundReferences" :key="`${reference.location}:${reference.name}`">
          <span class="deps-pane__fact-name">{{ reference.name }}</span>
          <span class="deps-pane__status">{{ reference.status }}</span>
          <span class="deps-pane__location">{{ reference.location }}</span>
        </li>
      </ul>
    </section>

    <!-- 选中绑定 -->
    <section v-else-if="selectedBinding" class="deps-pane__section">
      <h3 class="deps-pane__heading">绑定 {{ selectedBinding.ref.id }} 的依赖</h3>
      <h4 class="deps-pane__subheading">入站引用（谁在等它）</h4>
      <ul class="deps-pane__list">
        <li v-for="(referrer, index) in bindingReferrers" :key="index">{{ referrer.detail }}</li>
        <li v-if="bindingReferrers.length === 0" class="deps-pane__empty">没有其他绑定或条件引用本绑定。</li>
      </ul>
      <h4 class="deps-pane__subheading">出站事实引用</h4>
      <ul class="deps-pane__list">
        <li v-for="reference in inboundReferences" :key="`${reference.location}:${reference.name}`">
          <span class="deps-pane__fact-name">{{ reference.name }}</span>
          <span class="deps-pane__status">{{ reference.status }}</span>
          <span class="deps-pane__location">{{ reference.location }}</span>
        </li>
      </ul>
    </section>

    <!-- 总览 -->
    <section v-else class="deps-pane__section">
      <h3 class="deps-pane__heading">全部依赖总览</h3>
      <p v-if="overview" class="deps-pane__meta">
        可引用 {{ overview.referencableCount }} · 已引用 {{ overview.referencedCount }} ·
        未使用 {{ overview.unusedCount }} · 不可解析 {{ overview.unresolvableCount }}
      </p>
      <ul class="deps-pane__list">
        <li v-for="reference in allReferences" :key="`${reference.location}:${reference.name}`">
          <span class="deps-pane__fact-name">{{ reference.name }}</span>
          <span class="deps-pane__status">{{ reference.status }}</span>
          <span class="deps-pane__location">{{ reference.location }}</span>
        </li>
      </ul>
      <p v-if="allReferences.length === 0" class="deps-pane__empty">当前文档没有事实引用。</p>
    </section>
  </div>
</template>

<style scoped>
.deps-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
}

.deps-pane__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deps-pane__heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.deps-pane__subheading {
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 600;
}

.deps-pane__meta {
  margin: 0;
  color: var(--text-secondary);
}

.deps-pane__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.deps-pane__list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.deps-pane__fact-name {
  font-family: var(--font-mono, monospace);
}

.deps-pane__status {
  color: var(--text-muted);
  font-size: 10px;
}

.deps-pane__location {
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-muted);
}

.deps-pane__empty {
  margin: 0;
  color: var(--text-muted);
}
</style>
