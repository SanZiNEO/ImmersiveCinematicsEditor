<script setup lang="ts">
/**
 * 页面宿主（04-04）：按 `pageId` 解析页面组件。
 *
 * 页面组件懒加载；加载失败显示页面级错误 + 重试 + 返回项目；外壳不崩。
 */
import { ref, shallowRef, watch } from 'vue'
import type { Component, DefineComponent } from 'vue'

import { useCurrentPageId, useI18n, usePages, useRouter } from './useWorkbench.ts'

const pages = usePages()
const router = useRouter()
const i18n = useI18n()
const pageId = useCurrentPageId()

const loaded = shallowRef<Record<string, Component>>({})
const loading = ref(false)
const failure = ref<string | null>(null)
const attempt = ref(0)

void watch([pageId, attempt], async ([current]) => {
  failure.value = null
  const registered = pages.get(current)
  if (registered === undefined) {
    failure.value = i18n.t('page.missing', { pageId: current })
    return
  }
  if (loaded.value[current] !== undefined) {
    return
  }
  loading.value = true
  try {
    const module = await registered.contribution.component()
    loaded.value = { ...loaded.value, [current]: module as DefineComponent }
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}, { immediate: true })

function retry(): void {
  const current = pageId.value
  const next = { ...loaded.value }
  delete next[current]
  loaded.value = next
  attempt.value += 1
}

function backToProject(): void {
  router.reset('project')
}
</script>

<template>
  <main class="page-host" data-focus-scope="page">
    <div v-if="failure" class="page-error" role="alert">
      <h2>{{ i18n.t('page.error') }}</h2>
      <p class="detail">{{ failure }}</p>
      <div class="actions">
        <button type="button" class="ghost" @click="retry">{{ i18n.t('panel.retry') }}</button>
        <button type="button" class="ghost" @click="backToProject">{{ i18n.t('nav.project') }}</button>
      </div>
    </div>
    <div v-else-if="loading && loaded[pageId] === undefined" class="page-loading" role="status">
      {{ i18n.t('page.loading') }}
    </div>
    <component :is="loaded[pageId]" v-else-if="loaded[pageId]" :key="pageId" />
    <div v-else class="page-loading" role="status">{{ i18n.t('page.loading') }}</div>
  </main>
</template>

<style scoped>
.page-host { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg-app); }
.page-error, .page-loading {
  margin: auto;
  max-width: 520px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
}
.page-error h2 { margin: 0 0 8px; font-size: 15px; color: var(--error); }
.detail { margin: 0 0 16px; color: var(--text-secondary); font-size: 12px; white-space: pre-wrap; }
.actions { display: flex; gap: 8px; }
.ghost {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
