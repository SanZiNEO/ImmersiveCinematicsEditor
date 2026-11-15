# 07-04 朝向组

## 目标

把 CAMERA 的朝向字段做成一条可读的优先级链：

```text
look_at > tangent > manual
```

作者在属性面板/效果面板里只看到当前生效支路需要的控件；被压住的字段保留数据但不参与求值。`yaw/pitch/roll`、锁、基准、线端点、切线偏移都按 03 文档模型编辑。

## 字段表

| 字段 | 形态 | 类型 | 插值 | 默认 | 组 |
|---|---|---|---|---|---|
| `yaw` | animated | float angle | linear | `0` | orientation |
| `pitch` | animated | float angle | linear | `0` | orientation |
| `roll` | animated | float angle | linear | `0` | orientation |
| `yaw_lock` | animated | nullable float angle | linear | `null` | orientation |
| `pitch_lock` | animated | nullable float angle | linear | `null` | orientation |
| `yaw_base` | animated | enum `world/entity/line` | step | `world` | orientation |
| `pitch_base` | animated | enum `world/entity/line` | step | `world` | orientation |
| `yaw_base_selector` | animated | ref | step | `@p` | yaw_base_from |
| `yaw_base_from` | animated | ref | step | `""` | yaw_base_from |
| `yaw_base_from_x/y/z` | animated | float | linear | `null` | yaw_base_from |
| `yaw_base_from_offset.x/y/z` | animated | float | linear | `0` | yaw_base_from |
| `yaw_base_from_offset.space` | animated | enum `world/base` | step | `world` | yaw_base_from |
| `yaw_base_from_freeze` | animated | bool | step | `false` | yaw_base_from |
| `yaw_base_to` | animated | ref | step | `""` | yaw_base_to |
| `yaw_base_to_x/y/z` | animated | float | linear | `null` | yaw_base_to |
| `yaw_base_to_offset.x/y/z` | animated | float | linear | `0` | yaw_base_to |
| `yaw_base_to_offset.space` | animated | enum `world/base` | step | `world` | yaw_base_to |
| `yaw_base_to_freeze` | animated | bool | step | `false` | yaw_base_to |
| `look_at` | animated | enum `none/player/coordinate/entity/block` | step | `none` | look_at |
| `look_at_selector` | animated | ref | step | `@p` | look_at |
| `look_at_part.x/y/z` | animated | float | linear | `50` | look_at |
| `look_at_target_x/y/z` | animated | float | linear | `null` | look_at |
| `look_at_target_structure` | animated | string | step | `""` | look_at |
| `look_at_target_block` | animated | string | step | `""` | look_at |
| `look_at_offset.x/y/z` | animated | float | linear | `0` | look_at |
| `look_at_offset.space` | animated | enum `world/base` | step | `world` | look_at |
| `look_at_freeze` | animated | bool | step | `false` | look_at |
| `orient` | value | enum `manual/tangent` | — | `manual` | orientation |
| `yaw_offset` | animated | float angle | linear | `0` | orientation |
| `pitch_offset` | animated | float angle | linear | `0` | orientation |

`orient` 是 `value`，没有 `keyframes`；永远在属性面板。`yaw_offset/pitch_offset` 有 `requires("orient=tangent")`。

## 优先级

### 1. `look_at`

当 `look_at != none` 且目标可解析：

```text
yaw/pitch = 当前世界位置 → 目标点方向
roll = roll 规格
```

- `look_at` 的形态、载荷、取点、偏移、冻结见 07-03。
- `look_at_freeze` 只在 `look_at=entity` 时被读取；其他分支禁用。
- `yaw/pitch`、`yaw_lock/pitch_lock`、`yaw_base*`、`pitch_base*`、`yaw_offset/pitch_offset` 不参与。
- `roll` 保留。
- 目标不可解析：回退到切线；没有切线再回退手动。
- 坐标/结构/方块/玩家的目标不可解析：显示 `warn`；不把角度改成 0。

### 2. `orient=tangent`

当 `look_at` 不生效，且位置方向有非零切线：

```text
yaw   = atan2(dz, dx) - 90 + yaw_offset
pitch = -atan2(dy, horizontal) + pitch_offset
roll  = roll
```

- 水平分量近似 0：`yaw=0`、`pitch=±90`。
- 切线来自当前路径/位置采样；没有路径时来自位置关键帧差分。
- `yaw_offset/pitch_offset` 只在切线支叠加；手动支忽略。
- `orient=manual` 时偏移控件禁用；已有关键帧保留。

### 3. 手动

```text
yaw   = (yaw_lock ?? yaw_base) + yaw
pitch = (pitch_lock ?? pitch_base) + pitch
roll  = roll
```

- `yaw_base`、`pitch_base` 各自独立：`world` / `entity` / `line`。
- `world` 基准 = 0。
- `entity` 基准：
  - yaw 取实体身体水平朝向；
  - pitch 取实体视线 pitch；
  - `yaw_base_selector` 一个字段同时服务两个轴；空 = `@p`。
  - 实体未解析 = 0，并给 `warn`。
- `line` 基准：
  - 任一轴为 `line` 就显示 `yaw_base_from/to` 与载荷；
  - 连线方向给 yaw/pitch；
  - 端点不可解析或水平分量 < `1e-6` = `{0,0}`，回退 world 基准，并给 `warn`。
- `yaw_lock/pitch_lock` 为 `null` 时用基准；有值时直接替换基准，再叠加 `yaw/pitch`。
- `roll` 不参与优先级，直接输出。

## 生效矩阵

| `look_at` | `orient` | 生效 | 禁用 |
|---|---|---|---|
| 非 none 且目标可解析 | 任意 | look_at | yaw/pitch、锁、基准、切线偏移 |
| 非 none 但目标不可解析 | tangent | tangent | 同上；显示 look_at 失败 |
| 非 none 但目标不可解析 | manual | manual | 锁/基准恢复可用 |
| none | tangent 且有切线 | tangent | 锁、基准、look_at 载荷 |
| none | tangent 但无切线 | manual | 切线偏移禁用；显示回退 |
| none | manual | manual | 切线偏移禁用 |

UI 在组头显示当前声明链与回退提示：

```text
look_at=entity → 目标可解析：注视支路
look_at=entity → 目标不可解析：回退 tangent/manual
orient=tangent → 无切线：回退 manual
```

## 控件与禁用

### `look_at` 行

- `look_at=none`：载荷全部隐藏；`look_at_selector` 等已有值显示“不读取”。
- `look_at=player`：只显示枚举；selector 不参与。
- `look_at=coordinate`：坐标 / 结构二选一；结构非空时坐标禁用。
- `look_at=entity`：selector + part；冻结可用。
- `look_at=block`：block 字符串；冻结禁用。
- `look_at_offset.space=base` 且当前不是 `base`：显示 `warn`。

### 手动基准

- `yaw_base=entity` 或 `pitch_base=entity`：显示 `yaw_base_selector`。
- 只有 `yaw_base=line` 或 `pitch_base=line`：显示 `yaw_base_from/to` 和载荷。
- `yaw_base_from/to` 的 freeze 只在对应端点是选择器时可用。
- `yaw_base_from_offset.space=base` 且无 base 参考系：`warn`。

### 切线偏移

- `orient=tangent` 才可编辑 `yaw_offset`/`pitch_offset`。
- `orient=manual`：控件禁用；已有帧保留；效果面板行显示“依赖不满足”。
- 切线偏移不改变 `yaw_base`/`pitch_base`；切线支不读基准。

## 双面板归属

### 属性面板

- 朝向组头“朝向”。
- `orient`（value）永远在这里。
- `yaw/pitch/roll` 无帧时显示静态值 + 时钟。
- `yaw_base/pitch_base`、`yaw_base_selector`、`yaw_base_from/to`、`look_at` 等 step 字段无帧时在这里。
- `yaw_lock/pitch_lock` 无帧时在这里。
- 已有关键帧的叶子不在这里重复。

### 效果面板

- 只列已有关键帧的叶子。
- `orient` 永远不进来。
- `yaw/pitch/roll` 有帧时三行各自节点，不合并。
- `look_at`、`yaw_base` 等 step 字段有帧时作为行进入；不出现“朝向全字段组”。
- `yaw_offset/pitch_offset` 有帧但 `orient=manual`：行显示“依赖不满足”，值保留，运行时不读取。

## 组件

```text
src/components/orientation/
  OrientationGroupHeader.vue
  OrientationModeField.vue
  LookAtBranchFields.vue
  OrientationManualFields.vue
  OrientationBaseFields.vue
  OrientationLineEndpointFields.vue
  OrientationTangentFields.vue
  OrientationEffectiveBanner.vue
src/model/orientation/
  orientationBranch.ts      优先级/生效/禁用/警告
  orientationAngles.ts      yaw/pitch/roll 读写；不做归一化
  orientationBase.ts        world/entity/line 基准可见性
```

- `LookAtBranchFields` 复用 07-03 的点源/偏移/冻结组件，不复制表单。
- `OrientationBaseFields` 的 selector 一个字段服务 yaw/pitch 两个轴。
- `OrientationEffectiveBanner` 只显示派生结果，不改字段。

## 验收

1. `look_at=none`、`orient=manual`、`yaw_base=world`：yaw/pitch/roll 可编辑；切线偏移禁用；保存通过。
2. `look_at=entity` 且目标可解析：yaw/pitch、锁、基准禁用；roll 可编辑；保存后朝向指向实体。
3. `look_at=entity` 但 selector 查不到实体：显示“目标不可解析，回退 tangent/manual”；不改成 0 度。
4. `orient=tangent`、有位置路径、无 look_at：yaw/pitch 由切线算；yaw_offset/pitch_offset 可编辑并叠加上去。
5. 同一文档 `orient=manual` 且 yaw_offset 已有帧：行显示依赖不满足；运行时不读取；切回 tangent 后恢复。
6. `yaw_base=entity`、`pitch_base=world`：selector 显示；yaw 用实体身体朝向，pitch 用 world 基准 0。
7. `pitch_base=entity`、`yaw_base=world`：selector 仍显示，并服务 pitch。
8. `yaw_base=line`、`yaw_base_from=@p`、`yaw_base_to=coordinate (10,64,0)`：显示端点；from freeze 可用，to freeze 禁用。
9. 线端点重合或水平退化：角度回退 0，显示 `warn`；不抛异常。
10. `yaw_lock=90`、`yaw=15`、`yaw_base=entity`：结果 `105`；`yaw_lock=null` 时用实体基准。
11. `yaw=720`、`pitch=-540`：按输入角度写，不做 `[-180,180]` 归一化。
12. `look_at=coordinate` + structure：坐标字段禁用；清空 structure 后恢复坐标。
13. 属性面板开 `yaw` 时钟：yaw 进效果面板；`orient` 仍留属性面板；组头“1 项在效果面板”。
14. 效果面板关闭 `roll` 动画：roll 回属性面板；一次撤销恢复。
15. 主时间轴不出现朝向行、角度节点或 `orient` 控件。
