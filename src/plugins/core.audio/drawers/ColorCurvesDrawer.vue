<script setup lang="ts">
/**
 * 调色曲线抽屉（10-06）：10 条曲线共用一套图形编辑器。
 *
 * 点集 `[[x,y],…]` 要求 0..1、x 严格递增、至少 2 点；运行时用 PCHIP 采样。
 * 编辑只写曲线定义（静态）；逐帧变化写各自强度路径。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { COLOR_CURVES, CURVE_STRENGTHS, curveStrengthPath } from '../shared/colorSpec.ts'
import {
  DEFAULT_CURVE_POINTS,
  clampPointX,
  curvePolyline,
  parseCurvePoints,
  type CurvePoint,
} from '../shared/curveMath.ts'
import { getCurveTarget, subscribeCurveTarget } from '../shared/curveTarget.ts'

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)

const curveKey = ref(getCurveTarget().key ?? 'rgb_curve')
const clipKey = ref<string | null>(getCurveTarget().clipKey ?? ctx.selection.clipKey ?? null)
const error = ref('')
const status = ref('')

const unsubscribe = subscribeCurveTarget((key, targetClip) => {
  if (key !== null) curveKey.value = key
  if (targetClip !== null) clipKey.value = targetClip
})

onBeforeUnmount(unsubscribe)

watch(() => ctx.selection.clipKey, (next) => {
  if (next !== undefined && clipKey.value === null) clipKey.value = next
})

const objects = computed<JsonObject>(() => {
  if (clipKey.value === null) return {}
  return documentService?.clipObjects(clipKey.value) ?? {}
})

function curveRaw(key: string): unknown {
  const property = objects.value[key]
  if (typeof property !== 'object' || property === null) return undefined
  return (property as Record<string, JsonValue>).value
}

const sourcePoints = computed<CurvePoint[]>(() => parseCurvePoints(curveRaw(curveKey.value)).points)
const hasCurve = computed(() => sourcePoints.value.length >= 2)
const draft = ref<CurvePoint[]>([])
const selected = ref<number | null>(null)
const dragging = ref(false)

watch([sourcePoints, curveKey], () => {
  draft.value = sourcePoints.value.map((point) => [point[0], point[1]] as CurvePoint)
  selected.value = null
}, { immediate: true })

const issues = computed(() => parseCurvePoints(draft.value).issues)
const polyline = computed(() => curvePolyline(draft.value.length >= 2 ? draft.value : [], 100, 100, 80))

const strengthPath = computed(() => curveStrengthPath(curveKey.value))
const strengthValue = computed(() => {
  const raw = objects.value[strengthPath.value]
  if (typeof raw !== 'object' || raw === null) return 1
  const value = (raw as Record<string, JsonValue>).value
  return typeof value === 'number' && Number.isFinite(value) ? value : 1
})
const strengthFrames = computed(() => {
  const raw = objects.value[strengthPath.value]
  if (typeof raw !== 'object' || raw === null) return 0
  const frames = (raw as Record<string, JsonValue>).keyframes
  return Array.isArray(frames) ? frames.length : 0
})

const playhead = computed(() => documentService?.sessionView().playhead ?? 0)

function commitPoints(next: readonly CurvePoint[]): boolean {
  if (clipKey.value === null) {
    error.value = '没有选中的片段'
    return false
  }
  const outcome = ctx.commands.commit({
    kind: 'object.setValue',
    clipKey: clipKey.value,
    path: curveKey.value,
    value: next.map((point) => [point[0], point[1]] as JsonValue) as JsonValue,
  })
  if (!outcome.ok) {
    error.value = outcome.error ?? '曲线写入被拒绝'
    return false
  }
  error.value = ''
  return true
}

function commitDraft(): void {
  if (draft.value.length < 2) {
    error.value = '曲线至少需要 2 个点'
    return
  }
  if (issues.value.length > 0) {
    error.value = issues.value[0] ?? '点集无效'
    return
  }
  if (commitPoints(draft.value)) {
    status.value = '已写入曲线定义'
  }
}

const svgRef = ref<SVGSVGElement | null>(null)

function eventPoint(event: PointerEvent): { x: number; y: number } {
  const rect = svgRef.value?.getBoundingClientRect()
  if (rect === undefined || rect === null || rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)),
  }
}

function addPointAt(event: PointerEvent): void {
  if (clipKey.value === null) return
  const point = eventPoint(event)
  const existing = draft.value.findIndex((entry) => Math.abs(entry[0] - point.x) < 1e-4)
  if (existing >= 0) {
    selected.value = existing
    return
  }
  const next = [...draft.value, [point.x, point.y] as CurvePoint]
    .sort((left, right) => left[0] - right[0])
  draft.value = next
  selected.value = next.findIndex((entry) => entry[0] === point.x && entry[1] === point.y)
  commitDraft()
}

function startDrag(index: number, event: PointerEvent): void {
  event.stopPropagation()
  selected.value = index
  dragging.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag)
}

function onPointerMove(event: PointerEvent): void {
  const index = selected.value
  if (!dragging.value || index === null) return
  const point = eventPoint(event)
  const next = draft.value.map((entry) => [entry[0], entry[1]] as CurvePoint)
  const current = next[index]
  if (current === undefined) return
  const clampedX = clampPointX(next, index, point.x)
  current[0] = clampedX
  current[1] = Math.max(0, Math.min(1, point.y))
  draft.value = next
}

function endDrag(): void {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endDrag)
  commitDraft()
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endDrag)
})

function removeSelected(): void {
  const index = selected.value
  if (index === null) return
  if (draft.value.length <= 2) {
    error.value = '至少保留 2 个点；要清空请用“清空该曲线”'
    return
  }
  draft.value = draft.value.filter((_, at) => at !== index)
  selected.value = null
  commitDraft()
}

function resetCurve(): void {
  draft.value = DEFAULT_CURVE_POINTS.map((point) => [point[0], point[1]] as CurvePoint)
  selected.value = null
  commitDraft()
}

function useDefault(): void {
  resetCurve()
}

const currentCurve = computed(() => COLOR_CURVES.find((entry) => entry.key === curveKey.value))

function clearCurve(): void {
  const item = currentCurve.value
  if (item === undefined || clipKey.value === null) return
  if (!window.confirm(`清空「${item.label}」的曲线定义？强度值会保留，摘要将显示“未定义”。`)) return
  const outcome = ctx.commands.commit({
    kind: 'object.setValue',
    clipKey: clipKey.value,
    path: curveKey.value,
    value: null,
  })
  if (!outcome.ok) {
    error.value = outcome.error ?? '清空被拒绝'
    return
  }
  draft.value = []
  selected.value = null
  error.value = ''
  status.value = '已清空该曲线；强度值保留。'
}

function commitStrength(event: Event): void {
  const next = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(next) || next < 0 || next > 1) {
    error.value = '曲线强度需要 0..1'
    return
  }
  if (clipKey.value === null) return
  const property = objects.value[strengthPath.value]
  const frames = typeof property === 'object' && property !== null
    ? (property as Record<string, JsonValue>).keyframes
    : undefined
  if (Array.isArray(frames) && frames.length > 0) {
    const exact = frames.some((frame) => typeof frame === 'object' && frame !== null
      && typeof (frame as Record<string, JsonValue>).time === 'number'
      && Math.abs(((frame as Record<string, JsonValue>).time as number) - playhead.value) <= 1e-6)
    if (!exact) {
      error.value = '该强度已有帧：把播放头移到帧上再改，或到效果面板新增帧'
      return
    }
    const outcome = ctx.commands.commit({
      kind: 'object.setKeyframeValue', clipKey: clipKey.value, path: strengthPath.value,
      time: playhead.value, value: next as JsonValue,
    })
    if (!outcome.ok) error.value = outcome.error ?? '强度写入被拒绝'
    else { error.value = ''; status.value = '已写入强度帧' }
    return
  }
  const outcome = ctx.commands.commit({
    kind: 'object.setValue', clipKey: clipKey.value, path: strengthPath.value, value: next as JsonValue,
  })
  if (!outcome.ok) error.value = outcome.error ?? '强度写入被拒绝'
  else { error.value = ''; status.value = '已写入强度' }
}

const strengthConfig = computed(() => CURVE_STRENGTHS.find((entry) => entry.curve === curveKey.value))
</script>

<template>
  <div class="wf-curves-drawer">
    <header class="wf-curves-drawer__toolbar">
      <label class="wf-curves-drawer__field">
        曲线
        <select v-model="curveKey">
          <option v-for="curve in COLOR_CURVES" :key="curve.key" :value="curve.key">{{ curve.label }}</option>
        </select>
      </label>
      <span class="wf-curves-drawer__clip">{{ clipKey ?? '未选片段' }}</span>
      <button type="button" :disabled="clipKey === null || draft.length < 2" @click="commitDraft">写入定义</button>
      <button type="button" :disabled="selected === null" @click="removeSelected">删除点</button>
      <button type="button" :disabled="clipKey === null" @click="useDefault">线性基准（默认 0→0 / 1→1）</button>
      <button type="button" :disabled="clipKey === null" @click="clearCurve">清空该曲线</button>
    </header>

    <p v-if="clipKey === null" class="wf-curves-drawer__notice">先选一个 CAMERA 或 ADJUST 片段，再编辑曲线。</p>
    <p v-else-if="!hasCurve" class="wf-curves-drawer__notice">
      该曲线尚未设置：点“线性基准（默认 0→0 / 1→1）”写入，或直接在网格里点击加点。
    </p>

    <div class="wf-curves-drawer__body">
      <div class="wf-curves-drawer__canvas">
        <svg
          ref="svgRef"
          class="wf-curves-drawer__svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          @pointerdown.self="addPointAt"
        >
          <line v-for="step in 9" :key="`gx-${step}`" :x1="step * 10" y1="0" :x2="step * 10" y2="100" class="wf-grid" />
          <line v-for="step in 9" :key="`gy-${step}`" x1="0" :y1="step * 10" x2="100" :y2="step * 10" class="wf-grid" />
          <line x1="0" y1="100" x2="100" y2="0" class="wf-diagonal" />
          <polyline v-if="polyline !== ''" :points="polyline" class="wf-curve" />
          <circle
            v-for="(point, index) in draft"
            :key="`pt-${index}`"
            :cx="point[0] * 100"
            :cy="(1 - point[1]) * 100"
            r="1.6"
            class="wf-point"
            :class="{ 'wf-point--active': selected === index }"
            @pointerdown="startDrag(index, $event)"
          />
        </svg>
        <p class="wf-curves-drawer__hint">点击空白加点；拖点为 PCHIP 控制点；x 严格递增、y 与点均在 0..1。</p>
      </div>

      <aside class="wf-curves-drawer__side">
        <label class="wf-curves-drawer__field">
          强度（{{ strengthPath }}）
          <input
            type="range" min="0" max="1" step="0.001"
            :value="strengthValue"
            @change="commitStrength"
          >
        </label>
        <span class="wf-curves-drawer__value">当前 {{ strengthValue.toFixed(3) }}</span>
        <p v-if="strengthFrames > 0" class="wf-curves-drawer__warn">
          强度已有 {{ strengthFrames }} 帧：逐帧变化只改强度；改帧值需播放头在帧上。
        </p>
        <p class="wf-curves-drawer__hint">
          {{ strengthConfig?.path === 'curve_strength' ? 'RGB 复合曲线' : '逐通道曲线' }}；强度 0 = 该曲线整步跳过。
        </p>
        <p class="wf-curves-drawer__hint">曲线定义是静态点集，不随时间变化。</p>
      </aside>
    </div>

    <footer class="wf-curves-drawer__foot">
      <span v-if="status !== ''" class="wf-curves-drawer__ok">{{ status }}</span>
      <span v-if="error !== ''" class="wf-curves-drawer__error" role="alert">{{ error }}</span>
      <span class="wf-curves-drawer__hint">点集：{{ draft.length }} 点</span>
    </footer>
  </div>
</template>

<style scoped>
.wf-curves-drawer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg-panel);
}

.wf-curves-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.wf-curves-drawer__field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.wf-curves-drawer__field select {
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
}

.wf-curves-drawer__clip {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.wf-curves-drawer__toolbar button {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.wf-curves-drawer__toolbar button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wf-curves-drawer__toolbar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wf-curves-drawer__notice {
  margin: 0;
  padding: 6px 10px;
  color: var(--warning);
  font-size: 11px;
}

.wf-curves-drawer__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.wf-curves-drawer__canvas {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  padding: 8px;
}

.wf-curves-drawer__svg {
  flex: 1 1 auto;
  min-height: 180px;
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  touch-action: none;
  cursor: crosshair;
}

.wf-grid {
  stroke: var(--border);
  stroke-width: 0.3;
}

.wf-diagonal {
  stroke: var(--border-strong);
  stroke-width: 0.6;
  stroke-dasharray: 3 3;
}

.wf-curve {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
}

.wf-point {
  fill: var(--accent);
  stroke: var(--bg-panel);
  stroke-width: 0.6;
  cursor: grab;
}

.wf-point--active {
  fill: var(--warning);
}

.wf-curves-drawer__side {
  display: flex;
  flex: 0 0 220px;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-left: 1px solid var(--border);
  overflow-y: auto;
}

.wf-curves-drawer__value {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.wf-curves-drawer__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.wf-curves-drawer__warn {
  margin: 0;
  color: var(--warning);
  font-size: 10px;
}

.wf-curves-drawer__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  border-top: 1px solid var(--border);
}

.wf-curves-drawer__ok {
  color: var(--success, var(--text-secondary));
  font-size: 10px;
}

.wf-curves-drawer__error {
  color: var(--error);
  font-size: 10px;
}
</style>
