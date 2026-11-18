/**
 * 作者态缓动存储（06-06 §4.2）：读写 `doc.clipAuthoring[clipKey].easing`。
 *
 * 键 = `${path}@${fromTime}-${toTime}`；值是 `{ mode, out, in, revision }`。
 * 只经 `DocStore.commitClipAuthoring` 写入（进撤销栈、不写盘）；
 * 读取走 `clipAuthoringOf`（副本），调用方不得缓存跨 revision 的值。
 *
 * 时间在键里用 `toFixed(6)` 归一，避免浮点尾数把同一段拆成两个键。
 */
import type { AuthoringState } from '../../core/doc/types.ts'
import type { AuthoringEasing, EasingMode, EasingHandle, SegmentView } from './types.ts'
import type { ObjectKeyframe } from '../../core/doc/types.ts'
import type { FieldInterp } from '../../core/schema/types.ts'

/** 缓动键。 */
export function easingKey(path: string, fromTime: number, toTime: number): string {
  return `${path}@${fromTime.toFixed(6)}-${toTime.toFixed(6)}`
}

/** 默认把手：先慢后快（ease-in-out 的常用形状），不假装是运行时默认值。 */
export const DEFAULT_EASING_HANDLES = {
  out: { x: 0.42, y: 0 },
  in: { x: 0.58, y: 1 },
} as const

/** 读一个片段的缓动表（副本）。 */
export function readEasingTable(state: AuthoringState): Record<string, AuthoringEasing> {
  const raw = state.easing
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const table: Record<string, AuthoringEasing> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const entry = value as Record<string, unknown>
    const mode = entry.mode === 'linear' || entry.mode === 'bezier' ? entry.mode : 'linear'
    table[key] = {
      clipKey: '',
      path: '',
      fromTime: 0,
      toTime: 0,
      mode,
      out: readHandle(entry.out),
      in: readHandle(entry.in),
      revision: typeof entry.revision === 'number' ? entry.revision : 0,
    }
  }
  return table
}

/** 读一个把手（缺失/非法退回默认）。 */
function readHandle(raw: unknown): EasingHandle {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { x: 0, y: 0 }
  }
  const entry = raw as Record<string, unknown>
  return {
    x: typeof entry.x === 'number' && Number.isFinite(entry.x) ? entry.x : 0,
    y: typeof entry.y === 'number' && Number.isFinite(entry.y) ? entry.y : 0,
  }
}

/** 写入/更新一段缓动的 mutate 载荷：直接传给 `commitClipAuthoring`。 */
export function writeEasingMutator(input: {
  path: string
  fromTime: number
  toTime: number
  mode: EasingMode
  out: EasingHandle
  in: EasingHandle
  revision: number
}): (state: AuthoringState) => void {
  return (state) => {
    const table = state.easing === undefined || state.easing === null || typeof state.easing !== 'object'
      || Array.isArray(state.easing)
      ? {}
      : state.easing as Record<string, unknown>
    table[easingKey(input.path, input.fromTime, input.toTime)] = {
      mode: input.mode,
      out: { ...input.out },
      in: { ...input.in },
      revision: input.revision,
    }
    state.easing = table
  }
}

/** 删除一段缓动的 mutate 载荷。 */
export function removeEasingMutator(path: string, fromTime: number, toTime: number): (state: AuthoringState) => void {
  return (state) => {
    const table = state.easing
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      return
    }
    delete (table as Record<string, unknown>)[easingKey(path, fromTime, toTime)]
    state.easing = table
  }
}

/** 清空一个属性的全部缓动（关闭动画 / 删空帧时用）。 */
export function clearPathEasingMutator(path: string): (state: AuthoringState) => void {
  return (state) => {
    const table = state.easing
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      return
    }
    const prefix = `${path}@`
    for (const key of Object.keys(table as Record<string, unknown>)) {
      if (key.startsWith(prefix)) {
        delete (table as Record<string, unknown>)[key]
      }
    }
    state.easing = table
  }
}

/** 删除失效段（节点增删/拖动后旧段消失）。 */
export function pruneInvalidEasingsMutator(
  frames: readonly ObjectKeyframe[],
): (state: AuthoringState) => void {
  return (state) => {
    const table = state.easing
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      return
    }
    const times = frames.map((frame) => frame.time)
    const alive = (time: number): boolean => times.some((item) => Math.abs(item - time) <= 1e-6)
    for (const key of Object.keys(table as Record<string, unknown>)) {
      const at = key.lastIndexOf('@')
      const range = key.slice(at + 1)
      const dash = range.indexOf('-')
      const from = Number(range.slice(0, dash))
      const to = Number(range.slice(dash + 1))
      if (!Number.isFinite(from) || !Number.isFinite(to) || !alive(from) || !alive(to)) {
        delete (table as Record<string, unknown>)[key]
      }
    }
    state.easing = table
  }
}

/** 从缓动表与节点数组派生一段的段视图（供缓动详情面板使用）。 */
export function segmentViewOf(input: {
  clipKey: string
  path: string
  interp: FieldInterp
  fromTime: number
  toTime: number
  easing: AuthoringEasing | undefined
}): SegmentView {
  const { clipKey, path, interp, fromTime, toTime, easing } = input
  return {
    clipKey,
    path,
    fromTime,
    toTime,
    interp,
    ...(easing === undefined ? {} : { easing }),
    baked: easing === undefined,
  }
}

/** 未烘焙段的路径与段数摘要（保存/推送前的提示用）。 */
export function unbakedSummary(
  states: Readonly<Record<string, AuthoringState>>,
): Array<{ clipKey: string; path: string; segments: number }> {
  const result: Array<{ clipKey: string; path: string; segments: number }> = []
  for (const [clipKey, state] of Object.entries(states)) {
    const table = readEasingTable(state)
    const byPath = new Map<string, number>()
    for (const key of Object.keys(table)) {
      const at = key.lastIndexOf('@')
      const path = key.slice(0, at)
      byPath.set(path, (byPath.get(path) ?? 0) + 1)
    }
    for (const [path, segments] of byPath) {
      result.push({ clipKey, path, segments })
    }
  }
  return result
}
