<script setup lang="ts">
/**
 * 图上改一条前置（05-07）。
 *
 * 只改依赖方这一个脚本的一条 `requires`：目标只列 `uniqueTargets`（存在且 id 唯一，
 * 不含当前脚本），类型只允许内置三种。不乐观更新：成功后交给面板刷新图，
 * 失败保留对话框与输入，并按服务端返回刷新当前前置列表。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { GraphNode, GraphRequirement } from '../../core/graph/types.ts'
import {
  BUILTIN_REQUIREMENT_TYPES,
  isBuiltinRequirementType,
  type BuiltinRequirementType,
} from '../../core/graph/types.ts'
import { uniqueTargets } from '../../core/graph/index.ts'
import type { RequiresMutationResult } from '../../workbench/api/graph.ts'
import {
  canEditRequirement,
  mutationErrorText,
  requirementStatusLabel,
  requirementStatusOf,
  requirementTargetLabel,
  requirementTypeLabel,
} from './labels.ts'
import { useGraphController } from './state.ts'

const props = defineProps<{
  node: GraphNode
  triggerIdentity: string | null
  requirementIndex: number | null
  intent: 'add' | 'update' | 'delete'
}>()

const emit = defineEmits<{
  close: []
  saved: [path: string]
}>()

const controller = useGraphController()

const triggers = computed(() => props.node.triggers)
const selectedIdentity = ref(props.triggerIdentity ?? triggers.value[0]?.identity ?? '')
const trigger = computed(() =>
  triggers.value.find((candidate) => candidate.identity === selectedIdentity.value) ?? null)
const requirements = ref<GraphRequirement[]>(cloneRequirements(trigger.value?.requirements ?? []))

const mode = ref<'add' | 'update'>('add')
const editIndex = ref<number | null>(null)
const type = ref<BuiltinRequirementType>('script_played')
const targetId = ref('')
const targetQuery = ref('')
const confirmDelete = ref<number | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

const allTargets = computed(() => {
  const graph = controller.graph.value
  if (graph === null) {
    return []
  }
  return uniqueTargets(graph, props.node.path)
    .filter((node) => node.scriptId !== props.node.scriptId)
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name)
      return byName !== 0 ? byName : left.path.localeCompare(right.path)
    })
})

const matchedTargets = computed(() => {
  const query = targetQuery.value.trim().toLowerCase()
  if (query === '') {
    return allTargets.value
  }
  return allTargets.value.filter((node) =>
    node.name.toLowerCase().includes(query)
    || (node.scriptId ?? '').toLowerCase().includes(query)
    || node.path.toLowerCase().includes(query))
})

const targetOptions = computed(() => matchedTargets.value.slice(0, 50))
const targetOverflow = computed(() => matchedTargets.value.length > 50)
const selectedTarget = computed(() =>
  allTargets.value.find((node) => node.scriptId === targetId.value) ?? null)

const canEditSource = computed(() =>
  props.node.scriptId !== null && props.node.scriptId !== undefined && props.node.scriptId !== '')
const requirable = computed(() => trigger.value !== null && canEditSource.value)
const positionLabel = computed(() =>
  mode.value === 'add'
    ? `第 ${requirements.value.length + 1} 条（追加到末尾）`
    : `第 ${(editIndex.value ?? 0) + 1} 条`)

const canSubmit = computed(() =>
  !busy.value
  && trigger.value !== null
  && canEditSource.value
  && selectedTarget.value !== null
  && (mode.value === 'add' || editIndex.value !== null))

watch(selectedIdentity, () => {
  requirements.value = cloneRequirements(trigger.value?.requirements ?? [])
  resetForm()
  // 以「删除」意图打开时，watch 触发的 resetForm 会清掉确认态，这里重新应用一次。
  if (props.intent === 'delete') {
    applyInitialIntent()
  }
})

watch(() => trigger.value?.requiresFingerprint, () => {
  requirements.value = cloneRequirements(trigger.value?.requirements ?? [])
})

// 同一脚本重复打开（GraphPanel 的 key 只含 path）时 onMounted 不会重跑，
// 监听 intent / requirementIndex 变化重新应用初始意图（含删除确认态）。
watch(() => [props.intent, props.requirementIndex, props.triggerIdentity], () => {
  resetForm()
  applyInitialIntent()
}, { flush: 'post' })

function cloneRequirements(list: readonly GraphRequirement[]): GraphRequirement[] {
  return list.map((requirement) => ({ ...requirement, data: { ...requirement.data } }))
}

function resetForm(): void {
  mode.value = 'add'
  editIndex.value = null
  targetId.value = ''
  targetQuery.value = ''
  type.value = 'script_played'
  confirmDelete.value = null
  error.value = null
}

function applyInitialIntent(): void {
  const current = trigger.value
  if (current === null || props.requirementIndex === null) {
    return
  }
  const requirement = current.requirements.find((candidate) => candidate.index === props.requirementIndex)
  if (requirement === undefined) {
    return
  }
  mode.value = 'update'
  editIndex.value = requirement.index
  type.value = isBuiltinRequirementType(requirement.type) ? requirement.type : 'script_played'
  targetId.value = requirement.scriptId ?? ''
  if (props.intent === 'delete') {
    confirmDelete.value = requirement.index
  }
}

function beginUpdate(requirement: GraphRequirement): void {
  mode.value = 'update'
  editIndex.value = requirement.index
  type.value = isBuiltinRequirementType(requirement.type) ? requirement.type : 'script_played'
  targetId.value = requirement.scriptId ?? ''
  targetQuery.value = ''
  confirmDelete.value = null
  error.value = null
  void nextTick(() => searchEl.value?.focus())
}

function beginAdd(): void {
  mode.value = 'add'
  editIndex.value = null
  targetId.value = ''
  targetQuery.value = ''
  type.value = 'script_played'
  confirmDelete.value = null
  error.value = null
  void nextTick(() => searchEl.value?.focus())
}

function beginDelete(index: number): void {
  confirmDelete.value = index
  error.value = null
}

function cancelDelete(): void {
  confirmDelete.value = null
}

function selectTarget(scriptId: string): void {
  targetId.value = scriptId
  error.value = null
}

function handleResult(result: RequiresMutationResult): void {
  if (result.ok) {
    error.value = null
    emit('saved', result.path)
    return
  }
  if (result.currentRequirements !== undefined) {
    requirements.value = cloneRequirements(result.currentRequirements)
  }
  error.value = mutationErrorText(result.code, result.message)
  if (result.code === 'stale_requires') {
    error.value = `${error.value}；已请求刷新图，列表更新后再试`
    void controller.refresh()
  }
}

async function submit(): Promise<void> {
  const current = trigger.value
  const target = selectedTarget.value
  if (current === null || target === null || target.scriptId === null || target.scriptId === undefined) {
    error.value = '请选择一个存在且 id 唯一的目标脚本'
    return
  }
  if (!canEditSource.value) {
    error.value = '当前脚本没有 meta.id：先设置脚本 id 后才能加前置'
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await controller.mutateRequires({
      path: props.node.path,
      triggerIdentity: current.identity,
      triggerIndex: current.index,
      requiresFingerprint: current.requiresFingerprint,
      operation: mode.value === 'add' ? 'add' : 'update',
      index: mode.value === 'add' ? requirements.value.length : editIndex.value ?? -1,
      requirementType: type.value,
      targetScriptId: target.scriptId,
    })
    handleResult(result)
  } finally {
    busy.value = false
  }
}

async function removeRequirement(index: number): Promise<void> {
  const current = trigger.value
  if (current === null) {
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await controller.mutateRequires({
      path: props.node.path,
      triggerIdentity: current.identity,
      triggerIndex: current.index,
      requiresFingerprint: current.requiresFingerprint,
      operation: 'remove',
      index,
    })
    handleResult(result)
  } finally {
    busy.value = false
    confirmDelete.value = null
  }
}

function onEscape(): void {
  if (busy.value) {
    return
  }
  if (confirmDelete.value !== null) {
    confirmDelete.value = null
    return
  }
  emit('close')
}

function close(): void {
  if (!busy.value) {
    emit('close')
  }
}

onMounted(() => {
  applyInitialIntent()
  if (props.intent !== 'delete') {
    void nextTick(() => searchEl.value?.focus())
  }
})
</script>

<template>
  <div class="dialog-backdrop" @pointerdown.self="close">
    <section
      class="dependency-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dependency-dialog-title"
      @keydown.esc.stop.prevent="onEscape"
    >
      <header class="dialog-head">
        <div class="dialog-head__text">
          <h2 id="dependency-dialog-title" class="dialog-title">维护前置</h2>
          <p class="dialog-subtitle" :title="node.path">
            {{ node.name }} · {{ node.path }}
            <span v-if="node.scriptId === null || node.scriptId === undefined" class="dialog-warn">
              （当前脚本没有 meta.id）
            </span>
          </p>
        </div>
        <button type="button" class="icon-button" aria-label="关闭" :disabled="busy" @click="close">✕</button>
      </header>

      <p v-if="triggers.length === 0" class="dialog-empty">
        该脚本没有触发器；本命令不新建触发器。先到编辑器页新建触发器后再维护前置。
      </p>

      <template v-else>
        <label class="field">
          <span class="field__label">触发器</span>
          <select v-model="selectedIdentity" class="field__input" :disabled="busy || triggers.length <= 1">
            <option v-for="item in triggers" :key="item.identity" :value="item.identity">
              {{ item.type }} · #{{ item.index + 1 }} · {{ item.identity }}
            </option>
          </select>
        </label>

        <section class="current-block">
          <h3 class="block-title">当前前置（{{ requirements.length }}）</h3>
          <p v-if="requirements.length === 0" class="block-empty">当前触发器没有前置。</p>
          <ul v-else class="current-list">
            <li v-for="requirement in requirements" :key="requirement.index" class="current-row">
              <span class="current-row__index">[{{ requirement.index }}]</span>
              <span class="current-row__type">{{ requirementTypeLabel(requirement.type) }}</span>
              <span class="current-row__arrow">→</span>
              <span class="current-row__target" :title="requirementTargetLabel(requirement)">
                {{ requirementTargetLabel(requirement) }}
              </span>
              <span class="current-row__status" :data-status="requirementStatusOf(requirement)">
                {{ requirementStatusLabel(requirementStatusOf(requirement)) }}
              </span>
              <span v-if="canEditRequirement(requirement, node)" class="current-row__actions">
                <template v-if="confirmDelete === requirement.index">
                  <span class="confirm-text">确认删除？</span>
                  <button
                    type="button"
                    class="mini-button mini-button--danger"
                    :disabled="busy"
                    @click="removeRequirement(requirement.index)"
                  >确认删除</button>
                  <button type="button" class="mini-button" :disabled="busy" @click="cancelDelete">取消</button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="mini-button"
                    :aria-label="`换目标：第 ${requirement.index + 1} 条（${requirementTargetLabel(requirement)}）`"
                    :disabled="busy"
                    @click="beginUpdate(requirement)"
                  >换目标</button>
                  <button
                    type="button"
                    class="mini-button mini-button--danger"
                    :aria-label="`删除第 ${requirement.index + 1} 条（${requirementTargetLabel(requirement)}）`"
                    :disabled="busy"
                    @click="beginDelete(requirement.index)"
                  >删除</button>
                </template>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="canEditSource" class="form-block">
          <div class="form-head">
            <h3 class="block-title">{{ mode === 'add' ? '加前置' : '换目标' }}</h3>
            <span class="form-position">位置：{{ positionLabel }}</span>
            <button v-if="mode === 'update'" type="button" class="link-button" :disabled="busy" @click="beginAdd">
              改为新增
            </button>
          </div>

          <div class="form-grid">
            <label class="field">
              <span class="field__label">类型</span>
              <select v-model="type" class="field__input" :disabled="busy">
                <option v-for="option in BUILTIN_REQUIREMENT_TYPES" :key="option" :value="option">
                  {{ requirementTypeLabel(option) }}（{{ option }}）
                </option>
              </select>
            </label>
            <label class="field field--grow">
              <span class="field__label">查找目标脚本</span>
              <input
                ref="searchEl"
                v-model="targetQuery"
                type="search"
                class="field__input"
                placeholder="名称 / id / 路径"
                :disabled="busy"
              >
            </label>
          </div>

          <p class="target-note">
            只列存在且 id 唯一的脚本（不含当前脚本）。
            <span v-if="targetOverflow">已匹配 {{ matchedTargets.length }} 个，仅显示前 50 个，请继续输入以缩小范围。</span>
          </p>

          <div v-if="targetOptions.length === 0" class="target-empty">
            没有可用目标：项目中不存在 id 唯一且可引用的其他脚本。
          </div>
          <ul v-else class="target-list" role="listbox" aria-label="目标脚本">
            <li v-for="option in targetOptions" :key="option.path">
              <button
                type="button"
                class="target-item"
                :class="{ 'target-item--selected': option.scriptId === targetId }"
                role="option"
                :aria-selected="option.scriptId === targetId"
                :disabled="busy"
                @click="selectTarget(option.scriptId ?? '')"
              >
                <span class="target-item__name">{{ option.name }}</span>
                <span class="target-item__id">id={{ option.scriptId }}</span>
                <span class="target-item__path">{{ option.path }}</span>
              </button>
            </li>
          </ul>

          <p v-if="selectedTarget !== null" class="selected-target">
            目标：{{ selectedTarget.name }} · id={{ selectedTarget.scriptId }} · {{ selectedTarget.path }}
          </p>
          <p v-else class="selected-target selected-target--empty">尚未选择目标</p>
        </section>

        <p v-else class="dialog-warn">
          当前脚本没有 meta.id：先设置脚本 id 后才能维护前置（服务端会把源无 id 的写入拒绝）。
        </p>
      </template>

      <p v-if="error !== null" class="dialog-error" role="alert">{{ error }}</p>

      <footer class="dialog-foot">
        <span class="dialog-foot__hint">一次只改一条；写入成功后图会自动刷新。</span>
        <button type="button" class="dialog-button" :disabled="busy" @click="close">关闭</button>
        <button
          v-if="requirable"
          type="button"
          class="dialog-button dialog-button--primary"
          :disabled="!canSubmit"
          @click="submit"
        >{{ busy ? '写入中…' : '应用' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
}
.dependency-dialog {
  width: 640px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 12px 36px var(--shadow);
  overflow: auto;
}
.dialog-head { display: flex; align-items: flex-start; gap: 8px; }
.dialog-head__text { flex: 1 1 auto; min-width: 0; }
.dialog-title { margin: 0; font-size: 15px; }
.dialog-subtitle { margin: 2px 0 0; color: var(--text-secondary); font-size: 11px; overflow-wrap: anywhere; }
.dialog-warn { color: var(--warning); font-size: 12px; margin: 0; }
.icon-button {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
}
.icon-button:focus-visible, .mini-button:focus-visible, .dialog-button:focus-visible,
.link-button:focus-visible, .target-item:focus-visible, .field__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.dialog-empty { margin: 0; padding: 12px; border: 1px dashed var(--border-strong); border-radius: 6px; color: var(--text-secondary); }
.field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.field--grow { flex: 1 1 auto; }
.field__label { color: var(--text-muted); font-size: 11px; }
.field__input {
  padding: 5px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
  min-width: 0;
}
.block-title { margin: 0; font-size: 12px; color: var(--text-secondary); }
.block-empty { margin: 0; color: var(--text-muted); font-size: 11px; }
.current-list { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.current-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  font-size: 11.5px;
}
.current-row__index { color: var(--text-muted); font-size: 10px; }
.current-row__arrow { color: var(--text-muted); }
.current-row__target { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.current-row__status { padding: 0 4px; border-radius: 3px; border: 1px solid var(--border-strong); font-size: 10px; color: var(--text-secondary); }
.current-row__status[data-status="resolved"] { color: var(--success); border-color: var(--success); }
.current-row__status[data-status="missing"] { color: var(--error); border-color: var(--error); }
.current-row__status[data-status="self"] { color: var(--warning); border-color: var(--warning); }
.current-row__status[data-status="duplicate"] { color: var(--warning); border-color: var(--warning); }
.current-row__status[data-status="custom"] { color: var(--text-muted); }
.current-row__actions { display: inline-flex; gap: 4px; align-items: center; margin-left: auto; }
.confirm-text { color: var(--error); font-size: 10.5px; }
.mini-button, .dialog-button, .link-button {
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}
.mini-button:hover, .dialog-button:hover, .link-button:hover { background: var(--bg-hover); }
.mini-button--danger { color: var(--error); }
.link-button { border: 0; background: transparent; color: var(--accent); padding: 0 4px; }
.form-block { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
.form-head { display: flex; align-items: baseline; gap: 8px; }
.form-position { color: var(--text-muted); font-size: 11px; }
.form-grid { display: flex; gap: 8px; align-items: flex-end; }
.target-note { margin: 0; color: var(--text-muted); font-size: 10.5px; }
.target-empty { padding: 8px; border: 1px dashed var(--border-strong); border-radius: 4px; color: var(--text-muted); font-size: 11px; }
.target-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 168px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.target-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font-size: 11px;
}
.target-item:last-child { border-bottom: 0; }
.target-item:hover { background: var(--bg-hover); }
.target-item--selected { background: var(--bg-selected); }
.target-item__name { font-weight: 600; }
.target-item__id { color: var(--text-secondary); }
.target-item__path { margin-left: auto; color: var(--text-muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-target { margin: 0; font-size: 11px; color: var(--text-secondary); overflow-wrap: anywhere; }
.selected-target--empty { color: var(--text-muted); }
.dialog-error { margin: 0; padding: 6px 8px; border: 1px solid var(--error); border-radius: 4px; background: var(--error-bg); color: var(--error); font-size: 11.5px; }
.dialog-foot { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.dialog-foot__hint { flex: 1 1 auto; color: var(--text-muted); font-size: 10.5px; }
.dialog-button--primary { border-color: var(--accent); color: var(--accent); }
.dialog-button:disabled, .mini-button:disabled, .target-item:disabled { opacity: 0.5; cursor: default; }
</style>
