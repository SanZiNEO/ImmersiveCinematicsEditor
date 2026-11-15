# 04-11 参考插件与整轮验收

## 目标

用一个真实可运行的 `demo.kitchen-sink` 插件证明七类扩展点、布局/停靠、双宿主、抽屉、主题、偏好、窗口、命令/焦点都能工作；再证明“加一个面板=加插件目录+builtin 一行，内核零改动”。04 的验收不靠截图好看，靠加/删/禁用/缺失/失败矩阵和可复现操作。

## core.workbench

`core.workbench` 是内置插件，不是业务插件。它贡献：

- `page`：`project`、`document`、`settings` 三页；页面壳与默认布局。
- `panel`：预留 `clip.effects` / `selection.properties` 的宿主槽位；不注册真实业务内容。
- `drawerTab`：`diagnostics` 工作台诊断；保留 `curves/behavior/resources/templates` 四个 ID 不注册假内容。
- `command`：04-10 的 shell 命令。
- `statusItem`：连接、预览源、校验计数、布局预设、插件错误计数。
- `settings`：appearance/workspace/shortcuts/language/about/advanced。
- `theme`：`workbench.dark-default`、`workbench.light-default`、`workbench.high-contrast` 三个兜底主题。

`core.workbench` 不 import 时间轴/效果控件/图/字幕/触发器组件；这些组件由插件自己注册。

## demo.kitchen-sink

一个插件目录，七类贡献各至少一个：

| 类型 | ID | 用途 |
|---|---|---|
| `page` | `demo.sandbox` | 演示页面；从“视图 → 页面”打开 |
| `panel` | `demo.panel.effects` | 占 `document.left` 槽；显示 demo 选区四态/宿主合同 |
| `panel` | `demo.panel.properties` | 占 `document.right` 槽；显示当前项摘要/定位按钮 |
| `panel` | `demo.panel.bottom` | 占 `document.bottom` 槽；验证底部面板 |
| `drawerTab` | `demo.drawer.notes` | keepAlive；有滚动/筛选状态 |
| `drawerTab` | `demo.drawer.log` | 可抛错，验证 tab 错误隔离 |
| `command` | `demo.command.ping` | 菜单 + 快捷键；状态区计数 +1 |
| `command` | `demo.command.toggleTheme` | 在 `demo.theme.sepia/midnight` 间切换 |
| `command` | `demo.command.fail` | 故意抛错，验证命令失败诊断 |
| `statusItem` | `demo.status.plugin` | 右侧状态；显示 ping 次数 |
| `settings` | `demo.settings.section` | 一个 demo 设置分区 |
| `theme` | `demo.theme.sepia` | light 主题，验证插件主题 |
| `theme` | `demo.theme.midnight` | dark 主题，验证插件主题 |

demo 面板必须显式标记“demo”，不显示 `position.x`、`meta`、触发器字段等真实业务表单；它只验证宿主/布局/主题合同。

## 加插件的标准动作

1. 新建 `src/plugins/demo.extra/manifest.ts`，贡献一个 panel，`defaultSlot: 'document.right'`。
2. 新建 `src/plugins/demo.extra/panels/ExtraPanel.vue`。
3. `src/plugins/builtin.ts` 加一行 `demoExtra`。
4. 启动：面板出现在右侧标签组；拖到左侧/抽屉；重启恢复。
5. 不改 `PanelHost`、`WorkspaceShell`、`LayoutRenderer`、`ThemeService` 的任何业务分支。

验收记录：`git diff` 只应出现新插件目录 + `builtin.ts` 一行。

## 验收矩阵

### 1. 启动与默认布局

- 无偏好启动：`project` 页可用；打开脚本进 `document` 页；默认五区（左效果槽/中预览/右属性面板槽/下部抽屉+主轴/状态区）。
- 1600×900 与 1280×720 都可用；预览 ≥320；效果槽 ≥420；属性面板 280–560；主轴 160–560。
- 无 JSON 常驻列、无固定脚本列表、无固定左右栏页签、无常驻校验横幅。

### 2. 布局与停靠

- 面板换区、成组、拆分、标签重排、缩放、隐藏、恢复、切预设、重启恢复。
- 拖到非法区域/Esc/丢指针/失焦：取消，不改变布局。
- 坏 `layout.json`（环/负比例/未知 pluginId/重复 panel/零宽）：该页回默认或占位，其他页/偏好不受影响。
- 窗口缩小/DPI/换屏：面板可达，无负宽；折叠有提示；拉回恢复。
- 布局树里只有 `{pluginId, panelId}`，没有组件路径/业务数据。

### 3. 插件矩阵

- 加 `demo.extra`：面板出现，内核零改动。
- 删 `demo.kitchen-sink`：布局里 demo 节点变“插件未安装”；可移除/重置；不崩。
- 构建排除 demo：同“删”。
- 重复 manifest ID：启动报错，指出两处来源。
- demo `activate` 抛错：demo 贡献消失，其他插件正常；诊断有记录。
- 依赖缺失/环：依赖方不激活，错误写依赖链。
- 面板组件加载失败/抛错：只该面板错误 + 重试；其他面板正常。

### 4. 双宿主

- demo 选区切 `none/multi/clip/invalid`：两 demo 宿主显示对应状态，不互相隐藏、不自动切内容。
- 两宿主同时可见、分别拖动缩放；重启恢复。
- 快速连点 5 个选区：最终都显示最后一个；无过期数据。
- `docRevision` 变化：面板重取；宿主不缓存原值。
- 关闭文档再开新文档：宿主清空原选区，不显示上一份数据。
- 隐藏 keepAlive 面板再显示：状态保留；非 keepAlive 重新加载。
- 焦点：Tab 在面板内循环；F6 离开；折叠/隐藏焦点回标签。

### 5. 抽屉

- `diagnostics` 显示插件/布局/主题/preload/IPC 错误；复制单条/全部；顶栏计数一致。
- `demo.drawer.notes` 开关/切换/再点折叠；keepAlive 状态保留；`demo.drawer.log` 抛错只影响该 tab。
- 拖 demo tab 到右侧成组；重启保持；原抽屉空组隐藏。
- 700px 高打开抽屉：主轴压 160 + 提示；关闭恢复；拉高按上次高度恢复。
- 没有 `curves/behavior/resources/templates` 假内容；布局引用缺失时显示“未安装”。

### 6. 主题

- 内置 dark/light/high-contrast 切换；所有面板/抽屉/弹层/标题栏/状态区无残留主题色。
- 插件 `demo.theme.sepia/midnight` 出现在选择器，可应用/重启保留；删 demo 后回退并提示。
- 导入本地主题 JSON：可应用/重启保留；删除活动用户主题回退；非法/重复 ID 拒绝。
- 跟随系统：系统切深浅 → 配对的 light/dark 主题切换；手选后不被覆盖；重新跟随恢复。
- 高对比：平台支持时切 high-contrast；不达标主题被拒绝。
- token 覆盖：改 `accent/bg-panel` 立即生效；单个/全部重置；不写主题文件。
- 主题切换：文档不脏、选区不变、预览不重建、播放不中断；重启恢复；无白闪。
- 坏主题/缺失主题：回退 + 诊断；布局/快捷键/窗口/草稿不受影响。

### 7. 偏好与设置

- 改主题/语言/密度/快捷键/最近项目 → 重启保留。
- 坏 `preferences.json`：备份 + 偏好回默认；布局/窗口/草稿保留。
- 设置页切分区/返回文档：文档/选区/脏标记不变；主题/语言即时生效。
- 语言切 en_us：菜单/顶栏/状态区/设置页/对话框/错误文案更新；缺失 key 显示 key 并诊断。
- 最近项目：打开文件夹/脚本出现；移走标 missing；移除/重新定位；不自动删记录。
- demo 设置分区出现；删 demo 后消失，设置页可用。
- 分项重置：外观不影响布局；布局不影响主题/快捷键；全部重置不删脚本/草稿。

### 8. Electron

- 最小化/最大化/还原/关闭；双击标题栏；按钮区不拖窗口。
- 移动/缩放/重启恢复 bounds；最大化恢复；换屏/拔屏/DPI 后仍可见、不小于 1280×720。
- 脏文档关闭：保存/放弃/取消；取消不关；保存失败/断连不关。
- 菜单 enabled/checked 与命令一致；Windows/Linux 自绘菜单 + macOS native 菜单都执行同一命令；快捷键不双触发。
- 打开脚本/文件夹/保存/导入主题对话框可用；取消不改状态；renderer 无 `fs/path`。
- 草稿恢复：重启出现恢复/丢弃/对照；恢复不覆盖源脚本；保存成功草稿删除；丢弃只删草稿。
- `window.open`/外部导航/权限请求 deny；`window.workbench` 只有 typed API；无 `ipcRenderer` 暴露、无 `nodeIntegration:true`、无 `@electron/remote`。

### 9. 命令/快捷键/焦点

- 中文输入法组合中按 M/Delete/Space 不触发；组合结束后才生效。
- 输入框 Delete 只删文本；`Mod+Z` 文本撤销；`Mod+S` 仍保存。
- F6 全键盘走通；焦点环可见；弹窗焦点陷阱/归还；命令面板 `Mod+Shift+P` 可搜索/执行/Esc 关闭。
- 同 scope 同 chord 冲突启动报错；用户覆盖冲突拒绝保存；菜单/命令面板/快捷键同步。
- 断连时保存 disabled 并显示原因；不静默失败。

### 10. 外壳与固定栏

- 启动项目页：最近项目/打开文件夹/打开脚本/连接状态可用；无假图/假统计。
- 打开真实脚本：顶栏文档名/ID/脏标记/保存/校验/返回项目/连接状态；布局树渲染五区。
- 编辑→脏标记→保存成功清脏；失败/断连保留；关闭被阻止。
- 脏文档返回项目/关闭/退出：同一 UnsavedGuard；取消停留；放弃才走；保存成功才走。
- `rg` 外壳无 `jsonColWidth/leftPanelWidth/rightPanelWidth/timelineHeight`、无 `window.prompt` 重命名、无固定左右栏页签、无常驻校验横幅。

## 出口对照

| 出口 | 04 落点 |
|---|---|
| 默认五区、无 JSON/脚本列表 | 04-04 + 04-02 |
| 双宿主 `clip.effects` / `selection.properties` | 04-05 合同 |
| 抽屉五容器 | 04-06；04 只先落 diagnostics |
| 快捷键表/焦点/IME | 04-10 |
| 布局预设/恢复/DPI | 04-02 + 04-03 |
| dark/light/system | 04-07；已扩展为可配置主题注册表 |
| 偏好/窗口/草稿 | 04-08 + 04-09 |

## 04 出口

- 加插件不改内核；删/禁用/缺失/重复/activate 失败都有明确行为。
- 布局/停靠/预设/恢复/DPI 全部可复现；坏布局只恢复布局。
- 主题可选内置/插件/用户导入；跟随系统配对；局部覆盖；重启无白闪；不弄脏文档。
- 偏好/布局/窗口/草稿四分；坏一个只恢复一个；分项重置。
- 窗口/菜单/文件对话框/草稿/安全 preload 可用；renderer 无 Node。
- 命令/菜单/快捷键/命令面板同一注册表；IME/输入框/弹窗守卫；全键盘可达。
- 双宿主四态、抽屉开关/拖出/错误隔离。
- 外壳三页/文档顶栏/未保存守卫/固定栏移除。
- `core.workbench` 不 import 业务面板；布局只有 pluginId/panelId；没有假业务面板。

## 验收记录

- 每个矩阵项记录：操作步骤、预期、实际、截图/日志路径、是否通过。
- 插件矩阵记录 `git diff`（只允许新插件目录 + builtin 一行）。
- 不以布局 JSON 单测替代真实拖动；不以 IPC mock 替代真实窗口/对话框；不以主题 class 名替代真实视觉核查。
- 失败项保留在验收记录里，不改写成通过。
