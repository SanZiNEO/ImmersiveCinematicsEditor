# 07-06 路径几何表单

## 目标

把 `curveTypes` 的 11 种几何做成受 `schema.curveTypes` 驱动的参数表单：作者选类型后，只看到该类型的参数、控制点、默认值和错误提示。保存时 `geometry.type` 与参数必须能被 `PathCurveRegistry.create` 接受。

表单不自己维护第二份“类型 → 参数”硬编码表；字段名、形态、默认值、能力从 02 字段目录读取。本文只登记必须实现的参数语义和控件行为。

## 类型目录

| 类型 | 参数 | 锚点 | 能力 |
|---|---|---|---|
| `linear` | 无 | ENDPOINTS | — |
| `bezier` | `control_points` 恰好 2 个内部控制点 | ENDPOINTS | 二阶导 |
| `rational_bezier` | `control_points` 1~2 个内部控制点；`weights` 同长度 | ENDPOINTS | 二阶导、权重 |
| `arc` | `center` / `radius` / `start_angle` / `end_angle` / `normal?` / `reference_axis?` | FREE | 解析弧长、二阶导 |
| `ellipse` | `center` / `semi_major` / `semi_minor` / `rotation` / `start_angle` / `end_angle` / `normal?` / `reference_axis?` | FREE | 二阶导 |
| `bspline` | `control_points` / `degree` / `knots?` | ENDPOINTS | 二阶导、节点向量 |
| `nurbs` | `control_points` / `weights` / `degree` / `knots?` | ENDPOINTS | 二阶导、权重、节点向量 |
| `catmull_rom` | `points` / `parameterization` / `tension` / `endpoint` | ENDPOINTS | 二阶导 |
| `hermite` | `tangents` 恰好 2 个 | ENDPOINTS | 二阶导 |
| `clothoid` | `start_curvature` / `end_curvature` / `length` / `start_direction?` / `normal?` | START | 解析弧长、二阶导 |
| `fourier` | `a0` / `cos?` / `sin?` / `period` / `periodic` / `start_velocity?` / `end_velocity?` | 周期时 FREE；非周期 ENDPOINTS | 二阶导、周期 |

`line` 是 `linear` 的解析别名：`geometry={type:'line'}` 只允许 `type`，不写其他参数；表单显示“线性（line 别名）”。新建路径默认 `line`；已有 `line` 不自动改写成 `linear`，作者切到 `linear` 时写 `linear`。

## 类型选择

```text
[类型 ▼]
line / linear / bezier / rational_bezier / arc / ellipse /
bspline / nurbs / catmull_rom / hermite / clothoid / fourier
```

- 类型下拉来自 `schema.curveTypes`，`line` 单独置顶作为别名项。
- 切换类型时清空旧类型参数，保留 `type` 和公共字段（`id/clip/from/to/axes`）。
- 切换前弹确认“将重置几何参数”；一次撤销恢复旧参数。
- 类型为空或未知：本地 block，不写本地默认。
- `geometry.type` 必填；不写 type 直接 block，不依赖运行期默认。

## 参数控件

| `PathParamKind` | 控件 |
|---|---|
| `NUMBER` | 数值输入 + 单位/角度提示；`NaN`/无穷拒绝 |
| `INTEGER` | 整数步进；越界拒绝 |
| `BOOLEAN` | 开关 |
| `ENUM` | 下拉，选项来自 schema |
| `TEXT` | 文本输入；结构/方块 id 走专用校验 |
| `POINT` | 坐标三轴 + 绝对/相对切换 |
| `POINT_LIST` | 可增删/排序的控制点行 |
| `NUMBER_LIST` | 数值行；显示数量与期望 |
| `VECTOR` | 三轴向量；只支持绝对分量 |

### POINT

`PathPoint` 只接受两种写法之一：

```json
{ "x": 1, "y": 2, "z": 3 }
{ "dx": 1, "dy": 2, "dz": 3 }
```

- 绝对：`x/y/z` 相对路径表达式空间原点。
- 相对：`dx/dy/dz` 相对段起点 `from`。
- 同一对象不能混写 `x` 与 `dx`；切换时清空另一组。
- UI 标签“绝对坐标 / 相对起点”；`arc.center` 默认相对起点，避免依赖未知原点。
- `VECTOR` 不支持相对，只有 `x/y/z`。

### POINT_LIST

- 行号、点、删除、上移/下移。
- 最少/恰好数量由类型决定：`bezier` 恰好 2；`hermite.tangents` 恰好 2；`rational_bezier` 1~2；`bspline/nurbs/catmull_rom/fourier.cos/sin` 至少 2。
- 不足/超出时行内错误，不写盘。
- 每个点独立选择绝对/相对，不强制整列一致。

### NUMBER_LIST

- `weights`：数量必须与 `control_points` 对齐；每个 > 0。
- `knots`：数量 = 总控制点数（内部控制点 + 2 个端点）+ `degree` + 1；为空时由注册表生成默认节点向量。
- `cos` / `sin`：数量相等；与 `period` 一起校验。
- 列表编辑器显示“当前 N / 期望 M”，不静默截断。

## 参数语义

### `arc`

- `center`：POINT；绝对值是表达式空间坐标，相对值是相对段起点。
- `radius > 0`。
- `start_angle` / `end_angle`：度；`|end-start| > 0` 且 `<= 360`。
- `normal` / `reference_axis`：VECTOR；不能平行；默认来自 `ArcPathSpec` 常量。
- 锚点 `FREE`：形状完全由参数决定，端点只用于绑定。
- 内部按 `ceil(|Δ|/90)` 段有理二次 Bézier 展开，是精确圆弧。
- 表单显示“精确圆弧；移动端点帧只改绑定，不改形状”。

### `ellipse`

- `semi_major > 0`、`semi_minor > 0`。
- `rotation`：度；`start_angle` / `end_angle`：参数角，允许跨 0。
- `normal` / `reference_axis`：不能平行。
- 锚点 `FREE`：端点只用于绑定。

### `bspline` / `nurbs`

- `control_points`：内部点，至少 2；显示时额外标出两个端点。
- `degree`：1 ~ 总控制点数 - 1；默认 3，点不足时表单提示降低 degree。
- `knots` 为空 → 注册表生成；填写时长度必须匹配。
- `nurbs.weights` 数量 = 内部控制点数；`rational_bezier.weights` 同。
- 锚点 `ENDPOINTS`：端点参与形状。

### `catmull_rom`

- `points`：内部点，至少 2。
- `parameterization`：`uniform` / `chordal` / `centripetal`，默认 `centripetal`。
- `tension`：0~1，默认 1.0。
- `endpoint`：`mirror` / `clamp`，默认 `mirror`。

### `hermite`

- `tangents`：恰好 2 个，对应两端切线。
- 切点可绝对/相对；相对段起点。
- 锚点 `ENDPOINTS`。

### `clothoid`

- `start_curvature` / `end_curvature`：任意有限数；可以同号、异号、为零。
- `length > 0`。
- `start_direction` / `normal`：VECTOR；不能平行。
- 锚点 `START`：只从 `from` 起算，终点由曲线决定；`to` 只用于绑定/时间，不控制形状。
- 表单显示“起点锚定；终点由曲率/长度决定”。

### `fourier`

- `period > 0`。
- `cos` / `sin` 数量相等；为空时可为纯 `a0`。
- `periodic=true`：锚点 `FREE`，端点忽略；`start_velocity/end_velocity` 仍可写。
- `periodic=false`：锚点 `ENDPOINTS`；`a0` 必须零向量；端点和速度参与。
- 表单显示“周期闭合 / 非周期端点”状态。

## 锚点提示

| 锚点 | 类型 | 端点行为 |
|---|---|---|
| `FREE` | `arc`、`ellipse`、周期 `fourier` | 端点只用于绑定；移动端点不改形状 |
| `START` | `clothoid` | 只固定起点；终点由参数决定 |
| `ENDPOINTS` | 其余 | 端点参与形状；移动端点会改形状 |

- 路径面板与几何表单都显示锚点徽标。
- `FREE` 路径在端点位置与几何起终点不一致时显示偏差值；提供“按几何重算端点”按钮（只改位置帧，不改几何）。
- `START` 路径的 `to` 不参与形状；不显示“控制点”误导。
- `ENDPOINTS` 路径要求端点存在；不提供“忽略端点”开关。

## 表单布局

```text
几何
  [类型 ▼]
  arc
  圆心        [绝对 ▼] [x] [y] [z]
  半径        [ 4.0 ]
  起始角      [ 0 ] °    结束角 [ 180 ] °
  法向        [0,1,0]     参考轴 [1,0,0]
  锚点 FREE · 精确圆弧
  [在路径中预览]
```

- 参数按 schema 顺序排列；`POINT` / `POINT_LIST` 占整行。
- 错误吸附到具体字段；顶部只显示“N 个字段需要修复”。
- 切换 `axes` 不影响几何参数；几何在三维空间定义，显示时按 axes 投影。
- “在路径中预览”把当前草稿交给 07-10，不提交文档。

## 组件

```text
src/components/path/geometry/
  PathGeometryForm.vue
  PathTypeSelect.vue
  PathPointField.vue
  PathPointListEditor.vue
  PathNumberListEditor.vue
  PathVectorField.vue
  PathAnchorBadge.vue
src/model/path/geometry/
  geometryCatalog.ts      从 schema.curveTypes 派生表单描述
  geometryDraft.ts        类型切换/参数清空/草稿校验
  pathPoint.ts            绝对/相对点读写
```

- `geometryCatalog.ts` 只读 schema，不手写参数名。
- `geometryDraft.ts` 不依赖 Vue；输出 `PathGeometry` 或字段错误。
- `PathGeometryForm` 不直接写文档；父级 `PathEntryEditor` 统一提交。

## 验收

1. 类型下拉列出 11 种 + `line` 别名；选 `line` 只写 `{type:'line'}`，加其他参数 block。
2. 选 `bezier`：控制点行恰好 2；少于/多于 2 block。
3. 选 `rational_bezier`：控制点 1~2，weights 同长度；weights 少一项 block。
4. 选 `arc`：圆心/半径/起止角/法向/参考轴齐全；`end=start` block；`|Δ|>360` block；法向与参考轴平行 block。
5. 选 `ellipse`：半长轴/半短轴 <=0 block；rotation 0 正常；起止角可跨 0。
6. 选 `bspline`：3 个内部点 + degree 4 时提示降 degree；degree 1~总点数-1 可保存。
7. 选 `nurbs`：weights 数量与控制点不一致 block；knots 长度不匹配 block；空 knots 保存成功。
8. 选 `catmull_rom`：参数化三选一；tension 0/1 边界可用；2.0 block。
9. 选 `hermite`：切线恰好 2；相对/绝对混写 block。
10. 选 `clothoid`：length 0 block；终点 `to` 仍可绑定；锚点显示 START。
11. 选 `fourier`：periodic=true 时锚点 FREE；periodic=false 且 a0 非零 block；cos/sin 数量不等 block。
12. 切换类型：旧参数清空；确认后一次撤销恢复；文档没有残留旧参数。
13. 未知 type / 未知参数：本地 block；展开显示路径与参数名。
14. `POINT` 写 `{x,y,z}` 或 `{dx,dy,dz}`；混写 `x` 与 `dx` 被拒。
15. `arc` 端点移动：形状不变，偏差值更新；“按几何重算端点”只改位置帧。
16. 保存重开：11 种几何参数原样保留；`line` 仍是 `line`；没有自动补 `control_points`。
