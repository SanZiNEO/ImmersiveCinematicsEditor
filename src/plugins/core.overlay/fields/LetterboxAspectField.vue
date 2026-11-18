<script setup lang="ts">
/**
 * 画幅比控件（09-06）。
 *
 * `LETTERBOX` 只有 `aspect_ratio` / `opacity`：没有方向、裁切、素材字段。
 * 更宽画幅 → 上下黑边；更窄 → 左右黑边；同比例 / 0 → 无黑边；空档复位不走渐出。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import {
  LETTERBOX_ASPECT_OPTIONS,
  LETTERBOX_FIELD_NOTE,
  LETTERBOX_FADE_OUT_SECONDS,
  letterboxAspectOf,
  letterboxPreview,
  validateAspectInput,
} from '../../../features/overlay/letterbox.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import OverlayGateBanner from '../components/OverlayGateBanner.vue'
import OverlayGeometrySketch from '../components/OverlayGeometrySketch.vue'
import OverlayPresetPanel from '../components/OverlayPresetPanel.vue'
import { commitField } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const documents = ctx.services.get(DOCUMENT_SERVICE)
const draft = ref(String(letterboxAspectOf(props.objects)))
const notice = ref('')
const error = ref('')

const preview = computed(() => letterboxPreview(props.objects))
watch(() => letterboxAspectOf(props.objects), (value) => {
  draft.value = String(value)
})
const trackIndex = computed(() => {
  const view = documents?.view()
  if (view === null || view === undefined) return 0
  return view.tracks.findIndex((track) => track.clips.some((clip) => clip.clipKey === props.row.clipKey))
})

function apply(value: number): void {
  if (props.disabled) return
  const checked = validateAspectInput(String(value))
  if (!checked.ok) {
    error.value = checked.message ?? '画幅比非法'
    return
  }
  const outcome = commitField(
    ctx.commands,
    props.row.clipKey,
    'aspect_ratio',
    checked.value,
    `letterbox-aspect:${props.row.clipKey}`,
  )
  if (!outcome.ok) {
    error.value = outcome.error ?? '画幅比写入失败'
    return
  }
  error.value = ''
  draft.value = String(checked.value)
  notice.value = `已写入 aspect_ratio=${checked.value}`
}

function applyInput(): void {
  if (draft.value.trim() === '') {
    error.value = '画幅比不能为空（0 表示不绘制黑边）'
    return
  }
  const value = Number(draft.value)
  if (Number.isFinite(value) && value === letterboxAspectOf(props.objects)) {
    error.value = ''
    notice.value = '画幅比未变化'
    return
  }
  apply(value)
}

function choose(value: number): void {
  apply(value)
}
</script>

<template>
  <div class="letterbox-aspect">
    <div class="letterbox-aspect__row">
      <input
        v-model="draft"
        type="number"
        min="0"
        step="0.05"
        :disabled="disabled"
        aria-label="画幅比 aspect_ratio"
        @blur="applyInput"
        @keydown.enter.prevent="applyInput"
      >
      <span class="letterbox-aspect__current">{{ preview.aspect.toFixed(3) }} : 1</span>
      <OverlayPresetPanel
        :clip-key="row.clipKey"
        :objects="objects"
        track-type="LETTERBOX"
        :duration="timing.duration"
        :groups="['letterbox']"
        :track-index="trackIndex"
        @done="notice = $event"
      />
    </div>

    <div class="letterbox-aspect__ratios">
      <button
        v-for="option in LETTERBOX_ASPECT_OPTIONS"
        :key="option.label"
        type="button"
        :disabled="disabled"
        :class="{ 'letterbox-aspect__ratio--active': Math.abs(option.value - preview.aspect) < 1e-6 }"
        @click="choose(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <p class="letterbox-aspect__note">{{ preview.note }}</p>
    <p class="letterbox-aspect__hint">{{ LETTERBOX_FIELD_NOTE }}</p>
    <p class="letterbox-aspect__hint">
      实例退场时画幅层有 {{ LETTERBOX_FADE_OUT_SECONDS }}s 渐出；空档（无活跃片段）立即复位 aspect=0 / opacity=1，不走渐出。
    </p>

    <OverlayGateBanner track-type="LETTERBOX" :objects="objects" />
    <OverlayGeometrySketch kind="letterbox" :objects="objects" />

    <p v-if="notice !== ''" class="letterbox-aspect__ok" role="status">{{ notice }}</p>
    <p v-if="error !== ''" class="letterbox-aspect__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.letterbox-aspect {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.letterbox-aspect__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.letterbox-aspect__row input {
  width: 90px;
  padding: 2px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.letterbox-aspect__current {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.letterbox-aspect__ratios {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.letterbox-aspect__ratios button {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.letterbox-aspect__ratio--active {
  border-color: var(--accent) !important;
  color: var(--accent) !important;
}

.letterbox-aspect__note {
  margin: 0;
  color: var(--text);
  font-size: 11px;
}

.letterbox-aspect__hint,
.letterbox-aspect__ok,
.letterbox-aspect__error {
  margin: 0;
  font-size: 10px;
}

.letterbox-aspect__hint {
  color: var(--text-muted);
}

.letterbox-aspect__ok {
  color: var(--text-secondary);
}

.letterbox-aspect__error {
  color: var(--error);
}
</style>
