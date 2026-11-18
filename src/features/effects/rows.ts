/**
 * 属性行派生（06-02 §4.1 / 06-09 §4.1）：属性面板与效果面板共用的唯一来源。
 *
 * 纯函数：同样的片段 + 目录 + 播放头得到同样的行；不缓存、不写文档、不写会话。
 *
 * 行集合 = 当前轨道**全部适用叶子**（含未设置），加上 `clip.objects` 里目录不认识的路径。
 * 组只是 `section`/`group` 的 UI 归类，不创建运行时效果实例。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { FieldEntry } from '../../core/schema/types.ts'
import { isFiniteNumber, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, ObjectKeyframe } from '../../core/doc/types.ts'
import type { PropertyRow, RowMode, RowValueKind } from './types.ts'

/** 行派生的输入。 */
export interface RowSource {
  clipKey: string
  /** 片段原始 JSON（`objects` 的宿主）。 */
  clip: JsonObject
  /** 轨道类型（目录查询用）。 */
  trackType: string
  catalog: CatalogIndex
}

/** 片段时长与无限性（轴外判定 / 必填判定用）。 */
export interface ClipTiming {
  duration: number
  infinite: boolean
}

/** 读片段时长：`duration < 0` 或 `loop && loop_count < 0` 视为无限。 */
export function readClipTiming(clip: JsonObject): ClipTiming {
  const duration = isFiniteNumber(clip.duration) ? clip.duration : 0
  const loop = clip.loop === true
  const loopCount = isFiniteNumber(clip.loop_count) ? clip.loop_count : -1
  const infinite = duration < 0 || (loop && loopCount < 0)
  return { duration, infinite }
}

/** 读一个属性对象的 `value` / `keyframes`（不解释语义，只搬值）。 */
function readProperty(raw: unknown): {
  hasValue: boolean
  value?: unknown
  keyframes: ObjectKeyframe[]
  hasKeyframes: boolean
} {
  if (!isJsonObject(raw)) {
    return { hasValue: false, keyframes: [], hasKeyframes: false }
  }
  const hasValue = Object.prototype.hasOwnProperty.call(raw, 'value')
  const framesRaw = raw.keyframes
  const keyframes: ObjectKeyframe[] = []
  if (Array.isArray(framesRaw)) {
    for (const frame of framesRaw) {
      if (isJsonObject(frame) && isFiniteNumber(frame.time)) {
        keyframes.push({ time: frame.time, value: frame.value })
      }
    }
  }
  return {
    hasValue,
    ...(hasValue ? { value: raw.value } : {}),
    keyframes,
    hasKeyframes: Array.isArray(framesRaw),
  }
}

/** 未分组的组键（目录既无 section 也无 group）。 */
export const UNGROUPED_KEY = ''

/** 未分组的显示标签。 */
export const UNGROUPED_LABEL = '未分组'

/**
 * 未知/扩展组的组键。
 *
 * 必须与未分组（`''`）区分：未分组是"目录认识但没归类"，未知组是"目录根本不认识"，
 * 两者的可编辑性不同（后者只读），混在一个组里会让只读行看起来像普通未分类字段。
 */
export const UNKNOWN_GROUP_KEY = '::unknown'

/** 未知/扩展组的显示标签。 */
export const UNKNOWN_GROUP_LABEL = '未知 / 扩展'

/** 组键：`section` 优先，其次 `group`，都没有归入未分组（`''`）。 */
export function groupKeyOf(def: FieldEntry | undefined): string {
  if (def === undefined) {
    return UNGROUPED_KEY
  }
  if (def.section !== undefined && def.section.length > 0) {
    return def.section
  }
  if (def.group !== undefined && def.group.length > 0) {
    return def.group
  }
  return UNGROUPED_KEY
}

/**
 * 组键 → 显示标签。
 *
 * 02 目录只提供英文 `section` / `group` 键，**没有 `labelKey`**（`grep labelKey` 在
 * `catalog/` 下零命中）。旧 WebUI 有一张 `getSectionLabel` 表（`legacy/src/schema.ts:154`），
 * 这里按目录实际出现的 22 个 section 重建同一类映射——不是复制旧代码，是把"英文键不该
 * 直接当界面文案"这条补齐。未登记的键原样返回，不编造翻译。
 */
const SECTION_LABELS: Readonly<Record<string, string>> = {
  audio: '音频',
  blend: '混合',
  breath: '呼吸',
  camera: '相机',
  color: '调色',
  composite: '合成',
  curve: '曲线',
  event: '事件',
  gradient: '渐变',
  layer: '图层',
  layout: '布局',
  letterbox: '黑边',
  lut: 'LUT',
  mask: '遮罩',
  modifier: '覆盖链',
  motion: '运动模型',
  orientation: '朝向',
  position: '位置',
  selector: '选择器',
  source: '源',
  text: '文本',
  transition: '过渡',
}

/** 组标签：未分组与未知组用专门文案，其余查映射表，未登记的键原样返回。 */
export function groupLabelOf(key: string): string {
  if (key === UNGROUPED_KEY) {
    return UNGROUPED_LABEL
  }
  if (key === UNKNOWN_GROUP_KEY) {
    return UNKNOWN_GROUP_LABEL
  }
  return SECTION_LABELS[key] ?? key
}

/** 行标签：目录 `labelKey` 末段优先，其次路径末段。 */
export function labelOf(path: string, def: FieldEntry | undefined): string {
  const labelKey = def?.labelKey
  if (labelKey !== undefined && labelKey.length > 0) {
    const dot = labelKey.lastIndexOf('.')
    return dot < 0 ? labelKey : labelKey.slice(dot + 1)
  }
  const dot = path.lastIndexOf('.')
  return dot < 0 ? path : path.slice(dot + 1)
}

/** 行模式：目录 `mode`，未知路径为 `unknown`。 */
function modeOf(def: FieldEntry | undefined): RowMode {
  if (def === undefined) {
    return 'unknown'
  }
  return def.mode ?? 'value'
}

/** 值来源分类：未设置 / 静态 / 动画 / 事件。 */
function valueKindOf(
  mode: RowMode,
  present: boolean,
  keyframes: readonly ObjectKeyframe[],
): RowValueKind {
  if (mode === 'event') {
    return 'event'
  }
  if (!present) {
    return 'unset'
  }
  if (keyframes.length > 0) {
    return 'animated'
  }
  return 'static'
}

/**
 * 派生一个片段的全部属性行。
 *
 * 顺序：目录声明顺序（`playControl` 在前，`objects` 在后），未知路径追加在末尾按文档键序。
 * 未登记路径只读，但**不隐藏**——它们必须能被看见并被关闭动画（06-02 §三）。
 */
export function buildPropertyRows(source: RowSource): PropertyRow[] {
  const objectsRaw = source.clip.objects
  const objects: JsonObject = isJsonObject(objectsRaw) ? objectsRaw : {}
  const rows: PropertyRow[] = []
  const seen = new Set<string>()

  const track = source.catalog.track(source.trackType)
  const declarations: FieldEntry[] = track === undefined
    ? []
    : [...track.playControl, ...track.objects]

  for (const def of declarations) {
    const path = def.key
    if (seen.has(path)) {
      continue
    }
    seen.add(path)
    const present = Object.prototype.hasOwnProperty.call(objects, path)
    const property = present ? readProperty(objects[path]) : { hasValue: false, keyframes: [], hasKeyframes: false }
    const mode = modeOf(def)
    rows.push({
      clipKey: source.clipKey,
      path,
      def,
      label: labelOf(path, def),
      present,
      mode,
      type: def.type,
      interp: def.interp ?? 'none',
      ...(property.hasValue ? { value: property.value } : {}),
      hasValue: property.hasValue,
      keyframes: property.keyframes,
      unknown: false,
      ...(def.section === undefined ? {} : { section: def.section }),
      ...(def.group === undefined ? {} : { group: def.group }),
      required: def.required,
      hasDefault: def.hasDefault,
      ...(def.hasDefault ? { defaultValue: def.default } : {}),
      ...(def.unit === undefined ? {} : { unit: def.unit }),
      ...(def.enumValues === undefined ? {} : { enumValues: def.enumValues }),
      ...(def.min === undefined ? {} : { min: def.min }),
      ...(def.max === undefined ? {} : { max: def.max }),
      nullable: def.type === 'nullable_float',
      valueKind: valueKindOf(mode, present, property.keyframes),
      groupKey: groupKeyOf(def),
      groupLabel: groupLabelOf(groupKeyOf(def)),
    })
  }

  // 未知路径：目录未声明但文档里存在。只读、单独归组，不猜控件。
  for (const path of Object.keys(objects)) {
    if (seen.has(path)) {
      continue
    }
    seen.add(path)
    const property = readProperty(objects[path])
    rows.push({
      clipKey: source.clipKey,
      path,
      label: labelOf(path, undefined),
      present: true,
      mode: 'unknown',
      type: 'unknown',
      interp: 'none',
      ...(property.hasValue ? { value: property.value } : {}),
      hasValue: property.hasValue,
      keyframes: property.keyframes,
      unknown: true,
      required: false,
      hasDefault: false,
      nullable: false,
      valueKind: valueKindOf('unknown', true, property.keyframes),
      // 未知路径必须有独立组键，不能与「未分组」(`''`) 混在同一个组里。
      groupKey: UNKNOWN_GROUP_KEY,
      groupLabel: UNKNOWN_GROUP_LABEL,
    })
  }

  return rows
}

/** 行是否必填缺失（必填、无显式值、无范围内帧、目录无默认值）。 */
export function isRequiredMissing(row: PropertyRow, timing: ClipTiming): boolean {
  if (!row.required || row.hasDefault) {
    return false
  }
  if (row.hasValue) {
    return false
  }
  const hasEffective = row.keyframes.some((frame) => timing.infinite || frame.time <= timing.duration)
  return !hasEffective
}

/** 轴外帧数：有限片段 `time > duration`；无限片段恒 0（06-02 §4.3）。 */
export function outOfRangeCount(row: PropertyRow, timing: ClipTiming): number {
  if (timing.infinite) {
    return 0
  }
  return row.keyframes.filter((frame) => frame.time > timing.duration).length
}

/** 行的 t=0 有效值：首帧 > 显式 value > 目录默认值（`undefined` = 都没有）。 */
export function effectiveStaticValue(row: PropertyRow): unknown {
  if (row.keyframes.length > 0) {
    return row.keyframes[0].value
  }
  if (row.hasValue) {
    return row.value
  }
  if (row.hasDefault) {
    return row.defaultValue
  }
  return undefined
}
