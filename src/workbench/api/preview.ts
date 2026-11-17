/**
 * 预览流端口（04-02 中栏 / 04-09 宿主层）。
 *
 * 帧协议来自主模组 `webui/PreviewProtocol.java`：18 字节大端帧头，
 * `type`(u8) / `flags`(u8) / `frameId`(u32) / `ptsMicros`(u64) / `width`(u16) / `height`(u16)。
 * 编辑器只消费帧，不改变协议。
 */

/** 帧头字节数。 */
export const PREVIEW_HEADER_BYTES = 18

/** 帧类型：RGBA8 原始帧。 */
export const PREVIEW_TYPE_RGBA = 1

/** 帧类型：H.264 Annex B access unit。 */
export const PREVIEW_TYPE_H264 = 2

/** 关键帧标志位。 */
export const PREVIEW_FLAG_KEYFRAME = 0x01

/** 一帧预览。 */
export interface PreviewFrame {
  type: number
  flags: number
  keyframe: boolean
  frameId: number
  /** 相对本编码器首帧的采集时间戳（微秒）。 */
  ptsMicros: number
  width: number
  height: number
  /** 指向入参 buffer 的视图（不复制）。 */
  payload: Uint8Array
}

/** 服务端 `preview.stats`（字段按可选处理，容忍版本差异）。 */
export interface PreviewStats {
  mode?: string
  width?: number
  height?: number
  fps?: number
  /** 实际编码器状态：`h264` / `rgba` / `off` / `pending`。 */
  encoder?: string
  sent?: number
  dropped?: number
  inputDropped?: number
  encoderDropped?: number
  captured?: number
}

/** 播放状态（服务端 `playback.state`：只有 time / playing）。 */
export interface PlaybackState {
  time: number
  playing: boolean
}

/** 预览流服务（宿主实现，面板只读）。 */
export interface PreviewServicePort {
  connected(): boolean
  stats(): PreviewStats | null
  playback(): PlaybackState
  /** 最近一帧到达时间（毫秒时间戳）；从未收到为 `null`。 */
  lastFrameAt(): number | null
  /** 订阅新帧；返回取消订阅。 */
  onFrame(listener: (frame: PreviewFrame) => void): () => void
  subscribe(listener: () => void): () => void
  /** 请求服务端刷新一帧（`editor.previewConfig` 的副作用）。 */
  requestRefresh(): void
  /** 播放（可选起止秒）；状态以 `playback.state` 回推，不本地计时。 */
  play(start?: number, end?: number): void
  pause(): void
  stop(): void
}

/** 解析一帧；格式不对返回 `null`（丢弃，不抛异常）。 */
export function parsePreviewFrame(data: ArrayBuffer | ArrayBufferView): PreviewFrame | null {
  const view = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (view.byteLength < PREVIEW_HEADER_BYTES) {
    return null
  }
  const header = new DataView(view.buffer, view.byteOffset, PREVIEW_HEADER_BYTES)
  const type = view[0]
  const flags = view[1]
  if (type !== PREVIEW_TYPE_RGBA && type !== PREVIEW_TYPE_H264) {
    return null
  }
  const frameId = header.getUint32(2, false)
  const ptsHigh = header.getUint32(6, false)
  const ptsLow = header.getUint32(10, false)
  const ptsMicros = ptsHigh * 2 ** 32 + ptsLow
  const width = header.getUint16(14, false)
  const height = header.getUint16(16, false)
  if (width <= 0 || height <= 0) {
    return null
  }
  const payload = view.subarray(PREVIEW_HEADER_BYTES)
  if (type === PREVIEW_TYPE_RGBA && payload.byteLength < width * height * 4) {
    return null
  }
  return {
    type,
    flags,
    keyframe: (flags & PREVIEW_FLAG_KEYFRAME) !== 0,
    frameId,
    ptsMicros,
    width,
    height,
    payload,
  }
}
