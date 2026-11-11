# 14-03 进程内画面源（捕获纹理 → AUI）

> 状态：未实现（仅计划；主模组无 GPU 纹理出口，AUI 侧无编辑器画面元素）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-01/14-02 可用；03-08 §3.4 合同已冻结
> 关联：README、14-02/04/07、[14-00公共前置](14-00-public-api-prerequisite.md)、03-08 §3.4与共享C06。

## 1. 职责

把「游戏画面如何在同一进程内进入 AUI 编辑器 UI」从合同变成真实实现：主模组 `EditorFrameSource` 提供捕获纹理与帧元数据；编辑器把它包装成 AUI 可绘制的纹理/元素；处理 generation、UV 翻转、alpha、缩放、无帧占位、释放。**不使用** CPU 读回、WebSocket、H.264、截图轮询。

**与 03 的关系**：03-08/03-09 只冻结 `EditorFrameSource`/`FrameLease` 的合同与所有权；`CaptureHub` 的 GPU 消费者、`EditorFrameSource` 的 ingame 实现、AUI 侧绑定都是 **14 交付**。不得把“03 未实现 GPU 帧源”当作 14 的阻塞理由；也不得要求 03 在 WebUI 阶段先实现它。若 03 只有合同，本任务先落地实现，再做 14-08 验收。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 捕获入口 | `MOD:media/capture/CaptureHub.java:41-44` | `INSTANCE` |
| 捕获规格 | `CaptureHub.java:71`、`J:webui/PreviewStreamer.java:112-116` | `CaptureSpec(1920,1080,60)` |
| 捕获实现 | `CaptureHub.java:263-312` | 取缓冲 → blit → PBO 读回 → 交付两帧前 |
| FBO 纹理 | `CaptureHub.java:463-496`（`initFbo`） | `GL_RGBA8`、`GL_LINEAR`、`CLAMP_TO_EDGE`；私有 `texId/fboId` |
| 纹理/FBO 删除 | `CaptureHub.java:508-517` | `deleteFbo` 删 FBO + 纹理 |
| 规格重建 | `CaptureHub.java:425-461` | 删旧、建新、重填池、通知消费者 |
| 消费者接口 | `CaptureHub.java:74-101` | `needsFrame/onFrame/onCaptureFormatChanged/captureSpec` |
| 交付 | `CaptureHub.java:358-398` | `retain` → 回调 → `release`；CPU 读回 |
| alpha | `CaptureHub.java:314-356` | blit 后只写 alpha=1 |
| 行序 | `CaptureHub.java:400-423` | CPU 读回翻成自顶向下 |
| 挂点 | `MOD:mixin/GameRendererMixin.java:147-157` | `Gui.render` 之后；Screen 之前 |
| 现有预览消费者 | `J:webui/PreviewStreamer.java:99-176` | CPU 消费者；与 GPU 消费者可并存 |
| 公共合同 | `../03-host-transport/03-08-editor-host-contract.md` §3.4 | `available/isRunning/acquire/addListener/removeListener`；`FrameLease` 字段与真实 release |
| 公共落实责任 | [14-00](14-00-public-api-prerequisite.md) | 13 WebUI完成后由14实际实现GPU/公共端口，不反派给03 |
| AUI 渲染服务 | `AUI:spi/AuiServices.java:137-155` | `render()` 返回 `AuiRenderService` |
| 注册纹理 | `AUI:spi/AuiRenderService.java:202` | `registerTexture(Object texture, Object location)` |
| 释放注册 | `AuiRenderService.java:207` | `releaseTexture(Object location)` |
| 关闭纹理 | `AuiRenderService.java:197` | `closeTexture(Object texture)`（会删 GPU 资源） |
| 动态纹理 | `AuiRenderService.java:152,186` | `createDynamicTexture(name, nativeImage/width/height, linear)` |
| 纹理批绘制 | `AuiRenderService.java:54-74` | `beginTextureBatch`/`emitTextureQuad`/`flushTextureBatch` |
| FBO 绘制 | `AuiRenderService.java:84-116` | `createOffscreenTarget`/`bindColorTexture`/`drawOffscreenTexture` |
| 纹理键 | `AUI:spi/TextureKey.java:1-20` | `record TextureKey(String value)` |
| 资源映射 | `AUI:spi/AuiResourceService.java:38-53` | `locationOf/tryParseTextureKey/textureLocation/smoothRenderType` |
| Texture 元素 | `AUI:element/Texture.java:21-98` | `src` → `TextureKey`；`ImageDrawer.draw` |
| ImageDrawer | `AUI:render/ImageDrawer.java:44-64` | `draw` / `drawWithUvWindow`；默认 UV (0,0)-(1,1) |
| Canvas | `AUI:element/Canvas.java:1-80` | CPU 光栅；不适合 1080p60 |
| 元素注册 | `AUI:registry/annotation/ElementRegister.java` | 自定义标签注册 |
| 元素基类 | `AUI:init/Element.java`（`drawPhase`/`setAttribute`/`addEventListener`） | 自定义元素入口 |
| 渲染阶段 | `AUI:render/Base.java`（`RenderPhase`） | SHADOW/BODY/BORDER |
| 文档绘制 | `AUI:screen/ApricityScreen.java:111-160` | `Base.drawScreenDocument` |
| 帧调度 | `AUI:client/Client.java:50-75`、`AUI:task/FrameScheduler.java` | 每 tick 遍历 Document |
| 世界窗口 | `AUI:world/WorldWindow.java:1-1112` | 世界渲染；会进入捕获（不可用于编辑器 UI） |
| 纹理释放钩子 | `AUI:element/Iframe.java:544-547`、`Canvas.java:564-574` | 元素断开时释放自己的纹理；`<texture>` 不拥有纹理 |

**已核对的缺口**：

1. **无 GPU 纹理出口**：`CaptureHub` 的 `texId/fboId` 是私有字段，无 getter；`CapturedFrame` 只有 `byte[] rgba`。14 无法零拷贝取画面。
2. **无 `EditorFrameSource` 实现**：03-08 §3.4 只是合同；主模组未实现 `available/acquire/listener`。
3. **无 GPU 消费者**：`CaptureHub.Consumer` 是 CPU 帧消费者；需要新增 GPU 消费者回调（提案），并在 blit 后、CPU 读回前后保持 GL 状态正确。
4. **AUI 的 `<texture>` 只认 MC 纹理管理器**：`Texture.syncSource` 用 `AuiServices.resources().tryParseTextureKey(src)`（`AUI:element/Texture.java:91-98`）；需要把捕获纹理注册到纹理管理器，或走自定义元素绘制。
5. **UV 方向**：MC GUI 纹理 v=0 在顶部（NativeImage 自上而下）；GL FBO 纹理 v=0 在底部。直接 `<texture>` 会上下颠倒。
6. **alpha**：捕获纹理 alpha=1；AUI 默认可能启用混合，视觉上无影响，但需要确认不出现黑边/透明。
7. **generation**：FBO 重建（规格变化/导出覆盖）会换纹理 id；编辑器必须重建包装/注册，否则画到已删除纹理。
8. **AUI 的纹理注册 API 是 SPI**：`AuiRenderService` 的 `Object` 参数在 1.3.1 是 `DynamicTexture`/`ResourceLocation`；跨版本可能变。
9. **自定义元素注册依赖注解扫描**：AUI Forge 的 `NetworkAutoReg` 日志显示扫描可用（`forge/run/logs/latest.log:29`），但自定义 `@ElementRegister` 是否被同一扫描覆盖需实测。
10. **CPU 回退不可接受**：`Canvas` 的 `BufferedImage`→`NativeImage`→上传是 CPU 路径；1080p60 会占满主线程。
11. **没有租约所有权实现**：`FrameLease.release()` 若为空操作/只置 null，会悬挂租约/世代泄漏；14 必须真实幂等。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 画面源 | CPU 读回 + H.264/WebSocket | 同进程 GL 纹理 + `EditorFrameSource`（14 实现） |
| GPU 消费者 | 无 | `CaptureHub` 内部 GPU 消费者列表 + 规格变化通知 |
| AUI 显示 | 无 | 自定义元素（首选）或 `<texture>` + 预翻转 |
| 翻转 | CPU `flipRows` | GPU 侧 UV 交换（v0=1,v1=0）或预翻转 FBO |
| generation | 无 | `FrameLease.generation`；变化时重建；旧租约失效 |
| 失败 | 无 | 占位 + 原因（无帧/不可用/尺寸非法） |
| 释放 | 无 | `release()` 幂等 + `removeListener` + 释放自己的纹理注册；不 close 主模组纹理 |
| 所有权 | 无 | 主模组拥有纹理；消费者只借用；销毁在拥有者渲染线程 |

### 3.2 拟新建/修改（提案）

- `MOD:api/editor/EditorFrameSource.java`（03-08 合同；若未落地，由本任务实现）
  - `available/isRunning/acquire/addListener/removeListener`
  - `FrameLease(textureId,width,height,generation,frameId,ptsNanos,flipY,opaqueAlpha)` + `release()`
- `MOD:media/capture/CaptureHub.java`（修改，提案）
  - 新增 GPU 消费者接口（提案名 `GpuConsumer`）：`onGpuFrame(textureId,width,height,generation,frameId,ptsNanos)`、`onGpuFormatChanged(...)`。
  - 在 blit 后、CPU 读回前后回调；保证 GL 状态正确；`generation` 在 `rebuild` 时递增。
  - `acquire()` 返回当前 `texId` 与元数据；不暴露 `FboHandle`/`RenderTarget`。
  - 消费者注册/注销与 CPU 消费者分离；`close()` 仍只由捕获中心所有者调用。
- `MOD:editor/ingame/IngameFrameSource.java`（提案）
  - 实现 `EditorFrameSource`；维护租约计数/监听器；generation 失效时让旧租约不可用。
  - `FrameLease.release()` 真实幂等（引用计数/世代校验）；不 close 纹理。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorFrameBinding.java`（提案）
  - 管理 `EditorFrameSource` 订阅、租约、generation、失败状态；供 Screen/元素共享。
  - `close()`：`removeListener` + `lease.release()` + 清引用；幂等。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorFrameElement.java`（提案）
  - 首选：自定义 `Element`（`@ElementRegister("editor-frame")`），在 `drawPhase(BODY)` 用 `AuiServices.render().beginTextureBatch/emitTextureQuad/flushTextureBatch`，UV 交换 `v0=1,v1=0`，尺寸按元素内容框。
  - 备选：把纹理注册为 `TextureKey`，页面用 `<texture src="...">`；需要预先翻转（编辑器侧 blit 到自己的 FBO）。
  - `generation` 变化时重建绑定；`onDisconnectedFromDocument` 时 `removeListener` + `releaseTexture`（若注册过）。
- **不新建**第二套捕获；不把 `CaptureHub` 的私有字段反射出来。

## 4. 输入输出与字段约束

### 4.1 `FrameLease`

| 字段 | 类型 | 约束 |
|---|---|---|
| `textureId` | int | GL 颜色附件纹理；>0；generation 内稳定 |
| `width/height` | int | 1920×1080（固定）；偶数 |
| `generation` | long | 每次 FBO/纹理重建 +1；单调 |
| `frameId` | long | 捕获层自增；仅诊断 |
| `ptsNanos` | long | `System.nanoTime()`；仅诊断/同步 |
| `flipY` | boolean | 纹理原点在左下 → 消费者需翻转 UV |
| `opaqueAlpha` | boolean | alpha=1；消费者可跳过 alpha 混合 |

约束：`release()` 幂等；租约不跨 generation 使用；不 close 纹理；`acquire()` 无帧返回明确不可用（`null` 或 `Optional.empty`，以实现期合同为准），不返回假纹理。

### 4.2 绘制

- 元素尺寸：由 CSS 决定（中央预览容器）；纹理按 `object-fit: contain` 或 `fill` 缩放（与 WebUI 的 canvas 一致，建议 contain）。
- UV：`u0=0,v0=1,u1=1,v1=0`（flipY）；若 `flipY=false` 则 `v0=0,v1=1`。
- 颜色：不额外 tint（白色）；alpha 混合按 AUI 默认；`opaqueAlpha=true` 时可关闭混合以减少状态切换（需实测）。
- 帧更新：AUI 每 tick 重绘；元素每帧读取当前租约（或缓存纹理 id，generation 变化时更新）。
- 不在 `Screen.render` 之外发 GL 调用；只在 AUI 绘制阶段。

### 4.3 失败

| 场景 | 显示 |
|---|---|
| `available=false` | 占位「画面不可用」+ 原因（主模组未提供帧源） |
| `isRunning=false` | 占位「等待游戏画面」 |
| 无帧（`acquire()==null`） | 占位「等待首帧」；不显示黑屏冒充 |
| 尺寸非法 | 占位「画面尺寸非法」+ 宽高 |
| generation 变化中 | 保留上一帧直到新租约可用；不画已删除纹理 |
| GPU 元素注册失败 | 明确错误 + 回退 `<texture>`（若可用）；不静默黑屏 |

### 4.4 释放

- 元素/绑定 `onDisconnectedFromDocument`：`removeListener`；释放自己的 `FrameLease`（幂等 `release()`）；若注册了 `TextureKey`，只 `releaseTexture(location)` 释放自己注册的包装；**不** `closeTexture` 主模组纹理，**不**调用 `CaptureHub.close()`。
- Screen `teardown()`：同 4.4；清空租约与绑定。
- 主模组 `CaptureHub` 重建/关闭时：通知消费者并 invalidate 旧 generation；编辑器清租约、停止绘制，等待新租约或显示占位。这是宿主生命周期，编辑器不主动触发。
- 单端点关闭只释放自己的订阅/租约；其他端点或 WebUI 预览的消费者不受影响。

## 5. 修改步骤

1. 主模组落地/确认 `EditorFrameSource` 合同（03-08 §3.4；若未实现，本任务实现）。
2. `CaptureHub` 增加 GPU 消费者与 generation；保证 blit 后纹理可用、GL 状态正确；不破坏现有 CPU 消费者。
3. 实现 `IngameFrameSource`：租约/监听/generation/幂等 release。
4. 编辑器实现 `EditorFrameBinding`：订阅、租约、generation、失败状态。
5. 实现 `EditorFrameElement` 自定义元素（首选）或 `<texture>` 路径；先做静态纹理验证 UV/alpha，再接真实帧源。
6. 页面中央容器使用该元素；CSS 尺寸/缩放。
7. 接入 `teardown()` 释放；接入 14-07 的验收。
8. 记录 AUI 1.3.1 的 `AuiRenderService` 参数类型；升级时回归。
9. 本任务只交付帧源；14-04/14-06/14-09 不因帧源完成而自动通过。

## 6. 禁止修改

- 不通过反射读 `CaptureHub.fboId/texId`；不把 `FboHandle` 暴露到编辑器。
- 不把 CPU 读回 + `uploadTexturePixels` 作为最终实现（可作临时诊断，但不纳入验收）。
- 不 close 主模组纹理；只释放自己的注册与租约。
- 不调用 `CaptureHub.close()`；不因关闭编辑器停止 WebUI 预览或其他消费者。
- 不在 `Screen.render` 之外发 GL 调用（AUI 的绘制阶段内）。
- 不用 `WorldWindow` 显示编辑器 UI。
- 不用空 `release()`/只置 null 冒充租约释放；不让旧 generation 继续绘制。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `EditorFrameElement`/`EditorFrameBinding`、页面元素 |
| 编辑器 `webui` | 不承载；WebUI 走 H.264/RGBA（03-01～03-04） |
| 主模组 `main` | `api/editor/EditorFrameSource`、`CaptureHub` GPU 消费者、`editor.ingame.IngameFrameSource`（提案） |

## 8. 前置

- 03-08 §3.4 的 `EditorFrameSource` 合同；若只有合同，14 实现。
- `CaptureHub` 的 GPU 消费者实现（J4-O4；14 交付）。
- AUI 1.3.1 的 `AuiRenderService`/`ElementRegister` 可用性（14-01/14-02）。
- `CaptureHub` 现有 CPU 消费者（WebUI 预览）不得被破坏；14-08 第 14 步回归。

## 9. 正反例验收

**正例 A**：打开编辑器，中央显示真实游戏画面；画面含 HUD、lane 合成、调色；不含编辑器 UI（顶栏/时间轴/属性面板）。
**正例 B**：游戏内移动视角/播放脚本，画面同步更新；延迟 ≤1 渲染帧（同进程）。
**正例 C**：规格重建（若发生）→ `generation` 变化 → 编辑器重建绑定，画面不花、不黑；旧租约不可再画。
**正例 D**：关闭编辑器 → `removeListener` + `releaseLease`；主模组纹理仍可被其他消费者使用（如 WebUI 预览同时开着）；`CaptureHub` 未关闭。
**正例 E**：无帧时显示「等待首帧」，不是黑屏/假画面。
**正例 F**：主模组 invalidate 旧 generation（规格变化/世界退出）→ 编辑器停止绘制旧纹理并显示占位；重新 acquire 后才恢复。
**正例 G**：自定义元素注册失败时回退 `<texture>` 或显示明确错误；不静默黑屏。

**反例 A**：直接 `<texture>` 未翻转 → 画面上下颠倒；验收不通过。
**反例 B**：CPU 读回 + 上传 → 帧率明显下降/主线程卡顿；不纳入验收（仅诊断）。
**反例 C**：反射读私有 `texId` → 版本变更即崩；不纳入验收。
**反例 D**：关闭时 `closeTexture` 主模组纹理或 `CaptureHub.close()` → 其他消费者黑屏/GL 错误；验收不通过。
**反例 E**：编辑器 UI 出现在画面里（套娃）→ 捕获点/Screen 层使用错误；验收不通过。
**反例 F**：`release()` 为空操作或只置 null 不归还租约 → 悬挂租约/世代泄漏；验收不通过。
**反例 G**：用 CPU 读回/截图轮询冒充“进程内 GPU 画面” → 验收不通过。
**反例 H**：把 03 未实现 GPU 帧源当作 14 的阻塞理由 → 不通过；14 负责落地。

## 10. 真实游戏冒烟（未执行）

前置：`EditorFrameSource` + `CaptureHub` GPU 消费者落地 + Forge 1.20.1 dev run + AUI 1.3.1。

1. 打开编辑器，截图对比：画面含 HUD、无编辑器 UI。
2. 移动视角/播放脚本，确认同步。
3. 同时开 WebUI 预览（若可行），确认两个消费者互不影响。
4. 关闭编辑器，确认主模组纹理仍可用、无 GL 错误。
5. 断开帧源（模拟 `available=false`），确认占位与原因。
6. 触发规格重建/世界切换，确认 generation 失效/恢复。
7. 连续开合 10 次，确认无租约/纹理泄漏。

**本轮未执行**：主模组帧源未实现，无 Forge 运行环境；以上为 14-08 统一冒烟的一部分。

## 11. 完成定义

- `EditorFrameSource` 合同与 `CaptureHub` GPU 消费者真实落地；不以反射/CPU 读回冒充。
- UV/alpha/generation/失败占位/释放五项有正反例；`release()` 真实幂等，关闭只释放本租约/本注册，不关闭 `CaptureHub`。
- generation 失效后旧纹理不再绘制；新 generation 恢复；其他消费者不受影响。
- AUI 版本风险（SPI 参数类型、元素注册）记录并纳入升级回归。
- 帧源是 14 交付，不要求 03 在 WebUI 阶段先实现；也不以“03 合同已写”当作已实现。
- 未执行的真实冒烟明确标注。
