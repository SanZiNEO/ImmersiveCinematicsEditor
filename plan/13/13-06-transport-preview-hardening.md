# 13-06 预览、传输与关闭硬化

## 目的

这一份同时做两件事：

1. **收三项小硬化**：预览档位 UI 与服务端固定值一致、资源视频扩展名、关闭幂等；
2. **验 WebUI 传输/预览/帧消费/teardown 的既有合同**，确保发布基线不是“能连上就行”。

13 不新增协议、不新增消息名、不改 18 字节头、不新增第二套预览管线。

## 一、预览固定 1920×1080@60

### 目标

服务端已经是固定值：

- `PreviewConfig.fixed()`：1920×1080@60、2s 关键帧、encoderEnabled true；
- `WebEditorApi.handlePreviewConfig` 忽略请求字段，回执固定 `mode/width/height/fps/keyframe/encoder`；
- `wireName()` 固定 `1080p`。

前端当前仍是旧档位：`original/720p/1080p`、`30/60fps`、`Preview.vue` 选择器、`sendPreviewConfig` 发 mode/fps。13-06 要收掉这个不一致。

### 目标 UI

- 删除 `original` / `720p` / `30fps` 选择器；
- 状态栏只读显示固定 `1920×1080@60`；
- 不再让用户“选择预览档位”；
- `editor.previewConfig` 只作为查询/回执，不再表达用户选择；
- 回执宽高/fps 与固定值一致；若回执异常，状态栏显示异常，不静默改档位；
- 状态栏可显示：固定规格、实际捕获宽高、编码器 H.264/RGBA、首帧状态、丢帧计数。

### 验收

- 打开编辑器，预览设置页/状态栏没有档位选择器；
- 连接前后都显示固定规格；
- 切换窗口/重连后不回到 `original`；
- 服务端回执 `mode=1080p`，前端不显示 `original/720p`；
- 不因为删除选择器而停止请求帧；
- 预览实际尺寸异常时可见，不假装 1080p。

### 允许改动

- 前端 `store.ts` / `Preview.vue` / `previewProtocol.ts` 的档位枚举、默认值、选择器、请求体；
- 服务端已固定，不回退成可配档位。

## 二、资源视频扩展名

### 目标

资源列举必须与运行时实际能力对齐，不能“能播放但列举不到”，也不能“列举了但运行时打不开”。

当前实际支持：

| 用途 | 实际扩展名 | 依据 |
|---|---|---|
| `kind=image` | `png` / `gif` | `TextureLoader` / `ImageLayer` |
| `kind=video` | `mp4` / `webm` / `mkv` | `VideoFiles` / `VideoLayer` |
| OVERLAY `image.path` | `png` / `gif` / `mp4` / `webm` / `mkv` | `ObjectValidator.IMAGE_EXTENSIONS` |
| `kind=audio` | `ogg` / `wav`；有 ffmpeg 时再加 `mp3` / `aac` / `flac` / `m4a` / `opus` / `wma` / `oga` / `ogx` | `CinematicAudioInstance` + `ExternalPcmDecode` |

`jpg` / `jpeg` / `webp` / `mov` 当前运行时没有对应支持，13 不把它们写成必过项，也不把 01-06 的提案当成已实现能力。

### 目标行为

- `resource.list{kind:"image"}` 只返回 png/gif；
- `resource.list{kind:"video"}` 返回 mp4/webm/mkv；
- `resource.list{kind:"all"}` 返回全部文件；
- `resource.list{kind:"audio"}` 返回 ogg/wav；ffmpeg 可用时增加外部白名单，不可用时明确只支持 ogg/wav；
- 资源路径仍是相对 `immersive_cinematics/resource/`；
- 越界路径拒绝；
- 超限返回 `truncated/total`，前端显示“还有更多”；
- 资源抽屉按 kind 分栏，不把视频塞进图片栏；
- 选择视频后，OVERLAY `image.path` 能保存并能播放；
- 没有 ffmpeg 时，外部音频“可列举/不可播放”的状态明确，不伪造成功。

### 允许改动

- `ResourceFileService` 的 kind/扩展名/truncated；
- 前端资源抽屉的 kind 选项；
- 01-06 的扩展名条目按实际代码修正；不为了迎合旧文档去加运行时没有的格式。

## 三、关闭幂等

### 问题基线

当前 `WebPreviewScreen.onClose()` 没有 `closed` 守卫，也没有 `removed()` 共用 teardown。重复调用可能：

- 再次走 `CameraManager.exitPreview()`，在非编辑器播放时误停游戏播放；
- 重复 `PreviewStreamer.close()` / `WebEditorServer.stop()`；
- 在另一个窗口仍连接时错误停止服务；
- 世界退出时留下未释放的预览消费者。

### 目标

- `WebPreviewScreen` 增加 `closed` 守卫；
- `onClose()` 与 `removed()` 共用同一 teardown；
- 第一次关闭执行清理，后续关闭直接返回；
- 关闭顺序固定为：

```text
飞控取消（仅本端点拥有）
→ 编辑器播放退出
→ 本端点预览流关闭
→ 服务端停止（仅宿主级 teardown）
→ 键位冷却
```

- 单端点关闭只释放本会话：
  - 不停止 `WebEditorServer`（除非这是宿主级关闭）；
  - 不关闭 `CaptureHub`；
  - 不取消其他端点的飞控；
  - 不关闭其他窗口的预览流。
- 世界退出走宿主级 teardown，清理 `WebPreviewScreen` / `WebEditorServer` / `PreviewStreamer`，无残留 8765、捕获消费者、按键、token。
- 重复 `onClose()` 不误停游戏播放。
- 总开关关闭才做宿主级 teardown；关闭幂等不等于“任何关闭都停服务”。

### 验收

1. 打开两个编辑器窗口；
2. 关闭窗口 A，窗口 B 继续出帧；
3. 关闭窗口 B，服务按宿主规则停止；
4. 重复对同一个 Screen 调 `onClose()`；
5. 世界退出/重进；
6. 总开关关闭/开启；
7. 关闭一个窗口时另一个窗口正在飞控。

必须成立：

- A 关闭后 B 仍连接、仍出帧；
- `CaptureHub` 未被关闭；
- 他人飞控未被取消；
- 重复关闭无异常、不误停游戏播放；
- 世界退出无残留；
- 总开关关闭后两模式均不可进入，重复关闭无异常。

## 四、传输/会话验收

以下项目不新增协议；按现有合同验，失败按 01/03 回退，不在 13 里改语义。

### 握手

- `127.0.0.1:8765`、`/ws`；
- token 64 位十六进制；
- Origin 白名单；
- 无 token 不发起无意义连接；
- token 轮换后重连能重新读取；
- 多客户端不选举、不互相踢；
- 单会话关闭只释放本会话。

### 消息

- 信封 `{type, data, id}` 不变；
- `hello_ack` 有版本、capabilities、schemaHash；
- `editor.ack` 能区分成功/失败；
- `flight.exit` 只到 owner，不广播；
- 无 id 的 `error` 在状态栏可见，不静默；
- 关键回执（`script.saved` / `flight.exit` / `editor.ack`）不可静默丢；
- 状态文本可合并，关键文本绝不静默丢。

### 预览 wire

- 18 字节大端头；
- `TYPE_RGBA=1`、`TYPE_H264=2`；
- `FLAG_KEYFRAME=0x01`；
- RGBA 载荷 `payload.length >= w*h*4`，多余字节忽略；
- `frameId` 只作诊断/配对，不参与播放时间；
- PTS 会话内单调，`<2^53`；
- codec 字符串 `avc1.42E033`（baseline level 5.1）；
- 不改头顺序/宽度/type。

### 帧消费

- 100ms 显示延迟；
- 队列 90；
- PTS 回退/断流重同步；
- H.264 等关键帧；
- RGBA `putImageData`；
- `VideoFrame` 每条路径 close；
- 首帧超时提示；
- `frameListener` 支持多监听（若仍是单回调，属 01/03 回退项）；
- 漂移修正只一处生效，不双修正。

### 预览流

- 服务端固定 1920×1080@60；
- 暂停由播放状态驱动，不由 `WebPreviewScreen.render` 驱动；
- 暂停补帧预算 20；
- 统计区分“已捕获/首帧”；
- 关闭只注销本消费者/本会话，不调用 `CaptureHub.close()`；
- 编码器关闭器异步回收，不阻塞渲染线程。

## 五、渐进硬化边界

13-06 直接改的只有：

1. 预览档位 UI/枚举/请求与固定值一致；
2. 资源视频扩展名与 kind；
3. `WebPreviewScreen` 关闭幂等 + `removed()`。

以下不直接改，只验收；失败回原轮：

- 18 字节头/类型/标志；
- RGBA/H.264 解析契约；
- 握手/token/Origin/代际/超时；
- 帧消费队列/PTS/VideoFrame；
- 飞控 owner/exit 定向；
- 规则/模板/字幕/转场语义。

这样 13 不会变成“顺手重写传输层”。

## 证据

- 预览设置页/状态栏截图（无档位选择器）；
- 资源 kind 请求响应（image/video/audio/all）；
- 关闭幂等录屏 + 日志（双窗口、重复 close、世界退出）；
- 预览首帧/暂停/seek/统计截图；
- 断连/重连抓包或日志；
- 协议头/时间戳日志（不泄露 token）。

## 通过标准

- 三项硬化完成并复验；
- 预览 UI 与服务端固定值一致；
- 资源列举与实际运行时能力一致；
- 关闭幂等通过双窗口/重复 close/世界退出；
- 传输/帧消费的 P0 项通过；
- 没有新增协议、消息名、第二套预览管线；
- 失败项有回退轮次，不用 13 硬补。
