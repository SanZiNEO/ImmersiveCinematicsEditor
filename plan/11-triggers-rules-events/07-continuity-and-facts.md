# 07 连续条件与事实层

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`02-trigger-common-fields.md`、`06-combinators.md`、`14-event-attribution.md`

## 1. 职责

把 `continuity` 三个字段（`sweep` / `dwell` / `window`）做成可编辑、可解释、有适用性约束的一组控件；并把「事实层」的语义边界写清——编辑器能表达什么、不能表达什么、哪些提示必须给出。

## 2. 现有事实（源码锚点）

### 2.1 continuity 的解析与语义

| 事实 | 锚点 | 说明 |
|---|---|---|
| 数据载体 | `MOD:script/ContinuitySpec.java:26-40` | `record(sweep, dwellTicks, windowTicks)`；`DEFAULT = (false,0,0)`；`MAX_TICKS = 1200` |
| 解析 | `MOD:script/ScriptParser.java:939-996` | 非对象/非布尔/非整数/越界 → 解析错误（不静默降级，注释明确「静默降级比拒绝加载更难排查」） |
| 未知键 | `ScriptParser.java:944-948` | 静默忽略（向前兼容） |
| 校验 | `MOD:script/ScriptValidator.java:2190-2261`（`validateContinuity`） | 逐字段报错；`sweep` 对不可扫掠类型报「无几何语义」；`dwell` 对非轮询报「无效」；`window` 对非组合器报「无效」 |
| 可扫掠类型 | `ScriptValidator.java:2281-2284`（`isSweepableType`） | `location` / `structure` / `facing` / **`observation`** |
| 引擎：旧路径 | `MOD:trigger/server/TriggerEngine.java:310-318` | `!onEnter && spec.isDefault()` → 点判定，无采样 |
| 引擎：连续路径 | `TriggerEngine.java:319-345` | 取代次 + 采样 + `TriggerEvalContext` + `TriggerEdge.observe` |
| 采样与代次 | `MOD:trigger/server/continuity/PlayerMotion.java:43`（`MAX_TICK_DISPLACEMENT = 16.0`）、`:71-95` | 传送/维度切换/载具变化/位移超阈值 → 代次 +1（段断开） |
| 边沿状态机 | `MOD:trigger/server/continuity/TriggerEdge.java:61-90`（`observe`） | `fire` / `entered` / `left` |
| 段扫掠 | `MOD:trigger/server/continuity/SegmentSweep.java`（`hitsBox`/`hitsSphere`/`hitsFacing`/`arcSteps`/`substeps`） | 位置线段、朝向最短弧 |
| `dwell` 口径 | `docs/TRIGGER_TYPES.md` §连续语义 | 「以采样点真值为准，是保守近似」 |
| `window` 口径 | `docs/TRIGGER_TYPES.md` §连续语义 + `MOD:trigger/server/fact/FactWindow.java:36-58` | 只作用于组合器内事件类子条件 |

### 2.2 事实层

| 事实 | 锚点 | 说明 |
|---|---|---|
| 类型 | `MOD:trigger/server/fact/FactType.java:12-33` | 21 种；`PERSISTENT` 3 种（`PLAYBACK_STARTED`/`PLAYBACK_FINISHED`/`TRIGGER_FIRED`），其余 `SESSION` |
| 保留上限 | 同上 | 每类型 `maxRetained`：`TRIGGER_FIRED` 1024、事件类 64–512、`SKIP_VOTE` 0（随实例清理） |
| 账本 | `MOD:trigger/server/fact/FactLedger.java`、`PlayerFacts.java` | 按玩家 UUID；`exists`/`count`/`last`/`anyWithin`/`lastWithin`/`lastMatching` |
| 查询 | `MOD:trigger/server/fact/FactQueries.java:14-30` | `scriptStarted`/`scriptFinished`/`scriptPlayed`/`triggerFired` |
| 单点匹配 | `MOD:trigger/server/fact/EventFactMatch.java:41-60` | 取「该类型最后一条事实」再逐字段比对 |
| 窗口匹配 | `MOD:trigger/server/fact/FactWindow.java:36-58` | 取「窗口内任意一条」 |
| 库存基线例外 | `MOD:trigger/server/evaluator/Evaluators.java:640-660`（`InventoryTracker`） | 净变化需要「上一轮读数」，故不入事实层（注释给出理由） |
| 持久化 | `FactType.Durability` | 3 种随存档；其余退出即清 |

事实账本在服务端，编辑器不能直接读内存；但已有ServerFactsApi只读门面可由受控桥查询。语义说明归本页，实际查询UI与桥归同轮16；不能把当前缺跨进程消息当作永久不做事实查询的理由。未导出的实时dwell进度不伪造。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| `continuity` 编辑 | 无（`TriggerPanel` 无入口；schema 已导出 `triggerFields.continuity`） | 折叠区三字段 + 适用范围徽标 |
| 适用范围提示 | 无 | `sweep` 只对 4 类；`dwell` 只对轮询；`window` 只对组合器 |
| 单位 | 无 | `dwell`/`window` 标 tick，并给「20 tick = 1 秒」换算提示 |
| 与 `on_enter` 的关系 | 无提示 | `on_enter=true` 且 `continuity` 默认 → 仍走边沿状态机（`TriggerEngine.java:313`），提示「on_enter 会启用边沿状态机」 |
| 事实语义说明 | 无 | 在 `requires` 与组合器前置子项旁给「锁存/累计」说明（只读） |
| 运行时事实 | 当前无编辑器消息 | 由16受控查询累计/最近/窗口与保留集，显示时间戳/口径；无回执显示未知，不假造连续命中进度 |

### 3.2 适用范围矩阵（必须与校验器逐条一致）

| 字段 | 生效类型 | 无效时校验器文案 |
|---|---|---|
| `sweep` | `location` / `structure` / `facing` / `observation` | 「`.sweep` 对 X 无几何语义，将被忽略（仅 location / structure / facing / observation 支持段扫掠）」 |
| `dwell` | 所有 `POLLING`（含组合器） | 「`.dwell` 对 X 无效（事件驱动触发器不参与轮询，将被忽略）」 |
| `window` | `all_of` / `any` | 「`.window` 对 X 无效（window 只对 all_of / any 的事件类子条件生效，将被忽略）」 |

注意：`sweep` 的类型集合**包含 `observation`**，但 `ContinuitySpec` 的类注释只写了 `location`/`structure`/`facing`（`ContinuitySpec.java:8-11`）。实现以校验器与求值器为准（`Evaluators.java:251-290` 的 `evaluateObservation` 三参重载确实做弧带扫掠）。UI 按校验器口径，并在文档里标注这处注释滞后。

### 3.3 拟新建（提案）

- `ED:components/trigger/ContinuityFields.vue`（提案）：三字段 + 徽标 + 提示；`dwell`/`window` 用整数输入（步长 1，范围 0–1200）。
- `ED:lib/continuityScope.ts`（提案）：`applies(field, type, strategy)` 与 `warnings(trigger, strategy)`；`MAX_TICKS = 1200`（与 `ContinuitySpec.MAX_TICKS` 同值，注释指源）。
- `ED:components/trigger/FactSemanticsNote.vue`（提案）：只读说明块，解释「锁存 vs 瞬时 vs 窗口」，用于 `requires` 与组合器前置子项旁。

事实查询面板/客户端/服务端桥见[16-fact-query-panel.md](16-fact-query-panel.md)，本轮必做；本页不重复其接口和所有权。

## 4. 输入输出与字段约束

| 字段 | 类型 | 默认 | 范围 | 单位 | 生效 |
|---|---|---|---|---|---|
| `sweep` | boolean | `false` | — | — | 4 类几何 |
| `dwell` | int | `0` | `0..1200` | tick | 轮询类 |
| `window` | int | `0` | `0..1200` | tick | 组合器 |

约束：
- `continuity` 全为默认时**不写该对象**（保持脚本干净；与 `stripScriptDefaults` 的保存前精简一致，`ED:store.ts:441-447`）。
- 写 `dwell > 0` 而类型是事件驱动：允许保存但黄条（校验器同口径）。
- `window > 0` 但触发器不是组合器：允许保存但黄条。
- `sweep=true` 而类型不可扫掠：允许保存但黄条。
- 三个字段都不得接受小数（解析器要求整数，`ScriptParser.java:972-996`）。

事实语义说明块的内容（只读，文案固定）：

| 概念 | 文案 |
|---|---|
| 锁存（前置条件） | 「发生过即真，之后一直为真；`script_played` 要求开始且有结束」 |
| 瞬时（轮询条件） | 「只看此刻状态；每轮用同一时刻的玩家状态重算全部子条件」 |
| 窗口（事件类子条件） | 「看最近 W tick 内是否发生过；只在组合器内、且 `window > 0` 时有效」 |
| 累计 vs 保留深度 | 「`exists`/`count`/`last` 是累计口径；`anyWithin`/`lastWithin` 受保留条数限制（事件类 64–512、触发命中 1024）」 |

## 5. 修改步骤

1. 新建 `continuityScope.ts`（范围常量 + 适用范围）。
2. 新建 `ContinuityFields.vue`，接在 02 的通用字段区下方。
3. `TriggerPanel.vue` 读取/写入 `selectedTrigger.continuity`；全默认时删除该键。
4. `window` 变化时通知 `CombinationEditor`（06）刷新可选子类型。
5. 新建 `FactSemanticsNote.vue`，挂在 requires 区与组合器前置子项旁。
6. 与 08 的校验展示联动：黄条与 `script.validate` 文案一致（同一套 `warnings()`）。

## 6. 禁止修改

- 不得把 `dwell`/`window` 的单位改成秒。
- 不得允许小数或负数。
- 不得把 `MAX_TICKS` 改成 1200 以外的值（与 `ContinuitySpec.MAX_TICKS` 同源）。
- 不在无真实回执时显示运行时事实或dwell进度；16允许展示受控查询实际返回的数据，不能据此限制查询功能。
- 不得把 `sweep` 的适用类型按 `ContinuitySpec` 注释（缺 `observation`）来实现——以校验器/求值器为准。
- 不得在 `continuity` 全默认时仍写入空对象。

## 7. 两分支承载

- Forge 1.20.1：`ContinuitySpec` / `PlayerMotion` / `TriggerEdge` / `SegmentSweep` 全在 common。
- Fabric：同源；`PlayerMotion` 依赖服务端 tick 与玩家实体，未实机验证。

## 8. 前置

- `02-trigger-common-fields.md`（通用字段区）。
- `06-combinators.md`（`window` 与子类型联动）。
- `01-baseline-schema`：`triggerFields.continuity` 已导出（`SchemaExporter.java:75-90`），无需新增。

## 9. 验收

**正例**

- `location` 触发器：勾 `sweep` → 保存后 `continuity.sweep=true`；走很快穿过方体也能触发（游戏内验证）。
- `advancement` 触发器：`dwell` 输入 20 → 黄条「事件驱动无效」；保存后 validate 报同一句。
- `all_of` 触发器：`window` 输入 200 → 组合器内可选事件类子条件；`window` 归 0 → 事件类子条件选项消失并提示。
- 三个字段都保持默认：保存后 `continuity` 键不存在。
- `dwell` 输入 1201 → 被拒（范围 0–1200）。

**反例**

- 允许 `dwell=0.5` → 失败。
- 无真实来源却显示当前停留1.2s等进度→失败；16返回的真实事实有明确查询口径与时刻，可以展示。
- `continuity` 全默认却写入 `{}` → 失败。
- `sweep` 对 `observation` 报「无几何语义」→ 失败（实现支持）。

## 10. 真实冒烟

1. `location` + `sweep`：以冲刺速度穿过 1 格宽方体，点判定会漏，扫掠应命中。
2. `location` + `dwell=20`：进入区域不足 1 秒离开 → 不触发；停留 1 秒以上 → 触发。
3. `facing` + `sweep`：快速转头扫过目标区间 → 触发。
4. `observation` + `sweep`：快速扫视目标 → 触发（验证第 4 类可扫掠）。
5. `all_of[item_pickup]` + `window=100`：捡起后 5 秒内触发；10 秒后不触发。

## 11. 完成定义

- 三字段可编辑，单位/范围/默认值与 Java 完全一致。
- 适用范围与校验器逐条一致（含 `observation` 可扫掠）。
- 全默认不写对象。
- 事实语义说明与16查询面板一致，当前无端口和成功空结果区分清楚，查询能力不延期。
