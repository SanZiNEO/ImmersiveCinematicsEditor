<script setup lang="ts">
/**
 * 「片段属性」tab（05-13）。
 *
 * 显示 03 主选区四态、批选、当前片段的时间 / 引用数；失效态给出原因与
 * `edit.undo`。面板不持第二份选区，也不自动修复失效片段。
 */
import { computed, ref } from 'vue'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import type { ClipViewEntry } from '../../../workbench/api/documents.ts'
import { COMMAND_SERVICE, DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { formatSeconds } from '../helpers.ts'
import { usePanelRevision } from '../usePanelRevision.ts'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})

const clipIndex = computed<Map<string, ClipViewEntry>>(() => {
  const index = new Map<string, ClipViewEntry>()
  for (const track of view.value?.tracks ?? []) {
    for (const clip of track.clips) {
      index.set(clip.clipKey, clip)
    }
  }
  return index
})

const selectedClip = computed<ClipViewEntry | undefined>(() => {
  const current = state.value
  if (current.kind !== 'clip') {
    return undefined
  }
  return clipIndex.value.get(current.clipKey)
})

const canUndo = computed(() => {
  void revision.value
  return ctx.commands.canUndo
})

const message = ref('')
const messageKind = ref<'info' | 'error'>('info')

function report(text: string, kind: 'info' | 'error'): void {
  message.value = text
  messageKind.value = kind
}

async function runUndo(): Promise<void> {
  const commands = ctx.services.get(COMMAND_SERVICE)
  if (commands !== undefined) {
    const ok = await commands.execute({ pageId: ctx.pageId, services: ctx.services }, 'edit.undo')
    report(ok ? '已执行撤销（edit.undo）。' : '撤销被拒绝或失败（edit.undo）。', ok ? 'info' : 'error')
    return
  }
  const ok = ctx.commands.undo()
  report(ok ? '命令注册表不可用，已回退到文档命令面撤销。' : '撤销失败。', ok ? 'info' : 'error')
}

function clipLabel(clipKey: string): string | null {
  return clipIndex.value.get(clipKey)?.label ?? null
}
</script>

<template>
  <section class="clip-pane" aria-label="片段属性">
    <dl class="clip-facts clip-facts--summary">
      <dt>主选区</dt>
      <dd>{{ state.kind }}</dd>
      <dt>clipKeys</dt>
      <dd class="clip-mono">{{ ctx.clipKeys.length === 0 ? '（空）' : ctx.clipKeys.join(', ') }}</dd>
    </dl>

    <template v-if="state.kind === 'clip'">
      <dl class="clip-facts">
        <dt>主选区</dt>
        <dd>domain={{ state.selection.domain }}</dd>
        <dt>clipKey</dt>
        <dd class="clip-mono">{{ state.clipKey }}</dd>
        <template v-if="state.selection.objectPath !== undefined">
          <dt>objectPath</dt>
          <dd class="clip-mono">{{ state.selection.objectPath }}</dd>
        </template>
        <template v-if="state.selection.keyframeTime !== undefined">
          <dt>keyframeTime</dt>
          <dd>{{ state.selection.keyframeTime }}</dd>
        </template>
      </dl>

      <section v-if="selectedClip !== undefined" class="clip-block">
        <h3 class="clip-block__title">{{ selectedClip.label }}</h3>
        <dl class="clip-facts">
          <dt>clipKey</dt>
          <dd class="clip-mono">{{ selectedClip.clipKey }}</dd>
          <template v-if="selectedClip.clipId !== undefined">
            <dt>clip.id</dt>
            <dd class="clip-mono">{{ selectedClip.clipId }}</dd>
          </template>
          <dt>开始 / 时长</dt>
          <dd>
            {{ formatSeconds(selectedClip.start) }} ·
            {{ selectedClip.infinite ? '无限' : formatSeconds(selectedClip.duration) }}
            <span v-if="selectedClip.loop"> · 循环</span>
          </dd>
          <dt>引用数</dt>
          <dd>{{ selectedClip.references }} 处</dd>
          <dt v-if="selectedClip.warn">问题</dt>
          <dd v-if="selectedClip.warn" class="clip-warn">该片段有 block / warn 级 issue。</dd>
        </dl>
      </section>
      <p v-else class="clip-notice" role="status">
        当前轨道视图未包含片段 {{ state.clipKey }}；片段仍可能存在（独立片段或视图未列出）。
      </p>
    </template>

    <template v-else-if="state.kind === 'multi'">
      <div class="clip-block">
        <h3 class="clip-block__title">多选 · {{ state.clipKeys.length }} 个片段</h3>
        <p class="clip-hint">多选只显示数量与键；不合并属性，也不取第一个片段。</p>
        <ul class="clip-list">
          <li v-for="clipKey in state.clipKeys" :key="clipKey">
            <span class="clip-mono">{{ clipKey }}</span>
            <span v-if="clipLabel(clipKey) !== null"> · {{ clipLabel(clipKey) }}</span>
            <span v-else> · （未在当前轨道视图中）</span>
          </li>
        </ul>
      </div>
    </template>

    <template v-else-if="state.kind === 'invalid'">
      <div class="clip-error" role="alert">
        <strong>选区失效</strong>
        <p>{{ state.reason }}</p>
        <dl class="clip-facts">
          <dt>之前域</dt>
          <dd>{{ state.previous.domain }}</dd>
          <template v-if="state.previous.clipKey !== undefined">
            <dt>之前 clipKey</dt>
            <dd class="clip-mono">{{ state.previous.clipKey }}</dd>
          </template>
          <template v-if="state.previous.objectPath !== undefined">
            <dt>之前 objectPath</dt>
            <dd class="clip-mono">{{ state.previous.objectPath }}</dd>
          </template>
        </dl>
      </div>
      <div class="clip-actions">
        <button type="button" class="clip-button" :disabled="!canUndo" @click="runUndo">
          撤销（edit.undo）
        </button>
      </div>
    </template>

    <template v-else-if="state.kind === 'foreign'">
      <div class="clip-block">
        <h3 class="clip-block__title">当前选择属于 {{ state.domain }} 域</h3>
        <p class="clip-hint">片段属性 tab 只处理片段 / 对象 / 关键帧选择；当前选择不属于片段。</p>
        <dl class="clip-facts">
          <dt>domain</dt>
          <dd>{{ state.selection.domain }}</dd>
          <template v-if="state.selection.pathId !== undefined">
            <dt>pathId</dt>
            <dd class="clip-mono">{{ state.selection.pathId }}</dd>
          </template>
          <template v-if="state.selection.ruleId !== undefined">
            <dt>ruleId</dt>
            <dd class="clip-mono">{{ state.selection.ruleId }}</dd>
          </template>
          <template v-if="state.selection.bindingId !== undefined">
            <dt>bindingId</dt>
            <dd class="clip-mono">{{ state.selection.bindingId }}</dd>
          </template>
        </dl>
      </div>
    </template>

    <p v-else class="clip-empty">
      没有选择片段。空态不自动选择第一个片段；在时间轴上点击片段后再查看属性。
    </p>

    <p v-if="message !== ''" class="clip-result" :data-kind="messageKind" role="status" aria-live="polite">
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.clip-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
}

.clip-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.clip-block__title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.clip-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 10px;
  margin: 0;
}

.clip-facts--summary {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.clip-facts dt {
  color: var(--text-muted);
}

.clip-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.clip-mono {
  font-family: var(--font-mono, monospace);
}

.clip-hint {
  margin: 0;
  color: var(--text-secondary);
}

.clip-list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.clip-list li {
  overflow-wrap: anywhere;
}

.clip-warn {
  color: var(--warning);
}

.clip-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--error);
  border-radius: 4px;
  background: var(--bg-raised);
}

.clip-error strong {
  color: var(--error);
}

.clip-error p {
  margin: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.clip-notice,
.clip-empty {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.clip-actions {
  display: flex;
  gap: 6px;
}

.clip-button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.clip-button:hover:enabled {
  background: var(--bg-hover);
}

.clip-button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.clip-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.clip-result {
  margin: 0;
  color: var(--text-secondary);
}

.clip-result[data-kind='error'] {
  color: var(--error);
}
</style>
