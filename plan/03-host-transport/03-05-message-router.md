# 03-05 编辑器消息路由（请求 / 回执 / 推送）

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：`README.md`、`03-02-websocket-session-handshake.md`、`03-06-script-resource-registry.md`、`03-08-editor-host-contract.md`

## 1. 职责

冻结编辑器与宿主之间的文本消息契约：信封、消息族、请求/回执配对、事件推送、节流、错误、能力协商。本任务不定义帧流（03-01/03-03）与脚本字段（01/02 轮），只定义「怎么问、怎么答、怎么推」。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 路由入口 | `MOD:webui/WebEditorApi.java:21,31-93` | `public static void handle(String message, WebSocketSession session)` |
| 信封解析 | `WebEditorApi.java:33-39` | `type`/`data`/`id`；`data` 非对象时用空对象；`id` 缺失为空串 |
| 分发 | `WebEditorApi.java:41-88` | switch；未知 type → `sendError` |
| 异常兜底 | `WebEditorApi.java:89-92` | catch Exception，只打日志，不回抛 |
| `hello` | `WebEditorApi.java:95-100` | 回 `hello_ack`，`version="0.3.6"`、`name="ImmersiveCinematics"` |
| 脚本列表 | `WebEditorApi.java:102-109` | `script.list` → `script.list.result{files[]}` |
| 脚本加载 | `WebEditorApi.java:111-123` | `script.load{path}` → `script.loaded{path,doc}`；异常 → error |
| 脚本保存 | `WebEditorApi.java:125-151` | `script.save{path,doc}` → `script.saved{path}`；成功后 `notifyScriptSaved` |
| 保存通知 | `WebEditorApi.java:134-150` | 主线程 `NetworkHandler.sendToServer(C2SScriptSavedPacket(fileName))`；失败忽略 |
| 校验 | `WebEditorApi.java:153-167` | `script.validate{doc}` → `script.validate.result{ok,issues[]}` |
| 注册表查询 | `WebEditorApi.java:169-200` | `registry.query{kind,query,limit}` → `{kind,matches[]}`；`registry.get{kind}` → `{kind,values[]}` |
| 删除/新建 | `WebEditorApi.java:202-219` | `script.delete{path}` → `script.deleted{path}`；`script.new` → `script.new.result{path:"untitled.json",doc}` |
| schema | `WebEditorApi.java:221-230` | `schema.get` → `schema.data{schema}`（`SchemaExporter.exportAll()`） |
| 图数据 | `WebEditorApi.java:232-242` | `script.graph` → `script.graph.result`（全量重扫） |
| 资源列举 | `WebEditorApi.java:244-253` | `resource.list{kind,dir}` → `resource.list.result` |
| seek | `WebEditorApi.java:53-59` | `editor.seek{time}`：`pause()` + `setTime()` + `pushPlaybackState()` + `requestFrame()`；**无回执** |
| play/pause/stop | `WebEditorApi.java:60-74` | 调 `CameraManager` + `pushPlaybackState()`；**无回执** |
| setCamera | `WebEditorApi.java:75-78` | `setCameraDirect` + `requestFrame()`；无回执 |
| previewConfig | `WebEditorApi.java:79,299-311` | 忽略请求字段，回执固定值 + `requestFrame()` |
| pushScript | `WebEditorApi.java:80-84` | `pushScript(json)` + `pushPlaybackState()` + `requestFrame()`；无回执 |
| 飞控进入 | `WebEditorApi.java:85,274-287` | 逐字段解析（缺省 null），`WebPreviewScreen.enterFlightMode` |
| 飞控退出/取消 | `WebEditorApi.java:86-87` | 直接 `WebPreviewScreen.requestFlightExit(true/false)` |
| 播放状态推送 | `WebEditorApi.java:313-323` | `playback.state{time,playing}`；`playing = isEditorPlayback && !isEditorPaused` |
| 错误 | `WebEditorApi.java:325-329` | `error{error}` + 原 `id` |
| 信封包装 | `WebEditorApi.java:331-339` | `id` 非空才写 |
| 文本发送 | `MOD:webui/WebSocketSession.java:106-115` | 入队；队列满可能丢文本并限频告警 |
| 主线程派发 | `WebSocketSession.java:56-84` | 文本 → `Minecraft.getInstance().execute(...)` |
| 播放状态节流 | `MOD:webui/WebPreviewScreen.java:96-101` | 50ms |
| 飞控状态节流 | `WebPreviewScreen.java:104-112` | 100ms |
| 统计节流 | `MOD:webui/PreviewStreamer.java:207-259` | 1000ms，每会话单播 |
| 前端发送 | `ED:store.ts:282-285` | `send(type,data)`；无 id |
| 前端请求 | `store.ts:287-297` | `request(type,data)`；`id` 自增；`pending` map |
| 前端路由 | `store.ts:299-343` | id 匹配 → resolve/reject；否则按 type 处理 |
| 前端推送处理 | `store.ts:307-331` | `playback.state`/`flight.state`/`flight.exit`/`preview.stats` |
| 前端脚本推送节流 | `store.ts:170,522-528` | 160ms 防抖 |
| 前端 seek 节流 | `store.ts:172,467-503` | 16ms + 拖动会话 |

**已核对的缺口**：

1. 当前路由绑定WebSocketSession，03提取WebUI需要的共享边界，未来14落实进程内端点；不要求本轮AUI可运行。
2. **推送目标无抽象且所有权错误**：`pushPlaybackState` 直接 `WebEditorServer.INSTANCE.broadcastText`（`WebEditorApi.java:313-323`）；`PreviewStreamer.tick` 直接 `stream.session.sendText`（`PreviewStreamer.java:207-259`）；`WebPreviewScreen.broadcast` 直接 `WebEditorServer.INSTANCE.broadcastText`（`WebPreviewScreen.java:318-324`），其中 `flight.exit` 也被广播给所有会话。飞控退出携带最终姿态并触发发起窗口写回关键帧，广播给其他窗口会让它们错误写回；它必须定向回发起端点。
3. **命令无回执**：`editor.seek/play/pause/stop/setCamera/pushScript` 都没有 `*.result`/ack；前端只能靠 `playback.state` 推断。seek 失败（无实例）与成功在协议上不可区分。
4. **无 schema 版本/能力位**：`hello_ack` 只有固定 `version`；前端无法判断 schema 是否变化、是否支持 `resource.list` 的 `all` 等。
5. **无 id 的错误不处理**：`handleMessage` 只在 `msg.id` 命中 pending 时 reject；无 id 的 `error` 落入最后的 `listener`（若有）或静默。用户看不到「未知 type」等错误。
6. **大脚本无分片**：`editor.pushScript` 把整份脚本 JSON 作为字符串放在一条文本帧里；`script.save` 同理。WebSocket 单帧上限 64MB（`WebSocketSession.java:174-220`），超大脚本会被断开。
7. **`script.graph` 全量重扫**：每次请求都 `Files.walk` + 逐文件解析（`ScriptGraphService.java:53-90`）；大包慢，且与 `script.list` 重复扫描。
8. **`editor.previewConfig` 双路径**：`request` 回执与 `handleMessage` 的 `editor.previewConfig.result` 兜底同时存在（`store.ts:267-280,333-337`），重复设置但无害；应保留一条。
9. **`script.save` 的 `notifyScriptSaved` 吞异常**（`WebEditorApi.java:134-150`）：服务端登记失败不影响保存，但前端不知道「服务端未收到指纹」，多人同步可能延迟。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 路由依赖 | `WebSocketSession` | `EditorEndpoint`（提案）：`void sendText(String json)`；WebSocket 与进程内各自实现 |
| 推送 | 直接 `broadcastText`/`session.sendText` | `EditorPush`（提案）：`broadcast(String json)`、`sendTo(endpointId, String json)`；由宿主注入。`playback.state`/`flight.state` 可广播；`preview.stats`/`flight.exit` 定向 |
| 命令回执 | 无 | 为 `editor.*` 增加 `editor.ack{op, ok, reason?}`（提案）；关键回执可靠发送，无法送达即明确断开/失败，不能静默丢 |
| 能力协商 | 固定 version | `hello_ack{version, schemaHash, capabilities[]}`（提案） |
| 无 id 错误 | 静默 | 前端把无 id `error` 写入 `state.error` 与状态栏 |
| 大脚本 | 单帧 | 提案：`script.save`/`pushScript` 超过 1MB 时分片（`chunk.begin/chunk.data/chunk.end`）；本轮只记录 |
| 图缓存 | 全量 | 提案：`ScriptIndexService` 版本号 + 增量；见 04 轮 |
| 保存通知 | 吞异常 | 提案：`script.saved` 回执增加 `serverNotified:boolean`，失败可诊断 |

### 3.2 拟新建（提案）

- `MOD:api/editor/EditorEndpoint.java`（提案）
  - `void sendText(String json)` — 发一条文本消息；不得阻塞调用线程。
  - `String endpointId()` — 诊断用（WebSocket 会话 id / 进程内宿主 id）。
- `MOD:api/editor/EditorPush.java`（提案）
  - `void broadcast(String json)` — 向所有编辑器端点推送可合并状态（`playback.state`、`flight.state`）。
  - `void send(String endpointId, String json)` — 定向推送（`preview.stats`、`flight.exit`、命令回执）。
  - 关键文本不可静默丢；`send` 失败必须返回/触发明确错误，不能假装成功。
- `MOD:api/editor/EditorCommandAck.java`（提案）
  - `record Ack(String op, boolean ok, String reason)`；由 `WebEditorApi` 在命令完成后发出；与请求 `id` 同值。
- **不新建**第二套信封/消息名；`EditorEndpoint`/`EditorPush` 只是把现有 `WebSocketSession` 能力抽成接口。

## 4. 输入输出与字段约束

### 4.1 信封

```json
{ "type": "script.load", "data": { "path": "intro/a.json" }, "id": "7" }
```

- `type` 非空；`data` 必须是对象（缺失/非对象按 `{}`）；`id` 可选，字符串。
- 回执：`{type:"<family>.result", data:{...}, id:"7"}`；错误：`{type:"error", data:{error:"..."}, id:"7"}`。
- 推送：无 `id`；`playback.state`、`preview.stats`、`flight.state`、`flight.exit`。其中 `preview.stats` 与 `flight.exit` 只发给所属端点；`playback.state`/`flight.state` 可广播，但不得让非飞控发起端点把 `flight.exit` 当作自己的写回结果。
- 命令回执 `editor.ack` 与 `*.result` 必须可靠发送；若端点不可写，关闭该端点并让客户端明确失败，不得回一张「假成功」。

### 4.2 消息族（现状）

| 请求 | 回执 | 副作用 |
|---|---|---|
| `hello` | `hello_ack{version,name}` | 无 |
| `script.list` | `script.list.result{files[]}` | 无 |
| `script.load{path}` | `script.loaded{path,doc}` | 无 |
| `script.save{path,doc}` | `script.saved{path}` | 写盘 + `C2SScriptSavedPacket` |
| `script.delete{path}` | `script.deleted{path}` | 删文件 |
| `script.new` | `script.new.result{path,doc}` | 无（不落盘） |
| `script.validate{doc}` | `script.validate.result{ok,issues[]}` | 无 |
| `registry.query{kind,query,limit}` | `registry.query.result{kind,matches[]}` | 无 |
| `registry.get{kind}` | `registry.get.result{kind,values[]}` | 无 |
| `schema.get` | `schema.data{schema}` | 无 |
| `script.graph` | `script.graph.result{nodes,edges,folders,warnings}` | 全量扫描 |
| `resource.list{kind,dir}` | `resource.list.result` | 读资源目录 |
| `editor.seek{time}` | 无 | pause + setTime + 推状态 + 补帧 |
| `editor.play/pause/stop` | 无 | CameraManager + 推状态 |
| `editor.setCamera{yaw,pitch,roll,fov,zoom}` | 无 | 直控 + 补帧 |
| `editor.pushScript{script}` | 无 | 解析缓存 + 推状态 + 补帧 |
| `editor.previewConfig{...}` | `editor.previewConfig.result{mode,width,height,fps,keyframeIntervalSeconds,encoder}` | 补帧 |
| `editor.enter_flight_mode{...}` | `editor.ack{op,ok}`（提案） | 进入飞控；飞控会话绑定发起端点 |
| `editor.exit_flight_mode` | `editor.ack{op,ok}`（提案） | 退出并**仅向发起端点**发送 `flight.exit` |
| `editor.cancel_flight_mode` | `editor.ack{op,ok}`（提案） | 取消并**仅向发起端点**发送 `flight.exit{cancelled:true}` |

### 4.3 节流

| 推送 | 周期 | 来源 |
|---|---|---|
| `playback.state` | 50ms | `WebPreviewScreen.render` |
| `flight.state` | 100ms | `WebPreviewScreen.render`（飞控中） |
| `preview.stats` | 1000ms | `PreviewStreamer.tick` |
| 脚本推送 | 160ms 防抖 | 前端 `scheduleScriptPush` |
| seek | 16ms | 前端 `seek` |

约束：节流只影响推送频率，不影响最终状态；最后一次状态必须能到达（若队列拥塞，下一周期补）。

### 4.4 错误

- 未知 type → `error{error:"unknown type: <type>"}` + 原 id。
- 非法 JSON → `handle` 捕获，只打日志；无回执（提案：回 `error` 无 id）。
- 文件不存在/越界 → `error{error:"load failed: ..."}`。
- 校验失败不是错误：`script.validate.result{ok:false,issues[]}`。

## 5. 修改步骤

1. 定义 `EditorEndpoint`/`EditorPush`（提案，写入 03-08），`WebEditorApi.handle` 改为 `handle(String, EditorEndpoint)`；`WebSocketSession` 实现 `EditorEndpoint`。
2. `pushPlaybackState` 改为 `EditorPush.broadcast`；`PreviewStreamer.tick` 改为 `EditorPush.send(endpointId, ...)`；`WebPreviewScreen` 的飞控推送改为 `EditorPush.send(ownerEndpointId, ...)`（`flight.state` 也可只发 owner），不得再用 `broadcastText` 发 `flight.exit`。
3. 为 `editor.*` 增加 ack（提案）：`editor.ack{op, ok, reason?}`；关键回执可靠发送，前端超时只表示「未确认」而不是「成功」。
4. `hello_ack` 增加 `schemaHash`（`SchemaExporter` 输出哈希）与 `capabilities`（`["preview.h264","preview.rgba","resource.all","script.graph","flight"]`）。
5. 前端 `handleMessage` 处理无 id `error`：`state.error = msg.data.error`，状态栏显示。
6. 删除 `editor.previewConfig.result` 的双路径之一（保留 request 回执）。
7. 大脚本分片列为提案，不在本轮实现；`script.save` 超过 1MB 时前端先提示风险。

## 6. 禁止修改

- 不改信封 `{type,data,id}`。
- 不改现有消息名与回执名（新增用提案）。
- 不把 `data` 改成数组/字符串。
- 不在消息里传 token。
- 不用「无回执 + 乐观 UI」冒充命令成功（尤其 seek/save）。
- 不广播 `flight.exit`；只释放本端点拥有的资源（不关闭 `CaptureHub`、不停止其他会话、不取消他人飞控）。
- 不把关键回执降级为可丢状态推送。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `store.ts`（发送/路由/错误）、`Preview.vue`（状态显示） |
| 编辑器 `1.20.1` | 进程内宿主实现 `EditorEndpoint`/`EditorPush`（13-04）；消息名与字段完全一致 |
| 主模组 `main` | `WebEditorApi.java`、`WebSocketSession.java`、`PreviewStreamer.java`、`WebPreviewScreen.java` |

## 8. 前置

- 03-02 的会话与代际守卫。
- 03-06 的脚本/资源/schema 服务。
- 未来14-04进程内端点仅迁移对应，不是本轮前置；本轮以当前WebUI真实消息往返完成。

## 9. 正反例验收

**正例 A**：`hello` → `hello_ack`；`script.list` → 文件表；`script.load` → doc；`script.save` → saved + 服务端登记（看服务端日志）。
**正例 B**：`schema.get` → `schema.data`；`resource.list{kind:"lang"}` → `languages/entries`；`resource.list{kind:"all"}` → 全文件。
**正例 C**：`editor.seek` 后 50ms 内收到 `playback.state{time}`；暂停态画面更新（补帧）。
**正例 D**：`editor.enter_flight_mode` → 100ms 内 `flight.state`；`exit` → 仅发起端点收到 `flight.exit` 带最终参数；另一个窗口不发写回、也不显示「退出成功」。
**正例 E**：`script.validate` 的 `issues` 与 `ScriptValidator` 输出一致（不前端自造）。

**反例 A**：未知 type → `error{error:"unknown type: ..."}`，连接不断。
**反例 B**：非法 JSON → 服务端不崩、无异常抛出；日志有记录（提案：回 error）。
**反例 C**：`script.load` 越界路径 → `error{error:"load failed: invalid script path..."}`。
**反例 D**：请求发出后服务端不回应 → 15s 超时 reject（03-02）。
**反例 E**：无 id 的 `error` → 前端状态栏显示，不静默。
**反例 F**：窗口 B 未进入飞控，却收到 `flight.exit` 并写回关键帧 → 验收不通过；`flight.exit` 必须定向。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + Electron。

1. 依次发全部消息族，核对回执名/字段。
2. 保存一个脚本，确认 `script.saved` 与服务端 `C2SScriptSavedPacket` 日志。
3. 发未知 type/非法 JSON，确认连接不断、错误可见。
4. 发 `editor.seek`，确认 `playback.state` 与画面都更新。
5. 大脚本（>1MB）保存，记录是否触发帧上限（当前预期：可能断开）。

本次未执行；未来03当轮验证WebUI真实请求/回执/错误与所有权，13全量复核，14再迁移进程内端点。

## 11. 完成定义

- 消息族表与现状一一对应，无遗漏、无虚构。
- `EditorEndpoint`/`EditorPush`/ack/能力位作为提案写入 03-08，不在本轮假装已实现。
- 推送所有权明确：`preview.stats`/`flight.exit` 定向所属端点，`playback.state`/`flight.state` 可广播；关键回执可靠或明确失败。
- 无 id 错误、请求超时、大脚本风险三项有明确处理或记录。
- 未执行的真实冒烟明确标注。
