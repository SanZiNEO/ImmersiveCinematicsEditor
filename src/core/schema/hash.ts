/**
 * 目录哈希：把目录的规范形式（递归键排序）投成 SHA-256 小写 hex。
 *
 * `catalogHash` 本身不参与哈希，所以带占位 `''` 的目录与带真实 hash 的目录算出同一个值。
 */
import type { FieldCatalog } from './types.ts'

/** 对文本取 SHA-256，返回 64 位小写 hex。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * 规范形式：数组按原序递归；普通对象按键名升序重建；`undefined` 对象属性丢弃；
 * `null` / 字符串 / 布尔 / 数字原样保留。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const item = source[key]
      if (item === undefined) {
        continue
      }
      sorted[key] = canonicalize(item)
    }
    return sorted
  }
  return value
}

/** 目录哈希：去掉 `catalogHash` 后取规范形式的 SHA-256。 */
export async function computeCatalogHash(catalog: FieldCatalog): Promise<string> {
  const { catalogHash: _ignored, ...rest } = catalog
  return sha256Hex(JSON.stringify(canonicalize(rest)))
}
