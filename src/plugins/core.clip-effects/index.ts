/**
 * `core.clip-effects` 激活入口（05-13）。
 *
 * 本插件没有独立命令或状态项：面板贡献由 manifest 声明，写操作只走
 * `PanelContext.commands` 的文档命令。激活阶段不做文档 / 网络工作。
 */
export default function activate(): void {
  // 没有需要注册的命令；保留显式空实现，避免内核误以为缺少 activate。
}
