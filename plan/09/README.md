# 09 覆盖层、字幕、画幅与层级

## 目标

09 只做一件事：把模组当前 `OVERLAY` / `LETTERBOX` 轨道的既有字段，完整、准确地接进新编辑器的创作面。

编辑器负责创建固定格式脚本、修改字段、生成常用结构；脚本通过现有通道推给游戏，由游戏播放并呈现最终画面。编辑器不实现像素级画面处理，不采样游戏画面，不建立本地运行时。

轮次地图的出口原文是“画面合成面板完整”。按当前代码，09 不新建这个面板，也不把游戏里的 HUD 合成管线搬进编辑器。09 的交付物是：

- `fade` 的颜色、遮罩、渐变、混合与透明度编辑面；
- `image` 的图片/视频路径、取材、位置、锚点、缩放与透明度编辑面；
- `subtitle` 的文本、字号与位置编辑面；
- `LETTERBOX` 的画幅比与透明度编辑面；
- `z_index` 的层级规则、跨轨预览与冲突提示；
- 只写既有字段的便利脚本生成组件。

最终画面仍由游戏完成：`LETTERBOX` 固定在最底层，`OVERLAY` 按 `z_index` 升序绘制；`ADJUST` 是另一条独立轨道，不属于 09。

## 设计基线

本轮只以下面两类事实为依据：

1. 模组当前代码：`overlay` 包、`OverlayTrackPlayer`、`OverlayClipRuntime`、`LetterboxTrackPlayer`、`ColorMaskSpec`、`TrackSchemas.overlayObjects()/letterboxObjects()`、`ObjectValidator.checkOverlay()`，以及视频/资源相关类。
2. `plans/0.3.6` 现行合同：`I-script-core/track-overlay-letterbox.md`、`D-transition/overlay-color-mask.md`、`H-other/hud-layer-api.md`。

## 与相邻轮次的边界

| 相邻项 | 归属 | 09 的处理 |
|---|---|---|
| 片段与片段之间的 crossfade | 08 | 09 不创建 crossfade，不写 `transition*`；`layer_type=fade` 不是 crossfade |
| `ADJUST` 轨道的 LUT / 曲线 / 底图调色 | `ADJUST` 轨 | 09 不写 `ADJUST` 字段；`fade` 的颜色是画面之上的覆盖层颜色 |
| 相机六参数过渡 | 08 | 09 不碰 `transition` / `transition_params` |
| 片段属性面板 / 效果面板 | 06 | 09 只按 06 的双面板规则挂字段，不另造字段选择器 |
| 位置/朝向编组与路径生成 | 07 | 09 复用 07 的编组与路径口径；`OVERLAY` 没有 `paths[]`，圆形运动只能烘焙成 `x/y` 关键帧 |
| 规则动作 `overlay_set` | 规则系统 | 它是规则动作，不是 `OVERLAY` 轨道字段；09 不把规则动作混进片段编辑面 |

## 字段面总表

### OVERLAY

| 字段 | 模式 | 适用层 | 默认 | 编辑器落点 |
|---|---|---|---|---|
| `layer_type` | value enum | 全部 | `fade` | 属性面板顶部；切换层类型 |
| `x` / `y` | animated float | image / subtitle | 0.5 | 属性面板；有帧进效果面板 |
| `anchor_x` / `anchor_y` | animated float | image / subtitle | 0.5 | 属性面板；有帧进效果面板 |
| `scale_x` / `scale_y` | animated float | image / subtitle | 1 | 属性面板；有帧进效果面板 |
| `source.x/y/w/h` | animated float | image（含视频） | 0 / 0 / 1 / 1 | 属性面板“取材”组 |
| `opacity` | animated float 0–1 | 全部 | 1 | 属性面板；有帧进效果面板 |
| `font_scale` | animated float | subtitle | 1 | 属性面板；有帧进效果面板 |
| `color.r/g/b` | animated float 0–1 | fade | 0 | 属性面板“颜色通道”；有帧进效果面板 |
| `mask_x/y` | animated float | fade | 0.5 | 属性面板“遮罩”组 |
| `mask_width/height` | animated float min 0 | fade | 1 | 属性面板“遮罩”组 |
| `mask_radius` | animated float min 0 | fade | 0.5 | 属性面板“遮罩”组 |
| `gradient_angle` | animated float | fade | 0 | 属性面板“渐变”组；仅 linear |
| `gradient_center_x/y` | animated float | fade | 0.5 | 属性面板“渐变”组 |
| `gradient_radius` | animated float min 0 | fade | 0.5 | 属性面板“渐变”组；仅 radial |
| `color` | value string | fade | `#000000` | 属性面板“基色” |
| `gradient` | value struct | fade | null | 属性面板“渐变定义” |
| `mask_shape` | value enum | fade | `full` | 属性面板“遮罩形状” |
| `blend_mode` | value enum | fade | `normal` | 属性面板“混合模式” |
| `path` | value string | image（含视频） | 空 | 属性面板“素材路径” |
| `text` | value string | subtitle | 空 | 属性面板“文本” |
| `z_index` | value int | 全部 | 10 | 属性面板“层级”；带层级预览 |

### LETTERBOX

| 字段 | 模式 | 默认 | 编辑器落点 |
|---|---|---|---|
| `aspect_ratio` | animated float min 0 | 2.35 | 属性面板“画幅比”；有帧进效果面板 |
| `opacity` | animated float 0–1 | 1 | 属性面板“透明度”；有帧进效果面板 |

## 面板与组件

| 落点 | 职责 | 不做 |
|---|---|---|
| `selection.properties` | 显示当前 `layer_type` 适用的全部可编辑字段；显示静态值、未设置值和 value-only 字段 | 不显示已有关键帧的 animated 叶子；不做字段选择器 |
| `clip.effects` | 只显示 `keyframes.length > 0` 的 animated 叶子；做关键帧编辑 | 不显示 value-only 字段；不提供“添加属性”入口 |
| `OverlayLayerTypeField` | `layer_type` 切换与字段清理预检 | 不保留“写了但不生效”的死字段 |
| `OverlayColorField` | 基色 + 通道 + 渐变 + 遮罩 + 混合；局部色板/渐变条 | 不实现像素合成 |
| `OverlayMediaField` | 图片/视频路径选择、存在性提示、扩展名识别 | 不伪造 ffmpeg/解码状态 |
| `OverlaySubtitleField` | 多行文本、`@lang:` 语法、字号 | 不提供字幕颜色/字体家族 |
| `OverlayGeometrySketch` | 16:9 画布内的位置/锚点/缩放/取材/遮罩几何示意 | 不采样素材像素，不输出最终画面 |
| `OverlayOrderPopover` | 从 `z_index` 行打开的跨轨层级预览、同 z 冲突提示 | 不建立全局合成 z 表，不写盘 |

## 文档清单

| 文件 | 内容 |
|---|---|
| `README.md` | 总览、边界、字段面、面板归属、实施顺序 |
| `09-01-overlay-field-surface.md` | `OVERLAY` 字段面、层类型切换、属性/效果双面板路由 |
| `09-02-fade-color-mask.md` | `fade` 的基色、颜色通道、渐变、遮罩、混合与脚本实例退场渐出 |
| `09-03-image-layer.md` | 图片层路径、素材、取材、几何、GIF 与缺失素材 |
| `09-04-video-layer.md` | 视频层识别、ffmpeg 缺失、ErrorTexture、4K 上限、音轨与 seek |
| `09-05-subtitle-layer.md` | 字幕文本、`@lang:`、字号、多行、透明度阈值 |
| `09-06-letterbox.md` | `LETTERBOX` 画幅比、透明度、固定 z=0、空档复位 |
| `09-07-layer-order-and-tracks.md` | `z_index`、稳定排序、同轨单活跃片段、多轨与冲突提示 |
| `09-08-overlay-presets.md` | 只写既有字段的便利脚本生成组件 |
| `09-09-r9-acceptance.md` | 文档、字段、面板、消息、模组零改动、真游戏冒烟 |

## 实施顺序

1. 先落 `09-01` 的字段门控与双面板路由；没有这层，后面的层类型组件会互相污染。
2. 落 `09-07` 的 `z_index` 与单活跃片段规则；它决定多轨编辑能否正确表达。
3. 落 `09-02`、`09-03`、`09-04`、`09-05`、`09-06` 的专用编辑面。
4. 落 `09-08` 的预设；预设只能调用前面已定义的字段写入器。
5. 最后按 `09-09` 做结构检查、构建和真游戏冒烟。

## 完成定义

- `OVERLAY` / `LETTERBOX` 的全部既有字段都有明确落点；没有新增字段、没有新增消息、没有改模组 `.java`。
- 层类型切换后，脚本里不残留当前类型不适用的字段；`ObjectValidator.checkOverlay()` 不再报“不适用于 layer_type”。
- `fade`、`image`、`video`、`subtitle`、`LETTERBOX` 都能从编辑器生成可被游戏解析的脚本。
- `z_index` 的排序规则、同 z 行为和同轨重叠行为在编辑器里有明确提示，不伪造“全局合成顺序”。
- 编辑器预览只做几何/颜色/文本示意；最终画面由游戏播放验证。
- `09-09` 的验收矩阵全通过后，09 才算交付。
