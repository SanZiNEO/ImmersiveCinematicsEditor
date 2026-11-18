<script setup lang="ts">
/**
 * 覆盖层字段面横幅（09-01）：非法层类型 / 死字段 / LETTERBOX 多余键。
 *
 * 只显示，不提供静默删除；清理由层类型切换或作者显式操作完成。
 */
import { computed } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import { overlayBanners } from '../../../features/overlay/validation.ts'
import { findLetterboxExtraPaths } from '../../../features/overlay/letterbox.ts'

const props = defineProps<{
  trackType: 'OVERLAY' | 'LETTERBOX'
  objects: JsonObject
}>()

const emit = defineEmits<{
  'clean-dead': [paths: string[]]
}>()

const banners = computed(() => {
  if (props.trackType === 'LETTERBOX') {
    const extras = findLetterboxExtraPaths(props.objects)
    if (extras.length === 0) {
      return []
    }
    return [{
      level: 'warning' as const,
      text: `LETTERBOX 只读 aspect_ratio / opacity；这些键不参与运行：${extras.join('、')}（保留为未知扩展键）`,
      paths: extras,
    }]
  }
  return overlayBanners(props.objects)
})

const levelClass = (level: string): string => `overlay-banner--${level}`
</script>

<template>
  <div v-if="banners.length > 0" class="overlay-banners">
    <p
      v-for="banner in banners"
      :key="banner.text"
      class="overlay-banner"
      :class="levelClass(banner.level)"
      role="status"
    >
      {{ banner.text }}
      <button
        v-if="trackType === 'OVERLAY' && banner.paths.length > 0"
        type="button"
        class="overlay-banner__clean"
        title="删除这些当前层类型不读取的已知字段（未知键不在其中）"
        @click="emit('clean-dead', banner.paths)"
      >
        清理死字段
      </button>
    </p>
  </div>
</template>

<style scoped>
.overlay-banners {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 4px;
}

.overlay-banner {
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.overlay-banner--warning {
  border-color: var(--warning);
  color: var(--text);
}

.overlay-banner--error {
  border-color: var(--error);
  color: var(--error);
}

.overlay-banner__clean {
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.overlay-banner__clean:hover {
  background: var(--bg-hover);
}
</style>
