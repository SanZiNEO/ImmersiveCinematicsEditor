<script setup lang="ts">
/**
 * 项目启动页（04-04）。
 *
 * 真实入口：最近项目、打开文件夹、打开脚本、新建脚本、连接状态。
 * 空态是真实空态（不造项目统计、不显示假列表）；不扫描磁盘。
 */
import { computed, onMounted, ref } from 'vue'

import type { RecentProject } from '../api/preferences.ts'
import type { DocumentService } from '../api/documents.ts'
import type { FileDialogPort } from '../api/host.ts'
import { DOCUMENT_SERVICE, FILE_DIALOG_PORT, HOST_SERVICE, PREFERENCES_SERVICE } from '../api/tokens.ts'
import type { HostPort } from '../api/host.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import { useDocumentSummary, useI18n, useRouter, useServices, useStatus } from './useWorkbench.ts'

const services = useServices()
const i18n = useI18n()
const router = useRouter()
const status = useStatus()
const summary = useDocumentSummary()

const recents = ref<RecentProject[]>([])
const busy = ref(false)

function documents(): DocumentService {
  return services.require(DOCUMENT_SERVICE)
}

function dialogs(): FileDialogPort {
  return services.require(FILE_DIALOG_PORT)
}

function preferences(): PreferencesApi {
  return services.require(PREFERENCES_SERVICE)
}

function host(): HostPort {
  return services.require(HOST_SERVICE)
}

async function refreshRecents(): Promise<void> {
  const file = preferences().get()
  const probes = await Promise.all(file.recentProjects.map(async (entry) => {
    const exists = await host().storage.exists(entry.path)
    return exists ? { ...entry, missing: false } : { ...entry, missing: true }
  }))
  recents.value = probes
}

onMounted(() => {
  void refreshRecents()
})

const emptyRecents = computed(() => recents.value.length === 0)

function recordRecent(entry: Omit<RecentProject, 'lastOpenedAt'>): void {
  const next = preferences().get().recentProjects.filter((item) => item.path !== entry.path)
  next.unshift({ ...entry, lastOpenedAt: new Date().toISOString() })
  preferences().setSection('recentProjects', next.slice(0, 20))
  void preferences().flush()
  void refreshRecents()
}

async function openPath(path: string): Promise<void> {
  busy.value = true
  try {
    const result = await documents().open(path)
    if (!result.ok) {
      status.notify(result.error ?? i18n.t('project.openFailed'), 'error')
      return
    }
    router.navigate('document', { docId: documents().summary().docId ?? '' })
  } finally {
    busy.value = false
  }
}

async function openFolder(): Promise<void> {
  const path = await dialogs().openFolder()
  if (path === null) {
    return
  }
  recordRecent({ path, name: path.split(/[\\/]/).pop() ?? path, kind: 'folder' })
  status.notify(i18n.t('project.folderRecorded'))
}

async function openScriptFile(): Promise<void> {
  const path = await dialogs().openScript()
  if (path === null) {
    return
  }
  recordRecent({ path, name: path.split(/[\\/]/).pop() ?? path, kind: 'script' })
  await openPath(path)
}

async function newDocument(): Promise<void> {
  busy.value = true
  try {
    const result = await documents().newDoc()
    if (!result.ok) {
      status.notify(result.error ?? i18n.t('project.newFailed'), 'error')
      return
    }
    router.navigate('document', { docId: documents().summary().docId ?? '' })
  } finally {
    busy.value = false
  }
}

async function removeRecent(path: string): Promise<void> {
  preferences().setSection(
    'recentProjects',
    preferences().get().recentProjects.filter((entry) => entry.path !== path),
  )
  await preferences().flush()
  await refreshRecents()
}

async function relocate(entry: RecentProject): Promise<void> {
  const path = entry.kind === 'folder' ? await dialogs().openFolder() : await dialogs().openScript()
  if (path === null) {
    return
  }
  await removeRecent(entry.path)
  recordRecent({ path, name: path.split(/[\\/]/).pop() ?? path, kind: entry.kind })
}

function openRecent(entry: RecentProject): void {
  if (entry.missing) {
    return
  }
  if (entry.kind === 'folder') {
    recordRecent({ path: entry.path, name: entry.name, kind: 'folder' })
    status.notify(i18n.t('project.folderRecorded'))
    return
  }
  void openPath(entry.path)
}
</script>

<template>
  <section class="project-page">
    <header class="hero">
      <h1>{{ i18n.t('project.title') }}</h1>
      <p class="subtitle">{{ i18n.t('project.subtitle') }}</p>
    </header>

    <div class="actions">
      <button type="button" class="primary" @click="newDocument">{{ i18n.t('project.newScript') }}</button>
      <button type="button" class="ghost" @click="openScriptFile">{{ i18n.t('project.openScript') }}</button>
      <button type="button" class="ghost" @click="openFolder">{{ i18n.t('project.openFolder') }}</button>
    </div>

    <div class="connection" :class="{ online: summary.connected }" role="status">
      {{ summary.connected ? i18n.t('status.connected') : i18n.t('status.offline') }}
      <span v-if="!summary.connected" class="hint">{{ i18n.t('project.offlineHint') }}</span>
    </div>

    <section class="recents">
      <h2>{{ i18n.t('project.recent') }}</h2>
      <p v-if="emptyRecents" class="empty">{{ i18n.t('project.recentEmpty') }}</p>
      <ul v-else class="recent-list">
        <li v-for="entry in recents" :key="entry.path" class="recent-item" :class="{ missing: entry.missing }">
          <button
            type="button"
            class="recent-main"
            :disabled="entry.missing || busy"
            :title="entry.path"
            @click="openRecent(entry)"
          >
            <span class="recent-kind">{{ entry.kind === 'folder' ? '📁' : '📄' }}</span>
            <span class="recent-name">{{ entry.name }}</span>
            <span class="recent-path">{{ entry.path }}</span>
            <span class="recent-time">{{ new Date(entry.lastOpenedAt).toLocaleString() }}</span>
            <span v-if="entry.missing" class="missing-tag">{{ i18n.t('project.missing') }}</span>
          </button>
          <div class="recent-actions">
            <button type="button" class="link" @click="relocate(entry)">{{ i18n.t('project.relocate') }}</button>
            <button type="button" class="link danger" @click="removeRecent(entry.path)">{{ i18n.t('project.remove') }}</button>
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.project-page {
  flex: 1;
  overflow: auto;
  padding: 32px clamp(24px, 6vw, 96px);
  background: var(--bg-app);
  color: var(--text);
}
.hero h1 { margin: 0 0 6px; font-size: 20px; }
.subtitle { margin: 0; color: var(--text-secondary); font-size: 12px; }
.actions { display: flex; gap: 10px; margin: 20px 0 14px; }
.primary, .ghost {
  border-radius: 4px;
  font-size: 12px;
  padding: 8px 14px;
  cursor: pointer;
}
.primary { background: var(--accent); color: var(--bg-app); border: 0; font-weight: 600; }
.ghost { background: var(--bg-raised); color: var(--text); border: 1px solid var(--border-strong); }
.primary:focus-visible, .ghost:focus-visible, .recent-main:focus-visible, .link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.connection { font-size: 12px; color: var(--warning); margin-bottom: 18px; }
.connection.online { color: var(--success); }
.hint { color: var(--text-muted); margin-left: 8px; }
.recents h2 { font-size: 13px; color: var(--text-secondary); margin: 0 0 8px; font-weight: 600; }
.empty { color: var(--text-muted); font-size: 12px; margin: 0; }
.recent-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  padding: 6px 8px;
}
.recent-item.missing { border-color: var(--warning); }
.recent-main {
  display: grid;
  grid-template-columns: 20px minmax(120px, 1fr) minmax(160px, 2fr) auto auto;
  align-items: center;
  gap: 10px;
  flex: 1;
  background: transparent;
  border: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
  padding: 4px;
  border-radius: 4px;
}
.recent-main:disabled { color: var(--text-muted); cursor: default; }
.recent-name { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-path { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-time { color: var(--text-muted); }
.missing-tag { color: var(--warning); }
.recent-actions { display: flex; gap: 4px; }
.link { background: transparent; border: 0; color: var(--accent); font-size: 11px; cursor: pointer; }
.link.danger { color: var(--error); }
</style>
