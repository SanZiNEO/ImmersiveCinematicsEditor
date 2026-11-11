# 03 图视图外壳与入口

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`README.md`、`04-folder-partitions.md`、`06-node-card-hover-open.md`、`09-remove-legacy-script-list.md`

## 1. 职责

定义「项目页」这一层视图的壳：画布容器与坐标变换、工具栏、空状态与错误状态，以及图自身的视图状态（缩放/平移/选中/过滤）。**不管**顶层视图切换与「从图进入文档」的路由——那归 `../05-timeline-workspace/05-09-GraphEntry.md`（`viewRouter.ts`、未保存守卫、`ProjectView`/`DocumentView`）；也不管节点内容（06）、分区（04）、布局算法（05）。

> 归属约定：`viewMode` 这一旧状态由 05-09 替换为 `project`/`document` 两态路由器。本文件只描述「项目页内部」的状态，不定义顶层状态机，也不改 `TitleBar` 的视图菜单（由 05-09 删除）。

**参考输入**：[Olive项目浏览与节点画布](../references/05-project-graph-navigation.md) G1–G3/G7。借鉴导航/打开分工、平移优先、指针锚定缩放与选区反馈隔离；不搬素材树、Qt事件或基类空缩放实现，图选择不能触发文档重载/seek。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 顶层视图状态 | `ED:store.ts:92` | `export const viewMode = ref<'editor' \| 'graph'>('editor')` |
| 默认视图 | `store.ts:92` | 默认 `'editor'`（文档视图），不是图 |
| 视图切换入口 | `ED:components/TitleBar.vue:38-41`（`setView`）、`:80-90` | 「视图」菜单两项 + 一键切换；文案「脚本架构图」/「返回编辑器」 |
| 视图分支渲染 | `ED:App.vue:329`（`v-if="viewMode === 'editor'"`）、`:390`（`<ScriptGraph v-else />`） | 二选一，互斥 |
| 图视图根 | `ED:components/ScriptGraph.vue:288-296` | `.graph-view` + `.graph-toolbar` |
| 画布与变换 | `ScriptGraph.vue:322-341`、`:141-143`（`worldStyle`） | 单个 `div.world` 承载 `translate + scale` |
| 平移 | `ScriptGraph.vue:206-227` | 左键空白 / 中键任意处拖拽；`window` 级 `mousemove/mouseup` |
| 缩放 | `ScriptGraph.vue:185-204` | 滚轮指数缩放，范围 0.15–2.5；指针锚定 |
| 适配视图 | `ScriptGraph.vue:156-167`（`fit`） | 首次加载后 `nextTick` 调一次 |
| 键盘 | `ScriptGraph.vue:250-253`、`:265-268` | `Esc` 取消选中；挂到 `window` |
| 加载 | `ScriptGraph.vue:168-183`（`load`） | `request('script.graph')`，失败文案区分「未连接」与「读取失败」 |
| 提示横幅 | `ScriptGraph.vue:300-320` | 错误横幅 + `<details>` 警告列表（前 50 条） |
| 工具栏统计 | `ScriptGraph.vue:310-313` | `{{nodes}} 脚本 · {{edges}} 依赖 · {{folders}} 分区` |

**关键事实**：`viewMode` 只有两个值，且默认进文档视图；图视图内部自己发请求、自己 `fit()`，没有「上次视图/上次画布位置」的记忆。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 顶层视图 | `viewMode` 两值、默认 `'editor'` | 由 05-09 的 `viewRouter` 改为 `project`/`document`；本文件不改这一层 |
| 图内状态 | 全在 `ScriptGraph.vue` 的 `ref` | 迁到 `graphView.ts`，跨「项目 ↔ 文档」保留 |
| 入口文案 | 「脚本架构图」 | 由 05-09 改为「项目」；本文件不改 `TitleBar` |
| 画布状态记忆 | 无 | 记住 `scale/tx/ty`（与布局元数据同存，见 05） |
| 加载态 | `loading` 文案「扫描中…」 | 保留；增加骨架占位，避免空画布闪一下 |
| 错误态 | 横幅 | 保留；增加「重试」按钮（`load()` 已可重入） |
| 空项目 | 空画布 + `0 脚本` | 空状态卡片：「还没有脚本 → 新建」 |
| 工具栏 | 刷新/搜索/过滤/缩放/统计/提示 | 增加「新建文件夹」「新建脚本」；移除与文档重复的按钮（保存/校验） |
| 返回文档 | 文档内「← 项目」 | 由 05-09 的 `DocumentView` 提供；本文件只保证图状态可恢复 |

### 3.2 拟新建（提案）

- `ED:components/graph/GraphShell.vue`（提案）：只负责 `.graph-view` 外壳、工具栏插槽、加载/错误/空状态；把画布与坐标变换留在 `ScriptGraph.vue`。
  - 理由：`ScriptGraph.vue` 已 644 行且混装数据请求、布局、交互、模板；再加文件夹维护与布局持久化会不可维护。
- `ED:store/graphView.ts`（提案）：`viewState = reactive({ scale, tx, ty, selectedId, query, triggerFilter, folderFilter, onlyMatches })`。
  - 理由：画布状态要在「图 ↔ 文档」之间往返后保留，不能随组件卸载丢失。
- `ED:components/graph/GraphEmptyState.vue`（提案）：空项目/全过滤为空两种文案。

**不新建**：路由库。两个视图由 05-09 的两态路由器切换，引 vue-router 会带来 URL 语义与 Electron file:// 适配成本。

## 4. 输入输出与字段约束

`GraphShell` props：

| 字段 | 类型 | 约束 |
|---|---|---|
| `loading` | `boolean` | `true` 时工具栏刷新按钮禁用、画布显示骨架 |
| `error` | `string` | 非空时显示横幅 + 「重试」 |
| `stats` | `{nodes:number, edges:number, folders:number}` | 仅展示，不做计算 |
| `empty` | `boolean` | `stats.nodes === 0` 且无过滤条件时为 `true` |

`GraphShell` emits：`refresh`、`new-folder`、`new-script`。

`graphView` 状态：

| 字段 | 类型 | 约束 |
|---|---|---|
| `scale` | `number` | `0.15 ≤ scale ≤ 2.5`（与 `ScriptGraph.vue:191` 同界） |
| `tx` / `ty` | `number` | 像素；持久化时按 `scale` 归一存储（避免不同 DPI 下漂移） |
| `selectedId` | `string \| null` | 必须是当前 `nodes[].id`；节点消失时置 `null` |
| `query` / `triggerFilter` / `folderFilter` | `string` | 空串 = 不过滤 |
| `onlyMatches` | `boolean` | 仅在 `hasFilter` 为真时生效（与 `ScriptGraph.vue:57-67` 同口径） |

约束：
- 视图状态**不进脚本**、不进图数据回执。
- 视图状态恢复必须容错：`selectedId` 不在新数据里就丢弃；`scale` 越界就钳制。

## 5. 修改步骤

1. 抽出 `GraphShell.vue`，`ScriptGraph.vue` 的模板拆为：外壳（工具栏/横幅/空状态）+ 画布（`viewport`/`world`）。
2. 新建 `store/graphView.ts`，把 `ScriptGraph.vue:28-41`（`viewport/scale/tx/ty/panning/selectedId/hover*/query/triggerFilter/folderFilter/onlyMatches`）迁出。
3. `fit()` 改为「无保存的视图状态时才自动适配」，否则恢复保存值（`ScriptGraph.vue:156-167`）。
4. 空状态：`stats.nodes === 0` 时渲染 `GraphEmptyState`，画布仍可平移（不要整块替换成占位图，否则用户以为坏了）。
5. 工具栏补「新建文件夹」「新建脚本」（emits 由 04/04 与 05-02 消费）。
6. **不改** `store.ts:92` 的 `viewMode`、不改 `TitleBar.vue` 的视图菜单、不在本组件内切 `viewMode`——这些由 05-09 统一替换为 `viewRouter`。
7. 图内「打开节点」事件上抛给 05-09 的 `openDocument(path)`，不在本组件里直接 `loadScript`（06 定义事件载荷）。

## 6. 禁止修改

- 不得引入 vue-router 或第三视图。
- 不得在 `ScriptGraph.vue` 里直接写 `localStorage`（状态归 `graphView.ts`）。
- 不得在本文件范围内改 `viewMode`/`TitleBar`（05-09 的职责）。
- 不得删除 `Esc` 取消选中、滚轮缩放、拖拽平移这三条既有交互。
- 不得让图视图在未连接模组时崩溃；错误必须是可见文案（现有行为，`ScriptGraph.vue:176-181`）。

## 7. 两分支承载

- Forge 1.20.1：纯前端，与分支无关；`script.graph` 由 common 提供。
- Fabric：同源，未实机验证。

## 8. 前置

- `02-graph-data-contract.md` 的 `version` 字段（用于刷新按钮与 `unchanged` 短路）。
- `09-remove-legacy-script-list.md` 删除常驻列表后，`App.vue` 的 `body-row` 结构会变，本任务需在其后落。
- `../05-timeline-workspace/05-09-GraphEntry.md`：顶层两态路由器与未保存守卫。

## 9. 验收

**正例**

- 进入项目页：看到全部脚本；`stats` 三项与数据一致。
- 从图进入文档再返回：`scale/tx/ty` 与离开时一致，`selectedId` 仍是该脚本。
- 未连接模组：图显示「未连接模组：启动游戏内 WebUI 服务后再打开项目」，不白屏、不抛异常。
- 空项目（`scripts/` 为空）：显示空状态卡片与「新建脚本」，画布仍可拖拽。
- 过滤后无匹配且勾选「只看匹配」：显示「当前过滤无匹配」，不是空项目文案。

**反例**

- 图与文档同时可见 → 失败（05-09 的互斥约束；本组件不得自行渲染文档）。
- 切换视图后 `scale` 归 1 → 失败（必须保留）。
- 节点被删除后 `selectedId` 指向不存在的 id 且高亮残留 → 失败。
- `localStorage` 写入非法 JSON 导致启动崩溃 → 失败（必须 try/catch 回落缺省）。

## 10. 真实冒烟

1. 启动编辑器（未连模组）：项目页出现错误横幅与重试按钮；点重试仍失败但不崩。
2. 启动游戏内 WebUI 服务后点重试：图正常加载。
3. 缩放到 200%，平移，进入某脚本，返回：缩放与位置保持。
4. 关闭编辑器再打开：回到项目页（若上次停在文档则回文档，由 05-09 决定），画布位置与上次一致。
5. 清空 `localStorage`：回落自动适配。

## 11. 完成定义

- 图页内部状态保留、错误/空/加载三态齐备。
- `ScriptGraph.vue` 行数下降（壳与状态迁出），且不再直接读写 `localStorage`。
- 本文件未触碰顶层视图路由与 `TitleBar`。
- 未新增未登记消息；未引入新依赖。
