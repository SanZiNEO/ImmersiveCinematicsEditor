/** 触发器字段：27 种类型、各型条件字段、触发器条目字段与 continuity 子字段。 */
import type { FieldEntry } from '../types.ts'

/**
 * 触发器条件字段的公共外壳：段 / 作用域 / 分组固定为触发器目录，其余逐条对应
 * `TriggerSchemas` 各方法里的 `m.put(...)`。
 */
function condition(
  trigger: string,
  key: string,
  field: {
    type: FieldEntry['type']
    default: unknown
    required?: boolean
    enumValues?: string[]
    sourceRef: string
  },
): FieldEntry {
  const entry: FieldEntry = {
    id: `trigger.${trigger}.condition.${key}`,
    segment: 'triggers',
    scope: [trigger],
    key,
    type: field.type,
    default: field.default,
    hasDefault: field.default !== null,
    required: field.required === true,
    section: 'info',
    sourceRef: field.sourceRef,
  }
  if (field.enumValues !== undefined && field.enumValues.length > 0) {
    entry.enumValues = field.enumValues
  }
  return entry
}

/** 所有触发器类型 id 列表，顺序 = `TriggerSchemas.typeList()`（`TriggerSchemas#typeList:23`）。 */
export const TRIGGER_TYPES: readonly string[] = [
  'login',
  'location',
  'advancement',
  'biome',
  'entity_kill',
  'death',
  'entity_interact',
  'block_interact',
  'item_on_interact',
  'dimension_change',
  'item_craft',
  'item_use',
  'item_consume',
  'item_release',
  'item_instant_use',
  'item_use_interrupt',
  'item_pickup',
  'item_drop',
  'xp',
  'dimension',
  'observation',
  'inventory',
  'structure',
  'gamestage',
  'facing',
  'all_of',
  'any',
]

/** 每种触发器类型的 conditions 字段表，顺序 = `TriggerSchemas.buildAll()`（`TriggerSchemas#buildAll:62`）。 */
export const TRIGGER_CONDITIONS: Record<string, FieldEntry[]> = {
  login: [],
  location: [
    condition('location', 'dimension', { type: 'string', default: '', sourceRef: 'TriggerSchemas#location:102' }),
    condition('location', 'position', { type: 'map', default: null, sourceRef: 'TriggerSchemas#location:103' }),
    condition('location', 'radius', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#location:104' }),
    condition('location', 'corner1', { type: 'map', default: null, sourceRef: 'TriggerSchemas#location:105' }),
    condition('location', 'corner2', { type: 'map', default: null, sourceRef: 'TriggerSchemas#location:106' }),
  ],
  advancement: [
    condition('advancement', 'advancement', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#advancement:112',
    }),
  ],
  biome: [
    condition('biome', 'biome', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#biome:118',
    }),
  ],
  entity_kill: [
    condition('entity_kill', 'entity', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#entityKill:124',
    }),
    condition('entity_kill', 'dimension', { type: 'string', default: '', sourceRef: 'TriggerSchemas#entityKill:125' }),
    condition('entity_kill', 'biome', { type: 'string', default: '', sourceRef: 'TriggerSchemas#entityKill:126' }),
    condition('entity_kill', 'position', { type: 'map', default: null, sourceRef: 'TriggerSchemas#entityKill:127' }),
    condition('entity_kill', 'radius', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#entityKill:128' }),
    condition('entity_kill', 'corner1', { type: 'map', default: null, sourceRef: 'TriggerSchemas#entityKill:129' }),
    condition('entity_kill', 'corner2', { type: 'map', default: null, sourceRef: 'TriggerSchemas#entityKill:130' }),
  ],
  death: [
    condition('death', 'dimension', { type: 'string', default: '', sourceRef: 'TriggerSchemas#death:137' }),
    condition('death', 'biome', { type: 'string', default: '', sourceRef: 'TriggerSchemas#death:138' }),
    condition('death', 'position', { type: 'map', default: null, sourceRef: 'TriggerSchemas#death:139' }),
    condition('death', 'radius', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#death:140' }),
    condition('death', 'corner1', { type: 'map', default: null, sourceRef: 'TriggerSchemas#death:141' }),
    condition('death', 'corner2', { type: 'map', default: null, sourceRef: 'TriggerSchemas#death:142' }),
  ],
  entity_interact: [
    condition('entity_interact', 'target', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#entityInteract:148',
    }),
  ],
  block_interact: [
    condition('block_interact', 'target', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#blockInteract:154',
    }),
  ],
  item_on_interact: [
    condition('item_on_interact', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemOnInteract:160',
    }),
    condition('item_on_interact', 'target', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemOnInteract:161',
    }),
    condition('item_on_interact', 'target_type', {
      type: 'enum',
      default: '',
      enumValues: ['', 'block', 'entity'],
      sourceRef: 'TriggerSchemas#itemOnInteract:162',
    }),
  ],
  dimension_change: [
    condition('dimension_change', 'dimension', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#dimensionChange:168',
    }),
    condition('dimension_change', 'from_dimension', {
      type: 'string',
      default: '',
      sourceRef: 'TriggerSchemas#dimensionChange:169',
    }),
  ],
  item_craft: [
    condition('item_craft', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemCraft:175',
    }),
  ],
  item_use: [
    condition('item_use', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemUse:181',
    }),
  ],
  item_consume: [
    condition('item_consume', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemConsume:187',
    }),
  ],
  item_release: [
    condition('item_release', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemRelease:193',
    }),
  ],
  item_instant_use: [
    condition('item_instant_use', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemInstantUse:199',
    }),
  ],
  item_use_interrupt: [
    condition('item_use_interrupt', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemUseInterrupt:205',
    }),
  ],
  item_pickup: [
    condition('item_pickup', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemPickup:211',
    }),
  ],
  item_drop: [
    condition('item_drop', 'item', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#itemDrop:217',
    }),
  ],
  xp: [
    condition('xp', 'level', { type: 'int', default: null, sourceRef: 'TriggerSchemas#xp:223' }),
    condition('xp', 'total', { type: 'int', default: null, sourceRef: 'TriggerSchemas#xp:224' }),
  ],
  dimension: [
    condition('dimension', 'dimension', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#dimension:230',
    }),
  ],
  observation: [
    condition('observation', 'target', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#observation:236',
    }),
    condition('observation', 'target_type', {
      type: 'enum',
      default: '',
      enumValues: ['', 'block', 'entity'],
      sourceRef: 'TriggerSchemas#observation:237',
    }),
    condition('observation', 'reach', { type: 'float', default: 4.5, sourceRef: 'TriggerSchemas#observation:238' }),
  ],
  inventory: [
    condition('inventory', 'items', {
      type: 'array',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#inventory:244',
    }),
    condition('inventory', 'change', {
      type: 'enum',
      default: '',
      enumValues: ['', 'increase', 'decrease'],
      sourceRef: 'TriggerSchemas#inventory:245',
    }),
  ],
  structure: [
    condition('structure', 'structure', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#structure:251',
    }),
    condition('structure', 'radius', { type: 'int', default: 0, sourceRef: 'TriggerSchemas#structure:252' }),
  ],
  gamestage: [
    condition('gamestage', 'stage', {
      type: 'string',
      default: null,
      required: true,
      sourceRef: 'TriggerSchemas#gamestage:258',
    }),
  ],
  facing: [
    condition('facing', 'yaw1', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#facing:264' }),
    condition('facing', 'pitch1', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#facing:265' }),
    condition('facing', 'yaw2', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#facing:266' }),
    condition('facing', 'pitch2', { type: 'float', default: 0, sourceRef: 'TriggerSchemas#facing:267' }),
  ],
  all_of: [],
  any: [],
}

/** `meta.triggers[]` 条目的触发器级字段（`SchemaExporter` 的 `triggerFields` 段）。 */
export const TRIGGER_FIELDS: FieldEntry[] = [
  {
    id: 'trigger.id',
    segment: 'triggers',
    scope: [],
    key: 'id',
    type: 'string',
    default: null,
    hasDefault: false,
    required: false,
    doc: '脚本内唯一的触发器身份；缺省 = type#声明下标；合法形式 [A-Za-z0-9_]{1,64}',
    sourceRef: 'TriggerDefinition#ID_REGEX:15',
  },
  {
    id: 'trigger.continuity',
    segment: 'triggers',
    scope: [],
    key: 'continuity',
    type: 'object',
    default: null,
    hasDefault: false,
    required: false,
    doc: '触发器级连续语义；缺省 = 全部关闭',
    sourceRef: 'ScriptParser#parseContinuity:946',
  },
]

/** `continuity` 子字段（`SchemaExporter` 的 `continuityFields` 段）。 */
export const CONTINUITY_FIELDS: FieldEntry[] = [
  {
    id: 'trigger.continuity.sweep',
    segment: 'triggers',
    scope: [],
    key: 'sweep',
    type: 'bool',
    default: false,
    hasDefault: true,
    required: false,
    doc: '把相邻两次采样之间的运动近似成线段 / 最短弧，只对 location / structure / facing 生效',
    sourceRef: 'ContinuitySpec#MAX_TICKS:32',
  },
  {
    id: 'trigger.continuity.dwell',
    segment: 'triggers',
    scope: [],
    key: 'dwell',
    type: 'int',
    default: 0,
    hasDefault: true,
    required: false,
    min: 0,
    max: 1200,
    doc: '停留门槛（tick），只对轮询类生效',
    sourceRef: 'ContinuitySpec#MAX_TICKS:32',
  },
  {
    id: 'trigger.continuity.window',
    segment: 'triggers',
    scope: [],
    key: 'window',
    type: 'int',
    default: 0,
    hasDefault: true,
    required: false,
    min: 0,
    max: 1200,
    doc: '组合器内事件类子条件的时间窗口（tick），只对 all_of / any 生效',
    sourceRef: 'ContinuitySpec#MAX_TICKS:32',
  },
]
