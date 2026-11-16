/**
 * 模组字段目录的类型定义。
 *
 * 字段事实的唯一来源是主工作区 Java 源码（`script/schema/` 与 `spi/`）；本文件只描述目录形状。
 */

export type Segment = 'meta' | 'tracks' | 'triggers' | 'models' | 'curveTypes' | 'script_structure'

/**
 * FieldDef 的类型集合（meta / tracks.playControl / triggers / models / script_structure）。
 *
 * `number` 与 `boolean` 只用于 script_structure 段：`SchemaExporter.field()` 对脚本级结构使用
 * 这两个原始类型名，目录逐字抄录，不并入 float / bool。
 */
export type FieldType =
  | 'string' | 'int' | 'float' | 'bool' | 'enum' | 'object' | 'array' | 'map'
  | 'number' | 'boolean'

/** ObjectDef 的类型集合（tracks.objects）。 */
export type ObjectType =
  | 'float' | 'int' | 'bool' | 'string' | 'enum' | 'ref' | 'nullable_float' | 'struct' | 'event_record'

/** PathParamKind（curveTypes.params）；用枚举原样大写名，不做小写转换。 */
export type ParamKind =
  | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ENUM' | 'TEXT'
  | 'POINT' | 'POINT_LIST' | 'NUMBER_LIST' | 'VECTOR'

/** 数学模型的参数类型（MathModelRegistry 用 FieldDef）。 */
export type ModelParamType =
  | 'float' | 'int' | 'bool' | 'string' | 'enum' | 'model' | 'model_list' | 'object' | 'array'

/** `ScreenLayer.Space`：层的所属空间（HUD 界面 / 世界渲染 / 视角 / 后处理）。 */
export type ScreenLayerSpace = 'HUD' | 'WORLD' | 'VIEW' | 'POST'

/** 第三方已发现的类型：目录未声明、运行时登记在 `SourceRegistry` 的类型及其声明出处。 */
export type DiscoveredType = { type: string; sourceRef: string }

export type FieldMode = 'value' | 'animated' | 'event'
export type FieldInterp = 'none' | 'linear' | 'angle' | 'geometric' | 'step'
export type CurveCapability =
  | 'ANALYTIC_ARC_LENGTH' | 'ANALYTIC_SECOND_DERIVATIVE' | 'PERIODIC'
  | 'RATIONAL_WEIGHTS' | 'KNOT_VECTOR'

export interface FieldEntry {
  /** 全局稳定键：`meta.id`、`track.CAMERA.object.position.x`、`trigger.location.condition.position` */
  id: string
  segment: Segment
  /** 段内定位：轨道类型 / 触发器类型 / 模型类型 / 曲线类型 / 结构段名；无作用域为空数组 */
  scope: string[]
  key: string
  type: FieldType | ObjectType | ModelParamType
  mode?: FieldMode
  interp?: FieldInterp
  default: unknown
  hasDefault: boolean
  required: boolean
  enumValues?: string[]
  nullable?: boolean
  min?: number
  max?: number
  requires?: string
  appliesTo?: string[]
  section?: string
  group?: string
  labelKey?: string
  unit?: string
  doc?: string
  /** `类名#方法:行号` */
  sourceRef: string
}

export interface CurveParamEntry {
  key: string
  kind: ParamKind
  default: unknown
  hasDefault: boolean
  required: boolean
  enumValues?: string[]
  doc?: string
  sourceRef: string
}

export interface TrackCatalog {
  playControl: FieldEntry[]
  objects: FieldEntry[]
}

export interface TriggerCatalog {
  types: string[]
  conditions: Record<string, FieldEntry[]>
  triggerFields: FieldEntry[]
}

export interface ModelCatalog {
  params: FieldEntry[]
  /** scalar / angle / vector / color，来自 ValueDomain */
  domains: string[]
  maxDepth: number
  maxNodes: number
  fallback: string
}

export interface CurveCatalog {
  capabilities: CurveCapability[]
  params: CurveParamEntry[]
}

export interface ScriptStructureCatalog {
  sections: Record<string, FieldEntry[]>
  enums: Record<string, string[]>
}

export interface FieldCatalog {
  catalogHash: string
  sourceCommit: string
  meta: FieldEntry[]
  screenLayers: {
    fixed: string[]
    spaces: Record<string, ScreenLayerSpace>
    valueType: 'bool'
    dynamic: true
  }
  tracks: Record<string, TrackCatalog>
  triggers: TriggerCatalog
  models: Record<string, ModelCatalog>
  curveTypes: Record<string, CurveCatalog>
  scriptStructure: ScriptStructureCatalog
  /** 第三方「已发现」登记：目录未声明、运行时登记的类型；只登记不查询。 */
  discovered: { tracks: DiscoveredType[]; triggers: DiscoveredType[] }
}

export type DriftKind =
  | 'missing' | 'added' | 'typeChanged' | 'enumChanged'
  | 'defaultChanged' | 'rangeChanged' | 'dependencyChanged' | 'segmentMissing'

export interface DriftEntry {
  segment: Segment
  scope: string[]
  key: string
  kind: DriftKind
  local?: unknown
  remote?: unknown
  sourceRef?: string
}

export interface DriftReport {
  catalogHashLocal: string
  catalogHashRemote: string
  gameVersion: string
  modVersion: string
  capturedAt: string
  entries: DriftEntry[]
}
