/**
 * 停靠交互公共入口（04-03）。
 *
 * 只导出纯逻辑与上下文；`.vue` 组件由 `DockSurface` / `LayoutRenderer` 直接 import，
 * 避免 barrel 把 SFC 带进 node 自检。
 */
export * from './DropTarget.ts'
export * from './DockInputAdapter.ts'
export * from './DockLayoutController.ts'
export * from './resize.ts'
export * from './dockContext.ts'
