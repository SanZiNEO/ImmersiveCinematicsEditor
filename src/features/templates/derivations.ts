/**
 * 封闭派生登记（12-02 §三·绑定形态三）。
 *
 * 派生是登记在册的固定算法：本轮只登记实际模板需要的几个（角度 / 时长均分、按序号取姿态）。
 * 派生不访问上层未声明参数、不产生命名空间；输入参数齐全且为有限值才参与计算。
 */
import type { ParamValue, PoseValue } from './types.ts'

export interface Derivation {
  name: string
  args: readonly string[]
  compute: (args: Record<string, ParamValue>, index: number, count: number) => ParamValue
}

function finiteNumber(value: ParamValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const angleSplit: Derivation = {
  name: 'angleSplit',
  args: ['startAngle', 'sweep', 'segments'],
  compute(args, index) {
    const start = finiteNumber(args.startAngle)
    const sweep = finiteNumber(args.sweep)
    const segments = finiteNumber(args.segments)
    if (start === null || sweep === null || segments === null || segments <= 0) {
      return null
    }
    return start + (sweep * index) / segments
  },
}

const durationSplit: Derivation = {
  name: 'durationSplit',
  args: ['totalDuration', 'segments'],
  compute(args, _index, count) {
    const total = finiteNumber(args.totalDuration)
    const segments = finiteNumber(args.segments)
    if (total === null || segments === null || segments <= 0) {
      return null
    }
    void count
    return total / segments
  },
}

const poseAt: Derivation = {
  name: 'poseAt',
  args: ['list'],
  compute(args, index) {
    const list = args.list
    if (!Array.isArray(list) || index < 0 || index >= list.length) {
      return null
    }
    return list[index] as ParamValue
  },
}

/** 登记在册的封闭派生表。 */
export const DERIVATIONS: Record<string, Derivation> = {
  angleSplit,
  durationSplit,
  poseAt,
}

export function derivationByName(name: string): Derivation | null {
  return DERIVATIONS[name] ?? null
}

/** 派生参数取值（供模板展开复用：按序号取姿态）。 */
export function pickPoseAt(list: readonly PoseValue[], index: number): PoseValue | null {
  if (index < 0 || index >= list.length) {
    return null
  }
  return list[index]
}
