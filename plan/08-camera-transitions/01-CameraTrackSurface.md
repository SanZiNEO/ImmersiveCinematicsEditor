# 08-01 镜头轨道字段面（CameraTrackSurface）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：08-camera-transitions
> 关联：`02-CameraTransitionEditor.md`、`03-LaneCompositionPanel.md`、`../06-async-objects/README.md`、`../07-position-path-curves/README.md`

## 1. 职责

把 CAMERA 片段的全部 schema 字段变成**片段效果控件（`clip.effects`）内的镜头组**：按 `section` 分组、按 `group` 做互斥与联动、按 `requires` 做启用门禁；每个叶子一行，由 06 的统一行与值控件承担参数编辑与独立节点列。本文件只定义字段面与组归属，不实现转场表（02）、lane 面板（03）或连续性诊断（04），也不新增独立"镜头页"或按叶子拆分的独占面板。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| CAMERA 对象表 | `J:script/schema/TrackSchemas.java — cameraObjects（109–347）` | 11 组：position/facing/orientation/camera/composite/color/motion/breath/transition/modifier/selector |
| 轨道 schema 装配 | `TrackSchemas.java — camera（45）`、`PLAY_CONTROL（84）`、`playControl（88–94）` | `TrackTypeSchema(objects, PLAY_CONTROL)` |
| 位置字段 | `TrackSchemas.java:113-131` | `position.x/y/z`、`position_mode`、`position_space`、`position_origin*`、`position_origin_freeze` |
| 朝向源字段 | `TrackSchemas.java:135-155` | `facing_source/target/target_offset/entity` |
| 朝向字段 | `TrackSchemas.java:159-248` | `yaw/pitch/roll`、`yaw_lock/pitch_lock`、`yaw_base/pitch_base`、`yaw_base_from/to*`、`look_at*`、`orient`、`yaw_offset/pitch_offset` |
| 光学 | `TrackSchemas.java:252-253` | `fov`、`zoom`（zoom = GEOMETRIC） |
| 合成 | `TrackSchemas.java:254-273` | `opacity`、`dest.*`、`source.*`、`mask_*`、`mask_shape`、`dimension` |
| lane 调色 | `TrackSchemas.java:275-285` | `CAMERA_COLOR_CHANNELS`（57）+ 10 曲线（value-only） |
| 运动模型 | `TrackSchemas.java:287-291` | 6 个 `motion_*`（value-only STRUCT） |
| 呼吸 | `TrackSchemas.java:293-301` | 7 个 `cam_breath_*` |
| 转场 | `TrackSchemas.java:303-311` | `transition`、`transition_duration`、`transition_curve`、`transition_params`、`transition_interrupt` |
| 修饰符 | `TrackSchemas.java:313-315` | `modifier`、`suppress_modifiers` |
| 选择器 | `TrackSchemas.java:317-345` | 6 通用 + 7 调用点 × 6 专属 |
| 调用点名单 | `J:script/object/ObjectCallpoints.java — NEW_CALLPOINTS（17-21）`、`field（28-30）` | `position_origin/look_at/yaw_base/yaw_base_from/yaw_base_to/facing_target/facing_entity` |
| 字段元数据 | `J:spi/ObjectDef.java`（176 行，record + Builder）、`J:spi/FieldDef.java`（41 行） | `appliesTo/requires/enumValues/min/max/section/group/unit` |
| 旧编辑器字段读取 | `EDITOR:src/components/ClipPanel.vue:8-20` | 读 `schema.tracks[type].clips`，与 `objects` 漂移 |
| 旧关键帧模型 | `EDITOR:src/types.ts:103-141` | 整帧快照，非对象叶子路径 |
| 字段分组工具 | `EDITOR:src/schema.ts — groupBySection（12-24）`、`getFieldsForSection（25-39）` | 可按 section 分组，但消费的是旧 shape |
| 异步控件 | `EDITOR:src/components/DynamicForm.vue`（142 行）、`EDITOR:src/components/fields/*` | 旧控件族；迁移后由 `06-ClipEffectControlsPanel` 的组容器 + `06-EffectControlsRows` 行 + `06-PropertyValueForm` 值控件替代 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 字段来源 | `schema.tracks[type].clips`（旧） | `schema.tracks.CAMERA.objects`（新） |
| 分组 | 按 section 平铺 | section + group 两级；group 内联动 |
| 互斥/门禁 | 无 | `requires`（如 `orient=tangent`）、`position_mode`/`space` 的联动 |
| 嵌套结构 | 只显示 JSON 文本 | `transition_params`/`modifier`/`motion_*` 结构化子表单 |
| 调用点选择器 | 无 | 通用 6 字段 + 7 个调用点分组 |
| 值语义 | 数字框 | `INTERP`/`unit` 标注；ANGLE 走角度控件，GEOMETRIC 走几何域 |
| 写回 | `clip[key]=value` | 02 的文档命令（对象叶子路径 + 原子提交） |

### 3.2 拟新建（提案）

组在这里是 UI 组织，不写脚本、不造运行时效果实例。容器只做组顺序与折叠，不实现 06 的行/节点几何。

- `EDITOR:src/components/camera/CameraGroups.ts`（提案）：向 `06-ClipEffectControlsPanel` 注册 CAMERA 的组渲染器与顺序（按 `section`）；不新建检查器页容器。
- `EDITOR:src/components/camera/PositionGroup.vue`（提案）：位置/朝向源组的行内容，处理 `position_mode/space` 与 `position_origin*` 的联动。
- `EDITOR:src/components/camera/OrientationGroup.vue`（提案）：朝向三轴、锁、基准、`look_at`、`orient` 的行内容。
- `EDITOR:src/components/camera/SelectorGroup.vue`（提案）：通用选择器 + 调用点专属字段（名单来自 schema，不硬编码）。
- `EDITOR:src/components/camera/CompositeGroup.vue`（提案）：`dest/source/mask/dimension` 的行内容，与 03 共用编辑动作。
- `EDITOR:src/lib/cameraFieldMeta.ts`（提案）：从 `ObjectDef` 提取 `group/requires/appliesTo/unit` 的纯函数；**不是**字段表。

每个组内的叶子都渲染成 `06-EffectControlsRows` 的行（左参数、右节点），值提交走 `06-PropertyValueForm`；组不生成合并节点带。

原提案的 `CameraTrackPanel.vue`（组容器）不再需要：组顺序与折叠由 `06-ClipEffectControlsPanel` 统一承载，CAMERA 只注册自己的组渲染器。转场组（02）与合成页（03）的挂载句应改为指向 `clip.effects` 的组或文档级面板，不再引用该容器。

## 4. 输入输出与字段约束

**输入**：`schema.tracks.CAMERA.objects`（`ObjectDef` 映射）、当前片段的对象树（`ClipObjects` 同形 JSON）、共享 Selection（`clipKey + objectPath + 可选节点时间`；片段可在主时间轴选，属性/节点只能在 `clip.effects` 行或快捷属性里选）。

**输出**：对单个对象叶子的编辑意图 `{clipId, objectPath, value | keyframeOp}`，交给 02 的命令层；本文件不直接写 store。

| 字段组 | 约束 |
|---|---|
| `position.x/y/z` | FLOAT/ANIMATED/LINEAR；`position_mode=relative` 时相对激活位置，`absolute` 时世界坐标 |
| `position_space` | ENUM `world/base`；`base` 时基准来自 `position_origin*` 或 `facing_source` |
| `position_origin` | REF/STEP；与 `position_origin_x/y/z` 互斥（同一 group） |
| `facing_source` | ENUM `auto/world/entity/line`；`line` 才启用 `yaw_base_from/to` |
| `yaw/pitch/roll` | FLOAT/ANGLED/ANGLE；单位 degree |
| `yaw_lock/pitch_lock` | NULLABLE_FLOAT；`null` = 不锁 |
| `orient` | ENUM `manual/tangent`；`tangent` 才启用 `yaw_offset/pitch_offset`（`requires`） |
| `fov` | FLOAT，默认 70；`zoom` GEOMETRIC，默认 1 |
| `dest/source` | 归一化 0–1；`dest.w/h` 与 `source.w/h` 的缺省 1 |
| `mask_*` | 归一化；`mask_width/height/radius` min 0；`mask_shape` `full/rect/circle` |
| `dimension` | STRING；空串 = 当前维度 |
| `color.*` | 57 通道；范围由 `channelMin/Max`（`TrackSchemas.java:539-549`） |
| `motion_*` | value-only STRUCT；不产生关键帧 |
| `cam_breath_*` | `enabled` 才启用其余；`type` `perlin/perlin_axis/sine/trauma` |
| `transition*` | 见 02；本文件只提供入口 |
| `modifier` | value-only STRUCT；`suppress_modifiers` 布尔 |
| `selector_*` | 通用 + 调用点专属；`selector_refresh` min 0（STEP） |

**禁止**：把 `position.x/y/z` 合并成 `position` 对象写盘；把 `dest`/`source` 写成 `{x,y,w,h}` 复合值；把 `color` 写成 `{r,g,b}`（必须 `color.r/g/b`）；把 `mask_shape` 写成 `shape`。

## 5. 修改步骤

1. 读 01 的 `schema.get` 快照，确认 `tracks.CAMERA.objects` 的 `ObjectDef` 字段齐全（`mode/type/interp/default/requires/group/appliesTo/unit`）。
2. 新建 `cameraFieldMeta.ts`：把 `ObjectDef` 映射为 UI 元数据（分组键、联动条件、单位、枚举），不做字段名硬编码。
3. 新建 `CameraGroups.ts`：向 `06-ClipEffectControlsPanel` 注册 CAMERA 的组渲染器与 `section` 顺序；`group` 非空时在组内再分小子组；未知 `section` 归入「其他」并标注。不新建检查器页容器。
4. 实现 `PositionGroup`：`position_mode`/`position_space` 改变时只切换可见字段，不删除另一模式的值；`position_origin` 与 `position_origin_x/y/z` 互斥提示。
5. 实现 `OrientationGroup`：`orient=tangent` 时启用 `yaw_offset/pitch_offset`；`yaw_base_from/to` 仅在 `facing_source=line` 时启用；`look_at` 按 `none/player/coordinate/entity/block` 切换子字段。
6. 实现 `SelectorGroup`：通用 6 字段 + 从 `NEW_CALLPOINTS` 生成的 7 组；每组标注「仅该调用点生效」。
7. 实现 `CompositeGroup`：`dest/source/mask` 的数值 + 归一化提示；`dimension` 空串说明；与 03 的 lane 面板共享同一编辑动作。
8. 所有叶子渲染为 `06-EffectControlsRows` 的行，值提交走 `06-PropertyValueForm`；`VALUE` 类型不显示秒表/菱形。
9. 在 05 注册 `clip.effects` 面板身份（不是新的「镜头」tab）；组与行的展开状态按文档会话 + `clipKey` 保存；`selection.properties` 只复用同一选择显示摘要。
10. 删除旧 `ClipPanel` 对 CAMERA 的通用表单分支（迁移调用方，不留双入口）。

## 6. 禁止修改

- 不得改 `cameraObjects()` 的字段名/默认值/范围来迁就 UI。
- 不得在 TS 里复制 57 通道名单、6 通道名单或 7 个调用点名单；必须从 schema/常量派生。
- 不得把 `VALUE` 字段写成关键帧容器。
- 不得把 `modifier`/`motion_*`/`transition_curve` 当动画属性编辑。
- 不得在前端重算相机姿态（`sampleCameraPose` 旧实现只用于旧模型，迁移后删除）。
- 不得新增 `editor.*` 消息。
- 不得为单个组或叶子新开独占检查器页/卡片；CAMERA 字段只能出现在 `clip.effects` 的组与行里。
- 不得把属性行、节点或关键帧汇总送回主时间轴；主时间轴只负责片段选择。
- 不得让快捷属性缓存第二份值/节点或自带时间轴。

## 7. 两分支承载

- **WebUI（webui 分支）**：完整字段面，全部走 `schema.get` + 文档命令；真实画面来自 03。
- **Forge 1.20.1**：同一份字段模型与命令语义；`INGAME:` 分支当前只有骨架（`Constants.java`、`EditorCommon.java`、`platform/Services.java`、`IPlatformHelper`、`EditorMod`、build 文件、mixins json），本轮不承诺 AUI 面板可运行；字段合同供 14 的进程内实现迁移复用。
- 两分支共用同一 schema 快照与同一校验权威（主模组），不各造一套字段表；两分支都保持"组内叶子成行、多组同时展开"的承载，不因视口小改成单属性切页。

## 8. 前置

- 01：`schema.get` 的 `ObjectDef` 完整导出；`appliesTo/requires/group` 不丢。
- 02：对象叶子路径身份 + 原子提交/撤销。
- 05：面板放置与选区；`clip.effects` / `selection.properties` 的身份由 05-07 InspectorHost 承载。
- 06：`06-ClipEffectControlsPanel` 组容器、`06-EffectControlsRows` 行/节点/局部视口、`06-PropertyValueForm` 值提交。
- 07：`position_*`/`motion_*` 的几何/曲线编辑器（本文件只挂入口）。

## 9. 验收

**正例**

- 选中一个 CAMERA 片段：`clip.effects` 出现 11 组；`position_mode` 从 `relative` 切到 `absolute`，`position.x/y/z` 数值保留，切回不丢。
- 同时展开位置组与朝向组：改 `position.x` 值，`yaw` 行仍可见、值不变；右列节点各自对齐。
- `orient=manual` 时 `yaw_offset/pitch_offset` 置灰并提示 `requires=orient=tangent`；切到 `tangent` 后可编辑。
- `look_at=entity` 时出现 `look_at_selector`；`look_at=coordinate` 时出现 `look_at_target_x/y/z`；切回 `none` 不删除已填值（只隐藏）。
- `selector_refresh_look_at` 等 7 组专属字段出现，且标注调用点。
- 编辑 `dest.w` 后，03 的 lane 面板同一字段同步；撤销一次回到原值。
- `VALUE` 字段（`modifier`、`motion_position`）没有秒表/菱形。
- 在快捷属性里改同一叶子 → 效果控件同行同步，标准文档只变一处。

**反例**

- 面板出现 `position` 复合对象输入框 → 失败（必须展开 `position.x/y/z`）。
- 切换 `position_mode` 时清空另一模式的值 → 失败（应保留但标不生效）。
- 57 通道名单在 TS 里再写一遍 → 失败。
- 编辑 `color` 写出 `{r,g,b}` → 失败（必须 `color.r/g/b`）。
- `VALUE` 字段出现关键帧菱形 → 失败。
- 选中 CAMERA 片段仍打开旧通用表单 → 失败（双入口）。
- 把镜头组做成独立「镜头」tab，或每个叶子一张独占卡片 → 失败（违反效果控件承载）。
- 主时间轴出现 CAMERA 属性行/节点/汇总标记 → 失败。

## 10. 真实冒烟

1. 用真实 `schema.get` 导出的 CAMERA `objects` 打开一个含 `position_mode=relative`、`look_at=entity`、`orient=tangent`、`selector_*` 的脚本。
2. 改 `position.x`、`yaw`、`fov`、`dest.w`、`mask_shape`，保存 → 重载 → 值逐字段一致。
3. 游戏内 `/icinematics validate` 通过；播放时相机位置/朝向/视场与编辑值一致。
4. 把 `position_mode` 切到 `absolute` 再切回，保存后 JSON 不出现 `position` 复合键。
5. 删除一个 `VALUE` 字段后保存，解析器不报未知键。
6. 同时滚动/展开效果控件多组并切换选中行：左右列行高一致，其他组的值与节点不丢；主时间轴高度不变。

## 11. 完成定义

- 11 组字段全部有 UI 归属，且实现为 `clip.effects` 的组与行；控件由 schema 元数据决定。
- 分组/联动/门禁与 `ObjectDef` 一致；不存在第二份字段表。
- 同一片段可同时展开多个组；选中行不隐藏其他组；快捷属性只复用同一值控件与命令。
- 编辑走 02 命令，撤销/重做/保存/重载无损。
- 旧 CAMERA 通用表单分支已删除，调用方迁移完成；主时间轴无属性行/节点入口。
- 正例/反例/冒烟全部通过；需要运行时的部分标注「需游戏内验证」。
