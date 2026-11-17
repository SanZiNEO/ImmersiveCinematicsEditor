/**
 * 释放栈（04-01）：插件上下文里登记的监听 / 定时器 / 订阅。
 *
 * 逆序释放；单个释放抛错只记日志，不阻塞其他插件。
 */
import type { Disposable, DisposableStore } from '../api/context.ts'

export class DisposableStoreImpl implements DisposableStore {
  private readonly items: Array<{ dispose(): void }> = []
  private disposed = false

  private readonly onError: (message: string, error: unknown) => void

  constructor(onError: (message: string, error: unknown) => void = () => undefined) {
    this.onError = onError
  }

  get size(): number {
    return this.items.length
  }

  add(disposable: Disposable | (() => void)): void {
    const normalized: { dispose(): void } = typeof disposable === 'function'
      ? { dispose: disposable }
      : disposable
    if (this.disposed) {
      normalized.dispose()
      return
    }
    this.items.push(normalized)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const item of this.items.reverse()) {
      try {
        item.dispose()
      } catch (error) {
        this.onError('插件资源释放抛错', error)
      }
    }
    this.items.length = 0
  }
}
