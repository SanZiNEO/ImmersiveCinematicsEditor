<script setup lang="ts">
/**
 * 「触发后」只读卡（11-02 §6）：当前格式触发器只播放本脚本给触发者本人。
 * 不出现动作选择器 / 目标选择器 / `play_script` 字段——这些不属于触发器声明。
 */
import { TRIGGER_ACTION_CARD_TEXT } from '../../../features/behavior/trigger.ts'
</script>

<template>
  <section class="action-card" aria-label="触发后">
    <h3 class="section-title">触发后</h3>
    <p class="action-card__text">{{ TRIGGER_ACTION_CARD_TEXT }}</p>
  </section>
</template>

<style scoped>
.action-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
}

.section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text, #eee);
}

.action-card__text {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #999);
}
</style>
