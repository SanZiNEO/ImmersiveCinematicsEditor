/**
 * 效果行 / 关键帧组的事件载荷（06-04 / 06-05）。
 *
 * 组件只发意图，写入由外壳统一走 `ctx.commands.commit`（`keyframeOps` 负责翻译成命令）。
 * 载荷刻意做成纯数据：不带文档对象、不带数组下标，节点身份一律 `clipKey + path + time`。
 */
import type { JsonValue } from '../../../core/doc/types.ts'
import type { RejectCode } from '../types.ts'

/** 选择模式：替换 / 同属性范围 / 跨属性增删 / 追加（框选）。 */
export type NodeSelectMode = 'replace' | 'range' | 'toggle' | 'add' | 'rect'

/** 选中节点（点击、范围选择、框选共用）。 */
export interface NodeSelectPayload {
  clipKey: string
  path: string
  /** 主节点时间（框选时取第一个覆盖到的节点）。 */
  time: number
  mode: NodeSelectMode
  /** 同一次选择涉及的多个时间；缺省表示只有 `time`。 */
  times?: number[]
  /**
   * 框选矩形（内容区像素坐标，相对整个关键帧内容区）。
   *
   * 只有 `mode === 'rect'` 时给出：外壳用它跨行解析（`selectionsInRect`），
   * 从而做到"跨行框选只选覆盖到的节点，不选段线"。
   */
  rect?: { left: number; top: number; right: number; bottom: number }
}

/** 一次拖动提交的载荷。 */
export interface NodeMovePayload {
  clipKey: string
  /** 本行内的移动（外壳可直接交给 `moveKeyframesCommand`）。 */
  moves: Array<{ path: string; from: number; to: number }>
  /** 本次拖动统一的偏移（秒）：外壳据此把同批其他选中行一起移动。 */
  deltaSeconds: number
  /** 被直接拖动的主节点。 */
  primary: { path: string; from: number; to: number }
}

/** 删除节点。 */
export interface RemoveKeyframesPayload {
  clipKey: string
  targets: Array<{ path: string; time: number }>
}

/** 关闭动画。 */
export interface DisableAnimationPayload {
  clipKey: string
  path: string
}

/** 加帧意图（值控件在播放头没有节点时先留草稿，点"添加帧"才发）。 */
export interface AddKeyframePayload {
  clipKey: string
  path: string
  time: number
  value: JsonValue
}

/** 一次写入的结果通知（写入已由值控件经 `ctx.commands.commit` 完成）。 */
export interface SetValuePayload {
  clipKey: string
  path: string
  /** 写入目标的节点时间；写静态值时为播放头时间。 */
  time: number
  ok: boolean
  code?: RejectCode
  message?: string
  value?: JsonValue
}

/** 定位诊断。 */
export interface RevealDiagnosticPayload {
  clipKey: string
  path: string
  time?: number
}

/** 打开事件记录编辑器（记录编辑器由切片 C 提供）。 */
export interface OpenEventEditorPayload {
  clipKey: string
  path: string
  time: number
}

/** 行 / 组共用的事件表类型（`defineEmits` 直接引用）。 */
export interface EffectRowEmitMap {
  'select-node': [payload: NodeSelectPayload]
  'move-nodes': [payload: NodeMovePayload]
  'remove-keyframes': [payload: RemoveKeyframesPayload]
  'disable-animation': [payload: DisableAnimationPayload]
  'add-keyframe': [payload: AddKeyframePayload]
  'set-value': [payload: SetValuePayload]
  'reveal-diagnostic': [payload: RevealDiagnosticPayload]
  'open-event-editor': [payload: OpenEventEditorPayload]
  /** 段选择（缓动编辑入口，06-06）：外壳据此写 `session.selectedSegment`。 */
  'select-segment': [payload: { clipKey: string; path: string; fromTime: number; toTime: number }]
}

/** 值控件的事件表类型。 */
export interface ValueFormEmitMap {
  commit: [payload: SetValuePayload]
  'add-keyframe': [payload: AddKeyframePayload]
}
