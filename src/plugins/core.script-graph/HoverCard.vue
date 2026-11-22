<script setup lang="ts">
/**
 * 脚本节点悬停卡（11-02 升级为只读全量摘要）。
 *
 * 卡片内容：全部触发器 + 每条完整条件树（任意深度组合器）+ 全部前置；
 * 条件文案只复用 `describeTriggerCondition`（纯函数层唯一摘要生成处），
 * 前置只展示目标脚本名，不展示解析状态；唯一命中的内置目标把 id 放进 title。
 * 卡片内选中只是临时态，不写 `state.selection`；
 * 没有任何输入控件、没有编辑入口。读取失败退回节点摘要并提示条件暂不可用。
 */
import { computed, ref, watch } from 'vue'
import type { GraphNode, GraphRequirement, GraphTrigger } from '../../core/graph/types.ts'
import {
  conditionSummary,
  continuitySummary,
  delayLabel,
  requirementTargetLabel,
  requirementTypeLabel,
  repeatableLabel,
  triggerTypeLabel,
} from './labels.ts'
import {
  triggerMetaParts,
  type HoverSummaryOutcome,
} from './hoverSummary.ts'
import ConditionTreeView from './ConditionTreeView.vue'
import { useGraphController } from './state.ts'

const props = defineProps<{
  node: GraphNode
  pinned: boolean
  left: number
  top: number
  maxHeight: number
  /** 诊断定位带来的触发器身份（仅用于卡片内临时预选，不写选区）。 */
  focusTrigger?: string | null
}>()

const controller = useGraphController()

/** 读取结果；`null` 表示正在读取。 */
const summary = ref<HoverSummaryOutcome | null>(null)
/** 卡片内临时选中的触发器身份；离开卡片即失效，不落 `state.selection`。 */
const selectedIdentity = ref<string | null>(null)
/** 异步竞态序号：节点切换后旧响应不回写。 */
let loadSeq = 0

watch(
  () => props.node.path,
  () => {
    void load()
  },
  { immediate: true },
)

async function load(): Promise<void> {
  const seq = ++loadSeq
  selectedIdentity.value = props.focusTrigger ?? null
  summary.value = null
  const outcome = await controller.hoverSummaryFor(props.node)
  if (seq !== loadSeq) {
    return
  }
  summary.value = outcome
  if (outcome.ok && props.focusTrigger !== null) {
    const hit = outcome.summary?.triggers.find((trigger) => trigger.identity === props.focusTrigger)
    if (hit !== undefined) {
      selectedIdentity.value = hit.identity
    }
  }
}

const fallbackTriggers = computed<GraphTrigger[]>(() => props.node.triggers)

/** 图中 scriptId 唯一且有效的目标：id → 节点。重复 id 不参与名称解析。 */
const uniqueScriptTargets = computed(() => {
  const nodes = controller.graph.value?.nodes ?? []
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.scriptId === null || node.scriptId === undefined || node.scriptId === '') continue
    counts.set(node.scriptId, (counts.get(node.scriptId) ?? 0) + 1)
  }
  const result = new Map<string, GraphNode>()
  for (const node of nodes) {
    const scriptId = node.scriptId
    if (!node.valid || scriptId === null || scriptId === undefined || scriptId === '') continue
    if (counts.get(scriptId) === 1) result.set(scriptId, node)
  }
  return result
})

function targetNodeFor(target: string | undefined): GraphNode | undefined {
  return target === undefined ? undefined : uniqueScriptTargets.value.get(target)
}

function targetDisplayName(target: string | undefined): string | undefined {
  const node = targetNodeFor(target)
  if (node === undefined) return undefined
  return node.name.trim() === '' ? target : node.name.trim()
}

function targetTitle(target: string | undefined): string | undefined {
  const node = targetNodeFor(target)
  return node === undefined || target === undefined ? undefined : `${targetDisplayName(target)} · id=${target} · ${node.path}`
}

function toggleSelect(identity: string): void {
  selectedIdentity.value = selectedIdentity.value === identity ? null : identity
}

function isSelected(identity: string): boolean {
  return selectedIdentity.value === identity
}

function locate(): void {
  if (selectedIdentity.value === null) {
    return
  }
  void controller.locateTrigger(props.node.path, selectedIdentity.value)
}

function openScript(): void {
  void controller.openScript(props.node.path)
}

// ── 读取失败时的节点摘要回退（图索引既有一层信息；条件区明示暂不可用）─────────────

function fallbackCondition(trigger: GraphTrigger): string | null {
  return conditionSummary(trigger)
}

function fallbackRequirementLabel(requirement: GraphRequirement): string {
  return requirementTypeLabel(requirement.type)
}

function fallbackRequirementTarget(requirement: GraphRequirement): string {
  return targetDisplayName(requirement.scriptId) ?? requirementTargetLabel(requirement)
}

function fallbackRepeatable(trigger: GraphTrigger): string {
  return repeatableLabel(trigger)
}

function fallbackDelay(trigger: GraphTrigger): string | null {
  return delayLabel(trigger)
}

function fallbackContinuity(trigger: GraphTrigger): string | null {
  return continuitySummary(trigger)
}

function fallbackTypeLabel(trigger: GraphTrigger): string {
  return triggerTypeLabel(trigger.type)
}
</script>

<template>
  <aside
    class="hover-card"
    :class="{ 'hover-card--pinned': pinned }"
    :style="{ left: `${left}px`, top: `${top}px`, maxHeight: `${maxHeight}px` }"
    role="dialog"
    :aria-label="`脚本 ${node.name} 的只读摘要`"
  >
    <header class="hover-card__head">
      <div class="hover-card__title">{{ node.name }}</div>
      <div class="hover-card__path" :title="node.path">{{ node.path }}</div>
    </header>

    <div class="hover-card__body">
      <!-- 读取中 -->
      <p v-if="summary === null" class="hover-card__note">读取中…</p>

      <!-- 读取失败：退回节点摘要，条件区明示暂不可用（不弹窗、不空白） -->
      <template v-else-if="!summary.ok">
        <p class="hover-card__note hover-card__note--error">读取失败，条件暂不可用</p>
        <section v-if="fallbackTriggers.length === 0" class="hover-card__empty">没有触发器。</section>
        <section v-for="trigger in fallbackTriggers" :key="trigger.identity" class="hover-trigger hover-trigger--fallback">
          <div class="hover-trigger__head">
            <span class="hover-trigger__label">{{ fallbackTypeLabel(trigger) }}</span>
            <span class="hover-trigger__identity">{{ trigger.identity }}</span>
            <span class="hover-trigger__meta">
              {{ fallbackRepeatable(trigger) }}<template v-if="fallbackDelay(trigger) !== null"> · {{ fallbackDelay(trigger) }}</template><template v-if="fallbackContinuity(trigger) !== null"> · {{ fallbackContinuity(trigger) }}</template>
            </span>
          </div>
          <div class="hover-trigger__body">
            <p v-if="fallbackCondition(trigger) !== null" class="hover-trigger__condition">{{ fallbackCondition(trigger) }}</p>
            <ul v-if="trigger.requirements.length > 0" class="hover-reqs">
              <li v-for="requirement in trigger.requirements" :key="requirement.index" class="hover-req">
                <template v-if="targetNodeFor(requirement.scriptId) !== undefined">
                  <span class="hover-req__target" :title="targetTitle(requirement.scriptId)">{{ fallbackRequirementTarget(requirement) }}</span>
                </template>
                <template v-else>
                  <span class="hover-req__type">{{ fallbackRequirementLabel(requirement) }}</span>
                  <span class="hover-req__target">{{ fallbackRequirementTarget(requirement) }}</span>
                </template>
              </li>
            </ul>
          </div>
        </section>
      </template>

      <!-- 读取成功：全部触发器 + 完整条件树 + 全部前置 -->
      <template v-else>
        <section v-if="summary.summary!.triggers.length === 0" class="hover-card__empty">没有触发器。</section>
        <section
          v-for="view in summary.summary!.triggers"
          :key="view.identity"
          class="hover-trigger"
          :class="{ 'hover-trigger--selected': isSelected(view.identity) }"
        >
          <button
            type="button"
            class="hover-trigger__head"
            :aria-pressed="isSelected(view.identity)"
            @click="toggleSelect(view.identity)"
          >
            <span class="hover-trigger__label">{{ view.label }}</span>
            <span class="hover-trigger__identity">{{ view.identity }}</span>
            <span class="hover-trigger__meta">{{ triggerMetaParts(view).join(' · ') }}</span>
          </button>

          <div class="hover-trigger__body">
            <div class="hover-trigger__block">
              <p class="hover-trigger__block-title">条件</p>
              <ConditionTreeView v-if="view.conditionTree !== null" :node="view.conditionTree" />
              <p v-else class="hover-card__note">无场景条件</p>
            </div>

            <div class="hover-trigger__block">
              <p class="hover-trigger__block-title">前置</p>
              <ul v-if="view.requirements.length > 0" class="hover-reqs">
                <li v-for="requirement in view.requirements" :key="requirement.index" class="hover-req">
                  <template v-if="targetNodeFor(requirement.target) !== undefined">
                    <span class="hover-req__target" :title="targetTitle(requirement.target)">{{ targetDisplayName(requirement.target) }}</span>
                  </template>
                  <template v-else>
                    <span class="hover-req__type">{{ requirement.typeLabel }}</span>
                    <span v-if="requirement.target !== undefined" class="hover-req__target">→ {{ requirement.target }}</span>
                    <span v-if="requirement.rawText !== ''" class="hover-req__raw">{{ requirement.rawText }}</span>
                  </template>
                </li>
              </ul>
              <p v-else class="hover-card__note">无前置</p>
            </div>
          </div>
        </section>
      </template>
    </div>

    <footer class="hover-card__foot">
      <button
        type="button"
        class="hover-card__action"
        :disabled="selectedIdentity === null"
        :title="selectedIdentity === null ? '先在卡片内选中一条触发器' : '打开脚本并定位到该触发器（不播放、不 seek）'"
        @click="locate"
      >
        定位到触发器
      </button>
      <button type="button" class="hover-card__action" @click="openScript">打开脚本</button>
    </footer>
  </aside>
</template>

<style scoped>
.hover-card {
  position: absolute;
  z-index: 30;
  width: 320px;
  max-width: calc(100vw - 16px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 10px 30px var(--shadow);
  overflow: hidden;
}
.hover-card--pinned { border-color: var(--focus); }

.hover-card__head {
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--border);
}
.hover-card__title { margin: 0; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.hover-card__path { margin: 2px 0 0; color: var(--text-muted); font-size: 10.5px; overflow-wrap: anywhere; }

/* 卡片内部滚动：条件树 / 前置任意长，不折叠、不截断。 */
.hover-card__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hover-card__note { margin: 0; color: var(--text-muted); font-size: 11px; }
.hover-card__note--error { color: var(--warning); }
.hover-card__empty { margin: 0; color: var(--text-muted); font-size: 11.5px; }

.hover-trigger {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
  padding: 6px 8px;
}
.hover-trigger--selected { border-color: var(--focus); }
.hover-trigger--fallback { background: transparent; }

.hover-trigger__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.hover-trigger__head:hover { color: var(--text-secondary); }
.hover-trigger__head:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.hover-trigger__label { font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.hover-trigger__identity { color: var(--text-muted); font-size: 10.5px; overflow-wrap: anywhere; }
.hover-trigger__meta { margin-left: auto; color: var(--text-secondary); font-size: 10.5px; }

.hover-trigger__body { display: flex; flex-direction: column; gap: 6px; }
.hover-trigger__block { display: flex; flex-direction: column; gap: 3px; }
.hover-trigger__block-title {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}
.hover-trigger__condition { margin: 0; font-size: 11.5px; overflow-wrap: anywhere; }

.hover-reqs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.hover-req {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 11.5px;
}
.hover-req__type { color: var(--text-secondary); }
.hover-req__target { overflow-wrap: anywhere; }
.hover-req__raw { flex-basis: 100%; color: var(--text-muted); font-size: 10px; overflow-wrap: anywhere; }

.hover-card__foot {
  display: flex;
  gap: 6px;
  padding: 6px 10px 8px;
  border-top: 1px solid var(--border);
}
.hover-card__action {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11.5px;
  cursor: pointer;
}
.hover-card__action:hover:not(:disabled) { background: var(--bg-hover); }
.hover-card__action:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.hover-card__action:disabled { color: var(--text-muted); cursor: default; }
</style>
