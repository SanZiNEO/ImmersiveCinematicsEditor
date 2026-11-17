<script setup lang="ts">
/**
 * 触发器前置编辑器（05-13 / 05-07）。
 *
 * 增加 / 换目标 / 删除都走 `SCRIPT_MUTATION_SERVICE.mutateRequires`；与脚本页
 * 使用同一条服务端命令、同一套校验、同一份指纹。本组件不建关系缓存：
 * 成功后等文档视图刷新，失败保留表单与错误。
 */
import { computed, onMounted, ref } from 'vue'
import { BUILTIN_TYPES } from '../../../core/graph/requirements.ts'
import type { BuiltinRequirementType, GraphNode, GraphRequirement } from '../../../core/graph/types.ts'
import type { ScriptView, TriggerViewEntry } from '../../../workbench/api/documents.ts'
import { GRAPH_SERVICE, SCRIPT_MUTATION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { sameScriptPath } from '../helpers.ts'
import { usePanelRevision } from '../usePanelRevision.ts'

type EditMode =
  | { kind: 'idle' }
  | { kind: 'add' }
  | { kind: 'update'; index: number }
  | { kind: 'remove'; index: number }

interface TargetOption {
  scriptId: string
  label: string
  path: string
  valid: boolean
}

interface RequirementStatus {
  kind: 'resolved' | 'missing' | 'duplicate' | 'self' | 'custom' | 'unknown'
  label: string
}

const props = defineProps<{
  trigger: TriggerViewEntry
  view: ScriptView
}>()

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const graph = ctx.services.get(GRAPH_SERVICE)
const mutation = ctx.services.get(SCRIPT_MUTATION_SERVICE)

// 编辑器页可能先于脚本页打开：图索引为空时主动拉一次快照，
// 否则前置目标候选全空，会误显示「目标不存在」。
onMounted(() => {
  if (graph === undefined || graph.current() !== null) {
    return
  }
  void graph.snapshot().then(() => {
    revision.value += 1
  }).catch(() => {
    // 断连时保持空候选，由 mutationBlockReason 给出诚实提示。
  })
})

const mode = ref<EditMode>({ kind: 'idle' })
const formType = ref<BuiltinRequirementType>('script_played')
const formTarget = ref('')
const busy = ref(false)
const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
const staleRequirements = ref<GraphRequirement[] | null>(null)

const nodes = computed<GraphNode[]>(() => {
  void revision.value
  return graph?.current()?.nodes ?? []
})

const graphAvailable = computed(() => {
  void revision.value
  return graph !== undefined && graph.current() !== null
})

const idCounts = computed<Map<string, number>>(() => {
  const counts = new Map<string, number>()
  for (const node of nodes.value) {
    if (node.scriptId === undefined || node.scriptId === null || node.scriptId === '') {
      continue
    }
    counts.set(node.scriptId, (counts.get(node.scriptId) ?? 0) + 1)
  }
  return counts
})

const firstNodeById = computed<Map<string, GraphNode>>(() => {
  const map = new Map<string, GraphNode>()
  for (const node of nodes.value) {
    if (node.scriptId === undefined || node.scriptId === null || node.scriptId === '') {
      continue
    }
    if (!map.has(node.scriptId)) {
      map.set(node.scriptId, node)
    }
  }
  return map
})

const targetOptions = computed<TargetOption[]>(() => {
  const options: TargetOption[] = []
  for (const node of nodes.value) {
    const scriptId = node.scriptId
    if (scriptId === undefined || scriptId === null || scriptId === '') {
      continue
    }
    if ((idCounts.value.get(scriptId) ?? 0) !== 1) {
      continue
    }
    if (props.view.meta.id !== '' && scriptId === props.view.meta.id) {
      continue
    }
    if (sameScriptPath(node.path, props.view.path)) {
      continue
    }
    options.push({
      scriptId,
      label: node.name !== '' ? node.name : node.path,
      path: node.path,
      valid: node.valid,
    })
  }
  options.sort((left, right) => {
    const byLabel = left.label.localeCompare(right.label)
    return byLabel !== 0 ? byLabel : left.path.localeCompare(right.path)
  })
  return options
})

const mutationBlockReason = computed<string | null>(() => {
  if (mutation === undefined) {
    return '关系写入服务不可用：无法保存前置修改。'
  }
  if (props.view.path === null || props.view.path === '') {
    return '当前文档没有文件路径，无法写入前置。'
  }
  if (props.view.meta.id === '') {
    return '当前脚本没有 meta.id；先设置脚本 id 才能被引用。'
  }
  if (props.trigger.requiresFingerprint === '') {
    return '缺少前置指纹，无法安全写入；请刷新文档后重试。'
  }
  return null
})

const canMutate = computed(() => mutationBlockReason.value === null)
const canAdd = computed(() => canMutate.value && targetOptions.value.length > 0)

const formTargetOptions = computed<TargetOption[]>(() => {
  const options = [...targetOptions.value]
  if (formTarget.value !== '' && !options.some((option) => option.scriptId === formTarget.value)) {
    options.unshift({
      scriptId: formTarget.value,
      label: '当前目标（不存在 / 不可选）',
      path: '',
      valid: false,
    })
  }
  return options
})

const requirements = computed(() => props.trigger.requirements)
const pendingRequirement = computed<GraphRequirement | undefined>(() => {
  const current = mode.value
  if (current.kind !== 'remove') {
    return undefined
  }
  return requirements.value.find((requirement) => requirement.index === current.index)
})

const formTitle = computed<string>(() => {
  const current = mode.value
  if (current.kind === 'add') {
    return '加前置（追加到末尾）'
  }
  if (current.kind === 'update') {
    return `换目标（第 ${current.index} 条）`
  }
  return ''
})

function report(text: string, kind: 'info' | 'error'): void {
  message.value = text
  messageKind.value = kind
}

function statusOf(requirement: GraphRequirement): RequirementStatus {
  if (requirement.role === 'custom') {
    return { kind: 'custom', label: '自定义前置，只读' }
  }
  const scriptId = requirement.scriptId
  if (scriptId === undefined || scriptId === '') {
    return { kind: 'missing', label: '缺失' }
  }
  if (props.view.meta.id !== '' && scriptId === props.view.meta.id) {
    return { kind: 'self', label: '自引用' }
  }
  if (!graphAvailable.value) {
    return { kind: 'unknown', label: '未校验（图不可用）' }
  }
  const count = idCounts.value.get(scriptId) ?? 0
  if (count > 1) {
    return { kind: 'duplicate', label: '重复 id' }
  }
  if (count === 1) {
    return { kind: 'resolved', label: '已解析' }
  }
  return { kind: 'missing', label: '缺失' }
}

function targetName(scriptId: string | undefined): string | null {
  if (scriptId === undefined || scriptId === '') {
    return null
  }
  const node = firstNodeById.value.get(scriptId)
  if (node === undefined) {
    return null
  }
  return node.name !== '' ? node.name : node.path
}

function resetForm(): void {
  mode.value = { kind: 'idle' }
  formTarget.value = ''
  staleRequirements.value = null
}

function cancelEdit(): void {
  resetForm()
  message.value = ''
}

function openAdd(): void {
  const reason = mutationBlockReason.value
  if (reason !== null) {
    report(reason, 'error')
    return
  }
  if (targetOptions.value.length === 0) {
    report(
      graphAvailable.value
        ? '没有可用的目标脚本：需要存在且 meta.id 唯一、不是当前脚本的脚本。'
        : '图服务不可用：无法列出目标脚本；可先刷新脚本页。',
      'error',
    )
    return
  }
  formType.value = 'script_played'
  formTarget.value = ''
  staleRequirements.value = null
  mode.value = { kind: 'add' }
  report('填写类型与目标脚本后应用。', 'info')
}

function openUpdate(requirement: GraphRequirement): void {
  if (requirement.role === 'custom') {
    report('自定义前置只读，不能换目标。', 'error')
    return
  }
  const reason = mutationBlockReason.value
  if (reason !== null) {
    report(reason, 'error')
    return
  }
  formType.value = BUILTIN_TYPES.includes(requirement.type as BuiltinRequirementType)
    ? (requirement.type as BuiltinRequirementType)
    : 'script_played'
  formTarget.value = requirement.scriptId ?? ''
  staleRequirements.value = null
  mode.value = { kind: 'update', index: requirement.index }
  report(`编辑第 ${requirement.index} 条前置。`, 'info')
}

function openRemove(requirement: GraphRequirement): void {
  if (requirement.role === 'custom') {
    report('自定义前置只读，不能删除。', 'error')
    return
  }
  const reason = mutationBlockReason.value
  if (reason !== null) {
    report(reason, 'error')
    return
  }
  staleRequirements.value = null
  mode.value = { kind: 'remove', index: requirement.index }
  report(`确认删除第 ${requirement.index} 条前置。`, 'info')
}

function onFormType(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (BUILTIN_TYPES.includes(raw as BuiltinRequirementType)) {
    formType.value = raw as BuiltinRequirementType
  }
}

function validateTarget(): string | null {
  if (formTarget.value === '') {
    return '请选择目标脚本。'
  }
  if (!targetOptions.value.some((option) => option.scriptId === formTarget.value)) {
    return '目标脚本不存在、id 重复或是当前脚本自己；请重新选择。'
  }
  return null
}

async function submitForm(): Promise<void> {
  const currentMode = mode.value
  if (currentMode.kind !== 'add' && currentMode.kind !== 'update') {
    return
  }
  if (mutation === undefined) {
    report('关系写入服务不可用。', 'error')
    return
  }
  const path = props.view.path
  if (path === null || path === '') {
    report('当前文档没有文件路径，无法写入前置。', 'error')
    return
  }
  const targetError = validateTarget()
  if (targetError !== null) {
    report(targetError, 'error')
    return
  }
  if (!BUILTIN_TYPES.includes(formType.value)) {
    report('只允许 script_played / script_started / script_completed。', 'error')
    return
  }
  const index = currentMode.kind === 'add' ? requirements.value.length : currentMode.index
  busy.value = true
  try {
    const result = await mutation.mutateRequires({
      path: path.replace(/\\/g, '/'),
      triggerIdentity: props.trigger.identity,
      triggerIndex: props.trigger.index,
      requiresFingerprint: props.trigger.requiresFingerprint,
      operation: currentMode.kind === 'add' ? 'add' : 'update',
      index,
      requirementType: formType.value,
      targetScriptId: formTarget.value,
    })
    if (result.ok) {
      report(
        currentMode.kind === 'add'
          ? `已追加前置 ${formType.value} → ${formTarget.value}。`
          : `已替换第 ${index} 条前置为 ${formType.value} → ${formTarget.value}。`,
        'info',
      )
      resetForm()
      return
    }
    staleRequirements.value = result.currentRequirements ?? null
    report(`${result.code}：${result.message}`, 'error')
  } catch (error) {
    report(error instanceof Error ? error.message : '写入前置失败。', 'error')
  } finally {
    busy.value = false
  }
}

async function confirmRemove(): Promise<void> {
  const currentMode = mode.value
  if (currentMode.kind !== 'remove') {
    return
  }
  if (mutation === undefined) {
    report('关系写入服务不可用。', 'error')
    return
  }
  if (pendingRequirement.value === undefined) {
    report('该前置已不在最新视图中，取消删除。', 'error')
    resetForm()
    return
  }
  const path = props.view.path
  if (path === null || path === '') {
    report('当前文档没有文件路径，无法删除前置。', 'error')
    return
  }
  busy.value = true
  try {
    const result = await mutation.mutateRequires({
      path: path.replace(/\\/g, '/'),
      triggerIdentity: props.trigger.identity,
      triggerIndex: props.trigger.index,
      requiresFingerprint: props.trigger.requiresFingerprint,
      operation: 'remove',
      index: currentMode.index,
    })
    if (result.ok) {
      report(`已删除第 ${currentMode.index} 条前置。`, 'info')
      resetForm()
      return
    }
    staleRequirements.value = result.currentRequirements ?? null
    report(`${result.code}：${result.message}`, 'error')
  } catch (error) {
    report(error instanceof Error ? error.message : '删除前置失败。', 'error')
  } finally {
    busy.value = false
  }
}

function staleSummary(): string {
  return (staleRequirements.value ?? [])
    .map((requirement) => `[${requirement.index}] ${requirement.type} → ${requirement.scriptId ?? '（无目标）'}`)
    .join('；')
}
</script>

<template>
  <section class="requires" aria-label="触发器前置">
    <header class="requires__head">
      <h3 class="requires__title">前置（{{ requirements.length }}）</h3>
      <span class="requires__hint">与脚本页共用 mutateRequires</span>
      <span class="requires__identity">identity={{ trigger.identity }} · index={{ trigger.index }}</span>
    </header>

    <p v-if="mutationBlockReason !== null" class="requires__notice" role="alert">
      {{ mutationBlockReason }}
    </p>
    <p v-else class="requires__hint">写入路径：{{ view.path }}</p>

    <p v-if="message !== ''" class="requires__message" :data-kind="messageKind" role="status" aria-live="polite">
      {{ message }}
    </p>

    <p v-if="staleRequirements !== null" class="requires__notice" role="alert">
      服务端返回的当前前置：{{ staleSummary() }}。本面板未覆盖视图，请按服务端列表重试。
    </p>

    <p v-if="requirements.length === 0" class="requires__empty">
      该触发器没有前置。可以加一条内置前置，或先在脚本页维护关系。
    </p>

    <ul v-else class="requires__list">
      <li v-for="requirement in requirements" :key="requirement.index" class="requires__item">
        <div class="requires__main">
          <span class="requires__index">[{{ requirement.index }}]</span>
          <span class="requires__target">
            {{ requirement.scriptId ?? '（无目标）' }}
            <span v-if="targetName(requirement.scriptId) !== null" class="requires__name">
              · {{ targetName(requirement.scriptId) }}
            </span>
          </span>
          <span
            v-if="statusOf(requirement).kind !== 'resolved'"
            class="requires__status"
            :data-status="statusOf(requirement).kind"
          >
            {{ statusOf(requirement).label }}
          </span>
        </div>
        <div v-if="requirement.role === 'builtin'" class="requires__actions">
          <button
            type="button"
            class="requires__button"
            :disabled="!canMutate || busy"
            :aria-label="`替换第 ${requirement.index} 条前置（${requirement.scriptId ?? '无目标'}）`"
            @click="openUpdate(requirement)"
          >
            换目标
          </button>
          <button
            type="button"
            class="requires__button"
            :disabled="!canMutate || busy"
            :aria-label="`删除第 ${requirement.index} 条前置（${requirement.scriptId ?? '无目标'}）`"
            @click="openRemove(requirement)"
          >
            删除
          </button>
        </div>
        <p v-else class="requires__readonly">自定义前置，只读：{{ JSON.stringify(requirement.data) }}</p>
      </li>
    </ul>

    <div v-if="mode.kind === 'idle'" class="requires__footer">
      <button type="button" class="requires__button" :disabled="!canAdd || busy" @click="openAdd">
        + 加前置
      </button>
      <span v-if="canMutate && targetOptions.length === 0" class="requires__hint">
        {{ graphAvailable
          ? '没有可用目标：需要存在且 meta.id 唯一、不是当前脚本的脚本。'
          : '图服务不可用：无法列出目标脚本；可先刷新脚本页。' }}
      </span>
    </div>

    <form
      v-else-if="mode.kind === 'add' || mode.kind === 'update'"
      class="requires__form"
      @submit.prevent="submitForm"
    >
      <h4 class="requires__form-title">{{ formTitle }}</h4>
      <label class="requires__field">
        <span>目标脚本</span>
        <select v-model="formTarget" class="requires__input">
          <option value="">选择目标脚本</option>
          <option v-for="option in formTargetOptions" :key="option.scriptId" :value="option.scriptId">
            {{ option.label }} · {{ option.scriptId }}<template v-if="option.path !== ''"> · {{ option.path }}</template><template v-if="!option.valid">{{ option.path === '' ? '（不可选）' : '（脚本无效）' }}</template>
          </option>
        </select>
      </label>
      <div class="requires__form-actions">
        <button type="submit" class="requires__button" :disabled="busy">
          {{ busy ? '写入中…' : '应用' }}
        </button>
        <button type="button" class="requires__button" :disabled="busy" @click="cancelEdit">取消</button>
      </div>
    </form>

    <div v-else-if="mode.kind === 'remove'" class="requires__form">
      <h4 class="requires__form-title">确认删除第 {{ mode.index }} 条前置？</h4>
      <p class="requires__hint">
        → {{ pendingRequirement?.scriptId ?? '（无目标）' }}
      </p>
      <div class="requires__form-actions">
        <button type="button" class="requires__button" :disabled="busy" @click="confirmRemove">
          {{ busy ? '删除中…' : '确认删除' }}
        </button>
        <button type="button" class="requires__button" :disabled="busy" @click="cancelEdit">取消</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.requires {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.requires__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.requires__title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.requires__hint {
  color: var(--text-muted);
  font-size: 10px;
  overflow-wrap: anywhere;
}

.requires__identity {
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  overflow-wrap: anywhere;
}

.requires__notice {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--error);
  border-radius: 3px;
  color: var(--error);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.requires__message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.requires__message[data-kind='error'] {
  color: var(--error);
}

.requires__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.requires__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.requires__item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
}

.requires__main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.requires__index {
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.requires__type {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.requires__arrow {
  color: var(--text-muted);
}

.requires__target {
  min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.requires__name {
  color: var(--text-secondary);
  font-family: inherit;
}

.requires__status {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 10px;
}

.requires__status[data-status='resolved'] {
  border-color: var(--success);
  color: var(--success);
}

.requires__status[data-status='missing'],
.requires__status[data-status='duplicate'],
.requires__status[data-status='self'] {
  border-color: var(--warning);
  color: var(--warning);
}

.requires__status[data-status='custom'],
.requires__status[data-status='unknown'] {
  color: var(--text-muted);
}

.requires__actions,
.requires__form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.requires__button {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.requires__button:hover:enabled {
  background: var(--bg-hover);
}

.requires__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.requires__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.requires__readonly {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
  overflow-wrap: anywhere;
}

.requires__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.requires__form {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  border: 1px solid var(--accent);
  border-radius: 3px;
}

.requires__form-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
}

.requires__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted);
  font-size: 10px;
}

.requires__input {
  width: 100%;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.requires__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
