# 06 组合器（all_of / any）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`03-trigger-type-catalog.md`、`04-trigger-condition-editors.md`、`07-continuity-and-facts.md`、`12-rules-condition-tree.md`

## 1. 职责

给 `all_of` / `any` 一个能递归编辑 `conditions.list` 的编辑器：子条件增删、排序、嵌套、层数限制、子类型白名单、事件类子条件与 `continuity.window` 的联动。规则侧条件树与本编辑器共用递归骨架，但子类型集合不同（见 12）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 类型注册 | `MOD:ImmersiveCinematics.java:55-58` | 两者都是 `POLLING`、默认 5 tick |
| 条件 schema | `MOD:script/schema/TriggerSchemas.java:272-274`（`combinator()`） | **空表**——`list` 无法用 schema 表达，注释写明「暂不提供专用控件（手写 JSON）」 |
| 求值内核 | `MOD:trigger/server/evaluator/Evaluators.java:602-640`（`evaluateCombination`） | 按序求值；`all_of` 首个不满足短路、`any` 首个满足短路 |
| 子条件求值 | `Evaluators.java:650-700`（`evaluateCombinationChild`） | 顺序：嵌套组合器 → `PrerequisiteRegistry.has` → `TriggerRegistry.get` → 事件类窗口 |
| 层数上限 | `Evaluators.java:545`（`MAX_COMBINATION_DEPTH = 8`） | 「含顶层组合器自身为第 1 层」 |
| 事件类子条件 | `Evaluators.java:683-698` | 只有 `ctx.windowTicks() > 0` 才有窗口语义；否则 `false` |
| `dimension_change` 特殊处理 | `Evaluators.java:688-694` | 先判当前维度，再查窗口事实 |
| 校验：list 结构 | `MOD:script/ScriptValidator.java:2421-2443` | 非空数组、元素对象、`type` 非空字符串、`conditions` 必须是对象 |
| 校验：嵌套层数 | `ScriptValidator.java:2444-2456` | `depth + 1 > 8` → 报错并停止下钻 |
| 校验：前置条件子项 | `ScriptValidator.java:2457-2464` | 复用 `validatePrerequisiteRef`（与 `requires` 同一套） |
| 校验：事件类子条件 | `ScriptValidator.java:2468-2477` | `window <= 0` 时事件类子条件报错 |
| 校验：`exit_buffer` | `ScriptValidator.java:2131-2136` | `all_of`/`any` 写了正的 `exit_buffer` → 「无空间条件，将被忽略」 |
| 文档口径 | `docs/TRIGGER_TYPES.md` §25–§27 | 子条件三类：轮询类、前置条件（锁存）、另一个组合器；事件类「不可用」（文档口径比实现严格：实现允许 `window>0`） |

**关键事实（文档与实现的差异）**：`docs/TRIGGER_TYPES.md` §25 写「事件类不可用」，但实现与校验器允许「事件类 + `continuity.window > 0`」。UI 必须按**实现**做（允许但要求 window），并在提示里说明「需声明 window」。这是本轮必须写清的差异之一。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 编辑能力 | 无（`combinator()` 返回空 schema，`DynamicForm` 渲染不出任何字段） | 递归列表编辑器 |
| 子类型选择 | 无 | 分组下拉：轮询类（11 项去掉两个组合器）/ 前置条件（内置 3 + 自定义）/ 组合器（嵌套） |
| 层数 | 无 | 显示 `n/8`；达到 8 层时禁用「添加组合器」 |
| 事件类子条件 | 无 | 允许添加，但要求本触发器 `continuity.window > 0`；否则阻止并给「去设置 window」按钮 |
| 子条件排序 | 无 | 上下移动（顺序影响短路，不影响语义） |
| 空 list | 无 | 禁止保存空 list（校验器报错） |
| `exit_buffer` | 无提示 | 选中组合器时禁用 `exit_buffer` 并提示 |

### 3.2 递归编辑器的结构

```
CombinationEditor (type: all_of | any, data, depth)
├─ header: 「全部满足 / 任一满足」 + 层数 n/8 + 添加按钮
├─ list[i]: ConditionNode
│   ├─ type 选择（分组）
│   ├─ 若为组合器 → 递归 CombinationEditor(depth+1)
│   ├─ 若为前置条件 → 复用 RequirementRow（05）的「只读+编辑 data」模式
│   └─ 否则 → 复用 04 的条件编辑器（按 type 选组件）
└─ footer: 空列表提示
```

复用而非重写：子条件的叶子编辑直接调用 04 的编辑器族；前置条件子项复用 05 的 `RequirementRow`（`conditions` 位置的数据对象）。这样 27 类 + 3 前置 + 嵌套只有一份实现。

### 3.3 拟新建（提案）

- `ED:components/trigger/CombinationEditor.vue`（提案）：递归组件（Vue 组件自引用），props `{data, type, depth, windowTicks, knownScriptIds, selfId}`。
- `ED:components/trigger/ConditionNode.vue`（提案）：单个子条件的类型选择与分发。
- `ED:lib/combinationModel.ts`（提案）：
  - `MAX_DEPTH = 8`（与 `Evaluators.MAX_COMBINATION_DEPTH` 同值，注释指向来源）。
  - `childKinds(windowTicks)` — 返回可添加的子类型分组（事件类仅在 `windowTicks>0` 时可选）。
  - `depthOf(node)`、`canNest(depth)`、`validateList(data, depth, windowTicks)`。

**不新建**：独立的 `AllOfEditor.vue` / `AnyEditor.vue`。两者结构完全相同，只有判定文案与短路语义不同。

## 4. 输入输出与字段约束

`CombinationEditor` props：

| 字段 | 类型 | 约束 |
|---|---|---|
| `type` | `'all_of' \| 'any'` | 决定标题与空列表提示 |
| `data` | `{list: ConditionNode[]}` | `list` 必须存在且非空（空时 UI 显示占位，不允许保存） |
| `depth` | `number` | `1..8`；顶层由父组件传 1 |
| `windowTicks` | `number` | 来自本触发器 `continuity.window`；`0` = 未启用窗口 |
| `knownScriptIds` | `string[]` | 前置条件子项的脚本候选 |
| `selfId` | `string \| null` | 自引用检测 |

`ConditionNode` 结构：

| 字段 | 类型 | 约束 |
|---|---|---|
| `type` | `string` | 非空；必须是「轮询类触发器 / 已注册前置条件 / `all_of`/`any`」之一 |
| `conditions` | `object` | 叶子：该类型的条件体；组合器：`{list}`；前置条件：`data`（如 `{script:"x"}`） |

约束（与校验器逐条对应）：

1. `list` 非空；元素必须是对象；`type` 非空字符串；`conditions` 存在时必须是对象。
2. 嵌套：`depth + 1 ≤ 8`；超过即禁止添加并提示「组合器最大深度 8（含顶层）」。
3. 事件类子条件：`windowTicks > 0` 才允许；否则阻止添加并给「设置 window」入口。
4. `dimension_change` 作为子条件时，`conditions.dimension` 按当前维度判定（`Evaluators.java:688-694`）——UI 提示「目标维度按当前状态判，来源维度按窗口内事实判」。
5. `exit_buffer`：组合器上写正值无效（`ScriptValidator.java:2131-2136`），UI 禁用。
6. 前置条件子项的 `script` 校验与 `requires` 完全一致（05）。

## 5. 修改步骤

1. 新建 `combinationModel.ts`（常量与校验）。
2. 新建 `ConditionNode.vue`：类型下拉（分组）+ 叶子分发（调用 04 的编辑器）。
3. 新建 `CombinationEditor.vue`：递归渲染 `list`，带层数与增删/上移下移。
4. `TriggerPanel.vue` 的 `v-if` 链增加 `all_of`/`any` 分支，传 `windowTicks`（从 `selectedTrigger.continuity?.window ?? 0`）。
5. 07 的 `continuity` 折叠区在 `window` 字段旁显示「组合器内事件类子条件需要 > 0」。
6. `ScriptGraphService` 无需改动（图只读 `triggers[].type`）。

## 6. 禁止修改

- 不得把 `list` 换成对象/映射（运行时只认数组，`Evaluators.java:625-630`）。
- 不得允许空 `list` 保存（校验器报错；运行时视为不满足）。
- 不得允许 `all_of`/`any` 出现在 `requires` 里（`requires` 只认前置条件类型；组合器是触发器类型）。
- 不得把层数上限改成 8 以外的值（与 `Evaluators.MAX_COMBINATION_DEPTH` 必须同源）。
- 不得在 `window=0` 时静默允许事件类子条件（运行时会恒 false，属于静默失效）。
- 不得给组合器写 `exit_buffer` 正值。

## 7. 两分支承载

- Forge 1.20.1：求值与校验在 common；前端共用。
- Fabric：同源，未实机验证。

## 8. 前置

- `04-trigger-condition-editors.md`（叶子编辑器族）。
- `05-trigger-requires-editor.md`（前置条件子项的编辑模式）。
- `07-continuity-and-facts.md`（`window` 的输入与语义）。

## 9. 验收

**正例**

- 新建 `all_of`，添加 `location` 与 `facing` 子条件：保存后 `conditions.list` 有 2 项，`script.validate` 0 issue。
- 在 `all_of` 里嵌套 `any`：层数显示 `2/8`；再嵌套到第 8 层时「添加组合器」禁用并提示。
- 在 `any` 里添加 `script_played` 前置条件（`conditions.script = "intro"`）：保存后 validate 通过；运行时解锁后该子条件持续为真（锁存）。
- 添加 `advancement`（事件类）子条件且触发器未设 `window`：被阻止，并给「设置 window」按钮；设置 `window=200` 后可添加。
- 选中 `all_of` 触发器：`exit_buffer` 输入被禁用并提示「无空间条件」。

**反例**

- 允许空 `list` 保存 → 失败。
- 第 9 层仍可添加 → 失败。
- `window=0` 时允许事件类子条件 → 失败（会静默失效）。
- 组合器写 `exit_buffer` 正值 → 失败。
- 把 `all_of` 放进 `requires` → 失败。

## 10. 真实冒烟

1. 建 `all_of`：`location`（方体）+ `facing`（yaw 160→-160）。
2. 游戏内站进方体但不朝北：不触发；转向北：触发。
3. 改成 `any`：站进方体即触发（无需朝向）。
4. 嵌套：`all_of[ location, any[facing, script_played(intro)] ]`；先播 `intro`，再站进方体：触发（`any` 因锁存恒真）。
5. 事件类子条件：`all_of[ item_pickup(diamond) ]` + `window=200`；捡钻石后 10 秒内触发；超过窗口不触发。

## 11. 完成定义

- 组合器可递归编辑，层数与 `MAX_COMBINATION_DEPTH` 同源。
- 三类子条件（轮询/前置/组合器）都可添加，事件类受 `window` 门控且提示明确。
- 与 05/04 复用同一套叶子编辑，不重复实现字段。
- 文档口径差异（§25「事件类不可用」vs 实现允许 `window>0`）在 UI 文案里说明，且不按文档错误地禁止。
