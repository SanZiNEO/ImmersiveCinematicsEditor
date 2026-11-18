<script setup lang="ts">
/**
 * 效果面板片段头（06-01 §三）：回答"这是哪个片段"。
 *
 * 纯展示：不读服务、不写文档；所有数据由外壳按当前 revision 现算后传入。
 * 校验徽标可点击，外壳负责把它接到诊断条。
 */
defineProps<{
  info: {
    clipKey: string
    label: string
    clipId: string | null
    trackType: string
    start: string
    duration: string
    loop: boolean
    loopCount: number | null
    references: number
    warn: boolean
    animatedCount: number
    frameCount: number
  }
}>()

const emit = defineEmits<{ 'reveal-diagnostic': [] }>()
</script>

<template>
  <header class="fx-head">
    <div class="fx-head__row">
      <h2 class="fx-head__title" :title="info.label">{{ info.label }}</h2>
      <span class="fx-head__track">{{ info.trackType }}</span>
      <button
        v-if="info.warn"
        type="button"
        class="fx-head__badge fx-head__badge--warn"
        title="该片段有校验问题；点击查看诊断"
        @click="emit('reveal-diagnostic')"
      >校验</button>
      <span v-else class="fx-head__badge fx-head__badge--ok">通过</span>
    </div>

    <dl class="fx-head__facts">
      <dt>身份</dt>
      <dd class="fx-mono" :title="info.clipKey">{{ info.clipKey }}<template v-if="info.clipId !== null"> · {{ info.clipId }}</template></dd>
      <dt>时间</dt>
      <dd>
        {{ info.start }} · {{ info.duration }}<template v-if="info.loop"> · 循环<template v-if="info.loopCount !== null"> ×{{ info.loopCount }}</template></template>
      </dd>
      <dt>动画</dt>
      <dd>{{ info.animatedCount }} 个属性 · {{ info.frameCount }} 帧</dd>
      <dt v-if="info.references > 0">引用</dt>
      <dd v-if="info.references > 0">{{ info.references }} 处</dd>
    </dl>
  </header>
</template>

<style scoped>
.fx-head {
  flex: 0 0 auto;
  padding: 6px 10px 4px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.fx-head__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.fx-head__title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fx-head__track {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 10px;
}

.fx-head__badge {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: transparent;
  font-size: 10px;
}

.fx-head__badge--ok {
  color: var(--success);
}

.fx-head__badge--warn {
  color: var(--warning);
  cursor: pointer;
}

.fx-head__badge--warn:hover {
  background: var(--bg-hover);
}

.fx-head__badge--warn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.fx-head__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0 8px;
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.fx-head__facts dt {
  color: var(--text-muted);
}

.fx-head__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.fx-mono {
  font-family: var(--font-mono, monospace);
}
</style>
