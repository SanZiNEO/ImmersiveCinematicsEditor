# R14-00 合同、载体指针与 GPU 前置审计

> 前置：R13 全部出口 PASS
> 后续：R14-01～R14-09
> 状态：设计合同；审计结果未执行时不填 PASS

## 1. 职责

在写 AUI Screen 之前，先把三件事钉死：

1. R1 的 `api/editor` 7 个接口在当前主模组里真实可用，不是只有文字合同。
2. 单键入口需要一个载体指针：主模组注册 `WEBUI`，AUI 附属模组注册 `INGAME`，`F6` 只调用活动载体。
3. `CaptureHub` 已有 FBO/纹理，但 `texId`/`fboId` 私有、`captureFrame` 总是走 CPU PBO 读回；R14 只增加 GPU 租约出口，不能重写捕获中心，也不能让 AUI 消费者调用 `CaptureHub.close()`。

本文件不实现 AUI 页面，不写 Screen、不写面板；只闭合合同、所有权与前置缺口，供 R14-01～R14-09 使用。

## 2. 当前事实

### 2.1 R1 合同

R1 设计已冻结 7 个接口 + `EditorCommandAck`：

| 接口 | 职责 | 当前主模组事实 |
|---|---|---|
| `EditorEndpoint` | 端点身份、状态/关键消息发送 | 当前 `WebSocketSession` 包私有；没有进程内端点实现 |
| `EditorPush` | 广播/定向/端点列表 | 当前推送分散在 `WebEditorApi`/`PreviewStreamer`/`WebPreviewScreen`；没有统一抽象 |
| `EditorSessionApi` | `attach/detach/handle` | 当前 `WebEditorApi.handle` 绑定 WebSocket 会话；没有通用 attach/detach |
| `EditorFrameSource` | GPU 纹理租约 | 当前不存在；`CaptureHub` 无公开纹理 getter |
| `EditorPlaybackControl` | seek/play/pause/stop | 当前播放控制与 WebUI 会话耦合，需适配为宿主无关 |
| `EditorFlightControl` | 飞控 owner/enter/exit/state | 当前退出依赖 `WebPreviewScreen.activeScreen`，`flight.exit` 有广播风险 |
| `EditorHostApi` | 总开关、模式、能力、schema | 当前无 `editor` 总开关；无 `modes()`/`capabilities()` |

**结论**：R1 是设计合同，不是已实现代码。R14 开工前必须由 R1 落地并由 R13 验收；R14 不在 AUI 里重定义 7 个接口。

### 2.2 `CaptureHub`

当前事实：

- `CaptureHub.INSTANCE` 是全局唯一捕获入口；`CaptureSpec(1920,1080,60)`。
- `initFbo()` 生成 `texId`（`GL_RGBA8`、`GL_LINEAR`、`CLAMP_TO_EDGE`）和 `fboId`，把纹理挂在 `GL_COLOR_ATTACHMENT0`。
- `captureFrame()` 先 `blitToFbo()`，然后总是绑 PBO、`glReadPixels`、映射、翻行、交给 `CapturedFrame`。
- `Consumer` 只有 `needsFrame/onFrame/onCaptureFormatChanged/captureSpec`；没有 GPU 纹理消费者。
- `texId`/`fboId` 私有；没有公开 getter；`close()` 是捕获中心级操作，会清消费者、删 FBO/PBO，不属于消费者 API。
- 捕获挂点在 `Gui.render` 之后、`Screen.render` 之前；编辑器 UI 不会进入捕获画面。

**结论**：地图说“GPU 帧源已存在，只做小改适配”，准确含义是：**固定 FBO/纹理已经存在，缺的是公开的 GPU 租约/消费者出口，以及“只有 GPU 消费者时跳过 CPU 读回”的小改**。不能写成“CaptureHub 完全没有 GPU 纹理”，也不能写成“GPU 帧源已经可直接用”。

### 2.3 载体指针

当前主模组只有 `WebPreviewScreen` 路径和 F9 键；没有 `EditorEntry`、没有活动载体、没有 `EditorCarrier`。AUI 附属模组没有独立入口；若直接注册 F6，会与主模组键冲突。

**结论**：R14-00 需要新增一个不改变 7 接口语义的载体扩展，主模组持有 `F6` 键，AUI 只注册 `INGAME` 载体并改活动指针。

## 3. 方案

### 3.1 `EditorCarrier` 与 `EditorEntry`

新增在 `api/editor` 的宿主扩展：

```text
EditorCarrier
  id()                 -> "WEBUI" | "INGAME"
  isAvailable(host)    -> boolean
  isOpen()             -> boolean
  open(host)           -> void / 明确失败
  closeIfOpen(reason)  -> void

EditorEntry
  register(carrier)
  setActive(carrierId) // AUI 可把指针指向 INGAME
  activeCarrierId()
  open()               // F6 调用
  closeIfOpen(reason)
```

规则：

- `EditorEntry` 只允许一个活动载体；同一时刻不能打开两个 Screen。
- 主模组注册 `WEBUI` 载体；AUI 附属模组注册 `INGAME` 载体。
- `setActive("INGAME")` 是 AUI 可改的“入口指针”；主模组保留 `isAvailable` 校验与回退。
- 载体不可用时：`INGAME` 不可用 → 回退 `WEBUI`；`WEBUI` 不可用 → 明确提示，不打开空壳。
- `F6` 只调 `EditorEntry.open()`；不直接 `new EditorAuiScreen()`，也不直接 `new WebPreviewScreen()`。
- `EditorCarrier` 不传递 AUI 类型；AUI 类型只在附属模组内部。
- `EditorEntry` 不替代 `EditorHostApi`；总开关、模式、能力仍由 `EditorHostApi` 回答。

### 3.2 可改与不可改的指针

| 指针 | AUI 附属模组能否改 | 说明 |
|---|---|---|
| `EditorEntry.activeCarrier` | 能 | 指向 `INGAME`；主模组校验可用性 |
| AUI 页面根 | 能 | `assets/apricityui/apricity/editor/`；开发期 `<gameDir>/apricity/editor/` |
| AUI 帧源消费 | 能 | 注册 `EditorFrameSource` 消费者，借用纹理 |
| AUI 输入路由 | 能 | 只限本 Screen；不改全局键位表 |
| 消息路由/字段/信封 | 不能 | 由 `EditorSessionApi`/主模组权威服务保持 |
| 飞控 owner/`flight.exit` | 不能 | 由 `EditorFlightControl` 主模组实现保持 |
| `CaptureHub` 所有权/`close()` | 不能 | 附属模组只持租约，不持捕获中心 |

### 3.3 GPU 租约前置

`CaptureHub` 增加最小的 GPU 消费者路径：

```text
GpuConsumer
  needsGpuFrame(nowNanos)
  onGpuFrame(GpuFrame)
  onGpuFormatChanged(width,height,fps,generation)

GpuFrame
  textureId, width, height, generation, frameId, timeNanos, flipY, alpha
```

行为：

1. `registerGpu/unregisterGpu` 只在渲染线程增删。
2. `captureFrame` 先 `blitToFbo`；有 GPU 消费者时调用 `onGpuFrame`；只有存在 CPU `Consumer` 需要帧时才走 PBO 读回。
3. 规格变化重建 FBO 时 generation +1；旧 generation 的租约停止绘制，等待新帧。
4. 纹理仍由 `CaptureHub` 拥有；租约 `release()` 只注销消费者，不 `glDeleteTextures`，不 `close()`。
5. `needsGpuFrame` 全为 false 时不做捕获；与现有按需捕获语义一致。
6. 现有 WebUI CPU 消费者路径不改变；GPU 路径不能把 CPU 读回当成回退。

`EditorFrameSource` 在 R14-03 实现为上述租约的适配；R14-00 只确认 API 形状与所有权。

### 3.4 附属模组前置

R14-01 才写 `mods.toml`，这里先冻结关系：

- 主模组 `immersive_cinematics`：不声明 `apricityui`；不加载 AUI 类；提供 `api/editor` 和捕获/播放/飞控权威。
- 附属模组 `immersive_cinematics_editor`：Forge 1.20.1；依赖 `immersive_cinematics [0.3.6,0.4)`、`apricityui [1.3.1,1.4)`（客户端必需）。
- AUI 1.3.1 作为外部前置，不打包；缺 AUI 时由 Forge 依赖界面报缺前置，不类加载崩溃。
- Fabric 模块保留骨架；不接 AUI；WebUI→Fabric 不受影响。

## 4. 输入输出与约束

### 4.1 输入

- R1 落地后的 `api/editor` 类型与实现。
- 当前 `CaptureHub` 源码与 GL 生命周期。
- 当前主模组 `WebPreviewScreen`/`WebEditorApi`/`PreviewStreamer` 的播放、推送、飞控行为，作为语义对照，不作为 AUI 结构模板。
- 附属模组 Forge 1.20.1 骨架与 AUI 1.3.1 jar。

### 4.2 输出

- 一份 R1 合同差距表：每个接口“可用/缺什么/由谁补”。
- `EditorCarrier`/`EditorEntry` 扩展合同与注册顺序。
- `CaptureHub` GPU 租约接口、generation/所有权规则。
- R14-01～R14-09 的前置清单；缺一项就停，不带缺口进入 Screen。

### 4.3 禁止

- 不把 AUI 类放进 `api/editor`。
- 不复制第二套消息名/字段/信封。
- 不让 AUI 消费者调用 `CaptureHub.close()` 或删除共享纹理。
- 不在 R14-00 写“已实现”而没有代码/日志证据。
- 不用 WebUI 已通过代替 R14 进程内/GPU 验收。

## 5. 验收

### 5.1 正例

**正例 A**：`api/editor` 的 7 个接口在主模组可编译、可被附属模组访问；`EditorEndpoint` 发送关键消息返回明确成功/失败，不静默丢。

**正例 B**：主模组注册 `WEBUI`，AUI 注册 `INGAME`；`setActive("INGAME")` 后 `F6` 打开 AUI；AUI 不可用时回退 WebUI。

**正例 C**：`CaptureHub` 的 FBO 纹理可被 GPU 消费者拿到；AUI 只读纹理，不读 PBO；关闭租约后纹理仍在，WebUI CPU 预览仍可用。

**正例 D**：规格变化 generation +1；旧租约停止绘制；新帧到达后恢复；没有 `glDeleteTextures` 被消费者调用。

**正例 E**：主模组不声明 `apricityui`；附属模组声明主模组 + AUI；缺 AUI 时 Forge 明确报缺前置。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| AUI 直接 `new EditorAuiScreen()` 绕过 `EditorEntry` | 失败：双入口/双 Screen 风险 |
| 主模组 `mods.toml` 声明 `apricityui` | 失败：主模组硬依赖 AUI |
| AUI 调 `CaptureHub.close()` 释放画面 | 失败：关闭捕获中心 |
| GPU 消费者偷偷 `glReadPixels`/截图轮询 | 失败：违背零拷贝 |
| `EditorCarrier` 把 AUI `Screen` 类型暴露给主模组 | 失败：类型泄漏 |
| 没有 R1 实现却宣称合同可用 | 失败：伪造前置 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| R1 7 接口可用 | NOT RUN | 待执行 |
| 载体指针/F6 | NOT RUN | 待执行 |
| CaptureHub GPU 租约 | NOT RUN | 待执行 |
| 附属模组依赖声明 | NOT RUN | 待执行 |

未执行就是 `NOT RUN`，不写 `PASS`。
