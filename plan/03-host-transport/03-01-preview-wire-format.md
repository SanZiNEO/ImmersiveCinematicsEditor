# 03-01 预览帧线格式（18 字节头 + RGBA/H.264）

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：`README.md`、`03-03-preview-streamer-lifecycle.md`、`03-04-frame-consumer.md`、`../shared/contracts.md`（C06）

## 1. 职责

冻结「一帧预览」在两端的字节级定义：18 字节大端头、RGBA8 与 H.264 Annex B 两种负载、PTS/frameId/关键帧语义、非法输入处理。服务端负责产出合法帧，前端负责按同一份定义解析；任何字段顺序/宽度改动必须两侧同批发布。本任务只定义与校验，不实现编码器/解码器（分别见 03-03、03-04）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 头长度/类型常量 | `MOD:webui/PreviewProtocol.java:31-40` | `TYPE_RGBA=1`、`TYPE_H264=2`、`FLAG_KEYFRAME=0x01`、`HEADER_BYTES=18` |
| 解析结果 | `PreviewProtocol.java:46-49` | `record Message(type, flags, frameId, ptsMicros, width, height, payload)`；注释明确 `payload` 是**独立拷贝** |
| 打包 | `PreviewProtocol.java:62-82` | `ByteBuffer.allocate(HEADER_BYTES+payloadLength).order(BIG_ENDIAN)`；`putInt((int) frameId)` 取低 32 位；payload 复制 |
| 解析 | `PreviewProtocol.java:84-121` | 长度不足/未知 type → null；RGBA 要求 `payloadLength != width*height*4` → null（**严格相等**）；H.264 要求 `payloadLength > 0` |
| 服务端 RGBA 产出 | `MOD:webui/PreviewStreamer.java:374-388` | `pack(TYPE_RGBA, FLAG_KEYFRAME, frameId, ptsMicros, w, h, frame.rgba())`；RGBA 帧恒带关键帧标记 |
| 服务端 H.264 产出 | `PreviewStreamer.java:455-476` | `pack(TYPE_H264, keyframe?FLAG_KEYFRAME:0, frameId, pts, w, h, annexB)`；PTS 强制单调 +1 |
| AU 切分 | `MOD:webui/H264AuSplitter.java:24-169` | AUD 优先、无 AUD 按 VCL 连续性切分；关键帧 = 含 NAL type 5 |
| 编码参数 | `MOD:webui/PreviewEncoder.java:170-196` | libx264 baseline、level 5.1、veryfast、zerolatency、CRF 23、GOP=fps*2、`aud=1`、yuv420p |
| 前端常量 | `ED:lib/previewProtocol.ts:15-18` | 与 Java 同值 |
| 前端帧类型 | `previewProtocol.ts:25-37` | `payload` 是入参 buffer 的视图（**不复制**），生命周期跟随 buffer |
| 前端解析 | `previewProtocol.ts:60-100` | 头不足/未知 type/尺寸非法 → null；`ptsMicros` 用 `getBigUint64(6)` 并检查安全整数；RGBA 只检查 `payload.byteLength < width*height*4`（**允许更大**）；H.264 只检查非空 |
| 前端消费 | `ED:components/Preview.vue:264-281` | `parsePreviewFrame` → RGBA 入队 / H.264 交解码器 |
| 行序 | `MOD:media/capture/CaptureHub.java:400-423`（`flipRows`） | OpenGL 自底向上 → 翻成自顶向下；前端 `putImageData` 直接按行 |
| alpha | `CaptureHub.java:314-356`（`blitToFbo`） | 只写 alpha 通道，统一 `alpha=1` |
| 前端解码 profile/level | `ED:components/Preview.vue:218` | 硬编码 `codec: 'avc1.42E033'`（baseline，level 5.1 的十进制 51 = 0x33） |
| 前端 Annex B 声明 | `Preview.vue:219-227` | `avc: { format: 'annexb' }`、`optimizeForLatency: true`、`hardwareAcceleration: 'no-preference'` |

**已核对的差异**：

1. **RGBA 长度校验不对称**：Java `parse` 要求 payload 恰好 `w*h*4`；前端只要求不少于。服务端产出恰好相等，所以现状不炸；但「契约」必须二选一并写清。
2. **PTS 上限**：前端用 `Number(getBigUint64)`，超过 `2^53` 丢精度；Java 无上限校验。
3. **frameId 回绕**：Java 取低 32 位；前端不依赖唯一性，但也没有文档说明它只是诊断/配对键。
4. **H.264 参数集**：前端硬编码 baseline/level 5.1；服务端命令行变更时前端不会自动跟随，也没有 SPS 解析。
5. **无协议版本/能力位**：头里没有 version、codec、色彩空间字段。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标（本轮冻结） |
|---|---|---|
| 头长度 | 18 | 18，不再扩展；未来扩展必须新 type 或 flags 位 |
| RGBA 长度 | Java 严格相等；前端允许更大 | **契约：`payload.length >= w*h*4`，多余字节忽略**；服务端产出恰好相等；Java `parse` 放宽为 `>=` 或注明只用于入站校验 |
| H.264 长度 | 非空 | 非空，且必须含至少一个完整 NAL（由 AU 切分保证） |
| frameId | u32，低 32 位 | 仅诊断/配对键，不作排序键；回绕合法 |
| PTS | u64，单调 | 会话内单调；`< 2^53`（前端安全整数）；回退由前端判定新 epoch |
| 关键帧 | flags bit0 | RGBA 恒置位；H.264 仅 IDR 置位 |
| 色彩 | 未声明 | 假设 BT.709/sRGB；**未验证**，列为已知风险 |
| 版本/能力 | 无 | 不新增；`hello_ack` 带能力位（见 03-05） |

### 3.2 拟新建/修改（提案）

- `ED:lib/previewProtocol.ts`（修改）
  - `parsePreviewFrame` 的 RGBA 分支：保留 `>=`，并在注释写明「多余字节忽略」；返回的 `payload` 仍为视图，由消费方按 `width*height*4` 使用。
  - 新增 `PREVIEW_CODEC_BASELINE_51 = 'avc1.42E033'` 常量与注释「服务端 `PreviewEncoder.command` 的 profile/level 必须与此同步」；`Preview.vue` 引用该常量，不再硬编码字符串。
  - 安全PTS数值上限集中定义供生产消费/文档解释，不为此新增测试工具。
- `MOD:webui/PreviewProtocol.java`（提案，本轮不改主模组）
  - `parse` 的 RGBA 分支由 `payloadLength != expected` 改为 `payloadLength < expected`；注释说明「入站校验允许尾部多余字节，出站 `pack` 仍精确」。
  - `Message` 注释补充「frameId 仅诊断/配对」。
- **不新建**第二套帧协议类；不引入 protobuf/FlatBuffers；不改 18B 头顺序。

## 4. 输入输出与字段约束

### 4.1 `pack`

输入：

| 参数 | 类型 | 约束 |
|---|---|---|
| `type` | int | 1 或 2；其它值由调用方保证不出现（`pack` 不校验） |
| `flags` | int | bit0=关键帧；其余位 0 |
| `frameId` | long | 取低 32 位写入；负数按补码取低 32 位 |
| `ptsMicros` | long | ≥0；会话内单调；< 2^53 |
| `width`/`height` | int | 1..65535；偶数（捕获规格要求） |
| `payload` | byte[] | RGBA：恰好 `w*h*4`；H.264：非空 AU |

输出：`byte[18+payload.length]`，大端。

### 4.2 `parse` / `parsePreviewFrame`

输出字段与 4.1 同；非法输入返回 `null`，不抛异常。判定顺序固定：长度 → type → flags → frameId → pts → width/height → payload 长度。

### 4.3 非法输入矩阵

| 输入 | Java `parse` | 前端 `parsePreviewFrame` | 契约 |
|---|---|---|---|
| 17 字节 | null | null | 丢弃 |
| type=0/3 | null | null | 丢弃 |
| width=0 | null | null | 丢弃 |
| pts 高位导致 >2^53 | 接受（long） | null（安全整数检查） | 服务端不得产出；前端丢弃 |
| RGBA 少 1 字节 | null | null | 丢弃 |
| RGBA 多 1 字节 | null（现状） | 接受（现状） | **本轮统一为接受**；服务端不产出多余字节 |
| H.264 空 payload | null | null | 丢弃 |
| H.264 无 SPS/PPS 的 delta | 接受 | 接受（`awaitingKeyframe` 丢弃） | 由前端等待关键帧 |

## 5. 修改步骤

1. 在 `ED:lib/previewProtocol.ts` 增加常量与注释（不改变现有解析结果，除 RGBA 契约注释）。
2. `ED:components/Preview.vue` 的 `codec` 改为引用常量；`ensureDecoder` 注释写明「profile/level 与服务端命令行同步」。
3. 主模组侧（**本轮不改**，写入 03-08 的前置合同）：`PreviewProtocol.parse` 放宽 RGBA 为 `>=`；`PreviewEncoder.command` 的 profile/level 与前端常量建立同源注释。
4. 前端测试/夹具（若后续允许）：用 `Uint8Array` 构造 18B 头，覆盖 4.3 矩阵；不引入测试框架，先以脚本/控制台断言记录。
5. 迁移所有硬编码 `avc1.42E033` 的引用（当前仅 `Preview.vue:218`）。

## 6. 禁止修改

- 不改 18B 头字段顺序、宽度、偏移。
- 不改 `FLAG_KEYFRAME` 的值与含义。
- 不引入 JPEG/MJPEG/WebP 等第三类型。
- 不在前端做「猜 SPS」或自动切换 codec 字符串；profile/level 变更必须两侧同批。
- 不改捕获行序（自顶向下）与 alpha=1 约定。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `ED:lib/previewProtocol.ts`、`ED:components/Preview.vue`（唯一实现） |
| 编辑器1.20.1方向 | 未来14才迁移进程内画面，不解析18B外部帧；不作为03/WebUI前置 |
| 主模组 `main` | `MOD:webui/PreviewProtocol.java`、`PreviewEncoder.java`（现状；本轮只写前置合同） |

## 8. 前置

- 无代码前置；需要 03-03 的产出约束（PTS 单调、frameId 配对）与 03-04 的消费约束（安全整数、关键帧等待）作为同批合同。
- SPS解析不是本轮新增功能，不为了验收引入解析器或测试工程。

## 9. 正反例验收

**正例 A（RGBA）**：构造 4×2 帧，payload 32 字节，`frameId=7`、`ptsMicros=123456`、`flags=1`。
- Java `parse` 返回 `type=1, width=4, height=2, frameId=7, ptsMicros=123456, payload.length=32`。
- 前端 `parsePreviewFrame` 返回同值，`keyframe=true`。

**正例 B（H.264）**：payload 为一个含 AUD+SPS+PPS+IDR 的 AU，`flags=1`。
- 两端返回 `type=2`、`keyframe=true`、`payload.length>0`。

**正例 C（大端）**：`ptsMicros=0x0102030405060708` → 前端 `72623859790382856`。

**反例 A**：`type=3` → 两端 null，不抛异常。
**反例 B**：RGBA `width=4,height=2` 但 payload 31 字节 → 两端 null。
**反例 C**：RGBA payload 33 字节 → 契约要求两端接受（多余 1 字节忽略）；现状 Java 返回 null、前端接受 → 本轮必须统一。
**反例 D**：H.264 payload 空 → 两端 null。
**反例 E**：`ptsMicros=2^53+1` → 前端 null；服务端不得产出（若产出，前端丢弃并计数）。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + `ffmpeg/ffmpeg.exe` + Electron 客户端。

1. F9 打开预览屏，编辑器连接。
2. 观察 `preview.stats.encoder = h264`；抓取一帧二进制消息，按 4.1 解析头部，确认 `width=1920,height=1080`、`ptsMicros` 单调。
3. 删除/重命名 ffmpeg，重连后观察 `encoder = rgba`，确认 RGBA 帧 `payload.length == 1920*1080*4`。
4. 暂停后 seek，确认补帧的 H.264 首帧 `flags&1 != 0`。

本次文档未运行；未来03当轮验证WebUI协议，13全量复核，不将首次冒烟推迟到AUI阶段。

## 11. 完成定义

- 两端契约表（4.3）逐项有明确裁决，且 `parsePreviewFrame` 与 `PreviewProtocol.parse` 的行为差异被消除或记录为「仅入站」。
- 前端不再硬编码 codec 字符串；常量与注释同源。
- 03-03/03-04 引用本文件的 PTS/frameId/关键帧约束，无第二套定义。
- 未执行的真实冒烟明确标注，不用「代码已写」冒充「协议已验证」。
