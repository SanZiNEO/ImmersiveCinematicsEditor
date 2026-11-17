<script setup lang="ts">
/**
 * `demo.panel.effects`（04-05 双宿主合同演示）。
 *
 * 不显示任何真实效果字段：只显示宿主四态、选区摘要和驱动真实文档命令的按钮。
 * 所有数据来自 `PanelContext`（选区/批选/修订号/命令面），不 import 文档 store。
 */
import { computed, ref, watch } from 'vue'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import type { ClipListEntry } from '../../../workbench/api/documents.ts'
import { DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { useDemoRevision } from '../state.ts'

const ctx = usePanelContext()
const revision = useDemoRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)

const clips = computed<ClipListEntry[]>(() => {
  void revision.value
  return documentService?.clips() ?? []
})

const clipKeySet = computed(() => new Set(clips.value.map((entry) => entry.clipKey)))

/**
 * 四态（`foreign` 是四态之外的显式域）直接取宿主的唯一判定，
 * 不在面板里复制失效记录/存活判定规则；面板只负责显示。
 */
const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})

const stateLabel = computed(() => {
  switch (state.value.kind) {
    case 'none':
      return 'none（无选择）'
    case 'multi':
      return 'multi（多选）'
    case 'clip':
      return 'clip（单片段）'
    case 'invalid':
      return 'invalid（选区失效）'
    case 'foreign':
      return `foreign（${state.value.domain} 域）`
  }
})

const stateDetail = computed(() => {
  const current = state.value
  switch (current.kind) {
    case 'none':
      return '没有选中片段；空态不自动选第一个片段。'
    case 'multi':
      return `批选 ${current.clipKeys.length} 个片段；不合并、不取第一个。`
    case 'clip':
      return `domain=${current.selection.domain}；clipKey=${current.clipKey}${
        current.selection.objectPath === undefined ? '' : `；objectPath=${current.selection.objectPath}`
      }`
    case 'invalid':
      return current.reason
    case 'foreign':
      return '当前选择属于路径/规则/绑定域，不属于片段效果控件。'
  }
})

/** 可删除的片段：clip 态取主选区，multi 态取全部仍存在的批选。 */
const deletableKeys = computed<string[]>(() => {
  const current = state.value
  if (current.kind === 'clip') {
    return [current.clipKey]
  }
  if (current.kind === 'multi') {
    return current.clipKeys.filter((key) => clipKeySet.value.has(key))
  }
  return []
})

const lastResult = ref('尚未执行操作。')

/** 文档切换时清掉上一次操作的提示，避免把上一份文档的键留在面板里。 */
const documentId = computed<string | null>(() => {
  void revision.value
  return documentService?.summary().docId ?? null
})

watch(documentId, () => {
  lastResult.value = '尚未执行操作。'
})

function selectFirst(): void {
  const first = clips.value[0]
  if (first === undefined) {
    lastResult.value = '当前文档没有片段。'
    return
  }
  ctx.requestSelect({ domain: 'clip', clipKey: first.clipKey })
  lastResult.value = `已请求选中第一个片段：${first.clipKey}`
}

function selectAll(): void {
  const keys = clips.value.map((entry) => entry.clipKey)
  if (keys.length === 0) {
    lastResult.value = '当前文档没有片段。'
    return
  }
  ctx.commands.selectMany(keys)
  lastResult.value = `已批选 ${keys.length} 个片段。`
}

function clearSelection(): void {
  ctx.commands.selectMany([])
  lastResult.value = '已清空主选区与批选。'
}

function removeSelected(): void {
  const keys = deletableKeys.value
  if (keys.length === 0) {
    lastResult.value = '当前没有可删除的选中片段。'
    return
  }
  let removed = 0
  const failures: string[] = []
  for (const clipKey of keys) {
    const outcome = ctx.commands.commit({ kind: 'clip.remove', clipKey })
    if (outcome.ok) {
      removed += 1
    } else {
      failures.push(outcome.error ?? `${clipKey} 删除被拒绝`)
    }
  }
  lastResult.value =
    failures.length === 0
      ? `已删除 ${removed} 个选中片段。`
      : `删除 ${removed} 个；失败：${failures.join('；')}`
}
</script>

<template>
  <section class="demo-panel" aria-label="Demo 效果槽（宿主合同）">
    <header class="demo-panel__header">
      <span class="demo-badge">demo</span>
      <h2 class="demo-panel__title">效果槽 · 宿主合同</h2>
    </header>
    <p class="demo-panel__hint">
      只演示选区四态与文档命令；不显示真实业务字段（05+ 的业务面板才负责内容）。
    </p>

    <div class="demo-state" :data-kind="state.kind" role="status" aria-live="polite">
      <strong class="demo-state__label">{{ stateLabel }}</strong>
      <p class="demo-state__detail">{{ stateDetail }}</p>
      <dl class="demo-state__facts">
        <dt>clipKeys</dt>
        <dd>{{ ctx.clipKeys.length }} 个{{ ctx.clipKeys.length === 0 ? '' : `：${ctx.clipKeys.join(', ')}` }}</dd>
        <dt>docRevision</dt>
        <dd>{{ ctx.docRevision }}</dd>
        <dt>片段总数</dt>
        <dd>{{ clips.length }}</dd>
      </dl>
    </div>

    <div class="demo-actions">
      <button type="button" :disabled="clips.length === 0" @click="selectFirst">选中第一个片段</button>
      <button type="button" :disabled="clips.length === 0" @click="selectAll">多选全部</button>
      <button type="button" :disabled="state.kind === 'none' && ctx.clipKeys.length === 0" @click="clearSelection">
        清空选择
      </button>
      <button type="button" :disabled="deletableKeys.length === 0" @click="removeSelected">
        删除选中片段
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

.demo-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.demo-state[data-kind='invalid'] {
  border-color: var(--error);
  background: var(--error-bg);
}

.demo-state[data-kind='multi'] {
  border-color: var(--accent);
}

.demo-state__label {
  font-size: 12px;
}

.demo-state__detail {
  margin: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.demo-state__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 10px;
  margin: 0;
  color: var(--text-secondary);
}

.demo-state__facts dt {
  color: var(--text-muted);
}

.demo-state__facts dd {
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
