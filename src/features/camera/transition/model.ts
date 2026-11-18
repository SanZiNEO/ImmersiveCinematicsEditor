/**
 * 08-02 叠化与参数过渡模型（纯派生 + 纯命令构造）。
 *
 * 只做三件事：
 * 1. 由文档视图派生「交界」（同一 CAMERA 轨道内数组顺序相邻的两段）；
 * 2. 解释交界当前是硬切 / 叠化 / 参数过渡 / 共存 / 结构不完整，以及窗口与遮蔽区间；
 * 3. 生成落盘命令（B 的落点 + B 的不透明度两端帧；出场片段 `transition*` 四个字段）。
 *
 * 不读 store、不写文档、不提交；所有函数同输入同输出。
 */
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { ScriptView, ClipViewEntry, TrackViewEntry } from '../../../workbench/api/documents.ts'
import type { JsonObject, JsonValue, ObjectKeyframe } from '../../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject } from '../../../core/doc/json.ts'

/** CAMERA 轨道类型（`TrackTypeId.CAMERA`）。 */
export const CAMERA_TRACK_TYPE = 'CAMERA'

/** 六个过渡通道，位序 = 运行时数组下标（`CameraChannels.NAMES`）。 */
export const TRANSITION_CHANNELS = ['position', 'yaw', 'pitch', 'roll', 'fov', 'zoom'] as const

export type TransitionChannel = (typeof TRANSITION_CHANNELS)[number]

/** 通道显示名（只影响界面文案）。 */
export const TRANSITION_CHANNEL_LABELS: Readonly<Record<TransitionChannel, string>> = {
  position: '位置',
  yaw: '偏航',
  pitch: '俯仰',
  roll: '翻滚',
  fov: '视场',
  zoom: '变焦',
}

/** 片段级过渡类型（`TrackSchemas#cameraObjects:304-305`，缺省 `cut`）。 */
export const TRANSITION_TYPES = ['cut', 'morph'] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]

/** 分通道模式（`TransitionMode`）。 */
export const TRANSITION_MODES = ['blend', 'hold', 'cut'] as const
export type TransitionChannelMode = (typeof TRANSITION_MODES)[number]

/** 打断方式（`TransitionInterrupt`：`blend` / `snap`，缺省 `blend`）。 */
export const TRANSITION_INTERRUPTS = ['blend', 'snap'] as const
export type TransitionInterrupt = (typeof TRANSITION_INTERRUPTS)[number]

/** 过渡字段路径（与 `TrackSchemas` 逐字一致）。 */
export const TRANSITION_PATHS = {
  type: 'transition',
  duration: 'transition_duration',
  curve: 'transition_curve',
  params: 'transition_params',
  interrupt: 'transition_interrupt',
} as const

/** 合成参数路径（与 `TrackSchemas` 逐字一致；`composite` 只是 section 名，不是前缀）。 */
export const COMPOSITE_PATHS = {
  opacity: 'opacity',
  destX: 'dest.x',
  destY: 'dest.y',
  destW: 'dest.w',
  destH: 'dest.h',
  sourceX: 'source.x',
  sourceY: 'source.y',
  sourceW: 'source.w',
  sourceH: 'source.h',
  maskX: 'mask_x',
  maskY: 'mask_y',
  maskWidth: 'mask_width',
  maskHeight: 'mask_height',
  maskRadius: 'mask_radius',
  maskShape: 'mask_shape',
  dimension: 'dimension',
} as const

/** 片段级时长缺省（`TrackSchemas#cameraObjects:306`：`0.5`，min 0）。 */
export const DEFAULT_TRANSITION_DURATION = 0.5

/** 缺省过渡类型。 */
export const DEFAULT_TRANSITION_TYPE: TransitionType = 'cut'

/** 缺省打断方式。 */
export const DEFAULT_TRANSITION_INTERRUPT: TransitionInterrupt = 'blend'

/** 叠化落点的比较精度（秒）。 */
const EPSILON = 1e-6

// ── 文档读取 ───────────────────────────────────────────────

/** 读一个属性对象的 `value`（没有 `value` 返回 `undefined`）。 */
function propertyValue(objects: JsonObject, path: string): JsonValue | undefined {
  const raw = objects[path]
  return isJsonObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : undefined
}

/** 读一个属性的关键帧（非数组 = 空）。 */
function propertyFrames(objects: JsonObject, path: string): ObjectKeyframe[] {
  const raw = objects[path]
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return []
  }
  const frames: ObjectKeyframe[] = []
  for (const frame of raw.keyframes) {
    if (isJsonObject(frame) && isFiniteNumber(frame.time)) {
      frames.push({ time: frame.time, value: frame.value })
    }
  }
  frames.sort((left, right) => left.time - right.time)
  return frames
}

/** 读数字：静态值优先，缺省给 `fallback`。 */
export function readNumberPath(objects: JsonObject, path: string, fallback: number): number {
  const value = propertyValue(objects, path)
  return isFiniteNumber(value) ? value : fallback
}

/** 读字符串。 */
export function readStringPath(objects: JsonObject, path: string, fallback: string): string {
  const value = propertyValue(objects, path)
  return typeof value === 'string' ? value : fallback
}

/** 读结构对象（`value` 必须是对象）。 */
export function readStructPath(objects: JsonObject, path: string): JsonObject | null {
  const value = propertyValue(objects, path)
  return isJsonObject(value) ? value : null
}

// ── 片段快照 ───────────────────────────────────────────────

/** 一个片段在交界派生里的只读快照。 */
export interface TransitionClip {
  clipKey: string
  clipId?: string
  trackId: string
  trackIndex: number
  clipIndex: number
  start: number
  duration: number
  loop: boolean
  loopCount?: number
  /** 无限片段（`duration < 0` 或 `loop && loop_count < 0`）。 */
  infinite: boolean
  label: string
  objects: JsonObject
  /** `opacity` 的关键帧（升序）。 */
  opacityFrames: ObjectKeyframe[]
  /** `opacity` 静态值（没有 = `null`）。 */
  opacityStatic: number | null
  /** 片段内循环（`loop=true`）。 */
  internalLoop: boolean
}

/** 从只读视图 + 片段原始 `objects` 造片段快照。 */
export function makeTransitionClip(
  track: TrackViewEntry,
  clip: ClipViewEntry,
  clipIndex: number,
  clipKey: string,
  objects: JsonObject,
): TransitionClip {
  const opacityValue = propertyValue(objects, COMPOSITE_PATHS.opacity)
  return {
    clipKey,
    ...(clip.clipId === undefined ? {} : { clipId: clip.clipId }),
    trackId: track.trackId,
    trackIndex: track.index,
    clipIndex,
    start: clip.start,
    duration: clip.duration,
    loop: clip.loop,
    ...(clip.loopCount === undefined ? {} : { loopCount: clip.loopCount }),
    infinite: clip.infinite,
    label: clip.label,
    objects,
    opacityFrames: propertyFrames(objects, COMPOSITE_PATHS.opacity),
    opacityStatic: isFiniteNumber(opacityValue) ? opacityValue : null,
    internalLoop: clip.loop,
  }
}

// ── 诊断 ───────────────────────────────────────────────────

/** 诊断级别。 */
export type TransitionSeverity = 'error' | 'warning' | 'info'

/** 一条交界 / 面板诊断。 */
export interface TransitionIssue {
  severity: TransitionSeverity
  code: string
  message: string
  clipKey?: string
  /** 对象路径（定位到字段用）。 */
  objectPath?: string
}

/** 按级别排序（error → warning → info）。 */
export function sortIssues(issues: readonly TransitionIssue[]): TransitionIssue[] {
  const rank: Record<TransitionSeverity, number> = { error: 0, warning: 1, info: 2 }
  return [...issues].sort((left, right) => rank[left.severity] - rank[right.severity])
}

/** 是否有 error。 */
export function hasError(issues: readonly TransitionIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

// ── 布局与门禁 ─────────────────────────────────────────────

/** 交界布局（全局秒）。 */
export interface BoundaryLayout {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
  /** 交界时刻 = A 的结束（A 有限时才有意义）。 */
  boundaryTime: number
  /** 重叠区起止；无重叠时为 `null`。 */
  overlapStart: number | null
  overlapEnd: number | null
  /** 重叠时长；无重叠为 0。 */
  overlapDuration: number
}

/** 片段是否全屏（`dest` / `source` 都是 0,0,1,1 且无关键帧）。 */
export function isFullScreen(clip: TransitionClip): boolean {
  const checks: Array<[string, number]> = [
    [COMPOSITE_PATHS.destX, 0],
    [COMPOSITE_PATHS.destY, 0],
    [COMPOSITE_PATHS.destW, 1],
    [COMPOSITE_PATHS.destH, 1],
    [COMPOSITE_PATHS.sourceX, 0],
    [COMPOSITE_PATHS.sourceY, 0],
    [COMPOSITE_PATHS.sourceW, 1],
    [COMPOSITE_PATHS.sourceH, 1],
  ]
  for (const [path, expected] of checks) {
    if (propertyFrames(clip.objects, path).length > 0) {
      return false
    }
    if (Math.abs(readNumberPath(clip.objects, path, expected) - expected) > EPSILON) {
      return false
    }
  }
  return true
}

/** 片段的不透明度是否恒为 1（无关键帧时看静态值，缺省 = 1）。 */
export function opacityIsConstantOne(clip: TransitionClip): boolean {
  if (clip.opacityFrames.length > 0) {
    return clip.opacityFrames.every((frame) => isFiniteNumber(frame.value) && Math.abs(frame.value - 1) <= EPSILON)
  }
  return Math.abs((clip.opacityStatic ?? 1) - 1) <= EPSILON
}

/** 遮罩是否 `full`（`mask_shape` 是 value-only 枚举）。 */
export function maskIsFull(clip: TransitionClip): boolean {
  return readStringPath(clip.objects, COMPOSITE_PATHS.maskShape, 'full') === 'full'
}

// ── 叠化视图 ───────────────────────────────────────────────

/** 一个交界的叠化状态。 */
export interface CrossfadeView {
  /** 落点是否已经重叠（> 0 秒）。 */
  overlap: boolean
  /** 重叠区是否可被识别为叠化（B 两端帧 0 → 1、A 恒 1）。 */
  identified: boolean
  /** 重叠时长（秒）。 */
  duration: number
  /** A 在重叠区是否恒不透明。 */
  aOpacityConstantOne: boolean
  /** B 本地 0 处是否为 0。 */
  bStartFrameZero: boolean
  /** B 本地 D 处是否为 1。 */
  bEndFrameOne: boolean
  /** 结构级错误（与 D 无关）。 */
  structural: TransitionIssue[]
}

/** 读 B 在本地时间 `time` 的不透明度帧（容差内）。 */
function frameAt(frames: readonly ObjectKeyframe[], time: number): ObjectKeyframe | undefined {
  return frames.find((frame) => Math.abs(frame.time - time) <= EPSILON)
}

/** 由两段造叠化视图。 */
export function buildCrossfadeView(a: TransitionClip, b: TransitionClip, boundaryTime: number): CrossfadeView {
  const overlapDuration = a.infinite ? 0 : Math.max(0, boundaryTime - b.start)
  const overlap = overlapDuration > EPSILON
  const structural: TransitionIssue[] = []

  if (a.infinite) {
    structural.push({
      severity: 'error',
      code: 'crossfade.infinite',
      message: 'A 是无限片段：没有确定的交界时刻，不能叠化',
      clipKey: a.clipKey,
    })
  }
  for (const [clip, role] of [[a, 'A'], [b, 'B']] as const) {
    if (clip.infinite) {
      structural.push({
        severity: 'error',
        code: 'crossfade.infinite',
        message: `${role} 是无限片段：叠化要求两段都有限`,
        clipKey: clip.clipKey,
      })
    }
    if (!isFullScreen(clip)) {
      structural.push({
        severity: 'error',
        code: 'crossfade.not-fullscreen',
        message: `${role} 不是全屏（dest / source 必须是 0,0,1,1 且无关键帧）`,
        clipKey: clip.clipKey,
        objectPath: COMPOSITE_PATHS.destX,
      })
    }
    if (clip.internalLoop) {
      structural.push({
        severity: 'error',
        code: 'crossfade.loop',
        message: `${role} 开启了片段内循环：叠化要求非片段内循环`,
        clipKey: clip.clipKey,
      })
    }
  }
  if (!opacityIsConstantOne(a)) {
    structural.push({
      severity: 'error',
      code: 'crossfade.opacity-a',
      message: 'A 的不透明度不是恒为 1：双层半透明会漏出第三层底色',
      clipKey: a.clipKey,
      objectPath: COMPOSITE_PATHS.opacity,
    })
  }
  if (!maskIsFull(b)) {
    structural.push({
      severity: 'error',
      code: 'crossfade.mask-b',
      message: 'B 的遮罩不是 full：叠化要求 B 全屏进入',
      clipKey: b.clipKey,
      objectPath: COMPOSITE_PATHS.maskShape,
    })
  }

  const startFrame = frameAt(b.opacityFrames, 0)
  const endFrame = frameAt(b.opacityFrames, overlapDuration)
  const bStartFrameZero = startFrame !== undefined && isFiniteNumber(startFrame.value) && Math.abs(startFrame.value) <= EPSILON
  const bEndFrameOne = endFrame !== undefined && isFiniteNumber(endFrame.value) && Math.abs(endFrame.value - 1) <= EPSILON
  const aOpacityConstantOne = opacityIsConstantOne(a)
  return {
    overlap,
    identified: overlap && bStartFrameZero && bEndFrameOne && aOpacityConstantOne,
    duration: overlapDuration,
    aOpacityConstantOne,
    bStartFrameZero,
    bEndFrameOne,
    structural: sortIssues(structural),
  }
}

/** 叠化时长校验（D 相关）。返回错误列表；空 = 可用。 */
export function validateCrossfadeDuration(a: TransitionClip, b: TransitionClip, duration: number): TransitionIssue[] {
  const issues: TransitionIssue[] = []
  if (!Number.isFinite(duration)) {
    return [{ severity: 'error', code: 'crossfade.duration', message: '叠化时长必须是有限数字' }]
  }
  if (duration <= EPSILON) {
    issues.push({ severity: 'error', code: 'crossfade.duration', message: '叠化时长必须大于 0' })
  }
  const upper = Math.min(a.infinite ? 0 : a.duration, b.infinite ? 0 : b.duration)
  if (duration > upper + EPSILON) {
    issues.push({
      severity: 'error',
      code: 'crossfade.duration',
      message: `叠化时长不能超过两段时长的较小者（上限 ${formatSeconds(upper)} 秒）`,
    })
  }
  return issues
}

/** 秒数显示（三位小数，去掉多余的 0）。 */
export function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return String(Math.round(value * 1000) / 1000)
}

// ── 参数过渡视图 ───────────────────────────────────────────

/** 一个通道的解析结果。 */
export interface ChannelView {
  channel: TransitionChannel
  label: string
  /** 显式声明的模式（`undefined` = 继承缺省 blend）。 */
  declaredMode?: TransitionChannelMode
  /** 解析后的模式。 */
  mode: TransitionChannelMode
  /** 显式声明的时长（`undefined` = 继承片段级）。 */
  declaredDuration?: number
  /** 解析后的时长（cut = 0）。 */
  duration: number
  /** 显式声明的曲线（`null` = 继承片段级）。 */
  declaredCurve: JsonValue | null
  /** 是否有任一显式键。 */
  overridden: boolean
}

/** 过渡窗口（全局秒）。 */
export interface TransitionWindow {
  start: number
  end: number
  /** 窗口总宽（秒）。 */
  width: number
  /** 窗口是否被片段范围截断（只作提示）。 */
  truncated: boolean
  /** 半宽来源：非 cut 通道的最大有效时长。 */
  halfWidth: number
}

/** 一个交界的参数过渡状态。 */
export interface ParamView {
  /** 出场片段的过渡类型。 */
  type: TransitionType
  /** 片段级时长声明（`null` = 未声明 → 运行时 0.5）。 */
  declaredDuration: number | null
  /** 片段级时长实际值。 */
  duration: number
  /** 显式曲线（`null` = 线性）。 */
  curve: JsonValue | null
  interrupt: TransitionInterrupt
  channels: ChannelView[]
  /** 窗口（无窗口 = `null`）。 */
  window: TransitionWindow | null
  /** 文档层诊断（未知通道 / 未知键 / 非法值）。 */
  issues: TransitionIssue[]
}

/** 读分通道声明。 */
function readChannelDeclarations(objects: JsonObject): {
  params: JsonObject | null
  issues: TransitionIssue[]
} {
  const raw = readStructPath(objects, TRANSITION_PATHS.params)
  if (raw === null) {
    return { params: null, issues: [] }
  }
  const issues: TransitionIssue[] = []
  for (const key of Object.keys(raw)) {
    if (!(TRANSITION_CHANNELS as readonly string[]).includes(key)) {
      issues.push({
        severity: 'warning',
        code: 'param.unknown-channel',
        message: `未知通道 ${key}：运行时会忽略，编辑器保留原值`,
        objectPath: `${TRANSITION_PATHS.params}.${key}`,
      })
      continue
    }
    const channel = raw[key]
    if (!isJsonObject(channel)) {
      issues.push({
        severity: 'warning',
        code: 'param.channel-shape',
        message: `通道 ${key} 不是对象：运行时按未声明处理，编辑器保留原值`,
        objectPath: `${TRANSITION_PATHS.params}.${key}`,
      })
      continue
    }
    for (const field of Object.keys(channel)) {
      if (field !== 'mode' && field !== 'duration' && field !== 'curve') {
        issues.push({
          severity: 'warning',
          code: 'param.unknown-key',
          message: `通道 ${key} 的未知键 ${field}：解析器会拒绝，编辑器保留原值`,
          objectPath: `${TRANSITION_PATHS.params}.${key}.${field}`,
        })
      }
    }
  }
  return { params: raw, issues }
}

/** 读片段级过渡声明并合成每通道的最终模式 / 时长 / 曲线。 */
export function buildParamView(a: TransitionClip, boundaryTime: number): ParamView {
  const issues: TransitionIssue[] = []
  const rawType = readStringPath(a.objects, TRANSITION_PATHS.type, DEFAULT_TRANSITION_TYPE)
  const type: TransitionType = rawType === 'morph' ? 'morph' : 'cut'
  if (rawType !== 'cut' && rawType !== 'morph') {
    issues.push({
      severity: 'warning',
      code: 'param.type',
      message: `未知过渡类型 ${rawType}：按 cut 解释，编辑器保留原值`,
      clipKey: a.clipKey,
      objectPath: TRANSITION_PATHS.type,
    })
  }

  const durationValue = propertyValue(a.objects, TRANSITION_PATHS.duration)
  const declaredDuration = isFiniteNumber(durationValue) ? durationValue : null
  if (durationValue !== undefined && !isFiniteNumber(durationValue)) {
    issues.push({
      severity: 'warning',
      code: 'param.duration',
      message: '过渡时长不是有限数字：解析器会拒绝，编辑器保留原值',
      clipKey: a.clipKey,
      objectPath: TRANSITION_PATHS.duration,
    })
  }
  if (declaredDuration !== null && declaredDuration < 0) {
    issues.push({
      severity: 'error',
      code: 'param.duration',
      message: '过渡时长不能为负（0 = 无窗口）',
      clipKey: a.clipKey,
      objectPath: TRANSITION_PATHS.duration,
    })
  }
  const clipDuration = declaredDuration === null ? DEFAULT_TRANSITION_DURATION : declaredDuration
  const fallback = Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : 0

  const curve = readStructPath(a.objects, TRANSITION_PATHS.curve)
  const rawInterrupt = readStringPath(a.objects, TRANSITION_PATHS.interrupt, DEFAULT_TRANSITION_INTERRUPT)
  const interrupt: TransitionInterrupt = rawInterrupt === 'snap' ? 'snap' : 'blend'
  if (rawInterrupt !== 'blend' && rawInterrupt !== 'snap') {
    issues.push({
      severity: 'warning',
      code: 'param.interrupt',
      message: `未知打断方式 ${rawInterrupt}：按 blend 解释，编辑器保留原值`,
      clipKey: a.clipKey,
      objectPath: TRANSITION_PATHS.interrupt,
    })
  }

  const { params, issues: paramIssues } = readChannelDeclarations(a.objects)
  issues.push(...paramIssues)

  const channels: ChannelView[] = TRANSITION_CHANNELS.map((channel) => {
    const declaration = params !== null && isJsonObject(params[channel]) ? params[channel] : null
    const declaredModeRaw = declaration === null ? undefined : declaration.mode
    let declaredMode: TransitionChannelMode | undefined
    if (declaredModeRaw !== undefined) {
      if (typeof declaredModeRaw === 'string' && (TRANSITION_MODES as readonly string[]).includes(declaredModeRaw)) {
        declaredMode = declaredModeRaw as TransitionChannelMode
      } else {
        issues.push({
          severity: 'warning',
          code: 'param.mode',
          message: `通道 ${channel} 的模式非法（${String(declaredModeRaw)}）：按未声明处理`,
          clipKey: a.clipKey,
          objectPath: `${TRANSITION_PATHS.params}.${channel}.mode`,
        })
      }
    }
    const declaredDurationRaw = declaration === null ? undefined : declaration.duration
    let declaredDuration: number | undefined
    if (declaredDurationRaw !== undefined) {
      if (isFiniteNumber(declaredDurationRaw)) {
        declaredDuration = declaredDurationRaw
        if (declaredDurationRaw <= 0) {
          issues.push({
            severity: 'error',
            code: 'param.channel-duration',
            message: `通道 ${channel} 的时长必须是有限正数（不占窗口请用 cut）`,
            clipKey: a.clipKey,
            objectPath: `${TRANSITION_PATHS.params}.${channel}.duration`,
          })
        }
      } else {
        issues.push({
          severity: 'warning',
          code: 'param.channel-duration',
          message: `通道 ${channel} 的时长不是有限数字：解析器会拒绝，编辑器保留原值`,
          clipKey: a.clipKey,
          objectPath: `${TRANSITION_PATHS.params}.${channel}.duration`,
        })
      }
    }
    const declaredCurveRaw = declaration === null ? undefined : declaration.curve
    const declaredCurve: JsonValue | null = isJsonObject(declaredCurveRaw) ? declaredCurveRaw : null
    if (declaredCurveRaw !== undefined && !isJsonObject(declaredCurveRaw)) {
      issues.push({
        severity: 'warning',
        code: 'param.channel-curve',
        message: `通道 ${channel} 的曲线不是对象：解析器会拒绝，编辑器保留原值`,
        clipKey: a.clipKey,
        objectPath: `${TRANSITION_PATHS.params}.${channel}.curve`,
      })
    }

    const mode: TransitionChannelMode = declaredMode ?? 'blend'
    const resolved = declaredDuration !== undefined && declaredDuration > 0 ? declaredDuration : fallback
    return {
      channel,
      label: TRANSITION_CHANNEL_LABELS[channel],
      ...(declaredMode === undefined ? {} : { declaredMode }),
      mode,
      ...(declaredDuration === undefined ? {} : { declaredDuration }),
      duration: mode === 'cut' ? 0 : resolved,
      declaredCurve,
      overridden: declaredMode !== undefined || declaredDuration !== undefined || declaredCurve !== null,
    }
  })

  const window = buildWindow(a, type, boundaryTime, channels)
  return {
    type,
    declaredDuration,
    duration: clipDuration,
    curve,
    interrupt,
    channels,
    window,
    issues: sortIssues(issues),
  }
}

/** 窗口：以交界为中心、前后各取非 cut 通道最大有效时长的一半。 */
export function buildWindow(
  a: TransitionClip,
  type: TransitionType,
  boundaryTime: number,
  channels: readonly ChannelView[],
): TransitionWindow | null {
  if (type !== 'morph' || a.infinite) {
    return null
  }
  let halfWidth = 0
  for (const channel of channels) {
    if (channel.mode === 'cut') {
      continue
    }
    if (channel.duration > halfWidth) {
      halfWidth = channel.duration
    }
  }
  if (halfWidth <= EPSILON) {
    return null
  }
  const width = halfWidth
  const half = width / 2
  const start = boundaryTime - half
  const end = boundaryTime + half
  const clipStart = a.start
  const clipEnd = a.infinite ? Number.POSITIVE_INFINITY : a.start + a.duration
  const truncated = start < clipStart - EPSILON || end > clipEnd + EPSILON
  return { start, end, width, halfWidth: half, truncated }
}

/** 通道有效时长（供界面显示"窗口宽度由谁决定"）。 */
export function effectiveChannelDurations(param: ParamView): Array<{ channel: TransitionChannel; duration: number }> {
  return param.channels
    .filter((channel) => channel.mode !== 'cut')
    .map((channel) => ({ channel: channel.channel, duration: channel.duration }))
}

// ── 交界 ───────────────────────────────────────────────────

/** 交界状态。 */
export type BoundaryState = 'hard-cut' | 'crossfade' | 'morph' | 'coexist' | 'broken'

/** 共存遮蔽。 */
export interface CoexistView {
  /** 重叠区与 morph 窗口的关系。 */
  coverage: 'none' | 'partial' | 'full'
  /** morph 与重叠区相交的区间（无 = `null`）。 */
  morphStart: number | null
  morphEnd: number | null
  /** 是否有 morph 窗口。 */
  hasMorph: boolean
  /** 是否有叠化。 */
  hasCrossfade: boolean
}

/** 一个交界。 */
export interface TransitionBoundary {
  id: string
  trackId: string
  trackIndex: number
  trackName: string
  a: TransitionClip
  b: TransitionClip
  boundaryTime: number
  layout: BoundaryLayout
  crossfade: CrossfadeView
  param: ParamView
  coexist: CoexistView
  state: BoundaryState
  issues: TransitionIssue[]
}

/** 交界身份（稳定键：两段 clipKey）。 */
export function boundaryIdOf(a: TransitionClip, b: TransitionClip): string {
  return `${a.clipKey}->${b.clipKey}`
}

/** 由两段造一个交界（含状态与诊断）。 */
export function buildBoundary(
  track: TrackViewEntry,
  a: TransitionClip,
  b: TransitionClip,
): TransitionBoundary {
  const boundaryTime = a.infinite ? a.start : a.start + a.duration
  const opacityDuration = Math.max(0, boundaryTime - b.start)
  const layout: BoundaryLayout = {
    aStart: a.start,
    aEnd: a.infinite ? Number.POSITIVE_INFINITY : a.start + a.duration,
    bStart: b.start,
    bEnd: b.infinite ? Number.POSITIVE_INFINITY : b.start + b.duration,
    boundaryTime,
    overlapStart: opacityDuration > EPSILON ? b.start : null,
    overlapEnd: opacityDuration > EPSILON ? boundaryTime : null,
    overlapDuration: opacityDuration,
  }
  const crossfade = buildCrossfadeView(a, b, boundaryTime)
  const param = buildParamView(a, boundaryTime)
  const hasMorph = param.window !== null
  const morphStart = param.window === null ? null : Math.max(param.window.start, layout.overlapStart ?? param.window.start)
  const morphEnd = param.window === null ? null : Math.min(param.window.end, layout.overlapEnd ?? param.window.end)
  const intersect = morphStart !== null && morphEnd !== null && morphEnd - morphStart > EPSILON
  let coverage: CoexistView['coverage'] = 'none'
  if (intersect && layout.overlapStart !== null && layout.overlapEnd !== null) {
    const full = morphStart! <= layout.overlapStart + EPSILON && morphEnd! >= layout.overlapEnd - EPSILON
    coverage = full ? 'full' : 'partial'
  }
  const coexist: CoexistView = {
    coverage,
    morphStart: intersect ? morphStart : null,
    morphEnd: intersect ? morphEnd : null,
    hasMorph,
    hasCrossfade: crossfade.identified,
  }

  const issues: TransitionIssue[] = [...crossfade.structural, ...param.issues]
  for (const issue of param.issues) {
    if (issue.clipKey === undefined) {
      issue.clipKey = a.clipKey
    }
  }

  let state: BoundaryState
  if (crossfade.identified && hasMorph) {
    state = 'coexist'
  } else if (crossfade.identified) {
    state = 'crossfade'
  } else if (hasMorph) {
    state = 'morph'
  } else if (crossfade.overlap || hasError(issues)) {
    state = 'broken'
  } else {
    state = 'hard-cut'
  }

  if (crossfade.overlap && !crossfade.identified) {
    issues.push({
      severity: 'error',
      code: 'crossfade.unidentified',
      message: '两段已重叠，但 B 的不透明度不是 0→1 两端帧或 A 不是恒不透明：无法识别为叠化',
      clipKey: b.clipKey,
      objectPath: COMPOSITE_PATHS.opacity,
    })
  }
  if (crossfade.identified && hasMorph && coverage !== 'none') {
    issues.push({
      severity: 'info',
      code: 'coexist.occlusion',
      message: coverage === 'full'
        ? '窗口覆盖整个重叠区：叠化在回放中不可见（只出一条 morph lane）'
        : '窗口只覆盖部分重叠区：窗口外仍是 A/B 两条 lane 的叠化',
      clipKey: a.clipKey,
    })
  }
  if (hasMorph && param.window !== null && layout.overlapStart !== null && param.window.start < (layout.overlapEnd ?? 0) && param.window.end > (layout.overlapStart ?? 0)) {
    issues.push({
      severity: 'warning',
      code: 'coexist.param-window',
      message: 'B 自己的参数过渡窗口伸进重叠区：回放可能先走 B 的 morph lane',
      clipKey: b.clipKey,
    })
  }

  return {
    id: boundaryIdOf(a, b),
    trackId: track.trackId,
    trackIndex: track.index,
    trackName: track.name,
    a,
    b,
    boundaryTime,
    layout,
    crossfade,
    param,
    coexist,
    state,
    issues: sortIssues(issues),
  }
}

/** 整个文档的交界视图。 */
export interface TransitionDocumentView {
  boundaries: TransitionBoundary[]
  cameraTrackCount: number
  coexistCount: number
  crossfadeCount: number
  morphCount: number
}

/** 由脚本视图派生全部 CAMERA 交界（按轨道数组顺序取相邻对，不按时间重排）。 */
export function buildTransitionView(
  view: ScriptView,
  objectsOf: (clipKey: string) => JsonObject | null,
): TransitionDocumentView {
  const boundaries: TransitionBoundary[] = []
  let cameraTrackCount = 0
  for (const track of view.tracks) {
    if (track.type !== CAMERA_TRACK_TYPE || track.clips.length === 0) {
      continue
    }
    cameraTrackCount += 1
    const clips: TransitionClip[] = []
    for (let index = 0; index < track.clips.length; index += 1) {
      const clip = track.clips[index]
      const objects = objectsOf(clip.clipKey)
      if (objects === null) {
        continue
      }
      clips.push(makeTransitionClip(track, clip, index, clip.clipKey, objects))
    }
    for (let index = 0; index + 1 < clips.length; index += 1) {
      boundaries.push(buildBoundary(track, clips[index], clips[index + 1]))
    }
  }
  return {
    boundaries,
    cameraTrackCount,
    coexistCount: boundaries.filter((boundary) => boundary.state === 'coexist').length,
    crossfadeCount: boundaries.filter((boundary) => boundary.crossfade.identified).length,
    morphCount: boundaries.filter((boundary) => boundary.param.window !== null).length,
  }
}

// ── 命令构造 ───────────────────────────────────────────────

/** 叠化应用：B 的落点 + B 的不透明度两端帧。 */
export function buildCrossfadeCommands(boundary: TransitionBoundary, duration: number): DocCommand[] {
  const target = boundary.layout.boundaryTime - duration
  const merged = mergeCrossfadeFrames(boundary.b.opacityFrames, duration)
  return [
    { kind: 'clip.setStart', clipKey: boundary.b.clipKey, value: target },
    { kind: 'object.setKeyframes', clipKey: boundary.b.clipKey, path: COMPOSITE_PATHS.opacity, keyframes: merged },
  ]
}

/** 应用叠化会替换多少个重叠区帧（提示用）。 */
export function countReplacedFrames(boundary: TransitionBoundary, duration: number): number {
  const frames = boundary.b.opacityFrames
  return frames.filter((frame) => frame.time >= -EPSILON && frame.time <= duration + EPSILON).length
}

/** 合并：区间内替换成 0 / 1 两端，区间外原样保留。 */
export function mergeCrossfadeFrames(frames: readonly ObjectKeyframe[], duration: number): ObjectKeyframe[] {
  const kept = frames.filter((frame) => frame.time < -EPSILON || frame.time > duration + EPSILON)
  const merged: ObjectKeyframe[] = [
    { time: 0, value: 0 },
    { time: duration, value: 1 },
    ...kept,
  ]
  merged.sort((left, right) => left.time - right.time)
  return merged
}

/** 移除叠化：B 回到交界处、删掉可识别的两端帧。调用前必须 `crossfade.identified`。 */
export function buildRemoveCrossfadeCommands(boundary: TransitionBoundary): DocCommand[] {
  const duration = boundary.crossfade.duration
  const kept = boundary.b.opacityFrames.filter((frame) => {
    const zeroFrame = Math.abs(frame.time) <= EPSILON && isFiniteNumber(frame.value) && Math.abs(frame.value) <= EPSILON
    const oneFrame = Math.abs(frame.time - duration) <= EPSILON
      && isFiniteNumber(frame.value)
      && Math.abs(frame.value - 1) <= EPSILON
    return !zeroFrame && !oneFrame
  })
  const commands: DocCommand[] = [
    { kind: 'clip.setStart', clipKey: boundary.b.clipKey, value: boundary.layout.boundaryTime },
  ]
  if (kept.length === 0) {
    commands.push({ kind: 'object.remove', clipKey: boundary.b.clipKey, path: COMPOSITE_PATHS.opacity })
  } else {
    commands.push({
      kind: 'object.setKeyframes',
      clipKey: boundary.b.clipKey,
      path: COMPOSITE_PATHS.opacity,
      keyframes: kept,
    })
  }
  return commands
}

/** 参数过渡草稿：`null` / `undefined` 表示继承（不写该键）。 */
export interface ChannelDraft {
  channel: TransitionChannel
  mode: TransitionChannelMode | null
  duration: number | null
  curve: JsonObject | null
}

/** 参数过渡草稿。 */
export interface ParamDraft {
  type: TransitionType
  /** `null` = 未声明（运行时 0.5）。 */
  duration: number | null
  /** `null` = 线性（不写 `transition_curve`）。 */
  curve: JsonObject | null
  interrupt: TransitionInterrupt
  channels: ChannelDraft[]
}

/** 由现有片段值造草稿（面板初始状态）。 */
export function draftFromParam(param: ParamView): ParamDraft {
  return {
    type: param.type,
    duration: param.declaredDuration,
    curve: isJsonObject(param.curve) ? param.curve : null,
    interrupt: param.interrupt,
    channels: param.channels.map((channel) => ({
      channel: channel.channel,
      mode: channel.declaredMode ?? null,
      duration: channel.declaredDuration ?? null,
      curve: isJsonObject(channel.declaredCurve) ? channel.declaredCurve : null,
    })),
  }
}

/** 草稿是否与当前值不同（切换交界时的未应用提示）。 */
export function draftEquals(left: ParamDraft, right: ParamDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 草稿写入命令：一次写四项（类型 / 时长 / 曲线 / 分通道对象 / 打断方式）。 */
export function buildParamCommands(boundary: TransitionBoundary, draft: ParamDraft): DocCommand[] {
  const clipKey = boundary.a.clipKey
  const commands: DocCommand[] = [
    { kind: 'object.setValue', clipKey, path: TRANSITION_PATHS.type, value: draft.type },
  ]

  if (draft.duration === null) {
    if (Object.prototype.hasOwnProperty.call(boundary.a.objects, TRANSITION_PATHS.duration)) {
      commands.push({ kind: 'object.remove', clipKey, path: TRANSITION_PATHS.duration })
    }
  } else {
    commands.push({ kind: 'object.setValue', clipKey, path: TRANSITION_PATHS.duration, value: draft.duration })
  }

  if (draft.curve === null) {
    if (Object.prototype.hasOwnProperty.call(boundary.a.objects, TRANSITION_PATHS.curve)) {
      commands.push({ kind: 'object.remove', clipKey, path: TRANSITION_PATHS.curve })
    }
  } else {
    commands.push({ kind: 'object.setValue', clipKey, path: TRANSITION_PATHS.curve, value: draft.curve })
  }

  const params = composeParamsObject(draft)
  if (params === null) {
    if (Object.prototype.hasOwnProperty.call(boundary.a.objects, TRANSITION_PATHS.params)) {
      commands.push({ kind: 'object.remove', clipKey, path: TRANSITION_PATHS.params })
    }
  } else {
    commands.push({ kind: 'object.setValue', clipKey, path: TRANSITION_PATHS.params, value: params })
  }

  commands.push({ kind: 'object.setValue', clipKey, path: TRANSITION_PATHS.interrupt, value: draft.interrupt })
  return commands
}

/** 合成 `transition_params`：只写显式覆盖；无覆盖 = `null`（删路径）。 */
export function composeParamsObject(draft: ParamDraft): JsonObject | null {
  const params: JsonObject = {}
  for (const channel of draft.channels) {
    const entry: JsonObject = {}
    if (channel.mode !== null) {
      entry.mode = channel.mode
    }
    if (channel.duration !== null) {
      entry.duration = channel.duration
    }
    if (channel.curve !== null) {
      entry.curve = channel.curve
    }
    if (Object.keys(entry).length > 0) {
      params[channel.channel] = entry
    }
  }
  return Object.keys(params).length === 0 ? null : params
}

/** 草稿校验（提交前）。 */
export function validateDraft(draft: ParamDraft): TransitionIssue[] {
  const issues: TransitionIssue[] = []
  if (draft.duration !== null) {
    if (!Number.isFinite(draft.duration)) {
      issues.push({ severity: 'error', code: 'draft.duration', message: '片段级时长必须是有限数字' })
    } else if (draft.duration < 0) {
      issues.push({ severity: 'error', code: 'draft.duration', message: '片段级时长不能为负（0 = 无窗口）' })
    }
  }
  for (const channel of draft.channels) {
    if (channel.duration !== null) {
      if (!Number.isFinite(channel.duration) || channel.duration <= 0) {
        issues.push({
          severity: 'error',
          code: 'draft.channel-duration',
          message: `${TRANSITION_CHANNEL_LABELS[channel.channel]}：分通道时长必须是有限正数（不占窗口请用 cut）`,
        })
      }
    }
    if (channel.mode === 'cut' && (channel.duration !== null || channel.curve !== null)) {
      issues.push({
        severity: 'warning',
        code: 'draft.cut-residual',
        message: `${TRANSITION_CHANNEL_LABELS[channel.channel]}：cut 行保留的时长 / 曲线不会写入，清除整行才删`,
      })
    }
  }
  return issues
}

/** 切类型开关的单条命令（立即提交）。 */
export function buildSetTypeCommand(boundary: TransitionBoundary, type: TransitionType): DocCommand {
  return { kind: 'object.setValue', clipKey: boundary.a.clipKey, path: TRANSITION_PATHS.type, value: type }
}

/** 共存动作 1：仅保留叠化（A 写 cut，分通道声明保留）。 */
export function buildPreferCrossfadeCommands(boundary: TransitionBoundary): DocCommand[] {
  return [{ kind: 'object.setValue', clipKey: boundary.a.clipKey, path: TRANSITION_PATHS.type, value: 'cut' }]
}

/** 共存动作 2：仅保留参数过渡（B 回到交界处、删两端帧，不改 A 的 transition）。 */
export function buildPreferParamCommands(boundary: TransitionBoundary): DocCommand[] {
  return buildRemoveCrossfadeCommands(boundary)
}

/** 曲线摘要文案（07 曲线模型的 `type` + 参数数量）。 */
export function describeCurve(curve: JsonValue | null): string {
  if (!isJsonObject(curve)) {
    return '线性'
  }
  const type = typeof curve.type === 'string' ? curve.type : '未知'
  const keys = Object.keys(curve).filter((key) => key !== 'type').length
  return keys === 0 ? type : `${type}（${keys} 参数）`
}

/** 片段全屏问题（供面板列出结构错误）。 */
export function structuralErrors(boundary: TransitionBoundary): TransitionIssue[] {
  return boundary.crossfade.structural
}
