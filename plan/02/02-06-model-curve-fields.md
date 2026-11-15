# 02-06 models 与 curveTypes 字段表

## 目标

登记两段纯参数表：`models`（11 种插值模型）与 `curveTypes`（11 种路径曲线）。只登记「类型 + 参数 + 能力 + 上限」，不定义编辑器怎么画、怎么烘焙。来源：`MathModelRegistry`（105–117）；`PathCurveRegistry`（62–218）。

## `models`（11 种）

| 类型 | 参数 | 值域 | 说明 |
|---|---|---|---|
| `linear` | 无 | scalar / angle / vector / color | 默认回落 |
| `smoothstep` | 无 | 同上 | — |
| `ease_in` | 无 | 同上 | — |
| `ease_out` | 无 | 同上 | — |
| `ease_in_out` | 无 | 同上 | — |
| `cubic_bezier` | `x1` / `y1` / `x2` / `y2`（float，默认取 `CubicBezierCurve` 常量） | 同上 | — |
| `exponential_smooth` | `tau`（float，默认取 `ExponentialSmoothModel` 常量） | 同上 | — |
| `spring` | `stiffness` / `damping` / `initial_velocity`（float，默认取 `SpringModel` 常量） | 同上 | 与 `inertia` 同参 |
| `inertia` | `stiffness` / `damping` / `initial_velocity`（同 `spring`） | 同上 | — |
| `chain` | `models`（`model_list`） | 同上 | 串联子模型 |
| `blend` | `a`（model）/ `b`（model）/ `weight`（float，默认取 `BlendModel` 常量） | 同上 | 两模型混合 |

全局规则：

- 值域：`scalar` / `angle` / `vector` / `color`。
- 模型与值域不匹配 → **回落 `linear`**，不报阻断。
- 未知模型类型 / 非法参数 → 回落 `linear`，给警告。
- 已知参数类型错 → 报错，不静默转。
- 深度上限 8，节点上限 32；超限 → 回落 `linear` 或截断，以 `MathModelRegistry` 的判定为准。
- `chain` 的 `models` 递归受深度/节点上限约束；循环引用 → 报错。

## `curveTypes`（11 种）

| 类型 | 能力 | 参数 |
|---|---|---|
| `linear` | 无 | 无 |
| `bezier` | `ANALYTIC_SECOND_DERIVATIVE` | `control_points`（POINT_LIST，必填） |
| `rational_bezier` | `ANALYTIC_SECOND_DERIVATIVE` | `control_points`（POINT_LIST，必填）；`weights`（NUMBER_LIST，必填） |
| `arc` | `ANALYTIC_ARC_LENGTH` / `ANALYTIC_SECOND_DERIVATIVE` | `center`（POINT，必填）/ `radius`（NUMBER，必填）/ `start_angle`、`end_angle`（NUMBER，必填）/ `normal`、`reference_axis`（VECTOR，可选，默认取 `ArcPathSpec` 常量） |
| `ellipse` | `ANALYTIC_SECOND_DERIVATIVE` | `center`（POINT，必填）/ `semi_major`、`semi_minor`（NUMBER，必填）/ `rotation`（NUMBER，默认 `0.0`）/ `start_angle`、`end_angle`（NUMBER，必填）/ `normal`、`reference_axis`（VECTOR，可选，默认取 `EllipsePathSpec` 常量） |
| `bspline` | `ANALYTIC_SECOND_DERIVATIVE` / `KNOT_VECTOR` | `control_points`（POINT_LIST，必填）/ `degree`（INTEGER，默认 `3`）/ `knots`（NUMBER_LIST，可选） |
| `nurbs` | `ANALYTIC_SECOND_DERIVATIVE` / `RATIONAL_WEIGHTS` / `KNOT_VECTOR` | `control_points`（POINT_LIST，必填）/ `weights`（NUMBER_LIST，必填）/ `degree`（INTEGER，默认 `3`）/ `knots`（NUMBER_LIST，可选） |
| `catmull_rom` | `ANALYTIC_SECOND_DERIVATIVE` | `points`（POINT_LIST，必填）/ `parameterization`（ENUM：`uniform` / `chordal` / `centripetal`，默认 `centripetal`）/ `tension`（NUMBER，默认 `1.0`）/ `endpoint`（ENUM：`mirror` / `clamp`，默认 `mirror`） |
| `hermite` | `ANALYTIC_SECOND_DERIVATIVE` | `tangents`（POINT_LIST，必填） |
| `clothoid` | `ANALYTIC_ARC_LENGTH` / `ANALYTIC_SECOND_DERIVATIVE` | `start_curvature`、`end_curvature`、`length`（NUMBER，必填）/ `start_direction`、`normal`（VECTOR，可选，默认取 `ClothoidPathSpec` 常量） |
| `fourier` | `ANALYTIC_SECOND_DERIVATIVE` / `PERIODIC` | `a0`（VECTOR，默认零向量）/ `cos`、`sin`（POINT_LIST，可选）/ `period`（NUMBER，必填）/ `periodic`（BOOLEAN，默认 `true`）/ `start_velocity`、`end_velocity`（VECTOR，默认零向量） |

`PathCapability` 五个：`ANALYTIC_ARC_LENGTH` / `ANALYTIC_SECOND_DERIVATIVE` / `PERIODIC` / `RATIONAL_WEIGHTS` / `KNOT_VECTOR`。

`PathParamKind` 枚举（9 个）：`NUMBER` / `INTEGER` / `BOOLEAN` / `ENUM` / `TEXT` / `POINT` / `POINT_LIST` / `NUMBER_LIST` / `VECTOR`。目录按这个枚举登记参数形态，不自己发明 `POINT3` / `COLOR` 之类。

曲线规则：

- 默认曲线类型：`bezier`（路径没写 `geometry.type` 时）。
- 未知曲线类型 / 参数类型错 → **严格报错**（`PathCurveRegistry` 抛 `PathCurveException`），不回落、不猜。
- 参数名重复 / 保留名冲突 → 注册期报错。
- 必填参数缺失 → 报错；可选参数缺失用默认值。
- `control_points` 至少 2 个点（`bezier`）；`weights` 数量与 `control_points` 对齐（`rational_bezier` / `nurbs`）；`knots` 数量按 `degree` 校验（`bspline` / `nurbs`）。

## 字段范围

- 本文件登记模型/曲线有哪些参数、默认值、必填和能力。
- 编辑器面板直接查这两张表列参数，不重抄。
- 路径几何的实际求值、采样、烘焙不在本表；本表只保证参数声明与源码一致。

## 验收标准

- `model('spring')` 返回 `stiffness` / `damping` / `initial_velocity` 三参数；`model('linear')` 参数为空。
- `model('blend')` 的 `weight` 有默认值；`chain` 的 `models` 是 `model_list`。
- `curveType('nurbs')` 返回 3 个能力 + 4 个参数；`curveType('linear')` 能力和参数都为空。
- `curveType('catmull_rom')` 的 `parameterization` 枚举为 `uniform` / `chordal` / `centripetal`，默认 `centripetal`。
- 未知曲线类型 → 报错，不回落 `linear`；未知模型类型 → 回落 `linear` 并警告。两者行为不同，不能混。
- 目录里没有 `POINT3` / `COLOR` 这类自造参数形态。
