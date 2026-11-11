# 05-04 主时间轴视图（渲染 / 轨道头 / 片段块 / 指针交互）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：05-03；同轮：05-05、05-06、05-07。
> 界面合同：[片段效果控件工作区](../shared/effect-controls-workspace.md) §3.1/§4.2。

## 1. 职责

替换 `Timeline.vue`：渲染标尺、轨道行、片段块与转场重叠区；把指针/滚轮/键盘事件翻译成 `05-03` 的片段 `DragIntent` 或片段级选区变更。它不计算时间、不写文档，也**不渲染属性**。

本文件只负责**主时间轴**：轨道与片段编排、全局标尺/播放头（几何由 05-06 提供）。以下内容不在主时间轴出现，也不在本文件实现：

- 对象/属性行、属性组展开、节点菱形、关键帧汇总标记或曲线；
- 片段块左右「轴外槽」、超窗口节点的半透明显示；
- 加帧/删帧菜单、节点命中、节点拖动、节点框选、节点快捷键。

这些全部归 `clip.effects` 片段效果控件（06-ClipEffectControlsPanel / 06-EffectControlsRows），主轴只提供片段级上下文。选中一个 100+ 属性的片段，主轴仍是同样的一行片段块，轨道高度不变。

**参考输入**：[Olive时间轴与命令](../references/01-olive-timeline-commands.md)的幽灵拖动、手柄命中和选择反馈。视图只维护临时交互/显示，不在mousemove直接写文档；松手交给05-05一次提交，Esc/失焦/指针取消清预览，选择仍走02身份。参考Qt场景和媒体区间选择不是本项目数据模型。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/Timeline.vue:574–835` | 模板：工具栏（577–625）、统一滚动容器（627–631）、轨道头列（626–690）、画布（692–790）、右键菜单（792–834） |
| `EDITOR:src/components/Timeline.vue:626–690` | 轨道头：类型/ID、显隐/锁定/静音三按钮（`eye-opened.svg`/`lock-opened.svg`/`listview.svg`）、`+` 添加片段、添加轨道下拉（含 6 类） |
| `EDITOR:src/components/Timeline.vue:734–770` | 片段块：绝对定位 + 关键帧菱形（`kf.time / clip.duration` 百分比定位）+ 左右 resize 手柄；**菱形随本任务退役** |
| `EDITOR:src/components/Timeline.vue:338–382` | `onKeyframeMouseDown` / `onKeyframeDrag`（直接 `commit` + `ops.moveKeyframe`）；**整段退役，不在主轴保留替代实现** |
| `EDITOR:src/components/Timeline.vue:836–1247` | 样式：工具栏 34px、轨道行 52px、clip 40px、关键帧 8px 菱形、右键菜单 |
| `EDITOR:src/components/Timeline.vue:268–336` | `onClipMouseDown`：razor 分支、选中、8px 边缘判定、移动 |
| `EDITOR:src/components/Timeline.vue:396–424` | `onContentMouseDown`：空白处也进入 ruler 拖动并清选区 |
| `EDITOR:src/components/Timeline.vue:499–506` | `onWheel`：仅 Ctrl+滚轮缩放，5–500 |
| `EDITOR:src/components/Timeline.vue:514–530` | 播放中播放头自动跟随滚动 |
| `EDITOR:src/components/Timeline.vue:160–198` | 轨道颜色/标签写死（6 类；缺 ADJUST） |
| `MOD:docs/SCRIPT_FORMAT.md:145–149` | 七类内置轨道含 `ADJUST` |
| `EDITOR:plan/shared/effect-controls-workspace.md` §3.1 | 主时间轴明确不负责属性行、动画节点、节点增删移动、属性曲线、节点汇总标记 |

## 3. 拟新建（提案）

| 文件 | 组件/导出 | 职责 |
|---|---|---|
| `EDITOR:src/timeline/TimelineView.vue` | 组件 | 外层：滚动容器、工具栏、视口裁剪；只容纳轨道行与片段块 |
| `EDITOR:src/timeline/TrackHeaderColumn.vue` | 组件 | 轨道头（吸左），键盘可操作 |
| `EDITOR:src/timeline/TrackRow.vue` | 组件 | 一条轨道：片段层（只有片段块，无对象层） |
| `EDITOR:src/timeline/ClipBlock.vue` | 组件 | 片段块：名称、循环角标、无限斜纹、转场重叠区（只显示，归 08 编辑）；**不画关键帧** |
| `EDITOR:src/timeline/ClipEdgeHandle.vue` | 组件 | 片段左右裁切手柄（命中与样式独立于节点） |
| `EDITOR:src/timeline/TimelineToolbar.vue` | 组件 | 工具（选择/刀片）、缩放、吸附、顺排、时间显示 |
| `EDITOR:src/timeline/TimelineContextMenu.vue` | 组件 | 片段/轨道空白/标尺三类菜单；不注册任何节点项 |
| `EDITOR:src/timeline/trackMeta.ts` | `TRACK_META` | 七轨的类型名/颜色/图标/是否可静音/是否可独奏（来自 schema 能力，不写死） |

**不新建** `ObjectRow.vue`、`NodeMarker.vue` 或任何主轴节点组件。原提案中的这两个文件由 `06-EffectControlsRows` 在效果控件内承担；主轴侧删除后不留别名或空壳。

## 4. 输入 / 输出 / 字段约束

输入05-03的**主时间轴**标尺/显示范围/片段行布局、标准文档只读视图的片段级信息、02共享Selection与工具/吸附/轨道显隐锁定状态。效果控件局部视口与行布局不在输入内。

**输出（事件，不直接改文档）**

| 事件 | 载荷 | 下游 |
|---|---|---|
| select | 02 Selection（片段级）+ additive | 发意图至共享会话，不定义SelectionRef |
| `drag-intent` | 片段 `DragIntent`（移动/裁切，拖动中每帧） | `05-05` 转命令 |
| `seek` | `time` | 05-06 |
| context-menu | 屏幕位置 + 片段级 02 Selection定位 | 菜单组件，不复制选区状态 |
| `toggle-track` | `{trackId, flag}` | UI 状态（显隐/锁定/静音） |
| `reorder-track` | `{trackId, toIndex}` | 02 命令 |

**渲染约束**

| 项 | 约束 |
|---|---|
| 行高 | 轨道行 52px（紧凑档 34px）；**只有轨道行，没有对象行/组头** |
| 轨道高度 | 由轨道类型与紧凑档决定，与片段属性数量、展开状态无关；片段有 100+ 属性时高度不变 |
| 片段块 | 最小宽 24px；宽度 < 40px 时不画标签，宽度 < 60px 不画时间；`duration<0` 用斜纹 |
| 节点 | **主轴不渲染任何属性节点、菱形、台阶标记或汇总点**；块内也不显示属性数量徽标 |
| 轴外 | 主轴没有轴外槽；超出片段窗口的节点只在 `clip.effects` 中显示与编辑 |
| 视口裁剪 | 只渲染可视时间窗 ±1 屏的片段块；轨道纵向虚拟化按轨道数量，不按属性行 |
| 颜色 | 来自 `shared/art-direction.md` 的 token；ADJUST 必须有独立色相，不能与 CAMERA 撞色 |
| 空态 | 无轨道 → 「还没有轨道」+ 添加轨道；有轨道无片段 → 行内虚线槽 + 「双击添加片段」 |

**交互约束**

- 左键空白：拖动播放头（沿用旧版 `onContentMouseDown` 语义），但**不清选区**；清选区改为 `Esc` 或点击标尺外区域（避免误清）。
- 左键片段：选中并进入移动/裁切拖动；片段框选只产生片段集合，绝不产生属性节点选择。
- 右键：片段 → 复制/剪切/粘贴/复制片段/分割/删除；轨道空白 → 在此添加片段；标尺 → 循环入/出/清除/缩放到全部。**没有「添加节点」「删除节点」「展开对象」等项**。
- 刀片工具：左键点片段即分割，不进入拖拽；`Esc` 或切回选择工具退出。
- 拖拽期间禁止触发 `seek`（避免边拖片段边跳播放头）。
- 锁定轨道：可选择、不可拖拽/裁切/分割/删除；视觉上降饱和 + 锁图标常亮。
- 键盘等价见 `05-10`：主轴作用域只有片段操作；节点操作只在 `effectControls` 作用域，不进入本组件。

## 5. 修改步骤

1. 新建 `trackMeta.ts`：从 01 的 schema 快照取轨道类型列表（含 `ADJUST` 与未来第三方轨道），生成颜色/标签/能力；删除 `Timeline.vue:160–198` 的写死 switch。
2. 新建 `TimelineView.vue`，搬移滚动容器与工具栏（`Timeline.vue:627–631,577–625`）；把 `onWheel`（499–506）改成「滚轮=平移，Ctrl+滚轮=缩放，Shift+滚轮=横向」。
3. 新建 `TrackHeaderColumn.vue`：轨道头改为键盘可达（Tab 进列，上下键换行，`Space` 切显隐，`L` 锁，`M` 静音）；添加轨道下拉补 `ADJUST`。
4. 新建 `TrackRow.vue` / `ClipBlock.vue` / `ClipEdgeHandle.vue`：片段块只画片段信息；转场重叠区画半透明带并标注「转场 t」（编辑入口在 08，不在本轮）。**删除片段块上的关键帧菱形、按 `kf.time / clip.duration` 的百分比定位、以及轴外槽。**
5. 删除 `onKeyframeMouseDown` / `onKeyframeDrag`（`Timeline.vue:338–382`）与任何节点命中分支；节点几何/命中/拖动/框选全部由 06 的 `06-EffectControlsRows` 实现，主轴不保留 fallback 或“以后再加”的隐藏入口。
6. 指针事件统一进 `hitTest`（`05-03`），删除组件内的 `getBoundingClientRect` 逐处换算（保留一个 `viewportRect` 缓存）。
7. 删除 `Timeline.vue` 文件与 `App.vue:12` 的 import；`05-01` 的挂载点指向 `TimelineView.vue`。
8. 旧右键菜单（792–834）迁到 `TimelineContextMenu.vue`，删除全部节点菜单项；菜单项禁用条件接 02 的 `canUndo` 与 05-05 的可用性。

## 6. 禁止修改

- 不在组件内 `commit()` 或调用 `operations.ts`（命令全走 05-05）。
- 不实现属性值编辑、节点增删移动、曲线、路径、转场参数、规则绑定。
- 不在主时间轴恢复“可选关键帧模式”、对象行、轴外槽或节点汇总标记。
- 不改 `objects` 的键集合；主轴根本不读取 `objects` 的叶子结构。
- 不用 canvas 整体绘制时间轴（命中测试、文本、无障碍都要自己写；当前规模不值得）。
- 不引入虚拟滚动库；自写最小窗口化。

## 7. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | 指针事件 + hover tooltip；`position: sticky` 轨道头；片段 hover 显示起止时间 |
| 游戏内 Forge/AUI | 无 hover（触控/手柄）→ 选中即显示 tooltip；sticky 支持未实证 → 用双容器同步 `scrollTop` 的兜底；片段边缘命中区放大到 20×20；`cursor` 样式不可依赖，用形状/颜色表达可拖拽。节点命中区与节点交互属效果控件（06），不在主轴放宽 |

## 8. 前置

05-03 的模型模块；01 的轨道能力快照；02 的文档只读视图与命令；05-07 提供片段级 Selection 上下文（效果控件侧消费属性/节点定位）。

## 9. 验收

**正例**

1. 一条 CAMERA 轨道含 3 个片段、其中一个片段有 100+ 属性：三个片段块都保持同一轨道高度，块内没有对象行、属性节点、菱形或汇总点，也没有「展开对象」入口。
2. 文档里 `position.x` 与 `yaw` 在同一时刻各有节点：主时间轴不显示这两个节点；片段块外观与节点数量无关。属性/节点的同时显示由效果控件验收。
3. `ADJUST` 轨道颜色与 CAMERA 明显不同；轨道头显示「调色」。
4. 刀片工具在片段中部点击 → 分割；在片段端点 2px 内点击 → 不分割并提示。
5. 锁定轨道拖拽无反应，且光标/样式表明锁定。
6. 片段框选只选中片段；框选区域内的属性节点不属于主轴命中结果。
7. 无限片段显示斜纹 + `∞`，宽度到可视末端；主轴不因无限片段写死长度。

**反例**

1. 用 `clip.keyframes` 在片段块上渲染菱形、节点或轴外槽 → 不通过。
2. 组件里直接改文档 → 不通过。
3. 选中片段后展开对象行 / 属性组，或轨道高度随属性数量变化 → 不通过。
4. 右键菜单出现「添加节点」或节点快捷键在主轴生效 → 不通过。
5. 轨道类型写死 6 类、ADJUST 落 default 灰 → 不通过。

**真实冒烟**：WebUI 打开真实相机脚本（含 `paths` 与多属性对象），确认片段块与轨道高度稳定、主轴无任何关键帧点（本轮出口）；游戏内 Forge 1280×720 下的键盘/片段验证属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- `Timeline.vue` 删除，调用方全部指向 `TimelineView.vue`。
- 组件树里没有 `commit`/`operations` 调用；事件流单向。
- 主轴代码中不存在 `ObjectRow`、`NodeMarker`、关键帧菱形、轴外槽、节点命中/拖动/框选或节点菜单项；这些概念只在 06 出现。
- 七轨 + 第三方轨道的能力来自 schema，不写死。
- 100+ 属性片段不改变轨道高度，主轴无任何关键帧点（可复现记录）。
