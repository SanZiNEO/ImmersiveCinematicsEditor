# 09-01 覆盖层轨道字段面（OverlayTrackSurface）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：09-overlays-composition
> 关联：`02-OverlayFadeAndMask.md`、`03-OverlayImageAndSubtitle.md`、`04-VideoOverlay.md`、`../06-async-objects/README.md`

## 1. 职责

把 OVERLAY 片段的 `layer_type` 三形态与全部 schema 字段变成可编辑的「画面」页：按 `appliesTo` 做门禁、按 `section` 分组、按类型切换子表单；类型切换不丢值但明确标注「不生效」。本文件只定义字段面与归属，不实现遮罩编辑器（02）、字幕/图像细节（03）、视频降级（04）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| OVERLAY 对象表 | `J:script/schema/TrackSchemas.java — overlayObjects（398–457）` | 布局/源/文本/颜色/遮罩/渐变/层类型 |
| 轨道装配 | `TrackSchemas.java — overlay（65）`、`PLAY_CONTROL（84）` | `TrackTypeSchema(objects, PLAY_CONTROL)` |
| 布局字段 | `TrackSchemas.java:400-405` | `x/y/anchor_x/anchor_y/scale_x/scale_y`（ANIMATED/LINEAR） |
| 源字段 | `TrackSchemas.java:406-413` | `source.x/y/w/h`，`appliesTo("image")` |
| 透明度 | `TrackSchemas.java:414-415` | `opacity` 0–1 |
| 字号 | `TrackSchemas.java:416-417` | `font_scale`，`appliesTo("subtitle")` |
| 颜色 | `TrackSchemas.java:418-423` | `color.r/g/b`（ANIMATED），`appliesTo("fade")` |
| 遮罩 | `TrackSchemas.java:424-433` | `mask_x/y/width/height/radius`，`appliesTo("fade")` |
| 渐变 | `TrackSchemas.java:434-441` | `gradient_angle/center_x/center_y/radius`，`appliesTo("fade")` |
| 层类型 | `TrackSchemas.java:443-444` | `layer_type` enum `fade/image/subtitle`，required |
| 颜色串 | `TrackSchemas.java:445` | `color` STRING 默认 `#000000` |
| 渐变结构 | `TrackSchemas.java:446-447` | `gradient` STRUCT，`appliesTo("fade")` |
| 遮罩形状 | `TrackSchemas.java:448-449` | `mask_shape` enum `full/rect/circle`，`appliesTo("fade")` |
| 混合模式 | `TrackSchemas.java:450-452` | `blend_mode` enum `normal/multiply/screen/soft_light/overlay`，`appliesTo("fade")` |
| 路径/文本/z | `TrackSchemas.java:453-455` | `path`、`text`、`z_index` |
| 运行时建层 | `J:script/OverlayTrackPlayer.java — createObjectLayer（140-195）` | `layer_type` 分派；image→`VideoFiles.isVideo` 分流；subtitle→`LangResources.resolve` |
| 参数计算 | `J:script/OverlayClipRuntime.java — compute（152-161）`、`fadeParams（162-217）`、`imageParams（218-241）`、`subtitleParams（242-291）` | `appliesTo` 在运行时按类型读取 |
| 校验 | `J:script/object/ObjectValidator.java — checkOverlay（691-721）` | `layer_type` 非空；`appliesTo` 不适用报错；image path 扩展名白名单 |
| 扩展名 | `ObjectValidator.java:51` | `png/gif/mp4/webm/mkv` |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 通用表单，不读 `appliesTo` |
| 旧类型 | `EDITOR:src/types.ts:177` | `layer_type:'pip'`（已移除） |
| 分组工具 | `EDITOR:src/schema.ts:12-39` | 可按 section 分组（旧 shape） |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 类型 | 通用字符串/旧 `pip` | `fade/image/subtitle` 三选一 |
| 字段门禁 | 无 | 按 `appliesTo` 显示/禁用 |
| 布局 | 平铺数字框 | 分组 + 锚点/缩放语义 |
| 源裁切 | 无 | `source.x/y/w/h` + 预览框 |
| 颜色/遮罩/渐变 | 无 | 见 02 |
| 文本/字号 | 无 | 见 03 |
| 视频 | 无 | 见 04 |
| 类型切换 | 无 | 保留值 + 标「不生效」 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/OverlayTrackPanel.vue`（提案）：画面页容器。
- `EDITOR:src/components/overlay/OverlayLayoutGroup.vue`（提案）：布局/透明度。
- `EDITOR:src/components/overlay/OverlayTypeSwitch.vue`（提案）：三形态切换 + 不生效值提示。
- `EDITOR:src/lib/overlayFields.ts`（提案）：从 `ObjectDef.appliesTo` 派生「当前类型可用字段」的纯函数；**不是**字段表。

## 4. 输入输出与字段约束

**输入**：`schema.tracks.OVERLAY.objects`、当前片段 JSON、选区。

**输出**：对象叶子编辑意图；类型切换是单字段编辑（`layer_type`），不删除其他字段。

| 字段 | 约束 |
|---|---|
| `layer_type` | `fade/image/subtitle`；required；切换不删值 |
| `x/y/anchor_x/anchor_y` | 0–1 归一化；默认 0.5 |
| `scale_x/scale_y` | 默认 1 |
| `source.x/y/w/h` | 仅 image；0–1；w/h 默认 1 |
| `opacity` | 0–1；默认 1 |
| `font_scale` | 仅 subtitle；默认 1 |
| `color.r/g/b` | 仅 fade；0–1（ANIMATED）；默认 0 |
| `color` | STRING `#RRGGBB`；默认 `#000000`；编辑器按正则拦截 |
| `gradient` | 仅 fade；STRUCT；`{type, angle, center_x, center_y, radius, stops}` |
| `mask_shape` | 仅 fade；`full/rect/circle` |
| `blend_mode` | 仅 fade；`normal/multiply/screen/soft_light/overlay` |
| `mask_*` | 仅 fade；归一化；`mask_width/height/radius` min 0 |
| `gradient_*` | 仅 fade；归一化；`gradient_radius` min 0 |
| `path` | image/video 素材路径；subtitle 忽略 |
| `text` | subtitle 文本；支持 `\n` 与 `@lang:` |
| `z_index` | INT 默认 10；越大越上 |

**禁止**：把 `color` 写成 `{r,g,b}`（动画通道是 `color.r/g/b`，字符串是 `color`，两者同名不同层，必须按 schema 区分）；把 `gradient` 写成字符串；把 `mask_shape` 写成 `shape`；恢复 `pip`。

## 5. 修改步骤

1. 读 01 的 `schema.get`，确认 `overlay.objects` 的 `appliesTo/section/min/max/enumValues` 齐全。
2. 新建 `overlayFields.ts`：输入 `layerType` + `ObjectDef` 映射，输出可用字段列表（`appliesTo` 为空 = 全类型可用）。
3. 新建 `OverlayTrackPanel`：顶部 `OverlayTypeSwitch`，下面按 section 生成组；不可用字段不渲染（或渲染为禁用 + 「不适用于当前类型」）。
4. `OverlayLayoutGroup`：x/y/anchor/scale/opacity/z_index；归一化提示；`z_index` 与 06 的顺序页联动。
5. 类型切换：写 `layer_type`；其他形态已填值保留，面板显示「已填但不生效」清单；不自动删除。
6. 在 05 的检查器宿主注册「画面」页；选中 OVERLAY 片段默认打开。
7. 删除旧 `ClipPanel` 对 OVERLAY 的通用分支；删除 `types.ts` 的 `pip`（迁移旧稿时按运行时拒绝，不做兼容垫片）。
8. 与 06 的顺序页共享 `z_index` 编辑动作；与 02/03/04 共享子表单容器。

## 6. 禁止修改

- 不得改 `overlayObjects()` 的字段名/默认值/`appliesTo`。
- 不得新增 `layer_type` 或恢复 `pip`。
- 不得在 TS 里复制字段表/枚举表。
- 不得在类型切换时删除其他形态的值。
- 不得把 `color`（STRING）与 `color.r/g/b`（ANIMATED）混为一个控件。
- 不得把 `z_index` 当渲染顺序的唯一真值（`OverlayManager` 插入实现也影响同值顺序）。

## 7. 两分支承载

- **WebUI**：三形态字段面 + 门禁；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时完整实现同字段面板/appliesTo门禁，经03公共端口预览，不重写OverlayClipRuntime；本轮 WebUI→Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `OverlayTrackPlayer`/`OverlayClipRuntime`/`ObjectValidator`。

## 8. 前置

- 01：`overlay.objects` 完整导出。
- 02：对象叶子路径 + 原子提交。
- 05：检查器宿主。
- 06：异步属性控件。
- 08：全屏层与 CAMERA lane 的边界（08-03）。

## 9. 验收

**正例**

- `layer_type=fade`：只显示布局/颜色/遮罩/渐变/透明度/z；`source`/`font_scale`/`text` 不显示。
- 切到 `image`：显示 `source`/`path`；fade 的 `color` 值保留但标注「不生效」；切回 fade 值还在。
- 切到 `subtitle`：显示 `text`/`font_scale`；`source` 隐藏。
- `color` 输入 `#ff0000`：接受；输入 `red`/`#ff00`：编辑期红条，不写盘。
- `z_index=10`：与 06 的顺序页一致；改成 30 后列表位置变化。
- 旧稿含 `layer_type=pip`：打开时明确报「已移除」，不静默改写。

**反例**

- `font_scale` 出现在 fade 上且可写 → 失败（`appliesTo` 门禁失效）。
- 类型切换删除其他形态的值 → 失败。
- `color` 写成 `{r,g,b}` → 失败。
- `pip` 被接受并保存 → 失败。
- 字段表在 TS 里硬编码 → 失败。
- 面板能打开但保存后 `ObjectValidator` 报不适用字段 → 失败。

## 10. 真实冒烟

1. 用真实 schema 打开含 fade/image/subtitle 三种片段的脚本。
2. 逐个切换类型：字段显示/隐藏/保留正确；保存后 JSON 不丢未生效值。
3. 写非法 `color`：编辑期拦截；改成合法值后保存，游戏内正常。
4. 旧稿 `pip`：打开报错，手工改成 `fade` 后正常。
5. 保存 → 重载 → `ObjectValidator` 通过；游戏内三种层都出现。

## 11. 完成定义

- 三形态字段面完整；`appliesTo` 门禁生效；`pip` 不再出现。
- 类型切换保留值并标注不生效；保存/重载无损。
- 颜色按 `#RRGGBB` 拦截；不冒充服务端校验。
- 旧 OVERLAY 通用分支已删除，调用方迁移完成。
- 正例/反例/冒烟全部通过。
