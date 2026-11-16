/**
 * 对象值的严格转换（03-02）：逐条对齐运行时 `ObjectCodec`。
 *
 * - 不做字符串↔数字转换；不做模糊枚举；非有限数一律拒绝；
 * - `null` 只用于 `nullable_float` 与 `event_record`；
 * - `int` 必须是 32 位可表示整数；
 * - `min` / `max` 越界拒绝，不自动夹取（运行时 parser 不做范围检查，validator 报错 → 归 `error` 级）；
 * - 事件记录形状由属性路径末段决定（`event` / `mod_event`）。
 *
 * 失败分三类，供结构检查映射 severity：
 * - `type`：parser 直接抛（`block`）；
 * - `enum` / `range`：parser 接受、`script.validate` 报错（`error`）。
 */
import type { FieldEntry } from '../schema/types.ts'
import { describe, isFiniteNumber, isJsonObject } from './json.ts'
import { lastSegment } from './path.ts'
import type { JsonValue } from './types.ts'

export interface ValueCheckFailure {
  ok: false
  kind: 'type' | 'enum' | 'range'
  message: string
}

export interface ValueCheckSuccess {
  ok: true
  value: JsonValue
}

export type ValueCheck = ValueCheckSuccess | ValueCheckFailure

export interface ValueContext {
  /** 属性点分路径；事件记录形状只看末段。 */
  propertyPath?: string
}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

/** 是否为 32 位可表示整数。 */
function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
}

/** 单个 32 位浮点是否可表示（与 `ObjectCodec` 的 `(float) number` 检查同口径）。 */
function isFloat32(value: number): boolean {
  return Number.isFinite(value) && Number.isFinite(Math.fround(value))
}

/** 数值范围检查（`min` / `max` 来自 02 目录）。 */
function checkRange(def: FieldEntry, value: number): ValueCheckFailure | undefined {
  if (def.min !== undefined && value < def.min) {
    return { ok: false, kind: 'range', message: `超出范围：${value} < min ${def.min}` }
  }
  if (def.max !== undefined && value > def.max) {
    return { ok: false, kind: 'range', message: `超出范围：${value} > max ${def.max}` }
  }
  return undefined
}

/** 事件记录的 `position`：恰好 `{x,z}` 或 `{dx,dz}`（`ObjectCodec.readPosition`）。 */
function checkEventPosition(value: JsonValue, path: string): string | undefined {
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
    if (!isFiniteNumber(item) || !isFloat32(item)) {
      return `${path}.${key}: 需要有限数字`
    }
  }
  return undefined
}

/** `event` 事件记录（`ObjectCodec.readEvent`）。 */
function checkEventRecordShape(value: JsonValue, path: string): string | undefined {
  if (!isJsonObject(value)) {
    return `${path}: 需要对象（事件记录）`
  }
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`
    if (key === 'command' || key === 'event_type' || key === 'id') {
      if (typeof item !== 'string') {
        return `${itemPath}: 需要字符串`
      }
      continue
    }
    if (key === 'position') {
      const failure = checkEventPosition(item, itemPath)
      if (failure !== undefined) {
        return failure
      }
      continue
    }
    return `${path}: 未知成员 ${key}`
  }
  return undefined
}

/** `mod_event.data` 的递归形状（`ObjectCodec.readData`）：null / 数组 / 对象 / 布尔 / 有限数 / 字符串。 */
function checkModEventData(value: JsonValue, path: string): string | undefined {
  if (value === null) {
    return undefined
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = checkModEventData(value[index], `${path}[${index}]`)
      if (failure !== undefined) {
        return failure
      }
    }
    return undefined
  }
  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const failure = checkModEventData(item, `${path}.${key}`)
      if (failure !== undefined) {
        return failure
      }
    }
    return undefined
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return undefined
  }
  if (isFiniteNumber(value) && isFloat32(value)) {
    return undefined
  }
  return `${path}: 不支持的值 ${describe(value)}`
}

/** `mod_event` 事件记录（`ObjectCodec.readModEvent`）。 */
function checkModEventRecordShape(value: JsonValue, path: string): string | undefined {
  if (!isJsonObject(value)) {
    return `${path}: 需要对象（事件记录）`
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'event_type') {
      if (typeof item !== 'string') {
        return `${path}.event_type: 需要字符串`
      }
      continue
    }
    if (key === 'data') {
      if (!isJsonObject(item)) {
        return `${path}.data: 需要对象`
      }
      const failure = checkModEventData(item, `${path}.data`)
      if (failure !== undefined) {
        return failure
      }
      continue
    }
    return `${path}: 未知成员 ${key}`
  }
  return undefined
}

/**
 * 事件记录形状：由属性路径末段决定（`ObjectCodec.readEventRecord`）。
 * 末段不是 `event` / `mod_event` → 运行时抛「未知事件记录路径」。
 */
function checkEventRecord(value: JsonValue, propertyPath: string, path: string): string | undefined {
  const suffix = lastSegment(propertyPath)
  if (suffix === 'event') {
    return checkEventRecordShape(value, path)
  }
  if (suffix === 'mod_event') {
    return checkModEventRecordShape(value, path)
  }
  return `${path}: 未知事件记录路径（需要以 event / mod_event 结尾）`
}

/**
 * 按 02 目录的 `FieldEntry` 严格检查一个值。
 *
 * 只做「值本身」的检查；形态（`value` / `keyframes`）由 `object.ts` 负责。
 */
export function checkValue(def: FieldEntry, value: JsonValue, context: ValueContext = {}): ValueCheck {
  switch (def.type) {
    case 'float': {
      if (!isFiniteNumber(value) || !isFloat32(value)) {
        return { ok: false, kind: 'type', message: `需要有限数字，实际: ${describe(value)}` }
      }
      const range = checkRange(def, value)
      return range ?? { ok: true, value }
    }
    case 'int': {
      if (!isFiniteNumber(value) || !isInt32(value)) {
        return { ok: false, kind: 'type', message: `需要整数，实际: ${describe(value)}` }
      }
      const range = checkRange(def, value)
      return range ?? { ok: true, value }
    }
    case 'bool': {
      if (typeof value !== 'boolean') {
        return { ok: false, kind: 'type', message: `需要布尔值，实际: ${describe(value)}` }
      }
      return { ok: true, value }
    }
    case 'string':
    case 'ref': {
      if (typeof value !== 'string') {
        return { ok: false, kind: 'type', message: `需要字符串，实际: ${describe(value)}` }
      }
      return { ok: true, value }
    }
    case 'enum': {
      if (typeof value !== 'string') {
        return { ok: false, kind: 'type', message: `需要字符串（枚举），实际: ${describe(value)}` }
      }
      const values = def.enumValues ?? []
      if (!values.includes(value)) {
        return {
          ok: false,
          kind: 'enum',
          message: `不在枚举内（允许: ${values.join(', ')}），实际: ${value}`,
        }
      }
      return { ok: true, value }
    }
    case 'nullable_float': {
      if (value === null) {
        return { ok: true, value }
      }
      if (!isFiniteNumber(value) || !isFloat32(value)) {
        return { ok: false, kind: 'type', message: `需要 null 或有限数字，实际: ${describe(value)}` }
      }
      const range = checkRange(def, value)
      return range ?? { ok: true, value }
    }
    case 'struct': {
      return { ok: true, value }
    }
    case 'event_record': {
      const failure = checkEventRecord(value, context.propertyPath ?? def.key, def.key)
      if (failure !== undefined) {
        return { ok: false, kind: 'type', message: failure }
      }
      return { ok: true, value }
    }
    default:
      return {
        ok: false,
        kind: 'type',
        message: `未知值类型 ${String(def.type)}（02 目录与 03 值模型不一致）`,
      }
  }
}
