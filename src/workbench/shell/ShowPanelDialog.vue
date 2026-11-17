<script setup lang="ts">
/**
 * 「显示面板」对话框（04-03 / 04-04 视图菜单）。
 *
 * 列出当前页里 `visible=false` 的面板；选中后 `showPanel` 恢复到原 group。
 * 命令面板与菜单都走同一条命令链（`layout.showPanel` → 这里）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import type { PanelRef } from '../api/ids.ts'
import { panelRefKey } from '../api/ids.ts'
import type { PanelRegistry } from '../api/registries.ts'
import type { WorkspaceLayoutService } from '../api/layout.ts'
import { LAYOUT_SERVICE, PANEL_REGISTRY } from '../api/tokens.ts'
import { useDialogs, useI18n, useServices } from './useWorkbench.ts'

const props = defineProps<{ pageId: string }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const services = useServices()
const i18n = useI18n()
const dialogs = useDialogs()

const selected = ref(0)
const rootEl = ref<HTMLElement | null>(null)

function layout(): WorkspaceLayoutService {
  return services.require(LAYOUT_SERVICE)
}

function panels(): PanelRegistry {
  return services.require(PANEL_REGISTRY)
}

interface Row {
  ref: PanelRef
  label: string
}

const rows = computed<Row[]>(() => {
  const tree = layout().getTree(props.pageId)
  const hidden: Row[] = []
  const visit = (node: { type: string; panels?: unknown[]; children?: unknown[] }): void => {
    if (node.type === 'group') {
      const group = node as unknown as { visible: boolean; panels: Array<{ pluginId: string; panelId: string; visible: boolean }> }
      if (!group.visible) {
        for (const panel of group.panels) {
          const contribution = panels().get(panel.pluginId, panel.panelId)
          hidden.push({
            ref: { pluginId: panel.pluginId, panelId: panel.panelId },
            label: contribution === undefined ? `${panel.pluginId}:${panel.panelId}` : i18n.t(contribution.titleKey),
          })
        }
      }
      return
    }
    for (const child of node.children ?? []) {
      visit(child as never)
    }
  }
  visit(tree.root as never)
  return hidden
})

function show(): void {
  const row = rows.value[selected.value]
  if (row === undefined) {
    return
  }
  layout().showPanel(props.pageId, row.ref)
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  if (event.key === 'ArrowDown' && rows.value.length > 0) {
    event.preventDefault()
    selected.value = (selected.value + 1) % rows.value.length
    return
  }
  if (event.key === 'ArrowUp' && rows.value.length > 0) {
    event.preventDefault()
    selected.value = (selected.value - 1 + rows.value.length) % rows.value.length
  }
}

onMounted(() => {
  dialogs.open('show-panel')
  // 焦点陷阱：弹窗打开即把焦点移入，否则 Esc / 方向键收不到（04-10）。
  void nextTick(() => rootEl.value?.focus())
})

onBeforeUnmount(() => {
  dialogs.close('show-panel')
})

void panelRefKey
</script>

<template>
  <div class="backdrop" @pointerdown.self="emit('close')">
    <div
      ref="rootEl"
      class="dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="i18n.t('cmd.layout.showPanel')"
      @keydown="onKeydown"
    >
      <h2>{{ i18n.t('cmd.layout.showPanel') }}</h2>
      <p v-if="rows.length === 0" class="empty" role="status">{{ i18n.t('panel.noneHidden') }}</p>
      <ul v-else class="list">
        <li v-for="(row, index) in rows" :key="`${row.ref.pluginId}:${row.ref.panelId}`">
          <button
            type="button"
            class="row"
            :class="{ active: index === selected }"
            @click="selected = index; show()"
          >
            {{ row.label }}
          </button>
        </li>
      </ul>
      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">{{ i18n.t('common.cancel') }}</button>
        <button type="button" class="primary" :disabled="rows.length === 0" @click="show">{{ i18n.t('common.confirm') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay, rgba(0, 0, 0, 0.45));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.dialog {
  width: min(420px, 90vw);
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 16px;
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dialog h2 { margin: 0; font-size: 14px; }
.list { list-style: none; margin: 0; padding: 0; max-height: 40vh; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.row {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text);
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.row.active, .row:hover { background: var(--bg-selected); }
.row:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.empty { color: var(--text-muted); font-size: 12px; margin: 0; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.ghost, .primary { border-radius: 4px; font-size: 12px; padding: 6px 12px; cursor: pointer; }
.ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
.primary { background: var(--accent); color: var(--bg-app); border: 0; font-weight: 600; }
.primary:disabled { opacity: 0.5; cursor: default; }
.ghost:focus-visible, .primary:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
