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
  openSettings(sectionId?: string): void
  notify(message: string, severity?: 'info' | 'warning' | 'error'): void
}
