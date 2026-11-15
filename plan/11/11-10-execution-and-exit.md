# 11-10 规则执行与出口

## 目标

把规则从“条件成立”到“动作提交”、以及分支完成后的五种出口写清楚，并说明三个容易混的退出/跳转：动作 `goto_clip`、绑定 `exit`、动作 `exit`。

编辑器不运行规则，只展示字段和诊断；运行语义按当前模组代码。

## 单绑定每帧顺序

```text
片段尚未开始 → 不建激活、不持有、不判条件
执行身份变化 → 释放旧持有，建新激活，清本激活事实
目标片段完成 → 记录完成事实
时间门：localTime >= gate.at 且 localTime >= 0
  不满足 → 释放本绑定持有，跳过
门首次满足 → 记下真实时刻（超时起算）
条件树求值
  mode=enter → 上升沿触发
  mode=dwell → 累计 dtPlayback，达到 dwell 才触发；中途断掉清零
once / cooldown 门
触发 → 记录 succeeded 事实 → 释放持有 → 提交动作
  无 schedule → 立即执行动作，随后记录 action_completed
  有 schedule → 入队等释放，暂不记录 action_completed
超时 → 门后未成功，真实时钟到点 → on_timeout 一次，标记终态
control=hold 且门后未成立 → 持有实例
```

顺序不能倒：先门后条件；先成功事实后动作；超时与成功互斥。

## 时间门

- 条件是“外层门 AND 内层条件树”。
- `localTime` 是目标片段执行内部秒，不是全局 timeline 时间。
- 片段未开始：`localTime` 可能为 0，但不得因此误判门满足；代码用执行窗口起点挡掉。
- `gate.at=0` 表示片段一开始就参与判定，不是“到 0 秒瞬间只判一次”。
- 门不满足时释放该绑定的 `hold`，不会让实例一直挂着等门。

## enter 与 dwell

### enter

- 条件从 false 到 true 的上升沿触发一次。
- 条件持续 true 不重复触发；必须先回 false 再 true。
- 每次片段执行重置边沿状态。
- `once=true` 且本次执行已成功：即使再出现上升沿也不触发。

### dwell

- 条件连续成立累计 `dtPlayback`，达到 `policy.dwell` 秒才触发。
- 中途条件断掉：累计清零。
- 挂起时 `dtPlayback=0`，驻留不推进；这是 `hold` 可能等不到 `dwell` 的原因之一。
- 首帧或播放时钟回退：`dt` 按 0，不倒退累计。

## once 与 cooldown

- `once=true`：本次片段执行内成功后不再触发；换一次执行会重置 `succeeded`，所以 `once` 是“每次执行一次”，不是“整个脚本永久一次”。
- `cooldown`：成功后设置 `cooldownUntil = 播放 elapsed + cooldown`；按播放时钟计算，跨片段执行保留，挂起时播放时钟冻结。
- 触发前同时检查 `once` 已成功与 `elapsed >= cooldownUntil`。
- 超时后 `finished=true`，本执行不再触发；下一次执行重新开始。
- 编辑器只显示“单次 / 可重复 / 冷却 Ns”，不推算具体触发次数。

## 成功与动作完成

- 条件成立即记录 `succeeded` 事实；这是规则成功，不是动作完成。
- 无 `schedule`：动作按声明顺序执行，然后记录 `action_completed`。
- 有 `schedule`：动作入队；释放条件满足并提交后才记录 `action_completed`。
- `action_completed` 表示“这批动作已提交”，不表示每个动作都成功；动作失败只跳过该动作。
- `rule_fact` 的 `succeeded` / `action_completed` 分别读这两个事实，不能互换。
- 队列按承诺顺序提交；本帧释放的动作对同帧后续判定可见。
- 待执行队列不冻结内容，但会作为脚本自然完成的依赖：有未提交动作时脚本不先结束。

## 动作调度释放

| on | 释放判据 |
|---|---|
| `clip_start` | 目标片段在承诺之后记录开始事实；或目标执行身份变化且已进入窗口 |
| `clip_complete` | 目标片段完成事实序号晚于承诺 |
| `local_time` | 目标片段活跃、局部时间 >= at，且已离开承诺帧 |
| `delay` | 真实时钟经过 seconds；挂起不冻结 |
| `fact` | 另一绑定的事实序号晚于承诺 |

- 不可满足的等待（目标片段不在账本等）会被丢弃并告警，不阻塞自然完成。
- 已经过去的 `local_time` 不补触发：必须等下一次执行或播放头前进后满足。
- `delay` 与 `cooldown` 不同：`delay` 是动作提交延迟，按真实时钟；`cooldown` 是再次触发静默，按播放时钟。

## 超时

- 起算点：时间门**首次满足**的真实时刻，不是片段开始，也不是条件首次成立。
- 只对 `timeout > 0`；`-1` 无限等待，不超时。
- 门后已成功：不再超时。
- 超时：执行 `on_timeout` 一次，标记 `timedOut` / `finished`，释放持有。
- `on_timeout` 为空也照样标记终态，不执行动作。
- 真实时钟在挂起期间照走，所以 `hold` 挂起也不能阻止超时。
- 超时动作里的 `emit_command` 当前没有服务端命令表项（命令表只编译普通 `actions`），编辑器禁用这种写法。

## 持有与挂起

### control=hold

- 门后条件未成立且未成功/未超时/未终态：持有实例，挂起内容。
- 成功、超时、门不满足、执行切换：释放该绑定的持有。
- 多个来源可同时持有；只有全部释放才恢复推进。
- 冻结期间 `localTime` 和 `dtPlayback` 不推进，`time` / `dwell` 可能永远不满足；运行时会做可达性诊断，编辑器在诊断页显示“持有等待未来局部时间/其他片段”的警告。

### pause / resume 动作

- `pause` 加 `ACTION_PAUSE` 持有；`resume` 释放全部 `ACTION_PAUSE`。
- 不影响判定持有或其他来源；最后一个来源释放后才恢复。
- 若本执行内已没有仍可触发的 `resume`，运行时会告警并自动释放 `ACTION_PAUSE`，防止卡死。
- 编辑器不强制 `pause`/`resume` 成对，也不预测自动释放。

## 出口五种

绑定 `exit` 和片段默认出口共用五种：

| on_complete | 当前运行语义 |
|---|---|
| `continue` | 分支 target：结束分支回主线；主线片段：时间轴继续 |
| `return` | 当前与 `continue` 相同：结束分支回主线；保留写法 |
| `end_execution` | 当前与 `continue` 相同：结束分支回主线；保留写法 |
| `end_script` | 结束分支并请求脚本整体结束 |
| `goto` | 结束分支并以目标片段 + 入口局部时间链式启动新分支 |

- `continue` / `return` / `end_execution` 当前行为一致，不要把它们写成三种不同结果；编辑器保留原写法，不自动改写。
- `goto` 链式启动**没有调用栈**；新目标使用自身默认出口，不继承入口覆盖。
- `goto.target` 必须存在；`entry_time` 缺省 0，>=0 有限。
- 主线片段完成时，绑定 `exit` 不生效；主线按片段默认出口走。

## 绑定 exit 的归属

- 绑定 `exit` 是**入口出口覆盖**：当本绑定的动作 `goto_clip` 启动分支时，该分支的出口取本绑定的 `exit`。
- 它不是“本绑定 `clip` 完成时自动生效”的出口。
- 它也不作用于 `goto` 链的下一跳；下一跳用目标片段自身默认出口。
- 绑定没有 `exit`：分支入口用目标片段默认出口。
- 动作 `goto_clip` 不读目标片段自己的绑定 `exit`，只读**触发这条动作的绑定**的 `exit`。

## 动作 exit

- `exit` 结束当前播放实例：设置完成原因、开始渐出、标记 stopping；渐出完成后真正停用。
- 不经过 `hold_at_end` 的拒绝门：作者显式退出不被“播完驻留”挡住。
- 只作用于触发实例；不影响其他并行实例。
- 不是绑定 `exit`，不是 `goto_clip`。
- 编辑器文案用“结束当前播放实例（渐出）”，不写“立即消失”。

## 分支启动

- `goto_clip` 是规则成立时的立即分支；目标由 `clip` + `entry_time` 指定。
- 同一实例同一时刻只允许一条分支；已在分支中或目标不在执行账本 → 启动被拒绝，动作跳过。
- 分支启动失败不改现有分支；不执行正常出口策略。
- 分支 target 完成才走出口；分支失败恢复启动快照并 seek 回原播放头。
- 新分支不是嵌套调用；没有返回栈。

## 诊断

行为页诊断区按级别显示：

| 诊断 | 触发条件 | 建议 |
|---|---|---|
| 门越界 | `gate.at > duration` | 改 at 或换片段 |
| 调度等待未知片段 | `schedule.clip` 不存在 | 选已存在片段 |
| 调度事实成环 | `schedule.fact` 循环 | 断开依赖 |
| 超时命令不可用 | `on_timeout` 有 `emit_command` | 移到普通 actions |
| 持有等待未来时间 | `hold` 且 `time.at/from` 大于冻结 localTime | 改用可达条件或 observe |
| 持有等待未开始片段 | `hold` 且 `clip_fact` 指向冻结后不会开始的片段 | 改用可达条件 |
| pause 无释放者 | 本执行没有可触发 resume | 运行时会自动释放；文档提示 |
| `continue/return/end_execution` 混用 | 三者当前同义 | 保留一种，不自动改 |

## 验收标准

1. `gate.at=2`、localTime=1：不判条件、不持有；到 2 后才判。
2. `mode=enter`：条件持续 true 只触发一次；回 false 再 true 再触发。
3. `mode=dwell=2`：条件连续 2s 才触发；中途断掉清零；挂起时不推进。
4. `once=true`：本次执行成功一次后不再触发；换一次执行可再触发。
5. `cooldown=3`：成功后 3s 播放时钟内不再触发；跨执行保留；挂起时冷却不推进。
6. 无 `schedule`：动作执行后记录 `action_completed`；`rule_fact` 可读到。
7. 有 `schedule.delay=1`：成功记录 `succeeded`，1 真实秒后才提交并记录 `action_completed`。
8. `hold` 门后未成立：实例挂起；成功/超时/门不满足/执行切换后释放。
9. `timeout=2`：门首次满足后 2 真实秒未成功，执行 `on_timeout` 一次；挂起也照走。
10. `timeout=-1`：不超时；`on_timeout` 禁用。
11. `continue` / `return` / `end_execution`：分支 target 完成都结束分支回主线；界面说明三者当前同义。
12. `end_script`：分支完成请求脚本结束；与动作 `exit` 区分。
13. `goto` 链：第一跳使用触发绑定 `exit`；第二跳使用目标片段默认出口，不继承。
14. `goto_clip` 已有分支在跑：启动拒绝，动作跳过，不弹错误中断播放。
15. 动作 `exit`：进入渐出，不是立即消失；不受 `hold_at_end` 阻挡。
16. `on_timeout` 写 `emit_command`：block，提示命令表不编译超时动作。
17. `hold` 等未来 `time.at`：诊断显示“冻结时不会到达”，不自动解除。
18. 保存重开：绑定 gate/control/schedule/exit 与规则策略原样恢复。
