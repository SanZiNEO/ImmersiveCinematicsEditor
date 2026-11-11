# 03-08 编辑器宿主稳定接口合同（提案）与 Forge 垂直切片

> 状态：未实现（仅计划；`api/editor` 当前不存在，以下均为提案）
> 轮次：03-host-transport
> 关联：03-05/07/10、shared/editor-package-modes；未来实现见[14-00](../14-aui-forge-migration/14-00-public-api-prerequisite.md)，WebUI完整验收见[13](../13-webui-acceptance-release/README.md)。

## 1. 职责

本文件区分现有实现与未来稳定ingame合同。03只落实当前WebUI所需共享边界、总开关和外部链路；下文进程内接口/GPU/附属模组编译等均为14迁移设计，不要求01–13提前实现。真实迁移实现归13验收通过后的14-00，不能空实现充数。

## 2. 现有事实：当前实际可调用面 vs 不可调用面

### 2.1 可直接调用（`public` 且参数/返回类型可访问）

| 类型/方法 | 锚点 | 可用性 | 说明 |
|---|---|---|---|
| `WebEditorServer.INSTANCE` | `MOD:webui/WebEditorServer.java:73` | ✅ | 单例 |
| `isRunning()` / `hasClients()` | `WebEditorServer.java:86-95` | ✅ | 只读 |
| `start()` / `stop()` | `WebEditorServer.java:100-145` | ✅ | 启停；`start()` 失败返回 false |
| `sessions()` | `WebEditorServer.java:365-368` | ⚠️ | 返回 `List<WebSocketSession>`，元素类型包私有，包外只能当 `List<?>` 用 |
| `broadcastText(String)` | `WebEditorServer.java:370-374` | ✅ | 只能广播，不能定向 |
| `PreviewStreamer.INSTANCE` | `MOD:webui/PreviewStreamer.java:30-33` | ✅ | 单例 |
| `needsFrame/onFrame/captureSpec/onCaptureFormatChanged` | `PreviewStreamer.java:99-123` | ✅ | `CaptureHub.Consumer` 接口方法 |
| `requestFrame()` / `setPaused()` / `config()` / `tick()` / `close()` | `PreviewStreamer.java:131-271` | ✅ | 但 `tick` 需要 `Minecraft`，`close` 会注销捕获 |
| `onSessionOpened/onSessionClosed` | `PreviewStreamer.java:78-96` | ❌ | 参数 `WebSocketSession` 包私有，包外无法调用 |
| `CaptureHub.INSTANCE` | `MOD:media/capture/CaptureHub.java:41-44` | ✅ | 单例 |
| `register/unregister` | `CaptureHub.java:145-160` | ✅ | 消费者注册 |
| `Consumer` 接口 | `CaptureHub.java:74-101` | ✅ | 可自行实现 |
| `onHudRendered` | `CaptureHub.java:163-224` | ✅ | 但应由挂点调用，编辑器不应主动调 |
| `width/height/fps/droppedFrames` | `CaptureHub.java:226-244` | ✅ | 只读诊断 |
| `close()` | `CaptureHub.java:246-261` | ⛔ | **宿主级生命周期，不属于消费者合同**；编辑器关闭不得调用（会清池、清消费者、删 FBO/PBO，误杀其他消费者） |
| 捕获纹理/FBO | `CaptureHub.java` 私有字段 `fboId/texId`（463-506） | ❌ | **无 getter**；无法 GPU 直连 |
| `CapturedFrame` | `MOD:media/capture/CapturedFrame.java:19-113` | ✅ | `rgba/width/height/ptsNanos/frameId/retain/release` |
| `CameraManager.INSTANCE` | `MOD:camera/CameraManager.java:38` | ✅ | 实现 `CameraApi`/`PlaybackApi` |
| `pushScript/setTime/resume/pause/stop/exitPreview` | `CameraManager.java:181-188` | ✅ | 编辑器播放控制 |
| `setPreviewDirectControl/isPreviewDirectControl` | `CameraManager.java:189-191` | ✅ | 直控标志 |
| `isEditorPlayback/isEditorPaused/getPreviewTimeSeconds` | `CameraManager.java:193-200` | ✅ | 状态 |
| `setCameraDirect` | `CameraManager.java:303-316` | ✅ | 直控写侧 |
| `PreviewChannel` | `MOD:camera/PreviewChannel.java:22` | ❌ | 包私有类；不能作为编辑器入口 |
| `FlightModeManager.INSTANCE` | `MOD:control/FlightModeManager.java:15-18` | ✅ | 飞控核心 |
| `enter/exit/cancel/tick/onKeyEvent/onMouseMove/resetOptics/isActive/getState` | `FlightModeManager.java:43-123` | ✅ | 与界面解耦 |
| `WebPreviewScreen.enterFlightMode` | `MOD:webui/WebPreviewScreen.java:161-198` | ⚠️ | `public static`，但语义是「当前预览屏」；进程内宿主可调用但会绑定到 WebPreviewScreen 的相机回落逻辑 |
| `WebPreviewScreen.requestFlightExit` | `WebPreviewScreen.java:200-210` | ❌ | 依赖 `activeScreen`；无 WebPreviewScreen 时直接 return |
| `WebEditorApi.handle` | `MOD:webui/WebEditorApi.java:31` | ❌ | 参数 `WebSocketSession` 包私有 |
| `WebEditorApi.pushPlaybackState` | `WebEditorApi.java:313-323` | ⚠️ | `public static`，但内部 `WebEditorServer.INSTANCE.broadcastText`，只能服务 WebSocket |
| `api/` 包 | `MOD:api/*.java` | ✅ | `CameraApi`、`PlaybackApi`、`ImmersiveCinematicsApi`、`OverlayApi`、`ServerFactsApi` 等；**无编辑器相关类型** |
| 编辑器开关 | `MOD:Config.java`（grep 无 `editor` 命中） | ❌ | 0.3.6 已删除 `editorEnabled`；Z README §8.2 要求的新开关未实现 |

**结论**：现有 `public` 关键字不等于稳定编辑器合同。真正可复用的只有「单例 + 无参/值对象参数」的方法；凡是参数含 `WebSocketSession`、返回含该类型、或依赖 `WebPreviewScreen.activeScreen` 的入口，都不能作为 13 轮的最终实现。

### 2.2 消息与推送的硬绑定

| 路径 | 锚点 | 绑定 |
|---|---|---|
| 请求/回执 | `WebEditorApi.java:31-93` | `WebSocketSession`（`sendText`/`sendError`/`wrap`） |
| 播放状态推送 | `WebEditorApi.java:313-323` | `WebEditorServer.INSTANCE.broadcastText` |
| 预览统计推送 | `PreviewStreamer.java:207-259` | `SessionStream.session.sendText` |
| 飞控状态/退出推送 | `WebPreviewScreen.java:279-324` | `WebEditorServer.INSTANCE.broadcastText` |
| 飞控退出入口 | `WebEditorApi.java:86-87` | `WebPreviewScreen.requestFlightExit` |

## 3. 稳定接口提案（`api/editor`）

> 全部为**提案**，当前不存在。落地后只增不删；内部实现可换，签名不变。

### 3.1 `EditorEndpoint`（替代 `WebSocketSession` 的发送面）

```java
package com.immersivecinematics.immersive_cinematics.api.editor;

public interface EditorEndpoint {
    /** 诊断 id：WebSocket 会话 id 或进程内宿主 id；非空、稳定到连接结束。 */
    String endpointId();

    /** 发送一条可合并状态（playback.state/flight.state/preview.stats）；非阻塞，可丢旧。 */
    void sendState(String json);

    /** 发送一条关键文本（回执/错误/flight.exit）；可靠入队，失败返回 false。 */
    boolean sendCritical(String json);

    /** 是否仍可发送。 */
    boolean isOpen();
}
```

约束：
- 只暴露「发文本」；不暴露 socket、线程、队列。
- `sendState` 可丢旧；`sendCritical` 用于命令回执、保存/校验结果与 `flight.exit`，必须可靠入队或返回失败，调用方据此关闭端点并让客户端明确失败，不能静默丢弃后假成功。
- `WebSocketSession` 改为实现该接口（包内），`WebEditorApi.handle(String, EditorEndpoint)`。
- 端点关闭只释放自己的资源；不得触发 `CaptureHub.close()`、停止其他端点或取消他人飞控。

### 3.2 `EditorPush`（替代直接 `broadcastText`/`session.sendText`）

```java
public interface EditorPush {
    void broadcast(String json);                       // 可合并状态
    boolean send(String endpointId, String json);      // 关键文本定向；失败返回 false
    java.util.List<String> endpoints();
}
```

约束：
- `broadcast` 只用于 `playback.state`/`flight.state` 等可合并状态；`preview.stats` 与 `flight.exit` 必须 `send` 到所属端点。
- **`flight.exit` 绝不广播**：它携带最终姿态并在发起窗口触发关键帧写回；广播会让其他窗口误写回。
- `send` 失败时调用方必须让发起请求明确失败（错误回执或关闭端点），不能假装成功。
- 实现由宿主提供：WebSocket 宿主用 `WebEditorServer.sessions()`；进程内宿主用自己的端点表。
- 不在接口里暴露会话对象。

### 3.3 `EditorSessionApi`（挂载/卸载 + 命令路由）

```java
public interface EditorSessionApi {
    void attach(EditorEndpoint endpoint);
    void detach(EditorEndpoint endpoint);
    /** 处理一条文本消息；实现内部切主线程。 */
    void handle(String message, EditorEndpoint endpoint);
}
```

约束：
- `attach/detach` 幂等；`detach` 只释放该端点的预览资源（编码器/队列/租约订阅）与飞控所有权（若它是 owner），**不**停止服务端、**不**关闭其他端点、**不**调用 `CaptureHub.close()`。
- `handle` 的语义与现有 `WebEditorApi.handle` 完全一致（消息名/字段不变）；进程内宿主直接调 `handle`，不经过 WebSocket。

### 3.4 `EditorFrameSource`（同进程 GPU 画面）

EditorFrameSource是未来14的GPU公共租约提案：包含纹理/尺寸/generation/帧时刻/翻转/alpha，并有真实幂等release。落实见[14.00](../14-aui-forge-migration/14-00-public-api-prerequisite.md)，当前WebUI不因未实现而阻塞。

约束：
- `textureId` 是 GL 颜色附件纹理；`generation` 每次 FBO/纹理重建递增；租约只在 `generation` 有效期内可用。
- `flipY`：GL 纹理原点在左下，AUI/Canvas 期望左上；由消费者决定是否翻转。
- `opaqueAlpha`：CaptureHub 已强制 alpha=1；消费者可据此跳过 alpha 混合。
- 不暴露 `CaptureHub`、`RenderTarget`、`FboHandle` 等内部类型。
- 实现（提案）：`CaptureHub` 内部维护一个「GPU 消费者」列表，`onHudRendered` 在 blit 后直接回调，不读回 CPU；`acquire()` 返回当前 FBO 纹理与元数据。
- **未实现**：`CaptureHub` 当前只有 CPU 读回（`captureFrame` 263-312），无纹理 getter；`J-media/capture.md` §七与 `I-BACKLOG.md` J4-O4 已列为待做。

### 3.5 `EditorPlaybackControl`（播放控制）

```java
public interface EditorPlaybackControl {
    void pushScript(String json);
    void seek(double seconds);
    void play();
    void pause();
    void stop();
    void setCamera(float yaw, float pitch, float roll, float fov, float zoom);
    double timeSeconds();
    boolean isPlaying();
}
```

约束：
- 语义与 `CameraManager` 的编辑器播放方法一致（`CameraManager.java:181-200`）。
- 实现可以是 `CameraManager` 适配器；不得让编辑器直接依赖 `PreviewChannel`（包私有）。
- `timeSeconds()` 返回编辑器播放头；未激活时回落游戏时钟（与 `getPreviewTimeSeconds` 一致）。

### 3.6 `EditorFlightControl`（飞控）

```java
public interface EditorFlightControl {
    /** 只允许一个 owner；重复/冲突进入返回 false 并给出原因。 */
    boolean enter(String endpointId,
                  Double x, Double y, Double z,
                  Float yaw, Float pitch, Float roll, Float fov, Float zoom,
                  boolean absolute);
    /** 只有当前 owner 可退出；非 owner 调用返回 false，不改飞控状态。 */
    boolean exit(String endpointId, boolean record);
    boolean isActive();
    String ownerEndpointId();   // 无 owner 时返回 null
    FlightState state();

    record FlightState(double x, double y, double z,
                       float yaw, float pitch, float roll, float fov, float zoom,
                       boolean absolute) {}
}
```

约束：
- `enter` 的逐字段回落逻辑与 `WebPreviewScreen.enterFlightMode` 一致（`WebPreviewScreen.java:161-198`），但不依赖 `activeScreen`；飞控会话绑定发起端点，**同一时刻只有一个 owner**。
- `exit(record)` 语义与 `requestFlightExit` 一致（`WebPreviewScreen.java:200-210`）：`record=true` 走 `FlightModeManager.exit()` 并向 owner 发送 `flight.exit{cancelled:false}`；`false` 走 `cancel()` 并向 owner 发送 `cancelled:true`。**只发 owner，不广播**。
- 非 owner 端点关闭不得取消飞控；owner 端点 detach/关闭时由宿主取消飞控并恢复进入前状态，且不向其他端点发送写回结果。
- 实现由宿主提供；WebSocket 宿主内部转调 `FlightModeManager` 与回落逻辑，进程内宿主直接调 `FlightModeManager`，都不再依赖 `WebPreviewScreen.activeScreen`。

### 3.7 `EditorHostApi`（总门面 + 开关）

```java
public interface EditorHostApi {
    /** 统一总开关；不得用 WebEditorServer.isRunning() 代替。 */
    boolean isEnabled();

    /** 当前可用模式：webui / ingame；开关关闭时为空集。 */
    java.util.Set<EditorMode> modes();

    EditorSessionApi sessions();
    EditorPush push();
    EditorFrameSource frames();          // 仅 ingame 且真实可用时非 null/可用
    EditorPlaybackControl playback();
    EditorFlightControl flight();
    String schemaHash();
    java.util.Set<String> capabilities();
}
```

约束：
- `isEnabled()` 对应 Z README §8.2 的「编辑器开关」；当前 `Config` 无此键，需新增（提案）。总开关关闭时：不注册编辑器按键/入口、不启动 8765、不注册捕获消费者、不 attach 进程内端点；`WebEditorServer` 是否运行不参与判定。
- 总开关开启不等于两种模式都启动；`modes()` 表示「本环境允许使用哪些模式」，具体资源在进入该模式时按需建立（03-10）。
- 专用服务端不加载 AUI/客户端编辑器类；`ingame` 模式只在客户端且 AUI 附属模组存在时报告可用。
- capabilities 只报告实际已实现且可调用的能力；`preview.gpu`、`resource.video` 等前置未完成时不可提前宣告。已有 WebUI RGBA/H264 能力按实测与真实环境报告，不能一律填满列表。
- 取得方式：`EditorHostApi.get()`（提案）或由加载器注入；不在 `api` 包外暴露实现类。
- `EditorMode`（提案）为 `enum EditorMode { WEBUI, INGAME }`；不新增第三种模式。

## 4. API 缺口清单（必须由主模组前置合同闭合）

| # | 缺口 | 证据 | 影响 | 前置合同 |
|---|---|---|---|---|
| G1 | 无 `api/editor` 包 | `MOD:api/` 目录无 editor 类型 | 13 轮无法在不访问内部类的前提下接信号 | 新增 3.1–3.7 接口；`WebEditorApi.handle` 改签名；`WebSocketSession implements EditorEndpoint` |
| G2 | `WebSocketSession` 包私有 | `WebSocketSession.java:23` | `handle`/`onSessionOpened` 包外不可调用 | 由 G1 的 `EditorEndpoint` 替代；`PreviewStreamer` 的会话参数改为 `EditorEndpoint` 或内部 key |
| G3 | 无推送抽象 | `WebEditorApi.java:313-323`、`PreviewStreamer.java:207-259`、`WebPreviewScreen.java:318-324` | 进程内宿主无法复用推送 | `EditorPush` + 宿主注入 |
| G4 | 无 GPU 帧源 | `CaptureHub.java` 无纹理 getter；`capture.md` §七标未实现 | 进程内画面只能 CPU 读回，违背 C06 | `EditorFrameSource` + `CaptureHub` GPU 消费者（J4-O4） |
| G5 | 飞控退出依赖 `WebPreviewScreen` | `WebEditorApi.java:86-87`、`WebPreviewScreen.java:200-210` | 进程内宿主无退出入口 | `EditorFlightControl`；`WebEditorApi` 改调它 |
| G6 | 编辑器开关不存在 | `Config.java` 无 `editor`；Z README §8.2 | 无法按开关禁用编辑器能力 | `Config` 新增客户端键 + `EditorHostApi.isEnabled()` |
| G7 | `hello_ack` 无 schema/能力 | `WebEditorApi.java:95-100` | 前端/进程内宿主无法判断能力 | `schemaHash` + `capabilities` |
| G8 | `editor.*` 无 ack | `WebEditorApi.java:53-88` | seek/play 失败不可区分 | `editor.ack{op,ok,reason?}` |
| G9 | `PreviewConfig` 固定值与前端档位不一致 | `PreviewConfig.java:5-20`、`Preview.vue:357-364` | UI 误导 | 前端只读显示（03-03/03-04） |
| G10 | `preview.stats` 无 `captured` | `PreviewStreamer.java:207-259` | 无法区分配置/实测 | 增加 `captured`/`frameId` |
| G11 | 资源 `kind=video` 缺失 | `ResourceFileService.java:44-46` | 视频素材不可选 | 扩展 kind 与扩展名 |
| G12 | 无 `scriptRoot` 诊断 | `ScriptFileService.java:22` | 多实例/多存档排障困难 | `hello_ack.scriptRoot` |
| G13 | 关键文本可被静默丢弃 | `OutboundQueue.java` `enqueueText`；`WebSocketSession.java:106-115` | 回执/错误/`flight.exit` 丢失后请求超时或误判成功 | `EditorEndpoint.sendCritical` + 队列分级；失败即关闭端点 |
| G14 | 飞控无 owner、`flight.exit` 广播 | `WebPreviewScreen.java:279-324`、`WebEditorApi.java:86-87` | 多窗口时非发起窗口误写回关键帧；关闭一个窗口可能取消他人飞控 | `EditorFlightControl.enter/exit(endpointId,...)`；`EditorPush.send(owner,...)` |
| G15 | 无端点级 detach 所有权 | `PreviewStreamer.onSessionClosed` 只按 session；无 `EditorSessionApi` | 关闭一个端点可能被实现成停服务/关共享捕获 | `EditorSessionApi.detach` 合同；`CaptureHub.close()` 不属于消费者 API |
| G16 | 总开关不区分模式 | `Config` 无 editor；`WebEditorServer.isRunning()` 被当作启用 | 关闭 webui 传输被误当关闭整个编辑器；ingame 无总控 | `EditorHostApi.isEnabled()/modes()`；03-10 生命周期 |

## 5. Forge 1.20.1 垂直切片（03 侧定义）

### 5.1 目标

先在Forge主模组验证Electron WebUI完整外部链路，13打磨全量通过后作为14迁移基线；这里不包含AUI或游戏内编辑器实现。

### 5.2 前置

- 主模组 `gradle.properties`：`minecraft_version=1.20.1`、`forge_version=47.4.16`（`MOD:gradle.properties:6-14`）。
- Forge dev run 可启动（`MOD:forge/build.gradle` 的 client run）。
- `<gameDir>/ffmpeg/ffmpeg.exe` 存在（`PreviewEncoder` 只从该路径解析；`J-media/preview-stream.md` §4.4）。
- 编辑器仓库 `webui` 分支可 `npm run electron:dev`（`ED:package.json`）。
- token 文件路径一致（`EDE:main.cjs:8-20` 与 `WebEditorServer.java:147-153`）。

### 5.3 步骤与观察点

| 步 | 操作 | 观察点 | 通过标准 |
|---|---|---|---|
| 0 | 总开关关闭启动 Forge dev run，进入世界 | 无编辑器键生效；8765 未监听；日志无 `IC-WebUI` 服务启动 | 普通脚本可播放 |
| 1 | 打开总开关；Forge dev run 保持可玩 | 日志无 `[IC-WebUI] failed to start server`（此时尚未进入 webui 模式，服务不应因开关开启而自动启动） | 开关开启不等于服务启动 |
| 2 | F9 进入 WebUI 预览 | 聊天提示；`<user.home>/.immersivecinematics/webui-token` 存在；服务监听 8765 | 服务按需启动 |
| 3 | Electron 启动 | `hello_ack{version,schemaHash,capabilities}`；`script.list.result`；`schema.data` | 状态栏 connected；能力位与实际一致 |
| 4 | 打开一个脚本 | `script.loaded`；`editor.pushScript`；`editor.seek`；`editor.ack` | 时间轴显示 doc；画面出现；ack ok |
| 5 | 播放/暂停/停止 | `playback.state{time,playing}` 50ms；对应 `editor.ack` | 时间头与游戏一致 |
| 6 | 拖动播放头 | 补帧；画面更新 | 每次拖动都有新画面 |
| 7 | 编辑一个字段 | 160ms 防抖 `editor.pushScript`；画面更新 | 编辑即预览 |
| 8 | 进入飞控（选中 CAMERA 片段） | `flight.state` 100ms；`editor.ack{op:"enter_flight_mode",ok:true}`；游戏内 HUD | 姿态可控；owner 为该端点 |
| 9 | 退出飞控（保存/取消） | **仅发起端点**收到 `flight.exit{...}`；关键帧写回/恢复 | 值正确；另一个窗口无写回 |
| 10 | 保存脚本 | `script.saved`；服务端日志 `C2SScriptSavedPacket` | 文件落盘 |
| 11 | 第二个 Electron 窗口同时连接 | 两个端点各自 `preview.stats`；关闭 B | A 继续出帧；`CaptureHub` 未被关闭；B 的 `flight.exit` 不发给 A |
| 12 | F9 关闭 WebUI 模式 | 服务停止、token 删除、无 ffmpeg/WS 线程；`CaptureHub` 仍存在 | 可再次 F9；普通脚本可播放 |
| 13 | 关闭总开关 | 编辑器键不触发、服务不再启动；ingame 模式也不可用 | 重复关闭无异常 |

### 5.4 失败判定

- 任一步骤无回执/无画面/无状态推送 → 该步失败，不得用「代码已写」替代。
- 无 ffmpeg 时允许 `encoder=rgba`，但必须仍有画面；若 RGBA 也无画面 → 失败。
- 端口占用时不得显示 connected。
- 关闭一个端点导致另一个端点断流、`CaptureHub` 被关闭或非 owner 收到 `flight.exit` → 失败。
- 总开关关闭后仍能启动服务/打开编辑器 → 失败。

### 5.5 本轮状态

本次未执行；未来03当轮真实验证外部Electron↔主模组切片，13全量复核；仅进程内/AUI部分在14后置实现，不同步开发。

## 6. 修改步骤（实施顺序）

1. 03落实editor统一管理与WebUI共享服务、外部请求/关键回执/所有权、总开关和真实画面；设计扩展不能迫使本轮实现AUI。
2. WebUI当前需要的schema/资源/飞控定向回执按实际接口接通，不以广播或假成功代替；ingame能力保持未实现状态，不放noop。
3. 13完成WebUI全部打磨与真实验收后，14-00再落实上文公共端点、推送、GPU租约、播放/飞控适配与附属模组编译访问性。
4. CaptureHub GPU消费者只在14迁移落实；WebUI现有CPU捕获→RGBA/H264路径本轮正常完成，不被GPU接口缺失阻塞。
5. 14所有公共能力实际可用后再接AUI界面/输入，沿同一总开关与消息语义，不直接读内部字段。

## 7. 禁止修改

- 不在 `api/editor` 中暴露 `WebSocketSession`、`PreviewStreamer`、`CaptureHub`、`PreviewChannel`、`WebPreviewScreen`。
- 不把 `api/editor` 做成「只有 WebSocket 能用」的薄包装；接口必须能被进程内宿主实现。
- 不用 `public` 关键字冒充稳定合同；参数/返回类型不可访问即不可用。
- 不新增第二套消息名；`EditorEndpoint` 传输的 JSON 与现有协议完全一致。
- 不通过读 `CaptureHub.fboId/texId` 私有字段或 CPU 截图绕过 `EditorFrameSource` 租约。
- 不把 `flight.exit` 广播给所有端点，不用 `CaptureHub.close()` 实现端点关闭。
- 不用 `WebEditorServer.isRunning()` 作为 `EditorHostApi.isEnabled()` 的实现或诊断替代。
- 不在本轮修改主模组代码（用户本轮只允许写计划）。

## 8. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | 消费 `EditorEndpoint` 的 WebSocket 实现（通过主模组）；前端不直接依赖 Java 接口 |
| 编辑器1.20.1方向 | 未来14才实现进程内端点/GPU/飞控，不是03完成门槛 |
| 主模组 `main` | 新增 `api/editor`；改造 `WebEditorApi`/`WebSocketSession`/`PreviewStreamer`/`WebPreviewScreen`/`CaptureHub`/`Config` |

## 9. 正反例验收

**正例 A**：`EditorEndpoint` 的 WebSocket 实现收到 `hello`，回 `hello_ack`；与现状字节一致。
**正例 B**：`EditorPush.broadcast` 推送 `playback.state`，两个端点都收到；`send` 只推给指定端点；`flight.exit` 只到 owner。
**正例 C**：`EditorFrameSource.acquire()` 返回纹理 id/尺寸/generation；消费者在 generation 变化后重新绑定；`release()` 后无泄漏；主模组纹理不被消费者关闭。
**正例 D**：`EditorFlightControl.exit(ownerEndpointId,true)` 不依赖 `WebPreviewScreen`，进程内宿主可调用；只向 owner 发送 `flight.exit`；非 owner 调用返回 false 且不改状态。
**正例 E**：`EditorHostApi.isEnabled()==false` 时，F9 不打开、服务不启动、按键不注册；`WebEditorServer.isRunning()==false` 但开关开启时，也不能把编辑器判为关闭。
**正例 F**：两个端点 A/B；B detach 后 A 的 `EditorSessionApi`、编码器与 `CaptureHub` 消费者均不受影响。

**反例 A**：包外代码尝试 `new WebSocketSession(...)` → 编译失败（包私有）；证明现有入口不可用。
**反例 B**：`requestFlightExit` 在无 `activeScreen` 时静默 return；证明不能作为进程内入口。
**反例 C**：`CaptureHub` 无纹理 getter；任何「直接拿 FBO 纹理」的实现都是访问内部，不得作为最终方案。
反例D：14用CPU截图或网络回环冒充GPU进程内画面不通过；不影响03正常WebUI传输验收。
**反例 E**：`flight.exit` 广播给 A/B，两个窗口都写回关键帧 → 验收不通过。
**反例 F**：把 `sendCritical` 实现成 `sendState` 一样的丢旧策略 → 回执可能丢失；验收不通过。

## 10. 真实冒烟（未执行）

按 5.3 的 14 步执行；每步记录消息/日志/画面。**本轮未执行**：无 Forge dev run、无 Electron 会话、无 ffmpeg；不得声称通过。

## 11. 完成定义

- `api/editor` 七类接口（3.1–3.7）签名冻结，缺口 G1–G16 逐条有落点。
- 「当前可调用/不可调用」表与源码锚点一致，无把 `public` 当稳定的表述；`CaptureHub.close()` 明确不属于消费者合同。
- 启用判定、模式集合、端点所有权、关键文本可靠性、`flight.exit` 定向五项有正反例。
- Forge 垂直切片 14 步可执行、可判定；本轮明确未执行。
- 14迁移复用合同与已稳定WebUI基线，不另造语义；03仅验证当前WebUI链路，不验AUI。
