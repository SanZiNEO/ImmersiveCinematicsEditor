<script setup lang="ts">
/**
 * 几何工具面板（12-09，插件 `core.geometry`，面板 `geometry.tools`）。
 *
 * 六件事：素材尺寸检查器、覆盖层区域规划、相机合成矩形、基准分辨率编辑、
 * 预览几何示意、Gizmo。只算数、只写既有字段；不合成像素、不伪造最终画面。
 * 两套坐标系在示意里用不同颜色 / 线型区分，并固定标注「几何示意，最终以游戏为准」。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import type { DocumentService } from '../../../workbench/api/documents.ts'
import type { DocCommand } from '../../../core/doc/commands.ts'

import {
  PREVIEW,
  buildCameraModel,
  buildInspector,
  buildPlanner,
  buildSketchShapes,
  resolveDocBaseResolution,
  resolveGeometrySelection,
} from '../panelModel.ts'
import {
  GIZMO_HANDLES,
  baseResolutionCommands,
  boundingBox,
  gizmoCommands,
  planGizmoDrag,
  readGizmoGeometry,
  validateBaseResolutionInput,
} from '../../../features/geometry/index.ts'
import type {
  CropRect,
  GizmoDraft,
  GizmoGeometry,
  GizmoHandle,
  NormalizedRect,
  RegionPlanResult,
} from '../../../features/geometry/index.ts'

const ctx = usePanelContext()
const documents = ctx.services.get(DOCUMENT_SERVICE)

/** 文档 / 选区修订信号（实时 getter 不能直接缓存，折成 tick 触发重算）。 */
const tick = ref(0)
const disposers: Array<() => void> = []

onMounted(() => {
  const selection = ctx.services.get(SELECTION_SERVICE)
  if (selection !== undefined) {
    disposers.push(selection.subscribe(() => { tick.value += 1 }))
  }
  if (documents !== undefined) {
    disposers.push(documents.subscribe(() => { tick.value += 1 }))
  }
})

onBeforeUnmount(() => {
  for (const dispose of disposers) {
    dispose()
  }
  disposers.length = 0
})

const t = (key: string): string => ctx.i18n.t(key)

// ── 文档与选区 ──────────────────────────────────────────────────────────────

const view = computed(() => {
  void tick.value
  return documents?.view() ?? null
})

const meta = computed<JsonObject | null>(() => {
  void tick.value
  return documents?.metaObject() ?? null
})

const selectionModel = computed(() => {
  void tick.value
  return resolveGeometrySelection(
    view.value,
    ctx.selection,
    ctx.clipKeys,
    (clipKey) => documents?.clipObjects(clipKey) ?? null,
  )
})

const objects = computed<JsonObject>(() => selectionModel.value.objects ?? {})

const base = computed(() => resolveDocBaseResolution(meta.value))

// ── 素材尺寸检查器（覆盖层）─────────────────────────────────────────────────

/** 作者手填的素材原始像素；空串 = 未知（不猜 16:9 / 1920×1080）。 */
const sourceWidthText = ref('')
const sourceHeightText = ref('')

function parseOptionalNumber(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

const sourceWidth = computed(() => parseOptionalNumber(sourceWidthText.value))
const sourceHeight = computed(() => parseOptionalNumber(sourceHeightText.value))

const inspector = computed(() => {
  if (selectionModel.value.trackType !== 'OVERLAY') return null
  return buildInspector({ objects: objects.value, base: base.value, sourceWidth: sourceWidth.value, sourceHeight: sourceHeight.value })
})

const crop = computed<CropRect | null>(() => {
  const chain = inspector.value?.chain ?? null
  if (chain === null) return null
  return {
    x: readNumber(objects.value, 'source.x', 0),
    y: readNumber(objects.value, 'source.y', 0),
    w: readNumber(objects.value, 'source.w', 1),
    h: readNumber(objects.value, 'source.h', 1),
  }
})

function readNumber(objects: JsonObject, path: string, fallback: number): number {
  const raw = objects[path]
  if (raw === null || typeof raw !== 'object') return fallback
  const value = (raw as { value?: unknown }).value
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ── 相机合成矩形 ────────────────────────────────────────────────────────────

const camera = computed(() => {
  if (selectionModel.value.trackType !== 'CAMERA') return null
  return buildCameraModel(objects.value)
})

const camDest = ref<NormalizedRect>({ x: 0, y: 0, w: 1, h: 1 })
const camSource = ref<NormalizedRect>({ x: 0, y: 0, w: 1, h: 1 })

watch(camera, (next) => {
  if (next !== null) {
    camDest.value = { ...next.dest }
    camSource.value = { ...next.source }
  }
}, { immediate: true })

// ── 区域规划 ───────────────────────────────────────────────────────────────

const targetX = ref(0.25)
const targetY = ref(0.25)
const targetW = ref(0.5)
const targetH = ref(0.5)

const planner = computed<RegionPlanResult | null>(() => {
  if (inspector.value === null) return null
  return buildPlanner(
    { target: { x: targetX.value, y: targetY.value, width: targetW.value, height: targetH.value }, inspector: inspector.value },
  )
})

// ── 基准分辨率表单 ─────────────────────────────────────────────────────────

const baseWText = ref(String(base.value.width))
const baseHText = ref(String(base.value.height))

watch(base, (next) => {
  baseWText.value = String(next.width)
  baseHText.value = String(next.height)
})

const status = ref('')

// ── 预览示意形状 ────────────────────────────────────────────────────────────

const multiBox = computed<NormalizedRect | null>(() => {
  if (selectionModel.value.kind !== 'multi') return null
  // 多选只显示包围盒，不批量改每个片段；这里不收集各片段矩形做隐式批改。
  return boundingBox([])
})

const shapes = computed(() => buildSketchShapes({
  inspector: inspector.value,
  camera: camera.value,
  crop: crop.value,
  multiBox: multiBox.value,
}))

/** 当前覆盖层元素框（窗口归一化）；素材未知时为 `null`，缩放手柄不显示。 */
const elementRectView = computed<NormalizedRect | null>(() => {
  const shape = shapes.value.find((entry) => entry.kind === 'overlayRect')
  return shape?.rect ?? null
})

/** 等比缩放手柄位置（右上角）。 */
const uniformHandle = computed(() => {
  const rect = elementRectView.value
  return rect === null ? null : { x: rect.x + rect.w, y: rect.y }
})

/** 非等比缩放手柄位置（底边中点）。 */
const stretchHandle = computed(() => {
  const rect = elementRectView.value
  return rect === null ? null : { x: rect.x + rect.w / 2, y: rect.y + rect.h }
})

// ── Gizmo ──────────────────────────────────────────────────────────────────

const gizmoGeometry = computed<GizmoGeometry>(() => readGizmoGeometry(objects.value))
const draftGeometry = ref<GizmoGeometry | null>(null)
const dragging = ref(false)
const activeHandle = ref<GizmoHandle | null>(null)
const dragIssues = ref<string[]>([])
const dragWarnings = ref<string[]>([])

let dragStart: { clientX: number; clientY: number; geometry: GizmoGeometry } | null = null

const gizmoEnabled = computed(() => selectionModel.value.kind === 'single' && selectionModel.value.trackType === 'OVERLAY')

const svgRef = ref<SVGSVGElement | null>(null)

function viewportDelta(event: PointerEvent): { dx: number; dy: number } {
  const svg = svgRef.value
  if (svg === null || dragStart === null) return { dx: 0, dy: 0 }
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return { dx: 0, dy: 0 }
  return {
    dx: (event.clientX - dragStart.clientX) * (PREVIEW.width / rect.width),
    dy: (event.clientY - dragStart.clientY) * (PREVIEW.height / rect.height),
  }
}

function onPointerDown(handle: GizmoHandle, event: PointerEvent): void {
  if (!gizmoEnabled.value || selectionModel.value.clipKey === null) return
  dragStart = { clientX: event.clientX, clientY: event.clientY, geometry: gizmoGeometry.value }
  activeHandle.value = handle
  dragging.value = true
  dragIssues.value = []
  dragWarnings.value = []
  draftGeometry.value = { ...gizmoGeometry.value }
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value || dragStart === null || activeHandle.value === null) return
  const { dx, dy } = viewportDelta(event)
  const input = activeHandle.value === 'anchor'
    ? {
        handle: activeHandle.value,
        geometry: dragStart.geometry,
        viewport: { width: PREVIEW.width, height: PREVIEW.height },
        // 锚点手柄传归一化增量。
        deltaX: dx / PREVIEW.width,
        deltaY: dy / PREVIEW.height,
      }
    : {
        handle: activeHandle.value,
        geometry: dragStart.geometry,
        viewport: { width: PREVIEW.width, height: PREVIEW.height },
        deltaX: dx,
        deltaY: dy,
      }
  const draft: GizmoDraft = planGizmoDrag(input)
  dragIssues.value = draft.issues
  dragWarnings.value = draft.warnings
  draftGeometry.value = draft.geometry
}

function onPointerUp(): void {
  if (!dragging.value || dragStart === null) return
  const before = dragStart.geometry
  const after = draftGeometry.value ?? before
  const commands = gizmoCommands(selectionModel.value.clipKey ?? '', before, after)
  if (commands.length > 0) {
    const outcome = ctx.commands.commitBatch(commands, `geometry-gizmo:${activeHandle.value ?? 'drag'}`)
    if (!outcome.ok) {
      status.value = outcome.error ?? 'Gizmo 写入被拒绝'
    } else {
      status.value = ''
    }
  }
  dragging.value = false
  activeHandle.value = null
  dragStart = null
  draftGeometry.value = null
}

// ── 写操作（一次事务）───────────────────────────────────────────────────────

function applyBaseResolution(): void {
  const validation = validateBaseResolutionInput({
    width: Number(baseWText.value),
    height: Number(baseHText.value),
  })
  if (!validation.ok || validation.value === null) {
    status.value = validation.issues.join('；')
    return
  }
  const outcome = ctx.commands.commitBatch(baseResolutionCommands(validation.value), 'geometry-base-resolution')
  status.value = outcome.ok ? '' : (outcome.error ?? '基准分辨率写入被拒绝')
}

function resetBaseResolution(): void {
  const outcome = ctx.commands.commitBatch(baseResolutionCommands(null), 'geometry-base-resolution-reset')
  status.value = outcome.ok ? '' : (outcome.error ?? '基准分辨率清除被拒绝')
}

function applyPlanner(): void {
  const plan = planner.value
  const clipKey = selectionModel.value.clipKey
  if (plan === null || clipKey === null) return
  if (plan.issues.length > 0) {
    status.value = plan.issues.join('；')
    return
  }
  const commands: DocCommand[] = [
    { kind: 'object.setValue', clipKey, path: 'x', value: plan.center.x },
    { kind: 'object.setValue', clipKey, path: 'y', value: plan.center.y },
    { kind: 'object.setValue', clipKey, path: 'anchor_x', value: plan.anchorX },
    { kind: 'object.setValue', clipKey, path: 'anchor_y', value: plan.anchorY },
  ]
  if (plan.suggestedScaleX !== null && plan.suggestedScaleY !== null) {
    commands.push(
      { kind: 'object.setValue', clipKey, path: 'scale_x', value: plan.suggestedScaleX },
      { kind: 'object.setValue', clipKey, path: 'scale_y', value: plan.suggestedScaleY },
    )
  }
  const outcome = ctx.commands.commitBatch(commands, 'geometry-region-plan')
  status.value = outcome.ok ? '' : (outcome.error ?? '区域规划写入被拒绝')
}

function applyCamera(): void {
  const clipKey = selectionModel.value.clipKey
  if (clipKey === null || camera.value === null) return
  if (camera.value.issues.length > 0) {
    status.value = camera.value.issues.join('；')
    return
  }
  const pairs: Array<[string, number]> = [
    ['dest.x', camDest.value.x],
    ['dest.y', camDest.value.y],
    ['dest.w', camDest.value.w],
    ['dest.h', camDest.value.h],
    ['source.x', camSource.value.x],
    ['source.y', camSource.value.y],
    ['source.w', camSource.value.w],
    ['source.h', camSource.value.h],
  ]
  const commands: DocCommand[] = pairs.map(([path, value]) => ({ kind: 'object.setValue', clipKey, path, value }))
  const outcome = ctx.commands.commitBatch(commands, 'geometry-camera-rect')
  status.value = outcome.ok ? '' : (outcome.error ?? '相机矩形写入被拒绝')
}

// ── 示意渲染辅助 ───────────────────────────────────────────────────────────

function rectAttrs(rect: NormalizedRect): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x * PREVIEW.width,
    y: rect.y * PREVIEW.height,
    width: Math.max(0, rect.w * PREVIEW.width),
    height: Math.max(0, rect.h * PREVIEW.height),
  }
}

const inspectorIssues = computed(() => inspector.value?.chain.issues ?? [])
const inspectorWarnings = computed(() => inspector.value?.chain.warnings ?? [])
const cameraWarnings = computed(() => camera.value?.warnings ?? [])
const plannerWarnings = computed(() => planner.value?.warnings ?? [])
const plannerIssues = computed(() => planner.value?.issues ?? [])

const draftReadout = computed(() => draftGeometry.value ?? gizmoGeometry.value)
</script>

<template>
  <section class="geometry-panel">
    <header class="geometry-panel__head">
      <p class="geometry-panel__space">{{ t('geometry.space.overlay') }}</p>
      <p class="geometry-panel__space">{{ t('geometry.space.camera') }}</p>
      <p class="geometry-panel__disclaimer">{{ t('geometry.disclaimer') }}</p>
    </header>

    <p v-if="selectionModel.kind === 'none'" class="geometry-panel__state">{{ t('geometry.state.noSelection') }}</p>
    <p v-else-if="selectionModel.kind === 'multi'" class="geometry-panel__state">{{ t('geometry.gizmo.multi') }}</p>

    <!-- 基准分辨率 -->
    <fieldset class="geometry-block">
      <legend>{{ t('geometry.section.baseResolution') }}</legend>
      <div class="geometry-row">
        <label>{{ t('geometry.baseResolution.width') }}
          <input v-model.number="baseWText" type="number" min="1" step="1" />
        </label>
        <label>{{ t('geometry.baseResolution.height') }}
          <input v-model.number="baseHText" type="number" min="1" step="1" />
        </label>
      </div>
      <p class="geometry-note">
        {{ base.explicit ? t('geometry.baseResolution.explicit') : t('geometry.baseResolution.defaultNote') }}
      </p>
      <p class="geometry-note">{{ t('geometry.baseResolution.scopeNote') }}</p>
      <div class="geometry-row">
        <button type="button" @click="applyBaseResolution">{{ t('geometry.baseResolution.apply') }}</button>
        <button type="button" @click="resetBaseResolution">{{ t('geometry.baseResolution.reset') }}</button>
      </div>
    </fieldset>

    <!-- 素材尺寸检查器 -->
    <fieldset v-if="inspector !== null" class="geometry-block">
      <legend>{{ t('geometry.section.inspector') }}</legend>
      <div class="geometry-row">
        <label>{{ t('geometry.inspector.sourceWidth') }}
          <input v-model="sourceWidthText" type="number" min="0" step="1" placeholder="—" />
        </label>
        <label>{{ t('geometry.inspector.sourceHeight') }}
          <input v-model="sourceHeightText" type="number" min="0" step="1" placeholder="—" />
        </label>
      </div>
      <dl class="geometry-chain">
        <dt>{{ t('geometry.inspector.factor') }}</dt>
        <dd>{{ inspector.chain.factor.toFixed(4) }}</dd>
        <dt>{{ t('geometry.inspector.cropped') }}</dt>
        <dd>
          <template v-if="inspector.chain.cropped.width !== null && inspector.chain.cropped.height !== null">
            {{ inspector.chain.cropped.width.toFixed(1) }} × {{ inspector.chain.cropped.height.toFixed(1) }}
          </template>
          <template v-else>{{ t('geometry.common.unknown') }}</template>
        </dd>
        <dt>{{ t('geometry.inspector.baseSize') }}</dt>
        <dd>
          <template v-if="inspector.chain.baseSize.width !== null && inspector.chain.baseSize.height !== null">
            {{ inspector.chain.baseSize.width.toFixed(1) }} × {{ inspector.chain.baseSize.height.toFixed(1) }}
          </template>
          <template v-else>{{ t('geometry.common.unknown') }}</template>
        </dd>
        <dt>{{ t('geometry.inspector.finalSize') }}</dt>
        <dd>
          <template v-if="inspector.chain.finalSize.width !== null && inspector.chain.finalSize.height !== null">
            {{ inspector.chain.finalSize.width.toFixed(1) }} × {{ inspector.chain.finalSize.height.toFixed(1) }}
          </template>
          <template v-else>{{ t('geometry.common.unknown') }}</template>
        </dd>
        <dt>{{ t('geometry.inspector.windowFraction') }}</dt>
        <dd>
          <template v-if="inspector.chain.windowFraction.width !== null && inspector.chain.windowFraction.height !== null">
            {{ (inspector.chain.windowFraction.width * 100).toFixed(1) }}% × {{ (inspector.chain.windowFraction.height * 100).toFixed(1) }}%
          </template>
          <template v-else>{{ t('geometry.common.unknown') }}</template>
        </dd>
        <dt>{{ t('geometry.inspector.outOfWindow') }}</dt>
        <dd>
          <template v-if="inspector.chain.outOfWindow === null">{{ t('geometry.common.unknown') }}</template>
          <template v-else>{{ inspector.chain.outOfWindow ? t('geometry.inspector.outOfWindow') : t('geometry.inspector.inWindow') }}</template>
        </dd>
      </dl>
      <p v-if="inspector.isSubtitle" class="geometry-note">{{ t('geometry.subtitle.approxBlock') }}</p>
      <ul v-if="inspectorIssues.length > 0" class="geometry-list geometry-list--issue">
        <li v-for="issue in inspectorIssues" :key="issue">{{ issue }}</li>
      </ul>
      <ul v-if="inspectorWarnings.length > 0" class="geometry-list">
        <li v-for="warning in inspectorWarnings" :key="warning">{{ warning }}</li>
      </ul>
    </fieldset>

    <!-- 区域规划 -->
    <fieldset v-if="planner !== null" class="geometry-block">
      <legend>{{ t('geometry.section.planner') }}</legend>
      <div class="geometry-row">
        <label>{{ t('geometry.planner.targetX') }}<input v-model.number="targetX" type="number" step="0.01" /></label>
        <label>{{ t('geometry.planner.targetY') }}<input v-model.number="targetY" type="number" step="0.01" /></label>
        <label>{{ t('geometry.planner.targetWidth') }}<input v-model.number="targetW" type="number" step="0.01" /></label>
        <label>{{ t('geometry.planner.targetHeight') }}<input v-model.number="targetH" type="number" step="0.01" /></label>
      </div>
      <dl class="geometry-chain">
        <dt>{{ t('geometry.planner.center') }}</dt>
        <dd>{{ planner.center.x.toFixed(3) }}, {{ planner.center.y.toFixed(3) }}</dd>
        <dt>{{ t('geometry.planner.suggestedScale') }}</dt>
        <dd>
          <template v-if="planner.suggestedScaleX !== null && planner.suggestedScaleY !== null">
            {{ planner.suggestedScaleX.toFixed(3) }} × {{ planner.suggestedScaleY.toFixed(3) }}
          </template>
          <template v-else>{{ t('geometry.common.unknown') }}</template>
        </dd>
        <dt>{{ t('geometry.planner.anchor') }}</dt>
        <dd>{{ planner.anchorX.toFixed(3) }}, {{ planner.anchorY.toFixed(3) }}</dd>
      </dl>
      <ul v-if="plannerIssues.length > 0" class="geometry-list geometry-list--issue">
        <li v-for="issue in plannerIssues" :key="issue">{{ issue }}</li>
      </ul>
      <ul v-if="plannerWarnings.length > 0" class="geometry-list">
        <li v-for="warning in plannerWarnings" :key="warning">{{ warning }}</li>
      </ul>
      <button type="button" :disabled="planner.issues.length > 0" @click="applyPlanner">{{ t('geometry.planner.apply') }}</button>
    </fieldset>

    <!-- 相机合成矩形 -->
    <fieldset v-if="camera !== null" class="geometry-block">
      <legend>{{ t('geometry.section.camera') }}</legend>
      <p class="geometry-note">{{ t('geometry.camera.normalizedOnly') }}</p>
      <div class="geometry-row">
        <label>{{ t('geometry.camera.destX') }}<input v-model.number="camDest.x" type="number" step="0.01" /></label>
        <label>{{ t('geometry.camera.destY') }}<input v-model.number="camDest.y" type="number" step="0.01" /></label>
        <label>{{ t('geometry.camera.destW') }}<input v-model.number="camDest.w" type="number" step="0.01" /></label>
        <label>{{ t('geometry.camera.destH') }}<input v-model.number="camDest.h" type="number" step="0.01" /></label>
      </div>
      <div class="geometry-row">
        <label>{{ t('geometry.camera.sourceX') }}<input v-model.number="camSource.x" type="number" step="0.01" /></label>
        <label>{{ t('geometry.camera.sourceY') }}<input v-model.number="camSource.y" type="number" step="0.01" /></label>
        <label>{{ t('geometry.camera.sourceW') }}<input v-model.number="camSource.w" type="number" step="0.01" /></label>
        <label>{{ t('geometry.camera.sourceH') }}<input v-model.number="camSource.h" type="number" step="0.01" /></label>
      </div>
      <ul v-if="cameraWarnings.length > 0" class="geometry-list">
        <li v-for="warning in cameraWarnings" :key="warning">{{ warning }}</li>
      </ul>
      <button type="button" :disabled="camera.issues.length > 0" @click="applyCamera">{{ t('geometry.planner.apply') }}</button>
    </fieldset>

    <!-- 预览几何示意 -->
    <fieldset class="geometry-block">
      <legend>{{ t('geometry.section.preview') }}</legend>
      <p class="geometry-note">{{ t('geometry.preview.fixedView') }} · {{ t('geometry.preview.fixedFps') }}</p>
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${PREVIEW.width} ${PREVIEW.height}`"
        class="geometry-sketch"
        role="img"
        :aria-label="t('geometry.section.preview')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <rect x="0" y="0" :width="PREVIEW.width" :height="PREVIEW.height" class="geometry-sketch__frame" />
        <g v-for="shape in shapes" :key="shape.id">
          <rect
            v-if="shape.rect !== null && (shape.kind === 'overlayRect' || shape.kind === 'multiBox')"
            v-bind="rectAttrs(shape.rect)"
            class="geometry-sketch__overlay-rect"
            :class="{ 'geometry-sketch__overlay-rect--drag': shape.kind === 'overlayRect' }"
            @pointerdown="shape.kind === 'overlayRect' ? onPointerDown('move', $event) : undefined"
          />
          <rect
            v-else-if="shape.rect !== null && shape.kind === 'subtitleBlock'"
            v-bind="rectAttrs(shape.rect)"
            class="geometry-sketch__subtitle-block"
          />
          <rect
            v-else-if="shape.rect !== null && shape.kind === 'cropBox'"
            v-bind="rectAttrs(shape.rect)"
            class="geometry-sketch__crop"
          />
          <rect
            v-else-if="shape.rect !== null && shape.kind === 'cameraDest'"
            v-bind="rectAttrs(shape.rect)"
            class="geometry-sketch__camera-dest"
          />
          <rect
            v-else-if="shape.rect !== null && shape.kind === 'cameraSource'"
            v-bind="rectAttrs(shape.rect)"
            class="geometry-sketch__camera-source"
          />
          <circle
            v-if="shape.point !== null && shape.kind === 'center'"
            :cx="shape.point.x * PREVIEW.width"
            :cy="shape.point.y * PREVIEW.height"
            r="6"
            class="geometry-sketch__center"
          />
          <rect
            v-if="shape.point !== null && shape.kind === 'anchor'"
            :x="shape.point.x * PREVIEW.width - 7"
            :y="shape.point.y * PREVIEW.height - 7"
            width="14"
            height="14"
            class="geometry-sketch__anchor"
            @pointerdown="onPointerDown('anchor', $event)"
          />
        </g>

        <rect
          v-if="gizmoEnabled && uniformHandle !== null"
          :x="uniformHandle.x * PREVIEW.width - 7"
          :y="uniformHandle.y * PREVIEW.height - 7"
          width="14"
          height="14"
          class="geometry-sketch__handle"
          @pointerdown="onPointerDown('uniformScale', $event)"
        />
        <rect
          v-if="gizmoEnabled && stretchHandle !== null"
          :x="stretchHandle.x * PREVIEW.width - 7"
          :y="stretchHandle.y * PREVIEW.height - 7"
          width="14"
          height="14"
          class="geometry-sketch__handle"
          @pointerdown="onPointerDown('stretchScale', $event)"
        />
      </svg>
      <p class="geometry-note">{{ t('geometry.disclaimer') }}</p>
    </fieldset>

    <!-- Gizmo -->
    <fieldset class="geometry-block">
      <legend>{{ t('geometry.section.gizmo') }}</legend>
      <p class="geometry-note">{{ t('geometry.gizmo.releaseCommit') }} · {{ t('geometry.gizmo.noRotation') }}</p>
      <ul class="geometry-handles">
        <li v-for="handle in GIZMO_HANDLES" :key="handle">{{ t(`geometry.gizmo.handle.${handle}`) }}</li>
      </ul>
      <p v-if="!gizmoEnabled" class="geometry-note">{{ t('geometry.state.multi') }}</p>
      <dl v-else class="geometry-chain">
        <dt>X / Y</dt>
        <dd>{{ draftReadout.x.toFixed(3) }}, {{ draftReadout.y.toFixed(3) }}</dd>
        <dt>scale</dt>
        <dd>{{ draftReadout.scaleX.toFixed(3) }} × {{ draftReadout.scaleY.toFixed(3) }}</dd>
        <dt>anchor</dt>
        <dd>{{ draftReadout.anchorX.toFixed(3) }}, {{ draftReadout.anchorY.toFixed(3) }}</dd>
      </dl>
      <ul v-if="dragIssues.length > 0" class="geometry-list geometry-list--issue">
        <li v-for="issue in dragIssues" :key="issue">{{ issue }}</li>
      </ul>
      <ul v-if="dragWarnings.length > 0" class="geometry-list">
        <li v-for="warning in dragWarnings" :key="warning">{{ warning }}</li>
      </ul>
    </fieldset>

    <p v-if="status" class="geometry-panel__status">{{ status }}</p>
  </section>
</template>

<style scoped>
.geometry-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
}

.geometry-panel__head p {
  margin: 2px 0;
}

.geometry-panel__disclaimer {
  color: var(--warning, #c9a227);
}

.geometry-panel__state,
.geometry-panel__status,
.geometry-note {
  color: var(--text-muted, #888);
  margin: 2px 0;
}

.geometry-block {
  border: 1px solid var(--border, #ddd);
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.geometry-block legend {
  padding: 0 4px;
  font-weight: 600;
}

.geometry-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.geometry-row label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.geometry-chain {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 0;
}

.geometry-chain dt {
  color: var(--text-secondary, #666);
}

.geometry-chain dd {
  margin: 0;
}

.geometry-list {
  margin: 0;
  padding-left: 16px;
}

.geometry-list--issue {
  color: var(--danger, #c0392b);
}

.geometry-handles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding-left: 16px;
}

.geometry-sketch {
  display: block;
  width: 100%;
  height: auto;
}

.geometry-sketch__frame {
  fill: var(--bg-raised, #eee);
  stroke: var(--border-strong, #999);
}

.geometry-sketch__overlay-rect {
  fill: color-mix(in srgb, var(--warning, #c9a227) 14%, transparent);
  stroke: var(--warning, #c9a227);
  stroke-width: 2;
}

.geometry-sketch__subtitle-block {
  fill: color-mix(in srgb, var(--text-secondary, #666) 10%, transparent);
  stroke: var(--text-secondary, #666);
  stroke-width: 1;
  stroke-dasharray: 2 4;
}

.geometry-sketch__crop {
  fill: color-mix(in srgb, var(--accent, #4a90d9) 18%, transparent);
  stroke: var(--accent, #4a90d9);
  stroke-dasharray: 5 3;
}

.geometry-sketch__camera-dest {
  fill: color-mix(in srgb, var(--accent, #4a90d9) 10%, transparent);
  stroke: var(--accent, #4a90d9);
  stroke-width: 2;
  stroke-dasharray: 8 4;
}

.geometry-sketch__camera-source {
  fill: none;
  stroke: var(--accent, #4a90d9);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.geometry-sketch__center {
  fill: var(--warning, #c9a227);
}

.geometry-sketch__anchor {
  fill: color-mix(in srgb, var(--warning, #c9a227) 30%, transparent);
  stroke: var(--warning, #c9a227);
  cursor: grab;
}

.geometry-sketch__overlay-rect--drag {
  cursor: grab;
}

.geometry-sketch__handle {
  fill: var(--bg-panel, #fff);
  stroke: var(--warning, #c9a227);
  stroke-width: 2;
  cursor: grab;
}

button {
  align-self: flex-start;
}
</style>
