/**
 * 对账：把 `schema.get` 响应（`SchemaExporter.exportAll()` 的形状）转成目录，再与本地目录逐段比对。
 *
 * 远端条目没有源码锚点，`sourceRef` 一律为空字符串；远端 `FieldDef` 不导出取值区间与依赖，
 * 所以 `rangeChanged` / `dependencyChanged` 只在本地确有而远端缺失（或反）时才出现。
 *
 * `catalogFromSchemaGet` 对未知 / 缺失键宽容：取不到就当空，类型不对就当空，不抛错。
 */
import type {
  CurveCapability,
  CurveCatalog,
  CurveParamEntry,
  DriftEntry,
  DriftKind,
  DriftReport,
  FieldCatalog,
  FieldEntry,
  ModelCatalog,
  ScriptStructureCatalog,
  Segment,
  TrackCatalog,
  TriggerCatalog,
} from './types.ts'

export interface DriftMeta {
  gameVersion: string
  modVersion: string
  capturedAt: string
}

type JsonRecord = Record<string, unknown>

/** `SchemaExporter.scriptStructure()` 的四个字段表。 */
const SCRIPT_FIELD_SECTIONS = ['clips', 'rules', 'rule_bindings', 'paths'] as const
/** 对账的段处理顺序：覆盖全部 `Segment`，逐段独立比对。 */
const SEGMENT_ORDER: Segment[] = ['meta', 'tracks', 'triggers', 'models', 'curveTypes', 'script_structure']

function asObject(value: unknown): JsonRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as JsonRecord
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      return undefined
    }
    out.push(item)
  }
  return out
}

/** `default` 是 `null` / 缺失时视为「无缺省值」。 */
function defaultState(def: JsonRecord): { value: unknown; has: boolean } {
  if (!('default' in def) || def.default === null || def.default === undefined) {
    return { value: null, has: false }
  }
  return { value: def.default, has: true }
}

/** `FieldDef` → `FieldEntry`；`id` 由调用方按段规则拼。 */
function entryFromFieldDef(
  segment: Segment,
  scope: string[],
  id: string,
  key: string,
  def: JsonRecord,
  withDoc: boolean,
): FieldEntry {
  const state = defaultState(def)
  const entry: FieldEntry = {
    id,
    segment,
    scope,
    key,
    type: (asString(def.type) ?? 'string') as FieldEntry['type'],
    default: state.value,
    hasDefault: state.has,
    required: def.required === true,
    sourceRef: '',
  }
  const enumValues = asStringArray(def.enumValues)
  if (enumValues !== undefined && enumValues.length > 0) {
    entry.enumValues = enumValues
  }
  const section = asString(def.section)
  if (section !== undefined && section !== '') {
    entry.section = section
  }
  if (withDoc) {
    const doc = asString(def.doc)
    if (doc !== undefined && doc !== '') {
      entry.doc = doc
    }
  }
  return entry
}

/** `ObjectDef` → `FieldEntry`；只写有值的可选项。 */
function objectEntryFromDef(type: string, key: string, def: JsonRecord): FieldEntry {
  const path = asString(def.path) ?? key
  const state = defaultState(def)
  const entry: FieldEntry = {
    id: `track.${type}.object.${path}`,
    segment: 'tracks',
    scope: [type],
    key: path,
    type: (asString(def.type) ?? 'float') as FieldEntry['type'],
    default: state.value,
    hasDefault: state.has,
    required: def.required === true,
    sourceRef: '',
  }
  const mode = asString(def.mode)
  if (mode !== undefined) {
    entry.mode = mode as FieldEntry['mode']
  }
  const interp = asString(def.interp)
  if (interp !== undefined) {
    entry.interp = interp as FieldEntry['interp']
  }
  const enumValues = asStringArray(def.enumValues)
  if (enumValues !== undefined && enumValues.length > 0) {
    entry.enumValues = enumValues
  }
  if (def.nullable === true) {
    entry.nullable = true
  }
  const min = asNumber(def.min)
  if (min !== undefined) {
    entry.min = min
  }
  const max = asNumber(def.max)
  if (max !== undefined) {
    entry.max = max
  }
  const requires = asString(def.requires)
  if (requires !== undefined) {
    entry.requires = requires
  }
  const appliesTo = asStringArray(def.appliesTo)
  if (appliesTo !== undefined && appliesTo.length > 0) {
    entry.appliesTo = appliesTo
  }
  const section = asString(def.section)
  if (section !== undefined) {
    entry.section = section
  }
  const group = asString(def.group)
  if (group !== undefined) {
    entry.group = group
  }
  const labelKey = asString(def.labelKey)
  if (labelKey !== undefined) {
    entry.labelKey = labelKey
  }
  const unit = asString(def.unit)
  if (unit !== undefined) {
    entry.unit = unit
  }
  return entry
}

function metaFromSchemaGet(value: unknown): FieldEntry[] {
  const record = asObject(value)
  if (record === undefined) {
    return []
  }
  const entries: FieldEntry[] = []
  for (const [key, def] of Object.entries(record)) {
    const defRecord = asObject(def)
    if (defRecord === undefined) {
      continue
    }
    entries.push(entryFromFieldDef('meta', [], `meta.${key}`, key, defRecord, false))
  }
  return entries
}

function tracksFromSchemaGet(value: unknown): Record<string, TrackCatalog> {
  const tracks: Record<string, TrackCatalog> = {}
  const record = asObject(value)
  if (record === undefined) {
    return tracks
  }
  for (const [type, track] of Object.entries(record)) {
    const trackRecord = asObject(track)
    if (trackRecord === undefined) {
      continue
    }
    const playControl: FieldEntry[] = []
    const playRecord = asObject(trackRecord.playControl)
    if (playRecord !== undefined) {
      for (const [key, def] of Object.entries(playRecord)) {
        const defRecord = asObject(def)
        if (defRecord === undefined) {
          continue
        }
        playControl.push(entryFromFieldDef('tracks', [], `track.playControl.${key}`, key, defRecord, false))
      }
    }
    const objects: FieldEntry[] = []
    const objectsRecord = asObject(trackRecord.objects)
    if (objectsRecord !== undefined) {
      for (const [key, def] of Object.entries(objectsRecord)) {
        const defRecord = asObject(def)
        if (defRecord === undefined) {
          continue
        }
        objects.push(objectEntryFromDef(type, key, defRecord))
      }
    }
    tracks[type] = { playControl, objects }
  }
  return tracks
}

function triggersFromSchemaGet(value: unknown): TriggerCatalog {
  const record = asObject(value)
  const conditions: Record<string, FieldEntry[]> = {}
  const conditionsRecord = asObject(record?.conditions)
  if (conditionsRecord !== undefined) {
    for (const [type, group] of Object.entries(conditionsRecord)) {
      const groupRecord = asObject(group)
      if (groupRecord === undefined) {
        continue
      }
      const entries: FieldEntry[] = []
      for (const [key, def] of Object.entries(groupRecord)) {
        const defRecord = asObject(def)
        if (defRecord === undefined) {
          continue
        }
        entries.push(
          entryFromFieldDef('triggers', [type], `trigger.${type}.condition.${key}`, key, defRecord, false),
        )
      }
      conditions[type] = entries
    }
  }
  const triggerFields: FieldEntry[] = []
  const fieldsRecord = asObject(record?.triggerFields)
  if (fieldsRecord !== undefined) {
    for (const [key, def] of Object.entries(fieldsRecord)) {
      const defRecord = asObject(def)
      if (defRecord === undefined) {
        continue
      }
      triggerFields.push(entryFromFieldDef('triggers', [], `trigger.${key}`, key, defRecord, false))
    }
  }
  const types = asStringArray(record?.types) ?? Object.keys(conditions)
  return { types, conditions, triggerFields }
}

function modelsFromSchemaGet(value: unknown): Record<string, ModelCatalog> {
  const models: Record<string, ModelCatalog> = {}
  const record = asObject(value)
  if (record === undefined) {
    return models
  }
  for (const [type, params] of Object.entries(record)) {
    const paramsRecord = asObject(params)
    const list: FieldEntry[] = []
    if (paramsRecord !== undefined) {
      for (const [key, def] of Object.entries(paramsRecord)) {
        const defRecord = asObject(def)
        if (defRecord === undefined) {
          continue
        }
        list.push(entryFromFieldDef('models', [type], `model.${type}.${key}`, key, defRecord, false))
      }
    }
    models[type] = { params: list, domains: [], maxDepth: 0, maxNodes: 0, fallback: '' }
  }
  return models
}

function curveTypesFromSchemaGet(value: unknown): Record<string, CurveCatalog> {
  const curveTypes: Record<string, CurveCatalog> = {}
  const record = asObject(value)
  if (record === undefined) {
    return curveTypes
  }
  for (const [type, curve] of Object.entries(record)) {
    const curveRecord = asObject(curve)
    const params: CurveParamEntry[] = []
    const paramsRecord = asObject(curveRecord?.params)
    if (paramsRecord !== undefined) {
      for (const [key, def] of Object.entries(paramsRecord)) {
        const defRecord = asObject(def)
        if (defRecord === undefined) {
          continue
        }
        const state = defaultState(defRecord)
        const param: CurveParamEntry = {
          key,
          kind: (asString(defRecord.kind) ?? 'NUMBER') as CurveParamEntry['kind'],
          default: state.value,
          hasDefault: state.has,
          required: defRecord.required === true,
          sourceRef: '',
        }
        const enumValues = asStringArray(defRecord.enumValues)
        if (enumValues !== undefined && enumValues.length > 0) {
          param.enumValues = enumValues
        }
        const doc = asString(defRecord.doc)
        if (doc !== undefined && doc !== '') {
          param.doc = doc
        }
        params.push(param)
      }
    }
    const capabilities = (asStringArray(curveRecord?.capabilities) ?? []) as CurveCapability[]
    curveTypes[type] = { capabilities, params }
  }
  return curveTypes
}

function scriptStructureFromSchemaGet(value: unknown): ScriptStructureCatalog {
  const sections: Record<string, FieldEntry[]> = {}
  const enums: Record<string, string[]> = {}
  const record = asObject(value)
  if (record === undefined) {
    return { sections, enums }
  }

  const collect = (section: string, fields: JsonRecord): void => {
    for (const [key, def] of Object.entries(fields)) {
      const defRecord = asObject(def)
      if (defRecord === undefined) {
        continue
      }
      const nested = asObject(defRecord.fields)
      if (asString(defRecord.type) === 'object' && nested !== undefined) {
        collect(`${section}.${key}`, nested)
        continue
      }
      const list = sections[section] ?? []
      list.push(
        entryFromFieldDef('script_structure', [section], `script.${section}.${key}`, key, defRecord, true),
      )
      sections[section] = list
    }
  }

  for (const section of SCRIPT_FIELD_SECTIONS) {
    const sectionRecord = asObject(record[section])
    if (sectionRecord !== undefined) {
      collect(section, sectionRecord)
    }
  }

  const factTypes = asObject(record.condition_fact_types)
  if (factTypes !== undefined) {
    for (const [name, fields] of Object.entries(factTypes)) {
      const fieldsRecord = asObject(fields)
      if (fieldsRecord !== undefined) {
        collect(`condition_fact_types.${name}`, fieldsRecord)
      }
    }
  }

  for (const name of ['action_types', 'exit_kinds', 'schedule_kinds']) {
    const values = asStringArray(record[name])
    if (values !== undefined) {
      enums[name] = values
    }
  }
  if (factTypes !== undefined) {
    enums.condition_fact_types = Object.keys(factTypes)
  }

  return { sections, enums }
}

/** `schema.get` 响应 → 目录。缺失的段/键留空；`sourceRef` 为空字符串（远端没有源码锚点）。 */
export function catalogFromSchemaGet(response: unknown, sourceCommit: string): FieldCatalog {
  const root = asObject(response)
  return {
    catalogHash: '',
    sourceCommit,
    meta: metaFromSchemaGet(root?.meta),
    screenLayers: { fixed: [], spaces: {}, valueType: 'bool', dynamic: true },
    tracks: tracksFromSchemaGet(root?.tracks),
    triggers: triggersFromSchemaGet(root?.triggers),
    models: modelsFromSchemaGet(root?.models),
    curveTypes: curveTypesFromSchemaGet(root?.curveTypes),
    scriptStructure: scriptStructureFromSchemaGet(root?.script_structure),
    discovered: { tracks: [], triggers: [] },
  }
}

/** 对账用的段内条目；`scope` 让同 key 的 playControl / 触发器条件按作用域区分。 */
interface SegmentEntry {
  segment: Segment
  scope: string[]
  key: string
  entry: FieldEntry | CurveParamEntry
}

/** 把目录拆成「段 → 条目列表」，不复制也不排序目录自身的数组。 */
function collectSegments(catalog: FieldCatalog): SegmentEntry[] {
  const out: SegmentEntry[] = []
  for (const entry of catalog.meta) {
    out.push({ segment: 'meta', scope: [], key: entry.key, entry })
  }
  for (const [type, track] of Object.entries(catalog.tracks)) {
    for (const entry of track.playControl) {
      out.push({ segment: 'tracks', scope: [type], key: entry.key, entry })
    }
    for (const entry of track.objects) {
      out.push({ segment: 'tracks', scope: [type], key: entry.key, entry })
    }
  }
  for (const [type, group] of Object.entries(catalog.triggers.conditions)) {
    for (const entry of group) {
      out.push({ segment: 'triggers', scope: [type], key: entry.key, entry })
    }
  }
  for (const entry of catalog.triggers.triggerFields) {
    out.push({ segment: 'triggers', scope: [], key: entry.key, entry })
  }
  for (const [type, model] of Object.entries(catalog.models)) {
    for (const entry of model.params) {
      out.push({ segment: 'models', scope: [type], key: entry.key, entry })
    }
  }
  for (const [type, curve] of Object.entries(catalog.curveTypes)) {
    for (const param of curve.params) {
      out.push({ segment: 'curveTypes', scope: [type], key: param.key, entry: param })
    }
  }
  for (const [section, fields] of Object.entries(catalog.scriptStructure.sections)) {
    for (const entry of fields) {
      out.push({ segment: 'script_structure', scope: [section], key: entry.key, entry })
    }
  }
  return out
}

function entryType(entry: FieldEntry | CurveParamEntry): string {
  return 'kind' in entry ? entry.kind : entry.type
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 共有键逐项比对；同一键可以同时产生多条不同 kind。 */
function compareEntries(segment: Segment, localItem: SegmentEntry, remoteItem: SegmentEntry): DriftEntry[] {
  const localEntry = localItem.entry
  const remoteEntry = remoteItem.entry
  const drifts: DriftEntry[] = []

  const push = (kind: DriftKind, localValue: unknown, remoteValue: unknown): void => {
    const drift: DriftEntry = {
      segment,
      scope: [...localItem.scope],
      key: localItem.key,
      kind,
      local: localValue,
      remote: remoteValue,
    }
    if (localEntry.sourceRef !== '') {
      drift.sourceRef = localEntry.sourceRef
    }
    drifts.push(drift)
  }

  const localType = entryType(localEntry)
  const remoteType = entryType(remoteEntry)
  if (localType !== remoteType) {
    push('typeChanged', localType, remoteType)
  }

  if (!sameJson(localEntry.enumValues, remoteEntry.enumValues)) {
    push('enumChanged', localEntry.enumValues ?? null, remoteEntry.enumValues ?? null)
  }

  if (localEntry.hasDefault !== remoteEntry.hasDefault || !sameJson(localEntry.default, remoteEntry.default)) {
    push(
      'defaultChanged',
      { default: localEntry.default, hasDefault: localEntry.hasDefault },
      { default: remoteEntry.default, hasDefault: remoteEntry.hasDefault },
    )
  }

  const localRange: { min?: number; max?: number } = 'segment' in localEntry
    ? { min: localEntry.min, max: localEntry.max }
    : {}
  const remoteRange: { min?: number; max?: number } = 'segment' in remoteEntry
    ? { min: remoteEntry.min, max: remoteEntry.max }
    : {}
  if (localRange.min !== remoteRange.min || localRange.max !== remoteRange.max) {
    push('rangeChanged', localRange, remoteRange)
  }

  const localDependencies: { requires?: string; appliesTo?: string[] } = 'segment' in localEntry
    ? { requires: localEntry.requires, appliesTo: localEntry.appliesTo }
    : {}
  const remoteDependencies: { requires?: string; appliesTo?: string[] } = 'segment' in remoteEntry
    ? { requires: remoteEntry.requires, appliesTo: remoteEntry.appliesTo }
    : {}
  if (
    !sameJson(localDependencies.requires, remoteDependencies.requires)
    || !sameJson(localDependencies.appliesTo, remoteDependencies.appliesTo)
  ) {
    push('dependencyChanged', localDependencies, remoteDependencies)
  }

  return drifts
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

/** `segment` → `scope.join('.')` → `key` → `kind` 升序。 */
function compareDrift(left: DriftEntry, right: DriftEntry): number {
  const bySegment = compareText(left.segment, right.segment)
  if (bySegment !== 0) {
    return bySegment
  }
  const byScope = compareText(left.scope.join('.'), right.scope.join('.'))
  if (byScope !== 0) {
    return byScope
  }
  const byKey = compareText(left.key, right.key)
  if (byKey !== 0) {
    return byKey
  }
  return compareText(left.kind, right.kind)
}

/** 逐段对账；只读，不修改 `local`。`entries` 按 segment + scope + key 稳定排序。 */
export function diffCatalog(local: FieldCatalog, remote: FieldCatalog, meta: DriftMeta): DriftReport {
  const localEntries = collectSegments(local)
  const remoteEntries = collectSegments(remote)
  const entries: DriftEntry[] = []

  for (const segment of SEGMENT_ORDER) {
    const localSegment = localEntries.filter((item) => item.segment === segment)
    const remoteSegment = remoteEntries.filter((item) => item.segment === segment)

    if (localSegment.length > 0 && remoteSegment.length === 0) {
      entries.push({
        segment,
        scope: [],
        key: '',
        kind: 'segmentMissing',
        local: localSegment.length,
        remote: 0,
      })
      continue
    }

    const remoteByKey = new Map<string, SegmentEntry>()
    for (const item of remoteSegment) {
      remoteByKey.set(`${item.scope.join('/')}|${item.key}`, item)
    }

    const localKeys = new Set<string>()
    for (const item of localSegment) {
      const key = `${item.scope.join('/')}|${item.key}`
      localKeys.add(key)
      const counterpart = remoteByKey.get(key)
      if (counterpart === undefined) {
        const drift: DriftEntry = {
          segment,
          scope: [...item.scope],
          key: item.key,
          kind: 'missing',
          local: item.entry,
        }
        if (item.entry.sourceRef !== '') {
          drift.sourceRef = item.entry.sourceRef
        }
        entries.push(drift)
        continue
      }
      entries.push(...compareEntries(segment, item, counterpart))
    }

    for (const item of remoteSegment) {
      if (localKeys.has(`${item.scope.join('/')}|${item.key}`)) {
        continue
      }
      entries.push({
        segment,
        scope: [...item.scope],
        key: item.key,
        kind: 'added',
        remote: item.entry,
      })
    }
  }

  entries.sort(compareDrift)

  return {
    catalogHashLocal: local.catalogHash,
    catalogHashRemote: remote.catalogHash,
    gameVersion: meta.gameVersion,
    modVersion: meta.modVersion,
    capturedAt: meta.capturedAt,
    entries,
  }
}
