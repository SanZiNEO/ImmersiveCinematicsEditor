# 14-04 进程内端点、推送与会话

> 前置：14-01/02 可开 Screen；14-00 01 合同审计通过
> 后续：14-06 飞控、14-08 垂直切片
> 状态：设计合同；消息往返未执行时不填 PASS

## 1. 职责

把 WebUI 的 WebSocket 信号换成同进程内的端点/推送，但保持同一套消息名、字段、信封与回执语义：

- `EditorEndpoint`：AUI 端点的身份与发送；
- `EditorPush`：向端点定向/广播状态；
- `EditorSessionApi`：attach/detach/handle；
- `EditorCommandAck`：关键命令的成功/失败回执；
- 能力位/schemaHash：附着时直接读宿主，不模拟 socket 握手。

不新增消息类型，不新增第二套字段，不把 AUI 做成另一个“服务端”。

## 2. 当前事实

### 2.1 现有 WebUI 通路

- `WebEditorApi.handle` 绑定 `WebSocketSession`；`WebSocketSession` 包私有。
- 推送分散在 `WebEditorApi`/`PreviewStreamer`/`WebPreviewScreen`，没有统一的 `EditorPush`。
- `hello_ack` 当前没有 schemaHash/能力位。
- `editor.*` 没有统一 ack；关键命令失败可能是超时/静默。
- `script.validate`/`schema.get`/`editor.pushScript`/`editor.seek`/`editor.play`/飞控等由同一路由处理（`script.list/load/save` 是编辑器直读工作区，不经该路由）。
- 节流：`playback.state` 50ms、`flight.state` 100ms、`preview.stats` 1000ms（以现有实现为准）。

### 2.2 AUI 侧

- AUI Screen 打开后可以拿到 `Document`/元素，但没有进程内端点。
- AUI 页面不跑 Vue/JS；控制器通过 Java 侧事件与消息桥交互。
- 当前没有 `EditorEndpoint` 实现；没有 `EditorPush`；没有 `EditorSessionApi`。
- `WebEditorServer`/8765 在 ingame 模式不应启动。

## 3. 方案

### 3.1 端点模型

```text
AuiEndpoint implements EditorEndpoint
  endpointId            // Screen 会话唯一 id
  sendState(json)       // 状态/非关键消息，可丢/可合并
  sendCritical(json)    // 关键消息，返回 false 即明确失败
  isOpen()              // Screen/端点存活

AuiPush implements EditorPush
  broadcast(json)
  send(endpointId, json)
  endpoints()           // 当前端点快照
```

- 一个 AUI Screen 一个端点；关闭只 detach 本端点。
- 端点不持有服务、不持有 `CaptureHub`、不持有 Document 生命周期。
- `sendState` 不阻塞渲染线程；队列满/端点关闭时丢弃并计数，不静默成功。
- `sendCritical` 必须返回布尔；失败时 AUI 显示错误/重试提示，不假装成功。
- `endpointId` 不暴露给用户界面；日志中可脱敏。

### 3.2 会话

```text
EditorSessionApi.attach(endpoint) -> hello/能力/schema
EditorSessionApi.handle(endpoint, requestJson) -> 路由到现有服务
EditorSessionApi.detach(endpoint, reason) -> 只清本端点
```

约束：

- `attach` 幂等：重复 attach 同一端点不创建第二份状态。
- `detach` 幂等：重复 detach 不抛错、不影响其他端点。
- `handle` 在同一主线程/服务线程执行；不得在渲染线程做文件 IO。
- 请求/响应信封保持 `{type,data,id?}`；`id` 原样回传。
- `hello`/`hello_ack` 在进程内可以走同一信封；`hello_ack` 带 `schemaHash`、`capabilities`；传输类型用 capability `editor.transport.inprocess` 表达，不新增 `transport` 字段。
- `script.*`/`editor.*`/`flight.*` 沿用现有名称与字段；不新增“AUI 专用”变体。
- 未知消息返回明确错误；不静默忽略。

### 3.3 推送

| 消息 | 节流 | 说明 |
|---|---|---|
| `playback.state` | 50ms | 播放头/播放状态；AUI 状态栏与时间轴 |
| `flight.state` | 100ms | 飞控姿态；只发 owner 或订阅端点 |
| `preview.stats` | 1000ms | 捕获 fps/丢帧/格式；AUI 不伪造 |
| `editor.ack` | 每请求 | 关键命令回执 |
| `flight.exit` | 事件 | 只发 owner；不广播 |

- `EditorPush.broadcast` 用于非定向状态（如全局 schema 变化）；飞控退出必须 `send(owner)`。
- 推送不得在渲染线程做 JSON 大对象序列化；可预序列化/队列。
- 端点关闭后推送丢弃并计数；不向已关闭端点写。
- 能力位只报告真实可用能力：`editor.transport.inprocess`、`preview.gpu`（14-03 通过后）等；未通过不宣告。

### 3.4 与 WebUI 的关系

- WebUI 仍使用 WebSocket；14 不改其消息语义。
- AUI 与 WebUI 共用同一 `EditorSessionApi` 路由与同一套服务；差异只在端点实现。
- ingame 模式不启动 8765、不创建 `WebEditorServer`；`F6` 打开 AUI 时也不启动。
- 关闭 AUI 不 stop WebUI 服务；关闭 WebUI 不影响 AUI 端点。
- 总开关关闭：两模式都不可 attach；已有端点 detach。

### 3.5 错误与回执

| 场景 | 行为 |
|---|---|
| 端点已关闭 | `sendCritical=false`；不排入无限队列 |
| 请求处理异常 | `editor.ack{ok:false,reason}`；日志限频 |
| 未知 type | `editor.ack{ok:false,reason:"unknown-type"}` |
| schema 不匹配 | `hello_ack` 带 hash；AUI 提示重新加载 |
| 关键消息队列满 | 失败并关闭端点/提示；不静默丢 |
| 重复请求 id | 返回同一结果或明确 duplicate；不产生两次写 |

## 4. 输入输出

### 4.1 输入

- 01 `api/editor` 7 接口与 `EditorCommandAck`。
- 现有 `WebEditorApi` 消息路由与服务实现（作为语义对照）。
- AUI Screen 的端点生命周期。
- schemaHash/能力位。

### 4.2 输出

- `AuiEndpoint`/`AuiPush`/`AuiSession` 可用。
- 同一套消息往返：`schema.get`、`script.validate`、`editor.seek/play/pause/stop`、飞控。脚本文件由编辑器直接读写工作区，两条通路都不经过它。
- 关键命令 ack 可区分成功/失败。
- 能力位/schemaHash 真实可用。
- 无 8765、无 WebSocket、无本地回环。

### 4.3 禁止

- 新增第二套消息名/字段/信封。
- 为了让 AUI 跑起来而启动 `WebEditorServer` 或连接 localhost。
- `EditorPush.broadcast` 发 `flight.exit`。
- `sendCritical` 失败被吞。
- 端点关闭时停止共享服务/关闭 `CaptureHub`。
- 用 WebUI 的 WebSocket 测试代替进程内测试。

## 5. 验收

### 5.1 正例

**正例 A**：AUI 打开 → `attach` → `hello_ack` 带 schemaHash/capabilities；无 8765 监听。

**正例 B**：`schema.get` 返回与 WebUI 相同的字段/结构；AUI 不额外转换字段名。脚本文件由编辑器直接读工作区，不经端点。

**正例 C**：`editor.seek`/`play`/`pause`/`stop` 返回 ack；失败有 reason；AUI 状态栏显示。

**正例 D**：编辑器直写工作区文件成功；磁盘文件可见；重开 AUI 再读一致。

**正例 E**：`flight.state` 100ms 节流；`playback.state` 50ms；AUI 不因高频推送卡死。

**正例 F**：关闭 AUI → 端点 detach；其他端点/服务不受影响；重复 detach 无异常。

**正例 G**：重复 attach 同一端点不产生第二份状态；未知 type 有明确错误。

**正例 H**：`sendCritical` 在端点关闭后返回 false；AUI 显示失败，不假装保存成功。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| AUI 启 8765 再连自己 | 失败：不是进程内 |
| AUI 新造 `aui.script.save` 等消息名 | 失败：语义分叉 |
| `flight.exit` 广播 | 失败：非 owner 误写回 |
| 保存失败无 ack、UI 显示成功 | 失败：伪造结果 |
| 关闭端点调 `WebEditorServer.stop` | 失败：影响 WebUI |
| 关闭端点调 `CaptureHub.close` | 失败：关闭捕获中心 |
| 每帧全量广播文档 | 失败：性能/语义错误 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| attach/hello | NOT RUN | 待执行 |
| schema/script 往返 | NOT RUN | 待执行 |
| playback ack | NOT RUN | 待执行 |
| save/validate ack | NOT RUN | 待执行 |
| 推送节流 | NOT RUN | 待执行 |
| detach/多端点 | NOT RUN | 待执行 |
