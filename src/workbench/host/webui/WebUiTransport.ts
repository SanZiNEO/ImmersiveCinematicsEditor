/**
 * WebUI 传输适配（04-09）。
 *
 * 同一个 client 同时实现：
 * - 03 的 `DocTransport`（打开/保存/推送/新建/定位/存在性）；
 * - 03 的 `ValidationTransport`（`script.validate`）；
 * - 04 的 `PreviewServicePort`（预览统计、播放状态、二进制帧）。
 *
 * 协议缺口沿用 03 的编辑器侧兜底：
 * - `loadRaw` 用 `script.load` 后 `JSON.stringify(doc)`（服务端不回原文）；
 * - `editor.pushScript` 的 ack 只表示已发出，不确认解析成功。
 */
import type { DocTransport } from '../../../core/doc/io.ts'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ServerValidateResult, ValidationTransport } from '../../../core/doc/validate.ts'
import type { PlaybackState, PreviewFrame, PreviewServicePort, PreviewStats } from '../../api/preview.ts'
import { parsePreviewFrame } from '../../api/preview.ts'
import { WebUiClient } from './WebUiClient.ts'
import { WEBUI_MESSAGE } from './protocol.ts'

export interface WebUiTransportOptions {
  client: WebUiClient
  /** 最近帧时间的时钟（测试注入）。 */
  now?: () => number
}

export class WebUiTransport implements DocTransport, ValidationTransport, PreviewServicePort {
  private readonly client: WebUiClient
  private readonly clock: () => number

  private latestStats: PreviewStats | null = null
  private latestPlayback: PlaybackState = { time: 0, playing: false }
  private lastFrameTime: number | null = null

  private readonly listeners = new Set<() => void>()
  private readonly frameListeners = new Set<(frame: PreviewFrame) => void>()
  private readonly unsubscribers: Array<() => void> = []

  constructor(options: WebUiTransportOptions) {
    this.client = options.client
    this.clock = options.now ?? (() => Date.now())

    this.unsubscribers.push(this.client.on(WEBUI_MESSAGE.previewStats, (data) => {
      this.latestStats = normalizeStats(data)
      this.emit()
    }))
    this.unsubscribers.push(this.client.on(WEBUI_MESSAGE.playbackState, (data) => {
      this.latestPlayback = normalizePlayback(data, this.latestPlayback)
      this.emit()
    }))
    this.unsubscribers.push(this.client.onFrame((buffer) => {
      const frame = parsePreviewFrame(buffer)
      if (frame === null) return
      this.lastFrameTime = this.clock()
      this.emit()
      for (const listener of [...this.frameListeners]) {
        try {
          listener(frame)
        } catch (error) {
          console.error('[webui] 预览帧监听器抛错', error)
        }
      }
    }))
    this.unsubscribers.push(this.client.subscribe(() => this.emit()))
  }

  // ── DocTransport ───────────────────────────────────────────

  async load(path: string): Promise<{ path: string; doc: JsonValue }> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptLoad, { path })
    return parseLoadResult(result, path)
  }

  /** 服务端不回原文；用语义等价的 `JSON.stringify(doc)` 供 03 的冲突指纹使用。 */
  async loadRaw(path: string): Promise<string> {
    const loaded = await this.load(path)
    return JSON.stringify(loaded.doc)
  }

  async save(path: string, doc: JsonObject): Promise<{ path: string }> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptSave, { path, doc })
    if (typeof result === 'object' && result !== null && 'path' in result && typeof result.path === 'string') {
      return { path: result.path }
    }
    return { path }
  }

  async validate(doc: JsonObject): Promise<ServerValidateResult> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptValidate, { doc })
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('script.validate 回执格式错误')
    }
    const ok = 'ok' in result && result.ok === true
    let issues: string[] = []
    if ('issues' in result && Array.isArray(result.issues)) {
      issues = result.issues.filter((issue): issue is string => typeof issue === 'string')
    }
    return { ok, issues }
  }

  async pushScript(script: string): Promise<{ ok: boolean; reason?: string }> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.editorPushScript, { script })
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      return { ok: false, reason: 'editor.pushScript 回执格式错误' }
    }
    const ok = 'ok' in result && result.ok === true
    if ('reason' in result && typeof result.reason === 'string') return { ok, reason: result.reason }
    return { ok }
  }

  async newScript(): Promise<{ path: string; doc: JsonValue }> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptNew, {})
    return parseLoadResult(result, '')
  }

  async seek(time: number): Promise<void> {
    await this.client.request<unknown>(WEBUI_MESSAGE.editorSeek, { time })
  }

  /** `script.list`：脚本页唯一扫描入口的第一跳（只列路径，不递归目录）。 */
  async list(): Promise<string[]> {
    const result = await this.client.request<unknown>(WEBUI_MESSAGE.scriptList, {})
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new Error('script.list 回执格式错误')
    }
    if (!('files' in result) || !Array.isArray(result.files)) {
      throw new Error('script.list 回执缺少 files')
    }
    return result.files.filter((file): file is string => typeof file === 'string')
  }

  /** 播放（05-12：服务端是唯一时间源；ack 不表示已开始）。 */
  play(start?: number, end?: number): void {
    this.client.send(WEBUI_MESSAGE.editorPlay, {
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
    })
  }

  pause(): void {
    this.client.send(WEBUI_MESSAGE.editorPause, {})
  }

  stop(): void {
    this.client.send(WEBUI_MESSAGE.editorStop, {})
  }

  /** `script.load` 失败即视为不存在（服务端没有单独的存在性接口）。 */
  async exists(path: string): Promise<boolean> {
    try {
      await this.load(path)
      return true
    } catch {
      return false
    }
  }

  // ── PreviewServicePort ─────────────────────────────────────

  connected(): boolean {
    return this.client.connected()
  }

  stats(): PreviewStats | null {
    return this.latestStats === null ? null : { ...this.latestStats }
  }

  playback(): PlaybackState {
    return { ...this.latestPlayback }
  }

  lastFrameAt(): number | null {
    return this.lastFrameTime
  }

  onFrame(listener: (frame: PreviewFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 触发 `editor.previewConfig`（服务端忽略请求字段，固定回 1080p60 并刷新预览）。 */
  requestRefresh(): void {
    this.client.send(WEBUI_MESSAGE.editorPreviewConfig, {
      mode: '1080p',
      fps: 60,
      keyframeIntervalSeconds: 2,
      encoder: true,
    })
  }

  /** 取消内部订阅（宿主重建传输层时调用）。 */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    this.listeners.clear()
    this.frameListeners.clear()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[webui] 预览订阅者抛错', error)
      }
    }
  }
}

function parseLoadResult(result: unknown, fallbackPath: string): { path: string; doc: JsonValue } {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('script.load 回执格式错误')
  }
  if (!('doc' in result) || result.doc === undefined) {
    throw new Error('script.load 回执缺少 doc')
  }
  const path = 'path' in result && typeof result.path === 'string' ? result.path : fallbackPath
  // doc 的完整校验由 03 的 parseDoc 负责；这里只保证是 JSON 值。
  return { path, doc: result.doc as JsonValue }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeStats(data: unknown): PreviewStats {
  const stats: PreviewStats = {}
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return stats
  if ('mode' in data && typeof data.mode === 'string') stats.mode = data.mode
  if ('encoder' in data && typeof data.encoder === 'string') stats.encoder = data.encoder
  if ('width' in data && isFiniteNumber(data.width)) stats.width = data.width
  if ('height' in data && isFiniteNumber(data.height)) stats.height = data.height
  if ('fps' in data && isFiniteNumber(data.fps)) stats.fps = data.fps
  if ('sent' in data && isFiniteNumber(data.sent)) stats.sent = data.sent
  if ('dropped' in data && isFiniteNumber(data.dropped)) stats.dropped = data.dropped
  if ('inputDropped' in data && isFiniteNumber(data.inputDropped)) stats.inputDropped = data.inputDropped
  if ('encoderDropped' in data && isFiniteNumber(data.encoderDropped)) stats.encoderDropped = data.encoderDropped
  if ('captured' in data && isFiniteNumber(data.captured)) stats.captured = data.captured
  return stats
}

function normalizePlayback(data: unknown, previous: PlaybackState): PlaybackState {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return previous
  const time = 'time' in data && isFiniteNumber(data.time) ? data.time : previous.time
  const playing = 'playing' in data && typeof data.playing === 'boolean' ? data.playing : previous.playing
  return { time, playing }
}
