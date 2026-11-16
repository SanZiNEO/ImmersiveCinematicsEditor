# 02-05 triggers 字段表

## 目标

登记 `triggers` 段：27 种触发器类型、每种的 `conditions` 字段表、`meta.triggers[]` 条目的 10 个字段（含 `triggerFields` 的 `id` / `continuity`），以及源码里的跨字段约束。来源：`TriggerSchemas`（23–53）；`ScriptParser.parseTriggerDefinition`（919–936）；`ScriptValidator.validateConditionsBySchema`（2292–2344）。

## 27 种触发器与 conditions 字段

| 类型 | conditions 字段 |
|---|---|
| `login` | 无 |
| `location` | `dimension` / `position` / `radius` / `corner1` / `corner2` |
| `advancement` | `advancement` |
| `biome` | `biome` |
| `entity_kill` | `entity` / `dimension` / `biome` / `position` / `radius` / `corner1` / `corner2` |
| `death` | `dimension` / `biome` / `position` / `radius` / `corner1` / `corner2` |
| `entity_interact` | `target` |
| `block_interact` | `target` |
| `item_on_interact` | `item` / `target` / `target_type`（enum） |
| `dimension_change` | `dimension` / `from_dimension` |
| `item_craft` | `item` |
| `item_use` | `item` |
| `item_consume` | `item` |
| `item_release` | `item` |
| `item_instant_use` | `item` |
| `item_use_interrupt` | `item` |
| `item_pickup` | `item` |
| `item_drop` | `item` |
| `xp` | `level` / `total` |
| `dimension` | `dimension` |
| `observation` | `target` / `target_type` / `reach` |
| `inventory` | `items` / `change` |
| `structure` | `structure` / `radius` |
| `gamestage` | `stage` |
| `facing` | `yaw1` / `pitch1` / `yaw2` / `pitch2` |
| `all_of` | 无（组合子，内部递归子条件） |
| `any` | 无（组合子，内部递归子条件） |

字段类型按源码逐条登记：字符串、布尔、映射、数组、int32、有限 float、枚举。目录里不把 `position` 写成 `Vec3`，位置按触发器自己的 `position` 结构登记（`{x,y,z}` 或 `{x,z}`，以 `TriggerSchemas` 为准）。

## `meta.triggers[]` 条目字段（10 项运行时字段；目录只登记 2 项）

下表是 `ScriptParser.parseTriggerDefinition` 接受的 10 个运行时字段；02 目录的 `triggerFields` 只登记 `id` + `continuity`（与 `SchemaExporter` 的 `triggerFields` 同口径），其余 8 项由解析器直接读，不复制到目录。

| 字段 | type | default | required | 说明 |
|---|---|---|---|---|
| `type` | string | — | true | 27 种之一，或第三方注册类型 |
| `id` | string | null | false | 匹配 `[A-Za-z0-9_]{1,64}`；脚本内唯一；缺省 = `type#下标` |
| `conditions` | object | `{}` | false | 该类型的 conditions 表 |
| `repeatable` | bool | `false` | false | 可重复触发 |
| `delay` | float | `0` | false | 延迟秒 |
| `on_enter` | bool | `false` | false | 进入时触发 |
| `exit_buffer` | float | `0` | false | 退出缓冲秒 |
| `requires` | array | `[]` | false | 前置条件，AND 语义 |
| `poll_interval` | int | null | false | 1~600 tick；null = 回退下一级 |
| `continuity` | object | null | false | `sweep` / `dwell` / `window` |

`requires` 元素两种写法：

- 字符串：前置脚本 id，等价于 `{"type":"script_played","script":"<id>"}`。
- 对象：`{"type":"...", "data":{...}}`；内置类型由 `PrerequisiteRegistry` 注册，第三方可注册自己的类型。

校验器检查：`requires` 必须是数组；字符串元素非空；引用的脚本 id 必须存在；未知前置类型按注册表口径处理（未注册 → issue）。空数组 = 无前置。

`delay` / `on_enter` / `exit_buffer` 按 `optFloat` / `optBool` 解析；类型不合法 → 解析器按默认值处理。`repeatable` 默认 `false`。

## `triggerFields`（`id` / `continuity` 细则）

| 字段 | type | default | required | 说明 |
|---|---|---|---|---|
| `id` | string | null | false | 匹配 `TriggerDefinition.ID_REGEX`；脚本内唯一 |
| `continuity` | object | null | false | 连续性策略，含 3 个子字段 |

`continuity` 子字段：

| 子字段 | type | default | 范围 | 适用 |
|---|---|---|---|---|
| `sweep` | bool | `false` | — | 只 `location` / `structure` / `facing` / `observation` |
| `dwell` | int | `0` | `0 ~ 1200` tick（`ContinuitySpec.MAX_TICKS`） | 只轮询类触发器 |
| `window` | int | `0` | `0 ~ 1200` tick（`ContinuitySpec.MAX_TICKS`） | 只 `all_of` / `any` |

`sweep` 用在非适用类型 → 报错；`dwell` 用在非轮询类型 → 报错；`window` 用在非组合子 → 报错。

## 跨字段 / 场景约束

- **位置区域是运行时 OR 语义**：`Evaluators.evaluateLocation`（`Evaluators.java:63-88`）先判 `corner1 + corner2`（方体），再判 `position + radius`（球），命中任一即触发；只写 `dimension` 也合法。02 目录不登记这条跨字段约束，也不把它写成声明自检。
- **`corner1` / `corner2` 成对**：只给一个 → 报错。
- **`dimension_change`**：`dimension` 必填（`TriggerSchemas.java:168`），`from_dimension` 可选、缺省 `""`（`:169`）。
- **`all_of` / `any`**：`conditions` 表为空，但组合子内部必须有子条件；空组合子 → 报错。
- **`item_on_interact` / `observation` 的 `target_type`**：必须在 `TriggerSchemas` 给出的枚举内。

## 未知字段策略

- 触发器里出现 `TriggerSchemas` 未登记的字段：**静默保留**，不报错、不删除（向前兼容）。
- 但已知字段的类型/枚举/范围必须严格检查；不能因为「未知字段静默」就把已知字段也放过。
- 未知触发器类型：文档仍打开，该触发器标「当前 schema 不认识」，不解释、不删。

## 验收标准

- 27 种类型逐条可查；`trigger('login')` 的 conditions 为空，`trigger('location')` 含 `dimension/position/radius/corner1/corner2`。
- `meta.triggers[0]` 的 10 个条目字段齐全；缺 `type` → 解析错误；`type` 拼错 → 校验器报未知类型。
- `requires` 字符串写法等价于 `script_played`；引用不存在的脚本 id → issue；非数组 → 解析错误。
- `poll_interval:0` / `601` / `2.5`：解析器告警 + null，校验器报 issue；`meta.trigger_poll_interval` 同口径。
- `repeatable` 缺省为 `false`；`delay` / `on_enter` / `exit_buffer` 缺省为 `0` / `false` / `0`。
- `location` 同时写 `position+radius` 和 `corner1+corner2`：运行时先判方体、再判球，两套都保留；只写 `corner1`：运行时按剩余条件判定，解析器与校验器都不阻断。
- `continuity.sweep` 用在 `item_use` → 报错；`window` 用在 `location` → 报错；`dwell` 超出 `1200` → 报错。
- 触发器多一个 `x_custom` 字段：保留、不报错；已知字段类型错（如 `radius:"5"`）仍报错。
- `all_of` / `any` 空组合子 → 报错。
- 目录里 `position` 不是 `Vec3`，没有引入 MC 类。
