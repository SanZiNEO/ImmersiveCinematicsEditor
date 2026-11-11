# 05-10 快捷键、焦点与键盘可达

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：05-01～05-09（本文件收口它们的交互）；无下游。

## 1. 职责

把散落在 `App.vue` 的全局键盘处理收成**一张表 + 一套作用域**，并给出非指针操作路径、焦点顺序、输入法保护与焦点可见性规则。目标不是「快捷键更多」，而是「没有鼠标也能完成全部时间轴操作」。

**参考输入**：[工作台/偏好/宿主适配](../references/03-workspace-preferences-host.md)的PanelManager活动面板与LLC快捷键反例。命令目标由显式焦点作用域决定，不因hover改变；文本/IME、弹层、图、时间轴和飞控隔离。不能用仅document.body守卫代替isComposing及文本编辑保护，也不把Qt虚函数动作表当本项目现成API。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/App.vue:91–317` | 一个 `onKeydown` 处理全部：撤销/重做、Space、Delete、Ctrl+C/X/V/A/D/S/0、M、I/O、方向键、Home/End、F、Enter、PageUp/Down、`[`/`]`、Esc、F7 |
| EDITOR:src/App.vue — isInput（93）、onKeydown（96–110） | 文本守卫定义在93，撤销分支先于110的输入守卫，且未判断isComposing；迁移时修正这两个问题 |
| `EDITOR:src/components/Timeline.vue:483–497` | 重命名用 `window.prompt`（键盘可用但体验割裂） |
| `EDITOR:src/components/Timeline.vue:792–834` | 右键菜单无键盘等价入口 |
| `EDITOR:src/components/fields/CommitNumberField.vue:44–78` | `Enter` 提交、`Esc` 还原（好的既有约定，沿用） |
| `EDITOR:plan/shared/art-direction.md` §六、§八、§十 | 焦点可见性、命中区、动效与时长的硬约束 |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/shortcuts/registry.ts` | `SHORTCUTS`、`resolveChord(e, scope)` | 表驱动快捷键；冲突在模块加载期抛错 |
| `EDITOR:src/shortcuts/useShortcuts.ts` | `useShortcuts(scopeRef)` | 作用域绑定、输入法/输入框守卫、阻止默认行为 |
| `EDITOR:src/shortcuts/commands.ts` | `SHORTCUT_COMMANDS` | 命令 id → 处理函数（调 05-02/05/06/12 的命令面） |
| `EDITOR:src/a11y/FocusRing.vue` | 组件/指令 | 统一焦点环（`:focus-visible` 不可靠时用 class 兜底） |
| `EDITOR:src/a11y/liveRegion.ts` | `announce(msg)` | 屏幕阅读器播报（保存成功、校验计数、播放状态变化） |

## 4. 快捷键表（冻结基线）

**作用域**：`global`（最低）→ `mainTimeline` / `effectControls` / `properties`（三个并列的焦点区域，按当前焦点解析，互不覆盖）→ `dialog`（最高；打开时只响应 `dialog` 与 `global` 的白名单 `Esc`）。节点操作（增删、前后导航、移动时间）**只在 `effectControls`**；`mainTimeline` 只有片段操作，`properties` 只有值编辑与定位。同一按键在不同作用域含义不同，不靠 hover 或“最后点过哪里”推断，Delete/IME 不串域。

| 键 | 作用域 | 命令 | 备注 |
|---|---|---|---|
| `Ctrl/Cmd+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | global | undo / redo | 输入框内**不拦截**，交给文本框原生撤销 |
| `Ctrl+S` | global | saveDoc | 输入框内也拦截（编辑器语义） |
| `Space` | global（非输入） | play/pause | 与滚动冲突：主轴内 `Space` 播放，列表内滚动 |
| `Delete` / `Backspace` | mainTimeline | 删除选中片段 | 输入框内不拦截；**不删除属性节点** |
| `Delete` / `Backspace` | effectControls | 删除当前选中的属性节点（06 命令） | 无节点选择时不删片段；输入框内不拦截 |
| `Delete` / `Backspace` | properties | 只编辑文本，不触发文档命令 | 不删除片段或节点 |
| `Ctrl+C/X/V/D` | mainTimeline | 复制/剪切/粘贴/复制片段 | 输入框内不拦截；节点剪贴由 06 在 `effectControls` 内定义 |
| `Ctrl+A` | mainTimeline | 全选片段 | 输入框内不拦截；不跨域全选属性节点 |
| `Esc` | 内层 | 退出工具/清选区/关抽屉/关对话框 | 逐层退出，不一键清空全部 |
| ←/→ | mainTimeline | 播放头按可配置秒步长移动（默认0.5s，Shift=5s） | 这是导航步长，不称1帧，不量化脚本时间 |
| `↑/↓` | mainTimeline | 上一个/下一个片段 | 选中并聚焦；属性行不在主轴 |
| `Home` / `End` | mainTimeline | 跳到有限末端起点/末端 | 无限时跳到可视末端 |
| `M` | mainTimeline | 添加标记 | 与播放头同点去重；输入法组合中不触发 |
| `I` / `O` | mainTimeline | 设循环入/出 | `Shift+I/O` 清除 |
| `F` | mainTimeline | 缩放到全部（有限末端） | 无限时缩放到可视末端；只改主轴全局视口 |
| `Enter` | mainTimeline | 从选中片段起点播放 | 旧版语义 |
| `[` / `]` | mainTimeline | 跳到选中片段起/止 | — |
| `PageUp/PageDown` | mainTimeline | 上/下一条有片段的轨道 | — |
| `Ctrl+0` | mainTimeline | 缩放重置 40px/s | 只重置主轴全局视口，不影响效果控件局部缩放 |
| `Alt+↑/↓` | mainTimeline | 上下移动选中片段到相邻同类型轨道 | 类型不同禁用并提示 |
| `L` / `V` / `Shift+M` | mainTimeline（轨道头聚焦） | 锁定/显隐/静音 | 轨道头键盘操作 |
| `,` / `.` | effectControls | 同一属性行的前/后节点 | 只改编辑目标/导航，不跨属性 |
| `Shift+←/→` | effectControls | 移动当前节点时间（0.05s） | 走 06 的单属性命令；主轴不响应 |
| `↑/↓` / `Enter` | effectControls | 组/行/叶子间移动并聚焦 | 只高亮当前行，其他已展开行保留 |
| `F7` | global（连接时） | 进入飞控 | 语义归 12；本表只登记 |
| `Tab` / `Shift+Tab` | 全部 | 焦点前进/后退 | 不允许 `tabindex>0` |
| `Ctrl+K` | global | 打开命令面板（**建议项，不计入必做**） | 见 recommendations |

**冲突规则**

1. 同一作用域内同一 chord 出现两次 → 模块加载期抛错（开发即失败）。
2. 平台差异用 `mod` 抽象（`Ctrl`/`Cmd`），不在表里写两行。
3. 与浏览器/Electron 默认冲突（如 `Ctrl+R`、`Ctrl+W`）不占用。
4. 输入法组合中（`e.isComposing === true` 或 `keyCode === 229`）**一律不触发**快捷键。

## 5. 焦点与键盘可达

**焦点顺序**：顶栏 → 片段效果控件（`clip.effects`） → 预览工具条 → 快捷属性（`selection.properties`） → 主时间轴（工具栏 → 轨道头列 → 画布） → 抽屉（tab 条 → 内容） → 状态区。抽屉关闭时跳过其内容；效果控件或快捷属性折叠时跳过其内容。

**主时间轴非指针路径（必须全部可用）**

| 操作 | 键盘路径 |
|---|---|
| 选片段 | 焦点进画布 → 方向键移动「当前片段」→ `Enter` 选中 |
| 移动/裁切片段 | 选中后 `Alt+←/→` 微移 0.1s；`Alt+Shift+←/→` 改右边界 |
| 分割 | 播放头定位后Shift+S，或Shift+F10菜单 |
| 打开右键菜单 | `Shift+F10` / 菜单键 |
| 多选片段 | `Shift+方向键` 扩展片段选择；不会选中属性节点 |

**效果控件非指针路径（由 06 消费本作用域，必须全部可用）**

| 操作 | 键盘路径 |
|---|---|
| 选组/行 | `↑/↓` 在组与叶子间移动，`Enter` 聚焦编辑控件 |
| 选节点 | 同一行内 `,` / `.` 前后节点；`Shift+←/→` 移动节点时间（0.05s） |
| 折叠/展开组 | `←/→` 在组头上；展开其他组时已展开组不关闭 |
| 定位到某属性 | 从快捷属性「定位到效果控件」进入对应行并聚焦 |

**快捷属性非指针路径**

| 操作 | 键盘路径 |
|---|---|
| 改值 | Tab 到字段 → 输入 → `Enter` 提交 / `Esc` 还原 |
| 定位 | Tab 到「在效果控件中定位」→ `Enter`，焦点进入 `effectControls` 对应行 |
| 多选摘要 | 只读列表；不提供批量节点编辑 |

**焦点可见性**：焦点环 2px、颜色 `--focus-ring`、偏移 1px；不使用 `outline: none`；`prefers-reduced-motion` 下取消过渡。

**播报**：保存成功/失败、校验计数变化、播放开始/暂停、选区变化（只播报对象名，不播报全部坐标）。

## 6. 修改步骤

1. 新建 `registry.ts`，把 `App.vue:91–317` 的 20+ 分支逐条登记；删除 `App.vue` 的 `onKeydown`；`keyframe` 相关分支不迁移到主轴，改为 `effectControls` 作用域内的 06 命令。
2. 新建 `useShortcuts.ts`：在 `WorkspaceShell` 上绑定 `keydown`（捕获阶段仅用于 `Esc`），其余冒泡；加入 `isComposing` 守卫。作用域容器由 `ClipEffectsHost`（`effectControls`）、`SelectionPropertiesHost`（`properties`）与 `TimelineView`（`mainTimeline`）各自提供，不靠 DOM 位置猜测。
3. commands.ts只注册真实可用处理函数；尚属后轮的飞控/模板能力不挂可执行noop，按能力说明未交付并禁用。05本轮必做快捷键必须真实接通，不能开发告警后假成功。
4. 新建 `FocusRing` 指令：在按钮/行/节点上统一 `data-focus-ring`。
5. 新建 `liveRegion.ts`：在 `WorkspaceShell` 放一个 `aria-live="polite"` 容器。
6. `Timeline.vue` 的右键菜单加 `Shift+F10` 打开，并用 roving tabindex 让菜单项可键盘遍历；菜单项只含片段命令。
7. 轨道头（`05-04`）加 `tabindex="0"` + `role="rowheader"` + 上下键导航。
8. 删除 `window.prompt` 重命名（见 `05-05` 步骤 6），改为内联编辑 + `Enter/Esc`。
9. editor统一总开关关闭时不注册/监听编辑器专用快捷键；开启/切模式时作用域不重复。语言切换更新可读命令名，IME守卫先于任何文档操作。

## 7. 禁止修改

- 不引入快捷键库（表驱动足够；AUI 兼容性留待 14 实证）。
- 不占用浏览器/系统级快捷键。
- 不在输入法组合态触发任何命令。
- 不做「按住连发」的自定义加速（方向键用系统重复即可）。
- 不把无障碍做成「另开一个可访问页面」；必须在同一界面可达。

## 8. 两分支承载

| 宿主 | 差异 |
|---|---|
| WebUI | 全部快捷键；`Cmd` 映射（macOS 构建时）；屏幕阅读器播报走 `aria-live` |
| 游戏内 Forge/AUI | AUI 的键盘事件与焦点模型未实证 → 实施前先做最小验证（焦点环是否可见、`Tab` 是否被游戏截获）；若 `Tab` 不可用，提供「F6 切换焦点区」兜底并在 `14` 记录；手柄映射不在本轮 |

## 9. 验收

**正例**

1. 中文输入法输入「位置」时按 `M`：不添加标记；组合结束后按 `M` 才添加。在效果控件输入框里输入中文时按 `Delete`/`Shift+←/→` 不触发节点命令。
2. 焦点在数值输入框按 `Delete`：只删除文本，不删除片段、不删除节点。
3. 不用鼠标：Tab 进主时间轴 → 方向键选片段 → Enter → Tab 到快捷属性改值 → 「定位到效果控件」→ 在效果控件选节点并按 `,`/`.` 导航 → `Ctrl+S` 保存。
4. 冲突检测：故意注册两个 `Ctrl+S` → 启动即报错并指出两处。
5. 打开右键菜单后 `↑/↓` 遍历、`Enter` 执行、`Esc` 关闭，焦点回到原元素。
6. 播报：保存成功后 `aria-live` 区域出现「已保存」，不重复播报。
7. 作用域隔离：焦点在主时间轴按 `Delete` 删除选中片段，不删除效果控件节点；焦点在效果控件按 `Delete` 只删除节点（06），不删除片段；焦点在快捷属性按 `Delete` 只编辑文本。

**反例**

1. 输入框内 `Ctrl+Z` 触发文档撤销 → 不通过。
2. `Esc` 一次清空选区+关抽屉+退出工具 → 不通过。
3. 焦点环不可见或依赖 hover → 不通过。
4. 主时间轴只能用鼠标拖 → 不通过。
5. 主轴按 `Delete` 删掉属性节点，或效果控件按 `Delete` 删掉整个片段 → 不通过（Delete 串域）。
6. 节点快捷键（`,`/`.`/`Shift+←/→`）在主时间轴作用域生效 → 不通过。

**真实冒烟**：WebUI 只用键盘完成「打开脚本 → 选片段 → 分割 → 在效果控件选节点 → 改属性 → 保存」（本轮出口）；游戏内 Forge 的 Tab/焦点环验证与 F6 兜底属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 快捷键只有一张表；`App.vue` 无键盘分支。
- 输入法/输入框/对话框三种守卫都有测试路径。
- 主时间轴、效果控件、快捷属性三个作用域各自有注册容器；主轴只有片段键盘路径，节点路径只在效果控件。
- Delete 在三个作用域行为不同且互不串域；有实测记录。
- 焦点环、播报、命中区符合 `shared/art-direction.md` 的硬指标。
