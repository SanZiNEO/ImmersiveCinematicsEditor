<script setup lang="ts">
/**
 * 行为抽屉外壳（11-01）。
 *
 * 职责：
 * - 工具条（新增规则 / 绑定 / 触发器跳转 / 事件跳转、依赖总览、筛选 dim）；
 * - 内部页签：结构（树 + 详情）/ 事件（冻结契约 EventRecordsTab）/ 事实（FactInspectorTab）；
 * - 选择模型：按记录身份解析，文档变化致目标消失回落总览；面板选择不写 `state.selection`；
 * - 记录级草稿：同一时间一份，切换记录询问应用 / 放弃 / 取消；应用一次命令、一次撤销；
 * - 跨面板定位：挂载与每次 `onFocus` 各 `takeFocus('behavior-drawer')`，命中只选中。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import type { DocumentService, CommitOutcome } from '../../../workbench/api/documents.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import { onFocus, takeFocus, requestFocus, clearFocus } from '../../../features/behavior/focus.ts'
import type { RecordRef } from '../../../features/behavior/shared.ts'
import { sameRecordRef } from '../../../features/behavior/shared.ts'
import { describeEventRecord, type EventRecordNode } from '../../../features/behavior/events.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import {
  buildBehaviorModel,
  resolveRecord,
  suggestRecordId,
  type BehaviorModel,
  type RuleRow,
  type BindingRow,
  type TriggerRow,
  type ResolvedRow,
} from './drawerModel.ts'
import { cloneBody, type RecordDraft } from './draftStore.ts'
import { createDefaultRule, duplicateRule as duplicateRuleDefinition } from '../../../features/behavior/rules.ts'
import { referencesToBinding } from '../../../features/behavior/bindings.ts'
import {
  ruleAddIntent,
  ruleRemoveIntent,
  ruleSetIdIntent,
  ruleSetFieldsIntent,
  bindingAddIntent,
  bindingSetIdIntent,
  bindingSetFieldsIntent,
} from '../../../features/behavior/commands.ts'
import BehaviorTree from './BehaviorTree.vue'
import RuleDetail from './RuleDetail.vue'
import BindingDetail from './BindingDetail.vue'
import DepsPane from './DepsPane.vue'
import EventRecordsTab from './events/EventRecordsTab.vue'
import FactInspectorTab from './facts/FactInspectorTab.vue'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService: DocumentService | null = ctx.services.get(DOCUMENT_SERVICE) ?? null

// ── 现算模型（不缓存文档副本）───────────────────────────────────────────────────

const root = computed<JsonObject | null>(() => {
  void revision.value
  return documentService?.root() ?? null
})

const clips = computed(() => {
  void revision.value
  return documentService?.clips() ?? []
})

const model = computed<BehaviorModel>(() => buildBehaviorModel(root.value, clips.value))

const docExists = computed(() => root.value !== null)

// ── 会话态（不写 localStorage）─────────────────────────────────────────────────

type Pane = 'structure' | 'events' | 'facts'
const pane = ref<Pane>('structure')
const detailMode = ref<'edit' | 'deps'>('edit')
const selected = ref<RecordRef | null>(null)
const filter = ref('')
const onlyMatch = ref(true)
const expanded = ref<ReadonlySet<string>>(new Set(['group:trigger', 'group:rule', 'group:event']))
const notice = ref('')

// ── 草稿 ────────────────────────────────────────────────────────────────────────

const draft = ref<RecordDraft | null>(null)
const conflict = ref<{ active: RecordDraft; pendingRef: RecordRef } | null>(null)

const resolved = computed<ResolvedRow | null>(() =>
  selected.value === null ? null : resolveRecord(model.value, selected.value),
)

// ── 修订回落：目标消失 → 总览，不跳相邻 ──────────────────────────────────────────

watch(revision, () => {
  if (selected.value === null) return
  if (resolveRecord(model.value, selected.value) === null) {
    selected.value = null
    draft.value = null
    notice.value = '原目标已删除'
  }
})

// ── 跨面板定位 ──────────────────────────────────────────────────────────────────

let offFocus: (() => void) | null = null

function consumeFocus(): void {
  const request = takeFocus('behavior-drawer')
  if (request === null) return
  const row = resolveRecord(model.value, request.target)
  if (row === null) return
  selectRecord(request.target)
  if (request.target.kind === 'event') pane.value = 'events'
}

onMounted(() => {
  consumeFocus()
  offFocus = onFocus(() => consumeFocus())
})

onBeforeUnmount(() => {
  offFocus?.()
  clearFocus()
})

// ── 选择与草稿生命周期 ──────────────────────────────────────────────────────────

function openRecord(ref: RecordRef): void {
  draft.value = null
  selected.value = ref
  detailMode.value = 'edit'
  const row = resolveRecord(model.value, ref)
  if (row === null) return
  if (ref.kind === 'rule') {
    const ruleRow = row as RuleRow
    draft.value = { ref, isNew: false, body: cloneBody(ruleRow.node), dirty: false }
  } else if (ref.kind === 'binding') {
    const bindingRow = row as BindingRow
    draft.value = { ref, isNew: false, body: cloneBody(bindingRow.node), dirty: false }
  }
}

function selectRecord(ref: RecordRef): void {
  notice.value = ''
  if (draft.value !== null && draft.value.dirty && !sameRecordRef(draft.value.ref, ref)) {
    conflict.value = { active: draft.value, pendingRef: ref }
    return
  }
  openRecord(ref)
}

function resolveConflict(choice: 'apply' | 'discard' | 'cancel'): void {
  const current = conflict.value
  if (current === null) return
  if (choice === 'cancel') {
    conflict.value = null
    return
  }
  if (choice === 'apply') {
    const outcome = applyDraft(current.active)
    if (!outcome.ok) {
      conflict.value = null
      return
    }
  } else {
    draft.value = null
  }
  conflict.value = null
  openRecord(current.pendingRef)
}

function discardDraft(): void {
  draft.value = null
}

// ── 草稿应用（命令层事务 / 一次撤销）────────────────────────────────────────────

function applyDraft(entry: RecordDraft): CommitOutcome {
  if (entry.ref.kind === 'rule') return commitRuleDraft(entry)
  if (entry.ref.kind === 'binding') return commitBindingDraft(entry)
  return { ok: false, error: '该记录类型不可编辑', warnings: [] }
}

function commitRuleDraft(entry: RecordDraft): CommitOutcome {
  const ref = entry.ref
  if (ref.kind !== 'rule') return { ok: false, error: '当前草稿不是规则', warnings: [] }
  const body = entry.body
  const condition = isJsonObject(body.condition) ? body.condition : {}
  const actions = Array.isArray(body.actions) ? (body.actions as JsonObject[]) : []
  const policy = isJsonObject(body.policy) ? body.policy : {}

  if (entry.isNew) {
    const id = typeof body.id === 'string' ? body.id : ''
    const outcome = ctx.commands.commit(
      ruleAddIntent(model.value.rules.length, id, { condition, actions, policy }),
    )
    if (outcome.ok) afterApplied({ kind: 'rule', id })
    return outcome
  }

  const oldId = ref.id
  const newId = typeof body.id === 'string' ? body.id : oldId
  const intents: DocCommand[] = [
    ruleSetFieldsIntent(oldId, { policy, condition, actions }),
  ]
  if (newId !== oldId) intents.push(ruleSetIdIntent(oldId, newId))
  const outcome = ctx.commands.commitBatch(intents)
  if (outcome.ok) afterApplied({ kind: 'rule', id: newId })
  return outcome
}

function commitBindingDraft(entry: RecordDraft): CommitOutcome {
  const ref = entry.ref
  if (ref.kind !== 'binding') return { ok: false, error: '当前草稿不是绑定', warnings: [] }
  const body = entry.body

  if (entry.isNew) {
    const outcome = ctx.commands.commit(bindingAddIntent(model.value.bindings.length, body))
    if (outcome.ok) afterApplied({ kind: 'binding', id: String(body.id) })
    return outcome
  }

  const oldId = ref.id
  const newId = typeof body.id === 'string' ? body.id : oldId
  const intents: DocCommand[] = [
    bindingSetFieldsIntent(oldId, {
      gate: isJsonObject(body.gate) ? body.gate : undefined,
      control: typeof body.control === 'string' ? body.control : undefined,
      schedule: isJsonObject(body.schedule) ? body.schedule : undefined,
      exit: isJsonObject(body.exit) ? body.exit : undefined,
    }),
  ]
  if (newId !== oldId) intents.push(bindingSetIdIntent(oldId, newId))
  const outcome = ctx.commands.commitBatch(intents)
  if (outcome.ok) afterApplied({ kind: 'binding', id: newId })
  return outcome
}

function afterApplied(ref: RecordRef): void {
  draft.value = null
  selected.value = ref
}

function onApply(): void {
  if (draft.value === null) return
  const outcome = applyDraft(draft.value)
  if (!outcome.ok) {
    ctx.status.notify(outcome.error ?? '应用失败', 'error')
    return
  }
  if (outcome.warnings.length > 0) {
    ctx.status.notify(outcome.warnings.join('；'), 'warning')
  }
}

// ── 删除 / 复制 / 迁移 ──────────────────────────────────────────────────────────

function removeRule(row: RuleRow): void {
  const outcome = ctx.commands.commit(ruleRemoveIntent(row.id))
  if (!outcome.ok) ctx.status.notify(outcome.error ?? '删除失败', 'error')
}

function migrateRule(row: RuleRow, targetRuleId: string): void {
  const rootDoc = root.value
  if (rootDoc === null) return
  const referrers = row.bindings
  const commands: DocCommand[] = []
  for (const referrer of referrers) {
    const rewired: JsonObject = { ...referrer.node, rule: targetRuleId }
    commands.push({ kind: 'binding.remove', bindingId: referrer.ref.id })
    commands.push({ kind: 'binding.add', index: referrer.index, binding: rewired })
  }
  commands.push(ruleRemoveIntent(row.id))
  const outcome = ctx.commands.commitBatch(commands)
  if (!outcome.ok) ctx.status.notify(outcome.error ?? '迁移并删除失败', 'error')
}

function onDuplicateRule(row: RuleRow): void {
  const newId = suggestRecordId(model.value.refs.ruleIds, 'rule')
  // 复制只复制定义，不复制绑定（duplicateRule 口径）；副本 id 由调用方生成。
  const copy = duplicateRuleDefinition(row.node, newId)
  const outcome = ctx.commands.commit(
    ruleAddIntent(model.value.rules.length, newId, {
      condition: isJsonObject(copy.condition) ? copy.condition : {},
      actions: Array.isArray(copy.actions) ? (copy.actions as JsonObject[]) : [],
      policy: isJsonObject(copy.policy) ? copy.policy : {},
    }),
  )
  if (!outcome.ok) ctx.status.notify(outcome.error ?? '复制失败', 'error')
}

function removeBinding(row: BindingRow): void {
  const outcome = ctx.commands.commit({ kind: 'binding.remove', bindingId: row.ref.id })
  if (!outcome.ok) ctx.status.notify(outcome.error ?? '删除失败', 'error')
}

const bindingReferrers = computed(() => {
  const current = selected.value
  if (root.value === null || current === null || current.kind !== 'binding') return []
  return referencesToBinding(root.value, current.id)
})

// ── 工具条动作 ──────────────────────────────────────────────────────────────────

const selectedRuleRow = computed<RuleRow | null>(() => {
  if (resolved.value?.ref.kind === 'rule') return resolved.value as RuleRow
  if (resolved.value?.ref.kind === 'binding') {
    const binding = resolved.value as BindingRow
    return model.value.ruleById.get(binding.ruleId) ?? null
  }
  return null
})

const currentClipKey = computed(() => {
  const selection = ctx.selection
  return selection.domain === 'clip' ? selection.clipKey : null
})

const addRuleDisabled = computed(() => !docExists.value)
const addBindingDisabled = computed(() => !docExists.value || selectedRuleRow.value === null)
const addEventDisabled = computed(() => !docExists.value || currentClipKey.value === null)

function addRule(): void {
  if (addRuleDisabled.value) return
  const id = suggestRecordId(model.value.refs.ruleIds, 'rule')
  const body = createDefaultRule(id)
  const ref: RecordRef = { kind: 'rule', id }
  draft.value = { ref, isNew: true, body, dirty: false }
  selected.value = ref
  pane.value = 'structure'
  detailMode.value = 'edit'
}

function addBinding(): void {
  const rule = selectedRuleRow.value
  if (addBindingDisabled.value || rule === null) return
  const id = suggestRecordId(model.value.refs.bindingIds, 'binding')
  const body: JsonObject = { id, rule: rule.id, clip: '', gate: { at: 0 } }
  const ref: RecordRef = { kind: 'binding', id }
  draft.value = { ref, isNew: true, body, dirty: false }
  selected.value = ref
  pane.value = 'structure'
}

function addTrigger(): void {
  // 触发器字段编辑器只在右栏面板；这里只把焦点交过去，不建第二套表单。
  ctx.requestFocus('behavior.triggers')
  requestFocus({ target: { kind: 'trigger', identity: '' }, surface: 'right-panel', origin: 'behavior-drawer' })
}

function addEvent(): void {
  if (addEventDisabled.value) return
  pane.value = 'events'
}

function showOverview(): void {
  if (draft.value?.dirty) {
    conflict.value = { active: draft.value, pendingRef: { kind: 'fact', name: 'overview' } }
    return
  }
  draft.value = null
  selected.value = null
  detailMode.value = 'deps'
  pane.value = 'structure'
}

function jumpTrigger(identity: string): void {
  requestFocus({ target: { kind: 'trigger', identity }, surface: 'right-panel', origin: 'behavior-drawer' })
  ctx.requestFocus('behavior.triggers')
}

function locateBinding(bindingId: string): void {
  selectRecord({ kind: 'binding', id: bindingId })
}

function locateRule(ruleId: string): void {
  selectRecord({ kind: 'rule', id: ruleId })
}

function openClip(clipKey: string): void {
  ctx.requestSelect({ domain: 'clip', clipKey })
}

function toggleGroup(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

// ── 详情路由 ────────────────────────────────────────────────────────────────────

const ruleRow = computed(() => (resolved.value?.ref.kind === 'rule' ? (resolved.value as RuleRow) : null))
const bindingRow = computed(() => (resolved.value?.ref.kind === 'binding' ? (resolved.value as BindingRow) : null))
const triggerRow = computed(() => (resolved.value?.ref.kind === 'trigger' ? (resolved.value as TriggerRow) : null))
const eventRow = computed<EventRecordNode | null>(() =>
  resolved.value?.ref.kind === 'event' ? (resolved.value as EventRecordNode) : null,
)

function eventSummary(): string {
  return eventRow.value === null ? '' : describeEventRecord(eventRow.value)
}

function handleDuplicateRule(): void {
  if (ruleRow.value !== null) onDuplicateRule(ruleRow.value)
}

function handleRemoveRule(): void {
  if (ruleRow.value !== null) removeRule(ruleRow.value)
}

function handleMigrateRule(target: string): void {
  if (ruleRow.value !== null) migrateRule(ruleRow.value, target)
}

function handleRemoveBinding(): void {
  if (bindingRow.value !== null) removeBinding(bindingRow.value)
}
</script>

<template>
  <div class="behavior-drawer">
    <!-- 工具条 -->
    <div class="behavior-drawer__toolbar">
      <div class="behavior-drawer__toolbar-group">
        <button type="button" :disabled="addRuleDisabled" :title="addRuleDisabled ? '当前无文档' : '新增规则'" @click="addRule">规则</button>
        <button type="button" :disabled="addBindingDisabled" :title="addBindingDisabled ? (selectedRuleRow === null ? '需先选择一条规则' : '当前无文档') : '新增绑定'" @click="addBinding">绑定</button>
        <button type="button" :disabled="!docExists" title="触发器在右栏面板新建 / 编辑" @click="addTrigger">触发器</button>
        <button type="button" :disabled="addEventDisabled" :title="addEventDisabled ? '需先选中一个片段' : '在当前片段新增事件'" @click="addEvent">事件</button>
        <button type="button" @click="showOverview">依赖总览</button>
      </div>
      <div class="behavior-drawer__toolbar-group">
        <input v-model="filter" type="search" placeholder="筛选…" class="behavior-drawer__filter" />
        <label class="behavior-drawer__dim-toggle">
          <input v-model="onlyMatch" type="checkbox" />
          仅高亮匹配
        </label>
      </div>
    </div>

    <!-- 内部页签 -->
    <div class="behavior-drawer__tabs">
      <button type="button" :class="{ 'behavior-drawer__tab--active': pane === 'structure' }" @click="pane = 'structure'">结构</button>
      <button type="button" :class="{ 'behavior-drawer__tab--active': pane === 'events' }" @click="pane = 'events'">事件</button>
      <button type="button" :class="{ 'behavior-drawer__tab--active': pane === 'facts' }" @click="pane = 'facts'">事实</button>
    </div>

    <p v-if="notice" class="behavior-drawer__notice">{{ notice }}</p>

    <!-- 结构页签：树 + 详情 -->
    <div v-if="pane === 'structure'" class="behavior-drawer__structure">
      <BehaviorTree
        class="behavior-drawer__tree"
        :model="model"
        :selected="selected"
        :filter="filter"
        :only-match="onlyMatch"
        :expanded="expanded"
        @select="selectRecord"
        @jump-trigger="jumpTrigger"
        @toggle="toggleGroup"
      />

      <div class="behavior-drawer__detail">
        <div v-if="selected !== null" class="behavior-drawer__detail-mode">
          <button
            type="button"
            :class="{ 'behavior-drawer__mode--active': detailMode === 'edit' }"
            @click="detailMode = 'edit'"
          >编辑</button>
          <button
            type="button"
            :class="{ 'behavior-drawer__mode--active': detailMode === 'deps' }"
            @click="detailMode = 'deps'"
          >依赖</button>
        </div>

        <!-- 规则 -->
        <RuleDetail
          v-if="ruleRow !== null && detailMode === 'edit'"
          :row="ruleRow"
          :draft="draft"
          :refs="model.refs"
          :model="model"
          @apply="onApply"
          @discard="discardDraft"
          @duplicate="handleDuplicateRule"
          @remove="handleRemoveRule"
          @migrate="handleMigrateRule"
          @locate-binding="locateBinding"
        />

        <!-- 绑定 -->
        <BindingDetail
          v-else-if="bindingRow !== null && detailMode === 'edit'"
          :row="bindingRow"
          :draft="draft"
          :refs="model.refs"
          :model="model"
          :clips="clips"
          :referrers="bindingReferrers"
          @apply="onApply"
          @discard="discardDraft"
          @remove="handleRemoveBinding"
          @locate-rule="locateRule"
        />

        <!-- 触发器摘要（只读，跳转右栏） -->
        <section v-else-if="triggerRow !== null" class="behavior-drawer__readonly">
          <p class="behavior-drawer__summary">{{ triggerRow.summary }}</p>
          <button type="button" @click="jumpTrigger(triggerRow.identity)">在右栏编辑触发器</button>
        </section>

        <!-- 事件摘要（只读；字段编辑在事件页签） -->
        <section v-else-if="eventRow !== null" class="behavior-drawer__readonly">
          <p class="behavior-drawer__summary">{{ eventSummary() }}</p>
          <button type="button" @click="pane = 'events'">在事件页签打开</button>
        </section>

        <!-- 依赖（只读）/ 总览 -->
        <DepsPane
          v-else
          :root="root"
          :model="model"
          :selected="selected"
        />
      </div>
    </div>

    <!-- 事件页签（冻结契约，另一位代理落盘） -->
    <EventRecordsTab
      v-else-if="pane === 'events'"
      :doc-revision="revision"
      :selected="selected"
      @select="selectRecord"
      @open-clip="openClip"
    />

    <!-- 事实页签（冻结契约，另一位代理落盘） -->
    <FactInspectorTab v-else :doc-revision="revision" />

    <!-- 草稿冲突询问 -->
    <div v-if="conflict !== null" class="behavior-drawer__conflict">
      <p>当前记录有未应用的草稿：应用后再切换，还是放弃草稿？</p>
      <div class="behavior-drawer__conflict-actions">
        <button type="button" @click="resolveConflict('apply')">应用并切换</button>
        <button type="button" @click="resolveConflict('discard')">放弃草稿</button>
        <button type="button" @click="resolveConflict('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.behavior-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 11px;
}

.behavior-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.behavior-drawer__toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.behavior-drawer__filter {
  font: inherit;
  width: 120px;
}

.behavior-drawer__dim-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
}

.behavior-drawer__tabs {
  display: flex;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}

.behavior-drawer__tab--active {
  background: var(--bg-raised);
  border-bottom: 1px solid var(--focus, #4a90d9);
}

.behavior-drawer__notice {
  margin: 0;
  padding: 4px 8px;
  color: var(--warning, #b8860b);
}

.behavior-drawer__structure {
  display: flex;
  flex: 1;
  min-height: 0;
}

.behavior-drawer__tree {
  width: 42%;
  min-width: 180px;
  border-right: 1px solid var(--border);
}

.behavior-drawer__detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.behavior-drawer__detail-mode {
  display: flex;
  gap: 2px;
  padding: 6px 12px 0;
}

.behavior-drawer__mode--active {
  background: var(--bg-raised);
}

.behavior-drawer__readonly {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
}

.behavior-drawer__summary {
  margin: 0;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.behavior-drawer__conflict {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.behavior-drawer__conflict-actions {
  display: flex;
  gap: 6px;
}

button,
input,
select {
  font: inherit;
}
</style>
