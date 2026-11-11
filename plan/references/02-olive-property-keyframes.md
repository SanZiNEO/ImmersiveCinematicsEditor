# 02 Olive 属性级关键帧交互参考

> **文档性质**：参考研究记录，不是实现说明，也不代表任何功能已完成。
> **参考快照**：`E:/Documents/GitHub/ImmersiveCinematics/example/editor/olive` 的本地副本。所有行号只对这份快照成立，不声称是上游最新版本。
> **许可边界**：Olive 根目录 `LICENSE` 为 GPLv3 文本；本文引用的 `.cpp` 文件头（例如 `app/widget/nodeparamview/nodeparamviewkeyframecontrol.cpp:1-18`、`app/widget/keyframeview/keyframeview.cpp:1-18`）均声明 GPL-3.0-or-later。本文只记录设计思路并作为独立实现的指导，不复制、不改写其代码，也不复用其图标/工具按钮资产。是否构成许可兼容需要单独判断，本文不下结论；"开源"不等于"可以直接搬"。
> **产品前提**：我们的编辑器是模组 0.3.6 固定格式脚本生成器。`mode`（`value`/`animated`/`event`）与 `interp`（`linear`/`angle`/`geometric`/`step`）由 schema 与 parser 决定，是只读事实；属性叶子各有独立关键帧时间；预览必须是游戏原始画面。Olive 的节点参数模型（一个 input 下挂多条 track）与我们的"属性叶子即编辑单元"不是同一个模型，本文所有映射都以此差异为前提。
> **本轮界面承载（用户截图合同）**：适配统一落在片段级效果控件 [06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md)（容器、片段上下文、共享局部标尺）、[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（左右行对齐、节点几何/命中、局部视口与虚拟化）、[06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md)（对象/功能组目录与参数列）与 [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md)（效果控件和快捷属性共用值控件）。同一片段内多个处理组/叶子可同时展开，左参数右节点，选择一个属性只改高亮与编辑目标，不隐藏其它行、不切入单属性独占页；主时间轴不显示属性节点。旧 06-PropertyKeyframePanel 与 06-TimelineObjectRows 两任务已由上述新任务替代。

## 一、摘要

Olive 的节点参数视图给出了一套完整的"逐参数动画"交互，可直接观察的写法集中在四处：

1. **行级控件**：每个可动画 input 右侧固定一列四按钮控件（上一帧 / 菱形 / 下一帧 / 秒表），秒表控制该 input 是否进入 keyframing 状态，菱形只切换播放头处的单帧，前后帧按钮移动播放头。见 `app/widget/nodeparamview/nodeparamviewkeyframecontrol.cpp:32-71、137-196`。
2. **开关动画的事务化**：开启时在播放头建帧，关闭时先弹确认、保存当前采样值、删除全部帧、把采样值写回标准值，再把整个动作作为一条撤销命令提交；用户取消则回滚按钮状态。见同文件 `222-285`。
3. **参数控件的提交/取消与拖动聚合**：滑杆在拖动期间不进撤销栈，松手时把所有变化合成一条命令；文本编辑失败保持编辑态并重新聚焦，取消则丢弃输入。见 `app/widget/slider/base/sliderbase.cpp:148-210`、`app/widget/slider/base/numericsliderbase.cpp:53-107`、`app/widget/nodeparamview/nodeparamviewwidgetbridge.cpp:201-227`、`app/node/inputdragger.cpp:41-121`。
4. **关键帧视图的绘制、命中、选择、复制粘贴与曲线把手**：用二分搜索定位可见帧、为每帧注册命中矩形、按类型画不同形状；拖动松手合成一条命令；粘贴把最早帧对齐播放头并覆盖同时间帧；曲线视图按 track 分行着色，只在选中时画贝塞尔把手。见 `app/widget/keyframeview/keyframeview.cpp:158-255、309-461`、`app/widget/curvewidget/curveview.cpp:107-240、293-481`、`app/node/keyframe.cpp:99-178`。

本轮把这些结构放进片段效果控件：每个叶子一行，左侧参数、右侧该属性自己的节点，多个组（如位置与朝向）同时展开；行间共用一条片段局部标尺与播放头，但节点时间轴仍逐属性独立。选中一行只改变高亮、值控件目标与节点命中范围，不把视图切到"只看这个属性"，也不隐藏其它已展开行。

可借鉴的是**交互结构与事务边界**；不可借鉴的是**逐帧自由插值类型、跨分量同步建帧、静默钳制、同时间覆盖粘贴、把本地曲线求值当作运行时真值**。后五项与我们的 schema 权威、独立属性时间轴、显式拒绝冲突、游戏真值预览四条原则直接冲突，已列入第四节不采用清单。

## 二、证据索引

> 下表的 Olive 路径均为**相对本目录**的本地快照路径（拼接 `../../../ImmersiveCinematics/example/editor/olive/` 前缀），不是 GitHub 永久链接；行号只对这份快照成立。文件存在性已按本地快照核对。我们自己的任务列用 Markdown 相对链接，指向 `plan/` 下真实存在的文档。

| # | 参考文件（相对本目录） | 主要符号与行号 | 观察到的行为 | 我们承接的既有任务 |
|---|---|---|---|---|
| 1 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/nodeparamview/nodeparamviewkeyframecontrol.cpp` | 构造 `32-71`；`SetInput 73-97`；`TimeTarget* 99-117`；`SetButtonsEnabled 119-127`；`ShowButtonsFromKeyframeEnable 137-142`；`ToggleKeyframe 144-180`；`UpdateState 182-196`；`GoToPreviousKey 198-208`；`GoToNextKey 210-220` | 四按钮行控件；失效/重绑信号；按最早/最晚帧启用前后帧；菱形按播放头有无帧切换 | [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md)、[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（四按钮在行内右列） |
| 2 | 同上 | `KeyframeEnableBtnClicked 222-285`；`KeyframeEnableChanged 287-292` | 秒表开关的确认、建帧/清帧、写回标准值、单事务提交、取消回滚 UI | [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.6 |
| 3 | 同上 | `ToggleKeyframe 144-180` | 播放头处单帧增删；删除时若该 input 只有一条 track 才写回标准值 | [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（行内菱形与节点状态）、[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.1 |
| 4 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/nodeparamview/nodeparamviewitem.cpp` | 列常量 `35-43`；`CreateWidgets 180-276`（关键帧控件 `260-268`）；`GetElementY 313-333`；`UpdateUIForEdgeConnection 345-369` | 右对齐固定列；用 label 全局中心算行 Y；input 已连接时隐藏编辑控件与关键帧控件 | [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md)（参数列）、[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（右列对齐） |
| 5 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/nodeparamview/nodeparamviewwidgetbridge.cpp` | `SetInputValue 187-194`；`SetInputValueInternal 196-199`；`ProcessSlider 201-227`；`UpdateWidgetValues 400 起` | 滑杆三态：拖动中喂 dragger、刚松手收尾入栈、无拖动直接提交 | [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.2、[12-08-GeometryTools](../12-templates-flight-tools/12-08-GeometryTools.md) §4.4 |
| 6 | `../../../ImmersiveCinematics/example/editor/olive/app/node/inputdragger.cpp` | `IsStarted 36-39`；`Start 41-84`；`Drag 86-121`；`End 123-149`；默认参数见 `app/node/inputdragger.h:37` | 拖动开始缓存起始值；keyframing 时找/建当前帧；拖动中按 min/max 静默钳制；结束交回调用方合成命令 | 同上 |
| 7 | `../../../ImmersiveCinematics/example/editor/olive/app/node/node.cpp` | `SetValueAtTime 2356-2386` | keyframing 时同 track 有帧改值、无帧按需给其它 track 补帧；否则写标准值 | [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md)、[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) |
| 8 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/slider/base/sliderbase.cpp` | `ShowEditor 148-160`；`LineEditConfirmed 162-189`；`LineEditCancelled 191-202`；`ResetValue 204-210` | 校验失败弹框并重新聚焦；成功才写值并发信号；取消只切回 label | [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.2、§3.3 |
| 9 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/slider/base/numericsliderbase.cpp` | `LabelPressed 53-65`；`LadderDragged 67-91`；`LadderReleased 93-107`；`IsDragging 134-137`；`AdjustValue 144-154`；`CanSetValue 200-203` | 拖动与单击分流；拖动结束再发一次值事件；min/max 钳制；拖动中拒绝外部 SetValue | [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.3、[12-08-GeometryTools](../12-templates-flight-tools/12-08-GeometryTools.md) |
| 10 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/keyframeview/keyframeview.cpp` | 构造 `41-52`；`DeleteSelected 55-66`；`SelectionManagerSelectEvent 158-171`；`CopySelected 188-204`；`Paste 206-255`；`mousePress 264-284`；`mouseRelease 309-323`；`BinarySearchFirstKeyframeAfterOrAt 326-352`；`drawForeground 353-425`；`DrawKeyframe 427-461`；`ShowContextMenu 536-618` | 可见区二分、同位置去重绘制、命中矩形注册；选中自动带同刻兄弟帧；松手一条命令；粘贴最早帧对齐播放头并覆盖同时间帧 | [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（可见区/命中/形状）、[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.3/§3.6 |
| 11 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/keyframeview/keyframeviewundo.h`、`.cpp` | `KeyframeSetTypeCommand 29`、`KeyframeSetBezierControlPoint 48`；cpp `28-53` | 类型切换与把手移动各记 old/new 一对值 | [06-EasingAuthoringBake](../06-async-objects/06-EasingAuthoringBake.md)、[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.6 |
| 12 | `../../../ImmersiveCinematics/example/editor/olive/app/node/keyframe.h`、`keyframe.cpp` | `Type 44-48`；`kDefaultType 59` 与 cpp `27`；`set_type 99-124`；`valid_bezier_control_in 154-165`；`valid_bezier_control_out 167-178`；`has_sibling_at_time 207-211` | 切到贝塞尔时自动给把手一个合理初值；把手的 X 只允许落在相邻帧时间之间；同 input/track/element 同刻查兄弟帧 | [06-EasingAuthoringBake](../06-async-objects/06-EasingAuthoringBake.md)、[12-09-CurveTools](../12-templates-flight-tools/12-09-CurveTools.md) |
| 13 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/curvewidget/curvewidget.cpp` | 构造 `39-116`（树 `47-50`、四按钮 `60`）；`SetNodes 158-189`；`ConnectInputInternal 258-267`；`InputSelectionChanged 336-363` | 左树只显示可动画 input 且按 track 分行；每条 track 一色并同步到树与视图；选择范围决定曲线视图连哪些 track | [07-PositionEditor](../07-position-path-curves/07-PositionEditor.md) §3.5、[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（组内分行） |
| 14 | `../../../ImmersiveCinematics/example/editor/olive/app/widget/curvewidget/curveview.cpp` | `drawBackground 107-240`；`DrawKeyframe 293-318`；`FirstChanceMousePress 320-341`；`FirstChanceMouseMove 343-381`；`FirstChanceMouseRelease 383-405`；`KeyframeDragStart 407-416`；`KeyframeDragMove 418-472`；`KeyframeDragRelease 474-481`；`ZoomToFit 634-642` | hold 画直角、双贝塞尔画 cubic、单侧贝塞尔画 quad；仅选中且 kBezier 画把手；Shift 锁一轴、Control 断开对称；拖动按 min/max 钳制；松手一次命令 | [07-CurvePathPreview](../07-position-path-curves/07-CurvePathPreview.md) §3.1/§3.4、[12-09-CurveTools](../12-templates-flight-tools/12-09-CurveTools.md) §4.2/§4.3、[06-EasingAuthoringBake](../06-async-objects/06-EasingAuthoringBake.md) §3.3 |

## 三、逐点适配

### 3.1 四按钮行控件：秒表、菱形与前后帧是三种不同语义

**来源写法（Olive）**
`NodeParamViewKeyframeControl` 构造（`nodeparamviewkeyframecontrol.cpp:32-71`）按固定顺序创建四个按钮：`prev_key_btn_`（TriLeft）、`toggle_key_btn_`（Diamond，`setCheckable(true)`）、`next_key_btn_`（TriRight）、`enable_key_btn_`（Clock，`setCheckable(true)`）。四个点击信号分别接到 `GoToPreviousKey`、`GoToNextKey`、`ToggleKeyframe`、`KeyframeEnableBtnClicked`；秒表的 toggled 信号另接 `ShowButtonsFromKeyframeEnable`，未启用动画时只显示时钟（`137-142`）。

三种语义被清楚地分开：

- **秒表** = 该 input 是否 keyframing（整个动画开关），状态来自 `input_.IsKeyframing()`（`73-97` 里 `setChecked`）。
- **菱形** = 播放头这一刻有没有帧，`UpdateState` 用 `HasKeyframeAtTime` 设置选中态（`182-196`），点击执行增删当前帧（`144-180`）。
- **前后帧** = 导航，不修改数据。`UpdateState` 用最早/最晚帧决定按钮是否可用（`182-196`），点击用 `GetClosestKeyframeBefore/AfterTime` 找到帧、经 `ConvertToViewerTime` 换到查看器时间后 `SetPlayhead`（`198-220`）。

**解决什么**
把"这个参数要不要动画"与"这一刻有没有帧"分成两个视觉状态，避免用一个按钮同时承担两种后果；同时保证前后帧导航只在有帧方向可用，减少无效点击。

**可借鉴**
- 秒表用 `mode` 判断而不是 `keyframes.length`：`mode=animated` 才显示可交互秒表，`value` 显示占位，`event` 显示列表图标。这与 [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.2 的行内容表一致。
- 菱形按钮的选中态只由"当前播放头时刻是否有帧"决定，且与秒表状态解耦。
- 前后帧按钮在无更早/更晚帧时禁用；跳转只改播放头，不动文档。
- 按钮布局右对齐、固定宽度，避免行内值控件把按钮挤走。

**不能照搬**
- Olive 的 `input_` 是一个可能含多条 track 的分量集合；`HasKeyframeAtTime`/`GetKeyframesAtTime` 对该 input 的所有 track 生效。我们的"属性叶子"（例如 `position.x`）本身就是单值单轴，不能把一个 schema 属性再拆成 Olive 式多 track，也不能让菱形一次给 x/y/z 都打帧。
- Olive 用有理数时间并做 `GetAdjustedTime` 变换；我们的时间是片段局部秒的 `number`，轴外帧保留不采样。换算规则按 [06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md)（局部标尺/播放头映射），不引入 Olive 的 rational/时间变换层。

**落到我们的任务**
- 效果控件的行（[06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) 参数列 + [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) 右节点列）承载秒表、菱形与前后节点；四类按钮在同一行可见，不把秒表做成唯一入口。
- 共享局部标尺头部只负责时间范围、播放头与缩放；"上一帧/下一帧"属于每个属性自己的节点列（导航该属性的相邻节点），不得实现成"切到只有这一个属性的页面"。
- 组只是参数列的分组标题，不生成运行时对象实例、合并 track、合并节点带、任意效果链或新的帧插值字段；行仍是完整叶子路径。选择组/功能组只改变高亮与批量操作范围，不折叠或隐藏其它已展开组。

**适配步骤**
1. 在 `ObjectRow` 的派生字段中增加 `hasKeyframeAtPlayhead`（只对 `mode=animated` 计算），供该行菱形使用。
2. 在 `EffectControlsRow` 的节点列加"上一帧 / 下一帧"两个按钮，按该行 `frames` 决定禁用；点击只把共享局部播放头移到该节点，不派发文档命令，也不改变其它已展开行。
3. 菱形按钮仅在 `mode=animated` 时渲染在该行；点击派发"当前播放头添加/删除单帧"命令，命令内部再做 ±1e-4 冲突判定；不切换面板上下文。
4. 行组件卸载、行被过滤或切换片段时清理播放头订阅；同一片段内切换选中行不重建局部标尺（见 3.4 的解绑要求）。

**人工操作检查**
- 选中一个 `mode=value` 的属性：行内没有可用秒表，也没有菱形；前后帧按钮不存在或禁用。
- 选中 `position.x`（`mode=animated`）：秒表为开；把播放头移到两帧之间，菱形为未选中；点击菱形后该时刻出现一帧，菱形变为选中，且 `position.y/z` 的帧数不变。
- 点击"下一帧"只移动播放头，帧数、值、`mode` 均不变；到最后一帧后按钮禁用。
- 点击"上一帧"在首帧处禁用。
- 同时展开位置组与朝向组：在 `position.x` 行点击菱形/前后帧，`yaw` 行与其它已展开行仍可见且左右对齐，只有 `position.x` 的节点变化。

### 3.2 秒表开关：确认、回滚 UI 与单事务

**来源写法（Olive）**
`KeyframeEnableBtnClicked`（`nodeparamviewkeyframecontrol.cpp:222-285`）先做幂等判断：`e == input_.IsKeyframing()` 直接返回，避免信号回环重复执行。启用分支：

1. 建 `MultiUndoCommand`；
2. `NodeParamSetKeyframingCommand(input_, true)`；
3. 取 `GetSplitStandardValue(input_)` 的每个分量，在播放头时刻用 `kDefaultType`（`keyframe.cpp:27` 定义为 `kLinear`）建帧；
4. 以 `"Enabled Keyframing On %1 - %2"` 作为命令名一次性 push。

停用分支：

1. `QMessageBox::warning` 明确告知"会清空所有已有帧"，只有 `Yes` 才继续；
2. 先 `GetSplitValueAtTime` 保存当前时刻采样值；
3. 对每条 track 从后往前删帧（逆序，避免边删边改变索引）；
4. 对每个分量写 `NodeParamSetStandardValueCommand`；
5. `NodeParamSetKeyframingCommand(false)`；
6. 同一 `MultiUndoCommand` 用 `"Disabled Keyframing On ..."` push。

用户点 `No` 时**没有**撤销命令，只执行 `enable_key_btn_->setChecked(true)` 把按钮视觉状态拨回去（`270-272`）。`KeyframeEnableChanged`（`287-292`）在外部状态变化时同步按钮，避免 UI 与数据不一致。

**解决什么**
关闭动画是破坏性操作（会丢帧），需要"先确认、再保存可回退的值、最后原子提交"；取消确认时必须把已经被点击改变的按钮状态恢复，否则界面会显示"已关闭"而数据仍是开启。

**可借鉴**
- 幂等前置判断，避免 checkable 按钮的 `toggled` 与 `clicked` 双触发导致重复建帧/重复删帧。
- 关闭前用一句话说明后果与帧数，确认后才执行。
- 把"保存当前采样值 → 删除全部帧 → 写回 `value` → 改 `mode`"放进**一条**撤销命令，用户一次撤销即可完整回到开启状态。
- 取消时只回滚控件状态，不产生空命令、不污染撤销栈。

**不能照搬**
- Olive 的"标准值"是每个分量一个（`GetSplitStandardValue` 返回向量），因为它一个 input 有多条 track；我们的属性叶子只有一个 `value`，关闭动画只写该叶子的 `value`，不得顺手写兄弟轴。
- Olive 停用时删除的是该 input 的**全部** track 帧；我们只删除当前属性路径的帧，不触碰同一对象其它属性。
- 我们的 `mode` 是 schema 事实，秒表只能把 `mode` 从 `animated` 切回 `value`（并保留/清空帧由任务定义），不能把 `mode=event` 或 `mode=value` 的属性"升级"为动画。

**落到我们的任务**
- [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.6（`110-118`）已规定：关闭秒表弹确认"删除 N 个关键帧并把当前值写入 value"，确认后调用 `object.disableAnimation`；播放头已有帧时秒表显示实心且不切换。
- [06](../06-async-objects/README.md) 的命令表已含 `object.enableAnimation` / `object.disableAnimation`，本点只补充事务与回滚细节，不新增命令。

**适配步骤**
1. `disableAnimation` 命令实现为单个文档事务：读取播放头局部时刻的采样值（无帧则用当前值摘要）→ 删除该路径全部帧 → 写 `value` → `mode='value'`。
2. UI 侧在弹确认前缓存 `wasEnabled`；用户取消时把开关复位到 `wasEnabled`，不调用命令。
3. 命令执行后统一从文档重新派生行状态（不要乐观改本地布尔），避免与撤销/重做脱节；只刷新相关行，不重建片段上下文、不折叠其它已展开组。
4. 确认文案带帧数与"当前值将写入 value"，与 06 表格文案保持一致。

**人工操作检查**
- 对一个有 5 帧的 `position.x` 点秒表：出现确认，文案含"5 个关键帧"；点取消后秒表仍为开、5 帧仍在、撤销栈没有新增条目。
- 再次点秒表并确认：帧数变 0、`mode=value`、`value` 等于关闭时播放头处的采样值；按一次撤销，5 帧、`value`、`mode` 全部恢复。
- 播放头正好在某一帧上时点秒表：按 06 规则不执行切换（实心状态），不出现确认框。
- 对 `position.y` 执行关闭：`position.x/z` 的帧与 `mode` 完全不变，且两行仍展开可见。

### 3.3 菱形单帧切换与"最后一个帧"回写

**来源写法（Olive）**
`ToggleKeyframe(bool e)`（`144-180`）取播放头对应的节点时间与 `GetKeyframesAtTime` 结果，建 `MultiUndoCommand`：

- `e && keys.isEmpty()`：对 `GetNumberOfKeyframeTracks` 的每条 track，用 `GetSplitValueAtTimeOnTrack` 的值与 `GetBestKeyframeTypeForTimeOnTrack` 的类型建帧并插入；
- `!e && !keys.isEmpty()`：逐个删除该时刻的帧；并且仅当 `GetKeyframeTracks(input_).size() == 1`（该 input 只有一条 track）时，额外把标准值设为该时刻的值。

命令名 `"Toggled Keyframe"`，一次 push。

**解决什么**
把"在播放头加/删一帧"做成可逆的单步操作，并处理"删掉唯一一条轨上的帧后，参数需要有一个静态值"的收尾问题。

**可借鉴**
- 单帧切换是独立命令，不与秒表开关混用。
- 删除时区分"这是不是该属性唯一的帧"，若是则把该时刻采样值落到 `value`，避免删完后属性无值可读。
- 命令名清晰，撤销历史可读。

**不能照搬**
- **跨 track 同步建帧是本条最大的不可照搬点**：`for i in nb_tracks` 会给同一 input 的所有分量同时打帧。我们明令禁止同步 x/y/z 补帧；菱形只作用于当前属性叶子。
- `GetBestKeyframeTypeForTimeOnTrack` 会按上下文挑 `kLinear`/`kHold`/`kBezier`。我们的 `interp` 来自 schema，不能在 UI 层挑类型。
- "唯一一条 track 才回写标准值"在 Olive 里是分量模型的特例；我们的判定应是"该属性路径是否只剩这一帧且 `mode=animated`"，且是否回写 `value` 属于产品决定，不能从 Olive 直接推导。

**落到我们的任务**
- [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)（行内菱形、节点状态与命中）与 [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.1 已规定：在播放头添加、±1e-4 冲突拒绝；本点补充删除路径与"最后一帧"的收尾。
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.1 的命令表是唯一入口；不得为菱形新增旁路命令，也不得因点击菱形隐藏/切换其它行。

**适配步骤**
1. 菱形点击映射为 `addKeyframe` 或 `removeKeyframe`，参数为 `{clipKey, path, time}`，其中 `time` 已经由全局播放头换成本片段局部秒；目标行保持展开、不切换视图。
2. `addKeyframe` 先做 ±1e-4 查重，冲突则拒绝并提示，不建帧。
3. `removeKeyframe` 后若该路径帧数为 0：按 06 决定是保留 `mode=animated`（空动画）还是提示用户改用秒表关闭；不得静默改 `mode`。
4. 不读取、不写入任何兄弟轴。

**人工操作检查**
- 播放头在 `position.x` 两帧之间点菱形：只新增 `position.x` 一帧；`position.y/z` 帧数、值、时间戳不变，且它们所在行仍展开可见。
- 播放头正好在 `position.x` 已有帧上点菱形：该帧被删除，其它属性不变。
- 在 `position.x` 仅剩一帧时删除它：界面明确显示"该属性已无关键帧"，`mode` 不自动改变；随后操作仍可撤销。
- 连续点击菱形多次，撤销历史中出现等量的独立条目，且每次只影响一个属性。

### 3.4 字段绑定/解绑：复用控件不能串属性

**来源写法（Olive）**
`SetInput`（`nodeparamviewkeyframecontrol.cpp:73-97`）在替换 `input_` 前，如果旧 input 有效，先 `disconnect` 四类信号：`KeyframeEnableChanged`、`KeyframeAdded`、`KeyframeRemoved`、`KeyframeTimeChanged`；随后 `SetButtonsEnabled(input_.IsValid())`、用 `input_.IsKeyframing()` 设置秒表、调用 `UpdateState()` 刷新菱形与前后帧，最后才给新 input 重绑同样四类信号。`TimeTargetConnectEvent`/`TimeTargetDisconnectEvent`（`99-117`）对播放头变化做同样的连/断。

`NodeParamViewItemBody::CreateWidgets`（`nodeparamviewitem.cpp:180-276`）把关键帧控件与 `widget_bridge` 绑定到同一个 `resolved` input（`260-268`），并在 `SetTimeTarget` 时逐个 `InputUI` 下发（`277-296`）。

**解决什么**
同一个控件实例会被复用到不同参数上（滚动复用、切换选中行、数组元素增删）。如果只改数据引用而不断开旧信号，旧节点的帧变化会继续驱动新行的按钮状态，出现"改 A 行、B 行闪"的串扰。

**可借鉴**
- **先断后绑**，且断与绑使用同一组信号名。
- 绑定后立即做一次全量状态刷新（`UpdateState`），不依赖下一次事件。
- 无效 input 也要能安全渲染（按钮全部禁用），而不是隐藏或抛错。
- 时间目标（播放头）连接与数据连接分开管理。

**不能照搬**
- Olive 把 `KeyframeEnableChanged/Added/Removed/TimeChanged` 直接挂在 `Node` 上，靠 `NodeInput` 过滤。我们的文档是纯数据 + 命令，UI 通常通过 store 订阅；不能为了模仿而引入节点级全局事件总线。
- `NodeParamViewItemBody` 的 `InputUI` 把"值控件、连接标签、关键帧控件、数组按钮"塞进一个结构并共用行号。我们的行是属性叶子，数组/分量是不同层级，不能复刻这个复合结构。

**落到我们的任务**
- [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.1/§3.2：`ObjectRow` 是派生数据，行组件必须只读 props，不持有跨行状态。
- [06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md)：只有切换片段（`clipKey`）才重建容器上下文；同一片段内换 `objectPath` 不清空其它已展开组、不重建共享局部标尺。
- [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)：行组件按 `clipKey + path` 绑定；`path` 变化只重置该行的选中节点、编辑态、错误文案与局部映射，不隐藏其它行。

**适配步骤**
1. 行组件使用 `watch(() => [props.clipKey, props.path], ...)`，在回调里只重置本行本地状态（选中集合、编辑态、错误文案）并重新派生；共享局部标尺与片段上下文不动。
2. 所有订阅（播放头、store 选中变化）在 `onBeforeUnmount` 与 `clipKey/path` 变化时注销；不要依赖组件销毁才清理。
3. 列表复用 DOM 时，用 `:key` 绑定 `clipKey + path`，避免 Vue 复用实例导致输入框残留上一个属性的值；不得用这个 key 重建整个效果控件或折叠其它组。
4. 对无效路径（属性被删除、`requires` 不满足）渲染为禁用态，并在行内显示原因，而不是留空或隐藏整行。
5. 选择组标题只改变高亮/批量范围，不改变其它组的展开状态，也不生成合并行或对象实例。

**人工操作检查**
- 在属性列表快速上下切换 10 个不同属性：每一行的秒表/菱形状态只反映当前属性，不出现上一行的残留；其它已展开行始终可见。
- 切换选中行后立即点击共享局部播放头：新行的节点高亮随播放头更新，旧行不再抢占高亮，其它行保持显示。
- 删除当前选中属性后，该行显示"属性不存在/不可用"，其它组不受影响，不抛异常、不显示旧值。
- 展开/折叠分组后行顺序变化，输入框内容仍与路径对应。

### 3.5 参数控件提交/取消：失败保持编辑态，取消不改数据

**来源写法（Olive）**
`SliderBase` 的标签与编辑器是两个堆叠 widget（`ShowEditor 148-160` 把 label 文本装入 editor、切页、聚焦并全选）。`LineEditConfirmed`（`162-189`）先用 `StringToValue` 解析并返回 `is_valid`：

- 有效：`SetValueInternal(test_val)`（内部会做范围处理）→ 切回 label → `ValueSignalEvent(value_)`；
- 无效：`QMessageBox::critical` 说明"不是该字段的有效值"，然后 `editor_->setFocus()` 重新聚焦，**不写值、不切页**。

期间对 `editor_`/`label_` 做 `blockSignals(true/false)`，避免切页触发失焦信号造成二次提交。`LineEditCancelled`（`191-202`）只切回 label，丢弃编辑内容，不发值信号。`ResetValue`（`204-210`）在存在默认值时写默认值并发一次值事件。

**解决什么**
文本输入存在"非法中间态"。如果失焦即提交，用户输错会被静默吞掉或写坏数据；如果取消也提交，Esc 就失去意义。

**可借鉴**
- 提交是一个显式动作（回车/失焦），但**校验失败不提交**，保持编辑态并提示。
- 取消（Esc）丢弃输入并恢复显示，不产生文档变更。
- 提交成功才发一次值变化事件；不要在每次按键时提交。
- 重置是独立动作，写入的是 schema 默认值，不是"清空"。

**不能照搬**
- Olive 的 `SetValueInternal` 会按 min/max 处理（见 3.6 的 `AdjustValue`）。我们的 [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.3（`80-85`）要求**超范围拒绝并提示，不钳制**；不能借"内部会处理"把非法值悄悄改成边界值。
- Olive 用模态 `QMessageBox`；WebUI 用行内错误或 toast 更合适，且不能阻塞后续编辑。
- Olive 的 `ResetValue` 直接写默认值；我们的 `nullable_float` 有 `null` 与 `0` 的区别（[06-StepNullableAndEnum](../06-async-objects/06-StepNullableAndEnum.md) §3.3），"重置"必须区分"回到 schema 默认"与"显式 null"。

**落到我们的任务**
- [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.2 提交语义（`68-79`）：失焦/回车提交、Esc 取消；§3.3 单位与范围（`80-85`）：拒绝不钳制。
- [06-StepNullableAndEnum](../06-async-objects/06-StepNullableAndEnum.md) §3.2/§3.3：step 与 nullable 的控件表现。
- 同一 `PropertyValueForm` 供效果控件（`clip.effects`）与快捷属性（`selection.properties`）使用；快捷属性不缓存第二份值，也不另造一套提交/撤销路径。

**适配步骤**
1. 表单内部维护 `draft` 与 `editing`；`commit()` 解析 → 类型/单位/范围校验 → 失败则保留 `draft`、聚焦输入、显示错误，不派发命令。
2. `cancel()` 把 `draft` 重置为文档值并退出编辑态；`Esc` 与"取消"按钮走同一路径。
3. 提交成功后以文档回读值刷新 `draft`（不要用用户输入的字符串直接回显），避免显示与数据不一致。
4. 数字输入不使用 `input` 事件直接写文档；拖动类控件另走 3.6 的提交边界。
5. 快捷属性中的编辑与效果控件行内编辑命中同一 `{clipKey, path, time}` 目标；提交后两处都从文档回读，不互相写本地副本。

**人工操作检查**
- 在 `position.x` 输入 `abc` 回车：显示错误、输入框仍处于编辑态且内容保留、文档值不变、撤销栈无新增。
- 输入超出 schema `min/max` 的值回车：被拒绝并提示范围；文档值不变（不是被改成边界值）。
- 输入合法值后按 Esc：显示恢复为原值，文档不变。
- 修改后失焦：只提交一次，撤销历史只有一条。
- 在快捷属性中修改同一 `{clipKey, path}` 的值：效果控件对应行同步显示新值；取消或校验失败时两处都不变，不出现第二份草稿。

### 3.6 拖动聚合：拖动中不写历史，松手一条命令

**来源写法（Olive）**
`NodeParamViewWidgetBridge::ProcessSlider`（`nodeparamviewwidgetbridge.cpp:201-227`）用三态处理滑杆回调：

1. `slider->IsDragging()`：若 `dragger_` 未启动，取当前节点时间 `dragger_.Start(track, node_time)`，随后 `dragger_.Drag(value)`；
2. 不在拖动但 `dragger_.IsStarted()`（刚松手）：再 `Drag(value)` 收尾，建 `MultiUndoCommand`、`dragger_.End(command)`、push 一次；
3. 其余（点击/直接设值）：走 `SetInputValue`，内部建命令并 `Node::SetValueAtTime`（`node.cpp:2356-2386`）。

`NodeInputDragger::Start`（`inputdragger.cpp:41-84`）缓存 `start_value_`；若 input 正在 keyframing，先找当前帧，找不到就建一个，并在 `create_key_on_all_tracks` 为 true（`inputdragger.h:37` 的默认值）时给其它 track 也建帧。`Drag`（`86-121`）按 `min`/`max` 属性静默钳制后，keyframing 时改 `dragging_key_` 的值，否则写标准值。`End`（`123-`）把起止值交给调用方合成命令。

**解决什么**
拖动会产生几十上百次值变化。如果每次都入撤销栈，用户要按几十次撤销才能回到拖动前；如果拖动中直接写文档并触发保存/预览重算，性能和一致性都会崩。

**可借鉴**
- 用 `IsDragging` / `IsStarted` 两个状态把"开始、过程、结束"分开；结束才提交一条命令。
- 拖动开始时缓存起始值，结束命令用 `old/new` 一对值，撤销可精确恢复。
- 非拖动路径（点击步进、直接输入）走独立的单次提交，不与拖动状态机混用。
- 拖动中阻断外部重复设值（`NumericSliderBase::CanSetValue 200-203` 在拖动中只允许内部设置），避免递归。

**不能照搬**
- **`create_key_on_all_tracks` 默认 true 的跨分量建帧**：这正是我们禁止的"同步 x/y/z 补帧"。我们的拖动只作用于被拖的那一个属性路径。
- **静默钳制**：`InputDragger::Drag` 与 `CurveView::KeyframeDragMove` 都把超界值改成 min/max。我们要求拒绝并提示；拖动中若越界，应停在边界并显示原因，或直接不允许提交越界值，不能悄悄替换。
- **拖动开始就建帧**：Olive 在 `Start` 里就创建关键帧对象。我们的命令模型应在松手时一次性生成"新增/更新"结果，避免拖动中途产生半成品帧。
- `Node::SetValueAtTime` 的"无帧时给其它 track 补帧"分支（`2356-2386`）不能进入我们的实现。

**落到我们的任务**
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.6 撤销粒度（`122-127`）：拖动一帧松手一次提交。
- [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.2：非拖动提交。
- [12-08-GeometryTools](../12-templates-flight-tools/12-08-GeometryTools.md) §4.4（`61-68`）：Gizmo 拖拽若属性已有 keyframes，在播放头新增/更新节点，一次事务。

**适配步骤**
1. 在表单/滑杆层维护 `dragSession = { path, startDocValues, startPointer, lastValue }`；`pointerdown` 只记录，不派发命令。
2. `pointermove` 只更新本地预览值与越界标记；不写文档、不入历史，也不影响同一片段其它属性行及其节点位置。
3. `pointerup`：若值未变则丢弃会话；若越界则拒绝并提示；否则派发一条命令（新增帧或更新播放头处帧），命令内部完成 ±1e-4 查重。
4. Gizmo 复用同一提交函数，确保"已有帧 → 播放头新增/更新"与"无帧 → 改 value"两条路径只有一处实现。
5. 拖动中禁用保存快捷键与自动保存，避免把中间态写盘。

**人工操作检查**
- 按住滑杆从 0 拖到 10 再松手：只产生一条撤销记录；一次撤销回到 0。
- 拖到 schema 上限之外：界面显示越界提示，松手后文档值不超过上限，且没有"被悄悄改成上限"的额外帧。
- 拖动一个 `position.x` 的已有帧：只改该帧的值；`position.y/z` 不变；松手前预览变化、松手后才进历史；同时展开的 `yaw` 行节点位置与帧数不变。
- 在 Gizmo 拖动 `dest` 且该属性已有帧：松手后播放头处新增/更新一帧，其它时间点帧不变。

### 3.7 关键帧可见区绘制、命中与形状语义

**来源写法（Olive）**
`KeyframeView::drawForeground`（`keyframeview.cpp:353-425`）对每条 track：

1. 若禁用 Y 轴或该 track 的 Y 在视口外，直接跳过；
2. 用 `BinarySearchFirstKeyframeAfterOrAt`（`326-352`）在按时间排序的帧数组里找到视口左边界的第一帧，避免从头遍历；
3. 逐帧计算矩形；对"同一位置且同一类型"的相邻帧跳过绘制（`373-396`），避免叠画；
4. 调用 `DrawKeyframe`，再更新 `next_key`/`last_type` 继续扫描，超过右边界即停。

`DrawKeyframe`（`427-461`）先按选中状态选画笔，然后 `selection_manager_.DeclareDrawnObject(key, key_rect)` 注册命中矩形，最后按类型画形状：`kLinear` 菱形、`kBezier` 圆、`kHold` 方块、`kInvalid` 不画。

**解决什么**
时间轴上帧可能非常密集。全量绘制会卡，纯按像素去重又会漏掉真实重叠帧；先二分定位可见区、再对同位置同类型去重，是成本与正确性的折中。形状让用户一眼看出插值/保持语义，命中矩形让点击/框选有确定目标。

**可借鉴**
- 可见区二分 + 到右边界即停，适合效果控件右列的行/节点虚拟化；局部视口由 06 自建，不依赖主时间轴行框架。
- 同一属性行内的密集节点可做纯显示避让或可展开聚簇，但每个实际时间仍须能明确选择；不跨属性行聚合，不把不同属性同刻节点画成一个组帧。主时间轴不显示任何节点聚簇或汇总标记。
- 帧形状承载语义：`step` 用方块（对应 Olive 的 hold），线性用菱形；这与 [06-StepNullableAndEnum](../06-async-objects/06-StepNullableAndEnum.md) §3.2"step 画台阶/方块"一致。
- 命中区域显式注册，而不是用坐标反推，框选/点选更稳。

**不能照搬**
- Olive 的 `kBezier` 是每帧可选类型，我们不存在"这一帧是贝塞尔"的脚本事实；`interp` 是属性级只读。形状只能表达 `linear`/`angle`/`geometric`/`step` 的**显示**差异，不能反过来让用户点形状改插值。
- Olive 的 `kInvalid` 是内部状态；我们没有"无效帧"这种可落盘状态，非法帧应在命令层被拒绝，而不是画成空。
- 不能用本地绘制的曲线形状暗示运行时采样结果（见 3.9）。

**落到我们的任务**
- [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)：左右行对齐、节点几何/命中、局部视口缩放/平移、纵向虚拟化与轴外显示都由它实现；行/节点绘制只在效果控件局部秒坐标系内。
- [06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md)：提供统一局部标尺、播放头与行上下文；不为每个属性另起标尺或独占面板。
- [05-04-TimelineView](../05-timeline-workspace/05-04-TimelineView.md) 只负责主时间轴全局标尺、片段块与全局播放头；**不承担**节点行虚拟化、局部缩放或轴外帧显示。

**适配步骤**
1. 行内帧渲染按 `frames` 已排序的前提做二分（时间数组单独维护，避免每次 filter）；视口左右边界取效果控件局部 viewport 的 `from/to`（片段局部秒），不用主时间轴 `scrollLeft`。
2. 用 `:key="frame.time"` 渲染该行帧标记；同 `time` 的重复帧在数据层已不可能（±1e-4 拒绝），显示层无需再做合并。
3. 形状映射：`interp==='step'` → 方块；`linear` → 菱形；`angle`/`geometric` → 菱形加不同描边或角标（仅显示区分，不写盘）。
4. 命中用元素自身 bounding box 或显式 hitbox，不依赖父容器坐标推算。
5. 左参数列与右节点列共用同一行高与纵向窗口；滚动/字体缩放时两列同步，不能各滚各的。

**人工操作检查**
- 一个属性有 500 帧，水平缩放到只显示中间 20 帧：滚动流畅，屏幕外帧不产生 DOM（或至少不参与命中）。
- `interp=step` 的属性帧显示为方块；`interp=linear` 显示为菱形；切换属性不串形状。
- 在两个帧重叠的缩放级别下，点击能选中正确的帧，不出现"点一个选中另一个"。
- 折叠分组后帧标记随行隐藏，展开后位置正确。
- 缩放效果控件局部标尺时，主时间轴片段宽度、轨道高度与全局缩放不变；左右列仍对齐。

### 3.8 选择、拖动与复制粘贴：一次提交 vs 冲突全拒

**来源写法（Olive）**
- 构造（`keyframeview.cpp:41-52`）默认 `autoselect_siblings_(true)`。`SelectionManagerSelectEvent`（`158-171`）在选中一帧时，用 `GetKeyframesAtTime(input, time, element)` 把同 input/同刻/同 element 的其它 track 帧一并选中；取消同理（`173-186`）。
- `DeleteSelected`（`55-66`）把所有选中帧的删除命令塞进一个 `MultiUndoCommand`，一次 push。
- `mouseReleaseEvent`（`309-323`）在拖动结束时建一个 `MultiUndoCommand`，先 `selection_manager_.DragStop(command)`，再 `KeyframeDragRelease(event, command)`，最后以 `"Moved %1 Keyframe(s)"` 一次 push。
- `CopySelected`（`188-204`）把选中帧序列化到剪贴板；`Paste`（`206-255`）先求所有被粘贴帧的最早时间 `min`，再 `min -= GetViewerNode()->GetPlayhead()`，使粘贴后最早帧落在播放头；对每帧 `t = key->time() - min`，若目标同 input/track/element/时间已有帧，先 `NodeParamRemoveKeyframeCommand(existing)` 再插入；找不到目标节点则丢弃该组帧。整个过程一条命令。
- 右键菜单（`536-618`）对选中帧提供 Linear/Bezier/Hold 三选一，批量生成 `KeyframeSetTypeCommand`（`keyframeviewundo.h:29`）。

**解决什么**
多选拖动/删除必须是一个原子操作，否则撤销会拆成很多步；粘贴需要可预期的落点（最早帧对齐播放头），并且要处理目标时刻已有帧的冲突。

**可借鉴**
- 删除、拖动、粘贴各自合成**一条**命令，命令名带数量，撤销历史可读。
- 粘贴以"最早帧对齐播放头"为锚点，保留帧间相对时间；跨片段时按目标片段局部秒解释。
- 粘贴前先做目标存在性检查，缺失目标的帧不静默写坏数据。
- 选择集变化驱动按钮可用性（菜单/删除按钮只在有选中时启用）。

**不能照搬**
- **同时间覆盖**：Olive 先删后插，等于静默覆盖已有帧。我们的 [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.3（`84-99`）要求任一目标时间冲突则**全部拒绝**，不做部分粘贴，更不覆盖。
- **`autoselect_siblings_` 的跨 track 联动选择**：它建立在"一个 input 多 track"上。我们的多选只允许同一属性内，跨属性最多允许批量删除（06 §3.4），不因为时间相同就自动把 x/y/z 都选上。
- **右键改类型**：我们的 `interp` 不可编辑；菜单最多提供"查看该属性插值"的只读说明，不能派发 `setKeyframeType`。
- Olive 粘贴用节点 ID 找目标；我们用 `clipKey + path`，且要校验类型兼容（例如把 `yaw` 的帧粘到 `position_mode` 应拒绝）。

**落到我们的任务**
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.3 复制/粘贴（`84-99`）、§3.4 多选（`101-110`）、§3.6 撤销粒度（`122-127`）。
- [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.2 吸附（`71-82`）：吸附只在拖动结束应用，冲突拒绝。

**适配步骤**
1. 复制时记录 `{path, type, frames:[{dt, value}]}`，`dt` 相对最早帧；粘贴时以目标锚点时间 `at` 为最早帧时间，逐个生成绝对时间。
2. 粘贴前做三轮校验：目标属性存在且 `mode=animated`、每帧类型兼容、所有目标时间 `>=0` 且两两不冲突且与现有帧不冲突；任一失败返回原因并不写文档。
3. 拖动多选帧时只在内存更新位移量，`pointerup` 生成一条 `moveKeyframes` 命令；位移后若与未选中帧冲突，整批拒绝。节点多选只在效果控件右列内成立，主时间轴不参与、不显示节点选择。
4. 删除多选帧一条命令；跨属性多选只暴露"删除"，不暴露"移动/改值"。
5. 不实现"同时间自动覆盖"选项。

**人工操作检查**
- 选中 3 帧一起拖动 2 秒后松手：3 帧同时移动，一条撤销记录；撤销后全部回原位。
- 复制 2 帧粘贴到播放头为 5.0s 的位置：最早帧落在 5.0s，第二帧保持原相对间隔；若 5.0s 已有帧，整次粘贴被拒绝并提示冲突，文档不变。
- 从 `yaw` 复制粘贴到 `position_mode`：被拒绝，提示类型不兼容。
- 跨属性多选 2 个属性的帧：只有"删除"可用，"移动/改值"不可用。
- 按住 Alt 拖动：吸附临时关闭，松手后不出现"吸附导致重叠"。
- 在效果控件多选 3 帧拖动时，主时间轴只保持该片段的片段选择/高亮，不出现节点、对象展开或汇总标记。

### 3.9 分量行、曲线把手与"显示近似"边界

**来源写法（Olive）**
- `CurveWidget` 构造（`curvewidget.cpp:39-116`）左侧是 `NodeTreeView`，设置 `SetOnlyShowKeyframable(true)` 与 `SetShowKeyframeTracksAsRows(true)`（`47-50`），即只列可动画参数，并把每条 track 拆成一行；顶部复用 `NodeParamViewKeyframeControl(false)`（`60`）与 Linear/Bezier/Hold 三个可选中按钮。
- `SetNodes`（`158-189`）为每个 `NodeKeyframeTrackReference` 生成随机 HSL 颜色，同时写入树与曲线视图，保证同名 track 在两处颜色一致。
- `InputSelectionChanged`（`336-363`）：选中的是具体 track → 只 `ConnectInput(ref)`；选中的是数组 input → 连接全部 track；选中的是节点 → 遍历所有可动画 input 连接；最后 `ZoomToFit`。
- `CurveView::drawBackground`（`curveview.cpp:107-240`）为每条已连接 track 画路径：起点前水平线、`kHold` 直角、两端都 `kBezier` 时用 `valid_bezier_control_out/in` 画 cubic、仅一端 `kBezier` 时画 quad、其余直线，末端再画水平线。
- `DrawKeyframe`（`293-318`）只在"该帧被选中且 `type()==kBezier`"时画两个把手圆点与连线，并把把手矩形登记到 `bezier_pts_` 供命中。
- `FirstChanceMousePress`（`320-341`）优先命中把手；`FirstChanceMouseMove`（`343-381`）Shift 时把 `mouse_diff_scaled.y` 清零（只改一轴），Control 时不联动另一侧把手，否则另一侧取当前把手的反向；`FirstChanceMouseRelease`（`383-405`）用 `KeyframeSetBezierControlPoint` 记录 old/new 两条，一条命令提交。
- `KeyframeDragMove`（`418-472`）Shift 时把所有选中帧的值恢复为拖动前值（只允许改时间），否则按 Y 位移换算值并做 min/max 钳制；`KeyframeDragRelease`（`474-481`）只对实际变化的帧生成 `NodeParamSetKeyframeValueCommand`。
- `NodeKeyframe::set_type`（`keyframe.cpp:99-124`）切到 `kBezier` 时若把手为空，给前/后把手一个到相邻帧间距一半的初值（无邻居时分别 `-1`/`+1`）；`valid_bezier_control_in/out`（`154-178`）把把手 X 限制到相邻帧时间之间，Y 不限制；`has_sibling_at_time`（`207-211`）按 input/track/element/时间查同刻帧。

**解决什么**
多分量参数需要"分行、分色、可选范围"才能在曲线视图里读；贝塞尔把手需要在有限的段内可拖且不越过邻帧；拖动关键帧时需要区分"改时间"与"改值"。

**可借鉴**
- 左树按属性/分量分行，曲线视图只显示选中范围的 track；颜色在树与图之间保持一致。该"只显示选中范围"只适用于曲线/路径预览图，不适用于效果控件参数行——行仍必须保持可见。
- **把手只在选中时显示**，减少视觉噪声，也避免误拖。
- Shift 锁定单轴、Control 断开两侧对称，是低学习成本的约束手势。
- 松手时只为"实际变化"生成命令，减少空撤销条目。
- 把手 X 限制在相邻帧之间，是段内编辑的自然边界（注意 Olive 只限制 X，Y 不限）。

**不能照搬**
- **每帧可切换 Linear/Bezier/Hold 并写入脚本**：我们的 `interp` 是 schema 只读，曲线视图不能提供类型按钮，也不能把把手落盘。
- **本地贝塞尔求值当作曲线真值**：Olive 在自己的视图里画 cubic/quad 并据此交互。我们的 [07-CurvePathPreview](../07-position-path-curves/07-CurvePathPreview.md) §3.1（`47-56`）规定无宿主时只画控制多边形与端点并标注"仅示意"；§3.4（`88-95`）要求三个提示；[12-09-CurveTools](../12-templates-flight-tools/12-09-CurveTools.md) §4.2（`66-70`）明确编辑器只做近似折线、不写回、不声称与运行时一致。
- **随机 HSL 颜色**：不可复现，且不利于识别同一轴在不同面板的一致性。我们按轴固定语义色。
- **`set_type` 自动造把手**：我们没有"帧类型"可切；若未来为 `authoring.easing` 提供可视化，也只能是元数据，不进入脚本。
- **min/max 静默钳制**：`KeyframeDragMove` 把越界值改成边界；我们拒绝并提示。
- Olive 的 hold 直角是插值语义；我们 `step` 的显示台阶/方块只表达 `interp=step`，不能暗示"运行时按这个直角连续采样"。

**落到我们的任务**
- [07-PositionEditor](../07-position-path-curves/07-PositionEditor.md) §3.2（`70-80`）组合规则、§3.5 三轴联动（`126-130`）：在效果控件的同一功能组内同时展开 `position.x/y/z` 三行，复用 06 的行/值控件；不复制时间轴、不切到单轴独占页。
- [07-CurvePathPreview](../07-position-path-curves/07-CurvePathPreview.md) §3.1/§3.4/§3.6：预览降级、提示、切线箭头。
- [12-09-CurveTools](../12-templates-flight-tools/12-09-CurveTools.md) §4.2 预览可视化、§4.3 控制点拾取、§6 禁止修改。
- [06-EasingAuthoringBake](../06-async-objects/06-EasingAuthoringBake.md) §3.1 元数据结构（`56-68`）、§3.3 缓动曲线（`96-108`）、§3.4 不烘焙清单（`109-119`）。

**适配步骤**
1. 三轴联动的三行 `position.x/y/z` 各自绑定 `frames`，选择一行不影响另外两行的帧集合；三行与其它组（如朝向）可同时展开，选择只改高亮/编辑目标，不隐藏其它行。
2. 颜色按轴固定：x/y/z 各一色，并在图例与行标签一致；不使用随机色。
3. 曲线区域在有宿主采样时画宿主回传点；无宿主时画控制多边形 + 端点 + `s(u)` 折线，并在固定位置显示"显示近似，实际以运行时为准"。
4. 若为 `authoring.easing` 提供把手式编辑，把手只修改 `authoring.easing[]`，保存时剥离；烘焙必须显式触发 `bakeSegment`，且 `step`、`paths`、`orient`、`yaw_offset`、`pitch_offset` 等按 06 §3.4 不烘焙。
5. 拖动控制点/关键帧时，越界不写文档；松手只为变化项生成一条命令。
6. 不提供"改插值类型"按钮；如需展示，只读显示 schema 的 `interp`。

**人工操作检查**
- 打开位置组：x/y/z 三行颜色固定且互不相同；选中 x 行不会让 y/z 的帧高亮；同时展开朝向组时，`yaw` 行仍可见。
- 断开宿主（或宿主不支持采样）时打开路径预览：显示控制多边形、端点与"仅示意"提示，不显示平滑曲线，也不显示"与游戏一致"。
- 连接宿主后同一路径：采样点来自宿主；编辑器不自行计算弧长或声称一致。
- 若启用 `authoring.easing` 把手：拖动只改元数据，保存后重开文档，元数据消失（已烘焙的帧保留）；`step` 属性不出现缓动入口。
- 拖动越界时松手：文档值不被钳制到边界，出现拒绝提示。

## 四、不采用清单

以下做法在 Olive 中成立，但在我们的格式与产品前提下**明确不采用**。列在这里是为了防止后续实现"顺手照搬"。

| # | Olive 做法 | 位置 | 不采用的原因 | 我们的替代 |
|---|---|---|---|---|
| 1 | 每个关键帧可自由切 `kLinear/kHold/kBezier` 并落盘 | `keyframe.cpp:99-124`；`keyframeview.cpp:536-618` | `interp` 由 schema/parser 决定，脚本无逐帧类型字段；写盘会产生格式外数据 | 只读展示 `interp`；缓动作为 `authoring.easing[]` 会话元数据，显式烘焙 |
| 2 | 建帧/拖动时同步所有 track（x/y/z 一起补帧） | `nodeparamviewkeyframecontrol.cpp:144-180、222-285`；`inputdragger.cpp:41-84`；`node.cpp:2356-2386` | 属性叶子各有独立时间轴；同步补帧会制造用户没要求的帧，破坏独立编辑 | 命令只接受单一 `path`；兄弟轴必须由用户显式操作 |
| 3 | 选中一帧自动选中同刻所有 track 帧 | `keyframeview.cpp:158-186`（`autoselect_siblings_`） | 同 #2；跨属性多选只允许批量删除 | 选择集限定同一属性；跨属性多选禁用移动/改值 |
| 4 | 拖动时按 min/max 静默钳制 | `inputdragger.cpp:86-121`；`numericsliderbase.cpp:144-154`；`curveview.cpp:418-472` | 静默改值会掩盖用户输入错误，且与运行时拒绝语义不一致 | 越界拒绝并提示；不写入被修改的值 |
| 5 | 粘贴时同时间"先删后插"覆盖 | `keyframeview.cpp:206-255` | 覆盖会无声丢帧，且与"严格递增、冲突拒绝"冲突 | 任一冲突整批拒绝；不做部分粘贴 |
| 6 | 输入已连接时隐藏编辑控件与关键帧控件 | `nodeparamviewitem.cpp:345-369` | 我们的"连接/引用"不是上游值覆盖语义，不能据此隐藏位置帧控件 | 只读显示来源说明；控件保持可见或按 schema 禁用 |
| 7 | 每个 track 随机 HSL 色 | `curvewidget.cpp:158-189` | 颜色不可复现，跨会话/跨面板难对齐 | 按轴固定语义色 |
| 8 | 本地绘制贝塞尔并据此宣称曲线形状 | `curveview.cpp:107-240` | 真值在运行时 `PathEvaluator`；本地求值会误导 | 宿主采样优先；无宿主只画控制多边形并标注近似 |
| 9 | 用有理数时间与 `GetAdjustedTime` 做节点/查看器换算 | `nodeparamviewkeyframecontrol.cpp:129-135` | 我们的时间是片段局部秒，轴外帧保留；引入第二套时间模型会与 parser 冲突 | 统一用 `playheadGlobal - clip.start_time`，独立片段按 0 |
| 10 | 复用 GPL 图标（TriLeft/Diamond/TriRight/Clock）与工具按钮外观 | `nodeparamviewkeyframecontrol.cpp:40-58` | 许可与资产边界；本文不主张可直接复用 | 自绘/自有图标，语义对齐即可 |

## 五、到既有类任务的映射

| Olive 观察点 | 我们的落点（文件） | 我们的类/函数（已有或提案） | 需要新增/修改的内容 | 明确不做 |
|---|---|---|---|---|
| 四按钮与状态刷新（3.1） | [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.2/§3.6；[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) | `ObjectRow`、`EffectControlsRow.vue`（提案）、`buildRows` | 行内 `hasKeyframeAtPlayhead`；行内前后节点按钮 | 不把菱形做成秒表；不跨属性导航；不切单属性页 |
| 多组同屏与片段上下文（3.1/3.4） | [06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md) | 容器组件（提案）、共享局部标尺 | 一个片段派生全部适用行；换行不清空其它组；共享标尺只随片段重建 | 不按属性拆面板；不用一属性独占时间轴 |
| 秒表确认与事务（3.2） | [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.6；[06 README](../06-async-objects/README.md) 命令表 | `object.enableAnimation` / `object.disableAnimation`（已有任务） | 关闭事务：采样→删帧→写 value→改 mode；取消回滚 UI | 不写兄弟轴；不改 `mode=event/value` |
| 菱形单帧（3.3） | [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)；[06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.1 | `addKeyframe` / `removeKeyframe`（已有任务） | ±1e-4 拒绝；最后一帧的收尾提示 | 不自动挑插值类型；不同步补帧；不隐藏其它行 |
| 绑定/解绑（3.4） | [06-ObjectPropertyList](../06-async-objects/06-ObjectPropertyList.md) §3.1；[06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md)；[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) | 行组件 props、`clipKey+path` watch | 切换片段才重建上下文；换行只清本行状态、注销订阅、`:key` 防复用 | 不引节点级全局事件总线；不因换行折叠其它组 |
| 提交/取消（3.5） | [06-PropertyValueForm](../06-async-objects/06-PropertyValueForm.md) §3.2/§3.3；[06-StepNullableAndEnum](../06-async-objects/06-StepNullableAndEnum.md) §3.2/§3.3 | `PropertyValueForm.vue`、`refBindings.ts`、`FieldRenderer.vue`（提案） | `draft/editing`、失败保持编辑态、Esc 丢弃 | 不钳制；不把 null 与 0 混同 |
| 拖动聚合（3.6） | [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.6；[12-08-GeometryTools](../12-templates-flight-tools/12-08-GeometryTools.md) §4.4 | 拖动会话（提案）、`GizmoOverlay.vue`（提案） | 单一提交函数；拖动中不写文档/历史 | 不跨分量建帧；不静默钳制 |
| 可见区与形状（3.7） | [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)；[06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md) | 行帧渲染、局部视口/虚拟化（提案） | 二分定位、step 方块、显式命中；局部秒视口自管 | 不画"无效帧"；不本地求值；不把节点虚拟化留给05 |
| 选择/拖动/粘贴（3.8） | [06-KeyframeEditOps](../06-async-objects/06-KeyframeEditOps.md) §3.2/§3.3/§3.4/§3.6；[06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md) | `copyKeyframes`/`pasteKeyframes`/`moveKeyframes`（已有任务） | 最早帧对齐播放头；冲突全拒；多选限制在效果控件右列 | 不覆盖；不自动吸附跨属性；不在主时间轴多选节点 |
| 分量行/把手（3.9） | [07-PositionEditor](../07-position-path-curves/07-PositionEditor.md) §3.5；[07-CurvePathPreview](../07-position-path-curves/07-CurvePathPreview.md) §3.1/§3.4；[12-09-CurveTools](../12-templates-flight-tools/12-09-CurveTools.md) §4.2/§4.3；[06-EasingAuthoringBake](../06-async-objects/06-EasingAuthoringBake.md) §3.3/§3.4 | 三轴行、路径预览组件、`setEasing`/`bakeSegment`（提案） | 固定轴色、近似提示、元数据把手 | 不写逐帧插值；不把近似当运行时 |

## 六、人工使用检查（跨点）

这些检查只通过人工操作完成，不新增自动化测试、单测或测试工程；也不要求运行 Olive 或游戏来"验证参考实现"。它们用于 WebUI 验收阶段（13）逐条走查。

1. **秒表与模式边界**：对 `mode=value`、`mode=animated`、`mode=event` 各选一个属性，确认只有 `animated` 有可用秒表与菱形；`event` 行打开事件记录编辑区，而不是连续节点列。
2. **关闭动画的原子性**：有帧属性关闭 → 确认 → 帧清空、`value` 写入；一次撤销全部恢复；取消确认不产生历史条目、按钮状态回滚。
3. **独立时间轴**：对 `position.x` 在播放头加帧、删帧、拖动，`position.y/z` 的帧数、值、`mode` 始终不变；任何界面都不出现"已为三轴补帧"。
4. **冲突拒绝**：在已有帧 ±1e-4 内添加/粘贴/拖动 → 拒绝并提示，文档不变；不出现"自动微调到最近可用时间"。
5. **提交与取消**：非法输入、超范围输入、Esc 取消三条路径分别检查：文档不变、错误可见、编辑态符合预期。
6. **拖动粒度**：滑杆拖动、Gizmo 拖动、多帧拖动各做一次长距离拖动；每次只产生一条撤销记录；拖动中保存快捷键不写盘。
7. **粘贴锚点**：复制多帧粘贴到空位置，最早帧落在播放头；粘贴到有冲突位置，整批拒绝；跨类型粘贴被拒。
8. **曲线近似标注**：断开宿主看路径预览，必须看到"仅示意/近似"提示且没有平滑曲线；连接宿主后采样点来自宿主，编辑器不显示"与游戏一致"的断言。
9. **step 与缓动互斥**：`interp=step` 的属性没有缓动入口，时间轴显示方块/台阶；强行通过其它入口设置缓动应被拒绝。
10. **布局与复用**：快速切换 20 个属性、折叠/展开分组、滚动虚拟列表后，行内值、秒表、帧数与路径仍一一对应；无残留输入框、无串行高亮。
11. **多组同屏与职责边界**：同一片段同时展开位置与朝向，选择/点菱形/拖帧/改值后其它组仍可见且左右对齐；主时间轴高度与片段宽度不变、无节点与汇总标记；效果控件局部缩放与主时间轴全局缩放互不重置；两个面板同时停靠时操作互不抢焦点。

## 七、实现状态与局限

**实现状态**

- 本文是**参考研究**，不是实现记录。上述所有"适配步骤"均为待实现的设计指导；截至本文写作，没有任何一项被声明为已完成。
- 我们已有的任务文档（06/07/12）定义了命令表、面板职责、禁止项与验收口径；本文只补充 Olive 观察到的交互结构与事务边界，不新增脚本格式、不新增命令、不改 schema/parser。
- 本文没有修改任何模组、编辑器或参考项目代码；没有运行构建、游戏、Olive、LosslessCut、lint、格式化；没有新增自动化测试/单测/CI；没有切换分支、提交或推送；没有读取 `reports`。
- 本轮按用户截图合同改写了任务映射：旧 06-PropertyKeyframePanel（单属性独占面板）与 06-TimelineObjectRows（主时间轴对象行）不再作为落点，改由 06-ClipEffectControlsPanel / 06-EffectControlsRows 承载；Olive 源码符号与行号仍是原样证据，没有据此改写参考软件的行为。

**证据局限**

- 所有行号来自本地快照 `example/editor/olive`，不是上游最新提交；上游后续重构可能使行号漂移，符号名与设计意图更可靠。
- 只读了与"属性级关键帧交互"直接相关的文件与函数段，没有通读 Olive 的撤销栈、序列化、时间线缩放等基础设施；因此本文不评价其整体架构，也不把局部写法外推为全局结论。
- 未运行 Olive，因此"按钮点击后的实际观感、拖动性能、跨平台差异"没有实测；文中对行为的描述来自源码控制流，不是运行观察。
- 未验证 Olive 的 GPLv3 与我们的分发方式是否兼容；本文只做思路借鉴与独立实现指导，不复用代码或图标资产，也不给出法律结论。
- `CurveView` 的曲线绘制是 Olive 自己的显示逻辑；我们只借鉴"分行、着色、选中范围、把手约束、单次提交"这些交互结构，不借鉴其求值结果作为运行时真值。
- Olive的NodeKeyframe含time/value/type/track/element/bezier_control_*等字段；本项目标准节点只有time/value，作者段缓动留在属性所属AnimObject.authoring，不写入节点或运行时脚本。任意帧类型/把手都不是可凭参考新增的字段，必须服从真实schema。
