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
  eachClip,
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
import {
  duplicateTriggerIds,
  findTriggerIndex,
  newRequirement,
  parseRequirement,
  writeRequirement,
} from '../graph/requirements.ts'
import { isBuiltinRequirementType } from '../graph/types.ts'
import type { BuiltinRequirementType } from '../graph/types.ts'
import { compactStarts, rippleShift, splitClipObject } from '../timeline/clipEdit.ts'
import type { AnimObjectShape, JsonObject, JsonValue, ObjectKeyframe, ScriptDoc } from './types.ts'
import { checkValue } from './value.ts'
import { PATH_ID_JAVA_PATTERN } from '../paths/types.ts'
import { validatePathEntry } from '../paths/collection.ts'

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
  | { kind: 'timeline.addTrack'; type: string }
  | { kind: 'timeline.removeTrack'; trackId: string }
  | { kind: 'timeline.reorderTracks'; trackId: string; toIndex: number }
  | { kind: 'timeline.renameTrack'; trackId: string; name: string }
  | { kind: 'timeline.moveClips'; clipKeys: string[]; deltaSeconds: number; targetTrackId?: string }
  | { kind: 'timeline.trimClip'; clipKey: string; edge: 'left' | 'right'; newTime: number }
  | { kind: 'timeline.splitClip'; clipKey: string; splitTime: number }
  | { kind: 'timeline.deleteClips'; clipKeys: string[] }
  | { kind: 'timeline.rippleDelete'; clipKeys: string[] }
  | { kind: 'timeline.toggleLoop'; clipKeys: string[] }
  | { kind: 'timeline.compactSelection'; clipKeys: string[] }
  | { kind: 'timeline.pasteClips'; targetTrackId: string; atTime: number; clips: JsonObject[] }
  | {
    kind: 'trigger.requires.add'
    triggerIdentity: string
    index: number
    requirementType: BuiltinRequirementType
    targetScriptId: string
  }
  | {
    kind: 'trigger.requires.update'
    triggerIdentity: string
    index: number
    requirementType: BuiltinRequirementType
    targetScriptId: string
  }
  | { kind: 'trigger.requires.remove'; triggerIdentity: string; index: number }
  | { kind: 'trigger.setConditions'; triggerIdentity: string; patch: Record<string, JsonValue>; remove?: string[] }
  | { kind: 'trigger.setFields'; triggerIdentity: string; patch: JsonObject }
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
  /** 开启动画（06-03）：在给定时间建首帧；初值取显式值 → 同属性最近节点 → 静态值 → 目录默认。 */
  | {
    kind: 'object.enableAnimation'
    clipKey: string
    path: string
    time: number
    /** 显式初值；缺省时按回退链取值。 */
    value?: JsonValue
  }
  /** 关闭动画（06-02 / 06-05）：删该叶子全部帧，保留确定的值；事件叶子拒绝。 */
  | { kind: 'object.disableAnimation'; clipKey: string; path: string }
  /** 改某个已存在节点的值（06-05）：不动时间、不动其他节点、不动插值。 */
  | { kind: 'object.setKeyframeValue'; clipKey: string; path: string; time: number; value: JsonValue }
  /** 批量移动（06-05）：跨属性共用同一偏移，任一冲突整次拒绝。 */
  | {
    kind: 'object.moveKeyframes'
    clipKey: string
    moves: Array<{ path: string; from: number; to: number }>
  }
  /** 批量删除（06-05）：跨属性原子提交；删空事件行拒绝。 */
  | { kind: 'object.removeKeyframes'; clipKey: string; targets: Array<{ path: string; time: number }> }
  /** 粘贴节点（06-05）：按锚点 + 偏移插入；合并模式同刻冲突整次拒绝，替换模式先清空再插入。 */
  | {
    kind: 'object.pasteKeyframes'
    clipKey: string
    path: string
    mode: 'merge' | 'replace'
    /** 剪贴板记录的类型；给了就做类型匹配校验。 */
    type?: string
    anchor: number
    points: Array<{ offset: number; value: JsonValue }>
  }
  /** 烘焙（06-06）：把作者态采样结果落成普通节点；起止节点保留，中间插入采样点。 */
  | {
    kind: 'object.bakeEasing'
    clipKey: string
    path: string
    fromTime: number
    toTime: number
    points: Array<{ time: number; value: JsonValue }>
  }
  | { kind: 'object.remove'; clipKey: string; path: string }
  /** 07 原子批量帧编辑：一次提交内按顺序 add/set/remove；任一失败整次抛错。 */
  | {
    kind: 'object.editKeyframes'
    clipKey: string
    ops: Array<
      | { op: 'add'; path: string; time: number; value: JsonValue }
      | { op: 'set'; path: string; time: number; value: JsonValue }
      | { op: 'remove'; path: string; time: number }
    >
  }
  | { kind: 'path.remove'; pathId: string }
  /** 07 路径集合批量写：先按 id 删除，再按顺序追加（生成器 / diff 替换）。 */
  | { kind: 'path.writeBatch'; removeIds: string[]; entries: JsonObject[] }
  /** 07 组合命令：按顺序执行子命令；store 的一次快照保证整体撤销。 */
  | { kind: 'compound'; commands: DocCommand[] }
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

/** 轨道定位结果：数组下标 + 轨道对象 + 片段数组。 */
interface TrackRef {
  index: number
  type: string
  track: JsonObject
  clips: JsonValue[]
}

/** 顶层 `timeline.tracks` 必须是数组。 */
function requireTracks(ctx: ApplyContext): JsonValue[] {
  const tracks = ctx.doc.timeline.tracks
  if (!Array.isArray(tracks)) {
    throw new CommandError('timeline.tracks 不是数组')
  }
  return tracks
}

/** 解析 `type#index` 轨道 id；类型必须与当前位置一致（避免重排后误改别的轨道）。 */
function resolveTrack(ctx: ApplyContext, trackId: string): TrackRef {
  const tracks = requireTracks(ctx)
  const hash = trackId.lastIndexOf('#')
  if (hash <= 0 || hash === trackId.length - 1) {
    throw new CommandError(`轨道 id 不合法: ${trackId}`)
  }
  const type = trackId.slice(0, hash)
  const index = Number(trackId.slice(hash + 1))
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length) {
    throw new CommandError(`轨道不存在: ${trackId}`)
  }
  const track = tracks[index]
  if (!isJsonObject(track) || !Array.isArray(track.clips)) {
    throw new CommandError(`轨道不是对象或缺少 clips: ${trackId}`)
  }
  if (track.type !== type) {
    throw new CommandError(`轨道 id 已失效: ${trackId}（当前位置是 ${String(track.type)}#${index}）`)
  }
  return { index, type, track, clips: track.clips }
}

/** 取内联片段句柄；独立片段没有时间轴位置 → 拒绝。 */
function requireTimelineHandle(ctx: ApplyContext, clipKey: string): ClipHandle {
  const handle = requireHandle(ctx, clipKey)
  if (!handle.inline) {
    throw new CommandError('独立片段没有时间轴位置（缺少 start_time）')
  }
  return handle
}

/** 片段起点（缺失按 0，与解析器默认放置一致）。 */
function clipStartOf(clip: JsonObject): number {
  return isFiniteNumber(clip.start_time) ? clip.start_time : 0
}

/** 片段时长（缺失按 0）。 */
function clipDurationOf(clip: JsonObject): number {
  return isFiniteNumber(clip.duration) ? clip.duration : 0
}

/** 片段是否永不结束：`duration < 0`，或 `loop=true && loop_count < 0`。 */
function clipIsInfinite(clip: JsonObject): boolean {
  const duration = clipDurationOf(clip)
  if (duration < 0) {
    return true
  }
  return clip.loop === true && isFiniteNumber(clip.loop_count) && clip.loop_count < 0
}

/** 去重命令里的片段键，保持出现顺序。 */
function uniqueKeys(clipKeys: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const key of clipKeys) {
    if (!seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

/** 删除前统一预检：任一被引用 → 整组拒绝。 */
function assertClipsRemovable(ctx: ApplyContext, handles: readonly ClipHandle[], action: string): void {
  const labels: string[] = []
  for (const handle of handles) {
    const check = canRemoveClip(ctx.doc, handle.id)
    if (!check.ok) {
      labels.push(...check.references.map((reference) => reference.label))
    }
  }
  if (labels.length > 0) {
    throw new CommandError(`片段被引用，不能${action}（${labels.join('；')}）`)
  }
}

/** 文档内全部片段 id（可排除一个片段，用于生成本次替换的新 id）。 */
function usedClipIds(ctx: ApplyContext, except?: JsonObject): Set<string> {
  const used = new Set<string>()
  eachClip(ctx.doc, (clip) => {
    if (clip === except) {
      return
    }
    if (typeof clip.id === 'string' && clip.id.length > 0) {
      used.add(clip.id)
    }
  })
  return used
}

/** 生成文档内唯一的新片段 id（超长截断 64，冲突追加 `_2` / `_3`）。 */
function uniqueClipId(base: string, used: Set<string>): string {
  let candidate = base.slice(0, 64)
  let counter = 2
  while (used.has(candidate)) {
    const suffix = `_${counter}`
    candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`
    counter += 1
  }
  used.add(candidate)
  return candidate
}

/** 按 `triggerIdentity`（先 id 后 `type#index`）定位触发器。 */
function requireTrigger(ctx: ApplyContext, identity: string): JsonObject {
  const triggers = ctx.doc.meta.triggers
  if (!Array.isArray(triggers)) {
    throw new CommandError('meta.triggers 不是数组')
  }
  const index = findTriggerIndex(triggers, identity, duplicateTriggerIds(triggers))
  if (index < 0) {
    throw new CommandError(`触发器不存在: ${identity}`)
  }
  const trigger = triggers[index]
  if (!isJsonObject(trigger)) {
    throw new CommandError(`触发器不是对象: ${identity}`)
  }
  return trigger
}

/** 校验前置下标与目标脚本 id。 */
function assertRequirementInput(index: number, targetScriptId: string, length: number, allowAppend: boolean): void {
  const upper = allowAppend ? length : length - 1
  if (!Number.isInteger(index) || index < 0 || index > upper) {
    throw new CommandError(`requires 下标越界: ${index}（0..${upper}）`)
  }
  if (typeof targetScriptId !== 'string' || targetScriptId.length === 0) {
    throw new CommandError('前置目标脚本 id 不能为空')
  }
}

/** 读触发器的 `requires` 数组；非数组按空数组处理（写入时整体替换）。 */
function requirementArrayOf(trigger: JsonObject): JsonValue[] {
  return Array.isArray(trigger.requires) ? trigger.requires : []
}

/** 写回 `requires`：空数组删除键（与 05-01 的「缺省 = 无前置」一致）。 */
function writeRequires(trigger: JsonObject, array: JsonValue[]): void {
  if (array.length === 0) {
    delete trigger.requires
    return
  }
  trigger.requires = array
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

/** 关键帧时间容差（秒）：与 03 编辑器内部查找同一口径（`object.ts` 的 `KEYFRAME_EPSILON`）。 */
const FRAME_EPSILON = 1e-6

/** 找到与 `time` 匹配的关键帧下标；未命中返回 `-1`。 */
function frameIndexAt(frames: readonly ObjectKeyframe[], time: number): number {
  let best = -1
  let bestDelta = Number.POSITIVE_INFINITY
  for (let index = 0; index < frames.length; index += 1) {
    const delta = Math.abs(frames[index].time - time)
    if (delta <= FRAME_EPSILON && delta < bestDelta) {
      best = index
      bestDelta = delta
    }
  }
  return best
}

/** 读属性对象的当前值（只认 `value` 键；缺失返回 `undefined`）。 */
function valueOfProperty(property: JsonObject): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(property, 'value') ? property.value : undefined
}

/**
 * 开启动画的初值回退链（06-03 §三）：同属性最近节点 → 当前静态值 → 目录默认值。
 *
 * 三者都没有 → 抛错，由调用方提示"先输入静态值"。
 */
function animationSeed(
  def: FieldEntry | undefined,
  path: string,
  object: AnimObjectShape,
  staticValue: JsonValue | undefined,
  time: number,
): JsonValue {
  const frames = object.keyframes ?? []
  if (frames.length > 0) {
    let nearest = frames[0]
    let bestDelta = Math.abs(nearest.time - time)
    for (const frame of frames) {
      const delta = Math.abs(frame.time - time)
      if (delta < bestDelta) {
        nearest = frame
        bestDelta = delta
      }
    }
    return cloneJson(nearest.value)
  }
  if (staticValue !== undefined) {
    return cloneJson(staticValue)
  }
  if (def !== undefined && def.hasDefault && def.default !== null) {
    return cloneJson(def.default as JsonValue)
  }
  throw new CommandError(`${path}: 没有可用的初值（无节点、无静态值、目录无默认值），请先输入静态值`)
}

/** 关闭动画后的静态值（06-02 §三）：最后一个节点的值 → 原静态值 → 目录默认值。 */
function closingStaticValue(
  def: FieldEntry | undefined,
  path: string,
  object: AnimObjectShape,
  staticValue: JsonValue | undefined,
): JsonValue {
  const frames = object.keyframes ?? []
  if (frames.length > 0) {
    return cloneJson(frames[frames.length - 1].value)
  }
  if (staticValue !== undefined) {
    return cloneJson(staticValue)
  }
  if (def !== undefined && def.hasDefault && def.default !== null) {
    return cloneJson(def.default as JsonValue)
  }
  throw new CommandError(`${path}: 关闭动画后没有可保留的值（无节点、无静态值、目录无默认值）`)
}

/** 读已存在的属性对象（不创建）；缺失时按空对象处理，由后续命令抛"不存在"。 */
function existingProperty(clip: JsonObject, path: string): JsonObject {
  const objects = clip.objects
  if (!isJsonObject(objects)) {
    return {}
  }
  const existing = objects[path]
  return isJsonObject(existing) ? existing : {}
}

/** 读 / 建属性对象并返回其编辑视图；路径未登记时按调用方要求拒绝。 */
function propertyForWrite(
  ctx: ApplyContext,
  handle: ClipHandle,
  path: string,
): { property: JsonObject; object: AnimObjectShape; def: FieldEntry | undefined } {
  if (!isValidObjectPath(path)) {
    throw new CommandError(`非法属性路径: ${path}`)
  }
  readShape(ctx, handle)
  const def = objectDefOf(ctx, handle, path)
  if (def === undefined && ctx.catalog.track(handle.trackType) !== undefined) {
    throw new CommandError(`未登记的对象路径: ${path}（轨道 ${handle.trackType}）`)
  }
  const property = propertyOf(handle.clip, path)
  return { property, object: animObjectOf(property), def }
}

/** 删除数组元素（从后往前调用，避免索引漂移）。 */
function removeArrayEntries(array: JsonValue[], indexes: readonly number[]): void {
  for (const index of [...indexes].sort((left, right) => right - left)) {
    array.splice(index, 1)
  }
}

/** `trigger.setFields` 允许写入的键（`type` / `id` 与其他键一律拒绝）。 */
const TRIGGER_EDITABLE_KEYS: readonly string[] = [
  'repeatable',
  'delay',
  'on_enter',
  'exit_buffer',
  'continuity',
  'poll_interval',
]

/** 校验 `continuity` 的已知子字段（与结构检查同口径，未知子字段原样保留）。 */
function assertContinuityShape(value: JsonValue): void {
  if (!isJsonObject(value)) {
    throw new CommandError('continuity 需要对象')
  }
  if (Object.prototype.hasOwnProperty.call(value, 'sweep') && typeof value.sweep !== 'boolean') {
    throw new CommandError('continuity.sweep 需要布尔值')
  }
  for (const key of ['dwell', 'window']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue
    }
    const entry = value[key]
    if (!isFiniteNumber(entry) || !Number.isInteger(entry) || entry < 0 || entry > 1200) {
      throw new CommandError(`continuity.${key} 需要 0~1200 的整数`)
    }
  }
}

/** 校验 `trigger.setFields` 的一个值；`null` 表示删除该可选字段。 */
function assertTriggerFieldValue(key: string, value: JsonValue): void {
  if (value === null) {
    return
  }
  if (key === 'repeatable' || key === 'on_enter') {
    if (typeof value !== 'boolean') {
      throw new CommandError(`${key} 需要布尔值`)
    }
    return
  }
  if (key === 'delay' || key === 'exit_buffer') {
    if (!isFiniteNumber(value)) {
      throw new CommandError(`${key} 需要有限数字`)
    }
    return
  }
  if (key === 'poll_interval') {
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1 || value > 600) {
      throw new CommandError('poll_interval 需要 1~600 的整数')
    }
    return
  }
  if (key === 'continuity') {
    assertContinuityShape(value)
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
    case 'timeline.addTrack': {
      const type = typeof command.type === 'string' ? command.type.trim() : ''
      if (type.length === 0) {
        throw new CommandError('轨道 type 不能为空')
      }
      const tracks = requireTracks(ctx)
      if (type === 'LETTERBOX' && tracks.some((track) => isJsonObject(track) && track.type === 'LETTERBOX')) {
        throw new CommandError('LETTERBOX 轨道已存在（最多一条）')
      }
      tracks.push({ type, clips: [] })
      return { warnings }
    }
    case 'timeline.removeTrack': {
      const target = resolveTrack(ctx, command.trackId)
      if (target.clips.length > 0) {
        throw new CommandError(`轨道非空，不能删除: ${command.trackId}（先删除或移动 ${target.clips.length} 个片段）`)
      }
      requireTracks(ctx).splice(target.index, 1)
      return { warnings }
    }
    case 'timeline.reorderTracks': {
      const target = resolveTrack(ctx, command.trackId)
      const tracks = requireTracks(ctx)
      if (!isFiniteNumber(command.toIndex)) {
        throw new CommandError('toIndex 需要有限数字')
      }
      const toIndex = Math.max(0, Math.min(tracks.length - 1, Math.trunc(command.toIndex)))
      if (toIndex === target.index) {
        return { warnings }
      }
      const [track] = tracks.splice(target.index, 1)
      tracks.splice(toIndex, 0, track)
      return { warnings }
    }
    case 'timeline.renameTrack': {
      const target = resolveTrack(ctx, command.trackId)
      const name = typeof command.name === 'string' ? command.name.trim() : ''
      if (name.length === 0) {
        throw new CommandError('轨道名称不能为空')
      }
      const duplicate = requireTracks(ctx).some((track) => track !== target.track
        && isJsonObject(track) && track.name === name)
      if (duplicate) {
        throw new CommandError(`轨道名称已存在: ${name}`)
      }
      target.track.name = name
      return { warnings }
    }
    case 'timeline.moveClips': {
      if (!isFiniteNumber(command.deltaSeconds)) {
        throw new CommandError('deltaSeconds 需要有限数字')
      }
      const keys = uniqueKeys(command.clipKeys)
      if (keys.length === 0) {
        return { warnings }
      }
      const handles = keys.map((key) => requireTimelineHandle(ctx, key))
      const target = command.targetTrackId === undefined
        ? undefined
        : resolveTrack(ctx, command.targetTrackId)
      if (target !== undefined) {
        for (const handle of handles) {
          if (handle.trackType !== target.type) {
            throw new CommandError(
              `跨轨类型不匹配: ${handle.trackType} → ${target.type}（片段 ${handle.key}）`,
            )
          }
        }
      }
      for (const handle of handles) {
        if (clipStartOf(handle.clip) + command.deltaSeconds < 0) {
          throw new CommandError(`移动后起点小于 0（片段 ${handle.key}）`)
        }
      }
      for (const handle of handles) {
        handle.clip.start_time = clipStartOf(handle.clip) + command.deltaSeconds
      }
      if (target !== undefined) {
        for (const handle of handles) {
          const array = clipArray(ctx, handle)
          const index = array.indexOf(handle.clip)
          if (index < 0) {
            throw new CommandError(`片段不在原轨道数组中: ${handle.key}`)
          }
          array.splice(index, 1)
          target.clips.push(handle.clip)
        }
      }
      return { warnings }
    }
    case 'timeline.trimClip': {
      const handle = requireTimelineHandle(ctx, command.clipKey)
      if (command.edge !== 'left' && command.edge !== 'right') {
        throw new CommandError(`裁切边需要 left / right，实际: ${String(command.edge)}`)
      }
      if (!isFiniteNumber(command.newTime)) {
        throw new CommandError('裁切时间需要有限数字')
      }
      const clip = handle.clip
      const start = clipStartOf(clip)
      const duration = clipDurationOf(clip)
      if (command.edge === 'right') {
        if (clipIsInfinite(clip)) {
          throw new CommandError('无限片段没有有限末端，不能右裁切')
        }
        if (duration <= 0) {
          throw new CommandError('片段时长必须为正才能右裁切')
        }
        clip.duration = Math.max(command.newTime, start + 0.05) - start
        return { warnings }
      }
      if (duration < 0) {
        clip.start_time = Math.max(0, command.newTime)
        return { warnings }
      }
      const end = start + duration
      const upper = Math.max(0, end - 0.05)
      const newStart = Math.min(Math.max(command.newTime, 0), upper)
      clip.start_time = newStart
      clip.duration = end - newStart
      return { warnings }
    }
    case 'timeline.splitClip': {
      const handle = requireTimelineHandle(ctx, command.clipKey)
      const clip = handle.clip
      if (clipIsInfinite(clip)) {
        throw new CommandError('无限片段不能分割（没有有限末端）')
      }
      if (!isFiniteNumber(command.splitTime)) {
        throw new CommandError('splitTime 需要有限数字')
      }
      const start = clipStartOf(clip)
      const duration = clipDurationOf(clip)
      const end = start + duration
      if (!(command.splitTime > start + 0.01 && command.splitTime < end - 0.01)) {
        throw new CommandError(`splitTime=${command.splitTime} 必须严格在 (${start + 0.01}, ${end - 0.01}) 内`)
      }
      const id = typeof clip.id === 'string' && clip.id.length > 0 ? clip.id : undefined
      if (id !== undefined) {
        const references = referencesToClip(ctx.doc, id)
        if (references.length > 0) {
          throw new CommandError(
            `片段被引用，不能分割（${references.map((reference) => reference.label).join('；')}）`,
          )
        }
      }
      const used = usedClipIds(ctx, clip)
      const idBase = id !== undefined && id.length > 62 ? id.slice(0, 62) : id
      const split = splitClipObject(
        clip,
        command.splitTime,
        idBase === undefined ? undefined : (suffix) => uniqueClipId(`${idBase}_${suffix}`, used),
      )
      const array = clipArray(ctx, handle)
      const index = array.indexOf(clip)
      if (index < 0) {
        throw new CommandError(`片段不在原轨道数组中: ${handle.key}`)
      }
      array.splice(index, 1, split.left, split.right)
      return { warnings }
    }
    case 'timeline.deleteClips': {
      const keys = uniqueKeys(command.clipKeys)
      if (keys.length === 0) {
        return { warnings }
      }
      const handles = keys.map((key) => requireTimelineHandle(ctx, key))
      assertClipsRemovable(ctx, handles, '删除')
      const groups = new Map<JsonValue[], Set<JsonObject>>()
      for (const handle of handles) {
        const array = clipArray(ctx, handle)
        const set = groups.get(array) ?? new Set<JsonObject>()
        set.add(handle.clip)
        groups.set(array, set)
      }
      for (const [array, set] of groups) {
        for (let index = array.length - 1; index >= 0; index -= 1) {
          const clip = array[index]
          if (isJsonObject(clip) && set.has(clip)) {
            array.splice(index, 1)
          }
        }
      }
      return { warnings }
    }
    case 'timeline.rippleDelete': {
      const keys = uniqueKeys(command.clipKeys)
      if (keys.length === 0) {
        return { warnings }
      }
      const handles = keys.map((key) => requireTimelineHandle(ctx, key))
      assertClipsRemovable(ctx, handles, '波纹删除')
      const deletedByTrack = new Map<number, { start: number; duration: number }[]>()
      for (const handle of handles) {
        const clip = handle.clip
        if (clipIsInfinite(clip)) {
          throw new CommandError('无限片段不能波纹删除（没有有限末端）')
        }
        const duration = clipDurationOf(clip)
        if (duration <= 0) {
          throw new CommandError(`片段时长必须为正才能波纹删除（片段 ${handle.key}）`)
        }
        const list = deletedByTrack.get(handle.trackIndex) ?? []
        list.push({ start: clipStartOf(clip), duration })
        deletedByTrack.set(handle.trackIndex, list)
      }
      const groups = new Map<JsonValue[], Set<JsonObject>>()
      for (const handle of handles) {
        const array = clipArray(ctx, handle)
        const set = groups.get(array) ?? new Set<JsonObject>()
        set.add(handle.clip)
        groups.set(array, set)
      }
      for (const [array, set] of groups) {
        for (let index = array.length - 1; index >= 0; index -= 1) {
          const clip = array[index]
          if (isJsonObject(clip) && set.has(clip)) {
            array.splice(index, 1)
          }
        }
      }
      const tracks = requireTracks(ctx)
      for (const [trackIndex, deleted] of deletedByTrack) {
        const track = tracks[trackIndex]
        if (!isJsonObject(track) || !Array.isArray(track.clips)) {
          continue
        }
        const remaining = track.clips.filter(isJsonObject)
        const starts = rippleShift(
          remaining.map((clip) => ({ start: clipStartOf(clip), duration: clipDurationOf(clip) })),
          deleted,
        )
        remaining.forEach((clip, index) => {
          clip.start_time = starts[index]
        })
      }
      return { warnings }
    }
    case 'timeline.toggleLoop': {
      const keys = uniqueKeys(command.clipKeys)
      if (keys.length === 0) {
        return { warnings }
      }
      const handles = keys.map((key) => requireTimelineHandle(ctx, key))
      const target = handles[0].clip.loop !== true
      if (target) {
        for (const handle of handles) {
          if (clipDurationOf(handle.clip) < 0) {
            throw new CommandError('无限片段（duration<0）不能开启循环')
          }
        }
      }
      for (const handle of handles) {
        if (!target) {
          handle.clip.loop = false
          continue
        }
        handle.clip.loop = true
        if (typeof handle.clip.loop_count !== 'number' || handle.clip.loop_count === 0) {
          handle.clip.loop_count = 1
        }
      }
      return { warnings }
    }
    case 'timeline.compactSelection': {
      const keys = uniqueKeys(command.clipKeys)
      if (keys.length === 0) {
        return { warnings }
      }
      const handles = keys.map((key) => requireTimelineHandle(ctx, key))
      for (const handle of handles) {
        if (clipIsInfinite(handle.clip)) {
          throw new CommandError('无限片段不能顺排（无法定义 end）')
        }
      }
      const groups = new Map<number, ClipHandle[]>()
      for (const handle of handles) {
        const list = groups.get(handle.trackIndex) ?? []
        list.push(handle)
        groups.set(handle.trackIndex, list)
      }
      for (const list of groups.values()) {
        const ordered = [...list].sort((left, right) => clipStartOf(left.clip) - clipStartOf(right.clip)
          || left.clipIndex - right.clipIndex)
        const starts = compactStarts(ordered.map((handle) => ({
          start: clipStartOf(handle.clip),
          duration: clipDurationOf(handle.clip),
        })))
        ordered.forEach((handle, index) => {
          handle.clip.start_time = starts[index]
        })
      }
      return { warnings }
    }
    case 'timeline.pasteClips': {
      const target = resolveTrack(ctx, command.targetTrackId)
      if (!isFiniteNumber(command.atTime)) {
        throw new CommandError('atTime 需要有限数字')
      }
      if (command.clips.length === 0) {
        return { warnings }
      }
      const prepared: JsonObject[] = []
      let earliest = Number.POSITIVE_INFINITY
      for (let index = 0; index < command.clips.length; index += 1) {
        const raw = command.clips[index]
        if (!isJsonObject(raw)) {
          throw new CommandError(`粘贴片段 ${index} 不是对象`)
        }
        const result = readClip(raw, {
          inline: true,
          jsonPath: `paste[${index}]`,
          trackType: target.type,
          catalog: ctx.catalog,
        })
        const blocking = result.problems.filter((problem) => problem.severity === 'block')
        if (blocking.length > 0) {
          throw new CommandError(
            `粘贴片段 ${index} 与轨道 ${target.type} 不匹配: ${blocking.map((problem) => problem.message).join('；')}`,
          )
        }
        const clip = cloneJson(raw) as JsonObject
        prepared.push(clip)
        earliest = Math.min(earliest, clipStartOf(clip))
      }
      const shift = Math.max(0, command.atTime) - earliest
      for (const clip of prepared) {
        clip.start_time = Math.max(0, clipStartOf(clip) + shift)
      }
      target.clips.push(...prepared)
      return { warnings }
    }
    case 'trigger.requires.add': {
      if (!isBuiltinRequirementType(command.requirementType)) {
        throw new CommandError(`未知内置前置类型: ${String(command.requirementType)}`)
      }
      const trigger = requireTrigger(ctx, command.triggerIdentity)
      const array = [...requirementArrayOf(trigger)]
      assertRequirementInput(command.index, command.targetScriptId, array.length, true)
      array.splice(command.index, 0, newRequirement(command.requirementType, command.targetScriptId))
      trigger.requires = array
      return { warnings }
    }
    case 'trigger.requires.update': {
      if (!isBuiltinRequirementType(command.requirementType)) {
        throw new CommandError(`未知内置前置类型: ${String(command.requirementType)}`)
      }
      const trigger = requireTrigger(ctx, command.triggerIdentity)
      const array = [...requirementArrayOf(trigger)]
      assertRequirementInput(command.index, command.targetScriptId, array.length, false)
      const entry = array[command.index]
      if (parseRequirement(entry, command.index).role !== 'builtin') {
        throw new CommandError('custom_readonly')
      }
      array[command.index] = writeRequirement(entry, command.requirementType, command.targetScriptId)
      trigger.requires = array
      return { warnings }
    }
    case 'trigger.requires.remove': {
      const trigger = requireTrigger(ctx, command.triggerIdentity)
      const array = [...requirementArrayOf(trigger)]
      if (!Number.isInteger(command.index) || command.index < 0 || command.index >= array.length) {
        throw new CommandError(`requires 下标越界: ${command.index}（0..${array.length - 1}）`)
      }
      if (parseRequirement(array[command.index], command.index).role !== 'builtin') {
        throw new CommandError('custom_readonly')
      }
      array.splice(command.index, 1)
      writeRequires(trigger, array)
      return { warnings }
    }
    case 'trigger.setConditions': {
      const trigger = requireTrigger(ctx, command.triggerIdentity)
      const current = trigger.conditions
      if (current !== undefined && !isJsonObject(current)) {
        throw new CommandError('触发器 conditions 不是对象')
      }
      const conditions: JsonObject = current === undefined ? {} : current
      for (const [key, value] of Object.entries(command.patch)) {
        conditions[key] = cloneJson(value)
      }
      for (const key of command.remove ?? []) {
        delete conditions[key]
      }
      trigger.conditions = conditions
      return { warnings }
    }
    case 'trigger.setFields': {
      const trigger = requireTrigger(ctx, command.triggerIdentity)
      const entries = Object.entries(command.patch)
      for (const [key, value] of entries) {
        if (!TRIGGER_EDITABLE_KEYS.includes(key)) {
          throw new CommandError(`触发器字段不允许: ${key}（可用: ${TRIGGER_EDITABLE_KEYS.join(' / ')}）`)
        }
        assertTriggerFieldValue(key, value)
      }
      for (const [key, value] of entries) {
        if (value === null) {
          delete trigger[key]
          continue
        }
        trigger[key] = cloneJson(value)
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
        throw new CommandError(
          `新帧 t=${command.time} 落在 ${interruptions.join('、')} 的端点区间内，会切断端点相邻性；请先删除这些路径并继续`,
        )
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
      if (handle.id !== undefined) {
        const endpointTimes = pathEndpointsAtTime(ctx.doc, handle.id, command.from)
        if (endpointTimes.length > 0) {
          throw new CommandError(`移动的节点是路径端点（${endpointTimes.join('、')}），会断开引用；请先删除这些路径`)
        }
        const interruptions = pathIntervalsContaining(ctx.doc, handle.id, command.to)
        if (interruptions.length > 0) {
          throw new CommandError(`目标时间 ${command.to} 落在 ${interruptions.join('、')} 的端点区间内；请先删除这些路径`)
        }
      }
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      object.keyframes = moveKeyframe(object.keyframes ?? [], command.from, command.to)
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.enableAnimation': {
      const handle = requireHandle(ctx, command.clipKey)
      const { property, object, def } = propertyForWrite(ctx, handle, command.path)
      assertKeyframesAllowed(def, command.path)
      const existing = object.keyframes ?? []
      if (frameIndexAt(existing, command.time) >= 0) {
        throw new CommandError(`${command.path}: t=${command.time} 已有关键帧（同属性时间必须严格递增）`)
      }
      const seed = command.value === undefined
        ? animationSeed(def, command.path, object, valueOfProperty(property), command.time)
        : cloneJson(command.value)
      assertValueWritable(def, `${command.path}.keyframes`, seed, def?.type === 'nullable_float')
      object.keyframes = insertKeyframe(existing, command.time, seed)
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.disableAnimation': {
      const handle = requireHandle(ctx, command.clipKey)
      if (!isValidObjectPath(command.path)) {
        throw new CommandError(`非法属性路径: ${command.path}`)
      }
      readShape(ctx, handle)
      const def = objectDefOf(ctx, handle, command.path)
      if (def !== undefined && def.mode === 'event') {
        throw new CommandError(`${command.path}: 事件叶子不能关闭动画（记录必须非空）`)
      }
      const objects = handle.clip.objects
      if (!isJsonObject(objects) || !Object.prototype.hasOwnProperty.call(objects, command.path)) {
        throw new CommandError(`属性不存在: ${command.path}`)
      }
      const property = propertyOf(handle.clip, command.path)
      const object = animObjectOf(property)
      const staticValue = valueOfProperty(property)
      const keep = closingStaticValue(def, command.path, object, staticValue)
      writeProperty(handle.clip, command.path, { value: keep, keyframes: [] })
      return { warnings }
    }
    case 'object.setKeyframeValue': {
      const handle = requireHandle(ctx, command.clipKey)
      const { object, def } = propertyForWrite(ctx, handle, command.path)
      assertValueWritable(def, `${command.path}.keyframes`, command.value, def?.type === 'nullable_float')
      const frames = object.keyframes ?? []
      const index = frameIndexAt(frames, command.time)
      if (index < 0) {
        throw new CommandError(`${command.path}: 关键帧不存在 t=${command.time}`)
      }
      object.keyframes = frames.map((frame, current) =>
        current === index ? { time: frame.time, value: cloneJson(command.value) } : frame)
      writeProperty(handle.clip, command.path, object)
      return { warnings }
    }
    case 'object.moveKeyframes': {
      const handle = requireHandle(ctx, command.clipKey)
      if (command.moves.length === 0) {
        return { warnings }
      }
      readShape(ctx, handle)
      // 先在内存副本上全部试算；任一冲突整次拒绝，不写文档。
      const drafts = new Map<string, { def: FieldEntry | undefined; frames: ObjectKeyframe[] }>()
      for (const move of command.moves) {
        if (!isValidObjectPath(move.path)) {
          throw new CommandError(`非法属性路径: ${move.path}`)
        }
        const def = objectDefOf(ctx, handle, move.path)
        if (def === undefined && ctx.catalog.track(handle.trackType) !== undefined) {
          throw new CommandError(`未登记的对象路径: ${move.path}（轨道 ${handle.trackType}）`)
        }
        if (!isFiniteNumber(move.to) || move.to < 0) {
          throw new CommandError(`${move.path}: 目标时间必须是非负有限数字（收到 ${String(move.to)}）`)
        }
        if (handle.id !== undefined) {
          const endpointTimes = pathEndpointsAtTime(ctx.doc, handle.id, move.from)
          if (endpointTimes.length > 0) {
            throw new CommandError(`移动的节点是路径端点（${endpointTimes.join('、')}）；请先删除这些路径`)
          }
          const interruptions = pathIntervalsContaining(ctx.doc, handle.id, move.to)
          if (interruptions.length > 0) {
            throw new CommandError(`目标时间 ${move.to} 落在 ${interruptions.join('、')} 的端点区间内；请先删除这些路径`)
          }
        }
        const current = drafts.get(move.path)
          ?? { def, frames: animObjectOf(existingProperty(handle.clip, move.path)).keyframes ?? [] }
        drafts.set(move.path, { def: current.def, frames: moveKeyframe(current.frames, move.from, move.to) })
      }
      for (const [path, draft] of drafts) {
        assertKeyframesWritable(draft.def, path, draft.frames)
      }
      for (const [path, draft] of drafts) {
        const object = animObjectOf(existingProperty(handle.clip, path))
        writeProperty(handle.clip, path, { ...object, keyframes: draft.frames })
      }
      return { warnings }
    }
    case 'object.removeKeyframes': {
      const handle = requireHandle(ctx, command.clipKey)
      if (command.targets.length === 0) {
        return { warnings }
      }
      readShape(ctx, handle)
      const drafts = new Map<string, { def: FieldEntry | undefined; frames: ObjectKeyframe[] }>()
      for (const target of command.targets) {
        if (!isValidObjectPath(target.path)) {
          throw new CommandError(`非法属性路径: ${target.path}`)
        }
        const endpoints = handle.id === undefined
          ? []
          : pathEndpointsAtTime(ctx.doc, handle.id, target.time)
        if (endpoints.length > 0) {
          throw new CommandError(
            `该时间是路径端点（${endpoints.join('、')}），删除会断开引用；请先重绑或删除路径`,
          )
        }
        const def = objectDefOf(ctx, handle, target.path)
        const current = drafts.get(target.path)
          ?? { def, frames: animObjectOf(existingProperty(handle.clip, target.path)).keyframes ?? [] }
        drafts.set(target.path, { def: current.def, frames: removeKeyframe(current.frames, target.time) })
      }
      for (const [path, draft] of drafts) {
        if (draft.def !== undefined && draft.def.mode === 'event' && draft.frames.length === 0) {
          throw new CommandError(`${path}: mode=event 必须有 keyframes（不能删除最后一帧）`)
        }
        assertKeyframesWritable(draft.def, path, draft.frames)
      }
      for (const [path, draft] of drafts) {
        const object = animObjectOf(existingProperty(handle.clip, path))
        writeProperty(handle.clip, path, { ...object, keyframes: draft.frames })
      }
      return { warnings }
    }
    case 'object.pasteKeyframes': {
      const handle = requireHandle(ctx, command.clipKey)
      const { object, def } = propertyForWrite(ctx, handle, command.path)
      assertKeyframesAllowed(def, command.path)
      if (def !== undefined && command.type !== undefined && def.type !== command.type) {
        throw new CommandError(`${command.path}: 类型不匹配（目标 ${def.type}，剪贴板 ${command.type}）`)
      }
      if (!isFiniteNumber(command.anchor)) {
        throw new CommandError('粘贴锚点必须是有限数字')
      }
      let frames = command.mode === 'replace' ? [] : (object.keyframes ?? [])
      for (const point of command.points) {
        const time = command.anchor + point.offset
        if (!isFiniteNumber(time) || time < 0) {
          throw new CommandError(`粘贴时间非法: ${String(time)}（必须非负有限数字）`)
        }
        assertValueWritable(def, `${command.path}.keyframes`, point.value, def?.type === 'nullable_float')
        frames = insertKeyframe(frames, time, point.value)
      }
      writeProperty(handle.clip, command.path, { ...object, keyframes: frames })
      return { warnings }
    }
    case 'object.bakeEasing': {
      const handle = requireHandle(ctx, command.clipKey)
      const { object, def } = propertyForWrite(ctx, handle, command.path)
      if (def !== undefined && def.mode === 'event') {
        throw new CommandError(`${command.path}: 事件行没有段缓动`)
      }
      if (!(command.toTime > command.fromTime)) {
        throw new CommandError(`烘焙区间非法: ${command.fromTime} → ${command.toTime}`)
      }
      const existing = object.keyframes ?? []
      // 保留区间外的节点；区间内的起止节点由采样点自带（`points` 必须含起止）。
      let frames = existing.filter((frame) => frame.time < command.fromTime || frame.time > command.toTime)
      for (const point of command.points) {
        if (!isFiniteNumber(point.time) || point.time < 0) {
          throw new CommandError(`烘焙采样时间非法: ${String(point.time)}`)
        }
        assertValueWritable(def, `${command.path}.keyframes`, point.value, def?.type === 'nullable_float')
        if (frameIndexAt(frames, point.time) >= 0) {
          throw new CommandError(`${command.path}: 烘焙采样与既有节点同刻 t=${point.time}`)
        }
        frames = insertKeyframe(frames, point.time, point.value)
      }
      assertKeyframesWritable(def, command.path, frames)
      writeProperty(handle.clip, command.path, { ...object, keyframes: frames })
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
    case 'object.editKeyframes': {
      const handle = requireHandle(ctx, command.clipKey)
      readShape(ctx, handle)
      for (const op of command.ops) {
        if (!isValidObjectPath(op.path)) {
          throw new CommandError(`非法属性路径: ${op.path}`)
        }
        const def = objectDefOf(ctx, handle, op.path)
        if (op.op !== 'remove') {
          if (def === undefined && ctx.catalog.track(handle.trackType) !== undefined) {
            throw new CommandError(`未登记的对象路径: ${op.path}（轨道 ${handle.trackType}）`)
          }
          assertKeyframesAllowed(def, op.path)
          assertValueWritable(def, `${op.path}.keyframes`, op.value, def?.type === 'nullable_float')
        }
        if (op.op === 'remove') {
          const endpoints = handle.id === undefined ? [] : pathEndpointsAtTime(ctx.doc, handle.id, op.time)
          if (endpoints.length > 0) {
            throw new CommandError(`该时间是路径端点（${endpoints.join('、')}），删除会断开引用；请先重绑或删除路径`)
          }
        }
        const property = propertyOf(handle.clip, op.path)
        const object = animObjectOf(property)
        const frames = object.keyframes ?? []
        if (op.op === 'add') {
          if (frameIndexAt(frames, op.time) >= 0) {
            throw new CommandError(`${op.path}: t=${op.time} 已有关键帧`)
          }
          if (handle.id !== undefined) {
            const interruptions = pathIntervalsContaining(ctx.doc, handle.id, op.time)
            if (interruptions.length > 0) {
              throw new CommandError(
                `新帧 t=${op.time} 落在 ${interruptions.join('、')} 的端点区间内；请先删除这些路径并继续`,
              )
            }
          }
          object.keyframes = insertKeyframe(frames, op.time, op.value)
        } else if (op.op === 'set') {
          const index = frameIndexAt(frames, op.time)
          if (index < 0) {
            throw new CommandError(`${op.path}: t=${op.time} 不存在关键帧，无法改值`)
          }
          const next = frames.map((frame, frameIndex) => (frameIndex === index
            ? { time: frame.time, value: cloneJson(op.value) }
            : { time: frame.time, value: cloneJson(frame.value) }))
          object.keyframes = next
        } else {
          const next = removeKeyframe(frames, op.time)
          if (def !== undefined && def.mode === 'event' && next.length === 0) {
            throw new CommandError(`${op.path}: mode=event 必须有 keyframes（不能删除最后一帧）`)
          }
          object.keyframes = next
        }
        writeProperty(handle.clip, op.path, object)
      }
      return { warnings }
    }
    case 'path.writeBatch': {
      let paths = ctx.doc.root.paths
      if (paths === undefined) {
        paths = []
        ctx.doc.root.paths = paths
      }
      if (!Array.isArray(paths)) {
        throw new CommandError('paths 不是数组')
      }
      if (command.removeIds.length > 0) {
        const removeSet = new Set(command.removeIds)
        const kept = paths.filter((entry) => !(isJsonObject(entry) && typeof entry.id === 'string' && removeSet.has(entry.id)))
        paths.splice(0, paths.length, ...kept)
      }
      const existingIds = new Set<string>()
      const existingPairs = new Set<string>()
      for (const entry of paths) {
        if (isJsonObject(entry)) {
          if (typeof entry.id === 'string') {
            existingIds.add(entry.id)
          }
          if (typeof entry.clip === 'string' && typeof entry.from === 'number' && typeof entry.to === 'number') {
            existingPairs.add(`${entry.clip}|${entry.from}|${entry.to}`)
          }
        }
      }
      for (let index = 0; index < command.entries.length; index += 1) {
        const entry = command.entries[index]
        const id = entry.id
        if (typeof id !== 'string' || !PATH_ID_JAVA_PATTERN.test(id)) {
          throw new CommandError(`paths[${index}].id 非法: ${String(id)}`)
        }
        if (existingIds.has(id)) {
          throw new CommandError(`路径 id 重复: ${id}`)
        }
        const clip = typeof entry.clip === 'string' ? entry.clip : ''
        if (clip.length === 0) {
          throw new CommandError(`paths[${index}].clip 缺失`)
        }
        const from = entry.from
        const to = entry.to
        if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to) || !(from < to)) {
          throw new CommandError(`paths[${index}] 的 from/to 非法`)
        }
        const pair = `${clip}|${from}|${to}`
        if (existingPairs.has(pair)) {
          throw new CommandError(`同一片段的端点对重复: clip=${clip}, from=${from}, to=${to}`)
        }
        const entryIssues = validatePathEntry(ctx.doc, entry, paths.length)
        if (entryIssues.length > 0) {
          throw new CommandError(entryIssues[0].message)
        }
        paths.push(cloneJson(entry))
        existingIds.add(id)
        existingPairs.add(pair)
      }
      return { warnings }
    }
    case 'compound': {
      for (let index = 0; index < command.commands.length; index += 1) {
        const sub = command.commands[index]
        const result = applyCommand(ctx, sub)
        warnings.push(...result.warnings)
      }
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
