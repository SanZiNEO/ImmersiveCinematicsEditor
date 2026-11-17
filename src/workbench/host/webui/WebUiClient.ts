/// <reference lib="es2024.promise" />
/**
 * WebUI WebSocket 客户端（04-09）。
 *
 * 协议语义参考旧前端 `legacy/src/store.ts`（不得 import）：
 * - 连接 `ws://127.0.0.1:8765/ws?token=...`，断线 1500ms 重连；
 * - 打开后发 `hello`；回执用同一 `id`；错误回执 reject；
 * - 断连 reject 全部 pending；
 * - 二进制消息按原样交给帧监听器（解析由 `api/preview.ts` 的 `parsePreviewFrame` 负责）。
 */
import { WEBUI_DEFAULT_URL, WEBUI_MESSAGE, WEBUI_RECONNECT_MS } from './protocol.ts'
import type { WebUiEnvelope } from './protocol.ts'

export interface WebUiClientOptions {
  url?: string
  token: () => string
  now?: () => number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class WebUiClient {
  private readonly baseUrl: string
  private readonly token: () => string
  readonly now: () => number

  private socket: WebSocket | null = null
  private reconnectScheduled = false
  private manualClose = false
  private connectedFlag = false
  private nextRequestId = 1

  private readonly pending = new Map<string, PendingRequest>()
  private readonly messageListeners = new Map<string, Set<(data: unknown) => void>>()
  private readonly frameListeners = new Set<(data: ArrayBuffer) => void>()
  private readonly stateListeners = new Set<(connected: boolean) => void>()

  constructor(options: WebUiClientOptions) {
    this.baseUrl = options.url ?? WEBUI_DEFAULT_URL
    this.token = options.token
    this.now = options.now ?? (() => Date.now())
  }

  /** 建立连接；已连接/连接中时幂等。 */
  connect(): void {
    this.manualClose = false
    if (this.socket !== null
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    const url = buildUrl(this.baseUrl, this.readToken())
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      console.error('[webui] 无法创建 WebSocket', error)
      this.scheduleReconnect()
      return
    }
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket) return
      this.setConnected(true)
      this.send(WEBUI_MESSAGE.hello, {})
    }

    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      this.handleMessage(event.data)
    }

    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.setConnected(false)
      this.rejectAllPending('connection closed')
      if (!this.manualClose) this.scheduleReconnect()
    }

    socket.onerror = () => {
      // 错误后必然触发 close，由 onclose 统一收尾/重连。
    }
  }

  connected(): boolean {
    return this.connectedFlag
  }

  /** 连接状态订阅；返回取消订阅。 */
  subscribe(listener: (connected: boolean) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  /** 发请求；未连接立即 reject，回执按 `id` 匹配。 */
  request<T>(type: string, data: unknown = {}): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    const id = String(this.nextRequestId++)
    this.pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    })
    try {
      this.sendEnvelope({ type, data, id })
    } catch (error) {
      this.pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    return promise
  }

  /** 无回执发送；未连接时静默丢弃（与旧前端 `send` 一致）。 */
  send(type: string, data: unknown = {}): void {
    const socket = this.socket
    if (socket === null || socket.readyState !== WebSocket.OPEN) return
    try {
      this.sendEnvelope({ type, data })
    } catch (error) {
      console.error('[webui] 发送失败', type, error)
    }
  }

  /** 订阅服务端推送（按 `type`）。 */
  on(type: string, listener: (data: unknown) => void): () => void {
    let listeners = this.messageListeners.get(type)
    if (listeners === undefined) {
      listeners = new Set()
      this.messageListeners.set(type, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = this.messageListeners.get(type)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.messageListeners.delete(type)
    }
  }

  /** 订阅二进制预览帧（原始 ArrayBuffer，交给 `parsePreviewFrame` 解析）。 */
  onFrame(listener: (data: ArrayBuffer) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  /** 主动关闭（不重连）；pending 全部 reject。 */
  close(): void {
    this.manualClose = true
    const socket = this.socket
    this.socket = null
    this.setConnected(false)
    this.rejectAllPending('connection closed')
    if (socket !== null) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }

  private readToken(): string {
    try {
      return this.token().trim()
    } catch {
      return ''
    }
  }

  private sendEnvelope(envelope: WebUiEnvelope): void {
    const socket = this.socket
    if (socket === null || socket.readyState !== WebSocket.OPEN) throw new Error('not connected')
    socket.send(JSON.stringify(envelope))
  }

  private setConnected(next: boolean): void {
    if (this.connectedFlag === next) return
    this.connectedFlag = next
    for (const listener of [...this.stateListeners]) {
      try {
        listener(next)
      } catch (error) {
        console.error('[webui] 连接状态监听器抛错', error)
      }
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw === 'string') {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      if (!isEnvelope(parsed)) return
      if (parsed.id !== undefined) {
        const pending = this.pending.get(parsed.id)
        if (pending !== undefined) {
          this.pending.delete(parsed.id)
          if (parsed.type === WEBUI_MESSAGE.error) pending.reject(new Error(errorText(parsed.data)))
          else pending.resolve(parsed.data)
        }
      }
      this.dispatch(parsed.type, parsed.data)
      return
    }
    if (raw instanceof ArrayBuffer) {
      for (const listener of [...this.frameListeners]) {
        try {
          listener(raw)
        } catch (error) {
          console.error('[webui] 帧监听器抛错', error)
        }
      }
    }
    // binaryType 已固定 'arraybuffer'；Blob 理论上不会出现，丢弃。
  }

  private dispatch(type: string, data: unknown): void {
    const listeners = this.messageListeners.get(type)
    if (listeners === undefined) return
    for (const listener of [...listeners]) {
      try {
        listener(data)
      } catch (error) {
        console.error(`[webui] ${type} 监听器抛错`, error)
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectScheduled) return
    this.reconnectScheduled = true
    setTimeout(() => {
      this.reconnectScheduled = false
      if (!this.manualClose) this.connect()
    }, WEBUI_RECONNECT_MS)
  }

  private rejectAllPending(reason: string): void {
    if (this.pending.size === 0) return
    const error = new Error(reason)
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

function buildUrl(base: string, token: string): string {
  const url = new URL(base)
  if (token.length > 0) url.searchParams.set('token', token)
  else url.searchParams.delete('token')
  return url.toString()
}

function isEnvelope(value: unknown): value is WebUiEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!('type' in value)) return false
  return typeof value.type === 'string'
}

function errorText(data: unknown): string {
  if (typeof data === 'string' && data.length > 0) return data
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = data.error
    if (typeof error === 'string' && error.length > 0) return error
  }
  return 'webui error'
}
