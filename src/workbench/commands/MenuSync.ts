/**
 * 菜单同步快照（04-10）。
 *
 * 主进程只消费快照更新 UI，不执行命令；菜单 accelerator 与快捷键表同源，
 * 用户覆盖后调用方重新构建快照即可同步。
 */
import type {
  CommandContext,
  CommandRegistryPort,
  KeybindingRegistryPort,
  MenuState,
} from '../api/commands.ts'

/** i18n 入口：函数或带 `t` 的对象。 */
export type MenuI18n =
  | ((key: string) => string)
  | { t(key: string): string }
  | null
  | undefined

/** 菜单快照需要的两个注册表。 */
export interface MenuSnapshotSource {
  readonly commands: CommandRegistryPort
  readonly keybindings: KeybindingRegistryPort
}

/** 兼容调用方直接传命令注册表（可选带 `keybindings` 字段）。 */
export type MenuSnapshotRegistry =
  | MenuSnapshotSource
  | (CommandRegistryPort & { readonly keybindings?: KeybindingRegistryPort })

const MENU_ORDER: Readonly<Record<NonNullable<MenuState['menu']>, number>> = {
  file: 0,
  edit: 1,
  view: 2,
  help: 3,
}

function translate(i18n: MenuI18n, key: string): string {
  if (i18n === null || i18n === undefined) return key
  try {
    const translated = typeof i18n === 'function' ? i18n(key) : i18n.t(key)
    return typeof translated === 'string' && translated.length > 0 ? translated : key
  } catch {
    // 翻译失败不能阻断菜单同步；回退到 key。
    return key
  }
}

function splitRegistry(registry: MenuSnapshotRegistry): {
  commands: CommandRegistryPort
  keybindings?: KeybindingRegistryPort
} {
  const composite = registry as Partial<MenuSnapshotSource> & {
    keybindings?: KeybindingRegistryPort
  }
  if (composite.commands !== undefined && typeof composite.commands.menuItems === 'function') {
    return { commands: composite.commands, keybindings: composite.keybindings }
  }
  return {
    commands: registry as CommandRegistryPort,
    keybindings: composite.keybindings,
  }
}

/** 把 menu 命令转成 `MenuState[]`；label 做 i18n，accelerator 取当前生效 chord。 */
export function buildMenuSnapshot(
  registry: MenuSnapshotRegistry,
  ctx: CommandContext,
  i18n?: MenuI18n,
  keybindingsOverride?: KeybindingRegistryPort,
): MenuState[] {
  const split = splitRegistry(registry)
  const commands = split.commands
  const keybindings = keybindingsOverride ?? split.keybindings

  const items = commands.menuItems(ctx).filter((item) => item.menu !== undefined).map((item) => {
    const accelerator =
      keybindings === undefined ? item.accelerator : keybindings.chordOf(item.commandId) ?? undefined
    return {
      ...item,
      label: translate(i18n, item.label),
      ...(accelerator === undefined ? {} : { accelerator }),
    }
  })

  items.sort((left, right) => {
    const leftMenu = left.menu
    const rightMenu = right.menu
    if (leftMenu === undefined || rightMenu === undefined) return 0
    const menuDelta = MENU_ORDER[leftMenu] - MENU_ORDER[rightMenu]
    if (menuDelta !== 0) return menuDelta
    return (left.order ?? 0) - (right.order ?? 0)
  })

  return items
}
