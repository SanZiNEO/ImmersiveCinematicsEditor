/**
 * 10 轮自检：音频字段面 / 包络 / 空间与监听、调色字段面 / 曲线 / LUT / 层混合、
 * 媒体资源归一与 M01–M25 检查、静态/有帧写入路由。
 *
 * 运行：`node --experimental-strip-types src/workbench/verify-10.ts`
 * 输出：`ok <描述>` / `FAIL <描述>：<实际>`，最后 `summary ok=<n> fail=<n>`。
 *
 * 只测纯函数与真实数据接口，不启动游戏、不读资源文件内容。
 */
import type { DocCommand } from '../core/doc/commands.ts'
import type { JsonObject } from '../core/doc/types.ts'
import type { DocumentCommands } from './api/documents.ts'
import {
  AUDIO_FILE_EXTS,
  AUDIO_GROUPS,
  AUDIO_PATHS,
  activeAudioIndex,
  audioCategoryNotice,
  audioEnvelope,
  audioGroupOf,
  audioSliderRange,
  checkAudioSound,
  fadeProblem,
  listenerStatus,
  overlappingAudioClips,
  relativePathProblem,
} from '../plugins/core.audio/shared/audioSpec.ts'
import {
  BLEND_MODES,
  COLOR_CURVES,
  COLOR_GROUPS,
  CURVE_STRENGTHS,
  HUE_BANDS,
  MATRIX_PATHS,
  checkCubePath,
  checkLutGamma,
  colorGroupOf,
  curveForStrengthPath,
  curveStrengthPath,
  lutStrengthNotice,
} from '../plugins/core.audio/shared/colorSpec.ts'
import {
  DEFAULT_CURVE_POINTS,
  clampPointX,
  curvePolyline,
  parseCurvePoints,
  sampleCurve,
} from '../plugins/core.audio/shared/curveMath.ts'
import {
  buildMediaCheckReport,
  highestSeverity,
  sortCheckItems,
} from '../plugins/core.audio/shared/mediaChecks.ts'
import type {
  MediaClipSnapshot,
  MediaDocSnapshot,
  MediaResourceSnapshot,
  MediaTrackSnapshot,
} from '../plugins/core.audio/shared/mediaChecks.ts'
import { commitPathValue, currentNumberOf } from '../plugins/core.audio/shared/fieldOps.ts'
import { parseResourceList } from '../features/overlay/media.ts'

let ok = 0
let fail = 0

function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

function format(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return String(value)
  }
}

function near(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon
}

function obj(value: Record<string, unknown>): JsonObject {
  return value as JsonObject
}

function prop(value: unknown, keyframes?: Array<{ time: number; value: unknown; interp?: string }>): JsonObject {
  return keyframes === undefined ? obj({ value }) : obj({ value, keyframes })
}

function fakeCommands(): { commands: DocumentCommands; calls: DocCommand[] } {
  const calls: DocCommand[] = []
  const commands = {
    commit(command: DocCommand) {
      calls.push(command)
      return { ok: true, warnings: [] }
    },
    commitBatch(batch: readonly DocCommand[]) {
      calls.push(...batch)
      return { ok: true, warnings: [] }
    },
  } as unknown as DocumentCommands
  return { commands, calls }
}

// ── 音频字段面 ──────────────────────────────────────────────
check('AUDIO 字段数 = 13', AUDIO_PATHS.length === 13, AUDIO_PATHS.length)
check('AUDIO 四组顺序', AUDIO_GROUPS.map((group) => group.key).join(',') === 'audio.source,audio.volume,audio.envelope,audio.space')
check('AUDIO 每个字段都有显示组', AUDIO_PATHS.every((path) => audioGroupOf(path) !== null))
check('volume 滑杆 0..1', audioSliderRange('volume', 3)?.min === 0 && audioSliderRange('volume', 3)?.max === 1)
check('fade 滑杆上限不超过片段时长', audioSliderRange('fade_in', 2)?.max === 2, audioSliderRange('fade_in', 2))
check('fade 滑杆不超过 60s', audioSliderRange('fade_out', 100)?.max === 60, audioSliderRange('fade_out', 100))
check('file 音频扩展名 10 种', AUDIO_FILE_EXTS.length === 10, AUDIO_FILE_EXTS)
check('相对路径拒绝绝对路径', relativePathProblem('/music/a.ogg') !== null)
check('相对路径拒绝 ..', relativePathProblem('music/../a.ogg') !== null, relativePathProblem('music/../a.ogg'))

// ── 包络与活跃片段 ───────────────────────────────────────────
check('fade_in 0→1 线性中点', near(audioEnvelope({ time: 0.5, duration: 3, infinite: false, fadeIn: 1, fadeOut: 0 }), 0.5))
check('fade_in 后满增益', near(audioEnvelope({ time: 1.5, duration: 3, infinite: false, fadeIn: 1, fadeOut: 0 }), 1))
check('fade_out 尾段线性下降', near(audioEnvelope({ time: 2.5, duration: 3, infinite: false, fadeIn: 0, fadeOut: 1 }), 0.5))
check('fade_out 覆盖 fade_in 时取较小', near(audioEnvelope({ time: 0.9, duration: 1, infinite: false, fadeIn: 1, fadeOut: 1 }), 0))
check('fade 和超过时长整段跳过', audioEnvelope({ time: 1, duration: 2, infinite: false, fadeIn: 2, fadeOut: 2 }) === 0)
check('无限片段没有 fade_out', audioEnvelope({ time: 50, duration: 0, infinite: true, fadeIn: 1, fadeOut: 100 }) === 1)
check('fadeProblem 只在有限片段超时长时警告', fadeProblem({ duration: 2, infinite: false, fadeIn: 2, fadeOut: 2 }) !== null)
check('fadeProblem 无限片段不警告', fadeProblem({ duration: 2, infinite: true, fadeIn: 9, fadeOut: 9 }) === null)
check('活跃片段取 storage order 第一个', activeAudioIndex([
  { key: 'a', start: 0, duration: 10, infinite: false },
  { key: 'b', start: 1, duration: 2, infinite: false },
], 2) === 0)
check('没有活跃片段返回 -1', activeAudioIndex([{ key: 'a', start: 3, duration: 1, infinite: false }], 1) === -1)
check('同轨重叠只提示后一个片段', overlappingAudioClips([
  { key: 'a', start: 0, duration: 4, infinite: false },
  { key: 'b', start: 3, duration: 2, infinite: false },
], 10).some((notice) => notice.laterClip === 'b' && notice.earlierClip === 'a'))

// ── 音源取值域与监听 ─────────────────────────────────────────
check('file + 合法扩展名通过', checkAudioSound({ sound: 'music/a.ogg', source: 'file', resources: new Set(['music/a.ogg']) }).level === 'ok')
check('file + 非法扩展名报错', checkAudioSound({ sound: 'music/a.txt', source: 'file', resources: null }).level === 'error')
check('file + registry id 报错', checkAudioSound({ sound: 'minecraft:music.game', source: 'file', resources: null }).level === 'error')
check('minecraft + registry 命中通过', checkAudioSound({ sound: 'minecraft:music.game', source: 'minecraft', registry: new Set(['minecraft:music.game']) }).level === 'ok')
check('minecraft + 文件路径报错', checkAudioSound({ sound: 'music/a.ogg', source: 'minecraft', registry: null }).level === 'warning')
check('监听 camera + 活跃相机 = 相机', listenerStatus({ listener: 'camera', hasCameraClips: true, activeCameraAtPlayhead: true }).cameraActive)
check('监听 camera + 无相机片段 = 警告回落', listenerStatus({ listener: 'camera', hasCameraClips: false, activeCameraAtPlayhead: false }).level === 'warning')
check('监听 camera + 播放头空档 = 信息级回落', listenerStatus({ listener: 'camera', hasCameraClips: true, activeCameraAtPlayhead: false }).level === 'info')
check('监听 player 永远不激活相机', !listenerStatus({ listener: 'player', hasCameraClips: true, activeCameraAtPlayhead: true }).cameraActive)
check('music 忽略空间字段提示', audioCategoryNotice({ category: 'music', positionMode: 'absolute', attenuation: 'linear' }) !== null)

// ── 调色字段面 ──────────────────────────────────────────────
const allColorPaths = COLOR_GROUPS.flatMap((group) => group.paths)
check('调色显示组 14 个', COLOR_GROUPS.length === 14, COLOR_GROUPS.length)
check('调色所有路径都有组', allColorPaths.every((path) => colorGroupOf(path) !== null))
check('矩阵 9 格行优先', MATRIX_PATHS.length === 9 && MATRIX_PATHS[0] === 'mix_rr' && MATRIX_PATHS[8] === 'mix_bb')
check('六色带固定 6×2', HUE_BANDS.length === 6 && HUE_BANDS[0]?.hue === 'hue_red' && HUE_BANDS[5]?.sat === 'sat_magenta')
check('10 条曲线定义', COLOR_CURVES.length === 10 && COLOR_CURVES[0]?.key === 'rgb_curve')
check('曲线强度映射四位 + 六位', curveStrengthPath('rgb_curve') === 'curve_strength'
  && curveStrengthPath('hv_h_curve') === 'hv_h_strength'
  && curveForStrengthPath('sv_l_strength') === 'sv_l_curve')
check('强度映射互逆', CURVE_STRENGTHS.every((entry) => curveForStrengthPath(entry.path) === entry.curve))
check('blend_mode 五种（含 normal）', BLEND_MODES.length === 5 && BLEND_MODES.includes('normal'))
check('LUT 相对路径 + .cube 通过', checkCubePath('luts/a.cube').ok)
check('LUT 绝对路径拒绝', !checkCubePath('/luts/a.cube').ok)
check('LUT 盘符拒绝', !checkCubePath('C:/luts/a.cube').ok)
check('LUT 扩展名大小写不敏感', checkCubePath('luts/a.CUBE').ok)
check('LUT gamma 必须 >0', checkLutGamma(0) !== null && checkLutGamma(-1) !== null && checkLutGamma(1) === null)
check('无 LUT 时强度提示', lutStrengthNotice({ lut: '', strength: 1 }) !== null)
check('有 LUT 时无强度提示', lutStrengthNotice({ lut: 'luts/a.cube', strength: 1 }) === null)

// ── 曲线点集与 PCHIP ────────────────────────────────────────
check('默认曲线两点 0→1', DEFAULT_CURVE_POINTS.length === 2 && sampleCurve(DEFAULT_CURVE_POINTS, 0.4) === 0.4)
check('单点曲线非法', !parseCurvePoints([[0, 0]]).ok)
check('x 非严格递增拒绝', !parseCurvePoints([[0, 0], [0, 1]]).ok)
check('x/y 越界拒绝', !parseCurvePoints([[-1, 0], [1, 2]]).ok)
check('合法点集通过', parseCurvePoints([[0, 0], [0.5, 0.8], [1, 1]]).ok)
check('PCHIP 端点精确', sampleCurve([[0, 0], [1, 1]], 0) === 0 && sampleCurve([[0, 0], [1, 1]], 1) === 1)
check('PCHIP 单调不过冲', (() => {
  const points = [[0, 0], [0.4, 0.9], [1, 0.9]] as Array<[number, number]>
  let previous = -1
  for (let index = 0; index <= 100; index += 1) {
    const value = sampleCurve(points, index / 100)
    if (value < previous - 1e-9) return false
    previous = value
  }
  return true
})())
check('折线点数 = samples+1', curvePolyline([[0, 0], [1, 1]], 100, 50, 10).split(' ').length === 11)
check('夹取 x 保持邻点间距', clampPointX([[0, 0], [0.5, 0.5], [1, 1]], 1, 9) < 1)
check('空点是合法“没有曲线”', parseCurvePoints(null).ok && parseCurvePoints(null).points.length === 0)

// ── 静态/有帧写入路由 ───────────────────────────────────────
const staticRow = {
  clipKey: 'c1', path: 'volume', label: 'volume', hasDefault: true, defaultValue: 1,
  min: 0, max: 1, keyframes: [],
} as never
const staticObjects = obj({ volume: prop(0.4) })
const fake = fakeCommands()
check('无帧写 object.setValue', commitPathValue(fake.commands, staticRow, staticObjects, 'volume', 0.5, 1).ok
  && fake.calls[0]?.kind === 'object.setValue', fake.calls)
check('currentNumberOf 读显式值', currentNumberOf(staticRow, staticObjects) === 0.4)
const framedObjects = obj({ volume: prop(0.4, [{ time: 2, value: 0.2 }]) })
const framedFake = fakeCommands()
const rejected = commitPathValue(framedFake.commands, staticRow, framedObjects, 'volume', 0.5, 1)
check('有帧且播放头不在帧上拒绝', !rejected.ok && framedFake.calls.length === 0, rejected)
const exactFake = fakeCommands()
check('有帧且播放头在帧上写 setKeyframeValue',
  commitPathValue(exactFake.commands, staticRow, framedObjects, 'volume', 0.6, 2).ok
  && exactFake.calls[0]?.kind === 'object.setKeyframeValue', exactFake.calls)

// ── 资源回执归一 ────────────────────────────────────────────
const fileList = parseResourceList({ kind: 'audio', dir: 'music', total: 1, truncated: false, files: ['music/a.ogg'] }, 'audio' as never)
check('音频资源回执归一', fileList !== null && 'files' in fileList && fileList.files[0] === 'music/a.ogg')
const langList = parseResourceList({ dir: 'lang', languages: ['zh_cn'], entries: [{ key: 'a', values: { zh_cn: '甲' } }], total: 1, truncated: false }, 'lang')
check('语言回执保留 key 与语言', langList !== null && 'entries' in langList && langList.entries[0]?.key === 'a')
check('形状不对返回 null', parseResourceList({ kind: 'audio' }, 'audio' as never) === null)

// ── M01–M25 检查 ────────────────────────────────────────────
const completeResources: MediaResourceSnapshot = {
  available: true, loaded: true, atRoot: true, truncated: false,
  audio: new Set(['music/a.ogg']),
  image: new Set(['img/p.png']),
  video: new Set(['video/v.mp4']),
  files: new Set(['music/a.ogg', 'img/p.png', 'video/v.mp4', 'luts/good.cube']),
  langKeys: new Set(['title']),
  registrySounds: new Set(['minecraft:music.game']),
}

function clip(
  clipKey: string,
  trackType: string,
  objects: JsonObject,
  options: Partial<MediaClipSnapshot> = {},
): MediaClipSnapshot {
  return {
    clipKey, trackType, start: options.start ?? 0, duration: options.duration ?? 2,
    infinite: options.infinite ?? false, loop: options.loop ?? false,
    loopCount: options.loopCount, objects,
  }
}

const doc: MediaDocSnapshot = {
  tracks: [
    {
      trackId: 'o', type: 'OVERLAY', name: 'O', clips: [
        clip('o1', 'OVERLAY', obj({ path: prop('img/missing.png') })),
      ],
    },
    {
      trackId: 'a', type: 'AUDIO', name: 'A', clips: [
        clip('a1', 'AUDIO', obj({
          sound: prop('music/a.ogg'), source: prop('file'),
          fade_in: prop(2), fade_out: prop(2), category: prop('music'),
        }), { start: 0, duration: 2 }),
        clip('a2', 'AUDIO', obj({ sound: prop('music/a.ogg'), source: prop('file') }), { start: 1, duration: 2 }),
      ],
    },
    {
      trackId: 'adj', type: 'ADJUST', name: 'ADJ', clips: [
        clip('d1', 'ADJUST', obj({
          lut: prop('luts/missing.cube'), lut_input_gamma: prop(0), lut_strength: prop(1),
          blend_mode: prop('nope'), exposure: prop(6),
        })),
        clip('d2', 'ADJUST', obj({ blend_amount: prop(1) }), { start: 1 }),
      ],
    },
    {
      trackId: 'adj2', type: 'ADJUST', name: 'ADJ2', clips: [
        clip('d3', 'ADJUST', obj({ blend_amount: prop(1) }), { start: 3 }),
      ],
    },
    {
      trackId: 'cam', type: 'CAMERA', name: 'CAM', clips: [
        clip('c1', 'CAMERA', obj({ lut_strength: prop(1), blend_amount: prop(1) })),
      ],
    },
  ],
  meta: obj({ listener: 'camera' }),
  playhead: 0.5,
  contentEnd: 10,
}

const report = buildMediaCheckReport(doc, completeResources)
const codes = new Set(report.items.map((item) => item.code))
for (const code of ['M02', 'M11', 'M12', 'M09', 'M18', 'M24', 'M25', 'M17', 'M19', 'M20']) {
  check(`检查命中 ${code}`, codes.has(code), [...codes])
}
check('M02 资源清单缺少图片只警告', report.items.some((item) => item.code === 'M02' && item.target === 'img/missing.png' && item.severity === 'warning'))
check('M25 CAMERA 上 LUT/混合阻断', report.items.some((item) => item.code === 'M25' && item.severity === 'block'))
check('M18 gamma<=0 阻断', report.items.some((item) => item.code === 'M18' && item.severity === 'block'))
check('M17 越界阻断', report.items.some((item) => item.code === 'M17' && item.message.includes('exposure')))
check('M24 非法 blend_mode 阻断', report.items.some((item) => item.code === 'M24' && item.severity === 'block'))
check('M11 fade 超时长警告', report.items.some((item) => item.code === 'M11' && item.severity === 'warning'))
check('M12 同轨重叠警告', report.items.some((item) => item.code === 'M12' && item.severity === 'warning'))
check('M19 同轨 ADJUST 重叠警告', report.items.some((item) => item.code === 'M19'))
check('M20 多 ADJUST 轨提示', report.items.some((item) => item.code === 'M20'))
check('M23 无 LUT 但有强度提示', (() => {
  const nextDoc: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'd', type: 'ADJUST', name: 'D', clips: [
      clip('d', 'ADJUST', obj({ lut_strength: prop(1) })),
    ] }],
  }
  return buildMediaCheckReport(nextDoc, completeResources).items.some((item) => item.code === 'M23')
})())
check('M01 非法素材扩展名', (() => {
  const docOne: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'o', type: 'OVERLAY', name: 'O', clips: [
      clip('o', 'OVERLAY', obj({ path: prop('img/a.txt') })),
    ] }],
  }
  return buildMediaCheckReport(docOne, completeResources).items.some((item) => item.code === 'M01')
})())
check('M04 非法音频扩展名', (() => {
  const docOne: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'a', type: 'AUDIO', name: 'A', clips: [
      clip('a', 'AUDIO', obj({ sound: prop('music/a.txt'), source: prop('file') })),
    ] }],
  }
  return buildMediaCheckReport(docOne, completeResources).items.some((item) => item.code === 'M04')
})())
check('M07 取值域不匹配（file 填 registry）', (() => {
  const docOne: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'a', type: 'AUDIO', name: 'A', clips: [
      clip('a', 'AUDIO', obj({ sound: prop('minecraft:music.game'), source: prop('file') })),
    ] }],
  }
  return buildMediaCheckReport(docOne, completeResources).items.some((item) => item.code === 'M07')
})())
check('M08 LUT 扩展名非法', (() => {
  const docOne: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'd', type: 'ADJUST', name: 'D', clips: [
      clip('d', 'ADJUST', obj({ lut: prop('luts/a.png') })),
    ] }],
  }
  return buildMediaCheckReport(docOne, completeResources).items.some((item) => item.code === 'M08')
})())
check('M10 LUT 逃出资源根', (() => {
  const docOne: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'd', type: 'ADJUST', name: 'D', clips: [
      clip('d', 'ADJUST', obj({ lut: prop('../a.cube') })),
    ] }],
  }
  return buildMediaCheckReport(docOne, completeResources).items.some((item) => item.code === 'M10')
})())
check('排序首项为 block', sortCheckItems(report.items)[0]?.severity === 'block')
check('组内最高级别取 block', highestSeverity(report.items) === 'block')
check('计数与条目一致', report.blocks + report.errors + report.warnings + report.infos + report.unverified === report.items.length)
check('没有资源清单时缺失检查降级', (() => {
  const next = buildMediaCheckReport(doc, { ...completeResources, available: false })
  return next.items.some((item) => item.severity === 'unverified')
})())
check('截断时暂停原因与缺失降级', (() => {
  const next = buildMediaCheckReport(doc, { ...completeResources, truncated: true })
  return next.pausedReason !== null && next.items.some((item) => item.severity === 'unverified')
})())
check('listener=camera 无相机片段 M13', (() => {
  const noCamera: MediaDocSnapshot = { ...doc, tracks: doc.tracks.filter((track) => track.type !== 'CAMERA'), playhead: 5 }
  const next = buildMediaCheckReport(noCamera, completeResources)
  return next.items.some((item) => item.code === 'M13')
})())
check('listener=camera 播放头不在相机 M14', (() => {
  const away: MediaDocSnapshot = { ...doc, playhead: 99 }
  const next = buildMediaCheckReport(away, completeResources)
  return next.items.some((item) => item.code === 'M14')
})())
check('曲线强度 >0 且曲线为空 M22', (() => {
  const curveDoc: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'd', type: 'ADJUST', name: 'D', clips: [
      clip('d', 'ADJUST', obj({ curve_strength: prop(0.5), rgb_curve: prop([]) })),
    ] }],
  }
  const next = buildMediaCheckReport(curveDoc, completeResources)
  return next.items.some((item) => item.code === 'M22')
})())
check('非法曲线点 M21', (() => {
  const curveDoc: MediaDocSnapshot = {
    ...doc,
    tracks: [{ trackId: 'd', type: 'ADJUST', name: 'D', clips: [
      clip('d', 'ADJUST', obj({ rgb_curve: prop([[0, 0], [0, 1]]) })),
    ] }],
  }
  const next = buildMediaCheckReport(curveDoc, completeResources)
  return next.items.some((item) => item.code === 'M21')
})())

console.log(`summary ok=${ok} fail=${fail}`)
if (fail > 0) {
  process.exitCode = 1
}
