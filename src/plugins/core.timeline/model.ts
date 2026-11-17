/**
 * `core.timeline` 的纯显示模型（05-10）。
 *
 * 只做「轨道标签 / 颜色 / 时间格式 / 片段查找」这类无副作用映射；
 * 几何计算全部来自 `src/core/timeline/geometry.ts`，不在这里复制一份。
 */
import type { ClipViewEntry, ScriptView, TrackViewEntry } from '../../workbench/api/documents.ts'
import { clipWindowEnd } from '../../core/timeline/geometry.ts'

/** 内置七型（02 `TrackSchemas`）。顺序就是「添加轨道」下拉的顺序。 */
export const BUILTIN_TRACK_TYPES = [
  'CAMERA',
  'LETTERBOX',
  'AUDIO',
  'EVENT',
  'MOD_EVENT',
  'OVERLAY',
  'ADJUST',
] as const

export type BuiltinTrackType = (typeof BUILTIN_TRACK_TYPES)[number]

/** 轨道显示名（05-10 表格）。 */
const TRACK_LABELS: Readonly<Record<string, string>> = {
  CAMERA: '镜头',
  LETTERBOX: '遮幅',
  AUDIO: '音频',
  EVENT: '事件',
  MOD_EVENT: '模组事件',
  OVERLAY: '叠加层',
  ADJUST: '调色',
}

/** 内置轨道的主题 token（04-07 `track.*`）。 */
const TRACK_COLORS: Readonly<Record<string, string>> = {
  CAMERA: 'var(--track-camera)',
  LETTERBOX: 'var(--track-letterbox)',
  AUDIO: 'var(--track-audio)',
  EVENT: 'var(--track-event)',
  MOD_EVENT: 'var(--track-mod_event)',
  OVERLAY: 'var(--track-overlay)',
  ADJUST: 'var(--track-adjust)',
}

/** 一个可添加的轨道类型（工具栏下拉 / 右键菜单用）。 */
export interface TrackTypeOption {
  type: string
  label: string
  disabled: boolean
  reason?: string
}

/** 右键菜单项（统一定制组件用）。 */
export interface TimelineMenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  /** 禁用原因；禁用时直接显示在菜单项下方，不只灰掉。 */
  reason?: string
  checked?: boolean
  danger?: boolean
  separator?: boolean
  /** 需要二次确认时的确认文案（空轨道删除）。 */
  confirmLabel?: string
}

/** 是否内置轨道类型。 */
export function isBuiltinTrackType(type: string): boolean {
  return (BUILTIN_TRACK_TYPES as readonly string[]).includes(type)
}

/** 轨道显示名；第三方未登记类型按 05-10 显示「未知轨道（type）」。 */
export function trackLabel(type: string, known?: boolean): string {
  const builtin = TRACK_LABELS[type]
  if (builtin !== undefined) {
    return builtin
  }
  if (known === false) {
    return `未知轨道（${type}）`
  }
  return type.length > 0 ? type : '未知轨道'
}

/** 轨道色：内置走专属 token，第三方按 type 稳定 hash 取 `--c1..--c6`。 */
export function trackColorVar(type: string): string {
  const builtin = TRACK_COLORS[type]
  if (builtin !== undefined) {
    return builtin
  }
  const index = stableHash(type) % 6
  return `var(--c${index + 1})`
}

/** 稳定字符串 hash（FNV-1a 32 位）；同一 type 永远同色，不随机。 */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 秒 → 一位小数文本（负值 / 非有限值不产生 NaN 文本）。 */
export function formatSeconds(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    return '0.0'
  }
  return value.toFixed(digits)
}

/** 片段的可见主体末端（无限片段返回 `start`，循环次数不参与块宽）。 */
export function clipBodyEnd(clip: ClipViewEntry): number {
  return clip.start + Math.max(0, clip.duration)
}

/** 片段窗口末端（循环展开；供显示范围 / 吸附使用，不用于块宽）。 */
export function clipExpandedEnd(clip: ClipViewEntry): number {
  return clipWindowEnd({
    start: clip.start,
    duration: clip.duration,
    loop: clip.loop,
    ...(clip.loopCount === undefined ? {} : { loopCount: clip.loopCount }),
  })
}

/** 按 `trackId` 取轨道。 */
export function findTrack(view: ScriptView | null, trackId: string): TrackViewEntry | undefined {
  return view?.tracks.find((track) => track.trackId === trackId)
}

/** 按 `clipKey` 取片段所属轨道与片段。 */
export function findClip(
  view: ScriptView | null,
  clipKey: string,
): { track: TrackViewEntry; clip: ClipViewEntry } | undefined {
  if (view === null) {
    return undefined
  }
  for (const track of view.tracks) {
    const clip = track.clips.find((entry) => entry.clipKey === clipKey)
    if (clip !== undefined) {
      return { track, clip }
    }
  }
  return undefined
}

/** 全部片段（文档顺序）。 */
export function flattenClips(view: ScriptView | null): Array<{ track: TrackViewEntry; clip: ClipViewEntry }> {
  const entries: Array<{ track: TrackViewEntry; clip: ClipViewEntry }> = []
  if (view === null) {
    return entries
  }
  for (const track of view.tracks) {
    for (const clip of track.clips) {
      entries.push({ track, clip })
    }
  }
  return entries
}

/** 可见轨道的片段键（Shift 区间选择按这个顺序）。 */
export function visibleClipKeys(
  view: ScriptView | null,
  isVisible: (trackId: string) => boolean,
): string[] {
  const keys: string[] = []
  if (view === null) {
    return keys
  }
  for (const track of view.tracks) {
    if (!isVisible(track.trackId)) {
      continue
    }
    for (const clip of track.clips) {
      keys.push(clip.clipKey)
    }
  }
  return keys
}

/** 片段块宽度：`max(24, duration*pps)`；无限画到显示末端。 */
export function clipWidthPx(clip: ClipViewEntry, pxPerSecond: number, displayEnd: number): number {
  if (clip.infinite || clip.duration < 0) {
    return Math.max(24, Math.max(0, displayEnd - clip.start) * pxPerSecond)
  }
  return Math.max(24, clip.duration * pxPerSecond)
}

/** 生成文档内唯一的片段 id（匹配 `^[A-Za-z0-9_]{1,64}$`）。 */
export function nextClipId(existing: ReadonlySet<string>, prefix = 'clip'): string {
  const stamp = Date.now().toString(36)
  for (let attempt = 0; attempt < 4096; attempt += 1) {
    const candidate = `${prefix}_${stamp}_${attempt.toString(36)}`
    if (!existing.has(candidate)) {
      return candidate.slice(0, 64)
    }
  }
  throw new Error('无法生成唯一的片段 id')
}
