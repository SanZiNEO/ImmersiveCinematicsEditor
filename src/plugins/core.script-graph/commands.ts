/**
 * `core.script-graph` 的命令与快捷键（05-13）。
 *
 * 命令只转调 `GraphController`：无面板、无选中、断连时如实禁用 / 提示，
 * 不伪造刷新结果，也不在命令里实现第二套图逻辑。
 */
import type { CommandContext, KeyContext, KeyScope, KeybindingRegistryPort } from '../../workbench/api/commands.ts'
import type { CommandContribution } from '../../workbench/api/contributions.ts'
import type { PluginContext } from '../../workbench/api/context.ts'
import { GRAPH_SERVICE, KEYBINDING_SERVICE, STATUS_SERVICE } from '../../workbench/api/tokens.ts'
import { existingGraphController, type GraphController } from './state.ts'

/** 命令分类。 */
const CATEGORY = '脚本'

/** 取已挂载的图控制器；未打开时提示并返回 `null`。 */
function requireController(ctx: CommandContext): GraphController | null {
  const controller = existingGraphController()
  if (controller === null || !controller.isMounted()) {
    ctx.services.get(STATUS_SERVICE)?.notify('脚本关系图面板未打开：先切到脚本页再执行', 'warning')
    return null
  }
  return controller
}

/** 有选中脚本且图已加载。 */
function hasSelection(): boolean {
  const controller = existingGraphController()
  return controller !== null
    && controller.isMounted()
    && controller.state.selectedPath !== null
    && controller.graph.value !== null
}

/** 选中的脚本有可改的 `meta.id`。 */
function hasSelectedScriptId(): boolean {
  const node = existingGraphController()?.selectedNode.value ?? null
  return node !== null && node.scriptId !== null && node.scriptId !== undefined && node.scriptId !== ''
}

function hasGraph(): boolean {
  const controller = existingGraphController()
  return controller !== null && controller.isMounted() && (controller.graph.value?.nodes.length ?? 0) > 0
}

/** 10 条脚本页命令（05-13 固定 ID）。 */
export const GRAPH_COMMANDS: readonly CommandContribution[] = [
  {
    commandId: 'script.new',
    titleKey: '新建脚本',
    category: CATEGORY,
    enabled: (ctx) => ctx.services.get(GRAPH_SERVICE)?.connected() === true,
    run: async (ctx) => {
      const controller = requireController(ctx)
      if (controller === null) {
        return
      }
      await controller.newScript()
    },
  },
  {
    commandId: 'script.openSelected',
    titleKey: '打开选中脚本',
    category: CATEGORY,
    enabled: () => hasSelection(),
    run: (ctx) => {
      const controller = requireController(ctx)
      controller?.openSelected()
    },
  },
  {
    commandId: 'script.editDependencies',
    titleKey: '维护前置…',
    category: CATEGORY,
    enabled: () => hasSelection(),
    run: (ctx) => {
      const controller = requireController(ctx)
      controller?.openDependencyEditor()
    },
  },
  {
    commandId: 'script.renameId',
    titleKey: '改脚本 id…',
    category: CATEGORY,
    enabled: () => hasSelection() && hasSelectedScriptId(),
    run: (ctx) => {
      const controller = requireController(ctx)
      controller?.openRenameDialog()
    },
  },
  {
    commandId: 'script.refresh',
    titleKey: '刷新脚本关系图',
    category: CATEGORY,
    enabled: (ctx) => existingGraphController()?.isMounted() === true && ctx.services.has(GRAPH_SERVICE),
    run: async (ctx) => {
      const controller = requireController(ctx)
      if (controller === null) {
        return
      }
      await controller.refresh()
    },
  },
  {
    commandId: 'script.fit',
    titleKey: '适配视图',
    category: CATEGORY,
    enabled: () => hasGraph(),
    run: (ctx) => {
      requireController(ctx)?.fit()
    },
  },
  {
    commandId: 'script.focusUpstream',
    titleKey: '聚焦上游前置',
    category: CATEGORY,
    enabled: () => hasSelection(),
    run: (ctx) => {
      requireController(ctx)?.focusUpstream()
    },
  },
  {
    commandId: 'script.focusDownstream',
    titleKey: '聚焦下游依赖方',
    category: CATEGORY,
    enabled: () => hasSelection(),
    run: (ctx) => {
      requireController(ctx)?.focusDownstream()
    },
  },
  {
    commandId: 'script.toggleGrouping',
    titleKey: '切换文件夹框',
    category: CATEGORY,
    enabled: () => existingGraphController()?.isMounted() === true,
    checked: () => existingGraphController()?.state.grouping === true,
    run: (ctx) => {
      requireController(ctx)?.toggleGrouping()
    },
  },
  {
    commandId: 'script.resetLayout',
    titleKey: '重置图布局',
    category: CATEGORY,
    enabled: () => existingGraphController()?.isMounted() === true,
    run: (ctx) => {
      const controller = requireController(ctx)
      if (controller === null) {
        return
      }
      controller.askResetLayout()
    },
  },
]

/** 注册 10 条命令。 */
export function registerGraphCommands(ctx: PluginContext): void {
  for (const contribution of GRAPH_COMMANDS) {
    ctx.commands.register(ctx.pluginId, contribution)
  }
}

/**
 * 注册 05-13 的图快捷键。
 *
 * 用 `when` 把作用域限定在脚本页、图面板内部且无输入框：
 * - Enter 只在画布本体聚焦时触发（节点上的 Enter 由节点自己打开脚本，避免抢按钮激活）；
 * - F2 / Alt+←/→ 在画布或节点聚焦时触发；
 * - Mod+Shift+R / Mod+0 是页面级（脚本页）。
 */
export function registerGraphKeybindings(ctx: PluginContext): void {
  const keybindings: KeybindingRegistryPort | undefined = ctx.services.get(KEYBINDING_SERVICE)
  if (keybindings === undefined) {
    ctx.logger.warn('未注册图快捷键：KEYBINDING_SERVICE 不可用')
    return
  }
  const onProject = (context: KeyContext): boolean =>
    context.pageId === 'project' && !context.editable
  const controller = (): GraphController | null => existingGraphController()
  const noDialog = (): boolean => controller()?.hasOpenDialog() !== true
  const canvasFocused = (context: KeyContext): boolean =>
    onProject(context) && noDialog() && controller()?.isCanvasFocused() === true
  const surfaceFocused = (context: KeyContext): boolean =>
    onProject(context) && noDialog() && controller()?.isGraphSurfaceFocused() === true

  const rules: { chord: string; commandId: string; scope: KeyScope; when: (context: KeyContext) => boolean }[] = [
    { chord: 'Enter', commandId: 'script.openSelected', scope: 'page', when: canvasFocused },
    { chord: 'F2', commandId: 'script.renameId', scope: 'page', when: surfaceFocused },
    { chord: 'Mod+Shift+R', commandId: 'script.refresh', scope: 'page', when: (context) => onProject(context) && noDialog() },
    { chord: 'Mod+0', commandId: 'script.fit', scope: 'page', when: (context) => onProject(context) && noDialog() },
    { chord: 'Alt+ArrowLeft', commandId: 'script.focusUpstream', scope: 'page', when: surfaceFocused },
    { chord: 'Alt+ArrowRight', commandId: 'script.focusDownstream', scope: 'page', when: surfaceFocused },
  ]
  for (const rule of rules) {
    try {
      keybindings.register(rule)
    } catch (error) {
      ctx.logger.warn(`图快捷键注册失败：${rule.commandId} ${rule.chord}`, error)
    }
  }
}
