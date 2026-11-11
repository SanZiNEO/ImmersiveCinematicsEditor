# 03-07 宿主关闭与释放（WebUI 侧）

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：README、03-02/03-03；未来AUI关闭见[14-07](../14-aui-forge-migration/14-07-teardown-carrier-consistency.md)，不构成本轮前置。

## 1. 职责

冻结 WebUI 宿主从「关闭预览屏」到「资源归零」的顺序、幂等与异常路径：飞控取消、编辑器播放退出、预览流关闭、服务端停止、token 删除、前端断开/清队列/关解码器；以及**未走正常关闭**的路径（退出世界、窗口关闭、异常崩溃）应如何处理。本任务还要区分**宿主级 teardown**（关闭 webui 模式/总开关）与**端点级 detach**（单个编辑器窗口断开）：前者可停止本模式传输，后者只释放该端点自己的会话流、编码器与飞控所有权，不关闭共享 CaptureHub、不停止其他会话。本任务不定义游戏内宿主的释放（14-07），但两者共享同一套「关闭即释放」判据与载体一致性矩阵。

**参考输入**：[工作台/偏好/宿主适配](../references/03-workspace-preferences-host.md)的关闭拦截与取消。桌面未保存守卫决定是否允许关闭；取消/保存失败必须保持文档和可用会话，不能先teardown再询问。允许关闭、宿主主动停用或退出世界后才按本任务释放各自所有权资源；参考桌面关闭事件不能代替游戏生命周期处理。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 打开 | `MOD:webui/WebPreviewScreen.java:56-70` | `activeScreen=this`；`WebEditorServer.start()`；`CaptureHub.register(PreviewStreamer.INSTANCE)`；聊天提示 |
| 渲染驱动 | `WebPreviewScreen.java:73-112` | `setPaused`、`tick`、50ms `playback.state`、飞控 tick/100ms 状态/HUD |
| 按键 | `WebPreviewScreen.java:108-159` | F9/ESC 关闭；飞控中 ESC 取消；F7 退出飞控；飞控按键转发 |
| 关闭 | `WebPreviewScreen.java:337-350` | `FlightModeManager.cancel()` → `activeScreen=null` → `CameraManager.exitPreview()` → `PreviewStreamer.close()` → `WebEditorServer.stop()` → `notifyEditorClosed()` → `setScreen(null)`；**无 `closed` 守卫，也无 `removed()`** |
| 总开关 | `MOD:Config.java`（grep 无 `editor` 命中） | 当前没有编辑器启用开关；`WebEditorServer.isRunning()` 只表示 webui 传输在跑 |
| 暂停判定 | `WebPreviewScreen.java:79-84` | 仅「编辑器播放激活且暂停且非飞控」停流 |
| 飞控退出 | `WebPreviewScreen.java:200-210` | `requestFlightExit(record)` 依赖 `activeScreen` |
| 预览流关闭 | `MOD:webui/PreviewStreamer.java:261-271` | 注销 CaptureHub；每会话 `closeStream`；清表；编码器异步回收 |
| 服务端停止 | `MOD:webui/WebEditorServer.java:122-145` | 关 socket、关闭全部会话、清表、interrupt、`token=null`、删 token 文件 |
| 会话关闭 | `MOD:webui/WebSocketSession.java:127-141` | 幂等；关队列、关 socket、`removeSession` |
| 捕获关闭 | `MOD:media/capture/CaptureHub.java:246-261` | 置 closed、清池、清消费者、删 FBO/PBO（**不由 WebUI 调用**） |
| 编辑器播放退出 | `MOD:camera/CameraManager.java:188`、`MOD:camera/PreviewChannel.java:212-223` | 编辑器激活时只退编辑器实例；否则 `lifecycle.stopScript()` |
| 通道停用 | `PreviewChannel.java:105-110` | `editorPlayback=false`、`editorPaused=true`、`previewClock.freeze()` |
| 键位冷却 | `MOD:control/CinematicKeyBindings.java:48,67-73,119-121` | 关闭后 500ms 内 F9 不重开 |
| 世界退出清理 | `MOD:handler/ClientEventHandler.java:135-176` | 相机/租约/lane/维度/ACK/选择器/中心/视图/投票；**不含** `WebPreviewScreen`/`WebEditorServer`/`PreviewStreamer` |
| 前端断线 | `ED:store.ts:229-241` | 置 disconnected、清计时器、reject pending、1.5s 重连 |
| 前端卸载 | `ED:components/Preview.vue:335-343` | 移除帧监听、停 rAF、关解码器、清队列、置空 ctx/ImageData |
| Electron 退出 | `EDE:main.cjs:59-67` | `window-all-closed` → 非 macOS `app.quit()` |

**已核对的缺口**：

1. **重复 `onClose()` 会误停游戏播放**：第二次调用时 `editorPlayback` 已为 false，`CameraManager.exitPreview()` 走 `PreviewChannel.exitPreview` 的 else 分支 `lifecycle.stopScript()`（`PreviewChannel.java:212-223`），可能停掉正在播放的游戏实例。`onClose` 没有幂等守卫。
2. **退出世界不释放**：`WebPreviewScreen` 只重写 `onClose()`，没有 `removed()`；MC 退出世界/断线时通常 `setScreen(null)` 触发 `removed()` 而非 `onClose()`。结果：服务端仍在监听、token 文件残留、`PreviewStreamer` 仍是 `CaptureHub` 消费者、编码器可能仍存活。`ClientEventHandler` 的世界退出清理也不含这些（`ClientEventHandler.java:135-176`）。
3. **`activeScreen` 静态引用泄漏**：若 `onClose()` 未执行（异常/退出世界），`activeScreen` 仍指向旧 Screen；`requestFlightExit` 会操作旧屏。
4. **端口占用静默**：`start()` 返回 false 被忽略（`WebPreviewScreen.java:56-60`）。
5. **编码器异步回收不可观测**：`PreviewStreamer.close()` 不等待；验收只能看进程/线程。
6. **token 删除失败**：只记日志；`token=null` 已使旧 token 失效，文件残留不致命，但会误导「服务仍在」。
7. **前端与游戏端生命周期不对称**：前端组件卸载（切视图）不断开 WebSocket（期望），但游戏端关屏会 `stop()` 并断开；前端进入 1.5s 重连循环，直到再次 F9。这会在游戏端日志产生持续 403/连接失败（若服务未起则连接被拒）。当前 `connect()` 在 token 不存在时仍尝试连接（`store.ts:191-198`），每次重连都失败一次。
8. **Electron 退出不断开**：`app.quit()` 时 WebSocket 由进程销毁关闭；游戏端会话关闭并释放编码器。可接受，但需在验收中确认。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 重复关闭 | 会误停游戏播放 | `WebPreviewScreen` 增加 `closed` 标志；`onClose` 首行 `if (closed) return; closed=true;` |
| 退出世界 | 不释放 | 重写 `removed()` 调用同一 `teardown()`；或在 `ClientEventHandler` 世界退出时关闭 |
| 静态引用 | `activeScreen` 可能泄漏 | `teardown()` 置 null；`removed()` 同样 |
| 端口占用 | 静默 | `start()` 失败时聊天提示 + 不显示「已连接」 |
| 编码器回收 | 异步 | 保持异步；验收看 5s 内进程消失 |
| token 残留 | 删除失败仅日志 | 记录路径与原因；下次 `start()` 覆盖写 |
| 前端重连 | 无 token 也连 | 无 token 时不发起连接，只显示「等待游戏开服」，定时重试读 token |
| 关闭顺序 | 固定 | 冻结为：飞控取消（仅本端点拥有的飞控）→ 编辑器播放退出 → 预览流关闭 → 服务端停止 → 键位冷却；不得调换（尤其不能先停服务再关编码器） |
| 端点关闭 | 与宿主关闭同路径 | 单会话断开只 `onSessionClosed` → 释放本会话编码器/队列；不停止服务端、不关闭 `CaptureHub`、不取消其他端点飞控 |
| 总开关关闭 | 无 | 统一入口触发本模式 teardown：注销编辑器键/入口、取消本模式飞行、退出预览、关闭会话与 token；重复执行幂等；不影响普通脚本播放 |
| 启用判定 | `WebEditorServer.isRunning()` 可能被误用 | 只能读 `EditorHostApi.isEnabled()`（提案）；服务是否在跑不参与该判定 |

### 3.2 拟新建/修改（提案）

- `MOD:webui/WebPreviewScreen.java`（提案，本轮不改）
  - 新增 `private boolean closed`；`onClose()` 与 `removed()` 共用 `teardown()`；`teardown()` 幂等。
  - `init()` 检查 `start()` 返回值；失败提示。
- `MOD:handler/ClientEventHandler.java`（提案）
  - 世界退出清理追加 `WebPreviewScreen.closeIfOpen()`（或由 `Minecraft.setScreen(null)` 触发 `removed()`）；同时由 `editor` 统一入口检查总开关与 ingame 模式，不在这里各写一套开关判断。
- `MOD:editor/EditorLifecycle.java`（目标名，提案；当前无此包）
  - 唯一持有总开关与模式状态；WebUI 屏关闭只停止 webui 模式，游戏内 Screen 关闭只停止 ingame 模式；总开关关闭调用两者各自的 teardown，幂等。
  - 不持有 `CaptureHub` 的所有权，不调用 `CaptureHub.close()`；不因单端点断开停止服务。
- `ED:store.ts`（修改）
  - `connect()` 在 `authToken()` 为空时不创建 WebSocket，只置 `state.error='webui token not found'` 并 1.5s 后重试；避免无意义连接。
- `ED:components/Preview.vue`（修改）
  - 无需改卸载逻辑；确认 `onUnmounted` 与 `state.connected=false` 两条路径都清队列/关解码器。
- **不新建**第二套关闭流程；`teardown()` 是唯一入口。

## 4. 输入输出与字段约束

### 4.1 正常关闭（F9/ESC）

输入：`keyPressed` 命中 F9 或 ESC（非飞控）。
输出（按序）：
1. 若飞控激活且由本宿主/本端点发起 → `FlightModeManager.cancel()`（恢复进入前姿态）；若飞控由其他端点拥有，不取消、不写回。
2. `activeScreen=null`。
3. `CameraManager.exitPreview()`（只退编辑器实例；游戏实例不动）。
4. `PreviewStreamer.close()`（只注销本模式的捕获消费者、关闭本模式每会话编码器与流；不调用 `CaptureHub.close()`）。
5. `WebEditorServer.stop()`（关闭本模式 socket 与会话、清表、删 token；只在本模式宿主级 teardown 调用，单端点 detach 不调用）。
6. `CinematicKeyBindings.notifyEditorClosed()`（500ms 冷却）。
7. `minecraft.setScreen(null)`。

约束：任一步异常不得阻止后续步骤（当前无 try/finally；提案加逐段 try/catch + 限频日志）。

### 4.2 退出世界/断线

输入：MC 退出世界、断线、`setScreen(null)`。
输出：与 4.1 相同的释放；不得依赖 `onClose()` 被调用。
约束：`removed()` 必须在 `Screen` 被移除时执行；`teardown()` 幂等。

### 4.3 前端断开

- `ws.onclose`：置 `connected=false`、清脚本推送/seek 计时器、reject 全部 pending、1.5s 后重连。
- `Preview.vue` 监听 `state.connected=false`：清队列、关解码器、重置 PTS 基准。
- 组件卸载：移除帧监听、停 rAF、关解码器、清队列、置空 ctx/ImageData。
- 不主动关闭 WebSocket（除非应用退出）。

### 4.4 失败路径

| 场景 | 期望 |
|---|---|
| 端口占用 | `start()` false；屏幕提示；不显示「已连接」；关闭时 `stop()` 直接返回 |
| 编码器启动失败 | 本会话回退 RGBA；关闭时无进程 |
| 编码器运行期崩溃 | 本会话回退；其他会话不受影响 |
| 单会话断开 | 只释放该会话流/编码器；服务端继续运行、其他会话继续出帧、飞控主人不受影响 |
| 总开关关闭 | 按 4.1 释放本模式并注销编辑器键/入口；ingame 模式同样释放；`CaptureHub` 与普通播放不受影响；重复关闭幂等 |
| token 文件删除失败 | 旧 token 已失效；日志记录；下次启动覆盖 |
| 重复关闭 | 第二次直接返回，不停游戏播放 |
| 退出世界 | 同正常关闭；无残留 |

## 5. 修改步骤

1. `WebPreviewScreen` 提取 `teardown()`，`onClose()`/`removed()` 共用，加 `closed` 守卫。
2. 逐段 try/catch，确保 4.1 的 7 步都执行；异常限频日志。
3. `init()` 检查 `start()`；失败提示。
4. `ClientEventHandler` 世界退出清理追加关闭入口（或确认 `removed()` 足够）。
5. `store.ts` 无 token 不连接。
6. 统一入口接总开关：关闭时调用 webui 模式 teardown 并注销编辑器键；重复关闭直接返回。
7. 验收脚本：重复 F9 20 次、退出世界、杀进程、端口占用、两窗口只断一个、总开关关闭。

## 6. 禁止修改

- 不改关闭顺序（飞控 → 播放 → 流 → 服务端）。
- 不在 `PreviewStreamer.close()` 里调用 `CaptureHub.close()`（会误杀其他消费者）。
- 不在单端点 detach 时停止服务端、关闭其他会话或取消他人飞控；不把 `flight.exit` 广播给所有端点。
- 不用 `WebEditorServer.isRunning()` 代表编辑器启用/关闭状态。
- 不在渲染线程等待编码器进程退出。
- 不把「关闭」实现成「只隐藏 UI、服务继续跑」。
- 不在 `teardown()` 里停游戏实例播放。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `store.ts`（无 token 不连）、`Preview.vue`（卸载清理） |
| 编辑器 `1.20.1` | 进程内宿主释放见 13-07；共享「关闭即释放」判据 |
| 主模组 `main` | `WebPreviewScreen.java`、`PreviewStreamer.java`、`WebEditorServer.java`、`ClientEventHandler.java` |

## 8. 前置

- 03-02 的会话关闭与 token 生命周期。
- 03-03 的预览流关闭。
- 13-07 的载体一致性矩阵（同一套释放判据）。

## 9. 正反例验收

**正例 A**：F9 打开 → 关闭，服务停止、token 删除、无 ffmpeg、无 `IC-WSSender/Reader` 线程；500ms 后可再次 F9。
**正例 B**：重复调用 `onClose()` 两次，第二次不停游戏实例；日志无 `stopScript`。
**正例 C**：退出世界（不按 F9），服务停止、token 删除、CaptureHub 无 PreviewStreamer 消费者。
**正例 D**：端口占用时打开屏幕，提示「端口被占用」，不显示「已连接」；关闭不抛异常。
**正例 E**：前端组件卸载后 rAF 停止、解码器关闭、队列空；WebSocket 仍连接（切视图不断线）。
**正例 F**：两个窗口 A/B 都连；关闭 B 的窗口 → B 的 `SessionStream` 与编码器释放，A 仍收帧、`CaptureHub` 仍注册 `PreviewStreamer`。
**正例 G**：总开关关闭 → webui 服务停止、token 删除、编辑器键不再触发；`CaptureHub` 仍可用，普通脚本播放继续。

**反例 A**：`stop()` 后 token 文件仍在（删除失败）→ 旧 token 连接 403；日志有记录。
**反例 B**：重复关闭 20 次 → 无累积线程/进程；游戏实例播放未被停。
**反例 C**：杀游戏进程 → 编辑器 disconnected，1.5s 重连；重启游戏后新 token 接上。
**反例 D**：关闭时编码器仍在退出 → 5s 内进程消失（异步回收）；不阻塞渲染线程。
**反例 E**：关闭 B 时调用 `CaptureHub.close()` 或广播 `flight.exit` → A 黑屏/关键帧被误写；验收不通过。
**反例 F**：总开关关闭后仍能按 F9 打开或服务仍在监听 → 验收不通过。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + ffmpeg + Electron。

1. F9 开关 20 次，检查进程/线程/token。
2. 打开编辑器后退出世界，检查服务端与捕获释放。
3. 重复调用关闭（快速 F9 两次），确认游戏播放不被误停。
4. 占用 8765 端口后 F9，确认提示。
5. Electron 直接退出，确认游戏端会话关闭、编码器回收。
6. 两个 Electron 窗口，关闭一个，确认另一个继续出帧且无 `CaptureHub` 关闭日志。
7. 关闭总开关，确认服务/键/捕获消费者释放，普通脚本仍播放。

本次未执行；未来03当轮验证WebUI关闭/异常/资源所有权，13全量复核；游戏内释放只在14后置迁移执行。

## 11. 完成定义

- `teardown()` 是唯一关闭入口，`onClose()`/`removed()` 共用，幂等；宿主级与端点级路径分离。
- 重复关闭、退出世界、端口占用、token 删除失败、编码器异步回收、单端点隔离、总开关七项有正反例。
- 关闭只释放本宿主/本端点拥有的资源；`CaptureHub` 与 `flight.exit` 的过度释放/广播被明确禁止。
- 前端无 token 不连接；组件卸载与连接关闭的边界清晰。
- 未执行的真实冒烟明确标注。
