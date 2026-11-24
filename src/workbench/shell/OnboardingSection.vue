<script setup lang="ts">
/**
 * 引导分区（首次启动）。
 *
 * 四步：语言 → 外观 → 工作区 → 常用操作速览。只写语言/主题偏好，不读文档、不改脚本。
 * 完成与跳过由外层 `OnboardingDialog` 记录引导状态。
 */
import { computed, onMounted, onScopeDispose, ref } from 'vue'

import type { ShellActionsPort } from '../api/actions.ts'
import type { Language } from '../api/preferences.ts'
import { SHELL_ACTIONS_SERVICE } from '../api/tokens.ts'
import { BUILTIN_THEME_IDS } from '../theme/builtinThemes.ts'
import {
  useHost,
  useI18n,
  usePreferences,
  useServices,
  useThemeController,
} from './useWorkbench.ts'

const emit = defineEmits<{
  complete: []
  skip: []
}>()

const i18n = useI18n()
const host = useHost()
const preferences = usePreferences()
const services = useServices()
const themeController = useThemeController()

const STEP_COUNT = 4
const step = ref(0)
const workspaceRoot = ref<string | null>(null)
const workspaceLoading = ref(true)
const workspaceFailed = ref(false)
const choosing = ref(false)

// 语言 / 主题是外部偏好，切换后要重渲染选中态。
const preferenceTick = ref(0)
const unsubscribePreferences = preferences.subscribe(() => {
  preferenceTick.value += 1
})
onScopeDispose(unsubscribePreferences)

const isLast = computed(() => step.value >= STEP_COUNT - 1)
const stepLabel = computed(() => i18n.t('onboarding.step', {
  current: step.value + 1,
  total: STEP_COUNT,
}))

const currentLanguage = computed<Language>(() => {
  void preferenceTick.value
  return preferences.get().language
})

const currentThemeId = computed(() => {
  void preferenceTick.value
  return preferences.get().theme.themeId
})

const followSystem = computed(() => {
  void preferenceTick.value
  return preferences.get().theme.mode === 'system'
})

const THEME_CHOICES = [
  { id: BUILTIN_THEME_IDS.dark, labelKey: 'theme.darkDefault' },
  { id: BUILTIN_THEME_IDS.light, labelKey: 'theme.lightDefault' },
  { id: BUILTIN_THEME_IDS['high-contrast'], labelKey: 'theme.highContrast' },
] as const

function setLanguage(language: Language): void {
  if (preferences.get().language === language) {
    return
  }
  preferences.setSection('language', language)
  void preferences.flush()
}

function applyTheme(themeId: string): void {
  themeController.apply(themeId)
  void preferences.flush()
}

function setFollowSystem(): void {
  themeController.setMode('system')
  void preferences.flush()
}

function actions(): ShellActionsPort {
  return services.require(SHELL_ACTIONS_SERVICE)
}

async function refreshWorkspace(): Promise<void> {
  workspaceLoading.value = true
  workspaceFailed.value = false
  try {
    workspaceRoot.value = await host.workspace.root()
  } catch {
    workspaceRoot.value = null
    workspaceFailed.value = true
  } finally {
    workspaceLoading.value = false
  }
}

onMounted(() => {
  void refreshWorkspace()
})

async function chooseWorkspace(): Promise<void> {
  if (choosing.value) {
    return
  }
  choosing.value = true
  try {
    await actions().openFolder()
    await refreshWorkspace()
  } finally {
    choosing.value = false
  }
}

function next(): void {
  if (isLast.value) {
    emit('complete')
    return
  }
  step.value += 1
}

function back(): void {
  if (step.value > 0) {
    step.value -= 1
  }
}

function skip(): void {
  emit('skip')
}
</script>

<template>
  <div class="onboarding">
    <div class="onboarding__steps" role="group" :aria-label="stepLabel">
      <span
        v-for="index in STEP_COUNT"
        :key="index"
        class="onboarding__dot"
        :class="{ 'is-active': index - 1 === step, 'is-done': index - 1 < step }"
        aria-hidden="true"
      ></span>
      <span class="onboarding__step-label">{{ stepLabel }}</span>
    </div>

    <section v-if="step === 0" class="onboarding__panel">
      <h4>{{ i18n.t('onboarding.welcomeTitle') }}</h4>
      <p>{{ i18n.t('onboarding.welcomeBody') }}</p>
      <div class="onboarding__choice-block">
        <p class="onboarding__choice-label">{{ i18n.t('onboarding.languageLabel') }}</p>
        <div class="onboarding__choices">
          <button
            type="button"
            class="choice"
            :aria-pressed="currentLanguage === 'zh_cn'"
            @click="setLanguage('zh_cn')"
          >
            简体中文
          </button>
          <button
            type="button"
            class="choice"
            :aria-pressed="currentLanguage === 'en_us'"
            @click="setLanguage('en_us')"
          >
            English
          </button>
        </div>
        <p class="onboarding__choice-hint">{{ i18n.t('onboarding.languageHint') }}</p>
      </div>
    </section>

    <section v-else-if="step === 1" class="onboarding__panel">
      <h4>{{ i18n.t('onboarding.appearanceTitle') }}</h4>
      <p>{{ i18n.t('onboarding.appearanceBody') }}</p>
      <div class="onboarding__choices">
        <button
          v-for="choice in THEME_CHOICES"
          :key="choice.id"
          type="button"
          class="choice"
          :aria-pressed="!followSystem && currentThemeId === choice.id"
          @click="applyTheme(choice.id)"
        >
          {{ i18n.t(choice.labelKey) }}
        </button>
        <button
          type="button"
          class="choice"
          :aria-pressed="followSystem"
          @click="setFollowSystem"
        >
          {{ i18n.t('theme.followSystem') }}
        </button>
      </div>
      <p class="onboarding__choice-hint">{{ i18n.t('onboarding.appearanceHint') }}</p>
    </section>

    <section v-else-if="step === 2" class="onboarding__panel">
      <h4>{{ i18n.t('onboarding.workspaceTitle') }}</h4>
      <p>{{ i18n.t('onboarding.workspaceBody') }}</p>
      <p class="onboarding__current">
        <span class="onboarding__current-label">{{ i18n.t('onboarding.workspaceCurrent') }}</span>
        <code v-if="workspaceLoading" class="onboarding__path">{{ i18n.t('onboarding.workspaceLoading') }}</code>
        <code v-else-if="workspaceRoot !== null" class="onboarding__path">{{ workspaceRoot }}</code>
        <code v-else class="onboarding__path is-empty">
          {{ workspaceFailed ? i18n.t('onboarding.workspaceUnknown') : i18n.t('onboarding.workspaceUnset') }}
        </code>
      </p>
      <div class="onboarding__row">
        <button type="button" class="primary" :disabled="choosing" @click="chooseWorkspace">
          {{ i18n.t('onboarding.workspaceChoose') }}
        </button>
        <button type="button" class="ghost" @click="next">{{ i18n.t('onboarding.workspaceSkip') }}</button>
      </div>
    </section>

    <section v-else class="onboarding__panel">
      <h4>{{ i18n.t('onboarding.shortcutsTitle') }}</h4>
      <p>{{ i18n.t('onboarding.shortcutsBody') }}</p>
      <ul class="onboarding__shortcuts">
        <li><kbd>Mod+,</kbd><span>{{ i18n.t('onboarding.shortcutSettings') }}</span></li>
        <li><kbd>Mod+Shift+P</kbd><span>{{ i18n.t('onboarding.shortcutPalette') }}</span></li>
        <li><kbd>{{ i18n.t('onboarding.shortcutProjectKey') }}</kbd><span>{{ i18n.t('onboarding.shortcutProject') }}</span></li>
      </ul>
    </section>

    <footer class="onboarding__footer">
      <button type="button" class="link" @click="skip">{{ i18n.t('onboarding.skip') }}</button>
      <div class="onboarding__actions">
        <button v-if="step > 0" type="button" class="ghost" @click="back">
          {{ i18n.t('onboarding.back') }}
        </button>
        <button type="button" class="primary" @click="next">
          {{ isLast ? i18n.t('onboarding.start') : i18n.t('onboarding.next') }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--text);
  font-size: 12px;
}

.onboarding__steps {
  display: flex;
  align-items: center;
  gap: 6px;
}

.onboarding__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
}

.onboarding__dot.is-done {
  background: var(--accent);
  opacity: 0.55;
}

.onboarding__dot.is-active {
  background: var(--accent);
}

.onboarding__step-label {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.onboarding__panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 150px;
}

.onboarding__panel h4 {
  margin: 0;
  font-size: 14px;
}

.onboarding__panel p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.onboarding__current {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.onboarding__current-label {
  color: var(--text-muted);
}

.onboarding__path {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  word-break: break-all;
}

.onboarding__path.is-empty {
  color: var(--text-muted);
}

.onboarding__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.onboarding__choice-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.onboarding__choice-label {
  margin: 0;
  color: var(--text);
  font-size: 12px;
}

.onboarding__choices {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.onboarding__choice-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.choice {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
}

.choice[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent);
}

.choice:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.onboarding__shortcuts {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.onboarding__shortcuts li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
}

.onboarding__shortcuts kbd {
  min-width: 108px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: inherit;
  font-size: 11px;
  text-align: center;
}

.onboarding__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.onboarding__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.primary,
.ghost {
  border-radius: 4px;
  font-size: 12px;
  padding: 6px 14px;
  cursor: pointer;
}

.primary {
  background: var(--accent);
  color: var(--bg-app);
  border: 1px solid var(--accent);
}

.primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.ghost {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border-strong);
}

.link {
  background: transparent;
  border: 0;
  padding: 4px 0;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.link:hover {
  color: var(--text-secondary);
}

.primary:focus-visible,
.ghost:focus-visible,
.link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
