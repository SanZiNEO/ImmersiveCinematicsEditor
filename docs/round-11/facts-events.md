# 11 轮 · 事件记录 / 事实索引 / 校验判据 — 事实清单与合同码全表

> 归属：第 11 轮「事件记录 / 事实索引 / 校验判据」纯函数层（本代理）。
> 编辑器侧产出：
> - `src/core/schema/catalog/behaviorEvents.ts`（EVENT / MOD_EVENT 字段目录）
> - `src/features/behavior/events.ts`（读取模型 / 校验 / 标记 / 拖动 / seek 语义）
> - `src/features/behavior/facts.ts`（三层事实 / 引用索引 / 字典）
> - `src/features/behavior/validation.ts`（合同码表单一出处）
>
> 溯源口径：Java 文件相对主模组仓库根 `E:\Documents\GitHub\ImmersiveCinematics`，行号 1 起。文档与 Java 冲突时以 Java 为准，偏差见末节。

## 一、事件记录事实清单（EVENT / MOD_EVENT）

| 结论 | Java 文件 : 行 | 符号 |
|---|---|---|
| 记录组件：`time, eventType, command, position, data`；两类记录共用同一容器 | `common/.../script/event/EventRecord.java:15` | `EventRecord` |
| 位置组件：`x, z, relative`（`relative=false` 绝对世界坐标，`true` 相对激活位置） | `common/.../script/event/EventRecord.java:21` | `EventRecord.Position` |
| 运行时身份 = 播放实例令牌 + 片段 + 对象路径 + 事件下标；不按内容去重；记录 `id` 不参与身份 | `common/.../script/event/EventKey.java:22` | `EventKey` |
| 事件记录入口按路径末段分流 `event` / `mod_event` | `common/.../script/object/ObjectCodec.java:101` | `readEventRecord` |
| EVENT 解码：`command` / `event_type` / `id` 读字符串 | `common/.../script/object/ObjectCodec.java:121` | `readEvent` |
| EVENT 解码：`position` 走位置解析 | `common/.../script/object/ObjectCodec.java:122` | `readEvent` |
| EVENT 未知成员解码期直接抛 `ObjectFormatException`（不静默保留） | `common/.../script/object/ObjectCodec.java:123` | `readEvent` |
| 位置必须是对象 `{x,z}` 或 `{dx,dz}` | `common/.../script/object/ObjectCodec.java:129` | `readPosition` |
| 绝对：同时有 `x` 与 `z` | `common/.../script/object/ObjectCodec.java:134` | `readPosition` |
| 相对：同时有 `dx` 与 `dz` | `common/.../script/object/ObjectCodec.java:135` | `readPosition` |
| 恰好两个键；两套写法不能混写（`size != 2 || coordinates == deltas`） | `common/.../script/object/ObjectCodec.java:136` | `readPosition` |
| 位置两键都必须是有限数字 | `common/.../script/object/ObjectCodec.java:141` | `readPosition` |
| MOD_EVENT 解码：`event_type` 读字符串 | `common/.../script/object/ObjectCodec.java:152` | `readModEvent` |
| MOD_EVENT `data` 顶层必须是对象 | `common/.../script/object/ObjectCodec.java:154` | `readModEvent` |
| `data` 递归读入（对象 / 数组 / 标量） | `common/.../script/object/ObjectCodec.java:157` | `readModEvent` |
| MOD_EVENT 未知成员（含 EVENT 的 `command` / `position` / `id`）解码期拒绝 | `common/.../script/object/ObjectCodec.java:159` | `readModEvent` |
| `data` 递归：`null` / 数组 / 对象 / 布尔 / 数字分支 | `common/.../script/object/ObjectCodec.java:165` | `readData` |
| `data` 内数字必须有限（NaN / ±Infinity 拒绝） | `common/.../script/object/ObjectCodec.java:188` | `readData` |
| EVENT 对象级 `event_type` 回退值（value-only） | `common/.../script/object/ObjectValidator.java:757` | `checkEvent` |
| EVENT 只接受 `event_type=command`，其它值校验器报错 | `common/.../script/object/ObjectValidator.java:767` | `checkEvent` |
| MOD_EVENT 对象级回退只取显式写出的 value-only 字段（不吃 schema 缺省） | `common/.../script/object/ObjectValidator.java:780` | `checkModEvent` |
| MOD_EVENT `event_type` 为 null / 空串 = 缺少事件名 | `common/.../script/object/ObjectValidator.java:790` | `checkModEvent` |
| 超界事件（`time > duration`）在编译期丢弃 | `common/.../script/event/EventClipRuntime.java:20` | `compile`（文档注释） |
| 游标初始扫描位置 = `-inf`（尚未推进） | `common/.../script/event/EventClipRuntime.java:41` | `scannedThrough` |
| 编译入口：按片段轨道类型选 `event` / `mod_event` 路径 | `common/.../script/event/EventClipRuntime.java:58` | `compile` |
| 对象级缺省：`event_type`（MOD 缺省 `mod_event`，EVENT 缺省 `command`） | `common/.../script/event/EventClipRuntime.java:70` | `compile` |
| 对象级缺省：`data` | `common/.../script/event/EventClipRuntime.java:71` | `compile` |
| 事件名解析：记录级非空字符串优先，否则取对象级回退 | `common/.../script/event/EventClipRuntime.java:184` | `newRecord` |
| `command` 只在是字符串时取用 | `common/.../script/event/EventClipRuntime.java:186` | `newRecord` |
| `position` 走位置解析 | `common/.../script/event/EventClipRuntime.java:187` | `newRecord` |
| `data`：记录体显式带 `data` 键才覆盖对象级回退（省略 ≠ 空对象） | `common/.../script/event/EventClipRuntime.java:188` | `newRecord` |
| 位置解析：非 Map 返回 null | `common/.../script/event/EventClipRuntime.java:193` | `positionOf` |
| 绝对位置 `x/z` | `common/.../script/event/EventClipRuntime.java:199` | `positionOf` |
| 相对位置 `dx/dz` | `common/.../script/event/EventClipRuntime.java:205` | `positionOf` |
| seek 重置：游标停在 `time <= 目标时刻` 的最后一条之后；目标时刻本身不补触发 | `common/.../script/event/EventClipRuntime.java:173` | `reset` |
| 空命令 = 占位（标记已触发但不执行） | `common/.../trigger/server/ScriptEventManager.java:436` | `fireEvent` |
| `&&` 在运行时逐段拆分执行；单段失败不影响后续段 | `common/.../trigger/server/ScriptEventManager.java:605` | `executeCommand` |
| 服务端执行命令（前导斜杠由命令前缀处理器自身剥离） | `common/.../trigger/server/ScriptEventManager.java:612` | `performPrefixedCommand` |
| schema：EVENT 对象 | `common/.../script/schema/TrackSchemas.java:383` | `eventObjects` |
| schema：EVENT 对象级 `event_type` 缺省 `command` | `common/.../script/schema/TrackSchemas.java:385` | — |
| schema：MOD_EVENT 对象 | `common/.../script/schema/TrackSchemas.java:391` | `modEventObjects` |
| schema：MOD_EVENT 对象级 `event_type` 缺省 `mod_event` | `common/.../script/schema/TrackSchemas.java:393` | — |
| schema：MOD_EVENT `data` 结构 | `common/.../script/schema/TrackSchemas.java:394` | — |
| 内置播放器不消费 MOD_EVENT 轨（占位实现，不显示生效状态） | `common/.../script/ModEventTrackPlayer.java:11` | `ModEventTrackPlayer` |

## 二、事实三层清单

### 2.1 可引用事实（只有这些名字能写进字段）

| 事实名 | 分组 | 结论 / 语义 | 出处 |
|---|---|---|---|
| `script_played` | 脚本前置 | 有开始播放事实 **且** 有结束播放事实；中途退出也算，不是"完整看完"；玩家 + 脚本 id，锁存，与实例 / 退出原因无关 | `BuiltinPrerequisites.java:19`；`FactQueries.java:24` |
| `script_started` | 脚本前置 | 只要求有开始播放事实 | `BuiltinPrerequisites.java:25`；`FactQueries.java:15` |
| `script_completed` | 脚本前置 | 只看结束播放事实，不要求先开始过 | `BuiltinPrerequisites.java:31`；`FactQueries.java:19` |
| `started`（`clip_fact`） | 片段事实 | 片段执行进入时记录（时间门之前也记录）；只描述最近一次执行 | `RuleFactStore.java:59`；校验白名单 `ScriptValidator.java:1351` |
| `completed`（`clip_fact`） | 片段事实 | 本次执行完成时记录；新执行开始清掉上一次的完成标记 | `RuleFactStore.java:82`；`ScriptValidator.java:1351` |
| `succeeded`（`rule_fact`） | 规则事实 | 条件判定成功时记录；判定成功 ≠ 动作全部成功；只描述最近一次激活 | `RuleFactStore.java:111`；`ScriptValidator.java:1360` |
| `action_completed`（`rule_fact`） | 规则事实 | 动作批次实际提交完成后才记录；带调度的绑定在动作入队时不记录 | `RuleFactStore.java:128`；`ScriptValidator.java:1360` |

### 2.2 派生前置

| 事实名 | 结论 | 出处 |
|---|---|---|
| `script_played`（派生口径） | 由 `playback_started` + `playback_finished` 两条底账现场合成，本身不是独立记录 | `FactQueries.java:24` |

### 2.3 引擎内部事实（不可选，只做说明）

| 事实名 | 持久性 / 上限 | 出处 |
|---|---|---|
| `playback_started` | persistent / 256 | `FactType.java:16` |
| `playback_finished` | persistent / 256 | `FactType.java:17` |
| `trigger_fired` | persistent / 1024；单次触发器持久去重，跨会话不重复；要重新允许触发应改 `repeatable`，不是"清事实" | `FactType.java:18` |
| `region_entered` | session / 512 | `FactType.java:20` |
| `region_left` | session / 512 | `FactType.java:21` |
| `skip_vote` | session / 不按条数淘汰，实例结束显式清理 | `FactType.java:23` |
| `login` | session / 16 | `FactType.java:24` |
| `entity_kill` | session / 256 | `FactType.java:25` |
| `death` | session / 64 | `FactType.java:26` |
| `advancement` | session / 256 | `FactType.java:27` |
| `dimension_change` | session / 64 | `FactType.java:28` |
| `interact_block` | session / 256 | `FactType.java:29` |
| `interact_entity` | session / 256 | `FactType.java:30` |
| `item_craft` | session / 256 | `FactType.java:31` |
| `item_use` | session / 128 | `FactType.java:32` |
| `item_consume` | session / 128 | `FactType.java:33` |
| `item_release` | session / 128 | `FactType.java:34` |
| `item_use_interrupt` | session / 64 | `FactType.java:35` |
| `item_instant_use` | session / 128 | `FactType.java:36` |
| `item_pickup` | session / 512 | `FactType.java:37` |
| `item_drop` | session / 256 | `FactType.java:38` |

### 2.4 引用类型与解析位置

| 引用类型 | 文档位置 | 事实名生成 | 出处 |
|---|---|---|---|
| 外层前置 `requirement` | `meta.triggers[].requires[]`（字符串简写 = `script_played`；对象型 `{type, data.script}`） | `<前置名>:<脚本id>` | `ScriptValidator.java:2057`、`:2072` |
| 组合器子项 `combinator` | 条件树 `all_of` / `any` 的 `list[]` 内前置节点 | `<前置名>:<脚本id>` | `ScriptValidator.java:2418` |
| 片段事实 `clip_fact` | 条件节点 `type=clip_fact`，`clip` + `fact` | `clip_fact:<片段>:<叶子>` | `ScriptValidator.java:1345`、`:1351` |
| 规则事实 `rule_fact` | 条件节点 `type=rule_fact`，`binding` + `fact` | `rule_fact:<绑定>:<叶子>` | `ScriptValidator.java:1354`、`:1360` |
| 调度事实 `schedule_fact` | `rule_bindings[].schedule.on=fact`，`binding` + `fact` | `schedule_fact:<绑定>:<叶子>` | `ScriptValidator.java:1181`、`:1188` |

解析状态：`resolved` / `missing`（目标 id 不在已加载集合）/ `self_reference`（前置指向本脚本；规则事实仅限同一条规则内互引——目标绑定的 `binding.rule` 等于当前规则）/ `unknown_type`（缺目标、缺事实名，或事实叶子名不在对应字典内）/ `custom_readonly`（非内置前置类型，只读放行）/ `unresolved`（脚本 / 片段 / 绑定索引集合为空，存在性与归属都无法判定；不判缺失、不判自引用、不阻断；自引用例外，仍靠 `selfScriptId` 比对）。

条件树解包：组合器子项是「类型 + `conditions`」两层形态，事实叶子字段包在 `conditions` 里；`facts.ts` 与 `ruleConditions.ts` 用同一取值口径摊平（`{ type, ...conditions }`），兼容根节点平铺旧形态；嵌套组合器递归两层以上同样解包。依据：`plan/11/11-07-rule-condition-tree.md:36`、`:65`、`:121`。

### 2.5 诊断分工（避免同一语义重复出码）

- `requirements.ts`：管前置条目形态、解析状态与前置诊断（`REQ_TYPE_MISSING` / `REQ_SCRIPT_MISSING` / `REQ_SELF_REFERENCE` / `REQ_SCRIPT_MISSING_TARGET`）；条件树前置子项的字段校验走 `validateRequirementFields`。
- `facts.ts`：只管事实引用索引（五类位置登记 + 状态）与事实类诊断（片段 / 规则 / 调度事实的未知引用、同规则自引用 L86、未知事实名）。**不再为 `requires` / 组合器前置发 L43 / L44**，避免与结构层前置校验重复出同一码。
- 调度事实（`schedule_fact`）**不算自引用**：前向引用允许；成环由 `bindings.ts` 的 `detectScheduleCycles` 负责，`facts.ts` 不贴 `self_reference`、不发 L86。
- 规则事实自引用口径：`rule_fact.binding` 指向的绑定，其 `rule` 字段等于当前条件所属规则，才算同规则自引用；跨规则互引是正常引用，不是自引用。Java 校验器侧只查未知绑定、不判自引用，L86 为编辑器合同补充。

## 三、行为合同码全表（L35–L90，连续 56 条）

> 与第 7 轮 `L01–L34` 不冲突；本表是 `structural.ts` 装配与 `verify-11` 的共同依据。级别：`block` = 解析期拒绝；`error` = 校验器错误 / 编辑器合同禁止；`warn` = 警告 / 建议最多一条 / 运行期丢弃；`info` = 编辑器提示。面板按 `block → error` 折叠三级呈现。

| 码 | 级别 | 含义 | 依据 |
|---|---|---|---|
| L35 | block | 元信息缺失或 id 形态不合法 | `ScriptParser.java:193 parseMeta` |
| L36 | block | 时间轴 / 轨道 / 片段结构非法 | `ScriptValidator.java:237 validate` |
| L37 | block | 片段起点或时长缺失、非有限、时长为 0 | `ScriptValidator.java:286 validate` |
| L38 | error | 独立片段 id 非法或重复、轨道未知、对象缺失或为空 | `ScriptValidator.java:447 checkStandaloneTrack` |
| L39 | block | 片段出口结构错误 / 对象 schema / 未知对象路径 / 模式与类型不匹配 | `ObjectValidator.java:292 checkProperty` |
| L40 | block | 触发器数组或元素形态错误 | `ScriptValidator.java:2034 validateTriggerRequires` |
| L41 | error | 触发器类型缺失或不在已注册类型内 | `ScriptValidator.java:2533 isKnownType` |
| L42 | error | 触发器 id 形态错误或重复 | `ScriptValidator.java:1995 validateTriggerIdentities` |
| L43 | block | 前置不是数组 / 元素形态错误 / 字符串为空 / 内置前置缺目标 | `ScriptValidator.java:2030 validateTriggerRequires` |
| L44 | error | 前置自引用或目标不存在 | `ScriptValidator.java:2494 validatePrerequisiteRef` |
| L45 | block | 条件不是对象 / 使用废弃旧字段 / 必填缺失或类型错误 | `ScriptValidator.java:2086 validateTriggerConditions` |
| L46 | block | 组合器列表缺失 / 非数组 / 为空 / 子项结构错误 / 嵌套超 8 层 / 子项类型未知 | `ScriptValidator.java:1378 checkRuleCombination0`；深度常量 `Evaluators.java:545 MAX_COMBINATION_DEPTH=8` |
| L47 | block | 事件类触发器进组合器但窗口为 0 | `plan/11/11-15-validation-and-diagnostics.md:49` |
| L48 | error | 离开外扩用在不可用类型上（将被忽略） | `ScriptValidator.java:2133 validateTriggerConditions` |
| L49 | error | 轮询间隔用在事件驱动类型上（将被忽略） | `ScriptValidator.java:2139 validateTriggerConditions` |
| L50 | error | 进入边沿用在死亡类上（将被忽略） | `ScriptValidator.java:2143 validateTriggerConditions` |
| L51 | block | 连续语义不是对象 / 子字段类型或范围错误 / 用在不适用类型上 | `ScriptValidator.java:2190 validateContinuity` |
| L52 | info | 自定义前置类型允许存在：编辑器只读，不报错误 | `ScriptValidator.java:2494 validatePrerequisiteRef` |
| L53 | block | 规则数组或元素形态错误 / 缺条件或动作 / 动作为空 / id 缺失或重复 | `ScriptValidator.java:514 checkScriptRuleCollection` |
| L54 | block | 策略不是对象 / 单次布尔 / 模式非法 / 超时取值 / 驻留冷却为负 / 超时动作形态错误 | `ScriptValidator.java:891 checkRulePolicy` |
| L55 | block | 条件类型未知 / 结构缺失 / 事实叶子缺引用或事实名 / 引用未知片段或绑定 / 组合器为空或过深 | `ScriptValidator.java:1286 checkRuleConditionV2` |
| L56 | block | 绑定形态 / id / 规则片段引用 / 时间门 / 控制方式 / 调度 / 事实白名单 / 出口结构错误 | `ScriptValidator.java:943 checkRuleBinding` |
| L57 | warn | 持有时条件等待片段受时间门限制不可达 | `ScriptValidator.java:1003 checkHoldReachability` |
| L58 | block | 动作元素形态错误 / 类型缺失或未知 / 出现 hold | `ScriptValidator.java:1557 checkActionElementNew` |
| L59 | error | 跳转动作缺目标或目标未知 / 出现旧轨道与时间字段 / 入口时间非法 | `ScriptValidator.java:1671 checkActionGotoClip` |
| L60 | block | 相机动作通道未声明 / 为空重复未知 / 通道值缺失或非有限 / 模式未知 / 优先级非整数 / 未声明通道字段 | `ScriptValidator.java:1749 checkModifierBody` |
| L61 | block | 覆盖层动作缺类型或不是 fade / 不透明度越界 / z 值非整数 | `plan/11/11-15-validation-and-diagnostics.md:53` |
| L62 | block | 调色动作通道不在十五个基础通道内或值非有限 | `plan/11/11-15-validation-and-diagnostics.md:53` |
| L63 | block | 三个无参动作带参数 | `plan/11/11-15-validation-and-diagnostics.md:53` |
| L64 | block | 发声动作缺音效 / 音量或音高非有限 | `ScriptValidator.java:1688 checkActionPlaySound` |
| L65 | error | 命令动作缺命令或命令为空 | `ScriptValidator.java:1699 checkActionEmitCommand` |
| L66 | warn | 命令动作带前导斜杠 | `plan/11/11-15-validation-and-diagnostics.md:53` |
| L67 | block | 动作出现未知键 | `ScriptValidator.java:1716 rejectActionKeys` |
| L68 | error | 超时动作里出现命令动作（编辑器合同禁止；服务端命令表不编译超时动作） | `plan/11/11-15-validation-and-diagnostics.md:17` |
| L69 | block | 事件对象模式或关键帧结构错误 | `ObjectValidator.java:317 checkProperty` |
| L70 | block | 同一片段出现多个同类事件对象 | `plan/11/11-12-event-records.md:37` |
| L71 | block | 关键帧缺时间或值 / 时间负或非递增 | `ObjectValidator.java:359 checkKeyframes` |
| L72 | warn | 记录超出片段时长（运行期编译期丢弃；新建阻止） | `EventClipRuntime.java:20 compile` |
| L73 | block | EVENT 记录出现未知成员 | `ObjectCodec.java:123 readEvent` |
| L74 | error | EVENT event_type 不是合法值 | `ObjectValidator.java:767 checkEvent` |
| L75 | block | EVENT command 非字符串 | `ObjectCodec.java:121 readEvent` |
| L76 | block | position 键不成对 / 混写 / 多键 / 非有限 | `ObjectCodec.java:136 readPosition` |
| L77 | block | EVENT 记录 id 非字符串 | `ObjectCodec.java:121 readEvent` |
| L78 | warn | EVENT 命令带前导斜杠 | `plan/11/11-12-event-records.md:41` |
| L79 | block | MOD_EVENT 记录值非对象 | `ObjectCodec.java:101 readEventRecord` |
| L80 | block | MOD_EVENT 出现 command / position / id 等禁止键 | `ObjectCodec.java:159 readModEvent` |
| L81 | block | MOD_EVENT 事件名缺失 / 为空 / 非字符串 | `ObjectValidator.java:790 checkModEvent` |
| L82 | block | MOD_EVENT data 顶层非对象 | `ObjectCodec.java:154 readModEvent` |
| L83 | block | MOD_EVENT data 内数字非有限 | `ObjectCodec.java:188 readData` |
| L84 | warn | 多条 EVENT 轨（建议最多一条，不自动合并） | `ScriptParser.java:1062 validateTracks` |
| L85 | error | 乒乓模式用在事件轨 | `plan/11/11-15-validation-and-diagnostics.md:55` |
| L86 | warn | 规则事实同规则自引用（目标绑定属于当前规则；跨规则互引不报） | `plan/11/11-fact-inspector.md:56` |
| L87 | warn | 规则事实与调度成环 | `plan/11/11-fact-inspector.md:56` |
| L88 | warn | 片段事实引用在冻结状态下不会开始的片段 | `plan/11/11-fact-inspector.md:56` |
| L89 | info | 易误读事实语义纠正（script_completed / action_completed） | `plan/11/11-fact-inspector.md:15` |
| L90 | info | 运行态 / 边界提示（trigger_fired 不可清除、出口只覆盖本绑定 goto、0 秒事件预览限制、扩展事件内置不消费、多轨建议合并） | `plan/11/11-14-event-timeline-and-seek.md:39` |

### 3.1 时机与修复原则（同表约束，装配层不得重复判级）

- 时机：打开脚本 = 全量；编辑中 = 结构 + 引用即时检查；保存前 = 全量；导出 / 构建前 = 再跑全量；刷新 / 切换脚本 = 丢弃旧诊断重算。
- 修复原则显式禁止：不自动补默认值掩盖缺失；不自动删除记录；不自动把旧字段转成新字段；不自动忽略错误（只有警告可保存）。

## 四、文档与 Java 偏差记录

| 项 | 文档说法 | 代码事实 | 落地 | 出处 |
|---|---|---|---|---|
| 多条 EVENT 轨 | warn（建议最多一条） | `ScriptParser.validateTracks` 走 `ErrorLog.log` 解析日志，不是校验器 `[警告] ` 前缀 issue | 按计划判 warn（L84），不自动合并、不新建第二轨 | `ScriptParser.java:1062` |
| 乒乓模式用在事件轨 | error 拒绝 | 当前 Java 校验器未对事件轨 `loop_mode=pingpong` 做专用拦截（通用循环模式校验之外无事件轨分支） | 编辑器合同按计划判 error（L85）；代码缺口已在上表依据列标注 | `plan/11/11-15:55` |
| 规则事实自引用 | warn | Java 校验器只查未知绑定，不做自引用判定 | 编辑器侧按「目标绑定的 `rule` === 当前规则」判定同规则自引用 warn（L86）；跨规则互引不是自引用；Java 缺口为编辑器合同补充 | `plan/11/11:56`；`ScriptValidator.java:1354` |
| 前置索引为空 | 未提供项目图时不应判缺失 | Java `knownScriptIds != null && !contains(...)`：集合为 null 时跳过存在性检查 | 编辑器口径一致：`scriptIds` / `clipIds` / `bindingIds` 为空集 → `unresolved`（不阻断），不判 missing、不判已解析；自引用仍由 `selfScriptId` 判定 | `ScriptValidator.java:2066`、`:2524` |
| 调度事实自引用 | 调度引用自身绑定不应贴自引用；成环才是问题 | Java 侧调度 fact 只校验绑定 / 事实名存在性；成环由绑定表遍历检测 | `facts.ts` 对 `schedule_fact` 永不贴 `self_reference`、不发 L86；成环 block 归 `bindings.ts` | `ScriptValidator.java:1354`；`bindings.ts detectScheduleCycles` |
| 组合器嵌套上限 | 8 层 | `Evaluators.MAX_COMBINATION_DEPTH = 8`，一致 | 一致，无偏差 | `Evaluators.java:545` |
| MOD_EVENT 内置消费 | 内置播放器不消费 / 不显示生效状态 | `ModEventTrackPlayer` 为占位实现，未接事件分发 | 一致；面板不显示生效状态 | `ModEventTrackPlayer.java:11` |
| `script_played` 语义 | 开始 + 结束合成，中途退出也算 | `FactQueries.scriptPlayed = started && finished`，结束事实不区分退出原因 | 一致 | `FactQueries.java:24` |

## 五、自检记录

- 临时脚本：仓库根 `.tmp-run-events.ts`，`node --experimental-strip-types .tmp-run-events.ts`，真实调用 EVENT 合法 / 非法记录体、MOD_EVENT 回退 / 空串 / data 非对象 / 禁键、标记位置与拖动边界、最小文档事实索引、合同码唯一性与连续性。结果 `summary ok=49 fail=0`，跑完已删除。
- 二轮修复自检：`.tmp-facts-fix.ts`，断言同规则自引用 / 跨规则互引非自引用 / 目标缺失 / 索引为空降级 unresolved / 调度事实不贴自引用 / 前置不重复出 L43·L44。结果 `summary ok=18 fail=0`，跑完已删除。
- 三轮修复自检：`.tmp-facts-unwrap.ts`，断言组合器内（含嵌套两层）`clip_fact` 已知 resolved / 缺失 missing / 未知事实名 unknown_type，`rule_fact` 同规则 self_reference / 跨规则 resolved，组合器内 L55 未知目标 / 未知事实名诊断正常触发；并用真实夹具 `valid/behavior-rules.json` 复核。结果 `summary ok=13 fail=0`，跑完已删除。回归：`verify-11` 386/0、`verify.ts` 171/0、`core/doc/verify.ts` 198/0，无断言口径变动。
- `npx vue-tsc --noEmit`：本代理文件（`features/behavior/**`、`catalog/behaviorEvents.ts`）相关报错为 0；其余报错均在其他轮次半成品文件，不归本代理。
