/**
 * 06 效果领域：属性行、效果组、归属策略、局部视口的冻结契约。
 *
 * 依赖方向（06-12）：`features/` 只依赖 `core/` 与工作台 API，不引用插件、不引用 Vue。
 * 本文件只声明形状与纯类型，不含任何实现；派生实现在同目录的纯函数模块里。
 *
 * 事实基准：
 * - 属性行来自 `clip.objects` + 02 目录（`FieldEntry`），不复制字段表；
 * - 归属只由 `keyframes.length` 决定，不写文档、不写会话；
 * - 视口是会话数据，不进文档序列化。
 */
import type { JsonValue, ObjectKeyframe } from '../../core/doc/types.ts'
import type { FieldEntry, FieldInterp, FieldMode } from '../../core/schema/types.ts'

/** 归属策略（06 README「层级策略」）：叶子级（默认）/ 组级。 */
export type PanelMembershipMode = 'leaf' | 'group'

/** 行模式：目录 `mode` 原值，未知路径单列 `unknown`（不猜控件）。 */
export type RowMode = FieldMode | 'unknown'

/** 一行的值来源：未设置 / 显式静态值 / 动画帧。 */
export type RowValueKind = 'unset' | 'static' | 'animated' | 'event'

/** 属性行：属性面板与效果面板共用的唯一来源（06-02 §4.1）。 */
export interface PropertyRow {
  /** 片段键（会话内稳定，不写盘）。 */
  clipKey: string
  /** 对象路径，如 `position.x`。 */
  path: string
  /** 02 目录条目；未知路径为 `undefined`。 */
  def?: FieldEntry
  /** 展示标签：目录 `labelKey` 的末段，缺失时用路径末段。 */
  label: string
  /** `clip.objects` 里显式存在该路径（静态值、等于默认值的值、空帧数组都算）。 */
  present: boolean
  /** 行模式。 */
  mode: RowMode
  /** 值类型（`FieldEntry.type`）；未知路径为 `'unknown'`。 */
  type: string
  /** 插值形态；未知路径按 `none`。 */
  interp: FieldInterp
  /** 显式 `value`；没有该键为 `undefined`（与 `value: null` 区分）。 */
  value?: unknown
  /** 是否存在 `value` 键。 */
  hasValue: boolean
  /** 关键帧（按文档顺序；空数组表示显式空帧）。 */
  keyframes: ObjectKeyframe[]
  /** 是否为未登记路径（只读）。 */
  unknown: boolean
  /** 目录 section（组键首选）。 */
  section?: string
  /** 目录 group（组键次选）。 */
  group?: string
  /** 必填（目录 `required`）。 */
  required: boolean
  /** 目录声明的默认值是否存在。 */
  hasDefault: boolean
  /** 目录默认值（`hasDefault` 为真时有效）。 */
  defaultValue?: unknown
  /** `requires` 未满足时的原因；满足或没有 `requires` 时为 `undefined`。 */
  unavailableReason?: string
  /** 单位（`degree` 等）。 */
  unit?: string
  /** 枚举值（`enum` 专用）。 */
  enumValues?: readonly string[]
  /** 数值范围。 */
  min?: number
  max?: number
  /** 是否可空（`nullable_float`）。 */
  nullable: boolean
  /** 值来源分类（派生字段，不写文档）。 */
  valueKind: RowValueKind
  /** 组键：section → group → `''`（未分组）。 */
  groupKey: string
  /** 组标签。 */
  groupLabel: string
}

/** 效果组：schema 归类 + 组内行 + 统计（06-02 §4.1）。 */
export interface EffectGroup {
  /** 组键（`section` / `group` / `''`）。 */
  key: string
  /** 组标签。 */
  label: string
  /** 声明顺序（首次出现的位置）。 */
  order: number
  /** 组内行（声明顺序）。 */
  rows: PropertyRow[]
  /** 有非空关键帧的行数。 */
  animatedCount: number
  /** 组级策略下的静态伴随行数（无帧但随组进入）。 */
  staticCompanionCount: number
  /** 组内总帧数。 */
  frameCount: number
  /** 轴外帧数（有限片段 `time > duration`；无限片段恒 0）。 */
  outOfRangeCount: number
  /** 是否未知/扩展组。 */
  unknown: boolean
}

/** 分区结果：两个面板各自持有的组。 */
export interface PanelPartition {
  effectGroups: EffectGroup[]
  propertyGroups: EffectGroup[]
}

/** 归属策略（06 README「层级策略」冻结的接口）。 */
export interface PanelMembership {
  mode: PanelMembershipMode
  isRowInEffect(row: PropertyRow): boolean
  isGroupInEffect(group: EffectGroup): boolean
  partition(groups: EffectGroup[]): PanelPartition
}

/** 片段时长上下文（轴外判定与适配用）。 */
export interface ClipSpan {
  clipKey: string
  /** 片段局部时长；无限片段也带一个有限参考值（不可当上界用）。 */
  duration: number
  infinite: boolean
}

/** 局部视口（06-08）：片段局部秒 ↔ 像素的唯一换算来源。 */
export interface EffectViewport {
  /** 内容区左边缘对应的片段局部时间（秒）。 */
  origin: number
  /** 每秒像素。 */
  pxPerSecond: number
  /** 横向滚动位置（像素）。 */
  scrollLeft: number
  /** 纵向滚动位置（像素）。 */
  scrollTop: number
  /** 内容区宽度（像素）。 */
  width: number
  /** 内容区高度（像素）。 */
  height: number
}

/** 视口边界（06-08 §4.3）：缩放有上下限，平移不钳制到片段范围。 */
export interface ViewportLimits {
  minPxPerSecond: number
  maxPxPerSecond: number
}

/** 适配命令（06-08）：四条纯视图操作。 */
export type FitCommand = 'clip' | 'all-nodes' | 'selection' | 'reset'

/** 节点种类（06-04 §4.1）。 */
export type NodeKind = 'value' | 'event-start' | 'event-end' | 'event-instant'

/** 关键帧节点几何。 */
export interface KeyframeNode {
  clipKey: string
  path: string
  time: number
  kind: NodeKind
  /** 横坐标（相对内容区左边缘的像素）。 */
  x: number
  /** 纵向中心（相对内容区顶部的像素）。 */
  y: number
  /** 是否落在片段时长之外（有限片段 `time > duration`）。 */
  outOfRange: boolean
  /** 是否被选中。 */
  selected: boolean
  /** 是否被播放头精确命中。 */
  atPlayhead: boolean
  /** 节点值（事件节点为记录体）。 */
  value: unknown
}

/** 段几何：相邻节点之间的连线。 */
export interface SegmentGeometry {
  clipKey: string
  path: string
  fromTime: number
  toTime: number
  /** 起点像素横坐标。 */
  x1: number
  x2: number
  /** 纵向中心（同一行）。 */
  y: number
  /** 插值形态（来自目录 `interp`）。 */
  interp: FieldInterp
  /** 是否被选中（段选择与节点选择互相独立）。 */
  selected: boolean
}

/** 关键帧选择身份（06-04 §4.1）：片段键 + 路径 + 时间，绝不用数组下标。 */
export interface KeyframeSelection {
  clipKey: string
  path: string
  time: number
}

/** 段选择身份：片段键 + 路径 + 起止时间。 */
export interface SegmentSelection {
  clipKey: string
  path: string
  fromTime: number
  toTime: number
}

/** 提交目标（06-03 §4.1）：静态值 / 已存在节点 / 待新增节点。 */
export type CommitTarget =
  | { kind: 'static'; clipKey: string; path: string }
  | { kind: 'node'; clipKey: string; path: string; time: number }
  | { kind: 'new-node'; clipKey: string; path: string; time: number }

/** 拒绝理由代码（06-03 §4.3）：稳定、可枚举、文案本地化。 */
export type RejectCode =
  | 'type_mismatch'
  | 'out_of_range'
  | 'not_finite'
  | 'int_required'
  | 'enum_invalid'
  | 'ref_empty'
  | 'struct_invalid_json'
  | 'default_missing'
  | 'requires_unmet'
  | 'readonly_unknown'
  | 'row_in_other_panel'
  | 'duplicate_time'
  | 'negative_time'
  | 'not_found'
  | 'event_requires_record'
  | 'mode_not_animatable'

/** 一次提交的结果（UI 只消费这个，不碰文档对象）。 */
export interface CommitAttempt {
  ok: boolean
  /** 失败时的稳定代码。 */
  code?: RejectCode
  /** 失败时的可读文案。 */
  message?: string
}

/** 剪贴板条目（06-05 §4.1）：路径、类型、插值、锚点时间、偏移 + 值；不含片段键。 */
export interface KeyframeClipboard {
  path: string
  type: string
  interp: FieldInterp
  /** 锚点时间（复制时的最早节点时间）。 */
  anchor: number
  points: Array<{ offset: number; value: JsonValue }>
}

/** 段缓动模式（06-06）：线性 / 贝塞尔。 */
export type EasingMode = 'linear' | 'bezier'

/** 归一化把手：横坐标 0..1，纵坐标可超出。 */
export interface EasingHandle {
  x: number
  y: number
}

/** 作者态缓动（06-06 §4.1）：只存内存态，不写盘。 */
export interface AuthoringEasing {
  clipKey: string
  path: string
  fromTime: number
  toTime: number
  mode: EasingMode
  out: EasingHandle
  in: EasingHandle
  /** 修订号：防止陈旧写入。 */
  revision: number
}

/** 段视图（06-06 §4.1）。 */
export interface SegmentView {
  clipKey: string
  path: string
  fromTime: number
  toTime: number
  /** 目录插值形态。 */
  interp: FieldInterp
  /** 作者态缓动（没有为 `undefined`）。 */
  easing?: AuthoringEasing
  /** 是否已烘焙（烘焙后节点密度足够，标记为真）。 */
  baked: boolean
}

/** 烘焙意图（06-06 §4.1）。 */
export interface BakeIntent {
  clipKey: string
  path: string
  fromTime: number
  toTime: number
  /** 采样点（含起止节点，按时间升序）。 */
  points: Array<{ time: number; value: unknown }>
}

/** 诊断目标面板（06-10）：静态与缺失去属性面板，动画与节点去效果面板。 */
export type DiagnosticPanel = 'properties' | 'effects'

/** 一条落到行/节点/组头的诊断（06-10 §4.1）。 */
export interface EffectDiagnostic {
  /** 稳定身份：代码 + 片段 + 路径 + 时间。 */
  id: string
  code: string
  severity: 'block' | 'error' | 'warn' | 'info'
  clipKey: string
  path?: string
  time?: number
  message: string
  source: 'local' | 'server'
  /** 定位目标面板。 */
  panel: DiagnosticPanel
}

/** 按行/节点/组头聚合后的诊断索引（06-10 §4.2）。 */
export interface DiagnosticIndex {
  /** `path` → 该行最高级别的诊断列表（按级别降序）。 */
  byRow: Map<string, EffectDiagnostic[]>
  /** `path@time` → 该节点的诊断。 */
  byNode: Map<string, EffectDiagnostic[]>
  /** `groupKey` → 组内最高级别与计数。 */
  byGroup: Map<string, { severity: EffectDiagnostic['severity']; count: number }>
}

/** 值控件种类（06-03）：九种值类型逐一对应，没有兜底文本框。 */
export type ValueControlKind =
  | 'number'
  | 'integer'
  | 'nullable-number'
  | 'boolean'
  | 'text'
  | 'enum'
  | 'ref'
  | 'struct'
  | 'event'
  | 'readonly'

/** 面板会话状态（06-01 §4.3）：以片段键为键；不进文档、不进推送。 */
export interface EffectPanelSession {
  /** 折叠的组键。 */
  collapsed: Set<string>
  /** 搜索文本。 */
  search: string
  /** 只看轴外。 */
  onlyOutOfRange: boolean
  /** 左右列比例（0..1）。 */
  columnRatio: number
  /** 局部视口。 */
  viewport: EffectViewport
  /** 展开的行（`path`）。 */
  expanded: Set<string>
  /** 选中的节点。 */
  selectedNodes: KeyframeSelection[]
  /** 选中的段。 */
  selectedSegment: SegmentSelection | null
}

