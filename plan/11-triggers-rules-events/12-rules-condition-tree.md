# 12 规则条件树编辑

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`09-rules-definition-editor.md`、`11-rule-actions-and-release.md`、`06-combinators.md`

## 1. 职责

编辑 `rules[].condition`：8 个 V1 判定源（`time`/`location`/`facing`/`biome`/`dimension`/`camera_pos`/`camera_facing`/`camera_fov`）+ 2 个事实叶子（`clip_fact`/`rule_fact`）+ 组合器（`all_of`/`any`）。与触发器的 27 类**不是**同一套词汇，必须用独立类型列表。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| V1 类型白名单 | `MOD:client/rule/ClientConditions.java:36-39`（`V1_TYPES`） | 8 项，顺序即 UI 顺序 |
| 事实类型 | `ClientConditions.java:41-46`（`FACT_TYPES`） | `clip_fact` / `rule_fact` |
| 求值分发 | `ClientConditions.java:69-82` | 按 `type` 分支；未知 → false |
| 组合器 | `ClientConditions.java:87-131` | 与触发器同构（`list`、深度上限 8、`conditions` 子对象） |
| `time` 语义 | `ClientConditions.java:172-184`（`evalTime`） | `at` = 本地时钟 ≥；`from`/`to` = 闭区间（可单边）；**挂起期间本地时钟冻结** |
| `location` 语义 | `ClientConditions.java:186-200` | `dimension` 全等 → 方体 → 球；与触发器同口径 |
| `time` 校验 | `ScriptValidator.java:1442-1453`（`checkRuleTime`） | `at` 与 `from/to` 互斥；至少一个 |
| `camera_pos` 校验 | `ScriptValidator.java:1455-1470`（`checkRuleCameraPos`） | 方体或球；**相机世界坐标** |
| `camera_facing` 校验 | `ScriptValidator.java:1472-1475`（`checkRuleCameraFacing`） | 与 `facing` 同字段，作用对象换成相机 |
| `camera_fov` 校验 | `ScriptValidator.java:1477-1485`（`checkRuleCameraFov`） | `from`/`to` 至少一个，单位度 |
| `facing` 复用 | `ScriptValidator.java:1329-1334` | `validateConditionsBySchema` + `validateFacingConditions` |
| `clip_fact` 字段 | `ScriptValidator.java:1342-1353` | `clip`（片段 id，需可解析）+ `fact`（`started`/`completed`） |
| `rule_fact` 字段 | `ScriptValidator.java:1355-1364` | `binding`（需可解析）+ `fact`（`succeeded`/`action_completed`） |
| 校验入口 | `ScriptValidator.java:1286-1298`（`checkRuleConditionV2`） | 事实叶子只在脚本级规则放行（`clip.rules` v1 不放行） |
| 组合器嵌套上限 | `ClientConditions.java:40` | `MAX_COMBINATION_DEPTH = Evaluators.MAX_COMBINATION_DEPTH`（8） |
| schema 导出 | `MOD:script/schema/SchemaExporter.java:230-244` | `action_types` / `condition_fact_types`；**V1 类型清单未单独导出** |

**关键事实**：`V1_TYPES` 与 `FACT_TYPES` 都是 Java 常量，但 `SchemaExporter` 只导出了 `condition_fact_types`（两个事实叶子的字段），**没有导出 `V1_TYPES`**。编辑器若要避免硬编码，需要在 01 轮补一个 `rule_condition_types` 导出（合同）。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 条件树编辑 | 无 | 递归编辑器（与 06 同骨架，不同叶子集） |
| 类型列表 | 无 | 8 + 2 + 组合器；由 schema 导出（合同）或集中常量 |
| 事实叶子 | 无 | `clip`/`binding` 下拉 + `fact` 枚举 |
| `time` | 无 | `at` 或 `from`/`to` 互斥选择 |
| `camera_*` | 无 | 相机位置/朝向/FOV 表单 |
| 层数 | 无 | `n/8`，与 06 同值 |

### 3.2 与触发器组合器的差异（必须写进 UI）

| 维度 | 触发器 `all_of`/`any` | 规则 `all_of`/`any` |
|---|---|---|
| 叶子类型 | 27 类触发器 + 前置条件 + 组合器 | 8 个 V1 + 2 个事实 + 组合器 |
| 事件类 | 允许（需 `continuity.window > 0`） | 不存在「事件类」概念；事实叶子是「最近一次执行」语义 |
| 前置条件 | 可作子条件（锁存） | **不可**；等价物是 `rule_fact`/`clip_fact` |
| 深度上限 | 8 | 8（同一常量） |
| 数据位置 | 子条件 `conditions` | 同 |

### 3.3 事实叶子的语义（`clip_fact` / `rule_fact`）

| 类型 | 字段 | 语义 | 锚点 |
|---|---|---|---|
| `clip_fact` | `clip`、`fact` | `started` = 该片段**最近一次执行**已开始；`completed` = 已完成 | `ClientConditions.java:138-150`、`MOD:client/rule/FactSource.java:17-25` |
| `rule_fact` | `binding`、`fact` | `succeeded` = 该绑定最近一次激活判定成立；`action_completed` = 动作已执行完成 | `ClientConditions.java:156-166`、`FactSource.java:27-35` |

**关键语义**：「最近一次执行」不是「曾经发生过」。`RuleRuntime` 在激活变化时 `facts.clearActivationFacts(binding)`（`MOD:script/rule/runtime/RuleRuntime.java:320-326`），因此旧执行的事实会被清掉。UI 必须提示「按最近一次执行取值，不是累计」。

### 3.4 拟新建（提案）

- `ED:components/rules/RuleConditionEditor.vue`（提案）：递归骨架（与 06 同构，可抽出共用 `CombinationList.vue`）。
- `ED:components/rules/conditions/TimeCondition.vue`（提案）：`at` / `from`+`to` 模式切换。
- `ED:components/rules/conditions/CameraCondition.vue`（提案）：`camera_pos` / `camera_facing` / `camera_fov` 三态。
- `ED:components/rules/conditions/FactLeaf.vue`（提案）：`clip_fact` / `rule_fact`。
- `ED:lib/ruleConditionTypes.ts`（提案）：8 + 2 + 组合器清单与每类型字段表。

**不新建**：第二套组合器组件。06 的 `CombinationEditor` 抽成通用 `CombinationList.vue` 后，两侧只传不同的 `childKinds`。

## 4. 输入输出与字段约束

| 类型 | 字段 | 必填 | 约束 |
|---|---|---|---|
| `time` | `at` 或 `from`/`to` | 至少一个 | `at` 与 `from/to` **互斥**；单位秒；相对片段本地时钟 |
| `location` | `dimension?`、`position?`+`radius?`、`corner1?`/`corner2?` | 至少一组空间条件 | 与触发器 `location` 同口径 |
| `facing` | `yaw1`/`pitch1`/`yaw2`/`pitch2` | 是 | pitch 钳 -90..90；支持跨 ±180° |
| `biome` | `biome` | 是 | id 匹配（支持通配） |
| `dimension` | `dimension` | 是 | id 全等 |
| `camera_pos` | 方体或球 | 至少一组 | **相机世界坐标** |
| `camera_facing` | 同 `facing` | 是 | 相机朝向；无相机时恒 false |
| `camera_fov` | `from?`、`to?` | 至少一个 | 单位度 |
| `clip_fact` | `clip`、`fact` | 是 | `clip` 可解析；`fact` ∈ `started`/`completed` |
| `rule_fact` | `binding`、`fact` | 是 | `binding` 可解析；`fact` ∈ `succeeded`/`action_completed` |
| `all_of`/`any` | `list` | 是 | 非空数组；元素 `{type, conditions}`；嵌套 ≤ 8 |

约束：
- `camera_*` 在无相机时恒 false（`ClientConditions.java:78-80` 的 `ctx.hasCamera()`），UI 提示「仅在有相机时成立」。
- `time` 在挂起期间冻结（`ClientConditions.java:169-171` 注释），UI 提示「挂起时时间条件不会推进」——这是 `pause` 与 `time` 组合时的常见死锁来源。
- 组合器子条件里**不得**出现前置条件类型（`script_played` 等）——那属于触发器词汇；规则侧应写 `rule_fact`/`clip_fact`。
- 事实叶子的 `clip`/`binding` 必须来自当前文档（校验器会报「未知引用」）。

## 5. 修改步骤

1. 新建 `ruleConditionTypes.ts`（类型清单 + 字段表）。
2. 把 06 的 `CombinationEditor.vue` 抽成 `CombinationList.vue`（props: `childKinds`、`renderChild` 插槽），两侧复用。
3. 新建 `RuleConditionEditor.vue`，用 `childKinds` = 8 + 2 + 组合器。
4. 新建 `TimeCondition.vue` / `CameraCondition.vue` / `FactLeaf.vue`。
5. `RuleDefinitionEditor`（09）接入。
6. 校验映射（08）：`rules[i].condition…` 的 issue 定位到节点。

## 6. 禁止修改

- 不得把触发器的 27 类放进规则条件类型下拉（运行时不支持，`ClientConditions.V1_TYPES` 只有 8 项）。
- 不得把前置条件（`script_played` 等）放进规则组合器。
- 不得把 `clip_fact`/`rule_fact` 当作「累计发生过」（是最近一次执行）。
- 不得让 `time` 的 `at` 与 `from/to` 同时存在。
- 不得把 `camera_pos` 的坐标解释为玩家坐标。
- 不得把嵌套上限改成 8 以外的值。

## 7. 两分支承载

- Forge 1.20.1：`ClientConditions` 在 common（客户端主线程）。
- Fabric：同源，未实机验证。

## 8. 前置

- `09-rules-definition-editor.md`。
- `06-combinators.md`（共用递归骨架）。
- `01-baseline-schema`：`V1_TYPES` 是否导出（当前**未导出**，需补合同或集中常量）。

## 9. 验收

**正例**

- 条件 `{type:"time", from:2, to:3}`：2–3 秒成立。
- 条件 `{type:"camera_fov", from:30, to:60}`：FOV 在该区间时成立。
- 条件 `all_of[ {type:"location",…}, any[ {type:"facing",…}, {type:"rule_fact", binding:"b2", fact:"succeeded"} ] ]`：层数 2/8，保存后 validate 0 issue。
- `clip_fact` 选 `c1` + `completed`：c1 完成后成立；c1 再次执行时事实被重置（最近一次执行）。
- `time` 的 `at` 与 `from` 同时填写：UI 阻止。

**反例**

- 下拉里出现 `entity_kill`（触发器词汇）→ 失败。
- 组合器里出现 `script_played` → 失败（校验器报「未知判定源」）。
- `clip_fact` 被描述为「累计」→ 失败。
- `at` + `from` 同时保存 → 失败。

## 10. 真实冒烟

1. 规则 `r_fov`：条件 `camera_fov from 30 to 60`，动作 `adjust_set exposure=0.3`，绑定到片段 `gate.at=0`。
2. 播放到 FOV 进入 30–60：曝光变化；离开区间：规则不再触发（`once=true` 下只触发一次）。
3. 规则 `r_fact`：条件 `rule_fact b_fov succeeded`，动作 `play_sound`，绑定 `b_sound`。
4. 播放：`b_fov` 成功后 `b_sound` 触发。
5. 组合器：`all_of[ location, any[ facing, rule_fact ] ]` 验证嵌套。

## 11. 完成定义

- 12 种节点（8 + 2 + 2 组合器）都可编辑，字段与 `ClientConditions` / `ScriptValidator` 一致。
- 与触发器组合器共用同一递归骨架，但类型集合严格分离。
- 事实叶子的「最近一次执行」语义在 UI 上可见。
- `time` 与挂起的关系有提示。
