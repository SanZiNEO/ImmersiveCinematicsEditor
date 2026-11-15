# 01-04 生命周期与所有权

## 目标

建立编辑器统一入口（EditorManager），管住「开关 → 模式 → 资源 → 关闭」的完整生命周期：按需启动、端点所有权、世界退出清理。

## 改动

### 1. EditorManager（统一入口）

新建 `editor` 根的生命周期类，持有：总开关、当前模式、打开 / 关闭、世界退出清理。它是编辑器的唯一所有者，不持有 `CaptureHub` 所有权。

- `open(mode)` / `close()`：进入 / 退出模式。
- `isEnabled()` / `modes()`：委托给 `EditorHostApi`。
- `onWorldExit()`：世界退出时关闭当前模式，释放本模式拥有的资源。

### 2. 按需启动

- 总开关开启 ≠ 服务启动。`WebEditorServer.start()` 只在进入 WEBUI 模式时调用；没有客户端、没有消费时，不启动编码器、不订阅帧。
- `modes()` 是「本环境允许哪些模式」，不是「哪些模式正在运行」。

### 3. 端点所有权

| 资源 | 所有者 | 释放 | 禁止 |
|---|---|---|---|
| WebSocket 连接 / 会话 | 该端点 | `WebSocketSession.close()` / `EditorSessionApi.detach` | 用会话关闭去停止服务、关其他会话 |
| PreviewStreamer.SessionStream / 编码器 | 该会话 | `onSessionClosed` | 用它关闭 `PreviewStreamer` 或 `CaptureHub` |
| PreviewStreamer 自身 | editor.webui 模式 | 模式 teardown | 单端点 detach 时 close |
| 飞控会话 | 发起端点（owner） | owner 退出 / Screen 关闭 | 非 owner 关闭时取消；广播 flight.exit |
| CaptureHub / FBO / 纹理 | 主模组宿主 | 宿主生命周期 | 编辑器任何路径调用 `CaptureHub.close()` |
| 编辑器按键 / 入口 | 统一入口 | 总开关关闭 / 世界退出 | 进入模式前预先注册常驻 |

### 4. 世界退出清理

`ClientEventHandler` 世界退出时调用 `EditorManager.close()`（或等价），不直接操作服务 / 捕获。退出后无残留服务、捕获消费者、按键、token。

### 5. 关闭语义

- 端点级 detach 与宿主级 teardown 分离。
- 单端点关闭只释放该端点资源；总开关关闭 / 世界退出才做宿主级 teardown，重复调用幂等。

## 验收标准

- 开关开启但未按 F9：8765 未监听、无捕获消费者；按 F9 才监听并注册。
- 关闭一个 WebUI 窗口：另一个窗口继续出帧，`CaptureHub` 未被关闭。
- 世界退出 / 重进：无残留服务、捕获、按键、token。
- 总开关关闭：两模式均不可进入，重复关闭无异常。
