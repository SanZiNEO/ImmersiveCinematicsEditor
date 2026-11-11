# 02 触发器通用字段

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`01-trigger-identity.md`、`07-continuity-and-facts.md`、`03-trigger-type-catalog.md`

## 1. 职责

把 `meta.triggers[]` 上「对所有类型都通用」的字段一次性补齐并对齐取值域：`id`、`type`、`repeatable`、`delay`、`on_enter`、`exit_buffer`、`poll_interval`，以及 `continuity` 的入口（细则见 07）。同时补 `meta.trigger_poll_interval`（脚本级缺省）的入口归属。

## 2. 现有事实（源码锚点）

| 字段 | 解析锚点 | 默认 | 校验锚点 | 编辑器现状 |
|---|---|---|---|---|
| `id` | `MOD:script/ScriptParser.java:1052-1066` | `null`（合成身份） | `MOD:script/ScriptValidator.java:1995-2025` | 有输入框（`ED:components/TriggerPanel.vue:228-235`），无正则校验 |
| `type` | `ScriptParser.java:920`（`requireString`） | 必填 | `ScriptValidator.java:2086-2130` | 有下拉（`:237-244`），选项来自 `schema.triggers.types` |
| `repeatable` | `ScriptParser.java:925` | `false` | 无（布尔） | 有勾选（`:246-256`） |
| `delay` | `ScriptParser.java:926` | `0f` | 无（浮点） | 有数字框（`:258-265`），步长 0.1 |
| `on_enter` | `ScriptParser.java:928` | `false` | 无（布尔；事件类写它无效，仅文档提示） | 有勾选（`:267-276`），文案「仅首次进入」 |
| `exit_buffer` | `ScriptParser.java:929` | `0f` | 无（浮点） | 有数字框（`:278-285`），步长 0.5 |
| `poll_interval` | `ScriptParser.java:932`（`optPollInterval`） | `null`（回落） | `ScriptValidator.java:2156-2175`（`checkPollIntervalField`） | **无** |
| `continuity` | `ScriptParser.java:939-996`（`parseContinuity`） | `ContinuitySpec.DEFAULT` | 解析期即报错（非对象/非整数/越界） | **无** |
| `meta.trigger_poll_interval` | `ScriptParser.java:281` | `null` | `ScriptValidator.java:210` | **无** |

**关键事实**

1. `poll_interval` 的生效链是「触发器级 ?? 脚本级 ?? 类型级默认」，只有轮询类有效；事件驱动类写了无效（`MOD:spi/TriggerType.java:63-70` 的 `resolvePollInterval` 对 `EVENT_DRIVEN` 恒返回 0）。
2. `exit_buffer` 只有在 `on_enter=true` 且 `> 0` 时才生成 `exitConditions`（`MOD:script/ScriptManager.java:117-120`）——即「外扩区域」只在进入/离开判定里用。
3. `delay` 单位是**秒**，`poll_interval` 单位是 **tick**（`docs/TRIGGER_TYPES.md` 明确两者不统一）。UI 必须分别标单位。
4. `meta.trigger_poll_interval` **不在** `MetaSchemas` 里（`MOD:script/schema/MetaSchemas.java` 全表无该键），因此 `schema.get` 不会导出它，编辑器无法用 schema 驱动——见 3.2。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 字段来源 | 硬编码 `commonFields`（`TriggerPanel.vue:49-57`），且未被模板使用 | 由 `schema.triggers.triggerFields` 驱动（`SchemaExporter.java:67-90`），模板只做布局 |
| `poll_interval` | 无 | 数字框 + 单位 tick + 范围 1–600 + 「仅轮询类生效」提示；事件类禁用并说明 |
| `continuity` | 无 | 折叠区（sweep/dwell/window），见 07 |
| 单位标注 | 「延迟 (秒)」「离开缓冲 (格)」 | 保留，并给 `poll_interval` 标「tick」 |
| `on_enter` 适用范围 | 无提示 | 事件类类型时显示黄条「事件驱动触发器没有进出区域语义，on_enter 只相当于只触发一次」 |
| `exit_buffer` 适用范围 | 无提示 | `on_enter=false` 时禁用并提示「仅在 on_enter=true 时生效」 |
| `meta.trigger_poll_interval` | 无入口 | 放在「脚本设置」区（归属见 3.2） |

### 3.2 `meta.trigger_poll_interval` 的入口归属

它不属于任何单个触发器，但只影响触发器。三个候选：

| 方案 | 位置 | 问题 |
|---|---|---|
| A | 触发器面板顶部（脚本级缺省） | 面板语义从「编辑选中的触发器」变成「触发器 + 脚本设置」，混 |
| **B** | 触发器面板顶部的「脚本级缺省」折叠条 | 与触发器同屏、可对照；折叠后不占空间 |
| C | 文档顶栏的脚本设置弹窗（05 轮） | 与触发器离得远，作者改间隔要跨面板 |

选 **B**，但**必须先让 schema 导出该字段**（`MetaSchemas` 未登记 → 01 轮需补；本轮只写合同，不改主模组）。若 01 轮未补，本任务降级为「只读展示当前值 + 提示需手改 JSON」，不得在 TS 里硬编码默认值。

### 3.3 拟新建（提案）

- `ED:components/trigger/TriggerCommonFields.vue`（提案）：按 `triggerFields` schema 渲染通用字段，含单位、范围、适用性提示。
- `ED:components/trigger/ScriptPollDefaults.vue`（提案）：`meta.trigger_poll_interval` 折叠条。
- `ED:lib/triggerScope.ts`（提案）：
  - `isPolling(type, schema): boolean` — 需要类型→策略映射（策略**不在** `TriggerSchemas` 导出里，见 3.4）。
  - `onEnterApplies(type): boolean`、`exitBufferApplies(trigger): boolean`、`continuityApplies(type, field): boolean`。

### 3.4 策略映射从哪来（重要缺口）

`SchemaExporter` 只导出 `types` + `conditions` + `triggerFields`，**不导出每个类型的 `ListenStrategy` 与默认轮询间隔**。而 UI 需要它来判断「这个类型是否轮询」「默认间隔多少」。

三个选择：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | 01 轮在 `SchemaExporter` 的 `triggers` 段增加 `strategies: {type: {strategy, pollInterval}}`（提案） | 需要改主模组导出（本轮不改代码，只写合同） |
| B | 前端硬编码 27 类的策略表 | 与 `ImmersiveCinematics.registerTriggerTypes()` 漂移 |
| C | 不显示策略，只显示「写了可能无效」 | 作者无法判断 |

本轮按 **A** 写合同；在 A 落地前，前端只显示静态提示文案（不硬编码表），并把 `poll_interval` 标为「轮询类专用（具体类型见文档）」。

## 4. 输入输出与字段约束

| 字段 | 类型 | 默认 | 取值域 | 单位 | 适用性 |
|---|---|---|---|---|---|
| `id` | string | 无（必填，见 01） | `^[A-Za-z0-9_]{1,64}$` | — | 全部 |
| `type` | string | 无（必填） | `schema.triggers.types`（27 项） | — | 全部 |
| `repeatable` | boolean | `false` | — | — | 全部 |
| `delay` | number | `0` | 有限、`≥ 0`；运行时按 `ms = delay*1000`，`<1` tick 时按 1 tick 处理（`TriggerEngine.java:270-272`） | 秒 | 全部 |
| `on_enter` | boolean | `false` | — | — | 轮询类（事件类无效） |
| `exit_buffer` | number | `0` | 有限、`≥ 0` | 格 | 仅 `on_enter=true` |
| `poll_interval` | int | `null` | `1..600`（`TriggerType.POLL_INTERVAL_MIN/MAX`） | tick | 仅轮询类 |
| `continuity.sweep` | boolean | `false` | — | — | `location`/`structure`/`facing` |
| `continuity.dwell` | int | `0` | `0..1200`（`ContinuitySpec.MAX_TICKS`） | tick | 轮询类 |
| `continuity.window` | int | `0` | `0..1200` | tick | `all_of`/`any` |
| `meta.trigger_poll_interval` | int | `null` | `1..600` | tick | 脚本级，仅轮询类 |

约束：
- 写 `poll_interval` 到事件驱动类型：允许保存（解析器不拒绝），但 UI 必须黄条提示「事件驱动不轮询，此值无效」（校验器同口径，`ScriptValidator.java:2156-2175`）。
- `delay` 的输入步长 0.1 是 UI 便利，不限制精度；保存时不做四舍五入。
- `exit_buffer` 在 `on_enter=false` 时保留值（不自动清零）——清零会静默改数据。

## 5. 修改步骤

1. 01 轮补 `SchemaExporter`：`triggers.triggerFields` 增加 `repeatable`/`delay`/`on_enter`/`exit_buffer`/`poll_interval`，`triggers.strategies` 增加每类型策略与默认间隔，`MetaSchemas` 增加 `trigger_poll_interval`。（**合同，本轮不改**）
2. 新建 `TriggerCommonFields.vue`，按 schema 渲染；删除 `TriggerPanel.vue:49-57` 的 `commonFields`。
3. 新增 `poll_interval` 输入（范围校验、单位 tick、适用性提示）。
4. `on_enter` / `exit_buffer` 加联动禁用与提示（替换 `:267-285`）。
5. 新建 `ScriptPollDefaults.vue`，读 `meta.trigger_poll_interval`，折叠条放在触发器列表上方。
6. 新建 `triggerScope.ts`；在 `strategies` 未导出前只返回「未知」，UI 显示中性提示而非错误。

## 6. 禁止修改

- 不得在 TS 里硬编码 27 类策略表或默认轮询值（会与 `ImmersiveCinematics.registerTriggerTypes()` 漂移）。
- 不得把 `delay` 的单位改成 tick，或把 `poll_interval` 改成秒。
- 不得在 `on_enter=false` 时自动清空 `exit_buffer`。
- 不得对 `poll_interval` 做「越界自动钳制后保存」（应提示并要求作者改，钳制会静默改数据）。
- 不得删除 `repeatable`/`delay` 的既有输入（它们是对的，只是缺 schema 驱动）。

## 7. 两分支承载

- Forge 1.20.1：字段解析/校验在 common；前端共用。
- Fabric：同源，未实机验证。

## 8. 前置

- `01-baseline-schema`：`triggerFields` / `strategies` / `meta.trigger_poll_interval` 的导出合同落地。
- `07-continuity-and-facts.md`：`continuity` 的细则（本文件只留入口）。

## 9. 验收

**正例**

- 打开一个 `location` 触发器：`poll_interval` 可输入 1–600；输入 0 或 601 被拒并提示范围。
- 打开一个 `advancement`（事件驱动）触发器：`poll_interval` 禁用 + 黄条「事件驱动不轮询」；`on_enter` 黄条「无进出语义」。
- `on_enter=false` 时 `exit_buffer` 禁用，但已有值保留显示；改成 `true` 后恢复可编辑。
- 脚本级缺省 `trigger_poll_interval = 10`：触发器未写 `poll_interval` 时，面板显示「生效：10（脚本级）」；写了 2 时显示「生效：2（触发器级）」。
- 所有通用字段的默认值与 Java 解析默认一致（`repeatable=false`、`delay=0`、`on_enter=false`、`exit_buffer=0`）。

**反例**

- 面板显示 `poll_interval` 默认 20（硬编码）而实际类型默认是 5 → 失败。
- `exit_buffer` 在 `on_enter=false` 时被清零 → 失败。
- 事件驱动类型仍允许编辑 `poll_interval` 且无提示 → 失败。
- `commonFields` 硬编码表仍存在 → 失败。

## 10. 真实冒烟

1. 新建 `location` 触发器，`poll_interval=2`，`on_enter=true`，`exit_buffer=1.5`，`delay=0.5`。
2. 保存 → 游戏内 `/icinematics reload` → `/icinematics validate` 无 issue。
3. 观察日志：该触发器按 2 tick 求值；进入区域后延迟 0.5s 触发一次；离开 1.5 格外才复位。
4. 把 `poll_interval` 改成 0：保存前 UI 拦截；强行改文件后 validate 报错。
5. 把类型改成 `advancement`：`poll_interval` 变禁用 + 提示；reload 后该值被忽略（行为不变）。

## 11. 完成定义

- 9 个通用字段 + 1 个脚本级字段全部可编辑，取值域与 Java 一致。
- 每个字段的单位与适用性在 UI 上明确，不静默保存无效组合。
- 字段表来自 schema，前端无硬编码副本。
- 脚本级缺省与触发器级覆盖的生效链在 UI 上可见。
