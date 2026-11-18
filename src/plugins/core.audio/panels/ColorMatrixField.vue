<script setup lang="ts">
/**
 * 调色矩阵（10-05）：3×3 网格，每个格子一个数值控件；单位矩阵重置。
 * 单格已有帧时，只在播放头正好落在帧上时写帧值，否则拒绝并指向效果面板。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { MATRIX_PATHS, matrixCells } from '../shared/colorSpec.ts'
import { commitPathValue, currentValueOf, rangeOf } from '../shared/fieldOps.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')

const cells = computed(() => matrixCells())
const range = computed(() => rangeOf(props.row, { min: -2, max: 2, step: 0.001 }))

function valueOf(path: string): number {
  const raw = currentValueOf({ ...props.row, path } as PropertyRow, props.objects)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return 0
}

function frameCount(path: string): number {
  const property = props.objects[path]
  if (typeof property !== 'object' || property === null) return 0
  const frames = (property as Record<string, JsonValue>).keyframes
  return Array.isArray(frames) ? frames.length : 0
}

function onCell(path: string, event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(next)) {
    error.value = `${path} 需要一个有限数字`
    return
  }
  if (next < range.value.min || next > range.value.max) {
    error.value = `${path}=${next} 超出范围 ${range.value.min}..${range.value.max}，未写入`
    return
  }
  const outcome = commitPathValue(ctx.commands, props.row, props.objects, path, next as JsonValue, props.playhead)
  error.value = outcome.ok ? '' : outcome.error ?? '写入被拒绝'
}

function resetIdentity(): void {
  if (props.disabled) return
  const framed = MATRIX_PATHS.filter((path) => frameCount(path) > 0)
  if (framed.length > 0 && !window.confirm('矩阵有通道已设关键帧，清除这些帧并恢复全 0（恒等）？')) {
    return
  }
  const batch: DocCommand[] = MATRIX_PATHS.flatMap((path) => {
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
  <div class="wf-matrix" :data-path="row.path">
    <div class="wf-matrix__head">
      <span class="wf-matrix__corner"></span>
      <span v-for="axis in ['R', 'G', 'B']" :key="`head-${axis}`" class="wf-matrix__axis">{{ axis }}</span>
    </div>
    <div v-for="rowIndex in 3" :key="`row-${rowIndex}`" class="wf-matrix__row">
      <span class="wf-matrix__axis">{{ ['R', 'G', 'B'][rowIndex - 1] }}</span>
      <div
        v-for="cell in cells.filter((entry) => entry.row === rowIndex - 1)"
        :key="cell.path"
        class="wf-matrix__cell"
        :data-path="cell.path"
      >
        <input
          class="wf-matrix__number"
          type="number"
          :min="range.min"
          :max="range.max"
          :step="range.step"
          :value="valueOf(cell.path)"
          :disabled="disabled"
          :aria-label="`矩阵 ${cell.axis}`"
          @change="onCell(cell.path, $event)"
        >
        <span v-if="frameCount(cell.path) > 0" class="wf-matrix__frame" title="该格已有帧">◆{{ frameCount(cell.path) }}</span>
      </div>
    </div>
    <div class="wf-matrix__foot">
      <span class="wf-matrix__hint">参数矩阵：实际矩阵 = 单位阵 + 本表（全 0 = 恒等）；行 = 输出，列 = 输入。</span>
      <button type="button" class="wf-matrix__reset" :disabled="disabled" @click="resetIdentity">重置全 0（单位阵）</button>
    </div>
    <p v-if="error !== ''" class="wf-matrix__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-matrix {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  min-width: 0;
}

.wf-matrix__head,
.wf-matrix__row {
  display: grid;
  grid-template-columns: 18px repeat(3, minmax(0, 1fr));
  gap: 3px;
  align-items: center;
}

.wf-matrix__corner {
  display: block;
}

.wf-matrix__axis {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.wf-matrix__cell {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.wf-matrix__number {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 1px 3px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
}

.wf-matrix__number:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.wf-matrix__frame {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 9px;
}

.wf-matrix__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.wf-matrix__hint {
  color: var(--text-muted);
  font-size: 10px;
}

.wf-matrix__reset {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.wf-matrix__reset:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wf-matrix__error {
  margin: 0;
  color: var(--error);
  font-size: 10px;
}
</style>
