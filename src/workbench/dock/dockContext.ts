/**
 * 停靠上下文（04-03 跨切片契约）。
 *
 * `DockSurface` 通过 `provide` 暴露拖拽入口；`TabStrip` / 抽屉标签只调用
 * `beginPanelDrag`，不自己计算手势，也不直接写布局。
 */
import type { InjectionKey } from 'vue'
import type { PanelRef } from '../api/ids.ts'

/** 面板拖动入口。 */
export interface DockContext {
  /** 是否有面板拖动进行中（pending 或 dragging）。 */
  dragging: boolean
  /** 指针按下时调用；只接受左键，内部处理 4px 阈值与指针捕获。 */
  beginPanelDrag(event: PointerEvent, ref: PanelRef, fromGroupId: string): void
  /** 该面板是否是当前拖动源（标题/标签用它显示 `data-dragging`）。 */
  isPanelDragging(ref: PanelRef): boolean
}

/** 停靠上下文注入键。 */
export const DOCK_CONTEXT_KEY: InjectionKey<DockContext> = Symbol('dock.context')

/**
 * 当前页面 ID 读取器。`ResizeHandle` 在 `LayoutRenderer` 内部渲染，
 * 拿不到 `DockSurface` 的 props，所以由 `DockSurface` provide 一个读取函数。
 */
export const DOCK_PAGE_KEY: InjectionKey<() => string> = Symbol('dock.page')

/** 分隔线拖动/键盘预览事件（冒泡；`LayoutRenderer` 可选监听）。 */
export const DOCK_RESIZE_PREVIEW_EVENT = 'dock-resize-preview'

/** 分隔线预览事件 detail。 */
export interface DockResizePreviewDetail {
  splitId: string
  sizes: number[]
}

/** 落点几何的 DOM 契约（04-03 与 04-05 共用，名字冻结）。 */
export const DOCK_KIND_ATTR = 'data-dock-kind'
export const DOCK_GROUP_ID_ATTR = 'data-dock-group-id'
export const DOCK_TAB_INDEX_ATTR = 'data-dock-tab-index'

/** 面板拖动 4px 阈值。 */
export const DOCK_DRAG_THRESHOLD_PX = 4
