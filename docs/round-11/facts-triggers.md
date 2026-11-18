# 11 轮触发器域 · Java 事实清单（交付证据）

> 范围：`plan/11/11-01 ~ 11-05` 落在编辑器纯函数层的全部字段面与边界。
> 路径相对主模组仓库根 `E:\Documents\GitHub\ImmersiveCinematics`；行号为 1 起。
> 编辑器落地文件：
> - `src/core/schema/catalog/behaviorTriggers.ts`（27 类型字段目录）
> - `src/features/behavior/trigger.types.ts`（读取模型）
> - `src/features/behavior/trigger.ts`（身份 / 缺省 / 时序 / 旧字段）
> - `src/features/behavior/triggerConditions.ts`（条件树 / 摘要）
> - `src/features/behavior/requirements.ts`（前置 / 依赖边 / 成环）

## 1. 类型注册与监听分类

| Java 文件 | 行 | 符号 / 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../spi/ListenStrategy.java` | 6-11 | 策略仅两种：`EVENT_DRIVEN`（事件回调，不参与轮询）/ `POLLING`（tick 轮询）。 | `behaviorTriggers.ts` `TriggerRole` |
| `common/.../ImmersiveCinematics.java` | 24 | `location` POLLING，默认间隔 `Config.triggerPollIntervalLocation` | 目录 `location` 条目 |
| 同上 | 26 | `advancement` EVENT_DRIVEN，间隔 0 | 目录 `advancement` |
| 同上 | 27 | `biome` POLLING，默认 `Config.triggerPollIntervalBiome` | 目录 `biome` |
| 同上 | 28 | `entity_kill` EVENT_DRIVEN | 目录 `entity_kill` |
| 同上 | 29 | `entity_interact` EVENT_DRIVEN | 目录 `entity_interact` |
| 同上 | 30 | `dimension_change` EVENT_DRIVEN | 目录 `dimension_change` |
| 同上 | 31 | `login` EVENT_DRIVEN，无条件字段 | 目录 `login`（`fields: []`） |
| 同上 | 32 | `inventory` POLLING，默认 `Config.triggerPollIntervalInventory` | 目录 `inventory` |
| 同上 | 33 | `item_craft` EVENT_DRIVEN | 目录 `item_craft` |
| 同上 | 34-35 | `structure` POLLING，默认 `Config.triggerPollIntervalStructure` | 目录 `structure` |
| 同上 | 36 | `gamestage` POLLING，默认 `Config.triggerPollIntervalGamestage` | 目录 `gamestage` |
| 同上 | 37 | `item_use` EVENT_DRIVEN | 目录 `item_use` |
| 同上 | 38 | `item_consume` EVENT_DRIVEN | 目录 `item_consume` |
| 同上 | 39 | `item_release` EVENT_DRIVEN | 目录 `item_release` |
| 同上 | 40 | `item_instant_use` EVENT_DRIVEN | 目录 `item_instant_use` |
| 同上 | 41 | `item_use_interrupt` EVENT_DRIVEN | 目录 `item_use_interrupt` |
| 同上 | 42 | `block_interact` EVENT_DRIVEN | 目录 `block_interact` |
| 同上 | 43 | `item_on_interact` EVENT_DRIVEN | 目录 `item_on_interact` |
| 同上 | 44 | `xp` POLLING，默认 `Config.triggerPollIntervalLocation` | 目录 `xp` |
| 同上 | 46 | `dimension` POLLING，默认 `Config.triggerPollIntervalLocation`（与 dimension_change 共用求值器） | 目录 `dimension` |
| 同上 | 47 | `item_pickup` EVENT_DRIVEN | 目录 `item_pickup` |
| 同上 | 48 | `item_drop` EVENT_DRIVEN | 目录 `item_drop` |
| 同上 | 50-51 | `observation` POLLING，默认 5 tick（0.25s） | 目录 `observation` |
| 同上 | 53-54 | `facing` POLLING，默认 5 tick | 目录 `facing` |
| 同上 | 55-56 | `all_of` POLLING，默认 5 tick | 目录 `all_of`（`role: 'mixed'`） |
| 同上 | 57-58 | `any` POLLING，默认 5 tick | 目录 `any`（`role: 'mixed'`） |
| 同上 | 60 | `death` EVENT_DRIVEN，场景条件按死亡时刻快照判定 | 目录 `death` |
| `common/.../Config.java` | 62, 64, 66, 68, 70 | 类型级默认间隔：location 20 / biome 40 / inventory 20 / structure 20 / gamestage 20（tick） | 目录 `defaultPollInterval` |
| `common/.../spi/TriggerType.java` | 17, 19 | `POLL_INTERVAL_MIN = 1`，`POLL_INTERVAL_MAX = 600` | `behaviorTriggers.ts` 区间常量 |
| 同上 | 65-70 | `resolvePollInterval`：事件驱动恒返回 0；轮询类 = 触发器级 ?? 脚本级 ?? 类型级默认，钳到 ≥1 | `trigger.ts` 时序适用性口径 |

> 分类备注：`all_of` / `any` 在 Java 注册策略是 `POLLING`，但其子项可挂事件类条件（仅当 `continuity.window > 0`，见 §5），是轮询与事件两类子条件的桥接节点，编辑器目录标 `mixed`。

## 2. 声明身份与静态字段

| Java 文件 | 行 | 符号 / 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../script/TriggerDefinition.java` | 15 | `ID_REGEX = "[A-Za-z0-9_]{1,64}"`（1~64 位字母 / 数字 / 下划线） | `trigger.ts` `TRIGGER_ID_PATTERN` |
| 同上 | 19, 21 | 显式 `id` 可空；`declarationIndex` 为 `meta.triggers[]` 下标，-1 = 未知 | `trigger.types.ts` `TriggerNode.index` |
| 同上 | 87 | 身份 = 显式 id，否则 `type#declarationIndex` | `triggerIdentity()` |
| 同上 | 22 | `conditions` 为条件表（缺省空 Map） | `TriggerNode.conditions` |
| 同上 | 23 | `repeatable` 缺省 false（单次持久，事实账本去重） | `parseTiming()` / `REPEATABLE_TOGGLE_NOTE` |
| 同上 | 24 | `delay` 单位秒（`ScriptManager` 112 行 ×1000 转 ms） | `TriggerTimingView.delaySeconds` |
| 同上 | 25 | `onEnter` 缺省 false | `parseTiming()` |
| 同上 | 26 | `exitBuffer` 单位格 | `TriggerTimingView.exitBuffer` |
| 同上 | 28 | `requires` 前置列表，AND 语义，空 = 无前置 | `requirements.ts` |
| 同上 | 31 | `pollInterval` 触发器级覆盖；null = 回落脚本级 → 类型级默认 | `TriggerTimingView.pollInterval` |
| 同上 | 33 | `continuity` 缺省 `ContinuitySpec.DEFAULT` | `parseContinuity()` |
| `common/.../script/ScriptParser.java` | 919, 926-929, 932-933 | 解析缺省：repeatable=false、delay=0、on_enter=false、exit_buffer=0；poll_interval / continuity 单独解析 | `applyTimingDefaults()` |
| 同上 | 947 | continuity 缺省 / JSON null → `ContinuitySpec.DEFAULT` | `isContinuityOmittable()` |
| 同上 | 1040-1045 | 对象前置解析：`data` = 除 `type` 外的全部键（扁平形态，非 `data` 嵌套） | `requirementEntries()` |

## 3. 条件字段面（TriggerSchemas 登记项）

| Java 文件 | 行 | 字段 / 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../script/schema/TriggerSchemas.java` | 64-90 | 27 类型在 `all()` 中的登记顺序 | `TRIGGER_TYPES` 顺序 |
| 同上 | 102-106 | `location`：dimension? / position? / radius? / corner1? / corner2? | 目录 `location.fields` |
| 同上 | 112 | `advancement`：advancement（必填 string） | 目录 `advancement.fields` |
| 同上 | 118 | `biome`：biome（必填 string） | 目录 `biome.fields` |
| 同上 | 124-130 | `entity_kill`：entity（必填）+ dimension? / biome? / position? / radius? / corner1? / corner2? | 目录 `entity_kill.fields` |
| 同上 | 137-142 | `death`：dimension? / biome? / position? / radius? / corner1? / corner2?（无 entity） | 目录 `death.fields` |
| 同上 | 148 | `entity_interact`：target（必填） | 目录 `entity_interact.fields` |
| 同上 | 154 | `block_interact`：target（必填） | 目录 `block_interact.fields` |
| 同上 | 160-162 | `item_on_interact`：item（必填）/ target（必填）/ target_type? enum `"" | block | entity` | 目录 `item_on_interact.fields` |
| 同上 | 168-169 | `dimension_change`：dimension（必填）/ from_dimension? | 目录 `dimension_change.fields` |
| 同上 | 175, 181, 187, 193, 199, 205, 211, 217 | 八个物品事件类型：item（必填 string） | 目录对应 `item` 字段 |
| 同上 | 223-224 | `xp`：level? / total?（int；至少一项，见 §4） | 目录 `xp.fields` |
| 同上 | 230 | `dimension`：dimension（必填 string） | 目录 `dimension.fields` |
| 同上 | 236-238 | `observation`：target（必填）/ target_type? enum / reach? float 缺省 4.5 | 目录 `observation.fields` |
| 同上 | 244-245 | `inventory`：items（必填 array）/ change? enum `"" | increase | decrease` | 目录 `inventory.fields` |
| 同上 | 251-252 | `structure`：structure（必填 string）/ radius? int | 目录 `structure.fields` |
| 同上 | 258 | `gamestage`：stage（必填 string） | 目录 `gamestage.fields` |
| 同上 | 264-267 | `facing`：yaw1 / pitch1 / yaw2 / pitch2（float） | 目录 `facing.fields` |
| 同上 | 272-273 | 组合器：schema 不登记专用字段，子项结构在校验 / 求值层 | 目录 `list` 字段（sourceRef 指向 Evaluators 598） |

### 3.1 schema 未登记、但求值 / 事实层承认的字段

| Java 文件 | 行 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../trigger/server/fact/EventFactMatch.java` | 94-102 | `entity_interact` / `block_interact` 的可选 `item`（手持物品）由匹配层承认；`TriggerSchemas` 未登记 | 目录两个交互类型补 `item` 字段，sourceRef 指本行 |
| 同上 | 103-105 | `target_type` 写了必须等于本类型隐含的 `block` / `entity`，否则不匹配 | 目录补 `target_type` 字段 |

## 4. 跨字段语义与求值边界

| Java 文件 | 行 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../trigger/shared/GeometryConditions.java` | 29-38 | id 通配：`*` 全匹配；`ns:*` 前缀；无 `:` 子串包含；其余全等；不判非法写法 | `matchesIdPattern()` |
| 同上 | 44-57 | 方体：corner1 / corner2 各轴先 min/max 归一，顺序无关；任一角缺 x/y/z → false | `regionIssues()` 方体缺分量报错 |
| 同上 | 60-71 | 球形：position 缺分量 → false；半径缺省 0 | 球形缺分量报错 |
| 同上 | 77-93 | 场景快照匹配：dimension / biome 先过，球形与方体分支各自判定 | 区域视图 `readRegionView()` |
| 同上 | 151-164 | 朝向：pitch 取 min/max；yaw 顺时针扫弧、跨 ±180° 环绕；起止 yaw 相同（span 0）= 整圈不限 | `validateFacing()` 整圈 info |
| `common/.../trigger/server/evaluator/Evaluators.java` | 211-215 | `xp`：level / total 至少填一项，否则 false | `validateXp()` 双空报错 |
| 同上 | 355-358 | `inventory`：items 必须是非空数组 | `validateInventory()` 空数组报错 |
| 同上 | 365-387 | `change` 空 = 同时拥有全部；increase / decrease = 任一模式数量对应变化 | 目录 `change` 描述；摘要文案 |
| 同上 | 253, 285-317 | `observation`：reach 缺省 4.5；target_type 空 = 方块和实体都查；射线命中 block / entity 分别匹配 | `validateObservation()` 负数报错；摘要 |
| 同上 | 417-427 | `structure`：只写 structure id + radius（搜索半径），不写位置 | 目录 `structure.fields` |
| 同上 | 513-517 | `facing`：四个角度任一缺失 / 非数字 → false | `validateFacing()` 四角必填报错 |
| `common/.../script/ScriptValidator.java` | 2381-2383 | pitch 端点超出 -90~90 → 该条件永不满足 | `validateFacing()` pitch 越界报错 |
| 同上 | 2392-2407 | `death` 场景组：dimension / biome 必须字符串；position / corner1 / corner2 必须对象；radius 必须数字 | 目录 death 字段类型；区域校验 |

## 5. 组合器条件树

| Java 文件 | 行 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../trigger/server/evaluator/Evaluators.java` | 545 | `MAX_COMBINATION_DEPTH = 8`（含顶层组合器自身为第 1 层） | `CONDITION_DEPTH_MAX` |
| 同上 | 588 | 组合器逐个求值 `list` 子项 | `readConditionChildren()` |
| 同上 | 582, 596-599 | 组合器方法 `evaluateCombination`；`list` 提取（缺失 / 非数组 / 空数组 → null） | 目录组合器 `list` 字段 |
| 同上 | 617 | 嵌套到上限不再下钻（运行时按不满足兜底） | `validateCombination()` 第 8 层禁新增 |
| 同上 | 618 | 子项 `conditions` 必须是对象 | 子项 conditions 类型报错 |
| 同上 | 625-626 | 已注册前置类型走 `PrerequisiteRegistry.evaluate(type, player, subConditions)`；前置数据在 `conditions` 里 | 组合器前置子项校验复用 `validateRequirementFields()` |
| 同上 | 634, 644 | 事件类子条件仅当 `ctx.windowTicks() > 0` 才按窗口求值 | 事件子条件无 window 报错 |
| `common/.../script/ScriptValidator.java` | 2421-2424 | `list` 缺失 / 非数组 → 报错 | 同上 |
| 同上 | 2427-2429 | `list` 不能为空 | 同上 |
| 同上 | 2434-2444 | 子项必须对象；`type` 必须非空字符串 | 同上 |
| 同上 | 2451-2453 | 嵌套超 8 层报错并停止下钻 | 深度 block 问题 |
| 同上 | 2462-2466 | 前置子项复用 requires 同一套字段检查 | `validateRequirementFields()` |
| 同上 | 2474-2479 | 事件类子条件：`windowTicks <= 0` 报错（窗口语义缺失） | 事件子条件无 window 报错 |
| 同上 | 2497-2527 | 前置 `type` 非空；内置 `script` 字段必填非空；自引用 / 跨脚本存在性检查 | `resolveRequirement()` / `validateRequirementFields()` |

## 6. 时序字段适用性

| Java 文件 | 行 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../script/ScriptValidator.java` | 2131-2133 | `exit_buffer` 对 facing / all_of / any 无效（无可外扩空间条件） | 目录 `timing.exitBuffer` |
| 同上 | 2137-2140 | `poll_interval` 对事件驱动类型无效（不参与轮询） | 目录 `timing.pollInterval` |
| 同上 | 2141-2150 | `death`：exit_buffer 无效；on_enter 无效（无进入 / 离开语义，进入状态不复位） | 目录 death 时序全 false |
| 同上 | 2160-2178 | poll_interval 必须 1~600 整数；非数字 / 非整数 / 越界分别报错，不夹取 | `triggerTimingIssues()` |
| 同上 | 2201-2207 | continuity.sweep 必须布尔 | 同上 |
| 同上 | 2212-2227 | continuity.dwell 必须 0~1200 整数 | 同上 |
| 同上 | 2232-2247 | continuity.window 必须 0~1200 整数 | 同上 |
| 同上 | 2250-2253 | sweep 仅 location / structure / facing / observation 有几何语义 | 目录 `timing.sweep` |
| 同上 | 2254-2255 | dwell 仅轮询类生效；事件驱动忽略 | 目录 `timing.dwell` |
| 同上 | 2257-2258, 2263-2265 | window 仅 all_of / any 生效 | 目录 `timing.window` |
| `common/.../script/ContinuitySpec.java` | 29, 32, 35-37 | DEFAULT = (false, 0, 0)；MAX_TICKS=1200；`isDefault()` 判定走旧快速路径 | `isContinuityOmittable()` |
| `common/.../trigger/server/TriggerEngine.java` | 312-318 | 未声明 continuity 且非 on_enter 走旧点判定快速路径；其余走边沿状态机 | 时序缺省口径 |
| 同上 | 329-332 | exitConditions 为外扩后区域；无外扩时直接用 inOriginal 复位 | `exitBuffer` 语义 |
| 同上 | 339-343 | 区域进入 / 离开事实只在 on_enter 触发器上记 | `onEnter` 语义 |
| `common/.../trigger/server/continuity/TriggerEdge.java` | 61-88 | 边沿状态机：entered / left / fire；dwell 以采样点真值为准；armed 进入后置假、彻底离开缓冲才复位 | 时序注释 / 面板提示 |
| `common/.../script/ScriptManager.java` | 112 | delay 秒 → ms：`(int)(delay * 1000)` | `ticksToSeconds()` / `secondsToTicks()` 换算参照 |
| 同上 | 116-118 | exitConditions 仅当 onEnter && exitBuffer>0 时由 `expandConditions` 构建 | `exitBuffer` 适用性 |

## 7. 前置条件与依赖

| Java 文件 | 行 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../script/TriggerRequirement.java` | 9-10 | 两形态：字符串 = 脚本 id（等价 `script_played` + `script`）；对象 = `type` + 参数 `data` | `requirementEntries()` |
| 同上 | 17-20 | 对象内部 `type` + `data`（解析层把除 type 外键收入 data） | `RequirementEntry` object 变体 |
| `common/.../trigger/server/prereq/BuiltinPrerequisites.java` | 19-22 | `script_played`：开始播放过 **且** 结束播放过（任何退出原因） | 目录内置条目 + 摘要 |
| 同上 | 25-28 | `script_started`：有开始播放事实（不校验是否结束） | 同上 |
| 同上 | 31-34 | `script_completed`：有结束播放事实（不校验是否开始过） | 同上 |
| 同上 | 37-40 | 内置前置目标脚本字段名 `script`；非字符串 / 缺失 → 不满足 | `resolveRequirement()` |
| `common/.../trigger/server/fact/FactQueries.java` | 15-17 | started：`PLAYBACK_STARTED` 事实存在 | 锁存语义 |
| 同上 | 19-21 | finished：`PLAYBACK_FINISHED` 事实存在 | 锁存语义 |
| 同上 | 24-26 | played = started && finished | `script_played` 语义 |
| 同上 | 28-30 | triggerFired：按 (玩家, 脚本, 触发器 id) 记单次触发事实 | `repeatable` 去重键口径 |
| `common/.../trigger/server/prereq/PrerequisiteRegistry.java` | 30-34 | 自定义类型可注册；重复注册后覆先 | 自定义只读口径 |
| 同上 | 47-52 | 未知类型默认不满足并记警告；编辑器侧不硬判自定义存在性 | 自定义 `custom` 状态 |
| `common/.../script/ScriptValidator.java` | 2057-2068 | 字符串前置：空 id 报错；自引用告警；指向不存在脚本报错 | `resolveTarget()` 状态判定 |
| 同上 | 2069-2072 | 对象前置走 `validatePrerequisiteRef` | `validateRequirementFields()` |
| `common/.../trigger/server/TriggerEngine.java` | 234-243 | 前置 AND：任一不满足跳过触发器 | 依赖门口径 |
| 同上 | 251-259 | 跳过判定：同脚本同玩家正在播放 → 跳过；非 repeatable 已触发过 → 跳过 | `repeatable` / 身份记账注释 |
| 同上 | 264-280 | 命中先记 triggerFired 事实；delayMs>0 入延迟队列；同触发器已在队列 → 不重复排队 | `DELAY_PENDING_NOTE` |

## 8. 触发后动作（只读口径）

| Java 文件 | 行 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| `common/.../script/ScriptManager.java` | 135 | 注册触发器时动作固定为 `List.of(new StartPlaybackAction(meta.getId()))`；触发声明 JSON 里没有动作表 / 目标 / play_script 字段 | `TRIGGER_ACTION_CARD_TEXT` |
| `common/.../trigger/server/action/StartPlaybackAction.java` | 27-34 | 构造缺省 target = `player`（只发触发者本人）；空 target 回落 `player` | 只读卡文案 |
| 同上 | 37-39 | `fromJson` 读取 `target`；脚本 JSON 路径不构造多目标动作 | 编辑器不暴露目标选择 |
| 同上 | 50-60 | 收件人分支：`all` 全体 / `all_except_trigger` 除触发者 / 缺省仅触发者 | 事实备注（编辑器不编辑） |

## 9. 文档与代码偏差表（以 Java 为准）

| # | 文档说法 | 代码事实 | 落地处理 | 代码出处 |
| --- | --- | --- | --- | --- |
| D1 | 11-03 §3：`on_enter` / `exit_buffer` 仅 location 区域触发器适用 | 边沿状态机对轮询类通用；校验器只硬拒 death 的 on_enter，以及 facing / all_of / any / death 的 exit_buffer；其余类型写了不报错但无空间外扩语义 | 目录 `timing` 按校验器显式拒绝列表置位；`exitBuffer` 仅 location 置真；其余不适用键进旧字段只读块 | `ScriptValidator.java` 2131-2150；`TriggerEngine.java` 310-347 |
| D2 | 11-04 字段表把 `entity_interact` / `block_interact` 的 `item` / `target_type` 列为可选字段 | `TriggerSchemas` 未登记这两个字段（schema 校验对未登记字段静默）；`EventFactMatch.matchesInteract` 实际承认 | 目录补登这两个字段，sourceRef 指向匹配层；schema 登记状态在字段描述注明 | `EventFactMatch.java` 94-105；`TriggerSchemas.java` 146-156 |
| D3 | 11-04：observation reach 缺省 4.5、负数报错 | 求值层缺省 4.5；schema 未校验负数 | 编辑器对负数 / 非数字报错；缺省 4.5 仅展示，不落盘 | `Evaluators.java` 253；`TriggerSchemas.java` 238 |
| D4 | 既有编辑器 `core/graph/requirements.ts` 把对象前置包成 `{type, data:{script}}` | Java 解析为扁平形态 `{type, script:"<id>"}`（data = 除 type 外全部键） | 纯函数层按 Java 扁平形态读写；不动既有 graph 层 | `ScriptParser.java` 1040-1045；`TriggerRequirement.java` 17-20 |
| D5 | 11-03 §3 sweep 列 location / structure / facing | 校验器可扫掠集合含 observation 共四类 | 目录 sweep 置真四类，以代码为准 | `ScriptValidator.java` 2281-2284 |
| D6 | 11-04：球形与方体共存 = OR | `location` 点判定为 OR（方体命中即真，再判球形，`Evaluators` 72-86）；场景快照 `matchesScene` 内球形 / 方体分支为 AND（`GeometryConditions` 81-91） | 区域编辑器文案按 OR；facts 注明快照分支的 AND 差异，不改动求值语义 | `Evaluators.java` 72-86；`GeometryConditions.java` 81-91 |
| D7 | 11-05 §2：三种内置前置都是"开始且结束任一退出原因" | 仅 `script_played` 是 started && finished；`script_started` 只看开始；`script_completed` 只看结束 | 目录三条分别标注语义，不以 played 覆盖另两条 | `BuiltinPrerequisites.java` 19-34；`FactQueries.java` 24-26 |
| D8 | 11-04：组合器子项可挂事件类条件 | Java 注册策略 all_of / any 为 POLLING；事件子条件必须 `continuity.window > 0` 才有窗口语义 | 目录 role=`mixed`；事件子条件无 window 报错 | `ImmersiveCinematics.java` 55-58；`Evaluators.java` 634 |
| D9 | 11-04：xp 等级与总经验至少一项 | schema 两个字段都非必填；求值层 214 行要求至少一项 | 校验层补"双空报错" | `Evaluators.java` 211-215 |
| D10 | 11-05 §4：内置前置数据用 `script` 字段 | Java `BuiltinPrerequisites.getScript` 读 `data.script`；对象形态下与 `type` 同级（扁平） | 目录 `scriptField: 'script'`；解析层同级读取 | `BuiltinPrerequisites.java` 37-40；`ScriptParser.java` 1040-1045 |
