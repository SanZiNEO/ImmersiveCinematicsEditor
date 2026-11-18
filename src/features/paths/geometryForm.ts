/**
 * 07-06 几何表单的纯逻辑：schema 驱动的控件描述、锚点类别、点位二选一、点列表 /
 * 数值列表操作、字段级错误定位。
 *
 * 不维护第二份类型 → 参数硬编码表：字段清单、控件形态、枚举选项、默认值都从
 * `schema.curveTypes`（`catalog.curveType`）派生；数量 / 范围 / 互斥校验复用 core
 * `validateGeometry`，错误字段前缀保留为 `geometry.xxx`。
 *
 * 未知类型 / 未知参数一律保留原文并给警告，不补默认值、不自动改写、不静默删除。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { ParamKind } from '../../core/schema/types.ts'
import { CURVE_TYPES } from '../../core/schema/catalog/curveTypes.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import { validateGeometry, type GeometryIssue } from '../../core/paths/geometry.ts'
import {
  PATH_LINE_ALIAS,
  isKnownGeometryType,
  isPathObject,
} from '../../core/paths/types.ts'

/** 锚点三分类（07-06 §三 表）。 */
export type GeometryAnchor = 'FREE' | 'START' | 'ENDPOINTS'

const ANCHOR_LABELS: Record<GeometryAnchor, string> = {
  FREE: '几何自由（端点只做绑定，形状由参数决定）',
  START: '起点锚定（起点 = 片段起点，终点由几何决定）',
  ENDPOINTS: '端点绑定（几何起终点 = 片段端点）',
}

/** 一个参数控件描述（形态由目录 `ParamKind` 决定）。 */
export interface ParamControl {
  key: string
  kind: ParamKind
  required: boolean
  hasDefault: boolean
  defaultValue: unknown
  enumValues: readonly string[]
  doc: string
}

/** 一次表单描述：当前类型的控件 + 保留的未知参数 + 警告。 */
export interface GeometryFormModel {
  rawType: string
  known: boolean
  anchor: GeometryAnchor
  anchorLabel: string
  controls: ParamControl[]
  /** 目录未声明、但文档里原样保留的参数。 */
  unknownParams: Array<{ key: string; value: JsonValue }>
  warnings: string[]
}

/** 类型下拉：`line` 别名置顶，其余按注册表顺序。 */
export function geometryTypeOptions(): string[] {
  return [PATH_LINE_ALIAS, ...CURVE_TYPES]
}

/** 锚点类别：`arc` / `ellipse` / 周期 `fourier` = FREE；`clothoid` = START；其余 ENDPOINTS。 */
export function anchorOf(geometry: JsonObject | undefined): GeometryAnchor {
  if (geometry === undefined) {
    return 'ENDPOINTS'
  }
  const type = typeof geometry.type === 'string' ? geometry.type : ''
  if (type === 'clothoid') {
    return 'START'
  }
  if (type === 'arc' || type === 'ellipse') {
    return 'FREE'
  }
  if (type === 'fourier') {
    return geometry.periodic !== false ? 'FREE' : 'ENDPOINTS'
  }
  return 'ENDPOINTS'
}

/** 描述一份几何对象；未知类型 / 未知参数保留原文并进入 `warnings`。 */
export function describeGeometry(
  catalog: CatalogIndex | undefined,
  geometry: JsonValue | undefined,
): GeometryFormModel {
  const rawType = isPathObject(geometry) && typeof geometry.type === 'string' ? geometry.type : ''
  const known = rawType !== '' && isKnownGeometryType(rawType)
  const warnings: string[] = []
  const unknownParams: Array<{ key: string; value: JsonValue }> = []

  const registryType = rawType === PATH_LINE_ALIAS ? 'linear' : rawType
  const entry = known && catalog !== undefined ? catalog.curveType(registryType) : undefined

  const controls: ParamControl[] = []
  const allowedKeys = new Set<string>(['type'])
  if (entry !== undefined) {
    for (const param of entry.params) {
      allowedKeys.add(param.key)
      controls.push({
        key: param.key,
        kind: param.kind,
        required: param.required,
        hasDefault: param.hasDefault,
        defaultValue: param.default,
        enumValues: param.enumValues ?? [],
        doc: param.doc ?? '',
      })
    }
  }

  if (rawType === '') {
    warnings.push('几何类型缺失（必填 {type, ...参数}）')
  } else if (!known) {
    warnings.push(`未知曲线类型 '${rawType}'；参数原样保留，不自动改写`)
  }

  if (isPathObject(geometry)) {
    for (const key of Object.keys(geometry)) {
      if (key === 'type') {
        continue
      }
      if (!allowedKeys.has(key)) {
        unknownParams.push({ key, value: geometry[key] })
        warnings.push(`未知参数 ${key}（${rawType || '未知类型'}）；原样保留，待作者显式处理`)
      }
    }
  }

  return {
    rawType,
    known,
    anchor: anchorOf(isPathObject(geometry) ? geometry : undefined),
    anchorLabel: ANCHOR_LABELS[anchorOf(isPathObject(geometry) ? geometry : undefined)],
    controls,
    unknownParams,
    warnings,
  }
}

/** 字段级错误（复用 core `validateGeometry`，`field` 前缀保留为 `geometry.xxx`）。 */
export function geometryFieldIssues(geometry: JsonValue | undefined): GeometryIssue[] {
  return validateGeometry(geometry, 'geometry')
}

/** 切换类型后的干净几何：只保留 `type`，旧参数清空（撤销恢复由命令层快照保证）。 */
export function blankGeometry(type: string): JsonObject {
  return { type }
}

/** 是否为 `line` 别名（写盘保留原字符串，不自动改写成 `linear`）。 */
export function isLineAlias(type: string): boolean {
  return type === PATH_LINE_ALIAS
}

// ── 点位二选一 ─────────────────────────────────────────────────────────────

export type PointMode = 'absolute' | 'relative'

const ABSOLUTE_KEYS = ['x', 'y', 'z'] as const
const RELATIVE_KEYS = ['dx', 'dy', 'dz'] as const

/** 点位写法；`null` = 混写 / 空 / 非法。 */
export function detectPointMode(point: JsonValue | undefined): PointMode | null {
  if (!isPathObject(point)) {
    return null
  }
  const hasAbsolute = ABSOLUTE_KEYS.some((key) => point[key] !== undefined)
  const hasRelative = RELATIVE_KEYS.some((key) => point[key] !== undefined)
  if (hasAbsolute && hasRelative) {
    return null
  }
  if (hasAbsolute) {
    return 'absolute'
  }
  if (hasRelative) {
    return 'relative'
  }
  return null
}

/** 空点位（指定写法，分量全 0）。 */
export function emptyPoint(mode: PointMode): JsonObject {
  return mode === 'absolute'
    ? { x: 0, y: 0, z: 0 }
    : { dx: 0, dy: 0, dz: 0 }
}

/**
 * 切换点位写法：保留目标组已有分量，清空另一组；缺失分量补 0。
 * 混写输入先丢弃旧组再补目标组。
 */
export function convertPointMode(point: JsonValue | undefined, mode: PointMode): JsonObject {
  const source = isPathObject(point) ? point : {}
  const keys = mode === 'absolute' ? ABSOLUTE_KEYS : RELATIVE_KEYS
  const result: JsonObject = {}
  for (const key of keys) {
    const value = source[key]
    result[key] = typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  return result
}

// ── 点列表操作（返回新数组；不就地改草稿） ────────────────────────────────

function asPointList(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is JsonObject => isPathObject(item))
}

/** 追加一个空点（写法跟随列表首个点；缺省绝对）。 */
export function addPointItem(list: JsonValue | undefined): JsonObject[] {
  const current = asPointList(list)
  const mode = detectPointMode(current[0]) ?? 'absolute'
  return [...current, emptyPoint(mode)]
}

/** 删除指定下标点。 */
export function removePointItem(list: JsonValue | undefined, index: number): JsonObject[] {
  const current = asPointList(list)
  if (index < 0 || index >= current.length) {
    return current
  }
  return current.filter((_, itemIndex) => itemIndex !== index)
}

/** 上移（direction=-1）/ 下移（direction=1）；越界返回原数组。 */
export function movePointItem(
  list: JsonValue | undefined,
  index: number,
  direction: -1 | 1,
): JsonObject[] {
  const current = asPointList(list)
  const target = index + direction
  if (index < 0 || index >= current.length || target < 0 || target >= current.length) {
    return current
  }
  const next = current.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

// ── 数值列表操作 ──────────────────────────────────────────────────────────

function asNumberList(value: JsonValue | undefined): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
}

/** 追加一个 0 权重 / 系数 / 节点。 */
export function addNumberItem(list: JsonValue | undefined): number[] {
  return [...asNumberList(list), 0]
}

/** 删除指定下标数值。 */
export function removeNumberItem(list: JsonValue | undefined, index: number): number[] {
  const current = asNumberList(list)
  if (index < 0 || index >= current.length) {
    return current
  }
  return current.filter((_, itemIndex) => itemIndex !== index)
}
