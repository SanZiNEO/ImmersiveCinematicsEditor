<script setup lang="ts">
/**
 * 设置页（04-08）：左侧分区导航 + 右侧内容。
 *
 * 分区来自 `settings` 贡献（核心六区 + 插件分区）；切分区只改路由参数，
 * 不关闭文档、不清选区；返回后回到原页面。
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'

import type { RegisteredSettingsSection } from '../api/registries.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import { SETTINGS_REGISTRY, PREFERENCES_SERVICE } from '../api/tokens.ts'
import type { SettingsRegistry } from '../api/registries.ts'
import { useI18n, useRouter, useServices } from './useWorkbench.ts'

const services = useServices()
const i18n = useI18n()
const router = useRouter()

const sections = ref<RegisteredSettingsSection[]>([])
const activeSectionId = ref<string>('')
const loaded = shallowRef<Record<string, Component>>({})
const failure = ref<string | null>(null)

function registry(): SettingsRegistry {
  return services.require(SETTINGS_REGISTRY)
}

function preferences(): PreferencesApi {
  return services.require(PREFERENCES_SERVICE)
}

function refreshSections(): void {
  sections.value = registry().list()
  const params = router.currentParams()
  const wanted = params.section ?? preferences().get().settings.lastSectionId ?? sections.value[0]?.contribution.sectionId ?? ''
  activeSectionId.value = sections.value.some((item) => item.contribution.sectionId === wanted)
    ? wanted
    : sections.value[0]?.contribution.sectionId ?? ''
}

const unsubscribeRegistry = registry().subscribe(() => {
  refreshSections()
})
onScopeDispose(unsubscribeRegistry)
refreshSections()

const unsubscribeRouter = router.subscribe(() => {
  refreshSections()
})
onScopeDispose(unsubscribeRouter)

void watch(activeSectionId, async (sectionId) => {
  if (sectionId === '') {
    return
  }
  failure.value = null
  preferences().patch({ settings: { ...preferences().get().settings, lastSectionId: sectionId } })
  if (loaded.value[sectionId] !== undefined) {
    return
  }
  const entry = sections.value.find((item) => item.contribution.sectionId === sectionId)
  if (entry === undefined) {
    failure.value = i18n.t('settings.missingSection', { sectionId })
    return
  }
  try {
    const module = await entry.contribution.component()
    loaded.value = { ...loaded.value, [sectionId]: module as Component }
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}, { immediate: true })

const activeTitle = computed(() => {
  const entry = sections.value.find((item) => item.contribution.sectionId === activeSectionId.value)
  return entry === undefined ? i18n.t('nav.settings') : i18n.t(entry.contribution.titleKey)
})

function select(sectionId: string): void {
  activeSectionId.value = sectionId
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
      <nav class="settings-nav" aria-label="settings">
        <button
          v-for="entry in sections"
          :key="entry.contribution.sectionId"
          type="button"
          class="nav-item"
          :aria-current="activeSectionId === entry.contribution.sectionId"
          @click="select(entry.contribution.sectionId)"
        >
          {{ i18n.t(entry.contribution.titleKey) }}
        </button>
      </nav>
      <div class="settings-content">
        <h2>{{ activeTitle }}</h2>
        <div v-if="failure" class="error" role="alert">
          {{ failure }}
          <button type="button" class="ghost" @click="select(activeSectionId)">{{ i18n.t('panel.retry') }}</button>
        </div>
        <component :is="loaded[activeSectionId]" v-else-if="loaded[activeSectionId]" :key="activeSectionId" />
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
  width: 200px;
  flex: 0 0 auto;
  border-right: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
}
.nav-item {
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
.settings-content { flex: 1; padding: 20px 24px; overflow: auto; }
.settings-content h2 { margin: 0 0 16px; font-size: 15px; }
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
