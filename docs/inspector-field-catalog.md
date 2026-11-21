# Inspector 字段事实目录

> 本文件是由 `buildCatalog()` 运行时输出直接导出的**事实清单**，用于回答「有哪些字段、路径是什么、类型/模式/枚举/范围/依赖是什么」。它不描述右侧面板的现有 UI，也不替任何方案做分组；`section` 只作为 schema 索引。

- 源码范围：`src/core/schema/index.ts` 的 `buildCatalog`，以及它引用的 `catalog/{meta,tracks,screenLayers,scriptStructure,models,curveTypes}.ts`。
- 汇编入口：[buildCatalog](../src/core/schema/index.ts#L383)；字段形状：[FieldEntry](../src/core/schema/types.ts#L44)。
- 取数方式：用 `node --experimental-strip-types --input-type=module` 导入 `buildCatalog` 并序列化（见文末「核对」）。不是从 UI 或旧文档推断。
- 明确排除：`triggers` 目录（`catalog/triggers.ts`）与 `discovered` 第三方登记不属于本清单的六段；它们存在，但不在本文件逐条展开。

计数口径：轨道对象叶子 **342**；`meta` **23**；共用 `playControl` **5**（被 7 轨引用同一份声明）；固定屏幕层 **15**；`models` **11** 类型；`curveTypes` **11** 类型；`scriptStructure` **13 段 / 50 字段**。

## 0. 核对总账

| 轨道 | objects | A（animated） | V（value） | E（event） | 必填 | 含枚举 | 含范围 | requires | appliesTo | nullable |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `CAMERA` | 218 | 185 | 33 | 0 | 0 | 31 | 61 | 2 | 0 | 2 |
| `LETTERBOX` | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| `AUDIO` | 13 | 4 | 9 | 0 | 1 | 4 | 2 | 0 | 0 | 0 |
| `EVENT` | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `MOD_EVENT` | 3 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `OVERLAY` | 32 | 24 | 8 | 0 | 1 | 3 | 5 | 0 | 20 | 0 |
| `ADJUST` | 72 | 59 | 13 | 0 | 0 | 1 | 60 | 0 | 0 | 0 |
| **合计** | 342 | 274 | 66 | 2 | 2 | 39 | 130 | 2 | 20 | 2 |

`A` = `mode: animated`，`V` = `mode: value`，`E` = `mode: event`；后缀是 `interp` 原值。342 的逐轨加总：218 + 2 + 13 + 2 + 3 + 32 + 72 = 342。

| 轨道 | 类型分布（`type=count`） |
|---|---|
| `CAMERA` | `float`=140, `enum`=31, `struct`=19, `bool`=15, `ref`=7, `string`=3, `nullable_float`=2, `int`=1 |
| `LETTERBOX` | `float`=2 |
| `AUDIO` | `float`=7, `enum`=4, `string`=1, `bool`=1 |
| `EVENT` | `event_record`=1, `string`=1 |
| `MOD_EVENT` | `event_record`=1, `string`=1, `struct`=1 |
| `OVERLAY` | `float`=24, `enum`=3, `string`=3, `struct`=1, `int`=1 |
| `ADJUST` | `float`=60, `struct`=10, `string`=1, `enum`=1 |

## 1. 键、模式与读法

- **路径就是 `FieldEntry.key`。** 轨道对象的 `id` 固定为 `track.<TRACK>.object.<key>`；例如 `position.x` 的 id 是 `track.CAMERA.object.position.x`。
- 轨道对象是**扁平叶子列表**：`facing_target_offset.space`、`source.w`、`color.r` 各自是一个独立 `FieldEntry`，不是嵌套树节点。
- `scope`：轨道对象为 `[<TRACK>]`；`meta` 为 `[]`；`playControl` 为 `[]`（7 轨共用同一份声明，id 为 `track.playControl.<key>`，不带轨道名）。
- `mode` 是 schema 能力，不是当前 UI 状态：`animated` 表示该路径可承载关键帧；`value` 表示静态值；`event` 表示事件记录。**本文件不据此判断面板是否已提供控件。**
- `interp` 是构造期归一化结果：`none`（value/event）、`linear`、`angle`、`geometric`、`step`。
- `必` = `FieldEntry.required` 原值；它为 ✓ 不等于 UI 必须渲染，也不排除运行时另有条件必填。
- `—` = `hasDefault: false`；本目录中这些条目的 `default` 均为 `null`。字符串空值显示为 `` `""` ``，默认对象/数组按 JSON 显示。
- `enumValues` 是封闭集合；`min`/`max` 是 schema 声明的限值；`requires` 是同一轨内的可用性条件（由 `indexCatalog().availability()` 解析）；`appliesTo` 是枚举关联元数据，**不参与 `availability()` 的 requires 判定**。
- `struct` / `object` / `array` / `event_record` 在本目录内是**不透明类型**：目录不递归描述其载荷。相关模型、曲线、规则定义见各自独立章节，不能把本表当成递归 schema。

| 源码段 | 位置 |
|---|---|
| meta 23 | [meta.ts:15](../src/core/schema/catalog/meta.ts#L15) |
| screenLayers 15 + 动态规则 | [screenLayers.ts:14](../src/core/schema/catalog/screenLayers.ts#L14) / [:32](../src/core/schema/catalog/screenLayers.ts#L32) |
| playControl 5 | [tracks.ts:29](../src/core/schema/catalog/tracks.ts#L29) |
| track objects 342 | [tracks.ts:271](../src/core/schema/catalog/tracks.ts#L271) 起（各 `*Objects()`） |
| models 11 | [models.ts:30](../src/core/schema/catalog/models.ts#L30) / [:45](../src/core/schema/catalog/models.ts#L45) |
| curveTypes 11 | [curveTypes.ts:33](../src/core/schema/catalog/curveTypes.ts#L33) / [:63](../src/core/schema/catalog/curveTypes.ts#L63) |
| scriptStructure 13 段 / 50 字段 | [scriptStructure.ts:58](../src/core/schema/catalog/scriptStructure.ts#L58) |

## 2. meta（23）

来源 [meta.ts:15](../src/core/schema/catalog/meta.ts#L15)。21 条 `MetaSchemas.all()` 声明加 2 条解析期键 `triggers`、`trigger_poll_interval`；`section` 原样为 `info` / `runtime` / `parse-only`。

| key | 类型 | 必 | 默认 | 约束 / 枚举 | section | 说明 |
|---|---|:--:|---|---|---|---|
| `id` | `string` | ✓ | `untitled` |   | `info` |   |
| `name` | `string` | ✓ | `Untitled` |   | `info` |   |
| `author` | `string` |   | `""` |   | `info` |   |
| `description` | `string` |   | `""` |   | `info` |   |
| `dimension` | `string` |   | `""` |   | `info` |   |
| `base_resolution` | `object` |   | — |   | `info` | 编辑基准分辨率 {w, h}（像素，正整数）；缺省 null = 1920×1080 |
| `listener` | `enum` |   | `player` | `enum: player / camera` | `runtime` |   |
| `block_keyboard` | `bool` |   | `true` |   | `runtime` |   |
| `block_mouse` | `bool` |   | `true` |   | `runtime` |   |
| `block_mob_ai` | `bool` |   | `false` |   | `runtime` |   |
| `pause_when_game_paused` | `bool` |   | `true` |   | `runtime` |   |
| `interruptible` | `bool` |   | `true` |   | `runtime` |   |
| `play_mode` | `enum` |   | `parallel` | `enum: parallel / exclusive / interruptible` | `runtime` | 跨脚本播放关系（三态，缺省 parallel = 现状）；同脚本再触发的替换语义看 interruptible |
| `skippable` | `bool` |   | `true` |   | `runtime` |   |
| `hold_at_end` | `bool` |   | `false` |   | `runtime` |   |
| `macro_loop` | `bool` |   | `false` |   | `runtime` |   |
| `macro_loop_count` | `int` |   | `-1` |   | `runtime` |   |
| `macro_loop_mode` | `enum` |   | `repeat` | `enum: repeat / pingpong` | `runtime` |   |
| `screen_layers` | `object` |   | — |   | `runtime` | 画面层唯一入口：15 个规范层名 + 动态层名；值 = 显示（true 显示 / false 隐藏） |
| `priority` | `int` |   | `0` |   | `runtime` |   |
| `skip_vote_ratio` | `int` |   | — | `range: [10, 100]` | `runtime` | 整数百分比 10~100；不允许 0；非法值解析期报错 |
| `triggers` | `array` |   | `[]` |   | `parse-only` |   |
| `trigger_poll_interval` | `int` |   | — | `range: [1, 600]` | `parse-only` | 脚本级轮询间隔（tick），1~600；缺省由触发器级 / 类型级默认决定 |

- `base_resolution` 与 `screen_layers` 是 `object`，目录不展开其内部键；前者见字段自带说明（`{w,h}`，缺省 `null` = 1920×1080），后者见第 3 节。
- `triggers`（array，默认 `[]`）与 `trigger_poll_interval`（int，1~600）位于 `parse-only`，是解析期键；它们不是运行时播放设置。
- `skip_vote_ratio` 只有 `min: 10` / `max: 100`，没有默认值；`base_resolution` 也没有默认值。
- 23 条中只有 `id`、`name` 两条 `required: true`；其余 21 条均为非必填（以表中 `必` 列为准）。

## 3. screenLayers（15 固定 + 动态键）

来源 [screenLayers.ts:14](../src/core/schema/catalog/screenLayers.ts#L14) 与 [screenLayers.ts:32](../src/core/schema/catalog/screenLayers.ts#L32)。`valueType` 固定为 `bool`，`dynamic: true`；它是 `meta.screen_layers` 的唯一入口，不是 `tracks` 字段。

| 固定层名 | Space |
|---|---|
| `hud.hotbar` | `HUD` |
| `hud.crosshair` | `HUD` |
| `hud.health` | `HUD` |
| `hud.experience` | `HUD` |
| `hud.bossbar` | `HUD` |
| `hud.chat` | `HUD` |
| `hud.scoreboard` | `HUD` |
| `hud.action_bar` | `HUD` |
| `hud.title` | `HUD` |
| `hud.subtitle` | `HUD` |
| `hud.skip_prompt` | `HUD` |
| `viewmodel` | `WORLD` |
| `view_bobbing` | `VIEW` |
| `screen_effects` | `POST` |
| `player_model` | `WORLD` |

- 值语义：`true` 显示 / `false` 隐藏；**未声明的键一律隐藏**（画面层接管是唯一模式）。
- 动态键按原始字符串参与判定，不是枚举别名，有两个来源：`HudLayerRegistry.register(overlayId, category)` 注册的分类名；未注册 overlay 的完整资源 ID（`modid:path`）。
- 固定层之外没有本目录可穷举的键集合；动态键不在 15 条内，不能把 15 条当作全集。

## 4. playControl（5，7 轨共用）

来源 [tracks.ts:29](../src/core/schema/catalog/tracks.ts#L29)。七轨的 `TrackCatalog.playControl` 都引用同一份声明；`id` 无轨道名，索引键是 `type:key`，`scope` 为空。

| key | 类型 | 必 | 默认 | 约束 |
|---|---|:--:|---|---|
| `start_time` | `float` | ✓ | — |   |
| `duration` | `float` | ✓ | — |   |
| `loop` | `bool` |   | `false` |   |
| `loop_count` | `int` |   | `-1` |   |
| `loop_mode` | `enum` |   | `repeat` | `enum: repeat / pingpong` |

- `start_time`、`duration` 必填且无默认；`loop` 默认 `false`；`loop_count` 默认 `-1`；`loop_mode` 封闭集合 `repeat / pingpong`，默认 `repeat`。
- 这 5 条没有任何 `requires`/`appliesTo`/范围字段：schema 未声明「loop=false 时禁用 loop_count」之类的依赖。
- `mode` 不在这 5 条上出现；它们是片段播放控制，不是可关键帧属性。

## 5. CAMERA（218 objects）

`scope: ["CAMERA"]`；id 前缀 `track.CAMERA.object.`；声明位置 [tracks.ts:271](../src/core/schema/catalog/tracks.ts#L271)。

- 218 = position 21 + orientation 44 + camera 2 + composite 16 + color 67 + motion 6 + breath 7 + transition 5 + modifier 2 + selector 48；185 A / 33 V。
- color 67 = 57 个 `float` 调色通道（全部 animated/linear）+ 10 个 `struct` 调色曲线（value-only，无默认）。57 通道中 `exposure` 为 [-5, 5]；强度类通道为 [0, 1] 且默认 1；`grayscale`/`invert` 为 [0, 1] 且默认 0；其余为 [-1, 1] 且默认 0。
- selector 48 = 6 个通用字段 + 7 个调用点 × 6 个覆盖字段；7 个调用点固定为 `position_origin`、`look_at`、`yaw_base`、`yaw_base_from`、`yaw_base_to`、`facing_target`、`facing_entity`。覆盖字段全部 `default: null`（目录只声明无默认）。
- 全库仅有的两条轨道对象 `requires` 在本轨：`yaw_offset`、`pitch_offset` 需要 `orient=tangent`。`orient` 是 value-only 的 `manual / tangent`；`availability()` 只解析同轨对象路径，`orient` 不在 `values` 时取它的默认 `manual`，因此这两条默认不可用。
- 仅有的两个 `nullable_float` 也在本轨：`yaw_lock`、`pitch_lock`，`nullable: true`，无默认，单位 degree。
- `zoom` 是唯一 `geometric` 插值（默认 1）；其余 angle 字段为 `yaw`、`pitch`、`roll`、`yaw_lock`、`pitch_lock`、`yaw_offset`、`pitch_offset`。
- `struct` 字段（10 条调色曲线、6 条 `motion_*`、`transition_curve`、`transition_params`、`modifier`）在目录内没有载荷定义；不得从 `models`/`curveTypes` 推断其具体嵌套。`mask_shape` 为静态 `full / rect / circle`；`mask_width`、`mask_height`、`mask_radius` 有 `min: 0`。

| section | 字段数 | 源码 |
|---|---:|---|
| `position` | 21 | [tracks.ts:274](../src/core/schema/catalog/tracks.ts#L274) |
| `orientation` | 44 | [tracks.ts:319](../src/core/schema/catalog/tracks.ts#L319) |
| `camera` | 2 | [tracks.ts:405](../src/core/schema/catalog/tracks.ts#L405) |
| `composite` | 16 | [tracks.ts:408](../src/core/schema/catalog/tracks.ts#L408) |
| `color` | 67 | [tracks.ts:430](../src/core/schema/catalog/tracks.ts#L430) |
| `motion` | 6 | [tracks.ts:444](../src/core/schema/catalog/tracks.ts#L444) |
| `breath` | 7 | [tracks.ts:449](../src/core/schema/catalog/tracks.ts#L449) |
| `transition` | 5 | [tracks.ts:463](../src/core/schema/catalog/tracks.ts#L463) |
| `modifier` | 2 | [tracks.ts:478](../src/core/schema/catalog/tracks.ts#L478) |
| `selector` | 48 | [tracks.ts:484](../src/core/schema/catalog/tracks.ts#L484) |

### CAMERA / `position`（21）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `position.x`, `position.y`, `position.z`, `facing_target_offset.x`, `facing_target_offset.y`, `facing_target_offset.z` | `float` | A·linear |   | `0` |   |
| `position_mode` | `enum` | A·step |   | `relative` | `enum: relative / absolute` |
| `position_space`, `facing_target_offset.space` | `enum` | A·step |   | `world` | `enum: world / base` |
| `position_origin`, `facing_target`, `facing_entity` | `ref` | A·step |   | `""` |   |
| `position_origin_x`, `position_origin_y`, `position_origin_z`, `facing_target_x`, `facing_target_y`, `facing_target_z` | `float` | A·linear |   | — |   |
| `position_origin_freeze`, `facing_target_freeze` | `bool` | A·step |   | `false` |   |
| `facing_source` | `enum` | A·step |   | `auto` | `enum: auto / world / entity / line` |

### CAMERA / `orientation`（44）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `yaw`, `pitch`, `roll` | `float` | A·angle |   | `0` | `unit: degree` |
| `yaw_lock`, `pitch_lock` | `nullable_float` | A·angle |   | — | `nullable` · `unit: degree` |
| `yaw_base`, `pitch_base` | `enum` | A·step |   | `world` | `enum: world / entity / line` |
| `yaw_base_selector`, `look_at_selector` | `ref` | A·step |   | `@p` |   |
| `yaw_base_from`, `yaw_base_to` | `ref` | A·step |   | `""` |   |
| `yaw_base_from_x`, `yaw_base_from_y`, `yaw_base_from_z`, `yaw_base_to_x`, `yaw_base_to_y`, `yaw_base_to_z`, `look_at_target_x`, `look_at_target_y`<br>`look_at_target_z` | `float` | A·linear |   | — |   |
| `yaw_base_from_offset.x`, `yaw_base_from_offset.y`, `yaw_base_from_offset.z`, `yaw_base_to_offset.x`, `yaw_base_to_offset.y`, `yaw_base_to_offset.z`, `look_at_offset.x`, `look_at_offset.y`<br>`look_at_offset.z` | `float` | A·linear |   | `0` |   |
| `yaw_base_from_offset.space`, `yaw_base_to_offset.space`, `look_at_offset.space` | `enum` | A·step |   | `world` | `enum: world / base` |
| `yaw_base_from_freeze`, `yaw_base_to_freeze`, `look_at_freeze` | `bool` | A·step |   | `false` |   |
| `look_at` | `enum` | A·step |   | `none` | `enum: none / player / coordinate / entity / block` |
| `look_at_part.x`, `look_at_part.y`, `look_at_part.z` | `float` | A·linear |   | `50` |   |
| `look_at_target_structure`, `look_at_target_block` | `string` | A·step |   | `""` |   |
| `orient` | `enum` | V·none |   | `manual` | `enum: manual / tangent` |
| `yaw_offset`, `pitch_offset` | `float` | A·angle |   | `0` | `requires: orient=tangent` · `unit: degree` |

### CAMERA / `camera`（2）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `fov` | `float` | A·linear |   | `70` |   |
| `zoom` | `float` | A·geometric |   | `1` |   |

### CAMERA / `composite`（16）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `opacity`, `dest.w`, `dest.h`, `source.w`, `source.h` | `float` | A·linear |   | `1` |   |
| `dest.x`, `dest.y`, `source.x`, `source.y` | `float` | A·linear |   | `0` |   |
| `mask_x`, `mask_y` | `float` | A·linear |   | `0.5` |   |
| `mask_width`, `mask_height` | `float` | A·linear |   | `1` | `range: ≥ 0` |
| `mask_radius` | `float` | A·linear |   | `0.5` | `range: ≥ 0` |
| `mask_shape` | `enum` | V·none |   | `full` | `enum: full / rect / circle` |
| `dimension` | `string` | V·none |   | `""` |   |

### CAMERA / `color`（67）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `exposure` | `float` | A·linear |   | `0` | `range: [-5, 5]` |
| `contrast`, `highlights`, `shadows`, `whites`, `blacks`, `hue`, `saturation`, `vibrance`<br>`lightness`, `temperature`, `tint`, `red`, `green`, `blue`, `mix_rr`, `mix_rg`<br>`mix_rb`, `mix_gr`, `mix_gg`, `mix_gb`, `mix_br`, `mix_bg`, `mix_bb`, `lift_r`<br>`lift_g`, `lift_b`, `gamma_r`, `gamma_g`, `gamma_b`, `gain_r`, `gain_g`, `gain_b`<br>`hue_red`, `sat_red`, `hue_yellow`, `sat_yellow`, `hue_green`, `sat_green`, `hue_cyan`, `sat_cyan`<br>`hue_blue`, `sat_blue`, `hue_magenta`, `sat_magenta` | `float` | A·linear |   | `0` | `range: [-1, 1]` |
| `curve_strength`, `r_curve_strength`, `g_curve_strength`, `b_curve_strength`, `hv_h_strength`, `hv_s_strength`, `hv_l_strength`, `lv_s_strength`<br>`sv_s_strength`, `sv_l_strength` | `float` | A·linear |   | `1` | `range: [0, 1]` |
| `grayscale`, `invert` | `float` | A·linear |   | `0` | `range: [0, 1]` |
| `rgb_curve`, `r_curve`, `g_curve`, `b_curve`, `hv_h_curve`, `hv_s_curve`, `hv_l_curve`, `lv_s_curve`<br>`sv_s_curve`, `sv_l_curve` | `struct` | V·none |   | — |   |

### CAMERA / `motion`（6）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `motion_position`, `motion_yaw`, `motion_pitch`, `motion_roll`, `motion_fov`, `motion_zoom` | `struct` | V·none |   | — |   |

### CAMERA / `breath`（7）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `cam_breath_enabled` | `bool` | V·none |   | `false` |   |
| `cam_breath_intensity` | `float` | V·none |   | `0.05` |   |
| `cam_breath_seed` | `int` | V·none |   | `0` |   |
| `cam_breath_type` | `enum` | V·none |   | `perlin` | `enum: perlin / perlin_axis / sine / trauma` |
| `cam_breath_speed`, `cam_breath_trauma` | `float` | V·none |   | `1` |   |
| `cam_breath_decay` | `float` | V·none |   | `0.5` |   |

### CAMERA / `transition`（5）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `transition` | `enum` | V·none |   | `cut` | `enum: cut / morph` |
| `transition_duration` | `float` | V·none |   | `0.5` | `range: ≥ 0` |
| `transition_curve`, `transition_params` | `struct` | V·none |   | — |   |
| `transition_interrupt` | `enum` | V·none |   | `blend` | `enum: blend / snap` |

### CAMERA / `modifier`（2）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `modifier` | `struct` | V·none |   | — |   |
| `suppress_modifiers` | `bool` | V·none |   | `false` |   |

### CAMERA / `selector`（48）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `selector_refresh`, `selector_switch_interval` | `float` | A·step |   | `1` |   |
| `selector_switch_while_alive` | `bool` | A·step |   | `true` |   |
| `selector_switch_smooth` | `float` | A·step |   | `0` |   |
| `selector_anchor` | `enum` | A·step |   | `camera` | `enum: camera / player / target / origin` |
| `selector_pick` | `enum` | A·step |   | `first` | `enum: first / nearest / alive` |
| `selector_refresh_position_origin`, `selector_switch_interval_position_origin`, `selector_switch_smooth_position_origin`, `selector_refresh_look_at`, `selector_switch_interval_look_at`, `selector_switch_smooth_look_at`, `selector_refresh_yaw_base`, `selector_switch_interval_yaw_base`<br>`selector_switch_smooth_yaw_base`, `selector_refresh_yaw_base_from`, `selector_switch_interval_yaw_base_from`, `selector_switch_smooth_yaw_base_from`, `selector_refresh_yaw_base_to`, `selector_switch_interval_yaw_base_to`, `selector_switch_smooth_yaw_base_to`, `selector_refresh_facing_target`<br>`selector_switch_interval_facing_target`, `selector_switch_smooth_facing_target`, `selector_refresh_facing_entity`, `selector_switch_interval_facing_entity`, `selector_switch_smooth_facing_entity` | `float` | A·step |   | — |   |
| `selector_switch_while_alive_position_origin`, `selector_switch_while_alive_look_at`, `selector_switch_while_alive_yaw_base`, `selector_switch_while_alive_yaw_base_from`, `selector_switch_while_alive_yaw_base_to`, `selector_switch_while_alive_facing_target`, `selector_switch_while_alive_facing_entity` | `bool` | A·step |   | — |   |
| `selector_anchor_position_origin`, `selector_anchor_look_at`, `selector_anchor_yaw_base`, `selector_anchor_yaw_base_from`, `selector_anchor_yaw_base_to`, `selector_anchor_facing_target`, `selector_anchor_facing_entity` | `enum` | A·step |   | — | `enum: camera / player / target / origin` |
| `selector_pick_position_origin`, `selector_pick_look_at`, `selector_pick_yaw_base`, `selector_pick_yaw_base_from`, `selector_pick_yaw_base_to`, `selector_pick_facing_target`, `selector_pick_facing_entity` | `enum` | A·step |   | — | `enum: first / nearest / alive` |

## 6. LETTERBOX（2 objects）

`scope: ["LETTERBOX"]`；id 前缀 `track.LETTERBOX.object.`；声明位置 [tracks.ts:520](../src/core/schema/catalog/tracks.ts#L520)。

- 2 条全部 animated/linear。`aspect_ratio` 默认 2.35、`min: 0`；`opacity` 默认 1、范围 [0, 1]。

| section | 字段数 | 源码 |
|---|---:|---|
| `letterbox` | 2 | [tracks.ts:520](../src/core/schema/catalog/tracks.ts#L520) |

### LETTERBOX / `letterbox`（2）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `aspect_ratio` | `float` | A·linear |   | `2.35` | `range: ≥ 0` |
| `opacity` | `float` | A·linear |   | `1` | `range: [0, 1]` |

## 7. AUDIO（13 objects）

`scope: ["AUDIO"]`；id 前缀 `track.AUDIO.object.`；声明位置 [tracks.ts:528](../src/core/schema/catalog/tracks.ts#L528)。

- 4 A（`volume`、`x`、`y`、`z`，全 linear） + 9 V。
- `sound` 是 7 轨对象中仅有的两个必填项之一：`type: string`、`default: null`、`hasDefault: false`、`required: true`。
- 封闭集合：`source` = `file / minecraft`；`attenuation` = `none / linear`；`position_mode` = `relative / absolute`；`category` = `music / ambient`。`fade_in`、`fade_out` 有 `min: 0`。
- `volume` 可关键帧，`pitch` 是静态值（默认 1）；二者模式不同，不是同一类控件。

| section | 字段数 | 源码 |
|---|---:|---|
| `audio` | 13 | [tracks.ts:528](../src/core/schema/catalog/tracks.ts#L528) |

### AUDIO / `audio`（13）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `volume` | `float` | A·linear |   | `1` |   |
| `x`, `y`, `z` | `float` | A·linear |   | `0` |   |
| `sound` | `string` | V·none | ✓ | — |   |
| `source` | `enum` | V·none |   | `file` | `enum: file / minecraft` |
| `pitch` | `float` | V·none |   | `1` |   |
| `file_loop` | `bool` | V·none |   | `false` |   |
| `fade_in`, `fade_out` | `float` | V·none |   | `0` | `range: ≥ 0` |
| `attenuation` | `enum` | V·none |   | `linear` | `enum: none / linear` |
| `position_mode` | `enum` | V·none |   | `relative` | `enum: relative / absolute` |
| `category` | `enum` | V·none |   | `music` | `enum: music / ambient` |

## 8. EVENT（2 objects）

`scope: ["EVENT"]`；id 前缀 `track.EVENT.object.`；声明位置 [tracks.ts:559](../src/core/schema/catalog/tracks.ts#L559)。

- `event` 是唯一 `event_record`，`mode: event`，无默认、无约束；`event_type` 是静态 string，默认 `command`。两者之间没有 schema 依赖声明。

| section | 字段数 | 源码 |
|---|---:|---|
| `event` | 2 | [tracks.ts:559](../src/core/schema/catalog/tracks.ts#L559) |

### EVENT / `event`（2）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `event` | `event_record` | E·none |   | — |   |
| `event_type` | `string` | V·none |   | `command` |   |

## 9. MOD_EVENT（3 objects）

`scope: ["MOD_EVENT"]`；id 前缀 `track.MOD_EVENT.object.`；声明位置 [tracks.ts:567](../src/core/schema/catalog/tracks.ts#L567)。

- `mod_event` 是 `event_record`（mode event）；`event_type` 静态 string，默认 `mod_event`；`data` 是 `struct`（value-only，无默认），载荷不在此目录。

| section | 字段数 | 源码 |
|---|---:|---|
| `event` | 3 | [tracks.ts:567](../src/core/schema/catalog/tracks.ts#L567) |

### MOD_EVENT / `event`（3）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `mod_event` | `event_record` | E·none |   | — |   |
| `event_type` | `string` | V·none |   | `mod_event` |   |
| `data` | `struct` | V·none |   | — |   |

## 10. OVERLAY（32 objects）

`scope: ["OVERLAY"]`；id 前缀 `track.OVERLAY.object.`；声明位置 [tracks.ts:576](../src/core/schema/catalog/tracks.ts#L576)。

- 24 A / 8 V。`layer_type` 是另一个必填项：`enum`，封闭集合 `fade / image / subtitle`，默认 `fade`，`required: true`。
- 20 条带 `appliesTo`，取值指向 `layer_type`：`source.*` → `image`；`font_scale` → `subtitle`；`color.r/g/b`、`mask_*`、`gradient_*`、`gradient`(struct)、`mask_shape`、`blend_mode` → `fade`。`appliesTo` 只是元数据，不是 `requires`，`availability()` 不会据此禁用。
- `color`（静态 string，默认 `#000000`）与 `color.r/g/b`（animated float，默认 0）是不同字段；目录没有声明二者的绑定或互斥关系。
- `blend_mode` 与 ADJUST 同名枚举一致：`normal / multiply / screen / soft_light / overlay`。`mask_width`、`mask_height`、`mask_radius`、`gradient_radius` 有 `min: 0`；`opacity` 为 [0, 1]。

| section | 字段数 | 源码 |
|---|---:|---|
| `layout` | 6 | [tracks.ts:578](../src/core/schema/catalog/tracks.ts#L578) |
| `source` | 4 | [tracks.ts:584](../src/core/schema/catalog/tracks.ts#L584) |
| `composite` | 1 | [tracks.ts:588](../src/core/schema/catalog/tracks.ts#L588) |
| `text` | 1 | [tracks.ts:589](../src/core/schema/catalog/tracks.ts#L589) |
| `color` | 3 | [tracks.ts:590](../src/core/schema/catalog/tracks.ts#L590) |
| `mask` | 5 | [tracks.ts:593](../src/core/schema/catalog/tracks.ts#L593) |
| `gradient` | 4 | [tracks.ts:598](../src/core/schema/catalog/tracks.ts#L598) |
| `layer` | 8 | [tracks.ts:602](../src/core/schema/catalog/tracks.ts#L602) |

### OVERLAY / `layout`（6）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `x`, `y`, `anchor_x`, `anchor_y` | `float` | A·linear |   | `0.5` |   |
| `scale_x`, `scale_y` | `float` | A·linear |   | `1` |   |

### OVERLAY / `source`（4）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `source.x`, `source.y` | `float` | A·linear |   | `0` | `appliesTo: image` |
| `source.w`, `source.h` | `float` | A·linear |   | `1` | `appliesTo: image` |

### OVERLAY / `composite`（1）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `opacity` | `float` | A·linear |   | `1` | `range: [0, 1]` |

### OVERLAY / `text`（1）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `font_scale` | `float` | A·linear |   | `1` | `appliesTo: subtitle` |

### OVERLAY / `color`（3）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `color.r`, `color.g`, `color.b` | `float` | A·linear |   | `0` | `appliesTo: fade` |

### OVERLAY / `mask`（5）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `mask_x`, `mask_y` | `float` | A·linear |   | `0.5` | `appliesTo: fade` |
| `mask_width`, `mask_height` | `float` | A·linear |   | `1` | `range: ≥ 0` · `appliesTo: fade` |
| `mask_radius` | `float` | A·linear |   | `0.5` | `range: ≥ 0` · `appliesTo: fade` |

### OVERLAY / `gradient`（4）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `gradient_angle` | `float` | A·linear |   | `0` | `appliesTo: fade` |
| `gradient_center_x`, `gradient_center_y` | `float` | A·linear |   | `0.5` | `appliesTo: fade` |
| `gradient_radius` | `float` | A·linear |   | `0.5` | `range: ≥ 0` · `appliesTo: fade` |

### OVERLAY / `layer`（8）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `layer_type` | `enum` | V·none | ✓ | `fade` | `enum: fade / image / subtitle` |
| `color` | `string` | V·none |   | `#000000` |   |
| `gradient` | `struct` | V·none |   | — | `appliesTo: fade` |
| `mask_shape` | `enum` | V·none |   | `full` | `enum: full / rect / circle` · `appliesTo: fade` |
| `blend_mode` | `enum` | V·none |   | `normal` | `enum: normal / multiply / screen / soft_light / overlay` · `appliesTo: fade` |
| `path`, `text` | `string` | V·none |   | `""` |   |
| `z_index` | `int` | V·none |   | `10` |   |

## 11. ADJUST（72 objects）

`scope: ["ADJUST"]`；id 前缀 `track.ADJUST.object.`；声明位置 [tracks.ts:627](../src/core/schema/catalog/tracks.ts#L627)。

- 59 个 `float` 调色通道（全部 animated/linear）+ 10 个 `struct` 曲线（value-only）+ `lut`（string，无默认）+ `lut_input_gamma`（float，默认 1，`min: 0`）+ `blend_mode`（enum）。
- 通道范围与 CAMERA 同名通道一致；`lut_strength`、`blend_amount` 为 [0, 1] 且默认 1；`exposure` 为 [-5, 5]。10 条曲线与 CAMERA 同名同模式。
- `blend_mode` 无范围、无 requires，默认 `normal`，枚举 `normal / multiply / screen / soft_light / overlay`。

| section | 字段数 | 源码 |
|---|---:|---|
| `color` | 59 | [tracks.ts:630](../src/core/schema/catalog/tracks.ts#L630) |
| `curve` | 10 | [tracks.ts:638](../src/core/schema/catalog/tracks.ts#L638) |
| `lut` | 2 | [tracks.ts:644](../src/core/schema/catalog/tracks.ts#L644) |
| `blend` | 1 | [tracks.ts:646](../src/core/schema/catalog/tracks.ts#L646) |

### ADJUST / `color`（59）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `exposure` | `float` | A·linear |   | `0` | `range: [-5, 5]` |
| `contrast`, `highlights`, `shadows`, `whites`, `blacks`, `hue`, `saturation`, `vibrance`<br>`lightness`, `temperature`, `tint`, `red`, `green`, `blue`, `mix_rr`, `mix_rg`<br>`mix_rb`, `mix_gr`, `mix_gg`, `mix_gb`, `mix_br`, `mix_bg`, `mix_bb`, `lift_r`<br>`lift_g`, `lift_b`, `gamma_r`, `gamma_g`, `gamma_b`, `gain_r`, `gain_g`, `gain_b`<br>`hue_red`, `sat_red`, `hue_yellow`, `sat_yellow`, `hue_green`, `sat_green`, `hue_cyan`, `sat_cyan`<br>`hue_blue`, `sat_blue`, `hue_magenta`, `sat_magenta` | `float` | A·linear |   | `0` | `range: [-1, 1]` |
| `curve_strength`, `r_curve_strength`, `g_curve_strength`, `b_curve_strength`, `lut_strength`, `hv_h_strength`, `hv_s_strength`, `hv_l_strength`<br>`lv_s_strength`, `sv_s_strength`, `sv_l_strength`, `blend_amount` | `float` | A·linear |   | `1` | `range: [0, 1]` |
| `grayscale`, `invert` | `float` | A·linear |   | `0` | `range: [0, 1]` |

### ADJUST / `curve`（10）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `rgb_curve`, `r_curve`, `g_curve`, `b_curve`, `hv_h_curve`, `hv_s_curve`, `hv_l_curve`, `lv_s_curve`<br>`sv_s_curve`, `sv_l_curve` | `struct` | V·none |   | — |   |

### ADJUST / `lut`（2）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `lut` | `string` | V·none |   | — |   |
| `lut_input_gamma` | `float` | V·none |   | `1` | `range: ≥ 0` |

### ADJUST / `blend`（1）

| 字段（key） | 类型 | 模式 | 必 | 默认 | 约束 |
|---|---|---|:--:|---|---|
| `blend_mode` | `enum` | V·none |   | `normal` | `enum: normal / multiply / screen / soft_light / overlay` |

## 12. models（11 类型）

来源 [models.ts:30](../src/core/schema/catalog/models.ts#L30) 与 [models.ts:45](../src/core/schema/catalog/models.ts#L45)。每种模型是独立目录；`params` 的 `id` 为 `model.<type>.<key>`，`scope: [<type>]`，全部 `required: false`，`section: info`。

公共事实：`domains` = `scalar / angle / vector / color`；`maxDepth` = 8（含根 = 1）；`maxNodes` = 32；非法/缺失定义回落 `linear`。

| 模型类型 | 参数（key:type=默认；✓=必填） |
|---|---|
| `linear` | — |
| `smoothstep` | — |
| `ease_in` | — |
| `ease_out` | — |
| `ease_in_out` | — |
| `cubic_bezier` | `x1:float=0.3333333333333333`<br>`y1:float=0.3333333333333333`<br>`x2:float=0.6666666666666666`<br>`y2:float=0.6666666666666666` |
| `exponential_smooth` | `tau:float=0.15` |
| `spring` | `stiffness:float=8`<br>`damping:float=0.75`<br>`initial_velocity:float=0` |
| `inertia` | `stiffness:float=8`<br>`damping:float=0.75`<br>`initial_velocity:float=0` |
| `chain` | `models:model_list=—` |
| `blend` | `a:model=—`<br>`b:model=—`<br>`weight:float=0.5` |

- `chain.models` 是 `model_list`，`blend.a` / `blend.b` 是 `model`：它们是递归引用点，受 `maxDepth` / `maxNodes` 限制；目录不在本段展开定义树。
- `models` 目录没有被任何 `FieldEntry` 以嵌套 schema 直接引用；CAMERA 的 `motion_*` 等 `struct` 字段只是不透明载荷，二者不要在文档/代码里当作同一层结构。

## 13. curveTypes（11 类型）

来源 [curveTypes.ts:33](../src/core/schema/catalog/curveTypes.ts#L33)、能力 [curveTypes.ts:48](../src/core/schema/catalog/curveTypes.ts#L48)、参数 [curveTypes.ts:63](../src/core/schema/catalog/curveTypes.ts#L63)。参数条目是 `CurveParamEntry`，**没有 mode/type**，只有 `kind`。

| 曲线类型 | capabilities | 参数（key:kind=默认；✓=必填；[]=封闭枚举） |
|---|---|---|
| `linear` | — | — |
| `bezier` | `ANALYTIC_SECOND_DERIVATIVE` | `control_points:POINT_LIST=—` ✓ |
| `rational_bezier` | `ANALYTIC_SECOND_DERIVATIVE` | `control_points:POINT_LIST=—` ✓<br>`weights:NUMBER_LIST=—` ✓ |
| `arc` | `ANALYTIC_ARC_LENGTH` / `ANALYTIC_SECOND_DERIVATIVE` | `center:POINT=—` ✓<br>`radius:NUMBER=—` ✓<br>`start_angle:NUMBER=—` ✓<br>`end_angle:NUMBER=—` ✓<br>`normal:VECTOR={"x":0,"y":1,"z":0}`<br>`reference_axis:VECTOR={"x":1,"y":0,"z":0}` |
| `ellipse` | `ANALYTIC_SECOND_DERIVATIVE` | `center:POINT=—` ✓<br>`semi_major:NUMBER=—` ✓<br>`semi_minor:NUMBER=—` ✓<br>`rotation:NUMBER=0`<br>`start_angle:NUMBER=—` ✓<br>`end_angle:NUMBER=—` ✓<br>`normal:VECTOR={"x":0,"y":1,"z":0}`<br>`reference_axis:VECTOR={"x":1,"y":0,"z":0}` |
| `bspline` | `ANALYTIC_SECOND_DERIVATIVE` / `KNOT_VECTOR` | `control_points:POINT_LIST=—` ✓<br>`degree:INTEGER=3`<br>`knots:NUMBER_LIST=—` |
| `nurbs` | `ANALYTIC_SECOND_DERIVATIVE` / `RATIONAL_WEIGHTS` / `KNOT_VECTOR` | `control_points:POINT_LIST=—` ✓<br>`weights:NUMBER_LIST=—` ✓<br>`degree:INTEGER=3`<br>`knots:NUMBER_LIST=—` |
| `catmull_rom` | `ANALYTIC_SECOND_DERIVATIVE` | `points:POINT_LIST=—` ✓<br>`parameterization:ENUM="centripetal"` [`uniform / chordal / centripetal`]<br>`tension:NUMBER=1`<br>`endpoint:ENUM="mirror"` [`mirror / clamp`] |
| `hermite` | `ANALYTIC_SECOND_DERIVATIVE` | `tangents:POINT_LIST=—` ✓ |
| `clothoid` | `ANALYTIC_ARC_LENGTH` / `ANALYTIC_SECOND_DERIVATIVE` | `start_curvature:NUMBER=—` ✓<br>`end_curvature:NUMBER=—` ✓<br>`length:NUMBER=—` ✓<br>`start_direction:VECTOR={"x":1,"y":0,"z":0}`<br>`normal:VECTOR={"x":0,"y":1,"z":0}` |
| `fourier` | `ANALYTIC_SECOND_DERIVATIVE` / `PERIODIC` | `a0:VECTOR={"x":0,"y":0,"z":0}`<br>`cos:POINT_LIST=—`<br>`sin:POINT_LIST=—`<br>`period:NUMBER=—` ✓<br>`periodic:BOOLEAN=true`<br>`start_velocity:VECTOR={"x":0,"y":0,"z":0}`<br>`end_velocity:VECTOR={"x":0,"y":0,"z":0}` |

- 参数 `kind` 集合：`NUMBER`、`INTEGER`、`BOOLEAN`、`ENUM`、`TEXT`、`POINT`、`POINT_LIST`、`NUMBER_LIST`、`VECTOR`；`POINT`/`VECTOR` 默认值按 JSON 对象给出。
- 各参数的几何/单调/长度校验写在源码的 `doc` 与验证器中，本文件不递归抄录。`linear` 无参数、无 capability。
- **`line` 不是 curveTypes 的键**：`linear` 是曲线类型；`line` 只作为 `paths.geometry.type` 枚举中的别名出现（见第 14 节）。

## 14. scriptStructure（13 段 / 50 字段）

来源 [scriptStructure.ts:58](../src/core/schema/catalog/scriptStructure.ts#L58)。这些是脚本级结构字段，`FieldEntry.mode`/`interp` 不存在（不是可关键帧属性）；`type` 直接使用脚本导出的 `string` / `number` / `boolean` / `object` / `array`，不并入 `float`/`bool`。

| 结构段 | 字段数 | 源码 |
|---|---:|---|
| `clips` | 5 | [scriptStructure.ts:60](../src/core/schema/catalog/scriptStructure.ts#L60) |
| `clips.exit` | 3 | [scriptStructure.ts:77](../src/core/schema/catalog/scriptStructure.ts#L77) |
| `rules` | 4 | [scriptStructure.ts:80](../src/core/schema/catalog/scriptStructure.ts#L80) |
| `rules.policy` | 6 | [scriptStructure.ts:94](../src/core/schema/catalog/scriptStructure.ts#L94) |
| `rule_bindings` | 7 | [scriptStructure.ts:110](../src/core/schema/catalog/scriptStructure.ts#L110) |
| `rule_bindings.gate` | 1 | [scriptStructure.ts:129](../src/core/schema/catalog/scriptStructure.ts#L129) |
| `rule_bindings.schedule` | 6 | [scriptStructure.ts:136](../src/core/schema/catalog/scriptStructure.ts#L136) |
| `rule_bindings.exit` | 3 | [scriptStructure.ts:154](../src/core/schema/catalog/scriptStructure.ts#L154) |
| `paths` | 7 | [scriptStructure.ts:157](../src/core/schema/catalog/scriptStructure.ts#L157) |
| `paths.geometry` | 2 | [scriptStructure.ts:180](../src/core/schema/catalog/scriptStructure.ts#L180) |
| `paths.timing` | 2 | [scriptStructure.ts:189](../src/core/schema/catalog/scriptStructure.ts#L189) |
| `condition_fact_types.clip_fact` | 2 | [scriptStructure.ts:198](../src/core/schema/catalog/scriptStructure.ts#L198) |
| `condition_fact_types.rule_fact` | 2 | [scriptStructure.ts:206](../src/core/schema/catalog/scriptStructure.ts#L206) |

### `clips`（5）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `id` | `string` |   | — |   | 片段 id（^[A-Za-z0-9_]{1,64}$；被规则 / 路径 / 分支 / 出口引用时必填） |
| `track` | `string` | ✓ | — | `enum: CAMERA / LETTERBOX / AUDIO / EVENT / MOD_EVENT / OVERLAY / ADJUST` | 轨道类型（独立片段必填，决定 objects schema） |
| `duration` | `number` | ✓ | — |   | 片段时长（秒；正数=有限，负数=无限单次） |
| `objects` | `object` | ✓ | — |   | 采样属性对象（新格式内容） |
| `exit` | `object` |   | — |   | 出口策略（片段默认 / 绑定入口覆盖） |

### `clips.exit`（3）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `on_complete` | `string` | ✓ | — | `enum: continue / goto / return / end_execution / end_script` | 完成去向 |
| `target` | `string` |   | — |   | 目标片段 id（仅 goto，必须可解析） |
| `entry_time` | `number` |   | `0` |   | 入口局部秒（仅 goto；缺省 0，&gt;= 0） |

### `rules`（4）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `id` | `string` | ✓ | — |   | 规则 id（^[A-Za-z0-9_]{1,64}$；脚本内唯一） |
| `condition` | `object` | ✓ | — |   | 条件树（v1 状态谓词 + all_of/any + clip_fact/rule_fact，见 condition_fact_types） |
| `actions` | `array` | ✓ | — |   | 动作数组（至少一个；类型见 action_types） |
| `policy` | `object` |   | — |   | 触发策略（缺省值见内层字段） |

### `rules.policy`（6）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `once` | `boolean` |   | `true` |   | 只触发一次（缺省 true） |
| `cooldown` | `number` |   | `0` |   | 触发后静默秒数（缺省 0，&gt;= 0） |
| `mode` | `string` |   | `enter` | `enum: enter / dwell` | 触发方式（缺省 enter） |
| `dwell` | `number` |   | `0` |   | 驻留判定阈值秒数（缺省 0，&gt;= 0） |
| `timeout` | `number` |   | `-1` |   | 等待上限秒数（缺省 -1 = 无限等待） |
| `on_timeout` | `array` |   | — |   | 超时动作（缺省空数组） |

### `rule_bindings`（7）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `id` | `string` | ✓ | — |   | 绑定 id（^[A-Za-z0-9_]{1,64}$；脚本内唯一） |
| `rule` | `string` | ✓ | — |   | 规则定义 id（必须命中 rules[].id） |
| `clip` | `string` | ✓ | — |   | 宿主片段 id（必须命中片段 id） |
| `gate` | `object` | ✓ | — |   | 时间门（必填） |
| `control` | `string` |   | `observe` | `enum: observe / hold` | 执行控制（缺省 observe） |
| `schedule` | `object` |   | — |   | 动作调度（缺省 = 成功后立即提交） |
| `exit` | `object` |   | — |   | 出口策略（片段默认 / 绑定入口覆盖） |

### `rule_bindings.gate`（1）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `at` | `number` | ✓ | — |   | 时间门（目标片段执行局部秒；有限片段 0 ~ duration，无限片段 &gt;= 0） |

### `rule_bindings.schedule`（6）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `on` | `string` | ✓ | — | `enum: clip_start / clip_complete / local_time / delay / fact` | 释放条件（缺省 = 立即提交） |
| `clip` | `string` |   | — |   | 目标片段 id（clip_start / clip_complete / local_time 必填） |
| `at` | `number` |   | — |   | 目标片段执行局部秒（local_time 必填，&gt;= 0） |
| `seconds` | `number` |   | — |   | 判定成功后的真实秒数（delay 必填，&gt;= 0；挂起不冻结） |
| `binding` | `string` |   | — |   | 来源绑定 id（fact 必填，必须可解析） |
| `fact` | `string` |   | — | `enum: succeeded / action_completed` | 来源事实（fact 必填） |

### `rule_bindings.exit`（3）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `on_complete` | `string` | ✓ | — | `enum: continue / goto / return / end_execution / end_script` | 完成去向 |
| `target` | `string` |   | — |   | 目标片段 id（仅 goto，必须可解析） |
| `entry_time` | `number` |   | `0` |   | 入口局部秒（仅 goto；缺省 0，&gt;= 0） |

### `paths`（7）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `id` | `string` | ✓ | — |   | 路径 id（脚本内唯一，匹配 ^[A-Za-z0-9_]{1,64}$） |
| `clip` | `string` | ✓ | — |   | 目标片段 id（必须是 objects 片段；端点取自其 position.x/y/z 节点时间序列） |
| `from` | `number` | ✓ | — |   | 起点位置节点时间（秒，必须命中 position.x/y/z 关键帧时间，from &lt; to） |
| `to` | `number` | ✓ | — |   | 终点位置节点时间（秒，必须命中节点时间且与 from 相邻） |
| `axes` | `array` |   | — | `enum: x / y / z` | 轴集合（缺省 x/y/z；去重、顺序无关、至少一项） |
| `geometry` | `object` | ✓ | — |   | 曲线几何 |
| `timing` | `object` |   | — |   | 时间映射（缺省线性） |

### `paths.geometry`（2）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `type` | `string` | ✓ | — | `enum: line / linear / bezier / rational_bezier / arc / ellipse / bspline / nurbs / catmull_rom / hermite / clothoid / fourier` | 曲线类型（line = linear 的别名） |
| `control_points` | `array` |   | — |   | 控制点（bezier 等曲线类型使用） |

### `paths.timing`（2）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `type` | `string` |   | `linear` | `enum: linear / keyframes` | 时间映射类型（缺省 linear） |
| `points` | `array` |   | — |   | 关键帧点 [{t,s}]（keyframes：两端 0/1、单调不减、至少 2 点） |

### `condition_fact_types.clip_fact`（2）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `clip` | `string` | ✓ | — |   | 片段 id（必须可解析） |
| `fact` | `string` | ✓ | — | `enum: started / completed` | 事实 |

### `condition_fact_types.rule_fact`（2）

| key | 类型 | 必 | 默认 | 约束 / 枚举 | 说明 |
|---|---|:--:|---|---|---|
| `binding` | `string` | ✓ | — |   | 绑定 id（必须可解析） |
| `fact` | `string` | ✓ | — | `enum: succeeded / action_completed` | 事实 |

结构事实：

- `clips.track` 的封闭集合就是 7 轨：`CAMERA / LETTERBOX / AUDIO / EVENT / MOD_EVENT / OVERLAY / ADJUST`；`clips.objects` 是 `object`，是「片段 → 该轨 objects schema」的桥；目录不在此递归展开。
- 重复出现的出口结构：`clips.exit` 与 `rule_bindings.exit` 各有 `on_complete`（`continue / goto / return / end_execution / end_script`）、`target`、`entry_time`。`target` 仅 `goto`、`entry_time` 仅 `goto` 且 `>= 0`，这些是字段说明中的约束，不是 `requires` 字段。
- `rules.condition`（object）与 `rules.actions`（array）的载荷是独立定义：动作类型见 `action_types`，事实谓词见 `condition_fact_types.*`；本目录不递归抄规则/条件树。
- `paths.clip` 必须指向 `objects` 片段，端点取自该片段 `position.x/y/z` 的节点时间；`paths.geometry.type` 的封闭集合包含 `line` 及 11 种曲线名：`line / linear / bezier / rational_bezier / arc / ellipse / bspline / nurbs / catmull_rom / hermite / clothoid / fourier`。`paths.geometry.control_points` 是通用 `array`，不按曲线类型展开。
- `rule_bindings.schedule.on` 的封闭集合：`clip_start / clip_complete / local_time / delay / fact`；`rule_bindings.schedule.fact`：`succeeded / action_completed`。`rules.policy.mode`：`enter / dwell`；`rule_bindings.control`：`observe / hold`。
- 脚本段里的 `string` 字段也可能带 `enumValues`（例如 `clips.exit.on_complete`、`paths.geometry.type`）；不能用 `type: string` 判断它是否开放。

### 14.1 脚本枚举（4）

| 名称 | 值 |
|---|---|
| `action_types` | `camera_set` / `overlay_set` / `adjust_set` / `goto_clip` / `pause` / `resume` / `exit` / `play_sound` / `emit_command` |
| `exit_kinds` | `continue` / `goto` / `return` / `end_execution` / `end_script` |
| `schedule_kinds` | `clip_start` / `clip_complete` / `local_time` / `delay` / `fact` |
| `condition_fact_types` | `clip_fact` / `rule_fact` |

## 15. 独立目录与明确排除

- `triggers`：`buildCatalog` 还组装 `triggers`（类型、条件、字段），来源 `catalog/triggers.ts`；本文件不列出。不要把这里的 `scriptStructure.rules` 与触发器目录混为一谈：前者是脚本结构字段，后者是触发器类型/条件目录。
- `models` 与 `curveTypes` 是独立目录；CAMERA/ADJUST 的曲线 `struct`、CAMERA 的 `motion_*`、`transition_*`、`modifier`、MOD_EVENT 的 `data`、OVERLAY 的 `gradient` 在字段目录里都只是不透明 `struct`，没有嵌套定义。
- `discovered.tracks` / `discovered.triggers` 是第三方运行时登记（默认空），只登记不查询；不是字段，也不计入 342。
- 资源路径、选择器、事件记录、路径几何的深层语义属于各自的运行时/验证器；本文件只给目录已声明的事实与限值。

## 16. 核对

父代理指定的可执行核对片段（与本文档同一数据源）：

```js
import { buildCatalog } from './src/core/schema/index.ts';
const c = buildCatalog('inspector-inventory');
for (const [track, { objects }] of Object.entries(c.tracks))
  for (const { key, type, mode, section } of objects)
    console.log(track, section, key, type, mode);
```

期望：`meta 23`；轨道依次 `CAMERA 218`、`LETTERBOX 2`、`AUDIO 13`、`EVENT 2`、`MOD_EVENT 3`、`OVERLAY 32`、`ADJUST 72`；每条轨道 `playControl 5`。该片段逐行输出 342 条 `track section key type mode`，可直接与本文档按 section 分节的表逐项比对。
