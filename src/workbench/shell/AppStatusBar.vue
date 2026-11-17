<script setup lang="ts">
/**
 * 状态区（04-04）：只渲染 `statusItem` 贡献。
 *
 * 条目只读；点击执行 `commandId`，不直接改文档。断连时仍然可用。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { StatusContext } from '../api/contributions.ts'
import { useCommands, useCurrentPageId, useDiagnostics, useDocumentSummary, useI18n, useLayout, useServices, useStatus, useStatusItems } from './useWorkbench.ts'

const i18n = useI18n()
const items = useStatusItems()
const commands = useCommands()
const services = useServices()
const layout = useLayout()
const pageId = useCurrentPageId()
const summary = useDocumentSummary()
const diagnostics = useDiagnostics()
const status = useStatus()

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
