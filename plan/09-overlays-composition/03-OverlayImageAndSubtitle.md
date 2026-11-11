# 09-03 图像与字幕底层参数（OverlayImageAndSubtitle）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：09-overlays-composition
> 关联：`01-OverlayTrackSurface.md`、`02-OverlayFadeAndMask.md`、`../12-templates-flight-tools/20-SubtitleImportService.md`、`../12-templates-flight-tools/21-SubtitleBatchSession.md`、`../12-templates-flight-tools/22-SubtitleScriptCompiler.md`、`../12-templates-flight-tools/23-SubtitleBatchPanel.md`

## 1. 职责

编辑 image 形态的素材路径/裁切/布局，与 subtitle 形态的文本/字号/布局/透明度/zIndex；解释 `@lang:` 引用、GIF 上限、分辨率转义。两者都是**片段效果控件（`clip.effects`）覆盖层组内的形态分支**：image/subtitle 的行与同片段其他组同时可见，行内值提交与节点列由 06 统一提供。**字幕批量导入/批量会话/编译器/面板归 12.20–12.23**；本文件只做单片段底层参数，并为 12 提供字段合同与跳转。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| image/subtitle 字段 | `J:script/schema/TrackSchemas.java:406-417`、`:453-455` | `source.x/y/w/h`（image）、`font_scale`（subtitle）、`path`、`text`、`z_index` |
| 建层分派 | `J:script/OverlayTrackPlayer.java — createObjectLayer（140-195）` | image → `VideoFiles.isVideo` 分流 `VideoLayer`/`ImageLayer`；subtitle → `LangResources.resolve` |
| 参数应用 | `OverlayTrackPlayer.java — applyObjectParams（196-233）` | 布局/透明度/字号/文本 |
| 参数计算 | `J:script/OverlayClipRuntime.java — imageParams（218-241）`、`subtitleParams（242-291）` | `OverlayParams` |
| 图像渲染 | `J:overlay/ImageLayer.java — render（70-130）` | GIF update、source 裁切、`ImageGeometry`、亚像素 pose |
| 图像设置 | `ImageLayer.java — setTexture（153-160）`、`setTime（161-164）`、`setSource（188-195）`、`setBaseResolution（196-200）` | |
| 几何 | `J:overlay/ImageGeometry.java — compute（46-56）` | 归一化 x/y/anchor/scale → 屏幕矩形 |
| 画布 | `J:overlay/CanvasTransform.java — DEFAULT_*（26-44）`、`resolutionEscape（64-86）`、`element（87-100）` | 基准 1920×1080；转义系数 k |
| 字幕渲染 | `J:overlay/SubtitleLayer.java — render（55-103）` | alpha<4 跳过、`\n` 分行、`resolutionEscape`、`CanvasTransform.element`、两级矩阵缩放 |
| 字幕设置 | `SubtitleLayer.java — setText（128-131）`、`setOpacity（132-136）`、`setPosition（137-142）`、`setAnchor（143-148）`、`setFontScale（149-153）`、`setScale（154-159）`、`setBaseResolution（160-164）`、`setZIndex（165-）` | 无颜色字段 |
| 文本引用 | `J:util/LangResources.java — PREFIX（39）`、`ESCAPED_PREFIX（41）`、`resolve（68-99）`、`isReference（100-）` | `@lang:`；`@@lang:` 转义 |
| 基准分辨率 | `J:script/schema/MetaSchemas.java:24-25`、`J:script/ScriptParser.java — parseBaseResolution（1269-）` | `meta.base_resolution` 缺省 1920×1080 |
| 纹理加载 | `J:util/TextureLoader.java — MAX_GIF_FRAMES（50）`、`MAX_GIF_DIMENSION（51）`、`loadTexture（62-120）` | GIF 最多 256 帧、单边 1024 |
| 扩展名 | `J:script/object/ObjectValidator.java:51` | `png/gif/mp4/webm/mkv`；image path 校验在 `checkOverlay（691-721）` |
| 资源列表 | `J:webui/ResourceFileService.java:46` | `IMAGE_EXT` 只有 `png/gif` |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 无 source/font/text 控件 |
| 字幕批量（12） | `plan/12-templates-flight-tools/20-SubtitleImportService.md`、`21-SubtitleBatchSession.md`、`22-SubtitleScriptCompiler.md`、`23-SubtitleBatchPanel.md` | cue 中间模型、批量面板；**本轮不实现** |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| image 路径 | 通用文本 | 资源选择/路径输入 + 扩展名校验 |
| source 裁切 | 无 | x/y/w/h + 预览框（真实画面） |
| 布局 | 平铺 | x/y/anchor/scale + 归一化 |
| subtitle 文本 | 无 | 多行编辑器；`\n`；`@lang:` 解析 |
| 字号 | 无 | `font_scale` + 基准分辨率说明 |
| 分辨率转义 | 无 | 解释 k 与 `meta.base_resolution` |
| GIF 上限 | 无 | 超限提示（256 帧/1024 边） |
| 批量 | 无 | 跳 12.23；不实现 cue/导入 |
| 承载 | 无（旧表单） | `clip.effects` 覆盖层组的 image/subtitle 形态分支，行与节点列由 06 提供 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/ImageEditor.vue`（提案）：作为覆盖层组 image 分支的行内容（路径/source/布局），不是独立面板。
- `EDITOR:src/components/overlay/SubtitleEditor.vue`（提案）：subtitle 分支的行内容（文本/字号/布局/透明度/zIndex + `@lang:` 状态），不是独立面板。
- `EDITOR:src/components/overlay/ResolutionHint.vue`（提案）：基准分辨率/转义系数说明。
- `EDITOR:src/lib/langRef.ts`（提案）：`@lang:`/`@@lang:` 的识别与键提取；解析结果来自宿主 `resource.list`（lang），不在前端读文件。
- `EDITOR:src/lib/imageAsset.ts`（提案）：扩展名/路径校验（png/gif/mp4/webm/mkv）与「视频走 04」分流。

四个组件都只产出叶子编辑意图；行的选择、秒表、节点与局部标尺由 `06-EffectControlsRows` 负责。

## 4. 输入输出与字段约束

**输入**：image/subtitle 片段 JSON、`meta.base_resolution`、`resource.list`（image/lang）回执、真实画面、共享 Selection（`clip.effects` 行上的 `objectPath`；片段可在主时间轴选）。

**输出**：对 `path`/`source.*`/`text`/`font_scale`/`x/y/anchor/scale`/`opacity`/`z_index` 的编辑意图（交给 02 命令，并回填同一 Selection）。

| 字段 | 约束 |
|---|---|
| `path` | 相对 `ResourcePath.getBasePath()` 的路径；image 扩展名 `png/gif/mp4/webm/mkv`；视频扩展名由 04 接管 |
| `source.x/y/w/h` | 仅 image；0–1；w/h 默认 1 |
| `x/y/anchor_x/anchor_y` | 0–1；默认 0.5 |
| `scale_x/scale_y` | 默认 1 |
| `text` | subtitle；支持 `\n`；`@lang:` 引用；`@@lang:` 转义 |
| `font_scale` | subtitle；默认 1 |
| `opacity` | 0–1 |
| `z_index` | INT 默认 10 |
| `meta.base_resolution` | `{w,h}` 正整数；缺省 1920×1080；`resolutionEscape` 的分母 |

**必须显示的边界**：

- image 的 `path` 为空 → 层创建失败/无纹理；编辑器标注「必填」。
- GIF 超过 256 帧或单边 >1024 → `TextureLoader` 拒绝；编辑器在资源信息中提示（若宿主提供尺寸/帧数）。
- 字幕 alpha<4 被跳过（`SubtitleLayer.render`）；透明度为 0 时画面不可见，UI 不显示「已渲染」。
- `@lang:` 键缺失 → `LangResources.resolve` 回退原文；UI 标注「键缺失，显示原文」。
- `resolutionEscape` 以 `meta.base_resolution` 为分母；改基准分辨率会影响所有字幕/图像的像素尺寸。
- **字幕批量导入**：cue 中间模型不进入运行时脚本（12.20 明确）；本文件不定义 cue 字段，只消费最终 `text`/时间。

## 5. 修改步骤

1. 新建 `imageAsset.ts`：扩展名白名单、路径规范化、视频分流（`mp4/webm/mkv` → 04）。
2. 新建 `langRef.ts`：识别 `@lang:`/`@@lang:`，提取键；用 `resource.list(kind=lang)` 的结果标注存在/缺失；不做本地文件读取。
3. 新建 `ImageEditor`：路径输入 + 资源选择（image 列表）+ `source` 裁切 + 布局；GIF 提示。作为覆盖层组 image 分支的行内容。
4. 新建 `SubtitleEditor`：多行文本（`\n`）、字号、布局、透明度、zIndex；`@lang:` 状态徽标；「批量导入」按钮跳 12.23。作为 subtitle 分支的行内容。
5. `ResolutionHint`：显示 `meta.base_resolution`、`resolutionEscape` 的 k 与「1920×1080 基准」；修改基准时提示影响范围。
6. 在 `06-ClipEffectControlsPanel` 的覆盖层组内注册 image/subtitle 形态分支；`appliesTo` 门禁由 01 提供，行/节点/局部标尺由 06-EffectControlsRows 提供。
7. 字幕分支不提供颜色控件（`SubtitleLayer` 无颜色字段）；`color` 字符串只在 fade 的颜色组显示（02）。
8. 保存后重载：文本/路径/裁切/字号逐值一致；游戏内图像/字幕位置与 UI 一致。
9. 选中 image/subtitle 叶子时保持同一 Selection：效果控件行高亮、快捷属性显示摘要；不新增独立面板，也不把节点写到主时间轴。

## 6. 禁止修改

- 不得改 `ImageLayer`/`SubtitleLayer`/`ImageGeometry`/`CanvasTransform` 的渲染/几何/转义语义。
- 不得在前端解码 GIF/加载纹理/渲染字幕。
- 不得把 `@lang:` 的解析结果写回 `text`（保留引用）。
- 不得新增字幕字段（颜色/描边/字体族等运行时没有的）。
- 不得在本文件实现 cue 导入/批量/编译器（12.20–12.23）。
- 不得把视频路径交给 image 编辑器（04 接管）。
- 不得把 image/subtitle 分支做成独立检查器页、卡片或单属性切页；不因选中一行隐藏同片段其他已展开组。
- 不得让快捷属性另存一份 `text`/`path`/裁切值或自带关键帧时间轴。

## 7. 两分支承载

- **WebUI**：image/subtitle 编辑器 + `@lang:` 状态；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时完整实现图像/字幕参数控件，真实字形与资源解析由主模组承担；本轮 WebUI 对接 Forge/Fabric 均正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。外部字幕批次工作流由12.20–23完整完成，不用本面板代替。
- 两分支的权威都是 `ImageLayer`/`SubtitleLayer`/`LangResources`/`TextureLoader`。

## 8. 前置

- 01：image/subtitle 字段面与 `appliesTo` 门禁。
- 02：对象叶子路径 + 原子提交。
- 03：真实画面 + `resource.list`（image/lang）回执。
- 06：`clip.effects`（`06-ClipEffectControlsPanel` + `06-EffectControlsRows` + `06-PropertyValueForm`）与 `selection.properties`。
- 12.20–12.23：字幕批量导入/会话/编译/面板（本文件只引用）。

## 9. 验收

**正例**

- image `path=ui/logo.png`、`source={0,0,0.5,1}`：游戏内只显示左半；UI 裁切框一致。
- GIF 300 帧：资源信息标注「超过 256 帧，运行时拒绝」；不静默保存成可用。
- subtitle `text=第一行\n第二行`：游戏内两行；UI 保留 `\n`。
- `text=@lang:cinematic.intro`：键存在时显示解析值；缺失时标注「显示原文」；保存保留引用。
- `font_scale=1.5`：字幕变大；改 `meta.base_resolution` 后位置/字号按转义变化。
- `opacity=0.01`（alpha<4）：UI 标注「不可见（运行时跳过）」。
- 点击「批量导入」跳 12.23；返回后单片段参数不变。
- 同时展开字幕/布局/合成组：改 `font_scale` 时 `z_index` 行仍在；右列节点各自对齐；主时间轴片段高度不变。
- 在快捷属性里改 `opacity` → 效果控件同名行同步，标准文档只变一处。

**反例**

- 前端解码 GIF 并显示帧预览 → 失败（真实画面来自游戏）。
- 把 `@lang:` 解析值写回 `text` → 失败。
- 字幕分支出现颜色/描边字段 → 失败（运行时没有）。
- 视频路径被 image 编辑器接受并当图片 → 失败（应分流 04）。
- 在本轮实现 cue 表格/导入 → 失败（12.20–12.23）。
- GIF 超限仍标记「可用」→ 失败。
- 为字幕/image 新开独占面板，或选中一行后同片段其他组消失 → 失败。
- 把字幕行/节点画到主时间轴 → 失败。

## 10. 真实冒烟

1. 造 image（png）+ subtitle（多行 + `@lang:`）片段。
2. 游戏内：图像位置/裁切/缩放正确；字幕两行、字号正确。
3. 改 `source.w=0.5`、`font_scale=1.5`、`z_index=30`：画面同步；与 06 的顺序页一致。
4. 用 300 帧 GIF：运行时拒绝/降级；编辑器提示一致。
5. `@lang:` 缺失键：游戏内显示原文；编辑器标注一致。
6. 从字幕组跳 12.23：批量导入流程独立，返回后单片段不变。

## 11. 完成定义

- image 的 `path/source/布局` 与 subtitle 的 `text/font_scale/布局/透明度/z_index` 全部可编辑，且都落在 `clip.effects` 覆盖层组的行上。
- 同一片段多组同时可见；快捷属性只复用同一值与命令，主时间轴无字幕/图像行或节点。
- `@lang:`/`@@lang:`、GIF 上限、分辨率转义、alpha<4 都有明确提示。
- 不新增运行时没有的字幕字段；不做本地渲染/解码。
- 字幕批量导入明确指向 12.20–12.23，本文件不实现 cue 模型。
- 正例/反例/冒烟全部通过。
