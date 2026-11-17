<script setup lang="ts">
/**
 * 面板加载骨架（04-05）。
 *
 * 只显示灰条，不显示 0 / 默认值 / 上一个文档的数据；读屏只播报“正在加载”。
 */
withDefaults(
  defineProps<{
    lines?: number
    label?: string
  }>(),
  {
    lines: 6,
    label: '正在加载面板',
  },
)
</script>

<template>
  <div class="host-skeleton" role="status" aria-live="polite" :aria-label="label">
    <span
      v-for="index in Math.max(1, Math.min(12, lines))"
      :key="index"
      class="host-skeleton__bar"
      :style="{ width: `${100 - ((index - 1) % 3) * 12}%` }"
    />
  </div>
</template>

<style scoped>
.host-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-panel);
}

.host-skeleton__bar {
  height: 10px;
  border-radius: 4px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  animation: host-skeleton-pulse 1.2s ease-in-out infinite;
}

.host-skeleton__bar:nth-child(2n) {
  animation-delay: 0.15s;
}

.host-skeleton__bar:nth-child(3n) {
  animation-delay: 0.3s;
}

@keyframes host-skeleton-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .host-skeleton__bar {
    animation: none;
  }
}
</style>
