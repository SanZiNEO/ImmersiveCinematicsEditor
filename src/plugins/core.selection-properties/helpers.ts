/**
 * 片段属性面板的本地纯函数（06-12 分层后）。
 *
 * 触发器相关的命令载荷与脚本路径比较已迁到 `core.behavior`；这里只保留
 * 属性面板自己用到的 JSON 工具与显示格式，不重复定义触发器类型。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'

/** 深拷贝 JSON 对象；不保留 undefined / 原型。 */
export function cloneJsonObject(value: JsonObject | undefined): JsonObject {
  if (value === undefined) {
    return {}
  }
  return cloneJsonValue(value) as JsonObject
}

/** 深拷贝 JSON 值。 */
export function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item))
  }
  if (value !== null && typeof value === 'object') {
    const copy: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      copy[key] = cloneJsonValue(item)
    }
    return copy
  }
  return value
}

/** JSON 类型名（用于没有目录元数据时的显示与输入校验）。 */
export function jsonTypeName(value: JsonValue | undefined): string {
  if (value === undefined) {
    return '未设置'
  }
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

/** 解析用户输入的 JSON 文本。 */
export type JsonParseResult =
  | { ok: true; value: JsonValue }
  | { ok: false; message: string }

export function parseJsonInput(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as JsonValue }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'JSON 解析失败' }
  }
}

/** 秒数显示（0 也显示 0.00s，不编造「未知」）。 */
export function formatSeconds(seconds: number): string {
  return Number.isFinite(seconds) ? `${seconds.toFixed(2)}s` : '未知'
}

/** 从输入框读数字；空串返回 `null`。 */
export function readNumberInput(raw: string): number | null | 'invalid' {
  if (raw.trim() === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : 'invalid'
}
