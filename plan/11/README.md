# 11 触发、规则、事实与事件

## 目标

11 把模组当前的触发器、规则、事实引用与 `EVENT` / `MOD_EVENT` 轨道完整接进新编辑器，出口是“行为面板完整”。

编辑器只写当前脚本格式、只从现有字段读取，不新增脚本字段、不新增消息类型、不改模组 `.java`、不建立规则执行器或第二套运行时。触发判定、规则求值、动作执行、事件消费全部在游戏侧完成；编辑器负责声明、编辑、校验、定位和摘要。

11 的交付物是：

- 一块脚本级 `behavior` 抽屉：根是当前脚本，触发器、规则、绑定、事件都在脚本结构下；
- `meta.triggers` 的声明、身份、条件树、前置、时序与连续性；
- `rules` / `rule_bindings` 的定义、条件树、九种动作、时间门、控制、调度、出口覆盖；
- 事实引用检查器：只读展示脚本事实、片段事实、规则事实与依赖关系；
- `EVENT` / `MOD_EVENT` 的离散事件记录、时间轴标记、事件列表与播放语义；
- 脚本图节点悬停摘要：显示脚本的全部触发器与全部条件，包括跨脚本前置；
- 17 份文档与可复现验收矩阵。

## 设计基线

本轮只以下面两类事实为依据：

1. 模组当前代码：`meta.triggers` 的字段与校验、`TriggerEngine` / `TriggerRegistration` / `ScriptEventManager`、`FactQueries` / `FactLedger`、`BuiltinPrerequisites`、`Evaluators`、`StartPlaybackAction`、`TriggerSchemas`、`ScriptValidator` / `ScriptParser`、`rules` / `rule_bindings` 的解析与运行时、`RuleActions`、`RuleDefinition` / `RuleBinding` / `RuleRelease`、`EventClipRuntime` / `EventRecord` / `EventKey` / `EventSeekPlan`、`ModEventTrackPlayer`、`ObjectCodec` / `ObjectValidator`、`TrackSchemas` 的 `EVENT` / `MOD_EVENT` 对象面。
2. `plans/0.3.6` 现行合同：`I-script-core/track-event.md`、`rule-system.md`、`rule-collection.md`、`rule-time-gate.md`、`rule-suspension.md`、`rule-facts-scheduling.md`、`rule-exits.md`、`rule-command-trust.md`、`C-trigger/trigger-conditions.md`、`H-other/trigger-continuity.md`；`docs/SCRIPT_FORMAT.md` 的触发器、规则、事件与出口章节。

旧编辑器只作为“旧版曾经怎么写”的线索，不进入 11 的字段面、组件结构、页面入口和验收口径。

## 三条链不能合并

| 面 | 归属 | 决定什么 | 11 呈现 |
|---|---|---|---|
| `meta.triggers` | 服务端播放门控 | 整个脚本播不播 | 行为页“触发器” |
| `rules` / `rule_bindings` | 播放实例内的规则系统 | 播到某段时做什么 | 行为页“规则”与每条规则下的“绑定” |
| `EVENT` / `MOD_EVENT` | 片段内的离散事件记录 | 片段时间点上发什么事件 | 行为页“事件”与主时间轴标记 |

三套东西共用几何/事实底层，但字段、生命周期、动作与消费方不同，不能合并成一套表单或一个动作选择器。

## 行为页结构

`behavior` 抽屉是脚本级面板，根节点是当前脚本：

```text
行为 · 当前脚本
├ 触发器 N
├ 规则 N
│  ├ 规则定义
│  └ 该规则下的绑定（0..N）
└ 事件 N
   ├ EVENT · 片段
   └ MOD_EVENT · 片段
```

- 触发器按声明顺序排列，不按片段或中文分类重排；
- 规则与绑定是父子关系：一个规则可以有多条绑定，绑定挂在对应规则下；
- 事件按“类型 → 片段”分组，仍然属于当前脚本；
- 右侧详情按“身份/类型 → 条件树 → 前置 → 时序 → 诊断”排列；
- “事实/依赖”是详情里的只读页签，不是与触发器并列的第三类可编辑对象；
- 顶部提供新增触发器、规则、绑定、事件；新增事件需要当前片段；
- 同一份记录只有一个详情编辑器：行为页是主入口，时间轴只做标记，效果面板只做摘要与跳转。

`behavior` 抽屉复用 04 的预留页签，不新开第二套抽屉、不做第二时间轴、不写 `state.selection` 之外的新选择状态。

## 触发器口径

- 触发器是一个脚本的触发器，不属于片段，也不存在跨脚本触发器总表。
- 身份优先用显式 `id`；缺省时是 `type#声明下标`。显式 id 需匹配 `[A-Za-z0-9_]{1,64}` 且脚本内唯一。
- 当前脚本面里，触发器没有动作数组，也没有 `target` 字段；触发后的实际行为固定为“把本脚本播放给触发者本人”。编辑器只显示只读“触发后”卡，不提供动作/目标选择器。
- `requires` 是 AND 列表；字符串写法等价 `script_played`。内置前置为 `script_played` / `script_started` / `script_completed`。
- 条件树是 27 种类型的递归结构；`all_of` / `any` 不是普通字段表。
- 时序包括 `delay`、`repeatable`、`on_enter`、`exit_buffer`、`poll_interval`、`continuity`；各字段按代码可适用性显示。
- 脚本级 `trigger_poll_interval` 在 Script Properties 的“触发器缺省”卡里编辑；行为页只显示继承结果，不重复写一份。

## 规则口径

- `rules[]` 是定义表：`id` 必填唯一，`condition` 必填，`actions` 必填非空，`policy` 可省。
- 规则条件树支持 8 种状态叶子、2 种事实叶子、2 种组合器，最大嵌套 8 层。
- 规则动作固定为九种：`camera_set`、`overlay_set`、`adjust_set`、`goto_clip`、`pause`、`resume`、`exit`、`play_sound`、`emit_command`。
- `hold` 不是动作，是绑定的控制方式；无限等待由 `timeout=-1` 表达。
- `rule_bindings[]` 把定义绑到目标片段：`id` / `rule` / `clip` / `gate.at` 必填；`control`、`schedule`、`exit` 可省。
- `gate.at` 是目标片段执行内部的局部秒，不是全局时间。
- 五种出口覆盖：`continue` / `goto` / `return` / `end_execution` / `end_script`；只有 `goto` 允许 `target` 和 `entry_time`。
- 三个跳转/退出要分开：动作 `goto_clip` 是开分支；绑定 `exit.goto` 是分支完成后的去向；动作 `exit` 是结束当前播放实例。

## 事实口径

事实不是新字段，不在编辑器里造事实。

- 触发器前置：`script_played` / `script_started` / `script_completed`，由服务端播放事实账本判定。
- 非重复触发器隐含 `TRIGGER_FIRED`：同一玩家 + 脚本 + 触发器只触发一次。
- 规则条件：`clip_fact.started` / `clip_fact.completed`、`rule_fact.succeeded` / `rule_fact.action_completed`。
- 调度事实：`schedule.fact` 的来源绑定与 `succeeded` / `action_completed`。
- 事实页只做引用检查：生产者、消费者、悬空、自引用、循环、不可达持有；不显示某玩家当前运行态。

## 事件口径

- `EVENT` / `MOD_EVENT` 不是采样曲线，是离散记录。
- `EVENT` 对象路径是 `event`；记录字段为 `command`、`event_type`、`position`、`id`。`event_type` 只接受 `command`；空 `command` 是占位；`position` 只能绝对 `{x,z}` 或相对 `{dx,dz}`。
- `MOD_EVENT` 对象路径是 `mod_event`；记录字段为 `event_type`、`data`；没有 `id`、`command`、`position`。`event_type` 最终必须有值；`data` 顶层必须是 JSON 对象，内部可任意嵌套，由消费方定义。
- 事件身份是 `(播放实例, 片段, 对象路径, 事件下标)`；服务端/客户端各自去重。
- 片段循环、宏观循环、多入口不重放服务端 `EVENT`；`pingpong` 用在 `EVENT` / `MOD_EVENT` 上被校验器拒绝；显式 seek 前跳不补触发，后跳回退可重新触发目标之后的事件。
- `MOD_EVENT` 是扩展事件通道：编辑器完整写记录和格式；内置画面流程不替消费方生成效果。

## 脚本图悬停

05 的脚本图节点悬停摘要要显示该脚本的全部触发器与全部条件，包括每个触发器的跨脚本前置。

- 不新开图页，不改 05 的节点、边、布局与图数据契约；
- 悬停时按需读取当前脚本的只读内容，缓存触发器摘要，不进入文档页、不建脏文档；
- 每个触发器展示类型、身份、可重复、条件树、前置、必要时间字段；
- `all_of` 显示“全部满足”，`any` 显示“任一满足”，叶子条件翻译成可读中文；
- 前置显示 `type → 目标脚本`，并标“已解析 / 缺失 / 自引用 / 自定义前置只读”；
- 内容多时卡片内部滚动，不截断触发器、不截断条件；
- 悬停只读，提供“定位到触发器”和“打开脚本”。

## 与相邻轮次的边界

| 相邻项 | 归属 | 11 的处理 |
|---|---|---|
| `behavior` 抽屉页签、布局、命令、焦点 | 04 | 11 只注册内容，不改抽屉容器 |
| 脚本图节点、边、布局、打开流程 | 05 | 11 补悬停摘要，不另造图页 |
| Script Properties 的 `trigger_poll_interval` | 06 | 11 增“触发器缺省”卡，不新增字段 |
| `EVENT` / `MOD_EVENT` 对象与关键帧结构 | 02 / 06 | 11 补离散记录编辑与时间轴标记，不按采样曲线渲染 |
| `OVERLAY` / `LETTERBOX` / `AUDIO` / `ADJUST` 字段 | 09 / 10 | 11 不把这些字段塞进行为页 |
| `play_sound` / `adjust_set` / `overlay_set` / `camera_set` | 11 规则动作 | 只作为规则动作；不写回片段字段。**只引用字段名，不依赖 09/10 的实现** |
| 片段间转场 | 08 | 11 不做转场，不把事件当转场 |

## 并行批次

**批次 2，可与 07/08/09/10 同时开工，无前置。** 前置只有已完成的 02（字段目录）、03（文档模型）、04（抽屉容器）、05（图悬停）、06（`EVENT` 行模型）。

11 与其余轮次**零实现依赖**：

- 不 import 07/08/09/10 的任何模块。
- 规则动作 `overlay_set` / `adjust_set` / `play_sound` 只写**字段名**，不需要 09/10 的编辑器代码存在——它们写的是脚本 JSON，不是调用对方的模块。
- `EVENT` / `MOD_EVENT` 的字段结构来自 02，行模型来自 06（已完成）。

### 11 内部可并行的子切片

- 子切片 A：`11-01` 行为抽屉与结构树（**先做**，其余挂在它下面）
- 子切片 B：触发器链 `11-02` → `11-03` → `11-04` → `11-05`（声明 → 时序 → 条件树 → 前置）
- 子切片 C：规则链 `11-06` → `11-07` → `11-08` → `11-09` → `11-10`（定义 → 条件树 → 动作 → 绑定 → 执行）
- 子切片 D：`11-11` 事实引用检查器（只读，可独立做）
- 子切片 E：事件链 `11-12` ~ `11-14`（记录 → MOD_EVENT → 时间轴语义）
- 收口：`11-15` 校验诊断 + `11-16` 闭环验收

B/C/D/E 四条之间互不引用，只共享 A 的结构树外壳与 06 的行模型。B 与 C 的条件树语法不同（触发器 27 种 vs 规则 12 种），**不要合并成一份组件**。

## 文档清单

| 文件 | 内容 |
|---|---|
| `README.md` | 总览、三条链边界、行为页结构、事实与事件口径 |
| `11-01-behavior-panel-shell.md` | 行为抽屉、脚本结构树、详情/依赖页签、草稿与撤销 |
| `11-02-trigger-declarations.md` | 触发器列表、身份、固定播放动作、脚本图悬停摘要 |
| `11-03-trigger-timing-and-continuity.md` | delay/repeatable/on_enter/exit_buffer/poll/continuity |
| `11-04-trigger-condition-tree.md` | 27 种触发器条件、区域/物品/朝向/注视、递归组合 |
| `11-05-trigger-prerequisites.md` | requires、三种内置前置、跨脚本引用、缺失与自引用 |
| `11-06-rule-definitions.md` | rules 字段面、policy、条件/动作容器 |
| `11-07-rule-condition-tree.md` | 12 种规则条件、事实引用、8 层嵌套 |
| `11-08-rule-actions.md` | 九种动作、字段约束、与触发器动作分离 |
| `11-09-rule-bindings.md` | gate/control/schedule、绑定字段面 |
| `11-10-execution-and-exit.md` | 执行、超时、持有、三种跳转/退出、五种出口覆盖 |
| `11-11-fact-inspector.md` | 事实引用检查器、依赖页签、非运行态 |
| `11-12-event-records.md` | EVENT 记录、命令占位、位置、原子对象 |
| `11-13-mod-event-records.md` | MOD_EVENT 记录、data 树、扩展通道 |
| `11-14-event-timeline-and-seek.md` | 事件标记、列表、seek/循环/pingpong 语义 |
| `11-15-validation-and-diagnostics.md` | 校验映射、未知字段、面板错误隔离 |
| `11-16-acceptance.md` | 验收矩阵与脚本夹具 |

## 实施顺序

1. 先落 `11-01` 行为抽屉与脚本结构树；触发器、规则、事件都挂在当前脚本下。
2. 落 `11-02` 触发器声明、身份与固定播放动作，再接脚本图悬停摘要。
3. 落 `11-03` 时序与连续性，确保 `on_enter` / `exit_buffer` / `continuity` 只在可适用类型出现。
4. 落 `11-04` 27 种条件树，再落 `11-05` 前置与跨脚本引用。
5. 落 `11-06` 规则定义，再落 `11-07` 规则条件树与 `11-08` 九种动作。
6. 落 `11-09` 绑定，再落 `11-10` 执行/超时/持有/出口。
7. 落 `11-11` 事实引用检查器。
8. 落 `11-12` 至 `11-14` 的事件记录、MOD_EVENT 与时间轴语义。
9. 落 `11-15` 校验与诊断，最后用 `11-16` 跑闭环验收。

## 完成定义

- 行为页能完整编辑 `meta.triggers`、`rules`、`rule_bindings`、`EVENT`、`MOD_EVENT`，没有第二个入口、第二套选择状态或第二时间轴。
- 触发器的 27 种条件、三种内置前置、全部时序字段都有落点；固定播放动作不被伪装成可配置动作。
- 规则九种动作、12 种条件、五种调度、两种控制、五种出口覆盖都有字段面和校验。
- 事实页只做引用检查，不伪造运行态。
- 事件记录按离散对象编辑，不做曲线；事件标记与列表同步。
- 脚本图悬停能显示全部触发器与全部条件，包括跨脚本前置。
- 没有新增脚本字段、没有新增消息类型、没有改模组 `.java`。
