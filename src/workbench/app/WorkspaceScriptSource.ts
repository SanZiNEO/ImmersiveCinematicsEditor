/**
 * 工作区脚本来源（03-07）：直接读写 `<游戏根目录>/immersive_cinematics/scripts/`。
 *
 * 为什么不走模组：脚本是固定格式的 JSON，编辑器本来就持有完整文档模型；
 * 走 WebSocket 每个脚本一次往返，10 万脚本要几十秒到几分钟。
 * 直接读目录则是一次扫描 + 按需解析，模组只在推送播放与预览画面时参与。
 *
 * 增量：用 `scriptStamps()`（mtime + size）判断文件是否变化，
 * 没变就复用上次解析出的文档对象——刷新整图时只重读真正改动过的文件。
 */
import type { JsonValue } from '../../core/doc/types.ts'
import type { ScriptSource } from '../api/graph.ts'
import type { WorkspacePort } from '../api/host.ts'

/** 解析结果缓存项。 */
interface CacheEntry {
  stamp: string
  doc: JsonValue
}

export interface WorkspaceScriptSourceOptions {
  workspace: WorkspacePort
  /** 解析 JSON（注入以便复用 `parseDoc` 之前的原文解析；缺省用 `JSON.parse`）。 */
  parse?: (text: string) => JsonValue
}

export class WorkspaceScriptSource implements ScriptSource {
  private readonly workspace: WorkspacePort
  private readonly parse: (text: string) => JsonValue
  /** `path → {stamp, doc}`：stamp 未变就跳过重解析。 */
  private readonly cache = new Map<string, CacheEntry>()
  /** 上次探测到的「工作区是否已设置」；`null` = 还没探测过。 */
  private readyFlag: boolean | null = null

  constructor(options: WorkspaceScriptSourceOptions) {
    this.workspace = options.workspace
    this.parse = options.parse ?? ((text) => JSON.parse(text) as JsonValue)
  }

  /**
   * 工作区是否可用（已设置根目录且目录存在）。
   *
   * 与游戏是否运行无关——脚本读写不依赖模组。首次调用前返回 `true`
   * 并异步探测，避免把「还没探测」误报成不可用。
   */
  connected(): boolean {
    if (this.readyFlag === null) {
      void this.probe()
      return true
    }
    return this.readyFlag
  }

  /** 主动探测（设置工作区后调用，立即刷新 `connected()`）。 */
  async probe(): Promise<boolean> {
    try {
      const root = await this.workspace.root()
      this.readyFlag = root !== null
    } catch {
      this.readyFlag = false
    }
    return this.readyFlag
  }

  async list(): Promise<string[]> {
    return this.workspace.listScripts()
  }

  async load(path: string): Promise<JsonValue> {
    const read = await this.workspace.readScript(path)
    if (read === null) {
      throw new Error(`脚本不存在：${path}`)
    }
    const cached = this.cache.get(path)
    if (cached !== undefined && cached.stamp === read.stamp) {
      return cached.doc
    }
    const doc = this.parse(read.text)
    this.cache.set(path, { stamp: read.stamp, doc })
    return doc
  }

  async save(path: string, doc: JsonValue): Promise<void> {
    await this.workspace.writeScript(path, `${JSON.stringify(doc, null, 2)}\n`)
    // 写盘后重读一次拿到真实指纹，避免缓存与磁盘状态脱节。
    const read = await this.workspace.readScript(path)
    if (read === null) {
      this.cache.delete(path)
      return
    }
    this.cache.set(path, { stamp: read.stamp, doc })
  }

  /**
   * 批量刷新缓存：按 `scriptStamps()` 只重解析变化过的文件。
   *
   * 返回「本批可直接复用」的 path 集合，供上层跳过 `load`。
   * 未在缓存里的文件不会被标记（上层仍需读一次）。
   */
  async refreshStamps(): Promise<Set<string>> {
    const stamps = await this.workspace.scriptStamps()
    const reusable = new Set<string>()
    for (const [path, stamp] of Object.entries(stamps)) {
      const cached = this.cache.get(path)
      if (cached !== undefined && cached.stamp === stamp) {
        reusable.add(path)
      }
    }
    // 已删除的文件清出缓存。
    for (const path of [...this.cache.keys()]) {
      if (stamps[path] === undefined) {
        this.cache.delete(path)
      }
    }
    return reusable
  }

  /** 缓存里的文档（增量刷新时直接取用，不再读盘）。 */
  cached(path: string): JsonValue | undefined {
    return this.cache.get(path)?.doc
  }

  clear(): void {
    this.cache.clear()
  }
}
