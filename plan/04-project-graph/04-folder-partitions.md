# 04 文件夹分区

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`01-script-index.md`、`02-graph-data-contract.md`、`05-layout-engine-and-persistence.md`、`08-move-rename-transaction.md`

## 1. 职责

把「文件夹」变成图上的第一等分类：分区布局、空文件夹、嵌套展平、折叠状态、文件夹级操作（新建/重命名/删除/作为移动目标）。不负责脚本与依赖的语义（02/07），也不负责节点卡片内容（06）。

**参考输入**：[Olive项目浏览与节点画布](../references/05-project-graph-navigation.md) G1/G5/G6。复用条目去重、明确目录目标、祖先保护与容器/连线刷新思想；拖放只传稳定路径/指纹，不能传进程内指针。普通卡片拖动仅改布局；只有菜单「移动到…」或明确文件移动手势才触发目录事务，不能拖过泳道就隐式改文件。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 分区数据 | `MOD:webui/ScriptGraphService.java:142-158` | `{path,count}`；`""` 为根；排序把根放最前 |
| 分区来源 | 同上 | **由节点 `folder` 反推**，空目录必然缺席 |
| 前端泳道 | `ED:graphLayout.ts:196-215` | `laneOrder` 按 `node.folder` 分组；`folders` 排序根在前、其余 `localeCompare` |
| 列对齐 | `graphLayout.ts:198-214` | `laneCols` 取各泳道最大列，保证跨泳道列对齐 |
| 泳道几何 | `graphLayout.ts:216-292` | `LANE_PAD=18`、`LANE_HEADER=30`、`LANE_GAP=26`；`laneH = HEADER + PAD*2 + maxRows*ROW_H - GAP_Y` |
| 分区标签 | `graphLayout.ts:143-145`（`folderLabel`） | `""` → `scripts`，其余原样 |
| 分区渲染 | `ED:components/ScriptGraph.vue:322-341` | 世界层内的 `.partition` 外框 + 标题 |
| 过滤 | `ScriptGraph.vue:52`（`folders`）、`:57-67`（`matches`） | 文件夹过滤用精确相等 `n.folder === folderFilter` |
| 目录深度 | `MOD:webui/ScriptFileService.java:35` | `Files.walk(…, 5)`；`ScriptManager.MAX_SCRIPT_DEPTH = 5` |

**关键事实**：`folder` 是「相对路径去掉最后一段」，因此 `a/b/c.json` 的 `folder` 是 `a/b`。泳道是**完全展平**的：不会出现「`a` 包含 `a/b`」的层级框。嵌套只体现在标签文字里。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 空文件夹 | 不出现 | 出现，标「空」，可接收移动 |
| 嵌套 | 展平为独立泳道，标签含完整路径 | 保持展平（不做递归框），但泳道按路径深度缩进标签并给出父路径 |
| 折叠 | 无 | 可折叠单个泳道（折叠时高度收缩为标题条，节点隐藏但边仍指向真实坐标——见下） |
| 文件夹操作 | 无 | 新建子文件夹 / 重命名 / 删除（仅空） |
| 移动目标 | 无 | 泳道整体是拖放目标；空泳道也接受 |
| 分区计数 | `count`（脚本数） | 增加 `childCount`（子目录数），标签显示 `n 脚本` / `m 子文件夹` |
| 根泳道 | 显示为 `scripts` | 显示为「项目根」，保留 `""` 作为 id |

### 3.2 折叠的几何处理（重要）

折叠不能只是 `display:none`：`graphLayout.computeLayout` 的输出是绝对坐标，边按 `from.x/w` 计算贝塞尔控制点（`graphLayout.ts:262-283`）。如果折叠后仍用原坐标画边，会出现「边指向空白」。

方案：折叠状态参与布局计算，折叠泳道只占标题高度；其内部节点保留逻辑坐标（用于边端点），但**端点吸附到折叠条**：`LaidOutEdge` 增加 `fromCollapsed`/`toCollapsed`，渲染时端点 y 取折叠条中心、x 取折叠条左右边缘。这样边仍然「从哪来、到哪去」可读。

### 3.3 拟新建（提案）

- `ED:components/graph/FolderLane.vue`（提案）：泳道外框、标题、折叠按钮、右键菜单、拖放目标。
- `ED:components/graph/FolderMenu.vue`（提案）：新建子文件夹 / 重命名 / 删除（禁用条件：非空）。
- `MOD:webui/ScriptFolderService.java`（提案）：目录级操作。
  - `public static void createFolder(String relativePath)` — `resolveSafe` 后 `Files.createDirectories`；已存在不报错。
  - `public static void renameFolder(String from, String to)` — 目标必须不存在；`Files.move`（同盘）；成功后 `ScriptIndexService.invalidate()`。
  - `public static void deleteFolder(String relativePath)` — 仅当目录为空（`Files.list` 计数为 0），否则抛 `IOException("folder not empty: …")`。
  - 三个方法都必须过 `resolveSafe` 同款校验，并拒绝 `""`（根不可改名/删除）。
- 消息（提案，需登记）：`script.folder.new` / `script.folder.rename` / `script.folder.delete`，回执 `script.folder.result`（`{path}` 或 `{from,to}`）。

**不新建**：目录树组件（如 el-tree）。泳道已经是树的一层投影，再叠一棵树会产生两套选中状态。

## 4. 输入输出与字段约束

`folders[]`（来自 02 的契约）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `path` | `string` | `""` = 根；否则 `/` 分隔、无首尾 `/`、深度 ≤ 4（与 `Files.walk(…,5)` 一致：根算第 0 层） |
| `parent` | `string \| null` | 根为 `null`；`""` 表示父是根 |
| `count` | `int` | 直接子 `.json` 数 |
| `childCount` | `int` | 直接子目录数 |
| `empty` | `boolean` | `count === 0 && childCount === 0` |

`FolderLane` props：`folder: Folder`、`collapsed: boolean`、`dropActive: boolean`。emits：`toggle`、`menu(action, folder)`、`dropScript(path)`。

折叠状态存放：`graphView.collapsedFolders: string[]`（提案，随布局元数据持久化，见 05）。

约束：
- 文件夹路径**不是**脚本 id 命名空间的一部分；改名文件夹不改变任何 `meta.id`。
- 删除文件夹只允许空目录；非空时 UI 禁用并提示「先移走 n 个脚本 / m 个子文件夹」。
- 重命名文件夹**不改写任何脚本内容**（`requires` 引用脚本 id，与路径无关）。这一点必须写进 UI 文案，避免作者误以为要跑引用事务。

## 5. 修改步骤

1. `ScriptIndexService.scanFolders` 产出 `Folder` 表（`01-script-index.md`）。
2. `ScriptGraphService.buildFolders` 合并目录表与节点计数（`02-graph-data-contract.md` 步骤 5）。
3. `graphLayout.computeLayout` 的泳道分组改为「以 `folders[]` 为准，节点按 `folder` 归入；找不到泳道的节点落到根并记 warning」（防数据不一致时节点消失）。锚点 `graphLayout.ts:196-215`。
4. 折叠：`computeLayout` 增加入参 `collapsed: Set<string>`；折叠泳道 `h = LANE_HEADER`，内部节点 `x/y` 仍计算但标记 `hiddenByCollapse`；边端点吸附（见 3.2）。
5. 新建 `FolderLane.vue` / `FolderMenu.vue`，替换 `ScriptGraph.vue:322-341` 的内联分区渲染。
6. `WebEditorApi` 增加三个 `script.folder.*` 分支（锚点 `WebEditorApi.java:41-88` 的 switch）。
7. 前端 `request('script.folder.new', {path})` 等，成功后 `load()` 重取图。

## 6. 禁止修改

- 不得把分区改为「按 `meta.dimension` 或 `priority` 分组」——分类维度是文件夹，不是元数据。
- 不得让空文件夹出现在 `nodes[]` 里（节点只能是脚本）。
- 不得允许删除非空文件夹，也不得「删除时连带删除脚本」。
- 不得让文件夹重命名触发 `requires` 改写（引用的是脚本 id）。
- 不得在泳道标题上放轨道/片段类操作。

## 7. 两分支承载

- Forge 1.20.1：`ScriptFolderService` 在 common，`Files.move/createDirectories` 无平台差异。
- Fabric：同源，未实机验证。

## 8. 前置

- `01-script-index.md`、`02-graph-data-contract.md` 完成。
- `shared/contracts.md` 登记 `script.folder.*` 三个消息与错误码（`folder not empty` / `invalid script path` / `folder exists`）。

## 9. 验收

**正例**

- 空项目 + 新建 `chapter`：泳道出现，标「空 · 0 脚本 · 0 子文件夹」。
- 用菜单「移动到…」或明确文件移动手势将 `a.json` 移到 `chapter` 泳道：文件移动到 `chapter/a.json`；`meta.id` 不变；`requires` 引用不变；图刷新后节点在 `chapter` 泳道。普通布局拖动不触发这项文件操作。
- 折叠 `chapter`：泳道高度变为标题条；指向/来自该泳道节点的边端点吸附到折叠条；展开后恢复。
- 重命名 `chapter` → `story`：目录改名；所有脚本内容**字节不变**；泳道标签更新。
- 删除空 `story`：成功；删除非空 `story`：UI 禁用，后端返回 `folder not empty`。

**反例**

- 拖到不存在的泳道导致文件写到根目录 → 失败。
- 删除非空文件夹把脚本一起删掉 → 失败（严重）。
- 重命名文件夹后某脚本 `requires` 被改写 → 失败（不该发生）。
- 折叠后边指向空白区域 → 失败。
- 节点 `folder` 在 `folders[]` 里找不到时节点消失 → 失败（必须落到根 + warning）。

## 10. 真实冒烟

1. `scripts/` 下建 `chapter/`、`chapter/boss/`，各放一个脚本。
2. 图：三条泳道（根、`chapter`、`chapter/boss`），标签正确，列对齐仍然成立（跨泳道依赖左→右）。
3. 折叠 `chapter`：视觉与边端点正确；折叠状态在重开编辑器后保持。
4. 移动根脚本到 `chapter/boss`：文件路径变化，`meta.id` 与 `requires` 不变；游戏内 `/icinematics reload` 后触发器仍注册（脚本 id 未变）。
5. 删除 `chapter/boss`（非空）被拒；移走脚本后删除成功。

## 11. 完成定义

- 空文件夹、嵌套、折叠、文件夹 CRUD 四项在上述验收下行为确定。
- 文件夹操作不产生任何脚本内容改写（可用 `git diff --stat` 验证只有文件移动/目录变化）。
- 折叠后无悬空边、无节点消失。
- 未新增未登记消息。
