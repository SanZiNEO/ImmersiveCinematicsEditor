# 11-04 触发器条件树与 27 种条件

## 目标

把 `meta.triggers[].conditions` 做成可递归编辑的条件树，覆盖当前 27 种触发器类型，并把同一套摘要格式提供给行为页和脚本图悬停。

条件树不是普通字段表单：`all_of` / `any` 是组合器，子节点可以是触发器条件，也可以是脚本前置条件；编辑器必须递归，不能只按 `conditions` 的普通键值渲染。

## 顶层结构

```text
trigger:
  type: <27 种之一>
  conditions: <object>
```

- 叶子类型的 `conditions` 是字段对象；
- `all_of` / `any` 的 `conditions` 是 `{ "list": [ { "type", "conditions" }, ... ] }`；
- 组合器 `list` 必须非空，元素必须是对象且带非空字符串 `type`；
- 组合器最大嵌套 8 层（顶层组合器算第 1 层）；
- 组合器子项可以是：
  - 27 种触发器类型中的轮询类；
  - 27 种触发器类型中的事件类，但仅当该触发器声明了 `continuity.window > 0`；
  - 三种脚本前置条件：`script_played` / `script_started` / `script_completed`；
  - 另一个 `all_of` / `any`。

## 组合器子项与触发器 requires 的区别

- 触发器级 `requires` 是整条触发器之前的 AND 门；任一不满足，整条触发器不求值。
- 组合器里的 `script_played` 等是条件树内部的一个子条件，可以放进 `any` 表达“前置脚本满足 **或** 位置满足”。
- 两者字段形态不同：
  - `requires` 字符串 `"chapter1"` 等价 `script_played`；
  - 组合器子项必须写成 `{ "type": "script_played", "conditions": { "script": "chapter1" } }`。
- 编辑器不把组合器子项自动搬到 `requires`，也不把 `requires` 自动搬进条件树。

## 27 种类型

顺序与代码一致，下拉不重排：

| # | type | conditions 字段 | 摘要格式 |
|---|---|---|---|
| 1 | `login` | 无 | 玩家登录 |
| 2 | `location` | `dimension`、`position`+`radius`、`corner1`+`corner2` | 位于 `<dimension>` · 球形/方体 |
| 3 | `advancement` | `advancement` 必填 | 进度 = `id` |
| 4 | `biome` | `biome` 必填 | 生物群系 = `id` |
| 5 | `entity_kill` | `entity` 必填，`dimension`/`biome`/区域可选 | 击杀 `entity`，场景 … |
| 6 | `death` | `dimension`/`biome`/区域全可选 | 玩家死亡，场景 … |
| 7 | `entity_interact` | `target` 必填 | 与实体 `target` 交互 |
| 8 | `block_interact` | `target` 必填 | 与方块 `target` 交互 |
| 9 | `item_on_interact` | `item` 必填，`target` 必填，`target_type` 可省 | 手持 `item` 与 `target` 交互 |
| 10 | `dimension_change` | `dimension` 必填，`from_dimension` 可省 | 从 `from` 进入 `dimension` |
| 11 | `item_craft` | `item` 必填 | 合成 `item` |
| 12 | `item_use` | `item` 必填 | 使用 `item` |
| 13 | `item_consume` | `item` 必填 | 消耗 `item` |
| 14 | `item_release` | `item` 必填 | 松开 `item` |
| 15 | `item_instant_use` | `item` 必填 | 瞬间使用 `item` |
| 16 | `item_use_interrupt` | `item` 必填 | 中断使用 `item` |
| 17 | `item_pickup` | `item` 必填 | 捡起 `item` |
| 18 | `item_drop` | `item` 必填 | 丢弃 `item` |
| 19 | `xp` | `level` / `total` 至少一个 | 等级 ≥ `level` / 总经验 ≥ `total` |
| 20 | `dimension` | `dimension` 必填 | 当前维度 = `id` |
| 21 | `observation` | `target` 必填，`target_type` 可省，`reach` 缺省 4.5 | 注视 `target`，距离 ≤ `reach` |
| 22 | `inventory` | `items` 必填非空，`change` 可省 | 背包拥有全部/任一变化 |
| 23 | `structure` | `structure` 必填，`radius` 缺省 0 | 位于结构 `id`，半径 `r` |
| 24 | `gamestage` | `stage` 必填 | 阶段 = `stage` |
| 25 | `facing` | `yaw1`/`pitch1`/`yaw2`/`pitch2` 全必填 | yaw/pitch 区间 |
| 26 | `all_of` | `list` 必填非空 | 全部满足 |
| 27 | `any` | `list` 必填非空 | 任一满足 |

## 叶子字段控件

### 区域编辑器

`location`、`entity_kill`、`death` 共用区域编辑器；`structure` 只用结构 id + 半径，不用区域编辑器。

区域编辑器支持：

- 无区域：只写 `dimension` / `biome` 等场景字段；
- 球形：`position` 的 x/y/z + `radius`；
- 方体：`corner1` / `corner2` 的 x/y/z；
- 可选“再加一种区域”：同时写球形和方体，运行时按“方体命中或球形命中”，界面明确显示 OR。

约束：

- `position` / `corner1` / `corner2` 必须是完整 x/y/z；缺分量显示“条件永不满足”。
- `radius` 数值，球形缺省 0；负数/非有限报错。
- `corner1` / `corner2` 各轴自动 min/max 归一，不要求作者按顺序填。
- 已有两种区域同时存在时不静默删，显示“方体或球形”双区域。

### 物品模式

`entity_kill.entity`、`entity_interact.target`、`block_interact.target`、`item_on_interact.item/target`、`observation.target`、`inventory.items` 支持 id 通配：

- `*` = 全匹配；
- `ns:*` = 命名空间前缀；
- 不含 `:` = 子串包含；
- 其余 = 全等。

界面给“支持通配”提示，不把通配符判为非法。

### `inventory`

- `items` 是非空字符串数组；每行一个物品模式。
- `change` 为空：presence 语义，要求背包同时拥有 `items` 里**全部**模式。
- `change=increase` / `decrease`：净变化语义，任一模式数量发生对应变化即为真。
- “拥有其中任意一件”必须用 `any` + 多个单值子条件，不能用空 `change` 的 `items` 列表冒充 OR。
- 变化判定有采样基线；编辑器只写字段，不显示“上次采样”。

### `xp`

- `level` / `total` 都可省，但至少写一个；两个都空表示永不满足。
- 数值为整数；界面不自动补 0。
- 摘要：两个都有时显示“等级 ≥ x 且总经验 ≥ y”。

### `facing`

- 四个角度全部必填。
- `pitch` 端点限制 -90~90；超出显示“永不满足”。
- `yaw` 起止相同表示整圈，不限制朝向；界面给提示。
- 摘要用“yaw a→b，pitch c→d”，不画 3D 朝向。

### `observation`

- `target` 必填；`target_type` 空 = 方块和实体都查，`block` / `entity` 限定。
- `reach` 缺省 4.5；负数/非有限报错。
- 摘要显示“注视 target，距离 ≤ reach”。

### `structure`

- `structure` 必填；`radius` 整数，缺省 0。
- 语义是“玩家所在位置附近有该结构”，不是“玩家在结构内部”。
- 摘要显示“结构 id，半径 r”。

## 组合器编辑器

### 结构

```text
all_of
  list:
    1. { type: "location", conditions: { ... } }
    2. { type: "script_played", conditions: { script: "chapter1" } }
    3. any
         list:
           1. { type: "biome", conditions: { biome: "minecraft:taiga" } }
           2. { type: "gamestage", conditions: { stage: "chapter2" } }
```

### 交互

- 根节点是当前触发器的 `type` + `conditions`。
- 组合器节点显示“全部满足 / 任一满足”，子项按列表顺序排列。
- 子项可新增、复制、删除、上下移动；移动只改 `list` 顺序，不改字段。
- 子项是组合器时可继续展开；到第 8 层后“新增子项”禁用。
- 子项类型选择器分两组：
  - 触发器条件（27 种，事件类受 `window` 限制）；
  - 脚本前置（三种，字段只有 `script`）。
- 组合器内事件类子条件：只有当前触发器 `continuity.window > 0` 才允许；否则禁用并提示“事件类子条件需要事件窗口”。
- 空 `list`、未知 type、缺少 `conditions` 对象都显示错误，不静默改成 false。
- 组合器不提供“全部取反”或“排除”语义；当前格式没有 not。

## 摘要格式

行为页列表、详情折叠摘要、脚本图悬停共用同一套摘要：

- `login`：玩家登录
- `location`：位于 `<dimension>` · 球形 `(x,y,z) r=r` / 方体 `(x1,y1,z1)–(x2,y2,z2)`
- `advancement`：进度 = `id`
- `biome`：生物群系 = `id`
- `entity_kill`：击杀 `entity`，场景：`dimension / biome / 区域`
- `death`：玩家死亡，场景：`dimension / biome / 区域`
- `entity_interact`：与实体 `target` 交互
- `block_interact`：与方块 `target` 交互
- `item_on_interact`：手持 `item` 与 `target` 交互（`block/entity/两者`）
- `dimension_change`：从 `from` 进入 `dimension`
- `item_craft`：合成 `item`
- `item_use`：使用 `item`
- `item_consume`：消耗 `item`
- `item_release`：松开 `item`
- `item_instant_use`：瞬间使用 `item`
- `item_use_interrupt`：中断使用 `item`
- `item_pickup`：捡起 `item`
- `item_drop`：丢弃 `item`
- `xp`：等级 ≥ `level` / 总经验 ≥ `total`
- `dimension`：当前维度 = `id`
- `observation`：注视 `target`，距离 ≤ `reach`
- `inventory`：拥有全部 `items` / 任一数量 `increase/decrease`
- `structure`：结构 `id`，半径 `r`
- `gamestage`：阶段 = `stage`
- `facing`：yaw `a→b`，pitch `c→d`
- `all_of`：全部满足 + 子项缩进
- `any`：任一满足 + 子项缩进

格式化规则：

- 长 id 不截断；摘要换行，悬停卡滚动。
- 空字段不编默认值；该字段省略。
- 未知 type 显示 `未知条件 type` + 原始键值，只读。
- 未登记字段显示“未登记字段，只读”，不删除。

## 校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `type` 缺失/未知 | block | 节点红框 |
| 必填字段缺失 | block | 字段行红框 |
| 字段类型错误 | block | 不写非法值 |
| `position`/角点缺 x/y/z | error | “条件永不满足” |
| 区域半径负数/非有限 | block | 拒绝提交 |
| `inventory.items` 空数组 | block | 拒绝提交 |
| `inventory.items` 非字符串 | block | 行红框 |
| `xp` 两个都空 | block | “永不满足” |
| `facing` 缺角度 / pitch 越界 | block/error | 行红框；越界提示永不满足 |
| `observation.reach<0` | block | 拒绝提交 |
| 组合器 `list` 缺失/非数组/空 | block | 节点红框 |
| 组合器子项缺 type/conditions | block | 子项红框 |
| 组合器超过 8 层 | block | 第 8 层禁用新增 |
| 事件类子条件 + `window=0` | block | 禁止添加；已有红框 |
| 未登记字段 | info | 只读块，不删除 |

## 验收标准

1. 27 种类型都能建；下拉顺序与代码一致。
2. `login` 条件为空也能保存；详情显示“无场景条件”。
3. `location` 球形、方体、仅维度三种形态都能编辑；同时两种区域显示 OR。
4. `location` 区域缺 y 分量：显示“永不满足”，不保存为合法。
5. `entity_kill` 场景字段：dimension/biome/区域可组合，摘要完整。
6. `item_on_interact` 的 `target_type` 空/block/entity 三态正确。
7. `inventory` 空 `change` 显示“拥有全部”；`increase/decrease` 显示“任一变化”。
8. `xp` 只填 level 或只填 total 都能保存；两个都空报错。
9. `facing` 起止 yaw 相同显示“整圈”；pitch 越界报“永不满足”。
10. `all_of` 嵌套 `any` 三层：缩进、摘要、求值顺序正确。
11. 组合器子项添加 `script_played`：写入 `{type, conditions:{script}}`，不写成字符串。
12. 组合器第 8 层：新增禁用；第 9 层旧数据报错。
13. 事件类子条件在 `window=0`：禁用添加；强行写入显示红框。
14. 未知 type / 未登记字段：显示原文只读，不静默删。
15. 脚本图悬停与行为页对同一条件树生成同一摘要。
