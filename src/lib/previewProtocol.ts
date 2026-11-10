// ─────────────────────────────────────────────────────────────
// ImmersiveCinematics 预览帧协议（服务端权威，18 字节大端帧头）
//
//   offset 0       type        u8    1 = RGBA8 原始帧, 2 = H.264 Annex B access unit
//   offset 1       flags       u8    bit0 = 关键帧(IDR)
//   offset 2..5    frameId     u32
//   offset 6..13   ptsMicros   u64   相对本会话首帧的采集时间戳（微秒）
//   offset 14..15  width       u16
//   offset 16..17  height      u16
//   offset 18..    payload
//
// 对应服务端 webui/PreviewProtocol.java，任何字段顺序改动必须两侧同步。
// ─────────────────────────────────────────────────────────────

export const PREVIEW_HEADER_BYTES = 18
export const PREVIEW_TYPE_RGBA = 1
export const PREVIEW_TYPE_H264 = 2
export const PREVIEW_FLAG_KEYFRAME = 0x01

/** 预览分辨率模式，与服务端 PreviewConfig.Mode 的 wireName 一致 */
export type PreviewMode = 'original' | '720p' | '1080p'
/** 预览帧率档位，与服务端约定只允许这两档 */
export type PreviewFps = 30 | 60

export interface PreviewFrame {
  type: number
  flags: number
  keyframe: boolean
  frameId: number
  /** 采集时间戳（微秒），相对本编码器首帧 */
  ptsMicros: number
  width: number
  height: number
  /** 指向入参 buffer 的视图（不复制）；生命周期跟随该 buffer */
  payload: Uint8Array
}

/** 服务端编码器状态（preview.stats.encoder），注意与 previewConfig 回执里的布尔 encoder 不同 */
export type PreviewEncoderState = 'h264' | 'rgba' | 'off' | 'pending'

/** 服务端 preview.stats 推送（每会话每秒一条）；字段按可选处理，避免版本差异把 UI 打崩 */
export interface PreviewStats {
  mode?: PreviewMode
  width?: number
  height?: number
  /** 生效帧率（请求值与否决后的服务端值） */
  fps?: number
  encoder?: PreviewEncoderState
  sent?: number
  dropped?: number
  inputDropped?: number
  /** 编码器输入队列丢帧（累计） */
  encoderDropped?: number
}

/**
 * 解析一帧预览消息。帧头不足、类型未知、尺寸非法、payload 长度不足时返回 null
 * （服务端异常/协议错位时前端直接丢弃，不抛异常）。
 */
export function parsePreviewFrame(data: ArrayBuffer | ArrayBufferView): PreviewFrame | null {
  let buffer: ArrayBufferLike
  let byteOffset = 0
  let byteLength: number
  if (data instanceof ArrayBuffer) {
    buffer = data
    byteLength = data.byteLength
  } else {
    buffer = data.buffer
    byteOffset = data.byteOffset
    byteLength = data.byteLength
  }
  if (byteLength < PREVIEW_HEADER_BYTES) return null

  const view = new DataView(buffer, byteOffset, byteLength)
  const type = view.getUint8(0)
  if (type !== PREVIEW_TYPE_RGBA && type !== PREVIEW_TYPE_H264) return null

  const flags = view.getUint8(1)
  const frameId = view.getUint32(2)
  const ptsMicros = Number(view.getBigUint64(6))
  const width = view.getUint16(14)
  const height = view.getUint16(16)
  if (!Number.isSafeInteger(ptsMicros) || ptsMicros < 0) return null
  if (width <= 0 || height <= 0) return null

  const payload = new Uint8Array(buffer, byteOffset + PREVIEW_HEADER_BYTES, byteLength - PREVIEW_HEADER_BYTES)
  if (type === PREVIEW_TYPE_RGBA && payload.byteLength < width * height * 4) return null
  if (type === PREVIEW_TYPE_H264 && payload.byteLength === 0) return null

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
