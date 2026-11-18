/**
 * 玩家移动预演的纯模型（08-07）。
 *
 * 只读 EVENT 轨的 `Position` 目标（`EventRecord.Position`：`{x,z}` 绝对 / `{dx,dz}` 相对激活点），
 * 不解析 MOD_EVENT 的 `data`，也不提供执行入口。
 *
 * 源码事实：`EventClipRuntime.compile` 从 `objects.event` 逐条读记录、丢掉 `time > duration` 的记录；
 * 事件的片段局部时间就是记录的 `time`，全局时间 = 片段 `start_time` + 局部时间。
 */
import type { ScriptView, TrackViewEntry } from '../../../workbench/api/documents.ts'
import type { TransitionIssue } from '../transition/model.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { JsonObject } from '../../../core/doc/types.ts'

/** 到达判定（源码 `PlayerArrive` 的容差）：只在说明里出现，不用于推导。 */
export const ARRIVE_EPSILON = 0.05

/** 一个移动目标。 */
export interface PlayerTarget {
  index: number
  trackId: string
  trackName: string
  clipKey: string
  clipLabel: string
  /** 片段局部时间（秒）。 */
  localTime: number
  /** 全局时间 = 片段起点 + 局部时间。 */
  globalTime: number
  /** 记录在 `objects.event` 里的下标。 */
  recordIndex: number
  /** 记录写的是相对坐标（`{dx,dz}`）。 */
  relative: boolean
  /** 记录里的原始坐标。 */
  written: { x: number; z: number }
  /** 预览里的世界坐标（相对目标已叠加预览原点）。 */
  world: { x: number; z: number }
  /** 第一个目标是起点（anchor），其余是移动目标。 */
  role: 'anchor' | 'target'
}

/** 一段移动（anchor → 第一个目标，目标 → 下一个目标）。 */
export interface PlayerSegment {
  index: number
  from: PlayerTarget
  to: PlayerTarget
  startTime: number
  endTime: number
  distance: number
}

/** 画布包围盒（世界坐标）。 */
export interface PlayerBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 预演结果。 */
export interface PlayerRouteView {
  emptyKind: 'no-event-track' | 'no-position' | 'single-target' | 'ready'
  /** 是否有 EVENT 轨。 */
  hasEventTrack: boolean
  /** 是否有 MOD_EVENT 轨。 */
  hasModEventTrack: boolean
  /** MOD_EVENT 轨里出现了 `position`（仍不解析，只提示）。 */
  modEventHasPosition: boolean
  /** 预览原点（`null` = 会话里还没有，使用 (0,0) 并标 `originUsed=false`）。 */
  origin: { x: number; z: number }
  /** 原点是否是会话里存的值。 */
  originStored: boolean
  targets: PlayerTarget[]
  segments: PlayerSegment[]
  /** 是否会产生移动（至少两个目标）。 */
  producesMovement: boolean
  /** 被丢弃的记录数（超界 / 目标无效 / 非有限时间）。 */
  dropped: number
  /** 记录里没有 `position` 的记录数（不画，但不算错误）。 */
  withoutPosition: number
  bounds: PlayerBounds
  issues: TransitionIssue[]
}

/** 读事件轨的属性行（`{ keyframes: [{time, value}] }`；不是数组 = 空）。 */
function recordFrames(objects: JsonObject | null, path: string): unknown[] {
  if (objects === null) {
    return []
  }
  const raw = objects[path]
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return []
  }
  return raw.keyframes
}
/** 记录体是否为 `{x,z}`（绝对）。 */
function readAbsolute(body: JsonObject): { x: number; z: number } | null {
  const x = body.x
  const z = body.z
  if (typeof x === 'number' && Number.isFinite(x) && typeof z === 'number' && Number.isFinite(z)) {
    return { x, z }
  }
  return null
}

/** 记录体是否为 `{dx,dz}`（相对激活点）。 */
function readRelative(body: JsonObject): { x: number; z: number } | null {
  const dx = body.dx
  const dz = body.dz
  if (typeof dx === 'number' && Number.isFinite(dx) && typeof dz === 'number' && Number.isFinite(dz)) {
    return { x: dx, z: dz }
  }
  return null
}

/** 一条待收集的原始记录。 */
interface RawRecord {
  track: TrackViewEntry
  clip: TrackViewEntry['clips'][number]
  clipIndex: number
  recordIndex: number
  localTime: number
  relative: boolean
  written: { x: number; z: number }
}

/** 收集 EVENT 轨的 Position 记录（不做时间排序）。 */
function collectRecords(
  tracks: readonly TrackViewEntry[],
  objectsOf: (clipKey: string) => JsonObject | null,
): { records: RawRecord[]; dropped: number; withoutPosition: number } {
  const records: RawRecord[] = []
  let dropped = 0
  let withoutPosition = 0
  for (const track of tracks) {
    if (track.type !== 'EVENT') {
      continue
    }
    for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex += 1) {
      const clip = track.clips[clipIndex]
      const objects = objectsOf(clip.clipKey)
      const raw = recordFrames(objects, 'event')
      if (raw.length === 0) {
        continue
      }
      for (let recordIndex = 0; recordIndex < raw.length; recordIndex += 1) {
        const frame = raw[recordIndex]
        if (!isJsonObject(frame)) {
          dropped += 1
          continue
        }
        const time = frame.time
        if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
          dropped += 1
          continue
        }
        // 运行时：`time > duration` 的记录在编译期丢弃（无限片段不丢）。
        if (!clip.infinite && time > clip.duration + 1e-6) {
          dropped += 1
          continue
        }
        const body = isJsonObject(frame.value) ? frame.value : null
        if (body === null) {
          dropped += 1
          continue
        }
        const position = isJsonObject(body.position) ? body.position : null
        const absolute = position === null ? null : readAbsolute(position)
        const relative = absolute === null && position !== null ? readRelative(position) : null
        if (absolute === null && relative === null) {
          withoutPosition += 1
          continue
        }
        records.push({
          track,
          clip,
          clipIndex,
          recordIndex,
          localTime: time,
          relative: absolute === null,
          written: absolute ?? relative ?? { x: 0, z: 0 },
        })
      }
    }
  }
  return { records, dropped, withoutPosition }
}

/** MOD_EVENT 轨是否出现了 `position`（只用于静态说明）。 */
function modEventHasPosition(
  tracks: readonly TrackViewEntry[],
  objectsOf: (clipKey: string) => JsonObject | null,
): boolean {
  for (const track of tracks) {
    if (track.type !== 'MOD_EVENT') {
      continue
    }
    for (const clip of track.clips) {
      const objects = objectsOf(clip.clipKey)
      const raw = recordFrames(objects, 'mod_event')
      if (raw.length === 0) {
        continue
      }
      for (const frame of raw) {
        if (isJsonObject(frame) && isJsonObject(frame.value)) {
          const position = frame.value.position
          if (isJsonObject(position) && Object.keys(position).some((key) => key === 'x' || key === 'z' || key === 'dx' || key === 'dz')) {
            return true
          }
        }
      }
    }
  }
  return false
}

/** 包围盒（含原点，给画布留边由视图处理）。 */
function boundsOf(origin: { x: number; z: number }, targets: readonly PlayerTarget[]): PlayerBounds {
  let minX = origin.x
  let maxX = origin.x
  let minZ = origin.z
  let maxZ = origin.z
  for (const target of targets) {
    minX = Math.min(minX, target.world.x)
    maxX = Math.max(maxX, target.world.x)
    minZ = Math.min(minZ, target.world.z)
    maxZ = Math.max(maxZ, target.world.z)
  }
  return { minX, maxX, minZ, maxZ }
}

/** 两个世界坐标的距离。 */
function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

/** 由记录生成移动线段。 */
function segmentsOf(targets: readonly PlayerTarget[]): PlayerSegment[] {
  const segments: PlayerSegment[] = []
  for (let index = 1; index < targets.length; index += 1) {
    const from = targets[index - 1]
    const to = targets[index]
    segments.push({
      index: index - 1,
      from,
      to,
      startTime: from.globalTime,
      endTime: to.globalTime,
      distance: distance(from.world, to.world),
    })
  }
  return segments
}

/** 主入口：脚本视图 + 片段对象读取 + 预览原点 → 预演路线。 */
export function buildPlayerRoute(input: {
  view: ScriptView | null
  objectsOf: (clipKey: string) => JsonObject | null
  /** 会话里存的预览原点（`docKey + trackId`）；`null` = 还没有。 */
  origin: { x: number; z: number } | null
  /** 脚本级 `meta`（只用宏循环开关做说明）。 */
  meta: JsonObject | null
}): PlayerRouteView {
  const tracks = input.view === null ? [] : input.view.tracks
  const hasEventTrack = tracks.some((track) => track.type === 'EVENT')
  const hasModEventTrack = tracks.some((track) => track.type === 'MOD_EVENT')
  const modPosition = modEventHasPosition(tracks, input.objectsOf)
  const storedOrigin = input.origin
  const origin = storedOrigin ?? { x: 0, z: 0 }
  const collected = collectRecords(tracks, input.objectsOf)
  const issues: TransitionIssue[] = []

  const meta = input.meta
  if (meta !== null && meta.macro_loop === true) {
    issues.push({
      severity: 'info',
      code: 'player.macro-loop',
      message: '脚本开启宏循环：每圈折返后玩家回到第一段起点，预演只画一圈',
    })
  }

  if (!hasEventTrack) {
    return {
      emptyKind: 'no-event-track',
      hasEventTrack: false,
      hasModEventTrack,
      modEventHasPosition: modPosition,
      origin,
      originStored: storedOrigin !== null,
      targets: [],
      segments: [],
      producesMovement: false,
      dropped: collected.dropped,
      withoutPosition: collected.withoutPosition,
      bounds: boundsOf(origin, []),
      issues,
    }
  }

  if (input.view === null || collected.records.length === 0) {
    if (storedOrigin === null) {
      issues.push({
        severity: 'info',
        code: 'player.origin-default',
        message: '会话里还没有预览原点，暂以 (0,0) 作为原点',
      })
    }
    return {
      emptyKind: 'no-position',
      hasEventTrack: true,
      hasModEventTrack,
      modEventHasPosition: modPosition,
      origin,
      originStored: storedOrigin !== null,
      targets: [],
      segments: [],
      producesMovement: false,
      dropped: collected.dropped,
      withoutPosition: collected.withoutPosition,
      bounds: boundsOf(origin, []),
      issues,
    }
  }

  // 全局时间排序：时间 → 轨道顺序 → 片段顺序 → 记录下标。
  const trackOrder = new Map<string, number>()
  for (const track of tracks) {
    trackOrder.set(track.trackId, track.index)
  }
  const sorted = [...collected.records].sort((left, right) => {
    const byTrack = (trackOrder.get(left.track.trackId) ?? 0) - (trackOrder.get(right.track.trackId) ?? 0)
    if (byTrack !== 0) {
      return byTrack
    }
    const leftGlobal = left.clip.start + left.localTime
    const rightGlobal = right.clip.start + right.localTime
    if (leftGlobal !== rightGlobal) {
      return leftGlobal - rightGlobal
    }
    if (left.clipIndex !== right.clipIndex) {
      return left.clipIndex - right.clipIndex
    }
    return left.recordIndex - right.recordIndex
  })

  const targets: PlayerTarget[] = sorted.map((record, index) => ({
    index,
    trackId: record.track.trackId,
    trackName: record.track.name.length > 0 ? record.track.name : record.track.type,
    clipKey: record.clip.clipKey,
    clipLabel: record.clip.label,
    localTime: record.localTime,
    globalTime: record.clip.start + record.localTime,
    recordIndex: record.recordIndex,
    relative: record.relative,
    written: record.written,
    world: record.relative
      ? { x: origin.x + record.written.x, z: origin.z + record.written.z }
      : { x: record.written.x, z: record.written.z },
    role: index === 0 ? 'anchor' : 'target',
  }))

  const segments = segmentsOf(targets)

  if (storedOrigin === null) {
    issues.push({
      severity: 'info',
      code: 'player.origin-default',
      message: '会话里还没有预览原点，暂以 (0,0) 作为原点；可在地图上点一下设定原点',
    })
  } else {
    issues.push({
      severity: 'info',
      code: 'player.origin-preview',
      message: '预览原点只用于画布；运行时相对坐标以实际激活位置为原点',
    })
  }
  if (targets.length === 1) {
    issues.push({
      severity: 'info',
      code: 'player.single-target',
      message: '只有一个移动目标：没有可走的线段，actor 停在起点',
    })
  }
  if (collected.dropped > 0) {
    issues.push({
      severity: 'warning',
      code: 'player.dropped',
      message: `有 ${collected.dropped} 条记录被丢弃（超界 / 时间非法 / 目标无效），运行时同样不会触发`,
    })
  }
  if (collected.withoutPosition > 0) {
    issues.push({
      severity: 'info',
      code: 'player.no-position',
      message: `有 ${collected.withoutPosition} 条记录没有 position：不参与玩家移动`,
    })
  }
  if (modPosition) {
    issues.push({
      severity: 'warning',
      code: 'player.mod-event-position',
      message: 'MOD_EVENT 轨出现了 position：运行时只读 EVENT 的 Position，这条不会移动玩家',
    })
  }
  for (const target of targets) {
    const clip = sorted[target.index].clip
    if (clip.infinite) {
      issues.push({
        severity: 'info',
        code: 'player.infinite-clip',
        message: `片段「${target.clipLabel}」无限循环：其记录的全局时间会随循环重复，预演只画首次`,
        clipKey: target.clipKey,
      })
    }
  }
  if (segments.some((segment) => segment.distance <= ARRIVE_EPSILON)) {
    issues.push({
      severity: 'info',
      code: 'player.zero-distance',
      message: `存在距离不超过 ${ARRIVE_EPSILON}s 容差的线段（运行时视为已到达），预演仍画出来`,
    })
  }

  return {
    emptyKind: targets.length >= 2 ? 'ready' : 'single-target',
    hasEventTrack: true,
    hasModEventTrack,
    modEventHasPosition: modPosition,
    origin,
    originStored: storedOrigin !== null,
    targets,
    segments,
    producesMovement: targets.length >= 2,
    dropped: collected.dropped,
    withoutPosition: collected.withoutPosition,
    bounds: boundsOf(origin, targets),
    issues,
  }
}

/** 画布坐标：世界坐标 → 0..1 的归一化位置（y 轴为 z 轴，向下为正）。 */
export function projectPoint(
  bounds: PlayerBounds,
  point: { x: number; z: number },
): { u: number; v: number } {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6)
  return {
    u: (point.x - bounds.minX) / spanX,
    v: (point.z - bounds.minZ) / spanZ,
  }
}
