<script setup lang="ts">
/**
 * 效果面板局部标尺（06-08）：片段局部秒，不是全局时间。
 *
 * - 有限片段在 0 与 duration 处画边界线；无限片段不画右边界；
 * - 播放头是一条细线加顶部三角，位置由局部播放头时间算出；
 * - 轴外区域用斜纹提示：超出时长的一侧一种斜纹，负时间用另一种更醒目的斜纹；
 * - 刻度从固定序列里按当前缩放选，主刻度带单位。
 *
 * 只读渲染：缩放与平移由外壳处理（`@wheel` 上抛），标尺本身不改视口。
 */
import { computed } from 'vue'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { EffectViewport } from '../../../features/effects/types.ts'
import { timeToX } from '../../../features/effects/viewport.ts'

const props = defineProps<{
  viewport: EffectViewport
  timing: ClipTiming
  playhead: number
}>()

const emit = defineEmits<{ wheel: [event: WheelEvent] }>()

/** 刻度序列（秒）：按当前缩放选一个让间距落在 40–160px 的档。 */
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300] as const

const tickStep = computed(() => {
  const pxPerSecond = props.viewport.pxPerSecond
  for (const step of TICK_STEPS) {
    if (step * pxPerSecond >= 40) {
      return step
    }
  }
  return TICK_STEPS[TICK_STEPS.length - 1]
})

/** 可见时间窗口（用于只生成可见刻度）。 */
const window = computed(() => ({
  from: (0 + props.viewport.scrollLeft) / props.viewport.pxPerSecond + props.viewport.origin,
  to: (props.viewport.width + props.viewport.scrollLeft) / props.viewport.pxPerSecond + props.viewport.origin,
}))

const ticks = computed(() => {
  const step = tickStep.value
  const { from, to } = window.value
  const start = Math.ceil(from / step) * step
  const result: Array<{ time: number; x: number; major: boolean }> = []
  for (let time = start; time <= to; time += step) {
    // 浮点累加会产生 0.30000000000000004；按 step 精度归一。
    const normalized = Number(time.toFixed(6))
    result.push({
      time: normalized,
      x: timeToX(normalized, props.viewport),
      major: Math.abs(normalized % (step * 5)) < 1e-6,
    })
  }
  return result
})

const playheadX = computed(() => timeToX(props.playhead, props.viewport))

const durationX = computed(() =>
  props.timing.infinite ? null : timeToX(Math.max(0, props.timing.duration), props.viewport))

const zeroX = computed(() => timeToX(0, props.viewport))
const zeroVisible = computed(() => zeroX.value >= 0 && zeroX.value <= props.viewport.width)
const durationVisible = computed(() =>
  durationX.value !== null && durationX.value >= 0 && durationX.value <= props.viewport.width + 1e-6)

/** 超出时长的区域（左边界 = 时长；右侧延伸到可见末端）。 */
const outOfRangeStart = computed(() => (durationX.value === null ? null : Math.max(0, durationX.value)))

function formatTick(time: number, step: number): string {
  if (step >= 1) {
    return `${Math.round(time)}s`
  }
  return `${time.toFixed(step < 0.5 ? 2 : 1)}s`
}

function isBoundaryTick(time: number): boolean {
  if (Math.abs(time) <= 1e-6) {
    return true
  }
  return !props.timing.infinite && Math.abs(time - props.timing.duration) <= 1e-6
}

function onWheel(event: WheelEvent): void {
  emit('wheel', event)
}
</script>

<template>
  <div class="fx-ruler" role="presentation" @wheel="onWheel">
    <!-- 轴外区域：超出时长的一侧 -->
    <div
      v-if="outOfRangeStart !== null"
      class="fx-ruler__outside"
      :style="{ left: `${outOfRangeStart}px`, width: `${Math.max(0, props.viewport.width - outOfRangeStart)}px` }"
      aria-hidden="true"
    />
    <!-- 负时间：更醒目的斜纹 -->
    <div
      v-if="zeroX > 0"
      class="fx-ruler__negative"
      :style="{ left: '0px', width: `${zeroX}px` }"
      aria-hidden="true"
    />

    <div
      v-for="tick in ticks"
      :key="tick.time"
      class="fx-ruler__tick"
      :class="{ 'fx-ruler__tick--major': tick.major }"
      :style="{ left: tick.x + 'px' }"
    >
      <span v-if="tick.major && !isBoundaryTick(tick.time)" class="fx-ruler__label">{{ formatTick(tick.time, tickStep) }}</span>
    </div>

    <!-- 有限片段的左右边界 -->
    <div
      v-if="zeroVisible"
      class="fx-ruler__edge"
      :style="{ left: zeroX + 'px' }"
      aria-hidden="true"
    />
    <div
      v-if="durationVisible && durationX !== null"
      class="fx-ruler__edge fx-ruler__edge--end"
      :style="{ left: durationX + 'px' }"
      aria-hidden="true"
    />

    <span v-if="zeroVisible" class="fx-ruler__bound-label" :style="{ left: (zeroX + 3) + 'px' }">0s</span>
    <span
      v-if="durationVisible && durationX !== null && timing.duration > 0"
      class="fx-ruler__bound-label fx-ruler__bound-label--end"
      :style="{ left: (durationX - 3) + 'px' }"
    >
      {{ timing.duration }}s
    </span>

    <div
      v-if="playheadX >= 0 && playheadX <= props.viewport.width"
      class="fx-ruler__playhead"
      :style="{ left: `${playheadX}px` }"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.fx-ruler {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  height: 22px;
  overflow: hidden;
  background: var(--bg-raised);
  cursor: ew-resize;
}

.fx-ruler__outside,
.fx-ruler__negative {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}

/* 超出时长：稀疏斜纹。 */
.fx-ruler__outside {
  background-image: repeating-linear-gradient(
    45deg,
    transparent 0 6px,
    var(--border) 6px 7px
  );
  opacity: 0.55;
}

/* 负时间：更密集、更醒目的斜纹（时间不可能为负，这是非法区域提示）。 */
.fx-ruler__negative {
  background-image: repeating-linear-gradient(
    -45deg,
    transparent 0 3px,
    var(--error) 3px 5px
  );
  opacity: 0.3;
}

.fx-ruler__tick {
  position: absolute;
  top: 12px;
  bottom: 0;
  width: 1px;
  background: var(--border);
}

.fx-ruler__tick--major {
  top: 8px;
  background: var(--border-strong);
}

.fx-ruler__label {
  position: absolute;
  top: -10px;
  left: 2px;
  color: var(--text-muted);
  font-size: 9px;
  white-space: nowrap;
}

.fx-ruler__bound-label {
  position: absolute;
  top: 4px;
  z-index: 2;
  padding: 0 2px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 10px;
  pointer-events: none;
}

.fx-ruler__bound-label--end {
  transform: translateX(-100%);
}

.fx-ruler__edge {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--text-secondary);
}

.fx-ruler__edge--end {
  background: var(--accent);
}

.fx-ruler__playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--accent);
  pointer-events: none;
}

.fx-ruler__playhead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -3px;
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-top: 5px solid var(--accent);
}
</style>
