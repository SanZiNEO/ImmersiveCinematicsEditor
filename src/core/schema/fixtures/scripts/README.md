# 脚本夹具（02-09 验收材料）

本目录是 `plan/02/02-09-reconcile-fixtures.md` 的夹具部分落地，用来证明
「字段目录 + 主模组 `ScriptParser` / `script.validate`」对得上。

- **不是运行时数据**：编辑器构建、运行、`schema.get` 对账都不读这里。
- **不是从快照反推的字段**：每条夹具的字段名都来自主模组源码（见文末来源），
  没有 `Vec3`，也没有 `export-schema.mjs` 产物。
- **本轮不连游戏**：只保证 JSON 结构与主模组源码一致；真正的「接受 / 拒绝」判定
  必须在带 `ImmersiveCinematics` 的真实游戏实例里跑（见下节）。

## 怎么用这组夹具

对每个 `valid/*.json`：

1. 读文件文本 → `ScriptParser.parse(text)`，期望不抛 `ScriptParseException`。
2. 同一文本 → `ScriptValidator.validate(text)`，期望 `ScriptValidator.errorsOf(issues)` 为空。
3. 需要播放侧确认的，再把脚本放进实例的脚本目录加载一次。

对每个 `invalid/*.json`：

1. 去掉根部的 `name` / `expect` / `doc` 三个夹具元数据键（主模组解析器忽略根对象未知键，
   但验收脚本应显式剥离，避免把元数据当成脚本内容）。
2. 先跑 `ScriptValidator.validate(text)`，期望 `errorsOf(issues)` 里至少一条 issue
   命中该文件的 `expect` 关键字。
3. 若该文件的 `expect` 标注为解析期拦截，再跑 `ScriptParser.parse(text)`，期望抛
   `ScriptParseException`，且消息带字段路径（`meta.*` / `timeline.tracks[i].clips[j].objects.*` /
   `paths[i].*` / `rule_bindings[i].*`）。

> 验收口径按两层看：**解析期**（`ScriptParser`，首个错误即抛；`invalid` 里大部分属于这层）
> 与 **校验期**（`ScriptValidator`，汇总 issue；`base-resolution-*`、`screen-layers-non-bool`、
> `unknown-action-type` 属于这层——解析器对它们只记日志或不判，`script.validate` 才拦）。
> 02-09 要求的「逐条 block」以 `script.validate` 判定为准。

## 索引

`index.json` 是字符串清单，不携带断言数据：

```json
{ "valid": ["objects-demo.json", ...], "invalid": ["meta-unknown-key.json", ...] }
```

- `valid` 6 条、`invalid` 20 条，与 `valid/`、`invalid/` 目录内的 `.json` 文件一一对应（不含本目录的 `index.json`）。
- 本目录不引入依赖、不生成代码；夹具内容变更只需同步本 README 与 `index.json`。

## 合法夹具（必须被接受）

| 文件 | 覆盖点 | 期望行为 |
|---|---|---|
| `valid/objects-demo.json` | CAMERA 片段：`position.x` / `position.y` / `position.z` 各在 `{0,3}` 两帧，`yaw` 在 `{1,2}` 两帧，`fov` 只有 `value` | 三轴帧时间可以不同、不要求对齐；`parse` 成功，`validate` issues=0 |
| `valid/value.json` | `fov:70`、`position_mode:"relative"`、`position_space:"world"`，全部固定值 | 固定值（无 keyframes）对 animated 字段合法；`parse` 成功，`validate` issues=0 |
| `valid/step.json` | `position_mode` / `position_space` / `look_at` 用 step 语义，值在 t=2 切换 | step 由 schema 的 `interp=step` 决定，值切换不插值；`position_mode` / `position_space` 在 t=2 变化，因此同刻写齐 `position.x/y/z` 关键帧（校验器的参考系切换对齐要求）；`parse` 成功，`validate` issues=0 |
| `valid/collections.json` | 顶层 `clips[]` / `rules[]` / `rule_bindings[]` / `paths[]` 各一条，引用互相对得上 | `clips[0].id = clip_collect`；`rule_bindings[0].rule` 命中 `rules[0].id`、`.clip` 命中 `clips[0].id`；`paths[0]` 的 `from/to = 0/3` 命中该片段 position 节点时间且相邻；`parse` 成功，`validate` issues=0 |
| `valid/seven-tracks.json` | CAMERA / LETTERBOX / AUDIO / EVENT / MOD_EVENT / OVERLAY / ADJUST 各一个最小片段 | 七轨对象模型各取最小必填（AUDIO 的 `sound`、OVERLAY 的 `layer_type`、EVENT / MOD_EVENT 的事件记录各一帧）；`parse` 成功，`validate` issues=0 |
| `valid/meta.json` | 23 个 meta 键各出现一次；`base_resolution {w:1920,h:1080}`；`screen_layers {"hud.hotbar":false}`；`skip_vote_ratio:50` | 23 = 21 个 schema meta 字段 + 仅解析期声明的 `triggers` / `trigger_poll_interval`；`macro_loop` 与 `hold_at_end` 都取 false（二者互斥，开启会被校验器报）；`parse` 成功，`validate` issues=0 |

`valid/` 下每个文件都是完整脚本对象：`meta` + `timeline`（`timeline.tracks[]` 至少一条），
`collections.json` 额外带四类集合。

## 非法夹具（必须被拒绝）

`expect` 是期望命中的 issue / 解析错误关键字；`拦截层` 说明哪一层负责拦。

| 文件 | expect | 拦截层 | 说明 |
|---|---|---|---|
| `invalid/meta-unknown-key.json` | `未知字段` | 解析期 + 校验期 | `meta.no_such_field` 不在 `ScriptParser.META_KEYS`（23 键）里 |
| `invalid/timeline-unknown-key.json` | `未知字段` | 解析期 + 校验期 | `timeline` 只允许 `tracks` / `loop_start` / `loop_end` |
| `invalid/value-with-keyframes.json` | `mode=value 不允许 keyframes` | 解析期 + 校验期 | `mask_shape` 是 value 模式，不能带 keyframes |
| `invalid/event-empty-keyframes.json` | `mode=event 必须有 keyframes` | 解析期 + 校验期 | EVENT 轨 `event` 空 keyframes 不合法 |
| `invalid/keyframe-time-equal.json` | `单调递增` | 解析期 + 校验期 | 两帧同一 time |
| `invalid/keyframe-time-desc.json` | `单调递增` | 解析期 + 校验期 | 第二帧 time 小于第一帧 |
| `invalid/keyframe-time-negative.json` | `不能为负数` | 解析期 + 校验期 | 关键帧 time = -1 |
| `invalid/string-number.json` | `需要有限数字` | 解析期 + 校验期 | `fov.value` 写成字符串 `"70"`，不做类型转换 |
| `invalid/int-fraction.json` | `需要整数` | 解析期 + 校验期 | `cam_breath_seed.value = 2.5`（int 字段） |
| `invalid/nan.json` | `必须为有限数字` | 解析期 + 校验期 | keyframe `time = 1e400`：JSON 解析后为 Infinity，不是有限数 |
| `invalid/null-non-nullable.json` | `需要有限数字` | 解析期 + 校验期 | `yaw.value = null`（只有 `yaw_lock` / `pitch_lock` 可空） |
| `invalid/path-index.json` | `非法属性路径` / `未知对象路径` | 解析期 + 校验期 | `position[0]` 不是合法点分路径（解析器报非法属性路径，校验器报未知对象路径，故 expect 两词都列） |
| `invalid/base-resolution-zero.json` | `超出范围` | 校验期 | `base_resolution {w:0,h:1080}`：解析器记日志并回落缺省，`script.validate` 报 w 超出 1..2147483647 |
| `invalid/base-resolution-vec3.json` | `base_resolution` | 校验期 | `base_resolution {x:0,y:64,z:-64}`：解析器回落缺省，`script.validate` 报 w / h 缺失 |
| `invalid/screen-layers-non-bool.json` | `需要布尔值` | 校验期 | `screen_layers {"hud.hotbar":1}`：解析器跳过该键，`script.validate` 报非布尔 |
| `invalid/paths-not-adjacent.json` | `相邻` | 解析期 + 校验期 | 节点时间 `[0,1,2]`，路径 `from:0 → to:2` 跳过中间节点 |
| `invalid/rule-binding-dangling.json` | `未知规则引用` | 解析期 + 校验期 | `rule_bindings[0].rule = "rule_missing"`，不命中 `rules[].id` |
| `invalid/unknown-geometry.json` | `未知曲线类型` | 解析期 + 校验期 | `paths[0].geometry.type = "spline"`，不在 `line` + 已注册曲线里，不回落 `line` |
| `invalid/unknown-timing.json` | `未知时间映射类型` | 解析期 + 校验期 | `paths[0].timing.type = "cubic"`，只接受 `linear` / `keyframes` |
| `invalid/unknown-action-type.json` | `未知动作` | 校验期 | `actions[0].type = "teleport"`：规则解析只做结构拷贝、不判动作类型，`script.validate` 报未知动作 |

## 注意事项

- **`invalid/nan.json` 不要用 `JSON.stringify` 往返**：`1e400` 在 JS 里是 Infinity，重新序列化会变成
  `null`，就退化成另一个非法用例。文件按原始文本读取即可。
- **夹具元数据键**：`invalid/*.json` 根部的 `name` / `expect` / `doc` 只给验收脚本读；
  主模组 `ScriptParser` 不校验根对象未知键，所以带元数据也能解析，但验收时应先剥离。
- **`expect` 是关键字不是全文**：匹配方式是「issue 文本包含该关键字」，与
  `src/core/schema/fixtures/invalid/*.json` 既有夹具的 `expect` 用法一致。
- **`meta` 键数**：plan 02-09 写的是「21 个 meta 字段」，这里按源码实际允许键取 23
  （21 个 `SchemaRegistry.getMetaFields()` 字段 + `triggers` + `trigger_poll_interval`），
  与 `sealed.meta.length === 23` 的目录口径一致。
- 本目录不接 `src/core/schema/verify.ts`：该入口当前只跑目录自检与 `fixtures/invalid` 的
  字段级反例；脚本夹具的判定需要真实脚本解析器与校验器，故留作游戏内验收材料。
- 02-09 的**对账夹具**不在这里：远端 `schema.get` 与离线快照分别由
  `src/core/schema/fixtures/remote-schema.json`、`src/core/schema/fixtures/snapshot.json` 承担。

## 来源（主模组只读源码，`E:/Documents/GitHub/ImmersiveCinematics`）

- `common/src/main/java/com/immersivecinematics/immersive_cinematics/script/ScriptParser.java`
  — `META_KEYS` / `TIMELINE_KEYS`、`parseMeta`、`parseTimeline`、`parseObjectClip`、`parseStandaloneClips`。
- `.../script/object/ObjectParser.java`、`ObjectCodec.java`、`PropertyPath.java`
  — 片段级键白名单、属性 `value` / `keyframes` 形态、严格类型转换、点分路径段规则。
- `.../script/schema/MetaSchemas.java`、`TrackSchemas.java`、`TriggerSchemas.java`
  — 23 个 meta 键、七轨对象模型与播放控制字段、触发器类型与 conditions 字段。
- `.../script/path/PathCollectionParser.java`、`PathTiming.java`
  — `paths[]` 条目字段、端点必须命中 position 节点时间且相邻、geometry / timing 类型域。
- `.../script/rule/RuleCollectionParser.java`、`ClipExitPolicyParser.java`、`RuleControl.java`、`RuleReleaseKind.java`
  — `rules[]` / `rule_bindings[]` 字段白名单、引用完整性、`gate.at` 范围、出口 / 调度枚举。
- `.../script/ScriptValidator.java`、`.../script/object/ObjectValidator.java`
  — 未知字段汇总、`base_resolution` / `screen_layers` 语义校验、动作类型白名单、参考系切换对齐。

## 第 11 轮行为域夹具（`behavior-*`）

四组行为域（触发器 / 规则 / 绑定 / 事件）的验收材料：合法件走既有 `parseDoc` + 目录加载，再由对应域校验函数
（`validateTriggerConditions` / `triggerTimingIssues` / `requirementEntries` + `validateRequirementFields` /
`validateRules` / `validateBindings` / `validateEventRecord` / `validateModEventRecord`）读出；非法件每个只承载一类判定。
字段键与取值以 `src/core/schema/catalog/behavior{Triggers,Rules,Events}.ts` 与主模组源码为准。

### 合法夹具（`valid/behavior-*.json`）

| 文件 | 覆盖点 | 允许的附带 issue |
|---|---|---|
| `behavior-triggers-single.json` | 25 个叶子触发器类型各一条，必填字段补齐、可选字段取合法取值；组合器另见下一条 | 无 |
| `behavior-triggers-combinator.json` | `all_of` 含区域 + 群系；`any` 含进度 + 登录（`continuity.window=40`）；三层嵌套 `all_of > any > all_of` | 无 |
| `behavior-triggers-requirements.json` | 前置五种形态：字符串简写（`script_played`）、对象形态 `script_started`、整段省略、自引用、自定义类型 | 自引用：域层内部码 `REQ_SELF_REFERENCE` 仅作域内标记，落盘判定一律取合同注册表 `L44` = error（`meta.triggers[3].requires[0].script`，单条）。跨脚本目标 `demo_other` 在单夹具无图索引下降级 unresolved，不阻断、不记缺失（见下节说明） |
| `behavior-triggers-timing.json` | `delay=1.5`；location 球形 + `on_enter`；location 球形 + `continuity.sweep`；`dwell=20`；`window=40` 在 `all_of`；省略 `continuity`；`exit_buffer`；`poll_interval=40`；death 纯事件不带边缘字段 | 无 |
| `behavior-rules.json` | 四条规则：时间条件配相机 + 覆盖层（单次）；位置 + 相机朝向配跳转；片段事实 + 规则事实配命令动作（事实调度）；暂停 / 恢复 / 退出 / 发声 / 调色（持有、无限等待）。绑定覆盖时间门中段、持有、五种调度各一条、五种出口各一条 | `BINDING_EXIT_SYNONYM_MIX`（L90，info）：同一 `clip_a` 多条绑定混用 `continue` / `return` / `end_execution`，三者当前行为一致，仅提示不阻断 |
| `behavior-events.json` | 两条 EVENT 轨 + 一条 MOD_EVENT 轨：t=0 空命令占位、多段命令（`&&`）、绝对位置 `{x,z}`、相对位置 `{dx,dz}`、命令加移动；扩展事件对象级缺省、记录继承、记录覆盖、嵌套数据（对象 / 数组 / 字符串 / 有限数 / 布尔 / null） | `L84`（warn）：检测到 2 条 EVENT 轨；既有扫描器把提示池复制到每个记录节点，故同一提示按节点重复下发 |

### 非法夹具（`invalid/behavior-*.json`）

| 文件 | 判定类别 | 内部问题码 | 合同码 | 级别 | 备注 |
|---|---|---|---|---|---|
| `behavior-trigger-duplicate-id.json` | 触发器 id 重复 | 触发器 id 重复（结构层身份检查） | `L42` | error | 遗留旧触发器检查并行报一条 `L32`，同语义复检，不算第二类判定 |
| `behavior-rule-duplicate-id.json` | 规则 id 重复 | `RULE_ID_DUPLICATE` | `L53` | block | 结构层遗留旧规则检查并行报一条 `L29`（同语义复检），不算第二类判定 |
| `behavior-binding-duplicate-id.json` | 绑定 id 重复 | `BINDING_ID_DUPLICATE` | `L56` | block | 结构层遗留旧绑定检查并行报一条 `L30`（同语义复检），不算第二类判定 |
| `behavior-requirement-missing-script.json` | 前置指向不存在脚本 | `REQ_SCRIPT_MISSING_TARGET` | `L44` | error | — |
| `behavior-requirement-self-reference.json` | 前置自引用 | `REQ_SELF_REFERENCE` | `L44` | error | 域层内部码 `REQ_SELF_REFERENCE` 仅作域内标记（域内 warn）；落盘判定取合同注册表 `L44` = error，当前仅一条。夹具只覆盖自引用这一判定 |
| `behavior-trigger-combinator-depth.json` | 组合器嵌套九层（上限 8 层） | `COMBINATOR_DEPTH_LIMIT` | `L46` | block | — |
| `behavior-trigger-combinator-empty.json` | 组合器空列表 | `COMBINATOR_LIST_EMPTY` | `L46` | block | — |
| `behavior-trigger-combinator-event-no-window.json` | 事件类子条件窗口为 0 | `COMBINATOR_EVENT_NO_WINDOW` | `L47` | block | — |
| `behavior-trigger-exit-buffer-on-facing.json` | 离开外扩用在朝向类型 | `TRIGGER_EXIT_BUFFER_UNSUPPORTED` | `L48` | error | — |
| `behavior-trigger-poll-interval-on-event.json` | 轮询间隔用在事件驱动类型 | `TRIGGER_POLL_INTERVAL_UNSUPPORTED` | `L49` | error | — |
| `behavior-trigger-dwell-on-event.json` | 驻留用在事件驱动类型 | `TRIGGER_DWELL_UNSUPPORTED` | `L51` | block | — |
| `behavior-rule-actions-empty.json` | 规则动作为空 | `RULE_ACTIONS_EMPTY` | `L53` | block | 结构层遗留旧规则检查并行报一条 `L29`（同语义复检），不算第二类判定 |
| `behavior-binding-gate-out-of-bounds.json` | 时间门越界 | `BINDING_GATE_OOB` | `L56` | block（内部 error） | 结构层遗留旧绑定检查并行报一条 `L30`（同语义复检），不算第二类判定 |
| `behavior-binding-schedule-fact-unknown.json` | 事实调度指向未知绑定 | `BINDING_SCHEDULE_BINDING_UNKNOWN` | `L56` | block | 结构层遗留事实引用检查并行报一条 `L33`；`L56` 两条为同一未知绑定引用在引用索引与调度事实两处登记，同语义，不算第二类判定 |
| `behavior-event-over-duration.json` | 事件记录超片段时长 | `L72` | `L72` | warn | — |
| `behavior-event-position-mixed.json` | 绝对 / 相对位置混写 | `L76` | `L76` | block | 结构层遗留对象成员 / 形态检查并行报一条 `L16`（同语义复检），不算第二类判定 |
| `behavior-event-type-illegal.json` | EVENT 事件类型非法 | `L74` | `L74` | error | — |
| `behavior-mod-event-data-array.json` | 扩展事件 `data` 顶层为数组 | `L82` | `L82` | block | 结构层遗留对象成员 / 形态检查并行报一条 `L16`（同语义复检），不算第二类判定 |
| `behavior-mod-event-record-id.json` | MOD_EVENT 记录体写 `id` | `L80` | `L80` | block | 结构层遗留对象成员 / 形态检查并行报一条 `L16`（同语义复检），不算第二类判定 |
| `behavior-event-pingpong.json` | 乒乓模式用在事件轨 | 结构层内联片段检查 | `L85` | error | 仅对内联片段（`timeline.tracks[*].clips[*]`）判定；独立片段路径服务端不经 `ObjectValidator.validate`。服务端依据 `ObjectValidator.java:176-183` `rejectPingpong` |

### 无法用夹具表达的判定

本轮 11-16 非法清单的 20 类判定均已落地为夹具；乒乓模式用在事件轨由 `behavior-event-pingpong.json`（`L85`）覆盖。
服务端 `ObjectValidator.rejectPingpong` 对独立片段路径不经 `ObjectValidator.validate`，
该路径的乒乓拒绝仍以真游戏实例验收为准。

- **字符串简写前置的目标缺失（`requires: ["no_such_script"]` → `L44`/error）静态夹具无法表达**：该存在性判定只有在调用方提供
  `knownScriptIds`（项目图脚本索引）时才触发；不传索引时三态降级 unresolved，不报缺失。现有静态加载器
  （`index.json` 纯字符串清单、`src/core/doc/verify.ts` 的 `localIssues`）均不按件注入脚本索引，夹具 JSON 内也没有可声明已知脚本 id 的通道，
  故不硬加该件，由 `verify-11` 的构造用例在注入项目图索引后覆盖。同属索引依赖的还有对象形态缺失目标
  （`behavior-requirement-missing-script.json`）：其 `L44` 命中同样依赖运行时注入索引，单件静态加载下降级 unresolved。

### 上下文性 issue 说明

- 前置目标解析依赖项目图索引（已加载脚本 id 集合）。单份夹具不携带图索引，结构层 `factIndex` 的 `scriptIds` 为空集，
  指向其他脚本的内置前置降级 unresolved（不阻断、不记缺失）；只有自引用由 `selfScriptId` 直接比对，记 `L44`。
  真实编辑器由项目图索引解析，Java `validatePrerequisiteRef` 也仅在调用方传入已知脚本集合时才做存在性检查。
- `behavior-trigger-duplicate-id.json` 除合同 `L42` 外，结构层遗留的旧触发器检查并行报一条 `L32`（同语义复检），属既有双检查并存，不算第二类判定。
