# 01-03 api/editor 稳定合同

> **状态：已实现**。包路径 `com.immersivecinematics.immersive_cinematics.api.editor`，9 个文件，全部纯 Java。

## 目标

冻结附属模组唯一依赖的一份编辑器合同。WebUI 与 AUI 都只依赖这份合同，两侧实现互不依赖。

信号本身是共通的，只有「发往哪个方向」不同——WebUI 在外部进程（往外发），AUI 在游戏内进程（往内发）。这份合同把发送端抽象成接口，两个方向各自实现。

## 实际文件清单（9 个）

| 文件 | 类型 |
|---|---|
| `EditorMode.java` | `enum` |
| `EditorEndpoint.java` | `interface` |
| `EditorPush.java` | `interface` |
| `EditorSessionApi.java` | `interface` |
| `EditorFrameSource.java` | `interface` + 嵌套 `interface Lease` |
| `EditorPlaybackControl.java` | `interface` |
| `EditorFlightControl.java` | `interface` + 嵌套 `record FlightState` |
| `EditorHostApi.java` | `interface` |
| `EditorCommandAck.java` | `record` |

`EditorMode` 放在合同包里而不是 `editor` 根：`EditorHostApi.modes()` 返回 `Set<EditorMode>`，若 `EditorMode` 在 `editor` 根，`api/editor` 就会反向依赖实现包。

## 接口定义

### 1. EditorMode

```java
public enum EditorMode { WEBUI, INGAME }
```

### 2. EditorEndpoint（替代 WebSocketSession 的发送面）

```java
public interface EditorEndpoint {
    String endpointId();                // 非空、稳定到连接结束（WebUI: "ws-<n>"）
    void sendState(String json);        // 可合并状态（playback.state / flight.state / preview.stats）；非阻塞，可丢旧
    boolean sendCritical(String json);  // 关键文本（回执/错误/flight.exit）；可靠入队，失败返回 false
    boolean isOpen();                   // 是否仍可发送
}
```

约束：只暴露「发文本」，不暴露 socket、线程、队列。`sendCritical` 失败时调用方关闭端点并让客户端明确失败，不能静默丢弃后假成功。

### 3. EditorPush（替代 broadcastText / session.sendText）

```java
public interface EditorPush {
    void broadcast(String json);                          // 只用于 playback.state
    boolean send(String endpointId, String json);         // 关键文本定向（flight.exit）；失败 false
    void state(String endpointId, String json);           // 定向可合并状态（flight.state）
    java.util.List<String> endpoints();                   // 当前端点 id 快照
}
```

约束：

- `broadcast` 只用于 `playback.state`。
- `state` 只用于 `flight.state`（定向 + 可合并）。
- `send` 只用于关键文本（`flight.exit`），失败返回 `false`。
- `preview.stats` 不经过 `EditorPush`，由 `PreviewStreamer` 直接对 `EditorEndpoint.sendState` 单发。
- **`flight.exit` 绝不广播**。

第四方法 `state` 是相对原案的新增：`flight.state` 既需要「定向」又需要「可合并」，`broadcast` 与 `send` 都表达不了。

### 4. EditorSessionApi（挂载 / 卸载 + 命令路由）

```java
public interface EditorSessionApi {
    void attach(EditorEndpoint endpoint);                 // 幂等
    void detach(EditorEndpoint endpoint);                 // 幂等；只释放该端点资源与飞控所有权
    void handle(String message, EditorEndpoint endpoint); // 内部切主线程
}
```

约束：`attach/detach` 幂等；`detach` 只释放该端点的预览资源与飞控所有权（若它是 owner），不停止服务、不关闭其他端点、不调用 `CaptureHub.close()`。

实现 `EditorSessionRegistry` 用 `ConcurrentHashMap.newKeySet()` 存端点，`handle` 用 `Minecraft.getInstance().execute(...)` 切主线程并在 lambda 内复查端点仍在集合里。

### 5. EditorFrameSource（同进程 GPU 画面，占位）

```java
public interface EditorFrameSource {
    Lease acquire();                                      // 不可用时返回 null
    interface Lease {
        int textureId();
        int width();
        int height();
        long generation();
        long frameNanos();
        boolean flipY();
        boolean alphaPremultiplied();
        void release();                                   // 幂等
    }
}
```

本轮只建接口与 `Lease`，不写实现；`EditorHostApi.frames()` 恒返回 `null`。接口不暴露 `CaptureHub`、`RenderTarget` 等内部类型。

### 6. EditorPlaybackControl（播放控制）

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

8 个方法（原案正文误写「9 个」）。实现 `EditorPlaybackAdapter` 直接转发 `CameraManager`，`isPlaying()` = `isEditorPlayback() && !isEditorPaused()`。

### 7. EditorFlightControl（飞控）

```java
public interface EditorFlightControl {
    boolean enter(String endpointId, Double x, Double y, Double z,
                  Float yaw, Float pitch, Float roll, Float fov, Float zoom, boolean absolute);
    boolean exit(String endpointId, boolean record);       // 只有 owner 可退出
    boolean isActive();
    String ownerEndpointId();                              // null = 无 owner 或本地键盘飞控
    FlightState state();                                   // 未激活返回 null
    record FlightState(double x, double y, double z,
                       float yaw, float pitch, float roll, float fov, float zoom, boolean absolute) {}
}
```

约束：同一时刻只有一个 owner；`enter` 逐字段回落与 `WebPreviewScreen.enterFlightMode` 一致但不依赖 `activeScreen`；`exit(record)` 只向 owner 发 `flight.exit`，不广播。

实现 `EditorFlightAdapter` 额外提供 `public void revokeOwner(String endpointId)`：端点 detach 时若它是 owner，取消飞控并清 owner，不发 `flight.exit`。

### 8. EditorHostApi（总门面 + 开关）

```java
public interface EditorHostApi {
    boolean isEnabled();                  // 统一总开关；不用 WebEditorServer.isRunning() 代替
    java.util.Set<EditorMode> modes();    // 开关关闭 = 空集；本轮开启时 = {WEBUI}
    EditorSessionApi sessions();
    EditorPush push();
    EditorFrameSource frames();           // 本轮恒 null
    EditorPlaybackControl playback();
    EditorFlightControl flight();
    String schemaHash();                  // 64 位小写 hex；失败 ""
    java.util.Set<String> capabilities();
}
```

### 9. EditorCommandAck

```java
public record EditorCommandAck(String op, boolean ok, String reason) {}
```

`reason` 仅 `ok=false` 时非 null。JSON 序列化在 `WebEditorApi` 内手工完成，`api/editor` 不依赖 Gson。

## G1–G16 缺口落点

| 缺口 | 落点 | 实际实现 |
|---|---|---|
| G1 无 api/editor 包 | 本文件 9 文件 | `api/editor` |
| G2 WebSocketSession 包私有 | EditorEndpoint 替代 | `WebSocketSession implements EditorEndpoint` |
| G3 无推送抽象 | EditorPush | `WebSocketEditorPush` |
| G4 无 GPU 帧源 | EditorFrameSource 占位 | 仅接口 + `Lease`，`frames()` 返回 `null` |
| G5 飞控退出依赖 WebPreviewScreen | EditorFlightControl | `EditorFlightAdapter` |
| G6 编辑器开关不存在 | EditorHostApi.isEnabled + Config | `Config.editorEnabled` → `EditorManager.isEnabled()` |
| G7 hello_ack 无 schema/能力 | schemaHash + capabilities | `EditorManager.schemaHash()/capabilities()` |
| G8 editor.* 无 ack | EditorCommandAck | `WebEditorApi.sendAck`，9 个 op |
| G9 PreviewConfig 固定值 | 01-05 | `PreviewConfig.fixed()` 单路径回执 |
| G10 preview.stats 无 captured | 01-05 | `CaptureHub.capturedFrames()` |
| G11 资源 kind=video 缺失 | 01-06 | `KIND_VIDEO` + `VideoFiles.isVideo` |
| G12 无 scriptRoot 诊断 | 01-06 | `ScriptFileService.scriptRootDisplay()` |
| G13 关键文本可被静默丢弃 | EditorEndpoint.sendCritical | `OutboundQueue.Kind.CRITICAL` + 硬上限失败即关端点 |
| G14 飞控无 owner、flight.exit 广播 | EditorFlightControl + EditorPush.send | `EditorFlightAdapter` + `push.send(owner)` |
| G15 无端点级 detach 所有权 | EditorSessionApi.detach | `EditorSessionRegistry` + `EditorManager` 钩子 |
| G16 总开关不区分模式 | EditorHostApi.isEnabled/modes | `Set.of(WEBUI)` / `Set.of()` |

## 验收结果

| 项 | 结果 |
|---|---|
| 9 个文件、签名与合同一致 | 通过（逐文件复核） |
| `api/editor` 不依赖具体传输/游戏实现 | 通过（grep `net.minecraft` / `com.google.gson` / `immersive_cinematics.(editor|camera|media|webui)` → 0） |
| import 只有 `java.util` | 通过（仅 `EditorHostApi` 与 `EditorPush` 各 1 条） |
| `WebSocketSession implements EditorEndpoint` | 通过 |
| 编译 | BUILD SUCCESSFUL |
