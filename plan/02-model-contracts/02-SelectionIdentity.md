# 02-SelectionIdentity：片段身份与选择状态

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C03 编辑器会话状态、C04 编辑命令与历史
> 依赖：[02-ScriptDocument](02-ScriptDocument.md)
> 下游：05（时间轴）、06（属性选择）、07（路径端点绑定）、11（规则绑定）、12（模板/分支）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

定义三件互相牵连的事：

1. **运行时身份**：`clip.id`（脚本内唯一，`^[A-Za-z0-9_]{1,64}$`），被 `paths[]`、`rule_bindings[]`、`exit.target`、分支/跳转引用。
2. **编辑器身份**：`clipKey`（内存稳定键），用于选择、撤销后修复、行标识；不写盘。
3. **选择状态**：`{clipKey, objectPath?, keyframeTime?, pathId?, ruleId?, bindingId?}`，以及重排/插入/删除后的重映射规则。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 前端选择是 `{track, clip, keyframe}` 下标 | `EDITOR:src/types.ts — Selection（270–274）`；`EDITOR:src/store.ts（62–66）` |
| 前端撤销后用 `clearSelectionIfInvalid` 兜底 | `EDITOR:src/store.ts（114–128）` |
| 运行时片段 id 可缺省，但被引用时必须存在 | `J:script/identity/ClipIdentity.java（5–18）`；`J:script/ScriptParser.java — parseClipId（420–442）` |
| 片段 id 重复由校验器报（解析期不报） | `J:script/ScriptValidator.java — checkClipIdentities（321–373）` |
| `paths[].clip` 必须解析到有 `objects` 的片段，否则解析期抛错 | `J:script/path/PathCollectionParser.java — parseEntry（129–138）` |
| `PathEntry.targetId()` 返回 `target.scriptClipId()`（可能为 null） | `J:script/path/PathEntry.java（50–53）` |
| 路径端点用**时间**引用（`from`/`to` 命中 position 节点时间且相邻），不是下标 | `PathCollectionParser.parseEntry（140–168）`；`indexOfTime（381–390）` |
| 前端 clip 剪贴板按对象引用保存 | `EDITOR:src/store.ts（68–70）` |

结论：下标选择在插入/删除/重排后会指向错误片段；路径端点已经用时间引用（正确），但编辑器若用"第 N 个关键帧"表达端点就会与运行时不一致。

### 2.2 目标

1. `clipKey` 稳定：同一片段在重排、跨轨移动、撤销重做后仍是同一个 key。
2. 选择用 `clipKey + objectPath + time`，不用下标。
3. 路径端点只暴露"两个时间 + 相邻性"，不暴露下标。
4. 结构变更（删片段、删关键帧）后，引用必须**显式重映射或报错**，不得静默改指（运行时同口径：`PathCollectionParser` 端点未命中即抛错）。
5. 复制/粘贴保留引用意图：粘贴到别处时提示重新选择目标片段。

### 2.3 非目标

- 不做跨文档引用（脚本之间用 `meta.id` 与触发器 `requires`，归 04/11）。
- 不定义 `exit` 语义（11/12）。

## 三、方案

### 3.1 clipKey：不写脚本的稳定编辑器身份（提案）

首次装载为每个片段分配文档会话内唯一clipKey，存于编辑器元数据/历史快照；不是用track下标、排序序号或start_time重新计算。片段有无运行时id均获得稳定键，移动、重排、跨轨和撤销重做保留同一键。新增/复制获得新键，撤销恢复原键；普通保存仅序列化标准脚本，不写clipKey。

运行时clip.id与clipKey分别索引；修改clip.id可原子重写运行时引用，但不改变编辑器片段身份。无需为了保持选区强迫作者给未被引用的片段填写id。只有新增paths/rule等真实引用时才按3.2确认合法运行时id。

### 3.1a 节点定位与移动事务

关键帧在单属性内用(clipKey, objectPath, keyframeTime)精确定位，time是可变定位值，不是不可变节点ID。修改时间命令必须返回old→new定位映射，与文档/路径引用/选择一次提交；撤销恢复反向映射。删除选中节点后清空该节点选择并保留属性选择，不能自动选最近节点再继续写值。05/06只消费同一Selection与命令回执，不自造nodeId或第二套选区状态。

### 3.2 引用强制规则

| 引用方 | 要求 | 依据 |
|---|---|---|
| `paths[].clip` | 目标片段**必须**有 `id`，且解析成功、有非空 `objects` | `PathCollectionParser.parseEntry（129–138）` |
| `rule_bindings[].clip` / `[].rule` | 必须解析 | `RuleCollectionParser`（归 11 轮核对） |
| `exit.target` | 必须解析（仅 `goto`） | `J:script/rule/ClipExitPolicyParser`（`ScriptParser.resolveClipExits 169–192`） |
| 分支/模板目标 | 必须解析 | 12 轮 |

编辑器规则：**任何"添加引用"的命令前，若目标片段无 `id`，必须先弹"设置 id"对话框**（不自动生成，避免与作者命名冲突）。

### 3.3 选择状态（提案）

```ts
export interface Selection {
  clipKey: string | null
  objectPath: string | null        // 06：选中的采样属性
  keyframeTime: number | null      // 06：选中属性内的时间（不是下标）
  pathId: string | null            // 07
  ruleId: string | null            // 11
  bindingId: string | null         // 11
  clipKeys?: string[]              // 片段批选：编辑器键，不是运行时clip.id
}
```

不变式（同一时刻最多一个"主"选择域）：

| 域 | 非空字段 | 其他必须为空 |
|---|---|---|
| 片段 | `clipKey` | `objectPath`/`keyframeTime`/`pathId`/`ruleId`/`bindingId` |
| 属性 | `clipKey` + `objectPath` | `pathId`/`ruleId`/`bindingId`；`keyframeTime` 可空 |
| 关键帧 | `clipKey` + `objectPath` + `keyframeTime` | 结构域 |
| 路径 | `pathId` | 其余 |
| 规则 | `ruleId` / `bindingId` | 其余 |

片段批选使用clipKeys，与属性主选择域区分；06节点批选在同一文档会话的keyframeSelection中记录属性/time定位，全部由命令映射修复，不在检查器另存一份。

效果控件按当前单片段clipKey建立完整上下文；objectPath/keyframeTime只是其中的主编辑目标，不是“只许显示这一属性”的过滤器。多个组可同时展开，换属性不得清掉其他已展开行；多片段选区不默认取第一项或合并虚拟对象。快捷属性与效果控件读同一Selection，节点批选也只有同一份。主时间轴的命中/批选只产生片段选择，不产生属性节点选择；节点定位/拖动仅由06效果控件发出。

### 3.4 重映射规则（结构变更后）

| 变更 | 处理 |
|---|---|
| 删除片段 | 所有引用它的 `paths[]`/`rule_bindings[]`/`exit.target` 必须**先**被处理：编辑器弹出"这些引用将失效"，作者选择"一并删除"或"取消操作"。禁止静默删引用。 |
| 移动片段（跨轨/重排） | clipKey和选择均不变；运行时引用按clip.id不变，不因排序重算匿名键 |
| 删除位置关键帧 | 若该时间是某 `paths[]` 的 `from`/`to` → 阻止删除，或提示"先重绑/删除该路径条目"。依据：`PathCollectionParser` 要求端点命中节点时间（`indexOfTime 381–390`），删除后加载期必错。 |
| 插入位置关键帧 | 允许；已存在的路径端点仍命中（时间没变），但相邻性可能被破坏：插入的时间落在 `from`/`to` 之间 → `to` 不再是 `from` 的下一个节点 → 加载期报"端点必须与 from 相邻"（`parseEntry 160–165`）。编辑器必须在插入前检测并提示"该插入会切断路径 p1 的端点相邻性"，提供"同时重绑"或"取消"。 |
| 修改关键帧时间 | 同属性重复时间拒绝；涉及路径端点时原子重绑或拒绝，成功后用old→new映射同步Selection，失败全部不变 |
| 改片段 `id` | 若被引用 → 同步改所有引用（一次 `commit`），或拒绝。禁止只改一侧。 |
| 撤销/重做 | 按 §3.5 修复选择，不改引用。 |

### 3.5 选择修复算法（撤销/重做/结构变更后）

```text
1. clipKey仍命中则保留；被删除则清空该片段选择，不自动跳到同轨第一条。
2. objectPath不存在则清空属性/节点选择，保留仍存在的片段。
3. 节点移动按命令显式映射更新keyframeTime；节点删除则清空节点选择，不按最近时间猜测。
4. pathId/ruleId/bindingId失效则只清空该域；撤销重做由同一历史快照/映射恢复。
5. 整个选择修复与文档事务同成功/同失败，失效状态可见，不静默改指另一个对象。
```

### 3.6 路径端点的表达

编辑器中一条 `paths[]` 条目的端点显示为：

```text
目标片段: c1 (id)
端点 A: t=0.0   ← 命中 position 节点时间（position.x/y/z 并集）
端点 B: t=3.0   ← 必须是 A 的下一个节点
轴: x, y
几何: bezier
时间映射: linear
```

- 编辑器**只**允许从"目标片段的位置节点时间序列"里选（下拉），不提供自由数字输入。
- 节点序列 = `position.x`/`position.y`/`position.z` 关键帧时间的并集（去重升序）：`PathCollectionParser.positionNodeTimes(Clip)（336–349）` 与 `positionNodeTimes(JsonObject)（357–374）`。
- 相邻 = 在该并集里下标相邻（`parseEntry 160–165`）。
- 端点匹配容差 `1e-4` 秒（`TIME_EPSILON 54`，`indexOfTime 381–390`）。编辑器下拉给的是精确值，不涉及容差；但**导入**已有脚本时要用同一容差匹配。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `buildIdentityIndex(doc)` | 文档 | `Map<clipKey, ClipRef>`（`ClipRef = {clip, inline, trackType, ordinal}`） |
| `resolveRef(doc, ref)` | `{kind:'clip'|'path'|'rule'|'binding', id}` | 命中的条目或 `null` |
| `repairSelection(selection, doc, registry)` | 旧选择 + 新文档 | 修复后的选择（纯函数） |
| `checkRefsBefore(doc, cmd)` | 文档 + 待执行命令 | `RefImpact[]`（将失效的引用列表） |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/identity.ts`（提案）：`clipKeyOf` / `buildIdentityIndex` / `repairSelection`。
2. 新建 `EDITOR:src/model/refIntegrity.ts`（提案）：`checkRefsBefore` + 引用完整性检查（供 02-EditorStore 的 `enforceStructure` 调用）。
3. 改 `EDITOR:src/types.ts — Selection（270–274）`：换成 §3.3 的形状。
4. 改 `EDITOR:src/store.ts`：
   - `state.selection`（62–66）改用新形状；
   - `clearSelectionIfInvalid`（被 `undo`/`redo` 调用）改为 `repairSelection`；
   - `selectedClips`（68）改存 `clipKey[]`，不再存下标对。
5. 迁移所有state.selection.track/clip/keyframe调用者：主时间轴只选/移/裁片段；统一效果控件与快捷属性按共享clipKey/objectPath/keyframeTime定位；飞控写回沿原授权与命令语义消费这个目标，不从旧主时间轴节点获取下标。
6. 飞控写回（`store.ts 601–604`）改成：按 `clipKey + objectPath` 找属性，按 `keyframeTime` 找帧；找不到则不写（不新建）。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/IdentityIndex.java`（提案）：与 WebUI 同派生规则。
2. `INGAME:common/.../editor/model/Selection.java`（提案）：同形状 record。
3. 引用解析可直接用主模组 `ClipResolver`（`J:script/identity/ClipResolver.java 11–31`）作为真值对照，但编辑器自己的索引不依赖它（要支持"引用悬空"这种运行时不接受的状态，用于提示修复）。

### 4.4 禁止修改

- 不自动生成/写入 `clip.id`。
- 不用数组下标做选择或引用。
- 不在删除片段时静默删除引用条目。
- 不改 `ClipIdentity.PATTERN` 或放宽 id 校验。
- 不把 `paths[]` 端点表达成"第几个关键帧"。

## 五、正反例验收

### 5.1 正例

1. 有id与无id片段重排/跨轨后clipKey均不变，选择仍指同一片段；复制获得新键，撤销恢复原键，不为选择稳定自动写clip.id。
2. 修改 `id:c1` 为 `id:hero`，且 `paths[0].clip='c1'`：一次 `commit` 同时改两处；撤销一次全部回退。
3. 插入一个位置关键帧在 `t=1.5`，而 `paths[0]` 端点是 `0→3`：`checkRefsBefore` 返回"将切断相邻性"，编辑器阻止（或要求先重绑）。
4. 删除 `t=3` 的 `position.x` 关键帧，而它是 `paths[0].to`：阻止，提示先处理该路径。
5. 关键帧从t=2移动到t=3后选择跟随同一命令映射；撤销回t=2；删除后只清空节点选择，不选最近节点。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 删除被 `paths[0].clip` 引用的片段，且作者未确认 | 操作被阻止，引用条目原样保留 |
| 给无 id 的片段添加 `paths[]` 条目 | 弹出"设置 id"，不自动填 `c1` |
| 把 `paths[0].to` 从 3 改成 2（不与 `from` 相邻） | 本地结构检查报错，保存前拦截（`parseEntry 160–165` 同口径） |
| 用 `{track,clip,keyframe}` 下标保存选择 | 禁止（类型层面删除旧字段） |
| 两个片段用同一个 `id` | 本地报"片段 id 重复"（`checkClipIdentities 321–373` 同口径），保存前拦截 |

### 5.3 异步关键帧专项

**正例**：选中 `yaw` 的 `t=2` 帧，然后把 `position.x` 的 `t=1` 帧删掉。

- 期望：选择仍指向 `yaw@2`；`position.x` 少一帧；`yaw` 不变。

**反例**：删除 `position.x@1` 后，选择跳到"`position.x` 的下一帧"。

- 期望：不发生。选择域是 `(clipKey, 'yaw', 2)`，与 `position.x` 无关。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；脚本 `id_smoke.json`：CAMERA 轨 2 个内联片段（一个 `id:c1`，一个无 id）+ 顶层 `clips[]` 1 个（`id:branch_a`）+ `paths[0]` 指向 `c1`。
2. 打开脚本，选中 `c1` 的 `yaw` 帧；交换两条内联片段顺序；确认选择仍在 `c1`。
3. 选中无 id 片段，尝试添加路径条目 → 出现"设置 id"提示。
4. 给 `c1` 插入 `position.x` 关键帧到 `t=1.5`（原端点 0→3）→ 出现"将切断路径端点"提示并阻止。
5. 保存，`script.validate` → `ok: true`。
6. 游戏内播放，确认路径仍生效（相机沿 bezier 走）。

通过判定：第 2 步选择不漂移；第 3/4 步被阻止；第 5 步通过；第 6 步路径可见。

## 七、完成定义

1. `EDITOR:src/model/identity.ts`、`refIntegrity.ts` 存在。
2. `EDITOR:src/types.ts — Selection` 已是新形状；`grep selection.track` 0 命中。
3. 飞控写回不再用下标。
4. §5 的 5 条正例、5 条反例通过。
5. §6 冒烟 6 步通过。
6. （14 迁移要求，本轮不作为出口）WebUI与游戏内Forge对同一标准文档产生等价选择/引用影响行为；内部临时键不要求跨进程字符串相同，也不写运行时脚本。
