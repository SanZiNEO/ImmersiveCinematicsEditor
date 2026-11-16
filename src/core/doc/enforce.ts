/**
 * 提交期的结构不变式（03-05 `commit` 第 4 步）。
 *
 * 顺序固定：
 * 1. 每条轨道的片段按 `start_time` 稳定排序；
 * 2. 转场对齐：同轨相邻片段，前一片段 `transition=morph` 且 `transition_duration > 0` 时，
 *    后一片段起点 = `prev.start + prev.duration - t/2`（不低于 `prev.start`）；
 * 3. 引用完整性：所有片段 / 规则 / 绑定引用必须指向存在的目标；断裂 → 抛错，**不静默删条目**。
 *
 * 不做的事：不写总时长、不补默认值、不烘焙缓动、不裁剪片段。
 */
import type { CatalogIndex } from '../schema/index.ts'
import { collectClipReferences, eachClip } from './identity.ts'
import { isJsonObject } from './json.ts'
import type { JsonObject, ScriptDoc } from './types.ts'

/** 引用完整性失败（`commit` 捕获并回滚）。 */
export class StructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructureError'
  }
}

/** 片段起始秒（缺失按 0，与解析器的默认放置一致）。 */
function startOf(clip: JsonObject): number {
  return typeof clip.start_time === 'number' && Number.isFinite(clip.start_time) ? clip.start_time : 0
}

/** 片段时长（缺失按 0）。 */
function durationOf(clip: JsonObject): number {
  return typeof clip.duration === 'number' && Number.isFinite(clip.duration) ? clip.duration : 0
}

/** 读一个 value-only 对象的数值（`objects.<path>.value`）。 */
function valueOf(clip: JsonObject, path: string): unknown {
  const objects = clip.objects
  if (!isJsonObject(objects)) {
    return undefined
  }
  const property = objects[path]
  return isJsonObject(property) ? property.value : undefined
}

/** 转场对齐（B 模型）：只改内联片段，只在前一片段声明 morph 且过渡时长 > 0 时生效。 */
function alignTransitions(tracks: readonly unknown[]): void {
  for (const track of tracks) {
    if (!isJsonObject(track) || !Array.isArray(track.clips)) {
      continue
    }
    const clips = track.clips.filter(isJsonObject)
    for (let index = 0; index < clips.length - 1; index += 1) {
      const previous = clips[index]
      const next = clips[index + 1]
      if (valueOf(previous, 'transition') !== 'morph') {
        continue
      }
      const transition = valueOf(previous, 'transition_duration')
      if (typeof transition !== 'number' || !Number.isFinite(transition) || transition <= 0) {
        continue
      }
      const start = startOf(previous)
      const expected = Math.max(start, start + durationOf(previous) - transition / 2)
      next.start_time = expected
    }
  }
}

/**
 * 执行结构不变式。
 *
 * @throws StructureError 引用断裂（片段 / 规则 / 绑定 / 调度）
 */
export function enforceStructure(doc: ScriptDoc, catalog: CatalogIndex): void {
  const tracks = doc.timeline.tracks
  if (Array.isArray(tracks)) {
    for (const track of tracks) {
      if (!isJsonObject(track) || !Array.isArray(track.clips)) {
        continue
      }
      const clips = track.clips.filter(isJsonObject)
      clips.sort((left, right) => startOf(left) - startOf(right))
      for (let index = 0; index < clips.length; index += 1) {
        track.clips[index] = clips[index]
      }
    }
    alignTransitions(tracks)
  }

  const clipIds = new Set<string>()
  eachClip(doc, (clip) => {
    if (typeof clip.id === 'string' && clip.id.length > 0) {
      clipIds.add(clip.id)
    }
  })

  const broken: string[] = []
  for (const reference of collectClipReferences(doc)) {
    if (!clipIds.has(reference.clipId)) {
      broken.push(`${reference.jsonPath} → ${reference.clipId}（${reference.label}）`)
    }
  }

  const rules = doc.root.rules
  const ruleIds = new Set<string>()
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (isJsonObject(rule) && typeof rule.id === 'string' && rule.id.length > 0) {
        ruleIds.add(rule.id)
      }
    }
  }
  const bindingIds = new Set<string>()
  const bindings = doc.root.rule_bindings
  if (Array.isArray(bindings)) {
    for (const binding of bindings) {
      if (isJsonObject(binding) && typeof binding.id === 'string' && binding.id.length > 0) {
        bindingIds.add(binding.id)
      }
    }
  }
  if (Array.isArray(bindings)) {
    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index]
      if (!isJsonObject(binding)) {
        continue
      }
      if (typeof binding.rule === 'string' && !ruleIds.has(binding.rule)) {
        broken.push(`rule_bindings[${index}].rule → ${binding.rule}`)
      }
      const schedule = binding.schedule
      if (isJsonObject(schedule) && typeof schedule.binding === 'string'
        && !bindingIds.has(schedule.binding)) {
        broken.push(`rule_bindings[${index}].schedule.binding → ${schedule.binding}`)
      }
    }
  }

  if (broken.length > 0) {
    throw new StructureError(`引用断裂，已回滚：${broken.join('；')}`)
  }

  // 目录只读校验：轨道类型必须被目录认识（第三方 `modid:` 只读，不阻断）。
  void catalog
}
