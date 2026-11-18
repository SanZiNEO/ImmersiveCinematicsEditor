<script setup lang="ts">
/**
 * 覆盖链修饰符编辑器（08-01 §三 / §4.3）：`modifier` 对象 + `suppress_modifiers` 开关。
 *
 * 规则：
 * - 六通道勾选表：勾选才出现值行；未勾选通道的残留值键会被模组解析器拒绝，取消勾选即从草稿删键；
 * - mode 四档：逐通道缺省（不写 `mode` 键）/ add / multiply / replace；
 * - priority 整数输入，清空即不写键（运行时按 0）；
 * - 整表一次提交：任何勾选 / 数字改动只落在本地草稿，点"应用"时用一次 `object.setValue` 整表写入，
 *   一次撤销回到改前；草稿与文档不一致时提示"有未提交改动"；
 * - 校验：通道至少一个、值为有限数字、priority 为整数；错误就地显示，不写文档；
 * - 契约外的未知键读取时记下，提交时原样带回，不静默删除；
 * - `suppress_modifiers`（bool，不可打帧）单独一行开关，立即提交，提示"抑制整条链"。
 */
import { computed, reactive, ref, watch } from 'vue'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import {
  MODIFIER_CHANNELS,
  MODIFIER_PATHS,
  modifierChannelValueShape,
  staticRows,
  type CameraEditorInput,
} from '../fieldSurface.ts'
import PropertyValueForm from '../../effects/panels/PropertyValueForm.vue'
import { rowAt } from './editorRows.ts'
import {
  draftFromDoc,
  draftMatchesDoc,
  draftProblem,
  draftToObject,
  positionIssue,
  priorityIssue,
  scalarIssue,
  POSITION_AXES,
  type DraftIssue,
  type ModifierDraft,
  type ModeChoice,
  type PositionAxis,
} from './modifierModel.ts'
import {
  TRANSITION_CHANNEL_LABELS,
  type TransitionChannel,
} from '../transition/model.ts'

const props = defineProps<CameraEditorInput>()

const panel = usePanelContext()

/** 文档里当前的 `modifier` 本体（只读快照；草稿基于它初始化）。 */
const sourceObject = computed<JsonObject | null>(() => {
  const raw = props.objects[MODIFIER_PATHS.modifier]
  if (!isJsonObject(raw) || !Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return null
  }
  return isJsonObject(raw.value) ? raw.value : null
})

/** 本地草稿。 */
const draft = reactive<ModifierDraft>(draftFromDoc(sourceObject.value))

/** 草稿是否已有本地未提交改动；有改动时不被文档刷新覆盖。 */
const localDirty = ref(false)

function rebuildDraft(next: JsonObject | null): void {
  const rebuilt = draftFromDoc(next)
  draft.channels = rebuilt.channels
  draft.scalar = rebuilt.scalar
  draft.position = rebuilt.position
  draft.mode = rebuilt.mode
  draft.priority = rebuilt.priority
  draft.unknown = rebuilt.unknown
}

/** 选区 / 文档修订号 / 文档值变化后：草稿未被本地改动时跟随文档。 */
watch(
  () => [panel.docRevision, sourceObject.value] as const,
  () => {
    if (!localDirty.value) {
      rebuildDraft(sourceObject.value)
    }
  },
  { immediate: true, deep: true },
)

/** 整表是否与文档一致（未提交改动提示）。 */
const dirty = computed(() => !draftMatchesDoc(draft, sourceObject.value))

/** 整表第一条不可提交原因；`null` = 可提交。 */
const problem = computed<DraftIssue>(() => draftProblem(draft))

/** 提交被命令层拒绝时的本地错误（草稿保留、不写文档）。 */
const submitError = ref('')

/** 同一串整表编辑的合并身份（一次撤销回到该串开始之前）。 */
function coalesceKey(): string {
  return `modifier:${props.clipKey}`
}

/** 已勾选通道（目录顺序）。 */
const selectedChannels = computed<TransitionChannel[]>(() =>
  MODIFIER_CHANNELS.filter((channel) => draft.channels.has(channel)),
)

/** 通道是否被勾选。 */
function isSelected(channel: TransitionChannel): boolean {
  return draft.channels.has(channel)
}

/** 标记草稿已被本地改动（提交成功后清零）。 */
function markDirty(): void {
  localDirty.value = true
}

/** 勾选 / 取消勾选一个通道；取消勾选时其值键不再进入提交对象（草稿里直接不挂载）。 */
function toggleChannel(channel: TransitionChannel): void {
  if (draft.channels.has(channel)) {
    draft.channels.delete(channel)
  } else {
    draft.channels.add(channel)
  }
  markDirty()
}

/** 标量通道输入框就地校验原因。 */
function channelIssue(channel: TransitionChannel): DraftIssue {
  if (!draft.channels.has(channel)) {
    return null
  }
  return scalarIssue(channel, draft)
}

/** 标量通道输入文本变更。 */
function onScalarInput(channel: TransitionChannel, event: Event): void {
  draft.scalar[channel] = (event.target as HTMLInputElement).value
  markDirty()
}

/** position 分量输入文本变更。 */
function onAxisInput(axis: PositionAxis, event: Event): void {
  draft.position[axis] = (event.target as HTMLInputElement).value
  markDirty()
}

/** 优先级输入文本变更。 */
function onPriorityInput(event: Event): void {
  draft.priority = (event.target as HTMLInputElement).value
  markDirty()
}

/** 模式选择变更；空串 = 逐通道缺省（不写 `mode` 键）。 */
function onModeChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  draft.mode = value === '' ? null : (value as NonNullable<ModifierDraft['mode']>)
  markDirty()
}

const positionError = computed<DraftIssue>(() =>
  draft.channels.has('position') ? positionIssue(draft) : null,
)

const priorityError = computed<DraftIssue>(() => priorityIssue(draft))

/** 模式选项：首项是逐通道缺省（`null`）。 */
const MODE_OPTIONS: ReadonlyArray<{ value: ModeChoice; label: string }> = [
  { value: null, label: '逐通道缺省' },
  { value: 'add', label: 'add' },
  { value: 'multiply', label: 'multiply' },
  { value: 'replace', label: 'replace' },
]

/** 逐通道缺省档的说明文案。 */
const MODE_DEFAULT_HINT = 'position / yaw / pitch / roll = add，fov / zoom = multiply'

/** 契约外未知键（提示用；提交时原样带回）。 */
const unknownKeys = computed<string[]>(() => Object.keys(draft.unknown))

/** 提交整表：一次 `object.setValue` 写入 `modifier`，单个撤销项。 */
function apply(): void {
  if (props.disabled || problem.value !== null) {
    return
  }
  const outcome = panel.commands.commit(
    {
      kind: 'object.setValue',
      clipKey: props.clipKey,
      path: MODIFIER_PATHS.modifier,
      value: draftToObject(draft),
    },
    coalesceKey(),
  )
  if (!outcome.ok) {
    submitError.value = outcome.error ?? '修饰符写入被拒绝'
    return
  }
  submitError.value = ''
  localDirty.value = false
}

// ── suppress_modifiers 抑制开关（普通 bool 叶子，复用 06 值控件立即提交）──

const suppressRow = computed(() => rowAt(staticRows(props.rows), MODIFIER_PATHS.suppress))

/** 标量通道的输入 aria 标签。 */
function scalarLabel(channel: TransitionChannel): string {
  return `modifier ${channel}`
}

/** position 分量的输入 aria 标签。 */
function axisLabel(axis: PositionAxis): string {
  return `modifier position ${axis}`
}

/** 通道标签（与过渡六通道同源，不另抄一份）。 */
const CHANNEL_LABELS = TRANSITION_CHANNEL_LABELS

</script>

<template>
  <div class="modifier-editor">
    <p class="modifier-editor__hint" role="note">
      勾选生效通道，再填写对应值；未勾选的通道不会写入值键。
    </p>

    <fieldset class="modifier-editor__channels" :disabled="disabled">
      <legend class="modifier-editor__legend">通道掩码</legend>

      <label
        v-for="channel in MODIFIER_CHANNELS"
        :key="channel"
        class="modifier-editor__channel"
        :class="{ 'is-checked': isSelected(channel) }"
      >
        <input
          type="checkbox"
          :checked="isSelected(channel)"
          :aria-label="`启用通道 ${CHANNEL_LABELS[channel]}`"
          @change="toggleChannel(channel)"
        />
        <span class="modifier-editor__channel-name">{{ CHANNEL_LABELS[channel] }}</span>
        <span class="modifier-editor__channel-key">{{ channel }}</span>
      </label>

      <div v-if="selectedChannels.length === 0" class="modifier-editor__empty" role="status">
        未勾选任何通道
      </div>

      <div v-for="channel in selectedChannels" :key="channel" class="modifier-editor__values">
        <div v-if="modifierChannelValueShape(channel) === 'position'" class="modifier-editor__position">
          <span class="modifier-editor__row-label">position 三轴</span>
          <div class="modifier-editor__axes">
            <label
              v-for="axis in POSITION_AXES"
              :key="axis"
              class="modifier-editor__axis"
            >
              <span class="modifier-editor__axis-key">{{ axis }}</span>
              <input
                type="number"
                step="any"
                :value="draft.position[axis]"
                :aria-label="axisLabel(axis)"
                :disabled="disabled"
                @input="onAxisInput(axis, $event)"
              />
            </label>
          </div>
          <p v-if="positionError !== null" class="modifier-editor__error" role="alert">
            {{ positionError }}
          </p>
        </div>

        <label v-else class="modifier-editor__scalar">
          <span class="modifier-editor__row-label">{{ channel }}</span>
          <input
            type="number"
            step="any"
            :value="draft.scalar[channel]"
            :aria-label="scalarLabel(channel)"
            :disabled="disabled"
            @input="onScalarInput(channel, $event)"
          />
        </label>
        <p v-if="channelIssue(channel) !== null" class="modifier-editor__error" role="alert">
          {{ channelIssue(channel) }}
        </p>
      </div>
    </fieldset>

    <fieldset class="modifier-editor__fields" :disabled="disabled">
      <label class="modifier-editor__field">
        <span class="modifier-editor__row-label">合成模式</span>
        <select
          :model-value="draft.mode === null ? '' : draft.mode"
          aria-label="modifier 合成模式"
          @change="onModeChange($event)"
        >
          <option v-for="option in MODE_OPTIONS" :key="String(option.value)" :value="option.value === null ? '' : option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <p v-if="draft.mode === null" class="modifier-editor__hint" role="note">{{ MODE_DEFAULT_HINT }}</p>

      <label class="modifier-editor__field">
        <span class="modifier-editor__row-label">priority</span>
        <input
          type="number"
          step="1"
          :value="draft.priority"
          aria-label="modifier priority（留空则不写键）"
          :disabled="disabled"
          placeholder="留空 = 0"
          @input="onPriorityInput($event)"
        />
      </label>
      <p v-if="priorityError !== null" class="modifier-editor__error" role="alert">{{ priorityError }}</p>
    </fieldset>

    <p v-if="unknownKeys.length > 0" class="modifier-editor__unknown" role="note">
      文档中存在不在契约内的键（{{ unknownKeys.join('、') }}），提交时原样保留。
    </p>

    <p v-if="problem !== null" class="modifier-editor__error" role="alert">{{ problem }}</p>
    <p v-else-if="submitError !== ''" class="modifier-editor__error" role="alert">{{ submitError }}</p>

    <div class="modifier-editor__actions">
      <button
        type="button"
        class="modifier-editor__apply"
        :disabled="disabled || problem !== null"
        @click="apply"
      >
        应用
      </button>
      <span v-if="dirty" class="modifier-editor__dirty" role="status">有未提交改动</span>
    </div>

    <div class="modifier-editor__suppress">
      <PropertyValueForm
        v-if="suppressRow !== undefined"
        :row="suppressRow"
        panel="properties"
        :playhead="playhead"
        :disabled="disabled"
      />
      <p class="modifier-editor__hint" role="note">抑制整条修饰符链</p>
    </div>
  </div>
</template>

<style scoped>
.modifier-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.modifier-editor__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.modifier-editor__channels,
.modifier-editor__fields {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  min-width: 0;
}

.modifier-editor__channels:disabled,
.modifier-editor__fields:disabled {
  opacity: 0.6;
}

.modifier-editor__legend {
  padding: 0 2px;
  color: var(--text-muted);
  font-size: 10px;
}

.modifier-editor__channel {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.modifier-editor__channel-name {
  flex: 0 0 auto;
}

.modifier-editor__channel-key {
  color: var(--text-muted);
  font-size: 10px;
}

.modifier-editor__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.modifier-editor__values {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 14px;
  min-width: 0;
}

.modifier-editor__scalar,
.modifier-editor__field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.modifier-editor__position {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.modifier-editor__axes {
  display: flex;
  gap: 6px;
}

.modifier-editor__axis {
  display: flex;
  align-items: center;
  gap: 4px;
}

.modifier-editor__axis-key {
  color: var(--text-muted);
  font-size: 10px;
}

.modifier-editor__row-label {
  flex: 0 0 auto;
}

.modifier-editor__scalar input,
.modifier-editor__field input,
.modifier-editor__field select,
.modifier-editor__axis input {
  min-width: 0;
  flex: 1 1 auto;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: inherit;
  font-size: 11px;
}

.modifier-editor__scalar input:focus,
.modifier-editor__field input:focus,
.modifier-editor__field select:focus,
.modifier-editor__axis input:focus {
  outline: none;
  border-color: var(--focus);
}

.modifier-editor__error {
  margin: 0;
  color: var(--warning);
  font-size: 10px;
}

.modifier-editor__unknown {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.modifier-editor__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.modifier-editor__apply {
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.modifier-editor__apply:disabled {
  opacity: 0.5;
  cursor: default;
}

.modifier-editor__apply:not(:disabled):hover {
  border-color: var(--accent);
}

.modifier-editor__dirty {
  color: var(--warning);
  font-size: 10px;
}

.modifier-editor__suppress {
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
</style>
