/**
 * 焦点服务实现（04-10）。
 *
 * 只维护区域注册表、当前区域与各区域的记忆焦点；DOM focus 由调用方在 `onFocus` 里做。
 * 折叠 / 隐藏 / 抽屉关闭的面板通过 `element()` 返回 `null` 表示不可用，F6 自动跳过。
 */
import type { FocusRegion, FocusServicePort } from '../api/commands.ts'
import { buildFocusOrder } from './focusOrder.ts'

export interface FocusServiceOptions {
  onFocus?: (regionId: string) => void
}

export class FocusServiceImpl implements FocusServicePort {
  private readonly onFocus: ((regionId: string) => void) | undefined
  private readonly regions = new Map<string, FocusRegion>()
  private readonly listeners = new Set<(regionId: string | null) => void>()
  /** 每个区域记住的“最后焦点区域”。 */
  private readonly remembered = new Map<string, string>()
  private currentId: string | null = null

  constructor(options: FocusServiceOptions = {}) {
    this.onFocus = options.onFocus
  }

  registerRegion(region: FocusRegion): () => void {
    if (typeof region.id !== 'string' || region.id.length === 0) {
      throw new Error('焦点区域缺少 id')
    }
    if (this.regions.has(region.id)) {
      throw new Error(`焦点区域重复注册："${region.id}"`)
    }

    this.regions.set(region.id, region)

    return () => {
      if (this.regions.get(region.id) !== region) return
      this.regions.delete(region.id)
      if (this.currentId === region.id) {
        this.currentId = null
        this.emit(null)
      }
    }
  }

  focusRegion(regionId: string): void {
    const region = this.regions.get(regionId)
    if (region === undefined) return
    if (!this.isAvailable(region)) return

    const changed = this.currentId !== regionId
    this.currentId = regionId

    if (this.onFocus !== undefined) {
      try {
        this.onFocus(regionId)
      } catch {
        // 调用方的 DOM focus 失败不应破坏服务状态。
      }
    }
    if (changed) this.emit(regionId)
  }

  focusNext(): void {
    this.step(1)
  }

  focusPrev(): void {
    this.step(-1)
  }

  currentRegion(): string | null {
    return this.currentId
  }

  remember(regionId: string): void {
    this.remembered.set(regionId, this.currentId ?? regionId)
  }

  restore(regionId: string): void {
    const remembered = this.remembered.get(regionId)
    if (remembered !== undefined) {
      const region = this.regions.get(remembered)
      if (region !== undefined && this.isAvailable(region)) {
        this.focusRegion(remembered)
        return
      }
    }

    const self = this.regions.get(regionId)
    if (self !== undefined && this.isAvailable(self)) this.focusRegion(regionId)
  }

  subscribe(listener: (regionId: string | null) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private step(direction: 1 | -1): void {
    const order = buildFocusOrder(this.regions.values())
    if (order.length === 0) return

    const index = order.findIndex((region) => region.id === this.currentId)
    const target =
      index < 0
        ? direction === 1
          ? order[0]
          : order[order.length - 1]
        : order[(index + direction + order.length) % order.length]

    this.focusRegion(target.id)
  }

  private isAvailable(region: FocusRegion): boolean {
    try {
      return region.element() !== null
    } catch {
      return false
    }
  }

  private emit(regionId: string | null): void {
    for (const listener of this.listeners) {
      try {
        listener(regionId)
      } catch {
        // 单个订阅者失败不影响其他订阅者。
      }
    }
  }
}
