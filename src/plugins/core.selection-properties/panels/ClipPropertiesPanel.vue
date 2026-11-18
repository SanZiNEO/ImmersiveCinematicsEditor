<script setup lang="ts">
/**
 * 片段属性面板（06-09）：`selection.properties` 的真实内容。
 *
 * 列**全部适用叶子**（含未设置），按 schema 的 section/group 归组；已在效果面板的叶子
 * 不在这里重复出现值控件，组头给出"N 项在效果面板"并可跳到效果面板。
 *
 * 四态与效果面板对称：`none` / `multi` / `clip` / `invalid`（+ `foreign`）。
 * 面板没有关键帧轴、没有节点几何、没有局部标尺；几何只在效果面板。
 *
 * 所有写入走 `ctx.commands.commit`；行集合每次按文档修订号重算，不缓存文档对象。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { JsonObject } from '../../../core/doc/types.ts'
import type { ClipSelectionState } from '../../../workbench/api/context.ts'
import {
  clipTimingOf,
  findClipContext,
  propertyRowsFor,
  separateUnknownGroup,
  withAvailability,
} from '../../../features/effects/clipContext.ts'
import { buildDiagnosticIndex } from '../../../features/effects/diagnostics.ts'
import { buildGroups, partitionGroups } from '../../../features/effects/membership.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type {
  DiagnosticIndex,
  EffectDiagnostic,
  EffectGroup,
  PropertyRow,
  PropertiesPanelSession,
} from '../../../features/effects/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import ClipPropertiesHeader from './ClipPropertiesHeader.vue'
import ClipPropertiesToolbar from './ClipPropertiesToolbar.vue'
import ClipPropertyGroup from './ClipPropertyGroup.vue'
import DiagnosticsBar from '../../../features/effects/panels/DiagnosticsBar.vue'
import EventRecordEditor from '../../core.clip-effects/panels/EventRecordEditor.vue'
import { GROUP_HEADER_HEIGHT, propertyRowHeight } from './rowLayout.ts'

const ctx = usePanelContext()

/**
 * 片段时间几何字段（`playControl`）：由主时间轴编辑，属性面板不渲染值控件。
 *
 * 与 `core/schema/catalog/tracks.ts` 的 `PLAY_CONTROL_FIELDS` 同集合；
 * 这里只列路径名，不复制字段定义（类型/默认值仍从目录取）。
 */
const CLIP_GEOMETRY_PATHS: ReadonlySet<string> = new Set([
  'start_time',
  'duration',
  'loop',
  'loop_count',
  'loop_mode',
])
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const selectionService = ctx.services.get(SELECTION_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

const state = computed<ClipSelectionState>(() => {
  void revision.value
  return selectionService?.state() ?? { kind: 'none' }
})

const summary = computed(() => {
  void revision.value
  return documentService?.summary() ?? null
})

const view = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const clipKey = computed<string | null>(() => (state.value.kind === 'clip' ? state.value.clipKey : null))

const clipContext = computed(() => {
  const key = clipKey.value
  if (key === null) {
    return null
  }
  return findClipContext(view.value, key)
})

const objects = computed<JsonObject | null>(() => {
  void revision.value
  const key = clipKey.value
  if (key === null) {
    return null
  }
  return documentService?.clipObjects(key) ?? null
})

const timing = computed<ClipTiming>(() => {
  const found = clipContext.value
  if (found === null) {
    return { duration: 0, infinite: false }
  }
  return clipTimingOf(found.clip)
})

/** 全部属性行（含未设置与未知路径）。 */
const rows = computed<PropertyRow[]>(() => {
  void revision.value
  const found = clipContext.value
  const key = clipKey.value
  const currentObjects = objects.value
  if (found === null || key === null || currentObjects === null) {
    return []
  }
  if (catalog === undefined) {
    return []
  }
  const built = propertyRowsFor({
    clipKey: key,
    trackType: found.trackType,
    objects: currentObjects,
    catalog,
  })
  // 片段时间几何（`playControl`）由主时间轴编辑：属性面板不提供值控件，
  // 只由片段头给一个"在时间轴编辑"的跳转（06-09 §4.4）。这里把它们从行集合里剔除，
  // 避免出现"看起来能改时长、实际该去主轴"的误导控件。
  const withoutGeometry = built.filter((row) => !CLIP_GEOMETRY_PATHS.has(row.path))
  const separated = separateUnknownGroup(withoutGeometry)
  return withAvailability(separated, catalog, found.trackType, currentObjects)
})

const allGroups = computed<EffectGroup[]>(() => buildGroups(rows.value, timing.value))
const partition = computed(() => partitionGroups(allGroups.value, 'leaf', timing.value))
const propertyGroups = computed(() => partition.value.propertyGroups)
const effectGroups = computed(() => partition.value.effectGroups)

/** 组键 → 该组在效果面板的叶子数。 */
const effectCountByGroup = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  for (const group of effectGroups.value) {
    map.set(group.key, group.rows.length)
  }
  return map
})

/** 组键 → 效果面板里该组的第一条路径（跳转定位用）。 */
const effectPathByGroup = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const group of effectGroups.value) {
    const first = group.rows[0]
    if (first !== undefined) {
      map.set(group.key, first.path)
    }
  }
  return map
})

const playhead = computed(() => {
  void revision.value
  return documentService?.sessionView().playhead ?? 0
})

// ── 会话状态（不进文档、不进序列化） ───────────────────────────

const sessions = new Map<string, PropertiesPanelSession>()

function sessionOf(key: string): PropertiesPanelSession {
  const existing = sessions.get(key)
  if (existing !== undefined) {
    return existing
  }
  const created: PropertiesPanelSession = { collapsed: new Set(), search: '', onlyUnset: false, scrollTop: 0 }
  sessions.set(key, created)
  return created
}

const sessionVersion = ref(0)
const currentSession = computed<PropertiesPanelSession>(() => {
  void sessionVersion.value
  const key = clipKey.value
  return sessionOf(key ?? '')
})

const search = ref('')
const onlyUnset = ref(false)
const collapsed = ref<Set<string>>(new Set())
const scrollTop = ref(0)
const viewportHeight = ref(480)
const scrollRef = ref<HTMLElement | null>(null)
const focusedPath = ref<string | null>(null)

/** 片段切换时恢复该片段自己的折叠 / 过滤 / 滚动。 */
watch(
  () => clipKey.value,
  (key) => {
    if (key === null) {
      search.value = ''
      onlyUnset.value = false
      collapsed.value = new Set()
      scrollTop.value = 0
      focusedPath.value = null
      return
    }
    const saved = sessionOf(key)
    search.value = saved.search
    onlyUnset.value = saved.onlyUnset
    collapsed.value = new Set(saved.collapsed)
    focusedPath.value = null
    void nextTick(() => {
      if (scrollRef.value !== null) {
        scrollRef.value.scrollTop = saved.scrollTop
        scrollTop.value = saved.scrollTop
      }
    })
  },
  { immediate: true },
)

function persist(): void {
  const key = clipKey.value
  if (key === null) {
    return
  }
  const saved = sessionOf(key)
  saved.search = search.value
  saved.onlyUnset = onlyUnset.value
  saved.collapsed = new Set(collapsed.value)
  saved.scrollTop = scrollTop.value
  sessionVersion.value += 1
}

watch([search, onlyUnset, collapsed], persist, { deep: true })

// ── 过滤（只改显示） ─────────────────────────────────────────

function rowMatches(row: PropertyRow): boolean {
  if (onlyUnset.value && row.present && row.keyframes.length === 0 && row.mode !== 'unknown') {
    return false
  }
  const query = search.value.trim().toLowerCase()
  if (query === '') {
    return true
  }
  return row.path.toLowerCase().includes(query)
    || row.label.toLowerCase().includes(query)
    || row.groupLabel.toLowerCase().includes(query)
}

const filteredGroups = computed<EffectGroup[]>(() => {
  const query = search.value.trim().toLowerCase()
  const result: EffectGroup[] = []
  for (const group of propertyGroups.value) {
    const matchedRows = group.rows.filter(rowMatches)
    if (matchedRows.length === 0) {
      // 搜索时按组名命中也能留下整组；"只看未设置"下空组不显示。
      if (query !== '' && !onlyUnset.value && group.label.toLowerCase().includes(query)) {
        result.push(group)
      }
      continue
    }
    result.push({ ...group, rows: matchedRows })
  }
  return result
})

/** 搜索命中时自动展开命中组（只改显示）。 */
watch(
  () => search.value,
  (value) => {
    if (value.trim() === '') {
      return
    }
    const next = new Set(collapsed.value)
    for (const group of filteredGroups.value) {
      next.delete(group.key)
    }
    collapsed.value = next
  },
)

function isCollapsed(groupKey: string): boolean {
  return collapsed.value.has(groupKey)
}

function toggleCollapse(groupKey: string): void {
  const next = new Set(collapsed.value)
  if (next.has(groupKey)) {
    next.delete(groupKey)
  } else {
    next.add(groupKey)
  }
  collapsed.value = next
}

function collapseAll(): void {
  const next = new Set(collapsed.value)
  for (const group of filteredGroups.value) {
    next.add(group.key)
  }
  // 当前选中叶子所在组保持展开。
  const focused = focusedPath.value
  if (focused !== null) {
    for (const group of filteredGroups.value) {
      if (group.rows.some((row) => row.path === focused)) {
        next.delete(group.key)
      }
    }
  }
  collapsed.value = next
}

function clearFilters(): void {
  search.value = ''
  onlyUnset.value = false
  collapsed.value = new Set()
}

// ── 虚拟化：组内容区偏移 ─────────────────────────────────────

const groupTops = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  let cursor = 0
  for (const group of filteredGroups.value) {
    map.set(group.key, cursor + GROUP_HEADER_HEIGHT)
    cursor += GROUP_HEADER_HEIGHT
    if (!collapsed.value.has(group.key)) {
      cursor += group.rows.reduce((sum, row) => sum + propertyRowHeight(row), 0)
    }
  }
  return map
})

function localTopOf(groupKey: string): number {
  return groupTops.value.get(groupKey) ?? 0
}

function onScroll(event: Event): void {
  const element = event.target as HTMLElement
  scrollTop.value = element.scrollTop
  viewportHeight.value = element.clientHeight
}

// ── 诊断 ─────────────────────────────────────────────────────

const diagnostics = ref<DiagnosticIndex>({ byRow: new Map(), byNode: new Map(), byGroup: new Map() })
let diagnosticTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 诊断索引：必填缺失是本地纯函数算的（`isRequiredMissing`），不依赖服务端；
 * 只有文档摘要说"有 issue"或"服务端过期"时才真发一次校验请求，避免每次编辑都打服务端。
 */
async function refreshDiagnostics(): Promise<void> {
  if (documentService === null || documentService === undefined) {
    return
  }
  const current = summary.value
  if (current === null || current.docId === null) {
    diagnostics.value = { byRow: new Map(), byNode: new Map(), byGroup: new Map() }
    return
  }
  if (current.issueCount === 0 && !current.stale) {
    diagnostics.value = buildDiagnosticIndex([], rows.value, 'leaf', {
      ...(clipKey.value === null ? {} : { clipKey: clipKey.value }),
      timing: timing.value,
    })
    return
  }
  const outcome = await documentService.validate()
  diagnostics.value = buildDiagnosticIndex(outcome.issues, rows.value, 'leaf', {
    ...(clipKey.value === null ? {} : { clipKey: clipKey.value }),
    timing: timing.value,
  })
}

watch(
  () => `${revision.value}|${clipKey.value ?? ''}`,
  () => {
    if (diagnosticTimer !== undefined) {
      clearTimeout(diagnosticTimer)
    }
    diagnosticTimer = setTimeout(() => {
      diagnosticTimer = undefined
      void refreshDiagnostics()
    }, 350)
  },
  { immediate: true },
)

const rowDiagnostics = computed<ReadonlyMap<string, readonly EffectDiagnostic[]>>(() => diagnostics.value.byRow)

// ── 选择联动与定位 ───────────────────────────────────────────

watch(
  () => {
    const selection = ctx.selection
    return selection.domain === 'object' || selection.domain === 'keyframe'
      ? `${selection.clipKey ?? ''}|${selection.objectPath ?? ''}`
      : ''
  },
  (signature) => {
    if (signature === '') {
      return
    }
    const path = signature.split('|')[1]
    if (path === undefined || path === '') {
      return
    }
    focusRow(path)
  },
)

function focusRow(path: string): void {
  const inProperties = rows.value.some((row) => row.path === path && row.keyframes.length === 0)
  if (!inProperties) {
    return
  }
  focusedPath.value = path
  // 展开该行所在组并滚到可见位置。
  for (const group of propertyGroups.value) {
    if (!group.rows.some((row) => row.path === path)) {
      continue
    }
    if (collapsed.value.has(group.key)) {
      const next = new Set(collapsed.value)
      next.delete(group.key)
      collapsed.value = next
    }
    break
  }
  void nextTick(() => {
    const container = scrollRef.value
    if (container === null) {
      return
    }
    const target = container.querySelector<HTMLElement>(`[data-path="${path}"]`)
    if (target !== null) {
      target.scrollIntoView({ block: 'nearest' })
      target.focus({ preventScroll: true })
    }
  })
}

function jumpToEffects(groupKey: string): void {
  const key = clipKey.value
  const path = effectPathByGroup.value.get(groupKey)
  if (key === null || path === undefined) {
    return
  }
  ctx.requestRevealInEffectControls({ clipKey: key, objectPath: path })
}

function revealEffects(payload: { clipKey: string; path: string }): void {
  ctx.requestRevealInEffectControls({ clipKey: payload.clipKey, objectPath: payload.path })
}

// ── 事件记录编辑器（本面板内挂载；记录编辑是事件叶子的唯一入口） ──

const eventEditor = ref<{ clipKey: string; path: string; time: number } | null>(null)

function openEventEditor(payload: { clipKey: string; path: string; time: number }): void {
  eventEditor.value = payload
}

function closeEventEditor(): void {
  eventEditor.value = null
}

function onEnabled(payload: { clipKey: string; path: string; time: number }): void {
  ctx.requestRevealInEffectControls({
    clipKey: payload.clipKey,
    objectPath: payload.path,
    time: payload.time,
  })
  focusedPath.value = null
}

function onFailed(payload: { clipKey: string; path: string; message: string }): void {
  focusedPath.value = payload.path
}

// ── 状态辅助 ─────────────────────────────────────────────────

const multiLabel = computed(() => (state.value.kind === 'multi' ? state.value.clipKeys.length : 0))

const invalidReason = computed(() => (state.value.kind === 'invalid' ? state.value.reason : ''))

const foreignDomain = computed(() => (state.value.kind === 'foreign' ? state.value.domain : null))

const canUndo = computed(() => {
  void revision.value
  return ctx.commands.canUndo
})

function runUndo(): void {
  ctx.commands.undo()
}

const hasGroups = computed(() => filteredGroups.value.length > 0)
const totalRows = computed(() => propertyGroups.value.reduce((sum, group) => sum + group.rows.length, 0))
</script>

<template>
  <section class="props-panel" aria-label="属性">
    <p v-if="documentService === undefined" class="props-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前文档。
    </p>

    <template v-else>
      <!-- 片段态 -->
      <template v-if="state.kind === 'clip' && clipKey !== null">
        <template v-if="clipContext !== null && objects !== null">
          <ClipPropertiesHeader :clip="clipContext.clip" :track-type="clipContext.trackType" :summary="summary" />
          <ClipPropertiesToolbar
            :search="search"
            :only-unset="onlyUnset"
            :collapsed-count="collapsed.size"
            @update:search="search = $event"
            @toggle-only-unset="onlyUnset = !onlyUnset"
            @collapse-all="collapseAll"
            @clear="clearFilters"
          />

          <div ref="scrollRef" class="props-panel__scroll" @scroll="onScroll">
            <p v-if="totalRows === 0" class="props-panel__empty">
              该轨道没有可编辑字段（schema 未声明任何适用对象）。这里不提供添加入口。
            </p>
            <p v-else-if="!hasGroups" class="props-panel__empty">
              没有匹配的属性。清除搜索或"只看未设置"后重新查看。
            </p>
            <ClipPropertyGroup
              v-for="group in filteredGroups"
              :key="group.key"
              :group="group"
              :timing="timing"
              :playhead="playhead"
              :collapsed="isCollapsed(group.key)"
              :effect-count="effectCountByGroup.get(group.key) ?? 0"
              :diagnostics="rowDiagnostics"
              :focused-path="focusedPath"
              :local-top="localTopOf(group.key)"
              :scroll-top="scrollTop"
              :viewport-height="viewportHeight"
              @toggle-collapse="toggleCollapse"
              @jump-effects="jumpToEffects"
              @open-event-editor="openEventEditor"
              @reveal-effects="revealEffects"
              @focus-row="focusRow($event.path)"
              @enabled="onEnabled"
              @failed="onFailed"
            />
          </div>

          <aside v-if="eventEditor !== null" class="props-panel__editor">
            <EventRecordEditor
              :clip-key="eventEditor.clipKey"
              :path="eventEditor.path"
              :time="eventEditor.time"
              @close="closeEventEditor"
            />
          </aside>

          <DiagnosticsBar scope="properties" :clip-key="clipKey" />
        </template>

        <p v-else class="props-panel__notice" role="alert">
          片段 {{ clipKey }} 已不在当前文档里（可能已被删除）。撤销可以恢复它。
        </p>
      </template>

      <!-- 多选 -->
      <div v-else-if="state.kind === 'multi'" class="props-panel__block" role="status">
        <h2 class="props-panel__title">多选 · {{ multiLabel }} 个片段</h2>
        <p class="props-panel__hint">
          多选只显示数量与键；不合并属性，也不擅自展开第一个片段。在时间轴上点单个片段后再编辑。
        </p>
        <ul class="props-panel__list">
          <li v-for="key in state.clipKeys" :key="key" class="props-panel__mono">{{ key }}</li>
        </ul>
      </div>

      <!-- 失效 -->
      <div v-else-if="state.kind === 'invalid'" class="props-panel__block props-panel__block--error" role="alert">
        <h2 class="props-panel__title">选区失效</h2>
        <p class="props-panel__hint">{{ invalidReason }}</p>
        <dl class="props-panel__facts">
          <dt>之前域</dt>
          <dd>{{ state.previous.domain }}</dd>
          <template v-if="state.previous.clipKey !== undefined">
            <dt>之前 clipKey</dt>
            <dd class="props-panel__mono">{{ state.previous.clipKey }}</dd>
          </template>
        </dl>
        <button type="button" class="props-panel__button" :disabled="!canUndo" @click="runUndo">
          撤销恢复
        </button>
      </div>

      <!-- 外部域 -->
      <div v-else-if="state.kind === 'foreign'" class="props-panel__block" role="status">
        <h2 class="props-panel__title">当前选择属于 {{ foreignDomain }} 域</h2>
        <p class="props-panel__hint">属性面板只处理片段 / 对象 / 关键帧选择；在时间轴上选一个片段后再查看属性。</p>
      </div>

      <!-- 无选择 -->
      <p v-else class="props-panel__empty">
        没有选中片段。空态不自动选择第一个片段；在时间轴上点击片段后这里显示它的全部属性。
      </p>
    </template>
  </section>
</template>

<style scoped>
.props-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.props-panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.props-panel__editor {
  flex: 0 0 auto;
  max-height: 45%;
  overflow: auto;
  border-top: 1px solid var(--border-strong);
}

.props-panel__empty,
.props-panel__notice {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.props-panel__notice {
  border-style: solid;
  border-color: var(--warning);
  color: var(--warning);
}

.props-panel__block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
}

.props-panel__block--error {
  border-color: var(--error);
  background: var(--error-bg);
}

.props-panel__title {
  margin: 0;
  color: var(--text);
  font-size: 13px;
}

.props-panel__hint {
  margin: 0;
  color: var(--text-secondary);
}

.props-panel__list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.props-panel__mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

.props-panel__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.props-panel__facts dt {
  color: var(--text-muted);
}

.props-panel__facts dd {
  margin: 0;
}

.props-panel__button {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.props-panel__button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.props-panel__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
}

.props-panel__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
