/**
 * 事件标记层的纯逻辑（11-14）：路径 ↔ 活片段几何对齐、分组聚合、几何换算与可预览判定。
 *
 * 本模块不依赖 Vue、不读写文档；控制器与面板只做派生与交互。
 * 标记身份 / 类型 / 摘要仍来自 `features/behavior/events.ts`，这里不复制字段表。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import type {
  ClipListEntry,
  ScriptView,
} from '../../workbench/api/documents.ts'
import type { EventMarker, EventMarkerKind } from '../../features/behavior/events.ts'
import { recordRefKey, type RecordRef } from '../../features/behavior/shared.ts'

/** 预览某事件时，提前量（秒）：seek 到事件之前一小段再播放。 */
export const PREVIEW_LEAD = 0.3

/** 时间聚合容差（秒）：同轨全局时间落在该容差内的标记合并为一组。 */
const GROUP_EPSILON = 1e-6

/** 一条标记对齐到的活片段几何（注册表键 + 视图几何）。 */
export interface ResolvedClip {
  /** 视图 / 命令面使用的注册表片段键。 */
  registryKey: string
  /** 主轴轨道 id；独立片段为空串（不在主轴行内）。 */
  trackId: string
  trackType: string
  start: number
  duration: number
  infinite: boolean
  /** 文档成员路径（事件记录身份里的 `clipKey`）。 */
  rawPath: string
  /** 是否挂在主轴某条轨道行上。 */
  attached: boolean
  /** 是否取得到活片段起点 / 时长（取不到时不画位置，只给可见提示）。 */
  positioned: boolean
  /** 是否为独立片段（不在主轴轨道行内，按全局时间画在独立片段带）。 */
  standalone: boolean
  /** 来源片段名（悬停卡区分用；缺失时回退成员路径）。 */
  label: string
}

/** 标记在主轴上的可渲染视图。 */
export interface EventMarkerView {
  marker: EventMarker
  ref: RecordRef
  refKey: string
  registryKey: string
  trackId: string
  trackType: string
  objectPath: 'event' | 'mod_event'
  start: number
  duration: number
  infinite: boolean
  attached: boolean
  /** 是否取得到活片段几何位置；false 时不画横坐标，只进无起点提示。 */
  positioned: boolean
  standalone: boolean
  sourceLabel: string
  localTime: number
  globalTime: number
  kind: EventMarkerKind
  label: string
  groupKey: string
}

/** 聚合后的一组标记（同轨、同位置）。 */
export interface EventMarkerGroup {
  key: string
  trackId: string
  registryKey: string
  globalTime: number
  attached: boolean
  positioned: boolean
  standalone: boolean
  sourceLabel: string
  views: EventMarkerView[]
}

interface RawClip {
  path: string
  id: string | null
  trackType: string
  inline: boolean
  order: number
}

/** 解析成员路径：`timeline.tracks[i].clips[j]` 或 `clips[j]`。 */
export function parseClipPath(path: string): { inline: boolean; trackIndex: number; clipIndex: number } | null {
  const inlineMatch = /^timeline\.tracks\[(\d+)\]\.clips\[(\d+)\]$/.exec(path)
  if (inlineMatch !== null) {
    return { inline: true, trackIndex: Number(inlineMatch[1]), clipIndex: Number(inlineMatch[2]) }
  }
  const standaloneMatch = /^clips\[(\d+)\]$/.exec(path)
  if (standaloneMatch !== null) {
    return { inline: false, trackIndex: -1, clipIndex: Number(standaloneMatch[1]) }
  }
  return null
}

/** 枚举文档原始片段（路径 / 运行时 id / 轨道类型 / 顺序），与 `events.scanClips` 同序。 */
export function enumerateRawClips(root: JsonObject | null): RawClip[] {
  const clips: RawClip[] = []
  if (root === null) {
    return clips
  }
  const timeline = root.timeline
  if (isJsonObject(timeline)) {
    const tracks = timeline.tracks
    if (Array.isArray(tracks)) {
      tracks.forEach((trackElement, trackIndex) => {
        if (!isJsonObject(trackElement)) return
        const trackType = typeof trackElement.type === 'string' ? trackElement.type : ''
        const trackClips = trackElement.clips
        if (!Array.isArray(trackClips)) return
        trackClips.forEach((clipElement, clipIndex) => {
          if (!isJsonObject(clipElement)) return
          clips.push({
            path: `timeline.tracks[${trackIndex}].clips[${clipIndex}]`,
            id: typeof clipElement.id === 'string' ? clipElement.id : null,
            trackType,
            inline: true,
            order: clips.length,
          })
        })
      })
    }
  }
  const standalone = root.clips
  if (Array.isArray(standalone)) {
    standalone.forEach((clipElement, clipIndex) => {
      if (!isJsonObject(clipElement)) return
      const trackType = typeof clipElement.track === 'string' ? clipElement.track : ''
      clips.push({
        path: `clips[${clipIndex}]`,
        id: typeof clipElement.id === 'string' ? clipElement.id : null,
        trackType,
        inline: false,
        order: clips.length,
      })
    })
  }
  return clips
}

interface ViewClip {
  registryKey: string
  clipId?: string
  trackType: string
  trackId: string
  start: number
  duration: number
  infinite: boolean
  inline: boolean
  label: string
}

function viewClipsOf(view: ScriptView | null, clips: ClipListEntry[]): ViewClip[] {
  const list: ViewClip[] = []
  for (const track of view?.tracks ?? []) {
    for (const clip of track.clips) {
      list.push({
        registryKey: clip.clipKey,
        clipId: clip.clipId,
        trackType: track.type,
        trackId: track.trackId,
        start: clip.start,
        duration: clip.duration,
        infinite: clip.infinite || clip.duration < 0,
        inline: true,
        label: clip.label,
      })
    }
  }
  for (const entry of clips) {
    if (entry.inline) continue
    list.push({
      registryKey: entry.clipKey,
      clipId: entry.clipId,
      trackType: entry.trackType,
      trackId: '',
      start: entry.startTime,
      duration: entry.duration,
      infinite: entry.duration < 0,
      inline: false,
      label: '',
    })
  }
  return list
}

/**
 * 原始路径 → 活片段几何对齐。
 *
 * 先按运行时 `clip.id` 匹配；id 缺失 / 重复时按同类型内文档顺序兜底。
 * 匹配不上的原始片段保留路径，但 `attached = false`（不在主轴行内绘制）。
 */
export function resolveClipGeometry(
  root: JsonObject | null,
  view: ScriptView | null,
  clips: ClipListEntry[],
): Map<string, ResolvedClip> {
  const raw = enumerateRawClips(root)
  const viewClips = viewClipsOf(view, clips)
  const byId = new Map<string, ViewClip>()
  for (const item of viewClips) {
    if (item.clipId !== undefined && item.clipId.length > 0 && !byId.has(item.clipId)) {
      byId.set(item.clipId, item)
    }
  }

  const used = new Set<string>()
  const resolved = new Map<string, ResolvedClip>()

  const attach = (rawClip: RawClip, viewClip: ViewClip): void => {
    resolved.set(rawClip.path, {
      registryKey: viewClip.registryKey,
      trackId: viewClip.trackId,
      trackType: viewClip.trackType,
      start: viewClip.start,
      duration: viewClip.duration,
      infinite: viewClip.infinite,
      rawPath: rawClip.path,
      attached: viewClip.inline,
      positioned: Number.isFinite(viewClip.start) && Number.isFinite(viewClip.duration),
      standalone: !viewClip.inline,
      label: viewClip.label.length > 0 ? viewClip.label : rawClip.path,
    })
    used.add(viewClip.registryKey)
  }

  // 第一遍：运行时 id 精确匹配。
  for (const rawClip of raw) {
    if (rawClip.id !== null) {
      const match = byId.get(rawClip.id)
      if (match !== undefined && !used.has(match.registryKey)) {
        attach(rawClip, match)
      }
    }
  }

  // 第二遍：同类型内按文档顺序兜底（id 缺失 / 重复 / 视图裁剪）。
  const remaining = viewClips.filter((item) => !used.has(item.registryKey))
  const leftover = raw.filter((item) => !resolved.has(item.path))
  const byType = new Map<string, ViewClip[]>()
  for (const item of remaining) {
    const bucket = byType.get(item.trackType) ?? []
    bucket.push(item)
    byType.set(item.trackType, bucket)
  }
  for (const rawClip of leftover) {
    const bucket = byType.get(rawClip.trackType)
    const match = bucket?.shift()
    if (match !== undefined) {
      attach(rawClip, match)
    } else {
      resolved.set(rawClip.path, {
        registryKey: rawClip.path,
        trackId: '',
        trackType: rawClip.trackType,
        start: 0,
        duration: 0,
        infinite: false,
        rawPath: rawClip.path,
        attached: false,
        positioned: false,
        standalone: !rawClip.inline,
        label: rawClip.path,
      })
    }
  }
  return resolved
}

function groupKeyOf(trackId: string, globalTime: number): string {
  return `${trackId}:${Math.round(globalTime / GROUP_EPSILON)}`
}

/** 把事件标记对齐到活片段几何，并按同轨同位置分组。 */
export function resolveMarkers(
  markers: readonly EventMarker[],
  root: JsonObject | null,
  view: ScriptView | null,
  clips: ClipListEntry[],
): EventMarkerView[] {
  const geometry = resolveClipGeometry(root, view, clips)
  return markers.map((marker) => {
    const clip = geometry.get(marker.clipKey)
    const attached = clip?.attached ?? false
    const positioned = clip?.positioned ?? false
    const standalone = clip?.standalone ?? !attached
    const start = clip?.start ?? 0
    const duration = clip?.duration ?? 0
    const infinite = clip?.infinite ?? false
    const registryKey = clip?.registryKey ?? marker.clipKey
    const trackId = clip?.trackId ?? ''
    // 取得到几何的片段（主轴行内或独立片段）按活起点重算全局时间：移动 / 缩放后跟随，局部时间不变。
    let globalTime = positioned ? start + marker.localTime : marker.globalTime
    // 片段缩短后超出时长的记录：位置钳到片段末尾并标红（运行时丢弃），不删除、不改局部时间。
    if (positioned && !infinite && duration > 0 && marker.localTime > duration) {
      globalTime = Math.max(0, start + duration - 1e-6)
    }
    // 取不到起点的记录不伪造位置：单独成组进无起点提示区，不参与横坐标聚合。
    const groupKey = positioned
      ? groupKeyOf(standalone ? 'standalone' : trackId, globalTime)
      : `unpositioned:${marker.clipKey}`
    return {
      marker,
      ref: marker.ref,
      refKey: recordRefKey(marker.ref),
      registryKey,
      trackId,
      trackType: marker.trackType,
      objectPath: marker.objectPath,
      start,
      duration,
      infinite,
      attached,
      positioned,
      standalone,
      sourceLabel: clip?.label ?? marker.clipKey,
      localTime: marker.localTime,
      globalTime,
      kind: marker.kind,
      label: marker.label,
      groupKey,
    }
  })
}

/** 聚合分组：同轨、全局时间落在容差内的标记合并；组内按局部时间升序。 */
export function groupMarkers(views: readonly EventMarkerView[]): EventMarkerGroup[] {
  const groups = new Map<string, EventMarkerGroup>()
  for (const view of views) {
    const existing = groups.get(view.groupKey)
    if (existing === undefined) {
      groups.set(view.groupKey, {
        key: view.groupKey,
        trackId: view.trackId,
        registryKey: view.registryKey,
        globalTime: view.globalTime,
        attached: view.attached,
        positioned: view.positioned,
        standalone: view.standalone,
        sourceLabel: view.sourceLabel,
        views: [view],
      })
      continue
    }
    existing.views.push(view)
    existing.globalTime = Math.min(existing.globalTime, view.globalTime)
    existing.attached = existing.attached && view.attached
    existing.positioned = existing.positioned && view.positioned
    existing.standalone = existing.standalone && view.standalone
  }
  const list = [...groups.values()]
  for (const group of list) {
    group.views.sort((left, right) => left.localTime - right.localTime)
  }
  list.sort((left, right) => left.globalTime - right.globalTime)
  return list
}

/** 该记录是否存在合法前置时间（时间为 0 的记录、取不到几何的记录无法通过 seek 预览）。 */
export function canPreview(view: EventMarkerView): boolean {
  return view.positioned && Number.isFinite(view.localTime) && view.localTime > 0
}

/**
 * 预览起始全局时间：seek 到事件之前一小段；片段末尾的记录退到末尾之前。
 * 仅在 `canPreview` 为真时调用。
 */
export function previewStartOf(view: EventMarkerView, lead: number = PREVIEW_LEAD): number {
  const raw = view.start + Math.max(0, view.localTime - lead)
  if (view.infinite || view.duration <= 0) {
    return Math.max(0, raw)
  }
  const clipEnd = view.start + view.duration
  return Math.min(Math.max(0, raw), Math.max(0, clipEnd - 1e-6))
}

/** 标记类型外观元数据（样式类 + 中文说明），面板渲染与自检共用。 */
export const MARKER_KIND_META: Record<EventMarkerKind, { label: string; styleClass: string }> = {
  command: { label: '命令 · 实心', styleClass: 'marker--command' },
  move: { label: '移动 · 空心', styleClass: 'marker--move' },
  both: { label: '命令 + 移动 · 双色', styleClass: 'marker--both' },
  placeholder: { label: '占位 · 虚线', styleClass: 'marker--placeholder' },
  extension: { label: '扩展事件 · 菱形', styleClass: 'marker--extension' },
  'over-duration': { label: '超时长 · 红色', styleClass: 'marker--over-duration' },
}
