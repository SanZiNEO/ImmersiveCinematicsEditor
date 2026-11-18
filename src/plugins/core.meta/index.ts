/**
 * `core.meta` 激活入口。
 *
 * 面板贡献由 manifest 声明，字段写入走 `PanelContext.commands` 的 `meta.set`。
 */
export default function activate(): void {
  // 无需注册贡献；面板组件由 manifest 懒加载。
}
