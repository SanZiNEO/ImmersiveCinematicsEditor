<script setup lang="ts">
/**
 * 设置页（04-08）：左侧分区导航 + 右侧内容。
 *
 * 分区来自 `settings` 贡献；可见性、搜索、作用域与已修改状态由共享浏览器提供。
 * 切分区不关闭文档、不清选区；返回后回到原页面。
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'

import { useI18n, useRouter } from './useWorkbench.ts'
import { useSettingsBrowser } from '../settings/useSettingsBrowser.ts'
import {
  settingsScopeDescriptionKey,
  settingsScopeLabelKey,
  settingsVisibilityLabelKey,
} from '../settings/settingsVisibility.ts'
import type { SettingsSectionView } from '../settings/settingsVisibility.ts'
import SettingsFilterBar from '../settings/SettingsFilterBar.vue'

const i18n = useI18n()
const router = useRouter()
const requestedSection = ref<string | undefined>(router.currentParams().section)
const browser = useSettingsBrowser({
  requestedSectionId: () => requestedSection.value,
})
const {
  visibleSections,
  activeSectionId,
  activeSection,
  query,
  showAdvanced,
  showExperimental,
  onlyModified,
  hasExperimental,
  emptyState,
  modifiedCount,
} = browser

const loaded = shallowRef<Record<string, Component>>({})
const failure = ref<string | null>(null)
const attempt = ref(0)

const unsubscribeRouter = router.subscribe(() => {
  requestedSection.value = router.currentParams().section
})
onScopeDispose(unsubscribeRouter)

void watch(activeSectionId, async (sectionId) => {
  failure.value = null
  if (sectionId === '') {
    return
  }
  if (loaded.value[sectionId] !== undefined) {
    return
  }
  const section = browser.sections.value.find((entry) => entry.sectionId === sectionId)
  if (section === undefined) {
    failure.value = i18n.t('settings.missingSection', { sectionId })
    return
  }
  try {
    const module = await section.load()
    loaded.value = { ...loaded.value, [sectionId]: module as Component }
  } catch (error) {
    if (activeSectionId.value === sectionId) {
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }
}, { immediate: true })

const activeTitle = computed(() => {
  return activeSection.value?.title ?? i18n.t('nav.settings')
})

function visibilityLabel(section: SettingsSectionView | undefined): string | null {
  if (section === undefined) {
    return null
  }
  const key = settingsVisibilityLabelKey(section.visibility)
  return key === null ? null : i18n.t(key)
}

const emptyCopy = computed(() => {
  switch (emptyState.value) {
    case 'search':
    case 'filtered':
      return {
        title: i18n.t('settings.search.emptyTitle'),
        hint: i18n.t('settings.search.emptyHint'),
        action: 'clear' as const,
      }
    case 'modified':
      return {
        title: i18n.t('settings.filter.modifiedEmptyTitle'),
        hint: i18n.t('settings.filter.modifiedEmptyHint'),
        action: 'all' as const,
      }
    case 'noSections':
      return {
        title: i18n.t('settings.search.noSections'),
        hint: '',
        action: null,
      }
    default:
      return null
  }
})

function runEmptyAction(): void {
  if (emptyCopy.value?.action === 'all') {
    browser.showAllSections()
    return
  }
  browser.clearSearch()
}

function retry(): void {
  const sectionId = activeSectionId.value
  if (sectionId === '') {
    return
  }
  const next = { ...loaded.value }
  delete next[sectionId]
  loaded.value = next
  failure.value = null
  attempt.value += 1
  const section = browser.sections.value.find((entry) => entry.sectionId === sectionId)
  if (section === undefined) {
    return
  }
  void section.load()
    .then((module) => {
      if (activeSectionId.value === sectionId) {
        loaded.value = { ...loaded.value, [sectionId]: module as Component }
      }
    })
    .catch((error: unknown) => {
      if (activeSectionId.value === sectionId) {
        failure.value = error instanceof Error ? error.message : String(error)
      }
    })
}

function back(): void {
  router.back()
}
</script>

<template>
  <section class="settings-page">
    <header class="settings-header">
      <button type="button" class="ghost" @click="back">← {{ i18n.t('doc.back') }}</button>
      <h1>{{ activeTitle }}</h1>
    </header>
    <div class="settings-body">
      <nav class="settings-nav" :aria-label="i18n.t('nav.settings')">
        <SettingsFilterBar
          :query="query"
          :show-advanced="showAdvanced"
          :show-experimental="showExperimental"
          :experimental-available="hasExperimental"
          :only-modified="onlyModified"
          :modified-count="modifiedCount"
          @update:query="query = $event"
          @update:show-advanced="showAdvanced = $event"
          @update:show-experimental="showExperimental = $event"
          @update:only-modified="browser.setOnlyModified($event)"
        />
        <button
          v-for="entry in visibleSections"
          :key="entry.sectionId"
          type="button"
          class="nav-item"
          :aria-current="activeSectionId === entry.sectionId"
          @click="browser.selectSection(entry.sectionId)"
        >
          <span class="nav-item__main">
            <span class="nav-item__label">{{ entry.title }}</span>
            <span class="nav-item__scope">{{ i18n.t(settingsScopeLabelKey(entry.scope)) }}</span>
          </span>
          <span class="nav-item__badges">
            <span v-if="visibilityLabel(entry) !== null" class="badge">{{ visibilityLabel(entry) }}</span>
            <span v-if="browser.isSectionModified(entry.sectionId)" class="modified-dot" aria-hidden="true"></span>
          </span>
        </button>
      </nav>
      <div class="settings-content">
        <header class="settings-content__heading">
          <h2>{{ activeTitle }}</h2>
          <div v-if="activeSection" class="settings-content__meta">
            <span class="badge" :title="i18n.t(settingsScopeDescriptionKey(activeSection.scope))">
              {{ i18n.t(settingsScopeLabelKey(activeSection.scope)) }}
            </span>
            <span v-if="visibilityLabel(activeSection) !== null" class="badge">{{ visibilityLabel(activeSection) }}</span>
            <span v-if="browser.isSectionModified(activeSection.sectionId)" class="modified-label">
              {{ i18n.t('settings.modified') }}
            </span>
          </div>
        </header>
        <div v-if="emptyCopy" class="empty" role="status">
          <p class="empty-title">{{ emptyCopy.title }}</p>
          <p v-if="emptyCopy.hint" class="hint">{{ emptyCopy.hint }}</p>
          <button v-if="emptyCopy.action" type="button" class="ghost" @click="runEmptyAction">
            {{ i18n.t(emptyCopy.action === 'all' ? 'settings.filter.showAll' : 'settings.search.clear') }}
          </button>
        </div>
        <div v-else-if="failure" class="error" role="alert">
          {{ failure }}
          <button type="button" class="ghost" @click="retry">{{ i18n.t('panel.retry') }}</button>
        </div>
        <component
          :is="loaded[activeSectionId]"
          v-else-if="loaded[activeSectionId]"
          :key="`${activeSectionId}:${attempt}`"
        />
        <p v-else class="loading" role="status">{{ i18n.t('page.loading') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg-app); color: var(--text); }
.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.settings-header h1 { margin: 0; font-size: 14px; }
.settings-body { flex: 1; display: flex; min-height: 0; }
.settings-nav {
  width: 248px;
  flex: 0 0 auto;
  border-right: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text); }
.nav-item[aria-current='true'] { background: var(--bg-selected); color: var(--text); }
.nav-item:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.nav-item__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nav-item__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-item__scope { color: var(--text-muted); font-size: 10px; }
.nav-item__badges { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.settings-content { flex: 1; padding: 20px 24px; overflow: auto; }
.settings-content__heading { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; }
.settings-content h2 { margin: 0; font-size: 15px; }
.settings-content__meta { display: flex; align-items: center; gap: 6px; }
.badge {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
}
.modified-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warning); }
.modified-label { color: var(--warning); font-size: 10px; }
.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}
.empty-title { margin: 0; color: var(--text); font-size: 13px; }
.hint { margin: 0; color: var(--text-muted); font-size: 12px; }
.error { color: var(--error); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.loading { color: var(--text-muted); font-size: 12px; }
.ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
