<script setup lang="ts">
/**
 * 六色带（10-05）：每带一行（色相偏移 -1..1、饱和度增量 0..1），共 12 个通道。
 * 运行时口径（`ic_color_adjust.fsh` 第 17 步）：带权重为升余弦锥形，色相 ±1 = ±180°。
 */
import { ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { HUE_BANDS } from '../shared/colorSpec.ts'
import { commitPathValue, currentValueOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')

const colors: Record<string, string> = {
  红: '#d94b4b', 黄: '#d9c24b', 绿: '#4bd96b',
  青: '#4bd9d9', 蓝: '#4b7bd9', 品红: '#d94bd9',
}

function valueOf(path: string): number {
  const raw = currentValueOf({ ...props.row, path } as PropertyRow, props.objects)
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function frameCount(path: string): number {
  const property = props.objects[path]
  if (typeof property !== 'object' || property === null) return 0
  const frames = (property as Record<string, JsonValue>).keyframes
  return Array.isArray(frames) ? frames.length : 0
}

function onChannel(path: string, min: number, max: number, event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(next)) {
    error.value = `${path} 需要一个有限数字`
    return
  }
  if (next < min || next > max) {
    error.value = `${path}=${next} 超出范围 ${min}..${max}，未写入`
    return
  }
  const outcome = commitPathValue(ctx.commands, props.row, props.objects, path, next as JsonValue, props.playhead)
  error.value = outcome.ok ? '' : outcome.error ?? '写入被拒绝'
}

function resetAll(): void {
  if (props.disabled) return
  const framed = HUE_BANDS.flatMap((band) => [band.hue, band.sat]).filter((path) => frameCount(path) > 0)
  if (framed.length > 0 && !window.confirm('六色带有关键帧，清除这些帧并全部归 0？')) {
    return
  }
  const batch: DocCommand[] = HUE_BANDS.flatMap((band) => [band.hue, band.sat]).flatMap((path) => {
    const commands: DocCommand[] = []
    if (frameCount(path) > 0) {
      commands.push({ kind: 'object.disableAnimation', clipKey: props.row.clipKey, path })
    }
    commands.push({ kind: 'object.setValue', clipKey: props.row.clipKey, path, value: 0 })
    return commands
  })
  const outcome = ctx.commands.commitBatch(batch)
  if (!outcome.ok) {
    error.value = outcome.error ?? '重置被拒绝'
    return
  }
  error.value = ''
}
</script>

<template>
  <div class="wf-bands" :data-path="row.path">
    <div class="wf-bands__head">
      <span class="wf-bands__axis">色带</span>
      <span class="wf-bands__axis">色相 ±180°</span>
      <span class="wf-bands__axis">饱和增量</span>
    </div>
    <div v-for="band in HUE_BANDS" :key="band.name" class="wf-bands__row">
      <span class="wf-bands__name">
        <i class="wf-bands__swatch" :style="{ background: colors[band.name] }"></i>{{ band.name }}
      </span>
      <span class="wf-bands__slider">
        <input
          type="range" min="-1" max="1" step="0.001"
          :value="valueOf(band.hue)" :disabled="disabled"
          :aria-label="`${band.name} 色相`"
          @change="onChannel(band.hue, -1, 1, $event)"
        >
        <input
          class="wf-bands__number" type="number" min="-1" max="1" step="0.001"
          :value="valueOf(band.hue)" :disabled="disabled"
          @change="onChannel(band.hue, -1, 1, $event)"
        >
        <span v-if="frameCount(band.hue) > 0" class="wf-bands__frame" title="该通道已有帧">◆</span>
      </span>
      <span class="wf-bands__slider">
        <input
          type="range" min="0" max="1" step="0.001"
          :value="valueOf(band.sat)" :disabled="disabled"
          :aria-label="`${band.name} 饱和度`"
          @change="onChannel(band.sat, 0, 1, $event)"
        >
        <input
          class="wf-bands__number" type="number" min="0" max="1" step="0.001"
          :value="valueOf(band.sat)" :disabled="disabled"
          @change="onChannel(band.sat, 0, 1, $event)"
        >
        <span v-if="frameCount(band.sat) > 0" class="wf-bands__frame" title="该通道已有帧">◆</span>
      </span>
    </div>
    <div class="wf-bands__foot">
      <span class="wf-bands__hint">六带各撑 ±30°，边界平滑交叠；全 0 = 整步跳过。</span>
      <button type="button" class="wf-bands__reset" :disabled="disabled" @click="resetAll">全部归 0</button>
    </div>
    <p v-if="error !== ''" class="wf-bands__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-bands {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  min-width: 0;
}

.wf-bands__head,
.wf-bands__row {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) minmax(0, 1fr);
  gap: 4px;
  align-items: center;
}

.wf-bands__axis {
  color: var(--text-muted);
  font-size: 9px;
}

.wf-bands__name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 10px;
}

.wf-bands__swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.wf-bands__slider {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.wf-bands__slider input[type='range'] {
  flex: 1 1 auto;
  min-width: 24px;
  accent-color: var(--accent);
}

.wf-bands__number {
  flex: 0 0 46px;
  width: 46px;
  box-sizing: border-box;
  padding: 1px 3px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
}

.wf-bands__frame {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 9px;
}

.wf-bands__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.wf-bands__hint {
  color: var(--text-muted);
  font-size: 10px;
}

.wf-bands__reset {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.wf-bands__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}
</style>
