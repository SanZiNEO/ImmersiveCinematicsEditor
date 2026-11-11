# 03-02 WebSocket 会话与握手（Origin + token）

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：`README.md`、`03-05-message-router.md`、`03-07-host-teardown.md`、`MOD:plans/0.3.6/Z-editor/security.md`

## 1. 职责

冻结「编辑器如何被允许连上游戏」与「一条连接从升级到断开的生命周期」：Origin 白名单、每次启动轮换的 token、单端口单例、多客户端会话表、每会话出站队列与发送线程、断线重连。本任务不定义消息内容（03-05）与预览编码（03-03）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 端口/单例 | `MOD:webui/WebEditorServer.java:49,73` | `DEFAULT_PORT=8765`；`INSTANCE` 进程内单例 |
| 绑定 | `WebEditorServer.java:100-120` | `new ServerSocket(8765, 4, InetAddress.getByName("127.0.0.1"))`；失败返回 false，不抛 |
| 运行态查询 | `WebEditorServer.java:86-95` | `isRunning()`、`hasClients()` |
| 启动 token | `WebEditorServer.java:100-120` | `generateToken()` 32 字节 → 64 位十六进制；`writeTokenFile` |
| 停止 | `WebEditorServer.java:122-145` | 关 socket、关闭全部会话、清表、interrupt accept 线程、`token=null`、删除 token 文件 |
| token 路径 | `WebEditorServer.java:147-153` | `IC_WEBUI_TOKEN_FILE` 优先，否则 `<user.home>/.immersivecinematics/webui-token` |
| token 生成/写入/删除 | `WebEditorServer.java:155-182` | `SecureRandom`；`Files.writeString`；`deleteIfExists` |
| 常量时间比对 | `WebEditorServer.java:184-196` | `MessageDigest.isEqual`；token 为 null/空直接 false |
| Origin 白名单 | `WebEditorServer.java:198-211` | 放行无 Origin、`null`、`file://`、`http(s)://localhost|127.0.0.1|::1[:port]`；其余 false |
| 拒绝 | `WebEditorServer.java:213-224` | 403 + 关连接 + 日志 `[IC-WebUI] rejected <addr>: <原因>` |
| accept | `WebEditorServer.java:226-240` | 每连接一个 daemon 线程 `IC-WebUIClient` |
| 请求解析 | `WebEditorServer.java:242-283` | `setSoTimeout(5000)`；读请求行与 headers；`/` 返回静态页；`/ws` 先 Origin 再 token；否则 404 |
| 路径/参数 | `WebEditorServer.java:285-332` | `parsePath` 剥离 query；`parseQueryParam` URL decode |
| 升级 | `WebEditorServer.java:334-357` | 校验 `sec-websocket-key`；101；`setSoTimeout(0)`；创建 `WebSocketSession`；登记；`PreviewStreamer.onSessionOpened`；启动读线程 |
| 会话表 | `WebEditorServer.java:359-372` | `removeSession`、`sessions()` 返回 `List.copyOf`、`broadcastText` |
| 会话类可见性 | `MOD:webui/WebSocketSession.java:23` | `class WebSocketSession`（**包私有**） |
| 每会话队列 | `WebSocketSession.java:34`、`MOD:webui/OutboundQueue.java:28` | 容量 16；帧可丢、文本优先 |
| 读线程 | `WebSocketSession.java:56-84` | 文本 → `Minecraft.getInstance().execute(() -> WebEditorApi.handle(text, this))`；ping → pong；close → 关闭 |
| 发送线程 | `WebSocketSession.java:86-99` | 单线程 `IC-WSSender`；`queue.poll()` 阻塞等待 |
| 入队 | `WebSocketSession.java:101-115` | `enqueueFrame` 非阻塞；`sendText` 队列满时可能丢文本并限频告警 |
| 写帧 | `WebSocketSession.java:143-172` | 0x81 文本 / 0x82 二进制；长度 ≤125 / ≤65535 / 64 位；写失败即 close |
| 读帧 | `WebSocketSession.java:174-220` | 支持掩码；单帧上限 64MB；超过抛 IOException |
| 关闭 | `WebSocketSession.java:127-141` | `compareAndSet` 幂等；关队列、关 socket、从服务端移除 |
| 前端地址 | `ED:store.ts:20` | 硬编码 `ws://127.0.0.1:8765/ws` |
| 前端 token | `store.ts:30-35` | Electron 走 `window.electronWindow.getWebuiToken()`；浏览器 dev 走 `?token=` |
| 前端连接 | `store.ts:185-251` | `connect()`、`binaryType='arraybuffer'`、`onopen/onmessage/onclose/onerror`；断线 1.5s 重连 |
| 前端请求 | `store.ts:287-297` | `pending` map + `id`；断线时全部 reject |
| 前端帧回调 | `store.ts:253-259` | 单 `frameListener`；`onFrame` 返回清理函数 |
| Electron token 读取 | `EDE:main.cjs:8-20` | 路径算法与 Java 一致（认 `IC_WEBUI_TOKEN_FILE`）；`readFileSync` |
| preload 暴露 | `EDE:preload.cjs:3-10` | `getWebuiToken: () => ipcRenderer.sendSync('webui:token')` |
| 类型声明 | `ED:electron-bridge.d.ts:4-13` | `electronWindow?` 可选；`getWebuiToken(): string` |

**已核对的缺口**：

1. **重连代际未隔离**：`connect()` 每次新建 `ws` 并覆盖模块变量；旧 socket 的 `onclose` 仍会执行 `state.connected=false` 并调度新的重连（`store.ts:229-241`），可能把刚建立的新连接状态打掉。旧 socket 在关闭前收到的二进制帧也会进入同一个 `frameListener`（`store.ts:219-227`），造成旧会话帧混入新会话。
2. **多客户端控制语义未定义**：服务端支持多会话（`sessions`），`playback.state` 广播（`WebEditorApi.java:313-323`），但 `editor.play/pause/seek` 任一客户端都能改同一播放器。两个编辑器窗口同时操作会互相覆盖，当前没有提示或主控选举。
3. **关键文本可能被丢**：`OutboundQueue.enqueueText` 在队列满且无帧可丢时丢最旧文本（`OutboundQueue.java` 的 `enqueueText`），`WebSocketSession.sendText` 只限频告警（`WebSocketSession.java:106-115`）。`error` 回执、`*.result` 与 `flight.exit` 都可能被丢；前端依赖下一次周期推送恢复，但命令结果丢失会让请求方一直 pending 到超时。
4. **token 文件权限未设置**：`writeTokenFile` 只写内容（`WebEditorServer.java:161-173`），未限制文件权限；Windows 下依赖用户目录 ACL。任何能读该文件的本地程序都能连。
5. **`file://` 在 Origin 白名单**：这是 Electron 打包态必需，但也意味着「本地任意 HTML 文件」可发起连接；第二道 token 是唯一防线。
6. **端口占用无 UI 回执**：`start()` 返回 false，`WebPreviewScreen.init()` 忽略返回值（`MOD:webui/WebPreviewScreen.java:56-60`），屏幕打开但服务未起。
7. **无心跳/无请求超时**：服务端只回 pong，不主动 ping；前端 `request()` 没有超时，断线时才 reject。
8. **`sessions()` 暴露包私有元素类型**：`List<WebSocketSession>` 在包外不可用（`WebEditorServer.java:365-368`），进一步说明需要 `api/editor` 端口。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 连接代际 | 无守卫 | 前端 `socketGeneration`：每个回调先判 `socket === ws`；旧帧丢弃并计数 |
| 请求超时 | 无 | `request()` 增加 15s 超时；超时 reject 并从 `pending` 删除 |
| 多客户端 | 都可控制 | 明确「所有连接都可控制；同时操作不保证顺序」；UI 显示连接数；不在本轮做选举 |
| 文本优先级 | 帧优先，文本也可能丢 | 分两级：`playback.state`/`flight.state`/`preview.stats` 可合并可丢旧；`error`/`*.result`/`editor.ack`/`flight.exit` 关键文本绝不静默丢，无法入队则关闭会话并让请求明确失败 |
| token 权限 | 未设置 | 写入后尽力设置用户只读（POSIX `600`；Windows 记录为未实现） |
| 端口占用 | 静默失败 | `start()` 失败时屏幕内提示「端口被占用」，不显示「已连接」 |
| 心跳 | 无 | 提案：30s ping / 10s pong 超时；本轮只记录，不实现 |
| 能力协商 | 无 | `hello_ack` 带 `capabilities` 与 `schemaVersion`（见 03-05） |

### 3.2 拟新建/修改（提案）

- `ED:store.ts`（修改）
  - 新增 `let socketGeneration = 0`；`connect()` 内 `const generation = ++socketGeneration`；`onopen/onmessage/onclose/onerror` 首行 `if (generation !== socketGeneration) return`。
  - `request()` 增加 `timeoutMs = 15000`，超时 reject `new Error('request timeout: ' + type)` 并 `pending.delete(id)`。
  - `handleMessage` 对 `preview.stats`/`playback.state` 的迟到帧按 generation 丢弃（帧回调已由 generation 守卫）。
- `MOD:webui/WebEditorServer.java`（提案，本轮不改）
  - `writeTokenFile` 增加尽力权限设置；失败只记日志，不降级为无校验。
  - `start()` 失败原因（端口占用/权限）通过新方法 `lastStartError()` 暴露，供 `WebPreviewScreen` 显示。
- `MOD:webui/OutboundQueue.java`（提案）
  - 区分 `enqueueStateText`（可合并/可丢旧）与 `enqueueCriticalText`（`error`/`*.result`/`editor.ack`/`flight.exit`；绝不静默丢）。关键文本无法入队时返回失败并关闭该会话，让客户端以断线/错误明确失败，而不是等超时。
  - 帧仍允许丢最旧；关键文本不参与「丢最旧文本」的竞争。
- `MOD:webui/WebSocketSession.java`（提案）
  - `sendText` 拆分为状态/关键两条路径；`close()` 只释放本会话队列/编码器与从会话表移除，不停止服务端、不关闭 `CaptureHub`、不取消其他端点拥有的飞控。
- **不新建**第二套 WebSocket 实现；不引入第三方库。

## 4. 输入输出与字段约束

### 4.1 握手

请求：`GET /ws?token=<hex> HTTP/1.1`，headers 至少 `Upgrade: websocket`、`Connection: Upgrade`、`Sec-WebSocket-Key`、`Sec-WebSocket-Version: 13`、可选 `Origin`。

响应：
- 101：`Sec-WebSocket-Accept = base64(SHA1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`。
- 403：`text/plain`，正文为拒绝原因；连接关闭。
- 400：缺 `Sec-WebSocket-Key`。
- 404：非 `/`、非 `/ws`。

约束：
- 只绑 `127.0.0.1`；不监听 `0.0.0.0`。
- token 每次 `start()` 重新生成；`stop()` 后旧 token 立即失效（`token=null`）。
- token 只出现在握手 URL query，不进入消息体、不写日志。
- Origin 判定顺序：Origin → token；任一失败即 403，不进入会话。

### 4.2 会话

- 每连接一个 `WebSocketSession`；文本消息切到 Minecraft 主线程执行；二进制帧由 `IC-WSSender` 串行写出。
- 出站队列容量 16；`enqueueFrame` 满时丢最旧帧；状态文本可合并/丢旧；关键文本（`error`/`*.result`/`editor.ack`/`flight.exit`）绝不静默丢，无法入队即关闭该会话并让请求明确失败。
- 单帧上限 64MB；超过即断开。
- 关闭幂等；关闭后只从服务端会话表移除本会话并通知 `PreviewStreamer.onSessionClosed` 释放本会话编码器；**不关闭共享 `CaptureHub`**，**不取消其他端点拥有的飞控**，**不停止服务端**（服务端停止由宿主级 teardown/总开关负责）。

### 4.3 重连

- 前端断线后 1.5s 重连；每次重连重新读 token。
- 重连成功后 `onopen` 重新 `hello`、`refreshScripts`、`getSchema`、`sendPreviewConfig`、`pushScript`、`seek`（`store.ts:200-217`）。
- 旧代际的 `pending` 在 `onclose` 全部 reject；旧代际的帧/消息不再进入新状态。

## 5. 修改步骤

1. `store.ts` 增加 generation 守卫；`request()` 增加超时；`onclose` 只在当前代际时清状态并调度重连。
2. `Preview.vue` 的 `onFrame` 回调不需要改（generation 守卫在 store 层）；确认 `state.connected=false` 时清队列/关解码器（`Preview.vue:321-333`）。
3. 多客户端：前端状态栏显示 `connected` 即可；文档与 UI 提示「多窗口同时编辑不保证顺序」，不新增选举。
4. 主模组侧（本轮不改）：`start()` 失败原因、token 权限、关键文本槽写入 03-08 前置合同。
5. 迁移：`WebPreviewScreen.init()` 若 `start()` 返回 false，显示聊天提示（`Component.translatable` 新键）——本轮只写计划。

## 6. 禁止修改

- 不改端口 8765 与路径 `/ws`（前端硬编码）。
- 不放宽 Origin 白名单到任意 `https://*`。
- 不把 token 写入 URL 日志、错误消息或脚本文件。
- 不引入无鉴权的「本地免 token」开关。
- 不做跨机监听。
- 不用 `CaptureHub.close()` 或「取消所有飞控」实现单会话关闭；单个 `WebSocketSession.close()` 只释放本会话资源。
- 不把关键文本（回执/错误/`flight.exit`）与可合并状态放在同一「可丢旧」策略里。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `store.ts`、`electron/main.cjs`、`electron/preload.cjs`、`electron-bridge.d.ts` |
| 编辑器1.20.1方向 | 未来14迁移使用进程内端点，不承载WebSocket客户端；当前WebUI独立完成 |
| 主模组 `main` | `WebEditorServer.java`、`WebSocketSession.java`、`OutboundQueue.java` |

## 8. 前置

- 03-05 的 `hello_ack` 能力位（若要前端按能力显示）。
- 03-07 的关闭顺序（`stop()` 与会话关闭的幂等）。
- 03-08只提供未来端点设计参考，14才实现ingame；不作为当前WebSocket握手任务的硬前置。

## 9. 正反例验收

**正例 A**：`file://` 页面 + 正确 token → 101，日志出现 `editor client connected`。
**正例 B**：`http://localhost:5173` + 正确 token → 101。
**正例 C**：无 Origin + 正确 token → 101（非浏览器客户端）。
**正例 D**：`start()` 两次 → 第二次直接 true，不重复绑定端口。
**正例 E**：两个 Electron 窗口同时连 → 两个都收到 `playback.state`；一个发 `editor.play`，另一个在 50ms 内看到 `playing=true`。

**反例 A**：`Origin: https://evil.com` → 403，日志 `origin not allowed`。
**反例 B**：缺 token / 空 token / 错 token → 403，日志 `invalid or missing token`。
**反例 C**：`stop()` 后 token 文件不存在；用旧 token 重连 → 403。
**反例 D**：端口被占用 → `start()` 返回 false；屏幕显示「端口被占用」，不显示「已连接」。
**反例 E**：旧 socket 在重连后收到迟到帧 → 前端按 generation 丢弃，不进入新队列。
**反例 F**：请求发出后服务端不回应 → 15s 后 reject `request timeout`，`pending` 清空。
**反例 G**：两个窗口 A/B；A 进入飞控后 B 关闭 → A 的飞控仍激活、A 仍收到 `flight.state`；B 的关闭不广播 `flight.exit`、不写回 A 的关键帧。
**反例 H**：队列被 `playback.state` 灌满后发 `script.validate` → 要么关键文本成功入队并送达，要么会话以明确错误关闭；不得静默丢回执后让前端超时。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + Electron 客户端 + `curl`/PowerShell WebSocket 客户端（可选）。

1. F9 打开，确认 token 文件存在且内容为 64 位十六进制。
2. 用错误 Origin/错误 token 各打一次握手，确认 403。
3. 关闭游戏侧服务（ESC），确认编辑器 1.5s 后进入 disconnected，再按 F9 后自动重连。
4. 打开两个 Electron 窗口，确认都能连；同时发 play/pause，记录「后到者生效」。
5. 强杀游戏进程，确认 token 文件残留（未走 `stop()`）时编辑器持续 403；重启游戏后新 token 自动接上。

本次未执行；未来03当轮真实验证WebUI认证/会话/错误，13全量复核，不等待AUI环境或实现。

## 11. 完成定义

- generation 守卫、请求超时、多客户端提示、端口占用提示四项在代码/文档中有明确落点。
- 关键文本与可合并状态分级；单会话关闭只释放本会话资源，关闭 `CaptureHub`/取消他人飞控被明确禁止并有反例。
- 握手矩阵（正例 5/反例 8）逐条有可执行步骤。
- 03-07 的关闭顺序引用本文件的会话表与 token 生命周期，无第二套定义。
- 未执行的真实冒烟明确标注。
