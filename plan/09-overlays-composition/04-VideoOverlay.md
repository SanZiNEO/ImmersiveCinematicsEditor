# 09-04 视频覆盖层（VideoOverlay）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：09-overlays-composition
> 关联：`01-OverlayTrackSurface.md`、`03-OverlayImageAndSubtitle.md`、`../10-audio-color-media/04-VideoAudioTrack.md`、`../03-host-transport/README.md`

## 1. 职责

编辑视频覆盖层（mp4/webm/mkv）的路径/布局/裁切/透明度/zIndex，并把运行时降级路径（缺 ffmpeg → unavailable；探测失败 → `ErrorTexture`；解码失败 → `markError`）与 4K 解码上限呈现给作者。视频音轨归 10-04；本文件不编辑音频。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 视频扩展名 | `J:media/video/VideoFiles.java — VIDEO_EXTENSIONS（15）`、`isVideo（26-35）`、`extension（36-）` | `mp4/webm/mkv` |
| 建层分派 | `J:script/OverlayTrackPlayer.java — createObjectLayer（140-195）` | image 且 `VideoFiles.isVideo(path)` → `VideoLayer` |
| 参数 | `J:script/OverlayClipRuntime.java — imageParams（218-241）` | 视频与 image 共用布局/裁切/透明度/z |
| 视频层 | `J:media/video/VideoLayer.java — setTime（115-123）`、`render（124-199）`、`ensureStarted（200-240）`、`updateFrame（241-274）`、`checkDecodeFailure（275-288）`、`markError（289-301）`、`reset（333-338）`、`close（339-）` | |
| 解码尺寸 | `VideoLayer.java:294-307`（`MAX_DECODE_WIDTH=4096`、`MAX_DECODE_HEIGHT=2160`、`fit`） | 源不超过上限按源解码；超过等比缩小；不放大 |
| 时间同步 | `VideoLayer.updateFrame（241-274）` | 倒退 0.05s、前跳 1.0s 阈值（见方法内常量/逻辑） |
| 探测 | `J:media/video/VideoProbe.java — probe（46-76）`、`TIMEOUT_SECONDS（28）`、`FALLBACK_FPS（29）` | 5s 超时；按路径+大小+mtime 缓存；失败限频 |
| 解码 | `J:media/video/VideoDecoder.java — QUEUE_CAPACITY（38）`、`start（100-149）`、`seek（150-162）`、`poll（163-175）`、`pollAtOrBefore（176-190）`、`isEnded（196-201）`、`close（202-）` | 队列 3；ffmpeg 管道 |
| 降级纹理 | `J:media/ErrorTexture.java — WIDTH/HEIGHT（23/26）`、`texture（57-）` | 16×9 棋盘、1920×1080、渲染线程懒创建、常驻 |
| ffmpeg | `J:media/video/Ffmpeg.java — ffmpeg（45-49）`、`ffprobe（55-59）`、`available（61-63）`、`encoderAvailable（66-68）` | 固定 `<gameDir>/ffmpeg/` |
| 视频音轨（10） | `J:media/video/VideoAudioTrack.java — syncToTime（55-85）`、`start（95-103）`、`stopInstance（104-）` | 归 10-04 |
| 校验 | `J:script/object/ObjectValidator.java — checkOverlay（691-721）`、`IMAGE_EXTENSIONS（51）` | path 扩展名白名单含 mp4/webm/mkv |
| 资源列表 | `J:webui/ResourceFileService.java:46` | `IMAGE_EXT` 只有 png/gif；视频不在 `resource.list` |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 无视频状态/降级提示 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 路径 | 通用文本 | 路径输入 + 扩展名分流（视频→本页） |
| 状态 | 无 | ffmpeg 可用/缺失、探测中/失败、解码中/失败 |
| 降级 | 无 | 明确「会显示 ErrorTexture 棋盘格」 |
| 4K | 无 | 解码上限说明（不放大） |
| 时间同步 | 无 | 只读说明（倒退/前跳阈值由运行时决定） |
| 音轨 | 无 | 跳 10-04；本页不编辑 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/VideoEditor.vue`（提案）：路径/布局/裁切/透明度/z + 状态徽标。
- `EDITOR:src/components/overlay/VideoStatusBadge.vue`（提案）：ffmpeg/探测/解码状态。
- `EDITOR:src/lib/videoAsset.ts`（提案）：扩展名判断（复用 `VideoFiles` 语义的 TS 镜像，仅用于分流，不做解码）。

## 4. 输入输出与字段约束

**输入**：视频片段 JSON（`path`/布局/`source`/`opacity`/`z_index`）、宿主回执的视频状态（ffmpeg 可用性、探测结果、解码错误）、真实画面。

**输出**：字段编辑意图；无新字段。

| 字段 | 约束 |
|---|---|
| `path` | 相对资源根；扩展名 `mp4/webm/mkv`；缺失/不存在 → 标注 |
| `x/y/anchor/scale` | 0–1 / 默认 1；与 image 相同 |
| `source.x/y/w/h` | 0–1；裁切 |
| `opacity` | 0–1 |
| `z_index` | INT 默认 10 |
| 解码尺寸 | 源 ≤4096×2160 按源；超过等比缩到上限；**不放大** |
| 状态 | `ffmpeg available` / `unavailable`；`probe ok/failed`；`decode ok/error` |

**必须显示的边界**：

- 缺 ffmpeg/ffprobe：`VideoLayer.ensureStarted` 标记 `unavailable`；不显示「加载中」。
- 探测失败：`ErrorTexture`（16×9 棋盘，1920×1080）；不显示黑屏或假帧。
- 解码失败：`markError`；同样 `ErrorTexture`。
- 4K 上限：源超过 4096×2160 会缩小解码，显示尺寸仍由图层参数决定。
- 视频音轨由 `VideoAudioTrack` 同步（10-04）；本页不提供音量/偏移。
- 视频不在 `resource.list`（`IMAGE_EXT` 只有 png/gif）；路径输入必须支持手填 + 存在性检查（`ResourcePath.exists`）。

## 5. 修改步骤

1. 新建 `videoAsset.ts`：扩展名判断与路径规范化；只用于分流，不解析媒体。
2. 新建 `VideoStatusBadge`：三态（ffmpeg/探测/解码）+ 文案；数据来自 03 的宿主回执；无回执显示「未知」。
3. 新建 `VideoEditor`：路径输入 + 存在性检查 + 布局/裁切/透明度/z；状态徽标；「音轨设置见 10-04」链接。
4. 在 `OverlayTrackPanel` 的 image 分支：`path` 是视频扩展名时切到 `VideoEditor`；图片仍用 03 的 `ImageEditor`。
5. 降级提示：`unavailable` → 「未找到 ffmpeg/ffprobe（<gameDir>/ffmpeg/）」；`probe failed`/`decode error` → 「显示 ErrorTexture 棋盘格」。
6. 4K 说明：显示「解码上限 4096×2160；超过等比缩小；不放大」。
7. 时间同步说明：只读列出「倒退 0.05s / 前跳 1.0s」等阈值（以 `updateFrame` 为准），不提供可调参数。
8. 保存后重载：路径/布局/裁切逐值一致；游戏内视频按状态播放或降级。

## 6. 禁止修改

- 不得改 `VideoLayer`/`VideoProbe`/`VideoDecoder`/`ErrorTexture`/`Ffmpeg` 的解码/降级/尺寸语义。
- 不得在前端解码视频或生成本地帧。
- 不得新增视频字段（音量/偏移/循环等）；音轨归 10-04。
- 不得把视频放进 `resource.list` 的 image 列表（`IMAGE_EXT` 不含视频）。
- 不得把 `unavailable` 显示成「加载中」或「无视频」。
- 不得调整 4K 上限或 `fit` 行为。

## 7. 两分支承载

- **WebUI**：视频路径/布局/状态；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同视频引用/布局/状态面板，通过03公共端口消费结果，不复制解码链；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `VideoLayer` + `VideoProbe` + `VideoDecoder` + `Ffmpeg`。

## 8. 前置

- 01：image 字段面（视频共用布局/裁切）。
- 03：真实画面 + 宿主视频状态回执。
- 02：对象叶子路径 + 原子提交。
- 10-04：视频音轨（本页只跳转）。

## 9. 验收

**正例**

- `path=demo.mp4` 且 ffmpeg 可用：状态「可用」；游戏内播放；布局/裁切生效。
- 删掉 ffmpeg 目录：状态「不可用（缺 ffmpeg）」；游戏内显示 `ErrorTexture` 棋盘格。
- 坏文件：探测失败 → 棋盘格；UI 标注「探测失败」。
- 4K 源：UI 说明「按上限缩小解码」；画面比例正确。
- `path` 不存在：路径红条；保存前提示。
- 点击「音轨设置」跳 10-04；本页无音量控件。

**反例**

- 前端解码并显示视频帧 → 失败。
- `unavailable` 显示「加载中」→ 失败。
- 视频出现在 image 资源列表 → 失败。
- 新增 `volume`/`audio_offset` 字段 → 失败（音轨归 10-04）。
- 把 4K 源放大到 8K 解码 → 失败（不放大）。
- 探测失败显示黑屏而非 `ErrorTexture` 说明 → 失败。

## 10. 真实冒烟

1. 放一个 mp4 到资源目录；打开视频片段：状态可用，游戏内播放。
2. 改 `source.w=0.5`、`z_index=30`：画面裁切/层级正确。
3. 移走 ffmpeg：重启预览；状态不可用，棋盘格出现。
4. 放坏 mp4：探测失败；棋盘格；日志有限频。
5. 放 4K mp4：解码缩小；画面比例正确。
6. 跳 10-04 调音轨：视频音轨同步；返回视频页参数不变。

## 11. 完成定义

- 视频路径/布局/裁切/透明度/zIndex 可编辑；扩展名分流正确。
- ffmpeg 缺失/探测失败/解码失败/4K 上限都有明确提示。
- 不本地解码/渲染；不新增视频字段；音轨归 10-04。
- 视频不在 image 资源列表的假设被正确处理（手填路径 + 存在性检查）。
- 正例/反例/冒烟全部通过。
