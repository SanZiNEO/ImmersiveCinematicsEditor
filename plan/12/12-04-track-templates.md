# 12-04 轨道级模板

## 目标

实现两个轨道级模板：`orbit_full` 和 `multi_cam`。它们把片段级模板排成一条 CAMERA 轨道，只负责片段顺序、起点和时长；不写转场，不移动已有片段，不复制片段级数学。

两个模板都只生成“首尾相接”的片段序列。作者要叠化、morph 或参数过渡时，生成后到 08 的转场面板按 A→B 交界操作处理。

## 共同规则

- 轨道类型固定 CAMERA。
- 新建轨道时按 `{type小写}_{n}` 分配 id；追加时接在目标轨道最后一个有限片段末端。
- 每个片段实例引用一个片段级模板；不内联重复数学。
- 片段起点按顺序计算，片段之间不重叠、不留隐式转场、不写 `transition*`。
- 目标轨道已有片段与生成区间重叠 → 整次拒绝；不静默挪已有片段。
- 所有片段和路径在一个事务里；撤销一次全部回退。
- 生成后选择第一个新片段；不改变其他轨道的选择。

## 1. `track.orbit_full`

### 用途

用多个 `clip.orbit_arc` 拼出一圈或部分圈。整圈不是单个片段模板；轨道模板负责分段、角度分配和时间排布。

### 参数

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `center` | position | 必填 | — | 环绕中心；可从九槽取 |
| `radius` | float | 8 | 0.5–512 | 半径 |
| `height` | float | 2 | -512–512 | 相对中心高度 |
| `start_angle` | float | 0 | -3600–3600 | 起始角，度 |
| `turns` | float | 1 | 0.25–4 | 圈数；1 = 360° |
| `segments` | int | 3 | 2–12 | 拼圆段数 |
| `duration` | float | 12 | 0.5–600 | 总时长 |
| `look_at_center` | bool | true | — | 每段是否看向中心 |
| `fov` | float | 70 | 1–179 | 每段视场角 |

### 展开

```text
sweepPerSegment = 360 · turns / segments
```

约束：

- `sweepPerSegment > 120` → 参数错误；提示增大 `segments`。
- `segments` 必须 ≥ ceil(|360·turns| / 120)；否则拒绝。
- 每个片段引用 `clip.orbit_arc`，传：
  - `center` / `radius` / `height`
  - `start_angle = start_angle + i·sweepPerSegment`
  - `sweep = sweepPerSegment`
  - `duration = segmentEnd - segmentStart`
  - `look_at_center`
  - `fov`
- 时间排布：
  - `segmentStart = i·duration/segments`
  - `segmentEnd = (i+1)·duration/segments`
  - 最后一段结束正好是总时长；不四舍五入到整帧。
- 每个片段有自己的 `paths[]` 条目；路径端点落在各自片段的位置节点上，不跨片段。
- 片段首尾相接：`segmentStart` 等于上一段结束；不写重叠，不写转场。
- 不生成 360° 单段；`sweep>120` 由片段模板拒绝，轨道模板提前给参数错误。
- 不写 `transition` / `transition_duration` / `morph`；需要过渡时生成后到 08。
- 不自动改已有片段，不自动补空片段。

### 校验

- `segments` 越界 → 参数错误。
- `turns` 越界 → 参数错误。
- `sweepPerSegment>120` → 参数错误。
- `duration<=0` → 参数错误。
- `radius<=0` / `height` 越界 / `fov` 越界 → 参数错误。
- 子片段路径端点不匹配 → 生成错误。
- 产物出现 `transition*` 或片段重叠 → 生成错误。

## 2. `track.multi_cam`

### 用途

生成一条多机位硬切序列。每个机位是一个固定姿态片段；机位姿态可来自九槽，按顺序切换。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `shots` | int | 2 | 机位数，2–9 |
| `poses` | pose_list | 必填 | 每个机位的姿态；数量必须等于 `shots`；每项可从九槽取 |
| `shot_duration` | float | 2 | 每个机位时长，0.1–600 |
| `duration` | float | 4 | 总时长；必须 ≥ `shots·shot_duration + (shots-1)·gap` |
| `gap` | float | 0 | 机位之间留白，0–5；默认硬切 |

### 展开

- 对每个机位引用 `clip.static_breath`，传：
  - `pose = poses[i]`
  - `duration = shot_duration`
  - `breath = "none"`（多机位默认不抖；要呼吸时作者生成后单独改）
- 时间排布：
  - `shotStart = i·(shot_duration + gap)`
  - `shotEnd = shotStart + shot_duration`
  - 最后一个机位结束时间不能超过 `duration`。
- `gap=0` 时首尾相接；`gap>0` 时片段之间是真空隙，不生成任何东西。
- 每个机位是独立片段；不合并、不交叉、不写转场。
- 机位姿态相同（位置、朝向、fov、zoom 全同）→ 警告“机位重复”，不阻止。
- `poses` 数量与 `shots` 不一致 → 参数错误，不静默截断/补空。
- 不自动选择轨道；装配器按 12-01 的新建/追加规则处理。
- 不自动做 crossfade；需要叠化时生成后到 08。

### 校验

- `shots` 不在 2–9 → 参数错误。
- `poses` 数量不符 → 参数错误。
- `shot_duration<=0` → 参数错误。
- `gap` 越界 → 参数错误。
- `shots·shot_duration + (shots-1)·gap > duration` → 参数错误。
- 姿态非有限/缺轴 → 参数错误。
- 产物出现转场字段 → 生成错误。
- 机位重复 → warning，不阻止。

## 装配后的轨道形态

### 新建轨道

- 轨道 id 从 `camera_1`、`camera_2` 递增；与已有 id 冲突时跳过。
- 轨道内片段按生成顺序排列；`start_time` 从插入点开始。
- 不写 `name`；轨道名由 05 的轨道头编辑，不由模板生成。

### 追加到已有轨道

- 起点 = 目标轨道最后一个有限片段的结束时间；如果目标轨道为空，起点 = 插入点。
- 不覆盖、不移动、不删除已有片段。
- 追加区间与已有片段重叠 → 拒绝；提示换轨道或改插入点。
- 轨道类型必须是 CAMERA；其他类型拒绝。

## 与 08 的边界

- `orbit_full` 生成的是连续硬切弧段；视觉上是同一镜头连续环绕，不靠转场拼接。
- `multi_cam` 生成的是硬切；机位之间没有 crossfade、没有 `transition*`、没有 B 片段前移。
- 需要叠化：生成后到 08 转场面板，选 A→B 交界，建立 B 的 `start_time` 前移和 `composite.opacity` 两端帧。
- 需要参数过渡：生成后到 08 参数过渡详情写 `transition*`；模板不预写。
- 模板不计算重叠、不对齐转场、不补 hold 帧。

## 与九槽的关系

- `orbit_full` 的 `center`、`start` 位置可用槽位；半径/高度/角度仍由参数给。
- `multi_cam` 的 `poses` 可直接从九槽按顺序填；槽位数量不足时由作者手动补或减少 `shots`。
- 槽位只在参数表单使用；产物不写槽位 id、不写槽位顺序。
- 槽位姿态是非有限数或缺轴 → 参数错误。

## 验收出口

1. `orbit_full` 默认（3 段、1 圈、12s）：生成 3 个片段，起点 0/4/8，每段 `sweep=120`，各带一条路径；游戏内是一圈连续环绕。
2. `orbit_full` `segments=2, turns=1` → 每段 180° > 120，参数错误并提示增大段数。
3. `orbit_full` 生成后检查：没有 `transition*`、没有片段重叠、没有跨片段路径。
4. `multi_cam` `shots=2`、`shot_duration=2`、`duration=8`：两个硬切片段 0–2、2–4；剩余时间不补空片段。
5. `multi_cam` `poses` 数量与 `shots` 不符 → 拒绝；不静默截断。
6. 追加到已有 CAMERA 轨道：新片段接在末尾，已有片段不动；重叠时拒绝。
7. 生成后到 08 手动建立叠化，确认模板本身没有写任何转场字段。
