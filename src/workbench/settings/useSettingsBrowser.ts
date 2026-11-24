/**
 * 设置浏览器：注册表 + 当前语言 + 偏好 + 布局组合成两个设置 surface 共用的状态。
 */
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { SettingsVisibility } from '../api/contributions.ts'
import {
  useCurrentPageId,
  useI18n,
  useLayout,
  useLayoutTick,
  usePreferences,
  useSettingsSections,
} from '../shell/useWorkbench.ts'
import { settingsModifiedSectionIds, settingsWorkspacePageId } from './settingsModified.ts'
import {
  filterSettingsSections,
  hasSettingsVisibility,
  pickInitialSettingsSection,
  resolveActiveSettingsSection,
  settingsEmptyStateOf,
  settingsMetaOf,
  shouldPersistSettingsSection,
} from './settingsVisibility.ts'
import type {
  SettingsEmptyState,
  SettingsSectionView,
} from './settingsVisibility.ts'

export interface UseSettingsBrowserOptions {
  requestedSectionId?: () => string | undefined
}

export interface SettingsBrowser {
  sections: ComputedRef<SettingsSectionView[]>
  visibleSections: ComputedRef<SettingsSectionView[]>
  activeSectionId: ComputedRef<string>
  activeSection: ComputedRef<SettingsSectionView | undefined>
  query: Ref<string>
  showAdvanced: Ref<boolean>
  showExperimental: Ref<boolean>
  onlyModified: Ref<boolean>
  hasExperimental: ComputedRef<boolean>
  isSearching: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  emptyState: ComputedRef<SettingsEmptyState>
  modifiedCount: ComputedRef<number>
  isSectionModified(sectionId: string): boolean
  selectSection(sectionId: string): void
  requestSection(sectionId: string | undefined): boolean
  setOnlyModified(value: boolean): void
  showAllSections(): void
  clearSearch(): void
}

export function useSettingsBrowser(options: UseSettingsBrowserOptions = {}): SettingsBrowser {
  const registry = useSettingsSections()
  const preferences = usePreferences()
  const i18n = useI18n()
  const layout = useLayout()
  const currentPageId = useCurrentPageId()
  const layoutTick = useLayoutTick()

  const registryTick = ref(0)
  const unsubscribeRegistry = registry.subscribe(() => {
    registryTick.value += 1
  })
  onScopeDispose(unsubscribeRegistry)

  const preferencesTick = ref(0)
  const unsubscribePreferences = preferences.subscribe(() => {
    preferencesTick.value += 1
  })
  onScopeDispose(unsubscribePreferences)

  const sections = computed<SettingsSectionView[]>(() => {
    void registryTick.value
    return registry.list().map((entry) => {
      const meta = settingsMetaOf(entry.contribution)
      return {
        ...meta,
        title: i18n.t(meta.titleKey),
        pluginId: entry.pluginId,
        source: 'registry' as const,
        load: entry.contribution.component,
      }
    })
  })

  const lastSectionId = ref<string | undefined>(preferences.get().settings.lastSectionId)
  const initial = pickInitialSettingsSection(sections.value, {
    requestedSectionId: options.requestedSectionId?.(),
    lastSectionId: lastSectionId.value,
  })
  const selectedSectionId = ref(initial.sectionId)
  const query = ref('')
  const showAdvanced = ref(initial.reveal === 'advanced')
  const showExperimental = ref(initial.reveal === 'experimental')
  const onlyModified = ref(false)

  function persistSection(sectionId: string): void {
    const section = sections.value.find((entry) => entry.sectionId === sectionId)
    if (!shouldPersistSettingsSection(section)) {
      return
    }
    lastSectionId.value = sectionId
    const current = preferences.get().settings
    if (current.lastSectionId === sectionId) {
      return
    }
    preferences.patch({
      settings: {
        ...current,
        lastSectionId: sectionId,
      },
    })
  }

  persistSection(initial.sectionId)

  const modifiedSnapshot = computed(() => {
    void preferencesTick.value
    void layoutTick.value
    const pageId = settingsWorkspacePageId(currentPageId.value)
    return {
      preferences: preferences.get(),
      workspacePresetId: layout.getPage(pageId).presetId,
    }
  })

  const modifiedSectionIds = computed(() => settingsModifiedSectionIds(sections.value, modifiedSnapshot.value))

  const filterState = computed(() => ({
    query: query.value,
    showAdvanced: showAdvanced.value,
    showExperimental: showExperimental.value,
    onlyModified: onlyModified.value,
  }))

  const visibleSections = computed(() =>
    filterSettingsSections(sections.value, filterState.value, modifiedSectionIds.value),
  )

  const activeSectionId = computed(() =>
    resolveActiveSettingsSection(visibleSections.value, selectedSectionId.value, [lastSectionId.value]),
  )

  const activeSection = computed(() =>
    sections.value.find((section) => section.sectionId === activeSectionId.value),
  )

  const hasExperimental = computed(() => hasSettingsVisibility(sections.value, 'experimental'))
  const isSearching = computed(() => query.value.trim().length > 0)
  const isEmpty = computed(() => visibleSections.value.length === 0)
  const emptyState = computed(() =>
    settingsEmptyStateOf(visibleSections.value.length, sections.value.length, filterState.value),
  )
  const modifiedCount = computed(() => modifiedSectionIds.value.size)

  function isSectionModified(sectionId: string): boolean {
    return modifiedSectionIds.value.has(sectionId)
  }

  function selectSection(sectionId: string): void {
    if (!visibleSections.value.some((section) => section.sectionId === sectionId)) {
      return
    }
    selectedSectionId.value = sectionId
    persistSection(sectionId)
  }

  function requestSection(sectionId: string | undefined): boolean {
    if (sectionId === undefined) {
      return false
    }
    const section = sections.value.find((entry) => entry.sectionId === sectionId)
    if (section === undefined) {
      return false
    }
    query.value = ''
    onlyModified.value = false
    if (section.visibility === 'advanced') {
      showAdvanced.value = true
    }
    if (section.visibility === 'experimental') {
      showExperimental.value = true
    }
    selectedSectionId.value = section.sectionId
    persistSection(section.sectionId)
    return true
  }

  function setOnlyModified(value: boolean): void {
    onlyModified.value = value
  }

  function showAllSections(): void {
    query.value = ''
    onlyModified.value = false
  }

  function clearSearch(): void {
    query.value = ''
  }

  watch(
    () => options.requestedSectionId?.(),
    (sectionId, previous) => {
      if (sectionId !== undefined && sectionId !== previous) {
        requestSection(sectionId)
      }
    },
  )

  return {
    sections,
    visibleSections,
    activeSectionId,
    activeSection,
    query,
    showAdvanced,
    showExperimental,
    onlyModified,
    hasExperimental,
    isSearching,
    isEmpty,
    emptyState,
    modifiedCount,
    isSectionModified,
    selectSection,
    requestSection,
    setOnlyModified,
    showAllSections,
    clearSearch,
  }
}
