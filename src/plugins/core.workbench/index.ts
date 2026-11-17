/**
 * `core.workbench` 插件入口（04-01 目录结构）。
 *
 * manifest 已声明七类贡献；`activate` 在这里注册 shell 命令。
 */
export { default as manifest, coreWorkbench, CORE_WORKBENCH_ID } from './manifest.ts'
export { registerCoreCommands, bindShellCommandDeps } from './commands.ts'
export type { ShellCommandDeps } from './commands.ts'
export { CORE_STATUS_ITEMS } from './statusItems.ts'
