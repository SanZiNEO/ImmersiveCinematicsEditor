<script setup lang="ts">
/**
 * 图工具栏（05-02）：浮在画布右上角的可拖动卡片。
 *
 * 常显：刷新 / 搜索 / 筛选 / 方向 / 模式切换 / 缩放 / 适配 / 更多。
 * 「筛选」展开：触发器类型多选、只显异常、脚本位置、直接前置数量与重置。
 * 「方向」明确展示当前关系流；筛选只改变可见集合，不覆盖选中节点的上下游高亮。
 * 所有计数来自真实 `stats`；卡片位置只存 session。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { COMMAND_SERVICE } from '../../workbench/api/tokens.ts'
import { usePanelContext } from '../../workbench/host/panelContext.ts'
import { triggerTypeLabel } from './labels.ts'
import { useGraphController, type GraphFilterRole } from './state.ts'

const ctx = usePanelContext()
const controller = useGraphController()
const state = controller.state

const searchInput = ref(state.search)
const typeMenuOpen = ref(false)
const filterOpen = ref(false)
const moreOpen = ref(false)
const filterButton = ref<HTMLButtonElement | null>(null)
/** 卡片左上角（相对面板），拖动后更新；默认右上角。 */
const cardPos = ref<{ x: number; y: number } | null>(null)
const dragging = ref(false)
let dragStart: { px: number; py: number; ox: number; oy: number } | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined

function toggleTypeMenu(): void {
  const next = !typeMenuOpen.value
  filterOpen.value = true
  typeMenuOpen.value = next
}

function typeFilterLabel(): string {
  const count = state.filterTypes.length
  if (count === 0) {
    return '全部类型'
  }
  return count === 1 ? state.filterTypes[0] : `${state.filterTypes[0]} 等 ${count} 项`
}

const statsVisible = computed(() => controller.statsText.value !== '')
const warningCount = computed(() => controller.graph.value?.stats.warningCount ?? 0)
const hasGraphNodes = computed(() => (controller.graph.value?.nodes.length ?? 0) > 0)
const typeOptions = computed(() => controller.typeOptions.value)

const filterActiveCount = computed(() => {
  let count = state.filterTypes.length
  if (state.onlyAnomalies) count += 1
  if (state.filterRole !== 'all') count += 1
  if (state.filterDependencyCount !== null) count += 1
  return count
})

const filterActive = computed(() => filterActiveCount.value > 0)

const roleOptions: ReadonlyArray<{ value: GraphFilterRole; label: string }> = [
  { value: 'all', label: '不限' },
  { value: 'entry', label: '起始' },
  { value: 'terminal', label: '最终' },
]

const flowCenterLabel = computed(() =>
  state.edgeFlow === 'forward' ? '默认以最终脚本为中心' : '反向以起始脚本为中心')

function setFilterRole(value: GraphFilterRole): void {
  controller.setFilterRole(value)
}

function roleValue(event: Event): GraphFilterRole {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : 'all'
  return value === 'entry' || value === 'terminal' ? value : 'all'
}

function setDependencyCount(value: number | null): void {
  controller.setFilterDependencyCount(value)
}

function setEdgeFlow(value: 'forward' | 'reverse'): void {
  controller.setEdgeFlow(value)
}

function onEdgeFlowChange(event: Event): void {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  if (value === 'forward' || value === 'reverse') setEdgeFlow(value)
}

function closeMenus(except?: 'filter' | 'flow' | 'type'): void {
  if (except !== 'filter') filterOpen.value = false
  if (except !== 'type') typeMenuOpen.value = false
}

/** 点工具栏外部关闭浮层；类型菜单仍由工具栏内部事件管理。 */
function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null
  const toolbar = target?.closest('.graph-toolbar')
  if (toolbar !== null && toolbar !== undefined) return
  closeMenus()
}

function toggleFilterMenu(): void {
  const next = !filterOpen.value
  filterOpen.value = next
  if (next) {
    typeMenuOpen.value = false
  }
}

function closeFilterMenu(): void {
  filterOpen.value = false
  typeMenuOpen.value = false
  filterButton.value?.focus()
}

function onToolbarKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (typeMenuOpen.value) {
    event.preventDefault()
    typeMenuOpen.value = false
    return
  }
  if (!filterOpen.value) return
  event.preventDefault()
  closeFilterMenu()
}

/** 重置图筛选，但保留顶部搜索词，避免“重置筛选”意外清掉搜索。 */
function resetFilters(): void {
  controller.clearFilters({ keepSearch: true })
  typeMenuOpen.value = false
}

function dependencyValue(event: Event): number | null {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  if (value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

watch(() => state.search, (value) => {
  if (value !== searchInput.value) {
    searchInput.value = value
  }
})

function onSearchInput(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = undefined
    controller.setSearch(searchInput.value)
  }, 150)
}

function clearSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = undefined
  searchInput.value = ''
  controller.setSearch('')
}

function onTypeChange(event: Event): void {
  const select = event.target instanceof HTMLSelectElement ? event.target : null
  if (select === null) {
    return
  }
  const chosen = [...select.selectedOptions].map((option) => option.value).filter((value) => value !== '')
  controller.setFilterTypes(chosen)
}

function clearTypeFilter(): void {
  controller.setFilterTypes([])
}

async function runCommand(commandId: string): Promise<void> {
  const registry = ctx.services.get(COMMAND_SERVICE)
  if (registry === undefined) {
    ctx.status.notify('命令注册表未接线（COMMAND_SERVICE）', 'error')
    return
  }
  await registry.execute({ pageId: ctx.pageId, services: ctx.services }, commandId)
}

function refresh(): void {
  void runCommand('script.refresh')
}

function fit(): void {
  void runCommand('script.fit')
}

function toggleGrouping(): void {
  void runCommand('script.toggleGrouping')
}

function newScript(): void {
  void runCommand('script.new')
}

function undo(): void {
  void controller.undoSelected()
}

function toggleDiagnostics(): void {
  controller.toggleDiagnostics()
}

function refreshTitle(): string {
  if (!state.connected) {
    return '工作区不可用：请先选择游戏目录'
  }
  if (state.refreshing) {
    return '正在扫描脚本…'
  }
  return '重新扫描脚本（保留视图、选中、过滤与折叠）'
}

function newTitle(): string {
  if (!state.connected) {
    return '工作区不可用：无法新建脚本'
  }
  return '新建脚本并刷新图'
}

// ---------- 卡片拖动 ----------

function onDragStart(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }
  const target = event.target instanceof Element ? event.target : null
  // 只从卡片头部拖动，避免和输入框/按钮冲突。
  const handle = target?.closest('[data-drag-handle]')
  if (handle === null || handle === undefined) {
    return
  }
  const header = event.currentTarget as HTMLElement
  const rect = header.getBoundingClientRect()
  const parentEl = header.offsetParent instanceof HTMLElement ? header.offsetParent : null
  const parentRect = parentEl === null ? { left: 0, top: 0 } : parentEl.getBoundingClientRect()
  const originX = rect.left - parentRect.left
  const originY = rect.top - parentRect.top
  cardPos.value = { x: originX, y: originY }
  dragStart = { px: event.clientX, py: event.clientY, ox: originX, oy: originY }
  dragging.value = true
  ;(handle as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}

function onDragMove(event: PointerEvent): void {
  if (!dragging.value || dragStart === null) {
    return
  }
  const el = (event.currentTarget as HTMLElement)
  const parentEl = el.offsetParent instanceof HTMLElement ? el.offsetParent : null
  const parentW = parentEl?.clientWidth ?? 1000
  const parentH = parentEl?.clientHeight ?? 800
  const nextX = dragStart.ox + (event.clientX - dragStart.px)
  const nextY = dragStart.oy + (event.clientY - dragStart.py)
  cardPos.value = {
    x: Math.max(4, Math.min(parentW - el.offsetWidth - 4, nextX)),
    y: Math.max(4, Math.min(parentH - 40, nextY)),
  }
}

function onDragEnd(event: PointerEvent): void {
  if (!dragging.value) {
    return
  }
  dragging.value = false
  dragStart = null
  const target = event.target instanceof Element ? event.target : null
  const handle = target?.closest('[data-drag-handle]') as HTMLElement | null
  if (handle !== null && handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }
}

const cardStyle = computed(() => {
  if (cardPos.value === null) {
    return undefined
  }
  return { left: `${cardPos.value.x}px`, top: `${cardPos.value.y}px`, right: 'auto' }
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  clearTimeout(searchTimer)
  searchTimer = undefined
})
</script>

<template>
  <header
    class="graph-toolbar"
    :class="{ 'graph-toolbar--dragging': dragging }"
    :style="cardStyle"
    role="toolbar"
    aria-label="脚本关系图工具栏"
    @pointerdown="onDragStart"
    @pointermove="onDragMove"
    @pointerup="onDragEnd"
    @pointercancel="onDragEnd"
    @keydown="onToolbarKeydown"
  >
    <div class="graph-toolbar__handle" data-drag-handle="true" title="拖动移动工具栏">
      <span class="graph-toolbar__grip" aria-hidden="true">⠿</span>
      <span class="graph-toolbar__title">脚本图</span>
      <span class="graph-toolbar__stats">{{ controller.statsText.value }}</span>
    </div>

    <div class="graph-toolbar__row">
      <div class="toolbar-field toolbar-field--popover">
        <button
          ref="filterButton"
          type="button"
          class="tool-button"
          :class="{ 'tool-button--active': filterOpen || filterActive }"
          :aria-expanded="filterOpen"
          aria-haspopup="dialog"
          title="筛选脚本"
          @click="toggleFilterMenu"
        >筛选{{ filterActive ? ` · ${filterActiveCount}` : '' }}</button>

        <section v-if="filterOpen" class="tool-popover filter-popover" role="dialog" aria-label="脚本筛选">
          <div class="popover-head">
            <strong>筛选脚本</strong>
            <button type="button" class="popover-close" aria-label="关闭筛选" @click="closeFilterMenu">✕</button>
          </div>

          <div class="filter-section">
            <span class="filter-label">触发器类型</span>
            <div class="toolbar-field">
              <button
                type="button"
                class="tool-select tool-select--menu"
                aria-haspopup="true"
                :aria-expanded="typeMenuOpen"
                title="多选触发器类型"
                @click="toggleTypeMenu"
              >{{ typeFilterLabel() }}</button>
              <div v-if="typeMenuOpen" class="type-menu" data-graph-overlay="true">
                <label class="type-menu__all">
                  <input
                    type="checkbox"
                    :checked="state.filterTypes.length === 0"
                    @change="clearTypeFilter"
                  >
                  全部
                </label>
                <label v-for="type in typeOptions" :key="type" class="type-menu__item">
                  <input
                    type="checkbox"
                    :checked="state.filterTypes.includes(type)"
                    @change="controller.toggleFilterType(type)"
                  >
                  <span>{{ triggerTypeLabel(type) }}</span>
                  <span v-if="triggerTypeLabel(type) !== type" class="type-menu__id">{{ type }}</span>
                </label>
              </div>
            </div>
          </div>

          <label class="toolbar-check filter-check">
            <input
              type="checkbox"
              :checked="state.onlyAnomalies"
              @change="controller.toggleOnlyAnomalies()"
            >
            只显异常
          </label>

          <label class="filter-section filter-field">
            <span class="filter-label">脚本位置</span>
            <select
              class="tool-select filter-select"
              :value="state.filterRole"
              @change="setFilterRole(roleValue($event))"
            >
              <option v-for="option in roleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>

          <label class="filter-section filter-field">
            <span class="filter-label">直接前置数量</span>
            <select
              class="tool-select filter-select"
              :value="state.filterDependencyCount === null ? '' : String(state.filterDependencyCount)"
              @change="setDependencyCount(dependencyValue($event))"
            >
              <option value="">不限</option>
              <option v-for="count in controller.dependencyCountOptions.value" :key="count" :value="count">{{ count }} 个</option>
            </select>
          </label>

          <div class="popover-foot">
            <span class="filter-summary">{{ filterActive ? `${filterActiveCount} 项筛选生效` : '当前未筛选' }}</span>
            <button type="button" class="tool-button" :disabled="!filterActive" @click="resetFilters">重置筛选</button>
          </div>
        </section>
      </div>

      <label class="toolbar-field direction-field" :title="flowCenterLabel">
        <span class="sr-only">关系方向</span>
        <select
          class="tool-select direction-select"
          :value="state.edgeFlow"
          aria-label="关系方向"
          @change="onEdgeFlowChange"
        >
          <option value="forward">前置 → 后续</option>
          <option value="reverse">后续 → 前置</option>
        </select>
      </label>

      <button
        type="button"
        class="tool-button"
        :disabled="state.refreshing"
        :title="refreshTitle()"
        @click="refresh"
      >{{ state.refreshing ? '…' : '刷新' }}</button>

      <div class="search-box">
        <input
          v-model="searchInput"
          type="search"
          class="search-input"
          placeholder="搜索脚本"
          aria-label="搜索脚本"
          spellcheck="false"
          @input="onSearchInput"
        >
        <button
          v-if="searchInput !== ''"
          type="button"
          class="search-clear"
          aria-label="清除搜索"
          @click="clearSearch"
        >✕</button>
      </div>
    </div>

    <div class="graph-toolbar__row">
      <button
        type="button"
        class="tool-button tool-button--mode"
        :title="state.mode === 'dot' ? '切换到卡片模式' : '切换到小圆点模式'"
        @click="controller.toggleMode()"
      >{{ state.mode === 'dot' ? '卡片视图' : '圆点视图' }}</button>

      <div class="toolbar-group">
        <button type="button" class="tool-button tool-button--icon" aria-label="缩小" title="缩小 1.2 倍" @click="controller.zoomBy(1 / 1.2)">−</button>
        <button type="button" class="tool-button tool-button--icon" aria-label="放大" title="放大 1.2 倍" @click="controller.zoomBy(1.2)">+</button>
        <button type="button" class="tool-button" :disabled="!hasGraphNodes" title="适配当前可见节点" @click="fit">适配</button>
      </div>

      <button
        type="button"
        class="tool-button"
        :class="{ 'tool-button--active': moreOpen }"
        :aria-expanded="moreOpen"
        title="更多筛选与操作"
        @click="moreOpen = !moreOpen"
      >更多{{ warningCount > 0 ? ` · ${warningCount}` : '' }}</button>
    </div>

    <div v-if="moreOpen" class="graph-toolbar__more">
      <div class="graph-toolbar__row">
        <button
          type="button"
          class="tool-button"
          :disabled="!controller.canUndoSelected.value"
          title="撤销当前选中脚本的最后一条图操作"
          @click="undo"
        >撤销</button>
        <button
          type="button"
          class="tool-button tool-button--primary"
          :disabled="!state.connected"
          :title="newTitle()"
          @click="newScript"
        >新建脚本</button>
        <button
          type="button"
          class="tool-button"
          :class="{ 'tool-button--warn': warningCount > 0 }"
          title="展开只读诊断列表"
          @click="toggleDiagnostics"
        >诊断 {{ warningCount }}</button>
      </div>

      <div class="graph-toolbar__row">
        <label class="toolbar-check">
          <input
            type="checkbox"
            :checked="state.showEdges"
            @change="controller.toggleShowEdges()"
          >
          边线
        </label>
        <label class="toolbar-check">
          <input
            type="checkbox"
            :checked="state.grouping"
            @change="toggleGrouping"
          >
          文件夹框
        </label>
      </div>

      <div class="graph-toolbar__row graph-toolbar__row--meta">
        <span v-if="state.truncated" class="toolbar-chip">已截断</span>
        <span v-if="state.stale" class="toolbar-chip toolbar-chip--warn" title="收到脚本变更但尚未刷新">已过期</span>
        <span v-if="!state.connected" class="toolbar-chip toolbar-chip--warn">工作区不可用</span>
        <span v-if="statsVisible" class="toolbar-chip" :title="`扫描耗时 ${state.scanMillis} ms`">
          {{ controller.statsText.value }}
        </span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.graph-toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 300px;
  max-width: calc(100% - 20px);
  padding: 8px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px var(--shadow);
  color: var(--text);
  font-size: 11.5px;
  user-select: none;
}
.graph-toolbar--dragging { cursor: grabbing; box-shadow: 0 12px 32px var(--shadow); }
.graph-toolbar__handle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 4px;
  border-bottom: 1px solid var(--border);
  cursor: grab;
  touch-action: none;
}
.graph-toolbar__handle:active { cursor: grabbing; }
.graph-toolbar__grip { color: var(--text-muted); letter-spacing: -1px; }
.graph-toolbar__title { font-weight: 600; }
.graph-toolbar__stats {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}
.graph-toolbar__row { display: flex; align-items: center; gap: 5px; }
.graph-toolbar__row:has(.direction-field) { flex-wrap: wrap; }
.graph-toolbar__row--meta { flex-wrap: wrap; }
.graph-toolbar__more {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.toolbar-group { display: flex; align-items: center; gap: 4px; }
.tool-button {
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
}
.tool-button:hover:not(:disabled) { background: var(--bg-hover); }
.tool-button:disabled { opacity: 0.5; cursor: default; }
.tool-button--icon { min-width: 24px; padding: 3px 0; text-align: center; }
.tool-button--primary { border-color: var(--accent); color: var(--accent); }
.tool-button--warn { color: var(--warning); border-color: var(--warning); }
.tool-button--active { border-color: var(--accent); color: var(--accent); }
.tool-button--mode { flex: 1 1 auto; }
.tool-button:focus-visible, .search-input:focus-visible, .tool-select:focus-visible,
.toolbar-check input:focus-visible, .search-clear:focus-visible, .tool-select--menu:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.search-box { position: relative; display: flex; align-items: center; flex: 1 1 auto; }
.search-input {
  width: 100%;
  min-width: 0;
  padding: 3px 22px 3px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-app);
  color: var(--text);
  font-size: 11.5px;
}
.search-clear {
  position: absolute;
  right: 2px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
}
.toolbar-field { position: relative; display: flex; align-items: center; gap: 4px; }
.toolbar-field--popover { min-width: 0; }
.tool-select {
  padding: 2px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.type-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
  max-height: 240px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-panel);
  box-shadow: 0 8px 20px var(--shadow);
}
.type-menu__all, .type-menu__item { display: flex; align-items: center; gap: 4px; padding: 2px 4px; cursor: pointer; }
.type-menu__all { border-bottom: 1px solid var(--border); margin-bottom: 2px; padding-bottom: 4px; }
.type-menu__id { margin-left: auto; color: var(--text-muted); font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; }
.tool-popover {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  z-index: 45;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 264px;
  max-width: calc(100vw - 24px);
  padding: 9px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 10px 26px var(--shadow);
  color: var(--text);
}
.popover-head { display: flex; align-items: center; gap: 8px; }
.popover-head strong { font-size: 12px; }
.popover-close {
  margin-left: auto;
  padding: 0 3px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.filter-section { display: flex; flex-direction: column; gap: 5px; margin: 0; }
.filter-fieldset { padding: 0; border: 0; }
.filter-label { color: var(--text-secondary); font-size: 10.5px; font-weight: 500; }
.filter-check { padding: 1px 0; }
.filter-field { gap: 4px; }
.filter-select { max-width: none; width: 100%; }
.popover-foot { display: flex; align-items: center; gap: 6px; padding-top: 7px; border-top: 1px solid var(--border); }
.filter-summary { flex: 1 1 auto; color: var(--text-muted); font-size: 10.5px; }
.direction-field { flex: 1 1 auto; min-width: 0; }
.direction-select { width: 100%; max-width: 180px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.popover-close:focus-visible, .filter-select:focus-visible, .direction-select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.toolbar-check { display: flex; align-items: center; gap: 3px; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.toolbar-chip {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 10px;
}
.toolbar-chip--warn { color: var(--warning); border-color: var(--warning); }
</style>
