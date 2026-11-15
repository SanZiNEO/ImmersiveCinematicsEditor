# 07-03 点源五形态

## 目标

把 schema 里以 `ref` 字符串表达的点源字段做成受约束表单，覆盖：

- `position_origin`
- `facing_target`
- `facing_entity`
- `yaw_base_from` / `yaw_base_to`
- `look_at_selector`
- `look_at` 的枚举分支与载荷

表单保证写出的字符串能被 `PointKinds.kindOf` 还原成同一种形态，作者不需要记前缀。

## 形态与字符串

| 形态 | 写入字符串 | 载荷 | 说明 |
|---|---|---|---|
| 无 | `""` | — | 位置原点：`world` = 玩家激活位置；`base` = 隐式 `@p` |
| `player` | `"player"` | — | 玩家激活位置，整场不变 |
| `coordinate` | `"coordinate"` | `*_x` / `*_y` / `*_z` | 固定世界坐标 |
| `block` | `"block:<id>[:radius]"` | id + 可选半径 | 就近搜索的方块中心；半径缺省 16 |
| `selector` | `"@…"` 或 `"uuid:…"` | — | 实体选择器 |
| `structure` | 结构 id | — | 结构 bounding box 中心 |

判据顺序：

1. `@` 或 `uuid:` → selector
2. `block:` → block
3. `player` 精确 → player
4. `coordinate` 精确 → coordinate
5. 其他非空 → structure

结构 id 不能是 `player` / `coordinate`，不能以 `@` / `uuid:` / `block:` 开头。编辑器在结构 id 输入框里直接拒绝这三类。

## 字段映射

| 字段 | 形态来源 | 载荷 | 取点 | 偏移 | 冻结 |
|---|---|---|---|---|---|
| `position_origin` | 本字段五形态 | `position_origin_x/y/z` | 固定 `FOOT` = (50,0,50) | 无；位置偏移由 `position.x/y/z` 承担 | `position_origin_freeze` |
| `facing_target` | 本字段五形态 | `facing_target_x/y/z` | 固定 `CENTER` = (50,50,50) | `facing_target_offset.x/y/z` + `.space` | `facing_target_freeze` |
| `facing_entity` | 只允许 selector | — | 身体朝向 | — | 无 |
| `yaw_base_from` / `yaw_base_to` | 本字段五形态 | `*_x/y/z` | 固定 `FOOT` | `*_offset.x/y/z` + `.space` | `*_freeze` |
| `look_at` | 枚举五值，不是五形态 ref | 分支载荷 | `look_at_part.x/y/z`（entity） | `look_at_offset.x/y/z` + `.space` | `look_at_freeze` |

`facing_entity` 只写选择器字符串；不提供 player/coordinate/block/structure 下拉。

## `look_at` 分支

`look_at` 是 `enum(none/player/coordinate/entity/block)`，不是 `ref` 五形态。编辑器按枚举显示载荷：

| `look_at` | 载荷 | 规则 |
|---|---|---|
| `none` | 无 | 其余载荷隐藏；已有值显示“不读取” |
| `player` | 无 | `look_at_selector` 运行时不参与 |
| `coordinate` | `look_at_target_x/y/z` 或 `look_at_target_structure` | 二选一；structure 非空时优先，坐标字段禁用 |
| `entity` | `look_at_selector` + `look_at_part.x/y/z` | part 0~100，默认 50/50/50 |
| `block` | `look_at_target_block` | 写 `block:<id>[:radius]` |

`look_at_target_x/y/z` 默认 `null`，运行期按 0 读；UI 显示“未写 = 0”。`look_at_part` 输入越界直接拒绝，不写出去让运行时钳制。

## 实体取点

| 用途 | 取点 | 可编辑 |
|---|---|---|
| 位置原点 | `FOOT` (50,0,50) | 否 |
| 方向目标 | `CENTER` (50,50,50) | 否 |
| Yaw 基准端点 | `FOOT` | 否 |
| 注视点 | `look_at_part.x/y/z` | 是，0~100 |

`look_at_part` 提供“脚底 / 中心 / 头顶”快捷值（0/50/100），也允许三轴逐项输入。

## 偏移

| 偏移组 | 分量 | 空间字段 | 提示 |
|---|---|---|---|
| `facing_target_offset` | x/y/z | `facing_target_offset.space` | `base` 时沿本帧 `fwd/up/right` |
| `yaw_base_from_offset` | x/y/z | `.space` | 同上 |
| `yaw_base_to_offset` | x/y/z | `.space` | 同上 |
| `look_at_offset` | x/y/z | `.space` | 同上 |

- 三分量默认 0。
- `space=base` 且当前 `position_space != base`：显示 `warn`“没有参考系，偏移不生效”；已有值保留。
- `space=base` 且参考系解析失败：显示 `warn`；不把偏移当成世界偏移。

## 冻结

| 字段 | 可用条件 | 语义 |
|---|---|---|
| `position_origin_freeze` | 原点是实体选择器，或原点为空且 `position_space=base` | 固定含偏移后的世界点 |
| `facing_target_freeze` | `position_space=base` 且 `facing_source=line`，或 `auto` 且有 `facing_target` | 固定连线端点 |
| `look_at_freeze` | `look_at=entity` | 固定注视实体上的取点 |
| `yaw_base_from_freeze` | `yaw_base_from` 是实体选择器 | 固定起点 |
| `yaw_base_to_freeze` | `yaw_base_to` 是实体选择器 | 固定终点 |

- 条件不满足时控件禁用；已有值显示 `warn`“不读取”，保留原文。
- `look_at_freeze` 不再对 `look_at != none` 全开；只在 `entity` 生效。
- `facing_source=entity` 需要 `facing_entity` 或选择器原点；玩家激活位置不是实体选择器，不作为 entity 基准。

## 自动方向源

`facing_source=auto` 时显示实际回落：

| 原点/载荷 | 回落 |
|---|---|
| 有 `facing_target`，无 `facing_entity` | `line` |
| 无 target，有 `facing_entity` | `entity` |
| 都没有，原点是选择器/玩家激活 | `entity` |
| 都没有，原点是坐标/方块/结构 | `world` |
| target 与 entity 同时非空 | block，禁止提交 |

UI 在 `auto` 行右侧显示“当前将按 line/entity/world 解析”，target/entity 同时非空时立即红框。

## 控件

```text
src/components/point/
  PointSourceField.vue       五形态下拉 + 载荷
  PointSelectorField.vue     选择器文本 + 注册表补全
  PointBlockField.vue        block id + 可选半径
  PointCoordinateField.vue   x/y/z
  LookAtField.vue            look_at 枚举 + 分支载荷
  EntityPointField.vue       0~100 三轴 + 快捷值
  PointOffsetField.vue       x/y/z + space
  FreezeToggle.vue           条件 + 禁用原因
src/model/point/
  pointRef.ts                parsePointRef / buildPointRef / validateStructureId
  pointPayload.ts            字段 → 载荷映射
  pointFreeze.ts             冻结可用条件
```

- `PointSourceField` 不把结构 id 当自由文本；结构输入有独立校验。
- `PointBlockField` 写字符串，不写独立 `radius` 字段。
- `LookAtField` 不复用五形态下拉；单独枚举分支。
- 所有字段的 `ref` 仍是字符串；不新增 schema 类型。

## 往返不变式

```ts
parsePointRef(buildPointRef(kind, payload)).kind === kind
```

必须覆盖：

- `player`
- `coordinate` + 坐标
- `block:minecraft:stone`、`block:minecraft:stone:8`
- `@e[type=pig,limit=1]`
- `uuid:abc`
- `village_plains`
- `""`

结构 id 反例：`player`、`coordinate`、`@p`、`uuid:abc`、`block:foo` 全部拒绝。

## 验收

1. `position_origin=player` → 写 `"player"`；`kindOf` 返回 PLAYER。
2. `position_origin=coordinate` + `(10,64,-5)` → 写 `"coordinate"` + 三轴；保存通过。
3. `position_origin=block` + `minecraft:stone` + 半径 8 → 写 `"block:minecraft:stone:8"`；留空半径写 `"block:minecraft:stone"`。
4. `position_origin=selector` + `@e[type=pig,limit=1]` → 原串写入；选择器补全可用。
5. `position_origin=structure` + `village_plains` → 原串写入；填 `player` 被拒。
6. `facing_source=line` + `facing_target=@p` + offset `(0,1,0)` + space `world` → 保存通过；运行时端点抬高 1。
7. `facing_source=auto` 且 target/entity 同时非空 → 红框阻止；清空一个后可提交。
8. `position_space=base`、`position_origin` 空、`position_origin_freeze=true` → 可用；切 `world` 后禁用并显示 `warn`。
9. `look_at=entity` + selector + part `(50,90,50)` → 头部取点；`look_at_freeze` 可用。
10. `look_at=coordinate` + structure `village_plains` → 坐标字段禁用；清空 structure 后坐标字段恢复。
11. `look_at=block` + `block:minecraft:stone:8` → 保存通过；block id 非法时本地拒绝。
12. `look_at=none` 但文档已有 `look_at_target_x` → 显示“不读取”，不删；保存校验给出对应 issue。
13. `yaw_base_from=@p`、`yaw_base_to=coordinate`：from 的 freeze 可用，to 的 freeze 禁用；两个端点各自显示。
14. 以上所有写入保存重开后字符串与载荷不变；没有把 `block` 半径写成独立字段。
