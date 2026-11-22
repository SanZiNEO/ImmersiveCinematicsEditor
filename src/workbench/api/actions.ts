/**
 * 外壳动作端口（05 图面板 / 页头 / 命令共用）。
 *
 * 新建、打开、保存守卫、切页只有一份实现；插件不重复实现 `UnsavedGuard`。
 */
import type { RecentProject } from './preferences.ts'

/** 守卫结果：`proceed` 才允许继续。 */
export type GuardResult = 'proceed' | 'cancel' | 'failed'

/** 外壳动作端口。 */
export interface ShellActionsPort {
  newDocument(): Promise<void>
  openScriptFile(): Promise<void>
  openPath(path: string, kind?: RecentProject['kind']): Promise<void>
  openFolder(): Promise<void>
  revertDocument(): Promise<void>
  guard(): Promise<GuardResult>
  closeDocument(): void
  /** 文档页「返回项目」：经过同一未保存守卫。 */
  backToProject(): Promise<void>
  /** 打开当前文档的 id 改名对话框。 */
  openDocumentRename(): void
  /** 顶栏注册自身提供的文档改名对话框。 */
  setDocumentRenameHandler?(handler: (() => void) | null): void
  /** 打开设置弹窗（可带分区）。 */
  openSettings(sectionId?: string): void
  /** 外壳注册自身提供的设置弹窗；未注册时 `openSettings` 回退到设置页路由。 */
  setSettingsHandler?(handler: ((sectionId?: string) => void) | null): void
  notify(message: string, severity?: 'info' | 'warning' | 'error'): void
}
