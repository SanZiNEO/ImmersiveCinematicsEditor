/**
 * 面板宿主公共入口（04-05）。
 *
 * 只 re-export `.ts`；`.vue` 组件由调用方按路径 import，避免 node 自检加载 SFC。
 */
export * from './selectionState.ts'
export * from './panelContext.ts'
export * from './panelRuntime.ts'
export * from './layoutGeometry.ts'
export * from './tabStripContext.ts'
export * from './layoutPreview.ts'
export * from './usePanelHostSetup.ts'
