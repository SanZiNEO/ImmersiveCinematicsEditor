# 02-ValidationBridge：结构检查与服务端校验桥

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C02 标准脚本文档、C04 编辑命令与历史
> 依赖：[02-ScriptDocument](02-ScriptDocument.md)、[02-AnimObject](02-AnimObject.md)、[02-PropertyPathRegistry](02-PropertyPathRegistry.md)、[02-SelectionIdentity](02-SelectionIdentity.md)
> 下游：06（诊断）、07（路径/位置诊断）、13（WebUI 验收）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

把校验分成两层并给出各自的确切范围：

- **本地结构检查**（同步、无网络）：只查"形状对不对、引用在不在、时间顺序对不对"，逐条对齐运行时 `ObjectParser` / `ObjectValidator` / `PathCollectionParser` 的判定，但不重写它们的语义。
- **服务端校验**（异步、`script.validate`）：`ScriptValidator` 的权威 issue 列表，包含语义与跨引用检查。

本文件还定义 issue 的数据结构、定位方式（把 issue 字符串映射回 `clipKey + objectPath + keyframeTime`）、以及"本地检查绝不拦保存"的边界（唯一例外：会被 parser 直接拒绝的结构错误）。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 前端 `validateScript` 复刻了部分语义并含已过期规则 | `EDITOR:src/operations.ts — validateScript（639–697）`：`meta.version!==3`（645）、`total_duration===0`（650–651）、`CAMERA 片段缺少关键帧`（663–667）、片段重叠（684–692） |
| 服务端校验是收集式、不抛 | `J:script/ScriptValidator.java — validate（85–95）`、`isWarning/errorsOf（62–80）` |
| 服务端校验文案前缀有两套：meta 用 `"meta.xxx ..."`，对象用 `"<clipPath>: <path>: ..."` | meta：`validate（110–131）`；对象：`J:script/object/ObjectValidator.java — validate（69–85，prefix = clipPath + ": "）` |
| 解析器首错即抛 | `J:script/ScriptParser.java — parse（122–130）`、`ScriptParseException（92–110）` |
| 服务端校验已含路径集合检查（与解析器同一规则集） | `ScriptValidator.checkPathCollection（663–689）`、`checkPathEntry（690–783）` |
| 前端把 `script.validate` 结果直接塞进 `state.validationIssues` | `EDITOR:src/store.ts — validateScriptDocument（394–409）` |

问题：

1. 前端规则过期（`version`、`total_duration`、CAMERA 至少一帧、片段不重叠）——其中"片段不重叠"与运行时 lane 模型冲突（`ObjectValidator` 不检查重叠；`ScriptValidator` 也不检查）。
2. 前端不知道"本地该查什么"，也不知道"服务端 issue 怎么定位"。

### 2.2 目标

1. 本地检查清单**封闭且可枚举**（§3.2 表格），每条都能指到运行时同一常量或同一判定顺序。
2. 服务端 issue 原样显示，同时尽量映射到文档位置；映射失败就只显示文本，不猜。
3. 本地检查分级（四档，对应"谁来拒"）：
   - `block`：**parser 会拒绝**（`ScriptParser`/`ObjectParser`/`PathCollectionParser` 抛错），保存前必须修，否则文件无法加载。
   - `error`：`script.validate` 报**错误级**（非 `[警告] ` 前缀）但 parser 接受——脚本仍能加载播放，只是 `ok:false`。
   - `warn`：`script.validate` 的 `[警告] ` 级（当前只有一处，见冲突 C-02-34）。
   - `info`：编辑器自己的提示（轴外帧、近似值等），服务端不报。
4. 保存策略：`block` 阻止保存；`error`/`warn`/`info` 只提示（沿用现有"保存草稿"行为，`store.ts 456–459`），但 `error` 必须在诊断面板置顶。

### 2.3 非目标

- 不实现 `ScriptValidator` 的语义规则（跨脚本引用、规则可达性、事实接力、模型合法性等）。
- 不判世界状态（选择器能否解析、结构是否存在）——那是运行期，`ObjectCameraEvaluator.isClipUsable（266–288）` 才判。
- 不修运行时校验器的任何行为。

## 三、方案

### 3.1 issue 模型（提案）

```ts
// EDITOR:src/model/issues.ts（提案）
export type Severity = 'block' | 'error' | 'warn' | 'info'

export interface Issue {
  severity: Severity
  code: string                 // 稳定标识，如 'clip.unknownKey' / 'object.timeNotAscending'
  message: string              // 人读；本地检查尽量复用运行时文案
  where?: DocLocation          // 可定位时给
  source: 'local' | 'server'
  raw?: string                 // 服务端原文
}

export interface DocLocation {
  clipKey?: string
  objectPath?: string
  keyframeTime?: number
  pathId?: string
  ruleId?: string
  bindingId?: string
  jsonPath?: string            // 服务端给的原始路径（如 timeline.tracks[0].clips[1]: objects.yaw.keyframes[2].time）
}
```

### 3.2 本地结构检查清单（封闭集合）

| # | 检查 | 级别 | 规则来源（同一常量/顺序） |
|---|---|---|---|
| L01 | 根是对象；`meta`/`timeline` 存在且是对象 | block | `ScriptValidator.validate（104–108、116–120）`；`ScriptParser.parseInternal（137–144）` |
| L02 | `meta` 键 ∈ `META_KEYS` | block | `ScriptParser.metaKeys（76–81）`、`parseMeta（193–195）` |
| L03 | `meta.id` / `name` / `author` 是非空字符串；`id` 匹配 `^[a-zA-Z0-9_]{1,32}$`；`name` ≤50、`author` ≤30 | block | `parseMeta（198–208）`；`ScriptValidator（110–122）` |
| L04 | `timeline` 键 ∈ `{tracks, loop_start, loop_end}` | block | `timelineKeys（83–89）` |
| L05 | `tracks` 是数组；每项有字符串 `type` 与数组 `clips`；轨道对象上的额外键（如 `id`）运行时不读取 → 保留 + info | block / info | `parseTrack（325–343）`（不校验额外键） |
| L06 | 内联片段：键 ∈ `CLIP_KEYS`；有 `start_time`（有限数字）与 `duration`（≠0） | block | `ObjectParser.CLIP_KEYS（37–38）`、`parseObjectClip（355–362）` |
| L07 | 独立片段：键 ∈ `CLIP_KEYS ∪ {track}`；无 `start_time`；有 `track`（合法轨道 id）与 `duration`（≠0） | block | `parseStandaloneClips（444–503）` |
| L08a | `clip.id`（若有）匹配 `ClipIdentity.PATTERN` | block | `parseClipId（420–442）` |
| L08b | 片段 id 脚本内唯一 | error（parser 不查重复） | `checkClipIdentities（321–373）` |
| L09 | `objects` 是对象；每个键是合法路径且 ∈ 该轨 schema | block | `ObjectParser.parse（51–81）` |
| L10 | 每个属性只有 `value` / `keyframes` | block | `parseProperty（93–110）` |
| L11 | `mode=value` 无 `keyframes`；`mode=event` 有非空 `keyframes`；`mode=animated` 的 `interp != none` | block | `SampledProperty（60–96）`；`ObjectValidator.checkProperty（289–336）` |
| L12 | 值类型匹配（9 种）；非有限数拒绝 | block | `ObjectCodec.fromJson（43–58）` |
| L13 | `enum` 值 ∈ `enumValues`；`min`/`max` 范围 | error（parser 不查枚举/范围） | `ObjectValidator.checkTyped（384–406）`、`checkRange（408–422）` |
| L14 | keyframes 是数组；每项只有 `time`/`value`；`time` 有限、≥0、严格递增 | block | `parseKeyframes（135–172）` |
| L15 | `required` 对象有值/有效帧/schema 默认 | block | `parseProperty（125–129）` |
| L16 | `requires` 不满足但写了 | error（运行时不读，但 validator 报错） | `checkRequiresAndRequired（424–443）` |
| L17 | `position_mode=absolute` ⇒ `position_origin` 为空 且 `position_space != base` | error（parser 不查组合） | `ObjectValidator.checkCamera（500–516）` |
| L18 | `position_space=world` 写了 `facing_*` | error（运行时不读，validator 报错） | `checkCamera（541–549）` |
| L19 | `facing_source=auto` 时 `facing_target` 与 `facing_entity` 不同时非空 | error（运行期还会抛 `IllegalArgumentException`） | `checkCamera（521–526）`；`PositionEvaluator.autoSource（132–151）` |
| L20 | `facing_source=entity` 需要 `facing_entity` 或实体原点 | error（运行期还会抛） | `checkCamera（527–531）`、`isEntityOrigin（562–566）`；`entityFrame（154–173）` |
| L21 | `facing_source=line` 需要 `facing_target` | error（运行期还会抛） | `checkCamera（532–536）`；`lineFrame（176–194）` |
| L22 | `facing_source=world` 写了载荷 | error（运行时不读，validator 报错） | `checkCamera（537–540）` |
| L23 | 冻结开关在不会被读取的位置 | error（与求值器不一致，见冲突 C-02-05/06/07/17） | `checkFreezes（568–591）` |
| L24 | 参考系切换对齐：`SPACE_SWITCH_FIELDS` 每个变化点必须有 `position.x/y/z` 三轴关键帧 | error（parser 不查） | `checkSwitches（602–636）`、`collectChanges（638–655）`、`hasKeyframeAt（674–689）` |
| L25 | `paths` 是数组；条目键 ∈ `{id,clip,from,to,axes,geometry,timing}` | block | `PathCollectionParser.ENTRY_KEYS（58–59）`、`parseEntry（118）` |
| L26 | `paths[].id` 匹配 `^[A-Za-z0-9_]{1,64}$` 且唯一 | block | `ID_PATTERN（48）`、`parseEntry（120–127）` |
| L27 | `paths[].clip` 可解析且目标有非空 `objects` | block | `parseEntry（129–138）` |
| L28 | `paths[].from < to`，且都命中目标片段 position 节点时间并相邻 | block | `parseEntry（140–168）`；`positionNodeTimes（336–374）`；`indexOfTime（381–390）` |
| L29 | 同一片段端点对不重复（区间部分重叠合法） | block | `parseEntry（178–186）` |
| L30 | `axes` 是 `x/y/z` 的子集、非空、去重、顺序无关 | block | `parseAxes（200–225）` |
| L31 | `geometry` 必填且有字符串 `type`；`line` 只接受 `type`；其余类型的未知类型/未知参数/必填缺失/类型不符 | block | `parseGeometry（235–264）`；`PathCurveRegistry.create（267–305）` |
| L32 | `timing`：`linear` 或 `keyframes`；`points` ≥2、`t`/`s` 单调不减、端点 0/1 | block | `parseTiming（274–331）`；`PathTiming.of（37–39）`、`KeyframeTiming.of（72–103）` |
| L33 | `rule_bindings[].clip` / `[].rule` 可解析；`exit.target` 可解析 | block | `ClipResolver.require（24–30）`；`resolveClipExits（169–192）` |
| L34 | 根未知键 | info（运行时忽略，服务端不报） | `parseInternal（131–168）` 无根白名单 |

**分级依据（必须记住）**：`ScriptValidator` 只有一处使用 `[警告] ` 前缀（`WARNING_PREFIX（62）`，实际用在 `checkHoldReachability（1031）`）。`ObjectValidator` 的所有"写了但…已忽略"文案**没有**该前缀，因此 `errorsOf（70–74）` 把它们算成错误 → `script.validate` 的 `ok:false`，但 `ScriptParser` 仍能加载播放。`error` 与 `block` 的区别就在这里（冲突 C-02-34）。

**明确不做的本地检查**（交给服务端）：

- 片段重叠（运行时 lane 模型允许；现有前端规则 `operations.ts 684–692` 应删除）。
- `CAMERA 片段至少一个关键帧`（运行时无此要求：`ObjectParser` 不检查；`docs/SCRIPT_FORMAT.md §3.2` 也没要求）。
- 规则可达性/事实接力/持有（`ScriptValidator.checkHoldReachability 1003+`）。
- 模型定义合法性（`MathModelRegistry.create` 的回落是运行期行为，validator 不拦；见 07-MathModelEditor）。
- 跨脚本 `requires.script` 存在性（需要 `knownScriptIds`，`validate(json, ids)` 支持，但编辑器拿到的是服务端全量列表，属 04/11）。

### 3.3 服务端桥

```ts
async function validateOnServer(doc): Promise<Issue[]> {
  const docJson = serializeDoc(doc)
  const r = await request('script.validate', { doc: docJson })
  return r.issues.map(toServerIssue)   // r.ok 只表示 errorsOf(issues) 为空
}
```

- 消息与返回形状：`{ok: boolean, issues: string[]}`（`J:webui/WebEditorApi.handleScriptValidate（152–166）`）。
- `ok` 的语义是"没有非警告 issue"（`ScriptValidator.errorsOf（70–74）`，警告前缀 `[警告] `，`WARNING_PREFIX（62）`）。编辑器必须同时看 `issues` 而不是只看 `ok`。
- 防抖：编辑停止 400ms 后发一次；每次 `commit` 取消上一次未发的请求。
- 失败（断连）：保留上一次 issue，标注"已过期"。

### 3.4 定位映射（尽力而为，不猜）

服务端 issue 的两种形状：

| 形状 | 例子 | 解析 |
|---|---|---|
| meta/timeline 直缀 | `meta.id 必须匹配 ...` | 无位置；`jsonPath` = `meta.id` |
| 对象/片段前缀 | `timeline.tracks[0].clips[1]: objects.yaw.keyframes[2].time: 关键帧时间必须单调递增，前一帧: 1.0` | 正则 `^timeline\.tracks\[(\d+)\]\.clips\[(\d+)\]: (.*)$` → (trackIndex, clipIndex) → `clipKey`；再从余下部分取 `objects\.([a-z0-9_.]+)` 与 `keyframes\[(\d+)\]` |
| 独立片段 | `clips[0]: objects....`（服务端前缀以 `clips[i]` 开头，见 `checkStandaloneObjects（482+）`） | 正则 `^clips\[(\d+)\]: (.*)$` |
| 路径集合 | `paths[0].from 必须命中...` | 取 `paths[i]` → `pathId`（若文档该下标的条目有 id） |
| 规则/绑定 | `rules[i]...` / `rule_bindings[i]...` | 同上 |

映射失败时：只显示原文 + 一个"复制"按钮，不提供"跳转"（避免跳到错误位置）。

`keyframeTime` 无法从服务端字符串直接得到（服务端给的是下标），映射时用"该属性当前第 N 帧的 time"。注意服务端可能在校验的是**待保存的 doc**，与编辑器当前文档一致（同一份 `serializeDoc` 输出），所以下标有效。

### 3.5 保存前拦截规则

| 情况 | 行为 |
|---|---|
| 有 `block` 级本地 issue（parser 会拒） | 阻止保存；显示"必须先修复"清单 |
| 只有 `error`/`warn`/`info` | 允许保存（草稿语义，`store.ts 456–459`）；`error` 在诊断面板置顶 |
| 服务端 `ok:false` | 允许保存（草稿），但显示错误面板；不静默 |
| 断连 | 允许保存（写盘不依赖服务端），但标注"未校验" |

`block` 的判定标准只有一条：**`ScriptParser` 会不会抛错**（L01–L12、L14、L15、L25–L33）。`error` 类（L13、L16–L24）脚本能加载能播，只是 `script.validate` 的 `ok:false`。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `validateStructure(doc, registry): Issue[]` | 文档 + 注册表 | 本地 issue（同步、纯函数） |
| `validateOnServer(doc): Promise<Issue[]>` | 文档 | 服务端 issue |
| `locate(issue, doc): DocLocation \| null` | issue + 文档 | 位置或 null |
| `blocksSave(issues): boolean` | issue 列表 | 是否含 `block` |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/issues.ts`、`EDITOR:src/model/validateStructure.ts`（提案）。
2. 改 `EDITOR:src/operations.ts — validateScript（639–697）`：整段删除，改为薄封装 `validateStructure`（保留导出名以免一次性改爆调用点，但实现换成新函数）。
3. 改 `EDITOR:src/store.ts — validateScriptDocument（394–409）`：改为 `validateOnServer` + `validateStructure`，两份 issue 合并到 `derived.structureIssues` / `derived.serverIssues`。
4. 改 `EDITOR:src/store.ts — saveScript（439–465）`：保存前若 `blocksSave` 为真 → 抛/返回错误并显示清单（当前是"先校验不阻断"，需改成阻断 `block` 级）。
5. 新增诊断面板（归 05 的右侧 tab 或底部抽屉；本轮只给数据接口）。
6. 删除 `operations.ts` 里的片段重叠检查（684–692）与 CAMERA 关键帧检查（663–667）。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. 游戏内本地结构检查消费同一schema/标准文档合同与行为向量；具体JS复用或Java实现由03/14宿主能力确认，不另建一份硬编码字段表。ScriptParser.META_KEYS包私有不能直接依赖；字段元数据从schema.get/公共schema端口取得，真正未导出的约束按03.09由明确所有者补稳定能力，不为02留下等待14决定的倒序前置（本轮按当前合同与行为向量交付）。
2. 游戏内真实校验通过03.08/09公共信号端口调用主模组校验，与WebUI同义回执；不能以编辑器直接依赖内部解析类作为最终架构。
3. 两载体共用同一批 issue 向量（`vectors/issues/*.json`），断言 `code` + `severity` 一致。

### 4.4 禁止修改

- 不改 `ScriptValidator` / `ObjectValidator` / `PathCollectionParser` 的任何规则。
- 不把本地检查提升为"语义权威"（服务端 issue 才是权威）。
- 不新增"片段不重叠"检查。
- 不因 `warn` 阻断保存。
- 不在断连时伪造 `ok:true`。

## 五、正反例验收

### 5.1 正例

1. 一个合法 CAMERA 片段（含 `objects`、2 个属性、1 条 path）→ `validateStructure` 返回空；`script.validate` 返回 `ok:true`。
2. `position_mode=absolute` + `position_origin=""` + `position_space=world` → 无 issue。
3. `paths[0]` 的 `from/to` 命中节点且相邻 → 无 issue。
4. `requires` 不满足（`orient=manual` 且写了 `yaw_offset`）→ 一条 `error`（`script.validate` 的 `ok:false`），但 `blocksSave` 为假（脚本能加载播放）。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| `meta.version: 3` | L02 `block`，`jsonPath='meta.version'` |
| `timeline.total_duration: 12` | L04 `block` |
| 内联片段缺 `start_time` | L06 `block` |
| 独立片段有 `start_time` | L07 `block` |
| `objects` 里 `foo` 未登记 | L09 `block`，定位到该片段 |
| `"orient": {"value":"manual","keyframes":[...]}` | L11 `block` |
| `"yaw": {"keyframes":[{"time":1,"value":0},{"time":1,"value":1}]}` | L14 `block`，`keyframeTime=1` |
| `position_mode=absolute` 且 `position_space=base` | L17 `error`（parser 接受，validator 报错） |
| `position_space` 在 `t=2` 从 `world` 切到 `base`，但 `t=2` 没有 `position.x/y/z` 帧 | L24 `error`，定位到切换时间 |
| `paths[0].to` 不与 `from` 相邻 | L28 `block` |
| `paths[0].geometry.type='bezier'` 但 `control_points` 只有 1 个 | L31 `block`（`BezierPathSpec（20–35）` 要求恰好 2 个） |
| `timing.points` 端点不是 0/1 | L32 `block` |
| 两个片段用同一 `id` | L08b `error` |
| 片段重叠 | **无 issue**（本地不查，服务端也不查） |
| 断连时点保存 | 允许写盘，标注"未校验"，不显示 `ok:true` |

### 5.3 异步关键帧专项

**正例**：`yaw` 在 `t=1,2`，`position.x` 在 `t=0,3`。`position_space` 在 `t=2` 从 `world` 切到 `base`。

- 期望：L24 报 `error`，因为 `t=2` 缺 `position.x/y/z` 三轴关键帧（`checkSwitches 602–636` 要求三轴都有，不只是 `position.x`）。
- 期望：提示里明确列出"缺 position.y、position.z"（不是笼统"缺关键帧"）。

**反例**：作者在 `t=2` 只给 `position.x` 补帧就想消除告警。

- 期望：仍然 `block`（三轴都要），错误信息指出还缺 `position.y`/`position.z`。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；准备 `bad_smoke.json`：含 `meta.version`、`timeline.total_duration`、`objects.unknown`、时间重复帧、非相邻路径端点各一处。
2. 编辑器打开 → 确认 L02/L04/L09/L14/L28 全部以 `block` 显示并定位到正确片段/属性。
3. 逐项修复；每修一项，本地 issue 减少一条。
4. 全部修完，`script.validate` → `ok:true`。
5. 保存 → 游戏内播放成功。
6. 故意把 `position_space` 在 `t=2` 切换但不补三轴帧 → 确认本地 `block`，且服务端 `script.validate` 也报同类错误（证明本地与运行时同口径）。

通过判定：第 2、6 步的本地 issue 与服务端 issue 在"是否报错"上一致（文案可不同）。

## 七、完成定义

1. `EDITOR:src/model/validateStructure.ts` 存在，覆盖 L01–L34。
2. `EDITOR:src/operations.ts — validateScript` 不再含 `version` / `total_duration` / 片段重叠 / CAMERA 关键帧规则。
3. 保存路径按 §3.5 阻断 `block`。
4. §5 的 4 条正例、14 条反例通过。
5. §6 冒烟 6 步通过，附本地与服务端 issue 对照。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体对同一向量集产出相同 `code` + `severity`。
