<script setup lang="ts">
/**
 * `demo.extra.panel`（05-13 C13）。
 *
 * 只显示真实的 pageId / documentName，用于验证「加面板只加目录 + builtin 一行」。
 * 不伪造统计、不写文档、不请求布局。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const tick = ref(0)
let unsubscribe: (() => void) | null = null

onMounted(() => {
  if (documentService !== undefined) {
    unsubscribe = documentService.subscribe(() => {
      tick.value += 1
    })
  }
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})

const summary = computed(() => {
  void tick.value
  return documentService?.summary() ?? null
})

const documentName = computed(() => {
  const current = summary.value
  if (current === null) {
    return '（文档服务不可用）'
  }
  if (current.docId === null) {
    return '（没有打开的文档）'
  }
  return current.name !== '' ? current.name : '（未命名文档）'
})
</script>

<template>
  <section class="demo-extra" aria-label="Demo 额外面板">
    <header class="demo-extra__header">
      <span class="demo-extra__badge">demo</span>
      <h2 class="demo-extra__title">额外面板</h2>
    </header>
    <p class="demo-extra__hint">
      这个面板只验证插件接线：加一个目录 + `builtin.ts` 一行即出现在右栏，可停靠、重启恢复。
    </p>

    <dl class="demo-extra__facts">
      <dt>pageId</dt>
      <dd class="demo-extra__mono">{{ ctx.pageId }}</dd>
      <dt>pluginId</dt>
      <dd class="demo-extra__mono">{{ ctx.pluginId }}</dd>
      <dt>panelId</dt>
      <dd class="demo-extra__mono">{{ ctx.panelId }}</dd>
      <dt>documentName</dt>
      <dd>{{ documentName }}</dd>
      <template v-if="summary !== null">
        <dt>docId</dt>
        <dd class="demo-extra__mono">{{ summary.docId ?? '（无）' }}</dd>
        <dt>path</dt>
        <dd class="demo-extra__mono">{{ summary.path ?? '（未落盘）' }}</dd>
        <dt>dirty</dt>
        <dd>{{ summary.dirty ? 'yes' : 'no' }}</dd>
        <dt>revision</dt>
        <dd>{{ summary.revision }}</dd>
      </template>
    </dl>

    <p v-if="documentService === undefined" class="demo-extra__error" role="alert">
      文档服务不可用：只显示面板身份，不伪造文档名。
    </p>
  </section>
</template>

<style scoped>
.demo-extra {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px;
  overflow: auto;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.demo-extra__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.demo-extra__badge {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-extra__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.demo-extra__hint {
  margin: 0;
  color: var(--text-secondary);
}

.demo-extra__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 12px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.demo-extra__facts dt {
  color: var(--text-muted);
}

.demo-extra__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.demo-extra__mono {
  font-family: var(--font-mono, monospace);
}

.demo-extra__error {
  margin: 0;
  color: var(--error);
}
</style>
