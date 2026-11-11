# 04 条件编辑器族

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`03-trigger-type-catalog.md`、`06-combinators.md`、`08-trigger-validation-diagnostics.md`

## 1. 职责

把 27 种类型的 `conditions` 编辑体验收敛成**四种字段形态**（单值 / 几何 / 列表 / 组合器），补齐 9 个缺口，并修掉现有编辑器写出的非法字段。不负责通用字段（02）、不负责 requires（05）、不负责组合器递归细节（06）。

## 2. 现有事实（源码锚点）

### 2.1 现有 10 个编辑器

| 组件 | 锚点 | 覆盖类型 | 写法 |
|---|---|---|---|
| `NoConditionTriggerEditor.vue` | `ED:components/trigger/NoConditionTriggerEditor.vue:1-13` | `login` | 纯文案 |
| `SingleFieldTriggerEditor.vue` | `:1-45` | `advancement`/`biome`/`entity_interact`/`block_interact`/`item_craft`/`item_use`/`item_consume`/`item_release`/`item_instant_use`/`item_use_interrupt`/`item_pickup`/`item_drop`/`dimension`/`gamestage` | 一个 `RegistryStringField`，`fieldKey` 由 `SINGLE_FIELD_TYPES` 映射（`TriggerPanel.vue:198-217`） |
| `LocationTriggerEditor.vue` | `:1-162` | `location` | 维度 + 区域模式（点+半径 / 两点方体）+ 坐标 |
| `EntityKillTriggerEditor.vue` | `:1-82` | `entity_kill` | 实体 + 场景组 |
| `ItemOnInteractTriggerEditor.vue` | `:1-72` | `item_on_interact` | item + target + target_type |
| `ObservationTriggerEditor.vue` | `:1-68` | `observation` | target + target_type + reach |
| `InventoryTriggerEditor.vue` | `:1-72` | `inventory` | items 逗号分隔 + **mode（已移除）** + change |
| `StructureTriggerEditor.vue` | `:1-54` | `structure` | structure + radius |
| `XpTriggerEditor.vue` | `:1-49` | `xp` | level + total |
| `DimensionChangeTriggerEditor.vue` | `:1-48` | `dimension_change` | dimension + from_dimension |

### 2.2 缺口与错误

| 问题 | 证据 | 影响 |
|---|---|---|
| `death` 无专用编辑器 | `TriggerPanel.vue:300-390` 的 `v-if` 链无 `death` → 落 `DynamicForm` | 场景组（position+radius / corner1+corner2）语义无法表达；校验器有专门分支（`MOD:script/ScriptValidator.java:2118-2121`）说明 schema 表达不了 |
| `facing` 无专用编辑器 | 同上 | 四个角度是两对端点，pitch 需钳到 -90..90（`ScriptValidator.java:2114-2117`、`:2131-2136` 的 `exit_buffer` 警告） |
| `all_of` / `any` 无编辑器 | 同上 | `conditions.list` 完全无法编辑（见 06） |
| `inventory` 写 `mode` | `InventoryTriggerEditor.vue:21-24`、`:36-41` | 校验器明确报错「`.conditions.mode 已移除：多项判定用 any / all_of 组合器表达」（`ScriptValidator.java:2124-2127`）；运行时求值器根本不读 `mode`（`MOD:trigger/server/evaluator/Evaluators.java:355-390` 只用 `items` + `change`） |
| `inventory.items` 逗号分隔 | `InventoryTriggerEditor.vue:14-19` | 物品 id 里不含逗号，尚可用；但无法输入带空格的模式、无法逐条编辑/排序 |
| `SingleFieldTriggerEditor` 的 `fieldDef` 硬编码 | `:17-23` | 丢失 schema 的 `required`/`enumValues`；`item_on_interact` 的 `target_type` 因此另开组件 |
| `LocationTriggerEditor` 的 `isBox` 判定 | `:24` | `!!data.corner1` 决定模式；若只写了 `corner2` 会误判为点模式 |

## 3. 差异与提案

### 3.1 四种字段形态（按形态分工，而不是按类型）

| 形态 | 适用 | 组件 | 交互 |
|---|---|---|---|
| 单值 | 一个字符串/枚举/数字字段 | `SingleValueCondition.vue`（提案） | 由 schema 驱动：`RegistryStringField` / `EnumField` / `NumberField` |
| 几何 | 位置 + 半径 / 两角方体 / 朝向区间 / 注视 | `GeometryCondition.vue`（提案） | 子模式切换 + 坐标行 + 半径 |
| 列表 | `items` 数组、组合器 `list` | `StringListCondition.vue` / 组合器（06） | 逐条增删 + 拖排 |
| 无 | `login` | 现有 `NoConditionTriggerEditor` | 文案 |

理由：现有 10 个组件里，`SingleFieldTriggerEditor` + `fieldDef` 硬编码的问题会随类型增加放大；按「字段形态」而不是「类型」组织，27 类只需 4 个基础组件 + 一张映射表。

### 3.2 保留专用组件的判据

已有专用组件**不重写**，除非它写错字段：

- 保留：`Location`（几何较完整）、`EntityKill`（场景组）、`ItemOnInteract`、`Observation`、`Structure`、`Xp`、`DimensionChange`。
- 修正：`Inventory`（删 `mode`、`items` 改列表）。
- 新增：`Death`（场景组，无 entity）、`Facing`（两对角度）。

这样改动面最小，且不会把已经能用的编辑器推倒。

### 3.3 拟新建（提案）

- `ED:components/trigger/DeathTriggerEditor.vue`（提案）：维度 / 群系 / 位置+半径 / 方体；全部可空；提示「不写 = 任何死亡都触发」。
- `ED:components/trigger/FacingTriggerEditor.vue`（提案）：`yaw1/pitch1/yaw2/pitch2`；pitch 钳制 -90..90；提示「区间支持跨 ±180° 环绕；span=0 表示整圈」（依据 `Evaluators.java:513-527` + `MOD:trigger/shared/GeometryConditions.java` 的 `facingInRange`）。
- `ED:components/trigger/StringListCondition.vue`（提案）：字符串数组逐条编辑（`inventory.items`）。
- `ED:components/trigger/GeometryCondition.vue`（提案）：抽自 `LocationTriggerEditor` 的点/方体子模式，供 `death`/`entity_kill` 复用。

**不新建**：27 个类型各一个组件。也**不新建**「万能 JSON 编辑器」作为主路径（只作为兜底入口，见 08）。

## 4. 输入输出与字段约束

条件编辑器的统一契约：

| prop | 类型 | 约束 |
|---|---|---|
| `data` | `Record<string, unknown>` | 当前触发器的 `conditions`（只读引用；组件不得原地改） |
| `fields` | `Record<string, SchemaField>` | 来自 `schema.triggers.conditions[type]`；组件用它决定必填/枚举/默认 |
| `type` | `string` | 当前类型，用于适用性提示 |

| emit | 载荷 | 语义 |
|---|---|---|
| `update` | `(key, value)` | `value === undefined` → 删除该键（与 `TriggerPanel.updateCondition` 一致，`:108-116`） |
| `updateMany` | `patch` | 批量写；用于子模式切换时同时删旧键、加新键（`LocationTriggerEditor.vue:46-63` 已用） |

字段约束（按类型）：

| 类型 | 必填 | 可选 | 互斥 |
|---|---|---|---|
| `location` | 至少一个空间条件 | `dimension` | `position+radius` ⟂ `corner1+corner2`（写两套时求值器先判方体，`Evaluators.java:65-95`） |
| `entity_kill` | `entity` | 场景组 | 同 `location` |
| `death` | 无 | 场景组 | 同 `location`；无死因条件 |
| `facing` | 四个角度 | — | — |
| `observation` | `target` | `target_type`（`""`/`block`/`entity`）、`reach`（默认 4.5） | — |
| `inventory` | `items`（非空数组） | `change`（`""`/`increase`/`decrease`） | **不得写 `mode`** |
| `structure` | `structure` | `radius`（int，默认 0） | — |
| `item_on_interact` | `item`、`target` | `target_type` | — |
| `dimension_change` | `dimension` | `from_dimension` | — |
| `dimension` | `dimension` | — | — |
| `xp` | 至少 `level` 或 `total` | 另一个 | — |
| `gamestage` | `stage` | — | — |

## 5. 修改步骤

1. 新建 `StringListCondition.vue`；`InventoryTriggerEditor` 用它替换逗号分隔输入，**删除 `mode` 下拉**（`InventoryTriggerEditor.vue:21-24`、`:36-41`），并把 `change` 的「不限」写成删除键。
2. 新建 `GeometryCondition.vue`，从 `LocationTriggerEditor.vue:66-162` 抽出点/方体子模式；`LocationTriggerEditor` 改为薄壳；`isBox` 判定改为 `corner1 || corner2`。
3. 新建 `DeathTriggerEditor.vue`（复用 `GeometryCondition`）。
4. 新建 `FacingTriggerEditor.vue`。
5. `TriggerPanel.vue` 的 `v-if` 链增加 `death`/`facing` 分支；`SINGLE_FIELD_TYPES` 保持（`dimension`/`gamestage` 等）。
6. 各编辑器改为接收 `fields` prop，删除 `fieldDef` 硬编码（`SingleFieldTriggerEditor.vue:17-23`、`DimensionChangeTriggerEditor.vue:11-15`）。

## 6. 禁止修改

- 不得为 `inventory` 写 `mode`（已移除，校验器报错，运行时不读）。
- 不得为 `entity_kill` 写 `mode`（同上，`ScriptValidator.java:2124-2127`）。
- 不得把 `items` 写成字符串（必须是数组；`Evaluators.java:355-357` 要求 `isJsonArray`）。
- 不得为 `death` 造死因字段（运行时没有）。
- 不得给 `facing` 的 pitch 允许超出 -90..90。
- 不得在条件编辑器里改 `id`/`type`/`requires` 等非 `conditions` 字段。

## 7. 两分支承载

- Forge 1.20.1：求值器与 schema 在 common；前端共用。
- Fabric：同源，未实机验证。

## 8. 前置

- `03-trigger-type-catalog.md`（类型→编辑器映射）。
- `01-baseline-schema` 的 `triggers.conditions` 导出（已存在，`SchemaExporter.java:62-66`）。

## 9. 验收

**正例**

- `inventory`：可逐条添加 `minecraft:diamond`、`minecraft:emerald`；保存后 `conditions.items` 是数组；`script.validate` 无 `mode 已移除`。
- `inventory` + `change=increase`：保存后 `conditions.change = "increase"`；选「不限」时该键被删除（不是空串）。
- `death`：只填 `dimension` 时 `conditions = {dimension:"…"}`；切到「方体」后 `position/radius` 被删除、`corner1/corner2` 出现。
- `facing`：pitch 输入 120 被钳到 90 并提示。
- `location`：只写 `corner2` 时 UI 识别为方体模式（不再误判点模式）。

**反例**

- 保存后出现 `conditions.mode` → 失败。
- `items` 被写成 `"a, b"` 字符串 → 失败。
- `death` 出现 `entity` 字段 → 失败。
- `facing` 的 pitch 允许 120 → 失败。
- 编辑器原地修改 `props.data` → 失败（必须 emit）。

## 10. 真实冒烟

1. 建 `inventory` 触发器（`items:["minecraft:diamond"]`，`change=increase`），保存 → validate 0 issue。
2. 游戏内 reload，丢一颗钻石又捡起：`increase` 命中（首次采样基线为 false，第二次变化为 true）。
3. 建 `death` 触发器（`dimension=minecraft:the_nether`），在下界自杀：触发；主世界自杀：不触发。
4. 建 `facing` 触发器（yaw 160→-160，pitch -30→30），转到该朝向：触发。
5. 建 `location` 触发器（方体），走进去：触发。

## 11. 完成定义

- 27 类都有可用的条件编辑路径，`DynamicForm` 只作为未知类型的兜底。
- `inventory.mode` / `entity_kill.mode` 在 UI 中不存在，保存后不产生。
- 几何类（location/entity_kill/death）共用同一套点/方体子模式。
- 所有编辑器通过 emit 改数据，不原地修改。
