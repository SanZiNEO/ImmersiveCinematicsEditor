/**
 * 效果面板 / 片段属性面板共用的事件记录摘要（11-14）。
 *
 * 两个面板只保留「摘要 + 在行为页打开」：摘要唯一生成处是
 * `features/behavior/events.ts` 的 `describeEventRecord`；记录身份经 behavior focus
 * 窄通道交给行为页抽屉，这里不提供第二套字段编辑通路。
 */
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipListEntry } from '../../../workbench/api/documents.ts'
import {
  describeEventRecord,
  eventRecords,
  type ClipEventContext,
  type EventRecordNode,
} from '../../../features/behavior/events.ts'
import type { RecordRef } from '../../../features/behavior/shared.ts'
import { enumerateRawClips } from '../../core.timeline/eventMarkers.ts'

/** 单个事件对象路径下的记录摘要与身份。 */
export interface EventSummaryEntry {
  path: 'event' | 'mod_event'
  summaries: string[]
  refs: RecordRef[]
  times: number[]
}

/** 片段的事件摘要（路径解析失败时 `path` 为 `null`）。 */
export interface ClipEventSummary {
  path: string | null
  entries: EventSummaryEntry[]
  nodes: EventRecordNode[]
}

/** 注册表片段键 → 文档成员路径；先按运行时 id，再按同类型文档顺序兜底。 */
export function resolveClipPath(
  root: JsonObject | null,
  clips: readonly ClipListEntry[],
  registryKey: string,
): string | null {
  const entry = clips.find((item) => item.clipKey === registryKey)
  if (entry === undefined) {
    return null
  }
  const raw = enumerateRawClips(root)
  if (entry.clipId !== undefined && entry.clipId.length > 0) {
    const hit = raw.find((item) => item.id === entry.clipId)
    if (hit !== undefined) {
      return hit.path
    }
  }
  const rawGroup = raw.filter((item) => item.inline === entry.inline && item.trackType === entry.trackType)
  const list = clips.filter((item) => item.inline === entry.inline && item.trackType === entry.trackType)
  const index = list.findIndex((item) => item.clipKey === registryKey)
  return index >= 0 ? rawGroup[index]?.path ?? null : null
}

/** 取片段全部事件记录（按对象路径分组的摘要 + 身份）。 */
export function summariesForClip(
  root: JsonObject | null,
  clips: readonly ClipListEntry[],
  registryKey: string,
  ctx: ClipEventContext,
): ClipEventSummary {
  const path = resolveClipPath(root, clips, registryKey)
  if (root === null || path === null) {
    return { path: null, entries: [], nodes: [] }
  }
  const nodes = eventRecords(root).filter((node) => node.clipKey === path)
  const byPath = new Map<'event' | 'mod_event', EventRecordNode[]>()
  for (const node of nodes) {
    const bucket = byPath.get(node.objectPath) ?? []
    bucket.push(node)
    byPath.set(node.objectPath, bucket)
  }
  const entries: EventSummaryEntry[] = [...byPath.entries()].map(([objectPath, group]) => ({
    path: objectPath,
    summaries: group.map((node) => describeEventRecord(node, ctx)),
    refs: group.map((node) => node.ref),
    times: group.map((node) => node.time),
  }))
  return { path, entries, nodes }
}

/** 在某对象路径下按时间命中记录身份；命中不到回退第一条。 */
export function recordRefAt(entry: EventSummaryEntry, time: number): RecordRef | null {
  if (entry.refs.length === 0) {
    return null
  }
  const index = entry.times.findIndex((item) => Math.abs(item - time) <= 1e-4)
  return entry.refs[index >= 0 ? index : 0]
}
