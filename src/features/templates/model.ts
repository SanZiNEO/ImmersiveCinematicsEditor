/**
 * 模板内部展开模型（12-01 §二 / 12-02）。
 *
 * 产物草稿与最终脚本同构：片段对象 / 路径条目 / 轨道 / 触发器骨架。草稿不携带模板 id、
 * 参数值、槽位 id、命名空间、来源或生成时间；这些只存在于展开过程，不进入产物。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { ParamValue, TemplateDefinition, TemplateParamIssue } from './types.ts'

/** 路径草稿（对应 root.paths 一条目）。 */
export interface PathDraft {
  id: string
  clip: string
  from: number
  to: number
  axes: string[]
  geometry: JsonObject
  timing?: JsonObject
}

/** 片段草稿（对应某轨道内联片段）。 */
export interface ClipDraft {
  clipId: string
  trackType: string
  start: number
  duration: number
  objects: JsonObject
  paths: PathDraft[]
}

/** 轨道草稿。 */
export interface TrackDraft {
  trackType: string
  clips: ClipDraft[]
}

/** 一层展开产物：片段层填 clips；轨道层填 tracks；脚本层填 meta / tracks / triggers。 */
export interface LayerDraft {
  meta?: JsonObject
  tracks: TrackDraft[]
  clips: ClipDraft[]
  paths: PathDraft[]
  triggers: JsonObject[]
}

/** 引用绑定形态：常量 / 上层同名参数 / 登记在册的封闭派生。 */
export type BindingForm = 'constant' | 'inherit' | 'derive'

export interface RefBinding {
  form: BindingForm
  constant?: ParamValue
  fromParam?: string
  derive?: { name: string; args: Record<string, ParamValue> }
}

/** 向下引用声明。 */
export interface RefDecl {
  target: string
  bindings: Record<string, RefBinding>
  /** 固定重复次数；与 repeatParam 二选一，repeatParam 取上层整数参数。 */
  repeat?: number
  repeatParam?: string
}

/** 展开上下文：目录、命名空间、序号 / 实例号、id 分配器。 */
export interface ExpandContext {
  catalog: CatalogIndex
  namespace: string
  refIndex: number
  instance: number
  nextClipId(): string
  nextPathId(): string
}

/** 内部模板登记项：门面定义 + 引用声明 + 展开函数 + 跨参数校验。 */
export interface InternalTemplate {
  def: TemplateDefinition
  refs: RefDecl[]
  expand: (params: Record<string, ParamValue>, ctx: ExpandContext) => LayerDraft
  /** 跨参数校验（类型之外的联合约束）；返回问题清单，error 阻止展开。 */
  crossCheck?: (params: Record<string, ParamValue>) => TemplateParamIssue[]
}

/** 空草稿。 */
export function emptyDraft(): LayerDraft {
  return { tracks: [], clips: [], paths: [], triggers: [] }
}

/** 合并子草稿到父草稿（片段 / 路径 / 触发器 / 轨道分别归并）。 */
export function mergeDraft(target: LayerDraft, source: LayerDraft): void {
  target.tracks.push(...source.tracks)
  target.clips.push(...source.clips)
  target.paths.push(...source.paths)
  target.triggers.push(...source.triggers)
  if (source.meta !== undefined) {
    target.meta = { ...target.meta, ...source.meta }
  }
}

/** 生成器：按命名空间分配符合片段 / 路径 id 白名单的最终 id。 */
export function createIdAllocator(namespace: string): { nextClipId(): string; nextPathId(): string } {
  let clipSeq = 0
  let pathSeq = 0
  return {
    nextClipId(): string {
      clipSeq += 1
      return `${namespace}c${clipSeq}`
    },
    nextPathId(): string {
      pathSeq += 1
      return `${namespace}p${pathSeq}`
    },
  }
}

/** 轨道类型顺序（与目录 TRACK_ORDER 一致；脚本空轨七类）。 */
export const TRACK_TYPE_ORDER = [
  'CAMERA', 'LETTERBOX', 'AUDIO', 'EVENT', 'MOD_EVENT', 'OVERLAY', 'ADJUST',
] as const

export type TrackType = (typeof TRACK_TYPE_ORDER)[number]

/** 草稿内全部片段（轨道内 + 片段层未挂轨道）。 */
export function draftClips(draft: LayerDraft): ClipDraft[] {
  const out: ClipDraft[] = [...draft.clips]
  for (const track of draft.tracks) {
    out.push(...track.clips)
  }
  return out
}

/** 深拷贝 JSON 值（展开期参数只读，产物草稿独立克隆）。 */
export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
