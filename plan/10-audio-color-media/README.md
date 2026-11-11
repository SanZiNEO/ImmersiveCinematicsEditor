# 10 音频、调色与媒体资源

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划；现有运行时是消费对象，不是本轮成果）
> 范围：AUDIO 全字段与三模式、监听者与混音、外部音频解码、视频音轨、ADJUST 59 通道 + 10 曲线 + LUT、媒体资源抽屉。不含 CAMERA 自带调色（08-01 的 lane 调色入口）、不含覆盖层（09）、不含规则/事件记录（11）、不含模板（12）。
> 前置：03（宿主信号与真实画面）、06（异步对象与属性关键帧）、09（覆盖层与合成顺序）；共同前置 01/02。
> 关联：`../08-camera-transitions/README.md`、`../09-overlays-composition/README.md`、`../11-triggers-rules-events/README.md`、`../12-templates-flight-tools/README.md`

**路径记号**：`MOD:` = `ImmersiveCinematics/`；`J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`EDITOR:` = `ImmersiveCinematicsEditor/`（webui 分支）；`INGAME:` = 编辑器仓库 `1.20.1` 分支（只 `git show` 读）。行号是 2026-11-11 的核查坐标，改动后以符号为准。

## 一、摘要

本轮把 AUDIO 从「一个通用表单 + 声音路径」补成完整的音频作者面：`source`（file/minecraft）、`category`（music/ambient）、`position_mode`（relative/absolute）、`attenuation`（none/linear）、`volume/x/y/z` 动画、`pitch`、`file_loop`、`fade_in/out`；把监听者（`meta.listener`）、全局暂停/恢复、多实例混音、外部格式解码状态、视频音轨同步做成可读可控的界面；把 ADJUST 的 59 通道 + 10 曲线 + LUT 做成完整的调色工作台；把 `resource.list` 的资源浏览做成统一抽屉。

一句话验收：作者能在编辑器里写出一个**主模组 `AudioTrackPlayer`/`AdjustTrackPlayer` 能解析、`ObjectValidator` 能通过、游戏内能按预期发声/调色**的 AUDIO/ADJUST 脚本；外部格式与 LUT 的降级/上限在提交前可见。

现状（起点，不是本轮成果）：

| 事实 | 锚点 |
|---|---|
| 编辑器 AUDIO 只有通用字段表单 | `EDITOR:src/components/ClipPanel.vue:8-20`、`DynamicForm.vue` |
| 时间轴只显示 AUDIO 色条/文件名 | `EDITOR:src/components/Timeline.vue:163`、`:175`、`:189` |
| 无监听者/混音 UI | `EDITOR:src/components/PropertyPanel.vue:4-18`（meta 全量） |
| 无外部解码状态 | 无组件 |
| 无视频音轨 UI | 无组件 |
| ADJUST 轨道在编辑器类型里不存在 | `EDITOR:src/types.ts:8`（6 种，无 ADJUST） |
| 无调色面板/曲线/LUT | 无组件 |
| 资源浏览只有旧 `LibraryPanel`（空壳） | `EDITOR:src/components/LibraryPanel.vue`（44 行） |

## 二、为什么做

### 2.1 问题

- **AUDIO 三模式不可编辑**：`audioObjects()` 登记 `source`（file/minecraft）、`category`（music/ambient）、`position_mode`（relative/absolute）、`attenuation`（none/linear）（`J:script/schema/TrackSchemas.java:358-379`），运行时 `AudioTrackPlayer.startClipInstance（288-360）` 对 `music` 强制 `relative + none + 玩家位置`，对 `ambient` 用 `position_mode + attenuation`。编辑器只有通用文本框，作者不知道 `music` 下 `position_mode` 会被忽略。
- **fade 校验缺口**：`fade_in + fade_out > duration` 时 `AudioTrackPlayer` 直接跳过整个 clip（`startClipInstance` 的 warn/return），`ObjectValidator.checkAudio（722-736）` 会报错；编辑器没有可视化。
- **监听者不可见**：`meta.listener`（`MetaSchemas.java:26`）决定 `AudioListenerController` 用玩家还是相机作为听者（`J:script/AudioListenerController.java:29-115`）；编辑器只有通用下拉，没有「相对模式锚点会变成相机」的说明。
- **外部解码不可见**：ogg/wav 同步解码；mp3/aac/flac/m4a/opus/wma/oga/ogx 走 ffmpeg 整段异步（`J:script/CinematicAudioInstance.java:334-392`、`J:media/audio/ExternalPcmDecode.java:41-70`）。解码未就绪时实例静音等待（`ensurePlaying（272-285）`），作者在编辑器里看不到「为什么没声音」。
- **视频音轨不可见**：`VideoAudioTrack` 以 100ms 暂停判定、0.25s 漂移、0.05s 倒退阈值同步（`J:media/video/VideoAudioTrack.java:23-85`），`VideoAudioInstance` 走 `ProcessPcmStream`（48k/2ch/16bit）；编辑器没有状态/说明。
- **ADJUST 完全缺失**：编辑器 `TrackType` 没有 ADJUST（`EDITOR:src/types.ts:8`），而运行时 `AdjustTrackPlayer`（`J:script/AdjustTrackPlayer.java:51-67`）发布 59 通道 + 10 曲线 + LUT；`MasterColorAdjust`/`ColorAdjustPass` 有 12 采样器上限与单表烘焙（`J:client/post/ColorAdjustPass.java` 类 javadoc、`CubeLut.composed3D（392-）`）。
- **LUT 无工作台**：`lut`/`lut_input_gamma` 是字段（`TrackSchemas.java:470-471`），`CubeLutLoader.forClip（93-105）` 按片段缓存；编辑器无法选择/预览/诊断 LUT。
- **资源抽屉缺失**：`resource.list` 支持 `lang/image/audio`（`J:webui/ResourceFileService.java:37-51`），但 `IMAGE_EXT` 只有 png/gif、`AUDIO_EXT` 只有 ogg/wav；视频/外部音频格式不在列表，作者不知道能填什么。

### 2.2 目标

1. AUDIO 全字段在**片段效果控件（`clip.effects`）的音频组**内可编辑，叶子成行、可与其他组同时展开；`source/category/position_mode/attenuation` 的组合语义可解释；fade 超时长在提交前提示。
2. `meta.listener` 可切换，并显示相对模式锚点（玩家/相机）；全局暂停/恢复与多实例混音行为可读。
3. 外部格式解码状态可见：同步/异步、未就绪、失败；不重写解码。
4. 视频音轨状态可见：同步阈值、静音/失败；不新增字段。
5. ADJUST 的 59 通道 + 10 曲线 + `blend_mode` 在 `clip.effects` 的调色组内可编辑（CAMERA 的同名组是 lane 级）；与 CAMERA 自带调色共用控件但归属不同。
6. LUT 工作台：选择/清除、`lut_input_gamma`、预览（真实画面）、错误诊断、12 采样器上限与烘焙说明。
7. 媒体资源抽屉：`resource.list` 的 lang/image/audio 浏览、扩展名提示、路径插入；视频/外部音频格式明确「不在列表，需手填」。

### 2.3 非目标

- 不重写 `AudioTrackPlayer`/`CinematicAudioInstance`/`ExternalPcmDecode`/`VideoAudioTrack`/`AdjustTrackPlayer`/`ColorAdjustPass`/`CubeLut`。
- 不新增 AUDIO/ADJUST 字段、不新增 LUT 格式、不新增音频格式。
- 不做音频波形编辑器/时间拉伸/混音台多轨总线。
- 不做视频解码（09-04）或字幕（09-03）。
- 不做规则动作/事件记录（11）；`play_sound` 的规则侧归 11。
- 不做模板（12）。

## 三、方案

### 3.1 用起来是什么样

**效果控件·音频组**（选中 AUDIO 片段时，在 `clip.effects` 内）：顶部 `source` 二选一（file/minecraft）+ `sound` 路径/注册名；中部 `category`（music/ambient）+ `position_mode` + `attenuation` + `volume/x/y/z` + `pitch` + `file_loop`；底部 `fade_in/out` + 时长可视化（超时长红条）。叶子一行一个，可与其他组同时展开；右侧一列「语义提示」：music 强制非空间、ambient 才用位置/衰减；relative 锚点=听者（玩家/相机）。

**监听与混音**（文档级：文档顶栏；音频组顶部只放摘要与跳转）：`meta.listener` 二选一（player/camera）+ 说明「相对模式的锚点」；全局暂停/恢复按钮（预览控制已有）；「多实例混音」说明：每个播放实例一份 `AudioTrackPlayer`，音量叠加，`playOneShot` 独立于 clip。`meta.listener` 仍只有一个写入口（01 的 meta 面板或此处复用同一命令）。

**音频状态**（音频组底部）：当前片段的声音状态：`同步解码`/`外部解码中`/`外部解码失败`/`缺失`；外部格式列表；未就绪时「静音等待」说明。

**视频音轨**（09-04 的视频组内嵌，或本轮的「视频音轨」小节）：`VideoAudioTrack` 状态（有音轨/无音轨/失败）、同步阈值说明、`ProcessPcmStream` 格式（48k/2ch/16bit）；不提供音量/偏移字段。

**效果控件·调色组**（选中 ADJUST 片段时；CAMERA 片段自带同名组但属 lane 级）：按 `section` 分组，叶子成行、组可折叠并同时展开：
- 基础（exposure/contrast/highlights/shadows/whites/blacks）
- 色彩（hue/saturation/vibrance/lightness/temperature/tint/red/green/blue）
- 混合（mix_* 9 个）
- 曲线强度（curve_strength + r/g/b + hv/lv/sv 6 个）
- Lift/Gamma/Gain（9 个）
- HSL 分区（hue_*/sat_* 12 个）
- 风格化（grayscale/invert）
- LUT（`lut`、`lut_input_gamma`、`lut_strength`、`blend_amount`）
- 曲线（10 个 `*_curve` 结构）
- 混合模式（`blend_mode` 5 种）

顶部一条「lane 级 vs master」说明：CAMERA 片段的 57 通道在 lane 合成前；ADJUST 的 59 通道在 master 链（整屏之后）；规则层紧随实例。

**LUT 工作台**（文档级工具页，从调色组的 LUT 子组打开；不是片段效果控件组）：选择 `.cube`（`resource.list` 不含 cube，需路径输入/宿主文件选择）；显示尺寸（1D/3D）、`lut_input_gamma`、`lut_strength`、`blend_amount`；错误（解析失败/尺寸越界/采样器不足）；12 采样器上限说明；`composed3D` 单表烘焙说明。

**资源抽屉**（底部抽屉「资源」；文档级）：`resource.list(kind=lang/image/audio)` 的树/列表；扩展名徽标；点击插入到当前字段（`sound`/`path`/`text` 的 `@lang:`）；视频/外部音频格式显示「不在列表，需手填」；`MAX_DEPTH=5`/`MAX_FILES=2000` 说明。

### 3.2 边界

- 所有编辑走 02 的文档命令；本轮不新增消息。
- AUDIO/ADJUST 字段编辑的唯一承载是 `clip.effects` 的音频组/调色组；不存在"每个叶子一个独立面板"或把整组做成独占检查器页。`selection.properties` 只显示当前音源/监听目标或调色项/LUT 引用与选中参数，并定位回效果控件，不缓存第二份值或时间轴。
- 主时间轴只显示/选择 AUDIO、ADJUST 片段，不展开组、属性行、节点或关键帧汇总。
- 声音/调色真值来自游戏；本轮不做本地波形/调色渲染。
- `meta.listener` 是脚本级字段（01 的 meta 面板也可编辑）；本轮提供音频语义视图，不复制第二个写入口（跳转/内嵌同一命令）。
- ADJUST 是第七轨；编辑器必须新增 `ADJUST` 类型（这是 02/05 的类型迁移，本轮只声明需求）。
- 视频音轨归 `VideoAudioTrack`，不新增字段；本轮只呈现状态。
- LUT 工作台/资源抽屉是文档级工具，不接管片段字段编辑；不造 PR 式音频效果链或调色滤镜链。
- 资源抽屉只管资源浏览/插入；模板抽屉归 12。

## 四、技术细节

### 4.1 核心模型

| 模型 | 承载 | 职责 |
|---|---|---|
| 音频驱动 | `J:script/AudioTrackPlayer.java` | `onRenderFrame（109-173）`、`onStop（174-187）`、`onScriptReplaced（188-218）`、`pauseAll（219-226）`、`resumeAll（227-244）`、`playOneShot（245-266）`、`pruneOneShots（267-279）`、`stopOneShots（280-287）`、`startClipInstance（288-360）`、`updateClipInstance（361-380）`、`fadeEnvelope（381-395）`、`resolveAudioPosition（396-404）`、`repositionAudio（451-）` |
| 音频实例 | `J:script/CinematicAudioInstance.java` | 构造（88-114）、`decode（334-360）`、`startExternalDecode（361-371）`、`onExternalDecoded（372-392）`、`play（168-182）`、`stopInstance（183-190）`、`pause（191-194）`、`resume（195-198）`、`setVolume（199-203）`、`setPosition（204-215）`、`setAttenuation（216-225）`、`setRelative（226-235）`、`seekTo（236-255）`、`syncToTime（256-271）`、`ensurePlaying（272-285）`、`cleanup（303-）`、`canPlaySound（131-136）`、`canStartSilent（137-142）`、`getStream（152-156）`、`CinematicAudioStream（494-）` |
| 外部解码 | `J:media/audio/ExternalPcmDecode.java` | `Pcm（31）`、`SAMPLE_RATE（34）`、`CHANNELS（35）`、`SUPPORTED_EXTENSIONS（41-50）`、`isSupportedExtension（52-56）`、`decodeAsync（70-）` |
| 监听者 | `J:script/AudioListenerController.java` | `shouldOverride（29-42）`、`isCameraListener（43-49）`、`getListenerPosition（50-59）`、`playerCamera（60-74）`、`cameraListener（75-89）`、`listenerMode（90-）` |
| 视频音轨 | `J:media/video/VideoAudioTrack.java` | `TIME_EPSILON（23）`、`PAUSE_THRESHOLD_NANOS（25）`、`SEEK_BACK_TOLERANCE（27）`、`DRIFT_TOLERANCE（29）`、`syncToTime（55-85）`、`close（86-94）`、`start（95-103）`、`stopInstance（104-）` |
| 视频音频实例 | `J:media/video/VideoAudioInstance.java` | 构造（39-55）、`canPlaySound（56-60）`、`canStartSilent（61-66）`、`resolve（67-82）`、`getStream（83-87）`、`tick（88-）`；MASTER/relative/NONE/volume1 |
| PCM 流 | `J:media/video/ProcessPcmStream.java` | `SAMPLE_RATE（35）`、`CHANNELS（36）`、`BITS（37）`、`SCRATCH_SIZE（38）`、`EMPTY（42）`、构造（61-） |
| 调色驱动 | `J:script/AdjustTrackPlayer.java` | `onRenderFrame（51-67）`、`onStop（68-75）`、`onScriptReplaced（76-81）`、`findActiveClip（82-）` |
| 采样 | `J:script/ColorAdjustSampler.java` | `sampleObjects（87-143）`、`sampleCameraLaneObjects（144-189）`、`CurveCache（190-214）`、`ParsedCurves（215-）`、`lut（101）` |
| 参数 | `J:client/post/ColorAdjustParams.java` | `record（21-98）`、`BLEND_*（99-103）`、`blendModeCode（109-122）`、`IDENTITY（123-）`、`isIdentity（142-）` |
| master 链 | `J:client/post/MasterColorAdjust.java` | `publish（45-62）`、`publishRuleLayer（63-78）`、`clearRuleLayer（79-88）`、`beginFrame（89-98）`、`consume（99-124）`、`clear（125-）` |
| pass | `J:client/post/ColorAdjustPass.java` | `render（117-182）`、`applyTo（183-218）`、`pass（219-322）`、`lutStepReady（362-394）`、`upload（395-）`；12 采样器上限/单表烘焙/fail-safe 直通（类 javadoc） |
| LUT 绑定 | `J:client/post/LutBindGuard.java` | `DECLARED_SAMPLERS（22-28）`、`LUT_3D（29）`、`LUT_3D_UNIT（32）`、`resolveUnit（44-66）`、`textureReady（67-）` |
| LUT | `J:script/CubeLut.java` | `MIN_SIZE（44）`、`MAX_SIZE_3D（47）`、`MAX_SIZE_1D（50）`、`COMPOSED_MAX_SIZE（57）`、`parse（99/111）`、`composed3D（392-）`、`Composed3D（594-）`、`index3D（616-）` |
| LUT 缓存 | `J:script/CubeLutLoader.java` | `load（38-52）`、`loadFile（53-92）`、`forClip（93-105）`、`releaseClip（106-112）`、`clearCache（113-）` |
| 曲线 | `J:script/ColorCurve.java` | `Point（18）`、`LUT_SIZE（21）`、`identityLut（49-）`；PCHIP |
| 挂点 | `J:mixin/GameRendererMixin.java` | `MasterColorAdjust.beginFrame()`（67）、`ColorAdjustPass.render`（136） |
| 资源列表 | `J:webui/ResourceFileService.java` | `KIND_LANG/IMAGE/AUDIO/ALL（37-43）`、`IMAGE_EXT（46）`、`AUDIO_EXT（47）`、`MAX_DEPTH（49）`、`MAX_FILES（51）`、`list（65/74）`、`matchesKind（155-162）` |
| 资源消息 | `J:webui/WebEditorApi.java — handleResourceList（244-）` | `resource.list` |
| 注册表 | `J:webui/WebRegistryService.java — query（33-64）` | `sound` 等 |

### 4.2 契约

- **AUDIO 三模式**：`source` ∈ `file/minecraft`；`category` ∈ `music/ambient`；`position_mode` ∈ `relative/absolute`；`attenuation` ∈ `none/linear`。`music` 强制 `relative + none + 玩家位置`（`AudioTrackPlayer.startClipInstance（288-360）`）；`ambient` 才按 `position_mode + attenuation`。
- **relative 锚点**：`AudioListenerController.getListenerPosition` 返回玩家或相机（`meta.listener`）；不是固定玩家。
- **fade**：`fadeEnvelope` 的 `fadeOut` 覆盖 `fadeIn`；`fade_in+fade_out > duration` 时整 clip 跳过（`startClipInstance` 的 warn/return），`ObjectValidator.checkAudio（722-736）` 报错。
- **解码**：ogg（Minecraft 资源或文件）与 wav 同步；其余白名单走 ffmpeg 异步，48k/2ch/s16le，整段驻留内存（`ExternalPcmDecode`）；未就绪时静音等待。
- **监听者**：`meta.listener` 默认 `player`；`camera` 时 `AudioListenerController` 用相机位置/朝向；`shouldOverride` 只在脚本播放时接管。
- **调色通道**：ADJUST 59 = CAMERA 57 + `lut_strength` + `blend_amount`（`TrackSchemas.java:492-504`）；`channelDefault/Min/Max` 决定范围（`:520-535`）。
- **曲线**：10 个 `*_curve`（rgb/r/g/b + hv_h/hv_s/hv_l/lv_s/sv_s/sv_l），value-only STRUCT；`ColorCurve` PCHIP，LUT 256。
- **LUT**：`lut` 路径、`lut_input_gamma` > 0、`lut_strength` 0–1、`blend_amount` 0–1；`CubeLut` 支持 1D/3D，3D 上限 256、1D 上限 65536；`composed3D` 合成单表上限 64。
- **12 采样器**：`ColorAdjustPass` 的 `LutBindGuard.DECLARED_SAMPLERS` 固定；超限/缺纹理时 fail-safe 直通（不崩）；`lutStepReady` 检查。
- **master 顺序**：`beginFrame` → 各实例 `publish` → `consume`（按实例顺序 + 规则层紧随）→ `ColorAdjustPass.render` 链式 `applyTo` → 末尾 `LaneCompositor.compose`。
- **资源**：`resource.list` 的 kind 只有 lang/image/audio；`IMAGE_EXT=png,gif`、`AUDIO_EXT=ogg,wav`；视频/外部音频格式不在列表，必须手填 + `ResourcePath.exists`/`VideoFiles`/`ExternalPcmDecode.isSupportedExtension` 判断。

### 4.3 数据形态

- `audio.objects`：`volume/x/y/z` ANIMATED；`sound`（required）、`source`、`pitch`、`file_loop`、`fade_in/out`、`attenuation`、`position_mode`、`category`（`TrackSchemas.java:358-379`）。
- `adjust.objects`：59 通道 ANIMATED + 10 曲线 STRUCT + `lut`/`lut_input_gamma`/`blend_mode`（`TrackSchemas.java:459-475`）。
- `ColorAdjustParams`：59 通道 + 10 曲线 LUT + `blendMode`（record 21-98）。
- `meta.listener`：`player/camera`（`MetaSchemas.java:26`）。
- `resource.list` 回执：`{kind, dir, files[]}`（以 `ResourceFileService.list` 为准）。

### 4.4 边界

- 不把 `CinematicAudioInstance` 的解码状态写回脚本。
- 不把 `ColorAdjustParams` 的采样结果写回脚本。
- 不把 LUT 的合成表写进脚本；`lut` 只是路径。
- 不把 `meta.listener` 在音频组重复写一份；跳 01 的 meta 面板或复用同一命令。
- 不把视频音轨做成 AUDIO 轨道；它是 `VideoLayer` 的一部分。
- 不做规则 `play_sound` 的编辑（11）。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 继续用通用表单 | 按旧 `clips` 平铺 | 零开发 | 三模式语义无法表达；ADJUST 类型根本不存在 |
| 音频做成时间轴波形 | 本地解码/波形 | 直观 | 与 `CinematicAudioInstance` 必然分叉；真值只能来自游戏 |
| 监听者做成全局设置 | 不写 `meta.listener` | 简单 | 它是脚本字段，影响该脚本的听者；全局设置会污染其他脚本 |
| 外部格式也同步解码 | 只用 ogg/wav | 简单 | 运行时支持 ffmpeg 异步；编辑器不能假装不支持 |
| 调色用一张大表单 | 59 个数字框 | 少分组 | 作者找不到通道；曲线/LUT 无法编辑 |
| LUT 只填路径 | 不预览/不诊断 | 简单 | 解析失败/采样器不足会让作者困惑；工作台成本低 |
| 资源抽屉复用 `LibraryPanel` | 旧空壳 | 少一个组件 | 它没有 `resource.list` 消费、没有扩展名/路径语义 |
| 视频音轨新增字段 | 音量/偏移 | 强大 | 运行时没有这些字段；会写出解析器拒绝的键 |

**本方案的缺点**：

- AUDIO 的 `music` 强制语义会让「position_mode/attenuation」在 music 下变成无效控件，需要清晰置灰。
- 调色 59 通道 + 10 曲线，页面很长；必须靠分组/搜索/预设降低负担。
- LUT 的 12 采样器/烘焙是运行时细节，UI 只能解释，不能完全预测某张 LUT 是否可用。
- 外部解码状态依赖宿主回执；断连时只能显示「未知」。
- 资源抽屉不包含视频/外部音频格式，作者需要手填路径；这是运行时列表的真实边界，不是 UI 偷懒。

## 六、实现结果

状态：未实现（仅计划）。

现有实现（**起点，不是本轮成果**）：

| 已有 | 锚点 | 缺口 |
|---|---|---|
| AUDIO 轨道/片段 | `EDITOR:src/components/Timeline.vue:163/175/189` | 只有色条/文件名 |
| AUDIO 通用表单 | `EDITOR:src/components/ClipPanel.vue:8-20` + `DynamicForm.vue` | 无三模式语义/fade 可视化 |
| meta 通用表单 | `EDITOR:src/components/PropertyPanel.vue:4-18` | 无监听者语义 |
| ADJUST 类型 | `EDITOR:src/types.ts:8`（6 种） | **不存在** |
| 调色/LUT | 无 | 无 UI |
| 资源浏览 | `EDITOR:src/components/LibraryPanel.vue`（44 行空壳） | 无 `resource.list` 消费 |
| 运行时音频 | `J:script/AudioTrackPlayer.java`、`CinematicAudioInstance`、`ExternalPcmDecode` | 编辑器零消费 |
| 运行时调色 | `J:script/AdjustTrackPlayer.java`、`MasterColorAdjust`、`ColorAdjustPass`、`CubeLut` | 编辑器零消费 |
| 视频音轨 | `J:media/video/VideoAudioTrack.java`、`VideoAudioInstance`、`ProcessPcmStream` | 无 UI |

| 本轮目标 | 现状 | 差异 |
|---|---|---|
| AUDIO 全字段 | 通用表单 | 新建 `clip.effects` 音频组 + 三模式 |
| 监听/混音 | 无 | 新建监听视图 |
| 外部解码状态 | 无 | 新建状态区 |
| 视频音轨 | 无 | 新建状态小节 |
| ADJUST 59+10 | 无类型 | 新增 ADJUST 类型 + `clip.effects` 调色组 |
| LUT 工作台 | 无 | 新建文档级工具页 |
| 资源抽屉 | 空壳 | 新建 `resource.list` 消费 |

## 七、依赖前轮

- **01-baseline-schema**：消费现有schema.get的tracks.AUDIO.objects、tracks.ADJUST.objects与meta.listener并准确建索引；主模组已导出ADJUST，无需为前端漏枚举而重复改注册表。
- **02-model-contracts**：`ADJUST` 类型迁移、对象叶子路径身份、原子提交/撤销、无损序列化。
- **03-host-transport**：真实画面、播放回执、`resource.list`、音频/解码状态回执。
- **05-timeline-workspace**：检查器宿主、抽屉容器、`ADJUST` 轨道。
- **06-async-objects**：`clip.effects`（`06-ClipEffectControlsPanel` 组容器 + `06-EffectControlsRows` 行/节点/局部视口 + `06-PropertyValueForm` 值提交）与 `selection.properties`；音量/位置/59 通道每个叶子复用该行。
- **09-overlays-composition**：视频层（09-04）与合成顺序（09-06）；视频音轨挂在其视频组。

## 八、本轮包含工作

| # | 文件 | 交付物 |
|---|---|---|
| 1 | `01-AudioTrackPanel.md` | AUDIO 全字段与音频组、三模式、fade、语义提示 |
| 2 | `02-AudioListenerAndMix.md` | `meta.listener`、相对锚点、全局暂停/恢复、多实例混音 |
| 3 | `03-ExternalAudioDecode.md` | ogg/wav 同步、外部格式异步、状态/失败提示 |
| 4 | `04-VideoAudioTrack.md` | 视频音轨同步阈值、状态、与 09-04 的分工 |
| 5 | `05-AdjustColorPanel.md` | ADJUST 59 通道 + 10 曲线 + `blend_mode`（调色组） |
| 6 | `06-LutWorkbench.md` | LUT 选择/强度/伽马/诊断/12 采样器/烘焙 |
| 7 | `07-MediaResourceDrawer.md` | `resource.list` 浏览/插入/扩展名/上限 |

## 九、跨轮接口：EVENT/MOD_EVENT 归 11

- EVENT 轨（`event` + `event_type`）与 MOD_EVENT 轨（`mod_event` + `event_type` + `data`）的记录编辑、服务端事件语义、`Position` 玩家移动、规则动作（含 `play_sound`）全部归 **11-triggers-rules-events**。
- 本轮只提供音频侧合同：
  - `AudioTrackPlayer.playOneShot（245-266）` 由规则动作 `play_sound` 调用（`J:camera/rule/RuleActions.java:321`）；10 不编辑该动作。
  - EVENT/MOD_EVENT 记录里若引用声音 id，10 提供 `resource.list(kind=audio)` 与 `registry.query(kind=sound)` 的取值域；记录字段本身归 11。
  - 08-05 的玩家移动预演只读 `Position`，编辑归 11；与音频无交叉。
- 11 的规则/事件文档必须引用本轮的音频字段合同（`sound/source/category/position_mode/attenuation`），不得在 11 里复制一套音频语义。

## 十、轮次出口（无遗留）

1. AUDIO 全部字段在 `clip.effects` 音频组中可编辑；`source/category/position_mode/attenuation` 的组合语义与 `AudioTrackPlayer` 一致；`music` 下的无效控件置灰。
2. 同一片段可同时展开音频组的多个小组；选中一个叶子不隐藏其他组；主时间轴无属性行/节点。
3. `fade_in+fade_out > duration` 在提交前提示；`sound` 缺失/路径不存在有明确提示。
4. `meta.listener` 可切换；相对模式锚点（玩家/相机）可见；全局暂停/恢复与多实例混音可解释；只有一个写入口。
5. 外部格式解码状态（同步/异步/未就绪/失败）可见；不重写解码。
6. 视频音轨状态与同步阈值可见；不新增字段。
7. ADJUST 类型存在；59 通道 + 10 曲线 + `blend_mode` 在调色组中全部可编辑；与 CAMERA 自带调色归属清晰。
8. LUT 工作台可选择/清除、设 `lut_input_gamma`/`lut_strength`/`blend_amount`、显示错误与 12 采样器/烘焙说明。
9. 资源抽屉消费 `resource.list`；扩展名/上限/视频与外部格式边界明确。
10. 七份任务的验收/反例/冒烟均闭合；不把「面板能打开」当完成。

本轮**不做**且不留给后续兜底：音频波形/时间拉伸、混音台总线、视频解码（09-04）、字幕（09-03）、规则动作/事件记录（11）、模板（12）。
