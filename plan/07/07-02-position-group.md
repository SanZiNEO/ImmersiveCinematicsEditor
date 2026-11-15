# 07-02 位置组

## 目标

把 CAMERA 片段的位置字段做成一组可编辑、可校验、可组合打帧的属性：

- `position.x` / `position.y` / `position.z`
- `position_mode` / `position_space`
- `position_origin` / `position_origin_x/y/z` / `position_origin_freeze`
- `facing_source` / `facing_target` / `facing_target_x/y/z` / `facing_target_offset.x/y/z` / `facing_target_offset.space` / `facing_target_freeze` / `facing_entity`

位置组按 06 双面板归属：没有关键帧的叶子在属性面板；已有关键帧的叶子在效果面板；`position.x/y/z` 的批量操作走 07-01 的 `position.xyz` 组合。

## 字段表

| 字段 | 形态 | 类型 | 插值 | 默认 | 组 |
|---|---|---|---|---|---|
| `position.x` | animated | float | linear | `0` | position |
| `position.y` | animated | float | linear | `0` | position |
| `position.z` | animated | float | linear | `0` | position |
| `position_mode` | animated | enum `relative/absolute` | step | `relative` | position |
| `position_space` | animated | enum `world/base` | step | `world` | position |
| `position_origin` | animated | ref | step | `""` | position |
| `position_origin_x` | animated | float | linear | `null`（运行期 0） | position |
| `position_origin_y` | animated | float | linear | `null`（运行期 0） | position |
| `position_origin_z` | animated | float | linear | `null`（运行期 0） | position |
| `position_origin_freeze` | animated | bool | step | `false` | position |
| `facing_source` | animated | enum `auto/world/entity/line` | step | `auto` | position |
| `facing_target` | animated | ref | step | `""` | position |
| `facing_target_x` | animated | float | linear | `null` | position |
| `facing_target_y` | animated | float | linear | `null` | position |
| `facing_target_z` | animated | float | linear | `null` | position |
| `facing_target_offset.x` | animated | float | linear | `0` | position |
| `facing_target_offset.y` | animated | float | linear | `0` | position |
| `facing_target_offset.z` | animated | float | linear | `0` | position |
| `facing_target_offset.space` | animated | enum `world/base` | step | `world` | position |
| `facing_target_freeze` | animated | bool | step | `false` | position |
| `facing_entity` | animated | ref | step | `""` | position |

字段来自 `TrackSchemas.cameraObjects()`；`group` 是 schema 分组标签，不是嵌套对象。

## 位置表达式

### `absolute`

```text
world = (position.x, position.y, position.z)
```

- `position_space` 必须 `world`。
- `position_origin` 必须为空；`position_origin_x/y/z`、`position_origin_freeze` 不参与。
- `facing_*` 不参与；`position_space=world` 时写这些字段，校验会报“不读取（已忽略）”。
- UI：`position_space` 锁定 `world`；原点控件禁用并显示“absolute 不使用原点”；已有原点/方向源时显示“将被忽略”，提供显式“清除”命令，不自动删。

### `relative + world`

```text
world = origin + (position.x, position.y, position.z)
```

- 原点是点源，五形态见 07-03。
- 空 `position_origin` = 玩家激活位置（整场不变）。
- `position_origin=coordinate` 时才有 `position_origin_x/y/z`；schema 默认 `null`，运行期读作 `0`。UI 显示“未写 = 0”，作者输入后写数值。
- `position_origin_freeze` 只在原点是实体选择器，或原点为空且 `position_space=base` 时被读取；`relative + world` 下空原点不读取。
- `facing_*` 不参与；UI 隐藏；已有字段显示“world 空间不读取”。

### `relative + base`

```text
world = origin + fwd * position.x + up * position.y + right * position.z
```

- `(x, y, z)` 读作 `(fwd, up, right)`，不是世界三轴。
- 空原点 = 隐式 `@p`；实体选择器原点可用 `position_origin_freeze`。
- `up` 固定世界竖直；`fwd/right` 来自 `facing_source` 的参考系。
- `facing_source=auto` 的回落：
  - 有 `facing_target` 且无 `facing_entity` → `line`
  - 无 target 有 `facing_entity` → `entity`
  - 都没有：原点是选择器/玩家激活 → `entity`；原点是坐标/方块/结构 → `world`
  - target 与 entity 同时非空 → block，不能提交。
- `facing_source=world`：参考系固定世界轴；target/entity 不读取。
- 参考系不可解析（实体不存在、line 水平退化、原点解析失败）时，该帧不产生位置结果；编辑器显示 `warn`，不用假的替代值预览。

## 组合规则

| 条件 | UI 行为 |
|---|---|
| `position_mode=absolute` | `position_space` 锁 `world`；原点、原点坐标、冻结、`facing_*` 禁用或隐藏 |
| `relative + world` | 原点可选；原点坐标仅 coordinate；冻结仅实体选择器；`facing_*` 隐藏 |
| `relative + base` | 原点、冻结、`facing_source`、按来源显示载荷 |
| `position_origin=coordinate` | 显示 `position_origin_x/y/z`；空值占位 0 |
| `position_origin` 其他形态 | 隐藏原点坐标；已写值显示“运行时不读取” |
| `position_origin_freeze=true` 且原点不是实体选择器/空+base | 行显示 `warn`；控件禁用；已有值保留 |
| `facing_source=auto` | target/entity 互斥；显示“自动将选择 line/entity/world” |
| `facing_source=entity` | 显示 `facing_entity`；原点是选择器时可留空回落原点；玩家激活位置不作为实体基准 |
| `facing_source=line` | 显示 `facing_target` + 坐标/偏移/冻结 |
| `facing_source=world` | target/entity 隐藏；已有值显示“不读取” |
| `facing_target_offset.space=base` 且当前不是 base | 显示 `warn`“无参考系，偏移不生效”；已有值保留 |

## 双面板归属

### 属性面板 `selection.properties`

- 位置组头显示“位置”，列出全部适用叶子。
- 静态字段：`position_mode`、`position_space`、`position_origin`、原点坐标、冻结、`facing_*`。
- `position.x/y/z` 无帧时显示值 + 时钟“添加首帧”。
- 已有关键帧的叶子不在属性面板重复显示；组头显示“N 项在效果面板”。
- 组头右侧“组合编辑”入口，默认组合 `position.xyz`。

### 效果面板 `clip.effects`

- 只列已有关键帧的叶子：`position.x/y/z`、有帧的 step 字段、有帧的 `facing_*`。
- 不显示“位置全字段组”；没有帧的 `position_mode`、`position_space`、`position_origin` 不进来。
- 每个叶子自己的关键帧组，共用效果面板局部标尺。
- `position.x/y/z` 三行各自有值控件、节点、帧数；不画三轴合并帧。

## 切换对齐

`ObjectValidator.checkSwitches()` 收集这些 step 字段的变化点：

```text
SPACE_SWITCH_FIELDS:
  position_mode
  position_space
  position_origin
  position_origin_freeze
  facing_source

BASE_SWITCH_FIELDS（只在 position_space=base 时）:
  facing_target
  facing_target_freeze
  facing_entity
  look_at_freeze
  yaw_base_from_freeze
  yaw_base_to_freeze
```

规则：

- `time <= 0` 的初始值不算变化，不要求三轴帧。
- `time > 0` 的 step 变化点要求 `position.x`、`position.y`、`position.z` 都有一条 `time` 完全相等（`==`，无容差）的关键帧。
- 缺帧时阻止提交；弹窗列出缺失轴，提供“补齐三轴并提交 / 取消”。
- “补齐三轴并提交”用当前有效值各建一帧，和 step 值在同一个 `commit`；一次撤销全回退。
- `BASE_SWITCH_FIELDS` 只在变化点 `position_space=base` 时检查；`position_space=world` 时即使字段变化也不要求三轴帧。
- `position.x/y/z` 的普通插帧不触发 step 对齐；但如果新帧落在某条 `paths[]` 的端点之间，07-05 的引用完整性会阻止或要求重绑。

## 组件

```text
src/plugins/core.selection-properties/...   属性面板接入
src/plugins/core.clip-effects/...           效果面板接入
src/components/position/
  PositionGroupHeader.vue
  PositionModeFields.vue
  PositionOriginFields.vue
  PositionAxesRows.vue
  PositionFacingFields.vue
  PositionSwitchDialog.vue
src/model/position/
  positionCombination.ts     组合可见性/禁用/警告
  switchImpact.ts            变化点/缺帧/补齐命令
  positionExpression.ts      表达式空间标签/轴语义
```

- `PositionGroupHeader` 同时被属性面板和效果面板使用；通过 `panelMembership` 决定显示哪些行。
- `PositionAxesRows` 不自己建节点组；复用 06 效果行和值控件。
- `PositionSwitchDialog` 只从 `switchImpact` 取缺失列表；不自己扫描帧。
- 配置扩展组来自 07-01；本模块不硬编码第二份组表。

## 验收

1. `relative + world + 原点空`：三轴可见；`facing_*` 隐藏；保存 `script.validate` 通过。
2. 切 `absolute`：`position_space` 锁 `world`，原点禁用；原点已有 `@p` 时显示“将被忽略”，点清除后才保存通过。
3. `relative + base + 原点 @p + facing_source=entity`：显示 `facing_entity`；填 `@e[type=pig,limit=1]` 保存通过。
4. `position_origin=coordinate`：显示 origin x/y/z；留空显示 0 占位；填 `(10,64,-5)` 保存后运行时位置正确。
5. `position_space` 在 `t=3` 从 `world` 切 `base`，三轴 `t=3` 已各有帧：直接提交。
6. 同一操作缺 `position.z@3`：弹窗列出 z；补齐后三轴都有帧；一次撤销回到切换前。
7. `t=0` 把 `position_mode` 改 `absolute`：不要求三轴帧；保存通过。
8. `relative + world` 文档里已有 `facing_source=entity`：显示“world 不读取”，保存校验报“已忽略”；不静默删字段。
9. 属性面板给 `position.y` 开时钟：y 进效果面板；x/z 无帧仍留属性面板；位置组头“1 项在效果面板”。
10. 效果面板关闭 `position.x` 动画：x 回属性面板；组头计数减一；一次撤销恢复。
11. `position.xyz` 组合在 `t=2.35` 建帧：三条独立帧，`time` 完全一致；不是组帧。
12. 主时间轴：仍只有片段/轨道/标记；没有位置行、三轴节点或路径端点。
