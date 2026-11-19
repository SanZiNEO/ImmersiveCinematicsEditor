/**
 * 12-08 飞控九槽姿态库：公开类型形状（冻结面）。
 *
 * 姿态只含 位置三分量 + 三个角 + 视场角 + 缩放；不存绝对 / 相对标记、不存玩家基准、
 * 不存槽号以外的身份。所有数值必须是有限数字。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'

/** 固定槽位数（九槽，不可增删）。 */
export const POSE_SLOT_COUNT = 9

/** 姿态三分量位置（世界坐标，供写入方按目标参考系解释）。 */
export interface PoseVec3 {
  x: number
  y: number
  z: number
}

/** 姿态值：与 spec §2.1 `PoseValue` 形状完全一致，全 number。 */
export interface PoseValue {
  position: PoseVec3
  yaw: number
  pitch: number
  roll: number
  fov: number
  zoom: number
}

/** 槽内容来源标注：飞控最近姿态 / 片段求值 / 手动编辑。 */
export type PoseSlotSource = 'flight' | 'clip' | 'manual'

/** 单个槽位：空槽 `pose` / `source` 为 `null`。 */
export interface PoseSlot {
  index: number
  pose: PoseValue | null
  source: PoseSlotSource | null
}

/** 诊断条目（与 12-02 诊断面同口径：码 / 级别 / 文案 / 字段路径）。 */
export interface PoseDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  fieldPath?: string
}

/** 姿态可映射到的参数分量。 */
export type PoseField = 'position' | 'yaw' | 'pitch' | 'roll' | 'fov' | 'zoom'

/**
 * 写入目标之一：相机叶子字段 / 关键帧当前值。
 * `frameMode=static` 写静态值；`keyframe` 优先命中当前帧，未命中在该时间补一帧。
 */
export interface ClipFieldApplyTarget {
  kind: 'clipField'
  clipKey: string
  clip: JsonObject
  time: number
  frameMode: 'static' | 'keyframe'
}

/**
 * 模板参数目标：只把数值填进参数表单，不写槽 id / 模板 id，不直接落文档。
 * `mapping` 为 参数键 → 姿态分量；`position` 分量映射为三轴对象。
 */
export interface TemplateParamApplyTarget {
  kind: 'templateParam'
  mapping: Record<string, PoseField>
}

/** 路径目标：端点（绑定已存在的位置节点时间）或控制点（写完整对象形态）。 */
export interface PathPointApplyTarget {
  kind: 'pathPoint'
  pathId: string
  point:
    | { type: 'endpoint'; side: 'from' | 'to' }
    | { type: 'control'; index: number }
  /** 端点写回所属片段的键（控制点不需要）。由面板从路径条目 `clip` 解析后传入。 */
  clipKey?: string
}

/** 四类目标归并：clipField / templateParam / pathPoint（端点 + 控制点）。 */
export type ApplyTarget = ClipFieldApplyTarget | TemplateParamApplyTarget | PathPointApplyTarget

/** 一次应用计划的输入。 */
export interface ApplyRequest {
  pose: PoseValue
  target: ApplyTarget
  doc: ScriptDoc
  catalog: CatalogIndex
  /** 播放头（秒）；未显式指定时间的目标以它为准。 */
  playhead: number
}

/** 一条计划写入：字段路径 + 旧值 + 新值（旧值读自当前文档，便于 diff 呈现）。 */
export interface PoseWrite {
  fieldPath: string
  oldValue: JsonValue | null
  newValue: JsonValue
}

/** 应用计划：将改的字段 + 旧值 + 新值 + 事务命令；`command=null` 表示不落文档（模板参数填表）。 */
export interface ApplyPlan {
  ok: boolean
  writes: PoseWrite[]
  diagnostics: PoseDiagnostic[]
  command: DocCommand | null
}

/** 片段求值结果：不可忠实求值时 `pose=null`，`reasons` 逐条说明禁用原因。 */
export interface PoseExtraction {
  ok: boolean
  pose: PoseValue | null
  reasons: PoseDiagnostic[]
}
