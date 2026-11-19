/// <reference lib="es2024.promise" />
/**
 * WebUI WebSocket 客户端（04-09 / 13 轮硬化）。
 *
 * 协议语义参考旧前端 `legacy/src/store.ts`（不得 import）：
 * - 连接 `ws://127.0.0.1:8765/ws?token=...`；
 * - 每次连接/重连前都重新取 token（支持令牌轮换），token 为空则不发起无意义连接；
 * - 断线指数退避：base 1500ms、×2、上限 15000ms；连续失败 8 次后停止自动重连，
 *   由用户显式 `retry()` 再试；
 * - 打开后发 `hello`；回执用同一 `id`；错误回执 reject；
 * - 断连 reject 全部 pending；
 * - 二进制消息按原样交给帧监听器（解析在 `WebUiTransport` 唯一一处完成）。
 */
import {
  WEBUI_DEFAULT_URL,
  WEBUI_MESSAGE,
  WEBUI_RECONNECT_BASE_MS,
  WEBUI_RECONNECT_MAX_ATTEMPTS,
  WEBUI_RECONNECT_MAX_MS,
} from './protocol.ts'
import type { WebUiEnvelope } from './protocol.ts'

export type WebUiConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'no-token'
  | 'stopped'

export interface WebUiConnectionInfo {
  status: WebUiConnectionStatus
  /** 可读原因；无原因时为 `null`。 */
  reason: string | null
}

export interface WebUiClientOptions {
  url?: string
  /** 每次连接/重连前调用；允许返回同步串或 Promise（异步取 token）。 */
  token: () => string | Promise<string>
  now?: () => number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class WebUiClient {
  private readonly baseUrl: string
  private readonly token: () => string | Promise<string>
  readonly now: () => number

  private socket: WebSocket | null = null
  private reconnectScheduled = false
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private manualClose = false
  private connectedFlag = false
  private opening = false
  private failureCount = 0
  private status: WebUiConnectionStatus = 'idle'
  private reason: string | null = null
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

  /** 建立连接；已连接/连接中时幂等。token 异步取到后再握手。 */
  connect(): void {
    this.manualClose = false
    void this.openConnection()
  }

  /** 显式重试：清掉退避计数与待触发定时器，重新取 token 并连接。 */
  retry(): void {
    this.manualClose = false
    this.failureCount = 0
    this.clearReconnectTimer()
    this.reconnectScheduled = false
    void this.openConnection()
  }

  connected(): boolean {
    return this.connectedFlag
  }

  /** 只读连接状态与可读原因（13 轮新增；面板可回落到 `connected()`）。 */
  connection(): WebUiConnectionInfo {
    return { status: this.status, reason: this.reason }
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

  /** 订阅二进制预览帧（原始 ArrayBuffer；解析只在 `WebUiTransport` 做一次）。 */
  onFrame(listener: (data: ArrayBuffer) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  /** 主动关闭（不重连）；pending 全部 reject；清掉待触发的重连定时器。 */
  close(): void {
    this.manualClose = true
    this.clearReconnectTimer()
    this.reconnectScheduled = false
    this.failureCount = 0
    const socket = this.socket
    this.socket = null
    this.setConnected(false)
    this.setStatus('idle', null)
    this.rejectAllPending('connection closed')
    if (socket !== null) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }

  // ── 内部 ──────────────────────────────────────────────────

  private async openConnection(): Promise<void> {
    if (this.opening) return
    if (this.socket !== null
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.opening = true
    try {
      let token = ''
      try {
        const raw = await this.token()
        token = typeof raw === 'string' ? raw.trim() : ''
      } catch {
        // 取 token 失败按空处理：不伪造令牌、不发起无意义连接。
        token = ''
      }
      if (this.manualClose) return

      if (token.length === 0) {
        this.socket = null
        this.setConnected(false)
        this.setStatus('no-token', '缺少 WebUI token：未建立连接（请确认游戏已启动并写入 token 文件）')
        return
      }

      const url = buildUrl(this.baseUrl, token)
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (error) {
        console.error('[webui] 无法创建 WebSocket', error)
        this.recordFailure()
        return
      }
      socket.binaryType = 'arraybuffer'
      this.socket = socket
      this.setStatus(this.failureCount > 0 ? 'reconnecting' : 'connecting', null)

      socket.onopen = () => {
        if (this.socket !== socket) return
        this.failureCount = 0
        this.setConnected(true)
        this.setStatus('connected', null)
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
        if (!this.manualClose) this.recordFailure()
      }

      socket.onerror = () => {
        // 错误后必然触发 close，由 onclose 统一收尾/重连。
      }
    } finally {
      this.opening = false
    }
  }

  private recordFailure(): void {
    this.failureCount += 1
    if (this.failureCount >= WEBUI_RECONNECT_MAX_ATTEMPTS) {
      this.setStatus('stopped', `连续失败 ${WEBUI_RECONNECT_MAX_ATTEMPTS} 次，已停止自动重连`)
      return
    }
    const delay = Math.min(WEBUI_RECONNECT_BASE_MS * 2 ** (this.failureCount - 1), WEBUI_RECONNECT_MAX_MS)
    this.setStatus('reconnecting', `将在 ${Math.round(delay / 1000)}s 后重试`)
    this.scheduleReconnect(delay)
  }

  private scheduleReconnect(delay: number): void {
    if (this.manualClose || this.reconnectScheduled) return
    this.reconnectScheduled = true
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectScheduled = false
      this.reconnectTimer = undefined
      if (!this.manualClose) void this.openConnection()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private setStatus(status: WebUiConnectionStatus, reason: string | null): void {
    const previous = this.status
    this.status = status
    this.reason = reason
    // 状态码变化也要通知订阅者：未连上时 connectedFlag 恒为 false，只靠连接跳变通知，
    // 「缺少 token」这类可读原因会一直不推给面板（13-06 合同要求状态区给出可读原因）。
    if (previous === status) return
    for (const listener of [...this.stateListeners]) {
      try {
        listener(this.connectedFlag)
      } catch {
        // 单个订阅者异常不影响其它订阅者
      }
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
