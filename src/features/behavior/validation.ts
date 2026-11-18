/**
 * 11-15 校验与诊断判据的单一出处。
 *
 * 三级口径（与主模组 `ScriptValidator` 同口径）：
 * - `block`：解析器 / 解码期会拒绝（格式异常、白名单外成员、形状非法）；
 * - `error`：解析器接受但校验器报错（非 `[警告] ` 前缀的 issue、schema 错误、编辑器合同禁止项）；
 * - `warn`：`[警告] ` 前缀、解析器「建议最多一条」、运行期丢弃；
 * - `info`：编辑器自身提示，不写进脚本、不影响游戏。
 *
 * 合同码从 `L35` 起连续编号；`L01`–`L34` 归第 7 轮 `core/doc/structural.ts`，本文件不占用、不回填。
 * `CONTRACT_CHECKS` 是后面 `structural.ts` 装配与 `verify-11` 验收的共同依据，码值一次定死，不得改号。
 */
import type { Severity } from '../../core/doc/types.ts'
import type { SourceRef } from './shared.ts'

/** 合同分块（11-15 §三 四大块 + 事件 + 编辑器诊断）。 */
export type ContractBlock = 'script-clip' | 'trigger' | 'rule-binding' | 'action' | 'event' | 'diagnostic'

/** 一条合同判据。 */
export interface ContractCheck {
  /** 稳定合同码（L35 起连续）。 */
  code: string
  block: ContractBlock
  /** 判据级别：命中后按此级别进诊断集合。 */
  severity: Severity
  /** 判据标题（诊断面板分组 / 列表用）。 */
  title: string
  /** 判定口径与边界（不自动修复的理由写在这里）。 */
  detail: string
  /** jsonPath 规则模板（`*` 表示任意下标 / 键）。 */
  jsonPath: string
  sourceRef: SourceRef
}

const VALIDATOR = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/ScriptValidator.java'
const CODEC = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/object/ObjectCodec.java'
const OBJECT_VALIDATOR = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/object/ObjectValidator.java'
const RUNTIME = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventClipRuntime.java'
const PARSER = 'common/src/main/java/com/immersivecinematics/immersive_cinematics/script/ScriptParser.java'
const PLAN_1115 = 'plan/11/11-15-validation-and-diagnostics.md'
const PLAN_1112 = 'plan/11/11-12-event-records.md'
const PLAN_1111 = 'plan/11/11-fact-inspector.md'
const PLAN_1114 = 'plan/11/11-14-event-timeline-and-seek.md'

/** 合同判据全表（码值连续，不得插空号、不得改号）。 */
export const CONTRACT_CHECKS: readonly ContractCheck[] = [
  // ── 脚本与片段（L35–L39）─────────────────────────────────────────────
  {
    code: 'L35',
    block: 'script-clip',
    severity: 'block',
    title: '元信息缺失或 id 形态不合法',
    detail: 'meta.id / name / author 缺失或不是字符串；id 不匹配身份模式。解析期拒绝。',
    jsonPath: 'meta.id | meta.name | meta.author',
    sourceRef: { file: PARSER, line: 193, symbol: 'parseMeta' },
  },
  {
    code: 'L36',
    block: 'script-clip',
    severity: 'block',
    title: '时间轴 / 轨道 / 片段结构非法',
    detail: 'timeline.tracks 不是数组；轨道或片段不是对象；clips 不是数组。',
    jsonPath: 'timeline.tracks[*] | timeline.tracks[*].clips[*]',
    sourceRef: { file: VALIDATOR, line: 237, symbol: 'validate' },
  },
  {
    code: 'L37',
    block: 'script-clip',
    severity: 'block',
    title: '片段起点或时长缺失、非有限、时长为 0',
    detail: 'start_time / duration 缺失、不是有限数字，或 duration = 0（正数定长、负数无限）。',
    jsonPath: 'timeline.tracks[*].clips[*].start_time | ...duration',
    sourceRef: { file: VALIDATOR, line: 286, symbol: 'validateTracks' },
  },
  {
    code: 'L38',
    block: 'script-clip',
    severity: 'error',
    title: '独立片段 id 非法或重复、轨道未知、对象缺失或为空',
    detail: '独立片段 track 未知类型；objects 缺失或为空；片段 id 形态非法或脚本内重复。',
    jsonPath: 'clips[*].track | clips[*].objects | clips[*].id',
    sourceRef: { file: VALIDATOR, line: 447, symbol: 'checkStandaloneTrack' },
  },
  {
    code: 'L39',
    block: 'script-clip',
    severity: 'block',
    title: '片段出口结构错误 / 对象 schema / 未知对象路径 / 模式与类型不匹配',
    detail: 'exit 结构非法；对象未登记路径；value/keyframes 模式与字段类型不匹配。',
    jsonPath: '*.exit | *.objects.*',
    sourceRef: { file: OBJECT_VALIDATOR, line: 292, symbol: 'checkProperty' },
  },

  // ── 触发器（L40–L52）────────────────────────────────────────────────
  {
    code: 'L40',
    block: 'trigger',
    severity: 'block',
    title: '触发器数组或元素形态错误',
    detail: 'meta.triggers 不是数组，或元素不是对象。',
    jsonPath: 'meta.triggers[*]',
    sourceRef: { file: VALIDATOR, line: 2034, symbol: 'validateTriggerRequires' },
  },
  {
    code: 'L41',
    block: 'trigger',
    severity: 'error',
    title: '触发器类型缺失或不在已注册类型内',
    detail: 'type 缺失、非字符串，或不在 TriggerRegistry 已注册类型清单内。',
    jsonPath: 'meta.triggers[*].type',
    sourceRef: { file: VALIDATOR, line: 2533, symbol: 'isKnownType' },
  },
  {
    code: 'L42',
    block: 'trigger',
    severity: 'error',
    title: '触发器 id 形态错误或重复',
    detail: '显式 id 必须是非空字符串并匹配身份模式；同一脚本内不重复。',
    jsonPath: 'meta.triggers[*].id',
    sourceRef: { file: VALIDATOR, line: 1995, symbol: 'validateTriggerIdentities' },
  },
  {
    code: 'L43',
    block: 'trigger',
    severity: 'block',
    title: '前置不是数组 / 元素形态错误 / 字符串为空 / 内置前置缺目标',
    detail: 'requires 必须是数组；元素为字符串脚本 id 或对象型前置；字符串不能为空；内置三种脚本前置必须带 script 字段。',
    jsonPath: 'meta.triggers[*].requires[*]',
    sourceRef: { file: VALIDATOR, line: 2030, symbol: 'validateTriggerRequires' },
  },
  {
    code: 'L44',
    block: 'trigger',
    severity: 'error',
    title: '前置自引用或目标不存在',
    detail: '内置脚本前置指向当前脚本自身，或目标脚本不在已加载集合内。',
    jsonPath: 'meta.triggers[*].requires[*].data.script',
    sourceRef: { file: VALIDATOR, line: 2494, symbol: 'validatePrerequisiteRef' },
  },
  {
    code: 'L45',
    block: 'trigger',
    severity: 'block',
    title: '条件不是对象 / 使用废弃旧字段 / 必填缺失或类型错误',
    detail: '条件节点必须是对象；不得使用已废弃旧字段；必填字段缺失或类型不符。',
    jsonPath: 'meta.triggers[*].conditions',
    sourceRef: { file: VALIDATOR, line: 2086, symbol: 'validateTriggerConditions' },
  },
  {
    code: 'L46',
    block: 'trigger',
    severity: 'block',
    title: '组合器列表缺失 / 非数组 / 为空 / 子项结构错误 / 嵌套超 8 层 / 子项类型未知',
    detail: 'all_of / any 的 list 必须是非空数组；子项必须是 {type, conditions}；嵌套深度上限 8 层；子项类型必须已注册。',
    jsonPath: '*.list[*]',
    sourceRef: { file: VALIDATOR, line: 1378, symbol: 'checkRuleCombination0' },
  },
  {
    code: 'L47',
    block: 'trigger',
    severity: 'block',
    title: '事件类触发器进组合器但窗口为 0',
    detail: '事件类条件进入组合器时必须带非零时间窗口；窗口为 0 无法参与边沿判定。',
    jsonPath: '*.list[*].window',
    sourceRef: { file: PLAN_1115, line: 49, symbol: '事件类触发器' },
  },
  {
    code: 'L48',
    block: 'trigger',
    severity: 'error',
    title: '离开外扩用在不可用的类型上（将被忽略）',
    detail: 'exit_buffer 只对有空间进出的条件类型有效；用在 facing / 组合器 / death 等类型上运行时忽略。',
    jsonPath: 'meta.triggers[*].exit_buffer',
    sourceRef: { file: VALIDATOR, line: 2133, symbol: 'validateTriggerConditions' },
  },
  {
    code: 'L49',
    block: 'trigger',
    severity: 'error',
    title: '轮询间隔用在事件驱动类型上（将被忽略）',
    detail: '事件驱动触发器不参与轮询；poll_interval 写在该类类型上运行时忽略。',
    jsonPath: 'meta.triggers[*].poll_interval',
    sourceRef: { file: VALIDATOR, line: 2139, symbol: 'validateTriggerConditions' },
  },
  {
    code: 'L50',
    block: 'trigger',
    severity: 'error',
    title: '进入边沿用在死亡类上（将被忽略）',
    detail: 'death 类是事件驱动，不参与区域进出判定；进入边沿 / 外扩写在其上运行时忽略。',
    jsonPath: 'meta.triggers[*].exit_buffer',
    sourceRef: { file: VALIDATOR, line: 2143, symbol: 'validateTriggerConditions' },
  },
  {
    code: 'L51',
    block: 'trigger',
    severity: 'block',
    title: '连续语义不是对象 / 子字段类型或范围错误 / 用在不适用类型上',
    detail: '连续性（continuity）字段必须是对象；子字段类型、取值范围与适用类型不符。',
    jsonPath: 'meta.triggers[*].continuity',
    sourceRef: { file: VALIDATOR, line: 2190, symbol: 'validateContinuity' },
  },
  {
    code: 'L52',
    block: 'trigger',
    severity: 'info',
    title: '自定义前置类型允许存在：编辑器只读，不报错误',
    detail: '未注册的前置类型（其他模组注册）保留原文只读；不纳入内置前置的 script 目标检查。',
    jsonPath: 'meta.triggers[*].requires[*].type',
    sourceRef: { file: VALIDATOR, line: 2494, symbol: 'validatePrerequisiteRef' },
  },

  // ── 规则与绑定（L53–L57）───────────────────────────────────────────
  {
    code: 'L53',
    block: 'rule-binding',
    severity: 'block',
    title: '规则数组或元素形态错误 / 缺条件或动作 / 动作为空 / id 缺失或重复',
    detail: 'rules 元素必须是对象；condition 必须是对象；actions 必须是非空数组；id 非空且脚本内唯一。',
    jsonPath: 'rules[*]',
    sourceRef: { file: VALIDATOR, line: 514, symbol: 'checkScriptRuleCollection' },
  },
  {
    code: 'L54',
    block: 'rule-binding',
    severity: 'block',
    title: '策略不是对象 / 单次布尔 / 模式非法 / 超时取值 / 驻留冷却为负 / 超时动作形态错误',
    detail: 'policy 必须是对象；once 布尔；mode 为 enter/dwell；timeout 为正数或 -1；驻留 / 冷却非负；on_timeout 为数组且元素形态正确。',
    jsonPath: 'rules[*].policy',
    sourceRef: { file: VALIDATOR, line: 891, symbol: 'checkRulePolicy' },
  },
  {
    code: 'L55',
    block: 'rule-binding',
    severity: 'block',
    title: '条件类型未知 / 结构缺失 / 事实叶子缺引用或事实名 / 引用未知片段或绑定 / 组合器为空或过深',
    detail: '条件类型必须已注册；clip_fact / rule_fact 叶子必须带引用与合法 fact 名；引用必须可解析；组合器非空且未过深。',
    jsonPath: 'rules[*].condition',
    sourceRef: { file: VALIDATOR, line: 1286, symbol: 'checkRuleConditionV2' },
  },
  {
    code: 'L56',
    block: 'rule-binding',
    severity: 'block',
    title: '绑定形态 / id / 规则片段引用 / 时间门 / 控制方式 / 调度 / 事实白名单 / 出口结构错误',
    detail: 'rule_bindings 元素形态正确；id 唯一；rule / clip 可解析；gate.at 在片段时长内；control 枚举；schedule 形态与参数合法；fact 在白名单内；出口类型已知，goto 必须有目标，非 goto 不得带 target / entry_time。',
    jsonPath: 'rule_bindings[*]',
    sourceRef: { file: VALIDATOR, line: 943, symbol: 'checkRuleBinding' },
  },
  {
    code: 'L57',
    block: 'rule-binding',
    severity: 'warn',
    title: '持有时条件等待片段受时间门限制不可达',
    detail: 'control=hold 且无超时时，条件树等待的 clip_fact 片段起点晚于目标片段结束，冻结位置不会推进到那里。警告级，不阻止加载。',
    jsonPath: 'rule_bindings[*].condition',
    sourceRef: { file: VALIDATOR, line: 1003, symbol: 'checkHoldReachability' },
  },

  // ── 动作（L58–L68）───────────────────────────────────────────────────
  {
    code: 'L58',
    block: 'action',
    severity: 'block',
    title: '动作元素形态错误 / 类型缺失或未知 / 出现 hold',
    detail: '动作元素必须是对象；type 非空且在已注册动作清单内；动作清单不包含 hold。',
    jsonPath: 'rules[*].actions[*] | rules[*].policy.on_timeout[*]',
    sourceRef: { file: VALIDATOR, line: 1557, symbol: 'checkActionElementNew' },
  },
  {
    code: 'L59',
    block: 'action',
    severity: 'error',
    title: '跳转动作缺目标或目标未知 / 出现旧轨道与时间字段 / 入口时间非法',
    detail: 'goto_clip 必须用新形态 clip + entry_time；旧 track / at 字段出现即合同错误；目标片段必须存在；entry_time 非负有限。',
    jsonPath: 'rules[*].actions[*].clip',
    sourceRef: { file: VALIDATOR, line: 1672, symbol: 'checkActionGotoClip' },
  },
  {
    code: 'L60',
    block: 'action',
    severity: 'block',
    title: '相机动作通道未声明 / 为空重复未知 / 通道值缺失或非有限 / 模式未知 / 优先级非整数 / 未声明通道字段',
    detail: '相机动作通道清单合法；每个已声明通道的值缺失或非有限、模式未知、优先级非整数，或写了未声明通道的字段。',
    jsonPath: 'rules[*].actions[*].channels',
    sourceRef: { file: VALIDATOR, line: 1749, symbol: 'checkModifierBody' },
  },
  {
    code: 'L61',
    block: 'action',
    severity: 'block',
    title: '覆盖层动作缺类型或不是 fade / 不透明度越界 / z 值非整数',
    detail: '覆盖层动作类型必须是 fade；不透明度在合法区间；z 为整数。',
    jsonPath: 'rules[*].actions[*]',
    sourceRef: { file: PLAN_1115, line: 53, symbol: '覆盖层动作' },
  },
  {
    code: 'L62',
    block: 'action',
    severity: 'block',
    title: '调色动作通道不在十五个基础通道内或值非有限',
    detail: '调色通道必须在基础通道清单内；通道值必须是有限数字。',
    jsonPath: 'rules[*].actions[*].channels',
    sourceRef: { file: PLAN_1115, line: 53, symbol: '调色动作' },
  },
  {
    code: 'L63',
    block: 'action',
    severity: 'block',
    title: '三个无参动作带参数',
    detail: '无参动作（停止 / 暂停 / 继续类）不允许携带参数字段。',
    jsonPath: 'rules[*].actions[*]',
    sourceRef: { file: PLAN_1115, line: 53, symbol: '无参动作' },
  },
  {
    code: 'L64',
    block: 'action',
    severity: 'block',
    title: '发声动作缺音效 / 音量或音高非有限',
    detail: '发声动作必须带音效；音量、音高缺失或非有限数字。',
    jsonPath: 'rules[*].actions[*]',
    sourceRef: { file: VALIDATOR, line: 1688, symbol: 'checkActionPlaySound' },
  },
  {
    code: 'L65',
    block: 'action',
    severity: 'error',
    title: '命令动作缺命令或命令为空',
    detail: '命令动作必须带非空命令原文；空命令没有可执行内容。',
    jsonPath: 'rules[*].actions[*].command',
    sourceRef: { file: VALIDATOR, line: 1699, symbol: 'checkActionEmitCommand' },
  },
  {
    code: 'L66',
    block: 'action',
    severity: 'warn',
    title: '命令动作带前导斜杠',
    detail: '命令原文不应带前导斜杠；警告并保留原文，不自动改写。',
    jsonPath: 'rules[*].actions[*].command',
    sourceRef: { file: PLAN_1115, line: 53, symbol: '命令动作' },
  },
  {
    code: 'L67',
    block: 'action',
    severity: 'block',
    title: '动作出现未知键',
    detail: '动作体只接受 schema 声明字段；未登记成员拒绝，不静默保留。',
    jsonPath: 'rules[*].actions[*]',
    sourceRef: { file: VALIDATOR, line: 1716, symbol: 'rejectActionKeys' },
  },
  {
    code: 'L68',
    block: 'action',
    severity: 'error',
    title: '超时动作里出现命令动作（编辑器合同禁止）',
    detail: '服务端命令表不编译 on_timeout 动作；超时动作里放命令动作导出结果是空动作。编辑器合同 error，提示移到普通动作，阻止导出。',
    jsonPath: 'rules[*].policy.on_timeout[*]',
    sourceRef: { file: PLAN_1115, line: 17, symbol: '超时动作命令' },
  },

  // ── 事件（L69–L85）───────────────────────────────────────────────────
  {
    code: 'L69',
    block: 'event',
    severity: 'block',
    title: '事件对象模式或关键帧结构错误',
    detail: 'event / mod_event 对象必须是事件模式且带 keyframes 数组；帧必须有 time 与 value。',
    jsonPath: '*.objects.event | *.objects.mod_event',
    sourceRef: { file: OBJECT_VALIDATOR, line: 317, symbol: 'checkEventObject' },
  },
  {
    code: 'L70',
    block: 'event',
    severity: 'block',
    title: '同一片段出现多个同类事件对象',
    detail: '一个片段只能有一个 event 对象、一个 mod_event 对象；重复同类对象拒绝。',
    jsonPath: '*.objects.event | *.objects.mod_event',
    sourceRef: { file: PLAN_1112, line: 37, symbol: '单一事件对象' },
  },
  {
    code: 'L71',
    block: 'event',
    severity: 'block',
    title: '关键帧缺时间或值 / 时间负或非递增',
    detail: '每帧 time 必须是非负有限数字；同一对象内时间严格递增，不允许同刻两条。',
    jsonPath: '*.objects.event.keyframes[*].time',
    sourceRef: { file: OBJECT_VALIDATOR, line: 359, symbol: 'checkKeyframes' },
  },
  {
    code: 'L72',
    block: 'event',
    severity: 'warn',
    title: '记录超出片段时长（运行期编译期丢弃）',
    detail: 'time > 片段时长的记录在编译期被丢弃；旧记录标注「超出时长（运行时丢弃）」，新建记录阻止落在时长之外。警告级，允许保存。',
    jsonPath: '*.objects.event.keyframes[*].time | *.objects.mod_event.keyframes[*].time',
    sourceRef: { file: RUNTIME, line: 20, symbol: 'compile' },
  },
  {
    code: 'L73',
    block: 'event',
    severity: 'block',
    title: 'EVENT 记录出现未知成员',
    detail: 'EVENT 记录体只接受 command / event_type / position / id；其它键解码期拒绝。',
    jsonPath: '*.objects.event.keyframes[*].value',
    sourceRef: { file: CODEC, line: 123, symbol: 'readEvent' },
  },
  {
    code: 'L74',
    block: 'event',
    severity: 'error',
    title: 'EVENT event_type 不是合法值',
    detail: 'EVENT 只接受 event_type=command；写其他值校验器报错，运行时跳过该记录。',
    jsonPath: '*.objects.event.keyframes[*].value.event_type',
    sourceRef: { file: OBJECT_VALIDATOR, line: 767, symbol: 'checkEvent' },
  },
  {
    code: 'L75',
    block: 'event',
    severity: 'block',
    title: 'EVENT command 非字符串',
    detail: 'command 存在时必须是字符串（空串合法 = 占位）；类型不符解码期拒绝。',
    jsonPath: '*.objects.event.keyframes[*].value.command',
    sourceRef: { file: CODEC, line: 121, symbol: 'readEvent' },
  },
  {
    code: 'L76',
    block: 'event',
    severity: 'block',
    title: 'position 键不成对 / 混写 / 多键 / 非有限',
    detail: 'position 必须恰好两个键：{x,z} 绝对或 {dx,dz} 相对；两套互斥；两键均为有限数字。',
    jsonPath: '*.objects.event.keyframes[*].value.position',
    sourceRef: { file: CODEC, line: 136, symbol: 'readPosition' },
  },
  {
    code: 'L77',
    block: 'event',
    severity: 'block',
    title: 'EVENT 记录 id 非字符串',
    detail: 'id 存在时必须是字符串；运行时忽略它，不参与身份与去重。',
    jsonPath: '*.objects.event.keyframes[*].value.id',
    sourceRef: { file: CODEC, line: 121, symbol: 'readEvent' },
  },
  {
    code: 'L78',
    block: 'event',
    severity: 'warn',
    title: 'EVENT 命令带前导斜杠',
    detail: '命令原文不应以 / 开头；警告并保留原文，不自动去除。',
    jsonPath: '*.objects.event.keyframes[*].value.command',
    sourceRef: { file: PLAN_1112, line: 41, symbol: '前导斜杠' },
  },
  {
    code: 'L79',
    block: 'event',
    severity: 'block',
    title: 'MOD_EVENT 记录值非对象',
    detail: 'mod_event 帧的 value 必须是对象；直接写数组 / 字符串 / 数字拒绝。',
    jsonPath: '*.objects.mod_event.keyframes[*].value',
    sourceRef: { file: CODEC, line: 101, symbol: 'readEventRecord' },
  },
  {
    code: 'L80',
    block: 'event',
    severity: 'block',
    title: 'MOD_EVENT 出现 command / position / id 等禁止键',
    detail: '这些键属于 EVENT；出现在 MOD_EVENT 记录里按未知成员拒绝。',
    jsonPath: '*.objects.mod_event.keyframes[*].value',
    sourceRef: { file: CODEC, line: 159, symbol: 'readModEvent' },
  },
  {
    code: 'L81',
    block: 'event',
    severity: 'block',
    title: 'MOD_EVENT 事件名缺失 / 为空 / 非字符串',
    detail: 'event_type 记录级缺省回退对象级显式值；两级都没有或空串 = 缺少事件名；类型非字符串拒绝。空串不落回默认值。',
    jsonPath: '*.objects.mod_event.keyframes[*].value.event_type',
    sourceRef: { file: OBJECT_VALIDATOR, line: 790, symbol: 'checkModEvent' },
  },
  {
    code: 'L82',
    block: 'event',
    severity: 'block',
    title: 'MOD_EVENT data 顶层非对象',
    detail: 'data 顶层必须是 JSON 对象；数组 / 标量 / null 拒绝；嵌套数组允许。',
    jsonPath: '*.objects.mod_event.keyframes[*].value.data',
    sourceRef: { file: CODEC, line: 154, symbol: 'readModEvent' },
  },
  {
    code: 'L83',
    block: 'event',
    severity: 'block',
    title: 'MOD_EVENT data 内数字非有限',
    detail: 'data 任意嵌套中的数字必须是有限数；NaN / ±Infinity 拒绝。',
    jsonPath: '*.objects.mod_event.keyframes[*].value.data',
    sourceRef: { file: CODEC, line: 188, symbol: 'readData' },
  },
  {
    code: 'L84',
    block: 'event',
    severity: 'warn',
    title: '多条 EVENT 轨（建议最多一条）',
    detail: '脚本出现多条 EVENT 轨道时提示合并；不自动合并，也不新建第二条轨。',
    jsonPath: 'timeline.tracks[*].type',
    sourceRef: { file: PARSER, line: 1062, symbol: 'validateTracks' },
  },
  {
    code: 'L85',
    block: 'event',
    severity: 'error',
    title: '乒乓模式用在事件轨',
    detail: '事件没有反向时间语义；loop_mode=pingpong 用在 EVENT / MOD_EVENT 轨上合同拒绝。',
    jsonPath: 'timeline.tracks[*].clips[*].loop_mode',
    sourceRef: { file: PLAN_1115, line: 55, symbol: '乒乓模式用在事件轨' },
  },

  // ── 编辑器诊断（L86–L90）────────────────────────────────────────────
  {
    code: 'L86',
    block: 'diagnostic',
    severity: 'warn',
    title: '规则事实自引用',
    detail: 'rule_fact 引用自身所在绑定：自引用事实可能永远不成立。',
    jsonPath: 'rule_bindings[*].condition | rules[*].condition',
    sourceRef: { file: PLAN_1111, line: 56, symbol: '自引用' },
  },
  {
    code: 'L87',
    block: 'diagnostic',
    severity: 'warn',
    title: '规则事实与调度成环',
    detail: '规则事实引用与调度引用形成环，激活顺序无法稳定判定。',
    jsonPath: 'rule_bindings[*].schedule',
    sourceRef: { file: PLAN_1111, line: 56, symbol: '成环' },
  },
  {
    code: 'L88',
    block: 'diagnostic',
    severity: 'warn',
    title: '片段事实引用在冻结状态下不会开始的片段',
    detail: 'clip_fact 目标片段在冻结内容位置之后才开始，条件等待不到。',
    jsonPath: 'rules[*].condition.clip_fact.clip',
    sourceRef: { file: PLAN_1111, line: 56, symbol: '冻结不可达' },
  },
  {
    code: 'L89',
    block: 'diagnostic',
    severity: 'info',
    title: '易误读事实语义纠正',
    detail: 'script_completed 不要求先开始过（不是完整播完）；action_completed 是批次已提交（不是每个动作都成功）。',
    jsonPath: '*.fact',
    sourceRef: { file: PLAN_1111, line: 15, symbol: '语义纠正' },
  },
  {
    code: 'L90',
    block: 'diagnostic',
    severity: 'info',
    title: '运行态 / 边界提示',
    detail: 'trigger_fired 是持久去重记录、不可清除；绑定出口只覆盖本绑定 goto 分支；时间为 0 的事件只能靠新实例或首次推进触发；扩展事件内置播放器不消费；多条事件轨建议合并。',
    jsonPath: '*.trigger_fired | *.exit | *.keyframes[0]',
    sourceRef: { file: PLAN_1114, line: 39, symbol: '边界提示' },
  },
]

/** 合同码索引（code → 判据）。 */
const CHECK_BY_CODE = new Map<string, ContractCheck>(CONTRACT_CHECKS.map((check) => [check.code, check]))

/** 取一条合同判据；未登记码抛错（不假回退默认级别）。 */
export function contractCheck(code: string): ContractCheck {
  const found = CHECK_BY_CODE.get(code)
  if (found === undefined) {
    throw new RangeError(`未登记的合同码: ${code}`)
  }
  return found
}

/** 按合同码取级别；未登记码抛错。 */
export function severityForContract(code: string): Severity {
  return contractCheck(code).severity
}

/**
 * 三级呈现折叠：`block` 与 `error` 在面板上都按 error 呈现（阻断导出）；
 * `warn` / `info` 保持原级。装配层不重复判级。
 */
export function foldSeverity(severity: Severity): 'error' | 'warn' | 'info' {
  if (severity === 'block' || severity === 'error') {
    return 'error'
  }
  return severity
}

/** 校验时机（11-15 §三）：各时机跑哪些范围。 */
export const VALIDATION_TIMING = [
  { id: 'open', label: '打开脚本', scope: '解析并做合同校验；有错误仍允许进入修复态，不自动改写' },
  { id: 'edit', label: '编辑中', scope: '只做结构与引用即时检查，不逐字符跑全量' },
  { id: 'pre-save', label: '保存前', scope: '全量校验；错误阻止保存，警告允许并提示' },
  { id: 'pre-export', label: '导出 / 构建前', scope: '再跑一次全量；错误阻止导出' },
  { id: 'refresh', label: '刷新 / 切换脚本', scope: '丢弃旧诊断按新内容重算；外部文件变化重新读取再校验，不沿用旧结果' },
] as const

/** 修复原则显式禁止项（11-15 §三 修复原则）。 */
export const FORBIDDEN_FIXES = [
  { id: 'no-auto-default', label: '不自动补默认值掩盖缺失' },
  { id: 'no-delete-record', label: '不自动删除记录来"修好"校验' },
  { id: 'no-legacy-convert', label: '不自动把旧字段转成新字段；旧字段原样显示为错误' },
  { id: 'no-ignore-error', label: '不自动忽略错误；只有警告可保存' },
] as const
