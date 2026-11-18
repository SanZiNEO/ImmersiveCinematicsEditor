/**
 * OVERLAY 素材字段（`path`）的扩展名与资源列举口径（09-03 / 09-04）。
 *
 * 事实基准：
 * - `script/object/ObjectValidator.java:51`：`layer_type=image` 允许
 *   `png` / `gif` / `mp4` / `webm` / `mkv`（`jpg/jpeg` 不合法）；
 * - `media/video/VideoFiles.java:15`：视频容器 = `mp4` / `webm` / `mkv`（大小写不敏感）；
 * - `editor/shared/ResourceFileService.java`：`resource.list` 的 kind = lang/image/audio/video/all，
 *   文件路径相对 `resource/` 根。
 *
 * 用户裁决（09-03 vs 09-04 的冲突）：素材控件分「图片」「视频」两组，
 * 图片组只列 `png/gif`，视频组只列 `mp4/webm/mkv`；两者写入同一个 `path` 字段。
 */
import { isJsonObject } from '../../core/doc/json.ts'
import type { JsonValue } from '../../core/doc/types.ts'
import { explicitValue } from './layers.ts'
import type { JsonObject } from '../../core/doc/types.ts'

/** 图片层可用的静态图扩展名（校验器白名单去掉视频容器）。 */
export const IMAGE_EXTENSIONS = ['png', 'gif'] as const
/** 视频容器扩展名（`VideoFiles.isVideo`）。 */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv'] as const
/** `layer_type=image` 的完整白名单（校验器原文）。 */
export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] as const

export type MediaKind = 'image' | 'video' | 'empty' | 'unsupported'

/** 取小写扩展名（无点；无扩展名返回空串）。 */
export function extensionOf(path: string): string {
  const name = path.trim()
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const base = slash >= 0 ? name.slice(slash + 1) : name
  const dot = base.lastIndexOf('.')
  if (dot < 0 || dot === base.length - 1) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

/** 路径的素材类别（空路径 = `empty`；大小写不敏感）。 */
export function mediaKindOfPath(path: string): MediaKind {
  const text = path.trim()
  if (text === '') {
    return 'empty'
  }
  const ext = extensionOf(text)
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'image'
  }
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'video'
  }
  return 'unsupported'
}

/** 是否是合法素材路径（空路径合法：运行时不绘制、不占位）。 */
export function isValidMediaPath(path: string): boolean {
  const kind = mediaKindOfPath(path)
  return kind === 'empty' || kind === 'image' || kind === 'video'
}

/** 读 `path` 的显式值（缺失 / 非字符串 → 空串）。 */
export function mediaPathOf(objects: JsonObject): string {
  const explicit = explicitValue(objects, 'path')
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : ''
}

/** 素材路径写入前的检查：非法扩展名拒绝，空路径允许（清除）。 */
export function validateMediaPathInput(input: string): { ok: boolean; path: string; message?: string } {
  const text = input.trim()
  if (text === '') {
    return { ok: true, path: '' }
  }
  const kind = mediaKindOfPath(text)
  if (kind === 'image' || kind === 'video') {
    return { ok: true, path: text }
  }
  return {
    ok: false,
    path: text,
    message: `不支持的素材扩展名: .${extensionOf(text) || '（无）'}（image 层（含视频）只接受 png/gif/mp4/webm/mkv）`,
  }
}

/** 素材列表的类别（用户裁决的两组 + 语言）。 */
export type ResourceKind = 'image' | 'video' | 'lang' | 'all'

/** `resource.list.result` 的文件形态。 */
export interface ResourceFileList {
  kind: string
  dir: string
  total: number
  truncated: boolean
  files: string[]
}

/** `resource.list.result` 的语言形态。 */
export interface ResourceLangEntry {
  key: string
  values: Record<string, string>
}
export interface ResourceLangList {
  kind: 'lang'
  dir: string
  languages: string[]
  entries: ResourceLangEntry[]
  total: number
  truncated: boolean
}

export type ResourceListResult = ResourceFileList | ResourceLangList

/** 把 `resource.list` 的原始回执归一成可消费结构；形状不对返回 `null`。 */
export function parseResourceList(raw: JsonValue | undefined, requestedKind: ResourceKind): ResourceListResult | null {
  if (!isJsonObject(raw)) {
    return null
  }
  const dir = typeof raw.dir === 'string' ? raw.dir : ''
  if (requestedKind === 'lang') {
    const languagesRaw = raw.languages
    const entriesRaw = raw.entries
    if (!Array.isArray(languagesRaw) || !Array.isArray(entriesRaw)) {
      return null
    }
    const languages = languagesRaw.filter((item): item is string => typeof item === 'string')
    const entries: ResourceLangEntry[] = []
    for (const item of entriesRaw) {
      if (!isJsonObject(item) || typeof item.key !== 'string') {
        continue
      }
      const values: Record<string, string> = {}
      if (isJsonObject(item.values)) {
        for (const [language, text] of Object.entries(item.values)) {
          if (typeof text === 'string') {
            values[language] = text
          }
        }
      }
      entries.push({ key: item.key, values })
    }
    return {
      kind: 'lang',
      dir,
      languages,
      entries,
      total: typeof raw.total === 'number' ? raw.total : entries.length,
      truncated: raw.truncated === true,
    }
  }
  const filesRaw = raw.files
  if (!Array.isArray(filesRaw)) {
    return null
  }
  const files = filesRaw.filter((item): item is string => typeof item === 'string')
  return {
    kind: typeof raw.kind === 'string' ? raw.kind : requestedKind,
    dir,
    total: typeof raw.total === 'number' ? raw.total : files.length,
    truncated: raw.truncated === true,
    files,
  }
}

/** 素材组的可选列表：图片组只留 png/gif，视频组只留 mp4/webm/mkv。 */
export function filterMediaFiles(files: readonly string[], group: 'image' | 'video'): string[] {
  const allowed = group === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS
  return files.filter((file) => (allowed as readonly string[]).includes(extensionOf(file)))
}

/** 列表里是否包含该路径（相对 `resource/`；大小写不敏感、分隔符归一）。 */
export function containsMediaPath(files: readonly string[], path: string): boolean {
  const normalized = path.trim().replace(/\\/g, '/').toLowerCase()
  if (normalized === '') {
    return false
  }
  return files.some((file) => file.replace(/\\/g, '/').toLowerCase() === normalized)
}

/** 素材存在性状态（列表不可用时为 `unknown`，不误报缺失）。 */
export type MediaPresence = 'empty' | 'present' | 'missing' | 'unknown'

export function mediaPresence(
  path: string,
  files: readonly string[] | null,
  listingAvailable: boolean,
): MediaPresence {
  if (path.trim() === '') {
    return 'empty'
  }
  if (!listingAvailable || files === null) {
    return 'unknown'
  }
  return containsMediaPath(files, path) ? 'present' : 'missing'
}

/** 素材提示文案（09-03 §4.2：不把「列表里没有」显示成确定缺失）。 */
export function mediaPresenceLabel(presence: MediaPresence): string {
  return {
    empty: '未选择素材',
    present: '资源存在',
    missing: '资源列表中未找到（可能来自别的目录或尚未刷新）',
    unknown: '资源列表不可用（未连接游戏实例）',
  }[presence]
}

/** 视频层的固定说明（09-04 §三：没有视频专属字段）。 */
export const VIDEO_LAYER_NOTE =
  '视频仍是 layer_type=image，没有视频专属字段。缺解码工具链时游戏不显示也不占位；有工具链但文件损坏或编码不支持时显示错误纹理，位置 / 锚点 / 缩放 / 取材照常作用在它上面；音轨随画面自动播放、固定在主通道，没有音量 / 淡入 / 空间化控件。'
