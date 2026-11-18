/**
 * 11 轮触发器域读取模型（纯擦除式 TS：禁 enum / namespace / 参数属性 / 装饰器）。
 *
 * 形状约定：
 * - 原始 JSON 一律保留在 `raw` 上，未知键 / 未登记字段不裁剪、不补默认；
 * - 解析视图只做「读出来给面板用」的投影，写回仍由命令层改 `raw`；
 * - 问题条目复用 `shared.ts` 的 `BehaviorProblem`，本文件不另造问题类型。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { BehaviorProblem } from './shared.ts'
import type { TriggerTypeInfo } from '../../core/schema/catalog/behaviorTriggers.ts'

// ── 时序视图 ────────────────────────────────────────────────────────────────

/** continuity 连续语义的解析视图；`undefined` = 原文未写（区别于显式 0 / false）。 */
export interface ContinuityView {
  sweep: boolean | undefined
  /** 停留门槛（tick，整数 0~1200）。 */
  dwellTicks: number | undefined
  /** 事件类子条件窗口（tick，整数 0~1200）。 */
  windowTicks: number | undefined
}

/** 触发器时序字段的解析视图。 */
export interface TriggerTimingView {
  /** 触发延迟（秒，JSON 原值；0 = 立即）。 */
  delaySeconds: number | undefined
  /** 是否可重复触发；缺省 false（单次持久，事实账本去重）。 */
  repeatable: boolean
  /** 是否只在进入边沿触发。 */
  onEnter: boolean
  /** 区域外扩缓冲（格）。 */
  exitBuffer: number | undefined
  /** 触发器级轮询间隔（tick，1~600）；`undefined` = 未写，回落到脚本级 → 类型级默认。 */
  pollInterval: number | undefined
  continuity: ContinuityView
}

// ── 条件树节点 ──────────────────────────────────────────────────────────────

/**
 * 组合器子项 / 条件树节点：`{ type, conditions }` 形态。
 * `raw` 保留原始对象（含未知键）；`conditions` 为其条件对象投影。
 */
export interface TriggerConditionNode {
  /** 子项类型键（已注册触发器类型 / 内置前置 / 嵌套组合器）。 */
  type: string
  /** 子项条件对象；缺失时为空对象。 */
  conditions: JsonObject
  /** 原始子项对象。 */
  raw: JsonObject
}

// ── 前置条目 ────────────────────────────────────────────────────────────────

/**
 * `requires` 条目读取模型：
 * - `string`：只可能是 `script_played` 的简写，字符串即目标脚本 id；
 * - `object`：必须有非空 string `type`；其余键为前置数据（内置 `script_*` 用 `script` 字段）。
 */
export type RequirementEntry =
  | { kind: 'string'; raw: string; script: string }
  | { kind: 'object'; raw: JsonObject; type: string; data: JsonObject }
  | { kind: 'malformed'; raw: JsonValue }

// ── 区域形态 ─────────────────────────────────────────────────────────────────

/** 区域角点 / 球形中心的三分量；分量缺失时为 `undefined`（不编默认 0）。 */
export interface RegionPoint {
  x: number | undefined
  y: number | undefined
  z: number | undefined
}

/** 区域条件视图：球形（position+radius）与方体（corner1+corner2）可共存，运行时 OR。 */
export interface RegionView {
  sphere: { position: RegionPoint; radius: number | undefined } | undefined
  box: { corner1: RegionPoint; corner2: RegionPoint } | undefined
}

// ── 触发器节点 ──────────────────────────────────────────────────────────────

/** 触发器声明的读取模型（`meta.triggers[<index>]`）。 */
export interface TriggerNode {
  /** 原始声明对象；未知键原样保留。 */
  raw: JsonObject
  /** 声明下标（`meta.triggers[]` 位置，0 起）；身份合成 `type#下标` 用。 */
  index: number
  /** 类型键；缺失 / 非字符串时为空串。 */
  type: string
  /** 显式声明 id；未写 / 非字符串时为 `undefined`。 */
  explicitId: string | undefined
  /** 条件对象投影；缺失时为空对象。 */
  conditions: JsonObject
  timing: TriggerTimingView
  /** 前置条目（保留原顺序与原形态）。 */
  requires: RequirementEntry[]
  /** 目录信息；未知类型为 `undefined`（走未知类型只读口径）。 */
  info: TriggerTypeInfo | undefined
}

// ── 诊断 ────────────────────────────────────────────────────────────────────

/** 触发器 / 条件树诊断条目（复用本地问题形状；`jsonPath` 定位到触发器 / 子条件路径）。 */
export type TriggerDiagnostic = BehaviorProblem

/** 条件树校验上下文：脚本内已知脚本 id（前置跨脚本引用解析用）。 */
export interface ConditionValidationContext {
  /** 当前脚本自身 id（前置自引用判定用）；无 id 脚本为 `undefined`。 */
  selfScriptId: string | undefined
  /** 文档内全部脚本 id（跨脚本存在性判定用）。 */
  knownScriptIds: readonly string[]
}

/** 供面板复用的 JSON 值类型（避免各处重复引入 doc/types）。 */
export type { JsonValue }
