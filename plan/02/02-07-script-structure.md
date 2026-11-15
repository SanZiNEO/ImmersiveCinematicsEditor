# 02-07 script_structure 字段表

## 目标

登记 `script_structure` 段：`clips` / `rules` / `rule_bindings` / `paths` 四个结构，以及四组枚举。来源：`SchemaExporter.scriptStructure()`（151–246）。这一段的字段是**脚本结构**，不是轨道 objects；两者不混。

## 四个结构

### `clips`

| 字段 | type | required | 说明 |
|---|---|---|---|
| `id` | string | false | 片段 id；存在则脚本内唯一 |
| `track` | string | true | 轨道类型；枚举 = 02-04 的轨道类型表 |
| `duration` | number | true | 片段时长，`!= 0` |
| `objects` | object | true | 该片段的对象表；键必须是 02-04 的 objects 路径 |
| `exit` | object | false | 退出策略；`kind` 枚举见 `exit_kinds`，其余字段按 kind 分支 |

`clips` 是**独立片段**（顶层 `clips[]`）。内联片段在 `timeline.tracks[].clips[]`，按该段字段表解析；本文件只登记顶层独立片段。

### `rules`

| 字段 | type | required | 说明 |
|---|---|---|---|
| `id` | string | true | 规则 id，脚本内唯一 |
| `condition` | object | true | 条件；结构按 `TriggerDefinition` 登记 |
| `actions` | array | true | 动作数组；`action_types` 枚举见下 |
| `policy` | object | false | 执行策略 |

`policy` 子字段：

| 子字段 | type | default | 说明 |
|---|---|---|---|
| `once` | bool | `true` | 只触发一次 |
| `cooldown` | number | `0` | 冷却秒 |
| `mode` | string | `"enter"` | 枚举取自 `RuleDefinition.MODES` |
| `dwell` | number | `0` | 停留秒 |
| `timeout` | number | `-1` | 超时秒；`-1` = 不超时 |
| `on_timeout` | array | 空 | 超时动作 |

### `rule_bindings`

| 字段 | type | required | 说明 |
|---|---|---|---|
| `id` | string | true | 绑定 id，脚本内唯一 |
| `rule` | string | true | 引用 `rules[].id` |
| `clip` | string | true | 引用 `clips[].id` |
| `gate` | object | true | `{at: number}`，绑定生效的时间点 |
| `control` | string | false | 控制方式；枚举取自 `RuleControl.SCRIPT_NAMES` |
| `schedule` | object | false | 调度；字段按 `RuleReleaseKind` 登记 |
| `exit` | object | false | 退出策略；同 `clips.exit` |

### `paths`

| 字段 | type | required | 说明 |
|---|---|---|---|
| `id` | string | true | 路径 id，脚本内唯一 |
| `clip` | string | true | 引用 `clips[].id` |
| `from` | number | true | 起点时间；必须是目标片段 position 节点时间 |
| `to` | number | true | 终点时间；必须与 `from` 相邻 |
| `axes` | array | false | `x` / `y` / `z` 的子集；默认三轴 |
| `geometry` | object | false | `{type, control_points}`；`type` 枚举 = `line` + 02-06 的曲线类型 |
| `timing` | object | false | `{type, points}`；`type` 枚举 = `linear` / `keyframes` |

`geometry` 的参数按曲线类型分支：`line` 用通用 `control_points`；`bezier` / `arc` / `nurbs` 等按 02-06 的参数表。`script_structure` 这里只登记 `type` 的枚举域与 `control_points` 的通用数组形状，**不重抄 02-06 的曲线参数**。

`timing.points` 的形状由 `timing.type` 决定：`linear` 用端点时间；`keyframes` 用 `{time,value}` 序列。具体解析按 `PathTimingParser`，目录只登记类型与字段名。

## 四组枚举

| 枚举 | 值来源 | 用途 |
|---|---|---|
| `action_types` | `RuleActions.ACTION_TYPES_V1` | `rules.actions[].type` |
| `exit_kinds` | `ClipExitPolicyParser.KIND_NAMES` | `clips.exit.kind` / `rule_bindings.exit.kind` |
| `schedule_kinds` | `RuleReleaseKind.SCRIPT_NAMES` | `rule_bindings.schedule.kind` |
| `condition_fact_types` | `SchemaExporter.scriptStructure()` 的 `condition_fact_types` | 条件里的 `clip_fact` / `rule_fact` |

`condition_fact_types` 两族：

- `clip_fact`：`{clip, fact}`，`fact` = `started` / `completed`。
- `rule_fact`：`{binding, fact}`，`fact` = `succeeded` / `action_completed`。

枚举值一律按源码登记，不在目录里增删；源码加值 → 重算 `catalogHash`。

## 未知键策略

- 四个结构内部的未知键：**拒绝**（运行时结构是封闭的）。
- 根对象的未知键：保留 + 警告，不归这一段。
- 未知 `geometry.type`：拒绝，不回落 `line`。
- 未知 `timing.type`：拒绝，不回落 `linear`。
- 未知 `action_types` / `exit_kinds` / `schedule_kinds`：拒绝，不猜。

## 验收标准

- 四个结构逐条可查：`scriptSection('clips')` 返回 5 个字段，`scriptSection('rules')` 返回 4 个 + `policy` 6 个子字段。
- `scriptEnum('action_types')` / `exit_kinds` / `schedule_kinds` / `condition_fact_types` 全部有值，且与源码一致。
- `paths.geometry.type` 只接受 `line` + 02-06 的 11 种曲线；`spline` 之类未登记值 → 拒绝。
- `paths.timing.type` 只接受 `linear` / `keyframes`；其他 → 拒绝。
- `rule_bindings.rule` 指向不存在的 `rules[].id` → 引用错误；引用完整性按同一规则处理。
- 目录里没有把 `clips` 的内联片段和独立片段混成一套字段。
