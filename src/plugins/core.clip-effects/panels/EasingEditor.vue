<script setup lang="ts">
/**
 * 段缓动编辑器（06-06）：两个相邻节点之间的作者态缓动。
 *
 * 规则（都来自 `easing.ts` / `easingStore.ts`，本组件不自己插值）：
 * - 缓动挂在段上：首节点之前 / 末节点之后没有入口，只有一条记录的段没有入口；
 * - 台阶插值的段不显示贝塞尔把手，只显示台阶标记；事件行没有段缓动；
 * - 切到线性时把手值保留但灰显，切回贝塞尔恢复上次把手；
 * - 把手横坐标限制 0..1，纵坐标允许超出（过冲）；
 * - 数值输入失焦提交；拖动把手实时预览，松手写入一次会话状态（串身份合并）；
 * - 烘焙用 `bakeSegment` 采样，再提交 `object.bakeEasing`；成功后清掉该段的会话缓动。
 *
 * 会话缓动只进撤销栈、不写盘；所有文档写入走 `ctx.commands.commit`。
 */
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_EASING_HANDLES,
  easingKey,
  readEasingTable,
  removeEasingMutator,
  writeEasingMutator,
} from '../../../features/effects/easingStore.ts'
import { bakeSegment, normalizeHandle, sampleValue } from '../../../features/effects/easing.ts'
import { clipTimingOf, findClipContext, propertyRowsFor } from '../../../features/effects/clipContext.ts'
import { DEFAULT_VIEWPORT } from '../../../features/effects/viewport.ts'
import type { EasingHandle, EasingMode, PropertyRow } from '../../../features/effects/types.ts'
import type { JsonValue } from '../../../core/doc/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'

const props = defineProps<{
  clipKey: string
  path: string
  fromTime: number
  toTime: number
  /** 当前效果面板的缩放（烘焙采样密度用）；缺省用默认视口。 */
  pxPerSecond?: number
}>()

const emit = defineEmits<{ close: [] }>()

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.require(CATALOG_SERVICE)

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const clipContext = computed(() => findClipContext(view.value, props.clipKey))

const row = computed<PropertyRow | null>(() => {
  const found = clipContext.value
  if (found === null) {
    return null
  }
  const objects = documentService?.clipObjects(props.clipKey)
  if (objects === null || objects === undefined) {
    return null
  }
  const rows = propertyRowsFor({
    clipKey: props.clipKey,
    trackType: found.trackType,
    objects,
    catalog,
  })
  return rows.find((item) => item.path === props.path) ?? null
})

const isEvent = computed(() => row.value?.mode === 'event')
const isStep = computed(() => row.value?.interp === 'step')
const readOnly = computed(() => row.value === null || row.value.unknown)

/** 段两端节点必须都存在；否则该段已失效（拖动或删除节点后）。 */
const segmentValid = computed(() => {
  const current = row.value
  if (current === null) {
    return false
  }
  const hasFrom = current.keyframes.some((frame) => Math.abs(frame.time - props.fromTime) <= 1e-6)
  const hasTo = current.keyframes.some((frame) => Math.abs(frame.time - props.toTime) <= 1e-6)
  return hasFrom && hasTo && props.toTime > props.fromTime
})

/** 会话里的这一段缓动（没有就是 `undefined`）。 */
const authoring = computed(() => {
  void revision.value
  const table = readEasingTable(ctx.commands.clipAuthoringOf(props.clipKey))
  return table[easingKey(props.path, props.fromTime, props.toTime)]
})

/** 当前模式：会话里有就按会话，否则按目录插值（`step` 单独处理）。 */
const mode = computed<EasingMode>(() => authoring.value?.mode ?? 'linear')

/** 把手：会话里有就用会话值，否则默认把手。切到线性时保留上一次的值（灰显）。 */
const handles = computed<{ out: EasingHandle; in: EasingHandle }>(() => ({
  out: authoring.value?.out ?? { ...DEFAULT_EASING_HANDLES.out },
  in: authoring.value?.in ?? { ...DEFAULT_EASING_HANDLES.in },
}))

/** 拖拽预览用的本地把手（松手才写会话）。 */
const previewOut = ref<EasingHandle>({ ...handles.value.out })
const previewIn = ref<EasingHandle>({ ...handles.value.in })
const dragging = ref<'out' | 'in' | null>(null)

watch(
  () => `${props.path}|${props.fromTime}|${props.toTime}|${authoring.value?.revision ?? -1}|${authoring.value?.mode ?? ''}`,
  () => {
    if (dragging.value !== null) {
      return
    }
    previewOut.value = { ...handles.value.out }
    previewIn.value = { ...handles.value.in }
  },
  { immediate: true },
)

const error = ref('')
const notice = ref('')

const pxPerSecond = computed(() => {
  const value = props.pxPerSecond
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : DEFAULT_VIEWPORT.pxPerSecond
})

/** 预览用的缓动：拖动中用手里的把手实时预览，松手后才写会话。 */
const previewEasing = computed(() => {
  if (dragging.value === null) {
    return authoring.value
  }
  return {
    clipKey: props.clipKey,
    path: props.path,
    fromTime: props.fromTime,
    toTime: props.toTime,
    mode: 'bezier' as EasingMode,
    out: previewOut.value,
    in: previewIn.value,
    revision: authoring.value?.revision ?? 0,
  }
})

/** 段内采样（预览曲线用；与播放头、值控件共用 `sampleValue`）。 */
const samples = computed<Array<{ time: number; value: number }>>(() => {
  const current = row.value
  if (current === null || !segmentValid.value) {
    return []
  }
  const easing = previewEasing.value
  const points: Array<{ time: number; value: number }> = []
  const steps = 48
  for (let index = 0; index <= steps; index += 1) {
    const time = props.fromTime + ((props.toTime - props.fromTime) * index) / steps
    const sampled = sampleValue({
      frames: current.keyframes,
      interp: current.interp,
      time,
      ...(easing === undefined ? {} : { easing }),
    })
    if (sampled.ok && typeof sampled.value === 'number' && Number.isFinite(sampled.value)) {
      points.push({ time, value: sampled.value })
    }
  }
  return points
})

/** 曲线预览：值 → 归一化纵坐标（域内 min/max 拉伸；等值时不画斜线）。 */
const curvePath = computed(() => {
  const points = samples.value
  if (points.length < 2) {
    return ''
  }
  let min = points[0].value
  let max = points[0].value
  for (const point of points) {
    min = Math.min(min, point.value)
    max = Math.max(max, point.value)
  }
  const span = max - min
  const width = 240
  const height = 96
  const padding = 8
  const toX = (time: number): number => {
    const ratio = (time - props.fromTime) / (props.toTime - props.fromTime)
    return padding + ratio * (width - padding * 2)
  }
  const toY = (value: number): number => {
    if (!(span > 0)) {
      return height / 2
    }
    const ratio = (value - min) / span
    return height - padding - ratio * (height - padding * 2)
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(point.time).toFixed(2)} ${toY(point.value).toFixed(2)}`)
    .join(' ')
})

const CURVE_WIDTH = 240
const CURVE_HEIGHT = 96
const CURVE_PADDING = 12

/** 把手像素位置：横 = 归一化 x（0..1），纵 = 归一化 y（0..1，允许超出并夹到画布内）。 */
function handlePosition(handle: EasingHandle): { x: number; y: number } {
  const innerWidth = CURVE_WIDTH - CURVE_PADDING * 2
  const innerHeight = CURVE_HEIGHT - CURVE_PADDING * 2
  const x = CURVE_PADDING + Math.min(1, Math.max(0, handle.x)) * innerWidth
  const y = CURVE_HEIGHT - CURVE_PADDING - Math.min(1.5, Math.max(-0.5, handle.y)) * innerHeight
  return { x, y }
}

const outPosition = computed(() => handlePosition(previewOut.value))
const inPosition = computed(() => handlePosition(previewIn.value))

/** 段起止节点在预览里的像素位置。 */
const startAnchor = computed(() => handlePosition({ x: 0, y: 0 }))
const endAnchor = computed(() => handlePosition({ x: 1, y: 1 }))

/** 会话写入：一次 `commitClipAuthoring`，串身份把连续拖动合并成一个撤销项。 */
function writeEasing(next: { mode: EasingMode; out: EasingHandle; in: EasingHandle }): boolean {
  const revisionNumber = (authoring.value?.revision ?? 0) + 1
  const result = ctx.commands.commitClipAuthoring(
    props.clipKey,
    writeEasingMutator({
      path: props.path,
      fromTime: props.fromTime,
      toTime: props.toTime,
      mode: next.mode,
      out: normalizeHandle(next.out),
      in: normalizeHandle(next.in),
      revision: revisionNumber,
    }),
  )
  if (!result.ok) {
    error.value = result.error ?? '会话缓动写入被拒绝'
    return false
  }
  error.value = ''
  ctx.commands.endCoalescing()
  return true
}

function setMode(next: EasingMode): void {
  if (readOnly.value || isStep.value) {
    return
  }
  if (next === mode.value) {
    return
  }
  const current = handles.value
  if (writeEasing({ mode: next, out: current.out, in: current.in })) {
    notice.value = next === 'bezier' ? '已切到贝塞尔（把手保留上次取值）' : '已切到线性（把手保留但灰显）'
  }
}

function commitHandle(which: 'out' | 'in'): void {
  if (readOnly.value || isStep.value) {
    return
  }
  const current = handles.value
  const next = which === 'out' ? previewOut.value : previewIn.value
  const merged = {
    mode: 'bezier' as EasingMode,
    out: which === 'out' ? normalizeHandle(next) : current.out,
    in: which === 'in' ? normalizeHandle(next) : current.in,
  }
  if (writeEasing(merged)) {
    notice.value = `把手已写入（${which === 'out' ? '出' : '入'} ${merged[which].x.toFixed(3)}, ${merged[which].y.toFixed(3)}）`
  }
}

/** 把手拖动：`pointermove` 只改本地预览，`pointerup` 写一次会话。 */
function onHandlePointerDown(which: 'out' | 'in', event: PointerEvent): void {
  if (readOnly.value || isStep.value) {
    return
  }
  const svg = (event.currentTarget as SVGElement).ownerSVGElement
  if (svg === null) {
    return
  }
  dragging.value = which
  const move = (moveEvent: PointerEvent): void => {
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return
    }
    const innerWidth = CURVE_WIDTH - CURVE_PADDING * 2
    const innerHeight = CURVE_HEIGHT - CURVE_PADDING * 2
    const scaleX = CURVE_WIDTH / rect.width
    const scaleY = CURVE_HEIGHT / rect.height
    const localX = (moveEvent.clientX - rect.left) * scaleX
    const localY = (moveEvent.clientY - rect.top) * scaleY
    const x = Math.min(1, Math.max(0, (localX - CURVE_PADDING) / innerWidth))
    const y = (CURVE_HEIGHT - CURVE_PADDING - localY) / innerHeight
    const handle = normalizeHandle({ x, y: Number.isFinite(y) ? y : 0 })
    if (which === 'out') {
      previewOut.value = handle
    } else {
      previewIn.value = handle
    }
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    dragging.value = null
    commitHandle(which)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}

function resetSegment(): void {
  if (readOnly.value) {
    return
  }
  const result = ctx.commands.commitClipAuthoring(
    props.clipKey,
    removeEasingMutator(props.path, props.fromTime, props.toTime),
  )
  if (!result.ok) {
    error.value = result.error ?? '重置被拒绝'
    return
  }
  error.value = ''
  notice.value = '已重置该段缓动（回到节点插值的默认表现）'
  ctx.commands.endCoalescing()
}

/** 应用到同属性后续段：只影响同插值形态的后续段，一次撤销。 */
function applyToFollowing(): void {
  const current = row.value
  if (current === null || isStep.value || isEvent.value) {
    return
  }
  const frames = current.keyframes
  const sourceIndex = frames.findIndex((frame) => Math.abs(frame.time - props.fromTime) <= 1e-6)
  if (sourceIndex < 0 || sourceIndex >= frames.length - 1) {
    error.value = '当前段已失效'
    return
  }
  const source = { mode: mode.value, out: handles.value.out, in: handles.value.in }
  const targets: Array<{ from: number; to: number }> = []
  for (let index = sourceIndex + 1; index < frames.length - 1; index += 1) {
    targets.push({ from: frames[index].time, to: frames[index + 1].time })
  }
  if (targets.length === 0) {
    notice.value = '该属性后面没有其他段'
    return
  }
  const revisionBase = (authoring.value?.revision ?? 0) + 1
  const result = ctx.commands.commitClipAuthoring(props.clipKey, (state) => {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      writeEasingMutator({
        path: props.path,
        fromTime: target.from,
        toTime: target.to,
        mode: source.mode,
        out: normalizeHandle(source.out),
        in: normalizeHandle(source.in),
        revision: revisionBase + index,
      })(state)
    }
  })
  if (!result.ok) {
    error.value = result.error ?? '应用到后续段被拒绝'
    return
  }
  error.value = ''
  notice.value = `已应用到后续 ${targets.length} 段（一次撤销）`
  ctx.commands.endCoalescing()
}

/** 烘焙此段：采样点来自 `bakeSegment`（与预览同一函数），提交后清掉会话缓动。 */
function bake(): void {
  const current = row.value
  if (current === null || !segmentValid.value || isEvent.value) {
    return
  }
  const easing = authoring.value
  const points = bakeSegment({
    frames: current.keyframes,
    interp: current.interp,
    fromTime: props.fromTime,
    toTime: props.toTime,
    ...(easing === undefined ? {} : { easing }),
  })
  if (points.length < 2) {
    error.value = '烘焙失败：段两端节点不存在或采样为空'
    return
  }
  const values: Array<{ time: number; value: JsonValue }> = []
  for (const point of points) {
    const value = point.value
    if (!isJsonValue(value)) {
      error.value = '烘焙失败：采样值不是合法 JSON 值'
      return
    }
    values.push({ time: point.time, value })
  }
  const outcome = ctx.commands.commit({
    kind: 'object.bakeEasing',
    clipKey: props.clipKey,
    path: props.path,
    fromTime: props.fromTime,
    toTime: props.toTime,
    points: values,
  })
  if (!outcome.ok) {
    error.value = outcome.error ?? '烘焙被拒绝'
    return
  }
  const cleared = ctx.commands.commitClipAuthoring(
    props.clipKey,
    removeEasingMutator(props.path, props.fromTime, props.toTime),
  )
  error.value = ''
  notice.value = cleared.ok
    ? `已烘焙 ${values.length} 个节点并清掉该段会话缓动`
    : `已烘焙 ${values.length} 个节点；会话缓动清理失败：${cleared.error ?? '未知原因'}`
  ctx.commands.endCoalescing()
}

/** JSON 值守卫（烘焙采样结果必须可直接写入文档）。 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item))
  }
  return false
}

function updateHandleField(which: 'out' | 'in', axis: 'x' | 'y', event: Event): void {
  const input = event.target as HTMLInputElement
  const parsed = Number(input.value.trim())
  if (!Number.isFinite(parsed)) {
    error.value = '把手值必须是有限数字'
    input.value = String(which === 'out' ? previewOut.value[axis] : previewIn.value[axis])
    return
  }
  const next = which === 'out' ? { ...previewOut.value } : { ...previewIn.value }
  next[axis] = axis === 'x' ? Math.min(1, Math.max(0, parsed)) : parsed
  if (which === 'out') {
    previewOut.value = next
  } else {
    previewIn.value = next
  }
  commitHandle(which)
  ctx.commands.endCoalescing()
}

function onFieldBlur(): void {
  ctx.commands.endCoalescing()
}
</script>

<template>
  <section class="easing-editor" aria-label="段缓动">
    <header class="easing-editor__header">
      <span class="easing-editor__path">{{ path }}</span>
      <span class="easing-editor__range">{{ fromTime.toFixed(3) }}s → {{ toTime.toFixed(3) }}s</span>
      <span class="easing-editor__mode">{{ mode === 'bezier' ? '贝塞尔' : '线性' }}</span>
      <button type="button" class="easing-editor__close" @click="emit('close')">关闭</button>
    </header>

    <p v-if="row === null" class="easing-editor__empty" role="alert">
      该属性已不存在（可能已被删除或撤销）。
    </p>
    <p v-else-if="isEvent" class="easing-editor__empty" role="status">
      事件行没有段缓动：记录是离散的，不参与插值。
    </p>
    <p v-else-if="!segmentValid" class="easing-editor__empty" role="status">
      该段已失效（端点被移动或删除）。重新点选两个相邻节点之间的连线。
    </p>

    <template v-else>
      <p v-if="isStep" class="easing-editor__step" role="status">
        台阶插值段：值在段内保持不变，只在下一个节点跳变；不提供贝塞尔把手。
      </p>

      <div v-else class="easing-editor__modes" role="group" aria-label="段模式">
        <button
          type="button"
          class="easing-editor__mode-button"
          :class="{ 'easing-editor__mode-button--active': mode === 'linear' }"
          :aria-pressed="mode === 'linear'"
          :disabled="readOnly"
          @click="setMode('linear')"
        >
          线性
        </button>
        <button
          type="button"
          class="easing-editor__mode-button"
          :class="{ 'easing-editor__mode-button--active': mode === 'bezier' }"
          :aria-pressed="mode === 'bezier'"
          :disabled="readOnly"
          @click="setMode('bezier')"
        >
          贝塞尔
        </button>
      </div>

      <svg
        class="easing-editor__curve"
        :viewBox="`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`"
        role="img"
        aria-label="段曲线预览"
      >
        <rect x="0" y="0" :width="CURVE_WIDTH" :height="CURVE_HEIGHT" fill="transparent" />
        <line
          :x1="startAnchor.x"
          :y1="startAnchor.y"
          :x2="endAnchor.x"
          :y2="endAnchor.y"
          class="easing-editor__baseline"
        />
        <path v-if="curvePath !== ''" :d="curvePath" class="easing-editor__curve-path" fill="none" />
        <g v-if="mode === 'bezier' && !isStep">
          <line
            :x1="startAnchor.x"
            :y1="startAnchor.y"
            :x2="outPosition.x"
            :y2="outPosition.y"
            class="easing-editor__handle-line"
          />
          <line
            :x1="endAnchor.x"
            :y1="endAnchor.y"
            :x2="inPosition.x"
            :y2="inPosition.y"
            class="easing-editor__handle-line"
          />
          <circle
            :cx="outPosition.x"
            :cy="outPosition.y"
            r="4.5"
            class="easing-editor__handle easing-editor__handle--out"
            tabindex="0"
            role="slider"
            aria-label="出把手"
            @pointerdown.prevent="onHandlePointerDown('out', $event)"
          />
          <circle
            :cx="inPosition.x"
            :cy="inPosition.y"
            r="4.5"
            class="easing-editor__handle easing-editor__handle--in"
            tabindex="0"
            role="slider"
            aria-label="入把手"
            @pointerdown.prevent="onHandlePointerDown('in', $event)"
          />
        </g>
        <circle :cx="startAnchor.x" :cy="startAnchor.y" r="3" class="easing-editor__anchor" />
        <circle :cx="endAnchor.x" :cy="endAnchor.y" r="3" class="easing-editor__anchor" />
      </svg>

      <div class="easing-editor__handles" :class="{ 'easing-editor__handles--dim': mode === 'linear' || isStep }">
        <div class="easing-editor__handle-group">
          <span class="easing-editor__handle-title">出把手</span>
          <label class="easing-editor__field">
            <span>x</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              class="easing-editor__input"
              :value="previewOut.x"
              :disabled="readOnly || mode === 'linear' || isStep"
              @change="updateHandleField('out', 'x', $event)"
              @blur="onFieldBlur"
            />
          </label>
          <label class="easing-editor__field">
            <span>y</span>
            <input
              type="number"
              step="0.01"
              class="easing-editor__input"
              :value="previewOut.y"
              :disabled="readOnly || mode === 'linear' || isStep"
              @change="updateHandleField('out', 'y', $event)"
              @blur="onFieldBlur"
            />
          </label>
        </div>
        <div class="easing-editor__handle-group">
          <span class="easing-editor__handle-title">入把手</span>
          <label class="easing-editor__field">
            <span>x</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              class="easing-editor__input"
              :value="previewIn.x"
              :disabled="readOnly || mode === 'linear' || isStep"
              @change="updateHandleField('in', 'x', $event)"
              @blur="onFieldBlur"
            />
          </label>
          <label class="easing-editor__field">
            <span>y</span>
            <input
              type="number"
              step="0.01"
              class="easing-editor__input"
              :value="previewIn.y"
              :disabled="readOnly || mode === 'linear' || isStep"
              @change="updateHandleField('in', 'y', $event)"
              @blur="onFieldBlur"
            />
          </label>
        </div>
      </div>

      <p class="easing-editor__hint">
        把手横坐标限制 0..1，纵坐标允许超出（过冲）。线性模式下把手值保留但灰显，切回贝塞尔即恢复。
      </p>

      <div class="easing-editor__actions">
        <button type="button" class="easing-editor__button" :disabled="readOnly" @click="resetSegment">
          重置
        </button>
        <button
          type="button"
          class="easing-editor__button"
          :disabled="readOnly || isStep"
          @click="applyToFollowing"
        >
          应用到同属性后续段
        </button>
        <button type="button" class="easing-editor__button" :disabled="readOnly" @click="bake">
          烘焙此段
        </button>
      </div>

      <p v-if="error !== ''" class="easing-editor__error" role="alert">{{ error }}</p>
      <p v-else-if="notice !== ''" class="easing-editor__notice" role="status">{{ notice }}</p>

      <p v-if="authoring === undefined" class="easing-editor__hint">
        该段没有会话缓动：按目录插值（{{ row?.interp ?? 'none' }}）显示。
      </p>
    </template>
  </section>
</template>

<style scoped>
.easing-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
}

.easing-editor__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.easing-editor__path {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.easing-editor__range,
.easing-editor__mode {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.easing-editor__mode {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
}

.easing-editor__close,
.easing-editor__button,
.easing-editor__mode-button {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.easing-editor__close {
  margin-left: auto;
}

.easing-editor__close:hover,
.easing-editor__button:hover,
.easing-editor__mode-button:hover {
  background: var(--bg-hover);
}

.easing-editor__close:focus-visible,
.easing-editor__button:focus-visible,
.easing-editor__mode-button:focus-visible,
.easing-editor__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.easing-editor__button:disabled,
.easing-editor__mode-button:disabled,
.easing-editor__input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.easing-editor__modes {
  display: flex;
  gap: 4px;
}

.easing-editor__mode-button--active {
  border-color: var(--accent);
  color: var(--accent);
}

.easing-editor__curve {
  width: 100%;
  max-width: 320px;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  touch-action: none;
}

.easing-editor__baseline {
  stroke: var(--border-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.easing-editor__curve-path {
  stroke: var(--accent);
  stroke-width: 2;
}

.easing-editor__handle-line {
  stroke: var(--text-muted);
  stroke-width: 1;
}

.easing-editor__handle {
  fill: var(--bg-raised);
  stroke: var(--focus);
  stroke-width: 1.5;
  cursor: grab;
}

.easing-editor__handle:focus-visible {
  outline: none;
  stroke: var(--accent);
  stroke-width: 2.5;
}

.easing-editor__handle--in {
  stroke: var(--success);
}

.easing-editor__anchor {
  fill: var(--text);
}

.easing-editor__handles {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.easing-editor__handles--dim {
  opacity: 0.5;
}

.easing-editor__handle-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.easing-editor__handle-title {
  color: var(--text-secondary);
  font-size: 11px;
}

.easing-editor__field {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.easing-editor__input {
  width: 64px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
}

.easing-editor__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.easing-editor__step {
  margin: 0;
  padding: 4px 6px;
  border: 1px dashed var(--border-strong);
  border-radius: 3px;
  color: var(--text-secondary);
}

.easing-editor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.easing-editor__empty {
  margin: 0;
  padding: 6px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 3px;
  color: var(--text-secondary);
}

.easing-editor__error {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--error);
  border-radius: 3px;
  background: var(--error-bg);
  color: var(--error);
}

.easing-editor__notice {
  margin: 0;
  color: var(--text-secondary);
}
</style>
