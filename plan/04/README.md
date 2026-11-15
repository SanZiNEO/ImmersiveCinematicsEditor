# 04 插件化工作台骨架

## 定位

04 把编辑器的**工作台骨架**做成插件化、可配置、可恢复的地基：插件通过七类扩展点接入，04 内核只认 `pluginId`，加面板不改内核。

04 消费 03 的文档、选区、命令，负责“这些能力放在哪个面板、怎么停靠、怎么恢复、怎么换主题、怎么走 Electron”。

## 本轮的文档

| 文档 | 任务 |
|---|---|
| [04-01-plugin-kernel.md](04-01-plugin-kernel.md) | 插件 manifest、七类扩展点、编译期注册、失败隔离 |
| [04-02-layout-tree.md](04-02-layout-tree.md) | split/group/panel 布局树、每页布局、预设、校验、持久化 |
| [04-03-dock-interaction.md](04-03-dock-interaction.md) | 面板拖动、停靠、拆分、标签重排、分隔线缩放、取消 |
| [04-04-workspace-shell.md](04-04-workspace-shell.md) | 工作台外壳、三页路由、文档顶栏、外壳职责边界 |
| [04-05-panel-host.md](04-05-panel-host.md) | 面板宿主、PanelContext、双宿主、Selection 只读合同 |
| [04-06-panel-drawer.md](04-06-panel-drawer.md) | 抽屉 group、五个保留 tab ID、懒挂载、错误隔离 |
| [04-07-theme-registry.md](04-07-theme-registry.md) | 主题注册表、主题贡献、用户自选、跟随系统、本地导入、token 覆盖 |
| [04-08-preferences-settings.md](04-08-preferences-settings.md) | 偏好/布局/窗口/草稿分离、设置页、i18n、最近项目 |
| [04-09-electron-window-menu.md](04-09-electron-window-menu.md) | 窗口、标题栏、菜单、文件对话框、草稿恢复、安全 preload |
| [04-10-command-keybinding-focus.md](04-10-command-keybinding-focus.md) | 命令注册表、快捷键作用域、焦点、IME、键盘可达 |
| [04-11-reference-plugin-acceptance.md](04-11-reference-plugin-acceptance.md) | 参考插件、加/删/禁用/缺失矩阵、整轮验收 |

## 七类扩展点

插件框架只认 `pluginId`。插件在编译期注册，只加载编译期插件；一个插件可以贡献七类东西：

| 扩展点 | 作用 |
|---|---|
| `panel` | 可停靠面板；声明 panelId、标题、组件、默认槽位、顺序、最小尺寸、keepAlive、是否单例 |
| `page` | 顶层页面；声明 pageId、路由、页面壳、默认布局 |
| `drawerTab` | 抽屉标签页；声明 tabId、标题、顺序、最小高、available、keepAlive |
| `command` | 命令；声明 commandId、标题、分类、run、enabled、checked、菜单位置 |
| `statusItem` | 状态区条目；声明 itemId、左/右、顺序、文本或组件 |
| `settings` | 设置分区；声明 sectionId、标题、顺序、组件 |
| `theme` | 主题包；声明 themeId、标题、appearance、token 表、可选语法色 |

键位不单独做第八类，挂在 `command` 上。这样命令、菜单、快捷键、命令面板永远同一份 ID。

## 主题不是固定深色/浅色

04 的主题采用“注册表 + 贡献 + 用户选择”的模型，和 VS Code 的 `contributes.themes` / `workbench.colorTheme` / 跟随系统 / `colorCustomizations` 同构：

- 内置主题只是兜底，不是唯一选项。
- 任何插件可以贡献一个或多个主题包；主题包是数据，不是代码。
- 用户可以在设置页选任意主题；可以开“跟随系统”，并分别指定浅色/深色/高对比时用哪个主题。
- 用户可以导入本地主题 JSON，存到 `userData/themes/`，不执行代码、不联网。
- 用户可以只覆盖少量 token（类似 `workbench.colorCustomizations`），不改主题文件本身。
- 主题切换只改 CSS 变量和原生 `themeSource`，不重建文档、不重建预览、不弄脏脚本。

## 默认五区

04 冻结槽位和尺寸约束；`demo.kitchen-sink` 用于占位验收。默认文档页：

```text
顶栏（固定）
├ 左：clip.effects（≥420）
├ 中：预览（≥320）
└ 右：selection.properties（280–560）
下部：抽屉（0 / 200–420）+ 主时间轴（34%，160–560）
底部：状态区
```

04 用 `demo.kitchen-sink` 验收七类贡献与面板宿主。

## 出口标准

- 加一个面板 = 新建插件目录 + `builtin.ts` 加一行，内核零改动。
- 插件内核不 import 任何业务面板；布局树只存 `pluginId + panelId`。
- 面板可拖动、缩放、停靠、成组、拆分、隐藏、恢复、切预设、重启恢复；坏布局只恢复布局。
- 主题可选任意内置/插件/本地导入主题；跟随系统有独立浅色/深色/高对比配对；局部覆盖可重置；重启无白闪。
- 偏好、布局、窗口、草稿四文件分离；坏一个只恢复一个。
- 窗口可最小化/最大化/还原/关闭；重启 bounds 可达；脏文档关闭三选一；保存失败不关。
- 命令/菜单/快捷键同一份注册表；IME、输入框、弹窗不串命令；全键盘可完成工作台操作。
- 双宿主 `clip.effects` / `selection.properties` 四态可用；抽屉可开关/拖出/错误隔离。
- `demo.kitchen-sink` 七类贡献全部出现；删插件、缺插件、重复 ID、activate 失败都有明确行为。

## 架构约束

- 插件编译期注册；不运行时安装插件，不接插件市场，不开服务器，不加载远程代码。
- 工作台布局只写 `layout.json`；不写脚本或项目文件。
- `demo.kitchen-sink` 只用于占位验收；发布构建可排除。
- 跨插件组件不互相 import；共享服务走 token。
- 布局树只存 `pluginId + panelId`，不存组件路径。
