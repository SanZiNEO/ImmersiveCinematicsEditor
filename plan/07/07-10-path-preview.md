# 07-10 路径预览

## 目标

在编辑器里给路径条目和生成器提供只读预览：

- 形状：11 种 `curveTypes` 的曲线/圆弧/样条。
- 控制多边形、控制点、端点、采样点、切线示意。
- `timing` 的 `s(t)` 折线。
- `FREE` / `START` 锚点的端点偏差。
- 生成器的语义圆/弧/椭圆预览。

预览采样在编辑器内完成，只用于画图和参数判断；运行时的弧长、速度、状态模型仍以模组为准。真游戏检查用现有 `editor.pushScript` / `editor.seek`；`WebEditorApi` 的消息清单保持不变。

## 数据模型

```ts
interface PathPreviewModel {
  entry: PathEntryDoc
  fromPoint: Vec3              // 位置采样，表达式空间
  toPoint: Vec3                // 位置采样，表达式空间
  axes: ('x' | 'y' | 'z')[]
  anchor: 'FREE' | 'START' | 'ENDPOINTS'
  samples: PathPreviewSample[]
  controlPolygon: Vec3[]
  timingCurve: Array<{ t: number; s: number }>
  endpointDelta: number | null
  warnings: PreviewWarning[]
}

interface PathPreviewSample {
  u: number
  point: Vec3
  tangent: Vec3                // 有限差分/解析，示意
}
```

- `fromPoint/toPoint` 从目标片段 `position.x/y/z` 在该时刻的值取，和运行时端点采样同一表达式空间。
- `entry` 是只读快照；预览不改文档。
- `controlPolygon` 只对有多边形控制点的类型有值。
- `endpointDelta` 只对 `FREE` / `START` 计算；`ENDPOINTS` 为 `null`。

## 预览内核

```text
src/model/path/preview/
  previewKernel.ts       入口：按 geometry.type 分派
  samples/
    linear.ts
    bezier.ts
    rationalBezier.ts
    arc.ts
    ellipse.ts
    bspline.ts
    nurbs.ts
    catmullRom.ts
    hermite.ts
    clothoid.ts
    fourier.ts
  previewTypes.ts        采样结果/警告/锚点
  fixtures/              11 种 golden fixture
```

每个 `samples/<type>.ts` 暴露：

```ts
function sample(geometry: PathGeometry, from: Vec3, to: Vec3, u: number): Vec3
function polygon(geometry: PathGeometry, from: Vec3, to: Vec3): Vec3[]
```

### 采样方式

| 类型 | 采样 |
|---|---|
| `linear` / `line` | 两端线性插值 |
| `bezier` | 三次 Bézier；端点 + 2 个内部控制点 |
| `rational_bezier` | 有理三次；按权重归一化 |
| `arc` | 圆心 + 半径 + 基向量；角度线性采样 |
| `ellipse` | 圆心 + 半轴 + 旋转 + 基向量；参数角采样 |
| `bspline` | de Boor；端点 + 内部控制点 + 节点向量 |
| `nurbs` | 有理 de Boor；权重归一化 |
| `catmull_rom` | 按 `uniform/chordal/centripetal` 参数化；端点 mirror/clamp |
| `hermite` | 三次 Hermite 基；端点 + 2 个切线 |
| `clothoid` | Fresnel 积分数值采样；起点曲率/终点曲率/长度 |
| `fourier` | `a0 + Σ(cos_k cos + sin_k sin)`；周期/非周期 |

- 采样按参数 `u` 均匀，不按弧长均匀；形状预览不需要弧长表。
- `arc`/`ellipse` 的 `u` 映射到角度 `start + (end-start)*u`。
- `clothoid` 用 32/64 段数值积分；误差用 fixture 限制。
- 端点：
  - `ENDPOINTS`：几何起点 = `fromPoint`，终点 = `toPoint`。
  - `FREE`：几何起点/终点由参数算；`fromPoint/toPoint` 只用于绑定和偏差。
  - `START`：几何起点 = `fromPoint`；终点由曲率/长度算；`toPoint` 只用于绑定。
- `fourier.periodic=true`：`u=0` 与 `u=1` 同点；非周期用端点。

## golden fixture

每个类型一个 JSON：

```json
{
  "type": "arc",
  "geometry": {
    "type": "arc",
    "center": { "dx": 0, "dy": 0, "dz": 0 },
    "radius": 4.0,
    "start_angle": 0.0,
    "end_angle": 180.0,
    "normal": { "x": 0, "y": 1, "z": 0 },
    "reference_axis": { "x": 1, "y": 0, "z": 0 }
  },
  "from": [0, 0, 0],
  "to": [0, 0, 0],
  "samples": [
    { "u": 0.0, "point": [4.0, 0.0, 0.0] },
    { "u": 0.25, "point": [2.828427, 0.0, 2.828427] },
    { "u": 0.5, "point": [0.0, 0.0, 4.0] },
    { "u": 0.75, "point": [-2.828427, 0.0, 2.828427] },
    { "u": 1.0, "point": [-4.0, 0.0, 0.0] }
  ],
  "tolerance": 0.0001
}
```

- 期望值来自模组固定测试向量，不由编辑器采样器自己生成，避免循环验证。
- 11 个 fixture 覆盖：0/0.25/0.5/0.75/1；退化/周期/端点各至少一个。
- 每次构建跑 fixture；任一类型偏差 > `tolerance` 失败。
- fixture 是只读资产；运行时不加载。

## 2D 投影

```text
axes = x,z  → 横轴 x，纵轴 z
axes = x,y  → 横轴 x，纵轴 y
axes = y,z  → 横轴 y，纵轴 z
axes = 单轴 → 横轴 u/时间，纵轴该轴值
axes = 三轴 → 默认 x/z；可切 x/y 或 y/z
```

- 三轴路径在 2D 平面上是投影；标题显示“2D 投影，未显示 y”。
- `base` 空间轴标签换成 `fwd/right`（`y` 是 `up`）。
- 路径只覆盖 `axes` 中的轴；未覆盖轴不画路径线。
- 端点/采样点用同一投影；投影不改变数据。
- 自动缩放：按路径包围盒 + 10% 边距；提供“适配视图 / 1:1”。
- 网格：1 米主网格，0.25 米次网格；显示坐标读数。

## 画布元素

| 元素 | 显示 |
|---|---|
| 路径线 | 当前几何采样折线；主色 |
| 控制多边形 | 虚线；控制点小圆 |
| 端点 | from/to 方块；`FREE` 时虚线连到几何起终点 |
| 采样点 | 可选；按 `u` 均匀分布 |
| 切线 | 可选；短箭头，示意方向 |
| `s(t)` | 独立小图；横轴 t，纵轴 s |
| 锚点徽标 | `FREE / START / ENDPOINTS` |
| 警告 | 端点偏差、未知类型、无端点、法向退化 |

- `FREE`：
  - 几何起点/终点与 `fromPoint/toPoint` 不同点时，画虚线并显示偏差距离。
  - 提示“移动端点帧只改绑定，不改形状”。
  - “按几何重算端点”按钮只对已提交条目开放；生成器草稿不显示。
- `START`：
  - 只画几何起点锚定；终点由参数决定。
  - `to` 端点显示为绑定点；偏差可见。
- `ENDPOINTS`：
  - 几何起终点必须等于 from/to；不画偏差。
- 未知类型/参数错误：不画曲线，显示错误卡片和字段路径。

## 采样与性能

- 采样点数按画布宽度自适应：`clamp(width/4, 64, 256)`。
- 形状缓存键：`geometry JSON + from + to + axes`；参数变则重算。
- 同一时间只预览一个选中条目；列表 100 条不做全量预览。
- 拖动参数时 30~60fps；重计算超过 16ms 时降采样到 64 点，松手后恢复。
- `clothoid` 数值积分缓存节点；参数不变不重算。
- 预览失败不影响文档；错误显示在画布下方。

## 与生成器

- 生成器向导预览直接用 `shapeMath` 的语义参数画圆/弧/椭圆，不先写临时 `paths[]`。
- 生成器预览显示：理想曲线、Bezier 分段控制多边形、端点、径向误差。
- 精确模式显示 `arc/ellipse` 的理想曲线；Bezier 模式显示分段折线和控制点。
- 生成后，路径面板预览用 `previewKernel` 重画实际写出的 geometry；两者应一致（Bezier 允许 `0.1%*r` 误差）。

## 真游戏检查

- 按钮“推送当前脚本”：调现有 `editor.pushScript`，把当前文档送到游戏。
- 按钮“定位起点 / 定位终点”：调现有 `editor.seek`，跳到 `from/to`。
- 游戏画面是最终手感检查；2D 预览不叠加到游戏画面，不声称与游戏像素对齐。
- 不新增运行时求值接口、不新增 WebEditorApi 消息、不读 Java 运行时对象。

## 组件

```text
src/components/path/preview/
  PathPreviewCanvas.vue
  PathPreviewToolbar.vue
  PathTimingMiniChart.vue
  PathAnchorNotice.vue
  PathPreviewLegend.vue
src/model/path/preview/
  previewKernel.ts
  previewProjection.ts
  previewCache.ts
  previewFixtures.test.ts
```

- `PathPreviewCanvas` 只画 `PathPreviewModel`，不读文档。
- `PathPreviewToolbar` 管采样点/切线/网格/适配视图；不改路径参数。
- `PathTimingMiniChart` 读 `timingCurve`；不画几何。
- `previewCache` 按条目/参数缓存，不跨文档复用错误结果。

## 验收

1. `linear` 路径：画直线；端点方块；控制多边形为空；`s(t)` 对角线。
2. `bezier`：画曲线 + 两个控制点 + 虚线多边形；端点等于 from/to。
3. `rational_bezier`：权重改变曲线；权重数量与点一致。
4. `arc` 半圆：采样点落在圆上；`u=0/.5/1` 与 fixture 一致；端点偏差可见。
5. `ellipse`：半轴/旋转正确；角度 0/90/180 点坐标正确。
6. `bspline` / `nurbs`：de Boor 采样与 fixture 一致；nurbs 权重影响形状。
7. `catmull_rom` 三种参数化：形状不同；tension 0/1 边界可画。
8. `hermite`：两端切线方向正确；切线长度影响形状。
9. `clothoid`：曲率 0→0 退化为直线；曲率非零时曲率渐变；fixture 偏差 <= tolerance。
10. `fourier` 周期：`u=0` 与 `u=1` 同点；非周期：端点参与。
11. 11 个 fixture 全部通过；任一类型偏差超限，构建失败并显示类型/采样点。
12. `FREE` 路径移动端点：形状不变，偏差数字更新；虚线连接端点与几何起终点。
13. `START` 路径：起点锚定；`to` 只显示绑定；移动 `to` 不改形状。
14. `axes=[x,z]`：只画 x/z 投影；y 覆盖轴不画；标题提示 2D 投影。
15. `axes=[x]`：切到单轴值/u 图；不画二维曲线。
16. 未知类型：不画曲线，显示字段错误；修好后恢复。
17. 100 条路径列表：只预览选中条目；拖动参数保持可用；无全量重算卡顿。
18. 生成器 Bezier 圆预览：4 段、闭合、径向误差 <= `0.1%*r`；切精确模式显示单条圆弧。
19. 游戏检查按钮调用现有 `pushScript/seek`；`WebEditorApi` 消息清单无新增。
20. 模组仓库 `.java` 0 改动；预览采样器只在编辑器 `src/model/path/preview`。
