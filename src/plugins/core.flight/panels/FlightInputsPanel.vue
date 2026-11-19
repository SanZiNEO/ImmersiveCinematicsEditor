<script setup lang="ts">
/**
 * 12-08 飞控九槽输入面板（插件 `core.flight`，面板 `flight.inputs`）。
 *
 * 3×3 固定网格：存最近姿态 / 从片段求值 / 手动编辑 / 清空 / 槽间复制粘贴；
 * 应用前先出 diff（将改字段 + 旧值 + 新值），确认后一次提交、一次撤销。
 * 面板不直接操作文档存储；模板参数 / 路径目标由 12-06 / 12-07 接入同一选择器。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import type { DocumentService } from '../../../workbench/api/documents.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import {
  POSE_BANK_SERVICE,
  validatePoseValue,
  type ClipFieldApplyTarget,
  type PoseBankService,
  type PoseSlot,
  type PoseValue,
} from '../../../features/flight/public.ts'

const ctx = usePanelContext()
const documents = ctx.services.require<DocumentService>(DOCUMENT_SERVICE)
const flightService = ctx.services.get<PoseBankService>(POSE_BANK_SERVICE)

/** 文档修订计数（选择 / 播放头 / 修订号变化都刷新派生视图）。 */
const tick = ref(0)
let lastRevision = documents.summary().revision

const stopDocumentSubscription = documents.subscribe(() => {
  const revision = documents.summary().revision
  if (revision !== lastRevision) {
    lastRevision = revision
  }
  tick.value += 1
})

onBeforeUnmount(() => {
  stopDocumentSubscription()
})

// ── 槽库视图 ───────────────────────────────────────────────

const bank = computed(() => (flightService === undefined ? null : flightService.bank()))
const slots = computed<readonly PoseSlot[]>(() => bank.value?.slots() ?? [])
const selectedIndex = ref(0)
const copiedFrom = ref<number | null>(null)
const reasons = ref<string[]>([])

/** diff 对话框纯快照：只保留字符串行与命令，不把递归 JsonValue 带进响应式类型。 */
interface DialogRow {
  fieldPath: string
  old: string
  next: string
}
interface DialogState {
  rows: DialogRow[]
  command: DocCommand | null
}
const dialog = ref<DialogState | null>(null)

const selectedSlot = computed<PoseSlot | null>(() => {
  const list = slots.value
  return selectedIndex.value >= 0 && selectedIndex.value < list.length ? list[selectedIndex.value] : null
})

const playhead = computed(() => {
  void tick.value
  return documents.sessionView().playhead
})

const selectedClipKey = computed(() => ctx.selection.clipKey)

const SOURCE_LABEL: Record<string, string> = {
  flight: ctx.i18n.t('flight.source.flight'),
  clip: ctx.i18n.t('flight.source.clip'),
  manual: ctx.i18n.t('flight.source.manual'),
}

// ── 手动编辑草稿 ────────────────────────────────────────────

type DraftKey = 'px' | 'py' | 'pz' | 'yaw' | 'pitch' | 'roll' | 'fov' | 'zoom'

const draft = ref<Record<DraftKey, string>>({
  px: '', py: '', pz: '', yaw: '', pitch: '', roll: '', fov: '', zoom: '',
})

function syncDraft(pose: PoseValue | null): void {
  if (pose === null) {
    draft.value = { px: '', py: '', pz: '', yaw: '', pitch: '', roll: '', fov: '', zoom: '' }
    return
  }
  draft.value = {
    px: String(pose.position.x),
    py: String(pose.position.y),
    pz: String(pose.position.z),
    yaw: String(pose.yaw),
    pitch: String(pose.pitch),
    roll: String(pose.roll),
    fov: String(pose.fov),
    zoom: String(pose.zoom),
  }
}

watch(selectedSlot, (slot) => {
  syncDraft(slot?.pose ?? null)
  reasons.value = []
}, { immediate: true })

function draftToPose(): PoseValue | null {
  const values = (Object.values(draft.value) as string[]).map((text) => Number.parseFloat(text))
  if (values.some((value) => !Number.isFinite(value))) {
    return null
  }
  const [px, py, pz, yaw, pitch, roll, fov, zoom] = values
  const pose: PoseValue = {
    position: { x: px, y: py, z: pz },
    yaw, pitch, roll, fov, zoom,
  }
  return validatePoseValue(pose) === null ? pose : null
}

// ── 槽操作 ──────────────────────────────────────────────────

function selectSlot(index: number): void {
  selectedIndex.value = index
}

function captureLatest(): void {
  const target = bank.value
  const latest = target?.latest() ?? null
  if (target === null || latest === null) {
    reasons.value = [ctx.i18n.t('flight.reason.serviceMissing')]
    return
  }
  target.set(selectedIndex.value, latest, 'flight')
  reasons.value = []
}

function fromClip(): void {
  if (flightService === undefined) {
    reasons.value = [ctx.i18n.t('flight.reason.serviceMissing')]
    return
  }
  const clipKey = selectedClipKey.value
  if (clipKey === undefined) {
    reasons.value = [ctx.i18n.t('flight.reason.noClip')]
    return
  }
  const extraction = flightService.extract(clipKey, playhead.value)
  if (!extraction.ok || extraction.pose === null) {
    reasons.value = extraction.reasons.map((reason) => reason.message)
    return
  }
  bank.value?.set(selectedIndex.value, extraction.pose, 'clip')
  reasons.value = []
}

function submitManual(): void {
  const pose = draftToPose()
  if (pose === null) {
    reasons.value = ['姿态三轴与角度 / 光学必须全部为有限数字']
    return
  }
  bank.value?.set(selectedIndex.value, pose, 'manual')
  reasons.value = []
}

function clearSelected(): void {
  bank.value?.clear(selectedIndex.value)
  reasons.value = []
}

function copySelected(): void {
  copiedFrom.value = selectedIndex.value
}

function pasteSelected(): void {
  if (copiedFrom.value === null) {
    return
  }
  bank.value?.copy(copiedFrom.value, selectedIndex.value)
  reasons.value = []
}

// ── 应用（显式事务 + 前置 diff）──────────────────────────────

function currentClipTarget(): ClipFieldApplyTarget | null {
  const clipKey = selectedClipKey.value
  if (clipKey === undefined) {
    return null
  }
  const clip = documents.clipObjects(clipKey)
  if (clip === null) {
    return null
  }
  return { kind: 'clipField', clipKey, clip, time: playhead.value, frameMode: 'keyframe' }
}

function openApply(): void {
  if (flightService === undefined) {
    reasons.value = [ctx.i18n.t('flight.reason.serviceMissing')]
    return
  }
  const pose = selectedSlot.value?.pose ?? null
  const target = currentClipTarget()
  if (pose === null || target === null) {
    reasons.value = [ctx.i18n.t('flight.reason.noClip')]
    return
  }
  const plan = flightService.planApply(target, pose)
  if (!plan.ok || plan.command === null) {
    reasons.value = plan.diagnostics.map((diagnostic) => diagnostic.message)
    dialog.value = null
    return
  }
  const rawWrites = plan.writes as unknown as Array<{
    fieldPath: string
    oldValue: unknown
    newValue: unknown
  }>
  dialog.value = {
    rows: rawWrites.map((write) => ({
      fieldPath: write.fieldPath,
      old: oldText(write.oldValue),
      next: oldText(write.newValue),
    })),
    command: plan.command,
  }
  reasons.value = []
}

function confirmApply(): void {
  const state = dialog.value
  if (state === null || state.command === null) {
    return
  }
  const command = state.command as unknown as DocCommand
  ctx.commands.commit(command, 'flight.pose-apply')
  dialog.value = null
}

function cancelApply(): void {
  dialog.value = null
}

// ── 呈现辅助 ────────────────────────────────────────────────

function poseSummary(pose: PoseValue): string {
  const { x, y, z } = pose.position
  return `${round(x)}, ${round(y)}, ${round(z)} · ${round(pose.yaw)}/${round(pose.pitch)}/${round(pose.roll)} · ${round(pose.fov)}/${round(pose.zoom)}`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function oldText(value: unknown): string {
  return value === null || value === undefined ? '—' : String(value)
}
</script>

<template>
  <div class="flight-panel">
    <header class="head">
      <div class="title-row">
        <strong>{{ ctx.i18n.t('flight.panel.title') }}</strong>
        <span class="muted">{{ ctx.i18n.t('flight.panel.playhead', { time: round(playhead) }) }}</span>
      </div>
    </header>

    <div v-if="documents.view() === null" class="empty">
      {{ ctx.i18n.t('flight.panel.emptyDoc') }}
    </div>

    <template v-else>
      <div v-if="slots.every((slot) => slot.pose === null)" class="empty">
        {{ ctx.i18n.t('flight.panel.empty') }}
      </div>

      <div class="slot-grid">
        <button
          v-for="slot in slots"
          :key="slot.index"
          type="button"
          class="slot-cell"
          :class="{ active: slot.index === selectedIndex, empty: slot.pose === null }"
          @click="selectSlot(slot.index)"
        >
          <span class="slot-no">#{{ slot.index + 1 }}</span>
          <span v-if="slot.pose !== null" class="slot-source">
            {{ SOURCE_LABEL[slot.source ?? 'manual'] }}
          </span>
          <span v-else class="slot-source muted">{{ ctx.i18n.t('flight.source.none') }}</span>
          <span v-if="slot.pose !== null" class="slot-pose mono">{{ poseSummary(slot.pose) }}</span>
        </button>
      </div>

      <section class="detail">
        <div class="detail-head">
          <span>{{ ctx.i18n.t('flight.slot.index', { index: selectedIndex + 1 }) }}</span>
          <span v-if="selectedSlot?.source !== null" class="badge">
            {{ SOURCE_LABEL[selectedSlot?.source ?? 'manual'] }}
          </span>
        </div>

        <div class="fields">
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.position') }} X</span>
            <input v-model="draft.px" type="number" step="0.1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.position') }} Y</span>
            <input v-model="draft.py" type="number" step="0.1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.position') }} Z</span>
            <input v-model="draft.pz" type="number" step="0.1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.yaw') }}</span>
            <input v-model="draft.yaw" type="number" step="1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.pitch') }}</span>
            <input v-model="draft.pitch" type="number" step="1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.roll') }}</span>
            <input v-model="draft.roll" type="number" step="1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.fov') }}</span>
            <input v-model="draft.fov" type="number" step="1" />
          </label>
          <label class="field">
            <span>{{ ctx.i18n.t('flight.field.zoom') }}</span>
            <input v-model="draft.zoom" type="number" step="0.1" />
          </label>
        </div>

        <div class="actions">
          <button type="button" class="mini" @click="captureLatest">{{ ctx.i18n.t('flight.action.captureLatest') }}</button>
          <button type="button" class="mini" @click="fromClip">{{ ctx.i18n.t('flight.action.fromClip') }}</button>
          <button type="button" class="mini" @click="submitManual">{{ ctx.i18n.t('flight.action.edit') }}</button>
          <button type="button" class="mini" @click="copySelected">{{ ctx.i18n.t('flight.action.copy') }}</button>
          <button type="button" class="mini" :disabled="copiedFrom === null" @click="pasteSelected">{{ ctx.i18n.t('flight.action.paste') }}</button>
          <button type="button" class="mini" @click="clearSelected">{{ ctx.i18n.t('flight.action.clear') }}</button>
          <button type="button" class="mini primary" :disabled="selectedSlot?.pose === null" @click="openApply">
            {{ ctx.i18n.t('flight.action.apply') }}
          </button>
        </div>

        <ul v-if="reasons.length > 0" class="issues">
          <li v-for="(reason, index) in reasons" :key="`reason-${index}`" class="sev-error">{{ reason }}</li>
        </ul>
      </section>
    </template>

    <!-- 应用前 diff 对话框（面板内联，不改选择与草稿直到确认） -->
    <div v-if="dialog !== null" class="dialog-backdrop" @click.self="cancelApply">
      <div class="dialog" role="dialog" :aria-label="ctx.i18n.t('flight.diff.title')">
        <header class="dialog-head">
          <strong>{{ ctx.i18n.t('flight.diff.title') }}</strong>
          <span class="muted">{{ ctx.i18n.t('flight.diff.writes', { count: dialog.rows.length }) }}</span>
        </header>
        <table class="diff-table">
          <thead>
            <tr>
              <th>{{ ctx.i18n.t('flight.field.position') }}</th>
              <th>{{ ctx.i18n.t('flight.diff.old') }}</th>
              <th>{{ ctx.i18n.t('flight.diff.new') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in dialog.rows" :key="row.fieldPath">
              <td class="mono">{{ row.fieldPath }}</td>
              <td class="mono">{{ row.old }}</td>
              <td class="mono">{{ row.next }}</td>
            </tr>
          </tbody>
        </table>
        <footer class="dialog-actions">
          <button type="button" class="mini" @click="cancelApply">{{ ctx.i18n.t('flight.diff.cancel') }}</button>
          <button type="button" class="mini primary" @click="confirmApply">{{ ctx.i18n.t('flight.diff.confirm') }}</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flight-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 320px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.head {
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.title-row {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}

.muted {
  color: var(--text-muted);
}

.empty {
  padding: 16px 12px;
  color: var(--text-muted);
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 8px;
}

.slot-cell {
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

.slot-cell.active {
  border-color: var(--accent);
}

.slot-cell.empty {
  opacity: 0.5;
}

.slot-no {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
}

.slot-source {
  font-size: 11px;
  color: var(--text-secondary);
}

.slot-pose {
  font-size: 10px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-head {
  display: flex;
  gap: 8px;
  align-items: center;
}

.badge {
  padding: 0 6px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.fields {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field span {
  color: var(--text-secondary);
}

.field input {
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text);
  border-radius: 4px;
  padding: 3px 6px;
  font-family: var(--font-mono, monospace);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mini {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}

.mini.primary {
  border-color: var(--accent);
  color: var(--accent);
}

.mini:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.issues {
  margin: 0;
  padding-left: 16px;
}

.sev-error {
  color: var(--error);
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

.diff-table {
  width: 100%;
  border-collapse: collapse;
}

.diff-table th,
.diff-table td {
  border-top: 1px solid var(--border);
  padding: 3px 5px;
  text-align: left;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
