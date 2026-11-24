/**
 * 命令注册表实现（04-10）。
 *
 * 菜单、快捷键与命令面板都从这里取命令；`enabled` / `checked` 求值失败按 disabled 处理，
 * 并写诊断，不把异常抛给调用方。
 */
import type {
  CommandContext,
  CommandDefinition,
  CommandRegistryPort,
  MenuState,
  RegisteredCommand,
} from '../api/commands.ts'
import type { CommandContribution } from '../api/contributions.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import { COMMAND_ID_PATTERN } from '../api/ids.ts'

export interface CommandRegistryOptions {
  diagnostics: DiagnosticSink
}

const MENU_ORDER: Readonly<Record<NonNullable<MenuState['menu']>, number>> = {
  file: 0,
  edit: 1,
  view: 2,
  help: 3,
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class CommandRegistryImpl implements CommandRegistryPort {
  private readonly diagnostics: DiagnosticSink
  private readonly records = new Map<string, RegisteredCommand>()
  private readonly listeners = new Set<() => void>()

  constructor(options: CommandRegistryOptions) {
    this.diagnostics = options.diagnostics
  }

  register(pluginId: string, contribution: CommandContribution): void {
    if (typeof pluginId !== 'string' || pluginId.length === 0) {
      throw new Error('命令注册缺少 pluginId')
    }
    if (
      typeof contribution.commandId !== 'string' ||
      !COMMAND_ID_PATTERN.test(contribution.commandId)
    ) {
      throw new Error(
        `命令 ID 不合法："${String(contribution.commandId)}"（插件 "${pluginId}"）`,
      )
    }
    if (typeof contribution.run !== 'function') {
      throw new Error(`命令 "${contribution.commandId}" 缺少 run handler（插件 "${pluginId}"）`)
    }

    const existing = this.records.get(contribution.commandId)
    if (existing !== undefined) {
      throw new Error(
        `命令 ID 冲突："${contribution.commandId}" 已由插件 "${existing.pluginId}" 注册，` +
          `插件 "${pluginId}" 不能重复注册`,
      )
    }

    // 保留贡献对象原样：插件可能用方法简写，`this` 应指向它自己的对象。
    const definition = contribution as CommandDefinition
    this.records.set(contribution.commandId, { pluginId, definition })
    this.emit()
  }

  get(commandId: string): RegisteredCommand | undefined {
    return this.records.get(commandId)
  }

  list(): RegisteredCommand[] {
    return [...this.records.values()]
  }

  async execute(ctx: CommandContext, commandId: string): Promise<boolean> {
    const record = this.records.get(commandId)
    if (record === undefined) {
      this.diagnostics.report({
        severity: 'error',
        source: 'command',
        message: `执行命令失败：未注册的命令 "${commandId}"`,
      })
      return false
    }

    const definition = record.definition
    if (definition.enabled !== undefined) {
      let enabled: boolean
      try {
        enabled = definition.enabled(ctx) !== false
      } catch (error) {
        this.diagnostics.report({
          severity: 'error',
          source: 'command',
          pluginId: record.pluginId,
          message: `命令 enabled 求值失败："${commandId}"`,
          detail: errorMessage(error),
        })
        return false
      }
      if (!enabled) {
        this.diagnostics.report({
          severity: 'warning',
          source: 'command',
          pluginId: record.pluginId,
          message: `命令被禁用，未执行："${commandId}"`,
        })
        return false
      }
    }

    try {
      await definition.run(ctx)
      return true
    } catch (error) {
      this.diagnostics.report({
        severity: 'error',
        source: 'command',
        pluginId: record.pluginId,
        message: `命令执行失败："${commandId}"`,
        detail: errorMessage(error),
      })
      return false
    }
  }

  isEnabled(ctx: CommandContext, commandId: string): boolean {
    const record = this.records.get(commandId)
    if (record === undefined) return false
    const enabled = record.definition.enabled
    if (enabled === undefined) return true
    try {
      return enabled(ctx) !== false
    } catch (error) {
      this.diagnostics.report({
        severity: 'error',
        source: 'command',
        pluginId: record.pluginId,
        message: `命令 enabled 求值失败，按 disabled 处理："${commandId}"`,
        detail: errorMessage(error),
      })
      return false
    }
  }

  isChecked(ctx: CommandContext, commandId: string): boolean {
    const record = this.records.get(commandId)
    if (record === undefined) return false
    const checked = record.definition.checked
    if (checked === undefined) return false
    try {
      return checked(ctx) === true
    } catch (error) {
      this.diagnostics.report({
        severity: 'error',
        source: 'command',
        pluginId: record.pluginId,
        message: `命令 checked 求值失败，按未勾选处理："${commandId}"`,
        detail: errorMessage(error),
      })
      return false
    }
  }

  menuItems(ctx: CommandContext): MenuState[] {
    const entries: Array<{ record: RegisteredCommand; index: number }> = []
    let index = 0
    for (const record of this.records.values()) {
      if (record.definition.menu !== undefined || record.definition.commandPaletteOnly === true) {
        entries.push({ record, index })
      }
      index += 1
    }

    entries.sort((left, right) => {
      const leftMenu = left.record.definition.menu
      const rightMenu = right.record.definition.menu
      if (leftMenu === undefined || rightMenu === undefined) return left.index - right.index
      const menuDelta = MENU_ORDER[leftMenu.menu] - MENU_ORDER[rightMenu.menu]
      if (menuDelta !== 0) return menuDelta
      const orderDelta = leftMenu.order - rightMenu.order
      if (orderDelta !== 0) return orderDelta
      return left.index - right.index
    })

    return entries.map(({ record }) => {
      const definition = record.definition
      const menu = definition.menu
      const state: MenuState = {
        commandId: definition.commandId,
        // i18n 由调用方（MenuSync / 菜单渲染）后期替换。
        label: definition.titleKey,
        category: definition.category,
        enabled: this.isEnabled(ctx, definition.commandId),
        checked: this.isChecked(ctx, definition.commandId),
      }
      if (menu !== undefined) {
        state.menu = menu.menu
        if (menu.group !== undefined) state.group = menu.group
        state.order = menu.order
      }
      return state
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  disposePlugin(pluginId: string): void {
    let removed = false
    for (const [commandId, record] of this.records) {
      if (record.pluginId !== pluginId) continue
      this.records.delete(commandId)
      removed = true
    }
    if (removed) this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 单个订阅者失败不应阻断其他订阅者；命令注册已完成。
      }
    }
  }
}
