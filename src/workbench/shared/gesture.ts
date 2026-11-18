/**
 * 指针手势状态机（06-12 共享交互抽取）。
 *
 * 从 `core.timeline/TimelinePanel.vue` 抽出，行为等价：一次指针按下开启一个手势，
 * 指针移动期间只更新预览（不提交），指针抬起提交一次，Esc / pointercancel 取消不提交。
 * 调用方提供 `onUpdate` / `onCommit` / `onCancel` 三个副作用，手势数据由调用方定义。
 *
 * 本模块不碰文档、不碰 Vue 响应式：它只负责"何时开始、何时更新、何时结束"。
 */
import type { Disposable } from '../api/context.ts'

/** 手势生命周期回调。 */
export interface GestureCallbacks<T> {
  /** 指针移动：只更新预览，不得提交。 */
  onUpdate: (gesture: T, event: PointerEvent) => void
  /** 指针抬起：提交一次。 */
  onCommit: (gesture: T, event: PointerEvent) => void
  /** Esc / pointercancel：丢弃预览，不提交。 */
  onCancel: (gesture: T) => void
  /** 自动滚动时机（可选）：指针贴近内容区边缘时由调用方决定如何滚动。 */
  onAutoScroll?: (gesture: T, pointer: { x: number; y: number }) => void
}

/** 手势会话：同时只允许一个手势（与时间轴实现一致）。 */
export interface GestureSession<T> {
  /** 开始一个手势；已有手势进行中时返回 `false`。 */
  begin: (gesture: T) => boolean
  /** 当前手势（没有为 `null`）。 */
  current: () => T | null
  /** 主动取消（不提交）。 */
  cancel: () => void
  /** 是否有手势进行中。 */
  active: () => boolean
  /** 释放监听器。 */
  dispose: () => void
}

/**
 * 创建一个手势会话。
 *
 * 监听挂在 `window` 上（不是元素上）：指针移出内容区后仍要跟随，
 * 这与时间轴拖动片段越界时仍要更新的行为一致。
 */
export function createGestureSession<T>(
  callbacks: GestureCallbacks<T>,
  pointerIdOf: (gesture: T) => number,
): GestureSession<T> {
  let active: T | null = null
  let frame = 0
  const pointer = { x: 0, y: 0 }

  const stopAutoScroll = (): void => {
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }

  const tick = (): void => {
    frame = 0
    if (active === null) {
      return
    }
    callbacks.onAutoScroll?.(active, pointer)
    frame = requestAnimationFrame(tick)
  }

  const startAutoScroll = (): void => {
    if (frame !== 0 || callbacks.onAutoScroll === undefined) {
      return
    }
    frame = requestAnimationFrame(tick)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== pointerIdOf(active)) {
      return
    }
    pointer.x = event.clientX
    pointer.y = event.clientY
    callbacks.onUpdate(active, event)
  }

  const finish = (event: PointerEvent, commit: boolean): void => {
    if (active === null || event.pointerId !== pointerIdOf(active)) {
      return
    }
    const gesture = active
    active = null
    stopAutoScroll()
    detach()
    if (commit) {
      callbacks.onCommit(gesture, event)
    } else {
      callbacks.onCancel(gesture)
    }
  }

  const onPointerUp = (event: PointerEvent): void => {
    finish(event, true)
  }

  const onPointerCancel = (event: PointerEvent): void => {
    finish(event, false)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || active === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const gesture = active
    active = null
    stopAutoScroll()
    detach()
    callbacks.onCancel(gesture)
  }

  const attach = (): void => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
  }

  const detach = (): void => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
  }

  const session: GestureSession<T> & Disposable = {
    begin(gesture) {
      if (active !== null) {
        return false
      }
      active = gesture
      attach()
      startAutoScroll()
      return true
    },
    current: () => active,
    cancel() {
      if (active === null) {
        return
      }
      const gesture = active
      active = null
      stopAutoScroll()
      detach()
      callbacks.onCancel(gesture)
    },
    active: () => active !== null,
    dispose() {
      active = null
      stopAutoScroll()
      detach()
    },
  }
  return session
}
