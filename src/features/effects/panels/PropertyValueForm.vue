<script setup lang="ts">
/**
 * 值控件（06-03）：属性面板与效果面板共用的一套输入面，按 `controlKindOf` 九种类型分派。
 *
 * 规则（都来自 `valueControls.ts`，本组件不自己判断）：
 * - 提交目标由 `resolveTarget` 决定：静态值 / 已存在节点 / 待新增节点；
 * - 值合法性由 `validateValue` 决定，越界一律拒绝、不夹取；
 * - 效果面板播放头没有节点时只留草稿，必须显式"添加帧"才发 `add-keyframe`；
 * - 失败时错误显示在控件下方，草稿保留、焦点不跳走、文档与撤销栈都不动。
 *
 * 所有写入走 `ctx.commands.commit`；连续改同一节点用串身份合并成一个撤销项。
 */
import { computed, ref, watch } from 'vue'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { segmentIndexAt, sampleValue } from '../easing.ts'
import { easingKey, readEasingTable } from '../easingStore.ts'
import { PLAYHEAD_EPSILON } from '../geometry.ts'
import type { PropertyRow, RejectCode } from '../types.ts'
import {
  REJECT_MESSAGES,
  animatable,
  controlKindOf,
  parseTextInput,
  rangeHint,
  resolveTarget,
  seedForNewNode,
  unitSuffix,
  validateValue,
} from '../valueControls.ts'
import type { CommitTarget } from '../types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { commitPrefixFor } from '../customFields.ts'
import StructTreeEditor from './StructTreeEditor.vue'
import AnimationControls from './AnimationControls.vue'
import type { InspectorValueOptions } from './inspectorValueOptions.ts'
import type { AddKeyframePayload, SetValuePayload } from './effectRowEvents.ts'

const props = defineProps<{
  row: PropertyRow
  panel: 'properties' | 'effects'
  playhead: number
  /**
   * 片段时长上下文：采样必须先按范围过滤关键帧（`object-model.md` §3.4 第 1 步），
   * 否则轴外帧会污染轴内采样。省略时不过滤（内部场景）。
   */
  timing?: { duration: number; infinite: boolean }
  /** 该行是否已有关键帧；缺省按 `row.keyframes.length > 0` 推导。 */
  rowHasKeyframes?: boolean
  disabled?: boolean
  /** 引用类型的候选（schema 未提供候选时缺省，此时允许自由文本并标注"未约束形态"）。 */
  refCandidates?: readonly string[]
  /**
   * 紧凑模式：外层行高固定（效果面板行 26px）。
   *
   * 提示与错误改成绝对定位在控件下方（不参与布局），既满足"错误显示在控件下方"，
   * 又不把固定行高撑开、不打乱关键帧组的纵向对齐。
   */
  compact?: boolean
  /** 片段对象（09 提交前缀用；省略时按 `DOCUMENT_SERVICE.clipObjects` 取）。 */
  objects?: JsonObject
  /**
   * 右侧 Inspector 显式 opt-in：分段枚举、实用滑杆、引用形态、长文本、复位与帧间只读。
   * 不传时共享面板（效果面板 / 专用编辑器）行为不变。
   */
  inspector?: InspectorValueOptions
}>()

const emit = defineEmits<{
  commit: [payload: SetValuePayload]
  'add-keyframe': [payload: AddKeyframePayload]
  /** 点菱形建帧（父组件走 `object.addKeyframe`，初值由 `seedForNewNode` 回退链取）。 */
  'toggle-keyframe': [payload: { clipKey: string; path: string; time: number; create: boolean }]
  /** 点时钟开关动画（父组件走 enableAnimation / disableAnimation）。 */
  'toggle-animation': [payload: { clipKey: string; path: string; time: number; enable: boolean }]
  /** 跳转到该属性的上/下一个关键帧。 */
  'jump-keyframe': [payload: { clipKey: string; path: string; time: number }]
}>()

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)

/**
 * 09 提交前缀：例如首次改 fade 字段前补写显式 `layer_type: "fade"`。
 * 前缀为空时保持 06 的 `commit(..., coalesceKey)` 行为；非空时用 `commitBatch` 组成一次撤销。
 */
const ensureCommands = computed<DocCommand[]>(() => {
  const trackType = props.row.def?.scope[0]
  if (trackType === undefined) {
    return []
  }
  const objects = props.objects ?? documentService?.clipObjects(props.row.clipKey) ?? {}
  return commitPrefixFor(trackType, props.row.path, props.row.clipKey, objects)
})

const kind = computed(() => controlKindOf(props.row))
const hasKeyframes = computed(() => props.rowHasKeyframes ?? props.row.keyframes.length > 0)
const frameAtPlayhead = computed(() =>
  props.row.keyframes.find((frame) => Math.abs(frame.time - props.playhead) <= PLAYHEAD_EPSILON))
const playheadHitsNode = computed(() => frameAtPlayhead.value !== undefined)
/** 右栏显式 opt-in：只在传入选项时改变排版 / 采样行为。 */
const inspectorMode = computed(() => props.inspector !== undefined)
/** 有帧但播放头在两帧之间：只显示采样值，先加帧才能编辑。 */
const inspectorSampling = computed(() =>
  inspectorMode.value && hasKeyframes.value && !playheadHitsNode.value)
const inspectorLocked = computed(() => inspectorSampling.value)

/** 该行是否支持关键帧（`mode=value` / `struct` / 未知路径都不支持）。 */
const animatableRow = computed(() => animatable(props.row.def) && !props.row.unknown)

/** 右栏把帧按钮放在行上，共享表单里的旧动画控件在 Inspector 模式一律不显示。 */
const showAnimationControls = computed(() =>
  !inspectorMode.value
  && kind.value !== 'event'
  && kind.value !== 'readonly'
  && kind.value !== 'struct')

/** 该属性的上/下一个关键帧（升序数组里找最近的）。 */
const hasPrevKeyframe = computed(() =>
  props.row.keyframes.some((frame) => frame.time < props.playhead - PLAYHEAD_EPSILON))
const hasNextKeyframe = computed(() =>
  props.row.keyframes.some((frame) => frame.time > props.playhead + PLAYHEAD_EPSILON))

function onToggleKeyframe(create: boolean): void {
  emit('toggle-keyframe', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: props.playhead,
    create,
  })
}

function onToggleAnimation(enable: boolean): void {
  emit('toggle-animation', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: props.playhead,
    enable,
  })
}

/** 跳到相邻关键帧：取严格小于/大于播放头里最近的那个。 */
function jumpToPrev(): void {
  const candidates = props.row.keyframes
    .map((frame) => frame.time)
    .filter((time) => time < props.playhead - PLAYHEAD_EPSILON)
  if (candidates.length === 0) {
    return
  }
  emit('jump-keyframe', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: Math.max(...candidates),
  })
}

function jumpToNext(): void {
  const candidates = props.row.keyframes
    .map((frame) => frame.time)
    .filter((time) => time > props.playhead + PLAYHEAD_EPSILON)
  if (candidates.length === 0) {
    return
  }
  emit('jump-keyframe', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: Math.min(...candidates),
  })
}

/** 读播放头所在段的作者态缓动（没有就是 `undefined`，采样按目录 `interp`）。 */
function easingAt(time: number): { mode: 'linear' | 'bezier'; out: { x: number; y: number }; in: { x: number; y: number }; revision: number; clipKey: string; path: string; fromTime: number; toTime: number } | undefined {
  const frames = props.row.keyframes
  const index = segmentIndexAt(frames, time)
  if (index < 0 || index >= frames.length - 1) {
    return undefined
  }
  const fromTime = frames[index].time
  const toTime = frames[index + 1].time
  const table = readEasingTable(ctx.commands.clipAuthoringOf(props.row.clipKey))
  const entry = table[easingKey(props.row.path, fromTime, toTime)]
  if (entry === undefined) {
    return undefined
  }
  return {
    mode: entry.mode,
    out: entry.out,
    in: entry.in,
    revision: entry.revision,
    clipKey: props.row.clipKey,
    path: props.row.path,
    fromTime,
    toTime,
  }
}

/** 播放头处的采样值（效果面板的"当前值"唯一来源）。 */
const sampled = computed<{ ok: boolean; value?: unknown }>(() => {
  if (props.row.keyframes.length === 0) {
    return { ok: false }
  }
  const easing = easingAt(props.playhead)
  return sampleValue({
    frames: props.row.keyframes,
    interp: props.row.interp,
    time: props.playhead,
    ...(props.timing === undefined ? {} : { timing: props.timing }),
    ...(easing === undefined ? {} : { easing }),
  })
})

/** 控件显示的值：命中节点 → 节点值；否则采样值；再否则静态值 / 默认值。 */
const displayValue = computed<unknown>(() => {
  if (playheadHitsNode.value) {
    const frame = frameAtPlayhead.value
    if (frame !== undefined) {
      return frame.value
    }
  }
  if ((props.panel === 'effects' || inspectorMode.value) && sampled.value.ok) {
    return sampled.value.value
  }
  if (props.row.hasValue) {
    return props.row.value
  }
  if (props.row.hasDefault) {
    return props.row.defaultValue
  }
  return undefined
})

/** 值是否为空（可空数字的"不设值"状态）。 */
const isNullValue = computed(() => displayValue.value === null)

function textOf(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  if (value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const draft = ref('')
const dirty = ref(false)
const error = ref('')
const errorCode = ref<RejectCode | null>(null)
const applied = ref('')

/** 同步草稿：不在作者编辑中时跟随文档。 */
function syncDraft(): void {
  if (dirty.value) {
    return
  }
  if (kind.value === 'nullable-number' && isNullValue.value) {
    draft.value = ''
    return
  }
  draft.value = textOf(displayValue.value)
}

watch(
  () => [props.row.clipKey, props.row.path, props.playhead, props.row.keyframes.length, props.row.hasValue,
    props.row.value, props.row.defaultValue, displayValue.value],
  () => {
    syncDraft()
  },
  { immediate: true },
)

/** 换片段 / 路径后丢弃上一片段的草稿与守卫挂起状态，直接跟随新文档。 */
watch(
  () => [props.row.clipKey, props.row.path],
  () => {
    dirty.value = false
    applied.value = ''
    clearError()
    syncDraft()
  },
)


/** 结构值的原文草稿：只有显式"应用"才提交。 */
const rawOpen = ref(false)
const rawDraft = ref('')
const rawError = ref('')

function openRaw(): void {
  rawDraft.value = textOf(displayValue.value)
  rawError.value = ''
  rawOpen.value = true
}

function closeRaw(): void {
  rawOpen.value = false
  rawError.value = ''
}

function applyRaw(): void {
  const parsed = parseTextInput('struct', rawDraft.value)
  if (!parsed.ok) {
    rawError.value = `${REJECT_MESSAGES[parsed.code ?? 'struct_invalid_json']}：${parsed.message ?? ''}`
    return
  }
  rawError.value = ''
  submitValue(parsed.value as JsonValue)
}

/** 结构树编辑：每次叶子变化提交整棵新值。 */
function onTreeChange(next: JsonValue): void {
  submitValue(next)
}

const suffix = computed(() => unitSuffix(props.row))
const hint = computed(() => rangeHint(props.row))
const canEdit = computed(() =>
  !props.disabled && kind.value !== 'readonly' && kind.value !== 'event' && !inspectorLocked.value)

/** 待新增节点的目标：效果面板播放头没有节点。 */
const pendingNewNode = computed(() => {
  if (props.panel !== 'effects' || !hasKeyframes.value) {
    return false
  }
  return !playheadHitsNode.value
})

const target = computed<{ ok: boolean; target?: CommitTarget; code?: RejectCode; message?: string }>(() => {
  // 右栏：有帧时只允许写已存在的节点，并取规范帧时间（不新建、不改时间）。
  if (inspectorMode.value && hasKeyframes.value) {
    if (!playheadHitsNode.value) {
      return {
        ok: false,
        code: 'mode_not_animatable',
        message: '帧间为采样值：先在当前时间添加关键帧再编辑',
      }
    }
    const frame = frameAtPlayhead.value
    if (frame === undefined) {
      return { ok: false, code: 'not_found', message: '找不到播放头处的关键帧' }
    }
    return {
      ok: true,
      target: { kind: 'node', clipKey: props.row.clipKey, path: props.row.path, time: frame.time },
    }
  }
  return resolveTarget({
    panel: props.panel,
    row: props.row,
    rowHasKeyframes: hasKeyframes.value,
    playhead: props.playhead,
    playheadHitsNode: playheadHitsNode.value,
  })
})

function setError(code: RejectCode, message: string): void {
  errorCode.value = code
  error.value = `${REJECT_MESSAGES[code]}：${message}`
}

function clearError(): void {
  errorCode.value = null
  error.value = ''
}

function emitCommit(ok: boolean, extra: { code?: RejectCode; message?: string; value?: JsonValue } = {}): void {
  emit('commit', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: props.playhead,
    ok,
    ...extra,
  })
}

/** 把一次合法值写入对应目标；`new-node` 不写文档，只提示加帧。返回是否已写入文档。 */
function submitValue(value: JsonValue): boolean {
  const resolved = target.value
  if (!resolved.ok || resolved.target === undefined) {
    const code = resolved.code ?? 'readonly_unknown'
    setError(code, resolved.message ?? '该值不能在此处提交')
    emitCommit(false, { code, message: resolved.message ?? '' })
    return false
  }
  const checked = validateValue(props.row, value)
  if (!checked.ok) {
    const code = checked.code ?? 'type_mismatch'
    setError(code, checked.message ?? '值不合法')
    emitCommit(false, { code, message: checked.message ?? '' })
    return false
  }
  const normalized = checked.value as JsonValue
  const targetValue = resolved.target
  if (targetValue.kind === 'new-node') {
    // 效果面板播放头没有节点：只留草稿，不写文档。
    clearError()
    applied.value = '草稿已就绪：点"添加帧"在播放头建帧。'
    return false
  }
  const write: DocCommand = targetValue.kind === 'static'
    ? { kind: 'object.setValue', clipKey: targetValue.clipKey, path: targetValue.path, value: normalized }
    : { kind: 'object.setKeyframeValue', clipKey: targetValue.clipKey, path: targetValue.path, time: targetValue.time, value: normalized }
  const coalesceKey = targetValue.kind === 'static'
    ? `setStatic:${targetValue.clipKey}:${targetValue.path}`
    : `setValue:${targetValue.clipKey}:${targetValue.path}:${targetValue.time}`
  const prefix = ensureCommands.value
  const commands = [...prefix, write]
  const inspectorCommit = props.inspector?.commit
  const outcome = inspectorMode.value && inspectorCommit !== undefined
    ? inspectorCommit(commands, coalesceKey)
    : prefix.length > 0
      ? ctx.commands.commitBatch(commands, coalesceKey)
      : ctx.commands.commit(write, coalesceKey)
  if (outcome.ok) {
    clearError()
    applied.value = inspectorMode.value
      ? ''
      : targetValue.kind === 'static' ? '已写入静态值。' : `已写入节点值 t=${targetValue.time}。`
    dirty.value = false
    // 立刻用写入值刷新草稿，避免 props 尚未重算时闪回旧文本。
    if (kind.value === 'nullable-number' && normalized === null) {
      draft.value = ''
    } else if (kind.value !== 'struct' && kind.value !== 'boolean' && kind.value !== 'enum') {
      draft.value = textOf(normalized)
    }
    emitCommit(true, { value: normalized })
    return true
  }
  if ('pending' in outcome) {
    // 守卫只在父面板显示。在确认写入前，控件继续回显当前文档值。
    dirty.value = false
    clearError()
    syncDraft()
    return false
  }
  const code: RejectCode = targetValue.kind === 'static' ? 'type_mismatch' : 'not_found'
  setError(code, outcome.error ?? '写入失败')
  emitCommit(false, { code, message: outcome.error ?? '' })
  return false
}

/** 文本 / 数字输入：回车或失焦提交，Esc 恢复原值。返回是否已真正写入文档。 */
function commitDraft(): boolean {
  if (!canEdit.value) {
    return false
  }
  const parsed = parseTextInput(kind.value, draft.value)
  if (!parsed.ok) {
    const code = parsed.code ?? 'type_mismatch'
    setError(code, parsed.message ?? '')
    emitCommit(false, { code, message: parsed.message ?? '' })
    return false
  }
  return submitValue(parsed.value as JsonValue)
}

function onDraftInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value
  dirty.value = true
}

function onDraftFocus(event: FocusEvent): void {
  ;(event.target as HTMLInputElement).select()
}

function onDraftBlur(): void {
  if (dirty.value) {
    const written = commitDraft()
    ctx.commands.endCoalescing()
    if (written) {
      dirty.value = false
      syncDraft()
    }
    return
  }
  ctx.commands.endCoalescing()
}

function onDraftEnter(): void {
  if (dirty.value) {
    const written = commitDraft()
    ctx.commands.endCoalescing()
    if (written) {
      dirty.value = false
      syncDraft()
    }
    return
  }
  ctx.commands.endCoalescing()
}

function onDraftEscape(event: KeyboardEvent): void {
  dirty.value = false
  syncDraft()
  clearError()
  ;(event.target as HTMLInputElement).blur()
}

/** 数字输入的上下键：连续微调走同一串身份（一次撤销回到起点）。 */
function onNumberStep(delta: number): void {
  if (!canEdit.value) {
    return
  }
  const current = Number(draft.value)
  if (!Number.isFinite(current)) {
    return
  }
  const next = kind.value === 'integer' ? Math.round(current) + delta : current + delta
  const parsed = parseTextInput(kind.value, String(next))
  if (!parsed.ok) {
    return
  }
  draft.value = String(next)
  submitValue(parsed.value as JsonValue)
}

function onBooleanChange(event: Event): void {
  if (!canEdit.value) {
    return
  }
  const input = event.target as HTMLInputElement
  if (!submitValue(input.checked) && inspectorMode.value) {
    input.checked = displayValue.value === true
  }
}

function onEnumChange(event: Event): void {
  if (!canEdit.value) {
    return
  }
  const select = event.target as HTMLSelectElement
  if (!submitValue(select.value) && inspectorMode.value) {
    select.value = typeof displayValue.value === 'string' ? displayValue.value : ''
  }
}

/** 可空数字的"不设值"开关：勾选写 `null`（不是 0）并显示"不锁"；取消勾选可输入具体值。 */
function onNullableToggle(event: Event): void {
  if (!canEdit.value) {
    return
  }
  const unset = (event.target as HTMLInputElement).checked
  if (unset) {
    submitValue(null)
    return
  }
  const current = Number(draft.value)
  if (Number.isFinite(current)) {
    submitValue(current)
    return
  }
  applied.value = '输入一个数字后提交。'
}

/** 加帧：草稿值优先，其次采样值 → 静态值 → 目录默认值。 */
function addKeyframe(): void {
  if (!canEdit.value) {
    return
  }
  let value: JsonValue | undefined
  if (dirty.value) {
    const parsed = parseTextInput(kind.value, draft.value)
    if (!parsed.ok) {
      const code = parsed.code ?? 'type_mismatch'
      setError(code, parsed.message ?? '')
      return
    }
    const checked = validateValue(props.row, parsed.value as JsonValue)
    if (!checked.ok) {
      const code = checked.code ?? 'type_mismatch'
      setError(code, checked.message ?? '值不合法')
      return
    }
    value = checked.value as JsonValue
  } else {
    const seed = seedForNewNode(props.row, sampled.value.ok ? sampled.value.value : undefined, props.playhead)
    if (!seed.ok || seed.value === undefined) {
      const code = seed.code ?? 'default_missing'
      setError(code, seed.message ?? '没有可用的初值')
      return
    }
    value = seed.value
  }
  clearError()
  emit('add-keyframe', {
    clipKey: props.row.clipKey,
    path: props.row.path,
    time: props.playhead,
    value,
  })
  applied.value = `已请求在 t=${props.playhead} 建帧。`
  dirty.value = false
  syncDraft()
}

/** 只读展示：未知路径的原始 JSON。 */
const readonlyPreview = computed(() => {
  if (displayValue.value === undefined) {
    return '（未设置）'
  }
  return textOf(displayValue.value)
})

const enumValues = computed<readonly string[]>(() => props.row.enumValues ?? [])
const enumCurrentOutside = computed(() => {
  const value = displayValue.value
  if (typeof value !== 'string' || enumValues.value.length === 0) {
    return false
  }
  return !enumValues.value.includes(value)
})

const nullableUnset = computed(() => isNullValue.value && kind.value === 'nullable-number')
const boolValue = computed(() => displayValue.value === true)
const refCandidates = computed<readonly string[]>(() => props.refCandidates ?? [])
const refUnconstrained = computed(() => kind.value === 'ref' && refCandidates.value.length === 0)
const structValue = computed<JsonValue>(() => {
  const value = displayValue.value
  if (value === undefined) {
    return {}
  }
  if (isJsonObject(value) || Array.isArray(value) || value === null
    || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value as JsonValue
  }
  return {}
})

// ── Inspector opt-in：枚举操作词、实用滑杆、复位与引用形态 ─────────────

/** 枚举显示文本：Inspector 可提供中文操作词；共享面板仍显示原值。 */
function optionLabel(value: string): string {
  return props.inspector?.labels?.[value] ?? value
}

const segmentedEnum = computed(() =>
  inspectorMode.value && props.inspector?.segmented === true && enumValues.value.length > 0)

const rangeSpec = computed<readonly [number, number, number] | undefined>(() =>
  inspectorMode.value ? props.inspector?.range : undefined)
const sliderMin = computed(() => rangeSpec.value?.[0] ?? 0)
const sliderMax = computed(() => rangeSpec.value?.[1] ?? 0)
const sliderStep = computed(() => rangeSpec.value?.[2] ?? 1)

/** 滑杆位置：按实用区间夹取当前值；精确输入仍以输入框为准。 */
const sliderValue = computed(() => {
  const spec = rangeSpec.value
  if (spec === undefined) {
    return 0
  }
  const current = Number(draft.value)
  if (!Number.isFinite(current)) {
    return spec[0]
  }
  return Math.min(spec[1], Math.max(spec[0], current))
})

function onSliderInput(event: Event): void {
  if (!canEdit.value) {
    return
  }
  const next = (event.target as HTMLInputElement).valueAsNumber
  if (!Number.isFinite(next)) {
    return
  }
  const parsed = parseTextInput(kind.value, String(next))
  if (!parsed.ok) {
    return
  }
  if (submitValue(parsed.value as JsonValue)) {
    draft.value = textOf(parsed.value as JsonValue)
  }
}

function onSliderChange(): void {
  ctx.commands.endCoalescing()
}

function submitEnum(value: string): void {
  if (!canEdit.value) {
    return
  }
  submitValue(value)
}

/** 复位目录默认值：只在静态值或当前帧可编辑时出现（帧间采样不提供）。 */
const canReset = computed(() =>
  inspectorMode.value
  && props.row.hasDefault
  && canEdit.value
  && kind.value !== 'readonly'
  && kind.value !== 'event'
  && kind.value !== 'struct')

function resetDefault(): void {
  if (!canReset.value) {
    return
  }
  submitValue(props.row.defaultValue as JsonValue)
}

const inspectorPlaceholder = computed(() =>
  inspectorMode.value ? props.inspector?.placeholder : undefined)
const inspectorMultiline = computed(() =>
  inspectorMode.value && props.inspector?.multiline === true)

const inspectorReference = computed(() =>
  inspectorMode.value ? props.inspector?.reference : undefined)

/** 引用形态：把当前已存值（含自定义值）归到某个形态。 */
const refForm = computed(() => {
  const reference = inspectorReference.value
  const value = displayValue.value
  if (reference === undefined || typeof value !== 'string') {
    return ''
  }
  return reference.preset(value)
})

const refChoices = computed(() => inspectorReference.value?.choices ?? [])
const refFormKnown = computed(() =>
  refChoices.value.some((choice) => choice.value === refForm.value))
const refPayload = computed(() => inspectorReference.value?.payloads?.[refForm.value])
const refPayloadPlaceholder = computed(() => refPayload.value?.placeholder)
const refPayloadLabel = computed(() => refPayload.value?.label ?? '')

/** 载荷输入：同形态下保留已存值；有前缀时只显示前缀后的部分。 */
const refPayloadValue = computed(() => {
  const payload = refPayload.value
  const value = displayValue.value
  if (payload === undefined || typeof value !== 'string') {
    return ''
  }
  const reference = inspectorReference.value
  if (reference === undefined || reference.preset(value) !== refForm.value) {
    return ''
  }
  const prefix = payload.prefix ?? ''
  return prefix !== '' && value.startsWith(prefix) ? value.slice(prefix.length) : value
})

/** 形态下拉：value 直接交给真实字段校验；失败时恢复原选中项。 */
function onRefFormChange(event: Event): void {
  const select = event.target as HTMLSelectElement
  const next = select.value
  if (!canEdit.value || next === refForm.value) {
    return
  }
  if (!submitValue(next)) {
    select.value = refForm.value
  }
}

/** 载荷输入：拼回真实字段值，并要求仍归在同一形态（保留自定义值）。 */
function onRefPayloadChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const payload = refPayload.value
  const reference = inspectorReference.value
  if (payload === undefined || reference === undefined || !canEdit.value) {
    return
  }
  const composed = (payload.prefix ?? '') + input.value.trim()
  if (composed === '' || reference.preset(composed) !== refForm.value) {
    setError('type_mismatch', `输入需要匹配「${payload.label}」`)
    input.value = refPayloadValue.value
    return
  }
  if (!submitValue(composed)) {
    input.value = refPayloadValue.value
  }
}
</script>

<template>
  <div
    class="value-form"
    :class="{ 'value-form--compact': compact === true, 'value-form--inspector': inspectorMode }"
    :data-kind="kind"
    :data-panel="panel"
  >
    <!-- number / integer / nullable-number：带范围与单位的数字输入 -->
    <template v-if="kind === 'number' || kind === 'integer' || kind === 'nullable-number'">
      <div class="value-form__line value-form__line--number">
        <label v-if="kind === 'nullable-number'" class="value-form__toggle" title="勾选表示不设值（写 null，不是 0）">
          <input
            type="checkbox"
            :checked="nullableUnset"
            :disabled="!canEdit"
            @change="onNullableToggle"
          >
          <span>不设值</span>
        </label>
        <input
          v-if="rangeSpec !== undefined"
          class="value-form__slider"
          type="range"
          :min="sliderMin"
          :max="sliderMax"
          :step="sliderStep"
          :value="sliderValue"
          :disabled="!canEdit || (kind === 'nullable-number' && nullableUnset)"
          :aria-label="`${row.label}滑杆`"
          @input="onSliderInput"
          @change="onSliderChange"
        >
        <input
          class="value-form__input value-form__input--number"
          type="number"
          :value="draft"
          :step="kind === 'integer' ? 1 : 'any'"
          :min="row.min"
          :max="row.max"
          :disabled="!canEdit || (kind === 'nullable-number' && nullableUnset)"
          :aria-label="`${row.label} 数值`"
          @input="onDraftInput"
          @focus="onDraftFocus"
          @blur="onDraftBlur"
          @keydown.enter.prevent="onDraftEnter"
          @keydown.esc.prevent="onDraftEscape"
          @keydown.up.prevent="onNumberStep(1)"
          @keydown.down.prevent="onNumberStep(-1)"
        >
        <span v-if="suffix !== ''" class="value-form__suffix" aria-hidden="true">{{ suffix }}</span>
        <span v-if="kind === 'nullable-number' && nullableUnset" class="value-form__muted">不锁</span>
        <button
          v-if="canReset"
          type="button"
          class="value-form__reset"
          :title="`恢复默认值 ${row.defaultValue}`"
          :aria-label="`恢复${row.label}默认值`"
          @click="resetDefault"
        >↺</button>
        <AnimationControls
          v-if="showAnimationControls"
          :has-keyframes="hasKeyframes"
          :at-keyframe="playheadHitsNode"
          :animatable="animatableRow"
          :playhead="playhead"
          :has-prev="hasPrevKeyframe"
          :has-next="hasNextKeyframe"
          :read-only="row.unknown"
          :compact="compact === true"
          @toggle="onToggleKeyframe"
          @prev="jumpToPrev"
          @next="jumpToNext"
          @toggle-animation="onToggleAnimation"
        />
      </div>
      <p v-if="hint !== null && !inspectorMode" class="value-form__hint">范围 {{ hint }}</p>
    </template>

    <!-- boolean：开关，立即提交 -->
    <template v-else-if="kind === 'boolean'">
      <div class="value-form__line">
        <label class="value-form__toggle">
          <input
            class="value-form__switch"
            type="checkbox"
            :checked="boolValue"
            :disabled="!canEdit"
            role="switch"
            :aria-label="`${row.label} 开关`"
            @change="onBooleanChange"
          >
          <span>{{ boolValue ? '开' : '关' }}</span>
        </label>
        <button
          v-if="canReset"
          type="button"
          class="value-form__reset"
          :title="`恢复默认值 ${row.defaultValue}`"
          :aria-label="`恢复${row.label}默认值`"
          @click="resetDefault"
        >↺</button>
        <AnimationControls
          v-if="showAnimationControls"
          :has-keyframes="hasKeyframes"
          :at-keyframe="playheadHitsNode"
          :animatable="animatableRow"
          :playhead="playhead"
          :has-prev="hasPrevKeyframe"
          :has-next="hasNextKeyframe"
          :read-only="row.unknown"
          :compact="compact === true"
          @toggle="onToggleKeyframe"
          @prev="jumpToPrev"
          @next="jumpToNext"
          @toggle-animation="onToggleAnimation"
        />
      </div>
    </template>

    <!-- text / ref：失焦或回车提交；Inspector 增加引用形态与多行 -->
    <template v-else-if="kind === 'text' || kind === 'ref'">
      <!-- 引用形态：下拉选形态，载荷输入拼回真实字段值 -->
      <template v-if="kind === 'ref' && inspectorReference !== undefined">
        <div class="value-form__line value-form__reference">
          <select
            class="value-form__input"
            :value="refForm"
            :disabled="!canEdit"
            :aria-label="`${row.label}形态`"
            @change="onRefFormChange"
          >
            <option v-if="!refFormKnown" :value="refForm" disabled>
              {{ refForm === '' ? '（现有值）' : refForm }}
            </option>
            <option v-for="choice in refChoices" :key="choice.value" :value="choice.value">
              {{ choice.label }}
            </option>
          </select>
          <button
            v-if="canReset"
            type="button"
            class="value-form__reset"
            :title="`恢复默认值 ${row.defaultValue}`"
            :aria-label="`恢复${row.label}默认值`"
            @click="resetDefault"
          >↺</button>
        </div>
        <div v-if="refPayload !== undefined" class="value-form__line value-form__reference-payload">
          <input
            class="value-form__input"
            type="text"
            :value="refPayloadValue"
            :placeholder="refPayloadPlaceholder"
            :disabled="!canEdit"
            :aria-label="`${row.label} · ${refPayloadLabel}`"
            @change="onRefPayloadChange"
          >
        </div>
      </template>

      <!-- 长文本：回车换行，失焦提交 -->
      <div v-else-if="inspectorMultiline" class="value-form__line">
        <textarea
          class="value-form__input value-form__textarea value-form__textarea--inspector"
          rows="2"
          :value="draft"
          :placeholder="inspectorPlaceholder"
          :disabled="!canEdit"
          :aria-label="`${row.label} 文本`"
          @input="onDraftInput"
          @focus="onDraftFocus"
          @blur="onDraftBlur"
          @keydown.esc.prevent="onDraftEscape"
        />
        <button
          v-if="canReset"
          type="button"
          class="value-form__reset"
          :title="`恢复默认值 ${row.defaultValue}`"
          :aria-label="`恢复${row.label}默认值`"
          @click="resetDefault"
        >↺</button>
      </div>

      <div v-else class="value-form__line">
        <input
          v-if="kind === 'ref' && refCandidates.length > 0"
          class="value-form__input"
          type="text"
          list="value-form-ref-candidates"
          :value="draft"
          :placeholder="inspectorPlaceholder"
          :disabled="!canEdit"
          :aria-label="`${row.label} 引用`"
          @input="onDraftInput"
          @blur="onDraftBlur"
          @keydown.enter.prevent="onDraftEnter"
          @keydown.esc.prevent="onDraftEscape"
        >
        <input
          v-else
          class="value-form__input"
          type="text"
          :value="draft"
          :placeholder="inspectorPlaceholder"
          :disabled="!canEdit"
          :aria-label="`${row.label} 文本`"
          @input="onDraftInput"
          @blur="onDraftBlur"
          @keydown.enter.prevent="onDraftEnter"
          @keydown.esc.prevent="onDraftEscape"
        >
        <datalist v-if="kind === 'ref' && refCandidates.length > 0" id="value-form-ref-candidates">
          <option v-for="item in refCandidates" :key="item" :value="item" />
        </datalist>
        <button
          v-if="canReset"
          type="button"
          class="value-form__reset"
          :title="`恢复默认值 ${row.defaultValue}`"
          :aria-label="`恢复${row.label}默认值`"
          @click="resetDefault"
        >↺</button>
        <AnimationControls
          v-if="showAnimationControls"
          :has-keyframes="hasKeyframes"
          :at-keyframe="playheadHitsNode"
          :animatable="animatableRow"
          :playhead="playhead"
          :has-prev="hasPrevKeyframe"
          :has-next="hasNextKeyframe"
          :read-only="row.unknown"
          :compact="compact === true"
          @toggle="onToggleKeyframe"
          @prev="jumpToPrev"
          @next="jumpToNext"
          @toggle-animation="onToggleAnimation"
        />
      </div>
      <p v-if="refUnconstrained && !inspectorMode" class="value-form__hint">未约束形态：schema 没有给出候选，按自由文本写入。</p>
    </template>

    <!-- enum：只出现 schema 声明的选项；Inspector 可分段并显示操作词 -->
    <template v-else-if="kind === 'enum'">
      <div class="value-form__line">
        <div v-if="segmentedEnum" class="value-form__segmented" role="group" :aria-label="`${row.label}`">
          <button
            v-for="item in enumValues"
            :key="item"
            type="button"
            class="value-form__segment"
            :class="{ 'value-form__segment--on': typeof displayValue === 'string' && displayValue === item }"
            :aria-pressed="typeof displayValue === 'string' && displayValue === item"
            :disabled="!canEdit"
            :data-value="item"
            @click="submitEnum(item)"
          >{{ optionLabel(item) }}</button>
        </div>
        <select
          v-else
          class="value-form__input"
          :value="typeof displayValue === 'string' ? displayValue : ''"
          :disabled="!canEdit"
          :aria-label="`${row.label} 枚举`"
          @change="onEnumChange"
        >
          <option v-if="typeof displayValue !== 'string'" value="" disabled>（未设置）</option>
          <option v-for="item in enumValues" :key="item" :value="item">
            {{ item === '' ? '（空字符串）' : optionLabel(item) }}
          </option>
        </select>
        <button
          v-if="canReset"
          type="button"
          class="value-form__reset"
          :title="`恢复默认值 ${row.defaultValue}`"
          :aria-label="`恢复${row.label}默认值`"
          @click="resetDefault"
        >↺</button>
        <AnimationControls
          v-if="showAnimationControls"
          :has-keyframes="hasKeyframes"
          :at-keyframe="playheadHitsNode"
          :animatable="animatableRow"
          :playhead="playhead"
          :has-prev="hasPrevKeyframe"
          :has-next="hasNextKeyframe"
          :read-only="row.unknown"
          :compact="compact === true"
          @toggle="onToggleKeyframe"
          @prev="jumpToPrev"
          @next="jumpToNext"
          @toggle-animation="onToggleAnimation"
        />
      </div>
      <p v-if="enumCurrentOutside" class="value-form__hint value-form__hint--warn">
        当前值不在枚举内：{{ String(displayValue) }}
      </p>
    </template>

    <!-- struct：树编辑 + 原文编辑两种入口 -->
    <template v-else-if="kind === 'struct'">
      <div class="value-form__struct">
        <StructTreeEditor
          :value="structValue"
          :disabled="!canEdit"
          @change="onTreeChange"
        />
        <div class="value-form__struct-actions">
          <button type="button" class="value-form__button" :disabled="!canEdit" @click="rawOpen ? closeRaw() : openRaw()">
            {{ rawOpen ? '关闭原文' : '原文编辑' }}
          </button>
        </div>
        <div v-if="rawOpen" class="value-form__raw">
          <textarea
            v-model="rawDraft"
            class="value-form__textarea"
            rows="6"
            spellcheck="false"
            aria-label="结构值原文"
          />
          <div class="value-form__raw-actions">
            <button type="button" class="value-form__button" :disabled="!canEdit" @click="applyRaw">应用</button>
            <button type="button" class="value-form__button" @click="closeRaw">取消</button>
            <span v-if="rawError !== ''" class="value-form__error-inline">{{ rawError }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- event：不进入这套控件 -->
    <template v-else-if="kind === 'event'">
      <span class="value-form__muted">事件行走记录编辑器，不在这里改值。</span>
    </template>

    <!-- readonly：未知路径只读展示 -->
    <template v-else>
      <code class="value-form__readonly" :title="readonlyPreview">{{ readonlyPreview }}</code>
    </template>

    <!-- 帧间：显示按目录插值 / 作者态缓动采样出的值，先加帧才能编辑 -->
    <p v-if="inspectorSampling" class="value-form__hint value-form__hint--sampling">
      采样值 · 添加当前帧后可编辑
    </p>

    <!-- 效果面板播放头没有节点：草稿 + 显式加帧 -->
    <div v-if="pendingNewNode && canEdit" class="value-form__add">
      <button type="button" class="value-form__button value-form__button--primary" @click="addKeyframe">
        添加帧
      </button>
      <span class="value-form__muted">播放头 t={{ playhead }} 没有节点</span>
    </div>

    <p v-if="applied !== '' && error === '' && !inspectorMode" class="value-form__hint" role="status">{{ applied }}</p>
    <p v-if="error !== ''" class="value-form__error" role="alert" :data-code="errorCode ?? ''">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.value-form {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 11px;
}

/* Inspector opt-in：只作用于右栏显式传入 options 的实例，共享面板不受影响。 */
.value-form--inspector {
  gap: 3px;
  font-size: 12px;
}

.value-form--inspector .value-form__line {
  gap: 5px;
}

.value-form--inspector .value-form__input {
  min-height: 25px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
}

.value-form--inspector .value-form__input--number {
  max-width: 84px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.value-form--inspector .value-form__suffix {
  font-size: 11px;
}

.value-form--inspector .value-form__slider {
  flex: 1 1 45px;
  min-width: 30px;
  margin: 0;
  accent-color: var(--accent);
}

.value-form--inspector .value-form__slider:disabled {
  opacity: 0.55;
}

/* 布尔开关：右栏用明确的开关形状，不依赖浏览器默认勾选框。 */
.value-form--inspector .value-form__switch {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  width: 30px;
  height: 18px;
  margin: 0;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--bg-panel);
  appearance: none;
  cursor: pointer;
}

.value-form--inspector .value-form__switch::after {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-muted);
  content: '';
  transition: transform 0.12s ease, background 0.12s ease;
}

.value-form--inspector .value-form__switch:checked {
  border-color: var(--accent);
  background: var(--accent);
}

.value-form--inspector .value-form__switch:checked::after {
  background: var(--bg-panel);
  transform: translateX(12px);
}

.value-form--inspector .value-form__switch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 复位：静态值 / 当前帧才出现；帧间采样由 canReset 关闭。 */
.value-form--inspector .value-form__reset {
  flex: 0 0 auto;
  min-width: 20px;
  min-height: 24px;
  padding: 0 3px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.value-form--inspector .value-form__reset:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.value-form--inspector .value-form__reset:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* 分段枚举：每个选项等宽，标签可换行，窄栏不溢出。 */
.value-form--inspector .value-form__segmented {
  display: grid;
  flex: 1 1 auto;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 2px;
  min-width: 0;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-panel);
}

.value-form--inspector .value-form__segment {
  min-width: 0;
  min-height: 25px;
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
  white-space: normal;
  cursor: pointer;
}

.value-form--inspector .value-form__segment:hover:enabled {
  background: var(--bg-hover);
  color: var(--text);
}

.value-form--inspector .value-form__segment:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.value-form--inspector .value-form__segment--on {
  background: var(--bg-selected);
  box-shadow: 0 0 0 1px var(--accent) inset;
  color: var(--text);
  font-weight: 600;
}

.value-form--inspector .value-form__segment:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.value-form--inspector .value-form__textarea--inspector {
  width: 100%;
  min-height: 52px;
  padding: 4px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}

.value-form--inspector .value-form__hint,
.value-form--inspector .value-form__error {
  font-size: 10px;
  line-height: 1.4;
}

.value-form--inspector .value-form__hint--sampling {
  color: var(--text-muted);
}

.value-form--inspector .value-form__readonly {
  font-size: 11px;
}

/* 紧凑模式：固定行高下，提示与错误浮在控件下方，不撑开行、不打乱节点组对齐。 */
.value-form--compact {
  position: relative;
}

.value-form--compact .value-form__hint,
.value-form--compact .value-form__error {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 30;
  max-width: 320px;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--bg-raised);
  box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
  white-space: normal;
}

.value-form--compact .value-form__add {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 30;
  padding: 2px 4px;
  border-radius: 2px;
  background: var(--bg-raised);
  box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
  white-space: nowrap;
}

.value-form__line {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.value-form__input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.value-form__input--number {
  max-width: 96px;
}

.value-form__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.value-form__input:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.value-form__suffix {
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.value-form__toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
}

.value-form__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.value-form__hint--warn {
  color: var(--warning);
}

.value-form__muted {
  color: var(--text-muted);
  font-size: 10px;
}

.value-form__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}

.value-form__error-inline {
  color: var(--error);
  font-size: 10px;
}

.value-form__readonly {
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value-form__struct {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.value-form__struct-actions,
.value-form__raw-actions,
.value-form__add {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.value-form__raw {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.value-form__textarea {
  width: 100%;
  min-width: 0;
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  resize: vertical;
}

.value-form__textarea:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.value-form__button {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.value-form__button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.value-form__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.value-form__button--primary {
  border-color: var(--accent);
  color: var(--text);
}

.value-form__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}
</style>
