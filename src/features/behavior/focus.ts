/**
 * 跨面板的"定位"通道（11-01：面板之间只有定位跳转，没有第二套编辑通路）。
 *
 * 三处会用到：
 * - 脚本图悬停卡「定位到触发器」→ 行为页（抽屉）选中该触发器；
 * - 效果面板 / 片段属性「在行为页打开」→ 抽屉事件页选中该记录；
 * - 脚本图 / 行为树「编辑触发器」→ 行为面板打开居中触发器编辑弹窗。
 *
 * 语义刻意做窄：
 * - 只传**记录身份**（`RecordRef`）与目标面板，不传字段值、不传文档副本，因此不会成为第二条写通路；
 * - 一次性消费（`takeFocus`），避免面板重渲染时反复抢焦点；
 * - 不写入 `state.selection`（11-01：面板自己的选择不写主选择）；只有面板自身"定位到片段"
 *   才调用既有选择命令。
 */

import type { RecordRef } from './shared.ts'

/** 接收定位的面板。 */
export type FocusSurface = 'behavior-drawer'

/** 一次定位请求。 */
export interface FocusRequest {
  /** 要选中的记录。 */
  target: RecordRef
  /** 由哪个面板接收。 */
  surface: FocusSurface
  /** 触发这次定位的面板（用于避免自己请求自己造成回环）。 */
  origin: string
}

type FocusListener = (request: FocusRequest) => void

let pending: FocusRequest | null = null
const listeners = new Set<FocusListener>()

/** 发一次定位请求。等价于"把焦点交给 surface 上的那条记录"。 */
export function requestFocus(request: FocusRequest): void {
  pending = request
  for (const listener of listeners) listener(request)
}

/**
 * 取走发往 `surface` 的待处理请求；没有或不是发往该面板则返回 `null`。
 * 面板在挂载时与每次收到 `focus` 通知时各调用一次。
 */
export function takeFocus(surface: FocusSurface): FocusRequest | null {
  if (pending === null || pending.surface !== surface) return null
  const request = pending
  pending = null
  return request
}

/** 只看不取（面板决定"是否显示跳转提示"时用）。 */
export function peekFocus(): FocusRequest | null {
  return pending
}

/** 丢弃待处理请求（文档切换、关闭抽屉时调用，避免把焦点带到别的脚本上）。 */
export function clearFocus(): void {
  pending = null
}

/** 订阅定位通知；返回退订函数，面板 `onUnmounted` 时调用。 */
export function onFocus(listener: FocusListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 仅供验收：当前订阅者数量（断言不泄漏监听器）。 */
export function focusListenerCount(): number {
  return listeners.size
}
