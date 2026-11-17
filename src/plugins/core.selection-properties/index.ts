/**
 * `core.selection-properties` 激活入口（05-13）。
 *
 * 面板内的按钮直接走 `PanelContext.commands` / `SCRIPT_MUTATION_SERVICE`；
 * 本插件不注册独立命令，也没有状态项。激活阶段不做文档或网络工作。
 */
export default function activate(): void {
  // 无需注册贡献；面板组件由 manifest 懒加载。
}
