<script setup lang="ts">
/**
 * 事件记录编辑器（06-07）：一条记录的字段编辑面。
 *
 * 源码事实：`EventRecord` 只有 `time` + 记录体，**没有终点字段**，所以这里只有瞬时事件，
 * 不画区间端点、不做事件时长。
 *
 * 规则（都来自 `features/effects/eventRecords.ts`，本组件不自己判断形状）：
 * - 字段按源码成员顺序渲染；类型不符整次拒绝，不做数字↔字符串、布尔↔零一转换；
 * - 未知字段折叠进"原始记录"只读区，**没有**删除未知键的按钮；
 * - 时间改动走 `object.moveKeyframe`，同刻冲突拒绝；
 * - 删除记录走 `object.removeKeyframe`，删最后一条被拒绝并显示原因；
 * - 复制记录带 +0.1s 相对偏移，成功后切到新记录。
 *
 * 所有写入走 `ctx.commands.commit`；连续编辑同一字段用串身份合并成一个撤销项，
 * 失焦 / 回车 / 切换记录时 `endCoalescing()` 结束这一串。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { findClipContext, clipTimingOf, propertyRowsFor } from '../../../features/effects/clipContext.ts'
import {
  RECORD_COPY_OFFSET,
  duplicateRecordCommand,
  eventDefinition,
  formatRecordBody,
  knownFieldKeys,
  moveRecordCommand,
  readRecordBody,
  recordEventName,
  recordTimes,
  removeRecordCommand,
  setRecordFieldCommand,
  unknownFields,
} from '../../../features/effects/eventRecords.ts'
import type { EventFieldDef } from '../../../features/effects/eventRecords.ts'
import { isRequiredMissing } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'

const props = defineProps<{
  clipKey: string
  path: string
  time: number
}>()

const emit = defineEmits<{ close: [] }>()

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.require(CATALOG_SERVICE)

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const clipContext = computed(() => findClipContext(view.value, props.clipKey))

const row = computed<PropertyRow | null>(() => {
  const found = clipContext.value
  if (found === null) {
    return null
  }
  const objects = documentService?.clipObjects(props.clipKey)
  if (objects === null || objects === undefined) {
    return null
  }
  const rows = propertyRowsFor({
    clipKey: props.clipKey,
    trackType: found.trackType,
    objects,
    catalog,
  })
  return rows.find((item) => item.path === props.path) ?? null
})

/** 当前编辑的记录时间：复制后切到新记录，不依赖父组件重挂。 */
const activeTime = ref(props.time)
watch(
  () => props.time,
  (next) => {
    activeTime.value = next
  },
)

const definition = computed(() => (row.value === null
  ? { kind: 'instant' as const, name: props.path, known: false, fields: [] }
  : eventDefinition(row.value)))

const body = computed<JsonObject | null>(() => (row.value === null
  ? null
  : readRecordBody(row.value, activeTime.value)))

const recordCount = computed(() => row.value?.keyframes.length ?? 0)
const times = computed(() => (row.value === null ? [] : recordTimes(row.value)))
const eventName = computed(() => recordEventName(body.value, definition.value, props.path))

const missingRequired = computed(() => {
  const found = clipContext.value
  const current = row.value
  if (found === null || current === null) {
    return false
  }
  return isRequiredMissing(current, clipTimingOf(found.clip))
})

const unknownKeys = computed(() => unknownFields(body.value, knownFieldKeys(definition.value)))
const rawBody = computed(() => formatRecordBody(body.value))

const error = ref('')
const notice = ref('')

/** 字段草稿：文本 / 位置分量 / JSON 文本。 */
const drafts = ref<Record<string, string>>({})
const positionMode = ref<'none' | 'absolute' | 'relative'>('none')

/** 记录体签名：只有记录体或记录时间真的变了才重置草稿，避免打断正在输入的内容。 */
const bodySignature = computed(() => `${activeTime.value}|${JSON.stringify(body.value)}`)

watch(
  bodySignature,
  () => {
    const next: Record<string, string> = {}
    const current = body.value
    if (current !== null) {
      for (const field of definition.value.fields) {
        const value = current[field.key]
        if (field.kind === 'json') {
          next[field.key] = value === undefined ? '' : formatRecordBody(value)
        } else if (field.kind === 'position') {
          next[field.key] = ''
        } else {
          next[field.key] = typeof value === 'string' ? value : ''
        }
      }
    }
    drafts.value = next
    const position = current?.position
    if (position !== undefined && typeof position === 'object' && position !== null && !Array.isArray(position)) {
      const record = position as Record<string, JsonValue>
      positionMode.value = Object.prototype.hasOwnProperty.call(record, 'dx') ? 'relative' : 'absolute'
    } else {
      positionMode.value = 'none'
    }
  },
  { immediate: true },
)

/** 位置分量草稿（与 `drafts.position` 分开，避免和文本草稿混用）。 */
const positionDraft = ref({ a: '', b: '' })
watch(
  bodySignature,
  () => {
    const position = body.value?.position
    if (position === undefined || position === null || typeof position !== 'object' || Array.isArray(position)) {
      positionDraft.value = { a: '', b: '' }
      return
    }
    const record = position as Record<string, JsonValue>
    const firstKey = Object.prototype.hasOwnProperty.call(record, 'dx') ? 'dx' : 'x'
    const secondKey = firstKey === 'dx' ? 'dz' : 'z'
    const first = record[firstKey]
    const second = record[secondKey]
    positionDraft.value = {
      a: typeof first === 'number' ? String(first) : '',
      b: typeof second === 'number' ? String(second) : '',
    }
  },
  { immediate: true },
)

const coalesceKey = (field: string): string =>
  `eventField:${props.clipKey}:${props.path}:${activeTime.value}:${field}`

/** 提交一条记录体命令：失败就地显示原因，成功清空错误。 */
function submit(command: Parameters<typeof ctx.commands.commit>[0], coalesce?: string): boolean {
  const outcome = ctx.commands.commit(command, coalesce)
  if (!outcome.ok) {
    error.value = outcome.error ?? '写入被拒绝'
    return false
  }
  error.value = ''
  const warnings = outcome.warnings
  notice.value = warnings.length > 0 ? warnings.join('；') : ''
  return true
}

/** 字段编辑的统一入口：翻译成命令 → 提交。 */
function commitEdits(edits: Parameters<typeof setRecordFieldCommand>[0]['edits'], field: string): void {
  const current = row.value
  const currentBody = body.value
  if (current === null || currentBody === null) {
    error.value = '记录已不存在（可能已被删除或撤销）'
    return
  }
  const result = setRecordFieldCommand({
    clipKey: props.clipKey,
    row: current,
    time: activeTime.value,
    current: currentBody,
    edits,
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  submit(result.command, coalesceKey(field))
}

function commitText(field: EventFieldDef): void {
  const draft = drafts.value[field.key] ?? ''
  const currentValue = body.value?.[field.key]
  if (typeof currentValue === 'string' && currentValue === draft) {
    ctx.commands.endCoalescing()
    return
  }
  if (currentValue === undefined && draft === '') {
    ctx.commands.endCoalescing()
    return
  }
  commitEdits([{ key: field.key, value: draft }], field.key)
}

function commitJson(field: EventFieldDef): void {
  const text = drafts.value[field.key] ?? ''
  if (text.trim() === '') {
    commitEdits([{ key: field.key, remove: true }], field.key)
    return
  }
  let parsed: JsonValue
  try {
    parsed = JSON.parse(text) as JsonValue
  } catch (parseError) {
    error.value = `JSON 语法错误：${parseError instanceof Error ? parseError.message : '无法解析'}`
    return
  }
  commitEdits([{ key: field.key, value: parsed }], field.key)
}

function commitPosition(): void {
  const field = definition.value.fields.find((item) => item.kind === 'position')
  if (field === undefined) {
    return
  }
  if (positionMode.value === 'none') {
    commitEdits([{ key: field.key, remove: true }], field.key)
    return
  }
  const first = Number(positionDraft.value.a.trim())
  const second = Number(positionDraft.value.b.trim())
  if (positionDraft.value.a.trim() === '' || positionDraft.value.b.trim() === '') {
    error.value = 'position 需要两个数字分量'
    return
  }
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    error.value = 'position 的分量必须是有限数字'
    return
  }
  const value: JsonObject = positionMode.value === 'absolute'
    ? { x: first, z: second }
    : { dx: first, dz: second }
  commitEdits([{ key: field.key, value }], field.key)
}

function switchPositionMode(mode: 'none' | 'absolute' | 'relative'): void {
  if (positionMode.value === mode) {
    return
  }
  positionMode.value = mode
  if (mode === 'none') {
    commitPosition()
  }
}

function commitTime(): void {
  const current = row.value
  if (current === null) {
    error.value = '记录已不存在'
    return
  }
  const target = Number(timeDraft.value.trim())
  if (!Number.isFinite(target)) {
    error.value = '记录时间必须是有限数字'
    return
  }
  if (Math.abs(target - activeTime.value) <= 1e-6) {
    error.value = ''
    return
  }
  const result = moveRecordCommand({
    clipKey: props.clipKey,
    row: current,
    from: activeTime.value,
    to: target,
  })
  if (!result.ok) {
    error.value = result.message
    timeDraft.value = String(activeTime.value)
    return
  }
  if (submit(result.command)) {
    activeTime.value = target
    timeDraft.value = String(target)
  } else {
    timeDraft.value = String(activeTime.value)
  }
}

const timeDraft = ref(String(props.time))
watch(activeTime, (next) => {
  timeDraft.value = String(next)
})
watch(
  () => props.time,
  (next) => {
    timeDraft.value = String(next)
  },
)

function deleteRecord(): void {
  const current = row.value
  if (current === null) {
    error.value = '记录已不存在'
    return
  }
  const result = removeRecordCommand({
    clipKey: props.clipKey,
    row: current,
    time: activeTime.value,
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  if (submit(result.command)) {
    const remaining = times.value.filter((item) => Math.abs(item - activeTime.value) > 1e-6)
    const next = remaining[0]
    if (next === undefined) {
      emit('close')
      return
    }
    activeTime.value = next
  }
}

function duplicateRecord(): void {
  const current = row.value
  const currentBody = body.value
  if (current === null || currentBody === null) {
    error.value = '记录已不存在'
    return
  }
  const result = duplicateRecordCommand({
    clipKey: props.clipKey,
    row: current,
    from: activeTime.value,
    body: currentBody,
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  const command = result.command
  if (command.kind !== 'object.addKeyframe') {
    error.value = '复制命令形态异常（内部错误）'
    return
  }
  if (submit(command)) {
    activeTime.value = command.time
    notice.value = `已复制到 t=${command.time}（相对偏移 ${RECORD_COPY_OFFSET}s）`
  }
}

function selectRecord(event: Event): void {
  const target = event.target as HTMLSelectElement
  const next = Number(target.value)
  if (Number.isFinite(next)) {
    ctx.commands.endCoalescing()
    activeTime.value = next
  }
}

function onFieldBlur(): void {
  ctx.commands.endCoalescing()
}
</script>

<template>
  <section class="record-editor" aria-label="事件记录编辑器">
    <header class="record-editor__header">
      <div class="record-editor__title">
        <span class="record-editor__path">{{ path }}</span>
        <span class="record-editor__name">{{ eventName }}</span>
        <span class="record-editor__kind">瞬时事件</span>
      </div>
      <span class="record-editor__count">{{ recordCount }} 条记录</span>
      <button type="button" class="record-editor__close" @click="emit('close')">关闭</button>
    </header>

    <p v-if="row === null" class="record-editor__empty" role="alert">
      该事件叶子已不存在（可能已被删除或撤销）。关闭编辑器后刷新查看。
    </p>

    <template v-else>
      <p v-if="body === null" class="record-editor__empty" role="alert">
        记录 t={{ activeTime }} 已不存在；可能已被移动或删除。
      </p>

      <div class="record-editor__row">
        <label class="record-editor__label" for="record-time">时间（片段局部秒）</label>
        <input
          id="record-time"
          v-model="timeDraft"
          class="record-editor__input record-editor__input--number"
          type="number"
          step="0.001"
          min="0"
          @blur="commitTime(); onFieldBlur()"
          @keydown.enter.prevent="commitTime(); onFieldBlur()"
        />
        <select class="record-editor__select" :value="String(activeTime)" @change="selectRecord">
          <option v-for="time in times" :key="time" :value="String(time)">t={{ time.toFixed(3) }}</option>
        </select>
      </div>

      <div class="record-editor__actions">
        <button type="button" class="record-editor__button" @click="duplicateRecord">
          复制记录（+{{ RECORD_COPY_OFFSET }}s）
        </button>
        <button type="button" class="record-editor__button record-editor__button--danger" @click="deleteRecord">
          删除记录
        </button>
      </div>

      <p v-if="missingRequired" class="record-editor__warn">
        该事件叶子有必填缺失（属性面板会标注）；记录体仍需满足运行时形状。
      </p>

      <p v-if="error !== ''" class="record-editor__error" role="alert">{{ error }}</p>
      <p v-else-if="notice !== ''" class="record-editor__notice" role="status">{{ notice }}</p>

      <div v-if="body !== null" class="record-editor__fields">
        <div v-for="field in definition.fields" :key="field.key" class="record-editor__field">
          <label class="record-editor__label" :for="`record-field-${field.key}`">
            {{ field.label }}
            <span v-if="field.required" class="record-editor__required">必填</span>
          </label>

          <template v-if="field.kind === 'text'">
            <input
              :id="`record-field-${field.key}`"
              v-model="drafts[field.key]"
              class="record-editor__input"
              type="text"
              :disabled="!definition.known"
              @blur="commitText(field); onFieldBlur()"
              @keydown.enter.prevent="commitText(field); onFieldBlur()"
            />
          </template>

          <template v-else-if="field.kind === 'json'">
            <textarea
              :id="`record-field-${field.key}`"
              v-model="drafts[field.key]"
              class="record-editor__textarea"
              rows="5"
              spellcheck="false"
              :disabled="!definition.known"
              @blur="commitJson(field); onFieldBlur()"
            />
          </template>

          <template v-else>
            <div class="record-editor__position">
              <select
                class="record-editor__select"
                :value="positionMode"
                :disabled="!definition.known"
                @change="switchPositionMode(($event.target as HTMLSelectElement).value as 'none' | 'absolute' | 'relative')"
              >
                <option value="none">未设置</option>
                <option value="absolute">{x, z} 绝对</option>
                <option value="relative">{dx, dz} 相对</option>
              </select>
              <template v-if="positionMode !== 'none'">
                <input
                  v-model="positionDraft.a"
                  class="record-editor__input record-editor__input--number"
                  type="number"
                  step="any"
                  :aria-label="positionMode === 'absolute' ? 'x' : 'dx'"
                  @blur="commitPosition(); onFieldBlur()"
                  @keydown.enter.prevent="commitPosition(); onFieldBlur()"
                />
                <input
                  v-model="positionDraft.b"
                  class="record-editor__input record-editor__input--number"
                  type="number"
                  step="any"
                  :aria-label="positionMode === 'absolute' ? 'z' : 'dz'"
                  @blur="commitPosition(); onFieldBlur()"
                  @keydown.enter.prevent="commitPosition(); onFieldBlur()"
                />
              </template>
            </div>
          </template>

          <p v-if="field.hint !== undefined" class="record-editor__hint">{{ field.hint }}</p>
        </div>

        <p v-if="definition.fields.length === 0" class="record-editor__hint">
          未知事件路径（末段既不是 event 也不是 mod_event）：只读，不能编辑字段。
        </p>
      </div>

      <details v-if="unknownKeys.length > 0" class="record-editor__raw" open>
        <summary>原始记录（未知字段只读，共 {{ unknownKeys.length }} 个）</summary>
        <ul class="record-editor__raw-keys">
          <li v-for="key in unknownKeys" :key="key">{{ key }}</li>
        </ul>
        <pre class="record-editor__raw-body">{{ rawBody }}</pre>
      </details>
      <details v-else class="record-editor__raw">
        <summary>原始记录</summary>
        <pre class="record-editor__raw-body">{{ rawBody }}</pre>
      </details>
    </template>
  </section>
</template>

<style scoped>
.record-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
}

.record-editor__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.record-editor__title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.record-editor__path {
  font-family: var(--font-mono);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-editor__name {
  color: var(--text-secondary);
}

.record-editor__kind {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.record-editor__count {
  margin-left: auto;
  color: var(--text-secondary);
  white-space: nowrap;
}

.record-editor__close,
.record-editor__button {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.record-editor__close:hover,
.record-editor__button:hover {
  background: var(--bg-hover);
}

.record-editor__close:focus-visible,
.record-editor__button:focus-visible,
.record-editor__input:focus-visible,
.record-editor__select:focus-visible,
.record-editor__textarea:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.record-editor__button--danger {
  border-color: var(--error);
  color: var(--error);
}

.record-editor__row {
  display: grid;
  grid-template-columns: 120px minmax(80px, 140px) 1fr;
  gap: 6px;
  align-items: center;
}

.record-editor__actions {
  display: flex;
  gap: 6px;
}

.record-editor__fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.record-editor__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.record-editor__label {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.record-editor__required {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--error-bg);
  color: var(--error);
  font-family: inherit;
}

.record-editor__input,
.record-editor__select,
.record-editor__textarea {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
}

.record-editor__textarea {
  resize: vertical;
  min-height: 64px;
}

.record-editor__position {
  display: flex;
  gap: 6px;
  align-items: center;
}

.record-editor__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.record-editor__warn {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
}

.record-editor__error {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--error);
  border-radius: 3px;
  background: var(--error-bg);
  color: var(--error);
}

.record-editor__notice {
  margin: 0;
  color: var(--text-secondary);
}

.record-editor__empty {
  margin: 0;
  padding: 6px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 3px;
  color: var(--text-secondary);
}

.record-editor__raw {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}

.record-editor__raw summary {
  color: var(--text-secondary);
  cursor: pointer;
}

.record-editor__raw-keys {
  margin: 4px 0;
  padding-left: 18px;
  color: var(--warning);
  font-family: var(--font-mono);
  font-size: 11px;
}

.record-editor__raw-body {
  margin: 4px 0 0;
  padding: 6px;
  max-height: 200px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre-wrap;
}
</style>
