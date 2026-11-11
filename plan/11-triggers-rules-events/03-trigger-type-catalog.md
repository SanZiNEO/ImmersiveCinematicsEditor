# 03 触发类型清单与编辑器映射

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`02-trigger-common-fields.md`、`04-trigger-condition-editors.md`、`06-combinators.md`、`07-continuity-and-facts.md`

## 1. 职责

给出 27 种触发类型的唯一权威清单：类型 id、监听策略、类型级轮询默认、条件字段、事实依赖、编辑器归属。它是「下拉框顺序」「默认值」「适用性提示」「编辑器选择」的共同来源，禁止各处再抄一份。

## 2. 现有事实（源码锚点）

### 2.1 类型清单与顺序

`MOD:script/schema/TriggerSchemas.java:23-52`（`typeList`）——**这个顺序就是编辑器下拉顺序**（注释明确）：

`login`、`location`、`advancement`、`biome`、`entity_kill`、`death`、`entity_interact`、`block_interact`、`item_on_interact`、`dimension_change`、`item_craft`、`item_use`、`item_consume`、`item_release`、`item_instant_use`、`item_use_interrupt`、`item_pickup`、`item_drop`、`xp`、`dimension`、`observation`、`inventory`、`structure`、`gamestage`、`facing`、`all_of`、`any`。

### 2.2 注册（策略 + 默认轮询 + 求值器）

`MOD:ImmersiveCinematics.java:23-61`（`registerTriggerTypes`）。默认轮询来自 `MOD:Config.java:57-65`。

### 2.3 条件字段表

`TriggerSchemas.java:74-274`，逐类型一个 `Map<String, FieldDef>`；`SchemaExporter` 导出为 `schema.triggers.conditions[type]`（`MOD:script/schema/SchemaExporter.java:62-66`）。

### 2.4 事实依赖

事件驱动类型读事实账本（`MOD:trigger/server/fact/FactType.java:12-33`）；轮询类型读玩家/世界当前状态。

## 3. 权威清单

| # | type | 策略 | 默认轮询(tick) | 条件字段（`conditions`） | 事实/状态 | 编辑器归属 |
|---|---|---|---|---|---|---|
| 1 | `login` | EVENT | — | 无 | `LOGIN`（会话） | `NoConditionTriggerEditor` |
| 2 | `location` | POLLING | 20（`Config.triggerPollIntervalLocation`） | `dimension`、`position`、`radius`、`corner1`、`corner2` | 玩家位置/维度 | `LocationTriggerEditor`（已存在） |
| 3 | `advancement` | EVENT | — | `advancement`（必填） | `ADVANCEMENT` | `SingleFieldTriggerEditor`（已存在） |
| 4 | `biome` | POLLING | 40（`triggerPollIntervalBiome`） | `biome`（必填） | 玩家所在群系 | `SingleFieldTriggerEditor`（已存在） |
| 5 | `entity_kill` | EVENT | — | `entity`（必填）+ 场景组 | `ENTITY_KILL` | `EntityKillTriggerEditor`（已存在） |
| 6 | `death` | EVENT | — | 场景组（全可选） | `DEATH` | **缺**（现走 `DynamicForm`） |
| 7 | `entity_interact` | EVENT | — | `target`（必填） | `INTERACT_ENTITY` | `SingleFieldTriggerEditor`（已存在） |
| 8 | `block_interact` | EVENT | — | `target`（必填） | `INTERACT_BLOCK` | `SingleFieldTriggerEditor`（已存在） |
| 9 | `item_on_interact` | EVENT | — | `item`、`target`（必填）、`target_type` | `INTERACT_BLOCK`/`INTERACT_ENTITY` | `ItemOnInteractTriggerEditor`（已存在） |
| 10 | `dimension_change` | EVENT | — | `dimension`（必填）、`from_dimension` | `DIMENSION_CHANGE` + 当前维度 | `DimensionChangeTriggerEditor`（已存在） |
| 11 | `item_craft` | EVENT | — | `item`（必填） | `ITEM_CRAFT` | `SingleFieldTriggerEditor` |
| 12 | `item_use` | EVENT | — | `item`（必填） | `ITEM_USE` | `SingleFieldTriggerEditor` |
| 13 | `item_consume` | EVENT | — | `item`（必填） | `ITEM_CONSUME` | `SingleFieldTriggerEditor` |
| 14 | `item_release` | EVENT | — | `item`（必填） | `ITEM_RELEASE` | `SingleFieldTriggerEditor` |
| 15 | `item_instant_use` | EVENT | — | `item`（必填） | `ITEM_INSTANT_USE` | `SingleFieldTriggerEditor` |
| 16 | `item_use_interrupt` | EVENT | — | `item`（必填） | `ITEM_USE_INTERRUPT` | `SingleFieldTriggerEditor` |
| 17 | `item_pickup` | EVENT | — | `item`（必填） | `ITEM_PICKUP` | `SingleFieldTriggerEditor` |
| 18 | `item_drop` | EVENT | — | `item`（必填） | `ITEM_DROP` | `SingleFieldTriggerEditor` |
| 19 | `xp` | POLLING | 20（**复用** `triggerPollIntervalLocation`） | `level`、`total` | 玩家经验 | `XpTriggerEditor`（已存在） |
| 20 | `dimension` | POLLING | 20（**复用** `triggerPollIntervalLocation`） | `dimension`（必填） | 当前维度（与 `dimension_change` 共用求值器） | `SingleFieldTriggerEditor` |
| 21 | `observation` | POLLING | 5（硬编码） | `target`（必填）、`target_type`、`reach`（默认 4.5） | 服务端射线 | `ObservationTriggerEditor`（已存在） |
| 22 | `inventory` | POLLING | 20（`triggerPollIntervalInventory`） | `items`（必填，数组）、`change` | 背包扫描 + 采样基线 | `InventoryTriggerEditor`（已存在） |
| 23 | `structure` | POLLING | 20（`triggerPollIntervalStructure`） | `structure`（必填）、`radius` | 结构查询 | `StructureTriggerEditor`（已存在） |
| 24 | `gamestage` | POLLING | 20（`triggerPollIntervalGamestage`） | `stage`（必填） | 反射 GameStages | `SingleFieldTriggerEditor` |
| 25 | `facing` | POLLING | 5（硬编码） | `yaw1`、`pitch1`、`yaw2`、`pitch2` | 玩家朝向 | **缺**（现走 `DynamicForm`） |
| 26 | `all_of` | POLLING | 5（硬编码） | `list`（必填，子条件数组） | 子条件求值 | **缺**（无 UI） |
| 27 | `any` | POLLING | 5（硬编码） | `list`（必填） | 子条件求值 | **缺**（无 UI） |

统计：EVENT 16 种、POLLING 11 种（含 2 个组合器）。

### 3.1 默认轮询的两个坑（必须在 UI 上避免误导）

1. **`xp` 与 `dimension` 复用 `triggerPollIntervalLocation`**（`ImmersiveCinematics.java:44`、`:46`）。改 `location` 的全局配置会同时改这两个。UI **不得**显示「xp 默认 20」这种独立默认值文案；应显示「跟随 `location` 配置」。
2. **`observation`/`facing`/`all_of`/`any` 的 5 是硬编码**（`ImmersiveCinematics.java:50`、`:53`、`:55`、`:57`），不走 `Config`。UI 显示「固定 5」而不是「配置项」。

### 3.2 类型语义陷阱

| 类型 | 陷阱 | 锚点 |
|---|---|---|
| `dimension` | 与 `dimension_change` 共用求值器 `evaluateDimensionChange`，因此它也能读 `from_dimension`（虽然 schema 未登记该字段） | `ImmersiveCinematics.java:46`、`MOD:trigger/server/evaluator/Evaluators.java:163-175` |
| `entity_kill` / `item_pickup` | 只认单值；「任选其一」用 `any` 组合器 | `Evaluators.java:143-150`、`:221-224`（注释明确） |
| `inventory` | `change=increase/decrease` 依赖「上一轮采样」，首轮恒 false | `Evaluators.java:355-390`、`:640-660`（`InventoryTracker` 注释） |
| `structure` | `radius>0` 时按 8 格步长循环查（不是逐格） | `Evaluators.java:466-480` |
| `gamestage` | 依赖可选模组；未安装时恒 false，只提示一次 | `Evaluators.java:482-500` |
| `observation` | `target_type` 缺省时方块与实体都查，取近者 | `Evaluators.java:300-330` |
| `death` | `repeatable=false` = 一生一次（跨死亡持久）；无死因条件 | `docs/TRIGGER_TYPES.md` §28 |
| `login` | 求值器恒 `true`，由登录事件驱动 | `Evaluators.java:177-179` |

## 4. 差异与提案

### 4.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 下拉选项 | 来自 `schema.triggers.types`（`TriggerPanel.vue:31`） | 不变，但顺序/分组按本表；增加「事件驱动 / 轮询 / 组合器」分组标签 |
| 类型中文名 | `TriggerPanel.vue:174-196` 硬编码 21 项，缺 `death`/`all_of`/`any`/`item_*` 中的部分 | 移到 `ED:i18n`，覆盖 27 项，缺项回退原 id |
| 默认值提示 | 无 | 每种类型显示「默认每 N tick 检测」或「事件驱动」 |
| 编辑器选择 | `v-if` 链（`TriggerPanel.vue:300-390`） | 表驱动（type → 组件），未知类型回退 `DynamicForm` |
| 策略信息 | 无 | 由 02 的 `strategies` 导出（合同） |

### 4.2 拟新建（提案）

- `ED:components/trigger/typeCatalog.ts`（提案）：`{type, labelKey, group, editor, conditionKeys}` 表；`group ∈ 'event' | 'polling' | 'combinator'`。
  - **注意**：`group` 是「UI 分组」，必须与 02 的 `strategies` 一致；若 `strategies` 未导出，`typeCatalog` 只保留 `labelKey`/`editor`，不猜策略。
- `ED:components/trigger/TriggerTypeSelect.vue`（提案）：分组下拉 + 类型说明。
- `ED:components/trigger/DeathTriggerEditor.vue`（提案）：场景组（维度/群系/位置+半径/方体）。
- `ED:components/trigger/FacingTriggerEditor.vue`（提案）：两组 yaw/pitch，带跨 ±180° 提示。

**不新建**：`all_of`/`any` 专用编辑器（见 06 组合器，共用一套递归组件）。

## 5. 输入输出与字段约束

`typeCatalog` 条目：

| 字段 | 约束 |
|---|---|
| `type` | 必须是 `schema.triggers.types` 的成员；不得出现 schema 外的类型 |
| `labelKey` | i18n key；27 项齐全 |
| `editor` | 组件名；`null` = 走 `DynamicForm` |
| `group` | `event` / `polling` / `combinator`；与运行时策略一致 |

约束：
- 类型切换时**不清空** `conditions`（保留未知键），只提示「以下字段对新类型无效」并列出。理由：作者常在两种相似类型间来回切，清空会丢数据；`ScriptValidator` 会对未知字段报 issue，足够兜底。
- 类型切换不得改动 `id`/`repeatable`/`delay`/`requires`。
- 组合器类型（`all_of`/`any`）切换时若 `conditions.list` 不存在，初始化为空数组。

## 6. 修改步骤

1. 新建 `typeCatalog.ts`，27 项齐全（顺序 = `TriggerSchemas.typeList`）。
2. `i18n/zh_cn.ts` / `en_us.ts` 增加 27 个类型名（补 `death`/`all_of`/`any` 等缺项）。
3. `TriggerPanel.vue` 的 `typeLabel`（`:174-196`）改为查 i18n；删除硬编码表。
4. 条件编辑器选择从 `v-if` 链改为 `typeCatalog[type].editor` 映射 + `DynamicForm` 回退（替换 `:300-390`）。
5. 新增 `DeathTriggerEditor.vue`、`FacingTriggerEditor.vue`。
6. 类型下拉分组：`TriggerTypeSelect.vue`；每组标题「事件驱动 / 轮询 / 组合器」。

## 7. 禁止修改

- 不得增删类型（27 是 `TriggerSchemas.typeList` 的现状；新类型属主模组变更）。
- 不得改类型 id 字符串。
- 不得在 TS 里写死默认轮询数值（`20`/`40`/`5`），除非同时标注来源且与 `Config`/注册代码一致——推荐完全由 `strategies` 导出驱动。
- 不得在切换类型时清空 `conditions`。
- 不得把 `dimension` 与 `dimension_change` 合并成一个 UI 类型。

## 8. 两分支承载

- Forge 1.20.1：注册与求值器在 common；`Config` 在 common。
- Fabric：同源；`Config` 读取路径不同但值语义一致，未实机验证。

## 9. 验收

**正例**

- 类型下拉列出 27 项，分三组；`death`/`all_of`/`any` 有中文名。
- 选中 `location`：显示「轮询 · 默认 20 tick」。
- 选中 `xp`：显示「轮询 · 跟随 location 的全局配置」而不是「20」。
- 选中 `observation`：显示「轮询 · 固定 5 tick」。
- 选中 `advancement`：显示「事件驱动」且 `poll_interval` 禁用。
- 从 `biome` 切到 `advancement`：`conditions` 里的 `biome` 字段保留并提示「对新类型无效」。

**反例**

- 下拉缺 `death` → 失败。
- 显示 `xp` 默认 20 且声称独立 → 失败。
- 切换类型清空 `conditions` → 失败。
- 出现 schema 里没有的类型 → 失败。

## 10. 真实冒烟

1. 逐个选中 27 种类型：下拉无缺项、说明文案正确、编辑器不崩。
2. 为每种类型各建一个触发器（条件填最小合法值），保存 → `script.validate` 返回 0 issue。
3. 游戏内 `/icinematics reload`：日志 `Registered 27 trigger registrations`（或实际数量）无「Unknown trigger type」。
4. 把 `xp` 的 `poll_interval` 设为 1，观察日志频率明显高于默认；把 `location` 的全局配置改动后重启，确认 `xp`/`dimension` 同步变化（验证「跟随」文案为真）。

## 11. 完成定义

- 27 项类型在 UI、schema、运行时三处一一对应，无缺项无多项。
- 默认轮询与策略的展示与实际注册一致，两个「复用/硬编码」坑有明确文案。
- 类型→编辑器是表驱动，新增类型只需加一行。
- 类型切换不清空条件数据。
