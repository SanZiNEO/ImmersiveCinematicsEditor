<script setup lang="ts">
/**
 * 设置 · 外观（04-07 / 04-08）。
 *
 * 主题选择（按 appearance 分组）、跟随系统三槽位、导入本地主题、密度。
 * 主题是数据：这里只调 `ThemeControllerPort`，不拼 CSS。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { ThemeAppearance, ThemeSummary } from '../api/theme.ts'
import type { Density } from '../api/preferences.ts'
import { FILE_DIALOG_PORT, PREFERENCES_SERVICE } from '../api/tokens.ts'
import type { FileDialogPort } from '../api/host.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import { useI18n, usePreferences, useServices, useStatus, useThemeController, useThemeRegistry } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()
const status = useStatus()
const controller = useThemeController()
const registry = useThemeRegistry()
const preferences = usePreferences()

const tick = ref(0)
const unsubscribe = registry.subscribe(() => {
  tick.value += 1
})
onScopeDispose(unsubscribe)

const previewTick = ref(0)
const unsubscribeTheme = controller.preference().mode === 'system' ? () => undefined : () => undefined
void unsubscribeTheme
onScopeDispose(() => {
  previewTick.value += 1
})

function dialogs(): FileDialogPort {
  return services.require(FILE_DIALOG_PORT)
}

function preferenceFile(): PreferencesApi {
  return preferences
}

const themes = computed<ThemeSummary[]>(() => {
  void tick.value
  return registry.list()
})

const grouped = computed<Array<{ appearance: ThemeAppearance; items: ThemeSummary[] }>>(() => {
  const groups: Array<{ appearance: ThemeAppearance; items: ThemeSummary[] }> = []
  for (const theme of themes.value) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.appearance === theme.appearance) {
      last.items.push(theme)
    } else {
      groups.push({ appearance: theme.appearance, items: [theme] })
    }
  }
  return groups
})

const activeId = computed(() => preferenceFile().get().theme.themeId)
const followSystem = computed(() => preferenceFile().get().theme.mode === 'system')
const slots = computed(() => preferenceFile().get().theme.system)
const density = computed(() => preferenceFile().get().density)

/** 主题显示名：有 labelKey 走 i18n（04-07），否则用定义里的 label。 */
function labelOf(theme: ThemeSummary): string {
  return theme.labelKey === undefined || theme.labelKey.length === 0 ? theme.label : i18n.t(theme.labelKey)
}

function appearanceLabel(appearance: ThemeAppearance): string {
  if (appearance === 'dark') {
    return i18n.t('theme.darkDefault')
  }
  if (appearance === 'light') {
    return i18n.t('theme.lightDefault')
  }
  return i18n.t('theme.highContrast')
}

function apply(themeId: string): void {
  controller.apply(themeId)
  void preferenceFile().flush()
}

function toggleFollowSystem(): void {
  controller.setMode(followSystem.value ? 'manual' : 'system')
  void preferenceFile().flush()
}

function setSlot(slot: 'lightThemeId' | 'darkThemeId' | 'highContrastThemeId', themeId: string): void {
  controller.setSystemSlots({ [slot]: themeId })
  void preferenceFile().flush()
}

function slotOptions(appearance: ThemeAppearance): ThemeSummary[] {
  return themes.value.filter((theme) => theme.appearance === appearance)
}

async function importTheme(): Promise<void> {
  const path = await dialogs().importTheme()
  if (path === null) {
    return
  }
  const text = await dialogs().readText(path)
  if (text === null) {
    status.notify(i18n.t('theme.importFailed'), 'error')
    return
  }
  try {
    const parsed = JSON.parse(text) as unknown
    const theme = registry.importUserTheme(parsed)
    await services.require(PREFERENCES_SERVICE).flush()
    status.notify(i18n.t('theme.imported', { label: theme.label }))
    apply(theme.id)
  } catch (error) {
    status.notify(error instanceof Error ? error.message : String(error), 'error')
  }
}

function removeUserTheme(themeId: string): void {
  registry.removeUserTheme(themeId)
  void preferenceFile().flush()
}

function setDensity(next: Density): void {
  preferenceFile().setSection('density', next)
  void preferenceFile().flush()
}

function resetAppearance(): void {
  controller.setMode('manual')
  controller.setTheme('workbench.dark-default')
  controller.resetOverrides()
  preferenceFile().setSection('density', 'comfortable')
  void preferenceFile().flush()
  status.notify(i18n.t('theme.resetDone'))
}

</script>

<template>
  <section class="section">
    <h3>{{ i18n.t('settings.appearance') }}</h3>

    <label class="toggle">
      <input type="checkbox" :checked="followSystem" @change="toggleFollowSystem" />
      <span>{{ i18n.t('theme.followSystem') }}</span>
    </label>

    <div v-if="followSystem" class="slots">
      <label class="slot">
        <span>{{ i18n.t('theme.slotLight') }}</span>
        <select :value="slots.lightThemeId" @change="setSlot('lightThemeId', ($event.target as HTMLSelectElement).value)">
          <option v-for="theme in slotOptions('light')" :key="theme.id" :value="theme.id">{{ labelOf(theme) }}</option>
        </select>
      </label>
      <label class="slot">
        <span>{{ i18n.t('theme.slotDark') }}</span>
        <select :value="slots.darkThemeId" @change="setSlot('darkThemeId', ($event.target as HTMLSelectElement).value)">
          <option v-for="theme in slotOptions('dark')" :key="theme.id" :value="theme.id">{{ labelOf(theme) }}</option>
        </select>
      </label>
      <label class="slot">
        <span>{{ i18n.t('theme.slotHighContrast') }}</span>
        <select
          :value="slots.highContrastThemeId ?? ''"
          @change="setSlot('highContrastThemeId', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ i18n.t('theme.slotNone') }}</option>
          <option v-for="theme in slotOptions('high-contrast')" :key="theme.id" :value="theme.id">{{ labelOf(theme) }}</option>
        </select>
      </label>
    </div>

    <div v-for="group in grouped" :key="group.appearance" class="theme-group">
      <div class="group-label">{{ appearanceLabel(group.appearance) }}</div>
      <div class="theme-list">
        <button
          v-for="theme in group.items"
          :key="theme.id"
          type="button"
          class="theme-card"
          :class="{ active: theme.id === activeId }"
          :aria-pressed="theme.id === activeId"
          @click="apply(theme.id)"
        >
          <span class="swatches" aria-hidden="true">
            <span class="swatch" :style="{ background: theme.preview.bg }" />
            <span class="swatch" :style="{ background: theme.preview.panel }" />
            <span class="swatch" :style="{ background: theme.preview.text }" />
            <span class="swatch" :style="{ background: theme.preview.accent }" />
          </span>
          <span class="theme-label">{{ labelOf(theme) }}</span>
          <span class="theme-source">{{ i18n.t(`theme.source.${theme.source}`) }}</span>
          <span v-if="theme.source === 'user'" class="remove" role="button" tabindex="0" @click.stop="removeUserTheme(theme.id)">
            {{ i18n.t('project.remove') }}
          </span>
        </button>
      </div>
    </div>

    <div class="row">
      <button type="button" class="ghost" @click="importTheme">{{ i18n.t('theme.import') }}</button>
      <button type="button" class="ghost" @click="resetAppearance">{{ i18n.t('theme.reset') }}</button>
    </div>

    <h4>{{ i18n.t('settings.density') }}</h4>
    <div class="row">
      <label class="radio"><input type="radio" :checked="density === 'comfortable'" @change="setDensity('comfortable')" /> {{ i18n.t('settings.densityComfortable') }}</label>
      <label class="radio"><input type="radio" :checked="density === 'compact'" @change="setDensity('compact')" /> {{ i18n.t('settings.densityCompact') }}</label>
    </div>

  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 12px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.section h4 { margin: 12px 0 0; font-size: 12px; color: var(--text-secondary); }
.toggle { display: flex; align-items: center; gap: 8px; }
.slots { display: flex; gap: 12px; flex-wrap: wrap; }
.slot { display: flex; flex-direction: column; gap: 4px; }
.slot select {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
}
.theme-group { display: flex; flex-direction: column; gap: 6px; }
.group-label { color: var(--text-muted); font-size: 11px; }
.theme-list { display: flex; flex-wrap: wrap; gap: 8px; }
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 150px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.theme-card.active { border-color: var(--accent); }
.theme-card:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.swatches { display: flex; gap: 2px; }
.swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid var(--border); }
.theme-label { font-weight: 600; }
.theme-source { color: var(--text-muted); font-size: 11px; }
.remove { color: var(--error); font-size: 11px; }
.row { display: flex; align-items: center; gap: 10px; }
.ghost {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.radio { display: flex; align-items: center; gap: 6px; }
</style>
