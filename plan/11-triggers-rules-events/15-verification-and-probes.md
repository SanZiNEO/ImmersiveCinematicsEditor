# 15 可验证性与真实冒烟

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：11-triggers-rules-events
> 关联：`08-trigger-validation-diagnostics.md`、`03-trigger-type-catalog.md`、`13-loop-exit-branch-attribution.md`、`14-event-attribution.md`

## 1. 职责

给出「怎么证明本轮做对了」的清单：哪些能静态验证（编辑器内）、哪些必须进游戏、用哪些夹具、每一步的期望观察。避免出现「UI 能填字段就算完成」这种不可验收的结论。

## 2. 现有事实（源码锚点）

| 能力 | 锚点 | 用途 |
|---|---|---|
| 编辑器校验 | `MOD:webui/WebEditorApi.java:153-167`（`script.validate`） | 静态校验（**不含**跨脚本存在性，见 08） |
| 游戏内校验 | `MOD:command/CinematicCommand.java:333-337` | `ScriptValidator.validate(json, knownIds)`，含跨脚本检查 |
| 重载 | `MOD:script/ScriptManager.java:150-162`（`reload`） | 清空旧注册 + 重建索引；旧授权失效 |
| 触发日志 | `MOD:trigger/server/TriggerEngine.java:262-265` | `Firing trigger '<id>' for script '<id>'` |
| 注册日志 | `TriggerEngine.java:82-85` | `Rebuilt trigger index: N event-driven, M polling buckets` |
| 未知类型日志 | `MOD:script/ScriptManager.java:99-102` | `Unknown trigger type '…'` |
| 触发夹具 | `cinematics/0.3.6/tests/trigger/*.json`（38 个） | 每类型一份 + H1 连续语义 + prereq 组合 |
| 规则诊断入口 | MOD:script/rule/runtime/RuleRuntime.java — 现有诊断符号 | 只用于理解真实行为；本计划不注入假时钟/假动作建立自动化测试，改在实际游戏触发并观察 |
| 播放实例时钟注入 | `MOD:script/ScriptPlayer.java:985`（`setClockSource`） | 编辑器播放实例用编辑器播放头 |
| 预览不发送命令 | `MOD:camera/rule/RuleActions.java:352-360` | 验证 `emit_command` 的预览行为 |

## 3. 验证分层

| 层 | 能验证什么 | 不能验证什么 |
|---|---|---|
| L1 编辑器静态 | JSON 结构、字段取值域、跨字段约束（facing 端点、gate 越界、组合器层数）、`requires` 悬空（08 的 A 落地后） | 任何运行时行为 |
| L2 编辑器预览 | 脚本解析、片段/轨道播放、相机、覆盖层、`adjust_set`、`pause`/`resume` 的可见效果 | 服务端触发器、事实、`emit_command`、`goto_clip` 的分支账本（预览实例有独立账本但无服务端授权） |
| L3 游戏内单机 | 触发器全部 27 类、事实账本、规则、分支、命令 | 多人授权/限频 |
| L4 游戏内多人 | `emit_command` 的观看者授权、跳过投票、`play_mode` | — |

## 4. 每类验证方法（L3）

| 类型 | 最小夹具 | 操作 | 期望 |
|---|---|---|---|
| `login` | `test_trigger_login.json` | 重进世界 | 触发一次 |
| `location` | `test_trigger_location.json` | 走进方体 | 触发 |
| `advancement` | `test_trigger_advancement.json` | 完成指定进度 | 触发 |
| `biome` | `test_trigger_biome.json` | 传送到该群系 | 触发 |
| `entity_kill` | `test_trigger_entity_kill.json` | 击杀指定实体 | 触发 |
| `death` | `test_trigger_death.json` | 自杀 | 触发（`repeatable=false` 一生一次） |
| `entity_interact` | `test_trigger_entity_interact.json` | 右键实体 | 触发 |
| `block_interact` | `test_trigger_block_interact.json` | 右键方块 | 触发 |
| `item_on_interact` | `test_trigger_item_on_interact.json` | 手持指定物品右键 | 触发 |
| `dimension_change` | `test_trigger_dimension_change.json` | 穿门 | 触发 |
| `item_craft` | `test_trigger_item_craft.json` | 合成 | 触发 |
| `item_use` | `test_trigger_item_use.json` | 长按使用 | 触发 |
| `item_consume` | `test_trigger_item_consume.json` | 吃完 | 触发 |
| `item_release` | `test_trigger_item_release.json` | 松开使用 | 触发 |
| `item_instant_use` | `test_trigger_item_instant_use.json` | 瞬间使用（如末影珍珠） | 触发 |
| `item_use_interrupt` | `test_trigger_item_use_interrupt.json` | 使用中切换物品 | 触发 |
| `item_pickup` | `test_trigger_item_pickup.json` | 捡起 | 触发 |
| `item_drop` | `test_trigger_item_drop.json` | 丢弃 | 触发 |
| `xp` | `test_trigger_xp.json` | 获得经验 | 触发 |
| `dimension` | `test_trigger_dimension.json` | 站在该维度 | 轮询命中 |
| `observation` | `test_trigger_observation.json` | 准星对准 | 触发 |
| `inventory` | `test_trigger_inventory.json` | 背包满足 / 数量变化 | 触发 |
| `structure` | `test_trigger_structure.json` | 进入结构半径 | 触发 |
| `gamestage` | `test_trigger_gamestage.json` | 装 GameStages 并给阶段 | 触发；未装则永不触发（只提示一次） |
| `facing` | `test_trigger_facing.json` | 转到区间 | 触发 |
| `all_of` | `test_trigger_all_of.json` | 全部子条件同时满足 | 触发 |
| `any` | `test_trigger_any.json` | 任一满足 | 触发 |

连续语义：`test_h1_sweep_on.json` / `test_h1_sweep_off.json` / `test_h1_sweep_observation.json` / `test_h1_dwell.json`。
嵌套与前置组合：`test_trigger_nested.json` / `test_trigger_prereq_combo.json` / `test_prereq_a|b|c.json`。
轮询覆盖：`test_trigger_poll_interval.json`。

## 5. 规则与分支验证（L2/L3）

| 场景 | 夹具构造 | 期望 |
|---|---|---|
| `policy.once` | 条件持续为真、`once=true` | 只触发一次 |
| `policy.cooldown` | `once=false`、`cooldown=1` | 每 1 秒一次 |
| `mode=enter` | 条件在 2–3 秒为真 | 只在进入为真那帧触发 |
| `mode=dwell` | `dwell=1.5` | 连续满足 1.5 秒才触发 |
| `policy.timeout` | 条件永不真、`timeout=2`、`on_timeout=[resume]` | 2 秒后恢复 |
| `control=hold` | 门后条件不成立 | 内容位置停住；成立后继续 |
| `schedule=clip_start` | 目标片段在承诺后启动 | 动作在启动时执行 |
| `schedule=clip_complete` | 目标片段完成 | 动作在完成时执行 |
| `schedule=local_time` | 目标片段到达 `at` | 到点执行 |
| `schedule=delay` | 挂起中 | 真实时间到点执行（不冻结） |
| `schedule=fact` | 另一绑定成功 | 成功后执行 |
| `pause` 无释放者 | 只有 `pause`，无 `resume`/`exit` | 运行时自动释放 + 告警（`RuleRuntime.releasePauseWithoutReleaser`） |
| `goto_clip` + 绑定 `exit` | 分支启动 | 入口覆盖生效；主线不受影响 |
| `emit_command` 预览 | 编辑器预览触发 | 不发送；日志有「预览不发送」 |
| `emit_command` 多人 | 两名玩家观看 | 命令对观看者执行；非观看者被拒 |

## 6. 静态验证清单（L1，编辑器内即可）

1. 27 类下拉无缺项；每类条件表单能填最小合法值并通过 `script.validate`。
2. `poll_interval` 越界被拦；事件类禁用。
3. `continuity` 三字段范围正确；全默认不写对象。
4. `requires` 只能选 `meta.id`；字符串/对象互转不丢语义；悬空/自引用可见。
5. 组合器嵌套到 8 层后禁止继续；`window=0` 时事件类子条件不可选。
6. `rules[].actions` 非空；`timeout` 不为 0；`gate.at` 不超片段时长。
7. `schedule.fact` 循环依赖被拒。
8. `rule_bindings[].exit` 只有 `goto` 允许 `target`/`entry_time`。

## 7. 回归清单（改完必跑）

| # | 检查 | 方法 |
|---|---|---|
| 1 | 旧脚本仍可加载 | 用 `cinematics/0.3.6/tests/` 下全部夹具过 `script.validate`（0 error） |
| 2 | 触发器注册数不变 | 游戏内日志 `Rebuilt trigger index: 16 event-driven, N polling buckets` |
| 3 | `requires` 语义未变 | `test_trigger_prereq_combo.json` 行为与改动前一致 |
| 4 | `inventory` 不再产生 `mode` | 用编辑器编辑 `test_trigger_inventory.json` 并保存，diff 无 `mode` |
| 5 | 规则旧脚本兼容 | 现有含 `rules`/`rule_bindings` 的夹具加载后行为不变 |
| 6 | 图数据 identity 一致 | 图悬停的触发器 identity 与文档面板一致（04/06 + 11/01） |

## 8. 禁止的验证方式

- 不得用「UI 能打开、不报错」当作完成。
- 不得用前端自造的校验结论代替 `script.validate`。
- 不得在未进游戏的情况下声称触发器/规则行为已验证。
- 不得只测一种类型就声称「27 类都支持」。
- 不得用 `emit_command` 在编辑器预览里验证命令（运行时明确不发）。

## 9. 完成定义

- 本文件 §4/§5 的每一行都有明确的夹具或操作步骤与期望。
- 每条验收都能落到 L1/L2/L3/L4 中的一层，且标注了「需游戏内」。
- 回归清单可在一次改动后完整执行。
- 不存在「填完字段即完成」的验收项。

## 输入输出与轮次出口

输入本轮编辑产物、真实schema/服务端状态、已有夹具与游戏操作；输出逐场景实际结果/日志或画面引用、失败责任类和复验记录。16事实查询也需真实事件前后验证，不能只验证静态表单。未执行项如实保留，不把mock探针或文档步骤当真游戏通过。
