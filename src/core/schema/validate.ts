/**
 * 目录声明自检：逐条对应 `ObjectSchemaValidator` 的注册期检查与 `PathCurveRegistry` /
 * `MathModelRegistry` 的参数检查。
 *
 * `validateCatalog` 汇总全目录 issue；`validateEntry` 只跑单条可判定的规则。
 */
import type { CurveParamEntry, FieldCatalog, FieldEntry, FieldInterp, ModelCatalog } from './types.ts'
import { TRACK_ORDER } from './catalog/tracks.ts'

/** `PropertyPath` 段规则：`.` 分隔，每段首字符 a-z，其余 a-z0-9_。 */
const PATH_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
/** `appliesTo` 的层类型 / 轨道子类型 token（`ObjectDef.appliesTo` 的语义是「限定层类型或轨道子类型」）。 */
const SUBTYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/
/** `appliesTo` 的 `modid:xxx` 形式。 */
const MOD_ID_PATTERN = /^[a-z][a-z0-9_]*:[a-z0-9_./-]+$/
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

/** 目录允许的单位：只收录源码登记过的单位（`ObjectDef.unit`），不自造。 */
const ALLOWED_UNITS: readonly string[] = ['degree']
/** `ValueDomain` 枚举的小写 key：`math/ValueDomain.java:10`。 */
const ALLOWED_MODEL_DOMAINS: readonly string[] = ['scalar', 'angle', 'vector', 'color']
/** `ModelParamType` 全量（`math/MathModelRegistry` 的 `FieldDef.type`）。 */
const MODEL_PARAM_TYPES: Record<string, true> = {
  float: true,
  int: true,
  bool: true,
  string: true,
  enum: true,
  model: true,
  model_list: true,
  object: true,
  array: true,
}

const NUMERIC_TYPES: Record<string, true> = {
  float: true,
  nullable_float: true,
  int: true,
  number: true,
}

/** `Interp.accepts`：插值方式是否适用于给定值类型。 */
function interpAccepts(interp: FieldInterp, type: string): boolean {
  switch (interp) {
    case 'angle':
      return type === 'float' || type === 'nullable_float'
    case 'geometric':
      return type === 'float'
    case 'linear':
      return type === 'float' || type === 'nullable_float'
    case 'step':
      return type !== 'event_record' && type !== 'struct'
    case 'none':
      return true
  }
}

/** struct 的默认值：null / 字符串 / 布尔 / 有限数字 / 纯对象 / 数组。 */
function isStructValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every((item) => isStructValue(item))
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (!isStructValue((value as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }
  return false
}

/** `ObjectSchemaValidator.defaultMatches`：默认值与声明类型是否一致。 */
function defaultMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'float':
    case 'nullable_float':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'int':
      return typeof value === 'number' && Number.isInteger(value)
        && value >= INT32_MIN && value <= INT32_MAX
    case 'bool':
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
    case 'enum':
    case 'ref':
      return typeof value === 'string'
    case 'event_record':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'struct':
      return isStructValue(value)
    default:
      return true
  }
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** V3：形态 / 类型 / 插值组合；`mode` 缺省时整组跳过。 */
function checkMode(entry: FieldEntry, issues: string[]): void {
  if (entry.mode === undefined) {
    return
  }
  const where = entry.id
  const type = entry.type
  if (type === 'struct' && entry.mode !== 'value') {
    issues.push(`${where}: struct 只允许 mode=value`)
  }
  switch (entry.mode) {
    case 'value':
      if (entry.interp !== undefined && entry.interp !== 'none') {
        issues.push(`${where}: mode=value 时 interp 必须为 none`)
      }
      if (type === 'event_record') {
        issues.push(`${where}: event_record 只能用于 mode=event`)
      }
      break
    case 'animated':
      if (entry.interp === undefined || entry.interp === 'none') {
        issues.push(`${where}: mode=animated 需要非 none 的 interp`)
      } else if (!interpAccepts(entry.interp, type)) {
        issues.push(`${where}: interp=${entry.interp} 不适用于 type=${type}`)
      }
      if (type === 'event_record') {
        issues.push(`${where}: event_record 只能用于 mode=event`)
      }
      break
    case 'event':
      if (type !== 'event_record') {
        issues.push(`${where}: mode=event 的 type 必须是 event_record`)
      }
      if (entry.interp !== undefined && entry.interp !== 'none') {
        issues.push(`${where}: mode=event 时 interp 必须为 none`)
      }
      break
  }
}

/** V7：范围。 */
function checkRange(entry: FieldEntry, issues: string[]): void {
  const where = entry.id
  const hasMin = entry.min !== undefined
  const hasMax = entry.max !== undefined
  if (hasMin && !hasFiniteNumber(entry.min)) {
    issues.push(`${where}: min 必须为有限数字`)
  }
  if (hasMax && !hasFiniteNumber(entry.max)) {
    issues.push(`${where}: max 必须为有限数字`)
  }
  if (hasFiniteNumber(entry.min) && hasFiniteNumber(entry.max) && entry.min > entry.max) {
    issues.push(`${where}: min 不能大于 max`)
  }
  if ((hasMin || hasMax) && NUMERIC_TYPES[entry.type] !== true) {
    issues.push(`${where}: 只有数值类型允许 min/max`)
  }
}

/** V8：requires 语法、引用路径与自环。 */
function checkRequires(entry: FieldEntry, knownPaths: readonly string[] | undefined, issues: string[]): void {
  if (entry.requires === undefined) {
    return
  }
  const where = entry.id
  const parsed = parseRequires(entry.requires)
  const malformed = `${where}: requires 格式非法（需要 <路径>=<值> 或 <路径>!=<值>）`
  if (parsed === undefined) {
    issues.push(malformed)
    return
  }
  if (!PATH_PATTERN.test(parsed.path) || parsed.value.length === 0 || /\s/.test(parsed.value)) {
    issues.push(malformed)
    return
  }
  if (knownPaths !== undefined && !knownPaths.includes(parsed.path)) {
    issues.push(`${where}: requires 引用未知路径 ${parsed.path}`)
    return
  }
  if (parsed.path === entry.key) {
    issues.push(`${where}: requires 引用自身`)
  }
}

/**
 * V12：`appliesTo` 的域是「轨道类型 / 层类型与轨道子类型 / 命名空间 id」。
 *
 * `ObjectDef.appliesTo` 的语义是「限定层类型或轨道子类型」（`spi/ObjectDef.java:32`），
 * 唯一消费点按 OVERLAY 的 `layer_type` 比较（`script/object/ObjectValidator.java:697-700`），
 * 真值是 `fade` / `image` / `subtitle` —— 不是轨道类型名，因此这里必须接受子类型 token。
 */
function checkAppliesTo(entry: FieldEntry, issues: string[]): void {
  if (entry.appliesTo === undefined) {
    return
  }
  for (const item of entry.appliesTo) {
    if (TRACK_ORDER.includes(item)) {
      continue
    }
    if (SUBTYPE_PATTERN.test(item)) {
      continue
    }
    if (MOD_ID_PATTERN.test(item)) {
      continue
    }
    issues.push(`${entry.id}: appliesTo 含非法项 ${item}`)
  }
}

/**
 * V8b：`requires` 右侧字面量能否按被引用字段的 `type` 解析。
 *
 * `enum` 必须命中 `enumValues`；`bool`/`boolean` 只认 true/false；`int` 只认整数；
 * `float`/`number` 只认有限数；`nullable_float` 额外接受 null；`string`/`ref` 接受任意非空。
 * 其余类型（struct / object / array 等）没有可判定的字面量形态，交给引用方自行处理。
 */
function requiresLiteralMatches(entry: FieldEntry, literal: string): boolean {
  switch (entry.type) {
    case 'enum':
      return entry.enumValues !== undefined && entry.enumValues.includes(literal)
    case 'bool':
    case 'boolean':
      return literal === 'true' || literal === 'false'
    case 'int':
      return /^[+-]?\d+$/.test(literal)
    case 'float':
    case 'number':
      return literal.trim().length > 0 && Number.isFinite(Number(literal))
    case 'nullable_float':
      if (literal === 'null') {
        return true
      }
      return literal.trim().length > 0 && Number.isFinite(Number(literal))
    case 'string':
    case 'ref':
      return literal.length > 0
    default:
      return true
  }
}

/** 轨道内 `requires` 依赖边：只保留同轨已登记、且不是自环的引用。 */
function requiresEdges(objects: readonly FieldEntry[]): Map<string, string> {
  const known = new Set(objects.map((entry) => entry.key))
  const edges = new Map<string, string>()
  for (const entry of objects) {
    if (entry.requires === undefined) {
      continue
    }
    const parsed = parseRequires(entry.requires)
    if (parsed === undefined || parsed.path === entry.key || !known.has(parsed.path)) {
      continue
    }
    edges.set(entry.key, parsed.path)
  }
  return edges
}

/** 把环旋转到以最小 key 起算，作为去重键。 */
function canonicalCycle(keys: readonly string[]): string {
  let start = 0
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i] < keys[start]) {
      start = i
    }
  }
  return [...keys.slice(start), ...keys.slice(0, start)].join(' -> ')
}

/** V8c：`requires` 跨字段环（A 依赖 B、B 依赖 A）。自环由 `checkRequires` 单独报。 */
function checkRequiresCycles(objects: readonly FieldEntry[], issues: string[]): void {
  const byKey = new Map(objects.map((entry) => [entry.key, entry]))
  const edges = requiresEdges(objects)
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const reported = new Set<string>()

  const visit = (key: string): void => {
    const status = state.get(key)
    if (status === 2) {
      return
    }
    if (status === 1) {
      const cycle = stack.slice(stack.indexOf(key))
      const canonical = canonicalCycle(cycle)
      if (!reported.has(canonical)) {
        reported.add(canonical)
        const entry = byKey.get(key)
        issues.push(`${entry?.id ?? key}: requires 环 ${[...cycle, key].join(' -> ')}`)
      }
      return
    }
    state.set(key, 1)
    stack.push(key)
    const next = edges.get(key)
    if (next !== undefined) {
      visit(next)
    }
    stack.pop()
    state.set(key, 2)
  }

  for (const key of [...edges.keys()].sort()) {
    visit(key)
  }
}

/** V8d：`requires` 右侧字面量与被引用字段的 `type` 不符。 */
function checkRequiresLiterals(
  known: ReadonlyMap<string, FieldEntry>,
  entries: readonly FieldEntry[],
  issues: string[],
): void {
  for (const entry of entries) {
    if (entry.requires === undefined) {
      continue
    }
    const parsed = parseRequires(entry.requires)
    if (parsed === undefined) {
      continue
    }
    const referenced = known.get(parsed.path)
    if (referenced === undefined || requiresLiteralMatches(referenced, parsed.value)) {
      continue
    }
    issues.push(`${entry.id}: requires 值 ${parsed.value} 不匹配被引用字段 type=${referenced.type}`)
  }
}

/**
 * V8e：`position` 这类中间名不是合法叶子；存在同段声明的子路径即以中间名登记。
 *
 * `section` 是源码声明里的分组（`ObjectDef.section`）。OVERLAY 的 `color`（STRING、`layer`）与
 * `color.r/g/b`（FLOAT、`color`）是两条互不相干的事实（`TrackSchemas.java:418-445`），
 * 只有与子路径同段时才说明登记的是层级容器而非叶子。
 */
function checkIntermediatePath(entry: FieldEntry, objects: readonly FieldEntry[], issues: string[]): void {
  for (const other of objects) {
    if (other !== entry && other.section === entry.section && other.key.startsWith(`${entry.key}.`)) {
      issues.push(`${entry.id}: 中间名不是叶子（存在子路径）`)
      return
    }
  }
}

/** V9b：`unit` 只允许源码登记过的单位。 */
function checkUnit(entry: FieldEntry, issues: string[]): void {
  if (entry.unit !== undefined && !ALLOWED_UNITS.includes(entry.unit)) {
    issues.push(`${entry.id}: 未知 unit ${entry.unit}（允许 ${ALLOWED_UNITS.join('/')}）`)
  }
}

/** `PathParamKind` 与 `default` 的形态一致性。 */
function curveDefaultMatches(param: CurveParamEntry): boolean {
  const value = param.default
  switch (param.kind) {
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value)
    case 'INTEGER':
      return typeof value === 'number' && Number.isInteger(value)
    case 'BOOLEAN':
      return typeof value === 'boolean'
    case 'ENUM':
      return typeof value === 'string'
        && param.enumValues !== undefined
        && param.enumValues.length > 0
        && param.enumValues.includes(value)
    case 'TEXT':
      return typeof value === 'string'
    case 'POINT':
    case 'POINT_LIST':
    case 'NUMBER_LIST':
    case 'VECTOR':
      return typeof value === 'object' && value !== null
  }
}

/**
 * `MathModelRegistry` 的目录级检查：参数 key 唯一、参数类型在 `ModelParamType` 内、
 * 值域非空且只含 `ValueDomain` 的四个 key、`fallback` 必须是本目录已注册的模型类型。
 */
function checkModels(models: Record<string, ModelCatalog>, issues: string[]): void {
  const registered = new Set(Object.keys(models))
  for (const [type, model] of Object.entries(models)) {
    const where = `model.${type}`
    const seen = new Set<string>()
    for (const entry of model.params) {
      if (seen.has(entry.key)) {
        issues.push(`${entry.id}: 重复模型参数键`)
      }
      seen.add(entry.key)
      if (MODEL_PARAM_TYPES[entry.type] !== true) {
        issues.push(`${entry.id}: 非法模型参数 type=${entry.type}`)
      }
    }
    if (model.domains.length === 0) {
      issues.push(`${where}: domains 不能为空`)
    }
    for (const domain of model.domains) {
      if (!ALLOWED_MODEL_DOMAINS.includes(domain)) {
        issues.push(`${where}: domains 含非法值 ${domain}（允许 ${ALLOWED_MODEL_DOMAINS.join('/')}）`)
      }
    }
    if (!registered.has(model.fallback)) {
      issues.push(`${where}: fallback 未注册的模型类型 ${model.fallback}`)
    }
  }
}


/**
 * 单条自检：V1、V3、V4、V5、V6、V7、V8、V10、V11。
 *
 * `knownPaths` 给出时（轨道对象传本轨全部 key），V8 会检查引用路径是否存在。
 */
export function validateEntry(entry: FieldEntry, knownPaths?: readonly string[]): string[] {
  const issues: string[] = []
  const where = entry.id

  if (!PATH_PATTERN.test(entry.key)) {
    issues.push(`${where}: 非法对象路径`)
  }

  // V1b：`FieldEntry.id` 把 `key` 嵌在末尾（`meta.id` / `track.CAMERA.object.position.x` /
  // `trigger.location.condition.position`），`id` 与 `key` 对不上就是声明写错。
  if (!entry.id.endsWith(`.${entry.key}`)) {
    issues.push(`${where}: id 与 key 不一致`)
  }

  checkMode(entry, issues)

  if (entry.hasDefault && !defaultMatches(entry.type, entry.default)) {
    issues.push(`${where}: default 类型与 type=${entry.type} 不匹配`)
  }

  if (entry.type === 'enum') {
    const enumValues = entry.enumValues
    if (enumValues === undefined || enumValues.length === 0) {
      issues.push(`${where}: type=enum 需要非空 enumValues`)
    } else if (entry.hasDefault && !(typeof entry.default === 'string' && enumValues.includes(entry.default))) {
      issues.push(`${where}: default 不在 enumValues 内`)
    }
  }

  if (entry.nullable === true && entry.type !== 'nullable_float') {
    issues.push(`${where}: nullable 仅允许 type=nullable_float`)
  }

  checkRange(entry, issues)
  checkRequires(entry, knownPaths, issues)

  if (!isNonEmptyString(entry.sourceRef)) {
    issues.push(`${where}: 缺少 sourceRef`)
  }
  if (entry.section !== undefined && !isNonEmptyString(entry.section)) {
    issues.push(`${where}: section 必须为非空字符串`)
  }
  if (entry.group !== undefined && !isNonEmptyString(entry.group)) {
    issues.push(`${where}: group 必须为非空字符串`)
  }

  return issues
}

/** `CurveParamEntry` 自检：路径语法、sourceRef、枚举与 doc。 */
function validateCurveParam(type: string, param: CurveParamEntry): string[] {
  const issues: string[] = []
  const where = `curve.${type}.params.${param.key}`
  if (!PATH_PATTERN.test(param.key)) {
    issues.push(`${where}: 非法对象路径`)
  }
  if (!isNonEmptyString(param.sourceRef)) {
    issues.push(`${where}: 缺少 sourceRef`)
  }
  if (param.kind === 'ENUM') {
    if (param.enumValues === undefined || param.enumValues.length === 0) {
      issues.push(`${where}: kind=ENUM 需要非空 enumValues`)
    } else if (param.hasDefault && !(typeof param.default === 'string' && param.enumValues.includes(param.default))) {
      issues.push(`${where}: default 不在 enumValues 内`)
    }
  }
  // 可选且无默认（`fourier.cos/sin`、B-spline/NURBS 的可选 `knots`）是合法声明，跳过形态检查。
  if (!(param.default === null && (!param.hasDefault || !param.required)) && !curveDefaultMatches(param)) {
    issues.push(`${where}: default 与 kind=${param.kind} 不匹配`)
  }
  if (param.doc !== undefined && !isNonEmptyString(param.doc)) {
    issues.push(`${where}: doc 必须为非空字符串`)
  }
  return issues
}

/** 全目录自检：V1–V12，返回全部 issue；空数组即通过。 */
export function validateCatalog(catalog: FieldCatalog): string[] {
  const issues: string[] = []
  const idCounts = new Map<string, number>()
  const visited = new Set<FieldEntry>()

  const checkField = (entry: FieldEntry, knownPaths?: readonly string[]): void => {
    if (visited.has(entry)) {
      return
    }
    visited.add(entry)
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1)
    issues.push(...validateEntry(entry, knownPaths))
    checkUnit(entry, issues)
  }

  for (const entry of catalog.meta) {
    checkField(entry)
  }

  for (const track of Object.values(catalog.tracks)) {
    const knownPaths = [...track.playControl, ...track.objects].map((entry) => entry.key)
    const seen = new Set<string>()
    for (const entry of track.objects) {
      if (seen.has(entry.key)) {
        issues.push(`${entry.id}: 重复对象路径`)
      }
      seen.add(entry.key)
    }
    checkRequiresCycles(track.objects, issues)
    const byPath = new Map<string, FieldEntry>()
    for (const entry of [...track.playControl, ...track.objects]) {
      byPath.set(entry.key, entry)
    }
    checkRequiresLiterals(byPath, [...track.playControl, ...track.objects], issues)
    for (const entry of track.objects) {
      checkIntermediatePath(entry, track.objects, issues)
    }
    for (const entry of track.playControl) {
      checkField(entry, knownPaths)
      checkAppliesTo(entry, issues)
    }
    for (const entry of track.objects) {
      checkField(entry, knownPaths)
      checkAppliesTo(entry, issues)
    }
  }

  for (const group of Object.values(catalog.triggers.conditions)) {
    for (const entry of group) {
      checkField(entry)
    }
  }
  for (const entry of catalog.triggers.triggerFields) {
    checkField(entry)
  }

  for (const model of Object.values(catalog.models)) {
    for (const entry of model.params) {
      checkField(entry)
    }
  }
  checkModels(catalog.models, issues)

  for (const [type, curve] of Object.entries(catalog.curveTypes)) {
    const seenParams = new Set<string>()
    for (const param of curve.params) {
      if (seenParams.has(param.key)) {
        issues.push(`curve.${type}.params.${param.key}: 重复参数键`)
      }
      seenParams.add(param.key)
      if (param.key === 'type') {
        issues.push(`curve.${type}.params.${param.key}: 参数名与保留键 type 冲突`)
      }
      issues.push(...validateCurveParam(type, param))
    }
  }

  for (const section of Object.values(catalog.scriptStructure.sections)) {
    for (const entry of section) {
      checkField(entry)
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push(`${id}: 重复字段 id`)
    }
  }

  return issues
}
