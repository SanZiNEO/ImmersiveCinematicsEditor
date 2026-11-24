/**
 * 设置浏览器的纯逻辑：可见级别、搜索、作用域、空态与初始分区。
 *
 * 不依赖 Vue、服务注册表或 DOM；组件与组合式只消费这里的判定结果。
 */
import {
  DEFAULT_SETTINGS_SCOPE,
  DEFAULT_SETTINGS_VISIBILITY,
  SETTINGS_SCOPES,
  SETTINGS_VISIBILITY_LEVELS,
} from '../api/contributions.ts'
import type {
  SettingsContribution,
  SettingsScope,
  SettingsVisibility,
} from '../api/contributions.ts'

export interface SettingsSectionView {
  sectionId: string
  titleKey: string
  title: string
  pluginId: string
  order: number
  visibility: SettingsVisibility
  scope: SettingsScope
  searchKeywords: readonly string[]
  source: 'registry' | 'fixed'
  load: SettingsContribution['component']
}

export interface SettingsFilterState {
  query: string
  showAdvanced: boolean
  showExperimental: boolean
  onlyModified?: boolean
}

export interface SettingsInitialSelection {
  sectionId: string
  reveal: SettingsVisibility | null
}

export type SettingsEmptyState = 'search' | 'modified' | 'noSections' | 'filtered' | null

const EMPTY_SECTION_IDS: ReadonlySet<string> = new Set<string>()

export function readSettingsVisibility(value: unknown): SettingsVisibility {
  return typeof value === 'string'
    && (SETTINGS_VISIBILITY_LEVELS as readonly string[]).includes(value)
    ? (value as SettingsVisibility)
    : DEFAULT_SETTINGS_VISIBILITY
}

export function readSettingsScope(value: unknown): SettingsScope {
  return typeof value === 'string'
    && (SETTINGS_SCOPES as readonly string[]).includes(value)
    ? (value as SettingsScope)
    : DEFAULT_SETTINGS_SCOPE
}

export function readSettingsKeywords(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function settingsMetaOf(contribution: SettingsContribution): {
  sectionId: string
  titleKey: string
  order: number
  visibility: SettingsVisibility
  scope: SettingsScope
  searchKeywords: readonly string[]
} {
  return {
    sectionId: contribution.sectionId,
    titleKey: contribution.titleKey,
    order: contribution.order,
    visibility: readSettingsVisibility(contribution.visibility),
    scope: readSettingsScope(contribution.scope),
    searchKeywords: readSettingsKeywords(contribution.searchKeywords),
  }
}

export function matchesSettingsSearch(section: SettingsSectionView, query: string): boolean {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
  if (terms.length === 0) {
    return true
  }
  const haystack = [
    section.title,
    section.titleKey,
    section.sectionId,
    section.pluginId,
    ...section.searchKeywords,
  ].join('\n').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function filterSettingsSections(
  sections: readonly SettingsSectionView[],
  state: SettingsFilterState,
  modifiedSectionIds: ReadonlySet<string> = EMPTY_SECTION_IDS,
): SettingsSectionView[] {
  const searching = state.query.trim().length > 0
  const onlyModified = state.onlyModified === true
  return sections.filter((section) => {
    if (onlyModified && !modifiedSectionIds.has(section.sectionId)) {
      return false
    }
    if (searching && !matchesSettingsSearch(section, state.query)) {
      return false
    }
    if (searching || onlyModified) {
      return true
    }
    if (section.visibility === 'standard') {
      return true
    }
    if (section.visibility === 'advanced') {
      return state.showAdvanced
    }
    return state.showExperimental
  })
}

export function hasSettingsVisibility(
  sections: readonly SettingsSectionView[],
  visibility: SettingsVisibility,
): boolean {
  return sections.some((section) => section.visibility === visibility)
}

export function resolveActiveSettingsSection(
  visibleSections: readonly SettingsSectionView[],
  selectedSectionId: string,
  fallbacks: readonly (string | undefined)[],
): string {
  const ids = new Set(visibleSections.map((section) => section.sectionId))
  if (ids.has(selectedSectionId)) {
    return selectedSectionId
  }
  for (const fallback of fallbacks) {
    if (fallback !== undefined && ids.has(fallback)) {
      return fallback
    }
  }
  return visibleSections[0]?.sectionId ?? ''
}

export function pickInitialSettingsSection(
  sections: readonly SettingsSectionView[],
  options: {
    requestedSectionId?: string
    lastSectionId?: string
  },
): SettingsInitialSelection {
  const byId = new Map(sections.map((section) => [section.sectionId, section]))
  const requested = options.requestedSectionId === undefined
    ? undefined
    : byId.get(options.requestedSectionId)
  if (requested !== undefined) {
    return {
      sectionId: requested.sectionId,
      reveal: requested.visibility === 'standard' ? null : requested.visibility,
    }
  }

  const last = options.lastSectionId === undefined ? undefined : byId.get(options.lastSectionId)
  if (last !== undefined && shouldPersistSettingsSection(last)) {
    return { sectionId: last.sectionId, reveal: null }
  }

  const firstStandard = sections.find((section) => shouldPersistSettingsSection(section))
  return {
    sectionId: firstStandard?.sectionId ?? sections[0]?.sectionId ?? '',
    reveal: null,
  }
}

export function shouldPersistSettingsSection(section: SettingsSectionView | undefined): boolean {
  return section !== undefined
    && section.source === 'registry'
    && section.visibility === 'standard'
}

export function settingsVisibilityLabelKey(visibility: SettingsVisibility): string | null {
  if (visibility === 'advanced') {
    return 'settings.advanced'
  }
  if (visibility === 'experimental') {
    return 'settings.experimental'
  }
  return null
}

export function settingsScopeLabelKey(scope: SettingsScope): string {
  return scope === 'project' ? 'settings.scope.project' : 'settings.scope.application'
}

export function settingsScopeDescriptionKey(scope: SettingsScope): string {
  return scope === 'project'
    ? 'settings.scope.projectDescription'
    : 'settings.scope.applicationDescription'
}

export function settingsEmptyStateOf(
  visibleCount: number,
  totalCount: number,
  state: Pick<SettingsFilterState, 'query' | 'onlyModified'>,
): SettingsEmptyState {
  if (visibleCount > 0) {
    return null
  }
  if (totalCount === 0) {
    return 'noSections'
  }
  if (state.query.trim().length > 0) {
    return 'search'
  }
  if (state.onlyModified === true) {
    return 'modified'
  }
  return 'filtered'
}
