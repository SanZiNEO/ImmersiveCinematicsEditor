# 08-06 连续性诊断

## 目标

在 `camera.inspect` 的“连续性” tab 解释脚本级播放字段和片段循环字段的后果：同脚本再触发、跨脚本到达、排队、打断、末尾保持、跳过、宏循环、片段循环。面板只读，不改脚本。

## 字段来源

脚本级：

```text
play_mode            parallel / exclusive / interruptible
priority             int
interruptible        bool
skippable            bool
skip_vote_ratio      int（10~100，可选）
hold_at_end          bool
macro_loop           bool
macro_loop_count     int（-1 = 无限）
macro_loop_mode      repeat / pingpong
```

片段级：

```text
loop                 bool
loop_count           int（-1 = 无限）
loop_mode            repeat / pingpong
transition           cut / morph（参数过渡，不是画面叠化）
transition_interrupt blend / snap（参数过渡打断）
```

- 字段缺省值按 02；面板不补写默认值。
- 字段值从脚本元数据和 CAMERA 片段读取；面板不复制到第二份文档。
- 只读摘要；字段值的编辑入口在对应的元数据/片段属性入口，本页不提交文档命令。

## 播放关系

### 同脚本再触发

```text
同一 script id 已有活跃实例：
  interruptible=true  → 当前实例被替换，新请求立即开始
  interruptible=false → 新请求进入队列，等当前实例结束
```

- 同脚本只保留一个活跃实例；重复请求不并行。
- `play_mode` 不参与同脚本替换判定；只看 `interruptible`。
- 替换时被替换实例走统一退出入口，原因 `INTERRUPTED`；不在面板里伪造“已停止”。

### 跨脚本到达

| 在播集合 | 新请求结果 |
|---|---|
| 含任意 `exclusive` 实例 | 新请求一律排队；不打断 |
| 无 `exclusive`，含 `interruptible` 实例 | 先退出全部 `interruptible`，再开始新请求 |
| 空，或只有 `parallel` | 直接开始；可与 `parallel` 并行 |

- 新请求自己的 `play_mode` 决定的是“它在播后，别人如何对待它”，不是它到达时是否排队。
- `exclusive` 在新请求开始后，会让后续请求排队；`interruptible` 在新请求开始后，允许后续请求顶掉它；`parallel` 与别人共存。
- 多个 `parallel` 可同时存在；每个实例都有自己的 CAMERA/覆盖链输出，最后一帧的覆盖关系由覆盖链和合成顺序决定。
- 面板显示的是规则表，不声称当前游戏里正在播哪些脚本；真实在播集合由游戏运行时决定。

### 排队

```text
队列顺序 = priority 降序，同优先级 FIFO
队列键 = script id
同脚本再次请求 → 替换自己的排队位，不占新格
队列不设上限；只有全停/紧急停止才清空
```

- `priority` 只决定队列内次序，不会把已在播的不可打断脚本顶掉。
- 队列项在阻塞实例结束后按顺序接播；同一脚本在播时，该脚本的排队项跳过但保留。
- 面板可显示“当前脚本的 priority 在队列中的相对位置”规则，但不显示伪造的队列条目。

### 打断与退出

| 动作 | 门禁 | 结果 |
|---|---|---|
| 新脚本到达顶掉 `interruptible` | 目标 `interruptible=true` | 目标渐出退场，新脚本开始 |
| 新脚本到达遇到 `exclusive` | 存在 `exclusive` | 新脚本排队 |
| 自然结束 | `hold_at_end=false` | 正常退场 |
| 自然结束 | `hold_at_end=true` | 拒绝自然退出，停在末帧 |
| 跳过请求 | `skippable=true` | 可跳过 |
| 跳过请求 | `skippable=false` | 拒绝 |
| 系统停止 | 无 | 走停止退出 |
| 强制退出 | 无 | 立即停用，不渐出 |

- `hold_at_end=true` 时，内容播完不自动结束；系统停止/强制退出仍可结束。
- `skippable=false` 且 `hold_at_end=true`：跳过和自然结束都被拒绝，只能系统停止或强制退出。
- 渐出退场是运行时层行为；面板只显示门禁结果，不显示渐出进度。

## 宏循环

```text
macro_loop=true
  macro_loop_count=-1 → 无限
  macro_loop_count>0  → 指定圈数
  macro_loop_mode=repeat   → 每圈正向
  macro_loop_mode=pingpong → 正向/反向交替
macro_loop=false → 播完按自然结束规则处理
```

- 宏循环按整份脚本折返，不按单个 CAMERA 片段折返。
- 折返时 CAMERA 轨道复位过渡状态；上一圈的混合中间态不带入新一圈。
- 宏循环进行中折返优先；达到指定圈数后，再按自然结束/`hold_at_end` 规则处理。
- `macro_loop_count` 为正整数时显示“剩余圈数”规则，不显示实时计数。
- `macro_loop_mode=pingpong` 时，时间轴方向交替；片段局部时间仍按片段自身循环规则计算。

## 片段循环

```text
loop=false → 片段只执行一次
loop=true, loop_count=-1 → 片段内无限重复
loop=true, loop_count>0 → 指定次数
loop_mode=repeat → 0→duration 重复
loop_mode=pingpong → 正向/反向交替
```

- 片段循环只影响片段内部时间，不扩展主时间轴上的片段区间。
- 片段循环不会改变 lane 的全局活跃区间；lane 视图仍按片段 `start_time/end`。
- 叠化要求 A/B 都是有限、非片段内循环的片段；无限循环的片段不参与叠化，也不参与参数过渡对。
- 叠化重叠区由 `B.start_time` 与 `A.end` 决定；它不占用“参数过渡窗口”，也不因宏观循环折返复用上一圈的 opacity 中间态。
- 片段末尾参数过渡只在片段有限结束时出现；无限循环的片段不参与参数过渡对。
- 参数过渡窗口在片段交界处；宏观循环折返不复用上一圈的过渡中间态。
- `transition_interrupt` 的 `blend/snap` 只在新的参数过渡打断进行中的参数过渡时生效；不改变片段循环方向。
- 叠化与参数过渡在同一交界可以共存；叠化应用不自动改 A 的 `transition`。morph 窗口内只出 morph 单 lane，窗口外仍按叠化两条 lane；连续性面板按区间显示“morph 优先 / 叠化仍可见 / 完全遮蔽”。

## 诊断

| 代号 | 条件 | 级别 | 文案 |
|---|---|---|---|
| `continuity_exclusive_queue` | `play_mode=exclusive` | info | 在播时后续请求会排队 |
| `continuity_parallel_uninterruptible` | `parallel` + `interruptible=false` | warning | 不能被新请求顶掉，也不能让位；可能长期占留 |
| `continuity_hold_no_skip` | `hold_at_end=true` + `skippable=false` | warning | 只能系统停止/强制退出 |
| `continuity_macro_hold` | `macro_loop=true` + `hold_at_end=true` | info | 宏循环进行中先折返；圈数结束后再按末尾保持处理 |
| `continuity_loop_infinite` | 片段 `loop=true` 且 `loop_count=-1` | info | 片段无限循环，不产生出场参数过渡，也不参与叠化 |
| `continuity_morph_infinite` | `transition=morph` + 片段 effectively infinite | info | 不参与参数过渡对 |
| `continuity_crossfade_infinite` | A 或 B 的 `loop=true` / `loop_count=-1` / 无限 | warning | 叠化要求有限片段；当前不成立 |
| `continuity_crossfade_not_adjacent` | A/B 不同 CAMERA 轨或数组不相邻 | warning | 叠化布局不成立 |
| `continuity_crossfade_b_transition` | B 的参数过渡窗口伸进 A/B 重叠区 | warning | 回放可能在重叠区内先出 B 的 morph lane |
| `continuity_crossfade_opacity` | A 的 opacity 非恒 1，或 B 两端不是 0/1 | warning | 叠化画面不成立；仍按普通多 lane 播放 |
| `continuity_crossfade_morph_coexist` | 同一 A→B 交界同时有叠化与 A 的 morph | info | 两个效果共存；morph 窗口内单 lane，窗口外仍可能两条 lane |
| `continuity_crossfade_shadowed` | Morph 窗口覆盖整个叠化重叠区 | warning | 回放中叠化画面不可见；不自动删除任一方 |
| `continuity_queue_priority` | `priority != 0` | info | 只影响队列次序，不影响在播替换 |
| `continuity_skip_vote` | `skippable=true` 且 `skip_vote_ratio` 存在 | info | 跳过请求按投票比例判定 |

- warning 不阻止保存/推送；它提示作者当前组合的长期占留或不可退出风险。
- 诊断不推断游戏内实际在播脚本；只根据本脚本字段和生命周期规则推导。
- 诊断列表按“错误 → 警告 → 信息”排序；0 条时显示“当前没有连续性提示”。

## UI

```text
┌ 连续性 ───────────────────────────────────────────────┐
│ 脚本级                                                │
│  play_mode [exclusive]  priority [10]                 │
│  interruptible [off]    skippable [on]                │
│  hold_at_end [on]       macro_loop [off]              │
│                                                       │
│ 到达裁决（规则）                                      │
│  同脚本在播： interruptible=false → 排队              │
│  其它脚本：   在播含 exclusive → 排队                 │
│  队列：       priority 降序，同优先级 FIFO            │
│                                                       │
│ 片段循环                                              │
│  shot_A  loop=true  3 次  repeat                      │
│  shot_B  loop=false                                  │
│                                                       │
│ 提示                                                  │
│  ! 不可打断且平行：可能长期占留                        │
└───────────────────────────────────────────────────────┘
```

- 数值字段用只读文本/徽标；布尔用 `on/off` 文本，不用可点击开关。
- `play_mode` 三态用三行规则表，不用单个下拉。
- 每个诊断显示代号、级别、文案；点击“定位”只选中相关片段/字段，不修改值。
- `transition`/`transition_interrupt` 只显示当前参数过渡声明；不重复参数过渡表。
- 叠化只显示重叠区摘要（A/B、起止、B opacity 两端）；不显示成“参数过渡”。
- 叠化 + morph 共存时显示“morph 优先区间 / 叠化仍可见区间 / 完全遮蔽”；不提供自动二选一按钮，显式解决在 `transition.panel`。
- 片段循环行只显示 `loop/loop_count/loop_mode` 摘要；不提供编辑控件。

## 组件

```text
src/camera/continuity/
  continuityModel.ts          读取元数据/片段字段
  continuityRules.ts          同脚本/跨脚本/队列/退出规则
  continuityDiagnostics.ts    诊断表
src/components/camera/
  ContinuityTab.vue           tab 容器
  ContinuityScriptFields.vue  脚本级字段
  ContinuityArrivalTable.vue  到达裁决
  ContinuityClipLoopTable.vue 片段循环
  ContinuityDiagnosticList.vue
```

- `continuityModel` 只读；不写文档、不改 meta。
- `continuityRules` 返回规则结果，不调用运行时 `PlaybackLifecycle`。
- `ContinuityTab` 只在 `camera.inspect` 内挂载；不新建独立面板。
- 字段值变化由 `docRevision` 触发重建；播放头变化不重建连续性规则。

## 验收

1. `play_mode=exclusive`：显示“在播时后续请求排队”；不显示“立即打断”。
2. `play_mode=interruptible`：显示“后续请求可顶掉当前实例”。
3. `play_mode=parallel`：显示“可与 parallel 共存”；有 exclusive 时仍排队。
4. `interruptible=false` + 同脚本再触发：显示“排队”，不显示“替换”。
5. `interruptible=true` + 同脚本再触发：显示“替换当前实例”。
6. `priority=10`：显示“队列 priority 降序，同优先级 FIFO”；不显示“运行中优先级更高”。
7. `hold_at_end=true` + `skippable=false`：warning“只能系统停止/强制退出”。
8. `hold_at_end=true` + 自然结束：显示“拒绝自然退出，停在末帧”。
9. `macro_loop=true,count=-1,mode=pingpong`：显示“无限、正反交替”；不显示实时圈数。
10. 片段 `loop=true,count=-1`：显示“无限循环，不产生出场参数过渡，也不参与叠化”。
11. `transition=morph` + 片段 infinite：显示“不参与参数过渡对”。
12. 叠化 A 0–6、B 3–7，重叠区 3–6：显示“A 不动 / B 前移 3 / 重叠 3”；不显示“参数过渡窗口 3”。
13. 叠化 B 的 `transition=morph` 且过渡窗口伸进重叠区：显示“B 的参数过渡可能先出 morph lane”；不阻止保存。
14. 叠化 + A 的 `transition=morph`：显示“共存”；morph 窗口覆盖整个重叠区时显示“叠化不可见”；不显示“已自动改为 cut”。
15. `priority=0`：不显示队列提示；`skip_vote_ratio` 存在时显示投票提示。
16. 面板全部只读：没有可编辑输入、没有提交按钮；`grep meta` 在本 tab 写命令 0 命中。
17. 切换播放头：连续性规则/诊断不重算；只切 tab 时保持数据。
18. 无 CAMERA 轨道：显示“无 CAMERA 轨道”；不伪造片段循环行。
