/**
 * 07-04 朝向组界面投影（纯逻辑，不触 DOM / 不引 Vue）。
 *
 * - 把 core `resolveOrientation` 的 branch/disabled/warnings 转成组头文案与控件禁用表；
 * - 两个基准轴各自 world/entity/line 的组合；锁替换基准的提示；线基准端点与载荷；
 * - 切线偏移 `requires(orient=tangent)` 不满足时禁用但帧保留；
 * - 角度不归一化（720 / -540 原样）；`orient` 永不进效果面板。
 */
import type { CatalogIndex } from '../../../core/schema/index.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { PropertyRow } from '../../effects/types.ts'
import {
  resolveOrientation,
  baseSelectorVisible,
  offsetsReadable,
  type OrientationState,
  type OrientationValues,
} from '../orientation.ts'
import { draftPointSource, freezeAvailableForEndpoint, type PointSourceDraft } from './pointSourceFields.ts'
import { staticField } from './positionFields.ts'

// ── 输入读取 ────────────────────────────────────────────────────────────────

/** 投影所需的运行时补充信息（由父面板 / 预览解析给出；纯 UI 不重算）。 */
export interface OrientationRuntimeFlags {
  lookAtResolvable: boolean
  hasTangent: boolean
  lineResolvable: boolean
  lineHorizontalDegenerate: boolean
}

const DEFAULT_FLAGS: OrientationRuntimeFlags = {
  lookAtResolvable: false,
  hasTangent: false,
  lineResolvable: true,
  lineHorizontalDegenerate: false,
}

function nullableNumber(value: JsonValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 从对象面读朝向输入 + 运行时标志。 */
export function readOrientationValues(
  objects: JsonObject,
  flags: Partial<OrientationRuntimeFlags>,
): OrientationValues {
  const merged: OrientationRuntimeFlags = { ...DEFAULT_FLAGS, ...flags }
  const orientRaw = staticField(objects, 'orient', 'manual')
  const baseKind = (value: JsonValue): OrientationValues['yaw_base'] =>
    value === 'entity' || value === 'line' ? value : 'world'
  return {
    look_at: typeof staticField(objects, 'look_at', 'none') === 'string'
      ? (staticField(objects, 'look_at', 'none') as string)
      : 'none',
    look_at_resolvable: merged.lookAtResolvable,
    orient: orientRaw === 'tangent' ? 'tangent' : 'manual',
    has_tangent: merged.hasTangent,
    yaw_base: baseKind(staticField(objects, 'yaw_base', 'world')),
    pitch_base: baseKind(staticField(objects, 'pitch_base', 'world')),
    yaw_lock: nullableNumber(staticField(objects, 'yaw_lock', null)),
    pitch_lock: nullableNumber(staticField(objects, 'pitch_lock', null)),
    line_resolvable: merged.lineResolvable,
    line_horizontal_degenerate: merged.lineHorizontalDegenerate,
  }
}

// ── 控制条投影 ───────────────────────────────────────────────────────────────

export interface OrientationBarModel {
  values: OrientationValues
  state: OrientationState
  /** 基准选择器是否显示（任一轴为 entity）。 */
  selectorVisible: boolean
  /** 切线偏移是否可读。 */
  offsetsReadable: boolean
  lineFrom: PointSourceDraft
  lineTo: PointSourceDraft
  freezeFrom: { read: boolean; note: string }
  freezeTo: { read: boolean; note: string }
}

/** 朝向组控制条模型（三角度行由组内行组件渲染，这里不重复列值行）。 */
export function projectOrientationBar(
  objects: JsonObject,
  flags: Partial<OrientationRuntimeFlags>,
): OrientationBarModel {
  const values = readOrientationValues(objects, flags)
  const state = resolveOrientation(values)
  const fromRef = typeof staticField(objects, 'yaw_base_from', '') === 'string'
    ? (staticField(objects, 'yaw_base_from', '') as string)
    : ''
  const toRef = typeof staticField(objects, 'yaw_base_to', '') === 'string'
    ? (staticField(objects, 'yaw_base_to', '') as string)
    : ''
  const lineFrom = draftPointSource(fromRef, {
    x: staticField(objects, 'yaw_base_from_x', null),
    y: staticField(objects, 'yaw_base_from_y', null),
    z: staticField(objects, 'yaw_base_from_z', null),
  })
  const lineTo = draftPointSource(toRef, {
    x: staticField(objects, 'yaw_base_to_x', null),
    y: staticField(objects, 'yaw_base_to_y', null),
    z: staticField(objects, 'yaw_base_to_z', null),
  })
  return {
    values,
    state,
    selectorVisible: baseSelectorVisible(values),
    offsetsReadable: offsetsReadable(values.orient),
    lineFrom,
    lineTo,
    freezeFrom: freezeAvailableForEndpoint(fromRef),
    freezeTo: freezeAvailableForEndpoint(toRef),
  }
}

// ── 行装饰器 ─────────────────────────────────────────────────────────────────

export interface OrientationDecorateContext {
  trackType: string
  objects: JsonObject
  catalog: CatalogIndex
  flags: Partial<OrientationRuntimeFlags>
}

export interface OrientationDecorateResult {
  rows: PropertyRow[]
  warnings: string[]
}

/**
 * 装饰朝向组行：
 * - 优先级链压住的字段打 `unavailableReason`（原因文案；值与已有帧保留）；
 * - `orient=tangent` 但无切线：角度行标注「切线缺失，运行时回退 manual」；
 * - 切线偏移 `requires(orient=tangent)` 未满足：原因文案（核心 availability 已算过 requires，这里补充切线缺失语义）；
 * - `orient` 是静态值字段，永不进效果面板（行模式由目录 `mode=value` 决定，这里不过滤）。
 *
 * 返回新数组，不改入参行。
 */
export function decorateOrientationRows(
  rows: readonly PropertyRow[],
  ctx: OrientationDecorateContext,
): OrientationDecorateResult {
  const values = readOrientationValues(ctx.objects, ctx.flags)
  const state = resolveOrientation(values)
  const decorated: PropertyRow[] = []

  const tangentFallback = values.orient === 'tangent' && state.branch === 'manual'
  for (const row of rows) {
    if (row.section !== 'orientation') {
      decorated.push(row)
      continue
    }
    let next: PropertyRow = row
    const disabledReason = state.disabled[row.path]
    if (disabledReason !== undefined) {
      next = { ...next, unavailableReason: disabledReason }
    } else if (tangentFallback && (row.path === 'yaw' || row.path === 'pitch')) {
      next = { ...next, unavailableReason: '切线缺失，运行时回退 manual（值保留）' }
    } else if (row.path === 'yaw_offset' || row.path === 'pitch_offset') {
      if (!offsetsReadable(values.orient)) {
        next = { ...next, unavailableReason: '切线偏移需要 orient=tangent（条件不满足，值保留）' }
      }
    }
    decorated.push(next)
  }

  return { rows: decorated, warnings: state.warnings }
}

// ── 基准 / 锁语义提示 ────────────────────────────────────────────────────────

/** 锁替换基准再叠加角度的说明文案。 */
export function lockNote(axis: 'yaw' | 'pitch', lock: number | null): string {
  if (lock !== null) {
    return `${axis}_lock=${lock}：替换基准后再叠加角度值（与基准无关）`
  }
  return '未设锁：基准 + 角度值；设锁后锁替换基准'
}

/** 基准轴说明（world / entity / line）。 */
export function baseNote(axis: 'yaw' | 'pitch', base: OrientationValues['yaw_base'], disabled: boolean): string {
  if (disabled) {
    return '切线 / 注视支路不读取'
  }
  if (base === 'entity') {
    return '实体身体水平朝向（yaw）与视线 pitch；选择器为空 = @p'
  }
  if (base === 'line') {
    return '端点 → 方向角；不可解析或水平退化时取 0 并回退 world'
  }
  return '世界基准 = 0'
}
