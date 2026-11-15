# R14-02 AUI 宿主 Screen 与工作台壳

> 前置：R14-01 附属模组可加载；`F6` 统一入口可用
> 后续：R14-03 帧源、R14-04 端点、R14-05 输入、R14-06 飞控、R14-07 释放
> 状态：设计合同；真实渲染未执行时不填 PASS

## 1. 职责

创建一个 `EditorAuiScreen extends ApricityScreen`，作为游戏内编辑器的工作台壳：

- 加载 `editor/index.html` 页面；
- 设置 viewport、HUD、暂停、光标；
- 绑定顶栏、中央画面、`clip.effects`、`selection.properties`、主时间轴、抽屉、状态栏的挂载点；
- 打开时只建立 Screen/页面；端点、帧源、输入、飞控由后续任务按需接入；
- 关闭时走 R14-07 的统一 teardown，不在这里自造释放顺序。

本文件不写各面板业务；R14-09 逐模块填充。

## 2. 当前事实

### 2.1 AUI Screen

`ApricityScreen` 1.3.1 事实：

| 事实 | 说明 |
|---|---|
| 构造 | `ApricityScreen(String templatePath)` |
| 默认暂停 | `pauseGame=false`；`isPauseScreen()` 返回该值 |
| 默认背景 | `showDefaultBackground=false`；不画全屏半透明黑 |
| Document | `init()` 在 `linkedDocument==null || !isActive()` 时 `Document.create(path, timing)`；否则复用 |
| resize | 复用 Document，只 `applyViewport(true)`；不重载页面 |
| render | 可选背景；`Base.drawScreenDocument`；`ScreenDocumentCache.attach`；光标 |
| keyPressed | reload 键、Ctrl +/-/0 缩放；其余 `super.keyPressed` |
| onClose | 发 `unload`、`linkedDocument.remove()`、清 viewport、光标 |
| removed | 再次 `remove()`；置 null；清 viewport |
| 暂停语义 | `setPauseGame(false)`：游戏继续 tick/渲染，编辑器播放需要世界继续 |
| HUD | `screen != null` 时原版仍画 HUD；显式保持 `setShowDefaultBackground(false)` |

### 2.2 页面根

AUI 页面根为：

- classpath：`assets/apricityui/apricity/editor/index.html`
- 开发期覆盖：`<gameDir>/apricity/editor/index.html`

当前没有 `editor/index.html`；R14 新建。页面不依赖 Vue/现代 JS；AUI 当前无 KubeJS/Rhino，页面脚本不可作为交互前提。

### 2.3 捕获与 UI 的关系

- `CaptureHub` 挂点在 `Gui.render` 之后、`Screen.render` 之前。
- 打开 `EditorAuiScreen` 后，Screen UI 在捕获之后绘制，不会进入捕获画面。
- 不能用 `WorldWindow` 承载编辑器 UI；WorldWindow 会进入世界渲染/捕获，造成套娃。

## 3. 方案

### 3.1 打开流程

```text
F6
  -> EditorEntry.open()
  -> activeCarrier = INGAME
  -> EditorCarrier.open()
  -> EditorScreens.open()
       -> 检查总开关 / modes() 含 INGAME
       -> 检查 Minecraft.level != null
       -> 若 WebPreviewScreen 或其他编辑器 Screen 在栈中，先 closeIfOpen
       -> Minecraft.setScreen(new EditorAuiScreen())
```

约束：

- 只允许一个编辑器 Screen；AUI 与 WebUI 互斥。
- 标题界面/未进世界不打开；不创建端点/租约。
- 总开关关闭时不打开；`F6` 处理器首行检查 `EditorHostApi.isEnabled()`/`modes()`。
- 打开动作不 attach 端点、不订阅帧源、不注册全局输入；这些在 `init()` 成功后按需建立。
- 页面加载失败时显示错误页，不崩溃；错误页可关闭。

### 3.2 Screen 生命周期

```text
init()
  super.init()
  document = getLinkedDocument()
  if document == null -> 错误页
  EditorShellController.bind(document)
  EditorPanelRegistry.mount(document)
  // 后续：EditorFrameSource.acquire / EditorEndpoint.attach

resize()
  super.resize()
  EditorShellController.onResize()

keyPressed()
  ESC / F6 / F7 / 飞控键
  其余交给 super.keyPressed（AUI）

onClose()
  EditorTeardown.run(SCREEN_CLOSE)   // 必须在 super.onClose() 之前
  super.onClose()

removed()
  EditorTeardown.run(SCREEN_CLOSE)
  super.removed()
```

关键：

- AUI `onClose()` 会先 `linkedDocument.remove()`；子类 teardown 必须在 `super.onClose()` 之前完成，否则拿不到 Document/元素。
- `onClose`/`removed` 共用幂等 teardown；重复关闭不能二次释放/误取消飞控。
- `teardown` 只释放本 Screen 的资源；不调用 `CaptureHub.close()`、不停止 `WebEditorServer`、不广播 `flight.exit`。

### 3.3 页面结构

`editor/index.html` 必须包含：

| 元素 id | 用途 | 归属 |
|---|---|---|
| `#editor-root` | 根容器，主题/缩放作用域 | Screen 壳 |
| `#topbar` | 项目名、保存、校验、播放控制、载体/设置入口 | R4/R5 |
| `#graph-entry` | 项目图/关系图入口 | R5 |
| `#preview-surface` | 中央真实游戏画面容器（AUI 纹理挂这里） | R14-03 |
| `#clip-effects` | 片段效果控件（多组多属性、局部标尺） | R6 |
| `#selection-properties` | 独立快捷属性 | R6 |
| `#timeline` | 片段主时间轴；不承载对象行/关键帧节点 | R5/R6 |
| `#drawer-host` | 图/模板/资源/字幕/诊断抽屉 | R5/R12/R11 |
| `#statusbar` | 播放状态、飞控 owner、错误/警告 | R4/R14-04 |
| `#error-overlay` | 页面/绑定/帧源错误 | 本任务 |

约束：

- `clip.effects` 与 `selection.properties` 是两个独立面板，可同时可见；不共用旧 `object/keyframe` 标签。
- 主时间轴只编排片段；不出现对象子行、节点菱形、汇总帧带。
- 页面不引用外部 CDN、不加载 Vue 运行时、不依赖页面 JS 完成核心交互。
- 页面 CSS 只用 AUI 支持的属性；复杂效果先做静态骨架，R14-09 再补。

### 3.4 主题/布局/偏好

- 主题 token 映射为 AUI CSS 变量/根 class；切换主题不重建 Document。
- 布局树映射为元素尺寸/顺序/可见性；拖动/停靠用 AUI 鼠标事件，R14-05 统一输入。
- 偏好/布局/主题写入游戏配置目录（主模组编辑器配置或附属模组自己的 JSON），不使用浏览器 `localStorage`。
- 页面不直接读写文件；所有持久化通过主模组/编辑器核心服务。

### 3.5 错误页

必须覆盖：

| 场景 | 表现 |
|---|---|
| 页面缺失 | 错误页：路径、原因、关闭提示；不空白 |
| 元素 id 缺失 | 错误页/状态栏红条：缺失 id；不静默跳过 |
| Document 创建失败 | 错误页；不进入面板绑定 |
| 帧源无帧 | 中央占位 + “等待游戏画面”；不黑屏崩溃 |
| 端点 attach 失败 | 状态栏错误 + 关闭；不假装已连接 |

错误页本身是 AUI HTML；不依赖 JS。

## 4. 输入输出

### 4.1 输入

- `EditorEntry.activeCarrier = INGAME`；`EditorHostApi.isEnabled()`；`modes()` 含 `INGAME`。
- AUI 页面与 CSS；`ApricityScreen` 的 `Document`/viewport/close 行为。
- R14-03 帧源、R14-04 端点、R14-05 输入、R14-06 飞控、R14-07 teardown 的句柄。

### 4.2 输出

- `EditorAuiScreen` 可打开/关闭；工作台壳渲染。
- 面板挂载点存在；`EditorShellController`/`EditorPanelRegistry` 可绑定。
- 打开/关闭/互斥/错误页行为可验收。
- 不产生端点/租约，除非后续任务在 `init` 中接入。

### 4.3 禁止

- 不用 `WorldWindow` 承载编辑器 UI。
- 不在 `render()` 里做文件 IO/网络/重计算。
- 不把页面 JS 作为唯一交互入口。
- 不与 `WebPreviewScreen` 同时打开。
- 不把 `F6` 写成第二个专用键；`F6` 只走 `EditorEntry`。
- 不在 `onClose()` 里先 `super.onClose()` 再访问 Document。

## 5. 验收

### 5.1 正例

**正例 A**：进世界后 `F6` 打开 AUI；顶栏、中央画面容器、两面板、时间轴、抽屉、状态栏、错误层均存在。

**正例 B**：`setPauseGame(false)`、`setShowDefaultBackground(false)`；游戏继续渲染，HUD 保留，中央画面有内容（帧源接入后）。

**正例 C**：页面缺失 → 明确错误页；关闭后回到游戏；再次打开正常。

**正例 D**：从 WebUI 切到 AUI：先关闭 `WebPreviewScreen`，再打开 AUI；无两个 Screen 叠加。

**正例 E**：`F6` 关闭 → 回到游戏；再次 `F6` 打开，页面状态不残留（或按设计重置）。

**正例 F**：`clip.effects` 与 `selection.properties` 可同时可见；主时间轴没有对象行/节点。

**正例 G**：总开关关闭时按 `F6` → 不创建 Screen、不 attach、不订阅；开启后才可打开。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| `setPauseGame(true)` | 失败：世界停止渲染，画面静止 |
| `setShowDefaultBackground(true)` | 失败：全屏黑盖住 HUD |
| 页面用 Vue/JS 才能出骨架 | 失败：当前 AUI 无 JS 引擎 |
| `onClose()` 先 `super` 再 teardown | 失败：Document 已被移除 |
| 只重写 `onClose`、不重写 `removed` | 失败：退世界路径不释放 |
| 两个编辑器 Screen 同时存在 | 失败：载体互斥 |
| 页面元素缺失静默通过 | 失败：必须可见错误 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| AUI Screen 打开 | NOT RUN | 待执行 |
| HUD/暂停/背景 | NOT RUN | 待执行 |
| 页面骨架/挂载点 | NOT RUN | 待执行 |
| 互斥/关闭/重开 | NOT RUN | 待执行 |
| 错误页 | NOT RUN | 待执行 |
