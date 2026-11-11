# 08 镜头、转场与多 lane 合成

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划；现有运行时是消费对象，不是本轮成果）
> 范围：CAMERA 轨道的字段面、六通道转场编辑、多 lane 合成呈现、相机连续性诊断、玩家移动预演、取景直控。不含时间轴交互（05）、路径几何与曲线（07）、EVENT/MOD_EVENT 记录编辑（11）、模板与飞控（12）。
> 前置：03（宿主信号与真实画面）、06（异步对象与属性关键帧）、07（位置/路径/曲线模型）；共同前置 01/02。
> 关联：`../05-timeline-workspace/README.md`、`../07-position-path-curves/README.md`、`../11-triggers-rules-events/README.md`、`../12-templates-flight-tools/README.md`、`../14-aui-forge-migration/README.md`

**路径记号**：`MOD:` = `ImmersiveCinematics/`；`J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`EDITOR:` = `ImmersiveCinematicsEditor/`（webui 分支）；`INGAME:` = 编辑器仓库 `1.20.1` 分支（只 `git show` 读）。行号是 2026-11-11 的核查坐标，改动后以符号为准。

## 一、摘要

本轮把 CAMERA 从「只能改 yaw/pitch/fov 的通用表单」补成完整的镜头作者面：位置与朝向源、光学、lane 合成参数、lane 级调色、运动模型、手持呼吸、六通道转场、覆盖链修饰符、选择器策略；并把「多 lane 谁压谁」「这次播放会不会被打断」「玩家会怎么走」「取景怎么直控」四件事在编辑器里做成可读、可校验、可回放的呈现。

一句话验收：作者能在编辑器里写出一个**主模组 `ScriptParser` 能解析、`ScriptValidator` 能通过、游戏内能原样播放**的 CAMERA 脚本，并且转场/多 lane/连续性的结果在提交前就能被看见与解释。

现状（起点，不是本轮成果）：

| 事实 | 锚点 |
|---|---|
| 编辑器 CAMERA 面板只有通用 `DynamicForm`，字段来自旧 `schema.tracks[type].clips` | `EDITOR:src/components/ClipPanel.vue:8-20`、`EDITOR:src/components/DynamicForm.vue`（142 行） |
| 旧模型把关键帧当整帧快照，不是对象叶子路径 | `EDITOR:src/types.ts:103-141`（`Keyframe`）、`:144-183`（`Clip.keyframes`） |
| 转场只有单值时长与对齐工具 | `EDITOR:src/operations.ts:28-39`（`getTransitionDuration`/`getTransitionStart`）、`:55-75`（`applyTransitionAlignment`） |
| 编辑器不知道 lane 的存在 | `EDITOR:src/components/Timeline.vue:163-192` 只有单轨色条与标签；无 lane 列表 |
| 连续性字段只在 meta 通用表单里 | `EDITOR:src/components/PropertyPanel.vue:4-18`（`state.schema.meta` 全量渲染） |
| 玩家移动无 UI | `J:script/PlayerMoveController.java:52-164` 完整，编辑器零入口 |
| 直控只有五个角度参数，没有位置 | `J:webui/WebEditorApi.java:289-295`（`handleSetCamera`） |

## 二、为什么做

### 2.1 问题

- **字段面缺失**：`cameraObjects()` 登记了 position/facing/orientation/camera/composite/color/motion/breath/transition/modifier/selector 共 11 组（`J:script/schema/TrackSchemas.java:109-347`），旧面板只按 `clips` 的平铺字段渲染，`position_mode`、`position_space`、`position_origin*`、`facing_source`、`look_at`、`orient`、`selector_*` 都没有入口。作者写不出「相对基准 + 朝向锁 + 切线朝向」这类组合。
- **转场不可编辑**：`transition_params` 是 `STRUCT`（`TrackSchemas.java:318`），`ObjectValidator` 不做转场校验（无 `checkTransition`），非法形态在 `ScriptParser.parseTransitionParams（858-897）` 解析期直接抛错。编辑器只有一个 `transition_duration` 数字框，六通道 `mode/duration/curve` 完全写不出来；`transition_interrupt` 也没有语义提示。
- **多 lane 不可见**：运行时已有完整的 lane 链——`CameraTrackPlayer.getLaneSnapshots（70-77）`、`LaneSnapshotCollector.captureLowerLanes（64-89）`、`ScriptLaneDriver.tick（77-183）`、`LaneRenderer.setLane（278-311）/renderLane（549-）`、`LaneCompositor.compose（74-201）`。编辑器只有一条 CAMERA 轨，作者不知道重叠窗口会产出两条 lane、不知道后 clip 压前 clip、不知道 `dest/source/mask` 会改变画面比例。
- **连续性不可解释**：`meta.play_mode`、`priority`、`interruptible`、`hold_at_end`、`macro_loop*` 决定脚本之间与脚本内部的叠加/打断（`J:script/schema/MetaSchemas.java:34-43`、`J:camera/PlaybackLifecycle.java:132-146/231-253`），但编辑器只给通用表单，没有「这次播放会不会被另一个实例顶掉」的诊断。
- **玩家移动不可预演**：`PlayerMoveController` 按 EVENT 轨的 `Position(x,z,relative)` 目标驱动假输入（`J:script/PlayerMoveController.java:52-164`、`J:script/event/EventRecord.java`），编辑器既看不到目标点，也不知道相对基准是激活位置。
- **直控缺位置**：`handleSetCamera` 只接受 yaw/pitch/roll/fov/zoom（`WebEditorApi.java:289-295`），而运行时 `CameraManager.setCameraDirect` 有带位置的重载（`:310`）。取景时想「站到某点看某处」只能靠飞控（12），两套入口语义不同。

### 2.2 目标

1. CAMERA 片段的所有 schema 字段都能在**片段效果控件（`clip.effects`）**中按 `section` 分组编辑：叶子成行、复用 06 的统一行与值控件，多个组可同时展开；不为单个叶子或单个组新开独占面板。`group` 做互斥/联动，`requires` 做启用门禁，不出现第二份硬编码字段表。
2. 六通道转场表可编辑（`mode/duration/curve`），`transition_interrupt` 的 `blend/snap` 有行为说明；时间轴上能看到每条通道的窗口宽度与交界位置。
3. 多 lane 合成有独立呈现：lane 顺序、每 lane 的 `dest/source/mask/opacity/dimension`、lane 级调色归属；编辑的仍是片段字段，不是运行时快照。
4. 连续性诊断可读：当前实例的 `play_mode/priority/interruptible/skippable/hold_at_end`、宏循环折返点、片段 `loop/loop_count/loop_mode`、`transition_interrupt` 与循环的交互，都在一个地方说清。
5. 玩家移动预演：读 EVENT 轨的 `Position` 记录，画出目标点与相对基准，标注 `ARRIVE_EPS` 判定与循环重置。
6. 取景直控：预览上方可切换「直控」，能设位置与角度，但**不写脚本**；与 12 的飞控语义分开。

### 2.3 非目标

- 不重写运行时求值/合成/转场算法；编辑器只生成 JSON 与呈现结果。
- 不新增 CAMERA 字段、不新增转场模式、不新增插值类型。
- 不编辑 EVENT/MOD_EVENT 记录（归 11）；本轮只读 `Position` 用于预演。
- 不编辑路径/曲线几何（归 07）；本轮只消费 `motion_*` 与 `transition_curve` 的结构字段。
- 不做 lane 的 GPU 合成预览替代品：画面永远来自 03 的真实游戏帧；lane 面板是参数与顺序的编辑/解释，不是本地渲染器。
- 不实现飞控（归 12）；直控只做静态取景。

## 三、方案

### 3.1 用起来是什么样

**效果控件·镜头组**（选中 CAMERA 片段时，在 `clip.effects` 内）：顶部显示片段身份、轨道类型、局部时长与局部标尺。组按 `section` 折叠，组内每个叶子一行（名称、值/未设置、mode/可用性、秒表、前后节点），右列是该属性自己的节点；可同时展开多个组，切换选中行不隐藏其他组。片段 `start_time/duration/loop*` 由 05 的片段编辑承担，这里只读展示并复用同一片段命令。

| 分组 | 内容 | 交互要点 |
|---|---|---|
| 位置 | `position.x/y/z`、`position_mode`、`position_space`、`position_origin*`、`position_origin_freeze` | 切换 `position_mode` 时保留另一模式的数值但不写盘；`space=base` 时提示基准系 |
| 朝向源 | `facing_source/target/target_offset/entity` | `facing_source=line` 时才启用 `yaw_base_from/to` |
| 朝向 | `yaw/pitch/roll`、`yaw_lock/pitch_lock`、`yaw_base*`、`look_at*`、`orient`、`yaw_offset/pitch_offset` | `orient=tangent` 时才启用 offset（`requires` 由 schema 给出） |
| 光学 | `fov`、`zoom` | `zoom` 是 GEOMETRIC 插值，曲线预览按几何域 |
| 合成 | `opacity`、`dest.*`、`source.*`、`mask_*`、`mask_shape`、`dimension` | 与 03 的 lane 面板联动；`dimension` 非空时标注「跨维度 lane」 |
| 调色 | 57 通道 + 10 曲线 | 与 10 的调色组共用控件；CAMERA 自带调色在 lane 合成前生效 |
| 运动/呼吸 | `motion_*`、`cam_breath_*` | `motion_*` 是 value-only 结构，编辑的是模型参数不是关键帧 |
| 转场 | `transition`、`transition_duration`、`transition_curve`、`transition_params`、`transition_interrupt` | 六通道表见 02；它是本片段的一个组，不是独立页 |
| 修饰符 | `modifier`、`suppress_modifiers` | `modifier` 是 value-only 结构；优先级/掩码/合成模式按 `CameraModifier` 语义展示 |
| 选择器 | 6 个通用字段 + 7 个调用点专属字段 | 调用点名单来自 `ObjectCallpoints.NEW_CALLPOINTS`（`J:script/object/ObjectCallpoints.java:17-21`） |

**转场组**（效果控件内，随 CAMERA 片段展开）：六行通道表（position/yaw/pitch/roll/fov/zoom），每行 `mode`（BLEND/HOLD/CUT）、`duration`、`curve`；右侧一条时间轴示意，窗口以交界为中心、宽度=该通道时长；底部 `transition_interrupt` 二选一与说明。窗口只是定位示意，判据仍是 02 的 `covers()`。

**合成页**（文档级面板，选中 CAMERA 轨或片段时打开；不是片段效果控件的替代）：lane 列表按 `CameraTrackPlayer.getLaneSnapshots` 的顺序（后 clip 在上），每行显示来源片段、`dest/source/mask`、`opacity`、`dimension`、lane 级调色；可跳转到对应片段。顶部一条「覆盖链」说明：Base（脚本 100 / 直控 200 / 飞行 300 / 外部 400）→ Modifier（按 `modifierPriority` 升序）→ 统一快照。

**连续性抽屉**（底部抽屉，行为页的一部分）：当前播放实例的 `play_mode/priority/interruptible/skippable/hold_at_end`、宏循环折返、片段循环、`transition_interrupt` 与循环交界的关系；只读诊断 + 跳转到 01 的 meta 面板或 05 的片段属性。

**玩家移动预演**（行为抽屉的「事件」页）：EVENT 轨的 `Position` 目标点列表、相对基准（激活位置）、`ARRIVE_EPS=0.05` 判定、循环重置；EVENT 片段在主时间轴只是片段，记录在 `clip.effects` 的事件记录组与 11 的专用编辑器里编辑，本页只读。

**取景直控**（预览上方按钮）：进入直控后，预览画面由 `PreviewChannel.setPreviewDirectControl` 接管；面板可设位置/角度/视场，值不写脚本；退出即恢复。写回目标与定位走 `clip.effects` 的共享 Selection（见 06）。

### 3.2 边界

- 所有编辑都走 02 的文档命令；本轮不新增消息。
- CAMERA 字段编辑的唯一承载是 `clip.effects` 的镜头组：不存在"每个叶子一个独立面板"，也不存在把整组做成独占检查器页。`selection.properties` 只显示当前项摘要并定位回效果控件，不存第二份值或节点时间轴。
- 主时间轴只显示/选择 CAMERA 片段与 lane 窗口，不展开组、属性行、节点或关键帧汇总；转场窗口示意不画在片段上作为可拖节点。
- 转场/lane/连续性的呈现是**对 JSON 的解释**，不是运行时求值副本；数值以游戏内播放为准。
- 位置/路径的几何编辑归 07；本轮只消费 `position_*` 字段并显示路径绑定结果。
- 片段 `loop/loop_count/loop_mode/exit` 的编辑归 05；本轮只读并解释其与转场的关系。
- EVENT/MOD_EVENT 记录归 11；本轮只读 `Position`。
- 飞控归 12；直控与飞控不共享状态机。

## 四、技术细节

### 4.1 核心模型

| 模型 | 承载 | 职责 |
|---|---|---|
| 轨道驱动 | `J:script/CameraTrackPlayer.java` | `onRenderFrame（97-165）`、`getLaneSnapshots（70-77）`、`transitionPairAt（189-203）`、`writeGlobal（178-187）` |
| 帧求值 | `J:camera/source/CameraFrameEvaluator.java` | `renderSingle（144-165）`、`renderMorph（166-179）`、`renderMorphFullState（180-216）`、`applyClipEffects（246-287）`、`findActiveClips（360-374）` |
| 下层 lane 捕获 | `J:camera/source/LaneSnapshotCollector.java` | `captureLowerLanes（64-89）`；锁状态留底/回写 |
| lane 链 | `J:client/lane/ScriptLaneDriver.java` | `tick（77-183）`、`applyModifiers（224-237）`、`resolve（311-330）`、`maskShape（331-337）`、`compose（338-350）`、`slot（351-366）` |
| lane 渲染 | `J:client/lane/LaneRenderer.java` | `setLane（278-311）`、`render（353-）`、`renderLane（549-）`、`adjustTarget（764-792）` |
| lane 合成 | `J:client/lane/LaneCompositor.java` | `compose（74-201）`、`checkMask（216-246）`、`Rect.FULL（63）` |
| 遮罩 | `J:client/lane/LaneMask.java` | `SHAPE_FULL/RECT/CIRCLE（17/19/21）`、`DEFAULT_*（24-30）`、`set（49-）` |
| 覆盖链 | `J:camera/cover/CameraCoverChain.java` | `register/unregister（46-71）`、`snapshot（73-82）`、`evaluate（83-99）`、`modifiersApplied（100-107）`、`winnerPriority（109-117）` |
| 通道 | `J:camera/cover/CameraChannels.java` | 6 位掩码（`18-33`）、`NAMES（36）`、`bitOf（51）`、`defaultMode（67）` |
| 修饰符 | `J:camera/cover/CameraModifier.java`、`ComposeMode.java`、`J:camera/ClipModifierGate.java` | `modifierPriority/channelMask/composeMode/writeValue`；REPLACE/ADD/MULTIPLY |
| 转场 | `J:camera/transition/TransitionSpec.java` | `resolve（63-68）`、`windowStart（89-93）`、`windowEnd（94-106）`、`covers（107-115）`、`instantiateCurves（116-126）` |
| 转场混合 | `J:camera/transition/CameraTransitionLayer.java` | `blendInto（90-121）`、`isActive（122-126）`、`reset（127-）` |
| 玩家移动 | `J:script/PlayerMoveController.java` | `onScriptStart（52-89）`、`onRenderFrame（90-119）`、`applyFakeInput（120-130）`、`onStop（158-164）` |
| 直控 | `J:camera/PreviewChannel.java`、`J:camera/CameraManager.java` | `setPreviewDirectControl（100-114）`、`pushScript（115-126）`、`setCameraDirect（303-318）` |

### 4.2 契约

- **schema 单源**：CAMERA 字段来自 `cameraObjects()`，转场通道顺序来自 `CameraChannels.NAMES`（`J:camera/cover/CameraChannels.java:36`）；编辑器不得复制一份通道名/字段表。
- **效果控件组派生**：CAMERA 的组按 `section` 生成、叶子行由 `ObjectDef` 的 `mode/type/interp/requires/group/appliesTo/unit` 驱动；行与节点几何由 06-EffectControlsRows 负责，左参数列和右节点列共用同一行布局与局部标尺。`appliesTo` 不适用的叶子不显示或禁用并标注，不静默写入。
- **转场窗口**：`TransitionSpec.covers(now, boundary)` 是唯一判据（`TransitionSpec.java:107-115`）；窗口宽度 = 该通道非 CUT 的最大时长（`maxDuration`，`:84-88`）；`HOLD` 在窗口内保持 A 侧、`CUT` 立即切换。
- **转场打断**：`transition_interrupt=blend` 时以中间态为新 A 侧、时长重算；`snap` 立即完成（`CameraTransitionLayer.blendInto（90-121）`）。
- **lane 顺序**：`CameraTrackPlayer.getLaneSnapshots` 按 clip 顺序返回，后 clip 在上（`CameraTrackPlayer.java:70-77`）；morph 窗口两个 clip 合成一条 lane（`CameraFrameEvaluator.renderMorph`）。
- **lane 合成参数**：`CameraLane.composite` 为 `null` 时回落 `CameraLaneComposite.DEFAULT`（全屏）；`dest/source/mask` 是归一化坐标（0–1），`LaneMask.set` 的未知形状按 full（`LaneMask.java:49-55`）。
- **覆盖链**：Base 优先级 100/200/300/400（脚本/直控/飞行/外部）；Modifier 按 `modifierPriority` 升序、同值先注册者先；`channelMask` 6 位；`ComposeMode` 单模式作用于整个掩码（`CameraModifier.java` 类注释、`ComposeMode.apply`）。
- **连续性**：`play_mode=parallel/exclusive/interruptible`、`priority`、`interruptible`、`skippable`、`hold_at_end`、`macro_loop*` 是 meta 字段（`MetaSchemas.java:34-43`）；片段 `loop/loop_count/loop_mode` 是 `playControl`（`TrackSchemas.java:88-94`）。
- **玩家移动**：目标来自 EVENT 记录的 `Position(x,z,relative)`；相对基准 = 脚本激活位置（`PlayerMoveController.onScriptStart（52-89）`）；到达判定 `ARRIVE_EPS=0.05`（`:27`）。

### 4.3 数据形态

- `camera.objects` 叶子：`position.x`、`dest.x`、`mask_width`、`color.r` 等，复合值必须展开（`MOD:docs/SCRIPT_FORMAT.md` §4.1）。
- `transition_params`：`{position:{mode,duration,curve}, yaw:{...}, pitch:{...}, roll:{...}, fov:{...}, zoom:{...}}`；未声明通道继承片段 `transition_duration`/`transition_curve`（`TransitionParams.java:18-58`、`TransitionSpec.resolve（63-68）`）。
- `modifier`：value-only 结构，字段由 `CameraModifier` 语义决定（`priority/channels/mode/values`）；`suppress_modifiers` 是片段级布尔。
- `selector_*`：通用 6 字段 + 7 个调用点专属字段（`selector_refresh_look_at` 等，`ObjectCallpoints.field`）。
- `dimension`：空串 = 玩家当前维度；非空 = 客户端从该维度渲染该 lane（`LaneFrame` javadoc）。

### 4.4 边界

- 不把 `CameraLane`/`LaneFrame` 快照当脚本字段写回；它们是每帧求值结果。
- 不把 `CameraCoverChain` 的 Base 优先级写进脚本；Base 优先级由注册方决定。
- 不在编辑器里计算 `covers()` 之外的转场结果；窗口示意只用于定位。
- 不显示「预计帧」作为真实画面；真实画面走 03。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 继续用通用 `DynamicForm` | 按 `schema.tracks[type].clips` 平铺 | 零开发 | 旧 shape 已与 `playControl/objects` 漂移（`SchemaExporter.exportAll（43）` 只导出这两段）；嵌套 `transition_params` 无法编辑 |
| 在编辑器里重算 lane | 本地实现一套求值/合成 | 可离线预览 | 必然与 `CameraFrameEvaluator` 分叉；画面真值只能来自游戏 |
| 把 lane 做成独立「轨道」 | 在时间轴上再开几条 lane 轨 | 直观 | lane 是重叠窗口的产物，不是持久轨道；会诱导作者写重复片段 |
| 转场只给总时长 | 保持单值 | 简单 | 六通道独立模式/时长是运行时真实能力（`TransitionParams`），单值会丢失 `HOLD`/`CUT` 语义 |
| 连续性只显示 meta 表单 | 复用 01 | 少一个面板 | 作者看不出「会不会被打断」；`PlaybackLifecycle` 的队列/打断语义需要解释 |
| 直控扩展成完整相机 | 加位置输入并写脚本 | 强大 | 直控是预览态，不是脚本编辑；写脚本会让「预览」与「文档」两个状态互相污染 |

**本方案的缺点**：

- 效果控件的镜头组字段多（11 组、上百个叶子），需要折叠与搜索；首次打开的学习成本高。
- lane 面板只能显示「参数与顺序」，不能显示最终像素；作者仍需在游戏里确认遮挡/裁切。
- 连续性诊断是静态推断（基于 meta 与队列规则），不能覆盖运行时所有外部实例。
- 转场窗口示意与真实 `covers()` 可能有亚帧差异，文案必须标注「示意」。

## 六、实现结果

状态：未实现（仅计划）。

现有实现（**起点，不是本轮成果**）：

| 已有 | 锚点 | 缺口 |
|---|---|---|
| CAMERA 轨道与片段渲染 | `EDITOR:src/components/Timeline.vue:163-192`、`TrackListPanel.vue:12-17` | 只有单轨，无 lane |
| CAMERA 字段表单 | `EDITOR:src/components/ClipPanel.vue:8-20` + `DynamicForm.vue` | 读旧 `clips`，嵌套结构不可编辑 |
| 转场时长工具 | `EDITOR:src/operations.ts:28-39`、`:55-75` | 只有单值对齐，无六通道 |
| meta 通用表单 | `EDITOR:src/components/PropertyPanel.vue:4-18` | 无连续性诊断 |
| 直控（角度） | `EDITOR:src/store.ts`（`send`）、`J:webui/WebEditorApi.java:289-295` | 无位置；无直控态 UI |
| 运行时相机/转场/lane | `J:script/CameraTrackPlayer.java`、`J:camera/transition/*`、`J:client/lane/*` | 编辑器零消费 |

| 本轮目标 | 现状 | 差异 |
|---|---|---|
| CAMERA 全字段 | 通用表单 | 新建 `clip.effects` 镜头组 + 分组/联动 |
| 六通道转场 | 单值 | 新建转场表 + 窗口示意 |
| lane 合成呈现 | 无 | 新建合成页（只读顺序 + 跳转） |
| 连续性诊断 | 无 | 新建抽屉页 |
| 玩家移动预演 | 无 | 新建只读预演 |
| 取景直控（含位置） | 仅角度 | 扩展直控 UI + 合同 |

## 七、依赖前轮

- **01-baseline-schema**：`schema.get` 必须导出 `tracks.CAMERA.objects` 的完整 `ObjectDef`（mode/type/interp/default/requires/enumValues/min/max/section/group/appliesTo/unit），以及 `playControl`；否则 `clip.effects` 的镜头组无法按 `group`/`requires` 联动。
- **02-model-contracts**：对象叶子路径身份（`clip + objectPath`）、原子提交/撤销、无损序列化；本轮所有编辑都走这套命令。
- **03-host-transport**：真实画面与 `editor.pushScript/seek/play/pause/stop` 的回执；直控依赖 `editor.setCamera` 的现有形状（不扩消息）。
- **06-async-objects**：`clip.effects` 片段效果控件（`06-ClipEffectControlsPanel` 的组容器 + `06-EffectControlsRows` 的行/节点/局部视口 + `06-PropertyValueForm` 的值提交）与 `selection.properties` 快捷属性；CAMERA 每个叶子都复用该行，不另造关键帧编辑器，也不再使用旧单属性面板。
- **07-position-path-curves**：`position_*` 与 `motion_*` 的几何/曲线编辑；本轮只声明入口与只读呈现。
- **05-timeline-workspace**：检查器宿主、抽屉容器、片段 `loop/exit` 编辑；本轮挂载，不重复实现。

## 八、本轮包含工作

| # | 文件 | 交付物 |
|---|---|---|
| 1 | `01-CameraTrackSurface.md` | CAMERA 11 组字段在效果控件内的组归属、分组/联动/门禁 |
| 2 | `02-CameraTransitionEditor.md` | 六通道转场表、窗口示意、打断语义 |
| 3 | `03-LaneCompositionPanel.md` | 多 lane 顺序、合成参数、覆盖链说明 |
| 4 | `04-CameraContinuityPanel.md` | play_mode/priority/循环/宏循环/转场交界诊断 |
| 5 | `05-PlayerMovementPanel.md` | EVENT Position 的只读预演与跨轮接口 |
| 6 | `06-FramingDirectControl.md` | 直控（含位置）UI、与飞控/预览的分工、写回定位走共享 Selection |

## 九、轮次出口（无遗留）

1. CAMERA 的 11 组字段全部有 UI 归属，且实现为 `clip.effects` 中的组与行；每个叶子的控件由 schema 的 `type/mode/interp/enumValues/min/max/requires` 决定，不存在第二份硬编码字段表。
2. 同一 CAMERA 片段可同时展开多个组；选中一个叶子只改高亮/编辑目标，其他组与行的值与节点仍在原位。
3. 主时间轴只显示/选择片段，不出现组、属性行、节点或关键帧汇总；转场窗口示意不变成片段上的可编辑节点。
4. `transition_params` 六通道可编辑；`HOLD/CUT/BLEND` 与 `blend/snap` 的语义在 UI 上可读；非法形态在提交前被拦截（引用解析期错误，不伪造校验器）。
5. lane 顺序、每 lane 的 `dest/source/mask/opacity/dimension`、lane 级调色归属可见；编辑落到片段字段，不写运行时快照。
6. 连续性诊断覆盖 `play_mode/priority/interruptible/skippable/hold_at_end/macro_loop*` 与片段循环；能指出「会被打断/会叠加/会挂起」的条件。
7. 玩家移动预演显示目标点、相对基准、到达判定；EVENT 记录编辑明确指向 11 与 `clip.effects` 的记录组。
8. 直控可设位置与角度，且不写脚本；与 12 飞控的入口/状态互斥；写回后的定位落在效果控件，不要求主时间轴展开。
9. 所有静态问题可在编辑器内看到；需要运行时的部分标注「需游戏内验证」。
10. 六份任务的验收/反例/冒烟均闭合，不把「面板能打开」当完成。

本轮**不做**且不留给后续兜底：运行时 lane 调试器、转场逐帧曲线编辑器、飞控、EVENT/MOD_EVENT 记录编辑。
