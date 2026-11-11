# 13 循环、退出与分支的 UI 归属

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`10-rule-bindings-editor.md`、`11-rule-actions-and-release.md`、`../05-timeline-workspace/README.md`

## 1. 职责

把「循环 / 退出 / 分支」三个概念拆清并各自钉到一个 UI 上，避免同一个字段在两个面板里都能改、或某个语义根本没有 UI。本文件是**归属表 + 边界约束**，不重复定义字段（字段在 05 与 10/11）。

## 2. 现有事实（源码锚点）

### 2.1 循环

| 概念 | 字段 | 锚点 | 语义 |
|---|---|---|---|
| 片段执行循环 | `clip.loop`（bool） | `MOD:script/ScriptParser.java:374-380`；`MOD:script/Clip.java:155-157` | 按次数重复执行该片段 |
| 循环次数 | `clip.loop_count`（int） | `ScriptParser.java:381-384`；`Clip.java:159-161` | `< 0` = 无限；`0` 解析期修正为 1（`ScriptParser.java` 注释） |
| 循环模式 | `clip.loop_mode`（`repeat`/`pingpong`） | `ScriptParser.java:385-390`；`MOD:script/execution/LoopMode.java:6-27` | `repeat` 正向重复；`pingpong` 正反交替 |
| 执行方向 | 派生 | `MOD:script/execution/ExecutionDirection.java:14-17` | `pingpong` 偶数次正向、奇数次反向 |
| 展开窗口末端 | 派生 | `Clip.java:203-214`（`getWindowEnd`） | `start + duration × max(1, loopCount)`；无限则抛 |
| 宏观循环 | `meta.macro_loop` / `macro_loop_count` / `macro_loop_mode` | `ScriptParser.java:220-236`；`MOD:script/schema/MetaSchemas.java:38-40` | 整个脚本循环；`-1` 无限；`0` 按 1 |
| 无限性统一判据 | 派生 | `Clip.java:189-192`（`isEffectivelyInfinite`） | 时长负 或 无限执行循环 |

### 2.2 退出（片段出口）

| 概念 | 字段 | 锚点 |
|---|---|---|
| 出口类型 | `exit.on_complete` ∈ `continue`/`goto`/`return`/`end_execution`/`end_script` | `MOD:script/execution/ClipExitKind.java:8-20`；`MOD:script/rule/ClipExitPolicyParser.java:28-33` |
| 目标与入口 | `exit.target`、`exit.entry_time` | `ClipExitPolicyParser.java:26`（键白名单）、`:36-60` |
| 契约 | `GOTO` 必须带 `target` 且 `entry_time ≥ 0`；其余类型两者必须缺省 | `MOD:script/execution/ClipExitPolicy.java:20-40` |
| 默认出口 | `CONTINUE` | `ClipExitPolicy.java:17` |
| 优先级 | 入口覆盖 > 片段默认 > `CONTINUE` | `MOD:script/execution/ClipExitResolver.java:44-49` |
| 片段默认出口载体 | `clip.exit`（内联/独立） | `docs/SCRIPT_FORMAT.md` §6；`SchemaExporter.java:155-158`（`clips.exit`） |
| 绑定入口覆盖 | `rule_bindings[].exit` | `MOD:script/rule/RuleBinding.java:44`、`:100-103`（`exitOverride`） |

### 2.3 分支

| 概念 | 锚点 | 说明 |
|---|---|---|
| 分支启动 | `MOD:script/execution/ClipBranchController.java:114-140`（`launch`） | 单分支、无嵌套/调用栈；已在分支中 / 目标不在账本 / 入口时间非法 → false |
| 分支出口派发 | `ClipBranchController.java:1-30`（类注释）、`applyExit` | 主线与分支同一处派发；`GOTO` 链式启动新目标（新目标用自身默认策略） |
| 失败回滚 | `ClipBranchController.java:26-28`、`fail` | 恢复 launch 时的账本快照 + 播放头；不执行正常出口策略 |
| 触发分支的动作 | `goto_clip` | `MOD:script/rule/runtime/RuleActionRunner.java:137-206` |
| 完成事实 | `ClipBranchController` 只在 `done()` false→true 时派发 | seek 跳过的片段不算完成（类注释明确） |
| 显式执行依赖 | `MOD:script/execution/ExecutionDependency.java`、`DependencyKind.java` | **未接入脚本 JSON**（全仓库除 `execution/` 内与 `ExecutionDiagnostics` 外无引用） |
| 依赖诊断 | `MOD:script/execution/ExecutionDiagnostics.java:28-60`（`check`） | **无调用点**（grep 仅自身） |

## 3. 归属表（本轮结论）

| 概念/字段 | 唯一 UI 归属 | 轮次 | 不得出现在 |
|---|---|---|---|
| `clip.loop` / `loop_count` / `loop_mode` | 片段属性面板 | 05 | 触发器面板、规则面板 |
| `meta.macro_loop` / `macro_loop_count` / `macro_loop_mode` | 脚本设置（文档顶栏/脚本 meta 区） | 05 | 片段属性、规则面板 |
| `clip.exit`（内联片段与独立片段） | 片段属性面板 | 05 | 规则面板 |
| `rule_bindings[].exit` | 规则面板的绑定编辑 | 11（10） | 片段属性面板 |
| `goto_clip` 动作 | 规则面板的动作列表 | 11（11） | 片段属性面板 |
| 分支目标片段自身的 `exit` | 片段属性面板（与上一行不冲突：一个是「启动者」，一个是「被启动者的默认出口」） | 05 | 规则面板 |
| 显式执行依赖 | **无**（格式未接入） | — | 任何面板（不得发明字段） |
| EVENT/MOD_EVENT片段记录 | clip.effects中的记录组，06基础记录/11专用内容；05主轴只排列片段 | 06/11 | 主轴节点/记录子轨、触发器事实编辑、规则动作编辑 |
| 触发器（`meta.triggers[]`） | 触发器面板 | 11 | 规则面板 |
| 规则（`rules[]` / `rule_bindings[]`） | 规则面板 | 11 | 触发器面板 |

### 3.1 三个容易混淆的「出口」

| 名称 | 载体 | 何时生效 | 谁的 UI |
|---|---|---|---|
| 片段默认出口 | `clip.exit` | 该片段（主线或分支）正常完成时 | 片段属性 |
| 绑定入口覆盖 | `rule_bindings[].exit` | **仅当**该绑定的目标片段由 `goto_clip` 启动时 | 规则面板 |
| 规则动作 `exit` | `rules[].actions[]` 的 `{type:"exit"}` | 动作执行时，声明式结束实例（跳过 `hold_at_end`） | 规则面板 |

三者互不替代。UI 文案必须分别命名：「片段出口」「分支入口覆盖」「规则动作：结束播放」。

### 3.2 「分支」没有独立面板

分支不是一种对象，而是「某个 `goto_clip` 动作被触发」的运行时结果。因此：

- 没有「分支列表」面板。
- 想看「谁会跳到这个片段」→ 在片段属性里显示「被 n 条 `goto_clip` 引用」+ 跳转到对应绑定（只读聚合）。
- 分支失败（launch 被拒）只记限频日志，UI 无法预先判定；只能静态提示「目标片段必须在执行账本中」。

## 4. 输入输出与字段约束（跨面板一致性）

| 约束 | 说明 |
|---|---|
| 同一字段只有一个写入口 | 见 §3 表；若两个面板都需要展示，另一个只读 |
| 片段删除保护 | 必须检查：`rule_bindings[].clip`、`schedule.clip`、`exit.target`、`goto_clip.clip`、`clip_fact.clip`、`paths[].clip` |
| 片段时长变更 | 必须提示：`rule_bindings[].gate.at` 越界、`paths[].from/to` 越界 |
| `loop_count` 变更 | 必须提示：`isEffectivelyInfinite` 可能翻转（影响 `RuleRuntime` 的「片段永不结束」判定与 `getWindowEnd` 抛异常路径） |
| 无限片段 + 依赖 | 若将来接入显式依赖，`WAIT_COMPLETION` 对无限片段永不可达（`DependencyKind.java:6-13`）——当前无 UI，不得提前造字段 |

## 5. 修改步骤

1. 05 轮的片段属性面板实现 `loop`/`loop_count`/`loop_mode` 与 `exit`（本文件只提供归属与约束清单）。
2. 11/10 的绑定编辑器实现 `rule_bindings[].exit`，标题「分支入口覆盖（仅 goto_clip 启动时生效）」。
3. 11/11 的动作编辑器实现 `goto_clip`。
4. 片段属性面板增加「被引用」只读聚合（`goto_clip` / `rule_bindings[].clip` / `schedule.clip` / `exit.target` / `clip_fact.clip`）。
5. 删除保护与时长变更提示接入 05 的片段删除/编辑流程（08 的 issue 映射可复用）。
6. 在 `shared/contracts.md` 记录「显式执行依赖未接入格式，UI 不得提供」。

## 6. 禁止修改

- 不得为 `ExecutionDependency` / `DependencyKind` 发明 JSON 字段或 UI。
- 不得把 `rule_bindings[].exit` 描述成「片段出口」。
- 不得把 `exit` 动作描述成「跳到某片段」（那是 `goto_clip`）。
- 不得在规则面板提供 `loop`/`macro_loop` 编辑。
- 不得让两个面板同时可写同一字段。
- 不得在分支失败时静默（必须限频日志；UI 无法预判的部分要说明）。

## 7. 两分支承载

- Forge 1.20.1：`Clip`/`LoopMode`/`ClipExitPolicy`/`ClipBranchController` 全在 common。
- Fabric：同源，未实机验证。

## 8. 前置

- `05-timeline-workspace`（片段属性面板的字段布局）。
- `10-rule-bindings-editor.md`、`11-rule-actions-and-release.md`。

## 9. 验收

**正例**

- 片段属性里设 `loop=true`、`loop_count=3`、`loop_mode=pingpong`：执行 3 次，方向正/反/正。
- 片段属性里设 `exit={on_complete:"goto", target:"c2", entry_time:0.5}`：片段完成后跳 c2 的 0.5s。
- 规则动作 `goto_clip{clip:"c2"}` + 绑定 `exit={on_complete:"end_script"}`：分支启动 c2，c2 完成后结束脚本（入口覆盖生效）。
- 同一片段在主线完成：使用片段默认出口（不是绑定覆盖）。
- 删除被 `goto_clip` 引用的片段：被阻止并列出引用位置。

**反例**

- 规则面板能改 `clip.loop` → 失败（双写）。
- 片段属性里出现「分支入口覆盖」→ 失败。
- UI 提供「执行依赖」字段 → 失败（格式没有）。
- `exit` 动作被描述为「跳转」→ 失败。

## 10. 真实冒烟

1. 片段 c1 设 `loop=true, loop_count=2, loop_mode=pingpong`：播放两次，第二次反向。
2. c1 设 `exit=goto c2 @0.5`：完成后跳到 c2 的 0.5s。
3. 规则动作 `goto_clip c2` + 绑定 `exit=end_script`：从规则进入 c2，c2 完成后脚本结束。
4. 主线播到 c1 自然完成：走 c1 的 `exit=goto`（不是绑定的 `end_script`）。
5. `meta.macro_loop=true, macro_loop_count=-1`：脚本无限循环；`RuleRuntime` 的「永不结束」路径不崩。

## 11. 完成定义

- §3 归属表逐行落地，无字段双写。
- 三个「出口」在 UI 文案上可区分。
- 显式执行依赖明确标注「格式未接入、无 UI」。
- 片段删除/时长变更的跨面板影响可见。
