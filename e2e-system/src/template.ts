/**
 * 模板参数展开。
 *
 * 规则（docs/13-e2e-system.md §3.2）：
 * - `"${name}"` 整体匹配时保留原始类型（数字/布尔/数组不转字符串）；
 * - 片段占位符替换为字符串；
 * - 未解析的占位符抛 E_EXPAND，不静默留空。
 */

export class ExpandError extends Error {
  readonly code = 'E_EXPAND'
  constructor(message: string) {
    super(message)
    this.name = 'ExpandError'
  }
}

const WHOLE_PLACEHOLDER = /^\$\{([A-Za-z0-9_]+)\}$/
const PARTIAL_PLACEHOLDER = /\$\{([A-Za-z0-9_]+)\}/g

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function expandValue(
  value: unknown,
  params: Record<string, unknown>,
  label: string,
): unknown {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_PLACEHOLDER)
    if (whole !== null) {
      const key = whole[1]
      if (!(key in params)) {
        throw new ExpandError(`${label}: 未解析参数 \${${key}}`)
      }
      return params[key]
    }
    return value.replace(PARTIAL_PLACEHOLDER, (_, key: string) => {
      if (!(key in params)) {
        throw new ExpandError(`${label}: 未解析参数 \${${key}}`)
      }
      const next = params[key]
      return typeof next === 'string' ? next : JSON.stringify(next)
    })
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => expandValue(entry, params, `${label}[${index}]`))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandValue(entry, params, `${label}.${key}`)]),
    )
  }
  return value
}
