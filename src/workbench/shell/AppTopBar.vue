<script setup lang="ts">
/**
 * 顶栏（04-04）：品牌 / 菜单 / 页面标题 / 窗口按钮。
 *
 * 菜单项来自 `CommandRegistry.menuItems`（同一份注册表，不另写 handler）；
 * Windows/Linux 自绘菜单；不支持 titleBarOverlay 时显示自绘三键。
 */
import { computed, onBeforeUnmount, onScopeDispose, ref, watch } from 'vue'

import type { MenuState } from '../api/commands.ts'
import type { RegisteredPage } from '../api/registries.ts'
import { useCommands, useCurrentPageId, useDocumentSummary, useFocus, useHost, useI18n, usePages, useRouter, useServices } from './useWorkbench.ts'
import { DOCUMENT_COMMANDS, DOCUMENT_SERVICE, SCRIPT_MUTATION_SERVICE, SHELL_ACTIONS_SERVICE } from '../api/tokens.ts'
import type { DocumentService } from '../api/documents.ts'
import type { RefsApplyResult, RefsPreviewResult, ScriptMutationServicePort } from '../api/graph.ts'
import WorkbenchDialog from './WorkbenchDialog.vue'
import brandIcon from '../assets/brand-icon.png'

const i18n = useI18n()
const commands = useCommands()
const router = useRouter()
const pages = usePages()
const host = useHost()
const focus = useFocus()
const services = useServices()
const pageId = useCurrentPageId()
const summary = useDocumentSummary()
const renameOpen = ref(false)
const renameFrom = ref('')
const renameTo = ref('')
const renamePreview = ref<RefsPreviewResult | null>(null)
const renameError = ref('')
const renameBusy = ref(false)

const MENUS = [
  { id: 'file', labelKey: 'menu.file' },
  { id: 'edit', labelKey: 'menu.edit' },
  { id: 'view', labelKey: 'menu.view' },
  { id: 'help', labelKey: 'menu.help' },
] as const

const openMenu = ref<string | null>(null)
const maximized = ref(false)
const showWindowButtons = computed(() => host.kind === 'electron')

void host.window.onMaximizeChange((next) => {
  maximized.value = next
})
void host.window.isMaximized().then((next) => {
  maximized.value = next
})

function context() {
  return { pageId: pageId.value, services }
}

function menuItems(menu: string): MenuState[] {
  return commands.menuItems(context()).filter((item) => item.menu === menu)
}

function pageTitle(): string {
  const page = pages.get(pageId.value)
  if (page === undefined) {
    return pageId.value
  }
  return i18n.t(page.contribution.titleKey)
}

function documents(): DocumentService {
  return services.require(DOCUMENT_SERVICE)
}

function mutations(): ScriptMutationServicePort {
  return services.require(SCRIPT_MUTATION_SERVICE)
}

const documentEditState = computed(() => {
  void summary.value.revision
  const documentCommands = services.get(DOCUMENT_COMMANDS)
  return {
    canUndo: documentCommands?.canUndo === true,
    canRedo: documentCommands?.canRedo === true,
  }
})

function openDocumentRename(): void {
  if (summary.value.docId === null) return
  renameFrom.value = summary.value.docId
  renameTo.value = ''
  renamePreview.value = null
  renameError.value = ''
  renameOpen.value = true
}

async function previewRename(): Promise<void> {
  if (renameBusy.value || renameTo.value.trim() === '') return
  renameBusy.value = true
  renameError.value = ''
  try {
    const result = await mutations().previewRefs(renameFrom.value, renameTo.value.trim())
    renamePreview.value = result
    if (!result.ok) renameError.value = result.message
  } finally {
    renameBusy.value = false
  }
}

async function applyRename(): Promise<void> {
  const preview = renamePreview.value
  if (renameBusy.value || preview === null || !preview.ok) return
  renameBusy.value = true
  try {
    const result: RefsApplyResult = await mutations().applyRefs(
      preview.from,
      preview.to,
      preview.files.length,
    )
    if (!result.ok) {
      renameError.value = result.rolledBack
        ? result.message
        : `${result.message}（回滚失败：${(result.failedPaths ?? []).join('、')}）`
      return
    }
    renameOpen.value = false
    renamePreview.value = null
  } finally {
    renameBusy.value = false
  }
}

watch(renameTo, () => {
  renamePreview.value = null
  renameError.value = ''
})

services.require(SHELL_ACTIONS_SERVICE).setDocumentRenameHandler?.(openDocumentRename)
onBeforeUnmount(() => {
  services.get(SHELL_ACTIONS_SERVICE)?.setDocumentRenameHandler?.(null)
})

async function run(commandId: string): Promise<void> {
  openMenu.value = null
  await commands.execute(context(), commandId)
}

const pluginPages = computed<RegisteredPage[]>(() =>
  pages.list().filter((page) => page.contribution.pageId !== 'project'
    && page.contribution.pageId !== 'document'
    && page.contribution.pageId !== 'settings'),
)

function navigate(page: string, params: Record<string, string> = {}): void {
  openMenu.value = null
  const summary = documents().summary()
  if (summary.dirty && page !== pageId.value) {
    void commands.execute(context(), 'file.closeDoc')
    return
  }
  router.navigate(page, params)
}

function toggleMenu(id: string): void {
  openMenu.value = openMenu.value === id ? null : id
}

function onBlur(): void {
  openMenu.value = null
}

onScopeDispose(() => {
  openMenu.value = null
})

defineExpose({ focusRegion: () => focus.focusRegion('topbar') })
</script>

<template>
  <header class="topbar" data-focus-scope="topbar" @blur="onBlur">
    <div class="brand">
      <img class="brand-mark" :src="brandIcon" alt="" aria-hidden="true" draggable="false" />
      <span class="brand-name">{{ i18n.t('app.title') }}</span>
    </div>

    <nav class="menus" role="menubar" :aria-label="i18n.t('menu.file')">
      <div v-for="menu in MENUS" :key="menu.id" class="menu">
        <button
          type="button"
          class="menu-button"
          role="menuitem"
          :aria-expanded="openMenu === menu.id"
          @click="toggleMenu(menu.id)"
        >
          {{ i18n.t(menu.labelKey) }}
        </button>
        <ul v-if="openMenu === menu.id" class="menu-list" role="menu">
          <template v-if="menuItems(menu.id).length > 0">
            <li v-for="item in menuItems(menu.id)" :key="item.commandId" role="none">
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!item.enabled"
                @click="run(item.commandId)"
              >
                <span class="menu-item-label">{{ i18n.t(item.label) }}</span>
                <span v-if="item.checked" class="menu-item-check" aria-hidden="true">✓</span>
                <span v-if="item.accelerator" class="menu-item-accel">{{ item.accelerator }}</span>
              </button>
            </li>
          </template>
          <template v-else-if="menu.id === 'view'">
            <li role="none" class="menu-empty">{{ i18n.t('menu.viewNoItems') }}</li>
          </template>
        </ul>
      </div>
      <div v-if="pluginPages.length > 0" class="menu">
        <button type="button" class="menu-button" role="menuitem" @click="toggleMenu('pages')">
          {{ i18n.t('menu.pages') }}
        </button>
        <ul v-if="openMenu === 'pages'" class="menu-list" role="menu">
          <li v-for="page in pluginPages" :key="page.contribution.pageId" role="none">
            <button type="button" class="menu-item" role="menuitem" @click="navigate(page.contribution.pageId)">
              <span class="menu-item-label">{{ i18n.t(page.contribution.titleKey) }}</span>
            </button>
          </li>
        </ul>
      </div>
    </nav>

    <section
      v-if="pageId === 'document' && summary.docId !== null"
      class="edit-card"
      role="toolbar"
      aria-label="文档编辑"
    >
      <button type="button" class="edit-button script-graph-link" @click="run('file.backToProject')">
        {{ i18n.t('nav.scriptGraph') }}
      </button>
      <span class="document-name" :title="summary.path ?? summary.name">{{ summary.name || i18n.t('doc.untitled') }}</span>
      <button type="button" class="document-id" :title="i18n.t('cmd.file.renameDocId')" @click="openDocumentRename">
        {{ summary.docId }}
      </button>
      <span class="edit-divider" aria-hidden="true"></span>
      <button type="button" class="edit-button" :title="i18n.t('doc.save')" @click="run('file.saveDoc')">
        {{ i18n.t('doc.save') }}
      </button>
      <button
        type="button"
        class="edit-icon"
        :disabled="!documentEditState.canUndo"
        :aria-label="i18n.t('doc.undo')"
        :title="i18n.t('doc.undo')"
        @click="run('edit.undo')"
      >↶</button>
      <button
        type="button"
        class="edit-icon"
        :disabled="!documentEditState.canRedo"
        :aria-label="i18n.t('doc.redo')"
        :title="i18n.t('doc.redo')"
        @click="run('edit.redo')"
      >↷</button>
      <button type="button" class="edit-button" :title="i18n.t('doc.validate')" @click="run('file.validateDoc')">
        {{ i18n.t('doc.validate') }}
      </button>
    </section>
    <div v-else class="page-title">{{ pageTitle() }}</div>

    <div v-if="showWindowButtons" class="window-buttons">
      <button type="button" class="window-button" :aria-label="i18n.t('cmd.window.minimize')" @click="host.window.minimize()">—</button>
      <button
        type="button"
        class="window-button"
        :aria-label="i18n.t(maximized ? 'cmd.window.maximize' : 'cmd.window.maximize')"
        @click="host.window.maximize()"
      >
        {{ maximized ? '❐' : '□' }}
      </button>
      <button type="button" class="window-button window-close" :aria-label="i18n.t('cmd.window.close')" @click="host.window.close()">✕</button>
    </div>

    <WorkbenchDialog
      v-if="renameOpen"
      title="改脚本 id"
      dialog-id="rename-document"
      width="480px"
      :dismissible="!renameBusy"
      @close="renameOpen = false"
    >
      <div class="rename-form">
        <label>旧 id<input :value="renameFrom" readonly></label>
        <label>新 id<input v-model="renameTo" autofocus :disabled="renameBusy" placeholder="[A-Za-z0-9_]{1,32}" @keydown.enter.prevent="previewRename"></label>
        <p v-if="renameError" class="rename-error" role="alert">{{ renameError }}</p>
        <p v-if="renamePreview?.ok">共 {{ renamePreview.totalReferences }} 处引用，{{ renamePreview.files.length }} 个文件</p>
      </div>
      <template #footer>
        <button type="button" :disabled="renameBusy" @click="renameOpen = false">取消</button>
        <button type="button" :disabled="renameBusy || renameTo.trim() === ''" @click="previewRename">预览</button>
        <button type="button" :disabled="renameBusy || renamePreview === null || !renamePreview.ok" @click="applyRename">应用</button>
      </template>
    </WorkbenchDialog>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 8px 0 10px;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  flex: 0 0 auto;
  -webkit-app-region: drag;
}
.brand { display: flex; align-items: center; gap: 8px; -webkit-app-region: no-drag; }
.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: block;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}
.brand-name { font-size: 13px; font-weight: 600; white-space: nowrap; }
.menus { display: flex; align-items: center; gap: 2px; -webkit-app-region: no-drag; }
.menu { position: relative; }
.menu-button {
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.menu-button:hover, .menu-button[aria-expanded='true'] { background: var(--bg-hover); color: var(--text); }
.menu-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.menu-list {
  position: absolute;
  top: 32px;
  left: 0;
  min-width: 220px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: var(--shadow, 0 8px 24px var(--overlay, rgba(0, 0, 0, 0.35)));
  z-index: 40;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover:not(:disabled) { background: var(--bg-hover); }
.menu-item:disabled { color: var(--text-muted); cursor: default; }
.menu-item:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.menu-item-label { flex: 1; }
.menu-item-check { color: var(--success); }
.menu-item-accel { color: var(--text-muted); font-size: 11px; }
.menu-empty { padding: 6px 8px; color: var(--text-muted); font-size: 12px; }
.page-title, .edit-card {
  flex: 1 1 auto;
  min-width: 0;
}
.page-title {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edit-card {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: fit-content;
  max-width: 760px;
  min-height: 30px;
  height: 30px;
  margin: 0 auto;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  -webkit-app-region: no-drag;
}
.document-name {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 260px;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-id {
  flex: 0 1 auto;
  max-width: 150px;
  overflow: hidden;
  padding: 3px 4px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.document-id:hover { background: var(--bg-hover); color: var(--text-secondary); }
.edit-divider { width: 1px; height: 16px; margin: 0 3px; background: var(--border); }
.edit-button, .edit-icon {
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.edit-button { padding: 0 7px; font-size: 11px; }
.script-graph-link { flex-shrink: 0; white-space: nowrap; color: var(--text); }
.edit-icon { width: 24px; padding: 0; font-size: 15px; line-height: 1; }
.edit-button:hover, .edit-icon:hover:not(:disabled), .document-id:focus-visible {
  background: var(--bg-hover);
  color: var(--text);
}
.edit-button:focus-visible, .edit-icon:focus-visible, .document-id:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}
.edit-icon:disabled { color: var(--text-muted); opacity: 0.45; cursor: default; }
.rename-form { display: grid; gap: 10px; }
.rename-form p { margin: 0; }
.rename-form label { display: grid; gap: 4px; color: var(--text-secondary); font-size: 12px; }
.rename-form input { padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--bg-panel); color: var(--text); }
.rename-error { color: var(--error); }
.window-buttons { display: flex; align-items: center; -webkit-app-region: no-drag; }
.window-button {
  width: 34px;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
}
.window-button:hover { background: var(--bg-hover); color: var(--text); }
.window-close:hover { background: var(--error); color: var(--bg-app); }
.window-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
@media (max-width: 1180px) {
  .brand-name { display: none; }
  .document-name { max-width: 180px; }
  .document-id { max-width: 100px; }
}
@media (max-width: 900px) {
  .document-id, .edit-divider { display: none; }
  .document-name { max-width: 140px; }
  .edit-card { max-width: 420px; }
}
</style>
