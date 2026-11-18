/**
 * 脚本关系图面板状态（05-02 / 05-04 / 05-08 / 05-13）。
 *
 * 一个 `GraphController` 同时服务面板与命令：
 * - 命令在面板未挂载时安全失败（notify），不伪造刷新；
 * - 图数据只来自 `GRAPH_SERVICE`，布局只来自 `GRAPH_LAYOUT_SERVICE`；
 * - 视图 / 手摆坐标 / 折叠的写盘全部 debounce，失败只提示，不阻塞编辑。
 */
import { computed, inject, reactive, ref, shallowRef, type ComputedRef, type InjectionKey, type ShallowRef } from 'vue'
import type { I18nApi, StatusApi } from '../../workbench/api/context.ts'
import type { DocumentService } from '../../workbench/api/documents.ts'
import type {
  GraphInvalidation,
  GraphLayoutServicePort,
  GraphServicePort,
  RefsApplyResult,
  RefsPreviewResult,
  RequiresMutationRequest,
  RequiresMutationResult,
  ScriptMutationServicePort,
} from '../../workbench/api/graph.ts'
import type { ShellActionsPort } from '../../workbench/api/actions.ts'
import type { PageRouter } from '../../workbench/api/registries.ts'
import type { ServiceRegistry } from '../../workbench/api/services.ts'
import {
  DOCUMENT_SERVICE,
  FILE_DIALOG_PORT,
  GRAPH_LAYOUT_SERVICE,
  GRAPH_SERVICE,
  PAGE_ROUTER,
  SCRIPT_MUTATION_SERVICE,
  SHELL_ACTIONS_SERVICE,
} from '../../workbench/api/tokens.ts'
import {
  clampScale,
  computeGraphLayout,
  neighboursOf,
  screenToWorld,
  type GraphLayout,
  type GraphNodePosition,
  type GraphPartition,
  type GraphViewState,
  type LaidOutNode,
} from '../../core/graph/layout.ts'
import type { GraphData, GraphNode, GraphWarning } from '../../core/graph/types.ts'
import {
  adjacentOf,
  boxOfNodes,
  collapsedAncestorOf,
  fitBox,
  isFolderHidden,
  matchesSearch,
  nodeDegrees,
  anomalyPathSet,
  type NodeDegree,
  type ViewportSize,
} from './geometry.ts'
import { mutationErrorText } from './labels.ts'
import { HoverIntent } from '../../workbench/shared/hoverIntent.ts'
import { LayoutScheduler } from './layoutScheduler.ts'
import { LayoutPersist } from './layoutPersist.ts'

/** 插件 / 面板 ID（05-13 固定）。 */
export const GRAPH_PLUGIN_ID = 'core.script-graph'
export const GRAPH_PANEL_ID = 'script.graph'

/** 面板焦点作用域（04-10 形态；保留给宿主诊断）。 */
export const GRAPH_PANEL_SCOPE = `panel:${GRAPH_PLUGIN_ID}:${GRAPH_PANEL_ID}`

/** 面板阶段。 */
export type GraphPanelPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

/** 图上维护前置的对话框目标。 */
export interface GraphEditorTarget {
  path: string
  triggerIdentity: string | null
  requirementIndex: number | null
  intent: 'add' | 'update' | 'delete'
}

/** 诊断定位的详情目标。 */
export interface GraphDetailTarget {
  path: string
  triggerIdentity: string | null
  requirementIndex: number | null
}

/** 面板运行期状态（只存 session，不写盘）。 */
export interface GraphPanelState {
  phase: GraphPanelPhase
  selectedPath: string | null
  rovingPath: string | null
  hoverPath: string | null
  search: string
  /** 触发器类型过滤（多选；空数组 = 全部）。 */
  filterTypes: string[]
  onlyAnomalies: boolean
  /** 是否显示文件夹框（原「目录分组」开关语义：控制 clusters 是否绘制）。 */
  grouping: boolean
  /** 是否绘制边线（连线展示开关）。 */
  showEdges: boolean
  /** 渲染模式：小圆点（简洁） / 大卡片。 */
  mode: 'dot' | 'card'
  /** 是否播放布局收敛动画（只对视口内节点做精细计算）。 */
  animate: boolean
  collapsed: string[]
  view: GraphViewState
  highlight: 'both' | 'up' | 'down'
  refreshing: boolean
  stale: boolean
  error: string | null
  connected: boolean
  truncated: boolean
  dataVersion: number
  scanMillis: number
  lastInvalidation: string | null
  diagnosticsOpen: boolean
  detail: GraphDetailTarget | null
  editor: GraphEditorTarget | null
  renamePath: string | null
  confirmReset: boolean
  layoutWarning: string | null
  gestureActive: boolean
}

/** 控制器依赖（面板挂载时注入；命令只读）。 */
export interface GraphControllerDeps {
  services: ServiceRegistry
  status: StatusApi
  i18n: I18nApi
  pageId: string
}

/** 目录分组带的渲染信息。 */
export interface PartitionView {
  partition: GraphPartition
  collapsed: boolean
}

/** 空集合（避免每次分配）。 */
const EMPTY_PATHS: ReadonlySet<string> = new Set<string>()

type LoadKind = 'mount' | 'manual' | 'auto'

/** 默认状态。 */
function initialState(): GraphPanelState {
  return {
    phase: 'idle',
    selectedPath: null,
    rovingPath: null,
    hoverPath: null,
    search: '',
    filterTypes: [],
    onlyAnomalies: false,
    grouping: true,
    showEdges: true,
    mode: 'dot',
    animate: true,
    collapsed: [],
    view: { scale: 1, tx: 0, ty: 0 },
    highlight: 'both',
    refreshing: false,
    stale: false,
    error: null,
    connected: false,
    truncated: false,
    dataVersion: 0,
    scanMillis: 0,
    lastInvalidation: null,
    diagnosticsOpen: false,
    detail: null,
    editor: null,
    renamePath: null,
    confirmReset: false,
    layoutWarning: null,
    gestureActive: false,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** 剪贴板写入（Electron / 浏览器都尝试；失败返回 false）。 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续尝试旧通道。
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

/** 新建脚本后、面板可能已切页时的选中记忆。 */
let pendingSelectionPath: string | null = null

/** 记忆一个待选中路径（图刷新后若存在则选中）。 */
export function rememberSelectionAfterReload(path: string): void {
  pendingSelectionPath = path
}

/** 实际控制器（懒建；跨页面切换保留视图 session）。 */
let controllerInstance: GraphController | null = null

/** 取/建唯一控制器。 */
export function graphController(): GraphController {
  if (controllerInstance === null) {
    controllerInstance = new GraphController()
  }
  return controllerInstance
}

/** 已存在的控制器（未打开过图时为 `null`）。 */
export function existingGraphController(): GraphController | null {
  return controllerInstance
}

/** 面板内注入键（组件不 import 宿主 store，只拿同一个控制器）。 */
export const GRAPH_CONTROLLER_KEY: InjectionKey<GraphController> = Symbol('script-graph.controller')

/** 取面板注入的控制器；不在 GraphPanel 内挂载时立刻抛错。 */
export function useGraphController(): GraphController {
  const controller = inject(GRAPH_CONTROLLER_KEY, null)
  if (controller === null) {
    throw new Error('GraphController 缺失：组件必须由 GraphPanel 挂载')
  }
  return controller
}

/** 脚本关系图控制器。 */
export class GraphController {
  readonly state = reactive<GraphPanelState>(initialState())
  readonly graph: ShallowRef<GraphData | null> = shallowRef(null)
  readonly layout: ShallowRef<GraphLayout | null> = shallowRef(null)
  readonly layoutRevision = ref(0)
  readonly viewport = reactive<ViewportSize>({ width: 0, height: 0 })

  private deps: GraphControllerDeps | null = null
  private services: ServiceRegistry | null = null
  private service: GraphServicePort | null = null
  private layoutService: GraphLayoutServicePort | null = null
  private mutation: ScriptMutationServicePort | null = null
  private mountedFlag = false
  private panelElement: HTMLElement | null = null
  private unsubscribe: (() => void) | null = null
  private layoutLoaded = false
  private bootstrapping = false
  /** 首次把视图居中到力导向锚点（之后不再自动移动，尊重用户平移/持久化视图）。 */
  private viewCentered = false
  /**
   * 布局调度（06-12 拆分）：分批出图、分批顺序、视口内力导向动画。
   *
   * 控制器只判断"什么时候要重算"，具体调度交给它；本类不再持有布局计时器。
   */
  private readonly layoutScheduler = new LayoutScheduler({
    graph: () => this.graph.value,
    layout: () => this.layout.value,
    mounted: () => this.mountedFlag,
    animate: () => this.state.animate,
    overrides: () => this.manualPositions,
    worldBox: () => this.worldBoxOfViewport(),
    publish: (next) => {
      this.layout.value = next
      this.layoutRevision.value += 1
    },
    onFirstBatch: () => {
      this.centerOnAnchorIfNeeded()
    },
  })
  private loading: Promise<void> | null = null
  private queuedRefresh = false
  private autoPending = false
  private manualPositions: Record<string, GraphNodePosition> = {}
  private autoTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * 布局持久化（06-12 拆分）：视图 / 节点位置 / 折叠状态三条防抖写入。
   *
   * 控制器只决定"什么时候写"，写盘时机与错误上报交给它；本类不再持有写盘计时器。
   */
  private readonly layoutPersist = new LayoutPersist({
    service: () => this.layoutService,
    view: () => this.state.view,
    positions: () => this.manualPositions,
    collapsed: () => this.state.collapsed,
    onError: (message) => this.reportLayoutError(message),
  })

  // ---------- 派生数据 ----------

  readonly selectedNode: ComputedRef<GraphNode | null> = computed(() => {
    const path = this.state.selectedPath
    return path === null ? null : this.graph.value?.nodes.find((node) => node.path === path) ?? null
  })

  readonly hoverNode: ComputedRef<GraphNode | null> = computed(() => {
    const path = this.state.hoverPath
    return path === null ? null : this.graph.value?.nodes.find((node) => node.path === path) ?? null
  })

  readonly detailNode: ComputedRef<GraphNode | null> = computed(() => {
    const path = this.state.detail?.path ?? null
    return path === null ? null : this.graph.value?.nodes.find((node) => node.path === path) ?? null
  })

  readonly anomalyPaths: ComputedRef<Set<string>> = computed(() => {
    const layout = this.layout.value
    void this.layoutRevision.value
    return anomalyPathSet(this.graph.value, layout?.nodes ?? [])
  })

  readonly relation: ComputedRef<{
    mode: 'none' | 'selection' | 'hover'
    source: string | null
    up: ReadonlySet<string>
    down: ReadonlySet<string>
  }> = computed(() => {
    const graph = this.graph.value
    const selected = this.state.selectedPath
    if (graph === null) {
      return { mode: 'none', source: null, up: EMPTY_PATHS, down: EMPTY_PATHS }
    }
    if (selected !== null && graph.nodes.some((node) => node.path === selected)) {
      const result = neighboursOf(graph.nodes, graph.edges, selected)
      return { mode: 'selection', source: selected, up: result.up, down: result.down }
    }
    const hover = this.state.hoverPath
    if (hover !== null) {
      const result = adjacentOf(graph.edges, hover)
      return { mode: 'hover', source: hover, up: result.up, down: result.down }
    }
    return { mode: 'none', source: null, up: EMPTY_PATHS, down: EMPTY_PATHS }
  })

  readonly upPaths: ComputedRef<ReadonlySet<string>> = computed(() =>
    this.state.highlight === 'down' ? EMPTY_PATHS : this.relation.value.up)

  readonly downPaths: ComputedRef<ReadonlySet<string>> = computed(() =>
    this.state.highlight === 'up' ? EMPTY_PATHS : this.relation.value.down)

  readonly relationSource: ComputedRef<string | null> = computed(() => this.relation.value.source)

  /** 被折叠目录隐藏、但因悬停上下游而临时显示的节点。 */
  readonly revealedPaths: ComputedRef<ReadonlySet<string>> = computed(() => {
    const hover = this.state.hoverPath
    const graph = this.graph.value
    if (hover === null || graph === null) {
      return EMPTY_PATHS
    }
    const { up, down } = adjacentOf(graph.edges, hover)
    const result = new Set<string>([hover])
    for (const path of [...up, ...down]) {
      const node = graph.nodes.find((candidate) => candidate.path === path)
      if (node !== undefined && isFolderHidden(node.folder, this.state.collapsed)) {
        result.add(path)
      }
    }
    return result
  })

  readonly visibleNodes: ComputedRef<LaidOutNode[]> = computed(() => {
    const layout = this.layout.value
    void this.layoutRevision.value
    if (layout === null) {
      return []
    }
    const search = this.state.search.trim()
    const filterTypes = this.state.filterTypes
    const anomalies = this.state.onlyAnomalies ? this.anomalyPaths.value : null
    const revealed = this.revealedPaths.value
    return layout.nodes.filter((node) => {
      if (anomalies !== null && !anomalies.has(node.path)) {
        return false
      }
      if (filterTypes.length > 0 && !node.triggers.some((trigger) => filterTypes.includes(trigger.type))) {
        return false
      }
      if (search !== '' && !matchesSearch(node, search)) {
        return false
      }
      if (isFolderHidden(node.folder, this.state.collapsed) && !revealed.has(node.path)) {
        return false
      }
      return true
    })
  })

  readonly partitions: ComputedRef<PartitionView[]> = computed(() => {
    const layout = this.layout.value
    void this.layoutRevision.value
    if (layout === null || !this.state.grouping) {
      return []
    }
    const views: PartitionView[] = []
    for (const partition of layout.partitions) {
      const ancestor = collapsedAncestorOf(partition.folder, this.state.collapsed)
      if (ancestor !== null && ancestor !== partition.folder) {
        continue
      }
      views.push({ partition, collapsed: ancestor !== null })
    }
    return views
  })

  readonly degrees: ComputedRef<Map<string, NodeDegree>> = computed(() => nodeDegrees(this.graph.value))

  readonly typeOptions: ComputedRef<string[]> = computed(() => {
    const types = new Set<string>()
    for (const node of this.graph.value?.nodes ?? []) {
      for (const trigger of node.triggers) {
        if (trigger.type !== '') {
          types.add(trigger.type)
        }
      }
    }
    return [...types].sort((left, right) => left.localeCompare(right))
  })

  readonly hasFilters: ComputedRef<boolean> = computed(() =>
    this.state.search.trim() !== '' || this.state.filterTypes.length > 0 || this.state.onlyAnomalies)

  readonly emptyResult: ComputedRef<boolean> = computed(() =>
    this.hasFilters.value && (this.graph.value?.nodes.length ?? 0) > 0 && this.visibleNodes.value.length === 0)

  readonly statsText: ComputedRef<string> = computed(() => {
    const stats = this.graph.value?.stats
    if (stats === undefined || stats.nodeCount === 0) {
      return ''
    }
    const parts = [`${stats.nodeCount} 脚本`, `${stats.edgeCount} 前置`, `${stats.warningCount} 问题`]
    if (stats.invalidCount > 0) {
      parts.push(`${stats.invalidCount} 无效`)
    }
    if (stats.truncated) {
      parts.push('已截断')
    }
    return parts.join(' · ')
  })

  readonly canUndoSelected: ComputedRef<boolean> = computed(() => {
    void this.state.dataVersion
    const path = this.state.selectedPath
    if (path === null || this.mutation === null) {
      return false
    }
    return this.mutation.canUndo(path)
  })

  readonly hoverTarget: ComputedRef<GraphNode | null> = computed(() =>
    this.detailNode.value ?? this.hoverNode.value)

  // ---------- 生命周期 ----------

  /** 面板挂载：接服务、订阅失效、首次加载。 */
  mount(deps: GraphControllerDeps): void {
    this.deps = deps
    this.services = deps.services
    this.service = deps.services.get(GRAPH_SERVICE) ?? null
    this.layoutService = deps.services.get(GRAPH_LAYOUT_SERVICE) ?? null
    this.mutation = deps.services.get(SCRIPT_MUTATION_SERVICE) ?? null
    this.state.connected = this.service?.connected() ?? false
    if (this.layoutService === null) {
      this.state.layoutWarning = '图布局服务未接线：视图与手摆位置不会保存'
    }
    if (!this.mountedFlag) {
      this.mountedFlag = true
      if (this.service !== null) {
        this.unsubscribe = this.service.subscribe((event) => {
          this.onInvalidation(event)
        })
      }
      void this.bootstrap()
      return
    }
    this.state.connected = this.service?.connected() ?? false
    void this.loadGraph('mount')
  }

  /** 面板卸载：停订阅与定时器，未写盘的布局立即写一次。 */
  unmount(): void {
    this.mountedFlag = false
    this.unsubscribe?.()
    this.unsubscribe = null
    this.hover.dispose()
    this.clearAutoTimer()
    this.layoutScheduler.dispose()
    this.flushLayoutWrites()
    this.state.gestureActive = false
    this.state.editor = null
    this.state.renamePath = null
    this.state.confirmReset = false
  }

  isMounted(): boolean {
    return this.mountedFlag
  }

  setPanelElement(element: HTMLElement | null): void {
    this.panelElement = element
  }

  /** 让键盘快捷键只在图面板内部生效。 */
  isFocusedInsidePanel(): boolean {
    if (this.panelElement === null || typeof document === 'undefined') {
      return false
    }
    const active = document.activeElement
    return active instanceof HTMLElement && this.panelElement.contains(active)
  }

  /** 焦点在无限画布本体（不是节点、不是悬停卡片按钮）。 */
  isCanvasFocused(): boolean {
    if (typeof document === 'undefined') {
      return false
    }
    const active = document.activeElement
    return active instanceof HTMLElement
      && active.hasAttribute('data-graph-viewport')
      && this.isFocusedInsidePanel()
  }

  /** 焦点在画布本体或节点卡片上（Enter 之外的图快捷键用）。 */
  isGraphSurfaceFocused(): boolean {
    if (typeof document === 'undefined') {
      return false
    }
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !this.isFocusedInsidePanel()) {
      return false
    }
    return active.hasAttribute('data-graph-viewport') || active.closest('[data-graph-node]') !== null
  }

  hasOpenDialog(): boolean {
    return this.state.editor !== null || this.state.renamePath !== null || this.state.confirmReset
  }

  setViewport(width: number, height: number): void {
    const nextWidth = Math.max(0, Math.round(width))
    const nextHeight = Math.max(0, Math.round(height))
    if (this.viewport.width === nextWidth && this.viewport.height === nextHeight) {
      return
    }
    this.viewport.width = nextWidth
    this.viewport.height = nextHeight
    this.centerOnAnchorIfNeeded()
    this.scheduleViewportAnimation()
  }

  /** 首次布局就绪后把锚点居中（1:1，不压缩整图）；之后尊重用户视图。 */
  private centerOnAnchorIfNeeded(): void {
    if (this.viewCentered) {
      return
    }
    const layout = this.layout.value
    if (layout === null || this.viewport.width <= 0 || this.viewport.height <= 0) {
      return
    }
    this.viewCentered = true
    const anchor = layout.centerPath === null
      ? undefined
      : layout.nodes.find((node) => node.path === layout.centerPath)
    const target = anchor ?? layout.nodes[0]
    if (target === undefined) {
      return
    }
    const scale = this.state.view.scale
    this.state.view = {
      scale,
      tx: this.viewport.width / 2 - target.x * scale,
      ty: this.viewport.height / 2 - target.y * scale,
    }
  }

  // ---------- 加载 ----------

  private async bootstrap(): Promise<void> {
    if (this.bootstrapping) {
      return
    }
    this.bootstrapping = true
    try {
      await this.loadGraph('mount')
      await this.ensureLayout()
    } finally {
      this.bootstrapping = false
    }
  }

  private async ensureLayout(): Promise<void> {
    if (this.layoutLoaded) {
      return
    }
    this.layoutLoaded = true
    const service = this.layoutService
    if (service === null) {
      this.recomputeLayout()
      return
    }
    try {
      const result = await service.load(this.knownNodes())
      const file = result.file
      this.state.view = {
        scale: clampScale(file.view.scale),
        tx: finiteOr(file.view.tx, 0),
        ty: finiteOr(file.view.ty, 0),
      }
      // 已持久化的视图（非默认）视为用户意图；默认视图则允许后续重新居中。
      const persisted = this.state.view.tx !== 0 || this.state.view.ty !== 0 || this.state.view.scale !== 1
      this.viewCentered = persisted
      this.state.collapsed = [...file.collapsed]
      this.manualPositions = { ...file.nodes }
      if (result.status === 'corrupt' || result.status === 'too-large') {
        this.state.layoutWarning = result.messages.length > 0
          ? result.messages.join('；')
          : '图布局已恢复默认'
      } else if (result.messages.length > 0) {
        this.state.layoutWarning = result.messages.join('；')
      }
    } catch (error) {
      this.state.layoutWarning = `图布局读取失败，已使用默认布局：${messageOf(error)}`
    }
    this.recomputeLayout()
  }

  private knownNodes(): { path: string; scriptId: string | null }[] {
    return (this.graph.value?.nodes ?? []).map((node) => ({
      path: node.path,
      scriptId: node.scriptId ?? null,
    }))
  }

  /** 手动刷新（工具栏 / 命令）：立即重扫。 */
  async refresh(): Promise<void> {
    await this.loadGraph('manual')
  }

  private async loadGraph(kind: LoadKind): Promise<void> {
    const service = this.service
    if (service === null) {
      this.state.phase = this.graph.value === null ? 'error' : this.state.phase
      this.state.error = '脚本图服务未接线（GRAPH_SERVICE）：当前无法扫描脚本'
      this.state.connected = false
      return
    }
    if (kind !== 'mount' && this.state.gestureActive) {
      this.autoPending = true
      return
    }
    if (this.loading !== null) {
      this.queuedRefresh = true
      await this.loading
      return
    }
    this.state.refreshing = true
    if (kind === 'mount' && this.graph.value === null) {
      this.state.phase = 'idle'
    }
    const run = this.fetchGraph(service, kind)
    this.loading = run
    try {
      await run
    } finally {
      if (this.loading === run) {
        this.loading = null
      }
    }
    if (this.queuedRefresh) {
      this.queuedRefresh = false
      await this.loadGraph('manual')
    }
  }

  private async fetchGraph(service: GraphServicePort, kind: LoadKind): Promise<void> {
    try {
      // 脚本来自工作区文件，与游戏是否运行无关：`connected()` 只影响预览，
      // 因此自动刷新不再因「未连接模组」提前返回（否则文件改了图也不会更新）。
      const data = kind === 'manual' ? await service.refresh() : await service.snapshot()
      this.applyGraph(data)
    } catch (error) {
      this.state.error = messageOf(error)
      this.state.stale = true
      this.state.connected = service.connected()
      if (this.graph.value === null) {
        this.state.phase = 'error'
      }
    } finally {
      this.state.refreshing = false
    }
  }

  private applyGraph(data: GraphData): void {
    const service = this.service
    this.state.connected = service?.connected() ?? true
    if (data.unchanged === true) {
      this.state.stale = false
      return
    }
    this.clearAutoTimer()
    this.graph.value = data
    this.state.dataVersion = data.version
    this.state.scanMillis = data.stats.scanMillis
    this.state.truncated = data.stats.truncated
    this.state.stale = false
    this.state.error = null
    this.state.phase = data.nodes.length === 0 ? 'empty' : 'ready'

    const exists = (path: string): boolean => data.nodes.some((node) => node.path === path)
    if (this.state.selectedPath !== null && !exists(this.state.selectedPath)) {
      this.state.selectedPath = null
      this.state.highlight = 'both'
      this.notify('选中的脚本已不在图中，已清除选中', 'warning')
    }
    if (this.state.rovingPath !== null && !exists(this.state.rovingPath)) {
      this.state.rovingPath = null
    }
    if (this.state.hoverPath !== null && !exists(this.state.hoverPath)) {
      this.state.hoverPath = null
    }
    if (this.state.detail !== null && !exists(this.state.detail.path)) {
      this.state.detail = null
    }
    if (this.state.editor !== null && !exists(this.state.editor.path)) {
      this.state.editor = null
    }
    if (this.state.renamePath !== null && !exists(this.state.renamePath)) {
      this.state.renamePath = null
    }
    if (this.state.filterTypes.length > 0) {
      const available = new Set<string>()
      for (const node of data.nodes) {
        for (const trigger of node.triggers) {
          available.add(trigger.type)
        }
      }
      this.state.filterTypes = this.state.filterTypes.filter((type) => available.has(type))
    }

    this.recomputeLayout()
    try {
      this.layoutService?.rebind(this.knownNodes())
    } catch (error) {
      this.reportLayoutError(`图布局重绑定失败：${messageOf(error)}`)
    }
    this.state.rovingPath = this.state.rovingPath
      ?? this.state.selectedPath
      ?? data.nodes[0]?.path
      ?? null

    if (pendingSelectionPath !== null) {
      const pending = pendingSelectionPath
      pendingSelectionPath = null
      if (exists(pending)) {
        this.select(pending)
      }
    }
  }

  private onInvalidation(event: GraphInvalidation): void {
    this.state.stale = true
    this.state.lastInvalidation = event.kind
    this.state.connected = this.service?.connected() ?? false
    if (!this.mountedFlag) {
      return
    }
    if (!this.state.connected) {
      // 断连不自动重试，只标过期；恢复连接时服务会再发 reconnect。
      return
    }
    this.scheduleAutoRefresh(event.kind === 'reconnect' ? 300 : 1000)
  }

  private scheduleAutoRefresh(delayMs: number): void {
    if (!this.mountedFlag) {
      return
    }
    if (this.state.gestureActive) {
      this.autoPending = true
      return
    }
    this.clearAutoTimer()
    this.autoTimer = setTimeout(() => {
      this.autoTimer = undefined
      void this.loadGraph('auto')
    }, delayMs)
  }

  private clearAutoTimer(): void {
    if (this.autoTimer !== undefined) {
      clearTimeout(this.autoTimer)
      this.autoTimer = undefined
    }
  }

  /** 拖动 / 缩放期间延后自动刷新，并暂停力导向动画（否则节点会从指针下跑掉）。 */
  noteGesture(active: boolean): void {
    const wasActive = this.state.gestureActive
    this.state.gestureActive = active
    if (active) {
      this.stopLayoutAnimation()
    }
    if (wasActive && !active && this.autoPending) {
      this.autoPending = false
      this.scheduleAutoRefresh(250)
    }
    if (wasActive && !active) {
      this.scheduleViewportAnimation()
    }
  }

  // ---------- 布局 / 视图 ----------

  private recomputeLayout(): void {
    const graph = this.graph.value
    if (graph === null) {
      this.layout.value = null
      this.layoutRevision.value += 1
      this.layoutScheduler.stopBatch()
      this.layoutScheduler.stopAnimation()
      return
    }
    this.layoutScheduler.recompute()
  }

  private stopLayoutBatch(): void {
    this.layoutScheduler.stopBatch()
  }

  private stopLayoutAnimation(): void {
    this.layoutScheduler.stopAnimation()
  }

  /** 视口对应的世界包围盒（四角经 `screenToWorld` 转换）。 */
  private worldBoxOfViewport(): { minX: number; minY: number; maxX: number; maxY: number } {
    const view = this.state.view
    const width = this.viewport.width
    const height = this.viewport.height
    const topLeft = screenToWorld({ x: 0, y: 0 }, view)
    const bottomRight = screenToWorld({ x: Math.max(1, width), y: Math.max(1, height) }, view)
    return {
      minX: Math.min(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxX: Math.max(topLeft.x, bottomRight.x),
      maxY: Math.max(topLeft.y, bottomRight.y),
    }
  }

  /** 视口变了：等 300ms 稳定后，对新区间重新起一轮力导向（拖动时不每帧重启）。 */
  private scheduleViewportAnimation(): void {
    if (!this.state.animate || this.graph.value === null) {
      return
    }
    if (this.viewport.width <= 0 || this.viewport.height <= 0) {
      return
    }
    this.layoutScheduler.scheduleViewportAnimation()
  }

  setView(next: GraphViewState): void {
    this.state.view = {
      scale: clampScale(next.scale),
      tx: finiteOr(next.tx, 0),
      ty: finiteOr(next.ty, 0),
    }
    this.scheduleViewSave()
    this.scheduleViewportAnimation()
  }

  zoomBy(factor: number, anchor?: { x: number; y: number }): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      return
    }
    const point = anchor ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 }
    const scale = this.state.view.scale * factor
    // 复用 core 的锚定公式，避免缩放中心漂移。
    const worldX = (point.x - this.state.view.tx) / this.state.view.scale
    const worldY = (point.y - this.state.view.ty) / this.state.view.scale
    const next = clampScale(scale)
    this.setView({
      scale: next,
      tx: point.x - worldX * next,
      ty: point.y - worldY * next,
    })
  }

  panByPixels(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return
    }
    this.setView({
      scale: this.state.view.scale,
      tx: this.state.view.tx + dx,
      ty: this.state.view.ty + dy,
    })
  }

  /** 适配当前可见节点（过滤/折叠之后）。 */
  fit(): void {
    const box = boxOfNodes(this.visibleNodes.value, this.state.mode === 'card')
    if (box === null) {
      this.notify('没有可适配的节点', 'warning')
      return
    }
    if (this.viewport.width <= 0 || this.viewport.height <= 0) {
      return
    }
    this.setView(fitBox(box, this.viewport))
  }

  centerOnNode(path: string): void {
    const node = this.layout.value?.nodes.find((candidate) => candidate.path === path)
    if (node === undefined || this.viewport.width <= 0 || this.viewport.height <= 0) {
      return
    }
    const scale = this.state.view.scale
    const centerX = node.x
    const centerY = node.y
    this.setView({
      scale,
      tx: this.viewport.width / 2 - centerX * scale,
      ty: this.viewport.height / 2 - centerY * scale,
    })
  }

  /** 拖动中的节点位置（世界坐标；松手后写盘）。 */
  moveNode(path: string, x: number, y: number): void {
    const node = this.layout.value?.nodes.find((candidate) => candidate.path === path)
    if (node === undefined) {
      return
    }
    node.x = Math.max(-1e6, Math.min(1e6, x))
    node.y = Math.max(-1e6, Math.min(1e6, y))
    this.layoutRevision.value += 1
  }

  /** 松手：记入手摆覆盖并 debounce 写盘。 */
  commitNodeMove(path: string): void {
    const node = this.layout.value?.nodes.find((candidate) => candidate.path === path)
    if (node === undefined) {
      return
    }
    this.manualPositions = {
      ...this.manualPositions,
      [path]: { x: node.x, y: node.y, scriptId: node.scriptId ?? null },
    }
    this.schedulePositionsSave()
  }

  resetLayout(): void {
    const service = this.layoutService
    const finish = (): void => {
      this.manualPositions = {}
      this.state.collapsed = []
      this.state.confirmReset = false
      this.recomputeLayout()
      this.notify('图布局已重置（视图保留）', 'info')
    }
    if (service === null) {
      finish()
      return
    }
    void service.resetLayout().then((result) => {
      if (!result.ok) {
        this.reportLayoutError(result.message ?? '图布局重置失败')
      }
      finish()
    }).catch((error: unknown) => {
      this.reportLayoutError(messageOf(error))
      finish()
    })
  }

  askResetLayout(): void {
    this.state.confirmReset = true
  }

  cancelReset(): void {
    this.state.confirmReset = false
  }

  private scheduleViewSave(): void {
    this.layoutPersist.scheduleView()
  }

  private schedulePositionsSave(): void {
    this.layoutPersist.schedulePositions()
  }

  private scheduleCollapsedSave(): void {
    this.layoutPersist.scheduleCollapsed()
  }

  private flushLayoutWrites(): void {
    this.layoutPersist.flush()
  }

  private reportLayoutError(message: string): void {
    if (this.state.layoutWarning === message) {
      return
    }
    this.state.layoutWarning = message
  }

  // ---------- 过滤 / 分组 ----------

  setSearch(value: string): void {
    this.state.search = value
  }

  setFilterTypes(types: string[]): void {
    this.state.filterTypes = [...new Set(types)].sort((left, right) => left.localeCompare(right))
  }

  toggleFilterType(type: string): void {
    const current = this.state.filterTypes
    this.state.filterTypes = current.includes(type)
      ? current.filter((entry) => entry !== type)
      : [...current, type]
  }

  toggleOnlyAnomalies(): void {
    this.state.onlyAnomalies = !this.state.onlyAnomalies
  }

  setMode(mode: 'dot' | 'card'): void {
    if (mode !== this.state.mode) {
      this.state.mode = mode
    }
  }

  toggleMode(): void {
    this.state.mode = this.state.mode === 'dot' ? 'card' : 'dot'
  }

  setShowEdges(value: boolean): void {
    this.state.showEdges = value
  }

  toggleShowEdges(): void {
    this.state.showEdges = !this.state.showEdges
  }

  clearFilters(): void {
    this.state.search = ''
    this.state.filterTypes = []
    this.state.onlyAnomalies = false
  }

  toggleGrouping(): void {
    this.state.grouping = !this.state.grouping
  }

  toggleFolder(folder: string): void {
    const collapsed = this.state.collapsed.includes(folder)
      ? this.state.collapsed.filter((entry) => entry !== folder)
      : [...this.state.collapsed, folder]
    this.state.collapsed = collapsed
    this.scheduleCollapsedSave()
  }

  // ---------- 选中 / 悬停 ----------

  select(path: string | null): void {
    this.state.selectedPath = path
    if (path !== null) {
      this.state.rovingPath = path
      this.state.highlight = 'both'
    }
    if (this.state.detail !== null && this.state.detail.path !== path) {
      this.state.detail = null
    }
  }

  toggleSelect(path: string): void {
    if (this.state.selectedPath === path) {
      this.clearSelection()
      return
    }
    this.select(path)
  }

  clearSelection(): void {
    this.state.selectedPath = null
    this.state.highlight = 'both'
  }

  setRovingPath(path: string | null): void {
    this.state.rovingPath = path
  }

  setHighlight(mode: 'both' | 'up' | 'down'): void {
    this.state.highlight = mode
  }

  focusUpstream(): void {
    if (this.state.selectedPath === null) {
      this.notify('先选中一个脚本，再聚焦上游', 'warning')
      return
    }
    this.state.highlight = 'up'
  }

  focusDownstream(): void {
    if (this.state.selectedPath === null) {
      this.notify('先选中一个脚本，再聚焦下游', 'warning')
      return
    }
    this.state.highlight = 'down'
  }

  /**
   * 悬停意图（06-12：改用工作台共享机制，行为等价）。
   *
   * 进入延迟 250ms（避免扫过时闪烁）、离开延迟 420ms（允许指针移到悬浮卡片上）；
   * 进入计时开始时冻结布局动画——节点在指针下移动会让 pointerleave 抖动、卡片闪烁。
   */
  private readonly hover = new HoverIntent({
    showDelayMs: 250,
    hideDelayMs: 420,
    onIntent: () => this.stopLayoutAnimation(),
    onShow: (path) => {
      this.state.hoverPath = path
    },
    onHide: () => {
      this.state.hoverPath = null
    },
  })

  hoverIntent(path: string): void {
    if (this.state.hoverPath === path) {
      return
    }
    this.hover.intent(path)
  }

  /** 键盘聚焦节点时立即显示（不依赖 hover 计时）。 */
  hoverNow(path: string): void {
    this.stopLayoutAnimation()
    this.hover.now(path)
  }

  hoverKeep(): void {
    this.hover.keep()
  }

  hoverLeave(): void {
    this.hover.leave()
  }

  clearHover(): void {
    this.hover.clear()
    this.state.hoverPath = null
  }

  // ---------- 诊断 / 详情 ----------

  toggleDiagnostics(): void {
    this.state.diagnosticsOpen = !this.state.diagnosticsOpen
  }

  closeDiagnostics(): void {
    this.state.diagnosticsOpen = false
  }

  locateWarning(warning: GraphWarning): void {
    const graph = this.graph.value
    if (graph === null || !graph.nodes.some((node) => node.path === warning.path)) {
      return
    }
    this.select(warning.path)
    this.state.detail = {
      path: warning.path,
      triggerIdentity: warning.triggerIdentity ?? null,
      requirementIndex: warning.requirementIndex ?? null,
    }
    this.state.diagnosticsOpen = false
    this.centerOnNode(warning.path)
  }

  closeDetail(): void {
    this.state.detail = null
  }

  // ---------- 打开 / 新建 / 复制 ----------

  openSelected(): void {
    const path = this.state.selectedPath
    if (path === null) {
      this.notify('没有选中的脚本', 'warning')
      return
    }
    void this.openScript(path)
  }

  async openScript(path: string): Promise<void> {
    const documents = this.services?.get(DOCUMENT_SERVICE)
    const router = this.services?.get(PAGE_ROUTER)
    const shell = this.services?.get(SHELL_ACTIONS_SERVICE)
    const summary = documents?.summary()
    if (summary !== undefined && summary.path === path) {
      router?.navigate('document', { docId: summary.docId ?? '' })
      return
    }
    this.state.error = null
    if (summary !== undefined && summary.dirty) {
      if (shell === undefined) {
        this.notify('当前文档有未保存修改：先保存或放弃后再打开其他脚本', 'warning')
        return
      }
      const guard = await shell.guard()
      if (guard !== 'proceed') {
        return
      }
    }
    if (shell !== undefined) {
      try {
        await shell.openPath(path)
      } catch (error) {
        this.failOpen(path, messageOf(error))
        return
      }
      if (documents !== undefined && documents.summary().path !== path) {
        this.failOpen(path, documents.summary().path === null ? '未打开文档' : '打开了其他脚本')
      }
      return
    }
    if (documents === undefined) {
      this.failOpen(path, '文档服务未接线（DOCUMENT_SERVICE）')
      return
    }
    try {
      const outcome = await documents.open(path)
      if (!outcome.ok) {
        this.failOpen(path, outcome.error ?? '打开失败')
        return
      }
    } catch (error) {
      this.failOpen(path, messageOf(error))
      return
    }
    router?.navigate('document', { docId: documents.summary().docId ?? '' })
  }

  private failOpen(path: string, reason: string): void {
    this.state.error = `打开脚本失败：${path}（${reason}）`
    this.notify(this.state.error, 'error')
  }

  async copyPath(path: string): Promise<void> {
    const copied = await writeClipboard(path)
    this.notify(copied ? `已复制路径：${path}` : '复制失败：剪贴板不可用', copied ? 'info' : 'warning')
  }

  async newScript(): Promise<void> {
    const documents = this.services?.get(DOCUMENT_SERVICE)
    const router = this.services?.get(PAGE_ROUTER)
    const shell = this.services?.get(SHELL_ACTIONS_SERVICE)
    const before = documents?.summary().path ?? null
    if (shell !== undefined) {
      try {
        await shell.newDocument()
      } catch (error) {
        this.notify(`新建脚本失败：${messageOf(error)}`, 'error')
        return
      }
    } else if (documents !== undefined) {
      const outcome = await documents.newDoc()
      if (!outcome.ok) {
        this.notify(`新建脚本失败：${outcome.error ?? '未知原因'}`, 'error')
        return
      }
      router?.navigate('document', { docId: documents.summary().docId ?? '' })
    } else {
      this.notify('新建脚本失败：文档服务未接线（DOCUMENT_SERVICE）', 'error')
      return
    }
    const after = documents?.summary().path ?? null
    if (after !== null && after !== before) {
      rememberSelectionAfterReload(after)
    }
    await this.loadGraph('manual')
  }

  async openScriptFile(): Promise<void> {
    const shell = this.services?.get(SHELL_ACTIONS_SERVICE)
    if (shell !== undefined) {
      try {
        await shell.openScriptFile()
      } catch (error) {
        this.notify(`打开脚本失败：${messageOf(error)}`, 'error')
      }
      return
    }
    const files = this.services?.get(FILE_DIALOG_PORT)
    if (files === undefined) {
      this.notify('打开脚本失败：文件对话框未接线', 'error')
      return
    }
    const path = await files.openScript()
    if (path === null) {
      return
    }
    await this.openScript(path)
  }

  // ---------- 对话框 ----------

  openDependencyEditor(
    path?: string,
    triggerIdentity: string | null = null,
    requirementIndex: number | null = null,
    intent: 'add' | 'update' | 'delete' = requirementIndex === null ? 'add' : 'update',
  ): void {
    const target = path ?? this.state.selectedPath
    if (target === null) {
      this.notify('先选中一个脚本，再维护前置', 'warning')
      return
    }
    const node = this.graph.value?.nodes.find((candidate) => candidate.path === target)
    if (node === undefined) {
      this.notify('脚本已不在图中，无法维护前置', 'warning')
      return
    }
    this.state.editor = { path: target, triggerIdentity, requirementIndex, intent }
  }

  openRenameDialog(path?: string): void {
    const target = path ?? this.state.selectedPath
    if (target === null) {
      this.notify('先选中一个脚本，再改 id', 'warning')
      return
    }
    const node = this.graph.value?.nodes.find((candidate) => candidate.path === target)
    if (node === undefined) {
      this.notify('脚本已不在图中，无法改 id', 'warning')
      return
    }
    if (node.scriptId === null || node.scriptId === undefined || node.scriptId === '') {
      this.notify('当前脚本没有 meta.id：先设置脚本 id 才能改名', 'warning')
      return
    }
    this.state.renamePath = target
  }

  closeEditor(): void {
    this.state.editor = null
  }

  closeRename(): void {
    this.state.renamePath = null
  }

  /** 前置写入成功后：关闭对话框、刷新图、保持选中。 */
  async handleEditorSaved(path: string): Promise<void> {
    this.state.editor = null
    this.state.dataVersion += 1
    if (this.state.selectedPath === null) {
      this.select(path)
    }
    await this.loadGraph('manual')
    this.notify('前置已更新', 'info')
  }

  /** 改 id 应用成功后刷新（路径不变，选中保留）。 */
  async handleRenameSaved(): Promise<void> {
    this.state.renamePath = null
    await this.loadGraph('manual')
    this.notify('脚本 id 与引用已更新', 'info')
  }

  /** 关系写入服务是否接线（对话框据此给出诚实提示）。 */
  mutationAvailable(): boolean {
    return this.mutation !== null
  }

  /** 图上改一条前置（05-07）；服务缺失或抛错都转成结果，不伪造成功。 */
  async mutateRequires(request: RequiresMutationRequest): Promise<RequiresMutationResult> {
    const mutation = this.mutation
    if (mutation === null) {
      return { ok: false, code: 'offline', message: '关系写入服务未接线（SCRIPT_MUTATION_SERVICE）' }
    }
    try {
      return await mutation.mutateRequires(request)
    } catch (error) {
      return { ok: false, code: 'write_failed', message: messageOf(error) }
    }
  }

  /** 改 id 预览（05-06）。 */
  async previewRefs(from: string, to: string): Promise<RefsPreviewResult> {
    const mutation = this.mutation
    if (mutation === null) {
      return { ok: false, code: 'offline', message: '关系写入服务未接线（SCRIPT_MUTATION_SERVICE）' }
    }
    try {
      return await mutation.previewRefs(from, to)
    } catch (error) {
      return { ok: false, code: 'write_failed', message: messageOf(error) }
    }
  }

  /** 改 id 应用（05-06）。 */
  async applyRefs(from: string, to: string, expectedFiles: number): Promise<RefsApplyResult> {
    const mutation = this.mutation
    if (mutation === null) {
      return {
        ok: false,
        code: 'offline',
        message: '关系写入服务未接线（SCRIPT_MUTATION_SERVICE）',
        rolledBack: false,
      }
    }
    try {
      return await mutation.applyRefs(from, to, expectedFiles)
    } catch (error) {
      return { ok: false, code: 'write_failed', message: messageOf(error), rolledBack: false }
    }
  }

  async undoSelected(): Promise<void> {
    const path = this.state.selectedPath
    const mutation = this.mutation
    if (path === null) {
      this.notify('先选中一个脚本，再撤销图操作', 'warning')
      return
    }
    if (mutation === null) {
      this.notify('关系写入服务未接线（SCRIPT_MUTATION_SERVICE）', 'error')
      return
    }
    if (!mutation.canUndo(path)) {
      this.notify('当前脚本没有可撤销的图操作', 'warning')
      return
    }
    try {
      const result = await mutation.undo(path)
      if (!result.ok) {
        this.notify(mutationErrorText(result.code, result.message), 'error')
        return
      }
    } catch (error) {
      this.notify(`撤销失败：${messageOf(error)}`, 'error')
      return
    }
    this.state.dataVersion += 1
    await this.loadGraph('manual')
    this.notify('已撤销上一条图操作', 'info')
  }

  private notify(message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
    this.deps?.status.notify(message, severity)
  }
}
