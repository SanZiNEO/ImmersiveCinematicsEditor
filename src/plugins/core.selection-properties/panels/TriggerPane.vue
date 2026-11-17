<script setup lang="ts">
/**
 * 「触发器」tab（05-13）。
 *
 * 左列列出当前脚本的全部触发器（type / identity / 重复性 / delay / 前置数），
 * 右侧编辑选中触发器的字段、条件与前置。选择身份只用 `identity`，不用数组下标。
 */
import { computed, ref, watch } from 'vue'
import type { ScriptView, TriggerViewEntry } from '../../../workbench/api/documents.ts'
import TriggerConditionsForm from './TriggerConditionsForm.vue'
import TriggerFieldsForm from './TriggerFieldsForm.vue'
import TriggerRequirementsEditor from './TriggerRequirementsEditor.vue'

const props = defineProps<{
  view: ScriptView
}>()

const selectedIdentity = ref<string | null>(null)

const triggers = computed(() => props.view.triggers)
const identities = computed(() => triggers.value.map((trigger) => trigger.identity))

watch(
  identities,
  (ids) => {
    if (selectedIdentity.value === null || !ids.includes(selectedIdentity.value)) {
      selectedIdentity.value = ids[0] ?? null
    }
  },
  { immediate: true },
)

const selected = computed<TriggerViewEntry | undefined>(() =>
  triggers.value.find((trigger) => trigger.identity === selectedIdentity.value),
)

function selectTrigger(trigger: TriggerViewEntry): void {
  selectedIdentity.value = trigger.identity
}

function conditionCount(trigger: TriggerViewEntry): number {
  return Object.keys(trigger.conditions).length
}
</script>

<template>
  <section class="trigger-pane" aria-label="触发器">
    <p v-if="triggers.length === 0" class="trigger-empty">
      当前脚本没有触发器。触发器的新建 / 删除不在本面板；本面板只编辑已有触发器。
    </p>

    <div v-else class="trigger-layout">
      <aside class="trigger-list" role="listbox" aria-label="触发器列表">
        <button
          v-for="trigger in triggers"
          :key="trigger.identity"
          type="button"
          role="option"
          class="trigger-item"
          :class="{ 'trigger-item--active': trigger.identity === selectedIdentity }"
          :aria-selected="trigger.identity === selectedIdentity"
          @click="selectTrigger(trigger)"
        >
          <span class="trigger-item__type">{{ trigger.type }}</span>
          <span class="trigger-item__identity">{{ trigger.identity }}</span>
          <span class="trigger-item__meta">
            {{ trigger.repeatable ? '可重复' : '单次' }}
            <template v-if="trigger.delay > 0"> · delay {{ trigger.delay }}s</template>
            · 条件 {{ conditionCount(trigger) }} · 前置 {{ trigger.requirements.length }}
          </span>
        </button>
      </aside>

      <div v-if="selected !== undefined" class="trigger-detail">
        <TriggerFieldsForm :key="`fields:${selected.identity}`" :trigger="selected" />
        <TriggerConditionsForm :key="`conditions:${selected.identity}`" :trigger="selected" />
        <TriggerRequirementsEditor :key="`requires:${selected.identity}`" :trigger="selected" :view="view" />
      </div>
      <p v-else class="trigger-empty">请选择一个触发器。</p>
    </div>
  </section>
</template>

<style scoped>
.trigger-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  container-type: inline-size;
}

.trigger-empty {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.trigger-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.trigger-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.trigger-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.trigger-item:hover {
  background: var(--bg-hover);
}

.trigger-item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.trigger-item--active {
  border-color: var(--selection-outline);
  box-shadow: inset 0 0 0 1px var(--selection-outline);
}

.trigger-item__type {
  font-size: 12px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.trigger-item__identity {
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  overflow-wrap: anywhere;
}

.trigger-item__meta {
  color: var(--text-secondary);
}

.trigger-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

@container (min-width: 480px) {
  .trigger-layout {
    grid-template-columns: minmax(148px, 0.85fr) minmax(0, 1.5fr);
  }
}
</style>
