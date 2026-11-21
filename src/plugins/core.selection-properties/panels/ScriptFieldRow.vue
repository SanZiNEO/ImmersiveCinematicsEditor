<script setup lang="ts">
/**
 * 脚本参数的一行（检查器改版；由 `core.meta/MetaFieldRow` 迁移并补齐专用字段面）。
 *
 * 字段定义来自 02 目录；提交由父面板走 `meta.set`。错误贴在本行，内部路径只放在
 * `title` / 调试提示里，不占据可见标签。
 */
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import type { Component } from 'vue'
import { isJsonObject } from '../../../core/doc/json.ts'
import { checkValue } from '../../../core/doc/value.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import {
  resolveBaseResolution,
  validateBaseResolutionInput,
} from '../../../features/geometry/baseResolution.ts'
import { metaFieldSurfaceFor } from '../../../workbench/api/fieldSurface.ts'
import { PAGE_ROUTER } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { scriptEnumLabel, scriptFieldLabel } from '../scriptFields.ts'

const props = defineProps<{
  field: FieldEntry
  value: JsonValue | undefined
  /** 返回 `null` = 写入成功；返回字符串 = 本行错误（命令层原因）。 */
  commitValue: (key: string, value: JsonValue) => string | null
}>()

const error = ref('')
const draftWidth = ref('')
const draftHeight = ref('')

const ctx = usePanelContext()
const pageRouter = ctx.services.get(PAGE_ROUTER)

const inputId = computed(() => `script-field-${props.field.key}`)
const label = computed(() => scriptFieldLabel(props.field))
const current = computed<JsonValue | undefined>(() => {
  if (props.value !== undefined) {
    return props.value
  }
  return props.field.hasDefault ? (props.field.default as JsonValue) : undefined
})

const isBool = computed(() => props.field.type === 'bool' || props.field.type === 'boolean')
const isEnum = computed(() => props.field.type === 'enum')
const isNumber = computed(() => props.field.type === 'int' || props.field.type === 'float'
  || props.field.type === 'number' || props.field.type === 'nullable_float')
const isStructured = computed(() => props.field.type === 'object'
  || props.field.type === 'array' || props.field.type === 'map')
const isId = computed(() => props.field.key === 'id')
const isResolution = computed(() => props.field.key === 'base_resolution')
const isScreenLayers = computed(() => props.field.key === 'screen_layers')
/** 纯文本长字段：标签占一行，输入框占下一行。 */
const isMultiline = computed(() => props.field.key === 'description')

const boolValue = computed(() => current.value === true)
const textValue = computed(() => (typeof current.value === 'string' ? current.value : ''))
const numberValue = computed(() => (
  typeof current.value === 'number' && Number.isFinite(current.value) ? String(current.value) : ''
))
const enumOptions = computed(() => props.field.enumValues ?? [])

const customSurface = computed<Component | null>(() => {
  const surface = metaFieldSurfaceFor(props.field.key)
  if (surface === null) {
    return null
  }
  return defineAsyncComponent(surface.component as () => Promise<Component>)
})

/** 只有通用控件带 `id`；只读 / 专用面不产生悬空 label 关联。 */
const labelFor = computed(() => {
  if (isId.value || isResolution.value || isScreenLayers.value || isStructured.value || customSurface.value !== null) {
    return undefined
  }
  return inputId.value
})

const hint = computed(() => {
  if (isId.value) {
    return '重命名请到脚本页选中本脚本后使用「改脚本 id…」；它会同步引用，这里不直接改。'
  }
  if (isResolution.value) {
    return '像素正整数；缺省按 1920 × 1080 处理。'
  }
  if (isScreenLayers.value) {
    return '屏幕层是结构化配置；这里保留原值查看，逐层编辑暂无专用控件。'
  }
  if (isStructured.value) {
    return '结构化字段只读显示；直接用 JSON 编辑会绕过目录约束。'
  }
  return props.field.doc ?? ''
})

const structuredSummary = computed(() => {
  if (current.value === undefined) {
    return '未设置'
  }
  try {
    return JSON.stringify(current.value)
  } catch {
    return String(current.value)
  }
})

// ── 基准分辨率（复用几何工具的校验） ────────────────────────────

const resolution = computed(() => resolveBaseResolution({
  meta: { base_resolution: props.value ?? null },
}))

watch(
  () => `${resolution.value.width}x${resolution.value.height}`,
  () => {
    draftWidth.value = String(resolution.value.width)
    draftHeight.value = String(resolution.value.height)
  },
  { immediate: true },
)

function applyResolution(): void {
  const width = Number(draftWidth.value)
  const height = Number(draftHeight.value)
  const validation = validateBaseResolutionInput({ width, height })
  if (!validation.ok) {
    error.value = validation.issues.join('；')
    return
  }
  error.value = props.commitValue(props.field.key, validation.value ?? null) ?? ''
}

function clearResolution(): void {
  error.value = props.commitValue(props.field.key, null) ?? ''
}

// ── 屏幕层只读摘要 ────────────────────────────────────────────

const screenLayerFacts = computed(() => {
  const raw = current.value
  if (!isJsonObject(raw)) {
    return { total: 0, visible: 0, hidden: [] as string[], invalid: true }
  }
  const entries = Object.entries(raw)
  const hidden = entries.filter(([, value]) => value === false).map(([key]) => key)
  return {
    total: entries.length,
    visible: entries.filter(([, value]) => value === true).length,
    hidden,
    invalid: false,
  }
})

// ── 提交 ────────────────────────────────────────────────────

function submit(next: JsonValue): void {
  if (isStructured.value) {
    error.value = '结构化字段不使用通用输入。'
    return
  }
  const check = checkValue(props.field, next)
  if (!check.ok) {
    error.value = check.message
    return
  }
  error.value = props.commitValue(props.field.key, next) ?? ''
}

function onBool(event: Event): void {
  submit((event.target as HTMLInputElement).checked)
}

function onEnum(event: Event): void {
  submit((event.target as HTMLSelectElement).value)
}

function onText(event: Event): void {
  submit((event.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') {
    error.value = '需要一个数字'
    return
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    error.value = '需要有限数字'
    return
  }
  submit(parsed)
}

/** 专用字段面（当前 listener）沿用同一校验与 `meta.set` 提交。 */
function onSurfaceCommit(payload: { key: string; value: JsonValue }): void {
  submit(payload.value)
}

/** 改脚本 id 的既有安全入口在脚本页（会同步引用）；这里只负责跳转。 */
function openScriptPage(): void {
  pageRouter?.navigate('project')
}
</script>

<template>
  <div
    class="script-row"
    :class="{ 'script-row--stacked': isMultiline }"
    :data-field="field.key"
    :title="field.key"
  >
    <label class="script-row__label" :for="labelFor">
      {{ label }}
      <span v-if="field.required" class="script-row__required" title="必填">*</span>
    </label>

    <div class="script-row__control">
      <!-- ID：安全重命名在脚本页完成，这里只读（不提供会破坏引用的写入）。 -->
      <div v-if="isId" class="script-row__id">
        <code class="script-row__value">{{ textValue }}</code>
        <button type="button" class="script-row__button" @click="openScriptPage">打开脚本页</button>
      </div>

      <!-- 基准分辨率：宽 / 高分别输入，沿用几何工具的校验。 -->
      <div v-else-if="isResolution" class="script-row__resolution">
        <span v-if="!resolution.explicit" class="script-row__badge">缺省</span>
        <label class="script-row__mini">
          <span>宽</span>
          <input
            v-model="draftWidth"
            class="script-row__input script-row__input--number"
            type="number"
            min="1"
            step="1"
            aria-label="基准分辨率宽"
          >
        </label>
        <label class="script-row__mini">
          <span>高</span>
          <input
            v-model="draftHeight"
            class="script-row__input script-row__input--number"
            type="number"
            min="1"
            step="1"
            aria-label="基准分辨率高"
          >
        </label>
        <button type="button" class="script-row__button" @click="applyResolution">应用</button>
        <button
          type="button"
          class="script-row__button script-row__button--quiet"
          :disabled="!resolution.explicit"
          @click="clearResolution"
        >回缺省</button>
      </div>

      <!-- 屏幕层：结构化配置只读查看，不伪造逐层编辑。 -->
      <div v-else-if="isScreenLayers" class="script-row__readonly">
        <span v-if="screenLayerFacts.invalid && structuredSummary !== '未设置'">
          原值不是层对象，已保留：{{ structuredSummary }}
        </span>
        <span v-else-if="screenLayerFacts.invalid">未设置</span>
        <span v-else>
          {{ screenLayerFacts.total }} 层 · 显示 {{ screenLayerFacts.visible }}
          <template v-if="screenLayerFacts.hidden.length > 0">
            · 隐藏 {{ screenLayerFacts.hidden.join('、') }}
          </template>
        </span>
      </div>

      <code v-else-if="isStructured" class="script-row__value" :title="structuredSummary">{{ structuredSummary }}</code>

      <component
        :is="customSurface"
        v-else-if="customSurface !== null"
        :field="field"
        :value="current"
        @commit="onSurfaceCommit"
      />

      <template v-else>
        <label v-if="isBool" class="script-row__switch">
          <input
            :id="inputId"
            type="checkbox"
            :checked="boolValue"
            :aria-label="label"
            @change="onBool"
          >
          <span>{{ boolValue ? '开' : '关' }}</span>
        </label>

        <select
          v-else-if="isEnum"
          :id="inputId"
          class="script-row__input"
          :value="textValue"
          :aria-label="label"
          @change="onEnum"
        >
          <option v-if="textValue === ''" value="" disabled>（未设置）</option>
          <option v-for="item in enumOptions" :key="item" :value="item">
            {{ scriptEnumLabel(field.key, item) }}
          </option>
        </select>

        <input
          v-else-if="isNumber"
          :id="inputId"
          class="script-row__input script-row__input--number"
          type="number"
          :value="numberValue"
          :step="field.type === 'int' ? 1 : 'any'"
          :min="field.min"
          :max="field.max"
          :aria-label="label"
          @change="onNumber"
        >

        <textarea
          v-else-if="field.key === 'description'"
          :id="inputId"
          class="script-row__input script-row__textarea"
          rows="3"
          :value="textValue"
          :aria-label="label"
          @change="onText"
        />

        <input
          v-else
          :id="inputId"
          class="script-row__input"
          type="text"
          :value="textValue"
          :aria-label="label"
          @change="onText"
        >
      </template>
    </div>

    <p v-if="error !== ''" class="script-row__error" role="alert">{{ error }}</p>
    <p v-else-if="hint !== ''" class="script-row__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.script-row {
  display: grid;
  grid-template-columns: minmax(92px, 116px) minmax(0, 1fr);
  align-items: center;
  gap: 3px 8px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.4;
}

.script-row.script-row--stacked {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: stretch;
}

.script-row__label {
  min-width: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

.script-row--stacked .script-row__label {
  grid-column: 1;
  grid-row: 1;
}

.script-row__required {
  color: var(--warning);
}

.script-row__control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
}

.script-row--stacked .script-row__control {
  grid-column: 1;
  grid-row: 2;
  align-items: stretch;
  justify-content: stretch;
}

.script-row__input {
  width: 100%;
  max-width: 260px;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font: inherit;
}

.script-row__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.script-row__input--number {
  max-width: 110px;
  text-align: right;
}

.script-row__textarea {
  max-width: none;
  resize: vertical;
}

.script-row--stacked .script-row__textarea {
  min-height: 58px;
}

.script-row__switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.script-row__switch input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}

.script-row__value {
  overflow: hidden;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-row__id {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.script-row__id .script-row__value {
  min-width: 0;
}

.script-row__resolution {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.script-row__badge {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.script-row__mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.script-row__button {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.script-row__button:hover {
  background: var(--bg-hover);
}

.script-row__button:disabled {
  opacity: 0.45;
  cursor: default;
}

.script-row__button--quiet {
  color: var(--text-secondary);
}

.script-row__readonly {
  color: var(--text-secondary);
  font-size: 11px;
  text-align: right;
}

.script-row__error,
.script-row__hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
}

.script-row__error {
  color: var(--error);
}

.script-row__hint {
  color: var(--text-muted);
}
</style>
