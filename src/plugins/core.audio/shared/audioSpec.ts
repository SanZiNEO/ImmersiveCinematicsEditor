/**
 * 10 音频规格：字段窄组、运行时语义的纯函数镜像。
 *
 * 事实来源：
 * - `TrackSchemas.audioObjects()`（13 字段、范围/枚举/默认值）；
 * - `AudioTrackPlayer`（storage order 首个活跃、fade 包络、尾音、music 相对玩家、ambient 用监听点）；
 * - `CinematicAudioInstance`（source=minecraft 只读 OGG、source=file 的扩展名白名单与 file_loop）；
 * - `ObjectValidator`（fade_in+fade_out>duration 时整段跳过）；
 * - `AudioListenerController`（camera 监听的三个条件）。
 *
 * 本文件不读文档、不写文档、不依赖 Vue；面板与 verify 共用。
 */
import type { FieldDisplayGroup } from '../../../workbench/api/fieldSurface.ts'

/** AUDIO 对象的 13 个路径（顺序即目录声明顺序）。 */
export const AUDIO_PATHS = [
  'volume', 'x', 'y', 'z',
  'sound', 'source', 'pitch', 'file_loop',
  'fade_in', 'fade_out',
  'attenuation', 'position_mode', 'category',
] as const

export type AudioPath = typeof AUDIO_PATHS[number]

/** 10-01 §四：四组 + 片段头。 */
export const AUDIO_GROUPS: readonly (FieldDisplayGroup & { paths: readonly string[] })[] = [
  {
    key: 'audio.source',
    label: '音源',
    order: 0,
    paths: ['sound', 'source', 'pitch', 'file_loop'],
  },
  { key: 'audio.volume', label: '音量', order: 1, paths: ['volume'] },
  { key: 'audio.envelope', label: '包络', order: 2, paths: ['fade_in', 'fade_out'] },
  {
    key: 'audio.space',
    label: '空间',
    order: 3,
    paths: ['category', 'position_mode', 'attenuation', 'x', 'y', 'z'],
  },
]

/** 仅用于显示分组映射。 */
export function audioGroupOf(path: string): FieldDisplayGroup | null {
  for (const group of AUDIO_GROUPS) {
    if (group.paths.includes(path)) {
      return { key: group.key, label: group.label, order: group.order }
    }
  }
  return null
}

/** 滑杆范围（10-01 §四；volume 运行时夹到 0..1，pitch 按常见区间给滑杆但不设 schema 上限）。 */
export function audioSliderRange(
  path: string,
  duration: number,
): { min: number; max: number; step: number } | null {
  switch (path) {
    case 'volume':
      return { min: 0, max: 1, step: 0.001 }
    case 'x':
    case 'y':
    case 'z':
      return { min: -512, max: 512, step: 0.1 }
    case 'pitch':
      return { min: 0.5, max: 2, step: 0.01 }
    case 'fade_in':
    case 'fade_out':
      return { min: 0, max: Math.max(0.01, Math.min(60, duration > 0 ? duration : 60)), step: 0.01 }
    default:
      return null
  }
}

/** source=file 的音频扩展名白名单（`CinematicAudioInstance.SUPPORTED_EXT`）。 */
export const AUDIO_FILE_EXTS: readonly string[] = [
  'ogg', 'wav', 'mp3', 'aac', 'flac', 'm4a', 'opus', 'wma', 'oga', 'ogx',
]

/** `ObjectValidator.checkAudio` 的 fade 规则：两个都 >0 且和 > duration 时运行时整段跳过。 */
export interface FadeProblem {
  level: 'warning'
  message: string
}

export function fadeProblem(input: {
  duration: number
  infinite: boolean
  fadeIn: number
  fadeOut: number
}): FadeProblem | null {
  const fadeIn = Math.max(0, input.fadeIn)
  const fadeOut = Math.max(0, input.fadeOut)
  if (fadeIn <= 0 || fadeOut <= 0 || input.infinite) return null
  if (input.duration <= 0) return null
  if (fadeIn + fadeOut <= input.duration) return null
  return {
    level: 'warning',
    message: `fade_in(${fadeIn.toFixed(3)}s) + fade_out(${fadeOut.toFixed(3)}s) > duration(${input.duration.toFixed(3)}s)：运行时整段跳过，不会出声。`,
  }
}

/**
 * 运行时 `AudioTrackPlayer.resolveFadeEnvelope` 的逐字镜像。
 *
 * 返回 0..1 的增益系数；整段跳过时恒为 0。
 */
export function audioEnvelope(input: {
  time: number
  duration: number
  infinite: boolean
  fadeIn: number
  fadeOut: number
}): number {
  const duration = input.infinite ? Number.POSITIVE_INFINITY : Math.max(0, input.duration)
  const fadeIn = Math.max(0, input.fadeIn)
  const fadeOut = Math.max(0, input.fadeOut)
  if (fadeIn > 0 && fadeOut > 0 && Number.isFinite(duration) && duration > 0 && fadeIn + fadeOut > duration) {
    return 0
  }
  if (duration <= 0) return 0
  const time = Math.max(0, input.time)
  const remaining = Number.isFinite(duration) ? duration - time : Number.POSITIVE_INFINITY
  let factor = 1
  if (fadeIn > 0 && time < fadeIn) factor = Math.min(factor, time / fadeIn)
  if (Number.isFinite(duration) && fadeOut > 0 && remaining < fadeOut) {
    factor = Math.min(factor, Math.max(0, remaining / fadeOut))
  }
  return Math.max(0, Math.min(1, factor))
}

/** 活跃音频片段：`storage order` 中第一个区间命中的片段（不是起点最晚的）。 */
export interface AudioSpan {
  key: string
  /** 片段局部起点（秒）。 */
  start: number
  /** 片段时长；无限片段用正数占位，`infinite` 为准。 */
  duration: number
  infinite: boolean
}

function isActiveAt(span: AudioSpan, time: number): boolean {
  if (time < span.start) return false
  if (span.infinite) return true
  return time < span.start + span.duration - 1e-9
}

/** 返回 storage order 中第一个活跃片段的下标；没有则 -1。 */
export function activeAudioIndex(spans: readonly AudioSpan[], time: number): number {
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    if (span !== undefined && isActiveAt(span, time)) return index
  }
  return -1
}

/** 两个片段的重叠区间（无限片段按脚本末端 `contentEnd` 或给定上界截断）。 */
function overlapInterval(
  left: AudioSpan,
  right: AudioSpan,
  upperBound: number,
): { start: number; end: number } | null {
  const leftEnd = left.infinite ? upperBound : left.start + left.duration
  const rightEnd = right.infinite ? upperBound : right.start + right.duration
  const start = Math.max(left.start, right.start)
  const end = Math.min(leftEnd, rightEnd)
  return end - start > 1e-9 ? { start, end } : null
}

export interface AudioOverlapNotice {
  level: 'warning'
  /** 后出现（storage order 更靠后）的片段键：它在这段区间内不播。 */
  laterClip: string
  earlierClip: string
  start: number
  end: number
  message: string
}

/**
 * 同轨重叠：storage order 靠后的片段在重叠区间内不会成为活跃片段。
 *
 * 尾音（前片段 fade_out 的收尾）不算重叠；这里只提示“两个片段同时命中区间”。
 */
export function overlappingAudioClips(
  spans: readonly AudioSpan[],
  upperBound: number,
): AudioOverlapNotice[] {
  const notices: AudioOverlapNotice[] = []
  for (let later = 0; later < spans.length; later += 1) {
    const current = spans[later]
    if (current === undefined) continue
    for (let earlier = 0; earlier < later; earlier += 1) {
      const previous = spans[earlier]
      if (previous === undefined) continue
      const overlap = overlapInterval(previous, current, upperBound)
      if (overlap === null) continue
      notices.push({
        level: 'warning',
        earlierClip: previous.key,
        laterClip: current.key,
        start: overlap.start,
        end: overlap.end,
        message: `与同轨更早的 ${previous.key} 重叠 ${overlap.start.toFixed(3)}–${overlap.end.toFixed(3)}s：这段区间内本片段不会播放（运行时只取 storage order 的第一个活跃片段）。`,
      })
    }
  }
  return notices
}

/** 音源取值域校验（10-01 §三）。 */
export interface AudioSoundCheck {
  level: 'ok' | 'warning' | 'error'
  messages: string[]
  /** 规范化后的相对路径（去首尾空白、反斜杠转斜杠）。 */
  normalized: string
  extension: string
  /** 是否是 registry id（source=minecraft）。 */
  registryId: boolean
}

function pathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0)
}

/** 相对资源路径安全检查（绝对路径 / 盘符 / UNC / .. 越界）。 */
export function relativePathProblem(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, '/')
  if (normalized === '') return '路径为空'
  if (normalized.startsWith('/')) return '不能是绝对路径（不能以 / 开头）'
  if (/^[A-Za-z]:/.test(normalized)) return '不能带盘符（如 C:）'
  if (normalized.startsWith('//')) return '不能是 UNC 路径'
  const segments = pathSegments(normalized)
  if (segments.includes('..')) return '包含 ..，会逃出资源根'
  return null
}

export function checkAudioSound(input: {
  sound: unknown
  source: unknown
  /** 资源清单（相对 resource/ 的路径，小写比较）；不可用时传 null。 */
  resources?: ReadonlySet<string> | null
  /** registry 声音 id 清单；不可用时传 null。 */
  registry?: ReadonlySet<string> | null
}): AudioSoundCheck {
  const messages: string[] = []
  const raw = typeof input.sound === 'string' ? input.sound.trim() : ''
  const source = input.source === 'minecraft' ? 'minecraft' : 'file'
  const normalized = raw.replace(/\\/g, '/')
  const dot = normalized.lastIndexOf('.')
  const extension = dot >= 0 ? normalized.slice(dot + 1).toLowerCase() : ''

  if (raw === '') {
    return { level: 'error', messages: ['sound 必填：请填写资源相对路径或 registry 声音 id。'], normalized, extension, registryId: source === 'minecraft' }
  }

  if (source === 'minecraft') {
    if (relativePathProblem(raw) !== null && raw.includes('/')) {
      messages.push('source=minecraft 时 sound 应是 registry 声音 id（如 minecraft:music.game），不是资源相对路径。')
      return { level: 'warning', messages, normalized, extension, registryId: true }
    }
    if (input.registry === null) {
      messages.push('游戏未运行，registry 声音 id 未能验证（不判错）。')
      return { level: 'warning', messages, normalized, extension, registryId: true }
    }
    if (input.registry !== undefined && !input.registry.has(raw.toLowerCase())) {
      return { level: 'error', messages: [`registry 中找不到声音 id：${raw}`], normalized, extension, registryId: true }
    }
    return { level: 'ok', messages, normalized, extension, registryId: true }
  }

  const pathProblem = relativePathProblem(raw)
  if (pathProblem !== null) {
    return { level: 'error', messages: [pathProblem], normalized, extension, registryId: false }
  }
  if (extension === '') {
    messages.push('缺少扩展名；source=file 只接受 ' + AUDIO_FILE_EXTS.join(' / ') + '。')
  } else if (!AUDIO_FILE_EXTS.includes(extension)) {
    messages.push(`不支持的音频扩展名 .${extension}；运行时只认 ${AUDIO_FILE_EXTS.join(' / ')}。`)
  }
  if (/[^\x00-\x7F]/.test(normalized)) {
    messages.push('文件名含非 ASCII 字符：运行时能解码，但资源路径在不同系统上可能不一致。')
  }
  if (input.resources === null) {
    messages.push('游戏未运行，未核对文件是否存在。')
  } else if (input.resources !== undefined && !input.resources.has(normalized.toLowerCase())) {
    messages.push(`资源根下找不到该文件：${normalized}`)
  }
  const level = messages.some((message) => message.startsWith('不支持') || message.startsWith('资源根下找不到') || pathProblem !== null)
    ? 'error'
    : messages.length > 0 ? 'warning' : 'ok'
  return { level, messages, normalized, extension, registryId: false }
}

/** `category` 对空间字段的忽略提示（10-05 §二 / 10-01 §四）。 */
export function audioCategoryNotice(input: {
  category: unknown
  positionMode: unknown
  attenuation: unknown
}): string | null {
  const category = input.category === 'ambient' ? 'ambient' : 'music'
  if (category === 'music') {
    return 'category=music：运行时固定相对玩家、不做衰减；x / y / z / position_mode / attenuation 不参与定位。'
  }
  const mode = input.positionMode === 'absolute' ? 'absolute' : 'relative'
  if (mode === 'relative' && (input.attenuation === 'none')) {
    return 'ambient + relative + attenuation=none：仍按监听点相对偏移发声，但没有距离衰减。'
  }
  return null
}

/** 监听评估（10-03）。 */
export interface ListenerStatus {
  /** 运行时是否把音频监听点放到相机。 */
  cameraActive: boolean
  /** 当前文档是否有 CAMERA 轨道片段。 */
  hasCameraClips: boolean
  /** 播放头处是否有活跃的 CAMERA 片段（有限 / 无限口径与文档一致）。 */
  activeCameraAtPlayhead: boolean
  /** meta.listener 原值。 */
  mode: 'player' | 'camera'
  title: string
  detail: string
  level: 'ok' | 'warning' | 'info'
}

export function listenerStatus(input: {
  listener: unknown
  hasCameraClips: boolean
  activeCameraAtPlayhead: boolean
}): ListenerStatus {
  const mode = input.listener === 'camera' ? 'camera' : 'player'
  const cameraActive = mode === 'camera' && input.activeCameraAtPlayhead
  if (mode === 'player') {
    return {
      cameraActive: false,
      hasCameraClips: input.hasCameraClips,
      activeCameraAtPlayhead: input.activeCameraAtPlayhead,
      mode,
      title: '监听：玩家',
      detail: 'meta.listener=player：音频监听点跟随玩家，与相机无关。',
      level: 'ok',
    }
  }
  if (!input.hasCameraClips) {
    return {
      cameraActive: false,
      hasCameraClips: false,
      activeCameraAtPlayhead: input.activeCameraAtPlayhead,
      mode,
      title: '监听：相机（当前文档没有 CAMERA 片段）',
      detail: '运行时要求顶层脚本实例存在活跃 CAMERA 片段；当前文档没有 CAMERA 轨道，因此会回落到玩家监听点。',
      level: 'warning',
    }
  }
  if (!input.activeCameraAtPlayhead) {
    return {
      cameraActive: false,
      hasCameraClips: true,
      activeCameraAtPlayhead: false,
      mode,
      title: '监听：相机（播放头处没有活跃 CAMERA 片段）',
      detail: '当前播放头不在任何 CAMERA 片段区间内：运行时该时刻会回落到玩家监听点。',
      level: 'info',
    }
  }
  return {
    cameraActive: true,
    hasCameraClips: true,
    activeCameraAtPlayhead: true,
    mode,
    title: '监听：相机',
    detail: 'meta.listener=camera，且当前文档在播放头处有活跃 CAMERA 片段：运行时把监听点放到相机（顶层实例口径由运行时判定）。',
    level: 'ok',
  }
}
