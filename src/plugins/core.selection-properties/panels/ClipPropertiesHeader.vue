<script setup lang="ts">
/**
 * 属性面板的片段摘要（检查器改版）：干净的选区类型 + 片段名 + 时间摘要。
 *
 * 不在头部堆内部 ID / 轨道枚举：`clipKey` 与原始轨道类型只放在 `title` 供诊断定位。
 * 片内时间按全局播放头与片段起点计算；「到开头」直接写播放头（`setPlayhead`），
 * 不改片段几何。校验徽标仍打开诊断抽屉。
 */
import { computed } from 'vue'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import type { ClipViewEntry } from '../../../workbench/api/documents.ts'
import type { DocumentSummary } from '../../../workbench/api/documents.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { trackLabel } from '../../core.timeline/model.ts'

const props = defineProps<{
  clip: ClipViewEntry
  trackType: string
  summary: DocumentSummary | null
  /** 全局播放头（秒，与主时间轴同一口径）。 */
  playhead: number
}>()

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const typeLabel = computed(() => trackLabel(props.trackType))

const endText = computed(() => {
  if (props.clip.infinite) {
    return '无限'
  }
  return Number.isFinite(props.clip.duration) ? `${(props.clip.start + props.clip.duration).toFixed(2)}s` : '未知'
})

const rangeText = computed(() => `${props.clip.start.toFixed(2)}s → ${endText.value}`)

const loopText = computed(() => {
  if (!props.clip.loop) {
    return null
  }
  if (props.clip.loopCount === undefined || props.clip.loopCount < 0) {
    return '循环 · 无限'
  }
  return `循环 · ${props.clip.loopCount} 次`
})

/** 片内时间；播放头在片段外时明确说明方向，不把差值伪装成片内时间。 */
const clipTime = computed(() => {
  const local = props.playhead - props.clip.start
  if (local < -1e-6) {
    return { outside: true, text: '播放头在片段起点前' }
  }
  if (!props.clip.infinite && Number.isFinite(props.clip.duration) && local > props.clip.duration + 1e-6) {
    return { outside: true, text: '播放头在片段终点后' }
  }
  return { outside: false, text: `片内 ${Math.max(0, local).toFixed(2)}s` }
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

function jumpToClipStart(): void {
  documentService?.setPlayhead(props.clip.start)
}

function focusTimeline(): void {
  ctx.requestFocus('timeline.main')
}
</script>

<template>
  <header
    class="props-header"
    :title="`轨道类型 ${trackType} · clipKey ${clip.clipKey}${clip.clipId === undefined ? '' : ` · clip.id ${clip.clipId}`}`"
  >
    <div class="props-header__line">
      <span class="props-header__type">{{ typeLabel }}</span>
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

    <div class="props-header__time">
      <span class="props-header__range">{{ rangeText }}</span>
      <span v-if="loopText !== null" class="props-header__muted">{{ loopText }}</span>
      <span class="props-header__local" :data-outside="clipTime.outside">{{ clipTime.text }}</span>
      <button type="button" class="props-header__link" @click="jumpToClipStart">到开头</button>
      <button type="button" class="props-header__link" @click="focusTimeline">在时间轴编辑</button>
    </div>
  </header>
</template>

<style scoped>
.props-header {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 3px;
  padding: 6px 9px 7px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.props-header__line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.props-header__type {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 10px;
}

.props-header__name {
  margin: 0;
  overflow: hidden;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.props-header__dirty {
  padding: 0 4px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
}

.props-header__badge {
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--warning);
  border-radius: 8px;
  background: transparent;
  color: var(--warning);
  font-size: 10px;
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

.props-header__time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  color: var(--text-secondary);
  font-size: 10px;
}

.props-header__range {
  font-variant-numeric: tabular-nums;
}

.props-header__local {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.props-header__local[data-outside='true'] {
  color: var(--text-muted);
}

.props-header__muted {
  color: var(--text-muted);
}

.props-header__link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 10px;
  text-decoration: underline;
  cursor: pointer;
}

.props-header__link + .props-header__link {
  margin-left: 0;
}
</style>
