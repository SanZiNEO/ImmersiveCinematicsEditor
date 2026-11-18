/**
 * 07-09 数学模型编辑器：六通道视图层纯逻辑。
 *
 * 与 `curveEditorModel.ts` 的分工：
 * - 本模块面向六个 `motion_*` 通道：通道清单 / 值域徽标 / 未设置与显式 linear 的区分 /
 *   摘要文案 / 节点与深度计数 / 草稿会话表 / 响应曲线示意采样 / 重置为 linear；
 * - 树解析、参数控件派生、子节点增删替换、写回序列化在 `curveEditorModel.ts`。
 *
 * 不写文档：所有草稿只活在内存表；写盘由父面板走 `object.setValue` 命令。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import { MODEL_FALLBACK, MODEL_PARAMS } from '../../core/schema/catalog/models.ts'
import {
  modelChannelDomain,
  modelDepth,
  modelNodeCount,
  modelOverLimit,
  modelSummary,
  modelTypeOptions,
} from '../../core/paths/models.ts'
import {
  createDraft,
  serializeDraft,
  validateModel,
  type ModelValidation,
} from './curveEditorModel.ts'

// ── 通道清单（对齐 `MathModelRegistry.CHANNEL_DOMAINS`） ─────────────────────

export interface MotionChannel {
  field: string
  label: string
  domain: string
}

export const MOTION_CHANNELS: readonly MotionChannel[] = [
  { field: 'motion_position', label: '位置', domain: 'vector' },
  { field: 'motion_yaw', label: '偏航', domain: 'angle' },
  { field: 'motion_pitch', label: '俯仰', domain: 'angle' },
  { field: 'motion_roll', label: '翻滚', domain: 'angle' },
  { field: 'motion_fov', label: '视野', domain: 'scalar' },
  { field: 'motion_zoom', label: '缩放', domain: 'scalar' },
]

const CHANNEL_BY_FIELD = new Map(MOTION_CHANNELS.map((channel) => [channel.field, channel]))

/** 是否为六个 `motion_*` 通道字段之一。 */
export function isChannelField(path: string): boolean {
  return CHANNEL_BY_FIELD.has(path)
}

/** 取通道定义；非 motion 字段返回 `undefined`。 */
export function channelOf(field: string): MotionChannel | undefined {
  return CHANNEL_BY_FIELD.get(field)
}

/** 通道中文标签（目录无 labelKey，按通道清单固定文案）。 */
export function channelLabel(field: string): string {
  return channelOf(field)?.label ?? field
}

/** 通道值域（vector / angle / scalar）；非通道字段回退 scalar。 */
export function channelDomain(field: string): string {
  return modelChannelDomain(field)
}

/** 值域徽标文案。 */
export function domainBadge(domain: string): { key: string; label: string } {
  switch (domain) {
    case 'vector':
      return { key: 'vector', label: '向量' }
    case 'angle':
      return { key: 'angle', label: '角度' }
    default:
      return { key: 'scalar', label: '标量' }
  }
}

// ── 未设置 / 摘要 / 计数 ──────────────────────────────────────────────────────

/**
 * 字段缺失 = 「未设置」（不干预）；显式 `{ type: 'linear' }` 是「按线性模型处理」，
 * 两者语义不同，摘要必须能区分。
 */
export function isModelUnset(model: JsonValue | undefined): boolean {
  return model === undefined
}

/** 行摘要：未设置 / `linear` / `spring(k, d)` / `chain(…)` / `blend(…)`。 */
export function channelSummary(model: JsonValue | undefined): string {
  if (isModelUnset(model)) {
    return '未设置'
  }
  return modelSummary(model)
}

/** 节点总数（每个模型对象算 1）。 */
export function countNodes(model: JsonValue | undefined): number {
  return modelNodeCount(model)
}

/** 定义树深度（根 = 1）。 */
export function countDepth(model: JsonValue | undefined): number {
  return modelDepth(model)
}

/** 是否递归超限（节点 > 32 或深度 > 8）。 */
export function channelOverLimit(model: JsonValue | undefined): boolean {
  return modelOverLimit(model)
}

/** 类型下拉顺序（目录派生，不手写第二份表）。 */
export function modelTypeList(): readonly string[] {
  return modelTypeOptions()
}

/** 通道维度校验聚合（含未知类型 / 未知参数 / 值域不匹配警告与结构 / 参数错误）。 */
export function channelValidation(model: JsonValue | undefined, field: string): ModelValidation {
  const draft = createDraft(model, channelDomain(field))
  return draft.validation
}

// ── 重置 / 写回 ───────────────────────────────────────────────────────────────

/** 重置为 linear：只写 `{ type: 'linear' }`，不补参数、不写 domain / authoring。 */
export function resetModelValue(): JsonObject {
  return { type: MODEL_FALLBACK }
}

/**
 * 草稿 / 作者模型 → 可写盘 JSON：保留未知参数与子模型，缺失参数不补默认值。
 * 返回 `undefined` = 通道未设置（不落该字段）。
 */
export function serializeAppliedModel(model: JsonValue | undefined): JsonObject | undefined {
  if (model === undefined) {
    return undefined
  }
  return serializeDraft(createDraft(model))
}

// ── 草稿会话表（按「片段 + 字段路径」保存；内存态，不进序列化） ────────────────

interface DraftEntry {
  has: boolean
  model: JsonValue | undefined
}

const draftTable = new Map<string, DraftEntry>()

export function draftKey(clipKey: string, path: string): string {
  return `${clipKey}::${path}`
}

/** 读草稿；`has === false` 表示还没有未提交草稿（区别于显式 linear 草稿）。 */
export function readDraft(clipKey: string, path: string): DraftEntry {
  const entry = draftTable.get(draftKey(clipKey, path))
  return entry ?? { has: false, model: undefined }
}

/** 写草稿；`model === undefined` 表示草稿为「未设置」。 */
export function writeDraft(clipKey: string, path: string, model: JsonValue | undefined): void {
  draftTable.set(draftKey(clipKey, path), {
    has: true,
    model: model === undefined ? undefined : cloneDraft(model),
  })
}

/** 丢弃草稿（应用成功 / 取消后调用）。 */
export function discardDraft(clipKey: string, path: string): void {
  draftTable.delete(draftKey(clipKey, path))
}

function cloneDraft(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneDraft(item))
  }
  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneDraft(item)
    }
    return out
  }
  return value
}

// ── 响应曲线示意采样（0→1；不承诺等于游戏内实际运动） ──────────────────────────

export interface ResponseSample {
  t: number
  values: number[]
}

interface EvalNode {
  type: string
  floats: Record<string, number>
  children: EvalNode[]
  weight: number
  state: number
  velocity: number
}

/**
 * 按当前模型画一条 0→1 的标量响应曲线；vector 通道复制到三轴。
 * 状态型模型（spring / inertia / exponential_smooth）用零初值、单位阶跃；
 * 超限时返回 `null`（不画）。
 */
export function sampleModelResponse(
  model: JsonValue | undefined,
  domain: string,
  samples = 33,
): ResponseSample[] | null {
  if (modelOverLimit(model)) {
    return null
  }
  const root = buildEval(model)
  const channels = domain === 'vector' ? 3 : 1
  const stepCount = Math.max(2, samples)
  const dt = 1 / (stepCount - 1)
  const result: ResponseSample[] = []
  for (let index = 0; index < stepCount; index += 1) {
    const t = index / (stepCount - 1)
    const scalar = stepNode(root, t, dt)
    result.push({ t, values: new Array(channels).fill(scalar) })
  }
  return result
}

function buildEval(raw: JsonValue | undefined): EvalNode {
  const fallback: EvalNode = {
    type: MODEL_FALLBACK,
    floats: {},
    children: [],
    weight: 0.5,
    state: 0,
    velocity: 0,
  }
  if (!isJsonObject(raw)) {
    return fallback
  }
  const type = typeof raw.type === 'string' && MODEL_PARAMS[raw.type] !== undefined ? raw.type : MODEL_FALLBACK
  const floats: Record<string, number> = {}
  for (const def of MODEL_PARAMS[type] ?? []) {
    const candidate = raw[def.key]
    if (def.type === 'float' && isFiniteNumber(candidate)) {
      floats[def.key] = candidate
    }
  }
  const children: EvalNode[] = []
  if (type === 'chain' && Array.isArray(raw.models)) {
    for (const child of raw.models) {
      children.push(buildEval(child))
    }
  }
  if (type === 'blend') {
    children.push(buildEval(raw.a))
    children.push(buildEval(raw.b))
  }
  const weight = isFiniteNumber(raw.weight) ? raw.weight : 0.5
  return {
    type,
    floats,
    children,
    weight,
    state: 0,
    velocity: floats.initial_velocity ?? 0,
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function stepNode(node: EvalNode, input: number, dt: number): number {
  switch (node.type) {
    case 'smoothstep': {
      const t = clamp01(input)
      return t * t * (3 - 2 * t)
    }
    case 'ease_in': {
      const t = clamp01(input)
      return t * t
    }
    case 'ease_out': {
      const t = clamp01(input)
      return 1 - (1 - t) * (1 - t)
    }
    case 'ease_in_out': {
      const t = clamp01(input)
      if (t < 0.5) {
        return 2 * t * t
      }
      const u = 2 * t - 1
      return 0.5 + 0.5 * (1 - (1 - u) * (1 - u))
    }
    case 'cubic_bezier':
      return bezierAt(
        input,
        node.floats.x1 ?? 1 / 3,
        node.floats.y1 ?? 1 / 3,
        node.floats.x2 ?? 2 / 3,
        node.floats.y2 ?? 2 / 3,
      )
    case 'exponential_smooth': {
      const tau = node.floats.tau > 0 ? node.floats.tau : 0.15
      const k = 1 - Math.exp(-dt / tau)
      node.state += (1 - node.state) * k
      return node.state
    }
    case 'spring':
    case 'inertia':
      return stepSpring(node, dt)
    case 'chain': {
      let out = input
      for (const child of node.children) {
        out = stepNode(child, out, dt)
      }
      return out
    }
    case 'blend': {
      const a = node.children[0] !== undefined ? stepNode(node.children[0], input, dt) : input
      const b = node.children[1] !== undefined ? stepNode(node.children[1], input, dt) : input
      return a + (b - a) * node.weight
    }
    case 'linear':
    default:
      return input
  }
}

/** 二阶阻尼弹簧示意（欠 / 临界 / 过阻尼；零初值、单位阶跃目标 1）。 */
function stepSpring(node: EvalNode, dt: number): number {
  const stiffness = node.floats.stiffness > 0 ? node.floats.stiffness : 8
  const damping = node.floats.damping >= 0 ? node.floats.damping : 0.75
  const target = 1
  const omega = Math.sqrt(stiffness)
  const e0 = node.state - target
  const v0 = node.velocity
  let e1: number
  let v1: number
  if (damping < 1 - 1e-6) {
    const zetaOmega = damping * omega
    const omegaD = omega * Math.sqrt(Math.max(0, 1 - damping * damping))
    const decay = Math.exp(-zetaOmega * dt)
    const cos = Math.cos(omegaD * dt)
    const sin = Math.sin(omegaD * dt)
    e1 = decay * (e0 * cos + ((v0 + zetaOmega * e0) / omegaD) * sin)
    v1 = decay * (v0 * cos - ((omega * omega * e0 + zetaOmega * v0) / omegaD) * sin)
  } else if (damping > 1 + 1e-6) {
    const root = Math.sqrt(damping * damping - 1)
    const r1 = -omega / (damping + root)
    const r2 = -omega * (damping + root)
    const decay1 = Math.exp(r1 * dt)
    const decay2 = Math.exp(r2 * dt)
    const denominator = r1 - r2
    const c1 = (v0 - r2 * e0) / denominator
    const c2 = e0 - c1
    e1 = c1 * decay1 + c2 * decay2
    v1 = c1 * r1 * decay1 + c2 * r2 * decay2
  } else {
    const decay = Math.exp(-omega * dt)
    e1 = decay * (e0 + (v0 + omega * e0) * dt)
    v1 = decay * (v0 - omega * (v0 + omega * e0) * dt)
  }
  node.state += e1 - e0
  node.velocity = v1
  return node.state
}

/** CSS cubic-bezier 示意求值（牛顿 + 二分兜底；控制点取目录缺省之外的作者值）。 */
function bezierAt(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const t = solveBezierT(clamp01(x), ax, bx, cx)
  return ((ay * t + by) * t + cy) * t
}

function solveBezierT(x: number, ax: number, bx: number, cx: number): number {
  let t = x
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const slope = (3 * ax * t + 2 * bx) * t + cx
    if (slope === 0) {
      break
    }
    const error = ((ax * t + bx) * t + cx) * t - x
    if (Math.abs(error) < 1e-7) {
      return t
    }
    t -= error / slope
  }
  let low = 0
  let high = 1
  let mid = x
  for (let iteration = 0; iteration < 32 && low < high; iteration += 1) {
    const value = ((ax * mid + bx) * mid + cx) * mid
    if (Math.abs(value - x) < 1e-7) {
      return mid
    }
    if (x > value) {
      low = mid
    } else {
      high = mid
    }
    mid = low + (high - low) * 0.5
  }
  return mid
}
