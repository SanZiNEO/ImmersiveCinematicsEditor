<script setup lang="ts">
/**
 * 文档页（04-04）：文档顶栏 + 布局树。
 *
 * 页面不持有尺寸、不读文档字段；布局完全由 `DockSurface` → `LayoutRenderer` → `getTree` 驱动。
 */
import DocumentHeader from './DocumentHeader.vue'
import DockSurface from '../dock/DockSurface.vue'
import { useCurrentPageId } from './useWorkbench.ts'

const pageId = useCurrentPageId()
</script>

<template>
  <section class="document-page">
    <DocumentHeader />
    <DockSurface :page-id="pageId" />
  </section>
</template>

<style scoped>
.document-page { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
</style>
