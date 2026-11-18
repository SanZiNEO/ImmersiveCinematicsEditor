/**
 * 保存前的未烘焙缓动检查（06-06 §三 / §4.2）：唯一保存入口必须先过这一关。
 *
 * 三选一的语义：
 * - `bake`：逐段采样并提交 `object.bakeEasing`，成功后清掉该段的会话缓动；任一段失败整次中止；
 * - `discard`：只清会话缓动（一次 `commitClipAuthoring` 一个片段），节点保持原插值；
 * - `cancel`：不落盘、不清 dirty、不显示"已保存"。
 *
 * 本模块不弹对话框、不读 Vue：调用方（`file.saveDoc`）负责询问与提示，
 * 这里只把"会话里有什么"和"怎么清"做成可测的纯逻辑。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { AuthoringState, JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { ClipListEntry } from '../../workbench/api/documents.ts'
import { propertyRowsFor } from './clipContext.ts'
import { bakeSegment } from './easing.ts'
import { readEasingTable, removeEasingMutator } from './easingStore.ts'
import type { ClipTiming } from './rows.ts'
import type { AuthoringEasing, PropertyRow } from './types.ts'

/** 一段待烘焙的会话缓动。 */
export interface PendingBakeSegment {
  clipKey: string
  path: string
  fromTime: number
  toTime: number
  easing: AuthoringEasing
}

/** 缓动键解析：`${path}@${fromTime}-${toTime}`（时间用 `toFixed(6)` 归一）。 */
export function parseEasingKey(key: string): { path: string; fromTime: number; toTime: number } | null {
  const at = key.lastIndexOf('@')
  if (at <= 0) {
    return null
  }
  const path = key.slice(0, at)
  const range = key.slice(at + 1)
  const dash = range.indexOf('-')
  if (dash <= 0) {
    return null
  }
  const fromTime = Number(range.slice(0, dash))
  const toTime = Number(range.slice(dash + 1))
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    return null
  }
  return { path, fromTime, toTime }
}

/**
 * 扫描会话里的全部未烘焙段。
 *
 * `clipAuthoring` 是 `clipKey → AuthoringState` 的只读快照（面板经 `clipAuthoringOf` 逐个读）。
 */
export function pendingBakeSegments(
  clipAuthoring: Readonly<Record<string, AuthoringState>>,
): PendingBakeSegment[] {
  const result: PendingBakeSegment[] = []
  for (const [clipKey, state] of Object.entries(clipAuthoring)) {
    const table = readEasingTable(state)
    for (const [key, easing] of Object.entries(table)) {
      const parsed = parseEasingKey(key)
      if (parsed === null) {
        continue
      }
      result.push({
        clipKey,
        path: parsed.path,
        fromTime: parsed.fromTime,
        toTime: parsed.toTime,
        easing: { ...easing, clipKey, path: parsed.path, fromTime: parsed.fromTime, toTime: parsed.toTime },
      })
    }
  }
  result.sort((left, right) => {
    const byClip = left.clipKey.localeCompare(right.clipKey)
    if (byClip !== 0) {
      return byClip
    }
    const byPath = left.path.localeCompare(right.path)
    return byPath !== 0 ? byPath : left.fromTime - right.fromTime
  })
  return result
}

/**
 * 收集全部片段的未烘焙段（保存入口用）。
 *
 * 面板只能逐个片段读作者态，所以这里接收"片段键列表 + 读取函数"，不接收整份 `clipAuthoring`。
 */
export function collectPendingSegments(input: {
  clips: readonly ClipListEntry[]
  clipAuthoringOf: (clipKey: string) => AuthoringState
}): PendingBakeSegment[] {
  const table: Record<string, AuthoringState> = {}
  for (const clip of input.clips) {
    const state = input.clipAuthoringOf(clip.clipKey)
    if (Object.keys(state).length > 0) {
      table[clip.clipKey] = state
    }
  }
  return pendingBakeSegments(table)
}

/** 按路径汇总（提示文案用：列出受影响的路径与段数）。 */
export function summarizePendingBake(
  segments: readonly PendingBakeSegment[],
): Array<{ clipKey: string; path: string; count: number }> {
  const map = new Map<string, { clipKey: string; path: string; count: number }>()
  for (const segment of segments) {
    const key = `${segment.clipKey}|${segment.path}`
    const current = map.get(key)
    if (current === undefined) {
      map.set(key, { clipKey: segment.clipKey, path: segment.path, count: 1 })
    } else {
      current.count += 1
    }
  }
  return [...map.values()]
}

/** 保存前检查的读写端口（`DocumentService` + `DocumentCommands` 的最小交集）。 */
export interface BakeSavePort {
  clips(): ClipListEntry[]
  clipObjects(clipKey: string): JsonObject | null
  commit(command: DocCommand): { ok: boolean; error?: string; warnings: string[] }
  commitClipAuthoring(clipKey: string, mutate: (state: AuthoringState) => void): { ok: boolean; error?: string }
  catalog: CatalogIndex
}

/** 烘焙/清理的结果。 */
export interface BakeSaveOutcome {
  ok: boolean
  message?: string
  /** 实际烘焙的段数（`bake` 用）。 */
  baked?: number
}

/** JSON 值守卫：烘焙采样结果必须能直接写入文档。 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item))
  }
  return false
}

/** 一段的采样点（保留起止节点；段两端不存在时返回空数组）。 */
export function sampleSegmentPoints(
  port: BakeSavePort,
  segment: PendingBakeSegment,
  pxPerSecond: number,
): Array<{ time: number; value: JsonValue }> {
  const clip = port.clips().find((entry) => entry.clipKey === segment.clipKey)
  if (clip === undefined) {
    return []
  }
  const objects = port.clipObjects(segment.clipKey)
  if (objects === null) {
    return []
  }
  const rows = propertyRowsFor({
    clipKey: segment.clipKey,
    trackType: clip.trackType,
    objects,
    catalog: port.catalog,
  })
  const row = rows.find((item) => item.path === segment.path)
  if (row === undefined) {
    return []
  }
  const sampled = bakeSegment({
    frames: row.keyframes,
    interp: row.interp,
    fromTime: segment.fromTime,
    toTime: segment.toTime,
    ...(segment.easing === undefined ? {} : { easing: segment.easing }),
  })
  const points: Array<{ time: number; value: JsonValue }> = []
  for (const point of sampled) {
    if (!isJsonValue(point.value)) {
      return []
    }
    points.push({ time: point.time, value: point.value })
  }
  return points
}

/**
 * 烘焙全部未烘焙段。
 *
 * 顺序：先按段提交 `object.bakeEasing`（失败立即中止，已提交的段留在撤销栈里），
 * 全部成功后再逐段清会话缓动。返回实际烘焙段数。
 */
export function bakePendingSegments(
  port: BakeSavePort,
  segments: readonly PendingBakeSegment[],
  pxPerSecond = 80,
): BakeSaveOutcome {
  let baked = 0
  for (const segment of segments) {
    const points = sampleSegmentPoints(port, segment, pxPerSecond)
    if (points.length < 2) {
      return {
        ok: false,
        message: `烘焙失败：${segment.path} 的段 ${segment.fromTime}→${segment.toTime} 端点缺失或采样为空`,
      }
    }
    const result = port.commit({
      kind: 'object.bakeEasing',
      clipKey: segment.clipKey,
      path: segment.path,
      fromTime: segment.fromTime,
      toTime: segment.toTime,
      points,
    })
    if (!result.ok) {
      return { ok: false, message: `烘焙失败：${result.error ?? '命令被拒绝'}` }
    }
    baked += 1
  }
  for (const segment of segments) {
    const cleared = port.commitClipAuthoring(
      segment.clipKey,
      removeEasingMutator(segment.path, segment.fromTime, segment.toTime),
    )
    if (!cleared.ok) {
      return {
        ok: false,
        message: `已烘焙 ${baked} 段，但清理会话缓动失败：${cleared.error ?? '未知原因'}`,
        baked,
      }
    }
  }
  return { ok: true, baked }
}

/**
 * 只清会话缓动（"仅保存节点"）。
 *
 * 每个片段一次 `commitClipAuthoring`：同片段的多条路径合成一个撤销项，
 * 不碰节点、不改插值。
 */
export function discardPendingSegments(
  port: BakeSavePort,
  segments: readonly PendingBakeSegment[],
): BakeSaveOutcome {
  const byClip = new Map<string, PendingBakeSegment[]>()
  for (const segment of segments) {
    const list = byClip.get(segment.clipKey)
    if (list === undefined) {
      byClip.set(segment.clipKey, [segment])
    } else {
      list.push(segment)
    }
  }
  let cleared = 0
  for (const [clipKey, list] of byClip) {
    const result = port.commitClipAuthoring(clipKey, (state) => {
      for (const segment of list) {
        removeEasingMutator(segment.path, segment.fromTime, segment.toTime)(state)
      }
    })
    if (!result.ok) {
      return { ok: false, message: `清理会话缓动失败：${result.error ?? '未知原因'}` }
    }
    cleared += list.length
  }
  return { ok: true, message: `已丢弃 ${cleared} 段会话缓动，按节点当前插值保存` }
}

/** 一个片段的行与时长（保存前提示与诊断共用）。 */
export interface ClipRows {
  clipKey: string
  trackType: string
  objects: JsonObject
  rows: PropertyRow[]
  timing: ClipTiming
}

/** 从公开端口读一个片段的属性行；片段不存在返回 `null`。 */
export function readClipRows(
  input: {
    clips: readonly ClipListEntry[]
    clipObjects: (clipKey: string) => JsonObject | null
    catalog: CatalogIndex
  },
  clipKey: string,
): ClipRows | null {
  const clip = input.clips.find((entry) => entry.clipKey === clipKey)
  if (clip === undefined) {
    return null
  }
  const objects = input.clipObjects(clipKey)
  if (objects === null) {
    return null
  }
  return {
    clipKey,
    trackType: clip.trackType,
    objects,
    rows: propertyRowsFor({ clipKey, trackType: clip.trackType, objects, catalog: input.catalog }),
    timing: { duration: clip.duration, infinite: clip.duration < 0 },
  }
}
