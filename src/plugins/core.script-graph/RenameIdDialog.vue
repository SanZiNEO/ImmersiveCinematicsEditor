<script setup lang="ts">
/**
 * 改脚本 `meta.id`（05-06）。
 *
 * 先预览影响面，再应用；应用失败保留对话框并说明是否回滚成功。
 * 只改 id 与指向它的引用，不移动文件、不改其他字段。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { META_ID_PATTERN } from '../../core/doc/keys.ts'
import type { GraphNode } from '../../core/graph/types.ts'
import type { RefsPreviewResult } from '../../workbench/api/graph.ts'
import { mutationErrorText } from './labels.ts'
import { useGraphController } from './state.ts'

type RefsPreviewSuccess = Extract<RefsPreviewResult, { ok: true }>

const props = defineProps<{ node: GraphNode }>()
const emit = defineEmits<{
  close: []
  saved: []
}>()

const controller = useGraphController()
const inputEl = ref<HTMLInputElement | null>(null)
const newId = ref('')
const preview = ref<RefsPreviewSuccess | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const fromId = computed(() => props.node.scriptId ?? '')
const trimmed = computed(() => newId.value.trim())
const validId = computed(() =>
  fromId.value !== '' && META_ID_PATTERN.test(trimmed.value) && trimmed.value !== fromId.value)
const canApply = computed(() => preview.value !== null && validId.value && !busy.value)

watch(newId, () => {
  preview.value = null
  error.value = null
})

async function runPreview(): Promise<void> {
  if (!validId.value || busy.value) {
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await controller.previewRefs(fromId.value, trimmed.value)
    if (!result.ok) {
      preview.value = null
      error.value = mutationErrorText(result.code, result.message)
      return
    }
    preview.value = result
  } finally {
    busy.value = false
  }
}

async function apply(): Promise<void> {
  const current = preview.value
  if (current === null || !canApply.value) {
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await controller.applyRefs(fromId.value, trimmed.value, current.files.length)
    if (!result.ok) {
      preview.value = null
      const parts = [mutationErrorText(result.code, result.message)]
      if (!result.rolledBack) {
        parts.push('回滚未完成，请检查各脚本文件当前内容')
      }
      if (result.failedPaths !== undefined && result.failedPaths.length > 0) {
        parts.push(`失败文件：${result.failedPaths.join('、')}`)
      }
      error.value = parts.join('；')
      return
    }
    emit('saved')
  } finally {
    busy.value = false
  }
}

function close(): void {
  if (!busy.value) {
    emit('close')
  }
}

function onEscape(): void {
  if (!busy.value) {
    emit('close')
  }
}

onMounted(() => {
  void nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div class="dialog-backdrop" @pointerdown.self="close">
    <section
      class="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
      @keydown.esc.stop.prevent="onEscape"
    >
      <header class="dialog-head">
        <div>
          <h2 id="rename-dialog-title" class="dialog-title">改脚本 id</h2>
          <p class="dialog-subtitle">{{ node.name }} · {{ node.path }}</p>
        </div>
        <button type="button" class="icon-button" aria-label="关闭" :disabled="busy" @click="close">✕</button>
      </header>

      <p v-if="fromId === ''" class="dialog-warn">
        当前脚本没有 meta.id：没有可改写的 id。先在编辑器页设置脚本 id。
      </p>

      <template v-else>
        <div class="id-row">
          <label class="field">
            <span class="field__label">当前 id</span>
            <input class="field__input" type="text" :value="fromId" readonly>
          </label>
          <span class="id-arrow" aria-hidden="true">→</span>
          <label class="field field--grow">
            <span class="field__label">新 id（1–32 位字母/数字/下划线）</span>
            <input
              ref="inputEl"
              v-model="newId"
              class="field__input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :disabled="busy"
              placeholder="new_id"
            >
          </label>
        </div>
        <p v-if="trimmed !== '' && !META_ID_PATTERN.test(trimmed)" class="dialog-warn">
          id 只能包含字母、数字、下划线，长度 1–32。
        </p>
        <p v-else-if="trimmed !== '' && trimmed === fromId" class="dialog-warn">
          新 id 与当前 id 相同，无需修改。
        </p>

        <p class="dialog-hint">
          应用会改写所有指向旧 id 的前置引用，逐文件原子写（版本历史交给 git）；先预览再应用。
        </p>

        <section v-if="preview !== null" class="preview-block">
          <h3 class="block-title">
            影响面：{{ preview.files.length }} 个文件 · 共 {{ preview.totalReferences }} 处引用
          </h3>
          <p v-if="preview.warnings.length > 0" class="preview-warning">
            {{ preview.warnings.join('；') }}
          </p>
          <ul v-if="preview.files.length > 0" class="file-list">
            <li v-for="file in preview.files" :key="file.path" class="file-row">
              <span class="file-row__path">{{ file.path }}</span>
              <span class="file-row__count">{{ file.references }} 处</span>
            </li>
          </ul>
          <p v-else class="block-empty">没有其他文件引用该 id（只改脚本自身的 meta.id）。</p>
        </section>

        <p v-if="error !== null" class="dialog-error" role="alert">{{ error }}</p>
      </template>

      <footer class="dialog-foot">
        <button type="button" class="dialog-button" :disabled="busy" @click="close">取消</button>
        <button
          type="button"
          class="dialog-button"
          :disabled="!validId || busy"
          @click="runPreview"
        >{{ busy ? '处理中…' : preview === null ? '预览影响' : '重新预览' }}</button>
        <button
          v-if="fromId !== ''"
          type="button"
          class="dialog-button dialog-button--primary"
          :disabled="!canApply"
          @click="apply"
        >应用</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
}
.rename-dialog {
  width: 560px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 12px 36px var(--shadow);
  overflow: auto;
}
.dialog-head { display: flex; align-items: flex-start; gap: 8px; }
.dialog-title { margin: 0; font-size: 15px; }
.dialog-subtitle { margin: 2px 0 0; color: var(--text-secondary); font-size: 11px; overflow-wrap: anywhere; }
.icon-button {
  margin-left: auto;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
}
.icon-button:focus-visible, .dialog-button:focus-visible, .field__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.id-row { display: flex; align-items: flex-end; gap: 8px; }
.id-arrow { padding-bottom: 6px; color: var(--text-muted); }
.field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.field--grow { flex: 1 1 auto; }
.field__label { color: var(--text-muted); font-size: 11px; }
.field__input {
  padding: 5px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
  min-width: 0;
}
.dialog-hint { margin: 0; color: var(--text-secondary); font-size: 11px; }
.dialog-warn { margin: 0; color: var(--warning); font-size: 11.5px; }
.block-title { margin: 0 0 4px; font-size: 12px; color: var(--text-secondary); }
.block-empty { margin: 0; color: var(--text-muted); font-size: 11px; }
.preview-block { padding-top: 6px; border-top: 1px solid var(--border); }
.preview-warning { margin: 0 0 4px; color: var(--warning); font-size: 11px; }
.file-list { margin: 0; padding: 0; list-style: none; max-height: 168px; overflow: auto; border: 1px solid var(--border); border-radius: 4px; }
.file-row { display: flex; gap: 8px; padding: 4px 8px; border-bottom: 1px solid var(--border); font-size: 11px; }
.file-row:last-child { border-bottom: 0; }
.file-row__path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-row__count { color: var(--text-secondary); }
.dialog-error { margin: 0; padding: 6px 8px; border: 1px solid var(--error); border-radius: 4px; background: var(--error-bg); color: var(--error); font-size: 11.5px; }
.dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.dialog-button {
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.dialog-button:hover { background: var(--bg-hover); }
.dialog-button--primary { border-color: var(--accent); color: var(--accent); }
.dialog-button:disabled { opacity: 0.5; cursor: default; }
</style>
