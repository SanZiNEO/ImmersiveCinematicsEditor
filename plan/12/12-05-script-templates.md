# 12-05 脚本级模板

## 目标

实现三个脚本级模板：`blank`、`camera_intro`、`follow_black`。它们生成整份标准脚本骨架：`meta`、轨道、片段、可选 `paths[]`、可选触发器骨架。

脚本模板只做“起手式”。生成后作者继续在 05/06/07/08/09 里编辑；模板不执行规则、不维护运行时状态、不写默认转场。

## 共同规则

- `meta` 使用当前新建脚本骨架的 schema 默认值，再覆盖模板明确给出的字段。
- 轨道使用当前内置轨道；每条轨道有唯一 id，空轨也保留。
- 不写 `meta.version`、`timeline.total_duration`、空 `triggers` 数组、废弃的 HUD/screen 字段。
- 不写规则、规则绑定、执行状态、事实状态；触发器只写 11 的声明骨架。
- 不写片段级 `transition*`，不写 crossfade，不自动改相邻片段。
- 生成后走现有保存/校验通道；不直接写游戏目录。
- 当前文档有脏改动时先走未保存守卫；不静默覆盖。

## 脚本内部的组合方式

脚本模板需要多条轨道时，可以用“内部轨道组合器”把片段模板的展开结果放到轨道里：

- 组合器仍然调用 `clip.*` 的展开函数，不复制片段数学。
- 组合器只负责轨道 id、片段起点、片段顺序和轨道类型。
- 组合器不注册成用户可见的轨道模板；用户可见的轨道模板仍是 `track.orbit_full` / `track.multi_cam`。
- 需要整圈/多机位时，脚本模板也可以引用用户可见的轨道模板。
- 内部组合器和用户轨道模板都遵守“只向下组合”的规则；不横向复制。

## 1. `script.blank`

### 用途

生成一份空脚本骨架。它是模板面板“新建脚本”的起手式；当前 `script.new` 仍可作为另一条新建通道，二者生成同构骨架。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | `untitled` | 脚本 id；按现有 id 规则 |
| `name` | string | `新脚本` | 显示名；≤50 字符 |

### 展开

- `meta`：按 schema 默认值写；`id` / `name` 用参数覆盖；`author` 按当前骨架要求写字符串，默认空串。
- `timeline.tracks`：七类内置轨道各一条空轨：
  - `CAMERA`
  - `LETTERBOX`
  - `AUDIO`
  - `EVENT`
  - `MOD_EVENT`
  - `OVERLAY`
  - `ADJUST`
- 轨道 id 按 `{type小写}_{n}` 生成；同类型多条时递增。
- 每条轨道 `clips` 为空数组。
- 不写 `triggers`、不写 `rules`、不写 `rule_bindings`、不写 `paths`（空集合可省略）。
- 不写 `timeline.total_duration`；时长由片段/播放器决定。
- 不写 `meta.version`。

### 校验

- `id` 不符合现有 id 规则 → 参数错误。
- `name` 为空/超长 → 参数错误。
- 轨道 id 冲突 → 自动递增；不覆盖已有。
- 产物出现空 `triggers: []` / `total_duration` / `version` → 生成错误。

## 2. `script.camera_intro`

### 用途

生成一个“相机 + 遮幅 + 可选片头黑场”的开场骨架。相机固定机位，不呼吸；遮幅可选；片头黑场可选。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` / `name` | string | `untitled` / `新脚本` | 脚本身份 |
| `duration` | float | 10 | 相机片段时长，0.1–600 |
| `pose` | pose | 必填 | 机位姿态；位置可来自九槽 |
| `letterbox` | float | 2.35 | 遮幅比例；0 = 不加遮幅；>0 时 0.1–4 |
| `black_fade` | float | 0 | 片头黑场时长；0 = 不加；>0 时 0.1–duration |

### 展开

1. `meta`：同 `blank`，写 id/name/作者空串。
2. CAMERA 轨：一条 `clip.static_breath`，参数：
   - `pose`
   - `duration`
   - `breath = "none"`
   - 起点 0
3. LETTERBOX 轨（仅 `letterbox>0`）：一条 LETTERBOX 片段：
   - `start_time=0`
   - `duration=duration`
   - `aspect_ratio={value: letterbox}`
   - `opacity={value: 1}`
   - 不写方向、不写位置/缩放；上下/左右由窗口比例自动决定。
4. OVERLAY 轨（仅 `black_fade>0`）：一条 `clip.fade`：
   - `start_time=0`
   - `duration=black_fade`
   - `mode="out"`（黑场 1→0，画面显现）
   - `color="#000000"`
   - `z_index=100`
   - 不写渐变/遮罩/混合。
5. 其他内置轨道保留空轨。
6. 不写转场；相机、遮幅、黑场首尾对齐，没有 A→B 交界操作。
7. 不写触发器/规则；需要触发时作者在 11 行为页添加。

### 校验

- `pose` 缺位置/非有限 → 参数错误。
- `duration<=0` → 参数错误。
- `letterbox` 在 0 与 (0.1–4) 之外 → 参数错误。
- `black_fade` 为负或大于 duration → 参数错误。
- 黑场片段超出相机时长 → 参数错误。
- 产物出现片段级 `transition*` → 生成错误。
- `letterbox=0` 却生成 LETTERBOX 片段 → 生成错误。

## 3. `script.follow_black`

### 用途

生成一个“跟随目标 + 看向目标 + 结束黑场”的完整示例脚本。相机使用相对 `base` 坐标，跟随选择器；结束用 OVERLAY 黑场收尾；可选生成登录/生物群系触发器骨架。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` / `name` | string | `follow_black` / `跟随黑场` | 脚本身份 |
| `duration` | float | 30 | 总时长，0.1–600 |
| `selector` | selector | `@p` | 跟随/注视目标 |
| `distance` | float | 6 | 沿视线后退距离；>0 |
| `height` | float | 2 | 相机高度偏移；-512–512 |
| `look_height` | float | 1.6 | 注视点高度；-512–512 |
| `end_black` | float | 2 | 结束黑场时长；0 = 不加；>0 时 0.1–duration |
| `trigger` | enum | `none` | `none` / `login` / `biome` |
| `biome` | string | `*` | `trigger=biome` 时使用 |

### 相机

- 片段起点 0，时长 `duration`。
- `position_mode={value:"relative"}`
- `position_space={value:"base"}`
- `position_origin={value:selector}`
- `position_origin_freeze={value:false}`（跟随实体，不冻结）
- `facing_source={value:"entity"}`
- `facing_entity={value:selector}`
- `position.x={value:-distance}`（base 轴 `x` = 前向；负值表示后退）
- `position.y={value:height}`（base 轴 `y` = 上）
- `position.z={value:0}`（base 轴 `z` = 右）
- `look_at={value:"entity"}`
- `look_at_selector={value:selector}`
- `look_at_offset.y={value:look_height}`
- `fov` 默认 70；`zoom` 默认 1；作者可在生成后到 07 改。
- 位置/朝向是常量，不生成关键帧；跟随由运行时读取实体当前位置。
- 不写世界绝对位置；不猜动态原点。

> `position.x/y/z` 在 `relative + base` 下读作 `(fwd, up, right)`，不是世界三轴。上述映射以 07 的位置组契约为准；模板只选值，不重新定义语义。

### 黑场

- `end_black>0` 时，OVERLAY 轨一条 `clip.fade`：
  - `start_time = duration - end_black`
  - `duration = end_black`
  - `mode="in"`（0→1，结束在黑场）
  - `color="#000000"`
  - `z_index=100`
- `end_black=0` 时不生成黑场片段。
- 黑场只改自身 `opacity`，不写转场，不改相机片段。

### 触发器骨架

只写 11 的声明字段，不写动作、不写规则、不写绑定：

- `trigger=none`：不写 `triggers`。
- `trigger=login`：
  - `id="trg_login"`
  - `type="login"`
  - `delay=0`
  - `repeatable=false`
  - `conditions={}`
- `trigger=biome`：
  - `id="trg_biome"`
  - `type="biome"`
  - `delay=0`
  - `repeatable=false`
  - `conditions={ biome: "<biome>" }`
- 不写 `target`；触发器固定“触发后播放本脚本给触发者本人”。
- 不生成 `rules` / `rule_bindings`；需要规则时作者在 11 行为页添加。
- 不写 `requires` 以外的脚本前置；如需前置，11 行为页显式添加。

### 校验

- `duration<=0`、`distance<=0`、`height/look_height` 越界 → 参数错误。
- `selector` 为空/非法 → 参数错误；不猜默认实体。
- `end_black` 为负或大于 duration → 参数错误。
- `trigger=biome` 但 `biome` 为空 → 参数错误。
- 动态原点 + 无法忠实表达的位置字段 → 参数/生成错误；不把世界坐标冒充相对坐标。
- 产物出现 `target` / 规则 / 绑定 / 片段级转场 → 生成错误。
- 位置字段与 07 的 base 轴契约不符 → 生成错误。

## 产物形态

三个脚本模板生成的都是标准脚本：

```text
meta
timeline.tracks[]
  CAMERA / LETTERBOX / AUDIO / EVENT / MOD_EVENT / OVERLAY / ADJUST
     clips[]
       start_time / duration / objects / paths? / exit?
triggers?   // 只可能是 11 声明
```

- 标准 `objects` 里的字段全部来自目标轨道 schema。
- `paths[]` 只由 `orbit_arc`/`orbit_full` 或作者后续添加；本文件的脚本模板不生成路径，`follow_black` 也不用路径。
- 没有模板 id、参数、来源、生成记录。
- 没有 `transition*`；没有默认叠化。
- 没有 `total_duration`/`version`/废弃 HUD 字段。

## 验收出口

1. `blank` 生成七轨空轨，`meta.author` 为字符串；无 `version`/`total_duration`/空 `triggers`；保存重开通过现有校验。
2. `camera_intro` 默认：CAMERA 10s + LETTERBOX 2.35；无黑场；游戏内看到遮幅。
3. `camera_intro` `black_fade=2`：多一个 OVERLAY fade 0–2s，`opacity` 1→0；游戏内片头黑场消失。
4. `follow_black` 默认：相机相对 base 跟随 `@p`，看向 `@p`；最后 2s 淡入黑场；游戏内跟随和黑场时序正确。
5. `follow_black` `trigger=biome, biome=minecraft:plains`：`triggers[0]` 的 `type/conditions` 正确；没有 `target`/rules。
6. 三个模板生成后都不含片段级转场；需要叠化时到 08 面板另行建立。
