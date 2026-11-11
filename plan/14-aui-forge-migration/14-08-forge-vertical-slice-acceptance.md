# 14-08 Forge 真实游戏垂直切片验收

> 状态：未实现（仅计划；14 是 13 通过后的迁移执行轮）
> 轮次：14-aui-forge-migration
> 前置：14-01～14-07 各有可运行实现；`../13-webui-acceptance-release/README.md` 全部出口通过
> 关联：`README.md`、`14-01-forge-loader-skeleton.md`、`14-02-aui-host-screen.md`、`14-03-inprocess-frame-source.md`、`14-04-inprocess-signal-endpoint.md`、`14-05-input-focus-routing.md`、`14-06-flight-mode-inprocess.md`、`14-07-teardown-carrier-consistency.md`、`../03-host-transport/03-08-editor-host-contract.md` §5

## 1. 职责

在真实 Forge 1.20.1 客户端里跑通游戏内编辑器宿主链的第一条可验收切片：加载器与 AUI → 总开关 → Screen/页面 → 真实游戏画面 → 进程内信号 → 基本编辑/保存 → 播放 → 飞控 → 错误路径 → 关闭/禁用/世界退出 → 与 WebUI 隔离。它是 14-09 全功能迁移前的**宿主门禁**：本任务不通过，14-09 不得宣布完成。

本任务不是“步骤清单走一遍”。每一步都必须有可观察结果（日志、消息、画面、文件变化）；任一步无证据即失败，不能用“代码已写”“WebUI 已验证”代替。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| Forge 骨架 | `INGAME:forge/src/main/java/com/immersivecinematics/editor/EditorMod.java:6-12` | 只有日志；以下实现均为 14 交付 |
| AUI 依赖 | `INGAME:forge/build.gradle:67-68` | `implementation fg.deobf(...1.3.1)`；未在 `mods.toml` 声明 |
| AUI dev 加载 | `forge/run/logs/latest.log:24-29,46-59` | AUI 可加载/渲染；编辑器 Screen 未接 |
| AUI JS 缺失 | `forge/run/logs/latest.log:35` | 无 KubeJS/Rhino，页面脚本跳过；页面仍渲染 |
| 捕获 | `MOD:media/capture/CaptureHub.java:41-541` | CPU 读回；无 GPU 纹理出口 |
| 捕获挂点 | `MOD:mixin/GameRendererMixin.java:147-157` | `Gui.render` 之后、`Screen` 之前 |
| 现有信号 | `J:webui/WebEditorApi.java:21-93` | `handle(String, WebSocketSession)`；包私有参数 |
| 飞控 | `MOD:control/FlightModeManager.java:15-123` | 与界面解耦；退出入口仍绑 `WebPreviewScreen` |
| WebUI 关屏 | `J:webui/WebPreviewScreen.java:337-350` | 现有宿主级关闭顺序 |
| 公共合同 | `../03-host-transport/03-08-editor-host-contract.md` §3.1–3.7 | 七类接口；**03 只冻结合同，ingame 实现由 14 落地** |

**已核对的缺口**：

1. 没有 `EditorAuiScreen`/页面/输入，F8（或选定编辑器键）不会打开任何东西。
2. 没有 `EditorFrameSource`/GPU 消费者；画面只能 CPU 读回，不能作为进程内切片。
3. 没有进程内 `EditorEndpoint`/`EditorPush`/`EditorSessionApi.attach`；消息只能走 WebSocket。
4. 没有 `EditorFlightControl`；`exit` 依赖 `WebPreviewScreen.activeScreen`。
5. 没有 `EditorTeardown`；关闭/禁用/世界退出无实现。
6. 没有能力位/ack；无法在切片中区分“成功/超时/断开”。
7. 现有 WebUI 验收（13）不覆盖游戏内 Screen/AUI/GPU；不得用其通过记录代替本任务。

## 3. 差异与提案

### 3.1 门禁关系

| 阶段 | 任务 | 通过后才允许 |
|---|---|---|
| 宿主链 | 14-01～14-07 | 本任务 14-08 |
| 垂直切片 | 14-08（本任务） | 14-09 全功能迁移 |
| 全功能迁移 | 14-09 | 14 轮出口 |

本任务只验证“一条最小但真实的全链路”，不要求 01–12 的所有面板已迁移；但已迁移的部分必须真实可用，不允许占位按钮/假数据。14-09 负责把所有能力填满并对账。

### 3.2 环境与版本

| 项 | 值 | 约束 |
|---|---|---|
| MC | 1.20.1 | 主模组与编辑器模组一致 |
| Forge | 47.4.16 | AUI 要求 `[47,)` |
| AUI | 1.3.1 Forge | 不替换 jar；不加 KubeJS/Rhino 作为验收前提 |
| Java | 17 | 构建/运行一致 |
| 主模组 | 含 `api/editor` 的构建 | 不得用反射访问 `webui` 包私有类型 |
| 编辑器模组 | 14-01 构建产物 | `mods.toml` 声明 `apricityui` |
| 运行目录 | `INGAME:forge/run` | dev run；发布版另验 |

### 3.3 证据要求

每一步记录：

- 操作（按键/命令/点击/文件改动）。
- 观察（游戏内画面、AUI 日志、主模组日志、消息文本、脚本文件 diff）。
- 结果（通过/失败/阻塞）。
- 证据路径（截图/日志片段/消息 id/文件路径）。

禁止用以下代替：仅“构建成功”、仅“日志有一行”、仅“WebUI 截图”、仅“类已存在”、仅“面板能打开但无数据”。

## 4. 输入输出与字段约束

### 4.1 14 步切片

| # | 操作 | 必须观察到 | 失败判定 |
|---|---|---|---|
| 1 | 构建主模组与编辑器 Forge 模组；启动 Forge 1.20.1 client | 构建成功；client 进入主菜单；无 `NoClassDefFoundError`/mixin 崩溃 | 构建失败/启动崩溃/缺依赖未提示 |
| 2 | 检查加载器：`mods.toml` 的 `apricityui` 依赖、AUI 加载日志、编辑器日志 | Forge 识别 AUI 1.3.1；编辑器初始化日志；无 Fabric AUI 参与 | 缺 AUI 仍进入游戏；或 AUI 未加载 |
| 3 | 总开关关闭启动：不按编辑器键 | 无编辑器 Screen/端点/帧源订阅；无 8765 由 ingame 启动；普通脚本仍可播放 | 关闭态仍注册入口/订阅/启动服务 |
| 4 | 开启总开关；按 ingame 编辑器键（默认 F8；F9 保留 WebUI，见 14-05） | `EditorAuiScreen` 打开；页面 `/editor/index.html` 渲染；viewport 正确；HUD 可见；游戏未暂停 | 无 Screen/页面缺失/黑屏/暂停游戏/两个 Screen 叠加 |
| 5 | 观察中央画面；移动视角/播放已有脚本；检查画面内容 | 中央显示真实游戏画面（HUD、lane 合成、调色）；帧随游戏更新；画面中无编辑器 UI（顶栏/时间轴/属性） | 黑屏/截图轮询/CPU 读回冒充/编辑器 UI 套娃 |
| 6 | 发 `hello`；依次 `script.list`/`script.load`/`schema.get`/`resource.list`/`script.graph` | `hello_ack{version,schemaHash,capabilities}`；各回执字段与 WebUI 同语义；无 WebSocket 参与 | 消息名/字段不一致；无回执；走 8765 |
| 7 | 打开片段，主轴只选/移片段；效果控件同时展开位置/朝向等两组，改一标量和一个独立节点；快捷属性改同一目标，撤销/重做/保存重开 | clip.effects与selection.properties独立可用，同值回显、一次命令；主轴无节点/对象行，轴外仅局部查看，不拉宽主轴片段；标准文档重开一致 | 单属性独占页/主轴汇总点、左右行错位、第二份选择/值、旧格式或保存丢失 |
| 8 | `editor.pushScript`/`seek`/`play`/`pause`/`stop`；观察 `playback.state` 与画面 | 播放头/画面同步；`playback.state` 约 50ms；ack 成功；停止后状态正确 | 画面不动/状态不推/命令假成功 |
| 9 | 选中 CAMERA 片段，`editor.enter_flight_mode`；移动/滚转/缩放/FOV；退出保存；观察写回 | `flight.state` 约 10Hz 且 HUD 更新；`flight.exit{cancelled:false}` 只到本端点；选中关键帧写回；`pushScript` 后画面更新 | 无退出入口/广播 `flight.exit`/每帧写关键帧/RELATIVE 基准错误 |
| 10 | 错误路径：非法字段值；保存失败（只读/非法路径）；请求超时；未知消息 | 具体错误定位/错误回执；保存失败不半写；超时 15s 明确失败；未知 type 返回 `error` | 静默失败/假成功/半写/无错误位置 |
| 11 | 关闭 Screen；再次打开；重复关闭 | 端点 detach、租约/纹理注册释放、输入/焦点/光标恢复；无 GL 错误；10 次开合正常；`CaptureHub` 未关闭 | 残留/二次释放异常/关闭主模组纹理 |
| 12 | 打开中关闭总开关；再开启 | Screen 关闭并释放；编辑器键不再打开；入口不可用；再开启可打开；WebUI 服务未被 ingame 停掉 | 关闭态仍可打开/服务被误停/键仍生效 |
| 13 | 打开中退出世界；回主菜单再进；同时打开 WebUI 与 ingame 后分别关闭 | 无 Document/纹理/监听器/端点残留；两载体互不影响；飞控不被对方取消 | 退出世界崩溃/残留/关闭一个导致另一个断连 |
| 14 | WebUI 回归：WebUI→Forge 与 WebUI→Fabric 各做一次连接/加载/真实画面/关闭 | 13 已验收的 WebUI 路径仍通过；Fabric AUI 未启动不影响 WebUI→Fabric | WebUI 回归失败；以“14 迁移”为由降低 WebUI 标准 |

### 4.2 证据字段

| 字段 | 类型 | 约束 |
|---|---|---|
| `step` | 1–14 | 与 4.1 对应 |
| `build` | string | 实际命令与产物；不虚构 Gradle 任务 |
| `env` | string | MC/Forge/AUI/Java/主模组/编辑器模组版本 |
| `observed` | string | 可观察结果；不用“应该” |
| `evidence` | string | 日志/截图/消息/文件路径 |
| `result` | enum | PASS/FAIL/BLOCKED |
| `failureOwner` | string | FAIL/BLOCKED 时指向 14-0N、01–12 轮次或 `13-webui-acceptance-release` |

### 4.3 失败与回退

| 场景 | 行为 |
|---|---|
| 14-01 加载失败 | 回 14-01；不进入 Screen 验收 |
| 帧源不可用/仍 CPU 读回 | 回 14-03；本任务 BLOCKED，不得用截图代替 |
| 信号仍绑 WebSocket/无 ack | 回 14-04；本任务 BLOCKED |
| 输入双触发/玩家被驱动 | 回 14-05；本任务 FAIL |
| 飞控退出依赖 `WebPreviewScreen`/广播 | 回 14-06；本任务 FAIL |
| 关闭/禁用残留 | 回 14-07；本任务 FAIL |
| 01–12 的 WebUI 能力本身未验收 | 回对应轮次；14 不补做 WebUI 功能 |
| WebUI 回归失败 | 回 13 或 03；不得用 14 迁移掩盖 |

## 5. 修改步骤

1. 先完成 14-01～14-07 的实现与各自冒烟；本任务只做集成验收。
2. 固定环境与版本，记录 `env`；构建主模组/编辑器模组，记录实际命令。
3. 按 4.1 顺序执行 14 步；每步填 4.2 证据；失败即停，不在同一次运行里“跳过再试”。
4. 第 9 步飞控必须验证 owner 定向：同时在 WebUI 打开一个会话，确认 `flight.exit` 不到 WebUI。
5. 第 11–13 步必须验证资源归零与载体隔离；用日志/GL 错误/端点表/文件状态作为证据。
6. 第 14 步只做回归，不重新设计 WebUI；Fabric AUI 仍不纳入。
7. 全通过后，14-09 才能开始全功能迁移验收；本任务记录作为 14-09 的宿主基线。

## 6. 禁止修改

- 不以 WebUI 通过记录替代 ingame 切片；不以构建成功替代运行。
- 不用 CPU 读回、截图轮询、离线假画面冒充进程内 GPU 画面。
- 不通过反射访问 `J:webui` 包私有类型/`CaptureHub` 私有字段。
- 不为通过验收而删除/禁用功能、放宽错误路径、把失败改成警告。
- 不在本任务中实现 01–12 的新功能；缺功能回原轮。
- 不启动/修复游戏内 Fabric AUI；Fabric AUI 仍暂缓，但 WebUI→Fabric 必须回归。
- 不把“14 步都点过”当作通过；每步必须有可观察结果。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | Screen/页面/输入/帧绑定/飞控桥/释放；本任务主要运行侧 |
| 编辑器 `webui` | 不承载；第 14 步只做回归 |
| 主模组 `main` | `api/editor`、GPU 帧源、ingame 端点/推送/飞控实现；第 1/6/8/9/14 步验证 |

## 8. 前置

- 14-01～14-07 的实现与各自冒烟记录。
- 13 的 WebUI 验收基线（黄金脚本、真实游戏工作流、应用/字幕、发布交接）。
- Forge dev run 环境、AUI 1.3.1、可写脚本/资源目录。
- 主模组 `api/editor` 真实可用；若只有合同，14-03/14-04/14-06 先落地实现。

## 9. 正反例验收

**正例 A**：14 步全部 PASS，证据完整；画面含 HUD 且无编辑器 UI；`hello_ack` 能力位与实际实现一致；飞控写回正确；关闭后资源归零；WebUI 两通路回归通过。
**正例 B**：第 9 步同时开 WebUI，`flight.exit` 只到 ingame；WebUI 不写回、不断连。
**正例 C**：第 11 步 10 次开合后无 GL 错误、无重复 detach、无残留租约；第 12 步关闭总开关后键/入口不可用。
**正例 D**：第 10 步的每个错误都有具体位置/回执；保存失败不产生半写文件。

**反例 A**：只证明 Screen 能打开、页面能渲染，就宣布切片通过 → 不通过。
**反例 B**：帧源仍是 CPU 读回/截图 → 不通过。
**反例 C**：`flight.exit` 广播导致 WebUI 写回 → 不通过。
**反例 D**：关闭 ingame 停掉 `WebEditorServer` → 不通过。
**反例 E**：总开关关闭后 F8 仍打开 → 不通过。
**反例 F**：第 14 步 WebUI→Fabric 失败，却以“Fabric AUI 暂缓”解释 → 不通过；暂缓只指游戏内 Fabric AUI。
**反例 G**：用 14-09 的未完成面板替代第 4/5 步的真实宿主链 → 不通过。

## 10. 真实游戏冒烟（未执行）

本任务本身就是真实游戏冒烟任务；4.1 的 14 步即冒烟步骤。执行时补充：

1. 记录每次运行的完整版本与构建命令。
2. 对第 5/7/9/11/13 步保存截图或日志片段。
3. 对第 6/8/9/10 步保存消息文本（脱敏 token）。
4. 对第 11–13 步保存端点表/租约计数/GL 错误日志。
5. 对第 14 步保存 WebUI→Forge 与 WebUI→Fabric 的连接/画面证据。

**本轮未执行**：14 尚未实施，无 Forge 运行环境；不得预填 PASS。

## 11. 完成定义

- 4.1 的 14 步全部有可观察结果与证据；没有 BLOCKED 被当作 PASS。
- 第 5 步证明真实 GPU 画面、HUD 保留、无编辑器 UI 套娃。
- 第 6/8/9 步证明进程内信号与 WebUI 同语义；`flight.exit` 只到 owner；关键回执可靠。
- 第 11–13 步证明释放/幂等/载体隔离；不关闭 `CaptureHub`、不停 WebUI、不广播飞控。
- 第 14 步证明 WebUI→Forge 与 WebUI→Fabric 未被 14 迁移破坏；Fabric AUI 仍未启动且不阻塞。
- 失败项有明确归属轮次；本任务未通过前，14-09 不得标记完成。
