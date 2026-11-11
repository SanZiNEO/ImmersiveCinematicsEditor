# 10 刷新、规模与图数据诊断

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`01-script-index.md`、`02-graph-data-contract.md`、`03-graph-view-shell.md`

## 1. 职责

定义图数据什么时候重取、重取多大、数据坏了怎么让人看见。包含刷新策略（全量/短路）、规模阈值与降级、warnings 的呈现与跳转。不负责布局重算（05）与边语义（07）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 全量重扫 | `MOD:webui/WebEditorApi.java:232-242`（`handleScriptGraph`） | 每次请求都 `ScriptGraphService.buildGraph()`；注释明确「全量重扫（无增量）」 |
| 请求时机 | `ED:components/ScriptGraph.vue:168-183`（`load`）、`:264-267`（`onMounted`） | 挂载时一次；工具栏「刷新」手动一次 |
| 保存后 | 无刷新 | `store.ts:436-457`（`saveScript`）只写盘 + 清 dirty，不通知图 |
| 删除后 | 无刷新 | `store.ts:459-462`（`deleteScript`）刷新 `state.scripts`，不刷新图 |
| warnings 上限 | `MOD:webui/ScriptGraphService.java:41`（`MAX_WARNINGS = 200`） | 超出静默丢弃 |
| warnings 呈现 | `ED:components/ScriptGraph.vue:300-320` | `<details>` 折叠，前 50 条 |
| 后端日志 | `WebEditorApi.java:235-238` | `script.graph nodes=… edges=…` |
| 渲染方式 | `ScriptGraph.vue:322-341`（HTML 节点）+ `:343-360`（SVG 边） | 同一 `transform` 世界层 |
| 实测规模 | `plans/0.3.6/Z-editor/script-graph.md` §九 | 「实测规模仅 11 节点」 |

**关键事实**：保存/删除/新建都不会让图失效——作者改完必须手动点「刷新」，否则看到的是旧数据。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 保存后 | 图不更新 | 标记脏 + 自动重取（或提示「有更新，点击刷新」） |
| 重取粒度 | 全量 | 全量 + `sinceVersion` 短路（版本未变则不动） |
| 规模 | 无阈值 | 节点 ≤ 200 直接全量渲染；> 200 时按文件夹懒渲染（提案，未实现前给警告） |
| warnings | 折叠列表前 50 | 分组（error/warn）+ 点击定位到节点 + 「复制全部」 |
| 诊断出口 | 只有 `warnings` | 增加 `stats`（节点/边/文件夹/坏脚本数/最大扇出） |
| 后端日志 | 每次一行 | 保留；增加耗时毫秒 |

### 3.2 刷新策略

三种触发，全部走同一条 `load()`：

1. **挂载**：进入图视图时。
2. **手动**：工具栏「刷新」。
3. **失效通知**（提案）：`script.save` / `script.delete` / `script.new` / `script.move` / `script.folder.*` / `script.refs.apply` 成功后，服务端广播 `script.graph.invalidated {version}`（提案，需登记）；前端收到后置 `stale = true`，在工具栏显示「有更新 · 刷新」角标。**不自动重取**，避免每次保存都重建整图并打断作者当前的选中/平移。

理由：自动重取会让「保存 → 图跳动」变成常态；角标提示既不失真也不打断。

### 3.3 规模阈值与降级

| 规模 | 行为 |
|---|---|
| `nodes ≤ 200` | 现状：HTML 节点 + SVG 边，全量 |
| `200 < nodes ≤ 800` | 关闭悬停浮层的富文本（只显示名称 + 关键 3 行）；边使用简化路径（直线） |
| `nodes > 800` | 只渲染当前可见文件夹泳道（视口裁剪）；顶部提示「大项目：已启用按文件夹渲染」 |

阈值来源：`NODE_W=196`、`COL_W=272`（`ED:graphLayout.ts:129-137`）意味着 200 节点在 4 泳道下已是约 50 列 × 4 行，滚动成本明显。800 是保守上限，实测后调整。

**未实现前的行为**：`nodes > 800` 时只给提示，不阻止渲染。

### 3.4 拟新建（提案）

- `MOD:webui/ScriptGraphService.java` 增加 `stats`（提案）：`{nodes, edges, folders, invalid, warnings}`。
- `MOD:webui/WebEditorApi.java` 增加 `script.graph.invalidated` 广播（提案）：在 `handleScriptSave` / `handleScriptDelete` / `handleScriptNew` / 移动 / 文件夹 / 引用事务成功后调用 `WebEditorServer.INSTANCE.broadcastText(...)`（锚点：`WebEditorApi.java:368-378` 的 `pushPlaybackState` 已示范广播用法）。
- `ED:components/graph/GraphWarnings.vue`（提案）：分组列表 + 点击定位 + 复制。
- `ED:components/graph/GraphStats.vue`（提案）：统计条。

**不新建**：增量 diff 协议（如 `graph.patch`）。在 200 节点量级，全量 JSON 只有几十 KB，增量协议的成本（版本对账、乱序、丢事件）远大于收益。若将来超过 2000 节点再议。

## 4. 输入输出与字段约束

`script.graph` 回执增加（在 02 基础上）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `stats.nodes` | `int` | 等于 `nodes.length` |
| `stats.edges` | `int` | 等于 `edges.length` |
| `stats.folders` | `int` | 等于 `folders.length` |
| `stats.invalid` | `int` | `valid === false` 的节点数 |
| `stats.warnings` | `int` | warnings 总数（可能 > 200，因为上限只截断输出；这里给**未截断**计数） |
| `stats.truncated` | `boolean` | warnings 是否被截断 |

`script.graph.invalidated` 广播：

```json
{ "type": "script.graph.invalidated", "data": { "version": 13 }, "id": "" }
```

| 字段 | 约束 |
|---|---|
| `version` | 与下一次 `script.graph` 回执的 `version` 一致 |
| 频率 | 每次写操作一条；同一批写操作（如引用事务写 3 个文件）只发一条 |

约束：
- 广播是**建议性**的：前端可以忽略（离线、正在拖拽）；不能作为唯一刷新机制。
- `stats.warnings` 是真实计数，`warnings[]` 可能被截断——UI 必须显示「显示 200 / 共 512」。
- 渲染降级不得改变布局坐标（否则手摆位置会漂移）。

## 5. 修改步骤

1. `ScriptGraphService.buildGraph` 增加 `stats`（含截断前后计数）。
2. `WebEditorApi` 各写操作分支成功后广播 `script.graph.invalidated`（锚点见 3.4）。
3. 前端 `store.ts` 的 `handleMessage` 增加该类型分支（锚点 `store.ts:299-341`），设置 `graphView.stale = true`。
4. `GraphShell` 工具栏：`stale` 时刷新按钮加角标与文案「有更新」。
5. `GraphWarnings.vue`：分组、点击 → `graphView.selectedId = nodeId` + 居中（复用 `fit` 的居中逻辑，需新增 `centerOn(nodeId)`）。
6. 规模降级：`ScriptGraph.vue` 渲染前按 `stats.nodes` 选择三档模式；`> 800` 时按视口裁剪泳道。
7. 后端日志补耗时：`System.nanoTime()` 差值。

## 6. 禁止修改

- 不得把刷新做成「保存即重取」（会打断选中/平移/拖拽）。
- 不得为增量刷新发明 `graph.patch` 协议。
- 不得在 warnings 截断时假装完整（必须给真实计数）。
- 不得让渲染降级改变 `x/y` 坐标（布局与渲染必须解耦）。
- 不得在前端本地推导 warnings（必须由 Java 侧给出，口径与 `ScriptManager` 加载期校验一致）。

## 7. 两分支承载

- Forge 1.20.1：common + 前端；广播走既有 `WebEditorServer.broadcastText`。
- Fabric：同源，未实机验证。

## 8. 前置

- `01-script-index.md`（`version`）。
- `02-graph-data-contract.md`（`warnings[].nodeId` / `severity`）。
- `shared/contracts.md` 登记 `script.graph.invalidated`。

## 9. 验收

**正例**

- 打开图 → 改一个脚本并保存 → 工具栏出现「有更新」角标，图不跳动；点刷新后角标消失、节点时长更新。
- 一次引用事务写 3 个文件：只收到 1 条 `invalidated`。
- 造 512 条 dangling：`stats.warnings = 512`、`stats.truncated = true`，UI 显示「显示 200 / 共 512」。
- 点 warnings 中的一条：图滚动/居中到对应节点并选中。
- `nodes = 250`：悬停浮层变精简；布局坐标与 200 节点时同一节点一致。

**反例**

- 保存后图立即重取并重置平移 → 失败。
- 广播每写一个文件发一条（3 条）→ 失败（应合并）。
- `stats.warnings` 被截断成 200 → 失败。
- 降级模式改变了节点 `x/y` → 失败。

## 10. 真实冒烟

1. 打开图，记下平移/缩放与选中节点。
2. 在文档里改脚本并保存，返回图：位置与选中不变，出现「有更新」。
3. 点刷新：数据更新，位置仍保留（布局来自 05 的 `overrides`）。
4. 手工把某脚本 `requires` 指向不存在 id，保存 → 刷新：`dangling` warning 出现，点击可定位。
5. 用脚本生成 300 个脚本，刷新：降级模式生效，滚动流畅（主观 + 无卡死）。

## 11. 完成定义

- 三种刷新触发都有明确行为，且保存不会打断视图状态。
- `stats` 与 `warnings` 截断口径一致且诚实。
- 规模降级不改变坐标。
- 未新增未登记消息。
