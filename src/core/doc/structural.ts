/**
 * 本地结构检查 L01–L34（03-06）；13 轮补充 L91（同轨字幕重叠）、L92（资源存在性，
 * 由 `resources.ts` 独立检查挂载到同一本地链路）、L93（OVERLAY 字段错层适用性）。
 *
 * 分层原则：本地只查「文档结构对不对」，不判世界状态、不复刻 parser 的语义求值；
 * 语义以服务端 `script.validate` 为权威。
 *
 * severity 口径：
 * - `block` = 运行时 `ScriptParser` / `ObjectParser` 会抛错（文件无法加载）；
 * - `error` = parser 接受、`script.validate` 报错（脚本能播但 `ok:false`）；
 * - `warn` = 服务端 `[警告] ` 级；
 * - `info` = 编辑器提示（根未知键、第三方轨道只读）。
 *
 * 明确不查：片段重叠、CAMERA 至少一帧（03-06 边界）。
 */
import type { CatalogIndex } from '../schema/index.ts'
import type { FieldEntry } from '../schema/types.ts'
import { clipIdOf, hasObjects, readClip, readExit } from './clip.ts'
import type { ClipShape } from './clip.ts'
import { isJsonObject, memberPath } from './json.ts'
import {
  BINDING_KEYS,
  META_AUTHOR_MAX,
  META_ID_PATTERN,
  META_NAME_MAX,
  PATH_KEYS,
  RULE_ID_PATTERN,
  RULE_KEYS,
  RULE_POLICY_KEYS,
  SCHEDULE_KINDS,
  TIMELINE_KEYS,
  firstUnknownKey,
  isKnownTrackType,
  unknownTrackKind,
} from './keys.ts'
import { ClipRegistry, clipPositionNodes } from './identity.ts'
import { validateGeometry } from '../paths/geometry.ts'
import { validateTiming } from '../paths/timing.ts'
import { isValidObjectPath, POSITION_AXIS_PATHS } from './path.ts'
import type { DocIssue, JsonObject, JsonValue, ScriptDoc, Severity } from './types.ts'
import type { BehaviorProblem } from '../../features/behavior/shared.ts'
import type { BehaviorRefs } from '../schema/catalog/behaviorRules.ts'
import { validateRules } from '../../features/behavior/rules.ts'
import { validateBindings } from '../../features/behavior/bindings.ts'
import {
  TRIGGER_ID_PATTERN,
  findDuplicateIds,
  parseTriggerNode,
  triggerTimingIssues,
} from '../../features/behavior/trigger.ts'
import { validateTriggerConditions } from '../../features/behavior/triggerConditions.ts'
import {
  isOverlayLayerType,
  isOverlayFieldApplicable,
  type OverlayLayerType,
} from '../../features/overlay/layers.ts'
import {
  requirementEntries,
  resolveRequirement,
  validateRequirementFields,
} from '../../features/behavior/requirements.ts'
import type { RequirementContext } from '../../features/behavior/requirements.ts'
import type { RequirementEntry } from '../../features/behavior/trigger.types.ts'
import { eventRecords } from '../../features/behavior/events.ts'
import { factIndex } from '../../features/behavior/facts.ts'
import { severityForContract } from '../../features/behavior/validation.ts'

/** 结构检查上下文。 */
export interface StructuralContext {
  catalog: CatalogIndex
  /** meta 键集合（只从 02 目录取）。 */
  metaKeys: readonly string[]
  /** 片段身份表（已与文档同步）。 */
  registry: ClipRegistry
  /**
   * 项目图已知脚本 id 集合（含本脚本 `meta.id`）。转发给前置 / 事实域校验器做存在性判定；
   * 缺省（`undefined`）= 未提供索引，域层降级 `unresolved`，不报缺失、也不判已解析。
   */
  knownScriptIds?: readonly string[]
}

/** 参考系切换字段（`ObjectValidator.SPACE_SWITCH_FIELDS`）。 */
const SPACE_SWITCH_FIELDS: readonly string[] = [
  'position_mode',
  'position_space',
  'position_origin',
  'position_origin_freeze',
  'facing_source',
]

/** 只在 `position_space=base` 时改变参考系的字段（`ObjectValidator.BASE_SWITCH_FIELDS`）。 */
const BASE_SWITCH_FIELDS: readonly string[] = [
  'facing_target',
  'facing_target_freeze',
  'facing_entity',
  'look_at_freeze',
  'yaw_base_from_freeze',
  'yaw_base_to_freeze',
]

/**
 * Java `ObjectValidator.rejectPingpong`（`script/object/ObjectValidator.java:176-183`）：
 * AUDIO / EVENT / MOD_EVENT 轨拒绝 `loop_mode: "pingpong"`；视觉轨（CAMERA / OVERLAY /
 * LETTERBOX / ADJUST）保留乒乓时间映射。
 */
const PINGPONG_REJECT_TRACKS: ReadonlySet<string> = new Set(['AUDIO', 'EVENT', 'MOD_EVENT'])

/** 读片段原始 `loop_mode`；非对象 / 非字符串返回 `undefined`。 */
function readLoopMode(raw: JsonValue): string | undefined {
  if (isJsonObject(raw) && typeof raw.loop_mode === 'string') return raw.loop_mode
  return undefined
}

/**
 * 字符串简写前置（`requires: ["a"]` ≡ `{type:"script_played", script:"a"}`）校验。
 * 与对象写法同码：空串 → L43；自引用 / 目标不存在 → L44；未提供脚本索引时三态降级「未判定」，
 * 不报缺失、也不判已解析。Java 依据：`ScriptValidator.java:2057-2068`
 * （空串 :2059-2061、自引用 :2063-2065、`knownScriptIds` 缺失 :2066-2068）。
 */
function validateStringRequirement(
  entry: Extract<RequirementEntry, { kind: 'string' }>,
  path: string,
  ctx: RequirementContext,
): BehaviorProblem[] {
  const resolved = resolveRequirement(entry, ctx)
  switch (resolved.status) {
    case 'malformed':
      return [{
        code: 'REQ_SCRIPT_MISSING',
        severity: 'block',
        message: '前置脚本 id 不能为空',
        jsonPath: path,
      }]
    case 'self_reference':
      return [{
        code: 'REQ_SELF_REFERENCE',
        severity: 'warn',
        message: `script 自引用自身脚本 '${resolved.targetScriptId ?? ''}'（可能永不解锁或自我循环）`,
        jsonPath: path,
      }]
    case 'missing':
      return [{
        code: 'REQ_SCRIPT_MISSING_TARGET',
        severity: 'error',
        message: `script 指向不存在的脚本 '${resolved.targetScriptId ?? ''}'（该前置条件永不满足）`,
        jsonPath: path,
      }]
    default:
      return []
  }
}

interface IssueExtra {
  clipKey?: string
  objectPath?: string
  keyframeTime?: number
}

/** 一个片段的结构上下文（供参考系切换 / requires / 端点检查复用）。 */
interface ClipContext {
  clip: JsonObject
  clipKey?: string
  trackType: string
  jsonPath: string
  inline: boolean
  shape: ClipShape
}

/** 片段 id → 片段上下文（重复 id 保留第一个，重复本身另报）。 */
type ClipIndex = Map<string, ClipContext>

// ── 11 轮行为合同装配：内部问题码 → L35–L90 合同码路由 ──────────────────────────
// 级别一律取 `validation.ts` 的 `severityForContract`，本映射只做分桶，不另造级别表。

/** 内部问题码 → 合同码直映；未列出的按前缀回落。 */
const INTERNAL_TO_CONTRACT: ReadonlyMap<string, string> = new Map([
  // 触发器（L41–L51）
  ['TRIGGER_TYPE_UNKNOWN', 'L41'],
  ['COND_FIELD_REQUIRED', 'L45'],
  ['COND_FIELD_TYPE', 'L45'],
  ['COND_FIELD_ENUM', 'L45'],
  ['COMBINATOR_LIST_MISSING', 'L46'],
  ['COMBINATOR_LIST_EMPTY', 'L46'],
  ['COMBINATOR_CHILD_NOT_OBJECT', 'L46'],
  ['COMBINATOR_CHILD_TYPE_MISSING', 'L46'],
  ['COMBINATOR_CHILD_CONDITIONS_TYPE', 'L46'],
  ['COMBINATOR_DEPTH_LIMIT', 'L46'],
  ['COMBINATOR_CHILD_UNKNOWN', 'L46'],
  ['COMBINATOR_EVENT_NO_WINDOW', 'L47'],
  ['TRIGGER_EXIT_BUFFER_UNSUPPORTED', 'L48'],
  ['TRIGGER_POLL_INTERVAL_UNSUPPORTED', 'L49'],
  ['TRIGGER_ON_ENTER_UNSUPPORTED', 'L50'],
  ['TRIGGER_CONTINUITY_TYPE', 'L51'],
  ['TRIGGER_SWEEP_TYPE', 'L51'],
  ['TRIGGER_SWEEP_UNSUPPORTED', 'L51'],
  ['TRIGGER_DWELL_TYPE', 'L51'],
  ['TRIGGER_DWELL_NOT_INT', 'L51'],
  ['TRIGGER_DWELL_RANGE', 'L51'],
  ['TRIGGER_DWELL_UNSUPPORTED', 'L51'],
  ['TRIGGER_WINDOW_TYPE', 'L51'],
  ['TRIGGER_WINDOW_NOT_INT', 'L51'],
  ['TRIGGER_WINDOW_RANGE', 'L51'],
  ['TRIGGER_WINDOW_UNSUPPORTED', 'L51'],
  ['TRIGGER_REPEATABLE_TYPE', 'L45'],
  ['TRIGGER_DELAY_TYPE', 'L45'],
  ['TRIGGER_ON_ENTER_TYPE', 'L45'],
  ['TRIGGER_EXIT_BUFFER_TYPE', 'L45'],
  ['TRIGGER_POLL_INTERVAL_TYPE', 'L45'],
  ['TRIGGER_POLL_INTERVAL_NOT_INT', 'L45'],
  ['TRIGGER_POLL_INTERVAL_RANGE', 'L45'],
  ['REQ_TYPE_MISSING', 'L43'],
  ['REQ_SCRIPT_MISSING', 'L43'],
  ['REQ_SELF_REFERENCE', 'L44'],
  ['REQ_SCRIPT_MISSING_TARGET', 'L44'],
  // 规则定义（L53 / L54）
  ['RULES_ARRAY', 'L53'],
  ['RULE_TYPE', 'L53'],
  ['RULE_UNKNOWN_KEY', 'L53'],
  ['RULE_ID_MISSING', 'L53'],
  ['RULE_ID_TYPE', 'L53'],
  ['RULE_ID_PATTERN', 'L53'],
  ['RULE_ID_DUPLICATE', 'L53'],
  ['RULE_CONDITION_TYPE', 'L53'],
  ['RULE_CONDITION_EMPTY', 'L53'],
  ['RULE_ACTIONS_TYPE', 'L53'],
  ['RULE_ACTIONS_EMPTY', 'L53'],
  ['RULE_POLICY_TYPE', 'L54'],
  ['RULE_POLICY_UNKNOWN_KEY', 'L54'],
  ['RULE_POLICY_ONCE_TYPE', 'L54'],
  ['RULE_POLICY_MODE', 'L54'],
  ['RULE_POLICY_TIMEOUT_TYPE', 'L54'],
  ['RULE_POLICY_TIMEOUT_RANGE', 'L54'],
  ['RULE_POLICY_ON_TIMEOUT_TYPE', 'L54'],
  ['RULE_POLICY_ON_TIMEOUT_IDLE', 'L54'],
  ['RULE_POLICY_COOLDOWN', 'L54'],
  ['RULE_POLICY_DWELL', 'L54'],
  ['RULE_POLICY_DWELL_ZERO', 'L90'],
  // 规则条件树（L55；可达性 / 自引用另归 L86 / L88 / L90）
  ['RULE_CONDITION_NODE_TYPE', 'L55'],
  ['RULE_CONDITION_TYPE_MISSING', 'L55'],
  ['RULE_CONDITION_TYPE_UNKNOWN', 'L55'],
  ['RULE_CONDITION_UNKNOWN_KEY', 'L55'],
  ['RULE_CONDITION_LIST_TYPE', 'L55'],
  ['RULE_CONDITION_LIST_EMPTY', 'L55'],
  ['RULE_CONDITION_DEPTH', 'L55'],
  ['RULE_CONDITION_CHILD_TYPE', 'L55'],
  ['RULE_CONDITION_CHILD_DATA_TYPE', 'L55'],
  ['RULE_CONDITION_TIME_EMPTY', 'L55'],
  ['RULE_CONDITION_TIME_MUTEX', 'L55'],
  ['RULE_CONDITION_TIME_AT', 'L55'],
  ['RULE_CONDITION_TIME_FROM', 'L55'],
  ['RULE_CONDITION_TIME_TO', 'L55'],
  ['RULE_CONDITION_LOCATION_DIMENSION', 'L55'],
  ['RULE_CONDITION_LOCATION_EMPTY', 'L55'],
  ['RULE_CONDITION_CAMERA_POS_EMPTY', 'L55'],
  ['RULE_CONDITION_CAMERA_POS_BOTH', 'L55'],
  ['RULE_CONDITION_BOX_PAIR', 'L55'],
  ['RULE_CONDITION_SPHERE_POSITION', 'L55'],
  ['RULE_CONDITION_SPHERE_RADIUS', 'L55'],
  ['RULE_CONDITION_FOV_EMPTY', 'L55'],
  ['RULE_CONDITION_FOV_FROM', 'L55'],
  ['RULE_CONDITION_FOV_TO', 'L55'],
  ['RULE_CONDITION_CLIP_MISSING', 'L55'],
  ['RULE_CONDITION_CLIP_UNKNOWN', 'L55'],
  ['RULE_CONDITION_CLIP_UNREACHABLE', 'L88'],
  ['RULE_CONDITION_TIMELINE_MISSING', 'L90'],
  ['RULE_CONDITION_BINDING_MISSING', 'L55'],
  ['RULE_CONDITION_BINDING_UNKNOWN', 'L55'],
  ['RULE_CONDITION_BINDING_SELF', 'L86'],
  ['RULE_CONDITION_FACT_MISSING', 'L55'],
  ['RULE_CONDITION_FACT', 'L55'],
  // 动作（L58–L68）
  ['ACTION_TYPE', 'L58'],
  ['ACTION_TYPE_MISSING', 'L58'],
  ['ACTION_TYPE_UNKNOWN', 'L58'],
  // pause 无释放者属运行期告警并自动释放（`RuleRuntime.java:57-58`），不阻止加载；
  // L58–L68 无「配对缺失」行，按既有先例（`RULE_POLICY_DWELL_ZERO` / `BINDING_EXIT_SYNONYM_MIX`）落提示桶 L90。
  ['ACTION_PAUSE_UNPAIRED', 'L90'],
  ['ACTION_RESUME_UNPAIRED', 'L90'],
  ['ACTION_GOTO_TRACK_LEGACY', 'L59'],
  ['ACTION_GOTO_AT_LEGACY', 'L59'],
  ['ACTION_GOTO_CLIP_MISSING', 'L59'],
  ['ACTION_GOTO_CLIP_UNKNOWN', 'L59'],
  ['ACTION_GOTO_ENTRY_TIME', 'L59'],
  ['ACTION_CAMERA_CHANNELS_EMPTY', 'L60'],
  ['ACTION_CAMERA_CHANNEL_TYPE', 'L60'],
  ['ACTION_CAMERA_CHANNEL_UNKNOWN', 'L60'],
  ['ACTION_CAMERA_CHANNEL_DUPLICATE', 'L60'],
  ['ACTION_CAMERA_VALUE_MISSING', 'L60'],
  ['ACTION_CAMERA_VALUE_UNSELECTED', 'L60'],
  ['ACTION_CAMERA_MODE', 'L60'],
  ['ACTION_CAMERA_PRIORITY', 'L60'],
  ['ACTION_CAMERA_POSITION', 'L60'],
  ['ACTION_OVERLAY_TYPE', 'L61'],
  ['ACTION_OVERLAY_COLOR', 'L61'],
  ['ACTION_OVERLAY_OPACITY', 'L61'],
  ['ACTION_OVERLAY_Z_INDEX', 'L61'],
  ['ACTION_ADJUST_EMPTY', 'L62'],
  ['ACTION_ADJUST_CHANNEL', 'L62'],
  ['ACTION_NO_PARAM', 'L63'],
  ['ACTION_SOUND_MISSING', 'L64'],
  ['ACTION_SOUND_VOLUME', 'L64'],
  ['ACTION_SOUND_PITCH', 'L64'],
  ['ACTION_COMMAND_MISSING', 'L65'],
  ['ACTION_COMMAND_SLASH', 'L66'],
  ['ACTION_UNKNOWN_KEY', 'L67'],
  ['ACTION_COMMAND_IN_TIMEOUT', 'L68'],
  // 绑定（L56；持有可达性 L57；边界提示 L90）
  ['BINDING_HOLD_FUTURE_TIME', 'L57'],
  ['BINDING_HOLD_UNREACHABLE_CLIP', 'L57'],
  ['BINDING_TIMELINE_MISSING', 'L90'],
  ['BINDING_EXIT_SYNONYM_MIX', 'L90'],
])

/** 内部问题码路由到合同码；已是 L 码则原样保留。 */
function contractCodeOf(problem: BehaviorProblem): string {
  if (problem.code.startsWith('L')) {
    return problem.code
  }
  const direct = INTERNAL_TO_CONTRACT.get(problem.code)
  if (direct !== undefined) {
    return direct
  }
  if (problem.code.startsWith('BINDING_')) return 'L56'
  if (problem.code.startsWith('ACTION_')) return 'L58'
  if (problem.code.startsWith('RULE_CONDITION_')) return 'L55'
  if (problem.code.startsWith('RULE_POLICY_')) return 'L54'
  if (problem.code.startsWith('RULE_')) return 'L53'
  if (problem.code.startsWith('COMBINATOR_')) return 'L46'
  if (problem.code.startsWith('COND_FIELD_')) return 'L45'
  if (problem.code.startsWith('TRIGGER_')) return 'L45'
  if (problem.code.startsWith('REQ_')) return 'L43'
  return 'L90'
}

/** 把行为域问题装配成本地 DocIssue；级别取合同码判级，不沿用内部级别。 */
function appendBehaviorProblems(issues: DocIssue[], problems: readonly BehaviorProblem[]): void {
  for (const problem of problems) {
    const code = contractCodeOf(problem)
    issues.push({
      code,
      severity: severityForContract(code),
      message: problem.message,
      jsonPath: problem.jsonPath,
      ...(problem.clipKey === undefined ? {} : { clipKey: problem.clipKey }),
      ...(problem.objectPath === undefined ? {} : { objectPath: problem.objectPath }),
      source: 'local',
    })
  }
}

/** 值 token：数字归一化，避免 `1` 与 `1.0` 不等（`ObjectValidator.token`）。 */
function tokenOf(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return 'null'
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value)
}

/** 属性的 t=0 有效值 token：首帧 > value > 目录默认值。 */
function staticToken(shape: ClipShape, def: FieldEntry | undefined, path: string): string {
  const property = shape.objects[path]
  if (property !== undefined) {
    const frames = property.keyframes ?? []
    if (frames.length > 0) {
      return tokenOf(frames[0].value)
    }
    if (Object.prototype.hasOwnProperty.call(property, 'value')) {
      return tokenOf(property.value)
    }
  }
  return def === undefined ? 'null' : tokenOf(def.default as JsonValue)
}

/** 解析 `path=value` / `path!=value`；非法返回 `undefined`。 */
function parseRequires(expression: string): { path: string; value: string; negate: boolean } | undefined {
  const text = expression.trim()
  const notEquals = text.indexOf('!=')
  if (notEquals > 0) {
    return { path: text.slice(0, notEquals).trim(), value: text.slice(notEquals + 2).trim(), negate: true }
  }
  const equals = text.indexOf('=')
  if (equals > 0) {
    return { path: text.slice(0, equals).trim(), value: text.slice(equals + 1).trim(), negate: false }
  }
  return undefined
}

/** 按被引用字段的类型比较实际 token 与字面量（`ObjectValidator.evalRequires` 同口径）。 */
function requiresSatisfied(actualToken: string, literal: string): boolean {
  return actualToken === literal
}

/** 检查一个片段（内联 / 独立共用），返回结构上下文。 */
function readClipInto(
  raw: JsonValue,
  inline: boolean,
  trackType: string,
  jsonPath: string,
  ctx: StructuralContext,
  issues: DocIssue[],
): ClipContext | undefined {
  if (!isJsonObject(raw)) {
    issues.push({
      code: inline ? 'L06' : 'L09',
      severity: 'block',
      message: '需要对象（片段）',
      jsonPath,
      source: 'local',
    })
    return undefined
  }
  const clipKey = ctx.registry.keyOf(raw)
  const result = readClip(raw, { inline, jsonPath, trackType, catalog: ctx.catalog })
  for (const problem of result.problems) {
    issues.push({
      ...problem,
      ...(clipKey === undefined ? {} : { clipKey }),
      source: 'local',
    })
  }
  return {
    clip: raw,
    ...(clipKey === undefined ? {} : { clipKey }),
    trackType,
    jsonPath,
    inline,
    shape: result.clip,
  }
}

/**
 * 运行本地结构检查。
 *
 * 调用方必须先 `registry.sync(doc)`；本函数只读文档，不改任何值。
 */
export function validateStructure(doc: ScriptDoc, ctx: StructuralContext): DocIssue[] {
  const issues: DocIssue[] = []
  const add = (severity: Severity, code: string, message: string, jsonPath: string, extra: IssueExtra = {}): void => {
    issues.push({ code, severity, message, jsonPath, source: 'local', ...extra })
  }

  // ── L01 / L02 / L03 / L04：根与 meta ──────────────────────────────────────
  const meta = doc.meta
  const unknownMeta = firstUnknownKey(meta, ctx.metaKeys)
  if (unknownMeta !== undefined) {
    add('block', 'L02', `未知字段（可用: ${ctx.metaKeys.join(' / ')}）`, memberPath('meta', unknownMeta))
  }
  if (typeof meta.id !== 'string' || meta.id.length === 0) {
    add('block', 'L03', 'meta.id 缺失或不是字符串', 'meta.id')
  } else if (!META_ID_PATTERN.test(meta.id)) {
    add('block', 'L03', `meta.id 必须匹配 ${META_ID_PATTERN.source}，实际: ${meta.id}`, 'meta.id')
  }
  if (typeof meta.name !== 'string' || meta.name.length === 0) {
    add('block', 'L04', 'meta.name 缺失或不是字符串', 'meta.name')
  } else if (meta.name.length > META_NAME_MAX) {
    add('block', 'L04', `meta.name 最长 ${META_NAME_MAX} 字符，实际: ${meta.name.length}`, 'meta.name')
  }
  if (typeof meta.author !== 'string') {
    add('block', 'L04', 'meta.author 缺失或不是字符串', 'meta.author')
  } else if (meta.author.length > META_AUTHOR_MAX) {
    add('block', 'L04', `meta.author 最长 ${META_AUTHOR_MAX} 字符，实际: ${meta.author.length}`, 'meta.author')
  }

  // ── L03 / L04：meta 语义（parser 宽松 / 严格混合，validator 报错） ────────
  checkMetaExtras(meta, add)

  // ── L05：timeline ────────────────────────────────────────────────────────
  const timeline = doc.timeline
  const unknownTimeline = firstUnknownKey(timeline, TIMELINE_KEYS)
  if (unknownTimeline !== undefined) {
    add('block', 'L05', `未知字段（可用: ${TIMELINE_KEYS.join(' / ')}）`, memberPath('timeline', unknownTimeline))
  }
  for (const key of ['loop_start', 'loop_end']) {
    if (!Object.prototype.hasOwnProperty.call(timeline, key)) {
      continue
    }
    const value = timeline[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      add('block', 'L05', `${key} 需要有限数字，实际: ${String(value)}`, memberPath('timeline', key))
    }
  }

  const tracks = timeline.tracks
  if (!Array.isArray(tracks)) {
    add('block', 'L05', 'timeline.tracks 缺失或不是数组', 'timeline.tracks')
    return issues
  }

  const clipContexts: ClipContext[] = []
  const clipIndex: ClipIndex = new Map()
  const idSeen = new Map<string, string>()

  // ── L08 / L23 / L06 / L07 / L10–L19 / L31 / L34：轨道与内联片段 ──────────
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const trackPath = `timeline.tracks[${trackIndex}]`
    const track = tracks[trackIndex]
    if (!isJsonObject(track)) {
      add('block', 'L08', '轨道需要对象', trackPath)
      continue
    }
    const type = track.type
    if (typeof type !== 'string' || type.length === 0) {
      add('block', 'L08', '轨道缺少 type（轨道类型名）', memberPath(trackPath, 'type'))
      continue
    }
    if (!isKnownTrackType(ctx.catalog, type)) {
      if (unknownTrackKind(type) === 'third-party') {
        add('info', 'L23', `未知第三方轨道 ${type}：只读、字段不解释、保存原样写回`, memberPath(trackPath, 'type'))
      } else {
        add('block', 'L23', `未知的轨道类型: ${type}（parser 会拒绝）`, memberPath(trackPath, 'type'))
      }
    }
    const clips = track.clips
    if (!Array.isArray(clips)) {
      add('block', 'L08', '轨道 clips 缺失或不是数组', memberPath(trackPath, 'clips'))
      continue
    }
    const trackContexts: ClipContext[] = []
    for (let clipIndexInTrack = 0; clipIndexInTrack < clips.length; clipIndexInTrack += 1) {
      const clipPath = `${trackPath}.clips[${clipIndexInTrack}]`
      const context = readClipInto(clips[clipIndexInTrack], true, type, clipPath, ctx, issues)
      if (context === undefined) {
        continue
      }
      if (PINGPONG_REJECT_TRACKS.has(type) && readLoopMode(clips[clipIndexInTrack]) === 'pingpong') {
        add(severityForContract('L85'), 'L85', `${type} 轨道不支持 pingpong（该轨没有反向时间语义）`, memberPath(clipPath, 'loop_mode'))
      }
      trackContexts.push(context)
      clipContexts.push(context)
      const id = clipIdOf(context.clip)
      if (id !== undefined) {
        const previous = idSeen.get(id)
        if (previous !== undefined) {
          add('block', 'L18', `重复的片段 id: ${id}（出现于 ${previous} 与 ${clipPath}）`, memberPath(clipPath, 'id'), {
            ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
          })
        } else {
          idSeen.set(id, clipPath)
          clipIndex.set(id, context)
        }
      }
    }
    checkSubtitleOverlap(trackContexts, add)
  }

  // ── L09 / L18：独立片段 ──────────────────────────────────────────────────
  const standalone = doc.root.clips
  if (standalone !== undefined && !Array.isArray(standalone)) {
    add('block', 'L09', 'clips 需要数组（脚本级独立片段表）', 'clips')
  } else if (Array.isArray(standalone)) {
    const standaloneContexts: ClipContext[] = []
    for (let index = 0; index < standalone.length; index += 1) {
      const clipPath = `clips[${index}]`
      const raw = standalone[index]
      const trackType = isJsonObject(raw) && typeof raw.track === 'string' ? raw.track : ''
      if (trackType.length > 0 && !isKnownTrackType(ctx.catalog, trackType)
        && unknownTrackKind(trackType) === 'third-party') {
        add('info', 'L23', `未知第三方轨道 ${trackType}：只读、字段不解释、保存原样写回`, memberPath(clipPath, 'track'))
      }
      const context = readClipInto(raw, false, trackType, clipPath, ctx, issues)
      if (context === undefined) {
        continue
      }
      standaloneContexts.push(context)
      clipContexts.push(context)
      const id = clipIdOf(context.clip)
      if (id !== undefined) {
        const previous = idSeen.get(id)
        if (previous !== undefined) {
          add('block', 'L18', `重复的片段 id: ${id}（出现于 ${previous} 与 ${clipPath}）`, memberPath(clipPath, 'id'), {
            ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
          })
        } else {
          idSeen.set(id, clipPath)
          clipIndex.set(id, context)
        }
      }
    }
    checkSubtitleOverlap(standaloneContexts, add)
  }

  // ── L20 / L21 / L22 / L24：CAMERA 语义、requires、参考系切换对齐 ────────────
  for (const context of clipContexts) {
    checkRequires(context, ctx, add)
    if (context.trackType === 'CAMERA') {
      checkCameraSemantics(context, ctx, add)
      checkSpaceSwitches(context, add)
    }
    if (context.trackType === 'ADJUST') {
      checkAdjustSemantics(context, add)
    }
    checkOverlayFieldApplicability(context, ctx, add)
  }

  // ── L25–L28 / L33：paths[] ───────────────────────────────────────────────
  const paths = doc.root.paths
  if (paths !== undefined && !Array.isArray(paths)) {
    add('block', 'L25', 'paths 需要数组（路径集合）', 'paths')
  } else if (Array.isArray(paths)) {
    const pathIds = new Set<string>()
    const endpointPairs = new Set<string>()
    for (let index = 0; index < paths.length; index += 1) {
      const entryPath = `paths[${index}]`
      const entry = paths[index]
      if (!isJsonObject(entry)) {
        add('block', 'L25', '需要对象（路径条目）', entryPath)
        continue
      }
      const unknown = firstUnknownKey(entry, PATH_KEYS)
      if (unknown !== undefined) {
        add('block', 'L25', `未知键（可用: ${PATH_KEYS.join(' / ')}）`, memberPath(entryPath, unknown))
      }
      const id = entry.id
      if (typeof id !== 'string' || id.length === 0) {
        add('block', 'L25', '路径 id 缺失或不是非空字符串', memberPath(entryPath, 'id'))
      } else if (!RULE_ID_PATTERN.test(id)) {
        add('block', 'L25', `路径 id 必须匹配 ${RULE_ID_PATTERN.source}，实际: ${id}`, memberPath(entryPath, 'id'))
      } else if (pathIds.has(id)) {
        add('block', 'L25', `路径 id 重复: ${id}（脚本内必须唯一）`, memberPath(entryPath, 'id'))
      } else {
        pathIds.add(id)
      }

      const clipId = entry.clip
      const target = typeof clipId === 'string' ? clipIndex.get(clipId) : undefined
      if (typeof clipId !== 'string' || clipId.length === 0) {
        add('block', 'L25', 'clip 缺失或不是非空字符串（片段 id）', memberPath(entryPath, 'clip'))
      } else if (target === undefined) {
        add('block', 'L33', `未知片段引用: ${clipId}（宿主 ${entryPath}）`, memberPath(entryPath, 'clip'))
      } else if (!hasObjects(target.clip)) {
        add('block', 'L25', `路径集合只支持 objects 片段（目标片段 ${clipId} 没有 objects）`, memberPath(entryPath, 'clip'))
      }

      const from = entry.from
      const to = entry.to
      const fromValid = typeof from === 'number' && Number.isFinite(from)
      const toValid = typeof to === 'number' && Number.isFinite(to)
      if (!fromValid) {
        add('block', 'L25', 'from 缺失或不是有限数字', memberPath(entryPath, 'from'))
      }
      if (!toValid) {
        add('block', 'L25', 'to 缺失或不是有限数字', memberPath(entryPath, 'to'))
      }
      if (fromValid && toValid && !(from < to)) {
        add('block', 'L25', `to 必须大于 from（from=${from}, to=${to}）`, memberPath(entryPath, 'to'))
      }

      if (Object.prototype.hasOwnProperty.call(entry, 'axes')) {
        checkAxes(entry.axes, memberPath(entryPath, 'axes'), add)
      }
      checkGeometry(entry.geometry, memberPath(entryPath, 'geometry'), ctx.catalog, add)
      if (Object.prototype.hasOwnProperty.call(entry, 'timing')) {
        checkTiming(entry.timing, memberPath(entryPath, 'timing'), add)
      }

      if (target === undefined || typeof clipId !== 'string' || !fromValid || !toValid || !(from < to)) {
        continue
      }
      const nodes = clipPositionNodes(doc, clipId)
      const fromIndex = indexOfTime(nodes, from)
      const toIndex = indexOfTime(nodes, to)
      if (fromIndex < 0) {
        add(
          'block',
          'L26',
          `from 必须命中目标片段 ${clipId} 的 position 节点时间（可用: [${nodes.join(', ')}]，实际: ${from}）`,
          memberPath(entryPath, 'from'),
        )
      }
      if (toIndex < 0) {
        add(
          'block',
          'L26',
          `to 必须命中目标片段 ${clipId} 的 position 节点时间（可用: [${nodes.join(', ')}]，实际: ${to}）`,
          memberPath(entryPath, 'to'),
        )
      }
      if (fromIndex < 0 || toIndex < 0) {
        continue
      }
      if (toIndex !== fromIndex + 1) {
        const next = fromIndex + 1 < nodes.length ? String(nodes[fromIndex + 1]) : '（无）'
        add(
          'block',
          'L27',
          `端点必须与 from 相邻（from=${nodes[fromIndex]} 的下一个 position 节点时间 = ${next}，实际 to=${to}）`,
          memberPath(entryPath, 'to'),
        )
        continue
      }
      const pairKey = `${clipId}|${nodes[fromIndex]}|${nodes[toIndex]}`
      if (endpointPairs.has(pairKey)) {
        add(
          'block',
          'L28',
          `同一片段的端点对重复（clip=${clipId}, from=${nodes[fromIndex]}, to=${nodes[toIndex]}）`,
          memberPath(entryPath, 'from'),
        )
      } else {
        endpointPairs.add(pairKey)
      }
    }
  }

  // ── L29 / L33：rules[] ───────────────────────────────────────────────────
  const ruleIds = new Set<string>()
  const rules = doc.root.rules
  if (rules !== undefined && !Array.isArray(rules)) {
    add('block', 'L29', 'rules 需要数组（规则定义表）', 'rules')
  } else if (Array.isArray(rules)) {
    for (let index = 0; index < rules.length; index += 1) {
      const rulePath = `rules[${index}]`
      const rule = rules[index]
      if (!isJsonObject(rule)) {
        add('block', 'L29', '需要对象（规则定义）', rulePath)
        continue
      }
      const unknown = firstUnknownKey(rule, RULE_KEYS)
      if (unknown !== undefined) {
        add('block', 'L29', `未知键（可用: ${RULE_KEYS.join(' / ')}）`, memberPath(rulePath, unknown))
      }
      const id = rule.id
      if (typeof id !== 'string' || id.length === 0) {
        add('block', 'L29', '规则 id 缺失或不是非空字符串', memberPath(rulePath, 'id'))
      } else if (!RULE_ID_PATTERN.test(id)) {
        add('block', 'L29', `规则 id 必须匹配 ${RULE_ID_PATTERN.source}，实际: ${id}`, memberPath(rulePath, 'id'))
      } else if (ruleIds.has(id)) {
        add('block', 'L29', `重复的规则 id: ${id}`, memberPath(rulePath, 'id'))
      } else {
        ruleIds.add(id)
      }
      if (!isJsonObject(rule.condition)) {
        add('block', 'L29', 'condition 缺失或不是对象（条件树）', memberPath(rulePath, 'condition'))
      } else {
        checkCondition(rule.condition, memberPath(rulePath, 'condition'), add)
      }
      const actions = rule.actions
      const actionTypes = ctx.catalog.scriptEnum('action_types') ?? []
      if (!Array.isArray(actions) || actions.length === 0) {
        add('block', 'L29', 'actions 缺失、不是数组或为空（规则至少一个动作）', memberPath(rulePath, 'actions'))
      } else {
        checkActions(actions, memberPath(rulePath, 'actions'), actionTypes, add)
      }
      if (Object.prototype.hasOwnProperty.call(rule, 'policy')) {
        checkPolicy(rule.policy, memberPath(rulePath, 'policy'), actionTypes, add)
      }
    }
  }

  // ── L30 / L33：rule_bindings[] ───────────────────────────────────────────
  const bindingIds = new Set<string>()
  const bindings = doc.root.rule_bindings
  if (bindings !== undefined && !Array.isArray(bindings)) {
    add('block', 'L30', 'rule_bindings 需要数组（规则绑定表）', 'rule_bindings')
  } else if (Array.isArray(bindings)) {
    for (let index = 0; index < bindings.length; index += 1) {
      const bindingPath = `rule_bindings[${index}]`
      const binding = bindings[index]
      if (!isJsonObject(binding)) {
        add('block', 'L30', '需要对象（规则绑定）', bindingPath)
        continue
      }
      const unknown = firstUnknownKey(binding, BINDING_KEYS)
      if (unknown !== undefined) {
        add('block', 'L30', `未知键（可用: ${BINDING_KEYS.join(' / ')}）`, memberPath(bindingPath, unknown))
      }
      const id = binding.id
      if (typeof id !== 'string' || id.length === 0) {
        add('block', 'L30', '绑定 id 缺失或不是非空字符串', memberPath(bindingPath, 'id'))
      } else if (!RULE_ID_PATTERN.test(id)) {
        add('block', 'L30', `绑定 id 必须匹配 ${RULE_ID_PATTERN.source}，实际: ${id}`, memberPath(bindingPath, 'id'))
      } else if (bindingIds.has(id)) {
        add('block', 'L30', `重复的绑定 id: ${id}`, memberPath(bindingPath, 'id'))
      } else {
        bindingIds.add(id)
      }

      const ruleRef = binding.rule
      if (typeof ruleRef !== 'string' || ruleRef.length === 0) {
        add('block', 'L30', 'rule 缺失或不是非空字符串（规则 id）', memberPath(bindingPath, 'rule'))
      } else if (!ruleIds.has(ruleRef)) {
        add('block', 'L33', `未知规则引用: ${ruleRef}`, memberPath(bindingPath, 'rule'))
      }

      const clipRef = binding.clip
      const target = typeof clipRef === 'string' ? clipIndex.get(clipRef) : undefined
      if (typeof clipRef !== 'string' || clipRef.length === 0) {
        add('block', 'L30', 'clip 缺失或不是非空字符串（片段 id）', memberPath(bindingPath, 'clip'))
      } else if (target === undefined) {
        add('block', 'L33', `未知片段引用: ${clipRef}`, memberPath(bindingPath, 'clip'))
      }

      checkGate(binding.gate, memberPath(bindingPath, 'gate'), target, add)
      if (Object.prototype.hasOwnProperty.call(binding, 'control')) {
        const control = binding.control
        if (control !== 'observe' && control !== 'hold') {
          add('block', 'L30', `control 需要 observe / hold，实际: ${String(control)}`, memberPath(bindingPath, 'control'))
        }
      }
      if (Object.prototype.hasOwnProperty.call(binding, 'schedule')) {
        checkSchedule(binding.schedule, memberPath(bindingPath, 'schedule'), bindingIds, add)
      }
      if (Object.prototype.hasOwnProperty.call(binding, 'exit')) {
        const exitResult = readExit(binding.exit, memberPath(bindingPath, 'exit'))
        for (const problem of exitResult.problems) {
          issues.push({ ...problem, source: 'local' })
        }
      }
    }
  }

  // ── L32：meta.triggers ───────────────────────────────────────────────────
  checkTriggers(meta, ctx, add)

  // ── L33：片段 exit / schedule 引用（parser 级） ──────────────────────────
  for (const context of clipContexts) {
    const exit = context.clip.exit
    if (isJsonObject(exit) && exit.on_complete === 'goto' && typeof exit.target === 'string') {
      if (!clipIndex.has(exit.target)) {
        add(
          'block',
          'L33',
          `未知片段引用: ${exit.target}（宿主 ${context.jsonPath}.exit）`,
          memberPath(memberPath(context.jsonPath, 'exit'), 'target'),
          context.clipKey === undefined ? {} : { clipKey: context.clipKey },
        )
      }
    }
  }

  // ── L34：根未知键（info，保留原样） ──────────────────────────────────────
  for (const key of Object.keys(doc.root)) {
    if (key === 'meta' || key === 'timeline' || key === 'clips' || key === 'paths'
      || key === 'rules' || key === 'rule_bindings') {
      continue
    }
    add('info', 'L34', `根键 ${key} 运行时忽略；编辑器保留原样（不删、不改）`, key)
  }

  // ── 11 轮行为合同（L35–L90）：规则 / 绑定 / 触发器 / 事件 / 事实引用 ────────
  const clipDurations = new Map<string, number>()
  for (const [clipId, context] of clipIndex) {
    clipDurations.set(clipId, context.shape.duration)
  }
  const behaviorRefs: BehaviorRefs = {
    clipIds: new Set(clipIndex.keys()),
    clipDurations,
    ruleIds,
    bindingIds,
  }

  // 前置 / 事实跨脚本存在性：索引转发给域层；未提供索引时域层降级 unresolved（不阻断）。
  const selfScriptId = typeof meta.id === 'string' && meta.id.length > 0 ? meta.id : undefined
  const knownScriptSet = new Set<string>(ctx.knownScriptIds ?? [])

  appendBehaviorProblems(issues, validateRules(doc.root, behaviorRefs))
  appendBehaviorProblems(issues, validateBindings(doc.root, behaviorRefs))

  // 触发器：身份 / 时序适用性 / 条件树 / 前置条目。
  const triggerRaw = meta.triggers
  if (Array.isArray(triggerRaw)) {
    const triggerNodes = triggerRaw
      .filter(isJsonObject)
      .map((raw, index) => parseTriggerNode(raw, index))
    const duplicateTriggerIds = findDuplicateIds(triggerNodes)
    for (const [triggerId, indexes] of duplicateTriggerIds) {
      for (const index of indexes) {
        add(severityForContract('L42'), 'L42', `重复的触发器 id: ${triggerId}`, `meta.triggers[${index}].id`)
      }
    }
    const requirementCtx = {
      selfScriptId,
      knownScriptIds: ctx.knownScriptIds ?? [],
    }
    triggerRaw.forEach((raw, index) => {
      const triggerPath = `meta.triggers[${index}]`
      if (!isJsonObject(raw)) {
        add(severityForContract('L40'), 'L40', '触发器需要对象', triggerPath)
        return
      }
      const rawId = raw.id
      if (rawId !== undefined && (typeof rawId !== 'string' || !TRIGGER_ID_PATTERN.test(rawId))) {
        add(severityForContract('L42'), 'L42', `触发器 id 必须匹配 ${TRIGGER_ID_PATTERN.source}，实际: ${String(rawId)}`, `${triggerPath}.id`)
      }
      const node = parseTriggerNode(raw, index)
      appendBehaviorProblems(issues, triggerTimingIssues(node))
      appendBehaviorProblems(issues, validateTriggerConditions(node, requirementCtx))
      requirementEntries(node).forEach((entry, entryIndex) => {
        const entryPath = `${triggerPath}.requires[${entryIndex}]`
        if (entry.kind === 'object') {
          appendBehaviorProblems(issues, validateRequirementFields(entry.type, entry.data, entryPath, requirementCtx))
          return
        }
        if (entry.kind === 'string') {
          appendBehaviorProblems(issues, validateStringRequirement(entry, entryPath, requirementCtx))
          return
        }
        if (entry.kind === 'malformed') {
          appendBehaviorProblems(issues, [{
            code: 'REQ_TYPE_MISSING',
            severity: 'error',
            message: '前置条目形态非法（字符串脚本 id 或对象型前置条件）',
            jsonPath: entryPath,
          }])
        }
      })
    })
  }

  // 事件记录：EVENT / MOD_EVENT 记录体、同刻冲突、超时长、多轨、乒乓事件轨。
  for (const eventNode of eventRecords(doc.root)) {
    appendBehaviorProblems(issues, eventNode.problems)
  }

  // 事实引用：规则事实自引用 / 成环 / 冻结态不可达 / 缺失引用。
  const factResult = factIndex(doc.root, {
    scriptIds: knownScriptSet,
    clipIds: behaviorRefs.clipIds,
    bindingIds: behaviorRefs.bindingIds,
    ...(selfScriptId === undefined ? {} : { selfScriptId }),
  })
  appendBehaviorProblems(issues, factResult.diagnostics)

  return issues
}

/** `position` 节点时间定位（`PathCollectionParser.indexOfTime`：精确优先，其次 1e-4）。 */
function indexOfTime(times: readonly number[], value: number): number {
  for (let index = 0; index < times.length; index += 1) {
    if (times[index] === value) {
      return index
    }
  }
  return -1
}

/** `axes`：数组、非空、x/y/z 子集、去重无关。 */
function checkAxes(
  raw: JsonValue,
  jsonPath: string,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!Array.isArray(raw) || raw.length === 0) {
    add('block', 'L25', 'axes 需要非空数组（x / y / z 的子集）', jsonPath)
    return
  }
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (typeof item !== 'string' || !['x', 'y', 'z'].includes(item)) {
      add('block', 'L25', `未知轴 ${String(item)}（可选: x, y, z）`, `${jsonPath}[${index}]`)
    }
  }
}

/** `geometry`：必填对象 + 已注册类型；参数数量/范围/非零/非平行由 07-06 校验。 */
function checkGeometry(
  raw: JsonValue,
  jsonPath: string,
  catalog: CatalogIndex,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!isJsonObject(raw)) {
    add('block', 'L25', 'geometry 缺失或不是对象 {type, ...参数}', jsonPath)
    return
  }
  const type = raw.type
  if (typeof type !== 'string' || type.length === 0) {
    add('block', 'L25', 'geometry.type 缺失或不是非空字符串', memberPath(jsonPath, 'type'))
    return
  }
  if (type !== 'line' && catalog.curveType(type) === undefined) {
    add('error', 'L25', `未知曲线类型: ${type}（不回落 line）`, memberPath(jsonPath, 'type'))
    return
  }
  for (const issue of validateGeometry(raw, jsonPath)) {
    add(issue.message.startsWith('未知曲线类型') ? 'error' : 'block', 'L25', issue.message, issue.field)
  }
}

/** `timing`：`linear` 或 `keyframes`（07-08：首末 (0,0)/(1,1)、非减、[0,1]、相等合法）。 */
function checkTiming(
  raw: JsonValue,
  jsonPath: string,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  for (const issue of validateTiming(raw, jsonPath)) {
    add('block', 'L28', issue.message, issue.field)
  }
}

/** 条件树结构：`type` 字符串；组合器 `list` 非空、子项 `{type, conditions}`。 */
function checkCondition(
  node: JsonValue,
  jsonPath: string,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
  depth = 1,
): void {
  if (!isJsonObject(node)) {
    add('block', 'L29', '条件节点需要对象', jsonPath)
    return
  }
  const type = node.type
  if (typeof type !== 'string' || type.length === 0) {
    add('block', 'L29', '条件节点缺少非空字符串 type', memberPath(jsonPath, 'type'))
    return
  }
  if (type !== 'all_of' && type !== 'any') {
    return
  }
  if (depth > 16) {
    add('block', 'L29', '条件组合器嵌套超过 16 层', jsonPath)
    return
  }
  const list = node.list
  if (!Array.isArray(list) || list.length === 0) {
    add('block', 'L29', `${type} 需要非空 list`, memberPath(jsonPath, 'list'))
    return
  }
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index]
    const itemPath = `${memberPath(jsonPath, 'list')}[${index}]`
    if (!isJsonObject(item)) {
      add('block', 'L29', '组合器子项需要对象 {type, conditions}', itemPath)
      continue
    }
    const subType = item.type
    if (typeof subType !== 'string' || subType.length === 0) {
      add('block', 'L29', '组合器子项缺少非空字符串 type', memberPath(itemPath, 'type'))
      continue
    }
    if (Object.prototype.hasOwnProperty.call(item, 'conditions') && !isJsonObject(item.conditions)) {
      add('block', 'L29', 'conditions 必须是对象', memberPath(itemPath, 'conditions'))
      continue
    }
    if (subType === 'all_of' || subType === 'any') {
      checkCondition(item.conditions ?? {}, memberPath(itemPath, 'conditions'), add, depth + 1)
      continue
    }
    if (item.conditions !== undefined) {
      checkCondition({ ...(isJsonObject(item.conditions) ? item.conditions : {}), type: subType },
        memberPath(itemPath, 'conditions'), add, depth + 1)
    }
  }
}

/** 动作数组：元素对象 + 非空字符串 type + 类型白名单（02 目录 `action_types`）。 */
function checkActions(
  actions: JsonValue[],
  jsonPath: string,
  actionTypes: readonly string[],
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    const actionPath = `${jsonPath}[${index}]`
    if (!isJsonObject(action)) {
      add('block', 'L29', '动作元素需要对象', actionPath)
      continue
    }
    const type = action.type
    if (typeof type !== 'string' || type.length === 0) {
      add('block', 'L29', '动作元素缺少非空字符串 type', memberPath(actionPath, 'type'))
      continue
    }
    if (actionTypes.length > 0 && !actionTypes.includes(type)) {
      add('error', 'L29', `未知动作: ${type}（可选: ${actionTypes.join(' / ')}）`, memberPath(actionPath, 'type'))
    }
  }
}

/** 规则策略：键白名单 + 各字段取值（`RuleCollectionParser.parseDefinition`）。 */
function checkPolicy(
  raw: JsonValue,
  jsonPath: string,
  actionTypes: readonly string[],
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!isJsonObject(raw)) {
    add('block', 'L29', `policy 需要对象（字段: ${RULE_POLICY_KEYS.join(' / ')}）`, jsonPath)
    return
  }
  const unknown = firstUnknownKey(raw, RULE_POLICY_KEYS)
  if (unknown !== undefined) {
    add('block', 'L29', `未知键（可用: ${RULE_POLICY_KEYS.join(' / ')}）`, memberPath(jsonPath, unknown))
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'once') && typeof raw.once !== 'boolean') {
    add('block', 'L29', 'once 需要布尔值', memberPath(jsonPath, 'once'))
  }
  for (const key of ['cooldown', 'dwell']) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      continue
    }
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      add('block', 'L29', `${key} 需要 >= 0 的有限数字（秒）`, memberPath(jsonPath, key))
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'mode')) {
    const mode = raw.mode
    if (mode !== 'enter' && mode !== 'dwell') {
      add('block', 'L29', `mode 需要 enter / dwell，实际: ${String(mode)}`, memberPath(jsonPath, 'mode'))
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'timeout')) {
    const timeout = raw.timeout
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || (timeout !== -1 && !(timeout > 0))) {
      add('block', 'L29', 'timeout 需要 > 0 的有限数字或 -1（无限等待）', memberPath(jsonPath, 'timeout'))
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'on_timeout')) {
    const actions = raw.on_timeout
    if (!Array.isArray(actions)) {
      add('block', 'L29', 'on_timeout 需要数组', memberPath(jsonPath, 'on_timeout'))
    } else {
      checkActions(actions, memberPath(jsonPath, 'on_timeout'), actionTypes, add)
    }
  }
}

/** `gate`：对象 + 只有 at + 有限数字 ≥0；有限片段 at 不得超过 duration。 */
function checkGate(
  raw: JsonValue,
  jsonPath: string,
  target: ClipContext | undefined,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!isJsonObject(raw)) {
    add('block', 'L30', 'gate 缺失或不是对象 {"at": <秒>}', jsonPath)
    return
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'at') {
      add('block', 'L30', '未知键（gate 只有 at）', memberPath(jsonPath, key))
    }
  }
  const at = raw.at
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
    add('block', 'L30', 'gate.at 需要 >= 0 的有限数字', memberPath(jsonPath, 'at'))
    return
  }
  if (target === undefined) {
    return
  }
  const duration = target.shape.duration
  if (duration > 0 && at > duration) {
    add(
      'block',
      'L30',
      `gate.at 越界: ${at}（片段 ${target.shape.id ?? target.jsonPath} 时长 ${duration}，允许范围 0 ~ ${duration}）`,
      memberPath(jsonPath, 'at'),
    )
  }
}

/** `schedule`：`on` 枚举 + 各形态参数 + 键白名单（`RuleSchedule.validate`）。 */
function checkSchedule(
  raw: JsonValue,
  jsonPath: string,
  bindingIds: ReadonlySet<string>,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!isJsonObject(raw)) {
    add('block', 'L30', `schedule 需要对象（释放条件: ${SCHEDULE_KINDS.join(' / ')}）`, jsonPath)
    return
  }
  const on = raw.on
  if (typeof on !== 'string') {
    add('block', 'L30', `schedule.on 缺失或不是字符串（可选: ${SCHEDULE_KINDS.join(' / ')}）`, memberPath(jsonPath, 'on'))
    return
  }
  const allowed: Record<string, readonly string[]> = {
    clip_start: ['on', 'clip'],
    clip_complete: ['on', 'clip'],
    local_time: ['on', 'clip', 'at'],
    delay: ['on', 'seconds'],
    fact: ['on', 'binding', 'fact'],
  }
  if (!SCHEDULE_KINDS.includes(on)) {
    add('block', 'L30', `schedule.on 未知释放条件: ${on}（可选: ${SCHEDULE_KINDS.join(' / ')}）`, memberPath(jsonPath, 'on'))
    return
  }
  const unknown = firstUnknownKey(raw, allowed[on])
  if (unknown !== undefined) {
    add('block', 'L30', `未知键（可用: ${allowed[on].join(' / ')}）`, memberPath(jsonPath, unknown))
  }
  if (on === 'clip_start' || on === 'clip_complete' || on === 'local_time') {
    if (typeof raw.clip !== 'string' || raw.clip.length === 0) {
      add('block', 'L30', 'clip 缺失或不是非空字符串（目标片段 id）', memberPath(jsonPath, 'clip'))
    }
  }
  if (on === 'local_time') {
    const at = raw.at
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
      add('block', 'L30', 'at 需要 >= 0 的有限数字（目标片段执行局部秒）', memberPath(jsonPath, 'at'))
    }
  }
  if (on === 'delay') {
    const seconds = raw.seconds
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      add('block', 'L30', 'seconds 需要 >= 0 的有限数字', memberPath(jsonPath, 'seconds'))
    }
  }
  if (on === 'fact') {
    const binding = raw.binding
    if (typeof binding !== 'string' || binding.length === 0) {
      add('block', 'L30', 'binding 缺失或不是非空字符串（来源绑定 id）', memberPath(jsonPath, 'binding'))
    } else if (!bindingIds.has(binding)) {
      add('block', 'L33', `未知绑定引用: ${binding}`, memberPath(jsonPath, 'binding'))
    }
    const fact = raw.fact
    if (fact !== 'succeeded' && fact !== 'action_completed') {
      add('block', 'L30', 'fact 需要 succeeded / action_completed', memberPath(jsonPath, 'fact'))
    }
  }
}

/** `meta.triggers`：类型 / 条件 / requires / continuity / poll_interval。 */
function checkTriggers(
  meta: JsonObject,
  ctx: StructuralContext,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!Object.prototype.hasOwnProperty.call(meta, 'triggers')) {
    return
  }
  const triggers = meta.triggers
  if (!Array.isArray(triggers)) {
    add('error', 'L32', 'meta.triggers 不是数组（运行时忽略该字段）', 'meta.triggers')
    return
  }
  const ids = new Set<string>()
  for (let index = 0; index < triggers.length; index += 1) {
    const triggerPath = `meta.triggers[${index}]`
    const trigger = triggers[index]
    if (!isJsonObject(trigger)) {
      add('block', 'L32', '触发器需要对象', triggerPath)
      continue
    }
    const type = trigger.type
    if (typeof type !== 'string' || type.length === 0) {
      add('block', 'L32', '触发器缺少非空字符串 type', memberPath(triggerPath, 'type'))
      continue
    }
    if (ctx.catalog.trigger(type) === undefined) {
      add('error', 'L32', `未知触发器类型: ${type}`, memberPath(triggerPath, 'type'))
    }
    if (Object.prototype.hasOwnProperty.call(trigger, 'id')) {
      const id = trigger.id
      if (typeof id !== 'string' || id.length === 0) {
        add('block', 'L32', '触发器 id 需要非空字符串', memberPath(triggerPath, 'id'))
      } else if (!RULE_ID_PATTERN.test(id)) {
        add('error', 'L32', `触发器 id 不合法: ${id}（需匹配 ${RULE_ID_PATTERN.source}）`, memberPath(triggerPath, 'id'))
      } else if (ids.has(id)) {
        add('error', 'L32', `触发器 id 重复: ${id}`, memberPath(triggerPath, 'id'))
      } else {
        ids.add(id)
      }
    }
    if (Object.prototype.hasOwnProperty.call(trigger, 'conditions') && !isJsonObject(trigger.conditions)) {
      add('block', 'L32', 'conditions 必须是对象', memberPath(triggerPath, 'conditions'))
    }
    for (const key of ['repeatable', 'on_enter']) {
      if (Object.prototype.hasOwnProperty.call(trigger, key) && typeof trigger[key] !== 'boolean') {
        add('block', 'L32', `${key} 需要布尔值`, memberPath(triggerPath, key))
      }
    }
    for (const key of ['delay', 'exit_buffer']) {
      if (Object.prototype.hasOwnProperty.call(trigger, key)) {
        const value = trigger[key]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          add('block', 'L32', `${key} 需要有限数字`, memberPath(triggerPath, key))
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(trigger, 'requires')) {
      checkTriggerRequires(trigger.requires, memberPath(triggerPath, 'requires'), add)
    }
    if (Object.prototype.hasOwnProperty.call(trigger, 'continuity')) {
      checkContinuity(trigger.continuity, memberPath(triggerPath, 'continuity'), add)
    }
    if (Object.prototype.hasOwnProperty.call(trigger, 'poll_interval')) {
      const value = trigger.poll_interval
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 600) {
        add('error', 'L32', 'poll_interval 需要 1~600 的整数（tick）', memberPath(triggerPath, 'poll_interval'))
      }
    }
  }
}

/** `requires`：数组；元素 = 非空字符串或带字符串 type 的对象。 */
function checkTriggerRequires(
  raw: JsonValue,
  jsonPath: string,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!Array.isArray(raw)) {
    add('block', 'L32', 'requires 必须是数组', jsonPath)
    return
  }
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    const itemPath = `${jsonPath}[${index}]`
    if (typeof item === 'string') {
      if (item.length === 0) {
        add('block', 'L32', '前置脚本 id 不能为空', itemPath)
      }
      continue
    }
    if (!isJsonObject(item)) {
      add('block', 'L32', 'requires 元素必须是字符串脚本 id 或对象型前置条件', itemPath)
      continue
    }
    if (typeof item.type !== 'string' || item.type.length === 0) {
      add('block', 'L32', '对象型前置条件必须包含非空字符串 type', memberPath(itemPath, 'type'))
    }
  }
}

/** `continuity`：对象；sweep 布尔；dwell / window 整数 0~1200。 */
function checkContinuity(
  raw: JsonValue,
  jsonPath: string,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (!isJsonObject(raw)) {
    add('block', 'L32', 'continuity 必须是对象', jsonPath)
    return
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'sweep') && typeof raw.sweep !== 'boolean') {
    add('block', 'L32', 'sweep 必须是布尔值', memberPath(jsonPath, 'sweep'))
  }
  for (const key of ['dwell', 'window']) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      continue
    }
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1200) {
      add('block', 'L32', `${key} 需要 0~1200 的整数（tick）`, memberPath(jsonPath, key))
    }
  }
}

/** `requires` 求值与告警（L22）：属性写了但前置不满足。 */
function checkRequires(
  context: ClipContext,
  ctx: StructuralContext,
  add: (severity: Severity, code: string, message: string, jsonPath: string, extra?: IssueExtra) => void,
): void {
  const defs = ctx.catalog.track(context.trackType)?.objects ?? []
  const objectPathBase = memberPath(context.jsonPath, 'objects')
  for (const def of defs) {
    if (def.requires === undefined) {
      continue
    }
    const propertyPath = memberPath(objectPathBase, def.key)
    if (context.shape.objects[def.key] === undefined) {
      continue
    }
    const parsed = parseRequires(def.requires)
    if (parsed === undefined || parsed.value.length === 0 || !isValidObjectPath(parsed.path)) {
      add('error', 'L22', `requires 表达式非法（只支持 path=value / path!=value）: ${def.requires}`, propertyPath, {
        ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
        objectPath: def.key,
      })
      continue
    }
    const referenced = ctx.catalog.objectDef(context.trackType, parsed.path)
    const actual = staticToken(context.shape, referenced, parsed.path)
    const equal = requiresSatisfied(actual, parsed.value)
    const satisfied = parsed.negate ? !equal : equal
    if (!satisfied) {
      add(
        'error',
        'L22',
        `写了但前置条件不满足（requires=${def.requires}，当前 ${parsed.path}=${actual}）`,
        propertyPath,
        {
          ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
          objectPath: def.key,
        },
      )
    }
  }
}

/** 取一个属性的 t=0 有效值（首帧 > value > 目录默认值）。 */
function effectiveValue(context: ClipContext, ctx: StructuralContext, path: string): string {
  const def = ctx.catalog.objectDef(context.trackType, path)
  return staticToken(context.shape, def, path)
}

/**
 * CAMERA 点源 / 朝向语义（L20）：parser 接受、`ObjectValidator` 报错。
 *
 * 只覆盖跨字段硬约束；单字段枚举 / 范围已在 `readClip` 的值检查里。
 */
function checkCameraSemantics(
  context: ClipContext,
  ctx: StructuralContext,
  add: (severity: Severity, code: string, message: string, jsonPath: string, extra?: IssueExtra) => void,
): void {
  const mode = effectiveValue(context, ctx, 'position_mode')
  const space = effectiveValue(context, ctx, 'position_space')
  const origin = effectiveValue(context, ctx, 'position_origin')
  const objectsPath = memberPath(context.jsonPath, 'objects')
  const extra: IssueExtra = context.clipKey === undefined ? {} : { clipKey: context.clipKey }

  if (mode === 'absolute') {
    if (origin.length > 0 && origin !== 'null') {
      add('error', 'L20', 'position_mode=absolute 时 position_origin 必须为空', memberPath(objectsPath, 'position_origin'), {
        ...extra,
        objectPath: 'position_origin',
      })
    }
    if (space === 'base') {
      add('error', 'L20', 'position_mode=absolute 不允许 position_space=base', memberPath(objectsPath, 'position_space'), {
        ...extra,
        objectPath: 'position_space',
      })
    }
  }

  if (space !== 'base') {
    for (const path of ['facing_source', 'facing_target', 'facing_entity']) {
      if (context.shape.objects[path] !== undefined) {
        add('error', 'L20', `${path}: 写了但 position_space=world 不读取（已忽略）`, memberPath(objectsPath, path), {
          ...extra,
          objectPath: path,
        })
      }
    }
  }

  const zoom = context.shape.objects.zoom
  if (zoom !== undefined) {
    const value = Object.prototype.hasOwnProperty.call(zoom, 'value') ? zoom.value : undefined
    if (typeof value === 'number' && value <= 0) {
      add('error', 'L21', '缩放必须为正', memberPath(objectsPath, 'zoom.value'), {
        ...extra,
        objectPath: 'zoom',
      })
    }
  }
}

/** 片段是否为 OVERLAY 字幕层（`layer_type=subtitle`，取 t=0 有效值）。 */
function isSubtitleClip(context: ClipContext): boolean {
  if (context.trackType !== 'OVERLAY') {
    return false
  }
  const property = context.shape.objects.layer_type
  if (property === undefined) {
    return false
  }
  let token = 'fade'
  const frames = property.keyframes ?? []
  if (frames.length > 0) {
    token = tokenOf(frames[0].value)
  } else if (Object.prototype.hasOwnProperty.call(property, 'value')) {
    token = tokenOf(property.value)
  }
  return token === 'subtitle'
}

/**
 * 同轨字幕片段 `[start,end)` 重叠 → block L91。
 *
 * 只比对传入的同一轨道内片段（跨轨重叠由调用方分组隔离，不在此误报）；
 * 半开区间，端点相接不算重叠。issue 定位到后出现片段的 `start_time`。
 */
function checkSubtitleOverlap(
  contexts: readonly ClipContext[],
  add: (severity: Severity, code: string, message: string, jsonPath: string, extra?: IssueExtra) => void,
): void {
  const subtitles = contexts.filter(isSubtitleClip)
  for (let later = 0; later < subtitles.length; later += 1) {
    const right = subtitles[later]
    const rightStart = right.shape.startTime ?? 0
    const rightEnd = right.shape.duration < 0 ? Number.POSITIVE_INFINITY : rightStart + right.shape.duration
    for (let earlier = 0; earlier < later; earlier += 1) {
      const left = subtitles[earlier]
      const leftStart = left.shape.startTime ?? 0
      const leftEnd = left.shape.duration < 0 ? Number.POSITIVE_INFINITY : leftStart + left.shape.duration
      const overlapStart = Math.max(leftStart, rightStart)
      const overlapEnd = Math.min(leftEnd, rightEnd)
      if (overlapEnd - overlapStart <= 1e-9) {
        continue
      }
      const leftLabel = left.shape.id ?? left.jsonPath
      add(
        'block',
        'L91',
        `同轨字幕片段重叠：与片段「${leftLabel}」在 ${overlapStart.toFixed(3)}–${overlapEnd.toFixed(3)}s 区间重叠（同轨字幕必须分轨）`,
        memberPath(right.jsonPath, 'start_time'),
        {
          ...(right.clipKey === undefined ? {} : { clipKey: right.clipKey }),
          objectPath: 'layer_type',
        },
      )
    }
  }
}

/** 取 OVERLAY 片段 t=0 生效层类型；非 OVERLAY 或 layer_type 非法返回 null（非法枚举另由 def 校验报）。 */
function effectiveOverlayLayerType(context: ClipContext): OverlayLayerType | null {
  if (context.trackType !== 'OVERLAY') {
    return null
  }
  const property = context.shape.objects.layer_type
  let token = 'fade'
  if (property !== undefined) {
    const frames = property.keyframes ?? []
    if (frames.length > 0) {
      token = tokenOf(frames[0].value)
    } else if (Object.prototype.hasOwnProperty.call(property, 'value')) {
      token = tokenOf(property.value)
    }
  }
  return isOverlayLayerType(token) ? token : null
}

/**
 * L93：OVERLAY 片段写了当前层类型字段面之外的已登记对象路径 → block。
 *
 * 字段面矩阵与 `features/overlay/layers.ts` 的 `OVERLAY_FIELD_PATHS` 同源；未登记路径
 * 仍由 readClip 的 L34 拦截，本检查只覆盖「已登记但不适用于当前 layer_type」
 * （09-01 §4.4：字段存在但当前层类型不在适用范围 → 拦截，定位到 objects.<字段>）。
 */
function checkOverlayFieldApplicability(
  context: ClipContext,
  ctx: StructuralContext,
  add: (severity: Severity, code: string, message: string, jsonPath: string, extra?: IssueExtra) => void,
): void {
  const layerType = effectiveOverlayLayerType(context)
  if (layerType === null) {
    return
  }
  const objectsPath = memberPath(context.jsonPath, 'objects')
  for (const path of Object.keys(context.shape.objects)) {
    if (path === 'layer_type') {
      continue
    }
    if (ctx.catalog.objectDef(context.trackType, path) === undefined) {
      continue // 未登记路径由 L34 拦截，不在此重复报
    }
    if (isOverlayFieldApplicable(layerType, path)) {
      continue
    }
    add(
      'block',
      'L93',
      `字段 ${path} 不适用于 ${layerType} 层（该层运行时不读取）`,
      memberPath(objectsPath, path),
      {
        ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
        objectPath: path,
      },
    )
  }
}

/** ADJUST 语义（L21）：`lut_input_gamma` 必须 > 0。 */
function checkAdjustSemantics(
  context: ClipContext,
  add: (severity: Severity, code: string, message: string, jsonPath: string, extra?: IssueExtra) => void,
): void {
  const gamma = context.shape.objects.lut_input_gamma
  if (gamma === undefined) {
    return
  }
  const value = Object.prototype.hasOwnProperty.call(gamma, 'value') ? gamma.value : undefined
  if (typeof value === 'number' && value <= 0) {
    add('error', 'L21', 'lut_input_gamma 必须 > 0', memberPath(memberPath(context.jsonPath, 'objects'), 'lut_input_gamma.value'), {
      ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
      objectPath: 'lut_input_gamma',
    })
  }
}

/** meta 的跨字段 / 范围语义（L04）：与 `ScriptParser` + `ScriptValidator` 同口径。 */
function checkMetaExtras(
  meta: JsonObject,
  add: (severity: Severity, code: string, message: string, jsonPath: string) => void,
): void {
  if (Object.prototype.hasOwnProperty.call(meta, 'skip_vote_ratio') && meta.skip_vote_ratio !== null) {
    const value = meta.skip_vote_ratio
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 10 || value > 100) {
      add('block', 'L04', 'skip_vote_ratio 需要 10~100 的整数（parser 直接拒绝）', 'meta.skip_vote_ratio')
    }
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'trigger_poll_interval') && meta.trigger_poll_interval !== null) {
    const value = meta.trigger_poll_interval
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 600) {
      add('error', 'L04', 'trigger_poll_interval 需要 1~600 的整数（tick）', 'meta.trigger_poll_interval')
    }
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'macro_loop_count')) {
    const value = meta.macro_loop_count
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      add('error', 'L04', 'macro_loop_count 需要整数（-1=无限重复，正整数=重复次数）', 'meta.macro_loop_count')
    } else if (value === 0) {
      add('error', 'L04', 'macro_loop_count 不允许为 0（1 = 只播一遍）', 'meta.macro_loop_count')
    } else if (value < -1) {
      add('error', 'L04', 'macro_loop_count 只能为 -1 或正整数', 'meta.macro_loop_count')
    }
  }
  if (meta.macro_loop === true && meta.hold_at_end === true) {
    add('error', 'L04', 'macro_loop 与 hold_at_end 同时开启（互斥）', 'meta.macro_loop')
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'macro_loop_mode')) {
    const mode = meta.macro_loop_mode
    if (mode !== 'repeat' && mode !== 'pingpong') {
      add('error', 'L04', `macro_loop_mode 未知值: ${String(mode)}（可选: repeat / pingpong）`, 'meta.macro_loop_mode')
    }
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'play_mode')) {
    const mode = meta.play_mode
    if (mode !== 'parallel' && mode !== 'exclusive' && mode !== 'interruptible') {
      add('error', 'L04', `play_mode 未知值: ${String(mode)}（可选: parallel / exclusive / interruptible）`, 'meta.play_mode')
    }
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'base_resolution') && meta.base_resolution !== null) {
    const base = meta.base_resolution
    if (!isJsonObject(base)) {
      add('error', 'L04', 'base_resolution 需要对象 {w, h}（像素，正整数）', 'meta.base_resolution')
    } else {
      for (const key of ['w', 'h']) {
        const value = base[key]
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 2147483647) {
          add('error', 'L04', `base_resolution.${key} 超出范围 1 ~ 2147483647（int 表示范围）`, `meta.base_resolution.${key}`)
        }
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'screen_layers') && meta.screen_layers !== null) {
    const layers = meta.screen_layers
    if (!isJsonObject(layers)) {
      add('error', 'L04', 'screen_layers 需要对象 {层名: 布尔}', 'meta.screen_layers')
    } else {
      for (const [key, value] of Object.entries(layers)) {
        if (typeof value !== 'boolean') {
          add('error', 'L04', `screen_layers['${key}'] 需要布尔值（true = 显示，false = 隐藏）`, `meta.screen_layers.${key}`)
        }
      }
    }
  }
}

/** 参考系切换对齐（L24）：step 对象的变化点必须有 position.x/y/z 三轴关键帧。 */
function checkSpaceSwitches(
  context: ClipContext,
  add: (severity: Severity, code: string, message: string, jsonPath: string, extra?: IssueExtra) => void,
): void {
  const changes = new Map<number, string>()
  for (const path of SPACE_SWITCH_FIELDS) {
    collectChanges(context.shape, path, changes, () => true)
  }
  for (const path of BASE_SWITCH_FIELDS) {
    collectChanges(context.shape, path, changes, (time) => spaceAt(context.shape, time) === 'base')
  }
  const objectsPath = memberPath(context.jsonPath, 'objects')
  for (const [time, path] of changes) {
    const missing = POSITION_AXIS_PATHS.filter((axis) => !hasKeyframeAt(context.shape, axis, time))
    if (missing.length === 0) {
      continue
    }
    add(
      'error',
      'L24',
      `参考系切换缺少 ${missing.join(' / ')} 关键帧（time=${time}）`,
      memberPath(objectsPath, path),
      {
        ...(context.clipKey === undefined ? {} : { clipKey: context.clipKey }),
        objectPath: path,
        keyframeTime: time,
      },
    )
  }
}

/** 收集一个 step 属性的变化点（time > 0，值 token 变化）。 */
function collectChanges(
  shape: ClipShape,
  path: string,
  changes: Map<number, string>,
  accept: (time: number) => boolean,
): void {
  const property = shape.objects[path]
  if (property === undefined) {
    return
  }
  const frames = property.keyframes ?? []
  let previous = Object.prototype.hasOwnProperty.call(property, 'value')
    ? tokenOf(property.value)
    : tokenOf(undefined)
  if (frames.length > 0) {
    previous = tokenOf(frames[0].value)
  }
  for (const frame of frames) {
    if (frame.time <= 0) {
      previous = tokenOf(frame.value)
      continue
    }
    const token = tokenOf(frame.value)
    if (token !== previous && accept(frame.time)) {
      if (!changes.has(frame.time)) {
        changes.set(frame.time, path)
      }
      previous = token
    }
  }
}

/** 某时刻的 `position_space` 值（首帧 > value > 默认 world）。 */
function spaceAt(shape: ClipShape, time: number): string {
  const property = shape.objects.position_space
  if (property === undefined) {
    return 'world'
  }
  let value = Object.prototype.hasOwnProperty.call(property, 'value') ? tokenOf(property.value) : 'world'
  for (const frame of property.keyframes ?? []) {
    if (frame.time <= time) {
      value = tokenOf(frame.value)
    } else {
      break
    }
  }
  return value
}

/** 某属性在指定时间是否有精确关键帧。 */
function hasKeyframeAt(shape: ClipShape, path: string, time: number): boolean {
  const property = shape.objects[path]
  if (property === undefined) {
    return false
  }
  return (property.keyframes ?? []).some((frame) => frame.time === time)
}
