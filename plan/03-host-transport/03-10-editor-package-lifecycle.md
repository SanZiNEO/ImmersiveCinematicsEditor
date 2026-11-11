# 03-10 editor 统一包、总开关与双模式按需生命周期

> 状态：未实现（仅计划；当前源码仍是 `J:webui/`，`editor` 包、总开关与模式入口均不存在）
> 轮次：03-host-transport
> 关联：03-02/03/05/07/08、shared/editor-package-modes、shared/implementation-order；未来ingame实现见[14-00](../14-aui-forge-migration/14-00-public-api-prerequisite.md)。

## 1. 职责

冻结三件事，不实现代码：

1. `J:webui/` 到统一 `editor` 包的职责划分与迁移顺序：`editor` 是编辑器的管理边界，内部有 `editor.webui`（跨进程 WebSocket/编码传输）与 `editor.ingame`（游戏内进程内端点/帧源/输入/飞控适配）两种模式。
2. 唯一总开关：它决定编辑器能力是否可用，**不能**再由 `WebEditorServer.isRunning()`、`WebPreviewScreen` 是否存在或某个 WebSocket 会话是否连上代表。
3. 两种模式的按需生命周期与所有权：总开关开启只表示允许使用；每个模式在真正进入时建立自己的资源，退出时只释放自己拥有的资源。

03落实统一editor包/唯一入口/总开关与webui按需生命周期；ingame只约定未实现的能力边界，不创建空端点/GPU适配。13完整验收WebUI后，14才按14-00实现ingame，双模式命名不代表同步开发。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 旧包全部类 | `MOD:webui/` 14 个文件 | `WebEditorApi`、`WebEditorServer`、`WebSocketSession`、`WebPreviewScreen`、`PreviewStreamer`、`PreviewEncoder`、`PreviewProtocol`、`PreviewConfig`、`H264AuSplitter`、`OutboundQueue`、`ScriptFileService`、`ResourceFileService`、`WebRegistryService`、`ScriptGraphService` |
| 唯一服务入口 | `MOD:webui/WebEditorServer.java:73,100-145` | `INSTANCE`；`start()`/`stop()`；只有 webui 传输，没有编辑器总状态 |
| 唯一外部宿主屏 | `MOD:webui/WebPreviewScreen.java:40-350` | `activeScreen` 静态字段；F9 打开；`onClose()` 释放；没有 `removed()` |
| 编辑器开关 | `MOD:Config.java`（grep 无 `editor` 命中） | 0.3.6 已删除 `editorEnabled`；当前无任何总开关 |
| 运行时通信 | `MOD:webui/WebEditorApi.java:31-93` | `handle(String, WebSocketSession)`；消息族固定 |
| 捕获消费者 | `MOD:webui/PreviewStreamer.java:30-33,99-176` | `CaptureHub.Consumer` 单例；帧只在 webui 模式消费 |
| 游戏内宿主骨架 | `INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java:6-12` | 只打日志；无 Screen/端点/帧源 |
| 游戏内平台入口 | `INGAME:common/.../EditorCommon.java:8-17` | 只打日志；没有 `editor` 包与模式状态 |
| AUI 依赖 | `INGAME:forge/build.gradle:67-68` | 附属模组依赖，主模组不得依赖 AUI |
| 客户端键位 | `MOD:control/CinematicKeyBindings.java:29-48,67-73` | F9 直接 `new WebPreviewScreen()`；没有开关判断 |
| 世界退出清理 | `MOD:handler/ClientEventHandler.java:135-176` | 不含 `WebPreviewScreen`/`WebEditorServer`/`PreviewStreamer` |
| 专用服务端 | `MOD:server/`（专用服务端入口） | 不加载 AUI/客户端 Screen；目标保持 |

**已核对的缺口**：

1. **包名把传输当整体**：`webui` 包既含传输（`WebEditorServer`/`WebSocketSession`/`PreviewEncoder`），又含脚本/资源/图服务（`ScriptFileService` 等），13 的进程内宿主若直接 `import` 只能拿到整个旧包，无法表达「共享服务 + 两种传输」。
2. **没有总开关**：`CinematicKeyBindings` 的 F9 无条件打开 `WebPreviewScreen`（`CinematicKeyBindings.java:67-73`）；`WebPreviewScreen.init()` 无条件 `start()` 服务（`WebPreviewScreen.java:56-60`）。
3. **启用被传输状态代表**：外部只能通过 `WebEditorServer.isRunning()`/`hasClients()`（`WebEditorServer.java:86-95`）猜测编辑器状态；关闭服务会被误读为「编辑器关闭」。
4. **没有按需启动**：一旦进入 WebUI 屏就注册 `PreviewStreamer` 为捕获消费者（`WebPreviewScreen.java:56-70`），即使没有编辑器客户端、甚至没有画面消费；ingame 模式没有对应入口。
5. **两种模式没有共同的所有者**：WebUI 由 `WebPreviewScreen` 管，ingame 骨架没有生命周期；世界退出时两者都不保证释放（`ClientEventHandler.java:135-176`）。
6. **资源所有权混在宿主代码里**：`WebPreviewScreen.onClose()` 直接调用 `PreviewStreamer.close()`/`WebEditorServer.stop()`（`WebPreviewScreen.java:337-350`），没有区分「关闭本模式」与「关闭整个编辑器」，也没有端点级 detach。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 包结构 | 单一 `webui` 包，传输与服务混在一起 | `editor` 根 + `editor.webui` + `editor.ingame` + 共享服务层 + `api/editor`；旧包干净迁移，无兼容垫片 |
| 启用状态 | 无开关；服务在跑即像「启用」 | `EditorHostApi.isEnabled()` 唯一判定；`WebEditorServer.isRunning()` 仅诊断 webui 传输 |
| 模式 | 只有 WebUI 外部屏 | `EditorMode.WEBUI`/`EditorMode.INGAME`；`modes()` 报告本环境可用模式，不等于已启动 |
| 资源建立 | 打开屏即启动服务/捕获 | 进入模式时按需建立；没有客户端/没有消费时不启动编码器、不订阅帧 |
| 关闭 | 一个 `onClose()` 关掉全部 | 宿主级 teardown 与端点级 detach 分离；只释放本模式/本端点拥有的资源 |
| 世界退出 | 不清理 | 统一入口关闭当前模式；总开关关闭释放两模式 |
| 服务端 | 与客户端类同包 | 专用服务端不加载 AUI/客户端 Screen；`api/editor` 只用 JDK/主模组公共类型 |

### 3.2 目标职责（与 shared 文档对齐）

| 目标职责 | 放置 | 迁移要求 |
|---|---|---|
| 编辑器统一入口/生命周期 | `editor` 根（提案 `EditorLifecycle`/`EditorHostImpl`） | 唯一总开关、模式能力、打开/关闭、世界退出/禁用清理；只有这一个所有者 |
| 共享脚本/schema/资源/图与消息路由 | `editor.shared`（提案） | 不依赖 `WebSocketSession`/AUI 类型；两模式调用同一语义 |
| 外部传输 | `editor.webui` | `WebEditorServer`/`WebSocketSession`/`PreviewStreamer`/`PreviewEncoder`/`OutboundQueue` 等；保留 Web 命名 |
| 游戏内适配 | `editor.ingame` | 进程内端点/帧源/输入/飞控公共适配；不依赖外部 WebPreviewScreen |
| 公共契约 | `api/editor` | 附属模组只依赖此包，不读内部实现 |

迁移顺序（不得跳步）：

1. 先冻结 `api/editor`（03-08）与开关合同（本文）；
2. 把共享服务从 `webui` 抽到 `editor.shared`，调用方改用接口；
3. 把 WebSocket/编码/预览屏收进 `editor.webui`，`WebEditorServer` 降为模式传输；
4. 13完整打磨验收WebUI后，14再实现editor.ingame Forge适配，不在03写空实现；
5. 删除旧 `webui` 包与过时再导出；消息名、脚本 JSON 字段不因包改名改变。

## 4. 输入输出与字段约束

### 4.1 总开关

| 项 | 合同 |
|---|---|
| 键名 | 提案；实施时结合现有 `Config` 命名确定。本文不假称已存在 |
| 默认 | 开启（沿 Z 轮既定设计） |
| 作用域 | 客户端；专用服务端不加载客户端编辑器类，也不读取客户端开关 |
| 关闭输入 | 配置变更或命令入口 |
| 关闭输出 | 两模式均不可进入；不注册编辑器专用按键/入口；不启动 8765；不注册捕获消费者；不 attach 进程内端点；不加载编辑器专用资源 |
| 已开启时关闭 | 对当前模式执行宿主级 teardown；对另一模式执行其 teardown（若曾按需启动）；释放 token；注销按键；重复调用幂等 |
| 不影响 | 普通脚本解析/触发/播放、游戏渲染、`CaptureHub` 本体、其他模组/消费者 |
| 禁止 | 用 `WebEditorServer.isRunning()`、`hasClients()` 或 Screen 栈顶反推 `isEnabled()` |

### 4.2 模式能力

| 模式 | 入口 | 按需建立 | 关闭释放 | 当前状态 |
|---|---|---|---|---|
| `WEBUI` | F9/`EditorScreens.openWebui()`（提案） | `WebEditorServer.start()`、token、`PreviewStreamer` 注册、`WebPreviewScreen` | 本模式会话、编码器、Token、捕获消费者、Screen | 已有实现，待重构 |
| `INGAME` | F9/`EditorScreens.openIngame()`（提案） | `EditorAuiScreen`、进程内 `EditorEndpoint`、`EditorFrameSource` 租约、输入路由 | 端点 detach、租约释放、输入释放、Screen/Document | 仅骨架；Forge 适配归 13 |
| 未实现模式 | — | 不启动、不伪造 | — | `modes()` 不报告；UI 显示原因 |

约束：

- 总开关开启不强制启动任何模式；`WebEditorServer.start()` 只在进入 `WEBUI` 且确有客户端消费时调用（会话握手仍由服务端完成）。
- `modes()` 是能力集合，不是运行集合；`WEBUI` 可用与 8765 是否在监听是两件事。
- `Fabric` 主模组的 WebUI 通路正常；`modes()` 不因游戏内 AUI 故障把 `WEBUI` 标为不可用。
- 同一时刻两种模式可以都「允许」，但 Screen 层互斥（13-02）；资源按各自所有权独立释放。

### 4.3 端点所有权

| 资源 | 所有者 | 释放者 | 禁止 |
|---|---|---|---|
| WebSocket 连接/会话 | 该端点 | `WebSocketSession.close()`/`EditorSessionApi.detach` | 用会话关闭停止服务、关闭其他会话 |
| `PreviewStreamer.SessionStream`/编码器 | 该会话 | `onSessionClosed`/`closeStream` | 用其关闭 `PreviewStreamer` 或 `CaptureHub` |
| `PreviewStreamer` 自身 | `editor.webui` 模式 | 模式 teardown | 单端点 detach 时 close |
| `EditorFrameSource.FrameLease` | 订阅端点 | 端点 detach/元素卸载时 `release()` | 关闭主模组纹理、空实现 release |
| 飞控会话 | 发起端点（owner） | owner 退出/Screen 关闭 | 非 owner 关闭时取消；广播 `flight.exit` |
| `CaptureHub`/FBO/纹理 | 主模组宿主 | 宿主生命周期 | 编辑器任何路径调用 `CaptureHub.close()` |
| 编辑器按键/入口 | 统一入口 | 总开关关闭/世界退出 | 进入模式前预先注册并常驻 |
| AUI `Document` | AUI | `ApricityScreen.onClose/removed` | 编辑器重复 `remove()` 或关闭后再访问 |

### 4.4 关键文本与帧

- 命令回执、`script.saved`/`script.validate.result`、`flight.exit`：可靠发送或明确断开/失败；不得静默丢。
- `playback.state`/`flight.state`/`preview.stats`：可合并、可丢旧；节流只影响频率，最后一次最终状态应可到达。
- 帧：可丢旧；不得用旧帧冒充新 seek 结果；暂停补帧失败显示「等待画面」。

## 5. 修改步骤（实施顺序）

1. 新增 `api/editor` 接口（03-08）并把 `EditorHostApi.isEnabled()/modes()` 落为唯一启用判定；`Config` 增加客户端总开关（提案名）。
2. 新建 `editor` 根生命周期（提案 `EditorLifecycle`）：持有总开关、当前模式、打开/关闭、世界退出与禁用；不持有 `CaptureHub` 所有权。
3. 把 `WebPreviewScreen` 改为 `editor.webui` 的模式屏：`init()` 只启动本模式传输；`onClose()`/`removed()` 共用幂等 `teardown()`；不调用 `CaptureHub.close()`。
4. `CinematicKeyBindings` 的 F9 先查 `isEnabled()` 与 `modes()`，再决定打开哪种模式；关闭时注销编辑器专用键。
5. `ClientEventHandler` 世界退出调用 `EditorLifecycle.closeCurrentMode()`（或等价），不直接操作服务/捕获。
6. 把 `ScriptFileService`/`ResourceFileService`/`WebRegistryService`/`ScriptGraphService` 与 `WebEditorApi` 的共享部分迁到 `editor.shared`；`editor.webui` 只保留传输适配。
7. 删除旧 `webui` 包及其调用方引用；不保留同名再导出/兼容垫片；日志与正式文档同步。
8. 14在13全部通过后接入ingame，复用唯一开关，不把其环境/接口设为03前置。

## 6. 禁止修改

- 不把 `editor` 改名后仍以 `WebEditorServer` 为编辑器中心。
- 不用 `WebEditorServer.isRunning()`/`hasClients()`/Screen 存在性代表 `isEnabled()`。
- 不在总开关关闭时注册编辑器键、启动服务、注册捕获消费者或 attach 进程内端点。
- 不在单端点关闭时停止服务、关闭 `CaptureHub`、删除共享纹理或取消他人飞控。
- 不把 `flight.exit` 广播给所有会话/端点。
- 不把关键回执降级为可丢状态推送。
- 不让主模组依赖 AUI；不让专用服务端加载客户端/AUI 类。
- 不因包迁移改变消息名、脚本 JSON 字段或 schema。
- 不在本轮修改代码或执行迁移。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 主模组 `main` | `editor` 包（目标）、统一入口、总开关、共享服务、`api/editor`；旧 `webui` 迁移与删除 |
| 编辑器 `webui` | 外部 Electron 客户端；不感知 Java 包名，只依赖消息协议 |
| 编辑器1.20.1方向 | 仅14后置实现ingame适配，复用已稳定WebUI语义与唯一开关，不作为03前置 |

## 8. 前置

- 03-08 的接口提案评审通过；03-09 指定公共接口所有者。
- 共享服务迁移前，先核对 `ScriptFileService`/`ScriptGraphService` 的实际调用方与路径规则（03-06）。
- 13 的 `EditorAuiScreen`/帧源/端点任务依赖本文的 `EditorLifecycle` 与 `modes()`。
- 真实实施需要主模组写入授权；未获授权时只完成可达的 WebUI 工作，游戏内前置明确阻塞。

## 9. 正反例验收

**正例 A**：总开关关闭启动游戏；F9 无反应、8765 未监听、日志无 `IC-WebUI` 服务启动；普通脚本可播放。
**正例 B**：总开关开启但未按 F9；8765 未监听、无 `PreviewStreamer` 捕获消费者；进入 F9 后才监听并注册。
**正例 C**：WebUI 模式关闭后 `WebEditorServer.isRunning()==false`，但 `isEnabled()==true` 且 `modes()` 仍含 `WEBUI`；再次 F9 正常。
**正例 D**：两个 WebUI 窗口，关闭一个；另一个继续出帧，`CaptureHub` 消费者表仍含 `PreviewStreamer`。
**正例 E**：总开关关闭时 `modes()` 为空；`EditorSessionApi` 不接受新 attach；已 attach 端点全部 detach；重复关闭无异常。
**正例 F**：包迁移后调用方只依赖 `api/editor` 与共享服务接口；旧 `webui` 类无残留 import。

**反例 A**：用 `WebEditorServer.isRunning()` 实现 `isEnabled()` → 关闭 WebUI 模式后编辑器被误判为关闭；验收不通过。
**反例 B**：总开关关闭后仍注册 F9/仍启动 8765 → 验收不通过。
**反例 C**：关闭一个会话时调用 `CaptureHub.close()` → 其他消费者黑屏；验收不通过。
**反例 D**：迁移后保留 `webui` 包的转发类/旧字段别名 → 违反干净切换；验收不通过。
**反例 E**：总开关关闭时把普通脚本播放一起停掉 → 验收不通过。

## 10. 真实冒烟（未执行）

WebUI本轮冒烟仅需实际主模组与Electron/相应编码环境；ingame的AUI Screen/GPU/输入与迁移验证在13完成后由14执行，不能同步要求。

1. 总开关关闭启动客户端，进世界：确认无编辑器键/服务/捕获；普通脚本播放正常。
2. 开启开关，未按 F9：确认 8765 未监听、无 `PreviewStreamer` 注册。
3. 按 F9 进入 WebUI：确认按需启动、Electron 连接、出帧；关闭后服务停止、token 删除。
4. 两个 Electron 窗口：关闭一个，确认另一个继续出帧且 `CaptureHub` 未关闭。
5. 关闭总开关（编辑器打开时）：确认两模式释放、重复关闭幂等、普通播放不受影响。
6. 退出世界/重进：确认无残留服务、捕获消费者、按键、token。
7. 包迁移后重复 1–6，确认消息名/脚本字段未变。

**本轮未执行**：仅写计划；无 Forge/Electron 运行环境，未执行 Gradle/游戏/冒烟。ingame 部分依赖 13 与主模组前置，当前也不可达。

## 11. 完成定义

- `editor` 包职责、`webui`/`ingame` 模式与总开关的落点、迁移顺序明确；与 `shared/editor-package-modes.md` 无矛盾。
- `isEnabled()` 与 `WebEditorServer.isRunning()` 的语义分离有正反例；总开关关闭不注册/不启动/不捕获有验收。
- 资源所有权表覆盖会话、编码器、`PreviewStreamer`、帧租约、飞控、`CaptureHub`、按键、AUI Document；单端点/总关闭的释放范围可判定。
- 关键文本可靠、帧可丢旧、命令失败明确三项写入合同。
- 真实冒烟步骤完整但明确标注未执行；未把计划当成通过。
