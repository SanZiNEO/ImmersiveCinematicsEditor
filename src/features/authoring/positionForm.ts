/**
 * 07-02 位置组：三种求值形态、可见性矩阵、base 轴标签、step 切换对齐。
 * 只做界面投影与本地校验；不重算运行时位置。
 */
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { parsePointSource, resolveFacingAuto } from './pointSource.ts'
import type { RefKind } from './pointSource.ts'

export type PositionMode = 'relative' | 'absolute'
export type PositionSpace = 'world' | 'base'
export type FacingSource = 'auto' | 'entity' | 'line' | 'world'

export interface PositionValues {
  position_mode: PositionMode
  position_space: PositionSpace
  position_origin: string
  facing_source: FacingSource
  facing_target: string
  facing_entity: string
}

export interface PositionFieldState {
  visible: boolean
  enabled: boolean
  /** false = 值保留但运行时不读取。 */
  read: boolean
  note: string
}

export interface PositionVisibility {
  fields: Record<string, PositionFieldState>
  axisLabels: [string, string, string]
  summary: string
  warnings: string[]
  canSubmit: boolean
}

/** 位置字段（含 base 扩展）的可见性矩阵。 */
export function positionVisibility(values: PositionValues): PositionVisibility {
  const originKind: RefKind = parsePointSource(values.position_origin).kind
  const fields: Record<string, PositionFieldState> = {}
  const warnings: string[] = []
  const set = (key: string, state: Partial<PositionFieldState> & { visible: boolean }): void => {
    fields[key] = { visible: state.visible, enabled: state.enabled ?? state.visible, read: state.read ?? state.visible, note: state.note ?? '' }
  }
  const absolute = values.position_mode === 'absolute'
  const base = !absolute && values.position_space === 'base'
  const originCoords = !absolute && originKind === 'coordinate'
  const originFreeze = !absolute && (originKind === 'selector' || (base && originKind === 'empty'))
  const facingVisible = base
  const source = values.facing_source
  const auto = resolveFacingAuto({
    target: values.facing_target,
    entity: values.facing_entity,
    originKind,
  })
  if (auto.warning !== null) {
    warnings.push(auto.warning)
  }
  const absoluteIgnoredOrigin = absolute && values.position_origin !== ''
  const absoluteIgnoredFacing = absolute && (values.facing_target !== '' || values.facing_entity !== '')
  if (absoluteIgnoredOrigin) {
    warnings.push('absolute 不读取原点；请显式清除 position_origin 后再提交')
  }
  if (absoluteIgnoredFacing) {
    warnings.push('absolute 不读取方向源；请显式清除 facing_target / facing_entity 后再提交')
  }

  set('position_mode', { visible: true })
  set('position_space', {
    visible: true,
    enabled: !absolute,
    note: absolute ? 'absolute 锁定 world（已写 base 不读取）' : '',
  })
  set('position_origin', {
    visible: !absolute,
    read: !absolute,
    note: absolute ? '将被忽略（absolute 不读原点）' : '',
  })
  set('position_origin_x', { visible: originCoords, note: '空值 = 0（运行期按 0 读）' })
  set('position_origin_y', { visible: originCoords, note: '空值 = 0（运行期按 0 读）' })
  set('position_origin_z', { visible: originCoords, note: '空值 = 0（运行期按 0 读）' })
  set('position_origin_freeze', {
    visible: !absolute && (base || originKind === 'selector'),
    enabled: originFreeze,
    read: originFreeze,
    note: !originFreeze && !absolute ? '仅原点为空（base）或实体选择器时读取' : '',
  })
  set('facing_source', {
    visible: facingVisible,
    read: facingVisible,
    note: !facingVisible ? 'relative+world 不读取方向源' : '',
  })
  const lineBranch = facingVisible && (source === 'line' || (source === 'auto' && auto.branch === 'line'))
  const entityBranch = facingVisible && (source === 'entity' || (source === 'auto' && auto.branch === 'entity'))
  set('facing_target', {
    visible: facingVisible && (source === 'auto' || source === 'line'),
    enabled: facingVisible && (source === 'auto' || source === 'line'),
    read: lineBranch,
    note: !facingVisible ? 'relative+world 不读取方向源' : source === 'world' ? 'facing_source=world 不读取' : '',
  })
  set('facing_target_x', { visible: lineBranch, note: '空值 = 0' })
  set('facing_target_y', { visible: lineBranch, note: '空值 = 0' })
  set('facing_target_z', { visible: lineBranch, note: '空值 = 0' })
  set('facing_entity', {
    visible: facingVisible && (source === 'auto' || source === 'entity'),
    enabled: facingVisible && (source === 'auto' || source === 'entity'),
    read: entityBranch,
    note: !facingVisible ? 'relative+world 不读取方向源' : source === 'world' ? 'facing_source=world 不读取' : '',
  })
  set('facing_target_freeze', {
    visible: lineBranch,
    enabled: lineBranch && parsePointSource(values.facing_target).kind === 'selector',
    read: lineBranch && parsePointSource(values.facing_target).kind === 'selector',
    note: lineBranch ? '仅 target 为选择器时读取' : '',
  })
  set('facing_entity_freeze', {
    visible: entityBranch,
    enabled: entityBranch,
    read: entityBranch,
    note: '',
  })
  const axisLabels: [string, string, string] = base ? ['fwd', 'up', 'right'] : ['x', 'y', 'z']
  let summary: string
  if (absolute) {
    summary = 'absolute：世界坐标 =（x, y, z）；空间锁 world，原点与方向源不参与'
  } else if (!base) {
    summary = originKind === 'empty'
      ? 'relative + world：世界坐标 = 玩家激活位置 +（x, y, z）'
      : `relative + world：世界坐标 = ${values.position_origin || '（空）'} +（x, y, z）`
  } else {
    summary = `relative + base：世界坐标 = 原点 + fwd·x + up·y + right·z；方向源分支 = ${effectiveFacingBranch(values, auto.branch)}`
  }
  const canSubmit = auto.warning === null && !absoluteIgnoredOrigin && !absoluteIgnoredFacing
  return { fields, axisLabels, summary, warnings, canSubmit }
}

/** 实际生效的 facing 分支（auto 用解析结果）。 */
export function effectiveFacingBranch(values: PositionValues, autoBranch: 'line' | 'entity' | 'world'): string {
  if (values.facing_source !== 'auto') {
    return values.facing_source
  }
  return `${autoBranch}（auto）`
}

/** 位置三轴在 `time` 是否都有**精确相等**的关键帧（无容差）。 */
export function missingPositionAxesExact(clip: JsonObject, time: number): string[] {
  const missing: string[] = []
  for (const axis of ['position.x', 'position.y', 'position.z']) {
    if (!hasExactFrame(clip, axis, time)) {
      missing.push(axis)
    }
  }
  return missing
}

/** step 字段变化点是否要求三轴对齐；返回缺失轴。 */
export function switchMissingAxes(
  clip: JsonObject,
  changedPath: string,
  time: number,
  spaceAtTime: string,
): string[] {
  if (time <= 0) {
    return []
  }
  const base = spaceAtTime === 'base'
  if (!stepFieldApplies(changedPath, base)) {
    return []
  }
  return missingPositionAxesExact(clip, time)
}

/** 补齐三轴的操作列表（使用当前有效值）。 */
export function fillAxesOps(
  clip: JsonObject,
  time: number,
  resolveValue: (path: string) => JsonValue,
): Array<{ op: 'add'; path: string; time: number; value: JsonValue }> {
  const missing = missingPositionAxesExact(clip, time)
  return missing.map((path) => ({ op: 'add' as const, path, time, value: resolveValue(path) }))
}

/** step 字段是否在指定空间下参与检查。 */
export function stepFieldApplies(path: string, base: boolean): boolean {
  const always = ['position_mode', 'position_space', 'position_origin', 'position_origin_freeze', 'facing_source']
  if (always.includes(path)) {
    return true
  }
  if (!base) {
    return false
  }
  return [
    'facing_target',
    'facing_target_freeze',
    'facing_entity',
    'look_at_freeze',
    'yaw_base_from_freeze',
    'yaw_base_to_freeze',
  ].includes(path)
}

function hasExactFrame(clip: JsonObject, path: string, time: number): boolean {
  const raw = isJsonObject(clip.objects) ? clip.objects[path] : undefined
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) {
    return false
  }
  return raw.keyframes.some((frame) => isJsonObject(frame) && frame.time === time)
}
