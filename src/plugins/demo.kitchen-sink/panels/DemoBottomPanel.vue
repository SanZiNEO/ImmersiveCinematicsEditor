<script setup lang="ts">
/**
 * `demo.panel.bottom`（04-05 / 04-02）。
 *
 * 只显示文档摘要（片段数 / 修订号 / 脏标记），用于验证面板能停靠在 `document.bottom`。
 * 不显示时间轴内容，也不提供编辑控件。
 */
import { computed } from 'vue'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { useDemoRevision } from '../state.ts'

const ctx = usePanelContext()
const revision = useDemoRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const clipCount = computed(() => {
  void revision.value
  return documentService?.clips().length ?? 0
})
</script>

<template>
  <section class="demo-panel" aria-label="Demo 底部槽（宿主合同）">
    <header class="demo-panel__header">
      <span class="demo-badge">demo</span>
      <h2 class="demo-panel__title">底部槽 · 文档摘要</h2>
    </header>
    <dl class="demo-facts">
      <dt>片段数</dt>
      <dd>{{ clipCount }}</dd>
      <dt>修订号</dt>
      <dd>{{ ctx.docRevision }}</dd>
      <dt>脏标记</dt>
      <dd>{{ ctx.commands.dirty ? 'dirty' : 'clean' }}</dd>
    </dl>
    <p class="demo-panel__hint">
      底部面板只证明布局可停靠；时间轴与轨道内容不在 04 范围。
    </p>
  </section>
</template>

<style scoped>
.demo-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 8px 12px;
  overflow: auto;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.demo-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.demo-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.demo-badge {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 10px;
  margin: 0;
  color: var(--text-secondary);
}

.demo-facts dt {
  color: var(--text-muted);
}

.demo-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.demo-panel__hint {
  margin: 0;
  color: var(--text-muted);
}
</style>
