# 07-CurvePathPreview：路径与曲线预览

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助、C06 真实画面端口（预览不得冒充真值）
> 依赖：07-PathCollectionEditor、07-PathGeometryForms、07-PathTimingEditor、07-OrientationEditor、06-ClipEffectControlsPanel / 06-EffectControlsRows（端点与属性节点定位）
> 下游：05（工作区面板）、13（WebUI 验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

路径条目的**示意预览**：控制多边形、端点、采样点、切线箭头、`s(u)` 折线，以及"未选轴不画"的明确说明。

核心原则：**不在编辑器里重新实现路径数学**。采样点由宿主（游戏进程）用运行时同一 `PathEvaluator` 计算后回传；宿主不可用时只画控制多边形与端点，不画假曲线。

**参考输入**：[Olive属性关键帧适配](../references/02-olive-property-keyframes.md)的分量可见性、曲线选中和把手显示。只借可视化交互，不移植其本地求值器；采样点仍来自游戏PathEvaluator，宿主不可用只显示控制多边形/端点，不把近似曲线冒充游戏真值。

**界面位置**：本预览是脚本级路径面板内的只读视图，不占据、也不替换 `clip.effects`；选中端点或相关属性时，经共享 Selection 在效果控件的位置组定位对应行与节点，主时间轴仍只显示片段。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| 运行时求值：`PathEvaluator.position(spec, from, to, s)` → `ArcLengthTable.uAt(s)` → `PathExpression.position(u)` | `J:math/path/PathEvaluator.java（27–34）`、`ArcLengthTable` |
| 弧长：解析快路径（`ANALYTIC_ARC_LENGTH`）或自适应 5 点 Gauss-Legendre（相对容差 1e-9、深度 8） | `J:math/path/ArcLength.java（8–60）` |
| 切线：`PathExpression.derivative(u)` | `PathEvaluator.tangent（37–45）` |
| 11 种几何的参数与锚点 | 见 07-PathGeometryForms §3.1 |
| 选轴合并：选中轴取路径，未选轴取采样属性 | `J:camera/source/ObjectCameraEvaluator.java — positionSpec（324–336）`、`tangent（447–457）` |
| `orient=tangent` 的切线在 `base` 空间要过参考系 | `toWorldDirection（505–514）` |
| 编辑器现有预览只是视频流 | `EDITOR:src/components/Preview.vue（524 行）` |

### 2.2 目标

1. 画控制多边形（控制点连线）与端点，**不依赖任何数学实现**。
2. 有宿主支持时，画真实采样点（来自运行时求值）。
3. 画 `s(u)` 折线（timing 的影响），标"示意"。
4. 明确标注：未选轴不画；2 轴只保证平面内 2D 弧长；FREE 锚点的端点偏差。
5. 不伪造"世界轨迹"（实体/方块/结构位置无法在编辑器解析）。

### 2.3 非目标

- 不做 3D 世界渲染。
- 不做控制点拖拽改几何（数值编辑已足够；拖拽是可选增强）。
- 不做帧级动画预览（画面来自游戏）。

## 三、方案

### 3.1 三种预览模式（按能力降级）

| 模式 | 前提 | 画什么 | 标注 |
|---|---|---|---|
| A. 宿主采样 | 宿主提供 `path.sample`（提案，见 §3.2） | 采样点折线（真实弧长参数化）+ 切线箭头 + 端点 | "来自运行时求值" |
| B. 控制多边形 | 无宿主 | 控制点 + 连线 + 端点 + `s(u)` 折线 | "仅示意：未连接游戏，不画曲线" |
| C. 无几何 | 几何类型未知/参数不完整 | 只画端点与错误 | "参数不完整" |

**禁止**模式 D：编辑器自己实现 bezier/NURBS/弧长来画曲线。理由：11 种几何 + 自适应弧长 + 解析弧长 + 权重/节点向量，复刻必然与运行时漂移；漂移的预览比没有预览更糟（作者按错的形状调参）。

### 3.2 宿主采样接口（提案）

```text
请求：{ type: 'path.sample', data: {
  clip: '<clipId>',
  from: 0.0, to: 3.0,
  axes: ['x','z'],
  geometry: { ... },          // 原样回传编辑器里的几何
  timing: { ... },
  samples: 64
} }
响应：{ type: 'path.sample.result', data: {
  points: [{ x, y, z, s }],   // s = 归一化弧长进度
  tangents: [{ x, y, z }],    // 与 points 等长
  length: 12.34,              // 总弧长 L
  anchor: 'endpoints' | 'start' | 'free',
  endpointDelta: { from: 0.12, to: 1.7 }  // FREE 锚点时路径端点与关键帧端点的距离
} }
```

- 该消息**不存在**于当前 `WebEditorApi`（消息清单见 `J:webui/WebEditorApi.java 41–87`）。属**提案前置**，必须在 03 轮显式提出并实现；本轮不假设它可用。
- 宿主侧实现必须直接调用运行时 `PathEvaluator`（同一份数学），不得另写。
- 编辑器侧只做插值绘制（把 64 个点连成折线）。

### 3.3 画布与坐标系

- 2D 正交投影：取选中轴的平面（`axes` 里的前两个；若只有一个轴，横轴 = 该轴、纵轴 = 弧长进度）。
- 端点位置：来自目标片段 `position.x/y/z` 在 `from`/`to` 时刻的采样值（编辑器近似：取该时刻的帧值或线性插值，标"近似"）。
- 未选轴：不参与 2D 投影；在图例里写明"未选轴由属性插值，图中不显示"。
- 世界坐标 → 画布：按端点包围盒 + 10% padding 缩放；不显示绝对世界坐标刻度（避免误导为世界地图）。

### 3.4 必须显示的三个提示

| 提示 | 触发 | 文案 |
|---|---|---|
| 未选轴 | `axes.length < 3` | "图中只显示选中轴（x,z）；y 轴由 `position.y` 的自身关键帧插值，不在路径上。" |
| 2 轴非 3D 匀速 | `axes.length == 2` | "2 轴路径只保证该平面内 2D 弧长匀速；3D 速度取决于未选轴属性。" |
| FREE 端点偏差 | `anchor == 'free'` 且 `endpointDelta` 任一 > 1e-3 | "该几何忽略端点：路径起点与关键帧端点相差 0.12 格、终点相差 1.70 格（运行时段边界会跳变）。" |

### 3.5 `s(u)` 折线

- 横轴 `u ∈ [0,1]`（归一化片段局部时间）；纵轴 `s ∈ [0,1]`（归一化弧长进度）。
- 数据来自 `timing`（linear 是对角线；keyframes 是折线）。
- 画在路径示意的旁边，标"时间 → 路程"。
- 该折线由编辑器按 `timing.points` 直接绘制（纯折线，不涉及几何数学），不需要宿主。

### 3.6 切线箭头（`orient=tangent`）

- 只在 `orient=tangent` 且宿主采样可用时画。
- 箭头方向 = 采样切线（选轴合并后的方向，宿主给）。
- 若 `position_space=base`，宿主给的是世界方向（`toWorldDirection` 之后）；编辑器不自己变换。
- 无宿主时不画切线（不猜）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `previewMode(hostAvailable, geometryValid): 'A'\|'B'\|'C'` | 能力 | 模式 |
| `requestSamples(entry, samples): Promise<SampleResult>` | 条目 | 采样（失败 → 降级 B） |
| `project(points, axes): {x,y}[]` | 点 + 轴 | 画布坐标 |
| `timingPolyline(timing): {u,s}[]` | timing | 折线点 |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/paths/PathPreview.vue`（提案，SVG 或 canvas）。
2. 新建 `EDITOR:src/model/pathPreview.ts`（提案）：`previewMode` / `project` / `timingPolyline` / `requestSamples`（走 03 的传输端口）。
3. 嵌入文档级路径面板的条目编辑器（右侧或下方）；不嵌入 `clip.effects` 组，也不成为主时间轴对象行。
4. 不新增几何数学代码；代码审查点：`pathPreview.ts` 里不得出现 `bezier`/`nurbs`/`arcLength` 等实现。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/PathPreview.java`（提案）：同进程可直接调 `PathEvaluator`（真值），不需要协议。
2. 切线同理。
3. 这是 Forge 载体的优势：模式 A 恒可用（只要几何有效）。

### 4.4 禁止修改

- 不在编辑器实现几何求值/弧长/导数。
- 不把 2D 投影画成"世界地图"。
- 不在无宿主时画假曲线。
- 不把 `axes` 未选轴的值混进路径采样。
- 不用预览结果反推脚本数据（预览是只读）。
- 不把预览当作效果控件或主时间轴的替代；节点显示/定位仍由 `clip.effects` 行负责。
- 不在主时间轴增加路径预览层、对象行或关键帧汇总。

## 五、正反例验收

### 5.1 正例

1. 无宿主（离线）：选 `bezier`、两个控制点 → 画控制多边形 + 端点 + 提示"仅示意"；不画曲线。
2. 有宿主：同一 `bezier` → 画 64 个采样点连成的曲线 + 切线箭头（`orient=tangent`）+ 总弧长 L。
3. `axes=[x,z]` → 图例提示 y 未显示；`axes=[x]` → 横轴 x、纵轴 s。
4. `arc`（FREE）→ 显示端点偏差（例如起点偏 0.12 格、终点偏 1.70 格）。
5. `timing=keyframes [{0,0},{0.25,0.75},{1,1}]` → `s(u)` 折线前陡后平。
6. 宿主采样失败（断连）→ 自动降级到模式 B，提示"已降级"。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 编辑器自己算 bezier 画曲线 | 禁止（漂移风险） |
| 无宿主时画出一条"看起来对"的曲线 | 禁止 |
| 2 轴路径标"3D 匀速" | 禁止 |
| 把未选轴的值画进路径 | 禁止 |
| 用预览结果自动修改 `geometry` | 禁止 |
| FREE 锚点不提示端点偏差 | 禁止 |
| 用预览替代效果控件来编辑/定位属性节点 | 禁止 |

### 5.3 异步关键帧专项

**正例**：`position.x` 帧 `[0,3]`、`position.z` 帧 `[0,3]`、`axes=[x,z]`；预览用端点的近似采样值画端点；曲线由宿主采样。作者在 `t=1` 给 `position.x` 加帧 → 端点不变（0/3），预览不变；但若新帧在 0..3 之间，路径端点相邻性被破坏（07-PathCollectionEditor 会阻止）。

**反例**：加帧后预览自动重采样并把端点改到新帧位置。

- 期望：不发生（端点由 `from`/`to` 决定，不由"最近帧"决定）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；`c1` 位置节点 `[0,3]`；`p1` 为 `bezier`。
2. 编辑器打开 `p1` → 模式 A 可用；预览曲线与 3D 世界里的运动一致（对比：播放时相机在 `t=1.5` 的位置与预览采样点对应）。
3. 把 `axes` 改成 `[x]` → 预览只显示 x 与 s；播放确认 z 由属性插值（若 z 无帧则恒 0）。
4. 把几何改成 `arc` → 出现端点偏差提示；播放确认段末跳变（与提示一致）。
5. 断开游戏 → 预览降级为控制多边形，提示"仅示意"。

通过判定：第 2 步预览与画面运动定性一致；第 4 步跳变现象与提示一致；第 5 步确实降级。

## 七、完成定义

1. `PathPreview.vue` + `pathPreview.ts` 存在；无几何数学实现。
2. 三种模式与降级逻辑可用。
3. 三个提示（未选轴/2 轴/端点偏差）可见。
4. §5 的 6 条正例、7 条反例通过。
5. §6 冒烟 5 步通过。
6. 预览停在路径面板内，端点定位走共享 Selection + 效果控件行；主时间轴无对象行。
7. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体模式 A 恒可用（同进程 `PathEvaluator`），采样与 WebUI 经协议得到的点一致（同一 geometry/timing 下逐点容差 1e-6）。
