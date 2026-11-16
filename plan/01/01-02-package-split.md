# 01-02 包结构拆分与迁移

> **状态：已实现**。14 个类全部迁出，`webui` 目录已删除，无兼容垫片。

## 目标

把 `webui` 包 14 个类按职责拆成五层：`api/editor`、`editor` 根、`editor.shared`、`editor.webui`、`editor.ingame`。通用能力和外部传输不再混在同一包。

## 实际迁移表

| 源（`webui`） | 目标 | 内容改动 |
|---|---|---|
| `ScriptFileService` | `editor.shared.ScriptFileService` | 新增 `scriptRootDisplay()`、`nextUntitledPath()`；`saveScript` 加空路径与 `.json` 校验 |
| `ResourceFileService` | `editor.shared.ResourceFileService` | 新增 `KIND_VIDEO`；图片/音频扩展名按运行时能力；`list` 增加 `total`/`truncated` |
| `WebRegistryService` | `editor.shared.RegistryService` | 类名去掉 `Web` 前缀，构造器同步改名，逻辑零改动 |
| `ScriptGraphService` | `editor.shared.ScriptGraphService` | 仅改 `package` |
| `WebEditorApi` | `editor.shared.WebEditorApi` | 去传输绑定（`handle(String, EditorEndpoint)`）、全部 ack、能力协商 |
| `PreviewConfig` | `editor.shared.PreviewConfig` | 仅改 `package`（值仍是 1920×1080@60、2s 关键帧、开启编码） |
| `WebEditorServer` | `editor.webui.WebEditorServer` | `start()` 门控；`sessionById`；`removeSession` 走 `detach`；删除 `broadcastText` |
| `WebSocketSession` | `editor.webui.WebSocketSession` | `implements EditorEndpoint`；`endpointId = "ws-<n>"`；`sendState`/`sendCritical`/`isOpen`；删除 `sendText` |
| `WebPreviewScreen` | `editor.webui.WebPreviewScreen` | 生命周期交给 `EditorManager`；飞控定向广播 |
| `PreviewStreamer` | `editor.webui.PreviewStreamer` | `onEndpointAttached/Detached`；统计走 `sendState`；新增 `captured` |
| `PreviewEncoder` | `editor.webui.PreviewEncoder` | 仅改 `package` |
| `PreviewProtocol` | `editor.webui.PreviewProtocol` | 仅改 `package` |
| `H264AuSplitter` | `editor.webui.H264AuSplitter` | 仅改 `package` |
| `OutboundQueue` | `editor.webui.OutboundQueue` | 三态队列（`FRAME`/`STATE`/`CRITICAL`） |

## 新增类

| 包 | 类 | 职责 |
|---|---|---|
| `api/editor` | `EditorMode`、`EditorEndpoint`、`EditorPush`、`EditorSessionApi`、`EditorFrameSource`、`EditorPlaybackControl`、`EditorFlightControl`、`EditorHostApi`、`EditorCommandAck` | 稳定合同（见 01-03） |
| `editor` | `EditorManager` | `implements EditorHostApi`：开关、模式、打开/关闭、世界退出 |
| `editor` | `EditorSessionRegistry` | `implements EditorSessionApi`：端点集合 + attach/detach 钩子 + 主线程投递 |
| `editor.shared` | `EditorRuntime` | `install(host, frameRequester)` / `host()` / `requestPreviewFrame()`，解 `WebEditorApi` 对传输层的依赖 |
| `editor.shared` | `EditorPlaybackAdapter` | `implements EditorPlaybackControl`，转发 `CameraManager` |
| `editor.shared` | `EditorFlightAdapter` | `implements EditorFlightControl`，转发 `FlightModeManager` + `CameraManager`，持有 owner 并定向发 `flight.exit` |
| `editor.webui` | `WebSocketEditorPush` | `implements EditorPush`，基于 `WebEditorServer` 的会话表 |
| `editor.ingame` | `package-info.java` | 只留包边界，不写空实现 |

## 依赖方向（实测）

```
api/editor      → java.*                    （grep 无 net.minecraft / gson / 本模组具体包）
editor.shared   → api/editor, camera, script, media, trigger   （grep 无 editor.webui / WebPreviewScreen / WebEditorServer / PreviewStreamer）
editor.webui    → editor.shared, api/editor, editor.EditorManager
editor          → 三者皆可
```

## 迁移顺序（实际执行）

1. 冻结 `api/editor` 合同（9 个文件）与开关合同。
2. 共享服务从 `webui` 抽到 `editor.shared`（4 个文件），`WebRegistryService` 同时改名。
3. 传输层与队列（`OutboundQueue`、`WebSocketSession`、`WebSocketEditorPush`）落到 `editor.webui`。
4. 消息路由与适配器（`WebEditorApi`、`PreviewConfig`、`EditorRuntime`、`EditorPlaybackAdapter`、`EditorFlightAdapter`）。
5. 服务端/流/编码与 `CaptureHub.capturedFrames`。
6. 生命周期（`EditorManager`、`EditorSessionRegistry`、`editor.ingame`）。
7. 预览屏迁移并 `rmdir webui`。
8. 开关与平台接线。

## 验收结果

| 项 | 结果 |
|---|---|
| `webui` 目录 | 不存在（`glob` 报 `Path not found`） |
| 旧包引用 | `immersive_cinematics.webui.` 在 `common/src;forge/src;fabric/src` → 0 命中 |
| `editor.shared` → `editor.webui` | 0 命中 |
| `api/editor` 纯净 | 0 命中 |
| 编译 | BUILD SUCCESSFUL |
| 消息名 / 脚本字段 | 与迁移前一致，只新增字段 |

## 与原案的差异

| 原案 | 实际 | 原因 |
|---|---|---|
| `EditorMode` 在 `editor` 根 | 在 `api/editor` | `EditorHostApi.modes()` 返回 `Set<EditorMode>`，`api/editor` 不能依赖 `editor` 根 |
| `PreviewConfig` 在 `editor.webui` | 在 `editor.shared` | `editor.shared.WebEditorApi` 需要 `PreviewConfig.fixed()`，否则 shared 依赖 webui |
| 只有 7 接口 + 1 回执 | 9 个文件 | 多出 `EditorMode`（合同自包含） |
| `editor.shared` 只有 5 个服务 | 9 个 | 多出 `PreviewConfig`、`EditorRuntime`、`EditorPlaybackAdapter`、`EditorFlightAdapter` |
| `editor.webui` 9 个 | 9 个 | 多出 `WebSocketEditorPush`，`PreviewConfig` 移走 |
