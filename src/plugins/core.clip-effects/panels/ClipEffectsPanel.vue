<script setup lang="ts">
/**
 * `clip.effects`（05-13）：编辑器页左栏的真实片段效果面板。
 *
 * 数据只来自 `PanelContext`：`DOCUMENT_SERVICE.view()` + `clipObjects(selectedClipKey)`。
 * 标量 `value` 通过文档命令 `object.setValue` 写回；关键帧只显示帧数（06 才编辑）。
 * 没有选择 / 多选 / 选区失效 / 外部域都显示真实状态，不伪造片段或属性。
 */
import { computed } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import ObjectPropertyRow from './ObjectPropertyRow.vue'
import { usePanelRevision } from '../usePanelRevision.ts'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)

const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)
const catalog = ctx.services.require(CATALOG_SERVICE)

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})

const selectedClipKey = computed<string | null>(() => {
  const current = state.value
  return current.kind === 'clip' ? current.clipKey : null
})

const clipView = computed(() => {
  const currentView = view.value
  const clipKey = selectedClipKey.value
  if (currentView === null || clipKey === null) {
    return undefined
  }
  for (const track of currentView.tracks) {
    const found = track.clips.find((clip) => clip.clipKey === clipKey)
    if (found !== undefined) {
      return { clip: found, trackType: track.type }
    }
  }
  return undefined
})

const objects = computed<JsonObject | null>(() => {
  const clipKey = selectedClipKey.value
  if (clipKey === null) {
    return null
  }
  return documentService?.clipObjects(clipKey) ?? null
})

const properties = computed<Array<{ path: string; property: JsonValue }>>(() => {
  const current = objects.value
  if (current === null) {
    return []
  }
  return Object.entries(current).map(([path, property]) => ({ path, property }))
})

function fieldFor(path: string) {
  const trackType = clipView.value?.trackType
  if (trackType === undefined) {
    return undefined
  }
  return catalog.objectDef(trackType, path)
}

function formatSeconds(seconds: number): string {
  return Number.isFinite(seconds) ? `${seconds.toFixed(2)}s` : '未知'
}

const clipSummary = computed(() => {
  const found = clipView.value
  if (found === undefined) {
    return null
  }
  const clip = found.clip
  const durationText = clip.infinite ? '无限' : formatSeconds(clip.duration)
  return {
    label: clip.label,
    clipKey: clip.clipKey,
    clipId: clip.clipId ?? null,
    trackType: found.trackType,
    start: formatSeconds(clip.start),
    duration: durationText,
    loop: clip.loop,
    references: clip.references,
    warn: clip.warn,
  }
})
</script>

<template>
  <section class="effects-panel" aria-label="片段效果">
    <header class="effects-panel__header">
      <h2 class="effects-panel__title">片段效果</h2>
      <span class="effects-panel__hint">对象属性 · 标量可写 · 关键帧只读</span>
    </header>

    <p v-if="documentService === undefined" class="effects-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>

    <p v-else-if="view === null" class="effects-panel__empty">
      没有打开的文档。从脚本页打开一个脚本后，这里显示选中片段的对象属性。
    </p>

    <template v-else>
      <div v-if="state.kind === 'clip' && selectedClipKey !== null" class="effects-panel__body">
        <dl v-if="clipSummary !== null" class="effects-summary">
          <dt>片段</dt>
          <dd>{{ clipSummary.label }}</dd>
          <dt>clipKey</dt>
          <dd class="effects-mono">{{ clipSummary.clipKey }}</dd>
          <template v-if="clipSummary.clipId !== null">
            <dt>clip.id</dt>
            <dd class="effects-mono">{{ clipSummary.clipId }}</dd>
          </template>
          <dt>轨道</dt>
          <dd>{{ clipSummary.trackType }}</dd>
          <dt>时间</dt>
          <dd>{{ clipSummary.start }} · {{ clipSummary.duration }}<span v-if="clipSummary.loop"> · 循环</span></dd>
          <dt>引用</dt>
          <dd>{{ clipSummary.references }} 处</dd>
          <dt v-if="clipSummary.warn">问题</dt>
          <dd v-if="clipSummary.warn" class="effects-warn">该片段有 block / warn 级 issue。</dd>
        </dl>

        <p v-if="objects === null" class="effects-panel__empty">
          片段 {{ selectedClipKey }} 已不在当前文档里（可能已被删除）。
        </p>
        <p v-else-if="properties.length === 0" class="effects-panel__empty">
          该片段没有对象属性（`objects` 为空）。
        </p>
        <div v-else class="object-list">
          <ObjectPropertyRow
            v-for="entry in properties"
            :key="entry.path"
            :clip-key="state.clipKey"
            :path="entry.path"
            :property="entry.property"
            :field="fieldFor(entry.path)"
          />
        </div>
      </div>

      <div v-else-if="state.kind === 'multi'" class="effects-panel__empty" role="status">
        <strong>当前为多选（{{ state.clipKeys.length }} 个片段）。</strong>
        <p>请选择一个片段查看对象属性；多选不合并属性，也不取第一个片段冒充选择。</p>
        <p class="effects-mono">{{ state.clipKeys.join(', ') }}</p>
      </div>

      <div v-else-if="state.kind === 'invalid'" class="effects-panel__notice" role="alert">
        <strong>选区失效。</strong>
        <p>{{ state.reason }}</p>
        <p class="effects-mono">
          之前的选区：domain={{ state.previous.domain
          }}<template v-if="state.previous.clipKey !== undefined"> · clipKey={{ state.previous.clipKey }}</template>
        </p>
      </div>

      <div v-else-if="state.kind === 'foreign'" class="effects-panel__empty">
        <strong>当前选择属于 {{ state.domain }} 域，不属于片段效果控件。</strong>
        <p>在时间轴上选择片段后再查看对象属性。</p>
      </div>

      <p v-else class="effects-panel__empty">
        没有选中片段。空态不自动选择第一个片段。
      </p>
    </template>
  </section>
</template>

<style scoped>
.effects-panel {
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

.effects-panel__header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.effects-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.effects-panel__hint {
  color: var(--text-muted);
  font-size: 11px;
}

.effects-panel__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.effects-summary {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 12px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.effects-summary dt {
  color: var(--text-muted);
}

.effects-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.effects-mono {
  font-family: var(--font-mono, monospace);
}

.effects-warn {
  color: var(--warning);
}

.effects-panel__empty,
.effects-panel__notice {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.effects-panel__empty p,
.effects-panel__notice p {
  margin: 4px 0 0;
}

.effects-panel__notice {
  border-color: var(--error);
  background: var(--bg-raised);
}

.effects-panel__notice strong {
  color: var(--error);
}

.object-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
</style>
