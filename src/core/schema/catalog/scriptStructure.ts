/**
 * 脚本级结构字段：`SchemaExporter.scriptStructure()` 的 clips / rules / rule_bindings / paths，
 * 以及 `action_types` / `exit_kinds` / `schedule_kinds` / `condition_fact_types` 四组枚举。
 */
import type { FieldEntry } from '../types.ts'
import { CURVE_TYPES } from './curveTypes.ts'
import { TRACK_ORDER } from './tracks.ts'

/** 出口类型（`ClipExitPolicyParser.KIND_NAMES`）。 */
const EXIT_KINDS: string[] = ['continue', 'goto', 'return', 'end_execution', 'end_script']

/** 调度类型（`RuleReleaseKind.SCRIPT_NAMES`）。 */
const SCHEDULE_KINDS: string[] = ['clip_start', 'clip_complete', 'local_time', 'delay', 'fact']

/** 规则事实名（`RuleSchedule.FACT_NAMES`，与条件树 `rule_fact` 同一套词汇）。 */
const RULE_FACT_NAMES: string[] = ['succeeded', 'action_completed']

/** 单条脚本结构字段：`type` 原样保留 Java 的 `number` / `boolean`，`default: null` 即无缺省值。 */
function scriptField(
  scopeName: string,
  key: string,
  type: FieldEntry['type'],
  required: boolean,
  defaultValue: unknown,
  doc: string,
  sourceRef: string,
  enumValues?: string[],
): FieldEntry {
  const entry: FieldEntry = {
    id: `script.${scopeName}.${key}`,
    segment: 'script_structure',
    scope: [scopeName],
    key,
    type,
    default: defaultValue,
    hasDefault: defaultValue !== null,
    required,
    doc,
    sourceRef,
  }
  if (enumValues !== undefined && enumValues.length > 0) {
    entry.enumValues = enumValues
  }
  return entry
}

/** `exit` 对象（片段默认出口 / 绑定入口覆盖共用，`exitField(false)` 生成）。 */
function exitFields(scopeName: string, sourceRef: string): FieldEntry[] {
  return [
    scriptField(scopeName, 'on_complete', 'string', true, null, '完成去向', sourceRef, EXIT_KINDS),
    scriptField(scopeName, 'target', 'string', false, null, '目标片段 id（仅 goto，必须可解析）',
      'SchemaExporter#scriptStructure:253'),
    scriptField(scopeName, 'entry_time', 'number', false, 0, '入口局部秒（仅 goto；缺省 0，>= 0）',
      'SchemaExporter#scriptStructure:254'),
  ]
}

export const SCRIPT_SECTIONS: Record<string, FieldEntry[]> = {
  // ===== clips[]：脚本级独立片段（无 start_time，track + duration 必填）=====
  clips: [
    scriptField('clips', 'id', 'string', false, null,
      '片段 id（^[A-Za-z0-9_]{1,64}$；被规则 / 路径 / 分支 / 出口引用时必填）',
      'SchemaExporter#scriptStructure:156'),
    scriptField('clips', 'track', 'string', true, null,
      '轨道类型（独立片段必填，决定 objects schema）',
      'SchemaExporter#scriptStructure:158', [...TRACK_ORDER]),
    scriptField('clips', 'duration', 'number', true, null,
      '片段时长（秒；正数=有限，负数=无限单次）',
      'SchemaExporter#scriptStructure:160'),
    scriptField('clips', 'objects', 'object', true, null, '采样属性对象（新格式内容）',
      'SchemaExporter#scriptStructure:162'),
    scriptField('clips', 'exit', 'object', false, null, '出口策略（片段默认 / 绑定入口覆盖）',
      'SchemaExporter#scriptStructure:163'),
  ],

  // ===== clips.exit：片段默认出口（`exitField(false)`）=====
  'clips.exit': exitFields('clips.exit', 'SchemaExporter#scriptStructure:251'),

  // ===== rules[]：规则定义 =====
  rules: [
    scriptField('rules', 'id', 'string', true, null,
      '规则 id（^[A-Za-z0-9_]{1,64}$；脚本内唯一）',
      'SchemaExporter#scriptStructure:168'),
    scriptField('rules', 'condition', 'object', true, null,
      '条件树（v1 状态谓词 + all_of/any + clip_fact/rule_fact，见 condition_fact_types）',
      'SchemaExporter#scriptStructure:170'),
    scriptField('rules', 'actions', 'array', true, null, '动作数组（至少一个；类型见 action_types）',
      'SchemaExporter#scriptStructure:172'),
    scriptField('rules', 'policy', 'object', false, null, '触发策略（缺省值见内层字段）',
      'SchemaExporter#scriptStructure:184'),
  ],

  // ===== rules.policy：触发策略 =====
  'rules.policy': [
    scriptField('rules.policy', 'once', 'boolean', false, true, '只触发一次（缺省 true）',
      'SchemaExporter#scriptStructure:174'),
    scriptField('rules.policy', 'cooldown', 'number', false, 0, '触发后静默秒数（缺省 0，>= 0）',
      'SchemaExporter#scriptStructure:175'),
    scriptField('rules.policy', 'mode', 'string', false, 'enter', '触发方式（缺省 enter）',
      'SchemaExporter#scriptStructure:177', ['enter', 'dwell']),
    scriptField('rules.policy', 'dwell', 'number', false, 0, '驻留判定阈值秒数（缺省 0，>= 0）',
      'SchemaExporter#scriptStructure:179'),
    scriptField('rules.policy', 'timeout', 'number', false, -1,
      '等待上限秒数（缺省 -1 = 无限等待）', 'SchemaExporter#scriptStructure:181'),
    scriptField('rules.policy', 'on_timeout', 'array', false, null, '超时动作（缺省空数组）',
      'SchemaExporter#scriptStructure:183'),
  ],

  // ===== rule_bindings[]：定义 × 片段 × 时间门 =====
  rule_bindings: [
    scriptField('rule_bindings', 'id', 'string', true, null,
      '绑定 id（^[A-Za-z0-9_]{1,64}$；脚本内唯一）',
      'SchemaExporter#scriptStructure:189'),
    scriptField('rule_bindings', 'rule', 'string', true, null, '规则定义 id（必须命中 rules[].id）',
      'SchemaExporter#scriptStructure:191'),
    scriptField('rule_bindings', 'clip', 'string', true, null, '宿主片段 id（必须命中片段 id）',
      'SchemaExporter#scriptStructure:192'),
    scriptField('rule_bindings', 'gate', 'object', true, null, '时间门（必填）',
      'SchemaExporter#scriptStructure:196'),
    scriptField('rule_bindings', 'control', 'string', false, 'observe', '执行控制（缺省 observe）',
      'SchemaExporter#scriptStructure:197', ['observe', 'hold']),
    scriptField('rule_bindings', 'schedule', 'object', false, null,
      '动作调度（缺省 = 成功后立即提交）', 'SchemaExporter#scriptStructure:199'),
    scriptField('rule_bindings', 'exit', 'object', false, null,
      '出口策略（片段默认 / 绑定入口覆盖）', 'SchemaExporter#scriptStructure:200'),
  ],

  // ===== rule_bindings.gate：时间门 =====
  'rule_bindings.gate': [
    scriptField('rule_bindings.gate', 'at', 'number', true, null,
      '时间门（目标片段执行局部秒；有限片段 0 ~ duration，无限片段 >= 0）',
      'SchemaExporter#scriptStructure:194'),
  ],

  // ===== rule_bindings.schedule：动作调度（`scheduleField(false)`）=====
  'rule_bindings.schedule': [
    scriptField('rule_bindings.schedule', 'on', 'string', true, null,
      '释放条件（缺省 = 立即提交）', 'SchemaExporter#scriptStructure:261', SCHEDULE_KINDS),
    scriptField('rule_bindings.schedule', 'clip', 'string', false, null,
      '目标片段 id（clip_start / clip_complete / local_time 必填）',
      'SchemaExporter#scriptStructure:263'),
    scriptField('rule_bindings.schedule', 'at', 'number', false, null,
      '目标片段执行局部秒（local_time 必填，>= 0）', 'SchemaExporter#scriptStructure:265'),
    scriptField('rule_bindings.schedule', 'seconds', 'number', false, null,
      '判定成功后的真实秒数（delay 必填，>= 0；挂起不冻结）',
      'SchemaExporter#scriptStructure:267'),
    scriptField('rule_bindings.schedule', 'binding', 'string', false, null,
      '来源绑定 id（fact 必填，必须可解析）', 'SchemaExporter#scriptStructure:269'),
    scriptField('rule_bindings.schedule', 'fact', 'string', false, null, '来源事实（fact 必填）',
      'SchemaExporter#scriptStructure:270', RULE_FACT_NAMES),
  ],

  // ===== rule_bindings.exit：绑定入口覆盖（`exitField(false)`）=====
  'rule_bindings.exit': exitFields('rule_bindings.exit', 'SchemaExporter#scriptStructure:251'),

  // ===== paths[]：片段位置关键帧区间上的路径 =====
  paths: [
    scriptField('paths', 'id', 'string', true, null,
      '路径 id（脚本内唯一，匹配 ^[A-Za-z0-9_]{1,64}$）',
      'SchemaExporter#scriptStructure:205'),
    scriptField('paths', 'clip', 'string', true, null,
      '目标片段 id（必须是 objects 片段；端点取自其 position.x/y/z 节点时间序列）',
      'SchemaExporter#scriptStructure:206'),
    scriptField('paths', 'from', 'number', true, null,
      '起点位置节点时间（秒，必须命中 position.x/y/z 关键帧时间，from < to）',
      'SchemaExporter#scriptStructure:208'),
    scriptField('paths', 'to', 'number', true, null,
      '终点位置节点时间（秒，必须命中节点时间且与 from 相邻）',
      'SchemaExporter#scriptStructure:210'),
    scriptField('paths', 'axes', 'array', false, null,
      '轴集合（缺省 x/y/z；去重、顺序无关、至少一项）',
      'SchemaExporter#scriptStructure:212', ['x', 'y', 'z']),
    scriptField('paths', 'geometry', 'object', true, null, '曲线几何',
      'SchemaExporter#scriptStructure:218'),
    scriptField('paths', 'timing', 'object', false, null, '时间映射（缺省线性）',
      'SchemaExporter#scriptStructure:224'),
  ],

  // ===== paths.geometry：曲线几何 =====
  'paths.geometry': [
    scriptField('paths.geometry', 'type', 'string', true, null,
      '曲线类型（line = linear 的别名）',
      'SchemaExporter#scriptStructure:215', ['line', ...CURVE_TYPES]),
    scriptField('paths.geometry', 'control_points', 'array', false, null,
      '控制点（bezier 等曲线类型使用）', 'SchemaExporter#scriptStructure:217'),
  ],

  // ===== paths.timing：时间映射 =====
  'paths.timing': [
    scriptField('paths.timing', 'type', 'string', false, 'linear', '时间映射类型（缺省 linear）',
      'SchemaExporter#scriptStructure:220', ['linear', 'keyframes']),
    scriptField('paths.timing', 'points', 'array', false, null,
      '关键帧点 [{t,s}]（keyframes：两端 0/1、单调不减、至少 2 点）',
      'SchemaExporter#scriptStructure:222'),
  ],

  // ===== condition_fact_types.clip_fact：片段事实条件 =====
  'condition_fact_types.clip_fact': [
    scriptField('condition_fact_types.clip_fact', 'clip', 'string', true, null,
      '片段 id（必须可解析）', 'SchemaExporter#scriptStructure:236'),
    scriptField('condition_fact_types.clip_fact', 'fact', 'string', true, null, '事实',
      'SchemaExporter#scriptStructure:237', ['started', 'completed']),
  ],

  // ===== condition_fact_types.rule_fact：规则事实条件 =====
  'condition_fact_types.rule_fact': [
    scriptField('condition_fact_types.rule_fact', 'binding', 'string', true, null,
      '绑定 id（必须可解析）', 'SchemaExporter#scriptStructure:240'),
    scriptField('condition_fact_types.rule_fact', 'fact', 'string', true, null, '事实',
      'SchemaExporter#scriptStructure:241', RULE_FACT_NAMES),
  ],
}

export const SCRIPT_ENUMS: Record<string, string[]> = {
  action_types: [
    'camera_set', 'overlay_set', 'adjust_set', 'goto_clip',
    'pause', 'resume', 'exit', 'play_sound', 'emit_command',
  ],
  exit_kinds: EXIT_KINDS,
  schedule_kinds: SCHEDULE_KINDS,
  condition_fact_types: ['clip_fact', 'rule_fact'],
}
