<script setup lang="ts">
/**
 * 属性面板的片段摘要（06-09 §三）：片段名、身份、轨道、起止与时长形态、校验徽标、未保存标记。
 *
 * 面板不改片段几何：起止与时长只读，旁边给"在时间轴编辑"的跳转。
 * 校验徽标点击打开诊断抽屉（`diagnostics`），不在这里列出 issue。
 */
import { computed } from 'vue'
import type { ClipViewEntry } from '../../../workbench/api/documents.ts'
import type { DocumentSummary } from '../../../workbench/api/documents.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  clip: ClipViewEntry
  trackType: string
  summary: DocumentSummary | null
}>()

const ctx = usePanelContext()

const durationText = computed(() => {
  if (props.clip.infinite) {
    return '无限'
  }
  return Number.isFinite(props.clip.duration) ? `${props.clip.duration.toFixed(2)}s` : '未知'
})

const loopText = computed(() => {
  if (!props.clip.loop) {
    return null
  }
  if (props.clip.loopCount === undefined || props.clip.loopCount < 0) {
    return '循环 · 无限'
  }
  return `循环 · ${props.clip.loopCount} 次`
})

const issueLabel = computed(() => {
  const summary = props.summary
  if (summary === null) {
    return null
  }
  if (summary.blocking > 0) {
    return `阻止 ${summary.blocking}`
  }
  if (summary.issueCount > 0) {
    return `问题 ${summary.issueCount}`
  }
  return null
})

function openDiagnostics(): void {
  ctx.requestOpenDrawer('diagnostics')
}

function focusTimeline(): void {
  ctx.requestFocus('timeline.main')
}
</script>

<template>
  <header class="props-header">
    <div class="props-header__line">
      <h2 class="props-header__name">{{ clip.label }}</h2>
      <span v-if="summary?.dirty" class="props-header__dirty">未保存</span>
      <button
        v-if="issueLabel !== null"
        type="button"
        class="props-header__badge"
        :class="{ 'props-header__badge--block': (summary?.blocking ?? 0) > 0 }"
        @click="openDiagnostics"
      >
        {{ issueLabel }}
      </button>
    </div>

    <dl class="props-header__facts">
      <dt>轨道</dt>
      <dd>{{ trackType }}</dd>
      <dt>clipKey</dt>
      <dd class="props-header__mono">{{ clip.clipKey }}</dd>
      <template v-if="clip.clipId !== undefined">
        <dt>clip.id</dt>
        <dd class="props-header__mono">{{ clip.clipId }}</dd>
      </template>
      <dt>时间</dt>
      <dd>
        {{ clip.start.toFixed(2) }}s → {{ durationText }}
        <span v-if="loopText !== null" class="props-header__muted"> · {{ loopText }}</span>
        <button type="button" class="props-header__link" @click="focusTimeline">在时间轴编辑</button>
      </dd>
    </dl>
  </header>
</template>

<style scoped>
.props-header {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.props-header__line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.props-header__name {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.props-header__dirty {
  padding: 0 4px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 11px;
}

.props-header__badge {
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--warning);
  border-radius: 8px;
  background: transparent;
  color: var(--warning);
  font-size: 11px;
  cursor: pointer;
}

.props-header__badge--block {
  border-color: var(--error);
  color: var(--error);
}

.props-header__badge:hover {
  background: var(--bg-hover);
}

.props-header__badge:focus-visible,
.props-header__link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.props-header__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.props-header__facts dt {
  color: var(--text-muted);
}

.props-header__facts dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.props-header__mono {
  font-family: var(--font-mono);
}

.props-header__muted {
  color: var(--text-muted);
}

.props-header__link {
  margin-left: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}
</style>
