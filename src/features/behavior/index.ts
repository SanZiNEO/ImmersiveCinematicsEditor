/**
 * 行为域纯函数层的聚合入口（11-01…11-15）。
 *
 * 面板与验收只从这里取，避免各自记住十几个文件名。用命名空间再导出，
 * 因为域与域之间存在同名概念（`legacyConditionKeys` 在触发器与规则条件各有一份）。
 */

export * from './shared.ts'

export * as trigger from './trigger.ts'
export * as triggerConditions from './triggerConditions.ts'
export * as requirements from './requirements.ts'
export * as rules from './rules.ts'
export * as ruleConditions from './ruleConditions.ts'
export * as actions from './actions.ts'
export * as bindings from './bindings.ts'
export * as events from './events.ts'
export * as facts from './facts.ts'
export * as validation from './validation.ts'
export * as summary from './summary.ts'

/** 纯函数层文件清单：验收据此断言各域都在。 */
export const BEHAVIOR_MODULES = [
  'shared.ts',
  'trigger.ts',
  'triggerConditions.ts',
  'requirements.ts',
  'rules.ts',
  'ruleConditions.ts',
  'actions.ts',
  'bindings.ts',
  'events.ts',
  'facts.ts',
  'validation.ts',
  'summary.ts',
] as const
