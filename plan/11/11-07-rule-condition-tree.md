# 11-07 规则条件树

## 目标

把 `rules[].condition` 做成 12 种类型的条件树：8 种状态叶子、2 种事实叶子、2 种组合器。规则条件树不复用触发器的 27 种类型，也不接受触发器前置条件；两者只是共享几何和 id 匹配的底层函数。

## 顶层结构

```text
condition:
  type: <12 种之一>
  ...该类型的字段
```

- 规则条件树没有独立的 `conditions` 包装层；根节点直接把字段写在 `type` 同级。
- 组合器子项才是 `{ "type", "conditions": { ... } }` 两层结构。
- 叶子字段在根节点写顶层，在组合器子项里写进 `conditions`。
- 条件对象必填；空对象或无 `type` 都按“永不满足”处理并报错。

## 12 种类型

| 组 | type | 根节点字段 | 子项 `conditions` 字段 |
|---|---|---|---|
| 状态 | `time` | `at` 或 `from`/`to` | 同左 |
| 状态 | `location` | `dimension`、`position`+`radius`、`corner1`+`corner2` | 同左 |
| 状态 | `facing` | `yaw1`/`pitch1`/`yaw2`/`pitch2` | 同左 |
| 状态 | `biome` | `biome` | 同左 |
| 状态 | `dimension` | `dimension` | 同左 |
| 状态 | `camera_pos` | `position`+`radius` 或 `corner1`+`corner2` | 同左 |
| 状态 | `camera_facing` | `yaw1`/`pitch1`/`yaw2`/`pitch2` | 同左 |
| 状态 | `camera_fov` | `from`/`to` | 同左 |
| 事实 | `clip_fact` | `clip` + `fact` | 同左 |
| 事实 | `rule_fact` | `binding` + `fact` | 同左 |
| 组合 | `all_of` | `list` | `conditions.list` |
| 组合 | `any` | `list` | `conditions.list` |

## 时间

- 单位秒，相对**当前绑定所绑片段**的本地时钟：`片段本地时间 = timelineTime − clip.startTime`。
- 两种写法互斥：
  - `at`：`localTime >= at`，到点之后持续成立；
  - `from` / `to`：闭区间 `[from, to]`，可只写一边。
- `at` 与 `from`/`to` 同时写 = 校验错误，不按 `at` 优先静默处理。
- 三个都缺 = 永不满足。
- `hold` 挂起期间片段本地时钟冻结，`time` 条件因此不推进；编辑器只说明，不预测挂起时长。
- 同一规则绑到两个片段时，`time` 按各自绑定的片段本地时间求值，不共享一个时钟。

## 位置

- `location` 的 `dimension` 是**精确相等**，不是通配；与 `biome` / `dimension` 叶子的通配语义不同。
- 方体：`corner1`+`corner2` 各轴 min/max 归一；点落在方体内为真。
- 球形：`position`+`radius`；`radius` 缺省 0。
- 两者都写：先判方体，命中即真；方体不命中再判球；等价“方体或球形”。
- 两者都不写：只看 `dimension`；`dimension` 也没写 = 永不满足。
- 坐标是玩家世界坐标，不是相机坐标。

## 朝向

- `facing` 判玩家视线。
- 四个角度全必填；`pitch` 端点 -90~90；`yaw` 从 `yaw1` 顺时针到 `yaw2`，跨 ±180° 自然环绕。
- `yaw1 == yaw2` 表示整圈，不限制朝向。
- `camera_facing` 字段与 `facing` 完全相同，作用对象换成相机朝向；无活跃相机时永不满足。

## 群系与维度

- `biome` / `dimension` 使用 id 通配：`*` 全匹配、`ns:*` 命名空间前缀、无 `:` 子串包含、其余全等。
- 不可知时（本地玩家未就绪）按不满足。
- `biome` 读玩家所在群系；`dimension` 读玩家所在维度。

## 相机位置

- `camera_pos` 读相机世界坐标，无活跃相机时永不满足。
- 区域二选一：球形或方体；`radius` 缺省 0。
- 方体和球形**不要同时写**：求值侧只要方体字段存在就先判方体，方体不命中直接返回 false，球形不会再看。界面默认单选；已有两者时显示警告“方体优先，球形被忽略”。
- `camera_pos` 没有 `dimension` 字段，不要塞入。

## 相机 FOV

- `camera_fov` 单位度，闭区间 `[from, to]`，可只写一边。
- 两边都缺 = 永不满足；无活跃相机 = 永不满足。
- 不把 FOV 写成缩放倍率。

## 事实叶子

### clip_fact

```text
根:   { "type": "clip_fact", "clip": "intro", "fact": "completed" }
子项: { "type": "clip_fact", "conditions": { "clip": "intro", "fact": "completed" } }
```

- `clip` 必填且必须是当前脚本内已存在的片段 id。
- `fact` 只能是 `started` / `completed`。
- `started`：该片段在本播放实例内已开始。
- `completed`：该片段已完成；不要求完整播到结尾，按运行时结束事实。
- 引用未知片段：block；引用目标片段之外的片段但起点晚于目标片段结束：warn“可能永远等不到”。

### rule_fact

```text
根:   { "type": "rule_fact", "binding": "b_1", "fact": "succeeded" }
子项: { "type": "rule_fact", "conditions": { "binding": "b_1", "fact": "succeeded" } }
```

- `binding` 必填且必须是当前脚本内已存在的绑定 id。
- `fact` 只能是 `succeeded` / `action_completed`。
- `succeeded`：该绑定本次激活的条件成立；不等于动作全部成功。
- `action_completed`：该绑定这批动作已提交；不等于每个动作执行成功。有 `schedule` 时，入队阶段不记录，释放提交后才记录。
- 引用未知绑定：block。
- 引用自身绑定：warn“自引用事实，可能永远不成立”。
- 事实是运行期记录，编辑器不求值、不伪造状态。

## 组合器

```text
all_of:
  list:
    1. { type: "time", conditions: { from: 2.0, to: 6.0 } }
    2. any:
         list:
           1. { type: "biome", conditions: { biome: "minecraft:taiga" } }
           2. { type: "camera_fov", conditions: { from: 70, to: 90 } }
    3. { type: "rule_fact", conditions: { binding: "b_1", fact: "succeeded" } }
```

- `list` 必须非空；元素必须是对象且带非空字符串 `type`。
- 子项类型只能是 12 种中的一种；触发器类型（`location` 同名是例外，规则侧自己的 `location`）、触发器前置、触发器专属类型都不可用。
- 嵌套最大 8 层（顶层 = 1）；第 8 层不再允许新增组合器。
- 子项 `conditions` 不是对象 = block；缺少 `conditions` = block（事实/状态叶子都需要数据对象）。
- `all_of` 全真才真、`any` 任一真即真；空列表 = 不满足，不改写成恒真/恒假。
- 组合器顺序 = 求值顺序，可上下移动。
- 规则条件树没有 `not`、没有 `xor`、没有权重。

## 编辑器结构

```text
规则条件
├ 根节点：类型选择 + 字段
├ 组合器：全部满足 / 任一满足
│  ├ 子项 1：类型选择 + 字段
│  └ 子项 2：组合器 …
└ 原始 JSON（只读高级块）
```

- 根节点类型选择 12 种，按组显示：状态 / 事实 / 组合。
- 切换类型时：
  - 新类型字段与旧类型不重叠的，旧数据进“旧字段”只读块；
  - 不静默删旧字段；
  - 用户确认后才清空。
- 子项类型切换同理。
- 组合器子项可新增、复制、删除、上下移动。
- 不提供“从触发器条件导入”；两套类型白名单不同，导入会制造非法类型。
- 不提供“实时求值预览”。

## 摘要格式

- `time`：`本地 t ≥ 3.0s` / `本地 t 2.0–6.0s` / `本地 t ≥ 2.0s`
- `location`：`维度 exact: id` + `方体 (…)–(…)` / `球形 (…) r=r`
- `facing`：`yaw a→b，pitch c→d`
- `biome`：`群系 = pattern`
- `dimension`：`维度 = pattern`
- `camera_pos`：`相机位于 方体/球形`
- `camera_facing`：`相机 yaw a→b，pitch c→d`
- `camera_fov`：`FOV 70–90°`
- `clip_fact`：`片段 intro 已开始/已完成`
- `rule_fact`：`绑定 b_1 条件成立/动作批次已提交`
- `all_of`：`全部满足` + 子项缩进
- `any`：`任一满足` + 子项缩进

长摘要换行，不截断；未知类型显示原文只读。

## 校验

| 检查 | 级别 | 处理 |
|---|---|---|
| 根 `type` 缺失/非字符串 | block | 条件区红框 |
| `type` 不是 12 种 | block | 显示“v1 不支持/未知” |
| `time` 三参数全缺 | block | 时间行红框 |
| `time` 同时写 `at` 与 `from/to` | block | 互斥红框 |
| `location` 无维度无区域 | block | “永不满足” |
| `location` 区域缺坐标分量 | error | “永不满足” |
| `facing` 缺角度 / pitch 越界 | block/error | 行红框 |
| `camera_pos` 无区域 | block | 行红框 |
| `camera_pos` 同时写方体和球形 | warn | “方体优先，球形被忽略” |
| `camera_fov` 无参数 | block | 行红框 |
| `clip_fact.clip` 缺失/未知 | block | 引用行红框 |
| `rule_fact.binding` 缺失/未知 | block | 引用行红框 |
| `rule_fact` 引用自身绑定 | warn | “自引用事实” |
| 组合器 `list` 缺失/非数组/空 | block | 节点红框 |
| 组合器子项缺 type/conditions | block | 子项红框 |
| 组合器超过 8 层 | block | 第 8 层禁用组合器 |
| 组合器使用触发器专属类型 | block | “规则条件不支持该判定源” |
| 未知字段 | info | 只读块，不删除 |

## 验收标准

1. 12 种类型都能建；类型选择分组正确，不出现 27 种触发器类型。
2. `time` 根节点写 `{type:"time", from:2, to:6}`：摘要“本地 t 2–6s”。
3. `time` 同时写 `at` 与 `from`：显示互斥，不静默按 at。
4. `location` 维度写 `minecraft:*`：显示“精确匹配”，提示不是通配。
5. `location` 方体+球形：摘要 OR，求值先方体后球。
6. `camera_pos` 方体+球形：警告“方体优先，球形被忽略”，界面默认只允许一种。
7. `facing` 起止 yaw 相同：摘要“整圈”。
8. `clip_fact` 引用未知片段：block，不自动创建片段。
9. `rule_fact` 引用自身绑定：warn“自引用事实”。
10. 组合器子项 `rule_fact`：写成 `{type, conditions:{binding, fact}}`，不是顶层 `binding`。
11. 组合器第 8 层：不能新增组合器；第 9 层旧数据报错。
12. 组合器内写 `script_played`：报“规则条件不支持触发器前置”，不写入。
13. 同一规则绑两个片段：两个绑定的 `time` 各自按片段本地时间，详情显示“相对绑定片段”。
14. 保存重开：12 种条件、嵌套顺序、事实引用原样恢复。
