/**
 * MOD_EVENT / EVENT 对象级缺省的本地组合层（11-13 裁决收口）。
 *
 * 06 的命令翻译（`features/effects/eventRecords.ts`）只覆盖**记录体关键帧**，
 * 没有对象级 `value` 的写入翻译；按归属约束不改那个文件。本模块只做两件事：
 * - 读取/合并对象级 `value`（`event_type` / `data`）；
 * - 按冻结的 `DocCommand` 真实类型构造 `object.setValue`（保关键帧，见 `commands.ts` 实现）。
 *
 * 写入语义：对象级缺省只影响**未覆盖**该字段的记录；已显式写过 `event_type` / `data`
 * 的记录保持原样，命令层不做回填。
 */
import type { DocCommand } from '../../../../core/doc/commands.ts'
import { isFiniteNumber, isJsonObject } from '../../../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../../../core/doc/types.ts'

/** 对象级缺省读取结果。 */
export interface ObjectDefaultSnapshot {
  /** 对象级显式 `event_type`；未写为 `null`。 */
  eventType: string | null
  /** 对象级显式 `data` 对象；未写或非对象为 `null`。 */
  data: JsonObject | null
  /** 对象级 `value` 原始对象；没有为 `null`。 */
  raw: JsonObject | null
}

/** 从片段 `objects` 读取对象级缺省。 */
export function readObjectDefaults(objects: JsonObject | null, objectPath: string): ObjectDefaultSnapshot {
  const property = objects?.[objectPath]
  const raw = isJsonObject(property) && isJsonObject(property.value) ? property.value : null
  const eventType = raw !== null && typeof raw.event_type === 'string' ? raw.event_type : null
  const data = raw !== null && isJsonObject(raw.data) ? raw.data : null
  return { eventType, data, raw }
}

/** 一次对象级补丁：`undefined` 不改动；`null` 删除该键；非空值写入。 */
export interface ObjectDefaultPatch {
  eventType?: string | null
  data?: JsonObject | null
}

/**
 * 在当前对象级 `value` 上合并补丁，产出新的 `value` 对象。
 * 不原地改入参；删除键时从结果对象移除，而不是写成 `null`。
 */
export function buildObjectDefaultValue(current: JsonObject | null, patch: ObjectDefaultPatch): JsonObject {
  const next: JsonObject = {}
  if (current !== null) {
    for (const [key, item] of Object.entries(current)) {
      next[key] = item
    }
  }
  if (patch.eventType !== undefined) {
    if (patch.eventType === null) {
      delete next.event_type
    } else {
      next.event_type = patch.eventType
    }
  }
  if (patch.data !== undefined) {
    if (patch.data === null) {
      delete next.data
    } else {
      next.data = patch.data
    }
  }
  return next
}

/** 按真实 `DocCommand` 类型构造对象级写入命令（不拼字符串、不绕过命令层）。 */
export function buildSetObjectDefaultCommand(input: {
  clipKey: string
  path: string
  value: JsonObject
}): DocCommand {
  return {
    kind: 'object.setValue',
    clipKey: input.clipKey,
    path: input.path,
    value: input.value,
  }
}

/**
 * `data` 树形状校验（与 `events.ts` 记录级 `validateDataTree` 同口径）：
 * null / 布尔 / 字符串 / 有限数 / 数组 / 对象任意嵌套；非有限数字与不支持类型报错。
 * 返回 `null` 表示通过，否则返回人类可读的失败说明。
 */
export function validateDefaultDataTree(value: JsonValue, path: string): string | null {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return null
  }
  if (typeof value === 'number') {
    return isFiniteNumber(value) ? null : `${path}: 数字必须有限（NaN / ±Infinity 拒绝）`
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = validateDefaultDataTree(value[index], `${path}[${index}]`)
      if (failure !== null) return failure
    }
    return null
  }
  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const failure = validateDefaultDataTree(item, `${path}.${key}`)
      if (failure !== null) return failure
    }
    return null
  }
  return `${path}: 不支持的值`
}
