<script setup lang="ts">
/**
 * 行为抽屉 · 事实页签（11-11）。
 *
 * 四块只读视图：概览计数 / 本脚本引用 / 事实字典 / 诊断。数据一律由
 * `factIndex(root, ctx)` 现算：不缓存文档副本，不求值运行时，不显示真假值，
 * 没有任何输入框，不新增事实类型。
 */
import { computed, ref } from 'vue'
import { isJsonObject } from '../../../../core/doc/json.ts'
import type { JsonObject, Severity } from '../../../../core/doc/types.ts'
import { usePanelContext } from '../../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE, GRAPH_SERVICE } from '../../../../workbench/api/tokens.ts'
import { usePanelRevision } from '../../usePanelRevision.ts'
import {
  factIndex,
  type FactDictionaryEntry,
  type FactGroupId,
  type FactIndexContext,
  type FactReference,
  type FactStatus,
  type ReferenceType,
} from '../../../../features/behavior/facts.ts'
import type { BehaviorProblem } from '../../../../features/behavior/shared.ts'
import { foldSeverity } from '../../../../features/behavior/validation.ts'

const props = defineProps<{
  docRevision: number
}>()

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const graphService = ctx.services.get(GRAPH_SERVICE)

const root = computed<JsonObject | null>(() => {
  void revision.value
  void props.docRevision
  return documentService?.root() ?? null
})

function collectClipIds(doc: JsonObject): Set<string> {
  const ids = new Set<string>()
  const timeline = doc.timeline
  if (isJsonObject(timeline)) {
    const tracks = timeline.tracks
    if (Array.isArray(tracks)) {
      for (const track of tracks) {
        if (!isJsonObject(track)) continue
        const clips = track.clips
        if (Array.isArray(clips)) {
          for (const clip of clips) {
            if (isJsonObject(clip) && typeof clip.id === 'string') {
              ids.add(clip.id)
            }
          }
        }
      }
    }
  }
  const standalone = doc.clips
  if (Array.isArray(standalone)) {
    for (const clip of standalone) {
      if (isJsonObject(clip) && typeof clip.id === 'string') {
        ids.add(clip.id)
      }
    }
  }
  return ids
}

function collectBindingIds(doc: JsonObject): Set<string> {
  const ids = new Set<string>()
  const bindings = doc.rule_bindings
  if (Array.isArray(bindings)) {
    for (const binding of bindings) {
      if (isJsonObject(binding) && typeof binding.id === 'string') {
        ids.add(binding.id)
      }
    }
  }
  return ids
}

const factContext = computed<FactIndexContext>(() => {
  const doc = root.value
  const scriptIds = new Set<string>()
  const graphData = graphService?.current()
  if (graphData !== undefined && graphData !== null) {
    for (const node of graphData.nodes) {
      if (typeof node.scriptId === 'string') {
        scriptIds.add(node.scriptId)
      }
    }
  }
  let selfScriptId: string | undefined
  if (doc !== null) {
    const meta = doc.meta
    if (isJsonObject(meta) && typeof meta.id === 'string') {
      selfScriptId = meta.id
      scriptIds.add(meta.id)
    }
  }
  return {
    scriptIds,
    clipIds: doc === null ? new Set<string>() : collectClipIds(doc),
    bindingIds: doc === null ? new Set<string>() : collectBindingIds(doc),
    selfScriptId,
  }
})

const factResult = computed(() => (root.value === null ? null : factIndex(root.value, factContext.value)))

// ── 引用过滤 ──────────────────────────────────────────────────────────

type ReferenceFilter = 'all' | FactStatus | 'unresolvable'

const filter = ref<ReferenceFilter>('all')

const FILTER_OPTIONS: Array<{ value: ReferenceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'resolved', label: '已解析' },
  { value: 'missing', label: '缺失' },
  { value: 'self_reference', label: '自引用' },
  { value: 'unknown_type', label: '未知类型' },
  { value: 'custom_readonly', label: '自定义只读' },
  { value: 'unresolved', label: '未判定' },
  { value: 'unresolvable', label: '不可解析' },
]

const filteredReferences = computed<FactReference[]>(() => {
  const references = factResult.value?.references ?? []
  if (filter.value === 'all') return references
  if (filter.value === 'unresolvable') {
    return references.filter((item) => item.status === 'missing' || item.status === 'unknown_type')
  }
  return references.filter((item) => item.status === filter.value)
})

// ── 字典分组折叠 ───────────────────────────────────────────────────────

const GROUP_ORDER: FactGroupId[] = ['prereq', 'clip_fact', 'rule_fact', 'derived', 'internal']

const GROUP_LABEL: Record<FactGroupId, string> = {
  prereq: '脚本前置',
  clip_fact: '片段事实',
  rule_fact: '规则事实',
  derived: '派生前置',
  internal: '引擎内部',
}

const collapsed = ref<Record<string, boolean>>({ internal: true })

function isCollapsed(group: FactGroupId): boolean {
  return collapsed.value[group] === true
}

function toggleGroup(group: FactGroupId): void {
  collapsed.value[group] = !isCollapsed(group)
}

function entriesOf(group: FactGroupId): FactDictionaryEntry[] {
  return (factResult.value?.dictionary ?? []).filter((entry) => entry.group === group)
}

// ── 标签 ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<FactStatus, string> = {
  resolved: '已解析',
  missing: '缺失',
  self_reference: '自引用',
  unknown_type: '未知类型',
  custom_readonly: '自定义只读',
  unresolved: '未判定',
}

const REFERENCE_TYPE_LABEL: Record<ReferenceType, string> = {
  requirement: '外层前置',
  combinator: '组合器子项',
  clip_fact: '片段事实',
  rule_fact: '规则事实',
  schedule_fact: '调度事实',
}

function referenceTypeLabel(type: ReferenceType): string {
  return REFERENCE_TYPE_LABEL[type]
}

function allowedInLabel(entry: FactDictionaryEntry): string {
  if (entry.allowedIn.length === 0) return '—'
  return entry.allowedIn.map((item) => REFERENCE_TYPE_LABEL[item]).join('、')
}

function severityLabel(severity: Severity): string {
  const folded = foldSeverity(severity)
  return folded === 'error' ? '错误' : folded === 'warn' ? '警告' : '信息'
}

const diagnostics = computed<Array<{ problem: BehaviorProblem; folded: 'error' | 'warn' | 'info' }>>(() =>
  (factResult.value?.diagnostics ?? []).map((problem) => ({ problem, folded: foldSeverity(problem.severity) })),
)

function targetOf(reference: FactReference): string {
  return reference.target.length > 0 ? reference.target : '—'
}
</script>

<template>
  <section class="facts-tab" aria-label="事实检查器">
    <p v-if="factResult === null" class="facts-tab__empty">未加载文档。</p>

    <template v-else>
      <!-- 概览 -->
      <section class="facts-tab__block" aria-label="概览">
        <header class="facts-tab__block-title">概览</header>
        <div class="facts-tab__overview">
          <div class="facts-tab__metric">
            <span class="facts-tab__metric-value">{{ factResult.overview.referencableCount }}</span>
            <span class="facts-tab__metric-label">可引用事实</span>
          </div>
          <div class="facts-tab__metric">
            <span class="facts-tab__metric-value">{{ factResult.overview.referencedCount }}</span>
            <span class="facts-tab__metric-label">已引用</span>
          </div>
          <div class="facts-tab__metric">
            <span class="facts-tab__metric-value">{{ factResult.overview.unusedCount }}</span>
            <span class="facts-tab__metric-label">未使用</span>
          </div>
          <button
            type="button"
            class="facts-tab__metric facts-tab__metric--button"
            :class="{ 'facts-tab__metric--active': filter === 'unresolvable' }"
            @click="filter = filter === 'unresolvable' ? 'all' : 'unresolvable'"
          >
            <span class="facts-tab__metric-value">{{ factResult.overview.unresolvableCount }}</span>
            <span class="facts-tab__metric-label">不可解析</span>
          </button>
        </div>
      </section>

      <!-- 本脚本引用 -->
      <section class="facts-tab__block" aria-label="本脚本引用">
        <header class="facts-tab__block-title">
          本脚本引用
          <span class="facts-tab__block-count">{{ filteredReferences.length }} 条</span>
        </header>
        <div class="facts-tab__filters">
          <button
            v-for="option in FILTER_OPTIONS"
            :key="option.value"
            type="button"
            class="facts-tab__filter"
            :class="{ 'facts-tab__filter--active': filter === option.value }"
            @click="filter = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <p v-if="filteredReferences.length === 0" class="facts-tab__empty">当前过滤条件下没有引用。</p>
        <ul v-else class="facts-tab__refs">
          <li v-for="reference in filteredReferences" :key="`${reference.name}:${reference.location}`" class="facts-tab__ref">
            <div class="facts-tab__ref-main">
              <code class="facts-tab__ref-name">{{ reference.name }}</code>
              <span class="facts-tab__ref-type">{{ referenceTypeLabel(reference.referenceType) }}</span>
              <span class="facts-tab__ref-status" :class="`facts-tab__ref-status--${reference.status}`">
                {{ STATUS_LABEL[reference.status] }}
              </span>
            </div>
            <div class="facts-tab__ref-meta">
              <span class="facts-tab__ref-location">{{ reference.locationLabel }} · {{ reference.location }}</span>
              <span class="facts-tab__ref-target">目标：{{ targetOf(reference) }}</span>
              <span class="facts-tab__ref-fact">事实：{{ reference.fact || '—' }}</span>
            </div>
          </li>
        </ul>
      </section>

      <!-- 事实字典 -->
      <section class="facts-tab__block" aria-label="事实字典">
        <header class="facts-tab__block-title">事实字典</header>
        <div v-for="group in GROUP_ORDER" :key="group" class="facts-tab__group">
          <button
            type="button"
            class="facts-tab__group-head"
            :aria-expanded="!isCollapsed(group)"
            @click="toggleGroup(group)"
          >
            <span class="facts-tab__group-caret">{{ isCollapsed(group) ? '▸' : '▾' }}</span>
            <span class="facts-tab__group-label">{{ GROUP_LABEL[group] }}</span>
            <span class="facts-tab__group-count">{{ entriesOf(group).length }}</span>
            <span v-if="group === 'internal'" class="facts-tab__group-note">不可选为条件</span>
          </button>
          <ul v-if="!isCollapsed(group)" class="facts-tab__entries">
            <li v-for="entry in entriesOf(group)" :key="entry.name" class="facts-tab__entry" :class="{ 'facts-tab__entry--internal': group === 'internal' }">
              <div class="facts-tab__entry-head">
                <code class="facts-tab__entry-name">{{ entry.name }}</code>
                <span class="facts-tab__entry-scope">{{ entry.scope }}</span>
              </div>
              <p class="facts-tab__entry-condition">{{ entry.condition }}</p>
              <div class="facts-tab__entry-meta">
                <span>可写入位置：{{ allowedInLabel(entry) }}</span>
                <span v-if="entry.durability">持久性：{{ entry.durability }}</span>
                <span v-if="!entry.referenceable" class="facts-tab__entry-badge">不可引用</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <!-- 诊断 -->
      <section class="facts-tab__block" aria-label="诊断">
        <header class="facts-tab__block-title">
          诊断
          <span class="facts-tab__block-count">{{ diagnostics.length }} 条</span>
        </header>
        <p v-if="diagnostics.length === 0" class="facts-tab__empty">没有事实相关诊断。</p>
        <ul v-else class="facts-tab__diagnostics">
          <li v-for="entry in diagnostics" :key="`${entry.problem.code}:${entry.problem.jsonPath}`" class="facts-tab__diagnostic" :class="`facts-tab__diagnostic--${entry.folded}`">
            <span class="facts-tab__diagnostic-sev">{{ severityLabel(entry.problem.severity) }}</span>
            <span class="facts-tab__diagnostic-code">{{ entry.problem.code }}</span>
            <span class="facts-tab__diagnostic-message">{{ entry.problem.message }}</span>
            <code class="facts-tab__diagnostic-path">{{ entry.problem.jsonPath }}</code>
            <span v-if="entry.problem.clipKey" class="facts-tab__diagnostic-clip">{{ entry.problem.clipKey }}</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.facts-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 8px 10px 12px;
  overflow: auto;
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
}

.facts-tab__empty {
  margin: 0;
  color: var(--text-muted);
}

.facts-tab__block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.facts-tab__block-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.facts-tab__block-count {
  color: var(--text-muted);
  font-weight: 400;
}

.facts-tab__overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(80px, 1fr));
  gap: 8px;
}

.facts-tab__metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

.facts-tab__metric--button {
  border-color: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font: inherit;
}

.facts-tab__metric--button:hover {
  background: var(--bg-hover);
}

.facts-tab__metric--active {
  border-color: var(--focus);
}

.facts-tab__metric-value {
  font-family: var(--font-mono, monospace);
  font-size: 16px;
  font-weight: 600;
}

.facts-tab__metric-label {
  color: var(--text-muted);
  font-size: 11px;
}

.facts-tab__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.facts-tab__filter {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.facts-tab__filter--active {
  border-color: var(--focus);
  background: var(--bg-selected);
  color: var(--text);
}

.facts-tab__refs,
.facts-tab__entries,
.facts-tab__diagnostics {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.facts-tab__ref,
.facts-tab__entry,
.facts-tab__diagnostic {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
}

.facts-tab__ref-main,
.facts-tab__ref-meta,
.facts-tab__entry-head,
.facts-tab__entry-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.facts-tab__ref-name,
.facts-tab__entry-name,
.facts-tab__diagnostic-path {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  word-break: break-all;
}

.facts-tab__ref-type {
  color: var(--text-secondary);
  font-size: 11px;
}

.facts-tab__ref-status {
  padding: 0 6px;
  border-radius: 3px;
  font-size: 10px;
}

.facts-tab__ref-status--resolved {
  background: var(--success);
  color: var(--bg-app);
}

.facts-tab__ref-status--missing,
.facts-tab__ref-status--unknown_type {
  background: var(--error-bg);
  color: var(--error);
}

.facts-tab__ref-status--self_reference {
  background: var(--warning);
  color: var(--bg-app);
}

.facts-tab__ref-status--custom_readonly {
  background: var(--bg-raised);
  color: var(--text-muted);
}

.facts-tab__ref-status--unresolved {
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.facts-tab__ref-meta {
  color: var(--text-muted);
  font-size: 11px;
}

.facts-tab__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.facts-tab__group-head:hover {
  background: var(--bg-hover);
}

.facts-tab__group-caret {
  width: 12px;
  color: var(--text-muted);
}

.facts-tab__group-label {
  font-weight: 600;
}

.facts-tab__group-count {
  color: var(--text-muted);
}

.facts-tab__group-note {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-muted);
  font-size: 10px;
}

.facts-tab__entry--internal {
  opacity: 0.75;
}

.facts-tab__entry-scope {
  color: var(--text-muted);
  font-size: 11px;
}

.facts-tab__entry-condition {
  margin: 0;
  color: var(--text-secondary);
}

.facts-tab__entry-meta {
  color: var(--text-muted);
  font-size: 11px;
}

.facts-tab__entry-badge {
  padding: 0 6px;
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text-muted);
}

.facts-tab__diagnostic {
  border-left: 2px solid var(--border);
}

.facts-tab__diagnostic--error {
  border-left-color: var(--error);
}

.facts-tab__diagnostic--warn {
  border-left-color: var(--warning);
}

.facts-tab__diagnostic--info {
  border-left-color: var(--success);
}

.facts-tab__diagnostic-sev {
  font-weight: 600;
}

.facts-tab__diagnostic-code {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
}

.facts-tab__diagnostic-clip {
  color: var(--text-muted);
  font-size: 10px;
  word-break: break-all;
}
</style>
