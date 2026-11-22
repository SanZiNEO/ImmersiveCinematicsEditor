<script setup lang="ts">
/**
 * 触发器编辑弹窗：行为侧栏里的唯一触发器编辑器。
 *
 * 新增只在本地草稿里存在，取消不留空对象；编辑一次提交一批命令，撤销回到整次修改前。
 * 记录身份仍是显式 id 或 type#index，切换由父级处理。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonArray, isJsonObject } from '../../../core/doc/json.ts'
import { cloneJson } from '../../../core/doc/json.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import { TRIGGER_ID_PATTERN } from '../../../features/behavior/trigger.ts'
import {
  triggerAddIntent,
  triggerMoveIntent,
  triggerRemoveIntent,
  triggerSetRequiresIntent,
  triggerSetIdIntent,
  triggerSetTypeIntent,
} from '../../../features/behavior/commands.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import {
  diffDraft,
  draftBlockingProblems,
  emptyTriggerDraft,
  type PanelScriptContext,
  type PanelTrigger,
} from '../panels/triggerPanelModel.ts'
import TriggerIdentitySection from '../editor/TriggerIdentitySection.vue'
import TriggerTimingSection from '../editor/TriggerTimingSection.vue'
import TriggerConditionsSection from '../editor/TriggerConditionsSection.vue'
import TriggerRequirementsSection from '../editor/TriggerRequirementsSection.vue'
import TriggerDiagnosticsSection from '../editor/TriggerDiagnosticsSection.vue'
import WorkbenchDialog from '../../../workbench/shell/WorkbenchDialog.vue'

const props = defineProps<{
  rows: PanelTrigger[]
  meta: JsonObject | null
  scriptContext: PanelScriptContext
  initialIdentity: string | null
  createNew: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: [identity: string]
  removed: []
  reorder: [from: number, to: number]
}>()

const ctx = usePanelContext()
const draft = ref<JsonObject | null>(null)
const origin = ref<JsonObject | null>(null)
const isNew = ref(false)
const note = ref('')
const noteKind = ref<'info' | 'warning' | 'error'>('info')
const pendingMove = ref<{ from: number; to: number } | null>(null)
const confirmRemove = ref(false)
const confirmDiscard = ref(false)
const continueEditing = ref<HTMLButtonElement | null>(null)
const pendingClean = ref<string[] | null>(null)

const row = computed<PanelTrigger | undefined>(() => {
  if (isNew.value || props.initialIdentity === null) return undefined
  return props.rows.find((candidate) => candidate.identity === props.initialIdentity)
})

const rawTriggerCount = computed(() => {
  const raw = props.meta?.triggers
  return Array.isArray(raw) ? raw.length : 0
})

const existingIds = computed(() => props.rows.flatMap((entry) =>
  entry.node.explicitId === undefined ? [] : [entry.node.explicitId],
))

const dirty = computed(() => {
  if (isNew.value) return draft.value !== null
  return origin.value !== null && draft.value !== null
    && JSON.stringify(origin.value) !== JSON.stringify(draft.value)
})

const title = computed(() => isNew.value ? '新建触发器' : '编辑触发器 · ' + (row.value?.identity ?? ''))

function flash(kind: 'info' | 'warning' | 'error', text: string): void {
  noteKind.value = kind
  note.value = text
}

function identityOf(draftValue: JsonObject, index: number): string {
  const id = typeof draftValue.id === 'string' ? draftValue.id : ''
  return id.length > 0 ? id : String(draftValue.type ?? 'unknown') + '#' + index
}

function hasIdCollision(id: string, currentIndex: number): boolean {
  return props.rows.some((entry) => entry.node.explicitId === id && entry.node.index !== currentIndex)
}

function startCreate(): void {
  draft.value = emptyTriggerDraft(new Set(existingIds.value))
  origin.value = null
  isNew.value = true
  note.value = ''
  confirmRemove.value = false
}

function startEdit(entry: PanelTrigger): void {
  draft.value = cloneJson(entry.node.raw)
  origin.value = cloneJson(entry.node.raw)
  isNew.value = false
  note.value = ''
  confirmRemove.value = false
}

function validateId(value: string, index: number): boolean {
  if (value.length === 0) return true
  if (!TRIGGER_ID_PATTERN.test(value)) {
    flash('error', 'id 必须匹配 ' + TRIGGER_ID_PATTERN.source)
    return false
  }
  if (hasIdCollision(value, index)) {
    flash('error', 'id 与其他触发器重复')
    return false
  }
  return true
}

function save(): void {
  const working = draft.value
  if (working === null) return
  const current = row.value
  const index = isNew.value ? rawTriggerCount.value : current?.node.index
  if (index === undefined) return

  const blocking = draftBlockingProblems(working, index, props.scriptContext)
  if (blocking.length > 0) {
    flash('error', blocking.map((problem) => problem.message).join('；'))
    return
  }
  const nextId = typeof working.id === 'string' ? working.id : ''
  if (!validateId(nextId, index)) return

  if (isNew.value) {
    const outcome = ctx.commands.commit(triggerAddIntent(index, cloneJson(working)))
    if (!outcome.ok) {
      flash('error', outcome.error ?? '创建触发器失败')
      return
    }
    emit('saved', identityOf(working, index))
    emit('close')
    return
  }

  if (current === undefined || origin.value === null) return
  const diff = diffDraft(origin.value, working)
  const commands: DocCommand[] = []
  if (Object.keys(diff.fieldsPatch).length > 0) {
    commands.push({ kind: 'trigger.setFields', triggerIdentity: current.identity, patch: diff.fieldsPatch })
  }
  if (Object.keys(diff.conditionsPatch).length > 0 || diff.conditionsRemove.length > 0) {
    commands.push({
      kind: 'trigger.setConditions',
      triggerIdentity: current.identity,
      patch: diff.conditionsPatch,
      ...(diff.conditionsRemove.length > 0 ? { remove: diff.conditionsRemove } : {}),
    })
  }
  if (diff.requiresChanged) {
    const requires = isJsonArray(working.requires) ? working.requires : []
    commands.push(triggerSetRequiresIntent(current.identity, requires))
  }
  // 若同时切类型又改 id，最后按「改类型前」的身份写 id；无 id 的旧身份可能已变。
  // 字段 / 条件 / 前置都按当前身份写完，再处理会改变身份的 type / id。
  if (current.node.explicitId === undefined && diff.idChanged) {
    // 无 id 记录先赋 id，再按新 id 切类型；否则 type#index 会在切类型后失效。
    commands.push(triggerSetIdIntent(current.identity, nextId))
    if (diff.typeChanged) {
      commands.push(triggerSetTypeIntent(nextId, String(working.type ?? '')))
    }
  } else {
    // 有 id 时先切类型再改 id；清空 id 时，最后一步仍能按显式 id 找到记录。
    if (diff.typeChanged) {
      commands.push(triggerSetTypeIntent(current.identity, String(working.type ?? '')))
    }
    if (diff.idChanged) commands.push(triggerSetIdIntent(current.identity, nextId))
  }

  if (commands.length === 0) {
    emit('close')
    return
  }
  const outcome = ctx.commands.commitBatch(commands, 'trigger-dialog:' + current.identity)
  if (!outcome.ok) {
    flash('error', outcome.error ?? '保存触发器失败')
    return
  }
  emit('saved', identityOf(working, index))
  emit('close')
}

function requestRemove(): void {
  if (row.value !== undefined) confirmRemove.value = true
}

function remove(): void {
  const current = row.value
  if (current === undefined) return
  const outcome = ctx.commands.commit(triggerRemoveIntent(current.identity))
  if (!outcome.ok) {
    flash('error', outcome.error ?? '删除触发器失败')
    return
  }
  emit('removed')
  emit('close')
}

function requestMove(direction: -1 | 1): void {
  const current = row.value
  if (current === undefined || dirty.value) return
  const to = current.node.index + direction
  if (to < 0 || to >= rawTriggerCount.value) return
  if (current.node.explicitId === undefined) {
    pendingMove.value = { from: current.node.index, to }
    return
  }
  commitMove(current.node.index, to)
}

function commitMove(from: number, to: number): void {
  if (dirty.value) return
  const outcome = ctx.commands.commit(triggerMoveIntent(from, to))
  pendingMove.value = null
  if (!outcome.ok) {
    flash('error', outcome.error ?? '移动触发器失败')
    return
  }
  emit('reorder', from, to)
  emit('close')
}

function requestClean(keys: string[]): void {
  if (keys.length > 0) pendingClean.value = [...keys]
}

function applyClean(): void {
  const working = draft.value
  const keys = pendingClean.value
  if (working === null || keys === null) return
  const conditions = isJsonObject(working.conditions) ? working.conditions : {}
  for (const key of keys) {
    if (key === 'continuity' || key === 'on_enter' || key === 'exit_buffer' || key === 'poll_interval') {
      delete working[key]
    } else {
      delete conditions[key]
    }
  }
  working.conditions = conditions
  pendingClean.value = null
  flash('info', '已清理 ' + keys.length + ' 个不适用字段，保存后生效')
}

function close(): void {
  if (dirty.value) {
    confirmDiscard.value = true
    void nextTick(() => continueEditing.value?.focus())
    return
  }
  emit('close')
}

onMounted(() => {
  if (props.createNew) startCreate()
  else if (row.value !== undefined) startEdit(row.value)
})

onBeforeUnmount(() => {
  draft.value = null
  origin.value = null
})

watch(draft, () => {
  if (!dirty.value) confirmDiscard.value = false
}, { deep: true })
</script>

<template>
  <WorkbenchDialog
    :title="title"
    dialog-id="trigger-editor"
    width="600px"
    @close="close"
  >
    <template #actions>
      <div v-if="!isNew && row" class="trigger-dialog__record-actions">
        <button type="button" @click="requestMove(-1)" :disabled="dirty || row.node.index === 0">上移</button>
        <button type="button" @click="requestMove(1)" :disabled="dirty || row.node.index === rawTriggerCount - 1">下移</button>
        <button type="button" class="trigger-dialog__danger" @click="requestRemove">删除</button>
      </div>
    </template>

    <p v-if="note" class="trigger-dialog__note" :data-kind="noteKind" role="status">{{ note }}</p>

    <div v-if="confirmDiscard" class="trigger-dialog__confirm" role="alert">
      <p>有未保存的触发器修改，放弃这些修改？</p>
      <button type="button" class="trigger-dialog__danger" @click="emit('close')">放弃修改</button>
      <button ref="continueEditing" type="button" @click="confirmDiscard = false">继续编辑</button>
    </div>
    <div v-if="pendingClean" class="trigger-dialog__confirm" role="alert">
      <p>清理 {{ pendingClean.length }} 个当前类型不适用的旧字段？保存后才会写入文档。</p>
      <button type="button" @click="applyClean">清理旧字段</button>
      <button type="button" @click="pendingClean = null">取消</button>
    </div>
    <div v-if="pendingMove" class="trigger-dialog__confirm" role="alert">
      <p>移动无显式 id 的触发器会改变它按声明下标生成的身份，继续吗？</p>
      <button type="button" :disabled="dirty" @click="commitMove(pendingMove.from, pendingMove.to)">确认移动</button>
      <button type="button" @click="pendingMove = null">取消</button>
    </div>
    <div v-if="confirmRemove" class="trigger-dialog__confirm" role="alert">
      <p>删除「{{ row?.identity }}」及其 {{ row?.requirementCount ?? 0 }} 条前置？</p>
      <button type="button" class="trigger-dialog__danger" @click="remove">确认删除</button>
      <button type="button" @click="confirmRemove = false">取消</button>
    </div>

    <div v-if="draft !== null" class="trigger-dialog__body">
      <TriggerIdentitySection
        class="trigger-dialog__section"
        :draft="draft"
        :row="row ?? null"
        :existing-ids="existingIds"
        @clean-inapplicable="requestClean"
      />
      <TriggerConditionsSection
        class="trigger-dialog__section"
        :draft="draft"
        :row="row ?? null"
        :script-context="scriptContext"
      />
      <TriggerTimingSection class="trigger-dialog__section" :draft="draft" :row="row ?? null" :meta="meta" />
      <TriggerRequirementsSection
        class="trigger-dialog__section"
        :draft="draft"
        :row="row ?? null"
        :script-context="scriptContext"
        :meta="meta"
      />
      <details v-if="row && row.problems.length > 0" class="trigger-dialog__diagnostics">
        <summary>诊断（{{ row.problems.length }}）</summary>
        <TriggerDiagnosticsSection :row="row" />
      </details>
    </div>

    <template #footer>
      <span v-if="dirty" class="trigger-dialog__dirty">未保存</span>
      <button type="button" class="trigger-dialog__button" @click="close">取消</button>
      <button type="button" class="trigger-dialog__button trigger-dialog__primary" :disabled="draft === null" @click="save">
        {{ isNew ? '创建触发器' : '保存' }}
      </button>
    </template>
  </WorkbenchDialog>
</template>

<style scoped>
.trigger-dialog__record-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.trigger-dialog__button,
.trigger-dialog__record-actions button,
.trigger-dialog__confirm button {
  padding: 4px 10px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--bg-raised, #242424);
  color: var(--text, #eee);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.trigger-dialog__button:disabled,
.trigger-dialog__record-actions button:disabled,
.trigger-dialog__confirm button:disabled {
  opacity: 0.4;
  cursor: default;
}

.trigger-dialog__danger {
  color: var(--error, #e05555) !important;
}

.trigger-dialog__body {
  min-width: 0;
}

.trigger-dialog__body :deep(.trigger-dialog__section) {
  min-width: 0;
  padding: 9px 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}

.trigger-dialog__body :deep(.trigger-dialog__section:first-child) {
  padding-top: 0;
}

.trigger-dialog__body :deep(.trigger-dialog__section:last-child) {
  padding-bottom: 0;
  border-bottom: 0;
}

.trigger-dialog__diagnostics {
  margin-top: 8px;
  font-size: 11px;
}

.trigger-dialog__diagnostics :deep(section) {
  margin-top: 6px;
}

.trigger-dialog__note {
  margin: 0;
  padding: 6px 0;
  font-size: 11px;
}

.trigger-dialog__note[data-kind='error'] {
  color: var(--error, #e05555);
}

.trigger-dialog__note[data-kind='warning'] {
  color: var(--warning, #e0a555);
}

.trigger-dialog__confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin: 0 0 8px;
  padding: 8px;
  border: 1px solid var(--warning, #b8860b);
  border-radius: 4px;
  font-size: 11px;
}

.trigger-dialog__confirm p {
  flex-basis: 100%;
  margin: 0;
}

.trigger-dialog__dirty {
  margin-right: auto;
  color: var(--warning, #e0a555);
  font-size: 10px;
}

.trigger-dialog__primary {
  border-color: var(--accent, #4a90d9) !important;
  background: var(--accent, #4a90d9) !important;
  color: var(--bg-app, #111) !important;
  font-weight: 600;
}

</style>
