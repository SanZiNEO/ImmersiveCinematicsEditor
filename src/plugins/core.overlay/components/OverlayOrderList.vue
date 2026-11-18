<script setup lang="ts">
/**
 * 层级预览（09-07）：从层级行打开，跟随播放头，只读。
 *
 * 列出播放头处活跃的 OVERLAY / LETTERBOX 片段：轨道、片段名、层类型、层级、绘制顺序；
 * 标出同层级、同轨重叠、多画幅、层级为负 / 为零。点击一行只选中片段，不改层级。
 * 不显示相机轨道，不建立全局合成表，不写盘。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import {
  collectActiveLayers,
  layerOrderWarnings,
  overlayTrackOverlaps,
  overlapMessage,
} from '../../../features/overlay/zorder.ts'
import type { LayerOrderEntry, LayerOrderWarning, TrackOverlapRange } from '../../../features/overlay/zorder.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  clipKey: string
  playhead: number
}>()

const ctx = usePanelContext()
const documents = ctx.services.get(DOCUMENT_SERVICE)

function readObjects(key: string): JsonObject | null {
  return documents?.clipObjects(key) ?? null
}

const entries = computed<LayerOrderEntry[]>(() => {
  void ctx.docRevision
  return collectActiveLayers(documents?.view() ?? null, props.playhead, readObjects)
})

const warnings = computed<LayerOrderWarning[]>(() => layerOrderWarnings(entries.value))

const overlaps = computed<TrackOverlapRange[]>(() => {
  void ctx.docRevision
  return overlayTrackOverlaps(documents?.view() ?? null)
})

const currentOverlaps = computed(() =>
  overlaps.value.filter((range) => props.playhead >= range.start && props.playhead < range.end))

function select(entry: LayerOrderEntry): void {
  ctx.commands.select({ domain: 'clip', clipKey: entry.clipKey })
}
</script>

<template>
  <section class="overlay-order" aria-label="层级预览">
    <header class="overlay-order__header">
      <span>层级预览（播放头 {{ playhead.toFixed(2) }}s）</span>
      <span class="overlay-order__count">{{ entries.length }} 层</span>
    </header>

    <table class="overlay-order__table">
      <thead>
        <tr>
          <th>顺序</th>
          <th>z</th>
          <th>轨道</th>
          <th>片段</th>
          <th>层类型</th>
          <th>摘要</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in entries"
          :key="entry.clipKey"
          :class="{ 'overlay-order__row--current': entry.clipKey === clipKey }"
          tabindex="0"
          @click="select(entry)"
          @keydown.enter="select(entry)"
        >
          <td>{{ entry.drawOrder + 1 }}</td>
          <td>{{ entry.zIndex }}</td>
          <td>{{ entry.trackType }}#{{ entry.trackIndex }}</td>
          <td>{{ entry.label }}</td>
          <td>{{ entry.layerType }}</td>
          <td class="overlay-order__summary" :title="entry.summary">{{ entry.summary }}</td>
        </tr>
        <tr v-if="entries.length === 0">
          <td colspan="6" class="overlay-order__empty">播放头处没有活跃的覆盖层 / 画幅片段。</td>
        </tr>
      </tbody>
    </table>

    <ul v-if="warnings.length > 0" class="overlay-order__warnings">
      <li v-for="warning in warnings" :key="warning.kind + warning.clipKeys.join(',')" :data-kind="warning.kind">
        {{ warning.message }}
      </li>
    </ul>

    <section v-if="overlaps.length > 0" class="overlay-order__overlaps">
      <h5>同轨重叠</h5>
      <ul>
        <li v-for="range in overlaps" :key="`${range.trackId}-${range.start}-${range.end}`">
          {{ overlapMessage(range) }}
          <em v-if="currentOverlaps.some((current) => current.trackId === range.trackId && current.start === range.start && current.end === range.end)">
            （当前播放头在此重叠区）
          </em>
          <span class="overlay-order__overlap-actions">处理：拖动片段到另一条轨道，或调整起始时间；编辑器不会自动拆分。</span>
        </li>
      </ul>
    </section>

    <p class="overlay-order__note">
      顺序 = 层级升序（小的先画）；同层级按加入顺序（文档顺序靠前者先建层）。
      这是层的顺序，不是像素合成结果；相机 / 调色轨不在这张表里。
    </p>
  </section>
</template>

<style scoped>
.overlay-order {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

.overlay-order__header {
  display: flex;
  justify-content: space-between;
  color: var(--text);
  font-size: 12px;
}

.overlay-order__count {
  color: var(--text-muted);
  font-size: 11px;
}

.overlay-order__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.overlay-order__table th {
  padding: 2px 4px;
  border-bottom: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-weight: 500;
  text-align: left;
}

.overlay-order__table td {
  padding: 2px 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.overlay-order__table tr {
  cursor: pointer;
  outline: none;
}

.overlay-order__table tr:hover,
.overlay-order__table tr:focus-visible {
  background: var(--bg-hover);
}

.overlay-order__row--current td {
  color: var(--accent);
}

.overlay-order__summary {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-order__empty {
  color: var(--text-muted);
  font-size: 11px;
}

.overlay-order__warnings,
.overlay-order__overlaps ul {
  margin: 0;
  padding-left: 16px;
  color: var(--warning);
  font-size: 11px;
}

.overlay-order__overlaps h5 {
  margin: 0 0 2px;
  color: var(--text);
  font-size: 11px;
}

.overlay-order__overlaps em {
  color: var(--accent);
  font-style: normal;
}

.overlay-order__overlap-actions {
  display: block;
  color: var(--text-muted);
}

.overlay-order__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
