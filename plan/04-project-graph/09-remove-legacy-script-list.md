# 09 取消常驻最左脚本列表

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`03-graph-view-shell.md`、`README.md`、`../05-timeline-workspace/README.md`

## 1. 职责

删除编辑器里**常驻**的两块最左区域——脚本列表与 JSON 文本列——并把它们承担的功能明确交接到唯一入口（关系图）与文档顶栏。目标是「找脚本只有一个地方」，同时不留下功能空洞。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 最左 JSON 列 | `ED:App.vue:329-333` | `<aside class="json-column" :style="{width: jsonColWidth+'px'}"><ScriptDock/></aside>` |
| JSON 列宽度状态 | `App.vue:23`、`:55`、`:75-78` | `jsonColWidth` 参与拖拽与左面板边界计算 |
| 左面板脚本页 | `App.vue:29-33`（`leftTabs`）、`:340-352` | `scripts` tab 内是 `<ScriptList/>` |
| 左面板默认页 | `App.vue:40` | `leftActiveTab = ref('scripts')` |
| 脚本列表组件 | `ED:components/ScriptList.vue:1-58` | 新建/保存/刷新按钮 + `<ul>` 按 `state.scripts` 列路径 + 删除 |
| JSON 文本组件 | `ED:components/ScriptDock.vue:1-19` → `ED:components/ScriptContent.vue` | 只做容器，内容是当前 `state.doc` 的 JSON 文本 |
| 脚本列表数据 | `ED:store.ts:344-348`（`refreshScripts`） | `script.list` → `state.scripts` |
| 打开脚本（prompt） | `ED:components/TitleBar.vue:21-35`（`openScriptByPrompt`） | 标题栏「打开」用 `window.prompt` 输入路径 |
| 脚本 CRUD | `store.ts:400-470`（`loadScript`/`newScript`/`saveScript`/`deleteScript`） | 保存会整文档覆盖 |
| 脏标记 | `store.ts:49`（`state.dirty`）、`:455` | 保存后清 |

**关键事实**：`ScriptList` 同时承担了「导航」与「文件操作（新建/保存/删除/刷新）」两件事。直接删组件会把文件操作一起删掉。

## 3. 差异与提案

### 3.1 功能去向（必须先定，再删）

| 现有能力 | 现状位置 | 新位置 | 归属轮次 |
|---|---|---|---|
| 列出全部脚本 | `ScriptList.vue` 的 `<ul>` | 关系图节点（按文件夹分区） | 04（本文件 + 04/06） |
| 打开脚本 | 点列表项 | 图上点击/双击节点 | 04/06 |
| 新建脚本 | `ScriptList` 的「新建」 | 图工具栏「新建脚本」+ 文档顶栏「新建」 | 04/03（图）、05（顶栏） |
| 保存 | `ScriptList` 的「保存」 | 文档顶栏「保存」（含 `Ctrl+S`） | 05 |
| 删除 | 列表项上的 `×` | 图卡片菜单「删除脚本…」 | 04/04（卡片菜单） |
| 刷新列表 | `ScriptList` 的「刷新」 | 图工具栏「刷新」 | 04/03 |
| 查看整脚本JSON | 旧常驻ScriptDock/ScriptContent | 按用户要求取消，不迁成新的源码抽屉；诊断只保留错误与字段定位 | 04/05 |
| 按路径打开 | `TitleBar` 的 `window.prompt` | **删除**（`05-02` 明确取消 `openScriptByPrompt`）；打开只从项目页/图进入 | 05 |

本任务删除旧常驻UI且不留导航/保存功能空洞；前置是本轮关系入口及02/03文档命令可用，不等待05新布局。用户明确取消的整脚本展示不需要另建替代页，避免04→05循环依赖。

### 3.2 拟新建（提案）

- 无新组件。**净删除**：
  - `ED:components/ScriptList.vue`（整文件删除）
  - `ED:App.vue` 的 `.json-column` 区块与 `jsonColWidth` 相关拖拽逻辑
  - `ED:App.vue` 的 `leftTabs` 中 `scripts` 项与对应模板分支
- ScriptDock/ScriptContent旧整脚本展示不迁到诊断源码子页；确认调用方迁移后删除，诊断只复制问题与定位路径。

### 3.3 布局影响

删除后 `App.vue` 的 `.body-row` 从「JSON 列 + 分隔条 + 工作区」变为「工作区」；`editor-top` 从左/中/右三栏变为「左面板 + 预览 + 右面板」，左面板默认 tab 改为 `tracks`（`App.vue:40`）。

`startDrag('json', …)` 与 `leftEdge = jsonColWidth + 4` 的计算（`App.vue:75-78`）必须同步删除，否则拖拽会基于一个不存在的边界。

## 4. 输入输出与字段约束

本任务不新增消息、不新增数据字段。

删除后必须仍然成立的约束：

| 约束 | 检查方式 |
|---|---|
| `state.scripts` 仍被填充（图之外的兜底/搜索需要） | `refreshScripts()` 仍被调用（`store.ts:344`） |
| `state.currentPath` 仍是唯一「当前文档」标识 | 无第二套选中状态 |
| 不存在第二处「脚本列表」UI | 全仓库 grep `ScriptList` 为 0；grep `state.scripts` 只出现在 store 与图数据/搜索处 |
| 左面板仍有可用默认页 | `leftActiveTab` 初值 `'tracks'` |
| `Ctrl+S` 等快捷键仍可用 | 由 05 轮顶栏承接；若 05 未落地，本任务不删 |

## 5. 修改步骤

1. 前置检查：04项目入口能新建/打开脚本，02/03保存/校验命令可用，现有顶栏有可达调用；无须等待05新布局或源码抽屉。先接好这些最小替代入口，再移除旧常驻栏。
2. 删除 `ED:components/ScriptList.vue`。
3. `App.vue`：删除 `:329-333` 的 `<aside class="json-column">` 与其后分隔条（`:334`）；删除 `jsonColWidth` 声明（`:23`）、初始分配（`:55`）、`startDrag('json', …)` 分支与 `leftEdge` 计算（`:75-78`）。
4. `App.vue`：`leftTabs` 去掉 `scripts` 项（`:29-33`）；模板去掉 `v-if="leftActiveTab === 'scripts'"` 分支（`:347-351`）；`leftActiveTab` 初值改 `'tracks'`（`:40`）。
5. 删除常驻列专用ScriptDock和旧ScriptContent，清理引用；不以05源码子页为保留理由。
6. 图工具栏的新建调用02/03已交付文档命令，不等待05标题栏重排；05只复用该命令，不形成04→05倒序前置。
7. **不保留** `TitleBar.vue` 的 `window.prompt` 打开入口——`05-02` 明确删除 `openScriptByPrompt()`；本任务不另造第二个打开入口。

## 6. 禁止修改

- 不得保留「折叠的脚本列表」——折叠仍是常驻，问题没解决。
- 不得在图上再造一个脚本列表面板。
- 不得删除 `state.scripts` / `refreshScripts()`（图数据与搜索仍可能需要）。
- 不得顺手改 `loadScript` 的装载流程。
- 不得在 05 轮未提供替代入口前删除文件操作按钮（会造出功能空洞）。

## 7. 两分支承载

- 纯前端，与分支无关。
- Fabric：同源，未实机验证。

## 8. 前置

- **硬前置**：`05-timeline-workspace` 的文档顶栏提供新建/保存/删除（或至少新建/保存）。
- `03-graph-view-shell.md` 提供图工具栏「新建脚本」。
- `04-folder-partitions.md` 提供卡片菜单「删除脚本…」。

## 9. 验收

**正例**

- 打开编辑器：左侧不再有脚本列表与 JSON 列；`body-row` 直接从工作区开始。
- 新建脚本：图工具栏可新建；进入文档后顶栏可保存。
- 删除脚本：图卡片菜单可删除，删除后图刷新。
- 拖拽分隔条：只剩「左面板 / 右面板 / 时间轴」三个可拖边界，行为正常（无幽灵边界）。
- 全仓库 grep `ScriptList`：0 命中（或仅剩注释）。

**反例**

- 删除后无法新建/保存脚本 → 失败（功能空洞）。
- 左面板默认停在空白 tab → 失败。
- 拖拽左面板时按 `jsonColWidth` 计算导致跳动 → 失败。
- 图上出现第二份脚本列表 → 失败。

## 10. 真实冒烟

1. 启动编辑器，确认无脚本列表/JSON 列。
2. 图 → 新建脚本 → 文档 → 编辑 → `Ctrl+S` 保存 → 返回图：节点出现。
3. 图 → 删除该脚本 → 节点消失，`script.list` 不再包含。
4. 拖动左/右/时间轴三条边界：无异常跳动。
5. 打开已有脚本，确认源码仍可查看（通过 05 轮抽屉）。

## 11. 完成定义

- 常驻脚本列表与常驻 JSON 列在代码中不存在（文件删除或引用归零）。
- 新建/保存/删除/刷新四项能力都有明确且可用的新入口。
- 无幽灵拖拽边界、无空白默认 tab。
- 不存在第二套脚本导航。
