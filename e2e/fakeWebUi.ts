/**
 * 端到端测试用的 WebUI 假服务（浏览器侧注入）。
 *
 * 只替身网络边界：协议信封、`script.list/load/save/validate/new`、`editor.*` 与
 * `playback.state` 都按真实 WebUI 形状应答；图索引、文档命令、UI 渲染仍走真实实现。
 * 数据只存在页面内存，测试通过 `window.__fakeWebUi` 读取文件与请求计数。
 */

export interface FakeWebUiFile {
  path: string
  doc: unknown
}

export function installFakeWebUi(initial: Record<string, unknown>): void {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  const clone = <T>(value: T): T =>
    value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
  const readPath = (data: unknown): string | null =>
    isObject(data) && typeof data.path === 'string' ? data.path : null

  const files = new Map<string, unknown>(Object.entries(initial))
  const sockets: FakeSocket[] = []
  const requests: string[] = []
  let offline = false
  let failSavePath: string | null = null
  let nextId = 1

  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 0
    binaryType = 'arraybuffer'
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    readonly url: string

    constructor(url: string) {
      this.url = url
      sockets.push(this)
      if (offline) {
        queueMicrotask(() => this.fail())
        return
      }
      queueMicrotask(() => {
        this.readyState = 1
        this.onopen?.(new Event('open'))
      })
    }

    send(raw: unknown): void {
      if (typeof raw !== 'string') {
        return
      }
      let envelope: { type?: unknown; data?: unknown; id?: unknown }
      try {
        envelope = JSON.parse(raw) as { type?: unknown; data?: unknown; id?: unknown }
      } catch {
        return
      }
      if (typeof envelope.type !== 'string') {
        return
      }
      requests.push(envelope.type)
      const id = typeof envelope.id === 'string' ? envelope.id : undefined
      const respond = (type: string, data: unknown): void => {
        if (this.readyState !== 1) {
          return
        }
        this.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({ type, data, ...(id === undefined ? {} : { id }) }),
        }))
      }
      const fail = (message: string): void => {
        if (id === undefined) {
          return
        }
        this.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({ type: 'error', data: { error: message }, id }),
        }))
      }

      switch (envelope.type) {
        case 'hello':
          respond('hello_ack', { version: 'e2e' })
          return
        case 'script.list':
          respond('script.list', { files: [...files.keys()].sort() })
          return
        case 'script.load': {
          const path = readPath(envelope.data)
          if (path === null || !files.has(path)) {
            fail(`脚本不存在：${String(path)}`)
            return
          }
          respond('script.load', { path, doc: clone(files.get(path)) })
          return
        }
        case 'script.save': {
          const path = readPath(envelope.data)
          const data = isObject(envelope.data) ? envelope.data.doc : undefined
          if (path === null || data === undefined) {
            fail('script.save 参数错误')
            return
          }
          if (failSavePath === path) {
            failSavePath = null
            fail(`模拟写失败：${path}`)
            return
          }
          files.set(path, clone(data))
          respond('script.save', { path, serverNotified: true })
          return
        }
        case 'script.new':
          respond('script.new', { path: 'untitled.json', doc: { meta: {}, timeline: { tracks: [] } } })
          return
        case 'script.validate':
          respond('script.validate', { ok: true, issues: [] })
          return
        case 'editor.pushScript':
          respond('editor.pushScript', { ok: true })
          return
        case 'editor.seek':
          respond('editor.seek', {})
          return
        case 'editor.previewConfig':
          respond('editor.previewConfig', {
            mode: '1080p',
            width: 1920,
            height: 1080,
            fps: 60,
            encoder: true,
            keyframeIntervalSeconds: 2,
          })
          return
        default:
          respond(envelope.type, {})
      }
    }

    close(): void {
      if (this.readyState === 3) {
        return
      }
      this.readyState = 3
      this.onclose?.(new CloseEvent('close'))
    }

    fail(): void {
      this.readyState = 3
      this.onerror?.(new Event('error'))
      this.onclose?.(new CloseEvent('close'))
    }
  }

  const api = {
    files,
    requests,
    socketCount: () => sockets.length,
    disconnect(): void {
      offline = true
      for (const socket of [...sockets]) {
        socket.close()
      }
    },
    reconnect(): void {
      offline = false
    },
    get(path: string): unknown {
      return clone(files.get(path))
    },
    set(path: string, doc: unknown): void {
      files.set(path, clone(doc))
    },
    failNextSave(path: string): void {
      failSavePath = path
    },
    push(type: string, data: unknown): void {
      for (const socket of sockets) {
        if (socket.readyState === 1) {
          socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type, data }) }))
        }
      }
    },
    requestCount(type?: string): number {
      return type === undefined ? requests.length : requests.filter((entry) => entry === type).length
    },
    nextId: () => nextId++,
  }
  Reflect.set(window, '__fakeWebUi', api)
  Reflect.set(window, 'WebSocket', FakeSocket)
}

/** 构造一个可被 parser 接受的最小脚本。 */
export function makeScript(id: string, name: string, requires: unknown[] = [], description = ''): Record<string, unknown> {
  return {
    meta: {
      id,
      name,
      author: 'e2e',
      description,
      triggers: requires.length === 0
        ? []
        : [{
            id: `${id}_trigger`,
            type: 'login',
            conditions: {},
            repeatable: false,
            delay: 0,
            requires,
          }],
    },
    timeline: { tracks: [] },
  }
}
