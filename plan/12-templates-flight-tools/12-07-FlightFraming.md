# 12-07 取景飞控（进入采样 / 逐字段回落 / 退出写回）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：03（宿主信号）、06/07（对象模型与点源字段）；同轮：12-01（写回用文档事务）。

## 1. 职责

把游戏内飞控相机接到编辑器：进入时用**选中对象**的真实姿态初始化，退出时把最终姿态写成该对象的叶子路径节点，并明确列出「无法忠实写回」的字段。

选择来源是**片段效果控件（`clip.effects`）的共享 Selection**：片段可在主时间轴或效果控件选；属性/节点只能在效果控件行（或复用同一 Selection 的快捷属性）选。进入与写回都不要求主时间轴展开对象行、属性行或关键帧汇总。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/store.ts:553–598` | `enterFlightMode()`：无选中关键帧时自动建节点；`pushUndo`；用 `ops.sampleCameraPose(clip, state.time)` 取姿态；只发有限字段 |
| `EDITOR:src/store.ts:600–633` | `updateKeyframeFromFlight()`：写 `kf.position.x/y/z` 或 `dx/dy/dz`、`kf.yaw/pitch/roll/fov/zoom`；RELATIVE 用 `baseX/Y/Z` 相减 |
| `EDITOR:src/store.ts:635–641` | `exitFlightMode(record)` 只发命令，等 `flight.exit` 回推 |
| `EDITOR:src/store.ts:95–100` | `flightMode` / `flightState` 状态 |
| `EDITOR:src/components/Preview.vue:443–460` | 飞控 HUD（位置/朝向/FOV/Zoom + 退出/取消按钮） |
| `EDITOR:src/components/KeyframePanel.vue:170–186` | 飞控按钮（`F7`）；旧单属性面板，迁移后按钮改由 `clip.effects` 行/工具栏与快捷属性摘要承载 |
| `EDITOR:src/operations.ts:217–300` | `CameraPoseSample` + `sampleCameraPose`：只输出能忠实计算的字段；循环折算、clamp、角度最短路径 |
| `MOD:J:webui/WebEditorApi.java:245–262` | `handleEnterFlightMode`：逐字段可空 |
| `MOD:J:webui/WebPreviewScreen.java:159–190` | `enterFlightMode`：显式字段覆盖、其余回落当前相机 |
| `MOD:J:webui/WebPreviewScreen.java:300–345` | `broadcastFlightState`（10Hz）/ `broadcastFlightExit`（含 `baseX/Y/Z`、`absolute`） |
| `MOD:J:control/FlightModeManager.java:43–120` | `enter/exit/cancel/tick/isModeAbsolute/getState` |
| `MOD:docs/SCRIPT_FORMAT.md:151–224` | CAMERA 叶子路径（`position_mode/space/origin*`、`yaw/pitch/roll`、`fov/zoom`、`look_at*`） |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/flight/pose.ts` | `samplePose(doc, clipId, objectPaths, time)` | 采样（新模型）；输出 `{writable: Partial<Pose>, unsupported: string[]}` |
| `EDITOR:src/flight/writeback.ts` | `planWriteback(pose, target)` / `applyWriteback(plan)` | 写回计划 + 事务执行 |
| `EDITOR:src/flight/FlightHud.vue` | 组件 | 预览左上角姿态 HUD + 退出/取消 + 未写回清单 |
| `EDITOR:src/flight/session.ts` | `FlightSession` | 进入/退出/取消状态机、错误与超时 |

## 4. 输入 / 输出 / 字段约束

### 4.1 进入

**输入**：共享 Selection（`SelectionRef`：`clip`/`property`/`node`；`clip` 可在主时间轴或 `clip.effects` 选，`property`/`node` 只能在 `clip.effects` 行/节点列或复用同一 Selection 的快捷属性选）、播放头时间、文档、`flight.state`。

**规则**

1. 选区必须是 CAMERA 片段（或其属性/节点）；否则按钮禁用并提示「请先选中相机片段」。不存在从主时间轴对象行/关键帧汇总进入的入口。
2. 目标是 `property`/`node` 时，进入即锁定该属性；目标是 `clip` 时，进入后由退出时选择的属性决定写回目标（默认写位置+朝向+FOV）。
3. 采样：`samplePose` 只输出能忠实计算的字段（沿用 `operations.ts:241–300` 的口径，按新模型重写）：
   - 可写：`position_mode=absolute` 且非贝塞尔路径、非 `follow`、非 `fwd/up/right` 基准时的 `position.x/y/z`；`look_at=none` 且 `orient≠tangent` 且无呼吸时的 `yaw/pitch`；任意情况下的 `roll/fov/zoom`。
   - 不可写（进 `unsupported`）：相对基准点/`position_space=base`、`facing_*`、`look_at` 目标、贝塞尔/路径段、`orient=tangent`、`cam_breath_*`、选择器切换。
4. 发送 `editor.enter_flight_mode`：`{x,y,z,yaw,pitch,roll,fov,zoom,absolute}`，缺省字段不发送（由宿主回落当前相机）。
5. 进入前 `pushUndo()`（一次进入 = 一次可撤销的边界）。

### 4.2 飞行中

- 只接收 `flight.state`（10Hz）更新 HUD；**不写文档**（沿用旧语义：退出才写）。
- HUD 显示：XYZ、Yaw/Pitch/Roll、FOV/Zoom、模式（ABSOLUTE/RELATIVE）、`unsupported` 计数。
- 断连/宿主退出：`FlightSession` 进入 `lost` 态，提示「飞控会话已结束」并丢弃未提交姿态（不自动写回）。

### 4.3 退出与写回

`flight.exit` 携带 `{cancelled, x,y,z,yaw,pitch,roll,fov,zoom,absolute,baseX,baseY,baseZ}`。

**写回计划**

| 目标属性 | 写入路径 | 值 |
|---|---|---|
| 位置（absolute） | `position_mode:{value:"absolute"}`、`position.x/y/z` | 直接写世界坐标 |
| 位置（relative，`position_space=world`） | `position.x/y/z`（相对基准） | `world - base`（`baseX/Y/Z` 由宿主给） |
| 朝向 | `yaw/pitch` | 仅当 `look_at=none && orient≠tangent` |
| 滚转/光学 | `roll/fov/zoom` | 直接写 |
| 其他 | — | 进 `unsupported`，不写 |

- 写回目标是**节点**：若选中的是 `node`，改该节点值；若是 `property`，在播放头处新增/更新该属性节点；若是 `clip`，按 4.1-2 的默认集合写（位置 + 朝向 + 光学，各在播放头处新增/更新节点）。
- 节点时间 = 播放头局部秒（`clamp` 到 `[0,duration]`）；同一属性同时间已有节点则覆盖（一次事务）。
- 写回后 `pushScript` 一次（沿用 `store.ts:596–598` 的意图），并记录 `flight` 来源标记（编辑器元数据，不写脚本）。
- 写回后定位：经共享 Selection 在 `clip.effects` 中选中被写的组/属性行/节点（多属性时选第一条并标出其余），其他已展开组保持可见；主时间轴仅保持片段选中，不新增对象行。
- 取消（`cancelled=true`）：不写回，撤销栈回到进入前（丢弃进入时的 `pushUndo` 效果需与 02 的撤销实现对齐）。

### 4.4 未写回清单

退出后 HUD 保留 5 秒，显示：
「已写回：position.x/y/z、yaw、pitch、fov；未写回：position_origin（相对基准）、look_at（注视目标）、cam_breath（呼吸扰动）」。
未写回字段逐条给出原因（一句中文），并给出「去对应面板手动设置」的跳转——跳转目标是 `clip.effects` 的对应组/行，不是主时间轴对象行。

## 5. 修改步骤

1. 新建 `pose.ts`：把 `operations.ts:241–300` 的采样逻辑改为按 `objects` 路径输出；删除对 `clip.keyframes` 的依赖。
2. 新建 `writeback.ts`：`planWriteback` 产出 `{clipId, path, value}[]`；`applyWriteback` 走 02 的事务，失败整体回滚。
3. 新建 `session.ts`：状态机 `idle → entering → active → exiting → idle`，处理超时（进入 3s 无 `flight.state` → 报错）、断连、重复进入。
4. 新建 `FlightHud.vue`：替换 `Preview.vue:443–460` 的内联 HUD；加未写回清单。
5. `store.ts:553–641` 的三个函数改为薄封装（调用 `session.ts`），删除 `updateKeyframeFromFlight` 的旧写入。
6. 飞控按钮改由 `clip.effects` 的行/工具栏与快捷属性摘要提供（06 承载），删除旧 `KeyframePanel` 单属性面板入口；按钮语义指向 `session.ts`。
7. 写回/取消后统一用共享 Selection 在 `clip.effects` 定位；不新增独立属性面板，不在主时间轴放节点。

## 6. 禁止修改

- 不改宿主 `WebEditorApi`/`WebPreviewScreen`/`FlightModeManager`（主模组本轮不可改）。
- 不写 `look_at`/`facing_*`/`position_origin`/贝塞尔路径的「推测值」。
- 不在飞行中逐帧写文档（旧语义：退出才写）。
- 不做「飞控远程面板」（Z flight-mode.md §五 的远期项）。
- 不做「选中片段全屏 lane 渲染」（依赖多相机与预览隔离，属 08/13）。
- 不得要求主时间轴展开属性行/关键帧来完成进入、写回或定位；不得为飞控另建属性编辑器或第二份 Selection。

## 7. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | `flight.state` 走 WebSocket 10Hz；HUD 在预览左上；退出按钮在 HUD 与 `clip.effects` 行/工具栏两处 |
| 游戏内 Forge | 同进程直接读 `FlightModeManager`；HUD 可省（游戏内已有原生 HUD），编辑器只显示「已写回/未写回」；`F7` 由游戏键位接管 |

## 8. 前置

03 的 `flight.state`/`flight.exit` 语义；06 的 `clip.effects` 行/节点/局部标尺与 `selection.properties`；07 的对象路径与节点语义；02 的事务与撤销；`samplePose` 的循环/clamp 口径。

## 9. 验收

**正例**

1. 选中 CAMERA 片段（absolute、无 look_at、无呼吸）→ F7 → 移动 → 退出：`position.x/y/z`、`yaw/pitch`、`fov/zoom` 在播放头处新增节点；播放可见。
2. 在 `clip.effects` 中选中 `position.x` 属性节点 → F7 → 退出：只改该节点；其他属性不变；退出后该行被选中，其他已展开组仍在。
3. 片段含 `look_at=entity`：退出后清单显示「未写回 look_at」，`yaw/pitch` 未被写；`fov/zoom` 已写。
4. 相对位置片段（`position_space=base`）：退出后 `position.x/y/z` = 世界 − base，且清单提示基准不可写回。
5. 取消：文档与撤销栈回到进入前；无半写节点。
6. 进入 3 秒无 `flight.state`：提示「飞控未启动」，回到 idle，文档不变。

**反例**

1. 飞行中每帧写文档 → 不通过。
2. 把 `look_at` 目标写成 `yaw/pitch` 数值 → 不通过。
3. 退出写回只改 `clip` 级字段（旧模型） → 不通过。
4. 未连接时进入飞控 → 不通过（按钮禁用）。
5. 从主时间轴对象行/关键帧汇总进入飞控，或写回后要求展开主时间轴节点 → 不通过。
6. 为飞控新建属性面板/第二份 Selection → 不通过。

**真实冒烟**：WebUI 连真机，按 1–4 各走一遍（本轮出口）；游戏内 Forge 验证同进程路径与 HUD 差异属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 进入采样、飞行状态、退出写回、未写回清单四段闭环。
- 写回只走 `objects` 叶子路径，且全部在事务内。
- 旧 `updateKeyframeFromFlight` 删除。
- 未写回字段有逐条原因与跳转；跳转落在 `clip.effects`。
- 进入/写回/定位只经共享 Selection；主时间轴无对象行/节点入口，快捷属性无第二套时间轴。
