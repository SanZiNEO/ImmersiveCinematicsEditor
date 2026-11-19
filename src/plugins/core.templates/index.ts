/**
 * `core.templates` 激活入口（12-06 / 12-07）。
 *
 * 面板贡献由 manifest 声明；写操作只走 `PanelContext.commands` 的文档命令。
 * 激活阶段不做文档或网络工作，也不注册额外命令 / 状态项 / 服务实例
 * （姿态槽服务由 `core.flight` 注册，本插件只通过 token 消费）。
 */
export default function activate(): void {
  // 没有需要注册的命令或状态项；保留显式空实现，避免内核误以为缺少 activate。
}
