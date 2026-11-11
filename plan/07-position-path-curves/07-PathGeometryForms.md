# 07-PathGeometryForms：注册几何参数表单

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：02-SchemaSnapshot（`curveTypes` 段）、07-PathCollectionEditor（条目）
> 下游：07-PathTimingEditor、07-CurvePathPreview
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

`paths[].geometry` 的编辑表单。几何类型与参数**全部来自 `schema.get` 的 `curveTypes`**（由 `PathCurveRegistry` 注册表导出），编辑器不硬编码参数名。

本文件给出 11 种已注册类型的**精确参数表、默认值、能力标记、构造期校验**，以及必须向作者显示的三个陷阱：端点被忽略（FREE 锚点）、控制点参考空间、2 轴不承诺 3D 匀速。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| 注册表是"JSON `curve` → 路径定义"的唯一入口；未知类型/未知参数/类型不符/必填缺失一律报错 | `J:script/schema/PathCurveRegistry.java — create（267–305）` |
| `type` 缺失时取 `DEFAULT_TYPE="bezier"`，但 `paths[].geometry.type` 是必填 | `DEFAULT_TYPE（48）`；`J:script/path/PathCollectionParser.parseGeometry（244–246）` |
| `line` 是 `linear` 的别名，只接受 `type` | `PathCollectionParser.LINE_TYPE（51）`、`parseGeometry（251–258）` |
| 控制点必须恰好 `{x,y,z}`（绝对）或恰好 `{dx,dy,dz}`（相对段起点） | `PathCurveRegistry.readPoint（408–425）` |
| 向量参数只接受 `{x,y,z}`（无相对形态） | `readVector（452–460）` |
| 已注册 11 种：linear / bezier / rational_bezier / arc / ellipse / bspline / nurbs / catmull_rom / hermite / clothoid / fourier | `static 块（62–218）` |
| 能力标记：`ANALYTIC_ARC_LENGTH` / `ANALYTIC_SECOND_DERIVATIVE` / `PERIODIC` / `RATIONAL_WEIGHTS` / `KNOT_VECTOR` | `J:spi/PathCapability.java（7–22）`；导出 `SchemaExporter（105–109）` |
| 锚点：`arc`/`ellipse` 为 `FREE`，`clothoid` 为 `START`，`fourier` 周期形态 `FREE`/非周期 `ENDPOINTS`，其余 `ENDPOINTS` | 各 Spec 的 `anchor()`：`ArcPathSpec 84`、`EllipsePathSpec 92`、`ClothoidPathSpec 112`、`FourierPathSpec 133`、`LinearPathSpec 30`、`BezierPathSpec 49`、`RationalBezierPathSpec 83`、`BSplinePathSpec 127`、`NurbsPathSpec 161`、`CatmullRomPathSpec 159`、`HermitePathSpec 76` |
| 编辑器旧控件只支持一组控制点 | `EDITOR:src/components/fields/BezierCurveField.vue` |

### 2.2 目标

1. 类型下拉 = `curveTypes` 的键 + `line`（别名在前，`SchemaExporter.geometryTypeNames 314–321`）。
2. 参数表单按 `curveTypes.<type>.params` 渲染：`kind` 决定控件，`default`/`required`/`enumValues`/`doc` 直接消费。
3. 必填缺失、类型不符在本地拦截（与 `PathCurveRegistry.create` 同口径）。
4. 显示能力标记（如"支持解析弧长"），供作者判断预览精度。
5. 显示锚点警告：`FREE` 类型忽略端点 → 路径起止点可能与关键帧位置不连续。

### 2.3 非目标

- 不实现几何求值/弧长（运行时 `PathEvaluator` / `ArcLengthTable`）。
- 不做控制点拖拽（07-CurvePathPreview 只做只读示意 + 数值编辑）。
- 不新增几何类型（注册表变更属主模组）。

## 三、方案

### 3.1 11 种几何的精确参数表

> 所有 `POINT`/`POINT_LIST` 元素都是 `{x,y,z}` 或 `{dx,dy,dz}`；`VECTOR` 只接受 `{x,y,z}`。
> "能力"列对应 `PathCapability`；"锚点"列决定端点是否参与。

#### 1) `line`（`linear` 的别名）
| 参数 | 类型 | 必填 | 默认 |
|---|---|---|---|
| — | — | — | — |

能力：无（`register("linear", Set.of(), List.of(), ...)`，`63`）。锚点：`ENDPOINTS`（`LinearPathSpec 30`）。域：`[0,1]`（`PathDomain.UNIT`）。

#### 2) `linear`（注册表名；与 `line` 等价，但 `paths[]` 建议写 `line`）
同上。**注意**：`PathCollectionParser` 把 `line` 特判成 `LinearPathSpec.INSTANCE`（`251–258`）；写 `linear` 会走 `PathCurveRegistry.create`，参数为空，等价。

#### 3) `bezier`
| 参数 | kind | 必填 | 说明 |
|---|---|---|---|
| `control_points` | `POINT_LIST` | 是 | **恰好 2 个**内部控制点（P1、P2） |

能力：`ANALYTIC_SECOND_DERIVATIVE`（`64`）。锚点：`ENDPOINTS`（`BezierPathSpec 49`）。域：`[0,1]`。
构造校验：`BezierPathSpec（20–35）` 要求恰好 2 个，元素非 null。

#### 4) `rational_bezier`
| 参数 | kind | 必填 | 说明 |
|---|---|---|---|
| `control_points` | `POINT_LIST` | 是 | 1 个 = 二次，2 个 = 三次 |
| `weights` | `NUMBER_LIST` | 是 | 与 `control_points` 等长，每项有限正数；端点权重恒为 1 |

能力：`ANALYTIC_SECOND_DERIVATIVE`（`68`）。锚点：`ENDPOINTS`（`83`）。域：`[0,1]`。
构造校验：`RationalBezierPathSpec（39–69）`：数量 1 或 2、长度一致、权重 > 0。

#### 5) `arc`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `center` | `POINT` | 是 | — | 圆心；相对段起点 `dx/dy/dz` 或绝对 `x/y/z` |
| `radius` | `NUMBER` | 是 | — | 有限正数 |
| `start_angle` | `NUMBER` | 是 | — | 度 |
| `end_angle` | `NUMBER` | 是 | — | 度；跨度非零且 `|Δ| <= 360` |
| `normal` | `VECTOR` | 否 | `(0,1,0)` | 平面法向；不得与 `reference_axis` 平行 |
| `reference_axis` | `VECTOR` | 否 | `(1,0,0)` | 起始角 0 的方向 |

能力：`ANALYTIC_ARC_LENGTH` + `ANALYTIC_SECOND_DERIVATIVE`（`75–76`）。锚点：**`FREE`**（`ArcPathSpec 84`）。域：`[0,1]`。
构造校验：`ConicSegmentBuilder（99–133）`：半径正、角度有限、`sweep != 0`、`|sweep| <= 360`、法向与参考轴不平行。

#### 6) `ellipse`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `center` | `POINT` | 是 | — | 同上 |
| `semi_major` | `NUMBER` | 是 | — | 有限正数 |
| `semi_minor` | `NUMBER` | 是 | — | 有限正数 |
| `rotation` | `NUMBER` | 否 | `0.0` | 度 |
| `start_angle` | `NUMBER` | 是 | — | **参数角**（单位圆参数角，不是几何极角） |
| `end_angle` | `NUMBER` | 是 | — | 同上；跨度约束同 arc |
| `normal` | `VECTOR` | 否 | `(0,1,0)` | — |
| `reference_axis` | `VECTOR` | 否 | `(1,0,0)` | — |

能力：`ANALYTIC_SECOND_DERIVATIVE`（`97`）。锚点：**`FREE`**（`92`）。域：`[0,1]`。

#### 7) `bspline`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `control_points` | `POINT_LIST` | 是 | — | 内部控制点（不含端点） |
| `degree` | `INTEGER` | 否 | `3` | `1 ~ 控制点数-1`（控制点数含端点 = 内部数 + 2） |
| `knots` | `NUMBER_LIST` | 否 | — | 长度 = 控制点数 + 次数 + 1；非减；跨度正；缺省钳制均匀 |

能力：`ANALYTIC_SECOND_DERIVATIVE` + `KNOT_VECTOR`（`124`）。锚点：`ENDPOINTS`（`127`）。域：`[knots[degree], knots[controlCount]]`（`BSplinePathSpec 73`）。
构造校验：`BSplinePathSpec（51–75）`：控制点数 ≥2、次数范围、节点长度/单调（`checkedKnots`）。

#### 8) `nurbs`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `control_points` | `POINT_LIST` | 是 | — | 内部控制点 |
| `weights` | `NUMBER_LIST` | 是 | — | 与内部点等长；端点权重恒 1 |
| `degree` | `INTEGER` | 否 | `3` | 同 bspline |
| `knots` | `NUMBER_LIST` | 否 | — | 同 bspline |

能力：`ANALYTIC_SECOND_DERIVATIVE` + `RATIONAL_WEIGHTS` + `KNOT_VECTOR`（`138–139`）。锚点：`ENDPOINTS`（`161`）。

#### 9) `catmull_rom`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `points` | `POINT_LIST` | 是 | — | 内部过点（不含端点） |
| `parameterization` | `ENUM` | 否 | `centripetal` | `uniform` / `chordal` / `centripetal` |
| `tension` | `NUMBER` | 否 | `1.0` | `0 ~ 1`；乘在 Barry–Goldman 切线上 |
| `endpoint` | `ENUM` | 否 | `mirror` | `mirror` / `clamp` |

能力：`ANALYTIC_SECOND_DERIVATIVE`（`155`）。锚点：`ENDPOINTS`（`159`）。

#### 10) `hermite`
| 参数 | kind | 必填 | 说明 |
|---|---|---|---|
| `tangents` | `POINT_LIST` | 是 | **恰好 2 个**：`[首端切线, 末端切线]`；relative 形态 = 从各自端点出发的方向向量 |

能力：`ANALYTIC_SECOND_DERIVATIVE`（`171`）。锚点：`ENDPOINTS`（`76`）。
构造校验：`HermitePathSpec.fromTangents（53–62）` 要求恰好 2 个。

#### 11) `clothoid`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `start_curvature` | `NUMBER` | 是 | — | 1/方块，负值 = 反向 |
| `end_curvature` | `NUMBER` | 是 | — | 1/方块 |
| `length` | `NUMBER` | 是 | — | 弧长（方块），> 0 |
| `start_direction` | `VECTOR` | 否 | `(1,0,0)` | 世界轴；不得与 `normal` 平行 |
| `normal` | `VECTOR` | 否 | `(0,1,0)` | 过渡平面法向 |

能力：`ANALYTIC_ARC_LENGTH` + `ANALYTIC_SECOND_DERIVATIVE`（`175–176`）。锚点：**`START`**（`112`）——只用 `from`，终点由曲线自身决定。
构造校验：`ClothoidPathSpec（74–98）`：曲率有限、长度 > 0、方向/法向单位化后叉积不退化。

#### 12) `fourier`
| 参数 | kind | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `a0` | `VECTOR` | 否 | `(0,0,0)` | 常数项；**非周期形态必须为 0** |
| `cos` | `POINT_LIST` | 否 | — | 余弦系数（偏移量；`{dx,dy,dz}` 与 `{x,y,z}` 数值等价） |
| `sin` | `POINT_LIST` | 否 | — | 正弦系数，**必须与 `cos` 等长** |
| `period` | `NUMBER` | 是 | — | 参数周期 `T`，> 0 |
| `periodic` | `BOOLEAN` | 否 | `true` | `true` = 周期级数（忽略端点）；`false` = 三次趋势 + 受约束残差 |
| `start_velocity` | `VECTOR` | 否 | `(0,0,0)` | 仅 `periodic=false` |
| `end_velocity` | `VECTOR` | 否 | `(0,0,0)` | 仅 `periodic=false` |

能力：`ANALYTIC_SECOND_DERIVATIVE` + `PERIODIC`（`195`）。锚点：`periodic ? FREE : ENDPOINTS`（`133`）。域：`[0, period]`（`FourierPathSpec 119`）。
构造校验：`FourierPathSpec（73–120）`：`cos`/`sin` 等长、`period > 0`、非周期时 `a0 == 0`、向量有限。

### 3.2 锚点警告（必须显示）

| 锚点 | 类型 | 含义 | UI 提示 |
|---|---|---|---|
| `ENDPOINTS` | linear/bezier/rational_bezier/bspline/nurbs/catmull_rom/hermite；fourier(非周期) | 首末点 = 关键帧端点 | 无 |
| `START` | clothoid | 起点 = `from`，终点由曲线决定 | **"终点由曲线决定，可能不落在 to 位置"** |
| `FREE` | arc/ellipse；fourier(周期) | 完全忽略端点 | **"该几何忽略端点：路径起止点可能与关键帧位置不连续（跳变）"** |

这不是假设：`PathEvaluator.position(spec, from, to, s)` 对 FREE 锚点的 `bind` 不使用 `from`/`to`（`PathSpec.bind` 注释 24；各 Spec 的 `bind`）。而 `ObjectCameraEvaluator.positionSpec（324–336）` 在整个 `[startTime, endTime]` 区间用路径值覆盖选中轴，包括 `t == endTime`。因此 FREE 几何在段末会与下一段的起始采样值不一致。

编辑器**不禁止**这类几何（运行时可播），但必须：

1. 在几何选择处显示该警告。
2. 在 07-CurvePathPreview 里画出"路径端点 vs 关键帧端点"的偏差。
3. 在 07-PathCollectionEditor 的列表上给该条目一个 ⚠ 标记。

### 3.3 参数控件映射

| `PathParamKind` | 控件 | 校验 |
|---|---|---|
| `NUMBER` | 数字（`CommitNumberField`） | 有限 |
| `INTEGER` | 整数 | `2`/`2.0` 接受，`2.5` 拒绝（`readInteger 373–382`） |
| `BOOLEAN` | 开关 | 布尔 |
| `ENUM` | 下拉（`enumValues`） | 在列表内（`readEnum 391–398`） |
| `TEXT` | 文本 | 字符串 |
| `POINT` | 三分量 + 绝对/相对切换 | 恰好 `{x,y,z}` 或 `{dx,dy,dz}`（`readPoint 408–425`） |
| `POINT_LIST` | 列表（可增删项），每项同上 | 每项同上 |
| `NUMBER_LIST` | 数字列表 | 有限 |
| `VECTOR` | 三分量（**无相对切换**） | 恰好 `{x,y,z}`（`readVector 452–460`） |

### 3.4 控制点参考空间

- `POINT`/`POINT_LIST` 的元素可以是**绝对**（`x/y/z`）或**相对段起点**（`dx/dy/dz`），二选一，不可混（`readPoint 413–424`）。
- 相对形态在运行时的解析：`PathPoint.resolve(from)`（`J:math/path/PathPoint.java`），即"段起点 + 偏移"。
- 编辑器：每个控制点一个"绝对/相对"切换；切换时**清空**另一组（不保留，避免混写被拒）。
- 提示："相对 = 相对本段起点（端点 A 的位置），不是相对上一控制点"。

### 3.5 未知参数与未知类型

| 情况 | 运行时行为 | 编辑器行为 |
|---|---|---|
| 未知 `type` | 抛 `PathCurveException`（`create 272–276`） | 下拉不提供；已有文档里出现 → `block` |
| 未知参数 | 抛（`create 277–284`） | 表单不提供；已有文档里出现 → `block` |
| 参数类型不符 | 抛（`read 348–360`） | 本地拒绝 |
| 必填缺失 | 抛（`create 288–291`） | 本地拒绝 |

与数学模型不同（那边未知参数忽略，见 07-MathModelEditor），路径是**严格**的。UI 文案必须区分。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `geometryTypes(schema): string[]` | `curveTypes` | `['line', ...registry]` |
| `paramsOf(schema, type): PathParamDefView[]` | 类型 | 参数表 |
| `validateGeometry(schema, geometry): Issue[]` | 几何对象 | 本地 issue |
| `anchorOf(type, geometry): 'endpoints' \| 'start' \| 'free'` | 类型 | 锚点（用于警告） |

`anchorOf` 需要读 `curveTypes` 的 `capabilities` 之外的运行时知识（锚点未导出）。因此锚点表**必须**内置一份（11 条），并在 02-SchemaSnapshot 的漂移检查里对照"注册类型集合"：注册表新增类型而锚点表没有 → 提示"未覆盖，按 ENDPOINTS 处理并警告"。

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/paths/PathGeometryForm.vue`（提案）：按 `params` 渲染。
2. 新建 `EDITOR:src/model/pathGeometry.ts`（提案）：`geometryTypes` / `paramsOf` / `validateGeometry` / `anchorOf` / `ANCHORS`（11 条内置表）。
3. 删除 `EDITOR:src/components/fields/BezierCurveField.vue`。
4. 改 `EDITOR:src/types.ts`：删除 `BezierCurve`（37–41）与 `BezierControlPoint`（26–34）。
5. 在 07-PathCollectionEditor 的条目编辑器里嵌入本表单。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/PathGeometryForm.java`（提案）。
2. 参数表直接来自 `PathCurveRegistry.params(type)`；校验可直接调 `PathCurveRegistry.create` 做"试构造"（捕获 `PathCurveException`），这是同进程可用的**真值**。
3. 锚点表内置一份，与 WebUI 同。

### 4.4 禁止修改

- 不硬编码参数名（读 `curveTypes`）。
- 不把 `VECTOR` 当 `POINT`（无相对形态）。
- 不混写绝对与相对控制点。
- 不把 `arc`/`ellipse`/`fourier(periodic)` 的端点当作"路径必经点"（它们是 FREE）。
- 不静默忽略未知参数（路径是严格的）。

## 五、正反例验收

### 5.1 正例

1. 选 `bezier` → 只有 `control_points`；填 2 个相对点 `{dx:1,dy:2,dz:0}`、`{dx:3,dy:0,dz:1}` → `script.validate` 通过。
2. 选 `arc` → 表单显示 `center/radius/start_angle/end_angle/normal/reference_axis`；`normal`/`reference_axis` 有默认值；填 `center={x:0,y:64,z:0}`、`radius=5`、`start_angle=0`、`end_angle=180` → 通过。
3. 选 `bspline`，`control_points` 3 个、`degree` 留空（默认 3）→ 控制点数（含端点）= 5，`degree=3` 合法。
4. 选 `fourier`，`periodic=true`、`period=4`、`cos`/`sin` 各 2 项 → 通过；显示 `PERIODIC` 能力与 FREE 警告。
5. 选 `fourier`，`periodic=false`、`a0=(0,0,0)`、`start_velocity=(1,0,0)` → 通过；锚点变 ENDPOINTS。
6. 选 `line` → 无参数表单，只有类型。
7. `rational_bezier` 1 个控制点 + 1 个权重 `0.5` → 通过（二次）。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| `bezier` 只给 1 个控制点 | 拒绝：`三次 Bézier 需要恰好 2 个内部控制点` |
| `bezier` 控制点混写 `{x,y,dz}` | 拒绝：`控制点必须恰好是 {x,y,z}（绝对）或 {dx,dy,dz}` |
| `arc` 的 `start_angle == end_angle` | 拒绝：`起止角不能相同` |
| `arc` 的 `|Δ| = 400` | 拒绝：`角度跨度不能超过 360°` |
| `arc` 的 `normal` 与 `reference_axis` 平行 | 拒绝：`不能平行` |
| `clothoid` 的 `length = 0` | 拒绝：`长度必须是正的有限值` |
| `clothoid` 的 `normal` 与 `start_direction` 平行 | 拒绝 |
| `fourier` 非周期且 `a0 != 0` | 拒绝：`非周期路径的 a0 必须为 0` |
| `fourier` 的 `cos` 2 项、`sin` 1 项 | 拒绝：`cos 与 sin 的阶数必须一致` |
| `bspline` 的 `degree = 5` 且控制点 3（含端点 5） | 拒绝：`次数必须落在 1 ~ 4` |
| `geometry.type = "quadratic"` | 拒绝：未知曲线类型 |
| `bezier` 多给一个 `foo` 参数 | 拒绝：未知参数 |
| 选 `arc` 时期望路径经过两个端点 | 禁止（FREE；UI 必须警告） |

### 5.3 异步关键帧专项

**正例**：`p1` 用 `bezier`（ENDPOINTS）；`position.x` 帧 `[0,3]`、`position.z` 帧 `[0,3]`；`axes=[x,z]`。路径起点 = 端点 A 的采样位置，终点 = 端点 B。

**反例**：`p1` 改用 `arc`（FREE）但作者以为"路径仍从 A 到 B" → 运行时段末位置由圆弧决定，与 B 的位置不一致 → 下一段起点跳变。编辑器必须在切换类型时立即显示警告（不是等到预览）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；`c1` 位置节点 `[0,3]`，`position.x` 0→10、`position.z` 0→0。
2. `p1: 0→3, axes[x,z], geometry line` → 播放：相机沿 +x 直线。
3. 改成 `bezier`，控制点 `{dx:3,dy:5,dz:0}`、`{dx:7,dy:-5,dz:0}` → 播放：路径先上扬再下压（与直线明显不同）。
4. 改成 `arc`（圆心相对 `{dx:5,dy:0,dz:0}`、半径 5、0→180°）→ 播放：路径为半圆，**起点不一定是 A**；确认编辑器已给出 FREE 警告。
5. 改成 `clothoid`（曲率 0→0.2、长度 10）→ 播放：起点为 A，终点由曲线决定。

通过判定：第 2/3 步路径形状符合参数；第 4/5 步警告与实际不连续现象一致。

## 七、完成定义

1. `PathGeometryForm.vue` + `pathGeometry.ts` 存在；参数表来自 `curveTypes`。
2. `ANCHORS` 表覆盖 11 种；FREE/START 警告可见。
3. `BezierCurveField.vue` / `BezierCurve` / `BezierControlPoint` 已删除。
4. §5 的 7 条正例、13 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体参数表与"试构造"校验结果一致（同一 geometry 的 accept/reject 相同）。
