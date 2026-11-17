/**
 * 焦点区域注册（04-10）。
 *
 * `FocusService` 只维护区域表；这里把外壳的固定区域登记进去，
 * 让 `F6 / Shift+F6` 真正有东西可切。面板自己的区域由 `PanelHost` 注册。
 *
 * 顺序固定：顶栏 → 页面 → 文档顶栏 → 面板（含抽屉标签）→ 状态区。
 */
import type { FocusServicePort } from '../api/commands.ts'

/** 一个固定区域：id 必须与 DOM 上的 `data-focus-scope` 一致。 */
export interface ShellFocusRegionSpec {
  id: string
  order: number
}

/** 外壳固定区域（面板之外的骨架）。 */
export const SHELL_FOCUS_REGIONS: readonly ShellFocusRegionSpec[] = [
  { id: 'topbar', order: 10 },
  { id: 'page', order: 20 },
  { id: 'document-header', order: 30 },
  { id: 'statusbar', order: 90 },
] as const

/** 在文档里按 `data-focus-scope` 找元素；找不到返回 null（区域不可用）。 */
function regionElement(regionId: string): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  return document.querySelector<HTMLElement>(`[data-focus-scope="${CSS.escape(regionId)}"]`)
}

/**
 * 注册外壳区域；返回统一释放函数。
 *
 * 区域不存在的页面（例如脚本页没有 `document-header`）在 `element()` 返回 null 时
 * 被 `FocusService` 自动跳过，不需要按页注册/注销。
 */
export function registerShellFocusRegions(focus: FocusServicePort): () => void {
  const disposers = SHELL_FOCUS_REGIONS.map((spec) =>
    focus.registerRegion({
      id: spec.id,
      order: spec.order,
      element: () => regionElement(spec.id),
    }),
  )
  return () => {
    for (const dispose of disposers) {
      dispose()
    }
  }
}

/** 把焦点真正落到元素上：div 默认不可聚焦，补 `tabindex=-1`。 */
export function focusElement(element: HTMLElement | null): void {
  if (element === null) {
    return
  }
  if (element.tabIndex < 0) {
    element.setAttribute('tabindex', '-1')
  }
  element.focus()
}
