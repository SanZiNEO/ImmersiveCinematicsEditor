/**
 * 07-01 组合弹层模型（纯逻辑，不触 DOM / 不引 Vue）。
 *
 * 职责：
 * - 组匹配：按组内行路径与注册表内置组的最长成员交集匹配，无匹配建议自定义组；
 * - 四动作计划包装：复用 core `planGroupAction`，输出「将创建 / 已有 / 跳过」计数；
 * - step 缺三轴提示与补齐 ops（复用 positionForm 的 `switchMissingAxes` / `fillAxesOps`）；
 * - 自定义组 CRUD 计划（新建 / 改名 / 增删成员 / 删除；内置组只能临时隐藏）；
 * - 计划 → 一次 `compound` 提交（一次撤销全回退）。
 *
 * 本模块不 commit、不读会话；命令由父面板统一提交。
 */
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../../core/doc/types.ts'
import type { PropertyRow } from '../../effects/types.ts'
import {
  GROUP_ID_PATTERN,
  planGroupAction,
  effectiveValue,
  type AuthoringGroup,
  type GroupAction,
  type GroupActionPlan,
  type GroupRegistry,
} from '../groups.ts'
import { switchMissingAxes, fillAxesOps } from '../positionForm.ts'

// ── 组匹配 ──────────────────────────────────────────────────────────────────

/** 匹配结果。 */
export interface GroupMatch {
  /** 命中的注册表组；`null` = 无交集，建议新建自定义组。 */
  group: AuthoringGroup | null
  /** 交集成员数（0 = 无匹配）。 */
  intersection: number
  /** 交集 > 0 的候选（按交集降序，同分时保持注册表顺序）。 */
  candidates: AuthoringGroup[]
}

/**
 * 给定组键与一组行路径，按与注册表各组的最长成员交集匹配；同分时组键命中优先。
 *
 * 交集为 0 时返回 `group: null`，调用方据此建议「新建自定义组」。
 */
export function matchAuthoringGroup(
  rowPaths: readonly string[],
  registry: GroupRegistry,
  groupKey?: string,
): GroupMatch {
  const paths = new Set(rowPaths)
  const scored = registry.groups
    .map((group) => ({
      group,
      intersection: group.members.filter((member) => paths.has(member)).length,
      keyHit: groupKey !== undefined && (group.id === groupKey || group.name === groupKey),
    }))
    .filter((item) => item.intersection > 0)
    .sort((left, right) => right.intersection - left.intersection
      || Number(right.keyHit) - Number(left.keyHit))
  if (scored.length === 0) {
    return { group: null, intersection: 0, candidates: [] }
  }
  const [best] = scored
  return {
    group: best.group,
    intersection: best.intersection,
    candidates: [...scored.map((item) => item.group)],
  }
}

/** 无匹配时给自定义组草稿（成员 = 当前组内行路径；轨道由调用方补）。 */
export function suggestCustomDraft(
  groupKey: string,
  rowPaths: readonly string[],
  track: string,
): { name: string; track: string; members: string[] } {
  return {
    name: groupKey.length > 0 ? groupKey : '自定义组合',
    track,
    members: [...rowPaths],
  }
}

// ── 四动作计划 ──────────────────────────────────────────────────────────────

/** 弹层计划入参（`doc` 保留兼容；核心计划只读 clip 对象面，不读文档树）。 */
export interface PopoverPlanInput {
  doc?: ScriptDoc
  catalog: CatalogIndex
  /** 当前片段对象面（只读；计划读取当前有效值用）。 */
  clip: JsonObject
  trackType: string
  group: AuthoringGroup
  time: number
  action: GroupAction
  /** `set-values` 的待写入值（缺项按当前值填充）。 */
  values?: Record<string, JsonValue>
  /** step 缺三轴时是否补齐（UI 二选一的第二个分支）。 */
  fillAxes?: boolean
}

/** 包装 core 计划；不做二次判定，保证计数与 core 口径一致。 */
export function planGroupPopover(input: PopoverPlanInput): GroupActionPlan {
  return planGroupAction({
    doc: (input.doc ?? ({} as ScriptDoc)),
    catalog: input.catalog,
    clip: input.clip,
    trackType: input.trackType,
    group: input.group,
    time: input.time,
    action: input.action,
    ...(input.values === undefined ? {} : { values: input.values }),
    ...(input.fillAxes === undefined ? {} : { fillAxes: input.fillAxes }),
  })
}

/** 计划的成员行（供弹层表格直接渲染；`GroupMemberPlan` 形状透传）。 */
export type PopoverMember = GroupActionPlan['members'][number]

/**
 * 把动作计划转成一条 `compound` 命令（一次提交、一次撤销全回退）。
 *
 * 计划无 ops（全部跳过 / 静态 / 事件 / requires 阻断）时返回 `null`，调用方不产生空撤销项。
 */
export function planToCompoundCommand(clipKey: string, plan: GroupActionPlan): DocCommand | null {
  if (plan.ops.length === 0) {
    return null
  }
  const ops = plan.ops.map((op) =>
    op.op === 'remove'
      ? { op: 'remove' as const, path: op.path, time: op.time }
      : { op: op.op as 'add' | 'set', path: op.path, time: op.time, value: op.value ?? null },
  )
  return {
    kind: 'compound',
    commands: [
      { kind: 'object.editKeyframes', clipKey, ops },
    ],
  }
}

// ── step 缺三轴补齐 ─────────────────────────────────────────────────────────

/** step 切换对齐检查结果。 */
export interface StepFillPlan {
  /** 缺轴且未选择补齐 → UI 必须拦住提交。 */
  blocked: boolean
  /** 缺失轴路径（`position.x/y/z` 子集）。 */
  missingAxes: string[]
  /** 补齐 ops（缺轴用当前有效值各建一帧）。 */
  fillOps: Array<{ op: 'add'; path: string; time: number; value: JsonValue }>
  warning: string | null
}

/**
 * 检查 step 字段在 `time` 的切换对齐；返回缺失轴与补齐 ops。
 *
 * `time <= 0` 不要求三轴；`spaceAtTime` 为当前参考系（`world` / `base`）。
 */
export function planStepFill(input: {
  clip: JsonObject
  catalog: CatalogIndex
  trackType: string
  changedPath: string
  time: number
  spaceAtTime: string
}): StepFillPlan {
  const missingAxes = switchMissingAxes(input.clip, input.changedPath, input.time, input.spaceAtTime)
  if (missingAxes.length === 0) {
    return { blocked: false, missingAxes: [], fillOps: [], warning: null }
  }
  const fillOps = fillAxesOps(input.clip, input.time, (path) => {
    const def = input.catalog.objectDef(input.trackType, path)
    return effectiveValue(input.clip, path, input.time, def)
  })
  return {
    blocked: true,
    missingAxes,
    fillOps,
    warning: `组合含 step 字段在 t=${input.time} 切换，但位置三轴缺少 ${missingAxes.join(' / ')} 的同刻帧；需补齐三轴后再提交`,
  }
}

// ── 自定义组 CRUD 计划（纯数据变换；不写文档、不进撤销栈） ────────────────────

/** 组是否可删除：内置 / 配置组只能临时隐藏，不能删。 */
export function canDeleteGroup(group: AuthoringGroup): boolean {
  return !group.builtin && group.source === 'custom'
}

/** 基于现有组列表生成下一个 `custom_<n>` id（全局最大 + 1）。 */
export function nextCustomGroupId(groups: readonly AuthoringGroup[]): string {
  let maximum = 0
  for (const group of groups) {
    const match = /^custom_(\d+)$/.exec(group.id)
    if (match !== null) {
      maximum = Math.max(maximum, Number(match[1]))
    }
  }
  return `custom_${maximum + 1}`
}

/** 成员路径是否都在目录里存在（跨轨道 / 未知路径本地拒绝）。 */
export function validateMembers(
  catalog: CatalogIndex,
  trackType: string,
  members: readonly string[],
): string | null {
  for (const member of members) {
    if (typeof member !== 'string' || member.length === 0) {
      return '成员需要非空字段路径'
    }
    if (catalog.objectDef(trackType, member) === undefined) {
      return `未知成员 ${member}（轨道 ${trackType} 没有这个叶子）`
    }
  }
  return null
}

export interface GroupDraft {
  name: string
  track: string
  members: string[]
}

/** 新建自定义组：返回新组与新列表；非法输入返回 `error`，不改原列表。 */
export function createCustomGroup(
  groups: readonly AuthoringGroup[],
  draft: GroupDraft,
  catalog: CatalogIndex,
): { groups: AuthoringGroup[]; group: AuthoringGroup } | { groups: AuthoringGroup[]; error: string } {
  const name = draft.name.trim()
  if (name.length === 0) {
    return { groups: [...groups], error: '组合显示名需要非空' }
  }
  const track = draft.track || 'CAMERA'
  const memberError = validateMembers(catalog, track, draft.members)
  if (memberError !== null) {
    return { groups: [...groups], error: memberError }
  }
  const id = nextCustomGroupId(groups)
  const group: AuthoringGroup = {
    id,
    name,
    track,
    members: [...draft.members],
    source: 'custom',
    builtin: false,
  }
  return { groups: [...groups, group], group }
}

/** 改名：内置组拒绝改名（返回 `null`）。 */
export function renameGroup(
  groups: readonly AuthoringGroup[],
  id: string,
  name: string,
): AuthoringGroup[] | null {
  const target = groups.find((group) => group.id === id)
  if (target === undefined || !canDeleteGroup(target)) {
    return null
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return null
  }
  return groups.map((group) => (group.id === id ? { ...group, name: trimmed } : group))
}

/** 增成员：成员必须在目录存在；组不可变，返回新列表。 */
export function addGroupMembers(
  groups: readonly AuthoringGroup[],
  id: string,
  members: readonly string[],
  catalog: CatalogIndex,
): { groups: AuthoringGroup[]; error?: string } {
  const target = groups.find((group) => group.id === id)
  if (target === undefined) {
    return { groups: [...groups], error: '组合不存在' }
  }
  const memberError = validateMembers(catalog, target.track, members)
  if (memberError !== null) {
    return { groups: [...groups], error: memberError }
  }
  const merged = [...target.members]
  for (const member of members) {
    if (!merged.includes(member)) {
      merged.push(member)
    }
  }
  return { groups: groups.map((group) => (group.id === id ? { ...group, members: merged } : group)) }
}

/** 删成员：拒绝把组删空；内置组同样允许临时减成员吗？——内置组成员来自配置，不允许编辑，返回 `null`。 */
export function removeGroupMembers(
  groups: readonly AuthoringGroup[],
  id: string,
  members: readonly string[],
): AuthoringGroup[] | null {
  const target = groups.find((group) => group.id === id)
  if (target === undefined || !canDeleteGroup(target)) {
    return null
  }
  const nextMembers = target.members.filter((member) => !members.includes(member))
  if (nextMembers.length === 0) {
    return null
  }
  return groups.map((group) => (group.id === id ? { ...group, members: nextMembers } : group))
}

/** 删除组：内置组返回 `null`（只能临时隐藏，不能删）。 */
export function deleteGroup(groups: readonly AuthoringGroup[], id: string): AuthoringGroup[] | null {
  const target = groups.find((group) => group.id === id)
  if (target === undefined || !canDeleteGroup(target)) {
    return null
  }
  return groups.filter((group) => group.id !== id)
}

/** 自定义组序列化形状（交父面板 `setAuthoringGroups`；内置组不进此列表）。 */
export function customGroupsToJson(groups: readonly AuthoringGroup[]): JsonObject[] {
  return groups
    .filter((group) => !group.builtin)
    .map((group) => ({
      id: group.id,
      name: group.name,
      track: group.track,
      members: [...group.members],
      source: 'custom',
      builtin: false,
    }))
}

/** 行集合 → 路径列表（组匹配 / 增成员候选用）。 */
export function rowPaths(rows: readonly PropertyRow[]): string[] {
  return rows.map((row) => row.path)
}

/** id 规则（与 core `GROUP_ID_PATTERN` 同一口径，供本地输入校验）。 */
export { GROUP_ID_PATTERN }
