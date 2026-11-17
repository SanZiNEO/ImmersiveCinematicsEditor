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
import DrawerGroup from '../drawer/DrawerGroup.vue'
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
  return node?.type === 'group' && !node.visible
}

/**
 * 折叠成标签条的 group（04-06 抽屉）：占固定 26px，不按比例。
 *
 * 抽屉默认 `visible=false + collapsed=true`：`visible` 为 false 表示内容区关着，
 * 但折叠条必须仍然渲染，否则用户没有重新打开的入口。
 * 只有抽屉 group 这样处理；普通面板 group 的 `visible=false` 仍然是完全隐藏。
 */
function isCollapsedBar(node: LayoutNode | undefined): boolean {
  return node?.type === 'group' && node.id === DRAWER_GROUP_ID && node.collapsed
}

const COLLAPSED_BAR_SIZE = '26px'

function paneStyle(index: number): Record<string, string | number> {
  const node = props.node
  if (node.type !== 'split') {
    return {}
  }
  const child = node.children[index]
  if (isCollapsedBar(child)) {
    return { flexGrow: 0, flexBasis: COLLAPSED_BAR_SIZE, flexShrink: 0 }
  }
  const ratio = isHiddenPane(child) ? 0 : (ratios.value[index] ?? 0)
  return { flexGrow: ratio, flexBasis: '0px', flexShrink: 0 }
}
</script>

<template>
  <div
    v-if="node.type === 'split'"
    class="layout-split"
    :class="`layout-split--${node.orientation}`"
  >
    <template v-for="(child, index) in node.children" :key="child.id">
      <div class="layout-split__pane" :style="paneStyle(index)">
        <LayoutNodeView :node="child" :page-id="pageId" />
      </div>
      <ResizeHandle
        v-if="index < node.children.length - 1 && !isHiddenPane(child) && !isHiddenPane(node.children[index + 1])"
        :split-id="node.id"
        :index="index"
        :orientation="node.orientation"
      />
    </template>
  </div>
  <DrawerGroup v-else-if="node.id === DRAWER_GROUP_ID" :group-id="node.id" :page-id="pageId" />
  <GroupRenderer v-else :group="node" :page-id="pageId" />
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
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
