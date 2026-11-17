/**
 * 焦点顺序（04-10）。
 *
 * 顺序由布局树 + 区域 `order` 决定，不按 DOM 视觉顺序猜；不可用区域直接跳过。
 */
import type { FocusRegion } from '../api/commands.ts'

/** 过滤不可用区域并按 `order` 稳定排序（相同 order 保持注册顺序）。 */
export function buildFocusOrder(regions: Iterable<FocusRegion>): FocusRegion[] {
  const available: FocusRegion[] = []

  for (const region of regions) {
    let element: HTMLElement | null = null
    try {
      element = region.element()
    } catch {
      // 区域求值失败按不可用处理，避免一个坏面板打断 F6 循环。
      element = null
    }
    if (element !== null) available.push(region)
  }

  return available.sort((left, right) => left.order - right.order)
}
