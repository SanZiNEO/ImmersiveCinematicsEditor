<script setup lang="ts">
/**
 * 面板底部诊断条（06-10）：两个面板共用一份，`scope` 决定它显示哪一侧的 issue。
 *
 * 数据来源只有公开端口：`DOCUMENT_SERVICE.validate()`（本地 + 服务端 issue）与
 * `summary()`（计数、服务端是否过期）。**不** import `DocStore`。
 *
 * 服务端超时 / 断连时追加一条 `server_incomplete` 的 info 诊断，绝不把超时当通过。
 * 定位只改可见性、展开、滚动、播放头与选择，不写文档。
 *
 * 为什么放在 `features/effects/panels/`：它同时消费 `PanelContext` 与效果领域纯函数，
 * 两份实现只差 `scope` 与文案——参数化比搬到中立区再造一套数据形状更诚实。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DocIssue } from '../../../core/doc/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { clipTimingOf, findClipContext, propertyRowsFor } from '../clipContext.ts'
import {
  buildDiagnosticIndex,
  diagnosticsForPanel,
  severityLabel,
  summarizeDiagnostics,
  withServerIncomplete,
} from '../diagnostics.ts'
import type { EffectDiagnostic } from '../types.ts'

const props = withDefaults(defineProps<{
  /** 本诊断条属于哪个面板：只显示该面板该管的 issue。 */
  scope: 'properties' | 'effects'
  /** 当前片段；缺省表示"全部片段"（只在展开后显示）。 */
  clipKey?: string
  /** 合并窗口（毫秒）；与文档修订号一起决定何时重取。 */
  debounceMs?: number
}>(), { debounceMs: 400 })

const ctx = usePanelContext()
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

const expanded = ref(false)
const issues = ref<readonly DocIssue[]>([])
const stale = ref(false)
const loading = ref(false)
const fetchError = ref('')
const revisionTick = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined
let unsubscribers: Array<() => void> = []

const summary = computed(() => {
  void revisionTick.value
  return documentService?.summary() ?? null
})

const clipContext = computed(() => {
  void revisionTick.value
  const clipKey = props.clipKey
  if (clipKey === undefined || documentService === undefined) {
    return null
  }
  return findClipContext(documentService.view(), clipKey)
})

const rows = computed(() => {
  void revisionTick.value
  const found = clipContext.value
  const clipKey = props.clipKey
  if (found === null || clipKey === undefined || documentService === undefined || catalog === undefined) {
    return []
  }
  const objects = documentService.clipObjects(clipKey)
  if (objects === null) {
    return []
  }
  return propertyRowsFor({ clipKey, trackType: found.trackType, objects, catalog })
})

const timing = computed(() => (clipContext.value === null ? undefined : clipTimingOf(clipContext.value.clip)))

const index = computed(() =>
  buildDiagnosticIndex(issues.value, rows.value, 'leaf', {
    ...(props.clipKey === undefined ? {} : { clipKey: props.clipKey }),
    ...(timing.value === undefined ? {} : { timing: timing.value }),
  }))

const visible = computed(() =>
  withServerIncomplete(
    diagnosticsForPanel(index.value, props.scope, props.clipKey),
    stale.value,
    '服务端校验未完成（断连或超时）',
  ))

const stats = computed(() => summarizeDiagnostics(visible.value))

const collapsedLabel = computed(() => {
  if (stats.value.total === 0) {
    return '无问题'
  }
  const severity = stats.value.severity
  return `${severity === null ? '问题' : severityLabel(severity)} · ${stats.value.total}`
})

/** 拉取一次校验结果：只经公开端口，不读 store。 */
async function refresh(): Promise<void> {
  if (documentService === undefined || loading.value) {
    return
  }
  const current = summary.value
  if (current === null) {
    return
  }
  if (current.docId === null) {
    issues.value = []
    stale.value = false
    return
  }
  loading.value = true
  try {
    const outcome = await documentService.validate()
    issues.value = outcome.issues
    stale.value = outcome.stale
    fetchError.value = ''
  } catch (error) {
    fetchError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

function schedule(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    const current = summary.value
    if (current === null || current.docId === null) {
      issues.value = []
      stale.value = false
      return
    }
    // 没有 issue 且服务端结果不过期时不必再发请求；展开时始终刷新。
    if (!expanded.value && current.issueCount === 0 && !current.stale) {
      issues.value = []
      stale.value = false
      return
    }
    void refresh()
  }, props.debounceMs)
}

watch(
  () => `${revisionTick.value}|${props.clipKey ?? ''}|${props.scope}`,
  schedule,
  { immediate: true },
)

watch(expanded, (open) => {
  if (open) {
    void refresh()
  }
})

if (documentService !== undefined) {
  unsubscribers.push(documentService.subscribe(() => {
    revisionTick.value += 1
  }))
}

onBeforeUnmount(() => {
  clearTimeout(timer)
  timer = undefined
  for (const dispose of unsubscribers) {
    dispose()
  }
  unsubscribers = []
})

function reveal(diagnostic: EffectDiagnostic): void {
  if (diagnostic.panel === 'effects' && diagnostic.path !== undefined) {
    ctx.requestRevealInEffectControls({
      clipKey: diagnostic.clipKey,
      objectPath: diagnostic.path,
      ...(diagnostic.time === undefined ? {} : { time: diagnostic.time }),
    })
    ctx.requestFocus('clip.effects')
    return
  }
  if (diagnostic.path !== undefined) {
    ctx.requestSelect({ domain: 'object', clipKey: diagnostic.clipKey, objectPath: diagnostic.path })
    ctx.requestFocus('selection.properties')
  }
}
</script>

<template>
  <section class="diag-bar" :data-scope="scope" aria-label="片段诊断">
    <button type="button" class="diag-bar__summary" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="diag-bar__chevron" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
      <span class="diag-bar__title">诊断</span>
      <span
        class="diag-bar__badge"
        :class="stats.severity === null ? 'diag-bar__badge--ok' : `diag-bar__badge--${stats.severity}`"
      >{{ collapsedLabel }}</span>
      <span v-if="loading" class="diag-bar__hint">校验中…</span>
    </button>

    <p v-if="fetchError !== ''" class="diag-bar__error" role="alert">{{ fetchError }}</p>

    <ul v-if="expanded && visible.length > 0" class="diag-bar__list">
      <li
        v-for="item in visible"
        :key="item.id"
        class="diag-bar__item"
        :class="`diag-bar__item--${item.severity}`"
      >
        <span class="diag-bar__level">{{ severityLabel(item.severity) }}</span>
        <span class="diag-bar__message">{{ item.message }}</span>
        <code v-if="item.path !== undefined" class="diag-bar__path">{{ item.path }}</code>
        <button type="button" class="diag-bar__locate" @click="reveal(item)">定位</button>
      </li>
    </ul>

    <p v-else-if="expanded" class="diag-bar__empty">无问题</p>
  </section>
</template>

<style scoped>
.diag-bar {
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  font-size: 11px;
}

.diag-bar__summary {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.diag-bar__summary:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.diag-bar__summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.diag-bar__chevron {
  width: 10px;
  color: var(--text-muted);
}

.diag-bar__title {
  font-weight: 600;
}

.diag-bar__badge {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
}

.diag-bar__badge--ok {
  color: var(--success);
  border-color: var(--success);
}

.diag-bar__badge--block,
.diag-bar__badge--error {
  color: var(--error);
  border-color: var(--error);
}

.diag-bar__badge--warn {
  color: var(--warning);
  border-color: var(--warning);
}

.diag-bar__badge--info {
  color: var(--text-secondary);
}

.diag-bar__hint {
  color: var(--text-muted);
}

.diag-bar__error {
  margin: 0;
  padding: 2px 10px 6px;
  color: var(--error);
}

.diag-bar__list {
  max-height: 160px;
  margin: 0;
  padding: 0 0 6px;
  overflow: auto;
  list-style: none;
}

.diag-bar__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 10px;
}

.diag-bar__level {
  flex: 0 0 auto;
  padding: 0 4px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 10px;
}

.diag-bar__item--block .diag-bar__level,
.diag-bar__item--error .diag-bar__level {
  color: var(--error);
}

.diag-bar__item--warn .diag-bar__level {
  color: var(--warning);
}

.diag-bar__item--info .diag-bar__level {
  color: var(--text-secondary);
}

.diag-bar__message {
  min-width: 0;
  flex: 1 1 auto;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.diag-bar__path {
  flex: 0 1 auto;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  overflow-wrap: anywhere;
}

.diag-bar__locate {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 10px;
  cursor: pointer;
}

.diag-bar__locate:hover {
  background: var(--bg-hover);
}

.diag-bar__locate:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.diag-bar__empty {
  margin: 0;
  padding: 2px 10px 6px;
  color: var(--text-muted);
}
</style>
