/**
 * 命令对象与 `apply`（03-05）。
 *
 * 命令是**对象**（不是闭包）：`{ kind: 'object.addKeyframe', clipKey, path, time, value }`。
 * 每个命令只改 `doc`，不改 `session`；失败抛 `CommandError`，由 `commit` 统一回滚。
 *
 * 约束：
 * - 不自动生成 `clip.id`（添加引用前必须先让作者设置 id）；
 * - 不静默改指（改 id 同步引用是一次提交；删除被引用片段被阻止）；
 * - 补帧只由作者命令触发，不跨属性插值；
 * - 写值前按 02 目录严格检查，非法值直接拒绝。
 */
import type { CatalogIndex } from '../schema/index.ts'
import type { FieldEntry } from '../schema/types.ts'
import { readClip } from './clip.ts'
import type { ClipShape } from './clip.ts'
import { cloneJson, describe, isFiniteNumber, isJsonObject } from './json.ts'
import {
  ClipRegistry,
  canRemoveClip,
  pathEndpointsAtTime,
  pathIntervalsContaining,
  referenceSitesForRename,
  referencesToClip,
} from './identity.ts'
import type { ClipHandle } from './identity.ts'
import { CLIP_ID_PATTERN, LOOP_MODES, META_ID_PATTERN, META_AUTHOR_MAX, META_NAME_MAX } from './keys.ts'
import {
  insertKeyframe,
  moveKeyframe,
  removeKeyframe,
  writeAnimObject,
} from './object.ts'
import { isValidObjectPath } from './path.ts'
import type { AnimObjectShape, JsonObject, JsonValue, ObjectKeyframe, ScriptDoc } from './types.ts'
import { checkValue } from './value.ts'

/** 命令执行失败（由 `commit` 捕获并回滚）。 */
export class CommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

/** 一个编辑命令。 */
export type DocCommand =
  | { kind: 'meta.set'; key: string; value: JsonValue }
  | { kind: 'timeline.setLoop'; loopStart?: number | null; loopEnd?: number | null }
  | { kind: 'clip.add'; trackIndex: number; index?: number; clip: JsonObject }
  | { kind: 'clip.duplicate'; clipKey: string; newId?: string }
  | { kind: 'clip.remove'; clipKey: string }
  | { kind: 'clip.removeWithReferences'; clipKey: string }
  | { kind: 'clip.move'; clipKey: string; trackIndex: number; index: number }
  | { kind: 'clip.setStart'; clipKey: string; value: number }
  | { kind: 'clip.setDuration'; clipKey: string; value: number }
  | { kind: 'clip.setLoop'; clipKey: string; loop: boolean; loopCount?: number; loopMode?: string }
  | { kind: 'clip.setId'; clipKey: string; value: string; updateReferences: boolean }
  | { kind: 'object.setValue'; clipKey: string; path: string; value: JsonValue }
  | { kind: 'object.setKeyframes'; clipKey: string; path: string; keyframes: ObjectKeyframe[] }
  | { kind: 'object.addKeyframe'; clipKey: string; path: string; time: number; value: JsonValue }
  | { kind: 'object.removeKeyframe'; clipKey: string; path: string; time: number }
  | { kind: 'object.moveKeyframe'; clipKey: string; path: string; from: number; to: number }
  | { kind: 'object.remove'; clipKey: string; path: string }
  | { kind: 'path.remove'; pathId: string }
  | { kind: 'binding.remove'; bindingId: string }

/** `apply` 的上下文。 */
export interface ApplyContext {
  doc: ScriptDoc
  registry: ClipRegistry
  catalog: CatalogIndex
  metaKeys: readonly string[]
}

/** `apply` 的返回值：`warnings` 是不阻止提交的提示（如插入帧会切断路径端点相邻性）。 */
export interface ApplyResult {
  warnings: string[]
}

/** 取片段句柄；不存在 → 抛错。 */
function requireHandle(ctx: ApplyContext, clipKey: string): ClipHandle {
  const handle = ctx.registry.handle(clipKey)
  if (handle === undefined) {
    throw new CommandError(`片段不存在: ${clipKey}`)
  }
  return handle
}

/** 片段所在的数组（内联片段在轨道 clips；独立片段在 root.clips）。 */
function clipArray(ctx: ApplyContext, handle: ClipHandle): JsonValue[] {
  if (handle.inline) {
    const tracks = ctx.doc.timeline.tracks
    if (!Array.isArray(tracks)) {
      throw new CommandError('timeline.tracks 不是数组')
    }
    const track = tracks[handle.trackIndex]
    if (!isJsonObject(track) || !Array.isArray(track.clips)) {
      throw new CommandError(`轨道不存在: timeline.tracks[${handle.trackIndex}]`)
    }
    return track.clips
  }
  const clips = ctx.doc.root.clips
  if (!Array.isArray(clips)) {
    throw new CommandError('clips 不是数组')
  }
  return clips
}

/** 按片段句柄的轨道类型取对象声明；第三方轨道返回 `undefined`。 */
function objectDefOf(ctx: ApplyContext, handle: ClipHandle, path: string): FieldEntry | undefined {
  return ctx.catalog.objectDef(handle.trackType, path)
}

/** 严格读片段形状（命令写值前校验）；block 级问题 → 抛错。 */
function readShape(ctx: ApplyContext, handle: ClipHandle): ClipShape {
  const result = readClip(handle.clip, {
    inline: handle.inline,
    jsonPath: handle.inline
      ? `timeline.tracks[${handle.trackIndex}].clips[${handle.clipIndex}]`
      : `clips[${handle.clipIndex}]`,
    trackType: handle.trackType,
    catalog: ctx.catalog,
  })
  const blocking = result.problems.filter((problem) => problem.severity === 'block')
  if (blocking.length > 0) {
    throw new CommandError(`片段结构不合法: ${blocking.map((problem) => problem.message).join('；')}`)
  }
  return result.clip
}

/** 取 / 建一个属性对象（`objects.<path>`）。 */
function propertyOf(clip: JsonObject, path: string): JsonObject {
  const objects = clip.objects
  if (!isJsonObject(objects)) {
    throw new CommandError('片段缺少 objects 对象')
  }
  const existing = objects[path]
  if (isJsonObject(existing)) {
    return existing
  }
  if (existing !== undefined) {
    throw new CommandError(`属性 ${path} 不是对象`)
  }
  const created: JsonObject = {}
  objects[path] = created
  return created
}

/** 读一个属性对象的编辑视图（不含声明检查；值检查在写入前做）。 */
function animObjectOf(property: JsonObject): AnimObjectShape {
  const shape: AnimObjectShape = {}
  if (Object.prototype.hasOwnProperty.call(property, 'value')) {
    shape.value = property.value
  }
  if (Array.isArray(property.keyframes)) {
    const frames: ObjectKeyframe[] = []
    for (const frame of property.keyframes) {
      if (isJsonObject(frame) && isFiniteNumber(frame.time)) {
        frames.push({ time: frame.time, value: frame.value })
      }
    }
    shape.keyframes = frames
  }
  return shape
}

/** 把属性编辑视图写回片段（只写 value / keyframes）。 */
function writeProperty(clip: JsonObject, path: string, object: AnimObjectShape): void {
  const objects = clip.objects
  if (!isJsonObject(objects)) {
    throw new CommandError('片段缺少 objects 对象')
  }
  objects[path] = writeAnimObject(object)
}

/** 检查一个值是否可写入；不可写 → 抛错。第三方轨道（无声明）接受任意 JSON。 */
function assertValueWritable(
  def: FieldEntry | undefined,
  path: string,
  value: JsonValue,
  allowNull: boolean,
): void {
  if (def === undefined) {
    if (!allowNull && value === null) {
      throw new CommandError(`属性 ${path} 不接受 null（未登记路径）`)
    }
    return
  }
  const check = checkValue(def, value, { propertyPath: path })
  if (!check.ok) {
    throw new CommandError(`${path}: ${check.message}`)
  }
}

/** 属性是否允许关键帧（mode=value / struct 拒绝）。 */
function assertKeyframesAllowed(def: FieldEntry | undefined, path: string): void {
  if (def === undefined) {
    return
  }
  if (def.mode === 'value') {
    throw new CommandError(`${path}: mode=value 不允许 keyframes`)
  }
  if (def.type === 'struct') {
    throw new CommandError(`${path}: struct 只允许 value（禁止 keyframes）`)
  }
}

/** 检查关键帧数组：每帧值合法 + 时间严格递增（事件非空）。 */
function assertKeyframesWritable(
  def: FieldEntry | undefined,
  path: string,
  keyframes: readonly ObjectKeyframe[],
): void {
  assertKeyframesAllowed(def, path)
  let previous = Number.NEGATIVE_INFINITY
  for (let index = 0; index < keyframes.length; index += 1) {
    const frame = keyframes[index]
    if (!isFiniteNumber(frame.time) || frame.time < 0) {
      throw new CommandError(`${path}.keyframes[${index}].time: 需要非负有限数字`)
    }
    if (frame.time <= previous) {
      throw new CommandError(`${path}.keyframes[${index}].time: 关键帧时间必须单调递增，前一帧: ${previous}`)
    }
    previous = frame.time
    assertValueWritable(def, `${path}.keyframes[${index}].value`, frame.value, def?.type === 'nullable_float')
  }
  if (def !== undefined && def.mode === 'event' && keyframes.length === 0) {
    throw new CommandError(`${path}: mode=event 必须有 keyframes`)
  }
}

/** 删除数组元素（从后往前调用，避免索引漂移）。 */
function removeArrayEntries(array: JsonValue[], indexes: readonly number[]): void {
  for (const index of [...indexes].sort((left, right) => right - left)) {
    array.splice(index, 1)
  }
}

/** 命令实现：每个分支只改 `doc`，失败抛 `CommandError`。 */
export function applyCommand(ctx: ApplyContext, command: DocCommand): ApplyResult {
  const warnings: string[] = []
  switch (command.kind) {
    case 'meta.set': {
      if (!ctx.metaKeys.includes(command.key)) {
        throw new CommandError(`meta 未知字段: ${command.key}（可用: ${ctx.metaKeys.join(' / ')}）`)
      }
      if (command.key === 'id') {
        if (typeof command.value !== 'string' || !META_ID_PATTERN.test(command.value)) {
          throw new CommandError(`meta.id 必须匹配 ${META_ID_PATTERN.source}`)
        }
      }
      if (command.key === 'name') {
        if (typeof command.value !== 'string' || command.value.length === 0
          || command.value.length > META_NAME_MAX) {
          throw new CommandError(`meta.name 需要 1~${META_NAME_MAX} 字符`)
        }
      }
      if (command.key === 'author') {
        if (typeof command.value !== 'string' || command.value.length > META_AUTHOR_MAX) {
          throw new CommandError(`meta.author 需要字符串（最长 ${META_AUTHOR_MAX} 字符）`)
        }
      }
      ctx.doc.meta[command.key] = cloneJson(command.value)
      return { warnings }
    }
    case 'timeline.setLoop': {
      if (command.loopStart !== undefined) {
        if (command.loopStart === null) {
          delete ctx.doc.timeline.loop_start
        } else if (isFiniteNumber(command.loopStart)) {
          ctx.doc.timeline.loop_start = command.loopStart
        } else {
          throw new CommandError('loop_start 需要有限数字或 null')
        }
      }
      if (command.loopEnd !== undefined) {
        if (command.loopEnd === null) {
          delete ctx.doc.timeline.loop_end
        } else if (isFiniteNumber(command.loopEnd)) {
          ctx.doc.timeline.loop_end = command.loopEnd
        } else {
          throw new CommandError('loop_end 需要有限数字或 null')
        }
      }
      return { warnings }
    }
    case 'clip.add': {
      const tracks = ctx.doc.timeline.tracks
      if (!Array.isArray(tracks)) {
        throw new CommandError('timeline.tracks 不是数组')
      }
      const track = tracks[command.trackIndex]
      if (!isJsonObject(track) || !Array.isArray(track.clips)) {
        throw new CommandError(`轨道不存在: timeline.tracks[${command.trackIndex}]`)
      }
      const trackType = typeof track.type === 'string' ? track.type : ''
      const result = readClip(command.clip, {
        inline: true,
        jsonPath: `timeline.tracks[${command.trackIndex}].clips[${command.index ?? track.clips.length}]`,
        trackType,
        catalog: ctx.catalog,
      })
      const blocking = result.problems.filter((problem) => problem.severity === 'block')
      if (blocking.length > 0) {
        throw new CommandError(`新片段结构不合法: ${blocking.map((problem) => problem.message).join('；')}`)
      }
      const index = command.index ?? track.clips.length
      if (index < 0 || index > track.clips.length) {
        throw new CommandError(`插入位置越界: ${index}`)
      }
      const clip = cloneJson(command.clip)
      track.clips.splice(index, 0, clip)
      ctx.registry.assign(clip)
      return { warnings }
    }
    case 'clip.duplicate': {
      const handle = requireHandle(ctx, command.clipKey)
      const array = clipArray(ctx, handle)
      const source = handle.clip
      const copy = cloneJson(source)
      if (command.newId !== undefined) {
        if (!CLIP_ID_PATTERN.test(command.newId)) {
          throw new CommandError(`片段 id 不合法: ${command.newId}`)
        }
        const exists = ctx.registry.handles().some((item) => item.id === command.newId)
        if (exists) {
          throw new CommandError(`片段 id 已存在: ${command.newId}`)
        }
        copy.id = command.newId
      } else {
        delete copy.id
      }
      const index = handle.clipIndex + 1
      array.splice(index, 0, copy)
      ctx.registry.assign(copy)
      return { warnings }
    }
    case 'clip.remove': {
      const handle = requireHandle(ctx, command.clipKey)
      const check = canRemoveClip(ctx.doc, handle.id)
      if (!check.ok) {
        throw new CommandError(
          `片段被引用，不能删除（${check.references.map((reference) => reference.label).join('；')}）`,
        )
      }
      removeArrayEntries(clipArray(ctx, handle), [handle.clipIndex])
      return { warnings }
    }
    case 'clip.removeWithReferences': {
      const handle = requireHandle(ctx, command.clipKey)
      const references = handle.id === undefined ? [] : referencesToClip(ctx.doc, handle.id)
      const pathIndexes: number[] = []
      const bindingIndexes: number[] = []
      for (const reference of references) {
        if (reference.kind === 'path') {
          const index = reference.path[1]
          if (typeof index === 'number') {
            pathIndexes.push(index)
          }
          continue
        }
        if (reference.kind === 'binding' || reference.kind === 'schedule') {
          const index = reference.path[1]
          if (typeof index === 'number') {
            bindingIndexes.push(index)
          }
          continue
        }
        if (reference.kind === 'exit') {
          const exitHost = reference.path[0]
          if (exitHost === 'clips') {
            const clipIndex = reference.path[1]
            if (typeof clipIndex === 'number') {
              const clips = ctx.doc.root.clips
              if (Array.isArray(clips) && isJsonObject(clips[clipIndex])) {
                delete (clips[clipIndex] as JsonObject).exit
              }
            }
            continue
          }
          const bindingIndex = reference.path[1]
          if (typeof bindingIndex === 'number') {
            bindingIndexes.push(bindingIndex)
          }
          continue
        }
        throw new CommandError(
          `规则条件 / 动作引用无法自动删除，请先手动处理: ${reference.label}`,
        )
      }
      const paths = ctx.doc.root.paths
      if (Array.isArray(paths)) {
        removeArrayEntries(paths, pathIndexes)
      }
      const bindings = ctx.doc.root.rule_bindings
      if (Array.isArray(bindings)) {
        removeArrayEntries(bindings, bindingIndexes)
      }
      removeArrayEntries(clipArray(ctx, handle), [handle.clipIndex])
      return { warnings }
    }
    case 'clip.move': {
      const handle = requireHandle(ctx, command.clipKey)
      const source = clipArray(ctx, handle)
      const [clip] = source.splice(handle.clipIndex, 1)
      if (command.trackIndex === -1) {
        if (handle.inline) {
          throw new CommandError('内联片段不能移到独立片段表（没有 track 字段）')
        }
        const clips = ctx.doc.root.clips
        if (!Array.isArray(clips)) {
          throw new CommandError('clips 不是数组')
        }
        const index = Math.max(0, Math.min(command.index, clips.length))
        clips.splice(index, 0, clip)
        return { warnings }
      }
      const tracks = ctx.doc.timeline.tracks
      if (!Array.isArray(tracks)) {
        throw new CommandError('timeline.tracks 不是数组')
      }
      const targetTrack = tracks[command.trackIndex]
      if (!isJsonObject(targetTrack) || !Array.isArray(targetTrack.clips)) {
        throw new CommandError(`目标轨道不存在: timeline.tracks[${command.trackIndex}]`)
      }
      if (!handle.inline) {
        throw new CommandError('独立片段没有 start_time，不能移到时间轴轨道')
      }
      const index = Math.max(0, Math.min(command.index, targetTrack.clips.length))
      targetTrack.clips.splice(index, 0, clip)
      return { warnings }
    }
    case 'clip.setStart': {
      if (!isFiniteNumber(command.value)) {
        throw new CommandError('start_time 需要有限数字')
      }
      requireHandle(ctx, command.clipKey).clip.start_time = command.value
      return { warnings }
    }
    case 'clip.setDuration': {
      if (!isFiniteNumber(command.value) || command.value === 0) {
        throw new CommandError('duration 需要有限数字且不为 0（正数=有限时长，负数=无限时长）')
      }
      requireHandle(ctx, command.clipKey).clip.duration = command.value
      return { warnings }
    }
    case 'clip.setLoop': {
      const handle = requireHandle(ctx, command.clipKey)
      if (typeof command.loop !== 'boolean') {
        throw new CommandError('loop 需要布尔值')
      }
      handle.clip.loop = command.loop
      if (command.loopCount !== undefined) {
        if (!isFiniteNumber(command.loopCount) || !Number.isInteger(command.loopCount) || command.loopCount < -1) {
          throw new CommandError('loop_count 需要 >= -1 的整数（-1=无限循环）')
        }
        handle.clip.loop_count = command.loopCount
      }
      if (command.loopMode !== undefined) {
        if (!LOOP_MODES.includes(command.loopMode)) {
          throw new CommandError(`loop_mode 需要 ${LOOP_MODES.join(' / ')}`)
        }
        handle.clip.loop_mode = command.loopMode
      }
      return { warnings }
    }
    case 'clip.setId': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!CLIP_ID_PATTERN.test(command.value)) {
        throw new CommandError(`片段 id 不合法: ${command.value}（需匹配 ${CLIP_ID_PATTERN.source}）`)
      }
      const duplicate = ctx.registry.handles().some((item) => item.key !== handle.key && item.id === command.value)
      if (duplicate) {
        throw new CommandError(`片段 id 已存在: ${command.value}`)
      }
      const oldId = handle.id
      const references = oldId === undefined ? [] : referenceSitesForRename(ctx.doc, oldId)
      if (!command.updateReferences && references.length > 0) {
        throw new CommandError(
          `片段被引用，改 id 必须同步引用（${references.map((site) => site.jsonPath).join('；')}）`,
        )
      }
      handle.clip.id = command.value
      if (command.updateReferences) {
        for (const site of references) {
          setAtPath(ctx.doc.root, site.path, command.value)
        }
      }
      return { warnings }
    }
    case 'object.setValue': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!isValidObjectPath(command.path)) {
        throw new CommandError(`非法属性路径: ${command.path}`)
      }
      readShape(ctx, handle)
      const def = objectDefOf(ctx, handle, command.path)
      if (def === undefined && ctx.catalog.track(handle.trackType) !== undefined) {
        throw new CommandError(`未登记的对象路径: ${command.path}（轨道 ${handle.trackType}）`)
      }
      assertValueWritable(def, command.path, command.value, def?.type === 'nullable_float')
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      object.value = cloneJson(command.value)
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.setKeyframes': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!isValidObjectPath(command.path)) {
        throw new CommandError(`非法属性路径: ${command.path}`)
      }
      readShape(ctx, handle)
      const def = objectDefOf(ctx, handle, command.path)
      if (def === undefined && ctx.catalog.track(handle.trackType) !== undefined) {
        throw new CommandError(`未登记的对象路径: ${command.path}（轨道 ${handle.trackType}）`)
      }
      assertKeyframesWritable(def, command.path, command.keyframes)
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      object.keyframes = command.keyframes.map((frame) => ({ time: frame.time, value: cloneJson(frame.value) }))
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.addKeyframe': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!isValidObjectPath(command.path)) {
        throw new CommandError(`非法属性路径: ${command.path}`)
      }
      readShape(ctx, handle)
      const def = objectDefOf(ctx, handle, command.path)
      if (def === undefined && ctx.catalog.track(handle.trackType) !== undefined) {
        throw new CommandError(`未登记的对象路径: ${command.path}（轨道 ${handle.trackType}）`)
      }
      assertKeyframesAllowed(def, command.path)
      assertValueWritable(def, `${command.path}.keyframes`, command.value, def?.type === 'nullable_float')
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      const frames = object.keyframes ?? []
      object.keyframes = insertKeyframe(frames, command.time, command.value)
      writeProperty(handle.clip, command.path, object)
      const interruptions = handle.id === undefined
        ? []
        : pathIntervalsContaining(ctx.doc, handle.id, command.time)
      if (interruptions.length > 0) {
        warnings.push(`新帧 t=${command.time} 落在 ${interruptions.join('、')} 的端点区间内，会切断端点相邻性`)
      }
      return { warnings }
    }
    case 'object.removeKeyframe': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!isValidObjectPath(command.path)) {
        throw new CommandError(`非法属性路径: ${command.path}`)
      }
      readShape(ctx, handle)
      const def = objectDefOf(ctx, handle, command.path)
      const endpoints = handle.id === undefined
        ? []
        : pathEndpointsAtTime(ctx.doc, handle.id, command.time)
      if (endpoints.length > 0) {
        throw new CommandError(
          `该时间是路径端点（${endpoints.join('、')}），删除会断开引用；请先重绑或删除路径`,
        )
      }
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      const frames = object.keyframes ?? []
      const next = removeKeyframe(frames, command.time)
      if (def !== undefined && def.mode === 'event' && next.length === 0) {
        throw new CommandError(`${command.path}: mode=event 必须有 keyframes（不能删除最后一帧）`)
      }
      object.keyframes = next
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.moveKeyframe': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!isValidObjectPath(command.path)) {
        throw new CommandError(`非法属性路径: ${command.path}`)
      }
      readShape(ctx, handle)
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      object.keyframes = moveKeyframe(object.keyframes ?? [], command.from, command.to)
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.remove': {
      const handle = requireHandle(ctx, command.clipKey)
      const objects = handle.clip.objects
      if (!isJsonObject(objects) || !Object.prototype.hasOwnProperty.call(objects, command.path)) {
        throw new CommandError(`属性不存在: ${command.path}`)
      }
      delete objects[command.path]
      return { warnings }
    }
    case 'path.remove': {
      const paths = ctx.doc.root.paths
      if (!Array.isArray(paths)) {
        throw new CommandError('paths 不是数组')
      }
      const index = paths.findIndex((entry) => isJsonObject(entry) && entry.id === command.pathId)
      if (index < 0) {
        throw new CommandError(`路径不存在: ${command.pathId}`)
      }
      paths.splice(index, 1)
      return { warnings }
    }
    case 'binding.remove': {
      const bindings = ctx.doc.root.rule_bindings
      if (!Array.isArray(bindings)) {
        throw new CommandError('rule_bindings 不是数组')
      }
      const index = bindings.findIndex((entry) => isJsonObject(entry) && entry.id === command.bindingId)
      if (index < 0) {
        throw new CommandError(`绑定不存在: ${command.bindingId}`)
      }
      bindings.splice(index, 1)
      return { warnings }
    }
    default: {
      const exhaustive: never = command
      throw new CommandError(`未知命令: ${describe(exhaustive as JsonValue)}`)
    }
  }
}

/** 按路径段写值（引用同步改写用）；路径必须已存在。 */
function setAtPath(root: JsonObject, path: readonly (string | number)[], value: JsonValue): void {
  let node: JsonValue = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    const next: JsonValue | undefined = typeof key === 'number'
      ? (Array.isArray(node) ? node[key] : undefined)
      : (isJsonObject(node) ? node[key] : undefined)
    if (next === undefined) {
      throw new CommandError(`引用路径不存在: ${path.join('.')}`)
    }
    node = next
  }
  const last = path[path.length - 1]
  if (typeof last === 'number') {
    if (!Array.isArray(node)) {
      throw new CommandError(`引用路径不是数组: ${path.join('.')}`)
    }
    node[last] = value
    return
  }
  if (!isJsonObject(node)) {
    throw new CommandError(`引用路径不是对象: ${path.join('.')}`)
  }
  node[last] = value
}
