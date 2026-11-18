/**
 * 覆盖层层级与多轨规则（09-07）。
 *
 * 事实基准：
 * - `overlay/OverlayManager.java`：`addLayer` 后按 `zIndex` 升序稳定排序；越小越先绘制。
 * - `overlay/CanvasTransform.DEFAULT_Z_INDEX = 10`；`z_index` 是 OVERLAY 的 value-only 字段。
 * - `overlay/LetterboxLayer.java`：画幅层固定 z=0（唯一写死 z 的内置层）。
 * - `script/OverlayTrackPlayer.java#findActiveClip`：按片段文档顺序返回**第一个**活跃片段；
 *   同轨重叠时后一个不会建层。
 * - `script/LetterboxTrackPlayer.java#findActiveClip` 同口径。
 *
 * 编辑器层级预览是只读派生：不写文档、不建第二时钟、不显示相机轨。
 */
import type { ClipViewEntry, ScriptView, TrackViewEntry } from '../../workbench/api/documents.ts'
import type { JsonObject } from '../../core/doc/types.ts'
import { declaredLayerType, effectiveLayerType, explicitValue, isOverlayLayerType } from './layers.ts'
import type { OverlayLayerType } from './layers.ts'

/** 层级预览条目。 */
export interface LayerOrderEntry {
  clipKey: string
  trackType: string
  trackIndex: number
  clipIndex: number
  label: string
  /** OVERLAY 的层类型；LETTERBOX 为 `letterbox`。 */
  layerType: OverlayLayerType | 'letterbox'
  /** 显式 layer_type 原值（用于诊断非法值；缺失 = null）。 */
  declaredLayerType?: string | null
  /** 层级（LETTERBOX 固定 0）。 */
  zIndex: number
  /** 绘制顺序（0 = 最先绘制）。 */
  drawOrder: number
  /** 同一片段的 `path` / `text` 摘要（只读提示）。 */
  summary: string
  /** 供提示：该条目的编辑器来源。 */
  source: 'overlay' | 'letterbox'
}

/** 层级提示。 */
export interface LayerOrderWarning {
  kind: 'tie' | 'negative' | 'zero' | 'multi-letterbox' | 'invalid-layer-type' | 'same-track-overlap'
  message: string
  clipKeys: string[]
}

/** 活跃判定：`start <= t < start + duration`；无限 / 负时长 = `t >= start` 恒活跃。 */
export function clipActiveAt(clip: ClipViewEntry, time: number): boolean {
  if (clip.infinite || clip.duration < 0) {
    return time >= clip.start
  }
  return time >= clip.start && time < clip.start + clip.duration
}

/** 片段结束（无限 = `+Infinity`）。 */
export function clipEnd(clip: ClipViewEntry): number {
  if (clip.infinite || clip.duration < 0) {
    return Number.POSITIVE_INFINITY
  }
  return clip.start + clip.duration
}

/** 读 `z_index`（显式整数；缺失 / 非法 → 10）。 */
export function zIndexOf(objects: JsonObject): number {
  const explicit = explicitValue(objects, 'z_index')
  if (explicit.present && typeof explicit.value === 'number' && Number.isInteger(explicit.value)) {
    return explicit.value
  }
  return 10
}

/** 片段摘要（path / text 末段）。 */
function summaryOf(objects: JsonObject, layerType: OverlayLayerType): string {
  if (layerType === 'image') {
    const path = explicitValue(objects, 'path')
    return path.present && typeof path.value === 'string' && path.value !== '' ? path.value : '（未选择素材）'
  }
  if (layerType === 'subtitle') {
    const text = explicitValue(objects, 'text')
    if (!text.present || typeof text.value !== 'string' || text.value === '') {
      return '（空文本）'
    }
    const lines = text.value.split('\n')
    return lines.length > 1 ? `${lines[0]} …（${lines.length} 行）` : lines[0]
  }
  return '颜色层'
}

/** 收集播放头处活跃的 OVERLAY / LETTERBOX 片段（不含相机 / 音频等轨道）。 */
export function collectActiveLayers(
  view: ScriptView | null,
  playhead: number,
  readObjects: (clipKey: string) => JsonObject | null,
): LayerOrderEntry[] {
  if (view === null) {
    return []
  }
  const entries: LayerOrderEntry[] = []
  view.tracks.forEach((track, trackIndex) => {
    if (track.type !== 'OVERLAY' && track.type !== 'LETTERBOX') {
      return
    }
    // 运行时每轨只取文档顺序里的第一个活跃片段（`findActiveClip`）：后者重叠也不成层。
    const firstIndex = track.clips.findIndex((clip) => clipActiveAt(clip, playhead))
    if (firstIndex < 0) {
      return
    }
    const clip = track.clips[firstIndex]
    if (clip === undefined) {
      return
    }
    const clipIndex = firstIndex
    if (track.type === 'LETTERBOX') {
      entries.push({
        clipKey: clip.clipKey,
        trackType: track.type,
        trackIndex,
        clipIndex,
        label: clip.label,
        layerType: 'letterbox',
        zIndex: 0,
        drawOrder: 0,
        summary: '画幅黑边（固定 z=0）',
        source: 'letterbox',
      })
      return
    }
    const objects = readObjects(clip.clipKey)
    if (objects === null) {
      return
    }
    const layerType = effectiveLayerType(objects)
    entries.push({
      clipKey: clip.clipKey,
      trackType: track.type,
      trackIndex,
      clipIndex,
      label: clip.label,
      layerType,
      declaredLayerType: declaredLayerType(objects),
      zIndex: zIndexOf(objects),
      drawOrder: 0,
      summary: summaryOf(objects, layerType),
      source: 'overlay',
    })
  })

  // 稳定排序：z 升序 → 轨道索引 → 片段索引（与运行期「按 z 稳定排序 + 建层先后」同序）。
  entries.sort((left, right) =>
    left.zIndex - right.zIndex
      || left.trackIndex - right.trackIndex
      || left.clipIndex - right.clipIndex)
  entries.forEach((entry, index) => {
    entry.drawOrder = index
  })
  return entries
}

/** 层级提示（09-07 §4.1 / §4.2）。 */
export function layerOrderWarnings(entries: readonly LayerOrderEntry[]): LayerOrderWarning[] {
  const warnings: LayerOrderWarning[] = []
  const letterboxEntries = entries.filter((entry) => entry.source === 'letterbox')
  if (letterboxEntries.length > 1) {
    warnings.push({
      kind: 'multi-letterbox',
      message: `有 ${letterboxEntries.length} 条画幅轨同时活跃：每轨各一层、后加入者后绘制（可能叠加或互相覆盖）；推荐同一时刻只让一条画幅轨有活跃片段；脚本没有画幅方向 / 裁切字段，编辑器也不写这些键`,
      clipKeys: letterboxEntries.map((entry) => entry.clipKey),
    })
  }

  const overlayEntries = entries.filter((entry) => entry.source === 'overlay')
  for (const entry of overlayEntries) {
    if (entry.zIndex < 0) {
      warnings.push({
        kind: 'negative',
        message: `${entry.label}: z_index=${entry.zIndex} < 0，绘制在画幅黑边之下（会被黑边盖住）`,
        clipKeys: [entry.clipKey],
      })
    } else if (entry.zIndex === 0) {
      warnings.push({
        kind: 'zero',
        message: `${entry.label}: z_index=0 与画幅层同层；实际先后取决于加入顺序，编辑器不承诺固定顺序`,
        clipKeys: [entry.clipKey],
      })
    }
    if (entry.declaredLayerType !== undefined && entry.declaredLayerType !== null &&
      !isOverlayLayerType(entry.declaredLayerType)) {
      warnings.push({
        kind: 'invalid-layer-type',
        message: `${entry.label}: layer_type=${JSON.stringify(entry.declaredLayerType)} 非法，运行时不建层`,
        clipKeys: [entry.clipKey],
      })
    }
  }

  // 同层级：z_index 相同的覆盖层按建层先后（轨道 / 片段文档顺序）排列。
  const byZ = new Map<number, LayerOrderEntry[]>()
  for (const entry of overlayEntries) {
    const list = byZ.get(entry.zIndex) ?? []
    list.push(entry)
    byZ.set(entry.zIndex, list)
  }
  for (const [z, list] of byZ) {
    if (list.length > 1) {
      warnings.push({
        kind: 'tie',
        message: `z_index=${z} 有 ${list.length} 层：按加入顺序（${list.map((entry) => entry.label).join(' → ')}，靠前者在下）；编辑器只能按文档顺序给出这个顺序来源`,
        clipKeys: list.map((entry) => entry.clipKey),
      })
    }
  }
  return warnings
}

/** 同轨重叠区间：后者在该区间不建层（`findActiveClip` 取文档顺序第一个）。 */
export interface TrackOverlapRange {
  trackType: string
  trackId: string
  trackIndex: number
  start: number
  end: number
  /** 文档顺序靠前、实际会渲染的片段。 */
  winner: ClipViewEntry
  /** 被遮挡的后续片段（可能多个）。 */
  shadowed: ClipViewEntry[]
}

/** 计算一条轨道的全部重叠区间。 */
export function trackOverlapRanges(track: TrackViewEntry, trackIndex: number): TrackOverlapRange[] {
  const ranges: TrackOverlapRange[] = []
  const clips = track.clips
  for (let i = 0; i < clips.length; i += 1) {
    const first = clips[i]
    const firstEnd = clipEnd(first)
    for (let j = i + 1; j < clips.length; j += 1) {
      const second = clips[j]
      const start = Math.max(first.start, second.start)
      const end = Math.min(firstEnd, clipEnd(second))
      if (end > start) {
        const existing = ranges.find((range) => range.start === start && range.end === end)
        if (existing !== undefined) {
          existing.shadowed.push(second)
        } else {
          ranges.push({
            trackType: track.type,
            trackId: track.trackId,
            trackIndex,
            start,
            end,
            winner: first,
            shadowed: [second],
          })
        }
      }
    }
  }
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end)
}

/** 全部 OVERLAY / LETTERBOX 轨道的重叠区间。 */
export function overlayTrackOverlaps(view: ScriptView | null): TrackOverlapRange[] {
  if (view === null) {
    return []
  }
  const ranges: TrackOverlapRange[] = []
  view.tracks.forEach((track, index) => {
    if (track.type === 'OVERLAY' || track.type === 'LETTERBOX') {
      ranges.push(...trackOverlapRanges(track, index))
    }
  })
  return ranges.sort((left, right) => left.start - right.start)
}

/** 重叠提示文案（09-07 §4.3）。 */
export function overlapMessage(range: TrackOverlapRange): string {
  const names = range.shadowed.map((clip) => clip.label).join('、')
  return `${range.trackType} 轨 ${range.start.toFixed(2)}–${range.end.toFixed(2)}s 重叠：${range.winner.label} 先命中并建层，${names} 在该区间不会成层（后一个不成层）`
}

/** 只读层级预览快照（面板一次渲染用；不写盘）。 */
export interface LayerOrderSnapshot {
  playhead: number
  entries: LayerOrderEntry[]
  warnings: LayerOrderWarning[]
  overlaps: TrackOverlapRange[]
}

/** 构造播放头处的层级快照。 */
export function layerOrderSnapshot(
  view: ScriptView | null,
  playhead: number,
  readObjects: (clipKey: string) => JsonObject | null,
): LayerOrderSnapshot {
  const entries = collectActiveLayers(view, playhead, readObjects)
  return {
    playhead,
    entries,
    warnings: layerOrderWarnings(entries),
    overlaps: overlayTrackOverlaps(view),
  }
}
