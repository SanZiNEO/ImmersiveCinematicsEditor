# 04-04 工作台外壳、三页路由与文档顶栏

## 目标

`WorkspaceShell` 把工作区交给布局树驱动：顶栏/菜单/状态区固定，中间按页面挂载布局树；`project/document/settings` 三页各有自己的页面壳和布局。外壳只渲染布局，不持有尺寸、不读文档字段、不实现业务面板；工作区不出现整脚本 JSON 常驻列、脚本列表、固定左右栏页签、常驻校验横幅或全局键盘分支。

## 外壳结构

```text
WorkspaceShell
  AppTopBar                 // 品牌/菜单/页面标题/窗口按钮（overlay 支持时原生，回退自绘）
  PageHost                  // 按 pageId 解析页面
    ProjectPage             // 项目启动页
    DocumentPage            // 布局树 + DocumentHeader
    SettingsPage            // 设置导航 + 内容
  AppStatusBar              // statusItem 贡献
```

`WorkspaceShell` 只做三件事：

1. 从 `PageRouter` 取当前 `pageId`，从 `PageRegistry` 取页面组件；
2. 把 `WorkspaceLayoutService.getTree(pageId)` 交给 `LayoutRenderer` 递归渲染；
3. 渲染顶栏/状态区，提供焦点作用域容器。

不持有 `timelineH/effectsW/propsW`，不写 `localStorage`，不读文档 store 内部状态，不读 `state.doc.timeline.tracks`。

## 页面路由

```ts
interface PageRouter {
  currentPageId: string
  navigate(pageId: string, params?: Record<string, string>): void
  back(): void
  canBack(): boolean
}
```

- 核心页：`project`、`document`、`settings`。
- 插件页：`pageId` 来自 `page` 贡献；从“视图 → 页面”或命令打开。
- 路由是内存状态，不依赖 URL path；Electron 本地文件不能用 URL 路由承载。
- `document` 页需要 `docId` 参数；没有打开文档时回 `project`。
- 切页前检查当前文档脏状态：脏文档走“保存/放弃/取消”；取消停留原页；放弃才切；保存成功才切。
- 关闭文档、返回项目、应用退出共用同一 `UnsavedGuard`，不各写一套。

## 顶栏

### 项目页

- 左：应用名/项目页标题。
- 中：最近项目入口、打开文件夹、打开脚本文件。
- 右：设置、连接状态、窗口按钮（`titleBarOverlay` 支持时用原生按钮，回退时自绘）。
- 顶部只做项目/文件入口；图由 `project.main` 面板承载。

### 文档页

`DocumentHeader` 固定一行：

| 区域 | 内容 |
|---|---|
| 左 | 返回项目、文档名、`meta.id`、脏标记 |
| 中 | 保存、校验、撤销/重做、预览源状态 |
| 右 | 连接状态、设置、窗口按钮（overlay 支持时原生，回退自绘） |

命令面：`file.newDoc`、`file.openDoc`、`file.saveDoc`、`file.validateDoc`、`file.revertDoc`、`file.closeDoc`。04 只做入口和状态呈现，保存/校验/回滚的实际语义走 03 的 `DocumentCommands`。

行为约束：

- 脏标记只由 03 文档 store 的 `dirty` 驱动；保存成功必须等服务端回执，不能点保存就清脏。
- 保存失败/断连：保留脏标记，顶栏错误状态可见，不关闭文档。
- 校验入口只发 `validateDoc`；结果进诊断抽屉/顶栏计数，不再用常驻横幅。
- 返回项目触发未保存三选一；取消保持当前页。
- `openDoc` 从项目页/最近项目/文件对话框进入；打开失败保留原文档。
- `revertDoc` 必须二次确认；确认后从磁盘重载，清空本地未保存修改。
- 文档名过长省略中间，保留 `meta.id` 和完整 tooltip；脏标记不能只靠颜色，配文字/图标。

### 设置页

- 左：分区导航（04-08 的 settings 贡献）。
- 右：当前分区内容。
- 顶部：返回上一页、设置标题、搜索设置项（可选）。
- 设置页不挂文档布局树；切设置不关闭文档、不清选区；返回后回到原文档页。

## 项目启动页

04 交付真实可用的启动页：

- `最近项目`：`path / name / lastOpenedAt / missing`；点击打开文件夹或最近脚本；失效项可移除/重新定位。
- `打开文件夹`：走 Electron `dialog.showOpenDialog({properties:['openDirectory']})`，返回路径并记录为最近项目；启动页不扫描脚本。
- `打开脚本文件`：走 `dialog.showOpenDialog({filters:[{name:'Script', extensions:['json']}]})`，把路径交给 03 打开；这是 04 可用的真实入口。
- `连接状态`：显示预览通道（游戏）连接/离线/重连。脚本读写走工作区文件，与这个状态无关：游戏未运行时打开/编辑/保存照常可用，只有预览不可用。
- `新建脚本`：04 提供“空白脚本”入口，走 03 新建。
- 启动页显示真实最近项目/连接状态；空态用真实空态，不造项目统计。

## 外壳职责边界

`WorkspaceShell` 及其页面不包含：

- 整脚本 JSON 常驻展示列；
- 固定脚本列表、左栏页签；
- 固定右栏页签；
- 常驻校验横幅；
- 固定尺寸 ref、手写分隔线、全局键盘分支；
- 整页脚本图切换；图入口由页面/面板路由提供。

入口归属：

| 入口 | 归属 |
|---|---|
| 脚本新建/打开/保存/删除 | 项目启动页 + `DocumentHeader` |
| 整脚本 JSON | 诊断只保留问题/路径/定位/复制，不做源码常驻页 |
| 左右栏内容 | 双宿主面板 + 抽屉 + 布局树 |

`WorkspaceShell` 只挂布局渲染器；业务入口由页面/面板注册提供，`window.prompt` 重命名不在外壳出现，改名走内联编辑/命令。

## 状态区

`AppStatusBar` 只渲染 `statusItem` 贡献：

- 左：连接状态、当前页面/文档、布局预设。
- 右：预览源、校验计数、插件错误计数、版本。
- 条目只读；点击执行 `commandId`，不直接改文档。
- 断连时状态区仍可用，顶栏状态点变红；主轴/抽屉不消失。
- 插件加载失败/布局恢复/主题回退都在状态区有非阻塞提示。

## 错误与空态

- 页面组件加载失败：页面级错误 + 重试 + 返回项目；外壳不崩。
- 布局树损坏：04-02 回默认；状态区提示“布局已恢复默认”。
- 当前文档已失效/被外部删除：DocumentHeader 显示失效 + 重新打开/另存；不自动切到别的文档。
- 没有最近项目：空态 + 打开文件夹/打开脚本按钮，不显示假列表。
- 插件缺失：该面板占位；页面其他部分正常。

## 主题与样式

- 外壳不写死颜色；所有背景/文字/边框/焦点走 04-07 的 token。
- 顶栏、状态区、页面背景、分隔线、标签组、抽屉、弹层都要覆盖；不能只改 `:root` 里的一套深色。
- 主题切换不重建页面、不重建文档、不重建预览流。
- 深色变量不保留别名；主题只走 04-07 token。

## 验收

- 启动进入 `project` 页：最近项目/打开文件夹/打开脚本/连接状态可用；没有假图/假统计。
- 打开一个真实脚本进入 `document` 页：顶栏显示文档名/ID/脏标记/保存/校验/返回项目/连接状态；布局树渲染默认五区。
- 编辑一个字段 → 脏标记出现 → 写盘成功后消失；写盘失败脏标记保留，关闭被阻止。
- 脏文档点返回项目：出现保存/放弃/取消；取消停留；放弃切项目；保存成功才切。
- `settings` 页：左侧分区可切换，返回后回到原文档页，文档/选区不变。
- 游戏未运行：外壳照常可用，主轴/抽屉不消失，打开/保存脚本照常可用；只有预览区标「预览不可用」。
- 外壳边界检查：界面上没有 JSON 常驻列、固定脚本列表、固定左右栏页签、常驻校验横幅；菜单/快捷键也打不开；`rg` 外壳无 `jsonColWidth/leftPanelWidth/rightPanelWidth/timelineHeight`、无 `window.prompt` 重命名。
- 页面切换/文档关闭/应用退出都经过同一个 `UnsavedGuard`，没有第二套未保存逻辑。
- 布局树变化后刷新页面，外壳仍按 `getTree` 渲染；外壳没有第二份尺寸状态。

## 外壳约束

- 只有一个路由和一份文档 store。
- 外壳不读 `state.doc` 字段，不读文档 store 全局单例。
- 启动页和空态用真实数据；不造项目统计/假面板。
- 不保留固定左右栏页签的兼容入口。
- 整脚本 JSON 列不换名字塞进诊断抽屉。
