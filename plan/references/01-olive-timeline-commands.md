# 01 Olive 时间线：拖拽 / 吸附 / 选择锁定 / 分割裁切 / 撤销 / 显示范围

> 状态：参考研究文档（只读源码，不改代码、不运行参考软件）。
> 参考快照：[olive](../../../ImmersiveCinematics/example/editor/olive/) 本地快照，git `7e0e94a`（2024-12-05）；[lossless-cut](../../../ImmersiveCinematics/example/editor/lossless-cut/) 本地快照 `3.69.0`。
> 服务轮次：[05-03 时间轴模型](../05-timeline-workspace/05-03-TimelineModel.md)、[05-04 时间轴视图](../05-timeline-workspace/05-04-TimelineView.md)、[05-05 片段编辑](../05-timeline-workspace/05-05-ClipEditing.md)、[05-06 标尺/播放头](../05-timeline-workspace/05-06-RulerPlayheadMarkers.md)、[02-EditorStore](../02-model-contracts/02-EditorStore.md)、[02-SelectionIdentity](../02-model-contracts/02-SelectionIdentity.md)、[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md)；[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) 只作为边界出现——节点命中与局部视口归它，**不归 05**。

## 一、摘要

Olive 的时间线在这几件事上是"状态机 + 命令边界"的好样板，而不是可以照抄的数据模型：

1. 拖拽期间**只改临时幽灵项**，松手时一次性组装 `MultiUndoCommand` 入栈（[pointer.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/timelinewidget/tool/pointer.cpp) `MouseMove 142–190`、`FinishDrag 609–818`）。
2. 吸附是**屏幕像素阈值 + 候选集合 + 最近解**，返回的是"位移量"而不是绝对时间；无候选就隐藏参考线（[timebasedwidget.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/timebased/timebasedwidget.cpp) `SnapPoint 774–908`）。
3. 命中用**半开区间**，指针按下取 floor、刀片取 round，两者的取舍写在注释里（[timelineviewmouseevent.h](../../../ImmersiveCinematics/example/editor/olive/app/widget/timelinewidget/view/timelineviewmouseevent.h) `GetFrame 66–79`）。
4. 选区在 Olive 里是"轨道 → 时间区间"，与我们的 `clipKey/objectPath/keyframeTime` 身份选择**不是一回事**，只能借"选择的随动与幂等"，不能借数据形状（[timelinewidgetselections.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/timelinewidget/timelinewidgetselections.cpp)）。本项目主时间轴只产生片段选择；`objectPath/keyframeTime` 只属于片段效果控件。
5. 锁定在 UI 预检之外，**命令层再跳过一次**（[timelineundoripple.cpp](../../../ImmersiveCinematics/example/editor/olive/app/timeline/timelineundoripple.cpp) `TrackListRippleRemoveAreaCommand::prepare 183–194`）。
6. 分割是"同一时刻、多轨、一个命令"，切点必须严格落在片段内部（[timelineundosplit.cpp](../../../ImmersiveCinematics/example/editor/olive/app/timeline/timelineundosplit.cpp) `BlockSplitCommand::redo 38–79`）。
7. 撤销栈**丢弃空命令**、入栈即清 redo 分支、上限 200；脏标记是"进入命令前记录、撤销时恢复"（[undocommand.cpp](../../../ImmersiveCinematics/example/editor/olive/app/undo/undocommand.cpp) `redo_and_set_modified 47–57`）。
8. 显示范围 = 内容末端 + 一个视口余量，滚动上限由它派生（[timebasedview.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/timebased/timebasedview.cpp) `UpdateSceneRect 270–288`）。
9. 缩放先夹紧再用**夹紧后的 scale** 反算滚动，保证光标下时间不变（[timescaledobject.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/timebased/timescaledobject.cpp) `SetScale 122–127`、[timebasedview.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/timebased/timebasedview.cpp) `ZoomIntoCursorPosition 91–121`）。

**不借的东西**（详见第五节）：素材滑移（media_in/media_out）、GapBlock、磁性/覆盖式放置、roll 自动改邻段、时间区间选择、`EmptyCommand` 哨兵、`prepare()` 内执行 redo。

## 二、时间基与语义差异（先决条件）

Olive 是 NLE，我们是固定格式脚本生成器。下表每一行都决定"能不能借"：

| 维度 | Olive | 我们（02/05/06 已冻结） | 结论 |
|---|---|---|---|
| 时间表示 | `rational` + timebase（帧/采样网格）；`SceneToTime` 默认 floor 到网格（`timescaledobject.cpp 57–75`） | 全局秒 `number`；clip 局部秒只在对象节点内；60fps 预览不量化脚本时间（`shared/contracts.md` C02-7） | 只借"像素↔时间单向换算 + 阈值用 px"，不借帧网格量化 |
| 片段内容 | `Block::in/out` + `ClipBlock::media_in`，裁切同时滑素材 | `clip.start_time/duration` + 每属性独立节点时间（局部秒） | 不引入 media 时间；裁切不动节点时间 |
| 空白 | `GapBlock` 实体，可裁切、可创建 | 时间上没有片段就是空白，无实体 | 不造 gap 片段 |
| 编辑模型 | roll / ripple / slide / 覆盖放置，邻段联动 | 独立片段；移动/裁切不联动邻段（`05-05` 操作约束表） | 只借"一次拖拽一个命令"，不借联动规则 |
| 内容长度 | `Sequence` 长度有限且是权威 | `finiteEnd: number \| null`；`duration<0` = 无限；宏观循环可无限（`05-03` §4） | 显示范围必须支持 null + 窗口 |
| 选择 | 轨道 → 时间区间集合 | 主时间轴只产生片段选择（`clipKey`/`clipKeys`）；`objectPath` + `keyframeTime` 属于片段效果控件（`02-SelectionIdentity` §3.3） | 选择形状完全不借；节点选择不进入主时间轴命中 |
| 引用 | 节点图连线 | `paths[].clip`、`rule_bindings[].clip`、`exit.target`、同属性严格递增 | 引用与异步属性约束优先于剪辑手感 |

由此产生三条硬约束，后文所有适配都必须满足：

- **引用优先**：分割/删除/改 id 前先算影响面；被 `paths`/`rules`/`exit` 引用时默认拒绝或要求先重绑（`05-05` §4、`02-SelectionIdentity` §3.2）。
- **属性优先**：同一属性时间严格递增，冲突拒绝而不是合并（`06-KeyframeEditOps` §3.1）；超出窗口的节点保留并标"不生效"，不钳制、不删。
- **不新增媒体功能**：不做素材滑移、变速、音画同步 ripple、转场参数编辑；本轮只做片段在时间上的移动/裁切/分割与分割时的节点分区。

## 三、证据索引

| # | 文件 | 符号 / 行 | 用途 |
|---|---|---|---|
| E1 | `tool/pointer.cpp` | `MousePress 50–135`、`MouseMove 142–190`、`MouseRelease 192–213` | 拖拽会话开始/更新/结束 |
| E2 | `tool/pointer.cpp` | `InitiateDragInternal 246–515`、`ProcessDrag 529–602`、`FinishDrag 609–818` | 幽灵生成、逐帧校验、一次性提交 |
| E3 | `view/timelineviewghostitem.h` | `FromBlock 62–81`、`GetAdjustedIn 178–180`、`HasBeenAdjusted 208–214` | 临时状态的数据形状 |
| E4 | `timebased/timebasedwidget.cpp` | `SnapData 753–756`、`AttemptSnap 758–772`、`SnapPoint 774–908`、`ShowSnaps 910–915` | 吸附解算 |
| E5 | `timebased/timebasedwidget.h` | `SnapPoints 61–68`、`SnapPoint 74` | 吸附位掩码 |
| E6 | `tool/tool.cpp` | `SnapMovementToTimebase 62–72`、`ValidateTimeMovement 74–95`、`ValidateTrackMovement 97–117` | 网格吸附与边界钳制 |
| E7 | `view/timelineviewmouseevent.h` | `GetCoordinates 57–60`、`GetFrame 66–79` | 指针 → 时间（floor/round） |
| E8 | `view/timelineview.cpp` | `GetItemAtScenePos 853–871`、`GetItemsAtSceneRect 873–898`、`mousePressEvent 62–88` | 命中与框选查询 |
| E9 | `tool/pointer.cpp` | `IsCursorInTrimHandle 821–841` | 手柄宽度与窄片段保护 |
| E10 | `timebased/timescaledobject.cpp` | `SceneToTime 57–75`、`TimeToScene 84–86`、`SetScale 122–127`、`SetMaximumScale 99–106` | 坐标换算与缩放夹紧 |
| E11 | `timelinewidget.cpp` | `SetSelections 2146–2187`、`SelectAll 355–367`、`DeselectAll 369–379`、`SignalSelectedBlocks 1740–1764` | 选择的收敛与通知 |
| E12 | `timelinewidget.h` | `SetSelectionsCommand 246–275`、`GetSelectedBlocks 125` | 选择随编辑提交 |
| E13 | `timelinewidgetselections.cpp` | `ShiftTime 25–30`、`ShiftTracks 32–53`、`TrimIn 57–62`、`TrimOut 64–69` | 选择随位移/裁切调整 |
| E14 | `tool/razor.cpp` | `MousePress 34–39`、`MouseMove 41–54`、`MouseRelease 56–100` | 多轨同刻分割 |
| E15 | `timeline/timelineundosplit.cpp` | `BlockSplitCommand 32–98`、`BlockSplitPreservingLinksCommand::prepare 112–167`、`TrackSplitAtTimeCommand::prepare 169–179` | 分割命令与批次 |
| E16 | `tool/pointer.cpp` | `ValidateInTrimming 948–982`、`ValidateOutTrimming 984–1021` | 裁切最小长度/夹紧 |
| E17 | `timeline/timelineundopointer.cpp` | `BlockTrimCommand 33–179`、`TrackSlideCommand 185–308`、`TrackPlaceBlockCommand 316–386` | 裁切、滑移、覆盖放置 |
| E18 | `undo/undocommand.cpp` | `MultiUndoCommand 27–39`、`redo_and_set_modified 47–57`、`undo_and_set_modified 59–66`、`redo_now 68–79` | 组合命令与脏标记 |
| E19 | `undo/undostack.cpp` | `kMaxUndoCommands 27`、`EmptyCommand 29–40`、`push 62–95`、`undo 107–122`、`redo 124–139`、`clear 141–157`、`CanUndo 159–162` | 历史入栈策略 |
| E20 | `timeline/timelineundoripple.cpp` | `TrackRippleRemoveAreaCommand 46–180`、`TrackListRippleRemoveAreaCommand::prepare 183–194` | 命令层跳过锁定轨 |
| E21 | `timebased/timebasedwidget.cpp` | `UpdateMaximumScroll 152–163`、`SetCatchUpScrollValue 334–355` | 滚动上限与边缘自动滚动 |
| E22 | `view/timelineview.cpp` | `GetTimelineLeftBound 686–689`、`GetTimelineRightBound 691–694`、`drawForeground 207–303` | 视口边界与幽灵绘制 |
| E23 | `timebased/timebasedview.cpp` | `ZoomIntoCursorPosition 91–121`、`UpdateSceneRect 270–288`、`EnableSnap 67–73`、吸附线绘制 `195–204` | 缩放锚定、场景矩形、参考线 |
| E24 | `tool/zoom.cpp` | `MouseRelease 51–101` | 框选缩放与点击缩放 |
| E25 | `node/project.cpp` | `set_modified 314–321` | 脏状态可被撤销恢复的前提 |
| E26 | `timeruler/seekablewidget.cpp` | `SeekToScenePoint 384–405` | 播放头拖动排除自身吸附、重复 seek 抑制 |
| E27 | LLC `src/renderer/src/Timeline.tsx` | `onMouseDown 291–344`、`onMouseMove 347–370` | 浏览器端 window 级指针捕获（辅助） |

## 四、逐点适配

### 4.1 拖拽：临时状态只读文档，松手一次性提交

**来源写法**（E1/E2/E3/E22）
`PointerTool::MousePress` 只记录起点、命中项与模式（`drag_start_`、`drag_movement_mode_`）；`MouseMove` 在第一次移动时创建幽灵项（`InitiateDrag` → `AddGhostFromBlock 861`/`AddGhostFromNull 892`/`AddGhostInternal 909–930`），之后每帧只调 `ProcessDrag` 改"调整量"（`SetInAdjustment/SetOutAdjustment/SetTrackAdjustment`，566–590）；`MouseRelease` 若确有幽灵被调整才 `FinishDrag`，最后 `undo_stack()->push(command, "Moved Clips")`（818）。幽灵项本身只存"原始 in/out/media_in + 调整量"，`HasBeenAdjusted()`（208–214）判断是否真的变过；无调整时 `FinishDrag` 提前 return（630–637）。绘制层用半透明原块 + 黄色边框（`timelineview.cpp 239–270`），并未修改文档。命令完成后 `ClearGhosts()`（`timelinewidget.cpp 1022–1035`），`DeleteSelected` 也在入栈后立刻清幽灵（`ClearGhosts()` 位于 push 之后，551 行），避免拖拽中途拓扑变化后残留预览。

**现状（我们）**：[Timeline.vue](../../src/components/Timeline.vue) `onClipDrag 309–336` 在 `mousemove` 里直接 `commit`（320、325、330 三处），位移用 `clientX` 差值（309–312）；`dragData` 存 DOM 起点而非文档时间，拖动中滚动/缩放会让落点偏移。

**解决什么**：预览与提交分离；拖动过程零撤销污染；取消/无变化不产生历史。

**可借鉴**
- 会话状态（起点、模式、候选吸附点、每组原始值）与文档严格分离。
- 每帧只计算 delta，不读写文档；文档只有在 `endDrag` 才变化一次。
- `HasBeenAdjusted` 级别的"无变化不提交"，比"提交后再判断"便宜且不产生空历史。
- 坐标以"时间"为基准（`drag_start_` 是时间坐标，不是屏幕坐标），所以拖动中缩放/滚动不会让位移算错。
- 拖到边缘时的自动滚动是独立定时器（构造 55–57 设定 250ms 节拍，`SetCatchUpScrollValue 334–355`），松手/取消必须停止（`StopCatchUpScrollTimer`，`ViewMouseReleased 1078–1093`）。

**不能照搬**：幽灵持有 `Block*` 裸指针并直接改 Block 字段（`SetInAdjustment` 只是调整量，但 `FinishDrag` 里到处用原始 Block 引用组装命令）；`SetMediaInAdjustment`（572 行）属于素材滑移；`Block*` 生命周期靠 Qt 父子关系管理。

**映射**
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) §3 `src/timeline/dragSession.ts`：`beginDrag / updateDrag / endDrag`，输出 `DragIntent`（含操作种类、Selection 定位、`deltaSec`、吸附目标）。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) `ClipBlock.vue` 只负责按 `DragIntent` 画半透明块与参考线。
- [05-05](../05-timeline-workspace/05-05-ClipEditing.md) `clipCommands.ts` 在 `endDrag` 时把 intent 翻成一次 `commit`。
- [02-EditorStore](../02-model-contracts/02-EditorStore.md) §3.2 `commit` 是唯一写入口。

**适配步骤**
1. `beginDrag` 缓存 `{clipKey, mode, startTimeSec, origStart, origDuration, pxPerSecondAtStart, snapTargets}`；`origStart/origDuration` 是文档值快照，不是 DOM 值。
2. 指针位置一律换成"文档时间"再算 `deltaSec = tNow - startTimeSec`；禁止用 `clientX` 差值（滚动/缩放/自动滚动都会破坏它）。
3. `updateDrag` 只产出 `{deltaSec, snappedTarget}`；是否夹紧/拒绝由 `05-05` 的 `clipRules` 判定，`dragSession` 不做业务判断。
4. 松手时若 `deltaSec === 0` 且无吸附目标 → 不发命令、不入栈、不置脏。
5. `pointerup`、`pointercancel`、`Esc`、文档被外部替换（撤销/热重载/断连恢复）都走同一个 `cancelDrag()`，清预览并停自动滚动。
6. 自动滚动用 `requestAnimationFrame` 节拍，指针离开视口边缘停止；滚动期间不重新计算 `deltaSec` 的基准（基准是文档时间，天然正确）。

**人工操作检查**
- 拖动一个片段 2.3s，松手只产生 1 条撤销；再撤销一次回到原位（`05-05` §9-1 同口径）。
- 原地按下松手（未移动）不产生撤销条目，脏标记不变。
- 拖动中滚轮缩放、拖到边缘自动滚动后再松手，落点与光标下时间一致（±0.05s）。
- 拖动中按 `Esc`，预览消失、文档与选区均不变。

### 4.2 吸附：候选集合 + 屏幕像素阈值 + 最近解 + 参考线

**来源写法**（E4/E5/E6/E26）
`SnapPoint(start_times, movement, mask)` 把每个"被拖动的边"先加上当前位移换算成屏幕点（776–780），再对各来源的候选做 `AttemptSnap`：播放头（785–789）、其它块 in/out（790–803）、块内标记（805–819）、标尺标记（821–840）、工作区（842–850）、关键帧（852–874）。`AttemptSnap` 用屏幕距离 `kSnapRange = 10`（764 行，注释自认硬编码）筛选；收集完成后按 `|candidate.movement - *movement|` 取最小（877–889），把 `*movement` 改成命中候选的位移；再把**同一位移**的所有候选时间交给 `ShowSnaps` 画竖线（898–905），无候选则 `HideSnaps`（878）。`SnapMask` 允许排除某类（`kSnapAll & ~kSnapToPlayhead`，`seekablewidget.cpp 394–398`、`timebasedview.cpp 225–232`），所以拖播放头时不会吸到自己。吸附之后 `ProcessDrag` 会再次做 `ValidateTimeMovement/ValidateInTrimming/ValidateOutTrimming`（544–553），保证吸附不会把片段推出合法范围。网格对齐由 `SnapMovementToTimebase`（62–72）负责：算出 `start+movement` 的网格值，差多少补回 movement。

**现状（我们）**：`snapTime 426–441` 每次调用重建候选（`[0, state.time, 所有 clip 起止]`），阈值 `pxToTime(8)`，命中第一个即返回；没有最近解、没有同距裁决、没有参考线。

**解决什么**：手感与缩放解耦；多候选时有确定解；参考线告诉用户"吸到了谁"；吸附不会破坏边界约束。

**可借鉴**
- 阈值用**屏幕像素**而不是秒（100px/s 与 500px/s 手感一致）。
- 多选整体使用一个位移，不能各自吸附而改变相对位置；本项目由dragSession消费单点时间解并统一导出deltaSec，不改变resolveSnap既有返回合同。
- 同一位移的全部候选都画出来，而不是只画一个。
- 拖播放头时屏蔽"吸附到播放头"。
- 吸附顺序：先算原始位移 → 吸附 → 再校验边界 → 落值。

**不能照搬**
- `kSnapRange = 10` 固定值；我们按 `05-03` 用 8 CSS px（宿主可注入 `dpr*4`），且必须随 `pxPerSecond` 换算。
- 无条件网格对齐：`ValidateTimeMovement` 里即使没有任何候选，也会把第一个 ghost 吸到 timebase 网格（86–91）。我们的栅格是**最低优先级候选**，关闭吸附时完全不吸。
- 每次移动都重扫全部块（`GetSnapBlocks` 返回 `added_blocks_` 全量，`timelinewidget.h 300`）。我们文档在拖动期间不可变，应在 `beginDrag` 冻结候选，`updateDrag` 只做距离筛选。
- 关键帧吸附默认开启（`GetSnapKeyframes`）。主时间轴不显示对象节点，节点时间不作为片段拖动的吸附候选；关键帧自身的吸附只在效果控件局部标尺内由 `06-EffectControlsRows` / `06-KeyframeEditOps` 承担，步长与开关独立。

**映射**
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) §3 `src/timeline/snapping.ts`：`collectSnapTargets(doc, ui)` + `resolveSnap(rawTime, targets, thresholdPx, scale)`。
- [05-06](../05-timeline-workspace/05-06-RulerPlayheadMarkers.md)的playhead.ts：沿用05-03单点时间接口，先从候选集中排除播放头自身，不凭参考虚构额外options参数。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) 参考线渲染（`SnapGuides.vue` 或 `Ruler.vue` 内图层）。
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.2：关键帧吸附只在拖动结束时应用，与片段吸附分属两套阈值。

**适配步骤**
1. `collectSnapTargets` 在 `beginDrag` 调一次，产出 `{time, kind, id}` 列表，kind 覆盖 `clip-start/clip-end/playhead/marker/loop/grid`；同 kind 内去重（`|Δ| < 1e-4`）。对象节点不是主时间轴候选。
2. 沿用05-03的resolveSnap(rawTime, targets, thresholdPx, scale)，对单个时间锚点计算阈值内最近目标，结果仍是吸附后的全局时间，不把函数返回合同改成delta对象。
3. 距离相同才按05-03顺序裁决；优先级只破平局，不让远处高优先级抢走近处候选。
4. 多选整体拖动由dragSession将各候选解换算成相对同一起始快照的位移，选择一个共同deltaSec应用到全部目标；参考线只画这个共同解命中的目标，不逐片段各自吸附造成相对位置改变。
5. 吸附后的统一结果仍过编辑边界/锁定/同属性冲突检查，非法则不提交，不能靠吸附掩盖失败。
6. 关闭吸附时单点返回原时间、整体拖动保持rawDelta，清空参考线且不保留隐藏栅格吸附。

**人工操作检查**
- px/s = 40 时，拖到距另一片段起点 6px → 吸附；12px → 不吸附。
- 放大到 200 px/s 重复同一距离，阈值仍表现为 8px（时间阈值随缩放变小）。
- 两个候选分列两侧且距离相同：落点符合 `05-03` 优先级，且参考线显示被选中的那一条。
- 拖动播放头时不会吸到播放头自己；拖动片段时参考线在目标边界而不是片段边缘。
- 关闭吸附后拖动不出现参考线，落点连续（不偷偷吸栅格）。

### 4.3 命中与指针时间：半开区间、floor/round、手柄宽度

**来源写法**（E7/E8/E9/E10）
`TimelineView::GetItemAtScenePos` 用 `b->in() <= time && b->out() > time`（853–871）——左闭右开，所以两个片段在时间上首尾相接时归属确定。框选查询 `GetItemsAtSceneRect` 先 `NearestBlockBeforeOrAt(start)` 再沿 `next` 走到 `in() < end`（873–898），避免全表扫描。`TimelineViewMouseEvent::GetFrame(round)` 的注释明确：`round=true` 适合"点在帧之间"的刀片，`false`（floor）适合"直接点在帧上"的选择工具（66–79）。`IsCursorInTrimHandle` 用手柄宽度 `kTrimHandle`（字体 "H" 宽，823 行）判定左右热区，且 `block_width <= kTrimHandle*2` 时**整个片段禁用裁切**（830 行），防止窄片段上误触。`TimeScaledObject::SceneToTime`（57–75）对负值用 `qCeil` 向零取整，`TimeToScene = time * scale`（84–86）。

**现状（我们）**：`getMouseTime 207–212` 每次 `mousemove` 读 `getBoundingClientRect`；手柄判定在 `288–300`（固定 8px，无窄片段保护）；指针时间被 `Math.max(0, Math.min(canvasDuration, ...))` 夹进画布（242、254、262），而不是拒绝越界。

**解决什么**：相邻片段归属无歧义；点击位置与"看起来在哪一帧"一致；窄片段不会因为两个手柄重叠而无法拖动。

**可借鉴**
- 半开区间作为命中与"包含"的唯一规则，命中测试、框选、分割点判定共用。
- 框选从"起点的前一个块"开始，顺序走链表/有序数组，而不是遍历全部。
- 刀片用最近时间、选择用 floor 的分工。
- 手柄宽度按内容度量（字体高度）而非拍脑袋常数；窄片段整体拖动。
- 像素→时间只做一次换算并缓存 `viewportRect`（`05-04` 步骤 6 已要求）。

**不能照搬**：把每次指针位置量化到 1/timebase（我们的时间是真值秒，量化只发生在吸附或用户输入）；负值"向零取整"（我们应直接拒绝 `start<0` 的落点，而不是悄悄挪到 0）。

**映射**
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) §3 `src/timeline/hitTest.ts`：输入主时间轴的行布局表，输出命中项与命中区（轨道/片段体/左手柄/右手柄）；**不包含对象行或节点**。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) §4 交互约束：刀片不进入拖拽、双击添加片段。
- [05-05](../05-timeline-workspace/05-05-ClipEditing.md) `clipRules.canTrim`：宽度过窄时返回不可裁切。
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) `scale.ts`：`timeToPx/pxToTime` 唯一换算点。
- [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)：效果控件右列的节点/行命中；复用"半开区间 + 显式命中矩形"的思想，但使用片段局部秒和它自己的局部视口，不调用主时间轴 `hitTest`。

**适配步骤**
1. `hitTest(rows, x, y)`：先定行（轨道/片段），再判左右手柄；主时间轴行模型里没有对象行，节点命中由 06-EffectControlsRows 的局部行模型承担。
2. 手柄宽度 `handlePx = clamp(6, 0.2 * clipWidthPx, 10)`；`clipWidthPx < 2*handlePx` 时返回"片段体"而不是手柄。
3. 指针时间：`t = (clientX - viewportRect.left + scrollLeft) / pxPerSecond`；`viewportRect` 在滚动/缩放/窗口变化时更新，不在 `mousemove` 里读 DOM。
4. 刀片时间：在同一换算后做 `roundToStep(t, snapStep)`（若吸附开启）或直接使用 t；是否允许切由 `canSplit` 决定。
5. 负坐标/负时间在 `hitTest` 返回空，不产生"0 处的假命中"。
6. 点击/拖动片段块不产生属性节点命中；节点的选中与拖动只从效果控件进入。

**人工操作检查**
- 两个首尾相接的片段，点在接缝上只命中右边那个（左闭右开）。
- 点片段最右 1px 不进入裁剪右柄（属于下一个片段）。
- 24px 宽的片段整体可拖动，拖左右边缘不出现裁切光标。
- 缩放/滚动后同一屏幕位置命中的片段不变。
- 在片段块上任意位置点击或拖动，不会命中属性节点/菱形；主时间轴没有对象行可展开。

### 4.4 选择：身份选择 + "按下已选不重置" + 选择随编辑

**来源写法**（E11/E12/E13）
`PointerTool::MousePress` 先算 `drag_movement_mode_`（72–86），再判断"该块是否已选中"：已选中时若按 Shift 则移除该项（含 links，除非 Alt），然后**直接 return**（84–102）——这次 return 只跳过选择变更，模式已缓存，`MouseMove` 仍会开始拖拽，所以"多选后按住其中一个拖动整组"成立。未选中时，非 Shift 才 `DeselectAll`（108–110），随后加入选择并连带 links（112–127）。`SetSelections` 在集合相等时提前返回（2148–2150），并按差异发 `SignalDeselectedBlocks/SignalSelectedBlocks`（2152–2181）。拖动/裁切/微移把"新选区"作为 `SetSelectionsCommand` 挂在同一个 `MultiUndoCommand` 上（`NudgeInternal 1632–1636`、`FinishDrag 660–669`），于是撤销时选区一起回退；`TimelineWidgetSelections` 提供 `ShiftTime/ShiftTracks/TrimIn/TrimOut`（25–69）来生成新选区。

**现状（我们）**：`onClipMouseDown` 无条件调用 `selectClip`（282），多选一按就塌缩为单选；选择是 `{track, clip, keyframe}` 下标（[types.ts](../../src/types.ts) `Selection 270–274`），批选在 `store.ts selectClipMulti 874–883`。

**解决什么**：多选拖动不被"按下即单选"破坏；选择变化可预测且可撤销；选择更新有幂等保护，不会风暴式刷新。

**可借鉴**
- "按下已选中的成员不重建选择"——这是多选拖拽能用的关键。
- Shift 点击是切换（已选→取消），不是累加。
- 选区随编辑位移/裁切一起调整（哪怕不放进文档，也要在同一次操作里算好）。
- 选择变更前做相等判断，避免重复通知。

**不能照搬**
- 时间区间选择模型（`QHash<Track::Reference, TimeRangeList>`）：我们的选择必须是身份，时间只是属性；否则删除/重排后必然指错。
- `SetSelectionsCommand` 把选择写进撤销命令：我们的撤销只作用于 `doc`（`02-EditorStore` §3.3），选择由命令回执的 old→new 映射修复（`02-SelectionIdentity` §3.5）。
- links/transition 连带选择：我们没有 block links；转场重叠区归 08，选择不跨转场。

**映射**
- [02-SelectionIdentity](../02-model-contracts/02-SelectionIdentity.md) §3.3 `Selection`（`clipKey/clipKeys/objectPath/keyframeTime`）、§3.4 重映射、§3.5 修复算法。
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) `selection.ts`：只做"命中项 → 片段 Selection"与"选择 + 方向键导航"；不产生 `objectPath/keyframeTime`。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) `select` 事件（`Selection 定位 + additive`）、框选只选片段。
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.4：节点批选写在同一命令的映射里；其选区来源是效果控件右列，不是主时间轴。

**适配步骤**
1. `onPointerDown`：命中项在 `selection.clipKeys` 中且无修饰键 → 不改变选择，直接进入 `beginDrag`。
2. `Shift`：命中项已选 → 从 `clipKeys` 移除并结束；未选 → 加入。
3. 空白处按下：按 `05-04` 语义拖播放头且**不清选区**；清选区只由 `Esc` 或点击标尺外区域触发。
4. 拖拽/裁切结束后，用命令回执的 `{oldClipKey/newStart/newDuration}` 更新片段选择；若效果控件里已存在同一片段的节点选择，按 `keyframeTime` 映射修复，但主时间轴本身不创建节点选择；不把选择放进历史快照。
5. 选择写入前比较新旧值（浅比较 `clipKeys` + 主选择域），相等则不发通知。
6. 删除/分割后按 `02-SelectionIdentity` §3.5 修复：片段没了就清空该片段选择，绝不跳到同轨第一条。

**人工操作检查**
- 多选 3 个片段，按住其中一个拖动：3 个一起动，松手后仍是 3 个被选。
- 多选后 Shift 点击其中一个：只剩 2 个被选，且不触发拖拽。
- 删除当前选中片段：选择清空或按映射落到仍存在的片段，不"选到邻居"。
- 撤销一次后选择仍指向同一 `clipKey`（`05-05` §9-1）。

### 4.5 锁定：UI 预检 + 命令层兜底

**来源写法**（E1/E14/E20）
`PointerTool::MousePress` 把"轨道未锁定"作为可选中的前提（57–60），因此锁定轨上的块既不能选也不能拖。`RazorTool::MouseRelease` 在遍历轨道时 `if (track == nullptr || track->IsLocked()) continue;`（64–68）。`RippleTool::InitiateDrag` 给每条未锁定轨补 ghost（60–64），锁定的轨完全不参与波纹。更关键的是命令层：`TrackListRippleRemoveAreaCommand::prepare` 自己再过滤一次 `track->IsLocked()`（183–194），所以即使 UI 漏检，锁定轨也不会被改。反例：`PointerTool::HoverMove`（215–238）只查 `trimming_allowed_`，不查锁定，锁定轨上仍显示裁切光标——UI 承诺了做不到的事。

**现状（我们）**：`Timeline.vue 285–286` 在 `selectClip` 之后才判锁定，仅阻止拖拽/裁切；刀片分支在锁定判断之前就 `commit`（272–279），所以锁定轨仍可被切割；`store.ts deleteSelectedClips 942–948` 有逐项锁定预检，移动/裁切命令没有。

**解决什么**：锁定是"数据保护"而不是"外观开关"；批量操作不会因为一条锁定轨而部分生效。

**可借鉴**
- 规则在 UI 与命令层各实现一次，命令层是权威（返回明确 reason）。
- 批处理遍历时显式处理锁定项，而不是依赖调用方预过滤。
- 锁定轨的视觉（降饱和 + 锁图标）与命中行为一致。

**不能照搬**
- "锁定 = 不可选中"：`05-04` 明确锁定轨"可选择、不可拖拽/裁切/分割/删除"，便于查看属性与复制。
- 跳过式部分成功：Olive 的 ripple 跳过锁定轨、其它轨照做；我们的多选移动是一个原子命令，任一目标锁定应**整批拒绝**并提示，避免"以为都动了"。
- hover 不检查锁定的缺陷。

**映射**
- [05-05](../05-timeline-workspace/05-05-ClipEditing.md) `clipRules.ts`：`canMove/canTrim/canSplit/canDelete`；`clipCommands.ts` 每个命令入口再调用一次。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) §4：锁定轨样式与光标；hover 不显示裁切光标。
- [02-EditorStore](../02-model-contracts/02-EditorStore.md) §3.2：失败返回 `{ok:false, reason}`，文档与选择不变。

**适配步骤**
1. `clipRules` 接收 `{trackView, clip, mode}`，返回 `{allowed, reason}`；UI 用它决定光标与提示，命令层用它决定拒绝。
2. 命令层遍历所有目标，先收集拒绝原因；任一拒绝 → 返回 `locked` 且不修改文档。
3. 锁定状态是会话 UI 状态（`session.trackView.locked`），不进脚本、不进撤销。
4. hover 与按下共用同一 `hitTest` 结果，锁定轨不返回手柄区。
5. 撤销/重做不改变锁定状态。

**人工操作检查**
- 锁定轨上的片段可点选，效果控件仍显示其参数与节点，但拖动/裁切/删除无效果并给出原因。
- 多选跨一条锁定轨移动：整批拒绝，未锁定轨也不动；文档与撤销栈不变。
- 锁定轨 hover 不出现左右裁切光标。
- 解锁后同一操作立即生效。

### 4.6 分割：同刻多轨、严格内点、按属性分区

**来源写法**（E14/E15）
`RazorTool` 在拖动中收集经过的轨道（41–54），松手时用**同一个** `split_time = drag_start_.GetFrame()`（58），逐轨 `NearestBlockBefore(split_time)`，跳过锁定轨、非 `ClipBlock`、以及 `block->out() == split_time` 的情况（66–80），去重后（含 links，除非 Alt）一次性推 `BlockSplitPreservingLinksCommand(blocks, {split_time})`（92–96）。`BlockSplitCommand::redo` 断言切点严格在 `(in, out)` 内（41 行），左段长 `point - in`，右段长 `out - point`，通过 `set_length_and_media_out/set_length_and_media_in` 切分（46–57），新块插在原块之后（60），带出的 out 转场迁移到新块（64–77）。`BlockSplitPreservingLinksCommand::prepare` 会先按时间顺序对所有块执行 split 并重建链接（112–167），源码自己留了 FIXME：**时间未排序会出错**。`TrackSplitAtTimeCommand::prepare` 找不到块时 `command_` 保持空，`redo/undo` 都判空（头文件 141–160）——这是一种"条件空命令"，不是我们要的桩。

**现状（我们）**：`Timeline.vue 272–279` 的刀片只切命中片段一次，时间先被夹进 `[0, canvasDuration]`，没有端点距离判定（`05-04` §9-4 要求 2px 内不切）；`operations.ts splitClip 485–560` 已拒 `localSplit <= 0.01 || >= cd - 0.01`，但右半的节点处置仍是旧整帧模型，需按 06 §3.5 重写。

**解决什么**：一次刀切覆盖多轨是真实需求；切点必须落在内部，否则产生零长片段；批次必须是一个撤销单元；分割后重名/引用问题必须一次性处理。

**可借鉴**
- 一个手势 = 一个命令（多轨也在内），历史里只出现一条。
- 切点统一、严格内点、边界跳过（`out == split` 不切）。
- 批次前先去重（同一块被多轨引用时只切一次）。
- 时间列表要排序或用单值；不接受乱序输入。

**不能照搬**
- `Node::CopyNodeInGraph` 复制整棵节点图 + 切 media 区间：我们的"内容"是各属性独立节点序列，必须按属性分区（左留 `t <= splitLocal`，右留 `t > splitLocal` 并减 `splitLocal`），不能整份复制（`06-KeyframeEditOps` §3.5）。
- media_in/media_out、out 转场迁移、links 重连：我们无对应结构。
- `prepare()` 里执行 `redo_now()` 产生副作用（112–167）：快照式历史下不可用，且撤销语义难审计。
- 空命令哨兵：`TrackSplitAtTimeCommand` 的判空 redo 是"命令可能什么都不做"的补丁；我们应在生成计划阶段就判断"没有可切目标"，不 push 任何条目。

**映射**
- [05-05](../05-timeline-workspace/05-05-ClipEditing.md) `clipCommands.splitAt`、`clipRules.canSplit`、引用影响面（`paths[].clip`/`rule_bindings[].clip`/`exit.target`）。
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.5：节点分区与 `time == splitLocal` 归左；`authoring.easing` 被切断则丢弃并提示。
- [02-SelectionIdentity](../02-model-contracts/02-SelectionIdentity.md) §3.2：新片段 `id` 规则、被引用片段默认禁止分割。
- [02-EditorStore](../02-model-contracts/02-EditorStore.md) §3.2：整批一次 `commit`，失败全回滚。

**适配步骤**
1. `planSplit(doc, selection, t)`：先按 `t` 与 `[start, start+duration)` 求命中片段，按 `clipKey` 去重；锁定/无限片段/被引用片段进入 `rejected[]`。
2. 被引用片段若用户确认级联：同一命令里重写引用（或标记需重建），否则整体拒绝。
3. 生成两侧：左 `duration = t - start`；右 `start = t`、`duration = oldEnd - t`、新 `clipKey` + 新 `id`；节点按属性分区并重基准。
4. 切点与端点距离 `<= 0.01s` 直接拒绝（对应 Olive 的断言），不产生零长片段。
5. 任一目标因锁定/边界/引用冲突被拒，则本次批量分割整次拒绝并列原因，不默认跳过后部分成功。作者若只处理合法子集，必须先明确重新选择，再发起新的完整命令。
6. 提交成功后按回执更新选择：优先保留左段（原 `clipKey` 不变）。

**人工操作检查**
- 同一时刻在 3 条轨上刀切：产生 3 个右段，历史只有 1 条，撤销一次全部还原。
- 在片段端点 2px 内点击：不分割并有提示。
- 被 `paths[0].clip` 引用的片段：默认拒绝，提示引用来源。
- 分割含 `position.x`/`yaw` 的片段：两侧节点不重复、不丢失，右侧时间从 0 重新开始；节点在效果控件中查看，主时间轴仍只显示两个片段块。
- `duration<0` 的无限片段：不可分割。

### 4.7 裁切与同轨移动：roll/slide/覆盖语义的取舍

**来源写法**（E16/E17）
`InitiateDragInternal` 的 trim 分支：为被裁片段建 ghost，并总是为"相邻块"建一个反向模式的 ghost（或零长空 ghost，相邻幽灵创建见 478 行），标记 `kTrimIsARollEdit`（498 行）。`ValidateInTrimming` 以 `earliest_in = RATIONAL_MIN`、`latest_in = out - timebase` 夹紧（948–982），`ValidateOutTrimming` 以 `earliest_out = in + timebase` 夹紧（984–1021）——即"至少一帧长"。`BlockTrimCommand::prepare` 存旧长度、`doing_nothing_ = (old == new)`（142–150），缩短且没有 gap 邻段时**创建 GapBlock** 补位，邻段缩到 0 则删除（152–179）；`redo/undo` 都先判 `doing_nothing_`（33–36、88–92）。移动分支则是"先把原位置替换成 gap，再在目标位置覆盖式放置"（`FinishDrag 673–818` + `TrackPlaceBlockCommand::redo 316–362`：超出轨道末端补 gap，未超出则 `TrackRippleRemoveAreaCommand` 挖掉目标区间再插入）。`TrackSlideCommand`（185–308）则把移动限制在左右邻段之间，通过创建/删除 gap 保持连续。

**现状（我们）**：`moveClip 109–112` 用 `Math.max(0, …)` 把负起点夹回 0；`resizeClipLeft 122–139` / `resizeClipRight 141–158` 同样夹紧（右裁还有 0.1s 硬下限），并调用 `clampKeyframes`/`ensureBoundaryKeyframes`（旧模型补帧）；`Timeline.vue 318–335` 每个 `mousemove` 提交一次。

**解决什么**：裁切有最小长度、有旧/新记录、有无变化短路；移动不会留下"半移动"状态；同轨滑动保持连续。

**可借鉴**
- 一次拖拽 = 一个裁切命令，`prepare` 记录旧值，`doing_nothing_` 短路。
- 裁切前检查新长度为正且左端不越过右端；本项目按05-05保留duration>0，不照搬参考的一帧下限，也不新增0.01s裁切下限。
- 多目标先计算影响面；不照搬只改最外侧、静默忽略其他已选片段的规则。操作不支持的目标必须明确拒绝或让作者先重新选择。
- 移动先算位移再校验（`ProcessDrag 531–541`），不是边改边算。

**不能照搬**
- 素材滑移：trim-in 同时改 `media_in`（572 行 `SetMediaInAdjustment`）——我们没有素材时间，节点时间是局部秒，裁左**不平移节点**。
- roll 自动改邻段、gap 创建/删除、覆盖式放置、波纹挖洞：全都建立在"时间轴必须连续、空白是实体"的 NLE 假设上；我们的片段是独立对象，空白就是没有片段。
- `earliest_in = RATIONAL_MIN`：trim-in 在 Olive 里可以进负时间；我们必须显式拒绝 `newStart < 0`。
- 覆盖式移动会挖掉目标区间，本项目不采用；“时间重叠”不等于“覆盖删除”。重叠是否合法仍按轨道、lane、转场和真实校验合同判断，不能为了参考编辑器的连续素材模型一律拒绝重叠。

**映射**
- [05-05](../05-timeline-workspace/05-05-ClipEditing.md) `clipCommands.trimClipLeft/trimClipRight/moveClips`、`clipRules.canMove/canTrim`、`ripple.ts planRipple`（仅同轨后续片段位移）。
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.5：裁短不删节点、不钳制，越界标"不生效"；`resizeClipRight` 不再调用 `ensureBoundaryKeyframes`。
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) `dragSession` 的 delta 语义。
- [02-EditorStore](../02-model-contracts/02-EditorStore.md) §3.5：失败后选择修复。

**适配步骤**
1. 裁左要求newStart>=0且newStart<原末端，只改start_time/duration；对象节点局部秒不自动平移。
2. 裁右要求newDuration>0；超窗口节点保留并标不生效，不按参考帧率或额外0.01s下限钳制。
3. 移动只改既定字段；涉及重叠时按05/08与真实校验确认语义，不挖掉、推开或静默覆盖其他片段。只有实际冲突才整次拒绝。
4. 批量目标与作用域在提交前明确，任一不支持/锁定/越界/引用冲突整次拒绝；不因Olive只裁最外侧就偷偷留下部分已选目标未处理。
5. 无变化（delta 为 0 或新长度等于旧长度）不提交、不入栈。
6. 素材滑移/roll不在本轮，不创建预留接口、空命令或以此扩大普通裁切行为。

**人工操作检查**
- 把片段左边缘拖到-2s：拒绝本次提交，恢复原文档与预览，不钳制成0s，不产生新历史。
- 对其余校验均合法的0.005s正时长片段，不能仅因参考一帧长度或新增0.01s门槛拒绝；零/负时长仍拒绝。
- 对合法重叠按既有lane/转场/播放语义保留；实际冲突时整次拒绝，不删除/覆盖任何原片段。
- 裁短后关键帧仍在 JSON 中（超窗口），效果控件标"不生效"；主时间轴片段变短但不出现节点。
- 撤销一次回到拖动前，选择仍是同一 `clipKey`。

### 4.8 组合撤销、历史入栈与脏标记

**来源写法**（E18/E19/E25）
MultiUndoCommand顺序redo、逆序undo（27–39）；redo_now在首次执行时prepare再redo（68–79）。redo_and_set_modified记录进入前modified_再置脏（47–57），undo_and_set_modified恢复该标记（59–66）。这能说明“记录命令前状态”的写法，不能仅据此断言中途保存、分支和重做都能准确识别保存点。UndoStack::push丢弃空MultiUndoCommand（65–68）、清redo（72–79）、执行入栈（82–85）、限200（87–94）；clear的EmptyCommand哨兵（141–157）与CanUndo类型判断（159–162）不采用。

**解决什么**：一次手势一个历史条目；空操作不污染历史；明确来源脏标记的能力边界。本项目清脏仍按既有保存回执合同，不据参考新增另一套保存点算法。

**可借鉴**
- "无变化不入栈"在历史层兜底（不只是 UI 层）。
- 入栈时清 redo 分支（我们现在的 `pushUndo` 也做了，`store.ts 106–112`）。
- 上限 200 并淘汰最旧（`store.ts 104` 同值）。
- 脏状态要有明确所有者，保存失败不能当作成功。参考的modified_只作设计对照，不采纳dirtyBefore恢复法。

**不能照搬**
- 命令对象 + `prepare()` 副作用（如 `BlockSplitPreservingLinksCommand::prepare` 里直接 split，112–167）：快照式历史用不到，且会带来"prepare 已经改了文档"的审计难题。
- `push` 内执行命令：我们的 `commit` 是"快照 → 应用 → 入栈 → 置脏"（`02-EditorStore` §3.2），执行点不同，不能混用。
- `EmptyCommand` 哨兵与 `CanUndo` 类型判断：这是"用一个什么都不做的命令占位"的做法；**明确不作为我们的桩实现**。我们的 `canUndo = history.undo.length > 0`，打开/新建时不入栈任何占位条目；也不允许任何"空操作命令类"进代码。
- 用命令对象记录 UI 选择（`SetSelectionsCommand`）：选择不进撤销（`02-EditorStore` §3.3）。

**映射**
- [02-EditorStore](../02-model-contracts/02-EditorStore.md) §3.2 步骤 5/6（入栈、脏、清 redo）、§3.3（undo/redo 只作用于 doc）、`History {undo, redo, limit}`。
- 现状对照：[store.ts](../../src/store.ts) `pushUndo 106–112`（无条件 push、`dirty=true`）、`undo/redo 114–128`（无论撤销到哪都置脏）。

**适配步骤**
1. 无内容变化的commit不入栈、不置脏、不清redo；取消/零位移在UI层和命令层均不得生成空历史。
2. 保留02-EditorStore既有History的undo/redo字符串快照和200上限，不改成snapshot/dirtyBefore/label条目，也不新增savedDepth或第二套命令对象历史。
3. 实际撤销/重做按保守策略标脏；只有02-DocumentIO既有保存成功回执且当前文档未并发改变时才清脏。精确识别撤销返回保存点不在本参考新增范围，不能用旧dirtyBefore错误清除中途保存后的修改。
4. 上限淘汰不制造空命令，也不因此自动清脏；命令失败不入栈，保存失败/断连/外部冲突保留原文档与提示。
5. 操作提示使用已有命令种类的文案，不为标签另改历史形状；Moved Clips不能当所有操作的名称。
6. 不支持合并相邻命令（本轮不做 `mergeWith`），一次手势一条。

**人工操作检查**
- 拖动一次 = 1 条；原地点击 = 0 条。
- 连续5次编辑后撤销5次，内容回到初始；脏标记按保守合同仍保留，成功保存并确认无并发修改后才消失。编辑→保存→撤销时必须仍提示未保存，不能恢复旧dirtyBefore把磁盘差异误标为干净。
- 撤销 2 次后做一次新编辑：redo 分支被清空（`Ctrl+Shift+Z` 无效）。
- 保存失败（模拟断连）后脏标记仍为 true，关闭窗口有未保存提示。
- 历史里没有"空操作"条目，也没有名为 "New/Open Project" 的占位项。

### 4.9 有限/无限：显示范围的派生与滚动上限

**来源写法**（E21/E22/E23）
Olive 的内容长度是有限的 `viewer_node_->GetLength()`；`UpdateMaximumScroll` 用它算 `max = ceil(TimeToScene(length)) - width()`，`clamp` 到 `>= 0`，并给每个视图 `SetEndTime(length)`（152–163）。`UpdateSceneRect` 设左界 0、右界 `TimeToScene(end_time_) + width()`（270–288），注释写明"末尾留出一屏余量以便继续操作"。视口边界 `GetTimelineLeftBound/RightBound` 就是滚动条值与视口宽（686–694），绘制按此裁剪（`drawForeground 207–303`）。反面对照：`TrackPlaceBlockCommand::redo` 在放置点超过轨道末端时**插入 GapBlock 补位**（316–345），说明 NLE 用实体填充"超出内容"的区域。

**现状（我们）**：`Timeline.vue totalDuration 128` 直接读 `timeline.total_duration`，`canvasDuration 130` 取 `max(total*1.5+5, 30)`；`operations.ts recalcDuration 610–620` 在 `commit` 的 `maintainInvariants` 里写回总时长——这正是 05-03 要删除的派生路径。

**解决什么**：标尺/画布末端始终有可操作余量；滚动上限与内容同步；空内容不会出现负宽度。

**可借鉴**
- 右界 = 内容末端 + 一个视口宽（不是固定秒数），这是"总能继续拖一点"的来源。
- 左界固定 0，负时间不显示。
- 滚动上限由同一函数派生，clamp 到 0，避免空文档出现异常滚动条。

**不能照搬**
- 把 `length`（序列长度）当内容真值：我们的 `finiteEnd` 可能为 `null`（含 `duration<0` 或宏观无限循环）。
- 用 Gap 片段填充末端：我们的空白不是实体。
- 固定右界：无限内容必须允许窗口随滚动右移。

**映射**
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) §3 `src/timeline/displayRange.ts` `deriveDisplayRange(doc)`；§4 字段约束（`finiteEnd/infinite/displayEnd/tailPadPx`、最小 30s）。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) §4 视口裁剪（只渲染可视窗 ±1 屏）。
- [05-06](../05-timeline-workspace/05-06-RulerPlayheadMarkers.md) `fitToRange` / `F` 键适配（无限时适配到当前可视末端）。
- [02-EditorStore](../02-model-contracts/02-EditorStore.md) §3.1 `DerivedState.finiteEnd`、§4.2 步骤 3（读 `derived.finiteEnd`，不读 `total_duration`）。

**适配步骤**
1. `deriveDisplayRange(doc, viewport)`：`finiteEnd = max(clip.start_time + max(duration,0))`；任一 `duration<0` 或宏观循环无限 → `infinite = true`。本函数只服务主时间轴全局视口。
2. `displayEnd = max(finiteEnd ?? 0, viewport.fromSec + viewport.widthSec) + tailPadPx / pxPerSecond`，且 `>= 30s`；`infinite` 时不用固定值，随 `scrollLeft` 增长。
3. 无限片段渲染宽度 = `displayEnd - start_time`，角标 `∞`；不把 `Infinity/null` 写入文档。
4. 滚动/缩放/窗口尺寸变化时只重算 `displayEnd`（纯派生），不触发 `commit`、不置脏。
5. 移动片段到 `finiteEnd` 之后：允许（若 `start>=0`），并推动 `displayEnd` 增长；不创建任何填充片段。
6. 空文档/空轨道：至少 30s 可滚动，标尺正常。
7. 效果控件的局部时间窗口（含轴外节点扩展）由 [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) 独立派生，不复用本函数的 `displayEnd` 或可变滚动状态；轴外节点不扩大主时间轴片段宽度、不改变脚本时长。

**人工操作检查**
- 含 `duration:-1` 的脚本：画布可向右滚动、无限片段有 `∞` 角标；保存后 JSON 无 `total_duration`、无 `Infinity`。
- 空文档：标尺存在，可滚动至少 30s，无负宽度/空滚动条。
- 把最后一个片段拖到 60s：画布右界随之增加，松手可继续操作；撤销后右界回收。
- 缩放拉满/拉到底：右界与滚动上限同步，无"滚不到末端"或"末端空太多"。
- 把某属性的节点拖到片段 5s 之外的 7s：主时间轴片段仍 5s、右界不变；效果控件在自己的局部视口标出轴外。

### 4.10 缩放：先夹紧再按光标锚定

**来源写法**（E10/E23/E24）
`TimeScaledObject::SetScale` 把新值 `clamp(min_scale_, max_scale_)`（122–127）；`SetMaximumScale` 若当前比例超限会回头 `SetScale(max)`（99–106）。`ZoomIntoCursorPosition` 先 `emit ScaleChanged(old * multiplier)`，再**用 `GetScale()`（夹紧后的值）**重算滚动：`new_scroll = round((cursor_x + old_scroll) / old_scale * GetScale() - cursor_x)`（91–121），注释特意说明"用 GetScale 以免用了未夹紧的值"。`ZoomTool::MouseRelease` 支持框选缩放：把屏幕宽按当前 scale 归一成时间宽，`new_scale = min(maxScale, viewportWidth / scene_width)`，滚动设为 `scene_left / old_scale * new_scale`；单击则 ×2（Alt ×0.5）并以光标居中（51–101）。滚动写入用 `QueueScroll`（`timelinewidget.cpp 1717–1723`），`QTimer::singleShot(0, ...)` 延后到场景/滚动条更新之后。

**现状（我们）**：`store.ts zoomIn 836 / zoomOut 840 / setZoom 844` 只改 `pxPerSecond`；`Timeline.vue onWheel 499–506` 也只改比例，不调整 `scrollLeft`，所以缩放锚点是视口左上角而不是光标。

**解决什么**：缩放时"光标下的时间"不漂移；极限缩放不会出现滚动公式和实际比例不一致；框选缩放一次到位。

**可借鉴**
- 用夹紧后的新 scale 计算滚动，而不是请求的 scale。
- 公式以"光标相对内容的位置"为不变量。
- 缩放和滚动延后到渲染后一帧统一执行。
- 框选缩放按可见宽度归一，避免把 scale 当像素。

**不能照搬**：Qt 的 `singleShot(0)` hack 与整数像素滚动（`qRound`）；我们用 `requestAnimationFrame` / `await nextTick()`，并允许小数 `scrollLeft`。

**映射**
- [05-06](../05-timeline-workspace/05-06-RulerPlayheadMarkers.md) §3 `src/timeline/zoom.ts`：`zoomAt(cursor, factor)`、`fitToRange()`；§4 缩放 5–500、`Ctrl+0` 重置 40。
- [05-04](../05-timeline-workspace/05-04-TimelineView.md) §5 步骤 2：滚轮=平移、Ctrl+滚轮=缩放、Shift+滚轮=横向。
- [05-03](../05-timeline-workspace/05-03-TimelineModel.md) `scale.ts`：`TimelineScale` 与 `rulerTicks`。
- [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)：效果控件局部标尺的缩放/平移自管，只借用"先夹紧再按锚点反算"的算法，不共用本节的 `pxPerSecond/scrollLeft` 状态。

**适配步骤**
1. `zoomAt(cursorX, factor)`：`old = pxPerSecond`，`next = clamp(old * factor, 5, 500)`；`anchorSec = (scrollLeft + cursorX) / old`；设 `pxPerSecond = next`；`scrollLeft = anchorSec * next - cursorX`。
2. 更新 `scrollLeft` 放到 `nextTick`/`requestAnimationFrame`，用更新后的 DOM 宽度夹紧到 `[0, maxScroll]`。
3. `fitToRange()`：有限末端 → 适配 `[0, finiteEnd]`；无限 → 适配 `[viewport.from, viewport.to]`，不跳 0。
4. 缩放不修改选区、播放头时间、文档、脏标记，也不修改效果控件局部视口。
5. `Ctrl+0` 回到 40 px/s，并以播放头（或视口中心）为锚。

**人工操作检查**
- 在 3.2s 处 `Ctrl+滚轮`：缩放前后光标下时间不变（±0.05s）。
- 连续放大到 500 后继续滚：比例停在 500，光标下时间仍不漂移。
- 缩到 5 px/s：内容仍在视口内可定位，不出现负 `scrollLeft`。
- 框选 1s–4s 缩放：该区间铺满视口（±1 帧宽），可继续平移。
- 含无限片段的脚本按 `F`：适配到当前可视末端，不报错、不跳 0。
- 先缩放主时间轴再缩放效果控件局部标尺：两者比例各自保留，互不重置；播放头时间仍一致。

### 4.11 参考建议与既有合同的裁决（已统一）

不把参考建议当成第二套接口；以下是本次接入的明确选择，执行代理不得再自行二选一。

| 项 | 采用口径 | 既有责任任务 | 原因与不采用项 |
|---|---|---|---|
| D1 吸附时间与位移 | resolveSnap仍返回单点全局时间；dragSession从同一起始快照解出一个deltaSec供全选区共用；最近距离优先、同距才比类别 | [05-03](../05-timeline-workspace/05-03-TimelineModel.md) | 保留既有接口并获得整体移动一致性，不改成另一套delta返回协议 |
| D2 历史与脏标记 | 保留History字符串快照；空操作不入栈，实际undo/redo保守置脏，保存回执且无并发修改才清脏 | [02-EditorStore](../02-model-contracts/02-EditorStore.md)、[02-DocumentIO](../02-model-contracts/02-DocumentIO.md) | 不采纳dirtyBefore/savedDepth或新历史形状；来源局部标记不足以证明保存点正确，本次不扩增精确保存点算法 |
| D3 锁定与越界 | 任一源/目标锁定、越界或引用冲突均整批拒绝，报告具体目标，不跳过锁定项后部分成功 | [05-05](../05-timeline-workspace/05-05-ClipEditing.md) | 是C04原子性在批量编辑的明确化，不照搬Olive跳过策略 |

## 五、不采用清单

| # | Olive 做法 | 位置 | 不采用理由 | 我们的替代 |
|---|---|---|---|---|
| N1 | `EmptyCommand` 作为"新建/打开"哨兵，`CanUndo` 靠类型判断 | `undostack.cpp 29–40、141–162` | 用空命令占位会掩盖"没有历史"的真实语义；也容易被当作桩实现 | `canUndo = history.undo.length > 0`，打开/新建不推任何条目 |
| N2 | 命令对象 + `prepare()` 内执行 `redo_now()` | `timelineundosplit.cpp 112–167` | 快照式历史无法安全承载 prepare 副作用；审计/回滚复杂 | 先生成计划 → 一次 `commit` → 快照入栈 |
| N3 | `GapBlock` 创建/删除/填充末端 | `timelineundopointer.cpp 142–179、316–362` | 我们没有"空白实体"，片段独立；造 gap 会污染脚本 | 空白即无片段；显示范围负责"可操作余量" |
| N4 | 素材滑移（`media_in/media_out`） | `pointer.cpp 572`、`timelineundosplit.cpp 46–57` | 无素材时间概念，节点时间是 clip 局部秒 | 裁切只改 `start_time/duration`；分割按属性分区 |
| N5 | roll 自动改邻段 / slide 保持连续 | `pointer.cpp 478`、`timelineundopointer.cpp 185–308` | 会静默改作者内容；与"失败全回滚、影响面可见"冲突 | 裁切不联动邻段；滑动/roll 若要做，另立显式命令 |
| N6 | 覆盖式放置 + 波纹挖洞 | `timelineundopointer.cpp 316–362`、`timelineundoripple.cpp 46–180` | 与 `05-05` "禁止静默覆盖"冲突 | 重叠即拒绝并提示；波纹只做同轨后续位移 |
| N7 | 时间区间选择模型 | `timelinewidgetselections.cpp`、`timelinewidget.cpp 2146–2187` | 重排/删除后指错；与 C08 身份选择冲突 | `02-SelectionIdentity` 的 `clipKey/objectPath/keyframeTime`；主时间轴只用 `clipKey` 域，节点域在效果控件 |
| N8 | 锁定 = 不可选中；hover 不查锁定 | `pointer.cpp 57–60、215–238` | 与 `05-04` "锁定可选择、不可编辑"冲突；hover 承诺做不到的事 | 可选可看，编辑拒绝；hover 不显示手柄 |
| N9 | 屏幕阈值硬编码 10px；无条件帧网格对齐 | `timebasedwidget.cpp 764`、`tool.cpp 86–91` | 阈值不可配置；无候选也吸网格等于偷偷改时间 | 8px（宿主可注入）+ 栅格作为最低优先级候选；关闭即不吸 |
| N10 | 内容长度 = 序列长度，右界固定 | `timebasedwidget.cpp 152–163` | 我们有无限内容（`duration<0`、宏观循环） | `deriveDisplayRange` 支持 `finiteEnd=null` + 窗口增长 |
| N11 | 每次移动重扫全部块/标记/关键帧 | `timebasedwidget.cpp 782–874` | WebUI 文档规模下每帧 O(n) 会掉帧 | 拖动开始冻结候选，拖动中只做距离筛选 |
| N12 | 历史标签统一 "Moved Clips" | `pointer.cpp 818` | 裁切/分割/滑移共用一条文案，用户无法辨认 | 每类命令一个 label |

## 六、到现有任务映射

| Olive 符号（参考） | 我们的提案类/函数（已有计划） | 文档 | 动作 |
|---|---|---|---|
| `TimelineViewGhostItem`（E3） | `DragIntent` + `dragSession` | [05-03](../05-timeline-workspace/05-03-TimelineModel.md) | 新建，形状按我们的字段重定义（不抄结构） |
| SnapPoint/SnapMask（E4/E5） | collectSnapTargets/resolveSnap、dragSession | [05-03](../05-timeline-workspace/05-03-TimelineModel.md) | 单点返回全局时间；整体统一deltaSec；阈值用px |
| `GetItemAtScenePos`（E8） | `hitTest(rows,x,y)` | [05-03](../05-timeline-workspace/05-03-TimelineModel.md) | 新建；半开区间；只命中轨道/片段/手柄 |
| （无对应：Olive 在时间线上绘制关键帧） | 效果控件局部行/节点命中（`EffectControlsRows`） | [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) | 新建；片段局部秒与局部视口，不复制主时间轴行框架 |
| `IsCursorInTrimHandle`（E9） | `clipRules.canTrim` + `hitTest` 手柄区 | [05-05](../05-timeline-workspace/05-05-ClipEditing.md) | 规则化手柄宽度 |
| `SetSelections`/`SetSelectionsCommand`（E11/E12） | `Selection` + `repairSelection` | [02-SelectionIdentity](../02-model-contracts/02-SelectionIdentity.md) | 只借"按下已选不重置"与幂等；选择不进历史 |
| `TimelineWidgetSelections::TrimIn/TrimOut`（E13） | 命令回执 old→new 映射 | [02-SelectionIdentity](../02-model-contracts/02-SelectionIdentity.md) §3.5 | 不实现时间区间选择 |
| `RazorTool` + `BlockSplitPreservingLinksCommand`（E14/E15） | `splitAt` + `planSplit` | [05-05](../05-timeline-workspace/05-05-ClipEditing.md)、[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.5 | 新建；多轨同刻一个命令 |
| `BlockTrimCommand` / `Validate*Trimming`（E16/E17） | `trimClipLeft/Right` + `canTrim` | [05-05](../05-timeline-workspace/05-05-ClipEditing.md) | 新建；无 gap、无 media |
| `TrackPlaceBlockCommand`（E17） | `moveClips` | [05-05](../05-timeline-workspace/05-05-ClipEditing.md) | 明确拒绝覆盖 |
| MultiUndoCommand/UndoStack::push（E18/E19） | commit + 既有History | [02-EditorStore](../02-model-contracts/02-EditorStore.md) | 仅借无变化短路与单次提交；保持字符串快照，不用dirtyBefore |
| redo_and_set_modified（E18） | 脏状态所有权 | [02-EditorStore](../02-model-contracts/02-EditorStore.md) | 仅作对照；undo/redo保守置脏，保存确认才清脏 |
| `UpdateMaximumScroll`/`UpdateSceneRect`（E21/E23） | `deriveDisplayRange` | [05-03](../05-timeline-workspace/05-03-TimelineModel.md) | 新建；支持 null |
| `ZoomIntoCursorPosition`/`ZoomTool`（E23/E24） | `zoomAt`/`fitToRange` | [05-06](../05-timeline-workspace/05-06-RulerPlayheadMarkers.md) | 新建；用 nextTick 代替 singleShot；只管主时间轴全局视口 |
| `SeekToScenePoint`（E26） | `playhead.ts` seek 会话 | [05-06](../05-timeline-workspace/05-06-RulerPlayheadMarkers.md) | 借"排除自身吸附"与"值未变不发送" |
| LLC `onMouseDown`（E27） | `dragSession` 的指针捕获 | [05-04](../05-timeline-workspace/05-04-TimelineView.md) | 借 window 级 `pointermove/pointerup`；需在卸载时清理（LLC 未清理，别照抄） |

## 七、人工使用检查（按 `shared/manual-acceptance.md` 记录）

**准备**：WebUI 连接 Forge/Fabric 主模组，打开一个真实相机脚本，需同时包含：≥2 条 CAMERA 轨、1 个 `duration:-1` 片段、1 个被 `paths[0].clip` 引用的片段、1 个多属性对象（`position.x/y/z` + `yaw`）、1 条标记、`timeline.loop_*`。记录实际文件路径与打开时间。

| # | 操作 | 预期 | 异常路径 |
|---|---|---|---|
| 1 | 拖动片段 2.3s 后松手 | 只 1 条撤销；撤销一次回原位；选择不变 | 拖动中 `Esc`；松手在视口外 |
| 2 | 距另一片段起点 6px / 12px 拖动 | 吸附 / 不吸附；参考线出现/消失 | 两个候选同距 |
| 3 | 在 3.2s 处 Ctrl+滚轮放大 | 光标下时间不变；5/500 夹紧 | 缩放到极限后继续滚 |
| 4 | 多选 3 个片段，按住其中一个拖动 | 3 个一起动；松手仍 3 选中 | Shift 点击取消其中一个 |
| 5 | 锁定一条轨，拖动/裁切/删除其上片段 | 可选中查看；编辑被拒并提示原因 | 多选跨锁定轨 → 整批拒绝 |
| 6 | 同一时刻在 3 轨刀切 | 3 个新右段；1 条撤销 | 端点 2px 内点；被引用片段 |
| 7 | 裁左到-2s、裁到零/负时长或提交已判定的冲突 | 整次拒绝，文档/选择/历史不变；不因参考另加合法正时长下限 | 确认没有空历史或静默钳制 |
| 8 | 编辑3次→撤销3次→redo1次，再保存 | 内容正确；实际编辑/撤销/重做保守置脏，保存确认且无并发修改才清脏 | 编辑→保存→撤销仍须提示未保存；失败不清脏 |
| 9 | 打开含无限片段脚本，滚动到 60s 后保存 | 画布可滚动、无 `Infinity`/`total_duration` | 空文档同样可滚动 |
| 10 | 断连后本地编辑、撤销、缩放 | 不崩溃；按02保留本地草稿，保存/推送/游戏校验未成功时不显示成功，不清脏 | 重连后恢复受控校验与推送，不能用参考播放器假预览 |
| 11 | 检查主时间轴与效果控件的分工 | 主轴只有轨道/片段/手柄与全局标尺，无对象行、节点或汇总标记；选中片段后在效果控件同时展开多个组，局部缩放/播放头独立 | 主时间轴点击/拖动不产生节点命中；两个视口互不重置 |

**记录方式**：每步记录实际结果、截图位置、问题所在函数（若已知），失败即回到责任类修复后重跑；未实际操作的步骤不得填"通过"。

## 八、实现状态与局限

- 本页只读参考源码与现有计划，**未运行** Olive/LosslessCut、未运行编辑器或游戏、未改任何代码；文中"预期"是人工检查口径，不是已通过证据。
- 证据是本地快照：Olive git `7e0e94a`（2024-12-05），LosslessCut `3.69.0`；不代表上游最新实现。行号以该快照为准，未来同步参考源码后需重新核对（本页不生成 GitHub 永久链接）。
- 许可来源记录：Olive `LICENSE` 为 GNU GPL v3 全文（674 行），`app/undo/undostack.cpp` 等文件头为 GPL-3.0-or-later；LosslessCut `package.json` 为 `GPL-2.0-only`、版本 `3.69.0`。本页只记录"设计思想来源与后续复用边界"，不作法律兼容结论；本轮采用独立实现，不复制/改写其代码或图标资产，也不因其开源就默认可直接搬运。许可索引与整体结论由主代理统一维护。
- 局限：只读取了任务点名的目录（`widget/timelinewidget`、`widget/timebased`、`timeline/*undo*`、`undo/*`）与少量 `node/project.cpp`；未通读 Olive 测试与完整拖拽工具族（add/record/transition/slip/rolling 只做了交叉核对）。因此本页不对这些工具的行为下结论。
- 与产品原则的边界：不新增媒体功能（无 media_in、变速、音画同步 ripple、转场参数编辑）；`paths`/`rules`/`exit` 引用完整性、同属性关键帧严格递增、属性叶子独立时间，**优先于**任何剪辑器手感；`EmptyCommand` 式空命令与空操作桩**不进入**我们的实现。
- 本轮职责边界（用户截图合同）：主时间轴只负责轨道/片段/手柄命中、片段命令与全局视口；属性节点、对象分组展开、轴外帧与节点虚拟化全部归片段效果控件（06-ClipEffectControlsPanel / 06-EffectControlsRows）。本页的"属性优先"只约束数据写入，不再意味着主时间轴展示或命中节点。
