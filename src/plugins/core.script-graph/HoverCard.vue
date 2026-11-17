<script setup lang="ts">
/**
 * 悬停 / 定位卡片（05-03）。
 *
 * 速览：名称与元信息、全部触发器、条件摘要（索引带条件时）、前置列表。
 * 唯一写操作是「换目标 / 删除 / 加前置」→ DependencyEditor；不改触发器本身。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import type { GraphNode, GraphRequirement, GraphTrigger } from '../../core/graph/types.ts'
import {
  canEditRequirement,
  conditionSummary,
  hasConditionData,
  requirementStatusLabel,
  requirementStatusOf,
  requirementTargetLabel,
  requirementTypeLabel,
  triggerMetaLine,
} from './labels.ts'
import { useGraphController } from './state.ts'

const props = defineProps<{
  node: GraphNode
  pinned: boolean
  focusTrigger: string | null
  focusRequirement: number | null
  left: number
  top: number
  maxHeight: number
}>()

const emit = defineEmits<{ close: [] }>()

const controller = useGraphController()
const focusedTriggerEl = ref<HTMLElement | null>(null)

const degree = computed(() => controller.degrees.value.get(props.node.path) ?? { requirements: 0, dependents: 0 })
const metaParts = computed(() => {
  const parts: string[] = []
  if (props.node.author !== '') {
    parts.push(`作者 ${props.node.author}`)
  }
  if (props.node.dimension !== '') {
    parts.push(`维度 ${props.node.dimension}`)
  }
  if (props.node.priority !== 0) {
    parts.push(`优先级 ${props.node.priority}`)
  }
  return parts
})
const duration = computed(() => (props.node.infinite ? '无限' : `${props.node.duration.toFixed(1)}s`))
const canAdd = computed(() => props.node.scriptId !== null && props.node.scriptId !== undefined && props.node.scriptId !== '')

const triggerRows = computed(() => props.node.triggers.map((trigger) => ({
  trigger,
  meta: triggerMetaLine(trigger),
  conditions: conditionSummary(trigger),
  hasConditions: hasConditionData(trigger),
  requirements: trigger.requirements.map((requirement) => ({
    requirement,
    status: requirementStatusLabel(requirementStatusOf(requirement)),
    statusKind: requirementStatusOf(requirement),
    target: requirementTargetLabel(requirement),
    editable: canEditRequirement(requirement, props.node),
  })),
})))

function isFocusedTrigger(trigger: GraphTrigger): boolean {
  return props.focusTrigger !== null && props.focusTrigger === trigger.identity
}

function isFocusedRequirement(trigger: GraphTrigger, requirement: GraphRequirement): boolean {
  return isFocusedTrigger(trigger) && props.focusRequirement === requirement.index
}

function setTriggerRef(trigger: GraphTrigger, element: unknown): void {
  if (!isFocusedTrigger(trigger)) {
    return
  }
  focusedTriggerEl.value = element instanceof HTMLElement ? element : null
}

function editRequirement(trigger: GraphTrigger, requirement: GraphRequirement, intent: 'update' | 'delete'): void {
  controller.openDependencyEditor(props.node.path, trigger.identity, requirement.index, intent)
}

function addRequirement(trigger: GraphTrigger): void {
  controller.openDependencyEditor(props.node.path, trigger.identity, null)
}

/** Enter 只在该触发器块本身聚焦时「加前置」；内部按钮的 Enter 交给按钮自己处理。 */
function onTriggerEnter(event: KeyboardEvent, trigger: GraphTrigger): void {
  const target = event.target
  if (target instanceof HTMLElement && target !== event.currentTarget) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  addRequirement(trigger)
}

function openScript(): void {
  void controller.openScript(props.node.path)
}

function copyPath(): void {
  void controller.copyPath(props.node.path)
}

onMounted(() => {
  void nextTick(() => {
    if (props.focusTrigger === null) {
      return
    }
    focusedTriggerEl.value?.focus({ preventScroll: true })
    focusedTriggerEl.value?.scrollIntoView({ block: 'nearest' })
  })
})
</script>

<template>
  <section
    id="script-graph-hover-card"
    class="hover-card"
    :class="{ 'hover-card--pinned': pinned }"
    role="tooltip"
    :style="{ left: `${left}px`, top: `${top}px`, maxHeight: `${maxHeight}px` }"
    data-hover-card="true"
    tabindex="-1"
    @keydown.esc.stop.prevent="emit('close')"
    @focusin="controller.hoverKeep()"
    @pointerenter="controller.hoverKeep()"
    @pointerleave="controller.hoverLeave()"
  >
    <header class="hover-card__head">
      <h3 class="hover-card__title">{{ node.name }}</h3>
      <span v-if="pinned" class="hover-card__pin">已定位</span>
      <button type="button" class="hover-card__close" aria-label="关闭详情" @click="emit('close')">✕</button>
    </header>
    <p class="hover-card__path">{{ node.path }}</p>
    <p class="hover-card__id">id={{ node.scriptId ?? '缺失' }}</p>
    <p v-if="metaParts.length > 0" class="hover-card__meta">{{ metaParts.join(' · ') }}</p>
    <p class="hover-card__meta">
      时长：{{ duration }} · 前置 {{ degree.requirements }} 条 / 依赖方 {{ degree.dependents }} 个
    </p>
    <p v-if="!node.valid" class="hover-card__error">问题：{{ node.error ?? '脚本无效' }}</p>

    <div class="hover-card__triggers">
      <p class="hover-card__section">触发器（{{ node.triggers.length }}）</p>
      <p v-if="node.triggers.length === 0" class="hover-card__empty">
        该脚本没有触发器；本卡片不新建触发器。
      </p>

      <article
        v-for="(row, index) in triggerRows"
        :key="row.trigger.identity"
        :ref="(element) => setTriggerRef(row.trigger, element)"
        class="trigger-block"
        :class="{ 'trigger-block--focused': isFocusedTrigger(row.trigger) }"
        tabindex="0"
        :aria-label="`触发器 ${row.trigger.type}（${row.trigger.identity}）展开加前置`"
        @keydown.enter="onTriggerEnter($event, row.trigger)"
      >
        <header class="trigger-block__head">
          <span class="trigger-block__type">{{ row.trigger.type }}</span>
          <span class="trigger-block__meta">{{ row.meta }}</span>
          <span class="trigger-block__index">#{{ index + 1 }}</span>
        </header>
        <p class="trigger-block__identity">identity={{ row.trigger.identity }}</p>
        <p class="trigger-block__conditions" :class="{ 'trigger-block__conditions--missing': !row.hasConditions }">
          {{ row.conditions ?? '条件摘要不可用（索引未提供 conditions）' }}
        </p>

        <p class="trigger-block__label">前置：</p>
        <p v-if="row.requirements.length === 0" class="trigger-block__empty">无</p>
        <ul v-else class="requirement-list">
          <li
            v-for="item in row.requirements"
            :key="`${row.trigger.identity}-${item.requirement.index}`"
            class="requirement-row"
            :class="{ 'requirement-row--focused': isFocusedRequirement(row.trigger, item.requirement) }"
          >
            <span class="requirement-row__index">[{{ item.requirement.index }}]</span>
            <span class="requirement-row__type">{{ requirementTypeLabel(item.requirement.type) }}</span>
            <span class="requirement-row__arrow">→</span>
            <span class="requirement-row__target" :title="item.target">{{ item.target }}</span>
            <span class="requirement-row__status" :data-status="item.statusKind">{{ item.status }}</span>
            <span v-if="item.editable" class="requirement-row__actions">
              <button
                type="button"
                class="mini-button"
                :aria-label="`替换第 ${item.requirement.index + 1} 条前置（${item.target}）`"
                @click="editRequirement(row.trigger, item.requirement, 'update')"
              >换目标</button>
              <button
                type="button"
                class="mini-button mini-button--danger"
                :aria-label="`删除第 ${item.requirement.index + 1} 条前置（${item.target}）`"
                @click="editRequirement(row.trigger, item.requirement, 'delete')"
              >删除</button>
            </span>
          </li>
        </ul>
        <button
          v-if="canAdd"
          type="button"
          class="trigger-block__add"
          :aria-label="`为触发器 ${row.trigger.type} 加前置`"
          @click="addRequirement(row.trigger)"
        >+ 加前置</button>
        <p v-else class="trigger-block__note">当前脚本没有 meta.id：先设置脚本 id 后才能加前置。</p>
      </article>
    </div>

    <footer class="hover-card__footer">
      <button type="button" class="card-button" @click="openScript">打开脚本</button>
      <button type="button" class="card-button" @click="copyPath">复制路径</button>
    </footer>
  </section>
</template>

<style scoped>
.hover-card {
  position: absolute;
  z-index: 30;
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 8px 24px var(--shadow);
  overflow: auto;
  pointer-events: auto;
  user-select: text;
}
.hover-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.hover-card--pinned { border-color: var(--selection-outline); }
.hover-card__head { display: flex; align-items: center; gap: 8px; }
.hover-card__title { margin: 0; font-size: 14px; font-weight: 600; flex: 1 1 auto; min-width: 0; }
.hover-card__pin { color: var(--accent); font-size: 11px; }
.hover-card__close {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 3px;
}
.hover-card__path, .hover-card__id, .hover-card__meta {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.hover-card__error { margin: 0; color: var(--error); font-size: 11px; }
.hover-card__triggers { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.hover-card__section { margin: 0; color: var(--text-secondary); font-size: 11px; font-weight: 600; }
.hover-card__empty { margin: 0; color: var(--text-muted); font-size: 11px; }
.trigger-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
}
.trigger-block:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.trigger-block--focused { border-color: var(--accent); }
.trigger-block__head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.trigger-block__type { font-size: 12px; font-weight: 600; }
.trigger-block__meta { color: var(--text-secondary); font-size: 11px; }
.trigger-block__index { margin-left: auto; color: var(--text-muted); font-size: 10px; }
.trigger-block__identity { margin: 0; color: var(--text-muted); font-size: 10px; }
.trigger-block__conditions { margin: 0; font-size: 11px; color: var(--text-secondary); overflow-wrap: anywhere; }
.trigger-block__conditions--missing { color: var(--text-muted); font-style: italic; }
.trigger-block__label { margin: 2px 0 0; font-size: 10.5px; color: var(--text-secondary); }
.trigger-block__empty { margin: 0; font-size: 10.5px; color: var(--text-muted); }
.requirement-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.requirement-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 11px;
}
.requirement-row--focused { background: var(--bg-hover); outline: 1px solid var(--accent); }
.requirement-row__index { color: var(--text-muted); font-size: 10px; }
.requirement-row__type { color: var(--text); }
.requirement-row__arrow { color: var(--text-muted); }
.requirement-row__target { color: var(--text-secondary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.requirement-row__status { padding: 0 4px; border-radius: 3px; border: 1px solid var(--border-strong); font-size: 10px; color: var(--text-secondary); }
.requirement-row__status[data-status="resolved"] { color: var(--success); border-color: var(--success); }
.requirement-row__status[data-status="missing"] { color: var(--error); border-color: var(--error); }
.requirement-row__status[data-status="self"] { color: var(--warning); border-color: var(--warning); }
.requirement-row__status[data-status="duplicate"] { color: var(--warning); border-color: var(--warning); }
.requirement-row__status[data-status="custom"] { color: var(--text-muted); }
.requirement-row__actions { display: inline-flex; gap: 4px; margin-left: auto; }
.mini-button {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 10px;
  cursor: pointer;
}
.mini-button:hover { background: var(--bg-hover); }
.mini-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.mini-button--danger { color: var(--error); }
.trigger-block__add {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.trigger-block__add:hover { background: var(--bg-hover); color: var(--text); }
.trigger-block__add:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.trigger-block__note { margin: 0; color: var(--text-muted); font-size: 10.5px; }
.hover-card__footer { display: flex; gap: 6px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--border); }
.card-button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}
.card-button:hover { background: var(--bg-hover); }
.card-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
