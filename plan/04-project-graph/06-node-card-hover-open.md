# 06 节点卡片、悬停摘要与打开文档

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`02-graph-data-contract.md`、`03-graph-view-shell.md`、`11-triggers-rules-events/01-trigger-identity.md`

## 1. 职责

**参考输入**：[Olive项目浏览与节点画布](../references/05-project-graph-navigation.md) G1/G7。卡片只发选择/打开意图，由同一未保存守卫处理；悬停/选择不重载脚本，不修改依赖。依赖编辑仍在04.11的独立受控对话框，不能塞进本浮层。

定义单个脚本节点的呈现与两种交互：**悬停给关键信息**（不点也能判断这个脚本是什么）、**点击进入文档**（并让文档停在正确的位置）。只管节点这一层，不管分区（04）、布局（05）、依赖边（07）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 节点类型 | `ED:graphLayout.ts:33-63`（`GraphNode`）、`:88-105`（`LaidOutNode`） | 含 `name/author/description/dimension/priority/duration/infinite/valid/error/tracks/triggers/requires` |
| 悬停状态 | `ED:components/ScriptGraph.vue:33-38`、`:233-237` | `hoverId/hoverX/hoverY`；`onNodeEnter` 只记位置 |
| 悬停浮层定位 | `ScriptGraph.vue:145-154`（`tooltipStyle`） | 固定宽 320；贴边钳制 |
| 悬停内容 | `ScriptGraph.vue:344-380`（模板区） | 名称/路径/时长/轨道/触发器/requires/说明/维度/作者/错误 |
| 时长文案 | `ScriptGraph.vue:256-258`（`durationText`） | `infinite ? '∞' : duration.toFixed(1)+'s'` |
| 轨道文案 | `ScriptGraph.vue:260-262`（`trackText`） | `type×clips` 用 ` · ` 连接 |
| 单击 | `ScriptGraph.vue:229-231`（`onNodeClick`） | 再次点击取消选中 |
| 双击打开 | `ScriptGraph.vue:239-248`（`onNodeOpen`） | `loadScript(n.path)` 后 `viewMode = 'editor'` |
| 打开前置 | `ED:store.ts:400-418`（`loadScript`） | 设 `currentPath/doc`、`resetHistory`、`initTrackView`、`loadTimelineExtras`、`maintainInvariants`、`selectFirstCameraClip`、`pushScript`、`seek(0)` |
| 未连接 | `ScriptGraph.vue:240-243` | 未连接时提示「未连接模组：无法打开脚本」 |
| 选中高亮 | `ScriptGraph.vue:69-98`（`related`）、`:100-138`（`nodeStates`/`edgeStates`） | 沿边双向 BFS，上游 `up`、下游 `down` |

**关键事实**：`loadScript` 会**重置播放头到 0**（`seek(0)`）并推脚本，因此「从图打开」= 一次完整装载，不是「切到已打开的标签」。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 卡片信息 | 名称 + 路径（模板内） | 名称、脚本 id（与文件名不同时并列）、时长、轨道缩略、触发器数、校验状态点 |
| 悬停触发 | 立即显示 | 250ms 延迟（避免扫过时闪烁）；移出即隐藏 |
| 悬停内容 | 已较全 | 增加：触发器 `identity` + 类型 + repeatable + 是否 `on_enter` + 是否有 `continuity`；`requires` 带解析状态；`refsOut` 反向计数（被谁引用） |
| 悬停交互 | 纯展示 | 增加两个按钮：「打开」「在文档中定位到触发器」（后者仅在有 `requires` 时出现） |
| 打开 | 双击 | 双击 + 悬停按钮 + 键盘 `Enter`（选中时） |
| 打开后位置 | 一律 `seek(0)` + 选中第一个 CAMERA 片段 | 保持现状（不发明「记住上次片段」），但**从依赖边跳转时**需要「定位到触发器」寻址（见 3.2） |
| 打开中状态 | 无 | 双击后卡片显示 loading，失败恢复并提示 |
| 校验状态 | 仅 `valid` + 悬停里的 `error` | 卡片角标：红点（`valid=false`）/ 黄点（有 warning 关联） |

### 3.2 「定位到触发器」寻址（提案）

从依赖边或悬停按钮跳到文档时，目标不是「打开脚本」而是「打开并滚到某触发器的 requires」。这需要一个稳定的文档内寻址参数：

```
openScript(path, { focus?: { kind: 'trigger', identity: string } })
```

- `identity` 用 02 轮定义的合成规则（`id ?? type#index`），与 `TriggerDefinition.getIdentity()` 同构。
- 文档侧（05 轮顶栏 + 11 轮触发器面板）负责消费该参数：选中对应触发器、滚动到 requires 区块、短暂高亮。
- 若 `identity` 找不到（脚本已改），退化为「只打开脚本」并提示「触发器已不存在」。

**这是新增的**前端内部约定，不是新消息；`script.load` 的消息形状不变（`WebEditorApi.java:111-123`）。

### 3.3 拟新建（提案）

- `ED:components/graph/NodeCard.vue`（提案）：卡片本体 + 状态角标 + loading 态。
- `ED:components/graph/NodeTooltip.vue`（提案）：浮层内容与两个动作按钮；纯展示，不含编辑控件。
- `ED:components/graph/nodeSummary.ts`（提案）：把 `GraphNode` 映射为「展示行」数组（label/value/severity），供卡片与浮层共用。理由：模板里堆 `v-if` 会两处重复同一套字段口径。
- `ED:store/openDocument.ts`（提案）：`openScript(path, focus?)` 封装 `loadScript` + `viewMode` + `pendingFocus` 传递。

**不新建**：`graph.node.edit` 之类消息。图上不改脚本内容。

## 4. 输入输出与字段约束

`NodeCard` props：`node: LaidOutNode`、`state: {matched,dim,up,down,hidden}`、`opening: boolean`。emits：`open`、`select`。

`NodeTooltip` props：`node: LaidOutNode`、`style: CSSProperties`。emits：`open`、`focusTrigger(identity)`。

展示行口径（必须与数据源一致）：

| 行 | 来源字段 | 缺省呈现 |
|---|---|---|
| 名称 | `name`（Java 已回落为 `path`，见 `ScriptGraphService.java:376`） | 不显示空 |
| 脚本 id | `scriptId` | `null` → 「(缺少 meta.id)」+ 红点 |
| 路径 | `path` | 总是显示 |
| 作者 | `author` | 空 → 不显示 |
| 维度 | `dimension` | 空 → 「不限」 |
| 优先级 | `priority` | `0` → 不显示（避免噪音） |
| 时长 | `duration` / `infinite` | `infinite` → 「∞」；否则 `x.xs` |
| 轨道 | `tracks[]` | 空 → 「无轨道」 |
| 触发器 | `triggers[]` | 每项：`identity` · 类型 · `repeatable?` · `onEnter?` · `continuity?` |
| 前置依赖 | `triggers[].requires[]` | `script` 为空（自定义类型）→ 显示 `type` 并标「不成边」 |
| 被引用 | `refsIn`（提案：由 `refsOut` 反向聚合，Java 侧算） | 0 → 「无人依赖」 |
| 校验 | `valid` / `error` | `valid=false` → 红字错误摘要 |
| 图提示 | `warnings` 中 `nodeId === id` 的条目 | 最多 3 条 + 「还有 n 条」 |

约束：
- 浮层**不含**任何输入控件（不出现下拉、勾选、数字框）。唯一可点的是「打开」与「定位触发器」。
- 浮层宽度固定 320（与 `ScriptGraph.vue:147` 一致），内容超长用两行截断 + `title` 属性。
- 触发器行数 > 6 时折叠为「6 个触发器（展开）」——展开只在浮层内，不改数据。

## 5. 修改步骤

1. 新建 `nodeSummary.ts`，把 `ScriptGraph.vue:344-380` 的模板字段搬进去，字段口径按上表。
2. 新建 `NodeCard.vue` / `NodeTooltip.vue`，替换 `ScriptGraph.vue:344-380` 的内联节点与浮层。
3. 悬停加 250ms 延迟：`onNodeEnter` 设 timer，`onNodeLeave` 清除（`ScriptGraph.vue:233-237` 目前只有 enter）。
4. 新建 `openDocument.ts`：`openScript(path, focus)` 包装 `loadScript`（`store.ts:400-418`），并写 `pendingFocus`（提案，`store` 内一个 `ref`）。
5. 双击、`Enter`、浮层「打开」统一走 `openScript`。
6. 失败路径：`loadScript` reject 时清 `opening`、显示错误横幅，**不**切视图。
7. 角标：`valid=false` 红点；`warnings` 关联黄点（`02` 的 `warnings[].nodeId`）。

## 6. 禁止修改

- 不得在浮层里放编辑控件（包括「改触发器」「加 requires」）。图内受控依赖维护只走04.11独立对话框，完整触发器/轨道/片段内容编辑只在文档内。
- 不得改 `loadScript` 的装载流程（`seek(0)`、`pushScript`、`selectFirstCameraClip` 是既有约定；05 轮才讨论顶栏与播放头策略）。
- 不得把「双击打开」改成「单击打开」（单击用于高亮上下游）。
- 不得在节点上渲染轨道条/关键帧/缩略图（图不编辑具体轨道）。
- 不得让悬停浮层挡住节点导致无法点击（必须 `pointer-events: none` 于内容容器、按钮区除外）。

## 7. 两分支承载

- Forge 1.20.1：前端 + common 数据字段；无平台差异。
- Fabric：同源，未实机验证。

## 8. 前置

- `02-graph-data-contract.md` 提供 `identity` / `refsOut` / `warnings[].nodeId`。
- `03-graph-view-shell.md` 的 `graphView.selectedId`。
- `11-triggers-rules-events/01-trigger-identity.md` 确认 `identity` 的展示口径（两轮同一字符串）。
- `05-timeline-workspace` 确认文档侧能接收 `focus` 参数（若该轮未实现，本任务只写 `pendingFocus` 并提示「暂不支持定位」）。

## 9. 验收

**正例**

- 悬停 `a.json`：250ms 后出现浮层，含名称、脚本 id、路径、时长、轨道 `CAMERA×3`、触发器 2 条（含 `identity` 与 repeatable 标记）、前置依赖 `b`、被引用计数、校验状态。
- 悬停一个缺 `meta.id` 的脚本：脚本 id 行显示「(缺少 meta.id)」+ 红点；仍可双击打开（文档里可补 id）。
- 悬停一个写坏 JSON 的脚本：浮层显示 `error` 摘要；双击打开会失败并提示，不切视图。
- 单击选中后按 `Enter`：打开该脚本。
- 浮层点「打开」：与双击等价。
- 从依赖边跳转（07）带 `focus`：文档打开并定位到对应触发器的 requires；找不到时只打开并提示。

**反例**

- 浮层里出现「编辑」控件 → 失败。
- 悬停扫过一排节点时浮层频繁闪烁 → 失败（必须有延迟与移出取消）。
- 双击失败后视图已切到文档且空白 → 失败。
- 触发器 `identity` 与文档内触发器面板显示的 id 不一致 → 失败。

## 10. 真实冒烟

1. 造 6 个脚本，其中一个缺 `meta.id`、一个 JSON 写坏、一个带 3 个触发器与 2 条 `requires`。
2. 依次悬停：浮层字段与文件内容一致；坏脚本不崩。
3. 双击正常脚本：进入文档，`currentPath` 正确，播放头在 0，预览有一帧。
4. 返回图，按 `Enter` 打开另一个脚本：同样成功。
5. 双击坏脚本：错误横幅，仍在图视图。
6. 带 `focus` 打开带触发器脚本：滚动到 requires（若 05 轮未实现则看到「暂不支持定位」提示）。

## 11. 完成定义

- 悬停信息项与上表逐行对应，缺省呈现规则一致。
- 三种打开入口（双击/Enter/浮层按钮）行为一致且失败不切视图。
- 卡片无任何轨道编辑控件。
- `identity` 与 `TriggerDefinition.getIdentity()` 同构，且文档侧显示一致。
