# 07-PointSourceForms：点源五形态表单

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：02-PropertyPathRegistry（`ref` 表达力缺口）、07-PositionEditor
> 下游：07-OrientationEditor（连线端点/注视目标复用本表单）、07-PathCollectionEditor（端点来源）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

`position_origin`、`facing_target`、`facing_entity`、`yaw_base_from`、`yaw_base_to`、`look_at_selector` 等字段在 schema 里是 `ref`（自由字符串），但运行时按**字符串前缀**分派五形态。本文件定义这五形态的受约束表单、载荷、实体取点百分比、偏移空间，以及"形态字符串 → 运行时解析"的精确对应。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| 形态判据只有一处：`@…`/`uuid:` → 选择器；`block:` → 方块；`player` → 玩家激活位置；`coordinate` → 固定坐标；其余非空 → 结构 id | `J:script/object/position/PointKinds.java — kindOf（38–45）` |
| 方块字符串解析：`block:id[:radius]`，裸 `id[:radius]` 也接受；最后一段全数字且 >0 才算半径；缺省 16 | `PointKinds.parseBlock（56–67）`、`DEFAULT_BLOCK_RADIUS（24）` |
| 空串/`null` = 无点源 | `kindOf（39–40）`、`PointSourceSpec.point（86–92）` |
| 位置原点空串按空间补缺省 | `PointSourceSpec.positionOrigin（60–72）` |
| 实体取点 = 包围盒百分比，0~100，越界钳制，NaN=50 | `EntityPoint.java（10–29）`、`EntityPoint.FOOT（13）`、`CENTER（16）` |
| 偏移有表达空间：world = `(dx,dy,dz)`；base = `(fwd,up,right)` | `PointOffset.java（10–35）` |
| 偏移空间是独立 step 字段（`*.offset.space`） | `TrackSchemas（151–152、189–190、207–208、238–239）` |
| 冻结开关按来源各一个（`position_origin_freeze`/`facing_target_freeze`/`look_at_freeze`/`yaw_base_from_freeze`/`yaw_base_to_freeze`）；`facing_entity` 没有冻结 | `TrackSchemas（131、153、191、209、240）`；`FacingSpec` 类注释（11–13） |
| 编辑器无形态下拉；`ref` 走注册表补全 | `EDITOR:src/components/fields/RegistryStringField.vue`；`FieldRenderer.vue（25–29）` |

### 2.2 目标

1. 五形态用下拉选择，**不提供自由文本**（结构 id 与选择器除外，见下）。
2. 载荷按形态显示：`coordinate` → x/y/z；`block` → id + 可选 radius；`selector` → 选择器文本；`structure` → 结构 id；`player` → 无载荷。
3. 实体取点百分比（`EntityPoint`）只在"实体形态 + 需要取点"的字段出现（`position_origin` 的实体取点固定为脚底 `FOOT`；`look_at` 的实体取点来自 `look_at_part.x/y/z`）。
4. 偏移空间下拉（`world`/`base`）与偏移三分量。
5. 拼错形态（如 `coordiante`）**不可能**由编辑器产生（下拉保证）。

### 2.3 非目标

- 不做实体/结构/方块的实时补全列表（注册表查询归 03/04；本文件只定义"用注册表补全"的入口）。
- 不做世界内拾取（飞控归 12/13）。
- 不改 `ref` 的 schema 类型。

## 三、方案

### 3.1 形态与载荷矩阵

| 形态（下拉项） | 写入 `ref` 字符串 | 额外载荷字段 | 说明 |
|---|---|---|---|
| 无（默认） | `""` | — | 位置原点：`world` 空间 → 玩家激活位置；`base` 空间 → 隐式 `@p`（`positionOrigin 63–68`） |
| `player` | `"player"` | — | 玩家激活位置（整场不变） |
| `coordinate` | `"coordinate"` | `*_x` / `*_y` / `*_z` | 固定世界坐标 |
| `block` | `"block:<id>[:radius]"` | 半径并入字符串 | 就近搜索的方块中心；缺省半径 16 |
| `selector` | `"@…"` 或 `"uuid:…"` | — | 实体选择器；实体取点固定 `FOOT`（位置原点）/ 由 `look_at_part` 给（注视） |
| `structure` | 结构 id（任意非空非上述前缀） | — | 结构 bounding box 中心 |

**顺序注意**：`selector` 必须以 `@` 或 `uuid:` 开头；`block` 必须以 `block:` 开头；`player`/`coordinate` 是**精确匹配**；其余一律当结构 id（`kindOf 38–45`）。因此：

- 结构 id 不能等于 `player`/`coordinate`，也不能以 `@`/`uuid:`/`block:` 开头。编辑器在结构 id 输入框里做这三条校验并给明确错误。
- `block` 的 id 可含冒号（如 `minecraft:obsidian`），半径解析取最后一段（`parseBlock 56–67`）。编辑器提供"id + 半径"两个输入，拼成字符串；半径留空 = 不写（用缺省 16）。

### 3.2 字段 → 载荷映射（逐字段）

| 字段 | 形态来源 | 载荷字段 | 取点 | 偏移 | 冻结 |
|---|---|---|---|---|---|
| `position_origin` | 本字段 | `position_origin_x/y/z` | 固定 `EntityPoint.FOOT`（`positionOrigin 67–68`） | 无（位置偏移由 `position.x/y/z` 承担，`PositionEvaluator.resolveSource 204–218` 不施加偏移） | `position_origin_freeze` |
| `facing_target` | 本字段 | `facing_target_x/y/z` | 固定 `EntityPoint.CENTER`（`ObjectCameraEvaluator.facingSpec 349`） | `facing_target_offset.x/y/z` + `.space` | `facing_target_freeze` |
| `facing_entity` | 本字段（选择器） | — | — | — | 无 |
| `yaw_base_from` / `yaw_base_to` | 本字段 | `*_x/y/z` | 固定 `FOOT`（`ObjectCameraEvaluator.pointSpec 381–386`） | `*_offset.x/y/z` + `.space` | `*_freeze` |
| `look_at` | **枚举**（`none/player/coordinate/entity/block`） | `look_at_selector`、`look_at_target_x/y/z`、`look_at_target_structure`、`look_at_target_block` | `look_at_part.x/y/z`（实体） | `look_at_offset.x/y/z` + `.space` | `look_at_freeze` |

**关键差异**：`look_at` 不是 `ref` 五形态，而是 `enum` 五值（`TrackSchemas 211–213`），且它的 `block` 载荷在 `look_at_target_block`、`structure` 载荷在 `look_at_target_structure`（`228–231`）。编辑器必须按 `look_at` 的枚举分支，而不是复用点源五形态。

`look_at` 的 `coordinate` 分支：若 `look_at_target_structure` 非空 → 取结构中心；否则取 `look_at_target_x/y/z`（`OrientationEvaluator.resolveLookAt 127–135`）。编辑器必须让二者互斥（填了结构就禁用坐标，反之亦然）。

### 3.3 实体取点百分比

| 用途 | 来源 | 默认 |
|---|---|---|
| 位置原点 | 固定 `FOOT` = (50, 0, 50) | 不可编辑 |
| 方向源目标 | 固定 `CENTER` = (50, 50, 50) | 不可编辑 |
| 连线端点 | 固定 `FOOT` | 不可编辑 |
| 注视点 | `look_at_part.x/y/z` | 50/50/50（`TrackSchemas 216–221`） |

注视点百分比控件：三轴 0~100，显示"脚底/中心"快捷按钮（0/50/100）。越界在运行时被钳制（`EntityPoint.clampPercent 24–29`），编辑器**拒绝**越界输入（不写出去让运行时钳制）。

### 3.4 偏移

| 字段组 | 分量 | 空间字段 | 说明 |
|---|---|---|---|
| `facing_target_offset` | `.x/.y/.z` | `.space`（`world`/`base`） | `base` 需要本帧参考系；`frame=null` 时偏移不生效（`PointOffset.apply 29–35`） |
| `yaw_base_from_offset` / `yaw_base_to_offset` | 同上 | 同上 | 同上 |
| `look_at_offset` | 同上 | 同上 | 同上 |

编辑器规则：

- `space=base` 时提示"偏移沿本帧参考系（fwd/up/right），参考系由 `facing_source` 决定"。
- `space=base` 且当前 `position_space=world` → 警告"本帧没有参考系，偏移不生效"（`PointOffset.apply 31`）。
- 三分量默认 0（`TrackSchemas 145–150` 等）。

### 3.5 冻结

| 字段 | 可用条件 | 语义 |
|---|---|---|
| `position_origin_freeze` | 原点形态是实体选择器（或空 + base） | 固定"含偏移世界点"，不是停时间（`PositionEvaluator 85–89`；`FreezeStore` 类注释 9–20） |
| `facing_target_freeze` | `position_space=base` 且方向源为 `line`（或 `auto` + 有 target） | 固定连线端点 |
| `look_at_freeze` | `look_at != none` | 固定注视点 |
| `yaw_base_from_freeze` / `yaw_base_to_freeze` | 对应端点是实体选择器 | 固定端点 |

**与校验器的偏差**（必须显示，不能隐瞒）：`ObjectValidator.checkFreezes（568–591）` 只在"会被读取"时才不告警；但求值层对**所有** kind 都应用冻结（`OrientationEvaluator.resolveLookAt 143–146` 对任意 kind；`PositionEvaluator.resolvePoint 231–242` 对任意来源）。因此：

- 编辑器按"可用条件"置灰（与 validator 一致），但**不删除**已写的开关。
- 若作者在不可用条件下写了开关，显示 `warn`（validator 同口径）+ 一句"运行时会应用，但校验器提示不读取；建议清除"。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `parsePointRef(value): {kind, payload}` | 形态字符串 | `{kind:'none'\|'player'\|'coordinate'\|'block'\|'selector'\|'structure', payload}` |
| `buildPointRef(kind, payload): string` | 形态 + 载荷 | 字符串（保证 `kindOf` 还原一致） |
| `validateStructureId(id): string \| null` | 结构 id | 错误或 null |

**往返不变式**：`parsePointRef(buildPointRef(k, p)).kind === k`，且 `payload` 等价。必须覆盖：结构 id = `player`（应被拒）、`@e[type=pig]`、`uuid:abc`、`block:minecraft:stone:8`、`coordinate`。

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/objects/PointSourceField.vue`（提案）：形态下拉 + 载荷区。
2. 新建 `EDITOR:src/model/pointRef.ts`（提案）：`parsePointRef` / `buildPointRef` / `validateStructureId`。
3. 新建 `EDITOR:src/components/objects/LookAtField.vue`（提案）：`look_at` 枚举分支 + 互斥载荷。
4. 改 `EDITOR:src/model/refBindings.ts`（06-PropertyValueForm §3.4）：把 §3.2 的字段映射进来；`position_origin`/`facing_target`/`yaw_base_from`/`yaw_base_to` 指向 `PointSourceField`；`facing_entity`/`yaw_base_selector` 用选择器文本（允许自由文本 + 补全）。
5. 改 `EDITOR:src/components/fields/RegistryStringField.vue`：保留作为"选择器补全"控件；不用于五形态字段。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/PointSourceField.java`（提案）。
2. 同 `parsePointRef`/`buildPointRef`；结构 id 校验同三条。

### 4.4 禁止修改

- 不给五形态字段自由文本。
- 不把 `look_at` 当 `ref` 五形态。
- 不把 `block` 的半径写成独立字段（运行时只认字符串）。
- 不删除"不可用条件下的冻结开关"。
- 不把 `EntityPoint` 百分比越界写出去。

## 五、正反例验收

### 5.1 正例

1. `position_origin` 选 `player` → 写 `"player"`；`kindOf` 得 `PLAYER`。
2. 选 `coordinate` 并填 `(10,64,-5)` → 写 `"coordinate"` + `position_origin_x/y/z`；`PositionSpec.relative` 拿到 `COORDINATE`。
3. 选 `block` 填 `minecraft:stone`、半径 `8` → 写 `"block:minecraft:stone:8"`；`parseBlock` 得 `(minecraft:stone, 8)`。
4. 选 `block` 只填 `minecraft:stone` → 写 `"block:minecraft:stone"`；半径缺省 16。
5. 选 `selector` 填 `@e[type=pig,limit=1]` → 写原串；`kindOf` 得 `SELECTOR`。
6. 选 `structure` 填 `village_plains` → 写原串；`kindOf` 得 `STRUCTURE`。
7. `look_at=entity` + `look_at_part=(50,90,50)` → 头部取点；`look_at=coordinate` + 结构 `village_plains` → 结构中心（坐标字段禁用）。
8. `facing_target_offset.space=base` 且 `position_space=base` → 偏移沿参考系。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| 结构 id 填 `player` | 拒绝（会被解析成玩家激活位置） |
| 结构 id 填 `@p` | 拒绝（会被解析成选择器） |
| 结构 id 填 `block:foo` | 拒绝（会被解析成方块） |
| 形态填 `coordiante`（拼错） | 不可能出现（下拉） |
| `look_at=coordinate` 同时填结构与非零坐标 | 编辑器互斥（填结构即禁用坐标） |
| `look_at=none` 但填了 `look_at_target_x` | 提示"不读取"（运行时不解析，`lookAtSpec 393–411` 的 default → null） |
| `EntityPoint` 输入 150 | 拒绝（运行时会钳到 100，编辑器不写越界） |
| `space=base` 但 `position_space=world` 的偏移 | 警告"无参考系，偏移不生效" |

### 5.3 异步关键帧专项

**正例**：`position_origin`（step）在 `t=2` 从 `@p` 改 `coordinate`，且 `position_origin_x/y/z` 有 `value`。`position.x/y/z` 在 `t=2` 有帧 → 提交成功；`script.validate` 通过。

**反例**：改 `position_origin` 但 `position.x/y/z` 在 `t=2` 缺帧 → 阻止（`checkSwitches` 把 `position_origin` 列在 `SPACE_SWITCH_FIELDS`）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；CAMERA 片段。
2. 原点设 `@p`、`position_origin_freeze=true`；播放：相机固定在激活时的玩家位置（冻结生效）。
3. 原点改 `block:minecraft:stone:16`；在附近放石头；播放：相机定位到石头中心。
4. 原点改 `coordinate (100,70,100)`；播放：相机在 (100,70,100)+偏移。
5. `look_at=entity` + `look_at_part` 头部；播放：相机看向实体头部。

通过判定：第 2 步相机不跟随玩家移动（冻结）；第 3/4 步位置正确；第 5 步视线指向头部（可对比脚底）。

## 七、完成定义

1. `PointSourceField.vue` / `LookAtField.vue` / `pointRef.ts` 存在。
2. 五形态字段无自由文本；`look_at` 用枚举分支。
3. 结构 id 三条校验生效；`block` 半径拼接正确。
4. §5 的 8 条正例、8 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同 `parsePointRef`/`buildPointRef` 往返不变式。
