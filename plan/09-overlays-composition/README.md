# 09 覆盖层、遮幅与合成顺序

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划；现有运行时是消费对象，不是本轮成果）
> 范围：OVERLAY 三形态（fade/image/subtitle）的字段面、遮罩/渐变/混合、图像与字幕的底层参数、视频覆盖层、LETTERBOX 遮幅、全屏层合成顺序。不含 CAMERA lane 合成（08）、音频/调色（10）、字幕批量导入（12.20–12.23）、主题与面板移动（05）。
> 前置：06（异步对象与属性关键帧）、08（镜头与 lane 合成边界）；共同前置 01/02/03。
> 关联：`../05-timeline-workspace/README.md`、`../08-camera-transitions/03-LaneCompositionPanel.md`、`../12-templates-flight-tools/20-SubtitleImportService.md`、`../12-templates-flight-tools/23-SubtitleBatchPanel.md`

**路径记号**：`MOD:` = `ImmersiveCinematics/`；`J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`EDITOR:` = `ImmersiveCinematicsEditor/`（webui 分支）；`INGAME:` = 编辑器仓库 `1.20.1` 分支（只 `git show` 读）。行号是 2026-11-11 的核查坐标，改动后以符号为准。

## 一、摘要

本轮把 OVERLAY 从「一个通用表单 + 一个 `layer_type` 下拉」补成三形态各自的完整编辑面：fade 的颜色/渐变/遮罩/混合，image 的素材路径/裁切/布局，subtitle 的文本/字号/分辨率转义；并把视频覆盖层的降级路径、LETTERBOX 的全局遮幅语义、全屏层的 zIndex 合成顺序做成可读可编辑的界面。

一句话验收：作者能在编辑器里写出一个**主模组 `OverlayTrackPlayer` 能创建、`ObjectValidator.checkOverlay` 能通过、游戏内按 zIndex 正确叠加**的 OVERLAY/LETTERBOX 脚本；字幕只做单片段底层参数，批量导入由 12 承接并复用本轮的字段合同。

现状（起点，不是本轮成果）：

| 事实 | 锚点 |
|---|---|
| 编辑器 OVERLAY 只有通用字段表单，`layer_type` 作为普通字符串 | `EDITOR:src/components/ClipPanel.vue:8-20`、`DynamicForm.vue` |
| 旧类型含已移除的 `layer_type:'pip'` | `EDITOR:src/types.ts:177`（旧模型） |
| 时间轴只显示 OVERLAY 的颜色/标签 | `EDITOR:src/components/Timeline.vue:166`、`:178`、`:191` |
| 无遮罩/渐变/混合编辑器 | 无组件 |
| 无字幕参数（字号/转义）编辑 | 无组件 |
| 视频层无 UI（只有通用 `path`） | 无组件 |
| 遮幅无 UI | 无组件 |
| 合成顺序无 UI | 无组件；`OverlayManager` 仅在运行时排序 |

## 二、为什么做

### 2.1 问题

- **三形态字段错配**：`overlayObjects()` 用 `appliesTo` 把字段绑到 `fade/image/subtitle`（`J:script/schema/TrackSchemas.java:398-457`），旧表单不读 `appliesTo`，于是 `font_scale` 出现在 fade 上、`mask_shape` 出现在 subtitle 上；`ObjectValidator.checkOverlay（691-721）` 会对「不适用于 layer_type」的字段报错，作者保存后才发现。
- **遮罩/渐变不可编辑**：fade 的颜色/渐变/遮罩是 `color`（STRING）、`gradient`（STRUCT）、`mask_shape`/`blend_mode`（ENUM）+ `mask_*`/`gradient_*`（ANIMATED），运行时有完整的 `ColorMaskSpec`/`ColorMaskRenderer`（`J:script/ColorMaskSpec.java:68-266`、`J:overlay/ColorMaskRenderer.java:52-772`），编辑器一个都写不出来。
- **颜色无校验**：`ScriptValidator.checkHexColor（1974-）` 只被规则动作 `overlay_set` 调用（`:1629`），OVERLAY 轨道的 `color` 没有校验；非法颜色会在 `ColorMaskSpec.parseColor（238-266）` 抛 `InvalidColorMaskException`，整轨失效。编辑器必须在编辑期按同一正则拦截。
- **图像/字幕参数缺失**：`source.*`（裁切）、`ImageGeometry.compute（46-56）`、`SubtitleLayer` 的 `resolutionEscape`/两级矩阵缩放（`J:overlay/SubtitleLayer.java:55-103`、`J:overlay/CanvasTransform.java:64-100`）都是运行时真实能力，编辑器没有入口。
- **视频降级不可见**：`VideoFiles.isVideo（26-35）` 分流到 `VideoLayer`；缺 ffmpeg → `unavailable`，探测失败 → `ErrorTexture`，解码失败 → `markError`（`J:media/video/VideoLayer.java:200-315`）。作者在编辑器里看不到「这条视频会不会变成棋盘格」。
- **遮幅语义不清**：`LetterboxTrackPlayer` 无活跃 clip 时把 `aspect_ratio` 归 0、`opacity` 复位（`J:script/LetterboxTrackPlayer.java:59-83`），`LetterboxLayer` 固定 `Z_INDEX=0`、淡出 0.5s（`J:overlay/LetterboxLayer.java:21-24`）；编辑器只有一个通用字段。
- **合成顺序不可见**：`OverlayManager.addLayer` 按 zIndex 排序、`removeLayer` 调 `close()`、`startFadeOut` 按 owner（`J:overlay/OverlayManager.java:43-193`）；`OverlayLayer` javadoc 明确建议 0=遮幅、10=脚本默认、30=字幕、200=转场遮罩。作者不知道自己的层会不会被压住。

### 2.2 目标

1. OVERLAY 三形态各自的字段面在**片段效果控件（`clip.effects`）的覆盖层组**内完整可编辑，叶子成行、多个组可同时展开；`appliesTo` 作为门禁，不适用字段不显示/不可写。不为单个叶子新开独占面板。
2. fade 的颜色/渐变/遮罩/混合可编辑；颜色按 `#RRGGBB` 校验；高级遮罩与快速路径的差异可解释。
3. image 的 `path`/`source` 裁切/布局可编辑；GIF 帧上限与纹理加载失败有提示。
4. subtitle 的 `text`/`font_scale`/布局/透明度可编辑；`@lang:` 引用可解析；分辨率转义可解释。**批量导入/批量会话/编译/面板归 12.20–12.23**，本轮只提供单片段底层参数并引用。字幕没有颜色字段（`SubtitleLayer` 不读 `color`），颜色控件只出现在 fade 形态。
5. 视频覆盖层可编辑 `path` + 布局 + `source` + `opacity` + `z_index`；缺 ffmpeg/探测失败/解码失败有明确降级提示。
6. LETTERBOX 的 `aspect_ratio`/`opacity` 可编辑；「无活跃片段 → 复位」的语义可见。
7. 全屏层合成顺序可读可调：zIndex 列表、默认层建议、同值冲突提示、跳转到片段。

### 2.3 非目标

- 不重写 `OverlayManager`/`FadeLayer`/`ImageLayer`/`SubtitleLayer`/`VideoLayer`/`ColorMaskRenderer`。
- 不新增 OVERLAY 字段、不新增 `layer_type`、不恢复 `pip`。
- 不做字幕批量导入/批量编辑/编译器（12.20–12.23）；不做 ASS/SSA 复杂样式。
- 不做本地图像/视频渲染预览替代真实游戏画面。
- 不做主题/面板移动（05 的主代理任务）。
- 不做 CAMERA lane 的 `dest/source/mask`（08-03）；本轮只做全屏层。

## 三、方案

### 3.1 用起来是什么样

**效果控件·覆盖层组**（选中 OVERLAY 片段时，在 `clip.effects` 内）：顶部 `layer_type` 三选一（fade/image/subtitle），切换时只改类型、不删除其他形态已填值（但标注「不生效」）。下面按 `section` 分组，组内每个叶子一行（名称、值、秒表、前后节点），右侧是该属性自己的节点；组可折叠且可同时展开。

| 分组 | fade | image | subtitle |
|---|---|---|---|
| 布局 | x/y/anchor/scale | 同左 | 同左 |
| 源 | — | `source.x/y/w/h`、`path` | — |
| 文本 | — | — | `text`、`font_scale` |
| 颜色 | `color`、`gradient`、`mask_shape`、`blend_mode`、`mask_*`、`gradient_*` | — | —（字幕无颜色字段；`SubtitleLayer` 不读 `color`） |
| 合成 | `opacity`、`z_index` | `opacity`、`z_index` | `opacity`、`z_index` |

`appliesTo` 是行的存在性门禁：不适用于当前 `layer_type` 的叶子不出现（或禁用并标注），不能让作者写出 `checkOverlay` 会拒的键。

**遮罩子编辑器**（fade 形态的颜色组内）：形状 `full/rect/circle` + 中心/宽高/半径；渐变 `linear/radial` + 角度/中心/半径 + 色标列表；混合 `normal/multiply/screen/soft_light/overlay`。右侧实时显示「快速路径 / shader 路径」判定：纯色 + full + normal → `GuiGraphics.fill`；其余 → `ColorMaskRenderer`。

**字幕组**（subtitle 形态，效果控件内）：多行文本（`\n` 分行）、字号、透明度、zIndex、对齐/锚点；`@lang:` 引用显示解析结果或「键缺失」；分辨率转义说明（基准 1920×1080，`resolutionEscape` 系数 k）。右上角一个「批量导入」入口，跳 12.23（本页不实现批量）。选中字幕组不会隐藏布局/合成组，也不打开独占页。

**视频组**（image 形态且 `path` 扩展名是 mp4/webm/mkv）：路径、布局、`source` 裁切、`opacity`、`z_index`；状态徽标：`ffmpeg 可用/缺失`、`探测中/失败`、`解码中/失败`；失败时说明会显示 `ErrorTexture` 棋盘格。视频音轨归 10。

**遮幅组**（选中 LETTERBOX 片段时，效果控件内）：`aspect_ratio` 预设（2.35/2.39/1.85/16:9/4:3/自定义）+ `opacity`；说明「无活跃片段 → 比例归 0、透明度复位」「淡出 0.5s」「Z=0 永远在最底」。遮幅有自己的轨道，不混入 OVERLAY 组。

**合成顺序页**（文档级面板，可停靠在 05 布局树；不是片段效果控件组）：按 zIndex 升序的层列表（越小越底），显示来源片段/类型/zIndex；默认层建议（0 遮幅、10 脚本默认、30 字幕、200 转场遮罩）；同值冲突提示；点击跳转。**不是** CAMERA lane 的合成（08-03），也不替代字段编辑。

### 3.2 边界

- 所有编辑走 02 的文档命令；本轮不新增消息。
- OVERLAY/LETTERBOX 字段编辑的唯一承载是 `clip.effects` 的覆盖层/遮幅组；不存在"每个叶子一个独立面板"，也不存在把整组做成独占检查器页。`selection.properties` 只显示当前图层类型、资源/文本与选中参数，并定位回效果控件，不缓存第二份值或时间轴。
- 主时间轴只显示/选择 OVERLAY、LETTERBOX 片段，不展开组、属性行、节点或关键帧汇总。
- 画面真值来自 03；本轮不实现本地合成预览。
- 字幕只做单片段底层参数；批量导入/批量会话/编译/面板是 12.20–12.23。
- LETTERBOX 的 `aspect_ratio`/`opacity` 是片段字段；「无活跃片段复位」是运行时行为，不是脚本字段。
- 合成顺序只管全屏层（OVERLAY + LETTERBOX）；CAMERA lane 的 `dest/source/mask` 归 08-03。
- 不恢复旧 `layer_type:'pip'`；不新增 `attenuation:'inverse'` 之类的旧值；不添加运行时没有的字幕颜色/描边字段。

## 四、技术细节

### 4.1 核心模型

| 模型 | 承载 | 职责 |
|---|---|---|
| 轨道驱动 | `J:script/OverlayTrackPlayer.java` | `onRenderFrame（62-97）`（clip 切换建层/删层）、`createObjectLayer（140-195）`（fade/image→`VideoFiles.isVideo` 分流 `VideoLayer`/`ImageLayer`；subtitle→`LangResources.resolve`）、`applyObjectParams（196-233）`、`clipRuntime（127-139）` |
| 参数计算 | `J:script/OverlayClipRuntime.java` | `SLOT_*（40-63）`、`of（101-151）`、`compute（152-161）`、`fadeParams（162-217）`、`imageParams（218-241）`、`subtitleParams（242-291）`、`OverlayParams（292-）` |
| 管理器 | `J:overlay/OverlayManager.java` | `render（43-65）`、`addLayer（66-76）`、`removeLayer（77-89）`、`getLayers（90-106）`、`update（107-131）`、`isAnimating（132-142）`、`isAnyAnimating（143-154）`、`startFadeOut（155-168）`、`removeLayersOf（169-187）`、`reset（188-）` |
| 层接口 | `J:overlay/OverlayLayer.java` | `render/isVisible/getZIndex/owner/reset/tick/setTime/startFadeOut/isAnimating/close`（`23-92`） |
| fade | `J:overlay/FadeLayer.java` | `render（67-98）`、`isAdvancedMask（92-98）`、`setColor（154-174）`、`setMaskSpec（175-187）`、`setMaskGeometry（188-196）`、`setGradientGeometry（197-204）`、`setColorRgb（205-211）`、`close（212-）` |
| 遮罩规格 | `J:script/ColorMaskSpec.java` | `DEFAULT_*（24-28）`、`forObjects（68-81）`、`rgb（82-94）`、`hasGradient（95-102）`、`gradientType（103-110）`、`stopOffsets/stopColors（111-123）`、`maskShape（124-131）`、`blendMode（132-）`、`parseGradient（163-237）`、`parseColor（238-266）`、`InvalidColorMaskException（267-）` |
| 遮罩渲染 | `J:overlay/ColorMaskRenderer.java` | `SHADER_NAME（52）`、`LUT_SIZE（55）`、形状/渐变/混合编码（`57-69`）、`REQUIRED_UNIFORMS（72-78）`、`render（138-）` |
| 图像 | `J:overlay/ImageLayer.java` | `render（70-130）`（GIF update、source 裁切、`ImageGeometry`、亚像素 pose）、`setTexture（153-160）`、`setTime（161-164）`、`setSource（188-195）`、`setBaseResolution（196-200）` |
| 几何 | `J:overlay/ImageGeometry.java` | `compute（46-56）` |
| 画布 | `J:overlay/CanvasTransform.java` | `DEFAULT_*（26-44）`、`resolutionEscape（64-86）`、`element（87-100）` |
| 字幕 | `J:overlay/SubtitleLayer.java` | `render（55-103）`（alpha<4 跳过、`\n` 分行、`resolutionEscape`、`CanvasTransform.element`、两级矩阵缩放）、`setText（128-131）`、`setFontScale（149-153）` |
| 视频 | `J:media/video/VideoFiles.java` | `VIDEO_EXTENSIONS（15）`、`isVideo（26-35）`、`extension（36-）` |
| 视频层 | `J:media/video/VideoLayer.java` | `setTime（115-123）`、`render（124-199）`、`ensureStarted（200-240）`、`updateFrame（241-274）`、`checkDecodeFailure（275-288）`、`markError（289-301）`、`reset（333-338）`、`close（339-）` |
| 探测/解码 | `J:media/video/VideoProbe.java`（`probe 46-76`、`TIMEOUT_SECONDS 28`、`FALLBACK_FPS 29`）、`J:media/video/VideoDecoder.java`（`QUEUE_CAPACITY 38`、`start 100-149`、`seek 150-162`、`poll 163-175`、`pollAtOrBefore 176-190`） | 5s 超时；队列 3 |
| 降级纹理 | `J:media/ErrorTexture.java` | `WIDTH/HEIGHT（23/26）`、`texture（57-）`；16×9 棋盘、1920×1080 |
| ffmpeg | `J:media/video/Ffmpeg.java` | `ffmpeg（45-49）`、`ffprobe（55-59）`、`available（61-63）`、`encoderAvailable（66-68）`；固定 `<gameDir>/ffmpeg/` |
| 文本资源 | `J:util/LangResources.java` | `PREFIX（39）`、`ESCAPED_PREFIX（41）`、`resolve（68-99）`、`isReference（100-）` |
| 纹理加载 | `J:util/TextureLoader.java` | `MAX_GIF_FRAMES（50）`、`MAX_GIF_DIMENSION（51）`、`loadTexture（62-120）`、`getTextureSize（194-198）` |
| 资源路径 | `J:util/ResourcePath.java` | `getBasePath（24-30）`、`resolve（31-34）`、`exists（35-39）` |
| 遮幅驱动 | `J:script/LetterboxTrackPlayer.java` | `DEFAULT_ASPECT_RATIO（21）`、`SLOT_*（24-25）`、`compute（84-95）`、`onRenderFrame（59-83）`、`onStop（-）` |
| 遮幅层 | `J:overlay/LetterboxLayer.java` | `Z_INDEX（21）`、`FADE_OUT_SECONDS（24）`、`render（45-66）`、`tick（90-96）`、`startFadeOut（97-103）`、`setAspectRatio（114-118）`、`setOpacity（119-）` |

### 4.2 契约

- **三形态唯一入口**：`layer_type` ∈ `fade/image/subtitle`（`TrackSchemas.java:443-444`，required）；不存在 `pip`。
- **效果控件组派生**：OVERLAY/LETTERBOX 的组按 `section` 生成，叶子行由 `ObjectDef` 的 `mode/type/interp/appliesTo/unit` 驱动；左参数列与右节点列共用 06-EffectControlsRows 的行布局与局部标尺，值提交走 06-PropertyValueForm。组是 UI 组织，不写脚本、不造图层实例。
- **字段适用性**：`ObjectDef.appliesTo` 是唯一门禁；`ObjectValidator.checkOverlay（691-721）` 会对不适用字段报错。编辑器不显示不适用字段，或显示为禁用并标注。
- **图像扩展名**：`ObjectValidator.IMAGE_EXTENSIONS` = `png/gif/mp4/webm/mkv`（`J:script/object/ObjectValidator.java:51`）；`ResourceFileService.IMAGE_EXT` 只有 `png/gif`（`J:webui/ResourceFileService.java:46`）——视频不在 `resource.list`，必须用路径输入 + `VideoFiles.isVideo` 判断。
- **颜色**：`#RRGGBB`；`ColorMaskSpec.parseColor（238-266）` 是权威；`ScriptValidator.checkHexColor` 只覆盖规则动作，**不是** OVERLAY 轨道校验。编辑器按同一正则拦截，文案标注「编辑器提示」。
- **fade 快速路径**：纯色 + `mask_shape=full` + `blend_mode=normal` → `GuiGraphics.fill`（`FadeLayer.render（67-98）` 的 `isAdvancedMask` 分支）；其余走 `ColorMaskRenderer`（`ic_color_mask` shader，1024 点渐变 LUT）。
- **遮罩几何**：`mask_x/y/width/height/radius` 归一化；`mask_shape=full/rect/circle`；未知形状按 full（`LaneMask.set` 同语义，overlay 侧由 `ColorMaskSpec.maskShape` 解析）。
- **字幕**：`text` 支持 `\n`；`@lang:` 引用由 `LangResources.resolve` 解析；alpha<4 跳过（Font 透明度补全坑，`SubtitleLayer.render（55-103）`）；`resolutionEscape` 以 `meta.base_resolution` 为分母（缺省 1920×1080）。
- **视频**：`path` 扩展名 mp4/webm/mkv → `VideoLayer`；缺 ffmpeg → `unavailable`；探测失败 → `ErrorTexture`；解码失败 → `markError`；4K 上限（`VideoLayer.fit`）。
- **LETTERBOX**：`aspect_ratio` 默认 2.35、min 0；`opacity` 默认 1、0–1；无活跃 clip → `aspect=0` + `opacity` 复位（`LetterboxTrackPlayer.onRenderFrame（59-83）`）；`LetterboxLayer` 固定 `Z_INDEX=0`、淡出 0.5s。
- **合成顺序**：`OverlayManager.addLayer` 按 zIndex 升序；`OverlayLayer` javadoc 建议 0 遮幅 / 10 脚本默认 / 30 字幕 / 200 转场遮罩；`removeLayer` 调 `close()`；`startFadeOut` 只碰同 owner。

### 4.3 数据形态

- `overlay.objects` 叶子：`x`、`y`、`anchor_x`、`scale_x`、`source.x`、`opacity`、`font_scale`、`color.r`、`mask_x`、`gradient_angle`、`z_index` 等；复合值必须展开。
- `color`（STRING）：`#RRGGBB`；`gradient`（STRUCT）：`{type, angle, center_x, center_y, radius, stops:[{offset, color}]}`（以 `ColorMaskSpec.parseGradient` 为准）。
- `layer_type`：`fade/image/subtitle`；`path`：image/video 素材相对路径；`text`：subtitle 文本。
- `z_index`：INT，默认 10；越大越在上。
- `LetterboxParams`：`{aspectRatio, opacity}`（`LetterboxTrackPlayer.java:96-）`。

### 4.4 边界

- 不把 `OverlayParams`/`ColorMaskSpec` 的运行时快照写回脚本。
- 不把 `VideoLayer` 的解码状态写进文档。
- 不把字幕批量导入的 cue 中间模型写进运行时脚本（12.20 明确：cue 字段不进入运行时）。
- 不把 `LETTERBOX` 当普通 OVERLAY 片段；它有自己的轨道与 Z=0。
- 不在本轮实现主题/面板移动（05）。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 继续用通用表单 | 按旧 `clips` 平铺 | 零开发 | 不读 `appliesTo`，必然写出不适用字段；`gradient`/`mask` 无法编辑 |
| 三形态三个独立轨道 | 拆成 FADE/IMAGE/SUBTITLE 轨 | 直观 | 运行时只有 OVERLAY 一轨，`layer_type` 是片段字段；拆轨会改脚本格式 |
| 恢复 `pip` | 把画中画当独立形态 | 兼容旧稿 | 运行时已移除；`layer_type` 只有三值 |
| 颜色不校验 | 交给运行时报错 | 简单 | 非法颜色会让整轨失效；编辑期拦截成本低 |
| 视频用 `resource.list` | 复用图片列表 | 少一个输入口 | `IMAGE_EXT` 只有 png/gif，视频根本不在列表；必须路径输入 |
| 字幕批量也放本轮 | 导入/表格/编译 | 集中 | 12.20–12.23 已承担；本轮只做底层参数，避免两套 cue 模型 |
| 合成顺序用拖拽 | 直接改 zIndex | 直观 | zIndex 是脚本字段，拖拽要处理同值/冲突/撤销；先用列表 + 数字编辑 |
| 本地渲染预览 | 在浏览器合成 | 离线可用 | 与 `ColorMaskRenderer`/`VideoLayer` 必然分叉；真画面只能来自游戏 |

**本方案的缺点**：

- 三形态字段多，切换类型时「保留但不生效」的值需要清晰标注，否则作者会以为保存丢了。
- fade 的快速路径与 shader 路径视觉可能有细微差异，文案必须说明「以游戏内为准」。
- 视频状态依赖运行时探测，编辑器只能显示「最近一次回执」；断连时显示「未知」。
- 合成顺序只能调 zIndex，不能解决同值冲突的最终顺序（由 `OverlayManager` 插入实现决定）。

## 六、实现结果

状态：未实现（仅计划）。

现有实现（**起点，不是本轮成果**）：

| 已有 | 锚点 | 缺口 |
|---|---|---|
| OVERLAY 轨道与片段 | `EDITOR:src/components/Timeline.vue:166/178/191` | 只有色条/标签 |
| 通用字段表单 | `EDITOR:src/components/ClipPanel.vue:8-20` + `DynamicForm.vue` | 不读 `appliesTo`；无嵌套 |
| 旧类型 `pip` | `EDITOR:src/types.ts:177` | 运行时已移除 |
| 运行时三形态 | `J:script/OverlayTrackPlayer.java:140-233`、`OverlayClipRuntime` | 编辑器零消费 |
| 遮罩/渐变 | `J:script/ColorMaskSpec.java`、`J:overlay/ColorMaskRenderer.java` | 无 UI |
| 图像/字幕 | `J:overlay/ImageLayer.java`、`SubtitleLayer.java` | 无 UI |
| 视频 | `J:media/video/VideoLayer.java`、`VideoProbe`、`VideoDecoder` | 无 UI、无降级提示 |
| 遮幅 | `J:script/LetterboxTrackPlayer.java`、`J:overlay/LetterboxLayer.java` | 无 UI |
| 合成顺序 | `J:overlay/OverlayManager.java:66-89` | 无 UI |

| 本轮目标 | 现状 | 差异 |
|---|---|---|
| 三形态字段面 | 通用表单 | 新建 `clip.effects` 覆盖层组 + appliesTo 门禁 |
| fade 遮罩/渐变/混合 | 无 | 新建遮罩子编辑器 + 快速路径提示 |
| image/subtitle | 无 | 新建图像/字幕组内容 |
| 视频降级 | 无 | 新建视频组 + 状态徽标 |
| LETTERBOX | 无 | 新建遮幅组 |
| 合成顺序 | 无 | 新建文档级顺序页 + 冲突提示 |

## 七、依赖前轮

- **01-baseline-schema**：`schema.get` 必须导出 `overlay.objects` 的 `ObjectDef`（含 `appliesTo/section/min/max/enumValues`）与 `letterbox.objects`；否则无法做门禁。
- **02-model-contracts**：对象叶子路径身份、原子提交/撤销、无损序列化。
- **03-host-transport**：真实画面与播放回执；视频状态/资源列表经宿主端口。
- **05-timeline-workspace**：检查器宿主、抽屉容器、片段 `loop/exit`；本轮挂载，不重复实现。
- **06-async-objects**：`clip.effects`（`06-ClipEffectControlsPanel` 组容器 + `06-EffectControlsRows` 行/节点/局部视口 + `06-PropertyValueForm` 值提交）与 `selection.properties`；覆盖层/遮幅的每个叶子复用该行，不另造关键帧编辑器。
- **08-camera-transitions**：lane 合成边界（08-03 管 CAMERA lane；本轮管全屏层）。

## 八、本轮包含工作

| # | 文件 | 交付物 |
|---|---|---|
| 1 | `01-OverlayTrackSurface.md` | 三形态字段面与覆盖层组、appliesTo 门禁、类型切换 |
| 2 | `02-OverlayFadeAndMask.md` | fade 颜色/渐变/遮罩/混合 + 快速路径 |
| 3 | `03-OverlayImageAndSubtitle.md` | 图像裁切/字幕底层参数/`@lang:`/转义；批量导入引用 12.20–23 |
| 4 | `04-VideoOverlay.md` | 视频路径/布局/裁切/降级/状态 |
| 5 | `05-LetterboxPanel.md` | 遮幅组：比例/透明度/复位/淡出/Z=0 |
| 6 | `06-CompositionOrderPanel.md` | 全屏层 zIndex 顺序、默认层、冲突提示 |

## 九、轮次出口（无遗留）

1. OVERLAY 三形态全部字段在 `clip.effects` 的覆盖层组中有 UI 归属；`appliesTo` 不适用字段不可写；`pip` 不再出现。
2. 同一 OVERLAY 片段可同时展开多个组；选中一个叶子不隐藏其他组；快捷属性只显示摘要并定位回效果控件。
3. fade 的 `color/gradient/mask_shape/blend_mode/mask_*/gradient_*` 可编辑；颜色按 `#RRGGBB` 拦截；快速路径与 shader 路径可解释。
4. image 的 `path/source/布局` 可编辑；GIF 上限/加载失败有提示。
5. subtitle 的 `text/font_scale/布局/透明度/z_index` 可编辑；`@lang:` 可解析；分辨率转义可解释；批量导入明确指向 12.20–12.23，不在本轮实现；不出现颜色/描边控件。
6. 视频覆盖层的 `path/布局/source/opacity/z_index` 可编辑；缺 ffmpeg/探测失败/解码失败有明确降级提示。
7. LETTERBOX 的 `aspect_ratio/opacity` 在遮幅组可编辑；无活跃片段复位、淡出 0.5s、Z=0 可见。
8. 合成顺序按 zIndex 升序可读；默认层建议与同值冲突提示；能跳转到片段。
9. 主时间轴只显示/选择片段，不出现组、属性行、节点或关键帧汇总。
10. 六份任务的验收/反例/冒烟均闭合；不把「面板能打开」当完成。

本轮**不做**且不留给后续兜底：字幕批量导入/批量编辑/编译器（12.20–12.23）、ASS/SSA 样式、本地合成预览、主题/面板移动（05）。
