/**
 * 触发器 / 前置条目的纯函数：身份、解析、指纹、定位。
 *
 * 事实基准（02-05 / 05-01）：
 * - `requires` 元素是字符串或 `{type, data}`；
 * - 字符串等价于 `{type:"script_played", data:{script:"<id>"}}`；
 * - 内置三种只读 `data.script`；自定义类型只读保留。
 */
import { isJsonObject } from '../doc/json.ts'
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { BUILTIN_REQUIREMENT_TYPES, isBuiltinRequirementType } from './types.ts'
import type { BuiltinRequirementType, GraphRequirement } from './types.ts'

/** 触发器 id 的合法形态（`TriggerDefinition.ID_REGEX`）。 */
export const TRIGGER_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/

/** 读字符串值；非字符串返回 `undefined`。 */
function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 触发器的声明身份：有合法唯一 id 用 id，否则 `type#index`。 */
export function triggerIdentityOf(trigger: JsonObject, index: number, duplicateIds?: ReadonlySet<string>): string {
  const id = readString(trigger.id)
  const type = readString(trigger.type) ?? ''
  if (id !== undefined && TRIGGER_ID_PATTERN.test(id) && duplicateIds?.has(id) !== true) {
    return id
  }
  return `${type}#${index}`
}

/** 一次遍历触发器，统计重复的显式 id（脚本内唯一性判定）。 */
export function duplicateTriggerIds(triggers: readonly JsonValue[]): Set<string> {
  const counts = new Map<string, number>()
  for (const trigger of triggers) {
    if (!isJsonObject(trigger)) {
      continue
    }
    const id = readString(trigger.id)
    if (id !== undefined && TRIGGER_ID_PATTERN.test(id)) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const duplicates = new Set<string>()
  for (const [id, count] of counts) {
    if (count > 1) {
      duplicates.add(id)
    }
  }
  return duplicates
}

/** 读 `requires` 数组；非数组视为空（调用方负责告警）。 */
export function requiresArrayOf(trigger: JsonObject): JsonValue[] {
  return Array.isArray(trigger.requires) ? trigger.requires : []
}

/** 解析一条前置条目；不做目标解析（resolved/editable 由索引填）。 */
export function parseRequirement(entry: JsonValue, index: number): GraphRequirement {
  if (typeof entry === 'string') {
    return {
      index,
      type: 'script_played',
      data: { script: entry },
      role: 'builtin',
      scriptId: entry,
      editable: false,
    }
  }
  if (isJsonObject(entry)) {
    const type = typeof entry.type === 'string' ? entry.type : ''
    const data = isJsonObject(entry.data) ? cloneObject(entry.data) : {}
    if (isBuiltinRequirementType(type)) {
      const scriptId = readString(data.script)
      return {
        index,
        type,
        data,
        role: 'builtin',
        ...(scriptId === undefined ? {} : { scriptId }),
        editable: false,
      }
    }
    return {
      index,
      type,
      data,
      role: 'custom',
      editable: false,
      editableReason: '自定义前置',
    }
  }
  return {
    index,
    type: '',
    data: {},
    role: 'custom',
    editable: false,
    editableReason: '自定义前置',
  }
}

/** 浅拷贝 JSON 对象（前置 data 原样透传用）。 */
function cloneObject(value: JsonObject): Record<string, JsonValue> {
  const copy: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = entry
  }
  return copy
}

/** 一条前置的目标脚本 id（仅内置）。 */
export function requirementScriptId(entry: JsonValue): string | undefined {
  if (typeof entry === 'string') {
    return entry.length > 0 ? entry : undefined
  }
  if (!isJsonObject(entry) || !isBuiltinRequirementType(typeof entry.type === 'string' ? entry.type : '')) {
    return undefined
  }
  return isJsonObject(entry.data) ? readString(entry.data.script) : undefined
}

/** 稳定 JSON 表示：对象键排序、字符串原样、数字按 JSON 表示。 */
export function stableStringify(value: JsonValue): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/** FNV-1a 64 位（十六进制，16 位）。 */
export function stableHash(text: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/** `requires` 数组的稳定指纹。 */
export function requiresFingerprint(requires: readonly JsonValue[]): string {
  return stableHash(stableStringify(requires as JsonValue))
}

/** 触发器当前 `requires` 指纹。 */
export function triggerFingerprint(trigger: JsonObject): string {
  return requiresFingerprint(requiresArrayOf(trigger))
}

/** 按 `triggerIdentity` 找触发器：先比 id，再比 `type#index`。 */
export function findTriggerIndex(
  triggers: readonly JsonValue[],
  identity: string,
  duplicateIds?: ReadonlySet<string>,
): number {
  for (let index = 0; index < triggers.length; index += 1) {
    const trigger = triggers[index]
    if (!isJsonObject(trigger)) {
      continue
    }
    if (triggerIdentityOf(trigger, index, duplicateIds) === identity) {
      return index
    }
  }
  return -1
}

/** 写入一条内置前置（保留原条目形状）。 */
export function writeRequirement(
  entry: JsonValue | undefined,
  type: BuiltinRequirementType,
  targetScriptId: string,
): JsonValue {
  if (typeof entry === 'string' && type === 'script_played') {
    return targetScriptId
  }
  const data: Record<string, JsonValue> = isJsonObject(entry) && isJsonObject(entry.data)
    ? cloneObject(entry.data)
    : {}
  data.script = targetScriptId
  return { type, data }
}

/** 追加一条内置前置（对象写法）。 */
export function newRequirement(type: BuiltinRequirementType, targetScriptId: string): JsonValue {
  return { type, data: { script: targetScriptId } }
}

/** 内置类型列表（UI 下拉用）。 */
export const BUILTIN_TYPES: readonly BuiltinRequirementType[] = BUILTIN_REQUIREMENT_TYPES
