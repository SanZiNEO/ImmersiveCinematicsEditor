<script setup lang="ts">
/**
 * 递归布局节点渲染（04-05）。
 *
 * split → flex 容器（按 `sizes` 比例）+ 每个边界一个 `ResizeHandle`；
 * group → `GroupRenderer`。不持尺寸、不写布局；拖动中的临时比例只读注入值。
 */
import { computed, inject } from 'vue'
import type { LayoutNode } from '../api/layout.ts'
import ResizeHandle from '../dock/ResizeHandle.vue'
import GroupRenderer from './GroupRenderer.vue'
import { DRAWER_GROUP_ID } from '../drawer/drawerController.ts'
import { LAYOUT_PREVIEW_KEY } from './layoutPreview.ts'
import { normalizedSizes } from './layoutGeometry.ts'

const props = defineProps<{
  node: LayoutNode
  pageId: string
}>()

const preview = inject(LAYOUT_PREVIEW_KEY, null)

const ratios = computed<number[]>(() => {
  const node = props.node
  if (node.type !== 'split') {
    return []
  }
  const sizes = preview?.value[node.id] ?? node.sizes
  return normalizedSizes(sizes, node.children.length)
})

function isHiddenPane(node: LayoutNode | undefined): boolean {
  return node?.type === 'group' && (node.id === DRAWER_GROUP_ID || !node.visible)
}

const visibleRatios = computed(() => {
  const node = props.node
  if (node.type !== 'split') return []
  const visible = ratios.value.map((ratio, index) => isHiddenPane(node.children[index]) ? 0 : ratio)
  const total = visible.reduce((sum, ratio) => sum + ratio, 0)
  return visible.map((ratio) => total > 0 ? ratio / total : 0)
})
</script>

<template>
  <div
    v-if="node.type === 'split'"
    class="layout-split"
    :class="`layout-split--${node.orientation}`"
  >
    <template v-for="(child, index) in node.children" :key="child.id">
      <div class="layout-split__pane" :style="{ flexGrow: visibleRatios[index], flexBasis: '0px' }">
        <LayoutNodeView v-if="child.id !== DRAWER_GROUP_ID" :node="child" :page-id="pageId" />
      </div>
      <ResizeHandle
        v-if="index < node.children.length - 1 && !isHiddenPane(child) && !isHiddenPane(node.children[index + 1])"
        :split-id="node.id"
        :index="index"
        :orientation="node.orientation"
      />
    </template>
  </div>
  <GroupRenderer v-else-if="node.type === 'group'" :group="node" :page-id="pageId" />
</template>

<style scoped>
.layout-split {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.layout-split--horizontal {
  flex-direction: row;
}

.layout-split--vertical {
  flex-direction: column;
}

.layout-split__pane {
  display: flex;
  flex: 0 0 0px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
