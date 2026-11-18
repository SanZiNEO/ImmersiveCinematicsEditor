/**
 * 11 轮触发器域纯函数：身份、缺省与旧字段保留、时序适用性与就地报错、时序换算、
 * 「触发后」只读卡文案。不写 Vue / UI / 命令层。
 *
 * 口径（与主模组 Java 对齐）：
 * - 身份：显式 `id` 优先；未写时合成 `type#声明下标`（`TriggerDefinition.getIdentity()`）；
 * - 缺省不回写文档：面板读取时给缺省投影，落盘仍以 `raw` 为准；
 * - 旧条件 / 不适用键：切类型不静默丢弃，未登记键进「旧字段只读块」；
 * - 数值越界 / 非整数 / 非数字一律就地报错，不夹取、不静默修正；
 * - 未知类型按未知键保留口径，原文只读。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { isJsonObject, isFiniteNumber, describe } from '../../core/doc/json.ts'
import type { BehaviorProblem } from './shared.ts'
import {
  TRIGGER_TYPES,
  triggerTypeInfo,
  CONTINUITY_MAX_TICKS,
  TRIGGER_POLL_INTERVAL_MIN,
  TRIGGER_POLL_INTERVAL_MAX,
} from '../../core/schema/catalog/behaviorTriggers.ts'
import type {
  ContinuityView,
  RequirementEntry,
  TriggerNode,
  TriggerTimingView,
} from './trigger.types.ts'
import { describeTriggerCondition } from './triggerConditions.ts'
import { requirementEntries } from './requirements.ts'

// ── 身份 ────────────────────────────────────────────────────────────────────

/** 触发器声明 id 合法形式：1~64 位字母 / 数字 / 下划线（与 `TriggerDefinition.ID_REGEX` 同口径）。 */
export const TRIGGER_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/

function isTriggerNode(node: TriggerNode | JsonObject): node is TriggerNode {
  return typeof node === 'object' && node !== null && 'raw' in node
}

function rawOf(node: TriggerNode | JsonObject): JsonObject {
  const raw: JsonObject = isTriggerNode(node) ? node.raw : node
  return raw
}

/** 是否带显式声明 id（非空字符串）。 */
export function triggerHasExplicitId(node: TriggerNode | JsonObject): boolean {
  const id = rawOf(node).id
  return typeof id === 'string' && id.length > 0
}

/**
 * 触发器脚本内唯一身份：显式 `id` 优先；未写时 `type#声明下标`。
 * 下标缺省取节点自带的 `index`（与 Java `getIdentity()` 一致）。
 */
export function triggerIdentity(node: TriggerNode, index?: number): string {
  if (triggerHasExplicitId(node)) {
    return String(rawOf(node).id)
  }
  const type = node.type || 'unknown'
  const declarationIndex = index ?? node.index
  return `${type}#${declarationIndex}`
}

/** 重复 id 判定：返回 `id → 出现的声明下标列表`（仅含出现 ≥2 次的显式 id）。 */
export function findDuplicateIds(nodes: readonly TriggerNode[]): Map<string, number[]> {
  const seen = new Map<string, number[]>()
  for (const node of nodes) {
    if (!triggerHasExplicitId(node)) continue
    const id = String((node.raw as JsonObject).id)
    const list = seen.get(id)
    if (list === undefined) {
      seen.set(id, [node.index])
    } else {
      list.push(node.index)
    }
  }
  const duplicates = new Map<string, number[]>()
  for (const [id, list] of seen) {
    if (list.length >= 2) duplicates.set(id, list)
  }
  return duplicates
}

// ── 读取模型装配 ────────────────────────────────────────────────────────────

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseContinuity(raw: JsonObject | undefined): ContinuityView {
  if (raw === undefined) {
    return { sweep: undefined, dwellTicks: undefined, windowTicks: undefined }
  }
  const sweep = typeof raw.sweep === 'boolean' ? raw.sweep : undefined
  const dwellTicks = isFiniteNumber(raw.dwell) ? raw.dwell : undefined
  const windowTicks = isFiniteNumber(raw.window) ? raw.window : undefined
  return { sweep, dwellTicks, windowTicks }
}

function parseTiming(raw: JsonObject): TriggerTimingView {
  const continuityRaw = isJsonObject(raw.continuity) ? raw.continuity : undefined
  return {
    delaySeconds: isFiniteNumber(raw.delay) ? raw.delay : undefined,
    repeatable: raw.repeatable === true,
    onEnter: raw.on_enter === true,
    exitBuffer: isFiniteNumber(raw.exit_buffer) ? raw.exit_buffer : undefined,
    pollInterval: isFiniteNumber(raw.poll_interval) ? raw.poll_interval : undefined,
    continuity: parseContinuity(continuityRaw),
  }
}

/**
 * 把一条 `meta.triggers[]` 原始声明装配成读取模型。
 * 未知键 / 未登记字段原样留在 `raw` 与 `conditions` 上，不裁剪。
 */
export function parseTriggerNode(raw: JsonObject, index: number): TriggerNode {
  const type = readString(raw.type) ?? ''
  const conditions = isJsonObject(raw.conditions) ? raw.conditions : {}
  return {
    raw,
    index,
    type,
    explicitId: readString(raw.id),
    conditions,
    timing: parseTiming(raw),
    requires: requirementEntries(raw),
    info: triggerTypeInfo(type),
  }
}

// ── 缺省 / 旧字段 ────────────────────────────────────────────────────────────

/** 新建触发器的时序缺省投影（不落盘；面板初始值用）。 */
export function applyTimingDefaults(info: TriggerNode['info']): TriggerTimingView {
  void info
  return {
    delaySeconds: 0,
    repeatable: false,
    onEnter: false,
    exitBuffer: undefined,
    pollInterval: undefined,
    continuity: { sweep: undefined, dwellTicks: undefined, windowTicks: undefined },
  }
}

/**
 * continuity 是否可整体省略：sweep 非 true、dwell / window 均为未写或 0。
 * （`ContinuitySpec.DEFAULT` = 关闭，走旧点判定路径。）
 */
export function isContinuityOmittable(continuity: ContinuityView): boolean {
  const dwellEmpty = continuity.dwellTicks === undefined || continuity.dwellTicks === 0
  const windowEmpty = continuity.windowTicks === undefined || continuity.windowTicks === 0
  return continuity.sweep !== true && dwellEmpty && windowEmpty
}

/**
 * 条件对象里未在目录登记的键（旧字段只读块用）。
 * 未知类型（`info` 缺失）下全部条件键都视为未登记，原文只读。
 */
export function legacyConditionKeys(node: TriggerNode): string[] {
  const registered = new Set((node.info?.fields ?? []).map((field) => field.key))
  return Object.keys(node.conditions).filter((key) => !registered.has(key))
}

/**
 * 时序顶层键里对该类型不适用的键（旧字段只读块用）。
 * 只看适用性，不判类型 / 取值合法性（合法性由 `triggerTimingIssues` 报）。
 */
export function unsupportedTimingKeys(raw: JsonObject, info: TriggerNode['info']): string[] {
  if (info === undefined) return []
  const unsupported: string[] = []
  if (raw.poll_interval !== undefined && !info.timing.pollInterval) unsupported.push('poll_interval')
  if (raw.on_enter !== undefined && !info.timing.onEnter) unsupported.push('on_enter')
  if (raw.exit_buffer !== undefined && !info.timing.exitBuffer) unsupported.push('exit_buffer')
  if (raw.continuity !== undefined && !info.timing.dwell && !info.timing.window && !info.timing.sweep) {
    unsupported.push('continuity')
  }
  return unsupported
}

// ── 时序适用性与就地报错 ─────────────────────────────────────────────────────

function problem(
  code: string,
  severity: BehaviorProblem['severity'],
  message: string,
  jsonPath: string,
): BehaviorProblem {
  return { code, severity, message, jsonPath }
}

function isWholeNumber(value: number): boolean {
  return Number.isFinite(value) && Math.floor(value) === value
}

/**
 * 时序字段校验：适用性（写了不生效）+ 类型 / 整数 / 范围合法性。
 * 非法值只报错，不夹取、不静默改写；原始值仍在 `raw` 上。
 */
export function triggerTimingIssues(node: TriggerNode): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const info = node.info
  const base = `meta.triggers[${node.index}]`
  const raw = node.raw

  // repeatable：布尔
  if (raw.repeatable !== undefined && typeof raw.repeatable !== 'boolean') {
    issues.push(problem('TRIGGER_REPEATABLE_TYPE', 'error', `repeatable 需要布尔值，实际: ${describe(raw.repeatable)}`, `${base}.repeatable`))
  }

  // delay：数字（秒；0 = 立即）
  if (raw.delay !== undefined && !isFiniteNumber(raw.delay)) {
    issues.push(problem('TRIGGER_DELAY_TYPE', 'error', `delay 需要数字（秒），实际: ${describe(raw.delay)}`, `${base}.delay`))
  }

  // on_enter 适用性 + 类型
  if (raw.on_enter !== undefined) {
    if (typeof raw.on_enter !== 'boolean') {
      issues.push(problem('TRIGGER_ON_ENTER_TYPE', 'error', `on_enter 需要布尔值，实际: ${describe(raw.on_enter)}`, `${base}.on_enter`))
    } else if (info !== undefined && !info.timing.onEnter) {
      issues.push(problem('TRIGGER_ON_ENTER_UNSUPPORTED', 'warn', `on_enter 对 ${info.label} 无效（事件驱动触发器没有进入/离开语义），将被忽略`, `${base}.on_enter`))
    }
  }

  // exit_buffer 适用性 + 类型
  if (raw.exit_buffer !== undefined) {
    if (!isFiniteNumber(raw.exit_buffer)) {
      issues.push(problem('TRIGGER_EXIT_BUFFER_TYPE', 'error', `exit_buffer 需要数字（格），实际: ${describe(raw.exit_buffer)}`, `${base}.exit_buffer`))
    } else if (info !== undefined && !info.timing.exitBuffer) {
      issues.push(problem('TRIGGER_EXIT_BUFFER_UNSUPPORTED', 'warn', `exit_buffer 对 ${info.label} 无效（没有可外扩的空间条件），将被忽略`, `${base}.exit_buffer`))
    }
  }

  // poll_interval：整数 1~600；事件驱动类型不参与轮询
  if (raw.poll_interval !== undefined) {
    const interval = raw.poll_interval
    if (!isFiniteNumber(interval)) {
      issues.push(problem('TRIGGER_POLL_INTERVAL_TYPE', 'error', `poll_interval 需要整数（tick，${TRIGGER_POLL_INTERVAL_MIN}~${TRIGGER_POLL_INTERVAL_MAX}），实际: ${describe(interval)}`, `${base}.poll_interval`))
    } else if (!isWholeNumber(interval)) {
      issues.push(problem('TRIGGER_POLL_INTERVAL_NOT_INT', 'error', `poll_interval 不是整数（tick，${TRIGGER_POLL_INTERVAL_MIN}~${TRIGGER_POLL_INTERVAL_MAX}），实际: ${describe(interval)}`, `${base}.poll_interval`))
    } else if (interval < TRIGGER_POLL_INTERVAL_MIN || interval > TRIGGER_POLL_INTERVAL_MAX) {
      issues.push(problem('TRIGGER_POLL_INTERVAL_RANGE', 'error', `poll_interval 超出范围 ${TRIGGER_POLL_INTERVAL_MIN}~${TRIGGER_POLL_INTERVAL_MAX}（tick），实际: ${interval}`, `${base}.poll_interval`))
    }
    if (info !== undefined && !info.timing.pollInterval) {
      issues.push(problem('TRIGGER_POLL_INTERVAL_UNSUPPORTED', 'warn', `poll_interval 对 ${info.label} 无效（事件驱动触发器不参与轮询），将被忽略`, `${base}.poll_interval`))
    }
  }

  // continuity：对象 + 子字段类型 / 范围 / 适用性
  if (raw.continuity !== undefined) {
    const cp = `${base}.continuity`
    if (!isJsonObject(raw.continuity)) {
      issues.push(problem('TRIGGER_CONTINUITY_TYPE', 'error', `continuity 必须是对象，实际: ${describe(raw.continuity)}`, cp))
    } else {
      const cont = raw.continuity
      if (cont.sweep !== undefined) {
        if (typeof cont.sweep !== 'boolean') {
          issues.push(problem('TRIGGER_SWEEP_TYPE', 'error', `continuity.sweep 需要布尔值，实际: ${describe(cont.sweep)}`, `${cp}.sweep`))
        } else if (info !== undefined && !info.timing.sweep) {
          issues.push(problem('TRIGGER_SWEEP_UNSUPPORTED', 'warn', `continuity.sweep 对 ${info.label} 无几何语义，将被忽略（仅 location / structure / facing / observation 支持段扫掠）`, `${cp}.sweep`))
        }
      }
      if (cont.dwell !== undefined) {
        const dwell = cont.dwell
        if (!isFiniteNumber(dwell)) {
          issues.push(problem('TRIGGER_DWELL_TYPE', 'error', `continuity.dwell 需要整数（tick，0~${CONTINUITY_MAX_TICKS}），实际: ${describe(dwell)}`, `${cp}.dwell`))
        } else if (!isWholeNumber(dwell)) {
          issues.push(problem('TRIGGER_DWELL_NOT_INT', 'error', `continuity.dwell 不是整数（tick，0~${CONTINUITY_MAX_TICKS}），实际: ${describe(dwell)}`, `${cp}.dwell`))
        } else if (dwell < 0 || dwell > CONTINUITY_MAX_TICKS) {
          issues.push(problem('TRIGGER_DWELL_RANGE', 'error', `continuity.dwell 超出范围 0~${CONTINUITY_MAX_TICKS}（tick），实际: ${dwell}`, `${cp}.dwell`))
        }
        if (info !== undefined && !info.timing.dwell) {
          issues.push(problem('TRIGGER_DWELL_UNSUPPORTED', 'warn', `continuity.dwell 对 ${info.label} 无效（事件驱动触发器不参与轮询，将被忽略）`, `${cp}.dwell`))
        }
      }
      if (cont.window !== undefined) {
        const windowTicks = cont.window
        if (!isFiniteNumber(windowTicks)) {
          issues.push(problem('TRIGGER_WINDOW_TYPE', 'error', `continuity.window 需要整数（tick，0~${CONTINUITY_MAX_TICKS}），实际: ${describe(windowTicks)}`, `${cp}.window`))
        } else if (!isWholeNumber(windowTicks)) {
          issues.push(problem('TRIGGER_WINDOW_NOT_INT', 'error', `continuity.window 不是整数（tick，0~${CONTINUITY_MAX_TICKS}），实际: ${describe(windowTicks)}`, `${cp}.window`))
        } else if (windowTicks < 0 || windowTicks > CONTINUITY_MAX_TICKS) {
          issues.push(problem('TRIGGER_WINDOW_RANGE', 'error', `continuity.window 超出范围 0~${CONTINUITY_MAX_TICKS}（tick），实际: ${windowTicks}`, `${cp}.window`))
        }
        if (info !== undefined && !info.timing.window) {
          issues.push(problem('TRIGGER_WINDOW_UNSUPPORTED', 'warn', `continuity.window 对 ${info.label} 无效（window 只对 all_of / any 的事件类子条件生效，将被忽略）`, `${cp}.window`))
        }
      }
    }
  }

  return issues
}

// ── 时序换算（tick ↔ 秒）────────────────────────────────────────────────────

/** Minecraft 每秒 tick 数（20 tps）。 */
export const TICKS_PER_SECOND = 20

/** tick → 秒（展示用；落盘仍是整数 tick）。 */
export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND
}

/** 秒 → 整数 tick（四舍五入；范围合法性由 `triggerTimingIssues` 报，这里不夹取）。 */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND)
}

// ── 列表行摘要（唯一生成处之一；条件摘要在 triggerConditions.ts）─────────────

/**
 * 列表行摘要：身份 · 类型标签 · 条件摘要。
 * 未知类型显示原文类型键，不编默认标签；空条件不补占位文案。
 */
export function describeTrigger(node: TriggerNode, index?: number): string {
  const identity = triggerIdentity(node, index)
  const label = node.info ? node.info.label : node.type ? `未知类型 ${node.type}` : '未声明类型'
  const conditionSummary = describeTriggerCondition(node)
  return conditionSummary ? `${identity} · ${label} · ${conditionSummary}` : `${identity} · ${label}`
}

// ── 面板固定文案（只读口径）───────────────────────────────────────────────────

/** 身份稳定性提示：身份随声明下标；改 id 不迁移已触发记录。 */
export const TRIGGER_IDENTITY_NOTE =
  '身份随声明下标合成；修改 id 不会迁移已触发记录——单次触发器的触发事实按身份记账。'

/** repeatable 开关提示：单次持久；改开后不再受旧记录限制。 */
export const REPEATABLE_TOGGLE_NOTE =
  '单次触发记录持久保存：关闭时该触发器对该玩家只触发一次；改为可重复后，旧触发记录不再限制再次触发。'

/** delay 排队提示：同触发器已有待执行时不重复排队。 */
export const DELAY_PENDING_NOTE =
  '同一触发器已有待执行的延迟触发时，重复命中不会重复排队。'

/** 「触发后」只读卡：当前格式无动作 / 目标 / play_script。 */
export const TRIGGER_ACTION_CARD_TEXT =
  '触发后仅播放本脚本给触发者本人；当前脚本格式没有动作列表、目标玩家或 play_script 字段。'

// ── 目录再导出（冻结 API）───────────────────────────────────────────────────

export { TRIGGER_TYPES, triggerTypeInfo }
export type { RequirementEntry }
