<script setup lang="ts">
/**
 * 设置 · 关于（04-08）：版本、宿主版本、日志/用户目录、复制诊断。
 *
 * 不联网、不拉取版本信息；全部取运行时真实值。
 */
import { computed } from 'vue'

import { DIAGNOSTICS_SERVICE, HOST_SERVICE } from '../api/tokens.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { HostPort } from '../api/host.ts'
import { useI18n, useServices } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()

function diagnostics(): DiagnosticSink {
  return services.require(DIAGNOSTICS_SERVICE)
}

function host(): HostPort {
  return services.require(HOST_SERVICE)
}

/** 从 UA 里取 Electron / Chromium 版本（Electron 会带 Electron/x.y.z）。 */
const versions = computed(() => {
  const ua = navigator.userAgent
  const electron = /Electron\/([\d.]+)/.exec(ua)
  const chrome = /Chrome\/([\d.]+)/.exec(ua)
  return {
    electron: electron?.[1] ?? '—',
    chromium: chrome?.[1] ?? '—',
    platform: host().platform,
  }
})

const errorCount = computed(() => {
  const items = diagnostics().list()
  return {
    total: items.length,
    errors: items.filter((item) => item.severity === 'error').length,
    warnings: items.filter((item) => item.severity === 'warning').length,
  }
})

async function copyDiagnostics(): Promise<void> {
  const text = diagnostics()
    .list()
    .map((item) => `${item.severity}\t${item.source}\t${item.pluginId ?? ''}\t${item.message}\t${item.detail ?? ''}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用时不假装成功；诊断面板有同样的复制入口。
  }
}

function revealUserData(): void {
  host().storage.revealUserData()
}
</script>

<template>
  <section class="section">
    <h3>{{ i18n.t('settings.about') }}</h3>
    <dl class="facts">
      <dt>{{ i18n.t('about.version') }}</dt><dd>0.1.0</dd>
      <dt>{{ i18n.t('about.platform') }}</dt><dd>{{ versions.platform }}</dd>
      <dt>Electron</dt><dd>{{ versions.electron }}</dd>
      <dt>Chromium</dt><dd>{{ versions.chromium }}</dd>
      <dt>{{ i18n.t('about.diagnostics') }}</dt>
      <dd>{{ i18n.t('about.diagnosticsValue', { total: errorCount.total, errors: errorCount.errors, warnings: errorCount.warnings }) }}</dd>
      <dt>{{ i18n.t('about.userData') }}</dt><dd>userData/preferences.json · layout.json · window-state.json · drafts/</dd>
    </dl>
    <div class="row">
      <button type="button" class="ghost" @click="revealUserData">{{ i18n.t('workspace.openUserData') }}</button>
      <button type="button" class="ghost" @click="copyDiagnostics">{{ i18n.t('about.copyDiagnostics') }}</button>
    </div>
  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 12px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.facts dt { color: var(--text-muted); }
.facts dd { margin: 0; color: var(--text); }
.row { display: flex; gap: 8px; }
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
</style>
