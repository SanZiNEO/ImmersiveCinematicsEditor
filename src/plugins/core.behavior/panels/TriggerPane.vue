<script setup lang="ts">
/**
 * 「行为触发器」右栏面板：列表 + 唯一详情编辑器（11-02…11-05）。
 *
 * 选择只按记录身份（显式 id 或 `type#下标`），不写主选择 `state.selection`。
 * 记录级草稿：同一时间只有一份本地草稿；切换记录时问「应用 / 放弃 / 取消」；
 * 应用一批命令合成一个撤销项；新增先落本地草稿，取消不留空对象。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { cloneJson } from '../../../core/doc/json.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import {
  TRIGGER_ID_PATTERN,
} from '../../../features/behavior/trigger.ts'
import {
  triggerAddIntent,
  triggerMoveIntent,
  triggerRemoveIntent,
  triggerSetIdIntent,
  triggerSetTypeIntent,
} from '../../../features/behavior/commands.ts'
import type { FocusRequest } from '../../../features/behavior/focus.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import {
  diffDraft,
  draftBlockingProblems,
  emptyTriggerDraft,
  isDraftDirty,
  type PanelScriptContext,
  type PanelTrigger,
} from './triggerPanelModel.ts'
import TriggerIdentitySection from './TriggerIdentitySection.vue'
import TriggerActionCard from './TriggerActionCard.vue'
import TriggerTimingSection from './TriggerTimingSection.vue'
import TriggerConditionsSection from './TriggerConditionsSection.vue'
import TriggerRequirementsSection from './TriggerRequirementsSection.vue'
import TriggerDiagnosticsSection from './TriggerDiagnosticsSection.vue'

const props = defineProps<{
  rows: PanelTrigger[]
  meta: JsonObject | null
  scriptContext: PanelScriptContext
  focusRequest: FocusRequest | null
}>()

const rawTriggerCount = computed(() => {
  const raw = props.meta?.triggers
  return Array.isArray(raw) ? raw.length : 0
})

const emit = defineEmits<{ 'focus-consumed': [] }>()

const ctx = usePanelContext()

const selectedIdentity = ref<string | null>(null)
/** 选中记录的声明下标：身份回落（置空 id / 撤销恢复）时按下标兜底，避免掉出选中。 */
const selectedIndex = ref<number | null>(null)
const draft = ref<JsonObject | null>(null)
const draftOrigin = ref<JsonObject | null>(null)
const isNew = ref(false)
const pendingIdentity = ref<string | null>(null)
const pendingMove = ref<{ from: number; to: number } | null>(null)
const confirmRemove = ref(false)
const note = ref('')
const noteKind = ref<'info' | 'warning' | 'error'>('info')

const selectedRow = computed<PanelTrigger | undefined>(() => {
  const byIdentity = props.rows.find((row) => row.identity === selectedIdentity.value)
  if (byIdentity !== undefined) return byIdentity
  if (selectedIndex.value !== null) return props.rows[selectedIndex.value]
  return undefined
})

const existingIds = computed<string[]>(() =>
  props.rows
    .map((row) => row.node.explicitId)
    .filter((id): id is string => id !== undefined),
)

function cleanInapplicable(keys: string[]): void {
  const current = selectedRow.value
  const working = draft.value
  if (current === undefined || working === null) return
  const outcome = ctx.commands.commit(
    triggerSetTypeIntent(current.identity, String(working.type ?? current.node.type), keys),
    `trigger-clean:${current.identity}`,
  )
  if (!outcome.ok) {
    flash('error', outcome.error ?? '清理不适用字段失败')
    return
  }
  flash('info', `已点名清理 ${keys.length} 个不适用字段`)
}

const dirty = computed<boolean>(() => {
  if (draftOrigin.value === null || draft.value === null) return isNew.value
  return isDraftDirty(draftOrigin.value, draft.value)
})

function flash(kind: 'info' | 'warning' | 'error', text: string): void {
  noteKind.value = kind
  note.value = text
}

function identityOfDraft(draftRaw: JsonObject, index: number): string {
  return typeof draftRaw.id === 'string' && draftRaw.id.length > 0
    ? draftRaw.id
    : `${typeof draftRaw.type === 'string' ? draftRaw.type : 'unknown'}#${index}`
}

/** 显式 id 与其他触发器碰撞（按声明下标排除自身）。 */
function idCollision(nextId: string, excludeIndex: number): boolean {
  return props.rows.some((row) => row.node.explicitId === nextId && row.node.index !== excludeIndex)
}

function applySelection(identity: string): void {
  const row = props.rows.find((candidate) => candidate.identity === identity)
  pendingIdentity.value = null
  if (row === undefined) {
    selectedIdentity.value = null
    selectedIndex.value = null
    draft.value = null
    draftOrigin.value = null
    isNew.value = false
    return
  }
  selectedIdentity.value = row.identity
  selectedIndex.value = row.node.index
  draftOrigin.value = cloneJson(row.node.raw)
  draft.value = cloneJson(row.node.raw)
  isNew.value = false
  confirmRemove.value = false
}

function selectIdentity(identity: string): void {
  if (dirty.value && !isNew.value) {
    pendingIdentity.value = identity
    return
  }
  if (isNew.value) {
    // 新草稿未应用：切走前也先问一次。
    pendingIdentity.value = identity
    return
  }
  applySelection(identity)
}

function draftIsDirtyCurrent(): boolean {
  return dirty.value
}

// ── 草稿：应用 / 放弃 ────────────────────────────────────────────────────────

function blockingMessages(problems: Array<{ message: string }>): string {
  return problems.map((p) => p.message).join('；')
}

function applyDraft(): void {
  const working = draft.value
  if (working === null) return

  if (isNew.value) {
    const blocking = draftBlockingProblems(working, rawTriggerCount.value, props.scriptContext)
    if (blocking.length > 0) {
      flash('error', `存在阻塞问题，不能创建：${blockingMessages(blocking)}`)
      return
    }
    const nextId = working.id
    if (typeof nextId === 'string' && nextId.length > 0) {
      if (!TRIGGER_ID_PATTERN.test(nextId)) {
        flash('error', `id 必须匹配 ${TRIGGER_ID_PATTERN.source}`)
        return
      }
      if (idCollision(nextId, rawTriggerCount.value)) {
        flash('error', `id「${nextId}」与其他触发器重复，不能保存`)
        return
      }
    }
    const outcome = ctx.commands.commit(triggerAddIntent(rawTriggerCount.value, cloneJson(working)))
    if (!outcome.ok) {
      flash('error', outcome.error ?? '创建触发器失败')
      return
    }
    selectedIdentity.value = identityOfDraft(working, rawTriggerCount.value)
    selectedIndex.value = rawTriggerCount.value
    draft.value = null
    draftOrigin.value = null
    isNew.value = false
    flash('info', '已创建触发器')
    return
  }

  const origin = draftOrigin.value
  const current = selectedRow.value
  if (origin === null || current === undefined) return

  const blocking = draftBlockingProblems(working, current.node.index, props.scriptContext)
  if (blocking.length > 0) {
    flash('error', `新类型校验未通过，不能应用：${blockingMessages(blocking)}`)
    return
  }

  const diff = diffDraft(origin, working)
  const commands: DocCommand[] = []

  if (Object.keys(diff.fieldsPatch).length > 0) {
    commands.push({
      kind: 'trigger.setFields',
      triggerIdentity: current.identity,
      patch: diff.fieldsPatch,
    })
  }
  if (Object.keys(diff.conditionsPatch).length > 0 || diff.conditionsRemove.length > 0) {
    commands.push({
      kind: 'trigger.setConditions',
      triggerIdentity: current.identity,
      patch: diff.conditionsPatch,
      ...(diff.conditionsRemove.length > 0 ? { remove: diff.conditionsRemove } : {}),
    })
  }
  const nextId = working.id
  const nextIdText = typeof nextId === 'string' ? nextId : ''
  if (nextIdText.length > 0) {
    if (!TRIGGER_ID_PATTERN.test(nextIdText)) {
      flash('error', `id 必须匹配 ${TRIGGER_ID_PATTERN.source}`)
      return
    }
    if (idCollision(nextIdText, current.node.index)) {
      flash('error', `id「${nextIdText}」与其他触发器重复，不能保存`)
      return
    }
  }
  // 空串 / 缺省 = 删除 `id` 键（`trigger.setId` 置空分支），身份回落 `type#index`；
  // 空条目不参与唯一性冲突。id 改动放最后：前面的命令仍按旧身份定位。
  if (current.node.explicitId === undefined && diff.idChanged) {
    commands.push(triggerSetIdIntent(current.identity, nextIdText))
    if (diff.typeChanged) {
      commands.push(triggerSetTypeIntent(nextIdText, String(working.type ?? '')))
    }
  } else {
    if (diff.typeChanged) {
      commands.push(triggerSetTypeIntent(current.identity, String(working.type ?? '')))
    }
    if (diff.idChanged) {
      commands.push(triggerSetIdIntent(current.identity, nextIdText))
    }
  }

  if (commands.length === 0) {
    discardDraft()
    return
  }

  const outcome = ctx.commands.commitBatch(commands, `trigger-draft:${current.identity}`)
  if (!outcome.ok) {
    flash('error', outcome.error ?? '应用草稿失败')
    return
  }
  selectedIdentity.value = identityOfDraft(working, current.node.index)
  selectedIndex.value = current.node.index
  draft.value = null
  draftOrigin.value = null
  flash('info', '草稿已应用（一次撤销回到改前）')
}

function discardDraft(): void {
  if (isNew.value) {
    draft.value = null
    draftOrigin.value = null
    isNew.value = false
    selectedIdentity.value = null
    pendingIdentity.value = null
    return
  }
  if (draftOrigin.value !== null) {
    draft.value = cloneJson(draftOrigin.value)
  }
  pendingIdentity.value = null
}

function resolvePending(action: 'apply' | 'discard' | 'cancel'): void {
  if (action === 'cancel') {
    pendingIdentity.value = null
    return
  }
  const target = pendingIdentity.value
  if (action === 'apply') {
    applyDraft()
    pendingIdentity.value = null
    if (target === '__new__') {
      startNewTrigger()
      return
    }
    if (target !== null) applySelection(target)
    return
  }
  discardDraft()
  pendingIdentity.value = null
  if (target === '__new__') {
    startNewTrigger()
    return
  }
  if (target !== null) applySelection(target)
}

// ── 工具条：新增 / 删除 / 移动 ────────────────────────────────────────────────

function startNewTrigger(): void {
  isNew.value = true
  const existing = new Set(existingIds.value)
  draft.value = emptyTriggerDraft(existing)
  draftOrigin.value = null
  selectedIdentity.value = null
  selectedIndex.value = null
  confirmRemove.value = false
  pendingIdentity.value = null
}

function addTrigger(): void {
  if (draftIsDirtyCurrent()) {
    pendingIdentity.value = '__new__'
    return
  }
  startNewTrigger()
}

function requestRemove(): void {
  if (selectedRow.value === undefined) return
  confirmRemove.value = true
}

function confirmRemoveYes(): void {
  const current = selectedRow.value
  if (current === undefined) return
  const outcome = ctx.commands.commit(triggerRemoveIntent(current.identity))
  confirmRemove.value = false
  if (!outcome.ok) {
    flash('error', outcome.error ?? '删除触发器失败')
    return
  }
  selectedIdentity.value = null
  selectedIndex.value = null
  draft.value = null
  draftOrigin.value = null
}

function requestMove(direction: -1 | 1): void {
  const current = selectedRow.value
  if (current === undefined) return
  const to = current.node.index + direction
  if (to < 0 || to >= rawTriggerCount.value) return
  const hasUnnamed = props.rows.some((row) => row.node.explicitId === undefined)
  if (hasUnnamed) {
    pendingMove.value = { from: current.node.index, to }
    return
  }
  commitMove(current.node.index, to)
}

function commitMove(from: number, to: number): void {
  const outcome = ctx.commands.commit(triggerMoveIntent(from, to))
  pendingMove.value = null
  if (!outcome.ok) {
    flash('error', outcome.error ?? '移动触发器失败')
  }
}

// ── 跨面板定位 ──────────────────────────────────────────────────────────────

watch(
  () => props.focusRequest,
  (request) => {
    if (request === null) return
    if (request.target.kind !== 'trigger') return
    const identity = request.target.identity
    // 空串 = 抽屉发起的「新建触发器」模式：本地草稿，不落盘。
    if (identity === '') {
      if (dirty.value) {
        pendingIdentity.value = '__new__'
      } else {
        startNewTrigger()
      }
      emit('focus-consumed')
      return
    }
    const row = props.rows.find((candidate) => candidate.identity === identity)
    if (row === undefined) {
      // 非空身份查不到：原目标已删除，回落总览，不伪造选中。
      ctx.status.notify(`原目标已删除：${identity}`, 'warning')
      selectedIdentity.value = null
      selectedIndex.value = null
      draft.value = null
      draftOrigin.value = null
      isNew.value = false
    } else if (dirty.value) {
      pendingIdentity.value = identity
    } else {
      applySelection(identity)
    }
    emit('focus-consumed')
  },
)

const severityLabel: Record<string, string> = {
  error: '错误',
  block: '阻塞',
  warn: '警告',
  info: '提示',
}
</script>

<template>
  <div class="trigger-pane">
    <div class="trigger-pane__list">
      <div class="trigger-pane__toolbar">
        <button type="button" class="trigger-pane__tool" :disabled="isNew" @click="addTrigger">
          新建
        </button>
        <button
          type="button"
          class="trigger-pane__tool"
          :disabled="selectedRow === undefined || isNew"
          @click="requestRemove"
        >
          删除
        </button>
        <button
          type="button"
          class="trigger-pane__tool"
          :disabled="selectedRow === undefined || selectedRow.node.index === 0"
          @click="requestMove(-1)"
        >
          上移
        </button>
        <button
          type="button"
          class="trigger-pane__tool"
          :disabled="selectedRow === undefined || selectedRow.node.index === rawTriggerCount - 1"
          @click="requestMove(1)"
        >
          下移
        </button>
      </div>

      <button
        v-for="row in rows"
        :key="row.identity"
        type="button"
        class="trigger-pane__row"
        :class="{ 'trigger-pane__row--active': row.identity === selectedIdentity }"
        @click="selectIdentity(row.identity)"
      >
        <span class="trigger-pane__row-title">
          <span class="trigger-pane__row-identity">{{ row.identity }}</span>
          <span v-if="row.node.explicitId === undefined" class="trigger-pane__row-synthetic">身份随声明下标</span>
          <span class="trigger-pane__row-type">{{ row.node.info?.label ?? `未知类型 ${row.node.type}` }}</span>
        </span>
        <span class="trigger-pane__row-meta">
          <span>{{ row.node.timing.repeatable ? '可重复' : '单次' }}</span>
          <span>条件 {{ row.leafCount }}</span>
          <span>前置 {{ row.requirementCount }}</span>
          <span v-if="row.badgeDelay" class="trigger-pane__badge">延迟</span>
          <span v-if="row.badgeContinuity" class="trigger-pane__badge">连续</span>
          <span v-if="row.highest" class="trigger-pane__severity" :data-severity="row.highest">
            {{ severityLabel[row.highest] ?? row.highest }}
          </span>
        </span>
      </button>
      <p v-if="rows.length === 0 && !isNew" class="trigger-pane__empty">脚本声明表没有触发器</p>
    </div>

    <div class="trigger-pane__detail">
      <div v-if="note" class="trigger-pane__note" :data-kind="noteKind" role="status">
        {{ note }}
      </div>

      <div v-if="pendingIdentity !== null" class="trigger-pane__confirm" role="dialog" aria-label="未应用草稿">
        <p>当前记录有未应用的草稿。切换前如何处理？</p>
        <div class="trigger-pane__confirm-actions">
          <button type="button" @click="resolvePending('apply')">应用并切换</button>
          <button type="button" @click="resolvePending('discard')">放弃草稿</button>
          <button type="button" @click="resolvePending('cancel')">取消</button>
        </div>
      </div>

      <div v-if="pendingMove !== null" class="trigger-pane__confirm" role="dialog" aria-label="移动确认">
        <p>存在未写 id 的触发器：移动位置会改变合成身份（`type#下标`）。确认移动？</p>
        <div class="trigger-pane__confirm-actions">
          <button type="button" @click="commitMove(pendingMove.from, pendingMove.to)">确认移动</button>
          <button type="button" @click="pendingMove = null">取消</button>
        </div>
      </div>

      <div v-if="confirmRemove && selectedRow" class="trigger-pane__confirm" role="dialog" aria-label="删除确认">
        <p>
          将删除触发器「{{ selectedRow.identity }}」及其 {{ selectedRow.requirementCount }} 条前置。此操作不可在面板内撤销引用恢复。
        </p>
        <div class="trigger-pane__confirm-actions">
          <button type="button" @click="confirmRemoveYes">确认删除</button>
          <button type="button" @click="confirmRemove = false">取消</button>
        </div>
      </div>

      <template v-if="draft !== null">
        <TriggerIdentitySection
          :draft="draft"
          :row="selectedRow ?? null"
          :existing-ids="existingIds"
          @clean-inapplicable="cleanInapplicable"
        />
        <TriggerActionCard />
        <TriggerTimingSection
          :draft="draft"
          :row="selectedRow ?? null"
          :meta="meta"
        />
        <TriggerConditionsSection
          :draft="draft"
          :row="selectedRow ?? null"
          :script-context="scriptContext"
        />
        <TriggerRequirementsSection
          :row="selectedRow ?? null"
          :script-context="scriptContext"
          :meta="meta"
        />
        <TriggerDiagnosticsSection :row="selectedRow ?? null" />
        <div class="trigger-pane__draft-actions">
          <button type="button" class="trigger-pane__apply" @click="applyDraft">应用草稿</button>
          <button type="button" :disabled="!dirty" @click="discardDraft">放弃改动</button>
          <span v-if="dirty" class="trigger-pane__dirty">未应用</span>
        </div>
      </template>
      <p v-else class="trigger-pane__empty">
        {{ isNew ? '正在新建触发器' : '选择左侧一条触发器查看详情' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.trigger-pane {
  display: grid;
  grid-template-columns: minmax(180px, 40%) minmax(220px, 1fr);
  gap: 8px;
  min-height: 0;
  flex: 1;
}

.trigger-pane__list,
.trigger-pane__detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
}

.trigger-pane__toolbar {
  display: flex;
  gap: 4px;
}

.trigger-pane__tool,
.trigger-pane__apply {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--panel-bg, #222);
  color: var(--text, #eee);
  cursor: pointer;
}

.trigger-pane__tool:disabled {
  opacity: 0.4;
  cursor: default;
}

.trigger-pane__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: var(--panel-bg, #1c1c1c);
  text-align: left;
  font: inherit;
  color: var(--text, #eee);
  cursor: pointer;
}

.trigger-pane__row--active {
  border-color: var(--accent, #4a90d9);
}

.trigger-pane__row-title {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.trigger-pane__row-identity {
  font-weight: 600;
  font-size: 12px;
}

.trigger-pane__row-synthetic {
  font-size: 10px;
  color: var(--text-muted, #999);
}

.trigger-pane__row-type {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.trigger-pane__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted, #999);
}

.trigger-pane__badge {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--accent-bg, #2b4a66);
  color: var(--accent, #4a90d9);
}

.trigger-pane__severity[data-severity='error'],
.trigger-pane__severity[data-severity='block'] {
  color: var(--error, #e05555);
}

.trigger-pane__severity[data-severity='warn'] {
  color: var(--warning, #e0a555);
}

.trigger-pane__empty {
  margin: 8px;
  color: var(--text-muted, #888);
  font-size: 12px;
}

.trigger-pane__note {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
}

.trigger-pane__note[data-kind='error'] {
  background: var(--error-bg, #4a2323);
  color: var(--error, #e05555);
}

.trigger-pane__note[data-kind='warning'] {
  background: var(--warning-bg, #4a3a22);
  color: var(--warning, #e0a555);
}

.trigger-pane__note[data-kind='info'] {
  background: var(--accent-bg, #233a4a);
  color: var(--accent, #4a90d9);
}

.trigger-pane__confirm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  font-size: 12px;
}

.trigger-pane__confirm-actions {
  display: flex;
  gap: 6px;
}

.trigger-pane__draft-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
}

.trigger-pane__dirty {
  font-size: 11px;
  color: var(--warning, #e0a555);
}
</style>
