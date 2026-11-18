/**
 * 媒体检查（10-09）：从文档与资源快照收集 M01–M25 级别的静态问题。
 *
 * 只读文档与资源清单；不修改文档，不推断运行时解码 / LUT 烘焙结果。
 * 资源清单不完整（未连接、首次未完成、非资源根、达到 2000 条）时，
 * “列表里没有”降级为 `unverified`，不判缺失。
 */
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { AUDIO_FILE_EXTS } from './audioSpec.ts'
import { checkCubePath, checkLutGamma, lutStrengthNotice, BLEND_MODES } from './colorSpec.ts'
import { parseCurvePoints } from './curveMath.ts'
import { MEDIA_EXTENSIONS, mediaKindOfPath } from '../../../features/overlay/media.ts'

export type MediaCheckGroup = 'resource' | 'audio' | 'color'
export type MediaCheckSeverity = 'block' | 'error' | 'warning' | 'info' | 'unverified'

export interface MediaClipSnapshot {
  clipKey: string
  trackType: string
  start: number
  duration: number
  infinite: boolean
  loop: boolean
  loopCount?: number
  objects: JsonObject
}

export interface MediaTrackSnapshot {
  trackId: string
  type: string
  name: string
  clips: readonly MediaClipSnapshot[]
}

export interface MediaDocSnapshot {
  tracks: readonly MediaTrackSnapshot[]
  meta: JsonObject
  playhead: number
  contentEnd: number | null
}

/** 资源快照：一次全量 `resource.list` + `resource.list(lang)` 的归一结果。 */
export interface MediaResourceSnapshot {
  /** WebUI 是否连通（游戏运行）。 */
  available: boolean
  /** 首次列举是否完成。 */
  loaded: boolean
  /** 是否停在资源根（false = 子目录，不能判缺失）。 */
  atRoot: boolean
  /** 文件清单是否达到 2000 条上限。 */
  truncated: boolean
  audio: ReadonlySet<string> | null
  image: ReadonlySet<string> | null
  video: ReadonlySet<string> | null
  /** 全量文件（含 cube / 其他），用于 LUT 存在性。 */
  files: ReadonlySet<string> | null
  langKeys: ReadonlySet<string> | null
  registrySounds: ReadonlySet<string> | null
}

export interface MediaCheckItem {
  id: string
  code: string
  group: MediaCheckGroup
  severity: MediaCheckSeverity
  /** 资源相对路径 / registry id / 字段名。 */
  target: string
  clipKey?: string
  trackType?: string
  objectPath?: string
  curve?: string
  message: string
}

export interface MediaCheckReport {
  items: MediaCheckItem[]
  blocks: number
  errors: number
  warnings: number
  infos: number
  unverified: number
  /** 清单不完整导致缺失检查暂停的原因；没有则为 null。 */
  pausedReason: string | null
}

const SEVERITY_RANK: Record<MediaCheckSeverity, number> = {
  block: 0, error: 1, warning: 2, info: 3, unverified: 4,
}

const ZERO_ONE_CHANNELS = new Set([
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
  'lut_strength', 'blend_amount', 'grayscale', 'invert',
  'sat_red', 'sat_yellow', 'sat_green', 'sat_cyan', 'sat_blue', 'sat_magenta',
])

const AUDIO_CHANNELS = ['volume', 'x', 'y', 'z'] as const

const COLOR_CHANNELS = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'hue', 'saturation', 'vibrance', 'lightness',
  'temperature', 'tint', 'red', 'green', 'blue',
  'mix_rr', 'mix_rg', 'mix_rb', 'mix_gr', 'mix_gg', 'mix_gb', 'mix_br', 'mix_bg', 'mix_bb',
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'lift_r', 'lift_g', 'lift_b', 'gamma_r', 'gamma_g', 'gamma_b', 'gain_r', 'gain_g', 'gain_b',
  'lut_strength',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
  'hue_red', 'sat_red', 'hue_yellow', 'sat_yellow', 'hue_green', 'sat_green',
  'hue_cyan', 'sat_cyan', 'hue_blue', 'sat_blue', 'hue_magenta', 'sat_magenta',
  'grayscale', 'invert', 'blend_amount',
] as const

const CURVE_PATHS = [
  'rgb_curve', 'r_curve', 'g_curve', 'b_curve',
  'hv_h_curve', 'hv_s_curve', 'hv_l_curve', 'lv_s_curve', 'sv_s_curve', 'sv_l_curve',
] as const

const CURVE_STRENGTH_PATHS = [
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
] as const

function explicit(objects: JsonObject, path: string): JsonValue | undefined {
  const property = objects[path]
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return undefined
  const record = property as Record<string, JsonValue>
  return Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : undefined
}

function stringAt(objects: JsonObject, path: string): string | null {
  const value = explicit(objects, path)
  return typeof value === 'string' ? value : null
}

function numberAt(objects: JsonObject, path: string): number | null {
  const value = explicit(objects, path)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extensionOf(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function normalize(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase()
}

function complete(resources: MediaResourceSnapshot): boolean {
  return resources.available && resources.loaded && resources.atRoot && !resources.truncated
}

function pausedReason(resources: MediaResourceSnapshot): string | null {
  if (!resources.available) return '游戏未运行 / WebUI 未连接：资源清单不可用，缺失检查已暂停。'
  if (!resources.loaded) return '资源清单首次加载未完成：缺失检查已暂停。'
  if (!resources.atRoot) return '当前不在资源根：缺失检查已暂停。'
  if (resources.truncated) return '资源清单达到 2000 条上限（truncated=true）：缺失检查已暂停，不能把未列出当“不存在”。'
  return null
}

function addItem(items: MediaCheckItem[], item: Omit<MediaCheckItem, 'id'>): void {
  const id = `${item.code}|${item.clipKey ?? ''}|${item.objectPath ?? ''}|${item.curve ?? ''}|${item.target}`
  if (items.some((existing) => existing.id === id)) return
  items.push({ ...item, id })
}

interface Span {
  clipKey: string
  start: number
  duration: number
  infinite: boolean
}

function spanOf(clip: MediaClipSnapshot, contentEnd: number | null): Span {
  return {
    clipKey: clip.clipKey,
    start: clip.start,
    duration: clip.infinite ? Math.max(0, (contentEnd ?? clip.start + 60) - clip.start) : clip.duration,
    infinite: clip.infinite,
  }
}

/** 同轨重叠（按 storage order 的起点先后；后一个与前一个的尾段重叠）。 */
function overlaps(
  track: MediaTrackSnapshot,
  contentEnd: number | null,
): Array<{ later: string; earlier: string; start: number }> {
  const spans = [...track.clips].map((clip) => spanOf(clip, contentEnd)).sort((left, right) => left.start - right.start)
  const found: Array<{ later: string; earlier: string; start: number }> = []
  let reachEnd = -Infinity
  let reachClip = ''
  for (const span of spans) {
    if (span.start < reachEnd - 1e-9) {
      found.push({ later: span.clipKey, earlier: reachClip, start: span.start })
    }
    const end = span.infinite ? Infinity : span.start + span.duration
    if (end > reachEnd) {
      reachEnd = end
      reachClip = span.clipKey
    }
  }
  return found
}

function listenerMode(meta: JsonObject): 'camera' | 'player' {
  const value = meta.listener
  return value === 'camera' ? 'camera' : 'player'
}

/** 生成 M01–M25 检查结果。 */
export function buildMediaCheckReport(
  doc: MediaDocSnapshot,
  resources: MediaResourceSnapshot,
): MediaCheckReport {
  const items: MediaCheckItem[] = []
  const fullyKnown = complete(resources)
  const pause = pausedReason(resources)

  const allClips = doc.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })))
  const cameraClips = allClips.filter((entry) => entry.clip.trackType === 'CAMERA')
  const activeCamera = cameraClips.some((entry) => doc.playhead >= entry.clip.start
    && (entry.clip.infinite || doc.playhead < entry.clip.start + entry.clip.duration - 1e-9))

  for (const { track, clip } of allClips) {
    if (clip.trackType === 'OVERLAY') {
      const path = stringAt(clip.objects, 'path')
      if (path !== null && path.trim() !== '') {
        const target = path.trim()
        const kind = mediaKindOfPath(target)
        if (kind === 'unsupported') {
          addItem(items, {
            code: 'M01', group: 'resource', severity: 'error', target,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'path',
            message: `OVERLAY 素材扩展名不受支持 .${extensionOf(target) || '（无）'}；只接受 ${MEDIA_EXTENSIONS.join(' / ')}。`,
          })
        } else if (fullyKnown && kind !== 'empty') {
          const set = kind === 'image' ? resources.image : resources.video
          if (set !== null && !set.has(normalize(target))) {
            addItem(items, {
              code: 'M02', group: 'resource', severity: 'warning', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'path',
              message: `资源清单里没有该素材：${target}（只警告，可能来自未扫描目录）。`,
            })
          }
        } else if (!fullyKnown) {
          addItem(items, {
            code: 'M02', group: 'resource', severity: 'unverified', target,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'path',
            message: '资源清单不完整，素材存在性未核对（不判缺失）。',
          })
        }
      }
    }

    if (clip.trackType === 'AUDIO') {
      const sound = stringAt(clip.objects, 'sound')
      const source = stringAt(clip.objects, 'source') ?? 'file'
      if (sound === null || sound.trim() === '') {
        addItem(items, {
          code: 'M03', group: 'resource', severity: 'error', target: '',
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
          message: 'AUDIO 的 sound 为空：运行时没有音源，片段不会发声。',
        })
      } else {
        const target = sound.trim()
        if (source === 'file') {
          if (target.startsWith('minecraft:')) {
            addItem(items, {
              code: 'M07', group: 'resource', severity: 'error', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
              message: 'source=file 但 sound 是 registry id（minecraft:…）：取值域不匹配。',
            })
          }
          const ext = extensionOf(target)
          if (!AUDIO_FILE_EXTS.includes(ext)) {
            addItem(items, {
              code: 'M04', group: 'resource', severity: 'error', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
              message: `source=file 的音频扩展名不受支持 .${ext || '（无）'}；运行时只认 ${AUDIO_FILE_EXTS.join(' / ')}。`,
            })
          }
          if (fullyKnown && resources.audio !== null && !resources.audio.has(normalize(target))) {
            addItem(items, {
              code: 'M05', group: 'resource', severity: 'warning', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
              message: `资源清单里没有该音频：${target}（只警告，可能来自未扫描目录）。`,
            })
          } else if (!fullyKnown) {
            addItem(items, {
              code: 'M05', group: 'resource', severity: 'unverified', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
              message: '资源清单不完整，音频存在性未核对（不判缺失）。',
            })
          }
        } else {
          if (AUDIO_FILE_EXTS.includes(extensionOf(target)) || target.includes('/')) {
            addItem(items, {
              code: 'M07', group: 'resource', severity: 'error', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
              message: 'source=minecraft 但 sound 像文件路径：取值域不匹配（应填 registry id）。',
            })
          }
          if (resources.registrySounds !== null) {
            if (!resources.registrySounds.has(target.toLowerCase())) {
              addItem(items, {
                code: 'M06', group: 'resource', severity: 'error', target,
                clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
                message: `registry 里找不到声音 id：${target}`,
              })
            }
          } else {
            addItem(items, {
              code: 'M06', group: 'resource', severity: 'unverified', target,
              clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'sound',
              message: 'registry 未连接：声音 id 未验证（不判缺失）。',
            })
          }
        }
      }

      const fadeIn = numberAt(clip.objects, 'fade_in') ?? 0
      const fadeOut = numberAt(clip.objects, 'fade_out') ?? 0
      if (!clip.infinite && fadeIn + fadeOut > clip.duration + 1e-9) {
        addItem(items, {
          code: 'M11', group: 'audio', severity: 'warning', target: 'fade_in+fade_out',
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'fade_in',
          message: `fade_in(${fadeIn}) + fade_out(${fadeOut}) 超过片段时长 ${clip.duration}：运行时整段跳过、不播放。`,
        })
      }

      for (const overlap of overlaps(track, doc.contentEnd)) {
        if (overlap.later === clip.clipKey) {
          addItem(items, {
            code: 'M12', group: 'audio', severity: 'warning', target: overlap.later,
            clipKey: clip.clipKey, trackType: clip.trackType,
            message: `同轨重叠：${overlap.later} 起点落在 ${overlap.earlier} 的尾段内；同一时刻只有 storage order 的第一个活跃片段会播，后一个不独立起播。`,
          })
        }
      }

      const category = stringAt(clip.objects, 'category') ?? 'music'
      const spatial = (['x', 'y', 'z'] as const).some((path) => {
        const value = numberAt(clip.objects, path)
        return value !== null && Math.abs(value) > 1e-9
      })
      if (category === 'music' && spatial) {
        addItem(items, {
          code: 'M15', group: 'audio', severity: 'warning', target: 'x/y/z',
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'x',
          message: 'category=music 带非零 x/y/z：music 固定相对玩家、不参与空间定位，这些坐标不会生效（值保留）。',
        })
      }

      for (const path of AUDIO_CHANNELS) {
        const raw = clip.objects[path]
        if (typeof raw !== 'object' || raw === null) continue
        const value = (raw as Record<string, JsonValue>).value
        if (typeof value === 'number' && !Number.isFinite(value)) {
          addItem(items, {
            code: 'M16', group: 'audio', severity: 'block', target: path,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: path,
            message: `${path} 不是有限数字：无法序列化为合法脚本。`,
          })
        }
      }
    }

    if (clip.trackType === 'ADJUST') {
      const lut = stringAt(clip.objects, 'lut')
      if (lut !== null && lut.trim() !== '') {
        const target = lut.trim()
        const cube = checkCubePath(target)
        const extensionIssue = cube.messages.find((message) => message.includes('.cube'))
        if (extensionIssue !== undefined) {
          addItem(items, {
            code: 'M08', group: 'resource', severity: 'error', target,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'lut',
            message: extensionIssue,
          })
        }
        const escapeIssue = cube.messages.find((message) => !message.includes('.cube'))
        if (escapeIssue !== undefined) {
          addItem(items, {
            code: 'M10', group: 'resource', severity: 'error', target,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'lut',
            message: escapeIssue,
          })
        }
        if (fullyKnown && resources.files !== null && !resources.files.has(normalize(target))) {
          addItem(items, {
            code: 'M09', group: 'resource', severity: 'warning', target,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'lut',
            message: `资源清单里没有该 .cube：${target}（只警告，路径保留）。`,
          })
        } else if (!fullyKnown) {
          addItem(items, {
            code: 'M09', group: 'resource', severity: 'unverified', target,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'lut',
            message: '资源清单不完整，LUT 存在性未核对（不判缺失）。',
          })
        }
      }

      const gammaNotice = checkLutGamma(explicit(clip.objects, 'lut_input_gamma'))
      if (gammaNotice !== null) {
        addItem(items, {
          code: 'M18', group: 'color', severity: 'block', target: 'lut_input_gamma',
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'lut_input_gamma',
          message: gammaNotice,
        })
      }

      const strengthNotice = lutStrengthNotice({
        lut: lut === null ? '' : lut,
        strength: explicit(clip.objects, 'lut_strength'),
      })
      if (strengthNotice !== null) {
        addItem(items, {
          code: 'M23', group: 'color', severity: 'warning', target: 'lut_strength',
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'lut_strength',
          message: strengthNotice,
        })
      }

      const blend = stringAt(clip.objects, 'blend_mode')
      if (blend !== null && !(BLEND_MODES as readonly string[]).includes(blend)) {
        addItem(items, {
          code: 'M24', group: 'color', severity: 'block', target: 'blend_mode',
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: 'blend_mode',
          message: `blend_mode 非法：${blend}；只接受 ${BLEND_MODES.join(' / ')}。`,
        })
      }

      for (const overlap of overlaps(track, doc.contentEnd)) {
        if (overlap.later === clip.clipKey) {
          addItem(items, {
            code: 'M19', group: 'color', severity: 'warning', target: overlap.later,
            clipKey: clip.clipKey, trackType: clip.trackType,
            message: `ADJUST 同轨重叠：${overlap.later} 起点落在 ${overlap.earlier} 的尾段内；同一时刻只有第一个活跃片段参与调色。`,
          })
        }
      }
    }

    if (clip.trackType === 'CAMERA') {
      const forbidden = ['lut', 'lut_input_gamma', 'lut_strength', 'blend_mode', 'blend_amount']
        .filter((path) => explicit(clip.objects, path) !== undefined)
      if (forbidden.length > 0) {
        addItem(items, {
          code: 'M25', group: 'color', severity: 'block', target: forbidden.join(','),
          clipKey: clip.clipKey, trackType: clip.trackType, objectPath: forbidden[0],
          message: `CAMERA 上不应出现 LUT / 层混合字段：${forbidden.join('、')} 不属于该对象字段面。`,
        })
      }
    }

    if (clip.trackType === 'CAMERA' || clip.trackType === 'ADJUST') {
      const paths = clip.trackType === 'ADJUST'
        ? COLOR_CHANNELS
        : COLOR_CHANNELS.filter((path) => path !== 'lut_strength' && path !== 'blend_amount')
      for (const path of paths) {
        const value = numberAt(clip.objects, path)
        if (value === null) continue
        const min = path === 'exposure' ? -5 : ZERO_ONE_CHANNELS.has(path) ? 0 : -1
        const max = path === 'exposure' ? 5 : 1
        if (value < min - 1e-9 || value > max + 1e-9) {
          addItem(items, {
            code: 'M17', group: 'color', severity: 'block', target: path,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: path,
            message: `${path}=${value} 超出 [${min}, ${max}]：运行时按目录范围校验，越界会被拒绝。`,
          })
        }
      }

      for (const curve of CURVE_PATHS) {
        const rawCurve = explicit(clip.objects, curve)
        if (rawCurve === undefined || rawCurve === null) continue
        const parsed = parseCurvePoints(rawCurve)
        if (!parsed.ok) {
          addItem(items, {
            code: 'M21', group: 'color', severity: 'block', target: curve,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: curve, curve,
            message: `曲线 ${curve} 非法：${parsed.issues.join('；')}`,
          })
        }
      }

      for (const strengthPath of CURVE_STRENGTH_PATHS) {
        const strength = numberAt(clip.objects, strengthPath)
        if (strength === null || strength <= 0) continue
        const curve = strengthPath === 'curve_strength'
          ? 'rgb_curve'
          : strengthPath.replace('_strength', '_curve')
        const rawCurve = explicit(clip.objects, curve)
        const parsed = parseCurvePoints(rawCurve)
        if (parsed.points.length < 2) {
          addItem(items, {
            code: 'M22', group: 'color', severity: 'warning', target: strengthPath,
            clipKey: clip.clipKey, trackType: clip.trackType, objectPath: strengthPath,
            message: `${strengthPath}=${strength} 但 ${curve} 没有有效曲线（少于 2 点）：该曲线整步跳过。`,
          })
        }
      }
    }
  }

  if (listenerMode(doc.meta) === 'camera') {
    if (cameraClips.length === 0) {
      addItem(items, {
        code: 'M13', group: 'audio', severity: 'warning', target: 'meta.listener',
        objectPath: 'meta.listener',
        message: 'meta.listener=camera 但当前文档没有 CAMERA 片段：运行时回落到玩家监听点，ambient 的定位与衰减按玩家计算。',
      })
    } else if (!activeCamera) {
      addItem(items, {
        code: 'M14', group: 'audio', severity: 'info', target: 'meta.listener',
        objectPath: 'meta.listener',
        message: 'meta.listener=camera，有 CAMERA 片段但播放头处没有活跃相机片段：此刻回落到玩家监听点。',
      })
    }
  }

  const adjustTracks = doc.tracks.filter((track) => track.type === 'ADJUST')
  if (adjustTracks.length > 1) {
    addItem(items, {
      code: 'M20', group: 'color', severity: 'warning', target: 'ADJUST',
      trackType: 'ADJUST',
      message: `当前文档有 ${adjustTracks.length} 条 ADJUST 轨：同一实例内后发布者覆盖前者，不叠乘；只有最后一条的参数生效。`,
    })
  }

  if (pause !== null && !items.some((item) => item.severity === 'unverified')) {
    addItem(items, {
      code: 'PAUSE', group: 'resource', severity: 'info', target: '',
      message: pause,
    })
  }

  return {
    items,
    blocks: items.filter((item) => item.severity === 'block').length,
    errors: items.filter((item) => item.severity === 'error').length,
    warnings: items.filter((item) => item.severity === 'warning').length,
    infos: items.filter((item) => item.severity === 'info').length,
    unverified: items.filter((item) => item.severity === 'unverified').length,
    pausedReason: pause,
  }
}

/** 按级别排序（block → error → warning → info → unverified），同级按编号。 */
export function sortCheckItems(items: readonly MediaCheckItem[]): MediaCheckItem[] {
  return [...items].sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    return bySeverity !== 0 ? bySeverity : left.code.localeCompare(right.code)
  })
}

/** 组内最高级别（组头显示）。 */
export function highestSeverity(items: readonly MediaCheckItem[]): MediaCheckSeverity | null {
  if (items.length === 0) return null
  return items.reduce(
    (best, item) => (SEVERITY_RANK[item.severity] < SEVERITY_RANK[best] ? item.severity : best),
    items[0]!.severity,
  )
}
