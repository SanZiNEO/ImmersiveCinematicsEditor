/**
 * data 双视图（结构化键值 / 原始 JSON）共用的纯函数助手。
 * 只处理 JSON 域：null / string / number / boolean / object / array；
 * 不引入脚本字段引用、不做消费方 schema 校验（与 11-13 §4.3 口径一致）。
 */
import { isFiniteNumber, isJsonObject } from '../../../../core/doc/json.ts'
import type { JsonArray, JsonObject, JsonValue } from '../../../../core/doc/types.ts'

/** 可在编辑器里切换的值种类。 */
export type DataValueKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

/** 判定一个 JSON 值所属的编辑器种类。 */
export function kindOf(value: JsonValue): DataValueKind {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  return 'object'
}

/** 新建某种类别的空值（对象 / 数组给空容器，不写 null 占位）。 */
export function emptyValue(kind: DataValueKind): JsonValue {
  switch (kind) {
    case 'string':
      return ''
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'object':
      return {}
    case 'array':
      return []
  }
}

/**
 * 把文本草稿按目标种类转成 JSON 值。
 * 数字无法解析为有限数时返回 `null`（调用方保留草稿、不落盘）。
 */
export function coerceText(kind: DataValueKind, text: string): JsonValue | null {
  switch (kind) {
    case 'string':
      return text
    case 'number': {
      const parsed = Number(text)
      return isFiniteNumber(parsed) ? parsed : null
    }
    case 'boolean':
      return text === 'true'
    case 'null':
      return null
    case 'object':
    case 'array':
      return null
  }
}

/** 对象条目（保持插入顺序）。 */
export interface DataEntry {
  key: string
  value: JsonValue
}

/** 从对象取出有序条目数组。 */
export function entriesOf(object: JsonObject): DataEntry[] {
  return Object.entries(object).map(([key, value]) => ({ key, value }))
}

/** 从有序条目重建对象；同名键后者覆盖前者（改名碰撞时由调用方规避）。 */
export function objectFromEntries(entries: readonly DataEntry[]): JsonObject {
  const out: JsonObject = {}
  for (const entry of entries) {
    out[entry.key] = entry.value
  }
  return out
}

/** 数组取出带下标条目。 */
export function arrayEntries(array: JsonArray): DataEntry[] {
  return array.map((value, index) => ({ key: String(index), value }))
}

/** 顶层是否为可结构化编辑的对象。 */
export function isEditableObject(value: JsonValue | undefined): value is JsonObject {
  return isJsonObject(value)
}
