/**
 * core.workbench 的 shell 命令（04-10）。
 *
 * 命令是菜单 / 快捷键 / 命令面板的唯一入口；这里只做「取服务 → 转调」，
 * 不重复实现 03 的保存/校验语义，也不写第二套 handler。
 */
import type { CommandContext, RegisteredCommand } from '../../workbench/api/commands.ts'

import type { PluginContext } from '../../workbench/api/context.ts'
import type { DocumentService } from '../../workbench/api/documents.ts'
import type { PageRouter } from '../../workbench/api/registries.ts'
import type { WorkspaceLayoutService } from '../../workbench/api/layout.ts'
import type { FocusServicePort } from '../../workbench/api/commands.ts'
import type { ThemeControllerPort } from '../../workbench/api/theme.ts'
import {
  WINDOW_PORT,
  DOCUMENT_SERVICE,
  DOCUMENT_COMMANDS,
  FOCUS_SERVICE,
  LAYOUT_SERVICE,
  PREFERENCES_SERVICE,
  THEME_CONTROLLER,
  CATALOG_SERVICE,
} from '../../workbench/api/tokens.ts'
import type { BakeSavePort, PendingBakeSegment } from '../../features/effects/bakeGuard.ts'
import {
  bakePendingSegments,
  collectPendingSegments,
  discardPendingSegments,
  summarizePendingBake,
} from '../../features/effects/bakeGuard.ts'

/** 需要打开文件对话框的入口（宿主注入）。 */
export interface ShellCommandDeps {
  /** 「保存失败」等提示出口（状态区）。 */
  notify(message: string, severity?: 'info' | 'warning' | 'error'): void
  /** 未保存守卫（关闭 / 返回项目 / 退出共用）。 */
  guard(): Promise<'proceed' | 'cancel' | 'failed'>
  /** 关闭文档（守卫通过后调用）。 */
  closeDocument(): void
  /** 打开/新建的宿主入口（含最近项目记录）。 */
  openScriptFile(): Promise<void>
  newDocument(): Promise<void>
  revertDocument(): Promise<void>
  /** 打开命令面板。 */
  openPalette(): void
  /** 打开设置页指定分区。 */
  openSettings(sectionId?: string): void
  /** 打开主题选择器（设置页外观分区）。 */
  openThemePicker(): void
  /** 打开「显示面板」对话框。 */
  openShowPanel(): void
  /** 打开快捷键帮助。 */
  openShortcutsHelp(): void
  /** 打开关于。 */
  openAbout(): void
  /** 返回项目页（未保存守卫由外壳处理）。 */
  backToProject(): Promise<void>
  /** 打开当前文档 id 改名对话框。 */
  openDocumentRename(): void
  /**
   * 保存前的未烘焙缓动三选一（06-06 §4.2）。
   *
   * 返回按钮下标：0 烘焙后保存 / 1 仅保存节点 / 2 取消（`-1` = 关闭对话框，同样视为取消）。
   * 只在确实存在未烘焙段时调用，因此"无未烘焙段不弹窗"由调用方保证。
   */
  confirmPendingBake(lines: readonly string[]): Promise<number>
}

let deps: ShellCommandDeps | null = null

/** 注入外壳入口（应用启动时调用一次）。 */
export function bindShellCommandDeps(next: ShellCommandDeps): void {
  deps = next
}

function requireDeps(): ShellCommandDeps {
  if (deps === null) {
    throw new Error('shell 命令入口尚未绑定')
  }
  return deps
}

/** 取文档服务。 */
function documentsOf(ctx: CommandContext): DocumentService {
  return ctx.services.require(DOCUMENT_SERVICE)
}

/**
 * 保存前的未烘焙缓动检查（06-06 §4.2）：三选一，不静默丢弃。
 *
 * - 无未烘焙段：调用方不进入这里（因此不会弹窗）；
 * - 0 烘焙后保存：先提交 `object.bakeEasing` 并清会话缓动，失败则中止保存；
 * - 1 仅保存节点：只清会话缓动（一次撤销项），节点按当前插值保存；
 * - 2 取消 / 关闭对话框：真的中止（不落盘、不清 dirty）。
 */
async function resolvePendingBake(
  commandCtx: CommandContext,
  pending: readonly PendingBakeSegment[],
): Promise<boolean> {
  const summary = pendingBakeSummaryLines(pending)
  const choice = await requireDeps().confirmPendingBake(summary)
  if (choice === 2 || choice < 0) {
    requireDeps().notify('已取消保存：会话缓动仍未烘焙', 'info')
    return false
  }
  const commands = commandCtx.services.require(DOCUMENT_COMMANDS)
  const documents = documentsOf(commandCtx)
  const catalog = commandCtx.services.require(CATALOG_SERVICE)
  const port: BakeSavePort = {
    clips: () => documents.clips(),
    clipObjects: (clipKey) => documents.clipObjects(clipKey),
    commit: (command) => commands.commit(command),
    commitClipAuthoring: (clipKey, mutate) => commands.commitClipAuthoring(clipKey, mutate),
    catalog,
  }
  if (choice === 1) {
    const discarded = discardPendingSegments(port, pending)
    if (!discarded.ok) {
      requireDeps().notify(discarded.message ?? '清理会话缓动失败，已中止保存', 'error')
      return false
    }
    requireDeps().notify(discarded.message ?? '已丢弃会话缓动', 'info')
    return true
  }
  const baked = bakePendingSegments(port, pending)
  if (!baked.ok) {
    requireDeps().notify(baked.message ?? '烘焙失败，已中止保存', 'error')
    return false
  }
  requireDeps().notify(`已烘焙 ${baked.baked ?? 0} 段缓动`, 'info')
  return true
}

/** 提示文案：列出受影响的路径与段数（不阻断其他片段的保存）。 */
function pendingBakeSummaryLines(pending: readonly PendingBakeSegment[]): string[] {
  return summarizePendingBake(pending).map((entry) => `${entry.clipKey} · ${entry.path} · ${entry.count} 段`)
}

/** 注册全部 shell 命令（核心命令 + 文档代理）。 */
export function registerCoreCommands(ctx: PluginContext): void {
  const register = (commandId: string, definition: Omit<RegisteredCommand['definition'], 'commandId'>): void => {
    ctx.commands.register(ctx.pluginId, { commandId, ...definition })
  }

  register('file.newDoc', {
    titleKey: 'cmd.file.newDoc',
    category: '文件',
    keybinding: 'Mod+N',
    keybindingScope: 'global',
    menu: { menu: 'file', group: '1_new', order: 10 },
    run: async () => {
      await requireDeps().newDocument()
    },
  })

  register('file.openDoc', {
    titleKey: 'cmd.file.openDoc',
    category: '文件',
    keybinding: 'Mod+O',
    keybindingScope: 'global',
    menu: { menu: 'file', group: '1_new', order: 20 },
    run: async () => {
      await requireDeps().openScriptFile()
    },
  })

  register('file.saveDoc', {
    titleKey: 'doc.save',
    category: '文件',
    keybinding: 'Mod+S',
    keybindingScope: 'global',
    menu: { menu: 'file', group: '2_save', order: 10 },
    enabled: (commandCtx) => documentsOf(commandCtx).summary().docId !== null,
    run: async (commandCtx) => {
      const documents = documentsOf(commandCtx)
      const pending = collectPendingSegments({
        clips: documents.clips(),
        clipAuthoringOf: (clipKey) => commandCtx.services.require(DOCUMENT_COMMANDS).clipAuthoringOf(clipKey),
      })
      if (pending.length > 0) {
        const allowed = await resolvePendingBake(commandCtx, pending)
        if (!allowed) {
          return
        }
      }
      const result = await documents.save()
      if (!result.ok) {
        requireDeps().notify(result.message ?? `保存失败（${result.reason ?? 'unknown'}）`, 'error')
      }
    },
  })

  register('file.validateDoc', {
    titleKey: 'doc.validate',
    category: '文件',
    keybinding: 'Mod+Shift+V',
    keybindingScope: 'global',
    menu: { menu: 'file', group: '3_validate', order: 10 },
    enabled: (commandCtx) => documentsOf(commandCtx).summary().docId !== null,
    run: async (commandCtx) => {
      const result = await documentsOf(commandCtx).validate()
      requireDeps().notify(
        result.ok ? `校验通过（${result.issues.length} 条提示）` : `校验发现 ${result.issues.length} 条问题`,
        result.ok ? 'info' : 'warning',
      )
    },
  })

  register('file.renameDocId', {
    titleKey: 'cmd.file.renameDocId',
    category: '文件',
    menu: { menu: 'file', group: '3_validate', order: 20 },
    enabled: (commandCtx) => documentsOf(commandCtx).summary().docId !== null,
    run: () => {
      requireDeps().openDocumentRename()
    },
  })

  register('file.revertDoc', {
    titleKey: 'cmd.file.revertDoc',
    category: '文件',
    menu: { menu: 'file', group: '4_revert', order: 10 },
    enabled: (commandCtx) => documentsOf(commandCtx).summary().path !== null,
    run: async () => {
      await requireDeps().revertDocument()
    },
  })

  register('file.closeDoc', {
    titleKey: 'cmd.file.closeDoc',
    category: '文件',
    keybinding: 'Mod+W',
    keybindingScope: 'global',
    menu: { menu: 'file', group: '5_close', order: 10 },
    enabled: (commandCtx) => documentsOf(commandCtx).summary().docId !== null,
    run: async () => {
      const result = await requireDeps().guard()
      if (result === 'proceed') {
        requireDeps().closeDocument()
      }
    },
  })

  register('file.backToProject', {
    titleKey: 'doc.back',
    category: '文件',
    menu: { menu: 'file', group: '5_close', order: 20 },
    enabled: (commandCtx) => commandCtx.pageId === 'document',
    run: async () => {
      await requireDeps().backToProject()
    },
  })

  register('edit.undo', {
    titleKey: 'doc.undo',
    category: '编辑',
    keybinding: 'Mod+Z',
    keybindingScope: 'global',
    menu: { menu: 'edit', group: '1_undo', order: 10 },
    enabled: (commandCtx) => commandCtx.services.require(DOCUMENT_SERVICE).summary().docId !== null,
    run: (commandCtx) => {
      commandCtx.services.require(DOCUMENT_COMMANDS).undo()
    },
  })

  register('edit.redo', {
    titleKey: 'doc.redo',
    category: '编辑',
    keybinding: 'Mod+Shift+Z',
    keybindingScope: 'global',
    menu: { menu: 'edit', group: '1_undo', order: 20 },
    enabled: (commandCtx) => commandCtx.services.require(DOCUMENT_SERVICE).summary().docId !== null,
    run: (commandCtx) => {
      commandCtx.services.require(DOCUMENT_COMMANDS).redo()
    },
  })

  register('app.settings', {
    titleKey: 'nav.settings',
    category: '视图',
    keybinding: 'Mod+,',
    keybindingScope: 'global',
    menu: { menu: 'view', group: '1_pages', order: 10 },
    run: () => {
      requireDeps().openSettings()
    },
  })

  register('app.commandPalette', {
    titleKey: 'cmd.app.commandPalette',
    category: '视图',
    keybinding: 'Mod+Shift+P',
    keybindingScope: 'global',
    run: () => {
      requireDeps().openPalette()
    },
  })

  register('workspace.focusNext', {
    titleKey: 'cmd.workspace.focusNext',
    category: '视图',
    keybinding: 'F6',
    keybindingScope: 'global',
    run: (commandCtx) => {
      commandCtx.services.require(FOCUS_SERVICE).focusNext()
    },
  })

  register('workspace.focusPrev', {
    titleKey: 'cmd.workspace.focusPrev',
    category: '视图',
    keybinding: 'Shift+F6',
    keybindingScope: 'global',
    run: (commandCtx) => {
      commandCtx.services.require(FOCUS_SERVICE).focusPrev()
    },
  })

  register('layout.reset', {
    titleKey: 'cmd.layout.reset',
    category: '视图',
    menu: { menu: 'view', group: '2_layout', order: 10 },
    run: (commandCtx) => {
      const layout: WorkspaceLayoutService = commandCtx.services.require(LAYOUT_SERVICE)
      layout.resetLayout(commandCtx.pageId)
      requireDeps().notify('布局已恢复默认')
    },
  })

  register('layout.showPanel', {
    titleKey: 'cmd.layout.showPanel',
    category: '视图',
    menu: { menu: 'view', group: '2_layout', order: 20 },
    run: () => {
      requireDeps().openShowPanel()
    },
  })

  register('theme.pick', {
    titleKey: 'cmd.theme.pick',
    category: '视图',
    menu: { menu: 'view', group: '3_theme', order: 10 },
    run: () => {
      requireDeps().openThemePicker()
    },
  })

  register('theme.followSystem', {
    titleKey: 'theme.followSystem',
    category: '视图',
    menu: { menu: 'view', group: '3_theme', order: 20 },
    checked: (commandCtx) => commandCtx.services.require(THEME_CONTROLLER).mode() === 'system',
    run: (commandCtx) => {
      const controller: ThemeControllerPort = commandCtx.services.require(THEME_CONTROLLER)
      const next = controller.mode() === 'system' ? 'manual' : 'system'
      controller.setMode(next)
      commandCtx.services.require(PREFERENCES_SERVICE).flush().catch(() => undefined)
    },
  })

  register('window.minimize', {
    titleKey: 'cmd.window.minimize',
    category: '窗口',
    run: (commandCtx) => {
      commandCtx.services.require(WINDOW_PORT).minimize()
    },
  })

  register('window.maximize', {
    titleKey: 'cmd.window.maximize',
    category: '窗口',
    run: async (commandCtx) => {
      const windowPort = commandCtx.services.require(WINDOW_PORT)
      const maximized = await windowPort.isMaximized()
      commandCtx.services.require(PREFERENCES_SERVICE).patch({})
      windowPort.maximize()
      if (maximized) {
        // maximize() 在最大化状态下是还原（宿主端口语义），这里保持一次调用。
      }
    },
  })

  register('window.close', {
    titleKey: 'cmd.window.close',
    category: '窗口',
    run: (commandCtx) => {
      commandCtx.services.require(WINDOW_PORT).close()
    },
  })

  register('help.shortcuts', {
    titleKey: 'cmd.help.shortcuts',
    category: '帮助',
    menu: { menu: 'help', group: '1_help', order: 10 },
    run: () => {
      requireDeps().openShortcutsHelp()
    },
  })

  register('help.about', {
    titleKey: 'cmd.help.about',
    category: '帮助',
    menu: { menu: 'help', group: '1_help', order: 20 },
    run: () => {
      requireDeps().openAbout()
    },
  })
}
