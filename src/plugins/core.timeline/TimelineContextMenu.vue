<script setup lang="ts">
/**
 * 统一右键菜单（05-10）：片段 / 轨道头 / 空白轨道 / 标尺共用。
 *
 * 支持键盘（方向键 / Home / End / Enter / Esc / Tab）、禁用原因文本、二次确认行；
 * 确认也在菜单内完成，不使用浏览器模态框。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TimelineMenuItem } from './model.ts'

const props = defineProps<{
  x: number
  y: number
  items: readonly TimelineMenuItem[]
}>()

const emit = defineEmits<{
  choose: [id: string]
  close: []
}>()

const rootEl = ref<HTMLElement | null>(null)
const position = ref({ left: '0px', top: '0px' })
const confirming = ref<string | null>(null)

const confirmingItem = computed(() =>
  confirming.value === null ? undefined : props.items.find((item) => item.id === confirming.value),
)

function menuButtons(): HTMLElement[] {
  const root = rootEl.value
  if (root === null) {
    return []
  }
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
}

function focusFirst(): void {
  const buttons = menuButtons()
  buttons[0]?.focus()
}

function moveFocus(direction: 1 | -1 | 'first' | 'last'): void {
  const buttons = menuButtons()
  if (buttons.length === 0) {
    return
  }
  const index = buttons.indexOf(document.activeElement as HTMLElement)
  let next: number
  if (direction === 'first') {
    next = 0
  } else if (direction === 'last') {
    next = buttons.length - 1
  } else if (index < 0) {
    next = direction === 1 ? 0 : buttons.length - 1
  } else {
    next = (index + direction + buttons.length) % buttons.length
  }
  buttons[next]?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveFocus(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveFocus(-1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    moveFocus('first')
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    moveFocus('last')
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    moveFocus(event.shiftKey ? -1 : 1)
  }
}

function onItemClick(item: TimelineMenuItem): void {
  if (item.disabled === true) {
    return
  }
  if (item.confirmLabel !== undefined) {
    confirming.value = item.id
    return
  }
  emit('choose', item.id)
}

function confirmRemove(): void {
  const item = confirmingItem.value
  if (item === undefined) {
    return
  }
  emit('choose', item.id)
}

function cancelConfirm(): void {
  confirming.value = null
  void nextTick(() => focusFirst())
}

function onWindowPointerDown(event: PointerEvent): void {
  const root = rootEl.value
  if (root === null || event.target instanceof Node && root.contains(event.target)) {
    return
  }
  emit('close')
}

function onWindowScroll(): void {
  emit('close')
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  const root = rootEl.value
  if (root === null) {
    return
  }
  const rect = root.getBoundingClientRect()
  const margin = 8
  const left = Math.max(margin, Math.min(props.x, window.innerWidth - rect.width - margin))
  const top = Math.max(margin, Math.min(props.y, window.innerHeight - rect.height - margin))
  position.value = { left: `${left}px`, top: `${top}px` }
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('scroll', onWindowScroll, true)
  window.addEventListener('keydown', onWindowKeydown, true)
  void nextTick(() => focusFirst())
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('scroll', onWindowScroll, true)
  window.removeEventListener('keydown', onWindowKeydown, true)
})
</script>

<template>
  <div
    ref="rootEl"
    class="timeline-menu"
    :style="position"
    role="menu"
    tabindex="-1"
    aria-label="时间轴菜单"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <div v-if="confirmingItem !== undefined" class="timeline-menu__confirm" role="alertdialog" :aria-label="confirmingItem.confirmLabel ?? '确认操作'">
      <p class="timeline-menu__confirm-text">{{ confirmingItem.confirmLabel }}</p>
      <div class="timeline-menu__confirm-actions">
        <button type="button" class="timeline-menu__confirm-danger" @click="confirmRemove">确认删除</button>
        <button type="button" class="timeline-menu__confirm-cancel" @click="cancelConfirm">取消</button>
      </div>
    </div>
    <template v-else>
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" class="timeline-menu__separator" role="separator"></div>
        <button
          type="button"
          class="timeline-menu__item"
          :class="{
            'timeline-menu__item--disabled': item.disabled === true,
            'timeline-menu__item--danger': item.danger === true,
          }"
          role="menuitem"
          :disabled="item.disabled === true"
          :aria-checked="item.checked === undefined ? undefined : item.checked"
          @click="onItemClick(item)"
        >
          <span class="timeline-menu__check" aria-hidden="true">{{ item.checked === true ? '✓' : '' }}</span>
          <span class="timeline-menu__label">{{ item.label }}</span>
          <span v-if="item.shortcut !== undefined" class="timeline-menu__shortcut">{{ item.shortcut }}</span>
          <span v-if="item.disabled === true && item.reason !== undefined" class="timeline-menu__reason">{{ item.reason }}</span>
        </button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.timeline-menu {
  position: fixed;
  z-index: 60;
  min-width: 210px;
  max-width: 320px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-raised);
  color: var(--text);
  box-shadow: 0 8px 24px var(--shadow);
  font-size: 12px;
}

.timeline-menu:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

.timeline-menu__item {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.timeline-menu__item:hover:not(:disabled) {
  background: var(--bg-selected);
}

.timeline-menu__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.timeline-menu__item--danger {
  color: var(--error);
}

.timeline-menu__item--disabled {
  color: var(--text-muted);
  cursor: default;
}

.timeline-menu__check {
  color: var(--accent);
  font-size: 11px;
}

.timeline-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-menu__shortcut {
  color: var(--text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.timeline-menu__reason {
  grid-column: 2 / 4;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.3;
  white-space: normal;
}

.timeline-menu__separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}

.timeline-menu__confirm {
  padding: 6px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  background: var(--bg-panel);
}

.timeline-menu__confirm-text {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 12px;
}

.timeline-menu__confirm-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.timeline-menu__confirm-danger,
.timeline-menu__confirm-cancel {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.timeline-menu__confirm-danger {
  border: 1px solid var(--error);
  background: var(--error-bg);
  color: var(--error);
}

.timeline-menu__confirm-cancel {
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  color: var(--text);
}

.timeline-menu__confirm-danger:focus-visible,
.timeline-menu__confirm-cancel:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
