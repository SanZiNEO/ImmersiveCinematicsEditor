# 07-07 圆形路径生成器

## 目标

做一个编辑器侧的 `PathShapeGenerator`：作者只输入目标片段、时间区间、圆心、半径、起止角、方向、平面和模式，编辑器算出路径，写出可直接播放的 `objects` 关键帧和 `paths[]` 条目。

两种模式：

1. **Bezier 分段**：用三次 Bézier 逼近圆弧，按不超过 90° 分段。
2. **精确数学**：圆/圆弧写 `arc`，椭圆写 `ellipse`；形状由几何参数精确决定。

生成器只写 `objects` / `paths`，不新增曲线类型，不修改 `PathCurveRegistry`、`PathEvaluator` 或任何模组代码。

## 输入

```ts
interface PathShapeGeneratorInput {
  clipKey: string
  from: number
  to: number
  shape: 'circle' | 'arc' | 'ellipse'
  center: PathPoint              // 当前 position 表达式空间
  radius?: number                // circle / arc
  semiMajor?: number             // ellipse
  semiMinor?: number             // ellipse
  rotation?: number              // ellipse，度
  startAngle: number             // 度
  endAngle: number               // 度
  direction: 'ccw' | 'cw'
  normal: Vector3                // 平面法向，默认 (0,1,0)
  referenceAxis: Vector3         // 参考轴，默认 (1,0,0)
  mode: 'bezier' | 'exact'
  segments?: number              // Bezier 分段数；空 = 自动
  timeStrategy: 'existing-nodes' | 'replace-range'
}
```

### 圆心坐标空间

`center` 必须在当前片段的 `position` 表达式空间里：

| 片段位置 | 圆心空间 | UI 轴标签 |
|---|---|---|
| `absolute` | 世界坐标 | `x / y / z` |
| `relative + world` | 相对原点偏移 | `x / y / z`（相对原点） |
| `relative + base` | 局部坐标 | `fwd / up / right` |

- `relative + world` 且原点是 `coordinate`：允许切“世界坐标”输入，编辑器减去原点后写片段坐标。
- 原点是 player/selector/block/structure 等动态源：只接受片段坐标，不猜世界原点。
- `base`：只接受 `fwd/up/right` 分量，不提供世界坐标切换。
- 路径几何和位置关键帧都写同一表达式空间分量，运行时由 `PositionEvaluator` 统一加原点/参考系。

### 角度与方向

```text
delta = endAngle - startAngle
direction=ccw 且 delta < 0 → delta = -delta
direction=cw  且 delta > 0 → delta = -delta
delta == 0 → 拒绝
|delta| > 360 → 拒绝
```

- 全圆用 `startAngle=0, endAngle=360`；顺时针用方向开关把 `delta` 变成 `-360`。
- 起止角是弧度制内部计算，UI 显示度。
- `delta` 的符号决定圆周方向；`normal` 决定平面朝向。

### 平面基

```text
n = normalize(normal)
u = normalize(referenceAxis - n * dot(referenceAxis, n))
v = normalize(cross(n, u))
P(θ) = C + r * (cosθ * u + sinθ * v)
T(θ) = r * (-sinθ * u + cosθ * v)
```

- `normal` 与 `referenceAxis` 不能平行；投影后 `u` 长度接近 0 时拒绝。
- `T(θ)` 是 `P(θ)` 对 θ 的导数；顺时针由 `k` 的负号处理，不再额外乘方向符号。
- `normal` 默认 `(0,1,0)`，`referenceAxis` 默认 `(1,0,0)`：水平面圆，从上方看逆时针。
- `P(θ)` 的三个分量直接写 `position.x/y/z`；`base` 空间下就是 `fwd/up/right`。

## 时间分段

### `existing-nodes`

- 读取目标片段 `position.x/y/z` 节点时间并集，截取 `[from,to]`。
- 起止节点必须存在；区间内已有节点全部作为分段边界。
- 保留作者已有时间节奏；生成器只重写这些时间点的位置值。
- 每两个相邻节点生成一条路径条目。
- 区间内节点不足 2 个时，补 `from` / `to` 两个边界键。

### `replace-range`

- 删除 `(from,to)` 内的位置关键帧；保留 `from` / `to` 边界。
- Bezier 模式按 `segments` 或自动段数重建时间：
  - 自动 `n = ceil(|delta| / 90)`；
  - 作者可填 2~16；
  - 时间 `t_i = from + (to-from) * i/n`。
- 精确模式：
  - 整圆/圆弧默认一条 `arc`，只保留 `from/to`；
  - 椭圆一条 `ellipse`；
  - 作者勾“按 90° 分段”时，`n = ceil(|delta|/90)`，每段一条 `arc/ellipse`。
- 删除区间内节点前，扫描所有引用这些节点的路径；有引用则列出并阻止，提供“删除这些路径并继续 / 取消”。

## Bezier 分段

每段角度：

```text
deltaSeg = delta / n
k = (4/3) * tan(deltaSeg / 4) * r
P0 = P(θ0)
P3 = P(θ1)
P1 = P0 + k * T(θ0)
P2 = P3 - k * T(θ1)
```

- `P1/P2` 写成相对段起点 `P0` 的 `{dx,dy,dz}`。
- 每段 `geometry={type:'bezier', control_points:[P1rel,P2rel]}`。
- `bezier` 是 `ENDPOINTS`：`from/to` 端点参与形状。
- 90° 分段是标准近似；`k=0.5522847498*r`。
- 非 90° 段用上面的通用公式，不硬编码 `0.552`。
- 自动段数保证每段 `|deltaSeg| <= 90°`；`|delta| <= 360`。
- 半径/半轴在生成前校验 > 0；退化半径拒绝。

### 误差

- 每段 Bézier 与理想圆弧的径向误差在 90° 段约 `0.027% * r`。
- 预览/验收允许 `0.1% * r` 的采样偏差；超过则提示“分段不足”，建议增加段数。
- 全圆 4 段闭合：最后一段终点必须等于第一段起点；端点键 `to` 与 `from` 值相同。

## 精确数学

### 圆 / 圆弧 `arc`

```json
{
  "type": "arc",
  "center": { "dx": 0, "dy": 0, "dz": 0 },
  "radius": 4.0,
  "start_angle": 0.0,
  "end_angle": 360.0,
  "normal": { "x": 0, "y": 1, "z": 0 },
  "reference_axis": { "x": 1, "y": 0, "z": 0 }
}
```

- `center` 默认相对段起点 `P0`：`C - P0`；避免依赖未知世界原点。
- 每段 `start_angle/end_angle` 用该段的 θ0/θ1；全圆一条 360°。
- `arc` 是 `FREE`：端点只用于绑定；移动端点帧不改圆弧形状。
- 生成器仍会把 `from/to` 位置键写到圆周上，接缝一致。
- 全圆 `start/end` 落在同一点；`from/to` 是不同时间，合法。

### 椭圆 `ellipse`

```json
{
  "type": "ellipse",
  "center": { "dx": 0, "dy": 0, "dz": 0 },
  "semi_major": 6.0,
  "semi_minor": 3.0,
  "rotation": 0.0,
  "start_angle": 0.0,
  "end_angle": 360.0,
  "normal": { "x": 0, "y": 1, "z": 0 },
  "reference_axis": { "x": 1, "y": 0, "z": 0 }
}
```

- `semi_major/semi_minor > 0`；`rotation` 度。
- 角度是参数角，不是弧长角；与 `arc` 的 `start_angle` 语义分开显示。
- `ellipse` 是 `FREE`；端点只用于绑定。

## 输出

生成器一次写三类内容：

1. `position.x/y/z` 在分段边界的关键帧。
2. `paths[]` 每段一条，`clip/from/to/axes/geometry/timing` 完整。
3. 生成器自己的诊断/预览草稿，不写盘。

### 位置关键帧

- 每个边界时间 `t_i` 写 `position.x`、`position.y`、`position.z` 三条独立帧。
- 值 = `P(θ_i)` 在该表达式空间的分量。
- `mode=animated`；不创建组、不写 `authoring`。
- 时间用同一个数值，精确相等；不四舍五入。
- 若某轴已有同刻帧：覆盖值；没有则创建。
- `position_mode/space/origin` 不因生成而改变；只在 UI 显示当前空间标签。

### 路径条目

```ts
{
  id: `p_gen_${n}`,
  clip: clipKey,
  from: t_i,
  to: t_{i+1},
  axes: ['x','y','z'],
  geometry: bezier | arc | ellipse,
  timing: { type: 'linear' }
}
```

- 默认 `axes` 三轴；生成器按三轴写位置键。
- `timing=linear`；作者生成后可改 07-08。
- 每条路径都是普通条目；可手改几何、端点、axes、timing。
- ID 全局唯一；重新生成时按 diff 替换，不复用已删除 ID。

## 重新生成与 diff

```ts
interface ShapeGeneratorDiff {
  newPaths: PathEntryDoc[]
  replacedPaths: PathEntryDoc[]
  deletedPaths: PathEntryDoc[]
  newFrameTimes: number[]
  removedFrameTimes: number[]
  impactedPaths: PathEntryDoc[]   // 引用被删节点/重叠区间的其他路径
  radialError?: number
}
```

- 入口：路径面板“生成圆形路径”，或已有生成结果的“重新生成”。
- 范围：目标片段 + `[from,to]` + 重叠条目。
- 预览先显示 diff：新增 N 条、替换 M 条、删除 K 条、影响其他路径 J 条。
- 若 `impactedPaths` 非空：列出路径；要求“删除这些路径 / 取消”，不静默改别人的路径。
- `existing-nodes` 保留区间内节点；只替换同片段、同时间区间的生成条目。
- `replace-range` 删除区间内位置键；引用这些键的路径进入 `impactedPaths`。
- 确认后一次 `commit`；一次撤销恢复路径、关键帧、ID 和选择。
- 应用后跑 `script.validate`；block/error 时展开问题，提供“撤销本次生成”。

## 生成器界面

```text
生成圆形路径
  目标片段   [shot_a ▼]   时间 [0.000] → [3.000]
  形状       (•) 圆  ( ) 圆弧  ( ) 椭圆
  圆心空间   相对原点 (x,y,z)
  圆心       [ 0 ] [ 64 ] [ 0 ]
  半径/半轴  [ 4.0 ]   [ 6.0 ] [ 3.0 ]  旋转 [0]°
  起止角     [0]° → [360]°   方向 (•) 逆时针 ( ) 顺时针
  平面       法向 [0,1,0]   参考轴 [1,0,0]
  模式       (•) Bezier 分段   ( ) 精确数学
  分段       [自动 4]（Bezier 可改 2~16）
  时间策略   (•) 按现有节点  ( ) 替换区间节点
  [预览]  [生成]
```

- “圆心空间”只读显示，随片段 `position` 模式/空间变化。
- 半径/半轴输入按形状切换；不相关字段隐藏。
- 预览直接用生成器公式画圆/弧/椭圆、控制多边形、端点和采样点；不依赖运行时。
- 生成后选中第一条路径，播放头跳到 `from`；路径面板和属性/效果面板同步显示新键。
- 撤销生成后选择回到生成前；不残留临时 ID。

## 组件

```text
src/components/path/generator/
  PathShapeGeneratorDialog.vue
  ShapeKindField.vue
  ShapeCenterField.vue
  ShapePlaneField.vue
  ShapeModeField.vue
  ShapeTimeStrategyField.vue
  ShapeDiffPreview.vue
src/model/path/generator/
  shapeGenerator.ts       输入校验/角度/分段/时间策略
  shapeMath.ts            P(θ)/T(θ)/Bezier 控制点/精确参数
  shapeOutput.ts          位置键 + paths 条目
  shapeDiff.ts            重叠/引用/新增/删除/影响
```

- `shapeMath.ts` 是纯函数；输入语义参数，输出点/切线/几何参数。
- `shapeOutput.ts` 不直接 commit；生成 `EditorCommand`。
- `shapeDiff.ts` 只读文档，不修改；`impactedPaths` 由 07-05 的引用扫描提供。
- 生成器不 import 运行时 Java 代码，不调用运行时采样接口。

## 验收

1. 水平面 `(0,1,0)`、参考轴 `(1,0,0)`、半径 4、`0→90`、逆时针、Bezier 自动 1 段：生成 1 条 `bezier`，两个控制点长度约 `0.5523*4`，端点落在圆上。
2. 同样参数 `0→360`：自动 4 段；生成 4 条 `bezier`；4 段闭合；径向采样误差 <= `0.1%*4`；`from/to` 端点相邻。
3. 同上但精确模式：生成 1 条 `arc`，`center` 相对 from，`radius=4`，`start=0`，`end=360`；`script.validate` 通过。
4. 顺时针 `0→360`：`delta=-360`；Bezier 控制点方向反向；精确 `arc` 的 `start/end` 写 `0/-360` 或等价；运行时顺时针。
5. 3D 平面：法向 `(0,0,1)`、参考轴 `(1,0,0)`、`0→180`；生成半圆，位置 y 恒定，x/z 正确。
6. `replace-range` 全圆 Bezier 4 段：区间内旧位置键删除；4 个边界时间建三轴键；4 条路径。
7. `existing-nodes`：区间内已有 `0,1,2,3` 四个节点；生成 3 条路径；节点时间不改；每段几何按对应角度。
8. 区间内已有其他路径端点：`impactedPaths` 列出；选取消文档不变；选删除则其他路径消失、生成继续。
9. 重新生成同一范围：diff 显示替换的 4 条旧路径；应用后旧 ID 不再存在，新 ID 唯一；一次撤销恢复旧路径和旧键。
10. 半径 0 / 半轴 0 / 起止角相等 / `|delta|>360` / 法向与参考轴平行：本地 block，生成按钮禁用。
11. `relative + world` 且原点是 coordinate：世界坐标圆心输入减去原点后写片段坐标；预览位置正确。
12. `relative + base`：圆心按 `fwd/up/right` 输入；生成后三轴键是该局部坐标分量；不写世界坐标。
13. 精确模式生成后移动 `from` 端点键：圆弧形状不变，偏差徽标出现；“按几何重算端点”可把端点拉回圆周。
14. 生成器应用后 `script.validate` 通过；模组仓库 `.java` 0 改动；`WebEditorApi` 无新消息。
15. 一次撤销：位置键、路径条目、ID、选择、diff 全部回到生成前。
