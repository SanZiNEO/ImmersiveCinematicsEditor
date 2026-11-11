# 14-07 关闭、禁用、世界退出与载体一致性

> 状态：未实现（仅计划；14 是 13 通过后的迁移执行轮，不与 WebUI 同步开发）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-02～14-06 至少各有可运行实现
> 关联：`README.md`、`14-02-aui-host-screen.md`、`14-03-inprocess-frame-source.md`、`14-04-inprocess-signal-endpoint.md`、`14-05-input-focus-routing.md`、`14-06-flight-mode-inprocess.md`、`../03-host-transport/03-07-host-teardown.md`、`../03-host-transport/03-10-editor-package-lifecycle.md`、`../shared/editor-package-modes.md`、`../shared/contracts.md`（C05/C06/C15）

## 1. 职责

把游戏内宿主的「退出」做成唯一、幂等、只释放自己资源的路径，并给出 WebUI↔ingame 的载体一致性矩阵。覆盖：

- 关闭 `EditorAuiScreen`（ESC/编辑器键/切换载体）。
- 总开关从开启切到关闭。
- 退出世界、断线、客户端关闭。
- 单个端点断开（ingame Screen 关闭，或同时存在的 WebUI 会话断开）。
- 帧源 generation 失效、主模组重建捕获纹理。
- 重复关闭、关闭过程中抛异常、关闭后再次打开。

本任务不实现 Screen/画面/信号/飞控本身（见 14-02～14-06），只冻结它们的释放契约、所有权与验收。**完成标志不是“写了 `teardown()`”，而是资源归零、重复关闭无副作用、单端点关闭不误伤其他端点或共享捕获。**

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| WebUI 关屏顺序 | `J:webui/WebPreviewScreen.java:337-350` | `FlightModeManager.cancel()` → `CameraManager.exitPreview()` → `PreviewStreamer.close()` → `WebEditorServer.stop()` → `notifyEditorClosed()` |
| WebUI `onClose/removed` | `WebPreviewScreen.java`（`onClose`/`removed`） | 两个入口都必须走同一释放；现状需加幂等守卫（03-07 提案） |
| 端点级 detach 合同 | `../03-host-transport/03-08-editor-host-contract.md` §3.3 | `detach` 只释放该端点资源；不停止服务、不关其他端点、不关 `CaptureHub` |
| 宿主级 teardown 合同 | `../03-host-transport/03-07-host-teardown.md` | 区分宿主级（关闭 webui 模式/总开关）与端点级（单窗口断开） |
| AUI 关屏 | `AUI:screen/ApricityScreen.java:182-203` | `onClose()` 发 `unload`、`linkedDocument.remove()`、清 viewport、光标；`removed()` 再 `remove()` |
| AUI Document 释放 | `AUI:init/Document.java:766-799` | `disposeLifecycle`：元素断开、观察者、音频、选择、焦点；`DISPOSED` 幂等 |
| AUI 文档注册表 | `AUI:dom/DocumentRegistry.java:54-179` | `remove` 调 `disposeLifecycle`；编辑器不得重复持有已释放 Document |
| AUI 纹理注册/释放 | `AUI:spi/AuiRenderService.java:197-207` | `closeTexture` 删除 GPU 资源；`releaseTexture` 只释放注册；二者不可混用 |
| 捕获消费者 | `MOD:media/capture/CaptureHub.java:74-101` | `register/unregister`；`close()` 是捕获中心级操作 |
| 捕获关闭 | `CaptureHub.java:508-517` | 删 FBO + 纹理；**不属于**编辑器消费者合同 |
| 飞控取消/退出 | `MOD:control/FlightModeManager.java:58-74` | `exit()` 返回最终状态；`cancel()` 恢复进入前状态 |
| 飞控 owner 合同 | `../03-host-transport/03-08-editor-host-contract.md` §3.6 | 同一时刻一个 owner；`flight.exit` 只发 owner，不广播 |
| 推送到端点 | `../03-host-transport/03-08-editor-host-contract.md` §3.2 | `broadcast` 只用于可合并状态；关键文本 `send(endpointId,...)` |
| 总开关 | `../03-host-transport/03-10-editor-package-lifecycle.md` §4.1 | `EditorHostApi.isEnabled()`；不得用 `WebEditorServer.isRunning()` 代替 |
| 编辑器骨架 | `INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java:6-12` | 只有日志；无 Screen/端点/释放实现 |
| AUI 世界窗口 | `AUI:world/WorldWindow.java:1-1112` | 会进入世界渲染/捕获；不得用于编辑器 UI |

**已核对的缺口**：

1. `EditorAuiScreen` 不存在，没有 `teardown()`；AUI 的 `onClose`/`removed` 双路径若各写一份释放，会出现重复 detach、重复释放租约。
2. 游戏内端点/帧源/输入/飞控均未实现；没有“只释放本端点”的代码路径。
3. WebUI 的关闭仍以宿主为单位（停服务），没有可对照的端点级路径；14 必须证明两者在“单端点断开”上语义一致、在“宿主关闭”上边界不同。
4. 没有 generation 失效处理：主模组重建 FBO 后，编辑器若继续画旧纹理，会出现黑帧/GL 错误。
5. 没有「关闭时脚本有未保存修改」的策略；直接丢弃会造成静默数据丢失。
6. 没有「总开关关闭发生在 Screen 打开期间」的验收；现有计划只覆盖启动时关闭。
7. 没有「WebUI 与 ingame 同时存在」的隔离验收；若 `flight.exit` 广播或 ingame 关闭停掉 `WebEditorServer`，会误伤另一载体。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 关闭入口 | 无游戏内 Screen；WebUI 以停服务收尾 | `EditorAuiScreen.onClose()/removed()` 共用 `EditorTeardown.run()` |
| 幂等 | WebUI 需补 `closed` 守卫 | ingame 与 WebUI 都必须幂等；第二次调用只记一次诊断 |
| 资源所有权 | 无 ingame 实现 | 按 3.2 表逐项释放；禁止越权 |
| generation | 无 | 失效即停止绘制旧纹理、清租约；等待新 generation |
| 总开关 | 无 | 关闭时执行与关屏相同的释放；不注册/不打开/不订阅 |
| 载体一致性 | 未定义 | 3.5 矩阵逐场景对照；14-08 真实验收 |
| 未保存修改 | 未定义 | 明确提示/阻止关闭；不得静默丢弃 |
| 异常 | 未定义 | 每步独立 try/catch；记录一次；继续后续释放 |

### 3.2 资源所有权与释放表

| 资源 | 拥有者 | 14 的释放动作 | 禁止 |
|---|---|---|---|
| AUI `Document`/`Element` | AUI（`ApricityScreen`） | `teardown()` 先执行；`super.onClose()` 由 AUI `remove()` | 在 `teardown()` 里 `document.remove()`；`super.onClose()` 后访问 `getLinkedDocument()` |
| AUI 页面静态缓存/注册表 | AUI | 确认 `DocumentRegistry` 已移除本文档；不保留编辑器私有静态引用 | 反射清 AUI 全局缓存；删除其他文档 |
| 捕获 GL 纹理 | 主模组 `CaptureHub` | 只 `FrameLease.release()`；清本地引用 | `glDeleteTextures`、`CaptureHub.close()`、`closeTexture` 主模组纹理 |
| 编辑器注册的 `TextureKey` | 编辑器（若走 `<texture>` 包装） | `releaseTexture(location)` | 把主模组纹理当自己的资源关闭 |
| 进程内端点 | 编辑器 attach、主模组登记 | `EditorSessionApi.detach(endpoint)` | 停止 `WebEditorServer`、关闭其他端点 |
| 帧源订阅/监听器 | 编辑器订阅 | `removeListener` + 清租约 | 保留监听器到下一次打开 |
| 飞控 | 主模组 `EditorFlightControl` | 仅当本端点是 owner：`exit(owner,false)` 或 `cancel`；非 owner 不动 | 广播 `flight.exit`、取消他人飞控 |
| 编辑器播放 | 主模组 `EditorPlaybackControl` | `stop()`（或等价退出编辑器播放） | 重置全局相机/停止游戏播放 |
| 输入/焦点/光标 | Screen/AUI | 清焦点、恢复光标、释放按键状态；AUI `disposeLifecycle` 兜底 | 把玩家输入状态写入存档/脚本 |
| 编辑器键/入口 | 编辑器 + `EditorManager` | 总开关关闭后处理器首行拒绝；入口不可见 | 关闭后仍能打开 Screen/attach 端点 |
| 脚本文档/脏状态 | 编辑器文档层 | 关闭前提示保存/放弃；关闭后不保留悬挂引用 | 静默丢弃未保存修改 |
| WebUI 服务/编码器 | 主模组 `editor.webui` | ingame 关闭**不得触碰** | 以“统一关闭”为名停止 webui |

### 3.3 释放顺序

`EditorTeardown.run(reason)` 固定顺序，每步独立异常隔离：

1. 标记 `closing=true`，拒绝新的 UI 命令/请求。
2. 若本端点是飞控 owner：`EditorFlightControl.exit(endpointId, false)`（取消，不写回）；非 owner 跳过。
3. `EditorPlaybackControl.stop()`，退出编辑器播放。
4. `EditorSessionApi.detach(endpoint)`；之后不再接收推送。
5. `EditorFrameBinding.close()`：`removeListener`、`lease.release()`、清 generation/纹理引用。
6. 若注册过 `TextureKey`：`AuiRenderService.releaseTexture(location)`；不 `closeTexture` 主模组纹理。
7. 清 AUI 焦点、恢复光标、释放本 Screen 的输入状态；不重置其他 Screen。
8. 清本任务的节流器、pending 请求、定时器；所有 pending 以“已关闭”失败。
9. 记录一次 `teardown` 诊断（原因、耗时、失败步骤）；`closed=true`。
10. 返回；由 `ApricityScreen.onClose()` 执行 AUI 的 `Document.remove()`。

`removed()` 与总开关关闭路径调用同一 `EditorTeardown.run()`；`closed` 守卫保证只执行一次有效释放。

### 3.4 幂等与异常

- `closing` 与 `closed` 双标志：进入时置 `closing`；完成后置 `closed`。重复调用直接返回。
- 每一步 `try/catch(Throwable)`；失败记录步骤名，不阻断后续步骤；最终诊断包含失败集合。
- `FrameLease.release()` 必须真实幂等：重复调用不重复归还、不抛异常；未归还/已失效租约由 14-03 的合同处理。
- `detach` 幂等：重复 detach 不抛异常、不影响其他端点。
- 关闭过程中用户再次按 ESC/编辑器键：忽略，不再触发第二次 `onClose`。
- 关闭过程中主模组重建 generation：`EditorFrameBinding` 先失效旧租约，后续释放只处理新状态；不画旧纹理。
- 关闭过程中 AUI 抛异常：仍执行 4–9 步；`super.onClose()` 的 AUI 清理不能被跳过。

### 3.5 WebUI↔ingame 载体一致性矩阵

| 场景 | WebUI（13 基线） | ingame（14） | 共享不变量 | 验收 |
|---|---|---|---|---|
| 正常关闭 | 关预览屏：飞控 → 播放 → 流 → 服务 → 通知 | 关 Screen：飞控 owner → 播放 → detach → 租约/纹理 → 输入 | 先停控制，再断传输，最后释放显示资源 | 14-08 第 11 步 |
| 重复关闭 | `onClose`/`removed` 共用 teardown，第二次无副作用 | 同；`closed` 守卫 | 幂等；不重复停服务/不重复 detach | 连续调用两次 |
| 总开关关闭 | 释放 webui 会话与编码器；不注册入口 | 关闭 Screen + 释放 ingame 资源；不注册键/不订阅帧源 | 总开关关闭 = 两模式都不可新建会话 | 打开中关闭、启动时关闭 |
| 退出世界/断线 | 与正常关闭相同的释放；不依赖 `onClose` 被调用 | 同；世界卸载钩子调 `EditorScreens.closeIfOpen()` | 不残留 Document/纹理/监听器/输入 | 退出世界后回主菜单再进 |
| 单端点断开 | 关闭一个 WebSocket 会话，只释放该会话流；服务/其他会话继续 | 关闭唯一 ingame Screen；不停 WebUI 服务；若同时有 WebUI 会话不受影响 | 端点级只释放自己的资源 | 两载体同时打开，分别关闭 |
| 切换载体 | 先关 WebUI 预览屏再开 ingame；反之亦然 | 同；同一时刻只允许一个编辑器 Screen | 互斥；不叠加两个 Screen | 来回切换 5 次 |
| generation 失效 | 不适用（编码流按帧重建） | 停止绘制旧纹理、清租约、显示占位；新 generation 恢复 | 旧租约不可再用；销毁由拥有者做 | 触发规格重建/世界切换 |
| 关键回执失败 | `sendCritical=false` → 关闭会话，请求明确失败 | `sendCritical=false` → detach + UI 明确断开，不假装成功 | 关键文本不静默丢 | 注入满队列/断连 |
| 崩溃/强退 | 进程结束，服务端口随进程释放 | 同；不保证 Screen 回调 | 不依赖回调做唯一释放；下次启动无残留 | 强退后重启 |
| 再打开 | 重新建会话/编码器 | 重新 attach/subscribe/注册纹理；新端点 id | 不复用已释放的 Document/租约/端点 | 连续开合 10 次 |

## 4. 输入输出与字段约束

### 4.1 `EditorTeardown.run`

输入：

| 字段 | 类型 | 约束 |
|---|---|---|
| `reason` | enum | `SCREEN_CLOSE`/`SWITCH_CARRIER`/`SWITCH_OFF`/`WORLD_EXIT`/`DISCONNECT`/`ERROR` |
| `screen` | `EditorAuiScreen` | 非空；`closing/closed` 由 Screen 持有 |
| `endpoint` | `EditorEndpoint` | 已 attach 时非空；未 attach 时跳过 4/8 步 |
| `frameBinding` | `EditorFrameBinding` | 可为空；为空时跳过 5 |
| `flightOwnerId` | `String` | 由 `EditorFlightControl.ownerEndpointId()` 读取，不缓存猜测 |

输出：

| 字段 | 类型 | 约束 |
|---|---|---|
| `closed` | boolean | 完成（含部分失败）后 true；失败步骤在诊断中 |
| `failures` | `List<String>` | 步骤名；空表示全成功 |
| `elapsedMs` | long | 诊断；不参与逻辑 |

### 4.2 状态机

`OPEN → CLOSING → CLOSED`；`CLOSED` 不可回到 `OPEN`（重开创建新 Screen/新端点/新租约）。总开关关闭时，若 Screen 处于 `OPEN`，执行 `OPEN → CLOSING → CLOSED`；若已 `CLOSED`，只确保入口/键不可用。

### 4.3 失败行为

| 场景 | 行为 |
|---|---|
| `detach` 抛异常 | 记录；继续释放租约/纹理/输入；端点标记失效 |
| 租约 release 失败 | 记录；不重试到下一帧；不关闭主模组纹理 |
| 飞控 exit 失败 | 记录；调用 `cancel` 兜底；仍不确定时明确日志，不广播 |
| AUI `Document.remove()` 抛异常 | 由 `super.onClose()` 处理；本任务不重复 remove |
| 关闭时未保存 | `SCREEN_CLOSE` 先提示；用户取消则回到 `OPEN`；`SWITCH_OFF/WORLD_EXIT` 按 02 文档策略保存草稿或明确放弃 |
| 关闭后仍收到推送 | 端点 `isOpen=false` 丢弃并计数；不更新 DOM |
| 关闭后再次打开 | 新建 Screen/端点/租约；不复用旧对象 |

## 5. 修改步骤

1. 在 `EditorAuiScreen` 增加 `closing/closed` 与 `EditorTeardown`（提案，14-02 落地 Screen 时预留）。
2. 按 3.3 顺序实现 10 步；每步独立 try/catch；先接 14-03/14-04/14-06 的释放方法。
3. `onClose()`/`removed()` 共用；确保 `teardown` 在 `super.onClose()` 之前。
4. 世界退出钩子调用 `EditorScreens.closeIfOpen(WORLD_EXIT)`；总开关监听调用同一路径。
5. `EditorFrameBinding` 实现 generation 失效与 `close()`；`FrameLease.release()` 幂等。
6. 飞控只释放 owner；非 owner 关闭不调用 `exit/cancel`。
7. 未保存修改策略接入 02 的文档脏标记与草稿；禁止静默丢弃。
8. 加入 `EditorTeardown` 诊断日志（一次、含 failures）；14-08 验证。
9. 与 WebUI 的 03-07 对照，逐行填 3.5 矩阵；差异只允许“宿主级 vs 端点级”，不允许语义相反。

## 6. 禁止修改

- 不在 ingame 关闭路径调用 `WebEditorServer.stop()`、`PreviewStreamer.close()` 或 `CaptureHub.close()`。
- 不广播 `flight.exit`；不取消非本端点的飞控。
- 不 `closeTexture` 主模组捕获纹理；只释放自己注册的包装。
- 不在 `teardown()` 中 `document.remove()`；不重复释放 AUI Document。
- 不把“关闭时清空所有 AUI 文档/全局静态缓存”当作释放；只清本文档与自己的注册。
- 不用异常吞掉失败后假装 `closed=true` 且无诊断；失败必须可观察。
- 不把未保存脚本静默丢弃；不把关闭失败转成“下次再说”。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `EditorAuiScreen` 的 `teardown` 调用、端点/租约/输入释放 |
| 编辑器 `webui` | 不承载；WebUI 的 03-07 是基线对照，不在本任务改 |
| 主模组 `main` | `EditorSessionApi.detach`、`EditorFlightControl`、`EditorFrameSource` 的所有权实现；`CaptureHub` 不被关闭 |

## 8. 前置

- 14-02 的 Screen 生命周期与 `onClose/removed`。
- 14-03 的 `FrameLease`/generation/订阅释放。
- 14-04 的 `detach`/`sendCritical`/pending 失败。
- 14-06 的 owner 与 `exit/cancel`。
- `../03-host-transport/03-07-host-teardown.md` 的 WebUI 基线；`03-10` 的总开关/所有权。

## 9. 正反例验收

**正例 A**：打开编辑器 → ESC 关闭 → 端点 detach、租约释放、纹理注册释放、光标/焦点恢复；日志一条 teardown；再次打开正常。
**正例 B**：连续调用 `onClose()` 两次 → 第二次无 detach/无异常/无重复日志；WebUI 服务未受影响。
**正例 C**：打开中关闭总开关 → Screen 关闭并释放；编辑器键不再打开；`WebEditorServer` 状态不因 ingame 关闭而改变。
**正例 D**：退出世界 → 不依赖用户按 ESC，资源同样释放；回主菜单再进游戏可重新打开。
**正例 E**：WebUI 与 ingame 同时打开 → 关闭 ingame 后 WebUI 会话/预览继续；关闭 WebUI 后 ingame 继续；互不取消飞控。
**正例 F**：主模组重建 generation → 编辑器停止画旧纹理、显示占位；新 generation 到达后恢复；旧租约 release 幂等。
**正例 G**：未保存修改 → 关闭提示；取消则保持打开；确认放弃才释放。

**反例 A**：`teardown()` 调 `CaptureHub.close()` → 其他消费者黑屏；验收不通过。
**反例 B**：`flight.exit` 广播 → 非发起端点写回关键帧；验收不通过。
**反例 C**：关闭一个 ingame Screen 停掉 `WebEditorServer` → WebUI 断连；验收不通过。
**反例 D**：`super.onClose()` 后再 `getLinkedDocument()` → 已 disposed；验收不通过。
**反例 E**：重复关闭导致二次 `detach`/二次 `releaseTexture` → 异常或重复计数；验收不通过。
**反例 F**：关闭时静默丢弃未保存脚本 → 数据丢失；验收不通过。
**反例 G**：关闭后仍接收推送并更新已释放 DOM → 异常/残留；验收不通过。

## 10. 真实游戏冒烟（未执行）

前置：Forge 1.20.1 dev run + AUI 1.3.1 + 主模组 `api/editor`/帧源/飞控实现 + 14-02～14-06 落地。

1. 连续打开/关闭 10 次；每次检查端点 detach、租约释放、无 GL 错误、无残留监听器。
2. 打开中关闭总开关；再次开启；确认键/入口与 Screen 行为。
3. 打开中退出世界；回主菜单再进；确认无残留。
4. 同时打开 WebUI 与 ingame；分别关闭；确认互不影响。
5. 触发捕获规格重建/世界切换；确认 generation 失效占位与恢复。
6. 注入 `sendCritical=false`（满队列/断连）；确认 UI 明确失败、端点关闭、不假成功。
7. 打开带未保存修改的文档；关闭并取消；确认未丢数据。
8. 强退客户端后重启；确认无端口/纹理/端点残留。

**本轮未执行**：14 尚未实施，无 Forge 运行环境；以上为 14-08 统一冒烟的一部分。

## 11. 完成定义

- `EditorTeardown` 是 ingame 唯一关闭入口；`onClose`/`removed`/总开关/世界退出共用；幂等可验证。
- 3.2 所有权表逐项有释放者与禁止项；关闭只释放本端点/本文档/本租约，不关闭 `CaptureHub`、不停 WebUI、不广播 `flight.exit`。
- generation 失效、租约释放、纹理注册释放、输入/焦点/光标恢复均有正反例。
- 3.5 载体一致性矩阵逐场景有 WebUI 基线、ingame 期望与共享不变量；差异仅为宿主级/端点级，不相反。
- 未保存修改、异常、重复关闭、关闭后推送四项有明确行为。
- 14-08 的真实冒烟覆盖本任务全部场景；未执行项明确标注。
