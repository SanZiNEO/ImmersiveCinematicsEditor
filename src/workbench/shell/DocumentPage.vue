<script setup lang="ts">
/**
 * 文档页（04-04）：直接渲染布局树。
 *
 * 文档身份、保存状态与操作统一放在应用顶栏 / 菜单 / 状态栏，避免再占一整行。
 */
import DockSurface from '../dock/DockSurface.vue'
import { useCurrentPageId } from './useWorkbench.ts'

const pageId = useCurrentPageId()
</script>

<template>
  <section class="document-page">
    <DockSurface :page-id="pageId" />
  </section>
</template>

<style scoped>
.document-page { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
</style>
