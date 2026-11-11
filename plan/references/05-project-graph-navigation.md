# 05 Olive 项目浏览与节点画布：关系图入口的适配依据

## 一、摘要

研究本地 Olive 的项目浏览与节点画布，只借鉴交互分工、坐标、手势事务和状态恢复。Olive 节点图描述计算连接，本项目图描述脚本触发前置关系；两者不是同一语义。这里不引入通用节点编辑器、不恢复左侧常驻脚本树、不改变标准脚本格式，也不新增一轮实施工作。

来源根 `OLIVE` 为主模组 `example/editor/olive`；目标 `EDITOR` 为独立编辑器仓库。下文 Olive 类/函数是已有来源，我们的 `GraphShell`、`FolderLane`、`GraphDependencyMutationController` 等是既有计划中的提案，不代表已经实现。

## 二、为什么做

项目入口必须同时支持“找脚本、看真实触发链、维护文件夹和受控依赖”，而不是在画布上编辑片段。最容易混淆的是：拖动位置与移动文件、画一条线与改一条 requires、选中卡片与打开文档。目标是这些行为各有命令、身份和失败反馈，作者不会因整理画布意外改动脚本。

## 三、方案

- 文件夹泳道与脚本卡片仍是唯一项目入口；不添加另一棵常驻资源树。
- 卡片选择、打开、拖动布局、菜单移动文件夹、受控依赖表单彼此分开。保留既有单击选中/双击打开、打开按钮和键盘 Enter 的合同，不因参考软件改变手势。
- 移动中更新卡片与连线的显示；松手才提交一次布局命令；取消恢复原位置。布局操作不得触发脚本保存。
- 文件移动与依赖维护交给真实宿主事务。Qt 场景内存中的成功，不等于磁盘脚本或游戏触发关系已经修改。

## 四、技术细节

### 4.1 已读证据索引

行号对应本地快照；实施前按符号重读，不声称是上游最新实现。

| 来源文件 | 实际符号及范围 | 本文使用的证据 |
|---|---|---|
| [projectexplorer.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/projectexplorer/projectexplorer.cpp) | `ProjectExplorer::ItemDoubleClickedSlot` 264–276、`DirUpSlot` 285–294、`SetSearchFilter` 304–307 | 文件夹导航、条目打开信号、过滤职责 |
| [projectviewmodel.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/projectexplorer/projectviewmodel.cpp) | `ProjectViewModel::mimeData` 281–322、`dropMimeData` 324–419、`ItemIsParentOfChild` 442–454 | 条目去重、目标检查、一次移动命令与父子环保护 |
| [handmovableview.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/handmovableview/handmovableview.cpp) | `ApplicationToolChanged` 40–51、`HandPress/HandMove/HandRelease` 53–140、`wheelEvent` 167–233 | 手形平移优先、手势结束恢复 |
| [nodeview.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/nodeview/nodeview.cpp) | `NodeView::Select` 187–219、`mousePressEvent` 434–531、`mouseMoveEvent` 533–550、`mouseReleaseEvent` 552–597 | 选区反馈隔离、布局拖动快照及聚合提交；同时提供自由连线的反例 |
| 同上 | `CenterOnNode` 910–918、`ZoomIntoCursorPosition` 1177–1194、`ZoomFromKeyboard` 1224–1234 | 定位与指针锚定缩放的实际实现 |
| [nodeviewitem.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/nodeview/nodeviewitem.cpp) | `GetNodePosition/SetNodePosition` 104–120、`itemChange/ReadjustAllEdges/UpdateContextRect` 462–505 | 逻辑位置与画面位置分开、位置变化刷新连线与容器 |
| [nodeviewedge.cpp](../../../ImmersiveCinematics/example/editor/olive/app/widget/nodeview/nodeviewedge.cpp) | `NodeViewEdge::paint/Init` 137–175 | 边的选中/禁用样式与位于节点后层 |

特别注意：`HandMovableView::ZoomIntoCursorPosition`（235–240）基类实现为空；真正的节点画布缩放在上表 `NodeView` 重写中，不能把基类接口当作现成功能。

### 4.2 八个可落实的借鉴点

#### G1 浏览组织与打开文档分工

**来源写法**：`ItemDoubleClickedSlot` 先识别文件夹、在列表/图标模式下导航，再发 `DoubleClickedItem`；`SetSearchFilter` 只改代理模型过滤，`DirUpSlot` 只改浏览根。解决的是同一浏览界面中“进入容器”与“打开内容”的职责分离。

**适配**：由已有计划 `GraphShell` 管搜索/过滤，`FolderLane` 管分类容器，`NodeCard/NodeTooltip` 只发选择/打开意图，实际开文档交给 `openDocument`/顶层未保存守卫。过滤不改变 `meta.id`、真实目录、requires 或节点持久化身份。

**不能照搬**：不搬 Olive 图标/树/列表三模式与素材栏；不让双击文件夹打开脚本文档；不以搜索后可见条目的顺序作为身份。

**人工检查**：在有多个文件夹和同名脚本的项目搜索，选中后清过滤，节点身份不变；打开一个脚本再返回，过滤/视口保留。未保存文档取消切换时仍留在原文档。

**落点**：[04.03 图外壳](../04-project-graph/03-graph-view-shell.md)、[04.04 文件夹](../04-project-graph/04-folder-partitions.md)、[04.06 卡片](../04-project-graph/06-node-card-hover-open.md)、[05 图入口](../05-timeline-workspace/05-09-GraphEntry.md)。

#### G2 手形平移先于节点编辑，取消必须完整收尾

**来源写法**：`HandPress/Move/Release` 把中键映射为手形拖动并临时关闭场景交互；`NodeView::mousePressEvent/mouseMoveEvent/mouseReleaseEvent` 首先让 Hand 系列处理。解决平移与选中/拖节点争抢同一个指针的问题。

**适配**：项目画布明确当前手势归属，按现有中键/空白平移合同处理；节点布局拖动、文件夹移动意图、依赖表单互斥。取消、失焦、指针取消和卸载都恢复起始状态并释放指针捕获，不发持久化命令。面板停靠拖动只能从面板标题开始，不抢图节点手势。

**不能照搬**：不搬 Qt 合成鼠标事件、不移动操作系统指针、不把中键平移写成脚本编辑历史。

**人工检查**：缩放后在卡片上中键平移，卡片相对世界位置不变；开始布局拖动后按 Esc/切出窗口，原位恢复且没有文件写入。

**落点**：[04.03](../04-project-graph/03-graph-view-shell.md)、[04.05 布局](../04-project-graph/05-layout-engine-and-persistence.md)、[05 停靠](../05-timeline-workspace/22-DockLayoutController.md)。

#### G3 保存逻辑坐标，缩放围绕鼠标下的同一点

**来源写法**：`GetNodePosition` 经坐标转换取得逻辑位置；`SetNodePosition` 缓存逻辑坐标再刷新画面。`NodeView::ZoomIntoCursorPosition` 用旧缩放和滚动位置计算新锚点；键盘缩放在指针不在视图内时取中心。

**适配**：沿用现有 `graphLayout.ts` 自动布局与世界坐标合同，不再新造坐标系统。节点拖动先把屏幕增量换成世界增量；布局保存世界 x/y，视口 tx/ty/scale 单独存；DPI 与组件缩放不能叠进节点坐标。重算布局后只覆盖合法的手摆位置。

**不能照搬**：Qt 滚动条单位、缩放下限、整数取整都不是本项目合同；保留计划已有 0.15–2.5 缩放范围。不要把基类空缩放函数当证据。

**人工检查**：在不同缩放下将节点拖到同一世界参考点；滚轮缩放前后鼠标下的点不跳；重开保留位置，脚本内容未因布局改变。

**落点**：[04.03](../04-project-graph/03-graph-view-shell.md)、[04.05](../04-project-graph/05-layout-engine-and-persistence.md)。

#### G4 拖动从按下快照到松手只提交一次

**来源写法**：`mousePressEvent` 523–530 记录所选节点起始位置；`mouseReleaseEvent` 577–585 比较位置，只为实际移动的节点加入 `NodeSetPositionCommand`，然后一次 push 组合命令。解决连续鼠标事件把历史塞满的问题。

**适配**：布局拖动保留起始位置和临时位置，显示预览不修改标准脚本文档；松手经坐标/范围检查，提交一次布局事务，再按布局存储合同保存。取消与零位移不产生历史。布局撤销与脚本内容撤销的命令域必须明确，不因同一个 Ctrl+Z 错改文件。

**不能照搬**：不复用 Olive 的计算节点命令作为脚本命令；不照搬一次鼠标释放就无条件创建空命令的写法；不为本参考强加多节点布局新功能。

**人工检查**：连续拖动同一卡片数秒，撤销一次恢复起点；原地按下松开、Esc 取消均没有新历史或布局保存请求。

**落点**：[04.05](../04-project-graph/05-layout-engine-and-persistence.md)；共用 [C04 命令合同](../shared/contracts.md)，不另建第二套脚本历史。

#### G5 文件移动需要明确目标和稳定条目标识

**来源写法**：`mimeData` 295–315 对多列索引去重；`dropMimeData` 先检查格式/目标必须为 Folder，跳过自己、原父目录，以及文件夹移入后代的情况；把所有有效移动聚合为一个命令。`ItemIsParentOfChild` 沿父链检测。

**适配**：脚本移动使用稳定相对路径与文件指纹、目标目录，不能把卡片视觉 y 坐标当目录名。普通拖卡片只改布局；“移动到…”菜单或明确进入的文件移动手势才交给文件事务。目录规则在受控宿主端校验：根目录保护、深度、越界、目标存在、同名冲突；成功后更新路径索引与布局重绑定，`meta.id` 与 requires 不改。

**不能照搬**：Qt 拖放负载序列化的是进程内指针，不可跨进程传输或落盘。内存撤销栈不能提供真实文件操作的原子性。目录重命名/删除仍依04合同，不因参考实现加入用户未要求的目录任意搬运功能。

**人工检查**：布局拖到另一泳道上不应无提示移动文件；明确移动到空文件夹成功且id不变；同目录移动无操作；同名目标/断连失败后原路径仍可用，图不显示假成功。

**落点**：[04.04](../04-project-graph/04-folder-partitions.md)、[04.08 路径与身份事务](../04-project-graph/08-move-rename-transaction.md)。

#### G6 位置变化刷新相连边，不刷新依赖语义

**来源写法**：`NodeViewItem::itemChange` 在位置变更时调用 `ReadjustAllEdges` 和 `UpdateContextRect`；边在节点后层绘制，并按选中/禁用状态取色。解决卡片移动后线仍留在旧位置及容器范围失配的问题。

**适配**：布局预览改变节点几何后同步刷新连线端点、画布包围盒与折叠泳道的吸附端点；依赖方向、来源触发器身份和层次仍取图数据。色彩使用本项目语义token，并配箭头/线型/文字，不能只靠颜色区分。

**不能照搬**：Olive 输入输出端口是计算连接；本项目边是 requires 投影。同一对脚本可以有多条来源不同的依赖，不能因画在一条线上就合并删除。

**人工检查**：拖动节点时所有入出边贴合；折叠文件夹时边指向折叠条；展开、撤销后边和卡片一致，requires原文不变。

**落点**：[04.04](../04-project-graph/04-folder-partitions.md)、[04.05](../04-project-graph/05-layout-engine-and-persistence.md)、[04.07 边语义](../04-project-graph/07-dependency-edge-semantics.md)。

#### G7 跨面板选区反馈不应循环触发重载

**来源写法**：`NodeView::Select` 暂停 selection 信号，批量更新选择，再用 `dont_emit_selection_signals_` 避免收到其他控件选择后再次反向广播；可排队居中到节点。

**适配**：图选择只更新项目UI状态；打开文档是单独命令；从诊断/依赖定位卡片时先确认目标仍在当前图，再更新选区和视口。返回图时按真实路径重新验证选择，节点已消失则清除，不用列表下标选中旁边脚本。不要为了回显而重新load脚本、seek或push。若定位目标是脚本内的属性叶子或节点，打开文档后由 `clip.effects` 定位到 `clipKey + objectPath`（或节点时间），快捷属性显示摘要；定位逻辑归 [06-ObjectDiagnostics](../06-async-objects/06-ObjectDiagnostics.md)，主时间轴不展开对象行、不显示节点，也不因导航自动重建另一份选择。

**不能照搬**：不用屏蔽全部响应式更新掩盖循环，不搬Qt全局信号开关；明确事件来源和命令边界即可。图选区与文档片段选区不是一个selectedIndex。

**人工检查**：从依赖/诊断定位卡片再返回，不反复跳页或重载文档；文件被外部移走后刷新，失效选区清空且无幽灵高亮；定位到某属性节点时，打开的是该片段的效果控件对应行，主时间轴仍只有片段、没有对象行或节点标记。

**落点**：[04.03](../04-project-graph/03-graph-view-shell.md)、[04.06](../04-project-graph/06-node-card-hover-open.md)、[05-09 图入口](../05-timeline-workspace/05-09-GraphEntry.md)、[06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md)、[02 选择身份](../02-model-contracts/02-SelectionIdentity.md)。

#### G8 自由连线只能借手势，不能借写入含义

**来源写法**：`NodeView::mousePressEvent` 448–500 从节点/连接器开始建线，可能直接重拖已有边；`mouseReleaseEvent` 调 `EndEdgeDrag`。这是计算节点编辑器的连接操作，不是脚本触发链维护。

**适配**：04已有计划的 `GraphDependencyMutationController/DependencyMaintenanceDialog` 承担唯一受控依赖写合同。节点/边菜单或可选拖线只打开同一表单，明确依赖方、已有触发器、requires具体条目、目标脚本和前置类型；展示差异与真实校验，受控服务成功写回才刷新。不能按一对节点删除所有平行依赖。

**不能照搬**：不在指针落下时直接增删requires；不自动创建触发器；不把环一律判非法；未知扩展/组合派生关系只读保留并说明原因。参考不取消本轮必须交付的受控维护，也不把它推给11轮。

**人工检查**：两脚本间有两条不同触发器来源，修改/删除其中一条只影响该条；取消表单、文件外部变更、重复id或断连均不改文件、不假画边。

**落点**：[04.11 受控维护](../04-project-graph/11-GraphDependencyMutationController.md)、[04.07](../04-project-graph/07-dependency-edge-semantics.md)。

### 4.3 到现有类任务的接入方式

以上是现有任务的研究输入，不生成新类群或新轮次：04.03采用G1–G3/G7，04.04采用G1/G5/G6，04.05采用G2–G4/G6，04.06采用G1/G7，04.08采用G5，04.11采用G8；05-09 图入口采用 G7 的"定位到片段/属性叶子时进入效果控件"，不把节点展开塞进主时间轴。合同仍以共享C03/C04/C07、04各任务和标准parser/schema为准。

## 五、为什么不选别的

| 不采用项 | 原因与替代 |
|---|---|
| 完整搬Olive项目资源树 | 用户已取消常驻脚本栏；用文件夹泳道与图搜索 |
| Qt场景/计算节点模型直接移植 | 技术承载和依赖含义都不同；独立实现既有图合同 |
| 拖过泳道就同时移动文件 | 整理布局可能意外改磁盘；显式文件移动意图 |
| 画线即写requires | 无法确定触发器与条目；受控表单+真实校验 |
| 编辑器重算触发真值 | 运行事实由主模组提供；图只作可靠投影 |
| 移植参考播放器/渲染链 | 本项目只接游戏真实画面，与关系入口无关 |
| 定位到属性/节点时展开主时间轴对象行 | 主时间轴只编排片段；参数与节点进入 `clip.effects`，快捷属性显示摘要 |

代价是布局、文件、身份与依赖需要不同命令及失败反馈；这比一次“万能拖拽”多一些步骤，但避免作者整理项目时误改叙事逻辑。

## 六、实现结果与局限

状态：**未实现**。本页完成的是本地源码研究与到既有任务的适配指导，不是关系图实现结果。未运行Olive、编辑器或游戏，未执行构建/测试，人工检查均为未来操作清单，不预填通过。

Olive根LICENSE为GPLv3文本，已读文件头存在GPL-3.0-or-later声明；只研究交互与职责思想，不复制或逐句翻译代码、图标、样式资产，不在本页给出许可兼容定论。实际代码/资源复用须单独核对对应文件许可与交付方式。
