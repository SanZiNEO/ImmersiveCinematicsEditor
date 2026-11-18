# 11 轮规则域事实清单（rules / conditions / actions / bindings / policy / schedule / exit）

> 溯源口径：`file` 相对主模组仓库根（`E:\Documents\GitHub\ImmersiveCinematics`），`line` 为 1 起行号，符号为该处 Java 类 / 方法 / 常量。
> 编辑器落地文件（纯 TS，无 Vue / UI / 命令层）：
> - `src/core/schema/catalog/behaviorRules.ts`
> - `src/features/behavior/rules.ts`
> - `src/features/behavior/ruleConditions.ts`
> - `src/features/behavior/actions.ts`
> - `src/features/behavior/bindings.ts`

## 1. 规则定义与 policy

| 结论 | Java 出处 |
| --- | --- |
| 规则四键白名单 `id / condition / actions / policy`；未知键报错 | `common/src/main/java/com/immersivecinematics/immersive_cinematics/script/rule/RuleCollectionParser.java:42` `DEFINITION_KEYS`；解析拒绝未知键 `:106` |
| 规则 id 字符集 `^[A-Za-z0-9_]{1,64}$` | `RuleCollectionParser.java:38` `ID_PATTERN`；编辑器同口径 `src/core/doc/keys.ts:39` `RULE_ID_PATTERN` |
| `once` 缺省 `true`（每次片段执行内一次，非脚本永久一次） | `script/rule/RuleDefinition.java:24` `DEFAULT_ONCE` |
| `cooldown` 缺省 `0`，必须有限且 `>= 0`；播放时钟，跨执行保留 | `RuleDefinition.java:27` `DEFAULT_COOLDOWN`；构造校验 `:80-82` |
| `mode` 枚举 `enter / dwell`，缺省 `enter` | `RuleDefinition.java:30` `MODE_ENTER`、`:33` `MODE_DWELL`、`:36` `MODES`；构造校验 `:77-79` |
| `dwell` 缺省 `0`，必须有限且 `>= 0`；`dwell=0` 仍是驻留模式，不自动改写为 enter | `RuleDefinition.java:39` `DEFAULT_DWELL`；构造校验 `:83-85`（不做模式回写） |
| `timeout`：`> 0` 或 `-1`（无限等待），`0` 非法；缺省 `-1` | `RuleDefinition.java:42` `TIMEOUT_NONE`；构造校验 `:86-88` |
| `on_timeout` 动作数组，缺省空；policy 六键白名单 | `RuleCollectionParser.java:43-44` `POLICY_KEYS`；动作解析 `:124` |
| 条件缺失 / 空、动作缺失 / 空 → 构造抛错（编辑器按 block 处理） | `RuleDefinition.java:71-75` |

## 2. 条件树（12 类型）

### 2.1 类型白名单与嵌套上限

| 结论 | Java 出处 |
| --- | --- |
| 八状态叶子 `time / location / facing / biome / dimension / camera_pos / camera_facing / camera_fov` | `client/rule/ClientConditions.java:36` `V1_TYPES` |
| 两事实叶子 `clip_fact / rule_fact` | `ClientConditions.java:46` `FACT_TYPES` |
| 组合器 `all_of / any`，子项 `{ type, conditions }`；嵌套上限 8 层（顶层 = 1） | `trigger/server/evaluator/Evaluators.java:545` `MAX_COMBINATION_DEPTH = 8`；组合器 list 读取 `:597-598`；深度判断 `Evaluators.java:617`、`ClientConditions.java:114` |
| 组合器子项：嵌套组合器走 `conditions` 递归；叶子按 `conditions` 数据求值 | `ClientConditions.java:107-120` `evalChild` |

### 2.2 各叶子字段面与边界

| 类型 | 字段与语义 | Java 出处 |
| --- | --- | --- |
| `time` | `at`（本地时钟 ≥ 该点）优先；`from / to` 闭区间可单边；三者都缺 → 不成立。挂起期间本地时钟冻结 | `ClientConditions.java:166-173` `evalTime`（at `:167`、from `:168`、to `:169`） |
| `location` | `dimension` 精确相等；`corner1/corner2` 方体先判，命中即 true；否则 `position + radius` 球形（半径缺省 0）；两者都无 → 只看维度，维度也无 → false | `ClientConditions.java:176-195` `evalLocation`（dimension `:177`、方体 `:181-187`、球 `:188-193`、兜底 `:194`） |
| `facing` | `yaw1 / pitch1 / yaw2 / pitch2` 四角都要有限数字；区间跨 ±180° 环绕 | `ClientConditions.java:198-206` `evalFacing`（字段 `:199-200`） |
| `biome` | `biome` 通配 id（`*` / `ns:*` / 子串 / 全等） | `ClientConditions.java:209-214` `evalBiome`（pattern `:210`） |
| `dimension` | `dimension` 通配 id（与 location.dimension 的精确相等不同） | `ClientConditions.java:217-222` `evalDimension`（pattern `:218`） |
| `camera_pos` | 无相机 → false；**方体两角合法即直接返回，球形被忽略**（与 location 的 OR 相反）；无维度字段；无区域 → false | `ClientConditions.java:225-239` `evalCameraPos`（无相机 `:226`、方体 `:227-231`、球 `:232-237`、兜底 `:238`） |
| `camera_facing` | 复用 facing 四角；无相机 → false | `ClientConditions.java:128` 分发行；`evalFacing` `:198-206` |
| `camera_fov` | `from / to` 闭区间度，可单边；无相机 → false；都缺 → false | `ClientConditions.java:242-250` `evalCameraFov`（from `:244`、to `:245`） |
| `clip_fact` | `clip` 片段 id + `fact`（`started / completed`）；作用域 = 该片段最近一次执行 | `ClientConditions.java:140-147` `evalClipFact`（clip `:141`、fact `:142`） |
| `rule_fact` | `binding` 绑定 id + `fact`（`succeeded / action_completed`） | `ClientConditions.java:153-160` `evalRuleFact`（binding `:154`、fact `:155`）；事实名词汇 `script/rule/RuleSchedule.java:144` `FACT_NAMES` |

## 3. 动作（九种）

| 结论 | Java 出处 |
| --- | --- |
| 九动作白名单 `camera_set / overlay_set / adjust_set / goto_clip / pause / resume / exit / play_sound / emit_command` | `camera/rule/RuleActions.java:48-50` `ACTION_TYPES_V1` |
| `camera_set`：`channels` 非空、不重复、六通道子集；选中通道必须给值；`mode` 可选 `add / multiply / replace`；`priority` 整数缺省 0；持续到片段活跃窗末 | `RuleActions.java:117-141` `cameraSet`；channels `:144-168`；mode `:120-134`；priority `:135`；通道值 `:171-211`（position 三轴 `:175-190`，标量 `:193-206`） |
| 六通道 `position / yaw / pitch / roll / fov / zoom` | `camera/cover/CameraChannels.java:36` `NAMES` |
| 缺省合成模式：position/yaw/pitch/roll = add；fov/zoom = multiply；replace 必须显式写 | `CameraChannels.java:67-69` `defaultMode`；模式解析 `RuleActions.java:123-126` |
| `overlay_set`：`layer_type` 仅 `fade`；`color` 缺省 `#000000`；`opacity` 缺省 1 并夹到 0..1；`z_index` 整数缺省 10 | `RuleActions.java:225-241` `overlaySet`（layer_type `:226`、color `:235`、opacity `:236`、z_index `:237-238`）；默认层级 `overlay/CanvasTransform.java:38` `DEFAULT_Z_INDEX = 10`；层类型白名单 `RuleActions.java:62` `OVERLAY_LAYER_TYPES_V1` |
| `adjust_set`：十五通道 `exposure / contrast / highlights / shadows / whites / blacks / hue / saturation / vibrance / lightness / temperature / tint / red / green / blue`；至少一个；未写通道在参数数组里填 0（0 = 校色恒等，不改变画面） | `RuleActions.java:56-59` `ADJUST_CHANNELS_V1`；参数构建 `:259-300`（未知通道 `:265-270`、非有限值 `:272-276`、空集合 `:280-284`、缺省恒等 `:285`） |
| `goto_clip`：`clip` 必填片段 id；`entry_time` 可选 ≥ 0 有限数字，缺省 0；只接受新形态，旧 `track / at` 字段拒绝 | `script/rule/runtime/RuleActionRunner.java:109-157` `launchBranch`（clip `:114-123`、未知片段 `:125-128`、entry_time `:134-149`）；分发 `:85` |
| `pause / resume`：无参，挂起账本配对手动销项，可跨规则配对；释放者 = resume 动作或带调度的绑定 | `RuleActionRunner.java:77-78`；释放者口径 `RuleRuntime.java:786-798` `computePauseReleasable` |
| `exit`：无参，结束当前播放实例渐出；≠ 绑定出口 | `RuleActions.java:92`（`requestDeclaredExit`） |
| `play_sound`：`sound` 必填音效 id；`volume / pitch` 缺省 1；未知 id 运行期跳过 | `RuleActions.java:305-322` `playSound`（sound `:306`、volume `:319`、pitch `:320`） |
| `emit_command`：`command` 必填非空白；客户端只发动作引用（绑定 id + 动作下标），命令原文不交客户端 | `RuleActions.java:330-347` `emitCommandForBinding`（command `:332-337`、发包 `:344-346`） |
| 命令表只编译主动作列表 `actions()`，不编译 `on_timeout()`；超时动作里的命令动作解析不到表项 → 编辑器合同拦截 | `trigger/server/RuleCommandTable.java:68`（`definition().actions()`） |

## 4. 绑定（gate / control / schedule / exit）

| 结论 | Java 出处 |
| --- | --- |
| 绑定七键白名单 `id / rule / clip / gate / control / schedule / exit`；不接受 condition / actions | `RuleCollectionParser.java:45-46` `BINDING_KEYS`；未知键拒绝 `:238` |
| `rule` 必须解析到已存在规则；`clip` 必须解析到已存在片段 | `RuleCollectionParser.java:242-252` |
| `gate` 必填，只有 `at`；≥ 0 有限；无限片段无上界；有限片段 `at > duration` 越界报错，不夹取 | `RuleCollectionParser.java:294-326` `parseGate`（缺失 `:295-298`、非对象 `:300-302`、未知键 `:304-308`、范围 `:313-316`、无限片段 `:317-319`、越界 `:320-324`） |
| `control` 缺省 `observe`；枚举 `observe / hold`；hold = 门后未成立挂起，无限等待由 `timeout=-1` 表达，hold 不是动作 | `script/rule/RuleControl.java:16` `OBSERVE`、`:19` `HOLD`、`:34` `SCRIPT_NAMES`；解析缺省 `RuleCollectionParser.java:256-268` |
| 五调度 `clip_start / clip_complete / local_time / delay / fact` | `script/rule/RuleReleaseKind.java:11-23`；名称表 `:38` `SCRIPT_NAMES` |
| 调度参数：`clip_start/clip_complete` = `clip`；`local_time` = `clip + at`；`delay` = `seconds`（真实秒，挂起不冻结）；`fact` = `binding + fact` | `script/rule/RuleSchedule.java:96-101` `parameterNames`；读取 `:110-141`（clip `:124-125`、local_time `:126-127`、delay `:128`、fact `:129-139`）；delay 真实时钟语义 `script/rule/runtime/RuleRuntime.java:468` |
| `fact` 事实名 `succeeded / action_completed`；允许前向引用；成环报错 | `RuleSchedule.java:144` `FACT_NAMES`；未知绑定 `:135-137`；成环检测 `RuleCollectionParser.java:328-336`（环 `:333-335`） |
| 五出口 `continue / goto / return / end_execution / end_script`；只有 `goto` 允许 `target + entry_time`（`entry_time` 缺省 0，≥ 0）；其余带这两键报错；省略 = 片段默认 | `script/rule/ClipExitPolicyParser.java:28` `KEYS`、`:31-32` `KIND_NAMES`；goto target `:55-59`、entry_time `:60`；非 goto 拒绝 `:63-69`；枚举映射 `:77-81` |

## 4.1 静态诊断：可达性 / 持有等待 / 配对 / 出口混用

> 编辑器不跑运行时，以下为静态分析；口径尽量对齐 `RuleRuntime` 帧末诊断（`diagnoseUnreachableHolds` / `releasePauseWithoutReleaser`），证据不足时不下不可达结论。

| 诊断 | 落地级别与判定 | Java 出处 |
| --- | --- | --- |
| `clip_fact` 目标在宿主片段活跃窗口之外 → warn「可能永远等不到」 | 静态顺序表：目标起点晚于宿主窗口末端，或目标窗口末端不晚于宿主起点；目标有效无限 / 宿主有效无限 / 无起点独立片段 → 不下结论 | `script/Clip.java:103` `isInfinite`、`:180` `isLoopInfinite`、`:189` `isEffectivelyInfinite`、`:203` `getWindowEnd`；运行期不可达扫描 `script/rule/runtime/RuleRuntime.java:752-763` `scanUnreachableClipFact` |
| `clip_fact` 时间线事实缺失 → info「无法判定可达性」 | refs 未带 `clips` 表 / 宿主上下文缺失 / 事实不全 → 不静默放过，也不假回退 | 编辑器合同（11-07 §技术细节；11-15 §时机）；运行期有账本不缺此事实 |
| hold + 条件 `time` 阈值晚于时间门 → warn「冻结后可能永远等不到未来局部时间」 | 阈值 = `at/from` 取大者（同 `scanUnreachableTime`）；门后冻结期间本地时钟不推进 | `RuleRuntime.java:766-771` `scanUnreachableTime`；冻结账本 `:600-614` `frozenByRules`；诊断出口 `:671-688` `diagnoseUnreachableHolds` |
| hold + 调度目标片段不会开始 → warn；缺时间线 → info | 调度 `clip_start/clip_complete/local_time` 的 `clip` 与宿主片段做窗口可达性比较 | `RuleRuntime.java:752-763`；调度形态 `RuleSchedule.java:124-127` |
| `pause` 无释放者 → warn；`resume` 无配对 `pause` → warn | 释放者口径对齐 `computePauseReleasable`：任一 `resume` 动作（主动作 / `on_timeout`）或任一带非立即 `schedule` 的绑定；静态不预测运行时可触发性 | `RuleRuntime.java:786-798` `computePauseReleasable`（非立即调度 `:790`、resume `:792-793`）；账本 `:190-199` `onActionPause/onActionResume`；无释放者自动释放 `:627-633` `releasePauseWithoutReleaser`；`RuleSchedule.java:37` `isImmediate` |
| 同一片段多条绑定混用 `continue / return / end_execution` → info「三者当前行为一致，保留原文不改写」 | 按宿主片段分组；`goto / end_script` 不参与同义分组 | `script/rule/ClipExitPolicyParser.java:77-81` 枚举映射；同义语义 11-10 §五种出口；不改写原则 11-10 §2.3 |

## 5. 反直觉细节（落地重点核对项）

1. **`dwell=0` 仍是驻留模式**：Java 构造器只校验 `dwell >= 0`，不把 `mode=dwell, dwell=0` 回写成 `enter`（`RuleDefinition.java:83-85`）。落地：info 提示，不自动改写。
2. **`camera_pos` 方体优先**：方体两角合法即 `return inBox(...)`，球形被忽略（`ClientConditions.java:227-231`）；与 `location` 的「方体未命中再判球」OR 语义相反（`:181-193`）。落地：同时写两区域给 warn。
3. **`location` 先方体后球（OR）**：方体未命中不阻断，继续判球形（`ClientConditions.java:181-193`）。落地：不告警。
4. **gate 越界报错不夹取**：有限片段 `at > duration` 直接解析异常（`RuleCollectionParser.java:321-323`）；无限片段无上界（`:317-319`）。
5. **`delay` 是真实秒**：挂起期间不冻结；与 `time` 条件的本地时钟冻结语义不同（`RuleSchedule.java:128`）。
6. **emit_command 客户端只发引用**：不携带命令原文，发包 = 实例 id + 绑定 id + 动作下标（`RuleActions.java:344-346`）；命令表按绑定 id + 下标回查（`RuleCommandTable.java:68` 只编译 `actions()`）。
7. **`exit` 动作 ≠ 绑定出口**：动作 `exit` 结束当前实例渐出（`RuleActions.java:92`）；绑定 `exit` 只在本绑定 `goto_clip` 启动的分支完成时作为分支出口生效。

## 6. 文档与 Java 偏差及落地裁决

| # | 文档说法 | Java 代码事实 | 编辑器落地 | 出处 |
| --- | --- | --- | --- | --- |
| 1 | 11-15 把「规则事实自引用」列入 info；11-07 / 任务书要求 warn | 服务端校验器不检查自引用（只查未知绑定） | 按任务书落地 **warn**（`RULE_CONDITION_BINDING_SELF`） | `ClientConditions.java:153-160`；校验器无自引用分支 |
| 2 | 文档：命令不带前导斜杠，前导斜杠警告 | `emitCommandForBinding` 只查空白，不拦斜杠 | 落地 **warn**（`ACTION_COMMAND_SLASH`），不 block | `RuleActions.java:332-337` |
| 3 | 11-15 合同：超时动作里出现命令动作 = 错误 | 命令表只编译主动作列表，`on_timeout()` 从不编译；服务端校验器也未拦截 | 落地 **block**（`ACTION_COMMAND_IN_TIMEOUT`），编辑器合同前置拦截 | `RuleCommandTable.java:68` |
| 4 | 文档：`adjust_set` 未写通道 = 不改变画面，不是 0 | 参数数组未写通道填 0，0 在校色参数空间为恒等（注释明示「0 = 不改变画面」） | 面板未写通道留空，不回显 0；校验只要求至少一个通道 | `RuleActions.java:256-257`、`:285` |
| 5 | 文档笼统写 camera_set 缺省合成模式 | 缺省按通道分：偏移类 add、缩放类 multiply | 目录按通道注明缺省模式；`mode` 缺省时不写进文档 | `CameraChannels.java:67-69` |
| 6 | 文档：未知片段 / 绑定 / 规则引用 block | 解析器抛 `ScriptParseException`（parser 拒绝级） | 落地 **block** | `RuleCollectionParser.java:245`、`:251`、`:136`；`ClipExitPolicyParser.java:58` |
| 7 | 11-15 §编辑器诊断(info) 清单列「片段事实引用在冻结下不可达的片段」；11-07 §二要求 warn「可能永远等不到」 | 服务端不做静态可达性判定（运行期按账本 + 播放头扫描，`RuleRuntime.java:752-763`） | 按 11-07 / 任务书落地 **warn**（`RULE_CONDITION_CLIP_UNREACHABLE`）；证据不足给 info | `ClientConditions.java:140-147`；`RuleRuntime.java:752-763` |
| 8 | 11-10 §诊断区列「持有等待未来时间 / 持有等待不会开始的片段 / 暂停没有释放者」，未逐一定级 | 运行期均为 `warn(...)` 级诊断（`RuleRuntime.java:631`、`:687`） | 落地 **warn**；同义出口混用为纯写法提示，落地 **info** | `RuleRuntime.java:627-633`、`:671-688`；11-10 §五种出口 |
| 9 | 文档未规定「时间线事实缺失」时的级别 | 运行期有执行账本，不存在缺事实场景；编辑器静态层由调用方收集片段顺序 / 起点 / 时长 / 循环 | 缺数据给 **info**（`RULE_CONDITION_TIMELINE_MISSING` / `BINDING_TIMELINE_MISSING`），不静默放过、不假回退 | 编辑器合同；`Clip.java:203` 窗口口径 |
| 10 | 任务书描述 pause 配对「同规则或跨规则」 | Java 释放者还包括「任一带非立即 schedule 的绑定」（调度释放仍可能），不只 resume 动作 | 静态判定同 Java 口径：无 resume 且无调度绑定才报无释放者 | `RuleRuntime.java:790`、`:792-793`；`RuleSchedule.java:37` |

## 7. 已实现边界与剩余范围

- **片段事实可达性**：已实现（§4.1 第一行）。静态顺序表比较宿主 / 目标窗口；目标无限 / 循环无限、宿主无限、独立片段无起点时保守不下结论；缺时间线事实给 info。分支图隔离（goto 子树内 / 外）不在静态顺序表推断范围内，运行期由账本判定。
- **hold 挂起可达性**：已实现静态提示（§4.1 第三、四行）。编辑器不预测运行时可触发性，也不自动解除持有；运行期的「本执行内是否仍可触发」由 `RuleRuntime` 账本判定。
- **pause / resume 配对、同义出口混用**：已实现（§4.1 第五、六行）。
- 事件记录 / 事实账本 / 调度运行时账本的运行时语义不在本轮纯函数层范围（见 11-12 / 11-13 / 11-14）。
