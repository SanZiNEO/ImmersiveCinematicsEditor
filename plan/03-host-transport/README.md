# 03 宿主传输：WebUI 跨进程协议、会话、资源与预览生命周期

> 状态：未实现（仅计划；现有 WebUI 服务端/前端已存在，本轮要把它收成可验收的宿主传输层，不把现状当成本轮已实现）
> 范围：`WebUI`（Electron/浏览器）与主模组 `webui/` 服务端之间的帧协议、WebSocket 会话与握手、预览流生命周期、消息路由、脚本/资源/schema 服务、关闭释放；Forge 1.20.1 为第一条真实垂直切片，Fabric 主模组通路按 `shared/host-scope.md` 保留但不作为本轮验收前置。
> 关联：[实施顺序](../shared/implementation-order.md)、shared/contracts、host-scope、editor-package-modes；[13 WebUI验收](../13-webui-acceptance-release/README.md)通过后才[14 AUI迁移](../14-aui-forge-migration/README.md)。

**路径记号**：`MOD:` = `E:/Documents/GitHub/ImmersiveCinematics/common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`ED:` = `E:/Documents/GitHub/ImmersiveCinematicsEditor/src/`；`EDE:` = `E:/Documents/GitHub/ImmersiveCinematicsEditor/electron/`。行号以 2026-11-11 工作区为准；文件改动后先按符号定位。

## 一、摘要

本轮完整落实WebUI连接、消息、资源、真实RGBA/H264和关闭释放，并将当前webui包纳入统一editor管理。进程内信号/GPU/AUI只约定未来14的设计边界，不是本轮实现或验收前置。本次仅编写计划，不修改代码；未来实施03时必须实际交付WebUI能力，不能只交合同。

WebEditorServer只是外部传输，EditorManager统一总开关和当前WebUI资源；ingame未实现时不宣告可用、不放空适配器。先01–12完成WebUI、13打磨全验，14再实现游戏内Forge+AUI。

## 二、为什么做

### 2.1 问题

- 前端预览面板有分辨率/帧率选择器（`ED:components/Preview.vue:357-364`），`store.ts:57-58` 默认 `original` + 60；但服务端 `PreviewConfig.fixed()` 固定 1920×1080@60，`handlePreviewConfig` 忽略请求字段（`MOD:webui/WebEditorApi.java:299-311`）。用户选 `original`/`720p`/`30fps` 不会生效，界面却在显示一个不存在的档位——这是可观察的错配。
- `WebEditorApi.handle(String, WebSocketSession)` 的第二个参数类型 `WebSocketSession` 是包私有类（`MOD:webui/WebSocketSession.java:23`），所以即使方法声明为 `public`，包外也无法构造或引用；`PreviewStreamer.onSessionOpened/onSessionClosed` 同理（`MOD:webui/PreviewStreamer.java:78,84`）。13 轮的进程内宿主若直接调这些方法，就是访问主模组内部类，不是稳定接口。
- `editor.exit_flight_mode` / `editor.cancel_flight_mode` 直接调用 `WebPreviewScreen.requestFlightExit(...)`（`MOD:webui/WebEditorApi.java:86-87`），而该静态方法依赖 `activeScreen`（`MOD:webui/WebPreviewScreen.java:43,200-210`）。进程内宿主没有 `WebPreviewScreen` 时，飞控退出无入口。
- `playback.state` / `preview.stats` / `flight.state` 的推送路径分别绑定 `WebEditorServer.INSTANCE.broadcastText`（`MOD:webui/WebEditorApi.java:313-323`、`MOD:webui/PreviewStreamer.java:207-259`、`MOD:webui/WebPreviewScreen.java:279-324`）。没有「推送目标」抽象，进程内宿主无法复用同一语义。
- 资源列举的扩展名白名单仍是 PNG/GIF、OGG/WAV（`MOD:webui/ResourceFileService.java:44-46`），而运行时媒体已支持视频与更多音频；`kind=image/audio` 不会列出它们。前端资源选择器因此看不到可用的视频素材。
- `hello_ack` 只带固定 `version = "0.3.6"`（`MOD:webui/WebEditorApi.java:95-100`），没有 schema 版本/哈希，也没有能力位；编辑器无法判断「模组字段是否已变化」「某条消息是否支持」。
- 关闭顺序与异常路径只在 `WebPreviewScreen.onClose()` 一处（`MOD:webui/WebPreviewScreen.java:337-350`），端口占用、编码器异步回收、重连风暴、重复关闭没有独立验收项。
- 编辑器启用状态被传输组件隐式代表：当前只有 `WebPreviewScreen` 打开/关闭与 `WebEditorServer.isRunning()`（`MOD:webui/WebEditorServer.java:86-95`）能表达「编辑器是否在工作」；没有统一总开关，也没有 `ingame` 模式入口。关闭 webui 传输并不等于关闭整个编辑器，开启游戏也不等于必须启动 WebSocket。
- 资源与端点所有权没有合同：现有代码容易出现「关闭时顺手关掉共享 `CaptureHub`」「把 `flight.exit` 广播给所有会话」这类过度释放/过度广播；两者都会破坏其他消费者或其他编辑器窗口。本轮必须把「只释放本端点拥有资源」写成可验收约束。
- 文本出站没有可靠性等级：`OutboundQueue.enqueueText` 在队列全为文本时会丢最旧文本（`MOD:webui/OutboundQueue.java` 类注释与 `enqueueText`），`WebSocketSession.sendText` 只限频告警（`WebSocketSession.java:106-115`）。命令回执、保存/校验结果与 `flight.exit` 可能被静默丢弃。

### 2.2 目标

- 一条帧协议在两端有同一份字节级定义，非法输入两端都只丢弃不崩溃；RGBA 与 H.264 的负载、PTS、frameId、关键帧标记有明确约束。
- 预览档位与服务端固定值一致：要么删除前端档位选择器、只显示服务端回执的生效值；要么服务端真正支持档位。本轮选择前者（与 2026-11-09 裁决一致），并在 UI 上明确「固定 1080p60」。
- 会话有明确的创建/关闭/重连/多客户端语义：同一时刻多个编辑器窗口互不影响；慢客户端只丢自己的帧。
- 预览生命周期可逐项验收：打开→出帧→暂停→seek 补帧→恢复→切换分辨率（服务端重建编码器）→关屏释放，每一步都有可观察状态。
- 脚本/资源/schema/图数据有明确的路径、ID、缓存与失效规则；前端不自己解析脚本、不自己拼路径。
- 关闭释放幂等：重复关屏、端口占用、编码器启动失败、WebSocket 断开都不留下线程、进程、纹理、token 文件。
- 编辑器启用有统一入口与总开关：`editor` 总开关决定 editor 能力是否可用；`WebEditorServer` 只作为 webui 模式按需启动的传输，`isRunning()` 只表示传输在跑。关闭总开关时两种模式都不建立会话/端点、不注册编辑器按键、不捕获画面；只释放编辑器拥有的资源，不关闭共享 `CaptureHub`，不影响普通脚本播放。
- 为未来14登记明确公共契约与缺口，不要求本轮AUI接口/GPU可运行。迁移实现由14-00落实，不因此阻塞WebUI。

### 2.3 非目标

- 不做远程/跨机传输：仍只绑 `127.0.0.1`，不做 WebRTC、HLS/DASH、远程分片。
- 不新增第二套消息语义：所有消息沿用现有 `{type,data,id}` 与现有消息名；新增只在必要时以「提案」出现。
- 不在本轮修改主模组代码；不把 `api/editor` 合同写成已实现。
- 不在本轮执行 `editor` 包迁移或改名；只冻结目标职责与迁移顺序（03-10），源码事实仍按 `J:webui/` 引用。
- 不修游戏内 Fabric AUI 适配（`shared/host-scope.md`）；不因 AUI 故障缩减 WebUI 的 Fabric 连接目标。
- 不做编辑器业务面板（时间轴/关键帧/图布局归 04–12 轮）；本轮只负责传输与宿主端口。

## 三、方案

从使用者视角：

0. 编辑器是否可用由统一总开关决定，而不是由 WebSocket 是否在监听决定。开关关闭时按 F9 不打开任何编辑器入口、不注册编辑器按键、不启动 8765、不注册捕获消费者；开关开启也只表示「允许使用」，具体模式在用户真正进入时按需建立资源。`webui` 模式用于外部 Electron；`ingame` 模式用于游戏内 AUI，二者共享文档、schema、消息与路由语义，不共享传输对象。
1. 进入 WebUI 模式时（而不是游戏启动时）在 `127.0.0.1:8765` 启动服务，并把本次运行的 token 写到 `<user.home>/.immersivecinematics/webui-token`。`WebEditorServer.isRunning()` 只描述这条传输，不描述整个编辑器。
2. 编辑器启动后读 token（Electron 主进程读文件，经 preload 同步 IPC 交给渲染进程），连 `ws://127.0.0.1:8765/ws?token=...`；Origin 不在白名单或 token 不对直接 403。
3. 连上后编辑器先发 `hello`，再拉 `script.list` / `schema.get`，然后把当前脚本 `editor.pushScript` 推给游戏端并 `editor.seek` 到当前播放头；服务端开始按会话推送 18 字节头的二进制帧。
4. 编辑器预览面板只显示服务端回执的生效尺寸/帧率/编码器状态；`preview.stats` 每秒刷新丢帧计数。画面固定滞后 100ms 按 PTS 播放，PTS 回退或断流 1s 时重建时钟并从关键帧重建解码器。
5. 拖动播放头时前端以 16ms 节流发 `editor.seek`；暂停态服务端做一次补帧刷新（预算 20 帧），保证拖动可见。播放/暂停/停止只发命令，时间与播放状态由 `playback.state` 回推。
6. 飞控由前端发 `editor.enter_flight_mode`（携带选中片段在播放头处的姿态），游戏端逐字段回落；飞控会话归属于发起端点，`flight.exit` 只发给该端点用于写回选中关键帧，不向其他编辑器窗口广播，也不代表其他窗口应写回。该端点关闭时只取消自己拥有的飞控。
7. 关闭当前编辑器入口（F9/ESC 或模式退出）时依次取消本端点拥有的飞控、退出编辑器播放、释放本端点预览资源、按需停止本模式传输、删除 token 文件；不调用 `CaptureHub.close()`，不释放其他端点或普通游戏播放拥有的资源。关闭总开关时对两种模式执行同一套释放并注销编辑器按键，重复关闭幂等。

边界：编辑器不读磁盘、不解析脚本、不定义字段；服务端不保存编辑器状态（撤销栈/布局/草稿都在前端）。画面只来自游戏主画面（含 HUD、lane 合成、调色，不含编辑器 UI）。

## 四、技术细节

### 4.1 核心模型

| 对象 | 归属 | 职责 | 现状锚点 |
|---|---|---|---|
| 帧协议 | 两端共享 | 18B 大端头 + payload；type 1=RGBA8、2=H.264 Annex B AU | `MOD:webui/PreviewProtocol.java:31-40`；`ED:lib/previewProtocol.ts:15-18` |
| 会话 | 服务端 | 单连接读写、每会话有界出站队列、单发送线程 | `MOD:webui/WebSocketSession.java:23-171`、`OutboundQueue.java:25-110` |
| 握手 | 服务端 | Origin 白名单 + 启动期随机 token（常量时间比对） | `MOD:webui/WebEditorServer.java:100-211` |
| 消息路由 | 服务端 | `{type,data,id}` 分发、回执、错误 | `MOD:webui/WebEditorApi.java:31-93` |
| 预览流 | 服务端 | 捕获→每会话编码/RGBA 回退→入队；暂停/恢复/补帧/统计 | `MOD:webui/PreviewStreamer.java:30-542` |
| 编码器 | 服务端 | 每会话一个 ffmpeg 进程；失败只影响本会话 | `MOD:webui/PreviewEncoder.java:42-454` |
| 捕获 | 服务端 | 主 RenderTarget → 固定规格 FBO → PBO 三缓冲 → 消费者 | `MOD:media/capture/CaptureHub.java:41-541` |
| 前端消费 | 编辑器 | 解析、PTS 归一化、抖动缓冲、WebCodecs 解码、绘制 | `ED:components/Preview.vue:15-343` |
| 连接与请求 | 编辑器 | token、重连、请求/回执、推送路由 | `ED:store.ts:20-343` |
| 脚本/资源服务 | 服务端 | 脚本 CRUD、资源列举、注册表、图数据、schema | `MOD:webui/ScriptFileService.java:20-94`、`ResourceFileService.java:34-195`、`WebRegistryService.java:22-119`、`ScriptGraphService.java:31-394`、`script/schema/SchemaExporter.java` |

### 4.2 契约

- **创建**：F9 → `WebPreviewScreen.init()` 启动服务端并注册 `PreviewStreamer` 为 `CaptureHub.Consumer`（`MOD:webui/WebPreviewScreen.java:56-70`）；WebSocket 升级成功 → `PreviewStreamer.onSessionOpened`（`MOD:webui/WebEditorServer.java:334-357`）。
- **销毁**：关屏 → `onClose()` 依次 `FlightModeManager.cancel()`、`CameraManager.exitPreview()`、`PreviewStreamer.close()`、`WebEditorServer.stop()`、`notifyEditorClosed()`（`MOD:webui/WebPreviewScreen.java:337-350`）；会话断开 → `removeSession` → `PreviewStreamer.onSessionClosed`（`MOD:webui/WebEditorServer.java:359-363`）。
- **背压**：会话出站队列容量 16，满时丢最旧帧（`OutboundQueue.java:28,45-75`）；编码器输入队列容量 1，满时丢最旧（`PreviewEncoder.java:205-228`）；捕获池 6 个缓冲，池空丢帧计数（`CaptureHub.java:50,263-312`）。**帧可以丢旧，文本按可靠性分级**：`playback.state`/`flight.state`/`preview.stats` 是可合并状态，允许丢旧；命令回执（`*.result`/`editor.ack`）、`script.saved`/`script.validate.result`、`flight.exit` 属于关键文本，必须可靠入队，无法入队时以明确断开或明确错误告知，不得静默丢弃后假装成功（03-05/03-08）。
- **所有权**：一帧捕获数据的引用归消费者；`CaptureHub.deliver` 对每个消费者 `retain` 一次并在回调后 `release`（`MOD:media/capture/CaptureHub.java:358-398`）。编码器 `submit` 接管一份引用（`PreviewEncoder.java:205-228`）。编辑器关闭只注销自己的消费者/端点并释放自己的编码器、队列与租约；**不调用 `CaptureHub.close()`**，不删除共享 FBO/纹理；飞控会话归发起端点所有，`flight.exit` 只回该端点。
- **PTS**：RGBA 以会话首帧为 0（`PreviewStreamer.java:374-388`）；H.264 以编码器首帧为 0，跨编码器重建加会话级偏移并强制单调（`PreviewStreamer.java:390-443,455-476`）。前端把 PTS 映射到本地时钟，回退 >1ms 或断流 >1s 视为新 epoch（`ED:components/Preview.vue:19-21,55-68`）。
- **固定值**：预览 1920×1080@60、2s 关键帧、允许编码（`MOD:webui/PreviewConfig.java:5-20`）；`editor.previewConfig` 请求字段忽略、回执固定值（`WebEditorApi.java:299-311`）。
- **线程**：文本消息在 Minecraft 主线程执行（`WebSocketSession.java:56-84`）；二进制帧由每会话 `IC-WSSender` 线程写出；编码器有 stdin/stdout/stderr 三线程；编码器关闭走常驻 `IC-PreviewEnc-closer`（`PreviewStreamer.java:52-62,261-271`）。

### 4.3 数据形态

帧头（18B，大端）：

| 偏移 | 大小 | 字段 | 约束 |
|---|---|---|---|
| 0 | 1 | type | 1=RGBA8，2=H.264 Annex B；其它 → 丢弃 |
| 1 | 1 | flags | bit0=关键帧；其余位保留 |
| 2 | 4 | frameId | u32，捕获层自 0 递增，编码输出原样配对 |
| 6 | 8 | ptsMicros | u64，相对该会话/编码器首帧，单调 |
| 14 | 2 | width | u16，>0；RGBA 必须与 payload 匹配 |
| 16 | 2 | height | u16，>0 |
| 18 | … | payload | RGBA=`w*h*4`（自顶向下）；H.264=一个完整 AU |

文本信封：`{"type":string,"data":object,"id":string?}`；请求带 `id` 时回执同 `id`；事件推送无 `id`。

### 4.4 边界

- 编辑器不解析脚本、不读文件、不定义字段；服务端不保存编辑器状态。
- 预览与游戏内播放是两个实例，互不挤占（`MOD:camera/PreviewChannel.java:22-228`）。
- 画面源是主画面（`CaptureHub` 挂点在 `Gui.render` 之后，`MOD:mixin/GameRendererMixin.java:147-157`），不含 Screen UI；因此编辑器自己的 UI 不会进入预览。
- 03-08的ingame公共接口仅未来设计；真正实现、附属模组可访问性与GPU验收归14，不设为01–13前置。

### 4.5 editor 包归属、总开关与按需生命周期

本节只冻结跨宿主的管理边界；包职责细节以 [../shared/editor-package-modes.md](../shared/editor-package-modes.md) 为准，实施任务见 [03-10-editor-package-lifecycle.md](03-10-editor-package-lifecycle.md)。

| 边界 | 合同 |
|---|---|
| 统一入口 | `editor` 包（目标名；当前为 `J:webui/`）持有唯一启用状态、模式能力与打开/关闭；`WebEditorServer`/`WebPreviewScreen` 只是 `editor.webui` 的传输与外部宿主屏，不是编辑器总状态 |
| `webui` 模式 | 进入外部预览屏时按需启动 `127.0.0.1:8765`、token、`PreviewStreamer` 与捕获消费者；退出该模式时只释放这些资源。WebUI 对接 Forge/Fabric 均正常建设，不受 AUI 影响 |
| `ingame` 模式 | 打开 `EditorAuiScreen` 时按需 attach 进程内端点、订阅 `EditorFrameSource`、注册本模式按键；关闭 Screen 时逆序释放。AUI 只属于附属模组，主模组专用服务端不加载 AUI 类 |
| 总开关 | 关闭时两模式均不可用：不注册编辑器专用按键/入口、不启动 8765、不注册捕获消费者、不建立进程内端点/租约；已有时会话语义为退出。总开关**不**关闭 `CaptureHub`、不停止普通脚本播放、不注销非编辑器资源 |
| 启用判定 | 只能读统一入口的 `isEnabled()`（03-08 `EditorHostApi`，落地前为提案）；**禁止**用 `WebEditorServer.isRunning()` 或某个 Screen 是否存在代表整个编辑器启用 |
| 模式能力 | 总开关开启不等于两模式都可用；能力（`preview.webui`/`preview.gpu`/`flight`/`ingame.input` 等）由 `hello_ack.capabilities` 按实际实现报告，不能把所有位填满 |
| 端点所有权 | 每条连接/进程内 Screen 是一个端点；端点只释放自己的编码器、队列、租约、订阅与飞控会话。服务端停止只由宿主级 teardown 或总开关关闭触发，单个端点 detach 不停止其他会话 |
| 关闭幂等 | 宿主级 teardown 与端点 detach 都可重复调用；第二次不停止其他端点、不关闭 `CaptureHub`、不停普通游戏播放 |

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 继续用原始 RGBA 单帧流 | 不做 H.264 | 1080p60 约 500MB/s，本机也吃不消；无 PTS 无法抖动缓冲 | 现有 H.264 + PTS + 每会话背压已落地，保留 |
| 前端自适应降档 | 按丢帧率自动切 720p/30fps | 观感突变、作者误判；服务端固定值语义被破坏 | 2026-11-09 裁决：只丢帧计数，档位由编辑器显式配置；本轮进一步收为「固定 1080p60 + 只读显示」 |
| 让 13 直接调 `WebEditorApi.handle` / `PreviewStreamer.onSessionOpened` | 复用现有 public 方法 | 参数类型包私有，且语义是 WebSocket 会话；进程内宿主会被迫访问内部类 | 先补 `api/editor` 合同（`EditorEndpoint`/`EditorPush`/`EditorFrameSource`/`EditorFlightControl`），再让两宿主实现 |
| 把预览帧改成 JSON/base64 | 简化前端 | 体积与解析成本暴涨 | 二进制帧 + 18B 头是最小可行形态 |
| 用第三方 WebSocket 库 | 现成握手/帧 | 多依赖与打包成本；需求只有文本帧、二进制帧、单机连接 | 现有自实现够用（`WebEditorServer` 无第三方库） |
| 只把 `webui` 目录改名，仍以 WebSocket 为编辑器中心 | 机械改名 | ingame 宿主仍被迫依赖 socket/编码器；总开关仍由服务端是否运行代表 | 统一 `editor` 包内分 `webui`/`ingame` 两模式，共享文档/路由，传输各自按需建立 |
| 用 `WebEditorServer.isRunning()` 当编辑器启用状态 | 复用现有单例 | 关闭 webui 传输会误判整个编辑器关闭；游戏启动会被迫启动服务 | 统一入口 `isEnabled()` 与模式能力分离，服务只在消费时启动 |

**本方案的缺点**：

- 固定 1080p60 对低端机/无 ffmpeg 环境不友好：无 ffmpeg 时 RGBA 回退带宽高，只能靠丢帧。
- 前端 `VideoDecoder` 依赖 Electron/Chromium 的 WebCodecs；极老环境只能等 RGBA 回退。
- 18B 头没有版本字段/能力协商；未来改协议只能靠「两侧同步发版」，无法灰度。
- 资源列举的扩展名白名单与运行时媒体能力仍会漂移，需要后续轮次持续对账。

## 六、实现结果

状态：未实现（仅计划）。现有 WebUI 服务端与前端是**既有实现**，不是本轮交付；本轮把现状、错配、缺口与验收拆到任务文件，未修改任何代码，未运行 Gradle/npm/游戏，未做真实冒烟。

| 原设计 | 实际实现 | 偏离原因 |
|---|---|---|
| 预览分辨率/帧率可配 | 服务端固定 1080p60（`PreviewConfig.fixed`），前端仍有档位选择器 | 2026-11-09 裁决收为固定值；前端未同步删除，本轮任务 03-04 处理 |
| 共享语义与未来迁移 | 当前路由绑定WebSocketSession | 03抽取WebUI所需共享边界；14在WebUI完成后实现进程内适配，不同步验收 |
| 资源列举覆盖运行时媒体 | 仅 PNG/GIF、OGG/WAV | 运行时媒体扩展未回写到 `ResourceFileService`；本轮任务 03-06 列为缺口 |

## 任务索引

| 文件 | 职责 | 关键缺口 |
|---|---|---|
| [03-01-preview-wire-format.md](03-01-preview-wire-format.md) | 18B 帧头与 RGBA/H.264 负载的两端编解码 | 无版本/能力位；前端 RGBA 允许 payload 大于 `w*h*4`（`parsePreviewFrame` 只判 `<`） |
| [03-02-websocket-session-handshake.md](03-02-websocket-session-handshake.md) | 握手（Origin/token）、会话表、多客户端、重连 | `WebSocketSession` 包私有；重连代际未隔离；多客户端推送语义未定义 |
| [03-03-preview-streamer-lifecycle.md](03-03-preview-streamer-lifecycle.md) | 捕获→编码→入队、暂停/恢复/补帧、编码器回收、统计 | 固定值 vs 前端档位；无 `EditorFrameSource`；编码器关闭异步不可观测 |
| [03-04-frame-consumer.md](03-04-frame-consumer.md) | 前端解析、PTS 归一化、抖动缓冲、WebCodecs、RGBA、关闭 | 档位 UI 错配；H.264 profile/level 硬编码；无解码器能力探测 |
| [03-05-message-router.md](03-05-message-router.md) | `WebEditorApi` 消息族、请求/回执/推送、节流、错误 | 与 `WebSocketSession` 绑死；推送目标无抽象；无 schema 版本/能力位 |
| [03-06-script-resource-registry.md](03-06-script-resource-registry.md) | 脚本 CRUD、资源列举、注册表、图数据、schema | 资源扩展名白名单；无缓存/失效；路径 ID 规则未文档化 |
| [03-07-host-teardown.md](03-07-host-teardown.md) | 关屏顺序、幂等、异常路径、线程/进程/token 释放 | 端口占用无回执；重复关闭；编码器异步回收；重连风暴 |
| [03-08-editor-host-contract.md](03-08-editor-host-contract.md) | `api/editor` 稳定合同（提案）与 Forge 垂直切片定义 | 当前无 `api/editor`；`WebSocketSession` 包私有；`WebPreviewScreen` 静态飞控入口 |
| [14-00-public-api-prerequisite.md](../14-aui-forge-migration/14-00-public-api-prerequisite.md) | 未来进程内信号/GPU/飞控实现任务 | 明确归14，13 WebUI通过后执行，不计03完成门槛 |
| [03-10-editor-package-lifecycle.md](03-10-editor-package-lifecycle.md) | `editor` 统一包职责、总开关、webui/ingame 双模式按需生命周期与端点所有权 | 当前包名仍是 `webui`；无总开关；`EditorHostApi` 未实现 |

## 本轮出口

- 实施时03-01～03-07、03-10的行为与错误验收必须真实通过，不是仅写出步骤；本次文档编写仍统一标未执行。
- 03-08只约定未来ingame边界，14-00才落实进程内公共能力；没有AUI代码不阻塞03或其他WebUI轮，不允许假实现。
- `editor` 统一入口与总开关落地：总开关关闭不注册编辑器按键/入口、不启动 8765、不建立会话/租约；`WebEditorServer.isRunning()` 不再被当作整个编辑器启用状态。包迁移按 03-10 顺序，旧 `webui/` 与全部调用方干净切换，不留兼容垫片。
- 端点所有权按 03-05/03-08/03-10 执行：单端点关闭只释放自己拥有的编码器/队列/租约/飞控；不关闭共享 `CaptureHub`；`flight.exit` 只回发起端点；命令回执可靠或明确断开/失败，帧可丢旧。
- 前端预览档位与服务端固定值一致（UI 只读显示 1080p60），或明确记录「服务端支持档位」的裁决与实现；本轮按前者。
- 03当轮真实验证WebUI外部链路，01–12各轮WebUI冒烟，13全量打磨收口；14再迁移AUI，不在本轮要求游戏内界面/纹理/输入通过。
- 无本轮遗留：Fabric 主模组通路保留为独立验收路径，不因游戏内 AUI 暂停而关闭；游戏内 Fabric+AUI 不在本轮。
