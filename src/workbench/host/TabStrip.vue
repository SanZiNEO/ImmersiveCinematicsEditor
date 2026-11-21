<script setup lang="ts">
/**
 * 标签条（04-05）。
 *
 * 只负责标签展示、激活、右键菜单和拖动入口；不写布局、不持尺寸。
 * 面板管理集中在右键菜单，标签本身保持纯文字行，避免每个标签都挂关闭按钮。
 * 键盘：Enter / Space 激活；Delete 不绑定；拖动交给注入的 `DockContext`。
 */
import { computed, inject } from 'vue'
import type { PanelNode } from '../api/layout.ts'
import { DOCK_CONTEXT_KEY } from '../dock/dockContext.ts'
import { DRAWER_TAB_REGISTRY, I18N_SERVICE, PANEL_REGISTRY } from '../api/tokens.ts'
import type { I18nApi } from '../api/context.ts'
import type { DrawerTabRegistry, PanelRegistry } from '../api/registries.ts'
import { TAB_STRIP_GROUP_KEY } from './tabStripContext.ts'
import { WORKBENCH_SERVICES_KEY } from './panelContext.ts'

const props = defineProps<{
  panels: PanelNode[]
  activePanelId?: string
}>()

const emit = defineEmits<{
  activate: [panelId: string]
  contextMenu: [panelId: string, x: number, y: number]
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const registry: PanelRegistry | undefined = services?.get(PANEL_REGISTRY)
const drawerTabs: DrawerTabRegistry | undefined = services?.get(DRAWER_TAB_REGISTRY)
const i18n: I18nApi | undefined = services?.get(I18N_SERVICE)
const dock = inject(DOCK_CONTEXT_KEY, null)
const groupId = inject(TAB_STRIP_GROUP_KEY, '')

const activeId = computed(() => {
  if (props.activePanelId !== undefined) {
    return props.activePanelId
  }
  return props.panels.find((panel) => panel.visible)?.id
})

function titleOf(panel: PanelNode): string {
  const contribution = registry?.get(panel.pluginId, panel.panelId)
  if (contribution !== undefined) {
    return i18n?.t(contribution.titleKey) ?? contribution.titleKey
  }
  const tab = drawerTabs?.get(panel.panelId)
  if (tab !== undefined && tab.pluginId === panel.pluginId) {
    return i18n?.t(tab.contribution.titleKey) ?? tab.contribution.titleKey
  }
  return panel.panelId
}

function isActive(panel: PanelNode): boolean {
  return panel.id === activeId.value
}

function onActivate(panel: PanelNode): void {
  emit('activate', panel.panelId)
}

function onPointerDown(event: PointerEvent, panel: PanelNode): void {
  if (event.button !== 0 || dock === null) {
    return
  }
  dock.beginPanelDrag(
    event,
    { pluginId: panel.pluginId, panelId: panel.panelId },
    groupId,
  )
}

function onContextMenu(event: MouseEvent, panel: PanelNode): void {
  event.preventDefault()
  emit('contextMenu', panel.panelId, event.clientX, event.clientY)
}

function onKeyboardContextMenu(event: KeyboardEvent, panel: PanelNode): void {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
    return
  }
  event.preventDefault()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) {
    return
  }
  const rect = target.getBoundingClientRect()
  emit('contextMenu', panel.panelId, rect.left, rect.bottom)
}
</script>

<template>
  <div class="tab-strip" role="tablist" aria-orientation="horizontal">
    <div
      v-for="(panel, index) in panels"
      :key="panel.id"
      class="tab-strip__tab"
      :class="{ 'tab-strip__tab--active': isActive(panel), 'tab-strip__tab--dragging': dock?.isPanelDragging(panel) }"
      role="tab"
      tabindex="0"
      :aria-selected="isActive(panel)"
      :aria-label="titleOf(panel)"
      aria-haspopup="menu"
      :title="titleOf(panel)"
      :data-dock-kind="'tabbar'"
      :data-dock-group-id="groupId"
      :data-dock-tab-index="index"
      :data-dragging="dock?.isPanelDragging(panel) ? 'true' : undefined"
      @click="onActivate(panel)"
      @pointerdown="onPointerDown($event, panel)"
      @contextmenu="onContextMenu($event, panel)"
      @keydown.enter.prevent="onActivate(panel)"
      @keydown.space.prevent="onActivate(panel)"
      @keydown="onKeyboardContextMenu($event, panel)"
    >
      <span class="tab-strip__title">{{ titleOf(panel) }}</span>
    </div>
  </div>
</template>

<style scoped>
.tab-strip {
  display: flex;
  flex: 0 0 auto;
  align-items: stretch;
  gap: 2px;
  min-height: 28px;
  padding: 0 6px;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border);
}

.tab-strip__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  padding: 0 8px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1;
  cursor: default;
  user-select: none;
  white-space: nowrap;
}

.tab-strip__tab:hover {
  background: color-mix(in srgb, var(--bg-hover) 70%, transparent);
  color: var(--text);
}

.tab-strip__tab--active {
  background: transparent;
  color: var(--text);
}

.tab-strip__tab--active::after {
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
  content: '';
}

.tab-strip__tab--dragging {
  opacity: 0.6;
}

.tab-strip__tab:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.tab-strip__title {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
