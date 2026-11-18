<script setup lang="ts">
/**
 * 曲线摘要（10-06）：属性面板只显示 10 条曲线的“点数 + 强度”，点一条打开曲线抽屉。
 */
import { computed, ref } from 'vue'
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { COLOR_CURVES, curveStrengthPath } from '../shared/colorSpec.ts'
import { parseCurvePoints } from '../shared/curveMath.ts'
import { commitPathValue, currentValueOf } from '../shared/fieldOps.ts'
import { setCurveTarget } from '../shared/curveTarget.ts'

const props = defineProps<{
  row: PropertyRow
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}>()

const ctx = usePanelContext()
const error = ref('')

function rawCurve(path: string): unknown {
  const property = props.objects[path]
  if (typeof property !== 'object' || property === null) return undefined
  return (property as Record<string, JsonValue>).value
}

function strengthOf(path: string): number {
  const strengthPath = curveStrengthPath(path)
  const raw = currentValueOf({ ...props.row, path: strengthPath } as PropertyRow, props.objects)
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
}

const rows = computed(() => COLOR_CURVES.map((curve) => {
  const parsed = parseCurvePoints(rawCurve(curve.key))
  return {
    ...curve,
    count: parsed.points.length,
    valid: parsed.ok,
    strength: strengthOf(curve.key),
    issues: parsed.issues,
  }
}))

function open(curve: string): void {
  setCurveTarget({ key: curve, clipKey: props.row.clipKey })
  ctx.requestOpenDrawer('color-curves')
}

const allEmpty = computed(() => rows.value.every((entry) => entry.count === 0))

function resetAll(): void {
  if (props.disabled) return
  for (const curve of COLOR_CURVES) {
    const outcome = commitPathValue(ctx.commands, props.row, props.objects, curve.key, null as JsonValue, props.playhead)
    if (!outcome.ok) {
      error.value = outcome.error ?? '重置被拒绝'
      return
    }
  }
  error.value = ''
}
</script>

<template>
  <div class="wf-curves" :data-path="row.path">
    <p v-if="allEmpty" class="wf-curves__hint">10 条曲线都未设置；点一条打开曲线抽屉，或先用默认 0→0 / 1→1。</p>
    <div class="wf-curves__grid">
      <button
        v-for="entry in rows"
        :key="entry.key"
        type="button"
        class="wf-curves__item"
        :class="{ 'wf-curves__item--empty': entry.count === 0, 'wf-curves__item--invalid': !entry.valid }"
        :disabled="disabled"
        :title="entry.issues.join('；')"
        @click="open(entry.key)"
      >
        <span class="wf-curves__name">{{ entry.label }}</span>
        <span class="wf-curves__meta">
          {{ entry.count === 0 ? '未设置' : `${entry.count} 点` }} · 强度 {{ entry.strength.toFixed(2) }}
        </span>
        <span v-if="!entry.valid" class="wf-curves__bad">点集无效</span>
      </button>
    </div>
    <div class="wf-curves__foot">
      <span class="wf-curves__hint">曲线定义是静态点集；逐帧变化只走各自的“强度”。</span>
      <button type="button" class="wf-curves__reset" :disabled="disabled" @click="resetAll">清空 10 条曲线</button>
    </div>
    <p v-if="error !== ''" class="wf-curves__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf-curves {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.wf-curves__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
}

.wf-curves__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  padding: 3px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.wf-curves__item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wf-curves__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.wf-curves__item--empty {
  color: var(--text-muted);
}

.wf-curves__item--invalid {
  border-color: var(--error);
}

.wf-curves__name {
  overflow: hidden;
  max-width: 100%;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-curves__meta {
  color: var(--text-muted);
  font-size: 9px;
}

.wf-curves__bad {
  color: var(--error);
  font-size: 9px;
}

.wf-curves__hint,
.wf-curves__error {
  margin: 0;
  font-size: 10px;
}

.wf-curves__hint {
  color: var(--text-muted);
}

.wf-curves__error {
  color: var(--error);
}

.wf-curves__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.wf-curves__reset {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}
</style>
