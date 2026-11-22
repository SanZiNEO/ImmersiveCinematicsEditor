<script setup lang="ts">
/**
 * 组渲染（04-05）：标签条 + 当前活动 PanelHost。
 *
 * `keepAlive` 的面板由 PanelHost 自己用 `v-show` 保留挂载；这里只负责
 * 按布局树渲染全部标签实例，不写布局、不持尺寸。
 */
import { computed, inject, nextTick, onBeforeUnmount, provide, ref } from 'vue'
import type { GroupNode } from '../api/layout.ts'
import type { PanelRef } from '../api/ids.ts'
import type { WorkspaceLayoutService } from '../api/layout.ts'
import { LAYOUT_SERVICE } from '../api/tokens.ts'
import TabStrip from './TabStrip.vue'
import PanelHost from './PanelHost.vue'
import { PANEL_ACTIONS_KEY, WORKBENCH_SERVICES_KEY } from './panelContext.ts'
import { TAB_STRIP_GROUP_KEY } from './tabStripContext.ts'
import { activePanelOf } from './layoutGeometry.ts'

const props = defineProps<{
  group: GroupNode
  pageId: string
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const layout: WorkspaceLayoutService | undefined = services?.get(LAYOUT_SERVICE)
const actions = inject(PANEL_ACTIONS_KEY, null)

provide(TAB_STRIP_GROUP_KEY, props.group.id)

const activeId = computed(() => activePanelOf(props.group)?.id)

interface MenuState {
  panelId: string
  x: number
  y: number
}

const menu = ref<MenuState | null>(null)
const firstMenuItem = ref<HTMLButtonElement | null>(null)
let menuTrigger: HTMLElement | null = null
let removeMenuListeners: (() => void) | null = null

function panelRefOf(panelId: string): PanelRef | null {
  const panel = props.group.panels.find((candidate) => candidate.panelId === panelId)
  return panel === undefined ? null : { pluginId: panel.pluginId, panelId: panel.panelId }
}

function activate(panelId: string): void {
  const target = panelRefOf(panelId)
  if (target === null || layout === undefined) {
    return
  }
  layout.setActivePanel(props.pageId, props.group.id, target)
}

function closePanel(panelId: string): void {
  const target = panelRefOf(panelId)
  if (target === null) {
    return
  }
  if (actions !== null) {
    actions.closePanel(target)
    return
  }
  layout?.hidePanel(props.pageId, target)
}

function resetLayout(): void {
  if (actions !== null) {
    actions.resetLayout()
    return
  }
  layout?.resetLayout(props.pageId)
}

function openMenu(panelId: string, x: number, y: number): void {
  closeMenu()
  if (typeof document === 'undefined') {
    return
  }
  const trigger = document.activeElement
  menuTrigger = trigger instanceof HTMLElement && trigger.getAttribute('role') === 'tab'
    ? trigger
    : null
  menu.value = { panelId, x, y }
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof HTMLElement && target.closest('.group-renderer__menu') !== null) {
      return
    }
    closeMenu()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closeMenu()
    }
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
  removeMenuListeners = () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
  }
  void nextTick(() => {
    firstMenuItem.value?.focus()
  })
}

function closeMenu(restoreFocus = false): void {
  menu.value = null
  removeMenuListeners?.()
  removeMenuListeners = null
  if (restoreFocus) {
    menuTrigger?.focus()
  }
  menuTrigger = null
}

function hideFromMenu(): void {
  const current = menu.value
  if (current === null) {
    return
  }
  closeMenu()
  closePanel(current.panelId)
}

function resetFromMenu(): void {
  closeMenu()
  resetLayout()
}

function onMenuKeyDown(event: KeyboardEvent): void {
  const items = Array.from(
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      : [],
  )
  if (items.length === 0) {
    return
  }
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + step + items.length) % items.length
    items[nextIndex]?.focus()
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
  }
}

onBeforeUnmount(() => {
  closeMenu()
})

const emptyLabel = '该区域没有可用面板'
</script>

<template>
  <div
    v-if="group.visible && !group.collapsed"
    class="group-renderer"
    :data-dock-kind="'group'"
    :data-dock-group-id="group.id"
  >
    <TabStrip
      v-if="group.panels.length > 0"
      :panels="group.panels"
      :active-panel-id="activeId"
      @activate="activate"
      @context-menu="openMenu"
    />
    <div class="group-renderer__body">
      <PanelHost
        v-for="panel in group.panels"
        :key="panel.id"
        :plugin-id="panel.pluginId"
        :panel-id="panel.panelId"
        :page-id="pageId"
        :group-id="group.id"
      />
      <div v-if="group.panels.length === 0" class="group-renderer__empty" role="status">
        <p>{{ emptyLabel }}</p>
        <button type="button" class="group-renderer__button" @click="resetLayout">
          重置布局
        </button>
      </div>
    </div>

    <div
      v-if="menu !== null"
      class="group-renderer__menu"
      role="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @keydown="onMenuKeyDown"
    >
      <button
        ref="firstMenuItem"
        type="button"
        class="group-renderer__menu-item"
        role="menuitem"
        @click="hideFromMenu"
      >
        隐藏面板
      </button>
      <button type="button" class="group-renderer__menu-item" role="menuitem" @click="resetFromMenu">
        重置布局
      </button>
    </div>
  </div>
</template>

<style scoped>
.group-renderer {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
}

.group-renderer__body {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.group-renderer__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-muted);
  font-size: 12px;
}

.group-renderer__empty p {
  margin: 0;
}

.group-renderer__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.group-renderer__button:hover {
  background: var(--bg-hover);
}

.group-renderer__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.group-renderer__menu {
  position: fixed;
  z-index: 20;
  display: flex;
  min-width: 140px;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-raised);
  box-shadow: 0 6px 20px var(--shadow);
}

.group-renderer__menu-item {
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}

.group-renderer__menu-item:hover,
.group-renderer__menu-item:focus-visible {
  background: var(--bg-hover);
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
