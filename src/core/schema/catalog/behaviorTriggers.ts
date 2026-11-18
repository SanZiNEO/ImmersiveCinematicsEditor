/**
 * 11 轮「触发器域」字段目录：27 种触发器类型的完整字段面与边界。
 *
 * 定位：编辑器侧纯函数层的事实单源。类型键、中文标签、监听分类、字段类型 / 必填 / 取值域、
 * 组合器形态、区域形态、时序字段适用范围、三种内置前置，全部来自主模组 Java 事实；
 * 每条目带 {@link SourceRef}（Java 文件相对主模组根 + 1 起行号），可逐条回查。
 *
 * 分类口径（`role`）：
 * - `event`：Java 注册为 `EVENT_DRIVEN`（事件事实驱动，不参与轮询）；
 * - `poll`：Java 注册为 `POLLING` 的叶子类型（按类型 / 脚本 / 触发器三级间隔轮询）；
 * - `mixed`：组合器 `all_of` / `any`——Java 策略是 `POLLING`，但其子项可挂事件类条件
 *   （仅当 `continuity.window > 0`），是轮询与事件两类子条件的桥接节点。
 *
 * 本文件不写任何 Vue / UI / 命令层；未知类型由调用方按「未知键保留、原文只读」口径处理。
 */

/**
 * 主模组出处（与 `features/behavior/shared.ts` 的 `SourceRef` 同构；核心层不反向依赖 features）。
 * `file` 相对主模组仓库根；`line` 是 1 起的行号。
 */
export interface SourceRef {
  file: string
  line: number
  /** 该处的 Java 符号名（类 / 方法 / 常量），便于二次核对。 */
  symbol?: string
}

// ── 取值域常量（与 Java 同口径）─────────────────────────────────────────────

/** 轮询间隔下限（tick）。 */
export const TRIGGER_POLL_INTERVAL_MIN = 1
/** 轮询间隔上限（tick）。 */
export const TRIGGER_POLL_INTERVAL_MAX = 600
/** continuity.dwell / continuity.window 合法上限（tick）。 */
export const CONTINUITY_MAX_TICKS = 1200

/** 主模组源码相对根目录前缀。 */
const MOD_ROOT = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/'
const SCHEMA_FILE = MOD_ROOT + 'script/schema/TriggerSchemas.java'
const REGISTER_FILE = MOD_ROOT + 'ImmersiveCinematics.java'

// ── 目录类型 ─────────────────────────────────────────────────────────────────

/** 监听分类：事件驱动 / 轮询 / 混合（组合器）。 */
export type TriggerRole = 'event' | 'poll' | 'mixed'

/** 条件字段的 JSON 类型（与 `TriggerSchemas.FieldDef.type` 同口径）。 */
export type TriggerFieldType =
  | 'string'
  | 'bool'
  | 'map'
  | 'array'
  | 'int'
  | 'float'
  | 'enum'

/** 区域形态：无区域 / 球形（position+radius）/ 方体（corner1+corner2）/ 两者共存。 */
export type TriggerRegionForm = 'none' | 'sphere' | 'box' | 'sphere_or_box'

/** 单个条件字段的目录条目。 */
export interface TriggerFieldDef {
  key: string
  label: string
  type: TriggerFieldType
  required: boolean
  /** enum 取值域；空串 `""` 表示「显式不限制」。 */
  enumValues?: readonly string[]
  description: string
  sourceRef: SourceRef
}

/** 时序字段对该类型是否有语义（写了但不生效 = 编辑器应就地提示，不静默夹取）。 */
export interface TriggerTimingSupport {
  /** `on_enter`：进入边沿触发（轮询叶子类型有进入 / 离开状态机；事件驱动无此语义）。 */
  onEnter: boolean
  /** `exit_buffer`：区域外扩用于离开判定（仅带可外扩空间区域的类型）。 */
  exitBuffer: boolean
  /** `poll_interval`：仅轮询类类型有效。 */
  pollInterval: boolean
  /** `continuity.sweep`：段扫掠几何语义（仅 location / structure / facing / observation）。 */
  sweep: boolean
  /** `continuity.dwell`：停留门槛（仅轮询类类型；事件驱动不参与轮询）。 */
  dwell: boolean
  /** `continuity.window`：事件类子条件时间窗口（仅组合器 all_of / any）。 */
  window: boolean
}

/** 一种触发器类型的完整目录条目。 */
export interface TriggerTypeInfo {
  type: string
  label: string
  role: TriggerRole
  /** 类型级默认轮询间隔（tick）；事件驱动类型为 `null`（不参与轮询）。 */
  defaultPollInterval: number | null
  fields: readonly TriggerFieldDef[]
  /** 是否为组合器（all_of / any，子项写在 `conditions.list`）。 */
  combinator: boolean
  region: TriggerRegionForm
  timing: TriggerTimingSupport
  sourceRef: SourceRef
}

// ── 字段构造助手 ─────────────────────────────────────────────────────────────

function schemaField(
  key: string,
  label: string,
  type: TriggerFieldType,
  required: boolean,
  line: number,
  description: string,
  enumValues?: readonly string[],
): TriggerFieldDef {
  return {
    key,
    label,
    type,
    required,
    enumValues,
    description,
    sourceRef: { file: SCHEMA_FILE, line, symbol: 'FieldDef' },
  }
}

/** 求值器 / 事实匹配层承认、但 `TriggerSchemas` 未登记的字段（校验器对未登记字段保持静默）。 */
function evaluatorField(
  key: string,
  label: string,
  type: TriggerFieldType,
  required: boolean,
  sourceRef: SourceRef,
  description: string,
  enumValues?: readonly string[],
): TriggerFieldDef {
  return { key, label, type, required, enumValues, description, sourceRef }
}

const INTERACT_MATCH_REF: SourceRef = {
  file: MOD_ROOT + 'trigger/server/fact/EventFactMatch.java',
  line: 88,
  symbol: 'matchesInteract',
}

// ── 时序模板 ────────────────────────────────────────────────────────────────

const EVENT_TIMING: TriggerTimingSupport = {
  onEnter: false,
  exitBuffer: false,
  pollInterval: false,
  sweep: false,
  dwell: false,
  window: false,
}

const POLL_TIMING: TriggerTimingSupport = {
  onEnter: true,
  exitBuffer: false,
  pollInterval: true,
  sweep: false,
  dwell: true,
  window: false,
}

// ── 27 种类型目录（顺序 = Java `registerTriggerTypes()` 声明顺序）──────────────

/**
 * 全部触发器类型目录。顺序与主模组 `ImmersiveCinematics.registerTriggerTypes()`
 * 的 `TriggerRegistry.register(...)` 调用顺序一致（11-02 §3：身份随声明顺序稳定）。
 */
export const TRIGGER_TYPES: readonly TriggerTypeInfo[] = [
  {
    type: 'location',
    label: '位置',
    role: 'poll',
    defaultPollInterval: 20,
    region: 'sphere_or_box',
    combinator: false,
    timing: { ...POLL_TIMING, exitBuffer: true, sweep: true },
    sourceRef: { file: REGISTER_FILE, line: 24, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('dimension', '维度', 'string', false, 102, '维度 id 通配（* / ns:* / 无冒号子串 / 全等）；缺省不限制。'),
      schemaField('position', '球形中心', 'map', false, 103, '球形区域中心 { x, y, z }；与方体共存时为 OR。'),
      schemaField('radius', '球形半径', 'float', false, 104, '球形半径（格）；缺省 0。'),
      schemaField('corner1', '方体角点 1', 'map', false, 105, '方体一角 { x, y, z }；与 corner2 先 min/max 归一，顺序无关。'),
      schemaField('corner2', '方体角点 2', 'map', false, 106, '方体对角 { x, y, z }；任一三分量缺失 = 条件永不满足。'),
    ],
  },
  {
    type: 'advancement',
    label: '进度',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 26, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('advancement', '进度 id', 'string', true, 112, '已完成的进度 id（通配规则同物品 / 维度）。'),
    ],
  },
  {
    type: 'biome',
    label: '生物群系',
    role: 'poll',
    defaultPollInterval: 40,
    region: 'none',
    combinator: false,
    timing: POLL_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 27, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('biome', '群系 id', 'string', true, 118, '当前所在群系 id 通配匹配。'),
    ],
  },
  {
    type: 'entity_kill',
    label: '击杀实体',
    role: 'event',
    defaultPollInterval: null,
    region: 'sphere_or_box',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 28, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('entity', '实体 id', 'string', true, 124, '被击杀实体 id 通配匹配。'),
      schemaField('dimension', '维度', 'string', false, 125, '击杀发生时所在维度（事件时刻快照判定）。'),
      schemaField('biome', '群系', 'string', false, 126, '击杀发生时所在群系（事件时刻快照判定）。'),
      schemaField('position', '球形中心', 'map', false, 127, '击杀位置球形中心 { x, y, z }。'),
      schemaField('radius', '球形半径', 'float', false, 128, '球形半径（格）；缺省 0。'),
      schemaField('corner1', '方体角点 1', 'map', false, 129, '击杀位置方体一角 { x, y, z }。'),
      schemaField('corner2', '方体角点 2', 'map', false, 130, '击杀位置方体对角 { x, y, z }。'),
    ],
  },
  {
    type: 'entity_interact',
    label: '交互实体',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 29, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('target', '目标实体', 'string', true, 148, '被交互实体 id 通配匹配。'),
      evaluatorField('item', '手持物品', 'string', false, INTERACT_MATCH_REF, '交互时手持物品 id 通配匹配；可选（事件事实匹配层承认，schema 未登记）。'),
      evaluatorField('target_type', '目标类型', 'enum', false, INTERACT_MATCH_REF, '固定为 entity；写了 block 则不匹配。', ['', 'block', 'entity']),
    ],
  },
  {
    type: 'dimension_change',
    label: '维度切换',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 30, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('dimension', '目标维度', 'string', true, 168, '切换后的目标维度 id（按当前维度判定）。'),
      schemaField('from_dimension', '来源维度', 'string', false, 169, '切换前来源维度 id；缺省不限制。'),
    ],
  },
  {
    type: 'login',
    label: '登录',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 31, symbol: 'registerTriggerTypes' },
    fields: [],
  },
  {
    type: 'inventory',
    label: '背包物品',
    role: 'poll',
    defaultPollInterval: 20,
    region: 'none',
    combinator: false,
    timing: POLL_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 32, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('items', '物品 id 列表', 'array', true, 244, '物品 id 通配数组；非空。'),
      schemaField('change', '数量变化模式', 'enum', false, 245, '空 = 同时拥有全部；increase / decrease = 任一模式数量发生变化。', ['', 'increase', 'decrease']),
    ],
  },
  {
    type: 'item_craft',
    label: '合成物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 33, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 175, '合成出的物品 id 通配匹配。')],
  },
  {
    type: 'structure',
    label: '结构',
    role: 'poll',
    defaultPollInterval: 20,
    region: 'none',
    combinator: false,
    timing: { ...POLL_TIMING, sweep: true },
    sourceRef: { file: REGISTER_FILE, line: 34, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('structure', '结构 id', 'string', true, 251, '附近结构的结构 id（只写结构 id，不写位置）。'),
      schemaField('radius', '搜索半径', 'int', false, 252, '结构搜索半径（格）；缺省 0。'),
    ],
  },
  {
    type: 'gamestage',
    label: '游戏阶段',
    role: 'poll',
    defaultPollInterval: 20,
    region: 'none',
    combinator: false,
    timing: POLL_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 36, symbol: 'registerTriggerTypes' },
    fields: [schemaField('stage', '阶段名', 'string', true, 258, '玩家持有的游戏阶段名。')],
  },
  {
    type: 'item_use',
    label: '使用物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 37, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 181, '使用的物品 id 通配匹配。')],
  },
  {
    type: 'item_consume',
    label: '消耗物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 38, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 187, '被消耗物品 id 通配匹配。')],
  },
  {
    type: 'item_release',
    label: '释放物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 39, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 193, '释放（松开使用键）的物品 id 通配匹配。')],
  },
  {
    type: 'item_instant_use',
    label: '即时使用物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 40, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 199, '即时使用（无持续动作）的物品 id 通配匹配。')],
  },
  {
    type: 'item_use_interrupt',
    label: '中断使用物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 41, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 205, '使用被中断（受伤 / 切换物品等）时的物品 id 通配匹配。')],
  },
  {
    type: 'block_interact',
    label: '交互方块',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 42, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('target', '目标方块', 'string', true, 154, '被交互方块 id 通配匹配。'),
      evaluatorField('item', '手持物品', 'string', false, INTERACT_MATCH_REF, '交互时手持物品 id 通配匹配；可选（事件事实匹配层承认，schema 未登记）。'),
      evaluatorField('target_type', '目标类型', 'enum', false, INTERACT_MATCH_REF, '固定为 block；写了 entity 则不匹配。', ['', 'block', 'entity']),
    ],
  },
  {
    type: 'item_on_interact',
    label: '手持物品交互',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 43, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('item', '手持物品', 'string', true, 160, '交互时手持物品 id 通配匹配。'),
      schemaField('target', '交互目标', 'string', true, 161, '被交互方块 / 实体 id 通配匹配。'),
      schemaField('target_type', '目标类型', 'enum', false, 162, '空 = 方块和实体都查；block / entity 限定一侧。', ['', 'block', 'entity']),
    ],
  },
  {
    type: 'xp',
    label: '经验等级',
    role: 'poll',
    defaultPollInterval: 20,
    region: 'none',
    combinator: false,
    timing: POLL_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 44, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('level', '等级', 'int', false, 223, '经验等级；与 total 至少填一项。'),
      schemaField('total', '总经验', 'int', false, 224, '总经验点数；与 level 至少填一项。'),
    ],
  },
  {
    type: 'dimension',
    label: '所在维度',
    role: 'poll',
    defaultPollInterval: 20,
    region: 'none',
    combinator: false,
    timing: POLL_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 46, symbol: 'registerTriggerTypes' },
    fields: [schemaField('dimension', '维度 id', 'string', true, 230, '当前所在维度 id 通配匹配。')],
  },
  {
    type: 'item_pickup',
    label: '拾取物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 47, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 211, '拾取的物品 id 通配匹配。')],
  },
  {
    type: 'item_drop',
    label: '丢弃物品',
    role: 'event',
    defaultPollInterval: null,
    region: 'none',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 48, symbol: 'registerTriggerTypes' },
    fields: [schemaField('item', '物品 id', 'string', true, 217, '丢弃的物品 id 通配匹配。')],
  },
  {
    type: 'observation',
    label: '注视目标',
    role: 'poll',
    defaultPollInterval: 5,
    region: 'none',
    combinator: false,
    timing: { ...POLL_TIMING, sweep: true },
    sourceRef: { file: REGISTER_FILE, line: 50, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('target', '目标 id', 'string', true, 236, '被注视方块 / 实体 id 通配匹配。'),
      schemaField('target_type', '目标类型', 'enum', false, 237, '空 = 方块和实体都查；block / entity 限定一侧。', ['', 'block', 'entity']),
      schemaField('reach', '注视距离', 'float', false, 238, '最大注视距离（格）；缺省 4.5。'),
    ],
  },
  {
    type: 'facing',
    label: '朝向范围',
    role: 'poll',
    defaultPollInterval: 5,
    region: 'none',
    combinator: false,
    timing: { ...POLL_TIMING, onEnter: true, exitBuffer: false, sweep: true },
    sourceRef: { file: REGISTER_FILE, line: 53, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('yaw1', '起始 yaw', 'float', false, 264, '起始偏航角（度，±180 环绕）。'),
      schemaField('pitch1', '起始 pitch', 'float', false, 265, '起始俯仰角（度，-90~90；正 = 向下看）。'),
      schemaField('yaw2', '结束 yaw', 'float', false, 266, '结束偏航角；与 yaw1 相同 = 整圈（不限制朝向）。'),
      schemaField('pitch2', '结束 pitch', 'float', false, 267, '结束俯仰角（度，-90~90）。'),
    ],
  },
  {
    type: 'all_of',
    label: '全部满足',
    role: 'mixed',
    defaultPollInterval: 5,
    region: 'none',
    combinator: true,
    timing: { ...POLL_TIMING, onEnter: false, exitBuffer: false, window: true },
    sourceRef: { file: REGISTER_FILE, line: 55, symbol: 'registerTriggerTypes' },
    fields: [
      evaluatorField('list', '子条件列表', 'array', true, {
        file: MOD_ROOT + 'trigger/server/evaluator/Evaluators.java',
        line: 582,
        symbol: 'evaluateCombination',
      }, '子项 { type, conditions } 数组；非空；可嵌套组合器、轮询 / 事件子条件（事件子条件需 window > 0）、脚本前置。'),
    ],
  },
  {
    type: 'any',
    label: '任一满足',
    role: 'mixed',
    defaultPollInterval: 5,
    region: 'none',
    combinator: true,
    timing: { ...POLL_TIMING, onEnter: false, exitBuffer: false, window: true },
    sourceRef: { file: REGISTER_FILE, line: 57, symbol: 'registerTriggerTypes' },
    fields: [
      evaluatorField('list', '子条件列表', 'array', true, {
        file: MOD_ROOT + 'trigger/server/evaluator/Evaluators.java',
        line: 582,
        symbol: 'evaluateCombination',
      }, '子项 { type, conditions } 数组；非空；任一子项满足即命中。'),
    ],
  },
  {
    type: 'death',
    label: '玩家死亡',
    role: 'event',
    defaultPollInterval: null,
    region: 'sphere_or_box',
    combinator: false,
    timing: EVENT_TIMING,
    sourceRef: { file: REGISTER_FILE, line: 60, symbol: 'registerTriggerTypes' },
    fields: [
      schemaField('dimension', '维度', 'string', false, 137, '死亡发生时所在维度（死亡时刻快照判定）。'),
      schemaField('biome', '群系', 'string', false, 138, '死亡发生时所在群系（死亡时刻快照判定）。'),
      schemaField('position', '球形中心', 'map', false, 139, '死亡位置球形中心 { x, y, z }。'),
      schemaField('radius', '球形半径', 'float', false, 140, '球形半径（格）；缺省 0。'),
      schemaField('corner1', '方体角点 1', 'map', false, 141, '死亡位置方体一角 { x, y, z }。'),
      schemaField('corner2', '方体角点 2', 'map', false, 142, '死亡位置方体对角 { x, y, z }。'),
    ],
  },
]

// ── 内置前置目录 ────────────────────────────────────────────────────────────

/** 一种内置前置条件的目录条目。 */
export interface BuiltinRequirementInfo {
  type: string
  label: string
  /** 指向目标脚本的字段名（对象形态下与 `type` 同级）。 */
  scriptField: 'script'
  description: string
  sourceRef: SourceRef
}

const PREREQ_FILE = MOD_ROOT + 'trigger/server/prereq/BuiltinPrerequisites.java'

/** 三种内置前置条件；判定源均为「玩家 + 脚本」事实账本，锁存（事实一旦存在不回退）。 */
export const BUILTIN_REQUIREMENT_TYPES: readonly BuiltinRequirementInfo[] = [
  {
    type: 'script_played',
    label: '已播放过脚本',
    scriptField: 'script',
    description: '该玩家开始播放过且结束播放过目标脚本（任何退出原因都算）。',
    sourceRef: { file: PREREQ_FILE, line: 19, symbol: 'script_played' },
  },
  {
    type: 'script_started',
    label: '已开始播放脚本',
    scriptField: 'script',
    description: '该玩家开始播放过目标脚本（不校验是否结束）。',
    sourceRef: { file: PREREQ_FILE, line: 25, symbol: 'script_started' },
  },
  {
    type: 'script_completed',
    label: '已结束播放脚本',
    scriptField: 'script',
    description: '该玩家结束播放过目标脚本（不校验是否开始过）。',
    sourceRef: { file: PREREQ_FILE, line: 31, symbol: 'script_completed' },
  },
]

// ── 查询助手 ────────────────────────────────────────────────────────────────

const TYPE_INDEX = new Map(TRIGGER_TYPES.map((entry) => [entry.type, entry]))

/** 按类型键取目录条目；未登记类型返回 `undefined`（调用方走未知类型只读口径）。 */
export function triggerTypeInfo(type: string): TriggerTypeInfo | undefined {
  return TYPE_INDEX.get(type)
}

/** 是否为已登记的内置前置类型。 */
export function isBuiltinRequirement(type: string): boolean {
  return BUILTIN_REQUIREMENT_TYPES.some((entry) => entry.type === type)
}

/** 目录内类型键的有序列表（声明顺序）。 */
export const TRIGGER_TYPE_KEYS: readonly string[] = TRIGGER_TYPES.map((entry) => entry.type)
