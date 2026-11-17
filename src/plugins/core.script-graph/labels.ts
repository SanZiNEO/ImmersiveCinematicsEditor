/**
 * 脚本关系图的显示文案（05-02 / 05-03 / 05-05 / 05-07）。
 *
 * 纯函数：只把索引里的数据翻译成中文短句，不解析脚本、不猜字段。
 * `conditions` / `continuity` 不在 05-01 的索引合同里；若服务层将来提供，
 * 这里按同一套只读摘要规则显示，缺字段时明确说「未提供」，不伪造条件。
 */
import { isJsonArray, isJsonObject } from '../../core/doc/json.ts'
import type { JsonValue } from '../../core/doc/types.ts'
import type {
  BuiltinRequirementType,
  GraphNode,
  GraphRequirement,
  GraphTrigger,
  GraphWarningKind,
} from '../../core/graph/types.ts'

/** 内置前置类型的中文名。 */
export const REQUIREMENT_TYPE_LABELS: Record<BuiltinRequirementType, string> = {
  script_played: '播放过',
  script_started: '开始过',
  script_completed: '完成过',
}

/** 前置类型显示名（自定义类型原样显示）。 */
export function requirementTypeLabel(type: string): string {
  return REQUIREMENT_TYPE_LABELS[type as BuiltinRequirementType] ?? type
}

/** 触发器类型显示名。 */
export function triggerTypeLabel(type: string): string {
  if (type === '') {
    return '未填写类型'
  }
  return type
}

/** 时长显示。 */
export function durationLabel(node: Pick<GraphNode, 'infinite' | 'duration'>): string {
  if (node.infinite) {
    return '无限'
  }
  const value = Number.isFinite(node.duration) ? node.duration : 0
  return `${value.toFixed(1)}s`
}

/** 触发器重复性。 */
export function repeatableLabel(trigger: Pick<GraphTrigger, 'repeatable'>): string {
  return trigger.repeatable ? '可重复' : '单次'
}

/** delay 显示；0 不显示。 */
export function delayLabel(trigger: Pick<GraphTrigger, 'delay'>): string | null {
  if (!Number.isFinite(trigger.delay) || trigger.delay <= 0) {
    return null
  }
  return `delay ${trigger.delay}s`
}

/** 前置状态。 */
export type RequirementStatusKind = 'resolved' | 'missing' | 'self' | 'duplicate' | 'custom' | 'no-id'

/** 前置状态（只来自索引的 resolved / editableReason，不自行推断）。 */
export function requirementStatusOf(requirement: GraphRequirement): RequirementStatusKind {
  if (requirement.role !== 'builtin') {
    return 'custom'
  }
  if (requirement.resolved === true) {
    return 'resolved'
  }
  switch (requirement.editableReason) {
    case '自引用':
      return 'self'
    case '目标 id 重复':
      return 'duplicate'
    case '当前脚本无 id':
      return 'no-id'
    default:
      return 'missing'
  }
}

/** 前置状态徽标文案。 */
export function requirementStatusLabel(status: RequirementStatusKind): string {
  switch (status) {
    case 'resolved':
      return '已解析'
    case 'missing':
      return '缺失'
    case 'self':
      return '自引用'
    case 'duplicate':
      return '重复 id'
    case 'custom':
      return '自定义前置，只读'
    case 'no-id':
      return '当前脚本无 id'
  }
}

/**
 * 是否渲染「换目标 / 删除」。
 *
 * 05-03 要求目标缺失、自引用、重复 id 都能换目标/删除；自定义与当前脚本无 id 不可改。
 */
export function canEditRequirement(requirement: GraphRequirement, node: Pick<GraphNode, 'scriptId'>): boolean {
  if (requirement.role !== 'builtin' || node.scriptId === null || node.scriptId === undefined) {
    return false
  }
  const status = requirementStatusOf(requirement)
  return status !== 'custom' && status !== 'no-id'
}

/** 前置目标显示（内置用 id，自定义用原始 data 摘要）。 */
export function requirementTargetLabel(requirement: GraphRequirement): string {
  if (requirement.role === 'builtin') {
    return requirement.scriptId ?? '未填写目标'
  }
  return describeJson(requirement.data, 3)
}

/** 失效广播的中文说明。 */
export function invalidationLabel(kind: string | null): string {
  switch (kind) {
    case 'save':
      return '脚本已保存'
    case 'delete':
      return '脚本已删除'
    case 'new':
      return '新建了脚本'
    case 'refactor':
      return '脚本 id 与引用已改写'
    case 'requires':
      return '前置关系已变化'
    case 'reconnect':
      return '连接已恢复'
    case 'manual':
      return '脚本来源已变化'
    default:
      return '脚本已变化'
  }
}

/** 诊断 kind 文案。 */
export function warningKindLabel(kind: GraphWarningKind): string {
  switch (kind) {
    case 'invalid':
      return '无效脚本'
    case 'duplicate_id':
      return 'id 重复'
    case 'dangling':
      return '目标缺失'
    case 'self_reference':
      return '自引用'
    case 'unknown_trigger':
      return '未知触发器'
    case 'cycle':
      return '成环已忽略'
  }
}

/** 诊断 kind 的固定展示顺序。 */
export const WARNING_KIND_ORDER: readonly GraphWarningKind[] = [
  'invalid',
  'duplicate_id',
  'dangling',
  'self_reference',
  'unknown_trigger',
  'cycle',
]

/** 关系变更错误码 → 中文说明（05-07 / 05-06）。 */
export function mutationErrorText(code: string | undefined, message: string): string {
  const labels: Record<string, string> = {
    bad_path: '脚本路径不安全或不存在',
    bad_trigger: '找不到该触发器（脚本可能已变化）',
    bad_index: '前置位置无效',
    invalid_type: '只能使用内置三种前置类型',
    stale_requires: '前置列表已被其他窗口修改',
    target_missing: '目标脚本不存在',
    target_duplicate: '目标脚本 id 重复',
    self_reference: '不能依赖当前脚本自身',
    source_without_id: '当前脚本没有 meta.id，先设置脚本 id',
    custom_readonly: '自定义前置只读',
    lock_busy: '另一处关系改动正在进行，稍后重试',
    dirty_conflict: '当前文档有未保存修改，先保存或放弃',
    write_failed: '写入失败',
    offline: '未连接模组',
    invalid_id: '脚本 id 不合法（1–32 位字母/数字/下划线）',
    target_exists: '新 id 已被其他脚本占用',
    source_missing: '原 id 不存在',
    stale_preview: '预览后项目又被改动，请重新预览',
  }
  const label = code === undefined ? undefined : labels[code]
  if (label === undefined) {
    return message === '' ? '操作失败' : message
  }
  if (message === '' || message === label) {
    return label
  }
  return `${label}：${message}`
}

/** 触发器的可选只读扩展（当前 05-01 索引不带；服务层补齐后可显示）。 */
interface TriggerExtras {
  conditions?: unknown
  continuity?: unknown
}

function extrasOf(trigger: GraphTrigger): TriggerExtras {
  return trigger as unknown as TriggerExtras
}

/** 条件是否可用（索引是否带了 conditions）。 */
export function hasConditionData(trigger: GraphTrigger): boolean {
  return isJsonObject(extrasOf(trigger).conditions)
}

/** 条件摘要（一层；all_of/any 只列前 3 个子条件）。 */
export function conditionSummary(trigger: GraphTrigger): string | null {
  const conditions = extrasOf(trigger).conditions
  if (!isJsonObject(conditions)) {
    return null
  }
  if (trigger.type === 'all_of' || trigger.type === 'any') {
    const list = isJsonArray(conditions.list) ? conditions.list : []
    const prefix = trigger.type === 'all_of' ? '全部满足' : '任一满足'
    if (list.length === 0) {
      return `条件：${prefix}（没有子条件）`
    }
    const shown = list.slice(0, 3).map((entry) => describeConditionEntry(entry))
    const suffix = list.length > 3 ? `等${list.length}项` : ''
    return `条件：${prefix} —— ${shown.join('；')}${suffix === '' ? '' : `；${suffix}`}`
  }
  const pairs = Object.entries(conditions)
    .filter(([key]) => key !== 'list')
    .slice(0, 3)
    .map(([key, value]) => `${key}=${describeJsonValue(value)}`)
  if (pairs.length === 0) {
    return `条件：${triggerTypeLabel(trigger.type)}`
  }
  return `条件：${pairs.join('；')}`
}

/** continuity 摘要（有字段才显示）。 */
export function continuitySummary(trigger: GraphTrigger): string | null {
  const continuity = extrasOf(trigger).continuity
  if (!isJsonObject(continuity)) {
    return null
  }
  const windowTicks = typeof continuity.window === 'number' && Number.isFinite(continuity.window)
    ? continuity.window
    : null
  const parts: string[] = []
  if (windowTicks !== null && windowTicks > 0) {
    parts.push(`窗口 ${windowTicks} tick`)
  }
  for (const [key, value] of Object.entries(continuity)) {
    if (key === 'window') {
      continue
    }
    parts.push(`${key}=${describeJsonValue(value)}`)
  }
  if (parts.length === 0) {
    return null
  }
  return `连续：${parts.join('，')}`
}

/** 触发器概要与其它行的间距。 */
export function triggerMetaLine(trigger: GraphTrigger): string {
  const parts = [triggerTypeLabel(trigger.type), repeatableLabel(trigger)]
  const delay = delayLabel(trigger)
  if (delay !== null) {
    parts.push(delay)
  }
  const continuity = continuitySummary(trigger)
  if (continuity !== null) {
    parts.push(continuity)
  }
  return parts.join(' · ')
}

function describeConditionEntry(entry: JsonValue): string {
  if (!isJsonObject(entry)) {
    return describeJsonValue(entry)
  }
  const type = typeof entry.type === 'string' ? entry.type : '条件'
  if (type === 'all_of' || type === 'any') {
    return type === 'all_of' ? '全部满足' : '任一满足'
  }
  const conditions = isJsonObject(entry.conditions) ? entry.conditions : {}
  const pairs = Object.entries(conditions)
    .filter(([key]) => key !== 'list')
    .slice(0, 2)
    .map(([key, value]) => `${key}=${describeJsonValue(value)}`)
  return pairs.length === 0 ? type : `${type}（${pairs.join('，')}）`
}

function describeJson(data: Record<string, JsonValue>, limit: number): string {
  const pairs = Object.entries(data)
    .slice(0, limit)
    .map(([key, value]) => `${key}=${describeJsonValue(value)}`)
  return pairs.length === 0 ? '未填写' : pairs.join('，')
}

function describeJsonValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return '未填写'
  }
  if (typeof value === 'string') {
    return value === '' ? '空' : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.length} 项]`
  }
  return '{…}'
}
