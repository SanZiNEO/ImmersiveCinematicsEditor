/**
 * 12 轮自检共享上下文（`verify12/*.ts` 只读使用）。
 *
 * 只提供**事实层**工具：目录、空文档、脚本快照与结构读取。
 * 各切片不得在共享对象上就地修改（需要改就自己 `cloneJson`）。
 */
import { buildCatalog, indexCatalog } from '../../core/schema/index.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import { DocStore } from '../../core/doc/store.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { cloneJson, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'

/** 12 轮自检上下文。 */
export interface VerifyContext {
  /** 02 字段目录（内置 + 已发现轨道 / 曲线 / meta / 触发器）。 */
  readonly catalog: CatalogIndex
  /** `meta` 键集合（来自目录，不硬编码）。 */
  readonly metaKeys: readonly string[]
  /** 新建一个未打开文档的 store（每条用例独立，避免撤销栈互相污染）。 */
  createStore(): DocStore
  /** 从根对象构造文档；结构不合法直接抛错（自检不允许"带病文档"混过去）。 */
  docFrom(root: JsonObject): ScriptDoc
  /** 最小合法空文档：`meta` 三身份字段 + 空 `timeline.tracks`。 */
  emptyDoc(): ScriptDoc
}

/** 从根对象构造文档的失败类型（自检用，便于断言"应该失败"）。 */
export class DocBuildError extends Error {
  readonly issues: readonly string[]
  constructor(issues: readonly string[]) {
    super(`文档结构不合法：${issues.join('；')}`)
    this.name = 'DocBuildError'
    this.issues = issues
  }
}

/** 创建共享上下文。 */
export function createVerifyContext(label = 'verify-12'): VerifyContext {
  const catalog = indexCatalog(buildCatalog(label))
  const keys = metaKeys(catalog)
  return {
    catalog,
    metaKeys: keys,
    createStore(): DocStore {
      return new DocStore({ catalog, metaKeys: keys })
    },
    docFrom(root: JsonObject): ScriptDoc {
      const parsed = parseDoc(cloneJson(root), { metaKeys: keys })
      if (!parsed.ok) {
        throw new DocBuildError(parsed.issues.map((issue) => `${issue.code} ${issue.jsonPath}: ${issue.message}`))
      }
      return parsed.doc
    },
    emptyDoc(): ScriptDoc {
      const root: JsonObject = {
        meta: { id: 'verify12', name: 'verify12', author: 'verify12' },
        timeline: { tracks: [] },
      }
      return this.docFrom(root)
    },
  }
}

// ── 结构读取（只读；不补默认值、不改输入）────────────────────────────────────

/** `timeline.tracks` 数组；缺失返回空数组。 */
export function tracksOf(doc: ScriptDoc): JsonObject[] {
  const tracks = doc.timeline.tracks
  if (!Array.isArray(tracks)) {
    return []
  }
  return tracks.filter((entry): entry is JsonObject => isJsonObject(entry as JsonValue))
}

/** 按类型取第 n 条轨道（默认第一条）。 */
export function trackOfType(doc: ScriptDoc, type: string, index = 0): JsonObject | null {
  const matches = tracksOf(doc).filter((track) => track.type === type)
  return matches[index] ?? null
}

/** 轨道 `clips` 数组；缺失返回空数组。 */
export function clipsOf(track: JsonObject): JsonObject[] {
  const clips = track.clips
  if (!Array.isArray(clips)) {
    return []
  }
  return clips.filter((entry): entry is JsonObject => isJsonObject(entry as JsonValue))
}

/** 片段 `objects` 对象；缺失返回空对象（只读语义，不写回）。 */
export function objectsOf(clip: JsonObject): JsonObject {
  const objects = clip.objects
  return isJsonObject(objects as JsonValue) ? (objects as JsonObject) : {}
}

/** 片段 `id`（字符串）；未设置返回 `null`。 */
export function clipIdOf(clip: JsonObject): string | null {
  return typeof clip.id === 'string' ? clip.id : null
}

/** 文档内 `paths[]`；缺失返回空数组。 */
export function pathEntries(doc: ScriptDoc): JsonObject[] {
  const paths = doc.root.paths
  if (!Array.isArray(paths)) {
    return []
  }
  return paths.filter((entry): entry is JsonObject => isJsonObject(entry as JsonValue))
}

/** 按 id 找片段（文档顺序）。 */
export function clipById(doc: ScriptDoc, id: string): JsonObject | null {
  for (const track of tracksOf(doc)) {
    for (const clip of clipsOf(track)) {
      if (clipIdOf(clip) === id) {
        return clip
      }
    }
  }
  return null
}

/** 文档内全部片段（按轨道顺序）。 */
export function allClips(doc: ScriptDoc): Array<{ trackType: string; clip: JsonObject }> {
  const result: Array<{ trackType: string; clip: JsonObject }> = []
  for (const track of tracksOf(doc)) {
    const type = typeof track.type === 'string' ? track.type : ''
    for (const clip of clipsOf(track)) {
      result.push({ trackType: type, clip })
    }
  }
  return result
}
