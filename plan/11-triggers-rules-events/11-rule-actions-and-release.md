# 11 规则动作、释放条件与暂停

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`09-rules-definition-editor.md`、`10-rule-bindings-editor.md`、`13-loop-exit-branch-attribution.md`

## 1. 职责

编辑 `rules[].actions`、`rules[].policy.on_timeout` 与 `rule_bindings[].schedule`：9 种动作的参数表单、5 种释放条件的表单、以及 `pause`/`resume`/`hold` 造成的挂起在 UI 上如何被解释与诊断。这是本轮唯一「会卡住播放」的地方，必须写得比别处更细。

## 2. 现有事实（源码锚点）

### 2.1 动作集（9 种）

| 动作 | 参数 | 行为 | 锚点 |
|---|---|---|---|
| `camera_set` | `channels[]`（非空、不重复、`CameraChannels` 名字）+ `mode?`（`add`/`multiply`/`replace`）+ `priority?` + 各通道值（`position` 为 `{x,y,z}`，其余有限数字） | 建 `RuleModifier` 接入覆盖链，工件到片段活跃窗末注销 | `MOD:camera/rule/RuleActions.java:117-150`、`:155-215` |
| `overlay_set` | `layer_type`（v1 只有 `fade`）+ `color?` + `opacity?` + `z_index?` | 建 `FadeLayer`（owner = 实例） | `RuleActions.java:225-244` |
| `adjust_set` | 15 个校色通道（`ADJUST_CHANNELS_V1`）+ 至少一个 | 建 `ColorAdjustParams` 发布到 `MasterColorAdjust` | `RuleActions.java:248-303`、`:48-54` |
| `play_sound` | `sound`（必填，音效 id）+ `volume?` + `pitch?`（缺省 1） | `playOneShot(..., SoundSource.AMBIENT, ...)` | `RuleActions.java:305-326` |
| `exit` | 无 | `CameraManager.INSTANCE.requestDeclaredExit(instance)`（声明式退出，跳过 `hold_at_end`） | `RuleActions.java:91-93` |
| `pause` | 无 | `RuleRuntime.onActionPause()` → `holds.acquire("action:pause")` | `MOD:script/rule/runtime/RuleActionRunner.java:77`、`RuleRuntime.java:190-195` |
| `resume` | 无 | `onActionResume()` → `holds.releaseAll("action:pause")` | `RuleActionRunner.java:78`、`RuleRuntime.java:198-204` |
| `goto_clip` | `clip`（必填，片段 id）+ `entry_time?`（`≥ 0`，缺省 0） | 分支启动：`instance.branch().launch(target, entryTime, binding.exitOverride())` | `RuleActionRunner.java:109-178` |
| `emit_command` | `command`（必填，命令原文，不含前导 `/`，多条用 `&&`） | 只发动作引用 `(bindingId, actionIndex)`；服务端查表执行 | `RuleActionRunner.java:81-84`、`RuleActions.java:330-368`、`MOD:trigger/server/RuleCommandTable.java:47-79` |

白名单：`RuleActions.ACTION_TYPES_V1`（`RuleActions.java:48-51`）。`hold` **不是**动作（销项，用 `until` 无 timeout 表达，`RuleActions.java:56-58`）。

### 2.2 释放条件（schedule，5 形态）

| `on` | 额外字段 | 语义 | 锚点 |
|---|---|---|---|
| `clip_start` | `clip` | 目标片段在承诺之后记录开始事实（序号判据），或执行身份变化且已进入活跃窗 | `RuleRuntime.java:480-492`、`RuleRelease.java:22-26` |
| `clip_complete` | `clip` | 目标片段已完成，且完成事实序号晚于承诺 | `RuleRuntime.java:493-499` |
| `local_time` | `clip`、`at`（`≥ 0`） | 目标片段活跃、局部时间 `≥ at`，且已离开承诺帧 | `RuleRuntime.java:500-511` |
| `delay` | `seconds`（`≥ 0`） | 真实时钟经过 N 秒（挂起不冻结） | `RuleRuntime.java:512-513` |
| `fact` | `binding`、`fact`（`succeeded`/`action_completed`） | 另一绑定的对应事实序号晚于承诺 | `RuleRuntime.java:514-526` |

解析：`MOD:script/rule/RuleSchedule.java:63-110`；键白名单按形态（`:130-137`）；`fact` 的 `binding` 可前向引用但循环报错（`RuleCollectionParser.java:200-236`）。

### 2.3 挂起机制（关键）

| 事实 | 锚点 |
|---|---|
| 多来源账本 | `MOD:script/rule/runtime/SuspensionLedger.java:26-31`（`ACTION_PAUSE = "action:pause"`、`RULE_HOLD_PREFIX = "rule:"`） |
| 0→1 / 1→0 边沿才调 `beginSuspend`/`endSuspend` | `SuspensionLedger.java:14-19`、`RuleRuntime.java:607-625`（`updateSuspension`） |
| `hold` 持有 | `RuleRuntime.java:374-385` |
| 释放时机 | 成功、超时、门不满足、执行切换、`reset`（`RuleRuntime.java:329-345`、`:352-372`） |
| `pause` 无释放者兜底 | `RuleRuntime.java:627-643`（`releasePauseWithoutReleaser`）、`:645-669`（`hasLivePauseReleaser`） |
| 可达性诊断 | `RuleRuntime.java:671-712`（`diagnoseUnreachableHolds`，限频每「绑定×执行」一次） |
| 静态校验 | `MOD:script/ScriptValidator.java:599`（`checkHoldReachability`） |
| 挂起对时钟的影响 | `MOD:script/ScriptPlayer.java:682-700`（`beginSuspend`/`endSuspend`/`isSuspended`）；挂起期间 `getElapsedSeconds()` 恒定（`:65-66`） |

**关键事实**：`pause` 与 `resume` **不是对称的一对**——`resume` 释放的是**所有** `action:pause` 来源，但不会释放 `rule:<bindingId>` 的判定持有。因此「`pause` 后靠另一条规则的 `resume` 恢复」是可行的，但「靠 `resume` 解除 `control=hold`」不行。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 动作编辑 | 无 | 9 种动作的表单 + 参数校验 |
| 动作顺序 | 无 | 可上下移动（按声明顺序执行，`RuleActionRunner.java:67-95`） |
| `on_timeout` | 无 | 独立动作列表（可为空） |
| `schedule` | 无 | 5 形态 + 依赖选择器 |
| 挂起诊断 | 无 | 「挂起链」只读视图 + 无释放者红条 |
| `goto_clip` | 无 | 片段选择器 + `entry_time` |
| `emit_command` | 无 | 命令文本框 + 权限/预览提示 |

### 3.2 挂起链视图（本文件的核心交付）

对每条 `rule_binding`，UI 计算并显示：

```
绑定 b1（control=hold）
├─ 门：clip c1 @ 1.5s（每次执行重开）
├─ 判定：condition（见 12）
├─ 挂起来源：rule:b1
└─ 释放：
   ├─ 判定成功
   ├─ policy.timeout = 3s（真实时钟，从门首次满足起算）
   └─ 门失效（执行切换 / 播放头回到门前）
```

对 `pause` 动作：

```
动作 pause（规则 r1 / 绑定 b1）
├─ 挂起来源：action:pause
└─ 释放：
   ├─ 同实例任一规则动作 resume
   ├─ 实例 reset / 停播
   └─ 无释放者 → 运行时自动释放（RuleRuntime.releasePauseWithoutReleaser）+ 告警
```

`hasLivePauseReleaser` 的判定逻辑（`RuleRuntime.java:645-669`）可作为 UI 静态提示的参考实现思路，但**不得**在 TS 里复刻成第二套语义——UI 只做「同一脚本内是否存在任一 `resume` 动作或 `exit`/`end_script` 出口」的粗粒度提示，并标注「静态提示，权威以游戏内为准」。

### 3.3 拟新建（提案）

- `ED:components/rules/ActionListEditor.vue`（提案）：动作列表 + 添加菜单（9 种）+ 排序 + 删除。
- `ED:components/rules/actions/CameraSetAction.vue`（提案）：`channels` 多选 + 每通道值 + `mode`/`priority`。
- `ED:components/rules/actions/OverlaySetAction.vue`（提案）：`layer_type`（只有 fade）+ `color`/`opacity`/`z_index`。
- `ED:components/rules/actions/AdjustSetAction.vue`（提案）：15 通道。
- `ED:components/rules/actions/PlaySoundAction.vue`（提案）：`sound` + 音量/音调。
- `ED:components/rules/actions/GotoClipAction.vue`（提案）：`clip` + `entry_time`。
- `ED:components/rules/actions/EmitCommandAction.vue`（提案）：`command` 文本域 + 提示。
- `ED:components/rules/ScheduleEditor.vue`（提案）：5 形态。
- `ED:components/rules/SuspensionGraph.vue`（提案）：只读挂起链。
- `ED:lib/ruleActions.ts`（提案）：动作白名单、每动作必填字段、参数校验（**与 `RuleActions` 的参数名逐字一致**）。

**不新建**：动作预览/试跑（需要客户端播放实例）。

## 4. 输入输出与字段约束

| 动作 | 必填 | 可选 | 约束 |
|---|---|---|---|
| `camera_set` | `channels`（非空数组）、每个声明通道的值 | `mode`、`priority` | 通道名必须在 `CameraChannels.NAMES`；`position` 是对象，其余是有限数字；`mode` ∈ `add`/`multiply`/`replace` |
| `overlay_set` | `layer_type="fade"` | `color`（`#RRGGBB`）、`opacity`（0–1）、`z_index`（int） | 其它 `layer_type` 会被跳过（image/subtitle 留 v2） |
| `adjust_set` | 至少一个通道 | — | 键必须在 `ADJUST_CHANNELS_V1` 内；未知键整条动作被跳过 |
| `play_sound` | `sound` | `volume`、`pitch` | 未知音效 id 被跳过（不阻断播放） |
| `exit` | 无 | 无 | 声明式退出 |
| `pause` / `resume` | 无 | 无 | 见挂起语义 |
| `goto_clip` | `clip` | `entry_time` | `entry_time ≥ 0`；`clip` 必须可解析；拒绝 `track`/`at` 旧形态 |
| `emit_command` | `command` | 无 | 不含前导 `/`；多条用 `&&`；编辑器预览实例不发送 |

`schedule`：

| `on` | 必填 | 约束 |
|---|---|---|
| `clip_start` | `clip` | 片段可解析 |
| `clip_complete` | `clip` | 同上 |
| `local_time` | `clip`、`at` | `at ≥ 0` 有限 |
| `delay` | `seconds` | `≥ 0` 有限 |
| `fact` | `binding`、`fact` | `binding` 命中；`fact` ∈ `succeeded`/`action_completed`；无循环依赖 |

## 5. 修改步骤

1. 新建 `ruleActions.ts`：白名单 + 每动作字段表 + 校验函数。
2. 新建 `ActionListEditor.vue` + 6 个动作子组件（`pause`/`resume`/`exit` 无参数，不需要子组件）。
3. 新建 `ScheduleEditor.vue`：5 形态；`fact` 的 `binding` 下拉排除自身并检测环。
4. `RuleDefinitionEditor`（09）接入 `actions` 与 `policy.on_timeout`。
5. `RuleBindingEditor`（10）接入 `schedule`。
6. 新建 `SuspensionGraph.vue`：按 3.2 的树形只读展示；数据全部来自当前文档 JSON。
7. 红条规则：`control=hold` 且 `policy.timeout=-1` 且动作里没有 `exit`/`goto_clip`（即没有「成功即离开」的路径）→ 提示「可能永久挂起」。
8. `emit_command` 提示：「编辑器预览不发送；仅观看者可执行；服务端按 `(bindingId, actionIndex)` 查表」。

## 6. 禁止修改

- 不得新增动作类型（9 种是 `ACTION_TYPES_V1`）。
- 不得把 `hold` 做成动作（销项，用 `until` 无 timeout 表达）。
- 不得让 `resume` 释放 `rule:` 来源（运行时不这么做）。
- 不得把 `pause` 解释成「暂停游戏」或「暂停整个脚本」——它是实例级内容位置挂起。
- 不得在 UI 里复刻 `hasLivePauseReleaser` 的完整算法（只做粗粒度提示）。
- 不得允许 `goto_clip` 带 `track`/`at`（解析期已拒绝，`RuleActionRunner.java:29-31` 类注释）。
- 不得让 `emit_command` 在编辑器预览里发送（运行时明确不发，`RuleActions.java:352-360`）。

## 7. 两分支承载

- Forge 1.20.1：动作执行在客户端主线程（`RuleActions` / `RuleActionRunner`）；`emit_command` 走 `C2SRuleCommandPacket` → 服务端 `ScriptEventManager.handleRuleCommand`。
- Fabric：同源，未实机验证。

## 8. 前置

- `09-rules-definition-editor.md`、`10-rule-bindings-editor.md`。
- `02-model-contracts`（片段 id 与时长，`goto_clip`/`schedule.clip` 需要）。
- `13-loop-exit-branch-attribution.md`（`goto_clip` 与分支归属）。

## 9. 验收

**正例**

- `camera_set`：`channels=["yaw","fov"]`、`mode="add"`、`yaw=10`、`fov=5` → 保存后参数名正确；运行期相机偏航 +10、FOV +5。
- `adjust_set`：只写 `exposure=0.35` → 其它通道缺省 0（不改变画面）。
- `play_sound`：`sound="minecraft:ambient.cave"` → 播放一次。
- `goto_clip`：`clip="branch_a"`、`entry_time=0.5` → 分支从 0.5s 启动；`binding.exit` 覆盖生效。
- `schedule={on:"delay", seconds:0.5}`：判定成功后 0.5 真实秒执行；挂起期间不冻结计时。
- `pause` + 另一条规则 `resume`：内容位置停住后恢复；`resume` 不解除 `control=hold` 的挂起。
- `control=hold` + `timeout=-1` + 无 `exit`/`goto_clip`：红条「可能永久挂起」。

**反例**

- `adjust_set` 写了未知通道 → 运行期整条动作被跳过（UI 必须提前拦住）。
- `goto_clip` 写 `track` → 解析期拒绝（UI 不得提供该字段）。
- `resume` 被描述成能解除 `hold` → 失败。
- `emit_command` 在预览里发送 → 失败。
- `pause` 被描述成全局暂停 → 失败。

## 10. 真实冒烟

1. 规则 `r1`（`time` 0–5）+ 动作 `pause`；绑定 `b1`（`gate.at=1`，`observe`）。
2. 播放：到 1s 判定成立 → 暂停（内容位置停住，画面不推进）。
3. 规则 `r2`（`time` 3–4）+ 动作 `resume`；绑定 `b2`（`gate.at=2`）。播放：2s 后 r2 在 3s 成立 → 恢复。
4. 把 `r2` 删掉：`pause` 无释放者 → 运行时自动释放并告警（验证兜底）。
5. `goto_clip` 到 `branch_a`（`exit.on_complete=goto` 回主线）：验证分支与出口。
6. `emit_command` 发 `/time set day`（写成 `time set day`）：服务端执行，审计日志出现。

## 11. 完成定义

- 9 种动作可编辑，参数名与 `RuleActions` 逐字一致，未知参数在 UI 被拦。
- 5 种释放条件可编辑，`fact` 的前向引用与环检测正确。
- 挂起链视图能说明「谁持有、谁释放」，且不假装能预测运行时。
- `pause`/`resume`/`hold` 三者的差异在 UI 上不会混淆。
- `emit_command` 的权限与预览限制写清楚。
