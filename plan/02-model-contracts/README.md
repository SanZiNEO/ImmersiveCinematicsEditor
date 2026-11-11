# 02 模型与契约（Model Contracts）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（本页是实施指导；现有 WebUI 代码是旧模型基线，不是本轮成果）
> 合同归属：C02 标准脚本文档、C03 编辑器会话状态、C04 编辑命令与历史
> 依赖：01-baseline-schema（schema 快照与字段路由）
> 下游：05（时间轴工作区）、06（异步对象）、07（位置/路径/曲线）、11（规则/触发）、12（模板）
> 证据前缀：`J:` = `MOD:common/src/main/java/com/immersivecinematics/immersive_cinematics/`；`EDITOR:` = `E:/Documents/GitHub/ImmersiveCinematicsEditor/`（webui 分支）；`INGAME:` = 编辑器仓库 `1.20.1` 分支（只读，`git show 1.20.1:<path>`）

## 一、摘要

本轮把编辑器从"片段级平铺关键帧"换成**标准脚本文档**：与运行时 `objects` 同形的属性容器、脚本级 `clips[] / paths[] / rules[] / rule_bindings[]` 四类集合、稳定的片段身份与选择状态、可证明无损的加载/保存/推送流水线，以及只做结构检查、语义以服务端为准的校验桥。

本轮只做**文档层**。属性面板（06）、路径几何与数学模型（07）、时间轴交互（05）都建立在这里定义的模型、身份、命令与序列化契约上；本轮不实现它们的界面。

一句话验收：**同一个脚本文件，经过编辑器的 打开 → 编辑 → 保存 → 重载，除 `authoring` 与编辑器内部 id 外，JSON 语义逐字段不变，且能被 `ScriptParser` / `ScriptValidator` 接受。**

## 二、为什么做

### 2.1 现有前端与运行时已经对不上

| 事实 | 证据 |
|---|---|
| 前端写 `meta.version`（必填、且 `stripDefaults` 保护必填字段不删） | `EDITOR:src/types.ts — ScriptMeta（64–100，`version` 在 68）`；`EDITOR:src/schema.ts — stripDefaults（95–115，必填不删在 104）` |
| 运行时 meta 键白名单**没有** version，未知键直接抛错 | `J:script/schema/MetaSchemas.java — all（17–48）` 无 version；`J:script/ScriptParser.java — metaKeys（76–81）` 以 `SchemaRegistry.getMetaFields()` 为源；`parseMeta（193–195）` 调 `rejectUnknownFields` |
| 前端每次 commit 重算并写 `timeline.total_duration` | `EDITOR:src/store.ts — maintainInvariants（152–158，写 total_duration 在 157）`；`EDITOR:src/types.ts — Timeline（195–202，196）` |
| 运行时 timeline 只接受 tracks / loop_start / loop_end | `J:script/ScriptParser.java — timelineKeys（83–89）` |
| 前端校验强制 `meta.version===3` 与 `total_duration!==0` | `EDITOR:src/operations.ts — validateScript（639–697，645 与 650–651）` |
| 前端关键帧是整帧快照（`position`/`yaw`/`fov`… 同帧），运行时已改为每个叶子属性独立关键帧 | `EDITOR:src/types.ts — Keyframe（103–141）`、`Clip（144–183，`keyframes` 在 147）`；`J:script/object/SampledProperty.java（26–33 字段、42–111 构造校验）` |
| 前端从 `schema.tracks[type].keyframes` 取字段表；导出器只给 `playControl` 与 `objects` | `EDITOR:src/components/KeyframePanel.vue（16）`；`EDITOR:src/types.ts — TrackSchema（225–228）`；`J:script/schema/SchemaExporter.java — exportAll（43–56）` |
| 前端按轨道硬编码连续通道表（`continuousChannels`） | `EDITOR:src/operations.ts — continuousChannels（854–897）`，调用点 `bakeClipEasing（385–416，392）` |
| 片段级 `curve` / `keyframes` / `rules` 已被移除，出现即报错 | `J:script/object/ObjectParser.java — CLIP_KEYS（37–38）`、`ObjectValidator.java — CLIP_KEYS（37–38）`；`MOD:docs/SCRIPT_FORMAT.md — §7 已移除字段（734–755）` |
| 前端类型仍保留 `curve`、`follow`、`look_at_target`、`attenuation:'inverse'`、`layer_type:'pip'` | `EDITOR:src/types.ts（151、108–109、116、172、177）`；schema 实际值见 `J:script/schema/TrackSchemas.java（372–373 attenuation、443–444 layer_type）` |

结论：**当前前端保存出来的脚本会被 0.3.6 解析器拒绝**（`meta.version` 与 `timeline.total_duration` 都是未知键）。这不是"缺功能"，是模型不对。

### 2.2 目标

1. 文档 = 运行时 JSON 的形状；编辑器不发明第二套中间表示，也不做"旧模型 ↔ 新模型"双向适配层。
2. 身份稳定：片段用 `id`（没有则用编辑器派生的稳定键，不写盘），选择用 `clipKey + objectPath`，不用数组下标。
3. 序列化无损：未编辑的字段逐字节语义不变；不写运行时没有的键；不静默删除作者写出的值（含等于默认值的值、空 `keyframes`、`null`）。
4. 命令原子化：一个用户动作 = 一个 `commit`，失败全回滚；撤销栈存快照。
5. 校验分层：本地只做**结构**检查（路径存在、时间递增、形态合法、端点相邻）；语义以 `script.validate` 为权威，错误按 `clipKey + objectPath + keyframeIndex` 定位。
6. 先完成WebUI，13人工打磨验收后14再迁移AUI；共享字段/命令/生成语义与人工场景，源码复用方式按实际宿主确认，不预设跨语言或建设两套测试执行器。

### 2.3 非目标

- 不做旧格式兼容层（不双 parser、不留 `version`/`total_duration`/`keyframes` 别名）。
- 不在本轮实现属性面板、时间轴、路径几何、曲线预览（分别归 06/05/07）。
- 不改主模组任何 Java 代码；本轮只定义编辑器侧合同与提案。
- 不把"已有运行时类"当成"编辑器已实现"：本轮所有编辑器类均为**提案**。

## 三、方案

### 3.1 文档形态

```text
ScriptDoc
  meta: DocMeta                       // 键集 = MetaSchemas.all() + triggers + trigger_poll_interval
  timeline: DocTimeline
    tracks: DocTrack[]                // { type, clips: DocClip[] }（+ 编辑器视图状态，不写盘）
  clips?: DocClip[]                   // 脚本级独立片段（无 start_time，有 track）
  paths?: PathEntryDoc[]
  rules?: RuleDefinitionDoc[]
  rule_bindings?: RuleBindingDoc[]
  authoring?: DocAuthoring             // 仅内存：编辑器元数据（不写盘）
```

```text
DocClip
  id?: string                         // 运行时字段；被引用时必填
  start_time?: number                 // 内联片段必填；独立片段禁止
  duration: number                    // 正数=有限，负数=无限单次
  loop?: boolean  loop_count?: number  loop_mode?: 'repeat'|'pingpong'
  objects: Record<ObjectPath, AnimObject>
  exit?: ExitPolicyDoc
  track?: string                      // 仅独立片段；解析前摘掉（J:ScriptParser.parseStandaloneClips 444–503）
  authoring?: ClipAuthoring
```

```text
AnimObject
  value?: JsonValue                   // 可缺省
  keyframes?: ObjectKeyframe[]        // 可缺省；ANIMATED 允许空数组（见冲突 C-02-02）
  authoring?: ObjectAuthoring         // 仅内存：easing、展开状态、合成标记
ObjectKeyframe = { time: number; value: JsonValue }   // 与 J:script/object/ObjectKeyframe.java（12）同形
```

**关键约束**（全部来自运行时，不是编辑器偏好）：

| 约束 | 运行时来源 |
|---|---|
| 路径段 `[a-z][a-z0-9_]*`，`.` 分隔，无数组下标 | `J:script/object/PropertyPath.java — isSegment（86–101）` |
| 路径必须是该轨道 `SchemaRegistry.getObject(type, path)` 已登记项 | `J:script/object/ObjectParser.java — parse（51–81，未知路径 75–77）` |
| 属性对象只允许 `value` / `keyframes` 两个成员 | `ObjectParser.parseProperty（93–110）` |
| `mode=value` 不允许 keyframes；`mode=event` 必须有 keyframes；`mode=animated` 必须有非 none 的 interp | `J:script/object/SampledProperty.java（60–96）` |
| 同一对象 keyframes 时间严格递增，`time >= 0`，有限 | `ObjectParser.parseKeyframes（135–172）`、`SampledProperty（97–110）` |
| 不同对象同一时间合法 | `MOD:plans/0.3.6/I-script-core/object-model.md §3.4/§3.5`；实现上无跨对象约束 |
| 超界关键帧保留、忽略，不报错 | `SampledProperty.compile（153–213，范围过滤 154–162）` |
| 值按类型严格转换，不做字符串数字、不做模糊枚举、拒绝非有限 | `J:script/object/ObjectCodec.java — fromJson（43–58）` |
| 片段级键白名单 8 项 | `ObjectParser.CLIP_KEYS（37–38）` |

### 3.2 序列化与"无损"的定义

无损 = 对任意输入 JSON `R`，`serialize(load(R))` 与 `R` 在下列意义下相等：

1. **保留**：所有运行时字段（含等于 schema 默认值的显式值）、空 `keyframes: []`、`null`（`nullable_float`）、STRUCT 嵌套对象原样（曲线、`modifier`、`transition_params`、`motion_*`、`gradient`、`data`）、`event` / `mod_event` 记录对象原样、四类脚本级集合的数组顺序与 `id`。
2. **允许差异**：对象成员顺序、数字表示（`1` 与 `1.0`、`1e0`）、空白。
3. **必须剥离**：`authoring`、编辑器内部 `clipKey`、UI 视图状态（轨道可见/锁定/静音、缩放、折叠、图坐标、marker 显示）。

明确**不做**的事：

- 不剥离"等于默认值"的对象值。理由：`SampledClip.present(slot)`（`J:script/object/SampledClip.java — present（94–96）`）与 `ClipValueView.declared`（`J:script/object/ClipValueView.java — declared（34–36）`）把"声明了"与"没声明"区分开，`yaw_lock` / `pitch_lock` 的 `null`（不锁）与数值（锁）就是语义差异（`ObjectCameraEvaluator.nullable（604–607）`）。整体剥离会把"作者显式写出的 0"与"未写"混为一谈，并让 STRUCT 值承担无法证明的等价性。
- 不重算 `total_duration`，不写 `version`。
- 不写编辑器派生的 `clipKey`。`clipKey` 只在内存里，重开文档时重新派生。

### 3.3 身份与选择

| 概念 | 规则 | 依据 |
|---|---|---|
| 片段运行时身份 | `clip.id`（`^[A-Za-z0-9_]{1,64}$`，脚本内唯一） | `J:script/identity/ClipIdentity`（`ScriptParser.parseClipId 420–442` 调 `ClipIdentity.isValid`）；`ScriptValidator.checkClipIdentities（321–373）` 查重复 |
| 编辑器片段键 | 装载/新增时分配会话唯一clipKey，历史保留；与id/下标/时间分离 | 02-SelectionIdentity；不写脚本，匿名片段也稳定 |
| 选择 | `{ clipKey, objectPath?, keyframeTime?, pathId?, ruleId?, bindingId? }` | 本文件提案；替代 `EDITOR:src/types.ts — Selection（270–274，track/clip/keyframe 下标）` |
| 关键帧身份 | `(clipKey, objectPath, time)`；时间唯一且严格递增 | `SampledProperty（97–110）` |

time仅是单属性内精确定位；移动节点时命令返回old→new映射，删除清空而非选最近。稳定片段身份与选择事务归02，05/06不得另造选区或数组下标回退。

UI消费按[C17工作区](../shared/effect-controls-workspace.md)：共享clipKey决定整个片段效果控件上下文，objectPath/keyframeTime只是当前目标，不限制同屏其他已展开属性。05主轴只有片段选择/编排，06持有独立局部viewport和节点交互；快捷属性与效果控件共用同一Selection/命令，不保留旧rightTab/leftTab或第二套选择。

### 3.4 命令与历史

```text
DocCommand = { kind, payload, apply(doc): void }     // 提案
commit(cmd): ① 深拷贝当前 doc → ② apply → ③ 结构不变量 → ④ 入撤销栈 → ⑤ 标记 dirty → ⑥ 调度预览推送
```

- 撤销栈存**完整文档快照**（沿用 `EDITOR:src/store.ts — pushUndo（106–112）` 的做法），上限 200；不做增量补丁（对象数量级下快照足够，增量补丁会把"部分失败"变成不可回滚）。
- 一个用户动作只产生一个快照；批量操作（多选移动）要么全成功要么全不应用。
- `commit` 不再调用 `maintainInvariants` 里的 `total_duration` 重算（`EDITOR:src/store.ts（152–158）`）；改为 `enforceStructure`：clip 排序 + 转场对齐 + 引用完整性检查。

### 3.5 校验分层

| 层 | 做什么 | 不做什么 |
|---|---|---|
| 本地结构检查（同步） | 路径存在、成员白名单、形态（value/event/animated）、时间递增且 ≥0、端点相邻、`requires` 是否满足（只告警）、`position_mode/space/origin` 组合、切换点三轴关键帧对齐 | 不判语义是否"正确"、不判选择器能否解析、不判世界状态 |
| 服务端 `script.validate`（异步） | 权威 issue 列表（`J:webui/WebEditorApi.handleScriptValidate（152–166）` → `ScriptValidator.validate`） | — |
| 解析 | 只有服务端 `ScriptParser` 能判"能不能播" | 编辑器不实现 parser |

本地检查的规则**必须**直接引用运行时同一常量/顺序，不复制数值：例如 `SPACE_SWITCH_FIELDS`（`J:script/object/ObjectValidator.java（41–43）`）、`BASE_SWITCH_FIELDS（46–48）`、`PathCollectionParser.TIME_EPSILON（54）`、`ID_PATTERN（48）`。

## 四、技术细节

### 4.1 本轮文件与职责

| 文件 | 职责 | 合同 |
|---|---|---|
| [02-ScriptDocument.md](02-ScriptDocument.md) | `ScriptDoc` / `DocTimeline` / `DocTrack` / `DocClip` 顶层形态与不变量 | C02 |
| [02-AnimObject.md](02-AnimObject.md) | `AnimObject` / `ObjectKeyframe` / 三种形态 / 值编解码镜像 | C02 |
| [02-PropertyPathRegistry.md](02-PropertyPathRegistry.md) | 属性路径表、`section`/`group`/`requires`/`appliesTo` 索引、轨道类型注册 | C01/C02 |
| [02-SchemaSnapshot.md](02-SchemaSnapshot.md) | `schema.get` 快照的消费契约、版本与漂移检查 | C01 |
| [02-EditorStore.md](02-EditorStore.md) | `EditorStore`：文档、脏标记、命令、撤销、派生视图 | C03/C04 |
| [02-SelectionIdentity.md](02-SelectionIdentity.md) | 片段身份、`clipKey` 派生、选择与重映射 | C03/C04 |
| [02-SerializationLossless.md](02-SerializationLossless.md) | 无损写出/编辑器元数据分离与人工保存重载检查 | C02 |
| [02-ValidationBridge.md](02-ValidationBridge.md) | 本地结构检查 + 服务端校验桥、错误定位 | C02/C04 |
| [02-DocumentIO.md](02-DocumentIO.md) | 打开/新建/保存/推送流水线，失败与并发 | C02/C04 |
| [02-LegacyConsumerCutover.md](02-LegacyConsumerCutover.md) | 旧前端调用方干净切换与废弃字段/路径删除；不增加旧脚本转换器 | C01/C02/C04 |

### 4.2 运行时类 → 归属映射（本轮视角）

| 运行时类（`J:`） | 编辑器归属 | 说明 |
|---|---|---|
| `script/object/ObjectParser` | **只读语义镜像** | 编辑器不得调用 Java；本地结构检查按它的判定顺序实现（02-ValidationBridge） |
| `script/object/ObjectValidator` | **只读语义镜像** | 本地检查的规则来源；语义权威仍在服务端 |
| `script/object/SampledProperty` / `ObjectKeyframe` | 02-AnimObject 的镜像模型 | 形态校验、时间递增、范围过滤 |
| `script/object/PropertyPath` | 02-PropertyPathRegistry | 路径语法与合法性 |
| `script/object/ObjectCodec` | 02-AnimObject 的值类型表 | 值形态（float/int/bool/string/enum/ref/nullable/struct/event_record） |
| `script/object/ObjectSlotLayout` / `ClipSampler` / `SampledClip` / `ClipRuntimeCache` / `ClipValueView` | **引擎内部，只依赖不重写** | 运行时槽位与采样；编辑器不复刻 |
| `script/schema/SchemaRegistry` / `TrackSchemas` / `MetaSchemas` / `TrackTypeSchema` | 02-SchemaSnapshot 的数据源（经 `schema.get`） | 不硬编码字段表 |
| `script/schema/SchemaExporter` | 02-SchemaSnapshot 的协议出口 | 只消费导出 JSON |
| `script/schema/ObjectSchemaValidator` | **引擎内部** | 校验第三方 schema 声明；编辑器只消费结果 |
| `script/path/*` | 07（路径集合编辑）与 02（顶层 `paths[]` 容器） | 本轮只定义容器与身份；几何归 07 |
| `script/identity/*` | 02-SelectionIdentity 的身份规则来源 | 只读 |
| `webui/WebEditorApi` / `ScriptFileService` | 02-DocumentIO 的协议对端 | 只读 |
| `script/Clip` / `Timeline` / `CinematicScript` | **引擎内部** | 编辑器文档是 JSON，不是 Java 对象 |

### 4.3 两分支承载

| 载体 | 本轮承载 | 现状证据 |
|---|---|---|
| WebUI（`EDITOR:` webui 分支） | 主实现：`src/model/`（提案）+ 改造 `store.ts`/`types.ts`/`schema.ts`/`operations.ts` | 现有 `src/types.ts`（284 行）、`src/store.ts`（1015 行）、`src/schema.ts`（184 行）、`src/operations.ts`（954 行） |
| 未来游戏内Forge+AUI | 14后置迁移同一标准模型/人工行为场景；当前只有骨架，不阻塞WebUI | INGAME:Constants/EditorCommon/Services/IPlatformHelper/Forge EditorMod |

共享主体是本目录字段/操作合同、标准JSON中间模型和同一组行为向量；UI或核心源码能否直接复用由03/14实际宿主能力验证，本轮不等待14，不预先断言跨语言复用成立或不成立，也不在两端维护独立脚本语义。WebUI完整对接Forge/Fabric主模组；游戏内先闭环Forge，只有游戏内Fabric+AUI适配暂缓，见shared/host-scope.md。

### 4.4 轮次出口

本轮完成必须同时满足：

1. 十个任务文件全部落地（代码实现由实施者完成；本计划只给到任务级步骤）。
2. `EDITOR:src/types.ts` 不再出现 `version`、`total_duration`、片段级 `keyframes`、`curve`、`follow*`、`look_at_target`、`attenuation:'inverse'`、`layer_type:'pip'`。
3. `EDITOR:src/store.ts` 的 `maintainInvariants` 不再写 `total_duration`。
4. 打开一个含 8 个对象、含 `paths[]`/`rules[]`/`rule_bindings[]`/独立 `clips[]` 的真实脚本，保存后逐字段对比通过（02-SerializationLossless 的向量集）。
5. `script.validate` 对该脚本返回 `ok: true`，且编辑器本地结构检查为空。
6. Forge 1.20.1 客户端能加载保存后的脚本并播放（WebUI→Forge 真游戏冒烟，本轮要求；步骤见各任务文件）。

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 保留旧平铺模型，保存时转换 | 前端继续用整帧 `keyframes`，落盘时拆成 `objects` | 每次保存都要做一次不可逆投影；异步编辑无法表达（同一帧被所有属性共享）；加载再反向合成会丢稀疏性 | 直接把文档模型换成 `objects` |
| 维护双向兼容层 | 同时认keyframes与objects、同时认version与无版本 | 两套语义、两套校验和UI长期并存 | 干净切换全部调用方（02-LegacyConsumerCutover），旧格式明确拒绝 |
| 剥离所有等于默认值的字段 | 保存时按 schema 默认值删除 | `present`/`declared` 语义被破坏；`null`（不锁）与数值不可区分；STRUCT 等价性不可证 | 只剥离 `authoring` 与内部 id |
| 用数组下标做选择身份 | `{track, clip, keyframe}` 下标 | 插入/删除/重排后选择漂移；路径端点绑定会静默指错 | `clipKey + objectPath + time` |
| 增量补丁式撤销 | 记录 diff | 部分失败不可回滚；跨属性批量操作难保证原子 | 快照式撤销 |
| 编辑器本地完整校验 | 再实现一套 parser/validator | 双口径；与运行时语义漂移；`validator` 的 warning/error 分级会分叉 | 本地只做结构检查 |
| 两端独立演进语义 | 各自维护字段/默认/命令 | 漂移导致产物不一致 | 共享合同和人工场景，先WebUI完成再迁移 |

**本方案的缺点**：

- 快照式撤销在 160+ 对象的大片段上内存开销高（每个快照一份完整 JSON）；需要限制历史条数并提示。
- 不剥离默认值会让保存出的脚本比"精简版"大；这是用体积换可证明无损。
- 未来AUI迁移需人工逐模块对照已打磨WebUI行为，不为此维护自动向量或两套测试执行器。
- 本地结构检查必须逐条对齐运行时顺序，运行时改字段就要同步改编辑器；这是无法避免的耦合，靠 02-SchemaSnapshot 的漂移检查兜底。

## 六、实现结果

状态：未实现。

| 设计目标 | 当前实现 | 说明 |
|---|---|---|
| 文档 = 运行时 JSON 形状 | 前端仍是平铺 `Keyframe` + `Clip.keyframes`（`EDITOR:src/types.ts 103–183`） | 需按 02-ScriptDocument / 02-AnimObject 重写 |
| 不写 `meta.version` / `total_duration` | 前端两者都写（`types.ts 68`、`store.ts 157`、`operations.ts 645/650`） | 产物当前会被 `ScriptParser.parseMeta` 拒绝 |
| 消费 `schema.get` 的 `playControl`/`objects` | 前端读 `clips`/`keyframes`（`types.ts 225–228`、`KeyframePanel.vue 16`） | 字段名与结构都不同 |
| 属性独立关键帧 | 无（整帧容器） | 06 轮实现界面，02 只定义模型 |
| 选择用稳定身份 | `Selection{track,clip,keyframe}` 下标（`types.ts 270–274`） | 需替换 |
| 无损序列化 | `stripScriptDefaults` 只处理 `clip.keyframes`（`schema.ts 118–142`），对 `objects` 无效 | 需按 02-SerializationLossless 重写 |
| 校验分层 | 本地 `validateScript` 复刻了部分语义并含过期规则（`operations.ts 639–697`） | 需降级为结构检查 |
| 双载体 | 游戏内分支只有骨架（`INGAME:` 32 文件，无编辑器 UI） | Forge 闭环属 14 轮，本轮只冻结契约与向量 |
