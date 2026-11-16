/**
 * 纯 JSON 工具：判定、深拷贝、语义深比较、按路径取子节点。
 *
 * 只处理 `JSON.parse` 产物域（不含 `undefined` / `NaN` / 函数 / Date）；
 * 需要保留 `undefined` 的编辑态走 `AuthoringState`，不经过这里。
 */
import type { JsonArray, JsonObject, JsonValue } from './types.ts'

/** 是否为 JSON 对象（数组不算）。 */
export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 是否为 JSON 数组。 */
export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value)
}

/** 是否为 JSON 标量（null / string / number / boolean）。 */
export function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** 是否为有限数字（`NaN` / `±Infinity` 不是 JSON 值，运行时也一律拒绝）。 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 深拷贝 JSON 值（手写递归，保持键插入顺序；不引入结构化克隆的额外语义）。 */
export function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item)) as T
  }
  if (value !== null && typeof value === 'object') {
    const source = value as JsonObject
    const out: JsonObject = {}
    for (const key of Object.keys(source)) {
      out[key] = cloneJson(source[key])
    }
    return out as T
  }
  return value
}

/**
 * 语义深比较：
 * - 对象按键集合与值（成员顺序无关）；
 * - 数组按顺序与长度；
 * - 数字按值（`1` 与 `1.0` 在 JS 里已是同一个数）；
 * - `NaN` 不等于任何值（JSON 域不会出现，防御式返回 false）。
 */
export function sameJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) {
      return false
    }
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        return false
      }
      if (!sameJson(left[key], right[key])) {
        return false
      }
    }
    return true
  }
  return false
}

/** 追加成员名到 JSON 路径。 */
export function memberPath(base: string, key: string): string {
  return base.length === 0 ? key : `${base}.${key}`
}

/** 数组的紧凑描述（报错文案用）。 */
export function describe(value: JsonValue | undefined): string {
  if (value === undefined) {
    return 'undefined'
  }
  try {
    const text = JSON.stringify(value)
    if (text === undefined) {
      return String(value)
    }
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return String(value)
  }
}
