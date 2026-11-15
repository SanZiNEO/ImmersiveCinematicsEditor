# 05 项目图接入与主轴工作区

## 这一轮的定位

04 已经把工作台骨架立起来：布局树、停靠、主题注册表、面板宿主、命令/快捷键/焦点、Electron 窗口与偏好。05 往这个骨架里装两组真实内容：

- **A 组：项目图接入。** 把 04-04 项目启动页的 `project.main` 占位换成可用的脚本关系图，包含项目索引、文件夹泳道、节点/悬停/打开、图布局持久化、移动与重命名事务、受控依赖维护、刷新与规模降级。
- **B 组：主轴工作区。** `TimelinePanel` 只编排片段的主时间轴：几何/显示范围/吸附/选择、轨道与片段渲染、片段移动/裁切/分割/复制/粘贴/删除/循环/波纹、标尺/播放头/标记/脚本 A-B/UI 预览范围/缩放/跟随。

04 的 `05-02 DocumentHeader`、`05-09 GraphEntry`、`05-20~23` 已经落在 04-04、04-02、04-05、04-07、04-08、04-09、04-10；05 在这些合同上装图与主轴。

## 这一轮的出口

1. 项目页出现真实图，不再是启动页占位；图数据来自 `script.graph`，节点=脚本、边=触发器 `requires`、泳道=文件夹。
2. 文件夹可新建、重命名、删除空目录；脚本可移入文件夹，移动只改路径，不改 `meta.id`，不改任何 `requires` 文本。
3. 图布局可手摆、可持久化、移动/重命名后能重绑定；坏布局回落自动布局，不丢用户文件。
4. 改脚本 `meta.id` 有预览、备份、原子改写、失败回滚；只改真实引用，不改触发器 identity、规则、路径、exit。
5. 图内可新增/修改/移除一条内置 `requires`；自定义前置只读但可定位；不靠拖线隐式改依赖。
6. 主轴只显示轨道和片段，不出现对象行、属性节点、关键帧菱形、属性数量汇总。
7. 轨道可新增/删除空轨/排序/重命名；片段可新建/移动/跨轨移动/左右裁切/分割/剪切/复制粘贴/复制一份/删除/循环/波纹删除/顺排，全部走 03 的 `EditorCommand` 与 `commit`；一次拖拽一次撤销。
8. 标尺/播放头/标记/脚本 A-B/UI 预览范围/缩放/自动跟随分工明确；不写总时长字段，不把无限内容伪装成固定长度。
9. 四个真实插件 `core.project-graph`、`core.timeline`、`core.clip-effects`、`core.selection-properties` 按 04 合同注册；加面板不改 04 内核。
10. `05-14` 的闭环验收可复现：项目图打开脚本 → 主轴编辑 → 保存 → 返回图 → 图更新。

## 依赖的既有合同

| 合同 | 文件 | 05 怎么用 |
|---|---|---|
| 片段身份/选择 | `03-03-selection-identity.md` | 主轴选择只用 `clipKey`；不用 `{track,clip,keyframe}` 下标；引用完整性检查走 03 |
| 文档命令/撤销 | `03-05-editor-store.md` | 片段编辑只发 `EditorCommand`；`commit` 不重算总时长；快照式撤销 |
| 校验 | `03-06-validation-bridge.md` | 本地结构检查 + 服务端 `script.validate`；主轴的 block/error 只显示，不改语义 |
| 文档 IO | `03-07-document-io.md` | 打开不改写文档；保存从 `serializeDoc` 派生；脏标记等服务端回执 |
| 布局树 | `04-02-layout-tree.md` | 面板默认槽位、尺寸约束、每页布局；尺寸由 04 布局树持有 |
| 面板宿主 | `04-05-panel-host.md` | `PanelContext`、选区四态、双宿主 ID；05 只注册面板 |
| 外壳/页面 | `04-04-workspace-shell.md` | `project/document/settings` 页面路由；项目页顶部工具保留 |
| 命令/焦点 | `04-10-command-keybinding-focus.md` | 05 命令在插件 `activate` 注册；不写回全局键盘分支 |

## 文档

### A 组 · 项目图接入

| 文档 | 内容 |
|---|---|
| [05-01 项目索引与图数据契约](05-01-project-index-and-graph-contract.md) | `ScriptIndexService`、`script.graph` 扩展、节点/触发器/边/文件夹/warnings、版本与 `sinceVersion` |
| [05-02 图外壳与文件夹泳道](05-02-graph-shell-and-folder-lanes.md) | 图视图、加载/错误/空态、平移缩放、泳道、空目录、文件夹 CRUD、脚本移入 |
| [05-03 节点卡片、悬停与打开](05-03-node-card-hover-open.md) | 节点卡片、悬停摘要、上下游高亮、双击/Enter 打开、失败留在图页 |
| [05-04 图布局与持久化](05-04-graph-layout-persistence.md) | 自动布局 + 手摆覆盖、`graph-layout.json`、路径/ID 重绑定、原子写 |
| [05-05 依赖边与诊断](05-05-dependency-edges-and-diagnostics.md) | 边来源身份、悬空桩、重复/自引用、可维护性分级、自定义前置只读 |
| [05-06 脚本移动与重命名事务](05-06-move-rename-refactor.md) | 移动只改路径；改 `meta.id` 预览/备份/原子改写/回滚 |
| [05-07 图内依赖维护](05-07-graph-dependency-mutation.md) | 新增/修改/移除一条内置 `requires`；指纹、校验、原子写 |
| [05-08 图刷新与规模诊断](05-08-graph-refresh-scale-diagnostics.md) | `script.graph.invalidated`、过期角标、stats、warnings 分组、200/800 节点降级 |

### B 组 · 主轴工作区

| 文档 | 内容 |
|---|---|
| [05-09 主轴几何、显示范围与选择](05-09-timeline-geometry-and-selection.md) | `TimelineScale`、`DisplayRange`、吸附、命中、拖动会话、`clipKey` 选择 |
| [05-10 主轴视图与轨道/片段](05-10-timeline-view.md) | `TimelineView`、轨道头、轨道行、`ClipBlock`、工具栏、右键菜单、轨道增删/排序/重命名、新建片段、刀片工具 |
| [05-11 片段编辑](05-11-clip-editing.md) | 新建/移动/跨轨/裁切/分割/剪切/复制粘贴/复制一份/删除/循环/波纹/顺排；引用影响预检 |
| [05-12 标尺、播放头、标记、A-B、缩放](05-12-ruler-playhead-markers.md) | 三件事分开：脚本 A-B、UI 预览范围、播放头；标记只存 session |
| [05-13 工作区面板接线](05-13-workspace-panel-integration.md) | 四个插件、面板 ID/槽位、命令/快捷键/状态项、双宿主空态 |
| [05-14 05 闭环验收](05-14-r5-acceptance.md) | 图 + 主轴 + 插件 + 键盘 + 性能 + 离线断连的验收矩阵 |

## 这一轮会碰的模组侧

05 同时改模组侧。项目图需要以下模组侧服务，落在 01 已经划好的 `editor` / `editor.shared` / `editor.webui` 包里，沿用 01 的包边界、总开关、七接口：

- `ScriptIndexService`：一次扫描脚本 + 目录，给图数据、空目录、版本。
- `ScriptFolderService`：新建/重命名（可非空，仅改目录名）/删除（仅空目录）；脚本移入由 `ScriptFileService.moveScript` 完成。
- `GraphLayoutStore`：读写 `immersive_cinematics/editor/graph-layout.json`。
- `ScriptRefactorService`：改 `meta.id` 的预览/应用/备份/回滚。
- `ScriptGraphService`：补 trigger identity/index、文件夹 parent/empty、warnings severity、stats/version。
- `WebEditorApi` 新增/扩展消息，统一在 `shared/contracts` 登记后冻结。

消息类别（具体形状见各文档）：

```text
script.graph                // 扩展 version/sinceVersion/stats
script.graph.invalidated    // 服务端广播失效
script.folder.new/rename/delete
script.move
graph.layout.get/put
script.refs.preview/apply
script.requires.mutate
```

## 验收顺序## 验收顺序

1. 先跑 `05-01`～`05-08` 的图数据/文件夹/布局/移动/重命名/依赖维护单组验收。
2. 再跑 `05-09`～`05-12` 的主轴几何/视图/片段编辑/标尺单组验收。
3. 最后跑 `05-13` 的面板接线与 `05-14` 的图→文档→主轴→保存→图闭环。
4. 每一组都先跑离线/断连路径，再跑连接态；断连不能白屏，不能假装保存成功。
