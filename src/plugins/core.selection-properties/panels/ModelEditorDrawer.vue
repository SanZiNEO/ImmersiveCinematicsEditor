<script setup lang="ts">
/**
 * 数学模型右侧滑出侧面板（07-09 §四）。
 *
 * - props：`{ clipKey, path, model, domain, open }`
 * - emit：`close` / `save: [model]` / `reset: [model]`
 *
 * 本组件**不 commit**：应用 / 重置都由外壳走 `object.setValue` 命令；
 * 草稿按「片段 + 字段路径」留在内存会话表，关闭不丢、未提交不落盘。
 */
import { computed, shallowRef, watch } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import CurveEditor from '../../../features/paths/CurveEditor.vue'
import {
  MODEL_MAX_DEPTH,
  MODEL_MAX_NODES,
} from '../../../core/schema/catalog/models.ts'
import {
  channelLabel,
  channelValidation,
  countDepth,
  countNodes,
  discardDraft,
  domainBadge,
  readDraft,
  resetModelValue,
  sampleModelResponse,
  writeDraft,
} from '../../../features/paths/modelEditor.ts'

const props = defineProps<{
  clipKey: string
  path: string
  model: JsonValue | undefined
  domain: string
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [model: JsonValue | undefined]
  reset: [model: JsonValue | undefined]
}>()

const draftJson = shallowRef<JsonValue | undefined>(props.model)

/** 外部值（含外壳提交后的刷新）同步；已有未提交草稿时优先恢复草稿。 */
watch(
  () => [props.model, props.open] as const,
  ([nextModel]) => {
    const cached = readDraft(props.clipKey, props.path)
    draftJson.value = cached.has ? cached.model : nextModel
  },
  { deep: true, immediate: true },
)

const label = computed(() => channelLabel(props.path))
const badge = computed(() => domainBadge(props.domain))
const validation = computed(() => channelValidation(draftJson.value, props.path))
const issues = computed(() => validation.value.issues)
const errors = computed(() => validation.value.errors)
const nodeCount = computed(() => countNodes(draftJson.value))
const depthCount = computed(() => countDepth(draftJson.value))
const canApply = computed(() => validation.value.valid && !validation.value.overLimit)

const samples = computed(() => sampleModelResponse(draftJson.value, props.domain, 33))
const previewPoints = computed(() => {
  if (samples.value === null) {
    return ''
  }
  return samples.value
    .map((sample) => {
      const x = (sample.t * 220).toFixed(2)
      const value = Math.min(1, Math.max(0, sample.values[0] ?? 0))
      const y = (60 - value * 56).toFixed(2)
      return `${x},${y}`
    })
    .join(' ')
})

function onEditorChange(next: JsonValue | undefined): void {
  draftJson.value = next
  writeDraft(props.clipKey, props.path, next)
}

function apply(): void {
  if (!canApply.value) {
    return
  }
  discardDraft(props.clipKey, props.path)
  emit('save', draftJson.value)
}

function cancel(): void {
  discardDraft(props.clipKey, props.path)
  emit('close')
}

function reset(): void {
  const linear = resetModelValue()
  draftJson.value = linear
  discardDraft(props.clipKey, props.path)
  emit('reset', linear)
}
</script>

<template>
  <aside class="model-drawer" :class="{ 'model-drawer--open': open }" aria-label="模型编辑器">
    <header class="model-drawer__header">
      <div class="model-drawer__title">
        <span class="model-drawer__channel">{{ label }}</span>
        <span class="model-drawer__badge" :data-domain="badge.key">{{ badge.label }}</span>
      </div>
      <div class="model-drawer__meta">
        <span class="model-drawer__counter" :class="{ 'is-over': depthCount > MODEL_MAX_DEPTH }">
          深度 {{ depthCount }}/{{ MODEL_MAX_DEPTH }}
        </span>
        <span class="model-drawer__counter" :class="{ 'is-over': nodeCount > MODEL_MAX_NODES }">
          节点 {{ nodeCount }}/{{ MODEL_MAX_NODES }}
        </span>
        <button type="button" class="model-drawer__close" @click="cancel" aria-label="关闭">×</button>
      </div>
    </header>

    <section class="model-drawer__body">
      <CurveEditor :value="draftJson" @change="onEditorChange" />

      <div v-if="samples !== null" class="model-drawer__preview">
        <svg viewBox="0 0 220 64" preserveAspectRatio="none" aria-label="响应曲线示意">
          <line x1="0" y1="60" x2="220" y2="60" class="model-drawer__axis" />
          <polyline :points="previewPoints" class="model-drawer__curve" fill="none" />
        </svg>
      </div>
      <div v-else class="model-drawer__preview model-drawer__preview--disabled">
        模型超限，暂不画响应曲线
      </div>

      <div v-if="issues.length > 0" class="model-drawer__issues">
        <p
          v-for="issue in issues"
          :key="`${issue.field}-${issue.message}`"
          class="model-drawer__issue"
          :class="`model-drawer__issue--${issue.severity}`"
        >
          <span class="model-drawer__issue-field">{{ issue.field }}</span>
          {{ issue.message }}
        </p>
      </div>
    </section>

    <footer class="model-drawer__footer">
      <button type="button" class="model-drawer__btn" @click="cancel">取消</button>
      <button type="button" class="model-drawer__btn" @click="reset">重置为 linear</button>
      <button
        type="button"
        class="model-drawer__btn model-drawer__btn--primary"
        :disabled="!canApply"
        :title="errors.length > 0 ? errors[0].message : validation.overLimit ? '模型超限' : ''"
        @click="apply"
      >
        应用
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.model-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 300px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  transform: translateX(100%);
  transition: transform 0.18s ease;
  overflow: hidden;
}

.model-drawer--open {
  transform: translateX(0);
}

.model-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.model-drawer__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-drawer__channel {
  font-weight: 500;
  white-space: nowrap;
}

.model-drawer__badge {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 11px;
}

.model-drawer__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-drawer__counter {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.model-drawer__counter.is-over {
  color: var(--error);
}

.model-drawer__close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.model-drawer__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  overflow: auto;
}

.model-drawer__preview {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
  padding: 4px;
}

.model-drawer__preview--disabled {
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
  padding: 10px;
}

.model-drawer__axis {
  stroke: var(--border);
}

.model-drawer__curve {
  stroke: var(--accent, var(--text));
  stroke-width: 1.5;
}

.model-drawer__issues {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-drawer__issue {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
}

.model-drawer__issue-field {
  margin-right: 4px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.model-drawer__issue--error {
  color: var(--error);
}

.model-drawer__issue--warn {
  color: var(--warning);
}

.model-drawer__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}

.model-drawer__btn {
  padding: 3px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.model-drawer__btn--primary {
  border-color: var(--accent, var(--border-strong));
  background: var(--accent, transparent);
  color: var(--bg-panel);
}

.model-drawer__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
