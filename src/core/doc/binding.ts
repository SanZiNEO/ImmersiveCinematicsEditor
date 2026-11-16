/**
 * 字段目录接入（03-08）：把 02 的 `CatalogIndex` 绑定到文档的轨道 / 对象路径。
 *
 * 本轮只定义接线：字段查询全部走 `CatalogIndex`，不建第二份字段表、不做声明自检。
 *
 * 绑定规则：
 * - 轨道类型被目录认识 → 绑定该轨的 `playControl` 与 `objects`；
 * - 第三方 `modid:xxx` → 文档仍打开，该轨只读、字段不解释、不猜、不删，保存原样写回；
 * - 对象路径命中 `objectDef` → 按 `mode/type/interp/min/max/enumValues/nullable/default` 解释；
 * - 未命中 → `unknown: true`（结构检查报 block，原值保留）。
 *
 * `catalogHash` 是编辑器会话状态，不写进脚本 JSON。
 */
import type { CatalogIndex } from '../schema/index.ts'
import type { FieldEntry } from '../schema/types.ts'
import { eachClip } from './identity.ts'
import type { ClipRegistry } from './identity.ts'
import { isJsonObject } from './json.ts'
import { unknownTrackKind } from './keys.ts'
import type { ScriptDoc } from './types.ts'

/** 一个对象路径的绑定结果。 */
export interface BoundObject {
  path: string
  /** 命中 02 目录的声明；未命中 / 第三方轨道为 `undefined`。 */
  def?: FieldEntry
  /** 轨道已知但路径未登记（本地 block）。 */
  unknown: boolean
}

/** 一个轨道类型的绑定视图。 */
export interface BoundTrack {
  /** `timeline.tracks[]` 的下标；独立片段聚合的伪轨道为 `-1`。 */
  index: number
  type: string
  known: boolean
  /** 第三方 `modid:xxx`：只读、字段不解释。 */
  thirdParty: boolean
  playControl: FieldEntry[]
  /** 文档中该轨道出现过的对象路径（去重，按首次出现顺序）。 */
  objects: Map<string, BoundObject>
}

/** 文档的目录绑定。 */
export interface DocBinding {
  /** 打开 / 重绑时的目录指纹（会话状态，不写盘）。 */
  catalogHash: string
  tracks: BoundTrack[]
  /** 独立片段按 `track` 聚合的伪轨道。 */
  standalone: BoundTrack[]
  objectDef(type: string, path: string): FieldEntry | undefined
  availability(type: string, path: string, values: Record<string, unknown>): { available: boolean; reason?: string }
  trackAt(index: number): BoundTrack | undefined
}

/** 收集一个片段 `objects` 的路径（保持声明顺序）。 */
function objectPaths(clip: unknown): string[] {
  if (!isJsonObject(clip) || !isJsonObject(clip.objects)) {
    return []
  }
  return Object.keys(clip.objects)
}

/** 创建一个轨道类型的绑定视图（路径按首次出现顺序累积）。 */
function createBoundTrack(catalog: CatalogIndex, type: string, index: number): BoundTrack {
  const track = catalog.track(type)
  return {
    index,
    type,
    known: track !== undefined,
    thirdParty: track === undefined && unknownTrackKind(type) === 'third-party',
    playControl: track === undefined ? [] : [...track.playControl],
    objects: new Map(),
  }
}

/** 往绑定视图里登记一条对象路径。 */
function registerPath(catalog: CatalogIndex, bound: BoundTrack, path: string): void {
  if (bound.objects.has(path)) {
    return
  }
  const def = bound.known ? catalog.objectDef(bound.type, path) : undefined
  bound.objects.set(path, {
    path,
    ...(def === undefined ? {} : { def }),
    unknown: bound.known && def === undefined,
  })
}

/**
 * 绑定文档。
 *
 * @param registry 已与文档同步的片段注册表（用于按 `clipKey` 定位，issue 由结构检查产出）。
 */
export function bindDocument(
  doc: ScriptDoc,
  catalog: CatalogIndex,
  catalogHash: string,
  registry?: ClipRegistry,
): DocBinding {
  const tracks: BoundTrack[] = []
  const byType = new Map<string, BoundTrack>()

  const timelineTracks = doc.timeline.tracks
  if (Array.isArray(timelineTracks)) {
    for (let index = 0; index < timelineTracks.length; index += 1) {
      const track = timelineTracks[index]
      const type = isJsonObject(track) && typeof track.type === 'string' ? track.type : ''
      const bound = createBoundTrack(catalog, type, index)
      tracks.push(bound)
      if (!byType.has(type)) {
        byType.set(type, bound)
      }
      if (isJsonObject(track) && Array.isArray(track.clips)) {
        for (const clip of track.clips) {
          for (const path of objectPaths(clip)) {
            registerPath(catalog, bound, path)
          }
        }
      }
    }
  }

  const standalone: BoundTrack[] = []
  const standaloneByType = new Map<string, BoundTrack>()
  eachClip(doc, (clip, inline) => {
    if (inline) {
      return
    }
    const type = typeof clip.track === 'string' ? clip.track : ''
    let bound = standaloneByType.get(type)
    if (bound === undefined) {
      bound = createBoundTrack(catalog, type, -1)
      standaloneByType.set(type, bound)
      standalone.push(bound)
    }
    for (const path of objectPaths(clip)) {
      registerPath(catalog, bound, path)
    }
  })

  void registry

  return {
    catalogHash,
    tracks,
    standalone,
    objectDef(type, path) {
      return catalog.objectDef(type, path)
    },
    availability(type, path, values) {
      return catalog.availability(type, path, values)
    },
    trackAt(index) {
      return tracks[index]
    },
  }
}

/** 绑定是否与给定目录指纹一致（保存前钉住检查）。 */
export function bindingMatches(binding: DocBinding, catalogHash: string): boolean {
  return binding.catalogHash === catalogHash
}
