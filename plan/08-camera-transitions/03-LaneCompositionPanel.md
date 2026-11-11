# 08-03 多 lane 合成面板（LaneCompositionPanel）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：08-camera-transitions
> 关联：`01-CameraTrackSurface.md`、`02-CameraTransitionEditor.md`、`../09-overlays-composition/06-CompositionOrderPanel.md`、`../14-aui-forge-migration/README.md`

## 1. 职责

把运行时的多 lane 合成链在编辑器里变成可读、可编辑、可解释的界面：lane 顺序（谁压谁）、每 lane 的 `dest/source/mask/opacity/dimension`、lane 级调色归属、覆盖链（Base → Modifier）说明。编辑落在 CAMERA 片段字段；lane 快照只读。

lane/覆盖链总览仍是专门只读诊断/导航组件；可写字段通过同一Selection定位clip.effects当前CAMERA片段的合成/调色组。不能借总览新增CameraTrackPanel页签、任意lane排序或另一套节点轴。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| lane 快照顺序 | `J:script/CameraTrackPlayer.java — getLaneSnapshots（70-77）` | 按 clip 顺序，后 clip 在上 |
| 本帧活跃片段 | `CameraTrackPlayer.java — frameActiveClips（79-86）`、`indexOfClip（87-91）` | 调试/租约定位 |
| 下层 lane 捕获 | `J:camera/source/LaneSnapshotCollector.java — captureLowerLanes（64-89）` | 锁状态留底/回写；`getLaneSnapshots（42-44）` |
| 帧求值 | `J:camera/source/CameraFrameEvaluator.java — renderSingle（144-165）`、`renderMorph（166-179）`、`renderMorphFullState（180-216）` | morph 窗口两 clip 合成一条 lane |
| lane 收集 | `J:script/ScriptPlayer.java — collectCameraLanes（519-548）`、`collectActiveCameraClips（549-567）`、`activeCameraLanes（568-577）`、`hasActiveCameraTrack（578-）` | 恒等归一 null |
| lane 链驱动 | `J:client/lane/ScriptLaneDriver.java — tick（77-183）`、`applyModifiers（224-237）`、`contentFor（238-253）`、`registerChainLane（254-278）`、`resolve（311-330）`、`maskShape（331-337）`、`compose（338-350）`、`slot（351-366）` | 跨实例平铺；末位 lane = 覆盖链输出替换位 |
| lane 渲染 | `J:client/lane/LaneRenderer.java — setLane（278-311）`、`render（353-）`、`renderLane（549-）`、`adjustTarget（764-792）`、`isPerLaneCullActive（793-）` | 逐 lane FBO；lane 级调色在合成前 |
| lane 合成 | `J:client/lane/LaneCompositor.java — compose（74-201）`、`checkMask（216-246）`、`Rect.FULL（63）` | `written` 标志；mask 检查 |
| 遮罩 | `J:client/lane/LaneMask.java — SHAPE_FULL/RECT/CIRCLE（17/19/21）`、`DEFAULT_*（24-30）`、`set（49-）` | 未知形状按 full |
| 合成参数快照 | `J:script/CameraLane.java`（record：state/clip/sample/composite） | `composite=null` 回落 DEFAULT |
| 合成默认 | `J:script/CameraLaneComposite.java — DEFAULT（24-）` | 全屏 |
| lane 渲染快照 | `J:script/LaneFrame.java`（record：lane/cameraTrackIndex/clipIndex/laneAdjust/dimension） | 每帧有效 |
| 覆盖链 | `J:camera/cover/CameraCoverChain.java — register/unregister（46-71）`、`snapshot（73-82）`、`evaluate（83-99）`、`modifiersApplied（100-107）`、`winnerPriority（109-117）` | Base 优先级 + Modifier 升序 |
| 通道/合成模式 | `J:camera/cover/CameraChannels.java:18-36`、`J:camera/cover/ComposeMode.java` | 6 位掩码；REPLACE/ADD/MULTIPLY |
| 片段修饰符 | `J:camera/ClipModifierGate.java`（25 类；`modifierPriority（59）`、`channelMask（64）`、`composeMode（69）`、`isActiveThisFrame（74）`、`writeValue（85）`） | 每实例一份 |
| 旧编辑器 | `EDITOR:src/components/Timeline.vue:163-192` | 单轨；无 lane 概念 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| lane 列表 | 无 | 按 `getLaneSnapshots` 顺序显示，标注「后在上」 |
| lane 参数 | 无 | `dest/source/mask/opacity/dimension` + 来源片段 |
| 合成顺序 | 无 | 可拖拽排序？**否**：顺序由片段在轨道上的顺序决定，面板只显示并跳转 |
| 覆盖链 | 无 | Base 优先级（100/200/300/400）+ Modifier 列表 |
| lane级调色 | 无 | 显示来源与归属，定位当前CAMERA片段效果控件的调色组及10的共用字段组件 |
| 运行时快照 | 无 | 只读；不写回脚本 |

### 3.2 拟新建（提案）

- `EDITOR:src/components/camera/LaneCompositionPanel.vue`（提案）：lane 列表 + 覆盖链说明。
- `EDITOR:src/components/camera/LaneRow.vue`（提案）：单 lane 参数摘要 + 跳转。
- `EDITOR:src/components/camera/CoverChainView.vue`（提案）：Base 优先级条 + Modifier 列表（只读）。
- `EDITOR:src/lib/laneOrder.ts`（提案）：把「片段顺序 → lane 顺序」的规则写成纯函数，输入是轨道片段数组，输出是 lane 序号；**不**求值相机。

## 4. 输入输出与字段约束

**输入**：CAMERA 轨的片段数组（顺序 + 时间窗口）、每片段的 `dest/source/mask/opacity/dimension`、`modifier`/`suppress_modifiers`、当前播放头时间；可选：03 回传的运行时 lane 计数（仅用于核对，不作为编辑源）。

**输出**：跳转到片段/字段的选区意图；对 `dest/source/mask/opacity/dimension` 的编辑（与 01 同一命令）。

| 项 | 约束 |
|---|---|
| lane 顺序 | 片段在轨道上的出现顺序，后出现的在上；不提供拖拽改序（改序 = 改片段顺序，归 05） |
| `dest.x/y/w/h` | 归一化 0–1；`w/h` 缺省 1；`dest` 决定 lane 在屏幕上的矩形 |
| `source.x/y/w/h` | 归一化 0–1；从 lane 画面裁切 |
| `mask_*` | 归一化；`mask_shape=full/rect/circle`；`LaneMask.set` 未知形状按 full |
| `opacity` | 0–1；lane 合成时使用 |
| `dimension` | 空串 = 当前维度；非空 = 跨维度 lane |
| `modifier` | value-only；`priority` 升序、`channels` 6 位、`mode` REPLACE/ADD/MULTIPLY |
| `suppress_modifiers` | 布尔；true 时该片段不参与覆盖链 Modifier |

**必须显示的运行时事实**：

- `CameraLane.composite == null` → 该 lane 回落 `CameraLaneComposite.DEFAULT`（全屏），面板标注「默认全屏」。
- morph 窗口内两个片段合成**一条** lane（`CameraFrameEvaluator.renderMorph`），不显示成两条。
- 末位 lane 是覆盖链输出的替换位（`ScriptLaneDriver` 类注释/`registerChainLane`）。
- lane 级调色在 lane 合成**之前**生效（`LaneRenderer.adjustTarget`）；master 调色在整屏之后（10）。

## 5. 修改步骤

1. 新建 `laneOrder.ts`：按轨道片段顺序与时间窗口计算「当前时间活跃的 lane 列表」；morph 窗口合并为一条；输出 `{laneIndex, clipId, start, end, composite}`。
2. 新建 `LaneCompositionPanel`：顶部覆盖链说明（Base 100/200/300/400 → Modifier 升序 → 快照），中部 lane 列表，底部「合成规则」注释。
3. LaneRow显示来源片段、时间窗口与dest/source/mask/opacity/dimension摘要；点击按clipKey定位clip.effects对应组合/叶子，必要时显示真实lane专门说明；composite=null标注默认全屏，不在主轴展开对象。
4. `CoverChainView`：显示当前实例的 `modifiersApplied`/`winnerPriority` 语义（只读）；Modifier 列表按 `modifierPriority` 排序，显示 `channelMask` 的通道名与 `composeMode`。
5. 将LaneCompositionPanel作为合成/诊断专门工具注册到05可停靠工具容器，轨道头保留明确打开入口；写参数时导航当前片段效果控件，而非恢复已退役CameraTrackPanel的合成页签。
6. 与 09 的合成顺序面板分工：09 管 OVERLAY/LETTERBOX 的 zIndex 与全屏层；08 管 CAMERA lane 的 dest/source/mask 与覆盖链。两个面板互相链接，不重复字段。
7. 若 03 提供运行时 lane 计数/顺序回执，仅用于「与编辑器推断不一致」的提示；不把回执当编辑源。
8. 删除旧 `Timeline.vue` 中任何「CAMERA 单轨即最终画面」的文案。

## 6. 禁止修改

- 不得在前端求值相机/合成像素；不得实现第二套 `LaneCompositor`。
- 不得把 lane 做成持久轨道或可拖拽排序的列表；顺序由片段顺序决定。
- 不得把 `CameraLane`/`LaneFrame` 快照写回脚本。
- 不得改 `LaneMask` 的形状/默认值或 `CameraLaneComposite.DEFAULT`。
- 不得把 `modifier` 的 `priority` 与 Base 优先级混为一个域（`CameraModifier` 注释明确两域不比较）。
- 不得在 lane 面板编辑 `transition*`（归 02）。

## 7. 两分支承载

- **WebUI**：lane 列表/覆盖链/跳转；编辑走 02 命令；真实画面来自 03。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同lane面板和公共端口联动，沿用运行时合成/排序语义，不直接读内部类或只交合同；本轮 WebUI 的 Fabric 通路正常，只有游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `CameraTrackPlayer`/`ScriptLaneDriver`/`LaneCompositor`。

## 8. 前置

- 01：CAMERA 字段面（`dest/source/mask/opacity/dimension`）。
- 02：转场窗口（morph 合并 lane 的边界）。
- 05：片段顺序/时间轴选区。
- 10：lane 级调色面板（`color.*`/曲线）。
- 03：真实画面（lane 面板不渲染本地合成）。

## 9. 验收

**正例**

- 两个 CAMERA 片段重叠 1s：lane 面板显示两条 lane，后片段在上；morph 窗口内显示一条合并 lane。
- 片段 `dest={0.5,0,0.5,1}`：lane 行显示右半屏；`source` 裁切同理。
- `mask_shape=circle`、`mask_radius=0.3`：lane 行显示圆形遮罩参数；`full` 时标注「无遮罩」。
- `composite=null`（无活跃求值）：标注「默认全屏」，不显示成 0×0。
- `dimension=the_nether`：标注「跨维度 lane」，并说明玩家不跨维度。
- `modifier.priority=10`、`channels=yaw|pitch`、`mode=ADD`：覆盖链显示「yaw/pitch 增量」；`suppress_modifiers=true` 的片段不出现。
- 点击 lane 行跳到 01 的 `dest.w` 字段；撤销一次回到原值。

**反例**

- lane 列表允许拖拽改序并写脚本 → 失败（顺序由片段决定）。
- morph 窗口显示两条 lane → 失败。
- `composite=null` 显示成黑屏/0 尺寸 → 失败。
- 前端本地合成出「预览图」并称为真实画面 → 失败。
- 把 `modifier.priority` 与 Base 优先级放在同一排序表 → 失败。
- lane 面板出现 `transition_params` 编辑 → 失败（越界）。

## 10. 真实冒烟

1. 造三个重叠 CAMERA 片段（A 全屏、B 右半屏、C 圆形遮罩），其中一个带 `dimension`。
2. 编辑器 lane 面板：顺序 A→B→C（C 在上），参数与 JSON 一致；morph 窗口合并。
3. 游戏内播放：画面叠加顺序、右半屏、圆形遮罩与面板描述一致；跨维度 lane 从指定维度渲染。
4. 改 B 的 `dest.w` 0.5→0.3：面板/游戏同步；撤销恢复。
5. 给 A 加 `modifier`（yaw ADD 5°）：游戏内 yaw 叠加；面板显示 Modifier 行。

## 11. 完成定义

- lane 顺序、合成参数、覆盖链、lane 级调色归属全部可见且可解释。
- 编辑落在片段字段；lane 快照只读；不实现第二套合成。
- morph 合并、`composite=null` 回落、跨维度、Modifier 两域等边界都有明确呈现。
- 与 09 的合成顺序面板边界清晰，不重复字段。
- 正例/反例/冒烟全部通过；像素结果以游戏内为准。
