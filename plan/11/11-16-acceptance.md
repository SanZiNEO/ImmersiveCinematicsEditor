# 11-16 验收

## 验收分层

本轮交付是 17 份设计文档，验收分三层：

1. **文档合同验收**：字段面、边界、引用、事件语义与模组当前代码一致；本轮可执行。
2. **静态实现验收**：行为页、悬停卡、校验面板按文档落点，没有第二个入口/第二套运行时；实现后执行。
3. **运行验收**：编辑器构建 + 真游戏播放；实现后执行。

本文件不把未执行的构建或游戏播放写成“已通过”。

## 17 份文档矩阵

| # | 文档 | 必须成立 | 交接 |
|---|---|---|---|
| 1 | `README.md` | 三条链分开；行为页结构；事实/事件口径；17 份清单；边界表 | 04/05/06/09/10/08 |
| 2 | `11-01-behavior-panel-shell.md` | `behavior` 抽屉、根为当前脚本、触发器/规则/绑定/事件挂载、选择/草稿/撤销、错误隔离 | 04 抽屉 |
| 3 | `11-02-trigger-declarations.md` | 27 种类型顺序；身份/id；固定播放动作；无动作/目标选择器；悬停摘要 | 05-03 |
| 4 | `11-03-trigger-timing-and-continuity.md` | `delay/repeatable/on_enter/exit_buffer/poll_interval/continuity` 可适用性；继承链 | 06 触发器缺省 |
| 5 | `11-04-trigger-condition-tree.md` | 27 种条件字段；区域/物品/朝向/注视；组合器 8 层；摘要 | 11-02 悬停 |
| 6 | `11-05-trigger-prerequisites.md` | `requires` 两形态；三种内置前置；跨脚本依赖；组合器内前置 | 05 图 |
| 7 | `11-06-rule-definitions.md` | `rules` 字段面；policy 缺省；增删复制；id 事务重命名；引用保护 | 11-07/08 |
| 8 | `11-07-rule-condition-tree.md` | 12 种规则条件；根/子项形态；8 层；事实作用域 | 11-11 |
| 9 | `11-08-rule-actions.md` | 九种动作字段；`emit_command` 信任边界；`on_timeout` 禁止命令 | 11-10 |
| 10 | `11-09-rule-bindings.md` | 绑定字段；gate/control/schedule/exit；`exit` 入口覆盖归属；事务重命名 | 11-10 |
| 11 | `11-10-execution-and-exit.md` | 单绑定每帧顺序；enter/dwell；once/cooldown；schedule；超时；hold/pause；五种出口 | 11-08/09 |
| 12 | `11-11-fact-inspector.md` | 只读事实页签；三类事实；引用状态；不求值边界 | 11-07/12 |
| 13 | `11-12-event-records.md` | EVENT 字段；空 command 占位；position 绝对/相对；移动折线；身份/去重 | 11-14 |
| 14 | `11-13-mod-event-records.md` | MOD_EVENT `event_type`/`data`；`data` 顶层对象；无 id/command/position；内置不消费 | 11-14 |
| 15 | `11-14-event-timeline-and-seek.md` | 事件标记；前跳/后跳/暂停/循环；t=0 边界；`pingpong` 拒绝 | 05 时间轴 |
| 16 | `11-15-validation-and-diagnostics.md` | error/warn/info；合同校验范围；诊断跳转；修复原则 | 全部 |
| 17 | `11-16-acceptance.md` | 矩阵；夹具；运行步骤；出口条件 | 全部 |

## 文档合同验收

### 字段面

- 触发器 27 种类型、字段、默认值、组合器结构、8 层上限与 `TriggerSchemas` / `Evaluators` 一致。
- 规则 12 种条件、9 种动作、policy 默认、绑定字段、5 种调度、5 种出口与 `RuleCollectionParser` / `ClientConditions` / `RuleActions` / `RuleRelease` 一致。
- 事件 `event` / `mod_event` 记录字段与 `TrackSchemas` / `ObjectCodec` / `ObjectValidator` / `EventClipRuntime` 一致。
- 事实名、作用域、持久性、`action_completed` 语义与事实账本/运行时一致。
- 不出现旧编辑器的字段名、旧页面结构、旧映射表。

### 边界

- 不新增脚本字段、不新增消息类型、不改模组 `.java`、不做本地规则执行器、不做第二时间轴。
- 触发器没有动作数组/目标选择器；规则动作不伪装成触发器动作。
- `MOD_EVENT` 不被写成命令通道或内置效果。
- 绑定 `exit` 不被写成“本绑定 clip 完成时自动生效”。
- `ADJUST` 不被塞进 09；调色不叫画面合成。
- 转场不属于 11；事件不被当转场。

### 文档质量

- 每份文档有目标、结构、字段/语义、校验、验收标准。
- 不用“未实现/仅计划/需游戏验证/本轮不接”掩盖代码事实；只把代码确实不消费的 `MOD_EVENT` 写成“内置播放器不消费”。
- 长条件树、长前置列表明确“内部滚动、不截断”。
- 未知字段/自定义前置明确只读保留，不静默删除。

## 静态实现验收

### 行为页

- `behavior` 抽屉存在，根为当前脚本；触发器/规则/绑定/事件可达。
- 新增/删除/复制/撤销/重做正常；切换脚本不丢未保存修改。
- 规则与绑定父子关系正确；绑定只挂在规则下。
- 事件按 `EVENT/MOD_EVENT` 与片段分组；时间轴只标记，不建第二时间轴。
- 事实/依赖是详情只读页签，不是顶级可编辑对象。

### 触发器

- 27 种类型全部可选；条件字段按类型显示；不适用字段不显示或禁用并说明。
- `requires` 两形态可编辑；字符串简写保存为字符串还是对象按当前文档；不自造第三种。
- 组合器 `all_of/any` 可嵌套；8 层上限；事件类子条件要求 `continuity.window>0`。
- `delay/repeatable/on_enter/exit_buffer/poll_interval/continuity` 按适用性显示；继承结果可见。
- 固定“触发后播放本脚本给触发者本人”只读；无动作/目标下拉。

### 规则

- 规则 id 必填唯一；条件/动作必填；policy 默认正确。
- 12 种条件全部可选；根/子项形态正确；事实引用可解析。
- 9 种动作全部可编辑；未知/旧字段报错；`on_timeout` 的 `emit_command` 提示禁止。
- 绑定 `gate.at` 局部秒；`control`/`schedule`/`exit` 可编辑；`exit` 只在 goto 分支生效的说明可见。
- 五种出口覆盖可选择；非 `goto` 不显示 `target/entry_time`。

### 事实

- 只读；无编辑框、无真假开关、无模拟按钮。
- 引用可跳转；状态区分已解析/缺失/自引用/自定义只读。
- 引擎内部事实折叠；`trigger_fired` 不可选为条件类型。
- `clip_fact` / `rule_fact` 作用域说明正确。

### 事件

- EVENT 记录可编辑 time/command/position/id；空 command 占位。
- position 绝对/相对二选一；不成对/混写报错；不足两个航点提示不驱动移动。
- MOD_EVENT 记录可编辑 time/event_type/data；data 顶层对象；嵌套任意。
- 事件标记跟随片段；拖动改 time；不产生相同 time；超时长红标。
- seek/循环/暂停语义与 11-14 一致；t=0 预览边界提示。

### 校验

- error 阻止导出；warn 允许；info 不阻断。
- `[警告]` 只来自 `WARNING_PREFIX`；其他“将被忽略”是 error。
- 诊断可跳转；不自动删除/改写用户记录。
- 打开含 error 的旧脚本可修复，不白屏。

## 运行验收

### 构建

1. 编辑器 `npm run build` 通过；无 TypeScript/ESLint 阻断错误。
2. 构建产物能打开含触发器/规则/绑定/事件夹具的脚本。
3. 保存/导出后 JSON 结构与模组当前格式一致；不新增字段/消息。

### 夹具

**A. 触发器夹具**

- 单类型覆盖：`login`、`location`、`advancement`、`biome`、`entity_kill`、`death`、`entity_interact`、`block_interact`、`item_on_interact`、`dimension_change`、`item_craft`、`item_use`、`item_consume`、`item_release`、`item_instant_use`、`item_use_interrupt`、`item_pickup`、`item_drop`、`xp`、`dimension`、`observation`、`inventory`、`structure`、`gamestage`、`facing`。
- 组合器：`all_of` 含 `location + biome`；`any` 含 `advancement + login`；嵌套 3 层；第 9 层非法夹具。
- 前置：字符串 `chapter1`；对象 `script_started → chapter2`；缺失/自引用/自定义各一条。
- 时序：`delay=1.5`、`repeatable=true/false`、`on_enter=true`、`exit_buffer=2`、`poll_interval=20`、`continuity{sweep,dwell,window}`。

**B. 规则夹具**

- 规则 1：`time` 条件 + `camera_set` + `overlay_set`；`once=true`。
- 规则 2：`location` + `camera_facing` + `goto_clip`；绑定 `exit` 覆盖 goto 分支。
- 规则 3：`clip_fact`/`rule_fact` + `emit_command`；`schedule` 为 `fact`。
- 规则 4：`pause`/`resume`/`exit`/`play_sound`/`adjust_set`；`control=hold`，`timeout=-1`。
- 绑定：`gate.at` 在片段中段；`control=hold`；`schedule` 五种各一条；`exit` 五种各一条。

**C. 事件夹具**

- EVENT：t=0 空 command 占位；t=1 命令 `say a && say b`；t=2 绝对 position；t=3 相对 position；t=4 命令+移动。
- MOD_EVENT：对象级 `event_type/data`；记录继承；记录覆盖；`data` 嵌套数组/对象/布尔/null。
- 时间轴：两条 EVENT 轨；一条 MOD_EVENT 轨；片段循环；宏观循环；seek 前跳/后跳。

**D. 非法夹具**

- 重复触发器 id；规则 id 重复；绑定 id 重复。
- `requires` 指向不存在脚本；自引用。
- 组合器 9 层；空 `list`；事件类子条件 `window=0`。
- `exit_buffer` 用在 `facing`；`poll_interval` 用在事件驱动；`continuity.dwell` 用在事件驱动。
- 规则 `actions` 为空；`gate.at` 越界；`schedule.fact` 指向未知绑定。
- EVENT `time>duration`；`position` 混写；`event_type=foo`；MOD_EVENT `data` 顶层数组；MOD_EVENT 写 `id`。
- `pingpong` 用在 EVENT。

### 真游戏

1. 通过现有脚本通道推送夹具；游戏侧校验通过（warn 允许）。
2. 触发器：进入区域、登录、进度、击杀、物品使用、观察、结构、游戏阶段各触发一次；`repeatable=false` 第二次不触发；`repeatable=true` 可再触发；`delay` 延迟；`on_enter` 只进入瞬间；`exit_buffer` 外扩；`continuity` 连续段。
3. 前置：`script_played` 在目标脚本中途退出后仍成立；`script_started` 开始即成立；`script_completed` 只看结束；缺失脚本触发器不触发。
4. 规则：`gate.at` 前不求值；`enter/dwell`；`once` 执行内一次；`cooldown` 跨执行；`schedule` 五种释放；`timeout` 一次；`hold` 挂起与释放；`pause/resume`；`exit` 结束实例。
5. 动作：`camera_set` 六通道；`overlay_set` fade；`adjust_set` 15 通道；`goto_clip` 新分支；`play_sound` 一次性；`emit_command` 仅观看者、权限等级、`&&` 分段；动作失败不中断。
6. 出口：五种覆盖；`goto` 分支新目标用自身默认出口；绑定 `exit` 只覆盖本绑定 goto 分支；不作用于下一跳。
7. 事件：EVENT 命令对每个观看者执行；空 command 不执行；position 折线移动；不足两个航点不动；片段循环不重放；seek 前跳不补、后跳可重触发；暂停恢复边沿补扫；`pingpong` 拒绝。
8. MOD_EVENT：格式正确落盘；内置播放器不消费；不显示内置效果；第三方消费者可编译读取。
9. 事实：`trigger_fired` 持久；`script_*` 锁存；`clip_fact` 最近一次执行；`rule_fact` 最近一次激活；`action_completed` 为批次已提交，不是每动作成功。
10. 05 悬停：显示全部触发器/条件/前置；滚动不截断；定位到触发器选中正确；读取失败退回摘要。

## 跨轮验收

| 项 | 必须成立 |
|---|---|
| 05-03 悬停 | 已改为全部触发器 + 完整条件树 + 前置；360px、内部滚动；定位入口；05-01 不动 |
| 05 图数据契约 | 未新增字段；悬停按需读脚本；`script.graph.invalidated` 后缓存失效 |
| 04 抽屉 | `behavior` 复用 04 预留页签；不新开抽屉 |
| 06 触发器缺省 | `meta.trigger_poll_interval` 在 Script Properties 卡；行为页只显示继承 |
| 02/06 事件对象 | 沿用 `objects.event` / `objects.mod_event`；不按采样曲线渲染 |
| 09/10 字段 | 不把 OVERLAY/LETTERBOX/AUDIO/ADJUST 字段塞进行为页 |
| 08 转场 | 11 不做转场；事件不当转场 |
| 消息 | 不新增消息类型；不改网络包 |
| 模组 | 不改 `.java`；不改脚本 schema |

## 出口条件

“行为面板完整”按下面判定：

- 作者能在行为页完成触发器、规则、绑定、事实引用、EVENT、MOD_EVENT 的全部必填/可选字段，不需要外部手改 JSON。
- 所有引用可解析或明确标记缺失；所有 error 可定位到字段；所有 warn/info 有说明。
- 没有第二个事件编辑器、第二时间轴、第二套选择状态、第二套运行时。
- 没有把触发器动作/目标伪装成可配置；没有把 MOD_EVENT 伪装成内置效果；没有把绑定 `exit` 说成 clip 完成出口。
- 脚本图悬停能显示全部触发器和全部条件，包括跨脚本前置，且不截断。
- 编辑器构建通过；真游戏夹具按本文件通过。

## 本轮未执行

- 11 文档是设计交付；行为页代码尚未实现，所以 `npm run build` 与真游戏播放未执行。
- 05-03 已按 11 合同修订，但尚未构建/运行验证。
- 10/09/08 的构建与冒烟不在 11 文档验收范围内。
- 本文件不把上述项标记为已通过；实现后按“运行验收”逐项执行。
