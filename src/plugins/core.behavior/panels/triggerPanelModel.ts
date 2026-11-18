/**
 * 右栏触发器面板的纯逻辑模型（11-02 / 11-03 / 11-04 / 11-05）。
 *
 * 这个文件不依赖 Vue：面板组件从 root() 原始 JSON 组装行视图、算诊断与适用性；
 * 临时自检脚本也直接从这里取纯函数，便于真跑列表摘要 / 重复 id / 时序矩阵 / 深度封顶 /
 * 区域归一 / 草稿差分等用例。
 *
 * 只读复用 `src/features/behavior/**` 与 `src/core/schema/catalog/behaviorTriggers.ts`，
 * 不在这里复刻目录判断或摘要文案。
 */
import type { JsonObject, JsonValue, Severity } from '../../../core/doc/types.ts'
import {
  describe,
  isFiniteNumber,
  isJsonArray,
  isJsonObject,
  sameJson,
} from '../../../core/doc/json.ts'
import {
  CONTINUITY_MAX_TICKS,
  TRIGGER_POLL_INTERVAL_MAX,
  TRIGGER_POLL_INTERVAL_MIN,
  TRIGGER_TYPES,
  triggerTypeInfo,
  type TriggerTypeInfo,
} from '../../../core/schema/catalog/behaviorTriggers.ts'
import type { BehaviorProblem } from '../../../features/behavior/shared.ts'
import { highestSeverity } from '../../../features/behavior/shared.ts'
import {
  findDuplicateIds,
  parseTriggerNode,
  triggerHasExplicitId,
  triggerIdentity,
  triggerTimingIssues,
} from '../../../features/behavior/trigger.ts'
import type {
  ConditionValidationContext,
  TriggerNode,
} from '../../../features/behavior/trigger.types.ts'
import {
  CONDITION_DEPTH_MAX,
  conditionRole,
  readConditionChildren,
  validateTriggerConditions,
} from '../../../features/behavior/triggerConditions.ts'
import {
  requirementEntries,
  resolveRequirement,
} from '../../../features/behavior/requirements.ts'
import type {
  RequirementContext,
  ResolvedRequirement,
} from '../../../features/behavior/requirements.ts'

/** 面板组装前置诊断需要的脚本上下文（来自文档 + 项目图）。 */
export interface PanelScriptContext {
  /** 当前脚本 id；缺失时 `undefined`（自引用判断不可用）。 */
  selfScriptId: string | undefined
  /** 项目图中 id 唯一的脚本 id 集合（目标可解析）。 */
  knownScriptIds: readonly string[]
  /** 项目图中 id 重复、无法唯一定位的脚本 id。 */
  ambiguousScriptIds: readonly string[]
}

/** 列表一行 / 详情一份共用的触发器视图。 */
export interface PanelTrigger {
  node: TriggerNode
  /** 稳定身份：显式 id 或 `type#index`。 */
  identity: string
  /** 文档内重复 id 时为 true。 */
  duplicate: boolean
  /** 条件树叶子数（组合器递归计数；未知类型也占一行）。 */
  leafCount: number
  requirementCount: number
  problems: BehaviorProblem[]
  highest: Severity | null
  badgeDelay: boolean
  badgeContinuity: boolean
}

/** 时序 poll_interval 生效值与来源。 */
export interface PollResolution {
  value: number | null
  source: 'trigger' | 'script' | 'type' | 'none'
  label: string
}

function conditionValidationContext(ctx: PanelScriptContext): ConditionValidationContext {
  return {
    knownScriptIds: [...ctx.knownScriptIds],
    selfScriptId: ctx.selfScriptId,
  }
}

function requirementContext(ctx: PanelScriptContext): RequirementContext {
  return {
    selfScriptId: ctx.selfScriptId,
    knownScriptIds: [...ctx.knownScriptIds],
    ambiguousScriptIds: [...ctx.ambiguousScriptIds],
    scriptIds: ctx.selfScriptId === undefined ? [] : [ctx.selfScriptId],
  }
}

export { requirementContext, conditionValidationContext }

/** 递归统计条件树叶子数。组合器有子项时求和；其余类型记 1 行。 */
export function countConditionLeaves(type: string, conditions: JsonObject): number {
  const role = conditionRole(type)
  if (role !== 'combinator') {
    return 1
  }
  const children = readConditionChildren(conditions)
  if (children.length === 0) {
    return 1
  }
  let total = 0
  for (const child of children) {
    total += countConditionLeaves(child.type, child.conditions)
  }
  return total
}

/** 条件树最大嵌套深度（触发器根记 1；组合器子项逐层 +1）。 */
export function maxConditionDepth(conditions: JsonObject, depth = 1): number {
  const children = readConditionChildren(conditions)
  if (children.length === 0) {
    return depth
  }
  let max = depth
  for (const child of children) {
    max = Math.max(max, maxConditionDepth(child.conditions, depth + 1))
  }
  return max
}

/** 条件根是否已有可外扩区域（球形位置 / 方体两角点），供 exit_buffer 可用性判断。 */
export function regionHasExpandableSpace(conditions: JsonObject): boolean {
  const position = conditions.position
  if (isJsonObject(position)) {
    return (
      isFiniteNumber(position.x) && isFiniteNumber(position.y) && isFiniteNumber(position.z)
    )
  }
  const corner1 = conditions.corner1
  const corner2 = conditions.corner2
  if (isJsonObject(corner1) && isJsonObject(corner2)) {
    return (
      isFiniteNumber(corner1.x) && isFiniteNumber(corner1.y) && isFiniteNumber(corner1.z) &&
      isFiniteNumber(corner2.x) && isFiniteNumber(corner2.y) && isFiniteNumber(corner2.z)
    )
  }
  return false
}

/** 角点自动 min/max；任一分量缺失记 incomplete（条件永不满足）。 */
export function normalizeBox(
  a: { x: unknown; y: unknown; z: unknown },
  b: { x: unknown; y: unknown; z: unknown },
): {
  min: { x: number | undefined; y: number | undefined; z: number | undefined }
  max: { x: number | undefined; y: number | undefined; z: number | undefined }
  incomplete: boolean
} {
  const read = (v: unknown): number | undefined => (isFiniteNumber(v) ? v : undefined)
  const ax = read(a.x); const ay = read(a.y); const az = read(a.z)
  const bx = read(b.x); const by = read(b.y); const bz = read(b.z)
  const pairs: Array<[number | undefined, number | undefined]> = [
    [ax, bx],
    [ay, by],
    [az, bz],
  ]
  const incomplete = pairs.some(([x, y]) => x === undefined || y === undefined)
  const lo = pairs.map(([x, y]) => (x === undefined || y === undefined ? undefined : Math.min(x, y)))
  const hi = pairs.map(([x, y]) => (x === undefined || y === undefined ? undefined : Math.max(x, y)))
  return {
    min: { x: lo[0], y: lo[1], z: lo[2] },
    max: { x: hi[0], y: hi[1], z: hi[2] },
    incomplete,
  }
}

function requirementProblems(
  resolution: ResolvedRequirement,
  basePath: string,
  index: number,
): BehaviorProblem[] {
  switch (resolution.status) {
    case 'resolved':
      return []
    case 'missing':
      return [
        {
          code: 'REQUIREMENT_MISSING',
          severity: 'error',
          message: `前置目标「${resolution.targetScriptId ?? describe(resolution.entry.raw)}」在项目图中不存在`,
          jsonPath: `${basePath}[${index}]`,
        },
      ]
    case 'self_reference':
      return [
        {
          code: 'REQUIREMENT_SELF_REFERENCE',
          severity: 'warn',
          message: '前置指向当前脚本自己（自引用），不应作为进入条件',
          jsonPath: `${basePath}[${index}]`,
        },
      ]
    case 'duplicate_id_unresolved':
      return [
        {
          code: 'REQUIREMENT_DUPLICATE_TARGET',
          severity: 'warn',
          message: `目标 id「${resolution.targetScriptId ?? ''}」在项目图中重复，无法唯一定位`,
          jsonPath: `${basePath}[${index}]`,
        },
      ]
    case 'malformed':
      return [
        {
          code: 'REQUIREMENT_MALFORMED',
          severity: 'error',
          message: '前置形态不合法：内置前置需要 { type, script } 对象，字符串简写等价 script_played',
          jsonPath: `${basePath}[${index}]`,
        },
      ]
    case 'custom':
      return [
        {
          code: 'REQUIREMENT_CUSTOM_READONLY',
          severity: 'info',
          message: '自定义前置，面板只读；不硬判目标存在性',
          jsonPath: `${basePath}[${index}]`,
        },
      ]
  }
}

/** 组装一条触发器的面板视图与全部诊断。 */
export function buildPanelTrigger(
  raw: JsonValue,
  index: number,
  scriptCtx: PanelScriptContext,
  duplicateIdSets: Map<string, number[]>,
): PanelTrigger | null {
  if (!isJsonObject(raw)) {
    return null
  }
  const node = parseTriggerNode(raw, index)
  const reqCtx = requirementContext(scriptCtx)
  const condCtx = conditionValidationContext(scriptCtx)

  const problems: BehaviorProblem[] = []
  const basePath = `meta.triggers[${index}]`

  // 重复 id（脚本内）。
  if (node.explicitId !== undefined) {
    const indexes = duplicateIdSets.get(node.explicitId)
    const duplicate = indexes !== undefined && indexes.length > 1
    if (duplicate) {
      problems.push({
        code: 'TRIGGER_DUPLICATE_ID',
        severity: 'error',
        message: `触发器 id「${node.explicitId}」重复：出现在下标 ${indexes.join(', ')}`,
        jsonPath: `${basePath}.id`,
      })
    }
  }

  // 时序适用性 / 取值诊断。
  problems.push(...triggerTimingIssues(node))

  // 条件树诊断。
  problems.push(...validateTriggerConditions(node, condCtx))

  // 前置诊断。
  const entries = requirementEntries(node)
  entries.forEach((entry, entryIndex) => {
    const resolution = resolveRequirement(entry, reqCtx)
    problems.push(...requirementProblems(resolution, `${basePath}.requires`, entryIndex))
  })

  // 条件与前置都空：只靠类型本身触发，记 info。
  const conditionChildren = readConditionChildren(node.conditions)
  const conditionEmpty = conditionChildren.length === 0 && Object.keys(node.conditions).length === 0
  if (conditionEmpty && entries.length === 0) {
    problems.push({
      code: 'TRIGGER_EMPTY_CONDITION_AND_REQUIREMENT',
      severity: 'info',
      message: '条件与前置都为空：仅靠触发器类型本身触发，可补充条件或前置',
      jsonPath: `${basePath}.conditions`,
    })
  }

  const badgeDelay = node.timing.delaySeconds !== undefined && raw.delay !== 0
  const continuity = node.timing.continuity
  const badgeContinuity =
    continuity.sweep === true ||
    (isFiniteNumber(continuity.dwellTicks) && continuity.dwellTicks !== 0) ||
    (isFiniteNumber(continuity.windowTicks) && continuity.windowTicks !== 0)

  return {
    node,
    identity: triggerIdentity(node),
    duplicate: node.explicitId !== undefined && (duplicateIdSets.get(node.explicitId)?.length ?? 1) > 1,
    leafCount: countConditionLeaves(node.type, node.conditions),
    requirementCount: entries.length,
    problems,
    highest: highestSeverity(problems),
    badgeDelay,
    badgeContinuity,
  }
}

/** 从文档 root() 组装全部触发器行。 */
export function buildPanelTriggers(
  root: JsonObject | null,
  scriptCtx: PanelScriptContext,
): PanelTrigger[] {
  const meta = root?.meta
  const rawTriggers = isJsonObject(meta) && isJsonArray(meta.triggers) ? meta.triggers : []
  const nodes = rawTriggers.map((raw, index) =>
    parseTriggerNode(isJsonObject(raw) ? raw : {}, index),
  )
  const duplicates = findDuplicateIds(nodes)
  const out: PanelTrigger[] = []
  rawTriggers.forEach((raw, index) => {
    const row = buildPanelTrigger(raw, index, scriptCtx, duplicates)
    if (row !== null) {
      out.push(row)
    }
  })
  return out
}

/** 解析 poll_interval 生效值：触发器覆盖 → 脚本缺省 → 类型缺省；事件驱动不轮询。 */
export function resolvePollInterval(
  node: TriggerNode,
  scriptDefault: unknown,
): PollResolution {
  const info: TriggerTypeInfo | undefined = triggerTypeInfo(node.type)
  if (info === undefined || !info.timing.pollInterval) {
    return { value: null, source: 'none', label: '事件驱动，不轮询' }
  }
  const own = node.timing.pollInterval
  if (own !== undefined) {
    return { value: own, source: 'trigger', label: '触发器声明' }
  }
  if (isFiniteNumber(scriptDefault)) {
    return { value: scriptDefault, source: 'script', label: '脚本缺省（Script Properties）' }
  }
  return { value: info.defaultPollInterval, source: 'type', label: '类型缺省' }
}

/** 子项类型分组：触发器条件 / 脚本前置（前置只出现在组合器内）。 */
export interface ChildTypeGroup {
  label: string
  types: Array<{ type: string; label: string; role: string; event: boolean }>
}

/** 子项选择器分组；事件类子项在 window=0 时由面板禁用并提示。 */
export function childTypeGroups(): ChildTypeGroup[] {
  const conditions: ChildTypeGroup['types'] = TRIGGER_TYPES.map((entry) => ({
    type: entry.type,
    label: entry.label,
    role: conditionRole(entry.type),
    event: entry.role === 'event',
  }))
  const prerequisites: ChildTypeGroup['types'] = [
    { type: 'script_started', label: '脚本前置 · 已开始播放', role: 'prerequisite', event: false },
    { type: 'script_completed', label: '脚本前置 · 已结束播放', role: 'prerequisite', event: false },
    { type: 'script_played', label: '脚本前置 · 已播放过', role: 'prerequisite', event: false },
  ]
  return [
    { label: '触发器条件', types: conditions },
    { label: '脚本前置（组合器内）', types: prerequisites },
  ]
}

/** 草稿差分：把本地草稿与原始 JSON 比对成可提交的命令描述。 */
export interface TriggerDraftDiff {
  idChanged: boolean
  typeChanged: boolean
  fieldsPatch: JsonObject
  conditionsPatch: Record<string, JsonValue>
  conditionsRemove: string[]
  continuityOmittable: boolean
}

const TIMING_KEYS = ['repeatable', 'delay', 'on_enter', 'exit_buffer', 'poll_interval', 'continuity'] as const

/** 比对草稿与原始记录，产出字段 / 条件的 patch；删除的键进 remove 列表。 */
export function diffDraft(original: JsonObject, draft: JsonObject): TriggerDraftDiff {
  const fieldsPatch: JsonObject = {}
  for (const key of TIMING_KEYS) {
    const before = original[key]
    const after = draft[key]
    if (sameJson(before, after)) {
      continue
    }
    fieldsPatch[key] = after === undefined ? null : after
  }

  const originalConditions = isJsonObject(original.conditions) ? original.conditions : {}
  const draftConditions = isJsonObject(draft.conditions) ? draft.conditions : {}
  const conditionsPatch: Record<string, JsonValue> = {}
  const conditionsRemove: string[] = []
  const conditionKeys = new Set([...Object.keys(originalConditions), ...Object.keys(draftConditions)])
  for (const key of conditionKeys) {
    const before = originalConditions[key]
    const after = draftConditions[key]
    if (sameJson(before, after)) {
      continue
    }
    if (after === undefined) {
      conditionsRemove.push(key)
    } else {
      conditionsPatch[key] = after
    }
  }

  return {
    idChanged: draft.id !== original.id,
    typeChanged: draft.type !== original.type,
    fieldsPatch,
    conditionsPatch,
    conditionsRemove,
    continuityOmittable: continuityIsOmittable(draft),
  }
}

/** continuity 全 0/false 等价未声明。 */
export function continuityIsOmittable(draft: JsonObject): boolean {
  const continuity = draft.continuity
  if (!isJsonObject(continuity)) {
    return true
  }
  const sweep = continuity.sweep
  const dwell = continuity.dwell
  const window_ = continuity.window
  return (
    sweep !== true &&
    (!isFiniteNumber(dwell) || dwell === 0) &&
    (!isFiniteNumber(window_) || window_ === 0)
  )
}

/** 草稿是否有任何未应用改动。 */
export function isDraftDirty(original: JsonObject, draft: JsonObject): boolean {
  return !sameJson(original, draft)
}

/**
 * 生成未占用的可读触发器 id（`trigger_1` 形态，匹配 `TRIGGER_ID_PATTERN`）；
 * 只在草稿阶段作为建议值，应用时才落盘。
 */
export function suggestTriggerId(existing: ReadonlySet<string>): string {
  let counter = 1
  let candidate = `trigger_${counter}`
  while (existing.has(candidate)) {
    counter += 1
    candidate = `trigger_${counter}`
  }
  return candidate
}

/** 新建触发器的本地草稿（先不落文档）；传入既有显式 id 时预填一个未占用建议 id。 */
export function emptyTriggerDraft(existingIds?: ReadonlySet<string>): JsonObject {
  const draft: JsonObject = { type: 'login', conditions: {} }
  if (existingIds !== undefined) {
    draft.id = suggestTriggerId(existingIds)
  }
  return draft
}

/** 校验草稿记录在新类型下是否可应用；返回阻塞问题（error / block 级阻塞）。 */
export function draftBlockingProblems(
  draft: JsonObject,
  index: number,
  scriptCtx: PanelScriptContext,
): BehaviorProblem[] {
  const node = parseTriggerNode(draft, index)
  const condCtx = conditionValidationContext(scriptCtx)
  const conditionProblems = validateTriggerConditions(node, condCtx)
  return [...triggerTimingIssues(node), ...conditionProblems].filter(
    (p) => p.severity === 'error' || p.severity === 'block',
  )
}

/** 轮询间隔合法性（就地报错，不夹取）。返回 null 表示合法；否则给消息。 */
export function pollIntervalError(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!isFiniteNumber(value)) {
    return `poll_interval 需要整数 tick（${TRIGGER_POLL_INTERVAL_MIN}~${TRIGGER_POLL_INTERVAL_MAX}），实际: ${describe(value as JsonValue)}`
  }
  if (!Number.isInteger(value)) {
    return `poll_interval 不是整数 tick，实际: ${value}`
  }
  if (value < TRIGGER_POLL_INTERVAL_MIN || value > TRIGGER_POLL_INTERVAL_MAX) {
    return `poll_interval 超出范围 ${TRIGGER_POLL_INTERVAL_MIN}~${TRIGGER_POLL_INTERVAL_MAX}，实际: ${value}`
  }
  return null
}

/** continuity 子字段边界（tick）；返回 null 表示合法。 */
export function continuityTickError(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!isFiniteNumber(value)) {
    return `${label} 需要整数 tick，实际: ${describe(value as JsonValue)}`
  }
  if (!Number.isInteger(value)) {
    return `${label} 不是整数 tick，实际: ${value}`
  }
  if (value < 0 || value > CONTINUITY_MAX_TICKS) {
    return `${label} 超出范围 0~${CONTINUITY_MAX_TICKS}，实际: ${value}`
  }
  return null
}

/** 条件树深度是否达到封顶（第 8 层禁用新增）。 */
export function depthAtLimit(conditions: JsonObject): boolean {
  return maxConditionDepth(conditions) >= CONDITION_DEPTH_MAX
}

/** 身份是否显式写了 id。 */
export function draftHasExplicitId(draft: JsonObject): boolean {
  return triggerHasExplicitId(draft)
}

/** 供报告 / 自检读取目录的 27 类型时序适用性矩阵。 */
export function timingMatrix(): Array<{
  type: string
  label: string
  role: string
  onEnter: boolean
  exitBuffer: boolean
  pollInterval: boolean
  sweep: boolean
  dwell: boolean
  window: boolean
  defaultPollInterval: number | null
}> {
  return TRIGGER_TYPES.map((entry) => ({
    type: entry.type,
    label: entry.label,
    role: entry.role,
    onEnter: entry.timing.onEnter,
    exitBuffer: entry.timing.exitBuffer,
    pollInterval: entry.timing.pollInterval,
    sweep: entry.timing.sweep,
    dwell: entry.timing.dwell,
    window: entry.timing.window,
    defaultPollInterval: entry.defaultPollInterval,
  }))
}
