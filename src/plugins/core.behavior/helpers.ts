/**
 * 触发器面板的本地纯函数与命令载荷类型（05-13）。
 *
 * 这些类型只描述面板提交的命令对象；`DocCommand` 的共享联合由主代理扩展，
 * 本插件不改 `src/core/doc/commands.ts`。调用处统一 `as unknown as DocCommand`。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'

/** `trigger.setFields`：只传要改的脚本 JSON 键，type / id 由命令拒绝。 */
export interface TriggerSetFieldsCommand {
  kind: 'trigger.setFields'
  triggerIdentity: string
  patch: JsonObject
}

/** `trigger.setConditions`：只传要改的 conditions 键；删除用 `remove` 列出键。 */
export interface TriggerSetConditionsCommand {
  kind: 'trigger.setConditions'
  triggerIdentity: string
  patch: Record<string, JsonValue>
  remove?: string[]
}

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

/** 统一路径分隔符；保留相对 / 绝对形态，仅用于比较。 */
export function normalizeScriptPath(raw: string | null): string | null {
  if (raw === null) {
    return null
  }
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  return normalized.length === 0 ? null : normalized
}

/**
 * 判断文档路径与图中节点路径是否指向同一脚本。
 *
 * 文档的 `currentPath` 与图节点的 `path` 都以 scripts 为基准，但不同入口可能带
 * `scripts/` 前缀；只用完整相等或一方是另一方后缀来匹配，不做模糊 basename。
 */
export function sameScriptPath(left: string | null, right: string | null): boolean {
  const a = normalizeScriptPath(left)
  const b = normalizeScriptPath(right)
  if (a === null || b === null) {
    return false
  }
  if (a === b) {
    return true
  }
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
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
