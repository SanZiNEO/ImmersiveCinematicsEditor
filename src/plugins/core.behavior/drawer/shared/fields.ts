/**
 * 草稿体读写与目录字段助手（纯函数，不 import Vue）。
 *
 * 草稿体是规则 / 绑定记录的深拷贝；本地编辑只改草稿，应用时才走命令层。
 * 未登记字段原样留在草稿体上，编辑器只展示只读块，不静默删除。
 */
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'
import { isJsonObject, isJsonArray } from '../../../../core/doc/json.ts'

/** FieldInput 可接受的字段类型联合。 */
export type FieldKind =
  | 'string'
  | 'bool'
  | 'int'
  | 'float'
  | 'enum'
  | 'array'
  | 'object'
  | 'map'
  | 'unknown'

/** 读字段；缺失返回 `undefined`。 */
export function readField(body: JsonObject, key: string): JsonValue | undefined {
  return body[key]
}

/** 写字段；`undefined` 表示省略该键（从草稿体删除，不写占位空对象）。 */
export function writeField(body: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value === undefined) {
    delete body[key]
    return
  }
  body[key] = value
}

/** 显式删除一个键。 */
export function removeField(body: JsonObject, key: string): void {
  delete body[key]
}

/** 未登记字段（不在白名单内、且不是 `type` 这种结构键）。 */
export function unknownKeys(body: JsonObject, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((key) => !allowed.includes(key))
}

/** 宽松转对象；不是对象返回 `null`。 */
export function asObject(value: JsonValue | undefined): JsonObject | null {
  return isJsonObject(value) ? value : null
}

/** 宽松转数组；不是数组返回 `null`。 */
export function asArray(value: JsonValue | undefined): JsonValue[] | null {
  return isJsonArray(value) ? value : null
}

/** 解析数字输入框文本；空串 / 非有限数返回 `undefined`（不夹取、不静默改 0）。 */
export function parseNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** 数字展示文本（`undefined` → 空串）。 */
export function numberText(value: JsonValue | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

// ── 组合器子项编解码（11-07：根平铺；子项包一层 `conditions`）──────────────────

/** 子项 `{ type, conditions }` → 平铺节点 `{ type, ...conditions }`。 */
export function childToNode(child: JsonObject): JsonObject {
  const data = asObject(child.conditions) ?? {}
  return { type: child.type, ...data }
}

/** 平铺节点 → 子项 `{ type, conditions }`（剥离 `type`，其余进 `conditions`）。 */
export function nodeToChild(node: JsonObject): JsonObject {
  const { type, ...conditions } = node
  return { type, conditions }
}

/** 组合器 `list` 数组；缺失 / 非数组返回空数组（只读展示口径，不伪造）。 */
export function combinationList(node: JsonObject): JsonObject[] {
  const list = asArray(node.list)
  if (list === null) return []
  return list.filter(isJsonObject)
}
