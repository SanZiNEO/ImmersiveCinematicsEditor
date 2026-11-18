/**
 * `core.transition-panel` 激活（08-03）。
 *
 * 面板所需能力全部来自工作台既有 token（文档服务 / 文档命令面 / 选区服务），
 * 插件启动阶段不注册服务、不新增宿主类型。
 */
import type { PluginContext } from '../../workbench/api/context.ts'

export default function activate(_ctx: PluginContext): void {
  // 面板懒加载，激活期无副作用。
}
