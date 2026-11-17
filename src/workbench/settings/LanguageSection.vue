<script setup lang="ts">
/**
 * 设置 · 语言（04-08）：`zh_cn` / `en_us` 即时切换。
 *
 * 语言存 `preferences.json`，切完立即生效（菜单/顶栏/状态区/设置页/对话框同一份 i18n）。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { Language } from '../api/preferences.ts'
import { PREFERENCES_SERVICE, STATUS_SERVICE } from '../api/tokens.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import type { StatusApi } from '../api/context.ts'
import { useI18n, useServices } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()

function preferences(): PreferencesApi {
  return services.require(PREFERENCES_SERVICE)
}

function status(): StatusApi {
  return services.require(STATUS_SERVICE)
}

// 偏好变化要重渲染：否则切到 en_us 后本页仍显示旧选中项，点“简体中文”不会触发 change。
const tick = ref(0)
const unsubscribe = preferences().subscribe(() => {
  tick.value += 1
})
onScopeDispose(unsubscribe)

const current = computed(() => {
  void tick.value
  return preferences().get().language
})

function setLanguage(language: Language): void {
  preferences().setSection('language', language)
  void preferences().flush()
  status().notify(i18n.t('language.changed', { language }))
}
</script>

<template>
  <section class="section">
    <h3>{{ i18n.t('settings.language') }}</h3>
    <p class="hint">{{ i18n.t('language.hint') }}</p>
    <label class="row">
      <input type="radio" :checked="current === 'zh_cn'" @change="setLanguage('zh_cn')" />
      <span>简体中文（zh_cn）</span>
    </label>
    <label class="row">
      <input type="radio" :checked="current === 'en_us'" @change="setLanguage('en_us')" />
      <span>English（en_us）</span>
    </label>
    <p class="hint">{{ i18n.t('language.missingKeyHint') }}</p>
  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 10px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.hint { color: var(--text-muted); margin: 0; }
.row { display: flex; align-items: center; gap: 8px; }
</style>
