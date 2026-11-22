<script setup lang="ts">
/**
 * 设置弹窗（04-08）：左侧分区导航 + 右侧内容。
 *
 * 分区来自 `settings` 贡献（核心六区 + 插件分区）；最前面额外固定一个「引导」分区，
 * 它不进 `SettingsRegistry`，也不写 `lastSectionId`。弹窗壳、遮罩、焦点与 Esc 由
 * `WorkbenchDialog` 负责，这里只做导航与懒加载。
 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'

import type { RegisteredSettingsSection } from '../api/registries.ts'
import { useI18n, usePreferences, useSettingsSections } from './useWorkbench.ts'
import WorkbenchDialog from './WorkbenchDialog.vue'
import OnboardingSection from './OnboardingSection.vue'

/** 内置引导分区 ID；不注册进 SettingsRegistry，也不持久化为 lastSectionId。 */
const ONBOARDING_SECTION_ID = 'onboarding'

const props = defineProps<{ sectionId?: string }>()
const emit = defineEmits<{ close: [] }>()

const i18n = useI18n()
const registry = useSettingsSections()
const preferences = usePreferences()

const sections = ref<RegisteredSettingsSection[]>([])
const activeSectionId = ref<string>('')
const loaded = shallowRef<Record<string, Component>>({})
const failure = ref<string | null>(null)
const attempt = ref(0)

function refreshSections(): void {
  sections.value = registry.list()
}

const unsubscribeRegistry = registry.subscribe(() => {
  refreshSections()
})
onScopeDispose(unsubscribeRegistry)
refreshSections()

function isKnownSection(sectionId: string): boolean {
  return sectionId === ONBOARDING_SECTION_ID
    || sections.value.some((entry) => entry.contribution.sectionId === sectionId)
}

function initialSection(): string {
  const wanted = props.sectionId
    ?? preferences.get().settings.lastSectionId
    ?? sections.value[0]?.contribution.sectionId
    ?? ONBOARDING_SECTION_ID
  return isKnownSection(wanted) ? wanted : ONBOARDING_SECTION_ID
}

async function loadSection(sectionId: string): Promise<void> {
  if (sectionId === '' || sectionId === ONBOARDING_SECTION_ID) {
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
}

activeSectionId.value = initialSection()

void watch(activeSectionId, async (sectionId) => {
  failure.value = null
  if (sectionId === '' || sectionId === ONBOARDING_SECTION_ID) {
    return
  }
  preferences.patch({ settings: { ...preferences.get().settings, lastSectionId: sectionId } })
  if (loaded.value[sectionId] !== undefined) {
    return
  }
  await loadSection(sectionId)
}, { immediate: true })

// 弹窗已打开时外部再次请求分区（例如再次按 Mod+,）也要跟随。
void watch(() => props.sectionId, (sectionId) => {
  if (sectionId !== undefined && sectionId !== activeSectionId.value && isKnownSection(sectionId)) {
    activeSectionId.value = sectionId
  }
})

function retry(): void {
  const sectionId = activeSectionId.value
  const next = { ...loaded.value }
  delete next[sectionId]
  loaded.value = next
  failure.value = null
  attempt.value += 1
  void loadSection(sectionId)
}

const activeTitle = computed(() => {
  if (activeSectionId.value === ONBOARDING_SECTION_ID) {
    return i18n.t('onboarding.title')
  }
  const entry = sections.value.find((item) => item.contribution.sectionId === activeSectionId.value)
  return entry === undefined ? i18n.t('nav.settings') : i18n.t(entry.contribution.titleKey)
})

function select(sectionId: string): void {
  if (sectionId === activeSectionId.value) {
    return
  }
  activeSectionId.value = sectionId
}

function close(): void {
  emit('close')
}
</script>

<template>
  <WorkbenchDialog
    :title="i18n.t('nav.settings')"
    dialog-id="settings-dialog"
    width="1040px"
    @close="close"
  >
    <div class="settings-dialog">
      <nav class="settings-dialog__nav" :aria-label="i18n.t('nav.settings')">
        <button
          type="button"
          class="nav-item"
          :aria-current="activeSectionId === 'onboarding'"
          @click="select('onboarding')"
        >
          {{ i18n.t('onboarding.title') }}
        </button>
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

      <section class="settings-dialog__content">
        <h3 class="settings-dialog__title">{{ activeTitle }}</h3>
        <OnboardingSection
          v-if="activeSectionId === 'onboarding'"
          @done="close"
        />
        <div v-else-if="failure" class="settings-dialog__error" role="alert">
          <span>{{ failure }}</span>
          <button type="button" class="ghost" @click="retry">{{ i18n.t('panel.retry') }}</button>
        </div>
        <component
          :is="loaded[activeSectionId]"
          v-else-if="loaded[activeSectionId]"
          :key="`${activeSectionId}:${attempt}`"
        />
        <p v-else class="settings-dialog__loading" role="status">{{ i18n.t('page.loading') }}</p>
      </section>
    </div>
  </WorkbenchDialog>
</template>

<style scoped>
.settings-dialog {
  display: flex;
  height: min(560px, 64vh);
  min-height: 340px;
  margin: -12px -18px;
}

.settings-dialog__nav {
  width: 208px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
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

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.nav-item[aria-current='true'] {
  background: var(--bg-selected);
  color: var(--text);
}

.nav-item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.settings-dialog__content {
  flex: 1;
  min-width: 0;
  padding: 16px 22px 22px;
  overflow: auto;
}

.settings-dialog__title {
  margin: 0 0 14px;
  font-size: 15px;
}

.settings-dialog__error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--error);
  font-size: 12px;
}

.settings-dialog__loading {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.ghost:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
