/**
 * 事件记录读取模型与校验（11-12 EVENT / 11-13 MOD_EVENT / 11-14 时间轴与 seek 语义）。
 *
 * 纯函数：只吃文档 root JSON 与只读上下文，不 commit、不读会话、不持派生缓存。
 * 字段事实来自 `core/schema/catalog/behaviorEvents.ts`；问题级别与合同码来自 `validation.ts`。
 * 06 轮 `features/effects/eventRecords.ts` 的字段表与命令翻译口径在此复用，不另造第二套。
 *
 * 运行时事实（主模组）：
 * - 编译：`EventClipRuntime.compile` 加载时把记录读成数组，`time > duration` 的超界记录编译期丢弃；
 * - 游标：`advance / poll` 只触发 `(上次推进到的局部时间, to]`，首次从 `-inf` 起，每条最多一次；
 * - seek：`reset` 把游标移到目标时间之后，目标时刻本身及更早的记录不补触发。
 */
import {
  EVENT_COMMAND_TYPE,
  classifyPosition,
  recordAllowedKeys,
  type EventTrackType,
  type CatalogSourceRef,
} from '../../core/schema/catalog/behaviorEvents.ts'
import { isFiniteNumber, isJsonObject, memberPath } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue, Severity } from '../../core/doc/types.ts'
import { recordRefKey, type BehaviorProblem, type RecordRef, type SourceRef } from './shared.ts'
import { severityForContract } from './validation.ts'

// ── 形状 ──────────────────────────────────────────────────────────────

/** 移动目标：绝对世界坐标或相对脚本激活位置的水平两轴。 */
export interface EventPosition {
  kind: 'absolute' | 'relative'
  x: number
  z: number
}

/** 一条事件记录的读取模型。 */
export interface EventRecordNode {
  ref: RecordRef
  clipKey: string
  clipPath: string
  trackType: EventTrackType
  objectPath: 'event' | 'mod_event'
  /** 对象内关键帧下标（加载时确定的稳定身份分量之一）。 */
  frameIndex: number
  /** 片段局部秒。 */
  time: number
  /** 记录体；非对象时为 `null`（问题已记入 problems）。 */
  body: JsonObject | null
  /** EVENT 命令原文；非字符串时为 `null`。 */
  command: string | null
  /** 空命令 = 占位（已触发但不执行）。 */
  commandPlaceholder: boolean
  /** 命令带前导斜杠（警告，保留原文）。 */
  leadingSlash: boolean
  position: EventPosition | null
  /** 解析后的事件名：记录级 → 对象级显式回退；都没有为 `null`。 */
  resolvedEventType: string | null
  /** 事件名来自对象级回退（记录级省略）。 */
  inheritedEventType: boolean
  /** MOD_EVENT：记录体是否显式带 `data` 键（省略 ≠ 空对象）。 */
  hasData: boolean
  /** data 顶层键数（显式对象时）。 */
  dataKeyCount: number
  /** 超出片段时长（运行期编译期丢弃）。 */
  overDuration: boolean
  /** 同对象内同一时刻另有记录（格式拒绝，提示用 `&&` 合并）。 */
  sameTime: boolean
  problems: BehaviorProblem[]
}

/** 片段读取上下文（时间轴换算 / 拖动边界用）。 */
export interface ClipEventContext {
  /** 内联片段起点（片段局部 0 对应的全局秒）；独立片段无起点，记 0。 */
  clipStartTime: number
  /** 片段时长；负数 = 无限时长。 */
  duration: number
  infinite: boolean
}

/** 记录校验选项（独立调用校验函数时传对象级回退与定位）。 */
export interface RecordValidationOptions {
  jsonPath?: string
  clipKey?: string
  /** 归属轨道类型（问题 ref 用）。 */
  trackType?: EventTrackType
  /** 对象级 `event_type` 显式值（回退链）。 */
  objectFallbackEventType?: string
}

// ── 合同码快捷引用（码表唯一出处在 validation.ts）──────────────────────

const CODE = {
  bodyShape: 'L73',
  eventTypeIllegal: 'L74',
  commandType: 'L75',
  positionShape: 'L76',
  idType: 'L77',
  leadingSlash: 'L78',
  modBodyShape: 'L79',
  modForbidden: 'L80',
  modEventType: 'L81',
  modDataObject: 'L82',
  modDataNumber: 'L83',
  outOfDuration: 'L72',
  sameTime: 'L71',
  multiEventTrack: 'L84',
} as const

// ── 扫描 ──────────────────────────────────────────────────────────────

interface ScanClip {
  clipKey: string
  clipPath: string
  trackType: string
  startTime: number
  duration: number
  infinite: boolean
  object: JsonObject
}

function finiteNumber(value: JsonValue | undefined): number | undefined {
  return isFiniteNumber(value) ? value : undefined
}

/** 枚举内联片段（timeline.tracks[].clips[]）与独立片段（clips[]）。 */
function scanClips(root: JsonObject): ScanClip[] {
  const clips: ScanClip[] = []
  const timeline = root.timeline
  if (isJsonObject(timeline)) {
    const tracks = timeline.tracks
    if (Array.isArray(tracks)) {
      tracks.forEach((trackElement, trackIndex) => {
        if (!isJsonObject(trackElement)) return
        const trackType = typeof trackElement.type === 'string' ? trackElement.type : ''
        const trackPath = `timeline.tracks[${trackIndex}]`
        const trackClips = trackElement.clips
        if (!Array.isArray(trackClips)) return
        trackClips.forEach((clipElement, clipIndex) => {
          if (!isJsonObject(clipElement)) return
          const path = `${trackPath}.clips[${clipIndex}]`
          const startTime = finiteNumber(clipElement.start_time) ?? 0
          const duration = finiteNumber(clipElement.duration)
          clips.push({
            clipKey: path,
            clipPath: path,
            trackType,
            startTime,
            duration: duration ?? 0,
            infinite: duration !== undefined && duration < 0,
            object: clipElement,
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
      const path = `clips[${clipIndex}]`
      const duration = finiteNumber(clipElement.duration)
      clips.push({
        clipKey: path,
        clipPath: path,
        trackType,
        startTime: 0,
        duration: duration ?? 0,
        infinite: duration !== undefined && duration < 0,
        object: clipElement,
      })
    })
  }
  return clips
}

function fallbackString(property: JsonObject, key: 'event_type'): string | undefined {
  const value = property.value
  if (isJsonObject(value)) {
    const item = value[key]
    if (typeof item === 'string' && item.length > 0) return item
  }
  return undefined
}

/** 扫描整个脚本文档，返回全部事件记录（含问题与派生标记）。 */
export function eventRecords(root: JsonObject): EventRecordNode[] {
  const nodes: EventRecordNode[] = []
  const problemPool: BehaviorProblem[] = []

  const clips = scanClips(root)
  let eventTrackCount = 0
  for (const clip of clips) {
    if (clip.trackType === 'EVENT') eventTrackCount += 1
    const objects = clip.object.objects
    if (!isJsonObject(objects)) continue

    for (const objectPath of ['event', 'mod_event'] as const) {
      const property = objects[objectPath]
      if (!isJsonObject(property)) continue
      const trackType: EventTrackType = objectPath === 'event' ? 'EVENT' : 'MOD_EVENT'
      const fallbackEventType = fallbackString(property, 'event_type')
      const keyframes = property.keyframes
      if (!Array.isArray(keyframes)) continue

      const perFrame: { node: EventRecordNode; time: number }[] = []

      keyframes.forEach((frameElement, frameIndex) => {
        const framePath = `${clip.clipPath}.objects.${objectPath}.keyframes[${frameIndex}]`
        const frame = isJsonObject(frameElement) ? frameElement : null
        const timeValue = frame === null ? undefined : frame.time
        const time = finiteNumber(timeValue as JsonValue | undefined)
        const body = frame !== null && isJsonObject(frame.value) ? frame.value : null

        const problems: BehaviorProblem[] = []
        const ref: RecordRef = {
          kind: 'event',
          clipKey: clip.clipKey,
          trackType,
          key: `frame:${frameIndex}`,
        }

        if (time === undefined) {
          pushProblem(problems, 'block', CODE.sameTime, '关键帧缺少有限数字 time', framePath, clip.clipKey, ref)
        } else if (time < 0) {
          pushProblem(problems, 'block', CODE.sameTime, '事件时间不能为负数', memberPath(framePath, 'time'), clip.clipKey, ref)
        }

        const validation = trackType === 'EVENT'
          ? validateEventRecord(body ?? frameElement, { jsonPath: framePath, clipKey: clip.clipKey, trackType, objectFallbackEventType: fallbackEventType })
          : validateModEventRecord(body ?? frameElement, { jsonPath: framePath, clipKey: clip.clipKey, trackType, objectFallbackEventType: fallbackEventType })
        for (const item of validation) problems.push(item)

        const command = body !== null && typeof body.command === 'string' ? body.command : null
        const positionRaw = body === null ? undefined : body.position
        const positionResult = classifyPosition(positionRaw)
        let position: EventPosition | null = null
        if (positionResult.ok && isJsonObject(positionRaw)) {
          position = positionResult.kind === 'absolute'
            ? { kind: 'absolute', x: positionRaw.x as number, z: positionRaw.z as number }
            : { kind: 'relative', x: positionRaw.dx as number, z: positionRaw.dz as number }
        }

        const recordEventType = body !== null && typeof body.event_type === 'string' ? body.event_type : null
        const resolvedEventType = recordEventType !== null && recordEventType.length > 0
          ? recordEventType
          : fallbackEventType ?? null
        const inheritedEventType = recordEventType === null || recordEventType.length === 0

        const hasData = body !== null && Object.prototype.hasOwnProperty.call(body, 'data')
        const dataValue = body === null ? undefined : body.data
        const dataKeyCount = hasData && isJsonObject(dataValue) ? Object.keys(dataValue).length : 0

        const overDuration = time !== undefined && !clip.infinite && clip.duration > 0 && time > clip.duration
        if (overDuration) {
          pushProblem(problems, severityForContract(CODE.outOfDuration), CODE.outOfDuration,
            '记录超出片段时长，运行期编译期丢弃', memberPath(framePath, 'time'), clip.clipKey, ref)
        }

        const node: EventRecordNode = {
          ref,
          clipKey: clip.clipKey,
          clipPath: clip.clipPath,
          trackType,
          objectPath,
          frameIndex,
          time: time ?? NaN,
          body,
          command,
          commandPlaceholder: command !== null && command.length === 0,
          leadingSlash: command !== null && command.startsWith('/'),
          position,
          resolvedEventType,
          inheritedEventType,
          hasData,
          dataKeyCount,
          overDuration,
          sameTime: false,
          problems,
        }
        if (time !== undefined) {
          perFrame.push({ node, time })
        }
        nodes.push(node)
      })

      // 同刻冲突 + 非递增：同一对象内严格递增。
      const sorted = perFrame.slice().sort((a, b) => a.time - b.time)
      for (let i = 1; i < sorted.length; i += 1) {
        if (Math.abs(sorted[i].time - sorted[i - 1].time) <= 1e-6) {
          for (const entry of [sorted[i], sorted[i - 1]]) {
            entry.node.sameTime = true
            pushProblem(entry.node.problems, 'block', CODE.sameTime,
              '同一时刻多条记录：格式要求严格递增，请用 `&&` 合并命令到一条',
              memberPath(entry.node.clipPath, `objects.${objectPath}.keyframes[${entry.node.frameIndex}].time`),
              entry.node.clipKey, entry.node.ref)
          }
        } else if (sorted[i].time < sorted[i - 1].time) {
          pushProblem(sorted[i].node.problems, 'block', CODE.sameTime,
            '事件时间必须严格递增', memberPath(sorted[i].node.clipPath, `objects.${objectPath}.keyframes[${sorted[i].node.frameIndex}].time`),
            sorted[i].node.clipKey, sorted[i].node.ref)
        }
      }
    }
  }

  if (eventTrackCount > 1) {
    pushProblem(problemPool, severityForContract(CODE.multiEventTrack), CODE.multiEventTrack,
      `检测到 ${eventTrackCount} 条 EVENT 轨，建议最多一条（不自动合并）`, 'timeline.tracks')
  }

  for (const node of nodes) {
    node.problems.push(...problemPool)
  }
  return nodes
}

// ── 校验 ──────────────────────────────────────────────────────────────

function pushProblem(
  problems: BehaviorProblem[],
  severity: Severity,
  code: string,
  message: string,
  jsonPath: string,
  clipKey?: string,
  ref?: RecordRef,
): void {
  problems.push({ code, severity, message, jsonPath, clipKey, ref })
}

/** EVENT 记录体校验（独立调用；对象级回退经 options 传入）。 */
export function validateEventRecord(body: JsonValue, options: RecordValidationOptions = {}): BehaviorProblem[] {
  const problems: BehaviorProblem[] = []
  const jsonPath = options.jsonPath ?? 'event'
  if (!isJsonObject(body)) {
    pushProblem(problems, 'block', CODE.bodyShape, 'EVENT 记录体必须是对象', jsonPath, options.clipKey, eventRef(options))
    return problems
  }

  const allowed = recordAllowedKeys('EVENT')
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      pushProblem(problems, 'block', CODE.bodyShape, `未知成员 ${key}（EVENT 只接受 command / event_type / position / id）`,
        memberPath(jsonPath, key), options.clipKey, eventRef(options))
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'command')) {
    const command = body.command
    if (typeof command !== 'string') {
      pushProblem(problems, 'block', CODE.commandType, 'command 需要字符串（空串 = 占位）',
        memberPath(jsonPath, 'command'), options.clipKey, eventRef(options))
    } else if (command.startsWith('/')) {
      pushProblem(problems, severityForContract(CODE.leadingSlash), CODE.leadingSlash,
        '命令带前导斜杠：保留原文，建议去掉开头的 /', memberPath(jsonPath, 'command'), options.clipKey, eventRef(options))
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'event_type')) {
    const eventType = body.event_type
    if (typeof eventType !== 'string') {
      pushProblem(problems, 'block', CODE.eventTypeIllegal, 'event_type 需要字符串',
        memberPath(jsonPath, 'event_type'), options.clipKey, eventRef(options))
    } else if (eventType !== EVENT_COMMAND_TYPE) {
      pushProblem(problems, severityForContract(CODE.eventTypeIllegal), CODE.eventTypeIllegal,
        `EVENT 只接受 event_type=${EVENT_COMMAND_TYPE}（当前: ${eventType}）`,
        memberPath(jsonPath, 'event_type'), options.clipKey, eventRef(options))
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'position')) {
    const result = classifyPosition(body.position)
    if (!result.ok) {
      const reason = result.reason === 'not-object'
        ? 'position 需要对象 {x,z} 或 {dx,dz}'
        : result.reason === 'shape'
          ? 'position 必须恰好两个键：{x,z} 绝对或 {dx,dz} 相对，不能混写或缺键'
          : 'position 两键都必须是有限数字'
      pushProblem(problems, 'block', CODE.positionShape, reason,
        memberPath(jsonPath, 'position'), options.clipKey, eventRef(options))
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'id')) {
    const id = body.id
    if (typeof id !== 'string') {
      pushProblem(problems, 'block', CODE.idType, 'id 需要字符串（运行时忽略，不参与身份）',
        memberPath(jsonPath, 'id'), options.clipKey, eventRef(options))
    }
  }

  return problems
}

/** MOD_EVENT 记录体校验（独立调用；对象级 event_type / data 回退经 options 与对象读取链传入）。 */
export function validateModEventRecord(body: JsonValue, options: RecordValidationOptions = {}): BehaviorProblem[] {
  const problems: BehaviorProblem[] = []
  const jsonPath = options.jsonPath ?? 'mod_event'
  if (!isJsonObject(body)) {
    pushProblem(problems, 'block', CODE.modBodyShape, 'MOD_EVENT 记录体必须是对象', jsonPath, options.clipKey, eventRef(options))
    return problems
  }

  const allowed = recordAllowedKeys('MOD_EVENT')
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      const forbidden = ['command', 'position', 'id'].includes(key)
      pushProblem(problems, 'block', CODE.modForbidden,
        forbidden ? `禁止键 ${key} 属于 EVENT，不能出现在 MOD_EVENT 记录里` : `未知成员 ${key}（MOD_EVENT 只接受 event_type / data）`,
        memberPath(jsonPath, key), options.clipKey, eventRef(options))
    }
  }

  const recordEventType = typeof body.event_type === 'string' ? body.event_type : null
  if (recordEventType !== null && recordEventType.length === 0) {
    pushProblem(problems, 'block', CODE.modEventType, 'event_type 空串非法（不落回默认值）',
      memberPath(jsonPath, 'event_type'), options.clipKey, eventRef(options))
  } else if (recordEventType === null && Object.prototype.hasOwnProperty.call(body, 'event_type')) {
    pushProblem(problems, 'block', CODE.modEventType, 'event_type 需要字符串',
      memberPath(jsonPath, 'event_type'), options.clipKey, eventRef(options))
  } else if ((recordEventType === null || recordEventType.length === 0) && options.objectFallbackEventType === undefined) {
    pushProblem(problems, 'block', CODE.modEventType, 'MOD_EVENT 缺少 event_type（记录级与对象级都没有）',
      memberPath(jsonPath, 'event_type'), options.clipKey, eventRef(options))
  }

  if (Object.prototype.hasOwnProperty.call(body, 'data')) {
    const data = body.data
    if (!isJsonObject(data)) {
      pushProblem(problems, 'block', CODE.modDataObject, 'data 顶层必须是 JSON 对象（嵌套数组允许）',
        memberPath(jsonPath, 'data'), options.clipKey, eventRef(options))
    } else {
      validateDataTree(data, memberPath(jsonPath, 'data'), problems, options)
    }
  }

  return problems
}

/** `data` 递归：标量 / 数组 / 对象任意嵌套；数字必须有限。 */
function validateDataTree(value: JsonValue, path: string, problems: BehaviorProblem[], options: RecordValidationOptions): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      pushProblem(problems, 'block', CODE.modDataNumber, 'data 内数字必须有限（NaN / ±Infinity 拒绝）', path, options.clipKey, eventRef(options))
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateDataTree(item, `${path}[${index}]`, problems, options))
    return
  }
  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateDataTree(item, memberPath(path, key), problems, options)
    }
  }
}

function eventRef(options: RecordValidationOptions): RecordRef | undefined {
  if (options.clipKey === undefined) return undefined
  return { kind: 'event', clipKey: options.clipKey, trackType: options.trackType ?? 'EVENT', key: 'record' }
}

// ── 摘要 ──────────────────────────────────────────────────────────────

function formatSeconds(time: number): string {
  if (!Number.isFinite(time)) return '∞'
  const rounded = Math.round(time * 1000) / 1000
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}s`
}

function previewText(command: string): string {
  const trimmed = command.length > 24 ? `${command.slice(0, 24)}…` : command
  return trimmed
}

function positionPreview(position: EventPosition): string {
  const coord = `${position.x}, ${position.z}`
  return position.kind === 'absolute' ? `世界 (${coord})` : `相对 (${coord})`
}

/**
 * 事件记录摘要的唯一生成处。
 *
 * 形状（11-12 §五）：纯命令「时间 · 命令 …」；纯移动「时间 · 移动到 …」；两者并列；
 * 占位「时间 · 占位」；超时长标注「超出时长（运行时丢弃）」；MOD_EVENT 显示事件名与 data 键数。
 */
export function describeEventRecord(node: EventRecordNode, ctx?: ClipEventContext): string {
  const timeLabel = formatSeconds(node.time)
  if (node.overDuration) {
    return `${timeLabel} · 超出时长（运行时丢弃）`
  }

  if (node.trackType === 'MOD_EVENT') {
    const name = node.resolvedEventType ?? '缺少事件名'
    const inherit = node.inheritedEventType && node.resolvedEventType !== null ? '（继承对象级）' : ''
    const data = node.hasData ? ` · data ${node.dataKeyCount} 键` : ''
    return `${timeLabel} · ${name}${inherit}${data}`
  }

  const hasCommand = node.command !== null && node.command.length > 0
  const hasPosition = node.position !== null
  const parts: string[] = []

  if (!hasCommand && !hasPosition) {
    parts.push('占位')
  } else {
    if (hasCommand) parts.push(`命令 ${previewText(node.command as string)}`)
    if (hasPosition) parts.push(`移动到 ${positionPreview(node.position as EventPosition)}`)
  }

  const leadingSlash = node.leadingSlash ? ' · 前导斜杠警告' : ''
  const global = ctx !== undefined && Number.isFinite(node.time)
    ? `（全局 ${formatSeconds(ctx.clipStartTime + node.time)}）`
    : ''
  return `${timeLabel} · ${parts.join(' · ')}${leadingSlash}${global}`
}

// ── 时间轴标记 ────────────────────────────────────────────────────────

/** 标记类型：命令实心 / 移动空心 / 两者双色 / 占位虚线 / 扩展菱形 / 超时红。 */
export type EventMarkerKind = 'command' | 'move' | 'both' | 'placeholder' | 'extension' | 'over-duration'

export interface EventMarker {
  ref: RecordRef
  clipKey: string
  trackType: EventTrackType
  objectPath: 'event' | 'mod_event'
  localTime: number
  /** 全局时间 = 片段起点 + 局部时间；独立片段起点记 0。 */
  globalTime: number
  kind: EventMarkerKind
  label: string
  overDuration: boolean
  placeholder: boolean
}

/** 全脚本事件标记（片段起点 + 局部时间换算全局）。 */
export function eventMarkers(root: JsonObject): EventMarker[] {
  const clips = new Map<string, ClipEventContext>()
  for (const clip of scanClips(root)) {
    clips.set(clip.clipKey, {
      clipStartTime: clip.startTime,
      duration: clip.duration,
      infinite: clip.infinite,
    })
  }

  return eventRecords(root).map((node) => {
    const ctx = clips.get(node.clipKey)
    const globalTime = ctx !== undefined ? ctx.clipStartTime + node.time : node.time
    const kind = markerKind(node)
    return {
      ref: node.ref,
      clipKey: node.clipKey,
      trackType: node.trackType,
      objectPath: node.objectPath,
      localTime: node.time,
      globalTime,
      kind,
      label: describeEventRecord(node, ctx),
      overDuration: node.overDuration,
      placeholder: node.commandPlaceholder && node.position === null,
    }
  })
}

function markerKind(node: EventRecordNode): EventMarkerKind {
  if (node.overDuration) return 'over-duration'
  if (node.trackType === 'MOD_EVENT') return 'extension'
  const hasCommand = node.command !== null && node.command.length > 0
  const hasPosition = node.position !== null
  if (!hasCommand && !hasPosition) return 'placeholder'
  if (hasCommand && hasPosition) return 'both'
  return hasCommand ? 'command' : 'move'
}

// ── 标记拖动 ──────────────────────────────────────────────────────────

export interface MarkerDragInput {
  ref: RecordRef
  root: JsonObject
  /** 目标局部时间（片段局部秒）。 */
  targetLocalTime: number
}

export type MarkerDragResult =
  | { ok: true; localTime: number }
  | { ok: false; reason: string }

/**
 * 拖动标记：只改局部时间。
 * 边界：有限、非负；有限片段内不越界；同刻不可占用；不可改命令 / 位置等其它字段。
 * 本函数只判定与返回目标时间，不提交写盘命令。
 */
export function markerDrag(input: MarkerDragInput): MarkerDragResult {
  const { ref, root, targetLocalTime } = input
  if (ref.kind !== 'event') return { ok: false, reason: '只能拖动事件记录标记' }
  if (!isFiniteNumber(targetLocalTime)) return { ok: false, reason: '时间必须是有限数字' }
  if (targetLocalTime < 0) return { ok: false, reason: '事件时间不能为负数' }

  const clips = scanClips(root)
  const clip = clips.find((item) => item.clipKey === ref.clipKey)
  if (clip === undefined) return { ok: false, reason: '片段不存在' }
  if (!clip.infinite && clip.duration > 0 && targetLocalTime > clip.duration) {
    return { ok: false, reason: `超出片段时长 ${clip.duration}s（新建 / 移动记录必须落在时长内）` }
  }

  const siblings = eventRecords(root).filter((node) =>
    node.clipKey === ref.clipKey && node.objectPath === (ref.trackType === 'EVENT' ? 'event' : 'mod_event')
      && recordRefKey(node.ref) !== recordRefKey(ref))
  if (siblings.some((node) => Math.abs(node.time - targetLocalTime) <= 1e-6)) {
    return { ok: false, reason: `该时间已有一条记录（t=${targetLocalTime}），同刻冲突被拒绝` }
  }
  return { ok: true, localTime: targetLocalTime }
}

/** 该对象是否只剩一条记录（唯一记录不能删；删最后一条由命令层拒绝，这里给面板预判）。 */
export function isLastRecord(nodes: readonly EventRecordNode[], ref: RecordRef): boolean {
  if (ref.kind !== 'event') return false
  const sameObject = nodes.filter((node) =>
    node.clipKey === ref.clipKey && node.objectPath === (ref.trackType === 'EVENT' ? 'event' : 'mod_event'))
  return sameObject.length <= 1
}

// ── seek / 触发语义常量表（面板与验收共用）────────────────────────────

export interface SeekSemanticEntry {
  id: string
  title: string
  detail: string
  sourceRef: SourceRef
}

const RUNTIME = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventClipRuntime.java'
const KEY = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventKey.java'
const PLAN_1114 = 'plan/11/11-14-event-timeline-and-seek.md'

/** 触发与 seek 语义（11-14 §四）；每条带运行时出处。 */
export const SEEK_SEMANTICS: readonly SeekSemanticEntry[] = [
  {
    id: 'first-advance-from-neg-inf',
    title: '首次推进从 -inf 开始',
    detail: '游标初始扫描位置为负无穷；第一次推进时区间左端是 -inf，片段内任何非负记录都在区间内。',
    sourceRef: { file: RUNTIME, line: 41, symbol: 'scannedThrough' },
  },
  {
    id: 'time-zero-fires-on-first-advance',
    title: '0 秒记录第一次推进触发',
    detail: 'time=0 的记录在第一次推进时触发；预览停在 0 秒不会先跑它，只有新实例首次推进或回退重放路径才会再触发。',
    sourceRef: { file: RUNTIME, line: 24, symbol: 'advance' },
  },
  {
    id: 'half-open-interval-once',
    title: '区间左开右闭，每条最多一次',
    detail: '一次推进只触发 `(上次推进到的局部时间, to]` 内的记录；每条记录在本播放实例内最多触发一次。',
    sourceRef: { file: RUNTIME, line: 22, symbol: 'advance' },
  },
  {
    id: 'no-replay-on-loop-or-multi-entry',
    title: '循环 / 宏观循环 / 多入口不重放已触发记录',
    detail: '记录身份 = 播放实例 + 片段 + 对象路径 + 事件下标；循环回到起点不重置已触发集合，两个播放实例或两个内容相同的片段互不重放。',
    sourceRef: { file: KEY, line: 22, symbol: 'EventKey' },
  },
  {
    id: 'pingpong-rejected',
    title: '乒乓模式用在事件轨被拒绝',
    detail: '事件没有反向时间语义；loop_mode=pingpong 不允许出现在 EVENT / MOD_EVENT 轨上。',
    sourceRef: { file: PLAN_1114, line: 49, symbol: '乒乓拒绝' },
  },
  {
    id: 'seek-forward-no-catch-up',
    title: 'seek 前跳不补触发；后跳可再触发目标之后',
    detail: 'seek 越过若干事件不补跑；回退到更早位置时，只有目标时间之后、尚未触发的记录会在后续推进中触发。',
    sourceRef: { file: RUNTIME, line: 25, symbol: 'reset' },
  },
  {
    id: 'target-moment-itself-does-not-fire',
    title: '目标时刻本身不触发',
    detail: 'reset 把游标停在 time <= 目标时刻的最后一条之后；目标时刻本身及更早的记录不在 seek 后补触发。',
    sourceRef: { file: RUNTIME, line: 173, symbol: 'reset' },
  },
]

/** 目录层引用导出（供 facts / 面板复用，不重复声明字段表）。 */
export type { CatalogSourceRef }
