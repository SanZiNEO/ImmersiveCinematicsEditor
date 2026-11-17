/**
 * 片段级纯编辑函数（05-11）。
 *
 * - `splitClipObject`：把一个内联片段对象按时间切成左右两段；关键帧按属性组分配，
 *   右侧关键帧时间按分割偏移平移到新片段局部坐标；不补边界帧、不删窗口外帧。
 * - `compactStarts`：同组（调用方先按轨道分组）顺排后的新起点。
 * - `rippleShift`：波纹删除后同轨片段的累计左移。
 *
 * 这些函数只处理 JSON 形状，不读目录、不改会话；命令层负责校验与提交。
 */
import { cloneJson, isFiniteNumber, isJsonObject } from '../doc/json.ts'
import type { JsonObject, JsonValue } from '../doc/types.ts'

/** 片段 id 最大长度（`ClipIdentity.PATTERN`）。 */
const MAX_CLIP_ID_LENGTH = 64

/** 按属性组分配关键帧：局部时间 `t < splitOffset` 归左，`>= splitOffset` 归右；右侧再减偏移。 */
function partitionKeyframes(
  left: JsonObject,
  right: JsonObject,
  splitOffset: number,
): void {
  const leftObjects = isJsonObject(left.objects) ? left.objects : undefined
  const rightObjects = isJsonObject(right.objects) ? right.objects : undefined
  if (leftObjects === undefined || rightObjects === undefined) {
    return
  }
  for (const path of Object.keys(leftObjects)) {
    const leftProperty = leftObjects[path]
    const rightProperty = rightObjects[path]
    if (!isJsonObject(leftProperty) || !isJsonObject(rightProperty)) {
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(leftProperty, 'keyframes')) {
      continue
    }
    if (!Array.isArray(leftProperty.keyframes)) {
      continue
    }
    const frames = leftProperty.keyframes
    const leftFrames: JsonValue[] = []
    const rightFrames: JsonValue[] = []
    for (const frame of frames) {
      if (!isJsonObject(frame) || !isFiniteNumber(frame.time)) {
        continue
      }
      if (frame.time < splitOffset) {
        leftFrames.push(frame)
        continue
      }
      rightFrames.push({ ...frame, time: frame.time - splitOffset })
    }
    leftProperty.keyframes = leftFrames
    rightProperty.keyframes = rightFrames
  }
}

/** 默认新 id：保留 `_a` / `_b` 后缀并把总长度截到 64。 */
function defaultSplitId(base: string, suffix: 'a' | 'b'): string {
  const raw = `${base}_${suffix}`
  if (raw.length <= MAX_CLIP_ID_LENGTH) {
    return raw
  }
  return `${base.slice(0, MAX_CLIP_ID_LENGTH - 2)}_${suffix}`
}

/**
 * 分割一个内联片段对象。
 *
 * - 左：`start_time` 不变，`duration = splitTime - start`；
 * - 右：`start_time = splitTime`，`duration = oldEnd - splitTime`；
 * - 其他字段（track / loop / loop_count / loop_mode / exit / objects 的非关键帧值）复制；
 * - 原片段有 `id` 时，用 `newId('a' | 'b')` 生成两个新 id（默认 `id_a` / `id_b`，截断 64）；
 *   原片段没有 `id` 时两段都不写 `id`；
 * - 关键帧按属性组分配，右侧时间减 `splitTime - start`；不补帧。
 *
 * @throws RangeError `splitTime` 不在片段内部，或片段时长无法分割。
 */
export function splitClipObject(
  clip: JsonObject,
  splitTime: number,
  newId?: (suffix: 'a' | 'b') => string,
): { left: JsonObject; right: JsonObject } {
  const start = clip.start_time
  const duration = clip.duration
  if (!isFiniteNumber(start) || !isFiniteNumber(duration) || duration <= 0) {
    throw new RangeError('splitClipObject: 片段需要有限 start_time 与正 duration')
  }
  if (!isFiniteNumber(splitTime)) {
    throw new RangeError('splitClipObject: splitTime 需要有限数字')
  }
  const end = start + duration
  if (splitTime <= start || splitTime >= end) {
    throw new RangeError(`splitClipObject: splitTime=${splitTime} 不在 (${start}, ${end}) 内`)
  }

  const left = cloneJson(clip) as JsonObject
  const right = cloneJson(clip) as JsonObject
  const offset = splitTime - start
  left.start_time = start
  left.duration = offset
  right.start_time = splitTime
  right.duration = end - splitTime
  partitionKeyframes(left, right, offset)

  if (typeof clip.id === 'string' && clip.id.length > 0) {
    left.id = newId === undefined ? defaultSplitId(clip.id, 'a') : newId('a')
    right.id = newId === undefined ? defaultSplitId(clip.id, 'b') : newId('b')
  } else {
    delete left.id
    delete right.id
  }
  return { left, right }
}

/**
 * 顺排后的新起点：按 `start` 升序，首个保持组内最小 `start`，后续 `start = 前一 end`。
 *
 * 返回数组与输入同序（不重新排列输入本身）；调用方负责按轨道分组后再调用。
 */
export function compactStarts(clips: readonly { start: number; duration: number }[]): number[] {
  const result = clips.map((clip) => clip.start)
  if (clips.length === 0) {
    return result
  }
  const order = clips.map((_clip, index) => index)
  order.sort((left, right) => clips[left].start - clips[right].start || left - right)
  let cursor = clips[order[0]].start
  for (const index of order) {
    result[index] = cursor
    cursor += clips[index].duration
  }
  return result
}

/**
 * 波纹删除后的新起点：同轨后续片段（`start > deleted.start`）左移删除片段长度。
 *
 * 删除片段按 `start` 从后往前处理，位移累计；返回数组与输入同序。
 */
export function rippleShift(
  clips: readonly { start: number; duration: number }[],
  deleted: readonly { start: number; duration: number }[],
): number[] {
  const starts = clips.map((clip) => clip.start)
  const ordered = deleted
    .map((clip, index) => ({ clip, index }))
    .sort((left, right) => right.clip.start - left.clip.start || right.index - left.index)
  for (const { clip } of ordered) {
    const length = isFiniteNumber(clip.duration) ? Math.max(0, clip.duration) : 0
    if (length === 0) {
      continue
    }
    for (let index = 0; index < starts.length; index += 1) {
      if (starts[index] > clip.start) {
        starts[index] -= length
      }
    }
  }
  return starts
}
