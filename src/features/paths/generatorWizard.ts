/**
 * 07-07 圆形 / 圆弧 / 椭圆生成器：向导状态、本地校验、计划到一次 `compound` 的组装与 diff 预演。
 *
 * 本模块是纯逻辑层（node 下可跑自检）：
 * - 表单状态 / 圆心空间换算 / 本地拦截都在这里，Vue 组件只渲染与转发；
 * - 计划由 core `planShapeGeneration` 产出，本模块不重算几何、不调运行时；
 * - 写盘只生成 `object.editKeyframes` + `path.writeBatch`（包进 `compound`），不写 authoring / 临时 paths。
 *
 * 圆心空间（对齐 07-07 §三 / §4.1）：
 * - `absolute`：世界坐标，表达式空间即世界；
 * - `relative + world`：表达式分量是相对原点的偏移；原点为 `coordinate` 时可切「世界坐标输入」，
 *   编辑器减去原点坐标后写片段坐标；动态原点（玩家 / 选择器 / 方块 / 结构 / 空）只接受片段坐标；
 * - `relative + base`：局部 fwd / up / right 分量。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { findClipById } from '../../core/paths/collection.ts'
import {
  planShapeGeneration,
  validateGeneratorSpec,
  type ShapeGenerationResult,
} from '../../core/paths/generators.ts'
import type {
  ShapeGeneratorSpec,
  ShapeGenerationPlan,
  ShapeGeneratorMode,
  ShapeGeneratorTimeMode,
} from '../../core/paths/types.ts'
import { parsePointSource, type RefKind } from '../authoring/pointSource.ts'

// ── 表单状态 ────────────────────────────────────────────────────────────────

export type WizardShape = 'circle' | 'arc' | 'ellipse'

export interface WizardVec3 {
  x: number
  y: number
  z: number
}

/** 向导表单状态（全部为表达式空间分量；`centerInputWorld` 仅输入口径切换）。 */
export interface WizardState {
  clipId: string
  from: number
  to: number
  shape: WizardShape
  center: WizardVec3
  radius: number
  semiMajor: number
  semiMinor: number
  rotation: number
  startAngle: number
  endAngle: number
  clockwise: boolean
  normal: WizardVec3
  referenceAxis: WizardVec3
  mode: ShapeGeneratorMode
  /** `auto` 或 ≥ 1 的整数。 */
  segments: number | 'auto'
  timeMode: ShapeGeneratorTimeMode
  /** 圆心是否按世界坐标输入（仅 relative+world 且 coordinate 原点可用）。 */
  centerInputWorld: boolean
  /** 作者显式确认删除受影响路径（impactedPaths 非空时必选）。 */
  impactConfirmed: boolean
}

/** 片段位置上下文：圆心空间 / 轴标签 / 原点坐标。 */
export interface CenterSpaceContext {
  mode: 'absolute' | 'relative'
  space: 'world' | 'base'
  originKind: RefKind
  origin: WizardVec3
  axisLabels: [string, string, string]
  /** 圆心允许按世界坐标输入。 */
  worldInputAllowed: boolean
  summary: string
}

/** diff 预演（只计数与列 id，不改文档）。 */
export interface WizardDiff {
  added: number
  replaced: number
  /** 将被移除的旧路径条数（替换 + 待确认的受影响路径）。 */
  deleted: number
  impacted: number
  replacedPathIds: string[]
  impactedPaths: string[]
}

/** 计划视图：供表单渲染预览 / diff / 警告。 */
export interface WizardPlanView {
  spec: ShapeGeneratorSpec
  result: ShapeGenerationResult
  plan: ShapeGenerationPlan | null
  diff: WizardDiff
  issues: string[]
  warnings: string[]
  preview: Array<{ u: number; point: [number, number, number] }>
  radialErrorRatio: number
}

/** 应用载荷：父面板拿到后一次 `commit`，再做选区 / 播放头跳转。 */
export interface GeneratorApplyPayload {
  commands: DocCommand[]
  selectPathId: string
  seekTime: number
  warnings: string[]
}

const POSITION_PATHS = ['position.x', 'position.y', 'position.z'] as const

/** 新建向导默认值（水平面、0→90°、Bezier、保留节点）。 */
export function defaultWizardState(clipId: string, from: number, to: number): WizardState {
  return {
    clipId,
    from,
    to,
    shape: 'circle',
    center: { x: 0, y: 0, z: 0 },
    radius: 4,
    semiMajor: 2,
    semiMinor: 1,
    rotation: 0,
    startAngle: 0,
    endAngle: 90,
    clockwise: false,
    normal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    mode: 'bezier',
    segments: 'auto',
    timeMode: 'keep-nodes',
    centerInputWorld: false,
    impactConfirmed: false,
  }
}

// ── 片段上下文读取 ──────────────────────────────────────────────────────────

function scalarNumber(objects: JsonObject, path: string, fallback: number): number {
  const raw = objects[path]
  if (!isJsonObject(raw)) {
    return fallback
  }
  if (Array.isArray(raw.keyframes) && raw.keyframes.length > 0) {
    const first = raw.keyframes[0]
    if (isJsonObject(first) && typeof first.value === 'number' && Number.isFinite(first.value)) {
      return first.value
    }
  }
  if (typeof raw.value === 'number' && Number.isFinite(raw.value)) {
    return raw.value
  }
  return fallback
}

function scalarString(objects: JsonObject, path: string, fallback: string): string {
  const raw = objects[path]
  if (isJsonObject(raw) && typeof raw.value === 'string') {
    return raw.value
  }
  return fallback
}

/** 从只读快照读片段的位置上下文；片段不存在返回 null。 */
export function readCenterContext(doc: ScriptDoc, clipId: string): CenterSpaceContext | null {
  const clip = findClipById(doc, clipId)
  if (clip === undefined) {
    return null
  }
  const objects = clip.objects
  if (!isJsonObject(objects)) {
    return null
  }
  const mode = scalarString(objects, 'position_mode', 'relative') === 'absolute'
    ? 'absolute'
    : 'relative'
  const space = scalarString(objects, 'position_space', 'world') === 'base' ? 'base' : 'world'
  const originText = scalarString(objects, 'position_origin', '')
  const originKind = parsePointSource(originText).kind
  const origin: WizardVec3 = {
    x: scalarNumber(objects, 'position_origin_x', 0),
    y: scalarNumber(objects, 'position_origin_y', 0),
    z: scalarNumber(objects, 'position_origin_z', 0),
  }
  const base = mode === 'relative' && space === 'base'
  const axisLabels: [string, string, string] = base ? ['fwd', 'up', 'right'] : ['x', 'y', 'z']
  const worldInputAllowed = mode === 'relative' && space === 'world' && originKind === 'coordinate'
  let summary: string
  if (mode === 'absolute') {
    summary = 'absolute：圆心按世界坐标（x, y, z）'
  } else if (base) {
    summary = 'relative + base：圆心按局部分量（fwd, up, right）'
  } else {
    summary = originKind === 'coordinate'
      ? `relative + world：圆心为相对原点（${origin.x}, ${origin.y}, ${origin.z}）的偏移`
      : `relative + world：动态原点（${originText || '玩家激活位置'}），只接受片段坐标`
  }
  return { mode, space, originKind, origin, axisLabels, worldInputAllowed, summary }
}

// ── 圆心空间换算 ────────────────────────────────────────────────────────────

/** 输入分量 → 表达式空间分量（写进 spec / 关键帧的口径）。 */
export function expressionCenterFromInput(
  input: WizardVec3,
  ctx: CenterSpaceContext,
  inputWorld: boolean,
): WizardVec3 {
  if (ctx.worldInputAllowed && inputWorld) {
    return {
      x: input.x - ctx.origin.x,
      y: input.y - ctx.origin.y,
      z: input.z - ctx.origin.z,
    }
  }
  return { ...input }
}

/** 表达式分量 → 世界分量；base / 动态原点缺基向量，返回 null。 */
export function worldCenterFromExpression(expr: WizardVec3, ctx: CenterSpaceContext): WizardVec3 | null {
  if (ctx.mode === 'absolute') {
    return { ...expr }
  }
  if (ctx.space === 'base') {
    return null
  }
  if (ctx.originKind !== 'coordinate') {
    return null
  }
  return {
    x: ctx.origin.x + expr.x,
    y: ctx.origin.y + expr.y,
    z: ctx.origin.z + expr.z,
  }
}

// ── 本地校验 ───────────────────────────────────────────────────────────────

function lengthOf(vector: WizardVec3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalizedCross(left: WizardVec3, right: WizardVec3): number {
  const leftLength = lengthOf(left)
  const rightLength = lengthOf(right)
  if (leftLength === 0 || rightLength === 0) {
    return 0
  }
  const crossed = {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
  return lengthOf(crossed) / (leftLength * rightLength)
}

/**
 * 本地拦截：半径 / 半轴 ≤ 0、起止角相等、|Δ| > 360、法向与参考轴平行、
 * 参考轴在平面内投影退化、分段数非法。返回空数组表示本地通过（核心计划可能另有 issue）。
 */
export function validateWizard(state: WizardState, ctx: CenterSpaceContext | null): string[] {
  const issues: string[] = []
  if (state.clipId.length === 0) {
    issues.push('目标片段不能为空')
  }
  if (!(state.from < state.to) || !Number.isFinite(state.from) || !Number.isFinite(state.to)) {
    issues.push('结束时间必须大于开始时间')
  }
  const center = state.center
  if (![center.x, center.y, center.z].every(Number.isFinite)) {
    issues.push('圆心必须是有限坐标')
  }
  if (state.shape === 'ellipse') {
    if (!(state.semiMajor > 0)) {
      issues.push('长半轴必须 > 0')
    }
    if (!(state.semiMinor > 0)) {
      issues.push('短半轴必须 > 0')
    }
  } else if (!(state.radius > 0)) {
    issues.push('半径必须 > 0')
  }
  const span = Math.abs(state.endAngle - state.startAngle)
  if (!Number.isFinite(span) || span === 0) {
    issues.push('起止角不能相同（跨度 0）')
  } else if (span > 360) {
    issues.push(`角度跨度必须 ≤ 360°（实际 ${span}°）`)
  }
  if (lengthOf(state.normal) === 0 || lengthOf(state.referenceAxis) === 0) {
    issues.push('法向与参考轴不能是零向量')
  } else if (normalizedCross(state.normal, state.referenceAxis) < 1e-9) {
    issues.push('法向与参考轴不能平行（坐标系退化）')
  } else {
    // 参考轴在平面内的投影长度：reference − normal·(normal·reference)。
    const nx = state.normal.x / lengthOf(state.normal)
    const ny = state.normal.y / lengthOf(state.normal)
    const nz = state.normal.z / lengthOf(state.normal)
    const dot = nx * state.referenceAxis.x + ny * state.referenceAxis.y + nz * state.referenceAxis.z
    const projected = {
      x: state.referenceAxis.x - nx * dot,
      y: state.referenceAxis.y - ny * dot,
      z: state.referenceAxis.z - nz * dot,
    }
    if (lengthOf(projected) < 1e-9) {
      issues.push('参考轴在平面内的投影退化（请换一个不平行于法向的参考轴）')
    }
  }
  if (state.segments !== 'auto' && (!Number.isInteger(state.segments) || state.segments < 1)) {
    issues.push('分段数必须是 ≥ 1 的整数')
  }
  if (ctx !== null && !ctx.worldInputAllowed && state.centerInputWorld) {
    issues.push('当前原点不支持世界坐标输入（动态原点只接受片段坐标）')
  }
  return issues
}

/** 表单状态 → core spec（圆心已换算到表达式空间）。 */
export function buildSpec(state: WizardState, ctx: CenterSpaceContext | null): ShapeGeneratorSpec {
  const center = ctx === null
    ? { ...state.center }
    : expressionCenterFromInput(state.center, ctx, state.centerInputWorld)
  return {
    clip: state.clipId,
    from: state.from,
    to: state.to,
    shape: state.shape,
    center,
    radius: state.radius,
    semiMajor: state.semiMajor,
    semiMinor: state.semiMinor,
    rotation: state.rotation,
    startAngle: state.startAngle,
    endAngle: state.endAngle,
    clockwise: state.clockwise,
    normal: { ...state.normal },
    referenceAxis: { ...state.referenceAxis },
    mode: state.mode,
    segments: state.segments,
    timeMode: state.timeMode,
  }
}

// ── 计划与 diff ──────────────────────────────────────────────────────────────

/** 跑核心计划并折成视图；本地 issue 非空时不调用核心计划。 */
export function planWizard(doc: ScriptDoc, state: WizardState, ctx: CenterSpaceContext | null): WizardPlanView {
  const localIssues = [...validateWizard(state, ctx), ...validateGeneratorSpec(buildSpec(state, ctx))]
  if (localIssues.length > 0) {
    return {
      spec: buildSpec(state, ctx),
      result: { plan: null, issues: localIssues, replacedPathIds: [], deletePathIds: [] },
      plan: null,
      diff: { added: 0, replaced: 0, deleted: 0, impacted: 0, replacedPathIds: [], impactedPaths: [] },
      issues: localIssues,
      warnings: [],
      preview: [],
      radialErrorRatio: 0,
    }
  }
  const spec = buildSpec(state, ctx)
  const result = planShapeGeneration(doc, spec)
  const plan = result.plan
  const impacted = plan === null ? [] : plan.impactedPaths
  const diff: WizardDiff = {
    added: plan === null ? 0 : plan.paths.length,
    replaced: result.replacedPathIds.length,
    deleted: result.replacedPathIds.length + impacted.length,
    impacted: impacted.length,
    replacedPathIds: [...result.replacedPathIds],
    impactedPaths: [...impacted],
  }
  return {
    spec,
    result,
    plan,
    diff,
    issues: result.issues,
    warnings: plan === null ? [] : plan.warnings,
    preview: plan === null ? [] : plan.preview,
    radialErrorRatio: plan === null ? 0 : plan.radialErrorRatio,
  }
}

/** 是否可应用：本地 / 核心 issue 为空，且受影响路径已显式确认。 */
export function canApply(view: WizardPlanView, impactConfirmed: boolean): boolean {
  if (view.issues.length > 0) {
    return false
  }
  if (impactBlocked(view, impactConfirmed)) {
    return false
  }
  return view.plan !== null
}

/** 受影响路径未确认时阻断应用。 */
export function impactBlocked(view: WizardPlanView, impactConfirmed: boolean): boolean {
  return view.diff.impacted > 0 && !impactConfirmed
}

// ── 命令组装 ────────────────────────────────────────────────────────────────

function frameOps(
  plan: ShapeGenerationPlan,
  existingTimes: ReadonlySet<number>,
): Array<{ op: 'add' | 'set' | 'remove'; path: string; time: number; value: JsonValue }> {
  const ops: Array<{ op: 'add' | 'set' | 'remove'; path: string; time: number; value: JsonValue }> = []
  for (const entry of plan.keyTimes) {
    const op = existingTimes.has(entry.time) ? 'set' : 'add'
    POSITION_PATHS.forEach((path, axis) => {
      ops.push({ op, path, time: entry.time, value: entry.point[axis] })
    })
  }
  for (const time of plan.removeTimes) {
    POSITION_PATHS.forEach((path) => {
      ops.push({ op: 'remove', path, time, value: null })
    })
  }
  return ops
}

/**
 * 把计划折成一次 `compound`：先批量改三轴帧，再批量写路径（替换旧条目）。
 *
 * @param deleteImpacted 作者确认删除受影响路径时，把 impactedPaths 一并加入 removeIds。
 */
export function buildApplyPayload(
  doc: ScriptDoc,
  state: WizardState,
  view: WizardPlanView,
  deleteImpacted: boolean,
  clipKey: string,
): GeneratorApplyPayload {
  if (view.plan === null) {
    return { commands: [], selectPathId: '', seekTime: state.from, warnings: view.warnings }
  }
  const plan = view.plan
  const existingTimes = new Set(clipNodeTimes(doc, state.clipId))
  const ops = frameOps(plan, existingTimes)
  const removeIds = [...view.diff.replacedPathIds]
  if (deleteImpacted) {
    for (const id of view.diff.impactedPaths) {
      if (!removeIds.includes(id)) {
        removeIds.push(id)
      }
    }
  }
  const commands: DocCommand[] = [
    { kind: 'object.editKeyframes', clipKey, ops },
    { kind: 'path.writeBatch', removeIds, entries: plan.paths },
  ]
  return {
    commands: [{ kind: 'compound', commands }],
    selectPathId: plan.paths.length > 0 ? String(plan.paths[0].id) : '',
    seekTime: state.from,
    warnings: view.warnings,
  }
}

function clipNodeTimes(doc: ScriptDoc, clipId: string): number[] {
  const clip = findClipById(doc, clipId)
  if (clip === undefined || !isJsonObject(clip.objects)) {
    return []
  }
  const times = new Set<number>()
  for (const [path, property] of Object.entries(clip.objects)) {
    if (!path.startsWith('position.') || !isJsonObject(property)) {
      continue
    }
    if (Array.isArray(property.keyframes)) {
      for (const frame of property.keyframes) {
        if (isJsonObject(frame) && typeof frame.time === 'number') {
          times.add(frame.time)
        }
      }
    }
  }
  return [...times].sort((left, right) => left - right)
}

/** 供下拉的相邻端点选项（复用 core 节点并集）。 */
export function endpointOptions(doc: ScriptDoc, clipId: string): number[] {
  return clipNodeTimes(doc, clipId)
}
