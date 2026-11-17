/**
 * `core.timeline` 激活入口（05-13）。
 *
 * 只做三件事：建插件级控制器、注册命令、把释放挂到插件上下文。
 * 面板 / 命令读同一份文档服务与会话，不各建一套状态。
 */
import type { PluginContext } from '../../workbench/api/context.ts'
import { registerTimelineCommands } from './commands.ts'

/** 插件激活。 */
export default function activate(ctx: PluginContext): void {
  registerTimelineCommands(ctx)
}
