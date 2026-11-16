# 01-05 消息路由抽象与信号定向

> **状态：已实现**。核心文件：`editor/shared/WebEditorApi.java`、`editor/webui/WebSocketSession.java`、`editor/webui/WebSocketEditorPush.java`、`editor/webui/OutboundQueue.java`。

## 目标

把消息路由从「绑 WebSocketSession」改成「方向无关的 EditorEndpoint / EditorPush」，并补上飞控退出定向、命令回执、能力协商、关键文本可靠、错误处理与双路径清理。

## 实际实现

### 1. 路由签名

```java
public final class WebEditorApi {
    private WebEditorApi() {}
    public static void handle(String message, EditorEndpoint endpoint) { ... }
    public static void pushPlaybackState() { ... }
}
```

`handle` 开头取一次宿主，之后所有私有方法都接收 `host` 参数，不二次调用 `EditorRuntime.host()`：

```java
EditorHostApi host = EditorRuntime.host();
if (host == null || !host.isEnabled()) return;
```

主线程切换在 `EditorSessionRegistry.handle` 内完成（`Minecraft.getInstance().execute(...)`），`WebEditorApi` 永远只在主线程运行。

### 2. 发送通道分工

| 消息 | 通道 | 语义 |
|---|---|---|
| `playback.state` | `EditorPush.broadcast` → 每个端点 `sendState` | 广播、可合并 |
| `flight.state` | `EditorPush.state(owner, json)` | 定向、可合并、100ms 节流 |
| `preview.stats` | `PreviewStreamer` 直接 `stream.session.sendState(...)` | 定向、可合并、1s 一次 |
| `flight.exit` | `EditorPush.send(owner, json)` | 定向、关键 |
| `editor.ack` / `error` / `hello_ack` / `script.*` / `resource.list.result` / `registry.*` / `schema.data` / `script.graph.result` | `EditorEndpoint.sendCritical` | 关键文本 |

`OutboundQueue` 因此是三种消息：

```java
public static final int CAPACITY = 16;
public static final int CRITICAL_RESERVE = 48;
public enum Kind { FRAME, STATE, CRITICAL }
```

- `enqueueFrame`：满时丢最旧 `FRAME`；无可丢则 `droppedFrames++`、返回 `false`。
- `enqueueState`：硬上限 `CAPACITY + CRITICAL_RESERVE` 时 `droppedStates++` 放弃；达到 `CAPACITY` 时先丢最旧 `STATE`，再丢最旧 `FRAME`，都无可丢则放弃并计数。
- `enqueueCritical`：不丢任何已有消息；硬上限返回 `false`。
- `sendCritical` 失败 → `ErrorLog.warnRateLimited` + `close()` 端点，不静默。

### 3. 飞控定向

`EditorFlightAdapter` 持有 `ownerEndpointId`：

- `enter(endpointId, ...)`：已有飞控（`FlightModeManager.isActive()` 或 owner 非 null）→ false；否则按 `CameraManager.getCameraState()` 逐字段回落（`state == null` 时 `Vec3.ZERO` / yaw,pitch,roll=0 / fov=70 / zoom=1），记录 owner（允许 null = 本地键盘飞控）。
- `exit(endpointId, record)`：未激活 → false；本地与 `endpointId == null` 必须一致，非 owner 直接 false；`record` 时取 `FlightModeManager.exit()` 的最终状态，否则 `cancel()`。
- `flight.exit` JSON：`cancelled` 恒有；record 且 `finalState != null` 时追加 `x/y/z/yaw/pitch/roll/fov/zoom/absolute/baseX/baseY/baseZ`（`absolute` 取 `isModeAbsolute()`，base 取玩家位置，`player == null` 用 `Vec3.ZERO`）。
- 只有 owner 非 null 时才 `push.send(owner, json)`；本地飞控不发消息。
- `revokeOwner(endpointId)`：端点 detach 时若它是 owner，取消飞控并清 owner，**不发** `flight.exit`。

`WebPreviewScreen.broadcastFlightState()` 只对 owner 发 `flight.state`，owner 为 null（本地）直接返回，HUD 由屏幕自绘。

### 4. 命令回执

`sendAck` 统一出口：

```java
private static void sendAck(EditorEndpoint endpoint, String id, String op, boolean ok, String reason) {
    EditorCommandAck ack = new EditorCommandAck(op, ok, reason);
    JsonObject data = new JsonObject();
    data.addProperty("op", ack.op());
    data.addProperty("ok", ack.ok());
    if (ack.reason() != null) data.addProperty("reason", ack.reason());
    endpoint.sendCritical(wrap("editor.ack", data, id));
}
```

| op | 成功条件 | 失败 reason |
|---|---|---|
| `seek` | `data.time` 是有限数值且 ≥ 0 | `missing time` / `invalid time` |
| `play` | `playback().isPlaying()` 为真 | `playback not started` |
| `pause` / `stop` | 执行即成功 | — |
| `setCamera` | 5 个 float 解析成功（缺省 yaw/pitch/roll=0、fov=70、zoom=1） | `invalid camera` |
| `pushScript` | `data.script` 存在且是字符串 | `missing script` |
| `enter_flight_mode` | `flight().enter(...)` 返回 true | `flight session already active` |
| `exit_flight_mode` / `cancel_flight_mode` | `flight().exit(...)` 返回 true | `not flight owner` / `flight not active` |

发送顺序：先执行命令与 `pushPlaybackState()`（如适用），再发 ack。`editor.seek` 实测为「先 `playback.state`（time=目标值）后 `editor.ack`」。

### 5. hello_ack

| 字段 | 实际值 |
|---|---|
| `version` | `"0.3.6"` |
| `name` | `"ImmersiveCinematics"` |
| `capabilities` | 升序数组：`preview.rgba`、`preview.h264`（仅 `Ffmpeg.encoderAvailable()`）、`resource.all`、`script.graph`、`flight` |
| `schemaHash` | `SchemaExporter.exportAll()` 的 SHA-256 小写 hex（64 位）；失败 `""` |
| `scriptRoot` | `ScriptFileService.scriptRootDisplay()`，绝对路径、`/` 分隔 |

`hello_ack` 的 id 为空（`wrap(..., "")`），不回请求 id。

### 6. 错误可见

`sendError` 走 `sendCritical`：

```java
private static void sendError(EditorEndpoint endpoint, String id, String message) {
    JsonObject data = new JsonObject();
    data.addProperty("error", message);
    endpoint.sendCritical(wrap("error", data, id));
}
```

`wrap` 在 id 为空时不加 `id` 字段，不伪造 id。无 id 的 `error` 不会被静默丢弃。

### 7. script.saved.serverNotified

`handle` 已在主线程，`notifyScriptSaved` 同步执行：

- `Minecraft.getInstance().getConnection() == null` → 返回 `false`。
- 否则 `NetworkHandler.sendToServer(new C2SScriptSavedPacket(fileName))` 并返回 `true`。
- 异常返回 `false`。

`script.saved` 数据：`{path, serverNotified}`。

### 8. editor.previewConfig 单路径

只读 `PreviewConfig.fixed()` 组装固定值回执，走 `sendCritical`，然后 `EditorRuntime.requestPreviewFrame()`。不读 `PreviewStreamer`、不新增 setter、不写任何配置。

### 9. 端点关闭的双路径清理

- `WebSocketSession.close()` → `WebEditorServer.removeSession` → `sessions.remove` + `EditorManager.sessions().detach(session)`。
- `detach` 钩子：`PreviewStreamer.onEndpointDetached` 关该端点流；若是飞控 owner 则 `revokeOwner`。
- 服务与 `CaptureHub` 不受影响。

## 验收结果（Forge 与 Fabric 各 34/34 全过）

| 用例 | 结果 |
|---|---|
| hello：version / name / capabilities 必需项 / 升序 / schemaHash 64 hex / scriptRoot | 通过 |
| seek ok：`playback.state.time≈1.5`、`editor.ack ok=true`、先 state 后 ack | 通过 |
| seek missing：`reason="missing time"` | 通过 |
| 双连接：B 也收到 `playback.state` | 通过 |
| 飞控进入：A 收 `flight.state`，B 不收 | 通过 |
| 飞控退出：A 收 `flight.exit`（`cancelled=false` + 12 个字段），B 不收 | 通过 |
| 非 owner：B 发 exit → `ok=false, reason="not flight owner"`，A 无 `flight.exit` | 通过 |
| A cancel → `ok=true`，A 收 `cancelled=true` | 通过 |
| resource 四类扩展名 + `total`/`truncated` | 通过 |
| 截断：`total=2001`、`truncated=true`、`files` 长度 2000 | 通过 |
| `script.save` 非 `.json` → `error` 含 `script path must end with .json` | 通过 |
| `script.new` 两次 path 不同且匹配 `untitled-\d+\.json` | 通过 |
| `script.saved` 含 `path` 与 boolean `serverNotified` | 通过 |
| `preview.stats` 含 `captured` 且保留原字段 | 通过 |
| `registry.query{kind:"stage"}` → `matches: []` | 通过 |
| 单端点关闭：A 断开后 B 仍收 ack 与二进制帧，日志无 `CaptureHub close` / `server stopped` | 通过 |
| 关键文本实际到达（`hello_ack`/`editor.ack`/`script.saved`/`flight.exit`） | 通过 |

## 与原案的差异

| 原案 | 实际 | 原因 |
|---|---|---|
| `EditorPush` 三方法 | 增加 `state(String, String)` | `flight.state` 需要「定向 + 可合并」 |
| `PreviewStreamer.tick` 走 `EditorPush.send` | 直接 `session.sendState` | `preview.stats` 是定向可合并状态，不该占关键通道 |
| `flight.state` 广播 | 只发 owner | 非发起端点不需要，且 100ms 广播会浪费带宽 |
| 无 id 的 error 前端显示 | 服务端已保证不静默丢（`sendCritical`）；前端本轮零改动 | 本轮只做模组侧 |
