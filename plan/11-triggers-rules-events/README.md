# 11 触发器、规则与事件

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 范围：编辑器内「触发器」面板与新增「规则」面板的全部字段与交互；连续条件与事实语义的呈现；规则绑定的动作/释放/暂停；循环、退出、分支与三种「事件」的 UI 归属划分。不含时间轴片段编辑（05）、不含图数据（04）、不含模板（12）。
> 关联：`../04-project-graph/README.md`、`../01-baseline-schema/README.md`、`../05-timeline-workspace/README.md`、`docs/TRIGGER_TYPES.md`、`docs/SCRIPT_FORMAT.md` §2.4 / §5.2 / §5.3

**路径记号**：`MOD:` = `ImmersiveCinematics/common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`ED:` = `ImmersiveCinematicsEditor/src/`。与 `shared/baseline-and-evidence.md` 的记号对应关系：`MOD:` ≡ `J:`，`ED:` ≡ `EDITOR:src/`。

## 一、摘要

本轮把「触发器」从一张只有 6 个通用字段 + 10 个类型编辑器的表单，补成完整可用的触发器编辑器（27 种类型、通用字段全量、requires 正确引用脚本 id、组合器可嵌套、连续语义可见），并新增「规则」面板承载脚本级 `rules[]` + `rule_bindings[]`（条件树、动作、策略、时间门、调度、出口覆盖、暂停/恢复）。同时把「循环 / 退出 / 分支」和三种「事件」的归属钉死，避免同一个字段出现在两个面板里。

现状：编辑器对 `continuity`、`poll_interval`、`rules`、`rule_bindings`、`goto_clip`、`emit_command` 的支持为 **0**（全仓库 grep 无命中），且 `requires` 的脚本下拉写出的值不是脚本 id（见 `05-trigger-requires-editor.md` §2）。

## 二、为什么做

### 2.1 问题

- 触发器面板缺字段：`poll_interval`、`continuity` 在 Java schema 与运行时都支持，编辑器里根本没有输入口（`ED:components/TriggerPanel.vue:49-57` 的 `commonFields` 只有 6 项）。
- `requires` 的下拉把**文件名**当脚本 id 写（`TriggerPanel.vue:472-475` 用 `s.replace('.json','')`），只要 `meta.id ≠ 文件名` 就会写出悬空引用；作者看不到任何提示。
- `requires` 的类型下拉只有 3 个内置类型（`TriggerPanel.vue:459-464`），自定义前置条件（其它模组注册，`MOD:trigger/server/prereq/PrerequisiteRegistry.java:26-44`）无法编辑。
- 27 种触发器类型里有 9 种没有专用编辑器（`death`、`facing`、`gamestage`、`all_of`、`any` 以及 6 个 `item_*` 走通用回退或空表单），组合器完全没有 UI。
- 规则系统（`rules[]` / `rule_bindings[]`）在运行时完整可用（`MOD:script/rule/RuleCollectionParser.java`、`MOD:script/rule/runtime/RuleRuntime.java`），编辑器里**一个字段都编辑不了**，作者只能手写 JSON。
- 规则的 `pause`/`resume`/`hold`/`schedule`/`timeout` 是「会卡住播放」的语义，手写极易写出永久挂起（`MOD:script/rule/runtime/RuleRuntime.java:627-669` 有专门的「pause 无释放者」自动兜底），UI 必须能提前发现。
- 「事件」在项目里有三种完全不同的东西（EVENT 轨道记录、触发器事实、规则动作 `emit_command`），当前文档与 UI 混用同一个词。

### 2.2 目标

- 触发器面板能编辑 `meta.triggers[]` 的全部字段，且每个字段的取值域与 Java 解析/校验一致（不是「大致一致」）。
- 27 种类型各有与其 `conditions` schema 匹配的编辑体验；组合器支持嵌套并显示层数。
- `requires` 的脚本下拉列出**脚本 id**（来自索引），并区分「内置脚本型」与「自定义类型」。
- 新增规则面板：`rules[]`（条件树 / 动作 / 策略）与 `rule_bindings[]`（宿主片段 / 时间门 / control / schedule / exit）。
- 动作里 `pause` / `resume` / `goto_clip` / `emit_command` 有明确的语义提示与可达性诊断。
- 循环、退出、分支、事件四类概念各自只有一个 UI 归属，并在文档里写死。
- EVENT/MOD_EVENT 片段在主时间轴只是**一个片段**：不展开记录行、不画节点、不显示关键帧汇总。记录本身在 `clip.effects` 的记录组（06-EventRecordEditor 的承载）与 11 的专用内容编辑器里编辑；片段选择来自主时间轴或效果控件，属性/记录/节点选择来自效果控件行。

### 2.3 非目标

- 不做运行时触发器状态可视化（服务端 `FactLedger` 不在编辑器进程；编辑器只能编辑与静态校验）。
- 不做触发器调试器（单步、断点）。
- 不新增触发器类型、不新增前置条件类型、不新增动作类型。
- 不改运行时语义（本轮只写文档，不改主模组代码）。
- 不在时间轴上编辑片段 `exit`（属 05/13）；规则面板只编辑 `rule_bindings[].exit`。

## 三、方案

**触发器面板**（文档级面板，注册在 05 布局树；与 `clip.effects` 并列）：左侧触发器列表（显示 `identity` 与类型），右侧分四段——基本（`id`/`type`/`repeatable`/`delay`/`on_enter`/`exit_buffer`/`poll_interval`）、条件（按类型切换编辑器）、连续（`continuity.sweep/dwell/window` + 生效范围提示）、前置（`requires` 列表）。每个字段旁标注「仅对哪类生效」，无效组合直接给黄条而不是静默保存。

**条件编辑器**：单值类型给一个带注册表补全的输入框；几何类型（location / structure / observation / facing）给坐标/区间编辑器；`inventory` 给列表编辑器；组合器给可递归的子条件列表，显示当前层数 `n/8`，超限禁止添加。

**规则面板**（文档级面板，注册在 05 布局树；不是片段效果控件组）：上半是规则定义列表（`rules[]`），下半是绑定列表（`rule_bindings[]`）。规则定义里条件树用与触发器组合器同一套递归编辑器（但可选类型集合不同：`time`/`location`/`facing`/`biome`/`dimension`/`camera_pos`/`camera_facing`/`camera_fov`/`clip_fact`/`rule_fact`/`all_of`/`any`），动作列表用下拉 + 参数表单，策略（`once`/`cooldown`/`mode`/`dwell`/`timeout`/`on_timeout`）用分组表单。绑定里选规则、选宿主片段、填 `gate.at`、选 `control`、配 `schedule`（五形态）、配 `exit`。

**暂停语义的可视化**：当某条绑定的 `control=hold`，或动作里出现 `pause`，面板显示一条「挂起链」提示：谁会释放它（成功 / 超时 / 某片段的 `clip_start` / `delay` / 另一绑定的 `fact`）。没有释放者时给红条并引用运行时的兜底行为（`RuleRuntime.releasePauseWithoutReleaser`）。

归属：meta宏观循环归01，片段循环/窗口容器归05，分支/出口/行为语义与EVENT/MOD_EVENT专用内容归11；基础记录时间/对象编辑复用06。EVENT/MOD_EVENT 在主时间轴只是可排列、可选择的片段；记录、记录内字段与记录时间在 `clip.effects` 的记录组中展开（行/节点契约由 06-EventRecordEditor 与 EffectControlsRows 定义），11 负责专用内容、执行语义与验证，不把记录摊成主时间轴的属性行。事实查询由16提供受控只读面板，不把当前缺协议误写成永久不做。

## 四、技术细节

### 4.1 核心模型

| 模型 | 承载 | 职责 |
|---|---|---|
| 触发器定义 | `MOD:script/TriggerDefinition.java` | 类型 + 条件 + repeatable/delay/onEnter/exitBuffer/requires/pollInterval/continuity；身份 = `id ?? type#index`（`:87`） |
| 前置条件 | `MOD:script/TriggerRequirement.java` | `type` + `data`；字符串简写 = `script_played` |
| 注册项 | `MOD:trigger/server/TriggerRegistration.java` | 引擎调度单位；含生效轮询间隔与 `exitConditions` |
| 类型表 | `MOD:trigger/server/TriggerRegistry.java`、`MOD:spi/TriggerType.java` | 类型 id、监听策略、类型级轮询默认、求值器 |
| 条件 schema | `MOD:script/schema/TriggerSchemas.java` | 27 类 `conditions` 字段表，导出给编辑器 |
| 事实层 | `MOD:trigger/server/fact/*` | 21 种 `FactType`，玩家维度账本 |
| 规则集合 | `MOD:script/rule/RuleCollection.java` | 定义表 + 绑定表 + 两条索引 |
| 规则运行态 | `MOD:script/rule/runtime/RuleRuntime.java` | 每播放实例一份，帧驱动 |
| 挂起账本 | `MOD:script/rule/runtime/SuspensionLedger.java` | 多来源（`rule:<bindingId>` / `action:pause`） |
| 动作执行 | `MOD:script/rule/runtime/RuleActionRunner.java`、`MOD:camera/rule/RuleActions.java` | 9 种动作分派 |

### 4.2 契约

- **编辑器只写 JSON**，不参与求值。字段合法性以 `ScriptValidator` 为权威（`MOD:script/ScriptValidator.java:2081-2155` 的触发器分支、`:496-655` 的规则分支）。
- **schema 是单源**：`SchemaExporter.exportAll()` 导出 `triggers.types` / `triggers.conditions` / `triggers.triggerFields` / `script_structure.rules` / `script_structure.rule_bindings` / `action_types` / `exit_kinds` / `schedule_kinds` / `condition_fact_types`（`MOD:script/schema/SchemaExporter.java:56-91`、`:168-244`）。编辑器不得在 TS 里复制一份字段表（现有 `TriggerPanel.vue:49-57` 的 `commonFields` 就是反例）。
- **身份不可重算**：触发器 `identity` 由 Java 侧 `TriggerDefinition.getIdentity()` 定义；编辑器新增触发器必须写显式 `id`（缺省合成 `type#index` 会随数组重排改变，导致事实失效）。
- **requires 引用脚本 id**，不是路径、不是文件名（`MOD:script/ScriptManager.java:121-131`）。
- **规则与触发器不共享条件词汇**：触发器 `conditions` 用 27 类 + 组合器；规则 `condition` 用 8 个 V1 类型 + 2 个事实类型 + 组合器（`MOD:client/rule/ClientConditions.java:36-46`）。UI 必须用两套类型列表。

### 4.3 数据形态

- `meta.triggers[]`：`{id?, type, conditions?, repeatable?, delay?, on_enter?, exit_buffer?, poll_interval?, continuity?, requires?}`。
- `meta.trigger_poll_interval`：脚本级轮询缺省（`MOD:script/schema/MetaSchemas.java` 未登记该字段——见 `02-trigger-common-fields.md` §3）。
- `rules[]`：`{id, condition, actions[], policy{once,cooldown,mode,dwell,timeout,on_timeout}}`。
- `rule_bindings[]`：`{id, rule, clip, gate{at}, control?, schedule?, exit?}`。
- `schedule` 五形态：`clip_start` / `clip_complete` / `local_time` / `delay` / `fact`（`MOD:script/rule/RuleReleaseKind.java`、`MOD:script/rule/RuleSchedule.java:15-30`）。

### 4.4 边界

- **宿主归 05**：05-07 InspectorHost 承载可停靠面板与选区驱动、`pin`；本轮提供「触发器」「规则」两个**文档级**面板的内容组件（不是 `clip.effects` 的片段组），不自建容器、不改 `App.vue` 的 `rightTabs` 结构（由 05 的宿主契约决定注册方式）。
- 触发器面板不编辑片段、不编辑轨道、不编辑规则。
- 规则面板不编辑触发器、不编辑片段内容（只选片段 id）；它是文档级面板，不进入 `clip.effects` 的片段组。
- 片段 `exit` 与 `loop` 归 05；规则 `rule_bindings[].exit` 归本轮。
- EVENT/MOD_EVENT 在 05 时间轴只排列/选择片段；06 提供对象/记录基础操作与 `clip.effects` 记录组承载，11 本轮完成专用内容、执行语义与验证，避免把任务推回前轮。
- 主时间轴不出现记录行、记录字段、节点或关键帧汇总；选择记录/字段/时间走 `clip.effects` 行与共享 Selection。
- 运行时事实通过16的受控公共桥查询；没有回执显示未知，不读取服务端内部对象或伪造进度。
- 校验问题的**列表壳**归 05-08 的 `DiagnosticsPanel.vue`；本轮只提供 issue 路径解析、分组与字段级徽标。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 保留一份手写字段表 | 像 `TriggerPanel.vue:49-57` 那样硬编码 | 与 Java 漂移（现在已经漂移：缺 `poll_interval`/`continuity`） | schema 必须单源 |
| 通用 JSON 编辑器 | 直接编辑 `meta.triggers` 原文 | 零维护 | 作者要记 27 种字段名；错误只能靠校验兜底 |
| 每个类型一个面板 | 27 个独立组件 | 组件爆炸、重复 | 按「字段形态」分编辑器族（单值/几何/列表/组合器） |
| 规则也用触发器条件词汇 | 复用 27 类 | 少一套类型表 | 运行时根本不支持（`ClientConditions.V1_TYPES` 只有 8 项） |
| 在图上编辑依赖 | 见 04/07 | 语义无法表达 | 已否决 |
| 触发器 id 缺省不写 | 让 Java 合成 | 少一个字段 | 数组重排即改身份，事实静默失效 |
| 把 `pause` 做成「暂停整个脚本」 | 语义简化 | 简单 | 运行时是实例级挂起账本，不是全局暂停；简化会误导 |

**本方案的缺点**：

- 27 种类型的「生效范围」提示（sweep 只对 3 类、dwell 只对轮询类、window 只对组合器）必须在 UI 上重复一遍，且要跟校验器文案保持一致，维护成本落在文案同步上。
- 规则面板字段多（定义 + 绑定 + 调度 + 出口），一次看不完，需要折叠与分组。
- 编辑器无法验证「运行时事实」，因此 `requires` 的悬空只能在静态层面提示；作者仍需在游戏里 `/icinematics validate` 复核。
- 不新增动作类型意味着 `hold` 只能用 `until` 无 timeout 表达（`MOD:camera/rule/RuleActions.java:56-58` 的销项说明），UI 只能给提示。

## 六、实现结果

状态：未实现（仅计划）。

现有实现（**起点，不是本轮成果**）：

| 已有 | 锚点 | 缺口 |
|---|---|---|
| 触发器列表 + 增删 + 6 个通用字段 | `ED:components/TriggerPanel.vue:60-160`、`:222-300` | 缺 `poll_interval`、`continuity`；id 生成会撞 |
| 10 个类型专用编辑器 | `ED:components/trigger/*.vue`（`NoCondition`/`SingleField`/`Location`/`EntityKill`/`ItemOnInteract`/`Observation`/`Inventory`/`Structure`/`Xp`/`DimensionChange`） | 其余 17 类走 `DynamicForm` 或空 |
| 条件 schema 消费 | `TriggerPanel.vue:36-47`（`conditionFields`） | 只用于回退路径 |
| requires 编辑 | `TriggerPanel.vue:116-175`、`:455-478` | 值来自文件名；只有 3 个内置类型；字符串项被强转对象 |
| 触发器 schema 导出 | `MOD:script/schema/SchemaExporter.java:56-91` | `triggerFields` 只有 `id` + `continuity`，无 `poll_interval` |
| 规则运行时 | `MOD:script/rule/**`、`MOD:camera/rule/RuleActions.java` | 编辑器 **0 支持**（grep `rules`/`rule_bindings`/`goto_clip`/`emit_command` 在 `ED:` 无命中） |
| 规则校验 | `MOD:script/ScriptValidator.java:496-655` | 仅服务端 `script.validate` 可用 |

| 本轮目标 | 现状 | 差异 |
|---|---|---|
| 27 类全部可编辑 | 10 类有专用，17 类回退 | 需补 9 类 + 组合器递归 |
| 通用字段全量 | 6/9 | 补 `poll_interval`、`continuity`；`id` 强制显式 |
| requires 引用脚本 id | 写文件名 | 改数据源 + 类型列表可扩展 |
| 规则面板 | 无 | 全新 |
| 暂停/释放诊断 | 无 | 新增静态可达性检查 |
| 概念归属 | 混用 | 文档 + UI 位置写死 |
| 事件记录承载 | 无 | `clip.effects` 记录组（06-EventRecordEditor + 11 专用内容）；主时间轴只显示片段 |

## 七、依赖前轮

- **01-baseline-schema**：`triggers.triggerFields` / `script_structure.rules` / `rule_bindings` / `action_types` / `exit_kinds` / `schedule_kinds` 的导出是否齐全；`meta.trigger_poll_interval` 是否进 schema。
- **02-model-contracts**：片段 id 命名空间（规则绑定与 `goto_clip` 都要选片段）；共享 Selection 身份（`clipKey + objectPath`）。
- 05提供时间轴/属性宿主与片段播放控制；06提供 `clip.effects` 记录组与行/节点/局部标尺；01提供meta宏观循环，11本轮完成行为/事件专用内容与事实查询，不向前轮反派新增任务。
- 共享协议沿用当前信封，事实查询新增的受控只读能力由16明确登记和落实，不宣称本轮完全不需要任何新能力。

## 八、本轮包含工作

| # | 文件 | 交付物 |
|---|---|---|
| 1 | `01-trigger-identity.md` | 触发器身份模型与 UI 展示口径 |
| 2 | `02-trigger-common-fields.md` | 通用字段（含 `poll_interval`、`continuity` 入口） |
| 3 | `03-trigger-type-catalog.md` | 27 类清单、监听策略、默认轮询、编辑器映射 |
| 4 | `04-trigger-condition-editors.md` | 条件编辑器族与缺口补齐 |
| 5 | `05-trigger-requires-editor.md` | requires 编辑器（脚本 id、自定义类型、字符串/对象） |
| 6 | `06-combinators.md` | `all_of` / `any` 递归编辑与层数上限 |
| 7 | `07-continuity-and-facts.md` | 连续语义与事实层的呈现边界 |
| 8 | `08-trigger-validation-diagnostics.md` | 触发器校验与诊断 |
| 9 | `09-rules-definition-editor.md` | `rules[]` 与 `policy` |
| 10 | `10-rule-bindings-editor.md` | `rule_bindings[]`（gate/control/schedule/exit） |
| 11 | `11-rule-actions-and-release.md` | 9 种动作、释放条件、暂停/挂起 |
| 12 | `12-rules-condition-tree.md` | 规则条件树（8+2+组合器） |
| 13 | `13-loop-exit-branch-attribution.md` | 循环/退出/分支归属 |
| 14 | `14-event-attribution.md` | 三种「事件」的归属 |
| 15 | `15-verification-and-probes.md` | 人工可验证性与真实使用场景 |
| 16 | [16-fact-query-panel.md](16-fact-query-panel.md) | 事实查询UI/受控只读桥、口径/权限/未知状态 |

## 九、轮次出口（无遗留）

1. `meta.triggers[]` 的全部字段都能在 UI 上编辑，且默认值/取值域与 `TriggerSchemas` + `ScriptValidator` 一致；UI 里不存在第二份硬编码字段表。
2. 27 种类型都能编辑其 `conditions`；组合器可嵌套且层数受 8 层限制；事件类子条件在 `window=0` 时被阻止。
3. `requires` 只能写出脚本 id；自定义前置类型可编辑；字符串简写与对象形态可互转且语义不丢。
4. `continuity` 三个字段可见，且对不适用的类型给出明确提示（不静默保存）。
5. `rules[]` / `rule_bindings[]` 全部字段可编辑；`schedule` 五形态可选；`exit` 覆盖可选。
6. `pause`/`hold` 的释放链在 UI 上可见；无释放者时给红条并说明运行时兜底。
7. 16事实查询在人工真实游戏事件前后可用，口径/权限/时刻准确，不以语义说明替代功能；当前轮只验WebUI。
8. 循环/退出/分支/事件各有唯一UI归属，图内关系维护与完整条件编辑共用合同。
9. EVENT/MOD_EVENT 在主时间轴只显示为片段；记录、字段与记录时间在 `clip.effects` 记录组中展开，选中行不隐藏同片段其他组；不存在主时间轴记录行或关键帧汇总。
10. 问题可定位，人工实际使用检查正常/错误/撤销/保存重载和游戏表现；未操作不得填通过。

不做事实写入/清理、全时运行监视、单步断点或新触发/动作类型；16受控只读事实查询是本轮必做，不在非目标内。
