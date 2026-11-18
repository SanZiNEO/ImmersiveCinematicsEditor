<script setup lang="ts">
/**
 * 路径预览画布（07-10）。
 *
 * 只渲染与转发：投影切换 / 采样点 / 切线 / 适配视图等本地状态在组件内；
 * 游戏检查按钮转成 emit，由父面板调既有的 pushPreview / seekPreview，不新增消息。
 */
import { computed, ref } from 'vue'
import type { PathAxis, PathPreviewModel } from '../../../core/paths/types.ts'
import {
  buildCanvasGeometry,
  fitView,
  oneToOneView,
  applyTransform,
  pointsToPath,
  type CanvasOptions,
  type ProjectionPair,
} from '../../../features/paths/previewCanvas.ts'

const props = defineProps<{
  model: PathPreviewModel | null
  entryAxes: PathAxis[]
  space: 'world' | 'base'
  fromTime: number
  toTime: number
}>()

const emit = defineEmits<{
  push: []
  seek: [time: number]
  recomputeEndpoints: []
}>()

const WIDTH = 320
const HEIGHT = 180
const MARGIN = 18

const pair = ref<ProjectionPair>('xz')
const showSamples = ref(true)
const showTangents = ref(true)
const fitMode = ref<'fit' | '1to1'>('fit')

const options = computed<CanvasOptions>(() => ({
  pair: pair.value,
  space: props.space,
  showSamples: showSamples.value,
  showTangents: showTangents.value,
}))

const geometry = computed(() => buildCanvasGeometry(props.model, props.entryAxes, options.value))

const transform = computed(() => {
  const bounds = geometry.value.bounds
  return fitMode.value === 'fit'
    ? fitView(bounds, WIDTH, HEIGHT, MARGIN)
    : oneToOneView(bounds, WIDTH, HEIGHT)
})

const curvePath = computed(() => pointsToPath(geometry.value.curve, transform.value))
const controlPath = computed(() => geometry.value.controlPolygon === null
  ? ''
  : pointsToPath(geometry.value.controlPolygon, transform.value))

function mapped(point: { x: number; y: number }): { x: number; y: number } {
  return applyTransform(point, transform.value)
}

const pairOptions: Array<{ value: ProjectionPair; label: string }> = [
  { value: 'xz', label: 'x / z' },
  { value: 'xy', label: 'x / y' },
  { value: 'yz', label: 'y / z' },
]

const timingPoints = computed(() => geometry.value.timingCurve
  .map((point) => `${(point.x * 96).toFixed(2)},${(36 - point.y * 36).toFixed(2)}`)
  .join(' '))

const hiddenNote = computed(() => {
  if (geometry.value.mode !== '2d' || geometry.value.hiddenAxis === null) {
    return ''
  }
  return `2D 投影，未显示 ${geometry.value.hiddenAxis}`
})
</script>

<template>
  <div class="preview-canvas">
    <div class="preview-canvas__toolbar">
      <select v-model="pair" class="preview-canvas__select" aria-label="投影平面">
        <option v-for="option in pairOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <label class="preview-canvas__check">
        <input v-model="showSamples" type="checkbox" />采样点
      </label>
      <label class="preview-canvas__check">
        <input v-model="showTangents" type="checkbox" />切线
      </label>
      <button type="button" class="preview-canvas__btn" :class="{ 'is-active': fitMode === 'fit' }" @click="fitMode = 'fit'">适配视图</button>
      <button type="button" class="preview-canvas__btn" :class="{ 'is-active': fitMode === '1to1' }" @click="fitMode = '1to1'">1:1</button>
    </div>

    <div class="preview-canvas__meta">
      <span class="preview-canvas__badge">{{ model?.anchorLabel ?? '无预览' }}</span>
      <span v-if="hiddenNote" class="preview-canvas__note">{{ hiddenNote }}</span>
      <span v-if="geometry.mode === '1d'" class="preview-canvas__note">一维图：横轴 u，纵轴 {{ geometry.verticalAxis }}</span>
    </div>

    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="preview-canvas__svg" role="img" aria-label="路径预览画布">
      <line :x1="0" :y1="HEIGHT / 2" :x2="WIDTH" :y2="HEIGHT / 2" class="preview-canvas__guide" />
      <line :x1="WIDTH / 2" :y1="0" :x2="WIDTH / 2" :y2="HEIGHT" class="preview-canvas__guide" />

      <polyline v-if="controlPath" :points="controlPath" class="preview-canvas__control" />
      <path v-if="curvePath" :d="curvePath" class="preview-canvas__curve" />

      <line
        v-if="geometry.deviations.start > 1e-6"
        :x1="mapped(geometry.start).x" :y1="mapped(geometry.start).y"
        :x2="mapped(geometry.geometryStart).x" :y2="mapped(geometry.geometryStart).y"
        class="preview-canvas__deviation"
      />
      <line
        v-if="geometry.deviations.end > 1e-6"
        :x1="mapped(geometry.end).x" :y1="mapped(geometry.end).y"
        :x2="mapped(geometry.geometryEnd).x" :y2="mapped(geometry.geometryEnd).y"
        class="preview-canvas__deviation"
      />

      <g v-for="sample in geometry.samples" :key="sample.u">
        <line
          v-if="sample.tangent !== null"
          :x1="mapped(sample.point).x"
          :y1="mapped(sample.point).y"
          :x2="mapped({ x: sample.point.x + sample.tangent.x * 0.08, y: sample.point.y + sample.tangent.y * 0.08 }).x"
          :y2="mapped({ x: sample.point.x + sample.tangent.x * 0.08, y: sample.point.y + sample.tangent.y * 0.08 }).y"
          class="preview-canvas__tangent"
        />
        <circle :cx="mapped(sample.point).x" :cy="mapped(sample.point).y" r="2" class="preview-canvas__sample" />
      </g>

      <circle :cx="mapped(geometry.start).x" :cy="mapped(geometry.start).y" r="4" class="preview-canvas__start" />
      <circle :cx="mapped(geometry.end).x" :cy="mapped(geometry.end).y" r="4" class="preview-canvas__end" />
      <circle :cx="mapped(geometry.geometryStart).x" :cy="mapped(geometry.geometryStart).y" r="3" class="preview-canvas__geometry" />
      <circle :cx="mapped(geometry.geometryEnd).x" :cy="mapped(geometry.geometryEnd).y" r="3" class="preview-canvas__geometry" />
    </svg>

    <div class="preview-canvas__timing">
      <span class="preview-canvas__label">s(t)</span>
      <svg viewBox="0 0 96 36" class="preview-canvas__timing-svg">
        <polyline :points="timingPoints" class="preview-canvas__timing-line" />
      </svg>
    </div>

    <ul v-if="geometry.warnings.length > 0" class="preview-canvas__warnings">
      <li v-for="(warning, index) in geometry.warnings" :key="index">{{ warning }}</li>
    </ul>

    <div class="preview-canvas__actions">
      <button type="button" class="preview-canvas__btn" @click="emit('push')">推送当前脚本</button>
      <button type="button" class="preview-canvas__btn" @click="emit('seek', fromTime)">定位起点</button>
      <button type="button" class="preview-canvas__btn" @click="emit('seek', toTime)">定位终点</button>
      <button type="button" class="preview-canvas__btn" @click="emit('recomputeEndpoints')">按几何重算端点</button>
    </div>
  </div>
</template>

<style scoped>
.preview-canvas {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.preview-canvas__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.preview-canvas__select,
.preview-canvas__btn {
  background: var(--bg-hover);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text);
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
}

.preview-canvas__btn.is-active {
  border-color: var(--accent);
  color: var(--accent);
}

.preview-canvas__check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text);
}

.preview-canvas__meta {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}

.preview-canvas__badge {
  color: var(--text-muted);
}

.preview-canvas__note {
  color: var(--text-muted);
}

.preview-canvas__svg {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
}

.preview-canvas__guide {
  stroke: var(--border);
  stroke-width: 1;
}

.preview-canvas__control {
  fill: none;
  stroke: var(--text-muted);
  stroke-dasharray: 4 3;
  stroke-width: 1;
}

.preview-canvas__curve {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
}

.preview-canvas__deviation {
  stroke: var(--warning);
  stroke-dasharray: 3 3;
  stroke-width: 1;
}

.preview-canvas__tangent {
  stroke: var(--text-muted);
  stroke-width: 1;
}

.preview-canvas__sample {
  fill: var(--text-muted);
}

.preview-canvas__start {
  fill: #3fb950;
}

.preview-canvas__end {
  fill: #58a6ff;
}

.preview-canvas__geometry {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1;
}

.preview-canvas__timing {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-canvas__label {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.preview-canvas__timing-svg {
  width: 96px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.preview-canvas__timing-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
}

.preview-canvas__warnings {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--warning);
}

.preview-canvas__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
