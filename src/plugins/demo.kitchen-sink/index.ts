/**
 * `demo.kitchen-sink` 激活入口（04-11）。
 *
 * 只做注册与轻量初始化：把两个纯数据主题注册进主题注册表、把三个命令注册进命令表、
 * 接上插件状态订阅。面板/页面/抽屉/状态项/设置分区由 `manifest.contributes` 声明，
 * 内核在 `activate` 成功后一次性提交。
 *
 * 命令必须在这里注册：`contributes.commands` 只是声明，内核不替插件调用
 * `ctx.commands.register`（菜单、快捷键、命令面板都读同一份命令表）。
 */
import type { PluginContext } from '../../workbench/api/context.ts'
import { registerDemoCommands } from './commands.ts'
import { DEMO_PLUGIN_ID, bindDemoState } from './state.ts'
import { THEME_FILES } from './themes/index.ts'

/** 插件激活。 */
export default function activate(ctx: PluginContext): void {
  for (const file of THEME_FILES) {
    ctx.themes.registerContribution(DEMO_PLUGIN_ID, file.definition)
  }
  registerDemoCommands(ctx)
  ctx.disposables.add(bindDemoState(ctx))
}
