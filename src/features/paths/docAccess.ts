/**
 * 07 面板的只读文档快照（04-05：面板只能拿 `DocumentService`，拿不到 `DocStore` 本体）。
 *
 * `core/paths/*` 与 `features/authoring/*` 的纯函数都吃 `ScriptDoc`，因此面板侧用
 * `DocumentService.serialize()`（内存派生的无损文本，只剥离 `authoring`）重建一份只读快照，
 * 供校验 / 端点下拉 / 生成器计划 / 预览使用。快照按文档修订号缓存，修订号变化才重新解析。
 *
 * 快照只读：面板写文档一律走 `PanelContext.commands.commit`，绝不在快照上改数据。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocumentService } from '../../workbench/api/documents.ts'
import type { JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { isJsonObject } from '../../core/doc/json.ts'

/** 快照来源：修订号 + 序列化文本（`DocumentService` 满足）。 */
export interface SnapshotSource {
  readonly revision: number
  serialize(): string
}

interface SnapshotCacheEntry {
  revision: number
  doc: ScriptDoc | null
}

const snapshotCache = new WeakMap<object, SnapshotCacheEntry>()

/**
 * 取当前文档的只读快照；无文档 / 无目录时返回 `null`。
 *
 * 同一修订号内复用同一份快照对象，避免每次按键都重解析整份脚本。
 */
export function docSnapshot(
  source: SnapshotSource | undefined,
  catalog: CatalogIndex | undefined,
): ScriptDoc | null {
  if (source === undefined || catalog === undefined) {
    return null
  }
  const cached = snapshotCache.get(source)
  if (cached !== undefined && cached.revision === source.revision) {
    return cached.doc
  }
  const text = source.serialize()
  let doc: ScriptDoc | null = null
  if (text.length > 0) {
    // `serialize()` 的输出由编辑器自己派生，只可能是合法 JSON；解析失败等价于“没有可用文档”。
    try {
      const parsed = parseDoc(JSON.parse(text) as JsonValue, { metaKeys: metaKeys(catalog) })
      doc = parsed.ok ? parsed.doc : null
    } catch {
      doc = null
    }
  }
  snapshotCache.set(source, { revision: source.revision, doc })
  return doc
}

/** 方便面板直接拿 `DocumentService`（结构上满足 `SnapshotSource`）。 */
export function documentSnapshot(
  service: DocumentService | undefined,
  catalog: CatalogIndex | undefined,
): ScriptDoc | null {
  if (service === undefined) {
    return null
  }
  return docSnapshot(
    { revision: service.summary().revision, serialize: () => service.serialize() },
    catalog,
  )
}

/** 快照里的顶层 `paths[]`（只读）；没有 `paths` 时返回空数组。 */
export function snapshotPaths(doc: ScriptDoc | null): JsonValue[] {
  if (doc === null) {
    return []
  }
  const raw = doc.root.paths
  return Array.isArray(raw) ? raw : []
}

/** 快照里的某一个片段对象（按运行时 `clip.id` 找）；找不到返回 `null`。 */
export function snapshotClipById(doc: ScriptDoc | null, clipId: string): ReturnType<typeof asObject> {
  if (doc === null || clipId.length === 0) {
    return null
  }
  for (const track of asArray(doc.timeline.tracks)) {
    const trackNode = asObject(track)
    if (trackNode === null) {
      continue
    }
    for (const clip of asArray(trackNode.clips)) {
      const clipNode = asObject(clip)
      if (clipNode === null) {
        continue
      }
      if (clipNode.id === clipId) {
        return clipNode
      }
    }
  }
  return null
}

function asObject(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return value !== undefined && isJsonObject(value) ? value : null
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}
