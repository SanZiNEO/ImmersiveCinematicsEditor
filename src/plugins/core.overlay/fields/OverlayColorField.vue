<script setup lang="ts">
/**
 * 基色控件（09-02 §4.2）：色板 + 十六进制输入共用 `color`。
 *
 * - 只写 `color`，不写任何通道；选色不会自动建关键帧。
 * - 任一通道有帧时，hex 只显示播放头合成色且只读（改色请逐通道打帧）。
 * - 渐变存在时本行会被层类型过滤隐藏（基色只是回退值）。
 */
import { computed, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { baseColorOf, baseColorPatch, colorHexView, hexToRgb } from '../../../features/overlay/colorMask.ts'
import { explicitValue } from '../../../features/overlay/layers.ts'
import { sampleValue } from '../../../features/effects/easing.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { commitField, ensureExplicitLayerTypeCommands } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const draft = ref('')
const error = ref('')
const notice = ref('')

function channelState(path: string): { explicit: number | null; frames: readonly import('../../../core/doc/types.ts').ObjectKeyframe[] } {
  const raw = props.objects[path]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { explicit: null, frames: [] }
  }
  const record = raw as Record<string, unknown>
  const explicit = typeof record.value === 'number' && Number.isFinite(record.value) ? record.value : null
  const frames = Array.isArray(record.keyframes) ? record.keyframes as import('../../../core/doc/types.ts').ObjectKeyframe[] : []
  return { explicit, frames }
}

const channels = computed(() => {
  const base = hexToRgb(baseColorOfValue()) ?? [0, 0, 0]
  const read = (path: string, fallback: number): number => {
    const state = channelState(path)
    if (state.frames.length > 0) {
      const sampled = sampleValue({ frames: state.frames, interp: 'linear', time: props.playhead, timing: props.timing })
      return sampled.ok && typeof sampled.value === 'number' ? sampled.value : fallback
    }
    return state.explicit ?? fallback
  }
  return {
    r: read('color.r', base[0] / 255),
    g: read('color.g', base[1] / 255),
    b: read('color.b', base[2] / 255),
    animated: ['color.r', 'color.g', 'color.b'].some((path) => channelState(path).frames.length > 0),
    overridden: ['color.r', 'color.g', 'color.b'].some((path) => channelState(path).explicit !== null),
  }
})

function baseColorOfValue(): string {
  const explicit = explicitValue(props.objects, 'color')
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : '#000000'
}

const view = computed(() => colorHexView(props.objects, channels.value))

watch(view, (next) => {
  draft.value = next.hex
}, { immediate: true })

function apply(input: string): void {
  if (props.disabled) return
  const patch = baseColorPatch(input)
  if (!patch.ok) {
    error.value = patch.message
    return
  }
  if (patch.patch.value === baseColorOf(props.objects)) {
    error.value = ''
    notice.value = '颜色未变化'
    return
  }
  const outcome = commitField(
    ctx.commands,
    props.row.clipKey,
    'color',
    patch.patch.value,
    `overlay-color:${props.row.clipKey}`,
    ensureExplicitLayerTypeCommands(props.row.clipKey, props.objects, 'color'),
  )
  if (!outcome.ok) {
    error.value = outcome.error ?? '颜色写入失败'
    return
  }
  error.value = ''
  notice.value = `已写入 ${patch.patch.value}`
  draft.value = patch.patch.value as string
}

function onHexCommit(): void {
  apply(draft.value)
}

function onSwatch(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  apply(value)
}
</script>

<template>
  <div class="overlay-color">
    <input
      type="color"
      class="overlay-color__swatch"
      :value="view.hex"
      :disabled="disabled || !view.editable"
      aria-label="基色色板"
      @change="onSwatch"
    >
    <input
      v-model="draft"
      type="text"
      class="overlay-color__hex"
      :disabled="disabled || !view.editable"
      aria-label="基色十六进制"
      spellcheck="false"
      @blur="onHexCommit"
      @keydown.enter.prevent="onHexCommit"
    >
    <span class="overlay-color__preview" :style="{ background: view.hex }" aria-hidden="true" />
    <span v-if="view.note !== null" class="overlay-color__note">{{ view.note }}</span>
    <span class="overlay-color__hint">基色 = color（#RRGGBB）；color.r / g / b 的显式值逐通道优先，未声明的通道回落基色。改 hex 只改 color，不覆盖已声明的通道。</span>
    <span v-if="notice !== ''" class="overlay-color__ok" role="status">{{ notice }}</span>
    <span v-if="error !== ''" class="overlay-color__error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.overlay-color {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.overlay-color__swatch {
  width: 30px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
}

.overlay-color__hex {
  width: 92px;
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.overlay-color__preview {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
}

.overlay-color__note,
.overlay-color__ok,
.overlay-color__error,
.overlay-color__hint {
  flex: 1 1 100%;
  font-size: 11px;
}

.overlay-color__hint {
  color: var(--text-secondary);
}

.overlay-color__note {
  color: var(--text-muted);
}

.overlay-color__ok {
  color: var(--text-secondary);
}

.overlay-color__error {
  color: var(--error);
}
</style>
