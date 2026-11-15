# 01-01 编辑器总开关

## 目标

加一个配置开关，一键关闭所有编辑器相关能力。绝大多数玩家只播放、不编辑，关闭后不承担任何编辑器开销。

## 改动

1. `Config.java` 增加 `public static boolean editorEnabled = true;`。
2. `ConfigValues` record 增加 `boolean editorEnabled` 字段，`defaults()` 返回 `true`，`apply()` 赋值。
3. 增加 `setEditorEnabled(boolean)` 写回接口（`ConfigProvider.setBoolean` 已存在，无需改接口）。
4. Forge / Fabric 的 ConfigProvider 各增加 `editorEnabled` 布尔键与默认值。
5. 平台入口注册按键处，按 `Config.editorEnabled` 决定是否注册编辑器键（`SKIP_KEY` 始终注册）。
6. `CinematicKeyBindings.onClientTick()` 的 F9 处理前检查 `Config.editorEnabled`，关闭时不打开预览屏、不轮询服务端状态。
7. `WebPreviewScreen` / `WebEditorServer.start()` / `WebEditorApi.handle()` 入口检查开关，关闭时直接返回；`CaptureHub` 不注册编辑器捕获。
8. `EditorHostApi.isEnabled()` 是「编辑器是否启用」的唯一判定，不用 `WebEditorServer.isRunning()` 代替。开关开启不等于服务启动——服务在进入 WEBUI 模式时按需启动（见 01-04）。

## 验收标准

- 开关关闭：F9 / F7 等编辑器键无响应、不注册；无本地服务；无捕获注册；`editor.*` 消息不被处理。玩家跳过键与普通播放完全不受影响。
- 开关开启：编辑器一切照常。
- 开关只作用于客户端，服务端播放 / 触发逻辑不受影响。
