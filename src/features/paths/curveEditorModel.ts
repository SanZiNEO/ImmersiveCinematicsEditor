/**
 * CurveEditor 纯逻辑（07-09 / README「对 08 的接口约定」）。
 *
 * 与 Vue 组件解耦：本模块把任意 `JsonValue` 解析成可编辑树、按类型派生参数控件、
 * 提供子节点增删 / 替换 / 类型切换 / 未知类型转换 / 未知参数清理，并把结构写回 JSON。
 *
 * 写回口径（对齐 `MathModelRegistry` 回落语义与 07-09 §4.2）：
 * - 未知类型 / 未知参数 / 值域不匹配：**保留原文 + 警告**，不补默认值、不自动改写；
 * - 注册类型的缺失参数不补写进 JSON（只作为表单占位）；
 * - 结构 / 参数越界 / 递归超限：`error` 级，应用前拦下；
 * - 不写 `authoring`、不写 UI 状态。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { cloneJson, describe, isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import {
  MODEL_DOMAINS,
  MODEL_FALLBACK,
  MODEL_MAX_DEPTH,
  MODEL_MAX_NODES,
  MODEL_PARAMS,
} from '../../core/schema/catalog/models.ts'
import {
  modelDepth,
  modelNodeCount,
  modelOverLimit,
  newModel,
} from '../../core/paths/models.ts'

/** 问题级别：`error` = 应用前拦下；`warn` = 保留原文、运行期回落。 */
export type EditorIssueSeverity = 'error' | 'warn'

export type EditorIssueKind =
  | 'limit'
  | 'param'
  | 'structure'
  | 'unknown-type'
  | 'unknown-param'
  | 'domain'

export interface EditorIssue {
  /** 相对模型根的字段路径，根为 `model`。 */
  field: string
  severity: EditorIssueSeverity
  kind: EditorIssueKind
  message: string
}

export type ChildKind = 'none' | 'chain' | 'blend'

/** 子节点引用定位（chain 按下标、blend 按分支）。 */
export type ChildRef =
  | { kind: 'chain'; index: number }
  | { kind: 'blend'; side: 'a' | 'b' }

export interface ParamState {
  key: string
  /** 与目录 `ModelParamType` 对齐：`float` / `model` / `model_list`。 */
  paramType: string
  /** 原始值；`undefined` = 未写入（不补默认值）。 */
  value: JsonValue | undefined
}

/** 可编辑树的一个节点（草稿态，不直接写文档）。 */
export interface EditableNode {
  /** 相对根的 JSON 路径；根为 `''`。 */
  path: string
  /** 注册类型名；缺 `type` 为 `''`，未知类型保留原字符串。 */
  type: string
  raw: JsonValue | undefined
  childKind: ChildKind
  params: ParamState[]
  /** 目录未声明的键（保留待作者显式清理）。 */
  unknownKeys: string[]
  issues: EditorIssue[]
  children: EditableNode[]
}

export interface ModelValidation {
  issues: EditorIssue[]
  errors: EditorIssue[]
  warnings: EditorIssue[]
  /** 无 `error` 级问题（超限 / 结构 / 参数越界都算 error）。 */
  valid: boolean
  nodeCount: number
  depth: number
  overLimit: boolean
  /** 超限定位路径（深度超限给最深叶路径；节点超限给根）。 */
  limitPaths: string[]
}

/** 草稿：原始 JSON + 解析树 + 校验聚合。 */
export interface DraftModel {
  raw: JsonValue | undefined
  root: EditableNode
  validation: ModelValidation
}

const CHAIN_KEY = 'models'
const BLEND_SIDES = ['a', 'b'] as const

function childKindOf(type: string): ChildKind {
  if (type === 'chain') return 'chain'
  if (type === 'blend') return 'blend'
  return 'none'
}

function joinPath(base: string, segment: string): string {
  return base === '' ? segment : `${base}.${segment}`
}

/** 目录声明的参数键（含模型 / 模型列表）。 */
function declaredKeys(type: string): string[] {
  const declared = MODEL_PARAMS[type]
  return declared === undefined ? [] : declared.map((def) => def.key)
}

/** 解析可编辑树。 */
export function parseModel(value: JsonValue | undefined, expectedDomain?: string): EditableNode {
  return parseNode(value, '', expectedDomain)
}

function parseNode(raw: JsonValue | undefined, path: string, expectedDomain: string | undefined): EditableNode {
  const node: EditableNode = {
    path,
    type: '',
    raw,
    childKind: 'none',
    params: [],
    unknownKeys: [],
    issues: [],
    children: [],
  }
  if (!isJsonObject(raw)) {
    return node
  }
  const type = typeof raw.type === 'string' ? raw.type : ''
  node.type = type
  node.childKind = childKindOf(type)

  const declared = MODEL_PARAMS[type] ?? []
  const declaredKeySet = new Set(declaredKeys(type))
  for (const def of declared) {
    node.params.push({
      key: def.key,
      paramType: def.type,
      value: Object.prototype.hasOwnProperty.call(raw, def.key) ? raw[def.key] : undefined,
    })
  }
  for (const key of Object.keys(raw)) {
    if (key === 'type' || key === 'domain' || declaredKeySet.has(key)) {
      continue
    }
    node.unknownKeys.push(key)
  }

  if (node.childKind === 'chain') {
    const models = raw.models
    if (Array.isArray(models)) {
      models.forEach((item, index) => {
        node.children.push(parseNode(item, joinPath(path, `models[${index}]`), childDomainOf(raw, expectedDomain)))
      })
    }
  } else if (node.childKind === 'blend') {
    for (const side of BLEND_SIDES) {
      const child = raw[side]
      if (child !== undefined) {
        node.children.push(parseNode(child, joinPath(path, side), childDomainOf(raw, expectedDomain)))
      }
    }
  }
  return node
}

/** 子模型继承域：显式合法 domain 否则继承父域。 */
function childDomainOf(raw: JsonObject, expected: string | undefined): string | undefined {
  const domain = raw.domain
  if (typeof domain === 'string' && MODEL_DOMAINS.includes(domain)) {
    return domain
  }
  return expected
}

/** 整树校验聚合（复用核心计数 / 超限口径）。 */
export function validateModel(root: EditableNode, expectedDomain?: string): ModelValidation {
  const issues: EditorIssue[] = []
  collectIssues(root, expectedDomain, issues)

  const nodeCount = modelNodeCount(root.raw)
  const depth = modelDepth(root.raw)
  const overLimit = modelOverLimit(root.raw)
  const limitPaths: string[] = []

  if (nodeCount > MODEL_MAX_NODES) {
    const field = root.path === '' ? 'model' : root.path
    issues.push({
      field,
      severity: 'error',
      kind: 'limit',
      message: `模型定义节点数 ${nodeCount} 超过上限 ${MODEL_MAX_NODES}（运行时整链回落 ${MODEL_FALLBACK}）`,
    })
    limitPaths.push(field)
  }
  if (depth > MODEL_MAX_DEPTH) {
    const deepest = deepestNode(root)
    const field = deepest.path === '' ? 'model' : deepest.path
    issues.push({
      field,
      severity: 'error',
      kind: 'limit',
      message: `模型定义深度 ${depth} 超过上限 ${MODEL_MAX_DEPTH}（运行时整链回落 ${MODEL_FALLBACK}）`,
    })
    limitPaths.push(field)
  }

  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warn')
  return {
    issues,
    errors,
    warnings,
    valid: errors.length === 0,
    nodeCount,
    depth,
    overLimit,
    limitPaths,
  }
}

function collectIssues(node: EditableNode, expectedDomain: string | undefined, issues: EditorIssue[]): void {
  validateNode(node, expectedDomain, issues)
  for (const child of node.children) {
    collectIssues(child, childDomainOf(isJsonObject(node.raw) ? node.raw : {}, expectedDomain), issues)
  }
}

function validateNode(node: EditableNode, expectedDomain: string | undefined, issues: EditorIssue[]): void {
  const field = node.path === '' ? 'model' : node.path
  if (node.raw === undefined) {
    // 通道未设置：没有模型定义，不算错误（与显式 linear 区分由视图层处理）。
    return
  }
  if (!isJsonObject(node.raw)) {
    issues.push({
      field,
      severity: 'error',
      kind: 'structure',
      message: `模型定义需要对象（实际 ${describe(node.raw)}；运行时回落 ${MODEL_FALLBACK}）`,
    })
    return
  }
  const type = node.type
  if (type === '') {
    issues.push({
      field: `${field}.type`,
      severity: 'warn',
      kind: 'unknown-type',
      message: `缺少模型类型（运行时按 ${MODEL_FALLBACK}）`,
    })
  } else if (MODEL_PARAMS[type] === undefined) {
    issues.push({
      field: `${field}.type`,
      severity: 'warn',
      kind: 'unknown-type',
      message: `未知类型 '${type}'，实际 ${MODEL_FALLBACK}（原文保留，可显式转为 ${MODEL_FALLBACK}）`,
    })
  } else {
    checkDeclaredParams(type, node.raw, field, issues)
  }

  const domain = node.raw.domain
  if (typeof domain === 'string') {
    if (!MODEL_DOMAINS.includes(domain)) {
      issues.push({
        field: `${field}.domain`,
        severity: 'warn',
        kind: 'domain',
        message: `未知值域 '${domain}'（可选: ${MODEL_DOMAINS.join(', ')}；运行时忽略）`,
      })
    } else if (expectedDomain !== undefined && domain !== expectedDomain) {
      issues.push({
        field: `${field}.domain`,
        severity: 'warn',
        kind: 'domain',
        message: `值域不匹配（通道 ${expectedDomain}，子定义 ${domain}；运行期该子模型回落 ${MODEL_FALLBACK}）`,
      })
    }
  }

  if (type === 'chain') {
    const models = node.raw.models
    if (!Array.isArray(models) || models.length === 0) {
      issues.push({
        field: `${field}.models`,
        severity: 'error',
        kind: 'structure',
        message: 'chain 至少需要一个子模型（空链被拦下，不写盘）',
      })
    } else {
      models.forEach((item, index) => {
        if (!isJsonObject(item)) {
          issues.push({
            field: `${field}.models[${index}]`,
            severity: 'error',
            kind: 'structure',
            message: '子模型需要对象',
          })
        }
      })
    }
  }
  if (type === 'blend') {
    for (const side of BLEND_SIDES) {
      const child = node.raw[side]
      if (child === undefined || child === null) {
        issues.push({
          field: `${field}.${side}`,
          severity: 'error',
          kind: 'structure',
          message: `blend 缺少 ${side} 分支（两分支都不能缺）`,
        })
      } else if (!isJsonObject(child)) {
        issues.push({
          field: `${field}.${side}`,
          severity: 'error',
          kind: 'structure',
          message: `${side} 分支需要子模型对象`,
        })
      }
    }
  }

  for (const key of node.unknownKeys) {
    issues.push({
      field: `${field}.${key}`,
      severity: 'warn',
      kind: 'unknown-param',
      message: `未知模型参数 '${key}'（type = ${type || '?'}；运行时忽略，原文保留，可显式清理）`,
    })
  }
}

function checkDeclaredParams(type: string, raw: JsonObject, field: string, issues: EditorIssue[]): void {
  const declared = MODEL_PARAMS[type] ?? []
  for (const def of declared) {
    if (def.type !== 'float') {
      continue
    }
    const value = raw[def.key]
    if (value === undefined || value === null) {
      continue
    }
    const paramField = `${field}.${def.key}`
    if (!isFiniteNumber(value)) {
      issues.push({
        field: paramField,
        severity: 'error',
        kind: 'param',
        message: `${def.key} 需要有限数字（实际 ${describe(value)}）`,
      })
      continue
    }
    const rangeMessage = floatRangeMessage(type, def.key, value)
    if (rangeMessage !== null) {
      issues.push({ field: paramField, severity: 'error', kind: 'param', message: rangeMessage })
    }
  }
}

/** 越界文案；`null` = 该参数在此类型下无范围约束。 */
function floatRangeMessage(type: string, key: string, value: number): string | null {
  switch (type) {
    case 'cubic_bezier':
      if (value < 0 || value > 1) {
        return `${key} 需要在 0…1 之间（实际 ${value}）`
      }
      return null
    case 'exponential_smooth':
      if (key === 'tau' && value <= 0) {
        return `tau 必须为正数（实际 ${value}）`
      }
      return null
    case 'spring':
    case 'inertia':
      if (key === 'stiffness' && value <= 0) {
        return `stiffness 必须为正数（实际 ${value}）`
      }
      if (key === 'damping' && value < 0) {
        return `damping 不能为负数（实际 ${value}）`
      }
      return null
    case 'blend':
      if (key === 'weight' && (value < 0 || value > 1)) {
        return `weight 需要在 0…1 之间（实际 ${value}）`
      }
      return null
    default:
      return null
  }
}

function deepestNode(node: EditableNode): EditableNode {
  let deepest = node
  let maxDepth = subtreeDepth(node)
  for (const child of node.children) {
    const childDeep = deepestNode(child)
    const childDepth = subtreeDepth(childDeep)
    if (childDepth > maxDepth) {
      deepest = childDeep
      maxDepth = childDepth
    }
  }
  return deepest
}

function subtreeDepth(node: EditableNode): number {
  if (node.children.length === 0) {
    return 1
  }
  return 1 + Math.max(...node.children.map(subtreeDepth))
}

// ── 草稿构造与写回 ──────────────────────────────────────────────────────────

/** 由原始值构造草稿（解析 + 校验一次完成）。 */
export function createDraft(value: JsonValue | undefined, expectedDomain?: string): DraftModel {
  const root = parseModel(value, expectedDomain)
  return { raw: cloneRaw(value), root, validation: validateModel(root, expectedDomain) }
}

function cloneRaw(value: JsonValue | undefined): JsonValue | undefined {
  return value === undefined ? undefined : cloneJson(value)
}

/** 用新的原始 JSON 重建草稿（子操作的统一入口）。 */
export function applyRaw(draft: DraftModel, raw: JsonValue | undefined, expectedDomain?: string): DraftModel {
  return createDraft(raw, expectedDomain)
}

/** 写回 JSON：只写 `type` / 已写入的声明参数 / `domain` / 子模型 / 未知键；不补默认值。 */
export function serializeModel(root: EditableNode): JsonObject {
  const out: JsonObject = {}
  if (root.type !== '') {
    out.type = root.type
  }
  const raw = isJsonObject(root.raw) ? root.raw : {}
  if (typeof raw.domain === 'string') {
    out.domain = raw.domain
  }
  for (const param of root.params) {
    if (param.value !== undefined) {
      out[param.key] = cloneJson(param.value)
    }
  }
  if (root.childKind === 'chain') {
    out.models = root.children.map(serializeModel)
  } else if (root.childKind === 'blend') {
    for (const side of BLEND_SIDES) {
      const child = root.children.find((item) => item.path === side || item.path.endsWith(`.${side}`))
      if (child !== undefined) {
        out[side] = serializeModel(child)
      }
    }
  }
  for (const key of root.unknownKeys) {
    out[key] = cloneJson(raw[key])
  }
  return out
}

/** 草稿写回（根为 `undefined` 时返回 `undefined` = 通道未设置）。 */
export function serializeDraft(draft: DraftModel): JsonObject | undefined {
  if (draft.raw === undefined) {
    return undefined
  }
  return serializeModel(draft.root)
}

// ── 路径定位（原始 JSON 上的纯操作） ─────────────────────────────────────────

interface Segment {
  key: string
  index?: number
}

function parsePath(path: string): Segment[] {
  if (path === '') {
    return []
  }
  const segments: Segment[] = []
  for (const part of path.split('.')) {
    const bracket = part.match(/^(.+)\[(\d+)\]$/)
    if (bracket !== null) {
      segments.push({ key: bracket[1], index: Number(bracket[2]) })
    } else {
      segments.push({ key: part })
    }
  }
  return segments
}

function resolveRaw(raw: JsonValue | undefined, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = raw
  for (const segment of parsePath(path)) {
    if (!isJsonObject(current)) {
      return undefined
    }
    current = current[segment.key]
    if (segment.index !== undefined) {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[segment.index]
    }
  }
  return current
}

/** 在 `path` 位置写入 `next`；根路径直接整体替换。返回新的整树 JSON。 */
function replaceAt(raw: JsonValue | undefined, path: string, next: JsonValue | undefined): JsonValue | undefined {
  if (path === '') {
    return next
  }
  const segments = parsePath(path)
  const root: JsonObject = isJsonObject(raw) ? cloneJson(raw) : {}
  let current: JsonObject = root
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (segment.index !== undefined) {
      let list = current[segment.key]
      if (!Array.isArray(list)) {
        list = []
        current[segment.key] = list
      }
      let item = list[segment.index]
      if (!isJsonObject(item)) {
        item = {}
        list[segment.index] = item
      }
      current = item
    } else {
      let child = current[segment.key]
      if (!isJsonObject(child)) {
        child = {}
        current[segment.key] = child
      }
      current = child
    }
  }
  const last = segments[segments.length - 1]
  if (last.index !== undefined) {
    let list = current[last.key]
    if (!Array.isArray(list)) {
      list = []
      current[last.key] = list
    }
    list[last.index] = next ?? null
    current[last.key] = list
  } else {
    if (next === undefined) {
      delete current[last.key]
    } else {
      current[last.key] = next
    }
  }
  return root
}

// ── 子操作（返回新的原始 JSON；组件再走 applyRaw 重建草稿） ──────────────────

/** 切换节点类型：保留 domain 与同名有限参数；chain/blend 按目录脚手架重建。 */
export function setTypeOnRaw(raw: JsonValue | undefined, path: string, type: string): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  const next = newModel(type)
  if (isJsonObject(target)) {
    if (typeof target.domain === 'string') {
      next.domain = target.domain
    }
    for (const def of MODEL_PARAMS[type] ?? []) {
      if (def.type === 'float' && isFiniteNumber(target[def.key])) {
        next[def.key] = target[def.key]
      }
    }
  }
  return replaceAt(raw, path, next)
}

/** 写入 / 清空一个浮点参数（`value === undefined` = 移除该键，不补默认值）。 */
export function setParamOnRaw(
  raw: JsonValue | undefined,
  path: string,
  key: string,
  value: JsonValue | undefined,
): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  if (!isJsonObject(target)) {
    return raw
  }
  const next: JsonObject = cloneJson(target)
  if (value === undefined) {
    delete next[key]
  } else {
    next[key] = cloneJson(value)
  }
  return replaceAt(raw, path, next)
}

/** chain 末尾追加一个 linear 子模型。 */
export function addChainChildOnRaw(raw: JsonValue | undefined, path: string): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  if (!isJsonObject(target) || !Array.isArray(target.models)) {
    return raw
  }
  const models = target.models.map((item) => cloneJson(item))
  models.push(newModel(MODEL_FALLBACK))
  const next: JsonObject = { ...cloneJson(target), models }
  return replaceAt(raw, path, next)
}

/** 删除 chain 下标处的子模型。 */
export function removeChainChildOnRaw(raw: JsonValue | undefined, path: string, index: number): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  if (!isJsonObject(target) || !Array.isArray(target.models)) {
    return raw
  }
  const models = target.models.map((item) => cloneJson(item))
  if (index < 0 || index >= models.length) {
    return raw
  }
  models.splice(index, 1)
  const next: JsonObject = { ...cloneJson(target), models }
  return replaceAt(raw, path, next)
}

/** chain 子模型上下移（`direction` = -1 上移 / 1 下移）。 */
export function moveChainChildOnRaw(
  raw: JsonValue | undefined,
  path: string,
  index: number,
  direction: -1 | 1,
): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  if (!isJsonObject(target) || !Array.isArray(target.models)) {
    return raw
  }
  const models = target.models.map((item) => cloneJson(item))
  const to = index + direction
  if (index < 0 || index >= models.length || to < 0 || to >= models.length) {
    return raw
  }
  const [moved] = models.splice(index, 1)
  models.splice(to, 0, moved)
  const next: JsonObject = { ...cloneJson(target), models }
  return replaceAt(raw, path, next)
}

/** 替换 blend 的某个分支为新模型（默认 linear）。 */
export function replaceBlendChildOnRaw(
  raw: JsonValue | undefined,
  path: string,
  side: 'a' | 'b',
  child: JsonValue | undefined = newModel(MODEL_FALLBACK),
): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  if (!isJsonObject(target)) {
    return raw
  }
  const next: JsonObject = cloneJson(target)
  next[side] = child === undefined ? newModel(MODEL_FALLBACK) : cloneJson(child)
  return replaceAt(raw, path, next)
}

/** 显式把未知类型节点转为 linear（作者操作；丢弃该节点的旧参数与未知键）。 */
export function convertUnknownToLinearOnRaw(raw: JsonValue | undefined, path: string): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  const next: JsonObject = { type: MODEL_FALLBACK }
  if (isJsonObject(target) && typeof target.domain === 'string') {
    next.domain = target.domain
  }
  return replaceAt(raw, path, next)
}

/** 显式清理节点上的未知参数（作者操作；声明参数与子模型保留）。 */
export function cleanUnknownParamsOnRaw(raw: JsonValue | undefined, path: string): JsonValue | undefined {
  const target = resolveRaw(raw, path)
  if (!isJsonObject(target)) {
    return raw
  }
  const type = typeof target.type === 'string' ? target.type : ''
  const declared = new Set(declaredKeys(type))
  const next: JsonObject = {}
  for (const [key, value] of Object.entries(target)) {
    if (key === 'type' || key === 'domain' || declared.has(key)) {
      next[key] = cloneJson(value)
    }
  }
  return replaceAt(raw, path, next)
}
