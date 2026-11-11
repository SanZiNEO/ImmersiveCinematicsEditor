# 14-06 游戏内飞控（进入 / 退出 / 写回）

> 状态：未实现（仅计划；14 是 13 通过后的迁移执行轮）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-04 的端点/推送可用
> 关联：`README.md`、`14-04-inprocess-signal-endpoint.md`、`14-05-input-focus-routing.md`、`14-07-teardown-carrier-consistency.md`、`14-09-full-feature-migration.md`、`../03-host-transport/03-08-editor-host-contract.md`（§3.6）、`MOD:plans/0.3.6/Z-editor/flight-mode.md`

## 1. 职责

冻结游戏内宿主的飞控链路：编辑器发 `editor.enter_flight_mode`（携带选中片段在播放头处的姿态）→ 主模组逐字段回落 → `FlightModeManager` 接管 → 编辑器显示 `flight.state`（10Hz）→ 退出/取消回推 `flight.exit` → 编辑器写回选中关键帧。

本任务是飞控的**进程内实现**；03-08 §3.6 只冻结 `EditorFlightControl` 合同与 owner 语义，实际 `enter/exit` 不依赖 `WebPreviewScreen`、`flight.exit` 只发 owner、RELATIVE 基准正确，均由本任务落地。14-09 的 12-07 取景、14-08 的飞控切片复用本任务。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 飞控管理器 | `MOD:control/FlightModeManager.java:15-18` | `INSTANCE`；与界面解耦 |
| 状态 | `FlightModeManager.java:24-41` | `FlightState`（pos/yaw/pitch/roll/fov/zoom） |
| 进入 | `FlightModeManager.java:48-56` | `enter(startPos,yaw,pitch,roll,fov,zoom,absolute)`；暂停相机+直控+初始化 |
| 退出 | `FlightModeManager.java:58-66` | `exit()` 返回最终状态并关闭直控 |
| 取消 | `FlightModeManager.java:68-74` | `cancel()` 恢复进入前状态 |
| tick | `FlightModeManager.java:76-79` | 每帧驱动移动/光学 |
| 键盘/鼠标 | `FlightModeManager.java:81-89` | `onKeyEvent`/`onMouseMove` |
| 光学重置 | `FlightModeManager.java:91-108` | 只恢复 FOV/Zoom/Roll |
| 状态查询 | `FlightModeManager.java:110-123` | `isSlowDown/isModeAbsolute/getState` |
| 飞控核心 | `MOD:control/FlightController.java:1-313` | 接管相机；光标锁定/解锁；输入处理 |
| 进入解析 | `J:webui/WebEditorApi.java:274-287` | 逐字段 `Double/Float`，缺省 null；`absolute` |
| 进入回落 | `J:webui/WebPreviewScreen.java:161-198` | 未提供字段回落 `CameraManager.getCameraState()`；无状态时用默认值 |
| 退出请求 | `WebPreviewScreen.java:200-210` | `requestFlightExit(record)` 依赖 `activeScreen` |
| 状态广播 | `WebPreviewScreen.java:279-292` | `flight.state{x,y,z,yaw,pitch,roll,fov,zoom}`；100ms |
| 退出广播 | `WebPreviewScreen.java:294-316` | `flight.exit{cancelled,x,y,z,yaw,pitch,roll,fov,zoom,absolute,baseX,baseY,baseZ}` |
| 广播 | `WebPreviewScreen.java:318-324` | `WebEditorServer.broadcastText` |
| 前端进入 | `ED:store.ts:553-597` | 选中关键帧/片段；`sampleCameraPose`；发 `editor.enter_flight_mode` |
| 前端退出 | `store.ts:635-638` | 发 `editor.exit_flight_mode` / `cancel_flight_mode` |
| 前端写回 | `store.ts:600-633` | `flight.exit` → `updateKeyframeFromFlight`；ABSOLUTE/RELATIVE 基准点 |
| 前端 HUD | `ED:components/Preview.vue:372-390` | 飞控叠层（位置/朝向/光学/按钮） |
| 姿态采样 | `ED:operations.ts:241-...` | `sampleCameraPose`；时间 clamp、循环折算、线性插值、角度环绕、zoom 对数 |
| 设计文档 | `MOD:plans/0.3.6/Z-editor/flight-mode.md` | 绑定选中片段；逐字段回落；退出写回；全屏 lane 未做 |
| 公共合同 | `../03-host-transport/03-08-editor-host-contract.md` §3.6 | `enter(endpointId,...)`/`exit(endpointId,record)`/`isActive/ownerEndpointId/state` |

**已核对的缺口**：

1. **退出入口依赖 `WebPreviewScreen`**：`WebEditorApi` 的 `editor.exit_flight_mode`/`cancel_flight_mode` 直接调 `WebPreviewScreen.requestFlightExit`（`WebEditorApi.java:86-87`）；该静态方法在 `activeScreen==null` 时直接 return（`WebPreviewScreen.java:200-210`）。游戏内宿主没有 `WebPreviewScreen`，退出无效。
2. **进入入口依赖 `WebPreviewScreen.enterFlightMode`**：它用 `CameraManager.getCameraState()` 回落（`WebPreviewScreen.java:161-198`）；游戏内宿主可调用，但语义绑定「预览屏」，不是稳定接口。
3. **状态广播依赖 `WebPreviewScreen` 实例**：`broadcastFlightState`/`broadcastFlightExit` 是实例方法（`WebPreviewScreen.java:279-316`）；游戏内宿主需要自己的推送。
4. **`flight.exit` 的 `baseX/baseY/baseZ` 取玩家位置**（`WebPreviewScreen.java:308-313`）；游戏内宿主的 RELATIVE 基准点应一致（玩家/触发点），否则写回偏差。
5. **无 ack**：进入/退出无回执；编辑器只能等 `flight.state`/`flight.exit`。
6. **飞控与编辑器 UI 的输入竞争**：飞控中鼠标用于视角（14-05）；编辑器 HUD 只显示，不接收鼠标。
7. **全屏 lane 渲染未实现**：Z 文档明确「选中片段画面的全屏 lane 渲染」未做（`flight-mode.md` §二/§五）；游戏内宿主当前只能看主画面，不是该片段单独镜头。本轮不承诺。
8. **无 owner 定向**：现有 WebUI 广播 `flight.exit`（`broadcastText`），多窗口会让非发起窗口误写回；14 必须 `send(ownerEndpointId,...)`。
9. **无冲突处理**：两个端点同时进入飞控时，现状没有“只允许一个 owner”的实现；14 必须返回失败并给出原因。
10. **无 owner 断开兜底**：owner 端点 detach/关闭时，飞控必须取消并恢复，不向其他端点发写回。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 进入入口 | `WebPreviewScreen.enterFlightMode` | `EditorFlightControl.enter(endpointId,...)`（03-08 §3.6），不依赖 Screen |
| 退出入口 | `WebPreviewScreen.requestFlightExit` | `EditorFlightControl.exit(endpointId,record)` |
| 推送 | `WebPreviewScreen.broadcast*` | `EditorPush.send(owner,...)`；`flight.state` 只发 owner（或按合同允许的广播，但 `flight.exit` 绝不广播） |
| owner | 无 | 同一时刻一个 owner；冲突返回 false+reason |
| 基准点 | 玩家位置 | 同（玩家/触发点）；文档写明 |
| ack | 无 | `editor.ack{op:"enter_flight_mode"}` / `exit`；关键失败明确 |
| 全屏 lane | 未实现 | 不在本轮；继续用主画面，不冒充「单镜头」 |
| 状态节流 | 100ms | 同 |
| owner 断开 | 无 | 宿主取消飞控、恢复进入前状态、不向其他端点写回 |

### 3.2 拟新建（提案）

- `MOD:api/editor/EditorFlightControl.java`（03-08 合同；若未落地，本任务实现）
  - `enter/exit/isActive/ownerEndpointId/state`
  - 内部转调 `FlightModeManager` 与 `CameraManager` 的回落逻辑，不依赖 `WebPreviewScreen`
- `MOD:editor/ingame/IngameFlightControl.java`（提案）
  - 实现 owner 表、冲突拒绝、`flight.state`/`flight.exit` 定向、owner detach 兜底
  - 使用 `EditorPush.send(owner,...)`；不 broadcast `flight.exit`
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorFlightBridge.java`（提案）
  - 发 `editor.enter_flight_mode` / `exit` / `cancel`；接收 `flight.state`/`flight.exit`；更新 UI 叠层；写回关键帧（复用 02 轮文档事务）
  - 采样/写回口径复用 02/12-07，不另写公式
- **不新建**第二套飞控核心；不复制 `FlightController`。

## 4. 输入输出与字段约束

### 4.1 进入

请求：`editor.enter_flight_mode{x?,y?,z?,yaw?,pitch?,roll?,fov?,zoom?,absolute}`。

| 字段 | 类型 | 缺省 |
|---|---|---|
| `x/y/z` | double | 回落当前相机位置；无相机时 `Vec3.ZERO` |
| `yaw/pitch/roll` | float | 回落当前相机；无相机时 0 |
| `fov` | float | 回落当前相机；无相机时 70 |
| `zoom` | float | 回落当前相机；无相机时 1 |
| `absolute` | boolean | false |

约束：编辑器只发「能忠实计算」的字段；相对位置基准、`look_at`、`orient=tangent`、`cam_breath` 等留空，由游戏端回落（`flight-mode.md` §二）。进入前必须校验选中片段/关键帧；无选中不得进入。

### 4.2 状态

推送：`flight.state{x,y,z,yaw,pitch,roll,fov,zoom}`，100ms，只发 owner。

约束：只更新 HUD/状态，不每帧写关键帧（`ED:store.ts:316-318` 注释）；owner 之外的端点不接收/不更新飞控 HUD。

### 4.3 退出

请求：`editor.exit_flight_mode`（保存）或 `editor.cancel_flight_mode`（取消）。

推送：`flight.exit{cancelled,...}`，只发 owner。

| 字段 | 保存 | 取消 |
|---|---|---|
| `cancelled` | false | true |
| `x/y/z/yaw/pitch/roll/fov/zoom` | 最终值 | 不发送 |
| `absolute` | 模式 | 不发送 |
| `baseX/baseY/baseZ` | 玩家位置（RELATIVE 写回基准） | 不发送 |

约束：编辑器收到 `cancelled=false` 才写回；写回是一次性操作，随后 `pushScript`（`ED:store.ts:320-327`）。非 owner 调用 `exit` 返回 false，不改飞控状态；owner 断开时宿主 `cancel`，不发写回。

### 4.4 写回

- ABSOLUTE：`pos.x/y/z = data.x/y/z`，删除 `dx/dy/dz`。
- RELATIVE：`pos.dx = data.x - baseX` 等，删除 `x/y/z`。
- `yaw/pitch/roll/fov/zoom` 直接写。
- 写回选中关键帧；不重写整段（`flight-mode.md` §二）。
- 写回是一次文档事务；失败不半写；之后 `pushScript`。
- 取景（12-07）复用同一采样/写回口径；不另写公式。

### 4.5 失败

| 场景 | 行为 |
|---|---|
| 无选中关键帧/片段 | 不进入；`editor.ack{ok:false,reason:"no_selection"}`；UI 提示 |
| 无相机状态 | 游戏端用默认值（`WebPreviewScreen.java:176-186`）；不 NPE |
| 另一端点已进入飞控 | 返回 false，`reason:"busy"`；不改状态 |
| 非 owner 退出 | 返回 false；不改状态 |
| 飞控中关闭编辑器（owner） | `cancel()`；恢复进入前状态；不写回 |
| 非 owner 关闭编辑器 | 不影响飞控；不发 `flight.exit` |
| 退出时无 `activeScreen` | 目标：`EditorFlightControl` 不依赖 Screen；仍可退出 |
| 推送队列满（关键） | `sendCritical=false` → 端点 detach + UI 明确失败；不假成功 |
| 全屏 lane 未实现 | UI 明确「当前显示主画面」；不宣称单镜头 |

## 5. 修改步骤

1. 主模组落地/确认 `EditorFlightControl`（03-08），`WebEditorApi` 的进入/退出改调它；ingame 实现 owner/定向。
2. 编辑器实现 `EditorFlightBridge`：进入/退出请求、状态叠层、写回。
3. 推送改走 `EditorPush.send(owner,...)`；`flight.state` 100ms；`flight.exit` 绝不广播。
4. 写回复用 02 轮的文档事务与 `sampleCameraPose` 口径；12-07 复用。
5. 关闭时取消飞控（14-07）；非 owner 不取消。
6. 全屏 lane 渲染保持未实现；UI 明确「当前显示主画面」。
7. 14-08 验证 owner 定向/写回/取消；14-09 验证 12-07 取景复用。

## 6. 禁止修改

- 不改 `FlightController` 的相机接管/输入语义。
- 不每帧写关键帧；只在退出时写回。
- 不把 RELATIVE 写回成绝对坐标（必须减基准点）。
- 不承诺「选中片段全屏 lane」已实现。
- 不在飞控中同时让编辑器 UI 接收鼠标。
- 不广播 `flight.exit`；不让非 owner 取消他人飞控。
- 不用 `WebPreviewScreen.activeScreen` 作为 ingame 退出前置。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `EditorFlightBridge`、UI 叠层、写回 |
| 编辑器 `webui` | `store.ts` 的飞控逻辑（现状；同语义） |
| 主模组 `main` | `api/editor/EditorFlightControl`、`editor.ingame.IngameFlightControl`、`WebEditorApi` 改造、`FlightModeManager`（复用） |

## 8. 前置

- 03-08 §3.6 的 `EditorFlightControl` 合同。
- 14-04 的 `EditorPush`/`EditorEndpoint`/关键回执。
- 14-05 的输入路由（飞控键/鼠标）。
- 02 轮的文档事务（写回关键帧）；12-07 的取景采样口径。
- 14-07 的关闭/owner detach 兜底。

## 9. 正反例验收

**正例 A**：选中 CAMERA 片段 → 进入飞控 → `flight.state` 10Hz → HUD 显示位置/朝向/光学。
**正例 B**：WASD/鼠标移动相机；F7/退出保存 → `flight.exit{cancelled:false,...}`；关键帧写回；`pushScript` 后画面更新。
**正例 C**：ESC 取消 → `flight.exit{cancelled:true}`；相机恢复进入前；关键帧不变。
**正例 D**：无相机状态时进入 → 默认值（0,0,0 / 0 / 70 / 1），不 NPE。
**正例 E**：飞控中关闭编辑器（owner）→ 取消飞控、恢复相机、关闭 Screen；不写回。
**正例 F**：同时开 WebUI 与 ingame，ingame 进入飞控 → `flight.exit` 只到 ingame；WebUI 不写回、不被取消。
**正例 G**：另一端点已飞控时 ingame 进入 → 返回 busy；不改状态；UI 明确提示。
**正例 H**：非 owner 关闭 → 飞控继续、无 `flight.exit` 到其他端点。

**反例 A**：无 `WebPreviewScreen` 时 `requestFlightExit` 直接 return → 退出无效；验收不通过。
**反例 B**：每帧写关键帧 → 撤销栈爆炸/脚本脏；验收不通过。
**反例 C**：RELATIVE 写回直接用世界坐标 → 偏移错误；验收不通过。
**反例 D**：飞控中编辑器 UI 同时接收鼠标 → 视角与 UI 争抢；验收不通过。
**反例 E**：声称「选中片段全屏 lane」已实现 → 与 `flight-mode.md` §五不符；验收不通过。
**反例 F**：`flight.exit` 广播 → 非 owner 写回；验收不通过。
**反例 G**：非 owner 关闭取消飞控 → 验收不通过。
**反例 H**：进入/退出无 ack、关键推送静默丢 → 验收不通过。

## 10. 真实游戏冒烟（未执行）

前置：主模组 `EditorFlightControl` + ingame 实现落地 + Forge 1.20.1 dev run + AUI 页面。

1. 选中 CAMERA 片段，进入飞控；观察 HUD 与游戏画面。
2. 移动/滚转/缩放/FOV/重置光学；确认状态推送。
3. 退出保存/取消；检查关键帧与画面。
4. 飞控中关闭编辑器；确认相机恢复、无写回。
5. 无相机状态/无选中片段；确认提示或默认值。
6. 同时开 WebUI，确认 `flight.exit` 只到 ingame；反向关闭也不取消 ingame 飞控。
7. 另一端点已飞控时进入；确认 busy。

**本轮未执行**：主模组合同未落地，无 Forge 运行环境；以上为 14-08 统一冒烟的一部分。

## 11. 完成定义

- 进入/退出不依赖 `WebPreviewScreen`；`EditorFlightControl` 是唯一入口；owner 唯一。
- 状态/退出字段、节流、RELATIVE 基准、写回口径与 WebUI 一致。
- `flight.exit` 只发 owner；非 owner 关闭不取消飞控；owner 断开取消并恢复、不写回。
- 关键回执/推送失败明确；不假成功。
- 全屏 lane 未实现明确标注；不冒充。
- 12-07 取景复用同一采样/写回口径；不另写公式。
- 未执行的真实冒烟明确标注。
