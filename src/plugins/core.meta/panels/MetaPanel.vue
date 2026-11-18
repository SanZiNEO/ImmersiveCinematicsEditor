<script setup lang="ts">
/**
 * 脚本 meta 面板（对应剪辑软件的「草稿参数」）。
 *
 * 选择域为 `none`（点时间轴空白 / 清空选择）时显示。字段全部来自 02 目录的 `meta` 段，
 * 不手写第二份字段表；写入走 `meta.set` 命令。
 *
 * 触发器不在这里：它有自己的面板（`core.behavior`），本面板只处理脚本级标量字段。
 */
import { computed, ref } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import MetaFieldRow from './MetaFieldRow.vue'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

const message = ref('')
const messageKind = ref<'info' | 'error'>('info')

/** meta 段字段（目录顺序，不排序、不裁剪）。 */
const fields = computed<FieldEntry[]>(() => {
  if (catalog === undefined) {
    return []
  }
  return catalog.search({ segment: 'meta' })
})

/** 当前文档的 meta 值（完整字段的只读快照）。 */
const values = computed<Record<string, JsonValue>>(() => {
  void revision.value
  const raw = documentService?.metaObject() ?? null
  if (raw === null) {
    return {}
  }
  const result: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[key] = value
  }
  return result
})

const summary = computed(() => {
  void revision.value
  return documentService?.summary() ?? null
})

/** 按 section 分组（meta 目录里 section 是 `basic` / `runtime` / `hud` / …）。 */
const groups = computed(() => {
  const byKey = new Map<string, FieldEntry[]>()
  for (const field of fields.value) {
    const key = field.section ?? ''
    const list = byKey.get(key)
    if (list === undefined) {
      byKey.set(key, [field])
      continue
    }
    list.push(field)
  }
  return [...byKey.entries()].map(([key, entries]) => ({ key, label: groupLabel(key), entries }))
})

const GROUP_LABELS: Readonly<Record<string, string>> = {
  basic: '基础',
  runtime: '运行时行为',
  hud: 'HUD 隐藏组',
  camera: '相机刷怪',
  playback: '播放控制',
  trigger: '触发器缺省',
}

function groupLabel(key: string): string {
  if (key === '') {
    return '未分组'
  }
  return GROUP_LABELS[key] ?? key
}

function onCommit(payload: { key: string; value: JsonValue }): void {
  const outcome = ctx.commands.commit({ kind: 'meta.set', key: payload.key, value: payload.value })
  if (outcome.ok) {
    message.value = `已更新 ${payload.key}。`
    messageKind.value = 'info'
    return
  }
  message.value = outcome.error ?? '更新失败。'
  messageKind.value = 'error'
}


</script>

<template>
  <section class="meta-panel" aria-label="脚本属性">
    <header class="meta-panel__header">
      <h2 class="meta-panel__title">脚本属性</h2>
      <span v-if="summary?.docId !== null && summary !== null" class="meta-panel__id">{{ summary.docId }}</span>
    </header>

    <p v-if="documentService === undefined" class="meta-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>

    <p v-else-if="summary === null || summary.docId === null" class="meta-panel__empty">
      没有打开的文档。从脚本页打开一个脚本后，这里显示脚本级字段。
    </p>

    <p v-else-if="fields.length === 0" class="meta-panel__empty">
      字段目录不可用：无法列出脚本级字段。
    </p>

    <div v-else class="meta-panel__scroll">
      <section v-for="group in groups" :key="group.key" class="meta-group">
        <h3 class="meta-group__title">{{ group.label }}</h3>
        <div class="meta-group__rows">
          <MetaFieldRow
            v-for="field in group.entries"
            :key="field.key"
            :field="field"
            :value="values[field.key]"
            @commit="onCommit"
          />
        </div>
      </section>
    </div>

    <p v-if="message !== ''" class="meta-panel__message" :data-kind="messageKind" role="status" aria-live="polite">
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.meta-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.meta-panel__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px 4px;
  border-bottom: 1px solid var(--border);
}

.meta-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.meta-panel__id {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.meta-panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.meta-group {
  border-bottom: 1px solid var(--border);
}

.meta-group__title {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 3px 10px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.meta-group__rows {
  display: flex;
  flex-direction: column;
}

.meta-panel__empty,
.meta-panel__notice {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.meta-panel__notice {
  border-color: var(--error);
  background: var(--bg-raised);
}

.meta-panel__message {
  flex: 0 0 auto;
  margin: 0;
  padding: 3px 10px;
  color: var(--text-secondary);
  font-size: 11px;
}

.meta-panel__message[data-kind='error'] {
  color: var(--error);
}
</style>
