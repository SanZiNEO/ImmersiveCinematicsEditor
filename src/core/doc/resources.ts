/**
 * 资源存在性本地检查（13 轮）。
 *
 * 与 `validateStructure` 分开：结构校验只判文档形状，不读盘；本检查依赖资源根，
 * 由调用方注入存在性解析器（Electron 工作区 / CLI 夹具各自提供），保持核心可测、
 * 不在纯结构链路里耦合文件系统。
 *
 * 口径（以模组 `TrackSchemas` / `ObjectValidator` 为准）：
 * - OVERLAY `path`：图片 / 视频相对 `resource/` 的路径；
 * - AUDIO `sound`：`source=minecraft` 或 `minecraft:` 前缀是 registry 声音 id，不查文件；
 *   其余按 file 资源相对路径查存在性；
 * - ADJUST `lut`：`.cube` LUT 相对路径。
 *
 * 没有资源根 / 没有解析器时**如实跳过**：`checked=false` 并带 `skippedReason`，
 * 不把「未检查」当成「资源齐全」。
 */
import { isJsonObject } from './json.ts'
import type { DocIssue, JsonObject, JsonValue, ScriptDoc } from './types.ts'

/** 一个被引用的资源。 */
export interface ResourceRef {
  /** 轨道类型。 */
  trackType: string
  /** 资源字段名（`path` / `sound` / `lut`）。 */
  field: string
  /** 归一化后的相对路径（`/` 分隔，去空白）。 */
  relative: string
  /** 文档内 JSON 路径。 */
  jsonPath: string
  /** 片段身份键（可空）。 */
  clipKey?: string
}

/** 存在性解析器：入参归一化相对路径，返回文件是否存在。 */
export type ResourceExists = (relative: string) => boolean

/** 检查结果。 */
export interface ResourceCheckResult {
  issues: DocIssue[]
  /** 是否真正做了存在性检查；`false` = 已跳过（见 `skippedReason`）。 */
  checked: boolean
  /** 跳过时说明未检查的原因；检查时为空。 */
  skippedReason?: string
}

/** 各轨道类型需要查文件存在性的资源字段。 */
const RESOURCE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['OVERLAY', 'path'],
  ['AUDIO', 'sound'],
  ['ADJUST', 'lut'],
]

/** 归一化相对路径：反斜杠转斜杠、去首尾空白；空串返回空串。 */
function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, '/')
}

/** registry 声音 id（`minecraft:` 命名空间）不查文件。 */
function isRegistrySound(value: string): boolean {
  return value.startsWith('minecraft:')
}

/** 读一个值型属性的显式字符串值；非字符串 / 缺省返回空串。 */
function readStringProperty(objects: JsonObject, field: string): string {
  const property = objects[field]
  if (!isJsonObject(property)) {
    return ''
  }
  const value = property.value
  return typeof value === 'string' ? value.trim() : ''
}

/** 从一个片段对象里抽取资源引用（内联 / 独立片段共用）。 */
function refsOfClip(
  raw: JsonValue,
  trackType: string,
  clipPath: string,
  clipKey: string | undefined,
  out: ResourceRef[],
): void {
  if (!isJsonObject(raw)) {
    return
  }
  const objects = raw.objects
  if (!isJsonObject(objects)) {
    return
  }
  for (const [type, field] of RESOURCE_FIELDS) {
    if (trackType !== type) {
      continue
    }
    const value = readStringProperty(objects, field)
    if (value === '') {
      continue
    }
    if (field === 'sound' && isRegistrySound(value)) {
      continue
    }
    const source = readStringProperty(objects, 'source')
    if (field === 'sound' && source === 'minecraft') {
      continue
    }
    out.push({
      trackType,
      field,
      relative: normalizeRel(value),
      jsonPath: `${clipPath}.objects.${field}`,
      ...(clipKey === undefined ? {} : { clipKey }),
    })
  }
}

/** 收集文档内全部文件型资源引用（不判存在性）。 */
export function resourceRefsOf(doc: ScriptDoc): ResourceRef[] {
  const refs: ResourceRef[] = []
  const rawTracks = doc.timeline.tracks
  if (Array.isArray(rawTracks)) {
    for (let trackIndex = 0; trackIndex < rawTracks.length; trackIndex += 1) {
      const track = rawTracks[trackIndex]
      if (!isJsonObject(track)) {
        continue
      }
      const trackType = typeof track.type === 'string' ? track.type : ''
      const clips = track.clips
      if (!Array.isArray(clips)) {
        continue
      }
      for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
        refsOfClip(clips[clipIndex], trackType, `timeline.tracks[${trackIndex}].clips[${clipIndex}]`, undefined, refs)
      }
    }
  }
  const standalone = doc.root.clips
  if (Array.isArray(standalone)) {
    for (let index = 0; index < standalone.length; index += 1) {
      const raw = standalone[index]
      const trackType = isJsonObject(raw) && typeof raw.track === 'string' ? raw.track : ''
      refsOfClip(raw, trackType, `clips[${index}]`, undefined, refs)
    }
  }
  return refs
}

/**
 * 跑资源存在性检查。
 *
 * @param doc 已解析文档
 * @param resourceRoot 资源根（`<workspace>/immersive_cinematics/resource`）；空 / `null` 跳过
 * @param exists 存在性解析器；缺省（`null`）= 无法判定，跳过
 */
export function validateResources(
  doc: ScriptDoc,
  resourceRoot: string | null | undefined,
  exists: ResourceExists | null,
): ResourceCheckResult {
  const root = typeof resourceRoot === 'string' ? resourceRoot.trim() : ''
  if (root === '') {
    return { issues: [], checked: false, skippedReason: '未提供资源根，资源存在性未检查（不判定缺失）。' }
  }
  if (exists === null) {
    return { issues: [], checked: false, skippedReason: '资源存在性解析器不可用，资源存在性未检查（不判定缺失）。' }
  }

  const issues: DocIssue[] = []
  for (const ref of resourceRefsOf(doc)) {
    if (exists(ref.relative)) {
      continue
    }
    issues.push({
      code: 'L92',
      severity: 'block',
      message: `资源文件不存在: ${ref.relative}（相对 resource/ 根）`,
      jsonPath: ref.jsonPath,
      source: 'local',
      ...(ref.clipKey === undefined ? {} : { clipKey: ref.clipKey }),
      objectPath: ref.field,
    })
  }
  return { issues, checked: true }
}
