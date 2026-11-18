/**
 * 08-01 三个镜头编辑器共用的只读派生小工具。
 *
 * 只做行查表、有限数字回退与摘要计数；不读 store、不写文档、不维护第二份字段表。
 * 所有回退都只用于界面读数，绝不夹紧或改写作者输入。
 */
import type { JsonObject } from '../../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject } from '../../../core/doc/json.ts'
import type { PropertyRow } from '../../effects/types.ts'

/** 按路径取行（目录未登记或未派生时返回 `undefined`）。 */
export function rowAt(rows: readonly PropertyRow[], path: string): PropertyRow | undefined {
  return rows.find((row) => row.path === path)
}

/**
 * 读一个有限数字：显式静态值 > 目录缺省 > 回退值。
 *
 * 非有限数字（NaN / Infinity / 字符串）一律走回退，不猜、不夹紧。
 */
export function finiteNumber(row: PropertyRow | undefined, fallback: number): number {
  if (row !== undefined && row.hasValue && isFiniteNumber(row.value)) {
    return row.value
  }
  if (row !== undefined && row.hasDefault && isFiniteNumber(row.defaultValue)) {
    return row.defaultValue
  }
  return fallback
}

/** 已打帧行数（这些叶子归效果面板，本面板只做计数提示）。 */
export function animatedRowCount(rows: readonly PropertyRow[], paths: readonly string[]): number {
  return rows.filter((row) => paths.includes(row.path) && row.keyframes.length > 0).length
}

/** 路径集合里已显式写入静态值的行数（折叠摘要"保留 N 个值"用）。 */
export function presentRowCount(rows: readonly PropertyRow[], paths: readonly string[]): number {
  return paths.reduce((count, path) => {
    const row = rowAt(rows, path)
    return count + (row !== undefined && row.hasValue ? 1 : 0)
  }, 0)
}

/** 路径集合的关键帧总数（折叠摘要" M 帧"用；只计数，不删帧）。 */
export function frameCount(rows: readonly PropertyRow[], paths: readonly string[]): number {
  return paths.reduce((count, path) => {
    const row = rowAt(rows, path)
    return count + (row === undefined ? 0 : row.keyframes.length)
  }, 0)
}

/** 读对象里的字符串静态值（形状 / 类型门禁用；未命中走回退）。 */
export function staticString(objects: JsonObject, path: string, fallback: string): string {
  const raw = objects[path]
  if (isJsonObject(raw) && typeof raw.value === 'string') {
    return raw.value
  }
  return fallback
}
