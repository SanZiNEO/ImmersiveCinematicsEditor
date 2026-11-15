# R14 AUI 迁移（先 Forge）

> 轮次：R14 · AUI 迁移（先 Forge）
> 前置：R13 全部出口 PASS；R14-00 合同与载体指针审计完成
> 范围：Forge 1.20.1 的游戏内 AUI 宿主；Fabric AUI 暂缓，WebUI→Fabric 不受影响
> 状态：设计合同；构建、真实游戏、性能结果未执行时不填 PASS

## 一、这轮做什么

R14 不是再做一套编辑器，而是把 R2～R12 已经定下的 WebUI 编辑语义，换到游戏内 AUI 宿主。

同一份脚本、同一套字段、同一套消息名、同一套撤销/保存/模板/字幕/飞控语义；只换承载方式：

- WebUI：Electron 窗口 + `127.0.0.1:8765` + WebSocket + CPU 捕获 + H264/RGBA 预览。
- AUI：游戏内 `Screen` + HTML/CSS 视图 + 进程内端点 + `CaptureHub` 的 GPU 纹理租约 + 游戏输入/飞控。

用户看到的是同一个编辑器，只是从桌面窗口搬到游戏里。

## 二、启动门禁

R14 的代码实现和验收，必须等 R13 实际通过。

- R13 文档已经写完，但构建、Electron、Forge/Fabric 真游戏验收还没有执行；R13-01 执行表仍是 `NOT RUN`。
- R14 现在写的是设计合同，不能把 R13 的“设计完成”当成“验收通过”。
- R14 的代码开工条件：R13-01 全部 P0/P1 项 `PASS`，R13-04/R13-05 真实游戏记录完整，R13-07 发布阻断已关闭。
- R14 文档可以先落盘；文档落盘不等于实现，也不等于验收。

## 三、单键入口与载体指针

### 3.1 一个键

从 R14 起，所有编辑器共用一个可改绑的入口键：

| 项 | 值 |
|---|---|
| 默认键 | `F6` |
| 绑定名 | `EDITOR_OPEN` |
| 可改绑 | 是，走原版 Controls/按键设置 |
| 旧键 | `F9` 不再作为编辑器打开键；`F8`/旧 ingame 键不保留为第二入口 |
| 行为 | 打开当前活动载体；再次按下关闭；飞控中先取消飞控再关闭 |

`F6` 不是新的“ingame 专用键”，也不是 WebUI 专用键。它只做一件事：调用 `EditorEntry` 的活动载体指针。

### 3.2 载体指针

`EditorEntry` 只认一个“当前活动载体”：

```text
EDITOR_OPEN (F6)
        ↓
EditorEntry.open()
        ↓
activeCarrier = WEBUI | INGAME
        ↓
EditorCarrier.open()
```

- 主模组注册 `WEBUI` 载体（现有 `WebPreviewScreen` 路径）。
- AUI 附属模组注册 `INGAME` 载体（`EditorAuiScreen` 路径）。
- AUI 附属模组可以在初始化时把 `EditorEntry` 的活动指针指向 `INGAME`；主模组不需要知道 AUI 类。
- 活动载体不可用时回退：`INGAME` 不可用 → `WEBUI`；`WEBUI` 不可用 → 明确提示，不打开空壳。
- 载体切换只发生在“编辑器未打开”时；已打开时先关闭当前载体，再打开目标载体，不允许两个 `Screen` 叠加。
- `F6` 只打开活动载体，不承担“在 WebUI/AUI 之间二选一”的第二按键职责；切换载体在编辑器入口/设置里完成。

`EditorCarrier` 是 R14-00 新增的宿主扩展，不改变 R1 已冻结的 7 个接口语义。AUI 附属模组“能改我们模组的一些指向”，具体指：

| 可改的指向 | 归属 | 说明 |
|---|---|---|
| `EditorEntry.activeCarrier` | 主模组 API | AUI 可把活动载体指向 `INGAME`；主模组保留回退 |
| AUI 页面根路径 | AUI 附属模组 | classpath `assets/apricityui/apricity/editor/` 或 `<gameDir>/apricity/editor/` |
| AUI 帧源消费指针 | AUI 附属模组 | 只借用 `CaptureHub` 纹理租约，不替换捕获中心 |
| AUI 输入路由 | AUI 附属模组 | 只接管本 Screen 的输入，不修改全局键位表 |

不可被附属模组替换的权威：

- 消息名/字段/信封与 `EditorSessionApi` 路由；
- 飞控 owner 与 `flight.exit` 定向；
- `CaptureHub` 的捕获 FBO/纹理所有权与 `close()`；
- 文档/撤销/模板/字幕批次的创作权威。

## 四、模组关系

```text
ImmersiveCinematics（主模组）
  ├─ 运行时、schema/文件/校验/播放/捕获/飞控
  ├─ api/editor：7 个稳定接口 + EditorCarrier/EditorEntry
  └─ 不依赖 AUI，不加载 AUI 类

ImmersiveCinematicsEditor（附属模组，Forge 1.20.1）
  ├─ 依赖：immersive_cinematics [0.3.6,0.4)、apricityui [1.3.1,1.4)
  ├─ AUI 页面、EditorAuiScreen、Java 侧控制器
  ├─ 进程内端点、GPU 帧租约、输入路由、飞控适配
  └─ 注册 INGAME 载体，设置 EditorEntry 指针

ApricityUI 1.3.1（外部前置）
  └─ 只被附属模组依赖，不打包进主模组/附属模组
```

关键边界：

- 主模组 `mods.toml` 不声明 `apricityui`；主模组专用服务端不加载 AUI/客户端 Screen 类。
- 附属模组 `mods.toml` 声明 `immersive_cinematics` 与 `apricityui` 为必需前置（客户端）；缺 AUI 时由 Forge 依赖界面明确提示，而不是类加载崩溃。
- 附属模组缺失时，主模组仍正常；`modes()` 不含 `INGAME`；`F6` 落到 `WEBUI`。
- Fabric 模块保留骨架；Fabric AUI 不接入、不验收；WebUI→Fabric 仍按 R13 基线回归。

## 五、使用者视角

1. 总开关开启；进入世界；按 `F6`。
2. 若 AUI 附属模组存在且活动载体为 `INGAME`，打开 `EditorAuiScreen`：
   - 顶栏、项目图入口、中央真实游戏画面、`clip.effects`、`selection.properties`、主时间轴、抽屉、状态栏；
   - 画面包含 HUD、lane 合成与调色，不含编辑器 UI；
   - 游戏继续 tick/渲染，不黑屏、不暂停。
3. 若 AUI 不可用，`F6` 打开 WebUI 预览屏；Electron 编辑器仍按原通路连接。
4. 编辑、保存、校验、播放、飞控都在同一套消息语义下完成；AUI 不另造字段。
5. 关闭/切载体/退世界/关总开关只释放本载体资源；不关 `CaptureHub`，不影响其他端点/普通播放。

## 六、文档清单

| # | 文档 | 职责 |
|---|---|---|
| 1 | `README.md` | 总定位、门禁、单键入口、载体指针、模组关系 |
| 2 | [R14-00-contract-and-carrier-prerequisite.md](R14-00-contract-and-carrier-prerequisite.md) | R1 合同落地审计、`EditorCarrier`/`EditorEntry` 扩展、`CaptureHub` GPU 前置 |
| 3 | [R14-01-forge-companion-loader.md](R14-01-forge-companion-loader.md) | Forge 1.20.1 附属模组、AUI 依赖、mods.toml、客户端边界 |
| 4 | [R14-02-aui-host-screen.md](R14-02-aui-host-screen.md) | `EditorAuiScreen`、页面、viewport、HUD/暂停、面板挂载、载体互斥 |
| 5 | [R14-03-inprocess-frame-source.md](R14-03-inprocess-frame-source.md) | `CaptureHub` 纹理租约、generation、AUI 纹理注册、无帧占位 |
| 6 | [R14-04-inprocess-endpoint.md](R14-04-inprocess-endpoint.md) | `EditorEndpoint`/`EditorPush`/`SessionApi`、同一 JSON、ack、能力位 |
| 7 | [R14-05-input-focus-routing.md](R14-05-input-focus-routing.md) | F6 单键、ESC/F7、鼠标/焦点/IME、玩家输入、面板手势、图节点悬停 |
| 8 | [R14-06-flight-inprocess.md](R14-06-flight-inprocess.md) | 现有飞控换进程内 owner、10Hz 状态、退出写回、只发 owner |
| 9 | [R14-07-teardown-lifecycle.md](R14-07-teardown-lifecycle.md) | Screen/载体/总开关/世界退出/端点/租约的幂等释放 |
| 10 | [R14-08-vertical-slice-acceptance.md](R14-08-vertical-slice-acceptance.md) | 真实 Forge 垂直切片 14 步，14-09 的宿主门禁 |
| 11 | [R14-09-full-feature-migration.md](R14-09-full-feature-migration.md) | R2～R12 全功能迁移矩阵、正反例、宿主不适用项、发布交接 |

## 七、执行顺序

| 阶段 | 任务 | 完成标志 | 不进入下一阶段 |
|---|---|---|---|
| 合同审计 | R14-00 | R1 接口可用；载体指针可用；GPU 纹理租约方案可编译 | 任一接口/所有权未闭合 |
| 宿主链 | R14-01～R14-07 | 附属模组加载、AUI Screen、GPU 画面、进程内端点、输入、飞控、释放 | 任一宿主链不可运行 |
| 垂直切片 | R14-08 | 真实游戏 14 步全部 PASS | 任一步无证据/FAIL |
| 全功能迁移 | R14-09 | R2～R12 矩阵全部迁移；正反例通过 | 任一模块空壳/语义漂移 |

`R14-08` 是 `R14-09` 的门禁；`R14-09` 是 R14 的出口。宿主能打开不等于 R14 完成。

## 八、全局约束

- 设计依据只取当前主模组代码、`plans/0.3.6` 与 R2～R12 合同；旧编辑器代码只作线索，不作目标结构。
- 不修改 AUI jar；不把 AUI 的 `Document`/`Element`/`Window`/`ApricityScreen` 类型泄漏进主模组 `api/editor`。
- 不使用 `WorldWindow` 承载编辑器 UI；编辑器 UI 只在 `Screen` 层，捕获点在 HUD 后、Screen 前。
- 不跑 Vue/现代 JS 运行时；当前 AUI 环境没有 KubeJS/Rhino，页面 JS 不可作为交互验收前提。
- 不做系统文件对话框/系统窗口；字幕、LUT、主题走游戏内路径/资源选择器与游戏配置目录。
- 不新增消息名/字段；不新增第二套文档模型/撤销栈/规则执行器。
- R13 的入口引用已同步为 `F6`；不要再用旧 `F9` 描述作为 R14 入口。
- 不调用 `CaptureHub.close()`、不停止 `WebEditorServer` 作为 ingame 关闭的一部分。
- 不伪造 `PASS`；执行记录按 `NOT RUN / PASS / FAIL / BLOCKED` 填写，未跑就是 `NOT RUN`。

## 九、R14 之后的边界

- Fabric AUI：明确暂缓；不在 R14 验收，不因 AUI 改动 Fabric 的 WebUI 通路。
- WebUI：R14 不重写 WebUI 功能；只做 `F6` 入口与载体指针适配，WebUI→Forge/Fabric 回归仍按 R13。
- 未来 Fabric AUI：复用同一 `EditorCarrier`、`EditorFrameSource`、`EditorEndpoint`、`EditorFlightControl` 合同；本轮不预留空实现充数。
