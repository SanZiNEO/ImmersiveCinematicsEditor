/**
 * 11 轮规则绑定纯函数：gate / control / 五调度 / 五出口字段面与边界校验、
 * 引用保护、绑定 id 事务性重命名、唯一摘要生成处。
 *
 * 绑定是「规则 × 片段」的关系：rule / clip / gate 必填，control / schedule / exit 可省。
 * 不接受 condition / actions（那是规则定义侧字段）。
 */

import type { JsonArray, JsonObject, JsonValue } from '../../core/doc/types.ts'
import {
  cloneJson,
  describe,
  isFiniteNumber,
  isJsonArray,
  isJsonObject,
} from '../../core/doc/json.ts'
import { BINDING_KEYS, RULE_ID_PATTERN } from '../../core/doc/keys.ts'
import type { BehaviorProblem, RecordRef } from './shared.ts'
import {
  CONTROL_KINDS,
  EXIT_KINDS,
  RULE_FACT_NAMES,
  SCHEDULE_KINDS,
  SCHEDULE_KIND_INFO,
  EXIT_KIND_INFO,
  classifyClipReachability,
  type BehaviorRefs,
} from '../../core/schema/catalog/behaviorRules.ts'
import {
  collectConditionTimeThresholds,
  validateConditionReachability,
} from './ruleConditions.ts'

export { CONTROL_KINDS, EXIT_KINDS, SCHEDULE_KINDS }

// ── 上下文 ──────────────────────────────────────────────────────────────────

/** 绑定校验 / 摘要上下文。 */
export interface BindingContext {
  refs?: BehaviorRefs
  basePath?: string
}

function problem(
  code: string,
  severity: BehaviorProblem['severity'],
  message: string,
  jsonPath: string,
): BehaviorProblem {
  return { code, severity, message, jsonPath }
}

// ── 单条绑定校验 ──────────────────────────────────────────────────────────────

/** 校验单条规则绑定。 */
export function validateBinding(binding: JsonValue, ctx: BindingContext = {}): BehaviorProblem[] {
  const basePath = ctx.basePath ?? 'rule_bindings'
  const issues: BehaviorProblem[] = []

  if (!isJsonObject(binding)) {
    issues.push(problem('BINDING_TYPE', 'block', '绑定需要对象', basePath))
    return issues
  }

  for (const key of Object.keys(binding)) {
    if (!BINDING_KEYS.includes(key)) {
      issues.push(problem('BINDING_UNKNOWN_KEY', 'block',
        `未知键（可用: ${BINDING_KEYS.join(' / ')}）；绑定不接受 condition / actions`, `${basePath}.${key}`))
    }
  }

  validateBindingId(binding, basePath, issues)

  const rule = binding.rule
  if (typeof rule !== 'string' || rule.length === 0) {
    issues.push(problem('BINDING_RULE_MISSING', 'block', 'rule 缺失（绑定到的规则 id）', `${basePath}.rule`))
  } else if (ctx.refs && !ctx.refs.ruleIds.has(rule)) {
    issues.push(problem('BINDING_RULE_UNKNOWN', 'block', `未知规则引用: ${rule}`, `${basePath}.rule`))
  }

  const clip = binding.clip
  if (typeof clip !== 'string' || clip.length === 0) {
    issues.push(problem('BINDING_CLIP_MISSING', 'block', 'clip 缺失（绑定到的片段 id）', `${basePath}.clip`))
  } else if (ctx.refs && !ctx.refs.clipIds.has(clip)) {
    issues.push(problem('BINDING_CLIP_MISSING', 'block',
      `片段不存在: ${clip}（绑定不能应用到缺失片段）`, `${basePath}.clip`))
  }

  validateGate(binding, basePath, ctx, issues)
  validateControl(binding, basePath, issues)
  if (binding.schedule !== undefined) {
    issues.push(...validateSchedule(binding.schedule, `${basePath}.schedule`, ctx))
  }
  if (binding.exit !== undefined) {
    issues.push(...validateExit(binding.exit, `${basePath}.exit`, ctx))
  }

  return issues
}

function validateBindingId(binding: JsonObject, basePath: string, issues: BehaviorProblem[]): void {
  const id = binding.id
  if (id === undefined) {
    issues.push(problem('BINDING_ID_MISSING', 'block', '绑定 id 缺失（必填且脚本内唯一）', `${basePath}.id`))
    return
  }
  if (typeof id !== 'string' || id.length === 0) {
    issues.push(problem('BINDING_ID_TYPE', 'block', '绑定 id 需要非空字符串', `${basePath}.id`))
    return
  }
  if (!RULE_ID_PATTERN.test(id)) {
    issues.push(problem('BINDING_ID_PATTERN', 'block',
      `绑定 id 必须匹配 ${RULE_ID_PATTERN.source}，实际: ${id}`, `${basePath}.id`))
  }
}

// ── 时间门 ────────────────────────────────────────────────────────────────────

function validateGate(
  binding: JsonObject,
  basePath: string,
  ctx: BindingContext,
  issues: BehaviorProblem[],
): void {
  const gate = binding.gate
  if (!isJsonObject(gate)) {
    issues.push(problem('BINDING_GATE_TYPE', 'block', 'gate 缺失或不是对象（时间门必填 { "at": <局部秒> }）', `${basePath}.gate`))
    return
  }
  for (const key of Object.keys(gate)) {
    if (key !== 'at') {
      issues.push(problem('BINDING_GATE_UNKNOWN_KEY', 'block',
        `gate 只接受 at（目标片段执行局部秒），未知键: ${key}`, `${basePath}.gate.${key}`))
    }
  }

  const at = gate.at
  if (!isFiniteNumber(at)) {
    issues.push(problem('BINDING_GATE_AT_TYPE', 'block', 'gate.at 需要有限数字（局部秒，>= 0）', `${basePath}.gate.at`))
    return
  }
  if (at < 0) {
    issues.push(problem('BINDING_GATE_AT_RANGE', 'error', `gate.at 需要 >= 0，实际: ${at}`, `${basePath}.gate.at`))
    return
  }

  const clip = typeof binding.clip === 'string' ? binding.clip : undefined
  const duration = clip ? ctx.refs?.clipDurations.get(clip) : undefined
  if (duration !== undefined && duration >= 0 && at > duration) {
    issues.push(problem('BINDING_GATE_OOB', 'error',
      `gate.at ${at}s 超出片段 ${clip} 时长 ${duration}s（越界报错，不夹取）`, `${basePath}.gate.at`))
  }
}

// ── 控制 ──────────────────────────────────────────────────────────────────────

function validateControl(binding: JsonObject, basePath: string, issues: BehaviorProblem[]): void {
  const control = binding.control
  if (control === undefined) return
  if (typeof control !== 'string' || !CONTROL_KINDS.includes(control)) {
    issues.push(problem('BINDING_CONTROL_UNKNOWN', 'block',
      `控制方式需要 ${CONTROL_KINDS.join(' / ')}（缺省 observe），实际: ${describe(control)}`, `${basePath}.control`))
  }
}

// ── 调度 ──────────────────────────────────────────────────────────────────────

function validateSchedule(schedule: JsonValue, path: string, ctx: BindingContext): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  if (!isJsonObject(schedule)) {
    issues.push(problem('BINDING_SCHEDULE_TYPE', 'block',
      `schedule 需要对象（释放条件: ${SCHEDULE_KINDS.join(' / ')}）`, path))
    return issues
  }

  const on = schedule.on
  if (typeof on !== 'string' || !SCHEDULE_KINDS.includes(on)) {
    issues.push(problem('BINDING_SCHEDULE_ON', 'block',
      `schedule.on 需要 ${SCHEDULE_KINDS.join(' / ')}，实际: ${describe(on)}`, `${path}.on`))
    return issues
  }

  const info = SCHEDULE_KIND_INFO[on]
  const allowed = new Set(['on', ...info.params.filter((key) => key !== 'on')])
  for (const key of Object.keys(schedule)) {
    if (!allowed.has(key)) {
      issues.push(problem('BINDING_SCHEDULE_UNKNOWN_KEY', 'block',
        `schedule[${on}] 可用参数: ${[...allowed].join(' / ')}`, `${path}.${key}`))
    }
  }

  switch (on) {
    case 'clip_start':
    case 'clip_complete':
      validateScheduleClip(schedule, path, ctx, issues)
      break
    case 'local_time':
      validateScheduleClip(schedule, path, ctx, issues)
      if (!isFiniteNumber(schedule.at) || (isFiniteNumber(schedule.at) && schedule.at < 0)) {
        issues.push(problem('BINDING_SCHEDULE_AT', 'error',
          'local_time 的 at 需要 >= 0 的有限数字（局部秒）', `${path}.at`))
      }
      break
    case 'delay':
      if (!isFiniteNumber(schedule.seconds) || (isFiniteNumber(schedule.seconds) && schedule.seconds < 0)) {
        issues.push(problem('BINDING_SCHEDULE_SECONDS', 'error',
          'delay 的 seconds 需要 >= 0 的有限数字（真实秒）', `${path}.seconds`))
      }
      break
    case 'fact':
      validateScheduleFact(schedule, path, ctx, issues)
      break
    default:
      break
  }

  return issues
}

function validateScheduleClip(
  schedule: JsonObject,
  path: string,
  ctx: BindingContext,
  issues: BehaviorProblem[],
): void {
  const clip = schedule.clip
  if (typeof clip !== 'string' || clip.length === 0) {
    issues.push(problem('BINDING_SCHEDULE_CLIP_MISSING', 'block', '调度缺少目标片段 id（clip）', `${path}.clip`))
  } else if (ctx.refs && !ctx.refs.clipIds.has(clip)) {
    issues.push(problem('BINDING_SCHEDULE_CLIP_UNKNOWN', 'block', `未知片段引用: ${clip}`, `${path}.clip`))
  }
}

function validateScheduleFact(
  schedule: JsonObject,
  path: string,
  ctx: BindingContext,
  issues: BehaviorProblem[],
): void {
  const binding = schedule.binding
  if (typeof binding !== 'string' || binding.length === 0) {
    issues.push(problem('BINDING_SCHEDULE_BINDING_MISSING', 'block', 'fact 调度缺少绑定 id（binding）', `${path}.binding`))
  } else if (ctx.refs && !ctx.refs.bindingIds.has(binding)) {
    issues.push(problem('BINDING_SCHEDULE_BINDING_UNKNOWN', 'block', `未知绑定引用: ${binding}`, `${path}.binding`))
  }

  const fact = schedule.fact
  if (fact === undefined) {
    issues.push(problem('BINDING_SCHEDULE_FACT_MISSING', 'block',
      `fact 调度缺少事实名（可选: ${RULE_FACT_NAMES.join(' / ')}）`, `${path}.fact`))
  } else if (typeof fact !== 'string' || !RULE_FACT_NAMES.includes(fact)) {
    issues.push(problem('BINDING_SCHEDULE_FACT', 'error',
      `事实名需要 ${RULE_FACT_NAMES.join(' / ')}，实际: ${describe(fact)}`, `${path}.fact`))
  }
}

// ── 出口 ──────────────────────────────────────────────────────────────────────

function validateExit(exit: JsonValue, path: string, ctx: BindingContext): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  if (!isJsonObject(exit)) {
    issues.push(problem('BINDING_EXIT_TYPE', 'block', `exit 需要对象（出口策略: ${EXIT_KINDS.join(' / ')}）`, path))
    return issues
  }

  const kind = exit.on_complete
  if (typeof kind !== 'string' || !EXIT_KIND_INFO[kind]) {
    issues.push(problem('BINDING_EXIT_KIND', 'block',
      `on_complete 需要 ${EXIT_KINDS.join(' / ')}，实际: ${describe(kind)}`, `${path}.on_complete`))
    return issues
  }

  const info = EXIT_KIND_INFO[kind]
  const allowed = new Set(['on_complete', ...(info.allowsTarget ? ['target', 'entry_time'] : [])])
  for (const key of Object.keys(exit)) {
    if (!allowed.has(key)) {
      issues.push(problem('BINDING_EXIT_UNKNOWN_KEY', 'block',
        info.allowsTarget ? `exit[goto] 可用: on_complete / target / entry_time` : `exit[${kind}] 不接受 ${key}（只有 goto 需要 target / entry_time）`,
        `${path}.${key}`))
    }
  }

  if (info.allowsTarget) {
    const target = exit.target
    if (typeof target !== 'string' || target.length === 0) {
      issues.push(problem('BINDING_EXIT_TARGET_MISSING', 'block', 'goto 出口缺少目标片段 id（target）', `${path}.target`))
    } else if (ctx.refs && !ctx.refs.clipIds.has(target)) {
      issues.push(problem('BINDING_EXIT_TARGET_UNKNOWN', 'block', `未知片段引用: ${target}`, `${path}.target`))
    }
    const entryTime = exit.entry_time
    if (entryTime !== undefined && (!isFiniteNumber(entryTime) || entryTime < 0)) {
      issues.push(problem('BINDING_EXIT_ENTRY_TIME', 'error',
        `entry_time 需要 >= 0 的有限数字（入口局部秒），实际: ${describe(entryTime)}`, `${path}.entry_time`))
    }
  }

  return issues
}

// ── 集合级校验：id 查重 + 调度成环 ─────────────────────────────────────────────

/** 收集根上全部绑定对象（非数组时返回空列表）。 */
export function bindingsOfRoot(root: JsonObject): JsonObject[] {
  const bindings = root.rule_bindings
  if (!isJsonArray(bindings)) return []
  return bindings.filter(isJsonObject)
}

/** 集合级校验：绑定表形态 + id 查重 + 逐条校验 + fact 调度成环检测。 */
export function validateBindings(root: JsonObject, refs: BehaviorRefs): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const bindings = root.rule_bindings

  if (bindings !== undefined && !isJsonArray(bindings)) {
    issues.push(problem('BINDINGS_ARRAY', 'block', 'rule_bindings 需要数组（规则绑定表）', 'rule_bindings'))
    return issues
  }
  if (!isJsonArray(bindings)) return issues

  const ruleById = new Map<string, JsonObject>()
  for (const rule of rulesOfRoot(root)) {
    const ruleId = typeof rule.id === 'string' ? rule.id : undefined
    if (ruleId) ruleById.set(ruleId, rule)
  }

  const seenIds = new Set<string>()
  bindings.forEach((entry, index) => {
    const base = `rule_bindings[${index}]`
    if (!isJsonObject(entry)) {
      issues.push(problem('BINDING_TYPE', 'block', '需要对象（规则绑定）', base))
      return
    }
    const id = entry.id
    if (typeof id === 'string' && id.length > 0 && RULE_ID_PATTERN.test(id)) {
      if (seenIds.has(id)) {
        issues.push(problem('BINDING_ID_DUPLICATE', 'block', `重复的绑定 id: ${id}`, `${base}.id`))
      } else {
        seenIds.add(id)
      }
    }
    issues.push(...validateBinding(entry, { refs, basePath: base }))
    issues.push(...diagnoseBindingReachability(entry, base, refs, ruleById))
  })

  issues.push(...detectScheduleCycles(bindings))
  issues.push(...diagnoseExitSynonymMix(bindings))
  return issues
}

/** 三种当前行为一致的同义出口（11-10 §五种出口；保留原文，不自动改写）。 */
const SYNONYM_EXIT_KINDS: readonly string[] = ['continue', 'return', 'end_execution']

/**
 * 绑定级静态诊断：持有等待未来局部时间、持有等待不会开始的片段、条件内 clip_fact 可达性。
 * 结构 / 引用错误已由 {@link validateBinding} 与规则定义侧报告，这里只补可达性类提示。
 */
function diagnoseBindingReachability(
  binding: JsonObject,
  base: string,
  refs: BehaviorRefs,
  ruleById: ReadonlyMap<string, JsonObject>,
): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const ruleId = typeof binding.rule === 'string' ? binding.rule : undefined
  const clip = typeof binding.clip === 'string' ? binding.clip : undefined
  const hostClipKnown = clip !== undefined && refs.clipIds.has(clip)
  const ruleDef = ruleId ? ruleById.get(ruleId) : undefined

  // 条件树 clip_fact 可达性（宿主片段语境；宿主片段缺失 / 未登记已由引用校验 block 在先）。
  if (ruleDef && hostClipKnown) {
    issues.push(...validateConditionReachability(ruleDef.condition, {
      refs,
      clipId: clip,
      bindingId: typeof binding.id === 'string' ? binding.id : undefined,
      basePath: `${base}.condition`,
    }))
  }

  const control = typeof binding.control === 'string' ? binding.control : 'observe'
  if (control !== 'hold') return issues

  // 持有冻结期间局部时间不推进：条件里晚于时间门的 time 阈值可能永远等不到。
  const gate = binding.gate
  const gateAt = isJsonObject(gate) && isFiniteNumber(gate.at) ? gate.at : undefined
  if (ruleDef && gateAt !== undefined) {
    const future = collectConditionTimeThresholds(ruleDef.condition).filter((threshold) => threshold > gateAt)
    if (future.length > 0) {
      issues.push(problem('BINDING_HOLD_FUTURE_TIME', 'warn',
        `持有（hold）冻结期间局部时间不推进；条件含未来局部时间 ${future.map((t) => `${t}s`).join(' / ')}，冻结后可能永远等不到`,
        `${base}.control`))
    }
  }

  // 持有等待的调度目标片段在时间线上不会开始。
  const schedule = binding.schedule
  if (hostClipKnown && isJsonObject(schedule) && typeof schedule.clip === 'string' && schedule.clip.length > 0) {
    const result = classifyClipReachability(refs, clip, schedule.clip)
    if (result.status === 'unreachable') {
      issues.push(problem('BINDING_HOLD_UNREACHABLE_CLIP', 'warn',
        `持有等待的目标片段 ${schedule.clip} 在时间线上不会开始（${result.reason ?? '顺序上不可达'}），可能永远等不到`,
        `${base}.schedule.clip`))
    } else if (result.status === 'unknown') {
      issues.push(problem('BINDING_TIMELINE_MISSING', 'info',
        `${result.reason ?? '缺少时间线事实'}，无法判定调度目标 ${schedule.clip} 的可达性`,
        `${base}.schedule.clip`))
    }
  }

  return issues
}

/** 同一片段的多条绑定混用同义出口（continue / return / end_execution）→ 提示，不改写。 */
function diagnoseExitSynonymMix(bindings: JsonArray): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const kindsByClip = new Map<string, Set<string>>()
  for (const entry of bindings) {
    if (!isJsonObject(entry)) continue
    const clip = typeof entry.clip === 'string' ? entry.clip : undefined
    const exit = entry.exit
    if (!clip || !isJsonObject(exit)) continue
    const kind = exit.on_complete
    if (typeof kind !== 'string' || !SYNONYM_EXIT_KINDS.includes(kind)) continue
    const kinds = kindsByClip.get(clip) ?? new Set<string>()
    kinds.add(kind)
    kindsByClip.set(clip, kinds)
  }

  for (const [clip, kinds] of kindsByClip) {
    if (kinds.size < 2) continue
    issues.push(problem('BINDING_EXIT_SYNONYM_MIX', 'info',
      `片段 ${clip} 的多条绑定混用 ${[...kinds].join(' / ')}；三者当前行为一致（都结束分支回主线），保留原文不改写`,
      `rule_bindings[${clip}].exit`))
  }
  return issues
}

/** fact 调度成环检测：A 等 B、B 等 A → block（前向引用合法，成环非法）。 */
function detectScheduleCycles(bindings: JsonArray): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const adjacency = new Map<string, string>()

  bindings.forEach((entry) => {
    if (!isJsonObject(entry)) return
    const id = typeof entry.id === 'string' ? entry.id : undefined
    const schedule = entry.schedule
    if (id && isJsonObject(schedule) && schedule.on === 'fact') {
      const dep = typeof schedule.binding === 'string' ? schedule.binding : undefined
      if (dep) adjacency.set(id, dep)
    }
  })

  const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string, path: string[]): void => {
    const mark = state.get(id) ?? 0
    if (mark === 1) {
      issues.push(problem('BINDING_SCHEDULE_CYCLE', 'block',
        `fact 调度形成循环依赖: ${[...path, id].join(' → ')}`, `rule_bindings[${id}].schedule`))
      return
    }
    if (mark === 2) return
    state.set(id, 1)
    const dep = adjacency.get(id)
    if (dep) visit(dep, [...path, id])
    state.set(id, 2)
  }

  for (const id of adjacency.keys()) {
    visit(id, [])
  }
  return issues
}

// ── 引用保护（删除绑定 / 删除规则用）────────────────────────────────────────────

/** 被其他绑定的 fact 调度、或规则条件树 rule_fact 引用的对象引用。 */
export interface BindingReference {
  ref: RecordRef
  detail: string
}

/** 找出引用某绑定 id 的全部位置（调度 fact.binding + 规则条件树 rule_fact.binding）。 */
export function referencesToBinding(root: JsonObject, bindingId: string): BindingReference[] {
  const references: BindingReference[] = []

  for (const entry of bindingsOfRoot(root)) {
    const selfId = typeof entry.id === 'string' ? entry.id : undefined
    const schedule = entry.schedule
    if (isJsonObject(schedule) && schedule.on === 'fact' && schedule.binding === bindingId) {
      references.push({
        ref: { kind: 'binding', id: selfId ?? '?' },
        detail: `调度等待绑定 ${bindingId} 的事实`,
      })
    }
  }

  for (const rule of rulesOfRoot(root)) {
    const ruleId = typeof rule.id === 'string' ? rule.id : '?'
    collectConditionBindingRefs(rule.condition, bindingId, ruleId, references)
  }

  return references
}

function rulesOfRoot(root: JsonObject): JsonObject[] {
  const rules = root.rules
  if (!isJsonArray(rules)) return []
  return rules.filter(isJsonObject)
}

function collectConditionBindingRefs(
  node: JsonValue,
  bindingId: string,
  ruleId: string,
  out: BindingReference[],
): void {
  if (!isJsonObject(node)) return
  if (node.type === 'rule_fact' && node.binding === bindingId) {
    out.push({ ref: { kind: 'rule', id: ruleId }, detail: `规则条件引用绑定 ${bindingId} 的事实` })
    return
  }
  const list = node.list
  if (isJsonArray(list)) {
    list.forEach((child) => {
      const data = isJsonObject(child) && isJsonObject(child.conditions) ? child.conditions : child
      collectConditionBindingRefs(data, bindingId, ruleId, out)
    })
  }
}

// ── 事务性重命名 ──────────────────────────────────────────────────────────────

/**
 * 事务性重命名绑定 id：一次性改绑定自身、全部 `schedule.fact.binding` 引用、
 * 以及所有规则条件树里的 `rule_fact.binding`。
 *
 * 返回新根（深拷贝），不改入参；`from` 不存在、`to` 非法、`to` 被占用 → 整体抛错。
 */
export function renameBindingId(root: JsonObject, from: string, to: string): JsonObject {
  if (typeof from !== 'string' || from.length === 0) {
    throw new Error('renameBindingId: 原绑定 id 缺失或不是非空字符串')
  }
  if (typeof to !== 'string' || to.length === 0) {
    throw new Error('renameBindingId: 新绑定 id 缺失或不是非空字符串')
  }
  if (!RULE_ID_PATTERN.test(to)) {
    throw new Error(`renameBindingId: 新绑定 id 不合法（${RULE_ID_PATTERN.source}）: ${to}`)
  }

  const next = cloneJson(root)
  const bindings = next.rule_bindings
  if (!isJsonArray(bindings)) {
    throw new Error(`renameBindingId: 绑定表不存在或不是数组（未找到绑定 ${from}）`)
  }

  let found = false
  for (const entry of bindings) {
    if (!isJsonObject(entry)) continue
    if (entry.id === from) {
      found = true
      entry.id = to
    } else if (entry.id === to) {
      throw new Error(`renameBindingId: 新绑定 id 已被占用: ${to}`)
    }
  }
  if (!found) {
    throw new Error(`renameBindingId: 未找到绑定 ${from}`)
  }

  for (const entry of bindings) {
    if (!isJsonObject(entry)) continue
    const schedule = entry.schedule
    if (isJsonObject(schedule) && schedule.on === 'fact' && schedule.binding === from) {
      schedule.binding = to
    }
  }

  for (const rule of rulesOfRoot(next)) {
    renameConditionBinding(rule.condition, from, to)
  }

  return next
}

function renameConditionBinding(node: JsonValue, from: string, to: string): void {
  if (!isJsonObject(node)) return
  if (node.type === 'rule_fact' && node.binding === from) {
    node.binding = to
  }
  const list = node.list
  if (isJsonArray(list)) {
    list.forEach((child) => {
      const data = isJsonObject(child) && isJsonObject(child.conditions) ? child.conditions : child
      renameConditionBinding(data, from, to)
    })
  }
}

// ── 摘要（唯一生成处）─────────────────────────────────────────────────────────

/** 生成绑定行摘要：身份 · 时间门 · 控制 · 调度 · 出口。 */
export function describeBinding(binding: JsonValue, _ctx: BindingContext = {}): string {
  if (!isJsonObject(binding)) return '绑定不是对象'
  const id = typeof binding.id === 'string' && binding.id.length > 0 ? binding.id : '未命名绑定'
  const rule = typeof binding.rule === 'string' ? binding.rule : '?'
  const clip = typeof binding.clip === 'string' ? binding.clip : '?'

  const parts: string[] = [`${id} → 规则 ${rule} / 片段 ${clip}`]

  const gate = binding.gate
  if (isJsonObject(gate) && isFiniteNumber(gate.at)) {
    parts.push(`门 at=${fmt(gate.at)}s`)
  } else {
    parts.push('时间门缺失')
  }

  const control = typeof binding.control === 'string' ? binding.control : 'observe'
  parts.push(control === 'hold' ? '持有' : '观察')

  const schedule = binding.schedule
  if (isJsonObject(schedule)) {
    parts.push(describeSchedule(schedule))
  } else {
    parts.push('提交时点：绑定创建时')
  }

  const exit = binding.exit
  if (isJsonObject(exit)) {
    parts.push(describeExit(exit))
  }

  return parts.join(' · ')
}

function describeSchedule(schedule: JsonObject): string {
  const on = typeof schedule.on === 'string' ? schedule.on : '?'
  switch (on) {
    case 'clip_start':
      return `片段 ${String(schedule.clip ?? '?')} 开始时`
    case 'clip_complete':
      return `片段 ${String(schedule.clip ?? '?')} 完成时`
    case 'local_time':
      return `片段 ${String(schedule.clip ?? '?')} 局部 ${fmt(schedule.at)}s`
    case 'delay':
      return `延迟 ${fmt(schedule.seconds)}s（真实时间）`
    case 'fact': {
      const fact = schedule.fact === 'action_completed' ? '动作批次已提交' : '条件成立'
      return `等待绑定 ${String(schedule.binding ?? '?')} ${fact}`
    }
    default:
      return `调度 ${on}`
  }
}

function describeExit(exit: JsonObject): string {
  const kind = typeof exit.on_complete === 'string' ? exit.on_complete : '?'
  if (kind === 'goto') {
    const target = String(exit.target ?? '?')
    const entryTime = isFiniteNumber(exit.entry_time) ? exit.entry_time : 0
    return `出口 goto ${target}（入口 ${fmt(entryTime)}s）`
  }
  return `出口 ${EXIT_KIND_INFO[kind]?.label ?? kind}`
}

/** 绑定动作引用的规则动作里是否含 goto_clip（分支出口归属判定用）。 */
export function bindingUsesGotoClip(ruleActions: JsonValue): boolean {
  if (!isJsonArray(ruleActions)) return false
  return ruleActions.some(
    (action) => isJsonObject(action) && action.type === 'goto_clip',
  )
}

function fmt(value: JsonValue | undefined): string {
  if (!isFiniteNumber(value)) return '?'
  return String(Math.round(value * 100) / 100)
}
