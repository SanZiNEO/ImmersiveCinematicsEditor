# 14 事件归属（三种「事件」）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`13-loop-exit-branch-attribution.md`、`07-continuity-and-facts.md`、`../05-timeline-workspace/README.md`

## 1. 职责

项目里「事件」一词指三种完全不同的东西，它们由不同系统消费、在不同 UI 编辑。本文件给出定义、归属、禁止混用清单，避免作者与后续轮次把三者当成一个概念。

## 2. 三种「事件」

| # | 名称 | 载体 | 消费者 | UI 归属 |
|---|---|---|---|---|
| A | 时间线片段事件记录（EVENT/MOD_EVENT） | clip.objects.event/mod_event | 主模组实际消费者/第三方扩展 | 05主轴只编排片段，clip.effects的06记录组承载、11完成专用内容 |
| B | **触发器事实** | 服务端 `FactLedger`（21 种 `FactType`） | 事件驱动触发器的求值器（`Evaluators`）、窗口判定（`FactWindow`）、前置条件（`FactQueries`） | 触发器面板（只读语义说明，07） |
| C | **规则命令动作** | `rules[].actions[]` 的 `{type:"emit_command", command:"…"}` | 客户端 `RuleActions.emitCommandForBinding` → 服务端 `RuleCommandTable` 查表执行 | 规则面板动作列表（11） |

## 3. 现有事实（源码锚点）

### 3.1 A：时间轴事件记录

| 事实 | 锚点 | 说明 |
|---|---|---|
| 对象路径 | `MOD:script/object/ObjectCodec.java:106-113` | `event` / `mod_event`；其它后缀报错 |
| EVENT 记录字段 | `MOD:script/event/EventRecord.java:8-19` | `time` / `eventType`（EVENT 只接受 `command`）/ `command` / `position` / `data` |
| `position` 语义 | `EventRecord.java:21-27` | `relative=false` 世界绝对 x/z；`true` 相对激活点 dx/dz |
| MOD_EVENT 校验 | `MOD:script/object/ObjectValidator.java:775-796` | 必须有 `event_type`；`data` 任意 |
| 编译 | `MOD:script/event/EventClipRuntime.java:52-70` | 加载/实例创建时读成数组；`time > duration` 丢弃 |
| 游标语义 | `EventClipRuntime.java:21-29` | 只触发 `(上次, 本次]`；首次从 `-inf` 起；每条最多一次 |
| seek | `MOD:script/event/EventSeekPlan.java:32-52` | 前跳不补、后跳回退可再触发；落在片段外钳制 |
| 身份 | `MOD:script/event/EventKey.java:20-31` | `(instanceToken, clip, objectPath, eventIndex)`，按对象身份 |
| 服务端执行 | `MOD:trigger/server/ScriptEventManager.java:426-445`（`fireEvent`） | 只认 `eventType=="command"`；非 command 限频警告并跳过；对每个 viewer 执行命令 |
| 客户端移动 | `MOD:script/PlayerMoveController.java:56-95` | 提取带 `position` 的 EVENT 记录，按全局时间排序驱动玩家直线移动 |
| 客户端驱动注册 | `MOD:script/track/BuiltinTrackDrivers.java:17-40` | **EVENT 不建客户端驱动**（服务端驱动）；MOD_EVENT 用 `ModEventTrackPlayer` |
| MOD_EVENT 播放器 | `MOD:script/ModEventTrackPlayer.java:1-30` | **占位实现，恒不活跃**；格式与编译完整，第三方自行消费 |
| 轨道数提示 | `MOD:script/ScriptParser.java` 的 `validateTracks` | 多于 1 条 EVENT 只记日志建议 |

**关键事实**：EVENT 轨不是触发器。它没有条件、没有 `requires`、不写事实账本；它就是「到点执行一条服务端命令（和/或移动玩家）」。MOD_EVENT 在模组内**不产生任何效果**（占位播放器），只有第三方消费者会读。

### 3.2 B：触发器事实

见 `07-continuity-and-facts.md` §2.2。要点：

- 21 种 `FactType`，3 种持久化（`PLAYBACK_STARTED`/`PLAYBACK_FINISHED`/`TRIGGER_FIRED`）。
- 事件驱动触发器（16 种）读「最近一条」事实（`EventFactMatch`）；组合器内事件类子条件读「窗口内任意一条」（`FactWindow`）。
- 编辑器不能直接读服务端账本；同轮16通过ServerFactsApi受控桥查询，保留累计/窗口口径和未知状态，不把内存不可直接访问写成UI永远不可见。

### 3.3 C：规则命令动作

| 事实 | 锚点 | 说明 |
|---|---|---|
| 动作 | `MOD:script/rule/runtime/RuleActionRunner.java:105-108` | `emit_command` 走 `RuleActions.emitCommandForBinding` |
| 客户端只发引用 | `MOD:camera/rule/RuleActions.java:330-368` | 发 `(scriptId, instanceId, bindingId, actionIndex)`；命令原文不上行 |
| 预览不发送 | `RuleActions.java:352-360`（`canEmitCommand`） | 编辑器预览实例直接不发 |
| 服务端查表 | `MOD:trigger/server/RuleCommandTable.java:47-79`（`compile`） | 键 = `(bindingId, actionIndex)`；命令取 `binding.definition().actions()[actionIndex].command` |
| 授权 | `MOD:trigger/server/ScriptEventManager.java:541-582`（`handleRuleCommand`） | 只允许观看者；`PlaybackGrant` |
| 限频 | `MOD:trigger/server/RuleCommandRateLimiter.java:22-30` | 容量 20、每秒补 10 |
| 审计 | `MOD:trigger/server/RuleCommandAudit.java` | 限频记录 |

**关键事实**：`emit_command` 的命令原文**只在服务端**（`RuleCommandTable` 由脚本编译而来）。编辑器里能看到原文（因为它就在脚本 JSON 里），但**不能**在预览里执行。

## 4. 归属与禁止混用

| 需求 | 正确做法 | 错误做法 |
|---|---|---|
| 「到 5 秒执行 `/time set day`」 | 时间轴 EVENT 轨，`time=5`，`event_type=command`，`command="time set day"` | 用触发器（触发器没有「到点」类型；`delay` 是命中后延迟） |
| 「玩家捡到钻石时播放过场」 | 触发器 `item_pickup`（事件驱动） | 用 EVENT 轨（它不监听物品） |
| 「规则判定成功时执行命令」 | 规则动作 `emit_command` | 用触发器 `login` + 命令（无此能力） |
| 「进入区域后等 2 秒再播」 | 触发器 `location` + `delay=2` | 用 EVENT 轨（EVENT 没有空间条件） |
| 「让玩家走到某点」 | 时间轴 EVENT 轨 + `position`（x/z） | 触发器（没有移动能力） |
| 「第三方模组监听自定义事件」 | MOD_EVENT 轨（第三方消费） | 触发器自定义类型（那是条件，不是事件流） |

## 5. 数据形态对照

| 维度 | A 时间轴事件 | B 触发器事实 | C 规则命令 |
|---|---|---|---|
| 存哪 | 脚本 JSON | 服务端内存/存档 | 脚本 JSON（命令原文）+ 服务端编译表 |
| 何时产生 | 播放推进到该时间 | 游戏事件发生 | 规则动作执行 |
| 是否可编辑 | 是（片段效果控件记录组；主轴仅片段编排） | 否（运行时） | 是（规则面板） |
| 是否需要授权 | 服务端执行命令时按 viewer 分发 | 按玩家 | `PlaybackGrant` + 观看者 |
| 是否进图数据 | 否 | 否 | 否 |
| 编辑器可见性 | 完整 | 不可见 | 完整（原文） |

## 6. 拟新建（提案）

- EventRecordEditor复用06基础记录组件；11完成EVENT/MOD_EVENT专用字段/类型/command/Position/data表单，挂在clip.effects当前片段的适用记录组。05只提供主轴片段编排和宿主，不另建EventClipEditor/记录子轨/独占关键帧页。
- `ED:components/rules/actions/EmitCommandAction.vue`（提案，归 11/11）：已在 11 定义。
- `ED:components/trigger/FactSemanticsNote.vue`（提案，归 11/07）：已在 07 定义。

**不新建**：统一的「事件面板」。三者不在同一层，合并只会制造混乱。

## 7. 修改步骤

1. 在 `shared/contracts.md` 记录三种「事件」的命名约定（建议：**时间轴事件** / **触发器事实** / **规则命令**），全仓库文档与 UI 文案统一使用。
2. 在06记录组中完成11专用内容组件并接共享Selection/节点时间与原事务；文档级事实/规则工具仍独立，不把三种事件混为一个可编辑对象，也不反派给05或让主轴承载记录节点。
3. 11 轮实现 `emit_command`（11/11）与事实语义说明（07）。
4. 编辑器内凡是出现「事件」二字的位置，检查是否加了限定词（时间轴/事实/命令）。

## 8. 禁止修改

- 不得把 EVENT 轨记录当作触发器条件（它没有条件）。
- 不把事实当作可编辑事件记录；16只读查询可以展示真实返回事实，不能改写账本。
- 不得让 `emit_command` 在编辑器预览里发送。
- 不得给 MOD_EVENT 在模组内造效果（`ModEventTrackPlayer` 是占位，恒不活跃）。
- 不得把 `event_type` 在 EVENT 轨里放开（只接受 `command`，`ScriptEventManager.fireEvent` 会跳过其它值）。
- 不得把三种「事件」合并成一个面板或一个类型。

## 9. 验收

**正例**

- 时间轴 EVENT 轨：`time=5`、`event_type=command`、`command="time set day"` → 播放到 5 秒时服务端对所有 viewer 执行。
- 时间轴 EVENT 轨：`position={x:100,z:200}` → 玩家向该点移动（客户端 `PlayerMoveController`）。
- 触发器 `item_pickup`：捡钻石触发；面板不出现「事件记录」字样。
- 规则动作 `emit_command`：命令在游戏内执行，编辑器预览不发送。
- MOD_EVENT：第三方消费者能读到记录；模组内无效果（不崩、不警告刷屏）。

**反例**

- 用触发器实现「到点执行命令」→ 失败（没有该类型）。
- 用 EVENT 轨实现「捡物品触发」→ 失败。
- 编辑器预览里 `emit_command` 真的发了包 → 失败。
- UI 把三种「事件」混成一个列表 → 失败。

## 10. 真实冒烟

1. EVENT 轨 `time=3, command="say hello"`：播放到 3 秒，聊天栏出现 hello（所有 viewer）。
2. EVENT 轨 `time=4, position={x:…, z:…}`：玩家在 4 秒开始向目标移动。
3. 触发器 `item_pickup`（钻石）：捡起触发脚本播放。
4. 规则 `emit_command`：规则命中后命令执行；编辑器预览时命令不执行且日志有「预览不发送」。
5. MOD_EVENT：写一条记录，第三方监听器收到；无第三方时无副作用。

## 11. 完成定义

- 三种「事件」在文档与 UI 上命名可区分，不再混用。
- A/B/C 各自的字段、消费者、可见性、授权边界与本文件一致。
- 编辑器不提供跨类的「统一事件面板」。
- MOD_EVENT 的占位事实在文档中写明（格式完整、模组内不生效）。

## 输入输出与交付合同

输入标准event/mod_event记录、01字段能力、06对象操作和当前文档选择；输出经02事务提交的合法事件字段/记录与真实执行边界说明。事实读取由16只读桥，规则命令由11动作面板；三者不混同。验收分别观察标准产物、游戏命令/移动和预览不得发送服务端命令，MOD_EVENT无第三方时明确无内建效果而不假成功。
