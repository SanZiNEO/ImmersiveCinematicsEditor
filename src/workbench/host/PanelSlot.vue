<script setup lang="ts">
/**
 * 面板槽位（04-05）：加载 / 错误 / 内容三态。
 *
 * 加载态只给骨架，错误态给摘要 + 重试，内容态交给默认插槽。
 */
import HostError from './HostError.vue'
import HostSkeleton from './HostSkeleton.vue'

type PanelSlotState = 'loading' | 'error' | 'ready'

withDefaults(
  defineProps<{
    state: PanelSlotState
    message?: string
    detail?: string
    loadingLabel?: string
    retryLabel?: string
  }>(),
  {
    message: '面板加载失败',
    detail: '',
    loadingLabel: '正在加载面板',
    retryLabel: '重试',
  },
)

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="state === 'loading'" class="panel-slot panel-slot--loading" role="status" aria-live="polite">
    <HostSkeleton :label="loadingLabel" />
  </div>
  <div v-else-if="state === 'error'" class="panel-slot panel-slot--error" role="alert">
    <HostError :message="message" :detail="detail" :retry-label="retryLabel" @retry="emit('retry')">
      <template #actions>
        <slot name="error-actions" />
      </template>
    </HostError>
  </div>
  <div v-else class="panel-slot panel-slot--ready">
    <slot />
  </div>
</template>

<style scoped>
.panel-slot {
  min-width: 0;
  min-height: 0;
}

.panel-slot--ready {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}
</style>
