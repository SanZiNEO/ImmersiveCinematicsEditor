# 10 音频、监听、调色与媒体资源

## 目标

10 把模组当前 `AUDIO` / `ADJUST` 轨道，以及 `CAMERA` 片段自带的调色字段，完整接进新编辑器；同时补齐媒体资源抽屉和编辑器可判定的错误状态。

编辑器只创建固定格式脚本、修改字段、生成常用结构；脚本通过现有通道推给游戏，由游戏播放并呈现最终画面。编辑器不实现本地音频混音、不做像素级调色、不采样游戏画面、不建立第二套运行时。

轮次地图的出口是“音频/调色/资源抽屉完整”。10 的交付物是：

- `AUDIO` 的音源、播放、循环、包络、空间参数与同轨重叠提示；
- `meta.listener` 的听者模式与镜头听者回落说明；
- `CAMERA` 片段 lane 调色字段：57 个动画通道 + 10 条曲线；
- `ADJUST` 轨 master 调色字段：59 个动画通道 + 10 条曲线 + LUT + 层混合；
- 10 条曲线的图形编辑器；
- `ADJUST` 的 `.cube` LUT 路径、强度、输入 gamma 与层混合；
- 只读媒体资源抽屉：浏览、筛选、引用定位、媒体检查；
- 不新增脚本字段、不新增消息类型、不改模组 `.java`。

## 设计基线

本轮只以下面两类事实为依据：

1. 模组当前代码：`TrackSchemas.audioObjects()/adjustObjects()`、`AudioTrackPlayer`、`CinematicAudioInstance`、`ExternalPcmDecode`、`AudioListenerController`、`AdjustTrackPlayer`、`ColorAdjustSampler`、`ColorAdjustParams`、`ColorAdjustPass`、`MasterColorAdjust`、`CubeLut`、`CubeLutLoader`、`ObjectValidator.checkAudio()/checkAdjust()`、`MetaSchemas.listener`、`ResourceFileService`、`WebRegistryService`、`TextureLoader`、`VideoFiles`、`VideoLayer`、`Ffmpeg`。
2. `plans/0.3.6` 现行合同：`I-script-core/track-audio-adjust.md`、`J-media/audio.md`、`complete/0.3.6/A-color/screen-color-adjust.md`、`F-playback/script-path-resolution.md`。

## 与相邻轮次的边界

| 相邻项 | 归属 | 10 的处理 |
|---|---|---|
| `OVERLAY` 的 `fade` 颜色/遮罩/渐变 | 09 | 09 的 `fade` 是画面之上的覆盖层，不是底图调色；10 不改 `OVERLAY` 字段 |
| `LETTERBOX` 画幅与透明度 | 09 | 10 不写 `LETTERBOX` |
| 片段与片段之间的 crossfade、参数过渡 | 08 | 10 不做片段交界操作；音频没有 crossfade 字段 |
| `CAMERA` 的 57 个 lane 调色通道 | 10 | 作用于该相机 lane，不能混入 `ADJUST` master 字段 |
| `ADJUST` 的 59 个 master 调色通道 | 10 | 作用于合成输出；同脚本多轨不是叠加，后发布轨覆盖前轨 |
| 规则动作 `adjust_set` / `play_sound` | 规则系统 | 它们是规则动作，不是 `ADJUST` / `AUDIO` 片段字段；10 不把规则动作混进片段编辑面 |
| 脚本属性 `meta.listener` | 10 | 只做听者模式编辑和回落提示，不新增监听消息 |

## 字段面总表

### AUDIO

| 字段 | 模式 | 类型/范围 | 默认 | 编辑器落点 |
|---|---|---|---|---|
| `volume` | animated | float | 1 | 属性面板“音量”；有帧进效果面板 |
| `x` / `y` / `z` | animated | float | 0 | 属性面板“空间”；有帧进效果面板 |
| `sound` | value | string，required | null | 属性面板“音源” |
| `source` | value | enum `file/minecraft` | `file` | 属性面板“音源” |
| `pitch` | value | float | 1 | 属性面板“音源” |
| `file_loop` | value | bool | false | 属性面板“播放” |
| `fade_in` | value | float，min 0 | 0 | 属性面板“包络” |
| `fade_out` | value | float，min 0 | 0 | 属性面板“包络” |
| `attenuation` | value | enum `none/linear` | `linear` | 属性面板“空间” |
| `position_mode` | value | enum `relative/absolute` | `relative` | 属性面板“空间” |
| `category` | value | enum `music/ambient` | `music` | 属性面板“空间” |

### CAMERA 调色

| 组 | 字段 |
|---|---|
| 基础校色 | `exposure` / `contrast` / `highlights` / `shadows` / `whites` / `blacks` |
| HSL | `hue` / `saturation` / `vibrance` / `lightness` |
| 白平衡 | `temperature` / `tint` |
| 通道系数 | `red` / `green` / `blue` |
| 通道混合 | `mix_rr` / `mix_rg` / `mix_rb` / `mix_gr` / `mix_gg` / `mix_gb` / `mix_br` / `mix_bg` / `mix_bb` |
| 曲线强度 | `curve_strength` / `r_curve_strength` / `g_curve_strength` / `b_curve_strength` |
| Lift/Gamma/Gain | `lift_r/g/b` / `gamma_r/g/b` / `gain_r/g/b` |
| Hue 曲线强度 | `hv_h_strength` / `hv_s_strength` / `hv_l_strength` / `lv_s_strength` / `sv_s_strength` / `sv_l_strength` |
| 六色带 | `hue_red` / `sat_red` / `hue_yellow` / `sat_yellow` / `hue_green` / `sat_green` / `hue_cyan` / `sat_cyan` / `hue_blue` / `sat_blue` / `hue_magenta` / `sat_magenta` |
| 风格化 | `grayscale` / `invert` |
| 曲线定义 | `rgb_curve` / `r_curve` / `g_curve` / `b_curve` / `hv_h_curve` / `hv_s_curve` / `hv_l_curve` / `lv_s_curve` / `sv_s_curve` / `sv_l_curve` |

CAMERA 没有 `lut` / `lut_input_gamma` / `lut_strength` / `blend_mode` / `blend_amount`。

### ADJUST 调色

CAMERA 的 57 个动画通道 + 10 条曲线全部保留，并增加：

| 字段 | 模式 | 类型/范围 | 默认 | 说明 |
|---|---|---|---|---|
| `lut_strength` | animated | float，0–1 | 1 | LUT 混合强度 |
| `blend_amount` | animated | float，0–1 | 1 | 最后一层混合量 |
| `lut` | value | string，`.cube` 相对路径 | null | 仅 `ADJUST` |
| `lut_input_gamma` | value | float，>0 | 1 | LUT 输入 gamma |
| `blend_mode` | value | enum `normal/multiply/screen/soft_light/overlay` | `normal` | 层混合模式 |

## 面板与组件

| 落点 | 职责 | 不做 |
|---|---|---|
| `selection.properties` | 当前片段适用的全部静态、未设置、value-only 字段；音频/调色按窄组显示 | 不显示已有关键帧的 animated 叶子；不做字段选择器 |
| `clip.effects` | 只显示 `keyframes.length > 0` 的 animated 叶子；音频/调色动画通道共用 | 不显示 value-only；不提供“添加属性” |
| `AudioSourceField` | `source=file` 文件选择、`source=minecraft` 声音 ID 选择 | 不伪造音频解码状态 |
| `AudioSpatialField` | `category` / `position_mode` / `attenuation` / 相对/绝对坐标说明 | 不把 `music` 的 x/y/z 当空间定位 |
| `AudioEnvelopeField` | `fade_in` / `fade_out` 与片段时长的包络示意 | 不做音频波形、不做混音 |
| `ScriptListenerField` | `meta.listener` 的 `player/camera` 与回落提示 | 不新增监听消息、不做音频试听器 |
| `color.*` 属性组 | CAMERA/ADJUST 调色通道、曲线强度、LUT、层混合 | 不另造第二套值控件 |
| `ColorCurveEditor` | 10 条曲线的二维图形编辑 | 不把曲线点做成关键帧、不渲染画面 |
| `ColorLutField` | `.cube` 路径、强度、输入 gamma | 不在编辑器烘焙/预览 LUT |
| `ResourcesDrawer` | `resource.list` 只读浏览、筛选、引用定位 | 不上传/删除/写文件、不做缩略图 |
| `MediaCheckPanel` | 缺失引用、格式不兼容、音频包络、同轨重叠、监听回落等检查 | 不伪造 ffmpeg/解码/LUT 运行时状态 |

## 文档清单

| 文件 | 内容 |
|---|---|
| `README.md` | 总览、边界、字段面、面板归属、实施顺序 |
| `10-01-audio-field-surface.md` | `AUDIO` 字段面、音源切换、属性/效果双面板路由 |
| `10-02-audio-playback-envelope.md` | 单活跃片段、循环、包络、失败片段、同轨重叠 |
| `10-03-audio-space-and-listener.md` | `category`、相对/绝对空间、`meta.listener` 与镜头回落 |
| `10-04-color-field-surface.md` | `CAMERA` lane 调色与 `ADJUST` master 调色的完整字段面 |
| `10-05-color-groups-and-controls.md` | 12 个窄组、数值控件、矩阵/色轮/六色带编辑 |
| `10-06-color-curves.md` | 10 条曲线的控制点、二维编辑器、强度与校验 |
| `10-07-lut-and-layer-blend.md` | `.cube` LUT、gamma、层混合、同脚本多轨覆盖 |
| `10-08-media-resource-drawer.md` | 资源抽屉分类、筛选、引用定位、只读边界 |
| `10-09-media-checks-and-acceptance.md` | 媒体检查、错误状态与 10 验收矩阵 |

## 实施顺序

1. 先落 `10-01` 的音频字段面与双面板路由；音源切换和 value-only 字段先稳定。
2. 落 `10-02` 的单活跃片段、包络与同轨重叠提示；音频时间语义不能靠 UI 猜。
3. 落 `10-03` 的 `category` / `position_mode` / `listener`；`music` 与 `ambient` 的空间语义分开。
4. 落 `10-04` 的调色字段面；先分清 CAMERA lane 与 ADJUST master。
5. 落 `10-05` 的 12 个窄组与专用控件。
6. 落 `10-06` 的曲线编辑器，再落 `10-07` 的 LUT 与层混合。
7. 落 `10-08` 的资源抽屉，最后落 `10-09` 的媒体检查与验收。

## 完成定义

- `AUDIO` 的 13 个字段、`CAMERA` 的 57 个调色通道 + 10 条曲线、`ADJUST` 的 59 个调色通道 + 10 条曲线 + LUT/层混合，全部有明确落点。
- 音频的音源、循环、包络、空间、监听语义在编辑器里有明确显示和提示，不把 `music` 当空间音、不把 `file_loop` 当片段循环。
- 调色字段全部保留，不因为控件复杂而删减通道；CAMERA 不出现 LUT，ADJUST 不丢 LUT/层混合。
- 10 条曲线能编辑、校验、落盘；曲线点不成为关键帧。
- 资源抽屉能浏览、筛选、填入当前字段、定位引用；不增加上传/删除/写文件。
- 媒体检查只基于文档和资源清单，不伪造游戏运行时状态。
- 没有新增脚本字段、没有新增消息类型、没有改模组 `.java`。
