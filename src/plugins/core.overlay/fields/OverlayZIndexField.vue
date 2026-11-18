<script setup lang="ts">
/**
 * 层级控件（09-07）：整数字段 + 打开层级预览。
 *
 * `z_index` 是静态属性（没有关键帧），只在建层时读取；改它需要重新激活片段才生效。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import OverlayOrderList from '../components/OverlayOrderList.vue'
import OverlayPresetPanel from '../components/OverlayPresetPanel.vue'
import { ensureExplicitLayerTypeCommands } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const documents = ctx.services.get(DOCUMENT_SERVICE)
const open = ref(false)
const error = ref('')
const notice = ref('')
const trackIndex = computed(() => {
  const view = documents?.view()
  if (view === null || view === undefined) return 0
  return view.tracks.findIndex((track) => track.clips.some((clip) => clip.clipKey === props.row.clipKey))
})

const current = computed(() => {
  const raw = props.objects.z_index
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 10
  const value = (raw as Record<string, unknown>).value
  return typeof value === 'number' && Number.isInteger(value) ? value : 10
})

function apply(event: Event): void {
  const text = (event.target as HTMLInputElement).value.trim()
  if (props.disabled) return
  if (text === '') {
    error.value = 'z_index 需要整数（不能为空）'
    return
  }
  const value = Number(text)
  if (!Number.isInteger(value)) {
    error.value = `z_index 需要整数（实际 ${text}）`
    return
  }
  if (value === current.value) {
    error.value = ''
    notice.value = 'z_index 未变化'
    return
  }
  const outcome = ctx.commands.commitBatch([
    ...ensureExplicitLayerTypeCommands(props.row.clipKey, props.objects, 'z_index'),
    { kind: 'object.setValue', clipKey: props.row.clipKey, path: 'z_index', value },
  ], `overlay-z:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '层级写入失败'
    return
  }
  error.value = ''
  notice.value = `已写入 z_index=${value}；已建层不会重排，重新激活后生效`
}

const zHint = computed(() => {
  if (current.value < 0) return 'z_index < 0：绘制在画幅黑边之下（会被黑边盖住）'
  if (current.value === 0) return 'z_index = 0：与画幅层同层，实际先后取决于加入顺序（不承诺固定）'
  return 'z_index 越小越先画；同层级按加入顺序；修改只在下一次建层时生效'
})
</script>

<template>
  <div class="overlay-z">
    <div class="overlay-z__row">
      <input
        type="number"
        step="1"
        :value="current"
        :disabled="disabled"
        aria-label="层级 z_index"
        @change="apply"
      >
      <button type="button" class="overlay-z__toggle" :aria-expanded="open" @click="open = !open">
        {{ open ? '收起层级预览' : '打开层级预览' }}
      </button>
      <OverlayPresetPanel
        :clip-key="row.clipKey"
        :objects="objects"
        track-type="OVERLAY"
        :duration="timing.duration"
        :groups="['layer']"
        :track-index="trackIndex"
        @done="notice = $event"
      />
    </div>
    <p class="overlay-z__hint">{{ zHint }}</p>
    <p v-if="notice !== ''" class="overlay-z__ok" role="status">{{ notice }}</p>
    <p v-if="error !== ''" class="overlay-z__error" role="alert">{{ error }}</p>
    <OverlayOrderList v-if="open" :clip-key="row.clipKey" :playhead="playhead" />
  </div>
</template>

<style scoped>
.overlay-z {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overlay-z__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.overlay-z__row input {
  width: 80px;
  padding: 2px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-z__toggle {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-z__hint,
.overlay-z__ok,
.overlay-z__error {
  margin: 0;
  font-size: 10px;
}

.overlay-z__hint {
  color: var(--text-muted);
}

.overlay-z__ok {
  color: var(--text-secondary);
}

.overlay-z__error {
  color: var(--error);
}
</style>
