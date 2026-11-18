/**
 * 11 轮规则定义域纯函数：四键校验、policy 六字段语义与交叉约束、缺省投影、复制、
 * 引用保护、规则 id 事务性重命名。不写 Vue / UI / 命令层；不改入参。
 *
 * 口径（与主模组 Java 对齐）：
 * - 四键白名单 `id / condition / actions / policy`，未知键报错（`RuleCollectionParser.DEFINITION_KEYS`）；
 * - `condition` 必填对象，空对象按「永不满足」报错，不自动改成恒真；
 * - `actions` 必填非空数组；`policy` 可省，未知键报错；
 * - 重命名是事务性的：新 id 合法且唯一，全部 `rule_bindings[].rule` 同步更新，任一失败整体抛错。
 */

import type { JsonArray, JsonObject, JsonValue } from '../../core/doc/types.ts'
import {
  cloneJson,
  describe,
  isFiniteNumber,
  isJsonArray,
  isJsonObject,
} from '../../core/doc/json.ts'
import { RULE_ID_PATTERN, RULE_KEYS, RULE_POLICY_KEYS } from '../../core/doc/keys.ts'
import type { BehaviorProblem } from './shared.ts'
import {
  POLICY_DEFAULTS,
  type BehaviorRefs,
} from '../../core/schema/catalog/behaviorRules.ts'
import { validateRuleCondition } from './ruleConditions.ts'
import { validateActions, validatePauseResumePairing } from './actions.ts'

// ── 问题构造 ──────────────────────────────────────────────────────────────────

function problem(
  code: string,
  severity: BehaviorProblem['severity'],
  message: string,
  jsonPath: string,
): BehaviorProblem {
  return { code, severity, message, jsonPath }
}

// ── 读取助手（缺省不回写文档）──────────────────────────────────────────────────

/** 策略对象原文（未写 = `undefined`；读取缺省走 {@link policyDefaults}）。 */
function rawPolicy(rule: JsonObject): JsonObject | undefined {
  return isJsonObject(rule.policy) ? rule.policy : undefined
}

/** 策略缺省投影（不落盘；面板初始值 / 读取缺省用）。 */
export function policyDefaults(): JsonObject {
  return {
    once: POLICY_DEFAULTS.once,
    cooldown: POLICY_DEFAULTS.cooldown,
    mode: POLICY_DEFAULTS.mode,
    dwell: POLICY_DEFAULTS.dwell,
    timeout: POLICY_DEFAULTS.timeout,
    on_timeout: cloneJson(POLICY_DEFAULTS.on_timeout),
  }
}

/** 读取策略布尔 `once`（缺省 true）。 */
export function policyOnce(rule: JsonObject): boolean {
  const policy = rawPolicy(rule)
  const once = policy?.once
  return typeof once === 'boolean' ? once : POLICY_DEFAULTS.once
}

/** 读取策略模式（缺省 enter）。 */
export function policyMode(rule: JsonObject): 'enter' | 'dwell' {
  const mode = rawPolicy(rule)?.mode
  return mode === 'dwell' ? 'dwell' : POLICY_DEFAULTS.mode
}

/** 读取驻留秒数（缺省 0）。 */
export function policyDwell(rule: JsonObject): number {
  const dwell = rawPolicy(rule)?.dwell
  return isFiniteNumber(dwell) ? dwell : POLICY_DEFAULTS.dwell
}

/** 读取冷却秒数（缺省 0）。 */
export function policyCooldown(rule: JsonObject): number {
  const cooldown = rawPolicy(rule)?.cooldown
  return isFiniteNumber(cooldown) ? cooldown : POLICY_DEFAULTS.cooldown
}

/** 读取等待上限（缺省 -1 = 无限等待）。 */
export function policyTimeout(rule: JsonObject): number {
  const timeout = rawPolicy(rule)?.timeout
  return isFiniteNumber(timeout) ? timeout : POLICY_DEFAULTS.timeout
}

/** 是否配置了正的等待上限（`timeout > 0`）。 */
export function policyHasTimeout(rule: JsonObject): boolean {
  return policyTimeout(rule) > 0
}

// ── policy 校验 ───────────────────────────────────────────────────────────────

/**
 * 校验 `policy` 六字段：键白名单 + 各字段类型 / 范围 + 交叉约束。
 * 非法值只报错，不夹取、不静默改写；`on_timeout` 内的命令动作按编辑器合同拦截。
 */
export function validatePolicy(policy: JsonValue, refs?: BehaviorRefs): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const base = 'policy'

  if (!isJsonObject(policy)) {
    issues.push(problem('RULE_POLICY_TYPE', 'block',
      'policy 需要对象（字段: once / cooldown / mode / dwell / timeout / on_timeout）', base))
    return issues
  }

  for (const key of Object.keys(policy)) {
    if (!RULE_POLICY_KEYS.includes(key)) {
      issues.push(problem('RULE_POLICY_UNKNOWN_KEY', 'block',
        `未知键（可用: ${RULE_POLICY_KEYS.join(' / ')}）`, `${base}.${key}`))
    }
  }

  const once = policy.once
  if (once !== undefined && typeof once !== 'boolean') {
    issues.push(problem('RULE_POLICY_ONCE_TYPE', 'error',
      `once 需要布尔值（true = 只触发一次；缺省 true），实际: ${describe(once)}`, `${base}.once`))
  }

  checkNonNegative(policy, 'cooldown', base, issues)
  checkNonNegative(policy, 'dwell', base, issues)

  const mode = policy.mode
  if (mode !== undefined && (typeof mode !== 'string' || (mode !== 'enter' && mode !== 'dwell'))) {
    issues.push(problem('RULE_POLICY_MODE', 'error',
      `mode 需要 enter / dwell（缺省 enter），实际: ${describe(mode)}`, `${base}.mode`))
  }

  const timeout = policy.timeout
  if (timeout !== undefined) {
    if (!isFiniteNumber(timeout)) {
      issues.push(problem('RULE_POLICY_TIMEOUT_TYPE', 'error',
        `timeout 需要数字（秒，> 0；缺省 -1 = 无限等待），实际: ${describe(timeout)}`, `${base}.timeout`))
    } else if (timeout !== POLICY_DEFAULTS.timeout && !(timeout > 0)) {
      issues.push(problem('RULE_POLICY_TIMEOUT_RANGE', 'error',
        `timeout 需要 > 0 的有限数字或 -1（无限等待），实际: ${timeout}`, `${base}.timeout`))
    }
  }

  const onTimeout = policy.on_timeout
  if (onTimeout !== undefined) {
    if (!isJsonArray(onTimeout)) {
      issues.push(problem('RULE_POLICY_ON_TIMEOUT_TYPE', 'block',
        'on_timeout 需要数组（元素 = 动作对象）', `${base}.on_timeout`))
    } else {
      const timeoutActive = isFiniteNumber(timeout) ? timeout > 0 : POLICY_DEFAULTS.timeout > 0
      if (!timeoutActive && onTimeout.length > 0) {
        issues.push(problem('RULE_POLICY_ON_TIMEOUT_IDLE', 'warn',
          '未配置正的等待上限（timeout=-1 = 无限等待），超时动作不会执行；已有内容保留为只读',
          `${base}.on_timeout`))
      }
      issues.push(...validateActions(onTimeout, { refs, timedOut: true, basePath: `${base}.on_timeout` }))
    }
  }

  // dwell=0 仍是驻留模式：只提示，不自动改写为 enter。
  if (policy.mode === 'dwell' && isFiniteNumber(policy.dwell) && policy.dwell === 0) {
    issues.push(problem('RULE_POLICY_DWELL_ZERO', 'info',
      'mode=dwell 且驻留 0 秒：仍是驻留模式，实际等同立即触发；不会自动改为 enter', `${base}.dwell`))
  }

  return issues
}

function checkNonNegative(
  policy: JsonObject,
  key: 'cooldown' | 'dwell',
  base: string,
  issues: BehaviorProblem[],
): void {
  const value = policy[key]
  if (value === undefined) return
  if (!isFiniteNumber(value) || value < 0) {
    issues.push(problem(key === 'cooldown' ? 'RULE_POLICY_COOLDOWN' : 'RULE_POLICY_DWELL', 'error',
      `${key} 需要 >= 0 的有限数字（秒），实际: ${describe(value)}`, `${base}.${key}`))
  }
}

// ── 规则定义校验 ──────────────────────────────────────────────────────────────

/**
 * 校验单条规则定义：四键白名单 + 身份 + 条件树 + 动作数组 + 策略。
 * 条件 / 动作的深层校验委托给 {@link validateRuleCondition} / {@link validateActions}。
 */
export function validateRuleDefinition(
  rule: JsonValue,
  index: number,
  refs: BehaviorRefs,
): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const base = `rules[${index}]`

  if (!isJsonObject(rule)) {
    issues.push(problem('RULE_TYPE', 'block', '需要对象（规则定义）', base))
    return issues
  }

  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.includes(key)) {
      issues.push(problem('RULE_UNKNOWN_KEY', 'block',
        `未知键（可用: ${RULE_KEYS.join(' / ')}）`, `${base}.${key}`))
    }
  }

  validateRuleId(rule, base, issues)

  const condition = rule.condition
  if (!isJsonObject(condition)) {
    issues.push(problem('RULE_CONDITION_TYPE', 'block',
      'condition 缺失或不是对象（条件树必填）', `${base}.condition`))
  } else if (Object.keys(condition).length === 0) {
    issues.push(problem('RULE_CONDITION_EMPTY', 'block',
      'condition 为空对象：按永不满足处理；请补条件类型与字段', `${base}.condition`))
  } else {
    issues.push(...validateRuleCondition(condition, { refs, basePath: `${base}.condition` }))
  }

  const actions = rule.actions
  if (!isJsonArray(actions)) {
    issues.push(problem('RULE_ACTIONS_TYPE', 'block',
      'actions 缺失或不是数组（规则至少一个动作）', `${base}.actions`))
  } else if (actions.length === 0) {
    issues.push(problem('RULE_ACTIONS_EMPTY', 'block',
      'actions 为空（规则至少一个动作）', `${base}.actions`))
  } else {
    issues.push(...validateActions(actions, { refs, timedOut: false, basePath: `${base}.actions` }))
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'policy')) {
    issues.push(...validatePolicy(rule.policy, refs).map((problemItem) => ({
      ...problemItem,
      jsonPath: problemItem.jsonPath === 'policy'
        ? `${base}.policy`
        : `${base}.policy.${problemItem.jsonPath.replace(/^policy\./, '')}`,
    })))
  }

  return issues
}

/** 规则 id：存在 / 非空字符串 / 合法字符集（重复由集合级校验报告）。 */
function validateRuleId(rule: JsonObject, base: string, issues: BehaviorProblem[]): void {
  const id = rule.id
  if (id === undefined) {
    issues.push(problem('RULE_ID_MISSING', 'block', '规则 id 缺失（必填且脚本内唯一）', `${base}.id`))
    return
  }
  if (typeof id !== 'string' || id.length === 0) {
    issues.push(problem('RULE_ID_TYPE', 'block', '规则 id 需要非空字符串', `${base}.id`))
    return
  }
  if (!RULE_ID_PATTERN.test(id)) {
    issues.push(problem('RULE_ID_PATTERN', 'block',
      `规则 id 必须匹配 ${RULE_ID_PATTERN.source}，实际: ${id}`, `${base}.id`))
  }
}

/** 收集根上全部规则定义（非数组时返回空列表；调用方另判数组形态）。 */
export function rulesOfRoot(root: JsonObject): JsonObject[] {
  const rules = root.rules
  if (!isJsonArray(rules)) return []
  return rules.filter(isJsonObject)
}

/** 集合级校验：规则表形态 + id 查重 + 逐条 {@link validateRuleDefinition}。 */
export function validateRules(root: JsonObject, refs: BehaviorRefs): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const rules = root.rules

  if (rules !== undefined && !isJsonArray(rules)) {
    issues.push(problem('RULES_ARRAY', 'block', 'rules 需要数组（规则定义表）', 'rules'))
    return issues
  }
  if (!isJsonArray(rules)) return issues

  const seenIds = new Set<string>()
  rules.forEach((entry, index) => {
    const base = `rules[${index}]`
    if (!isJsonObject(entry)) {
      issues.push(problem('RULE_TYPE', 'block', '需要对象（规则定义）', base))
      return
    }
    const id = entry.id
    if (typeof id === 'string' && id.length > 0 && RULE_ID_PATTERN.test(id)) {
      if (seenIds.has(id)) {
        issues.push(problem('RULE_ID_DUPLICATE', 'block', `重复的规则 id: ${id}`, `${base}.id`))
      } else {
        seenIds.add(id)
      }
    }
    issues.push(...validateRuleDefinition(entry, index, refs))
  })

  // 全脚本 pause / resume 配对诊断（动作域，规则集合级入口顺带汇总）。
  issues.push(...validatePauseResumePairing(root))

  return issues
}

// ── 绑定引用与删除保护 ────────────────────────────────────────────────────────

/** 引用某条规则的全部绑定（只读列表；顺序 = 文档声明顺序）。 */
export function bindingsOfRule(root: JsonObject, ruleId: string): JsonObject[] {
  const bindings = root.rule_bindings
  if (!isJsonArray(bindings)) return []
  return bindings.filter(
    (entry): entry is JsonObject => isJsonObject(entry) && entry.rule === ruleId,
  )
}

// ── 新建 / 复制 ───────────────────────────────────────────────────────────────

/** 新建规则骨架：给定 id，条件与动作留空（空条件 / 空动作在应用时报错，需引导补全）。 */
export function createDefaultRule(id: string): JsonObject {
  return {
    id,
    condition: {},
    actions: [],
    policy: policyDefaults(),
  }
}

/**
 * 复制规则定义：只复制 `id / condition / actions / policy`，不复制绑定
 * （绑定是「规则 × 片段」的关系，副本与原规则完全独立）。副本 id 由调用方生成。
 */
export function duplicateRule(rule: JsonObject, newId: string): JsonObject {
  const copy = createDefaultRule(newId)
  if (isJsonObject(rule.condition)) copy.condition = cloneJson(rule.condition)
  if (isJsonArray(rule.actions)) copy.actions = cloneJson(rule.actions)
  if (isJsonObject(rule.policy)) copy.policy = cloneJson(rule.policy)
  return copy
}

// ── 事务性重命名 ─────────────────────────────────────────────────────────────

/**
 * 事务性重命名规则 id：一次性改规则自身与全部 `rule_bindings[].rule` 引用。
 *
 * - 返回新根（深拷贝），不改入参；
 * - `from` 不存在、`to` 非法、`to` 被另一条规则占用 → 整体抛错，不产生部分写入；
 * - `to === from`：返回内容等价的新根，不报错。
 */
export function renameRuleId(root: JsonObject, from: string, to: string): JsonObject {
  if (typeof from !== 'string' || from.length === 0) {
    throw new Error('renameRuleId: 原规则 id 缺失或不是非空字符串')
  }
  if (typeof to !== 'string' || to.length === 0) {
    throw new Error('renameRuleId: 新规则 id 缺失或不是非空字符串')
  }
  if (!RULE_ID_PATTERN.test(to)) {
    throw new Error(`renameRuleId: 新规则 id 不合法（${RULE_ID_PATTERN.source}）: ${to}`)
  }

  const next = cloneJson(root)
  const rules = next.rules
  if (!isJsonArray(rules)) {
    throw new Error(`renameRuleId: 规则表不存在或不是数组（未找到规则 ${from}）`)
  }

  let found = false
  for (const entry of rules) {
    if (!isJsonObject(entry)) continue
    if (entry.id === from) {
      found = true
      entry.id = to
    } else if (entry.id === to) {
      throw new Error(`renameRuleId: 新规则 id 已被占用: ${to}`)
    }
  }
  if (!found) {
    throw new Error(`renameRuleId: 未找到规则 ${from}`)
  }

  const bindings = next.rule_bindings
  if (isJsonArray(bindings)) {
    for (const entry of bindings) {
      if (isJsonObject(entry) && entry.rule === from) {
        entry.rule = to
      }
    }
  }

  return next
}

// ── 列表行摘要 ────────────────────────────────────────────────────────────────

/** 规则动作条数（非数组按 0）。 */
export function ruleActionCount(rule: JsonObject): number {
  return isJsonArray(rule.actions) ? rule.actions.length : 0
}

/** 规则列表行摘要段：id · 动作数 · 单次/可重复 · 模式 · 有无超时 · 绑定数（未绑定）。 */
export function describeRuleRow(rule: JsonObject, bindingCount: number): string {
  const id = typeof rule.id === 'string' && rule.id.length > 0 ? rule.id : '未命名规则'
  const parts: string[] = [id]
  parts.push(`${ruleActionCount(rule)} 个动作`)
  parts.push(policyOnce(rule) ? '单次' : '可重复')
  parts.push(policyMode(rule) === 'dwell' ? `驻留 ${policyDwell(rule)}s` : '进入')
  parts.push(policyHasTimeout(rule) ? `超时 ${policyTimeout(rule)}s` : '无限等待')
  parts.push(bindingCount > 0 ? `${bindingCount} 条绑定` : '未绑定')
  return parts.join(' · ')
}
