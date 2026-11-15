# 05-13 工作区面板接线

## 目标

用 04 的插件内核把四个 05 面板接进工作台：项目图、主时间轴、片段效果面板、片段属性面板；08 追加第五个 `transition.panel`。加面板只加插件目录 + `builtin.ts` 一行；04 的 `PanelHost`/布局树/主题/命令内核不改。05 交付两个内容面板（图/主轴）和两个属性/效果面板骨架。

## 插件清单

`src/plugins/builtin.ts` 增加四行 05 面板（顺序在 `core.workbench` 之后）；08 追加 `core.transition-panel` 一行：

```ts
import coreProjectGraph from './core.project-graph/manifest'
import coreTimeline from './core.timeline/manifest'
import coreClipEffects from './core.clip-effects/manifest'
import coreSelectionProperties from './core.selection-properties/manifest'
import coreTransitionPanel from './core.transition-panel/manifest' // 08 追加

export const BUILTIN_PLUGINS = [
  coreWorkbench,
  coreProjectGraph,
  coreTimeline,
  coreClipEffects,
  coreSelectionProperties,
  coreTransitionPanel, // 08 追加
  // demo.kitchen-sink 仅开发构建
]
```

四个 05 manifest + 一个 08 追加：

| pluginId | 面板 panelId | defaultSlot | 尺寸 | keepAlive | closable | available |
|---|---|---|---|---|---|---|
| `core.project-graph` | `project.graph` | `project.main` | min 480×320 | true | false | `pageId==='project'` |
| `core.timeline` | `timeline.main` | `document.bottom` | minHeight 160；maxHeight 560 | true | false | `pageId==='document' && hasDoc` |
| `core.clip-effects` | `clip.effects` | `document.left` | minWidth 420；折叠=0 | true | false | `pageId==='document' && hasDoc` |
| `core.selection-properties` | `selection.properties` | `document.right` | minWidth 280；maxWidth 560；折叠=0 | true | false | `pageId==='document' && hasDoc` |
| `core.transition-panel`（08） | `transition.panel` | `document.right` | minWidth 340；maxWidth 560 | true | true | `pageId==='document' && hasDoc` |

- 05 的四个面板 `requires: ['core.workbench']`；08 的 `core.transition-panel` 同样只依赖工作台，不依赖 `selection.properties`。
- `apiVersion: '1'`；`version` 各自语义化；`id` 符合 04-01 正则。
- `component` 懒加载：`panels/ProjectGraphPanel.vue`、`panels/TimelinePanel.vue`、`panels/ClipEffectsPanel.vue`、`panels/ClipPropertiesPanel.vue`、`panels/TransitionPanel.vue`。
- `titleKey`：`panel.projectGraph` / `panel.timeline` / `panel.clipEffects` / `panel.selectionProperties` / `panel.transition`；i18n 中文“项目图”“主时间轴”“片段效果”“属性”“转场”。
- `singleton: true`；同一页重复拖入只聚焦已有实例。
- 面板组件只 import `@workbench/api` 和自己目录；不 import 文档 store、不 import 另一个插件组件。
- `document.right` 同时承载 `selection.properties` 和 `transition.panel`；按标签/上下停靠共存，不替换属性面板。05 的 `selection.properties` 合同不变。

## 面板内容

### `core.project-graph` / `ProjectGraphPanel`

- 真实内容：05-02 的图外壳、05-03 节点、05-04 布局、05-05 边/诊断、05-06/07 事务入口、05-08 刷新。
- `PanelContext`：`selection` 只读；图选中不用 `selection`，用图自己的 `selectedNodeId` session；`commands` 用于打开脚本/刷新/文件夹操作；`services` 取 `dock`/`status`。
- 面板内不持有文档 `doc`；打开脚本发 `requestSelect` + `openDoc` 命令。
- `keepAlive=true`：切页保留搜索/过滤/视图/滚动；关闭项目再回保留；不保留“加载中”假状态。
- 空态/错误/断连按 05-02；不伪造节点。

### `core.timeline` / `TimelinePanel`

- 真实内容：05-09 几何/选择、05-10 视图、05-11 编辑、05-12 标尺/播放头/标记/A-B/缩放。
- `PanelContext`：`selection`、`clipKeys`、`docRevision`、`commands`；主轴只读这些，不直接改 `state.doc`。
- 面板内状态：`TimelineScale`、`playheadTime`、`markers`、`previewRange`、`snapEnabled`、`trackView`；不写文档。
- 文档命令走 `commands`；一次拖拽一条；`docRevision` 变化时重取片段，不缓存上一版数组。
- `keepAlive=true`：切页保留缩放/滚动/标记/选择；文档关闭时清空文档相关状态（04-05）。
- 空态：无文档/无片段时显示真实空轨/空态；不显示假片段。

### `core.clip-effects` / `ClipEffectsPanel`

- 05 实现面板骨架：四态 `none/multi/clip/invalid` + 选区摘要；不渲染字段控件。
- `PanelContext`：`selection`、`clipKeys`、`docRevision`、`commands`；不持第二份选择、不写文档、不缓存属性。
- `available=false` 时布局保留节点，`PanelHost` 显示不可用；不自动删。
- `requestRevealInEffectControls` 已在 04-05 定义；05 只接受 `{clipKey,objectPath,time?}`，不实现定位渲染。

### `core.selection-properties` / `ClipPropertiesPanel`

- 05 只实现面板骨架：`none/multi/clip/invalid` + 片段摘要 + 定位入口；不画属性行/值控件/节点轴，不缓存第二份值。
- `clip` 态显示片段名/轨道/时间范围/循环/无限。
- `path/rule/binding` 显示“当前选择不属于片段属性” + 打开对应面板入口；不假装能编辑。
- `available` 同 timeline；无文档时不可用。

## 命令贡献

### 图插件

| commandId | 标题 | 启用 | 动作 |
|---|---|---|---|
| `project.refreshGraph` | 刷新项目图 | 项目页、非加载中 | `script.graph` 全量/带 sinceVersion |
| `project.newFolder` | 新建文件夹 | 项目页、已连接 | 打开 05-02 内联输入 |
| `project.renameFolder` | 重命名文件夹 | 选中非根目录、已连接 | 打开内联输入；非空目录整体移动 |
| `project.deleteFolder` | 删除文件夹 | 选中空目录 | 二次确认 |
| `project.moveScript` | 移动脚本 | 选中节点、已连接 | 打开移动确认 |
| `project.renameScriptId` | 重命名脚本 id | 选中节点、已连接 | 05-06 预览/应用 |
| `project.editDependencies` | 维护前置 | 选中节点、已连接 | 05-07 对话框 |
| `project.resetLayout` | 重置图布局 | 项目页 | 二次确认，清 `nodes` 覆盖 |
| `project.fitView` | 适配图 | 项目页 | 只改 view |
| `project.openScript` | 打开脚本 | 选中节点 | 走 `openDoc` + UnsavedGuard |

- 命令 `enabled` 每次求值；断连/加载中/无选中返回 false，并在菜单显示原因。
- 命令不直接改图数据；调用 `ScriptService`/`GraphService`。

### 主轴插件

| commandId | 标题 | 启用 | 动作 |
|---|---|---|---|
| `timeline.moveClips` | 移动片段 | 有选中、非锁定 | 05-11 |
| `timeline.trimClip` | 裁切片段 | 有选中、非无限右裁 | 05-11 |
| `timeline.addTrack` | 添加轨道 | 文档页、类型可用 | 05-10；`LETTERBOX` 已存在则禁用 |
| `timeline.removeTrack` | 删除轨道 | 选中空轨 | 05-10；非空拒绝 |
| `timeline.reorderTracks` | 轨道上移/下移 | 选中轨道、非唯一 | 05-10 |
| `timeline.renameTrack` | 重命名轨道 | 选中轨道、非第三方只读名 | 轨道头内联输入 |
| `timeline.splitClip` | 在播放头分割 | 播放头在选中片段内、未引用 | 05-11 |
| `timeline.addClip` | 新建片段 | 当前轨、字段默认可构造 | 05-11 |
| `timeline.toggleBladeTool` | 刀片工具 | 文档页 | 选择/刀片切换；`Esc` 回选择 |
| `timeline.cutClips` | 剪切片段 | 有选中、未引用、非锁定 | 复制+删除 |
| `timeline.copyClips` | 复制片段 | 有选中 | 会话剪贴板 |
| `timeline.pasteClips` | 粘贴片段 | 剪贴板非空、目标轨有效 | 05-11 |
| `timeline.duplicateClips` | 复制一份 | 有选中、目标轨有效 | 复制+粘贴到播放头，一次命令 |
| `timeline.deleteClips` | 删除片段 | 有选中、未引用、非锁定 | 05-11 |
| `timeline.rippleDelete` | 波纹删除 | 有选中、同轨有限 | 05-11 |
| `timeline.toggleLoop` | 切换循环 | 有选中 | 05-11 |
| `timeline.compactSelection` | 顺排选中 | 有选中、无无限 | 05-11 |
| `timeline.seek` | 跳到时间 | 文档页 | 设置播放头 |
| `timeline.play` | 播放预览 | 已连接播放端 | 发 transport |
| `timeline.pause` | 暂停预览 | 播放中 | 发 transport |
| `timeline.stop` | 停止预览 | 播放中/暂停 | 发 transport |
| `timeline.setScriptLoop` | 设置脚本 A-B | 文档页、有内容/无限可设 | 写 `timeline.loop_*` |
| `timeline.clearScriptLoop` | 清除脚本 A-B | 文档页、有 A-B | 删除 `loop_start/loop_end` 或写 null |
| `timeline.addMarker` | 添加标记 | 文档页 | session markers |
| `timeline.removeMarker` | 删除最近标记 | 有标记 | session markers |
| `timeline.fit` | 适配主轴 | 文档页、有内容 | 改 `TimelineScale` |

- 主轴命令注册在 `core.timeline` 的 `panel` scope；只在主轴焦点/文档页且无输入框时启用，不抢 04 的 `Mod+S`/`Mod+P`/`Mod+Shift+P`。
- 命令面板里可见，但 `enabled=false` 时显示原因。

### 空态宿主

- `core.clip-effects`/`core.selection-properties` 只提供面板与空态；不注册假保存/假应用命令。

## 快捷键

| 快捷键 | 命令 | 作用域 |
|---|---|---|
| `Mod+C` | `timeline.copyClips` | 主轴 panel |
| `Mod+X` | `timeline.cutClips` | 主轴 panel |
| `Mod+V` | `timeline.pasteClips` | 主轴 panel |
| `Mod+K` | `timeline.splitClip` | 主轴 panel |
| `Mod+D` | `timeline.duplicateClips`（复制+粘贴到播放头） | 主轴 panel |
| `B` | `timeline.toggleBladeTool`（刀片工具） | 主轴 panel |
| `L` | `timeline.toggleLoop` | 主轴 panel |
| `Delete` | `timeline.deleteClips` | 主轴 panel |
| `Shift+Delete` | `timeline.rippleDelete` | 主轴 panel |
| `M` | `timeline.addMarker` | 主轴 panel |
| `Shift+M` | `timeline.removeMarker` | 主轴 panel |
| `F6` | 04 焦点循环 | global（04） |
| `Mod+Shift+P` | 04 命令面板 | global（04） |

- 不使用裸 `Delete` 全局删除；只在主轴焦点且非输入框/弹窗时生效。
- `Mod+D` 需要新增命令 `timeline.duplicateClips`（复制+粘贴到播放头），不硬编码在组件里。
- `Enter`/`Esc`/方向键由图/主轴自己处理，不注册全局命令；避免和对话框冲突。
- 快捷键冲突按 04-10 的作用域与冲突策略处理；05 不另写一套快捷键解析。轨道头焦点时 `L/M/Space` 由轨道头消费，不再触发同名命令。

## 状态项

| itemId | align | 内容 | 点击 |
|---|---|---|---|
| `project.graph.status` | left | `N 脚本 · M 依赖 · K 问题`；stale 加“· 有更新”；截断加“· 已截断” | `project.refreshGraph` |
| `timeline.status` | right | `已选 N · 12.3s · 80px/s`；无文档显示“未打开文档” | 无 |
| `project.graph.scan` | right | `扫描 42ms · v7` | 无 |
| `timeline.playback` | right | `播放中/已暂停/未连接` | `timeline.play`/`pause` |

- 状态项只读；不直接改文档/图。
- 断连时 `timeline.playback` 显示“未连接”，不显示假的“播放中”。
- 状态项文本走 i18n；数字格式统一 1 位小数。

## 服务与依赖

`@workbench/api` 新增 token（05 需要）：

```ts
interface GraphApi {
  snapshot(sinceVersion?: number): Promise<GraphData>
  refresh(): Promise<GraphData>
  moveScript(from: string, to: string): Promise<void>
  previewRefs(path: string, oldId: string, newId: string): Promise<RefPreview>
  applyRefs(...): Promise<RefApplyResult>
  mutateRequires(...): Promise<MutateResult>
}

interface TimelineApi {
  getScale(): TimelineScale
  setScale(next: TimelineScale): void
  seek(time: number): void
  setPreviewRange(range: {start:number; end:number} | null): void
  play(range?: {start:number;end:number}): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
}
```

- `core.project-graph` provide `GraphApi`；`core.timeline` provide `TimelineApi`。
- `core.clip-effects`/`core.selection-properties` 通过 `PanelContext.services.get` 取 `DocumentApi`/`SelectionApi`；缺失显示空态，不伪造。
- 跨插件不 import 组件；只走 token。
- 服务 provider 在 `activate` 注册，`dispose` 释放；重复 token 抛错。

## 验收标准

- `builtin.ts` 加载后，四个 panel 贡献都出现在注册表；重复 ID/缺依赖/坏 manifest 启动报错，不半注册。
- 项目页：`project.main` 出现 `project.graph`；不是启动页占位；最近项目/打开文件夹仍在顶部。
- 文档页：`document.left` 是 `clip.effects`，`document.bottom` 是 `timeline.main`，`document.right` 是 `selection.properties`；默认布局与 04-02 一致。
- 面板可拖动/拆分/缩放/隐藏/恢复；重启后布局恢复；不出现第二套尺寸 ref。
- `clip.effects`/`selection.properties` 四态：none/multi/clip/invalid 显示正确；不显示假字段；不互相隐藏。
- `timeline.main` 只显示文档轨道/片段；没有 JSON 常驻列、固定脚本列表、固定右栏页签。
- 图/主轴命令在命令面板可见；`enabled` 原因正确；断连时移动/重命名/依赖维护禁用。
- `Mod+K` 在主轴焦点分割；在输入框/弹窗内不触发；与 04 `Mod+S` 不冲突。
- 状态项：图脚本数/问题数/扫描耗时；主轴选中数/播放头/缩放；断连播放状态真实。
- 切换主题：四个面板 token 变化；没有写死 hex；图/主轴不重建文档。
- `grep if (panelId`：内核/PanelHost 0 命中；没有业务分支。
- `grep 固定左右页签`：新面板 0 命中；面板由 workbench 布局挂载。
- 删除 `demo.kitchen-sink` 后四个真实面板仍可用；demo 不占真实 panelId。
- `npm run build` 通过；插件组件懒加载，不全部进首屏包。

## 插件接线约束

- 加面板只加插件目录 + `builtin.ts` 一行；04 的 `PanelHost`/`LayoutRenderer`/`WorkspaceShell` 内核保持不变。
- 插件编译期注册；不引入第三方运行时插件/市场/服务器。
- 两个内容面板 + 两个属性/效果面板；面板骨架只做四态/摘要，字段控件按 02 目录由面板组件实现。
- 图/主轴组件只走 `PanelContext`，不直接读文档 store。
- 不恢复固定左右栏页签、整脚本 JSON 常驻列、脚本列表或整页切换。
- 不写 `if (panelId==='timeline')` 之类业务分支；差异由插件 manifest 声明。
- 面板内部状态不写 `layout.json`；`keepAlive` 自己管内存。
- 跨插件组件不互相 import；共享走 token。
