/**
 * 打开 / 新建 / 保存 / 推送流水线（03-07）。
 *
 * 核心原则：
 * - 保存与推送都从同一份 `serializeDoc(doc)` 派生（不烘焙、不剥离、不裁剪）；
 * - `dirty` 只在保存成功后清；
 * - 文件被外部改动 → 冲突，不自动覆盖；
 * - 打开只读不改写文档（不写总时长、不补默认值）；
 * - 新建骨架的 meta 默认值来自 02 目录，引导片段只写固定值。
 *
 * 协议缺口（记录在执行报告，不在编辑器侧假装解决）：
 * - `script.save` 没有服务端指纹 / mtime 检查，冲突检测由本模块在保存前用 `script.load` 对比内容 hash；
 * - `editor.pushScript` 的 ack 只表示「已发出」，`PreviewChannel` 会吞掉解析失败；
 *   预览是否真的更新以 `playback.state` / 预览帧为准（`markPreviewPushed` 可由外部在收到状态时调用）。
 */
import type { CatalogIndex } from '../schema/index.ts'
import { sha256Hex } from '../schema/hash.ts'
import { bindDocument } from './binding.ts'
import type { DocBinding } from './binding.ts'
import { cloneJson } from './json.ts'
import { parseDoc } from './parse.ts'
import { serializeDoc, serializeForPreview } from './serialize.ts'
import type { DocStore } from './store.ts'
import type { DocIssue, JsonObject, JsonValue } from './types.ts'


/** 传输层能力（与主模组 `script.*` / `editor.*` 消息一一对应）。 */
export interface DocTransport {
  load(path: string): Promise<{ path: string; doc: JsonValue }>
  /** 可选：读原文（冲突检测用；缺失时用 `JSON.stringify(doc)`）。 */
  loadRaw?(path: string): Promise<string>
  save(path: string, doc: JsonObject): Promise<{ path: string }>
  validate(doc: JsonObject): Promise<{ ok: boolean; issues: string[] }>
  pushScript(script: string): Promise<{ ok: boolean; reason?: string }>
  newScript(): Promise<{ path: string; doc: JsonValue }>
  seek(time: number): Promise<void>
  /** 可选：文件是否存在（首次保存防覆盖用）。 */
  exists?(path: string): Promise<boolean>
}

export interface DocIoOptions {
  transport: DocTransport
  catalog: CatalogIndex
  metaKeys: readonly string[]
  store: DocStore
  /** 推送防抖毫秒（03-07：160ms）。 */
  debounceMs?: number
  /** 内容哈希（测试注入；默认 SHA-256）。 */
  hash?: (text: string) => Promise<string>
  now?: () => number
}

/** 打开结果。 */
export interface OpenResult {
  ok: boolean
  issues: DocIssue[]
  error?: string
}

/** 保存结果。 */
export interface SaveResult {
  ok: boolean
  reason?: 'no-doc' | 'blocked' | 'conflict' | 'needs-path' | 'failed'
  issues?: DocIssue[]
  message?: string
  path?: string
}

/** 推送结果。 */
export interface PushResult {
  ok: boolean
  reason?: string
}

/** 新建骨架：`meta` 默认值来自 02 目录；7 条内置轨道各带空 `clips`；CAMERA 一条引导片段。 */
export function buildNewDoc(catalog: CatalogIndex): JsonObject {
  const meta: JsonObject = {}
  for (const entry of catalog.search({ segment: 'meta' })) {
    if (!entry.hasDefault) {
      continue
    }
    meta[entry.key] = cloneJson(entry.default as JsonValue)
  }
  if (typeof meta.id !== 'string' || meta.id.length === 0) {
    meta.id = 'untitled'
  }
  if (typeof meta.name !== 'string' || meta.name.length === 0) {
    meta.name = 'Untitled'
  }
  meta.author = ''

  const trackOrder: string[] = []
  for (const entry of catalog.search({ segment: 'tracks' })) {
    const type = entry.scope[0]
    if (type !== undefined && !trackOrder.includes(type)) {
      trackOrder.push(type)
    }
  }

  const guide: JsonObject = {
    start_time: 0,
    duration: 5,
    objects: {
      position_mode: { value: 'relative' },
      position_space: { value: 'world' },
      'position.y': { value: 2 },
      yaw: { value: 0 },
      pitch: { value: 0 },
      roll: { value: 0 },
      fov: { value: 70 },
      zoom: { value: 1 },
      transition: { value: 'cut' },
    },
  }

  const tracks: JsonValue[] = trackOrder.map((type) => ({
    type,
    clips: type === 'CAMERA' ? [guide] : [],
  }))

  return {
    meta,
    timeline: { tracks },
  }
}

/** 内容指纹：优先原文（`loadRaw`），否则语义等价的 `JSON.stringify`。 */
async function fingerprintOf(
  transport: DocTransport,
  path: string,
  hash: (text: string) => Promise<string>,
): Promise<string | null> {
  try {
    if (transport.loadRaw !== undefined) {
      return await hash(await transport.loadRaw(path))
    }
    const loaded = await transport.load(path)
    return await hash(JSON.stringify(loaded.doc))
  } catch {
    return null
  }
}

/** 文档 IO 流水线。 */
export class DocIo {
  private readonly transport: DocTransport
  private readonly catalog: CatalogIndex
  private readonly metaKeys: readonly string[]
  private readonly store: DocStore
  private readonly debounceMs: number
  private readonly hash: (text: string) => Promise<string>
  private readonly now: () => number

  private binding: DocBinding | null = null
  private fingerprint: string | null = null
  private pushTimer: ReturnType<typeof setTimeout> | undefined = undefined
  private unsubscribe: (() => void) | null = null

  constructor(options: DocIoOptions) {
    this.transport = options.transport
    this.catalog = options.catalog
    this.metaKeys = options.metaKeys
    this.store = options.store
    this.debounceMs = options.debounceMs ?? 160
    this.hash = options.hash ?? sha256Hex
    this.now = options.now ?? (() => Date.now())
    this.unsubscribe = this.store.subscribe((event) => {
      if (event === 'commit' || event === 'undo' || event === 'redo') {
        this.schedulePush()
      }
    })
  }

  /** 当前目录绑定（打开 / 重绑后非空）。 */
  currentBinding(): DocBinding | null {
    return this.binding
  }

  /** 打开：load → parseDoc → 绑定 → 指纹 → 推送 + seek(0)。 */
  async open(path: string): Promise<OpenResult> {
    let loaded: { path: string; doc: JsonValue }
    try {
      loaded = await this.transport.load(path)
    } catch (error) {
      return {
        ok: false,
        issues: [],
        error: `script.load 失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    const parsed = parseDoc(loaded.doc, { metaKeys: this.metaKeys })
    if (!parsed.ok) {
      return { ok: false, issues: parsed.issues, error: '文档无法进入编辑器（parseDoc 失败）' }
    }

    this.store.open(parsed.doc, loaded.path)
    this.binding = bindDocument(parsed.doc, this.catalog, this.catalogHash(), this.store.registry)
    this.store.setCatalogHash(this.binding.catalogHash)
    this.store.setCatalogIssues([])
    this.store.recomputeDerived()
    this.fingerprint = await fingerprintOf(this.transport, loaded.path, this.hash)

    await this.push()
    try {
      await this.transport.seek(0)
    } catch {
      // seek 失败不阻断打开；预览位置由 UI 兜底。
    }

    return { ok: true, issues: [...parsed.issues, ...this.store.derived.localIssues] }
  }

  /** 新建：服务端模板 + 编辑器骨架；新建即脏，不自动保存。 */
  async newDocument(): Promise<OpenResult> {
    let created: { path: string; doc: JsonValue }
    try {
      created = await this.transport.newScript()
    } catch (error) {
      return {
        ok: false,
        issues: [],
        error: `script.new 失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    const skeleton = buildNewDoc(this.catalog)
    const merged: JsonObject = {
      ...cloneJson(created.doc as JsonObject),
      meta: skeleton.meta,
      timeline: skeleton.timeline,
    }
    const parsed = parseDoc(merged, { metaKeys: this.metaKeys })
    if (!parsed.ok) {
      return { ok: false, issues: parsed.issues, error: '新建骨架无法解析（02 目录默认值异常）' }
    }

    this.store.open(parsed.doc, created.path)
    this.binding = bindDocument(parsed.doc, this.catalog, this.catalogHash(), this.store.registry)
    this.store.setCatalogHash(this.binding.catalogHash)
    this.store.markDirty()
    this.fingerprint = null
    this.store.recomputeDerived()

    await this.push()
    try {
      await this.transport.seek(0)
    } catch {
      // 同上。
    }
    return { ok: true, issues: this.store.derived.localIssues }
  }

  /**
   * 保存：block 中止 → serializeDoc → 指纹冲突检测 → script.save。
   *
   * @param pathOverride 首次保存时作者输入的新路径（不得覆盖已有文件）
   */
  async save(pathOverride?: string): Promise<SaveResult> {
    const doc = this.store.doc
    if (doc === null) {
      return { ok: false, reason: 'no-doc' }
    }
    this.store.recomputeDerived()
    const blocking = this.store.derived.localIssues.filter((issue) => issue.severity === 'block')
    if (blocking.length > 0) {
      return { ok: false, reason: 'blocked', issues: blocking }
    }

    const path = pathOverride ?? this.store.session.currentPath
    if (path === null || path.length === 0) {
      return { ok: false, reason: 'needs-path', message: '首次保存需要作者输入路径' }
    }

    if (pathOverride !== undefined && pathOverride !== this.store.session.currentPath) {
      const exists = await this.exists(pathOverride)
      if (exists) {
        return { ok: false, reason: 'needs-path', message: `目标文件已存在，不能覆盖: ${pathOverride}` }
      }
    }

    // 首次保存（本次会话尚未落盘）且目标已存在：不得覆盖，要求作者改名。
    if (this.fingerprint === null && await this.exists(path)) {
      return {
        ok: false,
        reason: 'needs-path',
        message: `目标文件已存在，首次保存不能覆盖: ${path}（请另存为新路径）`,
      }
    }

    if (this.fingerprint !== null) {
      const current = await fingerprintOf(this.transport, path, this.hash)
      if (current !== null && current !== this.fingerprint) {
        return {
          ok: false,
          reason: 'conflict',
          message: '文件已被外部改动；请选择覆盖 / 另存 / 放弃（编辑器不自动合并）',
        }
      }
    }

    const payload = serializeDoc(doc)
    try {
      const saved = await this.transport.save(path, payload)
      this.store.session.currentPath = saved.path
      this.fingerprint = await this.hash(JSON.stringify(payload))
      this.store.markSaved()
      return { ok: true, path: saved.path }
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** 160ms 防抖：多次 commit 只推最新一份。 */
  schedulePush(): void {
    clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined
      void this.push()
    }, this.debounceMs)
  }

  /** 推送预览：`serializeForPreview`（静音 AUDIO 轨裁剪），失败标「预览过期」。 */
  async push(): Promise<PushResult> {
    const doc = this.store.doc
    if (doc === null) {
      return { ok: false, reason: 'no-doc' }
    }
    const payload = serializeForPreview(doc, (_track, index) => this.store.isAudioMuted(index))
    try {
      const result = await this.transport.pushScript(JSON.stringify(payload))
      if (!result.ok) {
        this.store.markPreviewStale()
        return { ok: false, reason: result.reason ?? 'push-failed' }
      }
      this.store.markPreviewPushed(this.now())
      return { ok: true }
    } catch (error) {
      this.store.markPreviewStale()
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 释放订阅与定时器。 */
  dispose(): void {
    clearTimeout(this.pushTimer)
    this.pushTimer = undefined
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private catalogHash(): string {
    return this.store.session.catalogHash ?? ''
  }

  private async exists(path: string): Promise<boolean> {
    if (this.transport.exists !== undefined) {
      return this.transport.exists(path)
    }
    try {
      await this.transport.load(path)
      return true
    } catch {
      return false
    }
  }
}
