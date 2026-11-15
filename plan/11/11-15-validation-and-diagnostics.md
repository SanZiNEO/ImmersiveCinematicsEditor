# 11-15 校验与诊断

## 目标

行为页的校验分两层：

1. **模块合同校验**：与模组 `ScriptValidator` / `ObjectValidator` / 各 parser 同口径，决定脚本能不能被游戏接受。
2. **编辑器诊断**：在合同之外提示“能加载但很可能不达预期”的组合；不阻断保存，不伪造成错误。

编辑器不调用游戏内校验命令，不新增校验消息；本地按同一合同实现，保存/导出前跑。

## 级别

| 级别 | 来源 | 行为 |
|---|---|---|
| error | 非 `[警告]` 的 validator issue；对象/结构解析异常；schema 错误；编辑器合同禁止项（如 `on_timeout` 的 `emit_command`） | 阻止导出/构建；节点红标；必须修 |
| warn | `[警告]` 前缀的 issue；parser 的“建议最多 1 条”；运行期丢弃 | 允许保存/导出；黄标；汇总提示 |
| info | 编辑器诊断，不是模块 issue | 不阻断；蓝标/灰标；可关闭 |

- 模组校验的“通过”= `errorsOf(issues)` 为空；只要有一条非 `[警告]` 的 issue 就不通过。
- 不要把“将被忽略”当成 warn：`ScriptValidator` 里大量“将被忽略”是 error，脚本会被拒绝。
- 只有 `[警告]` 前缀是 warn；当前典型是 `control=hold` 的条件等待片段诊断。
- 编辑器自身的 info 不写进脚本，不影响游戏。

## 校验时机

- 打开脚本：解析 + 合同校验；有 error 仍允许打开，进入修复态，不自动改写。
- 编辑中：只做结构/引用即时检查；不每敲一个字符跑全量。
- 保存前：全量合同校验；error 阻止保存；warn 允许并提示。
- 导出/构建前：再跑一次；error 阻止。
- 刷新脚本/切换脚本：丢弃旧诊断，按新内容重算。
- 外部文件变化：重新读取后再校验，不沿用旧结果。

## 诊断面板

```text
诊断
├ 错误 4
│  ├ meta.triggers[2].conditions ... → 触发器 3
│  ├ rules[0].actions[1].type ... → 规则 1 / 动作 2
│  ├ rule_bindings[1].gate.at ... → 绑定 2
│  └ on_timeout 的 emit_command 没有服务端命令表 → 规则 / 超时动作
├ 警告 2
│  ├ control=hold ... → 绑定 3
│  └ 检测到 2 条 EVENT 轨道 ... → 事件
└ 提示 3
   ├ rule_fact 自引用 ...
   └ MOD_EVENT 内置播放器不消费 → 事件详情
```

- 每条显示：级别、路径、原文、对象、跳转。
- 点击跳转到行为树节点/字段；不自动播放、不 seek。
- 可按对象过滤：全部 / 触发器 / 规则 / 绑定 / 事件 / 元信息。
- 可按级别过滤：错误 / 警告 / 提示。
- 同一路径多条 issue 合并显示，展开看原文。
- 诊断面板可折叠，不占主编辑区。

## 合同校验范围

### 脚本与片段

| 检查 | 级别 |
|---|---|
| `meta` 缺失/非对象；`meta.id` 不匹配 `^[a-zA-Z0-9_]{1,32}$` | error |
| `timeline` / `tracks` / `clips` 结构非法 | error |
| clip `start_time` / `duration` 缺失、非有限、duration=0 | error |
| 独立片段 `id` 非法/重复；`track` 未知；`objects` 缺失/为空 | error |
| 轨道 `type` 未知；`clips` 缺失 | error |
| 片段 `exit` 非对象/缺 `objects` | error |
| 对象 schema / 未知对象路径 / mode 与 type 不匹配 | error |

### 触发器

| 检查 | 级别 |
|---|---|
| `triggers` 非数组；元素非对象 | error |
| `type` 缺失/未知（27 种之外） | error |
| `id` 非字符串/空/不匹配 `[A-Za-z0-9_]{1,64}` | error |
| `id` 重复 | error |
| `requires` 非数组；元素既非字符串也非对象 | error |
| `requires` 字符串为空；内置 `script_*` 缺 `script` | error |
| `requires` 自引用；目标脚本不存在 | error |
| `requires` 未知/自定义对象型 type | 允许；编辑器标“自定义前置只读” |
| `conditions` 非对象 | error |
| `conditions.mode` 旧字段 | error |
| 条件字段缺失/类型错误/必填未填 | error |
| `all_of` / `any` 的 `list` 缺失、非数组、空 | error |
| 组合器子项非对象、缺 `type`、`conditions` 非对象 | error |
| 组合器嵌套超过 8 层 | error |
| 组合器子项未知类型 | error |
| 事件类触发器放进组合器但 `continuity.window=0` | error |
| `exit_buffer` 用在 `facing` / `all_of` / `any` / `death` | error |
| `poll_interval` 用在事件驱动触发器 | error |
| `on_enter` 用在 `death` | error |
| `continuity` 非对象；`sweep` 非布尔；`dwell` / `window` 非整数或越界 | error |
| `continuity.sweep` 用在非几何类型；`dwell` 用在事件驱动；`window` 用在非组合器 | error |
| `continuity` 未知键 | 解析静默忽略；编辑器只读保留，不报 error |

### 规则与绑定

| 检查 | 级别 |
|---|---|
| `rules` 非数组；元素非对象；缺 `condition` / `actions`；`actions` 空 | error |
| 规则 `id` 缺失/非法/重复 | error |
| policy 非对象；`once` 非布尔；`mode` 非 `enter/dwell` | error |
| `timeout` 非数字或非 `>0` / `-1`；`dwell` / `cooldown` <0 或非有限 | error |
| `on_timeout` 非数组；元素非对象 | error |
| 条件 `type` 未知/非规则 12 种；结构缺失 | error |
| 条件 `clip_fact` 缺 `clip`/`fact`；`rule_fact` 缺 `binding`/`fact` | error |
| 条件引用未知片段/绑定；事实名未知 | error |
| 规则组合器空/深度 >8/子项结构非法 | error |
| `rule_bindings` 非数组；元素非对象 | error |
| 绑定 `id` 缺失/非法/重复；`rule` / `clip` 缺失或未知 | error |
| `gate` 缺失/非对象；`gate.at` 缺失、非有限、<0、越界 | error |
| `control` 非 `observe/hold` | error |
| `schedule` 非对象；`on` 缺失/未知；参数缺失/非法；未知键 | error |
| `schedule.fact` 的 `binding` 未知；`fact` 非白名单 | error |
| `exit` 非对象；`on_complete` 未知；`goto` 缺 `target`；非 `goto` 带 `target` / `entry_time` | error |
| `control=hold` 且条件等待片段受 gate 限制 | warn |

### 动作

| 检查 | 级别 |
|---|---|
| 动作元素非对象；`type` 缺失/未知；`hold` 动作 | error |
| `goto_clip` 缺 `clip` / 未知片段；旧 `track` / `at` 字段 | error |
| `entry_time` 非有限/<0 | error |
| `camera_set` 未声明 `channels` / 空 / 未知通道 / 重复通道 | error |
| `camera_set` 通道值缺失/非有限；`mode` 未知；`priority` 非整数 | error |
| `camera_set` 写了未声明通道的字段 | error |
| `overlay_set` 缺 `layer_type` / 非 `fade`；`opacity` 越界；`z_index` 非整数 | error |
| `adjust_set` 通道不在 15 个基础校色通道；未声明通道；值非有限 | error |
| `pause` / `resume` / `exit` 带参数或未知键 | error |
| `play_sound` 缺 `sound`；`volume` / `pitch` 非有限 | error |
| `emit_command` 缺 `command` / 空 / 前导 `/` | error |
| 动作未知键 | error |
| `on_timeout` 里出现 `emit_command` | error（编辑器合同；服务端命令表不编译它，导出后是空动作） |

### 事件

| 检查 | 级别 |
|---|---|
| `event` / `mod_event` 非 mode=event / 无 keyframes | error |
| 一个片段多个 `event` / `mod_event` 对象 | error |
| keyframe 缺 `time` / `value`；time 负/非有限/非递增 | error |
| `time > duration` | warn（运行期丢弃；新建阻止） |
| `event` 记录未知成员；`event_type` 非 `command`；`command` 非字符串 | error |
| `event.position` 键不成对/混写/非有限 | error |
| `event.id` 非字符串 | error |
| `event.command` 前导 `/` | warn（编辑器提示） |
| `mod_event` 记录 `value` 非对象；`event_type` 缺失/空/非字符串 | error |
| `mod_event.data` 顶层非对象；数字非有限 | error |
| `mod_event` 出现 `command` / `position` / `id` | error |
| 多条 EVENT 轨 | warn（parser 建议最多 1 条） |
| `pingpong` 用在 EVENT / MOD_EVENT | error |

## 编辑器诊断（info）

这些不是模块 issue，不阻断：

| 诊断 | 说明 |
|---|---|
| `rule_fact` 自引用 | 条件等待自身成功，可能永远不成立 |
| `rule_fact` 与 `schedule.fact` 成环 | 互相等待，可能死锁 |
| `clip_fact` 引用冻结/执行顺序不可达的片段 | 在 `hold` 下可能永远不开始 |
| `script_completed` 被当“完整播完” | 实际只看结束事实 |
| `action_completed` 被当“动作全部成功” | 实际只看批次已提交 |
| `requires` 自定义前置未注册 | 运行期可能视为不满足；只读显示，不自动删除 |
| `trigger_fired` 被当可清除状态 | 实际持久去重；重触发改 `repeatable` |
| 绑定 `exit` 被当“本绑定 clip 完成时出口” | 实际只覆盖本绑定 `goto_clip` 启动的分支 |
| `t=0` EVENT 预览 | seek 到片段起点会跳过它；只能新实例/首次推进 |
| MOD_EVENT 内置播放器不消费 | 数据通道，不是内置效果 |
| 多条 EVENT 轨 | 建议合并；不自动合并 |

## 修复原则

- 不自动删除用户记录来“修好”校验。
- 不自动把旧字段转成新字段；旧字段原样显示为 error。
- 不自动补默认值来掩盖缺失；缺什么报什么。
- 不自动忽略 error；只有 warn 可保存。
- 允许明确的手工修复：改字段、补引用、删除对象、重命名 id（按 11-06/09 的事务规则）。
- 引用删除保护：删规则/绑定/片段前先检查引用，不静默留下悬空引用。
- 保存时保留未识别字段原文，不用默认值覆盖；但导出前合同校验必须通过。

## 验收标准

1. 无 issue：绿色“通过”，诊断面板空。
2. 只有 `[警告]`：黄色“通过（N 条警告）”，允许保存/导出。
3. 任一非警告 issue：红色“N 个错误”，阻止导出；节点红标。
4. “将被忽略”的 `exit_buffer` / `poll_interval` 显示 error，不是 warn。
5. 组合器 9 层：error“嵌套超过 8 层”；不继续下钻。
6. 事件类触发器在 `any` 里且 `window=0`：error。
7. 触发器 `requires` 自定义 type：允许保存，标“自定义前置只读”，不报 error。
8. 规则 `on_timeout` 有 `emit_command`：error，提示移到普通动作；阻止导出。
9. 绑定 `exit` 说明“只覆盖本绑定 goto 启动的分支”，不是“clip 完成时”。
10. `time>duration` EVENT：warn，红色标记，允许保存。
11. `mod_event.data` 顶层数组：error；嵌套数组允许。
12. 多条 EVENT 轨：warn，不自动合并。
13. 点击诊断跳到对应节点；不播放、不 seek。
14. 打开含 error 的旧脚本：可打开、可修、不自动改写。
15. 保存/导出前重跑全量；刷新后丢弃旧诊断。
16. 诊断面板过滤：按对象、按级别；同一路径合并。
17. 不在编辑器里伪造“游戏已接受”；只显示本地合同校验结果。
