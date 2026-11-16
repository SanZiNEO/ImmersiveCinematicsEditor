/**
 * 目录组装与查询：合并六段字段登记、建索引、跑自检、深冻结，并提供按段查询的 `CatalogIndex`。
 */
import type {
  CurveCatalog,
  CurveParamEntry,
  DiscoveredType,
  FieldCatalog,
  FieldEntry,
  ModelCatalog,
  Segment,
  TrackCatalog,
} from './types.ts'
import { META_FIELDS } from './catalog/meta.ts'
import {
  SCREEN_LAYER_DYNAMIC,
  SCREEN_LAYER_SPACE,
  SCREEN_LAYERS,
  SCREEN_LAYER_VALUE_TYPE,
} from './catalog/screenLayers.ts'
import { PLAY_CONTROL_FIELDS, TRACK_OBJECTS, TRACK_ORDER } from './catalog/tracks.ts'
import { CONTINUITY_FIELDS, TRIGGER_CONDITIONS, TRIGGER_FIELDS, TRIGGER_TYPES } from './catalog/triggers.ts'
import {
  MODEL_DOMAINS,
  MODEL_FALLBACK,
  MODEL_MAX_DEPTH,
  MODEL_MAX_NODES,
  MODEL_PARAMS,
  MODEL_TYPES,
} from './catalog/models.ts'
import { CURVE_CAPABILITIES, CURVE_PARAMS, CURVE_TYPES } from './catalog/curveTypes.ts'
import { SCRIPT_ENUMS, SCRIPT_SECTIONS } from './catalog/scriptStructure.ts'
import { validateCatalog } from './validate.ts'

export { computeCatalogHash } from './hash.ts'

/** `PropertyPath` 段规则，与 `validate.ts` 的 V1 同一形态。 */
const PATH_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const NUMERIC_TYPES: Record<string, true> = {
  float: true,
  nullable_float: true,
  int: true,
  number: true,
}
const BOOLEAN_TYPES: Record<string, true> = {
  bool: true,
  boolean: true,
}

/** 目录查询接口；所有返回值都是目录内部条目的副本或冻结对象。 */
export interface CatalogIndex {
  meta(key: string): FieldEntry | undefined
  track(type: string): TrackCatalog | undefined
  playControl(type: string, key: string): FieldEntry | undefined
  objectDef(type: string, path: string): FieldEntry | undefined
  paths(type: string): string[]
  sectionGroups(type: string): Record<string, string[]>
  availability(type: string, path: string, values: Record<string, unknown>): { available: boolean; reason?: string }
  trigger(type: string): FieldEntry[] | undefined
  triggerField(key: string): FieldEntry | undefined
  model(type: string): ModelCatalog | undefined
  curveType(type: string): CurveCatalog | undefined
  scriptSection(section: string): FieldEntry[] | undefined
  scriptEnum(name: string): string[] | undefined
  search(q: { segment?: Segment; scope?: string; key?: string }): FieldEntry[]
}

/** 解析 `path=value` / `path!=value`；`!=` 优先，等号位置必须大于 0。 */
function parseRequires(requires: string): { path: string; value: string; negate: boolean } | undefined {
  const text = requires.trim()
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

/** 把 requires 右侧字面量按被引用字段的类型解析；`null` 是跨类型的中性字面量。 */
function parseLiteral(type: string, literal: string): unknown {
  if (literal === 'null') {
    return null
  }
  if (NUMERIC_TYPES[type] === true) {
    return Number(literal)
  }
  if (BOOLEAN_TYPES[type] === true) {
    if (literal === 'true') {
      return true
    }
    if (literal === 'false') {
      return false
    }
  }
  return literal
}

/** 按被引用字段的类型比较实际值与 requires 字面量。 */
function sameValue(type: string, actual: unknown, literal: string): boolean {
  const expected = parseLiteral(type, literal)
  if (expected === null) {
    return actual === null
  }
  if (actual === null || actual === undefined) {
    return false
  }
  if (NUMERIC_TYPES[type] === true) {
    return typeof actual === 'number' && Number.isFinite(actual) && actual === expected
  }
  if (BOOLEAN_TYPES[type] === true) {
    return typeof actual === 'boolean' && actual === expected
  }
  if (typeof actual === 'string') {
    return actual === expected
  }
  return Object.is(actual, expected)
}

/** 递归冻结数组与普通对象。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  Object.freeze(value)
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/**
 * 建索引：主键 `id` 全量唯一，并维护轨道对象 / playControl / 触发器条件 / 模型参数 /
 * 曲线参数 / 结构段键与查询所需的分组。
 *
 * 同一个字段定义被多轨共用时按引用去重；同名但不同定义视为重复键，直接抛错。
 */
export function indexCatalog(catalog: FieldCatalog): CatalogIndex {
  const byId = new Map<string, FieldEntry>()
  const byMetaKey = new Map<string, FieldEntry>()
  const byTrackObject = new Map<string, FieldEntry>()
  const byPlayControl = new Map<string, FieldEntry>()
  const byTriggerCondition = new Map<string, FieldEntry>()
  const byTriggerField = new Map<string, FieldEntry>()
  const byContinuityField = new Map<string, FieldEntry>()
  const byModelParam = new Map<string, FieldEntry>()
  const byCurveParam = new Map<string, CurveParamEntry>()
  const byScriptSection = new Map<string, FieldEntry>()

  const register = (entry: FieldEntry): void => {
    const existing = byId.get(entry.id)
    if (existing === undefined) {
      byId.set(entry.id, entry)
      return
    }
    if (existing !== entry) {
      throw new Error(`重复的字段 id: ${entry.id}`)
    }
  }

  for (const entry of catalog.meta) {
    register(entry)
    const existing = byMetaKey.get(entry.key)
    if (existing !== undefined && existing !== entry) {
      throw new Error(`重复的元数据键: ${entry.key}`)
    }
    byMetaKey.set(entry.key, entry)
  }

  for (const [type, track] of Object.entries(catalog.tracks)) {
    for (const entry of track.playControl) {
      register(entry)
      const key = `${type}:${entry.key}`
      const existing = byPlayControl.get(key)
      if (existing !== undefined && existing !== entry) {
        throw new Error(`重复的 playControl 键: ${key}`)
      }
      byPlayControl.set(key, entry)
    }
    for (const entry of track.objects) {
      register(entry)
      const key = `${type}:${entry.key}`
      if (byTrackObject.has(key)) {
        throw new Error(`重复的轨道对象键: ${key}`)
      }
      byTrackObject.set(key, entry)
    }
  }

  for (const [type, group] of Object.entries(catalog.triggers.conditions)) {
    for (const entry of group) {
      register(entry)
      const key = `${type}:${entry.key}`
      if (byTriggerCondition.has(key)) {
        throw new Error(`重复的触发器条件键: ${key}`)
      }
      byTriggerCondition.set(key, entry)
    }
  }
  for (const entry of catalog.triggers.triggerFields) {
    register(entry)
    if (byTriggerField.has(entry.key)) {
      throw new Error(`重复的触发器字段键: ${entry.key}`)
    }
    byTriggerField.set(entry.key, entry)
  }
  for (const entry of CONTINUITY_FIELDS) {
    register(entry)
    if (byContinuityField.has(entry.key)) {
      throw new Error(`重复的 continuity 字段键: ${entry.key}`)
    }
    byContinuityField.set(entry.key, entry)
  }

  for (const [type, model] of Object.entries(catalog.models)) {
    for (const entry of model.params) {
      register(entry)
      const key = `${type}:${entry.key}`
      if (byModelParam.has(key)) {
        throw new Error(`重复的模型参数键: ${key}`)
      }
      byModelParam.set(key, entry)
    }
  }

  for (const [type, curve] of Object.entries(catalog.curveTypes)) {
    for (const param of curve.params) {
      const key = `${type}:${param.key}`
      if (byCurveParam.has(key)) {
        throw new Error(`重复的曲线参数键: ${key}`)
      }
      byCurveParam.set(key, param)
    }
  }

  for (const [section, fields] of Object.entries(catalog.scriptStructure.sections)) {
    for (const entry of fields) {
      register(entry)
      const key = `${section}:${entry.key}`
      if (byScriptSection.has(key)) {
        throw new Error(`重复的结构段字段键: ${key}`)
      }
      byScriptSection.set(key, entry)
    }
  }

  return {
    meta(key) {
      return byMetaKey.get(key)
    },
    track(type) {
      return catalog.tracks[type]
    },
    playControl(type, key) {
      return byPlayControl.get(`${type}:${key}`)
    },
    objectDef(type, path) {
      return byTrackObject.get(`${type}:${path}`)
    },
    paths(type) {
      const track = catalog.tracks[type]
      return track === undefined ? [] : track.objects.map((entry) => entry.key)
    },
    sectionGroups(type) {
      const track = catalog.tracks[type]
      const groups: Record<string, string[]> = {}
      if (track === undefined) {
        return groups
      }
      for (const entry of [...track.playControl, ...track.objects]) {
        if (entry.section === undefined) {
          continue
        }
        const list = groups[entry.section]
        if (list === undefined) {
          groups[entry.section] = [entry.key]
        } else {
          list.push(entry.key)
        }
      }
      return groups
    },
    availability(type, path, values) {
      const entry = byTrackObject.get(`${type}:${path}`)
      if (entry === undefined) {
        return { available: false, reason: `未登记路径 ${path}` }
      }
      const requires = entry.requires
      if (requires === undefined) {
        return { available: true }
      }
      const parsed = parseRequires(requires)
      if (
        parsed === undefined
        || parsed.value.length === 0
        || /\s/.test(parsed.value)
        || !PATH_PATTERN.test(parsed.path)
      ) {
        return { available: false, reason: `requires 格式非法: ${requires}` }
      }
      const referenced = byTrackObject.get(`${type}:${parsed.path}`)
      if (referenced === undefined) {
        return { available: false, reason: `requires 引用未知路径 ${parsed.path}` }
      }
      const actual = Object.prototype.hasOwnProperty.call(values, parsed.path)
        ? values[parsed.path]
        : referenced.default
      const equal = sameValue(referenced.type, actual, parsed.value)
      const satisfied = parsed.negate ? !equal : equal
      if (satisfied) {
        return { available: true }
      }
      return {
        available: false,
        reason: `需要 ${requires}（当前 ${parsed.path}=${String(actual)}）`,
      }
    },
    trigger(type) {
      const group = catalog.triggers.conditions[type]
      return group === undefined ? undefined : [...group]
    },
    triggerField(key) {
      const direct = byTriggerField.get(key)
      if (direct !== undefined) {
        return direct
      }
      const prefix = 'continuity.'
      if (key.startsWith(prefix)) {
        return byContinuityField.get(key.slice(prefix.length))
      }
      return byContinuityField.get(key)
    },
    model(type) {
      return catalog.models[type]
    },
    curveType(type) {
      return catalog.curveTypes[type]
    },
    scriptSection(section) {
      const fields = catalog.scriptStructure.sections[section]
      return fields === undefined ? undefined : [...fields]
    },
    scriptEnum(name) {
      const values = catalog.scriptStructure.enums[name]
      return values === undefined ? undefined : [...values]
    },
    search(q) {
      const matched: FieldEntry[] = []
      const all = [...byId.values()].sort((left, right) => {
        if (left.id < right.id) {
          return -1
        }
        if (left.id > right.id) {
          return 1
        }
        return 0
      })
      for (const entry of all) {
        if (q.segment !== undefined && entry.segment !== q.segment) {
          continue
        }
        if (q.scope !== undefined && !entry.scope.includes(q.scope)) {
          continue
        }
        if (q.key !== undefined && !entry.key.includes(q.key)) {
          continue
        }
        matched.push(entry)
      }
      return matched
    },
  }
}

/** 复制「已发现」登记，隔离调用方数组/对象，深冻结只作用于目录自身。 */
function cloneDiscovered(items: readonly DiscoveredType[]): DiscoveredType[] {
  return items.map((item) => ({ type: item.type, sourceRef: item.sourceRef }))
}

/** 组装六段目录、跑索引与自检，返回深冻结对象。 */
export function buildCatalog(
  sourceCommit: string,
  discovered: FieldCatalog['discovered'] = { tracks: [], triggers: [] },
): FieldCatalog {
  const tracks: Record<string, TrackCatalog> = {}
  for (const type of TRACK_ORDER) {
    tracks[type] = {
      playControl: PLAY_CONTROL_FIELDS,
      objects: TRACK_OBJECTS[type] ?? [],
    }
  }

  const models: Record<string, ModelCatalog> = {}
  for (const type of MODEL_TYPES) {
    models[type] = {
      params: MODEL_PARAMS[type] ?? [],
      domains: [...MODEL_DOMAINS],
      maxDepth: MODEL_MAX_DEPTH,
      maxNodes: MODEL_MAX_NODES,
      fallback: MODEL_FALLBACK,
    }
  }

  const curveTypes: Record<string, CurveCatalog> = {}
  for (const type of CURVE_TYPES) {
    curveTypes[type] = {
      capabilities: [...(CURVE_CAPABILITIES[type] ?? [])],
      params: CURVE_PARAMS[type] ?? [],
    }
  }

  const catalog: FieldCatalog = {
    catalogHash: '',
    sourceCommit,
    meta: META_FIELDS,
    screenLayers: {
      fixed: [...SCREEN_LAYERS],
      spaces: { ...SCREEN_LAYER_SPACE },
      valueType: SCREEN_LAYER_VALUE_TYPE,
      dynamic: SCREEN_LAYER_DYNAMIC,
    },
    tracks,
    triggers: {
      types: [...TRIGGER_TYPES],
      conditions: TRIGGER_CONDITIONS,
      triggerFields: TRIGGER_FIELDS,
    },
    models,
    curveTypes,
    scriptStructure: { sections: SCRIPT_SECTIONS, enums: SCRIPT_ENUMS },
    discovered: {
      tracks: cloneDiscovered(discovered.tracks),
      triggers: cloneDiscovered(discovered.triggers),
    },
  }

  indexCatalog(catalog)
  const issues = validateCatalog(catalog)
  if (issues.length > 0) {
    throw new Error(issues.join('\n'))
  }
  return deepFreeze(catalog)
}

/** 给目录盖上计算好的 hash，返回深冻结副本。 */
export function sealCatalog(catalog: FieldCatalog, catalogHash: string): FieldCatalog {
  return deepFreeze({ ...catalog, catalogHash })
}
