# 03-03 预览流生命周期（捕获 → 编码 → 会话队列）

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：`README.md`、`03-01-preview-wire-format.md`、`03-04-frame-consumer.md`、`03-07-host-teardown.md`、`../shared/contracts.md`（C06）

## 1. 职责

冻结服务端预览流从「打开编辑器」到「关闭编辑器」的完整生命周期：捕获规格、消费者注册、每会话编码器/RGBA 回退、发送节流、暂停/恢复、seek 补帧、统计推送、关闭回收。本任务不定义帧字节格式（03-01）与前端显示（03-04）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 单例/消费者 | `MOD:webui/PreviewStreamer.java:30-33` | `implements CaptureHub.Consumer`；`INSTANCE` |
| 统计间隔 | `PreviewStreamer.java:36` | 1000ms |
| 补帧预算 | `PreviewStreamer.java:45` | `PAUSED_REFRESH_FRAME_BUDGET=20` |
| 编码器关闭器 | `PreviewStreamer.java:52-62` | 单线程 daemon `IC-PreviewEnc-closer`；`close()` 异步回收 |
| 会话表 | `PreviewStreamer.java:64-76` | `ConcurrentHashMap<WebSocketSession, SessionStream>` |
| 打开/关闭会话 | `PreviewStreamer.java:78-96` | `onSessionOpened` 建 `SessionStream`；`onSessionClosed` 移除并 `closeStream()` |
| 是否需要帧 | `PreviewStreamer.java:99-110` | 服务未跑/无客户端 → false；暂停时仅预算内 true；未暂停恒 true |
| 捕获规格 | `PreviewStreamer.java:112-116` | `new CaptureHub.CaptureSpec(1920,1080,60)` |
| 规格变化 | `PreviewStreamer.java:118-123` | 每会话 `resetForConfigChange()` |
| 补帧请求 | `PreviewStreamer.java:131-138` | `pausedRefreshFrames=20` + 每会话 `beginRefresh()` |
| 帧分发 | `PreviewStreamer.java:145-176` | 暂停时只放行刷新帧；未暂停每会话 `submit(frame.retain())`；finally `frame.release()` |
| 暂停/恢复 | `PreviewStreamer.java:178-193` | 暂停 → 每会话 `shutdownEncoder`；恢复 → `resetForResume` |
| 配置 | `PreviewStreamer.java:195-197` | `PreviewConfig.fixed()` |
| 统计 | `PreviewStreamer.java:207-259` | 1s 节流；每会话单播 `preview.stats`；`width/height` 取 CaptureHub 当前值，未捕获则 config |
| 关闭 | `PreviewStreamer.java:261-271` | 注销 CaptureHub；每会话 `closeStream`；清表 |
| 会话流状态 | `PreviewStreamer.java:274-542` | 编码器、回退标志、PTS 基准、节流、丢帧计数 |
| 提交/节流 | `PreviewStreamer.java:317-373` | `force` 为补帧；否则按 `1000/fps` 节流；`inputDropped++` |
| RGBA 回退 | `PreviewStreamer.java:374-388` | `pack` 后 `session.enqueueFrame`；成功则 `producedFrames++` |
| 编码器创建 | `PreviewStreamer.java:390-443` | `rgbaFallback`/`encoderEnabled`/`Ffmpeg.encoderAvailable`；尺寸/fps 变化重建；`offsetMicros` 保证 PTS 单调 |
| 编码器失败 | `PreviewStreamer.java:414-441` | 起不来 → 本帧回退 RGBA；运行期失败 → `disableEncoderLocked` |
| 编码器关闭 | `PreviewStreamer.java:444-453` | 累计丢帧、置空、提交 `ENCODER_CLOSER` |
| AU 回调 | `PreviewStreamer.java:455-476` | 加偏移、强制单调、`pack(TYPE_H264)`、入队 |
| 刷新基线 | `PreviewStreamer.java:478-486` | `beginRefresh` 记 `producedFrames`；`refreshSatisfied` 判产出 |
| 状态名 | `PreviewStreamer.java:523-531` | `h264` / `rgba` / `off` / `pending` |
| 捕获入口 | `MOD:media/capture/CaptureHub.java:41-44` | `INSTANCE` |
| PBO/池 | `CaptureHub.java:47-50` | 3 个 PBO、6 个缓冲 |
| 消费者接口 | `CaptureHub.java:74-101` | `needsFrame`/`onFrame`/`onCaptureFormatChanged`/`captureSpec` |
| 注册/注销 | `CaptureHub.java:145-160` | 重复注册忽略；注销无操作 |
| 每帧入口 | `CaptureHub.java:163-224` | 无人需要零开销；规格非法跳过；规格变化重建 |
| 捕获实现 | `CaptureHub.java:263-312` | 取缓冲 → blit → PBO 读回 → 交付两帧前 |
| 交付/引用计数 | `CaptureHub.java:358-398` | 每消费者 `retain`，回调后 `release`；异常只跳过该消费者 |
| 关闭 | `CaptureHub.java:246-261` | 置 closed、清池、清消费者、删 FBO/PBO |
| 挂点 | `MOD:mixin/GameRendererMixin.java:147-157` | `Gui.render` 之后调用 `CaptureHub.onHudRendered` |
| 屏幕驱动 | `MOD:webui/WebPreviewScreen.java:73-112` | `render` 内 `setPaused`、`tick`、50ms `playback.state`、飞控 tick/100ms 状态/HUD |
| 初始化 | `WebPreviewScreen.java:56-70` | `WebEditorServer.start()` + `CaptureHub.register(PreviewStreamer.INSTANCE)` |
| 关闭 | `WebPreviewScreen.java:337-350` | `exitPreview` → `PreviewStreamer.close` → `WebEditorServer.stop` |
| 前端消费 | `ED:components/Preview.vue:15-21,48-343` | 100ms 延迟、队列 90、PTS 重建、解码器重建、绘制、卸载清理 |
| 前端配置请求 | `ED:store.ts:263-280` | `editor.previewConfig` 带 mode/fps/keyframeIntervalSeconds/encoder |

**已核对的缺口**：

1. **固定规格 vs 前端档位**：`captureSpec` 固定 1920×1080@60（`PreviewStreamer.java:112-116`），`handlePreviewConfig` 忽略请求（`WebEditorApi.java:299-311`）；前端仍可选 `original/720p/30fps`（`Preview.vue:357-364`）。用户选择不会生效。
2. 当前没有GPU纹理公共出口只影响未来14迁移；WebUI以真实CPU捕获→RGBA/H264正常完成，不把GPU接口缺失列为本轮阻塞。
3. **编码器关闭不可观测**：`close()` 只提交异步回收，不等待；验收只能观察「N 秒后无 ffmpeg 子进程」，不能在返回时断言。
4. **暂停状态依赖 render**：`setPaused` 只在 `WebPreviewScreen.render` 调用（`WebPreviewScreen.java:73-106`）。当 WebPreviewScreen 不是栈顶（例如被其他 Screen 覆盖）时 `render` 不执行，暂停状态不会更新，预览流可能继续按旧状态出帧。
5. **补帧依赖渲染帧**：`requestFrame()` 设预算，但暂停时若没有新的渲染帧（窗口最小化/游戏暂停），补帧不会发生；前端拖动播放头可能长时间看不到新画面。
6. **统计的 width/height 可能是配置值**：未捕获时回落到 `config.width()/height()`（`PreviewStreamer.java:218-221`），前端无法区分「已出帧」与「仅配置」。
7. **多会话资源**：每会话一个 ffmpeg 进程；N 个编辑器窗口 = N 个进程，无并发上限。
8. **采样无上限**：未暂停时每个渲染帧都做 1080p 读回（`needsFrame` 恒 true），高刷新率屏幕下 CPU 开销固定；发送端才按 60fps 节流。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 预览档位 | 固定 1080p60；前端有档位 | UI 只读显示「固定 1080p60」；删除档位选择器；`editor.previewConfig` 保留为「查询生效值」 |
| 暂停驱动 | `WebPreviewScreen.render` | 由播放状态变化驱动（`CameraManager.isEditorPlayback/isEditorPaused` 的边沿）或在 `ClientTick` 轮询；不依赖屏幕是否在栈顶 |
| 补帧 | 预算 20 帧 | 若 200ms 内无渲染帧，主动请求一次 `Minecraft` 渲染/或在前端显示「等待画面」；不伪造帧 |
| 统计 | width/height 可能是配置值 | 增加 `captured` 布尔或 `frameId`；前端区分「配置」与「实测」 |
| GPU 出口 | 无 | `EditorFrameSource`（提案）：纹理 id + 尺寸 + generation + 帧回调；见 03-08 |
| 并发会话 | 无上限 | 提案：最多 4 个会话；超出拒绝并回执；不本轮 |
| 采样 | 每渲染帧 | 保持（发送端节流），但在文档中明确 CPU 代价；不擅自降采样 |

### 3.2 拟新建/修改（提案）

- `ED:components/Preview.vue`（修改）
  - 删除分辨率/帧率 `<select>`（`Preview.vue:357-364`）与 `onModeChange/onFpsChange`（306-314）；状态栏显示服务端回执的 `mode/width/height/fps`。
  - `statsSize` 增加「未出帧」态：`state.previewStats?.sent === 0` 时显示「等待首帧」。
- `ED:store.ts`（修改）
  - `sendPreviewConfig` 只发一次「查询」语义（不带 mode/fps 选择），回执覆盖 `previewMode/previewFps`；默认值改为 `1080p`/`60`。
  - 删除 `PreviewMode` 的 `original|720p` 分支（或保留类型但 UI 不提供）。
- `MOD:webui/PreviewStreamer.java`（提案，本轮不改）
  - `setPaused` 的调用点从 `WebPreviewScreen.render` 移到播放状态变化处；`render` 只保留 `tick` 与推送。
  - `tick` 增加 `captured`/`frameId` 字段。
- `MOD:webui/WebPreviewScreen.java`（提案）
  - `init()` 检查 `start()` 返回值并提示。
- **不新建**第二套捕获/编码实现；不把 H.264 换成 JPEG。

## 4. 输入输出与字段约束

### 4.1 打开

输入：F9 → `WebPreviewScreen` 构造 → `init()`。
输出：服务端监听 8765；`CaptureHub` 消费者表含 `PreviewStreamer.INSTANCE`；`WebEditorServer.hasClients()` 在首个编辑器连上后为 true。

约束：`register` 幂等（resize 会重复 init）；`start()` 幂等。

### 4.2 出帧

输入：`CaptureHub.onHudRendered(mc)` 每渲染帧。
输出：每会话 `enqueueFrame(byte[])`。

约束：
- 未暂停：每个渲染帧都提交，`submitLocked` 按 `1000/config.fps()` 节流；被节流的帧 `inputDropped++`。
- 暂停：仅预算内提交；每会话产出一次后停止。
- 编码器输入队列容量 1；满时丢最旧并 `encoderDropped++`。
- 会话发送队列容量 16；满时丢最旧帧并 `dropped++`。

### 4.3 暂停/恢复

- `setPaused(true)`：`paused=true`；每会话 `shutdownEncoder()`（关闭编码器、清空输入队列、保留 `rgbaFallback`）。
- `setPaused(false)`：`paused=false`；`pausedRefreshFrames=0`；每会话 `resetForResume()`（关编码器、清回退标志、下一帧重建、首帧 IDR）。

### 4.4 seek 补帧

- `requestFrame()`：`pausedRefreshFrames=20`；每会话 `beginRefresh()` 记录 `producedFrames` 基线。
- 暂停态 `onFrame`：每会话 `submitRefreshFrame(retain)`；`refreshSatisfied()` 为 true 的会话不再需要；全部满足或预算耗尽即停。
- H.264 的「产出」以 AU 回调为准；RGBA 以入队成功为准。

### 4.5 统计

每 1000ms，每会话一条：

| 字段 | 来源 | 约束 |
|---|---|---|
| `mode` | `config.wireName()` | 固定 `1080p` |
| `width`/`height` | `CaptureHub.width()/height()`，0 时回落 config | 建议增加 `captured` |
| `fps` | `config.fps()` | 固定 60 |
| `encoder` | `h264`/`rgba`/`off`/`pending` | 见 `encoderState()` |
| `sent` | 会话出队帧数 | 累计 |
| `dropped` | 会话队列丢帧 | 累计 |
| `inputDropped` | 本层节流丢帧 | 累计 |
| `encoderDropped` | 编码器输入队列丢帧（含已关闭实例累计） | 累计 |

### 4.6 关闭

- `PreviewStreamer.close()`：`CaptureHub.unregister(this)`；每会话 `closeStream()`；清表。只注销本消费者并关闭本模式的会话流。
- 编码器 `close()` 提交 `ENCODER_CLOSER`；不等待进程退出。
- `CaptureHub` 不因 `PreviewStreamer.close()` 而关闭（它可能还有其他消费者）；`WebPreviewScreen.onClose` 不调用 `CaptureHub.close()`。
- 单会话断开只调用该会话的 `closeStream()`；不停止 `PreviewStreamer`、不关闭其他会话、不取消其他端点拥有的飞控。
- 总开关从开启切到关闭时，才由统一入口触发本模式停止（等价于关屏路径）；普通 WebUI 屏关闭只影响 webui 模式。

### 4.7 总开关与模式归属

- `PreviewStreamer` 只在 `editor.webui` 模式被消费时注册为 `CaptureHub.Consumer`；不在客户端初始化或总开关开启时自动注册。
- 总开关关闭后 `PreviewStreamer` 不得再请求帧或创建编码器；重复 `close()` 幂等。
- 本任务不定义 ingame 帧源；`EditorFrameSource` 是独立消费者（03-08/13-03），两者可并存但释放互不影响。

## 5. 修改步骤

1. 前端删除档位选择器，状态栏改为只读显示；`store.ts` 默认值改 1080p/60。
2. `statsSize` 增加「等待首帧」；`droppedTotal` 保持三项之和。
3. 主模组侧（本轮不改）：`setPaused` 调用点上移；`tick` 增加 `captured/frameId`；`start()` 失败提示；`EditorFrameSource` 合同。
4. 迁移所有引用 `original/720p/30fps` 的前端代码（`store.ts:57-58,263-280,333-337`；`Preview.vue:306-314,357-364`）。
5. 保留 `PreviewMode` 类型但收窄为 `'1080p'`，或删除类型并改用服务端回执字段；二选一，不保留两套。

## 6. 禁止修改

- 不改捕获点（`Gui.render` 之后）与 1920×1080 固定规格（2026-11-09 裁决）。
- 不在渲染线程等待网络/进程退出。
- 不把 `CaptureHub.close()` 放进 `PreviewStreamer.close()`（会误杀其他消费者）。
- 不在单会话断开时停止 `PreviewStreamer`、关闭其他会话或取消其他端点的飞控。
- 不在暂停时伪造帧或重复发送旧帧充数。
- 不自动降分辨率/帧率（只丢帧计数）。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `Preview.vue`、`store.ts`（档位/状态） |
| 编辑器 `1.20.1` | 不承载 `PreviewStreamer`；进程内画面见 13-03 |
| 主模组 `main` | `PreviewStreamer.java`、`PreviewEncoder.java`、`CaptureHub.java`、`WebPreviewScreen.java` |

## 8. 前置

- 03-01 的帧格式与 PTS 契约。
- 03-02 的会话表与关闭顺序。
- 13-03 的 `EditorFrameSource` 合同（若要 GPU 直连）。

## 9. 正反例验收

**正例 A**：F9 打开，编辑器连上；`preview.stats` 每秒一条，`encoder` 从 `pending` 变 `h264`，`sent` 持续增长。
**正例 B**：暂停后拖动播放头，观察补帧：`sent` 增加 ≥1，H.264 首帧 `flags&1 != 0`；`inputDropped` 不因补帧暴涨。
**正例 C**：恢复播放，首帧为关键帧；`encoder` 仍为 `h264`（未回退）。
**正例 D**：两个编辑器会话同时连，各自 `sent` 独立；一个暂停不影响另一个出帧。

**反例 A**：删除 `ffmpeg/ffmpeg.exe` 后重连，`encoder=rgba`，帧仍到达；`sent` 增长。
**反例 B**：运行中杀掉 ffmpeg 进程，本会话 `encoder=rgba`，另一会话仍 `h264`；日志有限频回退记录。
**反例 C**：关屏后 5s，系统进程列表无 ffmpeg 子进程；`IC-WSSender`/`IC-WSReader` 线程消失（`IC-PreviewEnc-closer` 常驻不算泄漏）。
**反例 D**：WebPreviewScreen 被其他 Screen 覆盖时，暂停状态仍应正确（当前缺口：`setPaused` 不执行）。
**反例 E**：窗口最小化后 seek，补帧不应无限等待（当前缺口：无渲染帧则无补帧）。
**反例 F**：两个会话 A/B；B 断开 → A 的 `sent` 继续增长，B 的编码器回收；`PreviewStreamer` 仍注册在 `CaptureHub`。不得出现 B 断开导致 A 停流或 `CaptureHub` 被关闭。
**反例 G**：总开关关闭 → 不再出帧、不再创建编码器、`CaptureHub` 仍可被其他消费者使用；重复关闭无异常。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + ffmpeg + Electron。

1. F9 → 连接 → 播放一段含 CAMERA/OVERLAY 的脚本，确认画面连续、HUD 存在、编辑器 UI 不在画面里。
2. 暂停 → 拖动播放头 5 次，确认每次都有新画面（补帧）。
3. 恢复 → 确认首帧关键帧、无花屏。
4. 关闭 ffmpeg（重命名）→ 重连 → 确认 RGBA 回退仍可用（带宽高、帧率可能下降）。
5. 关屏 → 检查进程/线程；重复开关 20 次，确认无累积。

本次未执行；未来03当轮验证WebUI真实捕获/编码/释放，13全量复核；14才迁移进程内画面。

## 11. 完成定义

- 前端档位与服务端固定值一致；状态栏能区分「配置」与「已出帧」。
- 暂停/恢复/补帧/回退/关闭五项各有正反例验收步骤。
- 单会话断开与总开关关闭的释放范围明确：只释放本消费者/本会话；`CaptureHub` 与其他消费者不受影响。
- `EditorFrameSource` 缺口写入 03-08，不在本任务内假装已实现。
- 未执行的真实冒烟明确标注。
