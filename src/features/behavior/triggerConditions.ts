/**
 * 11 轮触发器域条件树纯函数：递归编辑模型、深度上限、区域 / 物品 / 库存 / 经验 /
 * 朝向 / 注视等字段校验，以及条件摘要文本（列表 / 详情 / 悬停卡三处共用的唯一生成处）。
 *
 * 口径（与主模组 Java 对齐）：
 * - 组合器 `all_of` / `any`：`conditions.list` 非空数组，子项 `{ type, conditions }`；
 *   子项可为轮询类 / 事件类（事件类仅当触发器 `continuity.window > 0`）/ 三种脚本前置 /
 *   再嵌组合器；顶层算第 1 层，第 8 层禁新增嵌套；
 * - 物品 id 通配：`*` 全匹配、`ns:*` 前缀、无冒号子串、其余全等；不判非法写法；
 * - 未知类型 / 未登记字段原文只读，不编默认值；摘要长 id 不截断。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { isJsonObject, isJsonArray, isFiniteNumber, describe } from '../../core/doc/json.ts'
import type { BehaviorProblem } from './shared.ts'
import { triggerTypeInfo, isBuiltinRequirement } from '../../core/schema/catalog/behaviorTriggers.ts'
import type {
  ConditionValidationContext,
  RegionPoint,
  RegionView,
  TriggerConditionNode,
  TriggerNode,
} from './trigger.types.ts'
import { validateRequirementFields } from './requirements.ts'

/** 组合器嵌套深度上限（含顶层组合器自身为第 1 层）。 */
export const CONDITION_DEPTH_MAX = 8

// ── 子项角色 ──────────────────────────────────────────────────────────────────

/** 条件树子项角色。 */
export type ConditionRole = 'combinator' | 'prerequisite' | 'event' | 'poll' | 'unknown'

/** 判定一个类型键在条件树中的角色。 */
export function conditionRole(type: string): ConditionRole {
  if (isBuiltinRequirement(type)) return 'prerequisite'
  const info = triggerTypeInfo(type)
  if (info === undefined) return 'unknown'
  if (info.combinator) return 'combinator'
  return info.role === 'event' ? 'event' : 'poll'
}

// ── id 通配（与 GeometryConditions.matchesId 同口径）────────────────────────────

/**
 * id 通配匹配：`*` 全匹配；`ns:*` 命名空间前缀；无 `:` 子串包含；其余全等。
 * 不判非法写法（空串 / 畸形命名空间按规则自然不匹配）。
 */
export function matchesIdPattern(actual: string, pattern: string): boolean {
  if (pattern === '*' || pattern === actual) return true
  if (pattern.endsWith(':*')) {
    return actual.startsWith(pattern.slice(0, pattern.length - 1))
  }
  if (!pattern.includes(':')) {
    return actual.includes(pattern)
  }
  return false
}

// ── 区域视图 ────────────────────────────────────────────────────────────────

function readPoint(value: JsonValue | undefined): RegionPoint {
  if (!isJsonObject(value)) return { x: undefined, y: undefined, z: undefined }
  return {
    x: isFiniteNumber(value.x) ? value.x : undefined,
    y: isFiniteNumber(value.y) ? value.y : undefined,
    z: isFiniteNumber(value.z) ? value.z : undefined,
  }
}

/** 读取区域条件视图：球形（position+radius）与方体（corner1+corner2）可共存。 */
export function readRegionView(conditions: JsonObject): RegionView {
  const hasSphere = conditions.position !== undefined
  const hasBox = conditions.corner1 !== undefined && conditions.corner2 !== undefined
  return {
    sphere: hasSphere
      ? { position: readPoint(conditions.position), radius: isFiniteNumber(conditions.radius) ? conditions.radius : undefined }
      : undefined,
    box: hasBox
      ? { corner1: readPoint(conditions.corner1), corner2: readPoint(conditions.corner2) }
      : undefined,
  }
}

// ── 问题构造 ──────────────────────────────────────────────────────────────────

function issue(
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

// ── 字段类型校验（schema 驱动）────────────────────────────────────────────────

function fieldTypeOk(defType: string, value: JsonValue): boolean {
  switch (defType) {
    case 'string':
      return typeof value === 'string'
    case 'bool':
      return typeof value === 'boolean'
    case 'map':
      return isJsonObject(value)
    case 'array':
      return isJsonArray(value)
    case 'int':
      return isFiniteNumber(value) && isWholeNumber(value)
    case 'float':
      return isFiniteNumber(value)
    case 'enum':
      return typeof value === 'string'
    default:
      return true
  }
}

// ── 区域字段校验 ───────────────────────────────────────────────────────────────

function pointIncomplete(point: RegionPoint): boolean {
  return point.x === undefined || point.y === undefined || point.z === undefined
}

function regionIssues(conditions: JsonObject, path: string, issues: BehaviorProblem[]): void {
  if (conditions.position !== undefined) {
    if (!isJsonObject(conditions.position)) {
      issues.push(issue('REGION_POSITION_TYPE', 'error', 'position 必须是对象（形如 { "x": ..., "y": ..., "z": ... }）', `${path}.position`))
    } else if (pointIncomplete(readPoint(conditions.position))) {
      issues.push(issue('REGION_POSITION_INCOMPLETE', 'error', '球形中心缺少 x/y/z 分量，该条件永不满足', `${path}.position`))
    }
  }
  if (conditions.corner1 !== undefined || conditions.corner2 !== undefined) {
    if (!isJsonObject(conditions.corner1) || !isJsonObject(conditions.corner2)) {
      issues.push(issue('REGION_BOX_TYPE', 'error', 'corner1 / corner2 必须是对象（形如 { "x": ..., "y": ..., "z": ... }）', path))
    } else {
      const c1 = readPoint(conditions.corner1)
      const c2 = readPoint(conditions.corner2)
      if (pointIncomplete(c1) || pointIncomplete(c2)) {
        issues.push(issue('REGION_BOX_INCOMPLETE', 'error', '方体角点缺少 x/y/z 分量，该条件永不满足', path))
      }
    }
  }
  if (conditions.radius !== undefined && !isFiniteNumber(conditions.radius)) {
    issues.push(issue('REGION_RADIUS_TYPE', 'error', `radius 必须是数字，实际: ${describe(conditions.radius)}`, `${path}.radius`))
  }
}

// ── 跨字段语义校验 ───────────────────────────────────────────────────────────

function validateFacing(conditions: JsonObject, path: string, issues: BehaviorProblem[]): void {
  for (const key of ['yaw1', 'pitch1', 'yaw2', 'pitch2'] as const) {
    if (!isFiniteNumber(conditions[key])) {
      issues.push(issue('FACING_FIELD_MISSING', 'error', `facing 需要 ${key}（数字）`, `${path}.${key}`))
    }
  }
  const p1 = conditions.pitch1
  const p2 = conditions.pitch2
  if (isFiniteNumber(p1) && isFiniteNumber(p2)) {
    if (p1 < -90 || p1 > 90 || p2 < -90 || p2 > 90) {
      issues.push(issue('FACING_PITCH_RANGE', 'error', 'pitch 端点超出 -90~90（原版 pitch 范围），该条件永不满足', `${path}.pitch1`))
    }
  }
  const yaw1 = conditions.yaw1
  const yaw2 = conditions.yaw2
  if (isFiniteNumber(yaw1) && isFiniteNumber(yaw2) && yaw1 === yaw2) {
    issues.push(issue('FACING_FULL_CIRCLE', 'info', '起止 yaw 相同 = 整圈（不限制朝向）', `${path}.yaw2`))
  }
}

function validateXp(conditions: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const hasLevel = conditions.level !== undefined
  const hasTotal = conditions.total !== undefined
  if (!hasLevel && !hasTotal) {
    issues.push(issue('XP_EMPTY', 'error', '经验等级与总经验至少填一项', path))
  }
}

function validateInventory(conditions: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const items = conditions.items
  if (!isJsonArray(items) || items.length === 0) {
    issues.push(issue('INVENTORY_ITEMS_EMPTY', 'error', 'items 必须是非空物品 id 数组', `${path}.items`))
  }
}

function validateObservation(conditions: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const reach = conditions.reach
  if (reach !== undefined && (!isFiniteNumber(reach) || reach <= 0)) {
    issues.push(issue('OBSERVATION_REACH_INVALID', 'error', `reach 需要正数（格），缺省 4.5，实际: ${describe(reach)}`, `${path}.reach`))
  }
}

// ── 组合器递归校验 ────────────────────────────────────────────────────────────

/** 读取组合器 `list` 子项（编辑模型；非法元素落成 type 为空的节点）。 */
export function readConditionChildren(container: JsonObject): TriggerConditionNode[] {
  const list = container.list
  if (!isJsonArray(list)) return []
  const children: TriggerConditionNode[] = []
  for (const item of list) {
    if (isJsonObject(item)) {
      const type = typeof item.type === 'string' ? item.type : ''
      const conditions = isJsonObject(item.conditions) ? item.conditions : {}
      children.push({ type, conditions, raw: item })
    } else {
      children.push({ type: '', conditions: {}, raw: { value: item } })
    }
  }
  return children
}

function validateCombination(
  conditions: JsonObject,
  path: string,
  depth: number,
  windowTicks: number,
  ctx: ConditionValidationContext,
  issues: BehaviorProblem[],
): void {
  const list = conditions.list
  if (!isJsonArray(list)) {
    issues.push(issue('COMBINATOR_LIST_MISSING', 'error', '组合器需要 "list": [ { "type": ..., "conditions": { ... } }, ... ]', `${path}.list`))
    return
  }
  if (list.length === 0) {
    issues.push(issue('COMBINATOR_LIST_EMPTY', 'error', 'list 不能为空', `${path}.list`))
    return
  }

  list.forEach((item, index) => {
    const childPath = `${path}.list[${index}]`
    if (!isJsonObject(item)) {
      issues.push(issue('COMBINATOR_CHILD_NOT_OBJECT', 'block', '子项必须是对象 { type, conditions }；字符串条目写进 list 视为非法', childPath))
      return
    }
    const type = typeof item.type === 'string' ? item.type : ''
    if (type.length === 0) {
      issues.push(issue('COMBINATOR_CHILD_TYPE_MISSING', 'error', '子项 type 缺失或不是非空字符串', `${childPath}.type`))
      return
    }
    if (item.conditions !== undefined && !isJsonObject(item.conditions)) {
      issues.push(issue('COMBINATOR_CHILD_CONDITIONS_TYPE', 'error', '子项 conditions 必须是对象', `${childPath}.conditions`))
      return
    }
    const childConditions = isJsonObject(item.conditions) ? item.conditions : {}
    const role = conditionRole(type)

    if (role === 'combinator') {
      if (depth + 1 > CONDITION_DEPTH_MAX) {
        issues.push(issue('COMBINATOR_DEPTH_LIMIT', 'block', `嵌套超过 ${CONDITION_DEPTH_MAX} 层（组合器最大深度，含顶层）: ${type}`, childPath))
        return
      }
      validateCombination(childConditions, `${childPath}.conditions`, depth + 1, windowTicks, ctx, issues)
      return
    }

    if (role === 'prerequisite') {
      issues.push(...validateRequirementFields(type, childConditions, `${childPath}.conditions`, ctx))
      return
    }

    if (role === 'unknown') {
      issues.push(issue('COMBINATOR_CHILD_UNKNOWN', 'error', `未知触发器类型，也不是已注册的前置条件: ${type}`, childPath))
      return
    }

    if (role === 'event' && windowTicks <= 0) {
      issues.push(issue('COMBINATOR_EVENT_NO_WINDOW', 'error', `事件类触发器 ${type} 放进组合器需要触发器声明 continuity.window > 0（窗口语义），当前 window=0`, childPath))
    }
  })
}

// ── 顶层条件校验入口 ──────────────────────────────────────────────────────────

/**
 * 校验一个触发器声明的条件树。返回问题列表；不修改原始 JSON。
 * 未知类型：报未知类型问题，条件键原文只读保留。
 */
export function validateTriggerConditions(
  node: TriggerNode,
  ctx: ConditionValidationContext,
): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const path = `meta.triggers[${node.index}].conditions`
  const conditions = node.conditions
  const info = node.info

  if (info === undefined) {
    issues.push(issue('TRIGGER_TYPE_UNKNOWN', 'error', `未知触发器类型: ${node.type || '(未声明)'}`, `meta.triggers[${node.index}].type`))
    return issues
  }

  // schema 驱动的字段类型 / 必填 / enum 校验
  for (const field of info.fields) {
    if (!Object.prototype.hasOwnProperty.call(conditions, field.key)) {
      if (field.required) {
        issues.push(issue('COND_FIELD_REQUIRED', 'error', `${field.key} 缺失（${info.label} 的必填条件字段）`, `${path}.${field.key}`))
      }
      continue
    }
    const value = conditions[field.key]
    if (!fieldTypeOk(field.type, value)) {
      issues.push(issue('COND_FIELD_TYPE', 'error', `${field.key} 类型不符（${field.type}），实际: ${describe(value)}`, `${path}.${field.key}`))
      continue
    }
    if (field.type === 'enum' && field.enumValues !== undefined && !field.enumValues.includes(String(value))) {
      issues.push(issue('COND_FIELD_ENUM', 'error', `${field.key} 取值非法: ${String(value)}（接受 ${field.enumValues.join(' / ')}）`, `${path}.${field.key}`))
    }
  }

  // 跨字段语义专用分支
  switch (node.type) {
    case 'location':
    case 'entity_kill':
    case 'death':
      regionIssues(conditions, path, issues)
      break
    case 'facing':
      validateFacing(conditions, path, issues)
      break
    case 'xp':
      validateXp(conditions, path, issues)
      break
    case 'inventory':
      validateInventory(conditions, path, issues)
      break
    case 'observation':
      validateObservation(conditions, path, issues)
      break
    case 'all_of':
    case 'any': {
      const windowTicks = node.timing.continuity.windowTicks ?? 0
      validateCombination(conditions, path, 1, windowTicks, ctx, issues)
      break
    }
    default:
      break
  }

  return issues
}

// ── 条件摘要（唯一生成处）─────────────────────────────────────────────────────

function str(conditions: JsonObject, key: string): string | undefined {
  const value = conditions[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pointText(point: RegionPoint): string {
  const x = point.x === undefined ? '?' : String(point.x)
  const y = point.y === undefined ? '?' : String(point.y)
  const z = point.z === undefined ? '?' : String(point.z)
  return `${x}, ${y}, ${z}`
}

function describeRegion(conditions: JsonObject): string[] {
  const view = readRegionView(conditions)
  const parts: string[] = []
  if (view.sphere !== undefined) {
    const radius = view.sphere.radius === undefined ? '' : ` ${view.sphere.radius} 格`
    parts.push(`球形${radius} @ ${pointText(view.sphere.position)}`)
  }
  if (view.box !== undefined) {
    parts.push(`方体 ${pointText(view.box.corner1)} ~ ${pointText(view.box.corner2)}`)
  }
  return parts
}

const CHANGE_LABELS: Record<string, string> = {
  '': '同时拥有全部',
  increase: '数量增加',
  decrease: '数量减少',
}

const TARGET_TYPE_LABELS: Record<string, string> = {
  '': '方块或实体',
  block: '方块',
  entity: '实体',
}

/**
 * 条件摘要文本：列表行 / 详情头 / 悬停卡三处共用。
 * 空字段不编默认；长 id 不截断；未知类型显示原文类型键。
 */
export function describeTriggerCondition(
  node: { type: string; conditions: JsonObject },
  _ctx?: ConditionValidationContext,
): string {
  const c = node.conditions
  const parts: string[] = []

  switch (node.type) {
    case 'login':
      return '无条件（登录即触发）'

    case 'location': {
      const dimension = str(c, 'dimension')
      if (dimension) parts.push(`维度 ${dimension}`)
      parts.push(...describeRegion(c))
      return parts.length > 0 ? parts.join('，') : '位置（未填）'
    }
    case 'advancement': {
      const v = str(c, 'advancement')
      return v ? `进度 ${v}` : '进度（未填）'
    }
    case 'biome': {
      const v = str(c, 'biome')
      return v ? `群系 ${v}` : '群系（未填）'
    }
    case 'entity_kill': {
      const v = str(c, 'entity')
      if (v) parts.push(`击杀 ${v}`)
      parts.push(...describeRegion(c))
      return parts.length > 0 ? parts.join('，') : '击杀实体（未填）'
    }
    case 'death': {
      parts.push('玩家死亡')
      parts.push(...describeRegion(c))
      return parts.join('，')
    }
    case 'entity_interact':
    case 'block_interact': {
      const target = str(c, 'target')
      const item = str(c, 'item')
      if (target) parts.push(`目标 ${target}`)
      if (item) parts.push(`手持 ${item}`)
      return parts.length > 0 ? parts.join('，') : '交互（未填）'
    }
    case 'item_on_interact': {
      const item = str(c, 'item')
      const target = str(c, 'target')
      if (item) parts.push(`手持 ${item}`)
      if (target) parts.push(`交互 ${target}`)
      return parts.length > 0 ? parts.join('，') : '手持物品交互（未填）'
    }
    case 'dimension_change': {
      const dimension = str(c, 'dimension')
      const from = str(c, 'from_dimension')
      if (dimension) parts.push(`维度 ${dimension}`)
      if (from) parts.push(`来自 ${from}`)
      return parts.length > 0 ? parts.join('，') : '维度切换（未填）'
    }
    case 'item_craft':
    case 'item_use':
    case 'item_consume':
    case 'item_release':
    case 'item_instant_use':
    case 'item_use_interrupt':
    case 'item_pickup':
    case 'item_drop': {
      const v = str(c, 'item')
      return v ? `物品 ${v}` : '物品（未填）'
    }
    case 'xp': {
      const level = str(c, 'level')
      const total = str(c, 'total')
      if (level) parts.push(`等级 ≥ ${level}`)
      if (total) parts.push(`总经验 ≥ ${total}`)
      return parts.length > 0 ? parts.join('，') : '经验（未填）'
    }
    case 'dimension': {
      const v = str(c, 'dimension')
      return v ? `维度 ${v}` : '所在维度（未填）'
    }
    case 'observation': {
      const target = str(c, 'target')
      const targetType = str(c, 'target_type') ?? ''
      const reach = c.reach
      if (target) parts.push(`注视 ${target}（${TARGET_TYPE_LABELS[targetType] ?? targetType}）`)
      if (isFiniteNumber(reach)) parts.push(`距离 ${reach} 格`)
      return parts.length > 0 ? parts.join('，') : '注视目标（未填）'
    }
    case 'inventory': {
      const items = isJsonArray(c.items) ? c.items.filter((item): item is string => typeof item === 'string') : []
      const change = str(c, 'change') ?? ''
      if (items.length > 0) parts.push(`背包 ${items.join('、')}`)
      parts.push(CHANGE_LABELS[change] ?? change)
      return parts.join('，')
    }
    case 'structure': {
      const structure = str(c, 'structure')
      const radius = c.radius
      if (structure) parts.push(`结构 ${structure}`)
      if (isFiniteNumber(radius)) parts.push(`半径 ${radius}`)
      return parts.length > 0 ? parts.join('，') : '结构（未填）'
    }
    case 'gamestage': {
      const v = str(c, 'stage')
      return v ? `阶段 ${v}` : '游戏阶段（未填）'
    }
    case 'facing': {
      const yaw1 = c.yaw1
      const pitch1 = c.pitch1
      const yaw2 = c.yaw2
      const pitch2 = c.pitch2
      if ([yaw1, pitch1, yaw2, pitch2].every((v) => isFiniteNumber(v))) {
        return `朝向 (${yaw1}, ${pitch1}) → (${yaw2}, ${pitch2})`
      }
      return '朝向范围（未填全）'
    }
    case 'all_of':
    case 'any': {
      const children = readConditionChildren(c)
      const label = node.type === 'all_of' ? '全部满足' : '任一满足'
      return `${label} ${children.length} 项`
    }
    default:
      return node.type ? `未知类型 ${node.type}` : '未声明类型'
  }
}
