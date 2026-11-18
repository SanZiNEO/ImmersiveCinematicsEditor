/**
 * 图布局持久化（06-12 拆分：只承担"把布局状态写盘"这一类职责）。
 *
 * 从 `core.script-graph/state.ts` 抽出：视图 / 节点位置 / 折叠状态三条防抖写入、
 * 卸载前的冲刷、写入失败的错误上报。调度器不关心这些值从哪来，只负责按时写。
 *
 * 变化理由：写盘时机、防抖窗口、错误上报策略变化。布局算法或交互变化不会改这里。
 */
import type { GraphLayoutServicePort } from '../../workbench/api/graph.ts'
import type { GraphNodePosition, GraphViewState } from '../../core/graph/layout.ts'

/** 写入防抖（毫秒）。 */
export const PERSIST_DEBOUNCE_MS = 500

/** 持久化依赖。 */
export interface LayoutPersistDeps {
  /** 取布局服务；未就绪返回 `null`（此时静默跳过，不伪造成功）。 */
  service: () => GraphLayoutServicePort | null
  /** 当前视图。 */
  view: () => GraphViewState
  /** 当前手动节点位置。 */
  positions: () => Record<string, GraphNodePosition>
  /** 当前折叠集合。 */
  collapsed: () => readonly string[]
  /** 写入失败的上报（面板错误条）。 */
  onError: (message: string) => void
}

/** 把未知异常压成一句可读文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 三条防抖写入的调度器。 */
export class LayoutPersist {
  private readonly deps: LayoutPersistDeps
  private viewTimer: ReturnType<typeof setTimeout> | undefined
  private positionsTimer: ReturnType<typeof setTimeout> | undefined
  private collapsedTimer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: LayoutPersistDeps) {
    this.deps = deps
  }

  /** 视图变化：500ms 后写盘。 */
  scheduleView(): void {
    clearTimeout(this.viewTimer)
    this.viewTimer = setTimeout(() => {
      this.viewTimer = undefined
      void this.persistView()
    }, PERSIST_DEBOUNCE_MS)
  }

  /** 节点位置变化：500ms 后写盘。 */
  schedulePositions(): void {
    clearTimeout(this.positionsTimer)
    this.positionsTimer = setTimeout(() => {
      this.positionsTimer = undefined
      void this.persistPositions()
    }, PERSIST_DEBOUNCE_MS)
  }

  /** 折叠状态变化：500ms 后写盘。 */
  scheduleCollapsed(): void {
    clearTimeout(this.collapsedTimer)
    this.collapsedTimer = setTimeout(() => {
      this.collapsedTimer = undefined
      void this.persistCollapsed()
    }, PERSIST_DEBOUNCE_MS)
  }

  /** 立即写完待写的三条（卸载 / 切换文档时调用）。 */
  flush(): void {
    if (this.viewTimer !== undefined) {
      clearTimeout(this.viewTimer)
      this.viewTimer = undefined
      void this.persistView()
    }
    if (this.positionsTimer !== undefined) {
      clearTimeout(this.positionsTimer)
      this.positionsTimer = undefined
      void this.persistPositions()
    }
    if (this.collapsedTimer !== undefined) {
      clearTimeout(this.collapsedTimer)
      this.collapsedTimer = undefined
      void this.persistCollapsed()
    }
  }

  /** 丢弃待写（不写盘；仅在明确要丢弃时使用）。 */
  dispose(): void {
    clearTimeout(this.viewTimer)
    clearTimeout(this.positionsTimer)
    clearTimeout(this.collapsedTimer)
    this.viewTimer = undefined
    this.positionsTimer = undefined
    this.collapsedTimer = undefined
  }

  private async persistView(): Promise<void> {
    const service = this.deps.service()
    if (service === null) {
      return
    }
    try {
      const result = await service.saveView(this.deps.view())
      if (!result.ok) {
        this.deps.onError(result.message ?? '图视图未保存')
      }
    } catch (error) {
      this.deps.onError(messageOf(error))
    }
  }

  private async persistPositions(): Promise<void> {
    const service = this.deps.service()
    if (service === null) {
      return
    }
    try {
      const result = await service.saveNodePositions({ ...this.deps.positions() })
      if (!result.ok) {
        this.deps.onError(result.message ?? '节点位置未保存')
      }
    } catch (error) {
      this.deps.onError(messageOf(error))
    }
  }

  private async persistCollapsed(): Promise<void> {
    const service = this.deps.service()
    if (service === null) {
      return
    }
    try {
      const result = await service.setCollapsed([...this.deps.collapsed()])
      if (!result.ok) {
        this.deps.onError(result.message ?? '折叠状态未保存')
      }
    } catch (error) {
      this.deps.onError(messageOf(error))
    }
  }
}
