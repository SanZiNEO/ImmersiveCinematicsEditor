/**
 * 12-08 会话级九槽姿态库。
 *
 * - 按 `DocStore` 身份取库（WeakMap）；监听 store `open` 事件清空——关闭重开文档即失效；
 *   面板关闭重开不丢（同一会话同一 store 实例）。
 * - 槽内容只有姿态数值；不存绝对 / 相对标记、不存玩家基准、不存槽号以外的身份。
 * - 存槽 / 清槽 / 槽间复制都是纯会话内存操作：不产生消息、不改姿态状态、不进事务、不落盘。
 */
import type { DocStore } from '../../core/doc/store.ts'
import { cloneJson, isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { JsonValue } from '../../core/doc/types.ts'
import {
  POSE_SLOT_COUNT,
  type PoseSlot,
  type PoseSlotSource,
  type PoseValue,
} from './types.ts'

/** 姿态库接口（公开形状见 `public.ts`）。 */
export interface PoseBank {
  /** 全部固定槽位（顺序即槽号 0–8）。 */
  slots(): readonly PoseSlot[]
  /** 按槽号取槽；越界返回 `null`。 */
  slot(index: number): PoseSlot | null
  /** 存槽（校验通过才写入；非法姿态静默拒绝，草稿留在调用方）。 */
  set(index: number, pose: PoseValue, source: PoseSlotSource): void
  /** 清空单个槽。 */
  clear(index: number): void
  /** 槽间复制（会话内，不经系统剪贴板）。 */
  copy(from: number, to: number): void
  /** 最近姿态（飞控到达的最近状态或退出姿态）；没有为 `null`。 */
  latest(): PoseValue | null
  /** 写入最近姿态；`null` 清除。 */
  setLatest(pose: PoseValue | null): void
}

/** 校验姿态：三轴齐全且全部有限数字；返回拒绝原因，通过为 `null`。 */
export function validatePoseValue(pose: unknown): string | null {
  if (!isJsonObject(pose)) {
    return '姿态需要对象'
  }
  const position = pose.position
  if (!isJsonObject(position)) {
    return '缺少 position 三分量'
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!isFiniteNumber(position[axis])) {
      return `position.${axis} 需要有限数字`
    }
  }
  for (const axis of ['yaw', 'pitch', 'roll', 'fov', 'zoom'] as const) {
    if (!isFiniteNumber(pose[axis])) {
      return `${axis} 需要有限数字`
    }
  }
  return null
}

function clonePose(pose: PoseValue): PoseValue {
  return cloneJson(pose as unknown as JsonValue) as unknown as PoseValue
}

function emptySlot(index: number): PoseSlot {
  return { index, pose: null, source: null }
}

const banks = new WeakMap<DocStore, PoseBank>()

/** 按 store 身份取库；同一 store 同一实例，重开文档由 `open` 事件清空。 */
export function poseBankFor(store: DocStore): PoseBank {
  const existing = banks.get(store)
  if (existing !== undefined) {
    return existing
  }

  const slots: PoseSlot[] = Array.from({ length: POSE_SLOT_COUNT }, (_, index) => emptySlot(index))
  let latest: PoseValue | null = null

  const bank: PoseBank = {
    slots: () => slots,
    slot(index) {
      return index >= 0 && index < POSE_SLOT_COUNT ? slots[index] : null
    },
    set(index, pose, source) {
      if (index < 0 || index >= POSE_SLOT_COUNT) {
        return
      }
      if (validatePoseValue(pose) !== null) {
        return
      }
      slots[index] = { index, pose: clonePose(pose), source }
    },
    clear(index) {
      if (index < 0 || index >= POSE_SLOT_COUNT) {
        return
      }
      slots[index] = emptySlot(index)
    },
    copy(from, to) {
      if (from < 0 || from >= POSE_SLOT_COUNT || to < 0 || to >= POSE_SLOT_COUNT) {
        return
      }
      const source = slots[from]
      slots[to] = source.pose === null
        ? emptySlot(to)
        : { index: to, pose: clonePose(source.pose), source: source.source }
    },
    latest: () => latest,
    setLatest(pose) {
      latest = pose === null ? null : clonePose(pose)
    },
  }

  // 关闭重开文档即失效；面板关闭重开不触发 `open`，槽保留。
  store.subscribe((event) => {
    if (event !== 'open') {
      return
    }
    for (let index = 0; index < POSE_SLOT_COUNT; index += 1) {
      slots[index] = emptySlot(index)
    }
    latest = null
  })

  banks.set(store, bank)
  return bank
}

/** 供诊断 / 面板读取旧值用的窄类型守卫（避免在 bank 层依赖 JsonValue 细节）。 */
export function poseValueFromJson(value: JsonValue): PoseValue | null {
  if (validatePoseValue(value) !== null) {
    return null
  }
  return cloneJson(value) as unknown as PoseValue
}
