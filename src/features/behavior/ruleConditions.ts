/**
 * 11 轮规则条件树纯函数：12 类型字段面 / 边界校验 + 唯一摘要生成处。
 *
 * 树形形态：叶子节点字段平铺在节点上（无 `conditions` 包装）；组合器子项为
 * `{ type, conditions }`；嵌套最大 8 层。条件校验不读播放运行时，只判文档自身。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import {
  describe,
  isFiniteNumber,
  isJsonArray,
  isJsonObject,
} from '../../core/doc/json.ts'
import type { BehaviorProblem } from './shared.ts'
import {
  CLIP_FACT_NAMES,
  COMBINATOR_CONDITION_TYPES,
  RULE_CONDITION_MAX_DEPTH,
  RULE_CONDITION_TYPES,
  RULE_FACT_NAMES,
  classifyClipReachability,
  conditionTypeInfo,
  type BehaviorRefs,
} from '../../core/schema/catalog/behaviorRules.ts'

// ── 上下文 ──────────────────────────────────────────────────────────────────

/** 条件树校验 / 摘要上下文。 */
export interface ConditionContext {
  refs?: BehaviorRefs
  /** 当前正在查看的绑定 id（rule_fact 自引用判定用）。 */
  bindingId?: string
  /** 当前绑定宿主片段 id（clip_fact 可达性判定用）；规则定义独立校验时缺省。 */
  clipId?: string
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

// ── 校验入口 ──────────────────────────────────────────────────────────────────

/** 校验整棵规则条件树（顶层节点）。 */
export function validateRuleCondition(node: JsonValue, ctx: ConditionContext = {}): BehaviorProblem[] {
  const basePath = ctx.basePath ?? 'condition'
  return validateNode(node, basePath, 1, ctx)
}

function validateNode(
  node: JsonValue,
  path: string,
  depth: number,
  ctx: ConditionContext,
): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []

  if (!isJsonObject(node)) {
    issues.push(problem('RULE_CONDITION_NODE_TYPE', 'block', '条件节点需要对象', path))
    return issues
  }

  const type = node.type
  if (typeof type !== 'string' || type.length === 0) {
    issues.push(problem('RULE_CONDITION_TYPE_MISSING', 'block', '条件类型缺失（必填 type）', `${path}.type`))
    return issues
  }

  const info = conditionTypeInfo(type)
  if (!info) {
    issues.push(problem('RULE_CONDITION_TYPE_UNKNOWN', 'block',
      `规则条件不支持该判定源: ${type}（可选: ${RULE_CONDITION_TYPES.join(' / ')}）`, `${path}.type`))
    return issues
  }

  const knownKeys = info.fields.map((field) => field.key)
  for (const key of Object.keys(node)) {
    if (key === 'type') continue
    if (!knownKeys.includes(key)) {
      issues.push(problem('RULE_CONDITION_UNKNOWN_KEY', 'block',
        `未知键（${type} 可用: ${knownKeys.join(' / ')}）`, `${path}.${key}`))
    }
  }

  if (COMBINATOR_CONDITION_TYPES.includes(type)) {
    validateCombination(node, path, depth, ctx, issues)
  } else {
    validateLeaf(type, node, path, ctx, issues)
  }

  return issues
}

// ── 组合器 ────────────────────────────────────────────────────────────────────

function validateCombination(
  node: JsonObject,
  path: string,
  depth: number,
  ctx: ConditionContext,
  issues: BehaviorProblem[],
): void {
  const list = node.list
  if (!isJsonArray(list)) {
    issues.push(problem('RULE_CONDITION_LIST_TYPE', 'block',
      '组合器需要非空 list 数组（子条件）', `${path}.list`))
    return
  }
  if (list.length === 0) {
    issues.push(problem('RULE_CONDITION_LIST_EMPTY', 'error',
      '组合器 list 为空（空列表表示不满足；请补子条件或删除该组合器）', `${path}.list`))
    return
  }
  if (depth > RULE_CONDITION_MAX_DEPTH) {
    issues.push(problem('RULE_CONDITION_DEPTH', 'block',
      `组合器嵌套超过 ${RULE_CONDITION_MAX_DEPTH} 层`, path))
    return
  }

  list.forEach((child, index) => {
    const childPath = `${path}.list[${index}]`
    if (!isJsonObject(child)) {
      issues.push(problem('RULE_CONDITION_CHILD_TYPE', 'block', '子条件需要对象', childPath))
      return
    }
    if (!Object.prototype.hasOwnProperty.call(child, 'conditions')) {
      // 叶子平铺形态（兼容旧文档：子项直接带字段）。
      issues.push(...validateNode(child, childPath, depth + 1, ctx))
      return
    }
    const data = child.conditions
    if (!isJsonObject(data)) {
      issues.push(problem('RULE_CONDITION_CHILD_DATA_TYPE', 'block',
        '子条件 conditions 需要对象', `${childPath}.conditions`))
      return
    }
    issues.push(...validateNode({ type: child.type, ...data }, `${childPath}.conditions`, depth + 1, ctx))
  })
}

// ── 叶子 ─────────────────────────────────────────────────────────────────────

function validateLeaf(
  type: string,
  node: JsonObject,
  path: string,
  ctx: ConditionContext,
  issues: BehaviorProblem[],
): void {
  switch (type) {
    case 'time':
      validateTime(node, path, issues)
      break
    case 'location':
      validateLocation(node, path, issues)
      break
    case 'facing':
    case 'camera_facing':
      validateFacing(node, path, issues)
      break
    case 'biome':
      validateStringField(node, 'biome', path, issues, 'biome')
      break
    case 'dimension':
      validateStringField(node, 'dimension', path, issues, 'dimension')
      break
    case 'camera_pos':
      validateCameraPos(node, path, issues)
      break
    case 'camera_fov':
      validateFov(node, path, issues)
      break
    case 'clip_fact':
      validateClipFact(node, path, ctx, issues)
      break
    case 'rule_fact':
      validateRuleFact(node, path, ctx, issues)
      break
    default:
      break
  }
}

function validateTime(node: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const at = node.at
  const from = node.from
  const to = node.to
  const hasAt = at !== undefined
  const hasRange = from !== undefined || to !== undefined

  if (!hasAt && !hasRange) {
    issues.push(problem('RULE_CONDITION_TIME_EMPTY', 'block',
      'time 缺少时间参数（at 或 from/to；三个都缺 = 永不满足）', path))
    return
  }
  if (hasAt && hasRange) {
    issues.push(problem('RULE_CONDITION_TIME_MUTEX', 'error',
      'at 与 from/to 互斥（不能同时写）', `${path}.at`))
  }
  if (at !== undefined && !isFiniteNumber(at)) {
    issues.push(problem('RULE_CONDITION_TIME_AT', 'error', `at 需要有限数字（秒），实际: ${describe(at)}`, `${path}.at`))
  }
  if (from !== undefined && !isFiniteNumber(from)) {
    issues.push(problem('RULE_CONDITION_TIME_FROM', 'error', `from 需要有限数字（秒），实际: ${describe(from)}`, `${path}.from`))
  }
  if (to !== undefined && !isFiniteNumber(to)) {
    issues.push(problem('RULE_CONDITION_TIME_TO', 'error', `to 需要有限数字（秒），实际: ${describe(to)}`, `${path}.to`))
  }
}

function validateLocation(node: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const hasDimension = node.dimension !== undefined
  if (hasDimension && typeof node.dimension !== 'string') {
    issues.push(problem('RULE_CONDITION_LOCATION_DIMENSION', 'error',
      'dimension 需要字符串（维度 id 精确相等）', `${path}.dimension`))
  }

  const box = validateBox(node, path, issues, 'location')
  const sphere = validateSphere(node, path, issues)

  if (!box && !sphere && !hasDimension) {
    issues.push(problem('RULE_CONDITION_LOCATION_EMPTY', 'block',
      'location 缺少方体 / 球形区域或维度（都无 = 永不满足）', path))
  }
}

function validateCameraPos(node: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const box = validateBox(node, path, issues, 'camera_pos')
  const sphere = validateSphere(node, path, issues)

  if (!box && !sphere) {
    issues.push(problem('RULE_CONDITION_CAMERA_POS_EMPTY', 'block',
      'camera_pos 需要方体或球形区域（无区域 = 永不满足；本类型不看维度）', path))
  }
  if (box && sphere) {
    issues.push(problem('RULE_CONDITION_CAMERA_POS_BOTH', 'warn',
      '同时写了方体与球形：方体优先，球形被忽略（与 location 的先方体后球 OR 语义相反）', `${path}.position`))
  }
}

/** 校验方体两角；返回是否两个角点都合法。 */
function validateBox(node: JsonObject, path: string, issues: BehaviorProblem[], type: string): boolean {
  const corner1 = node.corner1
  const corner2 = node.corner2
  const hasOne = corner1 !== undefined || corner2 !== undefined
  if (!hasOne) return false

  if (corner1 !== undefined && !isJsonObject(corner1)) {
    issues.push(problem('RULE_CONDITION_BOX_CORNER1', 'error', 'corner1 需要对象 {x,y,z}', `${path}.corner1`))
  }
  if (corner2 !== undefined && !isJsonObject(corner2)) {
    issues.push(problem('RULE_CONDITION_BOX_CORNER2', 'error', 'corner2 需要对象 {x,y,z}', `${path}.corner2`))
  }
  const bothObject = isJsonObject(corner1) && isJsonObject(corner2)
  if (!bothObject) {
    issues.push(problem('RULE_CONDITION_BOX_PAIR', 'error',
      `${type} 方体两角需成对出现（corner1 与 corner2 都写）`, path))
    return false
  }
  validateAxis(corner1, 'corner1', path, issues)
  validateAxis(corner2, 'corner2', path, issues)
  return true
}

/** 校验球形；返回是否球心合法。 */
function validateSphere(node: JsonObject, path: string, issues: BehaviorProblem[]): boolean {
  const position = node.position
  if (position === undefined) return false
  if (!isJsonObject(position)) {
    issues.push(problem('RULE_CONDITION_SPHERE_POSITION', 'error', 'position 需要对象 {x,y,z}', `${path}.position`))
    return false
  }
  validateAxis(position, 'position', path, issues)
  const radius = node.radius
  if (radius !== undefined && (!isFiniteNumber(radius) || radius < 0)) {
    issues.push(problem('RULE_CONDITION_SPHERE_RADIUS', 'error',
      `radius 需要 >= 0 的有限数字（方块），实际: ${describe(radius)}`, `${path}.radius`))
  }
  return true
}

function validateAxis(object: JsonObject, key: string, path: string, issues: BehaviorProblem[]): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = object[axis]
    if (!isFiniteNumber(value)) {
      issues.push(problem(`RULE_CONDITION_AXIS_${key.toUpperCase()}_${axis.toUpperCase()}`, 'error',
        `${key}.${axis} 需要有限数字`, `${path}.${key}.${axis}`))
    }
  }
}

function validateFacing(node: JsonObject, path: string, issues: BehaviorProblem[]): void {
  for (const key of ['yaw1', 'pitch1', 'yaw2', 'pitch2'] as const) {
    const value = node[key]
    if (value === undefined) {
      issues.push(problem(`RULE_CONDITION_FACING_${key.toUpperCase()}_MISSING`, 'block',
        `朝向区间缺少 ${key}（四个角点都要写）`, `${path}.${key}`))
    } else if (!isFiniteNumber(value)) {
      issues.push(problem(`RULE_CONDITION_FACING_${key.toUpperCase()}`, 'error',
        `${key} 需要有限数字（度），实际: ${describe(value)}`, `${path}.${key}`))
    }
  }
}

function validateFov(node: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const from = node.from
  const to = node.to
  if (from === undefined && to === undefined) {
    issues.push(problem('RULE_CONDITION_FOV_EMPTY', 'block',
      'camera_fov 缺少 from / to（至少写一边，闭区间）', path))
    return
  }
  if (from !== undefined && !isFiniteNumber(from)) {
    issues.push(problem('RULE_CONDITION_FOV_FROM', 'error', `from 需要有限数字（度），实际: ${describe(from)}`, `${path}.from`))
  }
  if (to !== undefined && !isFiniteNumber(to)) {
    issues.push(problem('RULE_CONDITION_FOV_TO', 'error', `to 需要有限数字（度），实际: ${describe(to)}`, `${path}.to`))
  }
}

function validateStringField(
  node: JsonObject,
  key: string,
  path: string,
  issues: BehaviorProblem[],
  label: string,
): void {
  const value = node[key]
  if (value === undefined) {
    issues.push(problem(`RULE_CONDITION_${key.toUpperCase()}_MISSING`, 'block', `${label} id 缺失`, `${path}.${key}`))
  } else if (typeof value !== 'string' || value.length === 0) {
    issues.push(problem(`RULE_CONDITION_${key.toUpperCase()}_TYPE`, 'error',
      `${label} id 需要非空字符串，实际: ${describe(value)}`, `${path}.${key}`))
  }
}

function validateClipFact(
  node: JsonObject,
  path: string,
  ctx: ConditionContext,
  issues: BehaviorProblem[],
): void {
  const clip = node.clip
  if (typeof clip !== 'string' || clip.length === 0) {
    issues.push(problem('RULE_CONDITION_CLIP_MISSING', 'block', 'clip_fact 缺少片段 id', `${path}.clip`))
  } else if (ctx.refs && !ctx.refs.clipIds.has(clip)) {
    issues.push(problem('RULE_CONDITION_CLIP_UNKNOWN', 'block', `未知片段引用: ${clip}`, `${path}.clip`))
  } else if (ctx.refs && ctx.clipId !== undefined) {
    issues.push(...checkClipFactReachability(clip, `${path}.clip`, ctx))
  }
  validateFactName(node, 'fact', CLIP_FACT_NAMES, path, issues)
}

/**
 * clip_fact 静态可达性：目标在宿主片段活跃窗口之外 → warn「可能永远等不到」；
 * 时间线事实缺失 → info「无法判定」；目标有效无限 / 保守可达 → 不报警。
 */
function checkClipFactReachability(clip: string, path: string, ctx: ConditionContext): BehaviorProblem[] {
  const refs = ctx.refs
  if (!refs) return []
  const result = classifyClipReachability(refs, ctx.clipId, clip)
  if (result.status === 'unreachable') {
    return [problem('RULE_CONDITION_CLIP_UNREACHABLE', 'warn',
      `片段 ${clip} 在当前绑定片段之外（${result.reason ?? '顺序上不可达'}），其事实可能永远等不到`, path)]
  }
  if (result.status === 'unknown') {
    return [problem('RULE_CONDITION_TIMELINE_MISSING', 'info',
      `${result.reason ?? '缺少时间线事实'}，无法判定片段 ${clip} 的可达性`, path)]
  }
  return []
}

function validateRuleFact(
  node: JsonObject,
  path: string,
  ctx: ConditionContext,
  issues: BehaviorProblem[],
): void {
  const binding = node.binding
  if (typeof binding !== 'string' || binding.length === 0) {
    issues.push(problem('RULE_CONDITION_BINDING_MISSING', 'block', 'rule_fact 缺少绑定 id', `${path}.binding`))
  } else {
    if (ctx.refs && !ctx.refs.bindingIds.has(binding)) {
      issues.push(problem('RULE_CONDITION_BINDING_UNKNOWN', 'block', `未知绑定引用: ${binding}`, `${path}.binding`))
    }
    if (ctx.bindingId !== undefined && binding === ctx.bindingId) {
      issues.push(problem('RULE_CONDITION_BINDING_SELF', 'warn',
        `规则事实引用自身绑定 ${binding}：该事实只能在下一轮满足，当前判定不会成立`, `${path}.binding`))
    }
  }
  validateFactName(node, 'fact', RULE_FACT_NAMES, path, issues)
}

function validateFactName(
  node: JsonObject,
  key: string,
  allowed: readonly string[],
  path: string,
  issues: BehaviorProblem[],
): void {
  const fact = node[key]
  if (fact === undefined) {
    issues.push(problem('RULE_CONDITION_FACT_MISSING', 'block', `缺少事实名（可选: ${allowed.join(' / ')}）`, `${path}.${key}`))
  } else if (typeof fact !== 'string' || !allowed.includes(fact)) {
    issues.push(problem('RULE_CONDITION_FACT', 'error',
      `事实名需要 ${allowed.join(' / ')}，实际: ${describe(fact)}`, `${path}.${key}`))
  }
}

// ── 旧字段收集（面板只读旧字段块用）───────────────────────────────────────────

/** 返回当前类型字段表之外、节点上仍残留的旧键（切类型后不可编辑，只读保留）。 */
export function legacyConditionKeys(node: JsonValue): string[] {
  if (!isJsonObject(node)) return []
  const type = typeof node.type === 'string' ? node.type : undefined
  const info = type ? conditionTypeInfo(type) : undefined
  const known = new Set(['type', ...(info ? info.fields.map((field) => field.key) : [])])
  return Object.keys(node).filter((key) => !known.has(key))
}

// ── 跨节点静态扫描（绑定 / 规则级诊断复用）─────────────────────────────────────

/** 遍历条件树全部叶子节点（兼容顶层平铺与组合器 `{type, conditions}` 两种形态）。 */
function walkConditionTree(node: JsonValue, visit: (leaf: JsonObject, type: string) => void): void {
  if (!isJsonObject(node)) return
  const type = typeof node.type === 'string' ? node.type : undefined
  const data = isJsonObject(node.conditions) ? node.conditions : node
  if (type) visit(data, type)
  const list = data.list
  if (isJsonArray(list)) {
    list.forEach((child) => {
      if (!isJsonObject(child)) return
      const childData = isJsonObject(child.conditions) ? child.conditions : child
      walkConditionTree({ ...childData, type: child.type }, visit)
    })
  }
}

/**
 * 仅跑 `clip_fact` 可达性诊断（绑定宿主片段上下文；结构 / 引用校验由规则定义侧负责）。
 * 供绑定集合级校验在宿主片段语境下补报「片段之外 / 起点晚于结束」警告。
 */
export function validateConditionReachability(node: JsonValue, ctx: ConditionContext = {}): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const basePath = ctx.basePath ?? 'condition'
  walkConditionTree(node, (leaf, type) => {
    if (type !== 'clip_fact') return
    const clip = leaf.clip
    if (typeof clip !== 'string' || clip.length === 0) return
    if (ctx.refs && !ctx.refs.clipIds.has(clip)) return
    issues.push(...checkClipFactReachability(clip, `${basePath}.clip`, ctx))
  })
  return issues
}

/** 收集条件树内全部 `time` 叶子的时间阈值（`at` / `from` 取大者；非法值忽略）。 */
export function collectConditionTimeThresholds(node: JsonValue): number[] {
  const thresholds: number[] = []
  walkConditionTree(node, (leaf, type) => {
    if (type !== 'time') return
    const atNum = isFiniteNumber(leaf.at) ? leaf.at : undefined
    const fromNum = isFiniteNumber(leaf.from) ? leaf.from : undefined
    const threshold = atNum !== undefined && fromNum !== undefined
      ? Math.max(atNum, fromNum)
      : (atNum ?? fromNum)
    if (threshold !== undefined) thresholds.push(threshold)
  })
  return thresholds
}

// ── 摘要（唯一生成处）─────────────────────────────────────────────────────────

/** 生成条件树摘要；未知类型 / 非法形态给占位描述，不抛错。 */
export function describeRuleCondition(node: JsonValue, ctx: ConditionContext = {}): string {
  const lines = describeNode(node, 0, ctx)
  return lines.join('\n')
}

function describeNode(node: JsonValue, depth: number, ctx: ConditionContext): string[] {
  if (!isJsonObject(node)) return ['条件不是对象']
  const type = typeof node.type === 'string' ? node.type : undefined
  if (!type) return ['条件类型缺失']
  const info = conditionTypeInfo(type)
  if (!info) return [`未知条件类型 ${type}`]

  if (COMBINATOR_CONDITION_TYPES.includes(type)) {
    const title = type === 'all_of' ? '全部满足' : '任一满足'
    const lines = [title]
    const list = node.list
    if (isJsonArray(list)) {
      list.forEach((child) => {
        const data = isJsonObject(child) && isJsonObject(child.conditions) ? child.conditions : child
        describeNode(data, depth + 1, ctx).forEach((line) => lines.push(`  ${line}`))
      })
    }
    return lines
  }

  return [describeLeaf(type, node)]
}

function describeLeaf(type: string, node: JsonObject): string {
  switch (type) {
    case 'time':
      return describeTime(node)
    case 'location':
      return describeLocation(node, '玩家位置')
    case 'facing':
      return `朝向 ${describeFacing(node)}`
    case 'biome':
      return `群系 ${String(node.biome ?? '?')}`
    case 'dimension':
      return `维度 ${String(node.dimension ?? '?')}`
    case 'camera_pos':
      return describeLocation(node, '相机位置')
    case 'camera_facing':
      return `相机朝向 ${describeFacing(node)}`
    case 'camera_fov':
      return describeFov(node)
    case 'clip_fact': {
      const clip = String(node.clip ?? '?')
      return node.fact === 'completed' ? `片段 ${clip} 已完成` : `片段 ${clip} 已开始`
    }
    case 'rule_fact': {
      const binding = String(node.binding ?? '?')
      return node.fact === 'action_completed'
        ? `绑定 ${binding} 动作批次已提交`
        : `绑定 ${binding} 条件成立`
    }
    default:
      return `未知条件类型 ${type}`
  }
}

function describeTime(node: JsonObject): string {
  const at = node.at
  if (isFiniteNumber(at)) return `本地 t ≥ ${fmt(at)}s`
  const from = node.from
  const to = node.to
  if (isFiniteNumber(from) && isFiniteNumber(to)) return `本地 t ${fmt(from)}–${fmt(to)}s`
  if (isFiniteNumber(from)) return `本地 t ≥ ${fmt(from)}s`
  if (isFiniteNumber(to)) return `本地 t ≤ ${fmt(to)}s`
  return '本地 t（参数缺失）'
}

function describeLocation(node: JsonObject, label: string): string {
  const parts: string[] = []
  if (typeof node.dimension === 'string') parts.push(`维度 ${node.dimension}`)
  const corner1 = node.corner1
  const corner2 = node.corner2
  if (isJsonObject(corner1) && isJsonObject(corner2)) {
    parts.push(`方体 ${point(corner1)} ~ ${point(corner2)}`)
  }
  if (isJsonObject(node.position)) {
    const radius = isFiniteNumber(node.radius) ? node.radius : 0
    parts.push(`球心 ${point(node.position)} r=${fmt(radius)}`)
  }
  return parts.length > 0 ? `${label} ${parts.join(' ∨ ')}` : `${label}（区域缺失）`
}

function describeFacing(node: JsonObject): string {
  const yaw1 = fmt(node.yaw1)
  const pitch1 = fmt(node.pitch1)
  const yaw2 = fmt(node.yaw2)
  const pitch2 = fmt(node.pitch2)
  if (node.yaw1 === node.yaw2 && node.pitch1 === node.pitch2) {
    return `固定 ${yaw1}/${pitch1}（整圈）`
  }
  return `${yaw1}/${pitch1} → ${yaw2}/${pitch2}`
}

function describeFov(node: JsonObject): string {
  const from = node.from
  const to = node.to
  if (isFiniteNumber(from) && isFiniteNumber(to)) return `FOV ${fmt(from)}–${fmt(to)}°`
  if (isFiniteNumber(from)) return `FOV ≥ ${fmt(from)}°`
  if (isFiniteNumber(to)) return `FOV ≤ ${fmt(to)}°`
  return 'FOV（参数缺失）'
}

function point(object: JsonObject): string {
  return `(${fmt(object.x)}, ${fmt(object.y)}, ${fmt(object.z)})`
}

/** 数字摘要格式：最多两位小数，去掉尾随零。 */
function fmt(value: JsonValue | undefined): string {
  if (!isFiniteNumber(value)) return '?'
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}
