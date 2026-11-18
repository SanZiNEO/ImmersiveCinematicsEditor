/**
 * 悬停意图状态机（06-12 共享交互抽取）。
 *
 * 从 `core.script-graph/state.ts` 抽出，行为等价：进入有延迟（避免扫过时闪烁）、
 * 离开有延迟（允许指针移到悬浮卡片上）、进入期间可冻结外部动画（节点在指针下移动
 * 会让 pointerleave 抖动）。调用方提供 `onShow` / `onHide` 两个副作用。
 *
 * 本模块不碰 DOM、不碰 Vue、不碰文档：只做计时与状态迁移。
 */

/**
 * 计时器句柄：由注入的 `setTimer` 返回、由 `clearTimer` 消费。
 *
 * 本模块不假设宿主是浏览器还是 Node：句柄形状由注入方定义，
 * 这里只负责原样传递，不做类型推断。
 */
export type HoverTimerHandle = unknown

/** 悬停意图选项。 */
export interface HoverIntentOptions {
  /** 进入后多久显示（毫秒）。 */
  showDelayMs?: number
  /** 离开后多久隐藏（毫秒）。 */
  hideDelayMs?: number
  /** 显示时的副作用（可在此冻结布局动画）。 */
  onShow: (key: string) => void
  /** 隐藏时的副作用。 */
  onHide: () => void
  /** 进入计时开始时的副作用（可选，用于冻结动画）。 */
  onIntent?: (key: string) => void
  /** 计时器注入（测试用）。 */
  setTimer?: (handler: () => void, ms: number) => HoverTimerHandle
  clearTimer?: (handle: HoverTimerHandle) => void
}

/** 悬停意图控制器。 */
export class HoverIntent {
  private readonly showDelayMs: number
  private readonly hideDelayMs: number
  private readonly onShow: (key: string) => void
  private readonly onHide: () => void
  private readonly onIntent: ((key: string) => void) | undefined
  private readonly setTimer: (handler: () => void, ms: number) => HoverTimerHandle
  private readonly clearTimer: (handle: HoverTimerHandle) => void

  private showTimer: HoverTimerHandle = null
  private hideTimer: HoverTimerHandle = null
  private candidate: string | null = null
  private shown: string | null = null

  constructor(options: HoverIntentOptions) {
    this.showDelayMs = options.showDelayMs ?? 250
    this.hideDelayMs = options.hideDelayMs ?? 420
    this.onShow = options.onShow
    this.onHide = options.onHide
    this.onIntent = options.onIntent
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    })
  }

  /** 指针进入某个目标：延迟显示；已在显示或已在同一候选的计时中则不动。 */
  intent(key: string): void {
    this.cancelHide()
    if (this.shown === key) {
      return
    }
    if (this.candidate === key && this.showTimer !== null) {
      return
    }
    this.onIntent?.(key)
    this.cancelShow()
    this.candidate = key
    this.showTimer = this.setTimer(() => {
      this.showTimer = null
      this.candidate = null
      this.shown = key
      this.onShow(key)
    }, this.showDelayMs)
  }

  /** 立即显示（键盘聚焦等场景，不依赖计时）。 */
  now(key: string): void {
    this.clearTimers()
    this.shown = key
    this.onShow(key)
  }

  /** 指针移到悬浮内容上：取消隐藏与待显示。 */
  keep(): void {
    this.cancelHide()
    this.cancelShow()
  }

  /** 指针离开：延迟隐藏；已经隐藏则不动。 */
  leave(): void {
    this.cancelShow()
    if (this.shown === null) {
      return
    }
    this.cancelHide()
    this.hideTimer = this.setTimer(() => {
      this.hideTimer = null
      this.shown = null
      this.onHide()
    }, this.hideDelayMs)
  }

  /** 立即清空（切换文档、卸载面板）。 */
  clear(): void {
    this.clearTimers()
    if (this.shown !== null) {
      this.shown = null
      this.onHide()
    }
  }

  /** 当前显示的目标（没有为 `null`）。 */
  current(): string | null {
    return this.shown
  }

  /** 释放全部计时器（卸载时调用；不触发 onHide）。 */
  dispose(): void {
    this.clearTimers()
    this.shown = null
  }

  private cancelShow(): void {
    if (this.showTimer !== null) {
      this.clearTimer(this.showTimer)
      this.showTimer = null
    }
    this.candidate = null
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      this.clearTimer(this.hideTimer)
      this.hideTimer = null
    }
  }

  private clearTimers(): void {
    this.cancelShow()
    this.cancelHide()
  }
}
