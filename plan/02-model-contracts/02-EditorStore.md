# 02-EditorStore：文档状态、命令与历史

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C03 编辑器会话状态、C04 编辑命令与历史
> 依赖：[02-ScriptDocument](02-ScriptDocument.md)、[02-SelectionIdentity](02-SelectionIdentity.md)、[02-ValidationBridge](02-ValidationBridge.md)
> 下游：05（时间轴）、06（属性/关键帧）、07（位置/路径）、11（规则）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

把编辑器的状态分成四类并给出各自归属：**文档**（要保存的脚本）、**会话**（选择、视口、面板、连接）、**派生**（有限末端、结构 issue、漂移报告）、**传输**（请求/回执/预览帧）。

给出统一的命令入口 `commit`、快照式撤销、以及"提交后只做结构不变量、不重算总时长"的规则。

**参考输入与裁决**：[Olive时间轴与命令](../references/01-olive-timeline-commands.md)§4.8/4.11。只借单事务、空操作不入栈和历史上限，不迁移命令对象或dirtyBefore。History保持本文字符串快照；实际撤销/重做保守置脏，清脏只走既有保存回执合同，不因参考另造精确保存点算法。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 单一 `reactive` 状态块把连接、脚本、播放、选择、时间轴、轨道视图混在一起 | `EDITOR:src/store.ts — state（38–89）` |
| `commit` = `pushUndo` → `fn()` → `maintainInvariants()` → 防抖推送 | `store.ts — commit（142–150）` |
| `maintainInvariants` 排序 + 转场对齐 + **重算 total_duration** | `store.ts（152–158，写 157）` |
| 撤销栈存 JSON 快照，上限 200 | `store.ts（102–132，MAX_UNDO 105）` |
| 选择是 `{track, clip, keyframe}` 下标 | `store.ts（62–66）`；`types.ts — Selection（270–274）` |
| 播放/预览状态与脚本同块 | `store.ts（48–59）` |
| 推送前深拷贝 + 烘焙 + 静音 AUDIO 轨裁剪 + 精简默认值 | `store.ts — pushScript（530–551）` |

结论：状态没有分层，导致"改 UI 也会动脚本"（`maintainInvariants` 写总时长）、"改脚本也会动 UI"（推送里删轨道内容）。命令入口只有一个 `fn`，无法做失败回滚与原子批量。

### 2.2 目标

1. 四类状态物理分开：`doc`（可序列化）、`session`（不写盘）、`derived`（可重算）、`transport`（连接与回执）。
2. 所有写文档的操作走 `commit(cmd)`；`cmd` 是对象而不是闭包（便于记录、回放、测试）。
3. `commit` 语义：深拷贝 → 应用 → 结构不变量 → 入栈 → 脏 → 调度推送。任一步抛错 → 文档不变。
4. 撤销/重做只作用于 `doc`，不影响 `session`（选择按 §3.5 修复）。
5. 推送/保存从 `doc` 快照派生，**不修改** `doc`（当前 `pushScript` 在深拷贝上做，已符合；但 `maintainInvariants` 在 `commit` 里改 `doc`，不符合）。

### 2.3 非目标

- 不做协同编辑/CRDT。
- 不做增量撤销。
- 不定义时间轴交互（05）。

## 三、方案

### 3.1 状态分层（提案）

```ts
// EDITOR:src/model/EditorStore.ts（提案）
export interface EditorStore {
  doc: ScriptDoc | null
  docPath: string                 // 文件相对路径（ScriptFileService 口径）
  dirty: boolean
  history: History
  session: SessionState
  derived: DerivedState
}

export interface SessionState {
  selection: Selection            // 见 02-SelectionIdentity
  playhead: number                // 全局秒
  playing: boolean
  pxPerSecond: number             // 仅主时间轴全局视口，不用于效果控件节点轴
  snap: { enabled: boolean; interval: number } // 主轴片段吸附；节点按06原命令设置
  timelineTool: 'select' | 'razor'
  trackView: Record<string, { visible: boolean; locked: boolean; muted: boolean }>
  effectControls: Record<string, EffectControlsViewState> // 当前文档内以clipKey索引，类型/更新归06
  markers: number[]               // 从 timeline.markers 迁入（运行时无此字段）
  loopRange: { start: number; end: number } | null   // UI A-B；与 timeline.loop_start/loop_end 不同
  flight: { active: boolean; state: FlightState | null }
}

export interface DerivedState {
  finiteEnd: number | null        // null = 无有限自然末端
  displayRange: { from: number; to: number }
  structureIssues: Issue[]
  serverIssues: Issue[]
  schemaDrift: DriftReport | null
  previewStats: PreviewStats | null
}

export interface History {
  undo: string[]                  // JSON 快照
  redo: string[]
  limit: number                   // 200
}
```

**关键区分**：`session.loopRange` 是 UI 的 A-B 循环；`doc.timeline.loop_start/loop_end` 是 parser 接受的脚本字段（`J:script/ScriptParser.java — timelineKeys（83–89）`）。两者不得互写。

EffectControlsViewState是06的UI类型，至少描述功能组/详情展开、显式过滤、参数列宽、originLocalSeconds/pxPerSecond/scrollTop及局部可见范围；不包含可编辑对象副本或另一份Selection。主时间轴的全局视口独立，局部节点可视范围不进入derived.finiteEnd/displayRange。旧rightTab/leftTab和主轴objectRows状态不作为新合同保留：面板身份/标签组由05唯一布局树管理，clip.effects与selection.properties可同时可见。布局/偏好恢复由05执行，标准脚本不写这些状态。

### 3.2 命令（提案）

```ts
export type DocCommand =
  | { kind: 'object.setValue'; clipKey: string; path: string; value: JsonValue }
  | { kind: 'object.addKeyframe'; clipKey: string; path: string; time: number; value: JsonValue }
  | { kind: 'object.removeKeyframe'; clipKey: string; path: string; time: number }
  | { kind: 'object.moveKeyframe'; clipKey: string; path: string; from: number; to: number }
  | { kind: 'object.setEasing'; clipKey: string; path: string; fromTime: number; easing: EasingType | null }
  | { kind: 'clip.setPlayControl'; clipKey: string; field: string; value: JsonValue }
  | { kind: 'clip.add' | 'clip.remove' | 'clip.move'; ... }
  | { kind: 'path.add' | 'path.update' | 'path.remove'; ... }        // 07
  | { kind: 'rule.add' | 'rule.update' | 'rule.remove'; ... }        // 11
  | { kind: 'binding.add' | 'binding.update' | 'binding.remove'; ... } // 11
  | { kind: 'meta.set'; key: string; value: JsonValue }

export function commit(store: EditorStore, cmd: DocCommand): CommitResult
```

`commit` 顺序（固定，不得调换）：

1. 若 `doc == null` → 返回 `{ok:false, reason:'no-doc'}`。
2. `snapshot = deepClone(doc)`（结构化克隆，不用 `JSON.parse(JSON.stringify())`，避免丢 `undefined` 与顺序假设；见 §3.4）。
3. `apply(doc, cmd)`；任何抛错 → `doc = snapshot`，返回 `{ok:false, error}`。
4. `enforceStructure(doc)`：clip 排序（按 `start_time`，独立片段不参与）+ 转场对齐 + 引用完整性（`paths[].clip`/`rule_bindings[].clip`/`exit.target` 指向存在的片段）。
   - 若 `enforceStructure` 发现引用断裂 → 回滚并返回 `{ok:false, reason:'dangling-ref'}`（不静默删条目）。
   - 无实际内容变化则返回成功但changed=false，直接结束；不入历史、不清redo、不改dirty或调度预览。失败仍按上项回滚。
5. `history.undo.push(JSON.stringify(snapshot))`；超限丢最旧；`history.redo.length = 0`。
6. `dirty = true`；重算 `derived.finiteEnd` / `derived.displayRange`；调度 `validateStructure`（同步）与 `script.validate`（异步、防抖）。
7. 调度预览推送（160ms 防抖，沿用 `store.ts — SCRIPT_PUSH_DELAY_MS（176）` 的现有值）。

### 3.3 撤销/重做

- `undo()`：把当前 `doc` 压入 `redo`，从 `undo` 弹出快照并**重新解析**为文档（`parseDoc`），然后修选择（§3.5）。
- `redo()` 对称。
- 撤销栈只存 `doc`，不存 `session`；选择在撤销后按"尽量保持"策略修复。
- `resetHistory()`：打开/新建后调用（沿用 `store.ts（130–134）`）。
- 上限 200（沿用 `MAX_UNDO`，`store.ts 105`）。
- 只有实际撤销/重做才将dirty置true；空栈调用不改任何状态。清脏遵守02-DocumentIO：真实保存回执成功且当前文档未发生并发改变；不从历史条目恢复dirtyBefore，不把“撤销到了相似内容”当已保存证据。

### 3.4 深拷贝

| 方式 | 问题 | 结论 |
|---|---|---|
| `JSON.parse(JSON.stringify(doc))`（现状，`store.ts 108/117/125`） | 丢 `undefined`、把 `NaN` 变 `null`、把非 JSON 值静默转换；对大文档是两次全量序列化 | 改用 `structuredClone`（Electron/Chromium 支持） |
| 结构化共享（immer 等） | 引入依赖、与 Vue 响应式交互复杂 | 不用 |

注意：`authoring` 里可能有非 JSON 值（如 `Set`），`structuredClone` 能处理，`JSON` 不能。

### 3.5 选择修复

撤销/重做/重排后：

1. `clipKey` 仍存在 → 保留。
2. clipKey失效则清空该片段选择；撤销重做恢复原历史键/映射，不自动跳到同轨第一条或按同名ID猜对象。
3. `objectPath` 不存在于当前 schema → 清空 `objectPath`，保留 `clipKey`。
4. 节点移动使用命令显式old→new定位映射；被删除则清空节点选择，不选最近时间，避免下一次编辑写错节点。
5. `pathId`/`ruleId`/`bindingId` 不存在 → 清空对应字段。

### 3.6 与 UI 的边界

| 状态 | 归属 | 是否写盘 |
|---|---|---|
| `doc` | store | 是（经 `serializeDoc`） |
| `selection` / `playhead` / 缩放 / 折叠 / 工具 | session | 否 |
| `trackView.visible/locked/muted` | session | 否（`muted` 只影响推送时的 AUDIO 裁剪，见 §3.7） |
| `markers` / `loopRange` | session | 否 |
| `finiteEnd` / `displayRange` | derived | 否 |
| `structureIssues` / `serverIssues` / `schemaDrift` | derived | 否 |
| `previewStats` / `flight.state` | transport | 否 |

### 3.7 推送裁剪（保留现有行为但显式化）

现状：`pushScript` 会把 `muted` 的 AUDIO 轨 `clips = []`（`store.ts 540–546`）。这是**预览**行为，不是文档行为。

新规则：

- 裁剪只发生在推送副本上，`doc` 不变。
- 保存**不**裁剪（保存要保留静音轨）。
- 该行为在 UI 上显式提示（"预览将忽略静音 AUDIO 轨"），不做隐式。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `createStore()` | — | 空 store |
| `commit(store, cmd)` | store + 命令 | `{ok, error?}` |
| `undo(store)` / `redo(store)` | store | `boolean`（是否发生变化） |
| `enforceStructure(doc)` | doc | `void`（原地）或抛 `StructureError` |
| `deriveState(store)` | doc + schema | `DerivedState`（纯函数） |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/EditorStore.ts`（提案）：上表类型 + `commit`/`undo`/`redo`/`deriveState`。
2. 改 `EDITOR:src/store.ts`：
   - state（38–89）拆为文档、会话和派生选择器；迁移全部调用方后删除旧聚合读写路径，不为减少改动保留旧state兼容别名。共享只读选择器必须有明确新职责，不能让旧整帧模型继续存活。
   - `pushUndo`（106–112）/`undo`（114–120）/`redo`（122–128）改为调用 `EditorStore`。
   - `commit`（142–150）改为 `commit(store, cmd)`；不再在提交里写 `total_duration`。
   - `maintainInvariants`（152–158）改名 `enforceStructure`，删除第 157 行。
   - `pushScript`（530–551）：删除 `bakeDocEasing` 与 `stripScriptDefaults` 调用（烘焙改由 06 的显式命令；剥离见 02-SerializationLossless §3.2）；保留 AUDIO 裁剪但加显式提示标记。
3. 改 `EDITOR:src/components/*`：所有 `state.doc.timeline.total_duration` 读取点改为 `derived.finiteEnd`（`grep total_duration` 清空）。
4. 改 `EDITOR:src/operations.ts — recalcDuration（610–620）`：改名为 `deriveFiniteEnd(tracks): number | null`，不写文档。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/EditorStore.java`（提案）：同语义的 `commit`/`undo`/`redo`，快照用 JSON 字符串（Java 侧无 `structuredClone`，用 `JsonObject.deepCopy()`）。
2. `INGAME:common/.../editor/session/SessionState.java`（提案）：选择/播放头/视口；不写盘。
3. Forge 侧命令入口（提案）只调 `EditorStore`，不直接改 `JsonObject`。

### 4.4 禁止修改

- 不在 `commit` 里重算总时长、不写 `meta.version`。
- 不用闭包当命令（必须可序列化/可记录）。
- 不在 `doc` 上挂 Vue `reactive` 代理之外的 UI 状态（如 `pxPerSecond`）。
- 不把 `session.markers` 写进 `timeline.markers`。
- 不在 `undo` 里恢复 `session`。

## 五、正反例验收

### 5.1 正例

1. `commit({kind:'object.addKeyframe', clipKey:'id:c1', path:'yaw', time:2, value:45})`：`yaw` 变 3 帧、`position.x` 不变、`dirty=true`、撤销栈 +1。
2. 连续 3 次 `commit` 后 `undo()` 三次，文档回到初始（逐字节相等）。
3. `commit` 一个会抛错的命令（例如给 `mode=value` 的 `orient` 加 keyframe）：`doc` 与提交前**完全相等**，撤销栈长度不变，`dirty` 不变。
4. 打开含 200+ 对象的片段，`structuredClone` 快照不丢字段（与 `JSON` 版对比：含 `undefined` 的 `authoring` 保留）。
5. `enforceStructure` 遇到 `paths[0].clip` 指向已删除片段 → 回滚并返回 `dangling-ref`，文档里 `paths[0]` 仍在。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| `commit` 里写 `doc.timeline.total_duration = ...` | 禁止（代码审查拦截；序列化前断言不含该键） |
| 撤销后 `selection` 指向已不存在的 `clipKey` | 按 §3.5 修复到同轨第一个片段，不抛错、不清空整个选择 |
| 推送时把 `muted` AUDIO 轨从 `doc` 里删掉 | 禁止；只删推送副本 |
| 用 `JSON.parse(JSON.stringify())` 做快照且文档含 `undefined` | 禁止；改用 `structuredClone` |
| 批量移动 10 个关键帧，第 6 个失败 | 全部回滚（一个 `commit` 一个快照），不允许部分生效 |

### 5.3 异步关键帧专项

**正例**：`commit` 一个"移动 `yaw` 第 2 帧到 t=3"的命令。

- 期望：`yaw` 帧时间变为 `[1,3]`（原 `[1,2]`），其余属性帧不动；`derived.structureIssues` 重算后仍为空；撤销一次回到 `[1,2]`。

**反例**：移动后与第 3 帧时间重合（`[1,2,3]` 移成 `[1,3,3]`）。

- 期望：`apply` 阶段抛错并回滚（同属性时间必须严格递增，`J:script/object/SampledProperty.java（97–110）`），返回明确 reason；不得自动合并或丢弃一帧。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组，编辑器连接，打开 `store_smoke.json`（≥3 个对象、≥1 条 `paths[]`）。
2. 做 5 次编辑（各一次 `commit`），每次确认预览在 160ms 防抖后刷新。
3. `undo` 5 次，确认画面回到打开时状态。
4. `redo` 5 次，确认回到编辑后状态。
5. 保存并重载，确认 `script.validate` → `ok: true`，且 `doc` 里没有 `total_duration`。
6. 把某 AUDIO 轨设为 `muted`，推送预览；确认预览无声，保存后文件里该轨 `clips` 仍在。

通过判定：第 3/4 步画面与文档一致；第 5 步无 `total_duration`；第 6 步保存未被裁剪。

## 七、完成定义

1. `EDITOR:src/model/EditorStore.ts` 存在，`commit`/`undo`/`redo`/`enforceStructure`/`deriveState` 可用。
2. `EDITOR:src/store.ts` 不再在提交路径写 `total_duration`；`pushScript` 不再烘焙/剥离。
3. `grep -n total_duration EDITOR:src` 只剩注释或 0 命中。
4. §5 的 5 条正例、5 条反例通过。
5. §6 冒烟 6 步通过并记录 validate 原文。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同语义实现，同一命令序列得到相同文档（逐字节）。
