/**
 * 设置分区的“已修改”粗粒度判定。
 *
 * 只比较能稳定对应到分区的偏好，不把引导进度、上次分区或主题缓存算成修改。
 */
import type { PreferencesFile } from '../api/preferences.ts'
import { DEFAULT_PREFERENCES, DEFAULT_THEME_PREFERENCE } from '../preferences/defaults.ts'

export interface SettingsModifiedSection {
  sectionId: string
  pluginId: string
  source?: 'registry' | 'fixed'
}

export interface SettingsModifiedSnapshot {
  preferences: Readonly<PreferencesFile>
  workspacePresetId: string
}

export interface SettingsModifiedFlags {
  theme: boolean
  themeOverrides: boolean
  density: boolean
  language: boolean
  shortcuts: boolean
  settings: boolean
  workspaceLayout: boolean
  pluginIds: ReadonlySet<string>
}

export function settingsWorkspacePageId(currentPageId: string): string {
  return currentPageId === 'settings' ? 'document' : currentPageId
}

function themeChoiceSignature(theme: Readonly<PreferencesFile['theme']>): string {
  return JSON.stringify({
    mode: theme.mode,
    themeId: theme.themeId,
    system: {
      lightThemeId: theme.system.lightThemeId,
      darkThemeId: theme.system.darkThemeId,
      highContrastThemeId: theme.system.highContrastThemeId ?? null,
    },
  })
}

export function isThemeModified(preferences: Readonly<PreferencesFile>): boolean {
  return themeChoiceSignature(preferences.theme) !== themeChoiceSignature(DEFAULT_THEME_PREFERENCE)
}

export function isThemeOverridesModified(preferences: Readonly<PreferencesFile>): boolean {
  return Object.keys(preferences.theme.overrides).length > 0
}

export function isDensityModified(preferences: Readonly<PreferencesFile>): boolean {
  return preferences.density !== DEFAULT_PREFERENCES.density
}

export function isLanguageModified(preferences: Readonly<PreferencesFile>): boolean {
  return preferences.language !== DEFAULT_PREFERENCES.language
}

export function isShortcutsModified(preferences: Readonly<PreferencesFile>): boolean {
  return preferences.shortcuts.length > 0
}

export function isPreferencesSettingsModified(preferences: Readonly<PreferencesFile>): boolean {
  return (preferences.settings.showStatusBar ?? DEFAULT_PREFERENCES.settings.showStatusBar)
      !== DEFAULT_PREFERENCES.settings.showStatusBar
    || (preferences.settings.confirmOnClose ?? DEFAULT_PREFERENCES.settings.confirmOnClose)
      !== DEFAULT_PREFERENCES.settings.confirmOnClose
}

export function isPluginModified(
  preferences: Readonly<PreferencesFile>,
  pluginId: string,
): boolean {
  if (pluginId.trim().length === 0) {
    return false
  }
  const values = preferences.plugins?.[pluginId]
  return values !== undefined && Object.keys(values).length > 0
}

export function isWorkspaceLayoutModified(presetId: string): boolean {
  return presetId !== 'default'
}

export function settingsModifiedFlagsOf(snapshot: SettingsModifiedSnapshot): SettingsModifiedFlags {
  const preferences = snapshot.preferences
  const pluginIds = new Set(Object.keys(preferences.plugins ?? {}))
  return {
    theme: isThemeModified(preferences),
    themeOverrides: isThemeOverridesModified(preferences),
    density: isDensityModified(preferences),
    language: isLanguageModified(preferences),
    shortcuts: isShortcutsModified(preferences),
    settings: isPreferencesSettingsModified(preferences),
    workspaceLayout: isWorkspaceLayoutModified(snapshot.workspacePresetId),
    pluginIds,
  }
}

const CORE_SECTION_MODIFIERS: Readonly<Record<string, (flags: SettingsModifiedFlags) => boolean>> = {
  appearance: (flags) => flags.theme || flags.density,
  workspace: (flags) => flags.workspaceLayout,
  shortcuts: (flags) => flags.shortcuts,
  language: (flags) => flags.language,
  about: () => false,
  updates: () => false,
  advanced: (flags) => flags.settings || flags.themeOverrides,
}

export function isSettingsSectionModified(
  section: SettingsModifiedSection,
  snapshot: SettingsModifiedSnapshot,
): boolean {
  if (section.source === 'fixed') {
    return false
  }
  const flags = settingsModifiedFlagsOf(snapshot)
  const core = CORE_SECTION_MODIFIERS[section.sectionId]
  if (core !== undefined) {
    return core(flags)
  }
  return flags.pluginIds.has(section.pluginId)
}

export function settingsModifiedSectionIds(
  sections: readonly SettingsModifiedSection[],
  snapshot: SettingsModifiedSnapshot,
): ReadonlySet<string> {
  const flags = settingsModifiedFlagsOf(snapshot)
  const modified = new Set<string>()
  for (const section of sections) {
    if (section.source === 'fixed') {
      continue
    }
    const core = CORE_SECTION_MODIFIERS[section.sectionId]
    if ((core !== undefined && core(flags)) || (core === undefined && flags.pluginIds.has(section.pluginId))) {
      modified.add(section.sectionId)
    }
  }
  return modified
}
