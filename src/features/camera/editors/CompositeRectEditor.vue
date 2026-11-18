<script setup lang="ts">
/**
 * 合成矩形编辑器（08-01 §三 / §4.5）：dest 四值与 source 四值成组铺开。
 *
 * 规则：
 * - 八个值始终以 0–1 归一化写入；输入面直接复用 06 的 `PropertyValueForm`，本组件不另造控件；
 * - 百分比 / 小数切换只影响示意图读数与摘要，不写文档，输入仍按 0~1 归一化解析；
 * - 旁边的小矩形示意只按当前数值画（整幅 / source / dest），不采样游戏画面、不做像素级预览；
 * - 越界或负宽高只给提示，绝不夹紧、绝不改写作者输入（夹紧只发生在示意坐标换算时）。
 *
 * 已打帧的叶子已归效果面板：这里用 `staticRows` 过滤，另显示一行计数提示。
 */
import { computed, ref } from 'vue'
import {
  COMPOSITE_PATHS,
  COMPOSITE_RECT_PATHS,
  staticRows,
  type CameraEditorInput,
} from '../fieldSurface.ts'
import type { PropertyRow } from '../../effects/types.ts'
import PropertyValueForm from '../../effects/panels/PropertyValueForm.vue'
import { animatedRowCount, finiteNumber } from './editorRows.ts'

const props = defineProps<CameraEditorInput>()

/** 尺寸路径（宽 / 高）：缺省回退 1；位置路径缺省回退 0。 */
const SIZE_PATHS: readonly string[] = [
  COMPOSITE_PATHS.destW,
  COMPOSITE_PATHS.destH,
  COMPOSITE_PATHS.sourceW,
  COMPOSITE_PATHS.sourceH,
]

const DEST_PATHS: readonly string[] = [
  COMPOSITE_PATHS.destX,
  COMPOSITE_PATHS.destY,
  COMPOSITE_PATHS.destW,
  COMPOSITE_PATHS.destH,
]

const SOURCE_PATHS: readonly string[] = [
  COMPOSITE_PATHS.sourceX,
  COMPOSITE_PATHS.sourceY,
  COMPOSITE_PATHS.sourceW,
  COMPOSITE_PATHS.sourceH,
]

/** 留在属性面板的本组成员（已打帧的叶子不在此列）。 */
const staticRowsInScope = computed<PropertyRow[]>(() =>
  staticRows(props.rows).filter((row) => COMPOSITE_RECT_PATHS.includes(row.path)),
)

const staticByPath = computed(() => new Map(staticRowsInScope.value.map((row) => [row.path, row])))

const destRows = computed<PropertyRow[]>(() =>
  DEST_PATHS.map((path) => staticByPath.value.get(path)).filter((row): row is PropertyRow => row !== undefined),
)

const sourceRows = computed<PropertyRow[]>(() =>
  SOURCE_PATHS.map((path) => staticByPath.value.get(path)).filter((row): row is PropertyRow => row !== undefined),
)

/** 已打帧行数（仅提示，不在本面板编辑）。 */
const animatedCount = computed(() => animatedRowCount(props.rows, COMPOSITE_RECT_PATHS))

/** 显示格式：只影响界面读数，不写文档。 */
const mode = ref<'fraction' | 'percent'>('fraction')

function valueOf(path: string): number {
  const row = staticByPath.value.get(path)
  return finiteNumber(row, SIZE_PATHS.includes(path) ? 1 : 0)
}

function formatRaw(value: number): string {
  return String(Number(value.toFixed(4)))
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return mode.value === 'percent' ? `${(value * 100).toFixed(1)}%` : formatRaw(value)
}

interface RectWarning {
  path: string
  message: string
}

function warningFor(path: string, value: number): RectWarning | null {
  const row = staticByPath.value.get(path)
  const label = row?.label ?? path
  if (!Number.isFinite(value)) {
    return { path, message: `${label} 不是有限数字：运行时裁切结果不可预期` }
  }
  if (SIZE_PATHS.includes(path)) {
    if (value < 0) {
      return { path, message: `${label} 为负：运行时裁切结果不可预期` }
    }
    if (value > 1) {
      return { path, message: `${label} 超出 0~1（${formatRaw(value)}）：运行时裁切结果不可预期` }
    }
    return null
  }
  if (value < 0 || value > 1) {
    return { path, message: `${label} 超出 0~1（${formatRaw(value)}）：运行时裁切结果不可预期` }
  }
  return null
}

const warnings = computed<RectWarning[]>(() =>
  COMPOSITE_RECT_PATHS
    .map((path) => warningFor(path, valueOf(path)))
    .filter((item): item is RectWarning => item !== null),
)

// ── 示意图几何：归一化坐标 → 画框像素；只夹绘图，不改值 ──

const BOX_W = 160
const BOX_H = 90
const PAD = 6

function toPx(normalized: number): number {
  return PAD + normalized * (BOX_W - PAD * 2)
}

function clampFrame(pixel: number): number {
  return Math.min(Math.max(pixel, PAD), BOX_W - PAD)
}

function rectOf(x: number, y: number, w: number, h: number) {
  const left = clampFrame(toPx(x))
  const top = clampFrame(toPx(y))
  const right = clampFrame(toPx(x + w))
  const bottom = clampFrame(toPx(y + h))
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

const destRect = computed(() =>
  rectOf(
    valueOf(COMPOSITE_PATHS.destX),
    valueOf(COMPOSITE_PATHS.destY),
    valueOf(COMPOSITE_PATHS.destW),
    valueOf(COMPOSITE_PATHS.destH),
  ),
)

const sourceRect = computed(() =>
  rectOf(
    valueOf(COMPOSITE_PATHS.sourceX),
    valueOf(COMPOSITE_PATHS.sourceY),
    valueOf(COMPOSITE_PATHS.sourceW),
    valueOf(COMPOSITE_PATHS.sourceH),
  ),
)

</script>

<template>
  <div class="rect-editor">
    <div class="rect-editor__toolbar">
      <div class="rect-editor__toggle" role="group" aria-label="数值显示格式">
        <button
          type="button"
          class="rect-editor__toggle-button"
          :class="{ 'rect-editor__toggle-button--active': mode === 'fraction' }"
          :aria-pressed="mode === 'fraction'"
          @click="mode = 'fraction'"
        >
          小数
        </button>
        <button
          type="button"
          class="rect-editor__toggle-button"
          :class="{ 'rect-editor__toggle-button--active': mode === 'percent' }"
          :aria-pressed="mode === 'percent'"
          @click="mode = 'percent'"
        >
          百分比
        </button>
      </div>
      <span class="rect-editor__note">输入始终按 0~1 归一化写入</span>
    </div>

    <div class="rect-editor__body">
      <div class="rect-editor__groups">
        <section class="rect-editor__group" aria-label="目标区 dest">
          <h3 class="rect-editor__group-title">目标区 dest</h3>
          <PropertyValueForm
            v-for="row in destRows"
            :key="row.path"
            :row="row"
            panel="properties"
            :playhead="playhead"
            :disabled="disabled"
          />
        </section>

        <section class="rect-editor__group" aria-label="源区 source">
          <h3 class="rect-editor__group-title">源区 source</h3>
          <PropertyValueForm
            v-for="row in sourceRows"
            :key="row.path"
            :row="row"
            panel="properties"
            :playhead="playhead"
            :disabled="disabled"
          />
        </section>
      </div>

      <figure class="rect-editor__preview">
        <svg
          class="rect-editor__svg"
          :viewBox="`0 0 ${BOX_W} ${BOX_H}`"
          role="img"
          aria-label="合成矩形示意：整幅画面、源区与目标区"
        >
          <rect
            class="rect-editor__frame"
            :x="PAD"
            :y="PAD"
            :width="BOX_W - PAD * 2"
            :height="BOX_H - PAD * 2"
          />
          <rect
            class="rect-editor__source"
            :x="sourceRect.x"
            :y="sourceRect.y"
            :width="sourceRect.width"
            :height="sourceRect.height"
          />
          <rect
            class="rect-editor__dest"
            :x="destRect.x"
            :y="destRect.y"
            :width="destRect.width"
            :height="destRect.height"
          />
        </svg>
        <figcaption class="rect-editor__legend">
          <span class="rect-editor__swatch rect-editor__swatch--frame" aria-hidden="true" />
          整幅画面
          <span class="rect-editor__swatch rect-editor__swatch--source" aria-hidden="true" />
          源区 source
          <span class="rect-editor__swatch rect-editor__swatch--dest" aria-hidden="true" />
          目标区 dest
        </figcaption>
        <dl class="rect-editor__readout">
          <div class="rect-editor__readout-item">
            <dt>dest</dt>
            <dd>{{ formatValue(valueOf(COMPOSITE_PATHS.destX)) }}, {{ formatValue(valueOf(COMPOSITE_PATHS.destY)) }} · {{ formatValue(valueOf(COMPOSITE_PATHS.destW)) }} × {{ formatValue(valueOf(COMPOSITE_PATHS.destH)) }}</dd>
          </div>
          <div class="rect-editor__readout-item">
            <dt>source</dt>
            <dd>{{ formatValue(valueOf(COMPOSITE_PATHS.sourceX)) }}, {{ formatValue(valueOf(COMPOSITE_PATHS.sourceY)) }} · {{ formatValue(valueOf(COMPOSITE_PATHS.sourceW)) }} × {{ formatValue(valueOf(COMPOSITE_PATHS.sourceH)) }}</dd>
          </div>
        </dl>
        <ul v-if="warnings.length > 0" class="rect-editor__warnings" role="alert">
          <li v-for="warning in warnings" :key="warning.path">{{ warning.message }}</li>
        </ul>
      </figure>
    </div>

    <p v-if="animatedCount > 0" class="rect-editor__animated" role="status">
      {{ animatedCount }} 项已打帧，在效果面板编辑
    </p>
  </div>
</template>

<style scoped>
.rect-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.rect-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rect-editor__toggle {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
  padding: 1px;
}

.rect-editor__toggle-button {
  padding: 1px 6px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.rect-editor__toggle-button--active {
  background: var(--bg-raised);
  color: var(--text);
}

.rect-editor__toggle-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.rect-editor__note {
  color: var(--text-muted);
  font-size: 10px;
}

.rect-editor__body {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.rect-editor__groups {
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.rect-editor__group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.rect-editor__group-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
}

.rect-editor__preview {
  flex: 0 1 160px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  min-width: 160px;
}

.rect-editor__svg {
  width: 160px;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
}

.rect-editor__frame {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1;
}

.rect-editor__source {
  fill: var(--accent);
  fill-opacity: 0.08;
  stroke: var(--accent);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}

.rect-editor__dest {
  fill: var(--warning);
  fill-opacity: 0.1;
  stroke: var(--warning);
  stroke-width: 1;
}

.rect-editor__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  color: var(--text-muted);
  font-size: 10px;
}

.rect-editor__swatch {
  display: inline-block;
  width: 12px;
  height: 8px;
  border-radius: 1px;
}

.rect-editor__swatch--frame {
  border: 1px solid var(--border-strong);
}

.rect-editor__swatch--source {
  border: 1px dashed var(--accent);
}

.rect-editor__swatch--dest {
  border: 1px solid var(--warning);
}

.rect-editor__readout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.rect-editor__readout-item {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.rect-editor__readout-item dt {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.rect-editor__readout-item dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rect-editor__warnings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--warning);
  font-size: 10px;
}

.rect-editor__animated {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
