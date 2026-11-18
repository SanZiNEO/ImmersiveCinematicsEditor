/**
 * 07-04 朝向组：look_at → tangent → manual 的优先级投影、禁用矩阵、基准/锁语义。
 * 只反推「哪一层生效」；角度原样保留，不归一化。
 */
import type { JsonObject } from '../../core/doc/types.ts'

export type OrientBranch = 'look_at' | 'tangent' | 'manual'
export type BaseKind = 'world' | 'entity' | 'line'

export interface OrientationValues {
  look_at: string
  look_at_resolvable: boolean
  orient: 'manual' | 'tangent'
  has_tangent: boolean
  yaw_base: BaseKind
  pitch_base: BaseKind
  yaw_lock: number | null
  pitch_lock: number | null
  /** 线基准端点是否可解析。 */
  line_resolvable: boolean
  line_horizontal_degenerate: boolean
}

export interface OrientationState {
  branch: OrientBranch
  summary: string
  warnings: string[]
  disabled: Record<string, string>
  /** 当前轴标签（base=entity 时 yaw/pitch 基准提示）。 */
  yawBaseNote: string
  pitchBaseNote: string
}

/** 生效分支：look_at 压 tangent，tangent 压 manual；失败按顺序回退。 */
export function resolveOrientation(values: OrientationValues): OrientationState {
  const warnings: string[] = []
  const disabled: Record<string, string> = {}
  let branch: OrientBranch
  let summary: string
  if (values.look_at !== 'none') {
    if (values.look_at_resolvable) {
      branch = 'look_at'
      summary = `look_at=${values.look_at} 目标可解析：注视支路（yaw/pitch 由目标方向决定，roll 保留）`
      for (const key of ['yaw', 'pitch', 'yaw_lock', 'pitch_lock', 'yaw_offset', 'pitch_offset', 'yaw_base', 'pitch_base', 'yaw_base_selector']) {
        disabled[key] = 'look_at 生效时不读取'
      }
      warnings.push('look_at 可解析：yaw/pitch 字段不参与，roll 仍可编辑')
    } else if (values.orient === 'tangent' && values.has_tangent) {
      branch = 'tangent'
      summary = `look_at=${values.look_at} 目标不可解析：回退 tangent（有切线）`
      warnings.push('look_at 目标不可解析：已回退切线，原角度字段未被改写')
      for (const key of ['yaw', 'pitch', 'yaw_lock', 'pitch_lock', 'yaw_base', 'pitch_base', 'yaw_base_selector']) {
        disabled[key] = '切线支路不读取'
      }
    } else {
      branch = 'manual'
      summary = `look_at=${values.look_at} 目标不可解析：回退 manual（无可用切线）`
      warnings.push('look_at 目标不可解析，且无切线：回退手动；角度保持原值，未改成 0')
      disabled.yaw_offset = '切线偏移需 orient=tangent'
      disabled.pitch_offset = '切线偏移需 orient=tangent'
    }
  } else if (values.orient === 'tangent' && values.has_tangent) {
    branch = 'tangent'
    summary = 'orient=tangent 且有非零切线：切线支路（yaw/pitch 由切线算，偏移叠加，roll 保留）'
    for (const key of ['yaw', 'pitch', 'yaw_lock', 'pitch_lock', 'yaw_base', 'pitch_base', 'yaw_base_selector']) {
      disabled[key] = '切线支路不读取'
    }
  } else if (values.orient === 'tangent') {
    branch = 'manual'
    summary = 'orient=tangent 但无切线：回退 manual'
    warnings.push('orient=tangent 但没有非零切线：回退手动；切线偏移禁用')
    disabled.yaw_offset = '无切线，偏移不生效'
    disabled.pitch_offset = '无切线，偏移不生效'
  } else {
    branch = 'manual'
    summary = 'orient=manual：手动角度 =（锁 ?? 基准）+ 角度值'
    disabled.yaw_offset = '切线偏移需 orient=tangent'
    disabled.pitch_offset = '切线偏移需 orient=tangent'
  }
  const yawBaseNote = baseNote(values.yaw_base, disabled)
  const pitchBaseNote = baseNote(values.pitch_base, disabled)
  if ((values.yaw_base === 'line' || values.pitch_base === 'line') && branch === 'manual') {
    if (!values.line_resolvable) {
      warnings.push('线基准端点不可解析：该轴角度取 0 并回退 world 基准（值保留）')
    } else if (values.line_horizontal_degenerate) {
      warnings.push('线基准端点水平分量过小：该轴角度取 0 并回退 world 基准（值保留）')
    }
  }
  return { branch, summary, warnings, disabled, yawBaseNote, pitchBaseNote }
}

/** 手动角度：`(lock ?? base) + angle`，不归一化。 */
export function manualAngle(lock: number | null, base: number, angle: number): number {
  return (lock === null ? base : lock) + angle
}

/** 线基准两端重合 / 水平退化时的角度（0,0）。 */
export function lineBaseAngles(
  from: { x: number; z: number } | null,
  to: { x: number; z: number } | null,
): { yaw: number; pitch: number; warning: string | null } {
  if (from === null || to === null) {
    return { yaw: 0, pitch: 0, warning: '线基准端点不可解析' }
  }
  const dx = to.x - from.x
  const dz = to.z - from.z
  const horizontal = Math.hypot(dx, dz)
  if (horizontal < 1e-6) {
    return { yaw: 0, pitch: 0, warning: '线基准水平分量过小（两端重合或竖直共线）' }
  }
  const yaw = (Math.atan2(dz, dx) * 180) / Math.PI
  return { yaw, pitch: 0, warning: null }
}

/** `orient` 永远只进属性面板（value 字段无 keyframes）。 */
export function orientInEffects(): boolean {
  return false
}

/** `yaw_offset/pitch_offset` 在非 tangent 时保留值但运行时不读。 */
export function offsetsReadable(orient: string): boolean {
  return orient === 'tangent'
}

/** `yaw_base_selector` 在任一轴为 entity 时显示（一个字段服务两轴）。 */
export function baseSelectorVisible(values: OrientationValues): boolean {
  return values.yaw_base === 'entity' || values.pitch_base === 'entity'
}

/** 从片段字段读朝向输入（仅 UI 投影用）。 */
export function readOrientationValues(clip: JsonObject, resolve: (path: string) => unknown): OrientationValues {
  const lookAt = String(resolve('look_at') ?? 'none')
  const orient = String(resolve('orient') ?? 'manual') === 'tangent' ? 'tangent' : 'manual'
  return {
    look_at: lookAt,
    look_at_resolvable: Boolean(resolve('look_at_resolvable') ?? false),
    orient,
    has_tangent: Boolean(resolve('has_tangent') ?? false),
    yaw_base: baseKind(resolve('yaw_base')),
    pitch_base: baseKind(resolve('pitch_base')),
    yaw_lock: nullableNumber(resolve('yaw_lock')),
    pitch_lock: nullableNumber(resolve('pitch_lock')),
    line_resolvable: Boolean(resolve('line_resolvable') ?? false),
    line_horizontal_degenerate: Boolean(resolve('line_horizontal_degenerate') ?? false),
  }
}

function baseNote(base: BaseKind, disabled: Record<string, string>): string {
  if (disabled.yaw_base !== undefined) {
    return '切线 / 注视支路不读取'
  }
  if (base === 'entity') {
    return '实体身体水平朝向（yaw）与视线 pitch；选择器为空 = @p'
  }
  if (base === 'line') {
    return '端点 → 方向角；不可解析时取 0 并回退 world'
  }
  return '世界基准 = 0'
}

function baseKind(value: unknown): BaseKind {
  return value === 'entity' || value === 'line' ? value : 'world'
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
