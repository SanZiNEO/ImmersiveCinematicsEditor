/**
 * 11 轮「规则域」字段目录：12 种规则条件类型、9 种规则动作、policy 六字段、
 * 五调度 / 五出口 / 两控制方式的完整字段面与边界。
 *
 * 定位：编辑器侧纯函数层的事实单源。类型键、中文标签、字段类型 / 必填 / 取值域、缺省值、
 * 交叉约束，全部来自主模组 Java 事实；每条目带 {@link SourceRef}（Java 文件相对主模组根 +
 * 1 起行号 + 符号），可逐条回查。本文件不写任何 Vue / UI / 命令层。
 *
 * 溯源优先级：文档与 Java 冲突时以 Java 为准（见 docs/round-11/facts-rules.md）。
 */

import type { JsonValue } from '../../doc/types.ts'
import type { SourceRef } from '../../../features/behavior/shared.ts'

// ── 主模组源码相对路径前缀 ────────────────────────────────────────────────────

const MOD_ROOT = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/'

const RULE_PARSER_FILE = MOD_ROOT + 'script/rule/RuleCollectionParser.java'
const RULE_DEFINITION_FILE = MOD_ROOT + 'script/rule/RuleDefinition.java'
const RULE_BINDING_FILE = MOD_ROOT + 'script/rule/RuleBinding.java'
const RULE_SCHEDULE_FILE = MOD_ROOT + 'script/rule/RuleSchedule.java'
const RULE_RELEASE_KIND_FILE = MOD_ROOT + 'script/rule/RuleReleaseKind.java'
const RULE_CONTROL_FILE = MOD_ROOT + 'script/rule/RuleControl.java'
const EXIT_PARSER_FILE = MOD_ROOT + 'script/rule/ClipExitPolicyParser.java'
const RULE_ACTIONS_FILE = MOD_ROOT + 'camera/rule/RuleActions.java'
const CAMERA_CHANNELS_FILE = MOD_ROOT + 'camera/cover/CameraChannels.java'
const CLIENT_CONDITIONS_FILE = MOD_ROOT + 'client/rule/ClientConditions.java'
const EVALUATORS_FILE = MOD_ROOT + 'trigger/server/evaluator/Evaluators.java'
const ACTION_RUNNER_FILE = MOD_ROOT + 'script/rule/runtime/RuleActionRunner.java'
const COMMAND_TABLE_FILE = MOD_ROOT + 'trigger/server/RuleCommandTable.java'
const CANVAS_TRANSFORM_FILE = MOD_ROOT + 'overlay/CanvasTransform.java'
const CLIP_FILE = MOD_ROOT + 'script/Clip.java'

/** 目录条目统一的 SourceRef 构造助手。 */
function ref(file: string, line: number, symbol: string): SourceRef {
  return { file, line, symbol }
}

// ── 取值域常量（与 Java 同口径）───────────────────────────────────────────────

/** 规则条件类型（代码顺序：8 状态叶子 + 2 事实叶子 + 2 组合器）。 */
export const RULE_CONDITION_TYPES: readonly string[] = [
  'time',
  'location',
  'facing',
  'biome',
  'dimension',
  'camera_pos',
  'camera_facing',
  'camera_fov',
  'clip_fact',
  'rule_fact',
  'all_of',
  'any',
]

/** 八种状态叶子（`ClientConditions.V1_TYPES`）。 */
export const STATE_CONDITION_TYPES: readonly string[] = [
  'time',
  'location',
  'facing',
  'biome',
  'dimension',
  'camera_pos',
  'camera_facing',
  'camera_fov',
]

/** 两种事实叶子（`ClientConditions.FACT_TYPES`）。 */
export const FACT_CONDITION_TYPES: readonly string[] = ['clip_fact', 'rule_fact']

/** 两种组合器。 */
export const COMBINATOR_CONDITION_TYPES: readonly string[] = ['all_of', 'any']

/** 组合器嵌套最大深度（含顶层为第 1 层；`Evaluators.MAX_COMBINATION_DEPTH`）。 */
export const RULE_CONDITION_MAX_DEPTH = 8

/** 规则动作九种（`RuleActions.ACTION_TYPES_V1`）。 */
export const ACTION_TYPES: readonly string[] = [
  'camera_set',
  'overlay_set',
  'adjust_set',
  'goto_clip',
  'pause',
  'resume',
  'exit',
  'play_sound',
  'emit_command',
]

/** 五种调度形态（`RuleReleaseKind.SCRIPT_NAMES`）。 */
export const SCHEDULE_KINDS: readonly string[] = [
  'clip_start',
  'clip_complete',
  'local_time',
  'delay',
  'fact',
]

/** 五种出口类型（`ClipExitPolicyParser.KIND_NAMES`）。 */
export const EXIT_KINDS: readonly string[] = [
  'continue',
  'goto',
  'return',
  'end_execution',
  'end_script',
]

/** 两种控制方式（`RuleControl.SCRIPT_NAMES`）。 */
export const CONTROL_KINDS: readonly string[] = ['observe', 'hold']

/** `clip_fact` 事实名。 */
export const CLIP_FACT_NAMES: readonly string[] = ['started', 'completed']

/** `rule_fact` / fact 调度事实名（`RuleSchedule.FACT_NAMES`）。 */
export const RULE_FACT_NAMES: readonly string[] = ['succeeded', 'action_completed']

/** `camera_set` 六通道（`CameraChannels.NAMES`）。 */
export const CAMERA_CHANNELS: readonly string[] = [
  'position',
  'yaw',
  'pitch',
  'roll',
  'fov',
  'zoom',
]

/** `camera_set` 合成模式（`RuleActions.cameraSet` 解析）。 */
export const CAMERA_MODES: readonly string[] = ['add', 'multiply', 'replace']

/** `adjust_set` 十五个基础校色通道（`RuleActions.ADJUST_CHANNELS_V1`）。 */
export const ADJUST_CHANNELS: readonly string[] = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'hue',
  'saturation',
  'vibrance',
  'lightness',
  'temperature',
  'tint',
  'red',
  'green',
  'blue',
]

/** `overlay_set` 层类型（`RuleActions.OVERLAY_LAYER_TYPES_V1`）。 */
export const OVERLAY_LAYER_TYPES: readonly string[] = ['fade']

/** 策略缺省值（`RuleDefinition` 各 DEFAULT 常量；`on_timeout` 缺省空数组）。 */
export const POLICY_DEFAULTS = {
  once: true,
  cooldown: 0,
  mode: 'enter' as const,
  dwell: 0,
  timeout: -1,
  on_timeout: [] as JsonValue[],
}

// ── 目录类型 ─────────────────────────────────────────────────────────────────

/** 字段 JSON 类型（与既有触发器目录同口径）。 */
export type RuleFieldType =
  | 'string'
  | 'bool'
  | 'int'
  | 'float'
  | 'enum'
  | 'object'
  | 'array'
  | 'map'

/** 单个字段的目录条目。 */
export interface RuleFieldDef {
  key: string
  label: string
  type: RuleFieldType
  required: boolean
  /** 缺省值；`null` 表示运行时无缺省（必填或按求值侧语义）。 */
  default: unknown
  enumValues?: readonly string[]
  description: string
  sourceRef: SourceRef
}

/** 条件分组：状态叶子 / 事实叶子 / 组合器。 */
export type ConditionGroup = 'state' | 'fact' | 'combinator'

/** 一种规则条件类型的完整目录条目。 */
export interface ConditionTypeInfo {
  type: string
  label: string
  group: ConditionGroup
  fields: readonly RuleFieldDef[]
  sourceRef: SourceRef
}

/** 一种规则动作类型的完整目录条目。 */
export interface ActionTypeInfo {
  type: string
  label: string
  /** 无参动作（pause / resume / exit）：除 `type` 外不接受任何键。 */
  noParams: boolean
  fields: readonly RuleFieldDef[]
  sourceRef: SourceRef
}

/** 一种调度形态的目录条目。 */
export interface ScheduleKindInfo {
  kind: string
  label: string
  /** 该形态允许的参数键（含 `on`）。 */
  params: readonly string[]
  sourceRef: SourceRef
}

/** 一种出口类型的目录条目。 */
export interface ExitKindInfo {
  kind: string
  label: string
  /** 是否允许 `target` / `entry_time`（仅 `goto`）。 */
  allowsTarget: boolean
  sourceRef: SourceRef
}

/** 一种控制方式的目录条目。 */
export interface ControlKindInfo {
  kind: string
  label: string
  sourceRef: SourceRef
}

// ── 字段构造助手 ─────────────────────────────────────────────────────────────

function field(
  key: string,
  label: string,
  type: RuleFieldType,
  required: boolean,
  defaultValue: unknown,
  description: string,
  sourceRef: SourceRef,
  enumValues?: readonly string[],
): RuleFieldDef {
  return { key, label, type, required, default: defaultValue, enumValues, description, sourceRef }
}

// ── 条件类型目录 ─────────────────────────────────────────────────────────────

const CONDITIONS_FILE = CLIENT_CONDITIONS_FILE

/** 12 种规则条件类型的字段表，顺序 = {@link RULE_CONDITION_TYPES}。 */
export const RULE_CONDITION_TYPE_INFO: Record<string, ConditionTypeInfo> = {
  time: {
    type: 'time',
    label: '本地时间',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 166, 'evalTime'),
    fields: [
      field('at', '到点时刻', 'float', false, null,
        '片段本地时钟 ≥ 该点即持续成立；与 from/to 互斥（同时写报错）',
        ref(CONDITIONS_FILE, 167, 'evalTime.at')),
      field('from', '区间起点', 'float', false, null,
        '闭区间起点（可单边）；与 at 互斥',
        ref(CONDITIONS_FILE, 168, 'evalTime.from')),
      field('to', '区间终点', 'float', false, null,
        '闭区间终点（可单边）；与 at 互斥',
        ref(CONDITIONS_FILE, 169, 'evalTime.to')),
    ],
  },
  location: {
    type: 'location',
    label: '玩家位置',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 176, 'evalLocation'),
    fields: [
      field('dimension', '维度', 'string', false, null,
        '维度 id 精确相等（不是通配）；可与区域字段共存',
        ref(CONDITIONS_FILE, 177, 'evalLocation.dimension')),
      field('corner1', '方体角点 1', 'object', false, null,
        '方体一角 {x,y,z}；与 corner2 成对出现，两轴归一',
        ref(CONDITIONS_FILE, 181, 'evalLocation.corner1')),
      field('corner2', '方体角点 2', 'object', false, null,
        '方体对角 {x,y,z}；先判方体，再判球形（OR）',
        ref(CONDITIONS_FILE, 181, 'evalLocation.corner2')),
      field('position', '球心', 'object', false, null,
        '球形区域中心 {x,y,z}；与 radius 成对',
        ref(CONDITIONS_FILE, 188, 'evalLocation.position')),
      field('radius', '球半径', 'float', false, 0,
        '球形半径（方块）；缺省 0',
        ref(CONDITIONS_FILE, 190, 'evalLocation.radius')),
    ],
  },
  facing: {
    type: 'facing',
    label: '玩家朝向',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 198, 'evalFacing'),
    fields: [
      field('yaw1', '起点 yaw', 'float', true, null, '区间起点 yaw（度）',
        ref(CONDITIONS_FILE, 199, 'evalFacing.yaw1')),
      field('pitch1', '起点 pitch', 'float', true, null, '区间起点 pitch（度，±90）',
        ref(CONDITIONS_FILE, 199, 'evalFacing.pitch1')),
      field('yaw2', '终点 yaw', 'float', true, null, '区间终点 yaw（度，自然跨 ±180）',
        ref(CONDITIONS_FILE, 199, 'evalFacing.yaw2')),
      field('pitch2', '终点 pitch', 'float', true, null, '区间终点 pitch（度，±90）',
        ref(CONDITIONS_FILE, 199, 'evalFacing.pitch2')),
    ],
  },
  biome: {
    type: 'biome',
    label: '群系',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 209, 'evalBiome'),
    fields: [
      field('biome', '群系 id', 'string', true, null,
        'id 通配（* 全匹配、ns:* 前缀、无冒号子串、其余全等）',
        ref(CONDITIONS_FILE, 210, 'evalBiome.biome')),
    ],
  },
  dimension: {
    type: 'dimension',
    label: '维度',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 217, 'evalDimension'),
    fields: [
      field('dimension', '维度 id', 'string', true, null,
        'id 通配（与 location.dimension 的精确相等不同）',
        ref(CONDITIONS_FILE, 218, 'evalDimension.dimension')),
    ],
  },
  camera_pos: {
    type: 'camera_pos',
    label: '相机位置',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 225, 'evalCameraPos'),
    fields: [
      field('corner1', '方体角点 1', 'object', false, null,
        '方体一角 {x,y,z}；与 corner2 成对',
        ref(CONDITIONS_FILE, 227, 'evalCameraPos.corner1')),
      field('corner2', '方体角点 2', 'object', false, null,
        '方体对角 {x,y,z}；方体优先，球形被忽略（与 location 的 OR 语义相反）',
        ref(CONDITIONS_FILE, 227, 'evalCameraPos.corner2')),
      field('position', '球心', 'object', false, null,
        '球形区域中心 {x,y,z}；方体合法时本字段被忽略',
        ref(CONDITIONS_FILE, 232, 'evalCameraPos.position')),
      field('radius', '球半径', 'float', false, 0, '球形半径（方块）；缺省 0',
        ref(CONDITIONS_FILE, 234, 'evalCameraPos.radius')),
    ],
  },
  camera_facing: {
    type: 'camera_facing',
    label: '相机朝向',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 128, 'evalChild.camera_facing'),
    fields: [
      field('yaw1', '起点 yaw', 'float', true, null, '区间起点 yaw（度）',
        ref(CONDITIONS_FILE, 128, 'evalCameraFacing.yaw1')),
      field('pitch1', '起点 pitch', 'float', true, null, '区间起点 pitch（度，±90）',
        ref(CONDITIONS_FILE, 128, 'evalCameraFacing.pitch1')),
      field('yaw2', '终点 yaw', 'float', true, null, '区间终点 yaw（度）',
        ref(CONDITIONS_FILE, 128, 'evalCameraFacing.yaw2')),
      field('pitch2', '终点 pitch', 'float', true, null, '区间终点 pitch（度，±90）',
        ref(CONDITIONS_FILE, 128, 'evalCameraFacing.pitch2')),
    ],
  },
  camera_fov: {
    type: 'camera_fov',
    label: '相机 FOV',
    group: 'state',
    sourceRef: ref(CONDITIONS_FILE, 242, 'evalCameraFov'),
    fields: [
      field('from', 'FOV 下限', 'float', false, null, '闭区间下限（度，可单边）',
        ref(CONDITIONS_FILE, 244, 'evalCameraFov.from')),
      field('to', 'FOV 上限', 'float', false, null, '闭区间上限（度，可单边）',
        ref(CONDITIONS_FILE, 245, 'evalCameraFov.to')),
    ],
  },
  clip_fact: {
    type: 'clip_fact',
    label: '片段事实',
    group: 'fact',
    sourceRef: ref(CONDITIONS_FILE, 140, 'evalClipFact'),
    fields: [
      field('clip', '片段 id', 'string', true, null,
        '当前脚本内片段 id；作用域 = 该片段最近一次执行',
        ref(CONDITIONS_FILE, 141, 'evalClipFact.clip')),
      field('fact', '事实名', 'enum', true, null, 'started / completed',
        ref(CONDITIONS_FILE, 142, 'evalClipFact.fact'), CLIP_FACT_NAMES),
    ],
  },
  rule_fact: {
    type: 'rule_fact',
    label: '规则事实',
    group: 'fact',
    sourceRef: ref(CONDITIONS_FILE, 153, 'evalRuleFact'),
    fields: [
      field('binding', '绑定 id', 'string', true, null,
        '当前脚本内绑定 id；succeeded = 条件成立，action_completed = 动作批次已提交',
        ref(CONDITIONS_FILE, 154, 'evalRuleFact.binding')),
      field('fact', '事实名', 'enum', true, null, 'succeeded / action_completed',
        ref(CONDITIONS_FILE, 155, 'evalRuleFact.fact'), RULE_FACT_NAMES),
    ],
  },
  all_of: {
    type: 'all_of',
    label: '全部满足',
    group: 'combinator',
    sourceRef: ref(EVALUATORS_FILE, 545, 'MAX_COMBINATION_DEPTH'),
    fields: [
      field('list', '子条件列表', 'array', true, null,
        '非空对象数组；子项形态 { type, conditions }；嵌套最大 8 层',
        ref(EVALUATORS_FILE, 598, 'evaluateCombination.list')),
    ],
  },
  any: {
    type: 'any',
    label: '任一满足',
    group: 'combinator',
    sourceRef: ref(EVALUATORS_FILE, 545, 'MAX_COMBINATION_DEPTH'),
    fields: [
      field('list', '子条件列表', 'array', true, null,
        '非空对象数组；子项形态 { type, conditions }；嵌套最大 8 层',
        ref(EVALUATORS_FILE, 598, 'evaluateCombination.list')),
    ],
  },
}

// ── 动作目录 ─────────────────────────────────────────────────────────────────

const ACTIONS_FILE = RULE_ACTIONS_FILE

/** 九种规则动作的字段表，顺序 = {@link ACTION_TYPES}。 */
export const RULE_ACTION_INFO: Record<string, ActionTypeInfo> = {
  camera_set: {
    type: 'camera_set',
    label: '叠加相机修改',
    noParams: false,
    sourceRef: ref(ACTIONS_FILE, 117, 'cameraSet'),
    fields: [
      field('channels', '生效通道', 'array', true, null,
        '非空、不重复的六通道名子集；选中通道必须给值',
        ref(ACTIONS_FILE, 144, 'cameraChannels'), CAMERA_CHANNELS),
      field('mode', '合成模式', 'enum', false, null,
        'add / multiply / replace；缺省逐通道：position/yaw/pitch/roll 加法，fov/zoom 乘法；replace 必须显式写',
        ref(ACTIONS_FILE, 120, 'cameraSet.mode'), CAMERA_MODES),
      field('priority', '优先级', 'int', false, 0,
        '整数，升序应用，缺省 0',
        ref(ACTIONS_FILE, 135, 'cameraSet.priority')),
      field('position', '位置值', 'object', false, null,
        'position 通道值 {x,y,z}（世界坐标，三轴一起写）',
        ref(ACTIONS_FILE, 175, 'readCameraValues.position')),
      field('yaw', 'yaw 值', 'float', false, null, 'yaw 通道值（度）',
        ref(ACTIONS_FILE, 202, 'readCameraValues.yaw')),
      field('pitch', 'pitch 值', 'float', false, null, 'pitch 通道值（度）',
        ref(ACTIONS_FILE, 203, 'readCameraValues.pitch')),
      field('roll', 'roll 值', 'float', false, null, 'roll 通道值（度）',
        ref(ACTIONS_FILE, 204, 'readCameraValues.roll')),
      field('fov', 'fov 值', 'float', false, null, 'fov 通道值（度）',
        ref(ACTIONS_FILE, 205, 'readCameraValues.fov')),
      field('zoom', 'zoom 值', 'float', false, null, 'zoom 通道值（倍率）',
        ref(ACTIONS_FILE, 206, 'readCameraValues.zoom')),
    ],
  },
  overlay_set: {
    type: 'overlay_set',
    label: '临时覆盖层',
    noParams: false,
    sourceRef: ref(ACTIONS_FILE, 225, 'overlaySet'),
    fields: [
      field('layer_type', '层类型', 'enum', true, null, '当前仅 fade',
        ref(ACTIONS_FILE, 226, 'overlaySet.layer_type'), OVERLAY_LAYER_TYPES),
      field('color', '颜色', 'string', false, '#000000',
        '六位十六进制（# 可省）；缺省黑',
        ref(ACTIONS_FILE, 235, 'overlaySet.color')),
      field('opacity', '不透明度', 'float', false, 1, '0 ~ 1；缺省 1（全遮）',
        ref(ACTIONS_FILE, 236, 'overlaySet.opacity')),
      field('z_index', '层级', 'int', false, 10,
        '整数，越小越先绘制；只在该覆盖层管线内排序',
        ref(ACTIONS_FILE, 237, 'overlaySet.z_index')),
    ],
  },
  adjust_set: {
    type: 'adjust_set',
    label: '临时调色层',
    noParams: false,
    sourceRef: ref(ACTIONS_FILE, 244, 'adjustSet'),
    fields: ADJUST_CHANNELS.map((channel) =>
      field(channel, channel, 'float', false, null,
        '校色通道值（有限数字）；未写 = 不改变画面，不是 0；至少一个通道',
        ref(ACTIONS_FILE, 260, 'adjustSet.channels')),
    ),
  },
  goto_clip: {
    type: 'goto_clip',
    label: '跳转片段（开分支）',
    noParams: false,
    sourceRef: ref(ACTION_RUNNER_FILE, 109, 'launchBranch'),
    fields: [
      field('clip', '目标片段 id', 'string', true, null,
        '脚本内已存在片段；新形态用片段 id 寻址，拒绝旧 track/at 字段',
        ref(ACTION_RUNNER_FILE, 114, 'launchBranch.clip')),
      field('entry_time', '入口局部时间', 'float', false, 0,
        '目标片段执行局部秒，≥ 0；缺省 0',
        ref(ACTION_RUNNER_FILE, 134, 'launchBranch.entry_time')),
    ],
  },
  pause: {
    type: 'pause',
    label: '暂停实例',
    noParams: true,
    sourceRef: ref(ACTION_RUNNER_FILE, 77, 'run.pause'),
    fields: [],
  },
  resume: {
    type: 'resume',
    label: '恢复实例',
    noParams: true,
    sourceRef: ref(ACTION_RUNNER_FILE, 78, 'run.resume'),
    fields: [],
  },
  exit: {
    type: 'exit',
    label: '结束当前播放实例（渐出）',
    noParams: true,
    sourceRef: ref(ACTIONS_FILE, 92, 'executeShared.exit'),
    fields: [],
  },
  play_sound: {
    type: 'play_sound',
    label: '播放音效',
    noParams: false,
    sourceRef: ref(ACTIONS_FILE, 305, 'playSound'),
    fields: [
      field('sound', '音效 id', 'string', true, null,
        '音效 id（如 minecraft:ambient.cave）；未知 id 运行期跳过',
        ref(ACTIONS_FILE, 306, 'playSound.sound')),
      field('volume', '音量', 'float', false, 1, '有限数字；缺省 1',
        ref(ACTIONS_FILE, 319, 'playSound.volume')),
      field('pitch', '音高', 'float', false, 1, '有限数字；缺省 1',
        ref(ACTIONS_FILE, 320, 'playSound.pitch')),
    ],
  },
  emit_command: {
    type: 'emit_command',
    label: '执行命令',
    noParams: false,
    sourceRef: ref(ACTIONS_FILE, 330, 'emitCommandForBinding'),
    fields: [
      field('command', '命令原文', 'string', true, null,
        '非空字符串；多条用 && 分隔，整串原样交服务端；客户端只发动作引用（绑定 id + 动作下标）',
        ref(ACTIONS_FILE, 332, 'emitCommandForBinding.command')),
    ],
  },
}

// ── 策略 / 调度 / 出口 / 控制目录 ──────────────────────────────────────────────

/** policy 六字段目录（`RuleDefinition` 缺省常量 + `ScriptValidator.checkRulePolicy`）。 */
export const POLICY_FIELDS: readonly RuleFieldDef[] = [
  field('once', '单次', 'bool', false, POLICY_DEFAULTS.once,
    'true = 每次片段执行内成功后不再触发；不是脚本永久一次',
    ref(RULE_DEFINITION_FILE, 24, 'DEFAULT_ONCE')),
  field('cooldown', '冷却秒数', 'float', false, POLICY_DEFAULTS.cooldown,
    '成功后静默时长（播放时钟，跨执行保留；挂起时冻结）；≥ 0，0 = 不静默',
    ref(RULE_DEFINITION_FILE, 27, 'DEFAULT_COOLDOWN')),
  field('mode', '触发方式', 'enum', false, POLICY_DEFAULTS.mode,
    'enter = 上升沿；dwell = 连续成立达到驻留秒数',
    ref(RULE_DEFINITION_FILE, 36, 'MODES'), ['enter', 'dwell']),
  field('dwell', '驻留秒数', 'float', false, POLICY_DEFAULTS.dwell,
    '≥ 0；dwell=0 仍是驻留模式（实际等同立即），不自动改写为 enter',
    ref(RULE_DEFINITION_FILE, 39, 'DEFAULT_DWELL')),
  field('timeout', '等待上限秒数', 'float', false, POLICY_DEFAULTS.timeout,
    '> 0 = 门首次满足后真实秒数；-1 = 无限等待；0 非法',
    ref(RULE_DEFINITION_FILE, 42, 'TIMEOUT_NONE')),
  field('on_timeout', '超时动作', 'array', false, [],
    '动作数组，可空；无超时（timeout=-1）时禁用新增，已有内容只读保留',
    ref(RULE_PARSER_FILE, 44, 'POLICY_KEYS.on_timeout')),
]

/** 五种调度形态目录（`RuleReleaseKind.SCRIPT_NAMES` + `RuleSchedule.parameterNames`）。 */
export const SCHEDULE_KIND_INFO: Record<string, ScheduleKindInfo> = {
  clip_start: {
    kind: 'clip_start',
    label: '片段开始',
    params: ['on', 'clip'],
    sourceRef: ref(RULE_RELEASE_KIND_FILE, 11, 'CLIP_START'),
  },
  clip_complete: {
    kind: 'clip_complete',
    label: '片段完成',
    params: ['on', 'clip'],
    sourceRef: ref(RULE_RELEASE_KIND_FILE, 14, 'CLIP_COMPLETE'),
  },
  local_time: {
    kind: 'local_time',
    label: '局部时间',
    params: ['on', 'clip', 'at'],
    sourceRef: ref(RULE_RELEASE_KIND_FILE, 17, 'LOCAL_TIME'),
  },
  delay: {
    kind: 'delay',
    label: '真实延迟',
    params: ['on', 'seconds'],
    sourceRef: ref(RULE_RELEASE_KIND_FILE, 20, 'DELAY'),
  },
  fact: {
    kind: 'fact',
    label: '等待绑定事实',
    params: ['on', 'binding', 'fact'],
    sourceRef: ref(RULE_RELEASE_KIND_FILE, 23, 'FACT'),
  },
}

/** 五种出口类型目录（`ClipExitPolicyParser.KIND_NAMES`）。 */
export const EXIT_KIND_INFO: Record<string, ExitKindInfo> = {
  continue: {
    kind: 'continue',
    label: '回主线',
    allowsTarget: false,
    sourceRef: ref(EXIT_PARSER_FILE, 77, 'kindOf.continue'),
  },
  goto: {
    kind: 'goto',
    label: '转到目标片段',
    allowsTarget: true,
    sourceRef: ref(EXIT_PARSER_FILE, 78, 'kindOf.goto'),
  },
  return: {
    kind: 'return',
    label: '回主线（return）',
    allowsTarget: false,
    sourceRef: ref(EXIT_PARSER_FILE, 79, 'kindOf.return'),
  },
  end_execution: {
    kind: 'end_execution',
    label: '结束当前执行',
    allowsTarget: false,
    sourceRef: ref(EXIT_PARSER_FILE, 80, 'kindOf.end_execution'),
  },
  end_script: {
    kind: 'end_script',
    label: '结束整个脚本',
    allowsTarget: false,
    sourceRef: ref(EXIT_PARSER_FILE, 81, 'kindOf.end_script'),
  },
}

/** 两种控制方式目录（`RuleControl.SCRIPT_NAMES`）。 */
export const CONTROL_KIND_INFO: Record<string, ControlKindInfo> = {
  observe: {
    kind: 'observe',
    label: '观察（非阻塞）',
    sourceRef: ref(RULE_CONTROL_FILE, 16, 'OBSERVE'),
  },
  hold: {
    kind: 'hold',
    label: '持有（门后未成立挂起）',
    sourceRef: ref(RULE_CONTROL_FILE, 19, 'HOLD'),
  },
}

// ── 校验引用上下文 ─────────────────────────────────────────────────────────────

/**
 * 片段静态时间线事实（调用方从文档 `timeline.tracks[].clips[]` 收集；纯静态，不读运行时）。
 * 字段口径与 `ClipShape` / 主模组 `Clip` 对齐：`duration` 负数 = 无限时长片段；
 * `loop=true` 且 `loopCount=-1` = 无限执行循环。
 */
export interface ClipTimelineInfo {
  id: string
  /** 全局声明顺序（轨道内按 `start_time` 排序后的次序，越小越早）；未知顺序用 -1。 */
  order: number
  /** 脚本内起点（秒）；独立片段无 `start_time` → `undefined`。 */
  startTime?: number
  /** 时长（秒）；负数 = 无限时长片段（`Clip.isInfinite`）。 */
  duration: number
  /** 执行循环（`loop`）。 */
  loop: boolean
  /** 循环次数；-1 = 无限循环（`loop_count`）。 */
  loopCount: number
}

/**
 * 校验引用上下文：调用方从文档收集的已存在对象 id、片段时长与时间线事实。
 * `clipDurations` 负数 = 无限片段；缺时长的片段不入表。
 * `clips` 缺省 `undefined` = 调用方未提供时间线事实，可达性诊断降级为「缺数据」提示，不静默放过。
 */
export interface BehaviorRefs {
  clipIds: ReadonlySet<string>
  clipDurations: ReadonlyMap<string, number>
  ruleIds: ReadonlySet<string>
  bindingIds: ReadonlySet<string>
  /** 片段时间线事实表（顺序 / 起点 / 时长 / 循环）；可达性判定用。 */
  clips?: ReadonlyMap<string, ClipTimelineInfo>
}

// ── 片段可达性静态判定（与主模组 `Clip` 窗口口径对齐）────────────────────────────

/** 片段是否有效无限：时长为负，或 `loop=true` 且 `loop_count=-1`（`Clip.isEffectivelyInfinite`）。 */
export function clipEffectivelyInfinite(info: ClipTimelineInfo): boolean {
  return info.duration < 0 || (info.loop && info.loopCount < 0)
}

/**
 * 有限窗口末端（不含）；有效无限返回 `undefined`（`Clip.getWindowEnd`）。
 * 有限 = `startTime + duration × (loop ? max(1, loopCount) : 1)`。
 */
export function clipWindowEnd(info: ClipTimelineInfo): number | undefined {
  if (clipEffectivelyInfinite(info)) return undefined
  const repetitions = info.loop ? Math.max(1, info.loopCount) : 1
  return (info.startTime ?? 0) + info.duration * repetitions
}

/** 静态可达性结论。 */
export type ClipReachability =
  /** 顺序 / 窗口上看得到目标（保守判可达）。 */
  | 'reachable'
  /** 顺序 / 窗口上目标不会在宿主片段的活跃窗口内执行。 */
  | 'unreachable'
  /** 缺少宿主上下文 / 时间线表 / 独立片段无起点等，证据不足，不下结论。 */
  | 'unknown'
  /** 目标有效无限：不判可达也不判不可达（无依据）。 */
  | 'infinite-target'

/** 可达性判定结果；`reason` 仅 `unreachable` / `unknown` 时给出人话原因。 */
export interface ClipReachabilityResult {
  status: ClipReachability
  reason?: string
}

/**
 * 静态判定 `toClipId` 是否在 `fromClipId`（宿主片段）的可达窗口内。
 *
 * 口径（保守，不做分支图推断）：
 * - 目标有效无限 → `infinite-target`，不下不可达结论；
 * - 宿主有效无限 → 宿主不结束，保守判 `reachable`；
 * - 两侧都有起点：目标起点晚于宿主窗口末端，或目标窗口末端不晚于宿主起点 → `unreachable`；
 * - 独立片段无起点 / 事实不全 → `unknown`。
 */
export function classifyClipReachability(
  refs: BehaviorRefs,
  fromClipId: string | undefined,
  toClipId: string,
): ClipReachabilityResult {
  if (fromClipId === undefined || fromClipId.length === 0) {
    return { status: 'unknown', reason: '缺少宿主片段上下文，无法判定可达性' }
  }
  if (fromClipId === toClipId) return { status: 'reachable' }

  const table = refs.clips
  if (!table) return { status: 'unknown', reason: '缺少时间线事实（片段顺序 / 起点 / 时长 / 循环），无法判定可达性' }

  const from = table.get(fromClipId)
  const to = table.get(toClipId)
  if (!from || !to) return { status: 'unknown', reason: '时间线事实不全，无法判定可达性' }

  if (clipEffectivelyInfinite(to)) return { status: 'infinite-target' }
  if (clipEffectivelyInfinite(from)) return { status: 'reachable' }
  if (from.startTime === undefined || to.startTime === undefined) {
    return { status: 'unknown', reason: '独立片段无起点，无法按顺序判定可达性' }
  }

  const fromEnd = clipWindowEnd(from)
  const toEnd = clipWindowEnd(to)
  if (fromEnd !== undefined && to.startTime > fromEnd) {
    return { status: 'unreachable', reason: `目标片段 ${toClipId} 在宿主片段 ${fromClipId} 结束之后才开始` }
  }
  if (toEnd !== undefined && toEnd <= from.startTime) {
    return { status: 'unreachable', reason: `目标片段 ${toClipId} 在宿主片段 ${fromClipId} 开始之前已结束` }
  }
  return { status: 'reachable' }
}

// ── 目录查询助手 ──────────────────────────────────────────────────────────────

/** 按类型取条件目录条目；未知类型返回 `undefined`。 */
export function conditionTypeInfo(type: string): ConditionTypeInfo | undefined {
  return RULE_CONDITION_TYPE_INFO[type]
}

/** 按类型取动作目录条目；未知类型返回 `undefined`。 */
export function actionTypeInfo(type: string): ActionTypeInfo | undefined {
  return RULE_ACTION_INFO[type]
}
