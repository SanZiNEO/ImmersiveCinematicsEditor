/**
 * `core.timeline` 的命令贡献（05-13）。
 *
 * 命令是菜单 / 快捷键 / 命令面板的唯一入口；命令与面板共用 `state.ts` 的控制器，
 * 不复制一套片段编辑逻辑。`enabled` 只做真实条件判断（无文档 / 无选区 / 锁定 / 断连），
 * 不写「看起来能跑」的假启用。
 */
import type { CommandContribution } from '../../workbench/api/contributions.ts'
import type { CommandContext } from '../../workbench/api/commands.ts'
import type { PluginContext } from '../../workbench/api/context.ts'
import { DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../workbench/api/tokens.ts'
import type { TimelineController } from './state.ts'
import { disposeTimelineController, ensureTimelineController } from './state.ts'

const CATEGORY = '时间轴'

/** 文档是否打开（不重建 view，只看摘要）。 */
function docOpen(ctx: CommandContext): boolean {
  const documents = ctx.services.get(DOCUMENT_SERVICE)
  if (documents === undefined) {
    return false
  }
  return documents.summary().docId !== null
}

/** 取控制器；服务缺失时返回 null（命令层不抛错）。 */
function controllerOf(ctx: CommandContext): TimelineController | null {
  try {
    return ensureTimelineController(ctx.services)
  } catch {
    return null
  }
}

/** `enabled` / `checked` 求值兜底：任何异常按 false。 */
function safe(check: () => boolean): boolean {
  try {
    return check()
  } catch {
    return false
  }
}

/** 03 共享批选快照（不需要控制器）。 */
function selectedKeys(ctx: CommandContext): readonly string[] {
  const selection = ctx.services.get(SELECTION_SERVICE)
  return selection?.snapshot().clipKeys ?? []
}

/** 选中片段是否全部在未锁定轨道。 */
function selectionUnlocked(ctx: CommandContext): boolean {
  const controller = controllerOf(ctx)
  return controller !== null && !controller.selectionLocked.value
}

/** 选中片段里是否有无限片段（波纹删除 / 顺排禁用）。 */
function selectionHasInfinite(ctx: CommandContext): boolean {
  const controller = controllerOf(ctx)
  if (controller === null) {
    return false
  }
  for (const key of controller.clipKeys.value) {
    const found = controller.clipOf(key)
    if (found !== undefined && (found.clip.infinite || found.clip.duration < 0)) {
      return true
    }
  }
  return false
}

/** 主选片段能否在播放头分割。 */
function canSplitPrimary(ctx: CommandContext): boolean {
  const controller = controllerOf(ctx)
  if (controller === null) {
    return false
  }
  const key = controller.primaryClipKey.value
  if (key === undefined) {
    return false
  }
  const found = controller.clipOf(key)
  if (found === undefined || controller.trackState(found.track.trackId).locked) {
    return false
  }
  if (found.clip.infinite || found.clip.duration < 0 || found.clip.references > 0) {
    return false
  }
  const time = controller.session.value.playhead
  return time > found.clip.start + 0.01 && time < found.clip.start + found.clip.duration - 0.01
}

/** 全部 `timeline.*` 命令（顺序即命令面板里的默认顺序）。 */
export const TIMELINE_COMMANDS: CommandContribution[] = [
  {
    commandId: 'timeline.split',
    titleKey: '在播放头分割片段',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.splitSelectionAtPlayhead()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && canSplitPrimary(ctx)),
    keybinding: 'Mod+K',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.delete',
    titleKey: '删除片段',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.deleteSelection(false)
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && selectedKeys(ctx).length > 0 && selectionUnlocked(ctx)),
    keybinding: 'Delete',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.rippleDelete',
    titleKey: '波纹删除片段',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.deleteSelection(true)
    },
    enabled: (ctx) =>
      safe(
        () =>
          docOpen(ctx) &&
          selectedKeys(ctx).length > 0 &&
          selectionUnlocked(ctx) &&
          !selectionHasInfinite(ctx),
      ),
    keybinding: 'Shift+Delete',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.copy',
    titleKey: '复制片段',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.copySelection()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && selectedKeys(ctx).length > 0),
    keybinding: 'Mod+C',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.cut',
    titleKey: '剪切片段',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.cutSelection()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && selectedKeys(ctx).length > 0 && selectionUnlocked(ctx)),
    keybinding: 'Mod+X',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.paste',
    titleKey: '粘贴片段',
    category: CATEGORY,
    run: (ctx) => {
      const controller = controllerOf(ctx)
      if (controller === null) {
        return
      }
      controller.pasteAt(controller.session.value.playhead)
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && (controllerOf(ctx)?.canPaste.value ?? false)),
    keybinding: 'Mod+V',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.duplicate',
    titleKey: '复制一份',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.duplicateSelection()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && selectedKeys(ctx).length > 0 && selectionUnlocked(ctx)),
    keybinding: 'Mod+D',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.toggleLoop',
    titleKey: '切换片段循环',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.toggleLoopSelection()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && selectedKeys(ctx).length > 0 && selectionUnlocked(ctx)),
    keybinding: 'L',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.compactSelection',
    titleKey: '顺排选中片段',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.compactSelection()
    },
    enabled: (ctx) =>
      safe(
        () =>
          docOpen(ctx) &&
          selectedKeys(ctx).length > 0 &&
          selectionUnlocked(ctx) &&
          !selectionHasInfinite(ctx),
      ),
  },
  {
    commandId: 'timeline.toggleBlade',
    titleKey: '刀片工具',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.toggleBlade()
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
    checked: (ctx) => safe(() => controllerOf(ctx)?.tool.value === 'blade'),
    keybinding: 'B',
    keybindingScope: 'panel',
  },
  {
    commandId: 'timeline.addTrack',
    titleKey: '添加轨道（镜头）',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.addTrack('CAMERA')
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.addClip',
    titleKey: '新建片段',
    category: CATEGORY,
    run: (ctx) => {
      const controller = controllerOf(ctx)
      const track = controller?.activeTrack.value
      if (controller !== null && track !== undefined) {
        controller.addClip(track.trackId)
      }
    },
    enabled: (ctx) =>
      safe(() => {
        const controller = controllerOf(ctx)
        return docOpen(ctx) && (controller?.canAddClipToActive.value.ok ?? false)
      }),
  },
  {
    commandId: 'timeline.zoomIn',
    titleKey: '放大时间轴',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.zoomBy(1.25)
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.zoomOut',
    titleKey: '缩小时间轴',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.zoomBy(0.8)
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.fit',
    titleKey: '适配时间轴',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.fit()
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.toggleSnap',
    titleKey: '切换吸附',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.toggleSnap()
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
    checked: (ctx) => safe(() => controllerOf(ctx)?.snapEnabled.value === true),
  },
  {
    commandId: 'timeline.addMarker',
    titleKey: '在播放头添加标记',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.addMarkerAtPlayhead()
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.clearMarkers',
    titleKey: '清除全部标记',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.clearMarkers()
    },
    enabled: (ctx) =>
      safe(() => docOpen(ctx) && (controllerOf(ctx)?.session.value.markers.length ?? 0) > 0),
  },
  {
    commandId: 'timeline.play',
    titleKey: '播放',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.play()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && (controllerOf(ctx)?.canPlay.value ?? false)),
    checked: (ctx) => safe(() => controllerOf(ctx)?.playing.value === true),
  },
  {
    commandId: 'timeline.pause',
    titleKey: '暂停',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.pause()
    },
    enabled: (ctx) =>
      safe(() => (controllerOf(ctx)?.playing.value ?? false) && (controllerOf(ctx)?.canPlay.value ?? false)),
  },
  {
    commandId: 'timeline.stop',
    titleKey: '停止',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.stop()
    },
    enabled: (ctx) => safe(() => docOpen(ctx) && (controllerOf(ctx)?.canPlay.value ?? false)),
  },
  {
    commandId: 'timeline.setLoopIn',
    titleKey: '设置循环入点',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.setLoopInAtPlayhead()
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.setLoopOut',
    titleKey: '设置循环出点',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.setLoopOutAtPlayhead()
    },
    enabled: (ctx) => safe(() => docOpen(ctx)),
  },
  {
    commandId: 'timeline.clearLoop',
    titleKey: '清除 A-B 循环',
    category: CATEGORY,
    run: (ctx) => {
      controllerOf(ctx)?.clearLoop()
    },
    enabled: (ctx) =>
      safe(() => {
        const view = controllerOf(ctx)?.view.value
        return docOpen(ctx) && view !== null && view !== undefined && (view.loopStart !== null || view.loopEnd !== null)
      }),
  },
]

/** manifest / activate 共用：命令只注册一次（内核按 commandId 去重）。 */
export function registerTimelineCommands(ctx: PluginContext): void {
  const controller = ensureTimelineController(ctx.services)
  ctx.disposables.add({
    dispose: () => {
      disposeTimelineController(controller)
    },
  })
  for (const command of TIMELINE_COMMANDS) {
    ctx.commands.register('core.timeline', command)
  }
}
