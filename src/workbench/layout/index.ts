/**
 * 布局模块公共入口（04-02）。
 *
 * 外壳 / 面板宿主 / 停靠控制器只从这里取布局能力；写入统一走 `LayoutService`。
 */
export * from './tree.ts'
export * from './defaultLayouts.ts'
export * from './validate.ts'
export * from './LayoutService.ts'
export * from './persist.ts'
