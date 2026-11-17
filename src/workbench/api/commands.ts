/**
 * 命令、快捷键与焦点端口（04-10）。
 *
 * 命令是菜单、快捷键、命令面板的唯一入口；不允许第二套 handler 或第二张快捷键表。
 */
import type { CommandContribution, MenuPlacement } from './contributions.ts'
import type { ServiceRegistry } from './services.ts'

/** 快捷键作用域；优先级 `dialog > panel > page > global`。 */
export type KeyScope = 'global' | 'page' | 'panel' | 'dialog'

/** 作用域优先级（数值越大越优先）。 */
export const KEY_SCOPE_PRIORITY: Record<KeyScope, number> = {
  dialog: 4,
  panel: 3,
  page: 2,
  global: 1,
}

/** 命令执行上下文。 */
export interface CommandContext {
  readonly pageId: string
  readonly services: ServiceRegistry
}

/** 命令定义（内核注册表内部形态；插件通过 `CommandContribution` 贡献）。 */
export interface CommandDefinition extends CommandContribution {
  /** 默认 chord 的作用域；缺省 `global`。 */
  keybindingScope?: KeyScope
}

/** 已注册命令。 */
export interface RegisteredCommand {
  pluginId: string
  definition: CommandDefinition
}

/** 命令注册表。 */
export interface CommandRegistryPort {
  register(pluginId: string, contribution: CommandContribution): void
  get(commandId: string): RegisteredCommand | undefined
  list(): RegisteredCommand[]
  /** 执行命令；disabled / 抛错返回 `false` 并记诊断。 */
  execute(ctx: CommandContext, commandId: string): Promise<boolean>
  isEnabled(ctx: CommandContext, commandId: string): boolean
  isChecked(ctx: CommandContext, commandId: string): boolean
  /** 菜单同步快照（主进程只更新 UI，不执行命令）。 */
  menuItems(ctx: CommandContext): MenuState[]
  subscribe(listener: () => void): () => void
  disposePlugin(pluginId: string): void
}

/** 菜单项状态（`menu.sync` 载荷）。 */
export interface MenuState {
  commandId: string
  label: string
  /** 命令分类（命令面板分组用；菜单渲染忽略）。 */
  category: string
  enabled: boolean
  checked: boolean
  accelerator?: string
  menu?: MenuPlacement['menu']
  group?: string
  order?: number
}

/** 快捷键规则。 */
export interface KeybindingRule {
  chord: string
  commandId: string
  scope: KeyScope
  priority?: number
  when?: (ctx: KeyContext) => boolean
}

/** 求值上下文（守卫与 `when` 用）。 */
export interface KeyContext {
  pageId: string
  /** 当前焦点区域 ID；无焦点为 `null`。 */
  region: string | null
  /** 焦点在输入框 / 文本域 / contenteditable。 */
  editable: boolean
  /** IME 组合中。 */
  composing: boolean
  /** 有弹窗 / 命令面板打开。 */
  dialogOpen: boolean
}

/** 键盘事件的最小抽象（WebUI 用 `KeyboardEvent` 适配）。 */
export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  isComposing?: boolean
  keyCode?: number
}

/** 快捷键注册表。 */
export interface KeybindingRegistryPort {
  /** 注册一条规则；同 scope 同 chord 同 when 冲突 → 抛错并指出两处 commandId。 */
  register(rule: KeybindingRule): void
  /** 由命令贡献的 `keybinding` 字段批量注册默认规则。 */
  registerFromCommands(commands: readonly CommandDefinition[]): void
  rules(): readonly KeybindingRule[]
  /** 用户覆盖：`null` 清空绑定。冲突 → 抛错，不保存。 */
  setOverride(commandId: string, chord: string | null): void
  clearOverrides(): void
  overrides(): ReadonlyArray<{ commandId: string; chord: string }>
  /** 取命令当前生效 chord（覆盖优先）。 */
  chordOf(commandId: string): string | null
  /** 按焦点解析；返回命中的规则（不执行命令）。 */
  resolve(event: KeyEventLike, ctx: KeyContext): KeybindingRule | undefined
}

/** 焦点区域。 */
export interface FocusRegion {
  id: string
  order: number
  /** 区域容器；不可用时返回 `null`（折叠 / 隐藏 / 抽屉关闭）。 */
  element: () => HTMLElement | null
}

/** 焦点服务。 */
export interface FocusServicePort {
  registerRegion(region: FocusRegion): () => void
  focusRegion(regionId: string): void
  focusNext(): void
  focusPrev(): void
  currentRegion(): string | null
  remember(regionId: string): void
  restore(regionId: string): void
  subscribe(listener: (regionId: string | null) => void): () => void
}

/** 弹窗栈（命令面板 / 确认框 / 主题选择器）。 */
export interface DialogStackPort {
  isOpen(): boolean
  open(id: string): void
  close(id: string): void
  subscribe(listener: (open: boolean) => void): () => void
}
