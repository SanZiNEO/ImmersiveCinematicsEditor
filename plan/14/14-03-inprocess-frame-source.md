# 14-03 进程内 GPU 帧源与纹理租约

> 前置：14-01/02 可加载/可开 Screen；14-00 GPU 合同审计通过
> 后续：14-04 端点、14-08 垂直切片
> 状态：设计合同；GPU 画面未执行时不填 PASS

## 1. 职责

把 `CaptureHub` 已经渲染好的捕获画面，以 GPU 纹理租约交给 AUI 中央视图：

- 同一进程、同一渲染线程；
- 不做 CPU PBO 读回、不做 H264、不做截图轮询；
- 不重写 `CaptureHub` 的捕获/格式/CPU 预览路径；
- 不把 `CaptureHub.close()` 暴露给编辑器消费者；
- 纹理所有权仍属 `CaptureHub`，编辑器只持租约。

## 2. 当前事实

### 2.1 `CaptureHub` 现状

| 事实 | 锚点/说明 |
|---|---|
| 唯一捕获入口 | `CaptureHub.INSTANCE`；`CaptureSpec(1920,1080,60)` |
| FBO/纹理 | `initFbo()` 生成 `texId`（RGBA8、GL_LINEAR、CLAMP_TO_EDGE）与 `fboId`；纹理挂在 `GL_COLOR_ATTACHMENT0` |
| CPU 读回 | `captureFrame()` 总是 `glReadPixels` 到 PBO，三槽环，翻行后交 `CapturedFrame` |
| 消费者 | `Consumer.needsFrame/onFrame/onCaptureFormatChanged/captureSpec`；无 GPU 消费者 |
| 纹理访问 | `texId`/`fboId` 私有；无公开 getter |
| 关闭 | `close()` 清消费者、删 FBO/PBO；是捕获中心级操作 |
| 挂点 | `Gui.render` 之后、`Screen.render` 之前；编辑器 UI 不进画面 |
| 按需捕获 | 每帧先问 `needsFrame`；无人需要时零 GL 调用 |

**结论**：固定 FBO 纹理已存在，但没有公开 GPU 租约出口，并且 `captureFrame` 目前会无条件做 CPU 读回。14 的“小改适配”是加 GPU 消费者与“无 CPU 消费者时跳过 PBO”，不是重写 `CaptureHub`。

### 2.2 AUI 纹理

- AUI 1.3.1 有动态纹理/注册/释放入口（`AuiRenderService` 等）；具体注册方式以实际类签名为准。
- 编辑器不能把 `CaptureHub` 的纹理复制成第二张纹理；应把外部纹理注册给 AUI，由 AUI 在 Screen 上绘制。
- AUI 不拥有纹理生命周期；租约释放只注销消费者/纹理注册，不删共享纹理。

## 3. 方案

### 3.1 `CaptureHub` 最小扩展

新增 GPU 消费者路径，不改现有 CPU `Consumer` 语义：

```text
GpuConsumer
  boolean needsGpuFrame(long nowNanos)
  void onGpuFrame(GpuFrame frame)
  void onGpuFormatChanged(int width, int height, int fps, int generation)

GpuFrame
  int textureId
  int width, height
  int generation
  long frameId
  long timeNanos
  boolean flipY
  float alpha
```

`captureFrame` 目标顺序：

```text
main RenderTarget
  -> blitToFbo(main, w, h)
  -> 有 GPU 消费者：通知 onGpuFrame（纹理仍绑定在 CaptureHub）
  -> 有 CPU Consumer 需要帧：走现有 PBO 读回
  -> 都没有：不捕获（保持按需）
```

关键：

- GPU 通知必须在渲染线程、`blitToFbo` 之后、FBO 仍有效时进行；AUI 只记录纹理 id/generation，不在回调里做重活。
- 只有 GPU 消费者时，不分配 PBO、不 `glReadPixels`、不翻行、不建 `CapturedFrame`。
- 同时有 CPU/GPU 消费者时，两者都服务；CPU 路径保持 WebUI 原行为。
- `close()` 仍只由捕获中心调用；编辑器不调用。
- 规格变化重建 FBO 时 generation +1；旧租约停止绘制，等待新 generation。
- `needsGpuFrame` 全 false 时零捕获；与按需语义一致。

### 3.2 `EditorFrameSource` 适配

`EditorFrameSource` 在附属模组实现为 `CaptureHub` GPU 消费者：

```text
EditorFrameSource.acquire(endpointId)
  -> 创建 AuiFrameConsumer
  -> CaptureHub.registerGpu(consumer)
  -> 返回 FrameLease

FrameLease
  textureId / width / height / generation / frameId / timeNanos / flipY / alpha
  isValid()
  release()  // unregisterGpu + AUI 纹理注册注销
```

规则：

- 一个端点一个租约；端点关闭只释放自己的租约。
- 租约不拥有纹理；`release()` 不 `glDeleteTextures`。
- `generation` 失效：AUI 停止绘制并显示“等待画面”，直到新帧。
- `flipY` 按实际 GL 纹理方向给出；验收以画面正立为准，不在文档里写死方向。
- `alpha` 由 `CaptureHub` 的强制 alpha=1 决定；不透明画面不整帧透明。
- 首帧/格式切换期间允许无帧；占位不是失败。
- 不使用 CPU `CapturedFrame` 作为“回退”；GPU 不可用即报错，不用 CPU 截图假装零拷贝。

### 3.3 AUI 纹理注册

- 中央 `#preview-surface` 绑定 AUI 外部纹理。
- 纹理注册只在 Screen 打开且租约有效时进行；关闭时注销。
- 不在每帧重建纹理；generation 变化只更新尺寸/绑定参数。
- 纹理尺寸变化时更新 AUI 元素尺寸/纵横比；不拉伸到错误比例。
- 画面包含 HUD、lane 合成、调色；不包含编辑器 UI（捕获点在 Screen 前）。
- 无帧/格式切换显示占位，不显示上一帧残留作为“实时”。

### 3.4 线程/GL 约束

- `CaptureHub.registerGpu/unregisterGpu`、`onGpuFrame` 全在渲染线程。
- AUI 纹理注册/更新在渲染线程；不跨线程调用 GL。
- 页面/DOM 更新不直接持有 GL 纹理；只持 `FrameLease` 元数据与 AUI 纹理句柄。
- 关闭 Screen 时先停绘制/注销 AUI 纹理，再释放租约；不反向。

## 4. 输入输出

### 4.1 输入

- `CaptureHub` 的 FBO/纹理、`Consumer` 现有路径、`blitToFbo`。
- `EditorFrameSource`/`FrameLease` 合同（14-00）。
- AUI 外部纹理注册 API。

### 4.2 输出

- GPU 消费者与 `GpuFrame` 元数据。
- `EditorFrameSource` 端到端：Screen 打开 → 租约 → AUI 画面。
- generation/格式变化/无帧/关闭的行为。
- 真实画面证据：HUD、lane、调色；无编辑器 UI；无 CPU 读回。

### 4.3 禁止

- 用 `glReadPixels`/`CapturedFrame`/截图轮询给 AUI 供帧。
- 把 `CaptureHub.close()` 当端点释放。
- 复制纹理/每帧上传整帧到 CPU 再上传。
- 在 `onGpuFrame` 里做文件 IO/网络/布局重算。
- 规格变化后继续用旧 generation 纹理。

## 5. 验收

### 5.1 正例

**正例 A**：打开 AUI，中央出现真实游戏画面；包含 HUD、lane 合成、调色；不包含 AUI 顶栏/面板。

**正例 B**：仅 AUI 消费者时，`CaptureHub` 不分配/不读取 PBO；帧仍更新；日志/GL 调用无 `glReadPixels` 路径（或可证明 CPU 读回未执行）。

**正例 C**：同时有 WebUI CPU 消费者与 AUI GPU 消费者时，两者都正常；WebUI 预览不因 GPU 路径失效。

**正例 D**：窗口/分辨率/规格变化 → generation +1；AUI 自动更新尺寸并继续显示；旧租约不画旧纹理。

**正例 E**：关闭 AUI → 租约注销、纹理注册注销；`CaptureHub` 仍存活，WebUI CPU 预览仍可用。

**正例 F**：无帧/未捕获时显示占位；不崩溃、不显示上一帧冒充实时。

**正例 G**：换世界/退出世界 → 旧租约失效；新世界打开后重新获取；无旧纹理残留。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| AUI 用 CPU `CapturedFrame` 上传纹理 | 失败：不是 GPU 租约 |
| `onGpuFrame` 里 `glReadPixels` | 失败：CPU 读回 |
| AUI 调 `CaptureHub.close()` | 失败：关闭捕获中心 |
| 纹理 generation 失效仍绘制 | 失败：花屏/旧帧 |
| 关闭 AUI 删除共享纹理 | 失败：WebUI/其他消费者失效 |
| 只测静态截图，不测连续帧 | 失败：无法证明零拷贝/实时 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| GPU 租约/首帧 | NOT RUN | 待执行 |
| 仅 GPU 不读 PBO | NOT RUN | 待执行 |
| CPU+GPU 共存 | NOT RUN | 待执行 |
| generation/格式变化 | NOT RUN | 待执行 |
| 关闭/换世界 | NOT RUN | 待执行 |
