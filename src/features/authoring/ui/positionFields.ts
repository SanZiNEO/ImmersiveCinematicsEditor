/**
 * 07-02 位置组界面投影（纯逻辑，不触 DOM / 不引 Vue）。
 *
 * - 把 core `positionVisibility` 的结果折成渲染描述：可见 / 禁用 / 「不读取」标注 /
 *   base 轴标签 fwd-up-right / absolute 锁 world「将被忽略」+ 显式清除命令 /
 *   relative+world 与 base 的支路差异 / coordinate 原点三轴空值占位 0「未写 = 0」/
 *   facing_source 各分支载荷；
 * - 行装饰器：给属性行打 base 轴标签、把「不读取」分支叶子标 `unavailableReason`、
 *   过滤掉当前支路不该出现的行；
 * - step 切换命令构造：t>0 缺三轴先拦住，补齐与 step 写在同一 commit；t=0 直接提交。
 */
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { JsonObject, JsonValue, ObjectKeyframe } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import type { PropertyRow } from '../../effects/types.ts'
import {
  positionVisibility,
  switchMissingAxes,
  fillAxesOps,
  type PositionValues,
  type PositionVisibility,
} from '../positionForm.ts'
import { parsePointSource, resolveFacingAuto, type RefKind } from '../pointSource.ts'
import { effectiveValue } from '../groups.ts'

/** 一条待提交项：命令 + 成功提示（父面板统一 commit）。 */
export interface ApplyItem {
  command: DocCommand
  successText: string
}

// ── 当前值读取 ───────────────────────────────────────────────────────────────

/** 读片段对象面里某路径的静态值（无 `value` 键返回 `fallback`）。 */
export function staticField(objects: JsonObject, path: string, fallback: JsonValue = null): JsonValue {
  const raw = objects[path]
  if (isJsonObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return raw.value as JsonValue
  }
  return fallback
}

function stringField(objects: JsonObject, path: string, fallback: string): string {
  const value = staticField(objects, path, fallback)
  return typeof value === 'string' ? value : fallback
}

/** 从对象面读位置分支输入（枚举 / ref 取静态值，缺省回落 schema 默认）。 */
export function readPositionValues(objects: JsonObject): PositionValues {
  return {
    position_mode: stringField(objects, 'position_mode', 'relative') === 'absolute' ? 'absolute' : 'relative',
    position_space: stringField(objects, 'position_space', 'world') === 'base' ? 'base' : 'world',
    position_origin: stringField(objects, 'position_origin', ''),
    facing_source: (['auto', 'world', 'entity', 'line'] as const).includes(
      stringField(objects, 'facing_source', 'auto') as PositionValues['facing_source'],
    )
      ? (stringField(objects, 'facing_source', 'auto') as PositionValues['facing_source'])
      : 'auto',
    facing_target: stringField(objects, 'facing_target', ''),
    facing_entity: stringField(objects, 'facing_entity', ''),
  }
}

// ── 支路标志（与 positionForm 同一口径，供行装饰与控制条复用） ────────────────

export interface PositionBranches {
  originKind: RefKind
  absolute: boolean
  base: boolean
  facingVisible: boolean
  lineBranch: boolean
  entityBranch: boolean
  autoBranch: 'line' | 'entity' | 'world'
}

export function branchFlags(values: PositionValues): PositionBranches {
  const originKind = parsePointSource(values.position_origin).kind
  const absolute = values.position_mode === 'absolute'
  const base = !absolute && values.position_space === 'base'
  const facingVisible = base
  const source = values.facing_source
  const auto = resolveFacingAuto({
    target: values.facing_target,
    entity: values.facing_entity,
    originKind,
  })
  const lineBranch = facingVisible && (source === 'line' || (source === 'auto' && auto.branch === 'line'))
  const entityBranch = facingVisible && (source === 'entity' || (source === 'auto' && auto.branch === 'entity'))
  return {
    originKind,
    absolute,
    base,
    facingVisible,
    lineBranch,
    entityBranch,
    autoBranch: auto.branch,
  }
}

// ── 控制条投影 ───────────────────────────────────────────────────────────────

/** 单个可编辑单元的渲染描述。 */
export interface PositionFieldCell {
  /** 当前原始值（只读入参；控件不回写对象）。 */
  raw: JsonValue
  /** 文本预览（`null` 显示占位）。 */
  text: string
  /** 空值占位文案。 */
  placeholder: string
  visible: boolean
  enabled: boolean
  /** false = 值保留但运行时不读取。 */
  read: boolean
  note: string
}

function cell(raw: JsonValue, state: { visible: boolean; enabled: boolean; read: boolean; note: string }, placeholder = ''): PositionFieldCell {
  const text = raw === null || raw === undefined || raw === '' ? '' : String(raw)
  return { raw, text, placeholder, visible: state.visible, enabled: state.enabled, read: state.read, note: state.note }
}

/** 位置组控制条投影（不含三轴角度行；三轴行由组内行组件渲染）。 */
export interface PositionBarModel {
  values: PositionValues
  visibility: PositionVisibility
  branches: PositionBranches
  axisLabels: [string, string, string]
  cells: Record<string, PositionFieldCell>
  warnings: string[]
  canSubmit: boolean
}

/** 把对象面折成控制条模型。 */
export function projectPositionBar(objects: JsonObject): PositionBarModel {
  const values = readPositionValues(objects)
  const visibility = positionVisibility(values)
  const branches = branchFlags(values)
  const cells: Record<string, PositionFieldCell> = {}

  const put = (path: string, raw: JsonValue, placeholder = ''): void => {
    const state = visibility.fields[path]
    if (state === undefined) {
      cells[path] = cell(raw, { visible: true, enabled: true, read: true, note: '' }, placeholder)
      return
    }
    cells[path] = cell(raw, state, placeholder)
  }

  put('position_mode', values.position_mode)
  put('position_space', values.position_space, 'world')
  put('position_origin', values.position_origin)
  put('position_origin_x', staticField(objects, 'position_origin_x'), '0（未写 = 0）')
  put('position_origin_y', staticField(objects, 'position_origin_y'), '0（未写 = 0）')
  put('position_origin_z', staticField(objects, 'position_origin_z'), '0（未写 = 0）')
  put('position_origin_freeze', staticField(objects, 'position_origin_freeze', false))
  put('facing_source', values.facing_source)
  put('facing_target', values.facing_target)
  put('facing_target_x', staticField(objects, 'facing_target_x'), '0（未写 = 0）')
  put('facing_target_y', staticField(objects, 'facing_target_y'), '0（未写 = 0）')
  put('facing_target_z', staticField(objects, 'facing_target_z'), '0（未写 = 0）')
  put('facing_target_offset.x', staticField(objects, 'facing_target_offset.x', 0))
  put('facing_target_offset.y', staticField(objects, 'facing_target_offset.y', 0))
  put('facing_target_offset.z', staticField(objects, 'facing_target_offset.z', 0))
  put('facing_target_offset.space', staticField(objects, 'facing_target_offset.space', 'world'))
  put('facing_target_freeze', staticField(objects, 'facing_target_freeze', false))
  put('facing_entity', values.facing_entity)

  return {
    values,
    visibility,
    branches,
    axisLabels: visibility.axisLabels,
    cells,
    warnings: visibility.warnings,
    canSubmit: visibility.canSubmit,
  }
}

// ── 行装饰器 ─────────────────────────────────────────────────────────────────

/** 行装饰上下文。 */
export interface RowDecorateContext {
  trackType: string
  objects: JsonObject
  catalog: CatalogIndex
}

export interface PositionDecorateResult {
  rows: PropertyRow[]
  warnings: string[]
  /** 被过滤掉的路径（当前支路不可见）。 */
  hidden: string[]
}

const AXIS_BY_PATH: Record<string, 0 | 1 | 2> = {
  'position.x': 0,
  'position.y': 1,
  'position.z': 2,
}

/**
 * 装饰位置组行：
 * - base 空间把 position.x/y/z 的 `label` 换成 fwd/up/right（不改 path）；
 * - 「不读取」分支叶子设 `unavailableReason`（中文原因，值保留）；
 * - 当前支路不该出现的行过滤掉。
 *
 * 返回新数组，不改入参行。
 */
export function decoratePositionRows(
  rows: readonly PropertyRow[],
  ctx: RowDecorateContext,
): PositionDecorateResult {
  const values = readPositionValues(ctx.objects)
  const visibility = positionVisibility(values)
  const branches = branchFlags(values)
  const hidden: string[] = []
  const decorated: PropertyRow[] = []

  for (const row of rows) {
    if (row.section !== 'position') {
      decorated.push(row)
      continue
    }
    const state = visibility.fields[row.path]
    // 控制条专属扩展字段（offset 三分量 / offset.space）按支路标志投影。
    const extended = extendPositionState(row.path, branches)
    const visible = state === undefined ? extended.visible : state.visible
    const present = Object.prototype.hasOwnProperty.call(ctx.objects, row.path)
    if (!visible) {
      // 已有值但当前支路不读取：保留行 + 标注原因（不静默删值）；空行直接过滤。
      if (present) {
        const reason = state?.note || extended.note || '当前分支不读取该字段（值保留）'
        decorated.push({ ...row, unavailableReason: reason })
      } else {
        hidden.push(row.path)
      }
      continue
    }
    const read = state === undefined ? extended.read : state.read
    const note = state === undefined ? extended.note : state.note
    let next: PropertyRow = row
    const axisIndex = AXIS_BY_PATH[row.path]
    if (axisIndex !== undefined && branches.base) {
      next = { ...next, label: visibility.axisLabels[axisIndex] }
    }
    if (!read) {
      next = { ...next, unavailableReason: note.length > 0 ? note : '当前分支不读取该字段（值保留）' }
    }
    decorated.push(next)
  }

  return { rows: decorated, warnings: visibility.warnings, hidden }
}

/** 控制条扩展字段（positionVisibility 未覆盖的 offset 分量）的支路状态。 */
function extendPositionState(
  path: string,
  branches: PositionBranches,
): { visible: boolean; read: boolean; note: string } {
  if (path.startsWith('facing_target_offset.')) {
    return {
      visible: branches.lineBranch,
      read: branches.lineBranch,
      note: branches.lineBranch ? '' : 'line 分支不读取方向目标偏移',
    }
  }
  if (path === 'facing_target_freeze') {
    const selector = branches.lineBranch
    return {
      visible: branches.lineBranch,
      read: selector,
      note: branches.lineBranch ? '仅 target 为选择器时读取' : 'line 分支不读取冻结',
    }
  }
  return { visible: true, read: true, note: '' }
}

// ── absolute 显式清除 ────────────────────────────────────────────────────────

/** absolute 模式下被忽略、可被显式清除的位置 / 方向源字段。 */
export const ABSOLUTE_IGNORED_PATHS: readonly string[] = [
  'position_origin',
  'position_origin_x',
  'position_origin_y',
  'position_origin_z',
  'position_origin_freeze',
  'facing_source',
  'facing_target',
  'facing_target_x',
  'facing_target_y',
  'facing_target_z',
  'facing_target_offset.x',
  'facing_target_offset.y',
  'facing_target_offset.z',
  'facing_target_offset.space',
  'facing_target_freeze',
  'facing_entity',
]

/**
 * 生成「显式清除」命令：只删除文档里已存在的被忽略字段（`object.remove`），
 * 不存在的路径不产生命令。清除是作者显式操作；不静默删值。
 */
export function planClearIgnoredAbsolute(clipKey: string, objects: JsonObject): DocCommand[] {
  const commands: DocCommand[] = []
  for (const path of ABSOLUTE_IGNORED_PATHS) {
    if (Object.prototype.hasOwnProperty.call(objects, path)) {
      commands.push({ kind: 'object.remove', clipKey, path })
    }
  }
  return commands
}

// ── step 切换命令构造 ─────────────────────────────────────────────────────────

/** 读某路径现有帧（导出供控制条判断静态 / 节点写入）。 */
export function existingFrames(clip: JsonObject, path: string): ObjectKeyframe[] {
  return framesOf(clip, path)
}

/**
 * 普通字段写入命令：播放头命中帧 → 改帧；有帧无命中 → 加帧；否则写静态值。
 * 不做 step 三轴对齐检查（对齐检查走 `planPositionStepWrite`）。
 */
export function planSimpleWrite(
  clipKey: string,
  clip: JsonObject,
  path: string,
  time: number,
  value: JsonValue,
): DocCommand {
  const frames = framesOf(clip, path)
  const hit = frames.some((frame) => frame.time === time)
  if (hit) {
    return { kind: 'object.setKeyframeValue', clipKey, path, time, value }
  }
  if (frames.length > 0) {
    return { kind: 'object.addKeyframe', clipKey, path, time, value }
  }
  return { kind: 'object.setValue', clipKey, path, value }
}

function framesOf(objects: JsonObject, path: string): ObjectKeyframe[] {
  const raw = objects[path]
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return []
  }
  const frames: ObjectKeyframe[] = []
  for (const item of raw.keyframes) {
    if (isJsonObject(item) && typeof item.time === 'number') {
      frames.push({ time: item.time, value: (item.value ?? null) as JsonValue })
    }
  }
  return frames
}

export interface StepWritePlan {
  /** 缺三轴且未选择补齐 → 拦住提交。 */
  blocked: boolean
  missingAxes: string[]
  /** 可提交命令（blocked 时为空）。 */
  commands: DocCommand[]
  warnings: string[]
}

/**
 * 构造一次 step 字段写入命令：
 * - `time <= 0`：不要求三轴，直接写静态值 / 帧；
 * - `time > 0`：缺三轴先拦住（`blocked=true`）；作者选补齐后，补齐 ops 与 step 写在同一 commit。
 *
 * `fillAxes=true` 时补齐缺失轴（当前有效值各建一帧）。
 */
export function planPositionStepWrite(input: {
  clip: JsonObject
  catalog: CatalogIndex
  trackType: string
  clipKey: string
  path: string
  time: number
  value: JsonValue
  fillAxes: boolean
}): StepWritePlan {
  const spaceAtTime = String(staticField(input.clip, 'position_space', 'world'))
  const missingAxes = switchMissingAxes(input.clip, input.path, input.time, spaceAtTime)
  const warnings: string[] = []

  if (missingAxes.length > 0 && !input.fillAxes) {
    warnings.push(`t=${input.time} 切换 ${input.path} 缺三轴帧：${missingAxes.join(' / ')}；需补齐三轴后再提交`)
    return { blocked: true, missingAxes, commands: [], warnings }
  }

  const commands: DocCommand[] = []
  const frames = framesOf(input.clip, input.path)
  const hit = frames.some((frame) => frame.time === input.time)
  if (hit) {
    commands.push({
      kind: 'object.setKeyframeValue',
      clipKey: input.clipKey,
      path: input.path,
      time: input.time,
      value: input.value,
    })
  } else if (frames.length > 0) {
    commands.push({
      kind: 'object.addKeyframe',
      clipKey: input.clipKey,
      path: input.path,
      time: input.time,
      value: input.value,
    })
  } else {
    commands.push({ kind: 'object.setValue', clipKey: input.clipKey, path: input.path, value: input.value })
  }

  if (missingAxes.length > 0 && input.fillAxes) {
    const fillOps = fillAxesOps(input.clip, input.time, (path) => {
      const def = input.catalog.objectDef(input.trackType, path)
      return effectiveValue(input.clip, path, input.time, def)
    })
    if (fillOps.length > 0) {
      commands.push({ kind: 'object.editKeyframes', clipKey: input.clipKey, ops: fillOps })
    }
  }

  return { blocked: false, missingAxes, commands, warnings }
}

/** 多条命令合成一个 compound（一次撤销全回退）。 */
export function toCompound(clipKey: string, commands: readonly DocCommand[]): DocCommand | null {
  if (commands.length === 0) {
    return null
  }
  return { kind: 'compound', commands: [...commands] }
}
