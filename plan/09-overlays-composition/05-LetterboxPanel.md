# 09-05 遮幅面板（LetterboxPanel）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：09-overlays-composition
> 关联：`01-OverlayTrackSurface.md`、`06-CompositionOrderPanel.md`、`../05-timeline-workspace/README.md`、`../08-camera-transitions/03-LaneCompositionPanel.md`

## 1. 职责

编辑 LETTERBOX 轨道的 `aspect_ratio`/`opacity`，并把运行时语义（无活跃片段 → 比例归 0、透明度复位；淡出 0.5s；固定 Z=0）呈现给作者。LETTERBOX 是独立轨道，不是 OVERLAY 的 `layer_type`。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| LETTERBOX 字段 | `J:script/schema/TrackSchemas.java — letterboxObjects（349-356）` | `aspect_ratio`（ANIMATED/LINEAR，默认 2.35，min 0）、`opacity`（ANIMATED/LINEAR，默认 1，0–1） |
| 轨道装配 | `TrackSchemas.java — letterbox（49）`、`PLAY_CONTROL（84）` | `TrackTypeSchema(objects, PLAY_CONTROL)` |
| 驱动 | `J:script/LetterboxTrackPlayer.java — DEFAULT_ASPECT_RATIO（21）`、`SLOT_ASPECT_RATIO/SLOT_OPACITY（24-25）`、`compute（84-95）`、`onRenderFrame（59-83）`、`onStop（-）` | 无活跃 clip → aspect=0 + opacity 复位 |
| 参数 | `LetterboxTrackPlayer.java — LetterboxParams（96-）` | `{aspectRatio, opacity}` |
| 层 | `J:overlay/LetterboxLayer.java — Z_INDEX（21）`、`FADE_OUT_SECONDS（24）`、`render（45-66）`、`isVisible（67-72）`、`reset（83-89）`、`tick（90-96）`、`startFadeOut（97-103）`、`isAnimating（104-108）`、`setAspectRatio（114-118）`、`setOpacity（119-）` | 上下/左右黑边；淡出 |
| 层管理 | `J:overlay/OverlayManager.java — addLayer（66-76）`、`removeLayer（77-89）`、`startFadeOut（155-168）`、`removeLayersOf（169-187）` | 构造建层；`onStop` 移除 |
| 合成顺序建议 | `J:overlay/OverlayLayer.java:30-38`（zIndex javadoc） | 0 = 画幅层（LETTERBOX 内置常量、不在脚本口径内） |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 无遮幅专用 UI |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 比例 | 通用数字框 | 预设（2.35/2.39/1.85/16:9/4:3）+ 自定义 |
| 透明度 | 通用数字框 | 0–1 + 黑边说明 |
| 无活跃片段 | 无提示 | 明确「比例归 0、透明度复位」 |
| 淡出 | 无 | 说明 0.5s |
| Z=0 | 无 | 说明「永远在最底，不在脚本 z_index 口径内」 |
| 与 OVERLAY | 混用 | 明确 LETTERBOX 不是 `layer_type` |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/LetterboxPanel.vue`（提案）：比例/透明度 + 语义说明。
- `EDITOR:src/components/overlay/AspectPreset.vue`（提案）：预设 + 自定义。
- `EDITOR:src/lib/letterbox.ts`（提案）：比例校验（>0 或 0=关闭）、预设映射。

## 4. 输入输出与字段约束

**输入**：LETTERBOX 片段 JSON、当前播放头、轨道活跃状态。

**输出**：对 `aspect_ratio`/`opacity` 的编辑意图。

| 字段 | 约束 |
|---|---|
| `aspect_ratio` | float；默认 2.35；min 0；0 = 关闭/无遮幅（运行时无活跃 clip 也归 0） |
| `opacity` | 0–1；默认 1；0 = 透明 |
| 预设 | 2.35（宽银幕）、2.39（Scope）、1.85、16:9（1.777…）、4:3（1.333…）；自定义正数 |
| 淡出 | 0.5s（`FADE_OUT_SECONDS`）；不可配置 |
| Z | 0（`Z_INDEX`）；不在脚本 `z_index` 口径内 |

**必须显示的边界**：

- LETTERBOX 是独立轨道；不能在 OVERLAY 片段上写 `layer_type=letterbox`（不存在）。
- 无活跃片段：`onRenderFrame` 把 aspect 归 0、opacity 复位；画面无黑边。
- `onStop` 移除层；`startFadeOut` 由 `OverlayManager` 按 owner 触发。
- 黑边方向由画面宽高比与 `aspect_ratio` 决定（上下或左右）；UI 只解释，不本地计算像素。
- 与 08 的 lane 合成：LETTERBOX 在 lane 合成之后作为全屏层绘制；不是 lane 的一部分。

## 5. 修改步骤

1. 新建 `letterbox.ts`：预设/自定义校验；`aspect_ratio=0` 的「关闭」语义。
2. 新建 `LetterboxPanel`：比例预设 + 自定义 + 透明度 + 语义说明。
3. 在 05 的检查器注册「遮幅」页；选中 LETTERBOX 片段/轨道时打开。
4. 显示当前播放头是否有活跃 LETTERBOX clip；无活跃时标注「比例归 0（运行时）」。
5. 说明淡出 0.5s、Z=0、`onStop` 移除；不提供淡出时长/Z 的编辑。
6. 与 06 的顺序页：LETTERBOX 行固定 Z=0，不可改；点击跳回本页。
7. 删除旧通用表单对 LETTERBOX 的重复入口（迁移调用方）。

## 6. 禁止修改

- 不得改 `LetterboxTrackPlayer`/`LetterboxLayer` 的复位/淡出/Z 语义。
- 不得给 LETTERBOX 增加 `layer_type` 或把它并入 OVERLAY。
- 不得让 `z_index` 影响 LETTERBOX（它固定 Z=0）。
- 不得把 `aspect_ratio=0` 解释成「2.35」或「默认」。
- 不得本地绘制黑边预览替代真实画面。
- 不得新增遮幅字段（颜色/圆角等运行时没有的）。

## 7. 两分支承载

- **WebUI**：遮幅面板 + 语义说明；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同遮幅控件，经03公共端口预览实际LetterboxTrackPlayer/Layer结果，不重写渲染；本轮 WebUI 对接 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `LetterboxTrackPlayer` + `LetterboxLayer`。

## 8. 前置

- 01：`letterbox.objects` schema。
- 02：对象叶子路径 + 原子提交。
- 05：检查器宿主、片段/轨道选区。
- 06：异步属性控件。
- 08-03：lane 合成边界（LETTERBOX 不在 lane 内）。

## 9. 验收

**正例**

- `aspect_ratio=2.35`、`opacity=1`：游戏内上下黑边；UI 显示「宽银幕」。
- 选 16:9：黑边消失/变窄；与画面比例一致。
- `aspect_ratio=0`：无遮幅；UI 标注「关闭」。
- 无活跃片段：UI 标注「比例归 0（运行时）」；游戏内无黑边。
- `opacity=0.5`：黑边半透明；UI 说明。
- 06 顺序页中 LETTERBOX 行 Z=0 且不可编辑；点击跳回本页。

**反例**

- 在 OVERLAY 上写 `layer_type=letterbox` → 失败（不存在）。
- `aspect_ratio=0` 显示成 2.35 → 失败。
- 允许编辑淡出时长/Z → 失败。
- 本地画黑边预览并称真实画面 → 失败。
- 新增遮幅颜色字段 → 失败。
- 把 LETTERBOX 并入 06 的可拖拽 zIndex 列表 → 失败。

## 10. 真实冒烟

1. 造 LETTERBOX 片段 `aspect_ratio=2.35`、`opacity=1`：游戏内上下黑边。
2. 改 1.85、16:9、4:3：黑边变化与比例一致。
3. 改 `opacity=0.5`：半透明黑边。
4. 删除/结束片段：黑边淡出 0.5s；无活跃时比例归 0。
5. 停止脚本：层移除；再次播放重建。
6. 06 顺序页：LETTERBOX 固定最底；OVERLAY 字幕在其上。

## 11. 完成定义

- `aspect_ratio`/`opacity` 可编辑；预设/自定义/关闭语义正确。
- 无活跃片段复位、淡出 0.5s、Z=0、`onStop` 移除都可解释。
- LETTERBOX 与 OVERLAY 的轨道/字段边界清晰；不新增字段。
- 不本地绘制黑边；真实画面来自游戏。
- 正例/反例/冒烟全部通过。
