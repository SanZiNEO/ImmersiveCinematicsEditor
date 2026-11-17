<script setup lang="ts">
/**
 * 文档顶栏（04-04）。
 *
 * 脏标记只由 03 文档 store 的 `dirty` 驱动；保存成功必须等服务端回执。
 * 校验入口只发 `validateDoc`；结果进状态区/诊断抽屉，不做常驻横幅。
 */
import { ref } from 'vue'
import type { I18nApi } from '../api/context.ts'
import type { DocumentService } from '../api/documents.ts'
import type { FileDialogPort } from '../api/host.ts'
import type { RefsApplyResult, RefsPreviewResult, ScriptMutationServicePort } from '../api/graph.ts'
import { DOCUMENT_SERVICE, FILE_DIALOG_PORT, SCRIPT_MUTATION_SERVICE } from '../api/tokens.ts'
import { useCommands, useCurrentPageId, useDocumentSummary, useI18n, useRouter, useServices, useStatus } from './useWorkbench.ts'
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

function mutations(): ScriptMutationServicePort {
  return services.require(SCRIPT_MUTATION_SERVICE)
}

const status = useStatus()
const renameOpen = ref(false)
const renameFrom = ref('')
const renameTo = ref('')
const renamePreview = ref<RefsPreviewResult | null>(null)
const renameError = ref('')
const renameBusy = ref(false)

function openRename(): void {
  renameFrom.value = summary.value.docId ?? ''
  renameTo.value = ''
  renamePreview.value = null
  renameError.value = ''
  renameOpen.value = true
}

async function previewRename(): Promise<void> {
  renameBusy.value = true
  renameError.value = ''
  renamePreview.value = null
  try {
    const result = await mutations().previewRefs(renameFrom.value, renameTo.value.trim())
    if (result.ok) {
      renamePreview.value = result
    } else {
      renameError.value = result.message
    }
  } finally {
    renameBusy.value = false
  }
}

async function applyRename(): Promise<void> {
  const preview = renamePreview.value
  if (preview === null || !preview.ok) {
    return
  }
  renameBusy.value = true
  renameError.value = ''
  try {
    const result: RefsApplyResult = await mutations().applyRefs(preview.from, preview.to, preview.files.length)
    if (result.ok) {
      status.notify(`脚本 id 已改为 ${preview.to}（${result.changed.length} 个文件）`, 'info')
      renameOpen.value = false
      renamePreview.value = null
    } else {
      renameError.value = result.rolledBack
        ? result.message
        : `${result.message}（回滚失败：${(result.failedPaths ?? []).join('、')}）`
    }
  } finally {
    renameBusy.value = false
  }
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
      <button v-if="summary.docId !== null" type="button" class="ghost small" @click="openRename">改 id…</button>
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
    <div v-if="renameOpen" class="rename-backdrop" role="dialog" aria-modal="true" aria-label="改脚本 id">
      <section class="rename-dialog">
        <h2>改脚本 id</h2>
        <p class="hint">先预览影响面；应用会同步所有指向旧 id 的前置引用，失败整体回滚。</p>
        <label>旧 id<input :value="renameFrom" readonly /></label>
        <label>新 id<input v-model="renameTo" placeholder="[A-Za-z0-9_]{1,32}" @keydown.enter="previewRename" /></label>
        <p v-if="renameError" class="error" role="alert">{{ renameError }}</p>
        <div v-if="renamePreview?.ok" class="preview">
          <p>共 {{ renamePreview.totalReferences }} 处引用，{{ renamePreview.files.length }} 个文件</p>
          <ul>
            <li v-for="file in renamePreview.files" :key="file.path">{{ file.path }}（{{ file.references }}）</li>
          </ul>
          <p v-for="warning in renamePreview.warnings" :key="warning" class="warning">{{ warning }}</p>
        </div>
        <div class="actions">
          <button type="button" class="ghost" :disabled="renameBusy" @click="renameOpen = false">取消</button>
          <button type="button" class="ghost" :disabled="renameBusy || renameTo.trim() === ''" @click="previewRename">预览</button>
          <button
            type="button"
            class="primary"
            :disabled="renameBusy || renamePreview === null || !renamePreview.ok"
            @click="applyRename"
          >应用</button>
        </div>
      </section>
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
.ghost.small { padding: 2px 6px; font-size: 11px; }
.rename-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay, rgba(0, 0, 0, 0.45));
}
.rename-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-raised);
  color: var(--text);
  box-shadow: var(--shadow, 0 12px 32px var(--overlay, rgba(0, 0, 0, 0.4)));
}
.rename-dialog h2 { margin: 0 0 8px; font-size: 15px; }
.rename-dialog label { display: grid; gap: 4px; margin: 10px 0; font-size: 12px; color: var(--text-secondary); }
.rename-dialog input {
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
}
.rename-dialog input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.hint { margin: 0 0 10px; color: var(--text-secondary); font-size: 12px; }
.error { color: var(--error); font-size: 12px; white-space: pre-wrap; }
.warning { color: var(--warning); font-size: 12px; }
.preview { padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-panel); font-size: 12px; }
.preview ul { max-height: 160px; overflow: auto; margin: 6px 0; padding-left: 18px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.primary {
  background: var(--accent);
  color: var(--bg-app);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
