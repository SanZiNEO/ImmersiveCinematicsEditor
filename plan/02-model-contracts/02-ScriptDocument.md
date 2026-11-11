# 02-ScriptDocument：脚本文档顶层模型

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计；现有 WebUI 无此类）
> 合同：C02 标准脚本文档
> 依赖：01（schema 快照）、02-SchemaSnapshot（字段表）
> 下游：02-AnimObject、02-EditorStore、02-SelectionIdentity、05、06、07、11
> 证据前缀见 [README](README.md) 开头

## 一、摘要

定义编辑器的根文档 `ScriptDoc`：`meta`、`timeline.tracks[].clips[]`、四类脚本级集合（`clips[]`、`paths[]`、`rules[]`、`rule_bindings[]`）、以及只在内存存在的 `authoring`。

本文件只管**顶层结构**：有哪些键、哪些必填、哪些互斥、集合顺序如何保持、未知键如何处理。属性容器归 [02-AnimObject.md](02-AnimObject.md)，身份归 [02-SelectionIdentity.md](02-SelectionIdentity.md)，序列化归 [02-SerializationLossless.md](02-SerializationLossless.md)。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 前端 `ScriptDoc` 只有 `meta` + `timeline`，没有四类集合 | `EDITOR:src/types.ts — ScriptDoc（205–209）` |
| 前端 `Timeline` 含 `total_duration`、`markers`、`loop_start`、`loop_end` | `EDITOR:src/types.ts — Timeline（195–202）` |
| 运行时 timeline 只接受 `tracks` / `loop_start` / `loop_end` | `J:script/ScriptParser.java — timelineKeys（83–89）` |
| 运行时顶层**不校验未知键**（没有根白名单），`paths`/`rules`/`rule_bindings`/`clips` 各自解析 | `ScriptParser.parseInternal（131–168）`：只按需读 `meta`/`timeline`/`clips`/`rules`/`rule_bindings`/`paths` |
| 独立片段必须没有 `start_time`、必须有 `track`、`objects` 非空 | `ScriptParser.parseStandaloneClips（444–503）` |
| 内联片段必须有 `start_time`，`duration != 0` | `ScriptParser.parseObjectClip（345–419，duration 检查 359–362）` |
| 片段级键白名单 8 项 | `ObjectParser.CLIP_KEYS（37–38）`、`ObjectValidator.CLIP_KEYS（37–38）` |

结论：前端缺四类集合，且 `timeline` 多了一个运行时会拒绝的键。编辑器必须按运行时形状建模，并保留顶层"未知键透传"的能力（运行时忽略，编辑器不该擅自删除用户数据）。

### 2.2 目标

1. 顶层键集与运行时一致；`markers` 从脚本移到编辑器状态。
2. 四类集合与 `timeline` 并列；集合内条目顺序 = 数组顺序，不排序、不分组。
3. 内联片段与独立片段的差异只体现在 `start_time` / `track` 的有无，两者共用同一 `DocClip`。
4. 未知顶层键：保留原文、给出警告，不删除（运行时忽略，删除会破坏作者可能的外部工具数据）。
5. `timeline.total_duration` 永不写入；有限末端按需派生（见 §3.4）。

### 2.3 非目标

- 不定义属性容器内部（02-AnimObject）。
- 不定义路径条目/规则/绑定的字段语义（07 / 11）；本文件只定义它们的**位置与顺序**。
- 不定义 `exit` 的语义（归 11 / 12）；本文件只保证它是 `DocClip` 的可选子对象并原样透传。

## 三、方案

### 3.1 类与字段（全部为提案）

```ts
// EDITOR:src/model/ScriptDoc.ts（提案）
export interface ScriptDoc {
  meta: DocMeta
  timeline: DocTimeline
  clips?: DocClip[]              // 脚本级独立片段
  paths?: PathEntryDoc[]
  rules?: RuleDefinitionDoc[]
  rule_bindings?: RuleBindingDoc[]
  /** 顶层未识别键原样保留（运行时忽略；不删除、不解释） */
  readonly unknown?: Record<string, unknown>
  /** 仅内存，不序列化 */
  authoring?: DocAuthoring
}

export interface DocTimeline {
  tracks: DocTrack[]
  loop_start?: number            // parser 接受（J:ScriptParser.timelineKeys 83–89）
  loop_end?: number
}

export interface DocTrack {
  type: string                   // TrackTypeId.id；大小写敏感，内置 id 见 J:spi/TrackTypeId（19–37）
  clips: DocClip[]
}

export interface DocClip {
  id?: string
  start_time?: number            // 内联必填 / 独立禁止
  duration: number
  loop?: boolean
  loop_count?: number
  loop_mode?: 'repeat' | 'pingpong'
  objects: Record<string, AnimObject>
  exit?: ExitPolicyDoc
  track?: string                 // 仅独立片段；写盘必须存在（解析器据此选 schema，随后从副本移除，见 444–503）
  authoring?: ClipAuthoring
}

export interface DocAuthoring {
  clipKeys: Record<string, string>   // 运行时 id → 编辑器 clipKey（可选缓存，不写盘）
  view: DocViewState                  // 缩放/折叠/轨道可见性（不写盘）
  dirtyPaths?: string[]               // 诊断用
}

export interface DocViewState {
  pxPerSecond: number
  trackView: Record<string, { visible: boolean; locked: boolean; muted: boolean }>
  collapsedSections: string[]
  markers: number[]                   // 从 timeline.markers 迁入（运行时无此字段）
}
```

字段约束（逐条对应运行时）：

| 字段 | 约束 | 依据 |
|---|---|---|
| `meta` | 键集 = `MetaSchemas.all()` + `triggers` + `trigger_poll_interval` | `J:script/schema/MetaSchemas.java（17–48）`；`ScriptParser.metaKeys（76–81）` |
| `meta.id` | `^[a-zA-Z0-9_]{1,32}$`，必填 | `ScriptParser.parseMeta（198–205）` |
| `meta.name` | 必填，≤50 字符 | 同上（206–208） |
| `meta.author` | 必填字符串（schema 标 optional 但 parser 要求） | `parseMeta（198–200）`；冲突裁决见共享 `baseline-and-evidence.md` |
| `timeline.tracks` | 数组；每项 `{type, clips}` | `ScriptParser.parseTrack（325–343）` |
| `tracks[].type` | 内置 7 个 id 或第三方 `modid:xxx`；大小写敏感，仅内置做一次大写回退 | `J:spi/TrackTypeId（19–37）`、`parseTrackType（1089–1098）` |
| `clip.start_time` | 内联必填有限数字；独立片段出现即报错 | `parseObjectClip（355–362）`、`parseStandaloneClips（465–470）` |
| `clip.duration` | `!= 0`；正数有限、负数无限 | `parseObjectClip（359–362）`、`Clip.isInfinite（J:script/Clip.java 103）` |
| `clip.loop_count` | `-1` 或正整数；`0` 告警后按 1 | `ScriptParser.requireLoopCount（582–594）` |
| `clip.loop_mode` | `repeat` / `pingpong` | `parseObjectClip（389–404）` |
| `clip.objects` | 必须是非空对象（独立片段）；内联片段由 `ObjectParser.parse` 要求存在 | `parseStandaloneClips（490–500）`；`ObjectParser.parse（60–66）` |
| `clip.id` | 可缺省；存在则匹配 `ClipIdentity.PATTERN` 且脚本内唯一 | `parseClipId（420–442）`；`ScriptValidator.checkClipIdentities（321–373）` |
| `clip.track` | **仅独立片段**：写盘必须存在（解析器据此决定 schema），解析时从副本移除；内联片段出现 `track` 会被 `CLIP_KEYS` 拒绝 | `parseStandaloneClips（490–501）`；`ObjectParser.CLIP_KEYS（37–38）` |
| `paths[]` | 数组；条目 `{id, clip, from, to, axes?, geometry, timing?}` | `J:script/path/PathCollectionParser.parseEntry（114–189）` |
| `rules[]` / `rule_bindings[]` | 数组；由 `RuleCollectionParser` 解析 | `ScriptParser.parseInternal（149–153）` |
| `timeline.markers` | **不存在**；运行时 timeline 键白名单无此项 | `timelineKeys（83–89）` |

### 3.2 集合的承载与顺序

- 四类集合与 `timeline` **并列**，不放进 `timeline`，也不放进 `clip`。运行时就是从根对象读的（`ScriptParser.parseInternal 149–158`）。
- 数组顺序 = 作者顺序 = 序列化顺序。不按 id 排序、不按片段分组。
- 集合条目在文档模型里是**独立对象**，有各自的编辑器 `docKey`（`path:<id>` / `rule:<id>` / `binding:<id>` / `clip:<id>`），与 `objects` 的键空间分开。这一点直接对应运行时：`paths[]` 的条目不进 `objects`（`PathCollectionParser.parseEntry 135–138` 只要求目标片段有 `objects`）。

### 3.3 内联 vs 独立片段

| 维度 | 内联片段 | 独立片段 |
|---|---|---|
| 位置 | `timeline.tracks[].clips[]` | 顶层 `clips[]` |
| `start_time` | 必填（默认放置锚点） | 禁止 |
| `track` | 禁止（写了会被 `CLIP_KEYS` 拒绝） | **必填且写盘**（解析器用它选 schema，随后从副本移除） |
| 身份 | `id` 可选 | `id` 可选，但被 `goto`/规则/路径引用时必须存在 |
| 编辑器承载 | 时间轴行（05） | 片段库面板（05/12） |

两者共用 `DocClip` 与同一套 `objects` 校验（`ObjectParser` 对两者调用同一 `parseProperty`）。

### 3.4 有限末端：派生而非字段

- 文档不存总时长。
- 派生规则（仅用于时间轴标尺/缩放提示）：所有**有限**片段窗口的并集上界；存在无限片段（`duration < 0`，`Clip.isInfinite`）时，标记"无有限自然末端"，显示范围另给（由 05 定义）。
- 禁止：把 `Infinity`、`null`、`Number.MAX_SAFE_INTEGER` 写成 `duration` 或任何"总时长"字段。运行时以 `duration < 0` 表示无限（`Clip.isInfinite 103`），不是 `Infinity`（`ObjectCodec.readFiniteFloat` 拒绝非有限数）。

### 3.5 未知键策略

| 位置 | 策略 | 理由 |
|---|---|---|
| 根对象 | 保留 + 警告 | 运行时无根白名单，脚本仍可播；删除会毁掉外部工具数据 |
| `meta` | **拒绝**（必须修） | `parseMeta` 调 `rejectUnknownFields`，未知键直接抛错 |
| `timeline` | **拒绝** | `parseTimeline` 同口径 |
| `clip` | **拒绝** | `ObjectParser.CLIP_KEYS` / `ObjectValidator.CLIP_KEYS` |
| `objects.<path>` | **拒绝** | `parseProperty` 只允许 `value`/`keyframes` |
| `objects.<path>.keyframes[i]` | **拒绝** | `parseKeyframes` 只允许 `time`/`value` |
| `paths[i]` | **拒绝** | `PathCollectionParser.ENTRY_KEYS（58–59）` |
| `rules[i]` / `rule_bindings[i]` | **拒绝** | `RuleCollectionParser` 白名单（归 11 轮核对） |

## 四、技术细节

### 4.1 输入输出

| 操作 | 输入 | 输出 | 失败 |
|---|---|---|---|
| `parseDoc(raw: unknown): ScriptDoc` | `script.load` 返回的 `doc` 原样 JSON | 文档 + 未知顶层键 | 根不是对象 / `meta`/`timeline` 缺失 → 抛 `DocShapeError`（带 JSON 路径） |
| `serializeDoc(doc): unknown` | 文档 | 可直接 `script.save` 的 JSON | 内部不变量不成立 → 抛 `DocInvariantError`（保存前拦截） |
| `validateDocShape(doc): Issue[]` | 文档 | 结构 issue（不阻断保存，只显示） | — |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/ScriptDoc.ts`（提案）：上表接口 + `parseDoc` / `serializeDoc` 骨架。
2. 新建 `EDITOR:src/model/unknownKeys.ts`（提案）：按位置分类的未知键收集器（根保留、其余报错）。
3. 改 `EDITOR:src/types.ts`：`ScriptDoc`/`Timeline`/`Clip` 换成从 `model/ScriptDoc.ts` 再导出；删除 `Timeline.total_duration`、`Clip.keyframes`、`Clip.curve`、`Clip.orient`、`Clip.yaw_offset`、`Clip.pitch_offset`（这些已进 `objects`，见 `MOD:docs/SCRIPT_FORMAT.md §7`）。
4. 改 `EDITOR:src/store.ts — maintainInvariants（152–158）`：删除 `state.doc.timeline.total_duration = ops.recalcDuration(tracks)`；保留 `sortTrackClips` 与 `applyTransitionAlignment`，并把它们归入 `enforceStructure`。
5. 改 `EDITOR:src/operations.ts — validateScript（639–697）`：删除 `meta.version` 与 `total_duration` 两条；改为调用 02-ValidationBridge 的 `validateStructure`。
6. 改 `EDITOR:src/operations.ts — recalcDuration（610–620）`：改名 `deriveFiniteEnd`，返回 `number | null`（`null` = 无有限自然末端），不再写回文档。
7. 改 `EDITOR:src/demo.ts`：离线示例文档改成 `objects` 形状；补 `paths[]` / `rules[]` / `rule_bindings[]` 各一条最小样例。
8. 改 `EDITOR:src/components/*`：凡读 `clip.keyframes` 的组件先编译期失败，逐个改到 06 的接口（本轮只保证不写错盘；界面在 06 落地）。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. 在 `INGAME:common/src/main/java/com/immersivecinematics/editor/model/`（提案）新增 `ScriptDoc`、`DocTimeline`、`DocTrack`、`DocClip`（Java record + `JsonObject` 互转）。
2. 在 `INGAME:common/src/main/java/com/immersivecinematics/editor/model/DocCodec.java`（提案）实现与 WebUI 同名的 `parseDoc` / `serializeDoc`。
3. 复用主模组 `ScriptParser` 做**真值比对**：解析失败信息用于本地 issue，不复制其判定逻辑（编辑器只做结构检查，见 02-ValidationBridge）。
4. Forge 入口：`INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java` 注册命令（提案，具体命令名归 14 轮），调 `EditorCommon.init()` 之后初始化文档服务。

### 4.4 禁止修改

- 不改主模组任何 Java 文件（含 `ScriptParser`、`ScriptValidator`、`SchemaExporter`）。
- 不给 `timeline` 加 `markers`/`total_duration`/`duration` 等运行时没有的键。
- 不把 `paths`/`rules`/`rule_bindings` 塞进 `timeline` 或 `clip`。
- 不在 `DocClip` 上保留 `keyframes`/`curve`/`orient`/`yaw_offset`/`pitch_offset` 字段（即使暂时不用）。
- 不排序四类集合。

## 五、正反例验收

### 5.1 异步关键帧（属性独立）

**正例**：同一 CAMERA 片段，`position.x` 有 `{0, 3}` 两帧，`yaw` 有 `{1, 2}` 两帧，`fov` 只有 `value`。

- 期望：文档里有 3 个 `AnimObject`；`position.x` 2 帧、`yaw` 2 帧、`fov` 0 帧。
- 期望：`serializeDoc` 输出中三个对象的键顺序 = schema 声明顺序（`position.x` 在 `yaw` 前、`yaw` 在 `fov` 前，见 `J:script/schema/TrackSchemas.java — cameraObjects（109–347）` 的插入顺序）。
- 期望：`validateStructure` 无 issue。

**反例 1**：把 `yaw` 的两帧"对齐"到 `position.x` 的时间点，补出 `{0,1,2,3}` 四帧。

- 期望：编辑器**拒绝**这种操作（不得自动补帧）；若作者手动补，必须是他自己的命令，且撤销可回退。
- 判定：`serializeDoc` 输出里 `yaw` 仍是 2 帧 → 说明没有隐式补齐。

**反例 2**：在 `clip` 上写 `"keyframes": [...]`。

- 期望：`validateStructure` 报 `未知键 keyframes`；`parseDoc` 保留原文但在打开时立刻显示阻断性错误（因为 `ObjectParser.CLIP_KEYS` 会抛）。
- 判定：不静默丢弃、不迁移成 `objects`。

**反例 3**：写 `"timeline": {"total_duration": 12, "tracks": [...]}`。

- 期望：`validateStructure` 报 `timeline.total_duration` 为未知键；`serializeDoc` 不得生成它。
- 判定：`ScriptParser.parseTimeline`（`301–324`，键白名单来自 `timelineKeys 83–89`）会拒绝。

### 5.2 内联 / 独立片段

**正例**：`timeline.tracks[0].clips[0]` 有 `start_time:0, duration:5`；顶层 `clips[0]` 有 `id:"branch_a", track:"CAMERA", duration:2, objects:{...}`，无 `start_time`。

- 期望：`serializeDoc` 输出中独立片段**带** `track:"CAMERA"`、**不带** `start_time`。
- 期望：内联片段**不带** `track`。

**反例**：独立片段写了 `start_time: 0`。

- 期望：`validateStructure` 报错（`parseStandaloneClips 465–470` 会抛 `独立片段不能有 start_time`）；编辑器不允许该输入。

### 5.3 未知顶层键

**正例**：根对象多一个 `"x_custom": {"a":1}`。

- 期望：打开不报错、编辑不丢、保存后仍在（`unknown` 桶原样写回），并给一条警告"运行时忽略该键"。

**反例**：`meta` 里多一个 `"version": 3`。

- 期望：打开即报阻断错误（parseMeta（193–211）拒绝未知meta键），保留原文件；不在编辑器增加自动升级或静默删键。旧前端代码切换见02-LegacyConsumerCutover。

## 六、真实冒烟（真游戏校验）

前置：Forge 1.20.1 客户端 + 主模组 0.3.6；`immersive_cinematics/scripts/` 下有一个按本文件形状手写的脚本 `doc_smoke.json`（含 1 条内联 CAMERA 片段、1 条独立片段、1 条 `paths[]`、1 条 `rules[]` + 1 条 `rule_bindings[]`）。

1. 启动客户端，F9 打开预览屏，编辑器连接 `ws://127.0.0.1:8765/ws`。
2. `script.load` 打开 `doc_smoke.json`；确认无阻断错误。
3. 在编辑器改 `meta.name`，`commit` 一次，`script.save`。
4. 关闭再打开同一脚本（`script.load`），逐字段比对第 3 步的保存内容与重载内容（用编辑器的"导出当前文档 JSON"与文件内容对比）。
5. `script.validate` 返回 `ok: true`。
6. `editor.pushScript` 后在游戏里播放，确认画面出现且无解析错误日志。

通过判定：

- 日志中无 `ScriptParseException` / `未知` / `不允许` 字样；
- 第 4 步比对差异只在允许集合（对象成员顺序、数字表示）；
- 游戏内播放可见画面（不是黑屏、不是"脚本不可用"）。

未通过时的最小定位：把 `script.validate` 的 issues 原文贴进验收记录，不手写"应该没问题"。

## 七、完成定义

1. `EDITOR:src/model/ScriptDoc.ts` 存在，导出 `ScriptDoc`/`DocTimeline`/`DocTrack`/`DocClip` 与 `parseDoc`/`serializeDoc`。
2. `EDITOR:src/types.ts` 不再声明 `Timeline.total_duration`、`Clip.keyframes`、`Clip.curve`、`Clip.orient`、`Clip.yaw_offset`、`Clip.pitch_offset`。
3. `EDITOR:src/store.ts` 的 `maintainInvariants` 不写 `total_duration`。
4. `EDITOR:src/operations.ts` 的 `validateScript` 不含 `version` / `total_duration` 判定。
5. 第5节各组正常/异常场景通过人工实际使用检查，记录操作与问题，不要求单元测试或自动断言。
6. §6 冒烟 6 步全部通过，并记录 `script.validate` 原文。
7. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体存在同契约的 `model/` 包（提案实现），能对同一 `doc_smoke.json` 得到相同的 `serializeDoc` 输出（键集合与值一致，顺序允许不同）。
