/**
 * 页面路由（04-04）。
 *
 * 路由是内存状态，不依赖 URL path（Electron 本地 file:// 页面无法承载 URL 路由）。
 * 切页前必须走同一个 `UnsavedGuard`；本模块只管页面栈，不管守卫。
 */
import type { PageRouter } from '../api/registries.ts'

export interface PageStackEntry {
  pageId: string
  params: Record<string, string>
}

/** 内存页面路由。 */
export class PageRouterImpl implements PageRouter {
  private stack: PageStackEntry[]
  private readonly listeners = new Set<(pageId: string) => void>()

  constructor(initialPageId = 'project', initialParams: Record<string, string> = {}) {
    this.stack = [{ pageId: initialPageId, params: { ...initialParams } }]
  }

  get currentPageId(): string {
    const top = this.stack[this.stack.length - 1]
    return top === undefined ? 'project' : top.pageId
  }

  currentParams(): Record<string, string> {
    const top = this.stack[this.stack.length - 1]
    return top === undefined ? {} : { ...top.params }
  }

  navigate(pageId: string, params: Record<string, string> = {}): void {
    const top = this.stack[this.stack.length - 1]
    if (top !== undefined && top.pageId === pageId && sameParams(top.params, params)) {
      return
    }
    this.stack.push({ pageId, params: { ...params } })
    this.emit()
  }

  back(): void {
    if (this.stack.length <= 1) {
      return
    }
    this.stack.pop()
    this.emit()
  }

  canBack(): boolean {
    return this.stack.length > 1
  }

  subscribe(listener: (pageId: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 栈深度（自检 / 诊断用）。 */
  depth(): number {
    return this.stack.length
  }

  /** 清空栈并回到指定页（重置会话用）。 */
  reset(pageId: string, params: Record<string, string> = {}): void {
    this.stack = [{ pageId, params: { ...params } }]
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.currentPageId)
    }
  }
}

function sameParams(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  return leftKeys.every((key) => left[key] === right[key])
}
