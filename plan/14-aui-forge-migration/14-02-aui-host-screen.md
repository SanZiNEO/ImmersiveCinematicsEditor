# 14-02 AUI 宿主 Screen 与全功能页面壳

> 状态：未实现（仅计划；14 是 13 通过后的迁移执行轮）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-01 加载器可用
> 关联：`README.md`、`14-01-forge-loader-skeleton.md`、`14-03-inprocess-frame-source.md`、`14-04-inprocess-signal-endpoint.md`、`14-05-input-focus-routing.md`、`14-07-teardown-carrier-consistency.md`、`14-09-full-feature-migration.md`、`../shared/product-and-layout.md`、`../shared/effect-controls-workspace.md`

## 1. 职责

冻结游戏内编辑器的 UI 载体：一个继承 `ApricityScreen` 的 `EditorAuiScreen`，负责页面路径、viewport、背景/HUD 策略、打开/关闭、Document 复用与释放、页面元素绑定入口、面板注册、与 WebUI 预览屏的互斥。

本任务交付**全功能工作台的壳与承载面**：顶栏、关系图入口、中央画面容器、片段效果控件宿主、右侧快捷属性宿主、下部主时间轴、抽屉/面板注册、状态栏。它不实现各面板的业务（14-09 逐模块填满），但必须保证：

- 页面不是“只有标题/空 div”的空壳；所有区域、面板挂载点、状态区、错误区真实存在且可绑定。
- 主时间轴只容纳轨道与片段，不提供属性节点、对象展开或关键帧汇总；效果控件与快捷属性是两个独立可停靠面板（`clip.effects`/`selection.properties`），可同时可见，壳不得把它们压回一个旧标签。
- 14-02 单独完成**不**等于 14 完成；14-09 必须把每个面板填满并有正反例。
- 不接受“先空着，后续补”的占位按钮；未实现的入口在 14-02 阶段可以不出现，但 14 出口前必须全部可用。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| AUI Screen 基类 | `AUI:screen/ApricityScreen.java:24-35` | `extends Screen implements AuiLinkedScreen`；构造只接收 `templatePath` |
| 暂停开关 | `ApricityScreen.java:38-55` | `pauseGame` 默认 false；`setPauseGame(boolean)` |
| 背景开关 | `ApricityScreen.java:57-66` | `showDefaultBackground` 默认 false；`setShowDefaultBackground(boolean)` |
| 链接文档 | `ApricityScreen.java:68-71` | `getLinkedDocument()` |
| init | `ApricityScreen.java:73-101` | `linkedDocument==null || !isActive()` 时 `Document.create(templatePath, openTiming)`；否则复用；`applyViewport(false)` |
| resize | `ApricityScreen.java:103-109` | 复用 Document，只 `applyViewport(true)`；不重载页面 |
| render | `ApricityScreen.java:111-160` | 可选背景；`Base.drawScreenDocument`；`ScreenDocumentCache.attach`；`ResourcePreviewDialog`；`Base.drawPersistentScreenDocuments`；光标 |
| keyPressed | `ApricityScreen.java:162-180` | reload 键；Ctrl +/-/0 缩放；其余 `super.keyPressed` |
| onClose | `ApricityScreen.java:182-193` | `unload` 事件；`linkedDocument.remove()`；清 viewport override；光标 |
| removed | `ApricityScreen.java:195-203` | 再次 `remove()`；置 null；清 viewport override |
| isPauseScreen | `ApricityScreen.java:205-207` | 返回 `pauseGame`（默认 false） |
| 缩放 | `ApricityScreen.java:209-217` | `handleViewportZoom`/`resetViewportZoom` |
| AUI 门面 | `AUI:ApricityUI.java:90-126` | `screen(path)`、`closeScreen()`、`ensureDocument`、`createDocument`、`removeDocument` |
| Document 创建 | `AUI:init/Document.java:243-251` | `create(path)` / `create(path, timing)` |
| Document 移除 | `Document.java:284-289` | `remove(path)` / `remove(uuid)` |
| Document 生命周期 | `Document.java:766-799` | `disposeLifecycle`：元素 `onDisconnectedFromDocument`、观察者、音频、选择、焦点 |
| Document 幂等 | `Document.java:766-768` | `lifecycleState == DISPOSED` 直接返回 |
| DocumentRegistry | `AUI:dom/DocumentRegistry.java:54-179` | `create`/`createInWorld`/`get`/`remove`；`remove` 调用 `disposeLifecycle` |
| 页面根 | `AUI:loader/Loader.java:28-56` | dev 根 → project roots → `<gameDir>/apricity/` → classpath `assets/apricityui/apricity/` |
| 资源路径解析 | `Loader.java:64-85` | 相对当前文档目录解析；`/` 开头为根；拒绝 `..` 逃逸 |
| viewport meta | `AUI:viewport/ApricityViewport.java:57-80` | `mode`（browser/window/fixed）、`zoom/min-zoom/max-zoom` 等 |
| viewport 解析 | `ApricityViewport.java:82-120` | `mode=window/native/screen/fullscreen` → browser；`browser/css/web/default` → windowViewport |
| 渲染入口 | `AUI:render/Base.java`（`drawScreenDocument`） | 由 `ApricityScreen.render` 调用 |
| 帧调度 | `AUI:client/Client.java:50-75` | `Client.tick()` → `FrameScheduler.tick()`；每 Document `tickFrame()` |
| 页面脚本 | `AUI:spi/AuiScriptService.java:15-42` | `eval/evalGlobal/reload`；无引擎时空实现 |
| Forge 脚本服务 | AUI forge jar `com/sighs/apricityui/forge/ScriptService.class` | 优先 KubeJS，回退 Rhino；都无则跳过 |
| JS 缺失证据 | `forge/run/logs/latest.log:35` | `neither KubeJS nor a compatible Rhino runtime is present; page scripts are skipped (pages still render)` |
| AUI 页面渲染证据 | `forge/run/logs/latest.log:46-59,78-82` | `devtools/toast.html` create/layout/READY_PAINT |
| 现有编辑器屏 | `J:webui/WebPreviewScreen.java:40-350` | 外部 WebUI 的预览屏；与游戏内编辑器互斥 |
| 捕获挂点 | `MOD:mixin/GameRendererMixin.java:147-157` | `Gui.render` 之后；Screen 渲染在其后 |
| 世界窗口 | `AUI:world/WorldWindow.java:1-1112` | 世界内 3D 窗口；会进入世界渲染/捕获，**不能**用于编辑器 UI |
| 页面/元素 API | `AUI:init/Element.java`、`AUI:registry/annotation/ElementRegister.java` | 元素查找/事件/自定义元素入口（提案实现用） |

**已核对的缺口**：

1. **无 `EditorAuiScreen`**：`1.20.1` 分支没有 Screen 子类，`EditorMod` 只打日志。
2. **页面不存在**：`assets/apricityui/apricity/editor/index.html` 与 `<gameDir>/apricity/editor/index.html` 都没有；AUI 只能渲染它自带的 `devtools/toast.html`。
3. **页面脚本缺失**：Forge dev 环境无 KubeJS/Rhino；若页面用 JS 绑定交互，当前不执行。
4. **`ApricityScreen` 的关闭顺序**：`onClose()` 先 `document.remove()`（`ApricityScreen.java:182-193`），子类若在 `super.onClose()` 之后访问 `getLinkedDocument()` 会拿到已 disposed 的 Document。
5. **`removed()` 与 `onClose()` 双路径**：两者都 remove；子类必须共用 `teardown()`，且幂等。
6. **`setShowDefaultBackground` 默认 false**：HUD 保留（原版在 `screen != null` 时仍画 HUD）；需显式设置以防 AUI 版本变化。
7. **`pauseGame` 默认 false**：游戏继续 tick；编辑器播放需要游戏世界继续渲染。正确，但需确认不与 `WebPreviewScreen` 的 `isPauseScreen=false` 冲突（两者互斥）。
8. **viewport 默认 `browser`（1920×1080）**：编辑器工作台需要全屏；若不写 `aui-viewport` meta，默认可能是 1920×1080 固定 CSS 宽，窗口小时布局溢出。
9. **AUI 的 `Document` 会被 `FrameScheduler.tick()` 自动 tick**：编辑器不需要自己驱动，但也不能在 tick 外修改 DOM（线程/一致性）。
10. **与 `WebPreviewScreen` 互斥**：两者都是 `Screen`；同时只能有一个。打开编辑器前若 `WebPreviewScreen` 在栈中，需先关闭它（或禁止）。
11. **没有面板注册/布局挂载协议**：05-08 的抽屉协议是 WebUI 组件；AUI 需要 `EditorPanelRegistry`（提案）与元素树映射，否则 14-09 无处挂载。
12. **没有全功能页面骨架**：只做中央画布/标题不能承载图、时间轴、Inspector、抽屉；14-09 会退化成“宿主壳”。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| Screen | 无 | `EditorAuiScreen extends ApricityScreen`（提案） |
| 页面 | 无 | `assets/apricityui/apricity/editor/index.html` + `editor.css`（提案）；开发期可覆盖 `<gameDir>/apricity/editor/` |
| 工作台布局 | 无 | 顶栏、关系图入口、中央画面、片段效果控件、右侧快捷属性、下部主时间轴、抽屉、状态/错误区；效果控件与快捷属性独立停靠并可同时可见 |
| 面板注册 | 无 | `EditorPanelRegistry`；05-08 的抽屉/停靠按 AUI 元素树重实现 |
| 面板身份 | 无 | `clip.effects`（片段效果控件）与 `selection.properties`（快捷属性）分别注册，不共用旧object/keyframe标签 |
| 背景 | AUI 默认 false | 显式 `setShowDefaultBackground(false)`；`setPauseGame(false)` |
| viewport | 未设置 | 页面 `<meta name="aui-viewport" content="mode=browser;min-zoom=0.5;max-zoom=3">` |
| 脚本 | 无引擎 | 页面骨架不依赖 JS；交互由 Java 侧 `Element.addEventListener` 绑定（提案）；若必须 JS，引入 KubeJS/Rhino 并验证（不作为验收前提） |
| 关闭 | 无 | `EditorTeardown.run()` 在 `super.onClose()` 之前执行；`onClose`/`removed` 共用 |
| 互斥 | 无 | 打开编辑器前关闭 `WebPreviewScreen`；反之亦然 |
| 快捷键 | 无 | 编辑器键（默认 F8；F9 保留 WebUI）打开/关闭；ESC 关闭（飞控中先取消）；见 14-05 |
| 全功能承载 | 无 | 每个 14-09 模块有面板挂载点；主时间轴不承载属性行，效果控件承载多组多属性与局部标尺；14-09 未填满前不算完成 |

### 3.2 拟新建（提案）

- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorAuiScreen.java`（提案）
  - `extends ApricityScreen`
  - 构造：`super("editor/index.html")`；`setPauseGame(false)`；`setShowDefaultBackground(false)`。
  - `init()`：`super.init()` 后取 `getLinkedDocument()`，交给 `EditorShellController` 绑定页面元素；注册面板挂载点。
  - `keyPressed`：编辑器键/ESC 处理；飞控中 ESC 先取消；其余 `super.keyPressed`。
  - `onClose()`：`EditorTeardown.run(SCREEN_CLOSE)` → `super.onClose()`。
  - `removed()`：`EditorTeardown.run(SCREEN_CLOSE)` → `super.removed()`。
  - `resize()`：`super.resize()` 后通知布局控制器；不重载 Document。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorScreens.java`（提案）
  - `open()`：检查 `EditorHostApi.isEnabled()/modes()`；若当前 `Screen` 是 `WebPreviewScreen` 先关闭；`Minecraft.setScreen(new EditorAuiScreen())`。
  - `closeIfOpen(reason)`：世界退出/禁用/切换载体时调用。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorShellController.java`（提案）
  - 页面元素查找、顶栏/状态栏/错误区、面板注册、抽屉开合、图入口。
  - 不持有脚本文档权威；命令经 `EditorSignalBridge`。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorPanelRegistry.java`（提案）
  - 面板 id/标题/默认停靠位/创建/销毁；至少登记 `clip.effects` 与 `selection.properties` 两个独立身份；14-09 各控制器注册自己的面板。
- `INGAME:forge/src/main/resources/assets/apricityui/apricity/editor/index.html`（提案）
  - 静态骨架：顶栏（文档名/保存/校验/图入口）、中央预览容器（`editor-frame` 挂载点）、片段效果控件容器（`editor-effects`）、右侧快捷属性容器（`editor-inspector`）、下部主时间轴容器（`editor-timeline`）、抽屉容器、状态/错误区。
  - 效果控件与快捷属性各有独立停靠/尺寸状态，默认同时可见；主时间轴容器不生成属性行/对象展开/关键帧汇总。
  - `<meta name="aui-viewport" content="mode=browser;min-zoom=0.5;max-zoom=3">`。
  - 不使用需要页面 JS 的框架；元素 id/class 稳定，供 Java 绑定。
- `INGAME:forge/src/main/resources/assets/apricityui/apricity/editor/editor.css`（提案）
  - 使用 AUI 支持的 CSS 子集（flex/grid/变量/圆角/阴影）；不使用未验证的 `backdrop-filter` 等。
- **不新建**第二套 UI 框架；不把 Vue 产物塞进 AUI；不使用 `WorldWindow`。

## 4. 输入输出与字段约束

### 4.1 打开

输入：编辑器键（默认 F8）→ `EditorScreens.open()`。
输出：`Minecraft.setScreen(new EditorAuiScreen())`；`ApricityScreen.init()` 创建 `Document`；页面渲染。

约束：

- 若 `WebPreviewScreen` 正在打开，先关闭它（两者互斥）。
- 若 `Minecraft.level == null`（标题界面），不打开。
- 若 `EditorHostApi.isEnabled()==false` 或 `modes()` 不含 `INGAME`（03-08/03-10），不打开、不注册编辑器键；不得用 `WebEditorServer.isRunning()` 反推。
- 打开动作只建立 Screen/页面；端点/帧源订阅在 14-04/14-03 的 `init` 中按需建立，不在总开关开启时预启动。

### 4.2 页面路径

- 发布版：`assets/apricityui/apricity/editor/index.html`（classpath）。
- 开发期：`<gameDir>/apricity/editor/index.html` 覆盖（`Loader` 优先 dev 根/本地目录）。
- 资源相对路径：`editor/editor.css`、`editor/...`；不得 `../` 逃逸（`Loader.resolve`）。

### 4.3 viewport

- `mode=browser`（默认 1920×1080 CSS 宽，按窗口缩放）；或 `mode=window`（跟随窗口）。
- 编辑器工作台建议 `mode=browser`，保证 1920 宽布局；窗口小于 1920 时按 `renderScale` 缩放。
- 缩放范围 0.5–3；Ctrl +/-/0 由 AUI 处理。
- 布局保存的是面板尺寸/停靠/缩放（05-21/22），不是 OS 窗口状态；见 14-09 §4.13。

### 4.4 背景/HUD

- `setShowDefaultBackground(false)`：不画全屏半透明黑，HUD 保留。
- `setPauseGame(false)`：游戏继续 tick/渲染；编辑器播放由主模组控制。
- 不使用 `WorldWindow`/overlay 文档承载编辑器 UI。
- 捕获点在 `Gui.render` 之后、`Screen.render` 之前；编辑器 UI 不进入画面。

### 4.5 页面结构与面板挂载

| 区域 | 元素/挂载点（提案） | 负责控制器 | 14-09 模块 |
|---|---|---|---|
| 顶栏 | `#editor-header` | `EditorShellController`/`EditorDocumentController` | 05-02；01/02 |
| 图入口 | `#editor-graph-entry` | `EditorShellController`/`EditorGraphController` | 04/05-09 |
| 中央预览 | `#editor-frame` | `EditorFrameBinding`（14-03） | 14-03 |
| 片段效果控件 | `#editor-effects` | `EditorEffectControlsController`（14-09） | 06-ClipEffectControlsPanel、06-EffectControlsRows、06-ObjectPropertyList；07/08/09/10/11 的片段级入口 |
| 右侧快捷属性 | `#editor-inspector` | `EditorInspectorController`（14-09） | 06-PropertyValueForm、07/11 的快捷字段；无自有节点时间轴 |
| 下部主时间轴 | `#editor-timeline` | `EditorTimelineController`（14-09） | 05；只编排轨道/片段/标尺/播放头，不承载属性节点或对象行 |
| 抽屉 | `#editor-drawer` | `EditorPanelRegistry` | 05-08；10/11/12 |
| 状态/错误 | `#editor-status` | `EditorShellController` | 02/03/14-04 |
| 飞控 HUD | `#editor-flight-hud` | `EditorFlightBridge`（14-06） | 14-06/12-07 |

约束：

- 上表是 14 的最小承载面；14-09 不得新增“第二个工作台”。
- 每个区域在 `init()` 时必须存在；缺失则显示明确错误并记录，不静默跳过。
- 面板未实现时，14-02 可以不放入口；14 出口前必须由 14-09 补齐，不能留空按钮。
- 主时间轴元素只接收轨道/片段/标尺交互，不出现属性节点、对象展开或关键帧汇总；效果控件局部视口、左右行对齐与节点命中归 06/`EditorEffectControlsController`，不复用主时间轴全局视口。
- 两个面板共用同一 Selection/值控件/命令；任一面板可见不要求另一个隐藏。布局保存/恢复包含两面板停靠与尺寸，效果控件局部视口由 06 按文档会话+clipKey保存，不在壳里复制。

### 4.6 关闭

顺序：

1. `EditorTeardown.run(SCREEN_CLOSE)`（编辑器自有资源；见 14-07）。
2. `super.onClose()`（AUI 发 `unload`、`document.remove()`、清 viewport、光标）。
3. `Minecraft.setScreen(null)`（由 `Screen` 机制）。

约束：

- `teardown()` 幂等；`onClose`/`removed` 共用。
- 不在 `teardown()` 里 `document.remove()`（AUI 负责）。
- 不在 `super.onClose()` 之后访问 `getLinkedDocument()`。
- `teardown()` 只释放本端点：取消飞控仅当本端点是 owner；`sessions.detach(endpoint)` 不停止其他端点；不调用 `CaptureHub.close()`、不删除主模组纹理/共享 FBO。
- 总开关关闭时由统一入口调用 `EditorScreens.closeIfOpen(SWITCH_OFF)`，与 ESC/编辑器键走同一 `teardown()`；关闭后不得再注册编辑器键。
- 页面缺失/绑定失败：显示错误页（占位 + 原因 + 关闭提示），不崩溃；14-02 验收包含该负例。

## 5. 修改步骤

1. 新增 `EditorAuiScreen`/`EditorScreens`；在客户端初始化中注册键（14-05）。
2. 新增页面 HTML/CSS 与元素 id/class；确认 AUI 能加载并渲染（先静态骨架）。
3. 设置 viewport/背景/暂停；确认 HUD 保留。
4. 实现 `EditorShellController`/`EditorPanelRegistry`；绑定表 4.5 的元素；缺失元素报错。
5. 绑定页面元素（Java 侧 `Element.addEventListener` 或 AUI 的 DOM API）；若不可行，记录需要 KubeJS/Rhino 的前置（不作为验收前提）。
6. 实现 `EditorTeardown` 调用与互斥；接入 14-03/14-04/14-06 的 attach/subscribe/release；只释放本端点，不关闭 `CaptureHub`。
7. 世界退出时 `EditorScreens.closeIfOpen(WORLD_EXIT)`（14-07）；总开关关闭同样调用，且注销编辑器键。
8. 打开前检查 `EditorHostApi.isEnabled()` 与 `modes()`；不满足时显示原因，不创建 Screen/端点。
9. 14-09 逐模块填充面板；14-02 完成后仍以 14-09 为全功能出口。

## 6. 禁止修改

- 不改 AUI 的 `ApricityScreen`/`Document` 源码。
- 不用 `WorldWindow` 承载编辑器 UI。
- 不在 `Screen.render` 里做重计算/网络/文件 IO。
- 不把页面 JS 作为唯一交互入口（当前环境无引擎）。
- 不与 `WebPreviewScreen` 同时打开。
- 不在 `teardown()` 中调用 `CaptureHub.close()`、关闭主模组纹理、停止其他端点或广播 `flight.exit`。
- 不在总开关关闭时打开 Screen 或继续注册编辑器键；不用 `WebEditorServer.isRunning()` 判断是否允许打开。
- 不把 14-02 的壳当 14 完成；不保留空按钮/TODO 面板到 14 出口。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `EditorAuiScreen`、`EditorScreens`、`EditorShellController`、`EditorPanelRegistry`、页面资源 |
| 编辑器 `webui` | 不承载；共享布局/语义；05 的布局/主题合同是基线 |
| 主模组 `main` | 不承载；提供 `EditorFrameSource`/`EditorEndpoint`/`EditorFlightControl`（14-03/04/06） |

## 8. 前置

- 14-01 的 AUI 依赖声明与加载器。
- 14-03 的帧源、14-04 的信号端点、14-06 的飞控（`teardown` 需要它们）。
- AUI 1.3.1 的 `ApricityScreen`/`Document` 行为（已核对源码）。
- 13 的 WebUI 工作台/布局/主题验收通过；14 不重新定义布局语义。

## 9. 正反例验收

**正例 A**：编辑器键打开，AUI 页面渲染（日志 `[AUI Open]`/`[AUI Layout]`），无异常；游戏 HUD 仍可见。
**正例 B**：窗口缩放，页面按 viewport 缩放，不重载 Document（`init` 复用）。
**正例 C**：ESC 关闭，回到游戏；再次打开，页面状态不残留（或按设计重置）。
**正例 D**：从 `WebPreviewScreen` 切到编辑器，先关闭前者，无两个 Screen 叠加。
**正例 E**：页面仅静态 HTML/CSS 时也能渲染骨架（不依赖 JS）。
**正例 F**：总开关关闭按编辑器键 → 不创建 Screen、不注册键、不 attach 端点；开启后才打开。
**正例 G**：关闭本 Screen → 只 detach 本端点、释放本租约；其他端点/`CaptureHub` 不受影响；重复关闭无异常。
**正例H**：表4.5的9个挂载点存在，clip.effects与selection.properties分别注册且可同时可见；14-09面板可独立打开/停靠，主轴不含节点入口。
**正例 I**：页面缺失 → 明确错误页，不崩溃；关闭后回到游戏。

**反例 A**：页面路径不存在 → AUI 日志 `cannot create document: template is missing`；不崩溃（可接受，但必须有错误页/提示）。
**反例 B**：`super.onClose()` 之后访问 `getLinkedDocument()` → 已 disposed；验收不通过。
**反例 C**：用 `WorldWindow` 承载编辑器 UI → 世界渲染阶段进入捕获，预览套娃；验收不通过。
**反例 D**：`setShowDefaultBackground(true)` → 全屏黑盖住 HUD；与「HUD 保留」目标冲突。
**反例 E**：`setPauseGame(true)` → 游戏世界停止渲染，编辑器画面静止；验收不通过。
**反例 F**：总开关关闭仍能打开 Screen/仍注册编辑器键 → 验收不通过。
**反例 G**：关闭 Screen 时调用 `CaptureHub.close()` 或停止其他端点 → 验收不通过。
**反例 H**：页面只有标题/空 div，14-09 无挂载点 → 14 出口不通过。
**反例 I**：只做中央画面 + 一个空 Inspector，宣称“工作台完成” → 不通过；14-09 必须填满。

## 10. 真实游戏冒烟（未执行）

前置：Forge 1.20.1 dev run + AUI 1.3.1 + 14-01 加载器。

1. 编辑器键打开/关闭 10 次，检查日志与 Screen 栈。
2. 缩放窗口，确认布局/缩放正确、无 Document 重载。
3. 打开 `WebPreviewScreen` 再按编辑器键，确认互斥。
4. 退出世界，确认 Screen 关闭、无残留。
5. 观察捕获画面（14-03 接入后）中无编辑器 UI。
6. 关闭总开关，确认编辑器键不打开、入口不响应；再次开启可打开。
7. 关闭 Screen 后确认端点 detach、租约释放，且主模组 `CaptureHub` 未关闭。
8. 删除页面文件做对照，确认错误页/提示；恢复后可打开。
9. 逐个检查表 4.5 的挂载点存在；14-09 阶段再验证面板真实内容。

**本轮未执行**：无 Forge 运行环境；以上为 14-08 统一冒烟的一部分。

## 11. 完成定义

- `EditorAuiScreen` 的打开/关闭/互斥/背景/HUD/viewport 行为有明确实现点与验收。
- 打开前置包含 `EditorHostApi.isEnabled()/modes()`；总开关关闭不创建 Screen/端点/键。
- 页面路径与 AUI `Loader` 解析规则一致；开发期覆盖可用；无 JS 也能渲染与绑定。
- 关闭顺序正确（teardown 先于 `super.onClose`）；幂等；只释放本端点资源，不关闭 `CaptureHub`。
- 表 4.5 的工作台区域/面板挂载点真实存在；14-09 可逐模块填充，不另起第二个工作台。
- 页面缺失/绑定失败/重复打开/与 WebUI 预览屏冲突有明确错误行为。
- 14-02 单独完成不等于 14 完成；14-09 的全功能矩阵通过才是 14 出口。
- 未执行的真实冒烟明确标注。
