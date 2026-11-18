/**
 * 事实索引与字典（11-11）：只读"引用索引 + 字典说明"两个视图。
 *
 * 边界（11-11 §三 / §4.4）：
 * - 不求值：不显示某玩家当前是否满足事实，不提供模拟 / 强制解锁，不出现真假开关；
 * - 只写引用字段：本模块没有任何输入框，不新增事实类型；
 * - 引擎内部事实只做说明，不进可引用集合。
 *
 * 事实分层与语义以主模组为准：
 * - 内置前置：`trigger/server/prereq/BuiltinPrerequisites.java`（玩家 + 脚本 id，锁存，与实例 / 退出原因无关）；
 * - 片段 / 规则事实：`script/rule/runtime/RuleFactStore.java`（最近一次执行 / 最近一次激活）；
 * - 引擎内部事实：`trigger/server/fact/FactType.java`（持久性与保留上限）。
 */
import { isJsonObject, memberPath } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue, Severity } from '../../core/doc/types.ts'
import type { BehaviorProblem, RecordRef, SourceRef } from './shared.ts'

// ── 静态字典：分层与语义事实 ────────────────────────────────────────────

/** 事实分层：可引用 / 派生 / 引擎内部。 */
export type FactLayer = 'referencable' | 'derived' | 'internal'

/** 引用类型（五类位置，11-11 §4.1）。 */
export type ReferenceType =
  | 'requirement'
  | 'combinator'
  | 'clip_fact'
  | 'rule_fact'
  | 'schedule_fact'

/** 解析状态：引用由文档内容与项目索引共同算出，不查询运行时。 */
export type FactStatus =
  | 'resolved'
  | 'missing'
  | 'self_reference'
  | 'unknown_type'
  | 'custom_readonly'
  /** 缺少项目索引（脚本 / 片段 / 绑定集合为空）：存在性与归属都无法判定，不计缺失、不判自引用，不阻断。 */
  | 'unresolved'

/** 字典分组键。 */
export type FactGroupId = 'prereq' | 'clip_fact' | 'rule_fact' | 'derived' | 'internal'

export interface FactDictionaryEntry {
  group: FactGroupId
  /** 事实稳定名（前置名 / 事实叶子名 / 引擎内部 id）。 */
  name: string
  /** 成立条件（语义说明，不读运行态）。 */
  condition: string
  /** 作用域（玩家 + 脚本 / 片段最近一次执行 / 绑定最近一次激活等）。 */
  scope: string
  /** 可被写进字段；引擎内部为 `false`。 */
  referenceable: boolean
  /** 可引用位置（前置 / 条件片段事实 / 条件规则事实 / 调度事实）。 */
  allowedIn: ReferenceType[]
  /** 引擎内部条目：面板默认收起。 */
  collapsedByDefault: boolean
  /** 持久性（persistent / session）与保留上限；引擎内部事实填写。 */
  durability?: string
  sourceRef: SourceRef
}

const PREREQ_SRC = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/trigger/server/prereq/BuiltinPrerequisites.java'
const QUERIES_SRC = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/trigger/server/fact/FactQueries.java'
const STORE_SRC = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/rule/runtime/RuleFactStore.java'
const FACT_TYPE_SRC = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/trigger/server/fact/FactType.java'

/** 三种内置脚本前置（按 玩家 + 脚本 id 查询）。 */
export const BUILTIN_PREREQUISITES = ['script_played', 'script_started', 'script_completed'] as const

/** 片段事实叶子名（`clip_fact`）。 */
export const CLIP_FACT_NAMES = ['started', 'completed'] as const

/** 规则事实叶子名（`rule_fact` / 调度 `fact`）。 */
export const RULE_FACT_NAMES = ['succeeded', 'action_completed'] as const

/** 引擎内部事实条目（持久性 / 保留上限逐字来自 FactType）。 */
function internalFact(name: string, durability: string, maxRetained: number, line: number, condition: string): FactDictionaryEntry {
  return {
    group: 'internal',
    name,
    condition,
    scope: '引擎写入的发生流水 / 去重记录；不可选为条件类型，不可编辑。',
    referenceable: false,
    allowedIn: [],
    collapsedByDefault: true,
    durability: `${durability}（${maxRetained === 0 ? '不按条数淘汰' : `上限 ${maxRetained} 条`}）`,
    sourceRef: { file: FACT_TYPE_SRC, line, symbol: name },
  }
}

const INTERNAL_FACTS: readonly FactDictionaryEntry[] = [
  internalFact('playback_started', 'persistent', 256, 16, '脚本开始播放底账；前置查询的合成分量之一。'),
  internalFact('playback_finished', 'persistent', 256, 17, '脚本结束播放底账（任何退出原因）；前置查询的合成分量之一。'),
  internalFact('trigger_fired', 'persistent', 1024, 18, '单次触发器持久去重记录，跨会话不重复；要重新允许触发应改 repeatable，不是"清事实"。'),
  internalFact('region_entered', 'session', 512, 20, '区域进入事件证据。'),
  internalFact('region_left', 'session', 512, 21, '区域离开事件证据。'),
  internalFact('skip_vote', 'session', 0, 23, '跳过投票证据；实例结束时显式清理。'),
  internalFact('login', 'session', 16, 24, '登录事件证据。'),
  internalFact('entity_kill', 'session', 256, 25, '击杀实体事件证据。'),
  internalFact('death', 'session', 64, 26, '死亡事件证据。'),
  internalFact('advancement', 'session', 256, 27, '进度事件证据。'),
  internalFact('dimension_change', 'session', 64, 28, '维度切换事件证据。'),
  internalFact('interact_block', 'session', 256, 29, '交互方块事件证据。'),
  internalFact('interact_entity', 'session', 256, 30, '交互实体事件证据。'),
  internalFact('item_craft', 'session', 256, 31, '合成物品事件证据。'),
  internalFact('item_use', 'session', 128, 32, '使用物品事件证据。'),
  internalFact('item_consume', 'session', 128, 33, '消耗物品事件证据。'),
  internalFact('item_release', 'session', 128, 34, '释放物品事件证据。'),
  internalFact('item_use_interrupt', 'session', 64, 35, '使用中断事件证据。'),
  internalFact('item_instant_use', 'session', 128, 36, '瞬时使用事件证据。'),
  internalFact('item_pickup', 'session', 512, 37, '拾取物品事件证据。'),
  internalFact('item_drop', 'session', 256, 38, '丢弃物品事件证据。'),
]

/** 可引用事实字典（只有这些名字能被写进字段）。 */
export const FACT_DICTIONARY: readonly FactDictionaryEntry[] = [
  {
    group: 'prereq',
    name: 'script_played',
    condition: '有开始播放事实且有结束播放事实；中途退出也算，不是"完整看完"；派生自两条播放底账，本身不是独立记录。',
    scope: '玩家 + 脚本 id；锁存：一旦成立持续为真，不因新播放自动清零；与播放实例、退出原因无关。',
    referenceable: true,
    allowedIn: ['requirement', 'combinator'],
    collapsedByDefault: false,
    durability: 'persistent（256 条底账上限）',
    sourceRef: { file: PREREQ_SRC, line: 19, symbol: 'script_played' },
  },
  {
    group: 'prereq',
    name: 'script_started',
    condition: '只要求有开始播放事实。',
    scope: '玩家 + 脚本 id；锁存；与播放实例、退出原因无关。',
    referenceable: true,
    allowedIn: ['requirement', 'combinator'],
    collapsedByDefault: false,
    durability: 'persistent（256 条底账上限）',
    sourceRef: { file: PREREQ_SRC, line: 25, symbol: 'script_started' },
  },
  {
    group: 'prereq',
    name: 'script_completed',
    condition: '只看结束播放事实，不要求先开始过；不是"完整播完"。',
    scope: '玩家 + 脚本 id；锁存；与播放实例、退出原因无关。',
    referenceable: true,
    allowedIn: ['requirement', 'combinator'],
    collapsedByDefault: false,
    durability: 'persistent（256 条底账上限）',
    sourceRef: { file: PREREQ_SRC, line: 31, symbol: 'script_completed' },
  },
  {
    group: 'clip_fact',
    name: 'started',
    condition: '片段执行进入时记录（时间门之前也记录）。',
    scope: '该片段最近一次执行；新执行开始会重置上一执行的完成标记，不是无界历史。',
    referenceable: true,
    allowedIn: ['clip_fact'],
    collapsedByDefault: false,
    sourceRef: { file: STORE_SRC, line: 59, symbol: 'recordClipStarted' },
  },
  {
    group: 'clip_fact',
    name: 'completed',
    condition: '本次执行完成时记录；按执行身份匹配，更旧的执行身份被忽略。',
    scope: '该片段最近一次执行；标注"最近一次执行"，不是历史列表。',
    referenceable: true,
    allowedIn: ['clip_fact'],
    collapsedByDefault: false,
    sourceRef: { file: STORE_SRC, line: 82, symbol: 'recordClipCompleted' },
  },
  {
    group: 'rule_fact',
    name: 'succeeded',
    condition: '条件判定成功时记录；判定成功 ≠ 动作全部成功。',
    scope: '该绑定最近一次激活；新激活建立时清空上一激活的两个标记。',
    referenceable: true,
    allowedIn: ['rule_fact', 'schedule_fact'],
    collapsedByDefault: false,
    sourceRef: { file: STORE_SRC, line: 111, symbol: 'recordRuleSucceeded' },
  },
  {
    group: 'rule_fact',
    name: 'action_completed',
    condition: '动作批次实际提交完成后才记录；带调度的绑定在动作入队时不记录；不是每个动作都执行成功。',
    scope: '该绑定最近一次激活；新激活清空上一激活标记。',
    referenceable: true,
    allowedIn: ['rule_fact', 'schedule_fact'],
    collapsedByDefault: false,
    sourceRef: { file: STORE_SRC, line: 128, symbol: 'recordActionCompleted' },
  },
  {
    group: 'derived',
    name: 'script_played（派生）',
    condition: '由 playback_started 与 playback_finished 两条底账合成：开始且结束过（任何结果都算）。',
    scope: '不是独立记录；查询时现场合成，不单独写账。',
    referenceable: false,
    allowedIn: [],
    collapsedByDefault: false,
    sourceRef: { file: QUERIES_SRC, line: 24, symbol: 'scriptPlayed' },
  },
  // 引擎内部事实（FactType 枚举）：不出现在类型下拉，只做说明。
  ...INTERNAL_FACTS,
]

/** 可引用事实名集合（字典里 referenceable 的条目名）。 */
export const REFERENCABLE_FACT_NAMES: readonly string[] = FACT_DICTIONARY.filter((entry) => entry.referenceable).map((entry) => entry.name)

// ── 引用索引 ───────────────────────────────────────────────────────────

/** 事实索引上下文：项目图 / 文档已声明的 id 集合（跨脚本解析用）。 */
export interface FactIndexContext {
  /** 脚本 id 集合（含本脚本 meta.id）。 */
  scriptIds: ReadonlySet<string>
  /** 片段 id 集合。 */
  clipIds: ReadonlySet<string>
  /** 绑定 id 集合。 */
  bindingIds: ReadonlySet<string>
  /** 本脚本 meta.id（前置自引用判定）。 */
  selfScriptId?: string
}

/** 一条事实引用。 */
export interface FactReference {
  /** 事实名（前置名 / clip_fact:<片段>:<叶子> / rule_fact:<绑定>:<叶子> / schedule_fact:<绑定>:<叶子>）。 */
  name: string
  ref: RecordRef
  referenceType: ReferenceType
  /** 文档内 JSON 路径。 */
  location: string
  /** 位置可读标签（触发器 id / 规则 id / 绑定 id / 条件路径）。 */
  locationLabel: string
  /** 目标脚本 / 片段 / 绑定 id。 */
  target: string
  /** 事实叶子名（前置 / 片段 / 规则）。 */
  fact: string
  status: FactStatus
}

/** 概览计数（只统计引用，不求值；不出现"未满足"字样）。 */
export interface FactOverview {
  referencableCount: number
  referencedCount: number
  unusedCount: number
  unresolvableCount: number
}

/** 事实索引结果。 */
export interface FactIndexResult {
  overview: FactOverview
  references: FactReference[]
  dictionary: readonly FactDictionaryEntry[]
  diagnostics: BehaviorProblem[]
}

/** 生成引用事实名（键 = 事实名 + 引用位置）。 */
export function factReferenceName(referenceType: ReferenceType, target: string, fact: string): string {
  switch (referenceType) {
    case 'requirement':
    case 'combinator':
      return `${fact}:${target}`
    case 'clip_fact':
      return `clip_fact:${target}:${fact}`
    case 'rule_fact':
      return `rule_fact:${target}:${fact}`
    case 'schedule_fact':
      return `schedule_fact:${target}:${fact}`
  }
}

const COMBINATOR_TYPES = ['all_of', 'any'] as const

/** 扫描脚本文档，产出引用索引、字典与诊断。 */
export function factIndex(root: JsonObject, ctx: FactIndexContext): FactIndexResult {
  const references: FactReference[] = []
  const diagnostics: BehaviorProblem[] = []

  const bindingIds = ctx.bindingIds

  // ── 触发器外层前置：meta.triggers[].requires[] ──
  const metaObject = isJsonObject(root.meta) ? root.meta : null
  const triggers = metaObject !== null && Array.isArray(metaObject.triggers) ? (metaObject.triggers as JsonValue[]) : []
  triggers.forEach((triggerElement, triggerIndex) => {
    if (!isJsonObject(triggerElement)) return
    const triggerId = typeof triggerElement.id === 'string' && triggerElement.id.length > 0
      ? triggerElement.id
      : `trigger#${triggerIndex}`
    const triggerPath = `meta.triggers[${triggerIndex}]`
    const requires = triggerElement.requires
    if (!Array.isArray(requires)) return
    requires.forEach((requirementElement, requirementIndex) => {
      const location = `${triggerPath}.requires[${requirementIndex}]`
      if (typeof requirementElement === 'string') {
        // 字符串简写 = script_played（11-11 验收：字符串前置显示为 script_played → 目标）。
        const target = requirementElement
        const status = prereqStatus(target, ctx)
        references.push({
          name: factReferenceName('requirement', target, 'script_played'),
          ref: { kind: 'fact', name: `script_played:${target}` },
          referenceType: 'requirement',
          location,
          locationLabel: `触发器 ${triggerId}`,
          target,
          fact: 'script_played',
          status,
        })
        return
      }
      if (!isJsonObject(requirementElement)) return
      const type = typeof requirementElement.type === 'string' ? requirementElement.type : ''
      const data = isJsonObject(requirementElement.data) ? requirementElement.data : requirementElement
      const target = typeof data.script === 'string' ? data.script : ''
      if (!BUILTIN_PREREQUISITES.includes(type as (typeof BUILTIN_PREREQUISITES)[number])) {
        references.push({
          name: type.length > 0 ? `${type}:${target}` : 'unknown',
          ref: { kind: 'fact', name: type },
          referenceType: 'requirement',
          location,
          locationLabel: `触发器 ${triggerId}`,
          target,
          fact: type,
          status: type.length > 0 ? 'custom_readonly' : 'unknown_type',
        })
        return
      }
      const status = prereqStatus(target, ctx)
      references.push({
        name: factReferenceName('requirement', target, type),
        ref: { kind: 'fact', name: `${type}:${target}` },
        referenceType: 'requirement',
        location,
        locationLabel: `触发器 ${triggerId}`,
        target,
        fact: type,
        status,
      })
    })
  })

  // ── 规则条件树：组合器子项前置 / 片段事实 / 规则事实 ──
  const rules = Array.isArray(root.rules) ? (root.rules as JsonValue[]) : []
  const ruleOfBinding = collectRuleOfBinding(root)
  rules.forEach((ruleElement, ruleIndex) => {
    if (!isJsonObject(ruleElement)) return
    const ruleId = typeof ruleElement.id === 'string' && ruleElement.id.length > 0 ? ruleElement.id : `rule#${ruleIndex}`
    const location = `rules[${ruleIndex}].condition`
    walkConditionTree(ruleElement.condition, location, {
      ruleId,
      ruleOfBinding,
      ctx,
      references,
      diagnostics,
    })
  })

  // ── 调度事实：rule_bindings[].schedule.on === 'fact' ──
  const bindings = Array.isArray(root.rule_bindings) ? (root.rule_bindings as JsonValue[]) : []
  bindings.forEach((bindingElement, bindingIndex) => {
    if (!isJsonObject(bindingElement)) return
    const bindingId = typeof bindingElement.id === 'string' && bindingElement.id.length > 0
      ? bindingElement.id
      : `binding#${bindingIndex}`
    const schedule = bindingElement.schedule
    if (!isJsonObject(schedule) || schedule.on !== 'fact') return
    const target = typeof schedule.binding === 'string' ? schedule.binding : ''
    const fact = typeof schedule.fact === 'string' ? schedule.fact : ''
    const location = `rule_bindings[${bindingIndex}].schedule`
    // 调度事实不算自引用：前向引用允许，成环由 bindings.ts 的调度成环检测负责。
    const status = factStatus('rule_fact', target, fact, false, ctx, RULE_FACT_NAMES)
    references.push({
      name: factReferenceName('schedule_fact', target, fact),
      ref: { kind: 'fact', name: `schedule_fact:${target}:${fact}` },
      referenceType: 'schedule_fact',
      location,
      locationLabel: `绑定 ${bindingId}`,
      target,
      fact,
      status,
    })
    if (target.length > 0 && bindingIds.size > 0 && !bindingIds.has(target)) {
      pushDiagnostic(diagnostics, 'block', 'L56', `调度事实引用未知绑定: ${target}`, location, bindingId)
    }
    if (fact.length > 0 && !RULE_FACT_NAMES.includes(fact as (typeof RULE_FACT_NAMES)[number])) {
      pushDiagnostic(diagnostics, 'block', 'L55', `未知调度事实: ${fact}（可选: ${RULE_FACT_NAMES.join(' / ')}）`, location, bindingId)
    }
  })

  // ── 概览：可引用数 / 已引用 / 未使用 / 不可解析 ──
  const referencedNames = new Set(
    references
      .filter((item) => REFERENCABLE_FACT_NAMES.includes(item.fact))
      .map((item) => item.fact),
  )
  const unresolvable = references.filter((item) =>
    item.status === 'missing' || item.status === 'unknown_type').length

  return {
    overview: {
      referencableCount: REFERENCABLE_FACT_NAMES.length,
      referencedCount: referencedNames.size,
      unusedCount: REFERENCABLE_FACT_NAMES.length - referencedNames.size,
      unresolvableCount: unresolvable,
    },
    references,
    dictionary: FACT_DICTIONARY,
    diagnostics,
  }
}

/** 收集绑定归属：rule_fact 自引用 = 目标绑定属于同一条规则（`binding.rule === 当前规则`）。 */
function collectRuleOfBinding(root: JsonObject): Map<string, string> {
  const ruleOfBinding = new Map<string, string>()
  const bindings = Array.isArray(root.rule_bindings) ? (root.rule_bindings as JsonValue[]) : []
  bindings.forEach((bindingElement) => {
    if (!isJsonObject(bindingElement)) return
    const bindingId = typeof bindingElement.id === 'string' ? bindingElement.id : ''
    const ruleId = typeof bindingElement.rule === 'string' ? bindingElement.rule : ''
    if (bindingId.length === 0 || ruleId.length === 0) return
    ruleOfBinding.set(bindingId, ruleId)
  })
  return ruleOfBinding
}

interface WalkContext {
  ruleId: string
  ruleOfBinding: Map<string, string>
  ctx: FactIndexContext
  references: FactReference[]
  diagnostics: BehaviorProblem[]
}

/**
 * 条件节点解包：组合器子项是「类型 + `conditions`」两层形态，叶子字段包在 `conditions` 里；
 * 与 `ruleConditions.ts` 同一取值口径（`{ type, ...conditions }`），兼容顶层平铺旧形态。
 */
function unwrapConditionNode(child: JsonValue): JsonObject {
  if (!isJsonObject(child)) return {}
  const conditions = isJsonObject(child.conditions) ? child.conditions : null
  if (conditions !== null) return { type: child.type, ...conditions }
  return { ...child }
}

/** 递归走条件树：组合器展开子项；事实叶子与前置叶子登记引用。 */
function walkConditionTree(node: JsonValue, path: string, context: WalkContext, depth = 0): void {
  if (!isJsonObject(node) || depth > 8) return
  const current = unwrapConditionNode(node)
  const type = typeof current.type === 'string' ? current.type : ''

  if (COMBINATOR_TYPES.includes(type as (typeof COMBINATOR_TYPES)[number])) {
    const list = current.list
    if (!Array.isArray(list)) return
    list.forEach((child, index) => {
      walkConditionTree(child, memberPath(path, `list[${index}]`), context, depth + 1)
    })
    return
  }

  if (type === 'clip_fact') {
    const target = typeof current.clip === 'string' ? current.clip : ''
    const fact = typeof current.fact === 'string' ? current.fact : ''
    const status = factStatus('clip_fact', target, fact, false, context.ctx, CLIP_FACT_NAMES)
    context.references.push({
      name: factReferenceName('clip_fact', target, fact),
      ref: { kind: 'fact', name: `clip_fact:${target}:${fact}` },
      referenceType: 'clip_fact',
      location: path,
      locationLabel: `规则 ${context.ruleId} 条件`,
      target,
      fact,
      status,
    })
    if (target.length > 0 && context.ctx.clipIds.size > 0 && !context.ctx.clipIds.has(target)) {
      pushDiagnostic(context.diagnostics, 'block', 'L55', `片段事实引用未知片段: ${target}`, path, undefined)
    }
    if (fact.length > 0 && !CLIP_FACT_NAMES.includes(fact as (typeof CLIP_FACT_NAMES)[number])) {
      pushDiagnostic(context.diagnostics, 'block', 'L55', `未知片段事实: ${fact}（可选: ${CLIP_FACT_NAMES.join(' / ')}）`, path, undefined)
    }
    return
  }

  if (type === 'rule_fact') {
    const target = typeof current.binding === 'string' ? current.binding : ''
    const fact = typeof current.fact === 'string' ? current.fact : ''
    // 自引用仅限同一条规则：目标绑定的 `rule` 字段等于当前规则；跨规则互引不是自引用。
    const targetRule = context.ruleOfBinding.get(target) ?? null
    const sameRule = targetRule !== null && targetRule === context.ruleId
    const status = factStatus('rule_fact', target, fact, sameRule, context.ctx, RULE_FACT_NAMES)
    context.references.push({
      name: factReferenceName('rule_fact', target, fact),
      ref: { kind: 'fact', name: `rule_fact:${target}:${fact}` },
      referenceType: 'rule_fact',
      location: path,
      locationLabel: `规则 ${context.ruleId} 条件`,
      target,
      fact,
      status,
    })
    if (target.length > 0 && context.ctx.bindingIds.size > 0 && !context.ctx.bindingIds.has(target)) {
      pushDiagnostic(context.diagnostics, 'block', 'L55', `规则事实引用未知绑定: ${target}`, path, undefined)
    } else if (sameRule) {
      pushDiagnostic(context.diagnostics, 'warn', 'L86', '自引用事实，可能永远不成立', path, target)
    }
    if (fact.length > 0 && !RULE_FACT_NAMES.includes(fact as (typeof RULE_FACT_NAMES)[number])) {
      pushDiagnostic(context.diagnostics, 'block', 'L55', `未知规则事实: ${fact}（可选: ${RULE_FACT_NAMES.join(' / ')}）`, path, undefined)
    }
    return
  }

  // 组合器子项里的脚本前置。条目形态与前置诊断由 requirements.ts 负责，这里只登记引用索引。
  if (BUILTIN_PREREQUISITES.includes(type as (typeof BUILTIN_PREREQUISITES)[number])) {
    const data = isJsonObject(current.data) ? current.data : current
    const target = typeof data.script === 'string' ? data.script : ''
    const status = prereqStatus(target, context.ctx)
    context.references.push({
      name: factReferenceName('combinator', target, type),
      ref: { kind: 'fact', name: `${type}:${target}` },
      referenceType: 'combinator',
      location: path,
      locationLabel: `规则 ${context.ruleId} 条件`,
      target,
      fact: type,
      status,
    })
  }
}

/**
 * 前置目标解析：自引用只靠 `selfScriptId` 比对，不受索引是否齐备影响；
 * 脚本索引为空集 = 未提供项目图，存在性无法判定（`unresolved`，不阻断），不判缺失也不判已解析。
 */
function prereqStatus(target: string, ctx: FactIndexContext): FactStatus {
  if (target.length === 0) return 'unknown_type'
  if (ctx.selfScriptId !== undefined && target === ctx.selfScriptId) return 'self_reference'
  if (ctx.scriptIds.size === 0) return 'unresolved'
  return ctx.scriptIds.has(target) ? 'resolved' : 'missing'
}

/**
 * 片段 / 规则事实目标解析：绑定 / 片段索引为空集时降级 `unresolved`；
 * 规则事实自引用仅限同一条规则（`sameRule`），跨规则互引不是自引用。
 */
function factStatus(
  kind: 'clip_fact' | 'rule_fact',
  target: string,
  fact: string,
  sameRule: boolean,
  ctx: FactIndexContext,
  validFactNames: readonly string[],
): FactStatus {
  if (target.length === 0 || fact.length === 0) return 'unknown_type'
  const known = kind === 'clip_fact' ? ctx.clipIds : ctx.bindingIds
  if (known.size === 0) return 'unresolved'
  if (!known.has(target)) return 'missing'
  if (!validFactNames.includes(fact)) return 'unknown_type'
  if (kind === 'rule_fact' && sameRule) return 'self_reference'
  return 'resolved'
}

function pushDiagnostic(
  diagnostics: BehaviorProblem[],
  severity: Severity,
  code: string,
  message: string,
  jsonPath: string,
  clipKey?: string,
): void {
  diagnostics.push({ code, severity, message, jsonPath, clipKey })
}
