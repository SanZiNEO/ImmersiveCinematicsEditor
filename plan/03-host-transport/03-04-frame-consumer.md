# 03-04 前端帧消费（解析、PTS、抖动缓冲、WebCodecs）

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：`README.md`、`03-01-preview-wire-format.md`、`03-03-preview-streamer-lifecycle.md`、`03-07-host-teardown.md`

## 1. 职责

冻结编辑器侧「收到二进制帧之后」的全部行为：解析、PTS 映射、抖动缓冲、按时间取帧、RGBA 绘制、H.264 解码、关键帧等待、PTS 重建、队列上限、VideoFrame 释放、卸载清理。本任务不定义服务端产出（03-03）与帧字节格式（03-01）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 显示延迟 | `ED:components/Preview.vue:15` | `DISPLAY_DELAY_MS=100`，固定滞后 100ms |
| 队列上限 | `Preview.vue:17` | `MAX_QUEUE=90`（100ms@60fps 约 6 帧，余量给解码突发） |
| PTS 回退阈值 | `Preview.vue:19` | `PTS_RESYNC_BACKSTEP_US=1_000`（>1ms 回退视为新编码器） |
| 断流阈值 | `Preview.vue:21` | `PTS_RESYNC_GAP_MS=1000` |
| 显示帧结构 | `Preview.vue:26-33` | `timestamp`（本地微秒）、`width/height`、`rgba` 或 `video` |
| 队列 | `Preview.vue:35` | `DisplayFrame[]` |
| 清队列 | `Preview.vue:48-53` | 逐项 `video.close()`，清空 |
| PTS 归一化 | `Preview.vue:55-68` | 回退/断流时 `ptsClockOffsetUs = now*1000 - rawPts`，清队列，置 `ptsResynced` |
| 入队/超限 | `Preview.vue:70-78` | 超 `MAX_QUEUE` 丢最旧并 `video.close()` |
| 取到期帧 | `Preview.vue:85-101` | 找 `timestamp <= target` 的最后一帧；丢弃更早的并 close；保留更新帧 |
| 绘制 | `Preview.vue:103-142` | canvas 尺寸变化重建 ImageData；`drawImage(video)` 或 `putImageData`；RGBA 长度不足时 `subarray` |
| 渲染循环 | `Preview.vue:144-163` | rAF；漂移 >±250ms 时平移队列时间戳并调整 offset |
| 解码器 | `Preview.vue:165-232` | `VideoDecoder`；`output` 入队 `VideoFrame`；`error` 置 broken；`configure` |
| codec 配置 | `Preview.vue:218-227` | `avc1.42E033`、`optimizeForLatency`、`hardwareAcceleration:'no-preference'`、`avc.format:'annexb'` |
| H.264 处理 | `Preview.vue:234-262` | PTS 重建时关解码器；关键帧 `ensureDecoder`；等待关键帧；`decode(EncodedVideoChunk)` |
| RGBA 处理 | `Preview.vue:264-281` | `normalizePts` 后入队，`ptsResynced=false` |
| 统计显示 | `Preview.vue:284-304` | `statsSize`、`droppedTotal`（三项之和）、`encoderLabel` |
| 档位切换 | `Preview.vue:306-314` | `onModeChange/onFpsChange` 调 `sendPreviewConfig` |
| 挂载/卸载 | `Preview.vue:321-343` | `onFrame` 注册、rAF 启动、断线清队列/关解码器；卸载清理 |
| 前端解析 | `ED:lib/previewProtocol.ts:60-100` | 见 03-01 |
| 帧回调注册 | `ED:store.ts:253-259` | 单 `frameListener`；返回清理函数 |
| 配置请求 | `store.ts:263-280` | `editor.previewConfig` 请求/回执 |
| 统计路由 | `store.ts:329-331` | `preview.stats` 合并到 `state.previewStats` |

**已核对的缺口**：

1. **单监听器**：`frameListener` 只能有一个（`store.ts:167,253-259`）。若未来同时需要预览与缩略图/波形，会互相覆盖；应改为 `Set<(buf)=>void>`。
2. **档位 UI 错配**：`onModeChange/onFpsChange` 仍存在（`Preview.vue:306-314`），但服务端固定值（见 03-03）；用户操作无效。
3. **漂移修正可能与 PTS 归一化双重作用**：`renderLoop` 在漂移 >±250ms 时 `ptsClockOffsetUs += driftUs` 并对队列逐帧加 `driftUs`（`Preview.vue:150-160`）；随后 `normalizePts` 用同一个 `ptsClockOffsetUs` 计算新帧时间。两者叠加可能导致一次修正被重复计入。需以「队列时间戳是本地时钟」为唯一基准，明确只在 `renderLoop` 调整队列、不再改 offset，或只在 `normalizePts` 改 offset。
4. **无首帧超时提示**：连接后若一直无帧（编码器与 RGBA 都失败），画面空白，只有 `state.connected` 为 true；用户不知道原因。
5. **`preview.stats.width/height` 可能是配置值**（见 03-03），`statsSize` 会显示 1920×1080 但实际无帧。
6. **`VideoFrame` 释放路径多**：入队超限、取帧丢弃、清队列、绘制后、无 canvas/无 ctx、卸载；需要逐条核对，避免泄漏。当前实现已覆盖，但缺少可观察计数。
7. **`payload` 是 WebSocket ArrayBuffer 的视图**（`previewProtocol.ts:86`）；当前 WebSocket 每次消息新 buffer，安全；但契约必须写「buffer 不得复用」，否则 RGBA 入队后会被后续帧覆盖。
8. **无解码器能力探测**：`typeof VideoDecoder === 'undefined'` 时 `decoderBroken=true`，等服务端 RGBA 回退；但服务端不知道前端不支持 H.264，会一直发 H.264（直到编码器失败）。缺口：`hello` 可带 `capabilities.h264`，服务端据此禁用编码（提案）。
9. **H.264 profile/level 硬编码**：见 03-01。
10. **后台标签页**：rAF 暂停，队列积压到 90 后丢旧帧；回前台后从最新帧继续（跳帧）。可接受，但需在验收中记录。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 监听器 | 单回调 | `Set` 多监听；`onFrame` 返回移除函数 |
| 档位 | 可选 original/720p/30fps | 只读显示服务端生效值；删除选择器 |
| 漂移修正 | offset + 队列双改 | 单一基准：队列时间戳本地化后，漂移只平移队列；`ptsClockOffsetUs` 只由 `normalizePts` 改 |
| 首帧 | 无提示 | `sent===0` 显示「等待首帧」；超过 3s 显示「编码器未就绪/无画面」并保留原因 |
| 解码能力 | 只判 `VideoDecoder` 是否存在 | `hello` 带 `capabilities.h264`；服务端可禁用编码（提案） |
| VideoFrame | 各路径 close | 增加调试计数（`created/closed`），仅开发构建 |
| 颜色 | 未声明 | 记录「BT.709/sRGB 假设，未验证」 |

### 3.2 拟新建/修改（提案）

- `ED:store.ts`（修改）
  - `frameListener` 改 `Set`；`onFrame` 注册/移除。
  - `handleMessage` 的 `preview.stats` 保留 `captured`（若服务端提供）。
- `ED:components/Preview.vue`（修改）
  - 删除 `onModeChange/onFpsChange` 与两个 `<select>`；状态栏显示 `mode/width×height/fps`。
  - 漂移修正：只对队列逐帧 `timestamp += driftUs`，不再 `ptsClockOffsetUs += driftUs`；或反之，二选一并注释。
  - `statsSize`：`state.previewStats?.sent > 0` 才显示尺寸；否则显示「等待首帧」。
  - `onUnmounted` 增加 `VideoFrame` 计数断言（仅 dev）。
- `ED:lib/previewProtocol.ts`（修改）
  - 注释明确「payload 是入参 buffer 的视图，调用方不得复用该 buffer 直到消费完成」。
- **不新建**第二套解码器/渲染器；不引入 `mp4box.js` 等额外依赖。

## 4. 输入输出与字段约束

### 4.1 输入

`onFrame(buf: ArrayBuffer)`：一条 WebSocket 二进制消息，18B 头 + payload。

约束：
- `buf` 在该次回调后可能被浏览器回收；消费方若需跨帧持有，必须复制（RGBA 当前在 `drawFrame` 复制到 ImageData；H.264 由 `EncodedVideoChunk` 复制/持有）。
- 不得在回调内做重计算/阻塞；解析 + 入队即可。

### 4.2 输出

`DisplayFrame`：

| 字段 | 约束 |
|---|---|
| `timestamp` | 本地微秒（`performance.now()*1000` 基准），单调 |
| `width/height` | 来自帧头；canvas 尺寸随之变化 |
| `rgba` | `Uint8Array`，长度 ≥ `w*h*4`；绘制时按 `w*h*4` 使用 |
| `video` | `VideoFrame`；每个路径必须 `close()` 恰好一次 |

### 4.3 状态机

- `ptsClockReady=false`：首帧到达 → 建 offset，`ptsResynced=true`。
- `ptsResynced=true` 且 H.264：关解码器、`awaitingKeyframe=true`；关键帧到达 → `ensureDecoder` + decode。
- `awaitingKeyframe=true`：delta 帧直接丢弃，不入队。
- `decoderBroken=true`：等待下一个关键帧；`error` 回调置位并关解码器。
- 断线（`state.connected=false`）：清队列、关解码器、重置 PTS 基准（`Preview.vue:321-333`）。

### 4.4 队列与延迟

- 目标延迟 100ms；`pickDueFrame(now-100ms)` 取 <= target 的最后一帧。
- 队列上限 90；超限丢最旧（close video）。
- 漂移 >±250ms：平移队列时间戳，把延迟拉回 100ms；不丢帧（除非超上限）。

## 5. 修改步骤

1. `store.ts` 的 `frameListener` 改 `Set`；`Preview.vue` 的 `onFrame` 清理函数仍可用。
2. 删除档位 UI 与处理函数；状态栏改为只读。
3. 修正漂移双重作用：选定单一基准并写注释；在 03-04 的验收中用「长时间播放后队列长度稳定」验证。
4. `statsSize` 增加「等待首帧」；`droppedTotal` 保持三项之和。
5. 增加 dev-only `VideoFrame` 计数（created/closed），在卸载时打印差值；不进入生产 UI。
6. 迁移所有引用 `onModeChange/onFpsChange/previewMode/previewFps` 的代码（`Preview.vue:3,306-314,357-364`；`store.ts:57-58,263-280,333-337`）。

## 6. 禁止修改

- 不改 100ms 显示延迟与 90 队列上限（除非有新的实测依据）。
- 不在主线程做 H.264 软解；不引入 WASM 解码器。
- 不把 `VideoFrame` 存进 Vue 响应式对象（会导致代理/泄漏）。
- 不在断线后继续绘制旧帧。
- 不用「假帧/重复最后一帧」掩盖无画面。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `Preview.vue`、`store.ts`、`lib/previewProtocol.ts` |
| 编辑器 `1.20.1` | 不承载 WebCodecs 消费；进程内画面见 13-03 |
| 主模组 `main` | 无（服务端只产出帧） |

## 8. 前置

- 03-01 的帧格式与 RGBA 长度契约。
- 03-03 的 PTS 单调与补帧语义。
- 03-02 的 generation 守卫（旧帧丢弃）。

## 9. 正反例验收

**正例 A**：60fps 流稳定播放 30s，队列长度稳定在 5–8，状态栏 fps≈60，延迟约 100ms。
**正例 B**：seek 后 PTS 回退 → 队列清空、解码器重建、从关键帧继续；画面无花屏。
**正例 C**：切到后台 10s 再回前台，队列不超 90；回前台后从最新帧继续（允许跳帧），不崩溃。
**正例 D**：RGBA 回退（无 ffmpeg）时，`putImageData` 正常，颜色/方向正确（自顶向下）。
**正例 E**：卸载 Preview 组件后，rAF 停止、解码器关闭、队列清空；无 `VideoFrame` 泄漏。

**反例 A**：H.264 中途丢一个关键帧 → 后续 delta 被丢弃，等待下一个关键帧；不花屏、不崩溃。
**反例 B**：`VideoDecoder` 不存在 → `decoderBroken=true`，不抛异常；服务端仍发 H.264 时画面空白（缺口：能力协商）。
**反例 C**：断线 → 清队列/关解码器；重连后从关键帧开始。
**反例 D**：RGBA payload 比 `w*h*4` 多 1 字节 → 契约要求接受并忽略多余字节（与 03-01 一致）。
**反例 E**：`drawFrame` 时 canvas 不存在（组件已卸载）→ `video.close()` 后返回，不泄漏。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + ffmpeg + Electron。

1. 播放 1080p60 脚本 30s，观察 fps/队列/丢帧。
2. 暂停 → 连续拖动播放头，确认每次都有新画面。
3. 断网（禁用回环/杀服务端）→ 重连，确认从关键帧恢复。
4. 切后台/回前台，确认不崩溃、不无限积压。
5. 卸载预览（切换视图）→ 检查 `VideoFrame` 计数差值为 0。

本次未执行；未来03当轮验证Electron真实帧消费与错误，13全量复核，不要求AUI或进程内接口。

## 11. 完成定义

- 档位 UI 与服务端固定值一致；状态栏能区分「等待首帧」与「已出帧」。
- 漂移修正只有一处生效；有注释与验收步骤。
- `VideoFrame` 的每条释放路径都有对应代码位置与验收项。
- 能力协商缺口写入 03-08/03-05，不在本任务内假装已实现。
- 未执行的真实冒烟明确标注。
