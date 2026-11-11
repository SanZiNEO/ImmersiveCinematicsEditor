# 12-08 几何工具（一键优化 / base_resolution / 预览按 k / Gizmo）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：01（`meta.base_resolution`）、03（预览尺寸）、06（`dest/source` 属性面板）、09（覆盖层字段）。
> 规格来源：`MOD:plans/0.3.6/Z-editor/geometry-tools.md` §二（四项工具）。

## 1. 职责

把作者的「画布上拉一个区域」「我要 3200×450」翻译成标准字段；提供 `base_resolution` 表单、按 `k` 的预览换算、Gizmo 拖拽。所有产物仍是标准 `objects` 字段，并在**片段效果控件（`clip.effects`）**的对应组/行中显示与选中；主时间轴不展开对象行或关键帧。

**参考输入**：[Olive属性关键帧适配](../references/02-olive-property-keyframes.md)的InputDragger起始快照与单次提交。Gizmo拖动只为明确选中的叶子生成一次命令；取消恢复、冲突全回滚，不照搬create_key_on_all_tracks，不以鼠标移动事件反复保存或向其他轴同步补帧。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `MOD:docs/SCRIPT_FORMAT.md:32` | `meta.base_resolution`：`{w,h}`，`null` = 1920×1080 |
| `MOD:docs/SCRIPT_FORMAT.md:232–240` | CAMERA 的 `dest.*`/`source.*`（0–1 归一） |
| `MOD:docs/SCRIPT_FORMAT.md:492–502` | OVERLAY 的 `x/y/anchor_x/anchor_y/scale_x/scale_y/source.*` |
| `EDITOR:src/components/Preview.vue:23–24,103–133` | 预览 canvas 与 `drawFrame`：按帧尺寸设 canvas，`object-fit: contain` |
| `EDITOR:src/components/Preview.vue:306–315` | `onModeChange` / `onFpsChange`：**请求字段被宿主忽略**（固定 1080p60，见 `MOD:J:webui/PreviewConfig.java`） |
| `EDITOR:src/components/fields/PositionField.vue:16–43` | 三轴输入 + `position_mode` 联动（旧模型） |
| `MOD:plans/0.3.6/Z-editor/geometry-tools.md` §二 | 四项工具与「运行时不做便捷写法解析」的原则 |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/geometry/rectConvert.ts` | `pixelRectToNormalized(rect, base)` / `normalizedToPixelRect` | 区域 ↔ 归一化 |
| `EDITOR:src/geometry/scaleSolve.ts` | `solveScale(targetPx, assetPx)` | 像素尺寸 → `scale_x/scale_y` |
| `EDITOR:src/geometry/baseResolution.ts` | `effectiveBase(meta)` / `fillFromViewport()` | 基准分辨率 |
| `EDITOR:src/geometry/previewScale.ts` | `computeK(previewW, previewH, base)` | 预览按 k |
| `EDITOR:src/geometry/RegionOverlay.vue` | 组件 | 预览上的框选层 |
| `EDITOR:src/geometry/GizmoOverlay.vue` | 组件 | 拖拽/缩放手柄 |

## 4. 输入 / 输出 / 字段约束

### 4.1 区域 → `source/dest`

- 输入：预览上的像素矩形 `{x,y,w,h}`（相对预览画面，不是窗口）、当前帧尺寸、`base_resolution`。
- 输出：归一化 `{x,y,w,h}`，值域 `[0,1]`，保留 4 位小数。
- 约束：`w/h > 0`；超出画面时**钳到** `[0,1]` 并在 UI 提示；不静默改比例。
- 与 `k` 的关系：`k = 预览宽 / base.w`；像素矩形先除以预览尺寸再乘 `base`？**不**——归一化与分辨率无关，直接用「预览内相对位置」。`k` 只用于**显示尺寸**（见 4.3）。

### 4.2 像素尺寸 → `scale`

- 作者填「目标显示尺寸 3200×450」→ `scale_x = 3200 / asset.w`、`scale_y = 450 / asset.h`。
- `asset.w/h` 来源：图片由 `resource.list` 给出路径但**不给尺寸**；因此需要：
  - 已知素材时由用户填「素材原始尺寸」，或
  - 由前端 `Image()` 加载本地预览失败时提示「无法读取素材尺寸，请填写」。
- 约束：`scale > 0`；不写像素值进脚本（脚本只有 `scale_*`）。
- 反例：素材尺寸未知却按 1920×1080 猜 → 禁止。

### 4.3 `base_resolution` 与预览按 `k`

- `effectiveBase(meta)` = `meta.base_resolution ?? {w:1920,h:1080}`。
- 文档属性面板提供 `base_resolution` 两个数值 + 「用当前窗口尺寸填入」（从 03 的宿主取窗口尺寸；取不到则禁用）。
- 预览显示：`k = previewWidth / base.w`；在预览状态条显示 `k=0.5` 与「预览 960×540 / 基准 1920×1080」。
- **重要事实**：宿主预览固定 1080p60（`MOD:J:webui/PreviewConfig.java:14–20`），所以 `k` 只影响「编辑器内的显示换算」，不影响宿主推流分辨率。UI 必须写清，不能让作者以为改了预览分辨率。

### 4.4 Gizmo

- 本轮覆盖dest（CAMERA合成区域）与OVERLAY的x/y/scale_x/scale_y：
  - 拖拽移动 → 改 `x/y`（OVERLAY）或 `dest.x/y`（CAMERA）；
  - 角手柄缩放 → 改 `scale_*` 或 `dest.w/h`；
  - 边手柄 → 单轴。
- 拖拽产物写**节点**：若该属性已有 keyframes，则在播放头处新增/更新节点（一次事务）；否则改 `value`。
- Gizmo 的手柄只对 `clip.effects` 当前选中的叶子出现；选中来源是共享 Selection（快捷属性选中同一目标也可）。拖动开始记快照、结束提交一条命令，不逐移动保存。
- Gizmo 只在预览画面区域内生效，坐标换算用 `previewRect` 缓存。
- 写回后行与节点在 `clip.effects` 中保持选中，其他已展开组仍可见；主时间轴只保持片段选中。
- 约束：不改变宽高比（按住 `Shift` 才允许自由缩放）；不做旋转（`rotation` 字段不存在）。

## 5. 修改步骤

1. rectConvert/scaleSolve/baseResolution/previewScale实现真实换算职责；用界面人工输入像素/区域、拖动观察与游戏结果，不新增单测。
2. 新建 `RegionOverlay.vue`：在 `Preview.vue` 的 `.canvas-wrap` 上叠一层（`position:absolute`），绘制框选矩形与尺寸标签；`Esc` 取消。
3. 新建 `GizmoOverlay.vue`：按当前选中属性渲染手柄；拖拽发意图给 06 的节点编辑命令，并保持 `clip.effects` 行选中。
4. 在预览工具条加「区域框选」开关与 `k` 显示（`Preview.vue` 的 `.bar`，347–396）。
5. 在文档属性面板加 `base_resolution` 两输入 + 「用当前窗口尺寸」。
6. 删除 `Preview.vue:306–315` 的「原始/720p/1080p」「60/30fps」下拉（宿主已固定，保留会误导），改为只读文本「1080p60（宿主固定）」。
7. 目标叶子只从 `clip.effects` 的行（或复用同一 Selection 的快捷属性）取；不新建属性面板，不在主时间轴加手柄/节点。

## 6. 禁止修改

- 不改宿主预览分辨率/编码参数（`PreviewConfig` 固定）。
- 不把像素尺寸写进脚本；不新增 `rotation`/`crop` 等字段。
- 不做「自动识别素材尺寸」的网络/文件读取（无通道）。
- 不做「合成器可视化」（属 09）。
- 不改变 `base_resolution` 的语义（`null` = 1920×1080）。
- 不得要求展开主时间轴对象行/关键帧来承接 Gizmo 结果；不新增独立属性面板或第二份 Selection。
- 不得让 Gizmo 拖动产生跨叶子同步补帧或逐移动保存。

## 7. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | 鼠标框选 + 手柄拖拽 + `k` 显示 |
| 游戏内Forge/AUI | 同样交付可操作框选/移动/缩放/取点，按14实际输入事件适配；可提供两点框选等同义操作但不能降为只读。hover/指针精度/画布能力尚未实证，不以猜测删功能 |

## 8. 前置

01 的 `meta.base_resolution` 与 `dest/source` schema；03 的预览尺寸与窗口尺寸；06 的节点写入命令与 `clip.effects` 行（`06-ClipEffectControlsPanel` / `06-EffectControlsRows`）；09 的 OVERLAY 字段语义。

## 9. 验收

**正例**

1. 在预览上框出中间 50% 区域 → `source={x:0.25,y:0.25,w:0.5,h:0.5}`；保存后播放裁切一致。
2. 填「3200×450」+ 素材 1920×1080 → `scale_x=1.6667, scale_y=0.4167`；不写像素。
3. `base_resolution=null` 时 `effectiveBase` 返回 1920×1080；设为 2560×1440 后 `k` 显示随之变化。
4. 拖 `dest` 右下角手柄 → `dest.w/h` 变化；`Shift` 关闭时保持比例。
5. 属性已有 keyframes：拖拽在播放头处新增节点，不覆盖其他时间点。
6. 从 `clip.effects` 的 `dest` 行选中后拖动：该行保持选中，右侧新节点出现；主时间轴片段高度不变。

**反例**

1. 预览分辨率下拉仍可切换且声称生效 → 不通过（宿主固定）。
2. 素材尺寸未知时按 1920 猜 → 不通过。
3. 像素值写进脚本 → 不通过。
4. 框选超出画面时静默裁剪且无提示 → 不通过。
5. Gizmo 结果需要主时间轴展开对象行才能看到/编辑，或另开属性面板 → 不通过。

**真实冒烟**：WebUI 连真机，框选 + 拖拽 + 改基准，保存后重开确认字段；游戏内验证「点两下框选」属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 四项工具完整可操作，人工检查像素/归一化换算及不同窗口尺寸，记录问题修复复验。
- 预览状态条显示 `k` 与真实推流分辨率，不再有失效下拉。
- Gizmo 覆盖 `dest` 与 OVERLAY 位置/缩放，且只作用于 `clip.effects` 当前选中叶子。
- 写回后定位在效果控件行；主时间轴无对象行/节点；无新增脚本字段。
