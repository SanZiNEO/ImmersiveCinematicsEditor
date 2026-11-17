/**
 * 未保存守卫（04-04）。
 *
 * 关闭文档、返回项目、切换页面、退出应用共用同一套「保存 / 放弃 / 取消」。
 * 保存成功才继续；保存失败或取消一律停留原处（不允许用「已保存」假回执放行）。
 */
import type { DocumentService, SaveOutcome } from '../api/documents.ts'
import type { FileDialogPort } from '../api/host.ts'
import type { I18nApi } from '../api/context.ts'

/** 守卫结果：`proceed` 才允许继续。 */
export type GuardResult = 'proceed' | 'cancel' | 'failed'

/** 守卫依赖。 */
export interface UnsavedGuardDeps {
  documents: DocumentService
  files: Pick<FileDialogPort, 'confirm'>
  i18n: I18nApi
}

/** 三选一按钮顺序：保存 / 放弃 / 取消。 */
export const UNSAVED_BUTTONS = [0, 1, 2] as const

/**
 * 文档不脏 → 直接放行；脏 → 弹三选一。
 *
 * - 0 保存：保存失败（含断连、block、冲突）→ `failed`，不继续；
 * - 1 放弃：继续（调用方负责丢弃内存修改）；
 * - 2 取消 / 关闭对话框（-1）→ `cancel`。
 */
export async function runUnsavedGuard(deps: UnsavedGuardDeps): Promise<GuardResult> {
  const summary = deps.documents.summary()
  if (summary.docId === null) {
    return 'proceed'
  }
  if (!summary.dirty) {
    return 'proceed'
  }
  const choice = await deps.files.confirm(
    deps.i18n.t('guard.unsavedTitle'),
    deps.i18n.t('guard.unsavedDetail', { name: summary.name }),
    [deps.i18n.t('common.save'), deps.i18n.t('common.discard'), deps.i18n.t('common.cancel')],
  )
  if (choice === 0) {
    const result: SaveOutcome = await deps.documents.save()
    return result.ok ? 'proceed' : 'failed'
  }
  if (choice === 1) {
    return 'proceed'
  }
  return 'cancel'
}
