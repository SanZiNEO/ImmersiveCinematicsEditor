# 12-03 片段级模板

## 目标

实现四个片段级模板：`fade`、`static_breath`、`dolly`、`orbit_arc`。每个模板生成一个片段的标准 `objects`，`orbit_arc` 另生成一条标准 `paths[]` 条目。

四个模板都是纯函数：参数进，JSON 片段出。不读文档、不读全局状态、不写文件、不执行规则、不创建运行时对象。

## 共同规则

- 产物只写目标轨道 schema 中存在的字段；值用 `{value}` 或 `{keyframes}`。
- value-only 字段不带 `keyframes`；animated 字段才可带。
- 片段 `start_time` 由装配器给；模板内关键帧时间从 0 开始，相对片段起点。
- 片段 id 由装配器分配；需要被 `paths[]` 引用时必须有 id。
- 模板不写片段级 `transition`、`transition_duration`、`transition_curve`、`transition_params`、`transition_interrupt`。
- 模板不写 `keyframes`/`curve` 这类旧片段级字段；所有动画都在 `objects` 的叶子路径里。
- 模板不写 `meta.version`、`timeline.total_duration`、空 `triggers` 数组。
- 模板不写默认值填充；只有参数明确给出或效果需要的字段才写；schema 默认值由运行时按缺省处理。

## 1. `clip.fade`

### 用途

新建一个全屏淡入/淡出/淡入淡出的 `OVERLAY` 片段。它是“新片段生成”模板；09-08 的 `fade.in/out/flash` 仍是“应用到现有片段”的便利预设。两者共用同一套字段写法，不注册第二份默认值。

### 参数

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `color` | string | `#000000` | `^#[0-9a-fA-F]{6}$` | 覆盖颜色；必须是六位十六进制 |
| `duration` | float | 1.0 | 0.1–600 | 片段时长 |
| `mode` | enum | `in` | `in` / `out` / `both` | 淡入 / 淡出 / 淡入淡出 |
| `z_index` | int | 100 | 覆盖层层级；只写本片段，不建全局 z 表 |

### 展开

```text
layer_type = { value: "fade" }
color      = { value: "#RRGGBB" }
z_index    = { value: 100 }
opacity    = { keyframes: ... }
```

- `mode=in`：`opacity` 在 `t=0` 为 0，`t=duration` 为 1。
- `mode=out`：`t=0` 为 1，`t=duration` 为 0。
- `mode=both`：`t=0` 为 0，`t=duration/2` 为 1，`t=duration` 为 0。
- `color` 只写字符串；不写 `color.r/g/b`，不写 `gradient`、`gradient_angle`、`gradient_center`、`gradient_radius`、`mask_shape`、`mask_*`、`blend_mode`。
- 需要渐变、遮罩、混合时，生成后由作者在 09 的覆盖层字段里继续编辑；模板不复制 09 的合成逻辑。
- `opacity` 关键帧时间严格递增；`duration` 必须大于 0。
- 不生成 `x/y`/`anchor`/`scale`，使用 schema 默认值。
- 不生成片段级转场；淡入淡出是单个片段内部的 `opacity` 曲线。

### 校验

- 颜色不是六位十六进制 → 参数错误。
- `duration<=0` 或非有限 → 参数错误。
- `mode` 不在枚举 → 参数错误。
- `z_index` 非整数 → 参数错误。
- 产物出现 `color.r/g/b`/`gradient`/遮罩字段 → 生成错误；这些不是本模板职责。

## 2. `clip.static_breath`

### 用途

生成一个固定机位片段，可选手持呼吸。它是“固定 + 呼吸”的起手式；不移动位置，不生成路径。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `pose` | pose | 位置 + yaw/pitch/roll + fov/zoom | 机位姿态；位置可来自九槽 |
| `duration` | float | 8 | 片段时长，0.1–600 |
| `breath` | enum | `perlin` | `none` / `perlin` / `perlin_axis` / `sine` / `trauma` |
| `breath_intensity` | float | 0.05 | 0–1 |
| `breath_speed` | float | 1.0 | 0.01–20 |
| `breath_seed` | int | 0 | 可选；同 seed 同抖动 |
| `breath_trauma` | float | 1.0 | 仅 `trauma`；0–1 |
| `breath_decay` | float | 0.5 | 仅 `trauma`；0–1 |

`pose` 内部：

- `position`：三维点。
- `yaw` / `pitch` / `roll`：度。
- `fov`：1–179；默认 70。
- `zoom`：>0；默认 1。

### 展开

- `position_mode = { value: "absolute" }`。
- `position.x/y/z`：`{ value: x/y/z }`。
- `yaw` / `pitch` / `roll`：`{ value: ... }`；等于默认 0 时可省略。
- `fov`：`{ value: ... }`；等于默认 70 时可省略。
- `zoom`：`{ value: ... }`；等于默认 1 时可省略。
- `cam_breath_enabled`：`{ value: true }`；`breath=none` 时写 `false`，并省略其余呼吸字段。
- `cam_breath_type`：`{ value: "perlin" | "perlin_axis" | "sine" | "trauma" }`。
- `cam_breath_intensity` / `cam_breath_speed` / `cam_breath_seed`：`{ value: ... }`。
- `trauma` 时另写 `cam_breath_trauma` / `cam_breath_decay`；其他类型不写。
- 呼吸字段是 value-only，不生成 `keyframes`。
- 不写 `look_at`、`orient`、路径、转场。

### 校验

- `pose` 缺位置/非有限 → 参数错误。
- `fov` 超出 1–179 → 参数错误。
- `zoom<=0` → 参数错误。
- `breath_intensity` 超出 0–1、`breath_speed` 越界 → 参数错误。
- 呼吸字段带 `keyframes` → 生成错误。
- `breath=none` 但仍写 `cam_breath_type`/intensity/speed → 生成错误（应省略）。

## 3. `clip.dolly`

### 用途

生成一段从 A 点到 B 点的推近/拉远。位置和 `fov` 各两端关键帧；`fov_from` 与 `fov_to` 不同就是希区柯克变焦，不另立模板。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `from` | position | 必填 | 起点世界坐标；可从九槽取 |
| `to` | position | 必填 | 终点世界坐标；可从九槽取 |
| `duration` | float | 6 | 0.1–600 |
| `fov_from` | float | 70 | 1–179 |
| `fov_to` | float | 70 | 1–179 |
| `look_at` | enum | `none` | `none` / `coordinate` |
| `target` | position | 可选 | `look_at=coordinate` 时的注视点；可从九槽取 |
| `yaw` / `pitch` / `roll` | float | 0 | `look_at=none` 时的朝向；度 |

### 展开

- `position_mode = { value: "absolute" }`。
- `position.x/y/z` 各两个关键帧：`t=0` 为 `from`，`t=duration` 为 `to`。
- `fov` 两个关键帧：`t=0` 为 `fov_from`，`t=duration` 为 `fov_to`。
- `look_at=none` 时写 `yaw/pitch/roll` 常量（等于 0 可省略）。
- `look_at=coordinate` 时写：
  - `look_at = { value: "coordinate" }`
  - `look_at_target_x/y/z` = `{ value: target.x/y/z }`
  - 不写 `yaw/pitch/roll`；由运行时按 look_at 求朝向。
- 不生成 `paths[]`；直线段用位置关键帧即可。需要弧线时由作者用 12-10 的曲线工具显式添加。
- 不生成 `zoom` 关键帧；推近由位置 + fov 表达，需要 zoom 时作者另行添加。
- 不生成转场。

### 校验

- `from` 与 `to` 相同 → 参数错误；不生成零长度位移。
- `duration<=0` → 参数错误。
- `fov` 越界 → 参数错误。
- `look_at=coordinate` 但无 `target` → 参数错误。
- 位置关键帧时间重复/非递增 → 生成错误。
- 产物含 `paths[]`、`transition*` → 生成错误（本模板不写）。

## 4. `clip.orbit_arc`

### 用途

生成一段环绕弧线：一个 CAMERA 片段，位置两端节点 + 一条 `paths[]` 贝塞尔弧。单段扫角 ≤120°；整圈由 `track.orbit_full` 组合，不在这里生成 360°。

### 参数

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `center` | position | 必填 | — | 环绕中心；可从九槽取 |
| `radius` | float | 8 | 0.5–512 | 半径 |
| `height` | float | 2 | -512–512 | 相对中心的高度 |
| `start_angle` | float | 0 | -3600–3600 | 起始角，度，绕 +Y |
| `sweep` | float | 120 | 1–120 | 扫过角度；>120 拒绝 |
| `duration` | float | 6 | 0.1–600 | 片段时长 |
| `look_at_center` | bool | true | — | 是否始终看向中心 |
| `fov` | float | 70 | 1–179 | 视场角 |

### 展开

角度与点：

```text
a0 = start_angle
a1 = start_angle + sweep
P0 = (cx + R·cos(a0), cy + h, cz + R·sin(a0))
P1 = (cx + R·cos(a1), cy + h, cz + R·sin(a1))
```

字段：

- `position_mode = { value: "absolute" }`。
- `position.x/y/z` 各两个关键帧：`t=0` 为 `P0`，`t=duration` 为 `P1`。
- `fov`：`{ value: fov }`。
- `look_at_center=true`：
  - `look_at = { value: "coordinate" }`
  - `look_at_target_x/y/z` = `{ value: center.x/y/z }`
- `look_at_center=false`：
  - `orient = { value: "tangent" }`
  - `yaw_offset` / `pitch_offset` = `{ value: 0 }`（等于默认可省略）
  - 不写 `look_at`。
- 一条 `paths[]` 条目：

```text
{
  id: <装配器分配>,
  clip: <本片段 id>,
  from: 0,
  to: duration,
  axes: ["x", "z"],
  geometry: {
    type: "bezier",
    control_points: [
      { dx: -K·R·sin(a0), dy: 0, dz:  K·R·cos(a0) },
      { dx:  K·R·sin(a1), dy: 0, dz: -K·R·cos(a1) }
    ]
  },
  timing: { type: "linear" }
}
```

其中 `K = (4/3)·tan(sweep/4)`，角度用弧度计算。`control_points` 是相对段起点 `P0` 的 `{dx,dy,dz}`，三个键齐全；不写数组形态。

路径约束：

- `from` / `to` 必须命中片段 `position.x/y/z` 的节点时间并集，且相邻；本模板只有 0 与 `duration` 两个节点，天然满足。
- `axes` 只含 `x` / `z`；本模板不生成 y 方向弧线。
- `control_points` 只写 `{dx,dy,dz}`；不写 `{x,y,z}` 混合。
- `timing` 默认 `linear`；需要弧长重采样时由 12-10 显式改 `timing.keyframes`，模板不预生成。
- 路径 id 与片段 id 分离；都由装配器分配，模板只保留占位关系。

### 校验

- `radius<=0` 或非有限 → 参数错误。
- `sweep<=0` 或 `>120` → 参数错误；提示“整圈请用轨道模板”。
- `height` 越界 → 参数错误。
- `start_angle` 越界 → 参数错误。
- `duration<=0` → 参数错误。
- `fov` 越界 → 参数错误。
- 生成 360° 单段 → 生成错误。
- 控制点写成数组/缺键 → 生成错误。
- 路径端点不匹配位置节点 → 生成错误。
- 产物带 `transition*` → 生成错误。

## 与其他轮次的边界

- `fade` 的字段写法与 09-08 的覆盖层预设同源；09-08 继续负责“应用到现有片段”，本模板负责“新建片段”。不重复注册默认值。
- `static_breath` / `dolly` / `orbit_arc` 只写 08 已定义的相机字段；`transition*` 不写。
- `orbit_arc` 的弧线用 07 的路径契约；07 负责路径条目/端点绑定，模板只生成一条合法条目。
- 镜头呼吸是 value-only，不能打关键帧；模板不生成 `cam_breath_*` 的 `keyframes`。
- 不生成 `curve`、`keyframes`、`rules` 等旧片段级字段。

## 验收出口

1. 四个模板各生成一次，保存重开，标准脚本能过现有校验器。
2. `fade` 的 `opacity` 单段曲线正确；`color` 是字符串；没有遮罩/渐变字段。
3. `static_breath` 的 `cam_breath_*` 全部是 value；`breath=none` 时其余呼吸字段省略。
4. `dolly` 位置与 `fov` 各两端节点；`fov_from≠fov_to` 时游戏内可见希区柯克变焦。
5. `orbit_arc` 默认生成 1 片段 + 2 位置节点 + 1 条路径；`sweep=130` 被拒绝；游戏内是 120° 弧且看向中心。
6. 生成后到游戏里播放，确认没有片段级转场、没有运行时模板字段。
