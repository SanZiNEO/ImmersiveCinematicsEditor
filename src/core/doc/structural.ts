/**
 * 本地结构检查 L01–L34（03-06）。
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

/** 结构检查上下文。 */
export interface StructuralContext {
  catalog: CatalogIndex
  /** meta 键集合（只从 02 目录取）。 */
  metaKeys: readonly string[]
  /** 片段身份表（已与文档同步）。 */
  registry: ClipRegistry
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
    for (let clipIndexInTrack = 0; clipIndexInTrack < clips.length; clipIndexInTrack += 1) {
      const clipPath = `${trackPath}.clips[${clipIndexInTrack}]`
      const context = readClipInto(clips[clipIndexInTrack], true, type, clipPath, ctx, issues)
      if (context === undefined) {
        continue
      }
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
  }

  // ── L09 / L18：独立片段 ──────────────────────────────────────────────────
  const standalone = doc.root.clips
  if (standalone !== undefined && !Array.isArray(standalone)) {
    add('block', 'L09', 'clips 需要数组（脚本级独立片段表）', 'clips')
  } else if (Array.isArray(standalone)) {
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
