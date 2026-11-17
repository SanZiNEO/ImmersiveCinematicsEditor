<script setup lang="ts">
/**
 * 面板错误展示（04-05）。
 *
 * 只负责展示错误摘要、重试、复制诊断；不吞异常、不伪装成功。
 * `retryable=false` 用于“服务未就绪”这类点了也没用的错误。
 */
withDefaults(
  defineProps<{
    message: string
    detail?: string
    retryLabel?: string
    retryable?: boolean
  }>(),
  {
    detail: '',
    retryLabel: '重试',
    retryable: true,
  },
)

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="host-error" role="alert">
    <p class="host-error__message">{{ message }}</p>
    <pre v-if="detail.length > 0" class="host-error__detail">{{ detail }}</pre>
    <div class="host-error__actions">
      <button
        v-if="retryable"
        type="button"
        class="host-error__button"
        @click="emit('retry')"
      >
        {{ retryLabel }}
      </button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.host-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-left: 2px solid var(--error);
  background: var(--error-bg);
  color: var(--text);
}

.host-error__message {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.host-error__detail {
  max-height: 160px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

.host-error__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.host-error__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.host-error__button:hover {
  background: var(--bg-hover);
}

.host-error__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
