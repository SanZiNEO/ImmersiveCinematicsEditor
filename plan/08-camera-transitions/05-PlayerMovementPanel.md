# 08-05 玩家移动预演（PlayerMovementPanel）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：08-camera-transitions
> 关联：`04-CameraContinuityPanel.md`、`../11-triggers-rules-events/README.md`、`../05-timeline-workspace/README.md`

## 1. 职责

把 EVENT 轨的 `Position(x,z,relative)` 记录变成可读的移动预演：目标点、相对基准（脚本激活位置）、到达判定 `ARRIVE_EPS=0.05`、循环重置、与 `PlayerMoveController` 的假输入行为。**记录编辑归 11**；本文件只读、校验、解释，并提供跳转。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| EVENT 对象 | `J:script/schema/TrackSchemas.java:381-387` | `event`（EVENT_RECORD）+ `event_type`（默认 command） |
| MOD_EVENT 对象 | `TrackSchemas.java:389-396` | `mod_event` + `event_type` + `data`；归 11 |
| 记录结构 | `J:script/event/EventRecord.java` | `Position(x, z, relative)` |
| 事件驱动 | `J:script/track/BuiltinTrackDrivers.java:17`、`:51-54` | EVENT 无客户端驱动（服务端 `ScriptEventManager`） |
| 轨道注册 | `J:script/track/TrackRegistry.java — createDriver（166-179）` | EVENT 返回 null |
| 玩家移动 | `J:script/PlayerMoveController.java` | `onScriptStart（52-89）`、`onRenderFrame（90-119）`、`applyFakeInput（120-130）`、`isMoving（131-135）`、`onScriptLoop（149-157）`、`onStop（158-164）` |
| 到达判定 | `PlayerMoveController.java:27` | `ARRIVE_EPS = 0.05` |
| 假输入 | `PlayerMoveController.applyFakeInput（120-130）` | `LocalPlayer.input.forwardImpulse=1` + `setYRot` |
| 挂载 | `J:script/ScriptPlayer.java:81`、`:603`（`onRenderFrame` 调用 `playerMovement.onRenderFrame`） | 每帧驱动 |
| 循环重置 | `PlayerMoveController.onScriptLoop（149-157）`、`onStop（158-164）` | 目标索引/移动状态复位 |
| 旧编辑器 | 无 EVENT 记录 UI；`EDITOR:src/components/Timeline.vue:163-192` 只有事件色条 | 零预演 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 目标点列表 | 无 | 按 EVENT 记录顺序显示 `(x,z,relative)` |
| 相对基准 | 无 | 标注「激活位置」并显示基准来源 |
| 到达判定 | 无 | 显示 `ARRIVE_EPS` 与「到达即切换下一个目标」 |
| 假输入 | 无 | 说明 `forwardImpulse=1` + `setYRot`，不模拟完整物理 |
| 循环重置 | 无 | 标注 `onScriptLoop` 复位 |
| 记录编辑 | 无 | 跳 11（本文件不编辑） |
| 服务端/客户端边界 | 无 | 标注「EVENT 记录由服务端驱动，客户端只读」 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/camera/PlayerMovementPanel.vue`（提案）：只读预演 + 跳转。
- `EDITOR:src/components/camera/MoveTargetList.vue`（提案）：目标点列表。
- `EDITOR:src/lib/playerMovePreview.ts`（提案）：从 EVENT 记录提取 `Position` 序列，计算相对/绝对显示坐标与距离；**不**模拟 `LocalPlayer` 物理。

## 4. 输入输出与字段约束

**输入**：EVENT 轨片段的对象树（`event` 记录 + `event_type`）、脚本激活位置（编辑器已知的 `originPos` 或玩家当前位置，来源由 03 回执）、当前播放头时间。

**输出**：只读列表 + 跳转到 11 的记录编辑；不写脚本。

| 项 | 约束 |
|---|---|
| `Position.x/z` | 浮点；`relative=true` 时相对激活位置，`false` 时世界坐标 |
| `Position.relative` | 布尔；缺省语义按 `EventRecord`（不得在 UI 猜） |
| `event_type` | 默认 `command`；其他类型由 11 解释 |
| 目标顺序 | 按 EVENT 记录在片段内的出现顺序；循环时 `onScriptLoop` 复位 |
| 到达判定 | `ARRIVE_EPS=0.05`（水平距离）；不显示「精确到达」 |
| 移动方式 | 假输入前进 + `setYRot` 朝向；不处理跳跃/游泳/碰撞绕行 |

**必须显示的边界**：

- EVENT 轨没有客户端 TrackDriver（`BuiltinTrackDrivers:17`），编辑器不能「预演服务端事件」；本面板只预演 `PlayerMoveController` 的移动目标。
- `PlayerMoveController` 只在脚本播放时驱动（`ScriptPlayer.onRenderFrame`），暂停/停止时不移动。
- 相对基准是脚本激活位置，不是相机位置；两者可能不同。
- 目标点是 `x/z` 平面；`y` 由游戏落地决定，不在记录里。

## 5. 修改步骤

1. 新建 `playerMovePreview.ts`：解析 EVENT 片段的 `event` 记录，提取 `Position` 序列；按 `relative` 计算显示坐标；输出 `{index, x, z, relative, displayX, displayZ}`。
2. 新建 `PlayerMovementPanel`：顶部「相对基准」与「到达判定」说明；中部目标列表；底部「循环/停止」行为。
3. 目标列表：序号、`(x,z)`、相对/绝对、与上一个目标的距离；当前播放头对应的目标高亮（按时间窗口，不按真实到达）。
4. 标注「EVENT 由服务端驱动；本预演只覆盖玩家移动」；`event_type != command` 时提示「类型由 11 解释」。
5. 点击目标以共享clipKey/记录时间定位clip.effects的EVENT记录组，复用06基础记录与11专用内容编辑器；主时间轴只定位对应片段，不展开事件节点。本预演组件仍只读。
6. 在 05 的抽屉「行为」页注册；选中 EVENT 轨或含 `Position` 的片段时可见。
7. 若 03 提供玩家当前位置回执，显示「当前玩家位置」与相对基准的偏差；没有则显示「未知」，不猜。
8. 删除任何「在编辑器里模拟玩家走路」的本地动画（不做）。

## 6. 禁止修改

- 不得改 `PlayerMoveController` 的移动/到达/循环逻辑。
- 不得在前端模拟 `LocalPlayer` 物理或假输入。
- 不得编辑 EVENT/MOD_EVENT 记录（归 11）。
- 不得把 `Position.relative` 的缺省语义写成 UI 自己的假设；以 `EventRecord` 为准。
- 不得把预演坐标当作服务端真实坐标（客户端预测）。
- 不得新增 EVENT 字段。

## 7. 两分支承载

- **WebUI**：只读预演 + 跳转；不写脚本。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同移动诊断/导航，真实状态经03公共端口取得，不复制PlayerMoveController；本轮 WebUI 跨 Forge/Fabric 正常，游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `PlayerMoveController` + 服务端 `ScriptEventManager`。

## 8. 前置

- 01：EVENT 对象 schema（`event`/`event_type`）。
- 03：玩家当前位置/激活位置回执（可选）。
- 05：抽屉容器与选区。
- 06效果控件记录组与11专用事件内容是跳转目标；不把记录编辑交回主时间轴或另造EventClipEditor。

## 9. 验收

**正例**

- 三个 `Position` 记录（相对、相对、绝对）：列表按顺序显示，相对项标注基准，绝对项标注世界坐标。
- 播放头在第二个目标窗口：该行高亮；第一/第三不高亮。
- `event_type=mod_event`：提示「由 11 解释」，不显示移动目标。
- 循环播放：列表标注「循环时 `onScriptLoop` 复位到第一个目标」。
- 点击目标跳到 11 的记录编辑器；返回后预演列表同步。
- 无玩家位置回执：显示「当前位置未知」，不伪造坐标。

**反例**

- 前端模拟玩家走路并显示「已到达」→ 失败（不是真实移动）。
- 编辑 `Position` 值 → 失败（越界）。
- 把相对基准写成相机位置 → 失败。
- 显示 `y` 坐标 → 失败（记录只有 `x/z`）。
- 把 EVENT 轨当成客户端可驱动轨道 → 失败。
- 无回执时显示「当前玩家位置 (0,0)」→ 失败。

## 10. 真实冒烟

1. 造 EVENT 轨：`Position(10,0,relative=true)`、`Position(10,10,relative=true)`、`Position(100,64,200,relative=false)`。
2. 编辑器：列表顺序/相对基准/距离正确；播放头高亮随 seek 移动。
3. 游戏内播放：玩家从激活位置走到 +10,0，再走到 +10,+10，再走向绝对点；与预演一致（允许碰撞绕行差异）。
4. 循环：玩家回到第一个目标重新走；预演标注一致。
5. 停止：玩家停止移动；预演不高亮。
6. 点击目标跳 11：修改 `x` 后返回，预演同步。

## 11. 完成定义

- `Position` 序列、相对基准、到达判定、循环/停止行为全部可读。
- 记录编辑明确指向 11；本面板不写脚本。
- 不模拟物理/假输入；不伪造玩家位置。
- 服务端/客户端边界标注清楚。
- 正例/反例/冒烟全部通过；真实移动以游戏内为准。
