<script setup lang="ts">
/**
 * 布局渲染器（04-05 / 04-03）。
 *
 * 只渲染 `WorkspaceLayoutService.getTree` 的结果；拖动中的临时比例来自冒泡的
 * `dock-resize-preview` 事件，不写布局、不进历史。
 */
import { inject, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import type { LayoutTree } from '../api/layout.ts'
import type { WorkspaceLayoutService } from '../api/layout.ts'
import { LAYOUT_SERVICE } from '../api/tokens.ts'
import {
  DOCK_PAGE_KEY,
  DOCK_RESIZE_PREVIEW_EVENT,
  type DockResizePreviewDetail,
} from '../dock/dockContext.ts'
import LayoutNodeView from './LayoutNodeView.vue'
import { LAYOUT_PREVIEW_KEY, type LayoutPreviewSizes } from './layoutPreview.ts'
import { PANEL_ACTIONS_KEY, WORKBENCH_SERVICES_KEY } from './panelContext.ts'
import { createPagePanelActions } from './panelRuntime.ts'

const props = defineProps<{
  tree: LayoutTree
  pageId: string
}>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const layout: WorkspaceLayoutService | undefined = services?.get(LAYOUT_SERVICE)

const existingActions = inject(PANEL_ACTIONS_KEY, null)
if (existingActions === null && services !== null) {
  const actions = createPagePanelActions(services, props.pageId)
  if (actions !== null) {
    provide(PANEL_ACTIONS_KEY, actions)
  }
}

const dockPage = inject(DOCK_PAGE_KEY, null)
if (dockPage === null) {
  provide(DOCK_PAGE_KEY, () => props.pageId)
}

const preview = ref<LayoutPreviewSizes>({})
provide(LAYOUT_PREVIEW_KEY, preview)

function clearPreview(): void {
  preview.value = {}
}

function onPreview(event: Event): void {
  const detail = (event as CustomEvent<DockResizePreviewDetail>).detail
  if (
    detail === undefined ||
    typeof detail.splitId !== 'string' ||
    !Array.isArray(detail.sizes)
  ) {
    return
  }
  preview.value = { ...preview.value, [detail.splitId]: detail.sizes }
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  if (layout !== undefined) {
    unsubscribe = layout.subscribe(() => {
      clearPreview()
    })
  }
  window.addEventListener(DOCK_RESIZE_PREVIEW_EVENT, onPreview)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
  window.removeEventListener(DOCK_RESIZE_PREVIEW_EVENT, onPreview)
})
</script>

<template>
  <div
    class="layout-renderer"
    :data-dock-kind="'workspace'"
    @pointerup="clearPreview"
    @pointercancel="clearPreview"
    @keydown.esc="clearPreview"
  >
    <LayoutNodeView :node="tree.root" :page-id="pageId" />
  </div>
</template>

<style scoped>
.layout-renderer {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
