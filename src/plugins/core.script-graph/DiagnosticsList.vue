<script setup lang="ts">
/**
 * 关系诊断列表（05-05 / 05-08）。
 *
 * 只读：按 kind 分组、可滚动；点击定位到节点 / 触发器 / 前置条目。
 * 计数用 `stats.warningCount`（截断前的真实总数），列表按服务端上限显示。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import type { GraphWarning, GraphWarningKind } from '../../core/graph/types.ts'
import { WARNING_KIND_ORDER, warningKindLabel } from './labels.ts'
import { useGraphController } from './state.ts'

const emit = defineEmits<{ close: [] }>()

const controller = useGraphController()
const rootEl = ref<HTMLElement | null>(null)

const graph = computed(() => controller.graph.value)

const groups = computed(() => {
  const warnings = graph.value?.warnings ?? []
  const byKind = new Map<GraphWarningKind, GraphWarning[]>()
  for (const warning of warnings) {
    const list = byKind.get(warning.kind) ?? []
    list.push(warning)
    byKind.set(warning.kind, list)
  }
  return WARNING_KIND_ORDER
    .map((kind) => ({ kind, label: warningKindLabel(kind), warnings: byKind.get(kind) ?? [] }))
    .filter((group) => group.warnings.length > 0)
})

const total = computed(() => graph.value?.stats.warningCount ?? 0)
const shown = computed(() => graph.value?.warnings.length ?? 0)
const truncated = computed(() => graph.value?.stats.warningsTruncated === true)

function locate(warning: GraphWarning): void {
  controller.locateWarning(warning)
}

function onEscape(): void {
  emit('close')
}

onMounted(() => {
  void nextTick(() => rootEl.value?.focus())
})
</script>

<template>
  <section
    ref="rootEl"
    class="diagnostics"
    role="region"
    aria-label="关系诊断列表"
    tabindex="-1"
    @keydown.esc.stop.prevent="onEscape"
  >
    <header class="diagnostics__head">
      <div>
        <h2 class="diagnostics__title">关系诊断</h2>
        <p class="diagnostics__sub">
          共 {{ total }} 条问题<span v-if="truncated">（仅显示前 {{ shown }} 条，完整计数以统计为准）</span>
        </p>
      </div>
      <button type="button" class="diagnostics__close" aria-label="关闭诊断列表" @click="emit('close')">✕</button>
    </header>

    <p v-if="total === 0" class="diagnostics__empty">没有诊断问题。</p>
    <div v-else class="diagnostics__body">
      <section v-for="group in groups" :key="group.kind" class="diagnostics__group">
        <h3 class="diagnostics__group-title">
          {{ group.label }}
          <span class="diagnostics__count">{{ group.warnings.length }}</span>
        </h3>
        <ul class="diagnostics__list">
          <li v-for="(warning, index) in group.warnings" :key="`${group.kind}:${warning.path}:${warning.triggerIdentity ?? ''}:${warning.requirementIndex ?? ''}:${index}`">
            <button
              type="button"
              class="diagnostics__row"
              :aria-label="`定位：${group.label}，${warning.message}（${warning.path}）`"
              @click="locate(warning)"
            >
              <span class="diagnostics__message">{{ warning.message }}</span>
              <span class="diagnostics__path">{{ warning.path }}</span>
              <span v-if="warning.triggerIdentity !== undefined" class="diagnostics__where">
                触发器 {{ warning.triggerIdentity }}<template v-if="warning.requirementIndex !== undefined"> · 第 {{ warning.requirementIndex }} 条前置</template>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.diagnostics {
  position: absolute;
  right: 8px;
  top: 42px;
  bottom: 34px;
  z-index: 25;
  width: 400px;
  max-width: calc(100% - 16px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 10px 30px var(--shadow);
  overflow: hidden;
}
.diagnostics:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.diagnostics__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.diagnostics__title { margin: 0; font-size: 13px; }
.diagnostics__sub { margin: 2px 0 0; color: var(--text-muted); font-size: 10.5px; }
.diagnostics__close {
  margin-left: auto;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.diagnostics__close:focus-visible, .diagnostics__row:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.diagnostics__empty { margin: 0; padding: 16px; color: var(--text-muted); font-size: 12px; }
.diagnostics__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px 8px 10px; }
.diagnostics__group { margin-bottom: 10px; }
.diagnostics__group-title {
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11.5px;
}
.diagnostics__count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-raised);
  color: var(--text-muted);
  font-size: 10px;
}
.diagnostics__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.diagnostics__row {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.diagnostics__row:hover { background: var(--bg-hover); }
.diagnostics__message { font-size: 11.5px; overflow-wrap: anywhere; }
.diagnostics__path { color: var(--text-muted); font-size: 10px; overflow-wrap: anywhere; }
.diagnostics__where { color: var(--text-secondary); font-size: 10px; }
</style>
