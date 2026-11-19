/**
 * 12-08 飞控九槽姿态库：对外公开形状集中出口。
 *
 * 上游（模板面板 12-06 / 曲线工具 12-07 / 输入面板 12-08）只从本文件取类型与服务 token，
 * 不直接依赖 bank / apply / extract 内部模块。
 */
import { createServiceToken } from '../../workbench/api/services.ts'
import type { DocStore } from '../../core/doc/store.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { ScriptDoc } from '../../core/doc/types.ts'

import { poseBankFor, validatePoseValue, type PoseBank } from './bank.ts'
import { planApply } from './apply.ts'
import { poseFromClip } from './extract.ts'
import type {
  ApplyPlan,
  ApplyTarget,
  PoseExtraction,
  PoseValue,
} from './types.ts'

export {
  POSE_SLOT_COUNT,
  type PoseValue,
  type PoseVec3,
  type PoseSlot,
  type PoseSlotSource,
  type PoseDiagnostic,
  type PoseField,
  type ClipFieldApplyTarget,
  type TemplateParamApplyTarget,
  type PathPointApplyTarget,
  type ApplyTarget,
  type ApplyRequest,
  type PoseWrite,
  type ApplyPlan,
  type PoseExtraction,
} from './types.ts'

export { poseBankFor, validatePoseValue, planApply, poseFromClip }
export type { PoseBank }

/** 跨插件消费的姿态库服务。 */
export interface PoseBankService {
  /** 当前会话对应的槽库；无文档 / 未就绪返回 `null`。 */
  bank(): PoseBank | null
  /** 从当前文档选中片段求值姿态（不可忠实求值返回原因）。 */
  extract(clipKey: string, time: number): PoseExtraction
  /** 对当前文档计划一次应用（纯计划，不落文档）。 */
  planApply(target: ApplyTarget, pose: PoseValue): ApplyPlan
}

/** 服务 token：模板面板 / 曲线工具通过 `ctx.services.get(POSE_BANK_SERVICE)` 取同一实例。 */
export const POSE_BANK_SERVICE = createServiceToken<PoseBankService>('flight.poseBank')

// 便于消费方按需复用的类型窄引用（保持 public 面自洽）。
export type { DocStore, CatalogIndex, ScriptDoc }
