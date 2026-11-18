/**
 * 事件记录的纯函数层（06-07）：记录体字段表、校验、以及"意图 → 命令"的翻译。
 *
 * 源码事实（`EventRecord.java`）：一条记录只有 `time` + 记录体，**没有终点字段**，
 * 因此所有事件都是瞬时事件；本模块不发明 `end`，也不提供区间事件的任何入口。
 *
 * 记录体字段集合来自运行时 `ObjectCodec`：
 * - `event`：`command` / `event_type` / `id`（字符串）、`position`（恰好 `{x,z}` 或 `{dx,dz}`）；
 * - `mod_event`：`event_type`（字符串）、`data`（对象，递归 JSON）。
 *
 * 分工：本模块只把意图翻译成 `DocCommand`，不 commit、不读文档、不持会话状态。
 * 校验优先走 `checkValue`（与运行时 `ObjectCodec` 同口径）；目录条目缺失时按路径末段做同样的结构检查。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { lastSegment } from '../../core/doc/path.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { checkValue } from '../../core/doc/value.ts'
import type { PropertyRow } from './types.ts'

/** 记录体字段的输入形态。 */
export type EventFieldKind = 'text' | 'position' | 'json'

/** 一个记录体字段（按源码成员顺序）。 */
export interface EventFieldDef {
  key: string
  /** 显示标签（记录体键名就是源码成员名，不翻译）。 */
  label: string
  kind: EventFieldKind
  /** 必填：`mod_event.event_type` 由运行时回退链补齐，缺失时视为不完整。 */
  required: boolean
  hint?: string
}

/** 事件定义视图：瞬时事件 + 字段表；`known=false` 表示路径末段不认识（只读）。 */
export interface EventDefinition {
  kind: 'instant'
  /** 事件种类名（`event` / `mod_event` / 未知路径的末段）。 */
  name: string
  /** 是否是可编辑的已知事件路径。 */
  known: boolean
  fields: EventFieldDef[]
}

/** EVENT 记录体成员（`ObjectCodec.readEvent`）。 */
const EVENT_FIELDS: readonly EventFieldDef[] = [
  { key: 'command', label: 'command', kind: 'text', required: false, hint: '空串 = 占位，标记已触发但不执行' },
  { key: 'event_type', label: 'event_type', kind: 'text', required: false, hint: 'EVENT 只接受 command' },
  { key: 'id', label: 'id', kind: 'text', required: false },
  {
    key: 'position',
    label: 'position',
    kind: 'position',
    required: false,
    hint: '恰好 {x,z}（绝对）或 {dx,dz}（相对）',
  },
]

/** MOD_EVENT 记录体成员（`ObjectCodec.readModEvent`）。 */
const MOD_EVENT_FIELDS: readonly EventFieldDef[] = [
  {
    key: 'event_type',
    label: 'event_type',
    kind: 'text',
    required: true,
    hint: '必填；缺省时运行时取片段 objects.event_type',
  },
  {
    key: 'data',
    label: 'data',
    kind: 'json',
    required: false,
    hint: '对象；可嵌套 JSON（null / 数组 / 对象 / 布尔 / 有限数 / 字符串）',
  },
]

/** 已知字段键集合。 */
export function knownFieldKeys(definition: EventDefinition): string[] {
  return definition.fields.map((field) => field.key)
}

/**
 * 读事件定义：由属性路径末段决定记录体形状（`ObjectCodec.readEventRecord`）。
 *
 * 末段不是 `event` / `mod_event` → 未知定义：无字段、只读，调用方不得写记录体。
 */
export function eventDefinition(row: PropertyRow): EventDefinition {
  const suffix = lastSegment(row.path)
  if (suffix === 'event') {
    return { kind: 'instant', name: 'event', known: true, fields: [...EVENT_FIELDS] }
  }
  if (suffix === 'mod_event') {
    return { kind: 'instant', name: 'mod_event', known: true, fields: [...MOD_EVENT_FIELDS] }
  }
  return { kind: 'instant', name: suffix.length === 0 ? row.path : suffix, known: false, fields: [] }
}

/** 未知键列表（按记录体键序）：只读展示，不提供删除按钮。 */
export function unknownFields(body: unknown, knownKeys: readonly string[]): string[] {
  if (!isJsonObject(body)) {
    return []
  }
  const known = new Set(knownKeys)
  return Object.keys(body).filter((key) => !known.has(key))
}

/** 从一行里按时间取记录体（找不到返回 `null`，不编造空对象）。 */
export function readRecordBody(row: PropertyRow, time: number): JsonObject | null {
  for (const frame of row.keyframes) {
    if (Math.abs(frame.time - time) <= 1e-6) {
      return isJsonObject(frame.value) ? frame.value : null
    }
  }
  return null
}

/** 记录体校验结果。 */
export type RecordCheck = { ok: true; value: JsonObject } | { ok: false; message: string }

/**
 * 校验记录体。
 *
 * 目录条目存在且是 `event_record` → 直接走 `checkValue`（唯一权威口径，与运行时一致）；
 * 目录条目缺失（未知路径）→ 按路径末段的源码成员做同样的结构检查。
 */
export function validateRecordBody(row: PropertyRow, definition: EventDefinition, body: JsonValue): RecordCheck {
  if (!isJsonObject(body)) {
    return { ok: false, message: '记录体必须是对象' }
  }
  if (!definition.known) {
    return { ok: false, message: '未知事件路径（需要以 event / mod_event 结尾）' }
  }
  const def = row.def
  if (def !== undefined && def.type === 'event_record') {
    const check = checkValue(def, body, { propertyPath: row.path })
    return check.ok ? { ok: true, value: body } : { ok: false, message: check.message }
  }
  return structuralCheck(definition, body)
}

/** 目录缺失时的结构检查：成员白名单 + 逐字段类型，不做任何隐式转换。 */
function structuralCheck(definition: EventDefinition, body: JsonObject): RecordCheck {
  const known = new Set(knownFieldKeys(definition))
  for (const key of Object.keys(body)) {
    if (!known.has(key)) {
      return { ok: false, message: `未知成员 ${key}（记录体只接受 schema 声明的字段）` }
    }
  }
  for (const field of definition.fields) {
    const present = Object.prototype.hasOwnProperty.call(body, field.key)
    if (!present) {
      if (field.required) {
        return { ok: false, message: `${field.label} 必填` }
      }
      continue
    }
    const failure = checkField(field, body[field.key])
    if (failure !== undefined) {
      return { ok: false, message: failure }
    }
  }
  return { ok: true, value: body }
}

/** 单字段检查：只接受对应类型，绝不把数字转字符串或布尔转零一。 */
function checkField(field: EventFieldDef, value: JsonValue): string | undefined {
  if (field.kind === 'text') {
    return typeof value === 'string' ? undefined : `${field.label}: 需要字符串`
  }
  if (field.kind === 'json') {
    if (!isJsonObject(value)) {
      return `${field.label}: 需要对象`
    }
    return checkJsonTree(value, field.label)
  }
  return checkPosition(value, field.label)
}

/** `data` 的递归形状（`ObjectCodec.readData`）。 */
function checkJsonTree(value: JsonValue, path: string): string | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return undefined
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isFinite(Math.fround(value))
      ? undefined
      : `${path}: 需要 32 位可表示有限数`
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = checkJsonTree(value[index], `${path}[${index}]`)
      if (failure !== undefined) {
        return failure
      }
    }
    return undefined
  }
  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const failure = checkJsonTree(item, `${path}.${key}`)
      if (failure !== undefined) {
        return failure
      }
    }
    return undefined
  }
  return `${path}: 不支持的值`
}

/** `position`：恰好 `{x,z}` 或 `{dx,dz}`，两个成员都是有限数。 */
function checkPosition(value: JsonValue, path: string): string | undefined {
  if (!isJsonObject(value)) {
    return `${path}: 需要对象 {x,z} 或 {dx,dz}`
  }
  const keys = Object.keys(value)
  const coordinates = Object.prototype.hasOwnProperty.call(value, 'x')
    && Object.prototype.hasOwnProperty.call(value, 'z')
  const deltas = Object.prototype.hasOwnProperty.call(value, 'dx')
    && Object.prototype.hasOwnProperty.call(value, 'dz')
  if (keys.length !== 2 || coordinates === deltas) {
    return `${path}: 需要对象 {x,z} 或 {dx,dz}`
  }
  for (const key of keys) {
    const item = value[key]
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      return `${path}.${key}: 需要有限数字`
    }
  }
  return undefined
}

/** 一次记录编辑的结果：成功带命令，失败带可读原因（UI 内联显示，不假装成功）。 */
export type RecordEdit = { ok: true; command: DocCommand } | { ok: false; message: string }

/** 时间是否可作为记录时间写入（有限、非负）。 */
export function isWritableRecordTime(time: number): boolean {
  return Number.isFinite(time) && time >= 0
}

/** 同刻冲突检查：同一行同一时刻最多一条记录。 */
function conflicts(row: PropertyRow, time: number, ignore?: number): boolean {
  return row.keyframes.some(
    (frame) => Math.abs(frame.time - time) <= 1e-6
      && (ignore === undefined || Math.abs(frame.time - ignore) > 1e-6),
  )
}

/** 事件行可写检查（未知路径、非事件行、未知事件定义都拒绝）。 */
function eventRowGuard(row: PropertyRow): RecordEdit | null {
  if (row.unknown || row.mode === 'unknown') {
    return { ok: false, message: '未知路径只读，不能编辑记录' }
  }
  if (row.mode !== 'event') {
    return { ok: false, message: `${row.path} 不是事件叶子` }
  }
  return null
}

/** 新增记录：`object.addKeyframe`（记录体先校验，形状不符直接拒绝）。 */
export function addRecordCommand(input: {
  clipKey: string
  row: PropertyRow
  time: number
  body: JsonValue
}): RecordEdit {
  const { clipKey, row, time, body } = input
  const guard = eventRowGuard(row)
  if (guard !== null) {
    return guard
  }
  if (!isWritableRecordTime(time)) {
    return { ok: false, message: '记录时间必须是非负有限数字' }
  }
  if (conflicts(row, time)) {
    return { ok: false, message: `该时间已有一条记录（t=${time}）` }
  }
  const definition = eventDefinition(row)
  const check = validateRecordBody(row, definition, body)
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  return {
    ok: true,
    command: { kind: 'object.addKeyframe', clipKey, path: row.path, time, value: check.value },
  }
}

/** 一条字段编辑：写入一个值，或移除该字段（只允许已知字段）。 */
export type RecordFieldEdit = { key: string; value: JsonValue } | { key: string; remove: true }

/**
 * 改记录体：把字段编辑合并到当前记录体（未知键原样保留），再 `object.setKeyframeValue`。
 *
 * `current` 由调用方从行里读（`readRecordBody`）；本函数不读文档。
 * 合并结果必须整份通过校验：任一字段类型不符就整次拒绝，绝不写半份。
 */
export function setRecordFieldCommand(input: {
  clipKey: string
  row: PropertyRow
  time: number
  current: JsonObject
  edits: readonly RecordFieldEdit[]
}): RecordEdit {
  const { clipKey, row, time, current, edits } = input
  const guard = eventRowGuard(row)
  if (guard !== null) {
    return guard
  }
  if (!row.keyframes.some((frame) => Math.abs(frame.time - time) <= 1e-6)) {
    return { ok: false, message: `记录不存在（t=${time}）` }
  }
  const definition = eventDefinition(row)
  if (!definition.known) {
    return { ok: false, message: '未知事件路径只读，不能改记录字段' }
  }
  if (edits.length === 0) {
    return { ok: false, message: '没有字段改动' }
  }
  const known = new Set(knownFieldKeys(definition))
  const merged: JsonObject = { ...current }
  for (const edit of edits) {
    if (!known.has(edit.key)) {
      return { ok: false, message: `未知成员 ${edit.key}（不能写入未声明字段）` }
    }
    if ('remove' in edit) {
      delete merged[edit.key]
      continue
    }
    merged[edit.key] = edit.value
  }
  const check = validateRecordBody(row, definition, merged)
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  return {
    ok: true,
    command: { kind: 'object.setKeyframeValue', clipKey, path: row.path, time, value: check.value },
  }
}

/**
 * 删除记录：`object.removeKeyframe`。
 *
 * 删最后一条**交给命令层拒绝**（`mode=event` 必须有 keyframes），UI 显示命令层的原因，
 * 因此这里不预判、也不假装成功。
 */
export function removeRecordCommand(input: {
  clipKey: string
  row: PropertyRow
  time: number
}): RecordEdit {
  const { clipKey, row, time } = input
  const guard = eventRowGuard(row)
  if (guard !== null) {
    return guard
  }
  if (!row.keyframes.some((frame) => Math.abs(frame.time - time) <= 1e-6)) {
    return { ok: false, message: `记录不存在（t=${time}）` }
  }
  return { ok: true, command: { kind: 'object.removeKeyframe', clipKey, path: row.path, time } }
}

/** 改记录时间：`object.moveKeyframe`；同刻冲突在提交前拒绝，不覆盖已有记录。 */
export function moveRecordCommand(input: {
  clipKey: string
  row: PropertyRow
  from: number
  to: number
}): RecordEdit {
  const { clipKey, row, from, to } = input
  const guard = eventRowGuard(row)
  if (guard !== null) {
    return guard
  }
  if (!row.keyframes.some((frame) => Math.abs(frame.time - from) <= 1e-6)) {
    return { ok: false, message: `记录不存在（t=${from}）` }
  }
  if (!isWritableRecordTime(to)) {
    return { ok: false, message: '记录时间必须是非负有限数字' }
  }
  if (Math.abs(to - from) <= 1e-6) {
    return { ok: false, message: '时间未变化' }
  }
  if (conflicts(row, to, from)) {
    return { ok: false, message: `该时间已有一条记录（t=${to}），同刻冲突被拒绝` }
  }
  return { ok: true, command: { kind: 'object.moveKeyframe', clipKey, path: row.path, from, to } }
}

/** 复制记录时的相对偏移（秒）：避免同刻冲突。 */
export const RECORD_COPY_OFFSET = 0.1

/**
 * 复制记录：在新时间插入同一记录体。
 *
 * 偏移从 `+0.1s` 开始，同刻已占用则继续向后推（步长同为 0.1s）；
 * 找不到空位时返回失败原因，而不是覆盖已有记录。
 */
export function duplicateRecordCommand(input: {
  clipKey: string
  row: PropertyRow
  from: number
  body: JsonObject
}): RecordEdit {
  const { clipKey, row, from, body } = input
  const guard = eventRowGuard(row)
  if (guard !== null) {
    return guard
  }
  if (!row.keyframes.some((frame) => Math.abs(frame.time - from) <= 1e-6)) {
    return { ok: false, message: `记录不存在（t=${from}）` }
  }
  const times = row.keyframes.map((frame) => frame.time)
  let target = Math.round((from + RECORD_COPY_OFFSET) * 1e6) / 1e6
  let guardCount = 0
  while (times.some((time) => Math.abs(time - target) <= 1e-6)) {
    target = Math.round((target + RECORD_COPY_OFFSET) * 1e6) / 1e6
    guardCount += 1
    if (guardCount > 1000) {
      return { ok: false, message: '找不到可用的复制时间（同刻冲突过多）' }
    }
  }
  return addRecordCommand({ clipKey, row, time: target, body })
}

/** 记录体的可读预览（原始记录只读区用；失败时退回 `String`）。 */
export function formatRecordBody(body: unknown): string {
  try {
    return JSON.stringify(body, null, 2) ?? String(body)
  } catch {
    return String(body)
  }
}

/** 记录的事件名：记录体 `event_type` 优先，其次 `command`（EVENT），最后退回行标签。 */
export function recordEventName(body: unknown, definition: EventDefinition, fallback: string): string {
  if (isJsonObject(body)) {
    const eventType = body.event_type
    if (typeof eventType === 'string' && eventType.length > 0) {
      return eventType
    }
    const command = body.command
    if (definition.name === 'event' && typeof command === 'string' && command.length > 0) {
      return command
    }
  }
  return fallback
}

/**
 * 新记录的初值：按 schema 声明的字段默认值生成，不写半成品。
 *
 * `event`：`event_type` 取目录默认（缺省 `command`）；不写 `command`（空串 = 占位）。
 * `mod_event`：`event_type` 取目录默认（缺省 `mod_event`），`data` 给空对象（运行时要求对象）。
 * 未知事件路径返回 `null`（只读，不能创建记录）。
 */
export function seedRecordBody(row: PropertyRow): JsonObject | null {
  const definition = eventDefinition(row)
  if (!definition.known) {
    return null
  }
  const def = row.def
  const eventTypeDefault = typeof def?.default === 'string' && def.default.length > 0
    ? def.default
    : definition.name
  if (definition.name === 'event') {
    return { event_type: eventTypeDefault }
  }
  return { event_type: eventTypeDefault, data: {} }
}

/** 记录时间列表（升序；记录编辑器与复制偏移用）。 */
export function recordTimes(row: PropertyRow): number[] {
  return row.keyframes.map((frame) => frame.time).sort((left, right) => left - right)
}
