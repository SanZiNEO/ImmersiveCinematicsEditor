# 10-03 外部音频解码（ExternalAudioDecode）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`01-AudioTrackPanel.md`、`02-AudioListenerAndMix.md`、`07-MediaResourceDrawer.md`、`../09-overlays-composition/04-VideoOverlay.md`

## 1. 职责

把音频解码的格式分流与状态呈现给作者：ogg/wav 同步解码；mp3/aac/flac/m4a/opus/wma/oga/ogx 走 ffmpeg 整段异步（48k/2ch/s16le，驻留内存）；未就绪时静音等待；失败时跳过/静音。编辑器只显示状态与格式提示，不重写解码。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 解码分流 | `J:script/CinematicAudioInstance.java — decode（334-360）` | minecraft ogg / 文件 ogg / wav / 外部格式 |
| ogg（Minecraft） | `CinematicAudioInstance.java — decodeOggFromMinecraft（409-443）` | 资源包声音 |
| ogg（文件） | `CinematicAudioInstance.java — decodeOggFromFile（393-408）` | STBVorbis |
| wav | `CinematicAudioInstance.java — decodeWav（444-493）` | 同步 |
| 外部异步 | `CinematicAudioInstance.java — startExternalDecode（361-371）`、`onExternalDecoded（372-392）` | `ExternalPcmDecode.decodeAsync` |
| 外部白名单 | `J:media/audio/ExternalPcmDecode.java — SUPPORTED_EXTENSIONS（41-50）`、`isSupportedExtension（52-56）`、`decodeAsync（70-）` | mp3/aac/flac/m4a/opus/wma/oga/ogx |
| 格式常量 | `ExternalPcmDecode.java:34-36` | 48k/2ch/16bit |
| 未就绪 | `CinematicAudioInstance.java — ensurePlaying（272-285）` | 静音等待，就绪后按当前执行时间起播 |
| 失败 | `CinematicAudioInstance.java:387-390` | 限频日志；实例失败 |
| 播放/清理 | `CinematicAudioInstance.java — play（168-182）`、`cleanup（303-）` | |
| ffmpeg 定位 | `J:media/video/Ffmpeg.java — ffmpeg（45-49）`、`available（61-63）` | 固定 `<gameDir>/ffmpeg/` |
| 音轨驱动 | `J:script/AudioTrackPlayer.java — startClipInstance（288-360）` | 构造实例即触发解码 |
| 资源列表 | `J:webui/ResourceFileService.java:47` | `AUDIO_EXT=ogg,wav`；外部格式不在列表 |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 无格式/状态提示 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 格式识别 | 无 | 按扩展名分流：同步/外部/不支持 |
| 状态 | 无 | `同步解码`/`外部解码中`/`失败`/`未知` |
| 未就绪 | 无 | 说明「静音等待，就绪后起播」 |
| ffmpeg 缺失 | 无 | 明确「外部格式不可用」 |
| 资源列表 | 只有 ogg/wav | 外部格式标注「不在列表，需手填」 |
| 解码实现 | 无 | 只引用，不重写 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/audio/AudioDecodeStatus.vue`（提案）：格式/状态/失败原因。
- `EDITOR:src/lib/audioFormat.ts`（提案）：扩展名分类（ogg/wav/外部/未知）；与 `ExternalPcmDecode.SUPPORTED_EXTENSIONS` 同源语义，仅用于提示。
- `EDITOR:src/components/audio/ExternalFormatHint.vue`（提案）：ffmpeg 缺失/格式不支持说明。

## 4. 输入输出与字段约束

**输入**：AUDIO 片段的 `sound`/`source`、宿主回执的解码状态（同步/异步/失败/ffmpeg 可用性）、资源列表。

**输出**：只读状态 + 格式提示；无新字段。

| 项 | 约束 |
|---|---|
| ogg | `source=minecraft` 走资源包；`source=file` 走文件；同步 |
| wav | 文件；同步 |
| 外部格式 | mp3/aac/flac/m4a/opus/wma/oga/ogx；ffmpeg 异步；48k/2ch/s16le |
| 未就绪 | 静音等待；不显示「播放中」 |
| 失败 | 跳过该 clip；不反复重试（`failedClips`） |
| ffmpeg 缺失 | 外部格式不可用；同步格式仍可用 |
| 资源列表 | `AUDIO_EXT` 只有 ogg/wav；外部格式手填 |

**必须显示的边界**：

- 外部解码是**整段**解码后驻留内存，不是流式；长音频占用内存。
- 解码在构造实例时启动（`startClipInstance`），不是播放到该帧才启动。
- 未就绪时实例存在但静音；`ensurePlaying` 就绪后按当前执行时间起播（不是从 0）。
- 失败后该 clip 被跳过（`failedClips`），不每帧重试。
- `source=minecraft` 只支持资源包声音（ogg），不支持外部格式。

## 5. 修改步骤

1. 新建 `audioFormat.ts`：扩展名分类（ogg/wav/外部/未知）；外部集合与 `ExternalPcmDecode` 对齐。
2. 新建 `AudioDecodeStatus`：显示格式、同步/异步、状态、失败原因；数据来自 03 的宿主回执；无回执显示「未知」。
3. 新建 `ExternalFormatHint`：ffmpeg 缺失时提示「外部格式不可用，请放 ffmpeg/ffprobe 到 `<gameDir>/ffmpeg/`」。
4. 在 `AudioTrackPanel` 底部挂状态区；`sound` 变更时刷新格式分类。
5. 资源抽屉（07）中，外部格式不在 `resource.list` 时标注「需手填路径」。
6. 不提供「重新解码」按钮（运行时按实例生命周期）；失败提示只读。
7. 保存后重载：`sound`/`source` 不变；状态按新实例重新计算。

## 6. 禁止修改

- 不得改 `CinematicAudioInstance.decode`/`ExternalPcmDecode` 的格式分流/采样率/通道。
- 不得在前端解码音频或生成 PCM。
- 不得把外部格式加入 `resource.list` 的 audio 列表（运行时列表只有 ogg/wav）。
- 不得新增 `decode_mode`/`sample_rate` 字段。
- 不得把「未就绪」显示成「失败」或「播放中」。
- 不得重试失败的 clip（运行时已跳过）。

## 7. 两分支承载

- **WebUI**：格式/状态提示；无写操作。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同格式/解码状态提示，复用公共端口而非复制解码器；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `CinematicAudioInstance` + `ExternalPcmDecode` + `Ffmpeg`。

## 8. 前置

- 01：AUDIO 字段面（`sound/source`）。
- 03：宿主解码状态/ffmpeg 可用性回执。
- 07：资源抽屉（格式提示）。
- 09-04：视频层（视频音轨归 04）。

## 9. 验收

**正例**

- `sound=intro.ogg`、`source=file`：状态「同步解码」；游戏内播放。
- `sound=intro.wav`：同步；播放。
- `sound=intro.mp3`、ffmpeg 可用：状态「外部解码中」→「就绪」；游戏内播放。
- 外部格式 + ffmpeg 缺失：状态「不可用（缺 ffmpeg）」；游戏内无声；不崩。
- 外部格式未就绪时 seek：静音等待；就绪后从当前执行时间起播（不是 0）。
- 坏文件：状态「失败」；该 clip 跳过；不反复重试。
- 资源抽屉：mp3 不在列表；标注「需手填」。

**反例**

- 前端解码 mp3 → 失败。
- 把 mp3 加入 audio 资源列表 → 失败。
- 未就绪显示「播放中」→ 失败。
- 失败后每帧重试 → 失败（运行时不会）。
- 新增 `decode_mode` 字段 → 失败。
- 声称外部解码是流式 → 失败。

## 10. 真实冒烟

1. ogg/wav/mp3/flac 各一个，ffmpeg 可用：状态与播放正确。
2. 移走 ffmpeg：mp3/flac 不可用；ogg/wav 仍可用。
3. 长 mp3：解码中→就绪；seek 后从当前时间起播。
4. 坏 mp3：失败；跳过；日志限频。
5. `source=minecraft` + ogg：资源包声音播放。
6. 资源抽屉：只列 ogg/wav；外部格式手填。

## 11. 完成定义

- 格式分流（同步/外部/未知）与 `CinematicAudioInstance` 一致。
- 未就绪/失败/ffmpeg 缺失都有明确提示；不本地解码。
- 不新增字段；不改采样率/通道；不把外部格式塞进资源列表。
- 正例/反例/冒烟全部通过。
