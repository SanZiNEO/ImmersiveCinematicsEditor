/**
 * 片段读模型的纯函数（06-09 / 06-07 / 06-06）：把公开端口拿到的只读视图折成属性行。
 *
 * 面板只能经 `DOCUMENT_SERVICE.view()` / `clipObjects()` / `CATALOG_SERVICE` 取数据，
 * 本模块把这四样东西折成 `PropertyRow[]` 与 `ClipTiming`，不碰 Vue、不碰文档对象。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { JsonObject } from '../../core/doc/types.ts'
import type { ClipViewEntry, ScriptView } from '../../workbench/api/documents.ts'
import type { ClipTiming } from './rows.ts'
import { buildPropertyRows } from './rows.ts'
import type { PropertyRow } from './types.ts'

/** 一个片段在只读视图里的定位结果。 */
export interface ClipContext {
  clipKey: string
  /** 轨道类型（目录查询用）。 */
  trackType: string
  clip: ClipViewEntry
}

/** 在脚本只读视图里找片段；找不到返回 `null`（片段可能已被删除）。 */
export function findClipContext(view: ScriptView | null, clipKey: string): ClipContext | null {
  if (view === null) {
    return null
  }
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      if (clip.clipKey === clipKey) {
        return { clipKey, trackType: track.type, clip }
      }
    }
  }
  return null
}

/** 片段时长上下文：`ClipViewEntry` 已给出 `infinite`，不在这里重算循环语义。 */
export function clipTimingOf(clip: ClipViewEntry): ClipTiming {
  return { duration: clip.duration, infinite: clip.infinite }
}

/**
 * 片段全部属性行（含未设置叶子与未知路径）。
 *
 * 顺序与 `buildPropertyRows` 一致：目录声明顺序在前，未知路径追加在后。
 */
export function propertyRowsFor(input: {
  clipKey: string
  trackType: string
  objects: JsonObject
  catalog: CatalogIndex
}): PropertyRow[] {
  return buildPropertyRows({
    clipKey: input.clipKey,
    clip: { objects: input.objects },
    trackType: input.trackType,
    catalog: input.catalog,
  })
}

/**
 * 未知 / 扩展组的稳定组键。
 *
 * `buildPropertyRows` 把未知路径的 `groupKey` 置为 `''`（与"未分组"同键），
 * 但它们的 `groupLabel` 是"未知 / 扩展"。为了让未知路径单独成组、且不与未分组混在一起，
 * 这里把未知行的组键改成一个不会与 schema section 冲突的哨兵值。
 */
export const UNKNOWN_GROUP_KEY = '__unknown__'

/** 把未知路径单独归组（不改值、不改只读语义，只改 UI 分组）。 */
export function separateUnknownGroup(rows: readonly PropertyRow[]): PropertyRow[] {
  return rows.map((row) => (row.unknown
    ? { ...row, groupKey: UNKNOWN_GROUP_KEY, groupLabel: '未知 / 扩展' }
    : row))
}

/**
 * 补齐 `requires` 未满足的原因（`PropertyRow.unavailableReason`）。
 *
 * `buildPropertyRows` 只搬目录声明，不解释依赖；这里用 `CatalogIndex.availability`
 * 的同一口径补上，调用方据此禁用控件并显示"需要 X=Y"。
 */
export function withAvailability(
  rows: readonly PropertyRow[],
  catalog: CatalogIndex,
  trackType: string,
  objects: JsonObject,
): PropertyRow[] {
  const values: Record<string, unknown> = {}
  for (const [path, raw] of Object.entries(objects)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      continue
    }
    const property = raw as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(property, 'value')) {
      values[path] = property.value
    }
  }
  return rows.map((row) => {
    if (row.def?.requires === undefined) {
      return row
    }
    const availability = catalog.availability(trackType, row.path, values)
    if (availability.available) {
      return row
    }
    return { ...row, unavailableReason: availability.reason ?? '前置条件未满足' }
  })
}
