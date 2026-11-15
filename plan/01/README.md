# 01 · editor 通用包（webui → editor 通用化）

把现有的 `webui` 包改造成 WebUI 与 AUI 共用的「editor 通用包」。本轮只做模组侧地基，不动编辑器前端。

## 本轮的文档

| 文档 | 任务 |
|---|---|
| [01-01-editor-toggle.md](01-01-editor-toggle.md) | 编辑器总开关 |
| [01-02-package-split.md](01-02-package-split.md) | 包结构拆分与迁移 |
| [01-03-editor-contract.md](01-03-editor-contract.md) | api/editor 稳定合同 |
| [01-04-lifecycle-ownership.md](01-04-lifecycle-ownership.md) | 生命周期与所有权 |
| [01-05-message-routing.md](01-05-message-routing.md) | 消息路由抽象与信号定向 |
| [01-06-shared-services.md](01-06-shared-services.md) | 共享服务正确性 |

## 要做什么

### 1. 总开关（用户分层）

编辑器只有作者会用，绝大多数玩家只播放、不编辑。因此所有编辑器相关能力必须能一键整体关闭，普通玩家不承担任何编辑器开销。

在 `Config` 增加编辑器总开关，默认开启、仅客户端生效。关闭时以下全部不加载、不生效：

- 编辑器按键绑定与绑定列表（`CinematicKeyBindings` 里的编辑器键）
- `WebEditorServer` / `WebPreviewScreen`
- `WebEditorApi` 的消息处理
- `CaptureHub` 的编辑器画面捕获注册

### 2. 包拆分：webui → editor 五层

14 个类按职责拆成五层：

| 层 | 内容 |
|---|---|
| `editor` 根 | EditorManager（总开关 + 模式 + 生命周期）、EditorMode、EditorSessionRegistry |
| `editor.shared` | ScriptFileService、ResourceFileService、WebRegistryService、ScriptGraphService、消息路由（WebEditorApi 去传输绑定后） |
| `editor.webui` | WebEditorServer、WebSocketSession、WebPreviewScreen、PreviewStreamer、PreviewEncoder、PreviewProtocol、PreviewConfig、H264AuSplitter、OutboundQueue |
| `api/editor` | EditorEndpoint、EditorPush、EditorSessionApi、EditorPlaybackControl、EditorFlightControl、EditorFrameSource、EditorHostApi |
| `editor.ingame` | 只留包边界 |

依赖方向：`editor.shared` 不依赖 `editor.webui`；`api/editor` 只依赖普通 Java 类型。

### 3. 信号方向抽象（往外 / 往内）

WebUI 在外部进程（信号往外发），AUI 在游戏内进程（信号往内发）。信号本身是共通的，只有「发往哪个方向」不同。把发送端抽象成接口，两个方向各自实现：

- `EditorEndpoint`：发一条文本消息 + 端点标识。`WebSocketSession` 实现它（往外）；未来 AUI 的进程内端点实现它（往内）。
- `EditorPush`：`broadcast`（广播可合并状态）、`send(endpointId)`（定向推送）。由宿主注入实现。
- `WebEditorApi.handle(String, WebSocketSession)` 改为 `handle(String, EditorEndpoint)`。
- `pushPlaybackState()` 里的 `WebEditorServer.broadcastText` 改为 `EditorPush.broadcast`。

### 4. 飞控退出定向

现在 `WebPreviewScreen.broadcastFlightExit()` 用 `broadcastText` 广播给所有窗口，导致非发起窗口也写回关键帧。改为定向：

- `flight.state` 只发飞控发起端点。
- `flight.exit` 只发发起端点，带最终参数 + 相对模式基准点。

### 5. 命令回执

`editor.seek / play / pause / stop / setCamera / pushScript / enter_flight_mode / exit_flight_mode / cancel_flight_mode` 目前无回执，前端只能靠 `playback.state` 推断。加 `editor.ack{op, ok, reason?}`，关键回执可靠发送或明确失败。

### 6. 能力协商

`hello_ack` 目前只有固定 `version`。加 `capabilities[]`（预览编码 / 资源 / 图 / 飞控等能力位）与 `schemaHash`，让前端知道支持什么、schema 是否变化。

### 7. 干净迁移

删除 `webui` 包，不留兼容垫片；消息名、脚本 JSON 字段保持不变。

## 出口标准

- 总开关关闭：编辑器按键无响应、无服务、无捕获注册；开启：一切正常。
- 五层包结构成立，`editor.shared` 不依赖 `editor.webui`。
- 消息名、脚本字段与迁移前完全一致。
