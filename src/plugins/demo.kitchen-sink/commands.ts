/**
 * demo 命令定义与注册（04-01 / 04-10）。
 *
 * 命令必须在 `activate` 期间通过 `ctx.commands.register` 进入命令注册表；
 * `manifest.contributes.commands` 是声明（菜单/校验来源），内核不会替插件执行注册。
 * 这也保证菜单、快捷键、命令面板共用同一份 `CommandRegistry`。
 */
import type { CommandContribution } from '../../workbench/api/contributions.ts'
import type { PluginContext } from '../../workbench/api/context.ts'
import { STATUS_SERVICE, THEME_CONTROLLER } from '../../workbench/api/tokens.ts'
import { DEMO_PLUGIN_ID, bumpPing, nextDemoThemeId, pingCount } from './state.ts'

/** 三个 demo 命令（顺序即注册顺序）。 */
export const DEMO_COMMANDS: CommandContribution[] = [
  {
    commandId: 'demo.command.ping',
    titleKey: 'Demo · Ping',
    category: 'Demo',
    run: (ctx) => {
      bumpPing()
      ctx.services.get(STATUS_SERVICE)?.notify(`demo ping: ${pingCount.value}`)
    },
    enabled: () => true,
    menu: { menu: 'view', group: 'demo', order: 10 },
    keybinding: 'Mod+Alt+P',
  },
  {
    commandId: 'demo.command.toggleTheme',
    titleKey: 'Demo · 切换主题（棕褐/午夜）',
    category: 'Demo',
    run: (ctx) => {
      ctx.services.require(THEME_CONTROLLER).setTheme(nextDemoThemeId())
    },
    enabled: () => true,
    menu: { menu: 'view', group: 'demo', order: 20 },
  },
  {
    commandId: 'demo.command.fail',
    titleKey: 'Demo · 故意失败',
    category: 'Demo',
    run: () => {
      throw new Error('demo.command.fail：故意抛错（验证命令失败诊断）')
    },
    enabled: () => true,
  },
]

/** 把 demo 命令注册进插件上下文（暂存，activate 成功后一次性提交）。 */
export function registerDemoCommands(ctx: PluginContext): void {
  for (const command of DEMO_COMMANDS) {
    ctx.commands.register(DEMO_PLUGIN_ID, command)
  }
}
