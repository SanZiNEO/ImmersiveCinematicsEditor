/**
 * 悬停卡只读摘要模型（11-02 / 11-04 / 11-05）。
 *
 * 本模块是图插件边界内的纯函数：把脚本 JSON 根节点映射成悬停卡可直接渲染的
 * 只读视图。条件文案一律复用 `describeTriggerCondition`（列表 / 详情 / 悬停卡
 * 三处共用的唯一摘要生成处），不在卡片里另写一套条件中文；前置状态复用
 * `resolveRequirement`。本模块不写文档、不发命令、不持有输入态。
 */
import { isJsonObject, isJsonArray } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { BUILTIN_REQUIREMENT_TYPES } from '../../core/schema/catalog/behaviorTriggers.ts'
import { parseTriggerNode, triggerIdentity } from '../../features/behavior/trigger.ts'
import type { ContinuityView, RequirementEntry, TriggerNode } from '../../features/behavior/trigger.types.ts'
import { describeTriggerCondition, readConditionChildren, conditionRole } from '../../features/behavior/triggerConditions.ts'
import { resolveRequirement } from '../../features/behavior/requirements.ts'
import type { RequirementContext, RequirementStatus } from '../../features/behavior/requirements.ts'

/** 条件树节点角色：组合器 / 前置子项 / 普通叶子 / 未知类型。 */
export type HoverConditionRole = 'combinator' | 'prerequisite' | 'leaf' | 'unknown'

/** 条件树一个只读节点（组合器带任意深度子节点；叶子 / 前置无子节点）。 */
export interface HoverConditionNode {
  /** 原始类型键（未知类型原样保留，供只读展示）。 */
  type: string
  role: HoverConditionRole
  /** 叶子 / 组合器头行摘要；前置子项由 `requirement` 渲染，此处留空。 */
  text: string
  children: HoverConditionNode[] | null
  /** 前置子项解析结果（`role === 'prerequisite'` 时存在）。 */
  requirement: HoverRequirementRef | null
}

/** 一条前置的解析引用（条件树内的前置子项与触发器级前置共用形态）。 */
export interface HoverRequirementRef {
  target: string | undefined
  status: RequirementStatus
  message: string
}

/** 触发器级前置条目（保留原顺序与原形态只读）。 */
export interface HoverRequirementView extends HoverRequirementRef {
  index: number
  /** 目录内中文标签；自定义 / 未知回落原类型键。 */
  typeLabel: string
  /** 原始条目只读文本（自定义 / 非法形态回退展示用）。 */
  rawText: string
}

/** 一条触发器在悬停卡中的完整只读视图。 */
export interface HoverTriggerView {
  /** 触发器身份（用于卡片内临时选中；不写 `state.selection`）。 */
  identity: string
  index: number
  type: string
  /** 目录中文标签；未知类型回落 `未知类型 <type>`。 */
  label: string
  repeatable: boolean
  delaySeconds: number | undefined
  onEnter: boolean
  continuity: ContinuityView
  /** 完整条件树；`null` 表示无场景条件。 */
  conditionTree: HoverConditionNode | null
  requirements: HoverRequirementView[]
}

/** 整份脚本的悬停卡摘要。 */
export interface HoverScriptSummary {
  scriptId: string | undefined
  triggers: HoverTriggerView[]
}

/** 读取 / 构建结果：失败时卡片退回节点摘要，不弹错误窗。 */
export interface HoverSummaryOutcome {
  ok: boolean
  summary: HoverScriptSummary | null
  /** 失败原因（仅用于状态区 / 内部记录；卡片只显示固定回退文案）。 */
  reason: string | null
}

/** 前置状态中文标签（与 11-05 六种解析状态一一对应）。 */
export const HOVER_REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  resolved: '已解析',
  missing: '缺失',
  self_reference: '自引用',
  duplicate_id_unresolved: '重复 id',
  custom: '自定义前置，只读',
  malformed: '形态非法',
}

/** 状态徽标样式分组（只读展示，不含任何动作）。 */
export function hoverRequirementStatusKind(status: RequirementStatus): 'success' | 'error' | 'warning' | 'muted' {
  switch (status) {
    case 'resolved':
      return 'success'
    case 'missing':
    case 'malformed':
      return 'error'
    case 'self_reference':
    case 'duplicate_id_unresolved':
      return 'warning'
    case 'custom':
      return 'muted'
  }
}

/** 内置前置目录中文标签；自定义 / 未知类型原样保留类型键（只读）。 */
export function requirementCatalogLabel(type: string): string {
  return BUILTIN_REQUIREMENT_TYPES.find((entry) => entry.type === type)?.label ?? type
}

/** 原始条目只读文本：JSON 紧凑序列化，截断到 120 字。 */
function describeRaw(entry: RequirementEntry): string {
  try {
    const text = JSON.stringify(entry.raw)
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return String(entry.raw)
  }
}

/** 条件树递归构建；空条件对象返回 `null`（卡片显示「无场景条件」）。 */
function buildConditionTree(node: TriggerNode, ctx: RequirementContext): HoverConditionNode | null {
  if (Object.keys(node.conditions).length === 0) {
    return null
  }
  return buildConditionNode(node.type, node.conditions, ctx)
}

/** 条件树递归构建单个节点。 */
function buildConditionNode(type: string, conditions: JsonObject, ctx: RequirementContext): HoverConditionNode {
  const role = conditionRole(type)

  if (role === 'combinator') {
    const children = readConditionChildren(conditions)
      .map((child) => buildConditionNode(child.type, child.conditions, ctx))
    return {
      type,
      role,
      text: describeTriggerCondition({ type, conditions }),
      children,
      requirement: null,
    }
  }

  if (role === 'prerequisite') {
    // 前置子项走前置解析层，不套用条件叶子摘要（避免把内置前置显示成未知条件）。
    const entry: RequirementEntry = { kind: 'object', raw: { type, conditions }, type, data: conditions }
    const resolved = resolveRequirement(entry, ctx)
    return {
      type,
      role: 'prerequisite',
      text: '',
      children: null,
      requirement: { target: resolved.targetScriptId, status: resolved.status, message: resolved.message },
    }
  }

  return {
    type,
    role: role === 'unknown' ? 'unknown' : 'leaf',
    text: describeTriggerCondition({ type, conditions }),
    children: null,
    requirement: null,
  }
}

/** 触发器级前置条目解析成只读视图。 */
function buildRequirementViews(node: TriggerNode, ctx: RequirementContext): HoverRequirementView[] {
  return node.requires.map((entry, index) => {
    const resolved = resolveRequirement(entry, ctx)
    const type = entry.kind === 'object' ? entry.type : entry.kind === 'string' ? 'script_played' : ''
    return {
      index,
      typeLabel: requirementCatalogLabel(type),
      target: resolved.targetScriptId,
      status: resolved.status,
      message: resolved.message,
      rawText: describeRaw(entry),
    }
  })
}

/** 单条触发器视图构建；非法数组元素落成一条「未声明类型」只读行。 */
function buildTriggerView(raw: JsonValue, index: number, ctx: RequirementContext): HoverTriggerView {
  if (!isJsonObject(raw)) {
    return {
      identity: `unknown#${index}`,
      index,
      type: '',
      label: '未声明类型',
      repeatable: false,
      delaySeconds: undefined,
      onEnter: false,
      continuity: { sweep: undefined, dwellTicks: undefined, windowTicks: undefined },
      conditionTree: null,
      requirements: [],
    }
  }

  const node = parseTriggerNode(raw, index)
  const { timing } = node
  return {
    identity: triggerIdentity(node, index),
    index,
    type: node.type,
    label: node.info?.label ?? (node.type ? `未知类型 ${node.type}` : '未声明类型'),
    repeatable: timing.repeatable,
    delaySeconds: timing.delaySeconds,
    onEnter: timing.onEnter,
    continuity: timing.continuity,
    conditionTree: buildConditionTree(node, ctx),
    requirements: buildRequirementViews(node, ctx),
  }
}

/**
 * 从脚本根节点构建悬停卡摘要。
 *
 * `meta.triggers` 缺失 / 非数组时按空列表处理；单条非法元素在视图内落成只读行，
 * 不让整卡空白。上下文（自脚本 id / 已知 id / 重复 id）由图快照提供。
 */
export function buildHoverSummary(root: JsonObject, ctx: RequirementContext): HoverScriptSummary {
  const meta = isJsonObject(root.meta) ? root.meta : {}
  const scriptId = typeof meta.id === 'string' && meta.id !== '' ? meta.id : undefined
  const rawTriggers = isJsonArray(meta.triggers) ? meta.triggers : []
  const triggers = rawTriggers.map((raw, index) => buildTriggerView(raw, index, ctx))
  return { scriptId, triggers }
}

/** 触发器元信息片段（单次 / 可重复 / delay / on_enter / 连续窗口）。 */
export function triggerMetaParts(view: HoverTriggerView): string[] {
  const parts: string[] = [view.repeatable ? '可重复' : '单次']
  if (view.delaySeconds !== undefined && view.delaySeconds > 0) {
    parts.push(`delay ${view.delaySeconds}s`)
  }
  if (view.onEnter) {
    parts.push('on_enter')
  }
  const continuity = view.continuity
  if (continuity.windowTicks !== undefined && continuity.windowTicks > 0) {
    parts.push(`窗口 ${continuity.windowTicks} tick`)
  }
  if (continuity.dwellTicks !== undefined && continuity.dwellTicks > 0) {
    parts.push(`停留 ${continuity.dwellTicks} tick`)
  }
  if (continuity.sweep === true) {
    parts.push('扫掠')
  }
  return parts
}
