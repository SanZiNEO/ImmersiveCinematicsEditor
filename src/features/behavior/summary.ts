/**
 * 行为域摘要的**唯一入口**（11-01 "同一份记录只有这一个详情编辑器"、11-02/11-04 "摘要一处生成、三处共用"）。
 *
 * 关系：
 * - 每种记录的文案实现分别住在各自模块（触发器 `trigger.ts` / 条件树 `triggerConditions.ts`、
 *   规则 `rules.ts` / 规则条件 `ruleConditions.ts`、动作 `actions.ts`、绑定 `bindings.ts`、事件 `events.ts`）——
 *   那里是**生成处**，负责字段语义与中文措辞；
 * - 本文件是**取用处**：列表行、详情面板、脚本图悬停卡一律只从这里取摘要，
 *   因此"同一份记录在三个地方长得一样"由类型系统保证，而不是靠人肉对齐。
 *
 * 本文件不新造任何文案、不读文档、不做校验；只做分发。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'

import type { ActionContext } from './actions.ts'
import { describeAction } from './actions.ts'
import type { BindingContext } from './bindings.ts'
import { describeBinding } from './bindings.ts'
import type { ClipEventContext, EventRecordNode } from './events.ts'
import { describeEventRecord } from './events.ts'
import type { ConditionContext } from './ruleConditions.ts'
import { describeRuleCondition } from './ruleConditions.ts'
import { describeRuleRow } from './rules.ts'
import type { ConditionValidationContext, TriggerConditionNode, TriggerNode } from './trigger.types.ts'
import { describeTrigger } from './trigger.ts'
import { describeTriggerCondition } from './triggerConditions.ts'

/** 摘要种类：面板树、详情、悬停卡都只用这 7 种。 */
export type SummaryKind =
  | 'trigger'
  | 'trigger-condition'
  | 'rule'
  | 'rule-condition'
  | 'action'
  | 'binding'
  | 'event'

/**
 * 一次摘要请求。判别联合而非 `(value, ctx)` 泛型，是为了让"哪种记录配哪种上下文"
 * 在编译期就固定，避免把规则条件上下文喂给触发器条件。
 */
export type SummaryInput =
  | { kind: 'trigger'; node: TriggerNode; index?: number }
  | {
      kind: 'trigger-condition'
      /** 条件节点：`describeTriggerCondition` 只读 `type` 与 `conditions`（`raw` 供编辑态用）。 */
      node: Pick<TriggerConditionNode, 'type' | 'conditions'>
      ctx?: ConditionValidationContext
    }
  | { kind: 'rule'; rule: JsonObject; bindingCount: number }
  | { kind: 'rule-condition'; node: JsonValue; ctx?: ConditionContext }
  | { kind: 'action'; action: JsonValue; ctx?: ActionContext }
  | { kind: 'binding'; binding: JsonValue; ctx?: BindingContext }
  | { kind: 'event'; node: EventRecordNode; ctx?: ClipEventContext }

/** 取一条摘要文案。 */
export function describeSummary(input: SummaryInput): string {
  switch (input.kind) {
    case 'trigger':
      return describeTrigger(input.node, input.index)
    case 'trigger-condition':
      return describeTriggerCondition(input.node, input.ctx)
    case 'rule':
      return describeRuleRow(input.rule, input.bindingCount)
    case 'rule-condition':
      return describeRuleCondition(input.node, input.ctx)
    case 'action':
      return describeAction(input.action, input.ctx)
    case 'binding':
      return describeBinding(input.binding, input.ctx)
    case 'event':
      return describeEventRecord(input.node, input.ctx)
  }
}

/** 摘要生成处的登记表：验收据此断言"同一记录只有一处生成"，不靠注释。 */
export interface SummaryEntry {
  kind: SummaryKind
  /** 生成所在的模块（相对 `src/features/behavior/`）。 */
  module: string
  /** 生成函数名。 */
  fn: string
  /** 对应的设计条目。 */
  doc: string
}

export const SUMMARY_ENTRY: readonly SummaryEntry[] = [
  { kind: 'trigger', module: 'trigger.ts', fn: 'describeTrigger', doc: '11-02' },
  { kind: 'trigger-condition', module: 'triggerConditions.ts', fn: 'describeTriggerCondition', doc: '11-04' },
  { kind: 'rule', module: 'rules.ts', fn: 'describeRuleRow', doc: '11-06' },
  { kind: 'rule-condition', module: 'ruleConditions.ts', fn: 'describeRuleCondition', doc: '11-07' },
  { kind: 'action', module: 'actions.ts', fn: 'describeAction', doc: '11-08' },
  { kind: 'binding', module: 'bindings.ts', fn: 'describeBinding', doc: '11-09' },
  { kind: 'event', module: 'events.ts', fn: 'describeEventRecord', doc: '11-12' },
]

/** 已登记的摘要种类集合（大小写无关检查用）。 */
export function isSummaryKind(value: string): value is SummaryKind {
  return SUMMARY_ENTRY.some((entry) => entry.kind === value)
}

export {
  describeAction,
  describeBinding,
  describeEventRecord,
  describeRuleCondition,
  describeRuleRow,
  describeTrigger,
  describeTriggerCondition,
}
