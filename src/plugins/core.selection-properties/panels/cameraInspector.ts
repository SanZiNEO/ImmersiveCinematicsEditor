/**
 * 相机「位置 / 朝向 / 呼吸」卡片的局部辅助（只服务本目录三个卡片）。
 *
 * 只做三件事，都不写文档、不引 Vue：
 * - 按播放头从 schema 行取样分支值（`sampleValue` 同口径；无帧回落显式静态值 / 目录缺省）；
 * - 行是父面板派的完整 schema 行：这里只换界面标签 / 标出不适用的原因，不改 `path`、不造行；
 * - 点源 `ref` 的预设选项（preset 把任意原始引用映射回选项，坐标三轴仍是独立 schema 行）。
 */
import { sampleValue } from '../../../features/effects/easing.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import { parsePointSource } from '../../../features/authoring/pointSource.ts'

/** 卡片渲染用的 `reference` 选项形状（由通用行控件解释）。 */
export type CameraReferenceOptions = NonNullable<InspectorValueOptions['reference']>

/** 行集合 → 路径索引。 */
export function rowsByPath(rows: readonly PropertyRow[]): ReadonlyMap<string, PropertyRow> {
  const map = new Map<string, PropertyRow>()
  for (const row of rows) {
    map.set(row.path, row)
  }
  return map
}

/**
 * 按播放头取样一个行值：范围内关键帧优先，其次显式静态值，最后目录缺省。
 * 没有行 / 没有任何来源 → `undefined`（调用方给分支缺省）。
 */
export function sampledValue(
  row: PropertyRow | undefined,
  playhead: number,
  timing: ClipTiming,
): unknown {
  if (row === undefined) {
    return undefined
  }
  const sampled = sampleValue({ frames: row.keyframes, interp: row.interp, time: playhead, timing })
  if (sampled.ok) {
    return sampled.value
  }
  if (row.hasValue) {
    return row.value
  }
  return row.hasDefault ? row.defaultValue : undefined
}

/** 枚举 / ref 分支值：非字符串按缺省。 */
export function sampledString(
  row: PropertyRow | undefined,
  playhead: number,
  timing: ClipTiming,
  fallback: string,
): string {
  const value = sampledValue(row, playhead, timing)
  return typeof value === 'string' ? value : fallback
}

/**
 * 值型（value-only）字段的静态值：显式 `value` 优先，其次目录缺省。
 * 这类字段不随时间变化，卡片不需要播放头。
 */
export function staticValue(row: PropertyRow | undefined): unknown {
  if (row === undefined) {
    return undefined
  }
  if (row.hasValue) {
    return row.value
  }
  return row.hasDefault ? row.defaultValue : undefined
}

/** 只换界面标签；路径、值、帧、可用性原样保留。 */
export function relabel(row: PropertyRow, label: string): PropertyRow {
  return row.label === label ? row : { ...row, label }
}

/** 标记「运行时忽略 / 依赖不满足」；值仍保留，行控件只读并展示原因。 */
export function withUnavailable(row: PropertyRow, reason: string): PropertyRow {
  return { ...row, unavailableReason: reason }
}

/** 行里是否显式存在（值、等于默认的值、空帧数组都算）。 */
export function isPresent(row: PropertyRow | undefined): boolean {
  return row !== undefined && row.present
}

/** 点源字段：决定可选取的预设与默认项文案。 */
export type CameraRefField =
  | 'position_origin'
  | 'facing_target'
  | 'yaw_base_from'
  | 'yaw_base_to'
  | 'facing_entity'
  | 'yaw_base_selector'

/**
 * 点源 `reference` 选项。
 *
 * 选项 `value` 是**合法原始字段值**（`PropertyValueForm` 选中形态时原样写入），
 * 因此这里只放目录/运行时可接受的字符串；`preset` 把已存的自定义值归到同一形态，
 * 载荷输入再把它原样显示出来（例如自定义选择器、带半径的方块 id）。
 *
 * `defaultLabel` 只影响「默认」项的文案（基准原点在基准轴分支是隐式 @p）。
 * 选择器专用字段（方向实体 / 基准选择器）只给选择器形态，不写出别的点源种类。
 */
export function pointReference(field: CameraRefField, defaultLabel = '未指定'): CameraReferenceOptions {
  const selectorOnly = field === 'facing_entity' || field === 'yaw_base_selector'
  if (selectorOnly) {
    return {
      choices: [
        { value: '', label: defaultLabel },
        { value: '@p', label: '指定选择器' },
      ],
      // 任何非空引用都归到选择器形态：载荷输入仍显示原始串，已有自定义值不丢。
      preset: (value) => (value === '' ? '' : '@p'),
      payloads: {
        '@p': { label: '选择器', placeholder: '@p' },
      },
    }
  }

  return {
    choices: [
      { value: '', label: defaultLabel },
      { value: 'player', label: '玩家激活位置' },
      { value: 'coordinate', label: '指定坐标' },
      { value: '@p', label: '实体选择器' },
      { value: 'block:minecraft:stone', label: '附近方块中心' },
      { value: 'minecraft:village_plains', label: '结构中心' },
    ],
    preset: (value) => {
      switch (parsePointSource(value).kind) {
        case 'empty': return ''
        case 'player': return 'player'
        case 'coordinate': return 'coordinate'
        case 'selector': return '@p'
        case 'block': return 'block:minecraft:stone'
        case 'structure': return 'minecraft:village_plains'
        default: return 'minecraft:village_plains'
      }
    },
    payloads: {
      '@p': { label: '选择器', placeholder: '@p' },
      'block:minecraft:stone': { label: '方块 ID（可带半径）', placeholder: 'minecraft:stone', prefix: 'block:' },
      'minecraft:village_plains': { label: '结构 ID', placeholder: 'minecraft:village_plains' },
    },
  }
}

/**
 * 原始点源引用能否提供实体身体朝向（`facing_source=entity` 的回落条件）。
 * 空串在基准轴分支是隐式 `@p`；`player` 是激活位置，没有身体朝向。
 */
export function hasEntityFacing(origin: string): boolean {
  if (origin === '') {
    return true
  }
  return origin.startsWith('@') || origin.startsWith('uuid:')
}

/**
 * `position_origin` 的形态按运行时口径分类（只用于分支提示，不解析世界坐标）。
 * 空串按基准轴分支的隐式 `@p` 算；世界轴分支的「空 = 玩家激活位置」由调用方另行提示。
 */
export function originKindOf(origin: string): 'selector' | 'player' | 'coordinate' | 'block' | 'structure' {
  if (origin === '') {
    return 'selector'
  }
  const form = parsePointSource(origin)
  switch (form.kind) {
    case 'selector': return 'selector'
    case 'player': return 'player'
    case 'coordinate': return 'coordinate'
    case 'block': return 'block'
    default: return 'structure'
  }
}