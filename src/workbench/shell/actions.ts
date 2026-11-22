/**
 * 外壳动作（04-04）：命令、菜单、页面共用的真实入口。
 *
 * 抽出来是为了让「新建 / 打开 / 保存 / 回滚 / 切页」只有一份实现：
 * 命令面板、顶栏、项目页都调用这里，不各写一套。
 */
import type { I18nApi, StatusApi } from '../api/context.ts'
import type { DocumentService } from '../api/documents.ts'
import type { FileDialogPort, HostPort } from '../api/host.ts'
import type { PageRouter } from '../api/registries.ts'
import type { PreferencesApi, RecentProject } from '../api/preferences.ts'
import { runUnsavedGuard } from './unsavedGuard.ts'

/** 动作依赖（全部是端口，不含具体实现）。 */
export interface ShellActionsDeps {
  documents: DocumentService
  files: FileDialogPort
  host: HostPort
  router: PageRouter
  preferences: PreferencesApi
  status: StatusApi
  i18n: I18nApi
  /** 工作区根变更后重扫（脚本页刷新）。 */
  onWorkspaceChanged?: () => void
}

/** 记录最近项目（最多 20，去重，倒序）。 */
export function recordRecent(
  preferences: PreferencesApi,
  entry: { path: string; name: string; kind: RecentProject['kind'] },
): void {
  const rest = preferences.get().recentProjects.filter((item) => item.path !== entry.path)
  rest.unshift({ ...entry, lastOpenedAt: new Date().toISOString() })
  preferences.setSection('recentProjects', rest.slice(0, 20))
  void preferences.flush()
}

/** 取文件名（跨平台）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 外壳动作集合。 */
export class ShellActions {
  private readonly deps: ShellActionsDeps
  private documentRenameHandler: (() => void) | null = null
  private settingsHandler: ((sectionId?: string) => void) | null = null

  constructor(deps: ShellActionsDeps) {
    this.deps = deps
  }

  /** 新建文档并进入文档页。 */
  async newDocument(): Promise<void> {
    const result = await this.deps.documents.newDoc()
    if (!result.ok) {
      this.deps.status.notify(result.error ?? this.deps.i18n.t('project.newFailed'), 'error')
      return
    }
    this.deps.router.navigate('document', { docId: this.deps.documents.summary().docId ?? '' })
  }

  /** 打开脚本文件对话框 → 打开 → 记录最近项目。 */
  async openScriptFile(): Promise<void> {
    const path = await this.deps.files.openScript()
    if (path === null) {
      return
    }
    await this.openPath(path, 'script')
  }

  /** 打开指定路径（最近项目 / 对话框共用）。 */
  async openPath(path: string, kind: RecentProject['kind'] = 'script'): Promise<void> {
    const result = await this.deps.documents.open(path)
    if (!result.ok) {
      this.deps.status.notify(result.error ?? this.deps.i18n.t('project.openFailed'), 'error')
      return
    }
    recordRecent(this.deps.preferences, { path, name: baseName(path), kind })
    this.deps.router.navigate('document', { docId: this.deps.documents.summary().docId ?? '' })
  }

  /**
   * 打开工作区目录：记最近项目 + 设为当前工作区根。
   *
   * 工作区 = `<游戏根目录>/immersive_cinematics`（含 `scripts/` 与 `resource/`）。
   * 用户选游戏根目录或 `immersive_cinematics` 本身都可以，主进程会归一化。
   */
  async openFolder(): Promise<void> {
    const path = await this.deps.files.openFolder()
    if (path === null) {
      return
    }
    recordRecent(this.deps.preferences, { path, name: baseName(path), kind: 'folder' })
    try {
      const root = await this.deps.host.workspace.setRoot(path)
      this.deps.status.notify(this.deps.i18n.t('project.workspaceSet', { path: root }))
      this.deps.onWorkspaceChanged?.()
    } catch (error) {
      this.deps.status.notify(
        this.deps.i18n.t('project.workspaceFailed', { reason: error instanceof Error ? error.message : String(error) }),
        'error',
      )
    }
  }

  /** 从磁盘重载（二次确认）。 */
  async revertDocument(): Promise<void> {
    const summary = this.deps.documents.summary()
    if (summary.path === null) {
      return
    }
    const choice = await this.deps.files.confirm(
      this.deps.i18n.t('doc.revertTitle'),
      this.deps.i18n.t('doc.revertDetail', { name: summary.name }),
      [this.deps.i18n.t('doc.revertConfirm'), this.deps.i18n.t('common.cancel')],
    )
    if (choice !== 0) {
      return
    }
    const result = await this.deps.documents.revert()
    if (!result.ok) {
      this.deps.status.notify(result.error ?? this.deps.i18n.t('project.openFailed'), 'error')
    }
  }

  /** 未保存守卫。 */
  async guard(): Promise<'proceed' | 'cancel' | 'failed'> {
    return runUnsavedGuard({
      documents: this.deps.documents,
      files: this.deps.files,
      i18n: this.deps.i18n,
    })
  }

  /** 关闭文档（守卫通过后由调用方调）。 */
  closeDocument(): void {
    this.deps.documents.close()
    this.deps.router.reset('project')
  }

  /** 返回项目页（先走未保存守卫；关闭动作与 File → Close 共用）。 */
  async backToProject(): Promise<void> {
    const result = await this.guard()
    if (result === 'proceed') this.closeDocument()
  }

  /** 由顶栏实现覆盖：当前文档改名对话框。 */
  openDocumentRename(): void {
    if (this.documentRenameHandler === null) {
      this.deps.status.notify('当前没有可改名的文档', 'warning')
      return
    }
    this.documentRenameHandler()
  }

  setDocumentRenameHandler(handler: (() => void) | null): void {
    this.documentRenameHandler = handler
  }

  /** 由外壳实现覆盖：设置弹窗（未注册时回退到设置页路由）。 */
  openSettings(sectionId?: string): void {
    if (this.settingsHandler !== null) {
      this.settingsHandler(sectionId)
      return
    }
    this.deps.router.navigate('settings', sectionId === undefined ? {} : { section: sectionId })
  }

  setSettingsHandler(handler: ((sectionId?: string) => void) | null): void {
    this.settingsHandler = handler
  }

  /** 提示。 */
  notify(message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
    this.deps.status.notify(message, severity)
  }
}
