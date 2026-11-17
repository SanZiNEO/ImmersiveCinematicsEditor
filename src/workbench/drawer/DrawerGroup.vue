<script setup lang="ts">
/**
 * 底部抽屉容器（04-06）。
 *
 * 抽屉是布局树里的 group（固定 `document.drawer`），不是浮层；高度/可见性/活动项
 * 全部走 04-02。标签有两个来源：
 * - `DRAWER_TAB_REGISTRY` 的抽屉标签（排除已拖到其它 group 的）；
 * - 抽屉 group 的 `panels` 里被拖进来的普通面板节点。
 * 抽屉标签用 `DrawerTabHost` 渲染，普通面板用 `PanelHost` 渲染。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DrawerTabRegistry, PanelRegistry } from '../api/registries.ts'
import type { DrawerTabContribution, PanelAvailabilityContext } from '../api/contributions.ts'
import type { GroupNode, LayoutNode, WorkspaceLayoutService } from '../api/layout.ts'
import type { DocumentService } from '../api/documents.ts'
import type { I18nApi } from '../api/context.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import {
  DIAGNOSTICS_SERVICE,
  DOCUMENT_SERVICE,
  DRAWER_TAB_REGISTRY,
  I18N_SERVICE,
  LAYOUT_SERVICE,
  PANEL_REGISTRY,
} from '../api/tokens.ts'
import { DOCK_CONTEXT_KEY } from '../dock/dockContext.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'
import PanelHost from '../host/PanelHost.vue'
import DrawerTabHost from './DrawerTabHost.vue'
import { drawerTabToggle, type DrawerHeightResult } from './drawerLayout.ts'
import {
  collapseDrawer,
  openDrawerPanel,
  openDrawerTab,
  refreshDrawerHeight,
} from './drawerController.ts'

/** 抽屉标签（注册表贡献）。 */
interface DrawerTabEntry {
  kind: 'drawerTab'
  pluginId: string
  tabId: string
  contribution: DrawerTabContribution
  order: number
}

/** 被拖进抽屉 group 的普通面板。 */
interface DrawerPanelEntry {
  kind: 'panel'
  pluginId: string
  panelId: string
  nodeId: string
  titleKey: string | null
  order: number
}

type DrawerEntry = DrawerTabEntry | DrawerPanelEntry

const props = defineProps<{
  groupId: string
  pageId: string
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const layout: WorkspaceLayoutService | undefined = services?.get(LAYOUT_SERVICE)
const registry: DrawerTabRegistry | undefined = services?.get(DRAWER_TAB_REGISTRY)
const panelRegistry: PanelRegistry | undefined = services?.get(PANEL_REGISTRY)
const documentService: DocumentService | undefined = services?.get(DOCUMENT_SERVICE)
const i18n: I18nApi | undefined = services?.get(I18N_SERVICE)
const diagnostics: DiagnosticSink | undefined = services?.get(DIAGNOSTICS_SERVICE)
const dock = inject(DOCK_CONTEXT_KEY, null)

const version = ref(0)
const unsubscribers: Array<() => void> = []

const reportedAvailability = new Set<string>()

const group = computed<GroupNode | undefined>(() => {
  void version.value
  return layout?.getGroup(props.pageId, props.groupId)
})

/** 已在布局树其它 group 里的抽屉 tab：从抽屉标签条移除，避免同一面板两处显示。 */
function panelsOutsideDrawer(): Set<string> {
  const present = new Set<string>()
  const tree = layout?.getTree(props.pageId)
  if (tree === undefined) {
    return present
  }
  const visit = (node: LayoutNode): void => {
    if (node.type === 'group') {
      if (node.id !== props.groupId) {
        for (const panel of node.panels) {
          present.add(`${panel.pluginId}:${panel.panelId}`)
        }
      }
      return
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree.root)
  return present
}

function isAvailable(
  contribution: DrawerTabContribution,
  pluginId: string,
  availability: PanelAvailabilityContext,
): boolean {
  if (contribution.available === undefined) {
    return true
  }
  try {
    return contribution.available(availability)
  } catch (error) {
    const key = `${pluginId}:${contribution.tabId}`
    if (!reportedAvailability.has(key)) {
      reportedAvailability.add(key)
      diagnostics?.report({
        severity: 'warning',
        source: 'panel',
        pluginId,
        message: `抽屉标签可用性求值失败：${contribution.tabId}`,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    return false
  }
}

function entryKey(entry: DrawerEntry): string {
  return entry.kind === 'drawerTab'
    ? `tab:${entry.pluginId}:${entry.tabId}`
    : `panel:${entry.pluginId}:${entry.panelId}`
}

const entries = computed<DrawerEntry[]>(() => {
  void version.value
  const presentElsewhere = panelsOutsideDrawer()
  const summary = documentService?.summary()
  const availability: PanelAvailabilityContext = {
    pageId: props.pageId,
    documentOpen: summary !== undefined && summary.docId !== null,
    services,
  }

  const result: DrawerEntry[] = []
  if (registry !== undefined) {
    for (const item of registry.list()) {
      const key = `${item.pluginId}:${item.contribution.tabId}`
      if (presentElsewhere.has(key)) {
        continue
      }
      if (!isAvailable(item.contribution, item.pluginId, availability)) {
        continue
      }
      result.push({
        kind: 'drawerTab',
        pluginId: item.pluginId,
        tabId: item.contribution.tabId,
        contribution: item.contribution,
        order: item.contribution.order,
      })
    }
  }

  const panelEntries: DrawerPanelEntry[] = []
  for (const panel of group.value?.panels ?? []) {
    const contribution = panelRegistry?.get(panel.pluginId, panel.panelId)
    if (contribution !== undefined) {
      panelEntries.push({
        kind: 'panel',
        pluginId: panel.pluginId,
        panelId: panel.panelId,
        nodeId: panel.id,
        titleKey: contribution.titleKey,
        order: panelEntries.length,
      })
      continue
    }
    // 抽屉 group 里残留的抽屉标签节点（旧布局）：注册表有则由上面的注册表条目覆盖。
    if (registry?.get(panel.panelId) !== undefined) {
      continue
    }
    panelEntries.push({
      kind: 'panel',
      pluginId: panel.pluginId,
      panelId: panel.panelId,
      nodeId: panel.id,
      titleKey: null,
      order: panelEntries.length,
    })
  }

  // 抽屉标签按贡献 order 排；普通面板按布局顺序排在后面。
  result.sort((left, right) => left.order - right.order || entryKey(left).localeCompare(entryKey(right)))
  return [...result, ...panelEntries]
})

const visible = computed(() => group.value?.visible === true && group.value?.collapsed !== true)

const activeEntry = computed<DrawerEntry | undefined>(() => {
  const list = entries.value
  if (list.length === 0) {
    return undefined
  }
  const current = group.value
  const tabId = current?.activeTabId
  if (tabId !== undefined) {
    const found = list.find((entry) => entry.kind === 'drawerTab' && entry.tabId === tabId)
    if (found !== undefined) {
      return found
    }
  }
  const nodeId = current?.activePanelId
  if (nodeId !== undefined) {
    const found = list.find((entry) => entry.kind === 'panel' && entry.nodeId === nodeId)
    if (found !== undefined) {
      return found
    }
  }
  return list[0]
})

const activeKey = computed(() => (activeEntry.value === undefined ? null : entryKey(activeEntry.value)))

const heightInfo = ref<DrawerHeightResult | null>(null)
const noticeDismissed = ref(false)

const noticeText = computed(() => heightInfo.value?.notice ?? '')

const viewportHeight = computed(() => {
  void version.value
  return layout?.viewport().height ?? 0
})

function titleOf(entry: DrawerEntry): string {
  if (entry.kind === 'drawerTab') {
    return i18n?.t(entry.contribution.titleKey) ?? entry.contribution.titleKey
  }
  if (entry.titleKey === null) {
    return `${i18n?.t('panel.missing') ?? '插件未安装'}：${entry.panelId}`
  }
  return i18n?.t(entry.titleKey) ?? entry.titleKey
}

function onTabClick(entry: DrawerEntry): void {
  const current = group.value
  if (layout === undefined || current === undefined) {
    return
  }
  const isActive = activeKey.value === entryKey(entry)
  const isOpen = current.visible && !current.collapsed
  if (isOpen && entry.kind === 'drawerTab') {
    const action = drawerTabToggle(
      { visible: current.visible, collapsed: current.collapsed, activeTabId: entry.tabId },
      entry.tabId,
    )
    if (action === 'collapse') {
      collapseDrawer(layout, props.pageId, props.groupId)
      noticeDismissed.value = false
      return
    }
  } else if (isOpen && isActive) {
    collapseDrawer(layout, props.pageId, props.groupId)
    noticeDismissed.value = false
    return
  }

  const result = entry.kind === 'drawerTab'
    ? openDrawerTab(layout, props.pageId, entry.tabId, props.groupId)
    : openDrawerPanel(
      layout,
      props.pageId,
      { pluginId: entry.pluginId, panelId: entry.panelId },
      props.groupId,
    )
  if (result !== null) {
    heightInfo.value = result
    noticeDismissed.value = false
  }
}

function closeDrawer(): void {
  if (layout === undefined) {
    return
  }
  collapseDrawer(layout, props.pageId, props.groupId)
  noticeDismissed.value = false
}

function onTabPointerDown(event: PointerEvent, entry: DrawerEntry): void {
  if (event.button !== 0 || dock === null) {
    return
  }
  const ref = entry.kind === 'drawerTab'
    ? { pluginId: entry.pluginId, panelId: entry.tabId }
    : { pluginId: entry.pluginId, panelId: entry.panelId }
  dock.beginPanelDrag(event, ref, props.groupId)
}

function refreshHeight(): void {
  if (layout === undefined) {
    return
  }
  if (!visible.value) {
    heightInfo.value = null
    return
  }
  heightInfo.value = refreshDrawerHeight(layout, props.pageId, props.groupId)
}

watch([visible, viewportHeight], refreshHeight, { immediate: true })

onMounted(() => {
  if (layout !== undefined) {
    unsubscribers.push(layout.subscribe(() => {
      version.value += 1
    }))
  }
  if (registry !== undefined) {
    unsubscribers.push(registry.subscribe(() => {
      version.value += 1
    }))
  }
  if (panelRegistry !== undefined) {
    unsubscribers.push(panelRegistry.subscribe(() => {
      version.value += 1
    }))
  }
  if (documentService !== undefined) {
    unsubscribers.push(documentService.subscribe(() => {
      version.value += 1
    }))
  }
})

onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) {
    unsubscribe()
  }
  unsubscribers.length = 0
})
</script>

<template>
  <section
    v-if="group !== undefined"
    class="drawer-group"
    :class="{ 'drawer-group--collapsed': !visible }"
    :data-dock-kind="'drawer'"
    :data-dock-group-id="groupId"
    :aria-label="activeEntry !== undefined ? titleOf(activeEntry) : '抽屉'"
    role="region"
  >
    <header class="drawer-group__header">
      <div class="drawer-group__tabs" role="tablist" aria-orientation="horizontal">
        <div
          v-for="(entry, index) in entries"
          :key="entryKey(entry)"
          class="drawer-group__tab"
          :class="{ 'drawer-group__tab--active': entryKey(entry) === activeKey }"
          role="tab"
          tabindex="0"
          :aria-selected="entryKey(entry) === activeKey"
          :aria-label="titleOf(entry)"
          :data-dock-kind="'tabbar'"
          :data-dock-group-id="groupId"
          :data-dock-tab-index="index"
          :data-dragging="dock?.isPanelDragging(entry.kind === 'drawerTab' ? { pluginId: entry.pluginId, panelId: entry.tabId } : { pluginId: entry.pluginId, panelId: entry.panelId }) ? 'true' : undefined"
          @click="onTabClick(entry)"
          @pointerdown="onTabPointerDown($event, entry)"
          @keydown.enter.prevent="onTabClick(entry)"
          @keydown.space.prevent="onTabClick(entry)"
        >
          <span class="drawer-group__tab-title">{{ titleOf(entry) }}</span>
        </div>
      </div>
      <button
        v-if="visible"
        type="button"
        class="drawer-group__close"
        aria-label="关闭抽屉"
        @click="closeDrawer"
      >
        关闭
      </button>
    </header>

    <p v-if="visible && noticeText.length > 0 && !noticeDismissed" class="drawer-group__notice" role="status">
      <span>{{ noticeText }}</span>
      <button
        type="button"
        class="drawer-group__notice-close"
        aria-label="忽略低窗提示"
        @click="noticeDismissed = true"
      >
        ×
      </button>
    </p>

    <div v-if="visible && entries.length > 0" class="drawer-group__body">
      <template v-for="entry in entries" :key="entryKey(entry)">
        <div v-show="entryKey(entry) === activeKey" class="drawer-group__pane">
          <DrawerTabHost
            v-if="entry.kind === 'drawerTab'"
            :tab-id="entry.tabId"
            :plugin-id="entry.pluginId"
            :page-id="pageId"
            :group-id="groupId"
            :active="entryKey(entry) === activeKey"
          />
          <PanelHost
            v-else
            :plugin-id="entry.pluginId"
            :panel-id="entry.panelId"
            :page-id="pageId"
            :group-id="groupId"
          />
        </div>
      </template>
    </div>
    <div v-else class="drawer-group__empty" role="status">
      <p>抽屉暂无可用面板</p>
      <button type="button" class="drawer-group__button" @click="closeDrawer">关闭抽屉</button>
    </div>
  </section>
</template>

<style scoped>
.drawer-group {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.drawer-group--collapsed {
  /* 折叠成一条标签条：既是“关闭”状态，也是重新打开抽屉的真实入口。
     不能用 `flex: 0 0 26px`：父容器是横向布局时会被解释成宽度 26px。 */
  flex: 0 0 auto;
  width: 100%;
  height: 26px;
  border-top: 1px solid var(--border);
}

.drawer-group--collapsed .drawer-group__header {
  border-bottom: 0;
}

.drawer-group__header {
  display: flex;
  flex: 0 0 auto;
  align-items: stretch;
  justify-content: space-between;
  min-height: 28px;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border);
}

.drawer-group__tabs {
  display: flex;
  align-items: stretch;
  gap: 1px;
  overflow-x: auto;
}

.drawer-group__tab {
  display: inline-flex;
  align-items: center;
  max-width: 200px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.drawer-group__tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.drawer-group__tab--active {
  background: var(--bg-panel);
  border-color: var(--border);
  color: var(--text);
}

.drawer-group__tab:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.drawer-group__tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-group__close {
  flex: 0 0 auto;
  padding: 0 10px;
  border: none;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.drawer-group__close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.drawer-group__close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.drawer-group__notice {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--warning);
  font-size: 11px;
}

.drawer-group__notice-close {
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.drawer-group__notice-close:hover {
  color: var(--text);
}

.drawer-group__notice-close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.drawer-group__body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.drawer-group__pane {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.drawer-group__empty {
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

.drawer-group__empty p {
  margin: 0;
}

.drawer-group__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.drawer-group__button:hover {
  background: var(--bg-hover);
}

.drawer-group__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
