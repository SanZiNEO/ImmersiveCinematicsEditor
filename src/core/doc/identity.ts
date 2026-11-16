/**
 * 片段身份、选择与引用完整性（03-03）。
 *
 * 三种身份：
 * - 运行时身份 `clip.id`（写盘，脚本内唯一）；
 * - 编辑器身份 `clipKey`（会话内稳定键，**不写盘**）；
 * - 关键帧定位 `(clipKey, objectPath, keyframeTime)`，时间只是定位值，不是下标。
 *
 * `clipKey` 的稳定性规则：
 * - 同一棵树内重排 / 跨轨移动 → 对象引用不变 → 键不变；
 * - 撤销 / 重做（`sync(doc, { restore: true })`）→ 先按 `id`、再按结构位置重绑，键不变；
 * - 复制片段 → 新对象、`id` 重复（不按 id 认领）→ 新键。
 */
import { isJsonObject } from './json.ts'
import { clipIdOf, hasObjects } from './clip.ts'
import { findKeyframeIndex, positionNodeTimes } from './object.ts'
import { isValidObjectPath } from './path.ts'
import type { JsonObject, JsonValue, ScriptDoc, Selection } from './types.ts'

/** 一个片段在文档中的位置与身份。 */
export interface ClipHandle {
  key: string
  clip: JsonObject
  inline: boolean
  trackType: string
  trackIndex: number
  clipIndex: number
  id?: string
}

interface ClipRecord {
  key: string
  ref: WeakRef<JsonObject>
  id?: string
  inline: boolean
  trackType: string
  trackIndex: number
  clipIndex: number
  generation: number
}

/** 引用位置：JSON 路径段 + 可读路径。 */
export interface ReferenceSite {
  /** JSON 路径段（`setAt` 用）。 */
  path: (string | number)[]
  /** 可读路径（issue / 提示用）。 */
  jsonPath: string
}

/** 一条片段引用。 */
export interface ClipReference extends ReferenceSite {
  kind: 'path' | 'binding' | 'schedule' | 'exit' | 'condition' | 'action'
  clipId: string
  label: string
}

/** 路径端点的匹配容差（秒），与 `PathCollectionParser.TIME_EPSILON` 同口径。 */
export const PATH_TIME_EPSILON = 1e-4

/** 片段的结构位置键（快照精确恢复 clipKey 用）。 */
export function locationKey(inline: boolean, trackIndex: number, clipIndex: number): string {
  return inline ? `inline:${trackIndex}:${clipIndex}` : `standalone:${clipIndex}`
}

/** 遍历文档全部片段（内联 + 独立），按文档顺序。 */
export function eachClip(
  doc: ScriptDoc,
  visit: (clip: JsonObject, inline: boolean, trackType: string, trackIndex: number, clipIndex: number) => void,
): void {
  const tracks = doc.timeline.tracks
  if (Array.isArray(tracks)) {
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const track = tracks[trackIndex]
      if (!isJsonObject(track)) {
        continue
      }
      const trackType = typeof track.type === 'string' ? track.type : ''
      const clips = track.clips
      if (!Array.isArray(clips)) {
        continue
      }
      for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
        const clip = clips[clipIndex]
        if (isJsonObject(clip)) {
          visit(clip, true, trackType, trackIndex, clipIndex)
        }
      }
    }
  }
  const standalone = doc.root.clips
  if (Array.isArray(standalone)) {
    for (let clipIndex = 0; clipIndex < standalone.length; clipIndex += 1) {
      const clip = standalone[clipIndex]
      if (isJsonObject(clip)) {
        const trackType = typeof clip.track === 'string' ? clip.track : ''
        visit(clip, false, trackType, -1, clipIndex)
      }
    }
  }
}

/** clipKey 注册表：会话内稳定键的唯一分配与修复入口。 */
export class ClipRegistry {
  private readonly records = new Map<string, ClipRecord>()
  private readonly byClip = new WeakMap<JsonObject, string>()
  private sequence = 0
  private generation = 0

  /**
   * 与文档同步：为所有片段分配 / 保持 `clipKey`。
   *
   * @param options.restore `true` = 快照恢复（撤销 / 重做），允许按结构位置重绑匿名片段。
   * @param options.preferred 快照记录的位置 → clipKey（精确恢复撤销前的键）。
   */
  sync(
    doc: ScriptDoc,
    options: { restore?: boolean; preferred?: ReadonlyMap<string, string> } = {},
  ): void {
    this.generation += 1
    const idCounts = new Map<string, number>()
    eachClip(doc, (clip) => {
      const id = clipIdOf(clip)
      if (id !== undefined) {
        idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
      }
    })

    const claimed = new Set<string>()
    const seen = new Set<JsonObject>()
    eachClip(doc, (clip, inline, trackType, trackIndex, clipIndex) => {
      if (seen.has(clip)) {
        return
      }
      seen.add(clip)
      const id = clipIdOf(clip)
      let key = this.byClip.get(clip)
      if (key === undefined || !this.records.has(key)) {
        const preferred = options.preferred?.get(locationKey(inline, trackIndex, clipIndex))
        if (preferred !== undefined && !claimed.has(preferred)) {
          key = preferred
        }
      }
      if (key === undefined || !this.records.has(key)) {
        key = this.matchRecord(id, idCounts, inline, trackType, trackIndex, clipIndex, claimed, options.restore === true)
      }
      if (key === undefined) {
        this.sequence += 1
        key = `c${this.sequence}`
      }
      claimed.add(key)
      const record: ClipRecord = {
        key,
        ref: new WeakRef(clip),
        id,
        inline,
        trackType,
        trackIndex,
        clipIndex,
        generation: this.generation,
      }
      this.records.set(key, record)
      this.byClip.set(clip, key)
    })

    for (const [key, record] of [...this.records.entries()]) {
      if (claimed.has(key)) {
        continue
      }
      if (this.generation - record.generation > 2) {
        this.records.delete(key)
      }
    }
  }

  /** 按 id / 结构位置匹配一条未认领记录。 */
  private matchRecord(
    id: string | undefined,
    idCounts: ReadonlyMap<string, number>,
    inline: boolean,
    trackType: string,
    trackIndex: number,
    clipIndex: number,
    claimed: ReadonlySet<string>,
    restore: boolean,
  ): string | undefined {
    if (id !== undefined && idCounts.get(id) === 1) {
      for (const [key, record] of this.records) {
        if (!claimed.has(key) && record.id === id) {
          return key
        }
      }
    }
    if (!restore) {
      return undefined
    }
    for (const [key, record] of this.records) {
      if (claimed.has(key)) {
        continue
      }
      if (record.inline === inline && record.trackType === trackType
        && record.trackIndex === trackIndex && record.clipIndex === clipIndex) {
        return key
      }
    }
    return undefined
  }

  /** 为显式新增的片段分配新键（复制 / 新建走这里，绝不继承旧键）。 */
  assign(clip: JsonObject): string {
    this.sequence += 1
    const key = `c${this.sequence}`
    this.byClip.set(clip, key)
    return key
  }

  /** 片段当前键；未同步 / 不存在返回 `undefined`。 */
  keyOf(clip: JsonObject): string | undefined {
    return this.byClip.get(clip)
  }

  /** 键 → 片段句柄。 */
  handle(key: string): ClipHandle | undefined {
    const record = this.records.get(key)
    const clip = record?.ref.deref()
    if (record === undefined || clip === undefined) {
      return undefined
    }
    return {
      key,
      clip,
      inline: record.inline,
      trackType: record.trackType,
      trackIndex: record.trackIndex,
      clipIndex: record.clipIndex,
      ...(record.id === undefined ? {} : { id: record.id }),
    }
  }

  /** 全部句柄（按文档顺序）。 */
  handles(): ClipHandle[] {
    const result: ClipHandle[] = []
    for (const key of this.records.keys()) {
      const handle = this.handle(key)
      if (handle !== undefined) {
        result.push(handle)
      }
    }
    result.sort((left, right) => {
      if (left.inline !== right.inline) {
        return left.inline ? -1 : 1
      }
      if (left.trackIndex !== right.trackIndex) {
        return left.trackIndex - right.trackIndex
      }
      return left.clipIndex - right.clipIndex
    })
    return result
  }

  /** 清空（新建 / 打开新文档时重建）。 */
  reset(): void {
    this.records.clear()
    this.sequence = 0
    this.generation = 0
  }
}

/** 选择修复（撤销 / 重做 / 结构变更后）：只修选择，不改引用。 */
export function repairSelection(doc: ScriptDoc, registry: ClipRegistry, selection: Selection): Selection {
  if (selection.domain === 'none') {
    return selection
  }
  if (selection.domain === 'path' || selection.domain === 'rule' || selection.domain === 'binding') {
    const id = selection.domain === 'path' ? selection.pathId
      : selection.domain === 'rule' ? selection.ruleId : selection.bindingId
    if (id === undefined) {
      return { domain: 'none' }
    }
    const collection = selection.domain === 'path' ? doc.root.paths
      : selection.domain === 'rule' ? doc.root.rules : doc.root.rule_bindings
    const exists = Array.isArray(collection)
      && collection.some((entry) => isJsonObject(entry) && entry.id === id)
    return exists ? selection : { domain: 'none' }
  }

  if (selection.clipKey === undefined) {
    return { domain: 'none' }
  }
  const handle = registry.handle(selection.clipKey)
  if (handle === undefined) {
    return { domain: 'none' }
  }
  if (selection.domain === 'clip') {
    return selection
  }
  const objectPath = selection.objectPath
  if (objectPath === undefined || !isValidObjectPath(objectPath)) {
    return { domain: 'clip', clipKey: selection.clipKey }
  }
  const objects = handle.clip.objects
  const property = isJsonObject(objects) ? objects[objectPath] : undefined
  if (!isJsonObject(property)) {
    return { domain: 'clip', clipKey: selection.clipKey }
  }
  if (selection.domain === 'object') {
    return selection
  }
  if (selection.keyframeTime === undefined) {
    return { domain: 'object', clipKey: selection.clipKey, objectPath }
  }
  const keyframes = property.keyframes
  const frames = Array.isArray(keyframes) ? keyframes : []
  const framesTyped = frames.filter(isJsonObject).map((frame) => ({
    time: typeof frame.time === 'number' ? frame.time : Number.NaN,
    value: frame.value,
  }))
  if (findKeyframeIndex(framesTyped, selection.keyframeTime) < 0) {
    return { domain: 'object', clipKey: selection.clipKey, objectPath }
  }
  return selection
}

/** 打开文档后选中第一个 CAMERA 片段（03-07）；没有则 `none`。 */
export function selectFirstCameraClip(registry: ClipRegistry): Selection {
  const camera = registry.handles().find((handle) => handle.inline && handle.trackType === 'CAMERA')
  return camera === undefined ? { domain: 'none' } : { domain: 'clip', clipKey: camera.key }
}

/** 收集全部片段引用（paths / rule_bindings / exit / schedule / 规则条件与动作）。 */
export function collectClipReferences(doc: ScriptDoc): ClipReference[] {
  const references: ClipReference[] = []

  eachClip(doc, (clip, inline, _trackType, trackIndex, clipIndex) => {
    const base = inline ? `timeline.tracks[${trackIndex}].clips[${clipIndex}]` : `clips[${clipIndex}]`
    const exit = clip.exit
    if (isJsonObject(exit) && exit.on_complete === 'goto' && typeof exit.target === 'string') {
      references.push({
        kind: 'exit',
        clipId: exit.target,
        label: `${base}.exit（goto）`,
        jsonPath: `${base}.exit.target`,
        path: inline
          ? ['timeline', 'tracks', trackIndex, 'clips', clipIndex, 'exit', 'target']
          : ['clips', clipIndex, 'exit', 'target'],
      })
    }
  })

  const paths = doc.root.paths
  if (Array.isArray(paths)) {
    for (let index = 0; index < paths.length; index += 1) {
      const entry = paths[index]
      if (!isJsonObject(entry) || typeof entry.clip !== 'string') {
        continue
      }
      references.push({
        kind: 'path',
        clipId: entry.clip,
        label: `paths[${index}]（${typeof entry.id === 'string' ? entry.id : '未命名路径'}）`,
        jsonPath: `paths[${index}].clip`,
        path: ['paths', index, 'clip'],
      })
    }
  }

  const bindings = doc.root.rule_bindings
  if (Array.isArray(bindings)) {
    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index]
      if (!isJsonObject(binding)) {
        continue
      }
      if (typeof binding.clip === 'string') {
        references.push({
          kind: 'binding',
          clipId: binding.clip,
          label: `rule_bindings[${index}].clip`,
          jsonPath: `rule_bindings[${index}].clip`,
          path: ['rule_bindings', index, 'clip'],
        })
      }
      const schedule = binding.schedule
      if (isJsonObject(schedule) && typeof schedule.clip === 'string') {
        references.push({
          kind: 'schedule',
          clipId: schedule.clip,
          label: `rule_bindings[${index}].schedule.clip`,
          jsonPath: `rule_bindings[${index}].schedule.clip`,
          path: ['rule_bindings', index, 'schedule', 'clip'],
        })
      }
      const exit = binding.exit
      if (isJsonObject(exit) && exit.on_complete === 'goto' && typeof exit.target === 'string') {
        references.push({
          kind: 'exit',
          clipId: exit.target,
          label: `rule_bindings[${index}].exit（goto）`,
          jsonPath: `rule_bindings[${index}].exit.target`,
          path: ['rule_bindings', index, 'exit', 'target'],
        })
      }
    }
  }

  const rules = doc.root.rules
  if (Array.isArray(rules)) {
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index]
      if (!isJsonObject(rule)) {
        continue
      }
      collectConditionClipRefs(rule.condition, `rules[${index}].condition`, ['rules', index, 'condition'], references)
      const actions = rule.actions
      if (Array.isArray(actions)) {
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          const action = actions[actionIndex]
          if (isJsonObject(action) && action.type === 'goto_clip' && typeof action.clip === 'string') {
            references.push({
              kind: 'action',
              clipId: action.clip,
              label: `rules[${index}].actions[${actionIndex}]（goto_clip）`,
              jsonPath: `rules[${index}].actions[${actionIndex}].clip`,
              path: ['rules', index, 'actions', actionIndex, 'clip'],
            })
          }
        }
      }
      const policy = rule.policy
      const onTimeout = isJsonObject(policy) ? policy.on_timeout : undefined
      if (Array.isArray(onTimeout)) {
        for (let actionIndex = 0; actionIndex < onTimeout.length; actionIndex += 1) {
          const action = onTimeout[actionIndex]
          if (isJsonObject(action) && action.type === 'goto_clip' && typeof action.clip === 'string') {
            references.push({
              kind: 'action',
              clipId: action.clip,
              label: `rules[${index}].policy.on_timeout[${actionIndex}]（goto_clip）`,
              jsonPath: `rules[${index}].policy.on_timeout[${actionIndex}].clip`,
              path: ['rules', index, 'policy', 'on_timeout', actionIndex, 'clip'],
            })
          }
        }
      }
    }
  }

  return references
}

/** 递归收集条件树里的 `clip_fact.clip`（`all_of` / `any` 的 `list[].conditions`）。 */
function collectConditionClipRefs(
  node: JsonValue | undefined,
  jsonPath: string,
  path: (string | number)[],
  out: ClipReference[],
): void {
  if (!isJsonObject(node)) {
    return
  }
  const type = node.type
  if (type === 'clip_fact' && typeof node.clip === 'string') {
    out.push({
      kind: 'condition',
      clipId: node.clip,
      label: `${jsonPath}（clip_fact）`,
      jsonPath: `${jsonPath}.clip`,
      path: [...path, 'clip'],
    })
    return
  }
  const list = node.list
  if (Array.isArray(list) && (type === 'all_of' || type === 'any')) {
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index]
      if (!isJsonObject(item)) {
        continue
      }
      const conditions = item.conditions
      collectConditionClipRefs(
        conditions,
        `${jsonPath}.list[${index}].conditions`,
        [...path, 'list', index, 'conditions'],
        out,
      )
    }
  }
}

/** 指向某片段 id 的全部引用。 */
export function referencesToClip(doc: ScriptDoc, clipId: string): ClipReference[] {
  return collectClipReferences(doc).filter((reference) => reference.clipId === clipId)
}

/** 删除片段前检查（03-03）：有引用 → 阻止，返回引用清单。 */
export function canRemoveClip(doc: ScriptDoc, clipId: string | undefined): {
  ok: boolean
  references: ClipReference[]
} {
  if (clipId === undefined) {
    return { ok: true, references: [] }
  }
  const references = referencesToClip(doc, clipId)
  return { ok: references.length === 0, references }
}

/** 改 `clip.id` 前收集需要同步改写的引用位置（一次提交）。 */
export function referenceSitesForRename(doc: ScriptDoc, oldId: string): ReferenceSite[] {
  return referencesToClip(doc, oldId).map((reference) => ({
    path: reference.path,
    jsonPath: reference.jsonPath,
  }))
}

/**
 * 删除位置关键帧前检查（03-03）：该时间是某条路径的端点 → 阻止。
 *
 * 端点匹配容差 1e-4 秒。
 */
export function pathEndpointsAtTime(doc: ScriptDoc, clipId: string | undefined, time: number): string[] {
  if (clipId === undefined) {
    return []
  }
  const hits: string[] = []
  const paths = doc.root.paths
  if (!Array.isArray(paths)) {
    return hits
  }
  for (let index = 0; index < paths.length; index += 1) {
    const entry = paths[index]
    if (!isJsonObject(entry) || entry.clip !== clipId) {
      continue
    }
    const from = typeof entry.from === 'number' ? entry.from : undefined
    const to = typeof entry.to === 'number' ? entry.to : undefined
    if (from !== undefined && Math.abs(from - time) <= PATH_TIME_EPSILON) {
      hits.push(`paths[${index}].from`)
    }
    if (to !== undefined && Math.abs(to - time) <= PATH_TIME_EPSILON) {
      hits.push(`paths[${index}].to`)
    }
  }
  return hits
}

/**
 * 插入位置关键帧前检查（03-03）：新时间落在某条路径的端点区间内 → 会切断端点相邻性。
 *
 * 返回受影响的路径条目（提示用，由作者决定重绑或取消）。
 */
export function pathIntervalsContaining(doc: ScriptDoc, clipId: string | undefined, time: number): string[] {
  if (clipId === undefined) {
    return []
  }
  const hits: string[] = []
  const paths = doc.root.paths
  if (!Array.isArray(paths)) {
    return hits
  }
  for (let index = 0; index < paths.length; index += 1) {
    const entry = paths[index]
    if (!isJsonObject(entry) || entry.clip !== clipId) {
      continue
    }
    const from = typeof entry.from === 'number' ? entry.from : undefined
    const to = typeof entry.to === 'number' ? entry.to : undefined
    if (from === undefined || to === undefined) {
      continue
    }
    if (time > from + PATH_TIME_EPSILON && time < to - PATH_TIME_EPSILON) {
      hits.push(`paths[${index}]`)
    }
  }
  return hits
}

/** 目标片段的位置节点时间（供路径端点下拉）；片段不存在返回空数组。 */
export function clipPositionNodes(doc: ScriptDoc, clipId: string): number[] {
  let found: JsonObject | undefined
  eachClip(doc, (clip) => {
    if (found === undefined && clipIdOf(clip) === clipId) {
      found = clip
    }
  })
  if (found === undefined || !hasObjects(found)) {
    return []
  }
  const objects = found.objects
  if (!isJsonObject(objects)) {
    return []
  }
  const shape: Record<string, { keyframes?: { time: number; value: JsonValue }[] }> = {}
  for (const [path, property] of Object.entries(objects)) {
    if (!isJsonObject(property)) {
      continue
    }
    const keyframes = property.keyframes
    if (!Array.isArray(keyframes)) {
      continue
    }
    const frames: { time: number; value: JsonValue }[] = []
    for (const frame of keyframes) {
      if (isJsonObject(frame) && typeof frame.time === 'number') {
        frames.push({ time: frame.time, value: frame.value })
      }
    }
    shape[path] = { keyframes: frames }
  }
  return positionNodeTimes(shape)
}
