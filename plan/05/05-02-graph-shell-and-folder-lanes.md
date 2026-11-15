# 05-02 图外壳与文件夹泳道

## 目标

把 `project.main` 的图视图做成可用的项目入口：加载、错误、空态、工具栏、平移/缩放、文件夹泳道、空目录、折叠、文件夹新建/重命名/删除、脚本拖入文件夹。图只负责组织与入口，不编辑轨道、片段、关键帧。

## 组件结构

```text
ProjectGraphPanel
  GraphToolbar          // 图内工具：刷新、搜索、过滤、缩放、适配、新建文件夹/脚本
  GraphBanner           // 加载/错误/空态/截断提示
  GraphCanvas
    GraphWorld
      FolderLane        // 每个目录一条泳道；含空目录
      GraphEdges        // SVG
      NodeCard          // 05-03
    GraphLegend
  FolderContextMenu
  MoveScriptDialog
```

- `ProjectGraphPanel` 是 `core.project-graph` 的面板组件，panelId `project.graph`，defaultSlot `project.main`；不接受 04 外壳的尺寸/路由 props，只从 `PanelContext` 取 `commands/services/status`。
- `GraphCanvas` 只画，不直接读写文件；所有变更走 `commands` / `services`。
- `ProjectGraphPanel` 是唯一项目图外壳；节点/边/泳道的纯函数放在 `src/graph/` 下，组件拆开。

## 数据与布局

- `GraphData` 来自 05-01：`nodes`、`edges`、`folders`（含 parent/depth/empty/directScriptCount/childCount/totalScriptCount）、`warnings`、`version`、`stats`。
- 泳道顺序：根 `""` 第一，然后按 `folders` 的 parent/depth 先序；同层按路径字典序。
- 泳道标题：根显示“项目根（scripts）”；其他显示最后一段，tooltip 显示完整路径、`n 脚本`、`m 子文件夹`。
- 泳道折叠：`collapsedFolders: Set<string>` 是视图 session 状态，不写盘；折叠后泳道高度只留标题行，节点隐藏，边端点吸附到泳道标题条的中心；不把边画到空白。
- 泳道采用展平结构：所有目录按前序排成横向泳道，子目录在父目录下方，标题带父路径提示；跨文件夹边从左到右。
- 空目录：`empty=true` 的泳道仍然渲染，高度为标题 + 一行“空文件夹，可拖入脚本”；可作为拖放目标；不能因为没节点就消失。
- 自动布局：05-04 接管；05-02 只调用 `computeLayout(graph, overrides?)` 并渲染。
- 视图状态：`scale`、`tx`、`ty` 从 05-04 的 `view` 恢复；首次打开且无保存视图才 `fit()`；有保存视图不自动 fit，避免每次刷新跳回。

## 工具栏

| 控件 | 行为 |
|---|---|
| 刷新 | 发 `script.graph`，保留当前选中/视图；不清过滤器；显示扫描中 |
| 搜索 | 匹配 `name/path/scriptId/trigger.type`；输入 150ms 防抖；不请求服务端 |
| 触发器过滤 | 值来自当前 `graph.nodes[].triggers[].type`，排序去重 |
| 文件夹过滤 | 值来自 `graph.folders`，含空目录；根显示“项目根” |
| 只看匹配 | 过滤不匹配节点/边；空结果显式空态，不显示假节点 |
| 缩放 −/+ | 0.15–2.5，指针锚定；更新 05-04 `view.scale` |
| 适配 | 只对当前可见节点/泳道；折叠泳道高度为标题；不把隐藏节点算进包围盒 |
| 统计 | `stats.nodeCount/edgeCount/folderCount/invalidCount`；截断时加“已截断”标记 |
| 新建文件夹 | 在根或当前选中文件夹下创建；名字非空、无 `/`、无 `..`、不与现有目录重名 |
| 新建脚本 | 走 03 `file.newDoc`，默认落当前选中文件夹；路径冲突时让作者改名，不覆盖 |
| 提示 | “拖拽平移 · 滚轮缩放 · 单击高亮上下游 · 双击打开脚本”；不写假快捷键 |

## 加载/错误/空态

| 状态 | 呈现 |
|---|---|
| 未连接 | 图区域显示“未连接模组：启动游戏内 WebUI 服务后可查看项目图”；顶部保留“打开本地脚本”入口 |
| 首次加载 | 骨架屏 + “正在扫描 scripts”；不显示 0 个节点/空图 |
| 空项目 | 真实空态：`scripts` 下没有脚本；按钮“新建脚本”“打开文件夹”；不画假节点 |
| 扫描失败 | 错误条 + 原因 + 重试；保留上一次成功的图（标“已过期”），不清空 |
| 部分坏脚本 | 图正常显示；warnings 入口显示数量；坏节点标红；不弹全屏错误 |
| 截断 | 顶部条“项目过大，已截断到 800 节点/2000 边”；统计显示真实计数；不假装完整 |
| 插件缺失 | `PanelHost` 的缺失占位；不把图组件换成假数据 |

## 文件夹 CRUD

### 新建

- 入口：工具栏“新建文件夹”、泳道右键“在此下新建”、命令 `project.newFolder`。
- 输入：单行内联输入或小弹窗，不用 `window.prompt`。
- 校验：非空、≤64 字符、不能含 `/`、`\`、`..`、控制字符；不能与同级目录重名；不能是保留名（`.`、`..`）。
- 服务端：`script.folder.new { parent, name }` → `{ path }`；在 `SCRIPTS_DIR` 下 `Files.createDirectories`；已存在则报错 `folder_exists`，不静默复用。
- 成功后：局部插入 `folders`，发 `script.graph.invalidated`；不整图重扫；新泳道出现在 parent 之后。
- 新建目录不改任何脚本，不触发保存，不弄脏文档。
- 引用事务（05-06）进行中：`script.folder.new/rename/delete` 与 `script.move` 全部 `lock_busy`，不排队、不半写。

### 重命名

- 入口：泳道右键“重命名”、命令 `project.renameFolder`。
- 允许重命名任意目录（根除外），包括非空目录；目录整体 `Files.move`，子目录/脚本随目录一起移动。
- 不改写任何脚本内容：`meta.id`、`requires`、`timeline` 全部原样；文件夹路径不是脚本 id 命名空间。
- 服务端：`script.folder.rename { path, newName }`；目标不存在、名字合法；同盘 `Files.move`；目标存在则拒绝。
- 成功后：folders 的 path/parent/depth 更新；所有子节点 `path/folder` 按新前缀更新；图布局按 `scriptId` 兜底重绑定；打开中的文档 `currentPath` 同步更新（不重载、不弄脏）；发失效。
- 根目录不可重命名。
- 非空目录重命名不触发引用事务；不重写 `requires`；不调用 `script.refs.*`。

### 删除

- 入口：泳道右键“删除文件夹”、命令 `project.deleteFolder`。
- 只允许 `empty=true`；非空目录拒绝，提示“先移走脚本/子目录”。
- 服务端：`script.folder.delete { path }`；`Files.delete`；不存在视为成功；根目录拒绝。
- 成功后：移除泳道，发失效；如果当前过滤选中该目录，清过滤。

## 脚本移入文件夹

- 入口：节点拖到目标泳道/文件夹标题；或节点右键“移动到…”；或命令 `project.moveScript`。
- 拖拽只是“意图”：松手弹 `MoveScriptDialog` 显示 `from → to`，确认后才写盘；不允许松手即改文件。
- 目标：任意目录（含空目录），不能是脚本当前目录；不能移入自己的子路径（脚本不是目录，天然安全）；不能覆盖同名文件。
- 服务端：05-06 的 `script.move`；只改路径，不改 `meta.id`、不改 `requires`、不改文件内容。
- 成功后：节点 `path/folder` 更新；布局按 05-04 的路径优先重绑定；发失效；文档若打开的是该脚本，`currentPath` 同步更新（03 文档 IO 的路径同步），不重新加载内容、不弄脏。
- 失败：文件已存在、目标不可写、源不存在、断连；图保持原位，显示错误，不乐观移动。

## 键盘与焦点

- 图面板获得焦点时：方向键平移 40px；`+/-` 缩放；`0` 适配；`Esc` 清选中；`Enter` 打开选中节点；`Delete` 只清选中，删除脚本走项目/文件入口。
- 焦点进入图：`PanelContext.focusFirst` 聚焦搜索框或画布；`F6` 离开。
- 右键菜单可用键盘打开（`Shift+F10`），菜单项可 Tab/方向键选择。
- 拖拽/缩放期间不抢全局快捷键；输入框内不触发图快捷键。

## 验收标准

- 打开项目页：图作为 `project.main` 面板出现；顶部最近项目/打开文件夹仍在；没有第二套整页图。
- 空 `scripts`：真实空态；新建文件夹后出现空泳道；刷新后空泳道仍在。
- 新建 `chapter/`、`chapter/boss/`：两条泳道按前序排列；`chapter` 有子目录但无直接脚本，`empty=false`；`boss` 空，`empty=true`。
- 空泳道可接收节点拖入；松手先弹确认；确认后文件移动、节点更新、内容不变。
- 非空目录重命名成功：目录整体移动、子目录/脚本路径更新、脚本内容 sha256 不变、`requires` 不变；打开中的文档路径同步、不弄脏。
- 删除非空目录拒绝，提示“先移走脚本/子目录”；空目录删除成功。
- 根目录不能重命名/删除；`script.folder.*` 路径越界（`../`）被拒绝。
- 折叠 `chapter`：节点隐藏、边端点吸附标题条、不画到空白；展开恢复。
- 搜索/触发器/文件夹过滤叠加：不匹配节点 dim/hidden 正确；只看匹配时边两端都隐藏才隐藏。
- 图刷新保留 `scale/tx/ty` 和选中；首次无保存视图才 fit。
- 断连：图保留上次数据并标“已过期”；新建/移动/重命名禁用并显示原因；不白屏。
- `grep window.prompt`：图组件 0 命中；文件夹名/脚本名都用内联输入或 dialog。
- `grep 项目图入口`：只有 `ProjectGraphPanel` 一处；没有第二套图或整页切换。

## 图内操作范围

- 文件夹重命名只改同一父目录下的名字；非空目录随目录整体移动，脚本内容不递归改写。
- 删除脚本走项目/文件入口；图内 `Delete` 只清选中。
- 依赖维护走 05-07 的显式对话框；节点拖拽只改布局坐标。
- 图内只显示节点与边；轨道、片段、关键帧在主轴编辑。
- 泳道展平，空目录同样渲染并可作为拖放目标。
- 布局用纯函数；不引入第三方图库。
- 折叠状态属于图视图；持久化位置由 05-04 决定。
