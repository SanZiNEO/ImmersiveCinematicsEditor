/**
 * `core.behavior` 激活入口（06-12）。
 *
 * 面板贡献由 manifest 声明，字段写入走 `PanelContext.commands` 与
 * `SCRIPT_MUTATION_SERVICE`；激活阶段不做文档或网络工作。
 */
export default function activate(): void {
  // 无需注册贡献；面板组件由 manifest 懒加载。
}
