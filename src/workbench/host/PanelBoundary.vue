<script setup lang="ts">
/**
 * 面板错误边界（04-05）。
 *
 * 捕获子组件渲染 / 生命周期错误，只影响当前面板；错误写入工作台诊断。
 * 连续两次错误后提供“禁用该面板”（由父层执行），不禁用整个插件。
 */
import { inject, onErrorCaptured, ref } from 'vue'
import { DIAGNOSTICS_SERVICE } from '../api/tokens.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import { WORKBENCH_SERVICES_KEY } from './panelContext.ts'

const props = defineProps<{
  pluginId: string
  panelId: string
  title: string
}>()

const emit = defineEmits<{ disable: [] }>()

const services = inject(WORKBENCH_SERVICES_KEY, null)
const diagnostics: DiagnosticSink | undefined = services?.get(DIAGNOSTICS_SERVICE)

const errorMessage = ref('')
const errorDetail = ref('')
const errorCount = ref(0)
const retryToken = ref(0)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

function report(error: unknown, info: string): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack !== undefined ? error.stack : ''
  diagnostics?.report({
    severity: 'error',
    source: 'panel',
    pluginId: props.pluginId,
    message: `面板运行错误：${props.title}`,
    detail: `${message}\n${info}${stack.length > 0 ? `\n${stack}` : ''}`,
  })
}

onErrorCaptured((error, _instance, info) => {
  const message = error instanceof Error ? error.message : String(error)
  errorMessage.value = message
  errorDetail.value = error instanceof Error && error.stack !== undefined ? error.stack : String(error)
  errorCount.value += 1
  copyState.value = 'idle'
  report(error, info)
  return false
})

function retry(): void {
  errorMessage.value = ''
  errorDetail.value = ''
  copyState.value = 'idle'
  retryToken.value += 1
}

function disable(): void {
  emit('disable')
}

async function copyDiagnostics(): Promise<void> {
  const text = [
    `面板: ${props.pluginId}:${props.panelId}`,
    `标题: ${props.title}`,
    `错误: ${errorMessage.value}`,
    errorDetail.value,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}
</script>

<template>
  <div class="panel-boundary">
    <div v-if="errorMessage.length > 0" class="panel-boundary__error" role="alert">
      <p class="panel-boundary__title">面板运行错误：{{ title }}</p>
      <p class="panel-boundary__message">{{ errorMessage }}</p>
      <pre v-if="errorDetail.length > 0" class="panel-boundary__detail">{{ errorDetail }}</pre>
      <div class="panel-boundary__actions">
        <button type="button" class="panel-boundary__button" @click="retry">重试</button>
        <button type="button" class="panel-boundary__button" @click="copyDiagnostics">
          复制诊断
        </button>
        <button
          v-if="errorCount >= 2"
          type="button"
          class="panel-boundary__button panel-boundary__button--danger"
          @click="disable"
        >
          禁用该面板
        </button>
      </div>
      <p v-if="copyState === 'copied'" class="panel-boundary__status" role="status">已复制</p>
      <p v-else-if="copyState === 'failed'" class="panel-boundary__status" role="status">
        复制失败：剪贴板不可用
      </p>
    </div>
    <div v-else :key="retryToken" class="panel-boundary__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.panel-boundary {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-boundary__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-boundary__error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow: auto;
  border-left: 2px solid var(--error);
  background: var(--error-bg);
}

.panel-boundary__title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.panel-boundary__message {
  margin: 0;
  font-size: 12px;
  color: var(--text);
}

.panel-boundary__detail {
  max-height: 160px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

.panel-boundary__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-boundary__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.panel-boundary__button:hover {
  background: var(--bg-hover);
}

.panel-boundary__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.panel-boundary__button--danger {
  border-color: var(--error);
  color: var(--error);
}

.panel-boundary__status {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
