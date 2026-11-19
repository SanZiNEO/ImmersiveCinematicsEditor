<script setup lang="ts">
/**
 * 12-06 模板面板 / 12-07 快捷效果条（插件 `core.templates`，面板 `templates`）。
 *
 * 三层分组列表 + 搜索；参数表单按声明类型渲染；插入目标按层给可选项与禁用原因；
 * 生成前摘要与 diff 数字全部来自模板内核 `StructureSummary`；确认后一次提交独立事务，
 * 失败零残留。姿态类参数复用 `core.flight` 注册的同一九槽服务与共享选择器，
 * 不在面板本地造槽或复制第二套选择器。
 *
 * 面板不直接操作文档存储：读文档走 `DocumentService.serialize()` 只读快照，
 * 写文档只走 `PanelContext.commands.commit`。
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'

import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { ScriptDoc } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { ParamValue, PoseValue, TemplateLayer } from '../../../features/templates/public.ts'
import { documentSnapshot } from '../../../features/paths/docAccess.ts'
import {
  POSE_BANK_SERVICE,
  type PoseBankService,
  type PoseSlot,
} from '../../../features/flight/public.ts'
import PoseSlotPicker from '../../core.flight/panels/PoseSlotPicker.vue'

import {
  LAYERS,
  buildRequest,
  findTemplate,
  initialParams,
  issueMessage,
  plan,
  pickerAvailability,
  readiness,
  runApply,
  summaryView,
  summarize,
  targetOfOption,
  targetOptions,
  templatesForLayer,
  type ApplyDeps,
  type SummaryView,
  type TargetOption,
} from '../panelModel.ts'
import {
  QUICK_EFFECTS,
  evaluateQuickEffect,
  type QuickEffectDef,
  type QuickEvaluate,
} from '../quickEffects.ts'
import type { GenerationPlan } from '../../../features/templates/public.ts'

const ctx = usePanelContext()
const documents = ctx.services.require(DOCUMENT_SERVICE)
const catalog = ctx.services.get<CatalogIndex>(CATALOG_SERVICE)
const flightService = ctx.services.get<PoseBankService>(POSE_BANK_SERVICE)

// ── 修订刷新 ────────────────────────────────────────────────────────────────

const tick = ref(0)
let lastRevision = documents.summary().revision
const stopDocumentSubscription = documents.subscribe(() => {
  const revision = documents.summary().revision
  if (revision !== lastRevision) lastRevision = revision
  tick.value += 1
})
onBeforeUnmount(() => stopDocumentSubscription())

// ── 面板状态 ────────────────────────────────────────────────────────────────

const layer = ref<TemplateLayer>('clip')
const query = ref('')
const selectedId = ref<string | null>(null)
const params = ref<Record<string, ParamValue>>({})
const targetKey = ref('')
// `shallowRef`：计划结果携带深层联合类型 DocCommand，`ref` 的深解包会触发 TS2589。
const pendingPlan = shallowRef<GenerationPlan | null>(null)
const confirmOpen = ref(false)
const status = ref<{ kind: 'info' | 'warning' | 'error'; message: string } | null>(null)
const formRef = ref<HTMLElement | null>(null)

const pickerState = ref<{ open: boolean; paramKey: string; list: boolean }>({
  open: false,
  paramKey: '',
  list: false,
})

// ── 只读快照与会话 ────────────────────────────────────────────────────────────

const doc = computed<ScriptDoc | null>(() => {
  void tick.value
  return documentSnapshot(documents, catalog)
})

const playhead = computed(() => {
  void tick.value
  return documents.sessionView().playhead
})

const docOpen = computed(() => documents.view() !== null)
const selectedClipKey = computed(() => ctx.selection.clipKey ?? null)

// ── 模板列表与选中定义 ──────────────────────────────────────────────────────

const templates = computed(() => templatesForLayer(layer.value, query.value))

const def = computed(() => (selectedId.value === null ? null : findTemplate(selectedId.value)))

function selectTemplate(id: string): void {
  const next = findTemplate(id)
  if (next === null) return
  selectedId.value = id
  params.value = initialParams(next)
  targetKey.value = ''
  pendingPlan.value = null
  confirmOpen.value = false
  status.value = null
}

function listTemplatesOfLayer(value: TemplateLayer) {
  return templatesForLayer(value, '')
}

/** 页签切换才重置选择；快捷效果直接设层时不回退到首个模板。 */
function onLayerChange(value: TemplateLayer): void {
  layer.value = value
  const first = listTemplatesOfLayer(value)[0]
  selectTemplate(first?.id ?? '')
}

// 初始选中第一层第一个模板。
const initialFirst = listTemplatesOfLayer('clip')[0]
if (initialFirst !== undefined) selectTemplate(initialFirst.id)

// ── 参数 / 问题 / 摘要 / 目标 ────────────────────────────────────────────────

function currentTargetContext() {
  return { doc: doc.value, playhead: playhead.value, selectedClipKeys: ctx.clipKeys }
}

const request = computed(() => {
  if (def.value === null || catalog === undefined) return null
  const target = selectedTarget.value ?? null
  const insert = target === null
    ? { mode: 'atPlayhead' as const }
    : targetOfOption(target, playhead.value)
  return buildRequest(
    def.value,
    params.value,
    insert,
    doc.value,
    catalog,
    playhead.value,
    ctx.clipKeys,
  )
})

const issues = computed(() => {
  if (request.value === null) return []
  return summarize(request.value).issues
})

const summary = computed<SummaryView | null>(() => {
  if (request.value === null) return null
  return summaryView(summarize(request.value).summary)
})

const targetOpts = computed<TargetOption[]>(() => {
  if (def.value === null) return []
  return targetOptions(def.value, currentTargetContext())
})

const selectedTarget = computed<TargetOption | null>(() => {
  const options = targetOpts.value
  if (options.length === 0) return null
  const picked = options.find((option) => option.key === targetKey.value)
  if (picked !== undefined) return picked
  return options.find((option) => option.enabled) ?? options[0]
})

const readinessState = computed(() => readiness(issues.value, selectedTarget.value))

function paramError(paramKey: string): string | null {
  return issueMessage(issues.value, paramKey)
}

// ── 九槽接线 ─────────────────────────────────────────────────────────────────

const bank = computed(() => (flightService === undefined ? null : flightService.bank()))
const slots = computed<readonly PoseSlot[]>(() => bank.value?.slots() ?? [])
const filledSlots = computed<PoseValue[]>(
  () => slots.value.filter((slot) => slot.pose !== null).map((slot) => slot.pose as PoseValue),
)
const pickerAvail = computed(() =>
  pickerAvailability(flightService !== undefined, docOpen.value, filledSlots.value.length),
)

function openPicker(paramKey: string, list: boolean): void {
  if (!pickerAvail.value.enabled) return
  pickerState.value = { open: true, paramKey, list }
}

function closePicker(): void {
  pickerState.value = { open: false, paramKey: '', list: false }
}

function onPickSlot(index: number): void {
  const slot = slots.value[index]
  if (slot === undefined || slot.pose === null) return
  const pose = slot.pose
  const { paramKey, list } = pickerState.value
  if (list) {
    const current = Array.isArray(params.value[paramKey]) ? (params.value[paramKey] as PoseValue[]) : []
    params.value = { ...params.value, [paramKey]: [...current, pose] }
  } else {
    params.value = { ...params.value, [paramKey]: pose }
  }
  closePicker()
}

function removePose(paramKey: string, index: number): void {
  const current = Array.isArray(params.value[paramKey]) ? (params.value[paramKey] as PoseValue[]) : []
  params.value = { ...params.value, [paramKey]: current.filter((_, i) => i !== index) }
}

// ── 参数控件写入 ─────────────────────────────────────────────────────────────

function setNumber(paramKey: string, raw: string, integer: boolean): void {
  const parsed = Number.parseFloat(raw)
  params.value = {
    ...params.value,
    [paramKey]: Number.isFinite(parsed) ? (integer ? Math.trunc(parsed) : parsed) : raw,
  }
}

function setString(paramKey: string, raw: string): void {
  params.value = { ...params.value, [paramKey]: raw }
}

function setBoolean(paramKey: string, raw: boolean): void {
  params.value = { ...params.value, [paramKey]: raw }
}

function poseText(pose: PoseValue | null): string {
  if (pose === null) return ctx.i18n.t('templates.pose.empty')
  const { x, y, z } = pose.position
  return `${round(x)}, ${round(y)}, ${round(z)} · ${round(pose.yaw)}/${round(pose.pitch)}/${round(pose.roll)}`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

// ── 快捷效果 ────────────────────────────────────────────────────────────────

function sourcePose(): PoseValue | null {
  if (flightService === undefined) return null
  if (selectedClipKey.value !== null) {
    const extraction = flightService.extract(selectedClipKey.value, playhead.value)
    if (extraction.ok && extraction.pose !== null) return extraction.pose
  }
  return bank.value?.latest() ?? null
}

const quickRows = computed<Array<{ def: QuickEffectDef; evaluated: QuickEvaluate }>>(() => {
  const selector = typeof params.value.selector === 'string' ? params.value.selector : ''
  const context = {
    docOpen: docOpen.value,
    sourcePose: sourcePose(),
    filledSlots: filledSlots.value,
    selector,
  }
  return QUICK_EFFECTS.map((def) => ({ def, evaluated: evaluateQuickEffect(def, context) }))
})

function applyQuick(row: { def: QuickEffectDef; evaluated: QuickEvaluate }): void {
  if (!row.evaluated.enabled) return
  const next = findTemplate(row.def.templateId)
  if (next === null) return
  layer.value = next.layer
  selectedId.value = next.id
  params.value = { ...row.evaluated.params }
  targetKey.value = ''
  pendingPlan.value = null
  confirmOpen.value = false
  status.value = null
  void nextTick(() => formRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

// ── 计划 / 提交（同一事务通道）────────────────────────────────────────────────

function openPlan(): void {
  if (request.value === null) return
  const result = plan(request.value)
  pendingPlan.value = result
  if (!result.ok) {
    confirmOpen.value = false
    status.value = {
      kind: 'error',
      message: result.diagnostics.map((diagnostic) => diagnostic.message).join('；'),
    }
    return
  }
  status.value = null
  confirmOpen.value = true
}

async function confirmApply(): Promise<void> {
  const target = selectedTarget.value
  if (pendingPlan.value === null || target === null) return
  const freshDocument = target.mode === 'newDocument' && target.key === 'newDocument'
  let freshOpened = false
  if (freshDocument) {
    const opened = await documents.newDoc()
    if (!opened.ok) {
      status.value = { kind: 'error', message: opened.error ?? ctx.i18n.t('templates.status.failed') }
      pendingPlan.value = null
      confirmOpen.value = false
      return
    }
    freshOpened = true
  }
  const deps: ApplyDeps = {
    plan: plan,
    commit: (command: DocCommand) => ctx.commands.commit(command),
    select: (clipKeys) => ctx.commands.selectMany(clipKeys),
  }
  const outcome = runApply(deps, pendingPlan.value, freshOpened)
  if (outcome.ok) {
    const clipCount = pendingPlan.value.summary.clipCount
    status.value = {
      kind: 'info',
      message: ctx.i18n.t('templates.status.done', { clipCount }),
    }
    ctx.status.notify(ctx.i18n.t('templates.status.done', { clipCount }), 'info')
  } else {
    status.value = {
      kind: 'error',
      message: outcome.failures.map((failure) => failure.message).join('；'),
    }
  }
  pendingPlan.value = null
  confirmOpen.value = false
}

function cancelConfirm(): void {
  pendingPlan.value = null
  confirmOpen.value = false
}

// ── 呈现辅助 ────────────────────────────────────────────────────────────────

const reasonLabel: Record<string, string> = {
  noSelection: 'templates.reason.noSelection',
  selectionTypeMismatch: 'templates.reason.selectionTypeMismatch',
  noMatchingTrack: 'templates.reason.noMatchingTrack',
  docNonEmpty: 'templates.reason.docNonEmpty',
  serviceMissing: 'templates.reason.serviceMissing',
  noDoc: 'templates.reason.noDoc',
  slotsEmpty: 'templates.reason.slotsEmpty',
  noTarget: 'templates.reason.noTarget',
}

const quickReasonLabel: Record<string, string> = {
  noDoc: 'quick.reason.noDoc',
  noPose: 'quick.reason.noPose',
  needSlots: 'quick.reason.needSlots',
  needSelector: 'quick.reason.needSelector',
}

function reasonText(code: string): string {
  const key = reasonLabel[code]
  return key === undefined ? code : ctx.i18n.t(key)
}

function quickReasonText(def: QuickEffectDef, evaluated: QuickEvaluate): string {
  if (evaluated.reasonCode === '') return ''
  const key = quickReasonLabel[evaluated.reasonCode]
  return ctx.i18n.t(key, evaluated.reasonParams)
}

function targetLabel(option: TargetOption): string {
  return ctx.i18n.t(option.labelKey)
}
</script>

<template>
  <div class="templates-panel">
    <header class="head">
      <strong>{{ ctx.i18n.t('templates.panel.title') }}</strong>
      <span class="muted">{{ ctx.i18n.t('templates.snapshot.targetTypes') }}: {{ def?.targetTrackTypes.join(', ') || '—' }}</span>
    </header>

    <!-- 快捷效果条 -->
    <section class="quick-bar">
      <div class="quick-title">{{ ctx.i18n.t('quick.bar.title') }}</div>
      <div class="quick-rows">
        <button
          v-for="row in quickRows"
          :key="row.def.id"
          type="button"
          class="quick-chip"
          :disabled="!row.evaluated.enabled"
          :title="quickReasonText(row.def, row.evaluated)"
          @click="applyQuick(row)"
        >
          {{ ctx.i18n.t(row.def.titleKey) }}
        </button>
      </div>
    </section>

    <div v-if="!docOpen" class="empty">{{ ctx.i18n.t('templates.empty.noDoc') }}</div>

    <template v-else>
      <!-- 层页签 + 搜索 -->
      <nav class="layers">
        <button
          v-for="layerOption in LAYERS"
          :key="layerOption"
          type="button"
          class="layer-tab"
          :class="{ active: layer === layerOption }"
          @click="onLayerChange(layerOption)"
        >
          {{ ctx.i18n.t(`templates.layer.${layerOption}`) }}
        </button>
        <input v-model="query" type="search" :placeholder="ctx.i18n.t('templates.search.placeholder')" class="search" />
      </nav>

      <div class="body">
        <!-- 模板列表 -->
        <aside class="template-list">
          <p v-if="templates.length === 0" class="empty">{{ ctx.i18n.t('templates.list.empty') }}</p>
          <button
            v-for="item in templates"
            :key="item.id"
            type="button"
            class="template-item"
            :class="{ active: selectedId === item.id }"
            @click="selectTemplate(item.id)"
          >
            <span class="template-title">{{ ctx.i18n.t(item.titleKey) }}</span>
            <span class="template-desc muted">{{ ctx.i18n.t(item.descriptionKey) }}</span>
          </button>
        </aside>

        <!-- 参数 / 目标 / 摘要 -->
        <section v-if="def !== null" ref="formRef" class="form">
          <h3 class="form-head">{{ ctx.i18n.t(def.titleKey) }}</h3>
          <p class="muted">{{ ctx.i18n.t(def.descriptionKey) }}</p>

          <div class="param-group">
            <div v-for="param in def.params" :key="param.key" class="param-row" :class="{ invalid: paramError(param.key) !== null }">
              <label class="param-label">
                <span>{{ ctx.i18n.t(param.labelKey) }}</span>
                <span v-if="param.unit" class="muted">（{{ param.unit }}）</span>
              </label>

              <!-- number / integer -->
              <input
                v-if="param.kind === 'number' || param.kind === 'integer'"
                type="number"
                :min="param.min"
                :max="param.max"
                :step="param.kind === 'integer' ? 1 : 0.1"
                :value="typeof params[param.key] === 'number' ? (params[param.key] as number) : ''"
                @input="setNumber(param.key, ($event.target as HTMLInputElement).value, param.kind === 'integer')"
              />

              <!-- boolean -->
              <label v-else-if="param.kind === 'boolean'" class="bool-row">
                <input
                  type="checkbox"
                  :checked="params[param.key] === true"
                  @change="setBoolean(param.key, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ params[param.key] === true ? 'true' : 'false' }}</span>
              </label>

              <!-- enum -->
              <select
                v-else-if="param.kind === 'enum'"
                :value="typeof params[param.key] === 'string' ? (params[param.key] as string) : ''"
                @change="setString(param.key, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="value in param.enumValues" :key="value" :value="value">{{ value }}</option>
              </select>

              <!-- color -->
              <span v-else-if="param.kind === 'color'" class="color-row">
                <input
                  type="color"
                  :value="typeof params[param.key] === 'string' ? (params[param.key] as string) : '#000000'"
                  @input="setString(param.key, ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="text"
                  :value="typeof params[param.key] === 'string' ? (params[param.key] as string) : ''"
                  @input="setString(param.key, ($event.target as HTMLInputElement).value)"
                />
              </span>

              <!-- text / selector -->
              <input
                v-else-if="param.kind === 'text' || param.kind === 'selector'"
                type="text"
                :value="typeof params[param.key] === 'string' ? (params[param.key] as string) : ''"
                @input="setString(param.key, ($event.target as HTMLInputElement).value)"
              />

              <!-- pose -->
              <span v-else-if="param.kind === 'pose'" class="pose-row">
                <span class="mono pose-text">{{ poseText((params[param.key] as PoseValue) ?? null) }}</span>
                <button
                  type="button"
                  class="mini"
                  :disabled="!pickerAvail.enabled"
                  :title="pickerAvail.reasonCode ? reasonText(pickerAvail.reasonCode) : ''"
                  @click="openPicker(param.key, false)"
                >
                  {{ ctx.i18n.t('templates.pick.fromSlot') }}
                </button>
              </span>

              <!-- poseList -->
              <span v-else-if="param.kind === 'poseList'" class="pose-list">
                <div v-for="(entry, index) in ((params[param.key] as PoseValue[]) ?? [])" :key="index" class="pose-list-row">
                  <span class="mono">{{ poseText(entry) }}</span>
                  <button type="button" class="mini" @click="removePose(param.key, index)">
                    {{ ctx.i18n.t('templates.poseList.remove') }}
                  </button>
                </div>
                <button
                  type="button"
                  class="mini"
                  :disabled="!pickerAvail.enabled"
                  :title="pickerAvail.reasonCode ? reasonText(pickerAvail.reasonCode) : ''"
                  @click="openPicker(param.key, true)"
                >
                  {{ ctx.i18n.t('templates.poseList.add') }}
                </button>
              </span>

              <p v-if="paramError(param.key) !== null" class="field-error">{{ paramError(param.key) }}</p>
            </div>
          </div>

          <!-- 插入目标 -->
          <div class="param-group">
            <h4>{{ ctx.i18n.t('templates.form.target') }}</h4>
            <label v-for="option in targetOpts" :key="option.key" class="target-row" :class="{ disabled: !option.enabled }">
              <input
                type="radio"
                name="template-target"
                :checked="selectedTarget?.key === option.key"
                :disabled="!option.enabled"
                @change="targetKey = option.key"
              />
              <span>{{ targetLabel(option) }}</span>
              <span v-if="!option.enabled" class="reason">{{ reasonText(option.reasonCode) }}</span>
            </label>
          </div>

          <!-- 结构摘要 -->
          <div v-if="summary !== null" class="summary">
            <h4>{{ ctx.i18n.t('templates.form.summary') }}</h4>
            <ul class="summary-facts">
              <li>{{ ctx.i18n.t('templates.snapshot.clips') }}: {{ summary.clipCount }}</li>
              <li>{{ ctx.i18n.t('templates.snapshot.tracks') }}: {{ summary.trackCount }}</li>
              <li>{{ ctx.i18n.t('templates.snapshot.paths') }}: {{ summary.pathCount }}</li>
              <li>{{ ctx.i18n.t('templates.snapshot.triggers') }}: {{ summary.triggerCount }}</li>
              <li>{{ ctx.i18n.t('templates.snapshot.totalDuration') }}: {{ summary.totalDuration }}s</li>
              <li v-if="summary.createsTrack">{{ ctx.i18n.t('templates.snapshot.createsTrack') }}</li>
              <li v-if="summary.createsDocument">{{ ctx.i18n.t('templates.snapshot.createsDocument') }}</li>
            </ul>
            <ul v-if="summary.segments.length > 0" class="segments">
              <li v-for="(segment, index) in summary.segments" :key="index">
                {{ ctx.i18n.t('templates.snapshot.segment', { index: index + 1, start: round(segment.start), duration: round(segment.duration) }) }}
              </li>
            </ul>
            <p v-if="summary.conflicts.length > 0" class="reason">
              {{ ctx.i18n.t('templates.snapshot.conflicts') }}: {{ summary.conflicts.map((conflict) => conflict.clipKey).join(', ') }}
            </p>
            <p v-for="note in summary.notes" :key="note" class="muted">{{ note }}</p>
          </div>

          <div class="footer">
            <p v-if="status !== null" :class="`status status-${status.kind}`">{{ status.message }}</p>
            <button
              type="button"
              class="primary"
              :disabled="!readinessState.enabled"
              @click="openPlan"
            >
              {{ ctx.i18n.t('templates.apply') }}
            </button>
          </div>
        </section>
      </div>
    </template>

    <!-- 应用前确认（diff 摘要；取消不改文档） -->
    <div v-if="confirmOpen && pendingPlan !== null" class="dialog-backdrop" @click.self="cancelConfirm">
      <div class="dialog" role="dialog">
        <header class="dialog-head">
          <strong>{{ ctx.i18n.t('templates.form.summary') }}</strong>
          <span class="muted">{{ ctx.i18n.t('templates.apply.undoHint') }}</span>
        </header>
        <ul class="summary-facts">
          <li>{{ ctx.i18n.t('templates.snapshot.clips') }}: {{ pendingPlan.summary.clipCount }}</li>
          <li>{{ ctx.i18n.t('templates.snapshot.tracks') }}: {{ pendingPlan.summary.trackCount }}</li>
          <li>{{ ctx.i18n.t('templates.snapshot.paths') }}: {{ pendingPlan.summary.pathCount }}</li>
          <li>{{ ctx.i18n.t('templates.snapshot.triggers') }}: {{ pendingPlan.summary.triggerCount }}</li>
        </ul>
        <footer class="dialog-actions">
          <button type="button" class="mini" @click="cancelConfirm">{{ ctx.i18n.t('templates.apply.cancel') }}</button>
          <button type="button" class="mini primary" @click="confirmApply">
            {{ ctx.i18n.t('templates.apply.confirm') }}
          </button>
        </footer>
      </div>
    </div>

    <!-- 共享九槽选择器（来自 core.flight，不复制第二套） -->
    <PoseSlotPicker
      :open="pickerState.open"
      :slots="slots"
      :on-pick="onPickSlot"
      :on-close="closePicker"
    />
  </div>
</template>

<style scoped>
.templates-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 320px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.muted {
  color: var(--text-muted);
}

.empty {
  padding: 16px 12px;
  color: var(--text-muted);
}

.quick-bar {
  border-bottom: 1px solid var(--border);
  padding: 6px 8px;
  flex: 0 0 auto;
}

.quick-title {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.quick-rows {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.quick-chip {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 11px;
}

.quick-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.layers {
  display: flex;
  gap: 4px;
  padding: 6px 8px 0;
  align-items: center;
}

.layer-tab {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}

.layer-tab.active {
  border-color: var(--accent);
  color: var(--accent);
}

.search {
  margin-left: auto;
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 6px;
  min-width: 120px;
}

.body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  gap: 8px;
  padding: 8px;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 42%;
  overflow-y: auto;
}

.template-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 6px;
  cursor: pointer;
  text-align: left;
}

.template-item.active {
  border-color: var(--accent);
}

.template-title {
  font-weight: 600;
}

.template-desc {
  font-size: 11px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  overflow-y: auto;
}

.form-head {
  margin: 0;
  font-size: 13px;
}

.param-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-group h4 {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.param-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.param-row.invalid input,
.param-row.invalid select {
  border-color: var(--error);
}

.param-label {
  display: flex;
  gap: 4px;
  color: var(--text-secondary);
}

.param-row input,
.param-row select {
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text);
  border-radius: 4px;
  padding: 3px 6px;
  font-family: var(--font-mono, monospace);
}

.bool-row,
.pose-row,
.color-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pose-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pose-list-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.field-error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
}

.target-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.target-row.disabled {
  opacity: 0.6;
}

.target-row .reason {
  color: var(--text-muted);
  font-size: 11px;
}

.summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
}

.summary-facts,
.segments {
  margin: 0;
  padding-left: 16px;
}

.reason {
  color: var(--error);
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}

.status {
  font-size: 11px;
}

.status-info {
  color: var(--text-secondary);
}

.status-warning {
  color: var(--warning, var(--text-secondary));
}

.status-error {
  color: var(--error);
}

.mini {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}

.primary,
.mini.primary {
  border: 1px solid var(--accent);
  background: var(--bg-raised);
  color: var(--accent);
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
}

.mini:disabled,
.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mono {
  font-family: var(--font-mono, monospace);
}

.dialog-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  z-index: 10;
}

.dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 360px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-panel);
  padding: 10px;
}

.dialog-head {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
