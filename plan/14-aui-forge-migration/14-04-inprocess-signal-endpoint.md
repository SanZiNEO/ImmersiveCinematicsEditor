# 14-04 进程内信号端点（与 WebUI 同语义）

> 状态：未实现（仅计划；主模组消息路由仍绑定 `WebSocketSession`）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-02 的 Screen 生命周期可用；03-08 §3.1–3.3 合同已冻结
> 关联：`README.md`、`14-02-aui-host-screen.md`、`14-03-inprocess-frame-source.md`、`14-06-flight-mode-inprocess.md`、`14-07-teardown-carrier-consistency.md`、`../03-host-transport/03-05-message-router.md`、`../03-host-transport/03-08-editor-host-contract.md`（§3.1–3.3）、`../03-host-transport/03-10-editor-package-lifecycle.md`

## 1. 职责

把游戏内宿主的信号通道从合同变成真实实现：编辑器实现 `EditorEndpoint`（进程内），主模组 `EditorSessionApi.handle` 复用同一个消息路由；推送由 `EditorPush` 发给端点；消息名/字段/节流与 WebUI 完全一致。本任务不实现画面（14-03）、输入（14-05）、飞控逻辑（14-06），只定义「怎么问、怎么答、怎么推、怎么保证关键回执不丢」。

**与 03 的关系**：03-05/03-08 冻结消息族、`EditorEndpoint`/`EditorPush`/`EditorSessionApi` 合同与所有权；03 的 WebUI 出口只验证 WebSocket 链路。**进程内端点、推送实现、ack、能力位由 14 交付**；不得要求 03 在 WebUI 阶段先实现 ingame 端点，也不得用包私有 `WebSocketSession` 走捷径。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 路由入口 | `J:webui/WebEditorApi.java:21,31-93` | `handle(String, WebSocketSession)`；包私有参数 |
| 消息族 | `WebEditorApi.java:41-88` | 见 03-05 表 |
| hello | `WebEditorApi.java:95-100` | `hello_ack{version,name}` |
| 脚本服务 | `WebEditorApi.java:102-253` | `script.*`、`registry.*`、`schema.get`、`script.graph`、`resource.list` |
| 播放控制 | `WebEditorApi.java:53-84` | `editor.seek/play/pause/stop/setCamera/pushScript` |
| 预览配置 | `WebEditorApi.java:79,299-311` | 固定 1080p60 |
| 飞控 | `WebEditorApi.java:85-87,274-287` | 进入/退出/取消 |
| 播放状态推送 | `WebEditorApi.java:313-323` | `playback.state{time,playing}`；50ms（`WebPreviewScreen.java:96-101`） |
| 错误 | `WebEditorApi.java:325-329` | `error{error}` |
| 信封包装 | `WebEditorApi.java:331-339` | `{type,data,id?}` |
| 会话发送 | `J:webui/WebSocketSession.java:106-115` | `sendText` 入队 |
| 广播 | `J:webui/WebEditorServer.java:370-374` | `broadcastText` |
| 统计推送 | `J:webui/PreviewStreamer.java:207-259` | 每会话 `preview.stats`；1000ms |
| 飞控推送 | `J:webui/WebPreviewScreen.java:279-324` | `flight.state` 100ms、`flight.exit` |
| 前端发送 | `ED:store.ts:282-285` | `send` |
| 前端请求 | `store.ts:287-297` | `request` + pending |
| 前端推送路由 | `store.ts:299-343` | `playback.state`/`flight.*`/`preview.stats` |
| 公共合同 | `../03-host-transport/03-08-editor-host-contract.md` §3.1–3.3 | `EditorEndpoint`/`EditorPush`/`EditorSessionApi` |
| 会话/队列分级 | `../03-host-transport/03-02-websocket-session-handshake.md` §4.2 | 关键文本不静默丢；状态可合并/丢旧 |
| 总开关/所有权 | `../03-host-transport/03-10-editor-package-lifecycle.md` §4.1–4.4 | 端点级 detach；关键回执可靠 |
| 目标包职责 | `../shared/editor-package-modes.md` §4.1a | `editor.service.EditorMessageRouter`；`editor.ingame` 适配 |

**已核对的缺口**：

1. **`WebEditorApi.handle` 不可复用**：参数 `WebSocketSession` 包私有（`WebSocketSession.java:23`），游戏内宿主无法调用。
2. **推送目标硬编码**：`pushPlaybackState` → `WebEditorServer.INSTANCE.broadcastText`；`PreviewStreamer.tick` → `session.sendText`；`WebPreviewScreen.broadcast` → `broadcastText`。进程内宿主没有这些对象。
3. **无进程内端点生命周期**：没有 `EditorSessionApi.attach/detach` 的 ingame 实现；编辑器 Screen 打开/关闭时无法注册/注销。
4. **无 ack**：`editor.*` 命令无回执；进程内宿主无法知道 `seek/play/save/validate` 是否成功。
5. **`hello_ack` 无能力位**：进程内宿主与 WebUI 能力不同（无 H.264、有 GPU 帧源），需要 `capabilities` 区分。
6. **`preview.stats` 字段是编码流语义**：`sent/dropped/inputDropped/encoderDropped` 对进程内画面不适用；需要同名字段但语义映射（例如 `sent` = 交付帧数，`dropped` = 丢帧，`encoder` = `gpu`）。
7. **节流状态在 `WebPreviewScreen` 实例字段**（`lastPlaybackStateBroadcast/lastFlightStateBroadcast`，`WebPreviewScreen.java:46-48`）；进程内宿主需要自己的节流状态。
8. **线程**：WebSocket 文本在主线程执行（`WebSocketSession.java:56-84`）；进程内宿主必须同样切主线程，不能在 UI 事件回调里直接改播放器。
9. **关键文本可被静默丢弃**：`OutboundQueue.enqueueText`/`WebSocketSession.sendText` 现状需要分级（03-08 G13）；ingame 端点必须实现 `sendState` vs `sendCritical`。
10. **没有 `EditorPush` 的 ingame 实现**：谁持有端点表、谁按 owner 定向、谁在 detach 后停止推送，均未定义。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 路由参数 | `WebSocketSession` | `EditorEndpoint`（03-08 §3.1） |
| 推送 | `broadcastText`/`session.sendText` | `EditorPush`（03-08 §3.2）；ingame 端点表 |
| 端点生命周期 | 无 | `EditorSessionApi.attach/detach`（03-08 §3.3）；ingame 实现 |
| ack | 无 | `editor.ack{op,ok,reason?}`（提案；关键命令） |
| 能力 | 固定 version | `hello_ack{version,schemaHash,capabilities[]}` |
| 统计 | 编码流字段 | 同名字段 + `encoder="gpu"`；`sent/dropped` 映射到帧交付 |
| 节流 | Screen 实例字段 | 宿主自己的节流器；50/100/1000ms |
| 线程 | 主线程 | 同；UI 事件只记意图，tick 派发 |
| 关键回执 | 可被队列丢弃 | `sendCritical` 可靠入队或明确失败；失败即 detach/断开，不假成功 |
| 端点所有权 | 无 | 端点 id 稳定；detach 只释放本端点；不停止服务/不关其他端点 |

### 3.2 拟新建（提案）

- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/InProcessEditorEndpoint.java`（提案）
  - `implements EditorEndpoint`
  - `endpointId()`：`"ingame-" + UUID`（Screen 生命周期内稳定）
  - `sendState(String json)`：非阻塞；队列满时丢弃最旧同类状态并计数；不反压主线程
  - `sendCritical(String json)`：可靠入队；队列不可写/端点关闭返回 `false`
  - `isOpen()`：Screen 是否仍打开且未 detach
  - 接收方在主线程消费；不在 UI 事件回调直接改播放器
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorSignalBridge.java`（提案）
  - attach/detach；请求 id/pending/超时（15s）；推送分发；节流；错误显示
  - 不直接读写文件/脚本；所有操作经 `EditorSessionApi.handle`
  - 关键请求（save/validate/enter/exit flight）必须等待 ack 或明确超时
- `MOD:editor/ingame/IngameEditorAdapter.java`（提案）
  - 主模组侧 ingame 适配：校验 `EditorHostApi.isEnabled()/modes()`；把 `EditorSessionApi` 接到共享 `EditorMessageRouter`；持有端点表
- `MOD:editor/ingame/IngameEditorPush.java`（提案）
  - `implements EditorPush`：`broadcast` 只发可合并状态；`send(endpointId,...)` 用于关键文本/`preview.stats`/`flight.exit`；`endpoints()` 返回当前端点
  - 端点关闭/不存在时 `send` 返回 false；调用方据此明确失败
- **不新建**第二套消息名/信封；不把 JSON 解析成另一套 DTO（除 UI 需要的最小字段）。

## 4. 输入输出与字段约束

### 4.1 端点

| 方法 | 约束 |
|---|---|
| `endpointId()` | 非空、Screen 生命周期内稳定；不复用旧 id |
| `sendState(json)` | 非阻塞；队列满时丢弃最旧同类状态并计数（不反压主线程）；不抛异常 |
| `sendCritical(json)` | 命令回执/错误/`flight.exit` 用；可靠入队，队列不可写时返回 false → detach 并让 UI 明确失败；绝不静默丢 |
| `isOpen()` | Screen 关闭后 false；`detach` 后不再发送 |

### 4.2 消息

- 与 03-05 的表完全一致；进程内不新增消息。
- `hello` 回执增加 `capabilities`：`["preview.gpu","resource.lang","resource.video","script.graph","flight","editor.ack"]`（提案；只报告实际已实现能力，未完成不得提前宣告）。
- `schemaHash`：来自 `EditorHostApi.schemaHash()`；与 WebUI 一致。
- `preview.stats`：`encoder="gpu"`；`sent` = 交付给 UI 的帧数；`dropped` = 未消费/被覆盖的帧数；`width/height` = 纹理尺寸；`fps` = 捕获帧率；`inputDropped/encoderDropped` 可为 0（保留字段以兼容）；增加 `captured/frameId`（按 03-08 G10）。
- `playback.state`/`flight.state`/`flight.exit`：字段与 WebUI 一致。
- `editor.ack{op,ok,reason?}`：关键命令回执；`op` 与请求 type 对应；失败必须带原因。无 ack 的命令（如纯状态查询）以原回执为准。

### 4.3 节流

| 推送 | 周期 | 说明 |
|---|---|---|
| `playback.state` | 50ms | 与 WebUI 一致 |
| `flight.state` | 100ms | 飞控中；只发 owner（或按 03-08 允许的广播策略，但 `flight.exit` 绝不广播） |
| `preview.stats` | 1000ms | 与 WebUI 一致 |
| 脚本推送 | 160ms 防抖 | 编辑器侧 |
| seek | 16ms | 编辑器侧 |

约束：节流不改变最终状态；最后一次必须到达（可合并状态也要有最终值）。

### 4.4 线程

- UI 事件（点击/输入）只记录意图（例如 `pendingSeek=1.2`），在客户端 tick 派发。
- `EditorSessionApi.handle` 内部切主线程（与 WebSocket 一致）；编辑器不得在渲染线程做文件 IO/脚本解析。
- `sendText` 的接收方（UI 桥）在主线程消费。
- 端点 `attach/detach` 与 Screen 生命周期同线程；不在渲染回调里 detach。

### 4.5 错误

| 场景 | 行为 |
|---|---|
| 未知 type | `error{error:"unknown type: ..."}` |
| 非法 JSON | 主模组记录日志；提案回 `error`（无 id） |
| 请求超时 | 编辑器 15s 后 reject，显示「命令未确认」 |
| 端点关闭 | `sendState` 丢弃；`sendCritical` 返回 false；`detach` 后不再收到推送 |
| 队列满（关键） | `sendCritical=false` → detach + UI 明确断开；不假设成功 |
| 队列满（状态） | 丢最旧同类；计数进 `preview.stats.dropped` |
| 总开关关闭 | 不再 attach；已有端点 detach；未 attach 的请求直接拒绝 |

## 5. 修改步骤

1. 主模组落地/确认 `EditorEndpoint`/`EditorPush`/`EditorSessionApi`（03-08）；`WebEditorApi.handle` 改签名；`WebSocketSession implements EditorEndpoint`（WebUI 回归）。
2. `PreviewStreamer`/`WebPreviewScreen`/`WebEditorApi` 的推送改走 `EditorPush`（WebUI 侧回归，不在 14 重做）。
3. 主模组实现 `IngameEditorAdapter`/`IngameEditorPush`：端点表、attach/detach、owner 定向、enabled/modes 门禁。
4. 编辑器实现 `InProcessEditorEndpoint`/`EditorSignalBridge`。
5. 在 `EditorAuiScreen.init()` attach；`EditorTeardown` detach。
6. 页面/Java 桥接：把请求结果映射到 UI（AUI DOM 更新）；不引入第二套模型。
7. 增加 ack 与超时；关键命令必须等 ack；错误显示在状态栏。
8. 14-08 验证消息字段与 WebUI 一致、关键回执不丢；14-09 验证各面板的请求/推送。

## 6. 禁止修改

- 不改消息名/字段/信封。
- 不在进程内直接调 `ScriptFileService`/`ScriptParser`（必须经 `EditorSessionApi.handle`）。
- 不绕过 `EditorPush` 直接 `broadcastText`。
- 不在 UI 事件回调里同步执行播放控制/文件 IO。
- 不把 AUI 的 `Document`/`Element` 类型放进 `api/editor`。
- 不用 `sendState` 发关键回执；不用 `sendCritical` 发高频状态。
- 不在端点关闭后继续推送/假装入队成功。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `InProcessEditorEndpoint`/`EditorSignalBridge`、Screen attach/detach |
| 编辑器 `webui` | 不承载；WebSocket 端点由主模组提供（03-02/03-05） |
| 主模组 `main` | `api/editor`、`editor.service.EditorMessageRouter`、`editor.ingame.IngameEditorAdapter/Push`、`WebEditorApi` 改签名 |

## 8. 前置

- 03-08 的 `EditorEndpoint`/`EditorPush`/`EditorSessionApi` 合同。
- 14-02 的 Screen 生命周期（attach/detach 时机）。
- 14-06 的飞控（`flight.*` 推送/owner）。
- 14-07 的 teardown（detach/失败清理）。
- 03-10 的总开关/端点所有权。

## 9. 正反例验收

**正例 A**：Screen 打开 → attach → `hello` → `hello_ack{capabilities}`；关闭 → detach → 不再收到推送。
**正例 B**：`script.list/load/save/validate`、`schema.get`、`resource.list`、`script.graph` 的回执与 WebUI 完全一致（字段/类型）。
**正例 C**：`editor.pushScript` + `editor.seek` → `playback.state` 50ms；画面更新；ack 成功。
**正例 D**：`editor.play/pause/stop` → 状态回推；无 ack 时 15s 超时提示（提案）。
**正例 E**：`preview.stats` 每秒一条，`encoder="gpu"`，`sent/dropped` 与 UI 消费一致。
**正例 F**：关键队列满/端点关闭 → `sendCritical=false` → UI 显示断开/失败；不假成功。
**正例 G**：同时开 WebUI 与 ingame → 各自端点独立；关闭 ingame 不影响 WebUI 会话。

**反例 A**：在 UI 点击回调里直接调 `CameraManager.pushScript` → 违反「只记意图、tick 派发」；验收不通过。
**反例 B**：进程内直接 `Files.readString` 读脚本 → 绕过主模组权威；验收不通过。
**反例 C**：端点关闭后仍发送 → 丢弃/计数，不抛异常（状态）；关键应失败，不静默。
**反例 D**：消息名与 WebUI 不一致（例如 `script.get`）→ 验收不通过。
**反例 E**：`preview.stats` 用编码流语义（`encoder="h264"`）→ 误导；进程内应为 `gpu`。
**反例 F**：`sendCritical` 队列满仍返回 true/静默丢 → 验收不通过。
**反例 G**：通过 `WebSocketSession` 包私有类型调用 `handle` → 验收不通过。
**反例 H**：把 03 未实现 ingame 端点当作 14 阻塞 → 不通过；14 负责实现。

## 10. 真实游戏冒烟（未执行）

前置：主模组 `api/editor` + ingame 端点/推送落地 + Forge 1.20.1 dev run + AUI 页面。

1. 打开编辑器，确认 `hello_ack` 与能力位。
2. 依次发消息族，核对回执字段与 WebUI 一致。
3. 播放/暂停/seek，确认 `playback.state` 与画面同步。
4. 关闭/重开，确认 attach/detach 与无残留推送。
5. 注入关键队列满/断连，确认 `sendCritical=false` 与 UI 失败提示。
6. 同时开 WebUI，确认两端点互不影响。

**本轮未执行**：主模组合同未落地，无 Forge 运行环境；以上为 14-08 统一冒烟的一部分。

## 11. 完成定义

- 进程内端点/推送/桥接真实落地；消息族与 WebUI 一一对应。
- `sendState`/`sendCritical` 分级、节流、线程、超时、错误五项有正反例。
- `preview.stats` 的 `gpu` 语义与字段映射明确，不冒充编码流。
- 关键回执可靠或明确失败；端点关闭不静默成功。
- 端点级 detach 只释放本端点；不停止服务/不关其他端点。
- 本任务是 14 交付，不要求 03 在 WebUI 阶段先实现 ingame 端点；也不以合同存在当作已实现。
- 未执行的真实冒烟明确标注。
