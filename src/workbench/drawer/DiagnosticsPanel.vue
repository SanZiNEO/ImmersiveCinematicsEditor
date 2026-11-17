<script setup lang="ts">
/**
 * 工作台诊断面板（04-06 唯一真实抽屉内容）。
 *
 * 数据只来自注入的 `DiagnosticSink`；按来源筛选、复制单条/全部、清除已处理。
 * 字段原位错误仍由校验层负责，这里不是第二套校验入口。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import type { Diagnostic, DiagnosticSeverity, DiagnosticSink, DiagnosticSource } from '../api/diagnostics.ts'
import type { I18nApi, Locale } from '../api/context.ts'
import { DIAGNOSTICS_SERVICE, I18N_SERVICE } from '../api/tokens.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'

const services = inject(WORKBENCH_SERVICES_KEY, null)
const sink: DiagnosticSink | undefined = services?.get(DIAGNOSTICS_SERVICE)
const i18n: I18nApi | undefined = services?.get(I18N_SERVICE)

const items = ref<readonly Diagnostic[]>(sink?.list() ?? [])
const filter = ref<'all' | DiagnosticSource>('all')
const handled = ref<ReadonlySet<string>>(new Set())
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

const unsubscribe = sink?.subscribe((next) => {
  items.value = [...next]
}) ?? null

onBeforeUnmount(() => {
  unsubscribe?.()
})

const sources = computed<DiagnosticSource[]>(() => {
  const seen = new Set<DiagnosticSource>()
  for (const item of items.value) {
    seen.add(item.source)
  }
  return [...seen].sort((left, right) => left.localeCompare(right))
})

const filtered = computed(() => {
  if (filter.value === 'all') {
    return items.value
  }
  return items.value.filter((item) => item.source === filter.value)
})

const severityOrder: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

const sortedFiltered = computed(() =>
  [...filtered.value].sort((left, right) => {
    const bySeverity = severityOrder[left.severity] - severityOrder[right.severity]
    return bySeverity !== 0 ? bySeverity : right.timestamp.localeCompare(left.timestamp)
  }),
)


function label(key: string, fallback: string): string {
  const translated = i18n?.t(key)
  return translated === undefined || translated === key ? fallback : translated
}

function severityLabel(severity: DiagnosticSeverity): string {
  return label(`diagnostics.severity.${severity}`, severity === 'error' ? '错误' : severity === 'warning' ? '警告' : '信息')
}

function sourceLabel(source: DiagnosticSource): string {
  return label(`diagnostics.source.${source}`, source)
}

function localeOf(): Locale {
  return i18n?.locale() ?? 'zh_cn'
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }
  return date.toLocaleString(localeOf() === 'en_us' ? 'en-US' : 'zh-CN')
}

function toggleHandled(id: string, checked: boolean): void {
  const next = new Set(handled.value)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  handled.value = next
}

function clearHandled(): void {
  if (sink === undefined || handled.value.size === 0) {
    return
  }
  sink.clearHandled([...handled.value])
  handled.value = new Set()
  copyState.value = 'idle'
}

function textOf(item: Diagnostic): string {
  return [
    `[${item.severity}] ${item.source}${item.pluginId === undefined ? '' : ` (${item.pluginId})`}`,
    item.message,
    item.detail ?? '',
    item.timestamp,
  ]
    .filter((part) => part.length > 0)
    .join('\n')
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}

function copyOne(item: Diagnostic): void {
  void copy(textOf(item))
}

function copyAll(): void {
  if (sortedFiltered.value.length === 0) {
    return
  }
  void copy(sortedFiltered.value.map(textOf).join('\n\n'))
}
</script>

<template>
  <div class="diagnostics">
    <div v-if="sink === undefined" class="diagnostics__empty" role="alert">
      <p>诊断服务未就绪：缺少 DIAGNOSTICS_SERVICE。</p>
    </div>

    <template v-else>
      <header class="diagnostics__toolbar">
        <div class="diagnostics__filters" role="group" aria-label="按来源筛选诊断">
          <button
            type="button"
            class="diagnostics__filter"
            :class="{ 'diagnostics__filter--active': filter === 'all' }"
            :aria-pressed="filter === 'all'"
            @click="filter = 'all'"
          >
            全部（{{ items.length }}）
          </button>
          <button
            v-for="source in sources"
            :key="source"
            type="button"
            class="diagnostics__filter"
            :class="{ 'diagnostics__filter--active': filter === source }"
            :aria-pressed="filter === source"
            @click="filter = source"
          >
            {{ sourceLabel(source) }}（{{ items.filter((item) => item.source === source).length }}）
          </button>
        </div>
        <div class="diagnostics__actions">
          <button
            type="button"
            class="diagnostics__button"
            :disabled="sortedFiltered.length === 0"
            @click="copyAll"
          >
            复制全部
          </button>
          <button
            type="button"
            class="diagnostics__button"
            :disabled="handled.size === 0"
            @click="clearHandled"
          >
            清空已处理（{{ handled.size }}）
          </button>
        </div>
      </header>

      <p v-if="copyState === 'copied'" class="diagnostics__status" role="status">已复制</p>
      <p v-else-if="copyState === 'failed'" class="diagnostics__status" role="status">
        复制失败：剪贴板不可用
      </p>

      <div v-if="sortedFiltered.length === 0" class="diagnostics__empty" role="status">
        <p>暂无诊断记录。</p>
      </div>

      <ul v-else class="diagnostics__list">
        <li
          v-for="item in sortedFiltered"
          :key="item.id"
          class="diagnostics__item"
          :class="`diagnostics__item--${item.severity}`"
        >
          <div class="diagnostics__item-head">
            <input
              :id="`diagnostic-handled-${item.id}`"
              type="checkbox"
              class="diagnostics__check"
              :checked="handled.has(item.id)"
              @change="toggleHandled(item.id, ($event.target as HTMLInputElement).checked)"
            />
            <label :for="`diagnostic-handled-${item.id}`" class="diagnostics__check-label">已处理</label>
            <span class="diagnostics__severity">{{ severityLabel(item.severity) }}</span>
            <span class="diagnostics__source">{{ sourceLabel(item.source) }}</span>
            <span v-if="item.pluginId !== undefined" class="diagnostics__plugin">{{ item.pluginId }}</span>
            <time class="diagnostics__time" :datetime="item.timestamp">{{ formatTime(item.timestamp) }}</time>
            <button type="button" class="diagnostics__button" @click="copyOne(item)">复制</button>
          </div>
          <p class="diagnostics__message">{{ item.message }}</p>
          <pre v-if="item.detail !== undefined && item.detail.length > 0" class="diagnostics__detail">{{ item.detail }}</pre>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.diagnostics {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
}

.diagnostics__toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}

.diagnostics__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.diagnostics__filter {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.diagnostics__filter:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.diagnostics__filter--active {
  border-color: var(--accent);
  background: var(--bg-selected);
  color: var(--text);
}

.diagnostics__filter:focus-visible,
.diagnostics__button:focus-visible,
.diagnostics__check:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.diagnostics__actions {
  display: flex;
  gap: 6px;
}

.diagnostics__button {
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.diagnostics__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.diagnostics__button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.diagnostics__status {
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
}

.diagnostics__empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  color: var(--text-muted);
  font-size: 12px;
}

.diagnostics__list {
  flex: 1 1 auto;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.diagnostics__item {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
}

.diagnostics__item--error {
  border-left-color: var(--error);
}

.diagnostics__item--warning {
  border-left-color: var(--warning);
}

.diagnostics__item--info {
  border-left-color: var(--success);
}

.diagnostics__item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.diagnostics__check {
  margin: 0;
}

.diagnostics__check-label {
  color: var(--text-secondary);
  cursor: pointer;
}

.diagnostics__severity {
  font-weight: 600;
}

.diagnostics__item--error .diagnostics__severity {
  color: var(--error);
}

.diagnostics__item--warning .diagnostics__severity {
  color: var(--warning);
}

.diagnostics__item--info .diagnostics__severity {
  color: var(--success);
}

.diagnostics__source {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-secondary);
}

.diagnostics__plugin {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text-muted);
}

.diagnostics__time {
  color: var(--text-muted);
}

.diagnostics__message {
  margin: 6px 0 0;
  font-size: 12px;
}

.diagnostics__detail {
  max-height: 120px;
  margin: 4px 0 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
