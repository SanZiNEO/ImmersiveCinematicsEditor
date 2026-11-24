<script setup lang="ts">
/** 高级设置里的主题 token 覆盖；默认外观页不暴露内部变量名。 */
import { computed, onScopeDispose, reactive, ref } from 'vue'

import { cssVarOf } from '../api/theme.ts'
import {
  useI18n,
  usePreferences,
  useStatus,
  useTheme,
  useThemeController,
} from '../shell/useWorkbench.ts'
import { THEME_TOKEN_ROWS, normalizeOverrideInput } from './themeTokenMeta.ts'

const i18n = useI18n()
const preferences = usePreferences()
const status = useStatus()
const theme = useTheme()
const controller = useThemeController()

const preferenceTick = ref(0)
const themeTick = ref(0)
const drafts = reactive<Record<string, string>>({})

const overrides = computed(() => {
  void preferenceTick.value
  return preferences.get().theme.overrides
})

const effectiveTokens = computed(() => {
  void themeTick.value
  return theme.tokens()
})

const overrideCount = computed(() => Object.keys(overrides.value).length)

function syncDrafts(): void {
  for (const row of THEME_TOKEN_ROWS) {
    drafts[row.token] = overrides.value[row.token] ?? ''
  }
}

syncDrafts()

const unsubscribePreferences = preferences.subscribe(() => {
  preferenceTick.value += 1
  syncDrafts()
})
onScopeDispose(unsubscribePreferences)

const unsubscribeTheme = theme.subscribe(() => {
  themeTick.value += 1
})
onScopeDispose(unsubscribeTheme)

function inputId(token: string): string {
  return `theme-token-${token.replace(/\./g, '-')}`
}

function commit(token: string): void {
  const current = overrides.value[token] ?? ''
  const next = normalizeOverrideInput(drafts[token] ?? '', effectiveTokens.value[token as keyof typeof effectiveTokens.value] ?? '')
  controller.setOverride(token, next)
  void preferences.flush()
  const applied = preferences.get().theme.overrides[token] ?? ''
  const ok = next === '' ? applied === '' : applied === next
  if (!ok) {
    status.notify(i18n.t('theme.overridesRejected'), 'warning')
  } else if (current !== applied) {
    drafts[token] = applied
  }
  syncDrafts()
}

function resetOne(token: string): void {
  drafts[token] = ''
  controller.setOverride(token, '')
  void preferences.flush()
  syncDrafts()
}

function resetAll(): void {
  controller.resetOverrides()
  void preferences.flush()
  syncDrafts()
  status.notify(i18n.t('theme.overridesResetDone'))
}
</script>

<template>
  <section class="theme-overrides" aria-labelledby="theme-token-overrides-title">
    <header class="theme-overrides__header">
      <h4 id="theme-token-overrides-title">{{ i18n.t('theme.overrides') }}</h4>
      <span v-if="overrideCount > 0" class="theme-overrides__count">
        {{ i18n.t('theme.overridesCount', { count: overrideCount }) }}
      </span>
    </header>
    <p class="hint">{{ i18n.t('theme.overridesHint') }}</p>
    <div class="theme-overrides__grid">
      <div v-for="row in THEME_TOKEN_ROWS" :key="row.token" class="theme-overrides__row">
        <label class="theme-overrides__label" :for="inputId(row.token)">
          <span>{{ i18n.t(row.labelKey) }}</span>
          <code class="theme-overrides__var" aria-hidden="true">{{ cssVarOf(row.token) }}</code>
        </label>
        <input
          :id="inputId(row.token)"
          v-model="drafts[row.token]"
          class="theme-overrides__input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :placeholder="effectiveTokens[row.token] ?? ''"
          @change="commit(row.token)"
        />
        <button
          v-if="overrides[row.token] !== undefined"
          type="button"
          class="theme-overrides__reset"
          :aria-label="i18n.t('theme.overridesResetTokenLabel', { label: i18n.t(row.labelKey) })"
          @click="resetOne(row.token)"
        >
          {{ i18n.t('theme.overridesResetToken') }}
        </button>
      </div>
    </div>
    <button
      type="button"
      class="theme-overrides__reset-all"
      :disabled="overrideCount === 0"
      @click="resetAll"
    >
      {{ i18n.t('theme.overridesResetAll') }}
    </button>
  </section>
</template>

<style scoped>
.theme-overrides {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}

.theme-overrides__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.theme-overrides h4 {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.theme-overrides__count {
  color: var(--text-muted);
  font-size: 10px;
}

.theme-overrides__grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.theme-overrides__row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(140px, 1.4fr) auto;
  align-items: center;
  gap: 8px;
}

.theme-overrides__label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: var(--text);
  font-size: 11px;
}

.theme-overrides__var {
  color: var(--text-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 9px;
}

.theme-overrides__input {
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.theme-overrides__input:focus-visible,
.theme-overrides__reset:focus-visible,
.theme-overrides__reset-all:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.theme-overrides__reset,
.theme-overrides__reset-all {
  padding: 4px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.theme-overrides__reset-all {
  align-self: flex-start;
}

.theme-overrides__reset-all:disabled {
  opacity: 0.5;
  cursor: default;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
