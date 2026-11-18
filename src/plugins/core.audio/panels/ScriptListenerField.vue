<script setup lang="ts">
/**
 * 脚本监听卡（10-03）：meta.listener 的专用说明 + 当前文档的回落提示。
 *
 * 运行时三个条件：顶层实例存在活跃 CAMERA 片段、该时刻相机活跃、meta.listener=camera。
 * 编辑器只能判定“当前文档”的 CAMERA 与播放头；顶层实例口径由运行时决定，卡上明说。
 */
import { computed } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { listenerStatus } from '../shared/audioSpec.ts'

const props = defineProps<{
  field: FieldEntry
  value: JsonValue | undefined
}>()

const emit = defineEmits<{ commit: [{ key: string; value: JsonValue }] }>()
const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const mode = computed(() => (props.value === 'camera' ? 'camera' : 'player'))

const cameraClipKeys = computed<string[]>(() => {
  const view = documentService?.view()
  if (view === null || view === undefined) return []
  return view.tracks
    .filter((track) => track.type === 'CAMERA')
    .flatMap((track) => track.clips.map((clip) => clip.clipKey))
})

function jumpToCamera(): void {
  const first = cameraClipKeys.value[0]
  if (first === undefined) return
  ctx.requestSelect({ domain: 'clip', clipKey: first })
  ctx.requestFocus('selection.properties')
}

function openTimeline(): void {
  ctx.requestFocus('timeline.main')
}

const status = computed(() => {
  const view = documentService?.view() ?? null
  const playhead = documentService?.sessionView().playhead ?? 0
  let hasCameraClips = false
  let activeCameraAtPlayhead = false
  for (const track of view?.tracks ?? []) {
    if (track.type !== 'CAMERA') continue
    for (const clip of track.clips) {
      hasCameraClips = true
      const within = playhead >= clip.start
        && (clip.infinite || playhead < clip.start + clip.duration - 1e-9)
      if (within) activeCameraAtPlayhead = true
    }
  }
  return listenerStatus({
    listener: mode.value,
    hasCameraClips,
    activeCameraAtPlayhead,
  })
})

function onChange(event: Event): void {
  const next = (event.target as HTMLSelectElement).value
  emit('commit', { key: props.field.key, value: next as JsonValue })
}
</script>

<template>
  <div class="wf-listener" :data-level="status.level">
    <div class="wf-listener__line">
      <select
        class="wf-listener__select"
        :value="mode"
        :aria-label="field.key"
        @change="onChange"
      >
        <option value="player">player（玩家监听点）</option>
        <option value="camera">camera（相机监听点）</option>
      </select>
      <span class="wf-listener__title">{{ status.title }}</span>
    </div>
    <p class="wf-listener__detail">{{ status.detail }}</p>
    <p v-if="mode === 'camera'" class="wf-listener__hint">
      顶层实例：编辑器只判定当前文档；多个脚本实例同时播放时，是否真的切到相机由运行时的顶层实例判定（这里不猜测）。
    </p>
    <p v-if="status.level === 'warning'" class="wf-listener__warn">
      当前会回落到玩家监听点：ambient 的 relative 坐标与衰减都按玩家计算。
    </p>
    <button
      v-if="status.level === 'warning'"
      type="button"
      class="wf-listener__jump"
      @click="openTimeline"
    >打开时间轴</button>
    <button
      v-else-if="status.level === 'info' && cameraClipKeys.length > 0"
      type="button"
      class="wf-listener__jump"
      @click="jumpToCamera"
    >跳到第一个 CAMERA 片段</button>
  </div>
</template>

<style scoped>
.wf-listener {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  min-width: 0;
}

.wf-listener__line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wf-listener__select {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.wf-listener__select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.wf-listener__title {
  overflow: hidden;
  color: var(--text);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-listener[data-level='warning'] .wf-listener__title {
  color: var(--warning);
}

.wf-listener__detail,
.wf-listener__hint,
.wf-listener__warn {
  margin: 0;
  font-size: 10px;
}

.wf-listener__detail,
.wf-listener__hint {
  color: var(--text-muted);
}

.wf-listener__warn {
  color: var(--warning);
}

.wf-listener__jump {
  align-self: flex-start;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.wf-listener__jump:hover {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
