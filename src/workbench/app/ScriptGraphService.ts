/**
 * 05-01 / 05-08 脚本图服务：一次扫描、版本、失效广播与 unchanged 短路。
 *
 * 唯一扫描源：`source.list()` 一次 + 每个路径 `source.load()`。服务不递归目录、
 * 不读本地文件、不维护第二份关系表；图数据由 `buildGraph` 纯函数产出。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { buildGraph, normalizeScriptPath } from '../../core/graph/index.ts'
import { emptyGraph } from '../../core/graph/types.ts'
import type { GraphData, GraphScriptFile } from '../../core/graph/types.ts'
import type {
  GraphInvalidation,
  GraphInvalidationKind,
  GraphServicePort,
  ScriptSource,
} from '../api/graph.ts'

export interface ScriptGraphServiceOptions {
  source: ScriptSource
  catalog: CatalogIndex
  now?: () => number
}

/** 图服务实现。 */
export class ScriptGraphService implements GraphServicePort {
  private source: ScriptSource
  private readonly keys: readonly string[]
  private readonly clock: () => number

  private data: GraphData | null = null
  private versionNumber = 0
  private staleFlag = true
  private error: string | null = null
  private inflight: Promise<GraphData> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined = undefined
  private readonly listeners = new Set<(event: GraphInvalidation) => void>()

  constructor(options: ScriptGraphServiceOptions) {
    this.source = options.source
    this.keys = metaKeys(options.catalog)
    this.clock = options.now ?? (() => Date.now())
  }

  connected(): boolean {
    return this.source.connected?.() ?? true
  }

  current(): GraphData | null {
    return this.data
  }

  version(): number {
    return this.versionNumber
  }

  stale(): boolean {
    return this.staleFlag
  }

  lastError(): string | null {
    return this.error
  }

  subscribe(listener: (event: GraphInvalidation) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async snapshot(sinceVersion?: number): Promise<GraphData> {
    if (this.data !== null && !this.staleFlag) {
      if (sinceVersion === this.versionNumber) {
        return {
          ...this.data,
          unchanged: true,
          nodes: [],
          edges: [],
          folders: [],
          warnings: [],
        }
      }
      return this.data
    }
    return this.refresh()
  }

  async refresh(): Promise<GraphData> {
    if (this.inflight !== null) {
      return this.inflight
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.inflight = this.runRefresh()
    try {
      return await this.inflight
    } finally {
      this.inflight = null
    }
  }

  private async runRefresh(): Promise<GraphData> {
    const start = this.clock()
    try {
      const paths = await this.source.list()
      const normalized = [...new Set(paths
        .map((path) => normalizeScriptPath(path))
        .filter((path): path is string => path !== null))]
        .sort((left, right) => left.localeCompare(right))

      const files: GraphScriptFile[] = []
      for (const path of normalized) {
        try {
          files.push({ path, doc: await this.source.load(path) })
        } catch (error) {
          files.push({
            path,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      this.versionNumber += 1
      const data = buildGraph(files, {
        version: this.versionNumber,
        metaKeys: this.keys,
        scanMillis: Math.max(0, this.clock() - start),
      })
      this.data = data
      this.staleFlag = false
      this.error = null
      return data
    } catch (error) {
      this.staleFlag = true
      this.error = error instanceof Error ? error.message : String(error)
      throw error instanceof Error ? error : new Error(this.error)
    }
  }

  invalidate(kind: GraphInvalidationKind, paths?: readonly string[]): void {
    this.versionNumber += 1
    this.staleFlag = true
    const event: GraphInvalidation = {
      version: this.versionNumber,
      kind,
      ...(paths === undefined ? {} : { paths: [...paths] }),
    }
    for (const listener of [...this.listeners]) {
      listener(event)
    }
  }

  scheduleRefresh(delayMs = 1000): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refresh().catch(() => undefined)
    }, delayMs)
  }

  /** 切换来源（宿主重连/诊断；清空缓存与版本）。 */
  setSource(source: ScriptSource): void {
    this.source = source
    this.data = null
    this.staleFlag = true
    this.error = null
    this.versionNumber += 1
  }

  /** 空图（断连且从未成功时面板可用；不冒充扫描结果）。 */
  empty(): GraphData {
    return emptyGraph(this.versionNumber)
  }
}
