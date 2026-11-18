/** 数学模型编辑器核心：定义树校验、默认值构造、未知参数保留。
 *
 * 与 `MathModelRegistry` 对齐的关键口径：
 * - 未知类型 / 未知参数 / 值域不匹配 → **警告**，运行期回落，不改写原文；
 * - 已知参数类型错 / 越界、`chain` 空、`blend` 缺分支 → **错误**，编辑器拦下不写盘；
 * - 深度 > 8 或节点 > 32 → 整链回落（编辑器禁用「应用」）；
 * - 缺省参数不补写进 JSON（只作为表单占位）。
 */
import type { JsonObject, JsonValue } from '../doc/types.ts'
import { MODEL_DOMAINS, MODEL_FALLBACK, MODEL_MAX_DEPTH, MODEL_MAX_NODES, MODEL_PARAMS } from '../schema/catalog/models.ts'
import { isPathObject } from './types.ts'

/** 参数范围（对齐 `MathModelRegistry` 各模型 `clamp*` 的上下界）。 */
const MODEL_PARAM_RANGES: Record<string, readonly [number, number]> = {
  'cubic_bezier.x1': [0, 1],
  'cubic_bezier.x2': [0, 1],
  'cubic_bezier.y1': [-4, 4],
  'cubic_bezier.y2': [-4, 4],
  'exponential_smooth.tau': [1.0e-3, 100],
  'spring.stiffness': [1.0e-3, 1.0e3],
  'spring.damping': [0, 10],
  'spring.initial_velocity': [-1.0e4, 1.0e4],
  'inertia.stiffness': [1.0e-3, 1.0e3],
  'inertia.damping': [0, 10],
  'inertia.initial_velocity': [-1.0e4, 1.0e4],
  'blend.weight': [0, 1],
}

export interface ModelIssue {
  /** 相对模型根的字段路径，如 `a.weight` / `models[0].type`。 */
  field: string
  severity: 'error' | 'warn' | 'info'
  message: string
}

/** 通道字段 → 值域（`MathModelRegistry.CHANNEL_DOMAINS`）。 */
export function modelChannelDomain(field: string): string {
  switch (field) {
    case 'motion_position':
      return 'vector'
    case 'motion_yaw':
    case 'motion_pitch':
    case 'motion_roll':
      return 'angle'
    default:
      return 'scalar'
  }
}

/** 模型类型下拉顺序（`MODEL_TYPES`）。 */
export function modelTypeOptions(): readonly string[] {
  return Object.keys(MODEL_PARAMS)
}

/** 参数目录（表单顺序）。 */
export function modelParams(type: string): Array<{ key: string; type: string; defaultValue: JsonValue | null }> {
  const defs = MODEL_PARAMS[type] ?? []
  return defs.map((def) => ({
    key: def.key,
    type: def.type,
    defaultValue: (def.default as JsonValue | null | undefined) ?? null,
  }))
}

/** 新建一个最小模型定义（只写 type；float 默认值留空由表单显示占位）。 */
export function newModel(type: string, domain?: string): JsonObject {
  const model: JsonObject = { type }
  if (domain !== undefined && domain !== 'scalar') {
    model.domain = domain
  }
  if (type === 'chain') {
    model.models = []
  }
  if (type === 'blend') {
    model.a = { type: MODEL_FALLBACK }
    model.b = { type: MODEL_FALLBACK }
  }
  return model
}

/** 定义树节点数（每个对象算 1）。 */
export function modelNodeCount(model: JsonValue | undefined): number {
  if (!isPathObject(model)) {
    return 1
  }
  let count = 1
  for (const child of childModels(model)) {
    count += modelNodeCount(child)
  }
  return count
}

/** 定义树深度（根 = 1）。 */
export function modelDepth(model: JsonValue | undefined): number {
  if (!isPathObject(model)) {
    return 1
  }
  let maximum = 1
  for (const child of childModels(model)) {
    maximum = Math.max(maximum, 1 + modelDepth(child))
  }
  return maximum
}

/** 是否超限（超限时 Java 整链回落 linear，编辑器禁用应用）。 */
export function modelOverLimit(model: JsonValue | undefined): boolean {
  const nodes = modelNodeCount(model)
  const depth = modelDepth(model)
  return nodes > MODEL_MAX_NODES || depth > MODEL_MAX_DEPTH
}

/** 校验定义树；返回问题列表（error 只用于超限，其余是 warn）。 */
export function validateModelDefinition(
  model: JsonValue | undefined,
  expectedDomain?: string,
  field = '',
): ModelIssue[] {
  const issues: ModelIssue[] = []
  const root = model
  const nodeCount = modelNodeCount(root)
  const depth = modelDepth(root)
  if (nodeCount > MODEL_MAX_NODES) {
    issues.push({
      field: field || 'model',
      severity: 'error',
      message: `模型定义节点数 ${nodeCount} 超过上限 ${MODEL_MAX_NODES}（运行时整链回落 ${MODEL_FALLBACK}）`,
    })
  }
  if (depth > MODEL_MAX_DEPTH) {
    issues.push({
      field: field || 'model',
      severity: 'error',
      message: `模型定义深度 ${depth} 超过上限 ${MODEL_MAX_DEPTH}（运行时整链回落 ${MODEL_FALLBACK}）`,
    })
  }
  walkModel(root, expectedDomain, field, issues)
  return issues
}

/** 遍历树（供 UI 侧滑递归编辑 / 摘要）。 */
export function walkModel(
  model: JsonValue | undefined,
  expectedDomain: string | undefined,
  field: string,
  issues: ModelIssue[],
): void {
  const prefix = field === '' ? '' : field
  if (!isPathObject(model)) {
    issues.push({
      field: prefix || 'model',
      severity: 'warn',
      message: `模型定义需要对象（实际 ${typeLabel(model)}，运行时回落 ${MODEL_FALLBACK}）`,
    })
    return
  }
  const type = model.type
  if (typeof type !== 'string' || type.length === 0) {
    issues.push({
      field: `${prefix || 'model'}.type`,
      severity: 'warn',
      message: `缺少模型类型（运行时按 ${MODEL_FALLBACK}）`,
    })
  } else if (MODEL_PARAMS[type] === undefined) {
    issues.push({
      field: `${prefix || 'model'}.type`,
      severity: 'warn',
      message: `未知模型类型 '${type}'（运行时实际 ${MODEL_FALLBACK}，原文保留）`,
    })
  } else {
    validateParams(type, model, prefix, expectedDomain, issues)
  }
  const domain = model.domain
  if (typeof domain === 'string' && !MODEL_DOMAINS.includes(domain)) {
    issues.push({
      field: `${prefix || 'model'}.domain`,
      severity: 'warn',
      message: `未知值域 '${domain}'（可选: ${MODEL_DOMAINS.join(', ')}；运行时忽略）`,
    })
  } else if (typeof domain === 'string' && expectedDomain !== undefined && domain !== expectedDomain) {
    issues.push({
      field: `${prefix || 'model'}.domain`,
      severity: 'warn',
      message: `组合域不匹配（父定义 ${expectedDomain}，子定义 ${domain}；运行期该子模型回落 ${MODEL_FALLBACK}）`,
    })
  }
}

function validateParams(
  type: string,
  model: JsonObject,
  prefix: string,
  expectedDomain: string | undefined,
  issues: ModelIssue[],
): void {
  const declared = MODEL_PARAMS[type] ?? []
  const childDomain = declaredDomainOf(model, expectedDomain)
  const fieldPath = (key: string): string => `${prefix || 'model'}.${key}`
  if (type === 'chain') {
    const list = model.models
    if (list === undefined || list === null) {
      issues.push({ field: fieldPath('models'), severity: 'error', message: 'chain 至少需要一个子模型（缺 models）' })
    } else if (!Array.isArray(list)) {
      issues.push({ field: fieldPath('models'), severity: 'error', message: 'chain.models 需要模型数组' })
    } else if (list.length === 0) {
      issues.push({ field: fieldPath('models'), severity: 'error', message: 'chain 至少需要一个子模型（当前为空）' })
    }
  }
  if (type === 'blend') {
    for (const branch of ['a', 'b'] as const) {
      if (model[branch] === undefined || model[branch] === null) {
        issues.push({ field: fieldPath(branch), severity: 'error', message: `blend 缺少分支 ${branch}` })
      }
    }
  }
  for (const key of Object.keys(model)) {
    if (key === 'type' || key === 'domain') {
      continue
    }
    if (!declared.some((def) => def.key === key)) {
      issues.push({
        field: fieldPath(key),
        severity: 'warn',
        message: `未知模型参数 '${key}'（type = ${type}，可用: ${declared.map((def) => def.key).join(' / ') || '无'}）→ 运行时忽略，原文保留`,
      })
    }
  }
  for (const def of declared) {
    const value = model[def.key]
    const field = fieldPath(def.key)
    const range = MODEL_PARAM_RANGES[`${type}.${def.key}`]
    if (def.type === 'float') {
      if (value === undefined || value === null) {
        continue
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({
          field,
          severity: 'error',
          message: `需要有限数字（实际 ${typeLabel(value)}，运行时回落缺省 ${String(def.default)}）`,
        })
        continue
      }
      if (range !== undefined && (value < range[0] || value > range[1])) {
        issues.push({
          field,
          severity: 'error',
          message: `参数必须落在 [${range[0]}, ${range[1]}]（实际 ${value}，运行时会被钳制）`,
        })
      }
      continue
    }
    if (def.type === 'model') {
      if (value === undefined || value === null) {
        continue
      }
      if (!isPathObject(value)) {
        issues.push({ field, severity: 'error', message: '需要子模型对象' })
      } else {
        walkModel(value, childDomain, field, issues)
      }
      continue
    }
    if (def.type === 'model_list') {
      if (value === undefined || value === null) {
        continue
      }
      if (!Array.isArray(value)) {
        issues.push({ field, severity: 'error', message: '需要模型数组' })
        continue
      }
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index]
        if (!isPathObject(item)) {
          issues.push({
            field: `${field}[${index}]`,
            severity: 'error',
            message: `需要子模型对象（运行时该元素回落 ${MODEL_FALLBACK}）`,
          })
        } else {
          walkModel(item, childDomain, `${field}[${index}]`, issues)
        }
      }
    }
  }
}

/** 子模型节点（`chain.models[]`、`blend.a/b`）。 */
export function childModels(model: JsonObject): JsonValue[] {
  const result: JsonValue[] = []
  const chain = model.models
  if (Array.isArray(chain)) {
    for (const item of chain) {
      result.push(item)
    }
  }
  if (model.a !== undefined) {
    result.push(model.a)
  }
  if (model.b !== undefined) {
    result.push(model.b)
  }
  return result
}

/** 显式 domain，否则继承父域。 */
export function declaredDomainOf(model: JsonObject, expected: string | undefined): string | undefined {
  const raw = model.domain
  if (typeof raw === 'string' && MODEL_DOMAINS.includes(raw)) {
    return raw
  }
  return expected
}

/** 一行摘要：`type(参数…)`，嵌套只展开一层。 */
export function modelSummary(model: JsonValue | undefined): string {
  if (!isPathObject(model)) {
    return String(model)
  }
  const type = typeof model.type === 'string' ? model.type : '(缺 type)'
  const params = (MODEL_PARAMS[type] ?? [])
    .filter((def) => def.type === 'float')
    .map((def) => `${def.key}=${String(model[def.key] ?? def.default)}`)
  if (type === 'chain') {
    const list = Array.isArray(model.models) ? model.models.length : 0
    params.push(`models×${list}`)
  }
  if (type === 'blend') {
    params.push('a/b')
  }
  return `${type}(${params.join(', ')})`
}

function typeLabel(value: JsonValue | undefined): string {
  if (value === undefined) {
    return '缺失'
  }
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return '数组'
  }
  return typeof value
}
