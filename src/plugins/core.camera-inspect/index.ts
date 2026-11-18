/**
 * `core.camera-inspect` 激活（08-05 §3.5）。
 *
 * 注册三个命令：打开/聚焦面板（Lane tab）、在面板中定位片段、打开回放检查。
 * 命令只切会话 tab 与显示面板，不推送、不改文档、不改选区以外的东西。
 */
import type { PluginContext } from '../../workbench/api/context.ts'
import { DOCUMENT_SERVICE, LAYOUT_SERVICE, SELECTION_SERVICE } from '../../workbench/api/tokens.ts'
import type { DocumentService } from '../../workbench/api/documents.ts'
import type { WorkspaceLayoutService } from '../../workbench/api/layout.ts'
import type { SelectionServicePort } from '../../workbench/api/selection.ts'
import { CAMERA_INSPECT_PANEL_REF } from './manifest.ts'
import { focusClip, setInspectTab } from '../../features/camera/inspect/session.ts'

/** 显示并激活面板（不改布局比例，不抢其它 tab）。 */
function showInspectPanel(code: { services: import('../../workbench/api/services.ts').ServiceRegistry }): void {
  const layout = code.services.require<WorkspaceLayoutService>(LAYOUT_SERVICE)
  layout.showPanel('document', CAMERA_INSPECT_PANEL_REF)
}

/** 文档是否打开（命令 enabled 判据）。 */
function documentOpen(code: { services: import('../../workbench/api/services.ts').ServiceRegistry }): boolean {
  const documents = code.services.require<DocumentService>(DOCUMENT_SERVICE)
  return documents.summary().docId !== null
}

export default function activate(ctx: PluginContext): void {
  ctx.commands.register(ctx.pluginId, {
    commandId: 'camera.inspect.open',
    titleKey: 'cmd.camera.inspect.open',
    category: '镜头',
    enabled: (code) => code.pageId === 'document' && documentOpen(code),
    run: (code) => {
      setInspectTab('lane')
      showInspectPanel(code)
    },
  })

  ctx.commands.register(ctx.pluginId, {
    commandId: 'camera.inspect.locate',
    titleKey: 'cmd.camera.inspect.locate',
    category: '镜头',
    enabled: (code) => {
      if (code.pageId !== 'document' || !documentOpen(code)) {
        return false
      }
      const selection = code.services.require<SelectionServicePort>(SELECTION_SERVICE)
      return selection.state().kind === 'clip'
    },
    run: (code) => {
      const selection = code.services.require<SelectionServicePort>(SELECTION_SERVICE)
      const state = selection.state()
      if (state.kind !== 'clip') {
        return
      }
      focusClip(state.clipKey)
      setInspectTab('lane')
      showInspectPanel(code)
    },
  })

  ctx.commands.register(ctx.pluginId, {
    commandId: 'camera.playback.open',
    titleKey: 'cmd.camera.playback.open',
    category: '镜头',
    enabled: (code) => code.pageId === 'document' && documentOpen(code),
    run: (code) => {
      setInspectTab('playback')
      showInspectPanel(code)
    },
  })
}
