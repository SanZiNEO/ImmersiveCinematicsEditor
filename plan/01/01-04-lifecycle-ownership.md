# 01-04 生命周期与所有权

> **状态：已实现**。核心文件：`editor/EditorManager.java`、`editor/EditorSessionRegistry.java`。

## 目标

建立编辑器统一入口（`EditorManager`），管住「开关 → 模式 → 资源 → 关闭」的完整生命周期：按需启动、端点所有权、世界退出清理。

## 实际实现

### 1. EditorManager（统一入口）

`public final class EditorManager implements EditorHostApi`，`INSTANCE` 单例。

| 成员 | 实际行为 |
|---|---|
| `open(EditorMode)` | `synchronized`；`!isEnabled() \|\| mode != WEBUI` → false；`WebEditorServer.start()` 失败 → false；成功则 `CaptureHub.register(PreviewStreamer.INSTANCE)`、`currentMode = WEBUI`、返回 true |
| `openDefault()` | F6 的唯一落点：开关门控 → `currentMode == WEBUI` 短路 → `modes()` 不含 WEBUI 则 false → 已是 `WebPreviewScreen` 则置 `currentMode` → 否则 `mc.setScreen(new WebPreviewScreen())`。AUI 轮次在同一方法内按 `modes()` 加分支 |
| `close()` | `synchronized`；`flight.isActive()` → `flight.revokeOwner(ownerEndpointId())`；`CameraManager.isEditorPlayback()` 为真才 `CameraManager.exitPreview()`；`WebEditorServer.stop()`；`PreviewStreamer.close()`；`sessionRegistry.clear()`；`currentMode = null` |
| `onWorldExit()` | 等价 `close()` |
| `isEnabled()` | `return Config.editorEnabled;` |
| `modes()` | 开启 `Set.of(EditorMode.WEBUI)`；关闭 `Set.of()` |
| `sessions()/push()/playback()/flight()` | 返回字段（`EditorSessionRegistry` / `WebSocketEditorPush` / `EditorPlaybackAdapter` / `EditorFlightAdapter`） |
| `frames()` | `null` |
| `schemaHash()` | 懒计算 + `volatile` 缓存：`SchemaExporter.exportAll().toString()` 的 SHA-256 小写 hex；异常返回 `""` |
| `capabilities()` | `TreeSet` 升序 + `unmodifiableSet`：`preview.rgba`；`Ffmpeg.encoderAvailable()` 时加 `preview.h264`；`resource.all`；`script.graph`；`flight` |

构造期装配：

```java
EditorRuntime.install(this, PreviewStreamer.INSTANCE::requestFrame);
sessionRegistry.setHooks(
        PreviewStreamer.INSTANCE::onEndpointAttached,
        endpoint -> {
            PreviewStreamer.INSTANCE.onEndpointDetached(endpoint);
            flight.revokeOwner(endpoint.endpointId());
        });
```

### 2. 按需启动

- 总开关开启 ≠ 服务启动。`WebEditorServer.start()` 只在 `EditorManager.open(WEBUI)` 时调用。
- 没有客户端、没有消费时，`PreviewStreamer` 不建编码器、不订阅帧（`needsFrame` 首查 `isRunning() && hasClients()`）。
- `modes()` 是「本环境允许哪些模式」，不是「哪些模式正在运行」。

### 3. 端点所有权

| 资源 | 所有者 | 释放 | 禁止 |
|---|---|---|---|
| WebSocket 连接 / 会话 | 该端点 | `WebSocketSession.close()` → `WebEditorServer.removeSession` → `EditorSessionApi.detach` | 用会话关闭去停服务、关其他会话 |
| `PreviewStreamer.SessionStream` / 编码器 | 该会话 | `onEndpointDetached` → `stream.closeStream()` | 用它关闭 `PreviewStreamer` 或 `CaptureHub` |
| `PreviewStreamer` 自身 | editor.webui 模式 | `EditorManager.close()` | 单端点 detach 时 close |
| 飞控会话 | 发起端点（owner） | owner 退出 / `revokeOwner` / Screen 关闭 | 非 owner 关闭时取消；广播 `flight.exit` |
| `CaptureHub` / FBO / 纹理 | 主模组宿主 | 宿主生命周期 | 编辑器任何路径调用 `CaptureHub.close()` |
| 编辑器按键 / 入口 | 统一入口 | 总开关关闭时注册期门控 / 世界退出时 `onWorldExit()` | 进入模式前预先注册常驻 |

`EditorSessionRegistry.detach` 只在端点确实从集合移除时触发 `detachHook`，钩子链是「关该端点流 → 若它是飞控 owner 则 `revokeOwner`」。

### 4. 世界退出清理

`ClientEventHandler` 世界退出 try 块第一条：

```java
EditorManager.INSTANCE.onWorldExit();
```

在 `CameraManager.emergencyStop()` 之前，不直接操作服务 / 捕获。退出后无残留服务、捕获消费者、token。

### 5. 关闭语义

- 端点级 detach 与宿主级 teardown 分离。
- 单端点关闭只释放该端点资源；总开关关闭 / 世界退出 / F6 关闭才做宿主级 teardown。
- `close()` 幂等：服务已停时再次调用不抛异常、不重复创建资源（F6 关闭与 ESC 关闭两条路径实测多次 `server stopped`，无异常）。

### 6. 编辑器打开键

`EDITOR_OPEN`（`KeyMapping`，默认 F6，翻译键 `key.immersive_cinematics.editor.open`，玩家可在「控制 → 按键绑定」改键，持久化在 `options.txt`）。F6 统一走 `EditorManager.openDefault()`。

F7（`EDITOR_FLIGHT`）只在 `WebPreviewScreen.keyPressed` 内处理：飞控未激活 → `flight().enter(null, ..., false)`（本地 owner）；已激活 → `exit(ownerEndpointId(), true)`。编辑器关闭时没有全局 F7 处理器，F7 不生效。

## 验收结果

| 用例 | 结果 |
|---|---|
| 开关开启但未按 F6：8765 未监听、无捕获消费者 | 通过（开 F6 前 `netstat` 无 8765） |
| 按 F6：监听并注册 | 通过（`[IC-WebUI] server started`，8765 LISTENING） |
| 关闭一个 WebUI 窗口：另一个继续出帧、`CaptureHub` 未被关闭 | 通过（探针「单端点关闭」用例：A 断开后 B 1s 内收到二进制帧，日志无 `CaptureHub close` / `server stopped`） |
| F6 关闭：服务停、端口释放、token 删除 | 通过 |
| 总开关关闭：两模式均不可进入，重复关闭无异常 | 通过（Forge / Fabric 各一次） |
| 世界退出 / 重进 | **未执行**（见下） |

### 未执行项说明

「编辑器开着时退出世界」在单人游戏里没有可达的 UI 路径：`WebPreviewScreen.keyPressed` 把 ESC 截获为 `onClose()`（退飞控或关编辑器），编辑器打开时聊天也不可用，因此无法用 ESC → 暂停菜单或 `/kick` 触发退世界。

覆盖方式：`onWorldExit()` 的调用点在 `ClientEventHandler` 世界退出 try 块第一条（已 grep 确认），`close()` 幂等在 F6 关闭路径上实测两次。若要补做，需要专用服务端 + rcon `kick`（且服务端与客户端不能用同一 gameDir，否则 `.fabric/processedMods` 会冲突）。

## 与原案的差异

| 原案 | 实际 | 原因 |
|---|---|---|
| `EditorManager` 不持有 `CaptureHub` 所有权 | `open()` 负责 `CaptureHub.register` | 捕获注册必须与「进入 WEBUI 模式」绑定，否则开关关闭时仍可能注册 |
| `close()` 无条件 `CameraManager.exitPreview()` | 仅 `isEditorPlayback()` 为真时调用 | 避免 `PreviewChannel.exitPreview()` 在编辑器未激活时误停游戏实例 |
| 打开键 F9 | F6（`EDITOR_OPEN`） | 统一入口，AUI 轮次在同一方法加分支 |
| `EditorMode` 在 `editor` 根 | `api/editor` | 合同自包含 |
