# 10 规则绑定编辑（rule_bindings[]）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`09-rules-definition-editor.md`、`11-rule-actions-and-release.md`、`13-loop-exit-branch-attribution.md`

## 1. 职责

编辑 `rule_bindings[]`：把一条规则定义绑到某个片段、在片段的执行局部时间开一扇门、选择到达门之后的行为（`observe`/`hold`）、配置动作释放条件（`schedule` 五形态）、可选地覆盖入口出口（`exit`）。这是「规则什么时候生效、动作什么时候执行」的唯一入口。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 数据载体 | `MOD:script/rule/RuleBinding.java:20-45` | `id/definition/target/gateTime/control/schedule/exitOverride` |
| 构造校验 | `RuleBinding.java:58-88` | 绑定 id 非空；definition/target/control 非空；`gateTime ≥ 0`；有限片段上 `gateTime ≤ duration` |
| 解析 | `MOD:script/rule/RuleCollectionParser.java:240-300`（`parseRawBinding`） | 键白名单 `id/rule/clip/gate/control/schedule/exit`（`:49-50`）；未知键报错 |
| `gate` 解析 | `RuleCollectionParser.java:302-330`（`parseGate`） | `gate` 必填、只有 `at`；`at ≥ 0`；有限片段 `at ≤ duration` |
| `control` | `RuleCollectionParser.java:259-270` | 缺省 `observe`；未知值报错 |
| `schedule` | `RuleCollectionParser.java:272-284` | 对象；`RuleSchedule.validate` 校验并返回 `fact` 依赖的绑定 id |
| `exit` | `RuleCollectionParser.java:286-295` | `ClipExitPolicyParser.parse` |
| 两遍构造 | `RuleCollectionParser.java:200-236` | 先收集全部绑定 id（`fact` 允许前向引用），再按依赖顺序构造；循环依赖报错 |
| 运行期：门 | `MOD:script/rule/runtime/RuleRuntime.java:329-345` | `localTime < gateTime` → 释放持有并跳过 |
| 运行期：control=hold | `RuleRuntime.java:374-385` | 门后未成立 → `holds.acquire("rule:"+bindingId)` |
| 运行期：timeout 起点 | `RuleRuntime.java:345-348`（`activation.arm(nowReal)`） | 门首次满足的实时时刻 |
| 校验：可达性 | `MOD:script/ScriptValidator.java:599`（`checkHoldReachability`） | 绑定级静态可达性检查 |
| schema 导出 | `MOD:script/schema/SchemaExporter.java:188-206` | `script_structure.rule_bindings` + `gate`/`control`/`schedule`/`exit` |
| 出口类型 | `MOD:script/rule/ClipExitPolicyParser.java:29-33`（`KIND_NAMES`） | `continue/goto/return/end_execution/end_script` |
| 编辑器现状 | `ED:` grep `rule_bindings` | **0 命中** |

**关键事实**：`gate.at` 是**目标片段执行内部的局部秒**，不是时间轴绝对秒。同一片段循环执行多次时，每次执行都会重新开同一扇门（`RuleRuntime.java:329-345` 用 `execution.localTime()`）。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 面板 | 无 | 规则面板下半部「绑定」列表 |
| `rule` / `clip` | 无法编辑 | 下拉（规则定义 id / 片段 id） |
| `gate.at` | 无法编辑 | 数字框 + 「局部秒」提示 + 越界校验 |
| `control` | 无法编辑 | `observe` / `hold` 单选 + 语义说明 |
| `schedule` | 无法编辑 | 五形态选择器（见 11） |
| `exit` | 无法编辑 | 五类型 + `target`/`entry_time`（仅 `goto`） |
| 引用保护 | 无 | 删除规则/片段前检查绑定引用 |

### 3.2 `control` 的语义（必须写进 UI）

| 值 | 行为 | 风险 |
|---|---|---|
| `observe`（缺省） | 非阻塞：判定不成立也继续播放；成立则提交动作 | 无 |
| `hold` | 到达门后判定未成立即持有实例（挂起），成立或被释放后继续 | 若永远不成立且无 `timeout`，实例永久挂起 → 必须给警告 |

`hold` 的释放来源：判定成功、超时、门不再满足（片段执行切换/播放头回退到门之前）、`reset`。UI 必须能说明「这条绑定会在什么条件下解除挂起」。

### 3.3 `exit` 的作用（与 13 的边界）

`rule_bindings[].exit` 是**入口覆盖**：只在这条绑定的目标片段**由分支启动**时生效（`RuleBinding.exitOverride()` 传给 `ClipBranchController.launch`，见 `MOD:script/rule/runtime/RuleActionRunner.java:190-196`）。

因此：

- 它**不是**片段自身的默认出口（那是片段属性，归 05/13）。
- 它**不生效**于主线片段（主线没有「入口覆盖」的概念）。
- UI 必须提示「仅当该片段被 `goto_clip` 启动时生效」。

### 3.4 拟新建（提案）

- `ED:components/rules/RuleBindingsPanel.vue`（提案）：绑定列表 + 选中编辑。
- `ED:components/rules/RuleBindingEditor.vue`（提案）：`id`/`rule`/`clip`/`gate`/`control`/`schedule`/`exit`。
- `ED:components/rules/GateField.vue`（提案）：`at` + 片段时长参照 + 越界提示。
- `ED:components/rules/ScheduleEditor.vue`（提案）：五形态（细节见 11）。
- `ED:components/rules/ExitOverrideEditor.vue`（提案）：复用片段出口的字段形态，但标题明确「入口覆盖（仅分支启动生效）」。

**不新建**：片段出口编辑器（05/13 负责）；本文件只复用其字段形态。

## 4. 输入输出与字段约束

`rule_bindings[]` 元素：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | 是 | `^[A-Za-z0-9_]{1,64}$`；脚本内唯一 |
| `rule` | string | 是 | 必须命中 `rules[].id` |
| `clip` | string | 是 | 必须命中片段 id（内联/独立同命名空间，`MOD:script/CinematicScript.java:117`） |
| `gate` | object | 是 | `{at: number}`；只有 `at`；`≥ 0`；有限片段 `≤ duration` |
| `control` | string | 否 | `observe` / `hold`；缺省 `observe` |
| `schedule` | object | 否 | 五形态之一（见 11） |
| `exit` | object | 否 | `on_complete` + 可选 `target`/`entry_time` |

约束：
- `gate.at` 的可用上限依赖目标片段时长；片段时长变化后必须重新校验（编辑片段时长时提示「n 条绑定的门越界」）。
- `schedule.fact` 的 `binding` 可前向引用（`RuleCollectionParser.java:200-218` 先收集全部 id），但**循环依赖报错**（`:222-236`）。
- `exit.on_complete=goto` 必须带 `target`；其它类型带 `target` 报错（`ClipExitPolicy.java:22-40`）。
- 删除片段前检查：`rule_bindings[].clip`、`schedule.clip`、`exit.target` 三处引用（前两处是本文件，第三处同属本文件）。

## 5. 修改步骤

1. 新建 `RuleBindingsPanel.vue` + `RuleBindingEditor.vue`，挂到规则面板下半部。
2. `rule` 下拉：来自 `rules[]` 的 id；`clip` 下拉：来自文档内全部片段 id（内联 + 独立）。
3. `GateField.vue`：显示目标片段时长；`at > duration` 时红字并禁止保存该项。
4. `control` 单选 + `hold` 的释放来源说明；`hold` 且 `timeout=-1` 时红条「可能永久挂起」。
5. `ScheduleEditor.vue`（11）；`ExitOverrideEditor.vue`。
6. 引用检查：删除规则/片段时遍历绑定（含 `schedule.clip`、`exit.target`）。
7. 保存前把 `rule_bindings[i]` 的 issue 映射到行（08）。

## 6. 禁止修改

- 不得把 `gate.at` 解释成时间轴绝对秒。
- 不得给 `gate` 增加 `at` 以外的键（解析器报「未知键」）。
- 不得把 `control=hold` 的缺省释放来源说成「自动恢复」（只有成功/超时/门失效/reset 才释放）。
- 不得让 `exit` 覆盖作用于主线片段（语义上不生效）。
- 不得删除仍被引用的规则或片段。
- 不得在 `schedule.fact` 里引用不存在的绑定（解析器报错）。

## 7. 两分支承载

- Forge 1.20.1：解析在 common；运行在客户端主线程（`RuleRuntime`）。
- Fabric：同源，未实机验证。

## 8. 前置

- `09-rules-definition-editor.md`（`rules[]` 存在）。
- `11-rule-actions-and-release.md`（`schedule` 五形态）。
- `02-model-contracts`（片段 id 命名空间与时长口径）。

## 9. 验收

**正例**

- 绑定 `b1`：`rule=r_gate`、`clip=c1`（时长 5s）、`gate.at=1.5`、`control=observe`、无 `schedule`。
- 保存后 `script.validate` 0 issue；播放到 c1 的 1.5s 时判定，成立则立即执行动作。
- `gate.at=6`（超过 5s）：UI 红字并阻止保存；强行改文件后解析期报「越界」。
- `control=hold` + `policy.timeout=-1`：红条「可能永久挂起」。
- `schedule={on:"clip_start", clip:"c2"}`：动作在 c2 下一次执行开始时提交。
- `schedule={on:"fact", binding:"b2", fact:"succeeded"}`：允许 `b2` 声明在后（前向引用），但 `b1→b2→b1` 循环被拒。
- `exit={on_complete:"goto", target:"c3", entry_time:0.5}`：仅当 c1 由 `goto_clip` 启动时生效。

**反例**

- `gate.at` 被当作绝对秒（例如填 12 而片段只有 5s）→ 失败。
- `gate` 写了 `{at:1, foo:2}` → 失败。
- `exit` 在主线片段上被描述为「生效」→ 失败。
- `schedule.fact` 循环依赖被接受 → 失败。

## 10. 真实冒烟

1. 片段 c1（5s），绑定 `gate.at=1`，`control=observe`，规则条件 `time: from 2 to 3`。
2. 播放：1s 门开；2–3s 条件成立 → 动作执行；3s 后条件不成立但播放继续（observe 非阻塞）。
3. 改 `control=hold`：1s 门开后未成立 → 内容位置停住；到 2s 条件成立 → 继续播放。
4. 加 `policy.timeout=4` + `on_timeout=[resume]`：条件永不成立时 4s 后恢复。
5. `schedule=delay 0.5`：动作在判定成功后 0.5 真实秒执行（挂起不冻结）。

## 11. 完成定义

- `rule_bindings[]` 七字段全部可编辑，默认与解析器一致。
- `gate.at` 的局部秒语义与越界校验在 UI 上明确。
- `control=hold` 的挂起与释放来源可见，永久挂起有红条。
- `exit` 的「仅分支启动生效」写进 UI 文案。
- 删除规则/片段有引用保护（含 `schedule.clip` 与 `exit.target`）。
