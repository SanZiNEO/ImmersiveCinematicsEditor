# 01-05 消息路由抽象与信号定向

## 目标

把消息路由从「绑 WebSocketSession」改成「方向无关的 EditorEndpoint / EditorPush」，并补上飞控退出定向、命令回执、能力协商、关键文本可靠、错误处理与双路径清理。

## 改动

1. `WebEditorApi.handle(String, WebSocketSession)` 改为 `handle(String, EditorEndpoint)`；`WebSocketSession` 实现 `EditorEndpoint`。
2. `pushPlaybackState()` 的 `WebEditorServer.broadcastText` 改为 `EditorPush.broadcast`；`PreviewStreamer.tick` 的 `session.sendText` 改为 `EditorPush.send`。
3. `flight.state` 只发飞控发起端点；`flight.exit` 用 `EditorPush.send(ownerEndpointId, ...)`，退出带最终参数 + 相对模式基准点。
4. `editor.seek / play / pause / stop / setCamera / pushScript / enter_flight_mode / exit_flight_mode / cancel_flight_mode` 增加 `editor.ack{op, ok, reason?}`，关键回执用 `EditorEndpoint.sendCritical` 可靠发送或明确失败。
5. `hello_ack` 增加 `capabilities[]`（`preview.h264` / `preview.rgba` / `resource.all` / `script.graph` / `flight`）与 `schemaHash`。
6. 无 id 的 `error`：前端写入 `state.error` 并显示在状态栏，不静默。
7. `script.saved` 回执增加 `serverNotified:boolean`，服务端登记失败可诊断。
8. 删除 `editor.previewConfig` 的双路径之一，保留 request 回执。

## 验收标准

- `flight.exit` 只到达发起端点，另一个窗口不写回关键帧。
- `editor.seek` 后有 `editor.ack`，seek 失败与成功可区分。
- `hello_ack` 含 capabilities 与 schemaHash。
- 关键回执（`script.saved` / `flight.exit` / `editor.ack`）不可静默丢。
- 无 id 错误前端可见，不静默。
- 信封 `{type, data, id}` 与所有消息名不变。
