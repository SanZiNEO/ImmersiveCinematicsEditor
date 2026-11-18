/**
 * 属性行过滤钩子（09 集成面，最小扩展）。
 *
 * 06 的行集合（`buildPropertyRows`）按 schema 全量构建；09 的层类型矩阵需要在
 * 「当前层类型不读的字段」上做门控。这里提供按面板注册的过滤器，`propertyRowsFor`
 * 在构建后按注册顺序应用；没有注册时行为与 06 完全一致。
 *
 * 过滤器只接收只读行与对象，不允许写文档；未知路径由过滤器自己决定是否保留。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import type { PropertyRow } from './types.ts'

/** 面板身份。 */
export type RowPanel = 'properties' | 'effects'

/** 过滤器上下文。 */
export interface RowFilterContext {
  trackType: string
  objects: JsonObject
  panel: RowPanel
}

/** 过滤结果：可见行 + 诊断（诊断可选，面板不强制展示）。 */
export interface RowFilterResult {
  rows: PropertyRow[]
  hidden?: Array<{ path: string; reason: string }>
}

/** 过滤器签名。 */
export type RowFilter = (rows: readonly PropertyRow[], context: RowFilterContext) => RowFilterResult

const filters: RowFilter[] = []

/** 注册过滤器；返回取消函数。 */
export function registerRowFilter(filter: RowFilter): () => void {
  filters.push(filter)
  return () => {
    const index = filters.indexOf(filter)
    if (index >= 0) {
      filters.splice(index, 1)
    }
  }
}

/** 依次应用全部过滤器（诊断合并；没有过滤器时返回原数组）。 */
export function applyRowFilters(
  rows: readonly PropertyRow[],
  context: RowFilterContext,
): RowFilterResult {
  if (filters.length === 0) {
    return { rows: [...rows] }
  }
  let current: readonly PropertyRow[] = rows
  const hidden: Array<{ path: string; reason: string }> = []
  for (const filter of filters) {
    const result = filter(current, context)
    current = result.rows
    if (result.hidden !== undefined) {
      hidden.push(...result.hidden)
    }
  }
  return { rows: [...current], hidden }
}

/** 清空过滤器（测试用）。 */
export function clearRowFilters(): void {
  filters.length = 0
}
