/**
 * 11 轮行为面板（触发器 / 规则 / 绑定 / 事件 / 事实）跨模块共享的窄类型。
 *
 * 定位：只放"多个域都要用、且不依赖任何一方领域事实"的形状，避免各域各造一套问题类型与记录身份。
 * 领域事实（字段表、取值、适用范围）一律来自 `src/core/schema/catalog/behavior*.ts`（带模组 Java 出处），
 * 此处**不复制**任何字段表。
 */

import type { JsonObject, LocalProblem, Severity } from '../../core/doc/types.ts'

export type { JsonObject, Severity }

/**
 * 一条行为域问题：沿用本地结构检查的形状（`code` / `severity` / `message` / `jsonPath`），
 * 另加"属于哪条记录、哪个片段"，供面板把问题挂到树节点。
 *
 * `severity` 取值与 `LocalProblem` 一致（`block` / `error` / `warn` / `info`，见 03-06）；
 * 11-15 的三级呈现（error / warn / info）由面板按 `block → error` 折叠，装配层不重复判级。
 */
export interface BehaviorProblem extends LocalProblem {
  /** 归属片段键（`timeline.tracks[<i>].clips[<j>]`）；脚本级问题（rules / rule_bindings）不填。 */
  clipKey?: string
  /** 归属记录身份；树节点据此标红。 */
  ref?: RecordRef
}

/**
 * 稳定记录身份（11-01：面板选择按记录身份，不按下标；文档变化致目标消失时回落总览）。
 *
 * - 触发器：显式 `id` 优先，否则 `type#声明下标`（11-02）；
 * - 规则 / 绑定：文档 `id`；
 * - 事件记录：片段键 + 轨道类型 + 记录键（记录自身 `id` 不是稳定键，11-12 说明运行时忽略）；
 * - 事实：事实名字（`script_played` / `clip_fact:<片段>` 这类可引用名）。
 */
export type RecordRef =
  | { kind: 'trigger'; identity: string }
  | { kind: 'rule'; id: string }
  | { kind: 'binding'; id: string }
  | { kind: 'event'; clipKey: string; trackType: 'EVENT'; key: string }
  | { kind: 'event'; clipKey: string; trackType: 'MOD_EVENT'; key: string }
  | { kind: 'fact'; name: string }

/** 记录身份的字符串键（会话态集合、Vue `:key`、日志用）。 */
export function recordRefKey(ref: RecordRef): string {
  switch (ref.kind) {
    case 'trigger':
      return `trigger:${ref.identity}`
    case 'rule':
      return `rule:${ref.id}`
    case 'binding':
      return `binding:${ref.id}`
    case 'event':
      return `event:${ref.clipKey}:${ref.trackType}:${ref.key}`
    case 'fact':
      return `fact:${ref.name}`
  }
}

/** 两个引用是否同一记录。 */
export function sameRecordRef(left: RecordRef, right: RecordRef): boolean {
  return recordRefKey(left) === recordRefKey(right)
}

/** 严重度排序：数值越大越严重（面板取"最高问题级别"用）。 */
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2, block: 3 }

/** 一组问题里的最高级别；空列表返回 `null`（列表行据此决定是否画问题徽标）。 */
export function highestSeverity(problems: readonly BehaviorProblem[]): Severity | null {
  let highest: Severity | null = null
  for (const problem of problems) {
    if (highest === null || SEVERITY_RANK[problem.severity] > SEVERITY_RANK[highest]) highest = problem.severity
  }
  return highest
}

/**
 * 模组 Java 出处：字段、行号必须真实可查（任务书"严格溯源"）。
 * `file` 相对主模组仓库根（`E:\Documents\GitHub\ImmersiveCinematics`），`line` 是 1 起的行号。
 */
export interface SourceRef {
  file: string
  line: number
  /** 该处的 Java 符号名（类 / 方法 / 常量），便于二次核对。 */
  symbol?: string
}

/** 记录引用的目标脚本（规则 / 绑定 / 事件都属于某个脚本文档）。 */
export interface ScriptTargetRef {
  path: string
  stamp: string
}
