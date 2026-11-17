<script setup lang="ts">
/**
 * 设置 · 高级（04-08）。
 *
 * 打开 `userData`、查看偏好 JSON、分项/全部重置（二次确认）、查看插件 / 布局 / 主题错误。
 * 危险操作二次确认，默认焦点在取消。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { Diagnostic, DiagnosticSource } from '../api/diagnostics.ts'
import { DIAGNOSTICS_SERVICE, FILE_DIALOG_PORT, HOST_SERVICE, PREFERENCES_SERVICE, STATUS_SERVICE, THEME_REGISTRY } from '../api/tokens.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { FileDialogPort, HostPort } from '../api/host.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import type { StatusApi } from '../api/context.ts'
import type { ThemeRegistryPort } from '../api/theme.ts'
import { useI18n, useServices } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()

const showPreferences = ref(false)
const preferenceTick = ref(0)
const unsubscribePreferences = preferences().subscribe(() => {
  preferenceTick.value += 1
})
onScopeDispose(unsubscribePreferences)
const pendingReset = ref<null | 'theme' | 'language' | 'density' | 'shortcuts' | 'recentProjects' | 'settings' | 'plugins' | 'all'>(null)

function diagnostics(): DiagnosticSink {
  return services.require(DIAGNOSTICS_SERVICE)
}

function preferences(): PreferencesApi {
  return services.require(PREFERENCES_SERVICE)
}

function host(): HostPort {
  return services.require(HOST_SERVICE)
}

function dialogs(): FileDialogPort {
  return services.require(FILE_DIALOG_PORT)
}

function status(): StatusApi {
  return services.require(STATUS_SERVICE)
}

function themes(): ThemeRegistryPort {
  return services.require(THEME_REGISTRY)
}

const items = computed<Diagnostic[]>(() => [...diagnostics().list()])
const pluginErrors = computed(() => items.value.filter((item) => item.source === 'plugin'))
const layoutErrors = computed(() => items.value.filter((item) => item.source === 'layout'))
const themeErrors = computed(() => items.value.filter((item) => item.source === 'theme'))

const RESET_SECTIONS = [
  { key: 'theme', labelKey: 'settings.appearance' },
  { key: 'language', labelKey: 'settings.language' },
  { key: 'density', labelKey: 'settings.density' },
  { key: 'shortcuts', labelKey: 'settings.shortcuts' },
  { key: 'recentProjects', labelKey: 'project.recent' },
  { key: 'settings', labelKey: 'settings.workspace' },
  { key: 'plugins', labelKey: 'settings.advancedPlugins' },
] as const

function reveal(): void {
  host().storage.revealUserData()
}

function togglePreferences(): void {
  showPreferences.value = !showPreferences.value
}

function sourceLabel(source: DiagnosticSource): string {
  return i18n.t(`diagnostics.source.${source}`)
}

function askReset(key: typeof pendingReset.value): void {
  pendingReset.value = key
}

async function confirmReset(): Promise<void> {
  const key = pendingReset.value
  pendingReset.value = null
  if (key === null) {
    return
  }
  const choice = await dialogs().confirm(
    i18n.t('advanced.resetTitle'),
    i18n.t(key === 'all' ? 'advanced.resetAllDetail' : 'advanced.resetSectionDetail', { section: String(key) }),
    [i18n.t('advanced.reset'), i18n.t('common.cancel')],
  )
  if (choice !== 0) {
    return
  }
  if (key === 'all') {
    preferences().resetAll()
    themes().removeUserTheme('')
  } else {
    preferences().resetSection(key)
  }
  await preferences().flush()
  status().notify(i18n.t('advanced.resetDone'))
}
</script>

<template>
  <section class="section">
    <h3>{{ i18n.t('settings.advanced') }}</h3>

    <div class="row">
      <button type="button" class="ghost" @click="reveal">{{ i18n.t('workspace.openUserData') }}</button>
      <button type="button" class="ghost" @click="togglePreferences">
        {{ showPreferences ? i18n.t('advanced.hidePreferences') : i18n.t('advanced.showPreferences') }}
      </button>
    </div>

    <pre v-if="showPreferences" class="json">{{ JSON.stringify(preferences().get(), null, 2) }}</pre>

    <h4>{{ i18n.t('advanced.reset') }}</h4>
    <div class="row wrap">
      <button v-for="section in RESET_SECTIONS" :key="section.key" type="button" class="ghost" @click="askReset(section.key)">
        {{ i18n.t(section.labelKey) }}
      </button>
      <button type="button" class="ghost danger" @click="askReset('all')">{{ i18n.t('prefs.reset') }}</button>
    </div>

    <div v-if="pendingReset !== null" class="confirm" role="alertdialog" aria-modal="false">
      <p>{{ i18n.t('advanced.resetTitle') }}</p>
      <p class="hint">{{ i18n.t(pendingReset === 'all' ? 'advanced.resetAllDetail' : 'advanced.resetSectionDetail', { section: String(pendingReset) }) }}</p>
      <div class="row">
        <button type="button" class="ghost" @click="pendingReset = null">{{ i18n.t('common.cancel') }}</button>
        <button type="button" class="ghost danger" @click="confirmReset">{{ i18n.t('advanced.reset') }}</button>
      </div>
    </div>

    <h4>{{ i18n.t('advanced.errors') }}</h4>
    <ul class="errors">
      <li>{{ i18n.t('advanced.pluginErrors', { count: pluginErrors.length }) }}</li>
      <li>{{ i18n.t('advanced.layoutErrors', { count: layoutErrors.length }) }}</li>
      <li>{{ i18n.t('advanced.themeErrors', { count: themeErrors.length }) }}</li>
    </ul>
    <ul v-if="items.length > 0" class="error-list">
      <li v-for="item in items.slice(-10)" :key="item.id">
        <span class="sev" :class="`sev-${item.severity}`">{{ item.severity }}</span>
        <span class="src">{{ sourceLabel(item.source) }}</span>
        <span class="msg">{{ item.message }}</span>
      </li>
    </ul>
    <p v-else class="hint">{{ i18n.t('advanced.noErrors') }}</p>
  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 10px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.section h4 { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); }
.hint { color: var(--text-muted); margin: 0; }
.row { display: flex; align-items: center; gap: 8px; }
.wrap { flex-wrap: wrap; }
.json {
  max-height: 240px;
  overflow: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.ghost {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ghost.danger { border-color: var(--error); color: var(--error); }
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.confirm { border: 1px solid var(--warning); border-radius: 6px; padding: 10px; background: var(--bg-panel); }
.errors { list-style: none; margin: 0; padding: 0; }
.error-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow: auto; }
.error-list li { display: flex; gap: 8px; }
.sev { width: 52px; flex: 0 0 auto; }
.sev-error { color: var(--error); }
.sev-warning { color: var(--warning); }
.sev-info { color: var(--text-muted); }
.src { width: 80px; flex: 0 0 auto; color: var(--text-muted); }
.msg { flex: 1; }
</style>
