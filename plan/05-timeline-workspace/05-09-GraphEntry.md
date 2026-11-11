# 05-09 关系图独立入口与打开文档

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：04（图数据、布局、文件夹事务）、02（打开文档/未保存守卫）；同轮：05-02。
> 边界：图**本体**归 04；本文件只定义「入口位置、视图切换、从图进入文档、返回」这四个交互点。

## 1. 职责

把「项目页 ↔ 文档工作区」做成两个顶层视图，图不作为文档 tab、不参与脏标记；从图打开脚本是进入文档的唯一路径（除「新建」）。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/store.ts:92` | `export const viewMode = ref<'editor' \| 'graph'>('editor')` |
| `EDITOR:src/App.vue:329,389–393` | `v-if="viewMode === 'editor'"` 与 `v-else` 直接切整页 |
| `EDITOR:src/components/TitleBar.vue:39–43` | `setView('editor'\|'graph')` |
| `EDITOR:src/components/TitleBar.vue:78–84` | 视图菜单三项（编辑器/脚本架构图/左面板/右面板） |
| `EDITOR:src/components/ScriptGraph.vue:203–216` | `load()` 请求 `script.graph`；失败提示未连接 |
| `EDITOR:src/components/ScriptGraph.vue:298–312` | `onNodeOpen`：`await loadScript(n.path)` 后 `viewMode='editor'` |
| `EDITOR:src/components/ScriptGraph.vue:246–296` | 平移/缩放/选中/悬停 |
| `EDITOR:src/graphLayout.ts:129–147` | 节点尺寸/间距/分区常量（布局归 04） |
| `MOD:J:webui/ScriptGraphService.java` | 图数据：`nodes/edges/folders/warnings`（见 `MOD:plans/0.3.6/Z-editor/script-graph.md` §九） |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/app/viewRouter.ts` | `useViewRouter()` | `project` / `document` 两态 + 切换守卫（未保存） |
| `EDITOR:src/app/ProjectView.vue` | 组件 | 包住 04 的图组件，提供页面级骨架（标题、返回） |
| `EDITOR:src/app/DocumentView.vue` | 组件 | 包住 05 的五区工作区 |

## 4. 输入 / 输出 / 字段约束

**输入**：04 的图组件与「打开节点」事件；02 的未保存守卫；连接状态。

**输出**：`openDocument(path)`；`backToProject()`；视图状态（`project`/`document`）。

**约束**

| 项 | 约束 |
|---|---|
| 视图状态 | 只在内存（可选本地存储记住上次文档路径，但不自动打开）；**不写脚本** |
| 图不是 tab | 文档区没有「图」标签；顶栏「← 项目」与项目页「打开」是仅有的两个方向 |
| 打开语义 | 从图双击/回车节点 = `openDocument(path)`；脏文档先走 `05-02` 的三选一 |
| 返回语义 | 文档「← 项目」= `backToProject()`；同样走未保存守卫 |
| 图内编辑 | 图只做 04 允许的三类事务（布局/文件移动/依赖维护）；不提供轨道/片段/属性节点编辑 |
| 深链 | 不支持「URL 打开某脚本」（Electron 单机工具）；不做浏览器历史 |
| 加载失败 | 图数据失败显示错误 + 重试；文档打开失败留在项目页并提示 |

## 5. 修改步骤

1. 新建 `viewRouter.ts`：替换 `store.ts:92` 的 `viewMode`；`setView` 变成 `openProject()/openDocument(path)`，内部先过未保存守卫。
2. 新建 `ProjectView.vue` / `DocumentView.vue`：`App.vue` 只保留 `<ProjectView v-if>` / `<DocumentView v-else>`。
3. 删除 `TitleBar.vue:78–84` 的「编辑器/脚本架构图」菜单项与一键切换按钮（菜单只留文件/编辑/视图中的布局项）；入口收敛到顶栏「← 项目」与项目页节点。
4. `ScriptGraph.vue:298–312` 的 `onNodeOpen` 改调 `viewRouter.openDocument(path)`，删除组件内直接 `viewMode='editor'`。
5. 删除 `App.vue` 中 `viewMode` 的 import 与条件渲染（329、389–393）。
6. 项目页标题区显示「项目：<根目录>」与脚本/依赖计数（来自 04 的图数据），不显示文档内容。

## 6. 禁止修改

- 不改 `script.graph` 协议与 `ScriptGraphService`。
- 不实现图布局算法（04）、文件夹移动（04）、依赖维护（04/11）。
- 不在图里加「快速预览轨道」之类越界面板。
- 不保留第二个「打开脚本」入口（`window.prompt`、最近文件列表若做也必须走 `openDocument`）。

## 7. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | 项目页占满窗口；文档页可返回；支持键盘 `Esc` 返回（无未保存时） |
| 游戏内 Forge/AUI | 项目页与文档页共用同一窗口；返回按钮放在顶栏最左且加大命中区；不支持浏览器后退键 |

## 8. 前置

04 的图组件与「节点打开」事件；02 的未保存守卫（`05-02` 的 `unsavedGuard`）。

## 9. 验收

**正例**

1. 启动进入项目页（不是空白编辑器）；点节点 → 进入文档；「← 项目」→ 回图，图保持上次平移/缩放（04 的视图状态）。
2. 脏文档点「← 项目」→ 三选一；取消 → 留在文档，图不切。
3. 图里双击节点 → 打开对应脚本；文档顶栏显示该脚本名与脏状态。
4. 图数据加载失败 → 项目页显示错误 + 重试，不自动打开任何脚本。
5. 文档打开失败 → 留在项目页，提示路径与原因。

**反例**

1. 文档里出现「架构图」tab → 不通过。
2. 图与文档同时显示（分屏）→ 不通过（本轮不做）。
3. 切换视图时静默丢弃脏文档 → 不通过。
4. 保留两个打开入口且行为不一致 → 不通过。

**真实冒烟**：WebUI 连真机，项目页 → 打开 → 编辑 → 返回 → 再打开（本轮出口）；游戏内 Forge 复测 1–3 属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 视图只有两态，切换只有一个守卫。
- 图不是文档 tab，入口唯一。
- `viewMode` 旧引用全部清除。
- 打开/返回在断连时仍可用（图数据失败只影响图）。
