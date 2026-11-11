# 03 参考：工作区、偏好与宿主窗口

> 参考对象：`E:/Documents/GitHub/ImmersiveCinematics/example/editor` 下 Olive 与 LosslessCut（LLC）本地快照。
> 落点：`05-timeline-workspace` 的 05-01 / 05-07 / 05-10 / 05.20–05.23，`03-host-transport/03-07`，`shared/art-direction.md`。05-07 分别承载 `clip.effects`（片段效果控件）与 `selection.properties`（快捷属性）；两者是独立停靠身份，可同时可见，不压成同一标签页。
> 性质：只做设计思路研究与独立实现指导，不复制/改写 GPL 代码与图标资产，不对许可兼容下结论。

## 一、摘要

本轮要回答的是"外壳怎么记住自己、怎么恢复、怎么失败"。三个参考结论必须先摆明：

1. **已读实现中，Olive有明确停靠能力**。其KDDockWidgets支持默认布局、标签组、临时最大化和序列化恢复；LLC已读入口（App.module.css、View菜单、设置项）只见局部尺寸偏好，未见面板停靠，不能外推为全仓不存在。Vue/AUI不能直接使用Qt类；本项目按既有布局树合同独立实现。
2. **已读主题链路都提供手动深浅色，未发现系统主题跟随**。Olive注册olive-dark/olive-light，LLC使用darkMode和单向nativeTheme.themeSource='dark'。所读设置入口还读取prefersReducedMotion，但它是减少动效偏好，不能当system主题能力。system是本项目既有必做需求，不能用这些参考入口宣称已经解决。
3. **恢复失败的容错普遍弱于我们计划**。Olive 的布局版本检查是空实现、面板身份靠"名字:序号"再在序列化字节里做字符串替换、配置 rename 失败只打日志；LLC 的窗口尺寸判定有一个 `||` 逻辑缺陷、快捷键处理没有输入法守卫。这些恰好是可以反着用的高价值证据。

## 二、来源索引

下表路径均相对本文件；`OLIVE` = [`../../../ImmersiveCinematics/example/editor/olive/README.md`](../../../ImmersiveCinematics/example/editor/olive/README.md)，`LLC` = [`../../../ImmersiveCinematics/example/editor/lossless-cut/README.md`](../../../ImmersiveCinematics/example/editor/lossless-cut/README.md)。表内"符号 / 文件"列给出该根下的实际相对路径。

| # | 来源 | 符号 / 文件 | 行 | 能证明什么 |
|---|---|---|---|---|
| S1 | OLIVE `app/panel/panelmanager.h` | `panels()` 注释、`CurrentlyFocused`、`MostRecentlyFocused<T>()`、`focus_history_` | 68–70、75、145、157–162 | 活动面板是显式 MRU 状态 |
| S2 | OLIVE `app/panel/panelmanager.cpp` | `CurrentlyFocused`、`CurrentlyHovered`、`RegisterPanel`、`FocusChanged` | 48–65、67–78、106–125、127–150 | 焦点变更的唯一信号与 hover 介入 |
| S3 | OLIVE `app/panel/panel.cpp` / `panel.h` | `SetBorderVisible`、`paintEvent`、`Info`、`LoadData/SaveData`、`closeEvent` | cpp 54–62、73–92、112–119；h 34、55、62、64、66–67 | 面板自绘焦点边框；面板自带键值状态 |
| S4 | OLIVE `app/window/mainwindow/mainwindowlayoutinfo.h/.cpp` | `state_`、`panel_data_`、`kVersion`、`toXml`、`fromXml`、`skipCurrentElement` | h 57、65、67；cpp 5–57、59–152（版本检查 72–74） | 布局有版本字段但检查为空 |
| S5 | OLIVE `app/window/mainwindow/mainwindow.cpp` | `LoadLayout`、`TransformNameForSerialization`、`CorrectPanelDataIfNecessary`、`SaveLayout`、`ToggleMaximizedPanel`、`closeEvent`、`SetDefaultLayout`、`AppendPanelInternal` | 135–156、158–161、164–171、173–217、312–357、445–459、823–866、904–917 | 布局恢复/保存、临时最大化、关闭拦截 |
| S6 | OLIVE `app/core.cpp` | `ProjectWasModified`、`CloseProject`、`SaveLayout` 进项目保存 | 598–600、1458–1500、818 | 脏标记、可拒绝关闭、布局进项目文件 |
| S7 | OLIVE `app/config/config.cpp` | `SetDefaults`、`Load`、`Save`、`kNone` 丢弃 | 64–167、169–246、248–296（237、256、280） | 配置读写的真实容错边界 |
| S8 | OLIVE `app/ui/style/style.cpp` / `style.h` | `kDefaultStyle`、`available_themes_`、`ParsePaletteColor`、`Init`、`SetStyle` | 36–38、84–125、127–146、148–178 | 双主题硬编码、坏值静默、无 system |
| S9 | OLIVE `app/ui/style/olive-dark/`、`olive-light/` | `palette.ini`、`style.css`、`png/`、`svg/` | 目录 | 主题是成套受控资源 |
| S10 | LLC `src/renderer/src/hooks/useUserSettingsRoot.ts` | `systemPreferences`、`firstUpdateRef`、`safeSetConfig`、`safeGetConfig`、`toggleDarkMode`、`prefersReducedMotion` | 11–15、18、20–36、37–45、207–213、215、217–228 | 逐键持久化、失败toast、所读入口的系统动效偏好 |
| S11 | LLC `src/main/index.ts` | `getSavedBounds`、`createWindow`、`close` 拦截、`debouncedSaveWindowState`、`webPreferences` | 120–145、147–170、190–205、208–218、159–160 | 多屏 bounds 校正、未保存拦截、隔离反例 |
| S12 | LLC `src/main/configStore.ts` | `defaults`、`get/set/reset`、`tryCreateStore`、`init` 迁移 | 98–171（144、163、169）、201–215、217–239、241–270 | 默认值兜底、删键语义、迁移 |
| S13 | LLC `src/preload/index.ts` | `window.electron` Proxy、注释掉的 `contextBridge` | 1–20 | 安全反例 |
| S14 | LLC `src/renderer/src/hooks/useKeyboard.ts` | `exportConfirmOpen` 白名单、`e.target !== document.body`、纯修饰键、`getLayoutMap` | 44–56、59–70、132、168 | 键盘守卫的真实做与不做 |
| S15 | LLC `src/main/menu.ts` | `accelerator: 'CmdOrCtrl+W'`、windowMenu 冲突注释 | 53、387–390 | 加速键冲突必须在菜单层暴露 |
| S16 | LLC `src/renderer/src/App.tsx`、`colors.ts`、`App.module.css` | `<Theme appearance>`、`colorScheme`、`darkModeTransition`、13 行 CSS | App 2510/2517/2520；colors 8；css 全文 | 主题切换方式；无布局规则 |

行号为本地快照实测；仓库快照不是上游最新版本。许可事实：Olive 为 GPLv3（本仓 `LICENSE` 全文，`app/undo/undostack.cpp` 头注 `GPL-3.0-or-later`），LLC `package.json` 为 `GPL-2.0-only`、版本 `3.69.0`。本文只记录来源与复用边界，不写法律兼容结论。

## 三、逐点适配

### 3.1 焦点与活动面板：显式 MRU，而不是"最后一个 DOM focus"

- **来源写法**：`PanelManager` 维护 `focus_history_`（panelmanager.h:145），`panels()` 注释明确"从最近聚焦到最久"；`RegisterPanel`（cpp:106）把新面板追加进历史并在首个面板时设边框、发 `FocusedPanelChanged`；`FocusChanged`（cpp:127）沿 parent 链找 `PanelWidget`，把命中项 `move(i,0)`，旧首位 `SetBorderVisible(false)`、新首位 `SetBorderVisible(true)`，再在未抑制时 emit；`CurrentlyFocused(enable_hover)`（cpp:48）在 `HoverFocus` 配置为真时先返回 `CurrentlyHovered()`（cpp:67，用 `QCursor::pos()` 遍历历史做 `mapFromGlobal` 命中）；`MostRecentlyFocused<T>()`（h:157）用 `dynamic_cast` 在历史里找首个类型匹配。焦点边框由 `panel.cpp:73` 的 `paintEvent` 用 `palette().highlight()` 画内缩 1px 矩形。
- **解决什么**："当前操作作用于哪个面板"必须有单一答案；新面板插到哪、命令发给谁、窄屏回退到哪，都依赖它。分散在组件里读 `document.activeElement` 会随浏览器焦点语义漂移（点一下滚动条就丢）。
- **可借鉴**：活动面板是一等显式状态；焦点变更只从一个地方发出；MRU 顺序本身就是有用数据（面板被关闭后回退目标）；焦点可见性是面板级样式而不是浏览器默认 outline。
- **不能照搬**：hover 即改变活动面板（`QCursor::pos()` + `mapFromGlobal` 是把"指针位置"当意图，鼠标划过就改命令目标）；Qt 焦点链与 `QWidget::setFocus` 语义；1px 的 palette 边框（我们 art-direction §4.5 要求 2px 焦点环且不得延迟）。
- **我们已有的落点**：`05-10-KeyboardFocus.md` 的作用域 `global < timeline < inspector < dialog` 与 `FocusRing`；`05-07-InspectorHost.md` 的 `PanelContext` 与 pin；`05-01-WorkspaceShell.md` 的 `panels.ts` 注册表。
- **适配步骤**：
  1. `activePanelId` 存进 `WorkspaceLayoutService` 的 UI 状态（不写进文档 JSON、不写脚本）。
  2. 只由显式 `focusPanel(panelId)` 更新：面板内 `pointerdown`（捕获阶段）或键盘 `Tab` 进入时调用；hover 只更新 `hoveredPanelId` 用于视觉预反馈，不参与命令路由。
  3. 维护 `focusOrder: panelId[]`（MRU），面板被关闭/隐藏时从列表移除，焦点回退到 `focusOrder[0]`；回退后调用一次 `focusPanel` 并让焦点环可见。
  4. 新面板插入位置取 `focusOrder[0]` 所在 group，而不是"最后一个"。
- **人工检查**：点时间轴后按 `Delete`，删的是时间轴选中片段而不是效果控件字段；鼠标从效果控件/快捷属性移过但不点击，再按 `Delete`，目标不变；关闭当前面板后焦点落到上次使用的面板且焦点环立即可见；连续开三个面板再逐个关闭，回退顺序符合实际使用顺序。

### 3.2 稳定 panelId 与布局恢复：Olive 的"名字:序号"是反例

- **来源写法**：`TransformNameForSerialization`（mainwindow.cpp:158–161）把唯一名变成 `"%1:%2"`（原名冒号前 + 序号）；`CorrectPanelDataIfNecessary`（164–171）在保存时对每个面板做 `info.move_panel_data(...)` 并**直接改写 KDDockWidgets 序列化出来的字节流**：`layout.replace(unique_name.toUtf8(), corrected.toUtf8())`；`SaveLayout`（173–217）对 folder/timeline/viewer 三类面板各跑一遍；`MainWindowLayoutInfo` 有 `kVersion = 1`（layoutinfo.h:67）、`fromXml` 里 `if (file_version != kVersion)`（cpp:72–74）是**空 if**，注释写"以后可能解析多版本"；未知元素一律 `skipCurrentElement()`（85/98/134/142/147），空 id 忽略。
- **解决什么**：面板会被重命名、增删、标签化，布局必须能在这些变化后仍然对上号；版本号要能挡未来格式。
- **可借鉴**：布局文件要有独立版本字段与"未知就跳过"的解析策略；面板数据（`panel_data_`）和布局字节（`state_`）分两个字段存，互不污染；加载时先按 id 找面板、找不到就跳过该条。
- **不能照搬**：用"名字:序号"当身份——重命名、调序、增删都会让 id 漂移；在第三方库的序列化字节里做字符串替换（依赖内部格式、可能替换到别处、长度变化时不可预测）；版本检查留空。
- **我们已有的落点**：`05-21-WorkspaceLayoutService.md`（`split/group/panel` 三类节点、布局版本**不是** `meta.version`、未知 `panelId` 忽略并保留恢复提示、坏数据只恢复布局）；`05-01` 的 `panels.ts` 唯一注册与"旧常驻脚本列表不是合法 panelId"。
- **适配步骤**：
  1. `panelId` 用编译期常量（`timeline.main`、`preview.main`、`clip.effects`、`selection.properties`、`drawer.subtitle.batch`），不派生自标题、序号或组件名；标题文案只能来自 `labelKey`。不再使用 `inspector.effects`、`object`、`keyframe` 等旧提案 id，也不把效果控件与快捷属性合并成一个标签页。
  2. 布局文件结构固定为 `{ layoutVersion, tree, panels: { [panelId]: panelState } }`；`layoutVersion` 独立于文档 `meta.version` 与 `schemaVersion`。
  3. 加载顺序：`layoutVersion` 超范围 → 不解析，保留"恢复默认布局"入口并提示；版本兼容 → 校验树结构（每个 split 至少两个子节点、比例有限、最小像素为正）→ 逐 `panelId` 校验。
  4. 未知 `panelId`：从树里剔除该叶子但把原始条目留在内存里的 `orphans`，下次保存时丢弃并记一条诊断；不得因一个未知 id 拒绝启动。
  5. 禁止出现"按索引改名"的逻辑；任何重排只改顺序数组，不改 id。
- **人工检查**：切换界面语言/改面板标题后重启，同一面板仍回到原位；手改 `layoutVersion` 为 `9999` 重启，界面正常可用并给出一次布局重置提示；在布局文件里塞一个不存在的 `panelId`，启动不崩、其余面板照常恢复；把布局树里一个 split 改成单子节点，加载后回落默认布局且脚本内容未变；`clip.effects` 与 `selection.properties` 同时停靠后重启，两者都在且位置各自保留。

### 3.3 面板局部状态：`SaveData/LoadData` 的分层，但不要裸 map

- **来源写法**：`panel.h:64` 定义 `using Info = std::map<QString, QString>`，66–67 是默认空的 `virtual void LoadData(const Info&)` 与 `virtual Info SaveData() const`；`LoadLayout`（mainwindow.cpp:135–156）遍历 `panel_data`，`GetPanelWithName(it->first)` 命中才 `LoadData`，未命中就整条静默丢弃；`SaveLayout`（173–217）对每个 `PanelManager::panels()` 元素 `set_panel_data(panel->uniqueName(), panel->SaveData())`。
- **解决什么**：恢复布局分两层——面板"在哪"（树/尺寸/可见性）和面板"里面在看什么"（标签、滚动、折叠、钉住）。如果外壳硬编码每个面板内部字段，加一个面板就要改三处。
- **可借鉴**：面板自己声明要持久化的状态，外壳只负责收集与分发；两层状态分字段存，布局损坏时至少还能保住另一层。
- **不能照搬**：`map<string,string>` 无类型无 schema；`LoadData` 完全信任输入；miss 时无任何提示（`GetPanelWithName` 返回 null 就跳过）。
- **我们已有的落点**：05-21 的布局树；`05-23-PreferencesAndWindowState.md` 的 `PreferencesStore` 键域 `ic.editor.layout.v1`；05-07 明确 pin 是 UI 状态。
- **适配步骤**：
  1. 定义 `PanelStateV1` 判别联合，每个面板一个 `parsePanelState(panelId, unknown): PanelStateV1 | null`；`null` 表示"这一个面板的状态作废，用默认"，不影响其他面板。
  2. 首版只收真正有用的字段：`clip.effects` 的组折叠/行过滤/列宽/局部 viewport（按文档会话 + `clipKey`）、`selection.properties` 的 `pinned`/`scrollTop`/当前字段、主时间轴的 `zoom`/`scrollAnchor`、drawer 的 `open`/`activeTabId`；**不收**任何与文档内容相关的派生值。
  3. 效果控件局部 viewport 与主时间轴全局 viewport 分字段保存，不得共用一份可变 `scale/scroll`；快捷属性不保存可编辑值副本。
  4. 面板状态由 `PanelHost` 在卸载/隐藏前收集，通过 `savePanelState` 提交；外壳不 `import` 具体面板的 store（与 05-07 的"面板不得直接 import 全局 state"一致）。
  5. 保存前做一次结构校验；解析失败的条目计数进诊断，不阻塞保存其他条目。
- **人工检查**：钉住快捷属性面板后切换选区，面板不跳；重启后 pin、滚动位置、主时间轴缩放恢复，且片段/关键帧数据完全不变；把一个面板状态字段改成字符串类型，重启后只有该面板回默认，其余正常；效果控件局部缩放/滚动与主时间轴全局缩放各自恢复，改一个不重置另一个。

### 3.4 临时最大化：快照式覆盖态，绝不写盘

- **来源写法**：`ToggleMaximizedPanel`（mainwindow.cpp:312–357）。进入：先取 `CurrentlyHovered()`，没有则 `CurrentlyFocused()`，都没有或 `isFloating()` 则直接 return；然后 `premaximized_state_ = saver.serializeLayout()`，把同窗口其他面板逐个 `close()`。退出：先 `CurrentlyFocused(false)` 记住焦点，`SetSuppressChangedSignal(true)` → `restoreLayout(premaximized_state_)` → `premaximized_state_.clear()` → `raise()`/`setFocus()` → `SetSuppressChangedSignal(false)`。保存侧 `SaveLayout`（175）写 `premaximized_state_.isEmpty() ? serializeLayout() : premaximized_state_`，即"临时最大化进行中时，存的是覆盖前快照"。
- **解决什么**：临时最大化和用户真实布局是两套状态，混在一起会导致"最大化后重启还是最大化"或"恢复时焦点乱跳"。
- **可借鉴**：临时态用独立快照；持久化必须写快照而不是当前视觉；恢复过程抑制焦点通知，恢复后显式复原焦点；浮动窗口不参与最大化。
- **不能照搬**：用 `close()` 实现"藏起其他面板"（会走关闭语义、触发面板卸载与可能的副作用）；依赖 KDDockWidgets 的 `LayoutSaver` 序列化整份布局；`SetSuppressChangedSignal` 这种全局开关容易泄漏状态（Olive 靠成对调用，异常路径无 finally）。
- **我们已有的落点**：`05-22-DockLayoutController.md`（拖动/落点预览/Esc 取消/拖动中不持久化；临时态不得写盘）；05-01"隐藏不等于销毁"。
- **适配步骤**：
  1. `WorkspaceLayoutService` 增加 `transient: { kind: 'maximize'; panelId: string; restoreTree: LayoutTree } | null`。
  2. 进入最大化：`restoreTree = currentTree`（不可变快照），渲染层只改"显示哪个叶子"，不 `unmount` 其他面板，不改 `hidden` 标记。
  3. 持久化序列化函数：`transient ? transient.restoreTree : currentTree`，并在写入前断言 `transient` 不参与序列化。
  4. 退出：直接置 `transient = null`，`focusPanel(panelId)` 一次；不做"恢复后再抑制信号"，而是让焦点变更走统一的 `focusPanel`，避免两套机制。
  5. 切换项目/关闭文档/宿主 teardown 时清 `transient`，并按 3.2 的规则不写盘。
- **人工检查**：最大化效果控件后直接 `Ctrl+S` 再重启，仍是原布局（不是全屏效果控件）；最大化期间切项目，临时态清除且没有半最大化残留；最大化一个被拖成浮动的面板，操作无效且无报错；最大化时反复按切换键 10 次，布局与焦点都回到原位。

### 3.5 默认布局与"真实停靠"：只有 Olive 有可借鉴的停靠语义

- **来源写法**：`SetDefaultLayout`（mainwindow.cpp:823–866）用 `KDDockWidgets::InitialOption` 的相对尺寸搭六区：`preferredSize = QSize(0, centralAreaGeometry().height())` 做顶部、`QSize(1, 0)` 做左侧工具条、`QSize(320, 0)` 做右侧音频表；用 `addDockWidget(..., Location_OnTop/OnRight/OnBottom/OnLeft, ...)` 定位，`addDockWidgetAsTab` 成组，`raise()` 指定活动标签；隐藏面板统一 `close()`。
- **解决什么**：默认布局要能表达"贴哪边、占多大、和谁一组、默认显示哪个标签"，并且必须可重建（用户改乱后能一键回去）。
- **可借鉴**：默认布局用相对意图（方向 + 比例 + 最小尺寸 + 分组 + 活动标签），不用绝对像素坐标；默认布局是一个可重复生成的数据，不是一次性的 DOM 操作序列。
- **不能照搬**：KDDockWidgets 的 `InitialOption`/`Location_*` API 与 `preferredSize` 里 0/1 的魔法像素；`close()` 当隐藏；把默认布局直接写成运行时 `addDockWidget` 调用（无法比较/重置）。
- **事实边界（必须写清）**：Olive 有 KDDockWidgets 停靠，**不代表**我们的 Vue WebUI 或未来 AUI 已有等价库；停靠树、拖动、落点预览、分隔条键盘操作全部要自建。LLC 在 `App.module.css`（13 行，仅媒体控件伪元素）、`View` 菜单（只有 zoom/fullscreen/minimize）、设置项（单值偏好）里都没有面板停靠——它只是单画面布局，但这不能证明 LLC 全仓不存在别处的面板管理实现。
- **截图职责边界**：用户截图中的图④是独立属性面板，即本项目的快捷属性 `selection.properties`，**不是**效果控件的第二页。`clip.effects` 与 `selection.properties` 可同时停靠、同时可见；效果控件的左参数列+右节点列需要横向空间，不继承旧快捷检查器 280–560px 窄栏限制。小窗口用停靠标签/折叠、列宽调整与受控滚动保证可达，不降级为单属性切页。
- **我们已有的落点**：05-01 的默认布局（文档顶栏/中央预览/片段效果控件/右侧快捷属性/下部时间轴/底部抽屉）与"不新建 `layoutStore`"；05-21 的 `applyPreset`/`resetLayout`；05-22 的拖动与落点。
- **适配步骤**：
  1. `DEFAULT_LAYOUT` 写成纯数据：`{ kind: 'split', dir: 'row', ratio: 0.72, minPx: 320, children: [...] }`，默认结构为"中央列：`preview.main` 与 `clip.effects` 同时可见；右列：`selection.properties`；下行：`timeline.main`"，叶子为 `{ kind: 'group', tabs: [panelId], activeTabId }`。
  2. 每个 panel 在 `panels.ts` 里声明 `defaultRegion` 与 `minSize`；默认布局由注册表生成，避免两处维护。`clip.effects` 默认靠近预览，`selection.properties` 默认在右，两者不能被默认布局合并成同一 tab。
  3. `resetLayout()` 深拷贝常量生成新树（不直接返回常量引用，避免被就地修改）。
  4. 用户保存的布局与默认布局分开存储；"恢复默认"只替换 `tree`，保留 `panels` 里的局部状态或按显式选择清空。
- **人工检查**：连续点三次"恢复默认布局"，结果完全一致；把预览拖到右侧、时间轴压到最小、隐藏快捷属性后重启，三项都恢复；任意两面板互换位置后保存，脚本 JSON 与 schema 编译结果不变；窄窗口（<900px）下默认布局退化为抽屉/单面板模式且不出现零宽区域；同时显示 `clip.effects` 与 `selection.properties`，换位/缩放/隐藏恢复后两者仍可同时操作，且效果控件不被压成单属性页。

### 3.6 关闭与未保存：取消与保存失败是同一条失败返回

- **来源写法**：`MainWindow::closeEvent`（mainwindow.cpp:445–459）第一句就是 `if (!Core::instance()->CloseProject(false)) { e->ignore(); return; }`；`Core::CloseProject`（core.cpp:1458–1500）在 `is_modified() && !ignore_modified` 时弹三按钮 `Save` / `Don't Save` / `Cancel`，`Cancel` 直接 `return false`，`clickedButton()==yes_btn && !SaveProject()` 也 `return false`（注释："The save failed, stop closing projects"），只有通过后才清 undo 栈、`SetActiveProject(nullptr)`、`delete`。脏标记由 `ProjectWasModified`（cpp:598–600）驱动 `setWindowModified`，标题走 `[*]` 占位。
- **解决什么**：关闭是一个可能被拒绝的协议，而不是"发个事件就走"。用户取消、保存失败、项目仍脏，三种情况必须表现为同一个"没关成"。
- **可借鉴**：调用方只判断一个布尔/枚举；取消与保存失败共用失败路径；脏状态是显式、可观察的标志（标题/标签），不是散落的 `dirty` 布尔；只有确认通过后才释放资源。
- **不能照搬**：模态 `QMessageBox` 阻塞主线程（我们 WebUI 不能阻塞渲染与预览流）；`[*]` 标题替换；把"关窗口"和"删项目对象"写成一个函数（我们的窗口关闭与文档关闭、宿主 teardown 是三件不同的事）。
- **我们已有的落点**：`05-23`（关闭窗口/切项目/退出离线模式前先问未保存；取消必须阻止真正关闭；保存失败、断连、资源校验失败都不能按"已保存"关闭）；`03-07-host-teardown.md`（宿主级 teardown 与端点位 detach 分离、顺序固定、幂等）。
- **适配步骤**：
  1. `beforeClose(): Promise<'close' | 'cancel'>`：`document.dirty ? await askUnsaved() : 'close'`；`askUnsaved` 的"保存"分支 `await saveDocument()`，失败返回 `'cancel'` 并展示错误。
  2. 窗口 `close` 事件一律先 `event.preventDefault()`，异步确认后再调用真正的关闭；确认期间窗口显示"正在保存"，再次触发关闭直接复用同一个 Promise（不叠第二个对话框）。
  3. 脏标记进标题与对应面板 tab；保存成功后清除，撤销回退到已保存点也要清除。
  4. 关闭窗口只结束渲染端与本地草稿；不调用 03-07 的宿主 teardown（端点位只断开本会话）。宿主 teardown 由 03 的统一入口触发。
- **人工检查**：改一个关键帧后关窗口选"取消"，窗口仍在、内容仍在、撤销栈仍在；把工程目录设为只读后关窗选"保存"，不关闭且显示具体失败原因；关窗口后游戏端仍在出帧（端点断开而非宿主停止），按 `F9` 才整体释放；连点关闭两次只出现一个确认框。

### 3.7 偏好首次载入与写失败：默认先行、损坏可恢复、写失败必须可见

- **来源写法**：Olive `Config::Load`（config.cpp:169–246）：文件不存在直接 `return`（用默认，不打扰用户）；`open` 失败只 `qWarning` 后 return；随后 `SetDefaults()` 再解析；0.1.x 配置做 upconvert；`reader.hasError()` 才弹 `QMessageBox::critical` 并 `SetDefaults()`。`Config::Save`（248–296）：写 `GetSafeTemporaryFilename`，打开失败 critical + return；`kNone` 类型键 `qWarning` 丢弃；`RenameFileAllowOverwrite` 失败**只** `qWarning`（"Config has been saved as ... instead"），界面仍当成功。LLC `configStore.ts`：`defaults` 整表兜底（98–171），`set(undefined)` 等价删除（205–210），`tryCreateStore` 重试 5 次 ×2s 后 `throw`（217–239），`init` 里逐条迁移旧键（252+）。`useUserSettingsRoot.ts`：`firstUpdateRef` 挡住 mount 期间的全量回写（18、26、207–213），写失败 `errorToast`（33），跨桥取非原始值要 `JSON.parse(JSON.stringify())` 深拷贝（39–45）。
- **解决什么**：偏好是"启动早期就要用、用户最不关注、坏了最难受"的数据。要区分"没有"（正常）、"坏了"（可恢复）与"写不进"（必须告知）。
- **可借鉴**：默认值先于解析；读失败分级；写用临时文件 + 原子替换；未知/废弃键丢弃而不是报错；初始化期间的默认值回写要显式跳过；跨进程传值要克隆，不能传活引用。
- **不能照搬**：`RenameFileAllowOverwrite` 失败静默（用户以为已保存，实际写到临时文件名）；每键一次独立 IPC + 60 组 `useState/useEffect`（写放大、顺序不定）；`JSON` 深拷贝（我们用结构化克隆与不可变快照）；`tryCreateStore` 五次重试后 `throw` 让应用起不来。
- **我们已有的落点**：`05-23` 的 `PreferencesStore`（schema 校验、写失败非阻塞提示、不向 renderer 暴露 Node、恢复不阻塞启动）；`05-20` 的坏值回默认并提示；`shared/art-direction.md` §4.5 的错误状态样式。
- **适配步骤**：
  1. `loadPreferences(): { value: PreferencesV1; issues: PreferenceIssue[] }`——文件缺失返回默认且 `issues` 为空；解析/校验失败返回默认 + 具体键的 issue，**不弹模态**。
  2. `savePreferences(patch)`：单次批量提交（按分区合并），写临时文件 → 校验回读 → 原子替换；任一步失败则回滚内存态、保留旧文件、emit 一次可关闭的 toast（含"重试"与"打开所在文件夹"）。
  3. `schemaVersion` + 迁移表；迁移失败保留备份文件，不删用户目录。
  4. 启动时若发现 `issues`，在状态栏给一个可展开的条目，而不是打断首屏。
- **人工检查**：把偏好 JSON 改成非法文本后启动，界面正常、只提示一次、值回默认；把偏好文件设为只读后改主题，提示"未保存"且界面回退到旧值（不假装成功）；删除偏好文件后启动，静默用默认；连续快速改 20 个设置项，只产生一次合并写盘且重启后全部保留。

### 3.8 深浅主题：成套资源可借鉴，`system` 必须我们自己做

- **来源写法**：Olive `StyleManager::Init`（style.cpp:127–146）强制 `Fusion`，只注册 `olive-dark`/`olive-light`（131–132），配置值为空或不在注册表就**静默** `SetStyle(kDefaultStyle)`（136–137）；`SetStyle`（148–178）先 `icon::LoadAll(":/style/<name>")`（注释：样式变化会触发图标变化，必须先加载），再按 `palette.ini` 是否存在决定 `ParsePalette` 或 `standardPalette()`，最后整份 `style.css` 覆盖，文件不存在则 `setStyleSheet(QString())` 清空；`ParsePaletteColor`（84–125）遇到未知角色名直接 `return`。资源目录见 S9：两套主题各自带 `palette.ini`、`style.css`、`png/`、`svg/`。
- **LLC 侧**：主进程 `createWindow`（main/index.ts:147–151）读 `darkMode`，`if (darkMode) nativeTheme.themeSource = 'dark'`——**没有 else**，注释 `// todo follow darkMode setting when user switches`；渲染层 `App.tsx:2510/2517/2520` 用 Radix `<Theme appearance={darkMode?'dark':'light'}>`、`colorScheme: 'only dark' | 'only light'`、`transition: darkModeTransition`；`colors.ts:8` 定义 `darkModeTransition = 'background .5s'`；`toggleDarkMode`（useUserSettingsRoot.ts:215）只是取反；`configStore.ts:163` 默认 `darkMode: true`。
- **关键事实**：已读入口里**两个软件都没有"跟随系统主题"**。LLC 唯一真正读取的系统偏好是 `systemPreferences.getAnimationSettings().prefersReducedMotion`（useUserSettingsRoot.ts:15、217–228），三态 `'user' | 'always' | 'never'`，`'user'` 时才回落到系统值，且注释明确"用户必须重启应用才能检测到此处的变化"。这是**减少动效**，不是主题跟随；不能拿来充当 system 主题的证据。
- **可借鉴**：主题是"调色板 + 样式表 + 图标"的成套受控资源，切换必须整套换；有依赖顺序（图标先于样式，否则会出现旧图标配新底色）；资源缺失要有确定回退（清空样式表，而不是留着上一套）。
- **不能照搬**：硬编码两套主题名；坏值静默回默认（我们要求可诊断）；`background .5s` 全局过渡（与 art-direction §4.8 的 120/180/240ms 冲突，且切主题瞬间会拖出一条 500ms 的色带）；`colorScheme: 'only dark'` 强制原生控件，导致表单控件不跟随实际主题。
- **我们已有的落点**：`05-20-ThemeService.md`（mode=dark/light/system、token 受控、system 订阅幂等、用户显式选择不被系统覆盖、启动先应用再显示、坏值回默认并提示）；`shared/art-direction.md` §4.1 token 表、§4.5 焦点与状态、§4.8 动效。
- **适配步骤**：
  1. `ThemeService` 内部三态：`resolved = mode === 'system' ? media.matches : mode`；`mode === 'system'` 时订阅 `matchMedia('(prefers-color-scheme: dark)')` 的 `change`，`dispose` 时移除，重复订阅要幂等。
  2. 首屏前（挂载根组件之前）同步写入 `data-theme`，避免白闪；主题切换只改根属性与 CSS 变量，不重建文档、不重挂时间轴、不打断预览流。
  3. 过渡白名单：只有颜色与不透明度可过渡，时长 ≤180ms；首帧禁用过渡（`data-ready` 之后才启用）。
  4. 主题资源与 `availableThemes` 注册表分离：非法值回默认并记 issue，不静默。
- **人工检查**：系统切深色（未手选），界面跟随且首屏不闪白；手选浅色后系统再切深色，界面保持浅色；连续切换 10 次无残留色块、预览不断流、时间轴滚动位置不变；在浅色下打开下拉/输入框，原生控件也是浅色（不是"only dark"）。

### 3.9 窗口与多屏恢复：按工作区校正，但别照抄判定条件

- **来源写法**：`getSavedBounds`（main/index.ts:120–145）取 `screen.getDisplayMatching(bounds).workArea`；位置只在窗口**完全包含**于工作区时采用（四个不等式全与）；尺寸判定写成 `bounds.width <= area.width || bounds.height <= area.height`（**或**：宽或高任一合法就同时采用两者）；返回 `isMaximized` 单独字段。`createWindow`（147–170）据此设置并 `maximize()`；`debouncedSaveWindowState`（208–218）500ms 去抖，用 `getNormalBounds()` 取非最大化边界，受 `storeWindowBounds`（configStore.ts:169）开关控制；`windowBounds` 默认 `undefined`（144）。
- **解决什么**：显示器拔插、分辨率变化、缩放变化后，旧 bounds 可能把窗口丢到屏幕上不存在的位置。
- **可借鉴**：恢复前必须与实际显示器工作区比对；最大化状态与普通 bounds 分开存；连续 `resize/move` 去抖写；允许用户关掉"记住窗口位置"。
- **不能照搬**：全包含判定（窗口只露出一半就整块丢弃位置，用户会觉得"位置没记住"）；`||` 的尺寸判定（高度超屏时仍采用超屏高度）；纯像素不处理 DPI 缩放；500ms 去抖没有退出前 flush（最后一次移动可能丢）。
- **我们已有的落点**：`05-23` 的 `WindowStateAdapter`（bounds 损坏只恢复窗口、不恢复布局）；05-21 的多屏/DPI 校正。
- **适配步骤**：
  1. `restoreWindowBounds(saved, displays)`：先按最大交集选目标 display；`clamp` 到 `workArea` 并保底 `800×600`；位置与尺寸分别 clamp（不要用"或"）。
  2. `maximized`/`fullscreen` 作为独立布尔应用，且不覆盖 `normalBounds`。
  3. 保存用 `requestAnimationFrame` 合并 + 关闭前 flush；`DPI` 变化时按比例换算而不是直接套旧像素。
  4. 保存失败（同 3.7）不阻塞关窗，但记一次诊断。
- **人工检查**：窗口拖到副屏后关闭，重开落在副屏；拔掉副屏后启动，落在主屏且不越界；125% ↔ 150% 缩放切换后窗口仍完整可见；最大化关闭再打开仍最大化；关闭"记住窗口位置"后重开回到默认尺寸。

### 3.10 键盘作用域与输入法：LLC 的守卫可取一半

- **来源写法**：`useKeyboard.ts` 在 `exportConfirmOpen` 时只放行 `Escape`（关对话框）与 `export`，其余一律 return（44–56）；随后 `if (e.target !== document.body) return;`（59，注释解释"只允许 body 聚焦"，并把 mousetrap 式的 `composedPath()` + `isContentEditable` 写法留在注释里）；`allModifiers.has(e.code)` 忽略纯修饰键（132）；用物理 `e.code` 绑定，`navigator.keyboard.getLayoutMap()`（168）处理布局。全文**没有** `isComposing` 判断。`menu.ts` 里 `accelerator: 'CmdOrCtrl+W'`（53）与 `// On Windows the windowMenu has a close Ctrl+W which clashes with File->Close shortcut`（387）并存，因此 `windowMenu` 只在 darwin 注册（390）。
- **解决什么**：快捷键要同时满足四件事——对话框有白名单、文本输入不误触、非 QWERTY 布局能用、冲突可定位。
- **可借鉴**：对话框打开时用白名单（只放行该对话框真正需要的键）而不是"全禁"或"全放"；纯修饰键不触发；绑定用物理 `code`、显示用 `key`；真实加速键冲突要在注册表层暴露并留注释。
- **不能照搬**：`e.target !== document.body` 这种"只有 body 才响应"的守卫——它把所有自绘可聚焦区域（时间轴、轨道行、面板）排除在快捷键之外，等于放弃面板级作用域；没有 IME 守卫（中文/日文输入时会误触发）。
- **我们已有的落点**：`05-10-KeyboardFocus.md`（`global < timeline < inspector < dialog` 内层优先；`dialog` 打开只响应 `dialog` 与 `global` 白名单；`isComposing === true` 或 `keyCode === 229` 一律不触发；同作用域重复 chord 加载期抛错；`Esc` 逐层退出；`Ctrl+S` 输入框内也拦截、`Ctrl+Z` 不拦截）；`art-direction` §4.5 焦点环 2px 永不延迟。
- **适配步骤**：
  1. `resolveChord(e, scopeStack)`：从最内层作用域往外查，命中即停；`dialog` 打开时把栈裁剪为 `[global, dialog]`。
  2. 入口第一行 `if (e.isComposing || e.keyCode === 229) return;`；输入框判定用 `tag` 白名单 + `isContentEditable`，不要求 `target === body`。
  3. 存储 `KeyboardEvent.code`，展示用 `key`；同一物理组合跨作用域注册时显式声明"遮蔽"而非报冲突，同作用域重复才抛错。
  4. `Esc` 顺序：先关最内层浮层/对话框，再退拖拽，最后才是"取消选区"。
- **人工检查**：中文输入法打 `shijian` 期间按 `Delete`，不删片段、不触发快捷键、候选词不消失；快捷属性数值框内 `Ctrl+Z` 撤销输入、`Ctrl+S` 仍保存；打开对话框后只有 `Esc` 与确认键生效，`Delete` 不穿透；焦点在自绘时间轴（非 `body`）上 `Delete` 生效且焦点环可见；法语 AZERTY 布局下 `Ctrl+Z` 仍对应撤销。

## 四、不采用清单

| 不采用 | 来源 | 原因 |
|---|---|---|
| 把布局存进项目/脚本文件 | Olive `core.cpp:818` 把 `SaveLayout()` 交给 `ProjectSaveTask::SetLayout` | 我们的脚本是固定格式产物，布局是编辑器状态；布局进脚本会污染 schema 与差异对比。布局只进 `PreferencesStore` |
| "名字:序号" 作面板身份 | `mainwindow.cpp:158–171` | 重命名/调序会漂移；我们的 `panelId` 必须是常量 |
| 在序列化字节里做字符串替换 | 同上 `layout.replace(...)` | 依赖第三方内部格式，替换范围不可控 |
| 版本检查留空 | `mainwindowlayoutinfo.cpp:72–74` | 等于没有版本；我们要求显式比较与迁移 |
| `close()` 当"隐藏" | `SetDefaultLayout` 末尾、`ToggleMaximizedPanel` 中间 | 关闭会走卸载/生命周期；我们用 `hidden` 标记 |
| hover 决定活动面板 | `PanelManager::CurrentlyHovered`（cpp:67） | 鼠标划过就改命令目标，误操作 |
| 配置 rename 失败只打日志 | `config.cpp:293–295` | 用户会以为已保存；必须可见失败 + 回滚 |
| 坏主题值静默回默认 | `style.cpp:136–137` | 我们要求可诊断（05-20） |
| 全局 `background .5s` 过渡 | LLC `colors.ts:8` | 与 art-direction §4.8 时长冲突，切主题拖色带 |
| `colorScheme: 'only dark'` | LLC `App.tsx:2510` | 原生控件不跟随实际主题 |
| 单向 `nativeTheme.themeSource='dark'` | LLC `main/index.ts:151` | 没有 light/system 分支，不能作为 system 主题参考 |
| 每键一次 IPC + 每键一组 `useState/useEffect` | LLC `useUserSettingsRoot.ts` | 写放大、顺序不定；我们按分区合并提交 |
| `e.target !== document.body` 才响应 | LLC `useKeyboard.ts:59` | 排除所有自绘可聚焦区域，放弃面板级作用域 |
| `getSavedBounds` 的"或"尺寸判定 | LLC `main/index.ts:136` | 高度超屏仍采用，逻辑缺陷 |
| `contextIsolation:false` + `nodeIntegration:true` + renderer `window.require('@electron/remote')` | LLC `main/index.ts:159–160`、`useUserSettingsRoot.ts:11–13`、`preload/index.ts:4,19` | **仅作反例**：不导入我们的 renderer，也不声称其安全策略满足本项目 |
| 把 `prefersReducedMotion` 当系统主题 | LLC `useUserSettingsRoot.ts:15,217–228` | 那是减少动效，且需重启才更新 |
| 把 Olive 的 Qt dock 类当现成 Vue/AUI 库 | Olive `PanelWidget : KDDockWidgets::DockWidget`（panel.h:34） | 我们无此依赖；停靠模型自建 |
| 把效果控件压回旧快捷检查器窄栏或做成单属性独占页 | 本项目旧提案（非参考软件） | 左参数+右节点需要横向空间；用户截图图④是独立快捷属性面板，与 `clip.effects` 同时可见；窄栏不是功能边界 |
| 用 `inspector.effects`/`object`/`keyframe` 表示新面板 | 本项目旧提案（非参考软件） | 注册身份必须稳定且语义准确；统一为 `clip.effects` 与 `selection.properties`，不合并成同一标签页 |

## 五、到现有任务的映射

| 参考点 | 现有任务 | 具体落点 |
|---|---|---|
| 3.1 焦点/MRU | [05-10](../05-timeline-workspace/05-10-KeyboardFocus.md)、[05-07](../05-timeline-workspace/05-07-InspectorHost.md)、[05-01](../05-timeline-workspace/05-01-WorkspaceShell.md) | 作用域栈、`focusPanel`、`PanelContext`、`FocusRing` 2px |
| 3.2 稳定 id/版本 | [05-21](../05-timeline-workspace/21-WorkspaceLayoutService.md)、[05-01](../05-timeline-workspace/05-01-WorkspaceShell.md) | `layoutVersion` 独立、未知 id 忽略并提示、`panels.ts` 唯一注册；`clip.effects` 与 `selection.properties` 两个稳定 id |
| 3.3 面板局部状态 | [05-21](../05-timeline-workspace/21-WorkspaceLayoutService.md)、[05-23](../05-timeline-workspace/23-PreferencesAndWindowState.md)、[05-07](../05-timeline-workspace/05-07-InspectorHost.md) | `PanelStateV1`、效果控件按 `clipKey` 存组折叠/列宽/局部视口、快捷属性 pin/滚动、pin 是 UI 状态 |
| 3.4 临时最大化 | [05-22](../05-timeline-workspace/22-DockLayoutController.md)、[05-01](../05-timeline-workspace/05-01-WorkspaceShell.md) | `transient` 快照不写盘、隐藏≠销毁 |
| 3.5 默认布局/停靠 | [05-01](../05-timeline-workspace/05-01-WorkspaceShell.md)、[05-21](../05-timeline-workspace/21-WorkspaceLayoutService.md)、[05-22](../05-timeline-workspace/22-DockLayoutController.md) | 默认布局数据化：预览+效果控件、右侧快捷属性、下方时间轴；`resetLayout`、拖动与落点 |
| 效果控件与快捷属性同停 | [05-07](../05-timeline-workspace/05-07-InspectorHost.md)、[05-01](../05-timeline-workspace/05-01-WorkspaceShell.md)、[05-21](../05-timeline-workspace/21-WorkspaceLayoutService.md) | 两个 `panelId`、默认可同时可见、各自恢复；效果控件业务见 [06-ClipEffectControlsPanel](../06-async-objects/06-ClipEffectControlsPanel.md) / [06-EffectControlsRows](../06-async-objects/06-EffectControlsRows.md)；不继承 280–560px 窄栏 |
| 3.6 关闭/未保存 | [05-23](../05-timeline-workspace/23-PreferencesAndWindowState.md)、[03-07](../03-host-transport/03-07-host-teardown.md) | `beforeClose` 可拒绝、保存失败=不关；宿主 teardown 与端点 detach 分离 |
| 3.7 偏好容错 | [05-23](../05-timeline-workspace/23-PreferencesAndWindowState.md)、[05-20](../05-timeline-workspace/20-ThemeService.md) | 批量原子写、issue 非阻塞、坏值回默认并提示 |
| 3.8 主题/system | [05-20](../05-timeline-workspace/20-ThemeService.md)、[art-direction](../shared/art-direction.md) | `system` 订阅、先应用后首屏、token 与 §4.8 动效 |
| 3.9 窗口/多屏 | [05-23](../05-timeline-workspace/23-PreferencesAndWindowState.md)、[05-21](../05-timeline-workspace/21-WorkspaceLayoutService.md) | `WindowStateAdapter`、DPI/多屏 clamp |
| 3.10 键盘/IME | [05-10](../05-timeline-workspace/05-10-KeyboardFocus.md) | `isComposing` 守卫、作用域白名单、冲突加载期失败 |
| 旧栏退役 | [05-01](../05-timeline-workspace/05-01-WorkspaceShell.md)、[product-and-layout](../shared/product-and-layout.md)（第 9、53、59 行） | 布局可移动不等于恢复旧左侧常驻脚本栏；旧列表不是合法 `panelId` |

## 六、人工使用检查（汇总）

按 `shared/manual-acceptance.md` 的口径，全部为真实界面操作，不写自动化：

1. **焦点**：点时间轴 → `Delete` 命中片段；鼠标划过效果控件/快捷属性不点击 → 命令目标不变；关闭面板 → 回退到上次使用的面板且焦点环可见。
2. **布局身份**：改语言/标题后重启同一面板复位；手改 `layoutVersion=9999` → 可用 + 一次重置提示；注入未知 `panelId` → 其余正常。
3. **面板状态**：快捷属性 pin + 滚动位置、效果控件组折叠/列宽/局部视口、主时间轴缩放重启后各自恢复；篡改单面板字段 → 只有该面板回默认。
4. **临时最大化**：最大化 → 保存 → 重启仍是原布局；最大化时切项目无残留；浮动面板不响应。
5. **默认布局**：三次"恢复默认"结果一致；拖乱后重启可恢复；重排后面板后脚本 JSON 不变。
6. **关闭**：取消 → 窗口与撤销栈都在；只读目录保存失败 → 不关闭并报错；关窗口后游戏端仍出帧。
7. **偏好**：非法 JSON → 正常启动 + 一次提示；只读 → 提示未保存且界面回退；删文件 → 静默默认。
8. **主题**：系统切换跟随（未手选）；手选后不被覆盖；连切 10 次不闪、不断流；原生控件跟随。
9. **窗口**：副屏关闭 → 副屏重开；拔屏 → 主屏不越界；缩放切换可用；最大化状态保留。
10. **键盘/IME**：中文组合期间 `Delete` 不误触；数值框 `Ctrl+Z` 只撤销输入；对话框只放行白名单键；AZERTY 布局正确。
11. **不复活旧栏**：任何布局操作后左侧都不出现常驻脚本/源码列；诊断只能是抽屉里的问题与定位。
12. **效果控件与快捷属性**：两面板同时停靠；在快捷属性改值/看摘要，效果控件保持多组展开且左右对齐；换位、缩放、隐藏恢复、重启后各自状态保留；小窗口仍可操作，不出现单属性独占页。

## 七、实现状态与局限

- **本文是参考研究，不是实现**。上述所有"适配步骤"均未落代码；`05-01/05-07/05-10/05.20–05.23` 与 `03-07` 仍是计划文档。
- **未运行**：未构建、未启动编辑器、未启动游戏、未运行 Olive 或 LLC，未做任何 lint/格式化，未新增测试。所有行为判断来自源码静态阅读。
- **只读了点名入口**：LLC 的"无停靠"结论仅覆盖 `App.module.css`、`View` 菜单、设置项与 `App.tsx` 主题段；Olive 的"无 system 主题"仅覆盖 `style.cpp`/`style.h` 与两套主题资源目录。不对两仓整体能力下断言。
- **快照性**：行号对应本地快照，不代表上游最新；链接只指向本地文件，不伪造永久 URL。
- **许可**：Olive 为 GPLv3（`LICENSE` 全文、`undostack.cpp` 头 `GPL-3.0-or-later`），LLC `package.json` 为 `GPL-2.0-only` 3.69.0。本文只提炼设计与反例，不复制代码或图标，不写兼容性结论；后续若复用具体实现需另行评估。
- **AUI 边界**：`system` 主题、停靠、窗口恢复在游戏内 AUI 的可行性未验证（art-direction §4.9），本轮只按 WebUI 设计，14 轮再对照迁移。
- **截图边界**：用户截图只用于职责参照（效果控件、独立属性、预览、主时间轴），不是像素规格；图④按独立快捷属性面板理解，不能据此把 `clip.effects` 限制为旧窄栏或第二页。
