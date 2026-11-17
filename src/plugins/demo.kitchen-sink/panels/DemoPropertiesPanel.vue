<script setup lang="ts">
/**
 * `demo.panel.properties`（04-05 双宿主合同演示）。
 *
 * 显示 03 主选区快照、批选、修订号，并提供「定位到效果面板」的请求入口。
 * 不显示真实属性表（05/06 的 `selection.properties` 才负责），也不持第二份选区。
 */
import { computed, ref, watch } from 'vue'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { useDemoRevision } from '../state.ts'

const ctx = usePanelContext()
const revision = useDemoRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const selectionFields = computed<Array<{ label: string; value: string }>>(() => {
  void revision.value
  const selection = ctx.selection
  const fields: Array<{ label: string; value: string }> = [
    { label: 'domain', value: selection.domain },
  ]
  if (selection.clipKey !== undefined) {
    fields.push({ label: 'clipKey', value: selection.clipKey })
  }
  if (selection.objectPath !== undefined) {
    fields.push({ label: 'objectPath', value: selection.objectPath })
  }
  if (selection.keyframeTime !== undefined) {
    fields.push({ label: 'keyframeTime', value: String(selection.keyframeTime) })
  }
  if (selection.pathId !== undefined) {
    fields.push({ label: 'pathId', value: selection.pathId })
  }
  if (selection.ruleId !== undefined) {
    fields.push({ label: 'ruleId', value: selection.ruleId })
  }
  if (selection.bindingId !== undefined) {
    fields.push({ label: 'bindingId', value: selection.bindingId })
  }
  return fields
})

const summary = computed(() => {
  void revision.value
  const selection = ctx.selection
  if (selection.domain === 'none') {
    return '没有选中片段（none）。'
  }
  if (selection.clipKey === undefined) {
    return `当前选择域：${selection.domain}（不属于片段）。`
  }
  return `片段 ${selection.clipKey}${
    selection.objectPath === undefined ? '' : ` / ${selection.objectPath}`
  }`
})

/** 定位目标只在有片段键时可用；objectPath 缺省为空串（片段级定位，不伪造属性路径）。 */
const revealTarget = computed(() => {
  void revision.value
  const selection = ctx.selection
  if (selection.clipKey === undefined) {
    return null
  }
  return {
    clipKey: selection.clipKey,
    objectPath: selection.objectPath ?? '',
    ...(selection.keyframeTime === undefined ? {} : { time: selection.keyframeTime }),
  }
})

const lastResult = ref('尚未请求定位。')

/** 文档切换时清掉上一次定位提示，避免把上一份文档的键留在面板里。 */
const documentId = computed<string | null>(() => {
  void revision.value
  return documentService?.summary().docId ?? null
})

watch(documentId, () => {
  lastResult.value = '尚未请求定位。'
})

function revealInEffectControls(): void {
  const target = revealTarget.value
  if (target === null) {
    lastResult.value = '当前选区没有片段键，无法定位。'
    return
  }
  ctx.requestRevealInEffectControls(target)
  lastResult.value = `已请求定位：${target.clipKey}${
    target.objectPath === '' ? '（片段级）' : ` / ${target.objectPath}`
  }`
}
</script>

<template>
  <section class="demo-panel" aria-label="Demo 属性槽（宿主合同）">
    <header class="demo-panel__header">
      <span class="demo-badge">demo</span>
      <h2 class="demo-panel__title">属性槽 · 宿主合同</h2>
    </header>
    <p class="demo-panel__hint">
      只显示 03 选区快照与修订号；真实属性表由 05/06 的 selection.properties 提供。
    </p>

    <div class="demo-block">
      <h3 class="demo-block__title">主选区</h3>
      <p class="demo-block__line">{{ summary }}</p>
      <dl class="demo-facts">
        <template v-for="field in selectionFields" :key="field.label">
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value }}</dd>
        </template>
        <dt>clipKeys</dt>
        <dd>{{ ctx.clipKeys.length === 0 ? '（空）' : ctx.clipKeys.join(', ') }}</dd>
        <dt>docRevision</dt>
        <dd>{{ ctx.docRevision }}</dd>
        <dt>canUndo / canRedo</dt>
        <dd>{{ ctx.commands.canUndo ? 'yes' : 'no' }} / {{ ctx.commands.canRedo ? 'yes' : 'no' }}</dd>
        <dt>dirty</dt>
        <dd>{{ ctx.commands.dirty ? 'yes' : 'no' }}</dd>
      </dl>
    </div>

    <div class="demo-actions">
      <button type="button" :disabled="revealTarget === null" @click="revealInEffectControls">
        定位到效果面板
      </button>
    </div>

    <p class="demo-result" role="status" aria-live="polite">{{ lastResult }}</p>
  </section>
</template>

<style scoped>
.demo-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px;
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

.demo-panel__hint {
  margin: 0;
  color: var(--text-secondary);
}

.demo-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.demo-block__title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.demo-block__line {
  margin: 0;
  overflow-wrap: anywhere;
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

.demo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.demo-actions button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.demo-actions button:hover:enabled {
  background: var(--bg-hover);
}

.demo-actions button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.demo-actions button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.demo-result {
  margin: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
</style>
