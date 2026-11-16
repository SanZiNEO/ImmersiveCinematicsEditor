/**
 * `AnimObject` / `ObjectKeyframe` 的文档侧读写（03-02）。
 *
 * 与运行时同一口径：
 * - 属性对象只允许 `value` / `keyframes`，且至少一个；
 * - `mode=value` 禁止 keyframes；`mode=event` 必须非空 keyframes；`struct` 只能 value 且禁止 keyframes；
 * - 关键帧时间：有限、`>= 0`、严格递增（相等 / 倒序拒绝，不排序「帮忙」）；
 * - 超界帧保留（`time > duration` 不报错，编译期过滤）；
 * - 空 keyframes 仅 `animated` 允许；
 * - 必填对象：无 value、无范围内关键帧、且目录无默认值 → parser 拒绝。
 *
 * 本模块不做「整帧快照」、不跨属性插值、不补默认值。
 */
import type { FieldEntry } from '../schema/types.ts'
import { cloneJson, describe, isFiniteNumber, isJsonObject, memberPath } from './json.ts'
import { firstUnknownKey, PROPERTY_KEYS } from './keys.ts'
import { POSITION_AXIS_PATHS } from './path.ts'
import { pushProblem } from './problems.ts'
import type { AnimObjectShape, JsonObject, JsonValue, LocalProblem, ObjectKeyframe, Severity } from './types.ts'
import { checkValue } from './value.ts'

/** 读取上下文：片段时长决定「范围内关键帧」（必填判定）。 */
export interface AnimObjectContext {
  jsonPath: string
  /** 片段时长（秒）；负数 = 无限。 */
  duration: number
  infinite: boolean
}

export interface AnimObjectReadResult {
  /** 是否存在 parser 级（block）问题。 */
  ok: boolean
  object: AnimObjectShape
  problems: LocalProblem[]
}

/** 属性对象内一条问题的构造（code 与 L 编号对齐）。 */
function problem(
  problems: LocalProblem[],
  severity: Severity,
  code: string,
  message: string,
  jsonPath: string,
  extra: { keyframeTime?: number } = {},
): void {
  pushProblem(problems, severity, code, message, { jsonPath, ...extra })
}

/** 值失败 → severity：类型错误 parser 直接抛，枚举 / 范围 parser 接受但 validator 报。 */
function valueSeverity(kind: 'type' | 'enum' | 'range'): Severity {
  return kind === 'type' ? 'block' : 'error'
}

/** 关键帧数组是否含范围内帧（有限片段 `time <= duration`；无限执行全部有效）。 */
function hasEffectiveKeyframe(keyframes: readonly ObjectKeyframe[], duration: number, infinite: boolean): boolean {
  return keyframes.some((keyframe) => infinite || keyframe.time <= duration)
}

/** 形态读取的公共实现；`def` 存在时才做值 / 形态 / 必填检查。 */
function readProperty(
  def: FieldEntry | undefined,
  raw: JsonValue,
  ctx: AnimObjectContext,
): AnimObjectReadResult {
  const problems: LocalProblem[] = []
  if (!isJsonObject(raw)) {
    problem(problems, 'block', 'L11', '需要对象 {value?, keyframes?}', ctx.jsonPath)
    return { ok: false, object: {}, problems }
  }

  const unknown = firstUnknownKey(raw, PROPERTY_KEYS)
  if (unknown !== undefined) {
    problem(problems, 'block', 'L11', `未知成员 ${unknown}（只允许 value / keyframes）`, memberPath(ctx.jsonPath, unknown))
  }

  const hasValue = Object.prototype.hasOwnProperty.call(raw, 'value')
  const hasKeyframes = Object.prototype.hasOwnProperty.call(raw, 'keyframes')
  if (!hasValue && !hasKeyframes) {
    problem(problems, 'block', 'L11', '需要对象 {value?, keyframes?}', ctx.jsonPath)
    return { ok: false, object: {}, problems }
  }

  const object: AnimObjectShape = {}

  if (hasValue) {
    if (def !== undefined) {
      const check = checkValue(def, raw.value, { propertyPath: def.key })
      if (!check.ok) {
        problem(problems, valueSeverity(check.kind), 'L13', check.message, memberPath(ctx.jsonPath, 'value'))
      }
    }
    object.value = raw.value
  }

  let keyframes: ObjectKeyframe[] = []
  if (hasKeyframes) {
    if (def !== undefined && def.mode === 'value') {
      problem(problems, 'block', 'L12', 'mode=value 不允许 keyframes', memberPath(ctx.jsonPath, 'keyframes'))
    }
    if (def !== undefined && def.type === 'struct') {
      problem(problems, 'block', 'L17', 'struct 只允许 value（禁止 keyframes）', memberPath(ctx.jsonPath, 'keyframes'))
    }
    const framesRaw = raw.keyframes
    if (!Array.isArray(framesRaw)) {
      problem(problems, 'block', 'L14', 'keyframes 需要数组', memberPath(ctx.jsonPath, 'keyframes'))
    } else {
      let previous = Number.NEGATIVE_INFINITY
      for (let index = 0; index < framesRaw.length; index += 1) {
        const framePath = memberPath(ctx.jsonPath, `keyframes[${index}]`)
        const frame = framesRaw[index]
        if (!isJsonObject(frame)) {
          problem(problems, 'block', 'L14', '需要对象 {time, value}', framePath)
          continue
        }
        const frameUnknown = firstUnknownKey(frame, ['time', 'value'])
        if (frameUnknown !== undefined) {
          problem(problems, 'block', 'L14', `未知成员 ${frameUnknown}（只允许 time / value）`, memberPath(framePath, frameUnknown))
        }
        const timeRaw = frame.time
        let time: number | undefined
        if (!isFiniteNumber(timeRaw)) {
          problem(problems, 'block', 'L15', '必须为有限数字', memberPath(framePath, 'time'))
        } else if (timeRaw < 0) {
          problem(problems, 'block', 'L15', '不能为负数', memberPath(framePath, 'time'))
        } else if (index > 0 && timeRaw <= previous) {
          problem(
            problems,
            'block',
            'L15',
            `关键帧时间必须单调递增，前一帧: ${previous}`,
            memberPath(framePath, 'time'),
          )
        } else {
          time = timeRaw
        }
        if (isFiniteNumber(timeRaw)) {
          previous = timeRaw
        }

        const frameHasValue = Object.prototype.hasOwnProperty.call(frame, 'value')
        const frameValue: JsonValue = frameHasValue ? frame.value : null
        if (def !== undefined) {
          const valueCheck = checkValue(def, frameValue, { propertyPath: def.key })
          if (!valueCheck.ok) {
            problem(
              problems,
              valueSeverity(valueCheck.kind),
              'L16',
              valueCheck.message,
              memberPath(framePath, 'value'),
            )
          }
        }
        if (time !== undefined) {
          keyframes.push({ time, value: frameValue })
        }
      }
    }
    object.keyframes = keyframes
  }

  if (def !== undefined) {
    if (def.mode === 'event' && keyframes.length === 0) {
      problem(problems, 'block', 'L12', 'mode=event 必须有 keyframes', memberPath(ctx.jsonPath, 'keyframes'))
    }
    if (def.required && !hasValue && !hasEffectiveKeyframe(keyframes, ctx.duration, ctx.infinite) && !def.hasDefault) {
      problem(problems, 'block', 'L19', '必填对象没有值/关键帧/默认值', ctx.jsonPath)
    }
  }

  const ok = !problems.some((item) => item.severity === 'block')
  return { ok, object, problems }
}

/**
 * 只读形态：不解释字段声明（第三方 / 未知轨道用）。
 *
 * 仍检查运行时无条件的硬约束：成员白名单、至少一个、关键帧数组形态与时间规则。
 */
export function readAnimObjectShape(raw: JsonValue, ctx: AnimObjectContext): AnimObjectReadResult {
  return readProperty(undefined, raw, ctx)
}

/**
 * 读一个属性对象（`objects.<path>`），按 02 目录的 `FieldEntry` 做值 / 形态 / 必填检查。
 *
 * 返回的 `object` 只保留作者显式声明的键（`value` / `keyframes`），供编辑命令与无损写回使用。
 */
export function readAnimObject(def: FieldEntry, raw: JsonValue, ctx: AnimObjectContext): AnimObjectReadResult {
  return readProperty(def, raw, ctx)
}

/**
 * 写回一个属性对象：只写 `value` / `keyframes`，不补默认值、不裁剪显式值、不烘焙。
 *
 * 键是否存在即语义：`value: 0`、`keyframes: []`、`value: null` 都原样保留。
 */
export function writeAnimObject(object: AnimObjectShape): JsonObject {
  const out: JsonObject = {}
  if (Object.prototype.hasOwnProperty.call(object, 'value')) {
    out.value = cloneJson(object.value as JsonValue)
  }
  if (Object.prototype.hasOwnProperty.call(object, 'keyframes')) {
    const frames = object.keyframes ?? []
    out.keyframes = frames.map((frame) => ({ time: frame.time, value: cloneJson(frame.value) }))
  }
  return out
}

/** 关键帧定位容差（秒）：编辑器内部查找用，比路径端点的 1e-4 更紧。 */
const KEYFRAME_EPSILON = 1e-6

/** 找到与 `time` 匹配的关键帧下标（容差内取最近）；未命中返回 `-1`。 */
export function findKeyframeIndex(keyframes: readonly ObjectKeyframe[], time: number): number {
  let best = -1
  let bestDelta = Number.POSITIVE_INFINITY
  for (let index = 0; index < keyframes.length; index += 1) {
    const delta = Math.abs(keyframes[index].time - time)
    if (delta <= KEYFRAME_EPSILON && delta < bestDelta) {
      best = index
      bestDelta = delta
    }
  }
  return best
}

/**
 * 插入一帧：作者明确指定时间时使用。
 *
 * 与既有帧时间相等 → 抛错（同属性时间严格递增）；否则插到正确位置。
 * 只改这一个属性，不碰其它属性 / 整帧快照。
 */
export function insertKeyframe(
  keyframes: readonly ObjectKeyframe[],
  time: number,
  value: JsonValue,
): ObjectKeyframe[] {
  if (!isFiniteNumber(time) || time < 0) {
    throw new Error(`关键帧时间必须是非负有限数字，实际: ${describe(time as JsonValue)}`)
  }
  if (findKeyframeIndex(keyframes, time) >= 0) {
    throw new Error(`关键帧时间已存在: ${time}（同属性时间必须严格递增）`)
  }
  const next = [...keyframes, { time, value: cloneJson(value) }]
  next.sort((left, right) => left.time - right.time)
  return next
}

/** 删除一帧（按时间定位）；未命中 → 抛错。 */
export function removeKeyframe(keyframes: readonly ObjectKeyframe[], time: number): ObjectKeyframe[] {
  const index = findKeyframeIndex(keyframes, time)
  if (index < 0) {
    throw new Error(`关键帧不存在: ${time}`)
  }
  return keyframes.filter((_, current) => current !== index)
}

/**
 * 移动一帧到新时间：目标时间与其它帧相等 → 抛错（不静默覆盖）。
 * 返回值按时间升序（移动是作者命令的结果，不是自动排序）。
 */
export function moveKeyframe(
  keyframes: readonly ObjectKeyframe[],
  fromTime: number,
  toTime: number,
): ObjectKeyframe[] {
  const index = findKeyframeIndex(keyframes, fromTime)
  if (index < 0) {
    throw new Error(`关键帧不存在: ${fromTime}`)
  }
  if (!isFiniteNumber(toTime) || toTime < 0) {
    throw new Error(`目标时间必须是非负有限数字，实际: ${describe(toTime as JsonValue)}`)
  }
  const other = findKeyframeIndex(keyframes, toTime)
  if (other >= 0 && other !== index) {
    throw new Error(`目标时间已有其它关键帧: ${toTime}（同属性时间必须严格递增）`)
  }
  const moved = keyframes.map((frame, current) => (current === index ? { ...frame, time: toTime } : frame))
  moved.sort((left, right) => left.time - right.time)
  return moved
}

/**
 * 目标片段的位置节点时间：`position.x/y/z` 关键帧时间的并集（升序、去重）。
 * 与 `PathCollectionParser.positionNodeTimes` 同一口径。
 */
export function positionNodeTimes(objects: Readonly<Record<string, AnimObjectShape>>): number[] {
  const times: number[] = []
  for (const path of POSITION_AXIS_PATHS) {
    const property = objects[path]
    if (property === undefined) {
      continue
    }
    for (const keyframe of property.keyframes ?? []) {
      times.push(keyframe.time)
    }
  }
  times.sort((left, right) => left - right)
  return times.filter((time, index) => index === 0 || time !== times[index - 1])
}
