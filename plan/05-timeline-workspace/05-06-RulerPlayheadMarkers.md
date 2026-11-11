# 05-06 标尺 / 播放头 / 标记 / A-B 循环 / 缩放

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：03（播放状态与 seek）、05-03；同轮：05-04。

## 1. 职责

定义**主时间轴**的时间标尺、播放头、标记、预览范围（A-B）、缩放与自动跟随。**核心是分清三件事**：脚本里的 `timeline.loop_start/loop_end`、纯 UI 的预览范围、以及播放头时间真值。

主轴的标尺/缩放/滚动是**全局视口**；片段效果控件内的局部秒标尺、局部播放头、局部缩放与滚动由 06（`06-EffectControlsRows`/`06-ClipEffectControlsPanel`）独立持有。两者可以复用纯时间换算函数，但**不能共享一份可变 `pxPerSecond`/`scrollLeft`**：缩放主轴不重置效果控件局部视口，反之亦然。片段局部秒 `global = start_time + local` 的展示与编辑归效果控件，本文件不承担节点行布局。

**参考输入**：[Olive时间轴与命令](../references/01-olive-timeline-commands.md)的缩放锚定、显示范围和播放头排除自身吸附。只借几何/手势思想，seek仍经03真实回执；不能把参考播放器时钟或局部预览范围当作脚本loop字段，更不能据视频帧网格取整脚本时间。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/Timeline.vue:135–158` | `rulerMarks`：按 px/s 分 10/5/1/0.5/0.1s |
| `EDITOR:src/components/Timeline.vue:224–266` | `onPlayheadMouseDown` / `onPlayheadDrag` / `onRulerMouseDown` / `onRulerDrag`（拖标尺即拖播放头） |
| `EDITOR:src/components/Timeline.vue:514–530` | 播放中自动跟随（margin 40px） |
| `EDITOR:src/components/Timeline.vue:692–760` | 模板：循环区间块、marker 竖线、刻度、播放头 |
| `EDITOR:src/store.ts:518–545` | `seek()`：立即改前端时间 + 16ms 节流发送；`beginSeekDrag/endSeekDrag`（547–575）拖动期间忽略游戏端回推，松手后 150ms 确认期 |
| `EDITOR:src/store.ts:955–1000` | `setLoopIn/setLoopOut/clearLoop` + `persistTimelineExtras()`（写 `timeline.markers/loop_start/loop_end`） |
| `EDITOR:src/store.ts:1002–1015` | `addMarker/removeMarker`（写 `timeline.markers[{time}]`） |
| `EDITOR:src/store.ts:836–848` | `zoomIn/zoomOut/setZoom`（5–500 px/s，×1.4/÷1.4） |
| `MOD:docs/SCRIPT_FORMAT.md:14–19` | 无 `total_duration`；`timeline` 只接受 `tracks/loop_start/loop_end`（`J:script/ScriptParser.java — timelineKeys（83–89）`） |
| `MOD:docs/SCRIPT_FORMAT.md:756–773` | validator 的 issue 形态 |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/timeline/Ruler.vue` | 组件 | 刻度、循环区间、标记、播放头手柄 |
| `EDITOR:src/timeline/playhead.ts` | `PlayheadController` | 拖动会话、节流、与 03 的时间真值协商 |
| `EDITOR:src/timeline/markers.ts` | `markersOf(doc)` / `setMarkers` | 标记读写（走 02 命令） |
| `EDITOR:src/timeline/zoom.ts` | `zoomAt(cursor, factor)` / `fitToRange()` | 指针锚定缩放、适配 |
| `EDITOR:src/timeline/PreviewRange.vue` | 组件 | 纯 UI 预览范围（与脚本 A-B 区分显示） |

## 4. 输入 / 输出 / 字段约束

**输入**：03 的 `playback.state`（`time`、`playing`）、`seek` 回执；文档的 `timeline.loop_start/loop_end/markers`；主轴视口宽度与 `pxPerSecond`。

**输出**：`seek(time)` 意图；`setLoopIn/Out/clear`（脚本字段）；`addMarker/removeMarker`（脚本字段）；`PreviewRange`（UI 状态）；`zoom` 变更。

**字段约束**

| 项 | 约束 |
|---|---|
| 播放头时间 | 真值在宿主；拖动期间前端驱动（沿用 `store.ts:547–575` 的语义），松手 150ms 后交回；不得在前端自增时间 |
| `timeline.loop_start/loop_end` | 脚本字段，`loop_start >= 0`、`loop_end > loop_start`；清除时删除键（不写 -1） |
| `timeline.markers` | `[{time}]`，去重（`\|Δ\|<0.001` 视为同一点），升序 |
| UI 预览范围 | **不写脚本**；仅影响前端可视高亮与「循环播放预览」的播放器请求（若宿主不支持，仅显示，不承诺行为） |
| 缩放 | 5–500 px/s；指针锚定：缩放前后光标下的时间不变；`Ctrl+0` 重置 40；`F` 适配到有限末端（无限时适配到当前可视末端）。只作用于**主轴全局视口** |
| 视口分离 | 主轴 `pxPerSecond`/`scrollLeft` 是全局视口唯一可变状态；效果控件局部标尺/播放头/缩放另存（06），本文件不导出共享状态，只允许导出纯换算函数 |
| 刻度 | 由 `05-03` 的 `rulerTicks` 提供；主刻度带标签，次刻度只画线 |
| 自动跟随 | 播放中播放头超出可视区 40px 才滚动；拖动期间不跟随；只在主轴滚动，不驱动效果控件局部视口 |

**三件事的区分（必须做进 UI）**

1. **脚本 A-B 循环**：写 `timeline.loop_start/loop_end`，影响运行时；显示为标尺上的实心区间 + 「脚本循环」标签。
2. **UI 预览范围**：只在前端，显示为虚线区间 + 「预览范围」标签；关闭文档即丢。
3. **播放头**：单点时间；拖动即 seek。

## 5. 修改步骤

1. 新建 `Ruler.vue`：从 `Timeline.vue:692–760` 拆出；循环区间与预览范围用不同样式（实心/虚线）并带文字标签。
2. 新建 `playhead.ts`：迁移 `store.ts:518–575` 的节流与拖动会话；补「seek 目标超出显示范围」时的画布扩展。
3. 新建 `markers.ts`：`persistTimelineExtras()`（`store.ts:955–975`）拆分——markers/loop 写脚本，预览范围写 UI 状态；删除把 `-1` 写入脚本的写法。
4. 新建 `zoom.ts`：`zoomIn/zoomOut/setZoom` 迁入；`zoomAt` 用光标锚定；`fitToRange` 替换 `Timeline.vue:64–68` 的 `zoomFit` 与 `App.vue:257–262` 的 `F` 键逻辑（两处重复）。
5. 删除 `App.vue` 中 I/O/M/方向键/Home/End/F 的散装实现（`App.vue:186–280` 一带），改由 `05-10` 的快捷键表路由到本文件。
6. 标记右键菜单（`Timeline.vue:800–820`）迁入 `Ruler.vue`；删除标记需二次确认（当前直接删）。

## 6. 禁止修改

- 不实现播放/暂停/停止的宿主命令（03）；本轮只发 `seek` 与「预览循环」请求。
- 不把预览范围写成脚本字段；不把 `loop_start=-1` 写入 JSON。
- 不改 `playback.state` 的推送频率与字段。
- 不做时间码格式化以外的「帧号」概念（60fps 预览不是脚本时间量化依据，`shared/contracts.md` C04-7）。

## 7. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | 标尺 hover 显示时间气泡；滚轮缩放（Ctrl）；拖动播放头有拖尾高亮 |
| 游戏内 Forge/AUI | 无 hover → 点击标尺即显示时间；缩放用工具栏按钮/快捷键；拖动播放头命中区加宽到 12px |

## 8. 前置

03 的 `seek` 与 `playback.state` 语义（含拖动期间忽略回推）；02 的 `timeline.loop_*/markers` 写入命令。

## 9. 验收

**正例**

1. 拖动标尺到 3.2s：播放头与预览同步到 3.2s；松手后 200ms 内游戏端回推一致，无回跳。
2. 设 A-B（1s–4s）：保存后 JSON 有 `loop_start:1, loop_end:4`；重开文档后区间恢复。
3. 清除 A-B：JSON 中两个键消失（不是 -1）。
4. 添加标记于 2.0s 两次：只保留一个；删除后 JSON 中 `markers` 相应项消失。
5. `Ctrl+滚轮` 在光标处缩放：光标下时间不变（±0.05s）。
6. 无限脚本按 `F`：适配到当前可视末端而不是报错或跳 0。
7. 缩放/移动主轴后，效果控件局部视口的 `pxPerSecond`/缩放/滚动保持不变；反向亦然（契约验证，06 实施后复测）。

**反例**

1. 前端自己累加时间（不依赖 `playback.state`） → 不通过。
2. 预览范围写进 `timeline.loop_*` → 不通过。
3. 播放头拖动时触发 `editor.play` → 不通过。
4. 缩放改变选区或播放头时间 → 不通过。
5. 主轴与效果控件共用一份可变缩放/滚动状态，或主轴的 `F`/`Ctrl+0` 重置效果控件局部视口 → 不通过。

**真实冒烟**：WebUI 连真机，播放一段 10s 脚本，拖动/缩放/设 A-B/加标记，保存后 `git diff` 检查 JSON 只有预期字段。

## 10. 完成定义

- 标尺/播放头/标记/A-B/缩放全部由本文件的模块实现，`Timeline.vue` 与 `App.vue` 无重复实现。
- 三类「循环/范围」在 UI 上可区分，且只有脚本字段落盘。
- 拖动会话在断连/重连下不产生时间跳变（断连时停在前端最后位置并标注）。
- 主轴全局视口与效果控件局部视口各自持有状态；05 不提供节点行布局或局部标尺实现。
