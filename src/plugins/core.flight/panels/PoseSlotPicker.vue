<script setup lang="ts">
/**
 * 12-08 九槽选择器（共享组件）。
 *
 * 模板面板 / 曲线工具 / 属性面板共用同一实例，不复制三套。
 * 只读查看：选择器不改文档、不改播放头与选择；点槽位只回调 `onPick(index)`。
 */
import { computed } from 'vue'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import type { PoseSlot, PoseSlotSource } from '../../../features/flight/public.ts'

const props = defineProps<{
  /** 打开 / 关闭（由宿主控制显隐）。 */
  open: boolean
  /** 固定九槽（来自同一 PoseBank 实例）。 */
  slots: readonly PoseSlot[]
  /** 选中某个非空槽位。 */
  onPick: (index: number) => void
  /** 关闭选择器。 */
  onClose: () => void
}>()

const ctx = usePanelContext()

function sourceLabel(source: PoseSlotSource | null): string {
  return ctx.i18n.t(`flight.source.${source ?? 'none'}`)
}

const filledCount = computed(() => props.slots.filter((slot) => slot.pose !== null).length)

function pick(index: number): void {
  const slot = props.slots[index]
  if (slot === undefined || slot.pose === null) {
    return
  }
  props.onPick(index)
}
</script>

<template>
  <div v-if="open" class="slot-picker" role="dialog" :aria-label="ctx.i18n.t('flight.picker.title')">
    <header class="picker-head">
      <strong>{{ ctx.i18n.t('flight.picker.title') }}</strong>
      <span class="muted">{{ filledCount }} / {{ slots.length }}</span>
      <button type="button" class="mini" @click="onClose">{{ ctx.i18n.t('flight.picker.close') }}</button>
    </header>
    <div v-if="filledCount === 0" class="empty">{{ ctx.i18n.t('flight.picker.empty') }}</div>
    <div v-else class="picker-grid">
      <button
        v-for="slot in slots"
        :key="slot.index"
        type="button"
        class="slot-cell"
        :class="{ empty: slot.pose === null }"
        :disabled="slot.pose === null"
        @click="pick(slot.index)"
      >
        <span class="slot-no">#{{ slot.index + 1 }}</span>
        <span v-if="slot.pose !== null" class="slot-source">{{ sourceLabel(slot.source) }}</span>
        <span v-else class="slot-source muted">{{ ctx.i18n.t('flight.source.none') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.slot-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 8px;
  background: var(--bg-raised);
}

.picker-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.picker-head .muted {
  color: var(--text-muted);
  margin-right: auto;
}

.muted {
  color: var(--text-muted);
}

.empty {
  padding: 12px 8px;
  color: var(--text-muted);
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.slot-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text);
  border-radius: 4px;
  padding: 6px;
  cursor: pointer;
  text-align: left;
}

.slot-cell.empty {
  opacity: 0.45;
  cursor: not-allowed;
}

.slot-no {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
}

.slot-source {
  font-size: 11px;
  color: var(--text-secondary);
}

.mini {
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text);
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
}
</style>
