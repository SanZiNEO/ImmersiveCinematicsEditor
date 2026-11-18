/**
 * 行为域字段目录的聚合入口（11-02…11-14）。
 *
 * 三条链的目录各自成文件、各自带模组 Java 出处：
 * - `behaviorTriggers.ts`：27 种触发器类型、时序适用性、组合器/区域形态、三种内置前置；
 * - `behaviorRules.ts`：12 种规则条件、9 种动作、policy 六字段、5 调度 / 5 出口 / 2 控制；
 * - `behaviorEvents.ts`：EVENT 与 MOD_EVENT 记录体、位置形态、运行时语义出处。
 *
 * 用命名空间再导出（而不是平铺），是因为三份目录存在同名概念
 * （`SourceRef` / `CatalogSourceRef`、`CLIP_FACT_NAMES`），平铺会互相覆盖。
 */

export * as triggers from './behaviorTriggers.ts'
export * as rules from './behaviorRules.ts'
export * as events from './behaviorEvents.ts'

/** 目录文件清单：验收据此断言三份目录都在、且都带出处。 */
export const BEHAVIOR_CATALOG_FILES = [
  'src/core/schema/catalog/behaviorTriggers.ts',
  'src/core/schema/catalog/behaviorRules.ts',
  'src/core/schema/catalog/behaviorEvents.ts',
] as const
