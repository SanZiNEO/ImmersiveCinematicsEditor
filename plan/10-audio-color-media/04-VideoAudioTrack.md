# 10-04 视频音轨（VideoAudioTrack）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`01-AudioTrackPanel.md`、`03-ExternalAudioDecode.md`、`../09-overlays-composition/04-VideoOverlay.md`

## 1. 职责

把视频文件自带音轨的同步与状态呈现给作者：`VideoAudioTrack` 以 100ms 暂停判定、0.25s 漂移、0.05s 倒退阈值跟随 `VideoLayer`；`VideoAudioInstance` 走 `ProcessPcmStream`（48k/2ch/16bit）。视频音轨是视频层的一部分，不是 AUDIO 轨道；不新增字段。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 视频音轨 | `J:media/video/VideoAudioTrack.java — TIME_EPSILON（23）`、`PAUSE_THRESHOLD_NANOS（25）`、`SEEK_BACK_TOLERANCE（27）`、`DRIFT_TOLERANCE（29）` | 100ms / 0.05s / 0.25s |
| 同步 | `VideoAudioTrack.java — syncToTime（55-85）` | 暂停/漂移/倒退判定 |
| 启停 | `VideoAudioTrack.java — start（95-103）`、`stopInstance（104-）`、`close（86-94）` | |
| 音频实例 | `J:media/video/VideoAudioInstance.java` | 构造（39-55）、`canPlaySound（56-60）`、`canStartSilent（61-66）`、`resolve（67-82）`、`getStream（83-87）`、`tick（88-）` |
| 常量 | `VideoAudioInstance.java` | MASTER/relative/NONE/volume 1（类内常量） |
| PCM 流 | `J:media/video/ProcessPcmStream.java — SAMPLE_RATE（35）`、`CHANNELS（36）`、`BITS（37）`、`SCRATCH_SIZE（38）`、`EMPTY（42）`、构造（61-） | ffmpeg 管道；48k/2ch/16bit；失败静音 |
| 视频层 | `J:media/video/VideoLayer.java — ensureStarted（200-240）`、`updateFrame（241-274）`、`close（339-）` | 音轨随视频层启动/关闭 |
| 探测 | `J:media/video/VideoProbe.java — probe（46-76）` | 是否有音轨 |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 无视频音轨状态 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 有无音轨 | 无 | 探测结果显示「有/无音轨」 |
| 同步状态 | 无 | 播放/暂停/漂移/失败 |
| 阈值 | 无 | 只读说明 100ms/0.25s/0.05s |
| 格式 | 无 | 48k/2ch/16bit |
| 字段 | 无 | 不新增；视频层不提供音量/偏移 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/VideoAudioStatus.vue`（提案）：音轨状态/阈值说明（挂在 09-04 的视频页）。
- `EDITOR:src/lib/videoAudio.ts`（提案）：从探测结果/宿主回执推导「有音轨/无音轨/失败」；不做解码。

## 4. 输入输出与字段约束

**输入**：视频片段的探测结果（是否有音轨）、宿主回执的 `VideoAudioTrack` 状态、`VideoLayer` 播放状态。

**输出**：只读状态；无字段编辑。

| 项 | 约束 |
|---|---|
| 音轨存在 | 探测结果；无音轨时状态「无」 |
| 暂停判定 | 100ms（`PAUSE_THRESHOLD_NANOS`） |
| 漂移 | 0.25s（`DRIFT_TOLERANCE`） |
| 倒退 | 0.05s（`SEEK_BACK_TOLERANCE`） |
| 格式 | 48k/2ch/16bit（`ProcessPcmStream`） |
| 失败 | 静音（`ProcessPcmStream` 失败静音） |
| 音量 | 固定 1（`VideoAudioInstance`）；无字段 |

**必须显示的边界**：

- 视频音轨与 AUDIO 轨道是两套：前者随视频层，后者是脚本音频；不共享音量/位置字段。
- 视频音轨没有 `position_mode/attenuation`；它是视频层的一部分。
- 暂停/seek 时 `VideoAudioTrack` 按阈值重启/静音；不是逐帧精确。
- 失败时静音，不阻塞视频画面。
- 视频音轨不进入 `AudioTrackPlayer` 的实例表；不参与 `pauseAll`（由视频层自己管理）。

## 5. 修改步骤

1. 新建 `videoAudio.ts`：从探测/回执推导状态；枚举「有音轨/无音轨/失败/未知」。
2. 新建 `VideoAudioStatus`：状态 + 阈值 + 格式说明；挂在 09-04 的视频页底部。
3. 在 09-04 的 `VideoEditor` 中引用；不新增字段控件。
4. 与 `AudioTrackPanel` 的边界说明：视频音轨不是 AUDIO 片段；点击「音频轨道」跳 AUDIO 页。
5. 保存后重载：视频路径不变；状态按新探测计算。
6. 不提供音量/偏移/静音开关（运行时没有字段）。

## 6. 禁止修改

- 不得改 `VideoAudioTrack`/`VideoAudioInstance`/`ProcessPcmStream` 的同步/格式/失败语义。
- 不得在前端解码视频音轨或生成 PCM。
- 不得新增视频音量/偏移/静音字段。
- 不得把视频音轨塞进 `AudioTrackPlayer` 或 AUDIO 轨道。
- 不得把「失败静音」显示成「无声轨」。
- 不得调整阈值常量。

## 7. 两分支承载

- **WebUI**：状态/阈值说明；无写操作。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同视频音轨同步状态面板，经公共端口取得真值，不复制VideoAudioTrack；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `VideoAudioTrack` + `VideoAudioInstance` + `ProcessPcmStream`。

## 8. 前置

- 09-04：视频层页面与探测结果。
- 03：宿主视频/音频状态回执。
- 01：AUDIO 字段面（边界说明）。

## 9. 验收

**正例**

- 带音轨 mp4：状态「有音轨」；游戏内声音与画面同步。
- 无音轨 mp4：状态「无音轨」；画面正常、无声。
- 暂停/seek：音轨按 100ms/0.25s/0.05s 阈值重启/静音；不爆音/不漂移。
- 坏音轨：状态「失败（静音）」；画面继续。
- 点击「音频轨道」跳 AUDIO 页；视频页无音量控件。

**反例**

- 视频页出现音量/偏移字段 → 失败。
- 把视频音轨放进 AUDIO 轨道 → 失败。
- 前端解码音轨 → 失败。
- 「失败」显示成「无音轨」→ 失败。
- 调整阈值常量 → 失败。
- 暂停时音轨继续播放 → 失败（与同步语义不符）。

## 10. 真实冒烟

1. 带音轨 mp4：播放/暂停/seek；声音同步。
2. 无音轨 mp4：无声；画面正常。
3. 坏音轨：静音；画面继续；日志限频。
4. 视频层关闭/重开：音轨停止/重建；无泄漏。
5. 与 AUDIO 轨道同时播放：两套声音共存；互不控制。
6. 09-04 视频页：状态与游戏内一致。

## 11. 完成定义

- 视频音轨状态（有/无/失败/未知）可读；阈值/格式可解释。
- 不新增字段；不本地解码；不并入 AUDIO 轨道。
- 失败静音不阻塞画面；暂停/seek 同步符合运行时。
- 正例/反例/冒烟全部通过。
