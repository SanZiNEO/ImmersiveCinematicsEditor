<script setup lang="ts">
/**
 * `demo.drawer.log`（04-06）。
 *
 * 「触发错误」按钮同步抛 `Error`，用于验证抽屉 tab 的错误隔离：
 * 只有本 tab 进入错误态，其他 tab / 面板 / 外壳不受影响。
 * 这是故意的错误路径：错误交给宿主错误边界，不吞进控制台、不伪装成普通日志。
 */
import { ref } from 'vue'

const errorText = ref('尚未触发错误。')

function triggerError(): void {
  errorText.value = '正在抛出错误…'
  throw new Error('demo.drawer.log：故意抛错（验证抽屉 tab 错误隔离）')
}
</script>

<template>
  <section class="demo-log" aria-label="Demo 日志抽屉">
    <header class="demo-log__header">
      <span class="demo-badge">demo</span>
      <h2 class="demo-log__title">日志 · 错误隔离</h2>
    </header>
    <p class="demo-log__hint">
      点击下面的按钮会同步抛出一个 Error。宿主应只把本 tab 显示为错误态，其他 tab 继续可用。
    </p>
    <div class="demo-log__actions">
      <button type="button" class="demo-log__button" @click="triggerError">触发错误</button>
    </div>
    <p class="demo-log__state" role="status" aria-live="polite">{{ errorText }}</p>
  </section>
</template>

<style scoped>
.demo-log {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 8px 12px;
  overflow: auto;
  color: var(--text);
  font-size: 12px;
}

.demo-log__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.demo-badge {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-log__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.demo-log__hint {
  margin: 0;
  color: var(--text-secondary);
}

.demo-log__actions {
  display: flex;
  gap: 6px;
}

.demo-log__button {
  padding: 4px 12px;
  border: 1px solid var(--error);
  border-radius: 4px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 12px;
  cursor: pointer;
}

.demo-log__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.demo-log__state {
  margin: 0;
  color: var(--text-muted);
}
</style>
