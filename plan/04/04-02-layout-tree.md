# 04-02 布局树与工作区布局服务

## 目标

建立工作台唯一的布局模型：`split / group / panel` 三类节点，每页一套布局，面板身份只认 `{ pluginId, panelId }`，尺寸用“比例 + 最小/最大像素”，布局持久化独立于脚本。外壳只渲染这棵树，不持有第二套尺寸状态。

## 布局数据

```ts
type LayoutNode = SplitNode | GroupNode

interface SplitNode {
  type: 'split'
  id: string
  orientation: 'horizontal' | 'vertical'
  children: LayoutNode[]
  sizes: number[]              // 比例，和为 1；至少两个子节点
  minSizes?: number[]          // 像素下限；与 children 对齐
}

interface GroupNode {
  type: 'group'
  id: string
  panels: PanelNode[]          // 有序，决定标签顺序；panel 只存在于 group 内
  activePanelId?: string       // 当前标签的 PanelNode.id
  visible: boolean
  collapsed: boolean
  lastSize?: number            // 折叠前的像素/比例参考，用于恢复
}

interface PanelNode extends PanelRef {
  type: 'panel'
  id: string                   // p:<pluginId>:<panelId>
  visible: boolean
  collapsed?: boolean
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

interface PanelRef {
  pluginId: string
  panelId: string
}
```

约束：

- `PanelNode` 不存组件、不存 DOM、不存业务数据、不存标题；标题从 manifest 取。
- 一个 panel 在同一页最多一个实例；`singleton` 面板重复拖入只聚焦已有实例。
- `GroupNode.panels` 顺序就是标签顺序；`activePanelId` 不存在时回退到第一个可见 panel。
- `SplitNode.sizes` 必须是有限正数，和为 1；`children` 少于两个的 split 在加载时归一成 group 或单子节点。
- `GroupNode.visible=false` 的组在布局计算中占 0；`collapsed=true` 的组保留 `lastSize`，恢复时回到上次比例。
- 尺寸是“比例 + 像素约束”双写；不持久化窗口绝对像素，窗口大小变化由布局服务重新计算。

## 每页一套布局

布局文件按页分开：

```ts
interface LayoutFile {
  version: 1
  currentPageId: string
  pages: Record<string, PageLayout>
}

interface PageLayout {
  presetId: string
  presets: Record<string, LayoutTree>
}

interface LayoutTree {
  root: LayoutNode
}
```

核心页：

| 页 | 默认布局 |
|---|---|
| `document` | 顶栏固定；主区左 `clip.effects`、中预览、右 `selection.properties`；下部抽屉 + 主时间轴；底部状态区 |
| `project` | 项目启动页：最近项目、打开文件夹、连接状态 |
| `settings` | 左侧分区导航 + 右侧设置内容 |

`project` 和 `settings` 不共用 document 的树。切换页面时保留各自布局；关文档回项目页不重置 document 布局。

## 默认槽位

`SlotId` 是面板声明默认位置的稳定字符串：

```text
document.left
document.center
document.right
document.bottom
document.drawer
project.main
settings.nav
settings.content
```

面板 manifest 的 `defaultSlot` 决定它首次出现在哪。加一个新面板时：

1. 在对应页的槽位 group 里按 `order` 插入标签；
2. 槽位不存在时，在该页默认树的对应位置创建一个 group；
3. 面板是 `singleton` 且已存在时，聚焦已有标签，不新增实例；
4. 面板 `available=false` 时，布局保留节点但显示“不可用”，不自动删。

默认 document 树的尺寸约束：

| 区域 | 约束 |
|---|---|
| `clip.effects` | 最小宽 420；折叠 = 0 |
| 预览 | 最小宽 320；剩余空间 |
| `selection.properties` | 280–560；默认约 20% 视口；折叠 = 0 |
| 主时间轴 | 高度为窗口高 × 0.34，夹到 160–560；小于 240 时轨道行高切紧凑 |
| 抽屉 | 默认关闭；打开高度 200–420；低窗（<720）压主轴到 160 并提示 |

`clip.effects` 不继承检查器 280–560 的窄栏限制；它需要参数列 + 节点列的横向空间。

## 布局服务 API

`WorkspaceLayoutService` 是唯一写入者：

```ts
interface WorkspaceLayoutService {
  getPage(pageId: string): PageLayout
  getTree(pageId: string): LayoutTree
  applyViewport(pageId: string, viewport: Viewport): void
  movePanel(pageId: string, panel: PanelRef, targetGroupId: string, index: number): void
  splitGroup(pageId: string, groupId: string, orientation: Orientation, atIndex: number): void
  resizeSplit(pageId: string, splitId: string, index: number, ratio: number): void
  hidePanel(pageId: string, panel: PanelRef): void
  showPanel(pageId: string, panel: PanelRef): void
  applyPreset(pageId: string, presetId: string): void
  savePreset(pageId: string, name: string): void
  deletePreset(pageId: string, presetId: string): void
  resetLayout(pageId: string): void
  removeMissingPanels(pageId: string): void
  beginTransaction(pageId: string): LayoutTransaction
  undo(pageId: string): void
  redo(pageId: string): void
}
```

约束：

- 外壳只调 `getTree` 渲染；不直接改 `sizes/panels/activePanelId`。
- `movePanel`/`splitGroup`/`resizeSplit`/`hide/show` 都走一次事务；拖动中的连续变化只在内存预览，松手提交一次。
- `beginTransaction` 返回的事务有 `commit/rollback`；`rollback` 丢弃临时树，不写持久化、不进历史。
- 布局历史与脚本撤销历史分开；布局 undo/redo 只影响布局，最多 20 步。
- `applyViewport` 只计算实际像素与折叠降级，不改比例，不写 `layout.json`。

## 预设

每页支持：

- 内置：`default`、`camera`、`subtitle`、`behavior`、`compact`。
- 用户预设：`savePreset(name)` 保存当前树；名称唯一；可删除；不能覆盖内置 ID。
- 切换预设不重建文档、不清选区、不触发脚本历史、不重建预览流。
- `resetLayout` 回到该页 `default`，保留用户预设。
- 预设也是完整布局树，加载时走同一套校验；坏预设只回退到 `default`，不影响其他预设。

## 校验与恢复

加载 `layout.json` 时：

1. `version` 不是 1：已知低版本走迁移；未知版本回退默认并备份原文件。
2. `pages` 缺失核心页：补默认页，不改其他页。
3. 树里出现环、split 少于两个子节点、比例非有限正数、和为 0、panel 引用缺失、group 的 `activePanelId` 不在 `panels` 里：该页回退默认，其他页保留。
4. `pluginId/panelId` 未注册或插件被禁用：保留节点，标记 `missing`，显示占位；不自动删。
5. panel 尺寸低于 contribution 的最小值：抬到最小值；高于最大值：夹到最大值；负宽/零宽可见面板归一为最小 1px 并记诊断。
6. 同一页同一 panel 出现多次：保留第一个，其余标记重复并移除；诊断记录。
7. 窗口缩小/DPI 变化/多屏转单屏：`applyViewport` 重新夹最小尺寸；仍不够时折叠右侧面板/抽屉，显示“窗口过小”状态；窗口恢复后按 `lastSize` 恢复。
8. 坏布局只恢复布局：不重置主题、快捷键、窗口、草稿、最近项目。

持久化：

- 文件：`userData/layout.json`；与 `preferences.json`、`window-state.json`、`drafts/` 分开。
- 写：先写 `layout.json.tmp`，再原子 rename；保留 `layout.json.bak`。
- 读失败/JSON 损坏：把原文件复制为 `layout.corrupt.<timestamp>.json`，内存用默认布局，状态区提示“布局已恢复默认”，不删用户文件。
- 大小上限 1 MB；超过拒绝写入并提示。
- 不写脚本、不写 `meta.version`、不写项目文件。

## 与 04-03 / 04-04 的边界

- 04-02 只定义模型、命令、校验、持久化；不实现拖动、落点、指针捕获。
- 04-03 只把指针/键盘手势翻译成 `movePanel/splitGroup/resizeSplit` 事务；不自己存布局。
- 04-04 只渲染 `getTree` 结果；不持有 `timelineH/effectsW/propsW`，不写 `localStorage`。
- 布局树只接受 manifest 的 `defaultSlot` 和尺寸约束。

## 验收

- 1600×900 首次启动：document 页是默认五区，预览可视高度 ≥360；无 JSON 列、无固定脚本列表。
- 1280×720：默认五区可用；主轴 160–560 夹住；右侧面板可折叠；效果好控件宽度不被 280–560 夹住。
- 把 `clip.effects` 拖到右侧、与 `selection.properties` 成组：标签顺序正确；重启恢复。
- 把预览移到左侧、主轴缩到 160、隐藏资源面板再恢复：位置/尺寸/可见性恢复；脚本 JSON 不变。
- 切 `camera`/`subtitle`/`behavior`/`compact` 预设：布局变，文档/选区/脏标记不变；回 `default` 恢复。
- 保存用户预设、重启、删除预设：用户预设存在且不覆盖内置。
- 手改 `layout.json` 制造环/负比例/未知 pluginId/重复 panel/零宽：该页回默认或占位，其他页和偏好不受影响；原文件备份。
- 窗口从 1920 拖到 900 宽、换 DPI、换屏：面板可达，无负宽，折叠有提示；拉回后恢复。
- `rg` 检查外壳没有 `jsonColWidth/leftPanelWidth/rightPanelWidth/timelineHeight`，没有第二份 layout store。

## 布局约束

- 布局只写 `layout.json`；不写脚本、项目文件或 `meta.version`。
- 持久化比例和像素约束；不存绝对窗口像素。
- 只保留一套 `layoutStore` 和一套尺寸来源。
- 面板内部折叠/滚动/草稿由插件 `keepAlive` 自己管。
- 未知/缺失面板保留占位；删不删由用户决定。
