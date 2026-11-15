# 01-03 api/editor 稳定合同

## 目标

冻结附属模组唯一依赖的一份编辑器合同：7 个接口 + 1 个回执记录。WebUI 与 AUI 都只依赖这份合同，两侧实现互不依赖。

信号本身是共通的，只有「发往哪个方向」不同——WebUI 在外部进程（往外发），AUI 在游戏内进程（往内发）。这份合同把发送端抽象成接口，两个方向各自实现。

## 接口定义

新建 `api/editor` 包：

### 1. EditorEndpoint（替代 WebSocketSession 的发送面）

```java
public interface EditorEndpoint {
    String endpointId();               // WebSocket 会话 id / 进程内宿主 id；非空、稳定到连接结束
    void sendState(String json);       // 可合并状态（playback.state/flight.state/preview.stats）；非阻塞，可丢上一次
    boolean sendCritical(String json); // 关键文本（回执/错误/flight.exit）；可靠入队，失败返回 false
    boolean isOpen();                  // 是否仍可发送
}
```

约束：只暴露「发文本」，不暴露 socket、线程、队列。`sendCritical` 失败时调用方关闭端点并让客户端明确失败，不能静默丢弃后假成功。

### 2. EditorPush（替代 broadcastText / session.sendText）

```java
public interface EditorPush {
    void broadcast(String json);                    // 可合并状态
    boolean send(String endpointId, String json);   // 关键文本定向；失败返回 false
    java.util.List<String> endpoints();
}
```

约束：`broadcast` 只用于 `playback.state`/`flight.state`；`preview.stats` 与 `flight.exit` 必须 `send` 到所属端点。**`flight.exit` 绝不广播**。实现由宿主提供（WebSocket 宿主用 `WebEditorServer.sessions()`，进程内宿主用自己的端点表）。

### 3. EditorSessionApi（挂载 / 卸载 + 命令路由）

```java
public interface EditorSessionApi {
    void attach(EditorEndpoint endpoint);
    void detach(EditorEndpoint endpoint);
    void handle(String message, EditorEndpoint endpoint);  // 内部切主线程
}
```

约束：`attach/detach` 幂等；`detach` 只释放该端点的预览资源与飞控所有权（若它是 owner），不停止服务、不关闭其他端点、不调用 `CaptureHub.close()`。

### 4. EditorFrameSource（同进程 GPU 画面，占位）

帧源租约：纹理 id / 尺寸 / generation / 帧时刻 / 翻转 / alpha + 幂等 release；接口不暴露 `CaptureHub`、`RenderTarget` 等内部类型。

### 5. EditorPlaybackControl（播放控制）

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

约束：语义与 `CameraManager` 编辑器播放方法一致（`CameraManager.java:181-200`），实现可以是 `CameraManager` 适配器。

### 6. EditorFlightControl（飞控）

```java
public interface EditorFlightControl {
    boolean enter(String endpointId, Double x, Double y, Double z,
                  Float yaw, Float pitch, Float roll, Float fov, Float zoom, boolean absolute);
    boolean exit(String endpointId, boolean record);   // 只有 owner 可退出
    boolean isActive();
    String ownerEndpointId();
    FlightState state();
    record FlightState(double x, double y, double z,
                       float yaw, float pitch, float roll, float fov, float zoom, boolean absolute) {}
}
```

约束：同一时刻只有一个 owner；`enter` 逐字段回落与 `WebPreviewScreen.enterFlightMode` 一致但不依赖 `activeScreen`；`exit(record)` 只向 owner 发 `flight.exit`，不广播。

### 7. EditorHostApi（总门面 + 开关）

```java
public interface EditorHostApi {
    boolean isEnabled();                  // 统一总开关；不用 WebEditorServer.isRunning() 代替
    java.util.Set<EditorMode> modes();    // webui / ingame；开关关闭时为空集
    EditorSessionApi sessions();
    EditorPush push();
    EditorFrameSource frames();           // 仅 ingame 且真实可用时非 null
    EditorPlaybackControl playback();
    EditorFlightControl flight();
    String schemaHash();
    java.util.Set<String> capabilities();
}
```

### 8. EditorCommandAck

```java
record EditorCommandAck(String op, boolean ok, String reason) {}
```

## G1–G16 缺口落点

| 缺口 | 落点 |
|---|---|
| G1 无 api/editor 包 | 本文件 7 接口 |
| G2 WebSocketSession 包私有 | EditorEndpoint 替代 |
| G3 无推送抽象 | EditorPush |
| G4 无 GPU 帧源 | EditorFrameSource 占位 |
| G5 飞控退出依赖 WebPreviewScreen | EditorFlightControl |
| G6 编辑器开关不存在 | EditorHostApi.isEnabled + Config（01-01） |
| G7 hello_ack 无 schema/能力 | schemaHash + capabilities（01-05） |
| G8 editor.* 无 ack | EditorCommandAck（01-05） |
| G9 PreviewConfig 固定值 | 01-05 |
| G10 preview.stats 无 captured | 01-05 |
| G11 资源 kind=video 缺失 | 01-06 |
| G12 无 scriptRoot 诊断 | 01-06 |
| G13 关键文本可被静默丢弃 | EditorEndpoint.sendCritical |
| G14 飞控无 owner、flight.exit 广播 | EditorFlightControl + EditorPush.send（01-05） |
| G15 无端点级 detach 所有权 | EditorSessionApi.detach |
| G16 总开关不区分模式 | EditorHostApi.isEnabled/modes |

## 验收标准

- 7 接口 + `EditorCommandAck` 签名冻结，G1–G16 逐条有落点。
- `api/editor` 不依赖任何具体传输或游戏实现。
- `WebSocketSession` 实现 `EditorEndpoint`，编译通过。
