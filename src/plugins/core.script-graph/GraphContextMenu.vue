<script setup lang="ts">
/**
 * 节点右键菜单（05-02 / 05-03）。
 *
 * 菜单项只发命令/打开对话框，不直接改图数据；`Shift+F10` 与鼠标右键共用。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GraphNode } from '../../core/graph/types.ts'
import { useGraphController } from './state.ts'

const props = defineProps<{ node: GraphNode; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

const controller = useGraphController()
const rootEl = ref<HTMLElement | null>(null)

const hasScriptId = computed(() =>
  props.node.scriptId !== null && props.node.scriptId !== undefined && props.node.scriptId !== '')

const left = computed(() => Math.max(8, Math.min(props.x, window.innerWidth - 250)))
const top = computed(() =>
  Math.max(8, Math.min(props.y, window.innerHeight - (hasScriptId.value ? 300 : 270))))

function close(): void {
  emit('close')
}

function openScript(): void {
  close()
  void controller.openScript(props.node.path)
}

function editDependencies(): void {
  close()
  controller.openDependencyEditor(props.node.path)
}

function renameId(): void {
  close()
  controller.openRenameDialog(props.node.path)
}

function copyPath(): void {
  close()
  void controller.copyPath(props.node.path)
}

function focusUpstream(): void {
  close()
  controller.select(props.node.path)
  controller.focusUpstream()
}

function focusDownstream(): void {
  close()
  controller.select(props.node.path)
  controller.focusDownstream()
}

function undo(): void {
  close()
  void controller.undoSelected()
}

function items(): HTMLButtonElement[] {
  const root = rootEl.value
  if (root === null) {
    return []
  }
  return [...root.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')]
}

function focusItem(index: number): void {
  const list = items()
  if (list.length === 0) {
    return
  }
  const wrapped = ((index % list.length) + list.length) % list.length
  list[wrapped]?.focus()
}

function currentIndex(): number {
  return items().findIndex((item) => item === document.activeElement)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      close()
      return
    case 'ArrowDown':
      event.preventDefault()
      focusItem(currentIndex() + 1)
      return
    case 'ArrowUp':
      event.preventDefault()
      focusItem(currentIndex() - 1)
      return
    case 'Home':
      event.preventDefault()
      focusItem(0)
      return
    case 'End':
      event.preventDefault()
      focusItem(items().length - 1)
      return
    case 'Tab':
      close()
      return
    default:
      return
  }
}

function onOutsidePointer(event: PointerEvent): void {
  if (rootEl.value !== null && event.target instanceof Node && rootEl.value.contains(event.target)) {
    return
  }
  close()
}

onMounted(() => {
  window.addEventListener('pointerdown', onOutsidePointer, true)
  void nextTick(() => focusItem(0))
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onOutsidePointer, true)
})
</script>

<template>
  <div
    ref="rootEl"
    class="graph-menu"
    role="menu"
    :aria-label="`脚本 ${node.name} 的操作`"
    :style="{ left: `${left}px`, top: `${top}px` }"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <button type="button" role="menuitem" class="graph-menu__item" @click="openScript">打开脚本</button>
    <button type="button" role="menuitem" class="graph-menu__item" @click="editDependencies">维护前置…</button>
    <button
      type="button"
      role="menuitem"
      class="graph-menu__item"
      :disabled="!hasScriptId"
      :title="hasScriptId ? '先预览影响面再改写所有引用' : '当前脚本没有 meta.id'"
      @click="renameId"
    >改脚本 id…</button>
    <button type="button" role="menuitem" class="graph-menu__item" @click="copyPath">复制路径</button>
    <div class="graph-menu__separator" role="separator" />
    <button type="button" role="menuitem" class="graph-menu__item" @click="focusUpstream">聚焦上游前置</button>
    <button type="button" role="menuitem" class="graph-menu__item" @click="focusDownstream">聚焦下游依赖方</button>
    <div class="graph-menu__separator" role="separator" />
    <button
      type="button"
      role="menuitem"
      class="graph-menu__item"
      :disabled="!controller.canUndoSelected.value"
      title="撤销当前选中脚本的最后一条图操作"
      @click="undo"
    >撤销上一条图操作</button>
  </div>
</template>

<style scoped>
.graph-menu {
  position: fixed;
  z-index: 70;
  min-width: 220px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 8px 24px var(--shadow);
  display: flex;
  flex-direction: column;
}
.graph-menu__item {
  padding: 5px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.graph-menu__item:hover:not(:disabled) { background: var(--bg-hover); }
.graph-menu__item:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.graph-menu__item:disabled { color: var(--text-muted); cursor: default; }
.graph-menu__separator { height: 1px; margin: 4px 6px; background: var(--border); }
</style>
