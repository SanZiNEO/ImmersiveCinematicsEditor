# 05-03 时间轴模型（几何 / 显示范围 / 吸附 / 选区）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：02（文档与身份）；同轮：05-04（消费本文件）、05-07（消费选区）。

## 1. 职责

把像素/秒换算、标尺、显示范围、吸附、片段命中与拖动意图计算从组件分离，便于明确职责；不建设单测，人工在时间轴实际缩放/拖动/吸附/撤销检查行为。

本文件只服务**主时间轴**：全局秒、片段级几何与片段级选择。主轴的 `viewport`（`pxPerSecond`/`scrollLeft`/可视窗口）归主轴自己；片段效果控件的局部秒视口、行命中与纵向虚拟化归 06（`06-EffectControlsRows`），两者可以复用纯换算函数，但**不共享一份可变 scale/scroll 状态**。主轴模型里没有对象行、属性节点、轴外槽或节点拖动的数据结构。

**参考输入**：[Olive时间轴与命令](../references/01-olive-timeline-commands.md)的坐标、像素阈值吸附、命中、显示范围和缩放锚定。保留十进制秒、稳定片段身份和无限窗口，不搬rational帧网格。resolveSnap保持单点时间结果，dragSession统一导出整体deltaSec，不能替代编辑冲突检查。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/Timeline.vue:129–158` | `tracks` / `totalDuration` / `canvasDuration`（`max(total*1.5+5, 30)`）/ `contentWidth` / `rulerMarks` 全在组件内 |
| `EDITOR:src/components/Timeline.vue:160–215` | `trackColor` / `trackLabel` / `clipLabel`（写死中文与颜色） |
| `EDITOR:src/components/Timeline.vue:200–215` | `timeToPx` / `pxToTime` / `getMouseTime`（读 `contentRef` 的 `getBoundingClientRect`） |
| `EDITOR:src/components/Timeline.vue:426–443` | `snapTime(t, clip)`：候选点 = `0`、播放头、所有 clip 起止；阈值固定 8px |
| `EDITOR:src/components/Timeline.vue:217–222` | `DragMode` 六值：`playhead/ruler/clip-move/clip-resize-l/clip-resize-r/keyframe`；`keyframe` 随主轴节点渲染一起退役 |
| `EDITOR:src/store.ts:81–84` | `pxPerSecond=40`、`timelineTool='select'`、`snapEnabled=true`、`snapInterval=0.5` |
| `EDITOR:src/store.ts:836–857` | `zoomIn/zoomOut/setZoom/setTool/toggleSnap`（5–500 px/s） |
| `EDITOR:src/store.ts:874–899` | `selectClipMulti` / `selectAllClips`（下标集合） |
| `EDITOR:src/operations.ts:610–620` | `recalcDuration`：取所有 clip 末端最大值，最小 1 秒 |
| `EDITOR:src/operations.ts:55–70` | `applyTransitionAlignment`：B 模型转场对齐（转场归 08，但时间轴必须能显示重叠区） |
| `MOD:docs/SCRIPT_FORMAT.md:14–19` | 无 `total_duration`；末端取 `start_time+duration` 最大值；无限片段/无限宏观循环 → 内容无限 |
| `MOD:docs/SCRIPT_FORMAT.md:94–105` | 片段键：`start_time/duration/objects/loop/loop_count/loop_mode/id/exit`；`duration<0` = 无限单次 |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/timeline/scale.ts` | `TimelineScale`、`timeToPx`、`pxToTime`、`rulerTicks(scale, width)` | 纯函数；刻度间隔按 px/s 选档 |
| `EDITOR:src/timeline/displayRange.ts` | `deriveDisplayRange(doc)` | 有限末端、无限标记、可视窗口 |
| `EDITOR:src/timeline/snapping.ts` | `collectSnapTargets(doc, ui)`、`resolveSnap(rawTime, targets, thresholdPx, scale)` | 吸附；阈值用 px 而非秒 |
| `EDITOR:src/timeline/selection.ts` | 02 Selection的命中/导航适配，调用repairSelection | 不重新定义选择形状，不持有第二份会话选择；主轴只处理片段级命中 |
| `EDITOR:src/timeline/hitTest.ts` | `hitTest(rows, x, y)` | 命中片段/边缘手柄/轨道头；**不返回属性节点** |
| `EDITOR:src/timeline/dragSession.ts` | `beginDrag/updateDrag/endDrag` | 片段拖动会话状态机，输出「意图」而非直接改文档 |

## 4. 输入 / 输出 / 字段约束

**输入**：02 的文档只读视图（`tracks[]`、`clips[]` 的片段级字段；**不读取** `objects` 叶子或节点时间）、UI 状态（`pxPerSecond`、`scrollLeft`、`snapEnabled`、播放头、标记、循环点）、指针事件坐标。

**输出**

- `TimelineScale`：`{ pxPerSecond, originPx, viewportWidth }`，`timeToPx(t) = (t - originSec) * pxPerSecond`；这是**主轴的全局视口**，效果控件的局部视口不得复用这个可变对象。
- `DisplayRange`：`{ finiteEnd: number | null, infinite: boolean, displayEnd: number, tailPadPx: number }`。
- `SnapTargets`：`{ time, kind: 'clip-start'|'clip-end'|'playhead'|'marker'|'loop'|'grid', id? }[]`；属性节点不是主轴吸附目标。
- DragIntent包含片段操作种类、02共享Selection的片段定位、deltaSec和吸附目标；预览不改变文档，最终命令返回选择映射。不产生节点拖动意图。

**字段约束**

| 规则 | 内容 |
|---|---|
| 时间单位 | 主轴全部为**全局秒**（float）；片段局部秒只在效果控件内部使用，`global = start_time + local` 的换算点在 06，主轴不承担 |
| 显示范围 | `finiteEnd = max(clip.start_time + max(duration,0))`；任一 `duration<0` 或 `meta.macro_loop_count<0` → `infinite=true`，`displayEnd = max(finiteEnd, 当前视口末端)`，并至少留 30s 可滚动余量 |
| 无限片段 | 宽度 = `displayEnd - start_time`，角标 `∞`；**不写** `Infinity`/`null` 到文档 |
| 刻度 | px/s < 15 → 10s；< 30 → 5s；< 80 → 1s；< 200 → 0.5s；否则 0.1s（沿用 `Timeline.vue:135–158` 的分档，但抽成函数） |
| 吸附阈值 | 8 CSS px 换算成秒（`8 / pxPerSecond`），不是固定 0.5s |
| 吸附优先级 | 先取阈值内最近目标，仅同距时按片段边界 > 播放头 > 标记 > 循环点 > 栅格裁决；多选由dragSession取一个共同位移，不逐项独立吸附。属性节点不参与主轴吸附 |
| 选区 | 见 README §4.3；禁止下标；主轴只处理片段级命中与批选 |
| 多选 | 框选只选片段；属性/节点多选不由主轴发起，归 06 的效果控件，并复用 02 同一会话 |
| 排序 | 片段按 `start_time` 升序；同起点按 `id` 字典序稳定排序（不依赖数组原序） |
| 视口 | 主轴的 `TimelineScale` 是全局视口唯一实例；效果控件局部视口另存（06），只允许复用 `timeToPx/pxToTime` 纯函数，禁止共享 `pxPerSecond`/`scrollLeft`/缩放锚点 |

## 5. 修改步骤

1. 新建 `scale.ts`，把 `timeToPx/pxToTime/rulerMarks` 从 `Timeline.vue:135–158,200–215` 迁出；刻度函数返回 `{time,label,major}`，不再返回 VNode。
2. 新建 `displayRange.ts`，删除 `canvasDuration`（`Timeline.vue:130`）；`recalcDuration` 不再被时间轴调用（`store.ts:142–157` 的 `maintainInvariants` 里移除该调用，改由 02 的文档派生）。
3. 新建 `snapping.ts`：候选点来自文档 + UI（播放头/标记/循环点）+ 栅格（`snapInterval`），阈值用 px。
4. selection.ts只把片段命中项转换为02 Selection并发出意图；结构变更/撤销/节点时间移动的重映射归02命令回执，不在时间轴再实现一套。
5. 新建 `hitTest.ts`：输入「片段行布局表」（轨道行/片段块/边缘手柄/轨道头），输出命中项；行布局由 `05-04` 计算后传入，不包含对象行或节点矩形。
6. 新建 `dragSession.ts`：状态机只产出片段 `DragIntent`；由 `05-05` 转成文档命令。节点拖动、框选与命中属于 06 的效果控件，不进入本状态机。
7. 删除旧下标选择/selectedClips实现，统一消费02文档会话Selection及批选；selectClipMulti/selectAllClips转成共享命令，不另建multiSelection状态源。

## 6. 禁止修改

- 不实现片段编辑命令（`05-05`）与渲染（`05-04`）。
- 不定义属性插值、曲线、路径、转场语义（07/08）。
- 不把 `total_duration` 写回文档；不读 `meta.version`。
- 不引入第三方时间轴/图表库（体积不可控，AUI 兼容性留待 14 实证）。
- 不改 02 的文档结构与 id 规则；需要新字段时回到 02 变更合同。

## 7. 两分支承载

同一份 TS 模块。差异只在「像素密度」与「输入设备」：游戏内高 DPI/手柄场景下，命中阈值与吸附阈值取 `max(8, dpr*4)`，由 `scale.ts` 暴露 `hitSlop` 参数，宿主注入。

## 8. 前置

02必须先交付稳定clipKey与片段级Selection/命令回执；未完成则阻塞交互，不用下标临时降级。属性叶子路径与节点移动映射由06的效果控件消费，主轴不依赖节点身份；time是可变定位值，移动/撤销由命令同步。

## 9. 验收

**正例**

1. 一个 6s 有限片段 + 一个 `duration=-1` 无限片段：`deriveDisplayRange` 返回 `{infinite:true, finiteEnd:6}`，画布至少可滚到 36s，无 `Infinity` 进入文档。
2. px/s = 40 时把片段拖到距另一片段起点 6px → 吸附；拖到 12px → 不吸附（8px 阈值）。
3. 删除中间片段后，选区仍指向原 `clipId`（若存在）或标记失效；不会指到「原下标的下一个片段」。
4. 同起点两个片段排序稳定：连续两次渲染顺序一致。
5. 主轴拖动只产生片段 move/trim 意图，不存在 `keyframe` 拖动模式；在效果控件拖属性节点不会改变主轴的 `pxPerSecond`/`scrollLeft`，反之缩放主轴也不重置效果控件局部视口（06 验收）。

**反例**

1. 用 `{track, clip}` 下标做选区 → 不通过。
2. 吸附阈值写死 0.5s（缩放后手感随缩放变化） → 不通过。
3. 把无限片段写成固定 600s → 不通过。
4. 时间轴自己 `recalcDuration` 并写回 → 不通过。
5. 主轴 `hitTest`/`DragIntent` 里出现属性节点命中或节点拖动分支 → 不通过（主轴不承担 06 节点框架）。
6. 主轴与效果控件共用一份可变 `pxPerSecond`/`scrollLeft` 或缩放锚点 → 不通过。

**真实冒烟**：在 WebUI 打开含无限片段的真实脚本（`MOD:cinematics/0.3.6/tests/` 中有相机/覆盖层夹具，选一个含 `duration:-1` 或宏观循环的），确认画布可滚动、保存后文件无 `total_duration`。

## 10. 完成定义

- `Timeline.vue` 不再包含几何/吸附/选区实现（只剩渲染与事件绑定）。
- 六模块通过本文人工界面操作检查有限/无限/空文档、缩放与吸附、取消/撤销，不新增测试脚本。
- `displayRange` 在「全有限 / 含无限片段 / 宏观无限循环 / 空文档」四种输入下都有确定输出。
- 选区唯一类型/状态来自02；selection.ts仅适配命中和导航，不在时间轴/store/效果控件另建第二份选择真值。
- 主轴模型里不存在对象行、属性节点、轴外槽或节点拖动结构；效果控件局部视口与主轴全局视口各自持有状态，仅复用纯换算函数。
