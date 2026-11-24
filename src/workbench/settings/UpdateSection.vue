<script setup lang="ts">
/**
 * 设置 · 更新（03-05）。
 *
 * 只显示真实状态：版本走 `updates.version()`（复用 `app:version`），
 * 状态只认 `UpdateState` 八态（03-03 契约）。没有 Release 时 `up-to-date` 是正常结果，
 * 不渲染成失败；浏览器 / 未打包宿主为 `unavailable`，按钮禁用并说明。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { HOST_SERVICE } from '../api/tokens.ts'
import type { HostPort } from '../api/host.ts'
import type { UpdateState } from '../api/updates.ts'
import { useI18n, useServices } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()
const host = (): HostPort => services.require(HOST_SERVICE)

/** 版本只来自 `app:version`；取不到显示 `—`，不回退硬编码。 */
const version = ref('—')
const state = ref<UpdateState>({ status: 'idle' })
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  try {
    version.value = await host().updates.version()
  } catch {
    version.value = '—'
  }
  unsubscribe = host().updates.onState((next) => {
    state.value = next
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})

const checking = computed(() => state.value.status === 'checking')
const downloaded = computed(() => state.value.status === 'downloaded')
const unavailable = computed(() => state.value.status === 'unavailable')
const canAct = computed(() => !checking.value && !unavailable.value)

const checkedAt = computed(() => {
  const current = state.value
  if (current.status !== 'up-to-date') return i18n.t('updates.never')
  const at = new Date(current.checkedAt)
  return Number.isNaN(at.getTime()) ? i18n.t('updates.never') : at.toLocaleString()
})

const statusText = computed(() => {
  const current = state.value
  switch (current.status) {
    case 'idle':
      return i18n.t('updates.idle')
    case 'checking':
      return i18n.t('updates.checking')
    case 'up-to-date':
      return i18n.t('updates.upToDate')
    case 'available':
      return i18n.t('updates.available', { version: current.version })
    case 'downloading':
      return i18n.t('updates.downloading', { percent: Math.round(current.percent) })
    case 'downloaded':
      return i18n.t('updates.downloaded', { version: current.version })
    case 'error':
      return i18n.t('updates.error', { reason: current.reason })
    case 'unavailable':
      return i18n.t('updates.unavailable')
  }
})

const statusTone = computed(() => {
  if (state.value.status === 'error') return 'error'
  if (state.value.status === 'downloaded' || state.value.status === 'available') return 'ready'
  return 'muted'
})

const errorCode = computed(() => (state.value.status === 'error' ? state.value.code ?? '' : ''))
const errorReason = computed(() => (state.value.status === 'error' ? state.value.reason : ''))

const primaryLabel = computed(() => {
  if (downloaded.value) return i18n.t('updates.restart')
  if (checking.value) return i18n.t('updates.checking')
  return i18n.t('updates.check')
})

const installNote = ref('')

async function onPrimary(): Promise<void> {
  if (!canAct.value) return
  installNote.value = ''
  if (downloaded.value) {
    // 主进程会先走现有的未保存守卫（close 流程）；取消则不安装。
    const result = await host().updates.install()
    if (!result.ok && result.reason !== undefined && result.reason !== 'not-downloaded') {
      installNote.value = result.reason
    }
    return
  }
  await host().updates.check()
}
</script>

<template>
  <section class="section">
    <h3>{{ i18n.t('settings.updates') }}</h3>
    <dl class="facts">
      <dt>{{ i18n.t('updates.currentVersion') }}</dt>
      <dd>{{ version }}</dd>
      <dt>{{ i18n.t('updates.lastChecked') }}</dt>
      <dd>{{ checkedAt }}</dd>
      <dt>{{ i18n.t('updates.status') }}</dt>
      <dd class="status" :data-tone="statusTone" data-update-status>{{ statusText }}</dd>
    </dl>
    <div class="row">
      <button
        type="button"
        class="primary"
        :disabled="!canAct"
        :data-action="downloaded ? 'install' : 'check'"
        @click="onPrimary"
      >
        {{ primaryLabel }}
      </button>
      <span v-if="unavailable" class="hint">{{ i18n.t('updates.unavailableHint') }}</span>
    </div>
    <p v-if="state.status === 'error'" class="error" role="alert">
      {{ errorReason }}<span v-if="errorCode" class="code"> · {{ errorCode }}</span>
      <br />
      <span class="hint">{{ i18n.t('updates.logPath') }}</span>
    </p>
    <p v-if="state.status === 'up-to-date'" class="hint">{{ i18n.t('updates.upToDateHint') }}</p>
    <p v-if="installNote !== ''" class="hint">{{ i18n.t('updates.installBlocked', { reason: installNote }) }}</p>
  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 12px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.facts dt { color: var(--text-muted); }
.facts dd { margin: 0; color: var(--text); }
.status[data-tone='error'] { color: var(--error); }
.status[data-tone='ready'] { color: var(--text); font-weight: 600; }
.status[data-tone='muted'] { color: var(--text-secondary); }
.row { display: flex; align-items: center; gap: 10px; }
.primary {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.primary:disabled { opacity: 0.55; cursor: default; }
.primary:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.hint { color: var(--text-muted); }
.error { margin: 0; color: var(--error); }
.code { color: var(--text-muted); }
</style>
