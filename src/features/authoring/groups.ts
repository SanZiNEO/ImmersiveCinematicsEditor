/**
 * 07-01 编辑组合（AuthoringGroup）：配置组 + 自定义组 + 四个组合动作的计划。
 *
 * 组合只活在编辑器内存里；写盘仍是每个叶子自己的 `{time,value}` 关键帧。
 * 所有动作产出 `object.editKeyframes` 的原子操作列表，由 UI 组一个 `compound` 提交。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { FieldEntry } from '../../core/schema/types.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { animatable } from '../effects/valueControls.ts'
import config from '../../config/authoring-groups.json' with { type: 'json' }

/** 组合 id 规则（07-01）。 */
export const GROUP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{1,63}$/

export type GroupSource = 'config' | 'custom'

export interface AuthoringGroup {
  id: string
  name: string
  track: string
  members: string[]
  source: GroupSource
  builtin: boolean
}

export interface GroupConfigError {
  path: string
  message: string
}

export interface GroupRegistry {
  groups: AuthoringGroup[]
  errors: GroupConfigError[]
}

/** 位置三轴（补齐 step 对齐用）。 */
export const POSITION_AXES = ['position.x', 'position.y', 'position.z'] as const

/** `position_space=base` 时改变参考系的字段（07-02 / ObjectValidator.BASE_SWITCH_FIELDS）。 */
export const BASE_SWITCH_FIELDS: readonly string[] = [
  'facing_target',
  'facing_target_freeze',
  'facing_entity',
  'look_at_freeze',
  'yaw_base_from_freeze',
  'yaw_base_to_freeze',
]

/** 参考系切换字段（`SPACE_SWITCH_FIELDS`）。 */
export const SPACE_SWITCH_FIELDS: readonly string[] = [
  'position_mode',
  'position_space',
  'position_origin',
  'position_origin_freeze',
  'facing_source',
]

/** 规则字段并集（含 base 扩展）。 */
export const STEP_FIELDS: readonly string[] = [...SPACE_SWITCH_FIELDS, ...BASE_SWITCH_FIELDS]

/** 内置默认组（配置读取失败时的兜底；配置正常时以配置为准）。 */
const FALLBACK_GROUPS: AuthoringGroup[] = [
  {
    id: 'position.xyz',
    name: '位置 XYZ',
    track: 'CAMERA',
    members: ['position.x', 'position.y', 'position.z'],
    source: 'config',
    builtin: true,
  },
  {
    id: 'orientation.ypr',
    name: '朝向 YPR',
    track: 'CAMERA',
    members: ['yaw', 'pitch', 'roll'],
    source: 'config',
    builtin: true,
  },
]

/** 读取配置组；未知成员报错并跳过整组（不阻塞其他组）。 */
export function loadAuthoringGroups(catalog: CatalogIndex): GroupRegistry {
  const groups: AuthoringGroup[] = []
  const errors: GroupConfigError[] = []
  const raw = config as unknown as JsonValue
  if (!isJsonObject(raw) || !Array.isArray(raw.groups)) {
    errors.push({ path: 'authoring-groups.groups', message: '配置缺少 groups 数组' })
    return { groups: [...FALLBACK_GROUPS], errors }
  }
  for (let index = 0; index < raw.groups.length; index += 1) {
    const item = raw.groups[index]
    const path = `groups[${index}]`
    if (!isJsonObject(item)) {
      errors.push({ path, message: '需要对象 {id, name, track?, members[]}' })
      continue
    }
    const id = item.id
    const name = item.name
    const track = typeof item.track === 'string' ? item.track : 'CAMERA'
    const members = item.members
    if (typeof id !== 'string' || !GROUP_ID_PATTERN.test(id)) {
      errors.push({ path: `${path}.id`, message: `必须匹配 ${GROUP_ID_PATTERN.source}，实际: ${String(id)}` })
      continue
    }
    if (typeof name !== 'string' || name.length === 0) {
      errors.push({ path: `${path}.name`, message: '需要非空显示名' })
      continue
    }
    if (!Array.isArray(members) || members.length === 0) {
      errors.push({ path: `${path}.members`, message: '需要非空成员数组（字段路径）' })
      continue
    }
    const accepted: string[] = []
    let bad = false
    for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
      const member = members[memberIndex]
      if (typeof member !== 'string' || member.length === 0) {
        errors.push({ path: `${path}.members[${memberIndex}]`, message: '需要非空字段路径' })
        bad = true
        continue
      }
      if (catalog.objectDef(track, member) === undefined) {
        errors.push({
          path: `${path}.members[${memberIndex}]`,
          message: `未知成员 ${member}（轨道 ${track} 没有这个叶子）`,
        })
        bad = true
        continue
      }
      accepted.push(member)
    }
    if (bad) {
      errors.push({ path, message: `组 ${id} 含未知成员，已整组跳过` })
      continue
    }
    if (groups.some((group) => group.id === id)) {
      errors.push({ path: `${path}.id`, message: `重复组合 id: ${id}` })
      continue
    }
    groups.push({ id, name, track, members: accepted, source: 'config', builtin: true })
  }
  return { groups: groups.length === 0 ? [...FALLBACK_GROUPS] : groups, errors }
}

/** 读自定义组（`doc.authoring.groups`）；非法项忽略。 */
export function customGroups(doc: ScriptDoc): AuthoringGroup[] {
  const raw = doc.authoring.groups
  if (!Array.isArray(raw)) {
    return []
  }
  const groups: AuthoringGroup[] = []
  for (const item of raw) {
    if (!isJsonObject(item)) {
      continue
    }
    const id = item.id
    const name = item.name
    const members = item.members
    const track = typeof item.track === 'string' ? item.track : 'CAMERA'
    if (typeof id !== 'string' || !GROUP_ID_PATTERN.test(id) || typeof name !== 'string') {
      continue
    }
    if (!Array.isArray(members) || members.length === 0) {
      continue
    }
    const accepted = members.filter((member): member is string => typeof member === 'string' && member.length > 0)
    if (accepted.length === 0) {
      continue
    }
    groups.push({ id, name, track, members: accepted, source: 'custom', builtin: false })
  }
  return groups
}

/** 合并注册表。 */
export function groupRegistry(doc: ScriptDoc, catalog: CatalogIndex): GroupRegistry {
  const base = loadAuthoringGroups(catalog)
  return {
    groups: [...base.groups, ...customGroups(doc)],
    errors: base.errors,
  }
}

/** 新建自定义组 id：`custom_<n>`，全局最大 + 1。 */
export function nextCustomGroupId(doc: ScriptDoc): string {
  let maximum = 0
  for (const group of customGroups(doc)) {
    const match = /^custom_(\d+)$/.exec(group.id)
    if (match !== null) {
      maximum = Math.max(maximum, Number(match[1]))
    }
  }
  return `custom_${maximum + 1}`
}

/** 写自定义组（不动撤销栈；调用方先 `commit` 文档改动再改这里）。 */
export function writeCustomGroups(doc: ScriptDoc, groups: readonly AuthoringGroup[]): void {
  doc.authoring.groups = groups.map((group) => ({
    id: group.id,
    name: group.name,
    track: group.track,
    members: [...group.members],
  }))
}

/** 叶子 → 组合（可多个）。 */
export function groupsOfLeaf(registry: GroupRegistry, path: string): AuthoringGroup[] {
  return registry.groups.filter((group) => group.members.includes(path))
}

// ── 动作计划 ───────────────────────────────────────────────────────────────

export type GroupAction = 'create' | 'capture' | 'set-values' | 'remove'

export interface GroupMemberPlan {
  path: string
  label: string
  value: string
  frameCount: number
  hasFrame: boolean
  /** `animated` / `static` / `event` / `requires-blocked` / `missing`。 */
  state: 'animated' | 'static' | 'event' | 'requires-blocked' | 'missing'
  /** 该叶子在属性面板还是效果面板（06 归属）。 */
  panel: 'properties' | 'effects'
  /** 计划动作：建立 / 改值 / 删除 / 跳过。 */
  action: 'add' | 'set' | 'remove' | 'skip'
}

export interface GroupActionPlan {
  action: GroupAction
  members: GroupMemberPlan[]
  ops: GroupEditOperation[]
  counts: { create: number; existing: number; skip: number }
  /** step 字段触发但三轴缺帧时列出缺失轴；非空时 UI 必须让作者选「补齐 / 取消」。 */
  missingAxes: string[]
  warnings: string[]
}

export interface GroupEditOperation {
  op: 'add' | 'set' | 'remove'
  path: string
  time: number
  value?: JsonValue
}

/** 计算组合动作计划；`values` 仅 `set-values` 使用（缺项按当前值）。 */
export function planGroupAction(input: {
  doc: ScriptDoc
  catalog: CatalogIndex
  clip: JsonObject
  trackType: string
  group: AuthoringGroup
  time: number
  action: GroupAction
  values?: Record<string, JsonValue>
  /** step 字段且三轴缺帧时，是否补齐三轴（UI 二选一的第二个分支）。 */
  fillAxes?: boolean
}): GroupActionPlan {
  const { doc, catalog, clip, trackType, group, time, action, values, fillAxes } = input
  const members: GroupMemberPlan[] = []
  const ops: GroupEditOperation[] = []
  const warnings: string[] = []
  let create = 0
  let existing = 0
  let skip = 0
  const base = effectiveToken(clip, 'position_space', time) === 'base'
  const stepPaths = group.members.filter((path) => STEP_FIELDS.includes(path)
    && (!BASE_SWITCH_FIELDS.includes(path) || base))
  const missingAxes = stepPaths.length > 0 && time > 0
    ? POSITION_AXES.filter((axis) => !hasFrameAt(clip, axis, time))
    : []
  if (stepPaths.length > 0 && time > 0 && missingAxes.length > 0 && fillAxes !== true) {
    warnings.push(
      `组合含 step 字段（${stepPaths.join(', ')}）在 t=${time} 切换，但位置三轴缺少 ${missingAxes.join('/')} 的同刻帧；需补齐三轴后再提交`,
    )
  } else if (stepPaths.length > 0 && time > 0 && missingAxes.length > 0 && fillAxes === true) {
    for (const axis of missingAxes) {
      const def = catalog.objectDef(trackType, axis)
      const value = effectiveValue(clip, axis, time, def)
      ops.push({ op: 'add', path: axis, time, value })
      create += 1
    }
  }
  const allowed = stepPaths.length === 0 || time <= 0 || missingAxes.length === 0 || fillAxes === true

  for (const path of group.members) {
    const def = catalog.objectDef(trackType, path)
    if (def === undefined) {
      members.push(memberRow(path, 'missing', 'properties', 0, false, 'skip'))
      skip += 1
      continue
    }
    const panel = panelOf(def)
    const frames = framesOf(clip, path)
    const hasFrame = frames.some((frame) => frame.time === time)
    const event = def.mode === 'event'
    const isAnimatable = animatable(def)
    const requiresOk = requirementsSatisfied(clip, def.requires, time)
    let state: GroupMemberPlan['state'] = 'animated'
    if (!isAnimatable) {
      state = 'static'
    } else if (event) {
      state = 'event'
    } else if (!requiresOk) {
      state = 'requires-blocked'
    }
    const valueText = formatValue(effectiveValue(clip, path, time, def))
    const rowBase = {
      path,
      label: def.key,
      value: valueText,
      frameCount: frames.length,
      hasFrame,
      panel,
    }
    if (state !== 'animated') {
      const actionName = action === 'remove' && event ? 'skip' : 'skip'
      members.push({ ...rowBase, state, action: actionName })
      skip += 1
      continue
    }
    if (!allowed) {
      members.push({ ...rowBase, state, action: 'skip' })
      skip += 1
      continue
    }
    if (action === 'create' || action === 'capture') {
      if (hasFrame) {
        members.push({ ...rowBase, state, action: 'skip' })
        existing += 1
        continue
      }
      const seed = effectiveValue(clip, path, time, def)
      ops.push({ op: 'add', path, time, value: seed })
      members.push({ ...rowBase, state, action: 'add' })
      create += 1
      continue
    }
    if (action === 'set-values') {
      const provided = values?.[path]
      const value = provided === undefined ? effectiveValue(clip, path, time, def) : provided
      ops.push({ op: hasFrame ? 'set' : 'add', path, time, value })
      members.push({ ...rowBase, state, action: hasFrame ? 'set' : 'add' })
      if (hasFrame) {
        existing += 1
      } else {
        create += 1
      }
      continue
    }
    if (action === 'remove') {
      if (!hasFrame) {
        members.push({ ...rowBase, state, action: 'skip' })
        skip += 1
        continue
      }
      ops.push({ op: 'remove', path, time })
      members.push({ ...rowBase, state, action: 'remove' })
      existing += 1
    }
  }
  return { action, members, ops, counts: { create, existing, skip }, missingAxes, warnings }
}

/** 当前有效值：同刻帧 > 插值 > 静态 value > 目录默认。 */
export function effectiveValue(
  clip: JsonObject,
  path: string,
  time: number,
  def: FieldEntry | undefined,
): JsonValue {
  const raw = isJsonObject(clip.objects) ? clip.objects[path] : undefined
  if (isJsonObject(raw)) {
    const frames = framesOf(clip, path)
    const exact = frames.find((frame) => frame.time === time)
    if (exact !== undefined) {
      return exact.value
    }
    if (frames.length >= 2) {
      const sorted = [...frames].sort((left, right) => left.time - right.time)
      if (time > sorted[0].time && time < sorted[sorted.length - 1].time) {
        for (let index = 0; index < sorted.length - 1; index += 1) {
          const left = sorted[index]
          const right = sorted[index + 1]
          if (time > left.time && time < right.time && typeof left.value === 'number' && typeof right.value === 'number') {
            const fraction = (time - left.time) / (right.time - left.time)
            return left.value + (right.value - left.value) * fraction
          }
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'value')) {
      return raw.value as JsonValue
    }
  }
  return (def?.default ?? null) as JsonValue
}

/** 有效 token（requires 比较 / 枚举读取）。 */
export function effectiveToken(clip: JsonObject, path: string, time: number): string {
  const value = effectiveValue(clip, path, time, undefined)
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

/** `requires` 表达式（`path=value` / `path!=value`）。 */
export function requirementsSatisfied(clip: JsonObject, expression: string | undefined, time: number): boolean {
  if (expression === undefined || expression.length === 0) {
    return true
  }
  const text = expression.trim()
  const notEquals = text.indexOf('!=')
  if (notEquals > 0) {
    const path = text.slice(0, notEquals).trim()
    const literal = text.slice(notEquals + 2).trim()
    return effectiveToken(clip, path, time) !== literal
  }
  const equals = text.indexOf('=')
  if (equals > 0) {
    const path = text.slice(0, equals).trim()
    const literal = text.slice(equals + 1).trim()
    return effectiveToken(clip, path, time) === literal
  }
  return true
}

/** 属性 / 效果归属（06 membership：`mode` 为 value/struct 进属性，animated 进效果）。 */
export function panelOf(def: FieldEntry): 'properties' | 'effects' {
  return animatable(def) ? 'effects' : 'properties'
}

function memberRow(
  path: string,
  state: GroupMemberPlan['state'],
  panel: 'properties' | 'effects',
  frameCount: number,
  hasFrame: boolean,
  action: GroupMemberPlan['action'],
): GroupMemberPlan {
  return { path, label: path, value: '', frameCount, hasFrame, state, panel, action }
}

function framesOf(clip: JsonObject, path: string): Array<{ time: number; value: JsonValue }> {
  const raw = isJsonObject(clip.objects) ? clip.objects[path] : undefined
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return []
  }
  const frames: Array<{ time: number; value: JsonValue }> = []
  for (const item of raw.keyframes) {
    if (isJsonObject(item) && typeof item.time === 'number') {
      frames.push({ time: item.time, value: (item.value ?? null) as JsonValue })
    }
  }
  return frames
}

function hasFrameAt(clip: JsonObject, path: string, time: number): boolean {
  return framesOf(clip, path).some((frame) => frame.time === time)
}

function formatValue(value: JsonValue): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
