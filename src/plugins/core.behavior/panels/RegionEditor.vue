<script setup lang="ts">
/**
 * 区域编辑器（11-04）：球形（position + radius）与方体（corner1 + corner2）可共存 = OR；
 * 角点自动 min/max；坐标三分量缺一标「条件永不满足」。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isFiniteNumber } from '../../../core/doc/json.ts'
import { normalizeBox } from './triggerPanelModel.ts'
import { readRegionView as readCatalogRegion } from '../../../features/behavior/triggerConditions.ts'

const props = defineProps<{ conditions: JsonObject }>()

const view = computed(() => readCatalogRegion(props.conditions))

const box = computed(() => {
  const c1 = view.value.box?.corner1
  const c2 = view.value.box?.corner2
  if (c1 === undefined || c2 === undefined) return null
  return normalizeBox(
    { x: c1.x, y: c1.y, z: c1.z },
    { x: c2.x, y: c2.y, z: c2.z },
  )
})

const sphereIncomplete = computed(() => {
  const p = view.value.sphere?.position
  if (p === undefined) return false
  return p.x === undefined || p.y === undefined || p.z === undefined
})

function pointTarget(which: 'position' | 'corner1' | 'corner2', axis: 'x' | 'y' | 'z'): void {
  const point = props.conditions[which]
  if (!point || typeof point !== 'object') {
    props.conditions[which] = {}
  }
}

function onPointInput(which: 'position' | 'corner1' | 'corner2', axis: 'x' | 'y' | 'z', event: Event): void {
  const target = event.target as HTMLInputElement
  pointTarget(which, axis)
  const point = props.conditions[which] as JsonObject
  if (target.value === '') {
    delete point[axis]
    return
  }
  point[axis] = Number(target.value)
}

function onRadiusInput(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') {
    delete props.conditions.radius
    return
  }
  props.conditions.radius = Number(target.value)
}

function pointValue(which: 'position' | 'corner1' | 'corner2', axis: 'x' | 'y' | 'z'): number | '' {
  const point = props.conditions[which]
  if (!point || typeof point !== 'object') return ''
  const value = (point as JsonObject)[axis]
  return isFiniteNumber(value) ? value : ''
}
</script>

<template>
  <div class="region-editor">
    <div v-if="view.sphere !== undefined" class="region-editor__block">
      <span class="region-editor__title">球形</span>
      <div class="region-editor__point">
        <label>x <input type="number" :value="pointValue('position', 'x')" @input="onPointInput('position', 'x', $event)" /></label>
        <label>y <input type="number" :value="pointValue('position', 'y')" @input="onPointInput('position', 'y', $event)" /></label>
        <label>z <input type="number" :value="pointValue('position', 'z')" @input="onPointInput('position', 'z', $event)" /></label>
      </div>
      <label class="region-editor__radius">
        半径 <input type="number" :value="conditions.radius ?? ''" @input="onRadiusInput" />
      </label>
      <p v-if="sphereIncomplete" class="region-editor__warn">球形中心缺少 x/y/z 分量，条件永不满足</p>
    </div>

    <div v-if="view.box !== undefined" class="region-editor__block">
      <span class="region-editor__title">方体（角点自动 min/max，顺序无关）</span>
      <div class="region-editor__point">
        <label>1x <input type="number" :value="pointValue('corner1', 'x')" @input="onPointInput('corner1', 'x', $event)" /></label>
        <label>1y <input type="number" :value="pointValue('corner1', 'y')" @input="onPointInput('corner1', 'y', $event)" /></label>
        <label>1z <input type="number" :value="pointValue('corner1', 'z')" @input="onPointInput('corner1', 'z', $event)" /></label>
      </div>
      <div class="region-editor__point">
        <label>2x <input type="number" :value="pointValue('corner2', 'x')" @input="onPointInput('corner2', 'x', $event)" /></label>
        <label>2y <input type="number" :value="pointValue('corner2', 'y')" @input="onPointInput('corner2', 'y', $event)" /></label>
        <label>2z <input type="number" :value="pointValue('corner2', 'z')" @input="onPointInput('corner2', 'z', $event)" /></label>
      </div>
      <p v-if="box?.incomplete" class="region-editor__warn">角点缺少 x/y/z 分量，条件永不满足</p>
      <p v-else-if="box" class="region-editor__note">
        归一：({{ box.min.x }}, {{ box.min.y }}, {{ box.min.z }}) ~ ({{ box.max.x }}, {{ box.max.y }}, {{ box.max.z }})
      </p>
    </div>
    <p v-if="view.sphere !== undefined && view.box !== undefined" class="region-editor__note">球形与方体共存 = OR</p>
  </div>
</template>

<style scoped>
.region-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px dashed var(--border, #444);
  border-radius: 4px;
}

.region-editor__block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.region-editor__title,
.region-editor__note,
.region-editor__warn {
  font-size: 11px;
  color: var(--text-muted, #999);
}

.region-editor__warn {
  color: var(--warning, #e0a555);
}

.region-editor__point,
.region-editor__radius {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.region-editor__point label,
.region-editor__radius label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.region-editor input {
  width: 64px;
  font: inherit;
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid var(--border, #444);
  border-radius: 3px;
  background: var(--panel-bg, #1c1c1c);
  color: var(--text, #eee);
}
</style>
