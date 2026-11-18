/**
 * 值控件与提交目标（06-03）：两个面板共用的唯一输入规则与目标解析。
 *
 * 分工：
 * - 本模块只把「作者输入」变成「合法值」或「一条可读的拒绝」；
 * - 不决定面板归属，不创建节点，不解释 schema 语义；
 * - 提交由调用方走命令层，失败由命令层回滚。
 *
 * 九种值类型逐一对应一种控件，没有兜底文本框（06-03 §三）。
 */
import { checkValue } from '../../core/doc/value.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { FieldEntry } from '../../core/schema/types.ts'
import type { JsonValue } from '../../core/doc/types.ts'
import type { CommitAttempt, CommitTarget, PropertyRow, RejectCode, ValueControlKind } from './types.ts'

/** 值控件种类：由目录类型决定，未知路径一律只读。 */
export function controlKindOf(row: PropertyRow): ValueControlKind {
  if (row.unknown || row.mode === 'unknown') {
    return 'readonly'
  }
  if (row.mode === 'event') {
    return 'event'
  }
  switch (row.type) {
    case 'int':
      return 'integer'
    case 'float':
      return 'number'
    case 'nullable_float':
      return 'nullable-number'
    case 'bool':
      return 'boolean'
    case 'enum':
      return 'enum'
    case 'ref':
      return 'ref'
    case 'struct':
      return 'struct'
    case 'string':
      return 'text'
    default:
      return 'readonly'
  }
}

/** 失败构造。 */
function reject(code: RejectCode, message: string): CommitAttempt {
  return { ok: false, code, message }
}

/** 把拒绝理由代码映射成稳定的中文文案（06-03 §4.3：文案本地化、代码稳定）。 */
export const REJECT_MESSAGES: Readonly<Record<RejectCode, string>> = {
  type_mismatch: '类型不匹配',
  out_of_range: '超出允许范围',
  not_finite: '需要有限数字',
  int_required: '需要整数',
  enum_invalid: '不在枚举内',
  ref_empty: '引用不能为空',
  struct_invalid_json: 'JSON 语法错误',
  default_missing: '没有可用的初值，请先输入静态值',
  requires_unmet: '前置条件未满足',
  readonly_unknown: '未知路径只读',
  row_in_other_panel: '该属性在另一个面板',
  duplicate_time: '该时间已有关键帧',
  negative_time: '时间不能为负',
  not_found: '找不到该节点',
  event_requires_record: '事件必须至少有一条记录',
  mode_not_animatable: '该属性不支持关键帧',
}

/**
 * 校验并规范化一个待写入值。
 *
 * 未知路径与不可动画类型直接拒绝；目录条目存在时按 02 目录严格检查（不做夹取、不做类型转换）。
 */
export function validateValue(row: PropertyRow, input: JsonValue): CommitAttempt & { value?: JsonValue } {
  if (row.unknown || row.mode === 'unknown') {
    return reject('readonly_unknown', REJECT_MESSAGES.readonly_unknown)
  }
  if (row.unavailableReason !== undefined) {
    return reject('requires_unmet', `${REJECT_MESSAGES.requires_unmet}：${row.unavailableReason}`)
  }
  const def = row.def
  if (def === undefined) {
    return reject('readonly_unknown', REJECT_MESSAGES.readonly_unknown)
  }
  const check = checkValue(def, input, { propertyPath: row.path })
  if (check.ok) {
    return { ok: true, value: check.value }
  }
  if (check.kind === 'type') {
    if (def.type === 'int') {
      return reject('int_required', `${REJECT_MESSAGES.int_required}：${check.message}`)
    }
    if (def.type === 'enum') {
      return reject('type_mismatch', check.message)
    }
    return reject('type_mismatch', check.message)
  }
  if (check.kind === 'enum') {
    return reject('enum_invalid', check.message)
  }
  return reject('out_of_range', check.message)
}

/** 把用户输入的文本按控件种类解析成 JSON 值；解析失败给稳定代码。 */
export function parseTextInput(
  kind: ValueControlKind,
  text: string,
): CommitAttempt & { value?: JsonValue } {
  if (kind === 'nullable-number') {
    if (text.trim() === '') {
      return { ok: true, value: null }
    }
  }
  if (kind === 'number' || kind === 'integer' || kind === 'nullable-number') {
    const trimmed = text.trim()
    if (trimmed === '') {
      return reject('not_finite', '需要一个数字')
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      return reject('not_finite', `需要有限数字，实际: ${trimmed}`)
    }
    if (kind === 'integer' && !Number.isInteger(parsed)) {
      return reject('int_required', `需要整数，实际: ${trimmed}`)
    }
    return { ok: true, value: parsed }
  }
  if (kind === 'struct') {
    try {
      return { ok: true, value: JSON.parse(text) as JsonValue }
    } catch (error) {
      return reject('struct_invalid_json', error instanceof Error ? error.message : 'JSON 语法错误')
    }
  }
  if (kind === 'ref') {
    if (text.length === 0) {
      return reject('ref_empty', REJECT_MESSAGES.ref_empty)
    }
    return { ok: true, value: text }
  }
  return { ok: true, value: text }
}

/** 提交目标解析的输入。 */
export interface TargetInput {
  /** 面板：属性面板 / 效果面板。 */
  panel: 'properties' | 'effects'
  row: PropertyRow
  /** 该行是否已有关键帧（`leaf` 策略下决定它归哪一侧）。 */
  rowHasKeyframes: boolean
  /** 播放头局部时间。 */
  playhead: number
  /** 播放头是否精确命中该行的一个节点。 */
  playheadHitsNode: boolean
}

/**
 * 解析提交目标（06-03 §三）：只有三种结果——静态值 / 已存在节点 / 待新增节点。
 *
 * 规则由"哪个面板、行处于什么状态、播放头有没有节点"三件事决定，控件不自己判断。
 */
export function resolveTarget(input: TargetInput): CommitAttempt & { target?: CommitTarget } {
  const { panel, row, rowHasKeyframes, playhead, playheadHitsNode } = input
  if (row.unknown || row.mode === 'unknown') {
    return reject('readonly_unknown', REJECT_MESSAGES.readonly_unknown)
  }
  if (row.mode === 'event') {
    // 事件行走记录编辑器，不进入这套值控件。
    return reject('mode_not_animatable', '事件行由记录编辑器处理')
  }

  if (panel === 'properties') {
    if (rowHasKeyframes) {
      // 已在效果面板的属性不在属性面板显示值控件，只给定位入口。
      return reject('row_in_other_panel', REJECT_MESSAGES.row_in_other_panel)
    }
    return { ok: true, target: { kind: 'static', clipKey: row.clipKey, path: row.path } }
  }

  // 效果面板：只处理有帧的行；播放头命中节点就改节点，否则只留草稿等显式加帧。
  if (!rowHasKeyframes) {
    return reject('row_in_other_panel', '该属性没有关键帧，不属于效果面板')
  }
  if (row.mode !== 'animated') {
    return reject('mode_not_animatable', REJECT_MESSAGES.mode_not_animatable)
  }
  if (playheadHitsNode) {
    return {
      ok: true,
      target: { kind: 'node', clipKey: row.clipKey, path: row.path, time: playhead },
    }
  }
  return {
    ok: true,
    target: { kind: 'new-node', clipKey: row.clipKey, path: row.path, time: playhead },
  }
}

/** 加帧的初值回退链（06-05 §三）：显式值 → 采样值 → 静态值 → 目录默认值。 */
export function seedForNewNode(row: PropertyRow, sampled: unknown, playhead: number): {
  ok: boolean
  value?: JsonValue
  code?: RejectCode
  message?: string
} {
  if (isJsonValue(sampled)) {
    return { ok: true, value: sampled }
  }
  if (row.hasValue) {
    return { ok: true, value: row.value as JsonValue }
  }
  if (row.hasDefault) {
    return { ok: true, value: row.defaultValue as JsonValue }
  }
  return {
    ok: false,
    code: 'default_missing',
    message: `${REJECT_MESSAGES.default_missing}（t=${playhead}）`,
  }
}

/** 采样结果是否可作为 JSON 值写入。 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }
  if (isJsonObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item))
  }
  return false
}

/**
 * 参考系切换检查（06-03 §三）：`position_space` 等在非零时刻切换时三轴必须都有同刻帧。
 *
 * 返回缺失的轴；空数组表示不需要补齐。
 */
export function missingPositionAxes(input: {
  path: string
  time: number
  rows: readonly PropertyRow[]
  /** 该字段是否只在基础系下检查。 */
  baseOnly: boolean
  /** 当前参考系（`base` / 其它）。 */
  space: string
}): string[] {
  const { path, time, rows, baseOnly, space } = input
  const switchFields = [
    'position_mode',
    'position_space',
    'position_origin',
    'position_origin_freeze',
    'facing_source',
  ]
  const baseFields = [
    'facing_target',
    'facing_target_freeze',
    'facing_entity',
    'look_at_freeze',
    'yaw_base_from_freeze',
    'yaw_base_to_freeze',
  ]
  const isSwitch = switchFields.includes(path) || baseFields.includes(path)
  if (!isSwitch || !(time > 0)) {
    return []
  }
  if (baseFields.includes(path) && (baseOnly ? space !== 'base' : false)) {
    return []
  }
  const axes = ['position.x', 'position.y', 'position.z']
  return axes.filter((axis) => {
    const row = rows.find((item) => item.path === axis)
    if (row === undefined) {
      return true
    }
    return !row.keyframes.some((frame) => Math.abs(frame.time - time) <= 1e-4)
  })
}

/** 目录条目是否允许关键帧（`mode=value` / `struct` 拒绝）。 */
export function animatable(def: FieldEntry | undefined): boolean {
  if (def === undefined) {
    return false
  }
  if (def.mode === 'value') {
    return false
  }
  return def.type !== 'struct'
}

/** 数值输入的边界文案（控件下方提示用）。 */
export function rangeHint(row: PropertyRow): string | null {
  if (row.min === undefined && row.max === undefined) {
    return null
  }
  const lower = row.min === undefined ? '−∞' : String(row.min)
  const upper = row.max === undefined ? '+∞' : String(row.max)
  const unit = row.unit === undefined ? '' : ` ${row.unit}`
  return `${lower} … ${upper}${unit}`
}

/** 角度单位标记（显示度符号但不改写数值）。 */
export function unitSuffix(row: PropertyRow): string {
  return row.unit === 'degree' ? '°' : ''
}

/** 有限数字守卫（面板输入直接调用的窄口）。 */
export function isNumberInput(value: unknown): value is number {
  return isFiniteNumber(value)
}
