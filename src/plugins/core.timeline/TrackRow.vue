<script setup lang="ts">
/**
 * 一条轨道行（05-10）：只渲染与可视时间窗相交的片段块（自写最小窗口化）。
 *
 * 重叠只显示（斜纹带）、不裁剪、不自动错层；后开始者在上层。
 */
import { computed } from 'vue'
import type { ClipViewEntry, TrackSessionView, TrackViewEntry } from '../../workbench/api/documents.ts'
import type { DisplayRange } from '../../core/timeline/geometry.ts'
import ClipBlock from './ClipBlock.vue'
import { clipBodyEnd, clipWidthPx } from './model.ts'
import type { TimelineTool } from './state.ts'

const props = defineProps<{
  track: TrackViewEntry
  session: TrackSessionView
  pxPerSecond: number
  scrollLeft: number
  viewportWidth: number
  rowHeight: number
  clipHeight: number
  displayRange: DisplayRange
  selection: readonly string[]
  primaryKey?: string
  tool: TimelineTool
  trackColor: string
}>()

const emit = defineEmits<{
  select: [clipKey: string]
  addClip: [trackId: string]
}>()

/** 可视窗 ±1 屏（按时间）。 */
const windowStart = computed(() => props.scrollLeft / props.pxPerSecond - props.viewportWidth / props.pxPerSecond)
const windowEnd = computed(
  () => (props.scrollLeft + props.viewportWidth * 2) / props.pxPerSecond,
)

const visibleClips = computed(() => {
  const start = windowStart.value
  const end = windowEnd.value
  return props.track.clips.filter((clip) => {
    if (clip.infinite || clip.duration < 0) {
      return clip.start <= end
    }
    return clip.start <= end && clipBodyEnd(clip) >= start
  })
})

/** 后开始者在上层（z-index 按开始时间排序，不改变文档顺序）。 */
const ordered = computed(() =>
  [...visibleClips.value].sort((left, right) => left.start - right.start || left.clipKey.localeCompare(right.clipKey)),
)
const zIndexOf = computed(() => {
  const map = new Map<string, number>()
  ordered.value.forEach((clip, index) => {
    map.set(clip.clipKey, index + 1)
  })
  return map
})

/** 重叠区：按开始时间扫描，记录当前覆盖末端。 */
const overlapBands = computed(() => {
  const bands: Array<{ start: number; end: number }> = []
  let coveredEnd = Number.NEGATIVE_INFINITY
  for (const clip of ordered.value) {
    const start = clip.start
    const end = clip.infinite || clip.duration < 0 ? props.displayRange.end : clipBodyEnd(clip)
    if (start < coveredEnd - 0.0001) {
      const overlapEnd = Math.min(coveredEnd, end)
      if (overlapEnd > start) {
        bands.push({ start, end: overlapEnd })
      }
    }
    coveredEnd = Math.max(coveredEnd, end)
  }
  return bands
})

const selectedSet = computed(() => new Set(props.selection))

/** 09-07：OVERLAY / LETTERBOX 同轨只取第一个活跃片段，后一个在该重叠区不成层。 */
const singleActiveTrack = computed(() => props.track.type === 'OVERLAY' || props.track.type === 'LETTERBOX')
const overlapHint = '同轨只取文档顺序里的第一个活跃片段：此重叠区里顺序靠后的片段不会成层。可拖动片段到另一条轨道，或调整起始时间；编辑器不会自动拆分。'

function widthOf(clip: ClipViewEntry): number {
  return clipWidthPx(clip, props.pxPerSecond, props.displayRange.end)
}

function leftOf(clip: ClipViewEntry): number {
  return clip.start * props.pxPerSecond
}

function bandStyle(start: number, end: number): Record<string, string> {
  return {
    left: `${start * props.pxPerSecond}px`,
    width: `${Math.max(0, end - start) * props.pxPerSecond}px`,
  }
}

function onAdd(): void {
  emit('addClip', props.track.trackId)
}

const rowStyle = computed(() => ({
  height: `${props.rowHeight}px`,
  minHeight: `${props.rowHeight}px`,
}))
</script>

<template>
  <div
    class="track-row"
    :class="{
      'track-row--locked': session.locked,
      'track-row--empty': track.clips.length === 0,
      'track-row--blade': tool === 'blade',
    }"
    :style="rowStyle"
    :data-track-id="track.trackId"
    :data-track-row="track.trackId"
    :aria-label="`${track.name.length > 0 ? track.name : track.type} 轨道`"
  >
    <div class="track-row__baseline" aria-hidden="true"></div>
    <div
      v-for="band in overlapBands"
      :key="`overlap-${band.start}-${band.end}`"
      class="track-row__overlap"
      :class="{ 'track-row__overlap--single-active': singleActiveTrack }"
      :style="bandStyle(band.start, band.end)"
      :aria-hidden="singleActiveTrack ? undefined : 'true'"
    >
      <span v-if="singleActiveTrack" class="track-row__overlap-label" :title="overlapHint">
        后者不成层 · 拖到另一轨 / 改起始
      </span>
    </div>
    <ClipBlock
      v-for="clip in visibleClips"
      :key="clip.clipKey"
      :clip="clip"
      :track-type="track.type"
      :track-name="track.name.length > 0 ? track.name : track.type"
      :color="trackColor"
      :px-per-second="pxPerSecond"
      :display-end="displayRange.end"
      :width="widthOf(clip)"
      :height="clipHeight"
      :left="leftOf(clip)"
      :z-index="zIndexOf.get(clip.clipKey) ?? 1"
      :compact="rowHeight < 40"
      :selected="selectedSet.has(clip.clipKey)"
      :primary="primaryKey === clip.clipKey"
      @select="emit('select', $event)"
    />
    <div v-if="track.clips.length === 0" class="track-row__empty">
      <span class="track-row__empty-label">空轨道</span>
      <button
        type="button"
        class="track-row__add"
        :aria-label="`在 ${track.name.length > 0 ? track.name : track.type} 轨道添加片段`"
        title="在当前轨道末尾添加 5 秒片段"
        @pointerdown.stop
        @click.stop="onAdd"
      >
        + 添加片段
      </button>
    </div>
    <span v-if="session.locked" class="track-row__locked" aria-hidden="true">已锁定</span>
    <span v-if="!session.visible" class="sr-only">轨道已隐藏</span>
  </div>
</template>

<style scoped>
.track-row {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}

.track-row:hover {
  background: var(--bg-raised);
}

.track-row--locked {
  background: var(--bg-panel);
}

.track-row--blade {
  cursor: crosshair;
}

.track-row__baseline {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--border);
}

.track-row__overlap {
  position: absolute;
  top: 4px;
  bottom: 4px;
  pointer-events: none;
  opacity: 0.5;
  background-image: repeating-linear-gradient(
    45deg,
    var(--border-strong) 0,
    var(--border-strong) 2px,
    transparent 2px,
    transparent 7px
  );
}

.track-row__overlap--single-active {
  opacity: 0.65;
}

.track-row__overlap-label {
  position: absolute;
  top: 50%;
  left: 4px;
  max-width: calc(100% - 8px);
  overflow: hidden;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: auto;
  transform: translateY(-50%);
}

.track-row__empty {
  position: absolute;
  top: 50%;
  left: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--text-muted);
  font-size: 11px;
  transform: translateY(-50%);
}

.track-row__empty-label {
  white-space: nowrap;
}

.track-row__add {
  padding: 2px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.track-row__add:hover {
  border-color: var(--accent);
  color: var(--text);
}

.track-row__add:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.track-row__locked {
  position: absolute;
  top: 2px;
  right: 6px;
  color: var(--text-muted);
  font-size: 10px;
  pointer-events: none;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
