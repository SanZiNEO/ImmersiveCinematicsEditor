/**
 * 字幕编译计划（12-14）：cue → 覆盖层字幕片段。
 *
 * 三种模式：
 * - `draft`：草稿编译，按打包计划新建片段；
 * - `changed`：变更编译，按片段 id 只更新文本 / 时间 / 布局，不重建、不重置 exit 与透明度关键帧；
 * - `validate`：只校验不写。
 *
 * 字段面固定（不写颜色 / 字体 / 描边 / 背景 / 对齐 / 素材 / 路径 / 转场 / 总时长）：
 * `layer_type / text / x / y / anchor_x / anchor_y / scale_x / scale_y / font_scale / opacity / z_index`。
 * 默认布局引用 09-08 `subtitle.bottom` 预设；已有值优先。
 *
 * 本模块只产出命令计划与诊断；提交 / 撤销由调用方走一次事务。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, JsonValue, ObjectKeyframe } from '../../core/doc/types.ts'
import { OVERLAY_PRESETS } from '../overlay/presets.ts'
import type { OverlayPreset } from '../overlay/presets.ts'
import { explicitValue } from '../overlay/layers.ts'
import { LANG_PREFIX, subtitleInvisible } from '../overlay/subtitle.ts'
import type { RawTrack } from './cues.ts'
import { deriveTracks, intervalsOverlap, planPackCues } from './cues.ts'
import type { ParsedCue } from './parse.ts'

/** 编译模式。 */
export type CompileMode = 'draft' | 'changed' | 'validate'

/** 编译输入的一条 cue。 */
export interface CompileCue {
  cueId: string
  clipKey: string | null
  trackIndex: number | null
  ordinal: number
  start: number
  end: number
  text: string
  draft: boolean
}

/** 编译计划产出。 */
export interface CompilePlan {
  mode: CompileMode
  commands: DocCommand[]
  blockers: string[]
  warnings: string[]
  /** 编译后应选中的片段键（第一条新片段优先）。 */
  selectedClipKeys: string[]
  /** 本次写入的字段路径（断言字段面用）。 */
  writtenPaths: string[]
  /** 因空文本跳过的 cue 数。 */
  skippedCues: number
}

/** 字幕编译固定字段面（与 09-05 字幕字段面一致）。 */
export const SUBTITLE_COMPILE_PATHS = [
  'layer_type',
  'text',
  'x',
  'y',
  'anchor_x',
  'anchor_y',
  'scale_x',
  'scale_y',
  'font_scale',
  'opacity',
  'z_index',
] as const

/** 默认字幕预设 id（09-08 `subtitle.bottom`）。 */
export const DEFAULT_SUBTITLE_PRESET_ID = 'subtitle.bottom'

/** 未在预设里声明的字段缺省值。 */
const FALLBACK_VALUES: Readonly<Record<string, JsonValue>> = {
  z_index: 10,
}

/** 取字幕预设；找不到回退内置底部布局。 */
function resolvePreset(presetId?: string): OverlayPreset {
  const found = OVERLAY_PRESETS.find((preset) => preset.id === (presetId ?? DEFAULT_SUBTITLE_PRESET_ID))
  if (found !== undefined) return found
  return OVERLAY_PRESETS.find((preset) => preset.id === DEFAULT_SUBTITLE_PRESET_ID) as OverlayPreset
}

/** 预设默认布局：path → value。 */
function presetDefaults(preset: OverlayPreset): Record<string, JsonValue> {
  const defaults: Record<string, JsonValue> = { ...FALLBACK_VALUES }
  for (const field of preset.fields) {
    defaults[field.path] = field.value
  }
  return defaults
}

/** 读既有片段某路径的显式值；缺失返回 `undefined`。 */
function existingValue(objects: JsonObject, path: string): JsonValue | undefined {
  const explicit = explicitValue(objects, path)
  return explicit.present ? explicit.value : undefined
}

/** 动画路径既有帧（关键帧保留检查用）。 */
function existingFrames(objects: JsonObject, path: string): ObjectKeyframe[] {
  const raw = objects[path]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const record = raw as Record<string, unknown>
  return Array.isArray(record.keyframes) ? (record.keyframes as ObjectKeyframe[]) : []
}

/** 编译入口输入。 */
export interface CompileInput {
  mode: CompileMode
  cues: readonly CompileCue[]
  tracks: readonly RawTrack[]
  /** `import` = 外部导入（未转义单前缀报错）；`hand` = 手写（允许单前缀）。 */
  source: 'import' | 'hand'
  presetId?: string
}

/**
 * 构造编译计划。
 *
 * `validate` 模式不产出命令；`draft` / `changed` 的命令由调用方一次 `commitBatch` 提交。
 */
export function planCompile(input: CompileInput): CompilePlan {
  const plan: CompilePlan = {
    mode: input.mode,
    commands: [],
    blockers: [],
    warnings: [],
    selectedClipKeys: [],
    writtenPaths: [],
    skippedCues: 0,
  }

  const preset = resolvePreset(input.presetId)
  const defaults = presetDefaults(preset)
  const infos = deriveTracks(input.tracks)
  const existingObjects = new Map<string, JsonObject>()
  for (const track of infos) {
    for (const clip of track.clips) {
      existingObjects.set(clip.clipKey, clip.objects)
    }
  }

  // 同轨占用区间（既有片段 + 本次已分配 cue），用于重叠检查。
  const occupiedByTrack = new Map<number, Array<{ start: number; end: number; clipKey: string }>>()
  for (const track of infos) {
    occupiedByTrack.set(
      track.trackIndex,
      track.clips.map((clip) => ({ start: clip.start, end: clip.start + clip.duration, clipKey: clip.clipKey })),
    )
  }

  // 草稿打包（draft 模式）。
  const draftCues = input.cues.filter((cue) => cue.draft)
  const pack = input.mode === 'draft' && draftCues.length > 0
    ? planPackCues({
        cues: draftCues.map((cue): ParsedCue => ({
          ordinal: cue.ordinal,
          start: cue.start,
          end: cue.end,
          text: cue.text,
          sourceText: cue.text,
          format: 'srt',
          warnings: [],
        })),
        tracks: input.tracks,
      })
    : null
  const packByOrdinal = new Map<number, { trackIndex: number; createNew: boolean }>()
  if (pack !== null) {
    for (const assignment of pack.assignments) {
      packByOrdinal.set(assignment.cueOrdinal, { trackIndex: assignment.trackIndex, createNew: assignment.createNew })
    }
    plan.warnings.push(...pack.warnings)
  }

  for (const cue of input.cues) {
    const duration = cue.end - cue.start

    // 空文本：跳过并警告，不产片段 / 不更新文本。
    if (cue.text.trim() === '') {
      plan.warnings.push(`cue ${cue.ordinal} 文本为空，编译跳过`)
      plan.skippedCues += 1
      continue
    }

    // 未转义单前缀：外部导入报错；手写允许。
    if (cue.text.startsWith(LANG_PREFIX) && input.source === 'import') {
      plan.blockers.push(`cue ${cue.ordinal} 含未转义 @lang: 前缀，请回导入向导处理转义`)
      continue
    }

    const objects = cue.clipKey !== null ? existingObjects.get(cue.clipKey) ?? {} : {}

    // 布局检查（默认值参与估算；已有值优先）。
    const layoutPaths = ['x', 'y', 'anchor_x', 'anchor_y', 'scale_x', 'scale_y', 'font_scale', 'opacity'] as const
    const layoutValues: Record<string, JsonValue> = {}
    for (const path of layoutPaths) {
      const current = existingValue(objects, path)
      layoutValues[path] = current ?? defaults[path]
    }
    for (const path of layoutPaths) {
      const value = layoutValues[path]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        plan.blockers.push(`cue ${cue.ordinal} 布局 ${path} 不是有限数`)
      }
    }
    const scaleX = Number(layoutValues.scale_x)
    const scaleY = Number(layoutValues.scale_y)
    const fontScale = Number(layoutValues.font_scale)
    if (scaleX <= 0 || scaleY <= 0) {
      plan.warnings.push(`cue ${cue.ordinal} 缩放非正：scale_x=${scaleX} scale_y=${scaleY}`)
    }
    if (fontScale <= 0) {
      plan.warnings.push(`cue ${cue.ordinal} 字号非正：font_scale=${fontScale}`)
    }
    const opacity = Number(layoutValues.opacity)
    if (subtitleInvisible(opacity).invisible) {
      plan.warnings.push(`cue ${cue.ordinal} 透明度低于可见阈值：opacity=${opacity}`)
    }

    // 目标轨道校验。
    let targetTrackIndex = cue.trackIndex
    if (cue.clipKey !== null && cue.trackIndex !== null) {
      const track = infos[cue.trackIndex]
      if (track === undefined || track.type !== 'OVERLAY') {
        plan.blockers.push(`cue ${cue.ordinal} 目标轨道不是覆盖层轨`)
        continue
      }
      if (track.kind === 'mixed-subtitle') {
        plan.warnings.push(`cue ${cue.ordinal} 位于混合轨：只更新该片段，不删除同轨非字幕片段`)
      }
    }

    // 同轨重叠检查（既有片段 + 本次已分配 cue）；草稿 cue 在打包分配后再检查。
    if (!cue.draft && targetTrackIndex !== null) {
      const occupied = occupiedByTrack.get(targetTrackIndex) ?? []
      const clash = occupied.find(
        (slot) => slot.clipKey !== cue.clipKey && intervalsOverlap(cue.start, cue.end, slot.start, slot.end),
      )
      if (clash !== undefined) {
        plan.blockers.push(`cue ${cue.ordinal} 与同轨片段「${clash.clipKey}」重叠`)
        continue
      }
      occupied.push({ start: cue.start, end: cue.end, clipKey: cue.clipKey ?? `cue#${cue.ordinal}` })
      occupiedByTrack.set(targetTrackIndex, occupied)
    }

    if (input.mode === 'validate') continue

    if (cue.draft) {
      const assignment = packByOrdinal.get(cue.ordinal)
      if (assignment === undefined) {
        plan.blockers.push(`cue ${cue.ordinal} 未分配到轨道`)
        continue
      }
      targetTrackIndex = assignment.trackIndex
      const occupied = occupiedByTrack.get(targetTrackIndex) ?? []
      const clash = occupied.find((slot) => intervalsOverlap(cue.start, cue.end, slot.start, slot.end))
      if (clash !== undefined) {
        plan.blockers.push(`cue ${cue.ordinal} 与同轨片段「${clash.clipKey}」重叠`)
        continue
      }
      occupied.push({ start: cue.start, end: cue.end, clipKey: `cue#${cue.ordinal}` })
      occupiedByTrack.set(targetTrackIndex, occupied)
      if (assignment.createNew) {
        plan.commands.push({ kind: 'timeline.addTrack', type: 'OVERLAY' })
      }
      const clip: JsonObject = {
        start_time: cue.start,
        duration,
        objects: {
          layer_type: { value: 'subtitle' },
          text: { value: cue.text },
          ...Object.fromEntries(layoutPaths.map((path) => [path, { value: layoutValues[path] }])),
          z_index: { value: defaults.z_index },
        },
      }
      plan.commands.push({ kind: 'clip.add', trackIndex: targetTrackIndex, clip })
      plan.writtenPaths.push(...SUBTITLE_COMPILE_PATHS)
      continue
    }

    // 变更编译：按片段 id 更新文本 / 时间 / 布局；不重建、不碰 exit 与既有关键帧。
    if (cue.clipKey === null) {
      plan.blockers.push(`cue ${cue.ordinal} 缺少片段键，无法变更编译`)
      continue
    }
    const clipKey = cue.clipKey
    plan.commands.push({ kind: 'object.setValue', clipKey, path: 'text', value: cue.text })
    plan.commands.push({ kind: 'clip.setStart', clipKey, value: cue.start })
    plan.commands.push({ kind: 'clip.setDuration', clipKey, value: duration })
    for (const path of layoutPaths) {
      plan.commands.push({ kind: 'object.setValue', clipKey, path, value: layoutValues[path] })
    }
    plan.commands.push({ kind: 'object.setValue', clipKey, path: 'z_index', value: existingValue(objects, 'z_index') ?? defaults.z_index })
    plan.writtenPaths.push(...SUBTITLE_COMPILE_PATHS)

    // 既有关键帧超出新时长 → 警告（不自动裁剪）。
    for (const path of ['opacity', 'scale_x', 'scale_y', 'font_scale', 'x', 'y'] as const) {
      const frames = existingFrames(objects, path)
      const overflow = frames.filter((frame) => frame.time > duration)
      if (overflow.length > 0) {
        plan.warnings.push(`cue ${cue.ordinal} 字段 ${path} 有 ${overflow.length} 帧超出新时长 ${duration}s（未自动裁剪）`)
      }
    }
  }

  // 去重写入路径。
  plan.writtenPaths = [...new Set(plan.writtenPaths)]
  return plan
}
