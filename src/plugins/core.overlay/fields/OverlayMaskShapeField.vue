<script setup lang="ts">
/**
 * 遮罩形状控件（09-02 §4.3）：写 `mask_shape` + 删除新形状不适用的几何（只删不加）。
 */
import { computed, ref } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { MASK_SHAPES, maskShapePatch } from '../../../features/overlay/colorMask.ts'
import type { MaskShape } from '../../../features/overlay/colorMask.ts'
import { maskShapeOf } from '../../../features/overlay/layers.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import OverlayGeometrySketch from '../components/OverlayGeometrySketch.vue'
import { ensureExplicitLayerTypeCommands } from '../commit.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const notice = ref('')
const error = ref('')

const current = computed(() => maskShapeOf(props.objects))
const isEnum = computed(() => (MASK_SHAPES as readonly string[]).includes(current.value))

function change(event: Event): void {
  const shape = (event.target as HTMLSelectElement).value as MaskShape
  if (props.disabled) return
  const patch = maskShapePatch(shape)
  const commands: import('../../../core/doc/commands.ts').DocCommand[] = [
    ...ensureExplicitLayerTypeCommands(props.row.clipKey, props.objects, 'mask_shape'),
    { kind: 'object.setValue', clipKey: props.row.clipKey, path: 'mask_shape', value: patch.value },
  ]
  for (const path of patch.remove) {
    commands.push({ kind: 'object.remove', clipKey: props.row.clipKey, path })
  }
  const outcome = ctx.commands.commitBatch(commands, `overlay-mask:${props.row.clipKey}`)
  if (!outcome.ok) {
    error.value = outcome.error ?? '遮罩形状写入失败'
    return
  }
  error.value = ''
  notice.value = patch.remove.length === 0
    ? `已切换为 ${shape}`
    : `已切换为 ${shape}，并移除 ${patch.remove.join('、')}`
}
</script>

<template>
  <div class="overlay-mask">
    <label>
      形状
      <select :value="current" :disabled="disabled" @change="change">
        <option v-for="shape in MASK_SHAPES" :key="shape" :value="shape">{{ shape }}</option>
      </select>
    </label>
    <span v-if="!isEnum" class="overlay-mask__error">mask_shape="{{ current }}" 非法：请选择合法形状</span>
    <span v-if="notice !== ''" class="overlay-mask__ok" role="status">{{ notice }}</span>
    <span v-if="error !== ''" class="overlay-mask__error" role="alert">{{ error }}</span>
    <OverlayGeometrySketch kind="fade" :objects="objects" />
  </div>
</template>

<style scoped>
.overlay-mask {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overlay-mask label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11px;
}

.overlay-mask select {
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.overlay-mask__ok,
.overlay-mask__error {
  font-size: 11px;
}

.overlay-mask__ok {
  color: var(--text-secondary);
}

.overlay-mask__error {
  color: var(--error);
}
</style>
