# 14 Forge 1.20.1 + AUI 游戏内宿主迁移

> 状态：未实现（仅计划；本轮是 13 通过后的迁移执行轮，不与 WebUI 同步开发）
> 轮次：14-aui-forge-migration
> 启动门禁：`../13-webui-acceptance-release/README.md` 全部出口通过；01–12 的 WebUI 能力已验收
> 范围：Forge 1.20.1 的**游戏内编辑器宿主迁移**——AUI 承载全功能工作台、进程内 GPU 画面、与 WebUI 同语义的进程内信号、飞控与输入路由、关闭/禁用/世界退出与载体一致性，并把 01–12 的全部编辑能力逐项迁移。游戏内 Fabric + AUI 明确暂缓，不纳入验收，但保留骨架；WebUI→Fabric 不受影响。
> 关联：shared/implementation-order、editor-package-modes、host-scope、contracts及manual-acceptance；公共实现前置见[14-00](14-00-public-api-prerequisite.md)，启动门禁见[13 WebUI完成](../13-webui-acceptance-release/README.md)。

**路径记号**：

- `MOD:` = 主模组仓库相对路径（`E:/Documents/GitHub/ImmersiveCinematics/common/src/main/java/com/immersivecinematics/immersive_cinematics/`）。
- `J:` = 主模组当前 `webui` 实现的源码根（事实证据；例如 `J:webui/WebEditorApi.java`）。本轮保留这些路径用于对照，**不把旧包名当目标结构**。
- `INGAME:` = 编辑器仓库 **1.20.1 分支** 的仓库相对路径（用 `git show 1.20.1:<path>` 读取，不是当前 webui 工作树）。
- `AUI:` = ApricityUI 1.3.1 的 `com/sighs/apricityui/` 源码（本地只读来源见 14-01；版本事实以 `example/[晴雪UI] ApricityUI-forge-1.20.1-1.3.1.jar` 为准）。
- `ED:` = 编辑器仓库当前 WebUI 前端源码相对路径。

目标包结构以 [../shared/editor-package-modes.md](../shared/editor-package-modes.md) 为准：主模组由 `webui` 迁为 `editor`，内部 `editor.webui`/`editor.ingame`；`api/editor` 是对外稳定合同。**当前 `J:webui/...` 是事实，`editor.*` 是目标提案，不能声称已存在。**

## 一、摘要

14 轮只做一件事：把已经在 WebUI 完整实现并验收的编辑器能力，迁移到 Forge 1.20.1 + AUI 的游戏内宿主。它不是第二个编辑器，也不是“WebUI 和 AUI 同时开发”的一轮；在同一份文档模型、schema、消息与生成语义上，UI 由 AUI 的 HTML/CSS 渲染，画面由主模组捕获纹理在同进程内消费，信号走 `api/editor` 的进程内实现（`EditorEndpoint`/`EditorPush`/`EditorSessionApi`/`EditorFrameSource`/`EditorFlightControl`），不经过 `127.0.0.1:8765`。

本轮执行14-00公共接口前置及14-01～14-09迁移任务：先落实公共端口与宿主链，再人工垂直切片，最后全功能逐模块迁移/人工使用对账。不能只完成壳或接口文字；全部在13 WebUI打磨通过后启动。

## 二、为什么做

### 2.1 问题

- 外部 Electron 编辑器必须切窗口；作者改脚本、看画面、再切回游戏，一轮迭代成本高。
- 跨进程预览固定 1080p60 H.264：有编码延迟、带宽、ffmpeg 依赖；无 ffmpeg 时 RGBA 回退带宽高。
- 飞控仍要回游戏原生画面操作，编辑器只显示状态；游戏内宿主可以把「编辑 UI + 真实画面 + 飞控」放在同一个 Screen 里。
- `1.20.1` 分支只有 Gradle 骨架与 `EditorMod` 日志；AUI 1.3.1 已作为依赖接入并能渲染自带页面，但**没有**编辑器 Screen、画面源、信号端口、飞控/输入/释放实现。
- `mods.toml` 未声明 `apricityui`；生产环境缺 AUI 时会在类加载期失败，而不是给出缺少前置的提示。
- AUI 页面脚本需要 KubeJS/Rhino；当前 Forge dev 环境两者都没有，页面脚本被跳过（页面仍渲染）。因此游戏内交互不能依赖页面 JS。
- 主模组消息路由仍绑定 `WebSocketSession`（包私有），推送仍硬编码 `broadcastText`/`session.sendText`；没有进程内端点，也没有 ack/能力位。
- `CaptureHub` 只有 CPU 读回，没有 GPU 纹理出口；游戏内零拷贝画面无法实现。
- 飞控退出依赖 `WebPreviewScreen.activeScreen`；没有屏幕时退出无效，且旧广播语义会让非发起窗口误写回。
- 没有统一总开关/模式状态；`WebEditorServer.isRunning()` 只对 webui 传输有意义，不能代表整个编辑器启用。
- 没有全功能迁移矩阵；只做宿主壳会漏掉图、异步对象、七轨、规则/事实、模板/纯数据、字幕批次、主题/可动布局、保存恢复等能力。

### 2.2 目标

1. **顺序正确**：01–12 建设并验收 WebUI；13 完成 WebUI 全量验收与发布基线；13 通过后才启动 14。14 不补做 WebUI 功能，不把 14 的缺口倒推成 03/13 的前置。
2. **宿主真实**：游戏内按编辑器键（默认 F8；F9 保留 WebUI）打开 AUI 工作台；中央是真实游戏画面（含 HUD、lane 合成、调色，不含编辑器 UI），同进程、零拷贝、不截图轮询。
3. **语义同一**：脚本列表/加载/保存/校验、schema、资源、图、播放控制、飞控状态与 WebUI 使用同一套消息名与字段；差异只在传输载体（进程内调用 vs WebSocket）。
4. **全功能迁移**：01–12的标准模型、项目图、七轨片段主轴、统一效果控件clip.effects/独立快捷属性selection.properties、局部视口/多组独立节点、路径/镜头/覆盖/音频/行为/模板/字幕、主题停靠/保存恢复全部有AUI承载与人工验收；遵守[C17](../shared/effect-controls-workspace.md)，不退回主轴对象行或单属性独占页。
5. **生命周期干净**：总开关关闭时不注册编辑器入口/键、不打开 Screen、不 attach 端点、不订阅帧源；开启也不预启动，只有真正进入 `editor.ingame` 才建立资源。关闭/禁用/世界退出只释放本端点拥有的资源，重复关闭幂等。
6. **所有权明确**：飞控同一时刻一个 owner，`flight.exit` 只发 owner；帧租约只借用主模组纹理，generation 失效即停止绘制；关键回执可靠或明确失败，不静默丢。
7. **边界诚实**：游戏内 Fabric + AUI 暂缓；系统窗口/LUT 桌面导出按宿主能力说明，不静默删除；WebUI→Forge 与 WebUI→Fabric 仍正常。

### 2.3 非目标

- 不重写 AUI；不修改 AUI jar；不把 AUI 内部类（`Document`/`Element`/`Window`/`ApricityScreen`）泄漏成主模组 `api/editor` 的类型。
- 不恢复旧游戏内 Java 编辑器；不做第二套字段模型/消息/撤销栈。
- 不做游戏内 Fabric AUI 适配（暂缓）；不因此禁用 WebUI 的 Fabric 连接或少做 WebUI 功能。
- 不做世界内 3D 网页面板（`WorldWindow`）作为编辑器 UI；它会进入捕获画面，造成套娃。
- 不在 14 内新增编辑语义；01–12 未验收的能力回原轮，不在 AUI 里临时补。
- 不在本轮修改代码；本目录是实施合同，所有新类/接口均为提案。

## 三、方案

### 3.1 执行顺序与门禁

| 阶段 | 轮次/任务 | 必须完成 | 不进入下一阶段的条件 |
|---|---|---|---|
| WebUI 功能建设 | 01–12 | WebUI 全部点名能力、错误路径、真实游戏冒烟；WebUI→Forge/Fabric 正常 | 任一必做任务未验收 |
| WebUI 收口 | 13-webui-acceptance-release | 黄金脚本、应用/字幕端到端、WebUI→Forge/Fabric 真实验证、发布基线 | 任一必做场景失败/未验证 |
| AUI 宿主链 | 14-01～14-07 | 加载器、Screen、GPU 帧源、进程内信号、输入、飞控、释放 | 任一宿主链任务不可运行 |
| 垂直切片 | 14-08 | 真实游戏 14 步切片 | 任一步无证据/失败 |
| 全功能迁移 | 14-09 | 01–12 逐模块迁移矩阵与全量验收 | 任一模块为空壳/缺失/语义漂移 |

`14-08` 是 `14-09` 的宿主门禁；`14-09` 是 14 轮出口。14-09 不通过，14 不算完成，也不能用“宿主已经能开”代替。

### 3.2 从使用者视角

1. 总开关开启；游戏内按编辑器键（默认 F8，F9 保留 WebUI）打开 AUI 工作台：顶栏、中央真实画面、右侧属性/关键帧、下部时间轴、抽屉（图/模板/资源/字幕/诊断）。
2. 打开时主模组把当前捕获纹理交给编辑器（同进程、零拷贝）；编辑器把纹理画在中央区域；HUD 由脚本 `screen_layers` 决定，编辑器不额外隐藏/显示。
3. 编辑器通过进程内端点发 `script.list`/`script.load`/`schema.get`/`editor.pushScript`/`editor.seek`/`editor.play` 等；主模组用同一个消息路由回答（不经过 socket）。推送 `playback.state`/`preview.stats`/`flight.state`/`flight.exit` 走同一套 JSON；`flight.exit` 只发 owner。
4. 飞控：编辑器发 `editor.enter_flight_mode`（带选中片段在播放头处的姿态）；游戏端逐字段回落；飞控会话绑定发起端点，退出/取消只回推该端点；该端点写回选中关键帧，其他端点不写回。
5. 关闭（ESC/编辑器键）：取消本端点拥有的飞控、退出编辑器播放、释放本端点的帧源租约与纹理注册、移除输入拦截、detach 端点、`Document.remove()`（由 AUI）；再次打开不残留。不关闭共享 `CaptureHub`。
6. 退出世界/断线/总开关关闭：与关闭相同的释放；不留下 Document、纹理、监听器、端点、输入状态。
7. 全功能：图、异步对象、七轨、路径/数学、镜头/转场、覆盖层/合成、音频/调色、触发/规则/事件、模板/纯数据、字幕批次、主题/可动布局、保存恢复都在 AUI 可用；系统窗口/LUT 桌面导出按 14-09 的边界说明。

### 3.3 迁移原则

- 创作状态仍属独立编辑器：文档/撤销/序列化/模板/字幕批次在编辑器核心，AUI视图调用该核心；主模组只提供schema/文件/校验/播放/画面/事实等权威服务，不能把整个创作内核搬回主模组。
- **同一套消息**：不新增第二套消息名/字段/信封；进程内与 WebSocket 适配同一语义。
- **无页面 JS 依赖**：当前 AUI 无 KubeJS/Rhino；交互由 Java 侧元素事件/ DOM 更新完成，页面脚本只能作为可选增强。
- **按需资源**：总开关开启不等于启动；只有进入模式/打开 Screen 才 attach 端点、订阅帧源、注册纹理、注册输入。
- **只释放自己**：端点级 detach 不停止服务、不关其他端点、不关 `CaptureHub`；飞控只发 owner。
- **真实证据**：每步有画面/日志/消息/文件证据；不以构建成功、类存在、WebUI 截图代替。

## 四、技术细节

### 4.1 核心模型

| 对象 | 归属 | 职责 | 现状锚点 |
|---|---|---|---|
| 加载器入口 | 编辑器模组 | Forge `@Mod` 构造 → `EditorCommon.init()` | `INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java:6-12`；`INGAME:common/.../EditorCommon.java:8-17` |
| 平台服务 | 编辑器模组 | `ServiceLoader` 选 `IPlatformHelper` | `INGAME:common/.../platform/Services.java:12-24`；`forge/.../ForgePlatformHelper.java:7-26` |
| AUI 依赖 | 编辑器模组 | `implementation fg.deobf("com.sighs:ApricityUI-forge-1.20.1:1.3.1")`，不打包 | `INGAME:forge/build.gradle:67-68`；`gradle.properties:7,21` |
| AUI Screen | AUI | `ApricityScreen` 创建 `Document`、viewport、render、输入、关闭 | `AUI:screen/ApricityScreen.java:24-220` |
| AUI 门面 | AUI | `ApricityUI.screen(path)` / `closeScreen()` / `ensureDocument` | `AUI:ApricityUI.java:52-126` |
| Document 生命周期 | AUI | `Document.create/remove/disposeLifecycle` | `AUI:init/Document.java:243-289,766-799`；`AUI:dom/DocumentRegistry.java:54-179` |
| 纹理元素 | AUI | `<texture src="...">` 从 MC 纹理管理器取纹理绘制 | `AUI:element/Texture.java:21-98` |
| 渲染服务 | AUI | `AuiServices.render()`；`registerTexture`/`createDynamicTexture`/`closeTexture`/`releaseTexture` | `AUI:spi/AuiServices.java:137-155`；`AUI:spi/AuiRenderService.java:152-207` |
| 输入 | AUI | mixin → `Client.handleKeyInput/handleMouseButton` → `Operation`/`MouseEvent` | `AUI:mixin/KeyboardHandlerMixin.java:14-20`；`MouseHandlerMixin.java:14-22`；`AUI:client/Client.java:124-180` |
| 页面根 | AUI | `<gameDir>/apricity/` 或 classpath `assets/apricityui/apricity/` | `AUI:loader/Loader.java:28-56` |
| 捕获 | 主模组 | `CaptureHub` 固定 1080p60，CPU 读回；无 GPU 纹理出口 | `MOD:media/capture/CaptureHub.java:41-541` |
| 捕获挂点 | 主模组 | `Gui.render` 之后（HUD 后、Screen 前） | `MOD:mixin/GameRendererMixin.java:147-157` |
| 现有消息路由 | 主模组 | `WebEditorApi.handle(String, WebSocketSession)`（包私有参数） | `J:webui/WebEditorApi.java:21-93` |
| 现有预览屏 | 主模组 | `WebPreviewScreen` 的打开/关闭/飞控入口 | `J:webui/WebPreviewScreen.java:40-350,337-350` |
| 飞控 | 主模组 | `FlightModeManager` 与界面解耦 | `MOD:control/FlightModeManager.java:15-123` |
| 编辑器播放 | 主模组 | `CameraManager` 的编辑器播放方法 | `MOD:camera/CameraManager.java:181-200` |
| 目标公共合同 | 主模组 `api/editor` | `EditorEndpoint`/`EditorPush`/`EditorSessionApi`/`EditorFrameSource`/`EditorPlaybackControl`/`EditorFlightControl`/`EditorHostApi`（提案） | `../03-host-transport/03-08-editor-host-contract.md` §3.1–3.7 |
| 目标 ingame 适配 | 主模组 `editor.ingame` | 进程内端点/推送/帧源/飞控适配（提案） | `../shared/editor-package-modes.md` §4.1a；本次 14-03/04/06 |
| 目标 AUI UI | 编辑器 `client` | `EditorAuiScreen`/`Editor*Controller`（提案） | 本次 14-02/14-09 |

### 4.2 契约

- **创建**：编辑器键（默认 F8）→ 统一入口（`EditorHostApi.isEnabled()/modes()`）→ `EditorScreens.open()` → `new EditorAuiScreen("editor/index.html")` → `Minecraft.setScreen(...)`；`ApricityScreen.init()` 创建/复用 `Document`。
- **画面**：主模组 `EditorFrameSource.acquire()` 返回当前捕获纹理（提案）；编辑器把纹理包装成 AUI 可绘制元素/纹理注册，在 generation 变化时重建；关闭时释放本租约/本注册，不关闭主模组纹理。
- **信号**：编辑器实现 `EditorEndpoint`（进程内），调用主模组 `EditorSessionApi.handle(json, endpoint)`；推送由主模组 `EditorPush` 发给该端点。消息名/字段与 WebSocket 完全一致。
- **飞控**：`EditorFlightControl.enter(endpointId,...)` 逐字段回落；同一时刻一个 owner；`exit(endpointId, record)` 只允许 owner；`flight.exit` 只发 owner，不广播。
- **播放**：`EditorPlaybackControl` 提供 `pushScript/seek/play/pause/stop/setCamera/timeSeconds/isPlaying`；进程内不新建第二套播放时钟。
- **销毁**：`EditorAuiScreen.onClose()/removed()` → `EditorTeardown.run(...)`（取消 owner 飞控、退出播放、detach 端点、释放租约/纹理注册、恢复输入/焦点/光标）→ `super.onClose()` 由 AUI `Document.remove()`；幂等，不重复 remove。
- **总开关**：由 `EditorHostApi.isEnabled()`/`modes()`（03-08/03-10）决定本模式是否允许；Screen 打开、键消费、帧源订阅均以它为前置。禁止用 `WebEditorServer.isRunning()` 代表整个编辑器启用。
- **按需资源**：总开关开启不启动 webui 服务、不打开 Screen、不 attach 端点、不订阅帧源；只有真正进入对应模式/打开 Screen 才建立。关闭一种消费方不释放另一消费方的资源。

### 4.3 数据形态

- 页面：`assets/apricityui/apricity/editor/index.html` + CSS + 可选 JS（打包在编辑器模组 jar）；开发期可覆盖 `<gameDir>/apricity/editor/index.html`（`Loader.getResourceStream` 优先 dev 根）。
- 画面：GL 纹理 id + 宽高 + generation + frameId + ptsNanos + flipY + opaqueAlpha（`EditorFrameSource.FrameLease`）。
- 信号：与 WebUI 相同的 `{type,data,id}` JSON；无二进制帧。
- 状态：`playback.state` 50ms、`flight.state` 100ms、`preview.stats` 1000ms（同 WebUI 节流；进程内也保持，避免 UI 过载）。
- 主题/布局/偏好：编辑器本地存储（提案路径 `<gameDir>/config/immersive_cinematics_editor/`），不写脚本；布局树/停靠/主题/草稿恢复按 05.20–23 语义。

### 4.4 边界

- 编辑器 UI 只在 `Screen` 层；不用 `WorldWindow`（会进入捕获，套娃）、不用 overlay 文档（Screen 打开时不绘制）。
- AUI 不获得任意文件系统/命令执行/主模组私有类；所有脚本/资源操作经 `EditorSessionApi` 的消息。
- 主模组不依赖 AUI；`api/editor` 只用 JDK 类型与主模组 `api`/`spi` 类型。专用服务端不加载 AUI/客户端编辑器类。
- Fabric AUI 宿主不实现；Fabric 骨架保留；WebUI→Fabric 仍按 13 基线回归。
- 系统窗口/LUT 桌面导出按 14-09 §4.13 说明；其余能力不因宿主差异删除。

### 4.5 与 03 合同、13 验收的关系

- 03落实统一editor管理与当前WebUI共享边界，未来ingame契约参考03-08；进程内公共实现/GPU前置归14-00，不是03或13验收门槛。
- **14 落地真实实现**：`EditorFrameSource` 的 GPU 消费者、`IngameEditorEndpoint/Push`、`EditorFlightControl` 的 ingame 适配、`EditorAuiScreen`/输入/释放都在 14。若 03 只有合同，14 先实现合同再验；不得用反射私有类/CPU 读回/空 release 充数。
- **13 是 14 的输入**：13 已验收的 WebUI 能力是迁移基线；14 不重新定义字段/消息，13 未通过的项回原轮，不用 14 的 AUI 掩盖。
- **14 不阻塞 WebUI**：14 的 AUI 缺口不影响 WebUI→Forge/Fabric；同样，WebUI 的 Fabric 通路不因游戏内 Fabric AUI 暂缓而缩减。

### 4.6 关键风险与控制

| 风险 | 控制 |
|---|---|
| AUI API 非稳定（1.3.1） | 适配层隔离 `ApricityScreen`/`Document`/`RenderService`；版本锁定；升级跑 14-08/09 回归 |
| AUI 页面无 JS 运行时 | 交互 Java 侧绑定；验收不依赖页面脚本；需要 JS 时明确前置，不静默失败 |
| AUI CSS 子集/性能未知 | 14-02/14-09 实测布局/滚动/拖动/大图；不假设 Vue 可复用；不达标回任务优化 |
| GPU 帧源未实现 | 14-03 真实落地；禁止 CPU 读回/截图冒充；generation/租约合同 |
| 消息仍绑 WebSocket | 14-04 落地 `EditorEndpoint`/`EditorPush`/`SessionApi`；不访问包私有类 |
| 飞控退出依赖 Screen | 14-06 落地 `EditorFlightControl`；owner 定向；不广播 |
| 关闭误伤共享资源 | 14-07 所有权表/一致性矩阵；只释放本端点；`CaptureHub` 不关 |
| 只做宿主壳 | 14-09 全功能矩阵 + 全量对账；01–12 每任务有迁移去向/验收 |
| 系统窗口/LUT 桌面导出 | 14-09 §4.13 明确说明；不静默删、不假实现 |

## 五、为什么不选别的

| 备选方案 | 做法 | 代价 | 为什么没选 |
|---|---|---|---|
| 用 `<iframe>` + WebView2 跑现有 Vue dist | AUI 的 `Iframe` + `WebViewBridge` | UI 在另一个进程；游戏画面要再跨进程送进 WebView2；两套 UI 技术栈；WebView2 仅 Windows | 违背「进程内画面」；增加像素传输与生命周期复杂度 |
| 用 `WorldWindow` 世界内面板 | 3D 空间里的 HTML 面板 | 世界渲染阶段绘制，会进入捕获画面（套娃）；交互/缩放/遮挡复杂 | 编辑器需要全屏工作台，不是世界内装饰 |
| 继续用 Electron 嵌进游戏 | 外部窗口覆盖 | 不是游戏内；仍需跨进程帧流 | 不满足「不切窗口」目标 |
| 重写 AUI 或自研 UI 框架 | 自己写 HTML/CSS 渲染 | 工作量巨大；AUI 已支持 Forge 1.20.1 | 直接依赖 AUI，锁版本 |
| 把 Vue 产物直接跑在 AUI 的 Rhino | 复用前端 | Rhino 不支持 Vue 3 运行时（Proxy/ESM/现代语法）；无 KubeJS/Rhino 时页面脚本被跳过 | 需要 AUI 原生 HTML/CSS 页面，或引入 KubeJS/Rhino 并验证兼容性 |
| 把游戏内宿主做成第二个独立编辑器/第二套开关 | 复制 WebUI 的服务与状态 | 两套模型/协议/开关，资源与写回不一致 | 统一 `editor` 包内 `editor.ingame` 模式，共享 `api/editor`、消息与总开关 |
| WebUI 与 AUI 同步开发/同步验收 | 每轮两套 UI | 未验证的 AUI 能力会阻塞 WebUI，故障范围扩大 | 用户明确先完成 WebUI；14 在 13 通过后启动 |

**本方案的缺点**：

- AUI 的 HTML/CSS 子集与浏览器不同：布局/滤镜/滚动/输入行为需要逐项验证；不能假设 Vue 组件可直接复用。
- AUI 1.3.1 不是稳定 API：升级可能破坏 `ApricityScreen`/`Document`/`RenderService` 签名；需要适配层与版本锁定。
- 页面脚本依赖 KubeJS/Rhino（当前 Forge dev 环境缺失），若 UI 需要动态逻辑，要么引入前置，要么用 Java 侧驱动 DOM。
- 同进程 GPU 画面需要主模组新增 `EditorFrameSource`/GPU 消费者；14-03 必须真实落地，否则只能用 CPU 读回，违背目标。
- 全功能迁移需要逐模块控制器与实测（大图/长时间轴/输入），工作量集中在 14-09；但这是“不是空壳”的必要代价。

## 六、实现结果

状态：未实现（仅计划）。`1.20.1` 分支的加载器骨架与 AUI 依赖已存在（不是 14 交付）；AUI 在 Forge dev run 可加载并渲染自带页面（日志证据），但编辑器 Screen/画面/信号/飞控/释放均未实现。本轮只写文档，未修改任何代码，未运行 Gradle/游戏/验收，不预填通过。

| 原设计 | 实际实现 | 偏离原因 |
|---|---|---|
| 游戏内编辑器由 AUI 附属模组承载 | 只有 `EditorMod` 日志骨架；无 Screen | 规划中；14-02 交付 |
| 进程内 GPU 画面 | `CaptureHub` 只有 CPU 读回，无纹理出口 | 14-03 交付；03 只冻结合同 |
| 与 WebUI 同语义信号 | 消息路由绑定 `WebSocketSession`（包私有） | 14-04 交付；03 只冻结合同 |
| 关闭/禁用只释放本端点 | 无 Screen/端点/租约实现；现有 WebUI 关闭以宿主为单位 | 14-07 交付；03-07 提供 WebUI 基线 |
| 统一 `editor` 包与总开关 | 只有 `webui` 包与 `EditorMod` 日志；无 editor 入口 | 03-10 定义；14 消费；本轮不实现 |
| 全功能 AUI | 无页面/无控制器；WebUI 能力已验收 | 14-09 矩阵待执行 |
| 系统窗口/LUT 桌面导出 | 宿主不适用 | 14-09 §4.13 说明；不删除其他能力 |
| Fabric 与 Forge 同能力 | Fabric 骨架保留，AUI Fabric 无法启动 | 用户裁决暂停；不纳入验收；不影响 WebUI→Fabric |

## 任务索引

| 文件 | 职责 | 关键风险/缺口 |
|---|---|---|
| [14-00-public-api-prerequisite.md](14-00-public-api-prerequisite.md) | 迁移公共契约/所有权与实际API前置落实 | 由一个集成所有者冻结；GPU/信号/飞控执行分别接14-03/04/06，不留无任务所有者缺口 |
| [14-01-forge-loader-skeleton.md](14-01-forge-loader-skeleton.md) | Forge 1.20.1 骨架、AUI 依赖/版本、mods.toml/mixins/services、Fabric 暂停 | `mods.toml` 未声明 `apricityui`；AUI API 非稳定；专用服务端不得加载 AUI |
| [14-02-aui-host-screen.md](14-02-aui-host-screen.md) | `ApricityScreen` 子类、全功能页面壳、viewport、背景/HUD、打开/关闭/互斥 | AUI 页面脚本缺失；`Document` 复用/释放；不能只交空壳 |
| [14-03-inprocess-frame-source.md](14-03-inprocess-frame-source.md) | 捕获纹理 → AUI 纹理、GPU 消费者、generation、flipY/alpha、失败占位、租约释放 | `CaptureHub` 无纹理 getter；需 `EditorFrameSource` 真实实现；禁止 CPU 读回冒充 |
| [14-04-inprocess-signal-endpoint.md](14-04-inprocess-signal-endpoint.md) | `EditorEndpoint`/`EditorPush`/`SessionApi` 进程内实现、消息族、节流、ack、错误 | `WebEditorApi` 绑死 `WebSocketSession`；无 ack；关键回执不能静默丢 |
| [14-05-input-focus-routing.md](14-05-input-focus-routing.md) | AUI 输入 mixin、Screen 层、编辑器键/ESC/飞控键、鼠标、焦点、玩家输入 | 两套键位冲突；按键被 AUI 消费；关闭/禁用时输入释放未实现 |
| [14-06-flight-mode-inprocess.md](14-06-flight-mode-inprocess.md) | 飞控进入/退出/写回、HUD、10Hz、owner 端点定向、RELATIVE 基准 | `requestFlightExit` 依赖 `WebPreviewScreen`；旧广播语义会误写回 |
| [14-07-teardown-carrier-consistency.md](14-07-teardown-carrier-consistency.md) | 关闭/禁用/世界退出、租约与输入释放、幂等、WebUI↔ingame 载体一致性矩阵 | Document/纹理/监听器/静态缓存；只释放本端点拥有资源 |
| [14-08-forge-vertical-slice-acceptance.md](14-08-forge-vertical-slice-acceptance.md) | Forge 真实游戏 14 步垂直切片（画面/HUD/信号/编辑/飞控/保存/关闭/禁用/WebUI 回归） | 需 14-01～14-07 真实落地；不得用 WebUI 结果代替；是 14-09 门禁 |
| [14-09-full-feature-migration.md](14-09-full-feature-migration.md) | 01–12 全功能迁移矩阵：图/异步/七轨/路径/镜头/覆盖/音频/规则/模板/字幕/主题布局/保存恢复 | 不能只做宿主壳；系统窗口/LUT 桌面导出按边界说明；每模块需正反例 |

## 本轮出口

- 14-00公共前置与14-01～14-09全部闭合；以人工实际使用验证垂直切片和全量迁移矩阵，不以步骤完整/空壳或自动化测试代替。
- 01–12每项能力在14-09有明确去向、类/输入输出/人工验收；主轴不画节点，效果控件多对象组/独立节点/局部视口/轴外完整可用，快捷属性同值回显且无第二节点轴；其他七轨、图、路径/镜头/音频/行为/模板/字幕/布局能力不减少。
- 游戏内 Forge+AUI 真实可打开、使用、保存、播放、飞控、关闭；只暂缓游戏内 Fabric+AUI，不影响 WebUI→Forge/Fabric。
- 总开关与按需生命周期落地：关闭时不打开 Screen/不注册编辑器入口/不 attach 端点/不订阅帧源；`WebEditorServer.isRunning()` 不代表编辑器启用。
- 各模式资源按需建立；关闭一种消费方不释放另一消费方资源；关闭/禁用/换世界只释放本端点：不调用 `CaptureHub.close()`、不广播 `flight.exit`、不取消他人飞控。
- 飞控 owner 唯一；`flight.exit` 只发 owner；RELATIVE 写回基准正确；关键回执可靠或明确失败，帧/可合并状态可丢旧。
- 帧租约/generation：租约真实幂等释放；generation 失效后不画旧纹理；只释放本订阅/本注册，不关闭主模组纹理。
- 错误路径真实：非法 schema/字段、保存失败不半写、请求超时、未知消息、AUI 页面缺失、缺 AUI 前置、端点断连均有明确行为；不以“后续补”关闭。
- 系统窗口/LUT 桌面导出按 14-09 §4.13 说明；不静默删除其他能力；不把宿主限制扩大为功能缺失。
- 未执行的真实冒烟明确标注；不预填通过，不用 WebUI 记录代替 ingame 证据。
