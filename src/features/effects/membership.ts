/**
 * 面板归属策略（06 README「层级策略」）：冻结的两种策略，共用同一份文档模型。
 *
 * `leaf`（默认）：`row.keyframes.length > 0` 的叶子进效果面板，其余叶子留属性面板。
 * `group`：组内任一叶子有帧，整个组进效果面板；组内无帧叶子作为静态伴随行一起显示。
 *
 * 策略只决定"行归哪一侧"，不复制对象、不写 UI 字段、不改文档。
 * 分区后的统计永远由行现算（按传入的片段时长），不沿用分区前的缓存值。
 */
import type { ClipTiming } from './rows.ts'
import { outOfRangeCount } from './rows.ts'
import type {
  EffectGroup,
  PanelMembership,
  PanelMembershipMode,
  PanelPartition,
  PropertyRow,
} from './types.ts'

/** 行是否"有非空关键帧"：`EVENT` 必须有记录，`ANIMATED` 允许空帧。 */
export function hasKeyframeContent(row: PropertyRow): boolean {
  return row.keyframes.length > 0
}

/** 建组：按首次出现顺序，组内保持行顺序；统计按给定片段时长现算。 */
export function buildGroups(rows: readonly PropertyRow[], timing: ClipTiming): EffectGroup[] {
  const byKey = new Map<string, EffectGroup>()
  const order: string[] = []
  for (const row of rows) {
    const key = row.groupKey
    let group = byKey.get(key)
    if (group === undefined) {
      group = {
        key,
        label: row.groupLabel,
        order: order.length,
        rows: [],
        animatedCount: 0,
        staticCompanionCount: 0,
        frameCount: 0,
        outOfRangeCount: 0,
        unknown: false,
      }
      byKey.set(key, group)
      order.push(key)
    }
    group.rows.push(row)
    if (row.unknown) {
      group.unknown = true
    }
    if (hasKeyframeContent(row)) {
      group.animatedCount += 1
      group.frameCount += row.keyframes.length
      group.outOfRangeCount += outOfRangeCount(row, timing)
    }
  }
  return order.map((key) => byKey.get(key) as EffectGroup)
}

/** 用给定行重建一个组：重算动画行数 / 静态伴随数 / 帧数 / 轴外数。 */
function withRows(
  group: EffectGroup,
  rows: PropertyRow[],
  staticCompanions: number,
  timing: ClipTiming,
): EffectGroup {
  let animatedCount = 0
  let frameCount = 0
  let outOfRange = 0
  for (const row of rows) {
    if (!hasKeyframeContent(row)) {
      continue
    }
    animatedCount += 1
    frameCount += row.keyframes.length
    outOfRange += outOfRangeCount(row, timing)
  }
  return {
    key: group.key,
    label: group.label,
    order: group.order,
    rows,
    animatedCount,
    staticCompanionCount: staticCompanions,
    frameCount,
    outOfRangeCount: outOfRange,
    unknown: group.unknown,
  }
}

/** 取一个归属策略；`timing` 只用于分区后的轴外统计。 */
export function panelMembership(mode: PanelMembershipMode, timing: ClipTiming): PanelMembership {
  const isRowInEffect = (row: PropertyRow): boolean => hasKeyframeContent(row)
  const isGroupInEffect = (group: EffectGroup): boolean => group.animatedCount > 0

  return {
    mode,
    isRowInEffect,
    isGroupInEffect,
    partition(groups) {
      const effectGroups: EffectGroup[] = []
      const propertyGroups: EffectGroup[] = []
      for (const group of groups) {
        if (mode === 'group') {
          if (group.animatedCount > 0) {
            const companions = group.rows.filter((row) => !hasKeyframeContent(row)).length
            effectGroups.push(withRows(group, group.rows, companions, timing))
          } else {
            propertyGroups.push(withRows(group, group.rows, 0, timing))
          }
          continue
        }
        const effectRows = group.rows.filter(isRowInEffect)
        const propertyRows = group.rows.filter((row) => !isRowInEffect(row))
        if (effectRows.length > 0) {
          effectGroups.push(withRows(group, effectRows, 0, timing))
        }
        if (propertyRows.length > 0) {
          propertyGroups.push(withRows(group, propertyRows, 0, timing))
        }
      }
      return { effectGroups, propertyGroups }
    },
  }
}

/** 按策略分区（等价 `panelMembership(mode, timing).partition(groups)`）。 */
export function partitionGroups(
  groups: readonly EffectGroup[],
  mode: PanelMembershipMode,
  timing: ClipTiming,
): PanelPartition {
  return panelMembership(mode, timing).partition([...groups])
}

/** 统计片段的动画属性数 / 总帧数 / 事件行数 / 已设置行数（片段头与组头用）。 */
export function summarizeRows(rows: readonly PropertyRow[]): {
  animatedCount: number
  frameCount: number
  eventCount: number
  setCount: number
} {
  let animatedCount = 0
  let frameCount = 0
  let eventCount = 0
  let setCount = 0
  for (const row of rows) {
    if (row.present) {
      setCount += 1
    }
    if (row.mode === 'event') {
      if (row.keyframes.length > 0) {
        eventCount += 1
        animatedCount += 1
        frameCount += row.keyframes.length
      }
      continue
    }
    if (row.keyframes.length > 0) {
      animatedCount += 1
      frameCount += row.keyframes.length
    }
  }
  return { animatedCount, frameCount, eventCount, setCount }
}
