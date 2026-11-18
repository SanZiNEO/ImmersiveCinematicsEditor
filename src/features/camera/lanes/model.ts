/**
 * 08-04 lane 视图模型（纯函数）。
 *
 * 运行时每帧从活跃 CAMERA 片段算出 lane 快照；编辑器只解释「当前播放头会产出哪些 lane」：
 * 顺序、来源、角色、区间、合成摘要、调色归属与覆盖链标记。不求值曲线、不采样画面、不读写运行时对象。
 */
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject } from '../../../core/doc/json.ts'
import {
  CAMERA_TRACK_TYPE,
  COMPOSITE_PATHS,
  buildCrossfadeView,
  buildParamView,
  buildWindow,
  readNumberPath,
  readStringPath,
} from '../transition/model.ts'
import type { TransitionBoundary, TransitionIssue } from '../transition/model.ts'
import type { ClipViewEntry, TrackViewEntry } from '../../../workbench/api/documents.ts'

const EPSILON = 1e-6

/** 覆盖链四档位（只列档位，不推断当前赢家）。 */
export const COVER_CHAIN_TIERS = [
  { id: 'external', label: '外部接管' },
  { id: 'flight', label: '飞行取景' },
  { id: 'editor', label: '编辑器直控' },
  { id: 'script', label: '脚本导演（默认来源）' },
] as const

/** lane 角色：只有三种（「最上层」是层级徽标，不是角色）。 */
export type LaneRole = 'single' | 'morph' | 'crossfade'

/** lane 角色文案。 */
export const LANE_ROLE_LABELS: Readonly<Record<LaneRole, string>> = {
  single: '单片段',
  morph: 'morph',
  crossfade: '叠化',
}

/** 一件合成参数摘要。 */
export interface SummaryValue {
  /** 展示文案（静态值 / 动画帧数）。 */
  text: string
  /** 是否为动画（有动画才给「效果」入口）。 */
  animated: boolean
  /** 涉及的路径（定位到效果面板用）。 */
  paths: string[]
}

/** 一条 lane 的合成摘要。 */
export interface CompositeSummary {
  opacity: SummaryValue
  dest: SummaryValue
  source: SummaryValue
  mask: SummaryValue
  dimension: SummaryValue
}

/** 一条 lane 视图。 */
export interface LaneView {
  /** 序号：最下层 0。 */
  index: number
  clipKey: string
  clipId?: string
  label: string
  role: LaneRole
  /** 是否最上层。 */
  top: boolean
  /** lane 区间（全局秒；无限片段末端为 `null`）。 */
  start: number
  end: number | null
  /** 交界时刻（morph / 叠化才有）。 */
  boundaryTime: number | null
  /** morph 窗口。 */
  windowStart: number | null
  windowEnd: number | null
  /** 叠化重叠区。 */
  overlapStart: number | null
  overlapEnd: number | null
  /** morph 行的出场片段（`A → B` 的 A）。 */
  fromLabel: string | null
  summary: CompositeSummary
  /** 调色归属片段（= lane 来源片段）。 */
  colorOwner: string
  /** 该片段是否声明了 `suppress_modifiers`。 */
  suppressModifiers: boolean
  /** 只在运行时才可用的标记（目标可用性等）。 */
  runtimeOnly: boolean
}

/** lane 视图 + 提示。 */
export interface LaneDocumentView {
  /** 播放头时刻。 */
  playhead: number
  lanes: LaneView[]
  issues: TransitionIssue[]
  /** 空态代号：`no-camera` / `gap` / `morph-tail` / `crossfade-invalid` / `none`。 */
  emptyKind: 'none' | 'no-camera' | 'gap' | 'morph-tail' | 'crossfade-invalid' | 'no-active'
  trackCount: number
}

/** 读关键帧数量（不是数组 = 0）。 */
function frameCount(objects: JsonObject, path: string): number {
  const raw = objects[path]
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return 0
  }
  return raw.keyframes.length
}

/** 单数值摘要。 */
function numberSummary(objects: JsonObject, path: string, fallback: number): SummaryValue {
  const frames = frameCount(objects, path)
  if (frames > 0) {
    return { text: `动画 ${frames} 帧`, animated: true, paths: [path] }
  }
  return { text: String(readNumberPath(objects, path, fallback)), animated: false, paths: [path] }
}

/** 矩形摘要（四数一组，归一化）。 */
function rectSummary(
  objects: JsonObject,
  x: string,
  y: string,
  w: string,
  h: string,
): SummaryValue {
  const frames = frameCount(objects, x) + frameCount(objects, y) + frameCount(objects, w) + frameCount(objects, h)
  if (frames > 0) {
    return { text: `动画 ${frames} 帧`, animated: true, paths: [x, y, w, h] }
  }
  const values = [
    readNumberPath(objects, x, 0),
    readNumberPath(objects, y, 0),
    readNumberPath(objects, w, 1),
    readNumberPath(objects, h, 1),
  ]
  return { text: values.map((value) => String(Math.round(value * 1000) / 1000)).join(', '), animated: false, paths: [x, y, w, h] }
}

/** 遮罩摘要：`mask_shape` +（非 full 时）几何。 */
function maskSummary(objects: JsonObject): SummaryValue {
  const shape = readStringPath(objects, COMPOSITE_PATHS.maskShape, 'full')
  if (shape === 'full') {
    return { text: 'full', animated: false, paths: [COMPOSITE_PATHS.maskShape] }
  }
  const geometryPaths = [
    COMPOSITE_PATHS.maskX,
    COMPOSITE_PATHS.maskY,
    COMPOSITE_PATHS.maskWidth,
    COMPOSITE_PATHS.maskHeight,
    COMPOSITE_PATHS.maskRadius,
  ]
  const frames = geometryPaths.reduce((total, path) => total + frameCount(objects, path), 0)
  if (frames > 0) {
    return { text: `${shape} · 动画 ${frames} 帧`, animated: true, paths: [COMPOSITE_PATHS.maskShape, ...geometryPaths] }
  }
  const geometry = [
    readNumberPath(objects, COMPOSITE_PATHS.maskX, 0.5),
    readNumberPath(objects, COMPOSITE_PATHS.maskY, 0.5),
    readNumberPath(objects, COMPOSITE_PATHS.maskWidth, 1),
    readNumberPath(objects, COMPOSITE_PATHS.maskHeight, 1),
    readNumberPath(objects, COMPOSITE_PATHS.maskRadius, 0.5),
  ].map((value) => String(Math.round(value * 1000) / 1000))
  return { text: `${shape} · ${geometry.join(', ')}`, animated: false, paths: [COMPOSITE_PATHS.maskShape, ...geometryPaths] }
}

/** 合成摘要五项（与属性面板同源：只读声明值与帧数）。 */
export function compositeSummary(objects: JsonObject): CompositeSummary {
  const dimensionFrames = frameCount(objects, COMPOSITE_PATHS.dimension)
  return {
    opacity: numberSummary(objects, COMPOSITE_PATHS.opacity, 1),
    dest: rectSummary(objects, COMPOSITE_PATHS.destX, COMPOSITE_PATHS.destY, COMPOSITE_PATHS.destW, COMPOSITE_PATHS.destH),
    source: rectSummary(
      objects,
      COMPOSITE_PATHS.sourceX,
      COMPOSITE_PATHS.sourceY,
      COMPOSITE_PATHS.sourceW,
      COMPOSITE_PATHS.sourceH,
    ),
    mask: maskSummary(objects),
    dimension:
      dimensionFrames > 0
        ? { text: `动画 ${dimensionFrames} 帧`, animated: true, paths: [COMPOSITE_PATHS.dimension] }
        : { text: readStringPath(objects, COMPOSITE_PATHS.dimension, '（空）'), animated: false, paths: [COMPOSITE_PATHS.dimension] },
  }
}

/** 是否声明抑制修饰符。 */
function declaresSuppress(objects: JsonObject): boolean {
  const raw = objects.suppress_modifiers
  return isJsonObject(raw) && raw.value === true
}

/** 一个 CAMERA 轨道上的片段（带原始 objects）。 */
export interface LaneClip {
  clipKey: string
  clipId?: string
  label: string
  index: number
  start: number
  duration: number
  infinite: boolean
  objects: JsonObject
}

/** 由只读视图 + objects 取数造 CAMERA 片段序列。 */
export function collectLaneClips(
  track: TrackViewEntry,
  objectsOf: (clipKey: string) => JsonObject | null,
): LaneClip[] {
  const clips: LaneClip[] = []
  for (let index = 0; index < track.clips.length; index += 1) {
    const clip: ClipViewEntry = track.clips[index]
    const objects = objectsOf(clip.clipKey)
    if (objects === null) {
      continue
    }
    clips.push({
      clipKey: clip.clipKey,
      ...(clip.clipId === undefined ? {} : { clipId: clip.clipId }),
      label: clip.label,
      index,
      start: clip.start,
      duration: clip.duration,
      infinite: clip.infinite,
      objects,
    })
  }
  return clips
}

/** 片段是否在播放头处活跃（左闭右开）。 */
function isActive(clip: LaneClip, playhead: number): boolean {
  if (playhead < clip.start - EPSILON) {
    return false
  }
  if (clip.infinite) {
    return true
  }
  return playhead < clip.start + clip.duration - EPSILON
}


/**
 * 一条轨道在播放头处的 lane 视图。
 *
 * 判定顺序照抄运行时：先找 morph 窗口（从后往前，后开始优先），命中只出一条 morph lane；
 * 否则取全部活跃片段各一条，再给符合叠化结构的上层片段标「叠化」角色。
 */export function buildLaneView(
  track: TrackViewEntry,
  clips: readonly LaneClip[],
  playhead: number,
): LaneDocumentView {
  const issues: TransitionIssue[] = []
  if (track.type !== CAMERA_TRACK_TYPE) {
    return { playhead, lanes: [], issues: [], emptyKind: 'no-camera', trackCount: 0 }
  }

  // 1) morph：从后往前找第一个命中窗口的出场片段。
  for (let index = clips.length - 1; index >= 0; index -= 1) {
    const clip = clips[index]
    if (clip.infinite || index + 1 >= clips.length) {
      continue
    }
    const boundaryTime = clip.start + clip.duration
    const param = buildParamView(
      {
        clipKey: clip.clipKey,
        trackId: track.trackId,
        trackIndex: track.index,
        clipIndex: index,
        start: clip.start,
        duration: clip.duration,
        loop: false,
        infinite: clip.infinite,
        label: clip.label,
        objects: clip.objects,
        opacityFrames: [],
        opacityStatic: null,
        internalLoop: false,
      },
      boundaryTime,
    )
    if (param.type !== 'morph') {
      continue
    }
    const window = buildWindow(
      {
        clipKey: clip.clipKey,
        trackId: track.trackId,
        trackIndex: track.index,
        clipIndex: index,
        start: clip.start,
        duration: clip.duration,
        loop: false,
        infinite: clip.infinite,
        label: clip.label,
        objects: clip.objects,
        opacityFrames: [],
        opacityStatic: null,
        internalLoop: false,
      },
      'morph',
      boundaryTime,
      param.channels,
    )
    if (window === null) {
      continue
    }
    if (playhead < window.start - EPSILON || playhead >= window.end - EPSILON) {
      continue
    }
    const entry = clips[index + 1]
    return {
      playhead,
      lanes: [
        {
          index: 0,
          clipKey: entry.clipKey,
          ...(entry.clipId === undefined ? {} : { clipId: entry.clipId }),
          label: entry.label,
          role: 'morph',
          top: true,
          start: window.start,
          end: window.end,
          boundaryTime,
          windowStart: window.start,
          windowEnd: window.end,
          overlapStart: null,
          overlapEnd: null,
          fromLabel: clip.label,
          summary: compositeSummary(entry.objects),
          colorOwner: entry.label,
          suppressModifiers: declaresSuppress(entry.objects),
          runtimeOnly: false,
        },
      ],
      issues: window.truncated
        ? [{
            severity: 'info',
            code: 'lane.morph-truncated',
            message: '参数过渡窗口被片段范围截断：窗口内仍只出一条 morph lane',
            clipKey: clip.clipKey,
          }]
        : [],
      emptyKind: 'none',
      trackCount: 1,
    }
  }

  // 2) 普通活跃片段：数组顺序即层序（靠后在上）。
  const active: LaneClip[] = clips.filter((clip) => isActive(clip, playhead))
  if (active.length === 0) {
    const tailMorph = clips.length > 0
      && clips[clips.length - 1].infinite === false
      && readStringPath(clips[clips.length - 1].objects, 'transition', 'cut') === 'morph'
    return {
      playhead,
      lanes: [],
      issues: tailMorph
        ? [{
            severity: 'info',
            code: 'lane.morph-tail',
            message: '末尾片段声明了 morph 但没有下一片段：不产生参数过渡 lane',
            clipKey: clips[clips.length - 1].clipKey,
          }]
        : [],
      emptyKind: tailMorph ? 'morph-tail' : 'gap',
      trackCount: 1,
    }
  }

  // 3) 叠化角色：相邻活跃对，满足全部结构条件才给上层标叠化。
  const integrated = new Set<string>()
  for (const clip of active) {
    const successor = clips[clip.index + 1]
    if (successor === undefined || !active.includes(successor) || successor.index !== clip.index + 1) {
      continue
    }
    const boundary = buildCrossfadeBoundary(clip, successor, track)
    if (boundary !== null) {
      integrated.add(successor.clipKey)
    } else if (successor.start < clip.start + clip.duration - EPSILON && !clip.infinite) {
      issues.push({
        severity: 'info',
        code: 'lane.crossfade-invalid',
        message: '当前重叠不满足叠化结构，按普通多 lane 显示',
        clipKey: successor.clipKey,
      })
    }
  }

  const lanes: LaneView[] = active.map((clip, order) => {
    const role: LaneRole = integrated.has(clip.clipKey) ? 'crossfade' : 'single'
    const end = clip.infinite ? null : clip.start + clip.duration
    return {
      index: order,
      clipKey: clip.clipKey,
      ...(clip.clipId === undefined ? {} : { clipId: clip.clipId }),
      label: clip.label,
      role,
      top: order === active.length - 1,
      start: clip.start,
      end,
      boundaryTime: null,
      windowStart: null,
      windowEnd: null,
      overlapStart: null,
      overlapEnd: null,
      fromLabel: null,
      summary: compositeSummary(clip.objects),
      colorOwner: clip.label,
      suppressModifiers: declaresSuppress(clip.objects),
      runtimeOnly: true,
    }
  })

  // 叠化行补充重叠区与两端不透明度说明。
  for (let order = 0; order < active.length; order += 1) {
    const lane = lanes[order]
    if (lane.role !== 'crossfade') {
      continue
    }
    const a = active[order - 1]
    const b = active[order]
    if (a === undefined) {
      continue
    }
    const duration = a.infinite ? 0 : Math.max(0, a.start + a.duration - b.start)
    lane.overlapStart = b.start
    lane.overlapEnd = a.start + a.duration
    lane.boundaryTime = a.start + a.duration
    lane.summary = {
      ...lane.summary,
      opacity: { text: `0 → 1（${Math.round(duration * 1000) / 1000}s 内）`, animated: true, paths: [COMPOSITE_PATHS.opacity] },
    }
  }

  const issueCodes = new Set(issues.map((issue) => issue.code))
  return {
    playhead,
    lanes,
    issues,
    emptyKind: issueCodes.has('lane.crossfade-invalid') ? 'crossfade-invalid' : 'none',
    trackCount: 1,
  }
}

/** 由叠化结构造边界（只为复用识别逻辑，返回 `null` 表示不成立）。 */
function buildCrossfadeBoundary(a: LaneClip, b: LaneClip, track: TrackViewEntry): TransitionBoundary | null {
  if (b.index !== a.index + 1 || a.infinite || b.infinite) {
    return null
  }
  const boundaryTime = a.start + a.duration
  if (b.start >= boundaryTime - EPSILON) {
    return null
  }
  const view = buildCrossfadeView(
    {
      clipKey: a.clipKey,
      ...(a.clipId === undefined ? {} : { clipId: a.clipId }),
      trackId: track.trackId,
      trackIndex: track.index,
      clipIndex: a.index,
      start: a.start,
      duration: a.duration,
      loop: false,
      infinite: a.infinite,
      label: a.label,
      objects: a.objects,
      opacityFrames: opacityFramesOf(a.objects),
      opacityStatic: opacityStaticOf(a.objects),
      internalLoop: false,
    },
    {
      clipKey: b.clipKey,
      ...(b.clipId === undefined ? {} : { clipId: b.clipId }),
      trackId: track.trackId,
      trackIndex: track.index,
      clipIndex: b.index,
      start: b.start,
      duration: b.duration,
      loop: false,
      infinite: b.infinite,
      label: b.label,
      objects: b.objects,
      opacityFrames: opacityFramesOf(b.objects),
      opacityStatic: opacityStaticOf(b.objects),
      internalLoop: false,
    },
    boundaryTime,
  )
  if (!view.identified || view.structural.length > 0) {
    return null
  }
  return {
    id: `${a.clipKey}->${b.clipKey}`,
    trackId: track.trackId,
    trackIndex: track.index,
    trackName: track.name,
    a: {
      clipKey: a.clipKey,
      trackId: track.trackId,
      trackIndex: track.index,
      clipIndex: a.index,
      start: a.start,
      duration: a.duration,
      loop: false,
      infinite: a.infinite,
      label: a.label,
      objects: a.objects,
      opacityFrames: opacityFramesOf(a.objects),
      opacityStatic: opacityStaticOf(a.objects),
      internalLoop: false,
    },
    b: {
      clipKey: b.clipKey,
      trackId: track.trackId,
      trackIndex: track.index,
      clipIndex: b.index,
      start: b.start,
      duration: b.duration,
      loop: false,
      infinite: b.infinite,
      label: b.label,
      objects: b.objects,
      opacityFrames: opacityFramesOf(b.objects),
      opacityStatic: opacityStaticOf(b.objects),
      internalLoop: false,
    },
    boundaryTime,
    layout: {
      aStart: a.start,
      aEnd: boundaryTime,
      bStart: b.start,
      bEnd: b.start + b.duration,
      boundaryTime,
      overlapStart: b.start,
      overlapEnd: boundaryTime,
      overlapDuration: boundaryTime - b.start,
    },
    crossfade: view,
    param: buildParamView(
      {
        clipKey: a.clipKey,
        trackId: track.trackId,
        trackIndex: track.index,
        clipIndex: a.index,
        start: a.start,
        duration: a.duration,
        loop: false,
        infinite: a.infinite,
        label: a.label,
        objects: a.objects,
        opacityFrames: opacityFramesOf(a.objects),
        opacityStatic: opacityStaticOf(a.objects),
        internalLoop: false,
      },
      boundaryTime,
    ),
    coexist: { coverage: 'none', morphStart: null, morphEnd: null, hasMorph: false, hasCrossfade: true },
    state: 'crossfade',
    issues: [],
  }
}

/** 读不透明度关键帧（lane 模型只需要帧数；叠化识别用 0 / 1 两端）。 */
function opacityFramesOf(objects: JsonObject): Array<{ time: number; value: JsonValue }> {
  const raw = objects[COMPOSITE_PATHS.opacity]
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return []
  }
  const frames: Array<{ time: number; value: JsonValue }> = []
  for (const frame of raw.keyframes) {
    if (isJsonObject(frame) && isFiniteNumber(frame.time)) {
      frames.push({ time: frame.time, value: frame.value as JsonValue })
    }
  }
  return frames
}

/** 读不透明度静态值。 */
function opacityStaticOf(objects: JsonObject): number | null {
  const raw = objects[COMPOSITE_PATHS.opacity]
  if (!isJsonObject(raw) || !Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return null
  }
  return isFiniteNumber(raw.value) ? raw.value : null
}
