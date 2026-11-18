/**
 * 11 轮行为意图层：意图 → `DocCommand` 的纯映射。
 *
 * 约束（与命令层分工一致）：
 * - 不持文档、不落盘、不碰会话；只产出命令对象与只读引用查询；
 * - UI / 面板只调这里的工厂函数，不自己拼命令字面量；
 * - 命令的试算、事务重命名、引用保护与撤销语义由 `core/doc/commands.ts` 保证。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { bindingsOfRule } from './rules.ts'
import { referencesToBinding } from './bindings.ts'
import type { BindingReference } from './bindings.ts'

// ── 规则分字段补丁 ────────────────────────────────────────────────────────────

/** `rule.setFields` 的显式分字段补丁；未给的键保持不动。 */
export interface RuleFieldsPatch {
  policy?: JsonObject
  condition?: JsonObject
  actions?: JsonObject[]
  /** 写入 `policy.on_timeout`；`null` 表示删除该键。 */
  onTimeout?: JsonValue
}

/** `binding.setFields` 的显式分字段补丁；`null` 表示省略该键。 */
export interface BindingFieldsPatch {
  gate?: JsonObject | null
  control?: string | null
  schedule?: JsonObject | null
  exit?: JsonObject | null
}

// ── 触发器意图 ────────────────────────────────────────────────────────────────

/** 在 `index` 处插入触发器；`fields` 含 `type` / 初始字段（`id` 可选）。 */
export function triggerAddIntent(index: number, fields: JsonObject): DocCommand {
  return { kind: 'trigger.add', index, fields }
}

/** 按身份（先 id 后 `type#index`）删除触发器。 */
export function triggerRemoveIntent(triggerIdentity: string): DocCommand {
  return { kind: 'trigger.remove', triggerIdentity }
}

/** 触发器在声明表内移动位置。 */
export function triggerMoveIntent(from: number, to: number): DocCommand {
  return { kind: 'trigger.move', from, to }
}

/**
 * 重命名触发器 id；重复 id 由命令层拒绝。
 * `value === ''` 表示清空 id：删除 `id` 键（不写空串/null），身份回落 `type#index`。
 */
export function triggerSetIdIntent(triggerIdentity: string, value: string): DocCommand {
  return { kind: 'trigger.setId', triggerIdentity, value }
}

/**
 * 切换触发器类型；旧条件原样保留（不适用键由结构层判）。
 * `clearInapplicable` 为点名清理名单，只有调用方点名才删。
 */
export function triggerSetTypeIntent(
  triggerIdentity: string,
  value: string,
  clearInapplicable?: string[],
): DocCommand {
  return { kind: 'trigger.setType', triggerIdentity, value, clearInapplicable }
}

// ── 规则意图 ────────────────────────────────────────────────────────────────────

/** 在 `index` 处新建规则；条件 / 动作 / 策略可由调用方给初始值。 */
export function ruleAddIntent(
  index: number,
  id: string,
  opts: { condition?: JsonObject; actions?: JsonObject[]; policy?: JsonObject } = {},
): DocCommand {
  return {
    kind: 'rule.add',
    index,
    id,
    ...(opts.condition === undefined ? {} : { condition: opts.condition }),
    ...(opts.actions === undefined ? {} : { actions: opts.actions }),
    ...(opts.policy === undefined ? {} : { policy: opts.policy }),
  }
}

/** 删除规则；被绑定引用时由命令层拒绝并给出受影响清单。 */
export function ruleRemoveIntent(ruleId: string): DocCommand {
  return { kind: 'rule.remove', ruleId }
}

/** 规则在规则表内移动位置。 */
export function ruleMoveIntent(from: number, to: number): DocCommand {
  return { kind: 'rule.move', from, to }
}

/** 事务重命名规则 id：一次改规则自身与全部 `rule_bindings[].rule` 引用。 */
export function ruleSetIdIntent(ruleId: string, value: string): DocCommand {
  return { kind: 'rule.setId', ruleId, value }
}

/** 分字段写规则；未给的键不动。 */
export function ruleSetFieldsIntent(ruleId: string, patch: RuleFieldsPatch): DocCommand {
  return {
    kind: 'rule.setFields',
    ruleId,
    ...(patch.policy === undefined ? {} : { policy: patch.policy }),
    ...(patch.condition === undefined ? {} : { condition: patch.condition }),
    ...(patch.actions === undefined ? {} : { actions: patch.actions }),
    ...(patch.onTimeout === undefined ? {} : { onTimeout: patch.onTimeout }),
  }
}

/** 整体替换规则条件树。 */
export function ruleSetConditionIntent(ruleId: string, condition: JsonObject): DocCommand {
  return { kind: 'rule.setCondition', ruleId, condition }
}

/** 整体替换规则动作列表。 */
export function ruleSetActionsIntent(ruleId: string, actions: JsonObject[]): DocCommand {
  return { kind: 'rule.setActions', ruleId, actions }
}

// ── 绑定意图 ────────────────────────────────────────────────────────────────────

/** 在 `index` 处新建绑定。 */
export function bindingAddIntent(index: number, binding: JsonObject): DocCommand {
  return { kind: 'binding.add', index, binding }
}

/** 事务重命名绑定 id：一次改绑定自身、`schedule.fact.binding` 与所有规则条件树 `rule_fact.binding`。 */
export function bindingSetIdIntent(bindingId: string, value: string): DocCommand {
  return { kind: 'binding.setId', bindingId, value }
}

/** 分字段写绑定；`null` 表示省略该键。 */
export function bindingSetFieldsIntent(bindingId: string, patch: BindingFieldsPatch): DocCommand {
  return {
    kind: 'binding.setFields',
    bindingId,
    ...(patch.gate === undefined ? {} : { gate: patch.gate }),
    ...(patch.control === undefined ? {} : { control: patch.control }),
    ...(patch.schedule === undefined ? {} : { schedule: patch.schedule }),
    ...(patch.exit === undefined ? {} : { exit: patch.exit }),
  }
}

/** 绑定在绑定表内移动位置。 */
export function bindingMoveIntent(from: number, to: number): DocCommand {
  return { kind: 'binding.move', from, to }
}

// ── 删除前引用影响查询（只读；不落盘）────────────────────────────────────────────

/** 引用某条规则的全部绑定（文档声明顺序）；删除规则前先查。 */
export function referrersOfRule(root: JsonObject, ruleId: string): JsonObject[] {
  return bindingsOfRule(root, ruleId)
}

/** 某条规则是否仍被绑定引用。 */
export function ruleIsReferenced(root: JsonObject, ruleId: string): boolean {
  return referrersOfRule(root, ruleId).length > 0
}

/** 引用某绑定的全部位置（fact 调度 + 规则条件树 `rule_fact`）；删除绑定前先查。 */
export function referrersOfBinding(root: JsonObject, bindingId: string): BindingReference[] {
  return referencesToBinding(root, bindingId)
}

/** 某绑定是否仍被条件 / 调度引用。 */
export function bindingIsReferenced(root: JsonObject, bindingId: string): boolean {
  return referrersOfBinding(root, bindingId).length > 0
}
