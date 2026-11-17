/**
 * `core.script-graph` 插件入口（05-13）。
 *
 * 只注册贡献与命令，不做重活；面板组件首次可见才懒加载。
 */
import type { PluginContext } from '../../workbench/api/context.ts'
import { registerGraphCommands, registerGraphKeybindings } from './commands.ts'

/** 插件激活：10 条命令 + 6 条图快捷键。 */
export default function activate(ctx: PluginContext): void {
  registerGraphCommands(ctx)
  registerGraphKeybindings(ctx)
}

export { GRAPH_PANEL_ID, GRAPH_PLUGIN_ID } from './state.ts'
export { scriptGraph } from './manifest.ts'
