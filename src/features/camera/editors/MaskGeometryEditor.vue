<script setup lang="ts">
/**
 * 遮罩几何编辑器（08-01 §三）：随 `mask_shape` 显隐。
 *
 * 规则：
 * - `full`：几何行折叠成"保留值"摘要——只改可见性，已有值与关键帧一帧不删；
 * - `rect` 只用 x/y/width/height，`circle` 只用 x/y/radius；其余行不出现，但值保留；
 * - 每个可见值复用 06 的 `PropertyValueForm`；越界 / 负宽高只提示，不夹紧、不改写输入。
 */
import { computed } from 'vue'
import {
  COMPOSITE_PATHS,
  MASK_GEOMETRY_PATHS,
  activeMaskGeometryPaths,
  maskShapeOf,
  staticRows,
  type CameraEditorInput,
} from '../fieldSurface.ts'
import type { PropertyRow } from '../../effects/types.ts'
import PropertyValueForm from '../../effects/panels/PropertyValueForm.vue'
import { animatedRowCount, finiteNumber, frameCount, presentRowCount, rowAt } from './editorRows.ts'

const props = defineProps<CameraEditorInput>()

/** 几何里的尺寸 / 半径路径（缺省回退 1 / 0.5 由目录行提供，示意回退用 1）。 */
const SIZE_PATHS: readonly string[] = [
  COMPOSITE_PATHS.maskWidth,
  COMPOSITE_PATHS.maskHeight,
  COMPOSITE_PATHS.maskRadius,
]

/** 当前形状：行值 > 目录缺省 > `full`。 */
const shape = computed(() => {
  const shapeRow = rowAt(props.rows, COMPOSITE_PATHS.maskShape)
  return maskShapeOf(props.objects, shapeRow?.def)
})

/** 当前形状下生效的几何路径。 */
const activePaths = computed(() => activeMaskGeometryPaths(shape.value))

/** 留在属性面板的几何行（已打帧的叶子不在此列）。 */
const staticRowsInScope = computed<PropertyRow[]>(() =>
  staticRows(props.rows).filter((row) => MASK_GEOMETRY_PATHS.includes(row.path)),
)

const staticByPath = computed(() => new Map(staticRowsInScope.value.map((row) => [row.path, row])))

/** 当前形状下可见的行（按 `activePaths` 顺序）。 */
const visibleRows = computed<PropertyRow[]>(() =>
  activePaths.value
    .map((path) => staticByPath.value.get(path))
    .filter((row): row is PropertyRow => row !== undefined),
)

/** `full` 折叠摘要：保留的静态值数 / 关键帧总数（只计数，不删帧）。 */
const retainedValues = computed(() => presentRowCount(props.rows, MASK_GEOMETRY_PATHS))
const retainedFrames = computed(() => frameCount(props.rows, MASK_GEOMETRY_PATHS))

/** 已打帧几何行数（仅提示，不在本面板编辑）。 */
const animatedCount = computed(() => animatedRowCount(props.rows, MASK_GEOMETRY_PATHS))

interface MaskWarning {
  path: string
  message: string
}

function warningFor(row: PropertyRow): MaskWarning | null {
  const value = finiteNumber(row, SIZE_PATHS.includes(row.path) ? 1 : 0)
  const label = row.label
  if (!Number.isFinite(value)) {
    return { path: row.path, message: `${label} 不是有限数字：运行时遮罩结果不可预期` }
  }
  if (SIZE_PATHS.includes(row.path)) {
    if (value < 0) {
      return { path: row.path, message: `${label} 为负：运行时遮罩结果不可预期` }
    }
    if (value > 1) {
      return { path: row.path, message: `${label} 超出 0~1（${Number(value.toFixed(4))}）：运行时遮罩结果不可预期` }
    }
    return null
  }
  if (value < 0 || value > 1) {
    return { path: row.path, message: `${label} 超出 0~1（${Number(value.toFixed(4))}）：运行时遮罩结果不可预期` }
  }
  return null
}

const warnings = computed<MaskWarning[]>(() =>
  visibleRows.value
    .map((row) => warningFor(row))
    .filter((item): item is MaskWarning => item !== null),
)
</script>

<template>
  <div class="mask-editor">
    <!-- full：几何不参与，折叠为保留值摘要；值与帧原样保留 -->
    <div v-if="shape === 'full'" class="mask-editor__retained" role="status">
      <p class="mask-editor__retained-text">
        当前 mask_shape=full，几何不参与；已保留 {{ retainedValues }} 个值 / {{ retainedFrames }} 帧。
      </p>
      <p class="mask-editor__retained-note">切回 rect 或 circle 后恢复原样，已有值与关键帧不会被删除。</p>
    </div>

    <template v-else>
      <div class="mask-editor__rows">
        <PropertyValueForm
          v-for="row in visibleRows"
          :key="row.path"
          :row="row"
          panel="properties"
          :playhead="playhead"
          :disabled="disabled"
        />
      </div>

      <p class="mask-editor__retained-note">未在当前形状中使用的几何值已保留，不会写入运行时遮罩。</p>

      <ul v-if="warnings.length > 0" class="mask-editor__warnings" role="alert">
        <li v-for="warning in warnings" :key="warning.path">{{ warning.message }}</li>
      </ul>
    </template>

    <p v-if="animatedCount > 0" class="mask-editor__animated" role="status">
      {{ animatedCount }} 项已打帧，在效果面板编辑
    </p>
  </div>
</template>

<style scoped>
.mask-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.mask-editor__rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mask-editor__retained {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-panel);
}

.mask-editor__retained-text {
  margin: 0;
  color: var(--text-secondary);
}

.mask-editor__retained-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.mask-editor__warnings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--warning);
  font-size: 10px;
}

.mask-editor__animated {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
}
</style>
