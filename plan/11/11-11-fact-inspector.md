# 11-11 事实检查器

## 目标

行为页的“事实”页签是只读检查器：说明当前脚本能用哪些事实、谁在引用、引用是否可解析。它不是事实编辑器，不显示某个玩家的实时真假，不提供“设为已触发/未触发”。

事实是运行时记录；编辑器只写引用字段，不求值。

## 三类事实

```text
事实
├ 可引用事实（作者能写进字段）
│  ├ script_played / script_started / script_completed
│  ├ clip_fact: started / completed
│  └ rule_fact: succeeded / action_completed
├ 派生前置（由事实查询得出）
│  └ script_played = started + finished
└ 引擎内部事实（只读说明，不可引用）
   ├ playback_started / playback_finished
   ├ trigger_fired
   └ 事件证据：login / entity_kill / death / advancement / …
```

- 作者字段只接受“可引用事实”里的名字。
- 触发器 `requires` 接受三种脚本前置；组合器子项也只接受这三种脚本前置。
- 规则条件接受 `clip_fact` / `rule_fact`。
- 引擎内部事实不写进脚本，不出现在类型下拉。

## 脚本事实

| 名称 | 成立条件 | 持久性 |
|---|---|---|
| `script_played` | 目标脚本有开始事实且有结束事实；任何退出原因都算 | 随存档 |
| `script_started` | 目标脚本有开始事实 | 随存档 |
| `script_completed` | 目标脚本有结束事实；不要求先开始过 | 随存档 |

- 三种都按“玩家 + 脚本 id”查询，与播放实例、退出原因、是否完整播完无关。
- `script_played` 不是“完整看完”；中途退出也算 played。
- `script_completed` 不是“成功播完”；只看结束事实。
- 目标脚本 id 是 `meta.id`，不是文件路径。
- 前置是锁存语义：一旦成立，在后续查询中持续为真；不会因为新播放而自动清零。
- `requires` 是 AND，任一不满足整条触发器不求值；组合器里可作为子条件参与 OR。

## 规则片段事实 `clip_fact`

| fact | 成立条件 | 作用域 |
|---|---|---|
| `started` | 该片段最近一次执行已开始 | 当前播放实例的最近一次执行 |
| `completed` | 该片段最近一次执行已完成 | 当前播放实例的最近一次执行 |

- `clip` 必须是当前脚本内片段 id。
- 事实在片段执行进入时记录，时间门之前也记录；条件树可引用任意片段，不限于绑定目标。
- 新执行开始会清掉上一次执行的 `completed`；事实只描述最近一次执行，不是无界历史。
- `completed` 不要求完整播到结尾；按运行时结束事实。
- 绑定目标片段之外、播放头尚未到达其窗口起点的片段，在 `hold` 冻结下可能永远不会开始；这是诊断项。

## 规则绑定事实 `rule_fact`

| fact | 成立条件 | 作用域 |
|---|---|---|
| `succeeded` | 该绑定本次激活的条件成立 | 最近一次激活 |
| `action_completed` | 该绑定这批动作已提交 | 最近一次激活 |

- `binding` 必须是当前脚本内绑定 id。
- 新激活建立时清空上一激活的 `succeeded` / `action_completed`；事实只描述最近一次激活。
- `succeeded` 是“条件成功”，不是“动作成功”。
- `action_completed` 是“动作批次已提交”，不是“每个动作都执行成功”；动作失败只跳过该动作。
- 有 `schedule` 时，动作入队阶段不记录 `action_completed`；释放并提交后才记录。
- 无 `schedule` 时，动作执行后记录 `action_completed`。
- 引用自身绑定：warn“自引用事实，可能永远不成立”。
- `rule_fact` 与 `schedule.fact` 使用同一套事实名，但用途不同：前者是条件，后者是动作释放。

## 引擎内部事实

这些事实由引擎写入，但作者不能把它们写成条件类型：

| 事实 | 用途 | 保留 |
|---|---|---|
| `playback_started` | `script_started` / `script_played` 的底账 | 256 |
| `playback_finished` | `script_completed` / `script_played` 的底账 | 256 |
| `trigger_fired` | `repeatable=false` 的去重；同玩家同脚本同触发器只触发一次 | 1024 |
| `login` / `entity_kill` / `death` / `advancement` / `dimension_change` / `interact_block` / `interact_entity` / `item_*` | 对应触发器的证据事实 | 会话，按类型 64–512 |
| `region_entered` / `region_left` | 区域进出证据 | 会话，512 |
| `skip_vote` | 跳过投票，实例结束清理 | 不按条数淘汰 |

- 这些名字不出现在条件类型下拉，不提供编辑。
- `trigger_fired` 的持久性意味着单次触发器跨会话也不会重复；要重新允许，改 `repeatable=true`，不是清事实。
- 事件证据是“发生过什么”的流水，不是可编辑状态。

## 事实页签结构

```text
事实（只读）
├ 概览
│  ├ 可引用事实 N
│  ├ 已被引用 N
│  ├ 未使用 N
│  └ 不可解析引用 N
├ 本脚本引用
│  ├ 触发器前置：script_played → chapter1
│  ├ 组合器前置：script_started → chapter2
│  ├ 规则 clip_fact：intro completed
│  └ 规则 rule_fact：b_1 succeeded
├ 事实字典
│  ├ 脚本事实
│  ├ 规则事实
│  └ 引擎内部事实
└ 诊断
```

### 概览

- 只统计引用，不求值。
- 点击计数跳到对应引用行；不打开新页面。
- 没有引用时显示“本脚本未引用事实”，不显示“全部未满足”。

### 本脚本引用

每行显示：

- 事实名；
- 引用位置：触发器 id / 规则 id / 绑定 id / 条件路径；
- 目标：脚本 id / 片段 id / 绑定 id；
- 解析状态：已解析 / 缺失 / 自引用 / 未知类型 / 自定义只读；
- 引用类型：`requires` / 组合器子项 / `clip_fact` / `rule_fact` / `schedule.fact`。

点击引用跳到行为树对应节点；不自动播放、不 seek。

### 事实字典

- 折叠分组，默认收起引擎内部事实。
- 每条显示名称、成立条件、作用域、持久性/保留上限、可引用位置。
- 不显示“当前玩家是否满足”；没有玩家上下文。
- 不提供“新增事实”“删除事实”“重命名事实”。

### 诊断

| 检查 | 级别 | 说明 |
|---|---|---|
| 前置脚本缺失 | warn | 目标脚本 id 不在图索引 |
| 前置脚本自引用 | warn | 目标等于当前脚本 |
| 前置脚本重复 id | warn | 目标 id 重复，无法确定 |
| 前置环 | warn | 环内前置，可能只能由外部启动 |
| `clip_fact.clip` 未知 | block | 片段不存在 |
| `clip_fact` 引用不会开始的片段 | warn | 冻结/执行顺序导致 |
| `rule_fact.binding` 未知 | block | 绑定不存在 |
| `rule_fact` 自引用 | warn | 可能永远不成立 |
| `rule_fact` 与 `schedule.fact` 成环 | warn | 等待环 |
| `script_completed` 被当成“完整播完” | info | 文案纠正 |
| `action_completed` 被当成“动作全部成功” | info | 文案纠正 |
| 未知事实名 | block | 不在可引用集合 |

## 不求值边界

- 不显示“已触发/未触发”“满足/不满足”。
- 不显示事实流水、时间戳、玩家名。
- 不提供“模拟事实”“测试前置”“强制解锁”。
- 不把 `requires` 的锁存状态画成进度条。
- 不把 `clip_fact` 的最近一次执行扩成历史列表。
- 不把 `trigger_fired` 当作可清除的勾选。

## 与脚本图的关系

- 脚本图依赖边只来自内置 `requires`（`script_played` / `script_started` / `script_completed`），字符串简写按 `script_played`。
- `clip_fact` / `rule_fact` 不建跨脚本边，只在行为页事实页签显示。
- 悬停卡的事实状态与事实页签一致：已解析 / 缺失 / 自引用 / 重复 / 自定义只读。
- 事实页签不改 `script.graph` 数据契约，不新增图字段。

## 验收标准

1. 事实页签只读：没有编辑框、没有“设为真/假”按钮。
2. 概览显示引用计数，不显示“未满足”。
3. `requires:["chapter1"]` 显示 `script_played → chapter1`，跳转到触发器。
4. 组合器子项 `script_started` 显示为条件树引用，不混入 `requires` 列表。
5. `clip_fact` 引用未知片段：block，不创建片段。
6. `clip_fact completed` 显示“最近一次执行”，不是历史。
7. `rule_fact` 引用未知绑定：block；自引用：warn。
8. `rule_fact succeeded` 与 `action_completed` 分开显示，说明不同。
9. `schedule.fact` 显示为调度引用，不显示为条件引用。
10. `trigger_fired` 只在引擎内部事实组出现，不可选为条件类型。
11. `script_played` 说明“中途退出也算”，`script_completed` 说明“不要求先开始”。
12. 事实字典展开引擎内部事实：显示保留上限，不显示玩家状态。
13. 点击引用跳到行为树节点，不播放、不 seek。
14. 刷新脚本后引用状态重算，不缓存旧真假。
