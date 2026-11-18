/**
 * 事件记录字段目录（11-12 EVENT / 11-13 MOD_EVENT）。
 *
 * 两类记录体的字段、取值域、互斥关系与未知键处理全部以主模组代码为准：
 * - 解码白名单与未知成员拒绝：`script/object/ObjectCodec.java`（`readEvent` / `readModEvent`）；
 * - 事件类型与缺省回退：`script/object/ObjectValidator.java`（`checkEvent` / `checkModEvent`）；
 * - 运行时取值与回退链：`script/event/EventClipRuntime.java`（`newRecord` / `positionOf`）；
 * - schema 声明：`script/schema/TrackSchemas.java`（`eventObjects` / `modEventObjects`）。
 *
 * 本目录只描述字段事实，不做校验、不读文档；校验函数在 `src/features/behavior/events.ts`。
 * 06 轮既有的 `src/features/effects/eventRecords.ts` 提供字段表与命令翻译，这里复用其口径，
 * 不另造第二套字段定义。
 */

/** 主模组出处（与 `features/behavior/shared.ts` 的 `SourceRef` 同构；核心层不反向依赖 features）。 */
export interface CatalogSourceRef {
  /** 相对主模组仓库根的文件路径。 */
  file: string
  /** 1 起的行号。 */
  line: number
  /** 该处的 Java 符号名（类 / 方法 / 常量），便于二次核对。 */
  symbol?: string
}

/** 轨道类型（记录体归属）。 */
export type EventTrackType = 'EVENT' | 'MOD_EVENT'

/** 记录体字段的取值类型。 */
export type EventFieldKind = 'string' | 'position' | 'data'

/** 一条记录体字段的目录声明。 */
export interface EventFieldSpec {
  track: EventTrackType
  /** 记录体键名（Java 成员名逐字，不翻译）。 */
  key: string
  kind: EventFieldKind
  /** 记录级是否允许省略。 */
  optional: boolean
  /** 省略后是否回退到对象级（`objects.<path>.value`）显式写出的值。 */
  inheritsObjectFallback: boolean
  /** 取值域（人类可读；不是枚举白名单时写清边界）。 */
  valueDomain: string
  /** 互斥 / 共存 / 边界约束说明。 */
  constraints?: string
  sourceRef: CatalogSourceRef
  doc: string
}

const CODEC = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/object/ObjectCodec.java'
const VALIDATOR = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/object/ObjectValidator.java'
const RUNTIME = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventClipRuntime.java'
const RECORD = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventRecord.java'
const KEY = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventKey.java'
const SCHEMAS = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/schema/TrackSchemas.java'
const PLAYER = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/ModEventTrackPlayer.java'
const EVENT_MGR = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/trigger/server/ScriptEventManager.java'

/** EVENT 合法的唯一事件类型值（`ObjectValidator.checkEvent`）。 */
export const EVENT_COMMAND_TYPE = 'command'

/** 绝对位置键（世界坐标 x/z）。 */
export const POSITION_ABSOLUTE_KEYS = ['x', 'z'] as const

/** 相对位置键（相对脚本激活位置的 dx/dz）。 */
export const POSITION_RELATIVE_KEYS = ['dx', 'dz'] as const

/** 一条位置记录允许的键集合（恰好两个，两套互斥）。 */
export const POSITION_KEYS: readonly string[] = [...POSITION_ABSOLUTE_KEYS, ...POSITION_RELATIVE_KEYS]

/**
 * EVENT 记录体字段（`ObjectCodec.readEvent`，按源码成员顺序）。
 *
 * 四类键之外的成员在解码期直接抛 `ObjectFormatException`（未知成员拒绝，不静默保留）。
 */
export const EVENT_RECORD_FIELDS: readonly EventFieldSpec[] = [
  {
    track: 'EVENT',
    key: 'command',
    kind: 'string',
    optional: true,
    inheritsObjectFallback: false,
    valueDomain: '任意命令原文字符串；空串 = 占位（标记已触发但不执行）',
    constraints: '多条命令用 `&&` 分隔，运行时逐段执行、单段失败不影响后续段；编辑器保留原文不拆段；命令不带前导斜杠（带斜杠仅警告，保存保留原文）',
    sourceRef: { file: CODEC, line: 121, symbol: 'readEvent' },
    doc: '服务端按观看者集合执行；空命令只标记触发，不执行任何命令。',
  },
  {
    track: 'EVENT',
    key: 'event_type',
    kind: 'string',
    optional: true,
    inheritsObjectFallback: true,
    valueDomain: `仅允许 "${EVENT_COMMAND_TYPE}"；缺省取对象级 \`event_type\`，再缺省按 command`,
    constraints: '不是扩展点；写其他值校验器报错，运行时跳过该记录并限频告警',
    sourceRef: { file: VALIDATOR, line: 767, symbol: 'checkEvent' },
    doc: '对象级缺省见 TrackSchemas.eventObjects（缺省 command）；运行时回退见 EventClipRuntime.newRecord。',
  },
  {
    track: 'EVENT',
    key: 'position',
    kind: 'position',
    optional: true,
    inheritsObjectFallback: false,
    valueDomain: `恰好两个键：绝对 {x,z}（世界坐标）或相对 {dx,dz}（相对脚本激活位置）；两键均为有限数字`,
    constraints: '两套写法互斥：混写、缺一键、多键都拒绝；只有水平两轴，纵向由玩家物理决定；不足两个航点不驱动移动',
    sourceRef: { file: CODEC, line: 129, symbol: 'readPosition' },
    doc: '相对基准是脚本激活位置（触发点），不是片段起点；运行时宽容处理不作为编辑器依据。',
  },
  {
    track: 'EVENT',
    key: 'id',
    kind: 'string',
    optional: true,
    inheritsObjectFallback: false,
    valueDomain: '可选字符串；运行时忽略',
    constraints: '不参与运行时身份，不用它去重；编辑器可作会话内稳定键，保留原值、不自动生成',
    sourceRef: { file: CODEC, line: 121, symbol: 'readEvent' },
    doc: '运行时身份 = 播放实例 + 片段 + 对象路径 + 事件下标（EventKey），与记录 id 无关。',
  },
]

/**
 * MOD_EVENT 记录体字段（`ObjectCodec.readModEvent`）。
 *
 * `command` / `position` / `id` 属于 EVENT，出现在 MOD_EVENT 记录里一律按未知成员拒绝。
 */
export const MOD_EVENT_RECORD_FIELDS: readonly EventFieldSpec[] = [
  {
    track: 'MOD_EVENT',
    key: 'event_type',
    kind: 'string',
    optional: true,
    inheritsObjectFallback: true,
    valueDomain: '任意非空字符串（自由事件名，无固定枚举：天气变化、章节名、带命名空间的自定义名等）',
    constraints: '记录级省略时取对象级显式写出的值；对象级也没有 = 缺少事件名；空串非法，不落回默认值',
    sourceRef: { file: VALIDATOR, line: 790, symbol: 'checkModEvent' },
    doc: '不吃 schema 缺省：对象级只回落显式写出的 value-only 字段。',
  },
  {
    track: 'MOD_EVENT',
    key: 'data',
    kind: 'data',
    optional: true,
    inheritsObjectFallback: true,
    valueDomain: '顶层必须是 JSON 对象；内部任意嵌套（对象 / 数组 / 字符串 / 有限数 / 布尔 / null）',
    constraints: '数字必须有限；记录级写空对象 {} 是显式空对象，省略 data 才回退对象级；两者落盘结果不同',
    sourceRef: { file: CODEC, line: 153, symbol: 'readModEvent' },
    doc: '数据是自由结构，编辑器不建 schema、不解释消费方含义。',
  },
]

/** EVENT 记录体允许的键（白名单）。 */
export const EVENT_RECORD_KEYS: readonly string[] = EVENT_RECORD_FIELDS.map((field) => field.key)

/** MOD_EVENT 记录体允许的键（白名单）。 */
export const MOD_EVENT_RECORD_KEYS: readonly string[] = MOD_EVENT_RECORD_FIELDS.map((field) => field.key)

/** MOD_EVENT 记录里被禁止的 EVENT 键（出现即 block）。 */
export const MOD_EVENT_FORBIDDEN_KEYS: readonly string[] = ['command', 'position', 'id']

/** 按轨道类型取字段目录。 */
export function recordFields(track: EventTrackType): readonly EventFieldSpec[] {
  return track === 'EVENT' ? EVENT_RECORD_FIELDS : MOD_EVENT_RECORD_FIELDS
}

/** 按轨道类型取允许键白名单。 */
export function recordAllowedKeys(track: EventTrackType): readonly string[] {
  return track === 'EVENT' ? EVENT_RECORD_KEYS : MOD_EVENT_RECORD_KEYS
}

/** 位置对象的键是否成对且不混写；返回解析结果。 */
export function classifyPosition(
  value: unknown,
):
  | { ok: true; kind: 'absolute' | 'relative'; keys: readonly ['x', 'z'] | readonly ['dx', 'dz'] }
  | { ok: false; reason: 'not-object' | 'shape' | 'non-finite' } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not-object' }
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object)
  const absolute = POSITION_ABSOLUTE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(object, key))
  const relative = POSITION_RELATIVE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(object, key))
  if (keys.length !== 2 || absolute === relative) {
    return { ok: false, reason: 'shape' }
  }
  for (const key of keys) {
    const item = object[key]
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      return { ok: false, reason: 'non-finite' }
    }
  }
  return absolute
    ? { ok: true, kind: 'absolute', keys: POSITION_ABSOLUTE_KEYS }
    : { ok: true, kind: 'relative', keys: POSITION_RELATIVE_KEYS }
}

/** 事件记录的运行时身份事实（供面板说明，不写盘）。 */
export const RUNTIME_IDENTITY_SOURCE: CatalogSourceRef = {
  file: KEY,
  line: 22,
  symbol: 'EventKey',
}

/** MOD_EVENT 内置播放器不消费该轨的事实出处。 */
export const MOD_EVENT_NOT_CONSUMED_SOURCE: CatalogSourceRef = {
  file: PLAYER,
  line: 11,
  symbol: 'ModEventTrackPlayer',
}

/** 空命令 = 占位、非 command 类型跳过的运行时出处。 */
export const COMMAND_RUNTIME_SOURCE: CatalogSourceRef = {
  file: EVENT_MGR,
  line: 436,
  symbol: 'fireEvent',
}

/** `&&` 拆段执行的运行时出处。 */
export const COMMAND_SPLIT_SOURCE: CatalogSourceRef = {
  file: EVENT_MGR,
  line: 605,
  symbol: 'executeCommand',
}

/** schema 声明：EVENT 对象与对象级 event_type 缺省。 */
export const EVENT_SCHEMA_SOURCE: CatalogSourceRef = {
  file: SCHEMAS,
  line: 383,
  symbol: 'eventObjects',
}

/** schema 声明：MOD_EVENT 对象、对象级 event_type 缺省与 data 结构。 */
export const MOD_EVENT_SCHEMA_SOURCE: CatalogSourceRef = {
  file: SCHEMAS,
  line: 391,
  symbol: 'modEventObjects',
}

/** 记录组件事实出处（time / eventType / command / position / data）。 */
export const RECORD_COMPONENTS_SOURCE: CatalogSourceRef = {
  file: RECORD,
  line: 15,
  symbol: 'EventRecord',
}

/** 位置组件事实出处（x / z / relative）。 */
export const POSITION_COMPONENTS_SOURCE: CatalogSourceRef = {
  file: RECORD,
  line: 21,
  symbol: 'EventRecord.Position',
}

/** 运行时回退链出处（event_type / data 的对象级缺省取值）。 */
export const RUNTIME_FALLBACK_SOURCE: CatalogSourceRef = {
  file: RUNTIME,
  line: 184,
  symbol: 'newRecord',
}
