<script setup lang="ts">
/**
 * 工作台通用模态壳：原生 dialog 负责顶层绘制、背景惰性与焦点边界。
 *
 * Esc 的逐层退出与全局命令屏蔽仍由 DialogStack 统一登记；每个业务弹窗只负责内容和
 * 未保存状态下的 close 请求，不重复实现遮罩、焦点陷阱和键盘穿透。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDialogs } from './useWorkbench.ts'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  dialogId?: string
  width?: string
  dismissible?: boolean
}>(), {
  subtitle: '',
  dialogId: 'workbench-dialog',
  width: '920px',
  dismissible: true,
})

const emit = defineEmits<{ close: [] }>()
const dialogs = useDialogs()
const dialogEl = ref<HTMLDialogElement | null>(null)
const opened = ref(false)

function requestClose(): void {
  if (props.dismissible) emit('close')
}

function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  requestClose()
}

onMounted(async () => {
  dialogs.open(props.dialogId)
  await nextTick()
  const element = dialogEl.value
  if (element === null) return
  if (!element.open) element.showModal()
  opened.value = true
  await nextTick()
  const initial = element.querySelector<HTMLElement>('[autofocus]')
    ?? element.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
    ?? element.querySelector<HTMLElement>('button:not(:disabled)')
    ?? element
  initial.focus()
})

onBeforeUnmount(() => {
  dialogs.close(props.dialogId)
  const element = dialogEl.value
  if (element?.open) element.close()
})
</script>

<template>
  <dialog
    ref="dialogEl"
    class="workbench-dialog"
    :style="{ '--workbench-dialog-width': width }"
    :aria-label="title"
    @cancel="onCancel"
    @keydown.esc="onKeydown"
    @click="(event) => { if (event.target === dialogEl) requestClose() }"
  >
    <section v-if="opened" class="workbench-dialog__surface">
      <header class="workbench-dialog__header">
        <div class="workbench-dialog__heading">
          <h2>{{ title }}</h2>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <slot name="actions" />
        <button
          v-if="dismissible"
          type="button"
          class="workbench-dialog__close"
          :aria-label="`关闭${title}`"
          @click="requestClose"
        >✕</button>
      </header>
      <div class="workbench-dialog__body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="workbench-dialog__footer">
        <slot name="footer" />
      </footer>
    </section>
  </dialog>
</template>

<style scoped>
.workbench-dialog {
  width: min(var(--workbench-dialog-width), 94vw);
  max-height: min(880px, 90vh);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-strong, #555);
  border-radius: 8px;
  background: var(--bg-panel, #191919);
  color: var(--text, #eee);
  box-shadow: 0 18px 52px rgba(0, 0, 0, 0.5);
}

.workbench-dialog::backdrop {
  background: rgba(0, 0, 0, 0.58);
}

.workbench-dialog__surface {
  display: flex;
  flex-direction: column;
  max-height: min(880px, 90vh);
}

.workbench-dialog__header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #333);
}

.workbench-dialog__heading {
  flex: 1;
  min-width: 0;
}

.workbench-dialog__heading h2 {
  margin: 0;
  font-size: 15px;
}

.workbench-dialog__heading p {
  margin: 3px 0 0;
  color: var(--text-muted, #999);
  font-size: 11px;
}

.workbench-dialog__close {
  width: 26px;
  height: 26px;
  border: 0;
  background: transparent;
  color: var(--text-secondary, #bbb);
  cursor: pointer;
}

.workbench-dialog__close:hover {
  background: var(--bg-hover, #2a2a2a);
  border-radius: 4px;
}

.workbench-dialog__body {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 18px;
}

.workbench-dialog__footer {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 18px;
  border-top: 1px solid var(--border, #333);
}

@media (max-width: 640px) {
  .workbench-dialog {
    width: 94vw;
  }
}
</style>
