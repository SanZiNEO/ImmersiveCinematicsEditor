/**
 * 悬停卡脚本摘要缓存（11-02 读取口径）。
 *
 * 缓存键 = 脚本路径 + 文件版本（stamp）：同一文件内容不变才复用旧摘要；
 * 图失效（`script.graph.invalidated` 对应图服务失效事件）时整表丢弃。
 * 本模块不读工作区、不碰文档状态，键比对与淘汰规则均可离线自检。
 */
import type { HoverSummaryOutcome } from './hoverSummary.ts'

/** 单条缓存条目：记录写入时的 stamp，便于按路径淘汰旧版本。 */
interface CacheEntry {
  stamp: string
  outcome: HoverSummaryOutcome
}

/** 「路径 + stamp」缓存键；两者缺一不可，避免旧版本内容串到新文件。 */
export function hoverCacheKey(path: string, stamp: string): string {
  return `${path}␟${stamp}`
}

/**
 * 悬停卡摘要缓存。
 *
 * - `get` 只在路径与 stamp 都匹配时命中；stamp 变化视为未命中，回源重读。
 * - `drop(path)` 淘汰某一路径的全部版本；`clear()` 供图失效事件整表丢弃。
 */
export class HoverScriptCache {
  private readonly entries = new Map<string, CacheEntry>()

  get(path: string, stamp: string): HoverSummaryOutcome | undefined {
    return this.entries.get(hoverCacheKey(path, stamp))?.outcome
  }

  set(path: string, stamp: string, outcome: HoverSummaryOutcome): void {
    this.entries.set(hoverCacheKey(path, stamp), { stamp, outcome })
  }

  drop(path: string): void {
    const prefix = `${path}␟`
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key)
      }
    }
  }

  clear(): void {
    this.entries.clear()
  }

  /** 当前缓存条目数（自检 / 观测用，不参与渲染决策）。 */
  get size(): number {
    return this.entries.size
  }
}
