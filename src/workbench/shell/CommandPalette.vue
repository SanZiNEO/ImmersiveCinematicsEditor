<script setup lang="ts">
/**
 * 命令面板（04-10）：`Mod+Shift+P` 打开，列出 enabled 命令。
 *
 * - 输入框自动聚焦；↑/↓ 选择，Enter 执行，Esc 关闭；
 * - 只列已注册且 enabled 的命令；按分类分组；无结果显式空态；
 * - 打开时登记到 `DialogStack`（背景命令降级），关闭后焦点回到原区域。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import type { MenuState } from '../api/commands.ts'
import { filterCommands, groupByCategory } from '../commands/CommandPaletteModel.ts'
import { COMMAND_SERVICE } from '../api/tokens.ts'
import type { CommandRegistryPort } from '../api/commands.ts'
import { useDialogs, useI18n, useServices } from './useWorkbench.ts'

const props = defineProps<{ pageId: string }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const services = useServices()
const i18n = useI18n()
const dialogs = useDialogs()

const query = ref('')
const cursor = ref(0)
const input = ref<HTMLInputElement | null>(null)

function registry(): CommandRegistryPort {
  return services.require(COMMAND_SERVICE)
}

const all = computed<MenuState[]>(() => registry().menuItems({ pageId: props.pageId, services }))

const paletteEntries = computed<MenuState[]>(() => {
  const enabled = all.value.filter((item) => item.enabled)
  const filtered = filterCommands(enabled, query.value)
  return filtered
})

const groups = computed(() => groupByCategory(paletteEntries.value))

const flat = computed(() => paletteEntries.value)

function move(delta: number): void {
  if (flat.value.length === 0) {
    return
  }
  cursor.value = (cursor.value + delta + flat.value.length) % flat.value.length
}

async function execute(commandId: string): Promise<void> {
  await registry().execute({ pageId: props.pageId, services }, commandId)
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const target = flat.value[cursor.value]
    if (target !== undefined) {
      void execute(target.commandId)
    }
  }
}

onMounted(() => {
  dialogs.open('command-palette')
  void nextTick(() => input.value?.focus())
})

onBeforeUnmount(() => {
  dialogs.close('command-palette')
})
</script>

<template>
  <div class="palette-backdrop" @pointerdown.self="emit('close')">
    <div class="palette" role="dialog" aria-modal="true" :aria-label="i18n.t('cmd.app.commandPalette')" @keydown="onKeydown">
      <input
        ref="input"
        v-model="query"
        class="palette-input"
        type="text"
        :placeholder="i18n.t('palette.placeholder')"
        :aria-label="i18n.t('palette.placeholder')"
        @input="cursor = 0"
      />
      <div v-if="flat.length === 0" class="palette-empty" role="status">{{ i18n.t('palette.empty') }}</div>
      <div v-else class="palette-list" role="listbox">
        <div v-for="group in groups" :key="group.category" class="palette-group">
          <div class="palette-category">{{ group.category }}</div>
          <button
            v-for="item in group.items"
            :key="item.commandId"
            type="button"
            class="palette-item"
            role="option"
            :aria-selected="flat.indexOf(item) === cursor"
            :class="{ active: flat.indexOf(item) === cursor }"
            @click="execute(item.commandId)"
            @pointermove="cursor = flat.indexOf(item)"
          >
            <span class="palette-label">{{ i18n.t(item.label) }}</span>
            <span v-if="item.accelerator" class="palette-accel">{{ item.accelerator }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay, rgba(0, 0, 0, 0.45));
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 60;
}
.palette {
  width: min(560px, 90vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--shadow, 0 12px 32px var(--overlay, rgba(0, 0, 0, 0.4)));
  overflow: hidden;
}
.palette-input {
  background: var(--bg-panel);
  border: 0;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  padding: 10px 12px;
  outline: none;
}
.palette-input:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.palette-list { overflow: auto; padding: 4px; }
.palette-category { color: var(--text-muted); font-size: 11px; padding: 6px 8px 2px; }
.palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.palette-item.active { background: var(--bg-selected); }
.palette-item:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.palette-label { flex: 1; }
.palette-accel { color: var(--text-muted); font-size: 11px; }
.palette-empty { color: var(--text-muted); font-size: 12px; padding: 16px; text-align: center; }
</style>
