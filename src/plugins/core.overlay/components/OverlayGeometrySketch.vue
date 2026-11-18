<script setup lang="ts">
/**
 * 覆盖层几何示意（09-02 / 09-03 / 09-05 / 09-06）。
 *
 * 只表达框、圆、方向与取材范围；不加载素材、不做像素合成，界面上不出现「游戏画面预览」。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import {
  DEFAULT_BASE_HEIGHT,
  DEFAULT_BASE_WIDTH,
  fadeSketch,
  gradientAngleVector,
  imageSketch,
  subtitleSketch,
} from '../../../features/overlay/geometry.ts'
import { letterboxPreview } from '../../../features/overlay/letterbox.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  kind: 'fade' | 'image' | 'subtitle' | 'letterbox'
  objects: JsonObject
}>()

const W = 320
const H = 180
const INSET = 96
const INSET_H = 54

const ctx = usePanelContext()
const documents = ctx.services.get(DOCUMENT_SERVICE)

/** 基准分辨率来自脚本 meta；缺省 / 非法按 1920×1080。 */
const baseResolution = computed(() => {
  void ctx.docRevision
  const raw = documents?.metaObject()?.base_resolution
  const readPair = (value: unknown): { w: number; h: number } | null => {
    if (!isJsonObject(value)) return null
    const inner = isJsonObject(value.value) ? value.value : value
    return typeof inner.w === 'number' && Number.isFinite(inner.w) &&
      typeof inner.h === 'number' && Number.isFinite(inner.h)
      ? { w: inner.w, h: inner.h }
      : null
  }
  return readPair(raw) ?? { w: DEFAULT_BASE_WIDTH, h: DEFAULT_BASE_HEIGHT }
})

const fade = computed(() => fadeSketch(props.objects))
const image = computed(() => imageSketch(props.objects, W, H, baseResolution.value.w, baseResolution.value.h))
const subtitle = computed(() => subtitleSketch(props.objects, W, H, baseResolution.value.w, baseResolution.value.h))
const bars = computed(() => letterboxPreview(props.objects, W, H))

const maskRect = computed(() => {
  const mask = fade.value.mask
  if (mask === null) return null
  return {
    x: mask.x * W,
    y: mask.y * H,
    width: Math.max(0, mask.width * W),
    height: Math.max(0, mask.height * H),
  }
})

const gradientLine = computed(() => {
  if (fade.value.gradientType === null || fade.value.gradientCenter === null) return null
  const center = fade.value.gradientCenter
  const vector = gradientAngleVector(fade.value.gradientAngle)
  const half = 0.5
  return {
    x1: (center.x - vector.x * half) * W,
    y1: (center.y - vector.y * half) * H,
    x2: (center.x + vector.x * half) * W,
    y2: (center.y + vector.y * half) * H,
    cx: center.x * W,
    cy: center.y * H,
    r: Math.max(0, (fade.value.gradientRadius ?? 0) * Math.min(W, H)),
  }
})

const imageElement = computed(() => ({
  x: image.value.element.x * W,
  y: image.value.element.y * H,
  width: Math.max(0, image.value.element.width * W),
  height: Math.max(0, image.value.element.height * H),
}))

const cropRect = computed(() => ({
  x: image.value.crop.x * INSET,
  y: image.value.crop.y * INSET_H,
  width: Math.max(0, image.value.crop.width * INSET),
  height: Math.max(0, image.value.crop.height * INSET_H),
}))

const subtitleRect = computed(() => ({
  x: subtitle.value.element.x * W,
  y: subtitle.value.element.y * H,
  width: Math.max(0, subtitle.value.element.width * W),
  height: Math.max(0, subtitle.value.element.height * H),
}))

const issues = computed<string[]>(() => {
  if (props.kind === 'fade') {
    return fade.value.issues
  }
  if (props.kind === 'image') {
    return image.value.cropIssues
  }
  if (props.kind === 'subtitle') {
    return subtitle.value.hints
  }
  return []
})
</script>

<template>
  <figure class="overlay-sketch">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${kind} 层几何示意`">
      <rect x="0" y="0" :width="W" :height="H" class="overlay-sketch__screen" />
      <line x1="0" :y1="H / 2" :x2="W" :y2="H / 2" class="overlay-sketch__guide" />
      <line :x1="W / 2" y1="0" :x2="W / 2" :y2="H" class="overlay-sketch__guide" />

      <!-- fade：遮罩 + 渐变 -->
      <template v-if="kind === 'fade'">
        <rect
          v-if="maskRect !== null"
          :x="maskRect.x" :y="maskRect.y" :width="maskRect.width" :height="maskRect.height"
          class="overlay-sketch__mask"
        />
        <circle
          v-if="fade.maskShape === 'circle' && fade.mask !== null"
          :cx="(fade.mask.x + fade.mask.width / 2) * W"
          :cy="(fade.mask.y + fade.mask.height / 2) * H"
          :r="Math.max(0, fade.mask.width / 2 * Math.min(W, H))"
          class="overlay-sketch__mask overlay-sketch__mask--circle"
        />
        <line
          v-if="gradientLine !== null"
          :x1="gradientLine.x1" :y1="gradientLine.y1" :x2="gradientLine.x2" :y2="gradientLine.y2"
          class="overlay-sketch__gradient"
        />
        <circle
          v-if="gradientLine !== null && fade.gradientType === 'radial'"
          :cx="gradientLine.cx" :cy="gradientLine.cy" :r="gradientLine.r"
          class="overlay-sketch__gradient-circle"
        />
        <text x="8" y="16" class="overlay-sketch__label">
          {{ fade.maskShape }}{{ fade.gradientType === null ? '' : ` · ${fade.gradientType}` }}
        </text>
      </template>

      <!-- image：元素框 + 取材框 -->
      <template v-else-if="kind === 'image'">
        <rect
          :x="imageElement.x" :y="imageElement.y" :width="imageElement.width" :height="imageElement.height"
          class="overlay-sketch__element"
        />
        <g :transform="`translate(${W - INSET - 6}, ${H - INSET_H - 6})`">
          <rect x="0" y="0" :width="INSET" :height="INSET_H" class="overlay-sketch__source" />
          <rect
            :x="cropRect.x" :y="cropRect.y" :width="cropRect.width" :height="cropRect.height"
            class="overlay-sketch__crop"
          />
          <text x="2" y="10" class="overlay-sketch__label">取材</text>
        </g>
        <text x="8" y="16" class="overlay-sketch__label">元素框（素材无真实尺寸，按基准 {{ baseResolution.w }}×{{ baseResolution.h }} 假定）</text>
      </template>

      <!-- subtitle：文字块 -->
      <template v-else-if="kind === 'subtitle'">
        <rect
          :x="subtitleRect.x" :y="subtitleRect.y" :width="subtitleRect.width" :height="subtitleRect.height"
          class="overlay-sketch__element"
        />
      </template>

      <!-- letterbox：黑边 -->
      <template v-else>
        <rect x="0" y="0" :width="W" :height="bars.top * H" class="overlay-sketch__bar" />
        <rect x="0" :y="H - bars.bottom * H" :width="W" :height="bars.bottom * H" class="overlay-sketch__bar" />
        <rect x="0" y="0" :width="bars.left * W" :height="H" class="overlay-sketch__bar" />
        <rect :x="W - bars.right * W" y="0" :width="bars.right * W" :height="H" class="overlay-sketch__bar" />
        <text x="8" y="16" class="overlay-sketch__label">
          {{ bars.aspect.toFixed(2) }}:1{{ bars.visible ? '' : '（不绘制）' }}
        </text>
      </template>
    </svg>
    <figcaption v-if="issues.length > 0" class="overlay-sketch__hints">
      {{ issues.join('；') }}
    </figcaption>
  </figure>
</template>

<style scoped>
.overlay-sketch {
  margin: 0;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

.overlay-sketch svg {
  display: block;
  width: min(100%, 320px);
  height: auto;
}

.overlay-sketch__screen {
  fill: var(--bg-raised);
  stroke: var(--border-strong);
  stroke-width: 1;
}

.overlay-sketch__guide {
  stroke: var(--border);
  stroke-dasharray: 3 3;
  stroke-width: 1;
}

.overlay-sketch__mask {
  fill: color-mix(in srgb, var(--accent) 12%, transparent);
  stroke: var(--accent);
  stroke-width: 1;
}

.overlay-sketch__mask--circle {
  fill: color-mix(in srgb, var(--accent) 18%, transparent);
}

.overlay-sketch__gradient {
  stroke: var(--accent);
  stroke-width: 2;
}

.overlay-sketch__gradient-circle {
  fill: none;
  stroke: var(--accent);
  stroke-dasharray: 4 3;
  stroke-width: 1;
}

.overlay-sketch__element {
  fill: color-mix(in srgb, var(--warning) 16%, transparent);
  stroke: var(--warning);
  stroke-width: 1;
}

.overlay-sketch__source {
  fill: var(--bg-panel);
  stroke: var(--border-strong);
  stroke-width: 1;
}

.overlay-sketch__crop {
  fill: color-mix(in srgb, var(--accent) 20%, transparent);
  stroke: var(--accent);
  stroke-width: 1;
}

.overlay-sketch__bar {
  fill: var(--text);
  opacity: 0.72;
}

.overlay-sketch__label {
  fill: var(--text-secondary);
  font-size: 9px;
}

.overlay-sketch__hints {
  margin: 3px 2px 0;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
