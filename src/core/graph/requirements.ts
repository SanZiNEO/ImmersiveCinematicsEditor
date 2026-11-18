/**
 * 触发器 / 前置条目的纯函数：身份、解析、指纹、定位。
 *
 * 磁盘事实基准（`ScriptParser.java:1031-1046`、`ScriptValidator.java:2072,2511-2526`）：
 * - `requires` 元素是字符串或扁平对象 `{type, script, ...其它键}`；
 * - 字符串等价于 `{type:"script_played", script:"<id>"}`；
 * - 视图模型里的 `data` 只是「除 `type` 外键的浅拷贝」；磁盘上 `script` 在条目顶层；
 * - 老版本嵌套写法 `{type, data:{script}}` 读侧容忍降级（取不到时回退 custom/不可解析，不崩），
 *   写侧一律落扁平形状，不回写嵌套 `data`。
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

/** 视图 data：除 `type` 外的顶层键浅拷贝；老嵌套 `data` 并入（扁平键优先）。 */
function viewData(entry: JsonObject): Record<string, JsonValue> {
  const data: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (key !== 'type' && key !== 'data') data[key] = value
  }
  if (isJsonObject(entry.data)) {
    for (const [key, value] of Object.entries(entry.data)) {
      if (!(key in data)) data[key] = value
    }
  }
  return data
}

/** 取条目目标脚本 id：顶层 `script` 优先，老嵌套 `data.script` 降级回退。 */
function readEntryScript(entry: JsonObject): string | undefined {
  const top = readString(entry.script)
  if (top !== undefined) return top
  if (isJsonObject(entry.data)) return readString(entry.data.script)
  return undefined
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
    const data = viewData(entry)
    if (isBuiltinRequirementType(type)) {
      const scriptId = readEntryScript(entry)
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

/** 一条前置的目标脚本 id（仅内置）。 */
export function requirementScriptId(entry: JsonValue): string | undefined {
  if (typeof entry === 'string') {
    return entry.length > 0 ? entry : undefined
  }
  if (!isJsonObject(entry) || !isBuiltinRequirementType(typeof entry.type === 'string' ? entry.type : '')) {
    return undefined
  }
  return readEntryScript(entry)
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

/**
 * 写入一条内置前置（扁平磁盘形状 `{type, script, ...其它键}`）。
 * 保留条目上既存的顶层额外键（自定义前置参数原样留在顶层）；老嵌套 `data` 里的额外键并入顶层。
 */
export function writeRequirement(
  entry: JsonValue | undefined,
  type: BuiltinRequirementType,
  targetScriptId: string,
): JsonValue {
  if (typeof entry === 'string' && type === 'script_played') {
    return targetScriptId
  }
  const out: Record<string, JsonValue> = {}
  if (isJsonObject(entry)) {
    for (const [key, value] of Object.entries(entry)) {
      if (key !== 'type' && key !== 'data' && key !== 'script') out[key] = value
    }
    if (isJsonObject(entry.data)) {
      for (const [key, value] of Object.entries(entry.data)) {
        if (!(key in out)) out[key] = value
      }
    }
  }
  out.type = type
  out.script = targetScriptId
  return out
}

/** 追加一条内置前置（扁平对象写法，无嵌套 `data` 键）。 */
export function newRequirement(type: BuiltinRequirementType, targetScriptId: string): JsonValue {
  return { type, script: targetScriptId }
}

/** 内置类型列表（UI 下拉用）。 */
export const BUILTIN_TYPES: readonly BuiltinRequirementType[] = BUILTIN_REQUIREMENT_TYPES
