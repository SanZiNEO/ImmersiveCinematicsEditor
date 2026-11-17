<script setup lang="ts">
/**
 * 顶栏（04-04）：品牌 / 菜单 / 页面标题 / 窗口按钮。
 *
 * 菜单项来自 `CommandRegistry.menuItems`（同一份注册表，不另写 handler）；
 * Windows/Linux 自绘菜单；不支持 titleBarOverlay 时显示自绘三键。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { MenuState } from '../api/commands.ts'
import type { RegisteredPage } from '../api/registries.ts'
import { useCommands, useCurrentPageId, useFocus, useHost, useI18n, usePages, useRouter, useServices } from './useWorkbench.ts'
import { DOCUMENT_SERVICE } from '../api/tokens.ts'
import type { DocumentService } from '../api/documents.ts'

const i18n = useI18n()
const commands = useCommands()
const router = useRouter()
const pages = usePages()
const host = useHost()
const focus = useFocus()
const services = useServices()
const pageId = useCurrentPageId()

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
      <span class="brand-mark" aria-hidden="true">IC</span>
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

    <div class="page-title" :title="pageTitle()">{{ pageTitle() }}</div>

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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--bg-app);
  font-size: 11px;
  font-weight: 700;
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
.page-title {
  flex: 1;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
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
</style>
