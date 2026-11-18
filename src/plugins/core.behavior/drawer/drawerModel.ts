/**
 * 行为抽屉的纯读取模型（11-01）。
 *
 * 只吃文档 root 深拷贝与片段摘要，现算树行 / 身份 / 摘要 / 问题级别；不 commit、不读会话、
 * 不持跨 revision 缓存。Vue 外壳每轮修订后重新调用 {@link buildBehaviorModel}。
 *
 * 身份口径（11-01 §五）：选择按记录身份（`RecordRef`），不按下标；文档变化致目标消失时
 * 外壳回落总览，不在相邻记录间跳动。
 */
import type { JsonObject, Severity } from '../../../core/doc/types.ts'
import { isJsonObject, isJsonArray } from '../../../core/doc/json.ts'
import type { ClipListEntry } from '../../../workbench/api/documents.ts'
import type { BehaviorRefs } from '../../../core/schema/catalog/behaviorRules.ts'
import type { BehaviorProblem, RecordRef } from '../../../features/behavior/shared.ts'
import { highestSeverity, recordRefKey } from '../../../features/behavior/shared.ts'
import { rulesOfRoot, bindingsOfRule, validateRules } from '../../../features/behavior/rules.ts'
import {
  bindingsOfRoot,
  validateBindings,
  referencesToBinding,
  bindingUsesGotoClip,
} from '../../../features/behavior/bindings.ts'
import { eventRecords, type EventRecordNode } from '../../../features/behavior/events.ts'
import {
  parseTriggerNode,
  triggerIdentity,
  triggerHasExplicitId,
  triggerTimingIssues,
} from '../../../features/behavior/trigger.ts'
import { validateTriggerConditions } from '../../../features/behavior/triggerConditions.ts'
import type { TriggerNode } from '../../../features/behavior/trigger.types.ts'
import { describeSummary } from '../../../features/behavior/summary.ts'

// ── 树行形状 ────────────────────────────────────────────────────────────────────

/** 规则 / 绑定 / 触发器 / 事件的窄身份变体。 */
export type RuleRef = Extract<RecordRef, { kind: 'rule' }>
export type BindingRef = Extract<RecordRef, { kind: 'binding' }>
export type TriggerRef = Extract<RecordRef, { kind: 'trigger' }>

/** 触发器树行：只做摘要 + 跳转右栏，不带任何字段编辑器（用户裁决）。 */
export interface TriggerRow {
  ref: TriggerRef
  index: number
  identity: string
  hasExplicitId: boolean
  summary: string
  severity: Severity | null
  problems: BehaviorProblem[]
}

/** 绑定树行：挂在所属规则之下。 */
export interface BindingRow {
  ref: BindingRef
  index: number
  ruleId: string
  node: JsonObject
  summary: string
  severity: Severity | null
  problems: BehaviorProblem[]
  /** 绑定引用的片段 id 在当前脚本片段表里不存在（红框 / 诊断）。 */
  missingClip: boolean
  /** 所属规则动作里是否含 `goto_clip`（分支出口归属判定用）。 */
  usesGotoClip: boolean
}

/** 规则树行：其下挂全部绑定；未绑定的规则仍显示，标注「未绑定」。 */
export interface RuleRow {
  ref: RuleRef
  index: number
  id: string
  node: JsonObject
  summary: string
  severity: Severity | null
  problems: BehaviorProblem[]
  bindings: BindingRow[]
  bindingCount: number
}

/** 事件分组：先按轨道类型（EVENT / MOD_EVENT），组内再按片段。 */
export interface EventGroup {
  trackType: 'EVENT' | 'MOD_EVENT'
  clipKey: string
  entries: EventRecordNode[]
}

/** 整棵行为树的读取模型。 */
export interface BehaviorModel {
  refs: BehaviorRefs
  triggers: TriggerRow[]
  rules: RuleRow[]
  /** 平铺的绑定行（便于按身份反查；树里仍挂在规则下）。 */
  bindings: BindingRow[]
  events: EventRecordNode[]
  eventGroups: EventGroup[]
  ruleById: Map<string, RuleRow>
  bindingById: Map<string, BindingRow>
  triggerByIdentity: Map<string, TriggerRow>
  eventByKey: Map<string, EventRecordNode>
  /** 当前脚本自身 id（前置自引用判定 / 诊断说明用）；无 id 脚本为 `undefined`。 */
  selfScriptId: string | undefined
}

// ── 引用表 ─────────────────────────────────────────────────────────────────────

/**
 * 组装校验引用上下文。片段 id / 时长来自文档片段摘要；规则 / 绑定 id 来自 root。
 * 时间线可达性事实表（`refs.clips`）不在此伪造：缺时间线循环事实时，可达性诊断
 * 降级为「缺数据」，不凭猜测下结论。
 */
export function buildBehaviorRefs(root: JsonObject, clips: readonly ClipListEntry[]): BehaviorRefs {
  const clipIds = new Set<string>()
  const clipDurations = new Map<string, number>()
  for (const clip of clips) {
    if (typeof clip.clipId === 'string' && clip.clipId.length > 0) {
      clipIds.add(clip.clipId)
      clipDurations.set(clip.clipId, clip.duration)
    }
  }

  const ruleIds = new Set<string>()
  const bindingIds = new Set<string>()
  for (const rule of rulesOfRoot(root)) {
    if (typeof rule.id === 'string' && rule.id.length > 0) ruleIds.add(rule.id)
  }
  for (const binding of bindingsOfRoot(root)) {
    if (typeof binding.id === 'string' && binding.id.length > 0) bindingIds.add(binding.id)
  }

  return { clipIds, clipDurations, ruleIds, bindingIds }
}

// ── 问题归集 ────────────────────────────────────────────────────────────────────

const INDEX_PREFIX = /^(rules|rule_bindings)\[(\d+)\]/

function indexOfPath(jsonPath: string): { prefix: 'rules' | 'rule_bindings'; index: number } | null {
  const match = INDEX_PREFIX.exec(jsonPath)
  if (match === null) return null
  return { prefix: match[1] === 'rules' ? 'rules' : 'rule_bindings', index: Number(match[2]) }
}

function groupByIndex(problems: readonly BehaviorProblem[]): Map<number, BehaviorProblem[]> {
  const map = new Map<number, BehaviorProblem[]>()
  for (const problem of problems) {
    const located = indexOfPath(problem.jsonPath)
    if (located === null) continue
    const list = map.get(located.index) ?? []
    list.push(problem)
    map.set(located.index, list)
  }
  return map
}

// ── 模型装配 ────────────────────────────────────────────────────────────────────

/** 从 root + 片段摘要现算整棵行为树；root 为 `null`（无文档）时返回空模型。 */
export function buildBehaviorModel(
  root: JsonObject | null,
  clips: readonly ClipListEntry[],
): BehaviorModel {
  const empty: BehaviorModel = {
    refs: { clipIds: new Set(), clipDurations: new Map(), ruleIds: new Set(), bindingIds: new Set() },
    triggers: [],
    rules: [],
    bindings: [],
    events: [],
    eventGroups: [],
    ruleById: new Map(),
    bindingById: new Map(),
    triggerByIdentity: new Map(),
    eventByKey: new Map(),
    selfScriptId: undefined,
  }
  if (root === null) return empty

  const refs = buildBehaviorRefs(root, clips)
  const meta = isJsonObject(root.meta) ? root.meta : {}
  const selfScriptId = typeof meta.id === 'string' && meta.id.length > 0 ? meta.id : undefined

  // ── 触发器（摘要行；问题来自触发器域自身校验）─────────────────────────────
  const triggerRaw = meta.triggers
  const triggerNodes: TriggerNode[] = []
  if (isJsonArray(triggerRaw)) {
    triggerRaw.forEach((raw, index) => {
      if (!isJsonObject(raw)) return
      triggerNodes.push(parseTriggerNode(raw, index))
    })
  }
  const triggers: TriggerRow[] = triggerNodes.map((node) => {
    const identity = triggerIdentity(node)
    const problems = [
      ...triggerTimingIssues(node),
      ...validateTriggerConditions(node, { selfScriptId, knownScriptIds: [] }),
    ]
    const summary = describeSummary({ kind: 'trigger', node, index: node.index })
    return {
      ref: { kind: 'trigger', identity },
      index: node.index,
      identity,
      hasExplicitId: triggerHasExplicitId(node),
      summary,
      severity: highestSeverity(problems),
      problems,
    }
  })

  // ── 规则与绑定 ──────────────────────────────────────────────────────────────
  const ruleProblems = groupByIndex(validateRules(root, refs))
  const bindingProblems = groupByIndex(validateBindings(root, refs))

  const ruleNodes = rulesOfRoot(root)
  const bindingNodes = bindingsOfRoot(root)

  const bindings: BindingRow[] = bindingNodes.map((node, index) => {
    const id = typeof node.id === 'string' && node.id.length > 0 ? node.id : `绑定#${index}`
    const ruleId = typeof node.rule === 'string' ? node.rule : ''
    const clipRef = typeof node.clip === 'string' ? node.clip : ''
    const problems = bindingProblems.get(index) ?? []
    const ruleActions = ruleNodes.find((rule) => typeof rule.id === 'string' && rule.id === ruleId)?.actions
    return {
      ref: { kind: 'binding', id },
      index,
      ruleId,
      node,
      summary: describeSummary({ kind: 'binding', binding: node }),
      severity: highestSeverity(problems),
      problems,
      missingClip: clipRef.length > 0 && !refs.clipIds.has(clipRef),
      usesGotoClip: bindingUsesGotoClip(ruleActions ?? null),
    }
  })

  const rules: RuleRow[] = ruleNodes.map((node, index) => {
    const id = typeof node.id === 'string' && node.id.length > 0 ? node.id : `规则#${index}`
    const children = bindings.filter((binding) => binding.ruleId === id)
    const problems = ruleProblems.get(index) ?? []
    return {
      ref: { kind: 'rule', id },
      index,
      id,
      node,
      summary: describeSummary({ kind: 'rule', rule: node, bindingCount: children.length }),
      severity: highestSeverity(problems),
      problems,
      bindings: children,
      bindingCount: children.length,
    }
  })

  // ── 事件：按轨道类型 → 片段分组 ─────────────────────────────────────────────
  const events = eventRecords(root)
  const groupMap = new Map<string, EventGroup>()
  for (const entry of events) {
    const key = `${entry.trackType}:${entry.clipKey}`
    const group = groupMap.get(key)
    if (group === undefined) {
      groupMap.set(key, { trackType: entry.trackType, clipKey: entry.clipKey, entries: [entry] })
    } else {
      group.entries.push(entry)
    }
  }
  const eventGroups = [...groupMap.values()].sort((a, b) => {
    const typeOrder = a.trackType === b.trackType ? 0 : a.trackType === 'EVENT' ? -1 : 1
    return typeOrder !== 0 ? typeOrder : a.clipKey.localeCompare(b.clipKey)
  })

  const model: BehaviorModel = {
    refs,
    triggers,
    rules,
    bindings,
    events,
    eventGroups,
    ruleById: new Map(rules.map((row) => [row.id, row])),
    bindingById: new Map(bindings.map((row) => [row.ref.id, row])),
    triggerByIdentity: new Map(triggers.map((row) => [row.identity, row])),
    eventByKey: new Map(events.map((entry) => [recordRefKey(entry.ref), entry])),
    selfScriptId,
  }
  return model
}

// ── 身份解析 ────────────────────────────────────────────────────────────────────

export type ResolvedRow = TriggerRow | RuleRow | BindingRow | EventRecordNode

/** 按记录身份在模型里反查；目标已删除 / 文档变化后返回 `null`（外壳回落总览）。 */
export function resolveRecord(model: BehaviorModel, ref: RecordRef): ResolvedRow | null {
  switch (ref.kind) {
    case 'trigger':
      return model.triggerByIdentity.get(ref.identity) ?? null
    case 'rule':
      return model.ruleById.get(ref.id) ?? null
    case 'binding':
      return model.bindingById.get(ref.id) ?? null
    case 'event':
      return model.eventByKey.get(recordRefKey(ref)) ?? null
    case 'fact':
      return null
  }
}

// ── 引用保护（删除前列出影响）────────────────────────────────────────────────────

/** 引用某规则的全部绑定身份（规则删除保护）。 */
export function referrersOfRule(root: JsonObject, ruleId: string): JsonObject[] {
  return bindingsOfRule(root, ruleId)
}

/** 引用某绑定的全部位置（调度 fact.binding + 规则条件 rule_fact.binding）。 */
export function referrersOfBinding(root: JsonObject, bindingId: string) {
  return referencesToBinding(root, bindingId)
}

// ── 筛选 ────────────────────────────────────────────────────────────────────────

/**
 * 树行是否命中筛选文本（摘要 + 身份键；大小写不敏感）。不命中只 dim，不自动选中。
 */
export function rowMatchesText(summary: string, identity: string, needle: string): boolean {
  const query = needle.trim().toLowerCase()
  if (query.length === 0) return true
  return summary.toLowerCase().includes(query) || identity.toLowerCase().includes(query)
}

// ── 新 id 建议 ──────────────────────────────────────────────────────────────────

/** 生成未占用的规则 / 绑定 id（`rule_1` 形态，匹配 `RULE_ID_PATTERN`）。 */
export function suggestRecordId(existing: ReadonlySet<string>, base: string): string {
  let candidate = `${base}_1`
  let counter = 1
  while (existing.has(candidate)) {
    counter += 1
    candidate = `${base}_${counter}`
  }
  return candidate
}
