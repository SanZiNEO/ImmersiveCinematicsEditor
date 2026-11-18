<script setup lang="ts">
/**
 * 属性面板里的一个 motion 模型通道行（07-09 §三）。
 *
 * 只显示：类型 + 关键参数摘要、值域徽标、回落 / 未知警告、节点数与「编辑模型」入口。
 * 本行**没有时钟、没有添加首帧**；不自己 commit，编辑请求透传给外壳。
 *
 * 摘要 / 徽标 / 警告全部来自 `features/paths/modelEditor.ts` 纯函数。
 */
import { computed } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import {
  channelLabel,
  channelSummary,
  channelValidation,
  countDepth,
  countNodes,
  domainBadge,
} from '../../../features/paths/modelEditor.ts'

const props = defineProps<{
  clipKey: string
  path: string
  model: JsonValue | undefined
  domain: string
}>()

const emit = defineEmits<{
  'open-editor': [payload: { clipKey: string; path: string }]
}>()

const label = computed(() => channelLabel(props.path))
const summary = computed(() => channelSummary(props.model))
const badge = computed(() => domainBadge(props.domain))
const nodes = computed(() => countNodes(props.model))
const depth = computed(() => countDepth(props.model))
const validation = computed(() => channelValidation(props.model, props.path))
const issues = computed(() => validation.value.issues)

function openEditor(): void {
  emit('open-editor', { clipKey: props.clipKey, path: props.path })
}
</script>

<template>
  <div class="motion-row" :data-path="path">
    <div class="motion-row__head">
      <span class="motion-row__label" :title="path">{{ label }}</span>
      <span class="motion-row__path">{{ path }}</span>
      <span class="motion-row__badge" :data-domain="badge.key">{{ badge.label }}</span>
      <span class="motion-row__count">{{ nodes }} 节点 · 深度 {{ depth }}</span>
    </div>

    <div class="motion-row__body">
      <span class="motion-row__summary">{{ summary }}</span>
      <button type="button" class="motion-row__button" @click="openEditor">编辑模型</button>
    </div>

    <div v-if="issues.length > 0" class="motion-row__issues">
      <p
        v-for="issue in issues"
        :key="`${issue.field}-${issue.message}`"
        class="motion-row__issue"
        :class="`motion-row__issue--${issue.severity}`"
      >
        {{ issue.message }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.motion-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 3px 10px 5px;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  color: var(--text);
  font-size: 12px;
}

.motion-row__head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.motion-row__label {
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
}

.motion-row__path {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.motion-row__badge {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.motion-row__count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.motion-row__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.motion-row__summary {
  flex: 1 1 auto;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.motion-row__button {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.motion-row__button:hover {
  background: var(--bg-hover);
}

.motion-row__issues {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.motion-row__issue {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
}

.motion-row__issue--error {
  color: var(--error);
}

.motion-row__issue--warn {
  color: var(--warning);
}
</style>
