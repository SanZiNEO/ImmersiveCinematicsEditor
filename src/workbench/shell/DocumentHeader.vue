<script setup lang="ts">
/**
 * 文档顶栏（04-04）。
 *
 * 脏标记只由 03 文档 store 的 `dirty` 驱动；保存成功必须等服务端回执。
 * 校验入口只发 `validateDoc`；结果进状态区/诊断抽屉，不做常驻横幅。
 */
import type { I18nApi } from '../api/context.ts'
import type { DocumentService } from '../api/documents.ts'
import type { FileDialogPort } from '../api/host.ts'
import { DOCUMENT_SERVICE, FILE_DIALOG_PORT } from '../api/tokens.ts'
import { useCommands, useCurrentPageId, useDocumentSummary, useI18n, useRouter, useServices } from './useWorkbench.ts'
import { runUnsavedGuard } from './unsavedGuard.ts'

const i18n: I18nApi = useI18n()
const commands = useCommands()
const router = useRouter()
const services = useServices()
const pageId = useCurrentPageId()
const summary = useDocumentSummary()

let cached: DocumentService | null = null
function documents(): DocumentService {
  if (cached === null) {
    cached = services.require(DOCUMENT_SERVICE)
  }
  return cached
}

function dialogs(): FileDialogPort {
  return services.require(FILE_DIALOG_PORT)
}

async function run(commandId: string): Promise<void> {
  await commands.execute({ pageId: pageId.value, services }, commandId)
}

async function backToProject(): Promise<void> {
  const result = await runUnsavedGuard({
    documents: documents(),
    files: dialogs(),
    i18n,
  })
  if (result === 'proceed') {
    documents().close()
    router.reset('project')
  }
}
</script>

<template>
  <header class="doc-header" data-focus-scope="document-header">
    <div class="left">
      <button type="button" class="ghost" :aria-label="i18n.t('doc.back')" @click="backToProject">
        ← {{ i18n.t('nav.project') }}
      </button>
      <span class="doc-name" :title="summary.name">{{ summary.name || i18n.t('doc.untitled') }}</span>
      <span class="doc-id" :title="summary.docId ?? ''">{{ summary.docId ?? '' }}</span>
      <span v-if="summary.dirty" class="dirty" role="status">● {{ i18n.t('doc.dirty') }}</span>
      <span v-else class="clean" role="status">✓ {{ i18n.t('doc.saved') }}</span>
    </div>
    <div class="center">
      <button type="button" class="ghost" @click="run('file.saveDoc')">{{ i18n.t('doc.save') }}</button>
      <button type="button" class="ghost" @click="run('file.validateDoc')">{{ i18n.t('doc.validate') }}</button>
      <button type="button" class="ghost" @click="run('edit.undo')">{{ i18n.t('doc.undo') }}</button>
      <button type="button" class="ghost" @click="run('edit.redo')">{{ i18n.t('doc.redo') }}</button>
      <span class="issues" :class="{ bad: summary.issueCount > 0 }">
        {{ i18n.t('status.issues') }}: {{ summary.issueCount }}
        <template v-if="summary.stale">（{{ i18n.t('doc.stale') }}）</template>
      </span>
    </div>
    <div class="right">
      <span class="connection" :class="{ online: summary.connected }" role="status">
        {{ summary.connected ? i18n.t('status.connected') : i18n.t('status.offline') }}
      </span>
      <button type="button" class="ghost" @click="run('app.settings')">{{ i18n.t('nav.settings') }}</button>
    </div>
  </header>
</template>

<style scoped>
.doc-header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 36px;
  padding: 0 10px;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex: 0 0 auto;
}
.left, .center, .right { display: flex; align-items: center; gap: 8px; }
.center { flex: 1; justify-content: center; }
.doc-name { color: var(--text); font-weight: 600; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-id { color: var(--text-muted); font-family: var(--font-mono, ui-monospace, monospace); }
.dirty { color: var(--warning); }
.clean { color: var(--text-muted); }
.issues { color: var(--text-secondary); }
.issues.bad { color: var(--warning); }
.connection { color: var(--warning); }
.connection.online { color: var(--success); }
.ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.ghost:hover { background: var(--bg-hover); color: var(--text); }
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
