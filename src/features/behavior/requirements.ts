/**
 * 11 轮触发器域前置条件（`requires`）纯函数：两形态解析、解析状态、依赖边、成环标记。
 *
 * 口径（与主模组 Java 对齐）：
 * - 字符串条目 = `script_played` 简写，字符串即目标脚本 id；
 * - 对象条目必须有非空 string `type`；内置 `script_played` / `script_started` /
 *   `script_completed` 用同级 `script` 字段指向目标脚本；
 * - 三种内置均按「玩家 + 脚本」事实账本判定，锁存（事实一旦存在不回退）；
 * - 解析保留原顺序与原形态；自定义类型只读，不硬判存在性；
 * - 依赖边：内置 / 字符串各一条潜在边；自定义无 id 不建边；同目标重复只画一条；
 *   缺失画悬空桩；自引用不画完整边；成环节点标「环内前置」。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { isJsonObject, isJsonArray } from '../../core/doc/json.ts'
import type { BehaviorProblem } from './shared.ts'
import { isBuiltinRequirement } from '../../core/schema/catalog/behaviorTriggers.ts'
import type {
  ConditionValidationContext,
  RequirementEntry,
  TriggerNode,
} from './trigger.types.ts'

// ── 解析状态 ────────────────────────────────────────────────────────────────

/** 前置条目解析状态。 */
export type RequirementStatus =
  | 'resolved'
  | 'missing'
  | 'self_reference'
  | 'duplicate_id_unresolved'
  | 'custom'
  | 'malformed'

/** 前置校验上下文：在条件树上下文之上追加「重复 id 无法确定」的脚本 id 集合。 */
export interface RequirementContext extends ConditionValidationContext {
  /** 文档内重复出现的脚本 id（解析到哪一份无法确定）。 */
  ambiguousScriptIds?: readonly string[]
  /** 按触发器节点下标提供所属脚本 id（跨脚本成环检测用）；缺省回落 `selfScriptId`。 */
  scriptIds?: readonly string[]
}

/** 一条前置条目的解析结果。 */
export interface ResolvedRequirement {
  entry: RequirementEntry
  status: RequirementStatus
  /** 目标脚本 id；自定义无 id / 形态非法时为 `undefined`。 */
  targetScriptId: string | undefined
  /** 面向面板的状态说明文案。 */
  message: string
}

// ── 条目解析（保留原顺序与原形态）──────────────────────────────────────────────

function isTriggerNode(node: TriggerNode | JsonObject): node is TriggerNode {
  return typeof node === 'object' && node !== null && 'raw' in node
}

/** 从触发器原始声明读取 `requires` 条目；非数组 / 非法元素落成 `malformed` 条目。 */
export function requirementEntries(node: TriggerNode | JsonObject): RequirementEntry[] {
  const raw: JsonObject = isTriggerNode(node) ? node.raw : node
  const requires = raw.requires
  if (!isJsonArray(requires)) return []
  const entries: RequirementEntry[] = []
  for (const item of requires) {
    if (typeof item === 'string') {
      entries.push({ kind: 'string', raw: item, script: item })
    } else if (isJsonObject(item)) {
      const rawType = item.type
      const type = typeof rawType === 'string' ? rawType : ''
      const data: JsonObject = {}
      for (const key of Object.keys(item)) {
        if (key !== 'type') data[key] = item[key]
      }
      entries.push({ kind: 'object', raw: item, type, data })
    } else {
      entries.push({ kind: 'malformed', raw: item })
    }
  }
  return entries
}

// ── 状态判定 ────────────────────────────────────────────────────────────────

function resolveTarget(
  target: string,
  ctx: RequirementContext,
): Pick<ResolvedRequirement, 'status' | 'message'> {
  if (ctx.selfScriptId !== undefined && target === ctx.selfScriptId) {
    return { status: 'self_reference', message: '自引用自身脚本，可能永不解锁或自我循环' }
  }
  if (ctx.ambiguousScriptIds !== undefined && ctx.ambiguousScriptIds.includes(target)) {
    return { status: 'duplicate_id_unresolved', message: '脚本 id 重复，无法确定指向哪一份' }
  }
  if (ctx.knownScriptIds.length > 0 && !ctx.knownScriptIds.includes(target)) {
    return { status: 'missing', message: '指向不存在的脚本，该前置条件永不满足' }
  }
  return { status: 'resolved', message: '已解析' }
}

/** 解析一条前置条目：状态 + 目标脚本 + 说明文案。 */
export function resolveRequirement(entry: RequirementEntry, ctx: RequirementContext): ResolvedRequirement {
  if (entry.kind === 'malformed') {
    return { entry, status: 'malformed', targetScriptId: undefined, message: '前置条目必须是字符串脚本 id 或对象型前置条件' }
  }

  if (entry.kind === 'string') {
    if (entry.script.length === 0) {
      return { entry, status: 'malformed', targetScriptId: undefined, message: '前置脚本 id 不能为空' }
    }
    const resolved = resolveTarget(entry.script, ctx)
    return { entry, ...resolved, targetScriptId: entry.script }
  }

  const objectEntry: Extract<RequirementEntry, { kind: 'object' }> = entry
  if (objectEntry.type.length === 0) {
    return { entry, status: 'malformed', targetScriptId: undefined, message: '对象型前置条件必须包含非空字符串 type' }
  }

  if (isBuiltinRequirement(objectEntry.type)) {
    const script = objectEntry.data.script
    if (typeof script !== 'string' || script.length === 0) {
      return { entry, status: 'malformed', targetScriptId: undefined, message: `${objectEntry.type} 需要 script 字段（非空字符串）` }
    }
    const resolved = resolveTarget(script, ctx)
    return { entry, ...resolved, targetScriptId: script }
  }

  // 自定义类型：只读，不硬判存在性；带 script 字段才建潜在边。
  const customScript = typeof objectEntry.data.script === 'string' ? objectEntry.data.script : undefined
  return {
    entry,
    status: 'custom',
    targetScriptId: customScript,
    message: `自定义前置条件（${objectEntry.type}），编辑器只读`,
  }
}

// ── 依赖边 ──────────────────────────────────────────────────────────────────

/** 一条前置依赖边（触发器 → 目标脚本）。 */
export interface RequirementEdge {
  /** 归属触发器身份（显式 id 或 `type#下标`）。 */
  triggerIdentity: string
  /** 目标脚本 id；悬空桩 / 自引用 / 自定义无 id 时可能为空。 */
  toScript: string | undefined
  status: RequirementStatus
  /** 同一目标在本触发器 `requires` 里重复出现（只画一条边，依赖页显示重复）。 */
  duplicate: boolean
  entry: RequirementEntry
}

/**
 * 装配一个触发器的前置依赖边。
 * 规则：内置 / 字符串各一条潜在边；自定义无 id 不建边；同目标重复只画一条
 * （保留首条，`duplicate` 置真，依赖页据此显示重复）；缺失画悬空桩；
 * 自引用不画完整边（`toScript` 保留但状态标 self_reference）。
 */
export function requirementEdges(
  node: TriggerNode,
  ctx: RequirementContext,
  ownScriptId?: string,
): RequirementEdge[] {
  const entries = requirementEntries(node)
  const edges: RequirementEdge[] = []
  const byTarget = new Map<string, RequirementEdge>()
  // 自引用按「本触发器所属脚本」判定；跨脚本成环检测时逐节点传入所属脚本 id。
  const localCtx: RequirementContext = ownScriptId !== undefined
    ? { ...ctx, selfScriptId: ownScriptId }
    : ctx

  for (const entry of entries) {
    const resolved = resolveRequirement(entry, localCtx)

    if (resolved.status === 'malformed') continue
    if (resolved.status === 'custom' && resolved.targetScriptId === undefined) continue

    const target = resolved.targetScriptId
    const triggerIdentity = node.raw.id !== undefined ? String(node.raw.id) : `${node.type}#${node.index}`

    if (target !== undefined && byTarget.has(target)) {
      // 同目标重复：只保留首条边，标记重复。
      const existing = byTarget.get(target)!
      existing.duplicate = true
      continue
    }

    const edge: RequirementEdge = {
      triggerIdentity,
      toScript: target,
      status: resolved.status,
      duplicate: false,
      entry,
    }
    if (target !== undefined) byTarget.set(target, edge)
    edges.push(edge)
  }

  return edges
}

// ── 成环标记 ─────────────────────────────────────────────────────────────────

/**
 * 在全部触发器前置边上做脚本级成环检测（Tarjan SCC）。
 * 返回参与任意环的脚本 id 集合（含自环）；面板据此标「环内前置」。
 */
export function requirementCycleMembers(
  nodes: readonly TriggerNode[],
  ctx: RequirementContext,
): Set<string> {
  const adjacency = new Map<string, Set<string>>()
  const known = new Set(ctx.knownScriptIds)

  const addEdge = (from: string, to: string) => {
    let set = adjacency.get(from)
    if (set === undefined) {
      set = new Set()
      adjacency.set(from, set)
    }
    set.add(to)
  }

  for (const node of nodes) {
    const from = ctx.scriptIds?.[node.index] ?? ctx.selfScriptId ?? `${node.type}#${node.index}`
    if (!known.has(from) && ctx.selfScriptId === undefined) continue
    for (const edge of requirementEdges(node, ctx, from)) {
      if (edge.toScript !== undefined && edge.status !== 'self_reference') {
        addEdge(from, edge.toScript)
      }
    }
  }

  // Tarjan 强连通分量
  const indexOf = new Map<string, number>()
  const lowLink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  let counter = 0
  const cycleMembers = new Set<string>()

  const strongConnect = (v: string): void => {
    indexOf.set(v, counter)
    lowLink.set(v, counter)
    counter += 1
    stack.push(v)
    onStack.add(v)

    for (const w of adjacency.get(v) ?? []) {
      if (!indexOf.has(w)) {
        strongConnect(w)
        lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!))
      } else if (onStack.has(w)) {
        lowLink.set(v, Math.min(lowLink.get(v)!, indexOf.get(w)!))
      }
    }

    if (lowLink.get(v) === indexOf.get(v)) {
      const component: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      const isCycle = component.length > 1 || adjacency.get(v)?.has(v) === true
      if (isCycle) {
        for (const member of component) cycleMembers.add(member)
      }
    }
  }

  for (const vertex of adjacency.keys()) {
    if (!indexOf.has(vertex)) strongConnect(vertex)
  }

  return cycleMembers
}

// ── 组合器子项前置校验（与 requires 共用同一套字段规则）─────────────────────────

/**
 * 校验一个前置子项的字段（组合器 `list` 子项与 `requires` 对象条目共用）。
 * 内置类型校验 `script`；自定义类型不硬判。
 */
export function validateRequirementFields(
  type: string,
  data: JsonObject,
  path: string,
  ctx: RequirementContext,
): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  if (type.length === 0) {
    issues.push({ code: 'REQ_TYPE_MISSING', severity: 'error', message: '前置条件 type 不能为空', jsonPath: path })
    return issues
  }
  if (!isBuiltinRequirement(type)) return issues

  const script = data.script
  if (typeof script !== 'string' || script.length === 0) {
    issues.push({ code: 'REQ_SCRIPT_MISSING', severity: 'error', message: `${type} 需要 script 字段（非空字符串）`, jsonPath: `${path}.script` })
    return issues
  }
  if (ctx.selfScriptId !== undefined && script === ctx.selfScriptId) {
    issues.push({ code: 'REQ_SELF_REFERENCE', severity: 'warn', message: `script 自引用自身脚本 '${script}'（可能永不解锁或自我循环）`, jsonPath: `${path}.script` })
  }
  if (ctx.knownScriptIds.length > 0 && !ctx.knownScriptIds.includes(script)) {
    issues.push({ code: 'REQ_SCRIPT_MISSING_TARGET', severity: 'error', message: `script 指向不存在的脚本 '${script}'（该前置条件永不满足）`, jsonPath: `${path}.script` })
  }
  return issues
}

// ── 组合器内前置 vs `requires` 的四差异（面板说明用）─────────────────────────

/**
 * 组合器 `list` 内前置与触发器级 `requires` 的差异清单（11-05 §6）。
 * 面板在两种位置分别展示对应提示，避免作者混用。
 */
export const COMBINATOR_PREREQUISITE_DIFFERENCES: readonly string[] = [
  '位置：组合器内前置写在 `conditions.list` 子项里；`requires` 写在触发器声明的 `requires` 数组里。',
  '形态：组合器子项必须是对象 `{ type, conditions: { script } }`；字符串子项写进 list 视为非法。`requires` 允许字符串简写（= script_played）。',
  '求值：组合器内前置是条件树的一部分，与兄弟子项按 all_of / any 组合；`requires` 是触发器级 AND 门控，任一不满足则整个触发器不触发。',
  '窗口：组合器内前置随组合器的事件窗口语义判定；`requires` 是锁存前置，独立于窗口与单次触发记录。',
]

// ── 供条件树复用的小工具 ──────────────────────────────────────────────────────

/** 读对象字段为字符串（非字符串返回 `undefined`）。 */
export function readStringField(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
