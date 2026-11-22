<script setup lang="ts">
/**
 * 在草稿中编辑球心、半径和方体的两个角点。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject } from '../../../core/doc/json.ts'
import { normalizeBox } from '../panels/triggerPanelModel.ts'
import { readRegionView as readCatalogRegion } from '../../../features/behavior/triggerConditions.ts'

const props = defineProps<{ conditions: JsonObject }>()
const hasSphere = computed(() => props.conditions.position !== undefined || props.conditions.radius !== undefined)
const hasBox = computed(() => props.conditions.corner1 !== undefined || props.conditions.corner2 !== undefined)

function toggleSphere(event: Event): void {
  if ((event.target as HTMLInputElement).checked) {
    props.conditions.position ??= {}
    return
  }
  delete props.conditions.position
  delete props.conditions.radius
}

function toggleBox(event: Event): void {
  if ((event.target as HTMLInputElement).checked) {
    props.conditions.corner1 ??= {}
    props.conditions.corner2 ??= {}
    return
  }
  delete props.conditions.corner1
  delete props.conditions.corner2
}

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
  if (p === undefined) return true
  return p.x === undefined || p.y === undefined || p.z === undefined
})

function pointTarget(which: 'position' | 'corner1' | 'corner2'): void {
  const point = props.conditions[which]
  if (!isJsonObject(point)) {
    props.conditions[which] = {}
  }
}

function onPointInput(which: 'position' | 'corner1' | 'corner2', axis: 'x' | 'y' | 'z', event: Event): void {
  const target = event.target as HTMLInputElement
  pointTarget(which)
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
  if (!isJsonObject(point)) return ''
  const value = point[axis]
  return isFiniteNumber(value) ? value : ''
}
</script>

<template>
  <div class="region-editor">
    <div class="region-editor__types">
      <label><input type="checkbox" :checked="hasSphere" @change="toggleSphere" /> 球形</label>
      <label><input type="checkbox" :checked="hasBox" @change="toggleBox" /> 方体</label>
    </div>
    <div v-if="hasSphere" class="region-editor__block">
      <span class="region-editor__title">球心</span>
      <div class="region-editor__point">
        <label>x <input type="number" :value="pointValue('position', 'x')" @input="onPointInput('position', 'x', $event)" /></label>
        <label>y <input type="number" :value="pointValue('position', 'y')" @input="onPointInput('position', 'y', $event)" /></label>
        <label>z <input type="number" :value="pointValue('position', 'z')" @input="onPointInput('position', 'z', $event)" /></label>
      </div>
      <label class="region-editor__radius">
        半径 <input type="number" :value="conditions.radius ?? ''" @input="onRadiusInput" />
      </label>
      <p v-if="sphereIncomplete" class="region-editor__warn">球心需要 x、y、z</p>
    </div>

    <div v-if="hasBox" class="region-editor__block">
      <span class="region-editor__title">方体角点</span>
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
      <p v-if="box === null || box.incomplete" class="region-editor__warn">两个角点都需要 x、y、z</p>
    </div>
  </div>
</template>

<style scoped>
.region-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.region-editor__block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.region-editor__title,
.region-editor__warn {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #999);
}

.region-editor__warn {
  color: var(--warning, #e0a555);
}

.region-editor__types,
.region-editor__point,
.region-editor__radius {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.region-editor__types label,
.region-editor__point label,
.region-editor__radius {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.region-editor input[type='number'] {
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
