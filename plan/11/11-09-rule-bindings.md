# 11-09 规则绑定

## 目标

把顶层 `rule_bindings[]` 做成“规则 × 片段”的绑定：每条绑定有自己的时间门、控制方式、动作调度和出口覆盖。规则定义是共享的，绑定是独立运行入口；同一规则可以有多条绑定，各自独立。

## 字段面

```text
rule_bindings[]:
  id        必填，脚本内唯一
  rule      必填，引用 rules[].id
  clip      必填，引用片段 id
  gate      必填，对象，只有 at
  control   可省，observe / hold
  schedule  可省，五种释放条件
  exit      可省，出口覆盖
```

- `id` 合法形态 `[A-Za-z0-9_]{1,64}`，与规则 id、片段 id 同字符集。
- `rule` 必须命中当前脚本的 `rules[]`。
- `clip` 必须命中当前脚本的片段；内联片段和独立片段同一 id 命名空间。
- 未知键报错；绑定对象不接受 `condition` / `actions`，这些属于规则定义。

## 时间门

```text
"gate": { "at": 2.5 }
```

- `at` 必填，有限数字，>=0，单位是目标片段执行内部的局部秒。
- 有限片段：`0 <= at <= duration`。
- 无限片段：`at >= 0`，没有上界。
- `gate` 只有 `at` 一个键；写其他键报错。
- 条件只有在“片段已开始且 localTime >= at”后才参与；门之前不判条件、不持有。
- 片段时长变短导致 `at` 越界：报错，不静默夹到 duration。
- 摘要：`chapter2 @2.5s`。

## 控制方式

| control | 语义 | 缺省 |
|---|---|---|
| `observe` | 非阻塞：门后条件不成立也继续播放，成立才提交动作 | 是 |
| `hold` | 门后条件未成立即持有实例（挂起），成立/超时/门失效/执行切换后释放 | 否 |

- `control` 缺省 `observe`；写其他值报错。
- `hold` 不是动作，不放在 `actions` 里。
- `hold` 的等待上限由规则 `policy.timeout` 表达：`-1` = 无限等待。
- 界面在绑定详情显示“观察 / 持有”，并在 `hold` 时显示“无限等待/超时 Ns”。

## 动作调度

`schedule` 可省；省略 = 判定成功后立即提交。

五种形态：

| `on` | 参数 | 语义 |
|---|---|---|
| `clip_start` | `clip` | 目标片段下一次执行开始时提交 |
| `clip_complete` | `clip` | 目标片段执行完成时提交 |
| `local_time` | `clip` + `at` | 目标片段执行到达局部时间时提交 |
| `delay` | `seconds` | 判定成功后经过真实秒数提交；挂起不冻结 |
| `fact` | `binding` + `fact` | 另一绑定的最近一次激活事实成立时提交 |

### 约束

- `on` 必填，只能五种。
- 各形态字段严格按表；未知键 / 多余键报错。
- `clip_start` / `clip_complete` / `local_time` 的 `clip` 必须是已存在片段；可以是绑定目标片段，也可以是别的片段。
- `local_time.at` 有限数字，>=0；不静默夹取。
- `delay.seconds` 有限数字，>=0；按真实秒数，不是片段本地时间，挂起不冻结。
- `fact.binding` 必须是已存在绑定 id；允许前向引用；形成循环依赖报错。
- `fact.fact` 只能是 `succeeded` / `action_completed`，与条件树 `rule_fact` 同一套词汇。
- 调度只影响“动作提交时点”，不改变规则成功判定；成功事实在条件成立时记录。

### 调度循环

- `fact` 调度可以前向引用，但不能成环（A 等 B、B 等 A）。
- 绑定详情显示依赖链：`b1 → b2 → b3`；成环时标出环并报错。
- `rule_fact` 条件引用绑定也会形成等待关系，但解析器只对 `schedule.fact` 做循环检测；编辑器对条件引用给 warn，不冒充解析器报错。

## 出口覆盖

```text
"exit": { "on_complete": "goto", "target": "chapter3", "entry_time": 0.0 }
```

五种出口：

| on_complete | 含义 |
|---|---|
| `continue` | 结束当前分支，回主线 |
| `goto` | 转到目标片段 |
| `return` | 结束当前分支，回主线（与 continue 当前运行语义相同） |
| `end_execution` | 结束当前执行 |
| `end_script` | 结束整个脚本 |

- `on_complete` 必填，只能五种。
- 只有 `goto` 允许 `target` / `entry_time`；其他类型带这两个键报错。
- `goto.target` 必须是已存在片段；`entry_time` 有限、>=0，缺省 0。
- `exit` 省略 = 用片段默认出口，不写“继承”对象。
- 绑定 `exit` 是**入口出口覆盖**：只在本绑定的动作 `goto_clip` 启动分支时，作为该分支的出口策略。
- 它不在“本绑定自己的 `clip` 完成”时自动生效；主线片段完成走片段默认出口。
- 它不作用于 `goto` 链的下一跳；下一跳用目标片段自身默认出口。
- 绑定没有 `goto_clip` 动作时，`exit` 字段合法但当前不会被使用；详情显示“未被本绑定 goto 使用”。
- 动作 `exit` 结束当前播放实例，也不是绑定 `exit`。

### 三个“退出/跳转”再区分

| 名称 | 作用时点 |
|---|---|
| 动作 `goto_clip` | 规则成立时立刻开新分支 |
| 绑定 `exit` | 该分支完成后的去向 |
| 动作 `exit` | 立刻结束当前播放实例 |

## 绑定详情

```text
绑定 b_chapter2
├ 身份：id / 规则 / 目标片段 / 引用数
├ 时间门：gate.at / 片段时长 / 合法范围
├ 控制：observe / hold
├ 调度：立即 / clip_start / clip_complete / local_time / delay / fact
├ 出口：继承片段 / continue / goto / return / end_execution / end_script
├ 运行摘要：规则条件 + 动作数 + 策略
└ 诊断
```

### 身份

- 绑定 id 可重命名；重命名是事务性的：
  - 更新所有 `schedule.fact.binding`；
  - 更新所有规则条件树里的 `rule_fact.binding`；
  - 任一处无法重写则整体不应用。
- 绑定 id 被引用时删除：默认禁用，列出引用位置（调度 / 条件树）。
- 规则 id 被删除/重命名时，绑定 `rule` 引用由 11-06 的事务处理；本页只读展示。
- 目标片段被删除时，绑定红框“片段不存在”，不能应用。

### 时间门

- 显示片段时长与合法范围；无限片段显示“无上界”。
- `at` 越界红框，不自动夹取。
- 拖动时间轴改 gate：只写 `gate.at`，不移动片段。

### 调度

- 选择“立即 / 片段开始 / 片段完成 / 局部时间 / 真实延迟 / 事实”。
- 片段选择器只列当前脚本片段；`local_time.at` 显示目标片段时长提示。
- `delay` 标注“真实秒，挂起不冻结”。
- `fact` 选择绑定 id + 事实；显示依赖链与循环错误。

### 出口

- 选择“继承片段 / continue / goto / return / end_execution / end_script”。
- 只有 `goto` 显示目标片段 + 入口时间；其他类型隐藏并清空这两个键（用户确认后）。
- 出口摘要固定显示三种“退出/跳转”的区别。

## 列表与树

- 行为树中绑定挂在规则下面；同时可在片段详情看到“该片段的绑定”。
- 绑定行显示：`id · 规则 · 片段 @gate · observe/hold · 立即/调度 · 出口`。
- 同一规则可有多条绑定，按声明顺序；不合并。
- 未绑定规则在规则区显示“未绑定”；无规则引用的绑定是错误，不隐藏。

## 校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `rule_bindings` 非数组 | block | 绑定区红框 |
| `id` 缺失/非法/重复 | block | 身份行红框 |
| `rule` 缺失/未知 | block | 规则行红框 |
| `clip` 缺失/未知 | block | 片段行红框 |
| `gate` 缺失/非对象 | block | 时间门红框 |
| `gate.at` 缺失/非有限/负数 | block | 时间门红框 |
| 有限片段 `gate.at > duration` | block | 越界红框 |
| `gate` 未知键 | block | 只读报错 |
| `control` 非 observe/hold | block | 控制行红框 |
| `schedule` 非对象 | block | 调度区红框 |
| `schedule.on` 缺失/未知 | block | 调度行红框 |
| 调度形态缺参数/多余键 | block | 参数行红框 |
| `schedule.delay.seconds` 负数/非有限 | block | 延迟红框 |
| `schedule.local_time.at` 负数/非有限 | block | 局部时间红框 |
| `schedule.fact.binding` 未知 | block | 引用红框 |
| `schedule.fact` 成环 | block | 依赖链红框 |
| `exit` 非对象 / `on_complete` 缺失/未知 | block | 出口区红框 |
| 非 goto 带 target/entry_time | block | 出口行红框 |
| goto 缺 target / target 未知 | block | 目标红框 |
| goto entry_time 负数/非有限 | block | 入口时间红框 |
| 绑定 id 重命名冲突/引用重写失败 | block | 整体不应用 |
| 删除被引用绑定 | block | 列出引用 |
| 删除被绑定规则 | block | 由 11-06 处理 |

## 验收标准

1. 绑定 `b1` 引用 `rule_1` + `clip intro` + `gate.at=0`：列表显示 `intro @0s`。
2. 有限片段 `gate.at=5` 超过 duration=3：红框越界，不自动夹到 3。
3. 无限片段 `gate.at=100`：允许，显示“无上界”。
4. `control` 省略：显示 observe；`hold` 显示“门后未成立才持有”。
5. `schedule` 省略：显示“立即提交”。
6. `clip_start` / `clip_complete` / `local_time` 的 clip 可选其他片段；未知片段报错。
7. `delay` 显示“真实秒，挂起不冻结”；负数报错。
8. `fact` 前向引用允许；A→B→A 显示循环依赖并 block。
9. `exit` 省略：显示“继承片段”；不写空 exit 对象。
10. `goto` 有 target/entry_time；`continue` 带 target 报错。
11. 重命名绑定 id：调度引用与 `rule_fact` 条件引用同步更新；一处失败整体不应用。
12. 删除被调度/条件引用的绑定：禁用并列出引用。
13. 同一规则两条绑定：两条独立显示，不合并；各自的 gate/control/schedule/exit 独立。
14. 绑定详情与片段详情对同一绑定显示一致。
