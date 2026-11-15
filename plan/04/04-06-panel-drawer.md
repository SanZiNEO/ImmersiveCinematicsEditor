# 04-06 底部抽屉容器

## 目标

提供一个可停靠的底部抽屉 group：默认在主轴上方、默认关闭，打开高度 200–420；标签来自 `drawerTab` 贡献，一个 group 同时只有一个活动 tab；再点当前 tab 折叠；可被拖出/并入其他组；低窗打开时压主轴到 160 并提示。容器只负责“谁显示、在哪显示、加载/错误怎么呈现”，不实现面板内容。

## 抽屉 group

```ts
interface DrawerGroupState {
  groupId: 'document.drawer'
  visible: boolean          // 默认 false
  collapsed: boolean        // 默认 true
  lastSize: number          // 上次打开高度，默认 280
  activeTabId?: string
}
```

- 抽屉是 `LayoutNode` 里的 `GroupNode`，不是独立于布局树的浮层；高度/可见性/位置都由 04-02 管。
- 默认位于主轴上方；默认关闭（高度 0）；打开时高度夹到 200–420。
- 抽屉可被 04-03 拖到其他区域，也可把其他面板拖进来成组；抽屉本身可隐藏/恢复。
- 抽屉不能做成模态弹窗或全屏浮层；打开时仍能看见并操作主轴。

## 标签注册

`DrawerTabContribution` 见 04-01。04 只注册真实内容，保留以下 ID：

| tabId | 04 状态 |
|---|---|
| `curves` | 保留 ID |
| `behavior` | 保留 ID |
| `resources` | 保留 ID |
| `diagnostics` | **04 注册真实工作台诊断** |
| `templates` | 保留 ID |

04 的 `diagnostics` 是工作台级诊断：插件加载失败、manifest 重复/依赖缺失、布局恢复、主题回退、preload/IPC 失败、面板加载失败。诊断按来源分组；不另开第二套诊断入口。

`demo.kitchen-sink` 贡献 `demo.drawer.notes` 和 `demo.drawer.log` 两个 demo tab，用于验收开关/拖出/keepAlive/错误隔离；发布构建可排除。

## 标签行为

- 同一 group 同时只有一个活动 tab；点另一个 tab 切换。
- 再点当前活动 tab：折叠整个抽屉（`visible=false`），不是关闭单个 tab。
- 抽屉头部有“关闭”按钮；关闭只改布局可见性，不卸载 keepAlive tab。
- 标签顺序按 `order`；用户拖动重排后按布局树顺序，不再回 contribution order。
- 标签不可单独删除；面板插件被移除时，标签变“插件未安装”占位，可移除/重置。
- 抽屉打开/关闭不改变主轴宽度；只改变主轴可用高度。
- 抽屉被移到右侧/其他组后，原抽屉位置只剩其余 tab；空 group 隐藏，不留空壳。

## 内容容器

`PanelSlot` 只认 `tabId`：

1. 解析 `DrawerTabContribution`；
2. 懒加载 `component()`；
3. 加载中显示骨架（不显示 0/默认值）；
4. 失败显示“加载失败 + 原因 + 重试”；
5. 抛错只影响该 tab，其他 tab/主轴/预览正常；
6. `keepAlive=true` 的 tab 隐藏时保持挂载，保留滚动/筛选/草稿；`false` 的卸载。

`PanelSlot` 不 import 业务面板，不读 `state.doc`，不直接写文件；tab 内容通过 `PanelContext` 取服务和命令。

## 低窗降级

- 窗口高 < 720 时打开抽屉：主轴自动压到 160px，并在抽屉头/状态区提示“抽屉与主轴二选一”；关闭抽屉恢复主轴原比例。
- 窗口高 < 600 时抽屉最大高度夹到 200，主轴最小 120；仍不够时只允许“半屏下部”一档，不允许覆盖主轴。
- 抽屉打开时如果主轴已被用户折叠到 0，先恢复到 160 再打开，不出现负高。
- 低窗提示不能只靠颜色；要文字 + 可关闭提示。
- 窗口拉高后按 `lastSize` 恢复抽屉高度，不自动全开。

## 诊断面板

`DiagnosticsPanel` 是 04 唯一的真实抽屉内容：

- 列表字段：severity（error/warning/info）、source（plugin/layout/theme/preload/ipc/panel）、pluginId?、message、detail?、timestamp。
- 操作：复制问题、复制全部、清空已处理（只清 UI 记录，不删源错误）、按来源筛选。
- 顶栏/状态区显示错误计数徽标；点击打开 `diagnostics` tab。
- 字段原位错误提示仍保留，诊断不是唯一入口；不能把字段错误只塞进抽屉。
- 抽屉不承载整脚本 JSON 常驻栏或源码常驻页；需要源码时只提供只读路径/复制。
- 文档校验问题按 `document` 来源分组，保留 03 的 issue 路径/定位；不重写 03 校验。

## 资源/模板/曲线/行为的占位策略

- 04 不注册 `curves/behavior/resources/templates` 的假组件，也不显示“由某轮提供”的可操作空页。
- 布局文件里引用了这些 ID 但插件未注册：显示“面板未安装”占位 + 移除/重置；不自动创建空 tab。
- 同一 ID 的面板注册后，布局不需要迁移，抽屉语义不变。
- `resources` 面板只读 `resource.list`；04 容器不提供上传/删除/写文件通道。
- `templates` 面板保留参数草稿；04 定义 `keepAlive` 合同。

## 验收

- 打开 `diagnostics`：能看到至少一条插件/布局/主题诊断；复制单条/全部可用；顶栏计数一致。
- `demo.drawer.notes` 打开→切到 `demo.drawer.log`→再点当前 tab 折叠；重启后恢复上次活动 tab 和高度。
- `demo.drawer.notes` 有滚动/筛选状态，隐藏再显示保留（keepAlive）；非 keepAlive tab 重新加载。
- 把 `demo.drawer.notes` 拖到右侧与 `selection.properties` 成组：抽屉原位置只剩其他 tab；右侧出现新标签；重启保持。
- demo tab 故意抛错：只该 tab 错误，其他 tab/主轴/预览正常；诊断有记录。
- 窗口 700px 高打开抽屉：主轴压到 160 并提示；关闭恢复；窗口拉高按上次高度恢复。
- 抽屉打开时仍能插入片段/拖播放头；抽屉不覆盖主轴。
- `rg` 检查没有 `curves/behavior/resources/templates` 的假组件注册；没有第二份 `drawerH` 状态；没有 `localStorage` 直写。

## 抽屉约束

- 抽屉高度归 04-02 的布局树。
- 只为 `diagnostics` 注册真实内容；其余四个 ID 保留空位。
- 容器不实现字段/规则/曲线/模板控件。
- 资源上传/删除/写文件不在抽屉里。
- 抽屉不做整脚本源码常驻页。
- 抽屉是 dock group，不开独立窗口。
- 高度不写 localStorage；不维护第二份高度状态。
