/**
 * WebUI 协议常量与消息形状（04-09）。
 *
 * 协议事实来自主模组 `webui/WebSocketSession.java` / `PreviewProtocol.java`；
 * 这里只有类型与常量，不含连接逻辑。信封：`{type, data, id}`，回执沿用同一 `id`，
 * 错误回执为 `{type:'error', data:{error}}`。
 */
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'

/** 默认端点；token 通过查询串追加。 */
export const WEBUI_DEFAULT_URL = 'ws://127.0.0.1:8765/ws'

/** 断线重连初始间隔（退避基数）。 */
export const WEBUI_RECONNECT_MS = 1500
/** 退避基数：首次失败后等待的毫秒数。 */
export const WEBUI_RECONNECT_BASE_MS = 1500
/** 退避上限：两次自动重连之间最长等待。 */
export const WEBUI_RECONNECT_MAX_MS = 15000
/** 连续失败达到此次数后停止自动重连，等待用户显式重试。 */
export const WEBUI_RECONNECT_MAX_ATTEMPTS = 8

/** 消息类型常量（服务端权威）。 */
export const WEBUI_MESSAGE = {
  hello: 'hello',
  helloAck: 'hello_ack',
  scriptList: 'script.list',
  scriptLoad: 'script.load',
  scriptNew: 'script.new',
  scriptSave: 'script.save',
  scriptDelete: 'script.delete',
  scriptValidate: 'script.validate',
  scriptGraph: 'script.graph',
  scriptGraphInvalidated: 'script.graph.invalidated',
  scriptRequiresMutate: 'script.requires.mutate',
  scriptRefsPreview: 'script.refs.preview',
  scriptRefsApply: 'script.refs.apply',
  graphLayoutGet: 'graph.layout.get',
  graphLayoutPut: 'graph.layout.put',
  editorPushScript: 'editor.pushScript',
  editorSeek: 'editor.seek',
  editorPlay: 'editor.play',
  editorPause: 'editor.pause',
  editorStop: 'editor.stop',
  editorPreviewConfig: 'editor.previewConfig',
  playbackState: 'playback.state',
  previewStats: 'preview.stats',
  error: 'error',
} as const

export type WebUiMessageType = (typeof WEBUI_MESSAGE)[keyof typeof WEBUI_MESSAGE]

/** 信封。 */
export interface WebUiEnvelope<T = unknown> {
  type: string
  data?: T
  id?: string
}

/** `hello` → `hello_ack`。 */
export interface HelloAck {
  version?: string
  schemaHash?: string
}

export interface ScriptListResult {
  files: string[]
}

export interface ScriptLoadRequest {
  path: string
}

export interface ScriptLoadResult {
  path: string
  doc: JsonValue
}

export interface ScriptSaveRequest {
  path: string
  doc: JsonObject
}

export interface ScriptSaveResult {
  path: string
  /** 服务端是否已通知播放器；编辑器不依赖该字段判断保存成功。 */
  serverNotified?: boolean
}

export interface ScriptDeleteRequest {
  path: string
}

export interface ScriptValidateRequest {
  doc: JsonObject
}

export interface ScriptValidateResult {
  ok: boolean
  /** 原始 issue 文本；警告以 `[警告] ` 开头（03 的 `ValidationBridge` 解析）。 */
  issues: string[]
}

export interface PushScriptRequest {
  script: string
}

export interface PushScriptResult {
  /** 只表示「已发出」；解析是否成功以播放状态/帧为准。 */
  ok: boolean
  reason?: string
}

export interface SeekRequest {
  time: number
}

/** 服务端忽略请求字段，回执固定 1080p60。 */
export interface PreviewConfigResult {
  mode: string
  width: number
  height: number
  fps: number
  encoder: boolean
  keyframeIntervalSeconds: number
}

export interface PlaybackStatePayload {
  time: number
  playing: boolean
}

export interface ErrorPayload {
  error?: string
}
