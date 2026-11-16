/**
 * 文档键白名单与 id 形态：逐条对齐运行时解析器的硬约束。
 *
 * - 根对象：运行时**没有**白名单（只按名读取 meta/timeline/clips/rules/rule_bindings/paths），
 *   所以根上的其它键保留 + `info`。
 * - `meta` / `timeline` / 片段：运行时 `rejectUnknownFields` / `ObjectParser.CLIP_KEYS` 直接拒绝。
 * - 属性对象：只允许 `value` / `keyframes`。
 */
import type { CatalogIndex } from '../schema/index.ts'

/** `ScriptParser.TIMELINE_KEYS`。 */
export const TIMELINE_KEYS: readonly string[] = ['tracks', 'loop_start', 'loop_end']

/** `ObjectParser.CLIP_KEYS`：内联片段允许的 8 个键。 */
export const CLIP_KEYS: readonly string[] = [
  'start_time',
  'duration',
  'objects',
  'loop',
  'loop_count',
  'loop_mode',
  'id',
  'exit',
]

/** 独立片段专用键：`track` 在 `parseStandaloneClips` 里被摘掉后才交给 `ObjectParser`。 */
export const STANDALONE_CLIP_KEYS: readonly string[] = [...CLIP_KEYS, 'track']

/** 属性对象成员白名单（`ObjectParser.parseProperty`）。 */
export const PROPERTY_KEYS: readonly string[] = ['value', 'keyframes']

/** 片段 id（`ClipIdentity.PATTERN`）。 */
export const CLIP_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/

/** `meta.id`（`ScriptParser#parseMeta`）。 */
export const META_ID_PATTERN = /^[a-zA-Z0-9_]{1,32}$/

/** 规则 / 绑定 / 路径 id（`RuleCollectionParser.ID_PATTERN` / `PathCollectionParser.ID_PATTERN`）。 */
export const RULE_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/

/** `meta.name` 最大长度（UTF-16 码元）。 */
export const META_NAME_MAX = 50

/** `meta.author` 最大长度（UTF-16 码元）。 */
export const META_AUTHOR_MAX = 30

/** `meta` 键集合：21 个 `MetaSchemas` 字段 + `triggers` + `trigger_poll_interval`，只从 02 目录取。 */
export function metaKeys(catalog: CatalogIndex): string[] {
  return catalog.search({ segment: 'meta' }).map((entry) => entry.key)
}

/** 轨道类型是否被 02 目录登记（7 个内置 + 已发现 / 第三方）。 */
export function isKnownTrackType(catalog: CatalogIndex, type: string): boolean {
  return catalog.track(type) !== undefined
}

/**
 * 未知轨道类型的分类（03-08）：
 * - `builtin-like`（不含 `:`）→ parser 抛「未知的轨道类型」，本地 `block`；
 * - `third-party`（含 `:`）→ 文档仍打开、该轨只读、原样保存，不报「未知字段」。
 */
export function unknownTrackKind(type: string): 'unknown' | 'third-party' {
  return type.includes(':') ? 'third-party' : 'unknown'
}

/** 内联片段 / 独立片段共用同一 `DocClip` 结构，键白名单不同。 */
export function clipKeys(inline: boolean): readonly string[] {
  return inline ? CLIP_KEYS : STANDALONE_CLIP_KEYS
}

/** 根对象上运行时认识的键（其余键运行时忽略，编辑器保留）。 */
export const ROOT_KEYS: readonly string[] = [
  'meta',
  'timeline',
  'clips',
  'paths',
  'rules',
  'rule_bindings',
]

/** 出口策略键（`ClipExitPolicyParser.KEYS`）。 */
export const EXIT_KEYS: readonly string[] = ['on_complete', 'target', 'entry_time']

/** 出口类型（`ClipExitPolicyParser.KIND_NAMES`）。 */
export const EXIT_KIND_NAMES: readonly string[] = [
  'continue',
  'goto',
  'return',
  'end_execution',
  'end_script',
]

/** 规则键（`RuleCollectionParser.DEFINITION_KEYS`）。 */
export const RULE_KEYS: readonly string[] = ['id', 'condition', 'actions', 'policy']

/** 规则策略键（`RuleCollectionParser.POLICY_KEYS`）。 */
export const RULE_POLICY_KEYS: readonly string[] = [
  'once',
  'cooldown',
  'mode',
  'dwell',
  'timeout',
  'on_timeout',
]

/** 绑定键（`RuleCollectionParser.BINDING_KEYS`）。 */
export const BINDING_KEYS: readonly string[] = [
  'id',
  'rule',
  'clip',
  'gate',
  'control',
  'schedule',
  'exit',
]

/** 路径条目键（`PathCollectionParser.ENTRY_KEYS`）。 */
export const PATH_KEYS: readonly string[] = ['id', 'clip', 'from', 'to', 'axes', 'geometry', 'timing']

/** 调度类型（`RuleReleaseKind.SCRIPT_NAMES`）。 */
export const SCHEDULE_KINDS: readonly string[] = [
  'clip_start',
  'clip_complete',
  'local_time',
  'delay',
  'fact',
]

/** 循环模式枚举。 */
export const LOOP_MODES: readonly string[] = ['repeat', 'pingpong']

/** 键白名单校验：返回第一个不在白名单的键（没有则 `undefined`）。 */
export function firstUnknownKey(node: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) {
      return key
    }
  }
  return undefined
}
