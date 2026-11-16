# 01 · editor 通用包（webui → editor 通用化）

> **状态：已实现**（2026-11-16）。模组侧 `ImmersiveCinematics` 完成，编辑器前端本轮零改动。
> 本文档已按实际落地回写；与设计原案的差异集中在「与原案的差异」一节。

把现有的 `webui` 包改造成 WebUI 与 AUI 共用的「editor 通用包」。

## 本轮的文档

| 文档 | 任务 |
|---|---|
| [01-01-editor-toggle.md](01-01-editor-toggle.md) | 编辑器总开关 |
| [01-02-package-split.md](01-02-package-split.md) | 包结构拆分与迁移 |
| [01-03-editor-contract.md](01-03-editor-contract.md) | api/editor 稳定合同 |
| [01-04-lifecycle-ownership.md](01-04-lifecycle-ownership.md) | 生命周期与所有权 |
| [01-05-message-routing.md](01-05-message-routing.md) | 消息路由抽象与信号定向 |
| [01-06-shared-services.md](01-06-shared-services.md) | 共享服务正确性 |

## 实际落地

### 1. 总开关（用户分层）

编辑器只有作者会用，绝大多数玩家只播放、不编辑。所有编辑器能力由 `Config.editorEnabled` 一键整体关闭，默认开启、仅客户端生效。

关闭时实际不生效的路径（5 个门控点，全部经 `EditorManager.isEnabled()`；`WebEditorApi` 通过 `EditorHostApi` 门面读同一值）：

| 位置 | 行为 |
|---|---|
| `ClientEventHandler.registerKeyMappings` | 只注册 `SKIP_KEY`，10 个编辑器键不注册 |
| `CinematicKeyBindings.onClientTick` | F6 打开循环与服务连接提示整体跳过 |
| `WebEditorServer.start()` | 首行返回 `false`，不监听端口 |
| `WebPreviewScreen.init()` / `render()` | 首行返回，不打开屏、不推流 |
| `WebEditorApi.handle()` | 首行返回，`editor.*` 消息不处理 |

`CaptureHub.register` 由 `EditorManager.open()` 负责，开关关闭时 `open()` 直接返回，因此捕获也不会注册。

### 2. 包拆分：webui → editor 五层

14 个类全部迁出，`webui` 目录已删除，无兼容垫片。

| 层 | 内容 |
|---|---|
| `api/editor` | `EditorMode`、`EditorEndpoint`、`EditorPush`、`EditorSessionApi`、`EditorFrameSource`、`EditorPlaybackControl`、`EditorFlightControl`、`EditorHostApi`、`EditorCommandAck`（9 个，纯 Java） |
| `editor` | `EditorManager`（开关 + 模式 + 生命周期）、`EditorSessionRegistry`（端点表 + 主线程投递） |
| `editor.shared` | `ScriptFileService`、`ResourceFileService`、`RegistryService`、`ScriptGraphService`、`WebEditorApi`、`PreviewConfig`、`EditorRuntime`、`EditorPlaybackAdapter`、`EditorFlightAdapter` |
| `editor.webui` | `WebEditorServer`、`WebSocketSession`、`WebSocketEditorPush`、`WebPreviewScreen`、`PreviewStreamer`、`PreviewEncoder`、`PreviewProtocol`、`H264AuSplitter`、`OutboundQueue` |
| `editor.ingame` | 仅 `package-info.java`，无占位类 |

依赖方向：`api/editor` 只依赖 `java.*`；`editor.shared` 不依赖 `editor.webui`（grep 验收为 0）；`editor.webui` 依赖 `editor.shared` + `api/editor` + `editor.EditorManager`；`editor` 根可依赖三者。

### 3. 信号方向抽象（往外 / 往内）

WebUI 在外部进程（信号往外发），AUI 在游戏内进程（信号往内发）。发送端抽象成接口，两个方向各自实现：

- `EditorEndpoint`：`endpointId()` / `sendState()` / `sendCritical()` / `isOpen()`。`WebSocketSession` 实现它（往外，`endpointId = "ws-<n>"`）；未来 AUI 的进程内端点实现它（往内）。
- `EditorPush`：`broadcast()`（只用于 `playback.state`）、`send(endpointId)`（关键文本定向，如 `flight.exit`）、`state(endpointId)`（定向可合并状态，如 `flight.state`）、`endpoints()`。由宿主注入，WebUI 实现是 `WebSocketEditorPush`。
- `WebEditorApi.handle(String, EditorEndpoint)`：不再绑定 `WebSocketSession`。
- `pushPlaybackState()` 的 `WebEditorServer.broadcastText` 改为 `EditorPush.broadcast`。

### 4. 飞控退出定向

`flight.state` 与 `flight.exit` 都只到飞控发起端点，非发起端点收不到，也不会写回关键帧：

- `flight.state`：`EditorManager.push().state(owner, json)`，100ms 节流，仅 owner。
- `flight.exit`：`EditorManager.push().send(owner, json)`；record 时带 `x/y/z/yaw/pitch/roll/fov/zoom/absolute/baseX/baseY/baseZ`，cancel 时只有 `cancelled:true`。
- 本地键盘飞控（`ownerEndpointId == null`）不发任何 `flight.*` 消息，HUD 由屏幕自绘。

### 5. 命令回执

9 个命令全部回 `editor.ack{op, ok, reason?}`，关键回执走 `sendCritical`：

`editor.seek` / `editor.play` / `editor.pause` / `editor.stop` / `editor.setCamera` / `editor.pushScript` / `editor.enter_flight_mode` / `editor.exit_flight_mode` / `editor.cancel_flight_mode`。

固定 reason 字符串：`missing time`、`invalid time`、`playback not started`、`flight session already active`、`flight not active`、`not flight owner`。

### 6. 能力协商

`hello_ack` 实际字段：

| 字段 | 值 |
|---|---|
| `version` | `"0.3.6"` |
| `name` | `"ImmersiveCinematics"` |
| `capabilities` | 升序数组：`preview.rgba`、`preview.h264`（仅 `Ffmpeg.encoderAvailable()`）、`resource.all`、`script.graph`、`flight` |
| `schemaHash` | `SchemaExporter.exportAll()` 的 SHA-256 小写 hex（64 位）；失败 `""` |
| `scriptRoot` | `immersive_cinematics/scripts` 的绝对路径，`/` 分隔 |

### 7. 干净迁移

`webui` 包已删除；消息名、脚本 JSON 字段与迁移前完全一致，只做了新增字段（`captured`、`total`、`truncated`、`serverNotified`、`scriptRoot`、`capabilities`、`schemaHash`、`flight.exit.baseX/Y/Z`）。

## 验证结果

| 项 | 结果 |
|---|---|
| 编译 | `:common:compileJava :forge:compileJava :fabric:compileJava` → BUILD SUCCESSFUL |
| 静态结构 | 8 项全过：`webui` 目录不存在、旧包引用 0、`editor.shared` 不依赖 `editor.webui`、`api/editor` 纯净、`enqueueText/broadcastText/sendText(` 0、无 `CaptureHub.close`、5 个门控点齐、`Config.editorEnabled` 只被 `EditorManager` 读 |
| `OutboundQueue` 语义 | jshell smoke 10 条断言全过（丢旧 STATE、关键文本硬上限 16+48、close 后拒收） |
| Forge 运行时 | WebSocket 探针 34/34 全过 |
| Forge 开关关闭 | F6 无服务、无 8765、无 token、日志 0 次 `server started`；恢复 `true` 后 F6 正常 |
| Fabric 运行时 | WebSocket 探针 34/34 全过 |
| Fabric 开关关闭 | 同上；恢复 `true` 后正常 |

**未执行**：01-04 验收里的「编辑器开着时退出世界」。`WebPreviewScreen.keyPressed` 把 ESC 截获为 `onClose()`（设计决议），编辑器打开时聊天也不可用，单人游戏里没有 UI 路径能在编辑器开着时退世界。`onWorldExit()` 的调用点在 `ClientEventHandler` 世界退出 try 块第一条，`close()` 幂等已在 F6 关闭路径上实测两次。

## 与原案的差异

| # | 原案 | 实际 | 原因 |
|---|---|---|---|
| 1 | `EditorMode` 在 `editor` 根 | 在 `api/editor` | `EditorHostApi.modes()` 返回 `Set<EditorMode>`，`api/editor` 不能依赖 `editor` 根 |
| 2 | `EditorPush` 三方法 | 四方法，增加 `state(String, String)` | `flight.state` 需要「定向 + 可合并」，`broadcast`/`send` 都表达不了 |
| 3 | `PreviewConfig` 在 `editor.webui` | 在 `editor.shared` | `editor.shared.WebEditorApi` 需要 `PreviewConfig.fixed()`，否则 shared 依赖 webui |
| 4 | 按键 F9 | F6（`EDITOR_OPEN`）+ F7（`EDITOR_FLIGHT`），都是 `KeyMapping` 可改键 | 统一入口 `EditorManager.openDefault()`，AUI 轮次在同一入口加分支 |
| 5 | 图片补 `webp`、视频含 `mov` | 图片 `png/gif/jpg/jpeg`（不含 webp）；视频 `mp4/webm/mkv` | `NativeImage.read` 不能解码 webp；`VideoFiles.isVideo` 只认 mp4/webm/mkv |
| 6 | 按键注册按开关决定 | Forge 上按键仍会注册，靠 tick/屏/服务门控 | 已反编译确认 Forge 的 `CONFIG_LOAD` 晚于 `SIDED_SETUP`（按键注册时机） |
| 7 | — | `WebEditorServer` 私有 HTTP 辅助 `sendText` → `sendHttpText` | 不改名则 `sendText\(` 静态检查无法归零 |
| 8 | `EditorPlaybackAdapter` 9 个方法 | 8 个 | 合同 `EditorPlaybackControl` 就是 8 个 |

## 出口标准

- 总开关关闭：编辑器按键无响应、无服务、无捕获注册；开启：一切正常。**已满足**。
- 五层包结构成立，`editor.shared` 不依赖 `editor.webui`。**已满足**。
- 消息名、脚本字段与迁移前完全一致。**已满足**。
