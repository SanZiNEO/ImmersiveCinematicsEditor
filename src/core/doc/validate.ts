/**
 * 服务端校验桥（03-06）。
 *
 * 本地只查结构；语义以 `script.validate` 为权威。桥的行为：
 * - 编辑停止 400ms 发一次；每次新请求取消上一次未发请求；
 * - `ok` 只表示「没有非警告 issue」，编辑器必须同时看 `issues`；
 * - 失败（断连）→ 保留上一批 issue 并标「已过期」；
 * - issue 定位到 `clipKey + objectPath + keyframeTime` 是尽力而为：解析失败只保留原文，不猜。
 */
import type { JsonObject, ScriptDoc } from './types.ts'
import type { DocIssue, Severity } from './types.ts'
import type { DocStore } from './store.ts'
import type { ClipRegistry } from './identity.ts'
import { isJsonObject } from './json.ts'

/** 服务端 `script.validate` 的原始回执。 */
export interface ServerValidateResult {
  ok: boolean
  issues: string[]
}

/** 校验桥依赖的传输能力。 */
export interface ValidationTransport {
  validate(doc: JsonObject): Promise<ServerValidateResult>
}

export interface ValidationBridgeOptions {
  transport: ValidationTransport
  store: DocStore
  /** 防抖毫秒（03-06：400ms）。 */
  debounceMs?: number
  /** 取当前文档（默认 store.doc）。 */
  payload?: () => JsonObject | null
  /** 时钟（测试注入）。 */
  now?: () => number
}

/** 服务端 issue 的警告前缀（`ScriptValidator.WARNING_PREFIX`）。 */
export const SERVER_WARNING_PREFIX = '[警告] '

/** 从 issue 文本解析出定位（`timeline.tracks[0].clips[1].objects.yaw.keyframes[0].time`）。 */
const LOCATION_PATTERN = /^(timeline\.tracks\[(\d+)\]\.clips\[(\d+)\]|clips\[(\d+)\])(?:\.objects\.([a-z][a-z0-9_.]*?))?(?:\.keyframes\[(\d+)\])?/

/**
 * 把服务端 issue 文本转成 `DocIssue`。
 *
 * 定位只在能精确解析路径时给出；解析失败时只保留原文（`jsonPath: '<server>'`）。
 */
export function parseServerIssue(
  text: string,
  doc: ScriptDoc,
  registry: ClipRegistry,
): DocIssue {
  const severity: Severity = text.startsWith(SERVER_WARNING_PREFIX) ? 'warn' : 'error'
  const issue: DocIssue = {
    code: 'S_VALIDATE',
    severity,
    message: text,
    jsonPath: '<server>',
    source: 'server',
  }
  const body = text.startsWith(SERVER_WARNING_PREFIX) ? text.slice(SERVER_WARNING_PREFIX.length) : text
  const match = LOCATION_PATTERN.exec(body)
  if (match === null) {
    return issue
  }
  const trackIndex = match[2] === undefined ? undefined : Number(match[2])
  const clipIndex = match[3] === undefined ? undefined : Number(match[3])
  const standaloneIndex = match[4] === undefined ? undefined : Number(match[4])
  const handle = registry.handles().find((candidate) => {
    if (candidate.inline) {
      return candidate.trackIndex === trackIndex && candidate.clipIndex === clipIndex
    }
    return candidate.clipIndex === standaloneIndex
  })
  issue.jsonPath = match[0]
  if (handle !== undefined) {
    issue.clipKey = handle.key
  }
  const objectPath = match[5]
  if (objectPath !== undefined) {
    issue.objectPath = objectPath
  }
  const frameIndex = match[6]
  if (frameIndex !== undefined && handle !== undefined && objectPath !== undefined) {
    const objects = handle.clip.objects
    const property = isJsonObject(objects) ? objects[objectPath] : undefined
    const keyframes = isJsonObject(property) ? property.keyframes : undefined
    if (Array.isArray(keyframes)) {
      const frame = keyframes[Number(frameIndex)]
      if (isJsonObject(frame) && typeof frame.time === 'number') {
        issue.keyframeTime = frame.time
      }
    }
  }
  void doc
  return issue
}

/** 校验桥：防抖调度 + 请求序号（丢弃过期回执）+ 断连保留。 */
export class ValidationBridge {
  private readonly transport: ValidationTransport
  private readonly store: DocStore
  private readonly debounceMs: number
  private readonly payload: () => JsonObject | null
  private timer: ReturnType<typeof setTimeout> | undefined = undefined
  private sequence = 0
  private disposed = false

  constructor(options: ValidationBridgeOptions) {
    this.transport = options.transport
    this.store = options.store
    this.debounceMs = options.debounceMs ?? 400
    this.payload = options.payload ?? (() => this.store.doc?.root ?? null)
  }

  /** 调度一次校验（取消上一次未发请求）。 */
  schedule(): void {
    if (this.disposed) {
      return
    }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  /** 取消未发请求（不清除已有 issue）。 */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** 立即发送一次；过期回执丢弃。 */
  async flush(): Promise<void> {
    if (this.disposed) {
      return
    }
    const doc = this.store.doc
    const payload = this.payload()
    if (doc === null || payload === null) {
      return
    }
    this.sequence += 1
    const sequence = this.sequence
    this.store.transport.requestId = sequence
    this.store.transport.pending += 1
    try {
      const result = await this.transport.validate(payload)
      if (sequence !== this.sequence) {
        return
      }
      const issues = result.issues.map((text) => parseServerIssue(text, doc, this.store.registry))
      this.store.setServerIssues(issues, false)
      this.store.transport.lastError = null
    } catch (error) {
      if (sequence !== this.sequence) {
        return
      }
      this.store.transport.lastError = error instanceof Error ? error.message : String(error)
      this.store.markServerIssuesStale()
    } finally {
      this.store.transport.pending = Math.max(0, this.store.transport.pending - 1)
    }
  }

  /** 释放：取消定时器并作废进行中的回执。 */
  dispose(): void {
    this.disposed = true
    this.cancel()
    this.sequence += 1
  }
}
