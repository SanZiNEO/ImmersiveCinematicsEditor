<script setup lang="ts">
/**
 * 底部状态区汇总工作台状态和游戏预览连接。
 *
 * 条目只读；点击执行 `commandId`，不直接改文档。断连时仍然可用。
 */
import { computed, inject, onScopeDispose, ref, shallowRef } from 'vue'

import type { StatusContext } from '../api/contributions.ts'
import { PREVIEW_SERVICE } from '../api/tokens.ts'
import { PREVIEW_RENDER_STATUS_KEY, useCommands, useCurrentPageId, useDiagnostics, useDocumentSummary, useI18n, useLayout, useServices, useStatus, useStatusItems } from './useWorkbench.ts'

const i18n = useI18n()
const items = useStatusItems()
const commands = useCommands()
const services = useServices()
const layout = useLayout()
const pageId = useCurrentPageId()
const summary = useDocumentSummary()
const diagnostics = useDiagnostics()
const status = useStatus()
const preview = services.get(PREVIEW_SERVICE) ?? null
const renderStatus = inject(PREVIEW_RENDER_STATUS_KEY)
function readPreviewConnection() {
  return preview?.connection?.() ?? {
    status: preview?.connected() ? 'connected' : 'offline',
    reason: null,
  }
}

const previewConnection = shallowRef(readPreviewConnection())
const previewDetails = ref('')
let lastPreviewUpdate = 0

const tick = ref(0)
const unsubscribe = status.subscribe(() => {
  tick.value += 1
})
onScopeDispose(unsubscribe)

const transient = computed(() => {
  void tick.value
  return status.transient()
})

function context(): StatusContext {
  const current = summary.value
  return {
    pageId: pageId.value,
    t: (key, params) => i18n.t(key, params),
    documentOpen: current.docId !== null,
    documentDirty: current.dirty,
    connected: current.connected,
    issueCount: current.issueCount,
    pluginErrorCount: diagnostics.list().filter((item) => item.severity === 'error').length,
    presetId: layout.getPage(pageId.value).presetId,
  }
}

const previewText = computed(() => {
  const status = previewConnection.value.status
  if (status === 'connected') return i18n.t('status.previewGame')
  if (status === 'no-token' || status === 'reconnecting') return i18n.t('status.previewWaiting')
  if (status === 'stopped') return i18n.t('status.previewStopped')
  return i18n.t('status.previewOffline')
})

const previewSeverity = computed(() => renderStatus?.value?.severity ??
  (previewConnection.value.status === 'connected' ? 'normal' : 'warning'))

const previewLabel = computed(() =>
  [previewText.value, renderStatus?.value?.text].filter(Boolean).join(' · '))

const previewTooltip = computed(() =>
  [renderStatus?.value?.text, previewDetails.value].filter(Boolean).join(' · '))

const previewCanRetry = computed(() => {
  const status = previewConnection.value.status
  return status === 'no-token' || status === 'stopped'
})

const left = computed(() => items.list().filter((item) => item.contribution.align === 'left'))
const right = computed(() => items.list().filter((item) => item.contribution.align === 'right'))

function textOf(item: { contribution: { text?: (ctx: StatusContext) => string } }): string {
  const fn = item.contribution.text
  if (fn === undefined) {
    return ''
  }
  try {
    return fn(context())
  } catch {
    return '状态不可用'
  }
}

function severityOf(item: { contribution: { severity?: (ctx: StatusContext) => 'normal' | 'warning' | 'error' } }): string {
  const fn = item.contribution.severity
  if (fn === undefined) {
    return 'normal'
  }
  try {
    return fn(context())
  } catch {
    return 'error'
  }
}

async function activate(commandId: string | undefined): Promise<void> {
  if (commandId === undefined) {
    return
  }
  await commands.execute({ pageId: pageId.value, services }, commandId)
}

function refreshPreview(): void {
  preview?.requestRefresh()
}

function retryPreview(): void {
  preview?.retry?.()
}

function updatePreviewStatus(): void {
  if (preview === null) return
  const next = readPreviewConnection()
  const previous = previewConnection.value
  const changed = next.status !== previous.status || next.reason !== previous.reason
  if (changed) previewConnection.value = next

  const now = Date.now()
  if (!changed && now - lastPreviewUpdate < 250) return
  lastPreviewUpdate = now
  if (next.status !== 'connected') {
    previewDetails.value = next.reason ?? ''
    return
  }

  const stats = preview.stats()
  const lastFrame = preview.lastFrameAt()
  const dropped = (stats?.dropped ?? 0) + (stats?.inputDropped ?? 0) + (stats?.encoderDropped ?? 0)
  previewDetails.value = [
    stats?.encoder,
    stats?.width && stats.height ? `${stats.width}×${stats.height}` : '',
    lastFrame === null ? '' : `${i18n.t('preview.lastFrame')} ${new Date(lastFrame).toLocaleTimeString()}`,
    dropped > 0 ? `${i18n.t('preview.dropped')} ${dropped}` : '',
  ].filter(Boolean).join(' · ')
}

if (preview !== null) {
  updatePreviewStatus()
  onScopeDispose(preview.subscribe(updatePreviewStatus))
}
</script>

<template>
  <footer class="statusbar" data-focus-scope="statusbar">
    <div class="status-group">
      <button
        v-for="item in left"
        :key="item.contribution.itemId"
        type="button"
        class="status-item"
        :class="`severity-${severityOf(item)}`"
        :disabled="item.contribution.commandId === undefined"
        @click="activate(item.contribution.commandId)"
      >
        {{ textOf(item) }}
      </button>
    </div>
    <div v-if="transient" class="transient" :class="`severity-${transient.severity}`" role="status">
      {{ transient.message }}
      <button type="button" class="transient-close" :aria-label="i18n.t('common.cancel')" @click="status.clearTransient()">✕</button>
    </div>
    <div class="status-group status-right">
      <span class="status-preview" :class="`severity-${previewSeverity}`" role="status" :title="previewTooltip">
        {{ previewLabel }}
      </span>
      <button v-if="previewCanRetry" type="button" class="status-item" @click="retryPreview">
        {{ i18n.t('preview.retry') }}
      </button>
      <button v-if="preview !== null" type="button" class="status-item" @click="refreshPreview">
        {{ i18n.t('preview.refresh') }}
      </button>
      <button
        v-for="item in right"
        :key="item.contribution.itemId"
        type="button"
        class="status-item"
        :class="`severity-${severityOf(item)}`"
        :disabled="item.contribution.commandId === undefined"
        @click="activate(item.contribution.commandId)"
      >
        {{ textOf(item) }}
      </button>
    </div>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px;
  background: var(--bg-app);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
  flex: 0 0 auto;
}
.status-group { display: flex; align-items: center; gap: 2px; }
.status-right { margin-left: auto; }
.status-item {
  background: transparent;
  border: 0;
  color: inherit;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.status-item:disabled { cursor: default; }
.status-item:not(:disabled):hover { background: var(--bg-hover); color: var(--text); }
.status-preview {
  max-width: min(40vw, 480px);
  padding: 2px 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.status-item:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.severity-warning { color: var(--warning); }
.severity-error { color: var(--error); }
.transient {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 auto;
  padding: 2px 8px;
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
}
.transient-close { background: transparent; border: 0; color: var(--text-muted); cursor: pointer; }
</style>
